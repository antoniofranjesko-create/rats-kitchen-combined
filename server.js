"use strict";
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const engine = require("./game/engine");
const bot = require("./game/bot");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// Serve the SINGLE legality module to the browser. Deliberately served from
// game/ rather than copied into public/ — two copies of the ruleset would
// drift, which is the exact class of bug this module exists to kill.
app.get("/legality.js", (_req, res) => {
  res.type("application/javascript");
  res.sendFile(path.join(__dirname, "game", "legality.js"));
});

app.get("/healthz", (_req, res) => res.send("ok"));
app.get("/version", (_req, res) => res.json({ version: engine.VERSION }));

// Card text is generated from game/deck.js — the SAME object the engine
// uses — so rules text can't drift from the implementation.
const deckDefs = require("./game/deck");
app.get("/cardtext.js", (_req, res) => {
  res.type("application/javascript");
  res.send(
    "window.RK_CARD_TEXT=" + JSON.stringify(deckDefs.CARD_TEXT) + ";\n" +
    "window.RK_CARD_LABELS=" + JSON.stringify(deckDefs.CARD_LABELS) + ";"
  );
});

const PORT = process.env.PORT || 3000;
const MAX_SEATS = 8;
const BOT_THINK_MS = parseInt(process.env.BOT_THINK_MS || "900", 10);  // watchable pace; lower for testing
const BOT_REACT_MS = parseInt(process.env.BOT_REACT_MS || "700", 10);

/**
 * rooms: code -> {
 *   seats: [{ id, name, isBot, socketId|null, connected }],
 *   game: engine game | null,
 *   hostId, timers...
 * }
 * Seats exist BEFORE the game starts. Each seat is either a human (with a
 * socket) or a bot. Same lobby model as the Turf Wars prototype.
 */
const rooms = new Map();

const BOT_NAMES = ["Scratch", "Nibbles", "Whiskers", "Grease", "Sniff", "Patch", "Twitch"];

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(s) ? roomCode() : s;
}

function lobbyView(room) {
  return {
    seats: room.seats.map((s) => ({
      id: s.id, name: s.name, isBot: s.isBot, connected: s.connected,
    })),
    hostId: room.hostId,
    started: !!room.game && room.game.started,
  };
}

function broadcastLobby(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit("lobby", lobbyView(room));
}

function broadcastState(code) {
  const room = rooms.get(code);
  if (!room || !room.game) return;
  engine.ensureTurnPlayable(room.game);
  for (const seat of room.seats) {
    if (seat.socketId && !seat.isBot) {
      io.to(seat.socketId).emit("state", engine.publicView(room.game, seat.id));
    }
  }
  armSafetyTimers(code);   // human fallback — bots resolve via scheduleBotWork below
  scheduleBotWork(code);
}

/**
 * Server-side backstop for pendingAttack/pendingTrap. Called on every
 * broadcast, so it can't be forgotten again by a future rewrite the way it
 * was dropped when this file was rebuilt for bots/lobby: whatever the
 * client does or fails to do, the game can never hang on a human forever.
 * Bots resolve fast via scheduleBotWork; this is purely a backstop and is
 * a no-op once anything else has already resolved the pending item.
 */
function armSafetyTimers(code) {
  const room = rooms.get(code);
  if (!room || !room.game) return;
  const game = room.game;

  if (game.pendingAttack) {
    if (!room.attackTimer) {
      room.attackTimer = setTimeout(() => {
        room.attackTimer = null;
        if (room.game.pendingAttack) {
          engine.resolveAttack(room.game);
          broadcastState(code);
        }
      }, engine.REACT_TIMEOUT_MS);
    }
  } else if (room.attackTimer) {
    clearTimeout(room.attackTimer);
    room.attackTimer = null;
  }

  if (game.pendingTrap) {
    if (!room.trapTimer) {
      room.trapTimer = setTimeout(() => {
        room.trapTimer = null;
        if (room.game.pendingTrap) {
          engine.resolveTrapDecision(room.game, false);   // auto-discard on timeout
          broadcastState(code);
        }
      }, engine.TRAP_DECISION_TIMEOUT_MS);
    }
  } else if (room.trapTimer) {
    clearTimeout(room.trapTimer);
    room.trapTimer = null;
  }
}

function clearTimers(room) {
  for (const k of ["botTimer", "attackTimer", "trapTimer"]) {
    if (room[k]) clearTimeout(room[k]);
    room[k] = null;
  }
}

// ── bot driver ───────────────────────────────────────────────────────────
function scheduleBotWork(code) {
  const room = rooms.get(code);
  if (!room || !room.game || room.game.winner) return;
  if (room.botTimer) return;   // already queued

  const game = room.game;

  // a bot owes a reaction to a pending attack
  if (game.pendingAttack) {
    const target = engine.findPlayer(game, game.pendingAttack.targetId);
    if (target && target.isBot && target.alive) {
      room.botTimer = setTimeout(() => {
        room.botTimer = null;
        if (!game.pendingAttack) return broadcastState(code);
        const cardId = bot.decideReaction(game, target, game.pendingAttack);
        engine.respondToAttack(game, target.id,
          cardId ? { type: "react", cardId } : { type: "pass" });
        broadcastState(code);
      }, BOT_REACT_MS);
      return;
    }
    return;   // waiting on a human to react
  }

  // a bot owes a trap decision
  if (game.pendingTrap) {
    const owner = engine.findPlayer(game, game.pendingTrap.trapOwnerId);
    if (owner && owner.isBot) {
      room.botTimer = setTimeout(() => {
        room.botTimer = null;
        if (!game.pendingTrap) return broadcastState(code);
        const keep = bot.decideTrapKeep(game, owner, game.pendingTrap.rat);
        engine.resolveTrapDecision(game, keep);
        broadcastState(code);
      }, BOT_REACT_MS);
      return;
    }
    return;   // waiting on a human
  }

  // it's a bot's own turn
  const active = engine.activePlayer(game);
  if (!active || !active.isBot || !active.alive) return;

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (game.winner) return;
    const cur = engine.activePlayer(game);
    if (!cur || !cur.isBot) return broadcastState(code);

    const action = bot.decideTurnAction(game, cur);
    if (action.kind === "cat") {
      engine.removeCat(game, cur.id, action.method, action.lureTargetId);
    } else if (action.kind === "play") {
      const res = engine.playCard(game, cur.id, action.cardId,
        { targetId: action.targetId, ...(action.opts || {}) });
      if (res && res.error) engine.endTurn(game, cur.id);  // never stall on a bad pick
    } else {
      engine.endTurn(game, cur.id);
    }
    broadcastState(code);
  }, BOT_THINK_MS);
}

// ── sockets ──────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  let code = null;
  let seatId = null;

  socket.emit("version", { version: engine.VERSION });
  socket.on("getVersion", (_p, cb) => cb && cb({ version: engine.VERSION }));

  function room() { return code ? rooms.get(code) : null; }
  function mySeat() {
    const r = room();
    return r ? r.seats.find((s) => s.id === seatId) : null;
  }

  socket.on("createRoom", ({ name }, cb) => {
    code = roomCode();
    seatId = "p_" + socket.id;
    const r = {
      seats: [{ id: seatId, name: name || "Player", isBot: false, socketId: socket.id, connected: true }],
      game: null, hostId: seatId,
      botTimer: null, attackTimer: null, trapTimer: null,
    };
    rooms.set(code, r);
    socket.join(code);
    cb && cb({ ok: true, code, seatId, hostId: seatId });
    broadcastLobby(code);
  });

  socket.on("joinRoom", ({ code: c, name, rejoinId }, cb) => {
    const key = (c || "").toUpperCase();
    const r = rooms.get(key);
    if (!r) return cb && cb({ error: "Room not found" });

    // rejoin an existing seat after a refresh/disconnect
    if (rejoinId) {
      const seat = r.seats.find((s) => s.id === rejoinId && !s.isBot);
      if (seat) {
        code = key;
        seatId = seat.id;
        seat.socketId = socket.id;
        seat.connected = true;
        socket.join(code);
        cb && cb({ ok: true, code, seatId, hostId: r.hostId, rejoined: true });
        broadcastLobby(code);
        if (r.game) broadcastState(code);
        return;
      }
    }

    if (r.game && r.game.started) return cb && cb({ error: "Game already started" });
    if (r.seats.length >= MAX_SEATS) return cb && cb({ error: "Room full (8 max)" });

    code = key;
    seatId = "p_" + socket.id;
    r.seats.push({ id: seatId, name: name || "Player", isBot: false, socketId: socket.id, connected: true });
    socket.join(code);
    cb && cb({ ok: true, code, seatId, hostId: r.hostId });
    broadcastLobby(code);
  });

  socket.on("addBot", (_payload, cb) => {
    const r = room();
    if (!r) return cb && cb({ error: "No room" });
    if (seatId !== r.hostId) return cb && cb({ error: "Only the host can add bots" });
    if (r.game && r.game.started) return cb && cb({ error: "Game already started" });
    if (r.seats.length >= MAX_SEATS) return cb && cb({ error: "Room full (8 max)" });
    const used = new Set(r.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || ("Bot" + r.seats.length);
    r.seats.push({
      id: "b_" + Math.random().toString(36).slice(2, 9),
      name, isBot: true, socketId: null, connected: true,
    });
    cb && cb({ ok: true });
    broadcastLobby(code);
  });

  socket.on("removeSeat", ({ targetSeatId }, cb) => {
    const r = room();
    if (!r) return cb && cb({ error: "No room" });
    if (seatId !== r.hostId) return cb && cb({ error: "Only the host can remove seats" });
    if (r.game && r.game.started) return cb && cb({ error: "Game already started" });
    if (targetSeatId === r.hostId) return cb && cb({ error: "You can't remove your own seat" });
    r.seats = r.seats.filter((s) => s.id !== targetSeatId);
    cb && cb({ ok: true });
    broadcastLobby(code);
  });

  socket.on("startGame", (_payload, cb) => {
    const r = room();
    if (!r) return cb && cb({ error: "No room" });
    if (seatId !== r.hostId) return cb && cb({ error: "Only the host can start" });
    if (r.seats.length < 2) return cb && cb({ error: "Need at least 2 seats — add a bot" });
    r.game = engine.createGame(r.seats.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })));
    engine.startGame(r.game);
    cb && cb({ ok: true });
    broadcastLobby(code);
    broadcastState(code);
  });

  socket.on("playCard", ({ cardId, targetId, opts }, cb) => {
    const r = room();
    if (!r || !r.game) return cb && cb({ error: "No game" });
    const res = engine.playCard(r.game, seatId, cardId, { targetId, ...(opts || {}) });
    cb && cb(res);
    broadcastState(code);
  });

  socket.on("respondToAttack", ({ action }, cb) => {
    const r = room();
    if (!r || !r.game) return cb && cb({ error: "No game" });
    const res = engine.respondToAttack(r.game, seatId, action);
    cb && cb(res);
    broadcastState(code);
  });

  socket.on("trapDecision", ({ keep }, cb) => {
    const r = room();
    if (!r || !r.game) return cb && cb({ error: "No game" });
    if (!r.game.pendingTrap || r.game.pendingTrap.trapOwnerId !== seatId) {
      return cb && cb({ error: "Not your trap" });
    }
    engine.resolveTrapDecision(r.game, keep);
    cb && cb({ ok: true });
    broadcastState(code);
  });

  socket.on("removeCat", ({ method, lureTargetId }, cb) => {
    const r = room();
    if (!r || !r.game) return cb && cb({ error: "No game" });
    const res = engine.removeCat(r.game, seatId, method, lureTargetId);
    cb && cb(res);
    broadcastState(code);
  });

  socket.on("endTurn", (_payload, cb) => {
    const r = room();
    if (!r || !r.game) return cb && cb({ error: "No game" });
    const res = engine.endTurn(r.game, seatId);
    cb && cb(res);
    broadcastState(code);
  });

  socket.on("disconnect", () => {
    const r = room();
    if (!r) return;
    const seat = mySeat();
    if (seat) {
      seat.connected = false;
      seat.socketId = null;
      // pre-game: drop the seat. mid-game: keep it so they can rejoin.
      if (!r.game || !r.game.started) {
        r.seats = r.seats.filter((s) => s.id !== seatId);
        if (r.hostId === seatId && r.seats.length) {
          const nextHuman = r.seats.find((s) => !s.isBot);
          r.hostId = nextHuman ? nextHuman.id : r.seats[0].id;
        }
      }
    }
    const anyHuman = r.seats.some((s) => !s.isBot && s.connected);
    if (!anyHuman) {
      clearTimers(r);
      rooms.delete(code);
    } else {
      broadcastLobby(code);
    }
  });
});

server.listen(PORT, () => console.log(`Rat's Kitchen Combined listening on :${PORT}`));
