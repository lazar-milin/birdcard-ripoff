// Before editing, read CLAUDE.md at the repo root, especially "Client".
// Page components. Cards are keyed by id so they keep their elements between updates.
import { html, useState, useEffect, useLayoutEffect, useRef } from "../vendor/preact.js";
import { SPECIES, SPECIES_BY_ID, speciesOf } from "../species.js";
import { describe, headline, reasonText, isAction, plural } from "./text.js";
import { api } from "./api.js";

export function Segments({ parts }) {
  return parts.map((p, i) =>
    typeof p === "string"
      ? p
      : html`<span key=${i} class="sp" style=${"--bird:" + SPECIES_BY_ID[p.species].color}>${p.text}</span>`,
  );
}

export function Card({ card, n = 0, fresh = false, preview = false }) {
  const s = SPECIES_BY_ID[speciesOf(card)];
  return html`<div class=${`card${fresh ? " fresh" : ""}${preview ? " capture-preview" : ""}`} data-card=${card} data-short=${s.short} style=${"--bird:" + s.color}>
    <div class="card-top">
      <span class="breakpoints" aria-label=${`Small flock ${s.small}, big flock ${s.big}`}>
        <span class=${n >= s.small && n < s.big ? "flock-ready" : ""}>${s.small}</span>
        <span class=${n >= s.big ? "flock-ready" : ""}>${s.big}</span>
      </span>
      <strong>${s.name}</strong>
    </div>
    <div class="art">
      ${s.image ? html`<img src=${s.image} alt="" />` : html`<span>${s.name.slice(0, 2).toUpperCase()}</span>`}
    </div>
  </div>`;
}

export function Chips({ player, collection, showMissing = false }) {
  return html`<div class="collection">
    ${SPECIES.map((s) => {
      const n = collection.filter((c) => speciesOf(c) === s.id).length;
      return n || showMissing
        ? html`<span key=${s.id} class=${!n ? "chip-missing" : n >= 3 ? "chip-trio" : n === 2 ? "chip-pair" : ""} data-chip=${player + ":" + s.id} style=${"--bird:" + s.color} title=${n >= 3 ? `${s.name}: ${n} collected — one of two sets of three needed to win` : `${s.name}: ${n} collected`}>${s.name}${n ? ` ×${n}` : ""}</span>`
        : null;
    })}
  </div>`;
}

const LeaveIcon = html`<svg class="leave-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M4 3h11v18H4z" fill="none" stroke="currentColor" stroke-width="2" />
  <path d="M4 3l7 3v15l-7-3z" fill="currentColor" />
  <path d="M14 12h8m-3-3 3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" />
  <path d="M8 11h1v2H8z" fill="#f7fcff" />
</svg>`;

const ScrollIcon = html`<svg class="scroll-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M6 3h13v3h2v3h-5V6H8v12h8v3H3v-3h3V3zm10 6v9h3v3h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter" />
  <path d="M10 10h4m-4 4h4" fill="none" stroke="currentColor" stroke-width="2" />
</svg>`;

const ClockIcon = html`<svg class="clock-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M8 2h8v2h4v4h2v8h-2v4h-4v2H8v-2H4v-4H2V8h2V4h4z" fill="none" stroke="currentColor" stroke-width="2" />
  <path d="M11 6h2v7h5v2h-7z" fill="currentColor" />
</svg>`;
const BotIcon = html`<svg class="bot-icon" viewBox="0 0 20 20" role="img" aria-label="Bot"><path d="M9 1h2v3h5v2h2v10h-2v2H4v-2H2V6h2V4h5z" fill="currentColor"/><path d="M5 8h3v3H5zm7 0h3v3h-3zM6 14h8v2H6z" fill="#f5fcff"/></svg>`;
const BinocularsIcon = html`<svg class="binoculars-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 2h5v3H4zm11 0h5v3h-5zM3 5h7v8H3zm11 0h7v8h-7zM10 8h4v6h-4zM3 13h7v2h1v5H9v2H3v-2H1v-5h2zm11 0h7v2h2v5h-2v2h-6v-2h-2v-5h1z" fill="currentColor"/><path d="M4 15h5v5H4zm11 0h5v5h-5z" fill="#b7d6e3"/><path d="M5 16h2v2H5zm11 0h2v2h-2z" fill="#eaf5f8"/></svg>`;
const timerLabel = (seconds) => seconds === 30 ? "30 seconds" : "1 minute";

function TimerStatus({ room }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!room.deadline) return;
    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [room.deadline]);

  const running = room.game && room.game.phase !== "over";
  const remaining = running && room.deadline
    ? Math.max(0, Math.ceil((room.deadline - now) / 1000))
    : null;
  const label = remaining !== null
    ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
    : running ? "Paused" : timerLabel(room.timer);
  return html`<span id="timer-status" class=${remaining !== null && remaining <= 10 ? "urgent" : ""}
    role="timer" aria-label=${`Turn timer: ${remaining !== null ? `${label} remaining` : label}`}>
    ${ClockIcon}<small>${label}</small>
  </span>`;
}

export function Header({ room, logOpen, onToggleLog, scoreboardOpen, onToggleScoreboard, deckOpen, onToggleDeck, timerOpen, onToggleTimer, muted = true, onToggleSound, onCopy, onSpectate, onLeave, children }) {
  const g = room?.game;
  const headerRef = useRef(null);
  const fitHeader = () => {
    const header = headerRef.current;
    if (!header || !room) return;
    const controls = header.querySelector(".header-controls");
    const visible = [...controls.children].filter((node) => getComputedStyle(node).display !== "none");
    const controlStyle = getComputedStyle(controls);
    const controlsWidth = visible.reduce((sum, node) => {
      const style = getComputedStyle(node);
      const label = node.querySelector(".control-label, .help-label");
      const labelStyle = label && getComputedStyle(label);
      // Expanded hover labels scroll within the controls row, without moving the title.
      return sum + node.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight)
        - (label ? label.getBoundingClientRect().width + parseFloat(labelStyle.marginLeft) : 0);
    }, 0) + Math.max(0, visible.length - 1) * parseFloat(controlStyle.columnGap)
      + parseFloat(controlStyle.paddingLeft) + parseFloat(controlStyle.paddingRight);
    const brand = header.querySelector(".brand");
    const style = getComputedStyle(header);
    const available = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    header.classList.toggle("compact-header", brand.scrollWidth + parseFloat(style.columnGap) + controlsWidth > available);
  };
  useLayoutEffect(fitHeader);
  useEffect(() => {
    if (!room) return;
    const observer = new ResizeObserver(fitHeader);
    observer.observe(headerRef.current);
    document.fonts.ready.then(fitHeader);
    return () => observer.disconnect();
  }, [!!room]);
  return html`<header ref=${headerRef} class=${room ? `table-header${g ? ` game-header${room.players.length >= 3 ? " crowded-header" : ""}` : ""}` : ""}>
    <div class="header-left">
      <b class="brand">BirdCard Rip-off</b>
    </div>
    <div class="header-controls">
      <button id="sound-toggle" aria-label=${muted ? "Unmute sounds" : "Mute sounds"} title=${muted ? "Unmute sounds" : "Mute sounds"} aria-pressed=${!muted} onClick=${onToggleSound}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17V5l11-2v12M9 9l11-2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 16h6v5H3zm11-2h6v5h-6z" fill="currentColor"/>${muted && html`<path d="M3 3l18 18" stroke="#ba4949" stroke-width="3" />`}</svg>
      </button>
      ${room && room.timer > 0 && html`<${TimerStatus} room=${room} />`}
      ${room && html`<button id="copy" onClick=${onCopy}><span>Table ${room.code}</span><small>${g ? "Round " + g.round : "Lobby"} · Copy code</small></button>`}
      ${room && !g && room.you !== room.host && room.players.some((p) => p.id === room.you) && html`<button id="spectate-table" class="expand-control" aria-label="Spectate table" onClick=${onSpectate}>${BinocularsIcon}<span class="control-label">Spectate table</span></button>`}
      ${room && room.you === room.host && html`<button id="timer-toggle" class="expand-control" aria-label="Turn timer settings" aria-expanded=${timerOpen} aria-controls="timer-panel" onClick=${onToggleTimer}>${ClockIcon}<span class="control-label">Turn timer</span></button>`}
      ${g && html`<button id="birdhouse" aria-label="Deck and discards" aria-expanded=${deckOpen} aria-controls="deck-panel" onClick=${onToggleDeck}>
        <svg viewBox="0 0 32 36" aria-hidden="true"><path d="M2 14h4v-4h4V6h4V2h4v4h4v4h4v4h4v4h-4v14H6V18H2z" fill="#d9f0fa" stroke="currentColor" stroke-width="2"/><path d="M13 15h6v7h-6zM11 27h10v2H11zM14 32h4v4h-4z" fill="currentColor"/></svg>
        <span><span data-pile="deck"><b>${g.deckCount}</b> in deck</span><small data-pile="discard"><b>${g.discardCount}</b> discarded</small></span>
      </button>`}
      ${g && html`<button id="scoreboard-toggle" class="expand-control" aria-label="Table scoreboard" aria-expanded=${scoreboardOpen} aria-controls="table-scoreboard" onClick=${onToggleScoreboard}><svg class="scroll-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v9l-3 3h-1v4h4v3H7v-3h4v-4h-1l-3-3V3zM7 5H3v5l4 3m10-8h4v5l-4 3" fill="none" stroke="currentColor" stroke-width="2" /></svg><span class="control-label">Table scoreboard</span></button>`}
      ${room && html`<button id="leave-room" class="expand-control" aria-label="Leave table" onClick=${onLeave}>${LeaveIcon}<span class="control-label">Leave table</span></button>`}
      <button id="help" aria-label="How to play" onClick=${() => document.getElementById("rules").showModal()}>
        <span class="help-icon" aria-hidden="true">?</span><span class="help-label">How to play</span>
      </button>
      ${g && html`<button id="log-toggle" class="expand-control" aria-label="Game Log" aria-expanded=${logOpen} aria-controls="table-log" onClick=${onToggleLog}>${ScrollIcon}<span class="control-label">Game Log</span></button>`}
    </div>
    ${children}
  </header>`;
}

export function TimerPanel({ seconds, onChoose, onClose }) {
  return html`<section id="timer-panel" class="log-panel" aria-label="Turn timer settings">
    <div class="log-head"><h2>Turn timer</h2><button onClick=${onClose}>Close</button></div>
    <div class="timer-options">
      ${[[0, "No timer"], [30, "30 seconds"], [60, "1 minute"]].map(([value, label]) =>
        html`<button key=${value} class=${`timer-option-${value}${seconds === value ? " timer-current" : ""}`} aria-pressed=${seconds === value} onClick=${() => onChoose(value)}>${label}</button>`)}
    </div>
  </section>`;
}

export function TableLog({ game, ctx, onClose, onListSpectators }) {
  const lines = game.events
    .map((e) => ({ seq: e.seq, parts: e.type === "turn" ? null : describe(e, ctx) }))
    .filter((l) => l.parts)
    .reverse();
  return html`<section id="table-log" class="log-panel" aria-label="Table log">
    <div class="log-head"><h2>Game Log</h2><div class="log-head-actions"><button onClick=${onListSpectators}>List current spectators</button><button onClick=${onClose}>Close</button></div></div>
    <ol>${lines.map((l) => html`<li key=${l.seq}><${Segments} parts=${l.parts} /></li>`)}</ol>
  </section>`;
}

export function TableScoreboard({ room, onClose }) {
  const standings = [...(room.standings ?? [])].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
  const mostWins = standings[0]?.wins ?? 0;
  return html`<section id="table-scoreboard" class="log-panel" aria-label="Table scoreboard">
    <div class="log-head"><h2>Table scoreboard</h2><button onClick=${onClose}>Close</button></div>
    ${standings.length ? html`<ol>${standings.map((p) => html`<li key=${p.id}><span class="standing-player-name"><span>${p.name}</span>${mostWins > 0 && p.wins === mostWins && html`<svg class="leader-cup" viewBox="0 0 24 24" role="img" aria-label="Most wins at this table"><path d="M7 3h10v9l-3 3h-1v4h4v3H7v-3h4v-4h-1l-3-3V3zM7 5H3v5l4 3m10-8h4v5l-4 3" fill="none" stroke="currentColor" stroke-width="2" /></svg>`}</span><strong>${p.wins} ${p.wins === 1 ? "win" : "wins"}</strong></li>`)}</ol>` : html`<p>No wins yet. Finish a game to start the scoreboard.</p>`}
  </section>`;
}

function RematchButton({ room, act }) {
  const host = room.you === room.host;
  const proposed = room.players.find((p) => p.id === room.you)?.wantsRematch;
  return html`<button id=${host ? "start" : "propose-rematch"} class=${host ? "rematch-host" : "rematch-propose"} disabled=${!host && proposed} onClick=${() => act(host ? "start" : "rematch")}>${host ? "Rematch" : proposed ? "Rematch proposed" : "Propose rematch"}</button>`;
}

function ReturnToTable({ room, act }) {
  const full = room.players.length >= 5;
  return html`<button class="return-seat-cloud" disabled=${full} aria-label=${full ? "Table full" : "Take a seat"} onClick=${() => act("seat")}><span class="pixel-plus" aria-hidden="true"></span><span>${full ? "Table full" : "Take a seat"}</span></button>`;
}

export function DeckPanel({ game, onClose }) {
  return html`<section id="deck-panel" class="log-panel" aria-label="Deck and discards">
    <div class="log-head"><h2>Birdhouse</h2><button onClick=${onClose}>Close</button></div>
    <p class="deck-summary">${game.deckCount === 1 ? "There is 1 card" : `There are ${game.deckCount} cards`} left in the deck.</p>
    <div class="pile-section species-totals"><h3>Total birds in the game</h3><ol>${SPECIES.map((s) => html`<li key=${s.id}><span class="sp" style=${"--bird:" + s.color}>${s.name}</span><b>${s.count}</b></li>`)}</ol></div>
    <div class="pile-section"><h3>Discarded <small>(${game.discardCount})</small></h3><ol>${SPECIES.map((s) => html`<li key=${s.id} class=${game.discardSpecies?.[s.id] ? "" : "empty-species"}><span class="sp" style=${"--bird:" + s.color}>${s.name}</span><b>${game.discardSpecies?.[s.id] ?? 0}</b></li>`)}</ol></div>
  </section>`;
}

export function Scoreboard({ room, onKick, onRemoveBot, cloudsRight = false, onToggleClouds }) {
  const g = room.game;
  return html`<div class=${`scoreboard${g ? " game-scoreboard" : ""}${g && room.players.length >= 3 ? " crowded-scoreboard" : ""}`}>
    <div class=${`players player-count-${room.players.length}`}>
      ${room.players.map((p) => {
        const gp = g?.players.find((x) => x.id === p.id);
        const speciesCount = new Set((gp?.collection ?? []).map(speciesOf)).size;
        const active = g && g.phase !== "over" && g.players[g.turn].id === p.id;
        if (p.kicked) return html`<section key=${p.id} class="player kicked-player" data-player=${p.id}>
          <span class="kicked-badge">Player kicked</span>
        </section>`;
        return html`<section key=${p.id} class=${active ? "player active" : "player"} data-player=${p.id}>
          ${p.timedOut && html`<span class="timeout-badge">TIMED OUT</span>`}
          ${g?.phase === "over" && p.wantsRematch && html`<span class="rematch-badge">WANTS A REMATCH</span>`}
          <strong class="player-name">
            ${p.id === room.host && html`<svg class="host-star" viewBox="0 0 16 16" role="img" aria-label="Host"><path d="M6 0h4v4h2v2h4v4h-4v2h2v4h-4v-2H6v2H2v-4h2v-2H0V6h4V4h2z" fill="currentColor" /></svg>`}
            ${p.discord && html`<img class="player-discord" src="/art/discord-symbol.svg" alt="Discord" />`}
            ${p.bot && BotIcon}
            <span class=${p.id === room.you ? "own-name" : ""} aria-label=${p.id === room.you ? `${p.name}, you` : undefined}>${p.name}</span>${p.away ? " · away" : ""}
            ${!g && room.you === room.host && p.bot && html`<button class="remove-bot" aria-label=${`Remove ${p.name}`} onClick=${() => onRemoveBot(p.id)}>×</button>`}
            ${g && g.phase !== "over" && room.you === room.host && p.id !== room.host && p.timeouts >= 2 && html`<button class="kick-player" aria-label=${`Kick ${p.name}`} onClick=${() => onKick(p.id)}>Kick</button>`}
          </strong>
          <small>${gp ? html`<span class=${`hand-count${gp.handCount === 4 ? " hand-count-yellow" : gp.handCount === 2 || gp.handCount === 3 ? " hand-count-orange" : gp.handCount === 1 ? " hand-count-red" : ""}`}>${gp.handCount} in hand</span> · <span class=${`species-count${speciesCount >= 7 ? " species-count-complete" : speciesCount === 6 ? " species-count-close" : ""}`}>${speciesCount}/7 species</span>` : "Ready to play"}</small>
          <${Chips} player=${p.id} collection=${gp?.collection ?? []} showMissing=${true} />
        </section>`;
      })}
    ${g && html`<button id="cloud-layout-toggle" type="button" aria-label=${cloudsRight ? "Move back up" : "Move to the right"} aria-pressed=${cloudsRight} onClick=${onToggleClouds}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" />${cloudsRight ? html`<rect x="16" y="2" width="6" height="20" fill="currentColor" />` : html`<rect x="2" y="2" width="20" height="6" fill="currentColor" />`}</svg>
      <span class="cloud-layout-tip">${cloudsRight ? "Move back up" : "Move to the right"}</span>
    </button>`}
    </div>
  </div>`;
}

// Squeezes a long wire to fit its row instead of scrolling (#13). Both end cards stay
// whole; each card between them shows a strip with its flock numbers and short name.
// If strips of MIN_STRIP don't fit, the whole wire is scaled down to at most MIN_ZOOM,
// then the strips narrow to LAST_STRIP; only beyond that does the wire scroll.
// Clears everything when the wire fits as is.
const MIN_STRIP = 26,
  LAST_STRIP = 20,
  MIN_ZOOM = 0.7;
function fitWire(row) {
  const wire = row.querySelector(".row-cards");
  const cards = wire.children;
  delete wire.dataset.fit;
  wire.style.removeProperty("zoom");
  const n = cards.length;
  if (n < 3) return;
  const rs = getComputedStyle(row),
    ws = getComputedStyle(wire);
  const gap = parseFloat(ws.columnGap) || 0;
  const buttons = [...row.querySelectorAll(":scope > button")];
  const room =
    row.clientWidth -
    parseFloat(rs.paddingLeft) -
    parseFloat(rs.paddingRight) -
    buttons.reduce((sum, b) => sum + b.offsetWidth, 0) -
    buttons.length * (parseFloat(rs.columnGap) || 0) -
    parseFloat(ws.paddingLeft) -
    parseFloat(ws.paddingRight);
  const width = cards[0].offsetWidth;
  if (n * width + (n - 1) * gap <= room) return;
  let strip = Math.floor((room - 2 * width - gap) / (n - 2)),
    zoom = 1;
  if (strip < MIN_STRIP) {
    strip = MIN_STRIP;
    zoom = room / (2 * width + gap + (n - 2) * MIN_STRIP);
    if (zoom < MIN_ZOOM) {
      zoom = MIN_ZOOM;
      strip = Math.max(LAST_STRIP, Math.floor((room / MIN_ZOOM - 2 * width - gap) / (n - 2)));
    }
  }
  wire.dataset.fit = "tight";
  wire.style.setProperty("--strip", strip + "px");
  wire.style.setProperty("--wire-gap", gap + "px");
  if (zoom < 1) wire.style.zoom = zoom.toFixed(3);
}

function Wires({ game, mine, count, selected, onLay }) {
  const playing = mine && game.phase === "lay";
  const [target, setTarget] = useState(null);
  const rowsRef = useRef(null);
  // Runs before card animations measure positions, so cards fly to their squeezed spots.
  useLayoutEffect(() => {
    for (const row of rowsRef.current.children) fitWire(row);
  });
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      for (const row of rowsRef.current?.children ?? []) fitWire(row);
    });
    observer.observe(rowsRef.current);
    return () => observer.disconnect();
  }, []);
  const captured = new Set();
  if (playing && count && target) {
    const row = [...game.rows[target.row]];
    if (target.side === "right") row.reverse();
    const match = row.findIndex((card) => speciesOf(card) === selected);
    if (match > 0) row.slice(0, match).forEach((card) => captured.add(card));
  }
  const end = (i, side) => html`<button
    data-row=${i}
    data-side=${side}
    aria-label=${`Place ${side} of row ${i + 1}`}
    disabled=${!playing || !count}
    onMouseEnter=${() => setTarget({ row: i, side })}
    onMouseLeave=${() => setTarget(null)}
    onFocus=${() => setTarget({ row: i, side })}
    onBlur=${() => setTarget(null)}
    onClick=${() => { setTarget(null); onLay(i, side); }}
  ><span class="pixel-plus" aria-hidden="true"></span></button>`;
  return html`<div class=${mine ? "rows my-turn" : "rows"} ref=${rowsRef}>
    ${game.rows.map(
      (row, i) => html`<section class="row" key=${i}>
        ${end(i, "left")}
        <div class="row-cards">${row.map((c) => html`<${Card} key=${c} card=${c} preview=${captured.has(c)} />`)}</div>
        ${end(i, "right")}
      </section>`,
    )}
  </div>`;
}

function Hand({ hand, selected, fresh, onSelect }) {
  const groups = SPECIES.map((s) => ({ s, cards: hand.filter((c) => speciesOf(c) === s.id) })).filter(
    (g) => g.cards.length,
  );
  if (!groups.length) return html`<div class="hand-cards"><p>Your hand is empty.</p></div>`;
  return html`<div class="hand-cards">
    ${groups.map(({ s, cards }) => {
      const fresh_ = cards.filter((c) => fresh.has(c)).length;
      return html`<button
        key=${s.id}
        class=${selected === s.id ? "hand-group group-selected" : "hand-group"}
        data-bird=${s.id}
        aria-pressed=${selected === s.id}
        aria-label=${`Select ${cards.length} ${s.name} ${cards.length === 1 ? "card" : "cards"}${fresh_ ? `, ${fresh_} new` : ""}`}
        onClick=${() => onSelect(s.id)}
      >
        ${fresh_ ? html`<span class="fresh-badge" aria-hidden="true">${fresh_} new</span>` : null}
        ${cards.map((c, i) => html`<${Card} key=${c} card=${c} n=${i === cards.length - 1 ? cards.length : 0} fresh=${fresh.has(c)} />`)}
      </button>`;
    })}
  </div>`;
}

// Cards this player captured or drew since their turn began.
function freshCards(game, you) {
  const events = game.events;
  let i = events.length - 1;
  while (i >= 0 && events[i].type !== "turn") i--;
  const fresh = new Set();
  if (i < 0 || events[i].player !== you || game.phase === "over") return fresh;
  for (const e of events.slice(i + 1))
    if ((e.type === "capture" || e.type === "draw") && e.player === you) for (const c of e.cards ?? []) fresh.add(c);
  return fresh;
}

const PROMPTS = {
  lay: "Choose a bird in your hand, then choose a row end.",
  draw: "No birds captured. Draw two cards or skip.",
  flock: "Complete one flock, or end your turn.",
};

export function Table({ room, ctx, selected, onSelect, act }) {
  const game = room.game;
  const you = room.you;
  const spectating = room.spectators.some((p) => p.id === you);
  const me = spectating ? null : game.players.find((p) => p.id === you);
  const over = game.phase === "over";
  const active = game.players[game.turn];
  const mine = !over && active.id === you;
  const hand = me?.hand ?? [];
  const count = hand.filter((c) => speciesOf(c) === selected).length;
  const s = SPECIES_BY_ID[selected];
  const fresh = freshCards(game, you);
  // What the active player has done so far this turn.
  const turnStart = game.events.findLastIndex((e) => e.type === "turn");
  const recent = game.events
    .slice(turnStart + 1)
    .filter(isAction)
    .map((e) => describe(e, ctx));
  const [showResults, setShowResults] = useState(false);
  const [sideHand, setSideHand] = useState(false);
  const layoutRef = useRef(null);
  const layoutMotion = useRef({ before: null, animations: [] });
  const toggleHandLayout = () => {
    const motion = layoutMotion.current;
    for (const animation of motion.animations) animation.cancel();
    motion.animations = [];
    const layout = layoutRef.current;
    motion.before = new Map([...layout.querySelectorAll(".row > button, .row-cards, .hand-heading, .hand-group .card")]
      .map((element) => [element, element.getBoundingClientRect()]));
    setSideHand((value) => !value);
  };
  useLayoutEffect(() => {
    const motion = layoutMotion.current;
    const before = motion.before;
    motion.before = null;
    if (!before || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layout = layoutRef.current;
    const options = { duration: 230, easing: "cubic-bezier(.2,.7,.2,1)" };
    for (const [element, oldRect] of before) {
      if (!layout.contains(element)) continue;
      const nextRect = element.getBoundingClientRect();
      if (element.matches(".hand-group .card")) {
        const scaleX = oldRect.width / nextRect.width;
        const scaleY = oldRect.height / nextRect.height;
        if (Math.abs(scaleX - 1) + Math.abs(scaleY - 1) < .01) continue;
        motion.animations.push(element.animate(
          [
            { transform: `scale(${scaleX}, ${scaleY})`, transformOrigin: "center center" },
            { transform: "none", transformOrigin: "center center" },
          ], options,
        ));
        continue;
      }
      const dx = oldRect.left - nextRect.left;
      const dy = oldRect.top - nextRect.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      motion.animations.push(element.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], options,
      ));
    }
    const handPanel = layout.querySelector(".hand");
    motion.animations.push(handPanel.animate(
      [{ opacity: .55, transform: `translateY(${sideHand ? 8 : -8}px)` }, { opacity: 1, transform: "none" }],
      options,
    ));
    return () => { for (const animation of motion.animations) animation.cancel(); motion.animations = []; };
  }, [sideHand]);
  const seen = useRef({ id: null, phase: null });
  useEffect(() => {
    const was = seen.current;
    seen.current = { id: game.id, phase: game.phase };
    if (!over) return setShowResults(false);
    if (was.id === game.id && was.phase === "over") return;
    // Let the final move animate before the results cover the table.
    const timer = setTimeout(() => setShowResults(true), was.id === game.id ? 1100 : 0);
    return () => clearTimeout(timer);
  }, [game.id, game.phase]);

  let prompt = PROMPTS[game.phase];
  if (mine && game.phase === "flock" && fresh.size)
    prompt = `${plural(fresh.size, "new card")} marked in your hand. ${PROMPTS.flock}`;
  const actions = [];
  if (mine && game.phase === "draw")
    actions.push(
      html`<button id="draw" class="primary" onClick=${() => act("move", { type: "draw", take: true })}>Draw two</button>`,
      html`<button id="skipdraw" class=${hand.length ? "" : "new-round"} onClick=${() => act("move", { type: "draw", take: false })}>${hand.length ? "Skip draw" : "Start a new round"}</button>`,
    );
  if (mine && game.phase === "flock")
    actions.push(
      html`<button id="flock" class="primary" disabled=${!s || count < s.small} onClick=${() => act("move", { type: "flock", bird: selected })}>
        Complete ${s ? s.name + " " : ""}flock${s && count >= s.small ? ` · keep ${count >= s.big ? 2 : 1}` : ""}
      </button>`,
      html`<button id="pass" class=${hand.length ? "" : "new-round"} onClick=${() => act("move", { type: "pass" })}>${hand.length ? "End turn" : "Start a new round"}</button>`,
    );
  if (over) {
    if (!showResults) actions.push(html`<button id="results" onClick=${() => setShowResults(true)}>Show results</button>`);
    if (!showResults && !spectating) actions.push(html`<${RematchButton} room=${room} act=${act} />`);
  }
  return html`
    <div class=${`table-layout${sideHand && me ? " side-hand" : ""}`} ref=${layoutRef}>
    <div class="board-surface">
    <${Wires} game=${game} mine=${mine} count=${count} selected=${selected} onLay=${(row, side) => act("move", { type: "lay", bird: selected, row, side })} />
    ${spectating ? html`<section class="hand spectator-hand"><strong>You are spectating.</strong>${over && html`<${ReturnToTable} room=${room} act=${act} />`}</section>` : html`<section class="hand">
      <div class="hand-label">
        <h2>${me ? html`Your hand <small>(${hand.length})</small>` : "You have a seat"}</h2>
        <p class="eyebrow">${me ? "ONLY YOU CAN SEE THESE" : "NEXT GAME"}</p>
      </div>
      ${me
        ? html`<${Hand} hand=${hand} selected=${selected} fresh=${fresh} onSelect=${onSelect} />`
        : html`<p class="seat-note">You joined after this game ended. You'll be dealt in when the host starts the next one.</p>`}
      ${me && html`<button id="hand-layout-toggle" type="button" aria-label=${sideHand ? "Move back down" : "Move to the left"} aria-pressed=${sideHand} onClick=${toggleHandLayout}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" />${sideHand ? html`<rect x="2" y="2" width="6" height="20" fill="currentColor" />` : html`<rect x="2" y="16" width="20" height="6" fill="currentColor" />`}</svg>
        <span class="hand-layout-tip">${sideHand ? "Move back down" : "Move to the left"}</span>
      </button>`}
    </section>`}
    </div>
    <div class="hand-heading">
      ${!over &&
      html`<section class="turn" aria-live="polite">
        <strong>${mine ? "Your turn" : `${active.name}'s turn`}</strong>
        <span>
          ${mine
            ? prompt
            : recent.length
              ? recent.map((parts, i) => html`<${Segments} key=${i} parts=${[...parts, " "]} />`)
              : `Waiting for ${active.name} to lay birds.`}
        </span>
      </section>`}
      ${over && html`<section class="game-result" role="status">${headline(game, ctx)}</section>`}
      ${actions.length > 0 && html`<div class="actions">${actions}</div>`}
    </div>
    </div>
    <${VictoryDialog} room=${room} ctx=${ctx} open=${over && showResults} onClose=${() => setShowResults(false)} act=${act} spectating=${spectating} />
  `;
}

// Keeps a <dialog> element's open state in step with a prop.
function useDialog(open, onClose) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return { ref, onClose };
}

function VictoryDialog({ room, ctx, open, onClose, act, spectating }) {
  const game = room.game;
  const dialog = useDialog(open, onClose);
  const standings = [...game.players].sort(
    (a, b) => game.winners.includes(b.id) - game.winners.includes(a.id) || b.collection.length - a.collection.length,
  );
  return html`<dialog id="victory" ref=${dialog.ref} onClose=${dialog.onClose} aria-labelledby="victory-title">
    <p class="eyebrow">GAME OVER</p>
    <h2 id="victory-title">${headline(game, ctx)}</h2>
    <p class="victory-reason">${reasonText(game)}</p>
    <ol class="standings">
      ${standings.map(
        (p) => html`<li key=${p.id} class=${game.winners.includes(p.id) ? "winner" : ""}>
          <div class="standing-name">
            <strong>${ctx.who(p.id)}</strong>
            ${game.winners.includes(p.id) && html`<span class="tag">WINNER</span>`}
            <small>${plural(p.collection.length, "bird")} · ${new Set(p.collection.map(speciesOf)).size}/7 species</small>
          </div>
          <${Chips} player=${"result-" + p.id} collection=${p.collection} />
        </li>`,
      )}
    </ol>
    <p class="victory-meta">${plural(game.round, "round")} played.</p>
    <div class="actions">
      ${open && !spectating && html`<${RematchButton} room=${room} act=${act} />`}
      <button onClick=${onClose}>View table</button>
    </div>
  </dialog>`;
}

export function ResetDialog({ open, onClose, onSubmit, onPingu }) {
  const dialog = useDialog(open, onClose);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setPassword("");
      setError("");
    }
  }, [open]);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(password);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function inputPassword(event) {
    const value = event.currentTarget.value;
    setPassword(value);
    if (value.trim().toLowerCase() === "pingu") onPingu();
  }
  return html`<dialog id="reset-dialog" ref=${dialog.ref} onClose=${dialog.onClose}>
    <form id="reset-form" onSubmit=${submit}>
      <h2>Delete all rooms</h2>
      <p>Enter the password to clear every room on this server.</p>
      <label>Password<input id="reset-password" type="password" required autocomplete="off" value=${password} onInput=${inputPassword} /></label>
      <p id="reset-error" role="alert">${error}</p>
      <div class="actions">
        <button id="reset-cancel" type="button" onClick=${onClose}>Cancel</button>
        <button id="reset-submit" type="submit" disabled=${busy}>Delete all rooms</button>
      </div>
    </form>
  </dialog>`;
}

export function Entrance({ canReset, nameLocked, canClearName, discord, initialName, onJoin, onClearName, onReset }) {
  const [name, setName] = useState(initialName);
  const nameInput = useRef(null);
  const [code, setCode] = useState("");
  const [tables, setTables] = useState(null);
  const [tablesError, setTablesError] = useState(false);
  const refreshTables = useRef(null);
  useEffect(() => {
    let stopped = false, timer;
    const refresh = async () => {
      try {
        const result = await api("tables");
        if (!stopped) { setTables(result.tables); setTablesError(false); }
      } catch {
        if (!stopped) setTablesError(true);
      }
    };
    refreshTables.current = refresh;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); refreshTables.current = null; };
  }, []);
  return html`<section class="welcome">
    <h1>A bunch of birds,<br />ready to fly away,<br />catch them in your clouds.</h1>
    <p>1–5 players</p>
    <div class="entry">
      ${discord
        ? html`<div class="discord-identity" aria-label=${`Signed in as ${name} on Discord`}>
            <img src="/art/discord-symbol.svg" alt="Discord" width="27" height="20" />
            <span>${name}</span>
          </div>`
        : html`<div class="name-entry"><label for="name">Your name</label><div class="name-input-row">
        <input id="name" ref=${nameInput} maxlength="24" placeholder="Leave blank for a bird name" disabled=${nameLocked} value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
        ${canClearName && html`<button id="clear-name" type="button" aria-label="Clear saved name" title="Change name" onClick=${() => { onClearName(); setName(""); setTimeout(() => nameInput.current?.focus(), 0); }}>×</button>`}
      </div></div>`}
      <button id="create" class="primary" onClick=${() => onJoin(true, "", name)}>Create a table</button>
      <div class="divider">or join your friends</div>
      <label>Table code<input
        id="code"
        maxlength="8"
        placeholder="8-character code"
        autocomplete="off"
        value=${code}
        onInput=${(e) => setCode(e.currentTarget.value)}
        onKeyDown=${(e) => e.key === "Enter" && onJoin(false, code, name)}
      /></label>
      <button id="join" onClick=${() => onJoin(false, code, name)}>Join table</button>
    </div>
    <section class="open-tables" aria-labelledby="open-tables-title">
      <h2 id="open-tables-title">Open tables</h2>
      ${tablesError
        ? html`<p role="status">Couldn't load open tables. Retrying…</p>`
        : tables === null
          ? html`<p>Looking for open tables…</p>`
          : tables.length === 0
            ? html`<p>No open tables yet. Create one!</p>`
            : html`<div class="table-clouds">${tables.map((table) => html`<button
                key=${table.code} class="table-cloud"
                aria-label=${`Join table ${table.code}, hosted by ${table.hostName}, ${table.players} of 5 players`}
                onClick=${async () => { if (!(await onJoin(false, table.code, name))) await refreshTables.current?.(); }}>
                <strong>Table ${table.code}</strong>
                <span class="table-cloud-info">${table.hostDiscord && html`<img src="/art/discord-symbol.svg" alt="Discord" />`}<span class="table-cloud-host">${table.hostName}</span><span class="table-cloud-count">· ${table.players}/5 players</span></span>
              </button>`)}</div>`}
    </section>
    ${canReset && html`<div class="reset-rooms"><button id="delete-rooms" onClick=${onReset}>Delete all rooms</button></div>`}
  </section>`;
}

export function Lobby({ room, act }) {
  const spectating = room.spectators.some((p) => p.id === room.you);
  return html`<section class="lobby">
    <h2>${room.players.length}/5 players seated</h2>
    <p>Start on your own to test, add bots, or share the table code with friends.</p>
    ${spectating && html`<${ReturnToTable} room=${room} act=${act} />`}
    ${room.host === room.you && room.players.length < 5 && html`<button class="add-bot-cloud" aria-label="Add bot" onClick=${() => act("bot")}><span class="pixel-plus" aria-hidden="true"></span><span>Add bot</span></button>`}
    ${room.host === room.you
      ? html`<button id="start" class="primary" onClick=${() => act("start")}>Start game</button>`
      : html`<p>The host will start when everyone is here.</p>`}
    <button id="leave" onClick=${() => act("leave")}>Leave table</button>
    <p class="spectator-list">Spectators present: ${room.spectators.map((p) => p.name).join(", ") || "none"}</p>
  </section>`;
}
