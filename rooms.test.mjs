// Before editing, read CLAUDE.md at the repo root, especially "Room rules".
// Room rule tests, including the randomized test of the seat and host invariants.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoom, join, leave, start, play, phase, unfinishedSeat, setTimer, timeout, kick, spectate, takeSeat, MAX_SEATS } from "./rooms.mjs";
import { SPECIES, speciesOf } from "./public/species.js";

const P = (id) => ({ id, name: id.toUpperCase() });
const ids = (room) => room.players.map((p) => p.id);
const lobby = (...names) => names.slice(1).reduce((r, n) => join(r, P(n)), createRoom("ROOM", P(names[0])));
// Finishes a running game by declaring a winner, as move() would.
const finish = (room) => ({ ...room, game: { ...room.game, phase: "over", winners: [room.game.players[0].id] } });

test("verified Discord identity stays with a seat through games and rematches", () => {
  const discordPlayer = { ...P("a"), discord: true };
  let room = join(createRoom("ROOM", discordPlayer), P("b"));
  assert.deepEqual(room.players.map((p) => p.discord), [true, false]);
  room = start(room, "a");
  assert.deepEqual(room.players.map((p) => p.discord), [true, false]);
  room = start(finish(room), "a");
  assert.deepEqual(room.players.map((p) => p.discord), [true, false]);
});

test("the creator hosts a new lobby", () => {
  const room = createRoom("ROOM", P("a"));
  assert.equal(room.host, "a");
  assert.deepEqual(ids(room), ["a"]);
  assert.equal(phase(room), "lobby");
});

test("only the host sets a supported timer, including in the lobby", () => {
  const room = lobby("a", "b");
  assert.equal(room.timer, 0);
  assert.throws(() => setTimer(room, "b", 30), /Only the host/);
  assert.throws(() => setTimer(room, "a", 12), /Choose/);
  assert.equal(setTimer(room, "a", 30).timer, 30);
  assert.equal(setTimer(room, "a", 60).timer, 60);
  assert.equal(setTimer(room, "a", 0), room);
});

test("timeouts resolve lay, draw and flock, count once, and allow a host kick", () => {
  let room = start(lobby("a", "b"), "a");
  room.game.turn = 1;
  const before = [
    ...room.game.deck, ...room.game.discard, ...room.game.rows.flat(),
    ...room.game.players.flatMap((p) => [...p.hand, ...p.collection]),
  ].sort();
  room = timeout(room);
  assert.equal(room.players[1].timeouts, 1);
  assert.equal(room.players[1].timedOut, true);
  assert.equal(room.game.phase, "lay");
  assert.equal(room.game.players[room.game.turn].id, "a");
  assert(room.game.events.some((e) => e.type === "lay" && e.timeout));
  assert.throws(() => kick(room, "a", "b"), /cannot be kicked yet/);
  const nextTurn = play({ ...room, game: { ...room.game, phase: "flock" } }, "a", { type: "pass" });
  assert.equal(nextTurn.game.players[nextTurn.game.turn].id, "b");
  assert.equal(nextTurn.players[1].timedOut, false, "the badge clears on the player's next turn");
  room.game.turn = 1;
  room.game.phase = "draw";
  room = timeout(room);
  assert.equal(room.players[1].timeouts, 2);
  assert(room.game.events.some((e) => e.type === "draw" && e.timeout && e.skipped));
  room.game.turn = 1;
  room.game.phase = "flock";
  room = timeout(room);
  assert.equal(room.players[1].timeouts, 3);
  assert(room.game.events.some((e) => e.type === "pass" && e.timeout));
  assert.throws(() => kick(room, "b", "a"), /Only the host/);
  assert.throws(() => kick(room, "a", "a"), /cannot kick themselves/);
  const kicked = kick(room, "a", "b");
  assert.equal(kicked.players[1].kicked, true);
  assert.equal(kicked.game.players.length, 1);
  assert.deepEqual([
    ...kicked.game.deck, ...kicked.game.discard, ...kicked.game.rows.flat(),
    ...kicked.game.players.flatMap((p) => [...p.hand, ...p.collection]),
  ].sort(), before);
  assert.throws(() => join(kicked, P("b")), /removed/);
  assert.equal(unfinishedSeat([kicked], "b", "OTHER"), null);
  assert.equal(start(finish(kicked), "a").players.length, 1);
});

test("a lobby seats up to five players", () => {
  const room = lobby("a", "b", "c", "d", "e");
  assert.equal(room.players.length, MAX_SEATS);
  const watching = join(room, P("f"));
  assert.equal(watching.players.length, MAX_SEATS);
  assert.equal(watching.spectators[0].id, "f");
  assert.throws(() => takeSeat(watching, "f"), /full/);
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

test("newcomers watch mid-game and can sit down once it ends (#16)", () => {
  const running = start(lobby("a", "b"), "a");
  assert.equal(phase(running), "playing");
  const watching = join(running, P("c"));
  assert.equal(watching.players.length, 2);
  assert.equal(watching.spectators[0].id, "c");
  const done = finish(running);
  const seated = join(done, P("c"));
  assert.deepEqual(ids(seated), ["a", "b", "c"]);
  assert.equal(seated.game, done.game, "the finished game stays on the table");
});

test("spectator pool preserves lobby seats and lets watchers return when space opens", () => {
  let room = lobby("a", "b");
  assert.throws(() => spectate(room, "a"), /host/);
  room = spectate(room, "b");
  assert.deepEqual(ids(room), ["a"]);
  assert.deepEqual(room.spectators.map((p) => p.id), ["b"]);
  room = join(room, P("c"), { spectate: true });
  assert.deepEqual(room.spectators.map((p) => p.id), ["b", "c"]);
  room = takeSeat(room, "b");
  assert.deepEqual(ids(room), ["a", "b"]);
  assert.deepEqual(room.spectators.map((p) => p.id), ["c"]);
  room = leave(room, "c").room;
  assert.deepEqual(room.spectators, []);
  room = join(room, P("c"), { spectate: true });
  assert.equal(room.spectators[0].id, "c");
  const running = start(room, "a");
  assert.throws(() => takeSeat(running, "c"), /game ends/);
  assert.equal(takeSeat(finish(running), "c").players.at(-1).id, "c");
});

test("switching to spectate during play discards cards and advances an active turn", () => {
  const room = start(lobby("a", "b"), "a");
  const all = [...room.game.deck, ...room.game.discard, ...room.game.rows.flat(),
    ...room.game.players.flatMap((p) => [...p.hand, ...p.collection])].sort();
  const watching = spectate(room, "b");
  assert.deepEqual(ids(watching), ["a"]);
  assert.equal(watching.spectators[0].id, "b");
  assert.equal(watching.game.events.at(-1).type, room.game.players[room.game.turn].id === "b" ? "turn" : "spectate");
  assert(watching.game.events.some((e) => e.type === "spectate" && e.player === "b"));
  assert.deepEqual([...watching.game.deck, ...watching.game.discard, ...watching.game.rows.flat(),
    ...watching.game.players.flatMap((p) => [...p.hand, ...p.collection])].sort(), all);
  assert.throws(() => play(watching, "b", { type: "pass" }), /turn/);
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
