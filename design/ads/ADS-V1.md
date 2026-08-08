# FAVOR ADS V1 — THE BROADCAST (design; Wyatt's 8/8 goal, organized)

Wyatt (8/8, verbatim intent, organized into lanes):

1. **Five videos of gameplay footage for FAVOR**, using the music from FAVOR's
   main menu (`assets/audio/favor_take_r2.mp3` — Wyatt's own track, the one the
   title screen plays).
2. **One basic gameplay playable ad** for FAVOR.
3. **The rewarded ad placement** — "the same TV sprite we used for GVT, same
   system. Once per day, you could use it for 30 stars."
4. **The interstitial ad placement** — "before you play a game, you will get an
   ad before it queues up, no matter what kind of game it is, unless it's in
   the throne room. In the throne room, there are no ads."
5. **Remove the backdoor throne room entrance from the settings page.**

Items 3-5 are one game ship (this doc). Items 1-2 are marketing artifacts —
see §UA at the bottom.

This is the FAVOR port of GVT's `~/gvt/design/ads/ADS-V1.md` (v2.59 + v2.60,
both shipped 8/7). Same contract, same laws, adapted to FAVOR's architecture:
**stars are SERVER truth** (players/{uid} row), the menu is DOM not SVG-room,
and the victory screen exits via `location.reload()`.

## The seam (identical shapes to GVT's contract)

```js
window.FADS = {
  provider: 'placeholder',       // until a real SDK adapter lands in the shells
  rewardedAvailable(): bool,
  showRewarded(): Promise<{completed:boolean}>,       // NEVER rejects
  interstitialAvailable(): bool,
  showInterstitial(): Promise<{completed:boolean}>,   // NEVER rejects
}
```

- `completed:true` ⇔ the show ran to its very end. Abort (✕), failure,
  teardown ⇒ `{completed:false}`.
- **The seam never touches stars/IAP.** Granting is the caller's job, on
  `completed:true` only.
- **Zero external requests** in the placeholder era; the placeholder is local
  SVG/CSS + FAVOR's own synth SFX (FSFX).
- The ✕ is visible from the first frame; **zero written words in the theater**
  (nothing to nag, nothing to localize).
- A real adapter later (AppLovin MAX in the iOS/Android shells) replaces each
  member independently; no call site changes.

**Ad-blocker hygiene (why the names differ from GVT):** the code lives in
`js/broadcast.js` (EasyList blocks `/ads.js` URLs on the open web), the
overlay id is `#tvTheater` (cosmetic filters hide `[id^="ad"]` patterns), and
the global is `FADS`. If a blocker still eats the file, every door is guarded
(`window.FADS ? gate : launch`) — the game never breaks, ads just vanish.

## Platform policy

- **Steam shell (`FavorShell-Steam` UA): NO ads, ever.** Both seam members
  report unavailable, gates pass through instantly, the TV never renders.
  FAVOR on Steam is a $4.99 paid product, Valve's review of the build is IN
  THE QUEUE right now (resubmitted 8/6, verdict due ~8/11-13), and the shell
  loads the LIVE site — an ad break leaking into the review build could tank
  it. Same precedent as the Mint's UA gate (Apple 3.1.1 / Valve wallet).
- Web + iOS shell + Android shell: placeholder era ON (GVT ships the same on
  playgvt.net and its live shells). MAX SDK adapters land in the shells later;
  the iOS/Android shells will carry the family-audience ad flags that day.

## V1b — THE REWARDED TV (the Daily Broadcast)

GVT's CRT sprite, verbatim art (`tvArt`/`tvNoise` seeded-LCG snow, scanline,
rabbit ears, gold dials; asleep = dark screen + painted moon + amber standby
LED). Local box 78×91 incl. the bobbing gold **+30 ★** badge.

- **Seat**: `#tvBtn` (`.ts-tv`), absolute bottom-left of `#title-screen` —
  left 18px / bottom 14px / width 84px (phones-landscape: 64px, 10/10). The
  left rail above it (Almanac 22 / Ledger 74 / cog 126) tops out well clear;
  bottom-left is otherwise empty on wide and phone layouts (the phone corner
  stack lives bottom-RIGHT).
- **ARMED** (`!claimedToday && FADS.rewardedAvailable()`): snow + scanline +
  badge. Tap → `FADS.showRewarded()` → on `completed:true` → `tvGrant()`.
- **ASLEEP** (claimed today, or Steam/no-fill): moon + standby LED, badge
  gone. Tap = one soft gray blink + `FSFX.play('tick')`. No modal, no nag.
- **The day** = `FLB.currentDateKey()` — the 10 PM ET window every other
  FAVOR daily (WANTED rival, champions) lives on. NOT calendar-local like
  GVT's `todayStr()`; FAVOR's "once per day" already has one canonical clock.
- **The grant is a server transaction** (stars are server truth here —
  the GVT `META.starBank` line becomes FAVOR's rival-claim idiom):
  `FLB.claimTvReward(key)` = whole-row `dbTxn(players/{uid})`, aborts if
  `cur.tvDay === key`, else writes `{tvDay: key, stars: cur.stars + 30}` —
  two tabs can never double-pay, and clearing localStorage can't re-arm a
  claimed day. Local mode (offline) rides the same dbTxn local branch, like
  every other star. `_me` refreshes from the txn value; the profile chip
  repaints.
  - **Abort never burns the day**: `tvDay` is written ONLY inside the
    committed grant txn.
  - Fast local echo: `localStorage.favorTvDay = key` on grant; armed check =
    server row OR local stamp says unclaimed (pre-`_me` boot reads the stamp).
- **Grant juice**: `+30 ★` float + six star bursts over the set,
  `FSFX.play('slide')`, `showNotification('+30 ★ — the broadcast pays', 'act')`,
  TV repaints asleep ~1.2s later; the chip already repainted from the txn.
- Repaint hooks: initial render at boot, re-render when `_me` lands
  (`renderProfileChip`'s existing FMODES call site gains a `FADS.renderTv()`),
  and on day rollover via the same 1s title clock the WANTED plaque runs.

Dials, one line each: `TV_STARS` 30 · `AD_SECS` 5 · the seat (one CSS rule) ·
badge text.

## V1a — THE INTERSTITIAL + THE GATES

Placeholder show = the SAME theater (`#tvTheater`, big TV static, gold
countdown ring `AD_SECS` 5s, ✕ from frame one, wordless). One theater, two
seam members. The ✕ ends a placeholder break early and the gate continues
either way — the placeholder mints no revenue, so skippable = kindness.

**Doors (the player's own tap at a start seam, and nowhere else):**

| door | where | note |
|---|---|---|
| PLAY | `startGame()` ui.js | gate AFTER the resume-sheet intercept — resuming a saved table is not a new game; the sheet's "New Game" re-enters `startGame()` and gates then. Gate fires BEFORE `FMP.enterQueue` — "an ad before it queues up". Already-queued taps just pulse the chip (no gate). |
| Skirmish | `FMODES.beginSkirmish(n)` | the size tap |
| WANTED | `FMODES.beginRivalGame()` | Face Them / Rematch |
| Private host | `FMODES.hostRoom()` | before the room exists |
| Private join | `FMODES.joinRoom()` | before the seat is taken |

**Exempt, by law:**
- **The Throne Room — every path** (`openThroneDoor`, `enterThroneHall`,
  the rehearsal). Wyatt: "in the throne room, there are no ads."
- The guided How to Play (a lesson, not a game; also the first thing a
  store reviewer taps).
- Resuming a saved solo table (same game, second sitting).
- **Every MP relay** (`roomStart`→picking, throne draw, `startMpGame`,
  `roomPickPhase`) — a delayed relay desyncs a lobby of humans (GVT law).
- Rig/audit doors (`_pinEmblemSeed` builds skip the queue, not the gate —
  the gate skips ITSELF under `_pinEmblemSeed`/`_adsOff`, so the ~900-check
  ui-audit and every probe stay byte-deterministic).

**Schedule**: `free = count < AD_FREE_GAMES` · `due = !free && EVERY>0 &&
idx % EVERY === 0`. Dials (`let`, rig-tunable): **`AD_FREE_GAMES` 0 ·
`AD_GAME_EVERY` 1** — Wyatt's spec is "before you play a game… no matter what
kind", so nothing is free and every door game is due. One kind, one counter.

**Counters live in `sessionStorage`** (deviation from GVT's in-memory ADQ,
with reason): FAVOR's victory screen leaves via `location.reload()`, so an
in-memory counter would reset after EVERY game and a future
`AD_FREE_GAMES=1` would silently make every game free. sessionStorage
survives the reload, dies with the tab — that IS the session. (With today's
0/1 dials the two designs behave identically; this future-proofs the free
dial.)

**Fail-safe (GVT's, verbatim):** gate body try/caught — a counting bug may
never eat a game; launch rides a two-arg `.then(launch, launch)` + outer
try/catch — a throwing OR rejecting adapter still hands the game back exactly
once; mid-show door taps land on glass (no count, no launch).

**Collision safety:** theater z = **10552** — above every menu overlay
(10500-10550), BELOW the MATCH FOUND ring (10560), so an accept ring landing
mid-show (Play-queued in the background, then gating a second door) stays
visible and tappable. Entering the pick/live theater tears a live show down
as an abort and the held launch fires: `js/broadcast.js` wraps
`roomPickPhase`/`startMpGame` (the sfx.js wrap idiom) and watches
`#game-screen.active` (the theme-stop MutationObserver idiom).

## The Settings backdoor (removed)

`js/settings.js` loses the whole "The Throne Room — Rehearse a Throne night"
section (the 8/6 v32 button). `FMODES.testThroneRoom()` and
`FMP.throne.testEnter()` STAY — they are rig seams (probe + future QA), just
no longer reachable from any player surface.
`tools/probe-throne-rehearsal.mjs` switches from clicking the button to
calling `FMODES.testThroneRoom()` directly.

## Rig

`FADS._state()` → `{sess, free, every, live, steam, tvDay, armed}` ·
`FADS._cfg({free, every})` · `FADS._tvFinish()` / `FADS._tvAbort()` drive any
live show through the SAME teardown the timer/✕ use (batteries never wait 5s)
· `FADS._tvDay(k)` seeds the local stamp for rollover legs.

## QA (engine-smoke untouched — no engine bytes move)

ui-audit gains an ads flow: gate fires at each door (Play/skirmish/rival/
host)... show → held launch lands exactly once · ✕ aborts and STILL launches ·
throne door NEVER gates · rehearsal button GONE from settings · TV: armed →
`_tvFinish` → +30 stars on the row exactly once · same-day second tap = blink,
no pay · `_tvDay(yesterday)` re-arms · abort pays nothing and leaves the day
unburnt · Steam UA leg: no TV, no gates. Suites keep their determinism because
pinned builds (`_pinEmblemSeed`) auto-disarm the gate; the ads flow arms it
explicitly via `FADS._cfg`.

## §UA — the marketing artifacts (separate lanes, same day)

**Five gameplay videos** (`~/playfavor/marketing/applovin/`): portrait
1080×1920 H.264 High @30 yuv420p bt709/tv, AAC 48k stereo, faststart,
≤30s each, bed = `favor_take_r2.mp3` (the title theme — Wyatt's ask), end
card = FAVOR logo + PLAY NOW (the playable's CTA screen recomposed, GVT
end-card law). Capture = `shell/store/capture-trailer.mjs`'s CDP-screencast
rig re-aimed portrait (the game's phone layout at 540×960@2). Five distinct
hooks: A first-hand/coach story · B mission ceremony/borrow drama · C melee
clash · D WANTED rival raid · E victory/crowning. AppLovin UA spec is
generous (≤60s, ≤1GB) — do not shrink to the oRTB 4MB myth.

**One basic gameplay playable** (`~/playfavor/playables/`): single
self-contained HTML ≤5MB, engine+ui+data+css inlined, Firebase/net stubbed
out (`netAllowed` = false class of guards), fonts/audio dropped, card art
limited to the pinned opening, auto-boots a 3p skirmish as the Explorer with
a guided first throw, PLAY NOW → `mraid.open` → Play
`com.corkscrewgames.favor` / App Store `id6790169069` / else playfavor.net.
Builder forks `git show HEAD:` files (never the worktree) and **must disarm
the ad gates + strip js/broadcast.js** (an ad creative never shows ad breaks
— GVT's pin law, enforced by builder assert).
