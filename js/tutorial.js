/**
 * FAVOR — How to Play v3: the fully guided game (branch howto-v3)
 *
 * A hand-holding walk through a REAL game where THE TUTORIAL OWNS THE PACING:
 * the player sits at a scripted three-seat table (You = the Bandit, Sir Aldric
 * = the Knight, Old Wren = the Fisherman) and plays a genuine game with the
 * actual engine — EVERY turn is prompted, and the missions phase and Melee are
 * narrated in place (the engine only advances when a step allows it; the Melee
 * is forced to wait-for-tap via window.TUT_ACTIVE, see showMeleeSplash).
 *
 * Scripted cards are rigged PER TURN and moved to the FRONT of the hand (from
 * this act's own deck/hands, or cloned from card data as a last resort) so the
 * lesson card is always first — the draft's pass-left rotation and the rivals'
 * picks stay genuine.
 *
 * SCOPE: the complete three-Act game, but the grip loosens as it goes.
 *   Act 1  — every single turn prompted and shielded; the player learns the loop.
 *   Act 2  — only the NEW things stop play (a Map's free play, borrowing, the
 *            Potion, the Mind's Eye / Philosopher's Stone gates, Artifacts);
 *            every other turn is theirs, unshielded (`freeTurn`).
 *   Act 3  — no new rules exist, so nothing interrupts but the Melee and the
 *            final score sheet.
 * At the end of Acts 1 and 2 the player is offered a FORK: carry on with the
 * guide, or `release()` — the tutorial tears itself down and this same game
 * continues as a normal one, board and score intact.
 *
 * Act 1's lessons are rigged BY NAME (every turn is scripted, so the state at
 * each beat is known). From Act 2 the player chooses their own cards, so the
 * lessons rig ADAPTIVELY instead — scoring every card reachable this act against
 * live state (see rigBest / borrowPlan) — and a lesson that no longer applies
 * removes itself via `skipIf` rather than lying.
 *
 * Integration contract (root game):
 *   reads/writes `game` (ui.js top-level binding), sets window.TUT_ACTIVE,
 *   calls showGameScreen, renderGameState, beginThrowPhase, throwCard,
 *   addLogEntry; anchors on #actionPanel [data-act], #missionSelect,
 *   #boardThumb, #boardOverlay, #handZone .hand-card, #missionCeremony,
 *   #meleeSplash, .stats-panel, .mission-strip.
 *   Remove = delete this file + css/tutorial.css + the two script/link tags
 *   and the `window.TUT_ACTIVE` guard in showMeleeSplash; nothing else
 *   references them.
 */
(function () {
    'use strict';

    const CAST = [
        { characterId: 'bandit',    playerName: 'You' },
        { characterId: 'knight',    playerName: 'Sir Aldric' },
        { characterId: 'fisherman', playerName: 'Old Wren' },
    ];

    // ── Card/mission rigging ─────────────────────────────────────────
    // Pull a card matching `pred` from anywhere in THIS act (deck first,
    // then rivals' hands) into the player's hand, swapping a non-key card
    // back so every count stays honest. `cloneName` is a last-resort: in a
    // live draft a rival can PLAY the exact card a lesson needs before we
    // pull it (gone from deck AND hands) — so for named lessons we clone a
    // fresh copy from the card data, still swapping one out to keep counts.
    function pullCard(pred, keepNames, cloneName) {
        const hand = game.players[0].hand;
        // Already holding it? Move it to the FRONT so the lesson card is the
        // first (leftmost) card — the pulse and the copy both point at it.
        const have = hand.findIndex(pred);
        if (have >= 0) {
            if (have > 0) { const [c] = hand.splice(have, 1); hand.unshift(c); }
            return true;
        }
        const act = game.currentAct;
        const give = hand.find(c => !keepNames.includes(c.name));
        const swapIn = (take) => {
            if (give) { hand.splice(hand.indexOf(give), 1); }
            hand.unshift(take);
        };
        const deckIdx = game.actDecks[act].findIndex(pred);
        if (deckIdx >= 0) {
            const take = game.actDecks[act].splice(deckIdx, 1)[0];
            if (give) game.actDecks[act].push(give);
            swapIn(take);
            return true;
        }
        for (let i = 1; i < game.playerCount; i++) {
            const rh = game.players[i].hand;
            const j = rh.findIndex(pred);
            if (j >= 0) {
                const take = rh.splice(j, 1)[0];
                if (give) rh.push(give);
                swapIn(take);
                return true;
            }
        }
        // Clone fallback (named lessons only): copy the data template, mint a
        // fresh id so it's a distinct card, drop the giveaway into the deck.
        if (cloneName && window.FAVOR_DATA && window.FAVOR_DATA.cards) {
            const tpl = window.FAVOR_DATA.cards.find(c => c.name === cloneName);
            if (tpl) {
                const clone = JSON.parse(JSON.stringify(tpl));
                clone.id = 'tut-' + cloneName.replace(/\s+/g, '') + '-' + (game.currentAct);
                if (give) game.actDecks[act].push(give);
                swapIn(clone);
                return true;
            }
        }
        return false;
    }
    const byName = n => c => c.name === n;
    // Cards the rig must never swap OUT of the hand to make room for another.
    // Act 1 lesson set: Hunting (endeavor+green glow), Shark Tooth (weapon/Power),
    // First Aid (endeavor, tops Survival to 3 for the mission), the Letter.
    // Act 2 adds Great North Connection (the Map payoff / Trade Route).
    const KEY_NAMES = ['Hunting', 'Shark Tooth', 'First Aid', 'Mission Letter', 'Great North Connection'];

    function rigTurn(preds) {
        preds.forEach(p => {
            const isName = typeof p === 'string';
            pullCard(isName ? byName(p) : p, KEY_NAMES, isName ? p : null);
        });
        renderGameState();
    }

    // ── Adaptive rigging (Acts 2 & 3) ────────────────────────────────
    // Act 1 rigs cards BY NAME because every turn is scripted, so the state at
    // each lesson is known exactly. From Act 2 the player picks their own cards
    // on the free turns, so a named card can be the wrong lesson by the time we
    // reach it ("borrow the skill you lack" is nonsense if they've since built
    // it). These pickers instead score every card reachable this act against
    // LIVE state and rig whichever one actually teaches the lesson.
    function reachableCards() {
        const act = game.currentAct;
        const out = [...game.players[0].hand];
        (game.actDecks[act] || []).forEach(c => out.push(c));
        for (let i = 1; i < game.playerCount; i++) out.push(...game.players[i].hand);
        return out;
    }
    // Highest-scoring card wins; a score of null/-Infinity means "not a fit".
    function rigBest(scoreFn) {
        let best = null, bestScore = -Infinity;
        reachableCards().forEach(c => {
            let s;
            try { s = scoreFn(c); } catch (e) { return; }
            if (s == null || !isFinite(s)) return;
            if (s > bestScore) { bestScore = s; best = c; }
        });
        if (!best) return null;
        // If the pull fails the card is NOT in hand — report no lesson rather
        // than pulse and narrate a card the player cannot see.
        if (!pullCard(x => x.id === best.id, KEY_NAMES, best.name)) return null;
        renderGameState();
        return best;
    }
    // Can the player cover this card's gap by BORROWING right now? Mirrors the
    // exact conditions ui.js uses to offer the "Borrow & Play" button, so a card
    // this returns true for is guaranteed to show it.
    function borrowPlan(card) {
        const r = game.checkRequirements(0, card);
        if (r.canPlay || r.mapFree) return null;
        if (r.missingSpecial.length || !r.missingSkills.length) return null;
        const lendable = game.getBorrowableSkills(0);
        if (!r.missingSkills.every(s => lendable[s] && lendable[s].length)) return null;
        const fee = r.missingSkills.length * 2;
        if (game.players[0].gold < fee + (card.cost || 0)) return null;
        return { missing: r.missingSkills, fee, lenders: lendable };
    }
    // The borrow lesson wants the SIMPLEST possible gap — ideally one missing
    // skill on a Potion, so one stop teaches both (Wyatt: fewer stops in Act 2).
    let borrowLesson = null;
    function rigBorrowLesson() {
        borrowLesson = null;
        const card = rigBest(c => {
            const plan = borrowPlan(c);
            if (!plan) return null;
            // Fewer missing skills is a cleaner lesson; a Potion doubles up.
            return 100 - plan.missing.length * 10 + (c.type === 'potion' ? 5 : 0);
        });
        if (card) borrowLesson = Object.assign({ card }, borrowPlan(card));
        return borrowLesson;
    }
    // ── Act 3 lesson pickers ─────────────────────────────────────────
    // A card a held Map plays for free. By Act 3 the player may be holding
    // several maps, so this asks the engine which card is actually free right
    // now rather than naming one — but prefers Market Trade Exchange, the card
    // the tutorial's own Act 1 → Act 2 → Act 3 chain was built to reach.
    let mapLesson = null;
    function rigMapFree() {
        mapLesson = rigBest(c => {
            let r;
            try { r = game.checkRequirements(0, c); } catch (e) { return null; }
            if (!r.mapFree) return null;
            return c.name === 'Market Trade Exchange' ? 100 : 50;
        });
        return mapLesson;
    }
    // Which of the player's maps opened it — for the copy, so the payoff is
    // traced back to the mission or card that earned it.
    const unlockingMap = (card) =>
        (card && card.reqMaps || []).find(m => heldMap(m)) || null;

    // Act 3's artifacts are the real novelty: Act 2's paid a flat number, these
    // pay a FORMULA off everything the player has built. Prefer one they can
    // actually play so the lesson can be acted on, not just admired.
    const FORMULA_TEXT = {
        favor_per_knowledge_x2: 'two Favor for every Knowledge you hold',
        favor_per_quest_x5: 'five Favor for every mission you completed',
        favor_per_sur_cha_pro: 'one Favor for every Survival, Charisma and Prospecting you hold',
        favor_per_artifact_x8: 'eight Favor for every Artifact you have played',
        favor_per_potion_x5: 'five Favor for every Potion you have played',
        favor_per_neighbor_power: 'one Favor for every point of Power your two neighbours hold',
    };
    let artifactLesson = null;
    function rigFormulaArtifact() {
        artifactLesson = rigBest(c => {
            if (c.type !== 'artifact' || !FORMULA_TEXT[c.special]) return null;
            let can = false;
            try { can = !!game.checkRequirements(0, c).canPlay; } catch (e) {}
            return can ? 100 : 50;
        });
        return artifactLesson;
    }
    // The Chemicals — the only cards that reach across the table and touch the
    // other heirs' scores.
    let chemLesson = null;
    function rigChemical() {
        chemLesson = rigBest(c => !/^Chemical /.test(c.name) ? null
            : (c.name === 'Chemical X' ? 100 : 60));
        return chemLesson;
    }

    const SKILL_LABEL = s => s.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
    // Name the seats that can actually lend the skills this lesson needs.
    function lenderNames() {
        if (!borrowLesson) return 'another heir';
        const seats = new Set();
        borrowLesson.missing.forEach(s => (borrowLesson.lenders[s] || []).forEach(i => seats.add(i)));
        const names = [...seats].map(i => game.players[i].name);
        return names.length ? names.join(' or ') : 'another heir';
    }
    // Make sure Helping the Merchant sits face-up in the mission pool, no matter
    // what — reclaim it from ANY deck or a rival who grabbed it, or clone it from
    // the data. Rivals are ALSO barred from taking missions in the tutorial
    // (window.TUT_ACTIVE guard in ui.js activateAllCards); this is the safety net.
    function rigMissions() {
        const NAME = 'Helping the Merchant';
        if (game.visibleMissions.some(m => m.name === NAME)) return;
        const pinToPool = (mission, fromDeck) => {
            const give = game.visibleMissions.pop();
            if (give) { (fromDeck || (game.missionDecks[1] = game.missionDecks[1] || [])).push(give); }
            game.visibleMissions.unshift(mission);
        };
        // 1) any mission deck
        for (const act of [1, 2, 3]) {
            const d = game.missionDecks[act] || [];
            const i = d.findIndex(m => m.name === NAME);
            if (i >= 0) { pinToPool(d.splice(i, 1)[0], d); return; }
        }
        // 2) reclaim from a rival who already claimed it (draft-time; not yet resolved)
        for (let pi = 1; pi < game.playerCount; pi++) {
            const held = game.players[pi].missions || [];
            const j = held.findIndex(m => m.name === NAME);
            if (j >= 0) { pinToPool(held.splice(j, 1)[0]); return; }
        }
        // 3) last resort: clone a fresh copy from the card data
        if (window.FAVOR_DATA && window.FAVOR_DATA.missions) {
            const tpl = window.FAVOR_DATA.missions.find(m => m.name === NAME);
            if (tpl) { const c = JSON.parse(JSON.stringify(tpl)); c.id = 'tut-mission-helping'; pinToPool(c); }
        }
    }
    const heldMap = name => game.getPlayerMaps(0).includes(name);
    // The card a name-rigged lesson is pointing at. rigTurn moves it to the
    // FRONT of the hand, so the first match is the one being taught.
    const inHand = name => game.players[0].hand.find(c => c.name === name) || null;
    const you = () => game.players[0];
    // The draft is over for this act — either a later phase has begun or the
    // whole act has rolled over. Used instead of `phase === 'missions'`, which
    // an act with no missions to resolve can pass through in a single tick.
    const pastDraft = (act) => game.phase === 'missions' || game.phase === 'melee'
        || game.phase === 'scoring' || game.currentAct !== act;

    // ── Lesson-card lock ─────────────────────────────────────────────
    // Wyatt: when a step points at a card, that card is the ONLY one the player
    // may play. Enforced in two places deliberately — the class is the
    // affordance (the rest of the hand greys out and stops taking pointers),
    // the wrapper around ui.js's global throwCard is the guarantee. The class
    // alone is not enough: the hand re-renders on every state change, so
    // anything painted on can be wiped between one render and the next, and
    // both drag paths (_handDragEnd / _deskDragEnd) end in a bare throwCard(i)
    // that would sail straight through.
    let lockedCardId = null, origThrowCard = null, lastHoleRect = null;

    function lockCardTo(card) { lockedCardId = card ? card.id : null; applyCardLock(); }
    function clearCardLock() { lockedCardId = null; applyCardLock(); }

    // The DOM element for the card the current lesson is pointing at. Looked up
    // by id through the hand index every time, because the hand re-renders
    // constantly and any element reference we cached would go stale.
    function lessonCardEl() {
        if (lockedCardId == null) return null;
        const hand = (game && game.players && game.players[0]) ? game.players[0].hand : [];
        const idx = hand.findIndex(c => c && c.id === lockedCardId);
        if (idx < 0) return null;
        const all = [...document.querySelectorAll('.hand-card[data-hand-i="' + idx + '"]')];
        return all.find(e => e.getBoundingClientRect().width > 0) || null;
    }

    function applyCardLock() {
        const hand = (game && game.players && game.players[0]) ? game.players[0].hand : [];
        document.querySelectorAll('.hand-card').forEach(el => {
            const i = parseInt(el.getAttribute('data-hand-i'), 10);
            const c = isNaN(i) ? null : hand[i];
            el.classList.toggle('tut-locked',
                lockedCardId != null && (!c || c.id !== lockedCardId));
        });
    }

    // A top-level `function throwCard()` in a classic script is a writable
    // property of the global object, so replacing it re-points the bare calls
    // inside ui.js's drag handlers too. Restored by release().
    function installThrowGuard() {
        if (typeof window.throwCard !== 'function' || window.throwCard.__tutGuarded) return;
        origThrowCard = window.throwCard;
        const guarded = function (index) {
            if (active && lockedCardId != null) {
                const c = game.players[0].hand[index];
                if (!c || c.id !== lockedCardId) {
                    // Not the card the lesson is pointing at — refuse, and make
                    // the right one unmistakable rather than failing silently.
                    if (pulseEl) {
                        pulseEl.classList.remove('tut-pulse');
                        void pulseEl.offsetWidth;              // restart the animation
                        pulseEl.classList.add('tut-pulse');
                    }
                    return;
                }
            }
            return origThrowCard.apply(this, arguments);
        };
        guarded.__tutGuarded = true;
        window.throwCard = guarded;
    }
    function removeThrowGuard() {
        if (origThrowCard && window.throwCard && window.throwCard.__tutGuarded) {
            window.throwCard = origThrowCard;
        }
        origThrowCard = null;
    }

    // ── State probes the steps gate on ───────────────────────────────
    const panelActive = () => {
        const p = document.getElementById('actionPanel');
        return !!p && p.classList.contains('active');
    };
    const overlayActive = (sel) => {
        const e = document.querySelector(sel);
        return !!e && e.classList.contains('active');
    };
    // Between turns: your card isn't committed and no chooser is up — the
    // moment it's safe to rig the next hand and prompt the next throw.
    const gameplayIdle = () =>
        game.phase === 'gameplay' && game.pendingActivations[0] === null && !panelActive();

    // ── Melee gate ───────────────────────────────────────────────────
    // Wyatt: the Melee prompt must come up FIRST — read it, hit Next, THEN the
    // cinematic starts (unobstructed). showMeleeSplash (ui.js) awaits this gate
    // when TUT_ACTIVE; the melee step's Next resolves it. meleePreOk covers the
    // (human-impossible) case where Next fires before the cinematic asks.
    let meleeResolve = null, meleePreOk = false;
    function tutMeleeGate() {
        return new Promise(res => {
            if (meleePreOk) { meleePreOk = false; res(); return; }
            meleeResolve = res;
        });
    }
    function tutMeleeGo() {
        if (meleeResolve) { const r = meleeResolve; meleeResolve = null; r(); }
        else meleePreOk = true;
    }

    // ── The shield: 4 blocker slabs + a spotlight hole + the bubble ──
    let root, hole, bubble, blockers, tick = null, stepIdx = -1, active = false;

    function buildDom() {
        root = document.createElement('div');
        root.id = 'tutRoot';
        root.innerHTML = `
            <div class="tut-block" data-b="top"></div>
            <div class="tut-block" data-b="bottom"></div>
            <div class="tut-block" data-b="left"></div>
            <div class="tut-block" data-b="right"></div>
            <div id="tutHole"></div>
            <div id="tutBubble">
                <div class="tut-kicker">How to Play</div>
                <div class="tut-title"></div>
                <div class="tut-text"></div>
                <div class="tut-anatomy"></div>
                <button class="btn-royal primary tut-next"><span>Next</span></button>
                <div class="tut-choices"></div>
                <div class="tut-count"></div>
            </div>
            <button id="tutSkip" title="Leave the tutorial">Skip tutorial ✕</button>`;
        document.body.appendChild(root);
        hole = root.querySelector('#tutHole');
        bubble = root.querySelector('#tutBubble');
        blockers = [...root.querySelectorAll('.tut-block')];
        bubble.querySelector('.tut-next').onclick = () => {
            const s = STEPS[stepIdx];
            if (s && s.advance === 'next') {
                if (s.onNext) { try { s.onNext(); } catch (e) { /* non-fatal */ } }
                nextStep();
            }
        };
        // Skip-anytime — persistent, works in every step (shielded or watch).
        root.querySelector('#tutSkip').onclick = skip;
        window.addEventListener('resize', () => { bubbleFixed = false; layout(); });
    }

    // Leave the guided game for the real menu. On the standalone How-to page
    // (tools/howto.html = index.html + this driver) that lands on the title.
    function skip() {
        if (!active) return;
        if (!window.confirm('Leave the tutorial and go to the menu?')) return;
        active = false;
        if (tick) clearInterval(tick);
        try { window.CINEMATIC_SPEED = 1.0; } catch (e) {}
        location.assign('index.html');
    }

    // Drop the guide but KEEP PLAYING THIS GAME — offered at each Act boundary
    // (Wyatt: "they have the basic tools now"). Unlike skip(), nothing is thrown
    // away: the player's board, skills, gold, Prestige and missions carry on into
    // a normal game from exactly where the tutorial left them.
    //
    // Every tutorial-only guard must come OFF here or the rest of the game plays
    // by tutorial rules: TUT_ACTIVE makes the Melee wait for a tap that will
    // never come (no bubble left to tap) and bars the rivals from claiming
    // missions. Resolve any Melee gate still parked on a promise first.
    function release() {
        if (!active) return;
        active = false;
        if (tick) clearInterval(tick);
        stopCardTracking();
        clearPulse();
        removeThrowGuard();            // ui.js gets its own throwCard back
        tutMeleeGo();                  // free a pending splash, if any
        window.TUT_ACTIVE = false;     // Melee auto-plays; rivals take missions again
        window.__tutMeleeGate = null;
        try { window.CINEMATIC_SPEED = 1.0; } catch (e) {}
        window.removeEventListener('resize', layout);
        if (root) root.remove();
        try {
            addLogEntry('═══ Tutorial dismissed — the game plays on ═══');
            if (typeof showNotification === 'function') {
                showNotification("You're on your own now — good luck.", 'act');
            }
            renderGameState();
        } catch (e) { /* cosmetic only */ }
    }

    // Phone landscape runs the TABLE VIEW (tv-* ids); desktop runs .game-layout.
    // Map each desktop anchor to its table-view twin and let coachEl (ui.js) pick
    // whichever is actually VISIBLE — same helper the in-game coach-marks use.
    const PHONE_ALT = {
        '#boardThumb': '#tvBoardThumb',
        '.stats-panel': '#tvPurse',
        '.mission-strip': '#tvMissionRail',
        '#handZone': '#tvHandStrip',
    };
    function targetEl(s) {
        if (!s || !s.target) return null;
        if (typeof s.target === 'function') return s.target();
        const alt = PHONE_ALT[s.target];
        if (alt && typeof coachEl === 'function') return coachEl(alt, s.target);
        return document.querySelector(s.target);
    }

    // The phone/table-view build (same query ui.js uses for isCompactLandscape).
    const isShortScreen = () =>
        window.matchMedia('(orientation: landscape) and (max-height: 540px)').matches;

    // While a step spotlights one card, re-run the layout EVERY FRAME. The
    // 300ms heartbeat is far too slow to follow a 0.22s bloom: the card grows
    // to ~4x and the lit hole arrives up to a third of a second later, which
    // reads exactly like the card being half-dimmed. rAF costs nothing here —
    // it only runs while such a step is on screen.
    // A spotlight step places its prompt once and then holds it (see layout).
    let trackRaf = null, bubbleFixed = false;
    function startCardTracking() {
        if (trackRaf != null) return;
        let lastKey = '';
        const frame = () => {
            const s = STEPS[stepIdx];
            if (!active || !s || !s.spotlightCard || !armed) { trackRaf = null; return; }
            // Only re-lay-out when the card has actually moved. A bloom changes
            // its rect every frame; a still card changes nothing and costs one
            // getBoundingClientRect. This is a SMOOTHNESS layer only — the 300ms
            // heartbeat still runs, so if rAF never fires the spotlight is
            // simply as accurate as it was before, never wrong.
            const el = lessonCardEl();
            const r = el ? el.getBoundingClientRect() : null;
            const key = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : '';
            if (key !== lastKey) { lastKey = key; layout(); }
            trackRaf = requestAnimationFrame(frame);
        };
        trackRaf = requestAnimationFrame(frame);
    }
    function stopCardTracking() {
        if (trackRaf != null) { cancelAnimationFrame(trackRaf); trackRaf = null; }
    }

    function layout() {
        if (!active) return;
        const s = STEPS[stepIdx];
        if (!s) return;
        // A ready-gated step stays INVISIBLE until its moment arrives — no
        // bubble or shield pops over the reveal cinematic playing behind it.
        if (!armed) {
            hole.style.display = 'none';
            blockers.forEach(b => { b.style.display = 'none'; });
            bubble.style.display = 'none';
            return;
        }
        bubble.style.display = '';
        // No-shield step (e.g., the slider, which sits over the board overlay —
        // dimming would black out the board Wyatt is trying to look at). Just the
        // bubble, off to a side so the board stays visible.
        if (s.noShield) {
            hole.style.display = 'none';
            blockers.forEach(b => { b.style.display = 'none'; });
            placeBubble(null, s);
            return;
        }
        // An anatomy step carries the card INSIDE the bubble, and on a phone
        // that bubble is most of the screen. Spotlighting the hand as well only
        // guarantees the prompt covers it — so on a short screen these steps
        // drop the spotlight and simply centre. Desktop is unchanged, where
        // there is room for both.
        const el = (s._hasAnatomy && isShortScreen()) ? null : targetEl(s);
        const watch = s.mode === 'watch';
        root.classList.toggle('tut-watch', watch);

        if (watch || !el) {
            hole.style.display = 'none';
            blockers.forEach(b => {
                b.style.display = watch ? 'none' : 'block';
                if (!watch) Object.assign(b.style, { left: 0, top: 0, right: 0, bottom: 0, width: 'auto', height: 'auto' });
            });
            // one full blocker is enough — park the other three
            if (!watch) for (let i = 1; i < 4; i++) blockers[i].style.display = 'none';
            placeBubble(null, s);
            return;
        }
        // A step that points at ONE card spotlights the CARD, not the hand strip.
        // The dim is a 200vmax box-shadow spreading from #tutHole, and the hand
        // sits far below it in the stack (z~40 vs 11985) — so anything outside
        // the hole is dimmed no matter how the card is layered. Hovering blooms
        // the card to ~4x, up and out of the strip, and everything above the
        // strip's edge goes dark unless the HOLE follows it.
        //
        // The card is found by the LOCKED CARD'S ID, not by pulseEl: only three
        // of these steps declare a `pulse`, so keying off the pulse left the
        // other five (Shark Tooth, Mission Letter, First Aid, Cooking, the
        // borrow lesson) falling back to the hand strip and still half-dimmed.
        const cardEl = s.spotlightCard ? lessonCardEl() : null;
        // Never fall back to the strip mid-step. The hand rebuilds its elements
        // on every render, so for a tick or two the card element simply does not
        // exist — snapping the hole out to the whole hand and back is exactly
        // the blink Wyatt saw on "A Card You Can't Afford". Hold the last good
        // position instead and pick the card up again next tick.
        if (s.spotlightCard && !cardEl) {
            if (!bubbleFixed) placeBubble(lastHoleRect, s);   // don't nudge a placed prompt
            return;
        }
        hole.classList.toggle('tut-hole-track', !!cardEl);
        const pad = cardEl ? 8 : (s.pad != null ? s.pad : 10);
        const r = (cardEl || el).getBoundingClientRect();
        const x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad);
        const w = Math.min(window.innerWidth, r.right + pad) - x;
        const h = Math.min(window.innerHeight, r.bottom + pad) - y;
        hole.style.display = 'block';
        Object.assign(hole.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
        lastHoleRect = { x: x, y: y, w: w, h: h };
        const set = (b, v) => Object.assign(b.style, { display: 'block' }, v);
        set(blockers[0], { left: 0, top: 0, width: '100vw', height: y + 'px', right: 'auto', bottom: 'auto' });
        set(blockers[1], { left: 0, top: (y + h) + 'px', width: '100vw', height: Math.max(0, window.innerHeight - y - h) + 'px', right: 'auto', bottom: 'auto' });
        set(blockers[2], { left: 0, top: y + 'px', width: x + 'px', height: h + 'px', right: 'auto', bottom: 'auto' });
        set(blockers[3], { left: (x + w) + 'px', top: y + 'px', width: Math.max(0, window.innerWidth - x - w) + 'px', height: h + 'px', right: 'auto', bottom: 'auto' });
        // A spotlight step places its prompt ONCE, from the card at REST. The
        // tracking loop re-runs this every frame, and re-placing the bubble each
        // time would send it skating across the screen as the card blooms.
        if (!(s.spotlightCard && bubbleFixed)) {
            placeBubble({ x, y, w, h }, s);
            if (s.spotlightCard) bubbleFixed = true;
        }
    }

    const areaOverlap = (a, b) => {
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        return (w > 0 && h > 0) ? w * h : 0;
    };

    // Everything here is positioned in EXPLICIT PIXELS, including the centred
    // case, which used to ride on a `left: 50% !important` class rule. That rule
    // was losing to a stale inline `left` and parking centred prompts 200px off
    // the left edge of the screen (found by measuring every step, not by
    // reading the CSS — the stylesheet looks correct).
    //
    // The bubble also now REFUSES to sit on top of the thing it is pointing at
    // where it has any choice: it tries below / above / right / left and keeps
    // whichever lands fully on screen without covering the spotlight. That is
    // Wyatt's "the text box covers up what the player needs to see".
    function placeBubble(rect, s) {
        bubble.classList.remove('tut-b-center', 'tut-b-corner', 'tut-b-left', 'tut-b-right');
        // Watch beats keep the corner treatment — deliberately out of the way.
        if (s.mode === 'watch') { bubble.classList.add('tut-b-corner'); bubble.style.left = ''; bubble.style.top = ''; return; }
        if (s.bubbleSide === 'left' || s.bubbleSide === 'right') {
            bubble.classList.add(s.bubbleSide === 'left' ? 'tut-b-left' : 'tut-b-right');
            bubble.style.left = ''; bubble.style.top = ''; return;
        }
        const VW = window.innerWidth, VH = window.innerHeight, M = 10, GAP = 14;
        const bw = bubble.offsetWidth || Math.min(430, VW - 24);
        const bh = bubble.offsetHeight || 180;
        const clampX = v => Math.max(M, Math.min(v, VW - bw - M));
        const clampY = v => Math.max(M, Math.min(v, VH - bh - M));
        const put = (x, y) => { bubble.style.left = clampX(x) + 'px'; bubble.style.top = clampY(y) + 'px'; };

        if (!rect) { put((VW - bw) / 2, (VH - bh) / 2); return; }

        // Bias sideways AWAY from the card being pointed at, so on the steps
        // that spotlight one card the prompt naturally settles on the empty side
        // rather than over the fan.
        let bias = rect.x + rect.w / 2;
        if (pulseEl && document.contains(pulseEl)) {
            const p = pulseEl.getBoundingClientRect();
            if (p.width) bias = (p.left + p.width / 2) < VW / 2 ? VW * 0.72 : VW * 0.28;
        }
        const midX = clampX(bias - bw / 2);
        const midY = clampY(rect.y + rect.h / 2 - bh / 2);
        const cands = [
            { x: midX, y: rect.y + rect.h + GAP },      // below
            { x: midX, y: rect.y - bh - GAP },          // above
            { x: rect.x + rect.w + GAP, y: midY },      // right
            { x: rect.x - bw - GAP, y: midY },          // left
        ];
        let best = null;
        cands.forEach(c => {
            const fits = c.x >= M - 1 && c.y >= M - 1 && c.x + bw <= VW - M + 1 && c.y + bh <= VH - M + 1;
            // Score AFTER clamping — an off-screen candidate gets dragged back
            // on screen and may then cover the target, which must count against it.
            const box = { x: clampX(c.x), y: clampY(c.y), w: bw, h: bh };
            const score = (fits ? 0 : 1e7) + areaOverlap(box, rect);
            if (!best || score < best.score) best = { x: c.x, y: c.y, score: score };
        });
        put(best.x, best.y);
    }

    // ── Step engine ──────────────────────────────────────────────────
    let pulseEl = null, clickArm = null, armed = true;

    function skipStep(s) {
        let skip;
        try { skip = !!s.skipIf(); } catch (e) { return false; }   // on doubt, keep the step
        // A skipped step may still owe the game something — the Melee beats hold
        // the cinematic on a promise that only their Next resolves, so skipping
        // one without releasing it would freeze the Melee forever.
        if (skip && s.onSkip) { try { s.onSkip(); } catch (e) { console.warn('[TUT] onSkip failed:', s.id, e); } }
        return skip;
    }
    // What the player has actually committed this turn — pendingActivations
    // holds a single card most turns and an ARRAY on the last-two-cards turn.
    // The Act 2 lessons check this before narrating: the hand is theirs to drag
    // from, so a prompt that says "throw the Potion" can be answered with
    // something else entirely, and the follow-up must not describe a card that
    // isn't on the table.
    function pendingCards(pi) {
        const p = game.pendingActivations[pi];
        return p == null ? [] : (Array.isArray(p) ? p : [p]);
    }
    const committed = (cardId) => pendingCards(0).some(c => c && c.id === cardId);

    function applyPulse(s) {
        if (!s.pulse) return;
        // Both layouts share class names (.hand-card, [data-act]) with one copy
        // hidden — pulse the VISIBLE one (offsetParent is null when hidden).
        const all = [...document.querySelectorAll(s.pulse)];
        const p = all.find(e => e.offsetParent !== null) || all[0];
        if (p) { p.classList.add('tut-pulse'); if (s.pulseCls) p.classList.add(s.pulseCls); pulseEl = p; }
    }

    function showStep(i) {
        stepIdx = i;
        const s = STEPS[i];
        if (!s) return finish();
        // A lesson that no longer applies steps aside rather than lying. From
        // Act 2 the player picks their own cards, so a beat like "borrow the
        // skill you lack" can be moot by the time we reach it.
        //
        // NOTE the ordering: for a ready-gated step this is checked when the
        // gate FIRES, not now. A step queued during the Melee would otherwise
        // test its condition against act-transition state — minutes of play
        // before the moment it actually describes.
        if (s.skipIf && !s.ready && skipStep(s)) return showStep(i + 1);
        if (s.before) { try { s.before(); } catch (e) { console.warn('[TUT] before failed:', s.id, e); } }
        // title, like text, may be a function — the adaptive Act 2 lessons don't
        // know which card they're teaching until they run.
        bubble.querySelector('.tut-title').textContent =
            (typeof s.title === 'function' ? s.title() : s.title) || '';
        const txt = typeof s.text === 'function' ? s.text() : s.text;
        bubble.querySelector('.tut-text').innerHTML = txt;
        bubble.querySelector('.tut-anatomy').innerHTML = s.anatomy || '';
        // A choice step replaces Next with its own buttons (Act boundaries:
        // carry on with the guide, or take the game solo from here).
        const cw = bubble.querySelector('.tut-choices');
        cw.innerHTML = '';
        bubble.querySelector('.tut-next').style.display =
            (s.advance === 'next' && !s.choices) ? '' : 'none';
        if (s.choices) {
            s.choices.forEach(c => {
                const b = document.createElement('button');
                b.className = 'btn-royal tut-choice' + (c.primary ? ' primary' : '');
                b.innerHTML = `<span>${c.label}</span>`;
                b.onclick = () => {
                    if (c.onPick) { try { c.onPick(); } catch (e) { console.warn('[TUT] choice failed:', c.label, e); } }
                    if (c.stop) return;      // released / left — no next step
                    nextStep();
                };
                cw.appendChild(b);
            });
        }
        bubble.querySelector('.tut-count').textContent = `${i + 1} / ${STEPS.length}`;
        clearPulse();

        // Show the shield+bubble+pulse and start listening for advance.
        const arm = () => {
            armed = true;
            // Lock the hand to this lesson's card BEFORE the pulse, so the
            // greying-out and the glow appear in the same frame.
            lastHoleRect = null; bubbleFixed = false;
            if (s.lockCard) { try { lockCardTo(s.lockCard()); } catch (e) { clearCardLock(); } }
            applyPulse(s);
            layout();
            if (s.spotlightCard) startCardTracking();
            armAdvance(s);
        };

        // Edge-trigger guard: a step that reacts to state X must not arm
        // until X has actually ARRIVED — otherwise a stale "not X yet"
        // satisfies the exit condition instantly and the script skips. While
        // it waits, the overlay is HIDDEN so the game plays unobstructed.
        if (s.ready) {
            armed = false;
            layout();   // hides everything while we wait
            const gate = setInterval(() => {
                if (stepIdx !== STEPS.indexOf(s)) { clearInterval(gate); return; }
                let r = false;
                try { r = s.ready(); } catch (e) { /* not yet */ }
                if (r) {
                    clearInterval(gate);
                    // The moment has arrived — NOW ask whether this lesson still
                    // applies (see the note in showStep).
                    if (s.skipIf && skipStep(s)) { showStep(STEPS.indexOf(s) + 1); return; }
                    if (s.onReady) { try { s.onReady(); } catch (e) { console.warn('[TUT] onReady failed:', s.id, e); } }
                    arm();
                }
            }, 250);
        } else {
            arm();
        }
    }

    function clearPulse() {
        stopCardTracking();
        if (pulseEl) { pulseEl.classList.remove('tut-pulse', 'tut-pulse-green'); pulseEl = null; }
        if (clickArm) { document.removeEventListener('click', clickArm, true); clickArm = null; }
        clearCardLock();
    }

    // The hand rebuilds its elements on every renderGameState, which throws away
    // the glow and the lock along with the old nodes. The layout tick re-asserts
    // both whenever the element we marked is no longer in the document — so a
    // rival's play mid-step can't quietly unlock the hand or drop the pulse.
    function reassertMarks() {
        const s = STEPS[stepIdx];
        if (!s || !armed) return;
        if (lockedCardId != null) applyCardLock();
        if (s.pulse && (!pulseEl || !document.contains(pulseEl))) {
            if (pulseEl) pulseEl.classList.remove('tut-pulse', 'tut-pulse-green');
            pulseEl = null;
            applyPulse(s);
        }
    }

    function armAdvance(s) {
        if (s.advance === 'next') return;
        if (s.advance === 'click') {
            clickArm = (e) => {
                const el = targetEl(s);
                if (el && (e.target === el || el.contains(e.target))) {
                    document.removeEventListener('click', clickArm, true); clickArm = null;
                    setTimeout(nextStep, s.delay != null ? s.delay : 500);
                }
            };
            document.addEventListener('click', clickArm, true);
            return;
        }
        if (typeof s.advance === 'function') {
            const poll = setInterval(() => {
                if (stepIdx !== STEPS.indexOf(s)) { clearInterval(poll); return; }
                let ok = false;
                try { ok = s.advance(); } catch (e) { /* not yet */ }
                if (ok) { clearInterval(poll); setTimeout(nextStep, s.delay != null ? s.delay : 700); }
            }, 300);
        }
    }

    function nextStep() { showStep(stepIdx + 1); }

    function finish() {
        active = false;
        if (tick) clearInterval(tick);
        clearPulse();
        root.classList.add('tut-done');
        root.innerHTML = `
            <div class="tut-finale">
                <div class="tut-finale-card">
                    <div class="tut-kicker">How to Play</div>
                    <h2>The Court Awaits</h2>
                    <p>You know the table, the cards, the missions, the Melee and the score.
                       Gold flows, skills stay, Favor crowns the winner. Go take the throne.</p>
                    <button class="btn-royal primary" onclick="location.reload()"><span>Play Again</span></button>
                </div>
            </div>`;
    }

    // ── Fast-forward: let the real loop run at speed, auto-answering ──
    let ffOn = false;
    function fastForward(untilFn, done) {
        ffOn = true;
        window.CINEMATIC_SPEED = 0.15;
        const drive = setInterval(() => {
            try {
                if (untilFn()) {
                    clearInterval(drive);
                    ffOn = false;
                    window.CINEMATIC_SPEED = 1.0;
                    done();
                    return;
                }
                // Your throw, played for you.
                if (game.phase === 'gameplay' && game.pendingActivations[0] === null
                    && game.players[0].hand.length) {
                    throwCard(0);
                }
                // Your reveal, answered for you: Play when it can, else Discard.
                const panel = document.getElementById('actionPanel');
                if (panel && panel.classList.contains('active')) {
                    const play = panel.querySelector('[data-act="play"]');
                    const discard = panel.querySelector('[data-act="discard"]');
                    (play || discard) && (play || discard).click();
                }
            } catch (e) { /* keep driving */ }
        }, 450);
    }

    // ═════════════════════════════════════════════════════════════════
    // THE SCRIPT — every prompt, with the why (rendered on the review
    // page). text may be a function for live values.
    // ═════════════════════════════════════════════════════════════════
    // Card art in the CENTER, callout labels in the side gutters so they
    // never cover the symbols they describe. o = {left:[...], right:[...], below}.
    const AN = (img, o) => `
        <div class="tut-anat2">
            <div class="aa-side left">${(o.left || []).map(t => `<span class="aa-lbl">${t}</span>`).join('')}</div>
            <div class="aa-card"><img src="${img}" alt=""></div>
            <div class="aa-side right">${(o.right || []).map(t => `<span class="aa-lbl">${t}</span>`).join('')}</div>
        </div>${o.below ? `<div class="tut-anat-cap">${o.below}</div>` : ''}`;

    // A turn the player owns outright (Acts 2 & 3). Wyatt: once the basics are
    // taught, hand the wheel over — "give the player more control over what
    // cards they can play, except for when the tutorial stuff pops up." So this
    // is a WATCH step: no shield, no pulse, the hand fully live, just a corner
    // bubble saying the table is theirs.
    //
    // Advancing keys off HAND SIZE, which drops by exactly one per draft turn
    // (everyone commits a card, then the shortened hands rotate left) and never
    // grows again inside an act. That matters: the obvious implementation —
    // watch for a card to become pending, then for the reveal to finish —
    // depends on a 300ms poll catching a transient state, and a player who
    // throws their next card the instant the reveal ends slips straight through
    // the gap. The step then sits on "your turn" for the whole act while every
    // lesson queued behind it is silently lost. A monotonic quantity cannot be
    // missed however fast they play.
    //
    // (`game.turnInAct` looks like the natural counter and is NOT: it is only
    // bumped by nextActivation(), which this UI never calls — ui.js drives the
    // draft itself through passHands(). It sits at 0 all game.)
    function freeTurn(o) {
        let handAtStart = 0, actAtStart = 0;
        return Object.assign({
            mode: 'watch',
            ready: () => gameplayIdle(),
            onReady: () => { handAtStart = you().hand.length; actAtStart = game.currentAct; },
            advance: () => game.phase === 'missions' || game.phase === 'melee'
                || game.currentAct !== actAtStart
                || you().hand.length < handAtStart,
            delay: 500,
        }, o);
    }

    // The Act-boundary fork, offered at the end of Acts 1 and 2 (Wyatt): carry on
    // with the guide, or take this same game solo from here. `stop: true` means
    // the button does NOT advance the script — release() has torn it down.
    const FORK = (nextLabel) => [
        { label: nextLabel, primary: true },
        { label: "I've got this — finish on my own", onPick: release, stop: true },
    ];

    const STEPS = [
    // ══════════ OPENING — the table, the pieces, the goal ══════════
    {
        id: 'welcome', target: null, advance: 'next',
        title: 'Welcome to FAVOR',
        text: `The King is dead — and you are one of his heirs. Over three <b>Acts</b>
               you'll play cards, chase missions and clash in the <b>Melee</b>. Whoever
               holds the most <b>Favor</b> when the dust settles takes the crown. Let's
               play a real hand together — I'll stop and explain every new thing as it comes.`,
        why: 'Sets the fantasy and the single win condition (Favor) before any mechanics.',
    },
    {
        id: 'your-board', target: '#boardThumb', advance: 'next',
        title: 'Your Character Board',
        text: `You play the <b>Bandit</b>. This is your board. Your ring sits on the
               <b>center slot</b>, which quietly feeds you <b>+2 Power</b> the whole time
               you stand there — and every hero's board grants something different.`,
        why: 'Orients to their own board and plants that boards GRANT resources — the Bandit Power pays off at the Melee.',
    },
    {
        id: 'purse', target: '.stats-panel', advance: 'next',
        title: 'Your Purse & Reputation',
        text: `Four numbers to watch. <b>Gold</b> pays to play cards and to borrow.
               <b>Prestige</b> is points you win — mostly in the Melee. <b>Scorn</b> is
               points AGAINST you. <b>Favor</b> is the score itself. Gold isn't points —
               but ties go to the richer heir.`,
        why: 'The four currencies, one line each. Players confuse Gold with score — the tiebreaker settles it early.',
    },
    {
        id: 'missions-pool', target: '.mission-strip', advance: 'next',
        title: 'The Mission Pool',
        text: `Three missions always wait face-up in the middle of the table. Missions are
               the single biggest source of Favor — we'll claim one in a few turns.`,
        why: 'Names the third table zone and promises the mission beat.',
    },
    {
        id: 'hand-intro', target: '#handZone', advance: 'next', pad: 16,
        title: 'Your Hand — and the Draft',
        text: `Seven cards. Each turn every player secretly commits <b>one</b> card, then
               all are revealed at once. The twist: the cards you DON'T use are
               <b>passed to your left</b>. Everyone drafts from everyone's hands — so your
               hand changes every single turn.`,
        why: "The draft-and-pass rule is FAVOR's most alien mechanic — it gets its own beat before anything is thrown.",
    },
    {
        id: 'card-types', target: '#handZone', advance: 'next', pad: 16,
        title: 'Six Kinds of Card',
        text: `Every card is one of six types: <b>Endeavors</b> (build skills),
               <b>Weapons</b> (⚔ Power for the Melee), <b>Adventures</b> (Favor & skills),
               <b>Wisdom</b> (rare skills), <b>Potions</b> (instant effects) and
               <b>Artifacts</b> (pure Favor) — plus <b>Mission Letters</b>. Potions and
               Artifacts appear in later Acts; you'll meet each type as it comes. Let's
               read your first card.`,
        why: 'Names all types up front (Wyatt: explain all on sight) so each later reveal lands prepared; flags that some are later-Act.',
    },

    // ══════════ TURN 1 — ENDEAVOR (card anatomy + the green glow) ══════════
    {
        id: 'card-anatomy', target: '#handZone', advance: 'next', pad: 16,
        before: () => rigTurn(['Hunting']),
        title: 'Reading a Card',
        text: `Here's <b>Hunting</b>, an Endeavor from your hand. Every card speaks the same
               language — <b>top-left is the cost, top-right is what you gain</b>:`,
        anatomy: () => AN('assets/cards/regular/Hunting Card.jpg', {
            left: ['⬅ <b>TOP-LEFT — the COST.</b> Skills you must already have (Hunting needs 1 Power — your board covers it), or Gold.'],
            right: ['<b>TOP-RIGHT — what it GRANTS ➡</b> Gold ovals are the skills you gain (here, 2 Survival). Skills stay for the whole game.'],
            below: `Some cards also carry a blue <b>Favor</b> shield along the bottom — those score points at the very end. Hunting has none: it builds skills, not Favor.`,
        }),
        anatomyIsFn: true,
        why: 'The symbol legend on the real card, with callouts in the GUTTERS (not over the art). Only what Hunting actually has: cost (a Power requirement) + granted skills. Favor shields taught truthfully in words (Hunting has none). Dropped the false "border = Act" claim.',
    },
    {
        id: 'green-glow', target: '#handZone', advance: 'next', pad: 16,
        pulse: '.hand-card.playable', pulseCls: 'tut-pulse-green',
        title: 'The Green Glow',
        text: `See Hunting breathing <span class="tut-green">green</span>? Green means
               <b>you can play it right now</b> — you meet its cost as things stand
               (Hunting needs 1 Power; your board's center slot covers it).
               <b>But heads up:</b> if the table shifts before your turn resolves — gold
               spent, a skill borrowed away — a green card can stop being playable. Green
               is "right now," not "forever."`,
        why: 'Explicit design ask: teach the green glow AND the disclaimer that affordability can change mid-round.',
    },
    {
        id: 'throw-hunting', spotlightCard: true, target: '#handZone', advance: () => game.pendingActivations[0] !== null, pad: 16,
        lockCard: () => inHand('Hunting'),
        pulse: '.hand-card.playable', pulseCls: 'tut-pulse-green',
        title: 'Throw Your First Card',
        text: `Drag <b>Hunting</b> up toward the table to commit it, face-down.`,
        why: 'First real action — the commit gesture, done by the player, not a button.',
    },
    {
        id: 'reveal-hunting', panelGated: true, ready: () => panelActive(), target: '#actionPanel',
        advance: () => !panelActive(), pulse: '#actionPanel [data-act="play"]',
        title: 'Your Reveal — Play It',
        text: `Cards reveal in table order. This panel is your whole turn: <b>Play</b> it
               (pay the top-left cost, keep the gold ovals for the rest of the game) — or
               <b>Discard</b> it for +3 Gold or a free ring slide. Hit <b>Play</b>: those
               2 Survival are yours to keep.`,
        why: 'The action panel decides every turn; Play now, Discard named for later.',
    },
    {
        id: 'rivals-reveal', mode: 'watch',
        // Advance when the reveal is done and the next turn opens — phase back to
        // 'gameplay' (stays true even once you throw, so a quick throw can't
        // starve the gate the way a pending===null check could).
        advance: () => game.phase === 'gameplay',
        title: 'The Other Heirs Reveal',
        text: `You went first as the <b>Emblem holder</b>. Now Sir Aldric's and Old Wren's
               cards flip and resolve in turn — <b>watch what they play</b>. Every card
               they lay down is skills or Power they're building, just like you. This
               reveal happens after every turn; from here I'll let it play out quietly.`,
        why: "Wyatt: explain what's happening while the other players play their cards. Taught ONCE — a watch beat that HOLDS through the rivals' spotlight reveals (advance waits for the next gameplay turn) instead of popping Turn 2's bubble over them.",
    },

    // ══════════ TURN 2 — WEAPON (Power feeds the Melee) ══════════
    {
        id: 'weapon-turn', spotlightCard: true, ready: () => gameplayIdle(), target: '#handZone', lockCard: () => inHand('Shark Tooth'),
        onReady: () => rigTurn(['Shark Tooth']),
        advance: () => game.pendingActivations[0] !== null, pad: 16,
        title: 'A Weapon — Power for the Melee',
        text: `Your hand passed and changed. This is <b>Shark Tooth</b>, a <b>Weapon</b> —
               it grants ⚔ <b>Power</b>. At the end of each Act every heir's total Power
               clashes in the <b>Melee</b>, and the strongest win Prestige. Throw Shark
               Tooth and start building your strength.`,
        why: 'Introduces the Weapon type and the Melee it feeds, one Act before that Melee lands.',
    },
    {
        id: 'weapon-play', panelGated: true, ready: () => panelActive(), target: '#actionPanel',
        advance: () => !panelActive(), pulse: '#actionPanel [data-act="play"]',
        title: 'Bank the Power',
        text: `Play it — what you build now, you carry into the Melee. Your Power is climbing.`,
        why: 'Closes the second guided play; frames Power as cumulative.',
    },

    // ══════════ SLIDER DETOUR — the board ring ══════════
    {
        // ONLY when the table is idle (rivals done revealing, waiting on you) —
        // otherwise the detour lands mid-reveal and the board keeps blacking out
        // as the reveal re-renders (Wyatt). At idle nothing moves, so opening the
        // board is a real pause; closing it resumes with the next prompt.
        // Advances on the board actually BEING OPEN, not on the tap that opens
        // it. With advance:'click' the tap fired the step forward on a timer
        // while the next step ('slider') waited on #boardOverlay — so a player
        // who opened and closed the board inside that window left the slider
        // step waiting on an overlay that had already come and gone, with no way
        // out but Skip. Gating on the state instead of the gesture can't desync:
        // if they close it early, board-tour is simply still the live step.
        id: 'board-tour', ready: () => gameplayIdle(), target: '#boardThumb',
        advance: () => overlayActive('#boardOverlay'), delay: 0, tapTarget: true,
        title: 'Visit Your Board',
        text: `Quick detour — <b>tap your board</b> to see the ring up close. The table waits
               while you look.`,
        why: 'Hands-on transition into the slider lesson. Gated on gameplayIdle so no rival reveal is running behind it (that was blacking out the board).',
    },
    {
        // No shield (dimming would black out the board) + bubble pinned LEFT so the
        // board in the middle stays visible (Wyatt: prompt covered almost the board).
        id: 'slider', overlayGated: '#boardOverlay', target: '#boardOverlay',
        advance: () => !overlayActive('#boardOverlay'), noShield: true, bubbleSide: 'left',
        title: 'The Ring & the Slider',
        text: `Five slots. Your ring can slide for <b>5 Gold a space</b> (or free, when you
               discard for a slide). Land on a slot and it pays: gold coins pay Gold, skill
               crests grant skills while you stand there, and event slots — like the
               Bandit's <b>steal from everyone</b> — fire as you arrive. Drag the ring to
               peek, then close the board (✕ or tap outside) to go on.`,
        why: 'The slider is half of every board decision — taught in the real overlay with the real ring.',
    },

    // ══════════ TURN 3 — MISSION LETTER (claim a mission) ══════════
    {
        id: 'mission-turn', spotlightCard: true, ready: () => gameplayIdle(), target: '#handZone', lockCard: () => inHand('Mission Letter'),
        onReady: () => { rigTurn(['Mission Letter']); rigMissions(); },
        advance: () => game.pendingActivations[0] !== null, pad: 16,
        title: 'The Mission Letter',
        text: `This turn you drew a <b>Mission Letter</b> — throw it. A Letter is how you
               claim one of the face-up missions for 1 Gold.`,
        why: 'Rigged so the Letter arrives exactly when the concept is fresh.',
    },
    {
        id: 'mission-panel', panelGated: true, ready: () => panelActive(), target: '#actionPanel',
        advance: () => overlayActive('#missionSelect'), delay: 0, pulse: '#actionPanel [data-act="mission_letter"]',
        title: 'Send the Letter',
        text: `Pay the 1 Gold — then you'll choose from the three face-up missions.`,
        why: 'Bridges the letter to the pick; the real teaching is on the pick screen.',
    },
    {
        id: 'mission-pick', overlayGated: '#missionSelect',
        target: () => {
            const img = document.querySelector('#missionSelect img[src*="Helping"]');
            return (img && (img.closest('.mission-option') || img.parentElement))
                || document.getElementById('missionSelect');
        },
        advance: () => !overlayActive('#missionSelect'),
        // Helping the Merchant is the leftmost mission — pin the bubble RIGHT so it
        // doesn't cover the card the player has to read (Wyatt).
        bubbleSide: 'right',
        title: 'Read a Mission — Take Helping the Merchant',
        text: `A mission reads like a card: <b>top-left = what it takes to succeed</b>
               (3 Survival & 3 Power), <b>top-right = the reward</b> (Gold, a skill, and a
               <b>Map</b> — remember that), and the <b>grey bottom = what failing costs
               you</b>. Take <b>Helping the Merchant</b> — your Hunting Survival and your
               board's Power put it in reach.`,
        why: 'Mission-card anatomy exactly when they must read one, plus modelling WHY this one is achievable. The Map pays off in Act 2.',
    },
    {
        id: 'mission-held', ready: () => gameplayIdle(), target: '.mission-strip', advance: 'next',
        title: "Yours Now — Resolves at Act's End",
        text: `The mission is yours, held face-down. Missions resolve when the Act ends:
               meet the requirement then and the reward is yours; fall short and the grey
               consequence bites. Keep building toward those 3 Survival & 3 Power.`,
        why: 'Sets the timing expectation so the missions phase is anticipated. Borrow reference removed — kept for Act 2 per Wyatt.',
    },

    // ══════════ TURN 4 — ENDEAVOR (finish the mission requirement) ══════════
    {
        id: 'build-turn', spotlightCard: true, ready: () => gameplayIdle(), target: '#handZone', lockCard: () => inHand('First Aid'),
        onReady: () => rigTurn(['First Aid']),
        advance: () => game.pendingActivations[0] !== null, pad: 16,
        title: 'Keep Building',
        text: `<b>First Aid</b> grants 1 more Survival. Play it and you'll hold
               <b>3 Survival</b> — exactly what Helping the Merchant needs. Throw it in.`,
        why: 'Lands the third Survival so the mission visibly succeeds later; reinforces skills stacking toward a goal.',
    },
    {
        id: 'build-play', panelGated: true, ready: () => panelActive(), target: '#actionPanel',
        advance: () => !panelActive(), pulse: '#actionPanel [data-act="play"]',
        title: 'Play It',
        text: `Play it — that's <b>3 Survival</b> and <b>3 Power</b> banked. Your mission is
               in reach.`,
        why: 'Confirms the requirement is met before the resolution.',
    },

    // ══════════ TURN 5 — DISCARD (the bad-hand economy; Borrow waits for Act 2) ══════════
    {
        id: 'discard-turn', spotlightCard: true, ready: () => gameplayIdle(), target: '#handZone', lockCard: () => inHand('Cooking'),
        onReady: () => rigTurn(['Cooking']),
        advance: () => game.pendingActivations[0] !== null, pad: 16,
        title: 'Not Every Card Is For You',
        text: `<b>Cooking</b> needs 1 Knowledge — you have none, so no green glow. Cards you
               can't use still have value. Throw it and we'll turn it into Gold.`,
        why: 'Teaches the no-glow (grey) state on a genuinely unplayable card, setting up the discard economy.',
    },
    {
        id: 'discard-panel', panelGated: true, ready: () => panelActive(), target: '#actionPanel',
        advance: () => !panelActive(), pulse: '#actionPanel [data-act="discard"]',
        title: 'Discard = Gold or Movement',
        text: `Can't play it? Every card is still worth something: <b>+3 Gold</b>, or a free
               <b>ring slide</b> on your board. A bad card is never a wasted turn. Take the Gold.`,
        why: "The discard economy keeps bad hands fun. Borrowing is DELIBERATELY not taught here — it never comes up in Act 1 (Wyatt); it's introduced and demonstrated in Act 2 where it's actually used.",
    },

    // ══════════ TURN 6 — THE LAST TWO ══════════
    {
        id: 'final-turn', mode: 'watch', act: 1,
        // Wait until the Act truly ENDS (missions phase begins) — NOT the moment
        // the hand empties (that fires the instant you THROW your last two, before
        // you've revealed and played them). Wyatt saw this jump away too early.
        advance: () => pastDraft(1),
        title: 'Play Out the Act',
        text: `Down to your last cards — when only two remain you play <b>both</b> at once.
               Commit them, then <b>reveal and play each one</b> as it comes up. That's the
               whole draft: play, pass, until the Act empties — then missions resolve.`,
        why: 'Every turn is prompted, but the loop is learned — a watch beat carries the final plays. Advances on phase===missions so it HOLDS through the last two reveals instead of vanishing the instant the hand empties (Wyatt).',
    },

    // ══════════ MISSIONS PHASE — hard-paced, narrated ══════════
    {
        id: 'missions-phase', phaseGated: 'missions', act: 1, mode: 'watch',
        advance: () => game.phase === 'melee' || game.currentAct !== 1,
        title: 'The Missions Phase',
        text: `The Act is over — now every heir's mission resolves, one at a time, starting
               from the Emblem holder. Nothing rushes past: <b>tap each card to reveal
               it.</b> Meet the requirement and the reward lands (yours pays Gold, a skill,
               and the <b>Map</b>); fall short and the grey consequence fires. Watch yours
               succeed.`,
        why: 'Frames the real ceremony (already tap-paced) and points out the player\'s own success — Wyatt: the phase must slow and be explained.',
    },

    // ══════════ MELEE PHASE — read the prompt, THEN it plays (unobstructed) ══════════
    {
        // The cinematic is HELD (showMeleeSplash awaits tutMeleeGate). This prompt
        // comes up over the table, you read it, hit Next → the Melee begins with no
        // tutorial overlay covering it (act1-done stays hidden until Act 2). Wyatt.
        id: 'melee-phase', phaseGated: 'melee', act: 1, advance: 'next',
        onNext: () => tutMeleeGo(), onSkip: () => tutMeleeGo(),
        title: 'THE MELEE',
        text: `The Act ends in the <b>Melee</b>: every heir's Power clashes head to head —
               weapons, board slots, everything counts (you can't borrow Power here — what
               you built is what you bring). The winners take <b>Prestige</b>: the podium
               pays <b>5 / 3 / 1</b> in Act 1… and it triples by Act 3.
               <b>Hit Next to watch it unfold.</b>`,
        why: 'Wyatt: the Melee prompt must appear FIRST, be read, and Next STARTS the cinematic (gated on tutMeleeGo). Then the tutorial hides (act1-done waits for Act 2) so nothing blocks the Melee.',
    },

    // ══════════ ACT 1 → ACT 2 — the player's fork ══════════
    {
        // Hidden (armed=false) while the Melee cinematic plays — appears only once
        // the Melee is done and Act 2 begins, so it never covers the Melee.
        id: 'act1-done', ready: () => game.currentAct >= 2, target: null,
        choices: FORK('Show me Act 2'),
        title: 'Act 1 Complete',
        text: `You've played the whole loop: read cards, built skills and Power, claimed and
               resolved a mission, and fought the Melee. <b>That's the game.</b> Acts 2 and 3
               play by the very same rules — just richer cards and bigger rewards.<br><br>
               So it's your call: <b>carry on</b> and I'll point out each new thing as it
               appears, or <b>take it from here yourself</b> — same game, same board, same
               score, just without me.`,
        why: "Wyatt: at the act break the player has the basic tools, so offer the exit. 'Finish on my own' calls release() — the tutorial tears down but THIS game continues live (TUT_ACTIVE cleared so the Melee stops waiting for taps and rivals resume claiming missions).",
    },

    // ══════════ ACT 2 — the stakes rise, and the wheel goes to the player ══════════
    {
        id: 'act2-open', target: null, advance: 'next',
        title: 'Act 2 — Richer Cards, Bigger Melee',
        text: `A fresh hand from the <b>Act 2 deck</b>: stronger cards, steeper costs. Two
               things changed. The <b>Emblem passed one seat clockwise</b>, so you no longer
               reveal first — watch where you fall in the order. And the Melee now pays
               <b>15 / 5 / 3</b> instead of 5 / 3 / 1.<br><br>
               From here <b>the turns are yours</b>. Play whatever you like — I'll only step
               in when something genuinely new shows up.`,
        why: "Sets Act 2's two real changes (Emblem rotation, richer Melee purse) and — Wyatt's ask — explicitly hands control over, so the free turns that follow read as designed rather than as the tutorial losing its grip.",
    },

    // ── The Map payoff: Act 1's mission reward pays here ──
    {
        // Helping the Merchant (Act 1) grants the map whose name IS "Helping the
        // Merchant"; Great North Connection lists it in reqMaps, so holding it
        // waives BOTH the requirement and the cost — checkRequirements returns
        // mapFree and the hand renders it .freeplay (orange).
        id: 'act2-map', spotlightCard: true, ready: () => gameplayIdle(), target: '#handZone', pad: 16,
        lockCard: () => inHand('Great North Connection'),
        onReady: () => rigTurn(['Great North Connection']),
        advance: () => game.pendingActivations[0] !== null,
        pulse: '.hand-card.freeplay',
        title: 'Your Map Pays Off',
        text: `Remember the <b>Map</b> that Helping the Merchant paid you? Here's what it
               buys. <b>Great North Connection</b> normally demands 1 Charisma & 1 Power —
               but your Map plays it <b>for free</b>: requirement waived, cost waived.<br><br>
               That's what the <span class="tut-orange">orange</span> glow means, and it's
               why missions are worth chasing: <b>green means you can afford it, orange
               means you don't have to.</b> Throw it in.`,
        why: "The whole Act 1 mission → Act 2 free play chain lands here — the single best argument for chasing missions. Teaches orange vs green as the affordable/free distinction.",
    },
    {
        id: 'act2-map-play', panelGated: true, ready: () => panelActive(), target: '#actionPanel',
        // The hand is draggable even under the shield, so honour what they
        // actually threw: if it isn't the Map card, skip rather than describe
        // rewards that aren't coming.
        skipIf: () => !pendingCards(0).some(c => c.name === 'Great North Connection'),
        advance: () => !panelActive(), pulse: '#actionPanel [data-act="play"]',
        title: 'Free, and It Keeps Giving',
        text: `Play it. Three things land at once: <b>5 Favor</b> straight to your score, a
               <b>Trade Route</b> — from now on you may borrow Survival, Charisma, Alchemy
               and Prospecting from <b>any player at the table</b>, not just the two beside
               you — and <b>another Map</b>, for an Act 3 card. Maps chain into Maps.`,
        why: 'Names all three payoffs honestly (favor 5, special trade_route, grantsMap Market Trade Exchange) and plants the borrowing widening that the very next lesson uses.',
    },

    // ── A turn that's purely theirs ──
    freeTurn({
        id: 'act2-free-1',
        title: 'Your Table Now',
        text: `Your turn — <b>play whatever you like</b>. Green cards you can afford, orange
               plays free, and anything you can't use is still <b>+3 Gold or a ring slide</b>.
               There's no wrong move here.`,
        why: "Wyatt: more player control in Acts 2 & 3. A watch step — no shield, no pulse, hand fully live — that just waits for them to take a whole turn.",
    }),

    // ── BORROWING (Wyatt: must be introduced AND demonstrated in Act 2) ──
    {
        // Rigged ADAPTIVELY, not by name: after a free turn we can't know what
        // the player built, so pick whatever card the table can actually teach
        // borrowing with right now — preferring a Potion so one stop covers both.
        id: 'act2-borrow-throw', spotlightCard: true, ready: () => gameplayIdle(), target: '#handZone', pad: 16,
        lockCard: () => (borrowLesson ? borrowLesson.card : null),
        // skipIf runs when the gate fires, so the rig happens against the state
        // the player actually arrives in — and doubles as the "is there a borrow
        // lesson to teach at all?" test. onReady would be redundant after it.
        skipIf: () => !rigBorrowLesson(),
        advance: () => game.pendingActivations[0] !== null,
        pulse: '.hand-card',
        title: () => borrowLesson && borrowLesson.card.type === 'potion'
            ? 'Your First Potion — and You Can\'t Afford It'
            : "A Card You Can't Afford",
        text: () => {
            if (!borrowLesson) return '';
            const c = borrowLesson.card;
            const need = borrowLesson.missing.map(SKILL_LABEL).join(' & ');
            const potion = c.type === 'potion'
                ? `<b>${c.name}</b> is a <b>Potion</b> — potions fire <b>once, instantly</b>,
                   the moment you play them. No lasting skills, no Power for the Melee; just
                   one sharp effect exactly when you need it. `
                : `<b>${c.name}</b> is worth having. `;
            return `${potion}But look — <b>no green glow</b>. You're short
                   <b>${need}</b>.<br><br>
                   In Act 1 that meant discarding it for Gold. Not any more:
                   <b>you can borrow what you lack</b>. Throw it in and I'll show you.`;
        },
        why: "Wyatt's explicit Act 2 requirement. The card is chosen against LIVE state by borrowPlan() — mirroring the exact conditions ui.js uses to offer the Borrow button — so the lesson survives whatever the player did on their free turn. Prefers a Potion so the potion type gets taught in the same stop.",
    },
    {
        id: 'act2-borrow-panel', panelGated: true, ready: () => panelActive(), target: '#actionPanel',
        skipIf: () => !borrowLesson || !committed(borrowLesson.card.id),
        advance: () => !panelActive(), delay: 0, pulse: '#actionPanel [data-act="borrow_play"]',
        title: 'Borrow It',
        text: () => {
            if (!borrowLesson) return '';
            const need = borrowLesson.missing.map(SKILL_LABEL).join(' & ');
            return `The top button is dead — it just tells you what's missing. Underneath it,
                   though: <b>Borrow &amp; Play</b>. Other heirs' played skills are for hire.
                   <b>${borrowLesson.fee} Gold</b> covers the ${need} you need — and that gold
                   goes <b>to the lender</b>, not the bank. Borrowing is a favour someone
                   profits from.<br><br>
                   You can borrow for cards and for missions — but <b>never for the Melee</b>,
                   and never for a Mind's Eye or a Philosopher's Stone. Hit
                   <b>Borrow &amp; Play</b>.`;
        },
        why: 'The gold-to-the-lender detail is the part players miss — it reframes borrowing as a deal, not a fee. Names the two hard limits (Melee, elite resources) right where they matter.',
    },
    {
        // The lender chooser (#promisePicker) takes the screen — no shield, and
        // the bubble pinned aside so the seats stay readable.
        // Waiting ONLY on the picker would hang forever if the player took the
        // Discard instead — so the gate also opens when the turn simply resolves,
        // and skipIf then reads which of the two happened.
        id: 'act2-borrow-pick', overlayGated: '#promisePicker',
        noShield: true, bubbleSide: 'left',
        advance: () => !overlayActive('#promisePicker'), delay: 400,
        title: 'Who Lends It?',
        text: () => `Pick your lender. ${lenderNames()} can cover it — and thanks to that
                    Trade Route you just played, the whole table is open to you for
                    Survival, Charisma, Alchemy and Prospecting, not only your neighbours.
                    Choose, and the card plays.`,
        why: 'The chooser is a genuinely new overlay, so it gets its own beat — and it pays off the Trade Route from two steps earlier. Side-pinned like the Act 1 slider/mission fixes so it never covers the seats.',
    },

    freeTurn({
        id: 'act2-free-2',
        title: 'Carry On',
        text: `Another one that's all yours. Remember you can <b>borrow</b> now whenever a
               card is just out of reach — check the second button before you settle for
               the Gold.`,
        why: 'Free turn that also nudges them to USE the thing just taught — the lesson only sticks if they reach for it unprompted.',
    }),

    // ── The elite gates: Mind's Eye & the Philosopher's Stone ──
    {
        // Watch mode: the hand stays live so they can turn the card over while
        // they read. Explain-on-sight — the design brief only makes 5 of the 7
        // types hands-on, and these two are gates, not plays.
        id: 'act2-elite', ready: () => gameplayIdle(), mode: 'watch', advance: 'next',
        onReady: () => rigTurn(["Mind's Eye"]),
        title: "The Two Treasures",
        text: `<b>Mind's Eye</b> is at the front of your hand. It and the
               <b>Philosopher's Stone</b> are the two treasures the late game is built
               around — and they are <b>not skills</b>.<br><br>
               <b>They cannot be borrowed.</b> No amount of Gold buys one off a neighbour.
               If a card asks for a Mind's Eye and you haven't got one, that card is shut
               to you. Earning one now is what opens Act 3's biggest scores.`,
        anatomy: () => AN("assets/cards/regular/Mind_s Eye Card.jpg", {
            left: ['⬅ <b>Costs</b> 1 Alchemy, 1 Prospecting, 1 Knowledge — three different skills, which is what makes it hard.'],
            right: ['<b>Grants ➡</b> 1 Alchemy, and the <b>Mind\'s Eye</b> itself — a treasure you keep, not a skill.'],
            below: `The <b>Philosopher's Stone</b> is earned the same way: 1 Knowledge, 1 Prospecting, 1 Alchemy.`,
        }),
        why: "Wyatt 7/28: explain Mind's Eye and the Philosopher's Stone directly and that they can't be borrowed — don't mention Wisdom cards at all. The type label was doing no work for the player; what matters is that these two things exist, cost three different skills, and are the one thing gold can't buy. Also trimmed, because this bubble filled a whole phone screen.",
    },
    {
        id: 'act2-artifact', ready: () => gameplayIdle(), mode: 'watch', advance: 'next',
        onReady: () => rigTurn(['Lost South Map']),
        title: 'Artifacts — Pure Favor',
        text: `And here's what those keys unlock. <b>Lost South Map</b> is an <b>Artifact</b>:
               artifacts do nothing during play — no skills, no Power — they are simply
               <b>Favor banked for the final count</b>. This one wants 1 Survival, 1 Charisma
               and <b>1 Mind's Eye</b>.<br><br>
               See how it fits together? The gate card buys the treasure, the treasure opens
               the Artifact, the Artifact pays the score. And if you also hold its northern
               twin, this one pays <b>20 Prestige</b> on top.`,
        anatomy: () => AN('assets/cards/regular/Lost South Map.jpg', {
            left: ['⬅ <b>Requires</b> 1 Survival, 1 Charisma and 1 <b>Mind\'s Eye</b> — the Mind\'s Eye is the part you cannot borrow.'],
            right: ['<b>Pays ➡</b> 5 Favor on the blue shield, straight to your final score — plus 20 Prestige if you also hold the Lost North Map.'],
            below: `Artifacts are the quietest cards in the game: nothing happens when you play them, and then they decide the crown.`,
        }),
        why: "Completes the seven card types on sight (Artifact was the last unseen) and shows the Mind's Eye gate paying off concretely rather than abstractly. Both Act 2 artifacts genuinely require a Mind's Eye, so the chain is real, not illustrative.",
    },

    // ── The rest of the act belongs to the player ──
    {
        id: 'act2-rest', ready: () => gameplayIdle(), mode: 'watch',
        advance: () => pastDraft(2),
        title: 'Play Out the Act',
        text: `The rest of Act 2 is yours — <b>every turn, your call</b>. Build toward a
               Mind's Eye, stack Power for the bigger Melee, chase a mission, or bank Gold.
               Play the act out and I'll meet you at the missions.`,
        why: 'One watch step spanning every remaining turn rather than a prompt per turn — Wyatt wants Acts 2 & 3 to hand over control, and there is nothing new left to teach this act.',
    },

    // ══════════ ACT 2 MISSIONS + MELEE ══════════
    {
        id: 'act2-missions', phaseGated: 'missions', act: 2, mode: 'watch',
        advance: () => game.phase === 'melee' || game.currentAct !== 2,
        title: 'Missions Resolve Again',
        text: `Same ceremony as Act 1 — <b>tap each card</b> to resolve it. One difference
               worth knowing: if you're short on a mission requirement, <b>you may borrow
               to complete it</b>, exactly as you did for that card. A mission you can't
               quite reach is often still worth buying your way into.`,
        why: 'Adds the one genuinely new mission-phase rule (borrowing at resolution, rulebook p.14) without re-teaching the ceremony they already watched.',
    },
    {
        id: 'act2-melee', phaseGated: 'melee', act: 2, advance: 'next',
        onNext: () => tutMeleeGo(), onSkip: () => tutMeleeGo(),
        title: 'The Melee — Triple the Purse',
        text: `Power on the table again — but the podium now pays <b>15 / 5 / 3</b>. Act 1's
               whole first prize is barely Act 2's third. And remember: <b>no borrowing
               here.</b> Whatever Power you actually built is what you bring.<br><br>
               <b>Hit Next to watch it unfold.</b>`,
        why: 'Same gate mechanism as Act 1 (showMeleeSplash awaits tutMeleeGo) — the prompt is read first, then Next starts the cinematic unobstructed. The escalating purse is the reason to invest in Power now.',
    },

    // ══════════ ACT 2 → ACT 3 — the fork again ══════════
    {
        id: 'act2-done', ready: () => game.currentAct >= 3 || game.phase === 'scoring',
        target: null, choices: FORK('One more Act'),
        title: 'Act 2 Complete',
        text: `Maps, borrowing, potions, artifacts and the two keys — <b>you've now seen every
               moving part of FAVOR</b>. Act 3 introduces no new rules at all: the cards are
               simply the biggest in the game, and the Melee pays <b>30 / 15 / 5</b>.<br><br>
               Stay with me and I'll walk you to the final score, or take the last Act
               yourself.`,
        why: "Second fork, same contract as the first. Honest framing: Act 3 really does add no new mechanics (verified against data — act 3 cards are the same seven types at higher requirements), so 'you've seen everything' is true and the exit is a fair offer rather than a bail-out.",
    },

    // ══════════ ACT 3 — no new rules, so almost no interruptions ══════════
    {
        id: 'act3-open', ready: () => game.currentAct >= 3, target: null, advance: 'next',
        title: 'Act 3 — The Last Word',
        text: `Final Act. Everything on the table now is the top end of the deck: the
               Adventures that pay in double figures, the Artifacts, the cards your Maps
               and your Mind's Eye were always for. Spend it all — <b>nothing you're
               holding at the end is worth anything.</b><br><br>
               There are <b>no new rules left</b> — but there are three things this Act does
               that no other Act can, and I'll stop for each.`,
        why: 'Sets the one strategic truth that changes in Act 3 (hoarding is now pure loss) and promises exactly three stops, so the free turns between them read as intentional.',
    },

    // ── The Map chain completes: Act 1's mission is still paying ──
    {
        // Great North Connection (played in Act 2) grants the "Great North
        // Connection" map, which is exactly Market Trade Exchange's reqMaps —
        // so the chain that began with an Act 1 mission pays a THIRD time.
        // Rigged adaptively: by Act 3 the player may hold several maps, so ask
        // the engine which card is genuinely free rather than naming one.
        id: 'act3-map', spotlightCard: true, ready: () => gameplayIdle(), target: '#handZone', pad: 16,
        skipIf: () => !rigMapFree(),
        lockCard: () => mapLesson,
        advance: () => game.pendingActivations[0] !== null,
        pulse: '.hand-card.freeplay',
        title: 'The Chain Pays a Third Time',
        text: () => {
            if (!mapLesson) return '';
            const via = unlockingMap(mapLesson);
            const chain = via === 'Great North Connection'
                ? `A mission you claimed in <b>Act 1</b> paid a Map. That Map played
                   <b>Great North Connection</b> free in Act 2 — and Great North Connection
                   paid <b>another</b> Map, which is why `
                : `Your <b>${via}</b> Map is why `;
            return `${chain}<b>${mapLesson.name}</b> is glowing
                   <span class="tut-orange">orange</span> right now.<br><br>
                   It would normally cost you real skills and real Gold. It costs you
                   <b>nothing</b>. That is the whole argument for chasing missions: one
                   mission in Act 1 has now paid you three times, and the last payment is
                   the biggest. Throw it in.`;
        },
        why: "The Act 1 → Act 2 → Act 3 map chain closing is the most satisfying thing in the data, and nothing else in the game demonstrates compounding this clearly. Adaptive so it still works if the player holds a different map instead.",
    },
    {
        id: 'act3-map-play', panelGated: true, ready: () => panelActive(), target: '#actionPanel',
        skipIf: () => !mapLesson || !committed(mapLesson.id),
        advance: () => !panelActive(), pulse: '#actionPanel [data-act="play"]',
        title: 'Free, and Large',
        text: () => mapLesson && mapLesson.name === 'Market Trade Exchange'
            ? `Play it: <b>6 Charisma</b> and <b>10 Gold</b>, for nothing. And a second
               <b>Trade Route</b> — the whole table's Survival, Charisma, Alchemy and
               Prospecting stay open to you for the rest of the game. Skills this late are
               still worth having: half of Act 3's biggest cards are scored <i>off</i> them.`
            : `Play it — requirement and cost both waived. Maps don't just save you Gold,
               they let you field cards you could never otherwise afford.`,
        why: 'States the concrete payout (6 Charisma + 10 Gold + trade_route, all free) and connects late skills to the formula artifacts taught two steps later, so the beats reinforce instead of standing alone.',
    },

    freeTurn({
        id: 'act3-free-1',
        title: 'Your Turn',
        text: `All yours. Everything in this deck is expensive and worth it — and there's
               no Act 4 to save Gold for.`,
        why: 'Breathing room between Act 3 stops, with the one strategic nudge that matters now (stop hoarding).',
    }),

    // ── STOP 2: artifacts stop paying flat numbers and start paying formulas ──
    {
        // Watch mode: the hand stays live so they can read the card and, if they
        // can afford it, play it on the free turn that follows. Explain-on-sight
        // per the design brief — Artifacts are a "watch" type, not a hands-on one.
        id: 'act3-formula', ready: () => gameplayIdle(), mode: 'watch', advance: 'next',
        skipIf: () => !rigFormulaArtifact(),
        title: 'Artifacts That Count Your Whole Game',
        text: () => {
            if (!artifactLesson) return '';
            const what = FORMULA_TEXT[artifactLesson.special];
            return `<b>${artifactLesson.name}</b> is an Artifact — but not like Act 2's.
                   Those paid a flat number on the shield. <b>This one pays a formula:
                   ${what}</b>.<br><br>
                   That changes what your last turns are for. Every Survival you banked in
                   Act 1, every mission you completed, every Potion you spent — none of it
                   was only for the moment. Act 3's artifacts go back and <b>count it all
                   again</b>. The quiet game you've been playing is about to be scored
                   twice.`;
        },
        anatomy: () => artifactLesson
            ? AN(`assets/cards/regular/${artifactLesson.filename}`, {
                left: ['⬅ <b>What it asks</b> — check the top-left. Act 3 asks for more, because Act 3 pays more.'],
                right: [`<b>What it pays ➡</b> not a fixed number — ${FORMULA_TEXT[artifactLesson.special]}.`],
                below: `Look for these before you spend your last turns: a formula artifact can be worth more than every card you played to get it.`,
            })
            : '',
        why: "The genuinely new Act 3 idea and the one most likely to be missed — formula scoring retroactively rewards the whole game. FORMULA_TEXT phrasings were checked one by one against each card's audit line.",
    },

    // ── STOP 3: the Chemicals — the only cards that reach across the table ──
    {
        id: 'act3-chemicals', ready: () => gameplayIdle(), mode: 'watch', advance: 'next',
        skipIf: () => !rigChemical(),
        title: 'The Chemicals',
        text: () => {
            if (!chemLesson) return '';
            return `<b>${chemLesson.name}</b> — one of the three <b>Chemicals</b>, and the
                   only cards in FAVOR that reach across the table.<br><br>
                   <b>Chemical X</b> moves your ring to <b>any slot you like</b>, free,
                   ignoring the 5-Gold-a-space rule entirely. <b>Chemical Y</b> takes one
                   Adventure you've played and <b>doubles its Favor</b>. And <b>Chemical
                   Z</b> hands <b>15 Scorn to every other heir</b> — the single most
                   destructive card in the game, though it costs you 5 Scorn of your own.
                   <br><br>
                   They are gated on <b>Alchemy</b>: X asks only 2, but Y wants six
                   <i>and</i> a Philosopher's Stone, and Z wants five Alchemy and five
                   Prospecting. Deep Alchemy is what buys you a seat at this table.`;
        },
        why: "Verified against the data: X = move_slider_any (req 2 Alchemy), Y = double_adventure_favor (6 Alchemy + Stone), Z = others_15_scorn (5 Alchemy + 5 Prospecting). Pays off the Act 2 Mind's Eye/Stone lesson by showing what the keys actually unlock.",
    },

    {
        id: 'act3-play', ready: () => gameplayIdle(), mode: 'watch',
        advance: () => pastDraft(3),
        title: 'The Last Act Is Yours',
        text: `That's everything FAVOR has. Play the Act out — cash your Maps, borrow what
               you're short, chase a last mission, and pile on Power: this Melee is worth
               more than the other two together. <b>Spend it all.</b>`,
        why: 'One watch step across the rest of the Act 3 draft. Nothing new left to teach, and by now the player should be driving.',
    },
    {
        id: 'act3-missions', phaseGated: 'missions', act: 3, mode: 'watch',
        advance: () => game.phase === 'melee' || game.phase === 'scoring',
        title: 'The Final Missions',
        text: `Last chance on every mission you're holding — <b>tap each to resolve it</b>.
               Borrow now if it closes a requirement; there is no later to save the gold for.`,
        why: "Reinforces borrow-at-resolution at the only moment it's unambiguously correct — the last act, where saved gold is worth nothing but a tiebreak.",
    },
    {
        id: 'act3-melee', phaseGated: 'melee', act: 3, advance: 'next',
        onNext: () => tutMeleeGo(), onSkip: () => tutMeleeGo(),
        title: 'The Last Melee — 30 / 15 / 5',
        text: `Everything you built comes to the field one final time, and the podium pays
               <b>30 / 15 / 5</b>. This single clash is worth more Prestige than Acts 1 and
               2 combined — which is why Power is never a wasted play.<br><br>
               <b>Hit Next.</b>`,
        why: 'Same gate as the earlier Melees. The 30/15/5 purse retroactively justifies every Weapon they played, which is the note to end the play on.',
    },
    {
        // The score sheet takes the whole screen — corner bubble, nothing dimmed.
        id: 'final-scoring', ready: () => overlayActive('#scoring-screen'),
        mode: 'watch',
        // NOT the blanket finale — that would dim the very sheet this step is
        // asking them to read. Both buttons end the tutorial cleanly instead.
        choices: [
            { label: 'Let me read it', onPick: release, stop: true },
            { label: 'Play the real thing', primary: true, stop: true,
              onPick: () => { release(); location.assign('index.html'); } },
        ],
        title: 'How the Crown Is Won',
        text: `Here is the whole game in six lines. <b>Missions</b>, <b>Adventures</b>,
               <b>Artifacts</b> and your <b>Character</b> board add up to your Favor.
               <b>Prestige</b> — everything the Melees paid — adds on top. <b>Scorn</b>
               comes straight back off.<br><br>
               <b>Favor + Prestige − Scorn</b> is your score, and the richer heir takes any
               tie. Every row opens if you tap it: that's where each point came from.`,
        why: 'Matches the real sheet exactly (SHEET_ROWS = Missions/Adventures/Artifacts/Character/Prestige/Scorn; finalScore = totalFavor + prestige − scorn; gold breaks ties) and points out the drill-down rows, which players otherwise never discover.',
    },
    ];

    // Anatomy steps declare a function — resolve at show time.
    STEPS.forEach(s => {
        if (typeof s.anatomy === 'function') {
            const fn = s.anatomy;
            s._hasAnatomy = true;
            Object.defineProperty(s, 'anatomy', { get: fn });
        } else if (s.anatomy) {
            s._hasAnatomy = true;
        }
    });

    // Every step that narrates the action panel shares one hazard, so it is
    // closed in one place rather than seven. showStep runs a beat AFTER the
    // throw that opens the panel, and its gate then polls at 250ms — so a
    // player who taps Play the instant the panel appears can answer it before
    // the prompt ever lands. `ready: panelActive()` would then wait forever on
    // a panel that has already gone, with no way out but Skip.
    //
    // Widening the gate to "panel is up OR the turn has moved on" makes that
    // impossible: the fallback cannot fire early (right after a throw
    // pendingActivations[0] is set, so gameplayIdle() is false), and when it
    // does fire, skipIf drops the step instead of narrating a panel that isn't
    // there. Same shape as the board-tour fix — gate on state, never on a
    // gesture that may already have happened.
    //
    // `overlayGated: '<selector>'` is the same guarantee for the steps that
    // narrate a chooser (the board, the mission picker, the lender picker):
    // those can likewise be answered inside the beat between the overlay
    // opening and the prompt arriving.
    STEPS.forEach(s => {
        const sel = s.panelGated ? null : s.overlayGated;
        if (!s.panelGated && !sel) return;
        const isUp = sel ? () => overlayActive(sel) : panelActive;
        const origSkip = s.skipIf;
        s.ready = () => isUp() || gameplayIdle() || game.phase === 'missions';
        s.skipIf = () => !isUp() || (origSkip ? origSkip() : false);
    });

    // `phaseGated: 'missions'|'melee'` + `act: N` — the same guarantee for the
    // end-of-act beats. An act in which the player claimed no mission resolves
    // its missions phase in a single tick, so `ready: phase === 'missions'`
    // could be looking at 'melee' by its first poll and then wait forever for a
    // phase that had already been and gone. Arming on "that phase, or anything
    // after it" makes the gate unmissable; skipIf drops the narration when the
    // beat it describes never really happened.
    const PHASE_RANK = { gameplay: 0, activate: 0, missions: 1, melee: 2, scoring: 3 };
    STEPS.forEach(s => {
        if (!s.phaseGated) return;
        const want = s.phaseGated, act = s.act;
        const origSkip = s.skipIf;
        s.ready = () => game.currentAct > act
            || (PHASE_RANK[game.phase] || 0) >= PHASE_RANK[want];
        s.skipIf = () => game.phase !== want || (origSkip ? origSkip() : false);
    });

    // ── Boot ─────────────────────────────────────────────────────────
    function start() {
        const title = document.getElementById('title-screen');
        if (title) { title.classList.add('hidden'); title.style.display = 'none'; }
        window._mpSkipQueue = true;

        game = new FavorGame(3);
        // FULL DETERMINISM (Wyatt): seed the engine's RNG BEFORE loadDecks so the
        // deck shuffle — and therefore every hand, every rival's cards, and the
        // mission pool — is IDENTICAL on every playthrough. (The AI is already
        // deterministic; the shuffle was the only source of variation. The rigged
        // lesson cards + pinned mission sit on top of this fixed deal.)
        game.setSeed(0x20260724);
        game.loadDecks();
        game.initPlayers(CAST);
        game.emblemHolder = 0;
        game.startAct(1);
        game.phase = 'gameplay';   // arm the throw phase (beginThrowPhase early-returns otherwise)
        rigMissions();
        addLogEntry('═══ How to Play — a guided game ═══');
        showGameScreen();
        renderGameState();

        buildDom();
        installThrowGuard();   // lesson-card lock (see lockCardTo)
        active = true;
        // The tutorial owns pacing — this flag tells showMeleeSplash to WAIT
        // for a tap instead of auto-closing, so the Melee can be narrated.
        window.TUT_ACTIVE = true;
        // The Melee waits for the player to read its prompt and hit Next.
        window.__tutMeleeGate = tutMeleeGate;
        // Silence the in-game coach-marks (Prong 2) — they'd fire a SECOND
        // tutorial overlay on top of this one. coachTick early-returns on this.
        window._coachOff = true;
        tick = setInterval(() => { layout(); reassertMarks(); }, 300);
        showStep(0);
        // Arm turn 1 exactly like a real act start: rivals think, then commit;
        // the player drags to throw when the script reaches the throw step.
        beginThrowPhase();
    }

    // goto('step-id') — review/debug seam: jump the guide to any step.
    // Game state does NOT rewind; use it to proof-read prompts in place.
    // `force` shows the step immediately, ignoring its ready gate and skipIf —
    // the only way to lay every prompt out for a placement audit without
    // playing a whole game to reach each one.
    function goto(id, force) {
        const i = STEPS.findIndex(x => x.id === id);
        if (i < 0) return -1;
        if (!force) { showStep(i); return i; }
        const s = STEPS[i];
        const savedReady = s.ready, savedSkip = s.skipIf;
        s.ready = null; s.skipIf = null;
        // onReady is where a step rigs its lesson card into the hand, and it
        // normally fires from the ready gate we just removed — so run it here or
        // the step lays out pointing at a card that was never dealt.
        try {
            if (s.onReady) { try { s.onReady(); } catch (e) { /* preview only */ } }
            showStep(i);
        } finally { s.ready = savedReady; s.skipIf = savedSkip; }
        return i;
    }
    // cur() — which step is on screen, and is it actually showing yet (a
    // ready-gated step sits armed=false and invisible while it waits). The test
    // harness needs both: it must not act on a step that hasn't armed.
    const cur = () => {
        const s = STEPS[stepIdx];
        return s ? {
            id: s.id, i: stepIdx, armed, mode: s.mode || 'shield',
            // This step advances by tapping its spotlit element and nothing else
            // — no Next, and not always a pulse. Surfaced so a harness can drive
            // it the way a player does. (`tapTarget` covers the steps that wait
            // on what the tap OPENS rather than on the tap itself.)
            needsClick: s.advance === 'click' || !!s.tapTarget,
            target: typeof s.target === 'string' ? s.target : null,
            // What the spotlight actually resolved to, for placement audits —
            // the selector alone lies when coachEl swaps in a table-view twin.
            resolved: (() => {
                let el = null;
                try { el = targetEl(s); } catch (e) { }
                if (!el) return null;
                const b = el.getBoundingClientRect();
                return { desc: el.id || el.className || el.tagName,
                         rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] };
            })(),
        } : null;
    };
    window.TUT = { start, steps: STEPS, goto, cur, release };

    // Auto-start on the standalone howto page.
    if (/[?&]tutorial=1/.test(location.search) || window.TUTORIAL_AUTOSTART) {
        window.addEventListener('load', () => setTimeout(start, 400));
    }
})();
