// Before editing, read CLAUDE.md at the repo root, especially "Client".
// The client root: boot, session, actions, header panels and long polling.
import { html, render, useState, useEffect, useLayoutEffect, useRef, useCallback } from "./vendor/preact.js";
import { api, session } from "./js/api.js";
import { shouldAutoEnd } from "./js/auto-turn.js";
import { changedEvents } from "./js/events.js";
import { capture, play } from "./js/motion.js";
import { isMuted, toggleSound, subscribeSound, installSoundUnlock, playSounds } from "./js/sound.js";
import { Header, TimerPanel, TableLog, TableScoreboard, DeckPanel, Scoreboard, Table, Lobby, Entrance, ResetDialog } from "./js/ui.js";


function App() {
  const [muted, setMuted] = useState(isMuted);
  useEffect(() => {
    const unsubscribe = subscribeSound(setMuted), cleanup = installSoundUnlock();
    return () => { unsubscribe(); cleanup(); };
  }, []);
  const [screen, setScreen] = useState("boot"); // boot, error, entrance or room
  const [room, setRoom] = useState(null);
  const [notice, setNotice] = useState("");
  const [config, setConfig] = useState(null);
  const [discord, setDiscord] = useState(false);
  const [guestNameReset, setGuestNameReset] = useState(false);
  const [bootError, setBootError] = useState("");
  const [selected, setSelected] = useState(null);
  const [logOpen, setLogOpen] = useState(false);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const roomRef = useRef(null);
  const shown = useRef(null);
  const busy = useRef(false);

  // Only newer state may replace what is on screen, so a slow response can't roll the board back.
  const accept = useCallback((next) => {
    const current = roomRef.current;
    if (current && next.code === current.code && next.version <= current.version) return;
    if (changedEvents(current, next).some((e) => e.timeout && e.player === next.you))
      setNotice("Turn ended because time ran out. A move was made for you.");
    playSounds(current, next);
    capture();
    roomRef.current = next;
    setRoom(next);
  }, []);
  const toEntrance = useCallback((message = "") => {
    roomRef.current = null;
    session.remove("room");
    setRoom(null);
    setSelected(null);
    setLogOpen(false);
    setScoreboardOpen(false);
    setDeckOpen(false);
    setTimerOpen(false);
    setScreen("entrance");
    setNotice(message);
  }, []);

  useLayoutEffect(() => {
    play(shown.current, room);
    shown.current = room;
  }, [room]);

  const act = useCallback(async (path, action, successNotice = "") => {
    if (busy.current || !roomRef.current) return;
    busy.current = true;
    try {
      const result = await api(path, {
        version: roomRef.current.version,
        ...(path === "move" ? { action } : action ?? {}),
      });
      setSelected(null);
      if (path === "leave")
        toEntrance(result.saved ? `Left room ${result.code}. Your seat is saved; rejoin with this code.` : "You left the room.");
      else {
        accept(result);
        setNotice(successNotice);
      }
    } catch (e) {
      setNotice(e.message);
      if (e.status === 409) api("state").then(accept, () => {});
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (screen !== "room" || !shouldAutoEnd(room)) return;
    const timer = setTimeout(() => {
      // A manual move, room switch, or newer state invalidates this timer.
      if (roomRef.current !== room || !shouldAutoEnd(roomRef.current)) return;
      act("move", { type: "pass" }, "Turn ended cause of no viable moves!");
    }, 4000);
    return () => clearTimeout(timer);
  }, [screen, room, act]);

  async function join(create, code, name) {
    if (busy.current) return false;
    busy.current = true;
    try {
      if (!session.get("token")) {
        const login = await api("login", { name });
        session.set("token", login.token);
        session.set("name", login.name);
      }
      const next = await api("join", { create, code });
      session.set("room", next.code);
      setGuestNameReset(false);
      roomRef.current = null;
      accept(next);
      setScreen("room");
      setNotice("");
      return true;
    } catch (e) {
      setNotice(e.message);
      return false;
    } finally {
      busy.current = false;
    }
  }

  function clearGuestName() {
    if (discord) return;
    session.remove("token");
    session.remove("name");
    session.remove("room");
    setGuestNameReset(true);
    setNotice("");
  }

  useEffect(() => {
    (async () => {
      try {
        const cfg = await api("config");
        setConfig(cfg);
        const inDiscord = new URLSearchParams(location.search).has("frame_id");
        setDiscord(inDiscord);
        if (inDiscord) {
          if (!cfg.clientId) throw new Error("Discord Client ID is missing on the server.");
          const { DiscordSDK } = await import("./discord-sdk.js");
          const sdk = new DiscordSDK(cfg.clientId);
          await sdk.ready();
          const { code } = await sdk.commands.authorize({
            client_id: cfg.clientId,
            response_type: "code",
            state: "",
            prompt: "none",
            scope: ["identify"],
          });
          const login = await api("login", { code });
          await sdk.commands.authenticate({ access_token: login.access_token });
          session.set("token", login.token);
          session.set("name", login.name);
        } else if (!cfg.guests) throw new Error("Open this game inside Discord.");
        if (session.get("token")) {
          let removedMessage = "";
          try {
            accept(await api("state"));
            setScreen("room");
            return;
          } catch (e) {
            if (e.message === "The host removed you from this table.") removedMessage = e.message;
          }
          const saved = session.get("room");
          if (saved) {
            try {
              accept(await api("join", { code: saved }));
              setScreen("room");
              return;
            } catch (e) {
              if (e.message === "The host removed you from this table.") removedMessage = e.message;
              session.remove("room");
            }
          }
          if (!inDiscord) {
            try {
              session.set("name", (await api("me")).name);
            } catch {
              session.remove("token");
              session.remove("name");
            }
          }
          if (removedMessage) setNotice(removedMessage);
        }
        setScreen("entrance");
      } catch (e) {
        setBootError(e.message);
        setScreen("error");
      }
    })();
  }, []);

  // Long polling: each request names the version on screen, and the server answers as
  // soon as the table changes, or with the same state after about 25 seconds. Plain
  // same-origin HTTP works through Discord's Activity proxy, and with one request at a
  // time the answers arrive in order. Errors back off from 1 to 10 seconds.
  useEffect(() => {
    if (screen !== "room") return;
    let stopped = false,
      timer,
      failures = 0;
    const tick = async () => {
      const current = roomRef.current;
      if (current) {
        try {
          const next = await api(`state?since=${current.version}`);
          if (stopped) return;
          if (roomRef.current?.code === current.code) accept(next);
          failures = 0;
          setNotice((n) => (n.startsWith("Connection lost") ? "Reconnected." : n));
        } catch (e) {
          if (stopped) return;
          if (e.message === "The host removed you from this table.")
            return toEntrance(e.message);
          if (e.message === "Join a table first.")
            return toEntrance("This room was removed. Create a new room or join by code.");
          failures++;
          setNotice("Connection lost. Retrying… " + e.message);
        }
      }
      const delay = !current ? 500 : failures ? Math.min(1000 * 2 ** (failures - 1), 10000) : 0;
      if (!stopped) timer = setTimeout(tick, delay);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [screen]);

  useEffect(() => {
    if (!logOpen && !scoreboardOpen && !deckOpen && !timerOpen) return;
    const close = (e) => { if (e.key === "Escape") { setLogOpen(false); setScoreboardOpen(false); setDeckOpen(false); setTimerOpen(false); } };
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [logOpen, scoreboardOpen, deckOpen, timerOpen]);

  const inRoom = screen === "room" && room;
  const ctx = room && {
    you: room.you,
    who: (id) =>
      id === room.you
        ? "You"
        : (room.players.find((p) => p.id === id) ?? room.game?.players.find((p) => p.id === id))?.name ?? "A player",
  };
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice("Table code copied.");
    } catch {
      setNotice("Table code: " + room.code);
    }
  }
  async function resetRooms(password) {
    const result = await api("reset-rooms", { password });
    setResetOpen(false);
    toEntrance(`${result.deleted} room${result.deleted === 1 ? "" : "s"} deleted. The server is ready for new rooms.`);
  }

  return html`
    <${Header} deckOpen=${deckOpen} onToggleDeck=${() => { setDeckOpen((o) => !o); setLogOpen(false); setScoreboardOpen(false); setTimerOpen(false); }} timerOpen=${timerOpen} onToggleTimer=${() => { setTimerOpen((o) => !o); setDeckOpen(false); setLogOpen(false); setScoreboardOpen(false); }} muted=${muted} onToggleSound=${toggleSound} room=${inRoom ? room : null} logOpen=${logOpen} onToggleLog=${() => { setLogOpen((o) => !o); setScoreboardOpen(false); setDeckOpen(false); setTimerOpen(false); }} scoreboardOpen=${scoreboardOpen} onToggleScoreboard=${() => { setScoreboardOpen((o) => !o); setLogOpen(false); setDeckOpen(false); setTimerOpen(false); }} onCopy=${copyCode} onLeave=${() => act("leave")}>
      ${inRoom && room.you === room.host && timerOpen && html`<${TimerPanel} seconds=${room.timer ?? 0} onChoose=${(seconds) => { setTimerOpen(false); act("timer", { seconds }); }} onClose=${() => setTimerOpen(false)} />`}
      ${inRoom && room.game && deckOpen && html`<${DeckPanel} game=${room.game} onClose=${() => setDeckOpen(false)} />`}
      ${inRoom && room.game && scoreboardOpen && html`<${TableScoreboard} room=${room} onClose=${() => setScoreboardOpen(false)} />`}
      ${inRoom && room.game && logOpen && html`<${TableLog} game=${room.game} ctx=${ctx} onClose=${() => setLogOpen(false)} />`}
    <//>
    <main id="app">
      ${screen === "boot" && html`<p>Connecting…</p>`}
      ${screen === "error" &&
      html`<section class="welcome">
        <h1>Could not connect</h1>
        <p id="boot-error">${bootError}</p>
        <button onClick=${() => location.reload()}>Try again</button>
      </section>`}
      ${screen === "entrance" &&
      html`<${Entrance}
        canReset=${config?.canResetRooms}
        nameLocked=${discord || (!!session.get("token") && !guestNameReset)}
        canClearName=${!discord && !!session.get("token")}
        discord=${discord}
        initialName=${session.get("name") ?? ""}
        onJoin=${join}
        onClearName=${clearGuestName}
        onReset=${() => setResetOpen(true)}
      />`}
      ${inRoom && html`<${Scoreboard} room=${room} onKick=${(playerId) => act("kick", { playerId })} onRemoveBot=${(botId) => act("bot", { remove: true, botId })} />`}
      ${inRoom &&
      (room.game
        ? html`<${Table} room=${room} ctx=${ctx} selected=${selected} onSelect=${setSelected} act=${act} />`
        : html`<${Lobby} room=${room} act=${act} />`)}
    </main>
    <div id="notice" role="status" aria-live="polite">${notice || null}</div>
    <${ResetDialog} open=${resetOpen} onClose=${() => setResetOpen(false)} onSubmit=${resetRooms} />
  `;
}

render(html`<${App} />`, document.getElementById("root"));
