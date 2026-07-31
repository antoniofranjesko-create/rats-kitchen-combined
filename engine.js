"use strict";
/**
 * RAT'S KITCHEN COMBINED — server-authoritative engine, v5 ruleset.
 *
 * State lives entirely here. server.js owns Socket.io wiring and timers;
 * this file has no I/O. Every mutating function takes (game, ...) and
 * mutates game in place, returning a short log of what happened so the
 * server can broadcast something readable.
 *
 * SCOPE — see README_DEPLOY.md "Phase 2" for the full list of simplified
 * cards. The core loop (win/lose, HP, Cat, Bolt Hole, Rat Trap, Bun
 * maturation, HI/HCV, Hot Ratato, reactive cancels, all WD cards) is fully
 * implemented. A few cards resolve as simplified placeholders — always
 * legal to play, always do *something* small, but not their full v5 text.
 */

const { buildDeck, shuffle, uid, REACTIVE_CARDS, WD_CARDS, CARD_LABELS } = require("./deck");

const HAND_SIZE = 7;
const START_HP = 3;
const WIN_GOOD = 3;
const LOSE_BAD = 3;
const CAT_COUNT = 2;
const REACT_TIMEOUT_MS = 20000;
const TRAP_DECISION_TIMEOUT_MS = 15000;

function newPlayer(id, name, isBot) {
  return {
    id, name,
    isBot: !!isBot,
    hp: START_HP,
    hand: [],
    goodRats: [],           // array of {id, kind:'good', weight:1}
    badRats: [],            // array of {id, kind:'bad'|'fat_bad', weight}
    cats: 0,                // Cats currently present in this kitchen
    boltHoles: 0,           // Bolt Holes attached — absorb one HI hit each
    trapOwner: null,        // playerId who set a trap on THIS kitchen
    shielded: false,        // Territorial/Board Up — blocks theft this round
    buns: 0,                // Bun in the Oven pending, matures next own turn
    alive: true,
    pendingWin: false,      // on notice — one lap to survive
  };
}

function createGame(playerInfos) {
  const players = playerInfos.map((p) => newPlayer(p.id, p.name, p.isBot));
  return {
    players,
    order: players.map((p) => p.id),
    activeIdx: 0,
    deck: [],
    discard: [],
    started: false,
    winner: null,
    tagRedirect: null,          // playerId — next HI is forced onto them
    pendingAttack: null,        // {attackerId,targetId,cardType,cardId,resolve}
    pendingTrap: null,          // {trapOwnerId,fromId,rat}
    log: [],
  };
}

function push(game, msg) {
  game.log.push(msg);
  if (game.log.length > 200) game.log.shift();
}

function findPlayer(game, id) {
  return game.players.find((p) => p.id === id);
}

function activePlayer(game) {
  return findPlayer(game, game.order[game.activeIdx]);
}

function alivePlayers(game) {
  return game.players.filter((p) => p.alive);
}

function opponents(game, id) {
  return alivePlayers(game).filter((p) => p.id !== id);
}

function score(p) {
  return p.goodRats.reduce((s, r) => s + r.weight, 0);
}

function badScore(p) {
  return p.badRats.reduce((s, r) => s + r.weight, 0);
}

// ── setup ───────────────────────────────────────────────────────────────
function startGame(game) {
  game.deck = shuffle(buildDeck(game.players.length));
  for (const p of game.players) {
    for (let i = 0; i < HAND_SIZE; i++) {
      const c = drawRaw(game);
      if (!c) break;
      // setup draws never resolve rats/WD live — bin them, matching v11
      if (c.type === "rat" || WD_CARDS.has(c.type)) {
        game.discard.push(c);
      } else {
        p.hand.push(c);
      }
    }
  }
  game.started = true;
  push(game, "Game started.");
  beginTurn(game);
  return game;
}

// ── deck plumbing ──────────────────────────────────────────────────────
function drawRaw(game) {
  if (game.deck.length === 0) {
    if (game.discard.length === 0) return null;
    game.deck = shuffle(game.discard);
    game.discard = [];
  }
  return game.deck.pop();
}

function digForRat(game) {
  for (let attempt = 0; attempt < 2; attempt++) {
    for (let i = game.deck.length - 1; i >= 0; i--) {
      if (game.deck[i].type === "rat") return game.deck.splice(i, 1)[0];
    }
    if (game.discard.length) {
      game.deck = shuffle(game.discard);
      game.discard = [];
    } else break;
  }
  return null;
}

function toDeckBottom(cardOrRat) {
  // "goes to the pile" -> no pile in v5 -> goes under the deck
  return cardOrRat;
}

// ── rat movement (Cat + Rat Trap both live here) ───────────────────────
function gainRat(game, player, rat, opts = {}) {
  const bypassTrapAndCat = !!opts.bypass; // Bun maturation only

  if (!bypassTrapAndCat && player.trapOwner) {
    const owner = findPlayer(game, player.trapOwner);
    player.trapOwner = null;
    if (owner && owner.alive) {
      game.pendingTrap = { trapOwnerId: owner.id, fromId: player.id, rat };
      push(game, `${player.name}'s Rat Trap caught a rat — ${owner.name} to decide.`);
      return { trapped: true };
    }
  }

  if (!bypassTrapAndCat && player.cats > 0) {
    game.deck.unshift(toDeckBottom({ id: uid(), type: "rat", rat }));
    push(game, `The Cat turned a rat away from ${player.name}'s kitchen.`);
    return { blocked: true };
  }

  placeRat(player, rat);
  return { placed: true };
}

function placeRat(player, rat) {
  if (rat.kind === "good") player.goodRats.push(rat);
  else player.badRats.push(rat);
}

function resolveTrapDecision(game, keep) {
  const pend = game.pendingTrap;
  if (!pend) return;
  const owner = findPlayer(game, pend.trapOwnerId);
  if (keep && owner && owner.alive) {
    placeRat(owner, pend.rat);
    push(game, `${owner.name} kept the trapped rat.`);
  } else {
    game.deck.unshift({ id: uid(), type: "rat", rat: pend.rat });
    push(game, "The trapped rat was released back under the deck.");
  }
  game.pendingTrap = null;
}

// ── turn lifecycle ──────────────────────────────────────────────────────
function beginTurn(game) {
  const p = activePlayer(game);
  if (!p || !p.alive) { advanceActive(game); return beginTurn(game); }

  // declare-window resolution: survive one full lap -> win
  if (p.pendingWin) {
    game.winner = p.id;
    push(game, `${p.name} held their lead and WINS.`);
    return;
  }

  // Bun maturation
  const matured = p.buns;
  p.buns = 0;
  for (let i = 0; i < matured; i++) {
    const r = digForRat(game);
    if (r) {
      gainRat(game, p, r.rat, { bypass: true });
      push(game, `${p.name}'s Bun in the Oven matured.`);
    }
  }

  p.shielded = false;

  // draw 1
  const c = drawRaw(game);
  if (c) resolveDrawnCard(game, p, c);

  checkEnd(game);
}

function resolveDrawnCard(game, p, c) {
  if (c.type === "rat") {
    gainRat(game, p, c.rat, { drawn: true });
    return;
  }
  if (WD_CARDS.has(c.type)) {
    resolveWD(game, p, c.type);
    game.discard.push(c);
    return; // v11 invariant: no replacement draw after a WD resolves
  }
  p.hand.push(c);
}

function resolveWD(game, drawer, type) {
  switch (type) {
    case "wd_frenzy":
      for (const q of alivePlayers(game)) {
        const c = drawRaw(game);
        if (c) resolveDrawnCard(game, q, c);
      }
      push(game, "WD: Frenzy — everyone drew.");
      break;
    case "wd_blackout":
      game.discard.push(...drawer.hand.splice(0));
      for (let i = 0; i < HAND_SIZE; i++) {
        const c = drawRaw(game);
        if (!c) break;
        if (c.type === "rat" || WD_CARDS.has(c.type)) game.discard.push(c);
        else drawer.hand.push(c);
      }
      push(game, `WD: Blackout — ${drawer.name} redrew their hand.`);
      break;
    case "wd_ratrace": {
      const alive = alivePlayers(game);
      const picks = alive.map((q) => {
        if (q.badRats.length) return q.badRats.pop();
        if (q.goodRats.length) return q.goodRats.pop();
        return null;
      });
      alive.forEach((q, i) => {
        const incoming = picks[(i - 1 + alive.length) % alive.length];
        if (incoming) gainRat(game, q, incoming);
      });
      push(game, "WD: Rat Race — everyone passed a rat left.");
      break;
    }
    case "wd_audit":
      if (drawer.hand.length) {
        const i = Math.floor(Math.random() * drawer.hand.length);
        game.discard.push(drawer.hand.splice(i, 1)[0]);
      }
      push(game, `WD: Audit — ${drawer.name} discarded.`);
      break;
    case "wd_hi": {
      const pool = drawer.goodRats.length ? drawer.goodRats : drawer.badRats;
      if (pool.length) {
        const r = pool.pop();
        drawer.hp -= r.weight; // not Bolt-Hole-blockable
        game.deck.unshift({ id: uid(), type: "rat", rat: r });
        push(game, `WD: Health Inspection — one rat fired from ${drawer.name}'s kitchen.`);
      }
      break;
    }
    case "wd_infestation": {
      const r = digForRat(game);
      if (r) game.deck.push(r); // .push = top of draw pile (see drawRaw)
      push(game, "WD: Infestation — a rat rose to the top of the deck.");
      break;
    }
  }
}

function advanceActive(game) {
  const n = game.order.length;
  for (let step = 1; step <= n; step++) {
    const idx = (game.activeIdx + step) % n;
    if (findPlayer(game, game.order[idx]).alive) {
      game.activeIdx = idx;
      return;
    }
  }
}

function endTurn(game, playerId) {
  const p = activePlayer(game);
  if (!p || p.id !== playerId) return { error: "not your turn" };
  if (game.pendingAttack || game.pendingTrap) return { error: "resolve the pending action first" };
  checkEnd(game);
  if (game.winner) return { ok: true };
  advanceActive(game);
  beginTurn(game);
  return { ok: true };
}

/**
 * If the active player died DURING their own turn, nothing else advances
 * the turn pointer — beginTurn only skips players who were already dead
 * when it ran. Without this the game freezes permanently on a corpse.
 * Safe to call after any mutation; no-ops when there's nothing to do.
 */
function ensureTurnPlayable(game) {
  if (game.winner) return;
  if (game.pendingAttack || game.pendingTrap) return;
  let guard = 0;
  while (guard++ < game.order.length + 1) {
    const p = activePlayer(game);
    if (p && p.alive) return;
    advanceActive(game);
    const next = activePlayer(game);
    if (next && next.alive) { beginTurn(game); return; }
  }
}

// ── win / lose ──────────────────────────────────────────────────────────
function checkEnd(game) {
  if (game.winner) return;
  for (const p of alivePlayers(game)) {
    if (score(p) >= WIN_GOOD) {
      p.pendingWin = true;
    } else {
      p.pendingWin = false;
    }
    if (badScore(p) >= LOSE_BAD || p.hp <= 0) {
      p.alive = false;
      push(game, `${p.name} is out.`);
    }
  }
  const alive = alivePlayers(game);
  if (alive.length === 1) {
    game.winner = alive[0].id;
    push(game, `${alive[0].name} is the last one standing and WINS.`);
  } else if (alive.length === 0) {
    game.winner = "none";
    push(game, "Everyone is out. No winner.");
  }
}

// ── cards ────────────────────────────────────────────────────────────────
const ATTACK_CARDS = new Set(["hi", "hcv", "hot_ratato", "exterminator", "hot_chilli", "the_sweep"]);

function playCard(game, playerId, cardId, opts = {}) {
  const p = activePlayer(game);
  if (!p || p.id !== playerId) return { error: "not your turn" };
  if (game.pendingAttack || game.pendingTrap) return { error: "a pending action must resolve first" };

  const idx = p.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) return { error: "card not in hand" };
  const card = p.hand[idx];

  if (ATTACK_CARDS.has(card.type)) {
    const target = findPlayer(game, opts.targetId);
    if (!target || !target.alive || target.id === p.id) return { error: "invalid target" };
    p.hand.splice(idx, 1);
    game.discard.push(card);
    game.pendingAttack = {
      attackerId: p.id, targetId: target.id, cardType: card.type, opts,
    };
    push(game, `${p.name} played ${CARD_LABELS[card.type]} on ${target.name} — waiting on a reaction.`);
    return { ok: true, pending: true };
  }

  // non-attack cards resolve immediately
  const result = resolveNonAttack(game, p, card, opts);
  if (result.error) return result;
  p.hand.splice(idx, 1);
  game.discard.push(card);
  checkEnd(game);
  return { ok: true };
}

function resolveNonAttack(game, p, card, opts) {
  switch (card.type) {
    case "bolt_hole":
      p.boltHoles += 1;
      push(game, `${p.name} played Bolt Hole.`);
      return {};
    case "territorial":
    case "board_up":
      p.shielded = true;
      push(game, `${p.name}'s kitchen is shielded.`);
      return {};
    case "food": {
      if (opts.use === "heal") {
        p.hp = Math.min(START_HP, p.hp + 1);
        push(game, `${p.name} healed 1 HP.`);
      } else {
        push(game, `${p.name} discarded Food.`); // Boost variants: Phase 2
      }
      return {};
    }
    case "rat_trap": {
      const target = findPlayer(game, opts.targetId || p.id);
      if (!target || !target.alive || target.trapOwner) return { error: "invalid trap target" };
      target.trapOwner = p.id;
      push(game, `${p.name} set a Rat Trap on ${target.name}'s kitchen.`);
      return {};
    }
    case "bun_in_oven":
      p.buns += 1;
      push(game, `${p.name} planted a Bun in the Oven.`);
      return {};
    case "big_cheese": {
      for (let i = 0; i < 3; i++) {
        const c = drawRaw(game);
        if (!c) break;
        if (c.type === "rat") gainRat(game, p, c.rat);
        else game.discard.push(c);
      }
      push(game, `${p.name} played Big Cheese.`);
      return {};
    }
    case "switcheroo": {
      const target = findPlayer(game, opts.targetId);
      if (!target || !target.alive || target.id === p.id) return { error: "invalid target" };
      [p.goodRats, target.goodRats] = [target.goodRats, p.goodRats];
      [p.badRats, target.badRats] = [target.badRats, p.badRats];
      push(game, `${p.name} swapped kitchens with ${target.name}.`);
      return {};
    }
    case "tag": {
      const target = findPlayer(game, opts.targetId);
      if (!target || !target.alive) return { error: "invalid target" };
      game.tagRedirect = target.id;
      push(game, `${p.name} tagged ${target.name} — next Health Inspection redirects here.`);
      return {};
    }
    case "kleptomaniac": {
      const target = findPlayer(game, opts.targetId);
      if (!target || !target.alive || !target.hand.length) return { error: "invalid target" };
      const i = Math.floor(Math.random() * target.hand.length);
      p.hand.push(target.hand.splice(i, 1)[0]);
      push(game, `${p.name} pickpocketed ${target.name}.`);
      return {};
    }
    case "shakedown":
    case "rat_pack": {
      const target = findPlayer(game, opts.targetId);
      if (!target || !target.alive) return { error: "invalid target" };
      if (card.type === "rat_pack") {
        p.hand.push(...target.hand.splice(0));
      } else {
        if (!target.hand.length) return { error: "target hand is empty" };
        const name = target.hand[0].type;
        const matches = target.hand.filter((c) => c.type === name);
        target.hand = target.hand.filter((c) => c.type !== name);
        p.hand.push(...matches);
      }
      push(game, `${p.name} ran a ${CARD_LABELS[card.type]} on ${target.name}.`);
      return {};
    }
    case "live_wire":
    case "gambit":
    case "steak_out":
    case "trash_diver": {
      // SIMPLIFIED — see README_DEPLOY.md Phase 2
      const n = card.type === "live_wire" ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const c = drawRaw(game);
        if (c) resolveDrawnCard(game, p, c);
      }
      push(game, `${p.name} played ${CARD_LABELS[card.type]} (simplified).`);
      return {};
    }
    case "wok_block":
    case "sleeper":
    case "snitch":
      return { error: "reactive card — hold it until you're attacked" };
    default:
      return { error: "unrecognised card" };
  }
}

// ── Cat removal / lure (own action, not a "card play") ──────────────────
function removeCat(game, playerId, method, luretargetId) {
  const p = findPlayer(game, playerId);
  if (!p || p.cats === 0) return { error: "no Cat here" };
  const cost = method === "lure" ? 2 : 1;
  const foodIdx = [];
  p.hand.forEach((c, i) => { if (c.type === "food") foodIdx.push(i); });
  if (foodIdx.length < cost) return { error: `need ${cost} Food` };
  for (const i of foodIdx.slice(0, cost).sort((a, b) => b - a)) {
    game.discard.push(p.hand.splice(i, 1)[0]);
  }
  p.cats -= 1;
  if (method === "lure") {
    const target = findPlayer(game, luretargetId);
    if (!target || !target.alive) return { error: "invalid lure target" };
    target.cats += 1;
    push(game, `${p.name} lured the Cat onto ${target.name}.`);
  } else {
    // returns to the deck, unseen position
    game.deck.splice(Math.floor(Math.random() * (game.deck.length + 1)), 0, { id: uid(), type: "cat" });
    push(game, `${p.name} paid to remove the Cat.`);
  }
  return { ok: true };
}

// ── reactive resolution ──────────────────────────────────────────────────
function respondToAttack(game, playerId, action) {
  const pend = game.pendingAttack;
  if (!pend || pend.targetId !== playerId) return { error: "no pending attack for you" };
  const target = findPlayer(game, playerId);

  if (action && action.type === "react" && action.cardId) {
    const idx = target.hand.findIndex((c) => c.id === action.cardId);
    if (idx === -1 || !REACTIVE_CARDS.has(target.hand[idx].type)) {
      return { error: "not a valid reaction" };
    }
    const reactCard = target.hand.splice(idx, 1)[0];
    game.discard.push(reactCard);
    if (reactCard.type === "wok_block" || reactCard.type === "sleeper") {
      push(game, `${target.name} cancelled the attack with ${CARD_LABELS[reactCard.type]}.`);
      if (reactCard.type === "sleeper") {
        const attacker = findPlayer(game, pend.attackerId);
        // Sleeper: cancel AND steal — nothing to steal, the card's already discarded (v11: steals the attack card itself)
        push(game, `${target.name} kept the attack card.`);
      }
      game.pendingAttack = null;
      checkEnd(game);
      return { ok: true, cancelled: true };
    }
    if (reactCard.type === "snitch") {
      const attacker = findPlayer(game, pend.attackerId);
      if (attacker && attacker.hand.length) {
        const i = Math.floor(Math.random() * attacker.hand.length);
        target.hand.push(attacker.hand.splice(i, 1)[0]);
      }
      push(game, `${target.name} snitched a card — the attack still lands.`);
      resolveAttack(game);
      return { ok: true, cancelled: false };
    }
  }

  resolveAttack(game);
  return { ok: true, cancelled: false };
}

function resolveAttack(game) {
  const pend = game.pendingAttack;
  if (!pend) return;
  game.pendingAttack = null;
  const attacker = findPlayer(game, pend.attackerId);
  let target = findPlayer(game, pend.targetId);
  if (game.tagRedirect && pend.cardType === "hi") {
    const redirected = findPlayer(game, game.tagRedirect);
    if (redirected && redirected.alive) target = redirected;
    game.tagRedirect = null;
  }
  if (!target || !target.alive) return;

  switch (pend.cardType) {
    case "hi": {
      let hits = [...target.goodRats, ...target.badRats];
      target.goodRats = [];
      target.badRats = [];
      const absorbed = Math.min(target.boltHoles, hits.length);
      target.boltHoles -= absorbed;
      for (let i = 0; i < absorbed; i++) placeRat(target, hits.pop());
      for (const r of hits) {
        target.hp -= r.weight;
        game.deck.unshift({ id: uid(), type: "rat", rat: r });
      }
      push(game, `Health Inspection hit ${target.name}'s kitchen — ${hits.length} rats fired.`);
      break;
    }
    case "hcv": {
      const pool = target.goodRats.length ? target.goodRats : target.badRats;
      if (pool.length) {
        const r = pool.pop();
        target.hp -= r.weight;
        game.deck.unshift({ id: uid(), type: "rat", rat: r });
        push(game, `Health Code Violation fired one rat from ${target.name}.`);
      }
      break;
    }
    case "hot_ratato": {
      if (pend.opts.mode === "dump" && attacker.badRats.length) {
        const r = attacker.badRats.pop();
        gainRat(game, target, r);
        push(game, `${attacker.name} dumped a bad rat on ${target.name}.`);
      } else if (target.goodRats.length && !target.shielded) {
        const r = target.goodRats.pop();
        gainRat(game, attacker, r);
        push(game, `${attacker.name} stole a good rat from ${target.name}.`);
      } else {
        push(game, "Hot Ratato had nothing to take.");
      }
      break;
    }
    case "exterminator": {
      const cleared = target.goodRats.length + target.badRats.length;
      for (const r of [...target.goodRats, ...target.badRats]) {
        game.deck.unshift({ id: uid(), type: "rat", rat: r });
      }
      target.goodRats = [];
      target.badRats = [];
      push(game, `Exterminator cleared ${cleared} rats from ${target.name}'s kitchen.`);
      break;
    }
    case "the_sweep": {
      // simplified: immediate, no one-turn delay — see README Phase 2
      const pool = target.goodRats.length ? target.goodRats : target.badRats;
      if (pool.length) {
        const r = pool.pop();
        game.deck.unshift({ id: uid(), type: "rat", rat: r });
        push(game, `The Sweep cleared one rat from ${target.name}.`);
      }
      break;
    }
    case "hot_chilli": {
      const pool = target.goodRats.length ? target.goodRats : target.badRats;
      if (pool.length) {
        const r = pool.pop();
        target.hp -= r.weight;
        game.deck.unshift({ id: uid(), type: "rat", rat: r });
        push(game, `Hot Chilli detonated a rat in ${target.name}'s kitchen.`);
      }
      break;
    }
  }
  checkEnd(game);
}

// ── redacted view for a given player ─────────────────────────────────────
function publicView(game, forId) {
  return {
    started: game.started,
    winner: game.winner,
    activeId: game.order[game.activeIdx],
    tagRedirect: game.tagRedirect,
    pendingAttack: game.pendingAttack,
    pendingTrap: game.pendingTrap,
    deckCount: game.deck.length,
    discardCount: game.discard.length,
    log: game.log.slice(-30),
    players: game.players.map((p) => ({
      id: p.id, name: p.name, hp: p.hp, alive: p.alive, isBot: !!p.isBot,
      goodCount: p.goodRats.length, badCount: p.badRats.length,
      score: score(p), badScore: badScore(p),
      cats: p.cats, boltHoles: p.boltHoles, trapped: !!p.trapOwner,
      shielded: p.shielded, pendingWin: p.pendingWin, buns: p.buns,
      handCount: p.hand.length,
      hand: p.id === forId ? p.hand : undefined,
    })),
  };
}

module.exports = {
  CARD_LABELS, ATTACK_CARDS, REACTIVE_CARDS, newPlayer, score, badScore,
  ensureTurnPlayable,
  createGame, startGame, playCard, endTurn, removeCat,
  respondToAttack, resolveAttack, resolveTrapDecision,
  publicView, findPlayer, activePlayer,
  REACT_TIMEOUT_MS, TRAP_DECISION_TIMEOUT_MS,
};
