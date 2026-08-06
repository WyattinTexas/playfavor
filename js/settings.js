/**
 * FAVOR — Settings (FSET)
 *
 * The cog on the title screen (bottom-right, above the edition plate).
 * Owns: the Almanac door, the volume mixer (Master / Effects, each with
 * a kill-switch), the playable-card glow toggle, Replay Tips (moved here
 * from the title footer), the menu-ambience toggle, and the build stamp
 * + Get Latest Version button (the stale-cache fix: phones kept serving
 * old css/js after deploys until a hard refresh).
 *
 * Stored in localStorage 'favor_settings' AND, for a player with a linked
 * identity, on their row as `settings` — so a choice made here follows them
 * to the next device instead of dying with the browser (Wyatt 8/5). The
 * device copy is always written first: it is what makes the panel correct
 * before the network answers, and what holds when there is no account.
 *
 * Volumes are 0-100 sliders. sfx.js plays every EFFECT at FSET.sfxVolume()
 * gain, read live at each play, so the mixer governs that layer with no
 * push. The menu THEME is an <audio> element and cannot be reached by that
 * gain, so it reads the mixer itself and applyAudio() re-syncs it live.
 * ambient.js honors 'favor_ambient_off' at boot.
 */
(function () {
    'use strict';

    const KEY = 'favor_settings';
    const DEF = {
        master: 100, sfx: 100,
        masterOn: true, sfxOn: true,
        glow: true, ambient: true,
    };
    let S = load();

    function load() {
        try { return { ...DEF, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
        catch (e) { return { ...DEF }; }
    }
    function save() {
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* play on */ }
    }

    // ── The account copy ─────────────────────────────────────────────
    // A player with an identity carries their settings between devices. No
    // identity, no push — the device blob is the whole story then.
    let adopted = false;    // the account's copy has been taken this session
    let touched = false;    // the player has changed something on THIS device

    function hasAccount() {
        try {
            const ids = (window.FLB && FLB.myIdentities && FLB.myIdentities()) || {};
            return Object.keys(ids).length > 0;
        } catch (e) { return false; }
    }

    // Dragging a slider fires oninput continuously; without this the row
    // would write once per pixel.
    let pushTimer = null, pushChain = Promise.resolve();
    function pushToAccount() {
        if (!hasAccount() || !window.FLB || !FLB.mergeRow) return;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
            const snap = { ...S };
            pushChain = pushChain
                .then(() => FLB.mergeRow(cur => ({ ...(cur || {}), settings: snap })))
                .catch(() => { /* offline: the device copy still holds */ });
        }, 600);
    }

    async function pullFromAccount() {
        if (adopted || touched || !hasAccount() || !window.FLB || !FLB.readRow) return;
        try {
            const row = await FLB.readRow();
            // touched can flip while the read is in flight — a choice made
            // here and now outranks the copy we asked for before it.
            if (touched) return;
            const remote = row && row.settings;
            if (!remote || typeof remote !== 'object') return;
            adopted = true;
            S = { ...DEF, ...remote };
            save();
            applyAll();
            const ov = document.getElementById('setOverlay');
            if (ov && ov.classList.contains('open')) open();   // redraw the controls
        } catch (e) { /* the device copy stands */ }
    }

    // Every change goes through here: device first, then the account.
    function commit() {
        touched = true;
        save();
        pushToAccount();
    }

    // ── Application ──────────────────────────────────────────────────
    function sfxVolume() {
        return S.masterOn && S.sfxOn
            ? (S.master / 100) * (S.sfx / 100) : 0;
    }
    function applyAudio() {
        // Effects need no push — sfx.js reads FSET.sfxVolume() live at each
        // play. The menu theme is an <audio> element outside that gain, so
        // it has to be told.
        try { if (window.FSFX && FSFX.applyVolume) FSFX.applyVolume(); } catch (e) { /* silence is cosmetic */ }
    }
    function applyGlow() {
        document.body.classList.toggle('no-play-glow', !S.glow);
    }
    function applyAmbient() {
        try { localStorage.setItem('favor_ambient_off', S.ambient ? '0' : '1'); } catch (e) { /* fine */ }
        const c = document.getElementById('tsAmbient');
        if (c) c.style.display = S.ambient ? '' : 'none';
    }
    function applyAll() { applyAudio(); applyGlow(); applyAmbient(); }

    function buildStamp() {
        const ui = document.querySelector('script[src*="ui.js"]');
        return ui ? (ui.src.split('?v=')[1] || '?') : '?';
    }

    // ── Panel ────────────────────────────────────────────────────────
    function volRow(label, volKey, onKey) {
        const row = document.createElement('div');
        row.className = 'vol-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = S[onKey];
        cb.title = label + ' on/off';

        const lbl = document.createElement('span');
        lbl.className = 'vol-lbl';
        lbl.textContent = label;

        const range = document.createElement('input');
        range.type = 'range';
        range.min = 0; range.max = 100; range.value = S[volKey];

        const pct = document.createElement('span');
        pct.className = 'vol-pct';
        pct.textContent = S[volKey] + '%';

        const sync = () => {
            row.classList.toggle('off', !S[onKey]);
            range.disabled = !S[onKey];
        };
        cb.onchange = () => { S[onKey] = cb.checked; commit(); applyAudio(); sync(); };
        range.oninput = () => {
            S[volKey] = +range.value; pct.textContent = range.value + '%';
            commit(); applyAudio();
        };
        sync();
        row.append(cb, lbl, range, pct);
        return row;
    }

    function checkRow(label, checked, onChange, warnText) {
        const row = document.createElement('div');
        row.className = 'set-row';
        const line = document.createElement('label');
        line.className = 'set-check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.onchange = () => onChange(cb.checked);
        const lbl = document.createElement('span');
        lbl.textContent = label;
        line.append(cb, lbl);
        row.appendChild(line);
        if (warnText) {
            const w = document.createElement('div');
            w.className = 'set-warn';
            w.textContent = warnText;
            row.appendChild(w);
        }
        return row;
    }

    function section(title) {
        const sec = document.createElement('div');
        sec.className = 'set-sec';
        const h = document.createElement('div');
        h.className = 'set-sec-title';
        h.textContent = title;
        sec.appendChild(h);
        return sec;
    }

    function open() {
        const ov = document.getElementById('setOverlay');
        if (!ov) return;
        S = load();   // another tab may have written
        pullFromAccount();   // and another DEVICE may have

        ov.innerHTML = `
            <div class="set-inner">
                <div class="set-head">
                    <div class="set-title">Settings</div>
                    <button class="set-x" aria-label="Close">✕</button>
                </div>
                <div class="set-body"></div>
            </div>`;
        const body = ov.querySelector('.set-body');

        // (The Almanac door moved to the profile screen's Standing row —
        // Wyatt 7/23: a book image beside the purse, meta.js openProfile.)

        // Volume mixer
        const snd = section('Sound');
        snd.appendChild(volRow('Master', 'master', 'masterOn'));
        snd.appendChild(volRow('Effects', 'sfx', 'sfxOn'));
        body.appendChild(snd);

        // Gameplay
        const gp = section('Gameplay');
        gp.appendChild(checkRow('Glow on cards you can play', S.glow, v => {
            S.glow = v; commit(); applyGlow();
        }, 'You might not be able to play the card, if changes happen before your turn.'));
        let tipsOn = false;
        try { tipsOn = localStorage.getItem('favor_prompt_test') === '1'; } catch (e) { /* fine */ }
        gp.appendChild(checkRow('Replay Tips — show the tutorial prompts again next game', tipsOn, v => {
            if (typeof togglePromptTest === 'function') togglePromptTest(v);
            else { try { localStorage.setItem('favor_prompt_test', v ? '1' : '0'); } catch (e) { /* fine */ } }
        }));
        body.appendChild(gp);

        // Menu
        const menu = section('Menu');
        menu.appendChild(checkRow('Ambient life — birds, petals & butterflies', S.ambient, v => {
            S.ambient = v; commit(); applyAmbient();
        }));
        body.appendChild(menu);

        // The Throne Room rehearsal (Wyatt 8/6): run a whole fake night
        // on demand — hall, draw, seating, game — to prove the flow
        // without waiting for 9:15. FMODES owns the mechanics; a
        // rehearsal table pays like an ordinary game (no 3×, no purse,
        // no Throne standing), so the button is safe in plain sight.
        const thr = section('The Throne Room');
        const trow = document.createElement('div');
        trow.className = 'set-build';
        const tlabel = document.createElement('span');
        tlabel.textContent = 'Rehearse a Throne night';
        const tbtn = document.createElement('button');
        tbtn.className = 'set-upd-btn';
        tbtn.textContent = 'Enter the Hall';
        tbtn.onclick = () => {
            close();
            if (window.FMODES && FMODES.testThroneRoom) FMODES.testThroneRoom();
        };
        trow.append(tlabel, tbtn);
        thr.appendChild(trow);
        body.appendChild(thr);

        // Rules — the illustrated reference deck. It used to BE "How to Play";
        // that button now opens the guided game, so the deck lives here as the
        // thing you consult rather than the thing you're taught by (Wyatt 7/29).
        // Sits directly above Version, as asked.
        const rules = section('Rules');
        const rrow = document.createElement('div');
        rrow.className = 'set-build';
        const rlabel = document.createElement('span');
        rlabel.textContent = 'The rules, card by card';
        const rbtn = document.createElement('button');
        rbtn.className = 'set-upd-btn';
        rbtn.textContent = 'Read the Rules';
        rbtn.onclick = () => {
            // The deck (z 2000) opens over this panel (z 1970) and closing it
            // returns here, so Settings deliberately stays open behind it.
            if (typeof openRulesDeck === 'function') openRulesDeck();
            else if (typeof openHowto === 'function') openHowto();
        };
        rrow.append(rlabel, rbtn);
        rules.appendChild(rrow);
        body.appendChild(rules);

        // Build / update
        const upd = section('Version');
        const row = document.createElement('div');
        row.className = 'set-build';
        const stamp = document.createElement('span');
        stamp.textContent = 'Build v' + buildStamp();
        const btn = document.createElement('button');
        btn.className = 'set-upd-btn';
        btn.textContent = 'Get Latest Version';
        btn.onclick = () => {
            location.href = location.pathname + '?fresh=' + Date.now();
        };
        row.append(stamp, btn);
        upd.appendChild(row);
        body.appendChild(upd);

        ov.querySelector('.set-x').onclick = close;
        ov.onclick = (e) => { if (e.target === ov) close(); };
        ov.classList.add('open');
    }

    function close() {
        const ov = document.getElementById('setOverlay');
        if (ov) ov.classList.remove('open');
    }

    applyAll();   // deferred script: body exists, saved settings take effect at boot

    // The device copy is already live above; this only upgrades it if the
    // account holds a newer choice. Identity usually lands after boot, so
    // try once now and again shortly after.
    pullFromAccount();
    setTimeout(pullFromAccount, 2500);

    window.FSET = { open, close, sfxVolume, applyAll,
                    _hasAccount: hasAccount, _pull: pullFromAccount, _state: () => ({ ...S }) };
})();
