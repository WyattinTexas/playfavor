/**
 * FAVOR — THE DAILY BROADCAST (ads V1) — design/ads/ADS-V1.md is the contract.
 *
 * One droppable file (the sfx.js law): the FADS seam, the placeholder
 * theater, the rewarded TV on the title screen, and the interstitial gate
 * the game-start doors call. GVT's v2.59/v2.60 system, ported — same TV
 * sprite, same laws:
 *
 *   - The seam never touches stars/IAP. Granting is the caller's job, on
 *     completed:true only (the TV calls FLB.claimTvReward — a whole-row
 *     transaction, so the day can never double-pay).
 *   - Every show returns Promise<{completed:boolean}> and NEVER rejects.
 *   - Zero written words in the theater; the ✕ is there from frame one.
 *   - A gate rides the player's own tap at a start seam — never a relay
 *     (a delayed relay desyncs a lobby), never the Throne Room (Wyatt:
 *     "in the throne room, there are no ads"), never mid-game.
 *   - The gate may fail; the game may not. Every door launch is fail-safed
 *     twice (two-arg then + outer catch).
 *
 * Why the names dodge "ads": EasyList blocks "/ads.js" URLs and cosmetic
 * filters hide [id^="ad"] — so the file is broadcast.js, the overlay is
 * #tvTheater, the global is FADS. If a blocker eats the file anyway, every
 * caller guards (window.FADS ? gate : launch) and the game plays ad-free.
 *
 * Steam (FavorShell-Steam UA): NO ads, ever — paid product, and Valve's
 * review build loads this live site. The TV never renders, both seam
 * members report unavailable, gates pass through.
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const STEAM_OFF = /FavorShell-Steam/.test(navigator.userAgent);

    // ── Wyatt's dials, one line each ─────────────────────────────────
    const TV_STARS = 30;     // what the set pays, once a day
    const AD_SECS = 5;       // the placeholder show's length
    let AD_FREE_GAMES = 0;   // door games at session start that are ad-free (0 = none; let = rig-tunable)
    let AD_GAME_EVERY = 1;   // a break before every Nth door game (1 = every, 0 = off)

    let AD = null;           // the live show { t, iv, resolve } — never persisted

    function sfx(n) { try { if (window.FSFX && FSFX.play) FSFX.play(n); } catch (e) { /* silence is cosmetic */ } }

    // ── Session gate counter ─────────────────────────────────────────
    // sessionStorage, NOT in-memory (deviation from GVT, with reason): the
    // victory screen leaves via location.reload(), so an in-memory count
    // would zero after every game and a future AD_FREE_GAMES=1 would make
    // every game silently free. sessionStorage survives the reload and
    // dies with the tab — that IS the session.
    const MEM = { games: 0 };
    function sess() {
        try {
            const j = JSON.parse(sessionStorage.getItem('favorAdSess'));
            if (j && typeof j.games === 'number') return j;
        } catch (e) { /* private mode etc. — MEM carries it */ }
        return { games: MEM.games };
    }
    function sessSave(s) {
        MEM.games = s.games;
        try { sessionStorage.setItem('favorAdSess', JSON.stringify(s)); } catch (e) { /* fine */ }
    }

    // Rig/suite disarm — read at GATE time so a flow can re-arm late:
    // pinned builds and tutorial/rig pages never gate, and localhost only
    // gates when a rig says _adsOn (the ~900-check ui-audit stays
    // deterministic; the ads flow opts in explicitly).
    function adsOff() {
        if (STEAM_OFF) return true;
        if (window._adsOff) return true;
        if (window._pinEmblemSeed !== undefined) return true;
        if (window._mpSkipQueue) return true;
        if (/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.host) && !window._adsOn) return true;
        return false;
    }

    // ── The theater — one show for both seam members ─────────────────
    // One exit for every road out (the timer's zero, the ✕, the rig, a
    // game screen taking the stage): completed decides what the promise says.
    function adTeardown(completed) {
        if (!AD) return;
        const a = AD; AD = null;
        clearInterval(a.iv);
        const el = $('tvTheater'); if (el) el.remove();
        const r = a.resolve; a.resolve = null;
        if (r) r({ completed: !!completed });
    }
    function adRingSet(t) {
        const c = document.querySelector('#tvTheater circle.p'), n = $('tvCount');
        if (c) c.style.strokeDashoffset = (125.66 * (1 - t / AD_SECS)).toFixed(2);
        if (n) n.textContent = String(t);
    }
    function showTheater() {
        if (AD) return Promise.resolve({ completed: false });   // re-entry: no-pay no-op, never a second show
        return new Promise(res => {
            AD = { t: AD_SECS, iv: 0, resolve: res };
            const d = document.createElement('div'); d.id = 'tvTheater';
            // zero written words in here on purpose (nothing to nag, nothing
            // to localize) — the countdown digit and the ✕ are the whole cast
            d.innerHTML = '<div style="position:absolute;inset:0">'
                + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">'
                + '<svg class="tvt-tv" viewBox="0 20 78 70">' + tvArt(true, { clip: 'tvtclip', theater: true }) + '</svg></div>'
                + '<div class="tvt-ring"><svg viewBox="0 0 54 54">'
                + '<circle cx="27" cy="27" r="20" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="5"/>'
                + '<circle class="p" cx="27" cy="27" r="20" fill="none" stroke="#FFD75E" stroke-width="5" stroke-linecap="round" stroke-dasharray="125.66" stroke-dashoffset="0" transform="rotate(-90 27 27)"/>'
                + '</svg><b id="tvCount">' + AD_SECS + '</b></div>'
                + '<button type="button" class="tvt-x" onclick="window.FADS && FADS._tvAbort()">✕</button></div>';
            document.body.appendChild(d);
            sfx('tick');
            AD.iv = setInterval(() => {
                if (!AD) return;
                AD.t--;
                adRingSet(AD.t);
                if (AD.t <= 0) { sfx('lock'); adTeardown(true); }
            }, 1000);
        });
    }

    // ── The seam (the contract; adapters swap in behind it) ──────────
    const FADS = {
        provider: 'placeholder',
        rewardedAvailable() { return !STEAM_OFF && !AD; },
        showRewarded() {
            if (STEAM_OFF) return Promise.resolve({ completed: false });
            return showTheater();
        },
        interstitialAvailable() { return !STEAM_OFF && !AD; },
        showInterstitial() {
            // placeholder era: the interstitial IS the rewarded show — one
            // theater, two seam members; a real SDK adapter later replaces
            // each independently and no call site changes. The ✕ just ends
            // a placeholder break early; the gate continues either way.
            if (STEAM_OFF) return Promise.resolve({ completed: true });
            return showTheater();
        },
    };

    // ── THE REWARDED TV (GVT's CRT, verbatim art) ────────────────────
    function tvKey() {
        try {
            if (window.FLB && FLB.currentDateKey) return FLB.currentDateKey();
        } catch (e) { /* fall through */ }
        return new Date().toISOString().slice(0, 10);
    }
    function tvClaimedToday() {
        const k = tvKey();
        try { if (localStorage.getItem('favorTvDay') === k) return true; } catch (e) { /* fine */ }
        try {
            if (window.FLB && FLB.tvDayClaimed && FLB.tvDayClaimed() === k) return true;
        } catch (e) { /* fine */ }
        return false;
    }
    function tvArmed() { return !tvClaimedToday() && FADS.rewardedAvailable(); }

    // deterministic snow — a seeded LCG, so every repaint sees the same bytes
    function tvNoise(seed, n, fill, op, cls) {
        let s = seed >>> 0; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
        let d = '';
        for (let i = 0; i < n; i++) d += '<rect x="' + (9.5 + r() * 41).toFixed(1) + '" y="' + (41.5 + r() * 31).toFixed(1)
            + '" width="' + (1.2 + r() * 1.6).toFixed(1) + '" height="' + (1 + r() * 1.4).toFixed(1) + '"/>';
        return '<g class="' + cls + '" fill="' + fill + '" opacity="' + op + '">' + d + '</g>';
    }
    // the set itself, local box 0..78 × 0..90 (badge riding y1-21, feet on
    // 88). o.clip names the clipPath (two live svgs each deserve their own
    // def); o.theater drops the floor shadow — its svg frames the body with
    // viewBox "0 20 78 70" instead.
    function tvArt(on, o) {
        o = o || {}; const clip = o.clip || 'tvclip';
        let s = '<g>'
            + '<defs><clipPath id="' + clip + '"><rect x="9" y="41" width="44" height="34" rx="3"/></clipPath></defs>'
            + (o.theater ? '' : '<ellipse cx="39" cy="88" rx="34" ry="6" fill="#000" opacity="0.22"/>')
            + '<rect x="10" y="80" width="12" height="8" rx="2.5" fill="#7A5A22"/>'
            + '<rect x="56" y="80" width="12" height="8" rx="2.5" fill="#7A5A22"/>'
            + '<path d="M30 34 L23 25 M40 34 L47 25" stroke="#5A606B" stroke-width="2.5" stroke-linecap="round" fill="none"/>'
            + '<circle cx="23" cy="24.5" r="2.6" fill="#D9A544" stroke="#8a683e" stroke-width="1"/>'
            + '<circle cx="47" cy="24.5" r="2.6" fill="#D9A544" stroke="#8a683e" stroke-width="1"/>'
            + '<rect x="0" y="32" width="78" height="52" rx="9" fill="#C0483B" stroke="#8a3f20" stroke-width="2.5"/>'
            + '<rect x="6" y="38" width="50" height="40" rx="5" fill="#F5F0E4"/>'
            + '<rect x="9" y="41" width="44" height="34" rx="3" fill="' + (on ? '#4A5560' : '#10161E') + '"/>';
        if (on) {
            s += '<g clip-path="url(#' + clip + ')">'
                + tvNoise(20260807, 26, '#DDE4EA', '0.8', 'tvst1')
                + tvNoise(51730, 20, '#1E2630', '0.75', 'tvst2')
                + '<rect class="tvscan" x="9" y="41" width="44" height="5" fill="#FFFFFF" opacity="0.12"/>'
                + '</g>';
        } else {
            // asleep: a painted moon, two dozing stars, the amber standby
            // eye, and the flash rect the zap blink rides
            s += '<g clip-path="url(#' + clip + ')"><circle cx="42" cy="50" r="5.5" fill="#C9CDD4"/>'
                + '<circle cx="44.5" cy="48" r="5" fill="#10161E"/>'
                + '<circle cx="16" cy="47" r="1.1" fill="#8A93A6"/><circle cx="24" cy="56" r="0.9" fill="#8A93A6"/>'
                + '<rect class="tvflash" x="9" y="41" width="44" height="34" fill="#9AA2AE" opacity="0"/></g>'
                + '<circle cx="31" cy="71.5" r="1.6" fill="#D9A544" opacity="0.9"/>';
        }
        s += '<path d="M12 44 L19 44 L14 58 L12 58 z" fill="#FFFFFF" opacity="0.07"/>'
            + '<circle cx="66" cy="46" r="4.5" fill="#D9A544" stroke="#8a683e" stroke-width="1.5"/>'
            + '<circle cx="66" cy="57" r="3.2" fill="#D9A544" stroke="#8a683e" stroke-width="1.5"/>'
            + '<rect x="61" y="66" width="10" height="2" rx="1" fill="#8a3f20" opacity="0.5"/>'
            + '<rect x="61" y="70" width="10" height="2" rx="1" fill="#8a3f20" opacity="0.5"/>'
            + '</g>';
        return s;
    }

    function renderTv() {
        const b = $('tvBtn');
        if (!b) return;
        if (STEAM_OFF) { b.style.display = 'none'; return; }
        const on = tvArmed();
        b.classList.toggle('armed', on);
        b.innerHTML = '<svg viewBox="0 0 78 91" aria-hidden="true">'
            + tvArt(on, { clip: 'tvclip' })
            // the badge IS the pill: gold, digits and symbols only
            + (on ? '<g class="tvbadge"><g transform="translate(39,11)">'
                + '<path d="M-4 9 L0 16 L4 9 z" fill="#E9C34A"/>'
                + '<rect x="-29" y="-10" width="58" height="20" rx="10" fill="#FFD75E" stroke="#8a683e" stroke-width="2"/>'
                + '<text y="4.5" text-anchor="middle" font-family="Arial Narrow, Arial, sans-serif" font-weight="bold" font-size="13" fill="#3A2A14">+' + TV_STARS + ' ★</text>'
                + '</g></g>' : '')
            + '</svg>';
    }

    function tvTap() {
        if (!tvArmed()) {
            // spent (or mid-show): one soft gray blink and a tick — no modal
            const b = $('tvBtn');
            if (b) {
                b.classList.remove('zap'); void b.getBoundingClientRect(); b.classList.add('zap');
                setTimeout(() => { try { b.classList.remove('zap'); } catch (e) { /* fine */ } }, 520);
            }
            sfx('tick');
            return;
        }
        FADS.showRewarded().then(r => { if (r && r.completed) tvGrant(); });
    }

    async function tvGrant() {
        const k = tvKey();
        if (tvClaimedToday()) return;   // double-resolve guard
        let fresh = true;
        try {
            if (window.FLB && FLB.claimTvReward) fresh = await FLB.claimTvReward(k, TV_STARS);
        } catch (e) { fresh = false; }
        // the local stamp is the fast echo either way — the row is truth
        try { localStorage.setItem('favorTvDay', k); } catch (e) { /* fine */ }
        if (fresh) {
            const ts = $('title-screen'), b = $('tvBtn');
            if (ts && b) {
                const f = document.createElement('div');
                f.className = 'tv-float';
                f.textContent = '+' + TV_STARS + ' ★';
                ts.appendChild(f);
                setTimeout(() => { try { f.remove(); } catch (e) { /* fine */ } }, 1150);
                for (let i = 0; i < 6; i++) {
                    const st = document.createElement('div');
                    st.className = 'tv-float small';
                    st.textContent = '★';
                    st.style.left = (24 + Math.random() * 70) + 'px';
                    st.style.animationDelay = (0.08 + i * 0.09) + 's';
                    ts.appendChild(st);
                    setTimeout(() => { try { st.remove(); } catch (e) { /* fine */ } }, 1180 + i * 90);
                }
            }
            sfx('slide');
            try { if (typeof showNotification === 'function') showNotification('+' + TV_STARS + ' ★ — the broadcast pays', 'act'); } catch (e) { /* fine */ }
        }
        setTimeout(renderTv, 1250);   // flips the set asleep; the chip already repainted from the txn
    }

    // ── THE GATE (the interstitial half) ─────────────────────────────
    // free = the session's first AD_FREE_GAMES door games; after that a
    // break lands before every AD_GAME_EVERY'th door game. Wyatt's spec is
    // "before you play a game… no matter what kind" → 0 free, every 1.
    function gate(kind, launch) {
        let brk = false;
        try {
            if (AD) return;   // a show is already up — this tap lands on glass
            if (!adsOff()) {
                const s = sess();
                const free = s.games < AD_FREE_GAMES;
                s.games++;
                sessSave(s);
                brk = !free && AD_GAME_EVERY > 0 && (s.games % AD_GAME_EVERY) === 0;
            }
        } catch (e) { brk = false; }   // the gate may fail — the game may not
        if (brk) {
            // two-arg then: even a misbehaving future adapter that REJECTS
            // (the contract says never) still hands the game back, once
            try { FADS.showInterstitial().then(() => { try { launch(); } catch (e) { /* launched */ } }, () => { try { launch(); } catch (e) { /* launched */ } }); }
            catch (e) { launch(); }
        } else launch();
    }

    // ── Relay safety — a game taking the stage tears a live show down ──
    // as an abort and the held launch fires. Wrap idiom from sfx.js
    // (roomPickPhase/startMpGame are ui.js function declarations = window
    // props); the #game-screen observer catches every remaining road.
    function wrapAbort(name) {
        const f = window[name];
        if (typeof f !== 'function') return;
        window[name] = function () {
            try { adTeardown(false); } catch (e) { /* the relay matters more */ }
            return f.apply(this, arguments);
        };
    }
    wrapAbort('roomPickPhase');
    wrapAbort('startMpGame');
    const gs = $('game-screen');
    if (gs && window.MutationObserver) {
        new MutationObserver(() => {
            if (gs.classList.contains('active')) adTeardown(false);
        }).observe(gs, { attributes: true, attributeFilter: ['class'] });
    }

    // ── Boot + day rollover ──────────────────────────────────────────
    let _lastKey = tvKey();
    renderTv();
    setInterval(() => {
        const k = tvKey();
        if (k !== _lastKey) { _lastKey = k; renderTv(); }
    }, 30000);

    // ── Public surface + rig ─────────────────────────────────────────
    FADS.gate = gate;
    FADS.tvTap = tvTap;
    FADS.renderTv = renderTv;
    FADS._tvFinish = () => adTeardown(true);   // drives the SAME teardown the timer/✕ use
    FADS._tvAbort = () => adTeardown(false);
    FADS._cfg = (p) => { p = p || {}; if (p.free != null) AD_FREE_GAMES = p.free; if (p.every != null) AD_GAME_EVERY = p.every; };
    FADS._sess = (p) => { const s = sess(); Object.assign(s, p || {}); sessSave(s); };
    FADS._tvDay = (k) => {
        try { if (k == null) localStorage.removeItem('favorTvDay'); else localStorage.setItem('favorTvDay', k); } catch (e) { /* fine */ }
        renderTv();
    };
    FADS._state = () => ({
        sess: sess(), free: AD_FREE_GAMES, every: AD_GAME_EVERY,
        live: !!AD, t: AD ? AD.t : 0, off: adsOff(), steam: STEAM_OFF,
        key: tvKey(), claimed: tvClaimedToday(), armed: tvArmed(), stars: TV_STARS,
    });
    window.FADS = FADS;
})();
