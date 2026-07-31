# Rat's Kitchen Combined — online playtest prototype

Server-authoritative Node/Express/Socket.io game, plain-JS client (no build
step). Same stack family as your existing Turf Wars prototype, so this can
either replace it or run alongside it as a second Render service.

Tested end-to-end before hand-off: 3 headless full games (3-player) and 3
more at 8-player, driven over real Socket.io connections with randomised
legal actions, zero server errors, zero crashes, real winners reached every
time. That confirms the plumbing — it does NOT confirm balance or fun;
that's what this build is for.

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
code; everyone else joins on their own phone or laptop. No installs, no
accounts.

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

## Known rough edges (playtest-scale, not production-scale)

- Target selection uses a browser `prompt()` dialog — functional, ugly.
  Fine for a first playtest; first thing to replace with real UI if this
  goes further.
- No reconnect handling — if someone's tab closes mid-game before it
  starts, they're dropped from the lobby; mid-game disconnects just leave
  their seat unresponsive (their turn will eventually time out on any
  attack/trap prompt, but they won't auto-skip their own turn).
- No persistence — a Render restart (free-tier idle sleep counts) loses
  any in-progress game. Fine for one-sitting playtests, not for a game left
  running overnight.
- `removeCat` isn't restricted to your own turn — deliberate, so a blocked
  player isn't stuck waiting a full round just to try to shed their Cat,
  but worth watching whether that's too permissive at the table.
