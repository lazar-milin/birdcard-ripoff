import test from "node:test";
import assert from "node:assert/strict";
import { shouldAutoEnd } from "./public/js/auto-turn.js";

function room(event, hand = ["duck-1", "robin-1"]) {
  return { you: "me", game: { phase: "flock", turn: 0,
    players: [{ id: "me", hand }],
    events: [{ type: "turn", player: "me" }, { player: "me", ...event }] } };
}
test("auto end at the flock step with no available flock, including skipped draws", () => {
  assert.equal(shouldAutoEnd(room({ type: "draw", skipped: false })), true);
  assert.equal(shouldAutoEnd(room({ type: "capture" })), true);
  assert.equal(shouldAutoEnd(room({ type: "draw", skipped: true })), true);
  assert.equal(shouldAutoEnd(room({ type: "capture" }, ["flamingo-1", "flamingo-2"])), false);
  assert.equal(shouldAutoEnd(room({ type: "capture" }, [])), false);
});
test("never auto end another player's turn or an unresolved step", () => {
  const r = room({ type: "capture" });
  r.you = "other";
  assert.equal(shouldAutoEnd(r), false);
  r.you = "me";
  for (const phase of ["lay", "draw", "over"]) {
    r.game.phase = phase;
    assert.equal(shouldAutoEnd(r), false);
  }
  assert.equal(shouldAutoEnd(null), false);
});
