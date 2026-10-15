# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser card game that implements the CuBirds rules for 1–5 players, playable locally or as a Discord Activity. Plain Node.js (22+) with no framework and no runtime dependencies on the server. The client is ES modules served as static files with no build step for our own code; third-party browser libraries are pre-bundled into `public/` and committed.

## Commands

```sh
node server.mjs                 # Run locally at http://127.0.0.1:3000 (no npm install needed)
npm start                       # Same, but loads .env if present (Discord credentials, HOST, PORT)
node --test                     # Run all tests
node --test rooms.test.mjs      # Run one test file (also game.test.mjs, server.test.mjs)
node --test --test-name-pattern="capture" game.test.mjs   # Run tests whose name matches
npm install && npm run build    # Regenerate public/discord-sdk.js and public/vendor/preact.js
node build.mjs preact           # Rebuild only one bundle (targets: discord, preact)
```

To playtest multiplayer locally, open the game in two browser tabs. Each tab keeps its own session in `sessionStorage`.

## Architecture

The engine, server and browser share `public/species.js`: the species table (card counts, small and big flock thresholds, colors, image paths) and `speciesOf()`. Both the engine and the browser import it.

**Cards are ids, not species.** Each of the 110 cards is a string such as `duck-3`; use `speciesOf(card)` to get its species. Players still act by species (`{type:'lay', bird:'duck', ...}` lays every duck in hand).

**Rules engine (`game.mjs`)** is pure and holds no I/O. Game state is a plain JSON object.
- `start(players)` deals the table. `move(state, playerId, action)` returns a new state from a `structuredClone`, so a rejected move never mutates the live game. `view(state, playerId)` returns the redacted state for one player.
- Rejections are thrown `Error`s whose messages are shown verbatim to the player.
- A turn moves through phases: `lay`, then `draw` only when the lay captured nothing, then `flock`. `endTurn()` checks for a win first, then ends the round if the active player's hand is empty, otherwise advances the turn.
- Actions are `{type:'lay', bird, row, side}`, `{type:'draw', take}`, `{type:'flock', bird}`, and `{type:'pass'}`.
- Every change appends a typed event to `g.events` with an increasing `seq`, capped at the last 80: `start`, `turn`, `lay`, `capture`, `refill`, `draw`, `flock`, `pass`, `round`, `over`. A finished game also has `endReason` (`species`, `pairs` or `redeal`). `view()` strips card ids from other players' `draw` events; all other event data is public. There is no text log on the server.

**Room rules (`rooms.mjs`)** are pure transitions in the same style as the engine: `createRoom`, `join`, `leave`, `start`, `play`. Each returns a new room, returns `null` when the room closes, or throws a player-facing `Error`. `phase(room)` is `lobby`, `playing` or `finished`. The invariants, checked by a randomized test in `rooms.test.mjs`:
- The host always holds a seat and is present whenever anyone is; leaving or stepping away hands the role to the next present player.
- Leaving a running game marks the seat `away` and keeps the hand. Leaving a lobby or finished table removes the seat, and the last one out closes the room.
- Newcomers can sit down in a lobby or at a finished table, never mid-game. A finished game stays on the table until a rematch, which deals in everyone present and drops away seats.
- `unfinishedSeat()` finds another table where the player holds a seat in a running game; the server uses it to stop that player from sitting elsewhere.

**Server (`server.mjs`)** is one `node:http` server with all state in memory: `rooms`, `sessions`, per-IP rate `limits`, and `waiting` long-poll requests. Rooms and sessions expire after 24 hours and are lost on restart, so run a single process.
- It exports `server` and `config`, and only calls `listen()` when run directly. `server.test.mjs` listens on an ephemeral port and shortens `config.longPollMs`.
- It is an adapter over `rooms.mjs`: authenticate, call a transition, then `commit()` stores the result, increments `room.version`, and wakes waiting requests for that room. Route every room change through `commit()`, or long-polling clients won't hear about it.
- `GET /api/state?since=<version>` answers at once if the room is newer, otherwise holds the request until the next `commit()` or `config.longPollMs` (25 s) passes. A waiter whose seat or room disappeared gets 400 "Join a table first."
- Every mutating POST must send the room's current `version`. A mismatch returns 409, which is how stale or double-clicked moves are rejected.
- Clients only ever receive `view()` output through `snapshot()`. Never send raw game state, because it contains every hand and the deck.
- Login is either a guest name (allowed unless `ALLOW_GUESTS=false` or `NODE_ENV=production`) or a Discord OAuth code exchanged server-side using `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
- `/api/reset-rooms` wipes every room and is only enabled when guests are allowed.

**Client (`public/`)** uses Preact with htm, imported from the committed bundle `public/vendor/preact.js`; there is no JSX build.
- `app.js` is the root: boot (including the Discord SDK path, detected by a `frame_id` query parameter), session, actions, and polling. It long-polls `GET /api/state?since=<version>` one request at a time, backing off after errors, and `accept()` drops any response whose `version` is not newer than what is shown. Plain HTTP instead of WebSockets keeps traffic same-origin through Discord's Activity proxy.
- `js/ui.js` holds the components. Cards render keyed by id with a `data-card` attribute; players, piles and collection chips carry `data-player`, `data-pile` and `data-chip` so animations can find them.
- Long wires never scroll if they can help it: `fitWire()` in `js/ui.js` runs in a layout effect and on resize, and sets `data-fit="tight"`, `--strip` and sometimes `zoom` on a wire. Both end cards stay whole and the cards between show a strip with their numbers and the species' `short` tag. Because it runs before `motion.js` measures, cards fly to their squeezed positions.
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
