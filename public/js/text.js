// Turns game events into readable sentences. Species come back as separate
// parts so the page can show them in their card colors.
import { SPECIES, SPECIES_BY_ID, speciesOf } from "../species.js";

export const plural = (n, word) => `${n} ${n === 1 ? word : word + "s"}`;
const nameOf = (species) => SPECIES_BY_ID[species]?.name ?? species;
const article = (word) => (/^[aeiou]/i.test(word) ? "an" : "a");
const birds = (species, n) => ({
  species,
  text:
    n === 1
      ? `${article(nameOf(species))} ${nameOf(species)}`
      : `${n} ${nameOf(species)}s`,
});

// "a Robin and 2 Parrots", in the order the cards appear.
export function cardList(cards) {
  const tally = new Map();
  for (const c of cards)
    tally.set(speciesOf(c), (tally.get(speciesOf(c)) ?? 0) + 1);
  const parts = [];
  [...tally].forEach(([species, n], i, all) => {
    if (i > 0) parts.push(i === all.length - 1 ? " and " : ", ");
    parts.push(birds(species, n));
  });
  return parts;
}

// ctx is { you, who(id) }. Names a list of players: "Ana, Bo and You".
export function people(ids, ctx) {
  const names = ids.map((id) => ctx.who(id));
  if (names.length < 2) return names[0] ?? "";
  return names.slice(0, -1).join(", ") + " and " + names.at(-1);
}

const ACTIONS = new Set(["lay", "capture", "refill", "draw", "flock", "pass", "round", "kick"]);
export const isAction = (e) => ACTIONS.has(e.type);

// Returns sentence parts for one event, or null for events the history skips.
export function describe(e, ctx) {
  const actor = e.player ?? e.dealer;
  const who = ctx.who(actor);
  const yours = actor === ctx.you;
  switch (e.type) {
    case "start":
      return [yours ? "You deal and play first." : `${who} deals and plays first.`];
    case "lay":
      return [e.timeout ? `Time ran out for ${who}. ` : "", `${who} laid `, birds(e.species, e.cards.length), ` on the ${e.side} end of wire ${e.row + 1}.`];
    case "capture":
      return [`${who} took `, ...cardList(e.cards), "."];
    case "refill":
      return e.cards.length
        ? [`Wire ${e.row + 1} refilled with `, ...cardList(e.cards), "."]
        : [`Wire ${e.row + 1} could not refill because no cards were left.`];
    case "draw":
      if (e.skipped) return [e.timeout ? `Time ran out for ${who}. ` : "", `${who} skipped the draw.`];
      if (!e.count) return [`${who} tried to draw, but no cards were left.`];
      return e.cards
        ? [`${who} drew `, ...cardList(e.cards), "."]
        : [`${who} drew ${plural(e.count, "card")}.`];
    case "flock":
      return [`${who} completed a ${e.size} `, { species: e.species, text: nameOf(e.species) }, ` flock and kept ${e.kept.length}.`];
    case "pass":
      return [e.timeout ? `Time ran out for ${who}. ` : "", `${who} ended ${yours ? "your" : "their"} turn.`];
    case "kick":
      return [`${who} was removed from the table; `, ...cardList(e.cards), " went to the discard pile."];
    case "round":
      return [`${who} emptied ${yours ? "your" : "their"} hand. Round ${e.round} begins, and everyone gets eight new cards.`];
    case "over": {
      const names = people(e.winners, ctx);
      if (e.reason === "species") return [`${names} collected seven species and won.`];
      if (e.reason === "pairs") return [`${names} collected three birds in each of two species and won.`];
      return [`Not enough cards were left for a new round. ${names} won with the largest collection.`];
    }
    default:
      return null;
  }
}

export function headline(game, ctx) {
  const w = game.winners;
  if (w.length > 1) return `Shared victory: ${people(w, ctx)}`;
  return w[0] === ctx.you ? "You win!" : `${ctx.who(w[0])} wins!`;
}

export function reasonText(game) {
  if (game.endReason === "species") return "Seven different species in one collection.";
  if (game.endReason === "pairs") {
    const winner = game.players.find((p) => p.id === game.winners[0]);
    const trios = SPECIES.filter(
      (s) => winner.collection.filter((c) => speciesOf(c) === s.id).length >= 3,
    ).map((s) => s.name);
    return `Three or more birds in each of two species: ${trios.join(" and ")}.`;
  }
  if (game.endReason === "redeal")
    return "Not enough cards were left to deal a new round, so the largest collection wins.";
  return "";
}
