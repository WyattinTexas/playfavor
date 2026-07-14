/**
 * FAVOR — Achievements (FACH)
 *
 * Same shape as Nation's: each achievement carries a Stars reward and the tier
 * falls out of that number. Stars are the character-store currency, so earning
 * these is how you buy the rest of the roster.
 *
 * Persistence rides on the row meta.js already owns — `players/{uid}` — so a
 * grant lands in ONE whole-row transaction alongside the Stars it pays. Nothing
 * here writes a second node (see the atomic-write rule: a split write can drop
 * a leg on tab close and hand out an achievement with no Stars, or vice versa).
 *
 *   players/{uid}/achievements/{id} = <timestamp granted>
 *   players/{uid}/charWins/{characterId} = true
 *   players/{uid}/stars                  += the reward
 *
 * Two entry points, both idempotent — an already-granted id is never re-paid:
 *   sync(gameSnap)  after a finished game (feats + hero victories + The Master)
 *   sync()          on boot, after the daily board settles (podium / crowns)
 */
(function () {
    'use strict';

    const DEFS = () => (window.FAVOR_DATA && window.FAVOR_DATA.achievements) || [];
    const tier = (stars) => window.FAVOR_DATA.achievementTier(stars);

    const TIER_LABEL = {
        bronze: 'Bronze', silver: 'Silver', gold: 'Gold',
        platinum: 'Platinum', legendary: 'Legendary',
    };

    // ── Evaluation (PURE) ────────────────────────────────────────────
    // `row` is the persisted player record; `gameSnap` is this game's seat (or
    // null on a boot-time sync, where only the lifetime stats can advance).
    function evaluate(row, gameSnap) {
        const r = row || {};
        const have = r.achievements || {};
        const champs = r.champs || {};

        // A win is recorded against the hero BEFORE we test The Master, so the
        // tenth victory and The Master can land in the same breath.
        const charWins = { ...(r.charWins || {}) };
        if (gameSnap && gameSnap.won && gameSnap.characterId) {
            charWins[gameSnap.characterId] = true;
        }

        const snap = {
            won: false, characterId: null, peakPower: 0, peakGold: 0,
            potionsPlayed: 0, foretoldDoom: false,
            ...(gameSnap || {}),
            charWins,
            dailyCrowns: champs.gold || 0,
            dailyPodiums: (champs.gold || 0) + (champs.silver || 0) + (champs.bronze || 0),
        };

        const earned = DEFS().filter(d => !have[d.id] && safeCheck(d, snap));
        const stars = earned.reduce((n, d) => n + (d.stars || 0), 0);
        return { earned, stars, charWins };
    }

    // A thrown check must never take the game-over screen down with it.
    function safeCheck(def, snap) {
        try { return !!def.check(snap); }
        catch (e) { console.warn('[FACH] check failed:', def.id, e.message); return false; }
    }

    // ── Grant ────────────────────────────────────────────────────────
    async function sync(gameSnap) {
        if (!window.FLB || !window.FLB.uid) return [];
        try {
            const row = await window.FLB.readRow();
            const { earned, stars, charWins } = evaluate(row, gameSnap);
            if (!earned.length) return [];

            const now = Date.now();
            const ids = earned.map(d => d.id);

            // ONE whole-row transaction: the achievements, the Stars they pay,
            // and the hero-win record land together or retry together.
            await window.FLB.mergeRow(cur => {
                const c = cur || {};
                const ach = { ...(c.achievements || {}) };
                let paid = 0;
                for (const d of earned) {
                    if (ach[d.id]) continue;          // re-run of a committed txn
                    ach[d.id] = now;
                    paid += d.stars || 0;
                }
                return {
                    ...c,
                    achievements: ach,
                    charWins: { ...(c.charWins || {}), ...charWins },
                    stars: (c.stars || 0) + paid,
                };
            });

            await celebrate(earned);
            return ids;
        } catch (e) {
            console.warn('[FACH] sync failed:', e.message);
            return [];
        }
    }

    /** Build the seat snapshot the checks read. Call with the finished game. */
    function seatSnapshot(game, placedFirst) {
        const p = game && game.players && game.players[0];
        if (!p) return null;
        return {
            won: !!placedFirst,
            characterId: (p.character && p.character.id) || null,
            peakPower: p.peakPower || 0,
            peakGold: p.peakGold || 0,
            potionsPlayed: p.potionsPlayed || 0,
            foretoldDoom: !!p.foretoldDoom,
        };
    }

    // ── Celebration ──────────────────────────────────────────────────
    // Sequential: two at once would stack overlays and the second would be
    // dismissed by the click that closes the first.
    async function celebrate(defs) {
        for (const d of defs) await showOne(d);
    }

    function showOne(def) {
        return new Promise((resolve) => {
            const t = tier(def.stars);
            const ov = document.createElement('div');
            ov.className = 'ach-pop';
            ov.innerHTML = `
                <div class="ach-card ach-${t}" role="dialog" aria-label="Achievement unlocked">
                    <div class="ach-tier">${TIER_LABEL[t]}</div>
                    <div class="ach-seal"><span>★</span></div>
                    <div class="ach-kicker">Achievement Unlocked</div>
                    <h2 class="ach-name"></h2>
                    <p class="ach-desc"></p>
                    <div class="ach-stars">+${def.stars} ★</div>
                    <button class="btn-royal primary ach-ok"><span>Claim</span></button>
                </div>`;
            // Names/descriptions are data, not markup — set as text.
            ov.querySelector('.ach-name').textContent = def.name;
            ov.querySelector('.ach-desc').textContent = def.desc;
            document.body.appendChild(ov);
            requestAnimationFrame(() => ov.classList.add('in'));

            const done = () => {
                ov.classList.remove('in');
                setTimeout(() => { ov.remove(); resolve(); }, 260);
            };
            ov.querySelector('.ach-ok').onclick = done;
            ov.onclick = (e) => { if (e.target === ov) done(); };
        });
    }

    // ── Gallery ──────────────────────────────────────────────────────
    async function openGallery() {
        const ov = document.getElementById('achGallery');
        if (!ov) return;
        let row = {};
        try { row = (await window.FLB.readRow()) || {}; } catch (e) { /* offline: show all locked */ }
        const have = row.achievements || {};
        const defs = DEFS();
        const got = defs.filter(d => have[d.id]).length;
        const total = defs.length;
        const starsEarned = defs.filter(d => have[d.id]).reduce((n, d) => n + d.stars, 0);

        const cell = (d) => {
            const unlocked = !!have[d.id];
            // A secret stays secret until it fires — the name IS the reward.
            const hidden = d.secret && !unlocked;
            const t = tier(d.stars);
            const name = hidden ? '???' : d.name;
            const desc = hidden ? 'A secret, still unfound.' : d.desc;
            return `
                <div class="ach-cell ach-${t} ${unlocked ? 'got' : 'locked'} ${hidden ? 'secret' : ''}">
                    <div class="ach-cell-seal">${unlocked ? '★' : (hidden ? '?' : '✦')}</div>
                    <div class="ach-cell-body">
                        <b></b>
                        <span></span>
                    </div>
                    <div class="ach-cell-stars">${d.stars}★</div>
                </div>`;
        };

        ov.innerHTML = `
            <div class="ach-inner">
                <div class="ach-head">
                    <div class="ach-title">Achievements</div>
                    <div class="ach-sub">${got} of ${total} · ${starsEarned}★ earned</div>
                    <button class="ach-x" aria-label="Close">✕</button>
                </div>
                <div class="ach-grid">${defs.map(cell).join('')}</div>
            </div>`;

        // Fill text nodes (never interpolate data into markup).
        const cells = ov.querySelectorAll('.ach-cell');
        defs.forEach((d, i) => {
            const unlocked = !!have[d.id];
            const hidden = d.secret && !unlocked;
            const body = cells[i].querySelector('.ach-cell-body');
            body.querySelector('b').textContent = hidden ? '???' : d.name;
            body.querySelector('span').textContent = hidden ? 'A secret, still unfound.' : d.desc;
        });

        ov.querySelector('.ach-x').onclick = closeGallery;
        ov.onclick = (e) => { if (e.target === ov) closeGallery(); };
        ov.classList.add('open');
    }

    function closeGallery() {
        const ov = document.getElementById('achGallery');
        if (ov) ov.classList.remove('open');
    }

    window.FACH = { sync, seatSnapshot, evaluate, tier, openGallery, closeGallery, defs: DEFS };
})();
