import test from "node:test";
import assert from "node:assert/strict";
import { server, config } from "./server.mjs";
import { speciesOf } from "./public/species.js";

let base;
test.before(() => new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
  base = `http://127.0.0.1:${server.address().port}/api/`;
  resolve();
})));
test.after(() => new Promise((resolve) => {
  server.closeAllConnections();
  server.close(resolve);
}));
async function api(path, data, token) {
  const res = await fetch(base + path, {
    method: data ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return { status: res.status, data: await res.json() };
}
const login = async (name) => (await api("login", { name })).data;
test("guest defaults receive a color and an unused bird, while chosen names are kept", async () => {
  const gameBirds = new Set(["flamingo", "owl", "toucan", "duck", "parrot", "magpie", "warbler", "robin"]);
  for (const supplied of [undefined, "", "Player", " player "]) {
    const guest = await login(supplied);
    const parts = guest.name.split(" ");
    assert.equal(parts.length, 2);
    assert.equal(gameBirds.has(parts[1].toLowerCase()), false);
    assert.notEqual(guest.name.toLowerCase(), "player");
    const joined = (await api("join", { create: true }, guest.token)).data;
    assert.equal(joined.players[0].name, guest.name);
  }
  assert.equal((await login("Chosen name")).name, "Chosen name");
});
test("Discord display names bypass guest name generation", async () => {
  const fetchOriginal = globalThis.fetch;
  const clientIdOriginal = process.env.DISCORD_CLIENT_ID;
  const clientSecretOriginal = process.env.DISCORD_CLIENT_SECRET;
  process.env.DISCORD_CLIENT_ID = "test-client";
  process.env.DISCORD_CLIENT_SECRET = "test-secret";
  globalThis.fetch = (url, options) => {
    if (String(url).startsWith("https://discord.com/api/oauth2/token"))
      return Promise.resolve(new Response(JSON.stringify({ access_token: "test-access" }), { status: 200 }));
    if (String(url).startsWith("https://discord.com/api/v10/users/@me"))
      return Promise.resolve(new Response(JSON.stringify({ id: "discord-user", username: "Backup", global_name: "Player" }), { status: 200 }));
    return fetchOriginal(url, options);
  };
  try {
    const result = await api("login", { code: "test-code" });
    assert.equal(result.status, 200);
    assert.equal(result.data.name, "Player");
    const joined = await api("join", { create: true }, result.data.token);
    assert.equal(joined.data.players[0].name, "Player");
  } finally {
    globalThis.fetch = fetchOriginal;
    if (clientIdOriginal === undefined) delete process.env.DISCORD_CLIENT_ID;
    else process.env.DISCORD_CLIENT_ID = clientIdOriginal;
    if (clientSecretOriginal === undefined) delete process.env.DISCORD_CLIENT_SECRET;
    else process.env.DISCORD_CLIENT_SECRET = clientSecretOriginal;
  }
});
async function table(...names) {
  const people = [];
  for (const name of names) people.push(await login(name));
  let room = (await api("join", { create: true }, people[0].token)).data;
  for (const p of people.slice(1)) room = (await api("join", { code: room.code }, p.token)).data;
  return { people, room };
}

test("two clients share a game, keep hands private, reject stale and unauthorized moves, reconnect", async () => {
  const { people: [a, b], room: lobby } = await table("Alice", "Bob");
  assert.equal((await api("start", { version: lobby.version }, b.token)).status, 400);
  const room = (await api("start", { version: lobby.version }, a.token)).data;
  const bv = (await api("state", null, b.token)).data;
  assert.equal(room.game.players[1].hand, undefined);
  assert.equal(bv.game.players[0].hand, undefined);
  assert.equal(bv.game.players[1].hand.length, 8);
  const turn = room.game.turn,
    t = turn === 0 ? a : b,
    own = turn === 0 ? room : bv;
  const action = { type: "lay", bird: speciesOf(own.game.players[turn].hand[0]), row: 0, side: "left" };
  assert.equal((await api("move", { version: room.version, action }, turn === 0 ? b.token : a.token)).status, 400);
  assert.equal((await api("move", { version: room.version, action }, t.token)).status, 200);
  assert.equal((await api("move", { version: room.version, action }, t.token)).status, 409);
  assert.equal((await api("state", null, a.token)).status, 200);
  assert.equal((await api("state")).status, 400);

  // Leaving mid-game keeps the seat, and blocks sitting at another table (#17).
  const beforeLeave = (await api("state", null, a.token)).data;
  const savedHand = beforeLeave.game.players.find((p) => p.id === a.id).hand;
  const left = await api("leave", { version: beforeLeave.version }, a.token);
  assert.equal(left.status, 200);
  assert.equal(left.data.saved, true);
  assert.equal((await api("state", null, a.token)).status, 400);
  assert.equal((await api("me", null, a.token)).data.id, a.id);
  const elsewhere = await api("join", { create: true }, a.token);
  assert.equal(elsewhere.status, 400);
  assert.match(elsewhere.data.error, new RegExp(`unfinished game at table ${beforeLeave.code}`));
  const returned = (await api("join", { code: beforeLeave.code.toLowerCase() }, a.token)).data;
  assert.deepEqual(returned.game.players.find((p) => p.id === a.id).hand, savedHand);
  assert.equal(returned.players.find((p) => p.id === a.id).away, undefined);

  assert.equal((await api("reset-rooms", {})).status, 403);
  assert.equal((await api("reset-rooms", { password: "wrong" })).status, 403);
  assert.equal((await api("state", null, b.token)).status, 200);
  const reset = await api("reset-rooms", { password: "deletor" });
  assert.equal(reset.status, 200);
  assert.ok(reset.data.deleted >= 1);
  assert.equal((await api("state", null, b.token)).status, 400);
  assert.equal((await api("join", { code: beforeLeave.code }, a.token)).status, 400);
  assert.equal((await api("join", { create: true }, a.token)).status, 200);
});

test("the last player out of a lobby closes it (#14)", async () => {
  const { people: [c], room } = await table("Cleo");
  const left = await api("leave", { version: room.version }, c.token);
  assert.equal(left.data.saved, false);
  const again = await api("join", { code: room.code }, c.token);
  assert.equal(again.status, 400);
  assert.match(again.data.error, /Table not found/);
  assert.equal((await api("join", { create: true }, c.token)).status, 200);
});

test("when the host steps away mid-game, a present player becomes host", async () => {
  const { people: [d, e], room: lobby } = await table("Dana", "Eli");
  const room = (await api("start", { version: lobby.version }, d.token)).data;
  await api("leave", { version: room.version }, d.token);
  const seen = (await api("state", null, e.token)).data;
  assert.equal(seen.host, e.id);
  assert.equal(seen.players.find((p) => p.id === d.id).away, true);
});

test("a long-poll request returns at once when the table is already newer", async () => {
  const { people: [a], room } = await table("Fay");
  const started = Date.now();
  const res = await api(`state?since=${room.version - 1}`, null, a.token);
  assert.equal(res.status, 200);
  assert.equal(res.data.version, room.version);
  assert(Date.now() - started < 1000);
});

test("a long-poll request wakes as soon as someone else changes the table (#19)", async () => {
  const { people: [g], room } = await table("Gus");
  const h = await login("Hana");
  const started = Date.now();
  const pending = api(`state?since=${room.version}`, null, g.token);
  await new Promise((r) => setTimeout(r, 100));
  await api("join", { code: room.code }, h.token);
  const res = await pending;
  assert.equal(res.status, 200);
  assert.equal(res.data.version, room.version + 1);
  assert(res.data.players.some((p) => p.name === "Hana"), "the waiting player sees the newcomer");
  assert(Date.now() - started < 2000, "it answered on the change, not on the timeout");
});

test("a long-poll request returns unchanged state when nothing happens", async () => {
  const saved = config.longPollMs;
  config.longPollMs = 150;
  try {
    const { people: [i], room } = await table("Ida");
    const started = Date.now();
    const res = await api(`state?since=${room.version}`, null, i.token);
    assert.equal(res.status, 200);
    assert.equal(res.data.version, room.version);
    assert(Date.now() - started >= 140);
  } finally {
    config.longPollMs = saved;
  }
});

test("a long-poll request learns when its table is removed", async () => {
  const { people: [j], room } = await table("Jo");
  const pending = api(`state?since=${room.version}`, null, j.token);
  await new Promise((r) => setTimeout(r, 100));
  await api("reset-rooms", { password: "deletor" });
  const res = await pending;
  assert.equal(res.status, 400);
  assert.equal(res.data.error, "Join a table first.");
});

test("static files: folders are not found, malformed URLs are bad requests, the favicon exists (#22)", async () => {
  const get = (path) => fetch(new URL(path, base));
  const folder = await get("/art/");
  assert.equal(folder.status, 404);
  assert.deepEqual(await folder.json(), { error: "Not found." });
  const malformed = await get("/%E0%A4%A");
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "Bad request." });
  const icon = await get("/favicon.png");
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/png");
  await icon.arrayBuffer();
});

test("open tables list only unstarted lobbies with public codes and counts", async () => {
  const { people, room } = await table("Cloud host", "Cloud guest");
  const listed = (await api("tables")).data.tables.find((t) => t.code === room.code);
  assert.deepEqual(listed, { code: room.code, players: 2 });
  await api("start", { version: room.version }, people[0].token);
  assert.equal((await api("tables")).data.tables.some((t) => t.code === room.code), false);
  const { people: [solo], room: emptySoon } = await table("Leaving cloud");
  await api("leave", { version: emptySoon.version }, solo.token);
  assert.equal((await api("tables")).data.tables.some((t) => t.code === emptySoon.code), false);
  const full = await table("Full host", "Seat 2", "Seat 3", "Seat 4", "Seat 5");
  assert.equal((await api("tables")).data.tables.some((t) => t.code === full.room.code), false);
});

test("host timer broadcasts, expires a turn, and enables kicking after two timeouts", async () => {
  const oldSecond = config.turnSecondMs;
  config.turnSecondMs = 4;
  try {
    const { people: [host, guest], room: lobby } = await table("Timer host", "Timer guest");
    assert.equal(lobby.timer, 0);
    assert.equal((await api("timer", { version: lobby.version, seconds: 30 }, guest.token)).status, 400);
    let state = (await api("timer", { version: lobby.version, seconds: 30 }, host.token)).data;
    assert.equal(state.timer, 30);
    assert.equal((await api("state", null, guest.token)).data.timer, 30);
    state = (await api("start", { version: state.version }, host.token)).data;
    assert(state.deadline > Date.now());
    const firstDeadline = state.deadline;
    state = (await api("timer", { version: state.version, seconds: 60 }, host.token)).data;
    assert(state.deadline > firstDeadline);
    state = (await api("timer", { version: state.version, seconds: 30 }, host.token)).data;
    let guestTimeouts = 0;
    for (let n = 0; n < 10 && guestTimeouts < 2; n++) {
      const next = await api(`state?since=${state.version}`, null, host.token);
      assert.equal(next.status, 200);
      state = next.data;
      guestTimeouts = state.players.find((p) => p.id === guest.id).timeouts;
    }
    assert(guestTimeouts >= 2, "the absent guest timed out twice");
    assert(state.game.events.some((e) => e.type === "lay" && e.timeout));
    state = (await api("timer", { version: state.version, seconds: 0 }, host.token)).data;
    assert.equal(state.deadline, null);
    assert.equal((await api("kick", { version: state.version, playerId: host.id }, host.token)).status, 400);
    const kicked = await api("kick", { version: state.version, playerId: guest.id }, host.token);
    assert.equal(kicked.status, 200);
    assert.equal(kicked.data.players.find((p) => p.id === guest.id).kicked, true);
    assert.equal(kicked.data.game.players.length, 1);
    const excluded = await api("state", null, guest.token);
    assert.equal(excluded.status, 400);
    assert.match(excluded.data.error, /host removed you/);
    assert.equal((await api("join", { create: true }, guest.token)).status, 200);
  } finally {
    config.turnSecondMs = oldSecond;
  }
});
