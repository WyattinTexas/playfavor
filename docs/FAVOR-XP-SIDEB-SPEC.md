# FAVOR — Hero XP, Side B Boards, and the Eleventh Character

**Status: BUILT & SHIPPED 2026-07-19 (late).** Signed off by Wyatt 2026-07-19; built the
same night when the ten alt boards landed (`~/Downloads/alt/alt_Character_Boards/`,
archived to `~/Downloads/Favor_Assets/Characters_B/<Name>_B.png`). MPV 16 → 17.

> **What shipped vs. this spec:**
> - All ten Side B boards, read VERBATIM off Wyatt's paintings (digit-zoom verified;
>   track geometry confirmed identical to `BOARD_OV_TRACK` on every board). Values in
>   `data/characters.js` `altSlots`.
> - Four new ongoing slot specials the boards introduced: `adventure_card_5_prestige`
>   (Bandit B), `weapon_card_3_gold` (Merchant B), `free_potion_per_round` (Doctor B),
>   `alchemy_adds_to_power` (Scientist B) — plus `minds_eye_x8` (Fisherman B) and
>   `pick_one` with special options (Magician B: Eye / Stone / Knowledge / Power).
> - `free_potion_per_round` (UPDATED per Wyatt's 7/20 audit): "ignoring its cost"
>   reads as the Map grammar — once per round a Potion plays FREE, its printed
>   REQUIREMENTS and any gold cost both waived. The waiver is spent only by a play
>   it actually changed; a potion that passes cold never burns it. (MPV 17 → 18.)
> - **Wyatt's slot-by-slot audit (7/20): 49/50 shipped correct.** The one fix:
>   Merchant B slot 1 is `borrow_any_player` ("5 Gold and trade with anyone") — the
>   up-arrow ringed by four skill minis is the TRADE icon, the same power his Side A
>   center carries, not a +1-each skill grant.
> - **The eleventh character: machinery complete, the character itself still owed.**
>   The derived predicate, ownedIds source + add-only mirror, store lock, buyCharacter
>   refusal, menu latch + fifth champ dress, and every bot filter are live and tested —
>   activation is appending Wyatt's row (with `earnedOnly: true`, at the END) + art.
> - **Side B epithets are provisional picks awaiting Wyatt's blessing** (the boards
>   carry no epithet text): Trailblazer, Oathbreaker (locked in this spec), Highwayman,
>   Guildmaster, The Far-Seeing, Velvet Glove, Transmuter, Apothecary, Firebrand,
>   Illusionist — one data field each in `characters.js` to retune.
> - ⚠ **§5's "the lock is the advertisement" was REVERSED by Wyatt on 7/20**
>   (FAVOR-UPDATE-JUL20-SPEC.md §1): below Level 5 there is NO badge, no hint —
>   Side B is a surprise. Do not restore the greyed lock badge.
> - ⚠ **§3's flat 200/level curve was retuned on 7/20** (same spec, §3): 75-anchor
>   rising ramp, Side B at 390 banked Favor. `fv`-stored/level-derived made it a
>   zero-migration change, exactly as designed.

Visual reference: **`tools/xp-design.html`** — local preview, **deliberately uncommitted**
(the repo root deploys to playfavor.net). Open it at any point on the track with `?fv=1100`;
`?fv=800` is the moment Side B unlocks.

> **Rebased 2026-07-19 afternoon.** Two facts moved under this spec after it was first
> written — the Favor ledger shipped (`6078578`) and **MPV went to 16**. Both are corrected
> throughout. See §12.

---

## 1. What was decided

| | Decision |
|---|---|
| **Bar design** | **Option C — the Gilt Ribbon.** Slim gold bar, level numeral at the head. |
| **What fills it** | **Favor banked.** Your final score with a hero goes onto that hero's track. |
| **Levels** | **100 per hero.** ~200 Favor each. |
| **Side B unlock** | **Level 5** — about 8 games. |
| **Side B balance** | **It genuinely changes the balance.** Not a sidegrade. Deliberate. |
| **Side B art** | **Wyatt supplies a real second board per hero.** See §2. |
| **Multiplayer** | **Yes, online at launch.** Requires **MPV 16 → 17** (§8). |
| **Choosing a side** | **Two-step at character select:** pick the hero, *then* pick which version. |
| **Existing players** | **Start at Level 1. No backfill.** No migration at all (§11). |
| **The eleventh character** | **Two heroes at Level 5 unlocks a brand-new character.** Earned only, never purchasable (§6). |
| **Bots** | **No AI seat rides the new character or any Side B — humans only, for now** (§6b). |

---

## 2. What we need from Wyatt — the art

This is the blocking input. Everything else can be built against placeholders.

### Eleven deliveries

Ten Side B boards (one per existing hero) **plus the eleventh character's board**.

| | |
|---|---|
| **Where** | `~/Downloads/Favor_Assets/Characters_B/` — parallel to the existing `Characters/` masters |
| **Naming** | `Knight_B.png`, `Explorer_B.png`, … and `<NewName>.png` for the eleventh |
| **Format** | PNG or high-quality JPG, **sRGB — not CMYK** (CMYK breaks the Vision-based cut tooling, and has bitten us before) |
| **Aspect** | **1600 : 1009** (≈ 1.586 : 1) — identical to Side A |
| **Size** | 1600×1009 minimum; print-master resolution preferred, same as the 7313×4614 originals |

The two in-repo derivatives are generated from the master, not delivered:
`assets/characters/<Name>_B.jpg` (800×504) and `assets/characters/hd/<Name>_B.jpg`
(1600×1009, q72).

### ⚠ The one hard constraint — tell the artist before anything is painted

**The slider track must sit in exactly the same place as it does on Side A.**

`BOARD_OV_TRACK` (`ui.js:3672`) is a *single shared constant* — the ring token is positioned
from it on every board thumbnail in the game:

```js
const BOARD_OV_TRACK = { lefts: [17, 33.4, 50, 66.3, 82.9], top: 84.7 };
```

The five slot circles must be centred at **17 / 33.4 / 50 / 66.3 / 82.9 %** across, at
**84.7 %** down. If Side B's painted track drifts, the ring lands off its circle on every
Side B board in the game, and the only fixes are repainting or making the constant
per-side — which means touching every call site.

### Two softer notes

- **The centre of the board becomes a 44 px circle.** `.pf-hero img` crops the board square
  and rounds it (`object-fit: cover`, `border-radius: 50%`) for the profile ledger and the
  leaderboard chips. Whatever sits dead centre is what represents that hero at thumbnail
  size — worth composing for.
- **Medallions need to read at 800×504**, and at ~212 px on the hero-select card. The
  existing boards clear this; just don't let Side B get busier.

### Does the eleventh character get a Side B?

**Recommend no, not at launch.** It is already the reward, and a Side B would mean an
eleventh pair of boards. `altSlots` is optional per character (§7), so it can be added later
with no refactor.

---

## 3. The curve

Flat, 200 Favor per level, capped at 100.

```
level(fv) = min(100, 1 + floor(fv / 200))
```

| Level | Lifetime Favor | ≈ games @ 100/game |
|---|---|---|
| 1 | 0 | first finished game |
| **5 — Side B** | **800** | **≈ 8** |
| 10 | 1,800 | ≈ 18 |
| 25 | 4,800 | ≈ 48 |
| 50 | 9,800 | ≈ 98 |
| 100 | 19,800 | ≈ 198 |

### ⚠ Store lifetime Favor. Derive the level. Never store the level.

`chars[id].fv` is the only new stored field. Level is computed on read, every time.
Same rule as the campaign spike's *"grant on a DERIVED predicate, never a stored counter."*
It means **the curve retunes at any point with zero migration** — change the constant and
every player's level re-derives correctly. Store the level and every retune needs a sweep of
every row. The same rule governs the eleventh-character unlock in §6.

`fv` is monotonic — it only ever increases.

---

## 4. The bar

**Per-level fill.** Shows progress toward the *next* level and resets each time. It does not
show the journey to 100, or to Level 5.

- **Arabic numerals.** Roman does not survive 100 levels — `LXXXVII` is illegible at 78 px.
- **No stations.** The four hairlines marked five levels of a single journey; meaningless
  under a per-level fill.
- **The Side B goal lives on the hero card badge, not the bar.** A player at level 3 reads
  **3** on the bar and **Side B · Lv 5** on the card. That is enough.
- **Level stays monochrome gold, always.** Rating tiers own the app's only saturated palette
  (2 green · 3 blue · 4 purple · 5 red · 6 teal · 7 gold).
- **At level 100** the track re-gilds to the store's four-stop picture-frame gradient and
  stops resetting — a mastery mark rather than a meter.

Fill is gold lit vertically (`#f2dc9c → gold-light 18% → gold 52% → #96701a`) with a 2 px lit
leading edge over a dark well. **Do not use `.btn-royal.primary`'s gradient** — it darkens at
*both* ends, which makes a fill's leading edge match the empty track.

| Surface | Treatment |
|---|---|
| Profile · Your Heroes (`.pf-hero`, 96 px desktop / 78 px phone) | ribbon at 7 px |
| Hero select card | ribbon under the board art, 11 px |
| Victory screen | delta chip beside the rating chip, 9 px |

---

## 5. Character select — the two-step

Current flow (`ui.js:1283-1431`): grid of 3 → tap a hero (FLIP animation slides it to centre,
`.selected`) → `#confirmBtn` → `confirmCharacter()` → `commitHeroPick()` or `buildSoloTable()`.

One step is inserted:

1. Tap a hero — unchanged.
2. **If that hero is Level 5+**, a chooser expands below the card: two board thumbnails side
   by side, each labelled with its own epithet (Knight: *Deadly Duelist* / *Oathbreaker*).
   Default is the side last played on that hero, else A. Big touch targets — obvious, not
   discovered.
3. Confirm commits `{ characterId, side }`.

Below Level 5 there is no chooser; the card wears a greyed `Side B · Lv 5` badge. **The lock
is the advertisement**, seen every time they pick a hero.

### ⚠ The pick clock

The queue flow runs a 20 s pick clock with an auto-pick at 0:00 (`commitHeroPick(auto)` —
`ui.js:791-813`). A second choice step eats into that window. **Auto-pick must default to a
side** (last used, else A) and must never stall waiting for a side nobody chose.

---

## 6. The eleventh character

**Reach Level 5 on any two heroes → a brand-new character unlocks.** At ~8 games per hero
that is ≈16 games — a real mid-term destination for the XP system, and the reason to spread
play across heroes rather than grinding one.

### The predicate — derived, never stored

```js
const earned = Object.values(chars || {})
    .filter(c => level(c.fv || 0) >= 5).length >= 2;
```

Same discipline as the level itself: computed on read. Nothing is written when the threshold
is crossed, so there is no counter to drift, no migration, and no way to end up owning it
without qualifying.

### Delivery into the roster

`ownedIds()` (`meta.js:1166-1172`) is currently `freeIds() ∪ localStorage.favorOwned`. It
gains a third source. All four consumers then get it for free — `buyCharacter`'s guard
(`:1185`), both store renders (`:1278`, `:1320`), `modes.js:30`, and `rollStickyOffer`
(`ui.js:854`).

**⚠ `ownedIds()` is synchronous and runs before the remote row lands.** That is exactly why
purchases keep a `favorOwned` localStorage mirror. The earned hero needs the same mirror —
otherwise it vanishes from hero-select on every cold boot until Firebase answers.

**⚠ The earned mirror is ADD-ONLY.** `favorOwned` *replaces* from remote (safe, because
offline purchases are refused). The earned mirror must never do that: a boot with no network
reads an empty `chars`, and a replace would silently revoke a character the player earned.
Only ever add.

### Announcing it

Follow Nation's three-part pattern, already documented in the campaign spike:

1. **Grant on the derived predicate** — done above.
2. **Announce on the menu you return to**, not mid-game. The champ-overlay is a singleton
   already re-dressed three ways (champion `meta.js:738`, purchase `:1389`, Stars `:1503`);
   Side B is a fourth (§10) and this is a **fifth** — no new DOM.
3. **Idempotent latch + retroactive backfill on every menu load** — re-derive each time, so
   the unlock reaches anyone who crossed the threshold while offline, or in a build that
   predated the feature. A one-line `shownUnlock` flag in localStorage keeps the ceremony
   from firing twice.

### In the store

Show it on the shelf **locked**, with the requirement as the button text — *"Reach Level 5
with two heroes."* The lock advertises the goal, same principle as the Side B badge.

**It is not purchasable at any price.** `buyCharacter` must refuse it explicitly
(`why: 'earned_only'`) rather than falling through to the Stars check.

### ⚠ Append it at the END of `data/characters.js`

`freeIds()` is `characters.slice(0, FREE_CHAR_COUNT)` — **by array order**. Inserting the new
character anywhere but the end silently changes which heroes are free.

### One thing to check when the roster hits eleven

The leaderboard renders a portrait chip per character (`.lb-chartabs`) — sized for ten.
Confirm eleven still wraps cleanly on a phone.

---

## 6b. Bots ride neither the new character nor any Side B

**DECIDED (Wyatt, 2026-07-19): for now, no AI seat may use the eleventh character or an
alternate side.** Only human players.

> ⚠ **This deliberately diverges from the store-hero precedent.** Paid heroes *do* appear as
> AI rivals today, on the grounds that seeing them is marketing. The eleventh character is
> exempt. Do not "fix" this back to match the store — it is a decision, not an oversight.
> Wyatt scoped it *"for now"*, so treat it as reversible: the whole rule is the two filters
> below plus the Side A guard.

### Side B — already correct by construction, but make it explicit

Bot seats are built without a `side` field (`buildSoloTable` pushes
`{ characterId, playerName }`; MP bot rows never set `r.side`). The resolver in §9 treats a
missing side as Side A, so bots get Side A today with no code change. **Add an explicit guard
anyway** — `side` should be forced to `'a'` for any seat that is not `_remoteHuman`, so this
cannot drift when someone later threads a side through the roster.

### The eleventh character — three paths hand out heroes, all three need the filter

**1. Solo bots — `ui.js:1666-1673`**

```js
const allChars = window.FAVOR_DATA.characters.map(c => c.id);
let available = allChars.filter(id => id !== selectedCharacter && !offered.includes(id));
if (available.length < playerCount - 1) {
    available = allChars.filter(id => id !== selectedCharacter);   // ⚠ safety fallback
}
```

Both lines need the exclusion — **the fallback especially**, since it is the path that fires
under pressure and would be the one to leak the character. Starvation is not a risk: the bot
pool stays the ten original heroes minus the three offered = 7, against at most 4 bots.

**2. MP roster fill — `mp.js:648-671`**

> ### ⚠⚠ `allHeroes` is used for two different jobs. Only one of them gets the filter.
>
> ```js
> const allHeroes = window.FAVOR_DATA.characters.map(c => c.id);
> if (!hero || !allHeroes.includes(hero) || taken.has(hero)) hero = null;   // :654 VALIDATES a human's pick
> const fromOffer = r.offer.filter(h => allHeroes.includes(h) && ...);      // :656 VALIDATES
> const free = allHeroes.filter(h => !taken.has(h));                       // :665 FILLS bot seats
> if (!r.hero) { r.hero = free.pop() || allHeroes[0]; }                    // :671 FILLS
> ```
>
> Strip the eleventh character from `allHeroes` itself and **a human who legitimately owns it
> gets their published pick rejected at `:654` and silently reassigned.** Introduce a separate
> `botPool` for `:665`/`:671` and leave the validation set whole.

`allHeroes[0]` as the last-ditch fallback is safe — it is Explorer, since the new character is
appended at the end (§6).

**3. Personas — already safe, keep it that way**

The five personas carry a hardcoded `hero:` (`meta.js:85-89` — bandit, fisherman, duchess,
scientist, knight), and the WANTED rival is one of them. None reference the new character.
**Do not assign a persona to it**, and the same goes for `r.sigHero` in `sealRoster`.

---

## 7. Data

### `data/characters.js`
Existing characters gain two optional fields:

```js
altFilename: "Knight_B.jpg",     // the Side B art
altSlots: [ /* 5 slots, same shape as slots */ ]
```

A character without `altSlots` has no Side B and never shows the badge — **this is how the
feature ships hero by hero as art lands**, rather than waiting for all ten. The eleventh
character is appended with no `altSlots` (§2).

### `favor/players/{uid}/chars/{heroId}`
Currently `{ r, g, best }`. One new field:

```js
{ r, g, best, fv }   // fv = lifetime Favor banked with this hero
```

Written inside the existing whole-row transaction at `meta.js:558-571`, next to
`out.chars[myChar]` — atomic with the stars and rating it accompanies:

```js
fv: (cc.fv || 0) + Math.max(0, Math.round(mine.finalScore || 0)),
```

### ⚠ Do NOT hang the level-up off a FACH-style check

`ui.js:6414-6422` reads:

```js
if (snap) Promise.resolve(FLB.postGameResult).then(() => FACH.sync(snap));
```

That wraps the **function object**, not the call — the call already happened on line 6407 and
its return value was discarded. `.then()` fires on the next microtask, *before*
`postGameResult`'s first `await dbTxn` settles, so FACH reads the **pre-game** row. The
comment above it claims the opposite. Harmless today (both are idempotent transactions on the
same path) but a level check hung off that pattern reads a stale `fv` and misses or
double-fires. **Compute the level change inside `postGameResult`'s own transaction.**

---

## 8. Multiplayer — MPV 16 → 17

> ⚠ **MPV was 15 when this spec was first written; the Favor ledger shipped it to 16 on
> 2026-07-19 (`js/mp.js:123`). Side B takes it to 17.**

Multiplayer is lockstep: every client simulates every seat, so all clients must know which
side each player rides, or gold, scorn, skills, Mind's Eye count and the final tally fork on
every other screen (`gameState.js:360, 439, 510, 725, 891, 2871`).

| File | Change |
|---|---|
| `mp.js:123` | `MPV = 17`, changelog entry |
| `mp.js:679-684` | `publishPick` — publish `{ hero, side }`, not a bare `heroId` |
| `mp.js:644-672` | `sealRoster` — carry `side` per row; it must survive the `delete r.offer` / `delete r.sigHero` cleanup |
| `ui.js:1917-1921` | `startMpGame` — `choices.push({ characterId: r.hero, side: r.side, ... })` |

**Bots and personas ride Side A, always, and never the eleventh character** — see §6b for the
rule and the three code paths it touches. `aiFreeSliderPos` (`gameState.js:816-829`) iterates
`player.character.slots` generically and needs no change.

---

## 9. Engine — resolving the layout

### ⚠ The load-bearing constraint

`getCharacter` (`gameState.js:120-121`) returns the **shared singleton** from
`FAVOR_DATA.characters`, stored raw at `:89`. Every player at every table holds a reference to
the same object.

**Never mutate `char.slots` in place.** Resolve a per-player object at `initPlayers`:

```js
const base = this.getCharacter(choice.characterId);
const useB = choice.side === 'b' && base.altSlots;
const char = useB
    ? { ...base, slots: base.altSlots, filename: base.altFilename || base.filename }
    : base;
```

Resolving `filename` on the same object is what makes the art correct everywhere for free —
roughly 15 sites read `assets/characters/${char.filename}` (`ui.js:2573, 3188, 3597, 4011,
4013`; `meta.js:907, 941, 1056, 1289, 1327`; `modes.js:154, 178`). **Any site that instead
looks a character up by id from `FAVOR_DATA` will silently render Side A** — audit those
separately.

Everything downstream reads `player.character.slots`, so all ten engine read sites
(`gameState.js:360, 439, 510, 551, 729-773, 818, 837, 891, 2503, 2871`) become correct with
no further edits.

### ⚠ Solo save round-trips by id only
`ui.js:1478` writes `character: p.character ? p.character.id : null`; `ui.js:1507-1510`
rehydrates via `FAVOR_DATA.characters.find(...)`. **A resumed game would silently revert to
Side A.** The save needs the side and the rehydrate needs to resolve it.

---

## 10. Celebrations

- **Ordinary level-up:** quiet. A delta chip on the victory screen, no modal — at a level
  every two games a modal would be intolerable. Show the arrow only when the game actually
  crossed a level, or `3 → 3` reads like a bug.
- **Level 5:** champ-overlay as a fourth dress, no new DOM. Title *"The Knight Turns His
  Board"*, sub *"Side B unlocked — Oathbreaker"*, the board turning over inside it.
- **The eleventh character:** champ-overlay as a fifth dress, fired on the menu (§6).
- The victory chip needs zero new animation code — any `data-total` element already counts up
  from zero over 900 ms (`ui.js:6542-6558`).

---

## 11. Launch — everyone starts at Level 1

**No retroactive backfill.** Existing players start at Level 1 on every hero and earn the
feature fresh.

- **There is no migration at all.** `fv` is absent from every row today and `(cc.fv || 0)`
  reads that as 0 — which *is* Level 1. No sweep, no script, nothing to schedule around a
  deploy.
- **Purely additive and fully reversible.** Nothing is granted retroactively, so a bad Side B
  layout can be pulled without clawing anything back.
- **It buys the soft launch the balance change wanted.** Nobody reaches Level 5 for ~8 games,
  so there is a window after ship with no Side B board in play anywhere — and ~16 games
  before the first eleventh-character unlock. Watch the first ones land.
- A hero with no `chars[id]` entry has never been played and shows no track; the profile
  ledger already filters to `g > 0` (`meta.js:862-866`).

---

## 12. The Favor dependency — RESOLVED

The original spec was blocked on a P0 from `docs/FEEDBACK-jul19-build19001508.md`: Favor was
not accumulating live, breakdown panels read `+0`, missions paid `0`. XP *is* the final score,
so a wrongly-banked track could never be corrected.

**That shipped 2026-07-19 in `6078578` (live `v20260719123131`).** `player.favor` is now the
authoritative total with an itemizing ledger — `awardFavor(pi, amount, src, label, extra)` —
and the invariant `currentFavor(i) === totalFavor` is tested. `mine.finalScore` (`meta.js:568`,
`:579`) is trustworthy.

**One sanity check before the first XP is banked:** the ledger is hours old, and the same ship
retyped 20 cards, so scoring moved twice in one day. Play one full game and confirm the
victory total equals the sum of the breakdown panels before turning the `fv` write on.

**No open decisions remain.** The only outstanding input is the art in §2.
