"use strict";
/* RAT'S KITCHEN — client. Rendering only; all rules live server-side in
   game/engine.js, and all legality in game/legality.js (served to us as
   /legality.js so there is exactly ONE copy of the rules). */

const socket = io();

let myId = null, roomCode = null, hostId = null, state = null;
let APP_VERSION = "?";

const $ = (id) => document.getElementById(id);

const LABELS = window.RK_CARD_LABELS || {};
const TEXT = window.RK_CARD_TEXT || {};
const REACTIVE = RKLegality.REACTIVE;
const ATTACKS = new Set(["hi", "hcv", "hot_ratato", "exterminator", "hot_chilli", "the_sweep"]);
const DEFENSIVE = new Set(["wok_block", "sleeper", "snitch", "bolt_hole", "territorial", "board_up"]);

function cardClass(t) {
  if (ATTACKS.has(t)) return "atk";
  if (DEFENSIVE.has(t)) return "def";
  return "eco";
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* a rat, drawn rather than an emoji — reads at 21px */
function ratSVG(cls) {
  return `<svg class="pip ${cls}" viewBox="0 0 26 16" fill="none" aria-hidden="true">
    <path d="M5 10 Q1 10.5 1.6 5.5" stroke="currentColor" stroke-width="1.4"
          stroke-linecap="round"/>
    <ellipse cx="12" cy="9.6" rx="7" ry="4.7" fill="currentColor"/>
    <circle cx="19.6" cy="7.6" r="3.5" fill="currentColor"/>
    <circle cx="17.6" cy="3.7" r="2.1" fill="currentColor"/>
    <circle cx="21.9" cy="7.2" r="0.8" fill="#0f1315"/>
  </svg>`;
}

/* ── session ───────────────────────────────────────── */
function saveSession() {
  try {
    sessionStorage.setItem("rk", JSON.stringify({
      roomCode, myId, name: ($("nameInput").value || "").trim(),
    }));
  } catch (e) { /* private browsing */ }
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem("rk") || "null"); }
  catch (e) { return null; }
}

/* ── toast ─────────────────────────────────────────── */
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}
function handle(res) { if (res && res.error) toast(res.error); }

/* ── sheet ─────────────────────────────────────────── */
function openSheet(title, body, options, { hideCancel = false, cancelLabel = "Cancel", onCancel } = {}) {
  $("modalTitle").textContent = title;
  $("modalBody").textContent = body || "";
  const wrap = $("modalOptions");
  wrap.innerHTML = "";
  (options || []).forEach((o) => {
    const b = document.createElement("button");
    b.className = "opt";
    b.innerHTML = `<span class="opt-col"><span>${esc(o.label)}</span>${
      o.sub ? `<span class="opt-sub">${esc(o.sub)}</span>` : ""
    }${o.pips || ""}</span>`;
    b.onclick = () => { closeSheet(); o.action(); };
    wrap.appendChild(b);
  });
  const c = $("modalCancel");
  c.textContent = cancelLabel;
  c.classList.toggle("hidden", hideCancel);
  c.onclick = () => { closeSheet(); onCancel && onCancel(); };
  $("modal").classList.remove("hidden");
}
function closeSheet() { $("modal").classList.add("hidden"); }

/* ── screens ───────────────────────────────────────── */
function showScreen(id) {
  ["landing", "lobby", "game"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
}

/* ── landing ───────────────────────────────────────── */
$("createBtn").onclick = () => {
  const name = ($("nameInput").value || "").trim() || "Chef";
  socket.emit("createRoom", { name }, (res) => {
    if (res.error) return ($("landingError").textContent = res.error);
    roomCode = res.code; myId = res.seatId; hostId = res.hostId;
    saveSession();
    $("lobbyCode").textContent = roomCode;
    showScreen("lobby");
  });
};

$("joinBtn").onclick = () => {
  const name = ($("nameInput").value || "").trim() || "Chef";
  const code = ($("codeInput").value || "").trim().toUpperCase();
  if (code.length !== 4) return ($("landingError").textContent = "That code needs four letters");
  socket.emit("joinRoom", { code, name }, (res) => {
    if (res.error) return ($("landingError").textContent = res.error);
    roomCode = res.code; myId = res.seatId; hostId = res.hostId;
    saveSession();
    $("lobbyCode").textContent = roomCode;
    showScreen("lobby");
  });
};

/* ── lobby ─────────────────────────────────────────── */
$("addBotBtn").onclick = () => socket.emit("addBot", {}, handle);
$("startBtn").onclick = () => socket.emit("startGame", {}, handle);

socket.on("lobby", (lob) => {
  hostId = lob.hostId;
  const amHost = myId === hostId;
  $("seatCount").textContent = `${lob.seats.length} / 8`;
  $("seatList").innerHTML = lob.seats.map((s) => `
    <div class="seat ${s.isBot ? "is-bot" : ""} ${s.id === myId ? "is-me" : ""}">
      <span class="seat-name">${esc(s.name)}${s.id === myId ? " — you" : ""}</span>
      ${s.isBot ? '<span class="pill bot">Bot</span>' : ""}
      ${s.id === lob.hostId ? '<span class="pill host">Host</span>' : ""}
      ${!s.isBot && !s.connected ? '<span class="pill gone">Away</span>' : ""}
      ${amHost && s.id !== lob.hostId
        ? `<button class="seat-drop" data-drop="${s.id}" aria-label="Remove">×</button>` : ""}
    </div>`).join("");

  document.querySelectorAll("[data-drop]").forEach((b) => {
    b.onclick = () => socket.emit("removeSeat", { targetSeatId: b.dataset.drop }, handle);
  });

  $("addBotBtn").disabled = !amHost || lob.seats.length >= 8;
  $("startBtn").disabled = !amHost || lob.seats.length < 2;
  $("hostHint").textContent = amHost
    ? (lob.seats.length < 2 ? "Add a bot or wait for someone to join." : "Ready when you are.")
    : "Waiting for the host to start service.";
});

/* ── game state ────────────────────────────────────── */
socket.on("state", (st) => {
  state = st;
  showScreen("game");
  render();
});

function nameOf(id) {
  const p = state.players.find((x) => x.id === id);
  return p ? p.name : "someone";
}
function me() { return state.players.find((p) => p.id === myId); }

function render() {
  renderTurnBar();
  renderDockets();
  renderHand();
  renderLog();
  renderPrompts();
}

function renderTurnBar() {
  const bar = $("turnBar");
  if (state.winner) {
    bar.className = "turn-bar won";
    bar.innerHTML = state.winner === "none"
      ? `<span class="turn-who">Kitchen closed</span><span class="turn-note">Nobody walked out with it</span>`
      : `<span class="turn-who">${esc(nameOf(state.winner))} takes the kitchen</span>
         <span class="turn-note">Service over</span>`;
    return;
  }
  const mine = state.activeId === myId;
  bar.className = "turn-bar" + (mine ? " mine" : "");
  bar.innerHTML = mine
    ? `<span class="turn-who">You're on</span><span class="turn-note">Play what you can, then end turn</span>`
    : `<span class="turn-who">${esc(nameOf(state.activeId))} is on</span><span class="turn-note">Hold tight</span>`;
}

function pipRow(label, count, cls, target) {
  const pips = [];
  for (let i = 0; i < target; i++) {
    pips.push(i < count ? ratSVG(cls) : ratSVG(cls + " empty"));
  }
  const over = count > target ? `<span class="count">+${count - target}</span>` : "";
  return `<div class="row">
      <span class="row-lbl">${label}</span>
      <span class="pips">${pips.join("")}${over}</span>
    </div>`;
}

function renderDockets() {
  $("dockets").innerHTML = state.players.map((p) => {
    const cls = ["docket",
      p.id === state.activeId && !state.winner ? "on" : "",
      p.id === myId ? "mine" : "",
      p.alive ? "" : "out",
      p.pendingWin ? "notice" : "",
    ].filter(Boolean).join(" ");

    const hp = [0, 1, 2].map((i) => `<i class="${i < p.hp ? "lit" : ""}"></i>`).join("");

    const marks = [];
    if (p.cats > 0) marks.push(`<span class="mark cat">Cat${p.cats > 1 ? " ×" + p.cats : ""}</span>`);
    if (p.boltHoles > 0) marks.push(`<span class="mark hold">Bolt hole${p.boltHoles > 1 ? " ×" + p.boltHoles : ""}</span>`);
    if (p.trapped) marks.push(`<span class="mark">Trap set</span>`);
    if (p.shielded) marks.push(`<span class="mark hold">Boarded up</span>`);
    if (p.buns > 0) marks.push(`<span class="mark">Bun in the oven</span>`);
    marks.push(`<span class="mark">${p.handCount} in hand</span>`);

    const catPay = (p.id === myId && p.cats > 0 && state.activeId === myId && !state.winner)
      ? `<div class="cat-pay">
           <button class="btn" data-cat="remove">1 food · send it off</button>
           <button class="btn" data-cat="lure">2 food · send it to someone</button>
         </div>` : "";

    return `<div class="${cls}">
      ${p.pendingWin ? '<span class="stamp">On notice</span>' : ""}
      <div class="d-head">
        <span class="d-name ${p.id === myId ? "d-you" : ""}">${esc(p.name)}</span>
        ${p.isBot ? '<span class="pill bot">Bot</span>' : ""}
        <span class="hp" title="Health">${hp}</span>
      </div>
      <div class="tally">
        ${pipRow("Good", p.score, "crew", 3)}
        ${pipRow("Bad", p.badScore, "stray", 3)}
      </div>
      <div class="marks">${marks.join("")}</div>
      ${catPay}
    </div>`;
  }).join("");

  document.querySelectorAll("[data-cat]").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.cat === "remove") {
        socket.emit("removeCat", { method: "remove" }, handle);
      } else {
        pickTarget("Send the cat where?", "It blocks every rat entering that kitchen.",
          state.players.filter((p) => p.alive && p.id !== myId),
          (id) => socket.emit("removeCat", { method: "lure", lureTargetId: id }, handle));
      }
    };
  });
}

/* ── hand ──────────────────────────────────────────── */
function renderHand() {
  const m = me();
  const hand = (m && m.hand) || [];
  const myTurn = state.activeId === myId && !state.winner;
  const busy = !!state.pendingAttack || !!state.pendingTrap;

  $("handMeta").innerHTML =
    `<span>Your hand · ${hand.length}</span><span>${state.deckCount} left in the deck</span>`;

  $("hand").innerHTML = hand.map((c) => {
    const playable = RKLegality.isPlayable(c.type, state, myId);
    const t = TEXT[c.type] || {};
    const why = playable ? "" : RKLegality.whyNot(c.type, state, myId);
    return `<div class="slot">
      <button class="pc ${cardClass(c.type)}${playable ? "" : " dead"}"
        data-cid="${c.id}" data-ctype="${c.type}"
        ${myTurn && !busy && playable ? "" : "disabled"}>
        <span class="pc-band"></span>
        <span class="pc-name">${esc(LABELS[c.type] || c.type)}</span>
        <span class="pc-txt">${esc(playable ? (t.short || "") : why)}</span>
      </button>
      <button class="pc-why" data-why="${c.type}" aria-label="What does this do?">?</button>
    </div>`;
  }).join("");

  document.querySelectorAll("#hand .pc").forEach((b) => {
    const type = b.dataset.ctype;
    b.onclick = () => onCardTap(b.dataset.cid, type);
    let timer = null;
    const start = () => { timer = setTimeout(() => { timer = null; cardInfo(type); }, 430); };
    const stop = () => { if (timer) { clearTimeout(timer); timer = null; } };
    b.addEventListener("touchstart", start, { passive: true });
    b.addEventListener("touchend", stop);
    b.addEventListener("touchmove", stop);
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); cardInfo(type); });
  });
  document.querySelectorAll("#hand .pc-why").forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); cardInfo(b.dataset.why); };
  });

  $("endTurnBtn").disabled = !myTurn || busy;
}
$("endTurnBtn").onclick = () => socket.emit("endTurn", {}, handle);

function cardInfo(type) {
  const t = TEXT[type] || {};
  let body = t.full || "No description yet.";
  if (t.timed) body += "\n\nLasts until the start of your next turn.";
  if (t.whenDrawn) body += "\n\nWhen Drawn — it resolves the instant it's drawn. You never hold it.";
  if (t.simplified) body += "\n\nSimplified in this build: " + t.simplified;
  if (state && !RKLegality.isPlayable(type, state, myId)) {
    body += "\n\nRight now: " + RKLegality.whyNot(type, state, myId);
  }
  openSheet(LABELS[type] || type, body, [], { cancelLabel: "Close" });
}

/* ── targeting ─────────────────────────────────────── */
function targetsFor(type, opts) {
  const ids = RKLegality.legalTargets(type, state, myId, opts) || [];
  return state.players.filter((p) => ids.includes(p.id));
}

function pickTarget(title, body, list, cb) {
  if (!list.length) return toast("Nobody to target");
  openSheet(title, body, list.map((p) => ({
    label: p.name,
    sub: `${p.hp} health`,
    pips: `<span class="mini-pips">${
      [...Array(p.score)].map(() => ratSVG("crew")).join("")
    }${
      [...Array(p.badScore)].map(() => ratSVG("stray")).join("")
    }</span>`,
    action: () => cb(p.id),
  })));
}

function onCardTap(cardId, type) {
  if (REACTIVE.has(type)) return toast("Keep it — you'll be offered it when you're hit");
  if (!RKLegality.isPlayable(type, state, myId)) {
    return toast(RKLegality.whyNot(type, state, myId));
  }

  if (type === "food") {
    return openSheet("Food", "Feed yourself, or hold it back for the cat.", [
      { label: "Heal 1 health", action: () => play(cardId, null, { use: "heal" }) },
      { label: "Bin it", sub: "No effect", action: () => play(cardId, null, { use: "discard" }) },
    ]);
  }

  if (type === "hot_ratato") {
    const steal = targetsFor(type, { mode: "steal" });
    const dump = targetsFor(type, { mode: "dump" });
    const modes = [];
    if (steal.length) modes.push({
      label: "Take one of theirs", sub: "Steal a good rat",
      action: () => pickTarget("Take from who?", "", steal,
        (id) => play(cardId, id, { mode: "steal" })),
    });
    if (dump.length) modes.push({
      label: "Palm off a bad rat", sub: "Move one of yours to them",
      action: () => pickTarget("Give it to who?", "", dump,
        (id) => play(cardId, id, { mode: "dump" })),
    });
    if (modes.length === 1) return modes[0].action();
    return openSheet("Hot Ratato", "Two ways to play it.", modes);
  }

  if (type === "rat_trap") {
    return pickTarget("Set the trap where?",
      "It catches the next rat they draw from the deck. You choose whether to keep it.",
      targetsFor(type), (id) => play(cardId, id, {}));
  }

  if (RKLegality.needsTarget(type)) {
    const t = TEXT[type] || {};
    return pickTarget(LABELS[type] || type, t.short || "", targetsFor(type),
      (id) => play(cardId, id, {}));
  }

  play(cardId, null, {});
}

function play(cardId, targetId, opts) {
  socket.emit("playCard", { cardId, targetId, opts }, handle);
}

/* ── forced prompts ────────────────────────────────── */
function renderPrompts() {
  if (state.pendingAttack && state.pendingAttack.targetId === myId) {
    const m = me();
    const reacts = ((m && m.hand) || []).filter((c) => REACTIVE.has(c.type));
    const opts = reacts.map((c) => ({
      label: LABELS[c.type] || c.type,
      sub: (TEXT[c.type] || {}).short || "",
      action: () => socket.emit("respondToAttack",
        { action: { type: "react", cardId: c.id } }, handle),
    }));
    opts.push({
      label: "Take it", sub: "Let it land",
      action: () => socket.emit("respondToAttack", { action: { type: "pass" } }, handle),
    });
    return openSheet(
      LABELS[state.pendingAttack.cardType] || "Incoming",
      `${nameOf(state.pendingAttack.attackerId)} played it on you.`,
      opts, { hideCancel: true });
  }

  if (state.pendingTrap && state.pendingTrap.trapOwnerId === myId) {
    const r = state.pendingTrap.rat || {};
    const good = r.kind === "good";
    return openSheet("Your trap sprung",
      good
        ? `One of the good ones, caught on its way into ${nameOf(state.pendingTrap.fromId)}'s kitchen.`
        : `A bad rat, caught on its way into ${nameOf(state.pendingTrap.fromId)}'s kitchen.`,
      [
        { label: "Keep it", sub: good ? "Counts toward your three" : "Counts against you",
          action: () => socket.emit("trapDecision", { keep: true }, handle) },
        { label: "Let it go", sub: "Back under the deck",
          action: () => socket.emit("trapDecision", { keep: false }, handle) },
      ], { hideCancel: true });
  }

  closeSheet();
}

/* ── log ───────────────────────────────────────────── */
let logOpen = false;
$("logToggle").onclick = () => {
  logOpen = !logOpen;
  $("log").classList.toggle("hidden", !logOpen);
  $("logToggle").textContent = logOpen ? "Hide log" : "Service log";
  if (logOpen) renderLog();
};
function renderLog() {
  if (!logOpen) return;
  $("log").innerHTML = (state.log || []).slice().reverse()
    .map((l) => `<div>${esc(l)}</div>`).join("");
}

/* ── version + rejoin ──────────────────────────────── */
function applyVersion(v) {
  APP_VERSION = v;
  const a = $("versionTag"), b = $("versionTagLobby");
  if (a) a.textContent = "build " + v;
  if (b) b.textContent = "build " + v;
}
socket.on("version", ({ version }) => applyVersion(version));

socket.on("connect", () => {
  socket.emit("getVersion", {}, (res) => { if (res && res.version) applyVersion(res.version); });
  const s = loadSession();
  if (s && s.roomCode && s.myId && !state) {
    socket.emit("joinRoom", { code: s.roomCode, name: s.name, rejoinId: s.myId }, (res) => {
      if (res && res.ok) {
        roomCode = res.code; myId = res.seatId; hostId = res.hostId;
        $("lobbyCode").textContent = roomCode;
        if (!res.rejoined) showScreen("lobby");
      }
    });
  }
});
