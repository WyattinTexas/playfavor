// ═══ FAI — the Hard brain (Hard-AI program, Phase 2 v0) ═════════════════════
//
// A hand-authored evaluator that scores every option in EXPECTED FINAL
// POINTS (finalScore = totalFavor + prestige − scorn; gold at a small
// exchange rate) — the one currency the game actually settles in. It reads
// ONLY public state: played cards, sliders, purses, the mission board, its
// own hand and missions, and the discard pile. Never an opponent's hand,
// never deck order. "Sharper judgment only, never stat cheating."
//
// LOCKSTEP LAW: Hard seats are simulated locally on every multiplayer
// client, so everything here must be PURE and DETERMINISTIC — no
// Math.random, no Date.now, argmax with stable first-index tie-breaks.
// Any behavior change in this file ⇒ MPV bump (js/mp.js).
//
// Rules fidelity: FAI only ever acts through the same engine methods a
// human's taps reach (pickCard / activateCard / moveSlider / chooseMission
// / …) — no house rules, no engine shortcuts. The playbook
// (data/playbook.js) carries the tunable tables; Phase 3 regenerates it
// from recorded player data.
(function () {
    'use strict';

    const PB = () => window.FAVOR_PLAYBOOK || {};
    const tbl = (name) => PB()[name] || {};
    // Gold's point value by act — and DIMINISHING with a fat purse: the
    // 26th gold converts to nothing at scoring, so a rich seat should buy
    // plays, slides and borrows instead of banking another +3g.
    const gr = (g, pi) => {
        const base = (PB().goldRate || {})[g.currentAct] || 0.25;
        if (typeof pi !== 'number') return base;
        const gold = (g.players[pi] && g.players[pi].gold) || 0;
        return base * (gold <= 12 ? 1 : gold <= 22 ? 0.6 : 0.3);
    };

    // Hard = an AI seat the table record marked hard. Humans (local seat 0
    // OR remote) and AFK-booted seats (never given _aiLevel) stay casual.
    function isHard(g, pi) {
        const p = g && g.players && g.players[pi];
        return !!(p && p._aiLevel === 'hard' && pi !== 0 && !p._remoteHuman);
    }

    // Placement-relative worth: a point taken FROM an opponent is a share
    // of a point earned (placement is what's scored, but only one rival's
    // row matters at a time).
    const rival = () => (typeof PB().rivalWeight === 'number' ? PB().rivalWeight : 0.5);

    const standing = (g, i) => {
        const p = g.players[i];
        return g.currentFavor(i) + (p.prestige || 0) - (p.scorn || 0);
    };

    // Endgame appetite: trailing in Act 3 raises the taste for upside
    // (missions, borrows, letters); leading buys a little safety. Public
    // standings only, and flat before Act 3 — early ranks are noise.
    function urgency(g, pi) {
        if (g.currentAct < 3) return 1;
        const s = standing(g, pi);
        let rank = 1;
        for (let j = 0; j < g.playerCount; j++) if (j !== pi && standing(g, j) > s) rank++;
        return rank === 1 ? 0.95 : rank === 2 ? 1.15 : 1.3;
    }

    // ── Melee — power totals vs the table's visible power ────────────────
    function meleeEVFor(g, pi, myExtra, othersDelta) {
        const act = g.currentAct;
        const rewards = (tbl('meleeRewards'))[act] || {};
        const conf = (tbl('meleeConfidence'))[act] || 0.7;
        const mine = g.calculatePower(pi) + (myExtra || 0);
        let ahead = 0;
        for (let j = 0; j < g.playerCount; j++) {
            if (j === pi) continue;
            if (g.calculatePower(j) + (othersDelta || 0) > mine) ahead++;
        }
        return (rewards[ahead + 1] || 0) * conf;
    }
    // Worth of +units Power: this act's placement delta scaled by how many
    // melees the unit still fights (power accumulates — an Act-1 unit sees
    // all three pools), plus a floor so power is never free to shed.
    // RELATIVE: a placement climbed is a reward DENIED to the seat above —
    // placement is the whole scoreboard, so the swing counts half again.
    const powerValue = (g, pi, units) => {
        const fw = (tbl('meleeFutureWeight'))[g.currentAct] || 1;
        return Math.max(0, meleeEVFor(g, pi, units, 0) - meleeEVFor(g, pi, 0, 0))
            * fw * (1 + rival())
            + Math.min(units || 0, 3) * 0.35;
    };

    // ── Skills as enablement ─────────────────────────────────────────────
    // A shallow read of what a card would pay if it landed — used INSIDE
    // skillUnitValue so enablement never recurses into full cardEV.
    function rawCardPotential(g, pi, card) {
        let v = (card.favor || 0) + g.dynamicCardFavor(pi, card);
        const r = card.rewards || {};
        v += (r.prestige || 0) + (r.favor || 0) - (r.scorn || 0) + (r.gold || 0) * gr(g);
        v += (card.skills || []).length * 0.8;
        if (card.special) v += 1.5;
        return v;
    }

    function missionNet(g, pi, m) {
        const b = missionBranch(g, pi, m);
        return Math.max(0, b.success - b.fail);
    }

    // What one MORE unit of `skill` is worth to seat pi: requirements it
    // closes in the OWN hand, own held missions, and the visible board —
    // plus the melee when the skill is power. Deterministic sums only.
    function skillUnitValue(g, pi, skill) {
        const p = g.players[pi];
        const gaps = tbl('enablementByGap');
        let v = (typeof PB().skillBaseValue === 'number' ? PB().skillBaseValue : 0.35);
        if (skill === 'power') v += powerValue(g, pi, 1);

        // Own held missions still inside their window.
        (p.missions || []).forEach(m => {
            const req = {};
            (m.requirements || []).forEach(r => { if (r === skill) req[skill] = (req[skill] || 0) + 1; });
            if (!req[skill]) return;
            const short = g.unmetSkillReqs(pi, { [skill]: req[skill] })[skill] || 0;
            if (short > 0) v += missionNet(g, pi, m) * (gaps[Math.min(short, 3)] || 0.1) / Math.max(1, short);
        });

        // Own hand cards this unit moves toward playable.
        (p.hand || []).forEach(c => {
            const missing = g.checkRequirements(pi, c).missingSkills || [];
            const short = missing.filter(s => s === skill).length;
            if (short > 0) v += Math.max(0, rawCardPotential(g, pi, c)) * (gaps[Math.min(short, 3)] || 0.1) * 0.5 / short;
        });

        // The visible mission board — takeable later.
        (g.visibleMissions || []).forEach(m => {
            if ((m.requirements || []).includes(skill)) v += 0.25;
        });
        return v;
    }

    // ── Card pool reads (public: everything seen is known) ───────────────
    function seenNames(g, pi) {
        const s = new Set();
        g.players.forEach(q => (q.playedCards || []).forEach(c => s.add(c.name)));
        (g.players[pi].hand || []).forEach(c => s.add(c.name));
        (g.discardPile || []).forEach(c => s.add(c.name));
        return s;
    }
    function partnerOutlook(g, pi, partnerNames) {
        const p = g.players[pi];
        if ((p.playedCards || []).some(c => partnerNames.includes(c.name))) return 1;
        if ((p.hand || []).some(c => partnerNames.includes(c.name))) return 0.7;
        const seen = seenNames(g, pi);
        return partnerNames.some(n => !seen.has(n)) ? 0.2 : 0;
    }

    // ── The specials table — every card `special`, in expected points ────
    // Keyed off the audit strings (tools/audit-check.mjs keeps data honest).
    // Formula favor (favor_per_*) reaches EV via scoredCardFavor + growth
    // below, so those entries price only what the formula read misses.
    const CARD_SPECIAL_EV = {
        // Requirement tokens — they gate the best Act-3 lines.
        philosopher_stone: (g) => PB().stoneValue || 3.5,
        philosopher_stone_x2: () => 2 * (PB().stoneValue || 3.5),
        minds_eye: () => PB().eyeValue || 2.5,
        minds_eye_x2: () => 2 * (PB().eyeValue || 2.5),
        minds_eye_x3: () => 3 * (PB().eyeValue || 2.5),
        // Purse converters — immediate, computable from state.
        scorn_to_prestige: (g, pi) => 2 * (g.players[pi].scorn || 0),
        gold_to_prestige: (g, pi) => (g.players[pi].gold || 0) * (1 - gr(g)),
        multiply_gold_x2: (g, pi) => (g.players[pi].gold || 0) * gr(g),
        remove_13_scorn: (g, pi) => Math.min(13, (g.players[pi].scorn || 0) + 2),
        others_15_scorn: (g, pi) => 15 * (g.playerCount - 1) * rival(),
        gold_2_per_alchemy_triangle: (g, pi) => {
            const n = g.playerCount, L = (pi + n - 1) % n, R = (pi + 1) % n;
            return 2 * ((g.players[pi].skills.alchemy || 0) + (g.players[L].skills.alchemy || 0)
                + (g.players[R].skills.alchemy || 0)) * gr(g);
        },
        gold_2_per_power_neighbors: (g, pi) => {
            const n = g.playerCount;
            return 2 * (g.effectiveSkill((pi + n - 1) % n, 'power')
                + g.effectiveSkill((pi + 1) % n, 'power')) * gr(g);
        },
        // Melee movers.
        minus_3_power_all_others: (g, pi) =>
            Math.max(0, meleeEVFor(g, pi, 0, -3) - meleeEVFor(g, pi, 0, 0)) + 1,
        coin_flip_4_power: (g, pi) => 0.5 * powerValue(g, pi, 4),
        king_of_the_sky: (g, pi) => {
            const mine = g.players[pi].skills.survival || 0;
            const most = g.players.every((q, j) => j === pi || (q.skills.survival || 0) < mine);
            return (most && mine > 0) ? powerValue(g, pi, 3) * 0.8 : 0.5;
        },
        defend_the_throne: () => 1.5,
        discard_opponent_weapon: (g, pi) =>       // Archeus — their melee, down
            2 + Math.max(0, meleeEVFor(g, pi, 0, -2) - meleeEVFor(g, pi, 0, 0))
            + (g.players[pi].playedCards.some(c => c.name === 'Blind Faith') ? powerValue(g, pi, 6) : 0),
        power_6_if_blind_faith: (g, pi) =>        // Heaven's Blade
            g.players[pi].playedCards.some(c => c.name === 'Blind Faith')
                ? powerValue(g, pi, 6)
                : partnerOutlook(g, pi, ['Blind Faith']) * powerValue(g, pi, 6) * 0.5,
        // Choosers.
        move_slider_any: (g, pi) => {             // Chemical X (+ Chemical Y pair forward)
            const best = bestSlot(g, pi, true);
            return Math.max(0, best.value - slotValue(g, pi, g.players[pi].sliderPosition))
                + partnerOutlook(g, pi, ['Chemical Y']) * 6;
        },
        double_adventure_favor: (g, pi) => {      // Chemical Y — pair 15 rides scoredCardFavor
            const cands = g.chemYCandidates(pi);
            let best = 0;
            cands.forEach(c => { const v = g.scoredCardFavor(pi, c); if (v > best) best = v; });
            return best * 0.9;
        },
        remove_mission_requirements: (g, pi) => { // Life Essence
            let best = 0;
            (g.players[pi].missions || []).forEach(m => {
                if (m._reqWaived) return;
                if (g.probeMissionRequirements(pi, m).success) return;
                const b = missionBranch(g, pi, m);
                if (b.success - Math.max(b.fail, 0) > best) best = b.success - Math.max(b.fail, 0);
            });
            return best * 0.8 + 1;
        },
        trade_route: () => 2,                     // borrow rights from ANYONE while fielded
        // Flex endeavors — one unit, best of either skill.
        alchemy_or_survival: (g, pi) => Math.max(skillUnitValue(g, pi, 'alchemy'), skillUnitValue(g, pi, 'survival')),
        alchemy_or_prospecting: (g, pi) => Math.max(skillUnitValue(g, pi, 'alchemy'), skillUnitValue(g, pi, 'prospecting')),
        charisma_or_prospecting: (g, pi) => Math.max(skillUnitValue(g, pi, 'charisma'), skillUnitValue(g, pi, 'prospecting')),
        // Map-label specials — the grantsMap field itself is priced below.
        map: () => 0, map_lost_north: () => 0, map_finding_lost_corridor: () => 0,
        sacred_chest: () => 0, knowledge_x5: () => 0,
        favor_per_survival_x2: () => 0, favor_per_knowledge_x2: () => 0,
        favor_per_sur_cha_pro: () => 0, favor_per_artifact_x8: () => 0,
        favor_per_potion_x5: () => 0, favor_per_neighbor_power: () => 0,
        favor_per_quest_x5: () => 0,
    };

    // Growth headroom for formula cards: the formula pays at SCORING, on
    // final skills — today's read understates it.
    function formulaGrowth(g, pi, card) {
        const growth = (tbl('skillGrowth'))[g.currentAct] || 1;
        const own = (sk) => (card.skills || []).filter(s => s === sk).length;
        switch (card.special) {
            case 'favor_per_survival_x2': return 2 * (own('survival') + growth * 0.5);
            case 'favor_per_knowledge_x2': return 2 * (own('knowledge') + growth * 0.5);
            case 'favor_per_sur_cha_pro':
                return own('survival') + own('charisma') + own('prospecting') + growth * 0.5;
            case 'favor_per_artifact_x8': return 8;      // counts itself on landing
            case 'favor_per_potion_x5': return 2;        // future potions, discounted
            case 'favor_per_neighbor_power': return growth;
            case 'favor_per_quest_x5': return 5 * Math.max(0, 3 - g.currentAct) * 0.4;
            default: return 0;
        }
    }

    // Combos beyond Blind Faith's power pairing (priced in specials above).
    function comboForward(g, pi, card) {
        if (card.name === 'Blind Faith') {
            return partnerOutlook(g, pi, ["Heaven's Blade", 'Archeus']) * powerValue(g, pi, 6) * 0.8;
        }
        if (card.name === 'Lost North Map') return partnerOutlook(g, pi, ['Lost South Map']) * 20 * 0.6;
        if (card.name === 'Lost South Map') {
            return g.players[pi].playedCards.some(c => c.name === 'Lost North Map') ? 20
                : partnerOutlook(g, pi, ['Lost North Map']) * 20 * 0.4;
        }
        return 0;
    }

    // n units of a skill as ONE block — a 2-Power weapon flips the melee
    // once, not twice; per-unit pricing double-counted the placement swing.
    function skillBlockValue(g, pi, s, n) {
        if (!n) return 0;
        if (s !== 'power') return skillUnitValue(g, pi, s) * n;
        return powerValue(g, pi, n)
            + n * Math.max(0, skillUnitValue(g, pi, 'power') - powerValue(g, pi, 1));
    }

    // ── The one-currency card evaluator ──────────────────────────────────
    function cardEV(g, pi, card) {
        const p = g.players[pi];
        let ev = g.scoredCardFavor(pi, card);            // printed + formula, today's read
        ev += formulaGrowth(g, pi, card);
        const r = card.rewards || {};
        ev += (r.prestige || 0) + (r.favor || 0) - (r.scorn || 0) + (r.gold || 0) * gr(g);
        const counts = {};
        (card.skills || []).forEach(s => { counts[s] = (counts[s] || 0) + 1; });
        Object.entries(counts).forEach(([s, n]) => { ev += skillBlockValue(g, pi, s, n); });
        const fn = card.special && CARD_SPECIAL_EV[card.special];
        if (fn) { try { ev += fn(g, pi) || 0; } catch (e) { /* a priced special never breaks a turn */ } }
        if (card.grantsMap) ev += (tbl('mapChainValue'))[card.grantsMap] || 2;
        if (card.combo) ev += comboForward(g, pi, card);
        if (card.cost && card.cost > 0) {
            const mapFree = card.reqMaps && card.reqMaps.length
                && g.getPlayerMaps(pi).some(m => card.reqMaps.includes(m));
            if (!mapFree) ev -= card.cost * gr(g);
        }
        return ev;
    }

    // ── Slider planner ───────────────────────────────────────────────────
    function slotValue(g, pi, idx) {
        const p = g.players[pi];
        const char = p.character;
        const slot = char && char.slots && char.slots[idx];
        if (!slot) return -Infinity;
        let v = 0;
        if (slot.skills) Object.entries(slot.skills).forEach(([s, n]) => {
            v += skillBlockValue(g, pi, s, n);
        });
        // A held favor_per_* card multiplies THROUGH the slot's grant —
        // the reason a Fisherman with Fang's Truce in hand parks on
        // Survival 8 instead of banking slot-0 favor (the canonical line).
        if (slot.skills) (p.hand || []).forEach(c => {
            const sp = String(c.special || '');
            if (sp.indexOf('favor_per_') !== 0) return;
            Object.entries(slot.skills).forEach(([s, n]) => {
                const slope = sp === `favor_per_${s}_x2` ? 2
                    : sp === `favor_per_${s}_x1` ? 1
                    : (sp === 'favor_per_sur_cha_pro'
                        && (s === 'survival' || s === 'charisma' || s === 'prospecting')) ? 1 : 0;
                if (slope) v += slope * n * 0.8;
            });
        });
        if (slot.favor) v += slot.favor * ((tbl('slotFavorWeight'))[g.currentAct] || 0.4);
        if (slot.gold) v += slot.gold * gr(g);
        if (slot.scorn) v -= slot.scorn;
        if (slot.special) v += (tbl('slotSpecialValue'))[slot.special] || 1;
        const park = (tbl('parkTargets'))[char.id];
        if (park && park[g.currentAct] === idx) v += (PB().parkPriorBonus || 5);
        return v;
    }

    function bestSlot(g, pi, excludeCurrent) {
        const p = g.players[pi];
        let best = { idx: p.sliderPosition, value: excludeCurrent ? -Infinity : slotValue(g, pi, p.sliderPosition) };
        const slots = (p.character && p.character.slots) || [];
        for (let i = 0; i < slots.length; i++) {
            if (excludeCurrent && i === p.sliderPosition) continue;
            const v = slotValue(g, pi, i);
            if (v > best.value) best = { idx: i, value: v };
        }
        return best;
    }

    // The paid-slide plan for this activation: stay, or move 1..maxSteps
    // spaces one way. Prices the toll, intermediate landings, and the
    // one-direction-per-turn lock. Null = stay.
    function slidePlan(g, pi) {
        const p = g.players[pi];
        const here = slotValue(g, pi, p.sliderPosition);
        const maxSteps = PB().slideMaxSteps || 2;
        const thresh = (typeof PB().slideThreshold === 'number') ? PB().slideThreshold : 2;
        let best = null;
        for (const dir of [-1, 1]) {
            if (p._paidSlideDir && dir !== p._paidSlideDir) continue;
            for (let steps = 1; steps <= maxSteps; steps++) {
                if ((p.gold || 0) < steps * 5) break;
                const target = p.sliderPosition + dir * steps;
                if (target < 0 || target > 4) break;
                let net = slotValue(g, pi, target) - here - steps * 5 * gr(g);
                for (let k = 1; k < steps; k++) {          // intermediate landings pay too
                    const mid = (p.character.slots || [])[p.sliderPosition + dir * k] || {};
                    net += (mid.gold || 0) * gr(g) - (mid.scorn || 0);
                }
                if (!best || net > best.net) best = { dir, steps, net };
            }
        }
        return (best && best.net >= thresh) ? best : null;
    }

    // Execute the plan through the same engine method a human's taps reach.
    // Returns steps actually taken (each landing pays out inside the engine).
    function preSlide(g, pi) {
        const plan = slidePlan(g, pi);
        if (!plan) return 0;
        let taken = 0;
        for (let i = 0; i < plan.steps; i++) {
            const res = g.moveSlider(pi, plan.dir);
            if (!res || !res.success) break;
            taken++;
        }
        return taken;
    }

    // ── Mission strategy — two-branch EV ─────────────────────────────────
    function keepValue(g, pi, c) {
        // What losing a PLAYED card costs: its scoring favor + ongoing power
        // + a slice for skills still enabling things.
        return g.scoredCardFavor(pi, c)
            + ((c.skills || []).includes('power') ? powerValue(g, pi, 1) : 0)
            + (c.skills || []).length * 0.5 + (c.special ? 1 : 0);
    }
    const cheapPlayed = (g, pi, filter) =>
        g.players[pi].playedCards.filter(filter || (() => true))
            .map(c => keepValue(g, pi, c)).sort((a, b) => a - b);

    const MISSION_SS_EV = {
        favor_per_charisma_x2: (g, pi) => 2 * (g.players[pi].skills.charisma || 0),
        favor_per_knowledge_x1: (g, pi) => (g.players[pi].skills.knowledge || 0),
        favor_per_minds_eye_x5: (g, pi) => 5 * g.getMindsEyeCount(pi),
        favor_per_philstone_x10: (g, pi) => 10 * (g.players[pi].philosopherStone || 0),
        philosopher_stone_x2_grant: () => 2 * (PB().stoneValue || 3.5),
        remove_20_scorn: (g, pi) => Math.min(20, (g.players[pi].scorn || 0) + 3),
        scorn_to_prestige_all: (g, pi) => 2 * (g.players[pi].scorn || 0)
            - g.players.reduce((s, q, j) => j === pi ? s : s + 2 * (q.scorn || 0), 0) * rival() / (g.playerCount - 1),
        duplicate_artifact: (g, pi) => {
            const a = cheapPlayed(g, pi, c => c.type === 'artifact');
            return a.length ? a[a.length - 1] * 0.9 : 0;
        },
        duplicate_potion: (g, pi) => {
            const a = cheapPlayed(g, pi, c => c.type === 'potion');
            return a.length ? a[a.length - 1] * 0.9 : 0;
        },
    };

    const MISSION_FS_EV = {
        gain_20_prestige: () => 20,
        you_gain_1_gold: (g) => gr(g),
        all_gain_2_gold: () => 0,
        all_draw_act3_mission: () => 0,
        others_gain_5_gold: (g) => -5 * gr(g) * (g.playerCount - 1) * rival(),
        others_gain_3_gold: (g) => -3 * gr(g) * (g.playerCount - 1) * rival(),
        others_gain_3_prestige: (g) => -3 * (g.playerCount - 1) * rival(),
        others_remove_15_scorn: (g, pi) => -g.players.reduce((s, q, j) =>
            j === pi ? s : s + Math.min(15, q.scorn || 0), 0) * rival(),
        prestige_2_per_knowledge: (g, pi) => 2 * (g.players[pi].skills.knowledge || 0),
        scorn_2_per_charisma: (g, pi) => -2 * (g.players[pi].skills.charisma || 0),
        scorn_5_per_knowledge: (g, pi) => -5 * (g.players[pi].skills.knowledge || 0),
        lose_all_prestige_and_scorn: (g, pi) =>
            (g.players[pi].scorn || 0) - (g.players[pi].prestige || 0),
        fortune_teller_50_prestige: (g, pi) =>
            g.players[pi].playedCards.some(c => c.name === 'Fortune Teller') ? 50 : 0,
        discard_1_played: (g, pi) => { const a = cheapPlayed(g, pi); return a.length ? -a[0] : 0; },
        discard_5_played: (g, pi) => -cheapPlayed(g, pi).slice(0, 5).reduce((s, v) => s + v, 0),
        discard_1_artifact: (g, pi) => {
            const a = cheapPlayed(g, pi, c => c.type === 'artifact'); return a.length ? -a[0] : 0;
        },
        discard_weapons_gain_5_prestige: (g, pi) =>
            cheapPlayed(g, pi, c => c.type === 'weapon').reduce((s, v) => s + (5 - v), 0),
        discard_power_gain_10_prestige: (g, pi) =>
            cheapPlayed(g, pi, c => c.type === 'weapon').reduce((s, v) => s + (10 - v), 0),
        discard_wisdom_gain_8_gold: (g, pi) =>
            cheapPlayed(g, pi, c => c.type === 'wisdom').reduce((s, v) => s + (8 * gr(g) - v), 0),
        discard_any_gain_8_prestige_each: (g, pi) =>   // A Promise — trade the chaff
            cheapPlayed(g, pi).filter(v => v < 8).reduce((s, v) => s + (8 - v), 0),
    };

    function missionBranch(g, pi, m) {
        const sr = m.successRewards || {};
        let success = (m.favorValue || 0) + (sr.gold || 0) * gr(g) + (sr.prestige || 0) - (sr.scorn || 0);
        if (sr.mindsEye) success += sr.mindsEye * (PB().eyeValue || 2.5);
        if (sr.philosopherStone) success += sr.philosopherStone * (PB().stoneValue || 3.5);
        // FLAT per-unit price for granted skills — skillUnitValue consults
        // held missions (via missionNet), so pricing grants through it
        // would recurse forever. Grants land at resolution, late in the
        // act; a modest constant (power a shade higher) stays acyclic.
        if (sr.skills) Object.entries(sr.skills).forEach(([s, n]) => {
            success += (s === 'power' ? 1.6 : 1.1) * n;
        });
        const ssFn = m.successSpecial && MISSION_SS_EV[m.successSpecial];
        if (ssFn) { try { success += ssFn(g, pi) || 0; } catch (e) { } }

        const fp = m.failurePenalties || {};
        let fail = -((fp.gold || 0) * gr(g)) - (fp.scorn || 0) - (fp.favor || 0) - (fp.prestige || 0);
        const fsFn = m.failSpecial && MISSION_FS_EV[m.failSpecial];
        if (fsFn) { try { fail += fsFn(g, pi) || 0; } catch (e) { } }
        return { success, fail };
    }

    // A met mission whose failure line pays better is LOST ON PURPOSE
    // (Alchemic Seige: fail +20 beats success −10 by thirty points).
    function wantsFailOnPurpose(g, pi, m) {
        const b = missionBranch(g, pi, m);
        return b.fail > b.success;
    }

    // Borrow only when the rescued success — minus the fee — still beats
    // the failure line. The fee funds a rival, so it prices above par.
    function borrowWorth(g, pi, m, plan) {
        if (!plan) return false;
        const b = missionBranch(g, pi, m);
        return b.success * urgency(g, pi)
            - plan.cost * gr(g) * 1.2 - plan.cost * rival() * 0.3 > b.fail;
    }

    // Lender picks for missionBorrowPlan: fund the TRAILING seat, never
    // the leader, when more than one neighbor can lend the unit.
    function preferredLenders(g, pi, m) {
        const borrowable = g.getBorrowableSkills(pi);
        const chosen = [];
        const reqCounts = {};
        (m.requirements || []).forEach(r => {
            if (r !== 'minds_eye' && r !== 'philosopher_stone') reqCounts[r] = (reqCounts[r] || 0) + 1;
        });
        const gapsNeeded = g.unmetSkillReqs(pi, reqCounts);
        Object.entries(gapsNeeded).forEach(([skill, short]) => {
            const lenders = (borrowable[skill] || []).slice()
                .sort((a, b) => standing(g, a) - standing(g, b) || relPos(g, pi, a) - relPos(g, pi, b));
            for (let k = 0; k < short && lenders.length; k++) {
                chosen.push({ skill, neighborIndex: lenders[0] });
            }
        });
        return chosen;
    }

    // Board pick: the better BRANCH of each visible mission, feasibility-
    // weighted — a mission taken to lose it is a legitimate take.
    function bestMission(g, pi) {
        let bestIdx = 0, bestVal = -Infinity;
        (g.visibleMissions || []).forEach((m, i) => {
            const b = missionBranch(g, pi, m);
            const req = {};
            (m.requirements || []).forEach(r => {
                if (r !== 'minds_eye' && r !== 'philosopher_stone') req[r] = (req[r] || 0) + 1;
            });
            const shortUnits = Object.values(g.unmetSkillReqs(pi, req)).reduce((s, n) => s + n, 0)
                + (m.requirements || []).filter(r => r === 'minds_eye').length
                    * (g.getMindsEyeCount(pi) ? 0 : 1)
                + (m.requirements || []).filter(r => r === 'philosopher_stone').length
                    * ((g.players[pi].philosopherStone || 0) ? 0 : 1);
            // Optimism fades as the act's rounds run out — early on, the
            // deck still owes this seat cards.
            const lin = shortUnits === 0 ? 1
                : Math.max(0.15, 1 - (0.12 + 0.03 * (g.turnInAct || 0)) * shortUnits);
            // Squared — a mission half-reachable is far worse than half a
            // mission: the failure penalties arrive whole.
            const feas = lin * lin;
            const val = Math.max(b.success * feas * urgency(g, pi), b.fail * 0.95);
            if (val > bestVal) { bestVal = val; bestIdx = i; }
        });
        return bestIdx;
    }

    // ── Turn decisions ───────────────────────────────────────────────────
    // Draft pick: full EV, discounted by how reachable the card's
    // requirements still are; the +3g discard floors every card.
    function pickCard(g, pi) {
        const p = g.players[pi];
        if (!p.hand || !p.hand.length) return;
        let bestIdx = 0, bestScore = -Infinity;
        const fw = (tbl('meleeFutureWeight'))[g.currentAct] || 1;
        p.hand.forEach((c, i) => {
            const req = g.checkRequirements(pi, c);
            const missing = (req.missingSkills || []).length + (req.missingSpecial || []).length;
            // A card never played is a +3g discard in disguise — dream
            // picks were drowning the hard seat in dead gold. Borrowable
            // skill gaps discount gently; anything further, steeply.
            let playability = req.canPlay ? 1
                : cardBorrowPlan(g, pi, c) ? 0.8
                : missing === 1 ? 0.5 : missing === 2 ? 0.25 : 0.12;
            if (!req.canPlay && g.currentAct === 3 && g.turnInAct >= 4) playability *= 0.5;
            let score = Math.max(cardEV(g, pi, c) * playability, 3 * gr(g, pi));
            // DRAFT DENIAL: a passed weapon fights AGAINST this seat at the
            // melee — taking power out of the rotation pays twice.
            const powerUnits = (c.skills || []).filter(s => s === 'power').length
                + ((c.special === 'power_6_if_blind_faith' || c.name === 'Archeus') ? 2 : 0);
            if (powerUnits) score += powerUnits * 0.45 * fw;
            if (score > bestScore) { bestScore = score; bestIdx = i; }
        });
        g.pickCard(pi, bestIdx);
    }

    // Can borrowed neighbor skills cover this card's gaps? Returns
    // [{skill, neighborIndex}, …] (trailing lenders first) or null. Only
    // SKILL gaps borrow — stones, eyes, maps and gold never do.
    // Lender tie-breaks must be ROTATION-INVARIANT: every MP client numbers
    // seats from its own human, so a raw-index tie-break picks a different
    // lender per client the moment standings tie (they always do in Act 1)
    // — a silent lockstep fork. Relative position around the circle from
    // the borrower reads identically on every client.
    const relPos = (g, pi, idx) => ((idx - pi) + g.playerCount) % g.playerCount;

    function cardBorrowPlan(g, pi, card) {
        const req = g.checkRequirements(pi, card);
        if (req.canPlay || (req.missingSpecial || []).length) return null;
        const missing = req.missingSkills || [];
        if (!missing.length) return null;
        const borrowable = g.getBorrowableSkills(pi);
        const plan = [];
        const bySkill = {};
        for (const s of missing) {
            bySkill[s] = bySkill[s] || (borrowable[s] || []).slice()
                .sort((a, b) => standing(g, a) - standing(g, b) || relPos(g, pi, a) - relPos(g, pi, b));
            if (!bySkill[s].length) return null;
            plan.push({ skill: s, neighborIndex: bySkill[s][0] });
        }
        const cost = plan.length * 2 + ((card.cost && card.cost > 0) ? card.cost : 0);
        return ((g.players[pi].gold || 0) >= cost) ? plan : null;
    }

    // Reveal: play vs borrow-&-play vs discard(+3g) vs discard-slide(free
    // space) vs the Mission Letter — in points, stable order on ties.
    function chooseAction(g, pi, card) {
        const p = g.players[pi];
        const discardEV = 3 * gr(g, pi);

        if (card.type === 'mission_letter') {
            if ((p.gold || 0) >= 1 && (g.visibleMissions || []).length > 0) {
                const idx = bestMission(g, pi);
                const m = g.visibleMissions[idx];
                const b = missionBranch(g, pi, m);
                const letterEV = (Math.max(b.success * 0.85, b.fail * 0.9) - 1 * gr(g))
                    * urgency(g, pi);
                if (letterEV > discardEV) return { action: 'mission_letter' };
            }
            return { action: 'discard' };
        }

        const req = g.checkRequirements(pi, card);
        const affordable = !(card.cost && card.cost > 0) || (p.gold || 0) >= card.cost
            || (card.reqMaps && card.reqMaps.length && g.getPlayerMaps(pi).some(m => card.reqMaps.includes(m)));
        let playEV = (req.canPlay && affordable) ? cardEV(g, pi, card) : -Infinity;
        let borrow = null;
        if (playEV === -Infinity) {
            borrow = cardBorrowPlan(g, pi, card);
            if (borrow) playEV = cardEV(g, pi, card) - borrow.length * 2 * gr(g, pi) * 1.2;
        }

        // A free space for the card: only when the play line is dead or thin.
        let slideEV = -Infinity, slideDir = 0;
        const here = slotValue(g, pi, p.sliderPosition);
        for (const dir of [-1, 1]) {
            if (p._paidSlideDir && dir !== p._paidSlideDir) continue;
            const t = p.sliderPosition + dir;
            if (t < 0 || t > 4) continue;
            const net = slotValue(g, pi, t) - here;
            if (net > slideEV) { slideEV = net; slideDir = dir; }
        }

        if (playEV >= discardEV && playEV >= slideEV) {
            return borrow ? { action: 'play', borrow } : { action: 'play' };
        }
        if (slideEV > discardEV + 0.5 && slideDir) return { action: 'discard_slide', dir: slideDir };
        return { action: 'discard' };
    }

    // ── Small decisions the engine consults ──────────────────────────────
    function wouldConvert(g, pi) {
        const p = g.players[pi];
        if (g.currentAct >= 3) return (p.gold || 0) > 0;
        if (g.currentAct === 2) return (p.gold || 0) >= 12 && !slidePlan(g, pi);
        return false;
    }

    function slotPick(g, pi, opts) {
        if (!opts || !opts.length) return null;
        let best = opts[0], bestV = -Infinity;
        opts.forEach(s => {
            const v = s === 'minds_eye' ? (PB().eyeValue || 2.5)
                : s === 'philosopher_stone' ? (PB().stoneValue || 3.5)
                : skillUnitValue(g, pi, s);
            if (v > bestV) { bestV = v; best = s; }
        });
        return best;
    }

    const freeSliderPos = (g, pi) => bestSlot(g, pi, true).idx;

    // ── Public surface ───────────────────────────────────────────────────
    window.FAI = {
        isHard,
        // turn decisions (ui.js drives these at the AI activation site)
        pickCard, preSlide, chooseAction, bestMission,
        // engine consults
        wantsFailOnPurpose, borrowWorth, preferredLenders,
        wouldConvert, slotPick, freeSliderPos,
        // evaluator internals — the arena and acceptance tests read these
        cardEV, slotValue, slidePlan, missionBranch, skillUnitValue,
    };
})();
