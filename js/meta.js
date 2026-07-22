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

    // The FELLOWSHIP bonus (Wyatt 7/21): playing with real people pays extra —
    // per fellow HUMAN at the table, on top of placement, win or lose. Bots
    // and personas never count, a booted seat stops counting the moment it
    // converts to AI, and private rooms pay exactly like the public queue.
    // A full five-human table banks +20 apiece. (Default for Wyatt to veto.)
    const FELLOWSHIP_STARS_PER_HUMAN = 5;

    function gameStars(place, count, humans) {
        const base = place === 0 ? 10 : place === 1 ? 6 : place === 2 ? 4 : 2;
        return base + FELLOWSHIP_STARS_PER_HUMAN * Math.max(0, (humans || 1) - 1);
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
    // ⚠ RESEEDED 7/18 for the ladder. The old spread (1960/1740/1560/1380/
    // 1240) all sat inside the range humans now clear in a couple of weeks —
    // every real player was 1.04–1.24 with a median of 1.10, and the top
    // persona sat at 1.96. Under the ladder the population would have passed
    // the whole table and had nobody left to chase. These rungs span the
    // range the ladder actually covers, so there is something above the
    // population for months. Reseeding is cheap now and awkward later.
    // ⚠ PATCH-only: persona_* rows are NEVER deleted, and seedRating only
    // applies to a row that has no rating yet — tools/reseed-personas.mjs
    // stamps the live rows in place, idempotently.
    const PERSONAS = [
        { key: 'thorne',     uid: 'persona_thorne',     name: 'Papa Johns',     hero: 'bandit',    seedRating: 1200, strong: ['power', 'prospecting'] },
        { key: 'rosalind',   uid: 'persona_rosalind',   name: 'Mable Stadango', hero: 'fisherman', seedRating: 1700, strong: ['survival', 'knowledge'] },
        // ⚠ Top three RESEEDED 7/20 (Wyatt's numbers: 1.87 / 1.94 / 2.10).
        // The seed is the mean-reversion ANCHOR (personaDelta's PULL), so it
        // must match the live rows' ratings or every posted game drags them
        // back toward the old rungs. Live rows PATCHed the same day.
        { key: 'vespertine', uid: 'persona_vespertine', name: 'Sneaky Penguin', hero: 'duchess',   seedRating: 1870, strong: ['knowledge', 'prospecting'] },
        { key: 'balthazar',  uid: 'persona_balthazar',  name: 'Athene',         hero: 'scientist', seedRating: 1940, strong: ['alchemy', 'knowledge'] },
        { key: 'ashcroft',   uid: 'persona_ashcroft',   name: 'HotshotGG',      hero: 'knight',    seedRating: 2100, strong: ['power', 'survival'] },
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

    // ═══ Rating — a banded PROGRESSION LADDER (Wyatt 7/18) ═══════════
    // Internal int 0–7000; the number a player SEES is elo/1000 → the
    // 1.00–7.00 pickleball scale. Everyone starts at 1000.
    //
    // This replaced table Elo, which felt like nothing. Elo split K across
    // the pairs (k/opps.length), so a 1000-rated player finishing 3rd of 5
    // against 1200 bots moved EIGHT points — "+0.01". The full curve was
    // −0.01 / +0.00 / +0.01 / +0.02 / +0.02: a total dynamic range of three
    // hundredths, 4th place literally rendering "+0.00", and 1st and 2nd
    // indistinguishable after toFixed(2). Wyatt's reported "0.1 rating" was
    // him reading +0.01 aloud. Neither the swing cap nor the expected clamp
    // was anywhere near binding — it was the pairwise split.
    //
    // Elo's zero-sum property is deliberately abandoned. Rating is now a
    // progression track with diminishing returns per tier, and TWO RULES
    // define the entire feel:
    //   1. Below 2.00 nobody ever falls. Every placement gains, on a slope;
    //      last place gains a token "thanks for playing".
    //   2. At or above 2.00, only last place can fall. No other placement is
    //      ever negative, at any rating.
    // "Hit 2 kind of quick, 3 slow, or 4, because it goes to 7."
    const ELO = {
        INIT: 1000, FLOOR: 0, CEIL: 7000, BOT: 1200,
        // The streak boost survives the rewrite as a small extra multiplier
        // on GAINS only — on-theme for "we want people to feel good".
        STREAK_MIN: 3, STREAK_CAP: 5, BOOST: 2,
    };
    // Every knob lives here. Reach for them in this order: BASE (overall
    // speed) → BANDS (tier difficulty) → PS_SLOPE (how much placement
    // matters vs just showing up) → MIN_LAST/MIN_STEP (the consolation
    // slope below 2.00).
    const LADDER = {
        BASE: 100,                    // elo for a 1st-place finish vs an even field
        PS_SLOPE: 1.4,                // placement spread
        ADJ_SPAN: 2000, ADJ_MIN: 0.5, ADJ_MAX: 1.5,
        SOFT: 2000,                   // the 2.00 line — below it nobody falls
        BANDS: [[2000, 2.0], [3000, 1.0], [4000, 0.55],
                [5000, 0.30], [6000, 0.18], [7000, 0.10]],
        MIN_LAST: 10, MIN_STEP: 10,   // sub-2.00 guaranteed slope: 10/20/30/40/50 at n=5
        MIN_NONLAST: 8,               // at/above 2.00, non-last never renders +0.00
        // A safety RAIL, not a routine constraint. At 200 the cap would bind
        // on essentially every first-place finish in the fast band, flattening
        // adj exactly where beating a strong table should pay most. At 300 it
        // only binds at the theoretical maximum (ps 1.0 x adj 1.5 x band 2.0).
        MAX_SWING: 300,
        PULL: 0.05,                   // persona mean-reversion toward its seed
        MIN_DROP: 8,                  // a persona's non-win ALWAYS costs at least this
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
    // Rating tiers wear a colour once you climb past 1.00 (Wyatt 7/17):
    // 2 green · 3 blue · 4 purple · 5 red · 6 teal · 7 radiant gold.
    // Tier = the whole-number floor of the 1.00–7.00 scale.
    const RATING_TIER_COLORS = {
        1: '', 2: '#46d17f', 3: '#5aa6ff', 4: '#b884ff',
        5: '#ff5f6b', 6: '#2fd6c3', 7: '#ffd76a',
    };
    function ratingTier(elo) { return Math.floor(clampElo(elo) / 1000); }
    function ratingColor(elo) { return RATING_TIER_COLORS[ratingTier(elo)] || ''; }
    // A rating number wearing its tier colour + a soft glow of the same.
    function ratingSpan(elo, cls) {
        const c = ratingColor(elo);
        const style = c ? ` style="color:${c};text-shadow:0 0 10px ${c}66"` : '';
        return `<span class="${cls || 'rating-val'} rt-t${ratingTier(elo)}"${style}>${fmtRating(elo)}</span>`;
    }
    function fmtRatingDelta(d) {
        return (d >= 0 ? '+' : '−') + (Math.abs(d) / 1000).toFixed(2);
    }

    // ONE definition of "a win" (Wyatt 7/18: "coming in 2nd in a 5 player
    // game should be considered a win"). Drives the human W/L record, the
    // human streak AND the persona drop rule, so both populations agree on
    // what a win is. n=5 → 1st/2nd · n=4 → 1st/2nd · n=3 → 1st/2nd.
    function isWin(place, n) { return place < Math.ceil((n || 0) * 0.4); }

    // The difficulty curve. Looked up on the PRE-GAME rating, so one award
    // never straddles two bands: a win from 1990 lands at ~2190 entirely at
    // 2.0x. Deliberately not over-engineered.
    function bandMult(elo) {
        for (const [ceil, mult] of LADDER.BANDS) if (elo < ceil) return mult;
        return LADDER.BANDS[LADDER.BANDS.length - 1][1];
    }

    // Opponent strength — a skill signal without Elo's zero-sum property.
    // A strong persona at the table raises the human's adj, so hard tables
    // become worth seeking out.
    function fieldAdj(myElo, opps) {
        if (!opps.length) return 1;
        const avg = opps.reduce((s, o) => s + o.elo, 0) / opps.length;
        return Math.max(LADDER.ADJ_MIN,
            Math.min(LADDER.ADJ_MAX, 1 + (avg - myElo) / LADDER.ADJ_SPAN));
    }

    // Clamp the DELTA against the rails, not just the total. tableDelta used
    // to return an unclamped delta while writing clampElo(myElo + delta), so
    // near 7000 the sheet printed "+0.20 → 7.00" while the ledger moved 4.
    function railed(myElo, delta) {
        return Math.max(ELO.FLOOR - myElo, Math.min(ELO.CEIL - myElo, delta));
    }

    // THE HUMAN LADDER. Rules 1 and 2 live in the two floors at the bottom.
    function ladderDelta(myElo, place, opps, streak) {
        const n = opps.length + 1;
        if (n < 2) return 0;
        // Placement score: +1.00 for 1st, sloping across the seats actually
        // played. n=5: +1.00 +0.65 +0.30 −0.05 −0.40
        const ps = 1 - LADDER.PS_SLOPE * (place / (n - 1));
        let delta = LADDER.BASE * ps * fieldAdj(myElo, opps);
        // GAINS SCALE, FALLS DO NOT. The band is a progression device; a fall
        // is a fall.
        if (delta > 0) {
            delta *= bandMult(myElo);
            if (Math.min(streak || 0, ELO.STREAK_CAP) >= ELO.STREAK_MIN) delta *= ELO.BOOST;
        }
        delta = Math.max(-LADDER.MAX_SWING, Math.min(LADDER.MAX_SWING, delta));
        // Rule 1 — below 2.00 nobody falls, and the slope is guaranteed.
        if (myElo < LADDER.SOFT) {
            delta = Math.max(delta, LADDER.MIN_LAST + (n - 1 - place) * LADDER.MIN_STEP);
        // Rule 2 — at or above 2.00, only last place can fall.
        } else if (place !== n - 1) {
            delta = Math.max(delta, LADDER.MIN_NONLAST);
        }
        return Math.round(railed(myElo, delta));
    }

    // PERSONAS RIDE THE SAME TABLE WITH NONE OF THE PROTECTIONS.
    // Every protection in the human rule set exists because humans have
    // feelings. Personas are the measuring stick (Wyatt 7/18: "the personas
    // don't get the benefits that human players do. Personas will go down in
    // rating when they lose, no matter where they are, no matter what tier").
    // Give a sub-2.00 persona the no-fall floor and the 2.0x band and they
    // could only ever go up: every persona would inflate into a pile at 2.00,
    // precisely the opposite of a ladder with a shape.
    function personaDelta(current, seedRating, place, opps) {
        const n = opps.length + 1;
        if (n < 2) return 0;
        // SYMMETRIC, unlike the human curve: the human ps is positively
        // biased so mid-table still feels rewarding; personas get the honest
        // zero-centred version. +1.00 +0.50 0.00 −0.50 −1.00 at n=5.
        const psP = 1 - 2 * (place / (n - 1));
        let delta = LADDER.BASE * psP * fieldAdj(current, opps);
        // Mean reversion holds the ladder's SHAPE over thousands of games
        // while still letting results move a persona visibly. Applied BEFORE
        // the clamp, so it cushions a loss but can never rescue it.
        delta += (seedRating - current) * LADDER.PULL;
        // A non-winning finish ALWAYS costs a persona rating. No tier, no
        // rating level, no floor, no seed distance exempts them. 3rd of 5
        // sits at exactly 0.00 on the curve, so without this clamp a median
        // finish would be a silent no-op.
        if (!isWin(place, n)) delta = Math.min(delta, -LADDER.MIN_DROP);
        delta = Math.max(-LADDER.MAX_SWING, Math.min(LADDER.MAX_SWING, delta));
        return Math.round(railed(current, delta));
    }

    // Everything one finished table means for MY row — computed the same
    // way by the victory sheet (display) and postGameResult (the write).
    // ratings[] = each seat's table rating (null → bot 1200; my own seat
    // ignored); charId = the hero I rode, for the per-character ledger.
    // ⚠⚠ THE DISPLAY/LEDGER SEAM, and why `row` exists.
    // Display used to compute from the local _me cache while the ledger
    // computed from the server row inside its transaction. Under Elo a stale
    // cache meant a slightly wrong number. Under the ladder it can mean a
    // DIFFERENT RULE — the sheet showing a floor-protected gain while the
    // write applies a fall, because the two disagreed about which side of
    // SOFT the player was on. Both callers run this one function now, and
    // postGameResult passes the server row it is transacting against.
    function tableDelta(scores, ratings, charId, row) {
        const place = scores.findIndex(s => s.name === 'You');
        if (place < 0) return null;
        const me = row || _me || {};
        const myElo = eloOf(me);
        const opps = scores.map((s, i) => i === place ? null : ({
            place: i,
            elo: ratings && ratings[i] != null ? clampElo(ratings[i]) : ELO.BOT,
        })).filter(Boolean);
        const streak = isWin(place, scores.length) ? (me.streak || 0) + 1 : 0;
        const delta = ladderDelta(myElo, place, opps, streak);
        const out = {
            place, opps, delta, streak,
            before: myElo, after: clampElo(myElo + delta),
        };
        if (charId) {
            // The hero's own ledger runs the same ladder against the hero's
            // own elo, so a fresh hero gets the 2.0x band: a veteran picking
            // up a new character climbs that board fast. Intended.
            const cc = ((me.chars || {})[charId]) || {};
            const cElo = cc.r == null ? ELO.INIT : clampElo(cc.r);
            const cd = ladderDelta(cElo, place, opps, 0);
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

    // ═══ Hero XP — the Gilt Ribbon (docs/FAVOR-XP-SIDEB-SPEC.md) ═════
    // STORE lifetime Favor (chars[id].fv); DERIVE the level on every
    // read, never write it — the curve retunes with zero migration.
    // fv is monotonic and absent-means-zero (Level 1), so there is no
    // backfill and nothing to migrate.
    //
    // 7/20 curve (docs/FAVOR-UPDATE-JUL20-SPEC.md §3): fast early, slow
    // late. Wyatt's anchor — "75 favor in a game should level you up" —
    // fixes step(1)=75; the slope is the tuning dial, the cap keeps
    // Level 100 reachable (~27.9k lifetime vs ~225k uncapped).
    //   step(n) = min(75 + 15·(n−1), 300)     // cost of level n → n+1
    // Side B (Lv 5) now sits at 390 banked Favor, ≈4 games.
    const XP_MAX_LEVEL = 100;
    const SIDEB_LEVEL = 5;
    const xpStep = (n) => Math.min(75 + 15 * (n - 1), 300);
    // XP_CUM[L-1] = lifetime Favor at which level L begins (XP_CUM[0]=0).
    const XP_CUM = (() => {
        const c = [0];
        for (let n = 1; n < XP_MAX_LEVEL; n++) c.push(c[n - 1] + xpStep(n));
        return c;
    })();

    function heroLevel(fv) {
        const v = fv || 0;
        let lvl = 1;
        while (lvl < XP_MAX_LEVEL && v >= XP_CUM[lvl]) lvl++;
        return lvl;
    }
    function heroLevelPct(fv) {
        const v = fv || 0;
        const lvl = heroLevel(v);
        if (lvl >= XP_MAX_LEVEL) return 100;
        return (v - XP_CUM[lvl - 1]) / xpStep(lvl) * 100;
    }
    function heroFv(charId) {
        return (((_me || {}).chars || {})[charId] || {}).fv || 0;
    }
    function sideBUnlocked(charId) {
        const c = ((window.FAVOR_DATA || {}).characters || []).find(x => x.id === charId);
        return !!(c && c.altSlots) && heroLevel(heroFv(charId)) >= SIDEB_LEVEL;
    }
    // The ribbon — ONE renderer for every surface (profile tile 7px,
    // hero select 11px, victory chip 9px). Arabic numeral at the head,
    // per-level fill, no stations; at Level 100 the track re-gilds
    // (.max) and stops resetting — a mastery mark, not a meter.
    function xpRibbonHtml(fv, h, nsz) {
        const lvl = heroLevel(fv);
        const max = lvl >= XP_MAX_LEVEL;
        const pct = max ? 100 : heroLevelPct(fv);
        return `<div class="rb${max ? ' max' : ''}" style="--h:${h || 11}px;--nsz:${nsz || 12}px">
            <span class="rb-num">${lvl}</span>
            <div class="rb-track"><div class="rb-fill" style="--pct:${pct.toFixed(1)}%"></div></div>
        </div>`;
    }

    // ═══ The earned hero — two heroes at Level 5 (spec §6) ═══════════
    // The predicate is DERIVED on every read: nothing is written when the
    // threshold is crossed, so there is no counter to drift and the unlock
    // reaches anyone who qualified offline or in an older build the moment
    // a menu loads (idempotent latch + retroactive backfill in one).
    // The hero itself is DATA: any characters row with earnedOnly:true is
    // granted by this predicate, refused by buyCharacter at any price and
    // kept out of every bot pool. Wyatt appends the row + art when ready —
    // until then the roster has none, so nothing renders and nothing fires.
    function earnedHeroQualified() {
        const chars = (_me || {}).chars || {};
        return Object.values(chars)
            .filter(c => heroLevel((c || {}).fv || 0) >= SIDEB_LEVEL).length >= 2;
    }
    function earnedOnlyIds() {
        return ((window.FAVOR_DATA || {}).characters || [])
            .filter(c => c.earnedOnly).map(c => c.id);
    }
    function earnedMirror() {
        try { return JSON.parse(localStorage.getItem('favorEarned')) || []; }
        catch (e) { return []; }
    }
    // ⚠ ADD-ONLY — deliberately unlike favorOwned, which REPLACES from the
    // remote row. ownedIds() is synchronous and runs before the row lands;
    // a cold offline boot reads empty chars, and a replacing mirror would
    // silently revoke a character the player earned. Only ever add.
    function addEarnedMirror(id) {
        const cur = earnedMirror();
        if (!cur.includes(id)) {
            cur.push(id);
            try { localStorage.setItem('favorEarned', JSON.stringify(cur)); } catch (e) { /* private mode */ }
        }
    }
    // Menu-load latch: re-derive, mirror, announce exactly once. Announces
    // on the MENU you return to, never mid-game (spec §6) — the visibility
    // gate keeps a post-game chip repaint from firing it over the table.
    async function checkEarnedHero() {
        const ids = earnedOnlyIds();
        if (!ids.length || !earnedHeroQualified()) return;
        const gameUp = ['game-screen', 'scoring-screen'].some(id => {
            const el = document.getElementById(id);
            return el && el.classList.contains('active');
        });
        for (const id of ids) {
            addEarnedMirror(id);
            const flagKey = 'favorShownUnlock_' + id;
            if (!gameUp && !localStorage.getItem(flagKey)) {
                try { localStorage.setItem(flagKey, String(Date.now())); } catch (e) { /* shown again next boot — harmless */ }
                // The celebration promises a hero in the select pool — the
                // sticky offer re-rolls so it can actually be offered now.
                try { localStorage.removeItem('favorOffer'); } catch (e) { /* fine */ }
                const char = window.FAVOR_DATA.characters.find(c => c.id === id);
                if (char) await showEarnedHeroCelebration(char);
            }
        }
    }
    // The champ overlay's FIFTH dress — the earned hero steps out.
    function showEarnedHeroCelebration(char) {
        return new Promise(resolve => {
            const ov = document.getElementById('champOverlay');
            if (!ov || !char) { resolve(); return; }
            document.getElementById('champTitle').textContent = `${char.name} Answers Your Renown!`;
            document.getElementById('champSub').innerHTML =
                `${CROWN_SVG} Two heroes at Level 5 — a new hero joins your court, earned, never sold`;
            ov.classList.add('active');
            const done = () => { ov.classList.remove('active'); resolve(); };
            ov.onclick = done;
            document.getElementById('champBtn').onclick = (e) => { e.stopPropagation(); done(); };
        });
    }

    // Retro-crossing latch (7/20 spec §3, decision 4): a curve retune can
    // move a hero PAST Level 5 between games — the victory-txn crossing
    // detector never sees it, so the ceremony would silently never fire.
    // Re-derived on every menu load, idempotent via the same per-hero flag
    // the victory path stamps; reaches anyone the curve promoted.
    async function checkSideBRetro() {
        const gameUp = ['game-screen', 'scoring-screen'].some(id => {
            const el = document.getElementById(id);
            return el && el.classList.contains('active');
        });
        if (gameUp) return;
        const chars = ((window.FAVOR_DATA || {}).characters || []);
        for (const c of chars) {
            if (!c.altSlots || !sideBUnlocked(c.id)) continue;
            if (localStorage.getItem('favorShownSideB_' + c.id)) continue;
            await showSideBCelebration(c);
        }
    }

    // The champ overlay's FOURTH dress — Level 5, the board turns over.
    // Art rides #champArt (kept empty by every other dress); the flip
    // runs the same 1s turn the design page locked. Stamps its own
    // once-per-hero flag FIRST, so the victory crossing and the retro
    // latch can never double-fire it.
    function showSideBCelebration(char) {
        return new Promise(resolve => {
            const ov = document.getElementById('champOverlay');
            const art = document.getElementById('champArt');
            if (!ov || !char) { resolve(); return; }
            try { localStorage.setItem('favorShownSideB_' + char.id, String(Date.now())); }
            catch (e) { /* shown again next boot — harmless */ }
            document.getElementById('champTitle').textContent =
                `The ${char.name} Turns the Board`;
            document.getElementById('champSub').innerHTML =
                `Side B unlocked — <em>${char.altEpithet || 'the other side'}</em>`;
            if (art) {
                art.innerHTML = `<div class="champ-flip"><div class="cf-inner">
                    <div class="cf-face"><img src="assets/characters/${char.filename}" alt=""></div>
                    <div class="cf-face cf-back"><img src="assets/characters/${char.altFilename || char.filename}" alt=""></div>
                </div></div>`;
                requestAnimationFrame(() => setTimeout(() => {
                    const f = art.querySelector('.cf-inner');
                    if (f) f.classList.add('turned');
                }, 650));
            }
            ov.classList.add('active');
            const done = () => {
                ov.classList.remove('active');
                if (art) art.innerHTML = '';
                resolve();
            };
            ov.onclick = done;
            document.getElementById('champBtn').onclick = (e) => { e.stopPropagation(); done(); };
        });
    }

    // ═══ Posting a finished game ═════════════════════════════════════
    // Called from showScoring() with the sorted score rows. YOUR result
    // posts in full; seated persona rivals post rating-only deltas to
    // their permanent rows. Generic bots stay off the board entirely.

    async function postGameResult(scores, personaPlaces, ctx) {
        // ctx (ui.js): { ratings: perSeatTableRating[], myChar: heroId,
        // humans: real people at the table (fellowship Stars) }.
        // Missing ctx (older rigs) → every opponent rates as a 1200 bot,
        // no fellowship, and the per-character ledger simply doesn't move.
        const ratings = (ctx && ctx.ratings) || [];
        const myChar = (ctx && ctx.myChar) || null;
        // The XP result rides back to the caller: the victory screen's delta
        // chip and the Level 5 ceremony paint from THESE numbers — computed
        // inside the transaction off the row the commit writes, never from a
        // post-hoc read (the FACH-shape trap in spec §7).
        let xpOut = null;
        try {
            const place = scores.findIndex(s => s.name === 'You');
            if (place < 0) return null;
            const mine = scores[place];
            const starsWon = gameStars(place, scores.length, ctx && ctx.humans);
            // ⚠ `won` has THREE consumers below — the wins count, the
            // streak/bestStreak pair, and (through the streak) the gain
            // boost. It is no longer `place === 0`: a top-40% finish is a
            // win, so a streak becomes a run of top-40% finishes, which is
            // the right reading of a hot streak.
            const won = isWin(place, scores.length);
            const myPower = Math.max(0, Math.round(mine.power || 0));

            // ONE whole-row transaction: rating + Stars + lifetime Power +
            // wins/games/streak + identity land together or retry together
            // (the old three-txn chain could drop a leg on tab close, and
            // a racing Mint delivery is safe — the txn re-runs on conflict).
            // First result still materializes the record (lazy join).
            // Elo runs INSIDE the txn against the server's row, so two
            // tabs can't double-apply a delta computed off a stale read.
            let pendingXp = null;
            const txnRes = await dbTxn(`players/${uid()}`, p => {
                const cur = p || {};
                const streak = won ? (cur.streak || 0) + 1 : 0;
                // SERVER TRUTH into the same function the victory sheet ran,
                // so the number shown and the number written cannot disagree
                // about which side of the 2.00 line this game started on.
                const rr = tableDelta(scores, ratings, myChar, cur);
                const out = {
                    ...cur,
                    name: myName(),
                    lastSeen: Date.now(),
                    avatar: cur.avatar || myAvatar() || null,
                    rating: rr ? rr.after : eloOf(cur),
                    ratingV: 2,
                    stars: (cur.stars || 0) + starsWon,
                    power: (cur.power || 0) + myPower,
                    games: (cur.games || 0) + 1,
                    wins: (cur.wins || 0) + (won ? 1 : 0),
                    streak,
                    bestStreak: Math.max(cur.bestStreak || 0, streak),
                };
                if (myChar && rr && rr.charId) {
                    const cc = ((cur.chars || {})[myChar]) || {};
                    // Hero XP: the game's final score banks onto this hero's
                    // lifetime track. fv is monotonic; the LEVEL is derived
                    // here, inside the txn, from the exact values this commit
                    // writes — a retry recomputes both together.
                    const fvBefore = cc.fv || 0;
                    const fvAfter = fvBefore + Math.max(0, Math.round(mine.finalScore || 0));
                    pendingXp = {
                        charId: myChar, fvBefore, fvAfter,
                        levelBefore: heroLevel(fvBefore),
                        levelAfter: heroLevel(fvAfter),
                    };
                    out.chars = {
                        ...(cur.chars || {}),
                        // `best` = your highest single-game score with this hero
                        // (Wyatt 7/17) — players love hunting their own high, and
                        // seeing a rival's big number on a hero's board.
                        [myChar]: {
                            r: rr.charAfter,
                            g: (cc.g || 0) + 1,
                            best: Math.max(cc.best || 0, Math.round(mine.finalScore || 0)),
                            fv: fvAfter,
                        },
                    };
                }
                return out;
            });
            // Only a COMMITTED transaction's numbers are real — and the fresh
            // row keeps the select screen's levels honest without a re-read.
            if (txnRes && txnRes.committed) {
                xpOut = pendingXp;
                if (txnRes.value) _me = txnRes.value;
            }

            // Daily board: best single-game Favor score in this window. ROUNDED
            // to match the chars ledger above -- the two disagreed, and these
            // rows are now also the Top Scores board's whole data source.
            const key = currentDateKey();
            const myBest = Math.round(mine.finalScore || 0);
            await dbTxn(`daily/${key}/scores/${uid()}`, cur => {
                if (cur && cur.best >= myBest) return cur;
                return { name: myName(), best: myBest, at: Date.now() };
            });
            renderProfileChip();
        } catch (e) {
            console.warn('[FAVOR meta] post failed:', e.message);
        } finally {
            // Seated personas: their placements are as real as yours —
            // one whole-row txn each on their PERMANENT rows (never delete).
            // A row missing its rating starts from the persona's seed value.
            // Their pairwise field: every other seat, with the human's own
            // fresh elo standing in for the "You" seat.
            //
            // They post daily scores now and rank on Daily + Top Scores, but
            // they take NO Stars and NO crowns — see the podium filter in
            // podiumSort. "Just like regular players" applies to SCORES, not
            // to payouts.
            const myEloNow = eloOf(_me);
            const dailyKey = currentDateKey();
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
                        return {
                            ...cur,
                            name: pp.name, lastSeen: Date.now(), persona: true,
                            rating: clampElo(base + personaDelta(base, seedR, pp.place, pOpps)),
                            ratingV: 2,
                            power: (cur.power || 0) + Math.max(0, Math.round(pp.power || 0)),
                            games: (cur.games || 0) + 1,
                            // The SAME predicate the human record uses, so both
                            // populations agree on what a win is.
                            wins: (cur.wins || 0) + (isWin(pp.place, scores.length) ? 1 : 0),
                        };
                    });
                    // "They'll also need to have their own high scores posted,
                    // just like regular players." Marked persona:true so
                    // settlement can filter and boards can style.
                    const pBest = Math.round(pp.finalScore || 0);
                    if (pBest > 0) {
                        await dbTxn(`daily/${dailyKey}/scores/${pp.uid}`, cur => {
                            if (cur && cur.best >= pBest) return cur;
                            return { name: pp.name, best: pBest, at: Date.now(), persona: true };
                        });
                    }
                } catch (e) {
                    console.warn('[FAVOR meta] persona post failed:', e.message);
                }
            }
            // Ratings moved — the NEXT game reads a fresh seed.
            _tableSeedP = null;
        }
        return xpOut;
    }

    // ═══ Daily Champions — lazy idempotent settlement ════════════════

    // `forPodium` drops personas — Wyatt 7/18: "prevent them from getting the
    // crowns. That's fine." Personas post daily scores and RANK publicly on
    // Daily and Top Scores, but the nightly settlement pays Stars, increments
    // champs and pushes a royal msgQueue overlay for each podium seat. Left
    // unfiltered, a persona would take a crown and its Stars from a real
    // human, wear crowns on the leaderboard, and grow an orphan message queue
    // on a permanent row that will never log in. Filtering at the PODIUM (not
    // off the board) is what keeps "just like regular players" true of scores
    // while payouts stay a human race. It also defuses the 22:00 ET audit
    // hazard instead of escalating it: a run straddling the boundary can no
    // longer crown a persona.
    // ⚠⚠ `forPodium` also drops TEST RESIDUE, and that is not theoretical:
    // on 2026-07-18 six 'Audit Herald' rows sat above every real player but
    // the top two, and settleDue paid one of them BRONZE — 10 Stars and a
    // crown that belonged to a human (TheFavorite, best 45). The boards
    // themselves had always filtered these by name via cleanBoardRows, so the
    // rows were invisible while still being eligible for payouts.
    //
    // ⚠ Filtered by UID PREFIX, deliberately NOT by name. TEST_NAMES matches
    // `audit .*`, so a name-based rule would silently and permanently bar a
    // real player who happened to call themselves "Audit Trail" from ever
    // winning a crown — a worse bug than the one it fixes, because it is
    // invisible and hits a human. Uids are minted by the app and cannot be
    // chosen, so the prefix is exact; every row that took the 7/18 bronze was
    // uauditcrest*. Boards may keep guessing by name (a false positive there
    // is cosmetic, and your own row is exempt); a payout may not.
    function podiumSort(scores, forPodium) {
        return Object.entries(scores || {})
            .filter(([u, s]) => !(forPodium && s && (s.persona || TEST_UIDS.test(u))))
            .map(([u, s]) => ({ uid: u, name: s.name, best: s.best, at: s.at || 0, persona: !!(s && s.persona) }))
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

                const podium = podiumSort((days[key] || {}).scores, true).slice(0, 3);
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

    // ═══ Court Seal — account recovery (Wyatt 7/20) ══════════════════
    // Reinstalling the app wipes webview storage, mints a fresh uid, and
    // strands the old account forever. The uid IS the account key (no
    // auth exists), so it becomes a player-visible "Court Seal": copy it
    // before you lose it, paste it to take the seat back on any device.
    // PREVIEW looks the row up and names it; CLAIM swaps this device onto
    // it and reloads. Mirrors REPLACE wholesale on a claim — this is an
    // identity switch, not a remote refresh (the add-only earned rule
    // protects a boot race, not a deliberate change of account).
    async function previewSeal(code) {
        const c = String(code || '').trim();
        if (!/^u[a-z0-9]{6,40}$/.test(c)) return { ok: false, why: 'shape' };
        if (c === uid()) return { ok: false, why: 'self' };
        if (mode !== 'firebase') return { ok: false, why: 'offline' };
        let row = null;
        try { row = await dbGet(`players/${c}`); } catch (e) { return { ok: false, why: 'offline' }; }
        if (!row || !row.name) return { ok: false, why: 'unknown' };
        return { ok: true, name: row.name, rating: eloOf(row), games: row.games || 0, row };
    }
    function claimSeal(code, row, opts = {}) {
        const c = String(code).trim();
        try {
            localStorage.setItem('favorUid', c);
            localStorage.setItem('favorName', (row && row.name) || myName());
            if (row && row.avatar) localStorage.setItem('favorAvatar', row.avatar);
            else localStorage.removeItem('favorAvatar');
            mirrorOwned((row && row.owned) || {});
            localStorage.setItem('favorEarned', JSON.stringify([]));
            // The adopted court's own linked identities ride along; any
            // mirror of the abandoned account's link must not.
            if (row && row.identities) localStorage.setItem('favorIdentity', JSON.stringify(row.identities));
            else localStorage.removeItem('favorIdentity');
            ['favorSoloSave', 'favorOffer', 'favorPendingStars', 'favorSidePref']
                .forEach(k => localStorage.removeItem(k));
            // Celebration latches belong to the account, not the glass —
            // cleared so the restored account's unlocks announce fresh.
            Object.keys(localStorage)
                .filter(k => /^favorShown(SideB|Unlock)_/.test(k))
                .forEach(k => localStorage.removeItem(k));
        } catch (e) { /* storage sick — the reload still lands most of it */ }
        shellPersistUid(c);   // the Keychain follows the account, not the glass
        if (!opts.noReload) location.reload();
        return { ok: true };
    }

    // ═══ Court Sign-In — platform identity replaces the copy/paste seal
    // (Wyatt 7/20 eve). One identity per provider per account, one account
    // per identity: favor/identities/{provider_sub} → { uid } is the whole
    // registry, claimed by transaction so two devices can't split it. The
    // seal survives underneath as the internal token — signing in on a new
    // device simply claimSeal()s the mapped uid. Platform picks the ONE
    // offered door: Apple in the iOS shell, Steam identity in the Steam
    // shell (stub until the Steam build is testable), Google on the web.
    //
    // CONFLICT RULE (deliberate): an identity already linked to another
    // court NEVER re-links — the device SWITCHES to the linked court after
    // a named two-tap confirm (the seal-restore grammar). An account
    // already sealed to a different identity of the same provider refuses
    // politely. First link wins; nothing merges; nothing silently moves.
    const SHELL_IOS = /FavorShell-iOS/.test(navigator.userAgent);
    const SHELL_STEAM = /FavorShell-Steam/.test(navigator.userAgent);
    // "FAVOR Web" client on the testroom-75200 project (created 7/20).
    // Origins: playfavor.net, www.playfavor.net, localhost:8891 (the rig).
    const GOOGLE_CLIENT_ID = window.__FAVOR_GOOGLE_CLIENT
        || '711812846396-bjsbsq2862torejihjrbbb13kl43393j.apps.googleusercontent.com';
    // GIS only mounts where it can actually work: an authorized origin and
    // a REAL browser. Under automation (navigator.webdriver — puppeteer,
    // the ui-audit) Google's iframe just spills origin errors into the
    // console the suite rightly refuses to accept — those environments get
    // the quiet note instead. Humans never have webdriver set.
    const GIS_ORIGINS = ['https://playfavor.net', 'https://www.playfavor.net', 'http://localhost:8891'];
    const gisAvailable = () => GOOGLE_CLIENT_ID !== 'PENDING'
        && GIS_ORIGINS.includes(location.origin) && !navigator.webdriver;
    const SIGN_PROVIDER = SHELL_IOS ? 'apple' : SHELL_STEAM ? 'steam' : 'google';
    const SIGN_PROV_NAME = { apple: 'Apple ID', google: 'Google account', steam: 'Steam identity' };

    // The iOS shell (b18+) injects window.__FAVORSHELL at documentStart and
    // listens on webkit.messageHandlers.favorSign. b17 has neither — the
    // section says "next update" instead of drawing a dead button.
    function shellBridge() {
        try {
            return window.__FAVORSHELL && window.webkit
                && window.webkit.messageHandlers && window.webkit.messageHandlers.favorSign
                ? window.webkit.messageHandlers.favorSign : null;
        } catch (e) { return null; }
    }
    function shellPersistUid(u) {
        const b = shellBridge();
        if (b) try { b.postMessage({ cmd: 'keychain_uid', uid: String(u || uid()) }); } catch (e) { /* shell absent */ }
    }

    // Firebase keys can't hold . # $ [ ] / — Apple subs carry dots, so every
    // sub is escaped deterministically (collision-free, reversible).
    function idKey(provider, sub) {
        return provider + '_' + String(sub).replace(/[^A-Za-z0-9_-]/g,
            c => '-' + c.charCodeAt(0).toString(16));
    }
    function myIdentities() {
        if (_me && _me.identities) return _me.identities;
        try { return JSON.parse(localStorage.getItem('favorIdentity')) || {}; }
        catch (e) { return {}; }
    }

    // One entry for every provider's credential: resolve the identity and
    // land in exactly one state — linked / already / switch / taken_mine /
    // offline / error. The UI renders the state; nothing here reloads
    // except a confirmed switch (through claimSeal).
    let _signState = null;   // null | {state, ...} — drives the section render
    async function applyIdentity(provider, sub, dispName) {
        if (mode !== 'firebase') return setSignState({ state: 'offline' });
        const key = idKey(provider, sub);
        try {
            const existing = await dbGet(`identities/${key}`);
            if (existing && existing.uid && existing.uid !== uid()) {
                return await armSwitch(provider, sub, existing.uid);
            }
            const mineSub = myIdentities()[provider];
            if (!existing && mineSub && String(mineSub) !== String(sub)) {
                // This court is already sealed to a DIFFERENT identity —
                // refuse; linking a second would orphan the first silently.
                return setSignState({ state: 'taken_mine', provider });
            }
            const res = await dbTxn(`identities/${key}`, cur => {
                // RTDB null-guess: returning the claim on the local null is
                // the documented provisional-stub pattern — the server
                // compare rejects a stale guess and re-runs us with truth.
                if (cur == null) return { uid: uid(), provider, sub: String(sub), name: dispName || myName(), at: Date.now() };
                if (cur.uid === uid()) return cur;
                return;   // abort — another court holds this identity
            });
            if (res.committed && res.value && res.value.uid === uid()) {
                const ids = { ...myIdentities(), [provider]: String(sub) };
                await dbUpdate(`players/${uid()}`, { name: myName(), lastSeen: Date.now(), identities: ids });
                _me = { ...(_me || {}), identities: ids };
                try { localStorage.setItem('favorIdentity', JSON.stringify(ids)); } catch (e) { /* mirror only */ }
                shellPersistUid(uid());
                return setSignState({ state: 'linked', provider });
            }
            // Lost a claim race — the winner is the switch target.
            const now = await dbGet(`identities/${key}`);
            if (now && now.uid && now.uid !== uid()) return await armSwitch(provider, sub, now.uid);
            return setSignState({ state: 'error' });
        } catch (e) {
            return setSignState({ state: 'error' });
        }
    }
    async function armSwitch(provider, sub, targetUid) {
        const prev = await previewSeal(targetUid);
        if (!prev.ok) return setSignState({ state: 'error' });
        return setSignState({
            state: 'switch', provider, sub, targetUid,
            name: prev.name, rating: prev.rating, games: prev.games, row: prev.row,
        });
    }
    function confirmSwitch() {
        if (!_signState || _signState.state !== 'switch') return;
        claimSeal(_signState.targetUid, _signState.row);   // persists Keychain + reloads
    }
    function setSignState(s) {
        _signState = s;
        renderSigninSection();
        return s;
    }

    // ── Google (web): GIS button, lazy-loaded ────────────────────────
    let _gisLoading = false;
    function ensureGis(cb) {
        if (window.google && google.accounts && google.accounts.id) { cb(); return; }
        if (_gisLoading) { setTimeout(() => ensureGis(cb), 250); return; }
        _gisLoading = true;
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => cb();
        s.onerror = () => { _gisLoading = false; setSignState({ state: 'error' }); };
        document.head.appendChild(s);
    }
    function decodeJwtPayload(jwt) {
        const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)));
    }
    function mountGoogleButton() {
        const host = document.getElementById('pfGsi');
        if (!host || !gisAvailable()) return;
        ensureGis(() => {
            const live = document.getElementById('pfGsi');   // panel may have re-rendered
            if (!live) return;
            try {
                google.accounts.id.initialize({
                    client_id: GOOGLE_CLIENT_ID,
                    callback: (resp) => {
                        try {
                            const p = decodeJwtPayload(resp.credential);
                            applyIdentity('google', p.sub, p.name || p.email || null);
                        } catch (e) { setSignState({ state: 'error' }); }
                    },
                    itp_support: true,
                });
                google.accounts.id.renderButton(live, {
                    theme: 'filled_black', size: 'large', shape: 'pill',
                    text: 'signin_with', logo_alignment: 'left', width: 280,
                });
            } catch (e) { setSignState({ state: 'error' }); }
        });
    }

    // ── Apple (iOS shell b18+): the shell runs ASAuthorization ───────
    function appleSignIn() {
        const b = shellBridge();
        if (!b) return;
        setSignState({ state: 'waiting' });
        try { b.postMessage({ cmd: 'apple_signin' }); }
        catch (e) { setSignState({ state: 'error' }); }
    }
    // Called by the shell via evaluateJavaScript.
    function _appleResult(res) {
        if (!res || !res.ok) {
            setSignState(res && res.error === 'canceled' ? null : { state: 'error' });
            return;
        }
        applyIdentity('apple', res.sub, res.name || null);
    }

    // ── The profile section — ONE door per platform ──────────────────
    function signinSectionHtml() {
        return `<div class="pf-sec">Account Sign-in</div><div id="pfSignin">${signinBodyHtml()}</div>`;
    }
    function signinBodyHtml() {
        const provName = SIGN_PROV_NAME[SIGN_PROVIDER];
        const s = _signState;
        if (s && s.state === 'switch') {
            const cur = _me || {};
            const curGames = cur.games || 0;
            return `
                <div class="pf-note">That ${SIGN_PROV_NAME[s.provider]} is the seal of <b>${s.name}</b>
                    · rating ${fmtRating(s.rating)} · ${s.games} game${s.games === 1 ? '' : 's'}.
                    Taking that seat replaces the court on THIS device${curGames > 0
                        ? ` — your current court (<b>${myName()}</b>, ${curGames} game${curGames === 1 ? '' : 's'}) stays behind, unlinked`
                        : ''}.</div>
                <div class="pf-row pf-signrow">
                    <button class="btn-royal primary" onclick="FLB._confirmSwitch()"><span>Become ${s.name}</span></button>
                    <button class="btn-royal" onclick="FLB._cancelSign()"><span>Stay as ${myName()}</span></button>
                </div>`;
        }
        if (s && s.state === 'waiting') return '<div class="pf-note">Awaiting the seal…</div>';
        const ids = myIdentities();
        if (ids[SIGN_PROVIDER]) {
            return `<div class="pf-note"><span class="pf-sealed">✓ Sealed to your ${provName}</span>
                — sign in there on any device to take this seat.</div>`;
        }
        let door = '';
        if (mode !== 'firebase') {
            door = '<div class="pf-note">The realm is unreachable — sign-in needs the wire.</div>';
        } else if (SIGN_PROVIDER === 'apple') {
            door = shellBridge()
                ? '<button class="pf-apple" id="pfAppleBtn" onclick="FLB._appleSignIn()"><span class="pf-apple-logo"></span> Sign in with Apple</button>'
                : '<div class="pf-note">Account linking arrives with the next FAVOR update.</div>';
        } else if (SIGN_PROVIDER === 'steam') {
            door = '<div class="pf-note">Steam sign-in arrives with the Steam release.</div>';
        } else {
            door = gisAvailable()
                ? '<div class="pf-gsi-host" id="pfGsi"></div>'
                : '<div class="pf-note">Sign-in is being fitted to this door — try again shortly.</div>';
        }
        const err = s && s.state === 'error' ? '<div class="pf-note pf-sign-err">The seal did not take — try again.</div>'
            : s && s.state === 'offline' ? '<div class="pf-note pf-sign-err">The realm is unreachable — try again online.</div>'
            : s && s.state === 'taken_mine' ? `<div class="pf-note pf-sign-err">This court already answers to a different ${provName}.</div>`
            : '';
        return `${door}${err}`;
    }
    function renderSigninSection() {
        const host = document.getElementById('pfSignin');
        if (!host) return;
        host.innerHTML = signinBodyHtml();
        mountGoogleButton();
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
    // table. Two shelves (Wyatt 7/21): 48 free pixel PORTRAITS everyone
    // starts with (assets/avatars/pixel/Icon1..48.png), and 11 PAINTED
    // crests sold for Stars — in the Emporium's Avatars pane and straight
    // from the picker. Worn crest at players/{uid}/avatar, owned paid
    // crests at players/{uid}/crests (+ mirrors favorAvatar/favorCrests).
    // Legacy character-id crests (old rows, the five personas) still
    // RENDER via the character fallback so no seated row ever paints an
    // empty disc — they just left the picker.
    const CRESTS = [
        { id: 'tulip',     name: 'The Tulip',          cost: 25 },
        { id: 'hound',     name: 'The Hound',          cost: 25 },
        { id: 'violin',    name: 'The Violin',         cost: 25 },
        { id: 'griffin',   name: 'The Griffin',        cost: 100 },
        { id: 'snowbeast', name: 'The Snow Beast',     cost: 50 },
        { id: 'serpent',   name: 'The Serpent',        cost: 50 },
        { id: 'owl',       name: 'The White Owl',      cost: 25 },
        { id: 'outlaw',    name: 'The Outlaw',         cost: 100 },
        { id: 'star',      name: 'The Falling Star',   cost: 25 },
        { id: 'fortune',   name: 'The Fortune Teller', cost: 50 },
        { id: 'wolf',      name: 'The Wolf',           cost: 25 },
    ];
    const PIXEL_CREST_COUNT = 48;
    function crestById(id) { return CRESTS.find(c => c.id === id) || null; }
    function myAvatar() {
        return localStorage.getItem('favorAvatar') || (_me && _me.avatar) || null;
    }
    function avatarFile(id) {
        const px = /^px([1-9][0-9]?)$/.exec(id || '');
        if (px && +px[1] <= PIXEL_CREST_COUNT) return `assets/avatars/pixel/Icon${px[1]}.png`;
        if (crestById(id)) return `assets/avatars/${id}.jpg`;
        const c = ((window.FAVOR_DATA || {}).characters || []).find(x => x.id === id);
        return c ? `assets/characters/${c.filename}` : null;
    }
    function ownedCrests() {
        if (_me && _me.crests) return _me.crests;
        try { return JSON.parse(localStorage.getItem('favorCrests') || '{}'); }
        catch (e) { return {}; }
    }
    function mirrorCrests(map) {
        try { localStorage.setItem('favorCrests', JSON.stringify(map || {})); } catch (e) { /* private mode */ }
    }
    function ownsCrest(id) {
        if (/^px/.test(id || '')) return true;   // starters are everyone's
        if (!crestById(id)) return false;        // legacy ids render but can't be re-picked
        if (ownedCrests()[id]) return true;
        // Grandfather: a crest picked during the free week stays honest
        // while worn — switching away is the moment it needs buying.
        return myAvatar() === id;
    }
    function avatarDisc(id, cls) {
        const f = avatarFile(id);
        return f
            ? `<span class="av-disc ${cls || ''}"><img src="${f}" alt=""></span>`
            : `<span class="av-disc av-empty ${cls || ''}"><img src="assets/icons/favor.png" alt=""></span>`;
    }
    async function setAvatar(id) {
        if (!avatarFile(id) || !ownsCrest(id)) return;
        localStorage.setItem('favorAvatar', id);
        _me = { ...(_me || {}), avatar: id };
        try { await dbUpdate(`players/${uid()}`, { avatar: id }); } catch (e) { /* mirror holds */ }
        renderProfileChip();
        if (document.getElementById('profilePanel').classList.contains('active')) openProfile();
    }

    // Purchase — same whole-record transaction discipline as buyCharacter:
    // balance check and ownership commit together or not at all.
    async function buyCrest(crestId) {
        const crest = crestById(crestId);
        if (!crest) return { ok: false, why: 'unknown' };
        if (ownsCrest(crestId)) return { ok: false, why: 'owned' };
        if (mode !== 'firebase') return { ok: false, why: 'offline' };
        // Server-side pre-read — see buyCharacter: never let a player who
        // can't afford it reach the txn (the null stub would materialize
        // nameless rows on the all-time board).
        try {
            const current = await dbGet(`players/${uid()}`);
            if (((current && current.stars) || 0) < crest.cost) return { ok: false, why: 'stars' };
            if (current && current.crests && current.crests[crestId]) return { ok: false, why: 'owned' };
        } catch (e) {
            return { ok: false, why: 'offline' };
        }
        const res = await dbTxn(`players/${uid()}`, p => {
            if (p == null) return { stars: 0 };   // null-guess stub — see buyCharacter
            const stars = p.stars || 0;
            if (stars < crest.cost) return;            // abort — can't afford
            if (p.crests && p.crests[crestId]) return; // abort — exactly once
            return { ...p, stars: stars - crest.cost,
                     crests: { ...(p.crests || {}), [crestId]: true } };
        });
        if (!res.committed || !res.value || !res.value.crests || !res.value.crests[crestId]) {
            return { ok: false, why: 'stars' };
        }
        _me = res.value;
        mirrorCrests(res.value.crests);
        renderProfileChip();
        return { ok: true };
    }

    // ── Table skins — the Stars leg of ui.js's Table Maker shelf. ui.js
    // owns the skins list, the shelf, and equipping; it calls
    // FLB.buyTable(id, price, grantCb) and grants locally only when this
    // ledger leg commits. Ownership lives at players/{uid}/tables/{id}
    // so a purchase survives a reinstall; the local mirror is ui.js's
    // favor_tables_owned (a JSON id array) — UNION the ledger in, never
    // replace, because hero-level and deed grants may exist only locally.
    function mirrorTables(map) {
        try {
            const own = JSON.parse(localStorage.getItem('favor_tables_owned') || '[]');
            const ids = Object.keys(map || {}).filter(k => map[k]);
            localStorage.setItem('favor_tables_owned',
                JSON.stringify([...new Set([...own, ...ids])]));
        } catch (e) { /* private mode */ }
    }
    // Same whole-record discipline as buyCrest: the balance check and the
    // ownership write commit together or not at all. price arrives from
    // ui.js's TABLE_SKINS — sanitized here, but the txn is the authority.
    async function buyTable(tableId, price, grantCb) {
        price = Math.floor(+price || 0);
        if (!tableId || price <= 0) return { ok: false, why: 'unknown' };
        if (mode !== 'firebase') return { ok: false, why: 'offline' };
        try {
            const current = await dbGet(`players/${uid()}`);
            if (current && current.tables && current.tables[tableId]) {
                // Already on the ledger (bought on another device) — the
                // local mirror just lagged. Heal it free of charge.
                mirrorTables(current.tables);
                if (grantCb) grantCb();
                return { ok: true, why: 'owned' };
            }
            // Pre-read affordability — see buyCharacter: never let a player
            // who can't afford it reach the txn (the null stub would
            // materialize nameless rows on the all-time board).
            if (((current && current.stars) || 0) < price) return { ok: false, why: 'stars' };
        } catch (e) {
            return { ok: false, why: 'offline' };
        }
        const res = await dbTxn(`players/${uid()}`, p => {
            if (p == null) return { stars: 0 };   // null-guess stub — see buyCharacter
            const stars = p.stars || 0;
            if (stars < price) return;                 // abort — can't afford
            if (p.tables && p.tables[tableId]) return; // abort — exactly once
            return { ...p, stars: stars - price,
                     tables: { ...(p.tables || {}), [tableId]: true } };
        });
        if (!res.committed || !res.value || !res.value.tables || !res.value.tables[tableId]) {
            return { ok: false, why: 'stars' };
        }
        _me = res.value;
        mirrorTables(res.value.tables);
        renderStore();        // the ★ sign repaints before ui.js re-shelves
        renderProfileChip();
        if (grantCb) grantCb();
        return { ok: true };
    }

    // ── The crest gallery — tap your portrait on the Standing page and
    // every crest shows up here: painted works up top (priced until
    // owned), the 48 starter portraits below. Selecting returns you to
    // Standing wearing it.
    let _confirmingCrest = null;   // two-tap arm — picker and Emporium shelf share it
    function openCrestPicker() {
        _confirmingCrest = null;
        renderCrestPicker();
    }
    function renderCrestPicker() {
        const body = document.getElementById('profileBody');
        if (!body) return;
        const worn = myAvatar();
        const stars = (_me && _me.stars) || 0;
        const px = Array.from({ length: PIXEL_CREST_COUNT }, (_, i) => 'px' + (i + 1));
        body.innerHTML = `
            <div class="cp-head">
                <button class="cp-back" onclick="FLB.openProfile()">‹ Standing</button>
                <span class="cp-stars" title="Your Stars">★ ${stars}</span>
            </div>
            <div class="pf-sec">Painted Crests</div>
            <div class="cp-note">Commissioned works from the Emporium — yours for Stars, forever.</div>
            <div class="pf-avatars cp-paid">${CRESTS.map(c => {
                const owned = ownsCrest(c.id);
                const arm = _confirmingCrest === c.id;
                return `
                <button class="pf-av cp-tile${worn === c.id ? ' on' : ''}${owned ? '' : ' locked'}" data-av="${c.id}"
                    onclick="FLB.crestTap('${c.id}')" title="${c.name}">
                    <img src="assets/avatars/${c.id}.jpg" alt="${c.name}">
                    ${owned ? '' : `<span class="cp-price${arm ? ' arm' : ''}${stars < c.cost ? ' poor' : ''}">${arm ? `Buy ★${c.cost}?` : `★${c.cost}`}</span>`}
                </button>`;
            }).join('')}</div>
            <div class="pf-sec">Portraits</div>
            <div class="pf-avatars cp-px">${px.map(id => `
                <button class="pf-av cp-pxtile${worn === id ? ' on' : ''}" data-av="${id}"
                    onclick="FLB.setAvatar('${id}')">
                    <img src="${avatarFile(id)}" alt="" loading="lazy">
                </button>`).join('')}</div>
        `;
    }
    async function crestTap(id) {
        if (ownsCrest(id)) { setAvatar(id); return; }
        const crest = crestById(id);
        if (!crest) return;
        const stars = (_me && _me.stars) || 0;
        if (stars < crest.cost) {
            // Can't afford — the tag says so for a beat.
            const tag = document.querySelector(`.cp-tile[data-av="${id}"] .cp-price`);
            if (tag) { tag.textContent = 'Not enough ★'; setTimeout(renderCrestPicker, 1200); }
            return;
        }
        if (_confirmingCrest !== id) { _confirmingCrest = id; renderCrestPicker(); return; }
        _confirmingCrest = null;
        const res = await buyCrest(id);
        if (res.ok) {
            await setAvatar(id);   // wear it out of the gallery — lands back on Standing
        } else {
            renderCrestPicker();
            const tag = document.querySelector(`.cp-tile[data-av="${id}"] .cp-price`);
            if (tag) {
                tag.textContent = res.why === 'offline' ? 'Offline' : 'Not enough ★';
                setTimeout(renderCrestPicker, 1200);
            }
        }
    }

    async function renderProfileChip() {
        const chip = document.getElementById('profileChip');
        if (!chip) return;
        _me = await dbGet(`players/${uid()}`) || _me;
        if (_me && _me.avatar && !localStorage.getItem('favorAvatar')) {
            localStorage.setItem('favorAvatar', _me.avatar);   // heal the mirror
        }
        if (_me && _me.crests) mirrorCrests(_me.crests);       // owned crests ride along
        if (_me && _me.tables) mirrorTables(_me.tables);       // owned tables too
        const gold = (_me && _me.champs && _me.champs.gold) || 0;
        chip.innerHTML = `
            ${avatarDisc(myAvatar(), 'pc-av')}
            <span class="pc-name">${myName()}</span>
            ${ratingSpan(eloOf(_me), 'pc-rating')}
            ${gold > 0 ? `<span class="pc-crowns" title="Daily Championships">${CROWN_SVG}${gold}</span>` : ''}
        `;
        // _me just landed — the earned-hero and Side-B-retro latches
        // re-derive (idempotent, menu-gated inside; un-awaited so a
        // celebration never holds the chip). Retro first: "your board
        // turned" before "a stranger arrives".
        checkSideBRetro().then(() => checkEarnedHero()).catch(() => {});
        // _me just landed -- repaint the WANTED plaque so its CLAIMED stamp is
        // driven by the row arriving rather than by a guessed timer. modes.js
        // loads after this file, so on the very first boot FMODES may not exist
        // yet; its own load-time render covers that ordering.
        if (window.FMODES && FMODES.renderRivalPlaque) FMODES.renderRivalPlaque();
    }

    // Wyatt 7/18: "Viewing profile is bad — you just see the different avatars
    // you can choose and then you don't really see much else." He was right:
    // the panel led with a ten-crest picker grid (the visual mass) and then
    // five thin text rows. EVERYTHING below already sat in _me and none of it
    // was rendered. Order now (trimmed again 7/21): standing, the per-hero
    // ledgers, name, sign-in. The top-left crest disc is the one door into
    // the crest gallery.
    function openProfile() {
        const p = _me || { rating: 0, stars: 0, champs: {} };
        const ch = p.champs || {};
        const chars = ((window.FAVOR_DATA || {}).characters || []);
        const elo = eloOf(p);
        const games = p.games || 0;
        const wins = p.wins || 0;
        const rate = games ? Math.round((wins / games) * 100) : 0;

        // p.chars: per-hero { r, g, best }. The biggest win in the panel.
        const ledger = chars
            .map(c => ({ c, s: (p.chars || {})[c.id] }))
            .filter(x => x.s && (x.s.g || 0) > 0)
            .sort((a, b) => (b.s.r || 0) - (a.s.r || 0));

        // Achievements + Today's Bounty left the panel (Wyatt 7/21: "the
        // viewing profile screen right now is an eyesore") — the gallery
        // keeps its own title-screen card and the bounty its WANTED plaque.
        document.getElementById('profileBody').innerHTML = `
            <div class="pf-standing">
                <button class="pf-crest-btn" onclick="FLB.openCrestPicker()" title="Change your crest">
                    ${avatarDisc(myAvatar(), 'pf-av-current')}<span class="pf-crest-edit">✎</span>
                </button>
                <div class="pf-standing-main">
                    <div class="pf-rating">${ratingSpan(elo, 'pf-rating-val')}
                        <span class="pf-tier">Tier ${ratingTier(elo)}</span></div>
                    <div class="pf-record">
                        <b>${wins}</b> W · <b>${games}</b> played${games ? ` · <b>${rate}%</b>` : ''}${(p.bestStreak || 0) > 1 ? ` · best streak <b>${p.bestStreak}</b>` : ''}
                    </div>
                </div>
                <div class="pf-purse">
                    <span title="Stars">★ ${p.stars || 0}</span>
                    <span title="Daily Championships" class="pf-champs">${CROWN_SVG} ${ch.gold || 0}</span>
                </div>
            </div>

            ${ledger.length ? `
            <div class="pf-sec">Your Heroes</div>
            <div class="pf-heroes">${ledger.map(({ c, s }) => `
                <div class="pf-hero" title="${c.name}${c.altSlots && sideBUnlocked(c.id) ? ' — Side B unlocked' : ''}">
                    <img src="assets/characters/${c.filename}" alt="${c.name}">
                    <span class="pf-hero-name">${c.name}</span>
                    <span class="pf-hero-r">${ratingSpan(clampElo(s.r))}</span>
                    <span class="pf-hero-g">${s.g} game${s.g === 1 ? '' : 's'}</span>
                    ${(s.best || 0) > 0 ? `<span class="lb-best"><img class="lb-ico" src="assets/icons/favor.png" alt="">${s.best}</span>` : ''}
                    <div class="pf-xp">${xpRibbonHtml(s.fv || 0, 7, 9)}</div>
                </div>`).join('')}</div>` : `
            <div class="pf-sec">Your Heroes</div>
            <div class="pf-note">Every one you play keeps its own rating and high score.</div>`}

            <div class="pf-sec">Name</div>
            <div class="pf-row pf-namerow">
                <input id="pfName" maxlength="24" value="${myName().replace(/"/g, '&quot;')}">
                <button class="btn-royal" id="pfSave"><span>Save</span></button>
            </div>
            ${signinSectionHtml()}
            ${mode === 'local' ? '<div class="pf-note"><b class="pf-local">LOCAL PROFILE — leaderboard offline</b></div>' : ''}
        `;
        // The COURT SEAL section (copy/paste uid restore) retired 7/20 eve —
        // Court Sign-In above is the restore mechanism now. previewSeal/
        // claimSeal live on as the sign-in machinery's internal token.
        document.getElementById('pfSave').onclick = async () => {
            const okd = await rename(document.getElementById('pfName').value);
            if (okd) { renderProfileChip(); closeProfile(); }
            else document.getElementById('pfName').classList.add('bad');
        };
        mountGoogleButton();   // the section's HTML is in place — GIS can mount
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
        topscores: 'No marks set yet — the first great game is still to be played.',
    };

    // Test residue from the ui-audit suite posts under these names; they are
    // not real players and must never sit on the board (Wyatt 7/17).
    const TEST_NAMES = /^(audit herald|sir auditsworth|audit hero|audit .*)$/i;
    // Suite-generated uids. `uaudit*` is residue and is barred from podiums as
    // well as boards; `uqa*` is a QA identity that deliberately behaves like a
    // real player so the crown/settlement paths can be exercised — it stays
    // off other players' boards but CAN be crowned. Neither is reachable by a
    // real player, whose uid is minted from a different alphabet.
    const TEST_UIDS = /^uaudit/;
    const BOARD_HIDE_UIDS = /^(uaudit|uqa)/;

    // One row per person: drop test/nameless rows and collapse duplicate names
    // (the same name from two uids = audit residue, not two nobles). YOUR own
    // uid always wins its name-group so your row never vanishes; otherwise the
    // higher score is kept. Order is preserved (rows arrive pre-sorted).
    function cleanBoardRows(rows) {
        const out = [];
        const at = new Map();   // lowercased name → index in out
        for (const r of rows) {
            const nm = (r.name || '').trim();
            // Filter test residue — but never YOUR OWN row (a real player is
            // never named 'Audit Herald'; the ui-audit suite runs as one and
            // must still see itself on the board).
            // Also filter by UID PREFIX, not just name: the suite needs some
            // fixtures to carry ordinary-looking names (a row named 'Audit
            // Herald' can never be crowned, so the crown paths could not be
            // tested), and those must still stay off everyone else's board.
            if (!nm || (r.uid !== uid()
                && (TEST_NAMES.test(nm) || BOARD_HIDE_UIDS.test(r.uid || "")))) continue;
            const key = nm.toLowerCase();
            if (at.has(key)) {
                const i = at.get(key);
                const mine = r.uid === uid();
                const keptMine = out[i].uid === uid();
                if ((mine && !keptMine) || (!keptMine && (r.score || 0) > (out[i].score || 0))) {
                    out[i] = r;
                }
                continue;
            }
            at.set(key, out.length);
            out.push(r);
        }
        return out;
    }

    function lbRowHtml(r, rank, tab, opts) {
        const me = r.uid === uid();
        const medal = rank <= 3
            ? `<span class="lb-medal m${rank}">${rank}</span>`
            : `<span class="lb-rank">${rank}</span>`;
        const crowns = r.gold > 0 ? `<span class="lb-crowns">${CROWN_SVG}${r.gold}</span>` : '';
        const score = (tab === 'daily' || tab === 'topscores')
            ? `<img class="lb-ico" src="assets/icons/favor.png" alt="">${r.score}`
            : `✦ ${ratingSpan(r.score)}`;
        // On a hero's board, each row wears its best single-game score with
        // that hero beside the rating (Wyatt 7/17) — the number players hunt.
        const best = (tab && tab.indexOf('char:') === 0 && (r.best || 0) > 0)
            ? `<span class="lb-best" title="Best game with this hero"><img class="lb-ico" src="assets/icons/favor.png" alt="">${r.best}</span>`
            : '';
        return `
            <div class="lb-row${me ? ' me' : ''}${rank <= 3 ? ` podium p${rank}` : ''}${opts && opts.appendix ? ' appendix' : ''}" style="--li:${opts ? opts.idx : 0}">
                ${medal}
                ${avatarDisc(r.avatar, 'lb-av')}
                <span class="lb-name">${r.name || 'Unknown Noble'}${crowns}${me ? '<span class="lb-you">You</span>' : ''}</span>
                ${best}
                <b class="lb-score">${score}</b>
            </div>`;
    }

    // The character rail down the left (Wyatt 7/17): a big crest + name per
    // hero, plus an "All Heroes" chip that returns to the overall board. The
    // whole chip is the click target — inviting the tap the row chips missed.
    function renderCharTabs(tab) {
        const host = document.getElementById('lbCharTabs');
        if (!host) return;
        const chars = ((window.FAVOR_DATA || {}).characters || []);
        // Every non-character tab lights the "All Heroes" chip. Miss a new tab
        // key here and the rail silently mis-lights - this is the one line.
        const overallOn = tab === 'alltime' || tab === 'daily' || tab === 'topscores';
        const allChip = `
            <button class="lb-chartab all${overallOn ? ' on' : ''}"
                    title="Overall standings" onclick="FLB.openLeaderboard('alltime')">
                <span class="lb-chartab-crown">♛</span>
                <span class="lb-chartab-name">All Heroes</span>
            </button>`;
        host.innerHTML = allChip + chars.map(c => `
            <button class="lb-chartab${tab === 'char:' + c.id ? ' on' : ''}"
                    title="${c.name} board" onclick="FLB.openLeaderboard('char:${c.id}')">
                <img src="assets/characters/${c.filename}" alt="${c.name}">
                <span class="lb-chartab-name">${c.name}</span>
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
            } else if (tab === 'topscores') {
                // The archive already exists: daily/* is never pruned in
                // production (settleDue only ever writes settled/{key}), and
                // every row under it is BY CONSTRUCTION one game's score. So
                // the all-time high table is a flatten of all days x all uids,
                // collapsed to each player's best. Ties break earliest-first,
                // matching podiumSort.
                const days = await dbGet('daily') || {};
                const bestBy = new Map();
                for (const day of Object.values(days)) {
                    for (const [u, s] of Object.entries((day && day.scores) || {})) {
                        if (!s || typeof s.best !== 'number') continue;
                        const prev = bestBy.get(u);
                        if (!prev || s.best > prev.best
                            || (s.best === prev.best && (s.at || 0) < prev.at)) {
                            bestBy.set(u, { uid: u, name: s.name, best: s.best, at: s.at || 0 });
                        }
                    }
                }
                rows = [...bestBy.values()]
                    .sort((a, b) => (b.best - a.best) || (a.at - b.at))
                    .map(p => ({
                        ...deck(p.uid, players[p.uid] || { name: p.name }),
                        name: p.name, score: p.best, gold: 0,
                    }));
            } else if (charId) {
                // Your rating WITH that hero — only players who've ridden
                // them into a rated game hold a line on this board.
                rows = Object.entries(players)
                    .filter(([, p]) => p && p.name && p.chars && p.chars[charId]
                        && (p.chars[charId].g || 0) > 0)
                    .map(([u, p]) => ({ ...deck(u, p), score: clampElo(p.chars[charId].r),
                        best: p.chars[charId].best || 0 }))
                    .sort((a, b) => b.score - a.score);
            } else {
                rows = Object.entries(players)
                    .filter(([, p]) => p && p.name)   // nameless stubs stay off the board
                    .map(([u, p]) => ({ ...deck(u, p), score: eloOf(p) }))
                    .sort((a, b) => b.score - a.score);
            }
            rows = cleanBoardRows(rows);
            if (!rows.length) {
                body.innerHTML = `<div class="lb-loading">${charDef
                    ? `No one has ridden the ${charDef.name} into a rated game yet.`
                    : (LB_EMPTY[tab] || LB_EMPTY.alltime)}</div>`;
                return;
            }
            // Top Scores is a TOP TWENTY (Wyatt 7/18); every other board runs
            // fifty deep. Sliced after cleanBoardRows so residue can't eat a
            // slot, and your own rank still rides the appendix row below.
            const limit = tab === 'topscores' ? 20 : 50;
            const myIdx = rows.findIndex(r => r.uid === uid());
            const shown = rows.slice(0, limit);
            let html = shown.map((r, i) => lbRowHtml(r, i + 1, tab, { idx: i })).join('');
            if (myIdx >= limit) {
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
        // Third source: the EARNED hero (spec §6). Derived live from the row
        // when it's here, backed by the add-only mirror when it isn't (cold
        // boot, offline) — and every id must still be an earnedOnly roster
        // row, so a data retreat can never leave a ghost in the pool.
        const eIds = earnedOnlyIds();
        const earnedLive = earnedHeroQualified() ? eIds : [];
        const earnedCached = earnedMirror().filter(id => eIds.includes(id));
        return [...new Set([...freeIds(), ...bought, ...earnedLive, ...earnedCached])];
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
        // The earned hero is not purchasable AT ANY PRICE (spec §6) —
        // refused explicitly, before the Stars check, never a fall-through.
        if (char.earnedOnly) return { ok: false, why: 'earned_only' };
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
            if (_me && _me.tables) mirrorTables(_me.tables);
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
        // The earned hero sits on the shelf LOCKED, the requirement as the
        // button — the lock is the advertisement (spec §6). Never a price.
        if (c.earnedOnly) {
            return owned.includes(c.id)
                ? '<span class="st-owned">Earned</span>'
                : '<span class="st-earn">Reach Level 5 with two heroes</span>';
        }
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
        renderStoreCrests();  // so does the Avatars pane's crest shelf
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

    // ── The Emporium's crest shelf (Avatars pane) — the same 11 painted
    // crests the picker sells: one two-tap confirm, one buyCrest.
    function renderStoreCrests() {
        const box = document.getElementById('stCrests');
        if (!box) return;
        const stars = (_me && _me.stars) || 0;
        box.innerHTML = CRESTS.map(c => {
            const owned = ownsCrest(c.id);
            const arm = _confirmingCrest === c.id;
            let action;
            if (owned) action = '<span class="st-owned">Owned</span>';
            else if (mode !== 'firebase') action = `<button class="st-buy poor" disabled>★ ${c.cost}</button>`;
            else if (arm) action = `<button class="st-buy confirm" onclick="event.stopPropagation(); FLB.confirmBuyCrest('${c.id}')">Buy — ★ ${c.cost}?</button>`;
            else action = `<button class="st-buy${stars < c.cost ? ' poor' : ''}" onclick="event.stopPropagation(); FLB.askBuyCrest('${c.id}')">★ ${c.cost}</button>`;
            return `<div class="st-crest${owned ? ' owned' : ''}" data-crest="${c.id}">
                <span class="av-disc st-crest-disc"><img src="assets/avatars/${c.id}.jpg" alt="${c.name}"></span>
                <span class="st-name">${c.name}</span>
                ${action}
            </div>`;
        }).join('');
    }
    function askBuyCrest(id) {
        const c = crestById(id);
        if (!c) return;
        if (((_me && _me.stars) || 0) < c.cost) {
            const b = document.querySelector(`.st-crest[data-crest="${id}"] .st-buy`);
            if (b) { b.textContent = 'Not enough ★'; setTimeout(renderStoreCrests, 1200); }
            return;
        }
        _confirmingCrest = id;
        renderStoreCrests();
    }
    async function confirmBuyCrest(id) {
        _confirmingCrest = null;
        const res = await buyCrest(id);
        renderStoreCrests();
        if (res.ok) {
            await showCrestCelebration(crestById(id));
        } else if (res.why === 'stars' || res.why === 'offline') {
            const b = document.querySelector(`.st-crest[data-crest="${id}"] .st-buy`);
            if (b) {
                b.textContent = res.why === 'offline' ? 'Offline — try again' : 'Not enough ★';
                setTimeout(renderStoreCrests, 1200);
            }
        }
    }
    function showCrestCelebration(crest) {
        return new Promise(resolve => {
            const ov = document.getElementById('champOverlay');
            if (!ov || !crest) { resolve(); return; }
            document.getElementById('champTitle').textContent = `${crest.name} Is Yours!`;
            document.getElementById('champSub').innerHTML =
                `${CROWN_SVG} A painted crest joins your collection — wear it from your Standing page`;
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
                    await nudgeSealAfterPurchase();
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

    // Real money just landed on an UNSEALED court — one clear-of-browser-data
    // from being stranded (the uid is the account; no Keychain on the web).
    // Offer the seal right behind the celebration, once per purchase. The
    // shells never see this: Keychain already guards them, and the Mint
    // doesn't exist there anyway.
    function nudgeSealAfterPurchase() {
        if (IOS_SHELL) return Promise.resolve();
        if (Object.keys(myIdentities()).length) return Promise.resolve();   // already sealed
        return new Promise(resolve => {
            const ov = document.getElementById('champOverlay');
            if (!ov) { resolve(); return; }
            const btn = document.getElementById('champBtn');
            document.getElementById('champTitle').textContent = 'Seal Your Court';
            document.getElementById('champSub').innerHTML =
                'Your Stars live on this account. Sign in once and it can never be lost — not even on a new device.';
            btn.innerHTML = '<span>Sign In</span>';
            ov.classList.add('active');
            const done = (go) => {
                ov.classList.remove('active');
                btn.innerHTML = '<span>Splendid</span>';   // restore the shared dress
                if (go) {
                    openProfile();
                    const sec = document.getElementById('pfSignin');
                    if (sec) sec.scrollIntoView({ block: 'center' });
                }
                resolve();
            };
            ov.onclick = () => done(false);
            btn.onclick = (e) => { e.stopPropagation(); done(true); };
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
        // The Keychain mirrors whichever court this glass holds, every
        // boot — so a reinstall (storage evicted) walks back in silently
        // via the shell's documentStart heal. And the identity mirror
        // heals from the row, same as the name/avatar mirrors above.
        shellPersistUid(uid());
        if (_me && _me.identities) {
            try { localStorage.setItem('favorIdentity', JSON.stringify(_me.identities)); } catch (e) { /* mirror only */ }
        }
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
        tableDelta, fmtRating, fmtRatingDelta, eloOf, ratingColor, ratingTier, ratingSpan,
        gameStars, fellowshipStars: FELLOWSHIP_STARS_PER_HUMAN,
        ownedIds, buyCharacter, openStore, closeStore, askBuy, confirmBuy,
        inspectChar, closeInspect,
        heroLevel, heroLevelPct, heroFv, sideBUnlocked, xpRibbonHtml,
        checkEarnedHero, showSideBCelebration, sideBLevel: () => SIDEB_LEVEL,
        previewSeal, claimSeal,
        _appleSignIn: appleSignIn, _appleResult,
        _confirmSwitch: confirmSwitch,
        _cancelSign: () => setSignState(null),
        _applyIdentity: applyIdentity,   // rig/verify seam — not a player door
        _nudgeSeal: nudgeSealAfterPurchase,   // rig/verify seam
        askBuyStars, buyStars, starCheckoutUrl, watchForStars,
        starPacks: () => STAR_PACKS,
        setAvatar, myAvatar, avatarDisc, buyTable,
        openCrestPicker, crestTap, askBuyCrest, confirmBuyCrest,
        crests: () => CRESTS, ownsCrest,
        checkForUpdate, applyUpdate,
        get mode() { return mode; }, uid,
    };
})();
