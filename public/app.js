import { SPECIES } from "./species.js";
const $ = (s) => document.querySelector(s),
  app = $("#app");
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ]),
  );
let token = sessionStorage.getItem("bird-token"),
  state,
  selected = null,
  busy = false,
  config,
  discord = false;
const bird = (id) => SPECIES.find((s) => s.id === id);
const counts = (cards) =>
  SPECIES.map((s) => ({
    ...s,
    n: cards.filter((c) => c === s.id).length,
  })).filter((s) => s.n);
function notice(message) {
  $("#notice").textContent = message;
}
async function api(path, data) {
  const res = await fetch("/api/" + path, {
    method: data ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Connection failed.");
  return result;
}
function card(id, n, interactive = false) {
  const s = bird(id);
  return `<${interactive ? "button" : "div"} class="card ${
    selected === id && interactive ? "selected" : ""
  }" style="--bird:${s.color}" ${
    interactive
      ? `data-bird="${id}" aria-label="Select ${escape(
          s.name,
        )}" aria-pressed="${selected === id}"`
      : ""
  }><div class="card-top"><span class="breakpoints" aria-label="Small flock ${
    s.small
  }, big flock ${s.big}"><span class="${
    n >= s.small && n < s.big ? "flock-ready" : ""
  }">${s.small}</span><span class="${n >= s.big ? "flock-ready" : ""}">${
    s.big
  }</span></span><strong>${escape(s.name)}</strong></div><div class="art">${
    s.image
      ? `<img src="${escape(s.image)}" alt="">`
      : `<span>${escape(s.name.slice(0, 2).toUpperCase())}</span>`
  }</div></${interactive ? "button" : "div"}>`;
}
function handGroup(s) {
  return `<button class="hand-group ${
    selected === s.id ? "group-selected" : ""
  }" data-bird="${s.id}" aria-pressed="${
    selected === s.id
  }" aria-label="Select ${s.n} ${escape(s.name)} cards">${Array.from(
    { length: s.n },
    (_, i) => card(s.id, i === s.n - 1 ? s.n : 0),
  ).join("")}</button>`;
}
function entrance() {
  state = null;
  $("#copy").hidden = true;
  $("#leave-room").hidden = true;
  app.innerHTML = `<section class="welcome"><h1>Take a seat.<br>Bring your friends.</h1><p>1–5 players</p><div class="entry"><label>Your name<input id="name" maxlength="24" placeholder="Player" ${
    discord || token ? "disabled" : ""
  } value="${escape(
    sessionStorage.getItem("bird-name") || "",
  )}"></label><button id="create" class="primary">Create a table</button><div class="divider">or join your friends</div><label>Table code<input id="code" maxlength="8" placeholder="8-character code" autocomplete="off"></label><button id="join">Join table</button></div>${
    config?.canResetRooms
      ? '<div class="reset-rooms"><button id="delete-rooms">Delete all rooms</button></div>'
      : ""
  }</section>`;
  $("#create").onclick = () => join(true);
  $("#join").onclick = () => join(false);
  if ($("#delete-rooms"))
    $("#delete-rooms").onclick = () => {
      $("#reset-password").value = "";
      $("#reset-error").textContent = "";
      $("#reset-dialog").showModal();
      $("#reset-password").focus();
    };
}
async function join(create) {
  if (busy) return;
  busy = true;
  try {
    if (!token) {
      const login = await api("login", { name: $("#name").value });
      token = login.token;
      sessionStorage.setItem("bird-token", token);
      sessionStorage.setItem("bird-name", login.name);
    }
    state = await api("join", { create, code: $("#code").value });
    sessionStorage.setItem("bird-room", state.code);
    render();
    notice("");
  } catch (e) {
    notice(e.message);
  } finally {
    busy = false;
  }
}
function render() {
  if (!state) return;
  const g = state.game;
  $("#copy").hidden = false;
  $("#leave-room").hidden = false;
  $("#copy").innerHTML = `<span>Table ${state.code}</span><small>${
    g ? "Round " + g.round : "Lobby"
  } · Copy code</small>`;
  app.innerHTML = `<div class="scoreboard"><div class="players">${state.players
    .map((p) => {
      const gp = g?.players.find((x) => x.id === p.id);
      return `<section class="player ${
        g && g.phase !== "over" && g.players[g.turn].id === p.id ? "active" : ""
      }"><strong>${escape(p.name)}${p.id === state.you ? " (you)" : ""}${
        p.id === state.host ? " · host" : ""
      }${p.away ? " · away" : ""}</strong><small>${
        gp
          ? `${gp.handCount} in hand · ${new Set(gp.collection).size}/7 species`
          : "Ready to play"
      }</small>${
        gp
          ? `<div class="collection">${counts(gp.collection)
              .map(
                (s) =>
                  `<span style="--bird:${s.color}">${escape(s.name)} ×${
                    s.n
                  }</span>`,
              )
              .join("")}</div>`
          : ""
      }</section>`;
    })
    .join("")}</div>${
    g
      ? `<aside class="deck-state" aria-label="Deck state"><span><b>${g.deckCount}</b> in deck</span><span><b>${g.discardCount}</b> discarded</span></aside>`
      : ""
  }</div>${
    g
      ? gameMarkup(g)
      : `<section class="lobby"><h2>${
          state.players.length
        }/5 players seated</h2><p>Start on your own to test, or share the table code with friends.</p>${
          state.host === state.you
            ? `<button id="start" class="primary" ${
                state.players.length < 1 ? "disabled" : ""
              }>Start game</button>`
            : "<p>The host will start when everyone is here.</p>"
        }<button id="leave">Leave table</button></section>`
  }`;
  $("#copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(state.code);
      notice("Table code copied.");
    } catch {
      notice("Table code: " + state.code);
    }
  };
  if ($("#start")) $("#start").onclick = () => act("start");
  if ($("#leave"))
    $("#leave").onclick = async () => {
      await act("leave");
    };
  document.querySelectorAll("[data-bird]").forEach(
    (el) =>
      (el.onclick = () => {
        selected = el.dataset.bird;
        render();
      }),
  );
  document
    .querySelectorAll("[data-row]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          act("move", {
            type: "lay",
            bird: selected,
            row: Number(el.dataset.row),
            side: el.dataset.side,
          })),
    );
  if ($("#draw"))
    $("#draw").onclick = () => act("move", { type: "draw", take: true });
  if ($("#skipdraw"))
    $("#skipdraw").onclick = () => act("move", { type: "draw", take: false });
  if ($("#pass")) $("#pass").onclick = () => act("move", { type: "pass" });
  if ($("#flock"))
    $("#flock").onclick = () => act("move", { type: "flock", bird: selected });
}
function gameMarkup(g) {
  const me = g.players.find((p) => p.id === state.you),
    mine = g.players[g.turn].id === state.you,
    playing = mine && g.phase === "lay",
    s = bird(selected),
    n = me.hand.filter((c) => c === selected).length;
  const prompts = {
    lay: "Choose a bird in your hand, then choose a row end.",
    draw: "No birds captured. Draw two cards or skip.",
    flock: "Complete one flock, or end your turn.",
    over: "Game complete.",
  };
  return `<div class="rows ${
    mine && g.phase !== "over" ? "my-turn" : ""
  }">${g.rows
    .map(
      (row, i) =>
        `<section class="row"><button data-row="${i}" data-side="left" aria-label="Place left of row ${
          i + 1
        }" ${
          !playing || !n ? "disabled" : ""
        }><span class="pixel-plus" aria-hidden="true"></span></button><div class="row-cards">${row
          .map((id) => card(id))
          .join(
            "",
          )}</div><button data-row="${i}" data-side="right" aria-label="Place right of row ${
          i + 1
        }" ${
          !playing || !n ? "disabled" : ""
        }><span class="pixel-plus" aria-hidden="true"></span></button></section>`,
    )
    .join(
      "",
    )}</div><div class="hand-heading"><div><p class="eyebrow">ONLY YOU CAN SEE THESE</p><h2>Your hand <small>(${
    me.hand.length
  })</small></h2></div>${
    mine && g.phase !== "over"
      ? `<section class="turn" aria-live="polite"><strong>Your turn</strong><span>${
          prompts[g.phase]
        }</span></section>`
      : ""
  }${
    g.phase === "over"
      ? `<section class="game-result" role="status">${g.players
          .filter((p) => g.winners.includes(p.id))
          .map((p) => escape(p.name))
          .join(" & ")} won!</section>`
      : ""
  }</div><section class="hand"><div class="actions">${
    mine && g.phase === "draw"
      ? '<button id="draw" class="primary">Draw two</button><button id="skipdraw">Skip draw</button>'
      : ""
  }${
    mine && g.phase === "flock"
      ? `<button id="flock" class="primary" ${
          !s || n < s.small ? "disabled" : ""
        }>Complete ${s ? escape(s.name) + " " : ""}flock${
          s && n >= s.small ? ` · keep ${n >= s.big ? 2 : 1}` : ""
        }</button><button id="pass">End turn</button>`
      : ""
  }${
    g.phase === "over" && state.you === state.host
      ? '<button id="start" class="primary">Play again</button>'
      : ""
  }${
    g.phase === "over" ? '<button id="leave">Leave table</button>' : ""
  }</div><div class="hand-cards">${
    counts(me.hand).map(handGroup).join("") || "<p>Your hand is empty.</p>"
  }</div></section><details class="history"><summary>Table history</summary>${g.log
    .slice()
    .reverse()
    .map((line) => `<p>${escape(line)}</p>`)
    .join("")}</details>`;
}
async function act(path, action) {
  if (busy) return;
  busy = true;
  try {
    const result = await api(path, { version: state.version, action });
    selected = null;
    if (path === "leave") {
      sessionStorage.removeItem("bird-room");
      entrance();
      notice(
        result.saved
          ? "Left room " +
              result.code +
              ". Your seat is saved; rejoin with this code."
          : "You left the room.",
      );
    } else {
      state = result;
      render();
      notice("");
    }
  } catch (e) {
    notice(e.message);
  } finally {
    busy = false;
  }
}
$("#leave-room").onclick = () => act("leave");
$("#help").onclick = () => $("#rules").showModal();
async function boot() {
  try {
    config = await api("config");
    discord = new URLSearchParams(location.search).has("frame_id");
    if (discord) {
      if (!config.clientId)
        throw new Error("Discord Client ID is missing on the server.");
      const { DiscordSDK } = await import("./discord-sdk.js");
      const sdk = new DiscordSDK(config.clientId);
      await sdk.ready();
      const { code } = await sdk.commands.authorize({
        client_id: config.clientId,
        response_type: "code",
        state: "",
        prompt: "none",
        scope: ["identify"],
      });
      const login = await api("login", { code });
      await sdk.commands.authenticate({ access_token: login.access_token });
      token = login.token;
      sessionStorage.setItem("bird-token", token);
    } else if (!config.guests)
      throw new Error("Open this game inside Discord.");
    if (token) {
      try {
        state = await api("state");
        render();
        return;
      } catch {}
      const room = sessionStorage.getItem("bird-room");
      if (room) {
        try {
          state = await api("join", { code: room });
          render();
          return;
        } catch {
          sessionStorage.removeItem("bird-room");
        }
      }
      if (!discord) {
        try {
          const me = await api("me");
          sessionStorage.setItem("bird-name", me.name);
        } catch {
          token = null;
          sessionStorage.removeItem("bird-token");
          sessionStorage.removeItem("bird-name");
        }
      }
    }
    entrance();
  } catch (e) {
    app.innerHTML =
      '<section class="welcome"><h1>Could not connect</h1><p id="boot-error"></p><button onclick="location.reload()">Try again</button></section>';
    $("#boot-error").textContent = e.message;
  }
}
await boot();
// Short polling keeps networking same-origin through Discord's Activity proxy.
setInterval(async () => {
  if (!state || busy) return;
  const pollingRoom = state.code;
  try {
    const next = await api("state");
    if (!state || busy || state.code !== pollingRoom) return;
    if (next.version !== state.version) {
      state = next;
      render();
    }
    if ($("#notice").textContent.startsWith("Connection lost"))
      notice("Reconnected.");
  } catch (e) {
    if (e.message === "Join a table first.") {
      sessionStorage.removeItem("bird-room");
      entrance();
      notice("This room was removed. Create a new room or join by code.");
    } else notice("Connection lost. Retrying… " + e.message);
  }
}, 1000);

async function resetRooms(event) {
  event.preventDefault();
  if (busy) return;
  busy = true;
  $("#reset-submit").disabled = true;
  try {
    const result = await api("reset-rooms", {
      password: $("#reset-password").value,
    });
    $("#reset-dialog").close();
    $("#reset-password").value = "";
    selected = null;
    sessionStorage.removeItem("bird-room");
    entrance();
    notice(
      result.deleted +
        " room" +
        (result.deleted === 1 ? "" : "s") +
        " deleted. The server is ready for new rooms.",
    );
  } catch (e) {
    $("#reset-error").textContent = e.message;
    $("#reset-password").select();
  } finally {
    busy = false;
    $("#reset-submit").disabled = false;
  }
}
$("#reset-form").onsubmit = resetRooms;
$("#reset-cancel").onclick = () => {
  $("#reset-dialog").close();
  $("#reset-password").value = "";
};
