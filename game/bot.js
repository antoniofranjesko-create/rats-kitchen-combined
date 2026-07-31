"use strict";
/**
 * Bot AI — ported from the Python balance sim's heuristic policy, the same
 * logic the 300-games-per-config sweeps were run against. Greedy, not
 * optimal: good enough to validate pace and make solo testing possible,
 * not good enough to ship as a "play vs AI" mode. (Same caveat as the
 * Turf Wars reference bots.)
 */

const legality = require("./legality");
const REACTIVE = legality.REACTIVE;

// higher = played sooner. 0 or absent = never played proactively.
const PRIORITY = {
  hi: 9,
  switcheroo: 8,
  hcv: 7,
  rat_trap: 6.8,
  hot_ratato: 6.5,
  big_cheese: 5.5,
  exterminator: 5,
  hot_chilli: 4.5,
  the_sweep: 4,
  bun_in_oven: 3.5,
  bolt_hole: 3,
  live_wire: 2.5,
  gambit: 2,
  steak_out: 2,
  trash_diver: 2,
  tag: 1.8,
  kleptomaniac: 1.5,
  shakedown: 1.5,
  rat_pack: 1.5,
  territorial: 1,
  board_up: 1,
  food: 0.1,   // held for healing / Cat removal
};

function score(p) {
  return p.goodRats.reduce((s, r) => s + r.weight, 0);
}
function badScore(p) {
  return p.badRats.reduce((s, r) => s + r.weight, 0);
}

function pickFrom(pool) {
  if (!pool.length) return null;
  return pool.reduce((best, p) => {
    const v = score(p) * 2 + p.goodRats.length * 0.5;
    const bv = score(best) * 2 + best.goodRats.length * 0.5;
    return v > bv ? p : best;
  });
}

/** Pick the most threatening opponent: closest to winning, then most rats. */
function pickTarget(game, me) {
  const opps = game.players.filter((p) => p.alive && p.id !== me.id);
  return pickFrom(opps);
}

/**
 * Decide one action for a bot on its own turn.
 * Returns {kind:'play', cardId, targetId, opts} | {kind:'cat', method}
 *       | {kind:'end'}
 */
function decideTurnAction(game, me) {
  // 1. shed a Cat if it's blocking us and we can afford it
  if (me.cats > 0) {
    const foodCount = me.hand.filter((c) => c.type === "food").length;
    const opps = game.players.filter((p) => p.alive && p.id !== me.id);
    if (foodCount >= 2 && opps.length) {
      const t = pickTarget(game, me);
      return { kind: "cat", method: "lure", lureTargetId: t ? t.id : null };
    }
    if (foodCount >= 1) return { kind: "cat", method: "remove" };
  }

  // 2. heal if badly hurt and holding spare Food
  const foods = me.hand.filter((c) => c.type === "food");
  if (me.hp <= 1 && foods.length > 0) {
    return { kind: "play", cardId: foods[0].id, opts: { use: "heal" } };
  }

  // 3. best-priority LEGAL card — legality.js decides what's playable,
  //    so a bot can never attempt a move a human would be blocked from.
  const candidates = me.hand
    .filter((c) => !REACTIVE.has(c.type))
    .map((c) => ({ card: c, pri: PRIORITY[c.type] || 0 }))
    .filter((x) => x.pri > 0.5)
    .sort((a, b) => b.pri - a.pri);

  for (const { card } of candidates) {
    const type = card.type;
    const opts = {};

    if (type === "hot_ratato") {
      // prefer dumping when close to the loss threshold, else steal —
      // but only pick a mode that's actually legal
      const dumpLegal = legality.legalTargets(type, game, me.id, { mode: "dump" });
      const stealLegal = legality.legalTargets(type, game, me.id, { mode: "steal" });
      const wantDump = badScore(me) >= 2 && dumpLegal.length > 0;
      if (wantDump) opts.mode = "dump";
      else if (stealLegal.length) opts.mode = "steal";
      else if (dumpLegal.length) opts.mode = "dump";
      else continue;
    }

    if (!legality.isPlayable(type, game, me.id)) continue;

    if (legality.needsTarget(type)) {
      const legal = legality.legalTargets(type, game, me.id, opts);
      if (!legal.length) continue;
      const pool = game.players.filter((p) => legal.includes(p.id));
      // for a trap, prefer the leader; otherwise most threatening legal target
      const pick = pickFrom(pool) || pool[0];
      return { kind: "play", cardId: card.id, targetId: pick.id, opts };
    }

    return { kind: "play", cardId: card.id, targetId: null, opts };
  }

  return { kind: "end" };
}

/** Bot reacting to an incoming attack. Returns a cardId to react with, or null. */
function decideReaction(game, me, pendingAttack) {
  const hasRats = me.goodRats.length + me.badRats.length > 0;
  const threat = pendingAttack.cardType;
  const bigThreat = threat === "hi" || (threat === "hot_ratato" && me.goodRats.length > 0);

  const wok = me.hand.find((c) => c.type === "wok_block");
  const sleeper = me.hand.find((c) => c.type === "sleeper");
  const snitch = me.hand.find((c) => c.type === "snitch");

  // only burn a hard cancel on something that actually costs us
  if (bigThreat && hasRats) {
    if (sleeper) return sleeper.id;
    if (wok) return wok.id;
  }
  if (snitch) return snitch.id;   // free value, doesn't cancel
  return null;
}

/** Bot deciding whether to keep a rat its trap caught. */
function decideTrapKeep(game, me, rat) {
  if (rat.kind === "good") return true;
  return false;   // never voluntarily take a bad rat
}

module.exports = { decideTurnAction, decideReaction, decideTrapKeep, pickTarget };
