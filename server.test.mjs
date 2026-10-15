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
