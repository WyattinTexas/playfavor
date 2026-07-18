# FAVOR — Campaign mode, design spike

> "Nation has the campaign that gets players playing something to kind of Strive for. favor doesnt have anything yet like that yet" — Wyatt, 7/18

**Status: awaiting sign-off. Nothing is built.** This is the decision document the work order asked for — stage count, which rivals, the progression rule, the reward ladder, and the first playable slice. Everything below is a recommendation with a default; strike anything you disagree with and the build follows the marked-up version.

Sources read: `~/wkspaces/Nation/Assets/_Settings/Definitions/Campaigns/` (17 authored stage assets), `Assets/Scripts/ScriptableObjects/CampaignDefinition.cs`, `Assets/Scripts/Managers/AIManager.cs`, `Assets/Scripts/DailyRival.cs`.

---

## 1. What ports from Nation, and what doesn't

Nation's campaign is **not** a node map and **not** a linear ladder. It is a **grid: themed boss opponents across, chapters down.** Five rivals × 3 chapters + 2 standalone finales = 17 stages.

Three things make it work, and all three port cleanly:

**Lines are parallel, not sequential.** You don't beat Alexander to start Joan. Progression is per-column *depth*. This is what keeps a campaign from becoming a wall — a player stuck on Crug 3 still has four other columns open.

**Opponents are personalities, not difficulty sliders.** `AIManager.cs` is ~1000 lines and it is the biggest lesson in the whole system: per-stage opening deck, per-rival card-priority sort (Crug→Attack, Joan→Happy, Bufferberg→Money), per-rival "wanted card" lists, per-rival decision-window choices. The actual difficulty knob is just `StartingHealth` — 60 tutorial / 70 default / 100 final boss. **Five personalities × three tiers produced 17 stages out of ~5 distinct AI objective functions.** That ratio is the reason to copy this shape rather than authoring 17 bespoke fights.

**Rewards fire off derived predicates, never stored counters.** `lineComplete(rival) = every authored chapter in Progress`. This is what makes retroactive backfill trivial, which matters more than it sounds — see §5.

**What does NOT port:** Nation's health-total win condition. FAVOR games end on score after three acts. The campaign's difficulty knob has to be something else — see §4.

---

## 2. Structure and the progression rule

```
Stage    = { rivalId, chapter, title, monologue, art, opponentBrain, tableSize, handicap }
Progress = Set<(rivalId, chapter)>     // append-only, server-persisted
Owned    = Set<rivalId>                // purchase is per COLUMN, not per stage

playable(stage)  = owned(rivalId) && (chapter == 1 || Progress.has(rivalId, chapter - 1))
lineComplete(r)  = every authored chapter of r is in Progress
nextRecommended  = first playable && !completed stage, in (rivalId, chapter) order
```

Append-only Progress means a re-play can never *un*-complete a stage, and the whole UI state is derivable from two sets. Persist under `favor/players/{uid}/campaign/{rivalId}/{chapter} = timestamp` — same shape as `achievements`, which is already `{id: timestamp}`, so it reuses the patterns in `js/meta.js` and inherits the persona PATCH-only discipline for free.

### ⚠ Recommendation: 5 rivals × 3 chapters = 15 stages

FAVOR already has **ten** named and arted rivals (`js/modes.js` RIVALS): Marco Nadal, Ser Thomas, Vivienne Quickfingers, Wim Goldweight, Angler Pete, Elizabeth the Bold, John Quicksilver, Doctor Black, Fiddling Al Gable, Skylar Wondermaker.

A 10 × 3 grid is **30 stages** — roughly double Nation's authored content, and the monologue/art/tuning cost is per-stage. **Recommend five, mirroring Nation**, chosen to sit on the five FREE heroes so the intro line needs no purchase:

| Column | Rival | Hero | Brain leans |
|---|---|---|---|
| 1 (free) | **Marco Nadal** | Explorer | Survival / Prospecting — the honest opener |
| 2 | **Ser Thomas** | Knight | Power / Survival — punishes a soft Melee |
| 3 | **Vivienne Quickfingers** | Bandit | Prospecting / Power — steals and slides |
| 4 | **Wim Goldweight** | Merchant | Charisma / Knowledge — borrow economy |
| 5 | **Angler Pete** | Fisherman | Survival / Knowledge — patient missions |

The other five rivals are the obvious expansion, and the grid grows by adding a column with no rule changes.

**Open question for Wyatt:** which line should new players meet first? Default above is Marco Nadal (Explorer is `characters[0]`).

---

## 3. Reward ladder — copy Nation's verbatim

| Trigger | Pays |
|---|---|
| Any win | +2 ★ |
| First win of the day | +3 ★ |
| **"Campaign conquered" — first time on a stage only** | **+10 ★** |
| Leaderboard points | once per stage per day (anti-farm) |
| First win vs a rival | **avatar unlock** |
| Completing a whole line | **card unlock** |

The first-time-only +10 is what makes progress feel like progress instead of a grind, and the once-per-stage-per-day leaderboard cap is what stops the campaign from becoming a rating farm. **Both matter more now than they did last week**: the rating ladder (shipped 7/18) has no fall below 2.00, so an uncapped farmable stage would be a straight elevator to 2.00. **Recommend campaign stages do not move rating at all in v1** — Stars and unlocks only. Rating stays a thing you earn against the table.

FAVOR already has the unlock plumbing: `p.owned` for heroes, `p.charWins` for per-hero wins, ★ as the store currency at 100/hero. A campaign avatar unlock and a card unlock both land as new keys on the same row.

---

## 4. Opponents: the part that takes the work

The difficulty knob cannot be Nation's `StartingHealth`. Three candidates, in the order I'd try them:

1. **Handicap the opening table** — the rival starts with N Gold / a played card / a slot advantage. Cheap, legible, and it reads as "this rival is ahead of you," which is the right feeling.
2. **Chapter-scaled brain sharpness** — chapter 1 uses the generic bot heuristic, chapter 3 uses the persona brain (`_personaAI`, which already judges borrows sharper — `js/ui.js` sets it and `engine/gameState.js` reads it at the borrow bar). Zero new AI code for the top tier.
3. **Table size** — 3 seats for a duel-feeling early chapter, 5 for a late one.

Recommend **(2) + (1)**: brain sharpness is already built, and handicap is one number per stage.

The genuinely new work is **per-rival objective functions** — Ser Thomas hoarding Power cards and playing for the Melee, Wim Goldweight buying borrows aggressively. Nation got five distinct brains and reused them across fifteen stages; that is the budget to plan for.

**Steal wholesale: scripted in-character speech driven by game events** (on card played, on resource threshold, on a rival's mission failing) with a `_justOnces` set so a line never repeats. It is cheap, it is pure text, and it is most of what makes an authored fight feel authored. FAVOR already has the emote/log surface to carry it.

---

## 5. The JOAN / National Park pattern — steal all three parts

This is the single most valuable thing in Nation's campaign code and it is worth stating explicitly because part 3 is the one everyone forgets:

1. **Grant on a derived predicate** (`lineComplete`), never a stored counter.
2. **Announce on the menu you return to, not in the match** — with an explicit priority order when several banners are pending.
3. **Retroactive backfill + idempotent latch** — check on every menu load, so a reward shipped in v2 correctly finds v1 players who already earned it.

Part 3 is how you ship new rewards into an existing player base without a migration. Because Progress is append-only and rewards are derived, adding a reward later is a pure read.

**UI, from Nation:** marquee grid, one column per rival, 3 portrait tiles stacked in chapter order. Completed = **dimmed to 55% grey** — the dimming *is* the completion mark, no stamp. Next-recommended = subtle ±2.5% sine pulse. Menu button carries a notification badge. **Post-match returns you to the campaign map, not the main menu, "so the result feels earned"** — unless a banner is pending, in which case main menu for a clean stage. Locked stages **still open their preview** (read the taunt, see the art); only the PLAY button swaps to PURCHASE.

---

## 6. Where this meets WANTED

⚠ **FAVOR already has the adjacent system, and it is currently pointing at nothing.**

Nation's Daily Rival (`DailyRival.cs`, 113 lines) is deterministic, bypasses both gates, pays +50 ★ on the first win, and **does not record campaign progress unless you own the line.** FAVOR's WANTED plaque is already exactly this — a deterministic daily rival with a bounty.

**So the campaign's real job here is to give WANTED somewhere to point.** Today it is a one-off fight with a Star payout. With a campaign behind it, today's wanted rival becomes a face you recognise from a column you are working through, and the plaque becomes a door into it. That is a large gain for no new systems, and it is the strongest argument for shipping the campaign at all.

Keep the Nation rule: **a WANTED win does not advance campaign progress unless the line is owned.** It stays a daily bounty, not a shortcut.

---

## 7. First playable slice

**Recommend: Marco Nadal, chapters 1–3, free, no purchase flow, no card unlock.**

That is 3 stages, one brain, one avatar unlock, and it exercises every rule in §2: the chapter gate, `lineComplete`, the derived-predicate grant, the menu-return banner, and the retroactive latch. If the shape is wrong, it is wrong after three stages instead of fifteen.

Explicitly **not** in the slice: purchasing a column, the card unlock, the finale stages, per-rival speech (stub it with one line per stage), and any rating interaction.

---

## Decisions needed from Wyatt

1. **Five rivals or ten?** (recommend five, expandable by column)
2. **Which line is the free intro?** (recommend Marco Nadal / Explorer)
3. **Do campaign stages move rating?** (recommend NO in v1 — Stars and unlocks only, because the new ladder does not fall below 2.00 and a farmable stage would be an elevator)
4. **Is per-column purchase the right monetisation?** (Nation's model; FAVOR currently sells heroes at ★100)
5. **Does the campaign ship before or after the Steam build?** — it is the biggest single content item outstanding and it will not be a weekend.
