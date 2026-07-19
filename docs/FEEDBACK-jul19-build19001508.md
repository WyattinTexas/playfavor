# FAVOR — Build Feedback (v20260719001508)

Source: Wyatt playtest, 2026-07-19. Screenshots: full game (Act II melee + end-of-game breakdown panels).
Priority order below is the order to work them.

---

## P0 — Favor is not accumulating during play (the big one)

**Symptom:** Favor appears to be added *progressively / partially* through the game rather than being a live running total. End-of-game breakdown panels show `+0` on cards that should be contributing, and `0 Favor` on missions that should have paid out.

**Intended model (this is the spec — treat card Favor like point values on a board game card):**

- A player's Favor is **the sum of the Favor values of everything they currently hold/control**, recomputed live.
- Play a card that grants Charisma → Favor goes **up** immediately by that amount.
- **Lose** a card that was granting Charisma → Favor goes **down** by that amount immediately.
- It is fine (desired) for the HUD to show *current* Favor. But "current" must mean *recomputed from current board state*, not an incrementally-patched counter that drifts.

**Suspected root cause:** Favor is being tracked as an incremental accumulator that gets mutated on some events and not others (and never on card loss/removal), instead of being derived from state. Recommend converting to a **derived/recompute function** (`computeFavor(playerState)`) called after every state change, rather than `favor += x` sprinkled at call sites.

**Acceptance:**
- Play card w/ Favor value → total updates same frame.
- Lose/steal/discard that card → total decreases by exactly that amount.
- Total at end of game === sum of all breakdown panel rows.

---

## P0 — Missions not calculating Favor (score 0 at end)

**Symptom:** A mission that rewards based on how much **Knowledge** you have paid out **0** at game end. `You · Missions` panel reads "No missions completed for Favor." despite qualifying state.

**Hypothesis:** Mission progress isn't being evaluated during play (same root cause as above — the underlying stat totals aren't live), so at scoring time the mission reads a stale/zero value.

**Also check:** the **Golden Fiddle** (and any other card whose payout scales off a running stat) — same failure mode is likely. Audit every "scales with X" card/mission together, not one at a time.

**Acceptance:** Set up a game with known Knowledge total → mission pays exactly the formula amount. Golden Fiddle pays its scaled amount.

---

## P0 — Character panel shows a nonsense number

**Symptom:** `You · Character` → "Favor earned in play (rewards & missions)" **+6**, but the player ended on a skill slot with **no points there**, and the Missions panel says **0 Favor**.

**Two problems:**
1. The +6 is not traceable to anything (contradicts the Missions panel showing 0 — these two must reconcile).
2. Label/value mismatch: the row says "rewards & missions" but the subtitle says "Your standing on the character board when the game ended." Those are two different quantities. Pick one and make the number match the label.

**Acceptance:** Character panel value is reconstructable from an itemized log; sum of all breakdown panels === final Favor shown on the scoreboard.

---

## P1 — Duplicate card played by AI (Act II: two Guardians)

**Symptom:** In Act II melee, an opponent played **two Guardian cards** in the same melee. Guardian is a singleton — there are very few duplicate cards in the game and Guardian is not one of them.

**Where to look:** AI hand construction / deck-draw for Act II opponents — likely drawing from a pool without removing the drawn card, or seeding the AI hand independently of the shared deck so uniqueness isn't enforced.

**Acceptance:** No card that has copies=1 can appear twice across all hands/board simultaneously. Add an assertion in dev builds that fires on duplicate singleton instance IDs.

---

## P1 — Artifact classification is wrong

**Symptom:** Non-artifact cards are showing up in the `You · Artifacts` breakdown panel.

Artifacts are the **dark purple** cards. e.g. **Family Ring**, **Royal Hilt** = correct artifacts.

Wrongly classified as artifacts (confirmed in screenshots):
- **Forbidden Lab** — not an artifact (blue)
- **Mind's Eye** — not an artifact (pink/magenta)
- **Fortune Teller** — not an artifact (pink/magenta)
- **Marketplace Sales** — not an artifact (green)

**Where to look:** the artifact predicate in the scoring/breakdown code. It's likely falling back to a loose heuristic (has an item-ish frame? has a passive? non-character?) instead of reading an explicit `type: 'artifact'` field. Fix the data tagging AND the predicate.

**Also note:** every row in these panels reads `+0`, which is the P0 favor bug bleeding through — but the classification bug is separate and needs fixing on its own.

**Acceptance:** Run a full audit pass over the card data: every card has an explicit type; the Artifacts panel contains exactly the dark-purple set and nothing else.

---

## P2 — Melee phase: tap anywhere to advance

**Symptom:** During the melee phase there is a window where the **Continue button is clickable but the rest of the screen is not** — a few seconds later the rest of the screen becomes clickable. Inconsistent and feels broken.

**Wanted:**
- **Tapping anywhere on screen** during melee advances/expedites the phase — not just the Continue button.
- Expedite should be **slight** — it speeds the reveal along, it does not skip the whole phase. Keep the beats readable.
- Input availability should be **consistent**: whenever Continue is live, the full-screen tap target is live too. No dead-zone window.

---

## Suggested work order

1. Rewrite Favor as a **derived value** (`computeFavor` from state) — fixes P0 #1 and unblocks #2/#3.
2. Re-run mission evaluation off the live stats; verify Knowledge-scaling mission + Golden Fiddle.
3. Reconcile the end-of-game breakdown panels so they sum to the final score; fix the Character panel label/value.
4. Fix artifact typing in card data + the predicate; audit all cards.
5. Fix AI singleton duplication (Guardian).
6. Melee full-screen tap-to-advance with consistent hit region.

## Verification checklist before handoff

- [x] Play a full game; screenshot every breakdown panel; panels sum to final Favor.
- [x] Favor visibly moves up on play and **down** on loss of a Favor-granting card.
- [x] Knowledge-scaling mission pays the correct non-zero amount.
- [x] Golden Fiddle pays a correct scaled amount.
- [x] Artifacts panel = dark-purple cards only.
- [x] No duplicate singletons across a full 3-act game (assert in dev).
- [x] Melee: tap anywhere advances, from the first frame Continue is live.

---
---

# RESOLVED — 2026-07-19

All six items. Three of them turned out to be one root cause, and the audit
pass you asked for on the card data found more than expected.

## The three P0s were one bug

`player.favor` was an **opaque scalar**. Card combos, map bonuses, mission
rewards and mission success specials all added into it, and scoring had
nowhere to put that bucket but the **Character** row.

**Trust of the Elders** — the Knowledge mission — prints `favorValue: 0` and
pays entirely through "1 Favor for each Knowledge you have". So its payout
landed in the bucket and rendered as *"+6 · Favor earned in play (rewards &
missions)"* under a panel captioned *"Your standing on the character board"*
— while the Missions panel, which only ever read `favorValue`, said **"No
missions completed for Favor."** Your +6 was real. The attribution was
fiction. **Golden Fiddle is the same card in a different suit** (favorValue 0,
"2 Favor for Each Charisma"), and so are The Shadow Guide and King of the Sky.

Fix: **an itemized Favor ledger.** Nothing writes `player.favor` any more —
every payment goes through `awardFavor()`, which records what paid it, what
it was for, the formula, and when. `player.favor` is re-derived as the sum.
The score sheet reads the ledger, so every cell reconstructs to the line item,
and the drill-down now names the formula (*"Golden Fiddle — 2 per Charisma"*)
so you can check the number against the card.

Favor was already derived from board state for the live HUD, so "up on play,
down on loss" already held — there's now a test pinning it.

## Two Favor sources that no card prints — removed

Same class as the gold→Favor conversion you killed on 7/18. This is what "not
traceable to anything" was pointing at:

1. **+10 "Forgotten Temple + Sacred Chest combo."** Forgotten Temple prints
   *"Map of Sacred Chest & 1 Knowledge & 2 Scorn"* — it hands you the map,
   which its `grantsMap` field already did. Sacred Chest prints *"Req: 12 Gold
   **OR** Forgotten Temple Map"* — the map waives the gold. That waiver is the
   whole relationship; there was no bonus on top of it.
2. **+5 for a "named combo."** Exactly three cards carry a string `combo`, and
   on all three the string is a **map** that leaked into the combo field
   (Facing the River Fiend → "The Minister's Plan", Finding the Lost Corridor
   ↔ Reunited). None of them print a pairing bonus.

## Artifact classification — the audit found 20 mistyped cards, not 4

You were right on all four, and right about Royal Hilt. Two separate bugs:

**The panel was a catch-all.** It listed every played card that wasn't an
Adventure. That's why Forbidden Lab and Marketplace Sales showed up — they
were correctly typed all along. Rulebook p.8 counts *"Collected Adventure &
Artifact Favor"*, so those are the only two card rows now, and Artifacts means
artifacts.

**The data was typed off a false premise.** `data/cards.js`'s own header said
*"Border colors: blue=Act1, green/teal=Act2, pink/purple=Act3"* — cross-tab
act against frame color and every color spans all three acts. **Frame color is
the card TYPE**, per rulebook p.11, which pictures an exemplar for each of
**seven** colors (the UI only knew six — and had wisdom painted blue and
endeavor gold, which is why "blue" and "pink/magenta" named colors the game
had no families for). Sampling all 105 frames clusters them into exactly seven
flat spot-colors. **20 cards were wrong**, including:

- **Royal Hilt** weapon → **artifact** (dark purple; it was typed off its sword icon)
- **Mind's Eye**, **Fortune Teller** artifact → **wisdom** — Fortune Teller is
  the rulebook's own WISDOM exemplar
- **Lost North Map**, **Lost South Map** adventure → **artifact** — Lost North
  Map is the rulebook's own ARTIFACT exemplar

The true artifact set is **8 cards**. And a good sign the retype is right: it
makes every Favor-bearing card an Adventure or an Artifact, exactly as the
rulebook says — with one printed exception (Chemical Y's Chemical-X bonus,
which the sheet folds into Adventures and names in the drill-down).

⚠ **This changes scoring**, because real logic keys off `type`. Sacred Chest
pays "8 Favor for each Wisdom Card you have" and the wisdom pool goes **8 →
12**, so it's worth up to 32 more. Artifact pool 10 → 8, potions 12 → 11,
weapons 15 → 14. It's a correctness fix — the digital game had been
mis-scoring against the printed cards — but **it wants a balance pass from
you**, especially Sacred Chest.

## Guardian: a display bug, not a duplicate card

The engine held **one** Guardian the whole time — I drove 300 randomized
3-act games censusing every card id across all decks, hands and boards: zero
duplicate ids. Guardian is unusual in granting 2 Power *through skills* **and**
firing a power special, so `powerBreakdown` emitted its art **twice** — once as
a base card, once as the "negates the strike" step — and the melee dealt both
into the same row, badged +2 and +3. Now a card gets one face; the negation
keeps its label and amount. **Heaven's Blade and Dawnharbinger had the
identical defect.**

**Found while in there:** `calculatePower` was **spending Guardian's shield on
every call** — and `sampleSeatStats` (documented "pure bookkeeping … must never
gate a rule or change a score") calls it on every card play. So the shield was
being burned by a telemetry sample, acts before the strike it was bought to
survive. It's pure now; only the melee spends it.

## Melee: the dead zone was 58% of the phase

Two causes, both real:

- **Temporal.** The full-screen tap only ever did anything *while the Continue
  button was on screen* — measured, that left **19.7s of a 33.9s melee**
  dropping taps, including 6.5 inert seconds at the top.
- **Spatial.** The card row was excluded wholesale, and on a phone that's a
  **full-width 126px band across the bottom** — which *moves* as the row fills
  and empties. Two taps 12px apart, opposite results. That's the
  "inconsistent" part.

Now every frame is live: Continue armed → advance; otherwise → **expedite**,
which cuts the in-flight beat short and runs later beats slightly faster
(floored at 0.55×). Every cut is floored to its own CSS animation — the coin
flip can't be hurried below its 1.6s spin — so it speeds the reveal without
ever skipping a beat. The card row still swallows **swipes** (>8px of travel)
so scroll-to-read is safe, but a press advances like anywhere else. The 2s
coronation hold is untouched.

## One thing I did NOT change — your call

Trust of the Elders prints *"1 Favor for Each Knowledge you have, **1
Knowledge**"* — payout first, grant second. The engine grants skills *before*
resolving the special, so the mission **pays for the Knowledge it just handed
you** (7, not 6). Left alone: it predates this work and reward ordering feeds
the 7/18 fixed-point convergence. Worth a ruling.

## Tests

engine-smoke **504** (was 470) · audit-check **ALL CLEAN** · ui-audit **831**
(was 814), zero console errors.

Two test bugs of my own, worth naming:

- **Six existing tests were asserting the OLD card types** — they'd have
  failed on correct code. Retuned to state the rule (and rigged off the
  rulebook's own exemplars, so they can't drift again).
- **My new melee block first ran in PORTRAIT**, behind FAVOR's "Turn Your
  Device" gate — and passed anyway, because `#meleeSplash` is a body-level
  z-10600 sibling and `evaluate(el.click())` bypasses hit-testing. That is
  exactly how an occlusion bug sails through every assertion and only shows
  in the screenshot. It runs landscape now, with an explicit
  on-screen-and-hit-testable guard so the mistake can't repeat.

The measured melee result: opening stretch **2786ms idle → 1447ms tapped**.
Hurried, not skipped.
