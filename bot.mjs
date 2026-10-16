// Before editing, read CLAUDE.md at the repo root, especially "Rules engine".
// Bot decisions use the same redacted view a player receives, never the deck or other hands.
import { view } from "./game.mjs";
import { SPECIES, speciesOf } from "./public/species.js";

const count = (cards, bird) => cards.filter((card) => speciesOf(card) === bird).length;
const variety = (cards) => new Set(cards.map(speciesOf)).size;
const pick = (options, rng) => options.reduce((best, option) => {
  const score = option.score + rng() * 2.5;
  return score > best.score ? { action: option.action, score } : best;
}, { score: -Infinity }).action;

export function chooseBotAction(game, id, rng = Math.random) {
  const visible = view(game, id);
  const actor = visible.players[visible.turn];
  if (actor?.id !== id || visible.phase === "over") return null;
  const hand = actor.hand;
  if (visible.phase === "draw") return { type: "draw", take: true };
  if (visible.phase === "flock") {
    const options = SPECIES.filter((bird) => count(hand, bird.id) >= bird.small).map((bird) => {
      const have = count(actor.collection, bird.id);
      const size = count(hand, bird.id) >= bird.big ? 2 : 1;
      const after = [...actor.collection, ...Array(size).fill(`${bird.id}-bot`)];
      const trios = SPECIES.filter((s) => count(after, s.id) >= 3).length;
      const wins = variety(after) >= 7 || trios >= 2;
      return { action: { type: "flock", bird: bird.id }, score: size * 2 + (have === 0 ? 3 : have === 2 ? 5 : 0) + (wins ? 100 : 0) };
    });
    // Keeping cards can be better than repeating a flock already well represented
    // in the collection. A new species or a winning flock still dominates.
    if (options.length) options.push({ action: { type: "pass" }, score: 2.5 });
    return options.length ? pick(options, rng) : { type: "pass" };
  }
  const options = [];
  for (const bird of SPECIES) {
    const laying = count(hand, bird.id);
    if (!laying) continue;
    for (let row = 0; row < visible.rows.length; row++) for (const side of ["left", "right"]) {
      const wire = side === "left" ? visible.rows[row] : [...visible.rows[row]].reverse();
      const match = wire.findIndex((card) => speciesOf(card) === bird.id);
      const captured = match > 0 ? wire.slice(0, match) : [];
      const result = [...hand.filter((card) => speciesOf(card) !== bird.id), ...captured];
      const ready = SPECIES.filter((s) => count(result, s.id) >= s.small).length;
      const newSpecies = captured.filter((card) => !hand.some((held) => speciesOf(held) === speciesOf(card))).length;
      options.push({ action: { type: "lay", bird: bird.id, row, side },
        score: captured.length * 2.2 + ready * 3 + newSpecies * 1.3 + (captured.length ? 1 : 0) - (result.length === 0 ? 1 : 0) });
    }
  }
  return options.length ? pick(options, rng) : { type: "pass" };
}
