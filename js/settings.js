/**
 * FAVOR — Settings (FSET)
 *
 * The cog on the title screen (bottom-right, above the edition plate).
 * Owns: the Almanac door, the volume mixer (Master / Music / Effects,
 * each with a kill-switch), the playable-card glow toggle, Replay Tips
 * (moved here from the title footer), the menu-ambience toggle, and the
 * build stamp + Get Latest Version button (the stale-cache fix: phones
 * kept serving old css/js after deploys until a hard refresh).
 *
 * Device-level, not account-level — one localStorage blob 'favor_settings'.
 * Volumes are 0-100 sliders; the music element's real gain is
 * MUSIC_BASE × master × music so untouched settings sound exactly like
 * the game always has. There are NO sound effects in the game yet — the
 * Effects channel is wired and waiting: play future SFX at
 * FSET.sfxVolume() gain and the mixer governs them from day one.
 *
 * The title-screen music note (toggleMusic) stays the play/pause switch;
 * these sliders only set loudness. ui.js reads FSET.musicVolume() at its
 * two play sites; ambient.js honors 'favor_ambient_off' at boot.
 */
(function () {
    'use strict';

    const KEY = 'favor_settings';
    const DEF = {
        master: 100, music: 100, sfx: 100,
        masterOn: true, musicOn: true, sfxOn: true,
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

    // ── Application ──────────────────────────────────────────────────
    const MUSIC_BASE = 0.4;   // the theme's historical loudness at full sliders

    function musicVolume() {
        return S.masterOn && S.musicOn
            ? MUSIC_BASE * (S.master / 100) * (S.music / 100) : 0;
    }
    function sfxVolume() {
        return S.masterOn && S.sfxOn
            ? (S.master / 100) * (S.sfx / 100) : 0;
    }
    function applyAudio() {
        const music = document.getElementById('themeMusic');
        if (music) music.volume = musicVolume();
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
        cb.onchange = () => { S[onKey] = cb.checked; save(); applyAudio(); sync(); };
        range.oninput = () => {
            S[volKey] = +range.value; pct.textContent = range.value + '%';
            save(); applyAudio();
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

        ov.innerHTML = `
            <div class="set-inner">
                <div class="set-head">
                    <div class="set-title">Settings</div>
                    <button class="set-x" aria-label="Close">✕</button>
                </div>
                <div class="set-body"></div>
            </div>`;
        const body = ov.querySelector('.set-body');

        // Almanac door
        const alm = section('Collection');
        const almBtn = document.createElement('button');
        almBtn.className = 'set-alm-btn';
        almBtn.innerHTML = '<span class="set-alm-ico">❦</span><span>Open the Royal Almanac</span>';
        almBtn.onclick = () => { if (window.FALM) FALM.open(); };
        alm.appendChild(almBtn);
        body.appendChild(alm);

        // Volume mixer
        const snd = section('Sound');
        snd.appendChild(volRow('Master', 'master', 'masterOn'));
        snd.appendChild(volRow('Music', 'music', 'musicOn'));
        snd.appendChild(volRow('Effects', 'sfx', 'sfxOn'));
        body.appendChild(snd);

        // Gameplay
        const gp = section('Gameplay');
        gp.appendChild(checkRow('Glow on cards you can play', S.glow, v => {
            S.glow = v; save(); applyGlow();
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
            S.ambient = v; save(); applyAmbient();
        }));
        body.appendChild(menu);

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

    window.FSET = { open, close, musicVolume, sfxVolume, applyAll };
})();
