/**
 * FAVOR — The Ledger of Deeds (FDEED)
 *
 * The second trophy system. Achievements (js/achievements.js) keep their
 * Stars, their gallery and their title-screen door exactly as they were;
 * deeds are a separate ledger that pays NOTHING and lives behind a button
 * on the Profile. Nothing here touches the achievements' storage.
 *
 *   players/{uid}/deeds/{id}   = <timestamp granted>
 *   players/{uid}/deedStats    = { humanGames, lastGame }  (counters)
 *   players/{uid}/almanac      = the collection book, synced across devices
 *
 * THREE THINGS THIS FILE OWES THE PLAYER
 *   1. A grant is once per account, and it is atomic — the deed and the
 *      counters land in ONE whole-row transaction, the pattern achievements
 *      arrived at after the duplicate-award report (7/22).
 *   2. A disaster celebrates in the RUIN frame, not the gold one.
 *   3. If there is no account, the first unlock says so — once, with a
 *      Dismiss that means never again on this device.
 */
(function () {
    'use strict';

    const DEFS = () => (window.FAVOR_DATA && window.FAVOR_DATA.deeds) || [];
    const RANK_LABEL = {
        bronze: 'Bronze', silver: 'Silver', gold: 'Gold',
        platinum: 'Platinum', legendary: 'Legendary',
    };
    const NAG_KEY = 'favor_deednag_off';

    // ── Snapshot ─────────────────────────────────────────────────────
    // Everything a check can see. Built from the finished game, the score
    // sheet and the player's own record — never from the engine live, so a
    // check can be a pure function of this object.
    function seatSnapshot(game, scores, opts) {
        const p = game && game.players && game.players[0];
        if (!p) return null;
        const o = opts || {};
        const rows = Array.isArray(scores) ? scores : [];
        const mine = rows.find(r => r.playerIndex === 0) || null;
        const place = rows.findIndex(r => r.playerIndex === 0);

        // Gold rank: 0 = richest. Ties share the better rank, so "least gold
        // at the table" is only true when nobody else is equally poor.
        const golds = rows.map(r => r.gold || 0).sort((a, b) => b - a);
        const myGold = mine ? (mine.gold || 0) : (p.gold || 0);
        const goldRank = golds.indexOf(myGold);
        const poorest = golds.length && golds[golds.length - 1] === myGold
            && golds.filter(g => g === myGold).length === 1;

        // Photo finish: first and second finished on the SAME score, so the
        // gold tiebreaker in calculateFinalScores decided the crown.
        const tiedOnScore = rows.length > 1
            && rows[0].finalScore === rows[1].finalScore;

        const slots = (p.character && p.character.slots) || [];
        const played = p.playedCards || [];

        return {
            // this game
            won: !!o.won,
            place: place < 0 ? rows.length : place,
            tableSize: rows.length || game.playerCount || 0,
            humans: o.humans || 1,
            beatRival: !!o.beatRival,
            finalScore: mine ? mine.finalScore : 0,
            gold: myGold,
            goldRank: poorest ? (rows.length - 1) : goldRank,
            tiedOnScore,
            scorn: p.scorn || 0,
            actThreePlace: (typeof p._actThreePlace === 'number') ? p._actThreePlace : -1,
            characterId: (p.character && p.character.id) || null,
            onSideB: (p.character && p.character._side) === 'b',
            slotPos: p.sliderPosition || 0,
            slotCount: slots.length,
            handLeft: ((game.hands && game.hands[0]) || p.hand || []).length,
            cardsPlayed: (p.playedEver && p.playedEver.length)
                ? p.playedEver.slice() : played.map(c => c.name),
            cardsPlayedCount: (p.playedEver || played).length,
            typesPlayed: [...new Set(played.map(c => c.type).filter(Boolean))],
            peakOnField: p.peakOnField || {},
            peakSkills: p.peakSkills || {},
            peakPower: p.peakPower || 0,
            peakGold: p.peakGold || 0,
            goldStolen: p._goldStolen || 0,
            promisePrestige: p._promisePrestige || 0,
            freePotionActs: p._freePotionActs || [],
            missionsCompleted: (p.completedMissions || []).length,
            missionsFailed: (p.failedMissions || []).length,
            missionLog: p.missionLog || [],
            // filled by evaluate() from the player's record
            bestStreak: 0, dailyCrowns: 0, humanGames: 0,
            sideBUnlocked: 0, heroesPlayed: 0, heroesTotal: 0, gamesWithHero: 0,
            alm: null, deedsOutstanding: 1,
        };
    }

    // What the player's RECORD knows — the lifetime half of the snapshot.
    function fromRow(snap, row) {
        const r = row || {};
        const chars = r.chars || {};
        const heroes = ((window.FAVOR_DATA || {}).characters || []).filter(c => !c.earnedOnly);
        const sideB = heroes.filter(c =>
            c.altSlots && window.FLB && window.FLB.sideBUnlocked
            && window.FLB.sideBUnlocked(c.id)).length;
        snap.bestStreak = r.bestStreak || 0;
        snap.dailyCrowns = (r.champs || {}).gold || 0;
        snap.humanGames = ((r.deedStats || {}).humanGames || 0) + (snap.humans >= 2 ? 1 : 0);
        snap.heroesTotal = heroes.length;
        snap.heroesPlayed = heroes.filter(c => (chars[c.id] || {}).g > 0).length;
        snap.sideBUnlocked = sideB;
        snap.gamesWithHero = snap.characterId
            ? ((chars[snap.characterId] || {}).g || 0) : 0;
        try { snap.alm = window.FALM ? window.FALM.stats() : null; }
        catch (e) { snap.alm = null; }
        return snap;
    }

    // ── Evaluation (PURE) ────────────────────────────────────────────
    // The capstone (The Last Page) is tested LAST, against a set that
    // already includes everything earned in this very pass — so the deed
    // that completes the ledger and the capstone celebrate together.
    function evaluate(row, snap) {
        const have = { ...((row || {}).deeds || {}) };
        const defs = DEFS();
        const plain = defs.filter(d => !d.capstone);
        const caps = defs.filter(d => d.capstone);

        const earned = plain.filter(d => !have[d.id] && safeCheck(d, snap));
        earned.forEach(d => { have[d.id] = 1; });

        // Outstanding = every non-capstone deed not yet held, counted after
        // this pass's grants. Zero means the ledger is complete.
        const capSnap = { ...snap, deedsOutstanding: plain.filter(d => !have[d.id]).length };
        const capsEarned = caps.filter(d => !have[d.id] && safeCheck(d, capSnap));

        return { earned: earned.concat(capsEarned) };
    }

    function safeCheck(def, snap) {
        try { return !!def.check(snap); }
        catch (e) { console.warn('[FDEED] check failed:', def.id, e.message); return false; }
    }

    // ── Grant ────────────────────────────────────────────────────────
    // Mirrors the achievements' three layers: a serialized sync chain, a
    // per-account localStorage mirror, and the transaction's own guard.
    const mirrorKey = () => 'favorDeeds_' + window.FLB.uid();
    function claimedMirror() {
        try { return JSON.parse(localStorage.getItem(mirrorKey())) || {}; }
        catch (e) { return {}; }
    }
    function addClaimedMirror(ids) {
        try {
            const m = claimedMirror();
            ids.forEach(id => { m[id] = 1; });
            localStorage.setItem(mirrorKey(), JSON.stringify(m));
        } catch (e) { /* private mode — the row + txn guards still hold */ }
    }

    // ── The door's green mark ────────────────────────────────────────
    // Same language as the Almanac's: green means there is something new
    // behind this door. A count rather than a flag, and per-device, because
    // the glow says "you haven't looked at this yet on THIS screen".
    // FLB may not exist yet on a cold title screen, hence the guards.
    const newKey = () => 'favorDeedsNew_' + window.FLB.uid();
    function newCount() {
        try { return parseInt(localStorage.getItem(newKey()) || '0', 10) || 0; }
        catch (e) { return 0; }
    }
    function addNew(n) {
        if (!n) return;
        try { localStorage.setItem(newKey(), String(newCount() + n)); } catch (e) { /* cosmetic */ }
        refreshDoor();
    }
    function clearNew() {
        try { localStorage.removeItem(newKey()); } catch (e) { /* it just stays lit */ }
        refreshDoor();
    }
    function refreshDoor() {
        if (document.body) document.body.classList.toggle('deed-new', newCount() > 0);
    }

    let _syncChain = Promise.resolve();
    function sync(gameSnap, gameId) {
        const run = _syncChain.then(() => doSync(gameSnap, gameId));
        _syncChain = run.catch(() => {});
        return run;
    }

    async function doSync(gameSnap, gameId) {
        if (!window.FLB || !window.FLB.uid) return [];
        try {
            const row = await window.FLB.readRow();
            const rowPlus = { ...(row || {}),
                deeds: { ...claimedMirror(), ...((row || {}).deeds || {}) } };

            // The book travels with the account: pull the record's copy down
            // and union it into this device's before anything is judged, so a
            // player who collected on their phone is judged on the whole book.
            if (window.FALM && window.FALM.mergeBook && (row || {}).almanac) {
                try { window.FALM.mergeBook(row.almanac); } catch (e) { /* local wins */ }
            }

            const snap = fromRow(gameSnap, rowPlus);
            const { earned } = evaluate(rowPlus, snap);

            // The counter leg runs even with nothing earned — a game with
            // other people at the table still counts toward The Regulars.
            const countHuman = (snap.humans >= 2) && !!gameId;
            const book = (window.FALM && window.FALM.exportBook)
                ? window.FALM.exportBook() : null;
            if (!earned.length && !countHuman && !book) return [];

            const now = Date.now();
            const ids = earned.map(d => d.id);

            await window.FLB.mergeRow(cur => {
                const c = cur || {};
                const deeds = { ...(c.deeds || {}) };
                for (const d of earned) {
                    if (deeds[d.id]) continue;          // re-run of a committed txn
                    deeds[d.id] = now;
                }
                const stats = { ...(c.deedStats || {}) };
                // gameId guards the counter against a retried transaction
                // counting the same table twice.
                if (countHuman && stats.lastGame !== gameId) {
                    stats.humanGames = (stats.humanGames || 0) + 1;
                    stats.lastGame = gameId;
                }
                const next = { ...c, deeds, deedStats: stats };
                if (book) next.almanac = book;
                return next;
            });

            if (ids.length) addClaimedMirror(ids);
            if (earned.length) {
                addNew(earned.length);   // light the door
                celebrate(earned);
                maybeNag();
            }
            return earned;
        } catch (e) {
            console.warn('[FDEED] sync failed:', e && e.message);
            return [];
        }
    }

    // ── Celebration ──────────────────────────────────────────────────
    // Sequential — two overlays at once and the second dies to the click
    // that closes the first.
    async function celebrate(defs) {
        for (const d of defs) await showOne(d);
    }

    function showOne(def) {
        return new Promise((resolve) => {
            const ruin = !!def.ruin;
            const ov = document.createElement('div');
            ov.className = 'ach-pop deed-pop';
            ov.innerHTML = `
                <div class="ach-card deed-${def.rank} ${ruin ? 'ach-ruined' : ''}" role="dialog"
                     aria-label="${ruin ? 'A ruin remembered' : 'Deed earned'}">
                    <div class="ach-tier">${RANK_LABEL[def.rank] || def.rank}</div>
                    <div class="ach-seal"><span>★</span></div>
                    <div class="ach-kicker">${ruin ? 'A Ruin Remembered' : 'A Deed Recorded'}</div>
                    <h2 class="ach-name"></h2>
                    <p class="ach-desc"></p>
                    <button class="btn-royal primary ach-ok"><span>${ruin ? 'So Be It' : 'Very Well'}</span></button>
                </div>`;
            ov.querySelector('.ach-name').textContent = def.name;
            ov.querySelector('.ach-desc').textContent = def.desc;
            document.body.appendChild(ov);
            requestAnimationFrame(() => ov.classList.add('in'));
            playSting(ruin);

            const done = () => {
                ov.classList.remove('in');
                setTimeout(() => { ov.remove(); resolve(); }, 260);
            };
            ov.querySelector('.ach-ok').onclick = done;
            ov.onclick = (e) => { if (e.target === ov) done(); };
        });
    }

    // Synthesized, like the melee fanfare — no asset to ship, and it obeys
    // the Settings mixer. Gold rises; ruin cracks and tolls down.
    function playSting(ruin) {
        try {
            if (window.FSET && FSET.sfxVolume && FSET.sfxVolume() <= 0) return;
            const vol = (window.FSET && FSET.sfxVolume) ? FSET.sfxVolume() : 0.6;
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const a = new AC(), t0 = a.currentTime;
            if (ruin) {
                const nb = a.createBuffer(1, Math.floor(a.sampleRate * 0.1), a.sampleRate);
                const ch = nb.getChannelData(0);
                for (let i = 0; i < ch.length; i++) {
                    ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2);
                }
                const n = a.createBufferSource(); n.buffer = nb;
                const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
                const ng = a.createGain(); ng.gain.value = 0.5 * vol;
                n.connect(hp).connect(ng).connect(a.destination); n.start(t0);
                [[110, 0.04, 1.4], [82.4, 0.1, 1.6]].forEach(([f, dt, dur]) => {
                    const o = a.createOscillator(), g = a.createGain();
                    o.type = 'sine'; o.frequency.setValueAtTime(f, t0 + dt);
                    o.frequency.exponentialRampToValueAtTime(f * 0.5, t0 + dt + dur);
                    g.gain.setValueAtTime(0, t0 + dt);
                    g.gain.linearRampToValueAtTime(0.22 * vol, t0 + dt + 0.05);
                    g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + dur);
                    o.connect(g).connect(a.destination);
                    o.start(t0 + dt); o.stop(t0 + dt + dur + 0.1);
                });
            } else {
                [[523.25, 0, 0.34], [659.25, 0.09, 0.3], [783.99, 0.18, 0.3], [1046.5, 0.27, 0.62]]
                    .forEach(([f, dt, dur]) => {
                        const o = a.createOscillator(), g = a.createGain();
                        o.type = 'triangle'; o.frequency.value = f;
                        g.gain.setValueAtTime(0, t0 + dt);
                        g.gain.linearRampToValueAtTime(0.16 * vol, t0 + dt + 0.02);
                        g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + dur);
                        o.connect(g).connect(a.destination);
                        o.start(t0 + dt); o.stop(t0 + dt + dur + 0.05);
                    });
            }
            setTimeout(() => { try { a.close(); } catch (e) { /* done */ } }, 2600);
        } catch (e) { /* a silent trophy is still a trophy */ }
    }

    // ── "This court is unsaved" ──────────────────────────────────────
    // Shown after an unlock when nothing anchors this court to an account.
    // Dismiss means never again on this device (Skylar 8/3).
    function hasAccount() {
        try {
            const ids = (window.FLB.myIdentities && window.FLB.myIdentities()) || {};
            return Object.keys(ids).length > 0;
        } catch (e) { return false; }
    }
    function nagDismissed() {
        try { return localStorage.getItem(NAG_KEY) === '1'; } catch (e) { return false; }
    }
    function maybeNag() {
        if (hasAccount() || nagDismissed()) return;
        setTimeout(showNag, 400);   // let the ceremony clear the stage first
    }
    function showNag() {
        if (document.querySelector('.deed-nag')) return;
        // On iOS 1.0 there is no working sign-in door — Apple sign-in is
        // native and ships with the next app update — so the phone is
        // pointed at the Court Seal, which DOES work today (Skylar 8/3).
        const ios = !!(window.FLB && window.FLB.isShell && window.FLB.isShell());
        const body = ios
            ? 'You’ve earned a place in the book — but it lives only on this phone. The <b>Court Seal</b> can carry your court to another device — find it in your Profile under Account Sign-in.'
            : 'You’ve earned a place in the book — but it lives only on this device. <b>Sign in on your Profile</b> to seal your court, and your Almanac and deeds will follow you anywhere.';
        const ov = document.createElement('div');
        ov.className = 'deed-nag';
        ov.innerHTML = `
            <div class="nag-card" role="dialog" aria-label="Your unlocks are not saved">
                <div class="nag-glyph">📜</div>
                <div class="nag-title">This court is unsaved</div>
                <div class="nag-body">${body}</div>
                <div class="nag-actions">
                    <button class="btn-royal primary nag-ok"><span>Okay</span></button>
                    <button class="nag-dismiss">Dismiss<small>this message will no longer pop up</small></button>
                </div>
            </div>`;
        document.body.appendChild(ov);
        requestAnimationFrame(() => ov.classList.add('in'));
        const close = () => { ov.classList.remove('in'); setTimeout(() => ov.remove(), 240); };
        ov.querySelector('.nag-ok').onclick = close;
        ov.querySelector('.nag-dismiss').onclick = () => {
            try { localStorage.setItem(NAG_KEY, '1'); } catch (e) { /* it just asks again */ }
            close();
        };
        ov.onclick = (e) => { if (e.target === ov) close(); };
    }

    // ── The gallery, off the Profile ─────────────────────────────────
    // [letter, chapter title, short tab label, painted medallion]
    // The label stays under every medallion on purpose — the painting says
    // which chapter at a glance, the word says it for certain.
    const ICON_V = '?v=1';
    const CHAPTERS = [
        ['A', 'The Almanac',          'Almanac', 'assets/ui/deed-chap-a.png'],
        ['B', 'Rituals of the Hand',  'Rituals', 'assets/ui/deed-chap-b.png'],
        ['C', 'Ruin & Comedy',        'Ruin',    'assets/ui/deed-chap-c.png'],
        ['D', 'Mastery',              'Mastery', 'assets/ui/deed-chap-d.png'],
        ['E', 'Service to the Realm', 'Service', 'assets/ui/deed-chap-e.png'],
        ['F', 'Heroes & Boards',      'Heroes',  'assets/ui/deed-chap-f.png'],
        ['G', 'The Table',            'Table',   'assets/ui/deed-chap-g.png'],
        ['H', 'Sealed Deeds',         'Sealed',  'assets/ui/deed-chap-h.png'],
    ];

    // 'all' | a chapter letter | 'unearned'. Deliberately kept between opens:
    // a player hunting the last few wants Unearned still chosen next time.
    let curFilter = 'all';

    async function openGallery() {
        let ov = document.getElementById('deedGallery');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'deedGallery';
            ov.className = 'ach-gallery deed-gallery';
            document.body.appendChild(ov);
        }
        ov.innerHTML = '<div class="ach-inner"><div class="lb-loading">Unrolling the ledger…</div></div>';
        ov.classList.add('open');
        clearNew();          // the ledger has been read

        let row = {};
        try { row = (await window.FLB.readRow()) || {}; } catch (e) { /* all locked */ }
        const have = { ...claimedMirror(), ...(row.deeds || {}) };
        const defs = DEFS();
        const got = defs.filter(d => have[d.id]).length;

        // The shell. Everything here is static text or a number we computed —
        // no deed data reaches innerHTML; that all goes in as textContent below.
        const R = 24, CIRC = 2 * Math.PI * R;
        const pct = defs.length ? got / defs.length : 0;
        ov.innerHTML = `
            <div class="ach-inner">
                <button class="ach-x" aria-label="Close">✕</button>
                <div class="ach-head">
                    <div class="deed-progress">
                        <svg viewBox="0 0 54 54" width="54" height="54" aria-hidden="true">
                            <circle cx="27" cy="27" r="${R}" fill="none"
                                    stroke="rgba(201,168,76,.20)" stroke-width="4"/>
                            <circle cx="27" cy="27" r="${R}" fill="none" stroke="#c9a84c"
                                    stroke-width="4" stroke-linecap="round"
                                    stroke-dasharray="${CIRC}"
                                    stroke-dashoffset="${CIRC * (1 - pct)}"/>
                        </svg>
                        <b>${got}</b>
                    </div>
                    <div class="deed-heading">
                        <div class="ach-title">The Ledger of Deeds</div>
                        <div class="ach-sub">${got} of ${defs.length} recorded</div>
                    </div>
                </div>
                <div class="deed-tabs"></div>
                <div class="deed-page"></div>
            </div>`;

        const tabsEl = ov.querySelector('.deed-tabs');
        const pageEl = ov.querySelector('.deed-page');

        // `art` is either a painted medallion's path or a glyph to strike in
        // the ring — chapters get the first, All/Unearned the second.
        function makeTab(key, art, label, count, painted) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'deed-tab' + (curFilter === key ? ' cur' : '');
            b.title = label;
            b.setAttribute('aria-label', label);
            const a = document.createElement('span');
            a.className = 'deed-tab-art' + (painted ? ' painted' : '');
            if (painted) {
                const img = document.createElement('img');
                img.src = art + ICON_V;
                img.alt = '';
                a.appendChild(img);
            } else {
                a.textContent = art;
            }
            const l = document.createElement('span');
            l.className = 'deed-tab-lbl';
            l.textContent = label;
            const c = document.createElement('span');
            c.className = 'deed-tab-n';
            c.textContent = count;
            b.append(a, l, c);
            b.onclick = () => { curFilter = key; draw(); };
            return b;
        }

        function drawTabs() {
            tabsEl.innerHTML = '';
            tabsEl.appendChild(makeTab('all', '✦', 'All', got + '/' + defs.length));
            CHAPTERS.forEach(([L, , short, icon]) => {
                const mine = defs.filter(d => (d.num || '')[0] === L);
                if (!mine.length) return;
                const n = mine.filter(d => have[d.id]).length;
                tabsEl.appendChild(makeTab(L, icon || L, short, n + '/' + mine.length, !!icon));
            });
            tabsEl.appendChild(makeTab('unearned', '?', 'Unearned', String(defs.length - got)));
        }

        function drawPage() {
            pageEl.innerHTML = '';
            let shown = 0;
            CHAPTERS.forEach(([L, title]) => {
                if (curFilter !== 'all' && curFilter !== 'unearned' && curFilter !== L) return;
                const all = defs.filter(d => (d.num || '')[0] === L);
                if (!all.length) return;
                const n = all.filter(d => have[d.id]).length;
                const mine = curFilter === 'unearned' ? all.filter(d => !have[d.id]) : all;
                if (!mine.length) return;

                const head = document.createElement('div');
                head.className = 'deed-chap';
                const ht = document.createElement('span'); ht.textContent = title;
                const cnt = document.createElement('i'); cnt.textContent = n + ' of ' + all.length;
                head.append(ht, document.createElement('hr'), cnt);
                pageEl.appendChild(head);

                mine.forEach(d => {
                    const unlocked = !!have[d.id];
                    const hidden = d.secret && !unlocked;
                    const r = document.createElement('div');
                    r.className = 'deed-row ' + (unlocked ? 'got' : 'locked')
                                + (hidden ? ' secret' : '') + (d.ruin ? ' ruin' : '');

                    const tick = document.createElement('span');
                    tick.className = 'deed-tick';
                    // A ruin is recorded, never ticked in triumph.
                    tick.textContent = unlocked ? (d.ruin ? '✕' : '✓') : '';

                    const txt = document.createElement('span');
                    txt.className = 'deed-text';
                    const nm = document.createElement('b');
                    nm.textContent = hidden ? '———' : d.name;
                    const ds = document.createElement('i');
                    ds.textContent = hidden ? 'A secret, still unfound.' : d.desc;
                    txt.append(nm, ds);

                    const rk = document.createElement('span');
                    rk.className = 'deed-rank ' + d.rank;
                    rk.textContent = RANK_LABEL[d.rank] || d.rank;

                    r.append(tick, txt, rk);
                    pageEl.appendChild(r);
                    shown++;
                });
            });
            if (!shown) {
                const e = document.createElement('div');
                e.className = 'deed-empty';
                e.textContent = curFilter === 'unearned'
                    ? 'Nothing left unearned. The ledger is full.'
                    : 'No deeds in this chapter yet.';
                pageEl.appendChild(e);
            }
        }

        function draw() { drawTabs(); drawPage(); pageEl.scrollTop = 0; ov.classList.remove('deed-scrolled'); }
        draw();

        // On a phone the title bar and the tab rail eat more of the panel
        // than the entries do. Reading the ledger folds the title away; coming
        // back to the top brings it back. The threshold is a few pixels of
        // slack so a rubber-band bounce cannot flap it.
        pageEl.addEventListener('scroll', () => {
            ov.classList.toggle('deed-scrolled', pageEl.scrollTop > 12);
        }, { passive: true });

        ov.querySelector('.ach-x').onclick = closeGallery;
        ov.onclick = (e) => { if (e.target === ov) closeGallery(); };
    }

    function closeGallery() {
        const ov = document.getElementById('deedGallery');
        if (ov) ov.classList.remove('open');
    }

    window.FDEED = {
        sync, seatSnapshot, evaluate, openGallery, closeGallery, refreshDoor,
        defs: DEFS, _showNag: showNag, _celebrate: celebrate,
        // Lent to achievements.js so the two failure achievements toll with
        // the same crack as a deed ruin, rather than growing a second copy.
        _playSting: playSting,
        _newCount: newCount, _addNew: addNew,
    };

    // Light the door on boot if the last session left a deed unread.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', refreshDoor);
    } else {
        refreshDoor();
    }
})();
