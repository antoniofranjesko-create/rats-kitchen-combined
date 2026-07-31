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
