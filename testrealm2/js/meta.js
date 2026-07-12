// ═══════════════════════════════════════════════════════════════════
// FAVOR meta layer — menu identity, leaderboard, Daily Champions.
//
// Backend: Firebase RTDB (project testroom-75200), EVERYTHING namespaced
// under favor/*:
//   favor/players/{uid}   { name, rating, stars, champs{gold,silver,bronze},
//                           msgQueue{pushId:{type,dateKey,place,stars}},
//                           created, lastSeen }
//   favor/players/persona_*  the five PERMANENT persona rivals (see
//                            PERSONAS below) — rating-only citizens,
//                            seeded once, NEVER deleted.
//   favor/daily/{dateKey}/scores/{uid}   { name, best, at }
//   favor/settled/{dateKey}              { at, by, podium[] }
//
// Daily windows roll at 10:00 PM America/New_York: a moment's dateKey is
// its ET calendar date, bumped to tomorrow once the clock passes 22:00 —
// so "today's board" always pays out at 10 PM tonight. Settlement is
// LAZY and IDEMPOTENT: the first client to load after a boundary claims
// each unsettled past key via a transaction on favor/settled/{key} and
// only the claimant writes stars/champs/msgQueue (exactly once; ties
// break by earliest score). A scheduled job (GitHub Actions cron) is the
// hardening step so 10 PM pays out even if nobody is online.
//
// If Firebase is unreachable (offline, blocked referrer) the SAME UI
// runs on a localStorage adapter — solo standings, loudly labeled
// "LOCAL STANDINGS" in the leaderboard header so it never masquerades
// as the real board. Scores are client-authoritative (same posture as
// Nation).
// ═══════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    const FB_CONFIG = {
        apiKey: "AIzaSyDzYoQqXoOu4uj2wzTwSn6d_gAlo6e8WSI",
        authDomain: "testroom-75200.firebaseapp.com",
        databaseURL: "https://testroom-75200-default-rtdb.firebaseio.com",
        projectId: "testroom-75200",
        storageBucket: "testroom-75200.firebasestorage.app",
        messagingSenderId: "711812846396",
        appId: "1:711812846396:web:08e2375f257205483f8439"
    };
    const NS = 'favor';
    const STAR_AWARDS = [50, 25, 10];
    const PLACE_WORD = ['1st', '2nd', '3rd'];
    const CHAMP_KEYS = ['gold', 'silver', 'bronze'];

    // ── Store economy (defaults for Wyatt to veto) ───────────────────
    // Every finished game pays Stars by finish position; Daily Champions
    // (50/25/10 above) stays the nightly jackpot on top of these.
    const STORE_PRICE = 100;
    const FREE_CHAR_COUNT = 5;   // data/characters.js order: first five are free

    function gameStars(place, count) {
        if (place === 0) return 10;
        if (place === 1) return 6;
        if (place === 2) return 4;
        return 2;
    }

    // ── Persona rivals (defaults for Wyatt to veto) ──────────────────
    // Five PERMANENT leaderboard citizens — real favor/players rows with
    // fixed persona_* uids, seeded ONCE at staggered ratings and NEVER
    // deleted (their history is the board's history). They sit at ~2 in 3
    // tables, play sharper than the generic bots, and post real rating
    // deltas per game — but never touch the daily board or Stars: the
    // nightly crowns stay a human race. Names deliberately avoid the
    // royal-anon generator's Title×Noun space so no player collides.
    const PERSONAS = [
        { key: 'ashcroft',   uid: 'persona_ashcroft',   name: 'Lord Ashcroft',   hero: 'knight',    seedRating: 240, strong: ['power', 'survival'] },
        { key: 'balthazar',  uid: 'persona_balthazar',  name: 'Count Balthazar', hero: 'scientist', seedRating: 185, strong: ['alchemy', 'knowledge'] },
        { key: 'vespertine', uid: 'persona_vespertine', name: 'Lady Vespertine', hero: 'duchess',   seedRating: 140, strong: ['knowledge', 'prospecting'] },
        { key: 'rosalind',   uid: 'persona_rosalind',   name: 'Dame Rosalind',   hero: 'fisherman', seedRating: 95,  strong: ['survival', 'knowledge'] },
        { key: 'thorne',     uid: 'persona_thorne',     name: 'Baron Thorne',    hero: 'bandit',    seedRating: 60,  strong: ['power', 'prospecting'] },
    ];

    // Small gold crown — inline SVG so the champion mark is OURS (royal,
    // never an emoji from somebody else's set).
    const CROWN_SVG = '<svg class="crown-ico" viewBox="0 0 24 16" aria-hidden="true">'
        + '<path d="M2 14 L1 4 L7 8 L12 1 L17 8 L23 4 L22 14 Z" fill="#e8c34b" stroke="#8a6a1f" stroke-width="1"/>'
        + '<rect x="2" y="14" width="20" height="2" fill="#c9a84c"/></svg>';

    // ── Identity ─────────────────────────────────────────────────────

    function uid() {
        let u = localStorage.getItem('favorUid');
        if (!u) {
            u = 'u' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
            localStorage.setItem('favorUid', u);
        }
        return u;
    }

    const NAME_TITLES = ['Duke', 'Duchess', 'Baron', 'Baroness', 'Count', 'Countess',
        'Sir', 'Dame', 'Lord', 'Lady', 'Squire', 'Marquis', 'Viscount', 'Earl'];
    const NAME_NOUNS = ['Marmalade', 'Pickle', 'Turnip', 'Biscuit', 'Waffles', 'Plum',
        'Custard', 'Radish', 'Crumpet', 'Parsnip', 'Gooseberry', 'Snapdragon',
        'Marzipan', 'Pumpernickel', 'Quince', 'Butterscotch', 'Trifle', 'Fig',
        'Clementine', 'Bramble', 'Chestnut', 'Damson'];

    function generateName() {
        const t = NAME_TITLES[Math.floor(Math.random() * NAME_TITLES.length)];
        const n = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
        return `${t} ${n}`;
    }

    function myName() {
        let n = localStorage.getItem('favorName');
        if (!n) { n = generateName(); localStorage.setItem('favorName', n); }
        return n;
    }

    // ── Daily windows (10 PM America/New_York) ───────────────────────

    function etParts(d = new Date()) {
        const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York', hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit'
        });
        const p = {};
        fmt.formatToParts(d).forEach(x => { p[x.type] = x.value; });
        return { y: p.year, m: p.month, d: p.day, h: parseInt(p.hour, 10) % 24 };
    }

    function currentDateKey(now = new Date()) {
        const p = etParts(now);
        if (p.h >= 22) {
            // Past tonight's boundary — we're playing on tomorrow's board.
            const dt = new Date(Date.UTC(+p.y, +p.m - 1, +p.d));
            dt.setUTCDate(dt.getUTCDate() + 1);
            return dt.toISOString().slice(0, 10);
        }
        return `${p.y}-${p.m}-${p.d}`;
    }

    // ── Rating points (deterministic, per finished game vs the table) ──

    function ratingDelta(place, count) {
        if (place === 0) return 25;          // the throne
        if (place === 1) return 10;          // runner-up
        if (place === count - 1) return -10; // last
        return 0;
    }

    // ═══ Backends — one interface, Firebase or localStorage ══════════

    let fdb = null;          // firebase database handle when live
    let mode = 'connecting'; // 'firebase' | 'local' | 'connecting'

    // ---- localStorage adapter (same shapes as the RTDB tree) ----
    const LOCAL_KEY = 'favorLB';
    function localTree() {
        try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; }
        catch (e) { return {}; }
    }
    function localSave(t) { localStorage.setItem(LOCAL_KEY, JSON.stringify(t)); }
    function localGet(path) {
        let n = localTree();
        for (const part of path.split('/')) { if (n == null) return null; n = n[part]; }
        return n == null ? null : n;
    }
    function localSet(path, val) {
        const t = localTree();
        const parts = path.split('/');
        let n = t;
        for (let i = 0; i < parts.length - 1; i++) {
            if (typeof n[parts[i]] !== 'object' || n[parts[i]] == null) n[parts[i]] = {};
            n = n[parts[i]];
        }
        if (val == null) delete n[parts[parts.length - 1]];
        else n[parts[parts.length - 1]] = val;
        localSave(t);
    }

    async function dbGet(path) {
        if (mode === 'firebase') {
            const s = await fdb.ref(`${NS}/${path}`).get();
            return s.exists() ? s.val() : null;
        }
        return localGet(path);
    }
    async function dbSet(path, val) {
        if (mode === 'firebase') return fdb.ref(`${NS}/${path}`).set(val);
        localSet(path, val);
    }
    async function dbUpdate(path, val) {
        if (mode === 'firebase') return fdb.ref(`${NS}/${path}`).update(val);
        Object.entries(val).forEach(([k, v]) => localSet(`${path}/${k}`, v));
    }
    async function dbPush(path, val) {
        if (mode === 'firebase') return fdb.ref(`${NS}/${path}`).push(val);
        localSet(`${path}/m${Date.now()}${Math.floor(Math.random() * 1e4)}`, val);
    }
    // Transaction: firebase native; local = read-modify-write (single client).
    async function dbTxn(path, fn) {
        if (mode === 'firebase') {
            const res = await fdb.ref(`${NS}/${path}`).transaction(fn);
            return { committed: res.committed, value: res.snapshot ? res.snapshot.val() : null };
        }
        const next = fn(localGet(path));
        if (next === undefined) return { committed: false, value: localGet(path) };
        localSet(path, next);
        return { committed: true, value: next };
    }

    async function connect() {
        try {
            if (!window.firebase || !firebase.initializeApp) throw new Error('firebase sdk absent');
            if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FB_CONFIG);
            fdb = firebase.database();
            // Prove we can actually read through the wire before trusting it.
            mode = 'firebase';
            await Promise.race([
                dbGet(`players/${uid()}/name`),
                new Promise((_, rej) => setTimeout(() => rej(new Error('fb timeout')), 6000)),
            ]);
        } catch (e) {
            mode = 'local';
            console.warn('[FAVOR meta] Firebase unreachable — LOCAL standings only:', e.message);
        }
        return mode;
    }

    // ═══ Player record ═══════════════════════════════════════════════
    // LAZY: nobody joins the board just by loading the page — the record
    // materializes on the first posted result (or an explicit rename).
    // Until then the chip runs on the local name with rating 0.

    async function readPlayer() {
        const me = await dbGet(`players/${uid()}`);
        if (me && me.name) localStorage.setItem('favorName', me.name);
        if (me && me.owned) mirrorOwned(me.owned);
        return me;
    }

    async function rename(newName) {
        newName = (newName || '').trim().slice(0, 24);
        if (newName.length < 3) return false;
        localStorage.setItem('favorName', newName);
        await dbUpdate(`players/${uid()}`, { name: newName });
        return true;
    }

    // ═══ Table seed — one leaderboard read for game start ════════════
    // Powers the rated Emblem start, persona seating, and the rank-1 boon.
    // Kicked off at boot so confirmCharacter's await is usually instant;
    // the game start races it against 1200ms and falls back to the classic
    // seat-0 start when offline or slow. Refreshed after each posted game
    // so a player who just took #1 gets tomorrow's dues today.

    let _tableSeedP = null;

    function tableSeed() {
        if (_tableSeedP) return _tableSeedP;
        _tableSeedP = (async () => {
            // boot() may still be racing the wire — give it a beat before
            // declaring LOCAL (connect() itself times out at 6s; the game
            // start's own 1200ms race caps what anyone actually waits).
            for (let i = 0; i < 20 && mode === 'connecting'; i++) {
                await new Promise(r => setTimeout(r, 100));
            }
            if (mode !== 'firebase') return null;
            const players = await dbGet('players') || {};
            // EXACTLY the list the all-time tab renders — rows[0] is the
            // boon's rank 1, nothing else ever is.
            const rows = Object.entries(players)
                .filter(([, p]) => p && p.name)
                .map(([u, p]) => ({ uid: u, name: p.name, score: p.rating || 0 }))
                .sort((a, b) => b.score - a.score);
            const me = players[uid()] || null;
            return {
                myRow: me ? { uid: uid(), rating: me.rating || 0 } : null,
                topRow: rows[0] || null,
                personas: PERSONAS.map(p => ({
                    ...p,
                    rating: players[p.uid] ? (players[p.uid].rating || 0) : p.seedRating,
                })),
            };
        })().catch(() => null);
        return _tableSeedP;
    }

    // ═══ Posting a finished game ═════════════════════════════════════
    // Called from showScoring() with the sorted score rows. YOUR result
    // posts in full; seated persona rivals post rating-only deltas to
    // their permanent rows. Generic bots stay off the board entirely.

    async function postGameResult(scores, personaPlaces) {
        try {
            const place = scores.findIndex(s => s.name === 'You');
            if (place < 0) return;
            const mine = scores[place];
            const delta = ratingDelta(place, scores.length);
            const starsWon = gameStars(place, scores.length);
            const won = place === 0;
            const myPower = Math.max(0, Math.round(mine.power || 0));

            // ONE whole-row transaction: rating + Stars + lifetime Power +
            // wins/games/streak + identity land together or retry together
            // (the old three-txn chain could drop a leg on tab close, and
            // a racing Mint delivery is safe — the txn re-runs on conflict).
            // First result still materializes the record (lazy join).
            await dbTxn(`players/${uid()}`, p => {
                const cur = p || {};
                const streak = won ? (cur.streak || 0) + 1 : 0;
                return {
                    ...cur,
                    name: myName(),
                    lastSeen: Date.now(),
                    avatar: cur.avatar || myAvatar() || null,
                    rating: Math.max(0, (cur.rating || 0) + delta),
                    stars: (cur.stars || 0) + starsWon,
                    power: (cur.power || 0) + myPower,
                    games: (cur.games || 0) + 1,
                    wins: (cur.wins || 0) + (won ? 1 : 0),
                    streak,
                    bestStreak: Math.max(cur.bestStreak || 0, streak),
                };
            });

            // Daily board: best single-game Favor score in this window.
            const key = currentDateKey();
            await dbTxn(`daily/${key}/scores/${uid()}`, cur => {
                if (cur && cur.best >= mine.finalScore) return cur;
                return { name: myName(), best: mine.finalScore, at: Date.now() };
            });
            renderProfileChip();
        } catch (e) {
            console.warn('[FAVOR meta] post failed:', e.message);
        } finally {
            // Seated personas: their placements are as real as yours —
            // one whole-row txn each on their PERMANENT rows (never delete).
            // No daily post, no Stars: the nightly crowns stay a human race.
            // A row missing its rating starts from the persona's seed value.
            for (const pp of (personaPlaces || [])) {
                try {
                    const seedR = (PERSONAS.find(x => x.uid === pp.uid) || {}).seedRating || 0;
                    const pDelta = ratingDelta(pp.place, scores.length);
                    await dbTxn(`players/${pp.uid}`, p => {
                        const cur = p || {};
                        const base = cur.rating == null ? seedR : cur.rating;
                        return {
                            ...cur,
                            name: pp.name, lastSeen: Date.now(), persona: true,
                            rating: Math.max(0, base + pDelta),
                            power: (cur.power || 0) + Math.max(0, Math.round(pp.power || 0)),
                            games: (cur.games || 0) + 1,
                            wins: (cur.wins || 0) + (pp.place === 0 ? 1 : 0),
                        };
                    });
                } catch (e) {
                    console.warn('[FAVOR meta] persona post failed:', e.message);
                }
            }
            // Ratings moved — the NEXT game reads a fresh seed.
            _tableSeedP = null;
        }
    }

    // ═══ Daily Champions — lazy idempotent settlement ════════════════

    function podiumSort(scores) {
        return Object.entries(scores || {})
            .map(([u, s]) => ({ uid: u, name: s.name, best: s.best, at: s.at || 0 }))
            .sort((a, b) => (b.best - a.best) || (a.at - b.at));   // ties → earliest
    }

    async function settleDue() {
        try {
            const cur = currentDateKey();
            const days = await dbGet('daily');
            if (!days) return;
            for (const key of Object.keys(days).sort()) {
                if (key >= cur) continue;   // window still open
                const claim = await dbTxn(`settled/${key}`, existing => {
                    if (existing) return;                       // already settled — abort
                    return { at: Date.now(), by: uid() };       // claim it
                });
                if (!claim.committed || !claim.value || claim.value.by !== uid()) continue;

                const podium = podiumSort((days[key] || {}).scores).slice(0, 3);
                for (let i = 0; i < podium.length; i++) {
                    const p = podium[i];
                    await dbTxn(`players/${p.uid}/stars`, s => (s || 0) + STAR_AWARDS[i]);
                    await dbTxn(`players/${p.uid}/champs/${CHAMP_KEYS[i]}`, c => (c || 0) + 1);
                    await dbPush(`players/${p.uid}/msgQueue`, {
                        type: 'daily_champion', dateKey: key, place: i + 1, stars: STAR_AWARDS[i],
                    });
                }
                await dbUpdate(`settled/${key}`, {
                    podium: podium.map((p, i) => ({ uid: p.uid, name: p.name, best: p.best, stars: STAR_AWARDS[i] })),
                });
            }
        } catch (e) {
            console.warn('[FAVOR meta] settle failed:', e.message);
        }
    }

    // Congratulations queued for this player — royal overlay on arrival.
    // Returns how many were shown (the star watcher uses that to avoid
    // celebrating the same purchase twice).
    async function drainMsgs() {
        let shown = 0;
        try {
            const msgs = await dbGet(`players/${uid()}/msgQueue`);
            if (!msgs) return 0;
            const entries = Object.entries(msgs);
            for (const [k, m] of entries) {
                if (m && m.type === 'daily_champion') { await showChampOverlay(m); shown++; }
                else if (m && m.type === 'star_purchase') {
                    // The Mint delivered (possibly while this tab was away):
                    // the pending watch is settled, whoever was running it.
                    localStorage.removeItem('favorPendingStars');
                    if (_starsWatch) { clearTimeout(_starsWatch.timer); _starsWatch = null; }
                    _me = await dbGet(`players/${uid()}`) || _me;
                    renderStore();
                    await showStarsCelebration(m.stars);
                    shown++;
                }
                await dbSet(`players/${uid()}/msgQueue/${k}`, null);
            }
            renderProfileChip();
        } catch (e) { /* non-fatal */ }
        return shown;
    }

    function showChampOverlay(m) {
        return new Promise(resolve => {
            const ov = document.getElementById('champOverlay');
            const first = m.place === 1;
            document.getElementById('champTitle').textContent = first
                ? 'You Placed 1st — You are the Daily Champion!'
                : `You Placed ${PLACE_WORD[m.place - 1]} on the Daily Board`;
            document.getElementById('champSub').innerHTML =
                `${first ? CROWN_SVG + ' ' : ''}${m.stars} Stars earned · ${m.dateKey}`;
            ov.classList.add('active');
            const done = () => { ov.classList.remove('active'); resolve(); };
            ov.onclick = done;
            document.getElementById('champBtn').onclick = (e) => { e.stopPropagation(); done(); };
        });
    }

    // ═══ Menu UI — profile chip, profile panel, leaderboard ══════════

    let _me = null;

    // Synchronous view of the last-read player record — the victory screen
    // snapshots this BEFORE posting so its deltas measure THIS game.
    function snapshot() {
        const p = _me || {};
        return { rating: p.rating || 0, stars: p.stars || 0 };
    }

    // ── Avatars — a chosen crest that rides the chip, the boards and the
    // table. Starter set = the ten character paintings (round-cropped like
    // the rival rail); stored at players/{uid}/avatar + a local mirror so
    // every surface paints instantly.
    function myAvatar() {
        return localStorage.getItem('favorAvatar') || (_me && _me.avatar) || null;
    }
    function avatarFile(id) {
        const c = ((window.FAVOR_DATA || {}).characters || []).find(x => x.id === id);
        return c ? `assets/characters/${c.filename}` : null;
    }
    function avatarDisc(id, cls) {
        const f = avatarFile(id);
        return f
            ? `<span class="av-disc ${cls || ''}"><img src="${f}" alt=""></span>`
            : `<span class="av-disc av-empty ${cls || ''}"><img src="assets/icons/favor.png" alt=""></span>`;
    }
    async function setAvatar(id) {
        if (!avatarFile(id)) return;
        localStorage.setItem('favorAvatar', id);
        _me = { ...(_me || {}), avatar: id };
        try { await dbUpdate(`players/${uid()}`, { avatar: id }); } catch (e) { /* mirror holds */ }
        renderProfileChip();
        if (document.getElementById('profilePanel').classList.contains('active')) openProfile();
    }

    async function renderProfileChip() {
        const chip = document.getElementById('profileChip');
        if (!chip) return;
        _me = await dbGet(`players/${uid()}`) || _me;
        if (_me && _me.avatar && !localStorage.getItem('favorAvatar')) {
            localStorage.setItem('favorAvatar', _me.avatar);   // heal the mirror
        }
        const gold = (_me && _me.champs && _me.champs.gold) || 0;
        chip.innerHTML = `
            ${avatarDisc(myAvatar(), 'pc-av')}
            <span class="pc-name">${myName()}</span>
            <span class="pc-rating" title="Rating">${(_me && _me.rating) || 0}</span>
            ${gold > 0 ? `<span class="pc-crowns" title="Daily Championships">${CROWN_SVG}${gold}</span>` : ''}
        `;
    }

    function openProfile() {
        const p = _me || { rating: 0, stars: 0, champs: {} };
        const ch = p.champs || {};
        const chars = ((window.FAVOR_DATA || {}).characters || []);
        document.getElementById('profileBody').innerHTML = `
            <div class="pf-row pf-namerow">
                ${avatarDisc(myAvatar(), 'pf-av-current')}
                <input id="pfName" maxlength="24" value="${myName().replace(/"/g, '&quot;')}">
                <button class="btn-royal" id="pfSave"><span>Save</span></button>
            </div>
            <div class="pf-avatars" title="Choose your crest">${chars.map(c => `
                <button class="pf-av${myAvatar() === c.id ? ' on' : ''}" data-av="${c.id}"
                    onclick="FLB.setAvatar('${c.id}')" title="${c.name}">
                    <img src="assets/characters/${c.filename}" alt="${c.name}">
                </button>`).join('')}
            </div>
            <div class="pf-row"><span class="pf-label">Rating</span><b>${p.rating || 0}</b></div>
            <div class="pf-row"><span class="pf-label">Stars</span><b>★ ${p.stars || 0}</b></div>
            <div class="pf-row"><span class="pf-label">Lifetime Power</span><b>⚔ ${p.power || 0}</b></div>
            <div class="pf-row"><span class="pf-label">Record</span>
                <b>${p.wins || 0} W · ${p.games || 0} played${(p.bestStreak || 0) > 1 ? ` · best streak ${p.bestStreak}` : ''}</b></div>
            <div class="pf-row"><span class="pf-label">Daily Championships</span>
                <b class="pf-champs">${CROWN_SVG} ${ch.gold || 0} · 2nd ${ch.silver || 0} · 3rd ${ch.bronze || 0}</b></div>
            <div class="pf-note">Champions are crowned nightly at 10 PM Eastern.${mode === 'local' ? '<br><b class="pf-local">LOCAL PROFILE — leaderboard offline</b>' : ''}</div>
        `;
        document.getElementById('pfSave').onclick = async () => {
            const okd = await rename(document.getElementById('pfName').value);
            if (okd) { renderProfileChip(); closeProfile(); }
            else document.getElementById('pfName').classList.add('bad');
        };
        document.getElementById('profilePanel').classList.add('active');
    }
    function closeProfile() { document.getElementById('profilePanel').classList.remove('active'); }

    // Three boards, one renderer: All-Time (rating), Power (lifetime ⚔,
    // accumulated every game), Daily (best single-game Favor). Top three
    // wear medals, every row wears its player's crest, YOUR row glows —
    // and if you're beyond the visible fifty, your true rank rides a
    // separated row at the bottom (Nation is the quality bar).
    const LB_EMPTY = {
        alltime: 'No champions yet — the realm awaits its first.',
        power: 'No power yet forged — play a game and the ledger begins.',
        daily: 'No champions yet — the day awaits its first.',
    };

    function lbRowHtml(r, rank, tab, opts) {
        const me = r.uid === uid();
        const medal = rank <= 3
            ? `<span class="lb-medal m${rank}">${rank}</span>`
            : `<span class="lb-rank">${rank}</span>`;
        const crowns = r.gold > 0 ? `<span class="lb-crowns">${CROWN_SVG}${r.gold}</span>` : '';
        const sub = tab !== 'daily' && r.games
            ? `<span class="lb-sub">${r.wins || 0} W · ${r.games} G</span>` : '';
        const score = tab === 'power'
            ? `<img class="lb-ico" src="assets/icons/power.png" alt="">${(r.score || 0).toLocaleString()}`
            : tab === 'daily'
                ? `<img class="lb-ico" src="assets/icons/favor.png" alt="">${r.score}`
                : `✦ ${r.score}`;
        return `
            <div class="lb-row${me ? ' me' : ''}${rank <= 3 ? ` podium p${rank}` : ''}${opts && opts.appendix ? ' appendix' : ''}" style="--li:${opts ? opts.idx : 0}">
                ${medal}
                ${avatarDisc(r.avatar, 'lb-av')}
                <span class="lb-name">${r.name || 'Unknown Noble'}${crowns}${me ? '<span class="lb-you">You</span>' : ''}</span>
                ${sub}
                <b class="lb-score">${score}</b>
            </div>`;
    }

    async function openLeaderboard(tab = 'alltime') {
        const panel = document.getElementById('lbPanel');
        panel.classList.add('active');
        document.querySelectorAll('.lb-tab').forEach(t =>
            t.classList.toggle('on', t.dataset.tab === tab));
        const body = document.getElementById('lbBody');
        body.innerHTML = '<div class="lb-loading">Consulting the heralds…</div>';
        document.getElementById('lbLocal').style.display = mode === 'local' ? 'block' : 'none';

        try {
            // Players carry avatar/wins/games for every tab; daily rows
            // borrow theirs by uid.
            const players = await dbGet('players') || {};
            const deck = (u, p) => ({
                uid: u, name: p.name, avatar: p.avatar || null,
                wins: p.wins || 0, games: p.games || 0,
                gold: (p.champs && p.champs.gold) || 0,
            });
            let rows = [];
            if (tab === 'daily') {
                const key = currentDateKey();
                const day = await dbGet(`daily/${key}/scores`) || {};
                rows = podiumSort(day).map(p => ({
                    ...deck(p.uid, players[p.uid] || { name: p.name }),
                    name: p.name, score: p.best, gold: 0,
                }));
            } else {
                const metric = tab === 'power' ? (p => p.power || 0) : (p => p.rating || 0);
                rows = Object.entries(players)
                    .filter(([, p]) => p && p.name)   // nameless stubs stay off the board
                    .map(([u, p]) => ({ ...deck(u, p), score: metric(p) }))
                    .sort((a, b) => b.score - a.score);
                if (tab === 'power') rows = rows.filter(r => r.score > 0);
            }
            if (!rows.length) {
                body.innerHTML = `<div class="lb-loading">${LB_EMPTY[tab] || LB_EMPTY.alltime}</div>`;
                return;
            }
            const myIdx = rows.findIndex(r => r.uid === uid());
            const shown = rows.slice(0, 50);
            let html = shown.map((r, i) => lbRowHtml(r, i + 1, tab, { idx: i })).join('');
            if (myIdx >= 50) {
                html += '<div class="lb-gap">···</div>'
                    + lbRowHtml(rows[myIdx], myIdx + 1, tab, { idx: shown.length, appendix: true });
            }
            body.innerHTML = html;
        } catch (e) {
            body.innerHTML = '<div class="lb-loading">The heralds are unreachable.</div>';
        }
    }
    function closeLeaderboard() { document.getElementById('lbPanel').classList.remove('active'); }

    // ═══ Character store — buy heroes with Stars ═════════════════════
    // Ownership lives at favor/players/{uid}/owned/{charId}: true, with a
    // localStorage mirror (favorOwned) so hero select works synchronously
    // and offline. The first five characters are everyone's.

    function freeIds() {
        return ((window.FAVOR_DATA || {}).characters || [])
            .slice(0, FREE_CHAR_COUNT).map(c => c.id);
    }

    function ownedIds() {
        let bought = [];
        try { bought = JSON.parse(localStorage.getItem('favorOwned')) || []; }
        catch (e) { /* fresh mirror */ }
        return [...new Set([...freeIds(), ...bought])];
    }

    function mirrorOwned(ownedMap) {
        const bought = Object.keys(ownedMap || {}).filter(k => ownedMap[k]);
        localStorage.setItem('favorOwned', JSON.stringify(bought));
    }

    // Purchase — ONE transaction on the whole player record: the balance
    // check and the ownership write commit together or not at all. The
    // client's displayed balance is never trusted for the write, and a
    // missing record materializes here (lazy join, same as rename).
    async function buyCharacter(charId) {
        const char = ((window.FAVOR_DATA || {}).characters || []).find(c => c.id === charId);
        if (!char) return { ok: false, why: 'unknown' };
        if (ownedIds().includes(charId)) return { ok: false, why: 'owned' };
        // Offline the store is browse-only: a local-ledger purchase would
        // evaporate when the next online session re-mirrors remote owned
        // (stars spent, hero gone) — refuse honestly instead.
        if (mode !== 'firebase') return { ok: false, why: 'offline' };
        // Server-side pre-read: a player who can't afford it never reaches
        // the transaction — otherwise the null-guess stub below would
        // materialize nameless rows that pollute the all-time board. The
        // txn stays the sole authority for the actual purchase.
        try {
            const current = await dbGet(`players/${uid()}`);
            if (((current && current.stars) || 0) < STORE_PRICE) return { ok: false, why: 'stars' };
            if (current && current.owned && current.owned[charId]) return { ok: false, why: 'owned' };
        } catch (e) {
            return { ok: false, why: 'offline' };
        }
        const res = await dbTxn(`players/${uid()}`, p => {
            if (p == null) {
                // Firebase hands the update fn its LOCAL guess first — null
                // when nothing is cached. Returning undefined here would
                // CANCEL the transaction before the server's real record is
                // consulted, so return a provisional stub instead: the
                // server compare rejects it and re-runs us with the truth.
                // A genuinely-new player commits the stub (lazy join) and
                // is still refused below — no stars, no ownership.
                return { stars: 0 };
            }
            const stars = p.stars || 0;
            if (stars < STORE_PRICE) return;            // abort — can't afford
            if (p.owned && p.owned[charId]) return;     // abort — exactly once
            return { ...p, stars: stars - STORE_PRICE,
                     owned: { ...(p.owned || {}), [charId]: true } };
        });
        if (!res.committed || !res.value || !res.value.owned || !res.value.owned[charId]) {
            return { ok: false, why: 'stars' };
        }
        dbUpdate(`players/${uid()}`, { name: myName(), lastSeen: Date.now() });
        _me = res.value;
        mirrorOwned(res.value.owned);
        renderProfileChip();
        return { ok: true };
    }

    // ── Store panel (lb-panel pattern: art IS the UI) ────────────────

    let _confirmingBuy = null;
    let _shelfAnim = false;   // stagger the shelves in on OPEN only — mid-browse re-renders must not replay it

    async function openStore() {
        const panel = document.getElementById('storePanel');
        if (!panel) return;
        _confirmingBuy = null;
        _shelfAnim = true;
        panel.classList.add('active');
        renderStore();
        // Freshen the record so the balance is honest, then re-render.
        // A one-shot get() REJECTS when the wire hiccups — the stale
        // shelf already painted above is the graceful fallback.
        try {
            _me = await dbGet(`players/${uid()}`) || _me;
            if (_me && _me.owned) mirrorOwned(_me.owned);
            renderStore();
        } catch (e) { /* keep the already-rendered shelf */ }
    }

    function closeStore() {
        const panel = document.getElementById('storePanel');
        if (panel) panel.classList.remove('active');
        _confirmingBuy = null;
        _confirmingPack = null;
        _inspecting = null;
        const insp = document.getElementById('storeInspect');
        if (insp) { insp.classList.remove('active'); insp.innerHTML = ''; }
    }

    // One source of truth for a hero's action button — the shelf card and
    // the board inspect must always agree (owned / offline / confirm / price).
    function storeActionHtml(c, owned, stars) {
        if (owned.includes(c.id)) return '<span class="st-owned">Owned</span>';
        if (mode !== 'firebase') {
            // Browse-only offline — see buyCharacter's offline guard.
            return `<button class="st-buy poor" disabled>★ ${STORE_PRICE}</button>`;
        }
        if (_confirmingBuy === c.id) {
            return `<button class="st-buy confirm" onclick="event.stopPropagation(); FLB.confirmBuy('${c.id}')">Buy — ★ ${STORE_PRICE}?</button>`;
        }
        return `<button class="st-buy${stars < STORE_PRICE ? ' poor' : ''}" onclick="event.stopPropagation(); FLB.askBuy('${c.id}')">★ ${STORE_PRICE}</button>`;
    }

    function renderStore() {
        const body = document.getElementById('storeBody');
        if (!body) return;
        const chars = ((window.FAVOR_DATA || {}).characters || []);
        const owned = ownedIds();
        const stars = (_me && _me.stars) || 0;
        document.getElementById('storeStars').innerHTML =
            `★ ${stars}${mode !== 'firebase' ? ' <span class="st-local">OFFLINE — BROWSE ONLY</span>' : ''}`;
        renderStorePacks();   // the Royal Mint row rides every store paint
        const anim = _shelfAnim; _shelfAnim = false;
        body.innerHTML = chars.map((c, i) => {
            const isOwned = owned.includes(c.id);
            return `<div class="st-card${isOwned ? ' owned' : ''}" data-char="${c.id}"${anim ? ` style="animation: shelfIn 0.45s ${(i * 0.045).toFixed(3)}s cubic-bezier(0.16,1,0.3,1) backwards"` : ''}
                onclick="FLB.inspectChar('${c.id}')">
                <div class="st-frame">
                    <img src="assets/characters/${c.filename}" alt="${c.name}">
                </div>
                <div class="st-plate">
                    <span class="st-name">${c.name}</span>
                    <span class="st-diff" title="Difficulty">${'★'.repeat(c.difficulty || 1)}</span>
                </div>
                ${storeActionHtml(c, owned, stars)}
            </div>`;
        }).join('');
        renderInspect();   // confirm/purchase re-renders keep the easel honest
    }

    // ── Board inspect — tap a painting, the whole board goes up on the
    // easel (print-res recut, full color even if unowned) so a player can
    // actually judge the goods; the same buy button rides along.
    let _inspecting = null;

    function inspectChar(charId) {
        _inspecting = charId;
        renderInspect();
    }
    function closeInspect() {
        _inspecting = null;
        renderInspect();
    }
    function renderInspect() {
        const box = document.getElementById('storeInspect');
        if (!box) return;
        const c = _inspecting
            && ((window.FAVOR_DATA || {}).characters || []).find(x => x.id === _inspecting);
        if (!c) { box.classList.remove('active'); box.innerHTML = ''; return; }
        const owned = ownedIds();
        const stars = (_me && _me.stars) || 0;
        // The easel speaks rulebook: DIFFICULTY star row, italic epithet,
        // the printed Tip — that's what makes browsing exciting.
        box.innerHTML = `
            <div class="st-insp-inner" onclick="event.stopPropagation()">
                <div class="st-insp-frame">
                    <img src="assets/characters/hd/${c.filename}" alt="${c.name}">
                </div>
                <div class="st-insp-row">
                    <span class="st-insp-id">
                        <span class="st-name">${c.name}</span>
                        ${c.epithet ? `<span class="st-epithet">${c.epithet}</span>` : ''}
                        <span class="st-insp-diff">DIFFICULTY <b>${'★'.repeat(c.difficulty || 1)}</b></span>
                    </span>
                    ${storeActionHtml(c, owned, stars)}
                </div>
                ${c.tip ? `<div class="st-insp-tip">Tip: <i>${c.tip}</i></div>` : ''}
            </div>
            <div class="st-insp-close" onclick="event.stopPropagation(); FLB.closeInspect()">✕</div>`;
        box.classList.add('active');
    }

    function askBuy(charId) {
        const stars = (_me && _me.stars) || 0;
        if (stars < STORE_PRICE) {
            // Can't afford — the button says so for a beat (shelf card
            // AND the inspect easel, whichever the tap came from).
            const btns = document.querySelectorAll(
                `.st-card[data-char="${charId}"] .st-buy, #storeInspect .st-buy`);
            if (btns.length) {
                btns.forEach(b => { b.textContent = 'Not enough ★'; });
                setTimeout(renderStore, 1200);
            }
            return;
        }
        _confirmingBuy = charId;
        renderStore();
    }

    async function confirmBuy(charId) {
        _confirmingBuy = null;
        const res = await buyCharacter(charId);
        renderStore();
        if (res.ok) {
            const char = window.FAVOR_DATA.characters.find(c => c.id === charId);
            await showPurchaseCelebration(char);
        } else if (res.why === 'stars' || res.why === 'offline') {
            // Every refusal says WHY for a beat — a silently reverting
            // confirm button reads as dead (e.g. the wire dropped after
            // boot and the pre-read refused). Shelf AND inspect buttons.
            const btns = document.querySelectorAll(
                `.st-card[data-char="${charId}"] .st-buy, #storeInspect .st-buy`);
            if (btns.length) {
                btns.forEach(b => {
                    b.textContent = res.why === 'offline' ? 'Offline — try again' : 'Not enough ★';
                });
                setTimeout(renderStore, 1200);
            }
        }
    }

    // Short royal celebration — the champ overlay dressed for a purchase.
    function showPurchaseCelebration(char) {
        return new Promise(resolve => {
            const ov = document.getElementById('champOverlay');
            if (!ov || !char) { resolve(); return; }
            document.getElementById('champTitle').textContent = `${char.name} Joins Your Court!`;
            document.getElementById('champSub').innerHTML =
                `${CROWN_SVG} A new hero enters your select pool`;
            ov.classList.add('active');
            const done = () => { ov.classList.remove('active'); resolve(); };
            ov.onclick = done;
            document.getElementById('champBtn').onclick = (e) => { e.stopPropagation(); done(); };
        });
    }

    // ═══ The Royal Mint — real-money star bundles via PayPal ═════════
    // The box (nationgame.live/api/favor/paypal/ipn) verifies every
    // payment with PayPal's postback and credits favor/players/{uid}/stars
    // ITSELF — the client only opens the checkout tab and watches its own
    // balance. Packs must match the box's table EXACTLY or the grant is
    // refused (never trust the client with money).
    const STAR_PACKS = [
        { id: 'favor.stars50',   stars: 50,   usd: '4.00',  name: 'Pouch of Stars' },
        { id: 'favor.stars100',  stars: 100,  usd: '6.00',  name: 'Purse of Stars' },
        { id: 'favor.stars500',  stars: 500,  usd: '25.00', name: 'Chest of Stars' },
        { id: 'favor.stars1000', stars: 1000, usd: '40.00', name: 'Royal Treasury' },
    ];
    const PAYPAL_BUSINESS = 'gablewyatt@gmail.com';
    const IPN_NOTIFY_URL = 'https://nationgame.live/api/favor/paypal/ipn';

    // The iOS shell (WKWebView, UA carries "FavorShell-iOS") must not show
    // an external purchase rail — Apple 3.1.1. The Mint simply doesn't
    // exist there; Stars still arrive from play, daily crowns, and any
    // purchase made on the web (same favorUid account).
    const IOS_SHELL = /FavorShell-iOS/.test(navigator.userAgent);

    let _confirmingPack = null;
    let _starsWatch = null;    // { baseline } while a PayPal tab may be paying

    function starCheckoutUrl(pack) {
        // invoice <uid>.<packId>.<yyyyMMddHHmmss UTC> — the IPN handler's contract
        const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const q = new URLSearchParams({
            cmd: '_xclick',
            business: PAYPAL_BUSINESS,
            item_name: `FAVOR — ${pack.name} (${pack.stars} Stars)`,
            item_number: pack.id,
            amount: pack.usd,
            currency_code: 'USD',
            invoice: `${uid()}.${pack.id}.${ts}`,
            no_shipping: '1',
            no_note: '1',
            return: 'https://playfavor.net/?paypal=return',
            cancel_return: 'https://playfavor.net/?paypal=cancel',
            notify_url: IPN_NOTIFY_URL,
        });
        return 'https://www.paypal.com/cgi-bin/webscr?' + q.toString();
    }

    function askBuyStars(packId) {
        if (IOS_SHELL) return;                // no purchase rail on iOS (3.1.1)
        if (mode !== 'firebase') return;      // Mint is closed offline
        _confirmingPack = packId;
        renderStore();
    }

    function buyStars(packId) {
        const pack = STAR_PACKS.find(p => p.id === packId);
        if (!pack || IOS_SHELL || mode !== 'firebase') return;
        _confirmingPack = null;
        localStorage.setItem('favorPendingStars', JSON.stringify({
            packId, stars: pack.stars, at: Date.now(),
        }));
        window.open(starCheckoutUrl(pack), '_blank', 'noopener');
        watchForStars();
        renderStore();
    }

    // Poll the balance while a PayPal tab may be completing; the IPN
    // credits server-side, so the Stars just... arrive.
    function watchForStars() {
        let pending = null;
        try { pending = JSON.parse(localStorage.getItem('favorPendingStars')); } catch (e) { /* ignore */ }
        if (!pending || Date.now() - pending.at > 30 * 60 * 1000) {
            localStorage.removeItem('favorPendingStars');
            _starsWatch = null;
            return;
        }
        if (_starsWatch) return;               // one watcher is plenty
        _starsWatch = { baseline: (_me && _me.stars) || 0 };
        const tick = async () => {
            if (!_starsWatch) return;
            try {
                const s = await dbGet(`players/${uid()}/stars`) || 0;
                if (s > _starsWatch.baseline) {
                    const gained = s - _starsWatch.baseline;
                    _me = { ...(_me || {}), stars: s };
                    localStorage.removeItem('favorPendingStars');
                    _starsWatch = null;
                    renderStore();
                    renderProfileChip();
                    // The IPN also queued a congrats — prefer that (it
                    // knows the exact pack); fall back to our own count.
                    const shown = await drainMsgs();
                    if (!shown) await showStarsCelebration(gained);
                    return;
                }
            } catch (e) { /* wire hiccup — keep watching */ }
            _starsWatch.timer = setTimeout(tick, 5000);
        };
        tick();
    }

    function showStarsCelebration(stars) {
        return new Promise(resolve => {
            const ov = document.getElementById('champOverlay');
            if (!ov) { resolve(); return; }
            document.getElementById('champTitle').textContent = 'The Royal Mint Delivers!';
            document.getElementById('champSub').innerHTML = `★ ${stars} Stars join your purse`;
            ov.classList.add('active');
            const done = () => { ov.classList.remove('active'); resolve(); };
            ov.onclick = done;
            document.getElementById('champBtn').onclick = (e) => { e.stopPropagation(); done(); };
        });
    }

    function renderStorePacks() {
        const row = document.getElementById('storePacks');
        if (!row) return;
        if (IOS_SHELL) { row.innerHTML = ''; return; }
        const online = mode === 'firebase';
        row.innerHTML = STAR_PACKS.map(p => {
            const confirming = _confirmingPack === p.id;
            const btn = !online
                ? `<button class="st-pack-buy poor" disabled>$${p.usd}</button>`
                : confirming
                    ? `<button class="st-pack-buy confirm" onclick="event.stopPropagation(); FLB.buyStars('${p.id}')">PayPal — $${p.usd}?</button>`
                    : `<button class="st-pack-buy" onclick="event.stopPropagation(); FLB.askBuyStars('${p.id}')">$${p.usd}</button>`;
            return `<div class="st-pack${confirming ? ' confirming' : ''}" data-pack="${p.id}">
                <div class="st-pack-stars">★ ${p.stars.toLocaleString()}</div>
                <div class="st-pack-name">${p.name}</div>
                ${btn}
            </div>`;
        }).join('') + (_starsWatch
            ? '<div class="st-pack-wait" id="storeWait">Complete the payment in the PayPal tab — your Stars arrive here on their own within a minute.</div>'
            : '');
    }

    // ── Queue picker persistence (3/4/5-player queues) ───────────────

    function queueSize() {
        const v = parseInt(localStorage.getItem('favorQueue'), 10);
        return (v >= 3 && v <= 5) ? v : 3;
    }
    function bindQueuePicker() {
        // Segmented 3/4/5 row on the redesigned menu — one tap, stays lit.
        const seg = document.getElementById('queueSeg');
        if (seg) {
            const paint = () => seg.querySelectorAll('button[data-q]').forEach(b =>
                b.classList.toggle('on', parseInt(b.dataset.q, 10) === queueSize()));
            seg.querySelectorAll('button[data-q]').forEach(b => {
                b.onclick = () => {
                    localStorage.setItem('favorQueue', b.dataset.q);
                    paint();
                };
            });
            paint();
            return;
        }
        const sel = document.getElementById('queueSelect');   // legacy dropdown
        if (!sel) return;
        sel.value = String(queueSize());
        sel.onchange = () => localStorage.setItem('favorQueue', sel.value);
    }

    // ── Boot ─────────────────────────────────────────────────────────

    async function boot() {
        if (IOS_SHELL) document.body.classList.add('ios-shell');
        bindQueuePicker();
        await connect();
        await readPlayer();
        renderProfileChip();
        // A store opened during the 'connecting' window painted browse-only
        // — repaint now that the backend verdict is in.
        renderStore();
        tableSeed();           // prefetch the game-start seed (emblem/personas/boon)
        await settleDue();     // pay out any boundary that passed while we were away
        await drainMsgs();     // then deliver congratulations

        // Back from a PayPal tab? Clean the URL, land the player in the
        // store, and watch for the Stars the IPN is about to credit.
        // (drainMsgs above already celebrated + cleared the pending mark
        // if the grant landed while we were away.)
        const pp = new URLSearchParams(location.search).get('paypal');
        if (pp) {
            history.replaceState(null, '', location.pathname);
            if (pp === 'cancel') localStorage.removeItem('favorPendingStars');
            else if (pp === 'return') openStore();
        }
        if (localStorage.getItem('favorPendingStars')) watchForStars();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    // Public surface
    window.FLB = {
        postGameResult, openLeaderboard, closeLeaderboard, openProfile, closeProfile,
        queueSize, rename, renderProfileChip, snapshot, tableSeed,
        settleDue, drainMsgs, currentDateKey, ratingDelta, generateName,
        gameStars, ownedIds, buyCharacter, openStore, closeStore, askBuy, confirmBuy,
        inspectChar, closeInspect,
        askBuyStars, buyStars, starCheckoutUrl, watchForStars,
        starPacks: () => STAR_PACKS,
        setAvatar, myAvatar, avatarDisc,
        get mode() { return mode; }, uid,
    };
})();
