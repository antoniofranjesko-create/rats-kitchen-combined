"use strict";
/**
 * CARD LEGALITY — single source of truth.
 *
 * This module answers two questions and nothing else:
 *   1. Can this card be played at all right now?
 *   2. If it needs a target, which targets are legal?
 *
 * THREE consumers, ONE ruleset:
 *   - server (engine.playCard)  — authoritative rejection
 *   - client (client.js)        — greys out dead cards, only offers legal targets
 *   - bots   (bot.js)           — never even considers an illegal move
 *
 * Previously each of those had its own partial idea of what was legal, which
 * is why fixing bot targeting didn't stop humans seeing nonsense plays. If
 * you add or change a card, change it HERE and all three follow.
 *
 * Works on both server-side player objects (goodRats/badRats/hand arrays)
 * and client-side publicView players (goodCount/badCount/handCount), via
 * norm() below. Loads under both CommonJS and a plain browser <script>.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RKLegality = factory();
})(typeof self !== "undefined" ? self : this, function () {

  const REACTIVE = new Set(["wok_block", "sleeper", "snitch"]);

  /** Normalise either shape into one form. */
  function norm(p) {
    if (!p) return null;
    const good = p.goodRats ? p.goodRats.length : (p.goodCount || 0);
    const bad = p.badRats ? p.badRats.length : (p.badCount || 0);
    const badNormal = p.badRats ? p.badRats.filter((r) => r.kind === "bad").length
      : (p.badNormalCount != null ? p.badNormalCount : bad);
    const hand = p.hand ? p.hand.length : (p.handCount || 0);
    return {
      id: p.id,
      alive: p.alive !== false,
      good, bad, badNormal, rats: good + bad,
      hand,
      hp: p.hp,
      cats: p.cats || 0,
      shielded: !!p.shielded,
      trapped: p.trapped !== undefined ? !!p.trapped : !!p.trapOwner,
    };
  }

  function players(state) {
    return (state.players || []).map(norm).filter(Boolean);
  }

  function others(state, actorId) {
    return players(state).filter((p) => p.alive && p.id !== actorId);
  }

  /** Kitchens already hit by an attack card this turn — one per turn each. */
  function alreadyHit(state) {
    return new Set(state.attackedThisTurn || []);
  }

  function excludeHit(list, hit) {
    return list.filter((p) => !hit.has(p.id));
  }

  function self(state, actorId) {
    return players(state).find((p) => p.id === actorId);
  }

  /** Does this card need the player to choose a target? */
  function needsTarget(type, opts) {
    switch (type) {
      case "hi": case "hcv": case "exterminator": case "hot_chilli":
      case "the_sweep": case "hot_ratato": case "switcheroo": case "tag":
      case "kleptomaniac": case "shakedown": case "rat_pack": case "rat_trap":
        return true;
      default:
        return false;
    }
  }

  /**
   * Which targets are legal for this card right now?
   * Returns an array of player ids. Empty array = card is unplayable.
   * Cards that need no target return null (meaning "not applicable").
   */
  function legalTargets(type, state, actorId, opts) {
    const me = self(state, actorId);
    const opp = others(state, actorId);
    if (!me) return [];

    switch (type) {
      // ── attacks that remove/fire rats: target MUST have rats ──────────
      case "hi":
      case "hcv":
      case "exterminator":
      case "hot_chilli":
      case "the_sweep":
        return excludeHit(opp.filter((p) => p.rats > 0), alreadyHit(state)).map((p) => p.id);

      // ── Hot Ratato has two distinct modes with different legality ─────
      case "hot_ratato": {
        const hit = alreadyHit(state);
        const opp2 = excludeHit(opp, hit);
        const mode = opts && opts.mode;
        if (mode === "dump") {
          return me.bad > 0 ? opp2.map((p) => p.id) : [];
        }
        if (mode === "steal") {
          return opp2.filter((p) => p.good > 0 && !p.shielded).map((p) => p.id);
        }
        const canSteal = opp2.some((p) => p.good > 0 && !p.shielded);
        const canDump = me.bad > 0 && opp2.length > 0;
        if (!canSteal && !canDump) return [];
        const ids = new Set();
        if (canSteal) opp2.filter((p) => p.good > 0 && !p.shielded).forEach((p) => ids.add(p.id));
        if (canDump) opp2.forEach((p) => ids.add(p.id));
        return [...ids];
      }

      // ── hand theft: target must actually hold cards ───────────────────
      case "kleptomaniac":
      case "shakedown":
      case "rat_pack":
        return opp.filter((p) => p.hand > 0).map((p) => p.id);

      // ── Switcheroo: pointless swapping with an identical kitchen, but
      //    swapping with anyone is a legitimate call. Require only that
      //    SOMETHING differs, so it can't be burned for literally nothing.
      case "switcheroo":
        return opp.filter((p) => p.good !== me.good || p.bad !== me.bad).map((p) => p.id);

      // ── Tag: redirects the next HI. Only meaningful if someone could
      //    plausibly be hit, but it's a forward-looking card — any
      //    opponent is legal.
      case "tag":
        return opp.map((p) => p.id);

      // ── Rat Trap: any kitchen incl. your own, if not already trapped ──
      case "rat_trap":
        return players(state).filter((p) => p.alive && !p.trapped).map((p) => p.id);

      default:
        return null;   // no target needed
    }
  }

  /**
   * Can this card be played at all right now (ignoring whose turn it is)?
   * Reactive cards are never proactively playable.
   */
  function isPlayable(type, state, actorId) {
    if (REACTIVE.has(type)) return false;
    const me = self(state, actorId);
    if (!me || !me.alive) return false;

    if (needsTarget(type)) {
      const t = legalTargets(type, state, actorId);
      return Array.isArray(t) && t.length > 0;
    }

    switch (type) {
      // Bolt Hole protects a rat from a Health Inspection. With no rats in
      // your kitchen there is nothing to protect — dead card.
      case "bolt_hole":
        return me.rats > 0;

      case "baptism":
        return me.badNormal > 0 && me.hand >= 2;

      // Food always does something: heal, or feed the Cat, or discard.
      case "food":
        return true;

      default:
        return true;
    }
  }

  /** Human-readable reason a card can't be played — for UI tooltips. */
  function whyNot(type, state, actorId) {
    if (REACTIVE.has(type)) return "Save it — you'll be offered this when attacked";
    const me = self(state, actorId);
    if (!me) return "Unavailable";
    const opp = others(state, actorId);
    switch (type) {
      case "hi": case "hcv": case "exterminator":
      case "hot_chilli": case "the_sweep": {
        const hit = alreadyHit(state);
        const withRats = opp.filter((p) => p.rats > 0);
        if (withRats.length > 0 && withRats.every((p) => hit.has(p.id))) {
          return "Already attacked every kitchen with rats this turn";
        }
        return "Nobody has any rats to hit";
      }
      case "hot_ratato": {
        const hit = alreadyHit(state);
        const stealable = opp.filter((p) => p.good > 0 && !p.shielded);
        if (stealable.length > 0 && stealable.every((p) => hit.has(p.id)) && me.bad === 0) {
          return "Already attacked every kitchen you could steal from this turn";
        }
        return me.bad > 0 ? "No good rats to steal" : "No good rats to steal, and no bad rats to dump";
      }
      case "kleptomaniac": case "shakedown": case "rat_pack":
        return "Nobody's holding any cards";
      case "switcheroo":
        return "No kitchen different from yours";
      case "rat_trap":
        return "Every kitchen is already trapped";
      case "bolt_hole":
        return "You have no rats to protect";
      case "baptism":
        return me.badNormal === 0
          ? "No ordinary bad rat to convert (Fat Rats don't count)"
          : "Need 2 cards in hand to discard";
      default:
        return "Can't play this right now";
    }
  }

  return { REACTIVE, needsTarget, legalTargets, isPlayable, whyNot, norm };
});
