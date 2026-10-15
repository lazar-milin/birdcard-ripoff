import http from "node:http";
import { randomBytes, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { view } from "./game.mjs";
import * as Rooms from "./rooms.mjs";

const root = fileURLToPath(new URL("./public/", import.meta.url));
const rooms = new Map(),
  sessions = new Map(),
  limits = new Map();
// Long-poll requests waiting for a table to change, by table code.
const waiting = new Map();
// How long a long-poll request waits before returning unchanged state. Tests shorten it.
export const config = { longPollMs: 25000 };
const guests = process.env.ALLOW_GUESTS !== "false" && process.env.NODE_ENV !== "production";
const key = () => randomBytes(24).toString("hex");
const guestColors = ["Amber", "Azure", "Coral", "Jade", "Lilac", "Silver", "Saffron", "Indigo"],
  guestBirds = ["Heron", "Finch", "Sparrow", "Crane", "Wren", "Swift", "Lark", "Egret"];
const guestName = (input) => {
  const name = String(input ?? "").trim().slice(0, 24);
  return !name || /^player$/i.test(name)
    ? `${guestColors[randomInt(guestColors.length)]} ${guestBirds[randomInt(guestBirds.length)]}`
    : name;
};
const json = (res, status, data) => {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
};
async function body(req) {
  let str = "";
  for await (const c of req) {
    str += c;
    if (str.length > 8192) throw new Error("Request too large.");
  }
  return JSON.parse(str || "{}");
}
function snapshot(room, id) {
  return {
    code: room.code,
    host: room.host,
    standings: room.standings ?? [],
    version: room.version,
    players: room.players,
    game: room.game ? view(room.game, id) : null,
    you: id,
  };
}
function session(req) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  const s = sessions.get(token);
  if (!s || Date.now() - s.created > 86400000) throw new Error("Session expired. Reload to sign in.");
  return s;
}
const seated = (room, s) => room?.players.some((p) => p.id === s.id);
function roomFor(s) {
  const room = rooms.get(s.room);
  if (!seated(room, s)) throw new Error("Join a table first.");
  room.touched = Date.now();
  return room;
}
// Stores a room's next state from rooms.mjs, bumps its version, and wakes anyone
// waiting on it. null closes the room.
function commit(code, next) {
  const prev = rooms.get(code);
  if (next === prev) return prev;
  if (next) rooms.set(code, { ...next, version: (prev?.version ?? 0) + 1, touched: Date.now() });
  else rooms.delete(code);
  wake(code);
  return rooms.get(code) ?? null;
}
// Answers a waiting request with the table as it is now, or tells the client it lost its seat.
function answer(w) {
  clearTimeout(w.timer);
  const room = rooms.get(w.code);
  if (w.session.room !== w.code || !seated(room, w.session)) return json(w.res, 400, { error: "Join a table first." });
  json(w.res, 200, snapshot(room, w.session.id));
}
function wake(code) {
  const list = waiting.get(code);
  if (!list) return;
  waiting.delete(code);
  for (const w of list) answer(w);
}
// Holds a state request open until the table changes or the wait runs out.
function wait(res, s, room) {
  const list = waiting.get(room.code) ?? new Set();
  waiting.set(room.code, list);
  const w = { res, session: s, code: room.code };
  list.add(w);
  w.timer = setTimeout(() => {
    list.delete(w);
    answer(w);
  }, config.longPollMs);
  // The client gave up, for example by closing the tab.
  res.on("close", () => {
    clearTimeout(w.timer);
    list.delete(w);
  });
}
// A player can't sit at a second table while their seat holds up an unfinished game.
function assertFree(s, code) {
  const other = Rooms.unfinishedSeat(rooms.values(), s.id, code);
  if (other)
    throw new Error(`You still have a seat in an unfinished game at table ${other}. Rejoin it with that code first.`);
}

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (url.pathname.startsWith("/api/")) {
      const ip = req.socket.remoteAddress,
        now = Date.now(),
        limit = limits.get(ip) || { time: now, n: 0 };
      if (now - limit.time > 60000) {
        limit.time = now;
        limit.n = 0;
      }
      limits.set(ip, limit);
      if (++limit.n > 1800) return json(res, 429, { error: "Too many requests. Try again shortly." });
      if (req.method === "GET" && url.pathname === "/api/config")
        return json(res, 200, { clientId: process.env.DISCORD_CLIENT_ID || "", guests, canResetRooms: guests });
      if (req.method === "POST" && url.pathname === "/api/reset-rooms") {
        if (!guests) return json(res, 403, { error: "Room reset is only available on the playtest server." });
        if (!req.headers["content-type"]?.startsWith("application/json")) return json(res, 415, { error: "Expected JSON." });
        const { password } = await body(req);
        if (password !== "deletor") return json(res, 403, { error: "Incorrect password. No rooms were deleted." });
        const deleted = rooms.size;
        const codes = [...rooms.keys()];
        rooms.clear();
        for (const s of sessions.values()) s.room = null;
        codes.forEach(wake);
        return json(res, 200, { ok: true, deleted });
      }
      if (req.method === "POST" && url.pathname === "/api/login") {
        const b = await body(req);
        let id, name, access_token;
        if (b.code) {
          if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET)
            throw new Error("The host needs to configure Discord credentials.");
          const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env.DISCORD_CLIENT_ID,
              client_secret: process.env.DISCORD_CLIENT_SECRET,
              grant_type: "authorization_code",
              code: b.code,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (!tokenResponse.ok) throw new Error("Discord authorization failed. Please reopen the Activity.");
          ({ access_token } = await tokenResponse.json());
          const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
            headers: { Authorization: `Bearer ${access_token}` },
            signal: AbortSignal.timeout(15000),
          });
          if (!userResponse.ok) throw new Error("Could not verify Discord identity.");
          const u = await userResponse.json();
          id = u.id;
          name = u.global_name || u.username;
        } else {
          if (!guests) return json(res, 403, { error: "Open this game inside Discord." });
          id = key();
          name = guestName(b.name);
        }
        const token = key();
        sessions.set(token, { id, name, created: Date.now(), room: null });
        return json(res, 200, { token, id, name, ...(access_token ? { access_token } : {}) });
      }
      const s = session(req);
      if (req.method === "GET" && url.pathname === "/api/me") return json(res, 200, { id: s.id, name: s.name });
      if (req.method === "GET" && url.pathname === "/api/state") {
        const room = roomFor(s);
        // ?since=<version> waits for anything newer than the version the client has.
        const since = url.searchParams.get("since");
        if (since !== null && Number(since) >= room.version) return wait(res, s, room);
        return json(res, 200, snapshot(room, s.id));
      }
      if (req.method !== "POST") return json(res, 404, { error: "Not found." });
      const b = await body(req);
      if (url.pathname === "/api/join") {
        // Forget a table that closed or dropped this player's seat.
        if (s.room && !seated(rooms.get(s.room), s)) s.room = null;
        let code;
        if (b.create) {
          if (s.room) throw new Error("Leave your current room before creating another.");
          assertFree(s, null);
          if (rooms.size >= 500) throw new Error("The server is full. Try again later.");
          do code = randomBytes(4).toString("hex").toUpperCase();
          while (rooms.has(code));
          commit(code, Rooms.createRoom(code, s));
        } else {
          code = String(b.code || "").trim().toUpperCase();
          const room = rooms.get(code);
          if (!room) throw new Error("Table not found. Check the table code.");
          if (s.room && s.room !== code) throw new Error("Leave your current room before joining another.");
          assertFree(s, code);
          commit(code, Rooms.join(room, s));
        }
        s.room = code;
        return json(res, 200, snapshot(rooms.get(code), s.id));
      }
      const room = roomFor(s);
      if (b.version !== room.version) return json(res, 409, { error: "The table changed. Please try again." });
      if (url.pathname === "/api/start") commit(room.code, Rooms.start(room, s.id));
      else if (url.pathname === "/api/rematch") commit(room.code, Rooms.proposeRematch(room, s.id));
      else if (url.pathname === "/api/move") commit(room.code, Rooms.play(room, s.id, b.action || {}));
      else if (url.pathname === "/api/leave") {
        const { room: next, saved } = Rooms.leave(room, s.id);
        commit(room.code, next);
        s.room = null;
        return json(res, 200, { ok: true, saved, code: room.code });
      } else return json(res, 404, { error: "Not found." });
      return json(res, 200, snapshot(rooms.get(room.code), s.id));
    }
    if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
      path = resolve(root, "." + pathname);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) return json(res, 403, { error: "Forbidden." });
    const data = await readFile(path);
    const types = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".webp": "image/webp",
      ".jpg": "image/jpeg",
    };
    res.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  } catch (e) {
    // A missing file or a folder is "Not found."; a malformed URL is a bad request.
    // Neither leaks Node's own error text.
    const missing = e.code === "ENOENT" || e.code === "EISDIR";
    json(res, missing ? 404 : 400, { error: missing ? "Not found." : e instanceof URIError ? "Bad request." : e.message });
  }
});
// Memory-only prototype: idle tables and authentication sessions expire after a day.
setInterval(() => {
  const cutoff = Date.now() - 86400000;
  for (const [k, v] of rooms)
    if (v.touched < cutoff) {
      rooms.delete(k);
      wake(k);
    }
  for (const [k, v] of sessions) if (v.created < cutoff) sessions.delete(k);
  for (const [k, v] of limits) if (v.time < Date.now() - 120000) limits.delete(k);
}, 60000).unref();
if (process.argv[1] === fileURLToPath(import.meta.url))
  server.listen(Number(process.env.PORT || 3000), process.env.HOST || "127.0.0.1", () =>
    console.log(`Bird Table running at http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3000}`),
  );
