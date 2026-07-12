// ═══════════════════════════════════════════════════════════════════
// FAVOR multiplayer — queue, matchmaking, lockstep command stream (FMP).
//
// Real players match through favor/mp/* on the same Firebase RTDB the
// leaderboard lives on. The design is HOST-FORMED, LOCKSTEP-PLAYED:
//
//   favor/mp/queue/{size}/{uid}   { name, rating, hero, at, hb }
//   favor/mp/games/{gid}          { created, size, seed, hostUid, status,
//                                   roster[], emblemSeat, boonSeat }
//   favor/mp/games/{gid}/moves    push-ordered command stream
//   favor/mp/games/{gid}/presence/{uid} = heartbeat ms
//
// MATCHING (Wyatt's spec): Play Now queues you with your chosen hero.
// While queued you match with anyone else in the same-size queue — the
// EARLIEST entry is the host and forms the game. Each client also rolls
// a random wait window (Nation's pattern); if it expires with nobody
// else queued, you fall into a classic solo table where the persona
// rivals present as people — indistinguishable from a slow lobby.
//
// LOCKSTEP: the game record carries one seed + a canonical roster. Every
// client runs the SAME engine over the SAME shuffles; the only entropy
// left is human choices, and every one of those is published as a move
// and applied by every client in stream order. Each client ROTATES the
// canonical roster so its own human sits at local seat 0 (the table is a
// circle — rotation preserves every neighbor/pass/emblem relationship),
// which keeps the entire seat-0 UI untouched.
//
// AFK (Wyatt's spec): 2 minutes without a required input and the HOST
// publishes afk_boot for that seat — every client converts it to AI and
// the booted player's own client returns them to the menu. A player
// whose presence goes stale (left entirely) is booted on a faster clock.
// If the host itself vanishes, the lowest remaining human uid claims
// hostship by transaction and the duties continue.
// ═══════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    const NS = 'favor/mp';

    // Lockstep build version — bump whenever engine RULES or the move
    // stream change shape (both clients must simulate identically). Queue
    // entries and game records carry it; mismatched builds never pair.
    const MPV = 4;

    // Every timer in one place — the audit suite shrinks these so a boot
    // takes seconds, not minutes. Production values are Wyatt's spec.
    const T = {
        hb: 5000,           // queue heartbeat period
        fresh: 15000,       // queue entry considered live within this
        windowMin: 6000,    // solo-fallback window: min wait
        windowSpread: 12000,//   + random spread (6–18s total)
        afk: 120000,        // 2 min without a required input → boot
        presence: 10000,    // in-game presence heartbeat period
        staleBoot: 45000,   // presence older than this → fast boot
        cleanupAge: 6 * 3600 * 1000, // abandoned game records sweep
    };

    let db = null;
    function fdb() {
        if (db) return db;
        try {
            if (window.firebase && firebase.apps && firebase.apps.length) {
                db = firebase.database();
            }
        } catch (e) { /* unavailable */ }
        return db;
    }
    function available() {
        return !!fdb() && window.FLB && FLB.mode === 'firebase';
    }
    const now = () => Date.now();
    const uid = () => (window.FLB ? FLB.uid() : 'nobody');

    // ── Queue ────────────────────────────────────────────────────────

    let q = null;   // { size, ref, hbTimer, windowTimer, watchOff, done }

    function queueRef(size) { return fdb().ref(`${NS}/queue/${size}`); }

    /**
     * Enter the matchmaking queue. Resolves exactly once:
     *   { solo: true }                       — window expired, play the bots
     *   { game, gid, mySeat }                — matched into a live game
     * onState(kind, detail) narrates for the menu ('searching', 'found').
     *
     * COMMIT-FIRST (Wyatt): Play Now queues you BEFORE you see a hero —
     * the entry carries your 3-hero OFFER; your pick lands later via
     * setQueueHero. A match that forms before you confirm draws your
     * seat's hero from that offer, so backing out can never re-roll.
     */
    function enterQueue({ size, offer, onState }) {
        if (q) cancelQueue();
        const me = uid();
        const entry = {
            name: (window.FLB && localStorage.getItem('favorName')) || 'A Noble',
            rating: 0,
            hero: null,
            offer: Array.isArray(offer) && offer.length ? offer : null,
            avatar: localStorage.getItem('favorAvatar') || null,
            at: firebase.database.ServerValue.TIMESTAMP,
            hb: firebase.database.ServerValue.TIMESTAMP,
            ver: MPV,
        };
        // Rating rides the entry so the host can seat the Emblem honestly.
        try {
            const snap = (window.FLB && typeof FLB.snapshot === 'function') ? FLB.snapshot() : null;
            if (snap) entry.rating = snap.rating || 0;
        } catch (e) { /* rating stays 0 */ }

        return new Promise((resolve) => {
            const ref = queueRef(size).child(me);
            q = { size, ref, done: false };
            const finish = (result) => {
                if (!q || q.done) return;
                q.done = true;
                cancelQueue();
                resolve(result);
            };

            ref.set(entry);
            ref.onDisconnect().remove();
            q.hbTimer = setInterval(() => {
                ref.child('hb').set(firebase.database.ServerValue.TIMESTAMP);
            }, T.hb);

            // Nation's window: if nobody shows before it closes, the fake
            // humans get you. A real match forming cancels it.
            const windowMs = T.windowMin + Math.random() * T.windowSpread;
            q.windowTimer = setTimeout(() => finish({ solo: true }), windowMs);

            // Watch the whole size-pool: my entry gaining a gameId means a
            // host took me; being the earliest live entry with company
            // means I do the forming.
            let forming = false;
            const watchRef = queueRef(size);
            const onValue = async (snap) => {
                if (!q || q.done) return;
                const pool = snap.val() || {};
                const mine = pool[me];
                if (mine && mine.gameId) {
                    // A host claimed me — join their table.
                    const rec = await joinGame(mine.gameId);
                    if (rec) finish(rec);
                    return;
                }
                const live = Object.entries(pool)
                    .filter(([, e]) => e && !e.gameId && e.ver === MPV
                        && (typeof e.hb !== 'number' || now() - e.hb < T.fresh))
                    .sort((a, b) => (a[1].at - b[1].at) || (a[0] < b[0] ? -1 : 1));
                if (onState) onState('searching', { others: Math.max(0, live.length - 1) });
                if (live.length >= 2 && live[0][0] === me && !forming) {
                    forming = true;
                    try {
                        const rec = await formGame(size, live);
                        if (rec) { finish(rec); return; }
                    } catch (e) {
                        console.warn('[FMP] form failed:', e.message);
                    }
                    forming = false;
                }
            };
            watchRef.on('value', onValue);
            q.watchOff = () => watchRef.off('value', onValue);
        });
    }

    // The player picked (or re-picked) a hero while queued — the live
    // entry carries it so the host seats them with their choice. No-op
    // once matched/expired.
    function setQueueHero(heroId) {
        if (!q || q.done || !q.ref) return;
        try { q.ref.child('hero').set(heroId || null); } catch (e) { /* best effort */ }
    }

    function cancelQueue() {
        if (!q) return;
        try {
            if (q.watchOff) q.watchOff();
            clearInterval(q.hbTimer);
            clearTimeout(q.windowTimer);
            q.ref.onDisconnect().cancel();
            q.ref.remove();
        } catch (e) { /* best effort */ }
        q = null;
    }

    // ── Forming a game (host side) ───────────────────────────────────

    // The host owns every random of game setup: seat order, hero
    // collisions, persona fill, the Emblem seat and the boon seat. The
    // record is the single source of truth every client builds from.
    async function formGame(size, liveEntries) {
        const takes = liveEntries.slice(0, size);   // humans, earliest first
        const gid = fdb().ref(`${NS}/games`).push().key;
        const takenHeroes = new Set();
        const roster = [];

        for (const [huid, e] of takes) {
            let hero = e.hero;
            if (!hero || takenHeroes.has(hero)) hero = null;   // collision → offer/fill below
            if (!hero && Array.isArray(e.offer)) {
                // Still browsing (or their pick collided): seat them from
                // their OWN offer — never a hero they don't own.
                const fromOffer = e.offer.filter(h => !takenHeroes.has(h));
                if (fromOffer.length) hero = fromOffer[Math.floor(Math.random() * fromOffer.length)];
            }
            if (hero) takenHeroes.add(hero);
            roster.push({ uid: huid, name: e.name || 'A Noble', hero, rating: e.rating || 0,
                          avatar: e.avatar || null, human: true });
        }

        // Fill the rest of the table exactly like solo: persona rivals by
        // the same odds, generic bots after. Host's tableSeed supplies the
        // live persona ratings.
        let seed = null;
        try {
            seed = await Promise.race([
                FLB.tableSeed(),
                new Promise(r => setTimeout(() => r(null), 1500)),
            ]);
        } catch (e) { seed = null; }
        const personas = ((seed && seed.personas) || []).slice();
        const roll = Math.random();
        let personaCount = roll < 0.2 ? 2 : roll < 2 / 3 ? 1 : 0;
        personaCount = Math.min(personaCount, Math.max(0, size - roster.length), personas.length);
        for (let i = 0; i < personaCount; i++) {
            const p = personas.splice(Math.floor(Math.random() * personas.length), 1)[0];
            roster.push({
                name: p.name, hero: (!takenHeroes.has(p.hero)) ? p.hero : null,
                persona: p.key, personaUid: p.uid, strong: p.strong, rating: p.rating || 0,
            });
            if (roster[roster.length - 1].hero) takenHeroes.add(p.hero);
        }
        const aiNames = ['Prince Aldric', 'Princess Sera', 'Lord Cassius', 'Lady Elara'];
        let ai = 0;
        while (roster.length < size) {
            roster.push({ name: aiNames[ai++ % aiNames.length], hero: null, rating: null });
        }

        // Hero fills: anyone without one draws from the unclaimed roster.
        const allHeroes = window.FAVOR_DATA.characters.map(c => c.id);
        const free = allHeroes.filter(h => !takenHeroes.has(h));
        for (let i = free.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [free[i], free[j]] = [free[j], free[i]];
        }
        roster.forEach(r => { if (!r.hero) { r.hero = free.pop(); } });

        // Emblem: highest rating at the table (humans + personas). Ties →
        // humans before personas, then the lower canonical seat.
        let emblemSeat = Math.floor(Math.random() * size);
        const rated = roster.map((r, i) => ({ i, r }))
            .filter(x => typeof x.r.rating === 'number' && (x.r.human || x.r.persona));
        if (rated.length) {
            const best = Math.max(...rated.map(x => x.r.rating));
            emblemSeat = rated.filter(x => x.r.rating === best)
                .sort((a, b) => ((b.r.human ? 1 : 0) - (a.r.human ? 1 : 0)) || (a.i - b.i))[0].i;
        }

        // Rank-1 boon: only if the all-time #1 sits at THIS table.
        let boonSeat = -1;
        if (seed && seed.topRow) {
            const idx = roster.findIndex(r =>
                (r.human && r.uid === seed.topRow.uid) || (r.personaUid === seed.topRow.uid));
            boonSeat = idx;
        }

        const rec = {
            created: now(), size, status: 'live', ver: MPV,
            seed: Math.floor(Math.random() * 0x7fffffff) || 1,
            hostUid: uid(), roster, emblemSeat, boonSeat,
        };
        await fdb().ref(`${NS}/games/${gid}`).set(rec);

        // Tag every taken human's queue entry so their client joins, then
        // clear the entries (mine included — cancelQueue would double-do).
        for (const [huid] of takes) {
            if (huid === uid()) continue;
            await queueRef(size).child(huid).child('gameId').set(gid);
        }
        return attachGame(gid, rec);
    }

    // A host tagged my queue entry — read the record and attach.
    async function joinGame(gid) {
        const snap = await fdb().ref(`${NS}/games/${gid}`).get();
        const rec = snap.val();
        // A stale-build host (no ver / old ver) simulates different rules —
        // refuse the seat; our solo-window timer still lands us a table,
        // and their side AFK-boots the ghost seat to AI.
        if (!rec || rec.status !== 'live' || rec.ver !== MPV) return null;
        return attachGame(gid, rec);
    }

    // ── Live game runtime — stream, presence, AFK ────────────────────

    let g = null;   // { gid, rec, mySeat, moveQ, waiters, handlers, ... }

    function attachGame(gid, rec) {
        const mySeat = rec.roster.findIndex(r => r.human && r.uid === uid());
        if (mySeat < 0) return null;
        g = {
            gid, rec, mySeat,
            hostUid: rec.hostUid,
            moveQ: [],          // every move in stream order (for sweeps)
            perSeat: {},        // seat → type → FIFO of unconsumed moves
            waiters: [],        // { seat, type, resolve, timer }
            handlers: {},       // type → [cb] for broadcast moves
            booted: new Set(),  // canonical seats already converted
            presenceTimer: null,
            afkTimer: null,
            ended: false,
        };

        const movesRef = fdb().ref(`${NS}/games/${gid}/moves`);
        const onMove = (snap) => {
            const m = snap.val();
            if (!m || typeof m.seat !== 'number' || !m.type) return;
            g.moveQ.push(m);
            (g.handlers[m.type] || []).forEach(cb => { try { cb(m); } catch (e) {} });
            // Broadcast types never queue for waiters.
            if (m.type === 'afk_boot' || m.type === 'sync' || m.type === 'left') return;
            const w = g.waiters.findIndex(x => x.seat === m.seat && x.type === m.type);
            if (w >= 0) {
                const waiter = g.waiters.splice(w, 1)[0];
                clearTimeout(waiter.timer);
                waiter.resolve(m);
                return;
            }
            const bySeat = g.perSeat[m.seat] = g.perSeat[m.seat] || {};
            (bySeat[m.type] = bySeat[m.type] || []).push(m);
        };
        movesRef.on('child_added', onMove);
        g.movesOff = () => movesRef.off('child_added', onMove);

        // Presence: I am here; the host watches for the vanished.
        const presRef = fdb().ref(`${NS}/games/${gid}/presence/${uid()}`);
        presRef.set(now());
        presRef.onDisconnect().remove();
        g.presenceTimer = setInterval(() => {
            presRef.set(now());
            hostSweep();
        }, T.presence);

        return { game: rec, gid, mySeat };
    }

    function active() { return !!g && !g.ended; }
    function mySeat() { return g ? g.mySeat : 0; }
    function isHost() { return g && g.hostUid === uid(); }
    function record() { return g ? g.rec : null; }

    // Canonical seat ↔ local index under the rotation that pins the local
    // human to seat 0: local i = (canon - mySeat + size) % size.
    function localIdx(canonSeat) {
        if (!g) return canonSeat;
        const n = g.rec.size;
        return ((canonSeat - g.mySeat) % n + n) % n;
    }
    function canonSeat(localIdx_) {
        if (!g) return localIdx_;
        return (g.mySeat + localIdx_) % g.rec.size;
    }

    function publish(type, data) {
        if (!active()) return Promise.resolve();
        return fdb().ref(`${NS}/games/${g.gid}/moves`)
            .push({ seat: g.mySeat, type, at: now(), ...(data || {}) });
    }

    /**
     * Await a specific seat's next move of a type. The HOST arms Wyatt's
     * 2-minute AFK clock here: if the wait outlives it, the host publishes
     * afk_boot and every client (this waiter included, via the boot
     * handler) converts the seat to AI. Returns null on boot.
     */
    function waitFor(seat, type) {
        if (!g) return Promise.resolve(null);
        if (g.booted.has(seat)) return Promise.resolve(null);
        const bySeat = g.perSeat[seat];
        if (bySeat && bySeat[type] && bySeat[type].length) {
            return Promise.resolve(bySeat[type].shift());
        }
        return new Promise((resolve) => {
            const waiter = { seat, type, resolve, timer: null };
            if (isHost()) {
                waiter.timer = setTimeout(() => {
                    publish('afk_boot', { target: seat, why: 'afk' });
                }, T.afk);
            }
            g.waiters.push(waiter);
        });
    }

    // Boot delivery: resolve every outstanding waiter on that seat with
    // null (the caller falls back to AI) and remember the conversion.
    function onBroadcast(type, cb) {
        if (!g) return;
        (g.handlers[type] = g.handlers[type] || []).push(cb);
    }
    function markBooted(seat) {
        if (!g) return;
        g.booted.add(seat);
        for (let i = g.waiters.length - 1; i >= 0; i--) {
            if (g.waiters[i].seat === seat) {
                const w = g.waiters.splice(i, 1)[0];
                clearTimeout(w.timer);
                w.resolve(null);
            }
        }
    }

    // Host duties on a cadence: boot the vanished, adopt hostship if the
    // host itself vanished.
    async function hostSweep() {
        if (!active()) return;
        try {
            const snap = await fdb().ref(`${NS}/games/${g.gid}/presence`).get();
            const pres = snap.val() || {};
            const tNow = now();
            if (isHost()) {
                g.rec.roster.forEach((r, seat) => {
                    if (!r.human || seat === g.mySeat || g.booted.has(seat)) return;
                    const last = pres[r.uid];
                    if (!last || tNow - last > T.staleBoot) {
                        publish('afk_boot', { target: seat, why: 'gone' });
                    }
                });
            } else {
                const hostSeat = g.rec.roster.findIndex(r => r.human && r.uid === g.hostUid);
                const hostLast = pres[g.hostUid];
                const hostGone = (!hostLast || tNow - hostLast > T.staleBoot)
                    || (hostSeat >= 0 && g.booted.has(hostSeat));
                if (hostGone) {
                    // Lowest remaining live human uid adopts hostship.
                    const liveHumans = g.rec.roster
                        .filter((r, s) => r.human && !g.booted.has(s) && r.uid !== g.hostUid
                            && pres[r.uid] && tNow - pres[r.uid] <= T.staleBoot)
                        .map(r => r.uid).sort();
                    if (liveHumans[0] === uid()) {
                        const res = await fdb().ref(`${NS}/games/${g.gid}/hostUid`)
                            .transaction(h => (h === g.hostUid ? uid() : undefined));
                        if (res.committed) g.hostUid = uid();
                    } else if (liveHumans.includes(g.hostUid)) {
                        /* unreachable — filtered above */
                    }
                    // Everyone re-reads the field either way.
                    const h = await fdb().ref(`${NS}/games/${g.gid}/hostUid`).get();
                    if (h.exists()) g.hostUid = h.val();
                }
            }
        } catch (e) { /* next sweep retries */ }
    }

    // ── Leaving / ending ─────────────────────────────────────────────

    function leaveGame() {
        if (!g) return;
        try {
            if (g.movesOff) g.movesOff();
            clearInterval(g.presenceTimer);
            fdb().ref(`${NS}/games/${g.gid}/presence/${uid()}`).remove();
        } catch (e) { /* best effort */ }
        g.ended = true;
        g = null;
    }

    // Scoring reached: the host tidies the record after a grace period so
    // slow clients can finish reading the stream.
    function gameOver() {
        if (!g) return;
        const gid = g.gid, host = isHost();
        if (host) {
            try { fdb().ref(`${NS}/games/${gid}/status`).set('done'); } catch (e) {}
            setTimeout(() => {
                try { fdb().ref(`${NS}/games/${gid}`).remove(); } catch (e) {}
            }, 60000);
        }
        leaveGame();
    }

    // Abandoned records from crashed sessions — swept on boot, cheap.
    async function sweepStale() {
        if (!available()) return;
        try {
            const snap = await fdb().ref(`${NS}/games`).get();
            const games = snap.val() || {};
            const cutoff = now() - T.cleanupAge;
            for (const [gid, rec] of Object.entries(games)) {
                if (rec && rec.created && rec.created < cutoff) {
                    await fdb().ref(`${NS}/games/${gid}`).remove();
                }
            }
        } catch (e) { /* non-fatal */ }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(sweepStale, 4000));
    } else {
        setTimeout(sweepStale, 4000);
    }

    // ── Public surface ───────────────────────────────────────────────

    window.FMP = {
        available, enterQueue, cancelQueue, setQueueHero,
        active, mySeat, isHost, record, localIdx, canonSeat,
        publish, waitFor, onBroadcast, markBooted,
        leaveGame, gameOver,
        gid: () => (g ? g.gid : null),
        _T: T,   // timers — the audit suite shrinks these
    };
})();
