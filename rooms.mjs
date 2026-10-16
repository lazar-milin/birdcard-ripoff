// Before editing, read CLAUDE.md at the repo root, especially "Room rules".
// Room rules: seats, host, and the lobby → playing → finished cycle.
// Every transition is pure, like move() in game.mjs. It returns a new room,
// returns null when the room closes, or throws an Error whose message is
// shown to the player. The server stores the result and bumps the version.
import { randomInt } from "node:crypto";
import { speciesOf } from "./public/species.js";
import { start as deal, move, kick as removePlayer } from "./game.mjs";

export const MAX_SEATS = 5;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const seat = (player) => ({ id: player.id, name: player.name, discord: player.discord === true, timeouts: 0 });
const present = (room) => room.players.filter((p) => !p.away && !p.kicked);

// "lobby" before the first game, "playing" during one, "finished" after one ends.
export function phase(room) {
  if (!room.game) return "lobby";
  return room.game.phase === "over" ? "finished" : "playing";
}

// The host always holds a seat, and is present whenever anyone is.
function withHost(room) {
  const host = room.players.find((p) => p.id === room.host);
  if (host && !host.away && !host.kicked) return room;
  const next = present(room)[0] ?? room.players.find((p) => !p.kicked);
  return { ...room, host: next.id };
}

// An empty room closes.
const settle = (room) => (room.players.some((p) => !p.kicked) ? withHost(room) : null);

export function createRoom(code, player) {
  return { code, host: player.id, players: [seat(player)], game: null, standings: [], timer: 0, deadline: null };
}

// Returns the same room when nothing changes, such as a present player joining again.
export function join(room, player) {
  const mine = room.players.find((p) => p.id === player.id);
  if (mine) {
    if (mine.kicked) {
      assert(phase(room) === "finished", "The host removed you from this table.");
      return withHost({ ...room, players: room.players.map((p) => p.id === player.id ? seat(player) : p) });
    }
    if (!mine.away) return room;
    return withHost({
      ...room,
      players: room.players.map((p) => {
        if (p.id !== player.id) return p;
        const { away, ...back } = p;
        return back;
      }),
    });
  }
  // Newcomers can sit down in a lobby or after a game ends, never mid-game.
  assert(phase(room) !== "playing", "This game has already started.");
  assert(room.players.length < MAX_SEATS, "This table is full.");
  return withHost({ ...room, players: [...room.players, seat(player)] });
}

// Leaving a running game keeps the seat and hand for a return. Leaving a lobby or a
// finished table gives up the seat; a finished game stays visible to everyone else.
export function leave(room, playerId) {
  assert(
    room.players.some((p) => p.id === playerId),
    "Join a table first.",
  );
  if (phase(room) === "playing")
    return {
      room: withHost({
        ...room,
        players: room.players.map((p) =>
          p.id === playerId ? { ...p, away: true } : p,
        ),
      }),
      saved: true,
    };
  return {
    room: settle({
      ...room,
      players: room.players.filter((p) => p.id !== playerId),
    }),
    saved: false,
  };
}

// Starts the first game or a rematch with everyone present. Seats of players who
// left a finished game for good are released.
export function start(room, playerId) {
  assert(playerId === room.host, "Only the host can start the game.");
  assert(phase(room) !== "playing", "The game is already running.");
  const players = present(room).map(seat);
  return { ...room, players, game: deal(players) };
}

function withGame(room, game, players = room.players) {
  // A timeout badge lasts until that player next starts a turn.
  const nextTurn = game.events.some((e) => e.seq > room.game.seq && e.type === "turn");
  if (nextTurn && game.phase !== "over") {
    const active = game.players[game.turn].id;
    players = players.map((p) => p.id === active ? { ...p, timedOut: false } : p);
  }
  const standings = (room.standings ?? []).map((p) => ({ ...p }));
  if (room.game.phase !== "over" && game.phase === "over") {
    for (const id of game.winners) {
      const player = game.players.find((p) => p.id === id);
      const entry = standings.find((p) => p.id === id);
      if (entry) { entry.wins++; entry.name = player.name; }
      else standings.push({ ...seat(player), wins: 1 });
    }
  }
  return { ...room, players, game, standings };
}

export function play(room, playerId, action) {
  assert(room.game, "Start the game first.");
  const game = move(room.game, playerId, action);
  return withGame(room, game);
}

export function setTimer(room, playerId, seconds) {
  assert(playerId === room.host, "Only the host can change the timer.");
  assert([0, 30, 60].includes(seconds), "Choose No timer, 30 seconds or 1 minute.");
  return room.timer === seconds ? room : { ...room, timer: seconds };
}

// The server calls this once for an expired step. One timeout always consumes
// the rest of the player's turn, even when that step was draw or flock.
export function timeout(room) {
  assert(room.game && room.game.phase !== "over", "There is no active turn.");
  const actor = room.game.players[room.game.turn];
  let game = room.game;
  if (game.phase === "lay") {
    const birds = [...new Set(actor.hand.map(speciesOf))];
    const bird = birds[randomInt(birds.length)];
    game = move(game, actor.id, {
      type: "lay", bird, row: randomInt(4), side: randomInt(2) ? "right" : "left",
    }, { timeout: true });
  }
  if (game.phase === "draw")
    game = move(game, actor.id, { type: "draw", take: false }, { timeout: true });
  if (game.phase === "flock")
    game = move(game, actor.id, { type: "pass" }, { timeout: true });
  const players = room.players.map((p) => p.id === actor.id
    ? { ...p, timeouts: (p.timeouts ?? 0) + 1, timedOut: true }
    : p);
  return withGame(room, game, players);
}

export function kick(room, hostId, playerId) {
  assert(hostId === room.host, "Only the host can kick a player.");
  assert(hostId !== playerId, "The host cannot kick themselves.");
  assert(phase(room) === "playing", "The game must be running.");
  const target = room.players.find((p) => p.id === playerId);
  assert(target && !target.kicked && (target.timeouts ?? 0) >= 2, "That player cannot be kicked yet.");
  const game = removePlayer(room.game, playerId);
  const players = room.players.map((p) => p.id === playerId
    ? { ...p, kicked: true, away: false, timedOut: false }
    : p);
  return withGame(room, game, players);
}

export function proposeRematch(room, playerId) {
  assert(phase(room) === "finished", "Finish the game before proposing a rematch.");
  assert(room.players.some((p) => p.id === playerId && !p.away), "Join a table first.");
  assert(playerId !== room.host, "The host can start the rematch.");
  if (room.players.find((p) => p.id === playerId).wantsRematch) return room;
  return { ...room, players: room.players.map((p) => p.id === playerId ? { ...p, wantsRematch: true } : p) };
}

// The code of another table where this player holds a seat in an unfinished game.
export function unfinishedSeat(rooms, playerId, exceptCode) {
  for (const room of rooms)
    if (
      room.code !== exceptCode &&
      phase(room) === "playing" &&
      room.players.some((p) => p.id === playerId && !p.kicked)
    )
      return room.code;
  return null;
}
