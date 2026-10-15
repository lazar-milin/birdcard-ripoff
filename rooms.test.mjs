import test from "node:test";
import assert from "node:assert/strict";
import { createRoom, join, leave, start, play, phase, unfinishedSeat, MAX_SEATS } from "./rooms.mjs";
import { SPECIES, speciesOf } from "./public/species.js";

const P = (id) => ({ id, name: id.toUpperCase() });
const ids = (room) => room.players.map((p) => p.id);
const lobby = (...names) => names.slice(1).reduce((r, n) => join(r, P(n)), createRoom("ROOM", P(names[0])));
// Finishes a running game by declaring a winner, as move() would.
const finish = (room) => ({ ...room, game: { ...room.game, phase: "over", winners: [room.game.players[0].id] } });

test("the creator hosts a new lobby", () => {
  const room = createRoom("ROOM", P("a"));
  assert.equal(room.host, "a");
  assert.deepEqual(ids(room), ["a"]);
  assert.equal(phase(room), "lobby");
});

test("a lobby seats up to five players", () => {
  const room = lobby("a", "b", "c", "d", "e");
  assert.equal(room.players.length, MAX_SEATS);
  assert.throws(() => join(room, P("f")), /full/);
  assert.equal(join(room, P("c")), room, "joining again changes nothing");
});

test("leaving a lobby hands the host on, and the last player closes the room (#14)", () => {
  let room = lobby("a", "b");
  room = leave(room, "a").room;
  assert.equal(room.host, "b");
  assert.deepEqual(ids(room), ["b"]);
  const { room: closed, saved } = leave(room, "b");
  assert.equal(closed, null);
  assert.equal(saved, false);
});

test("newcomers can't join mid-game but can sit down once it ends (#16)", () => {
  const running = start(lobby("a", "b"), "a");
  assert.equal(phase(running), "playing");
  assert.throws(() => join(running, P("c")), /already started/);
  const done = finish(running);
  const seated = join(done, P("c"));
  assert.deepEqual(ids(seated), ["a", "b", "c"]);
  assert.equal(seated.game, done.game, "the finished game stays on the table");
});

test("leaving a running game keeps the seat, and the host role moves to someone present", () => {
  let room = start(lobby("a", "b", "c"), "a");
  const { room: away, saved } = leave(room, "a");
  assert.equal(saved, true);
  assert.equal(away.players.find((p) => p.id === "a").away, true);
  assert.equal(away.host, "b");
  room = join(away, P("a"));
  assert.equal(room.players.find((p) => p.id === "a").away, undefined);
  assert.equal(room.host, "b", "the returning player doesn't take the host role back");
  assert.equal(room.game, away.game);
});

test("leaving a finished game keeps the result for everyone else (#15)", () => {
  const done = finish(start(lobby("a", "b", "c"), "a"));
  const { room, saved } = leave(done, "c");
  assert.equal(saved, false);
  assert.deepEqual(ids(room), ["a", "b"]);
  assert.equal(room.game, done.game);
  assert(room.game.players.some((p) => p.id === "c"), "the leaver still appears in the result");
  assert.equal(leave(leave(room, "a").room, "b").room, null, "the last player out closes the room");
});

test("a rematch deals in everyone present, including newcomers, and drops away seats", () => {
  let room = start(lobby("a", "b", "c"), "a");
  room = leave(room, "c").room; // c steps away mid-game
  room = join(finish(room), P("d")); // the game ends; d sits down
  const rematch = start(room, "a");
  assert.equal(phase(rematch), "playing");
  assert.deepEqual(ids(rematch), ["a", "b", "d"]);
  assert.deepEqual(rematch.game.players.map((p) => p.id), ["a", "b", "d"]);
});

test("only the host starts, and a running game can't restart", () => {
  const room = lobby("a", "b");
  assert.throws(() => start(room, "b"), /Only the host/);
  assert.throws(() => start(start(room, "a"), "a"), /already running/);
  assert.throws(() => play(room, "a", { type: "pass" }), /Start the game first/);
});

test("an away seat in an unfinished game blocks sitting elsewhere (#17)", () => {
  const running = leave(start(lobby("a", "b"), "a"), "b").room;
  const other = { ...lobby("c"), code: "OTHER" };
  assert.equal(unfinishedSeat([running, other], "b", "OTHER"), "ROOM");
  assert.equal(unfinishedSeat([running, other], "b", "ROOM"), null, "returning to that table is fine");
  assert.equal(unfinishedSeat([finish(running), other], "b", "OTHER"), null, "a finished game doesn't hold anyone");
});

// A legal action for the active player, or null if they are away.
function legalAction(room) {
  const g = room.game;
  const p = g.players[g.turn];
  if (room.players.find((s) => s.id === p.id)?.away) return null;
  if (g.phase === "lay") return { type: "lay", bird: speciesOf(p.hand[Math.floor(Math.random() * p.hand.length)]), row: Math.floor(Math.random() * 4), side: Math.random() < 0.5 ? "left" : "right" };
  if (g.phase === "draw") return { type: "draw", take: Math.random() < 0.7 };
  const s = SPECIES.find((s) => p.hand.filter((c) => speciesOf(c) === s.id).length >= s.small);
  return s ? { type: "flock", bird: s.id } : { type: "pass" };
}

test("random joins, leaves, starts and moves never break the room rules", () => {
  const pool = ["a", "b", "c", "d", "e", "f", "g"];
  for (let run = 0; run < 200; run++) {
    let room = createRoom("ROOM", P("a"));
    for (let step = 0; step < 300 && room; step++) {
      const who = pool[Math.floor(Math.random() * pool.length)];
      const roll = Math.random();
      let next = room;
      try {
        if (roll < 0.3) next = join(room, P(who));
        else if (roll < 0.45) next = leave(room, room.players[Math.floor(Math.random() * room.players.length)].id).room;
        else if (roll < 0.55) next = start(room, room.host);
        else if (room.game && room.game.phase !== "over") {
          const action = legalAction(room);
          if (action) next = play(room, room.game.players[room.game.turn].id, action);
        }
      } catch (e) {
        assert.match(e.message, /full|already started|already running|Only the host|Start the game first|finished/);
        continue;
      }
      if (next === null) {
        assert.equal(room.players.length, 1, "a room only closes when its last player leaves");
        break;
      }
      room = next;
      const seatIds = ids(room);
      assert(seatIds.length >= 1 && seatIds.length <= MAX_SEATS);
      assert.equal(new Set(seatIds).size, seatIds.length, "no duplicate seats");
      const host = room.players.find((p) => p.id === room.host);
      assert(host, "the host holds a seat");
      if (room.players.some((p) => !p.away)) assert(!host.away, "the host is present whenever anyone is");
      if (phase(room) === "playing")
        assert.deepEqual([...seatIds].sort(), room.game.players.map((p) => p.id).sort(), "mid-game seats match the game's players");
      if (phase(room) === "lobby") assert(room.players.every((p) => !p.away), "nobody is away in a lobby");
    }
  }
});

test("table wins accumulate once, survive rematches and keep departed winners", () => {
  let room = start(lobby("a", "b"), "a");
  const win = () => {
    room.game.turn = 0;
    room.game.phase = "flock";
    room.game.players[0].collection = SPECIES.slice(0, 7).map(s => `${s.id}-1`);
    room = play(room, "a", { type: "pass" });
  };
  win();
  assert.equal(room.standings[0].wins, 1);
  assert.throws(() => play(room, "a", { type: "pass" }), /finished/);
  room = start(room, "a");
  win();
  assert.equal(room.standings[0].wins, 2);
  room = leave(room, "a").room;
  assert.equal(room.standings[0].name, "A");
  assert.equal(room.standings[0].wins, 2);
});

test("shared victories credit every winner", () => {
  let room = start(lobby("a", "b"), "a");
  room.game.phase = "flock";
  room.game.deck = []; room.game.discard = [];
  for (const p of room.game.players) { p.hand = []; p.collection = ["owl-1"]; }
  room = play(room, room.game.players[room.game.turn].id, { type: "pass" });
  assert.deepEqual(room.standings.map(p => p.wins), [1, 1]);
});

test("rematch requests are restricted, idempotent and cleared by rematch", async () => {
  const { proposeRematch } = await import("./rooms.mjs");
  let room = start(lobby("a", "b"), "a");
  assert.throws(() => proposeRematch(room, "b"), /Finish/);
  room = finish(room);
  assert.throws(() => proposeRematch(room, "a"), /host/);
  assert.throws(() => proposeRematch(room, "outsider"), /Join/);
  room = proposeRematch(room, "b");
  assert.equal(room.players[1].wantsRematch, true);
  assert.equal(proposeRematch(room, "b"), room);
  room = start(room, "a");
  assert(room.players.every(p => !p.wantsRematch));
});
