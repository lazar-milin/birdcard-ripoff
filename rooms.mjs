// Room rules: seats, host, and the lobby → playing → finished cycle.
// Every transition is pure, like move() in game.mjs. It returns a new room,
// returns null when the room closes, or throws an Error whose message is
// shown to the player. The server stores the result and bumps the version.
import { start as deal, move } from "./game.mjs";

export const MAX_SEATS = 5;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const seat = (player) => ({ id: player.id, name: player.name });
const present = (room) => room.players.filter((p) => !p.away);

// "lobby" before the first game, "playing" during one, "finished" after one ends.
export function phase(room) {
  if (!room.game) return "lobby";
  return room.game.phase === "over" ? "finished" : "playing";
}

// The host always holds a seat, and is present whenever anyone is.
function withHost(room) {
  const host = room.players.find((p) => p.id === room.host);
  if (host && !host.away) return room;
  const next = present(room)[0] ?? host ?? room.players[0];
  return { ...room, host: next.id };
}

// An empty room closes.
const settle = (room) => (room.players.length ? withHost(room) : null);

export function createRoom(code, player) {
  return { code, host: player.id, players: [seat(player)], game: null };
}

// Returns the same room when nothing changes, such as a present player joining again.
export function join(room, player) {
  const mine = room.players.find((p) => p.id === player.id);
  if (mine) {
    if (!mine.away) return room;
    return withHost({
      ...room,
      players: room.players.map((p) => (p.id === player.id ? seat(p) : p)),
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

export function play(room, playerId, action) {
  assert(room.game, "Start the game first.");
  return { ...room, game: move(room.game, playerId, action) };
}

// The code of another table where this player holds a seat in an unfinished game.
export function unfinishedSeat(rooms, playerId, exceptCode) {
  for (const room of rooms)
    if (
      room.code !== exceptCode &&
      phase(room) === "playing" &&
      room.players.some((p) => p.id === playerId)
    )
      return room.code;
  return null;
}
