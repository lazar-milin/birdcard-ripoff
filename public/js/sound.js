// Before editing, read CLAUDE.md at the repo root, especially "Client".
// Short interface cues through Web Audio. Sound stays muted until the player turns it on.
import { changedEvents } from "./events.js";

const KEY = "bird-sound-muted";
const files = { lay: "click_001", capture: "drop_001", flock: "confirmation_001", turn: "select_001", over: "confirmation_004" };
let muted = true;
try { muted = localStorage.getItem(KEY) !== "false"; } catch {}
let context, master, loading;
const buffers = new Map();
const sources = new Set();
const listeners = new Set();
export const isMuted = () => muted;
export function subscribeSound(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function applyMute(value) {
  muted = value;
  if (master) master.gain.setValueAtTime(muted ? 0 : 0.12, context.currentTime);
  if (muted) for (const source of sources) { try { source.stop(); } catch {} }
  listeners.forEach((fn) => fn(muted));
}
export function toggleSound() {
  unlockSound();
  applyMute(!muted);
  try { localStorage.setItem(KEY, String(muted)); } catch {}
}

// Called synchronously from a trusted click/key event, including inside an iframe.
export function unlockSound() {
  try {
    if (!context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      context = new Audio();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.12;
      master.connect(context.destination);
    }
    if (context.state !== "running") context.resume().catch(() => {});
    if (!loading) loading = Promise.all(Object.entries(files).map(async ([cue, name]) => {
      try {
        const res = await fetch(`/audio/${name}.ogg`);
        if (!res.ok) return;
        const buffer = await context.decodeAudioData(await res.arrayBuffer());
        // Normalize peaks so all five cues remain similarly quiet.
        let peak = 0;
        for (let c = 0; c < buffer.numberOfChannels; c++)
          for (const v of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
        buffers.set(cue, { buffer, peak: Math.max(peak, 0.01) });
      } catch { /* Missing/unsupported audio must never interrupt the game. */ }
    }));
  } catch { /* Audio is optional. Retry on the next interaction. */ }
}

export function installSoundUnlock() {
  document.addEventListener("click", unlockSound, true);
  document.addEventListener("keydown", unlockSound, true);
  const sync = (e) => { if (e.key === KEY || e.key === null) {
    try { applyMute(localStorage.getItem(KEY) !== "false"); } catch { applyMute(true); }
  } };
  window.addEventListener("storage", sync);
  return () => {
    document.removeEventListener("click", unlockSound, true);
    document.removeEventListener("keydown", unlockSound, true);
    window.removeEventListener("storage", sync);
  };
}

function cue(name, delay) {
  const item = buffers.get(name);
  if (!item || muted || context?.state !== "running") return;
  const source = context.createBufferSource(), gain = context.createGain();
  const when = context.currentTime + delay, duration = Math.min(item.buffer.duration, 0.45);
  source.buffer = item.buffer;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(1 / item.peak, when + 0.005);
  gain.gain.setValueAtTime(1 / item.peak, when + Math.max(0.005, duration - 0.025));
  gain.gain.linearRampToValueAtTime(0, when + duration);
  source.connect(gain); gain.connect(master); sources.add(source);
  source.onended = () => { sources.delete(source); source.disconnect(); gain.disconnect(); };
  source.start(when); source.stop(when + duration);
}

export function playSounds(prev, next) {
  const events = changedEvents(prev, next);
  const names = events.filter((e) => ["lay", "capture", "flock", "over"].includes(e.type) ||
    (e.type === "turn" && e.player === next.you)).map((e) => e.type);
  if (muted || !context || !names.length) return;
  const received = Date.now();
  const play = () => {
    if (Date.now() - received > 1000) return; // Never replay a backlog after suspension.
    [...new Set(names)].forEach((name, i) => cue(name, i * 0.14));
  };
  // No document.hidden or animation-frame gate: background turn cues still play.
  if (context.state === "running") play();
  else context.resume().then(play).catch(() => {});
}
