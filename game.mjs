import { randomInt } from "node:crypto";
import { SPECIES } from "./public/species.js";
export const counts = (cards) =>
  Object.fromEntries(
    SPECIES.map((s) => [s.id, cards.filter((c) => c === s.id).length]),
  );
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function draw(g) {
  if (!g.deck.length) g.deck = shuffle(g.discard.splice(0));
  return g.deck.pop();
}
function take(g, n) {
  const a = [];
  for (let i = 0; i < n; i++) {
    const c = draw(g);
    if (c === undefined) break;
    a.push(c);
  }
  return a;
}
function log(g, message) {
  g.log.push(message);
  g.log = g.log.slice(-20);
}
export function start(players) {
  assert(players.length >= 1 && players.length <= 5, "You need 1–5 players.");
  const g = {
    players: players.map((p) => ({ ...p, hand: [], collection: [] })),
    deck: shuffle(SPECIES.flatMap((s) => Array(s.count).fill(s.id))),
    discard: [],
    rows: [],
    turn: randomInt(players.length),
    phase: "lay",
    round: 1,
    log: [],
    winners: [],
  };
  const extras = [];
  for (let i = 0; i < 4; i++) {
    const row = [];
    while (row.length < 3) {
      const c = g.deck.pop();
      if (row.includes(c)) extras.push(c);
      else row.push(c);
    }
    g.rows.push(row);
  }
  g.deck = shuffle([...g.deck, ...extras]);
  for (const p of g.players) p.hand = take(g, 8);
  for (const p of g.players) p.collection = take(g, 1);
  log(
    g,
    "The table is ready. Collect seven species, or three cards in each of two species.",
  );
  return g;
}
function endTurn(g) {
  const p = g.players[g.turn],
    c = Object.values(counts(p.collection));
  if (
    c.filter((n) => n > 0).length >= 7 ||
    c.filter((n) => n >= 3).length >= 2
  ) {
    g.winners = [p.id];
    g.phase = "over";
    log(g, `${p.name} wins!`);
    return;
  }
  if (!p.hand.length) {
    for (const player of g.players) g.discard.push(...player.hand.splice(0));
    if (g.deck.length + g.discard.length < 8 * g.players.length) {
      const max = Math.max(...g.players.map((x) => x.collection.length));
      g.winners = g.players
        .filter((x) => x.collection.length === max)
        .map((x) => x.id);
      g.phase = "over";
      log(g, "Not enough cards to redeal. Largest collection wins.");
      return;
    }
    for (const player of g.players) player.hand = take(g, 8);
    g.round++;
    log(g, `${p.name} emptied their hand. Everyone receives eight new cards.`);
  } else g.turn = (g.turn + 1) % g.players.length;
  g.phase = "lay";
}
// Apply to a copy so rejected moves never partially alter a live game.
export function move(state, id, action) {
  const g = structuredClone(state),
    p = g.players[g.turn];
  assert(g.phase !== "over", "This game is finished.");
  assert(p.id === id, "Wait for your turn.");
  if (action.type === "lay") {
    assert(g.phase === "lay", "Finish the current step first.");
    assert(
      Number.isInteger(action.row) && action.row >= 0 && action.row < 4,
      "Choose a row.",
    );
    assert(["left", "right"].includes(action.side), "Choose a row end.");
    const bird = action.bird,
      cards = p.hand.filter((c) => c === bird);
    assert(cards.length > 0, "That bird is not in your hand.");
    p.hand = p.hand.filter((c) => c !== bird);
    const original = g.rows[action.row];
    const row =
      action.side === "left" ? [...original] : [...original].reverse();
    const match = row.indexOf(bird);
    const captured = match > 0 ? row.splice(0, match) : [];
    row.unshift(...cards);
    g.rows[action.row] = action.side === "left" ? row : row.reverse();
    p.hand.push(...captured);
    log(
      g,
      `${p.name} played ${cards.length} ${bird} and collected ${captured.length} cards.`,
    );
    if (captured.length && new Set(g.rows[action.row]).size === 1) {
      const refill = g.rows[action.row];
      let added = 0;
      while (new Set(refill).size < 2) {
        const c = draw(g);
        if (c === undefined) break;
        refill.push(c);
        added++;
      }
      log(g, `The wire refilled automatically with ${added} cards.`);
    }
    g.phase = captured.length ? "flock" : "draw";
  } else if (action.type === "draw") {
    assert(g.phase === "draw", "You cannot draw now.");
    assert(typeof action.take === "boolean", "Choose draw or skip.");
    if (action.take) {
      const cards = take(g, 2);
      p.hand.push(...cards);
      log(g, `${p.name} drew ${cards.length} cards.`);
    }
    g.phase = "flock";
    if (!p.hand.length) endTurn(g);
  } else if (action.type === "flock") {
    assert(g.phase === "flock", "Lay birds and resolve the row first.");
    const s = SPECIES.find((s) => s.id === action.bird),
      cards = p.hand.filter((c) => c === action.bird);
    assert(s && cards.length >= s.small, "Not enough birds for that flock.");
    const keep = cards.length >= s.big ? 2 : 1;
    p.hand = p.hand.filter((c) => c !== s.id);
    p.collection.push(...cards.slice(0, keep));
    g.discard.push(...cards.slice(keep));
    log(g, `${p.name} completed a ${s.name} flock, keeping ${keep}.`);
    endTurn(g);
  } else if (action.type === "pass") {
    assert(g.phase === "flock", "Finish the current step first.");
    endTurn(g);
  } else throw new Error("Unknown move.");
  return g;
}
export function view(g, id) {
  return {
    players: g.players.map(({ hand, ...p }) => ({
      ...p,
      handCount: hand.length,
      ...(p.id === id ? { hand } : {}),
    })),
    rows: g.rows,
    turn: g.turn,
    phase: g.phase,
    round: g.round,
    log: g.log,
    winners: g.winners,
    deckCount: g.deck.length,
    discardCount: g.discard.length,
    refillRow: g.refillRow,
  };
}
