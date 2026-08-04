// ═══════════════════════════════════════════════════════════════════
// FAVOR multiplayer — queue, matchmaking, lockstep command stream (FMP).
//
// Real players match through favor/mp/* on the same Firebase RTDB the
// leaderboard lives on. The design is HOST-FORMED, LOCKSTEP-PLAYED:
//
//   favor/mp/queue/{size}/{uid}   { name, rating, offer[], at, hb }
//   favor/mp/games/{gid}          { created, size, seed, hostUid, status,
//                                   roster[], emblemSeat, boonSeat,
//                                   accept{uid:bool}, picks{uid:hero},
//                                   pickStart, dropped[] }
//   favor/mp/games/{gid}/moves    push-ordered command stream
//   favor/mp/games/{gid}/presence/{uid} = heartbeat ms
//
// MATCHING (Wyatt's 7/14 spec): PLAY NOW queues you in the BACKGROUND —
// you keep the menu (leaderboard, store) while a 9–25s window waits for
// real players. The EARLIEST live entry hosts and forms the game record
// as a PROPOSAL; every human gets a MATCH FOUND popup. All accept within
// the window → hero picks open (20s, auto-pick at 0:00) → the host seals
// the roster and the record goes LIVE. Any decline or lapse aborts the
// table: the decliner leaves the queue, survivors keep their entries —
// and their elapsed-time priority. A window that expires alone hands the
// UI a 'solo' event and the SAME theater runs against the persona fill.
//
//   record: proposed ──all accept──▶ picking ──seal──▶ live
//                    └─decline/lapse─▶ aborted
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
    // 5 (7/13): engine RULES changed — slot coins/events now re-fire on every
    // landing, card gold cost gates canPlay, and pick_one persists. Lockstep
    // demands identical simulation, so a v4 client must never pair with a v5.
    // 6 (7/13): the MOVE STREAM gained a type — 'slot_pick' (the Magician's
    // "Pick One" is now the player's choice, not an auto-take). A v5 client
    // would never publish it and would auto-decide instead, so the two
    // simulations diverge the moment a Magician lands on that slot.
    // 7 (7/13): 'slider_move' — Chemical X ("move to ANY slot") is the player's
    // choice too. A v6 client would auto-shove the ring to slot 5 instead of
    // awaiting the pick, so the boards diverge the moment Chemical X is played.
    // 8 (7/14): 'mission_hold' — a mission inside its window but not yet due is
    // now the holder's call at EVERY act boundary (attempt it, or hold it), and
    // that decision is staged in canonical seat order before missions resolve.
    // Two reasons a v7 client cannot sit at this table: it publishes no
    // 'mission_hold' move (so a v8 peer waits on it until the AFK clock boots
    // them), and it still runs the old `pi !== 0` rule — which auto-banked a
    // remote human's met, not-yet-due mission on everyone else's client while
    // their own client held it. That was already a live fork; v8 fixes it.
    // 9 (7/14): 'mission_borrow' now carries `borrowFrom` — WHICH neighbor lends
    // a due mission's missing skill is the player's choice (the 2g-a-unit fee is
    // paid TO them). A v8 client sends no lenders and would re-pick the first
    // available itself, so the fee would land in a different purse on different
    // tables and the gold columns fork.
    // 10 (7/14): the MATCHMAKING HANDSHAKE inverted — records are born
    // 'proposed' (accept/decline popup) and heroes are picked AFTER the accept,
    // so queue entries drop the pre-pick `hero` and rosters carry offers until
    // the host seals them at 'live'. A v9 client would refuse a 'proposed'
    // record outright (its joinGame demanded status 'live') and would wait
    // forever for entry.hero to matter — the ver gate keeps the eras apart.
    // 11 (7/16): the ROUND FLOW inverted — throw first, decide at the reveal.
    // 'pick' and 'final' are gone; humans stream 'throw'/'unthrow' during the
    // round (display + the deterministic lock via collectThrows) and ONE 'act'
    // move per card at their seat's activation slot. A v10 client publishes
    // pick-time decisions no v11 peer consumes and would hang the barrier.
    // 14 (7/18): ARCHEUS gives its victims a CHOICE. The card prints "All
    // other Players must discard 1 weapon card they have", and the engine took
    // the first weapon in play order by findIndex — silently, from everyone,
    // including humans. That determinism was the only reason tables didn't
    // fork here; letting the victim pick makes the outcome client-specific, so
    // there is a new streamed 'weapon' move staged in canonical seat order. A
    // v13 client publishes no 'weapon' move (a v14 peer would wait on it until
    // the AFK clock boots them) and would splice its own first weapon while
    // everyone else applied the chosen one — a straight fork of the played
    // rows, skills and Melee power.
    // ⚠ This bump also carries the day's other rules changes so clients do not
    // have to update twice: Family Ring scores its printed "Favor equal to
    // your total Knowledge x2" instead of granting a phantom +1 Knowledge
    // (which also inflated requirement checks), and grantSlotStones' once-per
    // -game gate is a plain object rather than a Set that no JSON round-trip
    // could survive.
    // 15 (7/18 late): mission success rewards that grant SKILLS now resolve to
    // a FIXED POINT. A mission completed this phase puts its skills on the
    // table for every sibling still resolving, but the old single pass only
    // chained them in whatever order player.missions happened to sit in —
    // acquisition order, which the player does not control. Mounted Champion
    // (+3 Power) before Champion of Legend (needs 8) completed BOTH; the same
    // two the other way round failed Champion of Legend outright. A v14 client
    // resolves one sweep and a v15 client resolves to convergence, so the two
    // disagree about which missions completed — completedMissions, favor,
    // skills and every downstream score fork from that moment.
    // 15 also removes an INVENTED scoring rule: leftover Gold used to convert
    // to Favor at game end (gold x philosopherStone). No card prints it —
    // every Philosopher's Stone reference on every card is a REQUIREMENT or a
    // grant of the token. It dominated once stones stacked (98 of one AI's
    // 121 points). And Secret Lab now scores its printed "5 Favor for each
    // Potions Card" instead of granting +2 Mind's Eye, +2 Knowledge and +5
    // stones — a different card entirely. A v14 client scores every one of
    // these differently, so final standings would disagree outright.
    // 16: the Favor ledger (favorLog streams in getState), two invented Favor
    //     sources removed, and 20 cards retyped off the printed frame colors —
    //     a v15 seat would score the same table differently.
    // 17: Side B boards — picks publish { hero, side } and the sealed roster
    //     carries side per human seat. Lockstep clients must resolve the SAME
    //     board per player (slots, purse, specials) or gold, skills, Mind's
    //     Eye count and the final tally fork on every other screen. A v16
    //     seat can't parse the pick shape and knows nothing of altSlots.
    // 18: Wyatt's alt-board audit (7/20, an hour after 17): Merchant B slot 1
    //     is borrow_any_player ("trade with anyone"), not +1 to four skills,
    //     and Doctor B's free Potion waives REQUIREMENTS as well as gold (the
    //     Map grammar). Unreachable rules until someone hits Level 5, but a
    //     v17 seat that got there would fork the table — bump on principle.
    // 19: the 7/20 XP curve (75-anchor ramp) moves the Side B unlock gate
    //     from 800 to 390 banked Favor. The level math never enters the
    //     lockstep sim, but the gate decides who may publish side:'b' —
    //     bump on principle, per the Side-B precedent.
    // 20 (7/21): paid slides join multiplayer — each 5g step streams as its
    //     own 'slide' move at the actor's reveal, and every peer applies it
    //     just ahead of that seat's 'act'. A v19 seat never publishes or
    //     applies 'slide', so board, purse and skills fork on the first paid
    //     slide. Same window: Chemical Y candidates + doubling now run on
    //     scoredCardFavor (printed + formula) — a v19 AI would double a
    //     different card from the identical state.
    // 21 (7/23): the Merchant counting house (convert_gold_to_prestige) is now
    //     a CHOICE — "the key word is may". A human seat publishes a
    //     'slot_convert' move { convert } at the landing; every peer applies the
    //     same game.applyGoldConvert in stream order. A v20 seat auto-converts
    //     ALL gold to prestige on landing (its old engine path) while a v21
    //     seat waits for the owner's pick — so gold and prestige fork the moment
    //     any human lands on that slot. Booted seats fall back to the shared
    //     aiWouldConvert heuristic, identical on every client.
    // 22 (7/23): game telemetry (js/telemetry.js) — every client records the
    //     table's decision transcript and the HOST uploads it at scoring
    //     (favor/telemetry/games). Recording is read-only wraps around the
    //     same engine calls, so play is byte-identical; the bump keeps
    //     telemetry-aware builds matched (every table has an uploader) and
    //     room game records now carry `room` for the transcript's mode stamp.
    // 23 (7/23): the HARD brain (js/ai.js, Hard-AI Phase 2). Queue records
    //     mark one AI roster row aiLevel:'hard' (highest-rated persona, else
    //     first bot); every client runs FAI for that seat — it drafts by EV,
    //     PAYS TO SLIDE at its activation, discard-slides, and can lose a
    //     mission on purpose. A v22 client would simulate the same seat with
    //     the casual brain and fork on the first hard decision, so the
    //     versions must never mix. Rooms stay casual (hardFill false).
    // 24 (7/23): two mission-math fixes from Wyatt's table. Water Temple
    //     paid its printed 2 Philosopher's Stones TWICE (successRewards +
    //     a duplicate successSpecial — the special is gone from the data);
    //     and favor_per_* formulas (Golden Fiddle's 2-per-Charisma, Fang's
    //     Truce, Family Ring, Great Vault Key) now count flex "OR" units
    //     via formulaSkillCount — a v23 client resolves different stones
    //     and different favor from the identical state.
    // 25 (7/23): resolution PAY ORDER — within a seat's mission phase,
    //     skill-GRANTING missions land before favor_per_* formula missions
    //     (stable partition), so the payout no longer depends on the order
    //     the missions were acquired (Golden Fiddle banked before A Day
    //     With the Birds paid 6 instead of 12 from identical state — and a
    //     v24 client still resolves in acquisition order, so tables fork).
    // 26 (7/23): the Lost North+South pair pays 20 PRESTIGE, not Favor
    //     (Wyatt's art read) — purses fork against v25 the moment a pair
    //     completes. And 'mission_borrow' now streams CANONICAL lender
    //     seats (the card-borrow path always did; this path sent LOCAL
    //     indices, so a rotated peer paid the fee to the wrong purse).
    // 27 (7/24): four table-truth fixes. Gold-cost missions now PAY their
    //     reqGold on completion; slot Philosopher's Stones are POSITIONAL
    //     (count only while the ring stands there — the once-per-game
    //     grant is gone); Mirror Gate / Wild Experiments winners CHOOSE
    //     their duplicate (new 'dup_pick' move; AI/booted seats use the
    //     shared argmax) and the copy's id is a per-player sequence, not
    //     Date.now() (which minted a different id on every client and fed
    //     mpStateHash). All four change resolution state vs v26.
    const MPV = 27;

    // Every timer in one place — the audit suite shrinks these so a boot
    // takes seconds, not minutes. Production values are Wyatt's spec.
    const T = {
        hb: 5000,           // queue heartbeat period
        fresh: 15000,       // queue entry considered live within this
        windowMin: 9000,    // "waiting for real players": min wait
        windowSpread: 16000,//   + random spread (9–25s total)
        accept: 10000,      // MATCH FOUND: answer within this or you lapse
        acceptGrace: 2500,  // host waits this past the window for writes in flight
        pick: 20000,        // Choose Your Hero clock
        pickGrace: 2000,    // host fills stragglers this long after 0:00
        afk: 120000,        // 2 min without a required input → boot
        presence: 10000,    // in-game presence heartbeat period
        staleBoot: 45000,   // presence older than this → fast boot
        cleanupAge: 6 * 3600 * 1000, // abandoned game records sweep
        limboAge: 10 * 60 * 1000,    // proposed/aborted records sweep
        roomEmpty: 120000,  // a private room alone this long folds (Wyatt)
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

    let q = null;   // queue controller — see enterQueue for the state machine

    function queueRef(size) { return fdb().ref(`${NS}/queue/${size}`); }
    function gameRef(gid) { return fdb().ref(`${NS}/games/${gid}`); }

    function emit(kind, d) {
        if (!q || !q.onState) return;
        try { q.onState(kind, d || {}); } catch (e) { /* UI's problem */ }
    }

    function buildEntry(offer) {
        const entry = {
            name: (window.FLB && localStorage.getItem('favorName')) || 'A Noble',
            rating: 0,
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
        return entry;
    }

    /**
     * Enter the matchmaking queue and STAY there — no promise; the queue
     * narrates through onState(kind, detail) and the UI answers through
     * accept()/decline()/publishPick(). Events on the happy path:
     *
     *   'searching' {others}             — pool narration for the chip
     *   'found'     {gid, rec}           — a table is PROPOSED: MATCH FOUND
     *   'accepts'   {n, of}              — court roll-call under the popup
     *   'picking'   {gid, rec, pickStart}— all accepted: hero pick is open
     *   'live'      {game, gid, mySeat}  — roster sealed, lockstep attached
     *
     * And off it:
     *   'solo'      {}        — window expired alone; entry already removed,
     *                           the UI runs the SAME theater against bots
     *   'requeued'  {}        — someone ELSE declined/lapsed; my entry keeps
     *                           its original `at` (elapsed priority), the
     *                           window re-arms, the chip ticks on
     *   'removed'   {reason}  — I'm out: 'declined' (my choice), 'lapse'
     *                           (the popup outwaited me), or 'dissolved'
     *                           (host vanished mid-pick). Queue over.
     */
    function enterQueue({ size, offer, onState }) {
        if (q) cancelQueue();
        const me = uid();
        q = {
            size, me, onState,
            offer: Array.isArray(offer) ? offer : null,
            ref: queueRef(size).child(me),
            state: 'searching',     // searching | proposed | picking
            startedAt: now(),
            prop: null,             // live proposal — see adoptProposal
            forming: false,
        };
        q.ref.set(buildEntry(offer));
        q.ref.onDisconnect().remove();
        startHb();
        armWindow();

        const watchRef = queueRef(size);
        const onValue = (snap) => poolChanged(snap);
        watchRef.on('value', onValue);
        q.watchOff = () => watchRef.off('value', onValue);
    }

    function startHb() {
        if (!q) return;
        clearInterval(q.hbTimer);
        q.hbTimer = setInterval(() => {
            q.ref.child('hb').set(firebase.database.ServerValue.TIMESTAMP);
        }, T.hb);
    }

    // The solo window: 9–25s of honestly waiting for real players. Expiring
    // alone means the realm itself answers — leave the queue and hand the
    // UI its 'solo' event; the MATCH FOUND theater runs the same from here.
    function armWindow() {
        if (!q) return;
        clearTimeout(q.windowTimer);
        const ms = T.windowMin + Math.random() * T.windowSpread;
        q.windowTimer = setTimeout(() => {
            if (!q || q.state !== 'searching') return;
            const fire = q.onState;
            teardownQueue();
            q = null;
            if (fire) try { fire('solo', {}); } catch (e) {}
        }, ms);
    }

    // Watch the whole size-pool: my entry gaining a gameId means a host
    // proposed me a table (I may BE that host — formGame tags its own
    // entry too, so one path serves both); being the earliest live entry
    // with company means I do the forming.
    function poolChanged(snap) {
        if (!q || q.state !== 'searching') return;
        const pool = snap.val() || {};
        const mine = pool[q.me];
        if (mine && mine.gameId) { adoptProposal(mine.gameId); return; }
        const live = Object.entries(pool)
            .filter(([, e]) => e && !e.gameId && e.ver === MPV
                && (typeof e.hb !== 'number' || now() - e.hb < T.fresh))
            .sort((a, b) => (a[1].at - b[1].at) || (a[0] < b[0] ? -1 : 1));
        emit('searching', { others: Math.max(0, live.length - 1) });
        if (live.length >= 2 && live[0][0] === q.me && !q.forming) {
            q.forming = true;
            formGame(q.size, live)
                .then(() => { if (q) q.forming = false; })
                .catch((e) => {
                    console.warn('[FMP] form failed:', e.message);
                    if (q) q.forming = false;
                });
        }
    }

    // A gameId landed on my entry — read the proposal and put it to the
    // player. Everything after this is driven by the RECORD's status.
    async function adoptProposal(gid) {
        if (!q || q.state !== 'searching') return;
        q.state = 'proposed';
        clearTimeout(q.windowTimer);
        let rec = null;
        try { rec = (await gameRef(gid).get()).val(); } catch (e) { rec = null; }
        if (!q || q.state !== 'proposed' || q.prop) return;   // withdrawn mid-read
        if (!rec || rec.status !== 'proposed' || rec.ver !== MPV) {
            // Stale or foreign-build record — shed the tag, keep searching.
            await untagOwnEntry(gid);
            if (!q) return;
            q.state = 'searching';
            armWindow();
            return;
        }
        const prop = q.prop = { gid, accepted: false, answered: false };
        emit('found', { gid, rec });
        const recRef = gameRef(gid);
        const onRec = (snap) => proposalChanged(prop, snap.val());
        recRef.on('value', onRec);
        prop.recOff = () => recRef.off('value', onRec);
        // My accept window: silence = decline. The host runs the same clock
        // (+ grace) server-side, so a dead client can't hold the table.
        prop.lapseT = setTimeout(() => {
            if (q && q.prop === prop && !prop.answered) declineProposal('lapse');
        }, T.accept);
        // Host-vanished watchdog: a record stuck 'proposed' unsticks into a
        // requeue — my entry survives, my priority holds.
        prop.watchdogT = setTimeout(() => {
            if (q && q.prop === prop && q.state === 'proposed') requeueFromProposal();
        }, T.accept + T.acceptGrace + 4000);
    }

    function proposalChanged(prop, rec) {
        if (!q || q.prop !== prop) return;
        if (!rec) {
            // Record vanished under us (abort already swept) — requeue.
            if (q.state === 'proposed' || q.state === 'picking') requeueFromProposal();
            return;
        }
        if (rec.status === 'proposed') {
            const humans = (rec.roster || []).filter(r => r.human);
            const n = humans.filter(r => rec.accept && rec.accept[r.uid] === true).length;
            emit('accepts', { n, of: humans.length });
            return;
        }
        if (rec.status === 'aborted') {
            const droppedMe = Array.isArray(rec.dropped) && rec.dropped.includes(q.me);
            if (droppedMe) {
                // The host's clock beat mine (or my accept write was still in
                // flight) — either way the table moved on without me.
                removeMe('lapse');
            } else {
                requeueFromProposal();
            }
            return;
        }
        if (rec.status === 'picking' && q.state === 'proposed') {
            q.state = 'picking';
            clearTimeout(prop.lapseT);
            clearTimeout(prop.watchdogT);
            // Entries are consumed at picking (the host removed them) — a
            // heartbeat now would resurrect mine as a ghost {hb} row.
            clearInterval(q.hbTimer);
            // Host gone mid-pick → the table dissolves honestly.
            prop.pickWatchdogT = setTimeout(() => {
                if (q && q.prop === prop && q.state === 'picking') removeMe('dissolved');
            }, T.pick + T.pickGrace + 6000);
            emit('picking', { gid: prop.gid, rec, pickStart: rec.pickStart || now() });
            return;
        }
        if (rec.status === 'live' && (q.state === 'picking' || q.state === 'proposed')) {
            // Sealed. Retire the queue machinery, attach the lockstep game.
            const fire = q.onState;
            teardownQueue();
            q = null;
            const res = attachGame(prop.gid, rec);
            if (res && fire) try { fire('live', res); } catch (e) {}
            return;
        }
    }

    // ACCEPT — the popup's gold button. The record watcher drives the rest.
    function accept() {
        if (!q || !q.prop || q.prop.answered) return;
        q.prop.answered = true;
        q.prop.accepted = true;
        clearTimeout(q.prop.lapseT);
        try { gameRef(q.prop.gid).child(`accept/${q.me}`).set(true); } catch (e) {}
    }

    // DECLINE — by choice or by lapse. Out of the queue, no penalty; the
    // host sees the false (or my missing accept) and aborts for the rest.
    async function declineProposal(reason) {
        if (!q || !q.prop) return;
        const prop = q.prop;
        prop.answered = true;
        clearTimeout(prop.lapseT);
        try { await gameRef(prop.gid).child(`accept/${q.me}`).set(false); } catch (e) {}
        removeMe(reason);
    }

    function removeMe(reason) {
        if (!q) return;
        const fire = q.onState;
        teardownQueue();
        q = null;
        if (fire) try { fire('removed', { reason }); } catch (e) {}
    }

    // Someone else sank the proposal — my entry (and its original `at`)
    // survives, so the earliest live entry still hosts the next table.
    async function requeueFromProposal() {
        if (!q || !q.prop) return;
        const prop = q.prop;
        q.prop = null;
        clearTimeout(prop.lapseT);
        clearTimeout(prop.watchdogT);
        clearTimeout(prop.pickWatchdogT);
        if (prop.recOff) prop.recOff();
        q.state = 'searching';
        await untagOwnEntry(prop.gid);
        if (!q || q.state !== 'searching') return;
        // Crash-window insurance: if the entry itself was lost, re-assert it
        // (fresh `at` only in that edge — the normal path never lands here).
        try {
            const cur = (await q.ref.get()).val();
            if (!q || q.state !== 'searching') return;
            if (!cur) {
                q.ref.set(buildEntry(q.offer));
                q.ref.onDisconnect().remove();
            }
        } catch (e) { /* best effort */ }
        startHb();
        armWindow();
        emit('requeued', {});
    }

    // Shed a proposal tag without clobbering a NEWER host's claim. (A get
    // + conditional remove, not a transaction: the RTDB null-guess trap
    // makes remove-if-equal transactions cancel on an empty local cache.)
    async function untagOwnEntry(gid) {
        if (!q) return;
        try {
            const tag = (await q.ref.child('gameId').get()).val();
            if (tag === gid) await q.ref.child('gameId').remove();
        } catch (e) { /* best effort */ }
    }

    function cancelQueue() {
        if (!q) return;
        if (q.prop) { declineProposal('declined'); return; }   // safety — UI hides Withdraw mid-popup
        teardownQueue();
        q = null;
    }

    function teardownQueue() {
        if (!q) return;
        try {
            if (q.watchOff) q.watchOff();
            clearInterval(q.hbTimer);
            clearTimeout(q.windowTimer);
            if (q.prop) {
                clearTimeout(q.prop.lapseT);
                clearTimeout(q.prop.watchdogT);
                clearTimeout(q.prop.pickWatchdogT);
                if (q.prop.recOff) q.prop.recOff();
            }
            q.ref.onDisconnect().cancel();
            // Also mops up any ghost {hb} row a final heartbeat left behind.
            q.ref.remove();
        } catch (e) { /* best effort */ }
    }

    // ── Forming a game (host side) ───────────────────────────────────

    // The host owns every random of game setup EXCEPT heroes: seat order,
    // persona fill, the Emblem seat and the boon seat are fixed at the
    // proposal; heroes are picked by their players AFTER everyone accepts
    // and sealed by the host when the pick window closes. The record is
    // the single source of truth every client builds from.
    // The record itself — the queue's formGame and a room's Start both
    // land here: persona/bot fill by the same odds, the rated Emblem, the
    // rank-1 boon, one seed, MPV. humanRows arrive earliest-first.
    async function buildGameRecord(size, humanRows, hardFill = true) {
        const roster = humanRows.slice();

        // Fill the rest of the table exactly like solo: persona rivals by
        // the same odds, generic bots after. Host's tableSeed supplies the
        // live persona ratings. Signature heroes wait for the seal (a
        // human's pick outranks a persona's wardrobe).
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
                name: p.name, hero: null, sigHero: p.hero || null,
                persona: p.key, personaUid: p.uid, strong: p.strong, rating: p.rating || 0,
            });
        }
        // Fake humans wear the casual pool (Wyatt 7/17) — never renaissance.
        const pool = (window.CASUAL_AI_NAMES || ['Frisky Teacher', 'Soggy Waffle',
            'Turbo Grandma', 'Midnight Snacker']).slice();
        const aiNames = typeof window.shuffleArray === 'function'
            ? window.shuffleArray(pool) : pool;
        let ai = 0;
        while (roster.length < size) {
            roster.push({ name: aiNames[ai++ % aiNames.length], hero: null, rating: null });
        }

        // Hard seat (Hard-AI §5d): a QUEUE table with any AI seat carries
        // exactly one hard brain — the highest-rated persona, else the
        // first generic bot. Private rooms pass hardFill false and stay
        // the casual tier. The flag rides the shared record so every
        // client simulates the same seat. A rig may force it on for a
        // lockstep probe via window._forceHardFill (verify seam).
        if (hardFill || window._forceHardFill) {
            const aiRows = roster.map((r, i) => ({ r, i })).filter(x => !x.r.human);
            if (hardFill === 'all') {
                // A hard ROOM (host's explicit toggle): the whole fill sharpens.
                aiRows.forEach(x => { x.r.aiLevel = 'hard'; });
            } else {
                const personaRows = aiRows.filter(x => x.r.persona);
                const pick = personaRows.length
                    ? personaRows.sort((a, b) => ((b.r.rating || 0) - (a.r.rating || 0)) || (a.i - b.i))[0]
                    : aiRows[0];
                if (pick) pick.r.aiLevel = 'hard';
            }
        }

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
            boonSeat = roster.findIndex(r =>
                (r.human && r.uid === seed.topRow.uid) || (r.personaUid === seed.topRow.uid));
        }

        return {
            created: now(), size, status: 'proposed', ver: MPV,
            seed: Math.floor(Math.random() * 0x7fffffff) || 1,
            hostUid: uid(), roster, emblemSeat, boonSeat,
        };
    }

    async function formGame(size, liveEntries) {
        const takes = liveEntries.slice(0, size);   // humans, earliest first
        const gid = fdb().ref(`${NS}/games`).push().key;

        const humanRows = takes.map(([huid, e]) => ({
            uid: huid, name: e.name || 'A Noble', hero: null,
            offer: Array.isArray(e.offer) && e.offer.length ? e.offer : null,
            rating: e.rating || 0, avatar: e.avatar || null, human: true,
        }));
        const rec = await buildGameRecord(size, humanRows);
        await fdb().ref(`${NS}/games/${gid}`).set(rec);

        // Tag EVERY taken entry — self included. Tagged entries are
        // invisible to other formers, and each client (this host included)
        // adopts the proposal from its own tag: one path for everyone.
        for (const [huid] of takes) {
            await queueRef(size).child(huid).child('gameId').set(gid);
        }
        refereeAccepts(gid, rec);
        return gid;
    }

    // ── The host referees the handshake ──────────────────────────────

    // Accept phase: every human answers within the window (+ grace for
    // writes in flight) or the table aborts — decliners and the silent
    // leave the queue, survivors are untagged with their priority intact.
    function refereeAccepts(gid, rec) {
        const humans = rec.roster.filter(r => r.human).map(r => r.uid);
        const accRef = gameRef(gid).child('accept');
        let done = false;
        const finish = () => { done = true; accRef.off('value', onAcc); clearTimeout(deadline); };
        const onAcc = (snap) => {
            if (done) return;
            const acc = snap.val() || {};
            const declined = humans.filter(u => acc[u] === false);
            if (declined.length) { finish(); abortProposal(gid, rec, declined); return; }
            if (humans.every(u => acc[u] === true)) {
                finish();
                (async () => {
                    try {
                        await gameRef(gid).update({
                            status: 'picking',
                            pickStart: firebase.database.ServerValue.TIMESTAMP,
                        });
                        // Entries are consumed — these seats are committed.
                        for (const u of humans) await queueRef(rec.size).child(u).remove();
                    } catch (e) { /* clients' watchdogs cover a half-write */ }
                    refereePicks(gid, rec);
                })();
            }
        };
        const deadline = setTimeout(async () => {
            if (done) return;
            let acc = {};
            try { acc = (await accRef.get()).val() || {}; } catch (e) {}
            if (done) return;
            const dropped = humans.filter(u => acc[u] !== true);
            if (!dropped.length) return;   // all accepted — onAcc is flipping to picking
            finish();
            abortProposal(gid, rec, dropped);
        }, T.accept + T.acceptGrace);
        accRef.on('value', onAcc);
    }

    async function abortProposal(gid, rec, dropped) {
        try {
            await gameRef(gid).update({ status: 'aborted', dropped });
            for (const r of rec.roster) {
                if (!r.human) continue;
                const eref = queueRef(rec.size).child(r.uid);
                if (dropped.includes(r.uid)) {
                    await eref.remove();   // decliners/silents leave the queue
                } else {
                    // Survivors keep their place and their elapsed priority —
                    // shed only the tag (conditionally: a faster next host
                    // may already have re-claimed them).
                    const tag = (await eref.child('gameId').get()).val();
                    if (tag === gid) await eref.child('gameId').remove();
                }
            }
        } catch (e) { /* sweepStale collects the wreck */ }
        // The record outlives the abort long enough for every client to
        // read the verdict, then goes.
        setTimeout(() => { gameRef(gid).remove().catch(() => {}); }, 15000);
    }

    // Pick phase: everyone answered early → seal now (no dead air);
    // otherwise 0:00 + grace, stragglers fill from their own offers.
    function refereePicks(gid, rec) {
        const humans = rec.roster.filter(r => r.human).map(r => r.uid);
        const picksRef = gameRef(gid).child('picks');
        let sealed = false;
        const trySeal = async (picks) => {
            if (sealed) return;
            sealed = true;
            picksRef.off('value', onPicks);
            clearTimeout(deadline);
            try { await sealRoster(gid, rec, picks || {}); }
            catch (e) { console.warn('[FMP] seal failed:', e.message); }
        };
        const onPicks = (snap) => {
            const picks = snap.val() || {};
            if (humans.every(u => picks[u])) trySeal(picks);
        };
        const deadline = setTimeout(async () => {
            let picks = {};
            try { picks = (await picksRef.get()).val() || {}; } catch (e) {}
            trySeal(picks);
        }, T.pick + T.pickGrace);
        picksRef.on('value', onPicks);
    }

    // Seal: turn picks into the final roster. Canonical seat order resolves
    // hero collisions (two offers CAN share a hero — the earlier seat keeps
    // it, the later seat falls back to its own offer, then the free pool);
    // personas take their signature when it survived; everyone left draws
    // from the unclaimed shuffle. The COMPUTE half stands alone so the
    // Throne's transactional seal resolves rosters by the same law.
    function computeSealedRoster(rec, picks) {
        // ⚠ allHeroes does TWO jobs — it VALIDATES a human's published pick
        // and (via botPool below) FILLS empty seats. It must stay WHOLE for
        // validation: strip the earned hero from it and a human who owns it
        // gets their pick silently rejected and reassigned. Only the fill
        // pool excludes earned-only heroes (and personas' sigHero is a
        // hardcoded original, so it needs no filter).
        const allHeroes = window.FAVOR_DATA.characters.map(c => c.id);
        const botPool = window.FAVOR_DATA.characters
            .filter(c => !c.earnedOnly).map(c => c.id);
        const taken = new Set();
        const roster = rec.roster.map(r => ({ ...r }));
        for (const r of roster) {
            if (!r.human) continue;
            // v17 pick shape: { hero, side } — side rides the roster so every
            // lockstep client resolves the same board for this seat. The
            // MPV gate keeps pre-17 shapes out of the pool entirely.
            const pk = picks[r.uid];
            let hero = pk && typeof pk === 'object' ? pk.hero : pk;
            const side = pk && typeof pk === 'object' && pk.side === 'b' ? 'b' : null;
            if (!hero || !allHeroes.includes(hero) || taken.has(hero)) hero = null;
            if (!hero && Array.isArray(r.offer)) {
                const fromOffer = r.offer.filter(h => allHeroes.includes(h) && !taken.has(h));
                if (fromOffer.length) hero = fromOffer[0];
            }
            if (hero) {
                r.hero = hero;
                taken.add(hero);
                // The side only survives on the hero it was chosen FOR — a
                // collision fallback rides Side A, never a stale side.
                if (side && pk.hero === hero) r.side = 'b';
            }
        }
        for (const r of roster) {
            if (r.human || !r.persona) continue;
            if (r.sigHero && !taken.has(r.sigHero)) { r.hero = r.sigHero; taken.add(r.sigHero); }
        }
        const free = botPool.filter(h => !taken.has(h));
        for (let i = free.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [free[i], free[j]] = [free[j], free[i]];
        }
        roster.forEach(r => {
            if (!r.hero) { r.hero = free.pop() || allHeroes[0]; taken.add(r.hero); }
            delete r.offer;      // the sealed roster carries no scaffolding
            delete r.sigHero;    // (r.side survives — the table needs it)
        });
        return roster;
    }

    async function sealRoster(gid, rec, picks) {
        const roster = computeSealedRoster(rec, picks || {});
        await gameRef(gid).update({ status: 'live', roster });
    }

    // The player picked (or the 20s clock picked for them) — the record
    // carries it; the host seals from these. Queue matches and room games
    // both answer here: whichever pick phase is live owns the target.
    let _roomPickGid = null;
    function publishPick(heroId, side) {
        const gid = (q && q.prop && q.state === 'picking') ? q.prop.gid : _roomPickGid;
        if (!gid) return;
        // v17 shape: { hero, side } — side 'b' only ever arrives from a
        // client whose own level unlocked it (chosenSideFor validates).
        const pick = heroId ? { hero: heroId, side: side === 'b' ? 'b' : 'a' } : null;
        try { gameRef(gid).child(`picks/${uid()}`).set(pick); } catch (e) {}
    }

    // ── Private rooms — a lobby that hands off to the pick pipeline ──
    // favor/mp/rooms/{CODE} = { created, hostUid, size, ver, status,
    //                           seats:{uid:{name,avatar,rating,offer,at}}, gameId? }
    // The lobby IS the accept: Start births the game record 'proposed'
    // exactly like a queue match, every room client answers yes on sight,
    // and the standard picking → seal → live pipeline takes it from there.
    let r = null;   // { code, host, onState, off, recOff, emptyT, watchdogT, adopted, picking, starting }

    function roomRef(code) { return fdb().ref(`${NS}/rooms/${code}`); }

    function genRoomCode() {
        const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O/1/I/L lookalikes
        let c = '';
        for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)];
        return c;
    }

    function roomSeatEntry(offer) {
        const e = buildEntry(offer);
        return { name: e.name, rating: e.rating, avatar: e.avatar,
                 offer: e.offer, at: firebase.database.ServerValue.TIMESTAMP };
    }

    function roomEmit(kind, d) {
        if (!r || !r.onState) return;
        try { r.onState(kind, d || {}); } catch (e) { /* UI's problem */ }
    }

    function hostRoom({ size, offer, onState }) {
        if (!available()) { try { onState('closed', { reason: 'gone' }); } catch (e) {} return; }
        if (r) leaveRoom();
        const code = genRoomCode();
        r = { code, host: true, onState, adopted: false };
        const me = uid();
        roomRef(code).set({
            created: now(), hostUid: me, size: [3, 4, 5].includes(size) ? size : 3,
            ver: MPV, status: 'open',
            seats: { [me]: roomSeatEntry(offer) },
        });
        roomRef(code).onDisconnect().remove();   // host-owned: host gone → room gone
        // Alone at the deadline → the room folds (Wyatt's two-minute rule).
        r.emptyT = setTimeout(async () => {
            if (!r || r.code !== code || r.adopted) return;
            let cur = null;
            try { cur = (await roomRef(code).get()).val(); } catch (e) {}
            if (!r || r.code !== code || r.adopted) return;
            if (cur && Object.keys(cur.seats || {}).length <= 1 && !cur.gameId) {
                const fire = r.onState;
                teardownRoomState();
                try { roomRef(code).onDisconnect().cancel(); roomRef(code).remove(); } catch (e) {}
                try { fire('closed', { reason: 'empty' }); } catch (e) {}
            }
        }, T.roomEmpty);
        watchRoom(code);
    }

    async function joinRoom(code, { offer, onState }) {
        if (!available()) { try { onState('closed', { reason: 'gone' }); } catch (e) {} return; }
        if (r) leaveRoom();
        r = { code, host: false, onState, adopted: false };
        let rec = null;
        try { rec = (await roomRef(code).get()).val(); } catch (e) {}
        if (!r || r.code !== code) return;
        const refuse = (reason) => { r = null; try { onState('closed', { reason }); } catch (e) {} };
        if (!rec || rec.status !== 'open') return refuse('missing');
        if (rec.ver !== MPV) return refuse('version');
        if (Object.keys(rec.seats || {}).length >= (rec.size || 3)) return refuse('full');
        const me = uid();
        try {
            await roomRef(code).child(`seats/${me}`).set(roomSeatEntry(offer));
            roomRef(code).child(`seats/${me}`).onDisconnect().remove();
        } catch (e) { return refuse('gone'); }
        if (!r || r.code !== code) return;
        watchRoom(code);
    }

    function watchRoom(code) {
        const ref = roomRef(code);
        const onVal = (snap) => {
            if (!r || r.code !== code) return;
            const rec = snap.val();
            if (!rec) {
                if (r.adopted) return;   // the game started; the room was swept
                const host = r.host;
                const fire = r.onState;
                teardownRoomState();
                try { fire('closed', { reason: host ? 'gone' : 'host_left' }); } catch (e) {}
                return;
            }
            if (!rec.seats || !rec.seats[uid()]) {
                if (r.adopted) return;
                const fire = r.onState;
                teardownRoomState();
                try { fire('closed', { reason: 'gone' }); } catch (e) {}
                return;
            }
            if (rec.gameId && !r.adopted) {
                r.adopted = true;
                clearTimeout(r.emptyT);
                adoptRoomGame(rec.gameId);
                return;
            }
            roomEmit('room', { code, rec });
        };
        ref.on('value', onVal);
        r.off = () => ref.off('value', onVal);
    }

    function roomSetSize(n) {
        if (!r || !r.host || ![3, 4, 5].includes(n)) return;
        try { roomRef(r.code).child('size').set(n); } catch (e) {}
    }

    // Host toggle (Wyatt 7/24): the room's AI fill runs the HARD brain.
    // Rides the room record so every lobby shows it; the game record's
    // roster rows carry the per-seat aiLevel every client already applies
    // (since v23), so no protocol change — and rooms refuse mixed MPVs
    // anyway. Default stays the casual tier.
    function roomSetHard(v) {
        if (!r || !r.host) return;
        try { roomRef(r.code).child('hard').set(!!v); } catch (e) {}
    }

    async function roomStart() {
        if (!r || !r.host || r.adopted || r.starting) return;
        r.starting = true;
        let rec = null;
        try { rec = (await roomRef(r.code).get()).val(); } catch (e) {}
        if (!r || !rec) { if (r) r.starting = false; return; }
        const humanRows = Object.entries(rec.seats || {})
            .sort((a, b) => (a[1].at || 0) - (b[1].at || 0))
            .slice(0, rec.size || 3)
            .map(([hu, e]) => ({
                uid: hu, name: e.name || 'A Noble', hero: null,
                offer: Array.isArray(e.offer) && e.offer.length ? e.offer : null,
                rating: e.rating || 0, avatar: e.avatar || null, human: true,
            }));
        // Rooms fill casual unless the host flipped the HARD toggle — then
        // EVERY AI seat runs the sharp brain (an explicit choice, unlike
        // the queue's silent single hard seat).
        const gameRec = await buildGameRecord(rec.size || 3, humanRows, rec.hard ? 'all' : false);
        if (!r) return;
        gameRec.room = r.code;   // telemetry stamps private tables mode:'room'
        const gid = fdb().ref(`${NS}/games`).push().key;
        try {
            await fdb().ref(`${NS}/games/${gid}`).set(gameRec);
            await roomRef(r.code).update({ status: 'starting', gameId: gid });
        } catch (e) { if (r) r.starting = false; return; }
        refereeAccepts(gid, gameRec);
    }

    // The lobby was the accept — answer yes and ride the standard pipeline.
    function adoptRoomGame(gid) {
        const code = r.code;
        try { gameRef(gid).child(`accept/${uid()}`).set(true); } catch (e) {}
        const recRef = gameRef(gid);
        const onRec = (snap) => {
            if (!r || r.code !== code) { recRef.off('value', onRec); return; }
            const rec = snap.val();
            if (!rec || rec.status === 'aborted') {
                recRef.off('value', onRec);
                const fire = r.onState;
                teardownRoomState();
                _roomPickGid = null;
                try { fire('closed', { reason: 'gone' }); } catch (e) {}
                return;
            }
            if (rec.status === 'picking' && !r.picking) {
                r.picking = true;
                _roomPickGid = gid;
                // Host gone mid-pick → dissolve honestly (queue parity).
                r.watchdogT = setTimeout(() => {
                    if (!r || r.code !== code) return;
                    const fire = r.onState;
                    teardownRoomState();
                    _roomPickGid = null;
                    try { fire('closed', { reason: 'gone' }); } catch (e) {}
                }, T.pick + T.pickGrace + 6000);
                roomEmit('picking', { gid, rec, pickStart: rec.pickStart || now() });
                return;
            }
            if (rec.status === 'live') {
                recRef.off('value', onRec);
                const fire = r.onState;
                const wasHost = r.host;
                teardownRoomState();
                _roomPickGid = null;
                const res = attachGame(gid, rec);
                if (wasHost) {
                    try { roomRef(code).onDisconnect().cancel(); roomRef(code).remove(); } catch (e) {}
                }
                if (res) try { fire('live', res); } catch (e) {}
                return;
            }
        };
        recRef.on('value', onRec);
        r.recOff = () => recRef.off('value', onRec);
    }

    function teardownRoomState() {
        if (!r) return;
        try {
            if (r.off) r.off();
            if (r.recOff) r.recOff();
            clearTimeout(r.emptyT);
            clearTimeout(r.watchdogT);
        } catch (e) { /* best effort */ }
        r = null;
    }

    function leaveRoom() {
        if (!r) return;
        const code = r.code, host = r.host, adopted = r.adopted;
        teardownRoomState();
        _roomPickGid = null;
        if (adopted) return;   // mid-handshake — the game record owns the flow now
        try {
            if (host) {
                roomRef(code).onDisconnect().cancel();
                roomRef(code).remove();
            } else {
                roomRef(code).child(`seats/${uid()}`).onDisconnect().cancel();
                roomRef(code).child(`seats/${uid()}`).remove();
            }
        } catch (e) { /* best effort */ }
    }

    // ── THE THRONE ROOM — the nightly hall (ship 2 of 3) ─────────────
    // One moment a night when everyone plays at once. The menu door
    // opens 9:15:00–9:17:59 PM America/New_York; everyone inside stands
    // in ONE lobby:
    //
    //   favor/throne/{dateKey}/lobby/{uid} = { name, rating, crest,
    //                                          offer, at, hb, ver }
    //   favor/throne/{dateKey}/draw = { at, by, roster:[uid…],
    //       games: { g1: { uids:[…], size, ai?, gameId }, … } }
    //
    // At 9:18 the pool is partitioned into tables of 4 and 5. No server
    // process — the settleDue pattern: the first live client past the
    // bar claims the draw with a create-once transaction; everyone else
    // just reads it. The partition is DETERMINISTIC from a dateKey-
    // seeded mulberry32 (the engine's own PRNG — the lockstep
    // no-unseeded-RNG law), so racing claimants name the same tables.
    //
    // There is NO propose/decline — standing in the hall at the bar IS
    // the accept (the private-room precedent, minus even the popup).
    // Records are born at status 'picking' (never 'proposed'): no
    // accept referee, no abort path, nobody can sink a table for the
    // other three. The standard hero-pick → seal → live pipeline runs
    // from there and the attach is exactly a sealed queue match. The
    // throne seal is a TRANSACTION (unlike the queue's plain update):
    // the claimant referees every table it dealt, any member's watchdog
    // referees its own if the claimant died, and only one seal commits.
    //
    // Device clocks lie, so every gate reads RTDB server time:
    // estimated server now = Date.now() + .info/serverTimeOffset.

    const THNS = 'favor/throne';
    const TH = {
        openMin: 21 * 60 + 15,   // 9:15:00 PM ET — the doors open
        barMin:  21 * 60 + 18,   // 9:18:00 — doors barred, the draw
        sealEndMin: 22 * 60,     // court in session until 10 PM, then
                                 // the door counts to tomorrow's 9:15
    };

    let t = null;   // hall controller — see throneJoin
    let _srvOff = 0, _srvOffOn = false;

    function watchSrvOffset() {
        if (_srvOffOn || !fdb()) return;
        _srvOffOn = true;
        try {
            fdb().ref('.info/serverTimeOffset').on('value',
                s => { _srvOff = s.val() || 0; });
        } catch (e) { _srvOffOn = false; }
    }

    // Server-estimated now, two flavors. srvNow answers "what time of
    // night is it" — every PHASE gate reads it, and window._throneNow
    // (the audit suite's time machine) bends it to force whole fake
    // nights. srvReal answers "is this heartbeat alive" — hb stamps are
    // REAL server timestamps, so liveness must never read the bent
    // clock (under a fake night every row would look years stale and
    // the draw would seat nobody).
    function srvReal() { return now() + _srvOff; }
    function srvNow() {
        if (typeof window._throneNow === 'function') return window._throneNow();
        return srvReal();
    }

    const _etFmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    function etClock(ms) {
        const p = {};
        _etFmt.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
        return {
            key: `${p.year}-${p.month}-${p.day}`,   // the night's dateKey:
            // the plain ET calendar date — NOT the daily board's 10 PM
            // rollover key; a Throne night never crosses its own boundary.
            sec: (parseInt(p.hour, 10) % 24) * 3600
                + parseInt(p.minute, 10) * 60 + parseInt(p.second, 10),
        };
    }

    // The door's three states, from server time. ET wall-clock seconds
    // (the once-a-year DST boundary night drifts an hour; nobody is
    // harmed — the same posture as the daily 10 PM window).
    // Wyatt (8/3): "make the throne room 10 p.m. tonight, but just
    // tonight." One dateKey gets its own window — this night opens at
    // 10:00:00 PM ET (bar 10:03, court until 10:45); every other night
    // reads the TH law above. Self-expiring: the key never matches
    // again, so there is no revert ship to forget.
    const TH_NIGHTS = {
        '2026-08-03': { openMin: 22 * 60, barMin: 22 * 60 + 3, sealEndMin: 22 * 60 + 45 },
    };
    function nightTH(key) { return TH_NIGHTS[key] || TH; }
    function thLabel(min, withMeridiem) {
        const h = Math.floor(min / 60), m = min % 60;
        return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${withMeridiem ? ' PM' : ''}`;
    }
    function throneOpenLabel() { return thLabel(nightTH(etClock(srvNow()).key).openMin, true); }
    function throneBarLabel() { return thLabel(nightTH(etClock(srvNow()).key).barMin, false); }

    function thronePhase(ms) {
        watchSrvOffset();
        const c = etClock(typeof ms === 'number' ? ms : srvNow());
        const W = nightTH(c.key);
        const open = W.openMin * 60, bar = W.barMin * 60, end = W.sealEndMin * 60;
        if (c.sec >= open && c.sec < bar) {
            return { phase: 'open', key: c.key, msToBar: (bar - c.sec) * 1000 };
        }
        if (c.sec >= bar && c.sec < end) {
            return { phase: 'sealed', key: c.key, msToBar: 0 };
        }
        const toOpen = c.sec < open ? (open - c.sec) * 1000
            // Past tonight's window the door counts to TOMORROW, and
            // tomorrow reads the NORMAL law (specials are one-night).
            : (24 * 3600 - c.sec + TH.openMin * 60) * 1000;
        return { phase: 'closed', key: c.key, msToOpen: toOpen };
    }

    // dateKey → deterministic seed (the menu's own 31-hash grammar).
    function throneHash(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
        return h;
    }
    // mulberry32 — byte-identical to engine setSeed's generator.
    function throneRng(seed) {
        let s = (seed >>> 0) || 1;
        return () => {
            s |= 0; s = (s + 0x6D2B79F5) | 0;
            let x = Math.imul(s ^ (s >>> 15), 1 | s);
            x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
            return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
    }

    /**
     * Partition the hall into tables — PURE and deterministic from the
     * dateKey (a claim-txn retry, or two clients racing, must name the
     * same tables). Sort, seeded shuffle, then pop 4 or 5 at a time:
     *
     *   - while ≥ 5 remain: pop 4 or 5, seeded coin — except at EXACTLY
     *     5, which always seats one full human table (never strand a
     *     human at an AI table when a clean all-human split exists);
     *   - exactly 4 left is a game;
     *   - a 1–3 leftover becomes the REMAINDER table: 4 seats, humans +
     *     Hard-AI fill (ai: true → buildGameRecord hardFill 'all').
     *
     * An empty hall partitions to no games and the night settles quiet.
     */
    function thronePartition(uids, dateKey) {
        const rand = throneRng(throneHash(String(dateKey)));
        const pool = (uids || []).slice().sort();
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const games = [];
        while (pool.length >= 5) {
            const take = pool.length === 5 ? 5 : (rand() < 0.5 ? 4 : 5);
            games.push({ uids: pool.splice(0, take), size: take });
        }
        if (pool.length === 4) {
            games.push({ uids: pool.splice(0, 4), size: 4 });
        } else if (pool.length) {
            games.push({ uids: pool.splice(0, pool.length), size: 4, ai: true });
        }
        return games;
    }

    function emitT(kind, d) {
        if (!t || !t.onState) return;
        try { t.onState(kind, d || {}); } catch (e) { /* UI's problem */ }
    }

    /**
     * Enter the hall. Only while the doors stand open (server time) —
     * the UI narrates through onState(kind, detail):
     *
     *   'hall'    {rows}                 — everyone standing, live
     *   'seated'  {gid, uids, size, ai}  — the draw named my table
     *   'picking' {gid, rec, pickStart}  — hero pick is open (queue UI)
     *   'live'    {game, gid, mySeat}    — sealed; lockstep attached
     *   'missed'  {}                     — the games began without me
     *   'closed'  {reason}               — refused/dissolved ('sealed',
     *              'closed' = door state; 'gone' = table lost)
     */
    function throneJoin({ offer, onState }) {
        if (!available()) { try { onState('closed', { reason: 'gone' }); } catch (e) {} return; }
        const ph = thronePhase();
        if (ph.phase !== 'open') { try { onState('closed', { reason: ph.phase }); } catch (e) {} return; }
        if (t) throneLeave();
        const me = uid();
        const key = ph.key;
        const e = buildEntry(offer);
        t = { key, me, onState, rows: {}, adopted: false, missed: false };
        t.ref = fdb().ref(`${THNS}/${key}/lobby/${me}`);
        // The spec row (+ offer and ver, queue-grammar): offer feeds the
        // seal's straggler fallback; ver keeps mixed builds from sharing
        // a table they would fork at the first move.
        t.ref.set({
            name: e.name, rating: e.rating, crest: e.avatar || null,
            offer: e.offer, at: e.at, hb: e.hb, ver: MPV,
        });
        // Closing the tab or backing out removes you: a dead heartbeat
        // at draw time means you are not seated — never locked into a
        // game you left before it started.
        t.ref.onDisconnect().remove();
        t.hbTimer = setInterval(() => {
            if (t) t.ref.child('hb').set(firebase.database.ServerValue.TIMESTAMP);
        }, T.hb);

        const lobRef = fdb().ref(`${THNS}/${key}/lobby`);
        const onLob = (snap) => {
            if (!t || t.key !== key) return;
            t.rows = snap.val() || {};
            emitT('hall', { rows: t.rows });
        };
        lobRef.on('value', onLob);
        t.lobbyOff = () => lobRef.off('value', onLob);

        const dRef = fdb().ref(`${THNS}/${key}/draw`);
        const onDraw = (snap) => { if (t && t.key === key) throneDrawLanded(snap.val()); };
        dRef.on('value', onDraw);
        t.drawOff = () => dRef.off('value', onDraw);

        armThroneDraw();
    }

    // Everyone races the claim at the bar; the create-once txn picks one
    // winner. A touch of jitter keeps a full hall from hammering the txn
    // in the same millisecond.
    function armThroneDraw() {
        if (!t) return;
        clearTimeout(t.drawTimer);
        const ph = thronePhase();
        if (ph.phase === 'sealed' && ph.key === t.key) { attemptThroneDraw(); return; }
        if (ph.phase !== 'open' || ph.key !== t.key) return;   // night moved on
        t.drawTimer = setTimeout(attemptThroneDraw,
            ph.msToBar + 250 + Math.random() * 1500);
    }

    async function attemptThroneDraw() {
        if (!t || t.adopted || t.missed || t.claiming) return;
        const ph = thronePhase();
        if (ph.phase === 'open' && ph.key === t.key) { armThroneDraw(); return; }
        if (ph.key !== t.key || ph.phase === 'closed') return;
        t.claiming = true;
        const key = t.key;
        const myUid = t.me;
        const made = [];   // records I created — mine to delete if I lose
        try {
            // A read is cheaper than a transaction — someone may have
            // claimed while this tab slept.
            const cur = (await fdb().ref(`${THNS}/${key}/draw`).get()).val();
            if (!t || t.key !== key || t.adopted || t.missed) return;
            if (cur) { throneDrawLanded(cur); return; }

            // Freeze the live hall: fresh heartbeats only (a dead hb at
            // the bar means not seated), one build only (the ver gate).
            const rows = (await fdb().ref(`${THNS}/${key}/lobby`).get()).val() || {};
            if (!t || t.key !== key || t.adopted || t.missed) return;
            const sNow = srvReal();   // liveness — never the bent clock
            const fresh = Object.entries(rows).filter(([, e]) => e && e.ver === MPV
                && (typeof e.hb !== 'number' || sNow - e.hb < T.fresh));
            const byUid = Object.fromEntries(fresh);
            const groups = thronePartition(fresh.map(([u]) => u), key);

            // Build EVERY table before claiming: a claim that lands is
            // always complete, so a claimant dying mid-write can never
            // brick the night. A losing racer's records are limbo
            // wreckage sweepStale already collects.
            const games = {};
            for (let i = 0; i < groups.length; i++) {
                const grp = groups[i];
                const humanRows = grp.uids
                    .map(u => [u, byUid[u]])
                    .sort((a, b) => ((a[1].at || 0) - (b[1].at || 0)) || (a[0] < b[0] ? -1 : 1))
                    .map(([u, r]) => ({
                        uid: u, name: r.name || 'A Noble', hero: null,
                        offer: Array.isArray(r.offer) && r.offer.length ? r.offer : null,
                        rating: r.rating || 0, avatar: r.crest || null, human: true,
                    }));
                // Full tables carry the queue's silent single hard seat
                // rule (moot with zero AI seats); the remainder table
                // fills EVERY empty seat with the sharp brain — §7's
                // "1 player → remainder table vs 3 Hard AI".
                const rec = await buildGameRecord(grp.size, humanRows, grp.ai ? 'all' : true);
                if (!t || t.key !== key) break;
                rec.status = 'picking';   // no proposal — the hall was the accept
                rec.pickStart = firebase.database.ServerValue.TIMESTAMP;
                rec.throne = key;         // ship 3's scoring stamp (3×, purse, points)
                rec.hostUid = humanRows[0].uid;   // its own earliest member,
                // not the claimant — the claimant may sit at another table.
                const gid = fdb().ref(`${NS}/games`).push().key;
                await fdb().ref(`${NS}/games/${gid}`).set(rec);
                made.push({ gid, rec });
                games[`g${i + 1}`] = {
                    uids: grp.uids, size: grp.size, gameId: gid,
                    ...(grp.ai ? { ai: true } : {}),
                };
            }
            if (!t || t.key !== key || t.adopted || t.missed) {
                made.forEach(m => gameRef(m.gid).remove().catch(() => {}));
                return;
            }

            // The claim — settleDue's create-once shape: null commits my
            // draw, an existing value aborts and I adopt the winner's.
            const res = await fdb().ref(`${THNS}/${key}/draw`).transaction(cur2 => {
                if (cur2) return;   // beaten to it — abort
                return { at: now(), by: myUid, roster: fresh.map(([u]) => u), games };
            });
            const val = res && res.snapshot ? res.snapshot.val() : null;
            if (res && res.committed && val && val.by === myUid) {
                // Won. The spec's hand-off nicety: each row learns its
                // table (clients read the draw node either way).
                for (const gm of Object.values(games)) {
                    for (const u of gm.uids) {
                        fdb().ref(`${THNS}/${key}/lobby/${u}/gameId`)
                            .set(gm.gameId).catch(() => {});
                    }
                }
                // Referee every table's pick window. The seal is a txn,
                // so a member watchdog can referee too if this tab dies.
                made.forEach(m => throneReferee(m.gid, m.rec));
                if (t && t.key === key) throneDrawLanded(val);
            } else {
                made.forEach(m => gameRef(m.gid).remove().catch(() => {}));
                if (t && t.key === key && val) throneDrawLanded(val);
            }
        } catch (e) {
            console.warn('[FMP] throne draw failed:', e.message);
            if (t && t.key === key && !t.adopted && !t.missed) {
                clearTimeout(t.drawTimer);
                t.drawTimer = setTimeout(attemptThroneDraw, 4000 + Math.random() * 3000);
            }
        } finally {
            if (t) t.claiming = false;
        }
    }

    // The draw is down — find my table, or learn the games began
    // without me. Idempotent: the watcher AND the claim path both land
    // here, in any order.
    function throneDrawLanded(draw) {
        if (!t || t.adopted || t.missed || !draw) return;
        const mine = Object.entries(draw.games || {}).map(([, g]) => g)
            .find(gm => Array.isArray(gm.uids) && gm.uids.includes(t.me) && gm.gameId);
        if (!mine) {
            // My heartbeat died between the bar and the claim, or the
            // court never saw me — honest, and tomorrow exists.
            t.missed = true;
            clearTimeout(t.drawTimer);
            emitT('missed', {});
            return;
        }
        t.adopted = true;
        clearTimeout(t.drawTimer);
        emitT('seated', {
            gid: mine.gameId, uids: mine.uids.slice(),
            size: mine.size, ai: !!mine.ai,
        });
        throneAdopt(mine.gameId);
    }

    // Ride the record to the table — adoptRoomGame minus the accept
    // write (nothing to accept; the hall already was).
    function throneAdopt(gid) {
        const key = t.key;
        const recRef = gameRef(gid);
        const onRec = (snap) => {
            if (!t || t.key !== key) { recRef.off('value', onRec); return; }
            const rec = snap.val();
            if (!rec || rec.status === 'aborted') {
                recRef.off('value', onRec);
                const fire = t.onState;
                throneTeardown();
                _roomPickGid = null;
                try { fire('closed', { reason: 'gone' }); } catch (e) {}
                return;
            }
            if (rec.status === 'picking' && !t.picking) {
                t.picking = true;
                _roomPickGid = gid;   // publishPick targets the throne table
                // If the claimant died, the first member past the pick
                // deadline referees the seal itself (txn — idempotent).
                const wait = T.pick + T.pickGrace + 4000;
                t.sealT = setTimeout(() => { throneSeal(gid); }, wait);
                // And if even that can't land, dissolve honestly.
                t.watchdogT = setTimeout(() => {
                    if (!t || t.key !== key) return;
                    const fire = t.onState;
                    throneTeardown();
                    _roomPickGid = null;
                    try { fire('closed', { reason: 'gone' }); } catch (e) {}
                }, wait + 8000);
                emitT('picking', { gid, rec, pickStart: rec.pickStart || now() });
                return;
            }
            if (rec.status === 'live') {
                recRef.off('value', onRec);
                const fire = t.onState;
                throneTeardown();
                _roomPickGid = null;
                const res = attachGame(gid, rec);
                if (res) try { fire('live', res); } catch (e) {}
                return;
            }
        };
        recRef.on('value', onRec);
        t.recOff = () => recRef.off('value', onRec);
    }

    // The claimant's per-table pick referee — refereePicks with the
    // transactional seal (and no queue entries to consume).
    function throneReferee(gid, rec) {
        const humans = (rec.roster || []).filter(r => r.human).map(r => r.uid);
        const picksRef = gameRef(gid).child('picks');
        let sealed = false;
        const trySeal = () => {
            if (sealed) return;
            sealed = true;
            picksRef.off('value', onPicks);
            clearTimeout(deadline);
            throneSeal(gid);
        };
        const onPicks = (snap) => {
            const picks = snap.val() || {};
            if (humans.every(u => picks[u])) trySeal();
        };
        const deadline = setTimeout(trySeal, T.pick + T.pickGrace);
        picksRef.on('value', onPicks);
    }

    /**
     * Seal a throne table: picking → live, exactly once, whoever asks.
     * The roster is computed INSIDE the transaction from the record's
     * own picks (a straggler pick that lands mid-seal still counts on
     * retry), and a second sealer aborts on the status check.
     */
    async function throneSeal(gid) {
        try {
            const cur = (await gameRef(gid).get()).val();
            if (!cur || cur.status !== 'picking') return;   // sealed or gone
            await gameRef(gid).transaction(rec => {
                if (rec === null) {
                    // Null first-guess on an uncached ref (the RTDB txn
                    // trap): return a sweepable stub — the server compare
                    // rejects it whenever the record exists and re-runs
                    // with truth; against a genuinely-deleted record it
                    // commits limbo wreckage sweepStale collects.
                    return { created: now(), status: 'aborted' };
                }
                if (rec.status !== 'picking') return;   // lost the race — fine
                return { ...rec, status: 'live',
                         roster: computeSealedRoster(rec, rec.picks || {}) };
            });
        } catch (e) { /* the members' watchdogs cover a dead seal */ }
    }

    function throneTeardown() {
        if (!t) return;
        try {
            clearInterval(t.hbTimer);
            clearTimeout(t.drawTimer);
            clearTimeout(t.sealT);
            clearTimeout(t.watchdogT);
            if (t.lobbyOff) t.lobbyOff();
            if (t.drawOff) t.drawOff();
            if (t.recOff) t.recOff();
        } catch (e) { /* best effort */ }
        t = null;
    }

    // Backing out of the hall. Seated players keep their row (it wears
    // the gameId and dies with the tab's onDisconnect); a walk-out
    // before the bar removes it — nobody is dealt in absentia.
    function throneLeave() {
        if (!t) return;
        const ref = t.ref, adopted = t.adopted;
        throneTeardown();
        if (adopted) return;   // the game record owns the flow now
        try {
            ref.onDisconnect().cancel();
            ref.remove();
        } catch (e) { /* best effort */ }
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
            throwLog: [],       // throw/unthrow/afk_boot in stream order —
                                // buffered so a collector armed late (still
                                // animating the prior round) misses nothing
            throwFeeds: [],     // live collectThrows folds
            presenceTimer: null,
            afkTimer: null,
            ended: false,
        };

        const movesRef = fdb().ref(`${NS}/games/${gid}/moves`);
        const onMove = (snap) => {
            const m = snap.val();
            if (!m || typeof m.seat !== 'number' || !m.type) return;
            g.moveQ.push(m);
            // The throw barrier folds these in stream order (see collectThrows).
            if (m.type === 'throw' || m.type === 'unthrow' || m.type === 'afk_boot') {
                g.throwLog.push(m);
                if (m.type !== 'afk_boot') {
                    // Display + fold only — never queued for waiters. (afk_boot
                    // falls through to the broadcast handlers below.)
                    g.throwFeeds.forEach(fn => { try { fn(m); } catch (e) {} });
                    return;
                }
            }
            (g.handlers[m.type] || []).forEach(cb => { try { cb(m); } catch (e) {} });
            if (m.type === 'afk_boot') {
                // Fed AFTER the boot handlers so the fold sees the converted
                // seat state; markBooted has already run by now. A boot of
                // THIS client runs leaveGame inside those handlers — g is
                // gone and there is nothing left to feed.
                if (g) g.throwFeeds.forEach(fn => { try { fn(m); } catch (e) {} });
            }
            // Broadcast types never queue for waiters. ('emote' is social
            // paint — every client shows it on receipt, nothing awaits it.)
            if (m.type === 'afk_boot' || m.type === 'sync' || m.type === 'left'
                || m.type === 'emote') return;
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
    // Did the AFK fallback finish MY seat? Scoring reads this: a booted
    // seat posts 1× Stars and zero Throne points (§4 completion-required).
    // Normally moot — a booted tab leaves before scoring — but a boot
    // racing the table's last moves must not triple-pay a seat its human
    // abandoned.
    function myBooted() { return !!(g && g.booted.has(g.mySeat)); }

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

    /**
     * Take queued moves of a type from a seat, synchronously, in stream
     * order — for moves that PRECEDE a barrier move rather than answer a
     * waiter (paid 'slide' steps land ahead of the seat's 'act').
     *
     * beforeMove bounds the take by TOTAL stream order (g.moveQ): only
     * entries that arrived ahead of it are taken; later ones stay queued.
     * This matters on the final-round pair — slide·act·slide·act — and
     * whenever the actor runs a full reveal ahead of a still-animating
     * peer: a bare type-FIFO drain would replay a LATER slide before an
     * EARLIER action and fork the tables. No beforeMove (a boot) takes
     * everything: those steps happened on every surviving client alike.
     */
    function drain(seat, type, beforeMove) {
        if (!g) return [];
        const bySeat = g.perSeat[seat];
        if (!bySeat || !bySeat[type] || !bySeat[type].length) return [];
        const q = bySeat[type];
        if (beforeMove) {
            const cut = g.moveQ.indexOf(beforeMove);
            if (cut >= 0) {
                const take = q.filter(m => g.moveQ.indexOf(m) < cut);
                bySeat[type] = q.filter(m => g.moveQ.indexOf(m) >= cut);
                return take;
            }
        }
        bySeat[type] = [];
        return q;
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

    /**
     * The throw barrier — a deterministic lock folded off the stream.
     *
     * Humans publish 'throw' {r, cardId} and 'unthrow' {r} freely during a
     * round. The moves ride the same push-ordered stream as everything
     * else, so every client folds the SAME sequence: the first moment all
     * live human seats hold an active throw is the lock, and it is the
     * same moment on every client. An unthrow that arrives after that
     * point in the stream simply lost the race — the physical rule: the
     * last card hitting the table locks every card instantly.
     *
     * `seats` = canonical seats that must throw (local human + remotes).
     * Boots shrink the set mid-round (the caller AI-picks for them).
     * onUpdate fires per fold step with the current {seat: cardId} map so
     * the UI can land face-down cards live. Resolves { picks } at lock,
     * or null if the game tears down first.
     *
     * The host arms Wyatt's AFK clock per missing seat, exactly like
     * waitFor does: 2 minutes without a throw and the seat is booted.
     */
    function collectThrows({ round, seats, onUpdate }) {
        if (!g) return Promise.resolve(null);
        return new Promise((resolve) => {
            const live = new Set(seats.filter(s => !g.booted.has(s)));
            const active = {};
            let done = false;
            const afkTimers = {};

            const finish = (val) => {
                if (done) return;
                done = true;
                Object.values(afkTimers).forEach(t => clearInterval(t));
                if (g) {
                    const i = g.throwFeeds.indexOf(feed);
                    if (i >= 0) g.throwFeeds.splice(i, 1);
                }
                resolve(val);
            };

            // The 2-minute clock runs from the round's start and reads
            // T.afk LIVE each tick (the audit suite shrinks it mid-run).
            // A seat holding an active throw idles the clock; taking the
            // card back and walking away does not stop it.
            const armAfk = (seat) => {
                if (!isHost() || seat === g.mySeat || afkTimers[seat]) return;
                const started = now();
                afkTimers[seat] = setInterval(() => {
                    if (done || !g) { clearInterval(afkTimers[seat]); return; }
                    if (active[seat]) return;
                    if (now() - started < T.afk) return;
                    clearInterval(afkTimers[seat]);
                    delete afkTimers[seat];
                    publish('afk_boot', { target: seat, why: 'afk' });
                }, 1000);
            };

            const check = () => {
                if (done) return;
                if (!g) { finish(null); return; }
                for (const s of live) if (!active[s]) return;
                finish({ picks: { ...active } });
            };

            const feed = (m) => {
                if (done || !g) return;
                if (m.type === 'afk_boot') {
                    if (live.has(m.target)) {
                        live.delete(m.target);
                        delete active[m.target];
                        if (onUpdate) try { onUpdate({ ...active }); } catch (e) {}
                        check();
                    }
                    return;
                }
                if (m.r !== round || !live.has(m.seat)) return;
                if (m.type === 'throw' && m.cardId !== undefined) active[m.seat] = m.cardId;
                else if (m.type === 'unthrow') delete active[m.seat];
                if (onUpdate) try { onUpdate({ ...active }); } catch (e) {}
                check();
            };

            // Replay what already arrived (a fast peer throws while we're
            // still animating the previous round), then go live — same
            // tick, so nothing slips between the two.
            g.throwLog = g.throwLog.filter(m =>
                m.type !== 'afk_boot' && (m.r === undefined || m.r >= round));
            g.throwLog.forEach(feed);
            if (!done) {
                g.throwFeeds.push(feed);
                live.forEach(s => { if (!active[s]) armAfk(s); });
                check();
            }
        });
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

    // Abandoned records from crashed sessions — swept on boot, cheap. A
    // record that never went live (proposal wreckage) goes on the short
    // clock; finished/live wrecks keep the long one.
    async function sweepStale() {
        if (!available()) return;
        try {
            const snap = await fdb().ref(`${NS}/games`).get();
            const games = snap.val() || {};
            const tNow = now();
            for (const [gid, rec] of Object.entries(games)) {
                if (!rec || !rec.created) continue;
                const age = tNow - rec.created;
                if (age > T.cleanupAge
                    || (rec.status !== 'live' && rec.status !== 'done' && age > T.limboAge)) {
                    await fdb().ref(`${NS}/games/${gid}`).remove();
                }
            }
            // Room wreckage from crashed hosts (onDisconnect can miss).
            const rSnap = await fdb().ref(`${NS}/rooms`).get();
            const rooms = rSnap.val() || {};
            for (const [code, rec] of Object.entries(rooms)) {
                if (!rec || !rec.created || tNow - rec.created > 60 * 60 * 1000) {
                    await fdb().ref(`${NS}/rooms/${code}`).remove();
                }
            }
            // Spent Throne nights: the lobby and the draw are one-night
            // artifacts (their game records live — and sweep — under
            // favor/mp/games). Any key before today's ET date is done.
            const thSnap = await fdb().ref(THNS).get();
            const nights = thSnap.val() || {};
            const today = etClock(srvNow()).key;
            for (const k of Object.keys(nights)) {
                if (k < today) await fdb().ref(`${THNS}/${k}`).remove();
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
        available, enterQueue, cancelQueue,
        accept, decline: () => declineProposal('declined'), publishPick,
        queuePhase: () => (q ? q.state : null),
        queueStartedAt: () => (q ? q.startedAt : 0),
        hostRoom, joinRoom, leaveRoom, roomSetSize, roomSetHard, roomStart,
        throne: {
            phase: thronePhase,          // door states tick on this
            join: throneJoin, leave: throneLeave,
            active: () => !!t,
            srvNow,                      // night clock (phase truth)
            srvReal,                     // liveness clock (hb freshness)
            openLabel: throneOpenLabel,  // tonight's door copy ("10:00 PM" on 8/3 only)
            barLabel: throneBarLabel,
        },
        _thronePartition: thronePartition,   // probe seam (tools/probe-throne-draw.mjs)
        active, mySeat, myBooted, isHost, record, localIdx, canonSeat,
        publish, waitFor, drain, collectThrows, onBroadcast, markBooted,
        leaveGame, gameOver,
        gid: () => (g ? g.gid : null),
        ver: () => MPV,   // telemetry stamps the protocol its transcript rode

        _T: T,   // timers — the audit suite shrinks these
    };
})();
