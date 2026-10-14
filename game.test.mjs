import test from "node:test";
import assert from "node:assert/strict";
import { start, move, view } from "./game.mjs";
import { SPECIES } from "./public/species.js";
const players = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" },
];
function fixture() {
  const g = start(players);
  g.turn = 0;
  return g;
}
function all(g) {
  return [
    ...g.deck,
    ...g.discard,
    ...g.rows.flat(),
    ...g.players.flatMap((p) => [...p.hand, ...p.collection]),
  ];
}
test("setup preserves all 110 cards and private hands", () => {
  const g = start(players);
  assert.equal(all(g).length, 110);
  assert(g.rows.every((r) => new Set(r).size === 3));
  assert.equal(g.players[0].hand.length, 8);
  assert.equal(view(g, "a").players[1].hand, undefined);
  assert.equal(view(g, "a").deck, undefined);
  for (const s of SPECIES)
    assert.equal(all(g).filter((c) => c === s.id).length, s.count);
});
test("capture stops at nearest match and lays every matching hand card", () => {
  const g = fixture();
  g.players[0].hand = ["owl", "owl", "duck"];
  g.rows[0] = ["robin", "parrot", "owl", "duck", "owl"];
  const n = move(g, "a", { type: "lay", bird: "owl", row: 0, side: "left" });
  assert.deepEqual(n.rows[0], ["owl", "owl", "owl", "duck", "owl"]);
  assert.deepEqual(n.players[0].hand, ["duck", "robin", "parrot"]);
  assert.equal(n.phase, "flock");
  assert.deepEqual(g.players[0].hand, ["owl", "owl", "duck"]);
});
test("right capture refills automatically until a second species appears", () => {
  let g = fixture();
  g.players[0].hand = ["owl", "duck"];
  g.rows[0] = ["owl", "robin"];
  g.deck = ["duck", "owl"];
  g = move(g, "a", { type: "lay", bird: "owl", row: 0, side: "right" });
  assert.deepEqual(g.rows[0], ["owl", "owl", "owl", "duck"]);
  assert.equal(g.phase, "flock");
  assert.equal(g.deck.length, 0);
});
test("draw choice can rescue empty hand; skip starts a round with same player", () => {
  let g = fixture();
  g.players[0].hand = ["owl"];
  g.rows[0] = ["duck", "robin", "parrot"];
  g = move(g, "a", { type: "lay", bird: "owl", row: 0, side: "left" });
  assert.equal(g.phase, "draw");
  const drawn = move(g, "a", { type: "draw", take: true });
  assert.equal(drawn.players[0].hand.length, 2);
  assert.equal(drawn.round, 1);
  const skipped = move(g, "a", { type: "draw", take: false });
  assert.equal(skipped.round, 2);
  assert.equal(skipped.turn, 0);
  assert.equal(skipped.players[0].hand.length, 8);
});
test("big flock uses all cards and awards two; win precedes redeal", () => {
  const g = fixture();
  g.phase = "flock";
  g.players[0].hand = Array(5).fill("owl");
  g.players[0].collection = ["owl", "flamingo", "flamingo", "flamingo"];
  const n = move(g, "a", { type: "flock", bird: "owl" });
  assert.equal(n.phase, "over");
  assert.deepEqual(n.winners, ["a"]);
  assert.equal(n.players[0].collection.filter((c) => c === "owl").length, 3);
  assert.equal(n.discard.length - g.discard.length, 3);
});
test("insufficient redeal awards tied largest collections", () => {
  const g = fixture();
  g.phase = "flock";
  g.players.forEach((p) => {
    p.hand = [];
    p.collection = ["owl"];
  });
  g.deck = [];
  g.discard = [];
  const n = move(g, "a", { type: "pass" });
  assert.equal(n.phase, "over");
  assert.deepEqual(n.winners, ["a", "b"]);
});
test("reject wrong turns and invalid actions without mutation", () => {
  const g = fixture(),
    before = structuredClone(g);
  assert.throws(() => move(g, "b", { type: "pass" }));
  assert.throws(() => move(g, "a", { type: "flock", bird: "owl" }));
  assert.throws(() =>
    move(g, "a", { type: "lay", row: -1, bird: "owl", side: "left" }),
  );
  assert.deepEqual(g, before);
});
test("random legal games preserve exact deck composition and finish", () => {
  for (let game = 0; game < 20; game++) {
    let g = start(
      Array.from({ length: 1 + (game % 5) }, (_, i) => ({
        id: String(i),
        name: "Player " + i,
      })),
    );
    let steps = 0;
    while (g.phase !== "over" && steps++ < 3000) {
      const p = g.players[g.turn];
      let a;
      if (g.phase === "lay")
        a = {
          type: "lay",
          bird: p.hand[Math.floor(Math.random() * p.hand.length)],
          row: Math.floor(Math.random() * 4),
          side: Math.random() < 0.5 ? "left" : "right",
        };
      if (g.phase === "refill") a = { type: "refill", side: "right" };
      if (g.phase === "draw") a = { type: "draw", take: Math.random() < 0.7 };
      if (g.phase === "flock") {
        const s = SPECIES.find(
          (s) => p.hand.filter((c) => c === s.id).length >= s.small,
        );
        a = s ? { type: "flock", bird: s.id } : { type: "pass" };
      }
      g = move(g, p.id, a);
      assert.equal(all(g).length, 110);
      for (const s of SPECIES)
        assert.equal(all(g).filter((c) => c === s.id).length, s.count);
    }
    assert.equal(g.phase, "over");
  }
});
