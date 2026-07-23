/**
 * FAVOR — Almanac (FALM)
 *
 * The player's lifetime collection book: every card they have PLAYED onto
 * their own board and every mission they have COMPLETED, across all games.
 * Discards never count. Recording happens live at the engine's push moment
 * (not from a post-game snapshot) because a rival can destroy a played
 * Weapon later in the game — "you played it" must survive that.
 *
 * Persistence is local-only for now, one blob per uid:
 *   localStorage['favor_almanac_<uid>'] = {
 *       cards:    { [cardName]:    { n: <times played>,   first: 'YYYY-MM-DD' } },
 *       missions: { [missionName]: { n: <times completed>, first: 'YYYY-MM-DD' } },
 *   }
 * Keyed by NAME, not id — ids are session-minted counters (cid()/mid());
 * the audited card name is the stable identity.
 *
 * Only local seat 0 records. mp.js rotates every client's own human to
 * local index 0, so in multiplayer each client writes only its own book.
 * The tools pages (howto.html, audit pages) load the engine WITHOUT this
 * file — every engine hook is `window.FALM &&` guarded — so tutorial and
 * audit simulations never pollute the book.
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

    function load() {
        try {
            const d = JSON.parse(localStorage.getItem(KEY())) || {};
            d.cards = d.cards || {};
            d.missions = d.missions || {};
            return d;
        } catch (e) { return { cards: {}, missions: {} }; }
    }
    function save(d) {
        try { localStorage.setItem(KEY(), JSON.stringify(d)); } catch (e) { /* full/blocked: play on */ }
    }
    function today() { return new Date().toISOString().slice(0, 10); }

    function record(bucket, name) {
        if (!name) return;
        const d = load();
        const row = d[bucket][name];
        if (row) row.n += 1;
        else d[bucket][name] = { n: 1, first: today() };
        save(d);
    }

    // ── Engine entry points ──────────────────────────────────────────
    function recordCard(card) { record('cards', card && card.name); }
    function recordMission(mission) { record('missions', mission && mission.name); }

    // ── Rosters ──────────────────────────────────────────────────────
    const TABS = [
        { key: 'endeavor',  label: 'Endeavors' },
        { key: 'potion',    label: 'Potions' },
        { key: 'weapon',    label: 'Weapons' },
        { key: 'artifact',  label: 'Artifacts' },
        { key: 'wisdom',    label: 'Wisdom' },
        { key: 'adventure', label: 'Adventures' },
        { key: 'missions',  label: 'Missions' },
    ];

    // Deduped by name (the deck may hold copies), sorted act then name.
    function roster(tabKey) {
        const src = tabKey === 'missions'
            ? window.FAVOR_DATA.missions
            : window.FAVOR_DATA.cards.filter(c => c.type === tabKey);
        const seen = new Map();
        src.forEach(c => { if (!seen.has(c.name)) seen.set(c.name, c); });
        return [...seen.values()].sort((a, b) =>
            (a.act - b.act) || a.name.localeCompare(b.name));
    }
    const artPath = (entry, isMission) =>
        'assets/cards/' + (isMission ? 'missions/' : 'regular/') + entry.filename;
    const BACK_CARD = 'assets/cards/backs/Back Card 1_Brown1.jpg';
    const BACK_MISSION = 'assets/cards/backs/Back Card 2_White1.jpg';

    // ── Gallery ──────────────────────────────────────────────────────
    let curTab = 'endeavor';

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
        const bucket = isMission ? d.missions : d.cards;
        const list = roster(curTab);
        const grid = ov.querySelector('.alm-grid');
        grid.innerHTML = '';
        list.forEach(entry => grid.appendChild(tile(entry, isMission, bucket[entry.name])));
        grid.scrollTop = 0;

        ov.querySelectorAll('.alm-tab').forEach(btn => {
            const tab = btn.dataset.tab;
            btn.classList.toggle('cur', tab === curTab);
            const r = roster(tab);
            const b = tab === 'missions' ? d.missions : d.cards;
            btn.querySelector('.alm-tab-n').textContent =
                r.filter(e => b[e.name]).length + '/' + r.length;
        });
    }

    function open() {
        const ov = document.getElementById('almGallery');
        if (!ov) return;
        const d = load();

        const cardRoster = TABS.slice(0, -1).flatMap(t => roster(t.key));
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
            const lbl = document.createElement('span');
            lbl.textContent = t.label;
            const n = document.createElement('span');
            n.className = 'alm-tab-n';
            btn.append(lbl, n);
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

    window.FALM = { recordCard, recordMission, open, close };
})();
