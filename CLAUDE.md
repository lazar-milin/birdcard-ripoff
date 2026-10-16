# CLAUDE.md

This file guides Claude Code and other coding agents working in this repository. Read it before changing code. `AGENTS.md` and a comment at the top of every source file point here; keep that comment when you edit a file, and add one to any file you create.

## What this is

A browser card game that implements the CuBirds rules for 1–5 players, playable locally or as a Discord Activity. Plain Node.js (22+) with no framework and no runtime dependencies on the server. The client is ES modules served as static files with no build step for our own code; third-party browser libraries are pre-bundled into `public/` and committed.

## Commands

```sh
node server.mjs                 # Run locally at http://127.0.0.1:3000 (no npm install needed)
npm start                       # Same, but loads .env if present (Discord credentials, ALLOW_GUESTS, HOST, PORT)
node --test                     # Run all tests (same as npm test)
node --test rooms.test.mjs      # Run one file: game, rooms, server, events or auto-turn .test.mjs
node --test --test-name-pattern="capture" game.test.mjs   # Run tests whose name matches
npm install && npm run build    # Regenerate public/discord-sdk.js and public/vendor/preact.js
node build.mjs preact           # Rebuild only one bundle (targets: discord, preact)
```

To playtest multiplayer locally, open the game in two browser tabs. Each tab keeps its own session in `sessionStorage`. To exercise timeouts and kicking, the host sets a 30-second timer from the header clock.

## Architecture

The engine, server and browser share `public/species.js`: the species table (card counts, small and big flock thresholds, colors, image paths) and `speciesOf()`. Both the engine and the browser import it.

**Cards are ids, not species.** Each of the 110 cards is a string such as `duck-3`; use `speciesOf(card)` to get its species. Players still act by species (`{type:'lay', bird:'duck', ...}` lays every duck in hand).

**Rules engine (`game.mjs`)** is pure and holds no I/O. Game state is a plain JSON object.
- `start(players)` deals the table. `move(state, playerId, action, { timeout })` returns a new state from a `structuredClone`, so a rejected move never mutates the live game; `timeout: true` marks the resulting `lay`, `draw` or `pass` event. `kick(state, playerId)` and `spectate(state, playerId)` remove a player and discard their hand and collection with distinct events. `view(state, playerId)` returns the redacted state for one player; pass `null` for a spectator so no hand is exposed, even after they leave a finished game.
- Rejections are thrown `Error`s whose messages are shown verbatim to the player.
- A turn moves through phases: `lay`, then `draw` only when the lay captured nothing, then `flock`. `endTurn()` checks for a win first, then ends the round if the active player's hand is empty, otherwise advances the turn.
- Actions are `{type:'lay', bird, row, side}`, `{type:'draw', take}`, `{type:'flock', bird}`, and `{type:'pass'}`.
- Every change appends a typed event to `g.events` with an increasing `seq`, capped at the last 80: `start`, `turn`, `lay`, `capture`, `refill`, `draw`, `flock`, `pass`, `kick`, `spectate`, `round`, `over`. A finished game also has `endReason` (`species`, `pairs` or `redeal`). `view()` strips card ids from other players' `draw` events; all other event data is public. There is no text log on the server.

**Room rules (`rooms.mjs`)** are pure transitions in the same style as the engine: `createRoom`, `join`, `leave`, `start`, `play`, `setTimer`, `timeout`, `kick` and `proposeRematch`. Each returns a new room (or the same object when nothing changed), returns `null` when the room closes, or throws a player-facing `Error`; `leave` returns `{ room, saved }`. `phase(room)` is `lobby`, `playing` or `finished`.
- A room has `players` (at most five seats), `spectators` (watchers without seats), `host`, `game`, `standings` (wins across games at this table), `timer` (0, 30 or 60 seconds) and `deadline`. A seat may carry `away`, `kicked`, `timeouts`, `timedOut` and `wantsRematch`. A present player is neither away nor kicked. The host remains a seated human.
- `timeout(room)` plays out the rest of the active turn: a random lay, then a skipped draw, then a pass. Each one adds to the player's `timeouts`. From two, the host may `kick` them. The kicked seat stays in `players` with `kicked: true` so the table can show it, and that player can only sit back down once the game finishes.

The invariants, checked by a randomized test in `rooms.test.mjs`:
- The host always holds a seat and is present whenever anyone is; leaving or stepping away hands the role to the next present player.
- Leaving a running game marks the seat `away` and keeps the hand. Leaving a lobby or finished table removes the seat, and the last one out closes the room.
- Newcomers take a seat in a lobby or at a finished table when space exists; joining a running or full table makes them spectators. A non-host may move from a seat to the spectator pool at any time, but can return to a seat only outside a running game. A finished game stays on the table until a rematch, which deals in everyone present and drops away and kicked seats.
- `unfinishedSeat()` finds another table where the player holds a seat in a running game; the server uses it to stop that player from sitting elsewhere.

**Server (`server.mjs`)** is one `node:http` server with all state in memory: `rooms`, `sessions`, per-IP rate `limits`, `waiting` long-poll requests and `turnTimers`. Rooms and sessions expire after 24 hours and are lost on restart, so run a single process. Saving rooms to disk (#21) and per-session rate limits (#20) were closed as not planned; ask before reviving them.
- It exports `server` and `config`, and only calls `listen()` when run directly. `server.test.mjs` listens on an ephemeral port and shortens `config.longPollMs` and `config.turnSecondMs`.
- It is an adapter over `rooms.mjs`: authenticate, call a transition, then `commit()` stores the result, increments `room.version`, rearms the turn timer and wakes waiting requests for that room. Route every room change through `commit()`, or long-polling clients won't hear about it and timers won't fire.
- Turn timer: when a running game has `room.timer` set, `commit()` starts a fresh `deadline` whenever the game, its `seq` or the timer setting changes, and schedules `Rooms.timeout()` for it. `/api/move` applies an expired deadline before checking the version, so a move that arrives too late gets 409.
- Endpoints: `GET /api/config`, `GET /api/tables` (unstarted lobbies with free seats, shown as clouds on the entrance; no login), `POST /api/login`, `GET /api/me`, `GET /api/state`, and the room POSTs `join`, `spectate`, `seat`, `start`, `move`, `timer`, `kick`, `rematch` and `leave`.
- `GET /api/state?since=<version>` answers at once if the room is newer, otherwise holds the request until the next `commit()` or `config.longPollMs` (25 s) passes. A waiter whose seat or room disappeared gets 400 "Join a table first." (or "The host removed you from this table." after a kick).
- Every mutating POST must send the room's current `version`. A mismatch returns 409, which is how stale or double-clicked moves are rejected.
- Clients only ever receive `view()` output through `snapshot()`. Never send raw game state, because it contains every hand and the deck.
- Login is either a guest name (allowed unless `ALLOW_GUESTS=false` or `NODE_ENV=production`; a blank name or "Player" becomes a random one such as "Jade Heron") or a Discord OAuth code exchanged server-side using `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
- `/api/reset-rooms` wipes every room. It is only enabled when guests are allowed and needs the playtest password in `server.mjs`.

**Client (`public/`)** uses Preact with htm, imported from the committed bundle `public/vendor/preact.js`; there is no JSX build.
- `app.js` is the root: boot (including the Discord SDK path, detected by a `frame_id` query parameter), session, actions, header panels and polling. It long-polls `GET /api/state?since=<version>` one request at a time, backing off after errors, and `accept()` drops any response whose `version` is not newer than what is shown. Plain HTTP instead of WebSockets keeps traffic same-origin through Discord's Activity proxy. When `shouldAutoEnd()` from `js/auto-turn.js` says you are at the flock step with no flock possible, it passes for you after 4 seconds.
- `js/api.js` wraps `fetch` and keeps the token, room code and guest name in `sessionStorage`.
- `js/ui.js` holds the components: `Header` and its panels (`TimerPanel`, `TableLog`, `TableScoreboard`, `DeckPanel`), `Scoreboard` (player clouds with timeout, rematch and kick controls), `Table`, `Lobby`, `Entrance` (polls `/api/tables` for open-table clouds) and `ResetDialog`. Cards render keyed by id with a `data-card` attribute; players, piles and collection chips carry `data-player`, `data-pile` and `data-chip` so animations can find them.
- Long wires never scroll if they can help it: `fitWire()` in `js/ui.js` runs in a layout effect and on resize, and sets `data-fit="tight"`, `--strip` and sometimes `zoom` on a wire. Both end cards stay whole and the cards between show a strip with their numbers and the species' `short` tag. Because it runs before `motion.js` measures, cards fly to their squeezed positions.
- `js/events.js` exports `changedEvents(prev, next)`, the events that are new since what is on screen. It never replays history after a refresh or room switch. Motion, sound and the timeout notice all use it.
- `js/motion.js` animates. `capture()` records every card's position just before new state is applied; `play()` runs in a layout effect after render and flies fixed-position copies of cards from old to new places, using the new events to decide where appearing or vanishing cards come from or go. It does nothing under `prefers-reduced-motion`.
- `js/sound.js` plays five short Web Audio cues from `public/audio/`. Sound starts muted; the choice is saved in `localStorage` and synced across tabs.
- `js/text.js` turns events into sentences for the table log and turn panel, returning species as separate parts so they can be shown in their colors.
- `js/events.js` and `js/auto-turn.js` import nothing from the DOM or Preact, so `events.test.mjs` and `auto-turn.test.mjs` can load them in Node. Keep client logic you want to test that way.
- `references.html` is a standalone bird-art reference picker, not part of the game.

`public/discord-sdk.js` and `public/vendor/preact.js` are generated by `build.mjs`. Don't edit or reformat them by hand.

## Rules conventions

The engine follows the CuBirds rulebook, with these deliberate choices where the printed rules are terse (see README.md):
- A single-species row refills automatically on the right. With one species in the row this is mirror-equivalent to the left.
- After a no-capture lay that empties the hand, the player may still draw two before the round ends, following the Board Game Arena implementation. The printed rule ends the round immediately. The team prefers the BGA rule, so making it a table setting (#10) was closed as not planned.
- The discard pile reshuffles into the deck whenever a draw needs a card. If both are empty mid-turn, the player draws what's available. A redeal that can't give everyone eight cards ends the game, and the largest collection wins with ties shared.
- A turn timeout always ends the turn, even when the time runs out in the draw or flock step.
- Solo play (one seat) is allowed for testing, though CuBirds is a 2–5 player game. A game continues solo if kicks leave one player.

`game.test.mjs` includes a randomized full-game test that asserts every one of the 110 card ids is conserved after every move and that each move appends ordered events. Keep it passing when changing the engine, including `kick`.

## Issues

GitHub issues get one type label (`bug` or `enhancement`) and one or more area labels: `engine`, `rules`, `server`, `client`, `art`, `sound`, `discord`. lazar-milin owns the repository, the Discord integration and pull request merges; assign Discord-side work to them.
