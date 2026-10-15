import { SPECIES, speciesOf } from "../species.js";

export function shouldAutoEnd(room) {
  const g = room?.game;
  if (!g || g.phase !== "flock" || g.players[g.turn]?.id !== room.you) return false;
  const hand = g.players[g.turn].hand;
  if (!hand?.length) return false;
  if (SPECIES.some((s) => hand.filter((c) => speciesOf(c) === s.id).length >= s.small)) return false;
  // The flock phase is already the resolved lay/draw step, including skipped draws.
  return true;
}
