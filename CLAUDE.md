# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser card game that implements the CuBirds rules for 1–5 players, playable locally or as a Discord Activity. Plain Node.js (22+) with no framework and no runtime dependencies on the server. The client is ES modules served as static files with no build step for our own code; third-party browser libraries are pre-bundled into `public/` and committed.

## Commands

```sh
node server.mjs                 # Run locally at http://127.0.0.1:3000 (no npm install needed)
npm start                       # Same, but loads .env if present (Discord credentials, HOST, PORT)
node --test                     # Run all tests (game.test.mjs and server.test.mjs)
node --test game.test.mjs       # Run one test file
node --test --test-name-pattern="capture" game.test.mjs   # Run tests whose name matches
npm install && npm run build    # Regenerate public/discord-sdk.js and public/vendor/preact.js
node build.mjs preact           # Rebuild only one bundle (targets: discord, preact)
```

To playtest multiplayer locally, open the game in two browser tabs. Each tab keeps its own session in `sessionStorage`.

## Architecture

Three layers share `public/species.js`: the species table (card counts, small and big flock thresholds, colors, image paths) and `speciesOf()`. Both the engine and the browser import it.

**Cards are ids, not species.** Each of the 110 cards is a string such as `duck-3`; use `speciesOf(card)` to get its species. Players still act by species (`{type:'lay', bird:'duck', ...}` lays every duck in hand).

**Rules engine (`game.mjs`)** is pure and holds no I/O. Game state is a plain JSON object.
- `start(players)` deals the table. `move(state, playerId, action)` returns a new state from a `structuredClone`, so a rejected move never mutates the live game. `view(state, playerId)` returns the redacted state for one player.
- Rejections are thrown `Error`s whose messages are shown verbatim to the player.
- A turn moves through phases: `lay`, then `draw` only when the lay captured nothing, then `flock`. `endTurn()` checks for a win first, then ends the round if the active player's hand is empty, otherwise advances the turn.
- Actions are `{type:'lay', bird, row, side}`, `{type:'draw', take}`, `{type:'flock', bird}`, and `{type:'pass'}`.
- Every change appends a typed event to `g.events` with an increasing `seq`, capped at the last 80: `start`, `turn`, `lay`, `capture`, `refill`, `draw`, `flock`, `pass`, `round`, `over`. A finished game also has `endReason` (`species`, `pairs` or `redeal`). `view()` strips card ids from other players' `draw` events; all other event data is public. There is no text log on the server.

**Server (`server.mjs`)** is one `node:http` server with all state in memory: `rooms`, `sessions`, and per-IP rate `limits`. Rooms and sessions expire after 24 hours and are lost on restart, so run a single process.
- It exports `server` and only calls `listen()` when run directly. `server.test.mjs` uses this to listen on an ephemeral port.
- Every mutating POST must send the room's current `version`. A mismatch returns 409, which is how stale or double-clicked moves are rejected. Each successful change increments `room.version`.
- Clients only ever receive `view()` output through `snapshot()`. Never send raw game state, because it contains every hand and the deck.
- Login is either a guest name (allowed unless `ALLOW_GUESTS=false` or `NODE_ENV=production`) or a Discord OAuth code exchanged server-side using `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
- Leaving a running game marks the seat `away` and keeps the hand. Leaving a lobby or a finished game removes the seat and transfers host.
- `/api/reset-rooms` wipes every room and is only enabled when guests are allowed.

**Client (`public/`)** uses Preact with htm, imported from the committed bundle `public/vendor/preact.js`; there is no JSX build.
- `app.js` is the root: boot (including the Discord SDK path, detected by a `frame_id` query parameter), session, actions, and polling. It polls `GET /api/state` once per second, one request at a time, and `accept()` drops any response whose `version` is not newer than what is shown. Polling instead of WebSockets keeps traffic same-origin through Discord's Activity proxy.
- `js/ui.js` holds the components. Cards render keyed by id with a `data-card` attribute; players, piles and collection chips carry `data-player`, `data-pile` and `data-chip` so animations can find them.
- `js/motion.js` animates. `capture()` records every card's position just before new state is applied; `play()` runs in a layout effect after render and flies fixed-position copies of cards from old to new places, using the new events to decide where appearing or vanishing cards come from or go. It does nothing under `prefers-reduced-motion`.
- `js/text.js` turns events into sentences for the table log and turn panel, returning species as separate parts so they can be shown in their colors.

`public/discord-sdk.js` and `public/vendor/preact.js` are generated by `build.mjs`. Don't edit them by hand.

## Rules conventions

The engine follows the CuBirds rulebook, with these deliberate choices where the printed rules are terse (see README.md):
- A single-species row refills automatically on the right. With one species in the row this is mirror-equivalent to the left.
- After a no-capture lay that empties the hand, the player may still draw two before the round ends, following the Board Game Arena implementation. The printed rule ends the round immediately; issue #10 tracks making this a table setting.
- The discard pile reshuffles into the deck whenever a draw needs a card. If both are empty mid-turn, the player draws what's available. A redeal that can't give everyone eight cards ends the game, and the largest collection wins with ties shared.
- Solo play (one seat) is allowed for testing, though CuBirds is a 2–5 player game.

`game.test.mjs` includes a randomized full-game test that asserts every one of the 110 card ids is conserved after every move and that each move appends ordered events. Keep it passing when changing the engine.
