/**
 * FAVOR — Sound Effects (FSFX)
 *
 * The game's first audio pass (Wyatt 8/3): sounds for the card moments —
 * your throw and take-back, the Emblem lock as hands pass, each fate you
 * choose at your reveal (play / borrow / letter / discard / slide), a soft
 * tick that paces the rivals' spotlights, the mission ceremony's herald,
 * and the act-end / final-scoring stings.
 *
 * Everything here is SYNTHESIZED in WebAudio — no files, no payload, no
 * license to clear. Buffers pre-render once at init so a play is always a
 * zero-latency buffer start. Init waits for the FIRST user gesture (iOS
 * refuses audio before one); the title screen demands a tap long before
 * the first card exists, so the table is always ready by the deal.
 *
 * Every sound plays at FSET.sfxVolume() — Master × Effects, read at play
 * time, so the Settings mixer governs this layer from day one and either
 * kill-switch is hard silence.
 *
 * The hooks WRAP the ui.js globals from the outside instead of editing
 * call sites: this file is the whole audio layer — droppable, and ui.js
 * (which carries other work in flight) stays untouched. Wrappers never
 * let a sound error into gameplay, and a missing/renamed target just
 * means that sound retires quietly.
 */
(function () {
    'use strict';

    let ctx = null;            // AudioContext — created on first gesture
    let ready = false;         // buffers rendered
    const buffers = {};        // name → AudioBuffer
    const attempted = {};      // name → play() calls   (verification aid)
    const voiced = {};         // name → actually audible starts

    function sfxVol() {
        try { return window.FSET ? FSET.sfxVolume() : 1; } catch (e) { return 1; }
    }

    // ── Playback ─────────────────────────────────────────────────────
    function play(name) {
        attempted[name] = (attempted[name] || 0) + 1;
        if (!ready || !ctx) return;
        const v = sfxVol();
        if (v <= 0) return;                       // mixer says silence
        const buf = buffers[name];
        if (!buf) return;
        try {
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const g = ctx.createGain();
            g.gain.value = v;
            src.connect(g);
            g.connect(ctx.destination);
            src.start();
            voiced[name] = (voiced[name] || 0) + 1;
        } catch (e) { /* a lost sound must never cost a turn */ }
    }

    // ── Synthesis toolkit (offline, mono 44.1k) ──────────────────────
    // tone(): osc → gain envelope → optional lowpass. noise(): seeded
    // white noise → filter sweep → gain envelope. Peaks are each sound's
    // baked-in trim; the live gain node carries only the mixer volume.
    function tone(oc, o) {
        const osc = oc.createOscillator();
        osc.type = o.type || 'sine';
        const t0 = o.t0 || 0, dur = o.dur || 0.2;
        osc.frequency.setValueAtTime(Math.max(o.f0, 1), t0);
        if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 1), t0 + dur);
        const g = oc.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(o.peak || 0.2, t0 + (o.a || 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        let out = g;
        if (o.lp) {
            const f = oc.createBiquadFilter();
            f.type = 'lowpass'; f.frequency.value = o.lp;
            out.connect(f); out = f;
        }
        out.connect(oc.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
    }
    function noise(oc, o) {
        const t0 = o.t0 || 0, dur = o.dur || 0.2;
        const n = Math.ceil(oc.sampleRate * (dur + 0.02));
        const b = oc.createBuffer(1, n, oc.sampleRate);
        const d = b.getChannelData(0);
        let s = 0x2F6E2B1;                        // fixed seed — same air every game
        for (let i = 0; i < n; i++) {
            s = (s * 1664525 + 1013904223) >>> 0;
            d[i] = s / 2147483648 - 1;
        }
        const src = oc.createBufferSource();
        src.buffer = b;
        const f = oc.createBiquadFilter();
        f.type = o.type || 'bandpass';
        f.Q.value = o.q || 1;
        f.frequency.setValueAtTime(Math.max(o.f0, 20), t0);
        if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 20), t0 + dur);
        const g = oc.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(o.peak || 0.2, t0 + (o.a || 0.01));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(f); f.connect(g); g.connect(oc.destination);
        src.start(t0);
    }

    // ── The palette — wood, parchment, coin and horn; no arcade ──────
    const RECIPES = {
        // Your card leaves your hand for the table, face down.
        throw: [0.24, (oc) => {
            noise(oc, { f0: 900, f1: 2600, q: 1.2, dur: 0.2, peak: 0.5 });
            tone(oc, { type: 'triangle', f0: 1400, f1: 900, t0: 0.1, dur: 0.07, peak: 0.12 });
        }],
        // ...and comes back while the window's still open.
        undo: [0.2, (oc) => {
            noise(oc, { f0: 2200, f1: 800, q: 1.2, dur: 0.16, peak: 0.35 });
            tone(oc, { f0: 220, f1: 170, t0: 0.03, dur: 0.12, peak: 0.18 });
        }],
        // The last card is in: the Emblem flares and hands pass.
        lock: [0.62, (oc) => {
            noise(oc, { f0: 600, f1: 2000, q: 1, dur: 0.3, peak: 0.28 });
            tone(oc, { f0: 659, dur: 0.3, t0: 0.18, peak: 0.2 });
            tone(oc, { f0: 1319, dur: 0.2, t0: 0.18, peak: 0.05 });
            tone(oc, { f0: 880, dur: 0.34, t0: 0.28, peak: 0.16 });
        }],
        // Play: the card lands and means it.
        play: [0.32, (oc) => {
            tone(oc, { f0: 120, f1: 55, dur: 0.16, peak: 0.8 });
            noise(oc, { type: 'lowpass', f0: 400, dur: 0.05, peak: 0.35 });
            tone(oc, { type: 'triangle', f0: 660, dur: 0.22, t0: 0.06, peak: 0.13 });
        }],
        // Discard: drier, a door closing, +3g consolation.
        discard: [0.26, (oc) => {
            noise(oc, { f0: 1200, f1: 500, q: 1, dur: 0.14, peak: 0.3 });
            tone(oc, { f0: 100, f1: 65, dur: 0.12, t0: 0.02, peak: 0.4 });
        }],
        // The ring slides along the board and clicks into its slot.
        slide: [0.42, (oc) => {
            noise(oc, { f0: 350, f1: 1100, q: 2, dur: 0.3, peak: 0.35 });
            tone(oc, { type: 'triangle', f0: 1800, dur: 0.04, t0: 0.3, peak: 0.2 });
        }],
        // Mission Letter: parchment unfolds, the seal chimes.
        letter: [0.5, (oc) => {
            noise(oc, { type: 'highpass', f0: 3000, dur: 0.06, peak: 0.25 });
            noise(oc, { type: 'highpass', f0: 2600, t0: 0.09, dur: 0.08, peak: 0.22 });
            tone(oc, { f0: 988, t0: 0.18, dur: 0.25, peak: 0.15 });
            tone(oc, { f0: 1319, t0: 0.26, dur: 0.22, peak: 0.1 });
        }],
        // Borrow & Play: two coins change hands, then the card lands.
        borrow: [0.52, (oc) => {
            tone(oc, { type: 'triangle', f0: 2500, dur: 0.05, peak: 0.25 });
            tone(oc, { type: 'triangle', f0: 2100, t0: 0.09, dur: 0.05, peak: 0.22 });
            tone(oc, { f0: 120, f1: 60, t0: 0.2, dur: 0.14, peak: 0.5 });
            tone(oc, { type: 'triangle', f0: 660, t0: 0.26, dur: 0.2, peak: 0.1 });
        }],
        // A rival's spotlight beat — deliberately the quietest thing here.
        tick: [0.1, (oc) => {
            noise(oc, { type: 'lowpass', f0: 800, dur: 0.05, peak: 0.16 });
            tone(oc, { f0: 520, dur: 0.05, peak: 0.07 });
        }],
        // The mission ceremony opens — a soft court horn.
        herald: [0.65, (oc) => {
            tone(oc, { type: 'sawtooth', f0: 220, dur: 0.28, peak: 0.12, lp: 1200 });
            tone(oc, { type: 'sawtooth', f0: 294, t0: 0.22, dur: 0.35, peak: 0.14, lp: 1200 });
        }],
        // Act's end — the melee splash takes the stage.
        sting: [1.0, (oc) => {
            tone(oc, { type: 'sawtooth', f0: 220, dur: 0.35, peak: 0.12, lp: 1800 });
            tone(oc, { type: 'sawtooth', f0: 330, t0: 0.18, dur: 0.35, peak: 0.14, lp: 1800 });
            tone(oc, { type: 'sawtooth', f0: 440, t0: 0.36, dur: 0.45, peak: 0.18, lp: 1800 });
            noise(oc, { type: 'highpass', f0: 6000, t0: 0.36, dur: 0.5, peak: 0.08 });
        }],
        // The score sheet — the game's last word.
        win: [1.7, (oc) => {
            tone(oc, { f0: 147, dur: 1.0, peak: 0.15 });
            tone(oc, { type: 'sawtooth', f0: 294, dur: 0.4, peak: 0.12, lp: 2200 });
            tone(oc, { type: 'sawtooth', f0: 370, t0: 0.15, dur: 0.4, peak: 0.14, lp: 2200 });
            tone(oc, { type: 'sawtooth', f0: 440, t0: 0.3, dur: 0.5, peak: 0.16, lp: 2200 });
            tone(oc, { type: 'sawtooth', f0: 587, t0: 0.5, dur: 0.7, peak: 0.2, lp: 2200 });
            noise(oc, { type: 'highpass', f0: 5000, t0: 0.5, dur: 0.8, peak: 0.1 });
        }],
    };

    function renderAll() {
        const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OAC) return Promise.resolve();
        const jobs = Object.keys(RECIPES).map((name) => {
            const dur = RECIPES[name][0], build = RECIPES[name][1];
            const oc = new OAC(1, Math.ceil(44100 * dur), 44100);
            build(oc);
            return oc.startRendering().then((buf) => { buffers[name] = buf; });
        });
        return Promise.all(jobs);
    }

    // ── First-gesture init (iOS: nothing may sound before a tap) ─────
    function init() {
        if (ctx) return;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            ctx = new AC();
        } catch (e) { return; }
        ctx.resume().catch(() => {});
        try {
            // The classic unlock: an inaudible 1-frame start inside the
            // gesture convinces iOS this context is user-blessed.
            const b = ctx.createBuffer(1, 1, 22050);
            const s = ctx.createBufferSource();
            s.buffer = b; s.connect(ctx.destination); s.start(0);
        } catch (e) { /* unlock is best-effort */ }
        renderAll().then(() => { ready = true; }).catch(() => {});
    }
    ['pointerdown', 'touchstart', 'keydown'].forEach((ev) =>
        document.addEventListener(ev, init, { once: true, passive: true, capture: true }));

    // ── The menu theme (Wyatt, 8/3 eve): one pass, never a loop ──────
    // Favor_Take rides the same first-gesture law as the SFX context,
    // plays ONCE through at the title, and FADES OUT over ~a second the
    // instant the game screen arrives (Wyatt 8/4: a fade, never a cut) —
    // whatever road led there (solo, queue, throne, private, a rejoin).
    // Each return to the title starts the single pass over. No DOM
    // element and no #themeMusic id: the old plumbing stays retired
    // (audit 918 asserts its absence), and a NEW filename per track is
    // the cache law.
    const THEME_SRC = 'assets/audio/favor_take_r2.mp3';
    const THEME_VOL = 0.55;    // dial — the sfx trims were tuned to sit under a theme
    const THEME_FADE_MS = 900; // the deal's ramp to silence
    let theme = null;
    let themeFade = null;      // interval handle while a fade-out is dying
    let themeStarted = 0, themeStopped = 0;    // seams for the audit

    function themeNode() {
        if (!theme) {
            theme = new Audio(THEME_SRC);
            theme.loop = false;              // the ask, literally: one pass
            theme.preload = 'auto';
        }
        return theme;
    }
    function tableUp() {
        const gs = document.getElementById('game-screen');
        return !!(gs && gs.classList.contains('active'));
    }
    function cancelThemeFade() {
        if (themeFade) { clearInterval(themeFade); themeFade = null; }
    }
    // The theme is an <audio> element, so the WebAudio gain the effects run
    // through cannot touch it — it has to read the mixer itself. It did not,
    // which is why Settings appeared to do nothing: every effect obeyed and
    // the one loud thing on the title screen ignored them both.
    function themeVolume() {
        const v = sfxVol();
        return v > 0 ? THEME_VOL * v : 0;
    }
    // Live re-sync, called by FSET whenever a slider moves or a switch flips.
    function applyVolume() {
        if (!theme || themeFade) return;     // a dying fade owns the volume
        try { theme.volume = themeVolume(); } catch (e) { /* iOS: read-only */ }
    }
    function themeStart() {
        if (tableUp()) return;               // never sing over a live table
        if (sfxVol() <= 0) return;           // the mixer says silence
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
        themeFade = setInterval(() => {
            const k = (performance.now() - t0) / THEME_FADE_MS;
            if (k < 1) {
                try { theme.volume = from * (1 - k); } catch (e) { /* iOS: volume is read-only */ }
                return;
            }
            cancelThemeFade();
            try { theme.pause(); } catch (e) { /* silence is the goal */ }
            try { theme.currentTime = 0; } catch (e) { /* best effort */ }
            // Reset to the MIXER's level, not the raw dial — otherwise the
            // next pass comes back at full volume however low the sliders are.
            try { theme.volume = themeVolume(); } catch (e) { /* ready anyway */ }
        }, 50);
    }
    ['pointerdown', 'touchstart', 'keydown'].forEach((ev) =>
        document.addEventListener(ev, themeStart, { once: true, passive: true, capture: true }));

    // The watchers: #game-screen gains .active on every deal; the title
    // hides via .hidden (+ a delayed display:none) and returns by
    // shedding them — watch the visible EDGE, not the mechanism.
    function armThemeWatchers() {
        if (!window.MutationObserver) return;
        const gs = document.getElementById('game-screen');
        if (gs) {
            let up = gs.classList.contains('active');
            new MutationObserver(() => {
                const now = gs.classList.contains('active');
                if (now && !up) themeStop();
                up = now;
            }).observe(gs, { attributes: true, attributeFilter: ['class'] });
        }
        const ts = document.getElementById('title-screen');
        if (ts) {
            const vis = () => !ts.classList.contains('hidden') && ts.style.display !== 'none';
            let seen = vis();
            new MutationObserver(() => {
                const now = vis();
                if (now && !seen) themeStart();
                seen = now;
            }).observe(ts, { attributes: true, attributeFilter: ['class', 'style'] });
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', armThemeWatchers, { once: true });
    } else { armThemeWatchers(); }

    // ── Hooks — wrap the ui.js globals ───────────────────────────────
    function wrap(name, makeWrapper) {
        const orig = window[name];
        if (typeof orig !== 'function') return;
        window[name] = makeWrapper(orig);
    }

    // ui.js declares `game` with top-level let — a global BINDING, not a
    // window property — so it must be read bare, guarded for the day it
    // isn't there at all.
    function G() {
        try { return game || null; } catch (e) { return null; }
    }

    // Your throw / take-back: sound only when the engine really moved a
    // card (the guards inside refuse taps while locked, already thrown…).
    wrap('throwCard', (orig) => function () {
        const g0 = G();
        const before = g0 && g0.pendingActivations && g0.pendingActivations[0];
        const r = orig.apply(this, arguments);
        try {
            const g = G();
            const after = g && g.pendingActivations && g.pendingActivations[0];
            if (!before && after) play('throw');
        } catch (e) { /* sound only */ }
        return r;
    });
    wrap('undoThrow', (orig) => function () {
        const g0 = G();
        const before = g0 && g0.pendingActivations && g0.pendingActivations[0];
        const r = orig.apply(this, arguments);
        try {
            const g = G();
            const after = g && g.pendingActivations && g.pendingActivations[0];
            if (before && !after) play('undo');
        } catch (e) { /* sound only */ }
        return r;
    });

    // The lock beat — fires exactly once per round, solo and MP alike.
    wrap('flashEmblemFirst', (orig) => function () {
        try { play('lock'); } catch (e) { /* sound only */ }
        return orig.apply(this, arguments);
    });

    // Your reveal: the chooser's resolved value IS the chosen fate.
    const ACT_SOUND = {
        play: 'play', borrow_play: 'borrow', mission_letter: 'letter',
        discard: 'discard', discard_slide_left: 'slide', discard_slide_right: 'slide',
    };
    wrap('showCardChoice', (orig) => function () {
        const p = orig.apply(this, arguments);
        return p && p.then ? p.then((act) => {
            try { if (ACT_SOUND[act]) play(ACT_SOUND[act]); } catch (e) { /* sound only */ }
            return act;
        }) : p;
    });

    // Paid slide: one sound per step that actually moved the ring. The
    // engine move runs in the async fn's synchronous prefix, so the
    // position check right after the call reads the truth.
    wrap('payToSlide', (orig) => function () {
        const g = G();
        const p0 = g && g.players && g.players[0];
        const before = p0 ? p0.sliderPosition : null;
        const r = orig.apply(this, arguments);
        try { if (p0 && p0.sliderPosition !== before) play('slide'); } catch (e) { /* sound only */ }
        return r;
    });

    // Rivals' and remote seats' spotlights — the reveal walk's pacing.
    wrap('showCardSpotlight', (orig) => function () {
        try { play('tick'); } catch (e) { /* sound only */ }
        return orig.apply(this, arguments);
    });

    // Ceremony, act-end melee, and the final sheet.
    wrap('showMissionCeremony', (orig) => function () {
        try { play('herald'); } catch (e) { /* sound only */ }
        return orig.apply(this, arguments);
    });
    wrap('showMeleeSplash', (orig) => function () {
        try { play('sting'); } catch (e) { /* sound only */ }
        return orig.apply(this, arguments);
    });
    wrap('showScoring', (orig) => function () {
        try { play('win'); } catch (e) { /* sound only */ }
        return orig.apply(this, arguments);
    });

    window.FSFX = { play, init, applyVolume, _attempted: attempted, _voiced: voiced,
                    _themeVolume: themeVolume,
                    _theme: () => ({ started: themeStarted, stopped: themeStopped,
                                     fading: !!themeFade, el: theme }),
                    get ready() { return ready; } };
})();
