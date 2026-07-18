# FAVOR — Work Order, 7/18 evening

Everything in this file comes from Wyatt's Discord notes of 7/18 (raw source in the appendix), traced to code and turned into executable work. **Every file:line anchor below was verified against commit `7aecb17` — go straight to the line, do not re-explore.**

---

## Start here

**Working tree:** `~/playfavor/` — **root IS playfavor.net.** `testrealm2/` is retired (stale snapshot on disk, deletion is Wyatt's call). `testrealm/` is Skylar's melee space — `js/melee.js` and `css/melee.css` only.

**Baseline:** commit `7aecb17` · live `v20260718150654` · iOS TF 1.0(11) IN_BETA_TESTING · tree clean apart from untracked `shell/store/trailer/*.png`.

**Read cold, in this order:**
1. memory `favor-testrealm-dev-workflow` — code map, rig recipes, the 14 `?v=` stamps, the `[0-9][0-9]*` sed law
2. memory `favor-fixes-jul18` — what shipped this afternoon; this file continues it
3. memory `feedback_favor-rules-fidelity` — never simplify rules to make code easier
4. memory `favor-mission-timing-rules` — ⚠ in MP engine code, `pi === 0` means "the local seat," never "the human"

**Before touching anything, establish a green baseline.** Run all three suites and record the numbers — if something is already red, you need to know that before you start attributing failures to your own work.

```
cd ~/playfavor
node tools/engine-smoke.mjs   > /tmp/smoke.txt   2>&1; echo "EXIT:$?" >> /tmp/smoke.txt
node tools/audit-check.mjs    > /tmp/audit.txt   2>&1; echo "EXIT:$?" >> /tmp/audit.txt
python3 -m http.server 8891 &
node tools/ui-audit.mjs       > /tmp/uiaudit.txt 2>&1; echo "EXIT:$?" >> /tmp/uiaudit.txt
```
Expected at `7aecb17`: engine-smoke **404** · audit-check **ALL CLEAN** · ui-audit **755**.
⚠ Exit codes lie through pipes — always redirect to a file and append `EXIT:$?`, never `| tail`.

---

## The six batches

| # | Batch | Why here | MPV |
|---|---|---|---|
| **0** | Quick strikes — boot/WANTED, melee tap, leaderboard tabs | Wyatt **closed the app** over 0.1; all three are <40 lines | no |
| **1** | Endgame legibility | His longest, most-repeated complaint | no |
| **2** | The rating ladder | Spec is **decided** — build it as written | no |
| **3** | Profile depth | Every field already sits in `_me` | no |
| **4** | Archeus forced discard | Real rules bug | **13→14** |
| **5** | Campaign mode | Greenfield — design spike, then Wyatt signs off | later |

**⚠ MPV discipline.** Only Batch 4 bumps `MPV` (`js/mp.js:86`, currently `13`). A bump forces every client to update, so **if any other rules change lands this session, ride it in the same commit as Batch 4** rather than bumping twice.

Ship each batch as its own commit through the loop at the bottom of this file.

---

# BATCH 0 — Quick strikes

## 0.1 ★ The WANTED plaque is a glowing empty box

> "I opened up the game and then I went to play. It took a few seconds to load. The wanted character wasn't really showing up and I wasn't really gonna wait for it to show up and I closed the app."

**Highest-severity item in the batch — it caused a bounce.**

**The finding: the plaque never waited on the network.** `rivalOfDay()` (`js/modes.js:113-126`) is a pure `hashKey(dateKey) % 10` into a static table; `rivalStars()` (`js/modes.js:106-111`) and `FLB.currentDateKey()` (`js/meta.js:130-139`) are equally pure. **Nothing about the rival's name, art, or bounty needs a round trip.** The only late value is the CLAIMED flag (`FLB.rivalDayClaimed()`, `js/meta.js:614-616`).

It's empty purely because of **script position**. `renderRivalPlaque()` first runs at `js/modes.js:448` — inside the last of 14 parser-blocking scripts. Nothing writes into `#rivalPlaque` (an empty div at `index.html:78-79`) until ~762 KB of local JS plus ~450 KB of Firebase SDK has downloaded, parsed and executed.

And what the player stares at meanwhile is the worst possible thing: `css/style.css:6826-6839` gives `.drp` `min-height:158px`, a gold border and a glow. **It is the most eye-catching element on the title screen, and it is empty.** That reads as broken, not as loading.

**The fix.** Add a ~20-line inline `<script>` immediately after `index.html:79` that duplicates the three pure functions the plaque needs — the `RIVALS` table (`js/modes.js:84-95`), `hashKey` (`js/modes.js:97-101`), and the date-key pick — writes head/name/bounty/frame into `#rivalPlaque`, and injects `<link rel="preload" as="image">` for the portrait. Filenames are mechanically `capitalize(hero) + '.jpg'`, so it needs neither `FAVOR_DATA` nor `FLB` and sidesteps the hard bail at `js/modes.js:145`. `renderRivalPlaque()` then repaints over it with countdown + CLAIMED state.

**Deterministic content first, network state second.**

**Three one-liners to pair with it:**
- `index.html:466` — `preload="auto"` → `preload="none"` on `#themeMusic`. Reclaims **482 KB** fetched before the user presses anything.
- `index.html:475-486` — add `defer` to the 12 local script tags. They already run in order and none depend on parse-time DOM position, so `defer` preserves ordering while unblocking the parser. (`grep -cE '<script[^>]+(defer|async)'` currently returns **0**.)
- Add a real loading affordance. There is **no splash, skeleton or spinner anywhere** — the only three "loading" strings in the app live in the leaderboard panel (`js/meta.js:815`) and character select (`js/ui.js:1292`).

**Load budget** (all 14 stamps identical; `bump-cache.sh` cold-invalidates every one on *every* deploy):

| | bytes |
|---|---|
| `js/ui.js` | 341,427 |
| `engine/gameState.js` | 133,683 |
| `js/meta.js` | 69,052 |
| `js/mp.js` | 55,970 |
| **local JS total** | **762,787** |
| `css/style.css` + `css/melee.css` | 281,143 |
| `assets/ui/menu-meadow.jpg` | 807,381 |
| `favor_theme.mp3` (`preload="auto"`) | 482,786 |

**⚠ Latent bug, fix while you're in here.** `js/modes.js:449-450` re-renders at 1600 ms and 4500 ms guessing when `_me` lands. But `_me` is only assigned at `js/meta.js:666`, after `await connect()` — which races a **6-second timeout** at `js/meta.js:321-324`. On a slow connection both retries fire before `_me` exists, so **the CLAIMED stamp never appears** until a clock rollover or a finished game. Replace the guessed timers with a callback from `renderProfileChip()`.

**Deferred, not this session:** an `assets/characters/thumb/` set at ~120 px (~6-10 KB each). Portraits are ~120 KB rendering into a 38-58 px box (`css/style.css:6865`, `:6919`) — a ~15× reduction, but it's an asset-pipeline task.

**Done when:** the plaque shows the right rival, bounty and art with JS disabled after first paint; `defer` is on all 12 tags and the suites still pass; the CLAIMED stamp appears on a throttled-3G profile.

## 0.2 Melee: tap anywhere to proceed

> "Tapping anywhere in the melee phase should proceed, not just the button"

**⚠ Skylar's file.** Edit `~/playfavor/testrealm/js/melee.js`, then `cp` to `~/playfavor/js/melee.js` **in the same commit**. Never hand-edit root. (Both copies verified identical at `7aecb17`, 42,334 B.) The convention is documented in-repo at `css/style.css:496-499`, not just in memory.

**The finding:** tap-anywhere *already works* — but only in the `revealed` state (`melee.js:805-807`). The gap is the `playing` (forge) state, where `.ms-continue` (`melee.js:629`) is the only thing that advances. That was deliberate — see the comments at `melee.js:622-623` and `:802-804`.

**The change** — extend the existing handler, don't add a second one:

```js
host.onclick = (e) => {
  if (e.target.closest('.ms-cardrow')) return;
  if (state === 'playing') { if (advanceTap) advanceTap(); return; }
  if (state === 'revealed' && Date.now() - revealedAt >= revealHoldMs) close();
};
```

- **`.ms-cardrow` must be excluded** (`css/melee.css:695-699`) — it's `overflow-x:auto` and swipe-scrolled on phones; a swipe that ends without enough movement still emits a `click`. That strip is the entire reason taps were button-only.
- `.ms-continue` and `.ms-skip` need no exclusion — both already `e.stopPropagation()` (`melee.js:629`, `:808`).
- **Do NOT add a debounce.** `waitContinue` (`melee.js:257-261`) nulls `advanceTap` inside `done()` before resolving, so a double-tap no-ops for free. The 380 ms debounce you may be remembering is at `js/ui.js:7043-7046` on `#missionCeremony` — **a different overlay**. ⚠ Never scale that one by `MISSION_PACE`; a `450*speed()` attempt broke the Midnight-Crash flow's 450 ms tap cadence.
- **Do NOT let the `playing` branch fall back to `finalize()`** — one stray tap during the clash would blow past the whole coronation.
- Coronation stays protected for free: `state` is `playing` from `melee.js:829` through `markRevealed()` at `:846`, but `advanceTap` is `null` across that entire span.
- `revealHoldMs` (2000×speed, `melee.js:92`) and `autoCloseMs` (5200×speed, passed from `js/ui.js:7138`) are untouched.

**Existing ui-audit flows need no changes** — verified. `tools/ui-audit.mjs:3720-3725`, `:4154-4221`, `:4223-4244` advance via programmatic `.ms-skip` `el.click()`, which fires on `display:none` elements and stops propagation.

**Done when:** a tap on empty forge background advances; a horizontal swipe on `.ms-cardrow` does not; a new ui-audit flow asserts both.

## 0.3 Leaderboard: Rating tab + Top Scores tab

> "Leaderboard needs rating instead of all time and it needs a top scores tab next to daily with the top 20 highest scores from players."

**Both cheap. Neither needs a new write path or a backfill.**

**Rating — a label change.** The All-Time tab is *already* a pure rating board: `js/meta.js:846` sorts by `eloOf(p)`, and the header comment at `js/meta.js:713-714` says "All-Time (rating)". Swap the text at `index.html:110`. Renaming the *key* `alltime`→`rating` additionally touches `js/meta.js:789`, `:792`, `:804` (default arg), `:721`, `:853` — **keep the key, change only the label.**

**Top Scores — the archive already exists.** `favor/daily/*` is **never pruned in production** (verified: the only `daily/...remove()` calls in the repo are test cleanup in `tools/ui-audit.mjs`; `settleDue` at `js/meta.js:517-546` reads the whole node every boot and only writes `settled/{key}`). Every past window's `daily/{key}/scores/{uid} = { name, best, at }` is still there, and **each row is by construction a single-game score.** Flatten all days × all uids, collapse to one row per uid, sort by `best` desc (tie-break `at` asc, matching `podiumSort` at `js/meta.js:511-515`), slice 20. Full history from day one.

- New `.lb-tab data-tab="topscores"` at `index.html:111`. `.lb-tabs` (`css/style.css:411`) is a centered flex row — a third button needs no layout work.
- Fourth branch in `openLeaderboard` (`js/meta.js:826-848`); add `topscores` to `LB_EMPTY` (`js/meta.js:720-723`); extend the per-tab score format at `js/meta.js:764-766`. `.lb-best` (`css/style.css:582-589`) is reusable as-is for the number.
- **⚠ `js/meta.js:789`** — `const overallOn = tab === 'alltime' || tab === 'daily';` lights the "All Heroes" rail chip. **Any new tab key mis-lights the rail unless you add it here.** This is the one line that silently breaks.
- ⚠ `cleanBoardRows` (`js/meta.js:733-756`) collapses by *name* — for a multi-day list that drops a player's lower-scoring days, which is what you want, but it's implicit.
- ⚠ Personas don't post daily scores **yet** (`js/meta.js:471`), so this board is humans-only until Batch 2 lands — at which point it becomes mixed with **no change to this code** (both boards read `daily/*` and will simply start containing persona rows). Don't write "humans only" into the empty copy.
- ⚠ Resolve an inconsistency: the daily txn writes `mine.finalScore` **raw** (`js/meta.js:463`) while the chars ledger writes `Math.round(...)` (`js/meta.js:452`). Pick one.

**Done when:** three text tabs render, the rail chip lights correctly on all three, Top Scores shows 20 rows drawn from multiple past days, and an empty board reads sensibly.

---

# BATCH 1 — ★ The endgame is illegible

> "The whole end of the game happens really quick, so you can't even really know what happens… especially the ending of the game where more missions are in play, we're not seeing a comprehensible flow. It really needs to be understandable for all players, each mission that gets played. What's happening? Who got gold? Who is affected by this?"

**The headline complaint.** Four structural gaps produce it. Fix bottom-up — the engine ones unblock the UI ones.

## 1.1 The engine destroys the information the UI needs

**`discardPlayedCards` throws away card identities.** `engine/gameState.js:2280-2293` collects removed cards into `removed` (`:2284`), flattens their names into a log string (`:2290`), then **`return removed.length;` (`:2292`)**. Callers consume it arithmetically — `discard_power_gain_10_prestige` (`:2323-2328`) does `const n = ...; player.prestige += 10 * n;`.

> "There was a moment where this one guy failed the mission Act 2, and he had to discard, I think it was, weapon cards. Anyway, we never got to see which cards he discarded, which is important because otherwise we just see the prestige he gets for it."

That was **Secret Grotto** (`data/missions.js:193`, `failSpecial: "discard_power_gain_10_prestige"`). It filters `c.type === 'weapon'` (`gameState.js:2325`) — printed "Power", typed `weapon`, which is why he described weapons.

**Same silent-bulk-discard class, all bypassing the human picker:** `discard_weapons_gain_5_prestige` (Protecting Family, `missions.js:49`), `discard_wisdom_gain_8_gold` (Cameron's Expedition, `missions.js:57`), `discard_1_artifact` (Passing the Mirror Gate, `missions.js:231`). Only `discard_1_played` / `discard_5_played` (`gameState.js:2310-2311`) route through `penaltyDiscard` → picker.

→ **Return the removed card objects** (or push them onto a per-resolution ledger) and thread them up through `resolveMissionFailSpecial` (`:2295-2381`) → `applyMissionFailure` (`:2383-2406`) → `resolveMissions` (`:1933-2066`). All three currently return `undefined`.

**`measure()` is scalar-only.** `engine/gameState.js:1944-1959` snapshots exactly six scalars (`favor, gold, prestige, scorn, stones, mindsEye`) and diffs them. It cannot represent cards or cross-player transfers — so `others_gain_5_gold` / `others_gain_3_prestige` (`:2299-2301`) mutate *other* players entirely outside the measured seat. **"Who got gold?" is structurally unanswerable today.** Extend measurement to cover affected seats.

**`details.missing` is computed and then dropped on the floor.** `probeMissionRequirements` returns `{ missing, canBorrow }` (`:2146-2149`); `resolveMissions` forwards it as `details` on every result (`:2003, :2014, :2042, :2048`) — and **no renderer ever reads it.** `rewardChips` (`js/ui.js:6936-6982`) touches `mission`, `deltas`, `borrowed`, `success`, never `details`.

> "You don't know if they had the prerequisites to get the big reward."

→ **Cheapest fix in the batch.** The data is already on the object.

## 1.2 The Labyrinth renders a literally empty beat

> "If someone fails Labyrinth, you don't really see it happen… I noticed that has not been updated, even though we had a patch for it."

**Traced, and he's right.** `data/missions.js:258-262` — The Labyrinth carries `failurePenalties: {}` and `failSpecial: "fortune_teller_50_prestige"`, which pays +50 Prestige **only if** the player holds Fortune Teller (`gameState.js:2347-2353`).

Fail it without Fortune Teller and: `applyMissionFailure` writes nothing, the `:2348` guard fails, **all six measured deltas are 0.** In `rewardChips`, `favorGain = 0`, `lead = null` (`ui.js:6955-6958`), and all thirteen chip conditionals (`:6961-6980`) evaluate false. **`rewardChips` returns the empty string.** The beat renders a card and a "Failed" stamp over an empty `.mc-rewards` div, and since `heavy` is null (`:7016`) it holds the *short* 1700 ms window and moves on.

That is exactly "you don't really see it happen." It also explains "has not been updated even though we had a patch" — the 7/18 patch added a prestige lead for scorn-less fails (`ui.js:6957-6958`), which **only fires when the Fortune Teller was actually held.** The miss case still renders nothing.

→ **(a)** Give zero-delta fails a fallback that states the mission's printed consequence even when nothing measurable moved.
→ **(b)** Conditional rewards need a **not-met branch** — assert the counterfactual ("no Fortune Teller — the 50 Prestige is lost"), which means recording the gate *result*, not just its payout.

## 1.3 Beats don't cover every seat or every path

The main ceremony **is** all-seats — `js/ui.js:6912` pushes every player's results with no filter, and `renderBeat` (`:6984-7003`) names the seat at `:6994`. The edges leak badly:

| Path | Beat today | Anchor |
|---|---|---|
| Any seat's due-date resolve via `resolveMissions` | ✅ | `ui.js:5421` |
| Local human declines borrow ("Let it Fail") | ✅ shipped 7/18 | `ui.js:5712-5729` |
| Local human deliberate turn-in-and-fail | ❌ toast only | `ui.js:4249-4257` |
| Local human early turn-in success | ❌ toast only | `ui.js:4251-4253` |
| Local human early borrow+complete | ❌ toast only | `ui.js:4229-4237` |
| **Remote/AI seat declines borrow in MP** | ❌ **bare log line** | `ui.js:2295, 2303-2304` |
| Remote/AI penalty discard in MP | ❌ count only | `ui.js:2333` |
| Mission dealt by Midnight Crash | ❌ local seat only | `ui.js:7070` |

→ **`failWithBeat` is seat-0 hardcoded** (`ui.js:5712-5729` — `game.players[0]`, `failMissionByChoice(0, idx)`, `playerIndex: 0` at `:5727`). Give it a `playerIndex` parameter so `ui.js:2295` and `:2303` can play the same beat for remote seats.
→ The three manual paths can't build a beat because `turnInMission` (`:1809-1825`), `completeMissionWithBorrow` (`:1896-1916`) and `failMissionByChoice` (`:1922-1931`) return **no deltas**. `failWithBeat` re-derives them by hand today — that's the workaround to generalize.

**⚠ Pacing tension to hold in mind.** Wyatt says the endgame "happens really quick," but more beats × more missions = a longer tail. Tune with `MISSION_PACE` (`ui.js:6906`, currently `1.4`) and **collapse no-op resolutions into a single summary beat** rather than giving every mission equal screen time. Legibility isn't more seconds; it's the *right* seconds.

## 1.4 Victory sheet: the Artifacts row is wrong twice

> "I noticed that I had the family ring, but it didn't come up as artifacts at the end. For some reason, Philosopher's Stone keeps sticking itself in there, even though that's not really... I don't know what it's doing there."

**Both confirmed. Two unrelated root causes.**

### Family Ring — a rules bug, not a display bug

`data/cards.js:295-297`:
```js
{ name: "Family Ring", audit: "Favor equal to your total Knowledge x2, Req: 3 Knowledge & 1 Philosopher's Stone, Act 3",
  type: "artifact", skills: [], requirements: [...], rewards: {}, special: "knowledge_x2" }
```
No `favor` key → `gameState.js:2744-2745` contributes 0, and `dynamicCardFavor` (`:2708-2728`) has no `knowledge_x2` case → `default: return 0` (`:2726-2727`). It *is* correctly classified as an artifact (`:2747`); it just adds nothing. Then the truthiness guard at **`js/ui.js:6411`** (`if (v) { items.push(...) }`) makes it **vanish entirely** rather than render `+0`. Exactly what Wyatt saw.

**The deeper problem:** `knowledge_x2` is implemented as a *skill* grant (`gameState.js:1320-1324`: `player.skills.knowledge += 1`, mirrored at `:933-934`, blurbed "Doubles your Knowledge!" at `ui.js:47`) — but the printed card says **"Favor equal to your total Knowledge x2."** The engine is playing a different card than the box. Per `feedback_favor-rules-fidelity`, **match the printed card:** add a `favor_per_knowledge_x2` case to `dynamicCardFavor` and drop the phantom skill grant.

Naming confirms it — every other "favor equal to X" artifact uses `favor_per_*` with a 1:1 case: Lucky Pendant `favor_per_quest_x5` (`cards.js:299` → `gameState.js:2711`), Great Vault Key `favor_per_sur_cha_pro` (`cards.js:302` → `:2713`). **Family Ring is the only one whose special isn't `favor_per_*`.** Precedent for the missing case exists at `gameState.js:1782` (`favor_per_knowledge_x1`).

Two secondary bugs fall out: the comment "card already gave some" is false (`skills: []`), so it never reaches the claimed "+2 Knowledge total" either — and it grants a knowledge the card never printed, **inflating requirement checks.**

→ Also **drop the `if (v)` guard** for cards the player actually holds. A held artifact worth 0 should render `+0`, not disappear. "Where did my card go" is a worse bug than a zero.

### Philosopher's Stone — not a phantom; this afternoon's patch made it omnipresent

`js/ui.js:6413-6417` injects a **synthetic gold-conversion row**:
```js
if (gp.philosopherStone > 0 && gp.gold > 0) {
    const sv = gp.gold * gp.philosopherStone;
    items.push({ label: `Philosopher's Stone — ${gp.gold} Gold × ${gp.philosopherStone}`, val: sv });
}
```
The predicate **never inspects `playedCards`.** It keys off the fungible counter, fed by character-board slots (`data/characters.js:48, 82, 95, 112, 147`), two *adventure* cards (The Tree Tunnels `cards.js:138`, Reunited `:221`), other artifacts, Sacred Chest ×10, Secret Lab ×5, and mission rewards (`gameState.js:2177-2179`, `:2206-2207`). So it appears for players who never held the card.

**`87871be` (stones STACK, `Math.max` → `+=`) is what made it constant.** Before, the tally saturated low and was often 0; now every incidental grant accumulates, so `philosopherStone > 0` holds for most players at end of game — and `gold × stones` is multiplied by a much bigger factor.

→ **Fix is labeling, not math.** It's a gold conversion, not an artifact. Give it its own sheet row, or relabel it so it reads as "your Gold, multiplied." Note `artAll` (`ui.js:6296`) folds `stoneFavor` into the Artifacts cell — that's the conflation.

→ **⚠ Open question from `favor-fixes-jul18`:** stone semantics. Sacred Chest (×10) + Secret Lab (×5) + singles now all sum into one gold×N multiplier. **Flag to Wyatt if 15:1+ conversions look degenerate** — this batch is where you'll see it.

→ **⚠ Latent bug, fix now.** `grantSlotStones` (`gameState.js:1036-1042`) gates on `player._slotStoneGranted = new Set()` (`:1037`). **A `Set` does not survive a JSON round-trip.** Nothing serializes it today, but the moment save/resume or MP sync JSON-encodes players, the gate silently resets and slot stones re-grant on every landing — genuine runaway inflation. Make it a plain object or array.

**Batch 1 done when:** a 5-mission Act 3 plays back legibly for every seat — each beat names who, which mission, met-or-not (from `details.missing`), and what actually changed hands including discarded card art; the Labyrinth's no-Fortune-Teller failure states its lost reward; Family Ring scores its printed value; the stone row no longer reads as an artifact.

---

# BATCH 2 — ★ The rating ladder (spec decided — build as written)

> "Last place should push you up until 2.0, just slightly. Once you are at 2.0, it should drop you if you come in last, but otherwise no. If you're not at 2.0, we want to move people up a little quicker than this, maybe a little 2x the speed. We can always turn it down."
>
> "We're still really early. We want people to feel good when they play, and we do want the slopes to get steeper. We want people to hit 2, kind of quick, 3, slow, or 4, because it goes to 7."

**Replace `eloTableDelta` with a banded placement ladder.** Elo's zero-sum property is deliberately abandoned — rating becomes a progression track with diminishing returns per tier. Two rules define the entire feel:

1. **Below 2.00 nobody ever falls.** Every placement gains, on a slope; last place gains a token.
2. **At or above 2.00, only last place can fall.** No other placement is ever negative, at any rating.

## Why the current numbers feel like nothing

`eloTableDelta` (`js/meta.js:210-219`) splits K across pairs — **`js/meta.js:212`: `const kk = k / opps.length;`**

For a 1000-rated player finishing 3rd of 5 against flat-1200 bots:
```
E(1000,1200) = 1/(1+10^(200/400)) = 0.240253    ← inside the [0.05,0.95] clamp; never fires
Σ(S − E)     = (0−.2403)×2 + (1−.2403)×2 = 1.038988
settled: kk = 32/4 = 8 → d = +8 elo → renders "+0.01"
```
Full curve (5th→1st), settled: `−8, 0, +8, +16, +24` → **`−0.01, +0.00, +0.01, +0.02, +0.02`**. Total dynamic range ≈ 3 hundredths; **4th place literally renders "+0.00"**; 1st and 2nd are indistinguishable after `toFixed(2)`; the theoretical max for any 5-seat game is **+0.03**. Wyatt's reported "0.1" was him reading **+0.01** aloud.

**It's the pairwise split.** Neither the swing cap (±48/±96, `:217-218`) nor the expected clamp (`:201-204`) is anywhere near binding.

## Where the live population actually sits

Read from `favor/players` on 7/18 eve:

| | |
|---|---|
| 9 humans, all of them | **1.04 – 1.24** (median 1.10) |
| Humans at or above 2.00 | **zero** |
| Personas | 2.00 · 1.74 · 1.56 · 1.38 · 1.24 |
| Most games played by anyone | **5** |

**Every real player is in the fast band, and 2.00 is aspirational for the entire population.** Calibrate band 1 carefully; bands 3+ are theoretical for now.

⚠ **Side effect worth raising with Wyatt:** the top persona (HotshotGG) sits at exactly 2.00. At this pace real players pass every persona within a couple of weeks and the board runs out of anyone to chase. Reseeding personas upward is cheap now and awkward later.

## The algorithm

```js
const LADDER = {
    BASE: 100,                    // elo for a 1st-place finish vs an even field
    PS_SLOPE: 1.4,                // placement spread (see ps below)
    ADJ_SPAN: 2000, ADJ_MIN: 0.5, ADJ_MAX: 1.5,
    SOFT: 2000,                   // the 2.00 line — below it nobody falls
    BANDS: [[2000, 2.0], [3000, 1.0], [4000, 0.55],
            [5000, 0.30], [6000, 0.18], [7000, 0.10]],
    MIN_LAST: 10, MIN_STEP: 10,   // sub-2.00 guaranteed slope: 10/20/30/40/50 at n=5
    MIN_NONLAST: 8,               // at/above 2.00, non-last never renders +0.00
    MAX_SWING: 300,               // a safety RAIL, not a routine constraint — see note
};

// 1. Placement score — +1.00 for 1st, sloping across the seats actually played
ps = 1 - LADDER.PS_SLOPE * (place / (n - 1));
// n=5: +1.00 +0.65 +0.30 −0.05 −0.40   n=4: +1.00 +0.53 +0.07 −0.40   n=3: +1.00 +0.30 −0.40

// 2. Opponent strength — a skill signal without Elo's zero-sum
adj = clamp(1 + (avgOppElo - myElo) / ADJ_SPAN, ADJ_MIN, ADJ_MAX);

// 3. Band multiplier — the difficulty curve. GAINS SCALE, FALLS DO NOT.
raw   = BASE * ps * adj;
delta = raw > 0 ? raw * bandMult(myElo) : raw;
delta = clamp(delta, -MAX_SWING, MAX_SWING);

// 4. Floors — rule 1 and rule 2
if (myElo < SOFT)          delta = max(delta, MIN_LAST + (n - 1 - place) * MIN_STEP);
else if (place !== n - 1)  delta = max(delta, MIN_NONLAST);

delta = Math.round(delta);
```

`myElo` is the **pre-game** rating read from server truth inside the txn (`js/meta.js:424`), never the local cache — see the seam warning below, which is now load-bearing because crossing 2.00 changes the *rule*, not just the magnitude.

⚠ **`MAX_SWING` is deliberately 300, not 200.** At 200 the cap binds on essentially every first-place finish in the fast band, flattening `adj` exactly where beating a strong table should pay most. At 300 it only binds at the theoretical maximum (`ps` 1.0 × `adj` 1.5 × band 2.0).

## What the curves look like

**Today's live case — a 1.10 human, 5-player skirmish vs 1200 bots** (`adj` 1.05, band 2.0×):

| Place | Now shipped | **New** |
|---|---|---|
| 1st | +0.02 | **+0.21** |
| 2nd | +0.02 | **+0.14** |
| 3rd | +0.01 | **+0.06** |
| 4th | +0.00 | **+0.02** |
| 5th | −0.01 | **+0.01** |

Wyatt's 3rd-place game goes **+0.01 → +0.06**. Every place is distinguishable, last place gains its token, nobody can fall.

- **At 2.00 vs bots** (`adj` 0.60, band 1.0×): `+0.06, +0.04, +0.02, +0.01, −0.02` — the fall switches on.
- **At 3.00 vs personas** (`adj` floored 0.5, band 0.55×): `+0.03, +0.02, +0.01, +0.01, −0.02`.
- **At 3.00 vs 3.00-rated humans** (`adj` 1.0, band 0.55×): `+0.06, +0.04, +0.02, +0.01, −0.02`.

## Pace — games to clear each tier at a steady 2nd-of-5

| Tier | Band | vs an even field |
|---|---|---|
| 1.00 → 2.00 | 2.0× | **~7** (~16 at a steady 3rd) |
| 2.00 → 3.00 | 1.0× | ~26 |
| 3.00 → 4.00 | 0.55× | ~28 vs peers / ~56 vs personas |
| 4.00 → 5.00 | 0.30× | ~51 |
| 5.00 → 6.00 | 0.18× | ~86 |
| 6.00 → 7.00 | 0.10× | ~154 |

"Hit 2 quick, 3 slow, or 4, because it goes to 7." ✓ Full climb ≈ 350 games against appropriate opposition.

## What counts as a win

> "Coming in 2nd in a 5 player game should be considered a win"

**One shared predicate, used by both the human record and the persona drop rule:**

```js
isWin(place, n) = place < Math.ceil(n * 0.4);   // n=5 → 1st/2nd · n=4 → 1st/2nd · n=3 → 1st/2nd
```

⚠ Today `postGameResult` computes `const won = place === 0;` (`js/meta.js:407`) and that one variable has **three consumers** — don't treat this as a one-liner:
- `wins:` at `:436` — the count Wyatt is asking to change
- `streak` / `bestStreak` at `:423`, `:438` — becomes a run of *top-40%* finishes, which is the right reading of a hot streak
- the streak boost multiplier, which will now engage more often

Use the same predicate for the persona row at `:497` (`pp.place === 0`) so both populations agree on what a win is, even though W/G counters are hidden on board rows and only the profile Record line shows them.

## Three emergent properties — keep them, and surface the first one in the UI

- **You plateau against bots around 3.5–4.0.** `adj` floors at 0.5 vs a weak field, so gain(1st) = `50 × bandMult` while loss(5th) is a flat −20; they cross at `bandMult ≈ 0.4`. Climbing past that *requires* real opponents. Good ladder property — but **say so in the UI** rather than letting players discover it as a wall.
- **The 2.00 line self-heals.** Fall from exactly 2000 and you land ~1976, which is sub-`SOFT`, where nothing can fall you further. It behaves as a soft floor at 2.00. Intended.
- **Tier 0 becomes unreachable.** `INIT` is 1000 and sub-2000 never falls, so nobody who has played can end below 1.00 — which retires the unstyled-`ratingTier(0)` worry.

## Tunables, in the order you'll reach for them

`BASE` (overall speed) → `BANDS` (tier difficulty) → `PS_SLOPE` (how much placement matters vs just showing up) → `MIN_LAST`/`MIN_STEP` (the sub-2.00 consolation slope).

⚠ **The one to watch in playtest:** at band 0.10 a win pays +0.01 while a last place costs −0.04 — a 4:1 ratio that makes 6.00→7.00 genuinely defensive. That's the steep reading of "slopes get steeper." If it feels punishing, scale falls by a partial band multiplier — but **ship the steep version first**, per "we can always turn it down."

## Keep / drop from the old Elo path

- **Drop** `eloTableDelta`, `eloExpected`, and `kFor`'s provisional-K branch. The 2.0× band supersedes provisional-K and is more honest — tied to rating, not game count.
- **Keep** `eloOf` + `ratingV: 2` (stored values and legacy reads are untouched — **no migration, no backfill**), `clampElo`, `fmtRating`, `ratingSpan`, tier colors.
- **Keep the streak boost** (`ELO.STREAK_MIN/CAP/BOOST`) as a small extra multiplier on gains — on-theme for "feel good."

## Personas ride the ladder too — with different rules, deliberately

> "Well, the personas need to move up and down, so have them move up and down strategically after games as well. They'll also need to have their own high scores posted, just like regular players."

Personas already take a rating write today (`js/meta.js:476-503`), one whole-row txn each, host-only (`js/ui.js:6212` — three clients must not triple-pay a delta). Three things change.

### (a) Movement — personas get NONE of the player-facing benefits

> "The personas don't get the benefits that human players do. Personas will go down in rating when they lose, no matter where they are, no matter what tier they are."

**Every protection in the human rule set exists because humans have feelings. Personas are the measuring stick — they get none of them.** Give a sub-2.00 persona the no-fall floor and the 2.0× band and they can only ever go up; **every persona inflates into a pile at 2.00**, which is precisely the opposite of a ladder with a shape.

| | Human | Persona |
|---|---|---|
| Sub-2.00 no-fall floor | ✅ | ❌ |
| At/above 2.00, only last place falls | ✅ | ❌ |
| Band multiplier (2.0× fast band) | ✅ | ❌ |
| `MIN_NONLAST` +0.01 dead-zone guard | ✅ | ❌ |
| Streak boost | ✅ | ❌ |
| Stars | ✅ | ❌ |
| Daily crowns / `champs` / `msgQueue` | ✅ | ❌ |
| **Ranks on Daily + Top Scores** | ✅ | **✅** |
| **Rating moves on results** | ✅ | **✅** |

```js
psP   = 1 - 2 * (place / (n - 1));             // symmetric: +1.00 +0.50 0.00 −0.50 −1.00
raw   = BASE * psP * adj;                      // same core, same table
delta = raw + (seedRating - current) * PULL;   // PULL = 0.05 — soft anchor

// A non-winning finish ALWAYS costs a persona rating.
// No tier, no rating level, no floor, no seed distance exempts them.
if (!isWin(place, n)) delta = Math.min(delta, -MIN_DROP);   // MIN_DROP = 8

delta = Math.round(delta);
```

- **`isWin(place, n) = place < Math.ceil(n * 0.4)`** — the *same* predicate as the human W/L record ("coming 2nd in a 5 player game should be considered a win"). n=5 → 1st/2nd; n=4 → 1st/2nd; n=3 → 1st/2nd. One definition of "a win," used in both places.
- **Personas use the symmetric `psP`, not the human `ps`.** The human curve (`PS_SLOPE 1.4`) is positively biased so mid-table still feels rewarding. Personas get the honest zero-centred version, and then the `MIN_DROP` clamp guarantees that anything short of a win is strictly a loss — 3rd of 5 lands at exactly 0.00 on the curve, so without the clamp a median finish would be a silent no-op.
- **No band multiplier.** Bands are a *player progression* device (fast onboarding, defensive endgame). Personas aren't progressing.
- **Mean reversion holds the ladder's shape** over thousands of games while still letting results move them visibly. A persona sitting 0.30 above its seed feels ~−0.015/game of drag, so a hot streak shows but never becomes permanent.
- **Reversion cushions but never rescues.** It's applied *before* the clamp, so a persona far below its seed drops by less on a loss but still drops. Worked example: seeded 2800, currently 1500, loses 5th of 5 at `adj` 0.85 → `raw` −85, reversion +65, `delta` −20 (clamp not binding). A persona that loses every single game self-limits around 1700 below its seed rather than sinking to 0 — `clampElo` guards the rail regardless.
- **Keep two existing details:** the pairwise field at `:480-484` substitutes the human's *fresh* elo for the "You" seat, and `:487-488` starts a row with no rating from `seedRating`. Both stay correct under the ladder.
- **Drop `kFor(cur.games, 0)`** at `:489` along with the rest of provisional-K.

**Reseed the table in the same commit.** Current seeds — 2000 / 1740 / 1560 / 1380 / 1200 (`PERSONAS`, `js/meta.js:61-73`) — all sit inside the range humans clear in a few weeks. Spread them across the range the ladder actually spans, e.g. **1200 / 1700 / 2200 / 2800 / 3500**, so there are rungs above the population for months. ⚠ PATCH-only; `persona_*` rows never delete. `tools/migrate-ratings-70.mjs` is the model sweep and it's idempotent.

**Side benefit worth designing around:** a strong persona at the table raises the *human's* `adj`. Beating a 3.50 persona while rated 1.10 pays `ps 1.0 × adj 1.34 × band 2.0` ≈ **+0.27** — a big, earned jump. Hard tables become worth seeking out.

⚠ **Follow-up once the spread widens:** persona seating should roughly match player rating. A fresh 1.00 player seated against a 3.50 persona finishes last often — harmless under the no-fall floor, but it caps what they can earn. `tableSeed` (`js/meta.js:384`) is where that would live.

### (b) High scores

Add a daily post to the persona loop, mirroring the human one at `js/meta.js:461-464`:

```js
await dbTxn(`daily/${key}/scores/${pp.uid}`, cur => {
    if (cur && cur.best >= pp.finalScore) return cur;
    return { name: pp.name, best: pp.finalScore, at: Date.now(), persona: true };
});
```

**⚠ `finalScore` is not in the payload today.** `js/ui.js:6215` builds `{ uid, name, place, power }` — add `finalScore: s.finalScore || 0`.

The Daily and Top Scores boards need **no change**: both read `daily/*` and will simply start containing persona rows. Mark the row `persona: true` so settlement can filter and boards can style.

Keep **not** giving personas Stars — a purchase currency they can't spend. Whether they should also accrue per-hero `chars` ledgers, and so appear on the ten character boards (human-only by design today), is a **separate call for Wyatt**; this batch does Daily + Top Scores only.

### (c) ⚠⚠ The crown collision — Wyatt approved the filter; ship it in the same commit

> "Prevent them from getting the crowns. That's fine."

`js/meta.js:471` documents the current gate: *"No daily post, no Stars: the nightly crowns stay a human race."* **That comment is load-bearing.** `settleDue` (`:517-546`) takes `podiumSort(...).slice(0, 3)` and then, per podium seat (`:531-538`), pays Stars, increments `champs`, and **pushes a `msgQueue` entry**. Put personas on the daily board without touching this and:

- a persona **takes a crown and its Stars from a real human**
- a persona accrues `champs` crowns that render on the leaderboard (`.lb-crowns`, `css/style.css:570-576`)
- every podium finish pushes a `daily_champion` royal overlay onto a **permanent row that will never log in** — an orphan queue that grows forever

**Fix: filter personas out of the podium, not off the board.** Drop `persona: true` rows in `podiumSort` (`:511-515`) or at its `settleDue` caller, before the `slice(0, 3)`. Personas then rank publicly on Daily and Top Scores but stay ineligible for crowns and Stars — which is exactly what `:471` was protecting. "Just like regular players" applies to *scores*, not to *payouts*.

This also **defuses** the 22:00 ET hazard instead of escalating it: an audit run straddling the boundary can no longer crown a persona.

**⚠ New audit contamination path.** `tools/ui-audit.mjs:5125-5129` asserts real `persona_*` rows never feel an audit. Once personas post daily scores, audit runs write `daily/{key}/scores/persona_*` into the live tree. The never-delete rule protects the **permanent `players/persona_*` row** — a daily entry is disposable, so the scrub may sweep it. Make that sweep **timestamp-bounded to the run window** so a legitimate persona score from a real game is never destroyed.

## Implementation notes

- **No MPV bump.** Verified: `js/mp.js` never imports `tableDelta`, `postGameResult` or any Elo function. `tableDelta` is purely a post-game ledger write, not streamed lockstep state. The only rating on the wire is the **absolute** value from `FLB.snapshot().rating` (`mp.js:148, 454, 499, 776`), which every client reads from the same shared record. Mixed-version tables would earn at different rates — a fairness wrinkle, not a desync.
- **⚠⚠ `tools/ui-audit.mjs:2032-2051` will fail on the SIGN, not just the magnitude.** The rig builds a 3-player table of bots with the player at a fresh **1.00 — below the no-fall line** — then asserts at `:2048`:
  ```js
  ok(elo.winDelta > 0 && elo.lossDelta < 0 && elo.capOk, ...)
  ```
  Under the ladder that last-place `lossDelta` is **+10**, not negative. Rewrite the assertion to encode the *new* rules (sub-`SOFT` last place is positive; `capOk` retargeted at `LADDER.MAX_SWING`) and update the stale comment at `:2029-2031`. Expected new values for that exact rig: **win +200, loss +10.**
- **⚠⚠ The display/ledger seam is now load-bearing — close it first.** Display computes `myElo` from the local `_me` cache (`js/meta.js:228`); the ledger computes `eloOf(cur)` from the server row inside the txn (`:424`). Under Elo a stale `_me` meant a slightly wrong number. **Under the ladder it can mean a different RULE** — the sheet showing a floor-protected gain while the write applies a fall, because the two disagree about which side of `SOFT` you were on. Make `tableDelta` take `myElo` as a parameter so both callers pass the same value.
- **⚠ Ceiling truncation is now reachable.** `tableDelta` returns `delta` unclamped but `after: clampElo(myElo + delta)` (`:239`), and the write does the same (`:431`). Near 7000 the sheet prints `"+0.20 → 7.00"` while the ledger moved 4. Clamp the *delta* against the ceiling, not just the total.
- **Band lookup uses pre-game rating**, so one award never straddles two bands. A win from 1990 lands at ~2190 entirely at 2.0×. Don't over-engineer this.
- `charDelta` (`:246`) runs the same function against the hero's own elo, so **a fresh hero gets the 2.0× band** — a veteran picking up a new character climbs that ledger fast. Intended. It is computed and written (`:449-453`) but **never displayed** — free win for the victory screen.
- `fmtRatingDelta`'s **dead zone disappears by construction**: `MIN_LAST` 10 and `MIN_NONLAST` 8 both round to +0.01, so nothing renders "+0.00" against a real write.
- All constants live in one block — **`js/meta.js:165-170`** (becomes `LADDER`), with zero consumers outside `:165-251`. The knob panel stays in one place.

**Batch 2 done when:**
- engine-smoke covers every human rule — sub-`SOFT` never negative at any placement; at/above `SOFT` only `place === n-1` is negative; monotonic slope across placements at n=3/4/5; `adj` clamping at both rails; the band boundary at exactly 2000
- engine-smoke covers every persona rule — **every non-winning finish is strictly negative at every rating**, tested explicitly at sub-`SOFT`, at exactly 2000, and up at 6000+; no band multiplier applied; no floor applied; mean reversion pulls a displaced persona toward its seed but never turns a loss into a gain; a persona seeded far above the table still moves coherently
- one `isWin(place, n)` drives the human record, the human streak, and the persona drop rule — asserted consistent across n=3/4/5
- a ui-audit assertion confirms the victory sheet's displayed delta equals the ledger write
- a ui-audit assertion confirms a persona's score reaches the Daily board **and** that `settleDue` skips it for crowns and Stars
- the reseed sweep has run against live and `tools/ui-audit.mjs:5125-5129` still passes

---

# BATCH 3 — The profile has nothing in it

> "Viewing profile is bad you just see the different avatars you can choose and then you don't really see much else."

**Exactly right.** `openProfile` (`js/meta.js:679-710`) renders name + avatar (`:684-688`), **the 10-avatar picker grid** (`:689-694`, `css/style.css:610-616`, `repeat(5, 1fr)` — the visual mass), then five thin `.pf-row` lines: Rating (`:695`), Stars (`:696`), Lifetime Power (`:697`), Record (`:698-699`), Daily Championships (`:700-701`).

**Everything needed is already in memory** — `js/meta.js:680` reads `_me`, the whole player row. Unused today:

| Field | What it gives you |
|---|---|
| **`p.chars`** | Per-hero `{r, g, best}`. **Biggest win** — a grid of crest · rating · games · best score, reusing `ratingSpan` (`:192-196`) and `.lb-best` (`css/style.css:582-589`) |
| `p.achievements` | `{id: timestamp}` — unlocked count, recent unlocks |
| `p.charWins` | `{characterId: true}`, heroes you've won with (`js/achievements.js:14`) |
| `p.owned` | Purchased heroes (`js/meta.js:871`) |
| `p.rivalDay` | WANTED claim state via `FLB.rivalDayClaimed()` (`:614-616`) + `FMODES.rivalOfDay()` (`js/modes.js:113-126`) — a "today's bounty" row is free |
| `p.games` / `p.wins` | Already shown but cramped; win-rate is derivable |

**⚠ Never `await FACH.sync()` in a render.** It's async, it *writes* (`js/achievements.js:69-104`), and it `await celebrate(earned)` which **blocks on user clicks** (`:138-170`) — awaiting it inside a render hangs the panel on a modal. Both existing call sites deliberately don't await (`js/ui.js:6243`, `js/meta.js:1299`). Use `FACH.defs()` (sync, `:24`), `FACH.evaluate(row, snap)` (**pure sync**, `:35-60`), `FACH.tier(stars)` (sync, `:25`), or simplest — read `_me.achievements` directly, the pattern `openGallery` uses at `:178-182`.

**⚠ Persona safety.** The PATCH-only / never-delete rule is **documented, not enforced by code** — `js/meta.js:9-11`, `:72-73`, `:470-471`, `tools/rename-personas.mjs:6`. The persona txn at `:485-499` spreads `...cur` and returns a full row, so it's patch-shaped and safe. **Any new field added to `players/{uid}` must follow the same spread-and-return pattern** — a `set()` on a persona row erases its history. Enforcement lives only in `tools/ui-audit.mjs:5125-5129`.

**CSS note.** `.pf-inner` (`css/style.css:387-398`) uses plain `max-height: 88dvh`, and `#profileBody` has **no `overflow-y:auto` of its own** (the whole panel scrolls), unlike `.lb-body` (`:536`). A richer profile needs the `calc(100dvh - N)` treatment used by `.ri-inner` (`:6933`) and `.ach-inner` (`:6942`). Landscape block starts `css/style.css:4341`; `.lb-inner, .pf-inner` cap at `:4385`.

**Done when:** the profile leads with standing (rating + tier + record + win rate), then per-hero ledgers, then achievements, then today's bounty — with the avatar picker demoted to a control rather than the centrepiece. Verified at 375×667 and phone landscape.

---

# BATCH 4 — Archeus forced discard (rules bug · MPV 13→14)

> "Another thing was that Arceus got played by another player, and then I never had to discard a card. I should have had to discard a weapon card, but it never even told me, right? If I have a weapon card, I should have to pick one weapon card to immediately discard when he plays that card."

**⚠ The card is `Archeus`, not "Arceus"** (`data/cards.js:361-363`, Griffin Wings art). Printed: *"5 Scorn & All other Players must discard 1 weapon card they have & 6 Additional Power if you own Blind Faith."*

**Verdict: implemented, but it never prompts the human — it silently auto-picks for every victim, including seat 0 and remote humans.**

The deciding line is **`engine/gameState.js:1554`**:
```js
const weaponIndex = opponent.playedCards.findIndex(c => c.type === 'weapon');
```
`findIndex` takes the first weapon in play order, unconditionally. The loop at `:1551-1552` excludes only the caster.

**Every other human-choice special guards with `if (playerIndex === 0 || player._remoteHuman)` and sets a pause flag** — `_pendingSlotMission` (`:1144/1148`), `_pendingSlotPick` (`:1177/1181`), `_pendingChemYPick` (`:1417/1420`), `_pendingLifeEssencePick` (`:1522/1525`), `_pendingMissionBorrows` (`:2022/2023`), `_pendingPenaltyDiscard` (`:2264/2265`), `_pendingPromiseDiscard` (`:2333/2334`). **Archeus sets no flag**, so there is nothing for `endActPhases` (`ui.js:5291`) or `mpEndActStages` (`ui.js:2266`) to await.

**Second defect: no visible feedback.** The only notice is `this.addLog(...)` (`:1560`) — and `addLog` (`:2814`) pushes to the engine's `this.log` array, consumed **only** by the save/serialize snapshot at `ui.js:1476`. The player-visible feed is `addLogEntry` (`ui.js:407`). `grep "forced to discard"` across `js/` and `engine/` returns exactly one hit — the engine line. **No prompt, no toast, no feed entry.** Wyatt's first-played weapon was most likely taken silently.

**The fix.** `penaltyDiscard` (`:2261-2276`) already has the exact human-defer branch at `:2264` that would have prompted him, and the existing picker at `ui.js:2318` / `:4262` / `:5412` would have fired for free. Archeus hand-rolls a splice instead. Route it through a weapon-filtered `penaltyDiscard`.

**⚠ Why this isn't local.** Today `:1554` is fully deterministic — every client independently computes the same first weapon — which is the *only* reason tables don't fork. Giving the victim a choice makes the outcome client-specific. Streamed move types are `throw, unthrow, afk_boot, sync, left, emote, mission_borrow, penalty, promise` (`js/mp.js:894-923`); there is **no** weapon-discard move. So this needs a new streamed move type + staging in `mpEndActStages` (`ui.js:2266-2358`, which today stages exactly three flags: `:2275`, `:2314`, `:2341`) and **`MPV` 13 → 14** at `js/mp.js:86` (gate checks at `:231`, `:255`, `:716`).

**⚠ Fix the data divergence too.** `card-audit.html:209` carries a *different* Archeus — `favor: 5` where `cards.js` has `rewards: { scorn: 5 }` (**opposite sign**), `skills:["power"]` vs `[]`, and 1+1 requirements vs 4+4+minds_eye. And `tools/audit-check.mjs` / `tools/audit-lib.mjs` have **no Archeus entry at all**, so the card is unverified by the audit tooling. Add it.

**⚠ Zero test coverage.** `tools/engine-smoke.mjs:503-507` and `:2041-2045` exercise only the +6 Blind Faith pairing; grepping the suite for weapon-discard assertions returns nothing.

**Done when:** playing Archeus prompts every human victim to choose a weapon, names the card in the visible feed for all seats, plays a beat, streams the choice in MP under MPV 14, and carries smoke checks + a ui-audit flow + an audit-check entry.

---

# BATCH 5 — Campaign mode (design spike → Wyatt signs off → build)

> "Nation has the campaign that gets players playing something to kind of Strive for. favor doesnt have anything yet like that yet"

**Do the spike and get sign-off before building.** Nation's pattern, condensed to what ports:

**Structure** — not a node map, not a linear ladder: a **grid of themed boss opponents × 3 chapters.** Five rivals × 3 + 2 standalone finales = **17 stages.** Definitions at `~/wkspaces/Nation/Assets/_Settings/Definitions/Campaigns/`, schema at `Assets/Scripts/ScriptableObjects/CampaignDefinition.cs`.

```
Stage    = { rivalId, chapter, title, monologue, art, opponentDeck, opponentHP }
Progress = Set<(rivalId, chapter)>   // append-only, server-persisted
Owned    = Set<rivalId>              // purchase is per-column

playable(stage) = owned(rivalId) && (chapter == 1 || Progress.has(rivalId, chapter-1))
lineComplete(r) = every authored chapter of r in Progress
nextRecommended = first playable && !completed stage in (rivalId, chapter) order
```

**Lines are parallel, not sequential** — you don't beat Alexander to start Joan. Progression is per-column depth. Rewards fire off **derived predicates** (`lineComplete`), never stored counters, which is what makes retroactive backfill trivial.

**Opponents are personalities, not difficulty sliders** (`Assets/Scripts/Managers/AIManager.cs`, ~1000 lines — the biggest lesson): per-stage opening deck, per-rival card-priority sort (Crug→Attack, Joan→Happy, Bufferberg→Money), per-rival "wanted card" lists, per-rival decision-window choices. The difficulty knob is just `StartingHealth` (60 tutorial / 70 default / 100 final boss). Plus **scripted in-character speech driven by game events** (on card played, on resource threshold, on death) with a `_justOnces` set — cheap, and it's what makes fights feel authored. **Five personalities × three tiers produced 17 stages from ~5 distinct AI objective functions.**

**Reward ladder worth copying verbatim:** +2 Stars any win, +3 first win of day, **+10 "Campaign conquered" first time on a stage only**, leaderboard points once per stage per day (anti-farm), **avatar unlock on first win vs a rival**, **card unlock for completing a whole line.**

**The JOAN / National Park three-part pattern — steal wholesale:** (1) grant on derived `lineComplete`; (2) **announce on the menu you return to, not in the match**, with an explicit priority order when several banners are pending; (3) **retroactive backfill + idempotent latch** — check on every menu load, so a reward shipped in v2 correctly finds v1 players. That third part is how you ship new rewards into an existing player base.

**UI:** marquee grid, one column per rival, 3 portrait tiles stacked in chapter order, finales centered at the bottom. Completed = **dimmed to 55% grey** (dimming *is* the completion mark — no stamp). Next-recommended = subtle ±2.5% sine pulse. Menu button carries a notification badge. **Post-match returns you to the campaign map, not the main menu, "so the result feels earned"** — unless a banner is pending, then main menu for a clean stage. Locked stages **still open their preview** (read the taunt, see the art); only the PLAY button swaps to PURCHASE.

**⚠ FAVOR already has the adjacent system.** Nation's Daily Rival (`Assets/Scripts/DailyRival.cs`, 113 lines) is deterministic, bypasses both gates, pays +50 Stars on the first win, and **doesn't record progress unless you own the line.** FAVOR's WANTED is already this — so the campaign's job here is to give WANTED **somewhere to point.**

**Scoping question for Wyatt:** FAVOR has 10 rivals already named and arted — Marco Nadal, Ser Thomas, Vivienne Quickfingers, Wim Goldweight, Angler Pete, Elizabeth the Bold, John Quicksilver, Doctor Black, Fiddling Al Gable, Skylar Wondermaker. **A 10 × 3 grid is 30 stages of content.** Recommend **5 rivals × 3 chapters = 15**, mirroring Nation, with the free intro line being whoever Wyatt wants new players to meet first.

**Done when:** a written spec Wyatt has signed off on — stage count, which rivals, the progression rule, the reward ladder, and what the first playable slice is.

---

# Ship checklist — every batch

1. **Three suites green** from repo root: `tools/engine-smoke.mjs` · `tools/audit-check.mjs` (must end **ALL CLEAN**) · `tools/ui-audit.mjs` (needs `python3 -m http.server 8891 &`).
2. **Eyeball `tools/audit-shots/`.** Synthetic clicks bypass hit-testing, so occlusion bugs pass every assertion and only show in screenshots.
3. **Every new interaction gets smoke checks + a ui-audit flow IN THE SAME COMMIT.**
4. **Bump all 14 `?v=` stamps** — ⚠ `s/?v=[0-9][0-9]*/?v=$STAMP/g`, never `[0-9]*`. Verify after: `grep "split('?v=')" index.html` must still show no digits.
5. Commit + push, reload Wyatt's tab, poll live `?v=` via curl (~2-3 × 15s).
6. **iOS:** the shell is a live-site webview, so a web ship *is* the update. Only bump `CFBundleVersion` for a new TF build. ⚠ **TF attach alone ships nothing** — `betaAppReviewSubmissions` is required; `shell/store/tf_attach.py` does attach→submit→verify in one run.

## Traps — each of these has already cost a debug cycle

- ⚠ `js/melee.js` + `css/melee.css` are `cp`-synced from `testrealm/` — edit there, copy to root, same commit.
- ⚠ Root source stores non-ASCII as `\uXXXX` escapes **and** mixes them with literal em-dashes. Keep Edit `old_string`s to a single encoding span, and keep new comments ASCII.
- ⚠ zsh: `echo ===` fails (`=cmd` expansion) — use `---`.
- ⚠ Exit codes lie through pipes — redirect to a file and append `EXIT:$?`.
- ⚠ **Never run ui-audit near 22:00 ET** (~21:45–22:15). Flows post real daily scores, and `settleDue` can crown a deleted audit uid.
- ⚠ After any ui-audit crash, check `players.json?shallow=true` for `uaudit*` residue and scrub it — and remember a crashed suite leaves `audit-shots/` **stale** from the previous run.
- ⚠ In MP engine code, `pi === 0` means "the local seat," never "the human." Use `player._remoteHuman`.
- ⚠ ui-audit pins bot characters **and** `favorQueue` — `favorQueue` persists in the shared puppeteer profile, and a stray '5' reseats the Scientist as your left neighbour and breaks borrow flakes.

---

# Appendix — Wyatt's raw notes, 7/18 Discord

> **4:29 PM** — I opened up the game and then I went to play. It took a few seconds to load. The wanted character wasn't really showing up and I wasn't really gonna wait for it to show up and I closed the app.

> **4:55 PM** — Tapping anywhere in the melee phase should proceed, not just the button

> **5:07 PM** — Just played a game, and what was kind of weird is that, in the end screen, I noticed that I had the family ring, but it didn't come up as artifacts at the end. For some reason, Philosopher's Stone keeps sticking itself in there, even though that's not really... I don't know what it's doing there.
>
> The whole end of the game happens really quick, so you can't even really know what happens. If someone fails Labyrinth, you don't really see it happen. You don't know if they had the prerequisites to get the big reward. I noticed that has not been updated, even though we had a patch for it.
>
> There was a moment where this one guy failed the mission Act 2, and he had to discard, I think it was, weapon cards. Anyway, we never got to see which cards he discarded, which is important because otherwise we just see the prestige he gets for it.
>
> We really have to reward players more. I only got 0.1 rating. I came third place. Really, anything above fifth place should be like 0.1 rating, 0.01 rating. That's something that the dude in last place kind of gets credit for playing, but then that's about it. Everyone else should get more and more and more, and it needs to feel substantial so people actually play again and feel like they're making progress.
>
> In short, especially the ending of the game where more missions are in play, we're not seeing a comprehensible flow. It really needs to be understandable for all players, each mission that gets played. What's happening? Who got gold? Who is affected by this?
>
> Another thing was that Arceus got played by another player, and then I never had to discard a card. I should have had to discard a weapon card, but it never even told me, right? If I have a weapon card, I should have to pick one weapon card to immediately discard when he plays that card.
>
> Leaderboard needs rating instead of all time and it needs a top scores tab next to daily with the top 20 highest scores from players.
>
> Viewing profile is bad you just see the different avatars you can choose and then you don't really see much else.
>
> Points from game should be on a slope. From first place to however many players you are playing. So if you come forth, you should get more points then if you come in fifth. Coming in 2nd in a 5 player game should be considered a win
>
> Nation has the campaign that gets players playing something to kind of Strive for. favor doesnt have anything yet like that yet

> **Follow-up, rating spec** — Last place should push you up until 2.0, just slightly, so let's change the algorithm slightly. Once you are at 2.0, it should drop you if you come in last, but otherwise no. If you're not at 2.0, we want to move people up a little quicker than this, maybe a little 2x the speed. We can always turn it down.
>
> We're still really early. We want people to feel good when they play, and we do want the slopes to get steeper. We want people to hit 2, kind of quick, 3, slow, or 4, because it goes to 7.
