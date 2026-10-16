// Before editing, read CLAUDE.md at the repo root, especially "Rules engine".
// Bots must make legal, private-information-safe choices through complete games.
import test from "node:test";
import assert from "node:assert/strict";
import { start, move } from "./game.mjs";
import { chooseBotAction } from "./bot.mjs";
import * as Rooms from "./rooms.mjs";

test("bots use only their visible state and can finish a game without a browser", () => {
  let game = start([{ id: "bot-a", name: "Jade Wren", bot: true }, { id: "bot-b", name: "Coral Lark", bot: true }]);
  const rng = () => 0.5;
  for (let steps = 0; steps < 2500 && game.phase !== "over"; steps++) {
    const id = game.players[game.turn].id;
    const action = chooseBotAction(game, id, rng);
    assert.ok(action, `missing action in ${game.phase}`);
    if (steps === 0) {
      const hidden = structuredClone(game);
      hidden.deck.reverse();
      hidden.players.find((p) => p.id !== id).hand.reverse();
      assert.deepEqual(chooseBotAction(hidden, id, rng), action);
    }
    game = move(game, id, action);
  }
  assert.equal(game.phase, "over");
  assert.ok(game.winners.length);
});

test("equally useful legal lays vary with a controlled random source", () => {
  const game = start([{ id: "bot", name: "Jade Wren", bot: true }]);
  game.players[0].hand = ["flamingo-1"];
  game.rows = Array.from({ length: 4 }, (_, i) => [`duck-${i + 1}`]);
  const first = chooseBotAction(game, "bot", () => 0);
  let calls = 0;
  const another = chooseBotAction(game, "bot", () => ++calls === 8 ? 1 : 0);
  assert.equal(first.type, "lay");
  assert.equal(another.type, "lay");
  assert.notDeepEqual(first, another);
});

test("a bot with no cards advances a round instead of stalling", () => {
  const game = start([{ id: "bot", name: "Jade Wren", bot: true }]);
  game.players[0].hand = [];
  const action = chooseBotAction(game, "bot", () => 0);
  assert.deepEqual(action, { type: "pass" });
  assert.notEqual(move(game, "bot", action).seq, game.seq);
});

test("bot seats are host-controlled, retain identity in rematches, and never become host", () => {
  let room = Rooms.createRoom("TEST", { id: "human", name: "Human" });
  assert.throws(() => Rooms.addBot(room, "other", { id: "bot-1", name: "Jade Wren", bot: true }), /host/);
  room = Rooms.addBot(room, "human", { id: "bot-1", name: "Jade Wren", bot: true });
  assert.equal(room.players[1].bot, true);
  assert.throws(() => Rooms.join(room, { id: "bot-fake", name: "Fake", bot: true }), /host/);
  const game = Rooms.start(room, "human");
  assert.equal(game.game.players[1].bot, true);
  assert.throws(() => Rooms.removeBot(game, "human", "bot-1"), /before/);
  const finished = { ...game, game: { ...game.game, phase: "over" } };
  assert.equal(Rooms.start(finished, "human").players[1].bot, true);
  assert.equal(Rooms.leave(game, "human").room, null, "the last human leaving closes a bot-only room");
  room = Rooms.removeBot(room, "human", "bot-1");
  assert.equal(room.players.length, 1);
  for (let i = 0; i < 4; i++) room = Rooms.addBot(room, "human", { id: `bot-${i}`, name: `Bot ${i}`, bot: true });
  assert.throws(() => Rooms.addBot(room, "human", { id: "extra", name: "Extra", bot: true }), /full/);
});
