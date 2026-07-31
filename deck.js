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
  HI_COUNT, RAT_BASE, FIXED_CARDS, CARD_LABELS, REACTIVE_CARDS, WD_CARDS,
  buildDeck, buildRatPool, shuffle, uid,
};
