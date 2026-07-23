/**
 * FAVOR — Almanac (FALM)
 *
 * The player's lifetime collection book: every card they have PLAYED onto
 * their own board and every mission they have COMPLETED — but only in games
 * they FINISHED. Plays land in a PENDING buffer at the engine's push moment
 * (a rival can destroy a played Weapon later; "you played it" must survive
 * that), and the buffer commits to the book only when the table reaches
 * scoring. Quit, restart, or abandon a game and its pending plays die with
 * it — the next fresh table wipes the buffer. Discards never count.
 *
 * The buffer PERSISTS in localStorage, not memory: a solo/skirmish table
 * survives a closed tab via the solo save (ui.js saveSoloCheckpoint), so a
 * resumed-and-finished game must still commit the plays made before the
 * reload. Lifecycle owners in ui.js:
 *   beginGame()  — every FRESH FavorGame construction (solo + mp starts;
 *                  resumeSoloSave deliberately does NOT call it)
 *   commitGame() — the scoring path, beside clearSoloSave()
 *
 * Storage, one pair per uid:
 *   favor_almanac_<uid>          = { cards:    { [name]: {n, first} },
 *                                    missions: { [name]: {n, first} } }
 *   favor_almanac_pending_<uid>  = { cards: { [name]: n }, missions: {...} }
 * Keyed by NAME, not id — ids are session-minted counters (cid()/mid());
 * the audited card name is the stable identity.
 *
 * Only local seat 0 records. mp.js rotates every client's own human to
 * local index 0, so in multiplayer each client writes only its own book.
 * The tools pages (howto.html, audit pages) load the engine WITHOUT this
 * file — every engine/ui hook is `window.FALM &&` guarded — so tutorial
 * and audit simulations never pollute the book.
 */
(function () {
    'use strict';

    // Same key + same mint as meta.js uid() — whichever module runs first
    // creates the id, the other reuses it.
    function uid() {
        let u = localStorage.getItem('favorUid');
        if (!u) {
            u = 'u' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
            localStorage.setItem('favorUid', u);
        }
        return u;
    }
    const KEY = () => 'favor_almanac_' + uid();
    const PENDING_KEY = () => 'favor_almanac_pending_' + uid();

    function loadJson(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) || fallback; }
        catch (e) { return fallback; }
    }
    function saveJson(key, d) {
        try { localStorage.setItem(key, JSON.stringify(d)); } catch (e) { /* full/blocked: play on */ }
    }
    function load() {
        const d = loadJson(KEY(), {});
        d.cards = d.cards || {};
        d.missions = d.missions || {};
        return d;
    }
    const loadPending = () => {
        const p = loadJson(PENDING_KEY(), {});
        p.cards = p.cards || {};
        p.missions = p.missions || {};
        return p;
    };
    function today() { return new Date().toISOString().slice(0, 10); }

    // ── Game lifecycle ───────────────────────────────────────────────
    function record(bucket, name) {
        if (!name) return;
        const p = loadPending();
        p[bucket][name] = (p[bucket][name] || 0) + 1;
        saveJson(PENDING_KEY(), p);
    }
    function recordCard(card) { record('cards', card && card.name); }
    function recordMission(mission) { record('missions', mission && mission.name); }

    // A fresh table — whatever an unfinished game left behind is forfeit.
    function beginGame() {
        try { localStorage.removeItem(PENDING_KEY()); } catch (e) { /* fine */ }
    }

    // The table reached scoring — the game's plays become permanent.
    function commitGame() {
        const p = loadPending();
        const d = load();
        ['cards', 'missions'].forEach(bucket => {
            Object.keys(p[bucket]).forEach(name => {
                const row = d[bucket][name];
                if (row) row.n += p[bucket][name];
                else d[bucket][name] = { n: p[bucket][name], first: today() };
            });
        });
        saveJson(KEY(), d);
        beginGame();   // buffer spent
    }

    // ── Rosters ──────────────────────────────────────────────────────
    // Medallions: acts wear their numeral, missions the scroll icon, and
    // each type a wax seal in its FRAME color — the frame IS the type in
    // FAVOR's own visual language (data/cards.js header spot colors), so
    // the seal teaches the same association the cards do. An MJ art pass
    // can replace any seal later: give the tab an `icon` path instead.
    const TYPE_ORDER = ['endeavor', 'potion', 'weapon', 'artifact', 'wisdom', 'adventure'];
    const TABS = [
        { key: 'act1', label: 'Act I', numeral: 'Ⅰ' },
        { key: 'act2', label: 'Act II', numeral: 'Ⅱ' },
        { key: 'act3', label: 'Act III', numeral: 'Ⅲ' },
        { key: 'endeavor',  label: 'Endeavors',  color: '#18598F' },
        { key: 'potion',    label: 'Potions',    color: '#8BB250' },
        { key: 'weapon',    label: 'Weapons',    color: '#585858' },
        { key: 'artifact',  label: 'Artifacts',  color: '#501559' },
        { key: 'wisdom',    label: 'Wisdom',     color: '#922B6E' },
        { key: 'adventure', label: 'Adventures', color: '#04674E' },
        { key: 'missions',  label: 'Missions', icon: 'assets/icons/mission.png' },
    ];

    // Deduped by name (the deck may hold copies). Mission Letters are
    // excluded everywhere — playing one discards it, so it can never be
    // "on your board".
    function roster(tabKey) {
        let src;
        if (tabKey === 'missions') {
            src = window.FAVOR_DATA.missions;
        } else if (tabKey.startsWith('act')) {
            const act = +tabKey.slice(3);
            src = window.FAVOR_DATA.cards.filter(c =>
                c.act === act && c.type !== 'mission_letter');
        } else {
            src = window.FAVOR_DATA.cards.filter(c => c.type === tabKey);
        }
        const seen = new Map();
        src.forEach(c => { if (!seen.has(c.name)) seen.set(c.name, c); });
        return [...seen.values()].sort((a, b) =>
            (a.act - b.act)
            || (TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type))
            || a.name.localeCompare(b.name));
    }
    const bucketFor = (tabKey, d) => tabKey === 'missions' ? d.missions : d.cards;
    const artPath = (entry, isMission) =>
        'assets/cards/' + (isMission ? 'missions/' : 'regular/') + entry.filename;
    const BACK_CARD = 'assets/cards/backs/Back Card 1_Brown1.jpg';
    const BACK_MISSION = 'assets/cards/backs/Back Card 2_White1.jpg';

    // ── Gallery ──────────────────────────────────────────────────────
    let curTab = 'act1';

    function tile(entry, isMission, got) {
        const t = document.createElement('div');
        t.className = 'alm-tile ' + (got ? 'got' : 'locked');
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = got ? entry.name : 'Undiscovered';
        img.src = got ? artPath(entry, isMission) : (isMission ? BACK_MISSION : BACK_CARD);
        t.appendChild(img);
        if (got) {
            t.title = entry.name + ' — first ' + (isMission ? 'completed' : 'played') + ' ' + got.first;
            if (got.n > 1) {
                const badge = document.createElement('span');
                badge.className = 'alm-count';
                badge.textContent = '×' + got.n;
                t.appendChild(badge);
            }
            t.onclick = () => {
                if (typeof zoomCard === 'function') zoomCard(artPath(entry, isMission));
            };
        } else {
            t.title = isMission ? 'Not yet completed' : 'Not yet played';
            const seal = document.createElement('span');
            seal.className = 'alm-seal';
            seal.textContent = '?';
            t.appendChild(seal);
        }
        return t;
    }

    function renderTab(ov, d) {
        const isMission = curTab === 'missions';
        const bucket = bucketFor(curTab, d);
        const grid = ov.querySelector('.alm-grid');
        grid.innerHTML = '';
        roster(curTab).forEach(entry =>
            grid.appendChild(tile(entry, isMission, bucket[entry.name])));
        grid.scrollTop = 0;

        ov.querySelectorAll('.alm-tab').forEach(btn => {
            const tab = btn.dataset.tab;
            btn.classList.toggle('cur', tab === curTab);
            const r = roster(tab);
            const b = bucketFor(tab, d);
            btn.querySelector('.alm-tab-n').textContent =
                r.filter(e => b[e.name]).length + '/' + r.length;
        });
    }

    function open() {
        const ov = document.getElementById('almGallery');
        if (!ov) return;
        const d = load();

        const cardRoster = roster('act1').concat(roster('act2'), roster('act3'));
        const misRoster = roster('missions');
        const cardsGot = cardRoster.filter(e => d.cards[e.name]).length;
        const misGot = misRoster.filter(e => d.missions[e.name]).length;

        ov.innerHTML = `
            <div class="alm-inner">
                <div class="alm-head">
                    <div class="alm-title">Royal Almanac</div>
                    <div class="alm-sub"></div>
                    <button class="alm-x" aria-label="Close">✕</button>
                </div>
                <div class="alm-tabs"></div>
                <div class="alm-grid"></div>
            </div>`;
        ov.querySelector('.alm-sub').textContent =
            cardsGot + ' of ' + cardRoster.length + ' cards played · ' +
            misGot + ' of ' + misRoster.length + ' missions completed';

        const tabs = ov.querySelector('.alm-tabs');
        TABS.forEach(t => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'alm-tab';
            btn.dataset.tab = t.key;
            btn.title = t.label;
            btn.setAttribute('aria-label', t.label);

            const art = document.createElement('span');
            art.className = 'alm-tab-art';
            if (t.numeral) {
                art.classList.add('numeral');
                art.textContent = t.numeral;
            } else if (t.icon) {
                const img = document.createElement('img');
                img.src = t.icon;
                img.alt = '';
                img.classList.add('icon');
                art.appendChild(img);
            } else {
                art.classList.add('seal');
                art.style.setProperty('--seal', t.color);
            }
            const lbl = document.createElement('span');
            lbl.className = 'alm-tab-lbl';
            lbl.textContent = t.label;
            const n = document.createElement('span');
            n.className = 'alm-tab-n';
            btn.append(art, lbl, n);
            btn.onclick = () => { curTab = t.key; renderTab(ov, d); };
            tabs.appendChild(btn);
        });

        ov.querySelector('.alm-x').onclick = close;
        ov.onclick = (e) => { if (e.target === ov) close(); };
        renderTab(ov, d);
        ov.classList.add('open');
    }

    function close() {
        const ov = document.getElementById('almGallery');
        if (ov) ov.classList.remove('open');
    }

    window.FALM = { recordCard, recordMission, beginGame, commitGame, open, close };
})();
