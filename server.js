"use strict";
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const engine = require("./game/engine");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

/** rooms: code -> { game, sockets: Map(socketId->playerId), names: Map(playerId->name), attackTimer, trapTimer } */
const rooms = new Map();

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(s) ? roomCode() : s;
}

function broadcastState(code) {
  const room = rooms.get(code);
  if (!room) return;
  for (const [socketId, playerId] of room.sockets.entries()) {
    io.to(socketId).emit("state", engine.publicView(room.game, playerId));
  }
}

function broadcastLobby(code) {
  const room = rooms.get(code);
  if (!room) return;
  const list = [...room.names.entries()].map(([id, name]) => ({ id, name }));
  io.to(code).emit("lobby", { players: list, started: room.game.started });
}

function clearTimers(room) {
  if (room.attackTimer) clearTimeout(room.attackTimer);
  if (room.trapTimer) clearTimeout(room.trapTimer);
  room.attackTimer = null;
  room.trapTimer = null;
}

function armAttackTimer(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.attackTimer) clearTimeout(room.attackTimer);
  room.attackTimer = setTimeout(() => {
    if (room.game.pendingAttack) {
      engine.resolveAttack(room.game);
      broadcastState(code);
    }
  }, engine.REACT_TIMEOUT_MS);
}

function armTrapTimer(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.trapTimer) clearTimeout(room.trapTimer);
  room.trapTimer = setTimeout(() => {
    if (room.game.pendingTrap) {
      engine.resolveTrapDecision(room.game, false); // auto-discard on timeout
      broadcastState(code);
    }
  }, engine.TRAP_DECISION_TIMEOUT_MS);
}

io.on("connection", (socket) => {
  let joinedCode = null;
  let myPlayerId = null;

  socket.on("createRoom", ({ name }, cb) => {
    const code = roomCode();
    const playerId = "p_" + socket.id;
    const game = engine.createGame([{ id: playerId, name }]);
    rooms.set(code, { game, sockets: new Map([[socket.id, playerId]]), names: new Map([[playerId, name]]) });
    socket.join(code);
    joinedCode = code; myPlayerId = playerId;
    cb && cb({ ok: true, code, playerId });
    broadcastLobby(code);
  });

  socket.on("joinRoom", ({ code, name }, cb) => {
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: "room not found" });
    if (room.game.started) return cb && cb({ error: "game already started" });
    if (room.names.size >= 8) return cb && cb({ error: "room full (8 max)" });
    const playerId = "p_" + socket.id;
    room.game.players.push({
      id: playerId, name, hp: 3, hand: [], goodRats: [], badRats: [],
      cats: 0, boltHoles: 0, trapOwner: null, shielded: false, buns: 0,
      alive: true, pendingWin: false,
    });
    room.game.order.push(playerId);
    room.sockets.set(socket.id, playerId);
    room.names.set(playerId, name);
    socket.join(code);
    joinedCode = code; myPlayerId = playerId;
    cb && cb({ ok: true, code, playerId });
    broadcastLobby(code);
  });

  socket.on("startGame", ({ code }, cb) => {
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: "room not found" });
    if (room.game.players.length < 2) return cb && cb({ error: "need at least 2 players" });
    engine.startGame(room.game);
    cb && cb({ ok: true });
    broadcastState(code);
  });

  socket.on("playCard", ({ code, cardId, targetId, opts }, cb) => {
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: "room not found" });
    const result = engine.playCard(room.game, myPlayerId, cardId, { targetId, ...opts });
    if (result.pending) armAttackTimer(code);
    if (room.game.pendingTrap) armTrapTimer(code);
    cb && cb(result);
    broadcastState(code);
  });

  socket.on("respondToAttack", ({ code, action }, cb) => {
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: "room not found" });
    if (room.attackTimer) clearTimeout(room.attackTimer);
    const result = engine.respondToAttack(room.game, myPlayerId, action);
    if (room.game.pendingTrap) armTrapTimer(code);
    cb && cb(result);
    broadcastState(code);
  });

  socket.on("trapDecision", ({ code, keep }, cb) => {
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: "room not found" });
    if (room.trapTimer) clearTimeout(room.trapTimer);
    engine.resolveTrapDecision(room.game, keep);
    cb && cb({ ok: true });
    broadcastState(code);
  });

  socket.on("removeCat", ({ code, method, lureTargetId }, cb) => {
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: "room not found" });
    const result = engine.removeCat(room.game, myPlayerId, method, lureTargetId);
    cb && cb(result);
    broadcastState(code);
  });

  socket.on("endTurn", ({ code }, cb) => {
    const room = rooms.get(code);
    if (!room) return cb && cb({ error: "room not found" });
    const result = engine.endTurn(room.game, myPlayerId);
    cb && cb(result);
    broadcastState(code);
  });

  socket.on("disconnect", () => {
    if (joinedCode && rooms.has(joinedCode)) {
      const room = rooms.get(joinedCode);
      room.sockets.delete(socket.id);
      if (!room.game.started) {
        room.game.players = room.game.players.filter((p) => p.id !== myPlayerId);
        room.game.order = room.game.order.filter((id) => id !== myPlayerId);
        room.names.delete(myPlayerId);
        broadcastLobby(joinedCode);
      }
      if (room.sockets.size === 0) {
        clearTimers(room);
        rooms.delete(joinedCode);
      }
    }
  });
});

server.listen(PORT, () => console.log(`Rat's Kitchen Combined listening on :${PORT}`));
