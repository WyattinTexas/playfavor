# QUIET WHEN PUT AWAY — the title theme (and the card SFX) pause the moment the app leaves the screen, and come back where they were

Wyatt, Wednesday 9/2/2026 ~9:27 pm ET, verbatim: "Music is continuing to play in both the gvt & favor app when minimized. Please fix this"

This is the FAVOR half (GVT rides its own lane). One bug, page-only, in `js/sfx.js` (the theme section + FSFX) plus its ui-audit leg. The fix is a PAGE fix: every shell (iOS WKWebView, the Play WebView, the Steam Electron window) loads https://playfavor.net/ live, so it lands in all three on their next launch with zero store builds.

## §STATUS
in progress, card "TASK FROM THE GO MACHINE 9/2 21:33" (quiet-when-put-away), started 21:39 ET 9/2/2026, acct B (drbango305@gmail.com), session 20% at start.

## §1 TODAY (HEAD `2a27ba1`, live stamp `20260826105740`; the served js/sfx.js md5 `e12794f0…` == HEAD, checked 21:37 ET)

**Where the theme lives.** All of it is in `js/sfx.js` (437 lines on HEAD), the theme section at lines 219-340 behind the seam `FSFX._theme()`. Confirmed on HEAD: the theme is a detached `new Audio(THEME_SRC)` (no DOM element, no `#themeMusic`; audit 918 asserts the absence), `loop = false`, `THEME_VOL` 0.55, `THEME_FADE_MS` 900, started by the first gesture (three `{once:true}` capture listeners: pointerdown / touchstart / keydown) and by the title's visible edge (a MutationObserver on `#title-screen`'s class + style), hard-stopped through the 900 ms fade the instant `#game-screen` gains `.active` (a MutationObserver on its class). The seam on HEAD is already one word past the card's list: `{started, stopped, fading, owed, el}` — `owed` arrived with `a990be0` (the mixer's owed pass, Wyatt 8/5). The card's `{started, stopped, fading, el}` was the 8/4 shape.

Quoted from HEAD, the three functions that matter:

```js
    function themeStart() {
        if (tableUp()) return;               // never sing over a live table
        if (sfxVol() <= 0) { themeOwed = true; return; }   // muted: still owed a pass
        themeOwed = false;
        const t = themeNode();
        cancelThemeFade();                   // a fresh title visit outruns a dying fade
        t.volume = themeVolume();
        try { t.currentTime = 0; } catch (e) { /* not seekable yet */ }
        themeStarted++;
        const p = t.play();
        if (p && p.catch) p.catch(() => { /* autoplay veto = silence, not an error */ });
    }
    function themeStop() {
        themeStopped++;                      // counted even when already silent
        if (!theme || themeFade) return;     // nothing playing / already dying
        if (theme.paused) {                  // the one pass already ended on its own
            try { theme.currentTime = 0; } catch (e) { /* best effort */ }
            return;
        }
        // Wall-clock based and never rAF: a background tab throttles timers
        // (and zeroes rAF entirely), but an elapsed-time step still lands
        // the pause at most a beat late — the table is never sung over.
        const t0 = performance.now();
        const from = theme.volume;
        themeFade = setInterval(() => { ... from * (1 - k) ... pause(); currentTime = 0; volume = themeVolume(); }, 50);
    }
    ['pointerdown', 'touchstart', 'keydown'].forEach((ev) =>
        document.addEventListener(ev, themeStart, { once: true, passive: true, capture: true }));
```

**Why it plays today (confirmed on HEAD):** nothing in sfx.js reads `document.hidden`, `visibilitychange`, `pagehide` or `pageshow` (grep: zero hits). An `<audio>` element keeps playing when its page hides — background music is a feature to browsers and WebViews — and the WebAudio context of the effects has no hide listener either, so a match running on in a pocket (the MP turn clock's auto-plays, the rivals' spotlights) ticks and heralds from there. The only pocket-aware line on HEAD is the fade's elapsed-time interval (8/4), which makes the DEAL's stop land in a background tab; it does nothing for a theme that is simply playing.

**The shells (recon only — a shell change is a store build, Wyatt's):**
- **iOS** (`shell/ios/Favor/`, build 1.2 (22) in review): `Info.plist` has NO `UIBackgroundModes` at all (so no `audio` entry — the shell never asked iOS to keep singing in the background). `GameViewController.swift` sets `allowsInlineMediaPlayback = true` and `mediaTypesRequiringUserActionForPlayback = []` (autoplay allowed — that is how the title theme starts on a first tap at all), no AVAudioSession category is set anywhere, and there is no `sceneDidEnterBackground` / `willResignActive` hook that talks to the page. So on iOS the page hears the pocket only through WebKit's own `visibilitychange`, which WebKit fires when the app enters the background (home swipe, lock, another app). ⚠ The app SWITCHER is the soft spot: while the switcher is up the scene is merely inactive, WebKit still counts the page visible, and the theme keeps going until the swipe completes — see §4.
- **Play** (`shell/android/.../MainActivity.java`): `onPause()` calls `webView.onPause()` and `onResume()` calls `webView.onResume()` (no `pauseTimers`). Chromium's WebView maps onPause/onResume onto the page's hidden/visible state, so the page's `visibilitychange` fires on the home button, the switcher and the lock screen. `setMediaPlaybackRequiresUserGesture(false)` is why the theme can sing there at all. Not verified on a device in this card (the favorplay emulator was deleted 8/7).
- **Steam** (`shell/steam/main.js`): `webPreferences` leaves `backgroundThrottling` at its default (true), so a minimized or fully hidden window reports `document.hidden = true` and fires `visibilitychange`; Chromium keeps audio playing through it — the page fix is what makes it stop. A window merely BEHIND another window stays visible (no throttling, no hide) and keeps singing like any desktop music app.

## §2 THE REPRODUCTION (headless FIRST, on the pre-fix tree)
Rig: `repro-quiet.mjs` (scratchpad, the 8/4 `repro-polish.mjs` pattern; puppeteer-core, Chrome headless new, `--mute-audio` so play() lands), the pre-fix tree served on :8899. Title → ONE trusted click on the title lockup → the theme starts (`started=1`, `paused=false`, currentTime climbing 0.32 → 0.72 s) → shadow `document.hidden` / `visibilityState` on the document (`defineProperty`) + dispatch `visibilitychange`.

**The bug's photograph, 500 ms after hidden (MODE=BUG, 7/7 on HEAD):** `paused=false`, currentTime 1.23 → 1.63 s and still climbing; the seam has no `held` word. Log: scratchpad `repro-bug.log`.

**The fix, same rig (MODE=FIXED, 48/48, zero console errors):** hidden → `paused=true` within 250 ms (checked at 500), `held=true`, currentTime frozen at 0.72 s (never 0), no stop, no second pass · visible → `paused=false` within 250 ms, resumes from the held second (0.72 → 0.99 → 1.39), `started` still 1, no `<audio>` in the DOM · ten hide/return cycles → one pass, the same element, no leaked interval (5 → 5), position only moves forward; a second hidden edge during a hold is a no-op · a VETOED resume (play stubbed to reject NotAllowedError) → silent, hold spent, no error escaped; the next trusted click resumes from the held second (2.43 → 2.74), not the top · SFX: a throw while hidden → `_attempted` 2 / `_voiced` 1 and the context reads `suspended`; visible → the next throw voices (3/2), context `running` · the game began while hidden (the 8/4 queue case) → the deal's stop wins: rewound, hold cleared, the return plays nothing · hidden 200 ms into the 900 ms deal fade → paused, rewound, volume back at 0.55, fade interval gone, NOT held, NOT resumed on return · the title returned while hidden → the pass waits, held at the top, and sings from 0 on the visible edge · `pagehide` / `pageshow` hold and release like the visibility edge · a page never tapped → hide/return calls play() zero times, then the first gesture starts the pass exactly as before.

ℹ Headless fact worth keeping: with two pages open, the OLDER page reads `visibilityState='hidden'` (the newest tab is the visible one). The audit's two-client MP stories therefore run their first client "in a pocket" — harmless, since nothing there asserts the theme or the counters, and every block that does opens its own single page.

## §3 THE CHANGES (js/sfx.js only, +80/-2; tools/ui-audit.mjs theme block; index.html stamps)
- **(a) THE HOLD** — `themeHold()`: on `visibilitychange`→hidden (and `pagehide`, the belt), a theme that is playing pauses where it stands and is marked `held`; a fade in flight finishes as a STOP right then (ramp cancelled, pause, rewind, volume restored, nothing held); no element / already paused / already held → no-op. `FSFX.play()` gates on `!document.hidden` after counting the attempt (attempted grows, voiced does not) AND the context is suspended on the edge so nothing already ringing carries into the pocket. The context resumes on the visible edge (and, as before, on the next play()).
- **(b) THE RETURN** — `themeRelease()` → `themeResume()`: a held theme plays on from its position IF the title is still the screen (`titleUp()` reads the visible-edge watcher's own truth, plus `!tableUp()`, plus no fade in flight); the play() promise is caught — a veto arms ONE gesture listener (pointerdown/touchstart/keydown, capture, self-removing) that resumes from the same second. A game that began in the pocket has already rewound the theme through `themeStop`, which now also clears `held` (the deal's stop wins in either order). A title that RETURNED in the pocket (a table that dissolved while away) does not sing into the pocket: `themeStart` counts the pass, holds it at 0 and lets the visible edge play it.
- **(c) THE SEAM** — `FSFX._theme() = {started, stopped, fading, owed, held, el}` (+ `FSFX._ctxState()` = the context's state, for the audit's suspended/running read; one debug word beyond the card's `held`, flagged in §4).
- **Byte-still, asserted by the audit + the diff:** `THEME_SRC` · `THEME_VOL` 0.55 · `THEME_FADE_MS` 900 · one pass / `loop=false` · no DOM element, no `#themeMusic` (918) · the first-gesture listeners and the title-return watcher untouched · the deal's fade untouched · `FSET`'s export untouched · RECIPES and peaks untouched · ui.js / meta.js / engine / css untouched (git diff --stat: sfx.js, ui-audit.mjs, index.html stamps, this doc) · zero new strings, zero new assets.
- **ui-audit theme block** grows 13 checks: the hide/return leg (paused + held within 250 ms, position frozen, no stop/no pass, resumes from the held second, no `<audio>`), the effects-in-the-pocket leg (voiced only when visible; context suspended/running), the deal-in-the-pocket leg and the put-away-mid-fade leg.

## §4 WHAT WYATT SHOULD RE-DIAL (defaults shipped; each is a one-cell change)
1. **⚑ Q1 — from where it paused (shipped) vs from the top.** Shipped: a hide/return resumes the pass where it stood. If Wyatt would rather every return start the track over, the dial is `themeResume()`: add `try { theme.currentTime = 0; } catch (e) {}` before its `play()` (one line).
2. **iOS app switcher.** The page cannot see "inactive but still on screen"; WebKit only hides the page when the app truly backgrounds. Home swipe, lock screen, another app, a call: quiet. The switcher's half-second before the swipe lands: still singing. Closing that needs a one-line shell hook (`sceneWillResignActive` → `webView.evaluateJavaScript("document.dispatchEvent(new Event('visibilitychange'))")` is NOT enough — it would need to shadow `document.hidden` too; better: a page seam `FSFX.pocket(true/false)` the shell calls). Both halves are a store build (1.2 (22) is in review) — Wyatt's call, not this card.
3. **Android verification.** The Play shell's `onPause → webView.onPause()` is expected to hide the page (Chromium's WebView maps it so). Untested on a device here. Wyatt's ear-check on his phone covers it: title theme playing → home → silence → back → continues.
4. **`FSFX._ctxState()`** is one debug word beyond the card's `held` (read-only, audit-facing). Drop it if the surface should stay exactly as the card wrote it — the audit's two context checks go with it.
5. **A window behind another window** (desktop / Steam) keeps singing — that is `document.hidden`'s law (hidden = minimized, hidden tab or fully covered). If Wyatt wants "any loss of focus" to pause the theme, the dial is a `blur`/`focus` pair on `window` calling the same `pocketEnter`/`pocketLeave` — a different feel (alt-tab pauses your music), so not shipped.

## §5 STAMP
QUIET WHEN PUT AWAY · NOT SHIPPED · in progress
