// Shared by sound and motion. Never replay history on a refresh or room switch.
export function changedEvents(prev, next) {
  if (!prev || !next || prev.code !== next.code || !next.game) return [];
  const pg = prev.game, ng = next.game;
  if (!pg || pg.id !== ng.id) return ng.events.filter((e) => e.type === "turn" && e.seq === 2);
  const events = ng.events.filter((e) => e.seq > pg.seq);
  return events.length && events[0].seq === pg.seq + 1 ? events : [];
}
