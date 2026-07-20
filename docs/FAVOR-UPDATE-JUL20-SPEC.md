# FAVOR — Update spec, 2026-07-20 (Wyatt)

**Status: BUILT & SHIPPED 2026-07-20 (MPV 19, iOS build 16).** Open-decision calls made
in Wyatt's absence, each reversible: (1) the 11th-character store lock STAYS the
advertisement (renders nothing until his character lands anyway); (2) the detail view
shows the board ART + a five-cell DATA strip — same truth split the in-game overlay
already exposes; (3) the proposed curve shipped as specced (Side B at 390, slope 15 is
the dial); (4) retro-crossers get the full ceremony via an idempotent menu latch;
(5) §4's occlusion mechanism confirmed simpler than hypothesized — `#missionCeremony`
IS a root child but rides z-9500 under the z-9999 action panel; fixed with the
documented step-aside pattern + an inherited-tap guard, regression-tested with the
panel forced up and a screenshot during the ceremony.

Five items from Wyatt's 7/20 pass. Grounded against live code at `~/playfavor/` (root IS
playfavor.net; testrealm2 retired). Two of the five contradict the assumption in the
brief — flagged inline as **⚠ CONTRADICTS BRIEF**. Open decisions
collected at the bottom.

---

## 1. Hide Side B from players who haven't unlocked it

**Intent:** Level 5 is a *surprise*. A player below Lv 5 should have no idea Side B
exists. On unlock, tapping a character offers the A / B choice.

**⚠ This deliberately REVERSES the shipped design.** `docs/FAVOR-XP-SIDEB-SPEC.md` §5 and
the comment at `js/ui.js:1408-1409` state the locked badge is "the advertisement" — the
lock was *intended* to sell the unlock. Wyatt is overruling that. Worth one line in the
spec doc so nobody "fixes" it back (same class of note as the no-bots-on-Side-B rule).

**Two leak points, not one:**

| # | Location | Leak |
|---|---|---|
| 1 | `js/ui.js:1413-1417` | `<span class="side-badge">Side B · Lv 5</span>` on the select card. Emitted into `card.innerHTML` at `ui.js:1420`. |
| 2 | `js/meta.js:1075` | Profile hero tile `title="… — Side B at Level 5"`. Gated on `char.altSlots` only — **spoils regardless of unlock state**. This one was not in the brief. |

**Already safe, leave alone:**
- `renderSideChooser()` (`ui.js:913-935`) bails at `ui.js:919` if not unlocked — the
  `<b>Side B</b>` at `:931` is unreachable while locked.
- `chosenSideFor()` (`ui.js:901-908`) returns `null` unless `FLB.sideBUnlocked(heroId)` and
  re-validates against live unlock, so a stale `favorSidePref` can't leak a side.
- `showSideBCelebration` (`meta.js:606,625`) fires *on* unlock only.
- `xpRibbonHtml` (`meta.js:533-542`) carries no Side B text.
- `meta.js:1448` "Reach Level 5 with two heroes" is the **11th-character** shelf lock, a
  different feature. Decide separately whether that's also a spoiler (see Open Decisions).

**Change:** make both emissions conditional on `FLB.sideBUnlocked(char.id)`. Unlocked
players keep the lit `Side A ⇄ B` badge — that one is not a spoiler, it's the affordance.

---

## 2. Fullscreen character detail on the select screen

**Intent:** tap a character → it goes near-fullscreen so you can actually read what the
character does → **Back** (to the grid) and **Confirm** (lock it in).

**⚠ CONTRADICTS BRIEF — there is nothing to "zoom".** The select screen never renders
slot stats at all. `showCharacterSelect()` (`ui.js:1400-1430`) renders only: portrait art
(`char.filename`, **not** the board), name, epithet, difficulty stars, and `tip`
(`ui.js:1421-1428`). Tapping runs `selectCharacter()` (`ui.js:1468-1488`) — a FLIP
swap-into-center-ring animation, `.selected`, `renderSideChooser()`, reveal `#confirmBtn`.

So this is a **new view**, not an enlargement of an existing one. That's the main reason
"it's too hard to see" — the information was never on screen.

**What the detail view should show** (this is the real decision — see Open Decisions):
at minimum the **board art** with its five slots legible, since that is what actually
differs between characters and between A and B.

**Reuse candidate:** `#boardOverlay` (`index.html:302-314`, `openBoardOverlay()` at
`ui.js:3726-3744`) already renders board + slot ring at the shared `BOARD_OV_TRACK`
geometry (`ui.js:3811`).

**Reuse is viable but not free — it is hard-wired to a live table:**
- `openBoardOverlay` calls `myCharView()` (`ui.js:3727`), which needs `game`.
- `renderBoardOvSlots` opens `const player = game.players[0]` (`ui.js:3846`).
- `_ovPaidReach` early-returns on `!game` (`ui.js:3818`).
- The markup lives **inside `#game-screen`** (`index.html:292`) — the select screen is a
  different screen, so it needs moving to a root-level host or a second instance.

**Recommendation:** add a read-only mode that takes `(char, side)` directly instead of
reading `game`, and host the node above both screens. Keeps one board renderer and one
`BOARD_OV_TRACK` — which matters, because that constant is already duplicated literally
in `js/melee.js:123-124` and any third copy will drift.

**Interaction:** Back returns to the grid without changing selection; Confirm is the
existing `#confirmBtn` path. If Side B is unlocked, the A/B chooser belongs *in* this
view — that is exactly where "see what the character does" pays off.

---

## 3. Faster early levels, slower later

**Current curve is flat** (`js/meta.js:511-517`), confirming the brief:

```js
const XP_PER_LEVEL = 200;   // meta.js:511
const XP_MAX_LEVEL = 100;
const SIDEB_LEVEL  = 5;
heroLevel(fv) = Math.min(100, 1 + Math.floor((fv||0) / 200));   // meta.js:515-517
```

Level 5 therefore costs **800 banked Favor** — ~8 games. Level 1 alone costs 200, which is
why it drags.

**Anchor from Wyatt:** *"if you get 75 favor in a game, that should level you up"* — read as
**step(1) = 75 exactly**, then rising.

**Proposed curve** — linear ramp, capped so the top of the track doesn't balloon:

```
step(n) = min(75 + 15 * (n - 1), 300)     // cost of level n → n+1
```

| Transition | Step | Cumulative |
|---|---|---|
| 1 → 2 | 75 | 75 |
| 2 → 3 | 90 | 165 |
| 3 → 4 | 105 | 270 |
| 4 → 5 | 120 | **390 ← Side B** |
| 5 → 6 | 135 | 525 |
| … | … | |
| 16 → 17 onward | 300 (capped) | |
| → 100 | | ~27,900 |

- **Side B: 800 → 390 Favor** (~8 games → ~4). Faster than the original design target;
  Wyatt asked for faster, but this is the number to sanity-check against how a real game
  scores. If ~4 games is too cheap, raise the slope, not the anchor — the 75 anchor is the
  explicit ask.
- **Top of track: 19,800 → ~27,900**, so late levels genuinely slow down as asked.
- The cap at 300 is what keeps L100 reachable; an uncapped linear ramp lands at ~225,000.

**Implementation is cheap and zero-migration** — because trap #1 of the original spec was
honored: **`fv` (lifetime Favor) is stored, the level is derived.** `heroLevel` is a pure
function of `fv` at `meta.js:515`; `heroLevelPct` at `:518-521` needs the matching
piecewise change. Retuning the curve touches no stored data.

Since the formula is no longer a clean division, implement `heroLevel` as a small loop or
a precomputed 100-entry cumulative table rather than an inverted quadratic — retunable and
obvious. `heroLevelPct` reads `(fv − cum[L]) / step(L)`.

**⚠ Consequence to decide (not in the brief): existing players will jump levels
instantly.** A hero sitting on 600 banked Favor is Level 4 today; under the new curve 600
is **Level 6** — Side B unlocks silently. The Lv-5 ceremony fires on a *crossing* detected
inside the `postGameResult` txn (`meta.js:711-736` → `ui.js:6768-6770`), so it will **not**
retro-fire; those players just quietly have Side B next time they look. Options in Open
Decisions.

---

## 4. Mission completed early → reward never shown before melee

**Report:** Terror of the Mountain, due Act 3, attempted early in Act 2. Completed
successfully. No visible credit — "went straight to the melee."

**⚠ CONTRADICTS BRIEF — the missing-path theory does not hold. Both early-completion
paths already run the full ceremony and both are awaited.** This was closed on 7/18; the
comment at `ui.js:5864-5871` names this exact case ("an early turn-in success").

| Path | Route | Ceremony? |
|---|---|---|
| Act-boundary "attempt now" chooser | `showEarlyMissionChoice` (`ui.js:5804-5862`) sets `m._attemptNow` (`:5474`) → `isDue()` (`gameState.js:2269`) treats it exactly like a due mission → same measured rewards (`gameState.js:2284`) | ✅ same `showMissionCeremony` as any due mission |
| Mission lightbox "Turn In" | `ui.js:4396-4418` → `missionBeat()` (`ui.js:5875-5892`) | ✅ awaits its own `showMissionCeremony` (`:5890`) |

`endActPhases` (`ui.js:5454`) awaits the ceremony **before** melee:
`showMissionCeremony (:5583)` → `showMissionDrawBeat` → `afterBorrows` → `afterPenalty` →
`afterPromise` → `showMissionDrawBeat` → **`startMelee` last** (`:5592`).

So the beat is not missing from the code — **it did not reach Wyatt's eyes.** That reframes
this from "add the reward display" to "find why the display didn't land."

**Leading hypothesis — the ceremony played invisibly, underneath something.**
`#missionCeremony` is nested inside the game screen's stacking context. Per the documented
rule in the dev notes: *`#actionPanel` is a root body child at z-index 9999; every game
overlay is nested in the game screen's stacking context and can never paint above it.* If
the action panel (or another root-level overlay) was still up when the ceremony activated,
the ceremony runs its full timeline — `renderBeat` → 1s → `stamp` → up to 5.2s hold →
`next`/`close` (`ui.js:7546-7601`) — completely hidden, then resolves into melee. That
matches "went straight to the melee" precisely: not a skipped beat, an occluded one.

**Second candidate:** tap-through. The early-choice modal's confirm tap landing on the
freshly-`active` ceremony overlay. `el.onclick` (`ui.js:7605-7608`) guards double-taps via
`stampedAt` (380ms × `CINEMATIC_SPEED`) but there is no guard against an *inherited* first
tap arriving before `renderBeat` settles.

**Third, narrower:** `ui.js:4414-4417`, the penalty-discard picker after a lightbox turn-in,
is fired `.then()`-style and not awaited upstream. Harmless mid-act, but it could race if a
lightbox turn-in lands inside the act-end window.

**Next step is a repro, not a patch.** Rig the exact case in `tools/ui-audit.mjs` — attempt
a not-yet-due mission at the Act 2 boundary and **screenshot during the ceremony window**.
Synthetic clicks bypass hit-testing, so an occlusion bug passes every assertion and shows
up only in the screenshot; that is the known failure mode here and the reason to look
rather than assert. Whatever it turns out to be, the fix belongs in the same commit as the
audit flow that catches it.

---

## 5. Slider preview must show what you LOSE, not just what you gain

**Intent:** sliding from slot 4 (4 Knowledge) to slot 5 gains slot 5 **and gives up slot
4**. The loss is real in the engine but invisible in the UI. Show `−4 Knowledge`.

**⚠ CONTRADICTS BRIEF, mildly — there is no "+N skill" gain preview to extend.** The brief
says "you see what you gain." Nothing in the slide preview reads slot skills at all. The
confirm chip surfaces exactly three facts:

```js
// renderBoardOvConfirm — ui.js:3986-3995
<div class="sc-text">Slide to <b>${posNames[_ovSlideTarget]}</b>?</div>
<div class="sc-cost">${steps} space${steps>1?'s':''} · <b>−${cost} Gold</b></div>
```

Destination name, space count, gold cost. The per-slot tooltip (`ui.js:3881`) is the same
minus the name. Drag (`_ovRingDragInit`, `ui.js:4027-4118`) only toggles `snap`/`snap-bad`
classes — no text. `payToSlide` (`ui.js:5059-5109`) is post-hoc only: *"Slider moved to X
(−5g)"*. Skills become visible only *after* the move, when `renderGameState()` repaints the
chips (`ui.js:2855`, `:3224`).

Most likely Wyatt is reading the **gains off the board art itself** (the destination slot's
printed icons) — which is exactly why the loss is invisible: the slot you're leaving is
just as printed, but nothing tells you it's about to stop counting.

**So the ask is a net delta, and both halves are new.**

**Seam:** `renderBoardOvConfirm` (`ui.js:3972-3996`). It already holds `player`,
`_ovSlideTarget` and `player.sliderPosition`, so `char.slots[from].skills` and
`char.slots[to].skills` are one lookup each. Secondary seam: the tooltip at `ui.js:3881`
if it should show on hover too.

**⚠ A naive `slots[from]` vs `slots[to]` diff will under-report.** `applySlotSkills`
(`gameState.js:1044-1134`) is not a plain read of `slot.skills` — it also folds in:
- slot `special` Mind's Eye grants (`gameState.js:1063-1073`)
- the Scientist Side-B `alchemy_adds_to_power` rule, baked in at the **end** of
  `applySlotSkills` (~`gameState.js:1120`)
- `bonusSkills` (`:1112-1118`), which survive slider recalc and must **not** appear in the
  delta — they're not what's changing

The honest way to compute this is the same trick the mission beats already use: **measure
it through the engine** rather than re-deriving it in the UI. Snapshot `player.skills`,
run the slot resolution against the target position on a scratch copy, diff. That way
specials and Side-B rules are correct by construction and can't drift — the mission
ceremony's `measureResolution` (`ui.js:5884`) is the precedent.

**Display:** one line of gains and one of losses, e.g. `+3 Power` / `−4 Knowledge`, using
the existing `SKILL_ICONS` (`ui.js:2727`) and the `good`/`bad` chip styling already used
by the mission ceremony.

---

## Open decisions for Wyatt

1. **(§1)** Is `meta.js:1448` "Reach Level 5 with two heroes" — the **11th character** store
   lock — also a spoiler to hide, or does that one stay visible as the advertisement?
   Different feature from Side B; needs its own call.
2. **(§2)** What exactly goes in the fullscreen character view? Board art + five slots is
   the minimum. Also: the printed slot values on the Side A *boards* disagree with the
   tuned Side A *data* in several places (Knight A s4 prints 6, data says 5 — see the
   art-verbatim contract). **A fullscreen board view will put that discrepancy in front of
   players for the first time.** Show art, show data, or reconcile?
3. **(§3)** Is Side B at **390 Favor (~4 games)** right, or too cheap? Slope is the dial;
   the 75 anchor is fixed by the ask.
4. **(§3)** Existing players jump levels the moment the curve ships (600 fv: L4 → L6, Side B
   silently unlocked, no ceremony). Let it land quietly, or detect the retro-crossing once
   at boot and play the ceremony?
5. **(§4)** Confirm the repro before any fix: was it the **act-boundary chooser** or the
   **mission-lightbox Turn In** button? That single detail splits the three hypotheses.

## Ship notes

- MPV bump: **§3 only** (curve is client-derived, but it changes an unlock gate — bump on
  principle, per the Side-B precedent). §1/§2/§5 are presentation. §4 TBD pending diagnosis.
- Per-fix loop unchanged: 3 suites green + eyeball `tools/audit-shots/` → sed-bump the
  `?v=` stamps (`s/?v=[0-9][0-9]*/?v=$STAMP/g`, **never** `[0-9]*`) → commit+push → reload
  Wyatt's tab → poll live `?v=` via curl.
- Every new interaction (§2 detail view, §5 delta chip) needs smoke checks **and** a
  ui-audit flow in the same commit. §5 especially — a skills diff is exactly the kind of
  thing that passes a synthetic-click assertion and is wrong on screen.
