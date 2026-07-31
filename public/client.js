"use strict";
const socket = io();

let myId = null;
let roomCode = null;
let hostId = null;
let state = null;

const $ = (id) => document.getElementById(id);

const LABELS = {
  hi: "Health Inspection", hcv: "Health Code Violation", hot_ratato: "Hot Ratato",
  wok_block: "Wok Block", sleeper: "Sleeper", bolt_hole: "Bolt Hole",
  exterminator: "Exterminator", the_sweep: "The Sweep", territorial: "Territorial",
  board_up: "Board Up", snitch: "Snitch", rat_trap: "Rat Trap", food: "Food",
  kleptomaniac: "Kleptomaniac", shakedown: "Shakedown", rat_pack: "Rat Pack",
  switcheroo: "Switcheroo", live_wire: "Live Wire", gambit: "Gambit",
  steak_out: "Steak Out", trash_diver: "Trash Diver", hot_chilli: "Hot Chilli",
  big_cheese: "Big Cheese", bun_in_oven: "Bun in the Oven", tag: "Tag",
};
const BLURB = {
  hi: "Fires ALL rats in a kitchen", hcv: "Fires one rat", hot_ratato: "Steal or dump a rat",
  wok_block: "Cancel an attack", sleeper: "Cancel + steal", bolt_hole: "Saves one rat from HI",
  exterminator: "Clears a kitchen", the_sweep: "Clears one rat", territorial: "Blocks theft",
  board_up: "Blocks theft", snitch: "Steal from attacker", rat_trap: "Catch the next drawn rat",
  food: "Heal 1 HP / pay the Cat", kleptomaniac: "Steal a card", shakedown: "Take matching cards",
  rat_pack: "Take their whole hand", switcheroo: "Swap kitchens", live_wire: "Draw 2",
  gambit: "Draw", steak_out: "Draw", trash_diver: "Recover", hot_chilli: "Detonate a rat",
  big_cheese: "Dig for rats", bun_in_oven: "A rat next turn", tag: "Redirect next HI",
};
const ATTACKS = new Set(["hi", "hcv", "hot_ratato", "exterminator", "hot_chilli", "the_sweep"]);
const REACTIVE = RKLegality.REACTIVE;
// NOTE: legality now comes from the SHARED module (game/legality.js), the
// same file the server and bots use. Don't reintroduce local rules here —
// three divergent copies of "what's legal" is exactly what caused players
// being attacked by cards that couldn't do anything.
const CARD_CLASS = (t) =>
  ATTACKS.has(t) ? "atk" : REACTIVE.has(t) || t === "bolt_hole" || t === "territorial" || t === "board_up"
    ? "def" : "eco";

// ── session persistence (survive a refresh mid-game) ────────────────────
function saveSession() {
  try {
    sessionStorage.setItem("rk", JSON.stringify({ roomCode, myId, name: $("nameInput").value }));
  } catch (e) { /* private mode */ }
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem("rk") || "null"); } catch (e) { return null; }
}

// ── toast ────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}
function handle(res) { if (res && res.error) toast(res.error); }

// ── modal ────────────────────────────────────────────────────────────────
function openModal(title, body, options, { hideCancel = false, onCancel } = {}) {
  $("modalTitle").textContent = title;
  $("modalBody").textContent = body || "";
  const wrap = $("modalOptions");
  wrap.innerHTML = "";
  options.forEach((o) => {
    const b = document.createElement("button");
    b.className = "opt";
    b.innerHTML = `<span class="opt-col"><span>${o.label}</span>${
      o.sub ? `<span class="opt-sub">${o.sub}</span>` : ""}</span>`;
    b.onclick = () => { closeModal(); o.action(); };
    wrap.appendChild(b);
  });
  // FORCED prompts (hideCancel: true) have no dismiss route other than
  // picking one of the real options — this is what the freeze bug needed.
  // The previous toggle logic here was broken (`cond ? false : false`
  // always evaluates to "not hidden"), so Cancel was ALWAYS visible,
  // including on the attack-reaction prompt, where tapping it closed the
  // modal without ever telling the server — pendingAttack then sat forever
  // with no client-side way to clear it.
  $("modalCancel").classList.toggle("hidden", hideCancel);
  $("modalCancel").onclick = () => { closeModal(); onCancel && onCancel(); };
  $("modal").classList.remove("hidden");
}
function closeModal() { $("modal").classList.add("hidden"); }

// ── landing ──────────────────────────────────────────────────────────────
$("createBtn").onclick = () => {
  const name = ($("nameInput").value || "").trim() || "Player";
  socket.emit("createRoom", { name }, (res) => {
    if (res.error) return ($("landingError").textContent = res.error);
    roomCode = res.code; myId = res.seatId; hostId = res.hostId;
    saveSession();
    showLobby();
  });
};
$("joinBtn").onclick = () => {
  const name = ($("nameInput").value || "").trim() || "Player";
  const code = ($("codeInput").value || "").trim().toUpperCase();
  if (code.length !== 4) return ($("landingError").textContent = "Enter the 4-letter code");
  socket.emit("joinRoom", { code, name }, (res) => {
    if (res.error) return ($("landingError").textContent = res.error);
    roomCode = res.code; myId = res.seatId; hostId = res.hostId;
    saveSession();
    showLobby();
  });
};

function showScreen(id) {
  ["landing", "lobby", "game"].forEach((s) => $(s).classList.toggle("hidden", s !== id));
}
function showLobby() { showScreen("lobby"); $("lobbyCode").textContent = roomCode; }

// ── lobby ────────────────────────────────────────────────────────────────
$("addBotBtn").onclick = () => socket.emit("addBot", {}, handle);
$("startBtn").onclick = () => socket.emit("startGame", {}, handle);

socket.on("lobby", (lob) => {
  hostId = lob.hostId;
  const amHost = myId === hostId;
  $("seatList").innerHTML = lob.seats.map((s) => `
    <div class="seat">
      <span class="seat-name">${esc(s.name)}${s.id === myId ? " (you)" : ""}</span>
      ${s.isBot ? '<span class="seat-badge bot">BOT</span>' : ""}
      ${s.id === lob.hostId ? '<span class="seat-badge host">HOST</span>' : ""}
      ${!s.isBot && !s.connected ? '<span class="seat-badge off">OFFLINE</span>' : ""}
      ${amHost && s.id !== lob.hostId
        ? `<button class="seat-remove" data-remove="${s.id}">×</button>` : ""}
    </div>`).join("");
  document.querySelectorAll("[data-remove]").forEach((b) => {
    b.onclick = () => socket.emit("removeSeat", { targetSeatId: b.dataset.remove }, handle);
  });
  $("addBotBtn").disabled = !amHost || lob.seats.length >= 8;
  $("startBtn").disabled = !amHost || lob.seats.length < 2;
  $("hostHint").textContent = amHost
    ? `${lob.seats.length}/8 seats. Add bots to fill the table.`
    : "Waiting for the host to start…";
});

// ── game state ───────────────────────────────────────────────────────────
socket.on("state", (st) => {
  state = st;
  showScreen("game");
  render();
});

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function nameOf(id) {
  const p = state.players.find((x) => x.id === id);
  return p ? p.name : "?";
}
function me() { return state.players.find((p) => p.id === myId); }

function render() {
  renderTurnBar();
  renderKitchens();
  renderHand();
  renderLog();
  renderPrompts();
}

function renderTurnBar() {
  const bar = $("turnBar");
  if (state.winner) {
    bar.className = "turn-bar mine";
    bar.innerHTML = state.winner === "none"
      ? "Everyone's out — no winner"
      : `🏆 ${esc(nameOf(state.winner))} wins!`;
    return;
  }
  const mine = state.activeId === myId;
  bar.className = "turn-bar" + (mine ? " mine" : "");
  bar.innerHTML = mine
    ? `Your turn<span class="sub">Play cards, then end turn</span>`
    : `${esc(nameOf(state.activeId))}'s turn<span class="sub">Waiting…</span>`;
}

function renderKitchens() {
  $("kitchens").innerHTML = state.players.map((p) => {
    const cls = [
      "kitchen",
      p.id === myId ? "mine" : "",
      p.id === state.activeId ? "active" : "",
      p.alive ? "" : "dead",
      p.pendingWin ? "notice" : "",
    ].filter(Boolean).join(" ");
    return `
    <div class="${cls}">
      <div class="k-top">
        <span class="k-name">${esc(p.name)}${p.id === myId ? " (you)" : ""}</span>
        ${p.isBot ? '<span class="chip bot">BOT</span>' : ""}
        <span class="k-hp">${"❤️".repeat(Math.max(p.hp, 0))}${"🖤".repeat(Math.max(3 - p.hp, 0))}</span>
      </div>
      <div class="k-scores">
        <span class="k-good">🐀 good ${p.score}/3</span>
        <span class="k-bad">☠️ bad ${p.badScore}/3</span>
      </div>
      <div class="k-tags">
        ${p.pendingWin ? '<span class="chip notice">ON NOTICE</span>' : ""}
        ${p.cats > 0 ? `<span class="chip cat">🐈 Cat ×${p.cats}</span>` : ""}
        ${p.boltHoles > 0 ? `<span class="chip">🕳 Bolt Hole ×${p.boltHoles}</span>` : ""}
        ${p.trapped ? '<span class="chip">🪤 trapped</span>' : ""}
        ${p.shielded ? '<span class="chip">🛡 shielded</span>' : ""}
        ${p.buns > 0 ? `<span class="chip">🍞 bun ×${p.buns}</span>` : ""}
        <span class="chip">🖐 ${p.handCount}</span>
      </div>
      ${p.id === myId && p.cats > 0 && state.activeId === myId ? `
        <div class="cat-actions">
          <button class="btn" data-cat="remove">1 🍞 Remove Cat</button>
          <button class="btn" data-cat="lure">2 🍞 Lure Cat</button>
        </div>` : ""}
    </div>`;
  }).join("");

  document.querySelectorAll("[data-cat]").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.cat === "remove") {
        socket.emit("removeCat", { method: "remove" }, handle);
      } else {
        pickPlayer("Lure the Cat onto…", "They get the Cat in their kitchen.",
          state.players.filter((p) => p.alive && p.id !== myId),
          (id) => socket.emit("removeCat", { method: "lure", lureTargetId: id }, handle));
      }
    };
  });
}

function renderHand() {
  const m = me();
  const myTurn = state.activeId === myId && !state.winner;
  const locked = !!state.pendingAttack || !!state.pendingTrap;
  const hand = (m && m.hand) || [];

  $("handMeta").innerHTML =
    `<span>Your hand · ${hand.length}</span><span>Deck ${state.deckCount}</span>`;

  $("hand").innerHTML = hand.map((c) => {
    const playable = RKLegality.isPlayable(c.type, state, myId);
    const dead = !playable;
    const reason = dead ? RKLegality.whyNot(c.type, state, myId) : "";
    return `
    <button class="card ${CARD_CLASS(c.type)}${dead ? " dead" : ""}"
      data-cid="${c.id}" data-ctype="${c.type}" data-dead="${dead ? 1 : 0}"
      data-reason="${esc(reason)}"
      ${myTurn && !locked && playable ? "" : "disabled"}>
      <span>${LABELS[c.type] || c.type}</span>
      <span class="ctag">${dead ? esc(reason) : (BLURB[c.type] || "")}</span>
    </button>`;
  }).join("");

  document.querySelectorAll("#hand .card").forEach((b) => {
    b.onclick = () => onCardTap(b.dataset.cid, b.dataset.ctype);
  });
  $("endTurnBtn").disabled = !myTurn || locked;
}
$("endTurnBtn").onclick = () => socket.emit("endTurn", {}, handle);

function pickPlayer(title, body, list, cb) {
  if (!list.length) return toast("No valid target");
  openModal(title, body, list.map((p) => ({
    label: p.name,
    sub: `${p.score}/3 good · ${p.badScore}/3 bad · ${p.hp} HP`,
    action: () => cb(p.id),
  })), { onCancel: () => {} });
}

function targetsFor(type, opts) {
  const ids = RKLegality.legalTargets(type, state, myId, opts) || [];
  return state.players.filter((p) => ids.includes(p.id));
}

function onCardTap(cardId, type) {
  if (REACTIVE.has(type)) {
    return toast("Hold this — you'll be offered it when attacked");
  }
  if (!RKLegality.isPlayable(type, state, myId)) {
    return toast(RKLegality.whyNot(type, state, myId));
  }

  if (type === "food") {
    return openModal("Food", "How do you want to use it?", [
      { label: "Heal 1 HP", action: () => play(cardId, null, { use: "heal" }) },
      { label: "Discard", sub: "Just get rid of it", action: () => play(cardId, null, { use: "discard" }) },
    ], { onCancel: () => {} });
  }

  if (type === "hot_ratato") {
    const stealTargets = targetsFor(type, { mode: "steal" });
    const dumpTargets = targetsFor(type, { mode: "dump" });
    const modes = [];
    if (stealTargets.length) modes.push({
      label: "Steal a good rat", sub: "Take one from their kitchen",
      action: () => pickPlayer("Steal from…", "", stealTargets,
        (id) => play(cardId, id, { mode: "steal" })),
    });
    if (dumpTargets.length) modes.push({
      label: "Dump a bad rat", sub: "Give one of yours away",
      action: () => pickPlayer("Dump onto…", "", dumpTargets,
        (id) => play(cardId, id, { mode: "dump" })),
    });
    if (modes.length === 1) return modes[0].action();   // no pointless choice
    return openModal("Hot Ratato", "Steal a good rat, or dump a bad one?",
      modes, { onCancel: () => {} });
  }

  if (type === "rat_trap") {
    return pickPlayer("Set the trap on…",
      "Catches the next rat they DRAW. You choose whether to keep it.",
      targetsFor(type), (id) => play(cardId, id, {}));
  }

  if (RKLegality.needsTarget(type)) {
    return pickPlayer(LABELS[type] || type, BLURB[type] || "",
      targetsFor(type), (id) => play(cardId, id, {}));
  }

  play(cardId, null, {});
}

function play(cardId, targetId, opts) {
  socket.emit("playCard", { cardId, targetId, opts }, handle);
}

function renderPrompts() {
  if (state.pendingAttack && state.pendingAttack.targetId === myId) {
    const m = me();
    const reacts = ((m && m.hand) || []).filter((c) => REACTIVE.has(c.type));
    const opts = reacts.map((c) => ({
      label: LABELS[c.type],
      sub: BLURB[c.type],
      action: () => socket.emit("respondToAttack",
        { action: { type: "react", cardId: c.id } }, handle),
    }));
    opts.push({
      label: "Take it",
      sub: "Let the attack land",
      action: () => socket.emit("respondToAttack", { action: { type: "pass" } }, handle),
    });
    return openModal(
      `Incoming ${LABELS[state.pendingAttack.cardType] || ""}`,
      `From ${nameOf(state.pendingAttack.attackerId)}`, opts, { hideCancel: true });
  }

  if (state.pendingTrap && state.pendingTrap.trapOwnerId === myId) {
    const r = state.pendingTrap.rat || {};
    const isGood = r.kind === "good";
    return openModal("Your trap caught a rat!",
      `${isGood ? "It's a GOOD rat 🐀" : "It's a BAD rat ☠️"} — from ${nameOf(state.pendingTrap.fromId)}`, [
      { label: "Keep it", sub: isGood ? "Adds to your score" : "Counts toward losing!",
        action: () => socket.emit("trapDecision", { keep: true }, handle) },
      { label: "Let it go", sub: "Back under the deck",
        action: () => socket.emit("trapDecision", { keep: false }, handle) },
    ], { hideCancel: true });
  }

  closeModal();
}

// ── log ──────────────────────────────────────────────────────────────────
let logOpen = false;
$("logToggle").onclick = () => {
  logOpen = !logOpen;
  $("log").classList.toggle("hidden", !logOpen);
  $("logToggle").textContent = logOpen ? "Hide log" : "Show log";
};
function renderLog() {
  if (!logOpen) return;
  $("log").innerHTML = state.log.slice().reverse()
    .map((l) => `<div>${esc(l)}</div>`).join("");
}

// ── auto-rejoin on refresh ───────────────────────────────────────────────
socket.on("connect", () => {
  const s = loadSession();
  if (s && s.roomCode && s.myId && !state) {
    socket.emit("joinRoom", { code: s.roomCode, name: s.name, rejoinId: s.myId }, (res) => {
      if (res && res.ok) {
        roomCode = res.code; myId = res.seatId; hostId = res.hostId;
        if (!res.rejoined) showLobby();
      }
    });
  }
});
