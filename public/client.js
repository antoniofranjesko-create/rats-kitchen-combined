"use strict";
const socket = io();

let roomCode = null;
let myId = null;
let latestState = null;

const CARD_LABELS = {
  hi: "Health Inspection", hcv: "Health Code Violation", hot_ratato: "Hot Ratato",
  wok_block: "Wok Block", sleeper: "Sleeper", bolt_hole: "Bolt Hole",
  exterminator: "Exterminator", the_sweep: "The Sweep", territorial: "Territorial",
  board_up: "Board Up", snitch: "Snitch", rat_trap: "Rat Trap", food: "Food",
  kleptomaniac: "Kleptomaniac", shakedown: "Shakedown", rat_pack: "Rat Pack",
  switcheroo: "Switcheroo", live_wire: "Live Wire", gambit: "Gambit",
  steak_out: "Steak Out", trash_diver: "Trash Diver", hot_chilli: "Hot Chilli",
  big_cheese: "Big Cheese", bun_in_oven: "Bun in the Oven", tag: "Tag",
};
const ATTACK_CARDS = new Set(["hi", "hcv", "hot_ratato", "exterminator", "hot_chilli", "the_sweep"]);
const REACTIVE_CARDS = new Set(["wok_block", "sleeper", "snitch"]);

const $ = (id) => document.getElementById(id);

function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }

$("createBtn").onclick = () => {
  const name = $("nameInput").value.trim() || "Player";
  socket.emit("createRoom", { name }, (res) => {
    if (res.error) return ($("landingError").textContent = res.error);
    roomCode = res.code; myId = res.playerId;
    $("lobbyCode").textContent = roomCode;
    hide("landing"); show("lobby");
  });
};

$("joinBtn").onclick = () => {
  const name = $("nameInput").value.trim() || "Player";
  const code = $("codeInput").value.trim().toUpperCase();
  socket.emit("joinRoom", { code, name }, (res) => {
    if (res.error) return ($("landingError").textContent = res.error);
    roomCode = res.code; myId = res.playerId;
    $("lobbyCode").textContent = roomCode;
    hide("landing"); show("lobby");
  });
};

$("startBtn").onclick = () => {
  socket.emit("startGame", { code: roomCode }, (res) => {
    if (res.error) alert(res.error);
  });
};

$("endTurnBtn").onclick = () => {
  socket.emit("endTurn", { code: roomCode }, (res) => {
    if (res && res.error) alert(res.error);
  });
};

socket.on("lobby", ({ players }) => {
  $("lobbyList").innerHTML = players.map((p) => `<li>${p.name}</li>`).join("");
});

socket.on("state", (state) => {
  latestState = state;
  hide("lobby"); hide("landing"); show("game");
  render(state);
});

function render(state) {
  renderBoard(state);
  renderHand(state);
  renderPrompt(state);
  renderLog(state);
}

function renderBoard(state) {
  const isMyTurn = state.activeId === myId;
  $("board").innerHTML = `
    <h3>${state.winner
      ? (state.winner === "none" ? "No winner." : `${nameOf(state, state.winner)} WINS`)
      : (isMyTurn ? "Your turn" : `${nameOf(state, state.activeId)}'s turn`)}
    </h3>
    <div class="kitchens">
      ${state.players.map((p) => kitchenCard(p, state)).join("")}
    </div>
    <p class="deckinfo">Deck: ${state.deckCount} · Discard: ${state.discardCount}</p>
  `;
  document.querySelectorAll("[data-cat-remove]").forEach((btn) => {
    btn.onclick = () => socket.emit("removeCat", { code: roomCode, method: "remove" }, warnErr);
  });
  document.querySelectorAll("[data-cat-lure]").forEach((btn) => {
    btn.onclick = () => {
      const targetId = prompt("Lure the Cat onto which player id?\n" +
        state.players.filter((q) => q.id !== myId && q.alive).map((q) => `${q.id} = ${q.name}`).join("\n"));
      if (targetId) socket.emit("removeCat", { code: roomCode, method: "lure", lureTargetId: targetId }, warnErr);
    };
  });
}

function nameOf(state, id) {
  const p = state.players.find((x) => x.id === id);
  return p ? p.name : "?";
}

function kitchenCard(p, state) {
  const mine = p.id === myId;
  return `
    <div class="kitchen ${p.alive ? "" : "dead"} ${mine ? "mine" : ""}">
      <div class="kname">${p.name}${mine ? " (you)" : ""}</div>
      <div class="hp">HP: ${"❤".repeat(Math.max(p.hp, 0))}${"·".repeat(Math.max(3 - p.hp, 0))}</div>
      <div class="rats">🐀 good: ${p.goodCount} (score ${p.score}/3)</div>
      <div class="rats bad">🐀 bad: ${p.badCount} (score ${p.badScore}/3)</div>
      <div class="tags">
        ${p.cats > 0 ? `<span class="tag cat">🐈 Cat x${p.cats}</span>` : ""}
        ${p.boltHoles > 0 ? `<span class="tag">🕳 Bolt Hole x${p.boltHoles}</span>` : ""}
        ${p.trapped ? `<span class="tag">🪤 trapped</span>` : ""}
        ${p.shielded ? `<span class="tag">🛡 shielded</span>` : ""}
        ${p.buns > 0 ? `<span class="tag">🍞 bun x${p.buns}</span>` : ""}
        ${p.pendingWin ? `<span class="tag win">⚠ ON NOTICE — survive one lap!</span>` : ""}
      </div>
      <div class="handcount">Hand: ${p.handCount}</div>
      ${mine && p.cats > 0 ? `
        <button data-cat-remove>Pay 1 Food: remove Cat</button>
        <button data-cat-lure>Pay 2 Food: lure Cat away</button>
      ` : ""}
    </div>
  `;
}

function renderHand(state) {
  const me = state.players.find((p) => p.id === myId);
  if (!me || !me.hand) { $("hand").innerHTML = ""; return; }
  const isMyTurn = state.activeId === myId && !state.winner;
  const locked = !!state.pendingAttack || !!state.pendingTrap;
  $("hand").innerHTML = me.hand.map((c) => `
    <button class="card" data-cid="${c.id}" data-ctype="${c.type}"
      ${isMyTurn && !locked ? "" : "disabled"}>
      ${CARD_LABELS[c.type] || c.type}
    </button>
  `).join("");
  document.querySelectorAll("#hand .card").forEach((btn) => {
    btn.onclick = () => playFromHand(state, btn.dataset.cid, btn.dataset.ctype);
  });
  $("endTurnBtn").disabled = !isMyTurn || locked;
}

function playFromHand(state, cardId, ctype) {
  if (REACTIVE_CARDS.has(ctype)) {
    alert("Hold reactive cards (Wok Block / Sleeper / Snitch) — you'll be prompted to play them when attacked.");
    return;
  }
  let targetId, opts = {};
  const others = state.players.filter((p) => p.id !== myId && p.alive);

  if (ATTACK_CARDS.has(ctype) || ctype === "switcheroo" || ctype === "tag" ||
      ctype === "kleptomaniac" || ctype === "shakedown" || ctype === "rat_pack") {
    targetId = pickTarget(others);
    if (!targetId) return;
  }
  if (ctype === "hot_ratato") {
    opts.mode = confirm("OK = steal a good rat · Cancel = dump a bad rat") ? "steal" : "dump";
  }
  if (ctype === "rat_trap") {
    targetId = pickTarget(state.players.filter((p) => p.alive), true);
    if (!targetId) return;
  }
  if (ctype === "food") {
    opts.use = confirm("OK = heal 1 HP · Cancel = discard only") ? "heal" : "discard";
  }
  socket.emit("playCard", { code: roomCode, cardId, targetId, opts }, warnErr);
}

function pickTarget(list, includeSelf) {
  const options = list.map((p) => `${p.id} = ${p.name}`).join("\n");
  const id = prompt("Target player id?\n" + options);
  return id;
}

function renderPrompt(state) {
  let html = "";
  if (state.pendingAttack && state.pendingAttack.targetId === myId) {
    const me = state.players.find((p) => p.id === myId);
    const reactCards = (me.hand || []).filter((c) => REACTIVE_CARDS.has(c.type));
    html += `<div class="prompt">
      <p>Incoming ${CARD_LABELS[state.pendingAttack.cardType]} from ${nameOf(state, state.pendingAttack.attackerId)}!</p>
      ${reactCards.map((c) => `<button data-react="${c.id}">${CARD_LABELS[c.type]}</button>`).join("")}
      <button data-pass>Take it</button>
    </div>`;
  }
  if (state.pendingTrap && state.pendingTrap.trapOwnerId === myId) {
    html += `<div class="prompt">
      <p>Your Rat Trap caught a rat from ${nameOf(state, state.pendingTrap.fromId)}. Keep it?</p>
      <button data-trap-keep>Keep</button>
      <button data-trap-discard>Let it go</button>
    </div>`;
  }
  $("promptArea").innerHTML = html;
  document.querySelectorAll("[data-react]").forEach((btn) => {
    btn.onclick = () => socket.emit("respondToAttack",
      { code: roomCode, action: { type: "react", cardId: btn.dataset.react } }, warnErr);
  });
  const passBtn = document.querySelector("[data-pass]");
  if (passBtn) passBtn.onclick = () =>
    socket.emit("respondToAttack", { code: roomCode, action: { type: "pass" } }, warnErr);
  const keepBtn = document.querySelector("[data-trap-keep]");
  if (keepBtn) keepBtn.onclick = () => socket.emit("trapDecision", { code: roomCode, keep: true }, warnErr);
  const discardBtn = document.querySelector("[data-trap-discard]");
  if (discardBtn) discardBtn.onclick = () => socket.emit("trapDecision", { code: roomCode, keep: false }, warnErr);
}

function renderLog(state) {
  $("log").innerHTML = "<h4>Log</h4>" + state.log.slice().reverse().map((l) => `<div>${l}</div>`).join("");
}

function warnErr(res) {
  if (res && res.error) alert(res.error);
}
