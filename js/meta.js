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
    // nightly crowns stay a human race.
    //
    // Names are REALISTIC on purpose (Wyatt 7/16): the board should read
    // like people play here. The old thematic style (Lady Vespurine, Count
    // Balthazar…) moved to the Skirmish AI pool in ui.js. The uids/keys
    // never change — rows are PATCH-only (tools/rename-personas.mjs did
    // the live rows in place).
    const PERSONAS = [
        { key: 'ashcroft',   uid: 'persona_ashcroft',   name: 'HotshotGG',      hero: 'knight',    seedRating: 1960, strong: ['power', 'survival'] },
        { key: 'balthazar',  uid: 'persona_balthazar',  name: 'Athene',         hero: 'scientist', seedRating: 1740, strong: ['alchemy', 'knowledge'] },
        { key: 'vespertine', uid: 'persona_vespertine', name: 'Sneaky Penguin', hero: 'duchess',   seedRating: 1560, strong: ['knowledge', 'prospecting'] },
        { key: 'rosalind',   uid: 'persona_rosalind',   name: 'Mable Stadango', hero: 'fisherman', seedRating: 1380,  strong: ['survival', 'knowledge'] },
        { key: 'thorne',     uid: 'persona_thorne',     name: 'Papa Johns',     hero: 'bandit',    seedRating: 1240,  strong: ['power', 'prospecting'] },
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

    // Time until the next 10 PM ET boundary — the WANTED plaque's
    // countdown ticks on this. (ET wall-clock arithmetic: reading the
    // instant in the ET frame cancels the offset; the once-a-year DST
    // boundary night drifts an hour and nobody is harmed.)
    function msUntilNextWindow(now = new Date()) {
        const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const next = new Date(et);
        next.setHours(22, 0, 0, 0);
        if (et >= next) next.setDate(next.getDate() + 1);
        return Math.max(0, next - et);
    }

    // ═══ Rating — Nation's Elo, worn table-wide (Wyatt 7/17) ═════════
    // Same engine as Nation's OneVOneELORating asset: internal Elo int
    // 0–7000, everyone starts at 1000, and the number a player SEES is
    // elo/1000 → the 1.00–7.00 pickleball scale. K 32 (64 for the first
    // ten games, doubled on a 3+ win streak), expected score clamped to
    // [0.05, 0.95], per-game swing capped at ±K×1.5.
    //
    // FAVOR's tables aren't duels, so a game scores as PAIRWISE results
    // vs every other seat — beat them if you placed higher — with K split
    // across the pairs, so a whole table swings like one Nation duel.
    // Personas and humans bring real ratings; generic bots stand in at
    // the court's standard 1200.
    const ELO = {
        INIT: 1000, FLOOR: 0, CEIL: 7000,
        K: 32, PROV_K: 64, PROV_GAMES: 10,
        STREAK_MIN: 3, STREAK_CAP: 5, BOOST: 2,
        E_MIN: 0.05, E_MAX: 0.95, MAX_MULT: 1.5, BOT: 1200,
    };
    const clampElo = (r) => Math.max(ELO.FLOOR, Math.min(ELO.CEIL, Math.round(r)));

    // Legacy rows (the pre-7/17 +25-per-win scale, ints under ~700) read
    // through this everywhere: old*4+1000 preserves order and lands the
    // old board between 1.00 and ~2.20. ratingV:2 marks a migrated row;
    // tools/migrate-ratings-70.mjs stamps the live tree in one pass.
    function eloOf(row) {
        if (!row || row.rating == null) return ELO.INIT;
        return row.ratingV === 2 ? clampElo(row.rating) : clampElo(row.rating * 4 + 1000);
    }
    function fmtRating(elo) { return (clampElo(elo) / 1000).toFixed(2); }
    function fmtRatingDelta(d) {
        return (d >= 0 ? '+' : '−') + (Math.abs(d) / 1000).toFixed(2);
    }

    function eloExpected(a, b) {
        const e = 1 / (1 + Math.pow(10, (b - a) / 400));
        return Math.max(ELO.E_MIN, Math.min(ELO.E_MAX, e));
    }
    function kFor(games, streak) {
        const base = (games || 0) < ELO.PROV_GAMES ? ELO.PROV_K : ELO.K;
        return Math.min(streak || 0, ELO.STREAK_CAP) >= ELO.STREAK_MIN
            ? base * ELO.BOOST : base;
    }
    function eloTableDelta(myElo, myPlace, opps, k) {
        if (!opps.length) return 0;
        const kk = k / opps.length;
        let d = 0;
        for (const o of opps) {
            d += kk * ((myPlace < o.place ? 1 : 0) - eloExpected(myElo, o.elo));
        }
        const cap = k * ELO.MAX_MULT;
        return Math.round(Math.max(-cap, Math.min(cap, d)));
    }

    // Everything one finished table means for MY row — computed the same
    // way by the victory sheet (display) and postGameResult (the write).
    // ratings[] = each seat's table rating (null → bot 1200; my own seat
    // ignored); charId = the hero I rode, for the per-character ledger.
    function tableDelta(scores, ratings, charId) {
        const place = scores.findIndex(s => s.name === 'You');
        if (place < 0) return null;
        const me = _me || {};
        const myElo = eloOf(me);
        const opps = scores.map((s, i) => i === place ? null : ({
            place: i,
            elo: ratings && ratings[i] != null ? clampElo(ratings[i]) : ELO.BOT,
        })).filter(Boolean);
        const won = place === 0;
        const k = kFor(me.games, won ? (me.streak || 0) + 1 : 0);
        const delta = eloTableDelta(myElo, place, opps, k);
        const out = {
            place, opps, delta,
            before: myElo, after: clampElo(myElo + delta),
        };
        if (charId) {
            const cc = ((me.chars || {})[charId]) || {};
            const cElo = cc.r == null ? ELO.INIT : clampElo(cc.r);
            const cd = eloTableDelta(cElo, place, opps, kFor(cc.g || 0, 0));
            out.charId = charId;
            out.charDelta = cd;
            out.charBefore = cElo;
            out.charAfter = clampElo(cElo + cd);
        }
        return out;
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
                .map(([u, p]) => ({ uid: u, name: p.name, score: eloOf(p) }))
                .sort((a, b) => b.score - a.score);
            const me = players[uid()] || null;
            return {
                myRow: me ? { uid: uid(), rating: eloOf(me) } : null,
                topRow: rows[0] || null,
                personas: PERSONAS.map(p => ({
                    ...p,
                    rating: players[p.uid] ? eloOf(players[p.uid]) : p.seedRating,
                })),
            };
        })().catch(() => null);
        return _tableSeedP;
    }

    // ═══ Posting a finished game ═════════════════════════════════════
    // Called from showScoring() with the sorted score rows. YOUR result
    // posts in full; seated persona rivals post rating-only deltas to
    // their permanent rows. Generic bots stay off the board entirely.

    async function postGameResult(scores, personaPlaces, ctx) {
        // ctx (ui.js): { ratings: perSeatTableRating[], myChar: heroId }.
        // Missing ctx (older rigs) → every opponent rates as a 1200 bot
        // and the per-character ledger simply doesn't move.
        const ratings = (ctx && ctx.ratings) || [];
        const myChar = (ctx && ctx.myChar) || null;
        try {
            const place = scores.findIndex(s => s.name === 'You');
            if (place < 0) return;
            const mine = scores[place];
            const starsWon = gameStars(place, scores.length);
            const won = place === 0;
            const myPower = Math.max(0, Math.round(mine.power || 0));
            const opps = scores.map((s, i) => i === place ? null : ({
                place: i,
                elo: ratings[i] != null ? clampElo(ratings[i]) : ELO.BOT,
            })).filter(Boolean);

            // ONE whole-row transaction: rating + Stars + lifetime Power +
            // wins/games/streak + identity land together or retry together
            // (the old three-txn chain could drop a leg on tab close, and
            // a racing Mint delivery is safe — the txn re-runs on conflict).
            // First result still materializes the record (lazy join).
            // Elo runs INSIDE the txn against the server's row, so two
            // tabs can't double-apply a delta computed off a stale read.
            await dbTxn(`players/${uid()}`, p => {
                const cur = p || {};
                const streak = won ? (cur.streak || 0) + 1 : 0;
                const myElo = eloOf(cur);
                const delta = eloTableDelta(myElo, place, opps, kFor(cur.games, streak));
                const out = {
                    ...cur,
                    name: myName(),
                    lastSeen: Date.now(),
                    avatar: cur.avatar || myAvatar() || null,
                    rating: clampElo(myElo + delta),
                    ratingV: 2,
                    stars: (cur.stars || 0) + starsWon,
                    power: (cur.power || 0) + myPower,
                    games: (cur.games || 0) + 1,
                    wins: (cur.wins || 0) + (won ? 1 : 0),
                    streak,
                    bestStreak: Math.max(cur.bestStreak || 0, streak),
                };
                if (myChar) {
                    const cc = ((cur.chars || {})[myChar]) || {};
                    const cElo = cc.r == null ? ELO.INIT : clampElo(cc.r);
                    const cd = eloTableDelta(cElo, place, opps, kFor(cc.g || 0, 0));
                    out.chars = {
                        ...(cur.chars || {}),
                        [myChar]: { r: clampElo(cElo + cd), g: (cc.g || 0) + 1 },
                    };
                }
                return out;
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
            // Their pairwise field: every other seat, with the human's own
            // fresh elo standing in for the "You" seat.
            const myEloNow = eloOf(_me);
            for (const pp of (personaPlaces || [])) {
                try {
                    const seedR = (PERSONAS.find(x => x.uid === pp.uid) || {}).seedRating || ELO.INIT;
                    const myPlace = scores.findIndex(s => s.name === 'You');
                    const pOpps = scores.map((s, i) => i === pp.place ? null : ({
                        place: i,
                        elo: i === myPlace ? myEloNow
                            : (ratings[i] != null ? clampElo(ratings[i]) : ELO.BOT),
                    })).filter(Boolean);
                    await dbTxn(`players/${pp.uid}`, p => {
                        const cur = p || {};
                        const base = cur.rating == null ? seedR
                            : (cur.ratingV === 2 ? clampElo(cur.rating) : eloOf(cur));
                        const pDelta = eloTableDelta(base, pp.place, pOpps, kFor(cur.games, 0));
                        return {
                            ...cur,
                            name: pp.name, lastSeen: Date.now(), persona: true,
                            rating: clampElo(base + pDelta),
                            ratingV: 2,
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
        return {
            rating: eloOf(p), stars: p.stars || 0,
            games: p.games || 0, streak: p.streak || 0,
            chars: p.chars || {},
        };
    }

    // ── WANTED — daily rival (modes.js drives the UI; this owns the claim) ────
    // The reward is once per daily window — the SAME 10 PM ET window the
    // champions live on. One whole-row transaction flips rivalDay and adds
    // the Stars together, so two tabs can never double-pay.
    function personaDefs() {
        return PERSONAS.map(p => ({ ...p, strong: p.strong.slice() }));
    }
    function rivalDayClaimed() {
        return (_me && _me.rivalDay) || null;
    }
    async function claimRivalWin(key, stars) {
        const res = await dbTxn(`players/${uid()}`, p => {
            const cur = p || {};
            if (cur.rivalDay === key) return;   // already paid today — abort
            return {
                ...cur,
                name: myName(),
                rivalDay: key,
                stars: (cur.stars || 0) + stars,
            };
        });
        const fresh = !!(res.committed && res.value && res.value.rivalDay === key
            && (!_me || _me.rivalDay !== key));
        if (res.committed && res.value) {
            _me = res.value;          // the chip repaints from the fresh row
            renderProfileChip();
        }
        return fresh;
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
            <span class="pc-rating" title="Rating">${fmtRating(eloOf(_me))}</span>
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
            <div class="pf-row"><span class="pf-label">Rating</span><b>✦ ${fmtRating(eloOf(p))}</b></div>
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

    // Boards, one renderer (Wyatt 7/17 overhaul): All-Time (rating), a
    // tab per CHARACTER (your rating riding that hero), Daily (best
    // single-game Favor). Power retired; win/game counters left the rows
    // — a board line is a name and a number. Top three wear medals,
    // every row wears its player's crest, YOUR row glows — and if you're
    // beyond the visible fifty, your true rank rides a separated row at
    // the bottom (Nation is the quality bar).
    const LB_EMPTY = {
        alltime: 'No champions yet — the realm awaits its first.',
        daily: 'No champions yet — the day awaits its first.',
    };

    function lbRowHtml(r, rank, tab, opts) {
        const me = r.uid === uid();
        const medal = rank <= 3
            ? `<span class="lb-medal m${rank}">${rank}</span>`
            : `<span class="lb-rank">${rank}</span>`;
        const crowns = r.gold > 0 ? `<span class="lb-crowns">${CROWN_SVG}${r.gold}</span>` : '';
        const score = tab === 'daily'
            ? `<img class="lb-ico" src="assets/icons/favor.png" alt="">${r.score}`
            : `✦ ${fmtRating(r.score)}`;
        return `
            <div class="lb-row${me ? ' me' : ''}${rank <= 3 ? ` podium p${rank}` : ''}${opts && opts.appendix ? ' appendix' : ''}" style="--li:${opts ? opts.idx : 0}">
                ${medal}
                ${avatarDisc(r.avatar, 'lb-av')}
                <span class="lb-name">${r.name || 'Unknown Noble'}${crowns}${me ? '<span class="lb-you">You</span>' : ''}</span>
                <b class="lb-score">${score}</b>
            </div>`;
    }

    // The ten character tabs, worn as portrait chips under the text tabs.
    function renderCharTabs(tab) {
        const host = document.getElementById('lbCharTabs');
        if (!host) return;
        const chars = ((window.FAVOR_DATA || {}).characters || []);
        host.innerHTML = chars.map(c => `
            <button class="lb-chartab${tab === 'char:' + c.id ? ' on' : ''}"
                    title="${c.name} board" onclick="FLB.openLeaderboard('char:${c.id}')">
                <img src="assets/characters/${c.filename}" alt="${c.name}">
            </button>`).join('');
    }

    async function openLeaderboard(tab = 'alltime') {
        const panel = document.getElementById('lbPanel');
        panel.classList.add('active');
        document.querySelectorAll('.lb-tab').forEach(t =>
            t.classList.toggle('on', t.dataset.tab === tab));
        renderCharTabs(tab);
        const charId = tab.startsWith('char:') ? tab.slice(5) : null;
        const charDef = charId
            ? ((window.FAVOR_DATA || {}).characters || []).find(c => c.id === charId)
            : null;
        const body = document.getElementById('lbBody');
        body.innerHTML = '<div class="lb-loading">Consulting the heralds…</div>';
        document.getElementById('lbLocal').style.display = mode === 'local' ? 'block' : 'none';

        try {
            // Players carry avatar/champs for every tab; daily rows
            // borrow theirs by uid.
            const players = await dbGet('players') || {};
            const deck = (u, p) => ({
                uid: u, name: p.name, avatar: p.avatar || null,
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
            } else if (charId) {
                // Your rating WITH that hero — only players who've ridden
                // them into a rated game hold a line on this board.
                rows = Object.entries(players)
                    .filter(([, p]) => p && p.name && p.chars && p.chars[charId]
                        && (p.chars[charId].g || 0) > 0)
                    .map(([u, p]) => ({ ...deck(u, p), score: clampElo(p.chars[charId].r) }))
                    .sort((a, b) => b.score - a.score);
            } else {
                rows = Object.entries(players)
                    .filter(([, p]) => p && p.name)   // nameless stubs stay off the board
                    .map(([u, p]) => ({ ...deck(u, p), score: eloOf(p) }))
                    .sort((a, b) => b.score - a.score);
            }
            if (!rows.length) {
                body.innerHTML = `<div class="lb-loading">${charDef
                    ? `No one has ridden the ${charDef.name} into a rated game yet.`
                    : (LB_EMPTY[tab] || LB_EMPTY.alltime)}</div>`;
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
            // The celebration promises "a new hero enters your select pool", so
            // she has to actually be able to. The sticky offer (localStorage
            // favorOffer) is reused for 10 minutes while every id in it stays
            // owned — which a purchase never invalidates. Without this, a hero
            // you just paid ★100 for could not be OFFERED to you until the
            // sticky roll expired. Buying re-opens the roll.
            try { localStorage.removeItem('favorOffer'); } catch (e) { /* private mode */ }
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
    // exist there (nor in the Steam shell — Valve routes MTX through its
    // own wallet); Stars still arrive from play, daily crowns, and any
    // purchase made on the web (same favorUid account).
    const IOS_SHELL = /FavorShell-(iOS|Steam)/.test(navigator.userAgent);

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
        // A crown won overnight advances the podium/champion achievements —
        // settle wrote the champs counters, this turns them into awards.
        // NOT awaited: this costs a DB round-trip and NOTHING below depends on
        // it. Awaiting it here delayed the PayPal-return cleanup underneath by a
        // whole read, which is a real bug for a player coming back from checkout
        // (the audit caught it). It celebrates itself whenever it lands.
        if (window.FACH) window.FACH.sync();

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

    // ── Update notice — Nation's pill, worn FAVOR's way ──────────────
    // The site ships as stamped statics, so a loaded client only learns a
    // new build exists by asking. Poll the live index for its ui.js stamp;
    // newer than ours → wear the gold pill under the profile chip. The
    // pill lives INSIDE the title screen, so it can never interrupt a
    // game — and for the iOS shell (a live-site wrapper) a reload IS the
    // update, no TestFlight roundtrip needed for content.
    const UPD_EVERY = 4 * 60 * 1000;
    let _updTimer = null;

    function myStamp() {
        const ui = document.querySelector('script[src*="ui.js"]');
        return ui ? Number(ui.src.split('?v=')[1] || 0) : 0;
    }

    async function checkForUpdate() {
        try {
            const res = await fetch('index.html', { cache: 'no-store' });
            if (!res.ok) return;
            const m = (await res.text()).match(/js\/ui\.js\?v=(\d+)/);
            if (m && Number(m[1]) > myStamp()) showUpdatePill();
        } catch (e) { /* offline — ask again next tick */ }
    }

    function showUpdatePill() {
        if (document.getElementById('updatePill')) return;
        const ts = document.getElementById('title-screen');
        if (!ts) return;
        const b = document.createElement('button');
        b.id = 'updatePill';
        b.className = 'update-pill';
        b.type = 'button';
        b.title = 'A new build of FAVOR is live — tap to load it';
        b.innerHTML = '<span class="up-glyph">↻</span> Update Ready';
        b.onclick = () => window.FLB.applyUpdate();
        ts.appendChild(b);
    }

    // Its own door so the audit can stub the reload.
    function applyUpdate() { location.reload(); }

    (function initUpdateWatch() {
        _updTimer = setInterval(checkForUpdate, UPD_EVERY);
        setTimeout(checkForUpdate, 25 * 1000);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') checkForUpdate();
        });
    })();

    // The player's own row, read + whole-row merge. Exposed so achievements
    // (js/achievements.js) can grant and pay Stars in ONE transaction on the
    // SAME row postGameResult writes — a second node would let a tab close
    // drop a leg and hand out an achievement that never paid.
    const readRow = () => dbGet(`players/${uid()}`);
    const mergeRow = (fn) => dbTxn(`players/${uid()}`, (cur) => {
        // The RTDB null-guess trap: with no listener attached the first pass
        // runs on a local guess of null. Returning undefined there CANCELS the
        // whole transaction, so hand back a provisional row and let the server
        // compare reject it — fn then re-runs against the truth.
        if (cur === null) return fn(null);
        return fn(cur);
    });

    // Public surface
    window.FLB = {
        readRow, mergeRow,
        postGameResult, openLeaderboard, closeLeaderboard, openProfile, closeProfile,
        queueSize, rename, renderProfileChip, snapshot, tableSeed,
        personaDefs, rivalDayClaimed, claimRivalWin, msUntilNextWindow,
        settleDue, drainMsgs, currentDateKey, generateName,
        tableDelta, fmtRating, fmtRatingDelta, eloOf,
        gameStars, ownedIds, buyCharacter, openStore, closeStore, askBuy, confirmBuy,
        inspectChar, closeInspect,
        askBuyStars, buyStars, starCheckoutUrl, watchForStars,
        starPacks: () => STAR_PACKS,
        setAvatar, myAvatar, avatarDisc,
        checkForUpdate, applyUpdate,
        get mode() { return mode; }, uid,
    };
})();
