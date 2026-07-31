# Rat's Kitchen Combined — online playtest prototype

Server-authoritative Node/Express/Socket.io game, plain-JS client (no build
step). Same lobby model as the Turf Wars prototype: **seats you fill with
bots or humans**, mobile-first UI, session rejoin.

**Deliberately NOT copied from Turf Wars:** React-via-CDN with inline Babel.
That's what caused the blank-screen deploy failure there — a single missing
comma broke the whole script block before React could render. This is plain
JS: no build step, no transpiler, no single-syntax-error-kills-everything
failure mode.

Tested end-to-end before hand-off over real Socket.io connections:
9 full games across 2P, 4P and 8P (1 human + 1/3/7 bots), plus 40 games
driven directly against the engine. All reached a winner; zero crashes.

One real bug was found and fixed during that testing, worth knowing about
because it could recur if you extend the turn logic: if a player DIED
DURING THEIR OWN TURN (a bad rat pushing them to the loss threshold
mid-turn), the turn pointer stayed on the dead player forever and the game
froze permanently. `beginTurn` only skips players who were already dead when
it ran. The fix is `engine.ensureTurnPlayable()`, called on every state
broadcast. **Any new code path that can kill the active player mid-turn must
not bypass it.**

That confirms the plumbing. It does NOT confirm balance or fun — that's what
this build is for.

---

## STEP 1 — Run it locally

```bash
cd rk-online
npm install
npm start
```

Open `http://localhost:3000` in several browser tabs (or on your phone via
your machine's LAN IP) to test with 2-8 "players" as one person. First tab
creates a room and gets a 4-letter code; the rest join with that code.

## STEP 2 — Play a round yourself before showing anyone else

Open 3 tabs, create a room in tab 1, join with the code in tabs 2 and 3,
hit **Start game** in tab 1. Confirm:
- Kitchens are visible to all three tabs (public zones — this is load-bearing).
- Only your own tab shows your own hand.
- Playing an attack card (Health Inspection, Hot Ratato, etc.) pauses and
  waits for the target's tab to respond before anything resolves.
- Ending a turn advances to the next player and auto-draws for them.

If anything looks wrong, check the browser console and the terminal running
`npm start` — errors surface in both.

## STEP 3 — Push to GitHub

```bash
cd rk-online
git init
git add .
git commit -m "Rat's Kitchen Combined — online prototype v1"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

If you want this in the SAME repo as your existing Turf Wars prototype
(`github.com/antoniofranjesko-create/turf-wars`) rather than a new one, put
this folder in a subdirectory (e.g. `combined/`) and adjust Render's root
directory setting in Step 4 accordingly.

## STEP 4 — Deploy to Render

1. [render.com](https://render.com) → **New +** → **Web Service**.
2. Connect the GitHub repo from Step 3.
3. Settings:
   - **Root Directory**: blank (or `combined/` if you nested it).
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free is fine for playtesting.
4. Deploy. Render gives you a URL like `rats-kitchen-combined.onrender.com`.
5. Same free-tier behaviour as your existing prototype: ~30-50s cold wake
   after idle, gone entirely on the $7/mo tier if playtests get frequent
   enough to matter.

## STEP 5 — Run a playtest

Share the Render URL. One person creates a room and reads out the 4-letter
code; everyone else joins on their own phone. No installs, no accounts.

**You don't need other people to start testing.** Create a room, tap
**+ Add bot** until the table's the size you want (2-8 seats), hit Start.
Bots play immediately. Add real players to any remaining seats — a table
can be any mix of humans and bots.

**Bot speed** is tunable via a Render environment variable if turns feel too
slow or too frantic to follow:
- `BOT_THINK_MS` (default 900) — pause before a bot takes an action
- `BOT_REACT_MS` (default 700) — pause before a bot answers an attack

Set them under the service's **Environment** tab. Lower = faster games.

**Refreshing is safe mid-game** — your seat is held and you'll rejoin
automatically via sessionStorage. Closing the tab before the game starts
drops your seat.

---

## What to actually watch for, per COMBINED_v5 §5-6

The simulation flagged these as things numbers can't judge — this is the
build that answers them:

1. **Lead changes** — sim showed 30-44 at 5P-8P, close to the point where a
   game stops feeling skill-driven. Watch whether players feel like they're
   steering outcomes or just reacting to whoever drew what.
2. **The declare window** (⚠ ON NOTICE tag in the UI) — is one lap of the
   table targeting you tense, or does it just feel like getting reset?
3. **Teach time** — how long from "here's the rulebook" to everyone playing
   confidently. Two rat types, HP, a win threshold, a loss threshold, the
   Cat, traps and the declare window is real complexity.
4. **Whether the blind rat draw feels tense or arbitrary.**
5. **Real elapsed time** — TOTAL from the sim (§1 of COMBINED_v5) estimated
   35-60 real minutes at 6P-8P. Time an actual game and check that estimate
   against reality; turn length varies a lot by how many reactive cards get
   played, which the sim can't see.

---

## PHASE 2 — what's simplified in this build, and why

Built to prioritise the core loop over full card fidelity, since the core
loop is what the open design questions actually depend on. Not yet wired
to full v5 text:

| Card | Current behaviour | Full behaviour, not yet built |
|---|---|---|
| Food | Heal 1 HP, or discard | Boost — powering up ~10 other cards. Needs a UI for "play this card boosted by discarding a Food," which touches every other card's play flow. |
| Live Wire | Draw 2 for yourself | Or force an opponent to draw 2 instead — needs a mode choice. |
| Gambit, Steak Out | Draw 1 (placeholder) | Peek top cards and choose which to keep — needs a reveal-and-select UI, the single biggest missing piece. |
| Trash Diver | No-op | Recover a card from the discard pile — needs a browsable discard UI. |
| Tag | Redirects the very next HI played by anyone, globally | v11 intent was narrower ("your next HI redirects to your target") — needs clarifying which reading is correct. |
| The Sweep | Resolves immediately | Should arm on play and resolve at the start of the target's NEXT turn — telegraphed, dodgeable. Currently loses that tell. |
| Hot Ratato | Any opponent, no seat restriction | v11 used CW/CCW seat-based targeting; Combined docs never explicitly re-litigated whether that survives. Needs a seating-order data structure if restored. |

None of these are hard to add — they're all scoped out, not blocked. Tell
me which ones matter enough to prioritise once the core loop has been
played a few times; that'll be a better prioritisation signal than guessing
now.

## Fixed since last handoff — three real bugs, from one bug report

**1. Starting hand was averaging ~5 cards, not 7.** `startGame()` drew
exactly 7 raw cards per player and discarded any that turned out to be rats
or WD cards instead of drawing past them — with ~23% of the deck being
rats/WD, hands were consistently short. Now draws UNTIL 7 real cards land
in hand, matching the validated Python sim's setup logic exactly.

*Note, not a bug:* whichever player goes first will show 8 cards right
after setup, not 7. That's correct — "draw 1 at start of turn" applies to
turn one the same as every other turn, so the first active player's
opening draw stacks on top of their dealt hand until they play something
down. Matches the Python sim's behaviour; don't "fix" this later.

**2. Bots attacked kitchens with nothing in them.** Target selection for
Health Inspection, HCV, Exterminator, Hot Chilli, and The Sweep just picked
"the leader" with no check that they had any rats at all — near-universal
early game, when everyone's still at zero. Bots now filter to opponents who
actually have something at stake before choosing among them.

**3. The freeze — this was the serious one.** The reaction modal had a real
logic bug: a line meant to conditionally hide the generic Cancel button
always evaluated to "show it" (`cond ? false : false` — both branches
return `false`), regardless of context. So every attack-reaction prompt
showed a stray Cancel that just closed the modal without telling the server
anything. Combined with bug #2 (a pointless attack on an empty kitchen,
where the only *real* option was "Take it" for a no-op), Cancel was the
obviously intuitive tap — and it left `pendingAttack` set forever, which
blocks every other action.

Two layers of fix, not one:
- **Root cause (#2):** an attack against a target with nothing at stake now
  resolves immediately with no reaction prompt at all — nothing to react to.
- **The actual bug (#3):** the modal's cancel logic is fixed, and the two
  *forced* prompts (attack response, trap decision) no longer show a
  generic Cancel at all — "Take it" / "Let it go" are already the built-in
  no-op choice, so a second silent dismiss route has no reason to exist.
- **Defence in depth:** a server-side timeout (`REACT_TIMEOUT_MS`,
  `TRAP_DECISION_TIMEOUT_MS`, both env-configurable) now backstops EVERY
  pending attack/trap, human or bot, armed and cleared centrally on every
  state broadcast. This is the piece that was silently dropped when the
  server was rewritten for bots — the bot-turn scheduler had its own fast
  timer, but nothing existed for humans. If a client bug like #3 ever
  recurs, the server now rescues the game on its own rather than hanging
  forever.

Verified: hand sizes correct across 2P-8P, an empty-kitchen HI fizzles with
zero reaction prompt, `resolveAttack()` (exactly what the timeout calls)
confirmed to correctly resolve and unstick the turn, and 9 full bot games
re-run across 2P/4P/8P post-fix with no regressions.

## Card legality — one module, three consumers

`game/legality.js` is the single source of truth for two questions: can this
card be played at all, and if it needs a target, which targets are legal.

It is consumed by **the server** (authoritative rejection in
`engine.playCard`), **the client** (greys out dead cards, and target pickers
only ever list legal targets), and **the bots** (they can't even consider an
illegal move). It's served to the browser from `game/` via an explicit route
rather than copied into `public/` — two copies would drift, which is the
exact bug class it exists to prevent.

**Why this replaced the previous approach.** Legality rules used to be
scattered across bot targeting, server validation and client UI, each with
its own partial idea of what was allowed. Fixing bot targeting therefore
didn't stop humans being attacked by cards that couldn't do anything. The
earlier "fizzle" fix was also wrong in kind: it let the nonsense play happen
and merely made it quiet — the card was still consumed and a reaction prompt
still opened. Now an unplayable card is **rejected**: not consumed, no
prompt, nothing resolves.

Current rules:

| Card | Requires |
|---|---|
| Health Inspection, HCV, Exterminator, Hot Chilli, The Sweep | a target with at least one rat |
| Hot Ratato (steal) | a target with a good rat, not shielded |
| Hot Ratato (dump) | you hold a bad rat |
| Kleptomaniac, Shakedown, Rat Pack | a target holding cards |
| Switcheroo | a kitchen different from yours |
| Rat Trap | a kitchen not already trapped |
| Bolt Hole | you have a rat to protect |
| Food, shields, draw/dig cards | always playable |

If you add or change a card, change it **here** and all three consumers
follow automatically.

## The bots

Ported directly from the Python balance sim's heuristic policy — the same
logic the 300-games-per-config sweeps were validated against, so bot games
should land in roughly the same pace band the docs predict.

They are **greedy, not clever**: they always target whoever is closest to
winning, hold reactive cards until attacked, spend Food on healing when hurt
and on shedding a Cat when blocked, and never voluntarily keep a bad rat
from a trap. Good enough to validate pace and let you test solo. Not good
enough to ship as a "play vs AI" mode — same caveat as the Turf Wars bots.

Bot logic lives in `game/bot.js`, entirely in the `PRIORITY` table and
`chooseTargetFor()`. Reordering that table changes how bots play without
touching the engine.

## Known rough edges (playtest-scale, not production-scale)

- **No turn timer for humans.** If a player disconnects mid-game their seat
  is held for rejoin, but the game will sit waiting on their turn
  indefinitely. Fine for a group in the same room; a problem for strangers.
  Easiest fix if needed: auto-end a turn after N seconds.
- **No persistence.** A Render restart (free-tier idle sleep counts) loses
  any in-progress game. Fine for one-sitting playtests.
- **`removeCat` isn't restricted to your own turn** — deliberate, so a
  blocked player isn't stuck waiting a full round to shed a Cat. Worth
  watching whether that's too permissive at the table.
- **Bad-rat targeting is coarse.** Where a card fires "one rat" and a player
  has both good and bad rats, the engine prefers firing a GOOD rat (harshest
  reading). If you'd rather the victim chose, that's an engine change in
  `resolveAttack`.
