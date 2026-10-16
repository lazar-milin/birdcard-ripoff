// Before editing, read CLAUDE.md at the repo root, especially "Client".
// Card motion. capture() records where every card is before an update; play()
// runs after the update and flies each card from its old place to its new one.
// Events from the server say where cards that appear or vanish came from or went.
import { html, render } from "../vendor/preact.js";
import { Card } from "./ui.js";
import { changedEvents } from "./events.js";

const DURATION = 420;
const STEP = 280; // delay between consecutive events, such as a lay and its capture
const EASE = "cubic-bezier(.2,.7,.2,1)";
let snapshot = null;

const quiet = () =>
  document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches;
const one = (selector) => document.querySelector(selector);
const playerEl = (id) => one(`#app [data-player="${CSS.escape(id)}"]`);
const pileEl = (name) => one(`[data-pile="${name}"]`);
const chipEl = (id, species) =>
  one(`#app [data-chip="${CSS.escape(id + ":" + species)}"]`) ?? playerEl(id);
const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

export function capture() {
  if (quiet()) {
    snapshot = null;
    return;
  }
  snapshot = new Map();
  for (const el of document.querySelectorAll("#app [data-card]"))
    snapshot.set(el.dataset.card, {
      rect: el.getBoundingClientRect(),
      html: el.outerHTML,
      inHand: !!el.closest(".hand-group"),
    });
}

// Which cards each event moved, and in what role.
function roles(e) {
  if (e.type === "lay") return [["laid", e.cards]];
  if (e.type === "capture") return [["captured", e.cards]];
  if (e.type === "refill") return [["refill", e.cards]];
  if (e.type === "draw") return [["drawn", e.cards ?? []]];
  if (e.type === "flock") return [["kept", e.kept], ["discarded", e.discarded]];
  if (e.type === "kick" || e.type === "spectate") return [["discarded", e.cards]];
  return [];
}

export function play(prev, next) {
  const before = snapshot;
  snapshot = null;
  if (!before || quiet()) return;
  const pg = prev?.game,
    ng = next?.game;
  if (!pg || !ng || pg.id !== ng.id || prev.code !== next.code) return;
  const events = changedEvents(prev, next);
  // Nothing new, or too much missed to animate faithfully.
  if (!events.length || events[0].seq !== pg.seq + 1) return;

  const moved = new Map();
  events.forEach((e, step) => {
    for (const [role, ids] of roles(e)) for (const id of ids) moved.set(id, { e, role, step });
  });
  const roundStep = events.findIndex((e) => e.type === "round");
  const after = new Map(
    [...document.querySelectorAll("#app [data-card]")].map((el) => [el.dataset.card, el]),
  );

  for (const [id, el] of after) {
    const old = before.get(id);
    const m = moved.get(id);
    const to = el.getBoundingClientRect();
    if (old) {
      if (Math.abs(old.rect.left - to.left) + Math.abs(old.rect.top - to.top) < 2) continue;
      if (m) flyCard(el, old.rect, to, m.step);
      else slide(el, old.rect, to); // only nudged by layout, such as a wire growing
      continue;
    }
    const source =
      m?.role === "refill" || m?.role === "drawn"
        ? pileEl("deck")
        : m?.role === "laid"
          ? playerEl(m.e.player)
          : roundStep >= 0
            ? pileEl("deck")
            : null;
    arrive(el, source?.getBoundingClientRect(), to, m ? m.step : Math.max(roundStep, 0));
  }

  for (const [id, old] of before) {
    if (after.has(id)) continue;
    const m = moved.get(id);
    const target = !m
      ? roundStep >= 0
        ? pileEl("discard")
        : null
      : m.role === "captured" || m.role === "laid"
        ? playerEl(m.e.player)
        : m.role === "kept"
          ? chipEl(m.e.player, m.e.species)
          : m.role === "discarded"
            ? pileEl("discard")
            : null;
    depart(old, target?.getBoundingClientRect(), m ? m.step : Math.max(roundStep, 0));
  }

  // Moves hidden at both ends: other players' draws, flocks and new hands.
  events.forEach((e, step) => {
    if (e.type === "draw" && e.count && e.player !== next.you)
      tokens(Array(e.count).fill(null), pileEl("deck"), playerEl(e.player), step);
    if (e.type === "flock" && e.player !== next.you) {
      tokens(e.kept, playerEl(e.player), chipEl(e.player, e.species), step);
      tokens(e.discarded.slice(0, 3), playerEl(e.player), pileEl("discard"), step);
    }
    if ((e.type === "kick" || e.type === "spectate") && e.player !== next.you) {
      tokens(Array(Math.min(e.hand.length, 3)).fill(null), playerEl(e.player), pileEl("discard"), step);
      tokens(e.collection.slice(0, 3), playerEl(e.player), pileEl("discard"), step);
    }
  });
  if (roundStep >= 0)
    for (const p of ng.players) {
      if (p.id === next.you) continue;
      tokens(Array(2).fill(null), playerEl(p.id), pileEl("discard"), roundStep);
      tokens(Array(3).fill(null), pileEl("deck"), playerEl(p.id), roundStep + 1);
    }
}

// A fixed-position copy of a card, so it can cross clipped containers.
function ghost(node, inHand, rect) {
  node.removeAttribute("data-card");
  node.style.visibility = "";
  const wrap = document.createElement("div");
  wrap.className = inHand ? "ghost hand-group" : "ghost";
  wrap.setAttribute("aria-hidden", "true");
  Object.assign(wrap.style, {
    left: rect.left + "px",
    top: rect.top + "px",
    width: rect.width + "px",
    height: rect.height + "px",
  });
  wrap.append(node);
  document.body.append(wrap);
  return wrap;
}
function animate(wrap, frames, step, extra = 0) {
  return wrap.animate(frames, {
    duration: DURATION,
    delay: step * STEP + extra,
    easing: EASE,
    fill: "both",
  });
}
// Hide the real card while its copy is in the air, then swap back.
function landOn(el, animation, wrap) {
  el.style.visibility = "hidden";
  const done = () => {
    wrap.remove();
    el.style.visibility = "";
  };
  animation.finished.then(done, done);
}
function flyCard(el, from, to, step) {
  const wrap = ghost(el.cloneNode(true), !!el.closest(".hand-group"), to);
  const a = center(from),
    b = center(to);
  const first = `translate(${a.x - b.x}px,${a.y - b.y}px) scale(${from.width / to.width},${from.height / to.height})`;
  landOn(el, animate(wrap, [{ transform: first }, { transform: "none" }], step), wrap);
}
function arrive(el, from, to, step) {
  const wrap = ghost(el.cloneNode(true), !!el.closest(".hand-group"), to);
  let first = { transform: "scale(.8)", opacity: 0 };
  if (from) {
    const a = center(from),
      b = center(to);
    first = { transform: `translate(${a.x - b.x}px,${a.y - b.y}px) scale(.3)`, opacity: 0 };
  }
  landOn(el, animate(wrap, [first, { transform: "none", opacity: 1 }], step), wrap);
}
function depart(old, target, step) {
  const holder = document.createElement("div");
  holder.innerHTML = old.html;
  const wrap = ghost(holder.firstElementChild, old.inHand, old.rect);
  let last = { transform: "scale(.85)", opacity: 0 };
  if (target) {
    const a = center(old.rect),
      b = center(target);
    last = { transform: `translate(${b.x - a.x}px,${b.y - a.y}px) scale(.3)`, opacity: 0.3 };
  }
  const done = () => wrap.remove();
  animate(wrap, [{ transform: "none", opacity: 1 }, last], step).finished.then(done, done);
}
function slide(el, from, to) {
  el.animate(
    [{ transform: `translate(${from.left - to.left}px,${from.top - to.top}px)` }, { transform: "none" }],
    { duration: 300, easing: EASE },
  );
}
// Small cards for moves nobody can see in full: face up when the card is known, backs otherwise.
function tokens(cards, fromEl, toEl, step) {
  if (!fromEl || !toEl || !cards.length) return;
  const sample = one("#app .row-cards .card")?.getBoundingClientRect() ?? { width: 94, height: 119 };
  const from = center(fromEl.getBoundingClientRect()),
    to = center(toEl.getBoundingClientRect());
  const rect = {
    left: from.x - sample.width / 2,
    top: from.y - sample.height / 2,
    width: sample.width,
    height: sample.height,
  };
  cards.forEach((card, i) => {
    let node;
    if (card) {
      const holder = document.createElement("div");
      render(html`<${Card} card=${card} />`, holder);
      node = holder.firstElementChild;
    } else {
      node = document.createElement("div");
      node.className = "card card-back";
    }
    const wrap = ghost(node, false, rect);
    const done = () => wrap.remove();
    animate(
      wrap,
      [
        { transform: "scale(.3)", opacity: 0 },
        { transform: "scale(.45)", opacity: 1, offset: 0.25 },
        { transform: `translate(${to.x - from.x}px,${to.y - from.y}px) scale(.3)`, opacity: 0.2 },
      ],
      step,
      i * 70,
    ).finished.then(done, done);
  });
}
