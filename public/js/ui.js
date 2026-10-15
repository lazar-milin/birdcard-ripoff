// Page components. Cards are keyed by id so they keep their elements between updates.
import { html, useState, useEffect, useLayoutEffect, useRef } from "../vendor/preact.js";
import { SPECIES, SPECIES_BY_ID, speciesOf } from "../species.js";
import { describe, headline, reasonText, isAction, plural } from "./text.js";

export function Segments({ parts }) {
  return parts.map((p, i) =>
    typeof p === "string"
      ? p
      : html`<span key=${i} class="sp" style=${"--bird:" + SPECIES_BY_ID[p.species].color}>${p.text}</span>`,
  );
}

export function Card({ card, n = 0, fresh = false, preview = false }) {
  const s = SPECIES_BY_ID[speciesOf(card)];
  return html`<div class=${`card${fresh ? " fresh" : ""}${preview ? " capture-preview" : ""}`} data-card=${card} style=${"--bird:" + s.color}>
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
        ? html`<span key=${s.id} class=${!n ? "chip-missing" : n >= 3 ? "chip-trio" : ""} data-chip=${player + ":" + s.id} style=${"--bird:" + s.color} title=${n >= 3 ? `${s.name}: ${n} collected — one of two sets of three needed to win` : `${s.name}: ${n} collected`}>${s.name}${n ? ` ×${n}` : ""}</span>`
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

export function Header({ room, logOpen, onToggleLog, scoreboardOpen, onToggleScoreboard, muted = true, onToggleSound, onCopy, onLeave, children }) {
  const g = room?.game;
  return html`<header>
    <div class="header-left">
      <b class="brand">BirdCard Rip-off</b>
    </div>
    <div class="header-controls">
      <button id="sound-toggle" aria-label=${muted ? "Unmute sounds" : "Mute sounds"} title=${muted ? "Unmute sounds" : "Mute sounds"} aria-pressed=${!muted} onClick=${onToggleSound}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17V5l11-2v12M9 9l11-2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 16h6v5H3zm11-2h6v5h-6z" fill="currentColor"/>${muted && html`<path d="M3 3l18 18" stroke="#ba4949" stroke-width="3" />`}</svg>
      </button>
      ${room && html`<button id="copy" onClick=${onCopy}><span>Table ${room.code}</span><small>${g ? "Round " + g.round : "Lobby"} · Copy code</small></button>`}
      ${room && html`<button id="scoreboard-toggle" class="expand-control" aria-label="Table scoreboard" aria-expanded=${scoreboardOpen} aria-controls="table-scoreboard" onClick=${onToggleScoreboard}><svg class="scroll-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v9l-3 3h-1v4h4v3H7v-3h4v-4h-1l-3-3V3zM7 5H3v5l4 3m10-8h4v5l-4 3" fill="none" stroke="currentColor" stroke-width="2" /></svg><span class="control-label">Table scoreboard</span></button>`}
      ${room && html`<button id="leave-room" class="expand-control" aria-label="Leave table" onClick=${onLeave}>${LeaveIcon}<span class="control-label">Leave table</span></button>`}
      <button id="help" aria-label="How to play" onClick=${() => document.getElementById("rules").showModal()}>
        <span class="help-icon" aria-hidden="true">?</span><span class="help-label">How to play</span>
      </button>
      ${g && html`<button id="log-toggle" class="expand-control" aria-label="Game Log" aria-expanded=${logOpen} aria-controls="table-log" onClick=${onToggleLog}>${ScrollIcon}<span class="control-label">Game Log</span></button>`}
    </div>
    ${children}
  </header>`;
}

export function TableLog({ game, ctx, onClose }) {
  const lines = game.events
    .map((e) => ({ seq: e.seq, parts: e.type === "turn" ? null : describe(e, ctx) }))
    .filter((l) => l.parts)
    .reverse();
  return html`<section id="table-log" class="log-panel" aria-label="Table log">
    <div class="log-head"><h2>Game Log</h2><button onClick=${onClose}>Close</button></div>
    <ol>${lines.map((l) => html`<li key=${l.seq}><${Segments} parts=${l.parts} /></li>`)}</ol>
  </section>`;
}

export function TableScoreboard({ room, onClose }) {
  const standings = [...(room.standings ?? [])].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
  return html`<section id="table-scoreboard" class="log-panel" aria-label="Table scoreboard">
    <div class="log-head"><h2>Table scoreboard</h2><button onClick=${onClose}>Close</button></div>
    ${standings.length ? html`<ol>${standings.map((p) => html`<li key=${p.id}><span>${p.name}</span><strong>${p.wins} ${p.wins === 1 ? "win" : "wins"}</strong></li>`)}</ol>` : html`<p>No wins yet. Finish a game to start the scoreboard.</p>`}
  </section>`;
}

function RematchButton({ room, act }) {
  const host = room.you === room.host;
  const proposed = room.players.find((p) => p.id === room.you)?.wantsRematch;
  return html`<button id=${host ? "start" : "propose-rematch"} class=${host ? "rematch-host" : "rematch-propose"} disabled=${!host && proposed} onClick=${() => act(host ? "start" : "rematch")}>${host ? "Rematch" : proposed ? "Rematch proposed" : "Propose rematch"}</button>`;
}

export function Scoreboard({ room }) {
  const g = room.game;
  return html`<div class="scoreboard">
    <div class="players">
      ${room.players.map((p) => {
        const gp = g?.players.find((x) => x.id === p.id);
        const active = g && g.phase !== "over" && g.players[g.turn].id === p.id;
        return html`<section key=${p.id} class=${active ? "player active" : "player"} data-player=${p.id}>
          ${g?.phase === "over" && p.wantsRematch && html`<span class="rematch-badge">WANTS A REMATCH</span>`}
          <strong class="player-name">
            ${p.id === room.host && html`<svg class="host-star" viewBox="0 0 16 16" role="img" aria-label="Host"><path d="M6 0h4v4h2v2h4v4h-4v2h2v4h-4v-2H6v2H2v-4h2v-2H0V6h4V4h2z" fill="currentColor" /></svg>`}
            <span class=${p.id === room.you ? "own-name" : ""} aria-label=${p.id === room.you ? `${p.name}, you` : undefined}>${p.name}</span>${p.away ? " · away" : ""}
          </strong>
          <small>${gp ? `${gp.handCount} in hand · ${new Set(gp.collection.map(speciesOf)).size}/7 species` : "Ready to play"}</small>
          <${Chips} player=${p.id} collection=${gp?.collection ?? []} showMissing=${true} />
        </section>`;
      })}
    </div>
    ${g && html`<aside class="deck-state" aria-label="Deck state">
      <span data-pile="deck"><b>${g.deckCount}</b> in deck</span>
      <span data-pile="discard"><b>${g.discardCount}</b> discarded</span>
    </aside>`}
  </div>`;
}

function Wires({ game, mine, count, selected, onLay }) {
  const playing = mine && game.phase === "lay";
  const [target, setTarget] = useState(null);
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
  return html`<div class=${mine ? "rows my-turn" : "rows"}>
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
  const me = game.players.find((p) => p.id === you);
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
      html`<button id="skipdraw" onClick=${() => act("move", { type: "draw", take: false })}>Skip draw</button>`,
    );
  if (mine && game.phase === "flock")
    actions.push(
      html`<button id="flock" class="primary" disabled=${!s || count < s.small} onClick=${() => act("move", { type: "flock", bird: selected })}>
        Complete ${s ? s.name + " " : ""}flock${s && count >= s.small ? ` · keep ${count >= s.big ? 2 : 1}` : ""}
      </button>`,
      html`<button id="pass" onClick=${() => act("move", { type: "pass" })}>End turn</button>`,
    );
  if (over) {
    if (!showResults) actions.push(html`<button id="results" onClick=${() => setShowResults(true)}>Show results</button>`);
    if (!showResults) actions.push(html`<${RematchButton} room=${room} act=${act} />`);
  }
  return html`
    <${Wires} game=${game} mine=${mine} count=${count} selected=${selected} onLay=${(row, side) => act("move", { type: "lay", bird: selected, row, side })} />
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
    <section class="hand">
      <div class="hand-label">
        <h2>${me ? html`Your hand <small>(${hand.length})</small>` : "You have a seat"}</h2>
        <p class="eyebrow">${me ? "ONLY YOU CAN SEE THESE" : "NEXT GAME"}</p>
      </div>
      ${me
        ? html`<${Hand} hand=${hand} selected=${selected} fresh=${fresh} onSelect=${onSelect} />`
        : html`<p class="seat-note">You joined after this game ended. You'll be dealt in when the host starts the next one.</p>`}
    </section>
    <${VictoryDialog} room=${room} ctx=${ctx} open=${over && showResults} onClose=${() => setShowResults(false)} act=${act} />
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

function VictoryDialog({ room, ctx, open, onClose, act }) {
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
      ${open && html`<${RematchButton} room=${room} act=${act} />`}
      <button onClick=${onClose}>View table</button>
    </div>
  </dialog>`;
}

export function ResetDialog({ open, onClose, onSubmit }) {
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
  return html`<dialog id="reset-dialog" ref=${dialog.ref} onClose=${dialog.onClose}>
    <form id="reset-form" onSubmit=${submit}>
      <h2>Delete all rooms</h2>
      <p>Enter the password to clear every room on this server.</p>
      <label>Password<input id="reset-password" type="password" required autocomplete="off" value=${password} onInput=${(e) => setPassword(e.currentTarget.value)} /></label>
      <p id="reset-error" role="alert">${error}</p>
      <div class="actions">
        <button id="reset-cancel" type="button" onClick=${onClose}>Cancel</button>
        <button id="reset-submit" type="submit" disabled=${busy}>Delete all rooms</button>
      </div>
    </form>
  </dialog>`;
}

export function Entrance({ canReset, nameLocked, initialName, onJoin, onReset }) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState("");
  return html`<section class="welcome">
    <h1>Take a seat.<br />Bring your friends.</h1>
    <p>1–5 players</p>
    <div class="entry">
      <label>Your name<input id="name" maxlength="24" placeholder="Player" disabled=${nameLocked} value=${name} onInput=${(e) => setName(e.currentTarget.value)} /></label>
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
    ${canReset && html`<div class="reset-rooms"><button id="delete-rooms" onClick=${onReset}>Delete all rooms</button></div>`}
  </section>`;
}

export function Lobby({ room, act }) {
  return html`<section class="lobby">
    <h2>${room.players.length}/5 players seated</h2>
    <p>Start on your own to test, or share the table code with friends.</p>
    ${room.host === room.you
      ? html`<button id="start" class="primary" onClick=${() => act("start")}>Start game</button>`
      : html`<p>The host will start when everyone is here.</p>`}
    <button id="leave" onClick=${() => act("leave")}>Leave table</button>
  </section>`;
}
