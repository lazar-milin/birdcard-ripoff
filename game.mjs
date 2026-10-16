// Before editing, read CLAUDE.md at the repo root, especially "Rules engine" and "Rules conventions".
// The rules engine: pure functions over a plain JSON game state, with no I/O.
import { randomInt } from "node:crypto";
import { SPECIES, speciesOf } from "./public/species.js";

const MAX_EVENTS = 80;

// Every card has a stable id such as "duck-3", so clients can follow it between places.
export const newDeck = () =>
  SPECIES.flatMap((s) =>
    Array.from({ length: s.count }, (_, i) => `${s.id}-${i + 1}`),
  );
export const counts = (cards) =>
  Object.fromEntries(
    SPECIES.map((s) => [
      s.id,
      cards.filter((c) => speciesOf(c) === s.id).length,
    ]),
  );
const ofSpecies = (cards, bird) => cards.filter((c) => speciesOf(c) === bird);
const speciesIn = (cards) => new Set(cards.map(speciesOf)).size;
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
// Events describe each change so clients can animate it and write the table history.
function emit(g, event) {
  g.seq += 1;
  g.events.push({ seq: g.seq, ...event });
  if (g.events.length > MAX_EVENTS) g.events = g.events.slice(-MAX_EVENTS);
}
// Why a collection wins the game, or null when it doesn't.
export function winReason(collection) {
  const c = Object.values(counts(collection));
  if (c.filter((n) => n > 0).length >= 7) return "species";
  if (c.filter((n) => n >= 3).length >= 2) return "pairs";
  return null;
}
export function start(players) {
  assert(players.length >= 1 && players.length <= 5, "You need 1–5 players.");
  const g = {
    id: randomInt(2 ** 31),
    players: players.map((p) => ({ ...p, hand: [], collection: [] })),
    deck: shuffle(newDeck()),
    discard: [],
    rows: [],
    turn: randomInt(players.length),
    phase: "lay",
    round: 1,
    seq: 0,
    events: [],
    winners: [],
    endReason: null,
  };
  const extras = [];
  for (let i = 0; i < 4; i++) {
    const row = [];
    while (row.length < 3) {
      const c = g.deck.pop();
      if (row.some((x) => speciesOf(x) === speciesOf(c))) extras.push(c);
      else row.push(c);
    }
    g.rows.push(row);
  }
  g.deck = shuffle([...g.deck, ...extras]);
  for (const p of g.players) p.hand = take(g, 8);
  for (const p of g.players) p.collection = take(g, 1);
  emit(g, { type: "start", dealer: g.players[g.turn].id });
  emit(g, { type: "turn", player: g.players[g.turn].id, round: 1 });
  return g;
}
function finish(g, reason, winners) {
  g.winners = winners;
  g.endReason = reason;
  g.phase = "over";
  emit(g, { type: "over", reason, winners });
}
function endTurn(g) {
  const p = g.players[g.turn];
  const reason = winReason(p.collection);
  if (reason) return finish(g, reason, [p.id]);
  if (!p.hand.length) {
    const discarded = {};
    for (const player of g.players) {
      discarded[player.id] = player.hand.length;
      g.discard.push(...player.hand.splice(0));
    }
    if (g.deck.length + g.discard.length < 8 * g.players.length) {
      const max = Math.max(...g.players.map((x) => x.collection.length));
      const winners = g.players
        .filter((x) => x.collection.length === max)
        .map((x) => x.id);
      return finish(g, "redeal", winners);
    }
    for (const player of g.players) player.hand = take(g, 8);
    g.round++;
    emit(g, { type: "round", round: g.round, dealer: p.id, discarded });
  } else g.turn = (g.turn + 1) % g.players.length;
  g.phase = "lay";
  emit(g, { type: "turn", player: g.players[g.turn].id, round: g.round });
}
// Apply to a copy so rejected moves never partially alter a live game.
export function move(state, id, action, { timeout = false } = {}) {
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
      cards = ofSpecies(p.hand, bird);
    assert(cards.length > 0, "That bird is not in your hand.");
    p.hand = p.hand.filter((c) => speciesOf(c) !== bird);
    const original = g.rows[action.row];
    const row =
      action.side === "left" ? [...original] : [...original].reverse();
    const match = row.findIndex((c) => speciesOf(c) === bird);
    const captured = match > 0 ? row.splice(0, match) : [];
    row.unshift(...cards);
    g.rows[action.row] = action.side === "left" ? row : row.reverse();
    p.hand.push(...captured);
    emit(g, {
      type: "lay",
      player: p.id,
      species: bird,
      cards,
      row: action.row,
      side: action.side,
      ...(timeout ? { timeout: true } : {}),
    });
    if (captured.length) {
      emit(g, {
        type: "capture",
        player: p.id,
        row: action.row,
        cards: captured,
      });
      const wire = g.rows[action.row];
      if (speciesIn(wire) === 1) {
        const added = [];
        while (speciesIn(wire) < 2) {
          const c = draw(g);
          if (c === undefined) break;
          wire.push(c);
          added.push(c);
        }
        emit(g, { type: "refill", row: action.row, cards: added });
      }
    }
    g.phase = captured.length ? "flock" : "draw";
  } else if (action.type === "draw") {
    assert(g.phase === "draw", "You cannot draw now.");
    assert(typeof action.take === "boolean", "Choose draw or skip.");
    const cards = action.take ? take(g, 2) : [];
    p.hand.push(...cards);
    emit(g, {
      type: "draw",
      player: p.id,
      cards,
      count: cards.length,
      skipped: !action.take,
      ...(timeout ? { timeout: true } : {}),
    });
    g.phase = "flock";
    if (!p.hand.length) endTurn(g);
  } else if (action.type === "flock") {
    assert(g.phase === "flock", "Lay birds and resolve the row first.");
    const s = SPECIES.find((s) => s.id === action.bird),
      cards = s ? ofSpecies(p.hand, s.id) : [];
    assert(s && cards.length >= s.small, "Not enough birds for that flock.");
    const keep = cards.length >= s.big ? 2 : 1;
    const kept = cards.slice(0, keep),
      discarded = cards.slice(keep);
    const speciesBefore = speciesIn(p.collection);
    p.hand = p.hand.filter((c) => speciesOf(c) !== s.id);
    p.collection.push(...kept);
    g.discard.push(...discarded);
    emit(g, {
      type: "flock",
      player: p.id,
      species: s.id,
      size: keep === 2 ? "big" : "small",
      kept,
      discarded,
      ...(speciesBefore < 6 && speciesIn(p.collection) === 6 ? { sixSeven: true } : {}),
    });
    endTurn(g);
  } else if (action.type === "pass") {
    assert(g.phase === "flock" || (g.phase === "lay" && !p.hand.length), "Finish the current step first.");
    emit(g, { type: "pass", player: p.id, ...(timeout ? { timeout: true } : {}) });
    endTurn(g);
  } else throw new Error("Unknown move.");
  return g;
}

// Remove a timed-out player without losing any of the 110 cards. The room
// keeps their seat for the kicked balloon, but the game no longer takes turns
// for them.
function removeFromGame(state, id, reason) {
  const g = structuredClone(state);
  assert(g.phase !== "over", "This game is finished.");
  const index = g.players.findIndex((p) => p.id === id);
  assert(index >= 0, "That player is not in the game.");
  assert(g.players.length > 1, "The last player cannot be kicked.");
  const [player] = g.players.splice(index, 1);
  const hand = player.hand;
  const collection = player.collection;
  g.discard.push(...hand, ...collection);
  emit(g, { type: reason, player: id, hand, collection, cards: [...hand, ...collection] });
  if (index < g.turn) g.turn--;
  else if (index === g.turn) {
    g.turn %= g.players.length;
    g.phase = "lay";
    emit(g, { type: "turn", player: g.players[g.turn].id, round: g.round });
  }
  return g;
}
export const kick = (state, id) => removeFromGame(state, id, "kick");
export const spectate = (state, id) => removeFromGame(state, id, "spectate");
// Cards another player drew stay hidden; everything else in an event is public.
function redact(event, id) {
  if (event.type !== "draw" || event.player === id) return event;
  const { cards, ...rest } = event;
  return rest;
}
export function view(g, id) {
  return {
    id: g.id,
    players: g.players.map(({ hand, ...p }) => ({
      ...p,
      handCount: hand.length,
      ...(p.id === id ? { hand } : {}),
    })),
    rows: g.rows,
    turn: g.turn,
    phase: g.phase,
    round: g.round,
    seq: g.seq,
    events: g.events.map((e) => redact(e, id)),
    winners: g.winners,
    endReason: g.endReason,
    deckCount: g.deck.length,
    discardCount: g.discard.length,
    discardSpecies: counts(g.discard),
  };
}
