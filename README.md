# Bird Table — multiplayer Activity prototype

A playable 1–5 player card game using CuBirds mechanics, with rounded shield cards, circular illustration placeholders, overlapping hand stacks, pixel clouds, and electrical wire rows. No official artwork or logos are bundled.

## Play locally

Requires Node.js 22 or newer. The local game needs no package installation:

```sh
node server.mjs
```

Open http://127.0.0.1:3000 in two separate browser tabs. Each tab has its own private player session. Create a table in the first tab, copy its code, and join from the second. You can start alone for a solo playtest, with every turn returning to you. This uses the normal collection rules without a bot opponent. Refreshing restores your seat while the server is running.

## Run inside Discord

1. Install dependencies with `npm install`, then run `npm run build`. This bundles the official Embedded App SDK locally; the browser does not depend on an external CDN.
2. Copy `.env.example` to `.env`. Set the Discord application's `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`. Keep the secret only on the server; do not paste it into chat or commit it. Set `ALLOW_GUESTS=false` for public hosting. Set `HOST=0.0.0.0` when your hosting provider requires it.
3. Start with `npm start` (or `node --env-file=.env server.mjs`). Serve this single Node process through an HTTPS host or development tunnel pointing to port 3000. A static-only host is insufficient.
4. In the [Discord Developer Portal](https://discord.com/developers/applications), enable Activities for your app. Configure its root URL mapping `/` to the HTTPS host, covering both frontend and `/api/`. Add the OAuth redirect `https://127.0.0.1` as described in Discord's guide. Retain the default Launch entry point.
5. Enable Developer Mode in Discord. Launch from the App Launcher. During development, testers need access through the app's developer team; follow Discord's distribution requirements before inviting arbitrary users.
6. Authorize basic identity access. Create a table, share its code in the call, and have friends join through the Activity. Authentication verifies identities on the server. The SDK access token is used only during sign-in; the game uses its own expiring session afterward.

Reference: [Discord's current Activity guide](https://docs.discord.com/developers/activities/building-an-activity).

The Discord adapter is bundled, but a live Discord launch requires your application credentials and host. That end-to-end flow has not yet been verified in your Discord account.

## Artwork handoff

- Edit `public/species.js` for each species' label, temporary color, and image URL.
- Put your eight images under `public/art/` and use paths such as `/art/owl.webp`.
- Card art sits in a flexible central frame. Transparent square images are a useful starting format; the current renderer uses `object-fit: contain`.
- `public/style.css` controls the table, card frames, typography, spacing, and selection state independently of the rules engine.
- The temporary title is in `public/index.html` and the page header. The supplied VCR OSD Mono font is stored locally in `public/fonts/`.

## Implemented

Private hands, shared room codes, host start/rematch, 1–5 seats, all-species placement, nearest-match capture, automatic refill on the right, optional two-card draw, one optional flock per turn, reshuffling, round reset, both collection victories, insufficient-redeal victory and ties. The server validates moves and rejects outdated requests. Table state refreshes once per second.

Rule references: [published rulebook](https://cdn.1j1ju.com/medias/65/c2/93-cubirds-rulebook.pdf) and [species reference](https://test.yucata.de/en/Rules/CuBirds). The empty-hand draw choice follows the [Board Game Arena implementation](https://boardgamearena.com/gamepanel?game=cubirds): you can draw two after a no-capture placement before ending the round. Discards reshuffle whenever a draw is needed. If both piles are exhausted during a turn, draw as many as available; insufficient redeal ends the game. These conventions are explicit because the printed rules are terse about mid-turn exhaustion.

## Validation

```sh
node --test
```

Tests cover setup, captures from both ends, refill, draw/round timing, scoring, win precedence, tied exhaustion, illegal moves, card conservation across simulated games, and two HTTP clients with private views and stale-move rejection.

## Prototype limits

Rooms and sessions live in memory and expire after 24 hours. Restarting the server clears games. Use one server process; persistent storage and multi-process coordination are not implemented. There are no bots, spectators, turn timers, or mid-game seat replacement. A disconnected player retains their seat; other players wait for them to return. Table codes are the invitation mechanism; automatic Discord-instance matching is not implemented. This is ready for local playtesting, not a claimed production launch.

Refill convention: the server automatically adds cards on the right until a second species appears. The printed rules permit either end; with a single-species row, the outcomes are mirror-equivalent.

## Room controls and flock hints

Use Leave room in the header at any time, then enter a generated room code on the entry screen. Leaving an active game marks your seat away and preserves your hand; return from the same browser tab/session (or Discord identity) using the code. The table waits if an away player's turn comes up. New players can join a lobby; an already-started game accepts its existing players returning to their seats. Leaving a lobby removes your seat and transfers hosting to the next player.

The top card in each hand stack highlights the best achievable flock threshold with a light-green square: the small threshold when the small flock is available, or the big threshold when the big flock is available. This indicates hand size, while turn rules still determine when a flock may be completed.
