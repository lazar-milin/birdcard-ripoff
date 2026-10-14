import test from "node:test";
import assert from "node:assert/strict";
import { start, move, view, newDeck } from "./game.mjs";
import { SPECIES, speciesOf } from "./public/species.js";
const players = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" },
];
let serial = 0;
// Fixture cards get unique ids that can't collide with the real deck, such as "owl-t7".
const cards = (...species) => species.map((s) => `${s}-t${++serial}`);
const kinds = (list) => list.map(speciesOf);
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
const newEvents = (before, after) =>
  after.events.filter((e) => e.seq > before.seq);
test("setup deals 110 uniquely identified cards and keeps hands private", () => {
  const g = start(players);
  assert.equal(all(g).length, 110);
  assert.deepEqual([...all(g)].sort(), newDeck().sort());
  assert(g.rows.every((r) => new Set(kinds(r)).size === 3));
  assert.equal(g.players[0].hand.length, 8);
  assert.equal(view(g, "a").players[1].hand, undefined);
  assert.equal(view(g, "a").deck, undefined);
  for (const s of SPECIES)
    assert.equal(kinds(all(g)).filter((c) => c === s.id).length, s.count);
  assert.deepEqual(
    g.events.map((e) => e.type),
    ["start", "turn"],
  );
});
test("capture stops at nearest match and lays every matching hand card", () => {
  const g = fixture();
  const hand = cards("owl", "owl", "duck");
  const row = cards("robin", "parrot", "owl", "duck", "owl");
  g.players[0].hand = hand;
  g.rows[0] = row;
  const n = move(g, "a", { type: "lay", bird: "owl", row: 0, side: "left" });
  assert.deepEqual(n.rows[0], [hand[0], hand[1], ...row.slice(2)]);
  assert.deepEqual(n.players[0].hand, [hand[2], row[0], row[1]]);
  assert.equal(n.phase, "flock");
  assert.deepEqual(g.players[0].hand, hand);
  const [lay, capture] = newEvents(g, n);
  assert.deepEqual(lay, {
    seq: g.seq + 1,
    type: "lay",
    player: "a",
    species: "owl",
    cards: [hand[0], hand[1]],
    row: 0,
    side: "left",
  });
  assert.deepEqual(capture.cards, [row[0], row[1]]);
});
test("right capture refills automatically until a second species appears", () => {
  let g = fixture();
  const hand = cards("owl", "duck");
  const row = cards("owl", "robin");
  const deck = cards("duck", "owl");
  g.players[0].hand = hand;
  g.rows[0] = row;
  g.deck = deck;
  const before = g;
  g = move(g, "a", { type: "lay", bird: "owl", row: 0, side: "right" });
  assert.deepEqual(kinds(g.rows[0]), ["owl", "owl", "owl", "duck"]);
  assert.equal(g.phase, "flock");
  assert.equal(g.deck.length, 0);
  const events = newEvents(before, g);
  assert.deepEqual(
    events.map((e) => e.type),
    ["lay", "capture", "refill"],
  );
  assert.deepEqual(events[1].cards, [row[1]]);
  assert.deepEqual(events[2].cards, [deck[1], deck[0]]);
});
test("draw choice can rescue empty hand; skip starts a round with same player", () => {
  let g = fixture();
  g.players[0].hand = cards("owl");
  g.rows[0] = cards("duck", "robin", "parrot");
  g = move(g, "a", { type: "lay", bird: "owl", row: 0, side: "left" });
  assert.equal(g.phase, "draw");
  const drawn = move(g, "a", { type: "draw", take: true });
  assert.equal(drawn.players[0].hand.length, 2);
  assert.equal(drawn.round, 1);
  const skipped = move(g, "a", { type: "draw", take: false });
  assert.equal(skipped.round, 2);
  assert.equal(skipped.turn, 0);
  assert.equal(skipped.players[0].hand.length, 8);
  assert.deepEqual(
    newEvents(g, skipped).map((e) => e.type),
    ["draw", "round", "turn"],
  );
});
test("other players see that someone drew, but not which cards", () => {
  let g = fixture();
  g.players[0].hand = cards("owl", "duck");
  g.rows[0] = cards("robin", "parrot", "magpie");
  g = move(g, "a", { type: "lay", bird: "owl", row: 0, side: "left" });
  g = move(g, "a", { type: "draw", take: true });
  const mine = view(g, "a").events.at(-1);
  const theirs = view(g, "b").events.at(-1);
  assert.equal(mine.type, "draw");
  assert.equal(mine.cards.length, 2);
  assert.equal(theirs.count, 2);
  assert.equal("cards" in theirs, false);
});
test("big flock uses all cards and awards two; win precedes redeal", () => {
  const g = fixture();
  g.phase = "flock";
  g.players[0].hand = cards("owl", "owl", "owl", "owl", "owl");
  g.players[0].collection = cards("owl", "flamingo", "flamingo", "flamingo");
  const n = move(g, "a", { type: "flock", bird: "owl" });
  assert.equal(n.phase, "over");
  assert.deepEqual(n.winners, ["a"]);
  assert.equal(n.endReason, "pairs");
  assert.equal(kinds(n.players[0].collection).filter((c) => c === "owl").length, 3);
  assert.equal(n.discard.length - g.discard.length, 3);
  const flock = newEvents(g, n).find((e) => e.type === "flock");
  assert.equal(flock.size, "big");
  assert.equal(flock.kept.length, 2);
  assert.equal(flock.discarded.length, 3);
  assert.deepEqual(newEvents(g, n).at(-1), {
    seq: n.seq,
    type: "over",
    reason: "pairs",
    winners: ["a"],
  });
});
test("seven species wins with its own end reason", () => {
  const g = fixture();
  g.phase = "flock";
  g.players[0].hand = cards("flamingo", "flamingo");
  g.players[0].collection = cards("owl", "toucan", "duck", "parrot", "magpie", "robin");
  const n = move(g, "a", { type: "flock", bird: "flamingo" });
  assert.equal(n.endReason, "species");
});
test("insufficient redeal awards tied largest collections", () => {
  const g = fixture();
  g.phase = "flock";
  g.players.forEach((p) => {
    p.hand = [];
    p.collection = cards("owl");
  });
  g.deck = [];
  g.discard = [];
  const n = move(g, "a", { type: "pass" });
  assert.equal(n.phase, "over");
  assert.deepEqual(n.winners, ["a", "b"]);
  assert.equal(n.endReason, "redeal");
});
test("reject wrong turns and invalid actions without mutation", () => {
  const g = fixture(),
    before = structuredClone(g);
  assert.throws(() => move(g, "b", { type: "pass" }));
  assert.throws(() => move(g, "a", { type: "flock", bird: "owl" }));
  assert.throws(() => move(g, "a", { type: "flock", bird: "__proto__" }));
  assert.throws(() =>
    move(g, "a", { type: "lay", row: -1, bird: "owl", side: "left" }),
  );
  assert.throws(() =>
    move(g, "a", { type: "lay", row: 0, bird: g.players[0].hand[0], side: "left" }),
  );
  assert.deepEqual(g, before);
});
test("random legal games preserve every card id, keep events ordered, and finish", () => {
  const deck = newDeck().sort();
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
          bird: speciesOf(p.hand[Math.floor(Math.random() * p.hand.length)]),
          row: Math.floor(Math.random() * 4),
          side: Math.random() < 0.5 ? "left" : "right",
        };
      if (g.phase === "draw") a = { type: "draw", take: Math.random() < 0.7 };
      if (g.phase === "flock") {
        const s = SPECIES.find(
          (s) => kinds(p.hand).filter((c) => c === s.id).length >= s.small,
        );
        a = s ? { type: "flock", bird: s.id } : { type: "pass" };
      }
      const n = move(g, p.id, a);
      assert.deepEqual([...all(n)].sort(), deck);
      const fresh = newEvents(g, n);
      assert(fresh.length > 0, "every move records at least one event");
      assert(fresh.every((e, i) => e.seq === g.seq + i + 1));
      assert(n.events.length <= 80);
      g = n;
    }
    assert.equal(g.phase, "over");
    assert(["species", "pairs", "redeal"].includes(g.endReason));
  }
});
