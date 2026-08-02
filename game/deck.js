"use strict";
/**
 * Card and rat definitions — RAT'S KITCHEN COMBINED v5.
 * Quantities are FLAT (same at every player count) except Rats and Health
 * Inspection, matching the v11 print-quantity convention.
 *
 * Cards marked STUB resolve to a no-op placeholder in v1 of the online
 * prototype. They exist in the deck (so counts/odds feel right) but their
 * full text is not yet wired up. See README_DEPLOY.md "Phase 2" for why.
 */

const HI_COUNT = 6;
const RAT_BASE = (players) => 10 + players;   // flat supply curve, §5 of v5 doc
const FRAC_FAT = 0.12;
const FRAC_BAD = 0.40;


/**
 * CARD TEXT — rules text as actually implemented, not as aspirationally
 * designed. Where the online build simplifies a card relative to the v5
 * design docs, the text below describes THE BUILD, and `simplified` flags
 * it so playtesters aren't judging a card by text it doesn't yet honour.
 *
 * short  — one line, shown on the card face in hand
 * full   — complete rules text, shown on tap-and-hold / info view
 */
const CARD_TEXT = {
  hi: {
    short: "Fire every rat in one kitchen",
    full: "Choose an opponent with at least one rat. ALL rats in their kitchen are fired — good and bad alike — and they lose 1 HP per rat (2 for a Fat Rat). Bolt Hole saves one rat from this. Fired rats go back under the deck.",
  },
  hcv: {
    short: "Fire one rat",
    full: "Choose an opponent with at least one rat. One rat is fired from their kitchen and they lose HP equal to its weight. Ignores Bolt Hole.",
  },
  hot_ratato: {
    short: "Steal a good rat, or dump a bad one",
    full: "Two ways to play it. STEAL: take a good rat from an opponent's kitchen into yours. DUMP: move one of your bad rats into an opponent's kitchen. You can only choose an option that's actually available.",
  },
  wok_block: {
    short: "Cancel an attack",
    full: "Reaction. Play when you are attacked to cancel it completely. Cannot itself be countered. You're only offered this if you're holding it.",
  },
  sleeper: {
    short: "Cancel an attack and keep the card",
    full: "Reaction. Cancels an incoming attack, and you keep the attack card rather than it going to the discard.",
  },
  snitch: {
    short: "Steal a card from your attacker",
    full: "Reaction. Does NOT cancel the attack — it still lands. You take a random card from the attacker's hand as compensation.",
  },
  bolt_hole: {
    short: "One rat survives an inspection",
    full: "Play into your own kitchen; you need at least one rat. The next Health Inspection that hits you spares one rat. Expires at the start of your next turn if unused.",
    timed: true,
  },
  territorial: {
    short: "Nothing gets stolen from you",
    full: "Your kitchen is shielded — opponents can't steal your good rats. Expires at the start of your next turn.",
    timed: true,
  },
  board_up: {
    short: "Nothing gets stolen from you",
    full: "Your kitchen is shielded — opponents can't steal your good rats. Expires at the start of your next turn.",
    timed: true,
  },
  exterminator: {
    short: "Clear out a whole kitchen",
    full: "Choose an opponent with at least one rat. Every rat in their kitchen goes back under the deck. No HP is lost — this removes rats rather than firing them.",
  },
  the_sweep: {
    short: "Clear one rat from a kitchen",
    full: "Choose an opponent with at least one rat. One rat goes back under the deck. No HP lost.",
    simplified: "In the design docs this arms and resolves at the start of the target's NEXT turn, so it can be played around. Here it resolves immediately.",
  },
  hot_chilli: {
    short: "Detonate a rat",
    full: "Choose an opponent with at least one rat. One rat detonates: it goes back under the deck and they lose HP equal to its weight.",
  },
  rat_trap: {
    short: "Catch the next rat they DRAW",
    full: "Place on any kitchen including your own. The next rat that player DRAWS FROM THE DECK is caught. YOU decide whether to keep it or let it go. Only fires on drawn rats — rats moved by cards pass through untouched. Resolves before the Cat.",
  },
  food: {
    short: "Heal 1 HP, or pay off the Cat",
    full: "Discard to heal 1 HP (up to your maximum). Food is also the currency for the Cat: 1 Food sends it away, 2 Food lets you choose whose kitchen it moves to.",
  },
  kleptomaniac: {
    short: "Steal a card from a hand",
    full: "Choose an opponent who is holding at least one card. Take a random card from their hand.",
  },
  shakedown: {
    short: "Take every copy of one card",
    full: "Choose an opponent holding cards. Name a card type — you take every copy of it from their hand.",
  },
  rat_pack: {
    short: "Take their entire hand",
    full: "Choose an opponent holding cards. You take their whole hand.",
  },
  switcheroo: {
    short: "Swap kitchens with someone",
    full: "Exchange your entire kitchen — good rats and bad rats both — with an opponent's. Only playable against a kitchen that differs from yours.",
  },
  tag: {
    short: "Redirect the next inspection",
    full: "Mark an opponent. The next Health Inspection played by anyone is redirected onto them instead of its original target.",
  },
  big_cheese: {
    short: "Dig 3 deep for rats",
    full: "Look at the top 3 cards of the deck. Any rats among them go into your kitchen; the rest are discarded. Blind — you don't know if you're pulling good rats or bad ones.",
  },
  bun_in_oven: {
    short: "A rat arrives next turn",
    full: "Plant it in your kitchen. At the start of your NEXT turn it matures: the nearest rat in the deck is placed in your kitchen. Blind — it may be good or bad. Bypasses both the Cat and any Rat Trap, since the rat is born there rather than entering.",
  },
  live_wire: {
    short: "Draw 2",
    full: "Draw 2 cards.",
    simplified: "The full card also allows forcing an OPPONENT to draw instead. Not yet built.",
  },
  gambit: {
    short: "Draw a card",
    full: "Draw a card.",
    simplified: "The full card is peek-and-choose — look at several and pick. Resolves as a plain draw for now.",
  },
  steak_out: {
    short: "Draw a card",
    full: "Draw a card.",
    simplified: "The full card lets you look at the top of the deck and choose. Resolves as a plain draw for now.",
  },
  trash_diver: {
    short: "Draw a card",
    full: "Draw a card.",
    simplified: "The full card recovers a chosen card from the discard pile. Needs a discard-browsing screen; resolves as a plain draw for now.",
  },
  wd_frenzy: { short: "Everyone draws", full: "Resolves the moment it's drawn: every player still in the game draws a card.", whenDrawn: true },
  wd_blackout: { short: "Redraw your hand", full: "Resolves on draw: you discard your entire hand and draw a fresh one.", whenDrawn: true },
  wd_ratrace: { short: "Everyone passes a rat left", full: "Resolves on draw: every player passes one rat from their kitchen to the player on their left. Most players dump a bad rat — so most players receive one.", whenDrawn: true },
  wd_audit: { short: "You discard a card", full: "Resolves on draw: you discard one card at random.", whenDrawn: true },
  wd_hi: { short: "One of your rats is fired", full: "Resolves on draw: one rat is fired from your kitchen and you lose HP for it. Bolt Hole does NOT stop this.", whenDrawn: true },
  wd_infestation: { short: "A rat rises to the top", full: "Resolves on draw: a rat is moved to the top of the deck — whoever draws next gets it, good or bad.", whenDrawn: true },
};

// name -> flat quantity (independent of player count)
const FIXED_CARDS = {
  hcv: 4,
  hot_ratato: 8,
  wok_block: 3,
  sleeper: 2,
  bolt_hole: 3,          // was "Cat" buff in v11; protects one rat from HI
  exterminator: 3,
  the_sweep: 3,
  territorial: 2,        // theft shield; merge candidate with board_up (open Q)
  board_up: 2,           // theft shield; merge candidate with territorial
  snitch: 2,
  rat_trap: 2,
  food: 12,
  kleptomaniac: 3,
  shakedown: 3,
  rat_pack: 3,
  switcheroo: 1,
  live_wire: 3,          // STUB: draw-2 only; "force opponent to draw" not wired
  gambit: 4,             // STUB: resolves as draw 1, not peek-and-choose
  steak_out: 3,          // STUB: resolves as draw 1, not peek-and-choose
  trash_diver: 1,        // STUB: no-op (needs discard-pile browsing UI)
  hot_chilli: 6,
  big_cheese: 3,
  bun_in_oven: 1,
  tag: 3,
  wd_frenzy: 2,
  wd_blackout: 1,
  wd_ratrace: 2,         // replaces WD: Rat Run CW/CCW
  wd_audit: 1,
  wd_hi: 2,
  wd_infestation: 3,
};

const CARD_LABELS = {
  hi: "Health Inspection",
  hcv: "Health Code Violation",
  hot_ratato: "Hot Ratato",
  wok_block: "Wok Block",
  sleeper: "Sleeper",
  bolt_hole: "Bolt Hole",
  exterminator: "Exterminator",
  the_sweep: "The Sweep",
  territorial: "Territorial",
  board_up: "Board Up",
  snitch: "Snitch",
  rat_trap: "Rat Trap",
  food: "Food",
  kleptomaniac: "Kleptomaniac",
  shakedown: "Shakedown",
  rat_pack: "Rat Pack",
  switcheroo: "Switcheroo",
  live_wire: "Live Wire",
  gambit: "Gambit",
  steak_out: "Steak Out",
  trash_diver: "Trash Diver",
  hot_chilli: "Hot Chilli",
  big_cheese: "Big Cheese",
  bun_in_oven: "Bun in the Oven",
  tag: "Tag",
  wd_frenzy: "WD: Frenzy",
  wd_blackout: "WD: Blackout",
  wd_ratrace: "WD: Rat Race",
  wd_audit: "WD: Audit",
  wd_hi: "WD: Health Inspection",
  wd_infestation: "WD: Infestation",
};

// cards the TARGET may play in response to being attacked
const REACTIVE_CARDS = new Set(["wok_block", "sleeper", "snitch"]);
const WD_CARDS = new Set([
  "wd_frenzy", "wd_blackout", "wd_ratrace", "wd_audit", "wd_hi", "wd_infestation",
]);

let _uid = 0;
function uid() {
  _uid += 1;
  return "c" + _uid;
}

function buildRatPool(totalRats) {
  const nFat = Math.round(totalRats * FRAC_FAT);
  let remaining = totalRats - nFat;
  const nBad = Math.round(remaining * FRAC_BAD);
  remaining -= nBad;
  const rats = [];
  for (let i = 0; i < nFat; i++) rats.push({ kind: "fat_bad", weight: 2 });   // fat rats are bad-only, §2 v3 doc
  for (let i = 0; i < nBad; i++) rats.push({ kind: "bad", weight: 1 });
  for (let i = 0; i < remaining; i++) rats.push({ kind: "good", weight: 1 });
  return rats;
}

function buildDeck(players) {
  const deck = [];
  const totalRats = RAT_BASE(players);
  for (const r of buildRatPool(totalRats)) {
    deck.push({ id: uid(), type: "rat", rat: r });
  }
  for (let i = 0; i < HI_COUNT; i++) deck.push({ id: uid(), type: "hi" });
  for (const [name, qty] of Object.entries(FIXED_CARDS)) {
    for (let i = 0; i < qty; i++) deck.push({ id: uid(), type: name });
  }
  return deck;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = {
  HI_COUNT, RAT_BASE, FIXED_CARDS, CARD_LABELS, CARD_TEXT, REACTIVE_CARDS, WD_CARDS,
  buildDeck, buildRatPool, shuffle, uid,
};
