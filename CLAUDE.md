# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser card game that implements the CuBirds rules for 1–5 players, playable locally or as a Discord Activity. Plain Node.js (22+) with no framework and no runtime dependencies on the server. The client is vanilla ES modules served as static files with no build step.

## Commands

```sh
node server.mjs                 # Run locally at http://127.0.0.1:3000 (no npm install needed)
npm start                       # Same, but loads .env if present (Discord credentials, HOST, PORT)
node --test                     # Run all tests (game.test.mjs and server.test.mjs)
node --test game.test.mjs       # Run one test file
node --test --test-name-pattern="capture" game.test.mjs   # Run tests whose name matches
npm install && npm run build    # Regenerate public/discord-sdk.js from @discord/embedded-app-sdk
```

To playtest multiplayer locally, open the game in two browser tabs. Each tab keeps its own session in `sessionStorage`.

## Architecture

Three layers share one species table, `public/species.js`. It holds card counts, small and big flock thresholds, colors, and image paths, and is imported by both the server engine and the browser client.

**Rules engine (`game.mjs`)** is pure and holds no I/O. Game state is a plain JSON object.
- `start(players)` deals the table. `move(state, playerId, action)` returns a new state from a `structuredClone`, so a rejected move never mutates the live game. `view(state, playerId)` returns the redacted state for one player.
- Rejections are thrown `Error`s whose messages are shown verbatim to the player.
- A turn moves through phases: `lay`, then `draw` only when the lay captured nothing, then `flock`. `endTurn()` checks for a win first, then ends the round if the active player's hand is empty, otherwise advances the turn.
- Actions are `{type:'lay', bird, row, side}`, `{type:'draw', take}`, `{type:'flock', bird}`, and `{type:'pass'}`.

**Server (`server.mjs`)** is one `node:http` server with all state in memory: `rooms`, `sessions`, and per-IP rate `limits`. Rooms and sessions expire after 24 hours and are lost on restart, so run a single process.
- It exports `server` and only calls `listen()` when run directly. `server.test.mjs` uses this to listen on an ephemeral port.
- Every mutating POST must send the room's current `version`. A mismatch returns 409, which is how stale or double-clicked moves are rejected. Each successful change increments `room.version`.
- Clients only ever receive `view()` output through `snapshot()`. Never send raw game state, because it contains every hand and the deck.
- Login is either a guest name (allowed unless `ALLOW_GUESTS=false` or `NODE_ENV=production`) or a Discord OAuth code exchanged server-side using `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
- Leaving a running game marks the seat `away` and keeps the hand. Leaving a lobby or a finished game removes the seat and transfers host.
- `/api/reset-rooms` wipes every room and is only enabled when guests are allowed.

**Client (`public/app.js`)** keeps one `state` snapshot and a `render()` that rebuilds `#app` with `innerHTML` on every change, then rebinds handlers. It polls `GET /api/state` once per second and re-renders when `version` changes. Polling is used instead of WebSockets so traffic stays same-origin through Discord's Activity proxy. Discord mode is detected by a `frame_id` query parameter.

`public/discord-sdk.js` is a generated esbuild bundle. Don't edit it by hand; regenerate it with `npm run build`.

## Rules conventions

The engine follows the CuBirds rulebook, with these deliberate choices where the printed rules are terse (see README.md):
- A single-species row refills automatically on the right. With one species in the row this is mirror-equivalent to the left.
- After a no-capture lay that empties the hand, the player may still draw two before the round ends, following the Board Game Arena implementation.
- The discard pile reshuffles into the deck whenever a draw needs a card. If both are empty mid-turn, the player draws what's available. A redeal that can't give everyone eight cards ends the game, and the largest collection wins with ties shared.
- Solo play (one seat) is allowed for testing, though CuBirds is a 2–5 player game.

`game.test.mjs` includes a randomized full-game test that asserts all 110 cards and per-species counts are conserved after every move. Keep it passing when changing the engine.
