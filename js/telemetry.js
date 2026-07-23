// ═══ FTEL — game telemetry (Hard-AI program, Phase 1) ═══════════════════════
//
// Records a compact decision transcript of every table — human and AI seats
// alike — and uploads it at scoring to favor/telemetry/games. This is the
// training set the Hard brain (Phase 2/3) tunes from; every day it isn't
// live is player data lost.
//
// HOW: FavorGame.prototype methods are wrapped at load (this file loads
// right after engine/gameState.js, before ui.js — zero engine edits), so
// every seat in every mode records through the same taps. The wraps are
// READ-ONLY: original args in, original return out, recorder body inside
// try/catch — a telemetry bug must never touch the game, and in lockstep
// multiplayer the wrapped calls stay byte-identical in behavior.
//
// WHO UPLOADS: solo / skirmish / rival — this client (seat 0). Multiplayer —
// the HOST only, mirroring the "only the host posts persona placements"
// rule, so a table lands exactly one transcript. Uploads ride FLB's dbPush
// (NS 'favor'), firebase mode only — never the localStorage adapter.
//
// KILL SWITCHES: favor/config/telemetryOff (one dbGet at first game start,
// default on) and localStorage favorTelemetryOff = '1' (the audit suites
// set this so routine runs don't spam the live set; recording still
// happens in memory so rigs can inspect FTEL.payloadPreview()).
//
// Card and mission NAMES, never ids — ids renumber across builds; names are
// the stable key the playbook builder joins on.
(function () {
    'use strict';

    const TV = 1;                  // transcript schema version
    const MAX_DECISIONS = 1200;    // runaway guard; a real game is ~150 rows
    const SIZE_CAP = 25000;        // ~25KB JSON — RTDB stays cheap

    let T = null;                  // live transcript {game, meta, decisions, flushed}
    let cfgOff;                    // favor/config/telemetryOff (fetched once)

    // The build stamp this page is running — same source of truth as the
    // version badge: this script's own ?v= cache-buster. The split string
    // must stay digit-free or the stamp-bump sed rewrites it (see the
    // badge-parser gotcha in index.html).
    const build = (() => {
        try {
            const el = document.querySelector('script[src*="js/telemetry"]');
            return el ? (el.src.split('?v=')[1] || null) : null;
        } catch (e) { return null; }
    })();

    const mpOn = () => !!(window.FMP && FMP.active());
    // Canonical seat: multiplayer rotates the roster so every client's human
    // sits at local 0 — transcripts speak canonical so one table reads the
    // same from any uploader.
    const csOf = (pi) => (mpOn() && typeof FMP.canonSeat === 'function') ? FMP.canonSeat(pi) : pi;
    const rigOff = () => { try { return localStorage.getItem('favorTelemetryOff') === '1'; } catch (e) { return false; } };

    // ── Recording ────────────────────────────────────────────────────────
    function note(row) {
        if (!T || T.flushed) return;
        if (T.decisions.length >= MAX_DECISIONS) {
            if (T.decisions.length === MAX_DECISIONS) T.decisions.push({ t: 'cap' });
            return;
        }
        T.decisions.push(row);
    }

    // The little state snapshot that makes each decision legible later
    // without replaying up to it.
    function ctxOf(g, pi) {
        const p = g.players[pi];
        if (!p) return undefined;
        return { slot: p.sliderPosition, gold: p.gold, prestige: p.prestige, scorn: p.scorn };
    }

    /**
     * Start a transcript for this game. Called at the three table doors
     * (buildSoloTable, startMpGame, resumeSoloSave) after seats are wired,
     * before Act 1 deals. Seat facts derive from the live players — the
     * same flags every other system trusts (_remoteHuman, _personaAI).
     */
    function begin(g, opts) {
        try {
            opts = opts || {};
            // One config read per session, first table start — default ON.
            if (cfgOff === undefined && window.FLB && FLB._dbGet) {
                cfgOff = false;
                FLB._dbGet('config/telemetryOff').then(v => { cfgOff = !!v; }).catch(() => {});
            }
            const mode = opts.mode || 'queue';
            const seats = g.players.map((p, i) => {
                const row = {
                    cs: csOf(i),
                    kind: (i === 0) ? 'human'
                        : p._remoteHuman ? 'remote'
                        : p._personaAI ? (mode === 'rival' ? 'rival' : 'persona')
                        : 'bot',
                    hero: (p.character && p.character.id) || null,
                    name: p.name,
                };
                if (p.side === 'b') row.side = 'b';
                if (p._aiLevel) row.aiLevel = p._aiLevel;   // hard seats mark their rows
                if (i === 0 && window.FLB) {
                    if (typeof FLB.uid === 'function') row.uid = FLB.uid();
                    const snap = (typeof FLB.snapshot === 'function') ? FLB.snapshot() : null;
                    if (snap && typeof snap.rating === 'number') row.elo = snap.rating;
                } else if (p._remoteHuman) {
                    if (p._mpUid) row.uid = p._mpUid;
                    if (typeof p._tableRating === 'number') row.elo = p._tableRating;
                } else if (p._personaAI) {
                    if (p._personaUid) row.puid = p._personaUid;
                    if (typeof p._tableRating === 'number') row.elo = p._tableRating;
                }
                return row;
            }).sort((a, b) => a.cs - b.cs);

            T = {
                game: g,
                flushed: false,
                meta: {
                    tv: TV, build,
                    mpv: (window.FMP && typeof FMP.ver === 'function') ? FMP.ver() : null,
                    mode, size: g.playerCount,
                    seed: (typeof opts.seed === 'number') ? opts.seed : null,
                    at: Date.now(),
                    seats,
                },
                decisions: [],
            };
            if (opts.resumed) T.meta.resumed = true;
        } catch (e) { T = null; }
    }

    // ── The taps — one wrap per engine decision point ────────────────────
    // pre() snapshots what the call is about to consume (a pick eats the
    // hand it chose from); post() records only after the original ran, and
    // only what actually succeeded. A throw in orig propagates untouched.
    function wrap(name, pre, post) {
        const orig = FavorGame.prototype[name];
        if (typeof orig !== 'function') return;   // renamed upstream — tap dies silently
        FavorGame.prototype[name] = function (...args) {
            let snap;
            if (pre && T && !T.flushed && this === T.game) {
                try { snap = pre(this, args); } catch (e) { snap = undefined; }
            }
            const out = orig.apply(this, args);
            if (post && T && !T.flushed && this === T.game) {
                try { post(this, args, out, snap); } catch (e) { /* never the game's problem */ }
            }
            return out;
        };
    }

    if (typeof FavorGame === 'function') {
        wrap('startAct', null, (g, a) => note({ t: 'act_start', act: a[0] }));

        wrap('pickCard',
            (g, a) => ({
                hand: (g.players[a[0]] && g.players[a[0]].hand || []).map(c => c.name),
                ctx: ctxOf(g, a[0]),
            }),
            (g, a, out, s) => note({
                t: 'pick', cs: csOf(a[0]), act: g.currentAct, round: g.turnInAct,
                hand: s && s.hand, picked: s && s.hand ? s.hand[a[1]] : undefined,
                ctx: s && s.ctx,
            }));

        wrap('unpickCard', null, (g, a, out) => {
            if (out && out.success) note({ t: 'unpick', cs: csOf(a[0]) });
        });

        wrap('activateCard',
            (g, a) => {
                const c = g.findPendingCard(a[0], a[1]);
                return { card: c && c.name, ctx: ctxOf(g, a[0]) };
            },
            (g, a, out, s) => {
                if (!out || !out.success) return;
                const row = {
                    t: 'act', cs: csOf(a[0]), act: g.currentAct, round: g.turnInAct,
                    card: s && s.card, action: a[2], ctx: s && s.ctx,
                };
                if (a[2] === 'discard_slide') row.dir = a[3];
                else if (a[2] === 'play' && Array.isArray(a[3]) && a[3].length) row.nb = a[3].length;
                note(row);
            });

        wrap('chooseMission',
            (g, a) => ({
                board: g.visibleMissions.map(m => m.name),
                mission: g.visibleMissions[a[1]] && g.visibleMissions[a[1]].name,
            }),
            (g, a, out, s) => note({
                t: 'mission_take', cs: csOf(a[0]), act: g.currentAct,
                mission: s && s.mission, board: s && s.board,
            }));

        wrap('moveSlider',
            (g, a) => (g.players[a[0]] ? g.players[a[0]].sliderPosition : null),
            (g, a, out, from) => {
                if (out && out.success) note({
                    t: 'slide', cs: csOf(a[0]), act: g.currentAct, round: g.turnInAct,
                    from, to: g.players[a[0]].sliderPosition,
                });
            });

        wrap('applyFreeSliderMove',
            (g, a) => (g.players[a[0]] ? g.players[a[0]].sliderPosition : null),
            (g, a, out, from) => {
                if (out && out.success) note({
                    t: 'slide_free', cs: csOf(a[0]), act: g.currentAct, from, to: out.pos,
                });
            });

        wrap('applySlotPick', null, (g, a, out) => {
            if (out && out.success) note({ t: 'slot_pick', cs: csOf(a[0]), act: g.currentAct, skill: out.skill });
        });

        wrap('applyGoldConvert', null, (g, a, out) => {
            if (out && out.success) note({
                t: 'convert', cs: csOf(a[0]), act: g.currentAct,
                yes: !!a[1], gold: out.converted || 0,
            });
        });

        wrap('turnInMission',
            (g, a) => {
                const m = g.players[a[0]] && g.players[a[0]].missions[a[1]];
                return m && m.name;
            },
            (g, a, out, name) => {
                if (out && out.mission) note({
                    t: 'mission_turnin', cs: csOf(a[0]), act: g.currentAct,
                    mission: name, ok: !!out.success,
                });
            });

        wrap('completeMissionWithBorrow', null, (g, a, out) => {
            if (out && out.success) note({
                t: 'mission_borrow', cs: csOf(a[0]), act: g.currentAct,
                mission: out.mission && out.mission.name, cost: out.cost,
            });
        });

        wrap('failMissionByChoice', null, (g, a, out) => {
            if (out && out.mission) note({
                t: 'mission_fail_choice', cs: csOf(a[0]), act: g.currentAct,
                mission: out.mission.name,
            });
        });

        // The one funnel every played-card discard passes through — penalty
        // pickers, A Promise, Archeus weapons, mission fail effects, human
        // and AI alike. The multiset diff names what actually left the table.
        wrap('discardPlayedCards',
            (g, a) => (g.players[a[0]] ? g.players[a[0]].playedCards.map(c => c.name) : null),
            (g, a, out, beforeNames) => {
                if (!out || !beforeNames) return;
                const after = g.players[a[0]].playedCards.map(c => c.name);
                const left = beforeNames.slice();
                after.forEach(n => { const i = left.indexOf(n); if (i !== -1) left.splice(i, 1); });
                if (left.length) note({ t: 'discard_played', cs: csOf(a[0]), act: g.currentAct, cards: left });
            });

        // Due-date resolution — what banked, what borrowed, what failed. The
        // holds and deliberate failures Phase 2 cares about live in the gap
        // between this row and the mission_* choice rows above.
        wrap('resolveMissions', null, (g, a, out) => {
            if (!Array.isArray(out)) return;
            const rows = [];
            out.forEach(seat => {
                (seat && Array.isArray(seat.results) ? seat.results : []).forEach(r => {
                    if (!r || !r.mission) return;
                    const row = { cs: csOf(seat.playerIndex), mission: r.mission.name, ok: !!r.success };
                    if (r.borrowed) row.borrowed = r.borrowed;
                    rows.push(row);
                });
            });
            if (rows.length) note({ t: 'missions_resolve', act: g.currentAct, rows });
        });
    }

    // ── Flush — one transcript per table, at scoring ─────────────────────
    function buildPayload(scores, extra) {
        const g = T.game;
        const result = {
            placements: (scores || []).map(s => csOf(s.playerIndex)),
            rows: (scores || []).map(s => ({
                cs: csOf(s.playerIndex),
                finalScore: s.finalScore, totalFavor: s.totalFavor,
                missionFavor: s.missionFavor, advFavor: s.advFavor,
                artFavor: s.artFavor, otherCardFavor: s.otherCardFavor,
                characterFavor: s.characterFavor,
                prestige: s.prestige, scorn: s.scorn, gold: s.gold,
                power: s.power || 0,
            })),
        };
        if (extra && extra.humans > 1) result.humans = extra.humans;
        // Seats that started human and finished AI — the AFK boots. Their
        // rows are casual-brain moves from the boot on; curation drops them.
        const booted = [];
        g.players.forEach((p, i) => {
            const seat = T.meta.seats.find(s => s.cs === csOf(i));
            if (seat && seat.kind === 'remote' && !p._remoteHuman) booted.push(seat.cs);
        });
        if (booted.length) result.booted = booted;

        const payload = { ...T.meta, decisions: T.decisions, result };

        // Size cap: shed the bulkiest detail first (hand arrays, oldest
        // picks first), then ctx, then whole oldest rows. The scoring screen
        // never waits on any of this.
        let json = JSON.stringify(payload);
        if (json.length > SIZE_CAP) {
            for (const d of payload.decisions) {
                if (json.length <= SIZE_CAP) break;
                if (d.hand) { delete d.hand; json = JSON.stringify(payload); }
            }
            for (const d of payload.decisions) {
                if (json.length <= SIZE_CAP) break;
                if (d.ctx) { delete d.ctx; json = JSON.stringify(payload); }
            }
            let dropped = 0;
            while (json.length > SIZE_CAP && payload.decisions.length > 1) {
                payload.decisions.shift(); dropped++;
                if (dropped % 25 === 0) json = JSON.stringify(payload);
            }
            if (dropped) {
                payload.decisions.unshift({ t: 'trunc', n: dropped });
                json = JSON.stringify(payload);
            }
        }
        return payload;
    }

    /**
     * Called once from showScoring. Builds the transcript and, if this
     * client is the table's uploader, pushes it — fire-and-forget; a lost
     * write is one game of data, never a stuck victory screen.
     */
    function flush(scores, extra) {
        try {
            if (!T || T.flushed) return;
            T.flushed = true;
            const payload = buildPayload(scores, extra);
            T.payload = payload;   // rigs read this via payloadPreview()

            const uploader = mpOn() ? (typeof FMP.isHost === 'function' && FMP.isHost()) : true;
            if (!uploader || cfgOff || rigOff()) return;
            if (!window.FLB || FLB.mode !== 'firebase' || !FLB._dbPush) return;
            FLB._dbPush('telemetry/games', payload).catch(() => {});
        } catch (e) { /* telemetry never breaks scoring */ }
    }

    // ── Public surface ───────────────────────────────────────────────────
    window.FTEL = {
        begin, flush,
        // Rig/verify seams — read-only peeks, no uploads.
        payloadPreview: () => (T && (T.payload || (T.game ? buildPayload([], null) : null))) || null,
        decisionCount: () => (T ? T.decisions.length : 0),
        active: () => !!(T && !T.flushed),
    };
})();
