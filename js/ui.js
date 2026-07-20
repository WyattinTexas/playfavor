/**
 * FAVOR — UI Controller
 * Manages screens, rendering, player interaction
 * Includes cinematic card spotlight system
 */

let game = null;
let selectedCharacter = null;
let musicPlaying = false;

// ─── CINEMATIC SPEED MULTIPLIER ──────────────────────────
// 1.0 = normal, 0.5 = fast, 2.0 = slow drama
window.CINEMATIC_SPEED = 1.0;

function setCinematicSpeed(mult) {
    window.CINEMATIC_SPEED = mult;
    document.documentElement.style.setProperty('--cinematic-speed', mult);
}
setCinematicSpeed(1.0);

// ─── SPECIAL ABILITY DESCRIPTIONS ────────────────────────

const SPECIAL_DESCRIPTIONS = {
    "or_choice":                     "Choose one skill from the options granted.",
    "charisma_or_prospecting":       "Counts as Charisma or Prospecting — whichever a requirement needs.",
    "alchemy_or_prospecting":        "Counts as Alchemy or Prospecting — whichever a requirement needs.",
    "minds_eye":                     "+1 Knowledge (Mind's Eye).",
    "philosopher_stone":             "Converts Gold to Favor at game end!",
    "map_lost_north":                "Reveals a hidden path to the North.",
    "power_x2":                      "Doubles your Power for Melee!",
    "move_slider_any":               "Move your slider to any position!",
    "double_adventure_favor":        "Choose one of your Adventures — its Favor doubles!",
    "minus_3_power_all_others":      "All opponents lose 3 Power!",
    "scorn_to_prestige":             "Converts all Scorn into Prestige!",
    "map_finding_lost_corridor":     "Unlocks the Finding the Lost Corridor adventure.",
    "The Shadow Guide":              "Summons the Shadow Guide to lead the way.",
    "gold_to_prestige":              "Converts Gold into Prestige!",
    "others_5_scorn":                "All opponents gain 5 Scorn!",
    "multiply_gold_x2":              "Doubles your Gold!",
    "coin_flip_4_power":             "Flip a coin: win = +4 Power!",
    "remove_mission_requirements":   "Choose an active Mission — it no longer has any Requirement!",
    "remove_13_scorn":               "Removes up to 13 Scorn!",
    "trade_route":                   "Opens a trade route for lasting profit.",
    "discard_opponent_weapon":       "Destroys one weapon from each opponent!",
    "sacred_chest":                  "Hands you the map to the Sacred Chest — play it for free.",
    "knowledge_x5":                  "Gain 5 Knowledge!",
    "favor_per_knowledge_x2":        "Favor equal to your Knowledge x2!",
    "favor_per_potion_x5":            "5 Favor for each Potion you have!",
    "map":                           "A fragment of the ancient map.",
    "king_of_the_sky":               "King of the Sky -- dominates Melee!",
    "defend_the_throne":             "Defends the throne from all challengers!",
    "gold_2_per_alchemy_triangle":   "2 Gold for each Alchemy you and both neighbors have.",
    "gold_2_per_power_neighbors":    "2 Gold for each Power your two neighbors have.",
    "favor_per_survival_x2":         "Scores 2 Favor for each Survival you have.",
    "favor_per_quest_x5":            "Scores 5 Favor per completed mission.",
    "favor_per_sur_cha_pro":         "Scores 1 Favor per Survival, Charisma & Prospecting.",
    "favor_per_artifact_x8":         "Scores 8 Favor for each Artifact you have.",
    "favor_per_neighbor_power":      "Scores 1 Favor for each Power your neighbors have.",
    "power_6_if_blind_faith":        "+6 Power in Melee while you own Blind Faith.",
    // ── Side B board slots (docs/FAVOR-XP-SIDEB-SPEC.md) ──
    "minds_eye_x5":                  "+5 Knowledge (5 Mind's Eyes).",
    "minds_eye_x8":                  "+8 Knowledge (8 Mind's Eyes).",
    "adventure_card_5_prestige":     "Playing an Adventure card earns +5 Prestige.",
    "weapon_card_3_gold":            "Playing a Weapon card earns +3 Gold.",
    "free_potion_per_round":         "Play 1 Potion card per round ignoring its cost.",
    "alchemy_adds_to_power":         "Your Alchemy amount adds to your Power.",
};

// ─── ANIMATION QUEUE ─────────────────────────────────────

class AnimationQueue {
    constructor() {
        this.queue = [];
        this.running = false;
    }

    add(fn) {
        this.queue.push(fn);
        if (!this.running) this.run();
    }

    async run() {
        if (this.running) return;
        this.running = true;
        while (this.queue.length > 0) {
            const fn = this.queue.shift();
            try {
                await fn();
            } catch (e) {
                console.warn('[AnimationQueue] Animation error:', e);
            }
        }
        this.running = false;
    }

    clear() {
        this.queue = [];
    }

    get pending() {
        return this.queue.length;
    }
}

const animationQueue = new AnimationQueue();

// ─── CARD SPOTLIGHT SYSTEM ───────────────────────────────

// Printed card contents -> payout chips in the mission-ceremony language
// (mc-chip): skills aggregated ("Survival, Survival" -> +2 Survival),
// either/or specials wear both faces, costs read as bad chips. Chips say
// only what the card says -- sentence-length specials keep their line.
const SPOTLIGHT_FLEX = {
    charisma_or_prospecting: ['charisma', 'prospecting'],
    alchemy_or_prospecting:  ['alchemy', 'prospecting'],
    alchemy_or_survival:     ['alchemy', 'survival'],
};

function spotlightChips(card, action) {
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const icon = k => `assets/icons/${k}.png`;
    const chip = (img, label, cls = 'good') =>
        `<span class="mc-chip ${cls}"><img src="${img}" alt="">${label}</span>`;

    if (action === 'discard') return [chip(icon('gold'), '+3 Gold')];
    if (action === 'discard_slide') return [chip('assets/ui/slider-ring.png', 'Slides the Ring')];

    if (card.type === 'mission_letter') {
        return [chip(icon('gold'), '−1 Gold', 'bad'),
                chip(icon('mission'), 'Chooses a Mission')];
    }

    const chips = [];
    const counts = {};
    (card.skills || []).forEach(s => { counts[s] = (counts[s] || 0) + 1; });
    Object.entries(counts).forEach(([s, n]) => chips.push(chip(icon(s), `+${n} ${cap(s)}`)));

    if (SPOTLIGHT_FLEX[card.special]) {
        const [a, b] = SPOTLIGHT_FLEX[card.special];
        chips.push(`<span class="mc-chip good"><img src="${icon(a)}" alt=""><img src="${icon(b)}" alt="">${cap(a)} or ${cap(b)}</span>`);
    }

    const favor = (card.favor || 0) + ((card.rewards && card.rewards.favor) || 0);
    if (favor) chips.push(chip(icon('favor'), `+${favor} Favor`));
    if (card.rewards && card.rewards.gold) chips.push(chip(icon('gold'), `+${card.rewards.gold} Gold`));
    if (card.rewards && card.rewards.prestige) chips.push(chip(icon('prestige'), `+${card.rewards.prestige} Prestige`));
    if (card.rewards && card.rewards.scorn) chips.push(chip(icon('scorn'), `+${card.rewards.scorn} Scorn`, 'bad'));
    if (card.cost) chips.push(chip(icon('gold'), `−${card.cost} Gold`, 'bad'));
    return chips;
}

function buildSpotlightContent(playerIndex, card, action) {
    const isDiscard = (action === 'discard' || action === 'discard_slide');
    const player = game.players[playerIndex];
    const char = player.character;
    const avatarSrc = char ? `assets/characters/${char.filename}` : '';
    const charName = char ? char.name : '';
    const safeCardName = card.name.replace(/'/g, '&#39;').replace(/"/g, '&quot;');

    // One story, four beats: who plays -> the card lands BIG (flip +
    // shimmer) -> its name -> what it does, as ceremony chips. No slot
    // track, no purse pills, no prior-play thumbnails -- the rival rail
    // and inspect overlay carry standing info; this moment is the play.
    const chips = spotlightChips(card, action).join('');
    const special = (!isDiscard && card.special && SPECIAL_DESCRIPTIONS[card.special] && !SPOTLIGHT_FLEX[card.special])
        ? `<div class="spl-special">${SPECIAL_DESCRIPTIONS[card.special]}</div>` : '';

    let html = `<div class="spotlight-backdrop"></div>`;
    html += `<div class="spl-inner">`;
    html += `<div class="spl-head">
        <img class="spl-avatar" src="${avatarSrc}" alt="${charName}">
        <div class="spl-head-text">
            <div class="spl-title">${player.name} <span class="spl-verb">${isDiscard ? 'discards…' : 'plays…'}</span></div>
            <div class="spl-char">${charName}</div>
        </div>
    </div>`;
    html += `<div class="spl-stage">
        <div class="spl-glow"></div>
        <div class="spotlight-card"><img src="assets/cards/regular/${card.filename}" alt="${safeCardName}" onerror="this.style.display='none'"></div>
    </div>`;
    html += `<div class="spl-payoff">
        <div class="spotlight-name">${card.name}</div>
        ${chips ? `<div class="spl-chips">${chips}</div>` : ''}
        ${special}
    </div>`;
    html += `</div>`;
    html += `<div class="spotlight-dismiss">tap to continue</div>`;

    return { html, isDiscard };
}

/**
 * Full cinematic spotlight — used for AI plays.
 * Shows opponent's full board context with the new card highlighted.
 */
function showCardSpotlight(playerIndex, card, action) {
    const speed = window.CINEMATIC_SPEED;
    const autoDismissMs = 2500 * speed;

    return new Promise((resolve) => {
        const el = document.getElementById('cardSpotlight');
        const { html, isDiscard } = buildSpotlightContent(playerIndex, card, action);

        el.innerHTML = html;
        el.className = 'card-spotlight active' + (isDiscard ? ' discard-variant' : '');

        // Force reflow then make visible
        void el.offsetWidth;
        el.classList.add('visible');

        let resolved = false;
        function dismiss() {
            if (resolved) return;
            resolved = true;

            el.classList.add('exiting');

            setTimeout(() => {
                el.className = 'card-spotlight';
                el.innerHTML = '';
                resolve();
            }, 300 * speed);
        }

        // Click to dismiss early
        el.onclick = dismiss;

        // Auto-dismiss timer
        setTimeout(dismiss, autoDismissMs);
    });
}

/**
 * Quick mini-reveal for YOUR plays — slide-in banner at bottom.
 * You already know what you picked, so no need for a full-screen takeover.
 */
function showMiniSpotlight(card, action) {
    const speed = window.CINEMATIC_SPEED;
    const isDiscard = (action === 'discard' || action === 'discard_slide');
    const typeName = (card.type || 'card').replace(/_/g, ' ');

    let effectText = '';
    if (isDiscard) {
        effectText = action === 'discard_slide' ? 'Slider move' : '+3 Gold';
    } else if (card.special && SPECIAL_DESCRIPTIONS[card.special]) {
        effectText = SPECIAL_DESCRIPTIONS[card.special];
    } else if (card.rewards) {
        const parts = [];
        if (card.rewards.gold) parts.push(`+${card.rewards.gold}g`);
        if (card.rewards.prestige) parts.push(`+${card.rewards.prestige} Pres`);
        if (card.rewards.favor) parts.push(`+${card.rewards.favor} Fav`);
        effectText = parts.join(' · ');
    }

    const banner = document.createElement('div');
    banner.className = 'mini-spotlight' + (isDiscard ? ' mini-discard' : '');
    banner.innerHTML = `
        <img src="assets/cards/regular/${card.filename}" alt="${card.name}"
             onerror="this.style.display='none'">
        <div class="mini-spotlight-info">
            <span class="mini-spotlight-name">${card.name}</span>
            <span class="mini-spotlight-effect">${effectText}</span>
        </div>
    `;

    document.body.appendChild(banner);
    void banner.offsetWidth;
    banner.classList.add('show');

    return new Promise((resolve) => {
        setTimeout(() => {
            banner.classList.add('exit');
            setTimeout(() => {
                banner.remove();
                resolve();
            }, 300 * speed);
        }, 1200 * speed);
    });
}

// ─── EFFECT FLOAT SYSTEM ─────────────────────────────────

function showEffectFloat(text, cssClass, anchorEl) {
    const speed = window.CINEMATIC_SPEED;
    const container = document.getElementById('effectFloats');
    if (!container) return;

    const float = document.createElement('div');
    float.className = `effect-float ${cssClass}`;
    float.textContent = text;

    // Position near the anchor element or center screen
    if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        float.style.left = `${rect.left + rect.width / 2}px`;
        float.style.top = `${rect.top}px`;
        float.style.transform = 'translateX(-50%)';
    } else {
        float.style.left = '50%';
        float.style.top = '45%';
        float.style.transform = 'translateX(-50%)';
    }

    container.appendChild(float);

    setTimeout(() => float.remove(), 1500 * speed);
}

// ─── STAT CHANGE TRACKING & ANIMATION ────────────────────

let _prevStats = null;

function captureStats() {
    if (!game) return;
    const p = game.players[0];
    _prevStats = {
        gold: p.gold,
        prestige: p.prestige,
        scorn: p.scorn,
        favor: game.currentFavor(0)   // held favor — jumps when a Favor card lands
    };
}

function animateStatChanges() {
    if (!game || !_prevStats) return;
    const p = game.players[0];
    const bar = document.getElementById('bottomStats');
    if (!bar) return;

    const changes = [
        { key: 'gold', prev: _prevStats.gold, curr: p.gold, cls: 'gold-change', label: 'Gold' },
        { key: 'prestige', prev: _prevStats.prestige, curr: p.prestige, cls: 'prestige-change', label: 'Prestige' },
        { key: 'scorn', prev: _prevStats.scorn, curr: p.scorn, cls: 'scorn-change', label: 'Scorn' },
        { key: 'favor', prev: _prevStats.favor, curr: game.currentFavor(0), cls: 'favor-change', label: 'Favor' },
    ];

    changes.forEach(c => {
        if (c.curr === c.prev) return;

        const diff = c.curr - c.prev;
        const sign = diff > 0 ? '+' : '';
        const gainOrLoss = diff > 0 ? 'gain' : 'loss';

        // Find the stat element in the bar
        const statEls = bar.querySelectorAll('.stat');
        statEls.forEach(el => {
            if (el.classList.contains(c.key)) {
                el.classList.remove('stat-pulse', 'stat-gain', 'stat-loss');
                void el.offsetWidth; // Force reflow
                el.classList.add('stat-pulse', `stat-${gainOrLoss}`);

                setTimeout(() => {
                    el.classList.remove('stat-pulse', 'stat-gain', 'stat-loss');
                }, 500 * window.CINEMATIC_SPEED);
            }
        });

        // Float text
        showEffectFloat(`${sign}${diff} ${c.label}`, c.cls);
    });

    _prevStats = null;
}

// ─── NOTIFICATIONS ────────────────────────────────────────

// Act-start fires three announcements at once (Act begins / Emblem holder /
// Queen's boon) — stacked, they buried the board on Wyatt's 7/17 screenshot.
// 'act' banners now play ONE AT A TIME through this queue; everything else
// still shows immediately.
let _actBannerQueue = [];
let _actBannerActive = false;
function _drainActBanners() {
    const container = document.getElementById('notifications');
    if (!container || !_actBannerQueue.length) { _actBannerActive = false; return; }
    _actBannerActive = true;
    const msg = _actBannerQueue.shift();
    const toast = document.createElement('div');
    toast.className = 'game-toast act';
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => { toast.remove(); _drainActBanners(); }, 450);
    }, 1900);
}

function showNotification(msg, type = 'info') {
    const container = document.getElementById('notifications');
    if (!container) return;

    // One-at-a-time for act announcements so they never stack over the board.
    if (type === 'act') {
        _actBannerQueue.push(msg);
        if (!_actBannerActive) _drainActBanners();
        return;
    }

    const toast = document.createElement('div');
    toast.className = `game-toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

function addLogEntry(msg) {
    const entries = document.getElementById('logEntries');
    if (!entries) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = msg;
    entries.insertBefore(entry, entries.firstChild);

    while (entries.children.length > 50) {
        entries.removeChild(entries.lastChild);
    }
}

function toggleLog() {
    document.getElementById('gameLog').classList.toggle('open');
}

// ─── MUSIC ─────────────────────────────────────────────────

function toggleMusic() {
    const audio = document.getElementById('themeMusic');
    const btn = document.getElementById('musicBtn');

    if (musicPlaying) {
        audio.pause();
        btn.classList.add('muted');
        musicPlaying = false;
    } else {
        audio.volume = 0.4;
        audio.play().catch(() => {});
        btn.classList.remove('muted');
        musicPlaying = true;
    }
}

// Auto-play music on first interaction
document.addEventListener('click', function initMusic() {
    if (!musicPlaying) {
        const audio = document.getElementById('themeMusic');
        audio.volume = 0.4;
        audio.play().then(() => {
            musicPlaying = true;
            document.getElementById('musicBtn').classList.remove('muted');
        }).catch(() => {});
    }
    document.removeEventListener('click', initMusic);
}, { once: true });

// ─── TITLE SCREEN ──────────────────────────────────────────

// The queue flow (Wyatt's 7/14 spec): PLAY NOW queues you in the
// BACKGROUND and hands the menu right back — browse the leaderboard or
// the store while the chip ticks. 9–25 seconds of honest waiting later a
// MATCH FOUND ring lands over whatever you're looking at; ACCEPT opens
// the 20-second hero pick, DECLINE (or a lapse) costs nothing. The offer
// is still rolled AT the pledge (sticky per commit) so nothing re-rolls.
let _queueUx = null;   // { size, offer, startedAt, state, solo, accepted, tickT, acceptT, ringT, pick }

function startGame() {
    // A saved regular table gets right of first refusal on PLAY.
    // (Never for pinned rig builds — the suite's Play taps go straight
    // to the select screen, exactly as before saves existed.)
    if (window._pinEmblemSeed === undefined && loadSoloSave() && openResumeSheet()) return;
    window._mpConsumed = false;
    window._gameMode = null;   // Play Now is the queue — modes set their own
    // Straight-to-the-heroes seam: pinned/skip-queue builds (the audit's
    // ~600 title→select→game checks) and offline play take the classic
    // path — no queue, no window, no popup, no clock.
    const skip = window._pinEmblemSeed !== undefined || window._mpSkipQueue
        || !(window.FMP && FMP.available());
    const offer = rollStickyOffer();
    if (skip) {
        document.getElementById('title-screen').classList.add('hidden');
        setTimeout(() => {
            document.getElementById('title-screen').style.display = 'none';
            showCharacterSelect(offer);
        }, 1200);
        return;
    }
    // Already pledged? The chip IS the state — nudge it, don't double-queue.
    if (_queueUx) { pulseQueueChip(); return; }
    _queueUx = {
        size: (window.FLB && FLB.queueSize()) || 3,
        offer, startedAt: Date.now(), state: 'searching',
    };
    FMP.enterQueue({
        size: _queueUx.size,
        offer: offer.map(c => c.id),
        onState: mpQueueEvent,
    });
    showQueueChip();
}

// ── Queue events — js/mp.js narrates, this runs the theater ─────────
function mpQueueEvent(kind, d) {
    if (!_queueUx) return;
    switch (kind) {
        case 'searching':
            // Pool narration — but never stomp a verdict line mid-hold
            // (the requeue notice must outlive the next heartbeat event).
            if (Date.now() < (_queueUx.subHold || 0)) return;
            queueChipSub(d.others > 0
                ? `<b>${d.others}</b> noble${d.others > 1 ? 's' : ''} found — forming the table…`
                : 'Calling for challengers…');
            return;
        case 'found':
            _queueUx.state = 'found';
            _queueUx.solo = false;
            showMatchFound({ solo: false, size: (d.rec && d.rec.size) || _queueUx.size });
            return;
        case 'accepts':
            matchFoundProgress(d.n, d.of);
            return;
        case 'solo':
            // The window closed alone — the realm itself answers. Same
            // ring, same stakes; the fill presents as people.
            _queueUx.state = 'found';
            _queueUx.solo = true;
            showMatchFound({ solo: true, size: _queueUx.size });
            return;
        case 'requeued':
            // Someone else sank the table — my wait (and my priority) carry on.
            _queueUx.state = 'searching';
            _queueUx.solo = false;
            _queueUx.accepted = false;
            clearInterval(_queueUx.ringT);
            hideMatchFound();
            leavePickPhase();
            showQueueChip();
            _queueUx.subHold = Date.now() + 6000;
            queueChipSub('A noble declined — the search continues…');
            pulseQueueChip();
            return;
        case 'picking':
            enterPickPhase({ mp: true, pickStart: d.pickStart });
            return;
        case 'live':
            // Sealed! The queue theater retires; the lockstep table builds.
            if (window._mpConsumed) return;
            window._mpConsumed = true;
            localStorage.removeItem('favorOffer');
            leavePickPhase({ keepScreen: true });
            teardownQueueUx();
            startMpGame(d);
            return;
        case 'removed':
            if (d.reason === 'lapse') {
                showNotification('The table moved on without you.', 'info');
            } else if (d.reason === 'dissolved') {
                showNotification('The table dissolved — the realm apologizes.', 'info');
            }
            leavePickPhase();
            teardownQueueUx();
            return;
    }
}

// ── The queue chip — the pledge made visible ────────────────────────
// A ROOT body child riding ABOVE the leaderboard/store panels (they live
// in their own stacking contexts), so the player can browse any menu
// surface while the realm searches. Elapsed clock + honest Withdraw.
function ensureQueueChip() {
    let chip = document.getElementById('queueChip');
    if (!chip) {
        chip = document.createElement('div');
        chip.id = 'queueChip';
        chip.innerHTML = `
            <span class="qc-dot"></span>
            <span class="qc-main">In Queue <b class="qc-time" id="qcTime">0:00</b></span>
            <span class="qc-sub" id="qcSub">Calling for challengers…</span>
            <button type="button" class="qc-x" id="qcWithdraw">Withdraw</button>`;
        document.body.appendChild(chip);
        chip.querySelector('#qcWithdraw').onclick = withdrawQueue;
    }
    return chip;
}
function showQueueChip() {
    if (!_queueUx) return;
    ensureQueueChip().classList.add('on');
    paintQueueChip();
    clearInterval(_queueUx.tickT);
    _queueUx.tickT = setInterval(paintQueueChip, 1000);
}
function paintQueueChip() {
    if (!_queueUx) return;
    const el = document.getElementById('qcTime');
    if (!el) return;
    const s = Math.max(0, Math.floor((Date.now() - _queueUx.startedAt) / 1000));
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function queueChipSub(line) {
    const el = document.getElementById('qcSub');
    if (el) el.innerHTML = line;
}
function pulseQueueChip() {
    const chip = document.getElementById('queueChip');
    if (!chip) return;
    chip.classList.remove('pulse');
    void chip.offsetWidth;
    chip.classList.add('pulse');
}

function withdrawQueue() {
    if (window.FMP && FMP.cancelQueue) FMP.cancelQueue();
    teardownQueueUx();
}

function teardownQueueUx() {
    if (_queueUx) {
        clearInterval(_queueUx.tickT);
        clearTimeout(_queueUx.acceptT);
        clearInterval(_queueUx.ringT);
        if (_queueUx.pick) clearInterval(_queueUx.pick.tickT);
        _queueUx = null;
    }
    const chip = document.getElementById('queueChip');
    if (chip) chip.classList.remove('on');
    hideMatchFound();
}

// ── MATCH FOUND — the LoL accept ring, FAVOR-skinned ────────────────
// A ROOT body child above every menu surface (nested popups get buried
// by the panels' own stacking contexts). The gold ring drains with the
// accept window, your crest rides the center, gold ACCEPT above a
// quieter crimson DECLINE. Art IS the UI — no grey modal.
function ensureMatchFound() {
    let mf = document.getElementById('matchFound');
    if (!mf) {
        mf = document.createElement('div');
        mf.id = 'matchFound';
        document.body.appendChild(mf);
    }
    return mf;
}

function showMatchFound({ solo, size }) {
    if (!_queueUx) return;
    const mf = ensureMatchFound();
    const acceptMs = (window.FMP && FMP._T && FMP._T.accept) || 10000;
    let crest = '';
    try {
        crest = (window.FLB && FLB.avatarDisc) ? FLB.avatarDisc(FLB.myAvatar(), 'mf-crest') : '';
    } catch (e) { /* ring stands alone */ }
    mf.innerHTML = `
        <div class="mf-stage">
            <div class="mf-ringwrap">
                <div class="mf-countring" id="mfCountRing"></div>
                <img class="mf-ringart" src="assets/ui/slider-ring.png" alt="">
                <div class="mf-core">
                    ${crest}
                    <div class="mf-headline">Match Found</div>
                    <div class="mf-sub">${size} Players &bull; The Realm</div>
                    <div class="mf-clock" id="mfClock"></div>
                </div>
            </div>
            <div class="mf-actions" id="mfActions">
                <button type="button" class="btn-royal primary mf-accept" id="mfAccept"><span>Ready</span></button>
                <button type="button" class="mf-decline" id="mfDecline">Decline</button>
            </div>
        </div>`;
    mf.classList.add('on');
    mf.querySelector('#mfAccept').onclick = acceptMatch;
    mf.querySelector('#mfDecline').onclick = declineMatch;
    // The chip yields the stage to the ring.
    const chip = document.getElementById('queueChip');
    if (chip) chip.classList.remove('on');

    // The ring drains over the accept window. MP's authoritative lapse
    // clock lives in js/mp.js — this one paints; solo owns its own.
    const t0 = Date.now();
    const ring = document.getElementById('mfCountRing');
    const clock = document.getElementById('mfClock');
    clearInterval(_queueUx.ringT);
    const paint = () => {
        const left = Math.max(0, acceptMs - (Date.now() - t0));
        const deg = (left / acceptMs) * 360;
        if (ring) ring.style.background =
            `conic-gradient(var(--gold-light) ${deg}deg, rgba(201,168,76,0.13) ${deg}deg)`;
        if (clock) clock.textContent = Math.ceil(left / 1000);
        if (!left && _queueUx) clearInterval(_queueUx.ringT);
    };
    paint();
    _queueUx.ringT = setInterval(paint, 100);
    if (solo) {
        clearTimeout(_queueUx.acceptT);
        _queueUx.acceptT = setTimeout(() => {
            if (_queueUx && _queueUx.state === 'found' && _queueUx.solo && !_queueUx.accepted) {
                showNotification('The table moved on without you.', 'info');
                teardownQueueUx();
            }
        }, acceptMs);
    }
}

function hideMatchFound() {
    const mf = document.getElementById('matchFound');
    if (mf) mf.classList.remove('on');
}

function matchFoundProgress(n, of) {
    if (!_queueUx || !_queueUx.accepted) return;
    const acts = document.getElementById('mfActions');
    if (acts) acts.innerHTML =
        `<div class="mf-wait">The court assembles — <b>${n}</b> of <b>${of}</b> answered…</div>`;
}

function acceptMatch() {
    if (!_queueUx || _queueUx.state !== 'found' || _queueUx.accepted) return;
    _queueUx.accepted = true;
    clearTimeout(_queueUx.acceptT);
    if (_queueUx.solo) {
        // The realm's own table needs no counter-signatures.
        clearInterval(_queueUx.ringT);
        hideMatchFound();
        enterPickPhase({ mp: false });
    } else {
        FMP.accept();
        const acts = document.getElementById('mfActions');
        if (acts) acts.innerHTML =
            '<div class="mf-wait">You answer the call — the court assembles…</div>';
    }
}

function declineMatch() {
    if (!_queueUx || _queueUx.state !== 'found' || _queueUx.accepted) return;
    clearTimeout(_queueUx.acceptT);
    if (_queueUx.solo) {
        teardownQueueUx();   // already out of the queue — just go home
    } else {
        FMP.decline();       // its 'removed' event tears the theater down
    }
}

// ── The 20-second hero pick ─────────────────────────────────────────
// Post-accept there is no back — the clock in the ribbon counts to the
// auto-pick (the ringed center hero), Begin commits early. MP measures
// from the record's server-stamped pickStart so every court hits 0:00
// together; the host fills true stragglers from their own offers.
function enterPickPhase({ mp, pickStart }) {
    if (!_queueUx) return;
    _queueUx.state = 'picking';
    _queueUx.solo = !mp;
    hideMatchFound();
    const chip = document.getElementById('queueChip');
    if (chip) chip.classList.remove('on');
    clearInterval(_queueUx.tickT);
    // The menu steps aside for the hero screen.
    if (window.FLB) { try { FLB.closeLeaderboard(); FLB.closeStore(); } catch (e) {} }
    const t = document.getElementById('title-screen');
    t.classList.add('hidden');
    t.style.display = 'none';

    const pickMs = (window.FMP && FMP._T && FMP._T.pick) || 20000;
    let deadline = Date.now() + pickMs;
    if (mp && typeof pickStart === 'number') {
        const remain = pickMs - (Date.now() - pickStart);
        deadline = Date.now() + Math.max(2500, Math.min(pickMs, remain));
    }
    _queueUx.pick = { mp: !!mp, deadline, committed: false };

    showCharacterSelect(_queueUx.offer);

    // Pre-highlight the ringed (center) hero so 0:00 always has a target.
    const cards = [...document.querySelectorAll('#characterGrid .character-card')];
    const center = cards[Math.floor(cards.length / 2)] || cards[0];
    if (center) selectCharacter(center.dataset.id, center);

    paintPickClock();
    _queueUx.pick.tickT = setInterval(() => {
        if (!_queueUx || !_queueUx.pick) return;
        paintPickClock();
        if (Date.now() >= _queueUx.pick.deadline) commitHeroPick(true);
    }, 250);
}

function paintPickClock() {
    if (!_queueUx || !_queueUx.pick) return;
    const el = document.getElementById('pickClock');
    if (!el) return;
    const left = Math.max(0, _queueUx.pick.deadline - Date.now());
    const s = Math.ceil(left / 1000);
    el.textContent = `0:${String(s).padStart(2, '0')}`;
    el.classList.toggle('hot', left <= 5000);
}

// One commit per pick — Begin and the 0:00 auto-pick land here together.
function commitHeroPick(auto) {
    if (!_queueUx || !_queueUx.pick || _queueUx.pick.committed) return;
    const pick = _queueUx.pick;
    pick.committed = true;
    clearInterval(pick.tickT);
    const offer = _queueUx.offer;
    const fallback = offer[Math.floor(offer.length / 2)] || offer[0];
    const hero = selectedCharacter || (fallback && fallback.id);
    if (pick.mp) {
        selectedCharacter = hero;
        // Side rides the pick (spec §8): explicit chooser tap, else last
        // played, else A — resolved NOW so the 0:00 auto-pick never stalls.
        const side = chosenSideFor(hero);
        const heroDef = window.FAVOR_DATA.characters.find(x => x.id === hero);
        if (heroDef && heroDef.altSlots) setSidePref(hero, side || 'a');
        FMP.publishPick(hero, side || 'a');
        if (auto) showNotification('The clock decides — your hero answers.', 'act');
        const ribbon = document.getElementById('queuePledge');
        if (ribbon) ribbon.innerHTML =
            '<span class="qp-dot"></span> You answer the call — the court assembles…';
        const btn = document.getElementById('confirmBtn');
        if (btn) { btn.disabled = true; btn.style.opacity = 0.45; }
        // The record's seal ('live') starts the table from here.
    } else {
        selectedCharacter = hero;
        teardownQueueUx();
        buildSoloTable();
    }
}

// A private room reaching 'picking' rides the SAME timed-pick theater as
// the queue — the lobby already was the accept, so the fabricated state
// starts at the hero screen (modes.js calls this from the room events).
function roomPickPhase(d) {
    if (!_queueUx) {
        _queueUx = {
            size: (d.rec && d.rec.size) || 3,
            offer: rollStickyOffer(),
            startedAt: Date.now(),
            state: 'picking',
        };
    }
    _queueUx.state = 'picking';
    enterPickPhase({ mp: true, pickStart: d.pickStart });
}

// Exiting the pick phase without a table (decline chains, dissolves).
function leavePickPhase(opts) {
    if (_queueUx && _queueUx.pick) {
        clearInterval(_queueUx.pick.tickT);
        _queueUx.pick = null;
    }
    if (opts && opts.keepScreen) return;
    const sel = document.getElementById('character-select');
    if (sel && sel.classList.contains('active')) {
        sel.classList.remove('active');
        const t = document.getElementById('title-screen');
        t.style.display = '';
        requestAnimationFrame(() => t.classList.remove('hidden'));
    }
}

// One offer per pledge: rolled at Play Now, reused for 10 minutes (or
// until a table actually forms) — withdrawing and retrying shows the SAME
// three heroes, so there is nothing to re-roll for.
function rollStickyOffer() {
    const ownedIds = (window.FLB && typeof FLB.ownedIds === 'function')
        ? FLB.ownedIds()
        : window.FAVOR_DATA.characters.slice(0, 5).map(c => c.id);
    const byId = (id) => window.FAVOR_DATA.characters.find(c => c.id === id);
    try {
        const s = JSON.parse(localStorage.getItem('favorOffer'));
        if (s && Date.now() - s.at < 10 * 60 * 1000
            && Array.isArray(s.ids) && s.ids.length === 3
            && s.ids.every(id => ownedIds.includes(id))) {
            return s.ids.map(byId);
        }
    } catch (e) { /* fresh roll */ }
    const ownedChars = window.FAVOR_DATA.characters.filter(c => ownedIds.includes(c.id));
    const offer = shuffleArray(ownedChars).slice(0, 3);
    localStorage.setItem('favorOffer',
        JSON.stringify({ ids: offer.map(c => c.id), at: Date.now() }));
    return offer;
}

// ═══ Side B — which side rides when a hero is confirmed ══════════════
// (docs/FAVOR-XP-SIDEB-SPEC.md §5.) The chooser's explicit tap wins;
// otherwise the last side PLAYED on that hero (persisted at confirm),
// else A. That is also exactly what the 0:00 auto-pick commits, so the
// pick clock can never stall waiting for a side nobody chose. Validated
// against the CURRENT unlock every time — a stale 'b' preference can
// never sneak a locked board into a table.
function sidePref(heroId) {
    try { return (JSON.parse(localStorage.getItem('favorSidePref')) || {})[heroId] || 'a'; }
    catch (e) { return 'a'; }
}
function setSidePref(heroId, side) {
    let m = {};
    try { m = JSON.parse(localStorage.getItem('favorSidePref')) || {}; } catch (e) { /* fresh */ }
    m[heroId] = side === 'b' ? 'b' : 'a';
    try { localStorage.setItem('favorSidePref', JSON.stringify(m)); } catch (e) { /* private mode */ }
}
function chosenSideFor(heroId) {
    const c = window.FAVOR_DATA.characters.find(x => x.id === heroId);
    if (!c || !c.altSlots) return null;
    if (!(window.FLB && typeof FLB.sideBUnlocked === 'function' && FLB.sideBUnlocked(heroId))) return null;
    const side = (window._sideChoice && window._sideChoice.hero === heroId)
        ? window._sideChoice.side : sidePref(heroId);
    return side === 'b' ? 'b' : null;
}

// The two-step's second step: a hero at Level 5+ expands a side chooser
// under the grid — two board thumbnails, each wearing its own epithet.
// Below Level 5 the card's greyed badge IS the advertisement; no chooser.
function renderSideChooser(heroId) {
    const box = document.getElementById('sideChooser');
    if (!box) return;
    const c = heroId && window.FAVOR_DATA.characters.find(x => x.id === heroId);
    const unlocked = c && c.altSlots && window.FLB
        && typeof FLB.sideBUnlocked === 'function' && FLB.sideBUnlocked(heroId);
    if (!unlocked) { box.classList.remove('on'); box.innerHTML = ''; return; }
    const side = (window._sideChoice && window._sideChoice.hero === heroId)
        ? window._sideChoice.side : sidePref(heroId);
    box.innerHTML = `
        <div class="sc-title">Choose your board — ${c.name}</div>
        <div class="sc-sides">
            <div class="sc-side${side !== 'b' ? ' on' : ''}" data-side="a" role="button" aria-pressed="${side !== 'b'}">
                <img src="assets/characters/${c.filename}" alt="${c.name} Side A">
                <div class="sc-lab"><b>Side A</b><i>${c.epithet || ''}</i></div>
            </div>
            <div class="sc-side${side === 'b' ? ' on' : ''}" data-side="b" role="button" aria-pressed="${side === 'b'}">
                <img src="assets/characters/${c.altFilename || c.filename}" alt="${c.name} Side B">
                <div class="sc-lab"><b>Side B</b><i>${c.altEpithet || ''}</i></div>
            </div>
        </div>`;
    box.querySelectorAll('.sc-side').forEach(el => {
        el.onclick = (e) => {
            e.stopPropagation();
            window._sideChoice = { hero: heroId, side: el.dataset.side };
            renderSideChooser(heroId);
        };
    });
    box.classList.add('on');
}

// The way home from the hero screen (skip-queue/offline paths) — and the
// safety net under every queue teardown.
function backToMenu() {
    if (window.FMP && FMP.cancelQueue) FMP.cancelQueue();
    teardownQueueUx();
    window._gameMode = null;
    window._rivalDef = null;
    document.getElementById('character-select').classList.remove('active');
    const t = document.getElementById('title-screen');
    t.style.display = '';
    requestAnimationFrame(() => t.classList.remove('hidden'));
}

// \u2550\u2550\u2550 HOW TO PLAY \u2014 card-deck tutorial (Prong 1) \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// SAP-style: one idea per card, casual voice, skippable. Data-driven so
// content is easy to tweak. `art` is an HTML snippet (real game images).
const HOWTO_ART = {
    icon:  n => `<img class="ht-icon" src="assets/icons/${n}.png" alt="">`,
    hero:  s => `<img class="ht-hero" src="${s}" alt="">`,
    card:  s => `<img class="ht-cardimg" src="${s}" alt="">`,
};
const HOWTO_CARDS = [
    { text: `The King has passed, and his children vie for the throne. The Queen will crown whoever wins the most <b>Favor</b> in her eyes \u2014 make that heir <b>you</b>.`,
      art: HOWTO_ART.hero('assets/ui/cover.jpg') },
    { text: `This is your <b>character board</b>. The ring on the track marks your position \u2014 move it to unlock skills, gold, and Favor.`,
      art: `<div class="ht-board-wrap"><img class="ht-hero" src="assets/characters/Explorer.jpg" alt=""><img class="ht-board-ring" src="assets/ui/slider-ring.png" alt=""></div>` },
    { text: `Everything runs on six <b>skills</b>: Survival, Charisma, Alchemy, Prospecting, Knowledge, and Power. You build them up as you play.`,
      art: `<div class="ht-icons">${['survival','charisma','alchemy','prospecting','knowledge','power'].map(HOWTO_ART.icon).join('')}</div>` },
    { text: `Each round you're dealt a hand. <b>Throw one card in face down</b>, then pass the rest to the next player. Everyone drafts from the same hands \u2014 choose wisely!`,
      art: `<div class="ht-fan"><img src="assets/cards/regular/Trapping Card.jpg" alt=""><img src="assets/cards/regular/Cooking Card.jpg" alt=""><img src="assets/cards/regular/Negotiate Card.jpg" alt=""></div>` },
    { text: `Once every card is in, they're <b>revealed in turn</b>. On your reveal, <b>play yours</b> for its skills (some need the right skills) \u2014 or <b>discard it for +3 gold</b> or a ring move.`,
      art: HOWTO_ART.card('assets/cards/regular/Alchemist Apprentice Card.jpg') },
    { text: `Cards come in many types: <b>Endeavors</b> build skills, <b>Weapons</b> give Power, <b>Artifacts</b> & <b>Adventures</b> grant Favor, and <b>Potions</b> fire off instantly.`,
      art: `<div class="ht-fan"><img src="assets/cards/regular/Hunting Card.jpg" alt=""><img src="assets/cards/regular/Lens of Truth Card.jpg" alt=""><img src="assets/cards/regular/Badge of Courage Card.jpg" alt=""></div>` },
    { text: `<b>Gold</b> is your currency. Spend it on cards, on moving your ring, and to <b>borrow skills</b> from other players when you're short.`,
      art: HOWTO_ART.icon('gold') },
    { text: `<b>Missions</b> are your path to big Favor. Take one from the pool, then meet its skill requirement. Succeed for <b>Favor and rewards</b> \u2014 fail, and you'll take <b>Scorn</b>.`,
      art: HOWTO_ART.card('assets/cards/missions/Act 1_Helping the Merchant Card.jpg') },
    { text: `<b>Scorn</b> is dishonor \u2014 it counts <b>against</b> you when the Queen tallies the score. Dodge failed missions and cards that dish it out.`,
      art: HOWTO_ART.icon('scorn') },
    { text: `Each Act ends in a <b>Melee</b> \u2014 a realm-wide tournament of <b>Power</b>. Everyone's Power is compared, and the strongest earn <b>Prestige</b>.`,
      art: HOWTO_ART.icon('power') },
    { text: `<b>Prestige</b> is honor at court \u2014 positive points at scoring. You earn it mainly by <b>winning Melees</b> (and a few rare cards).`,
      art: `<img class="ht-token" src="assets/tokens/Copy of Tokens_Design_v1_Prestige_1_v1.jpg" alt="">` },
    { text: `Some cards grant a <b>Map</b>. A Map lets you play its linked card <b>for free</b> \u2014 chaining you into adventures and rich Favor.`,
      art: HOWTO_ART.card('assets/cards/regular/Lost North Map.jpg') },
    { text: `<b>Mind's Eye</b> and the <b>Philosopher's Stone</b> are rare treasures \u2014 keys to the game's mightiest cards and missions. They can't be borrowed, so guard them well.`,
      art: `<div class="ht-icons">${HOWTO_ART.icon('minds_eye')}${HOWTO_ART.icon('philosopher')}</div>` },
    { text: `The tale spans <b>three Acts</b>. Cards and missions grow mightier each Act, so plan a few moves ahead.`,
      art: `<div class="ht-acts">\u2160 \u00b7 \u2161 \u00b7 \u2162</div>` },
    { text: `When Act 3's final Melee ends, <b>the Queen decides</b>. She tallies your Favor \u2014 from missions, artifacts, and skills \u2014 plus Prestige, minus Scorn. The most Favor takes the throne!`,
      art: `<div class="ht-win"><img class="ht-icon" src="assets/icons/favor.png" alt=""><div class="ht-crown">\ud83d\udc51</div></div>` },
];

let howtoIndex = 0;

function showRules() { openHowto(); }

function openHowto() {
    howtoIndex = 0;
    renderHowto();
    document.getElementById('howto-overlay').classList.add('active');
}
function closeHowto() {
    document.getElementById('howto-overlay').classList.remove('active');
}
function howtoNext() {
    if (howtoIndex < HOWTO_CARDS.length - 1) { howtoIndex++; renderHowto(); }
    else closeHowto();
}
function howtoPrev() {
    if (howtoIndex > 0) { howtoIndex--; renderHowto(); }
}
function renderHowto() {
    const c = HOWTO_CARDS[howtoIndex];
    const total = HOWTO_CARDS.length;
    document.getElementById('howtoArt').innerHTML = c.art;
    document.getElementById('howtoText').innerHTML = c.text;
    document.getElementById('howtoCounter').textContent = `${howtoIndex + 1} / ${total}`;
    document.getElementById('howtoPrev').style.visibility = howtoIndex === 0 ? 'hidden' : 'visible';
    document.getElementById('howtoNext').textContent = howtoIndex === total - 1 ? 'Finish' : 'Next';
    document.getElementById('howtoDots').innerHTML =
        HOWTO_CARDS.map((_, i) => `<span class="ht-dot${i === howtoIndex ? ' on' : ''}"></span>`).join('');
}

// ═══ COACH-MARKS — Prong 2: in-game contextual tips ═══════════════
// SAP-style nudges that point at the real UI. One idea per bubble,
// fires once on first encounter, ✕ to dismiss, never blocks play.
// Strictly linear: step N only becomes eligible once step N-1 is
// dismissed AND step N's own moment arrives — so they pace themselves
// to the natural flow of a first game rather than dogpiling at once.
// Fires on BOTH form factors — each step anchors to whichever element
// (phone or desktop) is on stage. Desktop players don't open the How-to-Play
// deck unprompted (cold-pass 7/15), so the coach carries the first game.
// Rig kill-switch: window._coachOff = true (ui-audit seeds seen-ids instead).

function coachSumSkills(sk) {
    if (!sk) return 0;
    return Object.values(sk).reduce((a, b) => a + (b || 0), 0);
}
function coachMyTurn(s) {
    // The throw window: your hand is live and your card isn't in yet.
    const hand = s.players[0].hand;
    return s.phase === 'gameplay' && hand && hand.length > 0
        && game.pendingActivations[0] === null;
}

// Resolve the first VISIBLE anchor among selectors (phone first, then
// desktop) so one step list serves both form factors.
function coachEl(...sels) {
    for (const s of sels) {
        const el = document.querySelector(s);
        if (el && coachVisibleEl(el)) return el;
    }
    return null;
}

const COACH_STEPS = [
    { id: 'welcome',
      text: `You're seated at the table — this is <b>you</b>. Tap your seat or your board any time to see your ring and what its circles pay.`,
      anchor: () => coachEl('#tvSeats .pmat.you', '#boardThumb'),
      place: 'auto',
      when: () => true },
    { id: 'missions',
      text: `The <b>Missions of the Realm</b> — complete them for <b>Favor</b>, the points that win the crown. Tap one to read it.`,
      anchor: () => coachEl('#tvMissionRail', '#missionStrip'),
      place: 'auto',
      when: (s) => (s.visibleMissions || []).length > 0 },
    { id: 'hand',
      text: `Drag <b>one card up</b> to play it, face down. Once every player has thrown, the cards are revealed in turn — you'll choose what yours does <b>then</b>.`,
      anchor: () => coachEl('#tvHandStrip', '#handZone'),
      place: 'top',
      when: (s) => coachMyTurn(s) },
    { id: 'skills',
      text: `Your <b>skills</b> grow as you play cards. Mightier cards and missions require them — skills are never spent, only built.`,
      anchor: () => coachEl('#tvSkills', '#statsPanel .skills-grid'),
      place: 'auto',
      when: (s) => coachSumSkills(s.players[0].skills) > 0 },
    { id: 'pass',
      text: `New cards? Hands <b>travel around the table</b> after every pick — you're drafting from your rivals' hands now.`,
      anchor: () => coachEl('#tvHandStrip', '#handZone'),
      place: 'top',
      when: (s) => !!window._uxHandsPassed && coachMyTurn(s) },
    { id: 'rivals',
      text: `Tap a <b>rival</b> to inspect their board and cards. Short a skill? <b>Borrow</b> a neighbor's for 2 gold — paid to them.`,
      anchor: () => coachEl('#tvSeats .pmat.opp', '#gameSidebar .opp-entry'),
      place: 'auto',
      when: (s) => s.players.some((p, i) => i !== 0 && coachSumSkills(p.skills) > 0) },
    { id: 'scorn',
      text: `That red number is <b>Scorn</b> — dishonor. The Queen subtracts it at the final tally. Some cards charge it as their price; the card panel shows it before you commit.`,
      anchor: () => coachEl('#tvPurse [data-stat="scorn"]', '#statsPanel [data-stat="scorn"]'),
      place: 'auto',
      when: (s) => (s.players[0].scorn || 0) > 0 },
    { id: 'favor',
      text: `<b>Favor!</b> The crown's own points. Whoever holds the most when Act Ⅲ ends takes the throne.`,
      anchor: () => coachEl('#tvPurse [data-stat="favor"]', '#statsPanel [data-stat="favor"]'),
      place: 'auto',
      when: (s) => (s.players[0].favor || 0) > 0 },
    { id: 'ring',
      text: `Your <b>ring</b> moved! Landing on a circle pays its medallion, and some circles lend a skill while you rest there. The track's far ends pay the most.`,
      anchor: () => coachEl('#tvBoardThumb', '#boardThumb'),
      place: 'auto',
      when: () => game.players[0].sliderPosition !== 2 },
    { id: 'melee',
      text: `That clash was the <b>Melee</b> — one ends every Act. The mightiest <b>Power</b> wins <b>Prestige</b>: pure points at the Queen's tally.`,
      anchor: () => coachEl('#tvPurse [data-stat="prestige"]', '#statsPanel [data-stat="prestige"]'),
      place: 'auto',
      when: () => !!window._uxMeleeDone },
    { id: 'emblem',
      text: `You hold the <b>Emblem</b> — you act first while it's yours, and it travels on when the Act ends.`,
      anchor: () => coachEl('#tvSeats .pmat.you .emblem-badge', '#statsPanel .emblem-tag'),
      place: 'auto',
      when: (s) => s.emblemHolder === 0 },
];

let _coachSeen = coachLoadSeen();
let _coachActive = null;

function coachLoadSeen() {
    try { return new Set(JSON.parse(localStorage.getItem('favor_coach_seen') || '[]')); }
    catch (e) { return new Set(); }
}
function coachSaveSeen() {
    try { localStorage.setItem('favor_coach_seen', JSON.stringify([..._coachSeen])); } catch (e) {}
}
// Console helper: window.resetCoach() to replay the tips.
function resetCoach() {
    _coachSeen = new Set(); coachSaveSeen(); _coachActive = null; hideCoach();
    if (typeof coachStartHeartbeat === 'function') coachStartHeartbeat();
    if (typeof game !== 'undefined' && game) renderGameState();
}
window.resetCoach = resetCoach;

// Never surface a tip while a full-screen modal / action panel is up.
function coachOverlayOpen() {
    return ['howto-overlay', 'boardOverlay', 'handInspectOv', 'oppOverlay',
            'missionLB', 'missionJournal', 'cardZoom', 'scoring-screen', 'missionSelect',
            'actionPanel', 'cardPeek', 'meleeSplash', 'promisePicker',
            'tvPopoverHost']
        .some(id => { const el = document.getElementById(id); return el && el.classList.contains('active'); });
}

function coachVisibleEl(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
}

// The heartbeat: called after every table render / panel change.
function coachTick() {
    const coach = document.getElementById('coach');
    if (!coach) return;
    if (window._coachOff || typeof game === 'undefined' || !game || coachOverlayOpen()) {
        hideCoach(); return;
    }
    let state;
    try { state = game.getState(0); } catch (e) { hideCoach(); return; }

    // Only ever consider the first not-yet-seen step (strict linear order).
    const step = COACH_STEPS.find(s => !_coachSeen.has(s.id));
    if (!step) { hideCoach(); return; }

    let anchor = null;
    try { anchor = step.when(state) ? step.anchor() : null; } catch (e) { anchor = null; }
    if (!coachVisibleEl(anchor)) { hideCoach(); return; }

    showCoach(step, anchor);
}

function showCoach(step, anchor) {
    const coach = document.getElementById('coach');
    const glow = document.getElementById('coach-glow');
    if (_coachActive !== step.id) {
        _coachActive = step.id;
        coach.innerHTML =
            `<div class="coach-bubble">
                <button class="coach-x" onclick="dismissCoach()" aria-label="Dismiss">✕</button>
                <div class="coach-text">${step.text}</div>
                <span class="coach-skip" onclick="skipAllCoach()">Skip tips</span>
                <span class="coach-arrow"></span>
            </div>`;
        if (typeof step.onActivate === 'function') step.onActivate();
    }
    coach.classList.add('show');
    glow.classList.add('show');
    positionCoach(anchor, step.place);
}

function positionCoach(anchor, place) {
    const coach = document.getElementById('coach');
    const glow = document.getElementById('coach-glow');
    const arrow = coach.querySelector('.coach-arrow');
    const a = anchor.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;

    // Frame the target.
    const gp = 4;
    glow.style.left = (a.left - gp) + 'px';
    glow.style.top = (a.top - gp) + 'px';
    glow.style.width = (a.width + gp * 2) + 'px';
    glow.style.height = (a.height + gp * 2) + 'px';

    // Measure the bubble off-screen, then place it.
    coach.style.left = '-9999px';
    coach.style.top = '0px';
    const bw = coach.offsetWidth, bh = coach.offsetHeight;
    const gap = 12;
    const acx = a.left + a.width / 2, acy = a.top + a.height / 2;

    if (place === 'auto') {
        const room = { top: a.top, bottom: vh - a.bottom, left: a.left, right: vw - a.right };
        place = Object.keys(room).sort((x, y) => room[y] - room[x])[0];
    }

    let x, y;
    if (place === 'top')         { x = acx - bw / 2; y = a.top - bh - gap; }
    else if (place === 'bottom') { x = acx - bw / 2; y = a.bottom + gap; }
    else if (place === 'left')   { x = a.left - bw - gap; y = acy - bh / 2; }
    else                         { x = a.right + gap; y = acy - bh / 2; }

    x = Math.max(8, Math.min(x, vw - bw - 8));
    y = Math.max(8, Math.min(y, vh - bh - 8));
    coach.style.left = x + 'px';
    coach.style.top = y + 'px';

    positionCoachArrow(arrow, place, x, y, bw, bh, acx, acy);
}

function positionCoachArrow(arrow, place, x, y, bw, bh, acx, acy) {
    const sz = 12, half = sz / 2;
    let pd, left = '', top = '';
    if (place === 'top') {          // bubble above anchor → caret points down
        pd = 'down'; top = (bh - half) + 'px';
        left = Math.max(10, Math.min(acx - x - half, bw - 10 - sz)) + 'px';
    } else if (place === 'bottom') { // bubble below → caret points up
        pd = 'up'; top = (-half) + 'px';
        left = Math.max(10, Math.min(acx - x - half, bw - 10 - sz)) + 'px';
    } else if (place === 'left') {   // bubble left of anchor → caret points right
        pd = 'right'; left = (bw - half) + 'px';
        top = Math.max(10, Math.min(acy - y - half, bh - 10 - sz)) + 'px';
    } else {                         // bubble right of anchor → caret points left
        pd = 'left'; left = (-half) + 'px';
        top = Math.max(10, Math.min(acy - y - half, bh - 10 - sz)) + 'px';
    }
    arrow.className = 'coach-arrow pd-' + pd;
    arrow.style.left = left; arrow.style.right = '';
    arrow.style.top = top; arrow.style.bottom = '';
}

function dismissCoach() {
    if (_coachActive) { _coachSeen.add(_coachActive); coachSaveSeen(); }
    _coachActive = null;
    hideCoach();
    // Re-evaluate; the next tip only appears once its own moment arrives.
    setTimeout(coachTick, 40);
}
function skipAllCoach() {
    COACH_STEPS.forEach(s => _coachSeen.add(s.id));
    coachSaveSeen();
    _coachActive = null;
    hideCoach();
}
function hideCoach() {
    // Only hides the bubble; keeps _coachActive so an unchanged step that
    // reappears (e.g. after a re-render) doesn't rebuild and flicker.
    const c = document.getElementById('coach'), g = document.getElementById('coach-glow');
    if (c) c.classList.remove('show');
    if (g) g.classList.remove('show');
}

// Mark a tip done because the player actually engaged its element (tapped a
// card, opened a rival, etc.) — so it never nags after they've "got it".
function coachMarkSeen(id) {
    if (_coachSeen.has(id)) return;
    _coachSeen.add(id);
    coachSaveSeen();
    if (_coachActive === id) { _coachActive = null; hideCoach(); }
    setTimeout(coachTick, 40);
}

// Backstop for the same rule: ANY tap inside the glowing anchor counts as
// "got it" — even if the tap didn't route through a wired handler above.
document.addEventListener('pointerdown', (e) => {
    if (!_coachActive) return;
    const step = COACH_STEPS.find(s => s.id === _coachActive);
    if (!step) return;
    let anchor = null;
    try { anchor = step.anchor(); } catch (err) { return; }
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top && e.clientY <= r.bottom) {
        coachMarkSeen(step.id);
    }
}, true);

// Safety-net heartbeat: some modals open/close without a table re-render, so
// poll a few times a second to keep the bubble correctly shown/hidden. Costs
// almost nothing (early-returns) and stops itself once every tip is seen.
let _coachHeartbeat = null;
function coachStartHeartbeat() {
    if (_coachHeartbeat) clearInterval(_coachHeartbeat);
    _coachHeartbeat = setInterval(() => {
        if (COACH_STEPS.every(s => _coachSeen.has(s.id))) {
            clearInterval(_coachHeartbeat); _coachHeartbeat = null; hideCoach(); return;
        }
        coachTick();
    }, 400);
}
coachStartHeartbeat();

// ── Prompt Test toggle (title screen) ──
// When on, the tutorial prompts replay every game — handy for testing without
// clearing tab storage. State persists in localStorage.
function togglePromptTest(on) {
    try { localStorage.setItem('favor_prompt_test', on ? '1' : '0'); } catch (e) {}
    if (on) resetCoach();   // clear seen now so prompts fire on the next play
}

// Menu cards are divs (the queue buttons nest inside Play, and buttons
// can't nest in buttons) — give them real keyboard activation anyway.
document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ')
        && e.target.classList && e.target.classList.contains('ts-card')) {
        e.preventDefault();
        e.target.click();
    }
});
function coachPromptTestOn() {
    try { return localStorage.getItem('favor_prompt_test') === '1'; } catch (e) { return false; }
}
// If Prompt Test is on, wipe seen-state at the start of each game so tips replay.
function coachApplyPromptTest() {
    if (coachPromptTestOn()) { _coachSeen = new Set(); coachSaveSeen(); _coachActive = null; coachStartHeartbeat(); }
}
// Restore the checkbox to its saved state on load (scripts run after the DOM).
(function () {
    try {
        const cb = document.getElementById('promptTestToggle');
        if (cb) cb.checked = coachPromptTestOn();
    } catch (e) {}
})();

// ─── CHARACTER SELECT ──────────────────────────────────────

// The three heroes offered THIS game — the other seven are "already
// taken" by the other players in your queue, and the bots genuinely
// draw from those leftovers in confirmCharacter.
let _offeredHeroes = [];

function showCharacterSelect(offer) {
    const screen = document.getElementById('character-select');
    screen.classList.add('active');

    const grid = document.getElementById('characterGrid');
    grid.innerHTML = '';

    if (!window.FAVOR_DATA || !window.FAVOR_DATA.characters) {
        grid.innerHTML = '<p style="color: var(--gold); grid-column: 1/-1; text-align: center;">Loading character data...</p>';
        return;
    }

    // The ribbon above the heroes: an accepted match shows the pick clock
    // and offers NO way back (the 20s throws you in — Wyatt's call, v1);
    // the classic/offline path keeps its plain return home.
    let pledge = document.getElementById('queuePledge');
    if (!pledge) {
        pledge = document.createElement('div');
        pledge.id = 'queuePledge';
        pledge.className = 'queue-pledge';
        screen.insertBefore(pledge, grid);
    }
    if (_queueUx && _queueUx.state === 'picking') {
        pledge.innerHTML = `<span class="qp-dot"></span>
            The table is set — choose your hero
            <b class="qp-clock" id="pickClock">0:20</b>`;
    } else {
        pledge.innerHTML = `<button type="button" class="menu-link" id="qpBack">← Return to the Menu</button>`;
        pledge.querySelector('#qpBack').onclick = backToMenu;
    }

    // A fresh visit starts unpicked — a lingering selection (or a Begin
    // button left disabled by an MP wait) must not leak between visits.
    selectedCharacter = null;
    const confirmBtn = document.getElementById('confirmBtn');
    if (confirmBtn) {
        confirmBtn.style.display = 'none';
        confirmBtn.disabled = false;
        confirmBtn.style.opacity = '';
    }

    // The offer was rolled AT THE PLEDGE (sticky — see rollStickyOffer);
    // it draws from the heroes YOU OWN (first five are everyone's; store
    // purchases join the pool). Bots still draw from all ten.
    _offeredHeroes = offer || rollStickyOffer();
    _offeredHeroes.forEach(char => {
        const card = document.createElement('div');
        card.className = 'character-card fade-in';
        card.dataset.id = char.id;
        card.onclick = () => selectCharacter(char.id, card);

        const stars = '\u2605'.repeat(Math.floor(char.difficulty || 1));

        // The Gilt Ribbon + the Side B badge. Below Level 5 the greyed
        // lock badge is the advertisement (spec \u00a75); at 5+ it lights.
        const fv = (window.FLB && typeof FLB.heroFv === 'function') ? FLB.heroFv(char.id) : 0;
        const ribbon = (window.FLB && typeof FLB.xpRibbonHtml === 'function')
            ? `<div class="hs-xp">${FLB.xpRibbonHtml(fv, 11, 13)}</div>` : '';
        const unlockedB = char.altSlots && window.FLB
            && typeof FLB.sideBUnlocked === 'function' && FLB.sideBUnlocked(char.id);
        const badge = char.altSlots
            ? `<span class="side-badge${unlockedB ? ' lit' : ''}">${unlockedB ? 'Side A \u21c4 B' : 'Side B \u00b7 Lv 5'}</span>`
            : '';

        card.innerHTML = `
            ${badge}
            <img src="assets/characters/${char.filename}" alt="${char.name}">
            ${ribbon}
            <div class="character-info">
                <h3>${char.name}</h3>
                ${char.epithet ? `<div class="epithet">${char.epithet}</div>` : ''}
                <div class="difficulty">Difficulty: ${stars}</div>
                <div class="tip">${char.tip || ''}</div>
            </div>
        `;

        grid.appendChild(card);
    });

    // The side chooser (two-step, step 2) lives between the grid and the
    // Begin button; a fresh visit starts collapsed with no explicit choice.
    let chooser = document.getElementById('sideChooser');
    if (!chooser) {
        chooser = document.createElement('div');
        chooser.id = 'sideChooser';
        chooser.className = 'side-chooser';
        grid.parentNode.insertBefore(chooser, grid.nextSibling);
    }
    window._sideChoice = null;
    chooser.classList.remove('on');
    chooser.innerHTML = '';
}

function selectCharacter(id, cardEl) {
    const grid = document.getElementById('characterGrid');
    const cards = [...grid.querySelectorAll('.character-card')];
    const center = cards[Math.floor(cards.length / 2)];

    // The selection ring is a FIXTURE of the center slot (Wyatt: "ring
    // stays fixed on center, characters move through it") — tapping a
    // side hero glides them INTO the ring while the centered one steps
    // aside (FLIP: measure, reorder, invert, release).
    if (cardEl !== center && cards.length > 1) {
        cards.forEach(c => c.classList.remove('fade-in'));   // appendChild replays animations
        const firsts = new Map(cards.map(c => [c, c.getBoundingClientRect().left]));
        const ci = cards.indexOf(center), ti = cards.indexOf(cardEl);
        [cards[ci], cards[ti]] = [cards[ti], cards[ci]];
        cards.forEach(c => grid.appendChild(c));
        cards.forEach(c => {
            const dx = firsts.get(c) - c.getBoundingClientRect().left;
            if (!dx) return;
            c.style.transition = 'none';
            c.style.transform = `translateX(${dx}px)`;
        });
        void grid.offsetWidth;
        cards.forEach(c => {
            c.style.transition = 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)';
            c.style.transform = '';
        });
    }

    document.querySelectorAll('.character-card').forEach(c => c.classList.remove('selected'));
    cardEl.classList.add('selected');   // cardEl now holds the center slot
    selectedCharacter = id;
    // Step 2 of the two-step: a Level-5+ hero expands the side chooser
    // (collapses again when a locked hero takes the ring).
    renderSideChooser(id);
    const btn = document.getElementById('confirmBtn');
    btn.style.display = 'inline-block';
    // Begin Your Journey sits below the fold on phones — picking a hero
    // carries you straight down to it (#character-select is the scroller;
    // rAF lets the reveal land in layout first).
    requestAnimationFrame(() =>
        btn.scrollIntoView({ behavior: 'smooth', block: 'end' }));
}

// Which persona rivals sit at this table? Returns an array the size of the
// bot count — persona defs in their seats, null where a generic bot plays.
// Odds are session defaults awaiting Wyatt's veto: 1 in 5 tables seat two
// personas, 2 in 3 seat at least one, cap two. seed.forceSeats is a rig
// seam for the audit suite — real seeds never set it.
function seatPersonas(seed, botCount) {
    const seats = new Array(botCount).fill(null);
    const pool = ((seed && seed.personas) || []).slice();
    if (!pool.length || !botCount) return seats;

    if (Array.isArray(seed.forceSeats)) {
        seed.forceSeats
            .map(key => pool.find(p => p.key === key))
            .filter(Boolean)
            .slice(0, botCount)
            .forEach((p, i) => { seats[i] = p; });
        return seats;
    }

    const roll = Math.random();
    let n = roll < 0.2 ? 2 : roll < 2 / 3 ? 1 : 0;
    n = Math.min(n, botCount, pool.length);
    for (let k = 0; k < n; k++) {
        const p = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        let s = Math.floor(Math.random() * botCount);
        while (seats[s]) s = (s + 1) % botCount;
        seats[s] = p;
    }
    return seats;
}

async function confirmCharacter() {
    if (!selectedCharacter) return;
    if (window._mpConsumed) return;   // a sealed match already claimed this pledge

    // Queue-flow pick phase: Begin = the commit. MP publishes the pick and
    // waits for the host's seal; the solo theater falls straight through
    // commitHeroPick into the classic build below.
    if (_queueUx && _queueUx.pick) { commitHeroPick(false); return; }

    await buildSoloTable();
}

// ═══ Solo save — a REGULAR table survives leaving it (Wyatt 7/17) ═══
// Checkpointed at every round start (beginThrowPhase): nothing pending,
// hands dealt, decks exactly as shuffled — resuming rewinds at most to
// the top of the round you left. Skirmish/Wanted never save (leave =
// walk away); multiplayer never saves (the record lives in the realm).
const SOLO_SAVE_KEY = 'favorSoloSave';
const SOLO_SAVE_V = 1;

function soloSaveEligible() {
    // A checkpoint is only clean when NOTHING is face down — a mid-throw
    // save would freeze hands that already gave cards to unsaved pendings.
    // Rig seam: pinned tables (_pinEmblemSeed) are audit fixtures — they
    // never checkpoint, so a suite flow can never leave a save behind
    // that derails the next flow's Play tap.
    // Skirmish and the Daily Rival are fully LOCAL (AI only, no wire) — they
    // checkpoint and resume like a regular table, so minimizing and coming
    // back always returns you to the game, however long it's been (Wyatt
    // 7/17). Private games and anything with real people ride mpActive() and
    // are excluded — they can't be revived from a lone client.
    const localMode = !window._gameMode
        || window._gameMode === 'skirmish' || window._gameMode === 'rival';
    return !!game && !mpActive() && localMode && !window._noSoloSave
        && window._pinEmblemSeed === undefined
        && game.phase === 'gameplay'
        && game.pendingActivations.every(p => p === null);
}

function saveSoloCheckpoint() {
    if (!soloSaveEligible()) return;
    try {
        const g = game;
        localStorage.setItem(SOLO_SAVE_KEY, JSON.stringify({
            v: SOLO_SAVE_V, at: Date.now(), hero: selectedCharacter,
            mode: window._gameMode || null,
            rivalDef: window._rivalDef || null,
            skirmishSize: window._skirmishSize || null,
            g: {
                playerCount: g.playerCount, currentAct: g.currentAct,
                emblemHolder: g.emblemHolder, activePlayerIndex: g.activePlayerIndex,
                turnInAct: g.turnInAct,
                actDecks: g.actDecks, missionDecks: g.missionDecks,
                visibleMissions: g.visibleMissions, discardPile: g.discardPile,
                log: g.log.slice(-40),
                players: g.players.map(p => ({
                    ...p,
                    character: p.character ? p.character.id : null,
                    _actSlotEvents: [...(p._actSlotEvents || [])],
                })),
            },
        }));
    } catch (e) { /* a failed save must never break the table */ }
}

function loadSoloSave() {
    try {
        const s = JSON.parse(localStorage.getItem(SOLO_SAVE_KEY));
        return s && s.v === SOLO_SAVE_V && s.g && Array.isArray(s.g.players) ? s : null;
    } catch (e) { return null; }
}

function clearSoloSave() {
    try { localStorage.removeItem(SOLO_SAVE_KEY); } catch (e) { /* fine */ }
}

function resumeSoloSave() {
    const s = loadSoloSave();
    if (!s) return false;
    try {
        const g = new FavorGame(s.g.playerCount);
        Object.assign(g, s.g, {
            phase: 'gameplay',
            pendingActivations: new Array(s.g.playerCount).fill(null),
            hands: [],
            players: s.g.players.map(p => ({
                ...p,
                // The save round-trips character BY ID and side separately —
                // the resolver returns the Side B view when p.side === 'b',
                // so a resumed table never silently reverts to Side A.
                character: p.character
                    ? g.resolveCharacterView(p.character, p.side) || null
                    : null,
                _actSlotEvents: new Set(p._actSlotEvents || []),
            })),
        });
        game = g;
        selectedCharacter = s.hero
            || (g.players[0].character && g.players[0].character.id) || null;
        // Restore the local mode (Skirmish / Daily Rival) so scoring still
        // knows it's a bounty table; regular saves carry mode null.
        window._gameMode = s.mode || null;
        window._rivalDef = s.rivalDef || null;
        if (s.skirmishSize) window._skirmishSize = s.skirmishSize;
        window._uxThrownOnce = true;   // a returning table needs no gesture hint
        const ts = document.getElementById('title-screen');
        ts.classList.add('hidden');
        ts.style.display = 'none';
        document.getElementById('character-select').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');
        addLogEntry('You retake your seat — the round restarts');
        renderGameState();
        beginThrowPhase();
        return true;
    } catch (e) {
        clearSoloSave();
        return false;
    }
}

// The Play tap offers a waiting table first — Resume or start fresh.
function openResumeSheet() {
    const s = loadSoloSave();
    if (!s) return false;
    const heroDef = window.FAVOR_DATA.characters.find(c => c.id === s.hero);
    const acts = ['I', 'II', 'III'];
    const ov = document.getElementById('leaveSheet');
    ov.innerHTML = `
        <div class="ri-inner" onclick="event.stopPropagation()">
            <div class="ri-title">A Table Awaits</div>
            <div class="ri-stakes">Your game as <b>${heroDef ? 'the ' + heroDef.name : 'your hero'}</b>
                stands at <b>Act ${acts[(s.g.currentAct || 1) - 1] || s.g.currentAct}</b> —
                exactly where you left it.</div>
            <div class="ri-actions">
                <button class="btn-royal" onclick="discardSaveAndPlay()"><span>New Game</span></button>
                <button class="btn-royal primary" onclick="closeLeaveSheet(); resumeSoloSave()"><span>Resume Game</span></button>
            </div>
        </div>`;
    ov.classList.add('active');
    ov.onclick = () => closeLeaveSheet();
    return true;
}

function discardSaveAndPlay() {
    clearSoloSave();
    closeLeaveSheet();
    startGame();
}

// ── The door out of a solo table ─────────────────────────────────
function openLeaveSheet() {
    if (!game || mpActive()) return;
    const mode = window._gameMode;
    const regular = !mode;
    const ov = document.getElementById('leaveSheet');
    ov.innerHTML = `
        <div class="ri-inner" onclick="event.stopPropagation()">
            <div class="ri-title">Leave the Table?</div>
            <div class="ri-stakes">${regular
                ? 'Your seat is saved — resume any time from <b>PLAY</b>. The round restarts when you return.'
                : mode === 'rival'
                    ? 'The rival keeps the bounty for now — this game is not recorded.'
                    : 'A friendly skirmish — nothing is recorded.'}</div>
            <div class="ri-actions">
                <button class="btn-royal" onclick="closeLeaveSheet()"><span>Keep Playing</span></button>
                <button class="btn-royal primary" onclick="confirmLeaveGame()"><span>${regular ? 'Save &amp; Leave' : 'Leave'}</span></button>
            </div>
        </div>`;
    ov.classList.add('active');
    ov.onclick = () => closeLeaveSheet();
}

function closeLeaveSheet() {
    document.getElementById('leaveSheet').classList.remove('active');
}

function confirmLeaveGame() {
    // Regular tables ride their round-start checkpoint; the modes walk
    // away clean. The reload IS the teardown — same door the update
    // pill uses, so the menu always comes back in a known-good state.
    if (window._gameMode) clearSoloSave();
    if (window.FLB && typeof FLB.applyUpdate === 'function') FLB.applyUpdate();
    else location.reload();
}

// Fake-human names for REGULAR games (Wyatt 7/17): two things put
// together, fun, realistic-username energy — never renaissance. The
// thematic court names stay Skirmish/Wanted flavor; leaderboard
// personas keep their own realistic names. mp.js fills AI seats from
// this same pool (window.CASUAL_AI_NAMES).
const CASUAL_AI_NAMES = [
    'Frisky Teacher', 'Soggy Waffle', 'Turbo Grandma', 'Midnight Snacker',
    'Casual Dentist', 'Sleepy Barista', 'Angry Muffin', 'Disco Plumber',
    'Lucky Raccoon', 'Spicy Librarian', 'Waffle Inspector', 'Couch Captain',
    'Taco Whisperer', 'Grumpy Optimist', 'Bacon Scientist', 'Karate Uncle',
    'Pickle Enthusiast', 'Sneaky Accountant', 'Caffeinated Owl', 'Suburban Ninja',
    'Extreme Napper', 'Polite Viking', 'Confused Tourist', 'Garage Drummer',
    'Diet Wizard', 'Weekend Pirate', 'Nervous Chef', 'Retired Cowboy',
    'Bubbly Mechanic', 'Awkward Lifeguard', 'Crispy Noodle', 'Hungry Landlord',
    'Mystic Janitor', 'Gentle Bulldozer', 'Panicked Golfer', 'Frozen Mailman',
    'Dramatic Cactus', 'Budget Astronaut', 'Silent Kazoo', 'Chatty Monk',
    'Rogue Intern', 'Cozy Lumberjack', 'Salty Cupcake', 'Blissful Goblin',
];
window.CASUAL_AI_NAMES = CASUAL_AI_NAMES;

// The classic table — solo builds land here from Begin (skip-queue and
// offline paths), from the queue theater's accepted solo pick, and from
// the Skirmish / Wanted doors (modes.js sets window._gameMode).
async function buildSoloTable() {
    const mode = window._gameMode || null;
    // Table size = the queue you joined on the menu (persisted; the old
    // in-select dropdown moved there so Play Now can never skip past it).
    // Skirmish asks its own 3/4/5 at the door (Wyatt 7/16); the Daily
    // Rival is always a table of three — the on-ramp table.
    const playerCount = mode === 'rival' ? 3
        : mode === 'skirmish' ? (window._skirmishSize || 3)
        : ((window.FLB && FLB.queueSize()) || 3);

    localStorage.removeItem('favorOffer');   // this pledge becomes a real table

    // One leaderboard read seeds the rated Emblem start, persona seating,
    // and the rank-1 boon. Prefetched at boot, raced against 1200ms here —
    // offline/slow/pinned falls back to the classic start (seat 0, generic
    // bots, no boon). Resolved BEFORE `game` exists so nothing ever sees a
    // half-built table.
    let seed = null;
    if (window._pinEmblemSeed === undefined
        && window.FLB && typeof FLB.tableSeed === 'function') {
        // The select screen stays interactive during this await — swallow
        // a double-tap on Begin instead of building two games. The race
        // never rejects, so the flag always clears.
        if (window._confirmBusy) return;
        window._confirmBusy = true;
        try {
            seed = await Promise.race([
                FLB.tableSeed(),
                new Promise(r => setTimeout(() => r(null), 1200)),
            ]);
        } catch (e) { seed = null; }
        window._confirmBusy = false;
    }

    game = new FavorGame(playerCount);
    game.loadDecks();

    // Bots draw from the heroes that were NOT offered to you — the other
    // "players" in your queue already took theirs, so the three on your
    // screen (minus your pick) stay off the table. Earned-only heroes
    // (spec §6b) are excluded at the SOURCE list, so both this filter AND
    // the under-pressure safety fallback below inherit the exclusion.
    const offered = _offeredHeroes.map(c => c.id);
    const allChars = window.FAVOR_DATA.characters
        .filter(c => !c.earnedOnly).map(c => c.id);
    let available = allChars.filter(id => id !== selectedCharacter && !offered.includes(id));
    // Safety: never run short of rivals (10 - 3 offered = 7 ≥ 4 bots today).
    if (available.length < playerCount - 1) {
        available = allChars.filter(id => id !== selectedCharacter);
    }

    // Your side resolves at the door (chooser tap → last played → A) and
    // the confirmed side becomes the hero's new default. Bots never carry
    // a side — Side A always (spec §6b).
    const mySide = chosenSideFor(selectedCharacter);
    const myDef = window.FAVOR_DATA.characters.find(x => x.id === selectedCharacter);
    if (myDef && myDef.altSlots) setSidePref(selectedCharacter, mySide || 'a');
    const choices = [{ characterId: selectedCharacter, playerName: 'You',
                       side: mySide || undefined }];

    const shuffled = shuffleArray(available);
    // Skirmish and rival tables wear the thematic court names (Wyatt 7/16:
    // that style lives HERE now). REGULAR games are fake humans — they
    // wear the casual two-word names (Wyatt 7/17: "Frisky Teacher", never
    // renaissance) so the table reads like people play here.
    const aiNames = (mode === 'skirmish' || mode === 'rival')
        ? shuffleArray(['The Lady Vespurine', 'Count Balthazar', 'Lord Ashcropt', 'Dame Rosalind',
                        'Prince Aldric', 'Princess Sera', 'Lord Cassius', 'Lady Elara'])
        : shuffleArray(CASUAL_AI_NAMES.slice());
    // Skirmish is PURE vs-AI (no leaderboard personas). The WANTED rival
    // seats exactly ONE — today's rival, at seat 1, under their own row.
    let personaSeats;
    if (mode === 'skirmish') {
        personaSeats = new Array(playerCount - 1).fill(null);
    } else if (mode === 'rival' && window._rivalDef) {
        // Today's rival: a themed challenger with the sharp table brain
        // and their own hero — NOT a leaderboard citizen (no uid, so
        // nothing ever posts a row for them).
        personaSeats = new Array(playerCount - 1).fill(null);
        personaSeats[0] = { ...window._rivalDef };
    } else {
        personaSeats = seatPersonas(seed, playerCount - 1);
    }
    const seatedPersonas = [];   // [{seat, def}] — marked on game.players below
    const taken = (id) => choices.some(c => c.characterId === id);
    let draw = 0;
    const nextFree = () => {
        while (draw < shuffled.length && taken(shuffled[draw])) draw++;
        return shuffled[draw++];
    };
    for (let i = 0; i < playerCount - 1; i++) {
        const persona = personaSeats[i];
        if (persona) {
            // Signature hero for face recognition — random when it was
            // offered to you or someone at the table already took it.
            // The DAILY RIVAL outranks the offered-pool exclusion: the
            // Duchess rival rides the Duchess unless YOU took her.
            const sigOk = !taken(persona.hero)
                && (available.includes(persona.hero) || mode === 'rival');
            const heroId = sigOk ? persona.hero : nextFree();
            choices.push({ characterId: heroId, playerName: persona.name });
            seatedPersonas.push({ seat: i + 1, def: persona });
        } else {
            choices.push({ characterId: nextFree(), playerName: aiNames[i] });
        }
    }

    game.initPlayers(choices);
    seatedPersonas.forEach(({ seat, def }) => {
        const gp = game.players[seat];
        gp._personaUid = def.uid;
        gp._personaAI = { key: def.key, strong: def.strong.slice() };
        // Elo pairs against this seat's real rating at scoring time.
        gp._tableRating = (typeof def.rating === 'number' && def.rating > 0) ? def.rating : null;
    });
    // The WANTED rival rides provisioned for the hunt (Wyatt 7/16): one
    // extra copy of the starting gold of the hero they ACTUALLY ride —
    // the same resource they already start with, doubled, so the daily
    // head is harder to take than a skirmish bot.
    if (mode === 'rival' && window._rivalDef) {
        const rp = game.players.find(p => p.name === window._rivalDef.name);
        if (rp && rp.character) rp.gold += rp.character.startingGold || 0;
    }

    // ── Rated Emblem start: the highest rating at the table holds it in
    // Act 1. Rated = you (your favor/players row exists) or a seated
    // persona; ties break human-first, then lower seat. Nobody rated →
    // random seat. No seed → seat 0, exactly the old behavior.
    let emblemSeat = 0;
    if (window._pinEmblemSeed !== undefined) {
        emblemSeat = window._pinEmblemSeed;
    } else if (mode === 'skirmish') {
        // A skirmish has no rated table — the Emblem starts anywhere.
        emblemSeat = Math.floor(Math.random() * playerCount);
    } else if (seed) {
        const rated = [];
        if (seed.myRow) rated.push({ seat: 0, rating: seed.myRow.rating || 0 });
        seatedPersonas.forEach(({ seat, def }) =>
            rated.push({ seat, rating: def.rating || 0 }));
        if (rated.length) {
            const best = Math.max(...rated.map(r => r.rating));
            emblemSeat = rated.filter(r => r.rating === best)
                .sort((a, b) => a.seat - b.seat)[0].seat;
        } else {
            emblemSeat = Math.floor(Math.random() * playerCount);
        }
    }
    game.setEmblemHolder(emblemSeat);

    // ── Rank-1 boon: if the ALL-TIME #1 sits at this table — you or a
    // persona — the Queen grants them +1 of one skill for the game. Only
    // rank 1, only the all-time board, never the daily.
    let boonSeat = -1;
    if (window._pinEmblemSeed === undefined && seed && seed.topRow) {
        if (seed.myRow && seed.topRow.uid === FLB.uid()) {
            boonSeat = 0;
        } else {
            const sp = seatedPersonas.find(({ def }) => def.uid === seed.topRow.uid);
            if (sp) boonSeat = sp.seat;
        }
    }

    document.getElementById('character-select').classList.remove('active');

    game.startAct(1);
    addLogEntry('\u2550\u2550\u2550 Act 1 begins \u2550\u2550\u2550');
    showNotification('Act 1 Begins \u2014 Choose wisely.', 'act');

    // Announce the Act-1 seat \u2014 every table hears who leads and why the
    // order is what it is. The chip/rail badges re-render with the state.
    const holderName = game.emblemHolder === 0 ? 'You' : game.players[game.emblemHolder].name;
    showNotification(
        holderName === 'You' ? 'You hold the Emblem \u2014 you act first.'
            : `${holderName} holds the Emblem and acts first.`, 'act');
    addLogEntry(holderName === 'You' ? 'You hold the Emblem \u2014 you act first'
        : `${holderName} holds the Emblem and acts first`);

    // If Prompt Test is checked, replay the tutorial prompts this game.
    if (typeof coachApplyPromptTest === 'function') coachApplyPromptTest();

    showGameScreen();

    // \u2500\u2500 Deliver the rank-1 boon on the freshly-set stage \u2500\u2500
    if (boonSeat === 0) {
        await showBoonPicker();
    } else if (boonSeat > 0) {
        const gp = game.players[boonSeat];
        // Heuristic: grow the weaker of its signature skills right now.
        const skill = gp._personaAI.strong.slice()
            .sort((a, b) => (gp.skills[a] || 0) - (gp.skills[b] || 0))[0];
        applyRankOneBoon(boonSeat, skill);
        const capSkill = skill.charAt(0).toUpperCase() + skill.slice(1);
        showNotification(
            `${gp.name} \u2014 the realm's #1 \u2014 receives the Queen's boon: +1 ${capSkill}`, 'act');
        addLogEntry(`${gp.name}, the realm's #1, gains the Queen's boon: +1 ${capSkill} all game`);
        renderGameState();
    }

    // A fresh game \u2014 the gesture hint returns for the first hand.
    window._uxThrownOnce = false;
    beginThrowPhase();
}

// The boon lands in bonusSkills \u2014 the same ledger mission skill rewards
// live in, so it survives every slider recalc for the whole game.
function applyRankOneBoon(seat, skill) {
    const p = game.players[seat];
    p.bonusSkills = p.bonusSkills || {};
    p.bonusSkills[skill] = (p.bonusSkills[skill] || 0) + 1;
    game.applySlotSkills(p);
}

// \u2550\u2550\u2550 RANK-1 BOON \u2014 the realm's #1 chooses a skill \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// Six icon tiles on the pp overlay; royal copy; NO dismiss-without-pick
// (the Queen does not offer twice). Applies +1 of the chosen skill via
// bonusSkills and resolves once confirmed.
const BOON_SKILLS = ['survival', 'charisma', 'alchemy', 'prospecting', 'power', 'knowledge'];

function showBoonPicker() {
    return new Promise((resolve) => {
        const ov = document.getElementById('promisePicker');
        if (!ov) { resolve(); return; }
        const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
        let chosen = null;
        const render = () => {
            const tiles = BOON_SKILLS.map(s => `
                <div class="boon-tile${chosen === s ? ' chosen' : ''}" data-skill="${s}">
                    <img src="assets/icons/${s}.png" alt="${cap(s)}">
                    <span>${cap(s)}</span>
                </div>`).join('');
            ov.innerHTML = `
                <div class="pp-inner boon">
                    <div class="pp-title">The Realm's Favorite</div>
                    <div class="pp-sub">You sit first upon the all-time board \u2014 the Queen grants <b>+1 of one skill</b>, yours for the whole game</div>
                    <div class="boon-tiles">${tiles}</div>
                    <div class="pp-actions">
                        <button class="btn-royal primary" id="boonConfirm" ${chosen ? '' : 'disabled style="opacity:.35"'}>
                            <span>${chosen ? `Claim +1 ${cap(chosen)}` : 'Choose a skill'}</span>
                        </button>
                    </div>
                </div>`;
            ov.querySelectorAll('.boon-tile').forEach(el => {
                el.onclick = () => { chosen = el.dataset.skill; render(); };
            });
            ov.querySelector('#boonConfirm').onclick = () => {
                if (!chosen) return;
                if (window.FMP && FMP.active()) {
                    // Lockstep: the pick STREAMS \u2014 every client (this one
                    // included) applies it on receipt, in stream order.
                    FMP.publish('boon', { skill: chosen });
                } else {
                    applyRankOneBoon(0, chosen);
                    showNotification(`The Queen favors you \u2014 +1 ${cap(chosen)} all game`, 'act');
                    addLogEntry(`The Realm's Favorite: you gain +1 ${cap(chosen)} for the whole game`);
                    renderGameState();
                }
                ov.classList.remove('active');
                resolve();
            };
        };
        render();
        ov.classList.add('active');
    });
}

// \u2550\u2550\u2550 MULTIPLAYER GLUE \u2014 queue UX, lockstep rounds, remote seats \u2550\u2550\u2550\u2550\u2550\u2550\u2550
// The transport lives in js/mp.js (FMP). This block is everything the
// game screen needs: the searching overlay, building a table from the
// match record (rotated so YOU are seat 0 \u2014 a circle doesn't care), the
// pick barrier, remote-seat activation driven by streamed moves, the
// canonical-order end-of-act stages, and Wyatt's 2-minute AFK boot.

const mpActive = () => !!(window.FMP && FMP.active());
const mpPub = (type, data) => { if (mpActive()) FMP.publish(type, data); };

// (The old post-Begin "Searching the Realm" overlay is gone \u2014 searching
// happens in the BACKGROUND now, narrated by the queue chip, and the
// MATCH FOUND ring is the beat that interrupts you.)

// \u2500\u2500 Build the table from the match record \u2500\u2500
async function startMpGame({ game: rec, mySeat }) {
    const n = rec.size;
    teardownQueueUx();   // belt-and-suspenders \u2014 the 'live' event already did

    // The record is truth: if your pick collided with an earlier seat's
    // (or your write raced the seal), your seat carries an offer-drawn
    // hero \u2014 say so instead of surprising silently.
    const sealed = rec.roster[mySeat];
    if (sealed && sealed.hero && selectedCharacter && sealed.hero !== selectedCharacter) {
        const hc = window.FAVOR_DATA.characters.find(c => c.id === sealed.hero);
        showNotification(`The match formed \u2014 ${hc ? hc.name : 'your hero'} answers the call.`, 'act');
    }
    game = new FavorGame(n);
    game.setSeed(rec.seed);
    game.setDealOffset(mySeat);   // chunk k stays with canonical seat k
    game.loadDecks();

    // Rotate the canonical roster so the local human sits at seat 0. The
    // table is a circle \u2014 rotation preserves every neighbor, pass, and
    // emblem relationship, and the whole seat-0 UI stays true.
    const choices = [];
    for (let i = 0; i < n; i++) {
        const r = rec.roster[(mySeat + i) % n];
        // side survives the seal on HUMAN rows only — bots and personas
        // ride Side A, always (spec §6b), so the guard is explicit here
        // rather than trusting the record's shape.
        choices.push({ characterId: r.hero, playerName: i === 0 ? 'You' : r.name,
                       side: (r.human && r.side === 'b') ? 'b' : undefined });
    }
    game.initPlayers(choices);
    for (let i = 1; i < n; i++) {
        const r = rec.roster[(mySeat + i) % n];
        const gp = game.players[i];
        // Elo needs every seat's table rating at scoring time — humans
        // and personas bring theirs from the roster; AI rows stay null
        // and rate as the court's standard bot.
        gp._tableRating = (typeof r.rating === 'number' && r.rating > 0) ? r.rating : null;
        if (r.human) { gp._remoteHuman = true; gp._mpUid = r.uid; gp._mpAvatar = r.avatar || null; }
        if (r.persona) {
            gp._personaUid = r.personaUid;
            gp._personaAI = { key: r.persona, strong: (r.strong || []).slice() };
        }
    }
    game.setEmblemHolder(FMP.localIdx(rec.emblemSeat));

    // Boots arrive as broadcast moves so every client converts the seat
    // at the same point in the stream.
    FMP.onBroadcast('afk_boot', (m) => mpApplyBoot(m));
    FMP.onBroadcast('sync', (m) => mpCheckSync(m));
    // Reactions land in the sender's bubble on every screen (modes.js).
    if (window.FMODES) FMODES.attachEmotes();

    document.getElementById('character-select').classList.remove('active');
    game.startAct(1);
    addLogEntry('\u2550\u2550\u2550 Act 1 begins \u2550\u2550\u2550');
    showNotification('Act 1 Begins \u2014 Choose wisely.', 'act');
    const holderName = game.emblemHolder === 0 ? 'You' : game.players[game.emblemHolder].name;
    showNotification(holderName === 'You' ? 'You hold the Emblem \u2014 you act first.'
        : `${holderName} holds the Emblem and acts first.`, 'act');
    addLogEntry(holderName === 'You' ? 'You hold the Emblem \u2014 you act first'
        : `${holderName} holds the Emblem and acts first`);
    if (typeof coachApplyPromptTest === 'function') coachApplyPromptTest();
    showGameScreen();

    // Rank-1 boon, streamed: the #1 seat picks; everyone applies on
    // receipt. Personas pick by the shared heuristic \u2014 no stream needed.
    if (rec.boonSeat >= 0) {
        const li = FMP.localIdx(rec.boonSeat);
        const bp = game.players[li];
        if (bp._personaAI) {
            const skill = bp._personaAI.strong.slice()
                .sort((a, b) => (bp.skills[a] || 0) - (bp.skills[b] || 0))[0];
            applyRankOneBoon(li, skill);
            const capS = skill.charAt(0).toUpperCase() + skill.slice(1);
            showNotification(`${bp.name} \u2014 the realm's #1 \u2014 receives the Queen's boon: +1 ${capS}`, 'act');
            addLogEntry(`${bp.name}, the realm's #1, gains the Queen's boon: +1 ${capS} all game`);
            renderGameState();
        } else {
            if (li === 0) showBoonPicker();   // publishes; applied below
            else mpWaitShow(li, 'choosing the Queen\u2019s boon');
            const mv = await FMP.waitFor(rec.boonSeat, 'boon');
            mpWaitHide();
            if (mv && BOON_SKILLS.includes(mv.skill)) {
                applyRankOneBoon(FMP.localIdx(mv.seat), mv.skill);
                const who = FMP.localIdx(mv.seat) === 0 ? 'You' : game.players[FMP.localIdx(mv.seat)].name;
                const capS = mv.skill.charAt(0).toUpperCase() + mv.skill.slice(1);
                showNotification(who === 'You'
                    ? `The Queen favors you \u2014 +1 ${capS} all game`
                    : `${who} \u2014 the realm's #1 \u2014 receives the Queen's boon: +1 ${capS}`, 'act');
                addLogEntry(`The Queen's boon: +1 ${capS} to ${who === 'You' ? 'you' : who}`);
                renderGameState();
            }
            // Booted at the boon \u2192 the Queen withdraws; no boon this game.
        }
    }
    // Desync stamp AND baseline at the same canonical point on every
    // client \u2014 before the throw phase starts mutating bot hands.
    mpActBaseline();

    // A fresh game \u2014 the gesture hint returns for the first hand.
    window._uxThrownOnce = false;
    beginThrowPhase();
}

// \u2500\u2500 Waiting pill \u2014 non-modal, shows who the table waits on + AFK clock \u2500\u2500
let _mpWaitTimer = null;
function mpWaitShow(localSeat, doing) {
    let el = document.getElementById('mpWait');
    if (!el) {
        el = document.createElement('div');
        el.id = 'mpWait';
        document.body.appendChild(el);
    }
    const name = game.players[localSeat] ? game.players[localSeat].name : 'a noble';
    const started = Date.now();
    const afk = (window.FMP && FMP._T.afk) || 120000;
    const paint = () => {
        const left = Math.max(0, afk - (Date.now() - started));
        const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
        el.innerHTML = `\u23f3 Waiting on <b>${name}</b> \u2014 ${doing} <span class="mpw-clock">${m}:${String(s).padStart(2, '0')}</span>`;
    };
    paint();
    el.classList.add('on');
    clearInterval(_mpWaitTimer);
    _mpWaitTimer = setInterval(paint, 1000);
}
function mpWaitHide() {
    clearInterval(_mpWaitTimer);
    _mpWaitTimer = null;
    const el = document.getElementById('mpWait');
    if (el) el.classList.remove('on');
}

// \u2500\u2500 AFK boot (host published it; every client applies identically) \u2500\u2500
function mpApplyBoot(m) {
    if (!mpActive() || typeof m.target !== 'number') return;
    FMP.markBooted(m.target);
    const li = FMP.localIdx(m.target);
    if (li === 0) {
        // That's me \u2014 the court moved on. Leave cleanly and say so.
        FMP.leaveGame();
        const ov = document.getElementById('champOverlay');
        if (ov) {
            document.getElementById('champTitle').textContent = 'Removed for Inactivity';
            document.getElementById('champSub').innerHTML =
                'The court waited two minutes \u2014 the game continued without you.';
            ov.classList.add('active');
            const back = () => location.reload();
            ov.onclick = back;
            document.getElementById('champBtn').onclick = back;
        } else {
            location.reload();
        }
        return;
    }
    const gp = game.players[li];
    if (gp) {
        gp._remoteHuman = false;   // AI plays the seat from here on
        showNotification(`${gp.name} was removed for inactivity \u2014 the court plays on.`, 'act');
        addLogEntry(`${gp.name} was removed for inactivity`);
    }
}

// ── Remote seat activation — their streamed reveal, our shared engine ──
// (The old pick barrier is gone: throws collect off the stream in
// mpBeginThrowPhase, and each human's ACTION streams as an 'act' move at
// exactly their seat's point in the activation order — the same moment
// the local human answers the reveal chooser.) Every wait can return
// null (boot) and falls back to the exact AI move every client computes.
async function mpActivateRemote(pi, card, cardIdx) {
    const p = game.players[pi];
    const cs = FMP.canonSeat(pi);
    mpWaitShow(pi, cardIdx === 0 ? 'revealing their card' : 'deciding their final card');
    const mv = await FMP.waitFor(cs, 'act');
    mpWaitHide();

    let action = mv && mv.action;
    if (!action) {
        // Boot/fallback: the same default the AI takes, on every client.
        const { canPlay } = game.checkRequirements(pi, card);
        action = (card.type === 'mission_letter') ? 'discard' : (canPlay ? 'play' : 'discard');
    }

    if (action === 'mission_letter' && card.type === 'mission_letter'
        && p.gold >= 1 && game.visibleMissions.length > 0) {
        await showCardSpotlight(pi, card, 'play');
        const result = game.activateCard(pi, card.id, 'mission_letter');
        if (result && result.chooseMission) {
            mpWaitShow(pi, 'choosing a mission');
            const pick = await FMP.waitFor(cs, 'mission_pick');
            mpWaitHide();
            const idx = pick && Number.isInteger(pick.missionIdx)
                && pick.missionIdx >= 0 && pick.missionIdx < game.visibleMissions.length
                ? pick.missionIdx : aiBestMission(pi);
            game.chooseMission(pi, idx);
            addLogEntry(`${p.name} uses a Mission Letter`);
        }
    } else if (action === 'borrow_play') {
        const plan = (mv.borrow || []).map(b => ({ skill: b.skill, neighborIndex: FMP.localIdx(b.lender) }));
        const borrowable = game.getBorrowableSkills(pi);
        const covered = plan.length && plan.every(b =>
            borrowable[b.skill] && borrowable[b.skill].includes(b.neighborIndex));
        await showCardSpotlight(pi, card, covered ? 'play' : 'discard');
        if (covered && p.gold >= plan.length * 2) {
            game.activateCard(pi, card.id, 'play', plan);
            addLogEntry(`${p.name} borrows and plays ${card.name}`);
        } else {
            game.activateCard(pi, card.id, 'discard');
            addLogEntry(`${p.name} discards ${card.name} (+3 Gold)`);
        }
    } else if (action === 'discard_slide') {
        const dir = mv.dir === -1 || mv.dir === 1 ? mv.dir : 1;
        await showCardSpotlight(pi, card, 'discard');
        game.activateCard(pi, card.id, 'discard_slide', dir);
        addLogEntry(`${p.name} discards ${card.name} to slide their ring`);
        if (p._pendingSlotMission) {
            p._pendingSlotMission = false;
            mpWaitShow(pi, 'choosing a mission');
            const pick = await FMP.waitFor(cs, 'slot_mission');
            mpWaitHide();
            const idx = pick && Number.isInteger(pick.missionIdx)
                && pick.missionIdx >= 0 && pick.missionIdx < game.visibleMissions.length
                ? pick.missionIdx : aiBestMission(pi);
            game.chooseMission(pi, idx);
        }
    } else if (action === 'play') {
        const { canPlay } = game.checkRequirements(pi, card);
        if (canPlay) {
            await showCardSpotlight(pi, card, 'play');
            game.activateCard(pi, card.id, 'play');
            addLogEntry(`${p.name} plays ${card.name}`);
        } else {
            await showCardSpotlight(pi, card, 'discard');
            game.activateCard(pi, card.id, 'discard');
            addLogEntry(`${p.name} discards ${card.name}`);
        }
    } else {
        await showCardSpotlight(pi, card, 'discard');
        game.activateCard(pi, card.id, 'discard');
        addLogEntry(`${p.name} discards ${card.name}`);
    }

    // Chemical Y resolved for a remote human \u2014 their pick, streamed.
    if (p._pendingChemYPick) {
        p._pendingChemYPick = false;
        mpWaitShow(pi, 'choosing which favor doubles');
        const pick = await FMP.waitFor(cs, 'chemy');
        mpWaitHide();
        const advs = p.playedCards.filter(c =>
            c.type === 'adventure' && (c.favor || 0) > 0 && !c._favorDoubled);
        let target = pick && advs.find(c => c.id === pick.cardId);
        if (!target && advs.length) {
            target = advs.reduce((a, b) => ((b.favor || 0) > (a.favor || 0) ? b : a));
        }
        if (target) {
            target._favorDoubled = true;
            addLogEntry(`${p.name}'s Chemical Y doubles ${target.name}`);
        }
    }

    // Life Essence resolved for a remote human — their mission pick, streamed.
    if (p._pendingLifeEssencePick) {
        p._pendingLifeEssencePick = false;
        mpWaitShow(pi, 'choosing a mission to free of its requirement');
        const pick = await FMP.waitFor(cs, 'lepick');
        mpWaitHide();
        const missions = (p.missions || []).filter(m => !m._reqWaived);
        let target = pick && missions.find(m => m.id === pick.missionId);
        if (!target && missions.length) {
            // Booted / silent seat: the AI heuristic keeps every client identical.
            const failing = missions.filter(m => !game.probeMissionRequirements(pi, m).success);
            const pool = failing.length ? failing : missions;
            target = pool.reduce((a, b) =>
                (game.missionFavorEstimate(pi, b) > game.missionFavorEstimate(pi, a) ? b : a));
        }
        if (target) {
            target._reqWaived = true;
            addLogEntry(`${p.name}'s Life Essence blesses ${target.name} — no requirement`);
        }
    }

    // Chemical X fired for a remote human — their slot, streamed. FIRST, because
    // where they land is what can set the two slot choosers below.
    if (p._pendingSliderMove) {
        p._pendingSliderMove = false;
        mpWaitShow(pi, 'moving their ring');
        const mv = await FMP.waitFor(cs, 'slider_move');
        mpWaitHide();
        const pos = (mv && Number.isInteger(mv.pos)) ? mv.pos : game.aiFreeSliderPos(pi);
        const res = game.applyFreeSliderMove(pi, pos);
        if (res && res.success) {
            const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
            addLogEntry(`${p.name}'s Chemical X moves their ring to ${posNames[res.pos]}`);
        }
    }

    // …and if that landed them on the Magician's mission slot, their mission pick
    // streams too. (The discard-slide branch drains this itself and clears the
    // flag, so this is the catch-all for the card routes.)
    if (p._pendingSlotMission) {
        p._pendingSlotMission = false;
        mpWaitShow(pi, 'choosing a mission');
        const pick = await FMP.waitFor(cs, 'slot_mission');
        mpWaitHide();
        const idx = pick && Number.isInteger(pick.missionIdx)
            && pick.missionIdx >= 0 && pick.missionIdx < game.visibleMissions.length
            ? pick.missionIdx : aiBestMission(pi);
        game.chooseMission(pi, idx);
    }

    // The Magician's "Pick One" fired for a remote human — their skill, streamed.
    // Drained after the whole action chain so it covers every branch that can move
    // their ring onto the slot (discard-slide, or Chemical X moving it for free).
    // A booted/silent seat falls back to game.aiSlotPick, which every client
    // computes identically from the same state — so lockstep holds either way.
    if (p._pendingSlotPick) {
        p._pendingSlotPick = null;
        mpWaitShow(pi, 'choosing a skill from their board');
        const pick = await FMP.waitFor(cs, 'slot_pick');
        mpWaitHide();
        const opts = game.slotPickOptions(pi);
        const skill = (pick && opts.includes(pick.skill)) ? pick.skill : game.aiSlotPick(pi, opts);
        const res = game.applySlotPick(pi, skill);
        if (res && res.success) addLogEntry(`${p.name} picks +1 ${res.skill} from their board`);
    }
}

// \u2500\u2500 Held missions, canonical order \u2014 runs BEFORE resolveMissions \u2500\u2500
// A mission inside its window but not yet due is the holder's call every act
// until it is forced. In multiplayer that is one more act-boundary decision, so
// it stages exactly like the borrow and penalty choosers: every client walks the
// seats in canonical order and applies the SAME decision for each one, so
// `_attemptNow` is identical on every table before resolveMissions runs.
//
// This has to come BEFORE resolveMissions (unlike mpEndActStages, which runs
// after) or an attempt could not ride the same two-pass ordering \u2014 every check
// happening before any failure penalty lands \u2014 that a due mission gets.
async function mpHeldMissionStages() {
    const n = game.playerCount;
    for (let cs = 0; cs < n; cs++) {
        const li = FMP.localIdx(cs);
        const p = game.players[li];
        // Snapshot: nothing may shift the list under the loop.
        const held = game.postponableMissions(li).slice();
        for (const m of held) {
            if (li === 0) {
                const attempt = await showEarlyMissionChoice(m);   // publishes inside
                if (attempt) m._attemptNow = true;
                else addLogEntry(`You hold ${m.name} \u2014 due at the end of Act ${game.missionDueAct(m)}`);
            } else if (p._remoteHuman) {
                mpWaitShow(li, `deciding ${m.name}`);
                const mv = await FMP.waitFor(cs, 'mission_hold');
                mpWaitHide();
                if (mv) {
                    if (mv.attempt) m._attemptNow = true;
                    addLogEntry(`${p.name} ${mv.attempt ? 'attempts' : 'holds'} ${m.name}`);
                }
                // mv === null: BOOTED mid-decision. Deliberately leave the flag
                // unset and let resolveMissions' AI rule take the seat (bank only
                // what is already met, never throw a mission away). A client that
                // saw the boot BEFORE reaching this seat skips straight to that
                // same rule \u2014 so both land in exactly the same place.
                renderGameState();
            }
            // else: a genuine AI seat. resolveMissions banks a met mission for it
            // identically on every client \u2014 nothing to decide, nothing to stream.
        }
    }
}

// \u2500\u2500 End-of-act stages, canonical order \u2014 every client applies every
// seat's choices at the same point. Local seat uses the real choosers
// (and publishes); remote seats stream; booted seats fall back to AI.
async function mpEndActStages(borrowsPendingLocal) {
    const n = game.playerCount;
    for (let cs = 0; cs < n; cs++) {
        const li = FMP.localIdx(cs);
        const p = game.players[li];
        if (li === 0) {
            for (const m of borrowsPendingLocal) {
                await showMissionBorrowChooser(m);   // publishes inside
            }
        } else if (p._remoteHuman || (p._pendingMissionBorrows || []).length) {
            const pend = (p._pendingMissionBorrows || []).slice();
            p._pendingMissionBorrows = [];
            for (const m of pend) {
                mpWaitShow(li, `deciding ${m.name}`);
                const mv = p._remoteHuman ? await FMP.waitFor(cs, 'mission_borrow') : null;
                mpWaitHide();
                const idx = p.missions.indexOf(m);
                if (idx < 0) continue;
                const plan = game.missionBorrowPlan(li, m);
                const accept = mv ? !!mv.accept
                    : (plan && game.missionFavorEstimate(li, m) >= plan.cost); // boot \u2192 persona-grade judgment
                if (accept && plan) {
                    // Apply THEIR lenders, not our own first-available guess \u2014
                    // the fee lands in a specific neighbor's purse, so picking
                    // a different one here would fork the tables. A booted seat
                    // sends nothing, and every client then falls back to the
                    // same deterministic first-available plan.
                    const chosen = (mv && Array.isArray(mv.borrowFrom)) ? mv.borrowFrom : null;
                    const res = game.completeMissionWithBorrow(li, idx, chosen);
                    // The borrow could not close the gap after all. That is a
                    // real failure with real consequences — give it the same
                    // beat a due-date failure gets (completeMissionWithBorrow
                    // returns before splicing, so idx is still valid).
                    if (!res.success) await failMissionWithBeat(li, idx);
                    else {
                        const names = [...new Set(res.borrowFrom
                            ? res.borrowFrom.map(b => game.players[b.neighborIndex].name)
                            : [])].join(' & ');
                        addLogEntry(`${p.name} borrows${names ? ` from ${names}` : ''} to complete ${m.name}`);
                    }
                } else {
                    // A remote or AI seat letting a mission go used to be a
                    // bare log line — no beat, on any table. Same ceremony
                    // as everyone else now.
                    addLogEntry(`${p.name} lets ${m.name} fail`);
                    await failMissionWithBeat(li, idx);
                }
                renderGameState();
            }
        }
    }
    // Penalty discards \u2014 the failed owners pick which cards to give up.
    for (let cs = 0; cs < n; cs++) {
        const li = FMP.localIdx(cs);
        const p = game.players[li];
        const owed = p._pendingPenaltyDiscard || 0;
        if (!owed) continue;
        p._pendingPenaltyDiscard = 0;
        if (li === 0) {
            await showPenaltyDiscardPicker(owed);    // publishes inside
        } else {
            mpWaitShow(li, `discarding ${owed} to a failed mission`);
            const mv = p._remoteHuman ? await FMP.waitFor(cs, 'penalty') : null;
            mpWaitHide();
            const ids = (mv && Array.isArray(mv.cardIds)) ? mv.cardIds : [];
            const had = [...p.playedCards];
            let taken = ids.length
                ? game.discardPlayedCards(li, c => ids.includes(c.id), Math.min(owed, ids.length))
                : 0;
            if (taken < Math.min(owed, p.playedCards.length + taken)) {
                // Short or booted \u2014 the engine's own AI keep-score fills in.
                p._remoteHuman = false;
                game.penaltyDiscard(li, owed - taken);
                if (mv) p._remoteHuman = true;
            }
            // NAME the cards. A bare count told the table nothing about what
            // a rival just lost (Wyatt 7/18 on the same class of silence:
            // "we never got to see which cards he discarded").
            const gone = had.filter(c => !p.playedCards.includes(c));
            addLogEntry(`${p.name} discards ${gone.length
                ? gone.map(c => c.name).join(', ')
                : `${owed} card(s)`} to a failed mission`);
            renderGameState();
        }
    }
    // A Promise \u2014 sacrifice any number for prestige.
    for (let cs = 0; cs < n; cs++) {
        const li = FMP.localIdx(cs);
        const p = game.players[li];
        if (!p._pendingPromiseDiscard) continue;
        p._pendingPromiseDiscard = false;
        if (li === 0) {
            await showPromiseDiscardPicker();        // publishes inside
        } else {
            mpWaitShow(li, 'weighing A Promise');
            const mv = p._remoteHuman ? await FMP.waitFor(cs, 'promise') : null;
            mpWaitHide();
            const ids = (mv && Array.isArray(mv.cardIds)) ? mv.cardIds : [];
            if (ids.length) {
                const nDone = game.discardPlayedCards(li, c => ids.includes(c.id));
                p.prestige += PROMISE_PRESTIGE * nDone;
                addLogEntry(`${p.name} honors A Promise: ${nDone} card(s), +${PROMISE_PRESTIGE * nDone} Prestige`);
            }
            renderGameState();
        }
    }
}

// \u2500\u2500 Desync insurance \u2014 the host hashes the table each act; a mismatch
// converts the remotes to AI locally rather than play a forked game.
function mpStateHash() {
    const n = game.playerCount;
    const rows = [];
    for (let cs = 0; cs < n; cs++) {
        const p = game.players[FMP.localIdx(cs)];
        rows.push([p.gold, p.prestige, p.scorn, p.favor,
            (p.hand || []).map(c => c.id).join(','),
            (p.playedCards || []).map(c => c.id).join(','),
            (p.missions || []).map(m => m.id || m.name).join(',')].join('|'));
    }
    rows.push((game.visibleMissions || []).map(m => m.id || m.name).join(','));
    rows.push(String(FMP.canonSeat(game.emblemHolder)));
    const s = rows.join(';');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h;
}
// The host stamps each act's hash at a CANONICAL point \u2014 right before
// its throw phase kicks off. Every client snapshots its own hash at the
// SAME point (mpActBaseline): bot picks start mutating the engine the
// instant beginThrowPhase runs, so comparing against the LIVE hash on
// receipt is a race, not a check. A stamp that arrives before this
// client's baseline (boon await, stream latency) defers until it lands.
window._mpActHashes = {};   // act \u2192 my baseline hash
window._mpActStamps = {};   // act \u2192 the host's stamp, if it arrived early
function mpActBaseline() {
    if (!mpActive()) return;
    const act = game.currentAct;
    window._mpActHashes[act] = mpStateHash();
    if (FMP.isHost()) { mpPub('sync', { act, hash: window._mpActHashes[act] }); return; }
    if (typeof window._mpActStamps[act] === 'number') mpCompareSync(act, window._mpActStamps[act]);
}

function mpCheckSync(m) {
    if (!mpActive() || FMP.isHost() || typeof m.hash !== 'number') return;
    if (typeof window._mpActHashes[m.act] !== 'number') {
        window._mpActStamps[m.act] = m.hash;   // baseline not taken yet \u2014 compare when it is
        return;
    }
    mpCompareSync(m.act, m.hash);
}

function mpCompareSync(act, theirs) {
    if (theirs === window._mpActHashes[act]) return;
    console.error('[FMP] state hash mismatch at act', act);
    showNotification('The connection to the table slipped \u2014 the realm plays on.', 'error');
    game.players.forEach(p => { p._remoteHuman = false; });
    FMP.leaveGame();
}

// ─── GAME SCREEN ───────────────────────────────────────────

// ─── SKILL GROUP MAPPING FOR CARD STACKS ─────────────────

// True on phones/short viewports in landscape, where the left panels flow
// in a flex rail (.left-rail) instead of the desktop JS-pinned absolute stack.
function isCompactLandscape() {
    return window.matchMedia('(orientation: landscape) and (max-height: 540px)').matches;
}

// Re-render on rotate/resize so left-rail panels re-flow or re-pin correctly.
let _reflowTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(_reflowTimer);
    _reflowTimer = setTimeout(() => {
        if (typeof game !== 'undefined' && game) renderGameState();
    }, 120);
});

// Card families — the color language of the physical game ("wisdom cards,
// weapon cards, endeavor cards..."). Played cards stack by family, and the
// label chip wears the family color. The order is the rulebook's own IDEAL
// CARD PLACEMENT strip (p.11): Adventures → Artifacts → Weapons → Wisdom →
// Endeavors → Potions.
//
// ⚠ Two of these colors were WRONG until 7/19 and it hid a data bug for
// months: wisdom was painted blue and endeavor gold, when wisdom is magenta,
// endeavor is blue, and gold belongs to mission letters. So Wyatt reporting
// "Forbidden Lab — not an artifact (blue)" described a card the UI had no
// blue family for, and "pink/magenta" named a color with no entry at all.
// Hexes are lightened from the print spot-colors for legibility on the dark
// table; the authoritative frame values live in data/cards.js's header.
const TYPE_GROUPS = {
    adventure:      { label: 'Adventures', order: 0, color: '#3f8657' },
    artifact:       { label: 'Artifacts',  order: 1, color: '#8a5fa8' },
    weapon:         { label: 'Weapons',    order: 2, color: '#8d979f' },
    wisdom:         { label: 'Wisdom',     order: 3, color: '#b0568f' },
    endeavor:       { label: 'Endeavors',  order: 4, color: '#3f6fa8' },
    potion:         { label: 'Potions',    order: 5, color: '#8fae3c' },
    mission_letter: { label: 'Letters',    order: 6, color: '#b58a3f' },
};
function getCardTypeGroup(card) {
    return TYPE_GROUPS[card.type] ? card.type : 'misc';
}

// ─── GAME SCREEN ───────────────────────────────────────────

function showGameScreen() {
    document.getElementById('game-screen').classList.add('active');
    renderGameState();
}

function renderGameState() {
    if (!game) return;

    const state = game.getState(0);

    // The door out rides solo tables only — a multiplayer seat is a
    // commitment to real people (the AFK flow handles vanishing).
    const lv = document.getElementById('gameLeave');
    if (lv) lv.style.display = mpActive() ? 'none' : '';

    renderPhaseBar(state);
    renderBoardThumb(state);
    renderStatsPanel(state);
    renderMissionStrip(state);
    renderCardStacks(state);
    renderSidebar(state);
    renderHand(state);
    renderThrownZone();
    renderBottomStats(state);
    renderTableView(state);

    // The journal reads live sections — keep it honest if it's up while
    // state moves (e.g. a Turn In from the browser layered above it).
    if (missionJournalOpen()) renderMissionJournal();

    // Neighbor-read marks survive the innerHTML rebuilds above.
    applyTargetHighlights();
}

function formatPhase(phase) {
    const names = {
        'setup': 'Setting Up...',
        'gameplay': 'Throw Phase — Throw a Card In',
        'activate': 'The Reveal — In Turn Order',
        'missions': 'Missions Phase',
        'melee': 'Melee Phase',
        'scoring': 'Final Scoring',
        'game_over': 'Game Over'
    };
    return names[phase] || phase;
}

// ── Phase Bar ──

// Short phase names for the compact table view's top-left pill.
function formatPhaseShort(phase) {
    const names = {
        'setup': 'Setup',
        'gameplay': 'Throw',
        'activate': 'Reveal',
        'missions': 'Missions',
        'melee': 'Melee',
        'scoring': 'Scoring',
        'game_over': 'Game Over'
    };
    return names[phase] || phase;
}

function renderPhaseBar(state) {
    const bar = document.getElementById('phaseBar');
    const acts = ['I', 'II', 'III'];
    const compact = isCompactLandscape();
    // #table-view is a stacking context (z:1), so a screen-level sibling pill
    // can only sit entirely above or below the WHOLE table — it could never
    // interleave (above the board, below a bloomed hand card). While compact,
    // the pill lives INSIDE the table view and joins its ladder at z:6:
    // above stage/board/rails, below hand strip (45) / bloom (60) / drag (70).
    // position:fixed keeps it viewport-placed; overflow:hidden can't clip it.
    const home = compact
        ? document.getElementById('table-view')
        : document.getElementById('game-screen');
    if (bar.parentElement !== home) {
        if (compact) home.appendChild(bar);
        else home.insertBefore(bar, home.querySelector('.game-layout'));
    }
    // Throw + Reveal carry no words (Wyatt 7/17) — face-down cards and
    // the Emblem flare ARE the phase indicator; the pill returns for
    // Missions / Melee / Scoring where a label earns its place.
    const quiet = state.phase === 'gameplay' || state.phase === 'activate';
    bar.style.display = quiet ? 'none' : '';
    if (quiet) { bar.innerHTML = ''; return; }
    const phaseText = compact ? formatPhaseShort(state.phase) : formatPhase(state.phase);
    bar.innerHTML = `
        <span class="act-tag">Act ${acts[state.currentAct - 1] || state.currentAct}</span>
        <span class="phase-text">${phaseText}</span>
    `;
}

// ── Board Thumbnail ──

// YOUR hero as the table resolved it — the seat's per-player view (which
// carries Side B's art and slots), falling back to the base roster object
// before a table exists. A raw by-id find() here silently renders Side A
// on every Side B game (the exact straggler the spec told us to audit).
function myCharView() {
    if (typeof game !== 'undefined' && game && game.players && game.players[0]
        && game.players[0].character) return game.players[0].character;
    return window.FAVOR_DATA.characters.find(c => c.id === selectedCharacter);
}

function renderBoardThumb(state) {
    const el = document.getElementById('boardThumb');
    const char = myCharView();
    if (!char) return;

    // The ring rides the thumb at the same %-based track the big overlay
    // uses (BOARD_OV_TRACK), so the mini board always shows where you are.
    // Rebuilt on every renderGameState, so slides stay in sync.
    const cur = (typeof game !== 'undefined' && game && game.players[0])
        ? game.players[0].sliderPosition : 2;
    // The plate is YOUR seat's identity: chosen crest + royal name (the
    // hero is the art right above). Falls back to the hero's name when
    // no royal name is set yet.
    const crest = (window.FLB && typeof FLB.myAvatar === 'function' && FLB.myAvatar())
        ? FLB.avatarDisc(FLB.myAvatar(), 'thumb-crest') : '';
    el.innerHTML = `
        <div class="thumb-boardwrap">
            <img src="assets/characters/${char.filename}" alt="${char.name}">
            <img class="thumb-ring" src="assets/ui/slider-ring.png" alt=""
                 style="left:${BOARD_OV_TRACK.lefts[cur]}%; top:${BOARD_OV_TRACK.top}%">
        </div>
        <div class="thumb-footer">
            <span class="thumb-name">${crest}${localStorage.getItem('favorName') || char.name}</span>
            <span class="thumb-hint">View board</span>
        </div>
    `;
    el.onclick = () => openBoardOverlay();
}

// ── Stats Panel ──

// Skill icons — real images cropped from rulebook Symbols page
const SKILL_ICONS = {
    survival:    `<img class="skill-svg" src="assets/icons/survival.png" alt="Survival">`,
    charisma:    `<img class="skill-svg" src="assets/icons/charisma.png" alt="Charisma">`,
    alchemy:     `<img class="skill-svg" src="assets/icons/alchemy.png" alt="Alchemy">`,
    prospecting: `<img class="skill-svg" src="assets/icons/prospecting.png" alt="Prospecting">`,
    knowledge:   `<img class="skill-svg" src="assets/icons/knowledge.png" alt="Knowledge">`,
    power:       `<img class="skill-svg" src="assets/icons/power.png" alt="Power">`,
    philosopher: `<img class="skill-svg" src="assets/icons/philosopher.png" alt="Philosopher's Stone">`,
    minds_eye:   `<img class="skill-svg" src="assets/icons/minds_eye.png" alt="Mind's Eye">`
};

// The juicy panel body -- token totem + summed skills -- for ANY player.
// Your left-rail panel and the rival inspect overlay's desktop panel both
// read from here, so a rival's spread displays exactly like your own.
function buildStatsPanelHtml(playerIndex, state) {
    const player = state.players[playerIndex];
    const gp = game.players[playerIndex];
    const emblem = state.emblemHolder === playerIndex ? `<div class="emblem-tag">${emblemBadge()} Emblem Holder</div>` : '';

    // Resource tokens row
    const resourcesHtml = `
        <div class="resource-tokens">
            <span class="resource-token gold-token" data-stat="gold">
                <img src="assets/tokens/Copy of Tokens_Design_v1_Gold_1_v1.jpg" alt="Gold" class="token-img">
                <span class="token-val gold-val">${player.gold}</span>
            </span>
            <span class="resource-token prestige-token" data-stat="prestige">
                <img src="assets/tokens/Copy of Tokens_Design_v1_Prestige_1_v1.jpg" alt="Prestige" class="token-img">
                <span class="token-val prestige-val">${player.prestige}</span>
            </span>
            <span class="resource-token favor-token" data-stat="favor" title="Favor — the points that win the throne">
                <img src="${PURSE_ICONS.favor}" alt="Favor" class="token-img">
                <span class="token-val favor-val">${player.favorHeld ?? player.favor ?? 0}</span>
            </span>
            <span class="resource-token scorn-token" data-stat="scorn">
                <img src="assets/tokens/Copy of Tokens_Design_v1_Scorn_1_v1.jpg" alt="Scorn" class="token-img">
                <span class="token-val scorn-val">${player.scorn}</span>
            </span>
        </div>
    `;

    // Skills grid
    const skills = player.skills || {};
    const skillEntries = [
        { key: 'survival',    label: 'Survival',    icon: SKILL_ICONS.survival },
        { key: 'charisma',    label: 'Charisma',    icon: SKILL_ICONS.charisma },
        { key: 'alchemy',     label: 'Alchemy',     icon: SKILL_ICONS.alchemy },
        { key: 'prospecting', label: 'Prospecting', icon: SKILL_ICONS.prospecting },
        { key: 'knowledge',   label: 'Knowledge',   icon: SKILL_ICONS.knowledge },
        { key: 'power',       label: 'Power',       icon: SKILL_ICONS.power },
    ];

    let skillsHtml = '<div class="skills-grid">';
    skillEntries.forEach(s => {
        const val = skills[s.key] || 0;
        skillsHtml += `
            <div class="skill-row" data-stat="${s.key}">
                <span class="skill-icon">${s.icon}</span>
                <span class="skill-label">${s.label}</span>
                <span class="skill-value${val > 0 ? ' has-skill' : ''}">${val}</span>
            </div>`;
    });

    // Flex skills (Mining Guild etc.): one unit, EITHER option per use --
    // shown as their own rows so the fixed totals above never wander.
    const flexPairs = {};
    (player.flexSkills || []).forEach(pair => {
        const key = pair.join('|');
        flexPairs[key] = (flexPairs[key] || 0) + 1;
    });
    Object.entries(flexPairs).forEach(([key, n]) => {
        const [a, b] = key.split('|');
        const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
        skillsHtml += `
            <div class="skill-row flex-skill" title="Counts as ${cap(a)} OR ${cap(b)} -- one per use, never both">
                <span class="skill-icon flex-pair">${SKILL_ICONS[a]}${SKILL_ICONS[b]}</span>
                <span class="skill-label">${cap(a)} <i>or</i> ${cap(b)}</span>
                <span class="skill-value has-skill">${n > 1 ? '×' + n : '✦'}</span>
            </div>`;
    });

    // Special abilities: Philosopher's Stone & Mind's Eye -- the engine
    // count (cards + slot + mission rewards), shown as the digit it is.
    const hasPhilosopher = gp.philosopherStone && gp.philosopherStone > 0;
    const mindsEyeCount = game.getMindsEyeCount(playerIndex);

    if (hasPhilosopher) {
        skillsHtml += `
            <div class="skill-row special-ability" title="Philosopher's Stone — converts your Gold to Favor at game end (×${gp.philosopherStone} per Gold)">
                <span class="skill-icon">${SKILL_ICONS.philosopher}</span>
                <span class="skill-label phil-label">Philosopher's Stone</span>
                <span class="skill-value has-skill">${gp.philosopherStone}</span>
            </div>`;
    }
    if (mindsEyeCount > 0) {
        skillsHtml += `
            <div class="skill-row special-ability" title="Mind's Eye — already counted in Knowledge">
                <span class="skill-icon">${SKILL_ICONS.minds_eye}</span>
                <span class="skill-label">Mind's Eye</span>
                <span class="skill-value has-skill">${mindsEyeCount}</span>
            </div>`;
    }
    skillsHtml += '</div>';

    return `${resourcesHtml}${skillsHtml}${emblem}`;
}

// The same variables in the phone HUD's chip language -- purse first
// (the overlay is the only place a rival's full purse shows on phones),
// then the six skills, flex pairs, specials, and the Emblem. Tap a chip
// for its name, exactly like your own rail.
function buildStatChipsHtml(playerIndex, state) {
    const p = state.players[playerIndex];
    const gp = game.players[playerIndex];
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const purse = (k, img, val, label) =>
        `<span class="tv-purse-chip ${k}" onclick="tvChipTip(event, '${label}')">
            <img src="${img}" alt="${label}"><b>${val}</b></span>`;

    let h = purse('gold', PURSE_ICONS.gold, p.gold, 'Gold')
          + purse('prestige', TOKEN_IMG.prestige, p.prestige, 'Prestige')
          + purse('favor', PURSE_ICONS.favor, p.favorHeld ?? p.favor ?? 0, 'Favor')
          + purse('scorn', PURSE_ICONS.scorn, p.scorn, 'Scorn');

    const skills = p.skills || {};
    ['survival', 'charisma', 'alchemy', 'prospecting', 'knowledge', 'power'].forEach(k => {
        const val = skills[k] || 0;
        h += `<span class="tv-skill-chip${val > 0 ? '' : ' zero'}"
                    onclick="tvChipTip(event, '${cap(k)}')">${SKILL_ICONS[k]}<b>${val}</b></span>`;
    });

    const flexPairs = {};
    (p.flexSkills || []).forEach(pair => {
        const key = pair.join('|');
        flexPairs[key] = (flexPairs[key] || 0) + 1;
    });
    Object.entries(flexPairs).forEach(([key, n]) => {
        const [a, b] = key.split('|');
        h += `<span class="tv-skill-chip flex"
                    onclick="tvChipTip(event, '${cap(a)} or ${cap(b)} — one per use, never both')">
                    <span class="flex-pair">${SKILL_ICONS[a]}${SKILL_ICONS[b]}</span><b>${n > 1 ? '×' + n : '✦'}</b></span>`;
    });

    if (gp.philosopherStone && gp.philosopherStone > 0) {
        h += `<span class="tv-skill-chip special"
                    onclick="tvChipTip(event, 'Philosopher\\'s Stone ×${gp.philosopherStone} — converts Gold to Favor at game end')">
                    ${SKILL_ICONS.philosopher}<b>${gp.philosopherStone}</b></span>`;
    }
    const mindsEye = game.getMindsEyeCount(playerIndex);
    if (mindsEye > 0) {
        h += `<span class="tv-skill-chip special"
                    onclick="tvChipTip(event, 'Mind\\'s Eye — already counted in Knowledge')">
                    ${SKILL_ICONS.minds_eye}<b>${mindsEye}</b></span>`;
    }
    if (state.emblemHolder === playerIndex) {
        h += `<span class="tv-purse-chip emblem" onclick="tvChipTip(event, 'Emblem Holder')">
                <img src="${EMBLEM_IMG}" alt="Emblem Holder"><b>Emblem</b></span>`;
    }
    return h;
}

function renderStatsPanel(state) {
    const panel = document.getElementById('statsPanel');
    // No act badge (the phase pill says it) and no ring-dot row (the board
    // thumb above wears the ring ON the art) -- the panel is tokens + skills.
    // (Your crest + royal name live on the board thumb's plate — adding a
    // row HERE broke the panel's hard-won no-scroll fit.)
    panel.innerHTML = buildStatsPanelHtml(0, state);

    // Position dynamically after board thumb loads (desktop only -- in compact
    // landscape the .left-rail flex flow handles stacking, so clear inline top).
    if (isCompactLandscape()) {
        panel.style.top = '';
    } else {
        requestAnimationFrame(() => {
            if (isCompactLandscape()) { panel.style.top = ''; return; }
            const thumb = document.getElementById('boardThumb');
            if (thumb && thumb.offsetHeight > 20) {
                panel.style.top = (thumb.offsetTop + thumb.offsetHeight + 6) + 'px';
            }
        });
    }
}

// ── Mission Strip ──

function renderMissionStrip(state) {
    const strip = document.getElementById('missionStrip');
    const missions = game.players[0].missions || [];
    const completedMissions = game.players[0].completedMissions || [];
    const allAcquired = [...missions, ...completedMissions];

    // ONE at-a-glance row: your missions first (gold ring / green when
    // complete), then the realm's available ones (dim). The pip borders
    // carry the grouping — separate labeled sections cost too much height
    // next to the juicy stats panel on 800px-tall screens.
    let pips = '';
    allAcquired.forEach(m => {
        const isComplete = completedMissions.includes(m);
        pips += `<img class="mission-pip${isComplete ? ' completed' : ' active'}"
                    src="assets/cards/missions/${m.filename}"
                    alt="${m.name}"
                    onclick="openMissionBrowser('mine', '${m.name.replace(/'/g, "\\'")}')">`;
    });
    (state.visibleMissions || []).forEach(m => {
        pips += `<img class="mission-pip available"
                    src="assets/cards/missions/${m.filename}"
                    alt="${m.name}"
                    onclick="openMissionBrowser('realm', '${m.name.replace(/'/g, "\\'")}')">`;
    });

    const head = `
        <div class="mission-strip-head">
            <span class="strip-label">Missions</span>
            <button class="mj-open" onclick="event.stopPropagation(); openMissionJournal()">Journal</button>
        </div>`;
    strip.innerHTML = pips
        ? `<div class="mission-section">
               ${head}
               <div class="mission-pips">${pips}</div>
           </div>`
        : `<div class="mission-section">${head}
           <span class="strip-label" style="opacity:0.5">None yet</span></div>`;

    // Position below stats panel (desktop only — compact landscape uses flex flow)
    if (isCompactLandscape()) {
        strip.style.top = '';
        strip.style.maxHeight = '';
        strip.style.overflowY = '';
    } else {
        requestAnimationFrame(() => {
            if (isCompactLandscape()) { strip.style.top = ''; return; }
            const statsPanel = document.getElementById('statsPanel');
            if (statsPanel && statsPanel.offsetHeight > 10) {
                const top = statsPanel.offsetTop + statsPanel.offsetHeight + 6;
                strip.style.top = top + 'px';
                // The juicy stats panel is tall now — never let the strip
                // run off the bottom; it scrolls inside itself instead.
                strip.style.maxHeight = Math.max(40, window.innerHeight - top - 12) + 'px';
                strip.style.overflowY = 'auto';
            }
        });
    }
}

// ── Card Stacks (played cards grouped by skill) ──

function renderCardStacks(state) {
    const el = document.getElementById('cardStacks');
    const player = state.players[0];

    if (!player.playedCards || player.playedCards.length === 0) {
        el.innerHTML = '<div class="no-cards-msg">No cards played yet</div>';
        return;
    }

    // Group cards by family — the card's color, the physical game's language
    const groups = {};
    player.playedCards.forEach(card => {
        const group = getCardTypeGroup(card);
        if (!groups[group]) groups[group] = [];
        groups[group].push(card);
    });

    // Sort groups by defined order
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        const oa = TYPE_GROUPS[a] ? TYPE_GROUPS[a].order : 99;
        const ob = TYPE_GROUPS[b] ? TYPE_GROUPS[b].order : 99;
        return oa - ob;
    });

    let html = '';
    sortedKeys.forEach(key => {
        const g = TYPE_GROUPS[key];
        const label = g ? g.label : 'Other';
        const cards = groups[key];

        html += `<div class="card-stack"${g ? ` style="--typeC:${g.color}"` : ''}>`;
        html += `<div class="stack-label">${label}</div>`;
        cards.forEach(card => {
            const doubled = card._favorDoubled ? ' doubled' : '';
            const doubledTip = card._favorDoubled ? ` — Chemical Y: worth ${card.favor * 2} Favor (×2)` : '';
            html += `<img class="stack-card${doubled}" src="assets/cards/regular/${card.filename}"
                        alt="${card.name}" title="${card.name}${doubledTip}"
                        onclick="zoomCard('assets/cards/regular/${card.filename}')">`;
        });
        html += '</div>';
    });

    el.innerHTML = html;
}

// ── Sidebar (Opponents) ──

function renderSidebar(state) {
    const sidebar = document.getElementById('gameSidebar');
    let html = '<div class="sidebar-header">Opponents</div>';

    // Quiet entries: portrait, name, emblem, gold (real coin art) and the
    // recent-cards fan. Ring position / favor / scorn / prestige live
    // behind the click \u2014 the overlay shows their whole spread.
    state.players.forEach((p, i) => {
        if (i === 0) return;

        const isActive = state.activePlayerIndex === i;
        const emblem = state.emblemHolder === i ? ' ' + emblemBadge() : '';
        const char = game.players[i].character;
        const avatarSrc = char ? `assets/characters/${char.filename}` : '';
        // A real human across the wire wears THEIR chosen crest by the name.
        const crest = (game.players[i]._mpAvatar && window.FLB)
            ? FLB.avatarDisc(game.players[i]._mpAvatar, 'opp-crest') : '';

        // A thrown-but-unrevealed card sits face down by their portrait —
        // exactly what the physical table shows during the throw phase.
        const thrown = seatHasThrown(i)
            ? `<img class="opp-thrown${_thrownLandClass(i)}" src="${CARD_BACK_IMG}" alt="Face-down card" title="Card thrown — face down">`
            : '';

        html += `
            <div class="opp-entry${isActive ? ' active-turn' : ''}" data-pi="${i}"
                 onclick="openOppOverlay(${i})">
                <img class="opp-avatar" src="${avatarSrc}">
                <div class="opp-details">
                    <span class="opp-name">${crest}${p.name}${emblem}</span>
                    <div class="opp-gold-row">
                        <img src="${PURSE_ICONS.gold}" alt="Gold"><b>${p.gold}</b>
                    </div>
                    <div class="mini-stack">
                        ${p.playedCards.slice(-5).map(c =>
                            `<img class="mini-card" src="assets/cards/regular/${c.filename}" alt="${c.name}">`
                        ).join('')}
                    </div>
                </div>
                ${thrown}
            </div>
        `;
    });

    sidebar.innerHTML = html;
}

// ── Hand ──

function renderHand(state) {
    const zone = document.getElementById('handZone');
    const hand = state.players[0].hand;

    if (!hand || hand.length === 0) {
        if (game.phase === 'gameplay') {
            zone.innerHTML = '<div class="hand-waiting">Waiting for next phase...</div>';
        } else {
            zone.innerHTML = '';
        }
        return;
    }

    // Fan rotation per card
    const count = hand.length;
    const maxAngle = Math.min(count * 3, 14);
    const step = count > 1 ? (maxAngle * 2) / (count - 1) : 0;
    const startAngle = -maxAngle;

    // During the reveal, the hand you were just passed sits FACE DOWN —
    // physically you don't pick it up until everyone has activated, and
    // showing its faces next to your reveal chooser reads as one muddled
    // hand. Backs only, no interactions.
    if (game.phase === 'activate') {
        let fd = '<div class="hand-hint">Your next hand — dealt after the reveal</div>';
        fd += '<div class="hand-arc awaiting">';
        hand.forEach((card, i) => {
            const angle = startAngle + step * i;
            const lift = -Math.abs(angle) * 0.4;
            fd += `<div class="hand-card facedown"
                        style="transform: rotate(${angle}deg) translateY(${lift}px)">
                        <img src="${CARD_BACK_IMG}" alt="Face-down card">
                    </div>`;
        });
        fd += '</div>';
        zone.innerHTML = fd;
        return;
    }

    let html = '<div class="hand-hint" onclick="event.stopPropagation(); openHandInspect()">Click to inspect hand</div>';
    html += '<div class="hand-arc">';

    hand.forEach((card, i) => {
        const angle = startAngle + step * i;
        const lift = -Math.abs(angle) * 0.4;

        html += `<div class="hand-card"
                    style="transform: rotate(${angle}deg) translateY(${lift}px)"
                    data-hand-i="${i}"
                    ondblclick="zoomCard('assets/cards/regular/${card.filename}')">
                    <img src="assets/cards/regular/${card.filename}" alt="${card.name}">
                </div>`;
    });

    html += '</div>';
    zone.innerHTML = html;
    requestAnimationFrame(_tvBloomLayout);
}

// ── Bottom Stats (hidden, for stat animation system) ──

function renderBottomStats(state) {
    const bar = document.getElementById('bottomStats');
    const player = state.players[0];
    bar.innerHTML = `
        <div class="stat gold">${player.gold}</div>
        <div class="stat prestige">${player.prestige}</div>
        <div class="stat scorn">${player.scorn}</div>
        <div class="stat favor">${player.favorHeld ?? player.favor}</div>
    `;
}

// ═══ TABLE VIEW (phone landscape) ═══════════════════════════
// A shared-table layout: each player is a "mat" (board + tokens on the
// board + played cards tucked underneath), arranged around a center
// missions area. Desktop is untouched (#table-view is display:none there).

// ═══ WINGSPAN HUD ZONES (phone landscape) ═══════════════════
// Every zone glanceable at once — no drawers. All CSS lives inside the
// compact-landscape media query; desktop .game-layout is untouched.

// Tap a HUD chip → a transient name label (phones have no hover).
function tvChipTip(e, label) {
    if (e) e.stopPropagation();
    const old = document.getElementById('tvChipTip');
    if (old) old.remove();
    const target = e && (e.currentTarget || e.target);
    if (!target || !target.getBoundingClientRect) return;
    const r = target.getBoundingClientRect();
    const tip = document.createElement('div');
    tip.id = 'tvChipTip';
    tip.textContent = label;
    document.body.appendChild(tip);
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(6, Math.min(r.right + 8, window.innerWidth - w - 6)) + 'px';
    tip.style.top = Math.max(6, Math.min(r.top + r.height / 2 - h / 2, window.innerHeight - h - 6)) + 'px';
    setTimeout(() => { tip.classList.add('out'); setTimeout(() => tip.remove(), 260); }, 1300);
}

// ── Z1 · Purse — your four currencies, top-left ──
const PURSE_ICONS = {
    gold:  'assets/icons/gold.png',
    favor: 'assets/icons/favor.png',
    scorn: 'assets/icons/scorn.png',
};

// The physical game's Emblem marker — used wherever "emblem holder" shows.
const EMBLEM_IMG = 'assets/tokens/Copy of Emblem.jpg';
const emblemBadge = (title = 'Emblem Holder') =>
    `<img class="emblem-badge" src="${EMBLEM_IMG}" alt="${title}" title="${title}">`;

// Stat pills in the game's own visual language — real token art, never
// emoji (a gray unicode coin reads as somebody else's game).
function statPillsHtml(ps) {
    return `
        <span class="stat-pill gold"><img class="pill-icon" src="${PURSE_ICONS.gold}" alt="Gold"> ${ps.gold}</span>
        <span class="stat-pill prestige"><img class="pill-icon" src="${TOKEN_IMG.prestige}" alt="Prestige"> ${ps.prestige}</span>
        <span class="stat-pill favor"><img class="pill-icon" src="${PURSE_ICONS.favor}" alt="Favor"> ${ps.favorHeld ?? ps.favor ?? 0} Favor</span>
        <span class="stat-pill scorn"><img class="pill-icon" src="${PURSE_ICONS.scorn}" alt="Scorn"> ${ps.scorn} Scorn</span>
    `;
}

function renderTvPurse(state) {
    const el = document.getElementById('tvPurse');
    if (!el) return;
    const p = state.players[0];
    const chip = (k, img, val, label) =>
        `<span class="tv-purse-chip ${k}" data-stat="${k}" onclick="tvChipTip(event, '${label}')">
            <img src="${img}" alt="${label}"><b>${val}</b></span>`;
    // 2×2 reading order (Wyatt's 7/7 call): gold · prestige on top,
    // favor · scorn beneath.
    el.innerHTML =
        chip('gold', PURSE_ICONS.gold, p.gold, 'Gold')
      + chip('prestige', TOKEN_IMG.prestige, p.prestige, 'Prestige')
      + chip('favor', PURSE_ICONS.favor, p.favorHeld ?? p.favor ?? 0, 'Favor')
      + chip('scorn', PURSE_ICONS.scorn, p.scorn, 'Scorn');
}

// ── Z2 · Skill rail — always-visible icon+number chips, left edge.
// Same data logic as the old skills drawer: six fixed skills (dim at 0),
// flex-skill pairs as dashed ✦ chips, then Mind's Eye / Philosopher's
// Stone only when owned. Icon + number only; tap a chip for its name.
function renderTvSkills(state) {
    const el = document.getElementById('tvSkills');
    if (!el) return;
    const player = state.players[0];
    const gp = game.players[0];
    const skills = player.skills || {};
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    let h = '', rows = 0;

    ['survival', 'charisma', 'alchemy', 'prospecting', 'knowledge', 'power'].forEach(k => {
        const val = skills[k] || 0;
        h += `<span class="tv-skill-chip${val > 0 ? '' : ' zero'}" data-stat="${k}"
                    onclick="tvChipTip(event, '${cap(k)}')">${SKILL_ICONS[k]}<b>${val}</b></span>`;
        rows++;
    });

    const flexPairs = {};
    (player.flexSkills || []).forEach(pair => {
        const key = pair.join('|');
        flexPairs[key] = (flexPairs[key] || 0) + 1;
    });
    Object.entries(flexPairs).forEach(([key, n]) => {
        const [a, b] = key.split('|');
        // BOTH faces of the either/or pair — a lone icon read as a
        // duplicate of the fixed-skill chip above it (Wyatt, 7/7).
        h += `<span class="tv-skill-chip flex"
                    onclick="tvChipTip(event, '${cap(a)} or ${cap(b)} — one per use, never both')">
                    <span class="flex-pair">${SKILL_ICONS[a]}${SKILL_ICONS[b]}</span><b>${n > 1 ? '×' + n : '✦'}</b></span>`;
        rows++;
    });

    const hasPhil = gp.philosopherStone && gp.philosopherStone > 0;
    // Engine count (cards + slot + mission rewards) — the digit Wyatt
    // asked for; the old ✓ also missed slot-granted Mind's Eyes entirely.
    const mindsEye = game.getMindsEyeCount(0);
    if (hasPhil) {
        h += `<span class="tv-skill-chip special"
                    onclick="tvChipTip(event, 'Philosopher\\'s Stone ×${gp.philosopherStone} — converts Gold to Favor at game end')">
                    ${SKILL_ICONS.philosopher}<b>${gp.philosopherStone}</b></span>`;
        rows++;
    }
    if (mindsEye > 0) {
        h += `<span class="tv-skill-chip special"
                    onclick="tvChipTip(event, 'Mind\\'s Eye — already counted in Knowledge')">
                    ${SKILL_ICONS.minds_eye}<b>${mindsEye}</b></span>`;
        rows++;
    }

    // Two-column grid: --railRows counts GRID ROWS (chips packed two per
    // row) so the fit-to-height chip formula sees the real column length.
    el.style.setProperty('--railRows', Math.max(3, Math.ceil(rows / 2)));
    el.innerHTML = h;
}

// ── Z3 · Seat chips — one compact portrait per player, YOU first.
// CRITICAL: every chip keeps .pmat + data-pi — tvAnimateDeltas /
// tvDropToken / tvAnimateNewCard and the coach-marks all target
// #table-view .pmat[data-pi] (tvMatEl).
function buildSeatChip(i, state) {
    const p = state.players[i];
    const char = game.players[i] ? game.players[i].character : null;
    const artSrc = char ? `assets/characters/${char.filename}` : '';
    const isActive = state.activePlayerIndex === i;
    const isYou = i === 0;
    const crown = state.emblemHolder === i ? `<span class="chip-crown">${emblemBadge()}</span>` : '';
    const youTag = isYou ? '<span class="chip-you">YOU</span>' : '';
    const cardCount = (p.playedCards || []).length;
    const open = isYou ? 'openBoardOverlay()' : `openOppOverlay(${i})`;
    // Their face-down throw rides the chip until it's revealed in turn.
    const thrown = seatHasThrown(i)
        ? `<img class="chip-thrown${_thrownLandClass(i)}" src="${CARD_BACK_IMG}" alt="" title="Card thrown — face down">`
        : '';
    return `
        <div class="pmat ${isYou ? 'you' : 'opp'} seat-chip${isActive ? ' active' : ''}" data-pi="${i}"
             onclick="event.stopPropagation(); ${open}" title="${p.name}">
            <img class="chip-art" src="${artSrc}" alt="${p.name}">
            ${crown}${youTag}${thrown}
            <span class="chip-count" title="Cards played">${cardCount}</span>
        </div>`;
}

// ── Z4 · Mission rail — Missions of the Realm + the My Missions chip ──
function renderTvMissionRail(state) {
    const el = document.getElementById('tvMissionRail');
    if (!el) return;
    const ms = state.visibleMissions || [];
    let h = '';
    ms.forEach(m => {
        h += `<img class="tv-mission" src="assets/cards/missions/${m.filename}"
                   alt="${m.name}" data-peek="assets/cards/missions/${m.filename}"
                   onclick="event.stopPropagation(); openMissionBrowser('realm', '${m.name.replace(/'/g, "\\'")}')">`;
    });
    for (let g = ms.length; g < 3; g++) h += '<span class="tv-mission ghost"></span>';

    // Journal button — replaces the old ● ✓ ✕ tally chip. Count = current
    // missions only; the ledger inside holds the rest.
    const cur = (game.players[0].missions || []).length;
    h += `<button class="tv-mym" title="Mission Journal"
                  onclick="event.stopPropagation(); openMissionJournal()">
            <img class="mym-icon" src="assets/icons/mission.png" alt="">
            <span class="mym-label">Missions</span>
            <b class="mym-count">${cur}</b>
          </button>`;
    el.innerHTML = h;
}

// ── Z5 · Your board, small — the ring rides BOARD_OV_TRACK exactly like
// the big overlay, so the mini board always shows where you stand. ──
function renderTvBoardThumb(state) {
    const el = document.getElementById('tvBoardThumb');
    if (!el) return;
    const char = myCharView();   // the SEAT's view — Side B art included
    if (!char) return;
    const cur = (game && game.players[0]) ? game.players[0].sliderPosition : 2;
    el.innerHTML = `
        <img class="tv-thumb-board" src="assets/characters/${char.filename}" alt="${char.name}">
        <img class="thumb-ring" src="assets/ui/slider-ring.png" alt=""
             style="left:${BOARD_OV_TRACK.lefts[cur]}%; top:${BOARD_OV_TRACK.top}%">`;
    el.onclick = () => openBoardOverlay();
}

// Tucked family stacks — shared by the center stage (your cards)
// and the rival overlay (their cards read exactly like yours).
function buildSkillStacks(cards) {
    const groups = {};
    cards.forEach(c => {
        const g = getCardTypeGroup(c);
        (groups[g] = groups[g] || []).push(c);
    });
    const keys = Object.keys(groups).sort((x, y) =>
        (TYPE_GROUPS[x] ? TYPE_GROUPS[x].order : 99) - (TYPE_GROUPS[y] ? TYPE_GROUPS[y].order : 99));
    let h = '';
    keys.forEach(k => {
        const list = groups[k];
        // Tall stacks tighten their tuck so the zone never overflows.
        const peek = list.length > 5 ? Math.max(11, Math.floor(100 / (list.length - 1))) : 20;
        h += `<div class="tv-stack" style="--tvPeek:${peek}px">`;
        list.forEach(c => {
            h += `<img class="tv-stack-card${c._favorDoubled ? ' doubled' : ''}"
                       src="assets/cards/regular/${c.filename}" alt="${c.name}"
                       data-peek="assets/cards/regular/${c.filename}">`;
        });
        h += `<span class="tv-stack-label"${TYPE_GROUPS[k] ? ` style="--typeC:${TYPE_GROUPS[k].color}"` : ''}>${TYPE_GROUPS[k] ? TYPE_GROUPS[k].label : 'Other'}</span></div>`;
    });
    return h;
}

// ── Z6 · Center stage — YOUR played cards as tucked skill stacks.
// The stage is also where every focus moment lands (action panel,
// overlays, melee splash, #tvFx deltas) — those live above it.
function renderTvStage(state) {
    const el = document.getElementById('tvStage');
    if (!el) return;
    const cards = state.players[0].playedCards || [];
    el.innerHTML = cards.length
        ? buildSkillStacks(cards)
        : '<div class="tv-stage-empty">Cards you play gather here</div>';
}

// ── Popovers (gear menu / My Missions) — the action panel steps aside
// while one is up (#actionPanel is a ROOT child at z 9999 and would
// otherwise paint over it), then comes back on close. ──
let _tvPopover = null;
let _tvPanelAside = false;

function _tvPanelStepAside() {
    const panel = document.getElementById('actionPanel');
    if (panel && panel.classList.contains('active')) {
        panel.classList.remove('active');   // direct toggle — survives the _finalChoicePending guard
        _tvPanelAside = true;
    }
}
function _tvPanelRestore() {
    if (!_tvPanelAside) return;
    _tvPanelAside = false;
    const panel = document.getElementById('actionPanel');
    if (panel) panel.classList.add('active');
}

function closeTvPopover(restorePanel = true) {
    if (!_tvPopover) return;
    _tvPopover = null;
    const host = document.getElementById('tvPopoverHost');
    if (host) { host.classList.remove('active'); host.innerHTML = ''; }
    if (restorePanel) _tvPanelRestore();
    if (typeof coachTick === 'function') coachTick();
}

// ── Mission Journal — a royal ledger of where you stand: Current
// Missions (with their due act) and Completed. Failed missions are
// discarded in the fiction and do NOT appear (gp.failedMissions data
// stays intact for scoring/log). Cards are BIG scans; tapping one opens
// the mission browser focused on it (Turn In lives there).
function openMissionJournal() {
    if (!game) return;
    if (typeof coachMarkSeen === 'function') coachMarkSeen('missions');
    _tvPanelStepAside();   // root-level action panel would paint over the journal
    renderMissionJournal();
    document.getElementById('missionJournal').classList.add('active');
}

function renderMissionJournal() {
    const body = document.getElementById('mjBody');
    if (!body || !game) return;
    const gp = game.players[0];
    const esc = (s) => s.replace(/'/g, "\\'");
    const entry = (m, done) => `
        <div class="mj-card${done ? ' done' : ''}"
             onclick="event.stopPropagation(); openMissionBrowser('mine', '${esc(m.name)}')">
            <img src="assets/cards/missions/${m.filename}" alt="${m.name}"
                 data-peek="assets/cards/missions/${m.filename}" draggable="false">
            ${done ? '<div class="mj-ribbon">✓ Completed</div>'
                   : `<div class="mj-due">${mjDueNote(m)}</div>`}
        </div>`;
    const cur = (gp.missions || []).map(m => entry(m, false)).join('');
    const done = (gp.completedMissions || []).map(m => entry(m, true)).join('');
    body.innerHTML = `
        <div class="mj-section">
            <div class="mj-section-title">Current Missions</div>
            ${cur ? `<div class="mj-grid">${cur}</div>`
                  : '<div class="mj-empty">None yet — play a mission card to take one.</div>'}
        </div>
        <div class="mj-section">
            <div class="mj-section-title">Completed</div>
            ${done ? `<div class="mj-grid">${done}</div>`
                   : '<div class="mj-empty">The ledger awaits your first success.</div>'}
        </div>`;
}

function mjDueNote(m) {
    const due = game.missionDueAct(m);
    return due > game.currentAct ? `Due end of Act ${due}` : 'Due THIS act';
}

function closeMissionJournal() {
    const el = document.getElementById('missionJournal');
    if (el) el.classList.remove('active');
    setTimeout(_tvPanelRestore, 0);   // after this click's outside-click handler
}

function missionJournalOpen() {
    const el = document.getElementById('missionJournal');
    return !!el && el.classList.contains('active');
}

function renderTvHand(state) {
    const zone = document.getElementById('tvHand');
    if (!zone) return;
    const hand = state.players[0].hand;

    // Playable glow (Battlegrounds-style): while your throw is open, cards
    // you could play AS THINGS STAND get a soft green edge. The real check
    // happens at your reveal — earlier players' moves can shift it.
    const myTurn = state.phase === 'gameplay' && game.pendingActivations[0] === null;

    // "Your turn" pulse on the always-visible strip (replaces the old
    // auto-opening drawer as the turn signal).
    const strip = document.getElementById('tvHandStrip');
    if (strip) strip.classList.toggle('your-turn', myTurn && !!(hand && hand.length));

    if (!hand || hand.length === 0) {
        zone.innerHTML = game.phase === 'gameplay'
            ? '<div class="tv-hand-waiting">Waiting for next phase…</div>' : '';
        return;
    }

    const count = hand.length;
    const maxAngle = Math.min(count * 3, 12);
    const step = count > 1 ? (maxAngle * 2) / (count - 1) : 0;
    const startAngle = -maxAngle;

    // The reveal: your next hand waits face down (see renderHand).
    if (game.phase === 'activate') {
        let fd = '<div class="hand-arc awaiting">';
        hand.forEach((card, i) => {
            const angle = startAngle + step * i;
            const lift = -Math.abs(angle) * 0.4;
            fd += `<div class="hand-card facedown"
                        style="transform: rotate(${angle}deg) translateY(${lift}px)">
                        <img src="${CARD_BACK_IMG}" alt="Face-down card">
                    </div>`;
        });
        fd += '</div>';
        zone.innerHTML = fd;
        return;
    }

    let html = '<div class="hand-arc">';
    hand.forEach((card, i) => {
        const angle = startAngle + step * i;
        const lift = -Math.abs(angle) * 0.4;
        let playable = false;
        if (myTurn) {
            if (card.type === 'mission_letter') {
                playable = game.players[0].gold >= 1 && (state.visibleMissions || []).length > 0;
            } else {
                try { playable = game.checkRequirements(0, card).canPlay; } catch (e) { playable = false; }
            }
        }
        // No tap-to-select here: committing a card is the DRAG-UP gesture
        // (touch = bloom to read, drag up + release = the throw).
        html += `<div class="hand-card${playable ? ' playable' : ''}"
                    style="transform: rotate(${angle}deg) translateY(${lift}px)"
                    data-hand-i="${i}">
                    <img src="assets/cards/regular/${card.filename}" alt="${card.name}">
                </div>`;
    });
    html += '</div>';
    zone.innerHTML = html;
    requestAnimationFrame(_tvBloomLayout);
}

// Mission requirement abbreviations for the My Missions popover rows.
const SKILL_ABBR = { survival:'SUR', charisma:'CHA', alchemy:'ALC', prospecting:'PRO', knowledge:'KNO', power:'POW' };

// ═══ PHASE C — tabletop motion via per-player state diffing ═══
// No engine edits: each render we compare each player's tokens / played-card
// count / acquired missions against the last render and animate the deltas.
// FX elements go in #tvFx (never wiped by mat re-renders).

const TOKEN_IMG = {
    gold:     'assets/tokens/Copy of Tokens_Design_v1_Gold_1_v1.jpg',
    prestige: 'assets/tokens/Copy of Tokens_Design_v1_Prestige_1_v1.jpg',
    scorn:    'assets/tokens/Copy of Tokens_Design_v1_Scorn_1_v1.jpg'
};
let _tvGameRef = null;
let _tvPrev = {};

function tvMatEl(i) {
    return document.querySelector(`#table-view .pmat[data-pi="${i}"]`);
}

function tvDropToken(matEl, key, amount) {
    const fx = document.getElementById('tvFx');
    if (!fx || !matEl) return;
    const tokRow = matEl.querySelector('.pmat-tokens') || matEl;
    const r = tokRow.getBoundingClientRect();
    // Seat chips hug the top edge — the classic upward drop would start
    // off-screen, so top-edge targets get the mirrored downward drop.
    const below = r.top < 64;
    const el = document.createElement('div');
    el.className = `tv-token-drop ${key}${below ? ' below' : ''}`;
    const face = TOKEN_IMG[key]
        ? `<img src="${TOKEN_IMG[key]}" alt="">`
        : `<span class="tv-token-favor">★</span>`;
    el.innerHTML = `${face}<span class="tv-token-amt">+${amount}</span>`;
    el.style.left = `${r.left + r.width / 2}px`;
    el.style.top = below ? `${r.bottom}px` : `${r.top}px`;
    fx.appendChild(el);
    setTimeout(() => el.remove(), 1100 * window.CINEMATIC_SPEED);
}

// ── Stat float: a "+N" pops off the stat that just grew, rises and
// fades — the payoff beat for playing a card (Wyatt: "boom, +3 Charisma
// goes up"). Lives on document.body, NOT #tvFx: the panel re-render that
// triggers it must not wipe it, and #tvFx sits inside the phone table
// view, which desktop hides.
function statFloatFx(anchor, key, amount, idx) {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    if (!r.width && !r.height) return;   // anchor hidden (other layout's surface)
    // Escape the dense column: the float hangs in the open air just RIGHT
    // of the panel/rail, level with its stat — a rise that starts ON the
    // anchor drifts across the row above it and "+3" over the next row's
    // "2" reads as "+32" (caught in the audit shot).
    const rail = anchor.closest('.resource-tokens') || anchor.closest('#tvSkills')
        || anchor.closest('#statsPanel');
    const baseX = (rail ? rail.getBoundingClientRect().right : r.right) + 16;
    // Purse tokens share one row — fan simultaneous floats out sideways.
    const fan = anchor.closest('.resource-tokens') ? (idx || 0) * 34 : 0;
    const el = document.createElement('div');
    el.className = `stat-float${key === 'scorn' ? ' bad' : ''}`;
    el.textContent = `+${amount}`;
    el.style.left = `${baseX + fan}px`;
    el.style.top = `${r.top + r.height / 2}px`;
    el.style.animationDuration = `${1.55 * window.CINEMATIC_SPEED}s`;
    el.style.animationDelay = `${(idx || 0) * 130}ms`;
    document.body.appendChild(el);
    const life = 1750 * window.CINEMATIC_SPEED + (idx || 0) * 130;
    // The activation loop waits for this before the next spotlight takes
    // the stage — otherwise your "+N" payoff plays under the rival's turn.
    _statFloatUntil = Math.max(_statFloatUntil, Date.now() + life);
    setTimeout(() => el.remove(), life);
}

// When the newest stat float finishes (epoch ms); statFloatWait() pauses
// exactly that long and no longer, so back-to-back beats never double-wait.
let _statFloatUntil = 0;
function statFloatWait() {
    const ms = _statFloatUntil - Date.now();
    return ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
}

// Where a given stat lives on the CURRENT layout (your surfaces only).
function _statAnchor(key) {
    if (isCompactLandscape()) {
        return document.querySelector(`#tvSkills [data-stat="${key}"]`)
            || document.querySelector(`#tvPurse [data-stat="${key}"]`);
    }
    // Desktop: skill rows (float off the VALUE digit, not the wide row)
    // + token totem. Favor has no panel token — its float rises off the
    // token row so the gain still lands somewhere real.
    const row = document.querySelector(`#statsPanel [data-stat="${key}"]`);
    if (row) return row.querySelector('.skill-value') || row;
    return document.querySelector('#statsPanel .resource-tokens');
}

function tvAnimateNewCard(matEl, card) {
    const fx = document.getElementById('tvFx');
    if (!fx || !matEl || !card) return;
    const cardsEl = matEl.querySelector('.pmat-cards') || matEl;
    const r = cardsEl.getBoundingClientRect();
    const below = r.top < 64;   // chip rail: the card tucks in from below
    const img = document.createElement('img');
    img.className = `tv-card-drop${below ? ' below' : ''}`;
    img.src = `assets/cards/regular/${card.filename}`;
    img.style.left = `${r.left + r.width / 2}px`;
    img.style.top = below ? `${r.bottom}px` : `${r.top}px`;
    fx.appendChild(img);
    setTimeout(() => img.remove(), 850 * window.CINEMATIC_SPEED);
}

function tvMissionReveal(playerName, mission) {
    const fx = document.getElementById('tvFx');
    if (!fx || !mission) return;
    const el = document.createElement('div');
    el.className = 'tv-mission-reveal';
    el.innerHTML = `
        <div class="tv-mr-who">${playerName} takes a mission</div>
        <img class="tv-mr-card" src="assets/cards/missions/${mission.filename}" alt="${mission.name}">
        <div class="tv-mr-name">${mission.name}</div>`;
    fx.appendChild(el);
    setTimeout(() => el.classList.add('out'), 1400 * window.CINEMATIC_SPEED);
    setTimeout(() => el.remove(), 1900 * window.CINEMATIC_SPEED);
}

function tvAnimateDeltas(state) {
    if (game !== _tvGameRef) { _tvGameRef = game; _tvPrev = {}; } // new game → reset baseline
    const animate = isCompactLandscape();

    state.players.forEach((p, i) => {
        const acquired = (p.missions || []).concat(p.completedMissions || [], p.failedMissions || []);
        const curr = {
            gold: p.gold, prestige: p.prestige, scorn: p.scorn, favor: p.favor || 0,
            cardCount: (p.playedCards || []).length,
            missionNames: acquired.map(m => m.name)
        };
        if (i === 0) {
            const sk = p.skills || {};
            curr.skills = {};
            ['survival', 'charisma', 'alchemy', 'prospecting', 'knowledge', 'power']
                .forEach(k => { curr.skills[k] = sk[k] || 0; });
        }
        const prev = _tvPrev[i];

        // YOUR gains float as "+N" off the stat itself. Skills float on
        // both layouts; purse floats are desktop-only — the phone already
        // narrates those with tvDropToken on your seat chip below.
        if (prev && i === 0) {
            let n = 0;
            const bump = (key, d) => {
                if (d > 0) statFloatFx(_statAnchor(key), key, d, n++);
            };
            if (!animate) ['gold', 'prestige', 'scorn', 'favor'].forEach(k => bump(k, curr[k] - prev[k]));
            Object.keys(curr.skills).forEach(k => bump(k, curr.skills[k] - ((prev.skills || {})[k] || 0)));
        }

        if (prev && animate) {
            const matEl = tvMatEl(i);
            if (matEl) {
                ['gold', 'prestige', 'scorn', 'favor'].forEach(k => {
                    if (curr[k] > prev[k]) tvDropToken(matEl, k, curr[k] - prev[k]);
                });
                if (curr.cardCount > prev.cardCount) {
                    const newest = (p.playedCards || [])[p.playedCards.length - 1];
                    tvAnimateNewCard(matEl, newest);
                }
            }
            const fresh = curr.missionNames.filter(n => !prev.missionNames.includes(n));
            fresh.forEach(name => {
                const m = acquired.find(x => x.name === name);
                if (m) tvMissionReveal(i === 0 ? 'You' : p.name, m);
            });
        }
        _tvPrev[i] = curr;
    });
}

function renderTableView(state) {
    if (!game) return;
    const seatsEl = document.getElementById('tvSeats');
    if (!seatsEl) return;

    // Z3 — one seat chip per player, YOU first (seat order = index order).
    seatsEl.innerHTML = state.players.map((p, i) => buildSeatChip(i, state)).join('');

    renderTvPurse(state);
    renderTvSkills(state);
    renderTvMissionRail(state);
    renderTvBoardThumb(state);
    renderTvStage(state);
    renderTvHand(state);

    // Tabletop motion: animate any per-player deltas since the last render.
    tvAnimateDeltas(state);

    // Prong 2: re-evaluate contextual coach-marks after each table render.
    coachTick();
}

// ═══ OVERLAY FUNCTIONS ═══════════════════════════════════════

// ── Board Overlay ──

function openBoardOverlay() {
    const char = myCharView();   // the SEAT's view — Side B art included
    if (!char) return;
    if (typeof coachMarkSeen === 'function') coachMarkSeen('welcome');

    // Root-level #actionPanel (z 9999) would paint over the board —
    // it steps aside while the overlay has the stage (slide-pick mode
    // manages the panel itself, so only the plain open does this).
    if (!_slidePick) _tvPanelStepAside();

    document.getElementById('boardOvImg').src = `assets/characters/${char.filename}`;
    document.getElementById('boardOvName').textContent = char.name;

    _ovSlideTarget = null;   // fresh open, no slide pending
    _ovRingDragInit();
    renderBoardOvSlots();

    document.getElementById('boardOverlay').classList.add('active');
}

function closeBoardOverlay() {
    // Chemical X's move is MANDATORY and the round is awaiting it — a stray
    // backdrop tap or Escape must not strand that promise. Same guard as
    // window._finalChoicePending on the panel: an unresolved modal chooser is
    // exactly how the round silently freezes.
    if (_slidePick && _slidePick.mode === 'free') return;
    _ovSlideTarget = null;
    _ovDragging = false;
    document.getElementById('boardOverlay').classList.remove('active');
    // Escape / backdrop while picking a slide slot: cancel back to where
    // the player came from. The hand panel is re-opened a tick later so
    // the same click's outside-click handler can't immediately hide it;
    // the final-card chooser (still pending, guarded) just re-surfaces.
    if (_slidePick) {
        const pick = _slidePick;
        _slidePick = null;
        // Cancelled out of pick-a-slot: the reveal chooser (still pending,
        // guarded) just re-surfaces.
        document.getElementById('actionPanel').classList.add('active');
    } else {
        // Same-tick dodge: restoring in this click's own bubble would let
        // the document-level outside-click handler immediately re-hide it.
        setTimeout(_tvPanelRestore, 0);
    }
}

// ── Discard-to-Slide slot picker ──
// ONE "Discard: Slide Ring" button opens the board itself in pick-a-slot
// mode: the circles one step from the ring glow, clicking one spends the
// discard as the toll — no gold changes hands. Escape/backdrop cancels.
// The action panel steps aside while the board has the stage: the overlay
// lives INSIDE the game screen's stacking context, so it can never paint
// over the root-level panel — hiding the panel is the only clean stage.
let _slidePick = null;

function openSlidePickerFinal(onPick) {
    _slidePick = { mode: 'final', onPick };
    // Direct class toggle — hideActionPanel() is guarded while the final
    // choice is pending, and that guard must stay for stray clicks.
    document.getElementById('actionPanel').classList.remove('active');
    openBoardOverlay();
}

// Chemical X's free move: EVERY circle is live (the card says "any slot"), the
// ring pays no toll, and the pick is mandatory — closeBoardOverlay refuses to
// close until a circle is chosen. onPick receives an ABSOLUTE slot index, not a
// step, which is what tells boardOvSlotClick these two modes apart.
function openSlidePickerFree(onPick) {
    _slidePick = { mode: 'free', onPick };
    document.getElementById('actionPanel').classList.remove('active');
    openBoardOverlay();
}

// The board art already explains every slot \u2014 no widget re-explains it.
// Invisible hotspots sit on the art's five track circles. Paid slides are
// tap-or-drag: tap a reachable circle (or drag the ring itself) and the
// ring rides out and waits there pulsing while a confirm chip floats just
// above the slot \u2014 Pay & Slide locks it, \u2715 glides it home. Repeatable
// while gold lasts; the engine holds the one-direction-per-turn rule.
// (The old confirm was a fixed-position bubble hung above the board RECT \u2014
// on phones the board starts at the screen's top edge, so it rendered
// off-screen and the tap looked dead. Everything now lives IN the art.)
// Calibrated against the board scans (pixel-measured): the five circles
// sit at these % of the board image. The board thumb (Z5) rides the same
// track, so geometry transfers 1:1 between thumb and overlay.
const BOARD_OV_TRACK = { lefts: [17, 33.4, 50, 66.3, 82.9], top: 84.7 };
let _ovSlideTarget = null;   // slot index awaiting Pay & Slide, or null

// Slots a paid slide can reach RIGHT NOW: affordable at 5g a space, and
// matching the direction already taken this turn (engine truth).
function _ovPaidReach() {
    const ok = new Set();
    if (!game || _slidePick || mpActive()) return ok;
    // Paid slides live at YOUR reveal — before you choose the card's
    // action (rulebook p.4) — not during the throw phase.
    if (game.phase !== 'activate' || !window._finalChoicePending) return ok;
    const p = game.players[0];
    const afford = Math.floor(p.gold / 5);
    const lock = p._paidSlideDir || 0;
    BOARD_OV_TRACK.lefts.forEach((L, i) => {
        const steps = i - p.sliderPosition;
        if (steps === 0 || Math.abs(steps) > afford) return;
        if (lock && Math.sign(steps) !== lock) return;
        ok.add(i);
    });
    return ok;
}

function _ovWhyBlocked(i) {
    if (!game || game.phase !== 'activate' || !window._finalChoicePending)
        return 'The ring slides on your turn — when your card is revealed';
    const p = game.players[0];
    const steps = i - p.sliderPosition;
    if (p._paidSlideDir && Math.sign(steps) !== p._paidSlideDir)
        return `One direction per turn \u2014 you already slid ${p._paidSlideDir < 0 ? 'left' : 'right'}`;
    if (Math.abs(steps) * 5 > p.gold) return `Need ${Math.abs(steps) * 5} Gold (5 per space)`;
    return '';
}

function renderBoardOvSlots() {
    const player = game.players[0];
    const cur = player.sliderPosition;
    const picking = !!_slidePick;
    const target = (!picking && _ovSlideTarget !== null) ? _ovSlideTarget : null;
    const reach = _ovPaidReach();

    // The ring sits on its committed slot \u2014 unless a slide awaits its
    // confirm: then it waits ON the target while the ghost marks home.
    const ring = document.getElementById('boardOvRing');
    if (ring && !_ovDragging) {
        const at = target !== null ? target : cur;
        ring.style.left = BOARD_OV_TRACK.lefts[at] + '%';
        ring.style.top = BOARD_OV_TRACK.top + '%';
        ring.classList.toggle('pending', target !== null);
        // Always grabbable while the game is at the table — even broke or
        // direction-locked, and in the throw phase too. The DROP is where
        // validity is judged (snap home + the reason); under the throw-first
        // flow that includes "not your reveal yet".
        ring.classList.toggle('grab', !picking && game
            && (game.phase === 'gameplay' || game.phase === 'activate'));
    }
    const ghost = document.getElementById('boardOvGhost');
    if (ghost) {
        ghost.style.left = BOARD_OV_TRACK.lefts[cur] + '%';
        ghost.style.top = BOARD_OV_TRACK.top + '%';
        ghost.classList.toggle('show', target !== null);
    }

    const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
    const holder = document.getElementById('boardOvSlots');
    if (!holder) return;
    // Chemical X ("move to ANY slot") lights every circle and charges nothing.
    const freeMove = picking && _slidePick.mode === 'free';
    // One direction per turn is shared with paid slides: once you've slid a
    // way this turn, a discard-slide can only go the SAME way (Wyatt 7/17).
    const slideLock = (game.players[0] && game.players[0]._paidSlideDir) || 0;
    holder.innerHTML = BOARD_OV_TRACK.lefts.map((L, i) => {
        const steps = Math.abs(i - cur);
        const dirOK = !slideLock || Math.sign(i - cur) === slideLock;
        const pickable = picking && (freeMove ? i !== cur : (steps === 1 && dirOK));
        const reachable = reach.has(i);
        const tip = i === cur
            ? 'Your ring is here'
            : picking
                ? (freeMove
                    ? `Move to ${posNames[i]} \u2014 free`
                    : (pickable ? `Slide to ${posNames[i]} \u2014 the discard pays`
                        : (steps === 1 && !dirOK
                            ? `Already slid ${slideLock < 0 ? 'left' : 'right'} this turn`
                            : 'One space per discard')))
                : (reachable ? `Slide to ${posNames[i]} \u2014 ${steps * 5} Gold` : _ovWhyBlocked(i));
        const cls = 'board-ov-slot'
            + (i === cur ? ' current' : '')
            + (pickable ? ' pickable' : '')
            + (reachable ? ' reach' : '')
            + (!picking && !reachable && i !== cur ? ' blocked' : '')
            + (picking && !pickable && i !== cur ? ' dimmed' : '');
        return `<div class="${cls}"
                     style="left:${L}%; top:${BOARD_OV_TRACK.top}%"
                     title="${tip}"
                     onclick="event.stopPropagation(); boardOvSlotClick(${i})"></div>`;
    }).join('');

    renderBoardOvConfirm();

    const hint = document.getElementById('boardOvHint');
    if (hint) hint.textContent = picking
        ? (freeMove
            ? 'Chemical X \u2014 move your ring to ANY circle, free'
            : 'Pick a glowing circle \u2014 the discarded card pays the toll')
        : (target !== null
            ? ''
            : (reach.size
                ? `Tap a circle or drag your ring \u2014 5 Gold a space${player._paidSlideDir ? ` \u00b7 ${player._paidSlideDir < 0 ? 'leftward' : 'rightward'} only this turn` : ''}`
                : ''));
}

function boardOvSlotClick(i) {
    const player = game.players[0];

    // A drag that ends over a circle also fires its click \u2014 one beat, not two.
    if (_ovDragJustEnded && Date.now() - _ovDragJustEnded < 300) return;

    // Pick-a-slot mode. Chemical X reaches ANY circle (free move); the
    // discard-to-slide modes reach one space, and the discard pays the toll.
    if (_slidePick) {
        const step = i - player.sliderPosition;
        if (_slidePick.mode === 'free') {
            if (step === 0) return;                   // the ring has to actually move
            const pick = _slidePick;
            _slidePick = null;
            closeBoardOverlay();                      // guard is off now — mode is cleared
            pick.onPick(i);                           // ABSOLUTE slot index
            return;
        }
        if (Math.abs(step) !== 1) return;
        // One direction per turn — reject an opposite-way discard-slide.
        const lock = player._paidSlideDir || 0;
        if (lock && Math.sign(step) !== lock) {
            showNotification(`Already slid ${lock < 0 ? 'left' : 'right'} this turn`, 'error');
            return;
        }
        const pick = _slidePick;
        _slidePick = null;
        closeBoardOverlay();
        pick.onPick(step);
        return;
    }

    if (i === player.sliderPosition) {
        if (_ovSlideTarget !== null) _ovSlideCancel();   // tapping home = never mind
        return;
    }
    // Paid-slide reach handles the WHEN (your reveal, before your action)
    // as well as gold and direction — blocked taps explain themselves.
    if (!_ovPaidReach().has(i)) {
        const why = _ovWhyBlocked(i);
        if (why) showNotification(why, 'error');
        return;
    }
    _ovSlideTarget = i;
    renderBoardOvSlots();
}

// The confirm chip floats just above the target circle, INSIDE the board
// art \u2014 always on-screen wherever the board sits in the viewport.
function renderBoardOvConfirm() {
    const holder = document.getElementById('boardOvConfirm');
    if (!holder) return;
    if (_ovSlideTarget === null || _slidePick) {
        holder.classList.remove('active');
        holder.innerHTML = '';
        return;
    }
    const player = game.players[0];
    const steps = Math.abs(_ovSlideTarget - player.sliderPosition);
    const cost = steps * 5;
    const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
    holder.style.left = Math.min(78, Math.max(22, BOARD_OV_TRACK.lefts[_ovSlideTarget])) + '%';
    holder.style.top = (BOARD_OV_TRACK.top - 8) + '%';
    holder.innerHTML = `
        <div class="sc-bubble">
            <div class="sc-text">Slide to <b>${posNames[_ovSlideTarget]}</b>?</div>
            <div class="sc-cost">${steps} space${steps > 1 ? 's' : ''} \u00b7 <b>\u2212${cost} Gold</b></div>
            <div class="sc-actions">
                <button class="btn-royal" onclick="event.stopPropagation(); _ovSlideCancel()"><span>\u2715</span></button>
                <button class="btn-royal primary" onclick="event.stopPropagation(); _ovSlideConfirm()"><span>Pay &amp; Slide</span></button>
            </div>
        </div>`;
    holder.classList.add('active');
}

function _ovSlideCancel() {
    _ovSlideTarget = null;
    renderBoardOvSlots();   // the ring glides home, the ghost fades
}

async function _ovSlideConfirm() {
    const target = _ovSlideTarget;
    if (target === null) return;
    _ovSlideTarget = null;
    const player = game.players[0];
    const dir = target > player.sliderPosition ? 1 : -1;
    const steps = Math.abs(target - player.sliderPosition);
    for (let s = 0; s < steps; s++) {
        await payToSlide(dir);   // 5g a step; slot landing events fire per step
    }
    renderGameState();
    renderBoardOvSlots();   // stay open \u2014 slide again while gold and direction allow
}

// \u2500\u2500 Ring drag \u2014 grab the ring, ride the WHOLE track, drop it on a circle \u2500\u2500
// The ring is always physically draggable during gameplay (clamped to the
// track ends \u2014 it can never leave the slider). While it's in hand every
// circle reveals itself: gold = payable right now, grey = exists but blocked,
// red halo = the drop would be refused. Validity is judged at the DROP:
// a reachable circle shows the Pay & Slide confirm; a blocked one glides
// the ring home and says exactly why (gold short / one-direction rule).
let _ovDragging = false;
let _ovDragJustEnded = 0;

function _ovRingDragInit() {
    const ring = document.getElementById('boardOvRing');
    if (!ring || ring._dragWired) return;
    ring._dragWired = true;

    let startX = 0, engaged = false, rect = null;

    // Nearest circle to the finger \u2014 ANY circle, valid or not.
    const slotAtX = (clientX) => {
        const pct = ((clientX - rect.left) / rect.width) * 100;
        let best = 0, bestD = Infinity;
        BOARD_OV_TRACK.lefts.forEach((L, i) => {
            const d = Math.abs(L - pct);
            if (d < bestD) { bestD = d; best = i; }
        });
        return best;
    };

    ring.addEventListener('pointerdown', (e) => {
        // Always grabbable while the game is at the table (throw phase OR
        // the reveal) — Skylar's judge-at-the-DROP model. Validity comes
        // from _ovPaidReach/_ovWhyBlocked, which now encode the throw-first
        // rule too: outside YOUR reveal every circle is blocked, so a drop
        // glides home and says "the ring slides on your turn".
        if (_slidePick || !game) return;
        if (game.phase !== 'gameplay' && game.phase !== 'activate') return;
        const wrap = document.querySelector('.board-ov-boardwrap');
        if (!wrap) return;
        rect = wrap.getBoundingClientRect();
        startX = e.clientX;
        engaged = false;
        _ovDragging = true;
        ring.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    ring.addEventListener('pointermove', (e) => {
        if (!_ovDragging) return;
        if (!engaged && Math.abs(e.clientX - startX) < 6) return;   // tap tolerance
        engaged = true;
        ring.classList.add('dragging');
        const ghost = document.getElementById('boardOvGhost');
        if (ghost) ghost.classList.add('show');   // home stays marked under the drag
        const holder = document.getElementById('boardOvSlots');
        if (holder) holder.classList.add('dragging');   // every circle shows itself
        // Follow the finger along the track \u2014 full span, never off the ends.
        const pct = Math.min(BOARD_OV_TRACK.lefts[BOARD_OV_TRACK.lefts.length - 1],
                             Math.max(BOARD_OV_TRACK.lefts[0],
                                      ((e.clientX - rect.left) / rect.width) * 100));
        ring.style.left = pct + '%';
        // Live halo on the circle it would snap to \u2014 gold if the drop will
        // take, red if it will bounce.
        const reach = _ovPaidReach();
        const cur = game.players[0].sliderPosition;
        const snap = slotAtX(e.clientX);
        document.querySelectorAll('#boardOvSlots .board-ov-slot').forEach((el, i) => {
            el.classList.toggle('snap', i === snap && i !== cur && reach.has(i));
            el.classList.toggle('snap-bad', i === snap && i !== cur && !reach.has(i));
        });
    });

    const release = (e) => {
        if (!_ovDragging) return;
        _ovDragging = false;
        const wasEngaged = engaged;
        engaged = false;
        ring.classList.remove('dragging');
        const holder = document.getElementById('boardOvSlots');
        if (holder) holder.classList.remove('dragging');
        document.querySelectorAll('#boardOvSlots .board-ov-slot.snap, #boardOvSlots .board-ov-slot.snap-bad')
            .forEach(el => el.classList.remove('snap', 'snap-bad'));
        if (!wasEngaged) { renderBoardOvSlots(); return; }   // a tap, not a drag
        _ovDragJustEnded = Date.now();
        const cur = game.players[0].sliderPosition;
        const snap = slotAtX(e.clientX);
        if (snap === cur || !_ovPaidReach().has(snap)) {
            // Home, or a circle the rules refuse \u2014 the ring glides back and
            // the player hears the reason (gold short / one-direction rule).
            _ovSlideTarget = null;
            if (snap !== cur) {
                const why = _ovWhyBlocked(snap);
                if (why) showNotification(why, 'error');
            }
        } else {
            _ovSlideTarget = snap;   // waits on the target for Pay & Slide
        }
        renderBoardOvSlots();
    };
    ring.addEventListener('pointerup', release);
    ring.addEventListener('pointercancel', release);
}

// ── Hand Inspect Overlay ──

function openHandInspect() {
    const hand = game.players[0].hand;
    if (!hand || hand.length === 0) return;

    const spread = document.getElementById('handOvSpread');
    spread.innerHTML = hand.map(card =>
        `<img class="ov-hand-card" src="assets/cards/regular/${card.filename}"
            alt="${card.name}"
            onclick="zoomCard('assets/cards/regular/${card.filename}')">`
    ).join('');

    document.getElementById('handOvLabel').textContent = `Your Hand — ${hand.length} Cards`;
    document.getElementById('handInspectOv').classList.add('active');
}

function closeHandInspect() {
    document.getElementById('handInspectOv').classList.remove('active');
}

// ── Opponent Overlay ──

function openOppOverlay(playerIndex) {
    const state = game.getState(0);
    const p = state.players[playerIndex];
    const char = game.players[playerIndex].character;
    if (!char) return;
    if (typeof coachMarkSeen === 'function') coachMarkSeen(playerIndex === 0 ? 'welcome' : 'rivals');
    _tvPanelStepAside();   // the root-level action panel would paint over the overlay

    document.getElementById('oppOvAvatar').src = `assets/characters/${char.filename}`;
    document.getElementById('oppOvName').textContent = p.name;
    document.getElementById('oppOvBoard').src = `assets/characters/${char.filename}`;

    // Their ring on the board's track (both layouts — with the rail's
    // ring-dots gone, this is where a rival's position lives) — same
    // BOARD_OV_TRACK geometry as your board overlay and thumb.
    const oppRing = document.getElementById('oppOvRing');
    if (oppRing) {
        const pos = game.players[playerIndex].sliderPosition;
        oppRing.style.left = BOARD_OV_TRACK.lefts[pos] + '%';
        oppRing.style.top = BOARD_OV_TRACK.top + '%';
    }

    // Phone: their played cards sit beside the board as tucked skill
    // stacks — read exactly like your own on the stage. (Hidden on desktop,
    // which keeps its inline cards panel.)
    const oppStacks = document.getElementById('oppOvStacks');
    if (oppStacks) {
        const played = p.playedCards || [];
        oppStacks.innerHTML = played.length
            ? buildSkillStacks(played)
            : '<div class="tv-stage-empty">No cards played yet</div>';
        // Fit-to-width: size the stacks so every skill group is visible at
        // once (floor 64px card height — past that the row scrolls).
        const groups = Math.max(1, new Set(played.map(getCardTypeGroup)).size);
        const avail = window.innerWidth * 0.40 - 4;          // tracks the CSS max-width: 40vw
        const per = (avail - (groups - 1) * 10) / groups;    // 10px stack gap
        const fitH = Math.max(64, Math.min(Math.round(per / 0.666), Math.round(window.innerHeight * 0.28)));
        oppStacks.style.setProperty('--tvStackCardH', fitH + 'px');
    }

    document.getElementById('oppOvStats').innerHTML = statPillsHtml(p);

    // Their variables, summed and displayed like your own: the juicy
    // token-totem panel on desktop, the HUD chip rail on phones (CSS
    // shows exactly one of the two per layout).
    document.getElementById('oppOvPanel').innerHTML = buildStatsPanelHtml(playerIndex, state);
    document.getElementById('oppOvChips').innerHTML = buildStatChipsHtml(playerIndex, state);

    const cardsEl = document.getElementById('oppOvCards');
    cardsEl.innerHTML = '';
    p.playedCards.forEach(card => {
        const wrap = document.createElement('div');
        wrap.className = 'opp-ov-card-wrap';
        const safeName = card.name.replace(/'/g, "\\'");
        wrap.innerHTML = `
            <img src="assets/cards/regular/${card.filename}" alt="${card.name}"
                 data-peek="assets/cards/regular/${card.filename}">
            <div class="lend-btn" onclick="requestLend(${playerIndex}, '${safeName}')">Lend Skills</div>
        `;
        cardsEl.appendChild(wrap);
    });

    // Toggle button label (used on landscape); start on the board view.
    const n = p.playedCards.length;
    const toggle = document.getElementById('oppOvToggle');
    if (toggle) toggle.textContent = n ? `View Played Cards (${n})` : 'No Cards Played';
    const ov = document.getElementById('oppOverlay');
    ov.classList.remove('cards-open');
    ov.classList.add('active');
}

// Landscape: reveal/hide the played-cards panel (keeps the board readable
// instead of one long scroll). No-op behavior on desktop (panel shows inline).
function toggleOppCards(e) {
    if (e) e.stopPropagation();
    document.getElementById('oppOverlay').classList.toggle('cards-open');
}

function closeOppOverlay() {
    const ov = document.getElementById('oppOverlay');
    ov.classList.remove('active', 'cards-open');
    setTimeout(_tvPanelRestore, 0);   // after this click's outside-click handler
}

function requestLend(oppIndex, cardName) {
    const oppName = game.players[oppIndex].name;
    const toast = document.getElementById('lendToast');
    toast.textContent = `Request sent to ${oppName} — "${cardName}"`;
    toast.classList.add('active');
    setTimeout(() => toast.classList.remove('active'), 2500);
}

// ── Mission Lightbox ──

// ── Mission Browser — picking up one mission picks up the whole row.
// kind 'realm' = the table's available missions; 'mine' = your current +
// completed set. The clicked card opens centered; swipe / arrows / click
// browse the rest, every card readable-big.
let _mbList = [], _mbKind = null, _mbIndex = 0, _mbScrollT = null;
let _mbSnapping = false, _mbSnapT = null;

function openMissionBrowser(kind, focusName) {
    if (!game) return;
    if (typeof coachMarkSeen === 'function') coachMarkSeen('missions');
    _tvPanelStepAside();   // the root-level action panel would paint over the browser

    const p = game.players[0];
    _mbKind = kind;
    _mbList = kind === 'mine'
        ? [...(p.missions || []).map(m => ({ m, held: true })),
           ...(p.completedMissions || []).map(m => ({ m, done: true }))]
        : (game.getState(0).visibleMissions || []).map(m => ({ m }));
    if (!_mbList.length) return;

    document.getElementById('mbTitle').textContent =
        kind === 'mine' ? 'Your Missions' : 'Missions of the Realm';

    const track = document.getElementById('mbTrack');
    track.innerHTML = _mbList.map((e, i) => `
        <div class="mb-card${e.done ? ' done' : ''}" data-i="${i}"
             onclick="event.stopPropagation(); mbFocus(${i}, true)">
            <img src="assets/cards/missions/${e.m.filename}" alt="${e.m.name}"
                 draggable="false">
            ${e.done ? '<div class="mb-done-ribbon">✓ Completed</div>' : ''}
        </div>`).join('');

    // Swipe/scroll settles on the nearest card: while moving, focus tracks
    // the center; on idle, snap to the card ACTUALLY nearest (recomputed
    // fresh — the tracked index can be stale when iOS cancels a smooth
    // scroll mid-flight, which is how a tapped mission snapped back to
    // the first one, Wyatt 7/17). While a programmatic snap is in
    // flight, the scroll it causes must not re-target anything.
    track.onscroll = () => {
        if (_mbSnapping) return;
        requestAnimationFrame(_mbTrackFocus);
        clearTimeout(_mbScrollT);
        _mbScrollT = setTimeout(() => { _mbTrackFocus(); mbFocus(_mbIndex, true); }, 130);
    };

    const nav = _mbList.length > 1 ? '' : ' mb-solo';
    document.getElementById('missionLB').className = 'mission-lb active' + nav;

    const idx = Math.max(0, _mbList.findIndex(e => e.m.name === focusName));
    requestAnimationFrame(() => mbFocus(idx, false));
}

// Which card sits nearest the track's center right now?
function _mbTrackFocus() {
    const track = document.getElementById('mbTrack');
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0, bestD = Infinity;
    track.querySelectorAll('.mb-card').forEach((c, i) => {
        const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
        if (d < bestD) { bestD = d; best = i; }
    });
    if (best !== _mbIndex) { _mbIndex = best; _mbApplyFocus(); }
}

function mbFocus(i, smooth) {
    _mbIndex = Math.max(0, Math.min(_mbList.length - 1, i));
    const track = document.getElementById('mbTrack');
    const el = track.querySelector(`.mb-card[data-i="${_mbIndex}"]`);
    if (!el) return;
    clearTimeout(_mbScrollT);   // this IS the snap — don't re-snap after it
    const left = Math.round(el.offsetLeft - (track.clientWidth - el.offsetWidth) / 2);
    if (Math.abs(track.scrollLeft - left) > 1) {
        // Own the scroll until it lands (or a beat passes — iOS cancels
        // smooth scrolls on touch): tracking stays paused so the tapped
        // card keeps the focus it was given.
        _mbSnapping = true;
        clearTimeout(_mbSnapT);
        track.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
        const t0 = performance.now();
        const settle = () => {
            if (!_mbSnapping) return;
            if (Math.abs(track.scrollLeft - left) <= 1 || performance.now() - t0 > 800) {
                _mbSnapping = false;
                return;
            }
            requestAnimationFrame(settle);
        };
        requestAnimationFrame(settle);
        _mbSnapT = setTimeout(() => { _mbSnapping = false; }, 900);
    }
    _mbApplyFocus();
}

function mbStep(d) { mbFocus(_mbIndex + d, true); }

function _mbApplyFocus() {
    const track = document.getElementById('mbTrack');
    track.querySelectorAll('.mb-card').forEach((c, i) =>
        c.classList.toggle('focus', i === _mbIndex));
    const e = _mbList[_mbIndex];
    if (!e) return;
    document.getElementById('missionLBLabel').textContent =
        e.m.name + (e.done ? ' — completed' : '');
    // Turn In / Borrow attach to the focused card, held missions only
    // (renderMissionLBTurnIn no-ops for realm/completed entries).
    renderMissionLBTurnIn(e.m.name);
}

// "Turn In Now" — a held mission may be cashed in during ANY act of its
// window, the player's call. The button tells the truth (the check is
// deterministic); failing on purpose asks for a second click.
function renderMissionLBTurnIn(name) {
    const holder = document.getElementById('missionLBAction');
    if (!holder) return;
    holder.innerHTML = '';
    if (!game || game.phase !== 'gameplay') return;
    // Anytime-actions can't ride the round barrier — early turn-ins sit
    // out of multiplayer v1; missions resolve at their due date instead.
    if (mpActive()) return;
    const p = game.players[0];
    const mi = (p.missions || []).findIndex(m => m.name === name);
    if (mi < 0) return;

    const mission = p.missions[mi];
    const due = game.missionDueAct(mission);
    // PURE probe — the old checkMissionRequirements call CONSUMED a held
    // Life Essence just to label this button; browsing N missions would
    // have burned it N times over. Only the real turn-in may consume.
    const { success } = game.probeMissionRequirements(0, mission);
    const dueNote = due > game.currentAct
        ? `<div class="mission-lb-due">Due at the end of Act ${due} — turn in any time before</div>` : '';
    // Short only on borrowable skills? Turning in now can borrow them too —
    // same 2g-per-unit deal the borrow chooser offers at the due date.
    const plan = success ? null : game.missionBorrowPlan(0, mission);
    holder.innerHTML = `${dueNote}
        ${plan ? `<button class="btn-royal primary" id="missionBorrowIn">
            <span>Borrow & Complete (−${plan.cost}g)</span>
        </button>` : ''}
        <button class="btn-royal${success ? ' primary' : ''}" id="missionTurnIn">
            <span>${success ? '✓ Turn In Now — requirements met' : 'Turn In Now (you would FAIL)'}</span>
        </button>`;
    const borrowBtn = holder.querySelector('#missionBorrowIn');
    if (borrowBtn) {
        borrowBtn.onclick = (e) => {
            e.stopPropagation();
            closeMissionLB();
            // An early borrow-and-complete used to toast and vanish; it now
            // plays the same ceremony beat as every other resolution, and the
            // lender's payment shows up in the beat's "Also affected" line.
            missionBeat(0, mi, () => game.completeMissionWithBorrow(0, mi)).then(res => {
                if (res && res.success) {
                    addLogEntry(`You borrow skills (−${res.cost}g) and complete ${name}`);
                } else {
                    showNotification((res && res.error) || 'Borrow fell through', 'error');
                }
                renderGameState();
            });
        };
    }
    const btn = holder.querySelector('#missionTurnIn');
    let armed = success; // failing on purpose takes two clicks
    btn.onclick = (e) => {
        e.stopPropagation();
        if (!armed) {
            armed = true;
            btn.querySelector('span').textContent = 'Click again to fail it — penalties apply';
            return;
        }
        closeMissionLB();
        // A deliberate early turn-in — win or lose — is a real resolution and
        // gets a real beat. Failing on purpose is a legitimate play, and its
        // penalties (Scorn, forced discards, a Fortune Teller that wasn't
        // there) were previously summarised as a one-line toast.
        missionBeat(0, mi, () => game.turnInMission(0, mi)).then(res => {
            addLogEntry(`You turn in ${name} — ${res && res.success ? 'success!' : 'failed'}`);
            // Crazy Lou-style penalties: the discard picker follows the beat,
            // so the player sees WHY they are being asked to discard.
            const pend = game.players[0]._pendingPenaltyDiscard || 0;
            if (pend) {
                game.players[0]._pendingPenaltyDiscard = 0;
                showPenaltyDiscardPicker(pend).then(() => renderGameState());
            }
            renderGameState();
        });
    };
}

function closeMissionLB() {
    document.getElementById('missionLB').classList.remove('active');
    // If the journal is still holding the stage beneath the browser, the
    // action panel must NOT come back yet — it would paint over the
    // journal (root-level z 9999). The journal's own close restores it.
    if (!missionJournalOpen()) setTimeout(_tvPanelRestore, 0);
}

// ── ESC closes all overlays ──

function closeAllOverlays() {
    closeBoardOverlay();
    closeHandInspect();
    closeOppOverlay();
    closeMissionLB();
    closeMissionJournal();
    if (typeof closeTvPopover === 'function') closeTvPopover();
    if (window.FLB) {
        FLB.closeLeaderboard();
        FLB.closeProfile();
        if (typeof FLB.closeStore === 'function') FLB.closeStore();
    }
}

// ─── THE THROW PHASE — throw first, decide at the reveal ──────────
// The physical flow (rulebook p.3–4): every player picks a card and
// places it FACE DOWN on their board; hands pass; then, starting with
// the Emblem holder and going clockwise, each player reveals their card
// and chooses an action. Nothing pops up at throw time — the choice
// happens at YOUR reveal, with earlier players' effects already applied.
// Any player may take their card back until the last card goes in; that
// instant, every card locks.

const CARD_BACK_IMG = 'assets/cards/backs/Back Card 1_Brown1.jpg';

let _throwUx = null;   // { round, locked, timers[], mpThrown{}, seen:Set }

// Unique per throw phase and identical on every client — hand sizes are
// uniform around the table when the phase opens.
function throwRoundId() {
    return game.currentAct * 100 + game.players[0].hand.length;
}

function _throwClearTimers() {
    if (!_throwUx) return;
    (_throwUx.timers || []).forEach(t => clearTimeout(t));
    _throwUx.timers = [];
}

// Face-down card state for seat i — engine truth, plus the pre-lock
// stream state for remote humans (their pick is engine-applied at lock).
function seatHasThrown(i) {
    if (!game) return false;
    if (game.phase !== 'gameplay' && game.phase !== 'activate') return false;
    if (game.pendingActivations[i]) return true;
    return !!(i !== 0 && _throwUx && _throwUx.mpThrown && _throwUx.mpThrown[i]);
}

// First render of a seat's throw gets the landing animation; innerHTML
// rebuilds replay CSS animations, so every later render stays still.
function _thrownLandClass(i) {
    if (!_throwUx || _throwUx.seen.has(i)) return '';
    _throwUx.seen.add(i);
    return ' land';
}

function beginThrowPhase() {
    if (!game || game.phase !== 'gameplay') return;
    saveSoloCheckpoint();   // regular + Skirmish + Rival tables survive minimizing (Wyatt 7/17)
    _throwClearTimers();
    _throwUx = { round: throwRoundId(), locked: false, timers: [], mpThrown: null, seen: new Set() };

    if (mpActive()) { mpBeginThrowPhase(); return; }

    // Solo: the rivals think, then toss their cards in one by one — those
    // face-down cards landing around the table ARE your undo window.
    const base = 1300, step = 1050;
    for (let i = 1; i < game.playerCount; i++) {
        if (!game.players[i].hand.length) continue;
        const jitter = Math.random() * 650;
        const t = setTimeout(() => {
            if (!_throwUx || _throwUx.locked || !game || game.phase !== 'gameplay') return;
            if (game.pendingActivations[i] === null && game.players[i].hand.length) {
                aiPickCard(i);
                renderGameState();
                maybeLockThrows();
            }
        }, (base + (i - 1) * step + jitter) * window.CINEMATIC_SPEED);
        _throwUx.timers.push(t);
    }
    renderGameState();
    maybeShowThrowHint();
    if (typeof coachTick === 'function') coachTick();
}

// The human throws: drag a card up and it goes in face down. No options,
// no popup — the decision comes at your reveal.
function throwCard(index) {
    if (!game || game.phase !== 'gameplay') return;
    if (_throwUx && _throwUx.locked) return;
    if (game.pendingActivations[0] !== null) return;   // already in — take it back first
    const card = game.players[0].hand[index];
    if (!card) return;

    if (typeof coachMarkSeen === 'function') coachMarkSeen('hand');
    hideThrowHint();
    window._uxThrownOnce = true;

    game.pickCard(0, index);
    mpPub('throw', { r: _throwUx ? _throwUx.round : 0, cardId: card.id });
    addLogEntry('You throw a card in, face down');
    renderGameState();
    maybeLockThrows();
}

// Take it back — the physical rule allows it until the last card goes in.
function undoThrow() {
    if (!game || game.phase !== 'gameplay') return;
    if (!_throwUx) return;
    if (_throwUx.locked) {
        // SOLO: the lock beat (Emblem flare → hands pass) is still a
        // legal take-back window — the engine refuses only after
        // passHands. "It needs to work" = the WHOLE legal window
        // (Wyatt 7/17). MP stays stream-locked: that lock is canonical.
        if (mpActive()) return;
        const res = game.unpickCard(0);
        if (!res.success) return;
        _throwUx.locked = false;
        _throwUx.lockGen = (_throwUx.lockGen || 0) + 1;   // aborts the in-flight lockThrows
        if (_throwUx.seen) _throwUx.seen.delete(0);
        addLogEntry('You take your card back');
        renderGameState();
        return;
    }
    const res = game.unpickCard(0);
    if (!res.success) return;
    if (_throwUx.lockT) { clearTimeout(_throwUx.lockT); _throwUx.lockT = null; }
    if (_throwUx.seen) _throwUx.seen.delete(0);
    mpPub('unthrow', { r: _throwUx.round });
    addLogEntry('You take your card back');
    renderGameState();
}

// Solo lock: the engine state is the whole truth. (Multiplayer locks off
// the move stream instead — see mpBeginThrowPhase; the stream position
// IS the lock, so the grace below stays solo-only.)
function maybeLockThrows() {
    if (mpActive()) return;
    if (!_throwUx || _throwUx.locked) return;
    if (!game.allPlayersPicked()) {
        if (_throwUx.lockT) { clearTimeout(_throwUx.lockT); _throwUx.lockT = null; }
        return;
    }
    // The table holds THREE seconds once the last card is in (Wyatt
    // 7/17) — your quiet take-back window, no banner. A take-back inside
    // the grace cancels it; the re-throw starts a fresh one. The clock
    // NEVER runs out while an overlay (board, missions, rival peek)
    // hides the take-back — that's how the button "didn't work at a key
    // moment": the window expired behind a screen the player had open.
    if (_throwUx.lockT) return;
    const armLock = (delay) => {
        _throwUx.lockT = setTimeout(() => {
            if (!_throwUx || _throwUx.locked || !game) return;
            _throwUx.lockT = null;
            if (game.phase !== 'gameplay' || !game.allPlayersPicked()) return;
            const z = document.getElementById('thrownZone');
            const visible = z && z.classList.contains('active')
                && z.getBoundingClientRect().width > 2;
            if (!visible) { _throwUx.hidGrace = true; armLock(700); return; }
            if (_throwUx.hidGrace) {
                // The overlay just closed — a fresh beat before the lock
                // so the returning player can still reach the button.
                _throwUx.hidGrace = false;
                armLock(1500);
                return;
            }
            lockThrows();
        }, delay);
        _throwUx.timers.push(_throwUx.lockT);
    };
    armLock(3000);
}

// The last card hit the table: everything locks instantly, hands pass,
// and the reveal walks the table from the Emblem holder.
async function lockThrows() {
    if (!_throwUx || _throwUx.locked) return;
    _throwUx.locked = true;
    const gen = _throwUx.lockGen = (_throwUx.lockGen || 0) + 1;
    _throwClearTimers();
    hideThrowHint();
    renderGameState();

    // No banner (Wyatt 7/17) — the Emblem token itself says who reveals
    // first: it flares on the holder's seat as the reveal opens.
    flashEmblemFirst(game.emblemHolder);
    await new Promise(r => setTimeout(r, 900 * window.CINEMATIC_SPEED));
    // A solo take-back during the beat bumps lockGen — this pass is
    // abandoned and the table re-opens (see undoThrow).
    if (!game || !_throwUx || _throwUx.lockGen !== gen || !_throwUx.locked) return;

    game.passHands();
    renderGameState();
    await activateAllCards();
    finishRound();
}

// The Emblem flares where the reveal begins — the token IS the message
// (Wyatt 7/17: no "reveals first" words). Fires on every surface that
// wears the badge: phone seat chip, desktop sidebar entry, your own tag.
function flashEmblemFirst(pi) {
    const els = [
        document.querySelector(`#tvSeats .pmat[data-pi="${pi}"] .emblem-badge`),
        pi === 0 ? document.querySelector('#statsPanel .emblem-tag')
                 : document.querySelector(`#gameSidebar .opp-entry[data-pi="${pi}"] .emblem-badge`),
    ].filter(Boolean);
    els.forEach(el => {
        el.classList.remove('em-first');
        void el.offsetWidth;   // restart the animation on re-lock
        el.classList.add('em-first');
        setTimeout(() => el.classList.remove('em-first'), 2000);
    });
}

// ── Your thrown card — face down above your hand, with the take-back ──
function renderThrownZone() {
    const zone = document.getElementById('thrownZone');
    if (!zone || !game) return;
    const pending = game.pendingActivations[0];
    const inWindow = game.phase === 'gameplay' || game.phase === 'activate';
    if (!pending || !inWindow || window._finalChoicePending) {
        zone.classList.remove('active');
        zone.innerHTML = '';
        return;
    }
    const pair = Array.isArray(pending);
    // SOLO keeps the take-back through the lock beat (undoable until
    // hands pass); MP goes read-only the moment the stream locks.
    const locked = !_throwUx || game.phase === 'activate'
        || (_throwUx.locked && mpActive());
    const note = locked
        ? 'Locked in — revealed on your turn'
        : (pair ? 'Your last two go in together' : 'Card set');
    zone.innerHTML = `
        <div class="tz-cards${pair ? ' pair' : ''}">
            <img class="tz-card" src="${CARD_BACK_IMG}" alt="Your face-down card">
            ${pair ? `<img class="tz-card two" src="${CARD_BACK_IMG}" alt="">` : ''}
        </div>
        <div class="tz-side">
            <div class="tz-note">${note}</div>
            ${locked ? '' : `<button class="btn-royal tz-undo" onclick="event.stopPropagation(); undoThrow()"><span>Undo</span></button>`}
        </div>`;
    zone.classList.add('active');
}

// ── The throw-gesture hint — a finger pushing a card upward ──────
// Replaces the old "pick one card" text prompt: the gesture IS the
// tutorial. Shows on a game's first hand until the first throw lands.
function maybeShowThrowHint() {
    if (window._uxThrownOnce) return;
    if (!game || game.phase !== 'gameplay') return;
    if (game.pendingActivations[0] !== null || !game.players[0].hand.length) return;
    const hint = document.getElementById('throwHint');
    if (hint) hint.classList.add('active');
}
function hideThrowHint() {
    const hint = document.getElementById('throwHint');
    if (hint) hint.classList.remove('active');
}

// ── Multiplayer throw phase — deterministic lock off the move stream ──
// Humans stream 'throw'/'unthrow' freely; every client folds the SAME
// push-ordered stream, so the first moment all live human seats hold an
// active throw — the lock — is the same moment everywhere. An undo that
// loses the race to the last throw is overridden, exactly the physical
// rule: the last card hitting the table locks every card instantly.
async function mpBeginThrowPhase() {
    const round = _throwUx.round;

    // Bots pick deterministically at once — identical on every client.
    for (let i = 1; i < game.playerCount; i++) {
        const p = game.players[i];
        if (!p._remoteHuman && game.pendingActivations[i] === null && p.hand.length > 0) {
            aiPickCard(i);
        }
    }
    renderGameState();
    maybeShowThrowHint();
    if (typeof coachTick === 'function') coachTick();

    const seats = [];
    for (let i = 0; i < game.playerCount; i++) {
        if (i === 0 || game.players[i]._remoteHuman) seats.push(FMP.canonSeat(i));
    }

    const res = await FMP.collectThrows({
        round, seats,
        onUpdate: (active) => {
            if (!_throwUx || _throwUx.round !== round) return;
            const mp = {};
            Object.keys(active).forEach(cs => { mp[FMP.localIdx(Number(cs))] = true; });
            _throwUx.mpThrown = mp;
            renderGameState();
        },
    });
    if (!_throwUx || _throwUx.round !== round || _throwUx.locked || !res) return;

    // Reconcile every human seat to the locked snapshot — stream order
    // already decided any last-throw-vs-undo race.
    Object.entries(res.picks).forEach(([cs, cardId]) => {
        const li = FMP.localIdx(Number(cs));
        const p = game.players[li];
        const pend = game.pendingActivations[li];
        const pendId = pend ? (Array.isArray(pend) ? pend[0].id : pend.id) : null;
        if (pendId === cardId) return;
        if (pend) game.unpickCard(li);
        else if (li === 0) showNotification('The last card fell — yours is locked in.', 'act');
        const hi = p.hand.findIndex(c => c.id === cardId);
        game.pickCard(li, hi >= 0 ? hi : 0);
    });

    // Booted or silent human seats: the same AI pick on every client.
    for (let i = 0; i < game.playerCount; i++) {
        if (game.pendingActivations[i] === null && game.players[i].hand.length) {
            aiPickCard(i);
        }
    }
    lockThrows();
}

// ─── NEIGHBOR-TARGET HIGHLIGHT ─────────────────────────────
// Cards that read other players ("1 Favor for each Power your left &
// right neighbor have") light up exactly WHO they read while selected:
// pulsing gold ring + floating tag on the rival-rail portraits (desktop
// sidebar AND phone seat chips); self-including cards also mark your own
// stats/purse. Data-driven — future cards join by adding a row here.
const TARGET_READ_SPECIALS = {
    gold_2_per_power_neighbors:  { neighbors: true },              // Melee Spectacular
    gold_2_per_alchemy_triangle: { neighbors: true, self: true },  // Marketplace Sales
    favor_per_neighbor_power:    { neighbors: true },              // Royal Hilt
};

// Engine truth (getBorrowableSkills): left = (pi−1+n)%n, right = (pi+1)%n.
// The human is player 0, so left = LAST player, right = players[1].
let _targetHighlights = null;

function setTargetHighlights(card) {
    clearTargetHighlights();
    const spec = card && card.special && TARGET_READ_SPECIALS[card.special];
    if (!spec || !game) return;
    const n = game.playerCount;
    _targetHighlights = { left: (n - 1) % n, right: 1 % n, self: !!spec.self };
    applyTargetHighlights();
}

function clearTargetHighlights() {
    _targetHighlights = null;
    document.querySelectorAll('.nt-read').forEach(el => {
        el.classList.remove('nt-read', 'nt-left', 'nt-right', 'nt-self');
    });
    document.querySelectorAll('.nt-tag').forEach(t => t.remove());
}

function _ntMark(el, side, tagText) {
    if (!el) return;
    el.classList.add('nt-read', 'nt-' + side);
    if (tagText && !el.querySelector(':scope > .nt-tag')) {
        const tag = document.createElement('span');
        tag.className = 'nt-tag';
        tag.textContent = tagText;
        el.appendChild(tag);
    }
}

// Re-applied at the end of every renderGameState — the sidebar and seat
// chips are rebuilt via innerHTML, which wipes marks mid-selection.
function applyTargetHighlights() {
    if (!_targetHighlights || !game) return;
    const { left, right, self } = _targetHighlights;
    const mark = (pi, side, text) => {
        _ntMark(document.querySelector(`#gameSidebar .opp-entry[data-pi="${pi}"]`), side, text);
        _ntMark(document.querySelector(`#tvSeats .pmat[data-pi="${pi}"]`), side, text);
    };
    mark(left, 'left', '◀ Left Neighbor');
    mark(right, 'right', 'Right Neighbor ▶');
    if (self) {
        // Desktop: your stats/purse panel. Phone: your own seat chip
        // (its built-in YOU badge is the label; the ring says "read").
        _ntMark(document.getElementById('statsPanel'), 'self', 'You');
        _ntMark(document.querySelector('#tvSeats .pmat[data-pi="0"]'), 'self', null);
    }
}

// ─── ACTION PANEL SHELL ────────────────────────────────────
// The pick-time action sheet is GONE — throwing shows nothing (the
// physical flow), and the only thing #actionPanel hosts now is the
// reveal chooser (showCardChoice). hideActionPanel remains the guarded
// outside-click sink.

function hideActionPanel() {
    // The final-card chooser awaits a Promise that ONLY its buttons resolve.
    // Dismissing it (outside click, etc.) would strand that await and freeze
    // the round — so while it's pending the panel refuses to hide.
    if (window._finalChoicePending) return;
    document.getElementById('actionPanel').classList.remove('active', 'final-choice');
    // Nothing re-renders the hand here, so the .selected card (z 31)
    // would linger and paint OVER a neighbor's hover-bloom (Wyatt's
    // buried-bloom screenshot) — strip the class with the selection.
    document.querySelectorAll('.hand-card.selected').forEach(c => c.classList.remove('selected'));
    clearTargetHighlights();
    if (typeof coachTick === 'function') coachTick();
}

// ─── THE REVEAL CHOOSER ────────────────────────────────────
// Your thrown card comes face up and NOW you choose — play / borrow /
// mission letter / discard / slide — with everything earlier players did
// already applied. The same panel serves the auto-paired final card.
// Resolves an action string; window._finalChoicePending guards every
// stray dismissal while it's up, and window._cardChoiceRerender lets a
// paid slide refresh the requirements it just changed.
function showCardChoice(card, cardIdx) {
    return new Promise((resolve) => {
        // Mark the chooser as pending BEFORE it renders: hideActionPanel()
        // is a no-op while this is set, so no stray click can strand the await.
        window._finalChoicePending = true;
        const panel = document.getElementById('actionPanel');

        const finish = (act) => {
            window._cardChoiceRerender = null;
            window._finalChoicePending = false;
            panel.classList.remove('active', 'final-choice');
            clearTargetHighlights();
            resolve(act);
        };

        const render = (first) => {
            // A rerender while the board overlay has the stage must not
            // yank the panel back over it — respect the stepped-aside state.
            const stayHidden = !first && !panel.classList.contains('active');
            const player = game.players[0];
            const { canPlay, missingSkills, missingSpecial = [] } = game.checkRequirements(0, card);
            const isMissionLetter = card.type === 'mission_letter';

            let html = `<img class="action-card-img" src="assets/cards/regular/${card.filename}"
                             alt="${card.name}" data-peek="assets/cards/regular/${card.filename}">`;
            html += '<div class="action-body"><div class="action-header">';
            html += `<div class="action-card-name">${card.name}</div>`;
            html += `<div class="action-card-type">${cardIdx > 0 ? 'Your final card — choose its fate' : 'Your card is revealed — choose its fate'}</div>`;
            html += `<div class="action-purse"><img src="${TOKEN_IMG.gold}" alt="Gold"> Your purse: <b>${player.gold} Gold</b></div>`;

            // The honest summary: grants, specials, and the price — shown
            // before you commit, with the table's current state applied.
            const fcSkills = card.skills || [];
            if (fcSkills.length > 0) {
                html += `<div class="action-skills"><span class="ap-lbl">Grants</span>${fcSkills.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' · ')}</div>`;
            }
            if (card.special && SPECIAL_DESCRIPTIONS[card.special]) {
                html += `<div class="action-special">${SPECIAL_DESCRIPTIONS[card.special]}</div>`;
            }
            if (card.rewards) {
                const r = [];
                if (card.rewards.gold) r.push(`+${card.rewards.gold} Gold`);
                if (card.rewards.prestige) r.push(`+${card.rewards.prestige} Prestige`);
                if (card.rewards.favor) r.push(`+${card.rewards.favor} Favor`);
                if (r.length) html += `<div class="action-rewards"><span class="ap-lbl">Gains</span>${r.join(' · ')}</div>`;
            }
            if (!isMissionLetter) {
                const price = [];
                if (card.cost) price.push(`−${card.cost} Gold`);
                if (card.rewards && card.rewards.scorn) price.push(`+${card.rewards.scorn} Scorn`);
                if (price.length) html += `<div class="action-price"><span class="ap-lbl">Price</span>${price.join(' · ')}</div>`;
            }

            html += '</div><div class="action-buttons">';

            const btn = (label, action, primary) =>
                `<button class="btn-royal${primary ? ' primary' : ''} action-btn" data-act="${action}"><span>${label}</span></button>`;

            if (isMissionLetter) {
                if (player.gold >= 1 && game.visibleMissions.length > 0) {
                    html += btn('Mission Letter (−1g)', 'mission_letter', true);
                } else {
                    html += `<button class="btn-royal action-btn" disabled style="opacity:0.3;cursor:default"><span>Need 1g for Mission Letter</span></button>`;
                }
            } else if (canPlay) {
                html += btn('Play', 'play', true);
            } else {
                const needed = [...missingSkills, ...missingSpecial];
                html += `<button class="btn-royal action-btn" disabled style="opacity:0.3;cursor:default"><span>Need: ${needed.join(', ')}</span></button>`;
                if (missingSpecial.length === 0 && missingSkills.length > 0) {
                    const borrowable = game.getBorrowableSkills(0);
                    const canBorrowAll = missingSkills.every(s => borrowable[s] && borrowable[s].length > 0);
                    // Fee first, card cost second — the player must cover
                    // both, or the play silently dies in activateCard.
                    const borrowCost = missingSkills.length * 2;
                    if (canBorrowAll && player.gold >= borrowCost + (card.cost || 0)) {
                        html += btn(`Borrow & Play (−${borrowCost}g)`, 'borrow_play', true);
                    }
                }
            }
            html += btn('✕ Discard (+3g)', 'discard', false);
            html += btn('⇄ Discard → Slide Ring (free)', 'discard_slide_pick', false);
            // The rulebook's optional beat: before choosing your action you
            // may pay gold to shift your ring (5g a space, one direction a
            // turn) — the board itself is the picker. Solo for now; paid
            // slides ride the next multiplayer protocol window.
            if (!mpActive() && player.gold >= 5) {
                html += btn('⟡ Pay to Slide (5g/space)', 'pay_slide', false);
            }
            html += '</div></div>';

            panel.innerHTML = html;
            // final-choice: the card lives in pending (not the hand), so
            // nothing blooms beside the panel — it must show the art itself.
            panel.classList.add('final-choice');
            if (!stayHidden) panel.classList.add('active');
            setTargetHighlights(card);
            if (typeof coachTick === 'function') coachTick();

            panel.querySelectorAll('[data-act]').forEach(b => {
                b.onclick = () => {
                    // The paid slide: the board overlay takes the stage (it
                    // steps this panel aside itself and restores it on
                    // close); a completed slide re-renders this chooser.
                    if (b.dataset.act === 'pay_slide') {
                        openBoardOverlay();
                        return;
                    }
                    // Slide is a two-step choice: the board opens in
                    // pick-a-slot mode; cancelling lands back here, chooser
                    // still up (hideActionPanel is guarded while pending).
                    if (b.dataset.act === 'discard_slide_pick') {
                        openSlidePickerFinal((direction) => {
                            finish(direction < 0 ? 'discard_slide_left' : 'discard_slide_right');
                        });
                        return;
                    }
                    // Borrow is two beats here too: pick the lender first.
                    // The panel steps aside directly (the pending guard
                    // stays armed); cancel re-surfaces it.
                    if (b.dataset.act === 'borrow_play') {
                        panel.classList.remove('active');
                        showBorrowChooser(card).then(chosen => {
                            if (!chosen) { panel.classList.add('active'); return; }
                            window._finalBorrowChoice = chosen;
                            finish('borrow_play');
                        });
                        return;
                    }
                    finish(b.dataset.act);
                };
            });
        };

        window._cardChoiceRerender = () => render(false);
        render(true);
    });
}

// Apply the chosen action through the normal engine paths — YOUR reveal,
// at exactly your seat's point in the activation order.
async function resolveCardChoice(card, cardIdx) {
    const act = await showCardChoice(card, cardIdx);

    if (mpActive()) {
        // The decision streams so every client applies it right here.
        const data = {
            action: (act === 'discard_slide_left' || act === 'discard_slide_right')
                ? 'discard_slide' : act,
        };
        if (act === 'discard_slide_left') data.dir = -1;
        if (act === 'discard_slide_right') data.dir = 1;
        if (act === 'borrow_play') {
            data.borrow = (window._finalBorrowChoice || []).map(b =>
                ({ skill: b.skill, lender: FMP.canonSeat(b.neighborIndex) }));
        }
        mpPub('act', data);
    }

    // Payoff-first beat (Wyatt): the engine resolves, the "+N" floats rise
    // off the fresh render, and the banner shows WITH them — then any
    // follow-up overlay (mission select) takes the stage.
    let bannerAction = 'discard';
    let pendingSelect = null;

    if (act === 'play') {
        game.activateCard(0, card.id, 'play');
        addLogEntry(cardIdx > 0 ? `You also play ${card.name}` : `You play ${card.name}`);
        bannerAction = 'play';
    } else if (act === 'borrow_play') {
        const chosen = window._finalBorrowChoice;
        window._finalBorrowChoice = null;
        const { borrowFrom, uncovered } = resolveBorrowPlan(card, chosen);
        if (uncovered) {
            game.activateCard(0, card.id, 'discard');
            showNotification(`No one can lend for ${card.name} anymore — discarded (+3g)`, 'error');
            addLogEntry(`No neighbor could lend for ${card.name} — discarded (+3 Gold)`);
        } else {
            const lenders = [...new Set(borrowFrom.map(b => game.players[b.neighborIndex].name))].join(' & ');
            game.activateCard(0, card.id, 'play', borrowFrom);
            addLogEntry(`You borrow from ${lenders} and play ${card.name}`);
            bannerAction = 'play';
        }
    } else if (act === 'mission_letter') {
        const result = game.activateCard(0, card.id, 'mission_letter');
        bannerAction = 'play';
        if (result && result.chooseMission) pendingSelect = 'mission_pick';
    } else if (act === 'discard_slide_left' || act === 'discard_slide_right') {
        game.activateCard(0, card.id, 'discard_slide', act === 'discard_slide_left' ? -1 : 1);
        addLogEntry(`You discard ${card.name} to slide your ring`);
        bannerAction = 'discard_slide';
        if (game.players[0]._pendingSlotMission) {
            game.players[0]._pendingSlotMission = false;
            pendingSelect = 'slot_mission';
        }
    } else {
        game.activateCard(0, card.id, 'discard');
        addLogEntry(`You discard ${card.name} (+3 Gold)`);
    }

    renderGameState();
    await showMiniSpotlight(card, bannerAction);

    if (pendingSelect) {
        renderGameState();
        if (mpActive()) window._mpMissionCtx = pendingSelect;
        await showMissionSelectAsync();
    }
}

// ─── PAID SLIDE ────────────────────────────────────────────

// Pay 5 Gold a space to shift your ring — the rulebook's optional beat at
// YOUR reveal, before you choose the card's action. (It used to be an
// anytime-action; the throw-first flow pins it to your turn, which is
// also exactly what the printed rules say.)
async function payToSlide(direction) {
    // Paid slides still sit out of multiplayer v1 — they'd need their own
    // streamed move (slot events cascade off a landing). Discard-to-slide
    // covers the ring in MP.
    if (mpActive()) {
        showNotification('Paid slides return in a future multiplayer update.', 'error');
        return;
    }
    if (!game || game.phase !== 'activate' || !window._finalChoicePending) {
        showNotification('The ring slides on your turn — when your card is revealed.', 'error');
        return;
    }


    const player = game.players[0];
    if (player.gold < 5) {
        showNotification('Need 5 Gold to move slider!', 'error');
        return;
    }

    const result = game.moveSlider(0, direction);
    if (result.success) {
        const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
        showNotification(`Slider moved to ${posNames[player.sliderPosition]} (\u22125g)`, 'play');
        addLogEntry(`You pay 5g to slide to ${posNames[player.sliderPosition]}`);
        renderGameState();
        renderBoardOvSlots();

        // Magician slot 2: choose a mission from the pool
        if (player._pendingSlotMission) {
            player._pendingSlotMission = false;
            await showMissionSelectAsync();
            renderGameState();
            renderBoardOvSlots();
        }

        // Magician slot 4: "Pick One" — the player chooses which skill.
        if (player._pendingSlotPick) {
            player._pendingSlotPick = null;
            await showSlotSkillPicker();
            renderGameState();
            renderBoardOvSlots();
        }

        // The slide can change what the revealed card needs — refresh the
        // chooser so Play/Need and the purse line tell the truth.
        if (window._cardChoiceRerender) window._cardChoiceRerender();
    } else {
        showNotification(result.error, 'error');
    }
}

// ─── THE REVEAL — activation in turn order ─────────────────

async function activateAllCards() {
    for (let round = 0; round < game.playerCount; round++) {
        const pi = (game.emblemHolder + round) % game.playerCount;
        const pending = game.pendingActivations[pi];
        if (!pending) continue;

        const cards = Array.isArray(pending) ? pending : [pending];

        for (let cardIdx = 0; cardIdx < cards.length; cardIdx++) {
            const card = cards[cardIdx];

            // Capture player 0's stats before activation for delta animation
            if (pi === 0) captureStats();

            if (pi === 0) {
                // YOUR reveal: the thrown card comes face up and you choose
                // what it does — play / borrow / letter / discard / slide —
                // with everything earlier seats did already on the table.
                // The auto-paired final card follows as a second choice.
                game.activePlayerIndex = pi;
                renderGameState();
                await resolveCardChoice(card, cardIdx);
            } else {
                game.activePlayerIndex = pi;
            }

            // Chemical Y just resolved for the human: pick which adventure
            // card doubles, before anything else moves.
            if (pi === 0 && game.players[0]._pendingChemYPick) {
                game.players[0]._pendingChemYPick = false;
                renderGameState();
                await showChemYPicker();
            }

            // Life Essence likewise: choose which active mission is freed
            // of its requirement, right where every client applies it.
            if (pi === 0 && game.players[0]._pendingLifeEssencePick) {
                game.players[0]._pendingLifeEssencePick = false;
                renderGameState();
                await showLifeEssencePicker();
            }

            // Chemical X: YOU move the ring, to any slot. This must run BEFORE the
            // two slot choosers below, because LANDING is what sets them — drop the
            // Magician on his mission slot or his Pick One slot and those fire next.
            if (pi === 0 && game.players[0]._pendingSliderMove) {
                game.players[0]._pendingSliderMove = false;
                renderGameState();
                await showChemXPicker();
            }

            // A slot event can fire from a CARD, not just a slide — Chemical X can
            // land the Magician on his mission slot. The discard-slide paths drain
            // this themselves (clearing the flag first, so this can't double-fire);
            // this is the catch-all for every other route. Without it the mission
            // was silently never granted, and the stale flag would then fire on a
            // later, unrelated slide.
            if (pi === 0 && game.players[0]._pendingSlotMission) {
                game.players[0]._pendingSlotMission = false;
                renderGameState();
                if (mpActive()) window._mpMissionCtx = 'slot_mission';
                await showMissionSelectAsync();
            }

            // The Magician's "Pick One" slot: YOU choose the skill, right where
            // every client applies it. Drained here rather than in one branch, so
            // it covers every path that can move your ring onto the slot — a
            // discard-slide, the final-card chooser, or Chemical X moving it free.
            if (pi === 0 && game.players[0]._pendingSlotPick) {
                game.players[0]._pendingSlotPick = null;
                renderGameState();
                await showSlotSkillPicker();
            }

            if (pi !== 0 && game.players[pi]._remoteHuman) {
                // Remote human — their streamed choice drives our engine
                // at exactly this point in the order on every client.
                await mpActivateRemote(pi, card, cardIdx);
            } else if (pi !== 0) {
                // AI player
                const isMissionLetter = card.type === 'mission_letter';

                if (isMissionLetter) {
                    // AI mission letter: use it if they have gold and missions available, else discard
                    if (game.players[pi].gold >= 1 && game.visibleMissions.length > 0) {
                        await showCardSpotlight(pi, card, 'play');
                        const result = game.activateCard(pi, card.id, 'mission_letter');
                        if (result && result.chooseMission) {
                            // AI picks the best mission they can complete
                            const bestIdx = aiBestMission(pi);
                            game.chooseMission(pi, bestIdx);
                            addLogEntry(`${game.players[pi].name} uses a Mission Letter`);
                        }
                    } else {
                        await showCardSpotlight(pi, card, 'discard');
                        game.activateCard(pi, card.id, 'discard');
                        addLogEntry(`${game.players[pi].name} discards ${card.name}`);
                    }
                } else {
                    const { canPlay } = game.checkRequirements(pi, card);
                    if (canPlay) {
                        await showCardSpotlight(pi, card, 'play');
                        game.activateCard(pi, card.id, 'play');
                        addLogEntry(`${game.players[pi].name} plays ${card.name}`);
                    } else {
                        await showCardSpotlight(pi, card, 'discard');
                        game.activateCard(pi, card.id, 'discard');
                        addLogEntry(`${game.players[pi].name} discards ${card.name}`);
                    }
                }
            }

            // Animate stat changes after each card resolves
            renderGameState();
            animateStatChanges();

            // YOUR payoff gets its beat: if "+N" floats just fired off your
            // stats, let them land before the next player's spotlight takes
            // the stage (Wyatt: the pluses were playing under rival turns).
            const hadFloats = _statFloatUntil > Date.now();
            await statFloatWait();

            const mine = (pi === 0);
            const lastOfMine = (cardIdx === cards.length - 1);
            const rivalsToCome = (round < game.playerCount - 1);

            // ...and when the NEXT beat is another player's full-screen
            // takeover, hold a breath of clear table so the gains register
            // (Wyatt: the popup was buried under the rivals' plays).
            //
            // On the last round of a hand YOUR two cards resolve back-to-back and
            // the rivals' spotlights used to start the instant the second landed —
            // Wyatt: "they blur past". So your handoff to the table now ALWAYS
            // gets a beat (not only when something happened to float), and it's
            // long enough to read the board you just built.
            if (lastOfMine && rivalsToCome && (mine || hadFloats)) {
                await new Promise(r => setTimeout(r, (mine ? 900 : 350) * window.CINEMATIC_SPEED));
            }

            // ARCHEUS — "All other Players must discard 1 weapon card they
            // have", resolved right where it was played. Drained here, OUTSIDE
            // any `pi === 0` gate, because the seats it hits are by definition
            // not the seat that played it: an AI playing Archeus has to be able
            // to prompt YOU. In MP the picks stream in canonical seat order so
            // every table applies the same weapons.
            await drainWeaponDiscards();

            // Breath between two cards from the SAME player. Yours arrive as a
            // pair on the final round, so they get room to read as two separate
            // moves instead of one smear. (Rivals keep the old brisk 300ms —
            // slowing them down would just make the whole game draggy.)
            if (cardIdx < cards.length - 1) {
                await new Promise(r => setTimeout(r, (mine ? 650 : 300) * window.CINEMATIC_SPEED));
            }
        }
    }
}

function finishRound() {
    const allEmpty = game.players.every(p => p.hand.length === 0);
    if (allEmpty) {
        renderGameState();
        setTimeout(() => endActPhases(), 1000);
    } else {
        game.phase = 'gameplay';
        game.pendingActivations = new Array(game.playerCount).fill(null);
        // Hands have rotated at least once — arms the coach's "hands travel
        // around the table" tip for the player's next throw.
        window._uxHandsPassed = true;
        renderGameState();
        beginThrowPhase();
    }
}

// ─── MISSION SELECT ────────────────────────────────────────

function showMissionSelectUI() {
    const overlay = document.getElementById('missionSelect');

    let html = '<div class="mission-select-content">';
    html += '<h2 class="select-title" style="font-size: 28px; margin-bottom: 6px;">Choose a Mission</h2>';
    html += '<div class="select-subtitle" style="font-size: 15px; margin-bottom: 14px;">Meet a mission’s skills by its due Act for big Favor — fall short and it costs Scorn.</div>';
    html += '<div class="mission-options">';

    game.visibleMissions.forEach((m, i) => {
        html += `
            <div class="mission-option" onclick="selectMission(${i})">
                <img src="assets/cards/missions/${m.filename}" alt="${m.name}"
                     data-peek="assets/cards/missions/${m.filename}">
                <div style="font-family: Cinzel, serif; color: var(--gold); margin-top: 8px; font-size: 14px;">${m.name}</div>
            </div>
        `;
    });

    html += '</div></div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');
    if (typeof coachTick === 'function') coachTick();
}

function showMissionSelectAsync() {
    return new Promise((resolve) => {
        window._missionSelectResolve = resolve;
        showMissionSelectUI();
    });
}

function selectMission(index) {
    // In multiplayer the pick streams so every client applies it at the
    // same point in the activation order (letter or slot-landing context
    // is set by whoever opened the select).
    if (mpActive() && window._mpMissionCtx) {
        mpPub(window._mpMissionCtx, { missionIdx: index });
        window._mpMissionCtx = null;
    }
    game.chooseMission(0, index);
    document.getElementById('missionSelect').classList.remove('active');
    if (typeof coachTick === 'function') coachTick();
    showNotification('Mission acquired!', 'mission');
    addLogEntry('You take a mission');

    // If called from immediate mission letter flow, resolve the Promise
    if (window._missionSelectResolve) {
        const resolve = window._missionSelectResolve;
        window._missionSelectResolve = null;
        resolve();
    } else {
        finishRound();
    }
}

// ─── AI ────────────────────────────────────────────────────

// Unmet skill units across a player's HELD missions — what its next card
// should feed. Pure math via unmetSkillReqs; NEVER checkMissionRequirements
// here (that consumes Life Essence). Mind's Eye / Philosopher's Stone gaps
// aren't card-feedable, so they stay out of the map.
function personaMissionNeeds(playerIndex) {
    const needs = {};
    const p = game.players[playerIndex];
    (p.missions || []).forEach(m => {
        const reqCounts = {};
        (m.requirements || []).forEach(r => {
            if (r !== 'minds_eye' && r !== 'philosopher_stone') {
                reqCounts[r] = (reqCounts[r] || 0) + 1;
            }
        });
        const unmet = game.unmetSkillReqs(playerIndex, reqCounts);
        Object.entries(unmet).forEach(([s, n]) => {
            needs[s] = Math.max(needs[s] || 0, n);
        });
    });
    return needs;
}

// AI picks the best available mission (highest favor value). Personas
// judge worth × feasibility instead: live favor estimate, minus how many
// skill units they're still short (the boon and mission rewards already
// flow through bonusSkills → skills, so feasibility sees them), plus a
// nudge toward their signature skills.
function aiBestMission(playerIndex) {
    const p = game.players[playerIndex];
    const persona = p && p._personaAI;
    let bestIdx = 0;
    let bestScore = -Infinity;
    game.visibleMissions.forEach((m, i) => {
        let score;
        if (persona) {
            score = game.missionFavorEstimate(playerIndex, m);
            const reqCounts = {};
            (m.requirements || []).forEach(r => {
                if (r !== 'minds_eye' && r !== 'philosopher_stone') {
                    reqCounts[r] = (reqCounts[r] || 0) + 1;
                }
            });
            const unmet = game.unmetSkillReqs(playerIndex, reqCounts);
            score -= 4 * Object.values(unmet).reduce((a, b) => a + b, 0);
            if ((m.requirements || []).some(r => persona.strong.includes(r))) score += 3;
        } else {
            score = m.favor || m.successReward?.favor || 0;
        }
        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    });
    return bestIdx;
}

function aiPickCard(playerIndex) {
    const player = game.players[playerIndex];
    if (!player.hand || player.hand.length === 0) return;

    // Persona layer: the permanent leaderboard rivals read the table
    // harder — cards feeding a held mission or their signature skills
    // outrank generic point salad, and Favor weighs like the win metric
    // it is. Sharper judgment only, never stat cheating.
    const persona = player._personaAI || null;
    const needs = persona ? personaMissionNeeds(playerIndex) : null;

    let bestIndex = 0;
    let bestScore = -1;

    player.hand.forEach((card, i) => {
        let score = 0;
        if (card.skills) score += card.skills.length * 2;
        if (card.rewards) {
            if (card.rewards.gold) score += card.rewards.gold;
            if (card.rewards.prestige) score += card.rewards.prestige * 3;
            if (card.rewards.favor) score += card.rewards.favor * 2;
            if (card.rewards.scorn) score -= card.rewards.scorn * 2;
        }
        if (card.skills && card.skills.includes('power')) score += 3;

        const { canPlay } = game.checkRequirements(playerIndex, card);
        if (canPlay) score += 5;

        if (persona) {
            (card.skills || []).forEach(s => {
                if (needs[s] > 0) score += 6;
                if (persona.strong.includes(s)) score += 2;
            });
            if ((card.favor || 0) > 0) score += Math.min(card.favor, 12) / 2;
            if (card.rewards && card.rewards.scorn) score -= card.rewards.scorn;
        }

        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    });

    game.pickCard(playerIndex, bestIndex);
}

// ─── END OF ACT ────────────────────────────────────────────

// async since 7/14: the held-mission chooser below has to be awaited BEFORE
// resolveMissions runs. The tail is still the same promise chain (ceremony →
// borrows → penalty → promise → melee), and the single caller fires this and
// forgets it, so returning a promise changes nothing for anyone.
async function endActPhases() {
    const actNum = game.currentAct;

    // MISSIONS PHASE — resolve everything, then let the ceremony tell it
    // player by player (toast spam used to blow past in a blur).
    game.phase = 'missions';
    renderGameState();

    // HELD MISSIONS — a mission inside its window but not yet due is YOUR call,
    // every act until it is forced. Asked BEFORE resolveMissions on purpose: an
    // attempt then rides the same road as a due mission (checked before any
    // failure penalty lands, same borrow rescue, same ceremony line) instead of
    // bolting a second resolution path on afterwards.
    // Multiplayer stages every seat's decision in canonical order first, so all
    // clients enter resolveMissions with identical _attemptNow flags.
    if (mpActive()) {
        await mpHeldMissionStages();
    } else {
        for (const m of game.postponableMissions(0)) {
            const attempt = await showEarlyMissionChoice(m);
            if (attempt) m._attemptNow = true;
            else addLogEntry(`You hold ${m.name} — due at the end of Act ${game.missionDueAct(m)}`);
        }
        // With more than one mission resolving this act, YOU choose the order —
        // completing one can hand you the skills/Favor the next needs (Wyatt
        // 7/17). Solo only: MP resolves in canonical seat order for lockstep.
        await chooseMissionOrder();
    }

    const missionResults = game.resolveMissions();

    let hasMissionResults = false;
    missionResults.forEach(pr => {
        pr.results.forEach(r => {
            hasMissionResults = true;
            const playerName = pr.playerIndex === 0 ? 'You' : game.players[pr.playerIndex].name;
            addLogEntry(`${playerName} ${r.success ? 'completed' : 'failed'} mission: ${r.mission.name}`);
        });
    });

    if (!hasMissionResults) {
        addLogEntry('No missions resolved this act');
    }

    // A PROMISE — the player chooses how many played cards to sacrifice
    // (+8 Prestige each) before the Melee begins. In multiplayer the
    // canonical-order stage loop owns the flag instead (mpEndActStages).
    const promisePending = mpActive() ? false : game.players[0]._pendingPromiseDiscard;
    if (promisePending) game.players[0]._pendingPromiseDiscard = false;

    // MISSION BORROW — due missions short only on borrowable skills were
    // paused by resolveMissions (same pause pattern as the penalty picker).
    // The player decides each one FIRST: a declined mission fails here, so
    // its own "Discard N" penalty joins the picker read below.
    const borrowsPending = (game.players[0]._pendingMissionBorrows || []).slice();
    game.players[0]._pendingMissionBorrows = [];

    // MELEE PHASE
    const meleeStart = 600;

    const startMelee = () => setTimeout(() => {
        game.phase = 'melee';
        renderGameState();
        const meleeResults = game.resolveMelee();

        if (meleeResults.length > 0) {
            const ordinals = ['1st', '2nd', '3rd', '4th', '5th'];
            addLogEntry(`--- Act ${actNum} Melee ---`);
            meleeResults.forEach(r => {
                addLogEntry(`${ordinals[r.placement - 1] || r.placement + 'th'}: ${r.name} \u2014 Power ${r.power}, +${r.prestige} Prestige`);
            });
        }

        // ACT TRANSITION \u2014 after the Melee splash has had its moment.
        const advanceAct = () => {
            const result = game.endAct();
            if (result === 'scoring') {
                showScoring();
            } else {
                addLogEntry(`\u2550\u2550\u2550 Act ${game.currentAct} begins \u2550\u2550\u2550`);
                showNotification(`Act ${game.currentAct} Begins!`, 'act');
                // The act boundary passed the Emblem one seat clockwise
                // (engine startAct) \u2014 say so, the whole order just shifted.
                const hn = game.emblemHolder === 0 ? 'you' : game.players[game.emblemHolder].name;
                showNotification(`The Emblem passes to ${hn}${hn === 'you' ? ' \u2014 you act first' : ''}.`, 'act');
                addLogEntry(`The Emblem passes to ${hn}`);
                renderGameState();
                // Desync insurance: stamp + baseline at the same canonical
                // point on every client — before the throw phase mutates.
                if (mpActive()) mpActBaseline();
                beginThrowPhase();
            }
        };

        if (meleeResults.length > 0) {
            showMeleeSplash(meleeResults, actNum).then(() => {
                // The player has now SEEN a melee — arms the coach's
                // "that clash was the Melee" tip once the table returns.
                window._uxMeleeDone = true;
                setTimeout(advanceAct, 450);
            });
        } else {
            setTimeout(advanceAct, 2000);
        }
    }, meleeStart);

    // Multiplayer: every seat's end-of-act choices (borrows, penalty
    // picks, A Promise) resolve in CANONICAL order inside one stage so
    // all clients mutate the engine at identical points. Solo keeps the
    // classic local-first chain.
    const afterBorrows = mpActive()
        ? () => mpEndActStages(borrowsPending)
        : () => borrowsPending.reduce(
            (chain, m) => chain.then(() => showMissionBorrowChooser(m)), Promise.resolve());
    // PENALTY DISCARD — a failed mission says "Discard N Cards": the player
    // picks which (physical-game agency), not the engine. Read AFTER the
    // borrow choosers so declined missions' penalties are included.
    const afterPenalty = () => {
        if (mpActive()) return Promise.resolve();   // handled in the stage loop
        const penaltyPending = game.players[0]._pendingPenaltyDiscard || 0;
        game.players[0]._pendingPenaltyDiscard = 0;
        return penaltyPending ? showPenaltyDiscardPicker(penaltyPending) : Promise.resolve();
    };
    const afterPromise = promisePending
        ? () => showPromiseDiscardPicker()
        : () => Promise.resolve();
    // The ceremony narrates every resolution first; the stats it changed
    // repaint before the player is asked to make any follow-up choice.
    // A resolution that DEALT missions (Midnight Crash) gets its own beat right
    // after — you see the card you were handed before the act moves on.
    showMissionCeremony(missionResults, actNum)
        .then(() => showMissionDrawBeat())
        .then(() => renderGameState())
        .then(afterBorrows).then(afterPenalty).then(afterPromise)
        // A mission FAILED by declining its borrow (Let it Fail) records its
        // draws HERE, after the first beat already ran — surface them now so a
        // Midnight-Crash Act-3 mission is never handed out in silence (Wyatt 7/17).
        .then(() => showMissionDrawBeat())
        .then(() => renderGameState())
        .then(startMelee);
}

// ═══ BORROW & PLAY — "from whom?" ═══════════════════════════════════
// Tapping Borrow & Play asks WHICH neighbor lends before anything moves:
// both neighbors always take the stage (the 2g-per-skill fee goes TO the
// lender, so the pick matters) and a neighbor with nothing to lend sits
// grayed with the reason. On the Merchant's borrow-any slot the whole
// table appears. Resolves [{skill, neighborIndex}] — or null on cancel.
function showBorrowChooser(card) {
    return new Promise((resolve) => {
        const ov = document.getElementById('promisePicker');
        const { missingSkills } = game.checkRequirements(0, card);
        const borrowable = game.getBorrowableSkills(0);
        if (!ov || missingSkills.length === 0) { resolve(null); return; }

        const n = game.playerCount;
        const p0 = game.players[0];
        const curSlot = p0.character && p0.character.slots ? p0.character.slots[p0.sliderPosition] : null;
        const anyLender = curSlot && curSlot.special === 'borrow_any_player';
        const leftPi = (n - 1) % n, rightPi = 1 % n;
        const seats = anyLender
            ? [...Array(n).keys()].filter(i => i !== 0)
            : [...new Set([leftPi, rightPi])];

        // Units of the same skill share one lender (the table habit);
        // distinct skills each pick their own.
        const counts = {};
        missingSkills.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
        const sections = Object.entries(counts);   // [skill, units]
        const single = sections.length === 1;
        const choice = {};                          // skill -> lender pi
        const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
        const totalCost = missingSkills.length * 2;

        const seatTag = pi => {
            if (anyLender) return '';
            if (pi === leftPi) return '<span class="bw-tag">◀ Left Neighbor</span>';
            if (pi === rightPi) return '<span class="bw-tag">Right Neighbor ▶</span>';
            return '';
        };

        const finish = (result) => {
            ov.classList.remove('active');
            resolve(result);
        };

        const render = () => {
            const sectionHtml = sections.map(([skill, units]) => {
                const fee = units * 2;
                const head = single
                    ? ''
                    : `<div class="bw-skill-head">${cap(skill)}${units > 1 ? ' ×' + units : ''} — ${fee}g to its lender</div>`;
                const seatCards = seats.map(pi => {
                    const pl = game.players[pi];
                    const has = !!(borrowable[skill] && borrowable[skill].includes(pi));
                    const on = choice[skill] === pi;
                    const art = pl.character ? `assets/characters/${pl.character.filename}` : 'assets/ui/cover.jpg';
                    const note = has ? `+${fee}g to their purse` : `No ${cap(skill)} to lend`;
                    return `<div class="bw-row${has ? '' : ' off'}${on ? ' on' : ''}" data-skill="${skill}" data-pi="${pi}">
                                <img class="bw-art" src="${art}" alt="${pl.name}">
                                ${seatTag(pi)}
                                <span class="bw-name">${pl.name}</span>
                                <span class="bw-note">${note}</span>
                            </div>`;
                }).join('');
                const undecided = !single && choice[skill] === undefined;
                return `<div class="bw-section${undecided ? ' undecided' : ''}" data-skill="${skill}">
                            ${head}<div class="bw-rows">${seatCards}</div>
                        </div>`;
            }).join('');

            const needTxt = sections.map(([s, u]) => `${cap(s)}${u > 1 ? ' ×' + u : ''}`).join(', ');
            const ready = sections.every(([s]) => choice[s] !== undefined);

            // Sections live in their own scroller; the title and the
            // Confirm/Cancel row stay pinned — a multi-skill borrow can
            // outgrow a phone screen (Wyatt 7/8: the second lender and
            // the buttons sat unreachable below the fold).
            ov.innerHTML = `
                <div class="pp-inner bw">
                    <div class="pp-title">Borrow &amp; Play</div>
                    <div class="pp-sub"><b>${card.name}</b> needs <b>${needTxt}</b> —
                        ${single ? 'tap the neighbor who lends it' : 'pick a lender for each skill'}.
                        The fee is paid <b>to them</b>${anyLender ? ' · your Merchant slot lets anyone lend' : ''}.</div>
                    <div class="bw-scroll">${sectionHtml}</div>
                    <div class="pp-actions">
                        ${single ? '' : `<button class="btn-royal primary" id="bwConfirm" ${ready ? '' : 'disabled style="opacity:.35"'}><span>Borrow &amp; Play (−${totalCost}g)</span></button>`}
                        <button class="btn-royal" id="bwCancel"><span>Cancel</span></button>
                    </div>
                </div>`;

            ov.querySelectorAll('.bw-row:not(.off)').forEach(el => {
                el.onclick = () => {
                    const skill = el.dataset.skill;
                    const pi = parseInt(el.dataset.pi, 10);
                    // One missing skill = tap-to-commit (the Borrow & Play tap
                    // already said "yes"); several = assemble, then confirm.
                    if (single) { finish(missingSkills.map(s => ({ skill: s, neighborIndex: pi }))); return; }
                    choice[skill] = pi;
                    render();
                    // Carry the player to the next open decision.
                    requestAnimationFrame(() => {
                        const next = ov.querySelector('.bw-section.undecided');
                        if (next) next.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                };
            });
            const confirmBtn = ov.querySelector('#bwConfirm');
            if (confirmBtn) confirmBtn.onclick = () => {
                if (!sections.every(([s]) => choice[s] !== undefined)) return;
                finish(missingSkills.map(s => ({ skill: s, neighborIndex: choice[s] })));
            };
            ov.querySelector('#bwCancel').onclick = () => finish(null);
        };

        render();
        ov.classList.add('active');
    });
}

// Chosen lenders are validated at ACTIVATION time — between the click and
// the activation a lender can slide off the very slot that granted the
// skill. Stale picks fall back to any current lender; a skill nobody can
// lend anymore leaves the plan uncovered (the caller discards honestly).
function resolveBorrowPlan(card, chosen) {
    const { missingSkills } = game.checkRequirements(0, card);
    const borrowable = game.getBorrowableSkills(0);
    const pool = Array.isArray(chosen) ? chosen.slice() : [];
    const borrowFrom = missingSkills.map(s => {
        const ci = pool.findIndex(b => b.skill === s);
        const pick = ci >= 0 ? pool.splice(ci, 1)[0] : null;
        if (pick && borrowable[s] && borrowable[s].includes(pick.neighborIndex)) return pick;
        return { skill: s, neighborIndex: borrowable[s] ? borrowable[s][0] : undefined };
    });
    return { borrowFrom, uncovered: borrowFrom.some(b => b.neighborIndex === undefined) };
}

// ═══ MISSION BORROW — a due mission, short only on borrowable skills ════
// The physical-table move: a neighbor lends the skill for 2g a unit.
// Entirely OPTIONAL — failing on purpose is a real strategy, so the
// chooser always offers both doors and nothing is ever auto-borrowed.
// ═══ HELD MISSION — attempt it now, or hold it for a later act ═══════════
// A mission inside its window but not yet DUE is the player's call. Wanted:
// Crazy Lou activates in Act 1 and is only forced at the end of Act 3, so it
// asks at every act boundary until then: cash it in on what you have (pass OR
// fail — failing on purpose is a legitimate play), or hold it and be asked
// again. Asked BEFORE resolveMissions so an attempt rides exactly the same
// road as a due mission: checked before any failure penalty lands, and offered
// the same borrow rescue.
// ── Mission activation order (solo) — tap your missions in the order you
// want to turn them in. resolveMissions walks player.missions in array order
// and applies each success's rewards before checking the next, so ordering a
// resource-granting mission first can complete the rest (Wyatt 7/17).
function chooseMissionOrder() {
    return new Promise((resolve) => {
        const p = game.players[0];
        // Missions that WILL resolve this act: due (forced) or attempted.
        const resolving = (p.missions || []).filter(m =>
            m.activationRound && m.activationRound <= game.currentAct
            && (game.missionDueAct(m) <= game.currentAct || m._attemptNow === true));
        const ov = document.getElementById('promisePicker');
        if (!ov || resolving.length < 2) { resolve(); return; }

        const order = [];   // missions in chosen order
        const render = () => {
            const cards = resolving.map(m => {
                const pos = order.indexOf(m);
                const picked = pos >= 0;
                return `<div class="mo-card${picked ? ' picked' : ''}" data-id="${m.id}">
                        <img src="assets/cards/missions/${m.filename}" alt="${m.name}">
                        ${picked ? `<span class="mo-badge">${pos + 1}</span>` : ''}
                        <span class="mo-name">${m.name}</span>
                    </div>`;
            }).join('');
            const ready = order.length === resolving.length;
            ov.innerHTML = `
                <div class="pp-inner mo-due">
                    <div class="pp-title">Turn-In Order</div>
                    <div class="pp-sub">You hold <b>${resolving.length} missions</b> this act — tap them in the order to attempt.
                        An earlier success can hand you what the next one needs.</div>
                    <div class="mo-grid">${cards}</div>
                    <div class="pp-actions">
                        <button class="btn-royal" id="moReset"><span>Reset</span></button>
                        <button class="btn-royal primary" id="moGo" ${ready ? '' : 'disabled style="opacity:.35"'}><span>Confirm Order</span></button>
                    </div>
                </div>`;
            ov.querySelectorAll('.mo-card').forEach(el => {
                el.onclick = () => {
                    const m = resolving.find(x => String(x.id) === el.dataset.id);
                    if (!m || order.includes(m)) return;
                    order.push(m);
                    render();
                };
            });
            ov.querySelector('#moReset').onclick = () => { order.length = 0; render(); };
            const go = ov.querySelector('#moGo');
            if (go) go.onclick = () => {
                ov.classList.remove('active');
                // Reorder player.missions: chosen resolving order first, rest after.
                const rest = p.missions.filter(m => !order.includes(m));
                p.missions = [...order, ...rest];
                addLogEntry(`You set the turn-in order: ${order.map(m => m.name).join(' → ')}`);
                resolve();
            };
        };
        render();
        ov.classList.add('active');
    });
}

function showEarlyMissionChoice(mission) {
    return new Promise((resolve) => {
        const ov = document.getElementById('promisePicker');
        const mi = game.players[0].missions.indexOf(mission);
        if (!ov || mi < 0) { resolve(false); return; }

        const due = game.missionDueAct(mission);
        // PURE probe — checkMissionRequirements would CONSUME a held Life
        // Essence just to label a button the player might not even press.
        const { success } = game.probeMissionRequirements(0, mission);
        const plan = success ? null : game.missionBorrowPlan(0, mission);

        const verdict = success
            ? 'Requirements <b>met</b> — turn it in and it succeeds.'
            : plan
                ? `You're short, but a neighbour can lend the gap for <b>${plan.cost} Gold</b>.`
                : 'Requirements <b>not met</b> — attempting it now would FAIL it.';

        ov.innerHTML = `
            <div class="pp-inner">
                <div class="pp-title">${mission.name}</div>
                <div class="pp-sub">Due at the end of <b>Act ${due}</b> — you may attempt it in any act until then. ${verdict}</div>
                <div class="pp-cards"><div class="pp-card" style="cursor:default">
                    <img src="assets/cards/missions/${mission.filename}" alt="${mission.name}"
                         style="width:auto;height:min(42vh,340px)">
                </div></div>
                <div class="pp-actions">
                    <button class="btn-royal${success || plan ? ' primary' : ''}" id="emAttempt">
                        <span>${success ? '✓ Attempt Now' : (plan ? 'Attempt Now — borrow the gap' : 'Attempt Now (you would FAIL)')}</span>
                    </button>
                    <button class="btn-royal" id="emHold"><span>Hold until Act ${due}</span></button>
                </div>
            </div>`;

        const close = (attempt) => {
            // Stream it: every other client applies the SAME decision for this
            // seat, in canonical order, BEFORE resolveMissions runs — so
            // _attemptNow is identical everywhere and the tables cannot fork.
            mpPub('mission_hold', { attempt, missionName: mission.name });   // no-op solo
            ov.classList.remove('active');
            ov.innerHTML = '';
            resolve(attempt);
        };
        // Throwing a mission away on purpose is legitimate — but never on one
        // stray click. Same two-click arm as the mission lightbox's Turn In.
        let armed = success || !!plan;
        const btn = ov.querySelector('#emAttempt');
        btn.onclick = () => {
            if (!armed) {
                armed = true;
                btn.querySelector('span').textContent = 'Click again to attempt it and FAIL';
                return;
            }
            close(true);
        };
        ov.querySelector('#emHold').onclick = () => close(false);
        ov.classList.add('active');
    });
}

// A mission resolved OUTSIDE resolveMissions still deserves the same beat,
// for ANY seat. Wyatt 7/18: "it really needs to be understandable for all
// players, each mission that gets played." Five paths reached a mission's end
// with nothing but a toast or a log line — a remote seat declining a borrow in
// MP, the local player's deliberate turn-in-and-fail, an early turn-in
// success, an early borrow-and-complete. They share this now.
//
// `apply` must be the engine call that resolves the mission; whatever it
// returns is read for {success, cost}. Measured through the engine so the
// beat carries the discarded cards, the conditional gates that missed and
// every OTHER seat it moved — exactly like a due-date resolution.
function missionBeat(playerIndex, idx, apply) {
    const p = game.players[playerIndex];
    const mission = p && p.missions[idx];
    if (!mission) { const r = apply(); renderGameState(); return Promise.resolve(r); }
    // Read the shortfall BEFORE the resolution applies — afterwards the
    // mission is off the books and a discard penalty may have stripped the
    // very skills we want to report on.
    const { details } = game.checkMissionRequirements(playerIndex, mission);
    let res;
    const deltas = game.measureResolution(playerIndex, () => { res = apply(); });
    renderGameState();
    const beat = {
        mission, success: !!(res && res.success), deltas, details,
        borrowed: (res && res.cost) || 0,
    };
    return showMissionCeremony([{ playerIndex, results: [beat] }], game.currentAct)
        .then(() => res);
}

function failMissionWithBeat(playerIndex, idx) {
    return missionBeat(playerIndex, idx, () => game.failMissionByChoice(playerIndex, idx));
}

function showMissionBorrowChooser(mission) {
    return new Promise((resolve) => {
        const ov = document.getElementById('promisePicker');
        const mi = game.players[0].missions.indexOf(mission);
        const plan = mi >= 0 ? game.missionBorrowPlan(0, mission) : null;

        // A declined mission used to die as a toast — fired while the NEXT
        // chooser was already on stage, so Alchemic Seige's +20 Prestige fail
        // reward landed with zero feedback on 7/18's recording. Fail it with
        // measured deltas and give it a real ceremony beat; the promise chain
        // holds the next chooser until the beat has played.
        const failWithBeat = (idx) => failMissionWithBeat(0, idx);

        if (!ov || mi < 0 || !plan) {
            // The window closed between phases — resolve it honestly as the
            // failure it already was at its due date.
            if (mi >= 0) { failWithBeat(mi).then(resolve); return; }
            resolve();
            return;
        }

        // WHO lends is the player's call, not the engine's. The 2g-per-unit fee
        // is paid TO the lender, so handing it to the leader is a real cost —
        // this used to silently take the first available neighbor. Same chooser
        // the card Borrow & Play uses, so the move reads the same in both places.
        const borrowable = game.getBorrowableSkills(0);
        const n = game.playerCount;
        const p0 = game.players[0];
        const curSlot = p0.character && p0.character.slots ? p0.character.slots[p0.sliderPosition] : null;
        const anyLender = curSlot && curSlot.special === 'borrow_any_player';
        const leftPi = (n - 1) % n, rightPi = 1 % n;
        const seats = anyLender
            ? [...Array(n).keys()].filter(i => i !== 0)
            : [...new Set([leftPi, rightPi])];

        // Units of the same skill share one lender (the table habit);
        // distinct skills each pick their own.
        const counts = {};
        plan.borrowFrom.forEach(b => { counts[b.skill] = (counts[b.skill] || 0) + 1; });
        const sections = Object.entries(counts);      // [skill, units]
        const single = sections.length === 1;
        const choice = {};                            // skill -> lender pi
        const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
        const shortTxt = sections
            .map(([sk, u]) => `${cap(sk)}${u > 1 ? ' ×' + u : ''}`).join(', ');

        const seatTag = (pi) => {
            if (anyLender) return '';
            if (pi === leftPi) return '<span class="bw-tag">◀ Left Neighbor</span>';
            if (pi === rightPi) return '<span class="bw-tag">Right Neighbor ▶</span>';
            return '';
        };

        const finish = (chosen) => {
            ov.classList.remove('active');
            const idx = game.players[0].missions.indexOf(mission);
            // Stream the LENDERS too, not just yes/no — a peer that re-picked
            // the first neighbor itself would pay a different purse and fork.
            mpPub('mission_borrow', {
                accept: !!chosen, missionName: mission.name,
                borrowFrom: chosen || null,
            });
            if (!chosen) {
                addLogEntry(`You let ${mission.name} fail`);
                failWithBeat(idx).then(resolve);
                return;
            }
            const res = game.completeMissionWithBorrow(0, idx, chosen);
            if (res.success) {
                const names = [...new Set(chosen.map(b => game.players[b.neighborIndex].name))].join(' & ');
                showNotification(`Mission complete: ${mission.name}! (−${res.cost}g to ${names})`, 'mission');
                addLogEntry(`You borrow from ${names} (−${res.cost}g) and complete ${mission.name}`);
            } else {
                // The plan died under the click — the due date still rules.
                addLogEntry(`You fail ${mission.name}`);
                failWithBeat(idx).then(resolve);
                return;
            }
            renderGameState();
            resolve();
        };

        const render = () => {
            const sectionHtml = sections.map(([skill, units]) => {
                const fee = units * 2;
                const head = single
                    ? ''
                    : `<div class="bw-skill-head">${cap(skill)}${units > 1 ? ' ×' + units : ''} — ${fee}g to its lender</div>`;
                const seatCards = seats.map(pi => {
                    const pl = game.players[pi];
                    const has = !!(borrowable[skill] && borrowable[skill].includes(pi));
                    const on = choice[skill] === pi;
                    const art = pl.character ? `assets/characters/${pl.character.filename}` : 'assets/ui/cover.jpg';
                    const note = has ? `+${fee}g to their purse` : `No ${cap(skill)} to lend`;
                    return `<div class="bw-row${has ? '' : ' off'}${on ? ' on' : ''}" data-skill="${skill}" data-pi="${pi}">
                                <img class="bw-art" src="${art}" alt="${pl.name}">
                                ${seatTag(pi)}
                                <span class="bw-name">${pl.name}</span>
                                <span class="bw-note">${note}</span>
                            </div>`;
                }).join('');
                const undecided = !single && choice[skill] === undefined;
                return `<div class="bw-section${undecided ? ' undecided' : ''}" data-skill="${skill}">
                            ${head}<div class="bw-rows">${seatCards}</div>
                        </div>`;
            }).join('');

            const ready = sections.every(([sk]) => choice[sk] !== undefined);

            // Two columns (Wyatt 7/17): the mission card rides the SIDE while the
            // neighbour boards + the fail door sit up top beside it — the whole
            // decision fits one screen, no scrolling to reach "Let it Fail".
            ov.innerHTML = `
                <div class="pp-inner bw mb-due">
                    <div class="pp-title">Mission Due: ${mission.name}</div>
                    <div class="mb-layout">
                        <div class="mb-mission">
                            <img src="assets/cards/missions/${mission.filename}" alt="${mission.name}">
                        </div>
                        <div class="mb-choose">
                            <div class="pp-sub">You're short <b>${shortTxt}</b> —
                                ${single ? 'tap the neighbor who lends it' : 'pick a lender for each skill'}.
                                The fee is paid <b>to them</b>${anyLender ? ' · your Merchant slot lets anyone lend' : ''}.
                                Letting it fail is a real play.</div>
                            <div class="bw-scroll">${sectionHtml}</div>
                            <div class="pp-actions">
                                ${single ? '' : `<button class="btn-royal primary" id="mbConfirm" ${ready ? '' : 'disabled style="opacity:.35"'}><span>Borrow &amp; Complete (−${plan.cost}g)</span></button>`}
                                <button class="btn-royal" id="mbFail"><span>Let it Fail</span></button>
                            </div>
                        </div>
                    </div>
                </div>`;

            const expand = () => plan.borrowFrom.map(b => ({ skill: b.skill, neighborIndex: choice[b.skill] }));

            ov.querySelectorAll('.bw-row:not(.off)').forEach(el => {
                el.onclick = () => {
                    const skill = el.dataset.skill;
                    const pi = parseInt(el.dataset.pi, 10);
                    choice[skill] = pi;
                    // One missing skill = tap-to-commit; several = assemble, then confirm.
                    if (single) { finish(expand()); return; }
                    render();
                    requestAnimationFrame(() => {
                        const next = ov.querySelector('.bw-section.undecided');
                        if (next) next.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                };
            });
            const confirmBtn = ov.querySelector('#mbConfirm');
            if (confirmBtn) confirmBtn.onclick = () => {
                if (!sections.every(([sk]) => choice[sk] !== undefined)) return;
                finish(expand());
            };
            ov.querySelector('#mbFail').onclick = () => finish(null);
        };

        render();
        ov.classList.add('active');
    });
}

// ═══ PENALTY DISCARD — a failed mission takes N cards; YOU pick which ═══
function showPenaltyDiscardPicker(n) {
    return new Promise((resolve) => {
        const ov = document.getElementById('promisePicker');
        const player = game.players[0];
        const mustPick = Math.min(n, player.playedCards.length);
        if (!ov || !mustPick) { resolve(); return; }

        const chosen = new Set();
        const render = () => {
            const cards = player.playedCards.map((c, i) => `
                <div class="pp-card${chosen.has(i) ? ' chosen' : ''}" data-i="${i}">
                    <img src="assets/cards/regular/${c.filename}" alt="${c.name}">
                    <span class="pp-x">✕</span>
                </div>`).join('');
            const ready = chosen.size === mustPick;
            ov.innerHTML = `
                <div class="pp-inner">
                    <div class="pp-title">The Price of Failure</div>
                    <div class="pp-sub">Choose <b>${mustPick}</b> played card${mustPick > 1 ? 's' : ''} to discard (${chosen.size}/${mustPick})</div>
                    <div class="pp-cards">${cards}</div>
                    <div class="pp-actions">
                        <button class="btn-royal primary" id="ppConfirm" ${ready ? '' : 'disabled style="opacity:.35"'}>
                            <span>Discard ${mustPick}</span>
                        </button>
                    </div>
                </div>`;
            ov.querySelectorAll('.pp-card').forEach(el => {
                el.onclick = () => {
                    const i = parseInt(el.dataset.i, 10);
                    if (chosen.has(i)) chosen.delete(i);
                    else if (chosen.size < mustPick) chosen.add(i);
                    render();
                };
            });
            ov.querySelector('#ppConfirm').onclick = () => {
                if (chosen.size !== mustPick) return;
                const picked = [...chosen].map(i => player.playedCards[i]);
                mpPub('penalty', { cardIds: picked.map(c => c.id) });
                const removed = game.discardPlayedCards(0, c => picked.includes(c), mustPick);
                addLogEntry(`You discard ${removed} card(s) to a failed mission`);
                ov.classList.remove('active');
                renderGameState();
                resolve();
            };
        };
        render();
        ov.classList.add('active');
    });
}

// ═══ ARCHEUS — the victim chooses which weapon they give up ══════════
// "All other Players must discard 1 weapon card they have." The engine used
// to take the first weapon in play order, silently, from everyone.
function showWeaponDiscardPicker(mustPick) {
    return new Promise((resolve) => {
        const ov = document.getElementById('promisePicker');
        const player = game.players[0];
        const weapons = player.playedCards.filter(c => c.type === 'weapon');
        if (!ov || !weapons.length || !mustPick) {
            // Publish an EMPTY pick even when there is nothing to give up.
            // The engine only flags a seat that holds a weapon, so this
            // should be unreachable — but a peer awaiting 'weapon' that
            // never arrives sits until the AFK clock boots them, and a
            // silent boot is a far worse failure than a wasted message.
            mpPub('weapon', { cardIds: [] });
            resolve();
            return;
        }
        const need = Math.min(mustPick, weapons.length);

        const chosen = new Set();
        const render = () => {
            const cards = weapons.map((c, i) => `
                <div class="pp-card${chosen.has(i) ? ' chosen' : ''}" data-i="${i}">
                    <img src="assets/cards/regular/${c.filename}" alt="${c.name}">
                    <span class="pp-x">✕</span>
                </div>`).join('');
            const ready = chosen.size === need;
            ov.innerHTML = `
                <div class="pp-inner">
                    <div class="pp-title">Archeus Demands a Blade</div>
                    <div class="pp-sub">Choose <b>${need}</b> weapon${need > 1 ? 's' : ''} to discard (${chosen.size}/${need})</div>
                    <div class="pp-cards">${cards}</div>
                    <div class="pp-actions">
                        <button class="btn-royal primary" id="ppConfirm" ${ready ? '' : 'disabled style="opacity:.35"'}>
                            <span>Discard ${need}</span>
                        </button>
                    </div>
                </div>`;
            ov.querySelectorAll('.pp-card').forEach(el => {
                el.onclick = () => {
                    const i = parseInt(el.dataset.i, 10);
                    if (chosen.has(i)) chosen.delete(i);
                    else if (chosen.size < need) chosen.add(i);
                    render();
                };
            });
            ov.querySelector('#ppConfirm').onclick = () => {
                if (chosen.size !== need) return;
                const picked = [...chosen].map(i => weapons[i]);
                mpPub('weapon', { cardIds: picked.map(c => c.id) });
                game.discardPlayedCards(0, c => picked.includes(c), need);
                addLogEntry(`Archeus forces you to discard ${picked.map(c => c.name).join(', ')}`);
                ov.classList.remove('active');
                renderGameState();
                resolve();
            };
        };
        render();
        ov.classList.add('active');
    });
}

// Drain Archeus's demand across EVERY seat it hit, in canonical order.
// Unlike the play-time pickers this is not gated on the seat that just
// played — Archeus hits everyone ELSE by definition, which is exactly why
// the old `pi === 0` shaped drains would never have fired for it.
// In MP the local pick is published and remote humans are awaited, so all
// clients apply the same weapons in the same order; a booted or silent seat
// falls back to the engine's deterministic keep-score, which every client
// computes identically.
async function drainWeaponDiscards() {
    const n = game.playerCount;
    const owed = (p) => p._pendingWeaponDiscard || 0;

    // AI victims already resolved inside the engine — narrate them into the
    // VISIBLE feed. The engine's addLog only ever reached the save snapshot,
    // which is why Wyatt's first-played weapon went silently.
    (game._archeusTook || []).forEach(({ playerIndex, cards }) => {
        addLogEntry(`Archeus forces ${game.players[playerIndex].name} to discard ${cards.map(c => c.name).join(', ')}`);
    });
    game._archeusTook = [];

    if (!game.players.some(owed)) return;

    if (!mpActive()) {
        for (let i = 0; i < n; i++) {
            const p = game.players[i];
            if (!owed(p)) continue;
            const k = owed(p);
            p._pendingWeaponDiscard = 0;
            if (i === 0) {
                renderGameState();
                await showWeaponDiscardPicker(k);
            }
        }
        return;
    }

    for (let cs = 0; cs < n; cs++) {
        const li = FMP.localIdx(cs);
        const p = game.players[li];
        if (!owed(p)) continue;
        const k = owed(p);
        p._pendingWeaponDiscard = 0;
        if (li === 0) {
            await showWeaponDiscardPicker(k);       // publishes inside
        } else {
            mpWaitShow(li, 'choosing a weapon to give up');
            const mv = p._remoteHuman ? await FMP.waitFor(cs, 'weapon') : null;
            mpWaitHide();
            const ids = (mv && Array.isArray(mv.cardIds)) ? mv.cardIds : [];
            const had = [...p.playedCards];
            const taken = ids.length
                ? game.discardPlayedCards(li, c => ids.includes(c.id) && c.type === 'weapon', k)
                : 0;
            if (taken < k) {
                // Short or booted — the engine's own keep-score fills in, and
                // it is deterministic, so every client lands on the same card.
                const wasRemote = p._remoteHuman;
                p._remoteHuman = false;
                game.penaltyDiscard(li, k - taken, { filter: c => c.type === 'weapon' });
                p._remoteHuman = wasRemote;
            }
            const gone = had.filter(c => !p.playedCards.includes(c));
            if (gone.length) {
                addLogEntry(`Archeus forces ${p.name} to discard ${gone.map(c => c.name).join(', ')}`);
            }
            renderGameState();
        }
    }
}

// ═══ A PROMISE — choose any number of played cards to sacrifice ═══════
// Faithful to the card: "Discard at least 1 Card, gain 8 Prestige for
// each discarded Card." The player taps cards to mark them, then confirms.
function showPromiseDiscardPicker() {
    return new Promise((resolve) => {
        const ov = document.getElementById('promisePicker');
        const player = game.players[0];
        if (!ov || !player.playedCards.length) { resolve(); return; }

        const chosen = new Set();
        const render = () => {
            const cards = player.playedCards.map((c, i) => `
                <div class="pp-card${chosen.has(i) ? ' chosen' : ''}" data-i="${i}">
                    <img src="assets/cards/regular/${c.filename}" alt="${c.name}">
                    <span class="pp-x">✕</span>
                </div>`).join('');
            ov.innerHTML = `
                <div class="pp-inner">
                    <div class="pp-title">A Promise Broken</div>
                    <div class="pp-sub">Sacrifice any of your played cards — <b>+${PROMISE_PRESTIGE} Prestige each</b></div>
                    <div class="pp-cards">${cards}</div>
                    <div class="pp-actions">
                        <button class="btn-royal" id="ppKeep"><span>Keep All</span></button>
                        <button class="btn-royal primary" id="ppConfirm">
                            <span>${chosen.size ? `Sacrifice ${chosen.size} — +${chosen.size * PROMISE_PRESTIGE} Prestige` : 'Sacrifice none'}</span>
                        </button>
                    </div>
                </div>`;
            ov.querySelectorAll('.pp-card').forEach(el => {
                el.onclick = () => {
                    const i = parseInt(el.dataset.i, 10);
                    chosen.has(i) ? chosen.delete(i) : chosen.add(i);
                    render();
                };
            });
            const done = () => {
                // Even "Keep All" streams — the other clients are waiting.
                mpPub('promise', { cardIds: [...chosen].map(i => player.playedCards[i].id) });
                if (chosen.size) {
                    const picked = [...chosen].map(i => player.playedCards[i]);
                    const n = game.discardPlayedCards(0, c => picked.includes(c));
                    player.prestige += PROMISE_PRESTIGE * n;
                    showNotification(`A Promise: sacrificed ${n} card${n > 1 ? 's' : ''} for +${PROMISE_PRESTIGE * n} Prestige`, 'melee');
                    addLogEntry(`You sacrifice ${n} card(s) to A Promise: +${PROMISE_PRESTIGE * n} Prestige`);
                }
                ov.classList.remove('active');
                renderGameState();
                resolve();
            };
            ov.querySelector('#ppConfirm').onclick = done;
            ov.querySelector('#ppKeep').onclick = () => { chosen.clear(); done(); };
        };
        render();
        ov.classList.add('active');
    });
}

// ═══ CHEMICAL Y — choose ONE adventure card, its Favor doubles ═════════
// Faithful to the card: "Choose an Adventure card you have, multiply its
// Favor amount by 2." The pick is marked on the card and pays at scoring.
function showChemYPicker() {
    return new Promise((resolve) => {
        const ov = document.getElementById('promisePicker');
        const player = game.players[0];
        const advs = player.playedCards
            .map((c, i) => ({ c, i }))
            .filter(x => x.c.type === 'adventure' && (x.c.favor || 0) > 0 && !x.c._favorDoubled);
        if (!ov || !advs.length) { resolve(); return; }

        let chosen = advs[0].i;
        const render = () => {
            const cards = advs.map(({ c, i }) => `
                <div class="pp-card${chosen === i ? ' chosen' : ''}" data-i="${i}">
                    <img src="assets/cards/regular/${c.filename}" alt="${c.name}">
                    <span class="pp-favor">${c.favor} ➜ ${c.favor * 2}</span>
                </div>`).join('');
            const pick = player.playedCards[chosen];
            ov.innerHTML = `
                <div class="pp-inner chemy">
                    <div class="pp-title">Chemical Y</div>
                    <div class="pp-sub">Choose an Adventure card — its Favor is <b>multiplied by 2</b></div>
                    <div class="pp-cards">${cards}</div>
                    <div class="pp-actions">
                        <button class="btn-royal primary" id="chemYConfirm">
                            <span>Double ${pick.name} — +${pick.favor} Favor at scoring</span>
                        </button>
                    </div>
                </div>`;
            ov.querySelectorAll('.pp-card').forEach(el => {
                el.onclick = () => { chosen = parseInt(el.dataset.i, 10); render(); };
            });
            ov.querySelector('#chemYConfirm').onclick = () => {
                const card = player.playedCards[chosen];
                mpPub('chemy', { cardId: card.id });
                card._favorDoubled = true;
                addLogEntry(`Chemical Y doubles ${card.name} (+${card.favor} Favor at scoring)`);
                showNotification(`${card.name} is now worth ${card.favor * 2} Favor`, 'play');
                ov.classList.remove('active');
                renderGameState();
                resolve();
            };
        };
        render();
        ov.classList.add('active');
    });
}

// ═══ CHEMICAL X — move your ring to ANY slot ══════════════════════════
// The card says "Move Character Slider to any slot", so the player picks the
// slot. It used to shove you to slot 5 (or slot 1 if you were already right)
// without asking. The BOARD is the picker — the art already explains every
// slot, so no widget re-explains it: every circle lights up, tapping one lands
// the ring there for free, and the slot pays out like any other landing.
// Mandatory: closeBoardOverlay() refuses to close while this is pending, so a
// stray backdrop tap can't strand the round. Publishes 'slider_move' so a
// multiplayer table applies YOUR slot, in stream order, on every client.
function showChemXPicker() {
    return new Promise((resolve) => {
        const player = game.players[0];
        if (!player.character || !player.character.slots) { player._pendingSliderMove = false; resolve(); return; }
        showNotification('Chemical X — move your ring to any slot', 'play');
        openSlidePickerFree((pos) => {
            // Publish BEFORE mutating: every client applies the same move through
            // the same engine call, in stream order.
            mpPub('slider_move', { pos });
            const res = game.applyFreeSliderMove(0, pos);
            const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
            if (res && res.success) {
                addLogEntry(`Chemical X moves your ring to ${posNames[res.pos]}`);
                showNotification(`Ring moves to ${posNames[res.pos]} — free`, 'play');
            }
            renderGameState();
            resolve();
        });
    });
}

// ═══ THE MAGICIAN'S PICK ONE — choose a skill from your board ═════════
// Slot 4 of the Magician's board reads "Pick One". The box hands the player a
// choice, so we build the choice (rules fidelity) — it used to silently take
// whichever skill you had least of, and the grant didn't even survive the next
// skill recalc. Publishes 'slot_pick' so a multiplayer table applies YOUR pick,
// in stream order, on every client. Resolves when the grant has landed.
function showSlotSkillPicker() {
    return new Promise((resolve) => {
        const ov = document.getElementById('promisePicker');
        const player = game.players[0];
        const opts = game.slotPickOptions(0);
        if (!ov || !opts.length) { player._pendingSlotPick = null; resolve(); return; }

        const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
        let chosen = opts[0];

        // Magician Side B's pick set includes SPECIALS — a Mind's Eye or a
        // Philosopher's Stone. They read from their own counters and wear
        // their own icons; plain skills render exactly as before.
        const PICK_SPECIALS = {
            minds_eye: { name: "Mind's Eye", icon: 'assets/icons/minds_eye.png',
                have: () => game.getMindsEyeCount(0) },
            philosopher_stone: { name: "Philosopher's Stone", icon: 'assets/icons/philosopher.png',
                have: () => (game.players[0].philosopherStone || 0) },
        };
        const pickName = s => PICK_SPECIALS[s] ? PICK_SPECIALS[s].name : cap(s);

        const render = () => {
            const tiles = opts.map(s => {
                const sp = PICK_SPECIALS[s];
                const have = sp ? sp.have() : game.effectiveSkill(0, s);
                return `
                <div class="pp-skill${chosen === s ? ' chosen' : ''}" data-s="${s}">
                    <img src="${sp ? sp.icon : `assets/icons/${s}.png`}" alt="${pickName(s)}">
                    <span class="pp-skill-name">${pickName(s)}</span>
                    <span class="pp-skill-have">${have} <b>➜ ${have + 1}</b></span>
                </div>`;
            }).join('');
            ov.innerHTML = `
                <div class="pp-inner chemy">
                    <div class="pp-title">Pick One</div>
                    <div class="pp-sub">Your board grants <b>one skill</b> — choose which</div>
                    <div class="pp-cards skills">${tiles}</div>
                    <div class="pp-actions">
                        <button class="btn-royal primary" id="slotPickConfirm">
                            <span>Take +1 ${pickName(chosen)}</span>
                        </button>
                    </div>
                </div>`;
            ov.querySelectorAll('.pp-skill').forEach(el => {
                el.onclick = () => { chosen = el.dataset.s; render(); };
            });
            ov.querySelector('#slotPickConfirm').onclick = () => {
                // Publish BEFORE mutating: every client applies the same grant
                // through the same engine call, in stream order.
                mpPub('slot_pick', { skill: chosen });
                game.applySlotPick(0, chosen);
                addLogEntry(`You pick +1 ${pickName(chosen)} from your board`);
                showNotification(`+1 ${pickName(chosen)} from your board`, 'play');
                ov.classList.remove('active');
                renderGameState();
                resolve();
            };
        };
        render();
        ov.classList.add('active');
    });
}

// ═══ LIFE ESSENCE — choose ONE active mission, its requirement is gone ══
// Faithful to the card: "Choose One of Your Active Missions — This Mission
// no longer has any Requirement." The blessing is marked on the mission
// itself and holds for good; completed missions are out of reach.
function showLifeEssencePicker() {
    return new Promise((resolve) => {
        const ov = document.getElementById('promisePicker');
        const player = game.players[0];
        const missions = (player.missions || []).filter(m => !m._reqWaived);
        if (!ov || !missions.length) { resolve(); return; }

        let chosen = 0;
        const render = () => {
            const cards = missions.map((m, i) => `
                <div class="pp-card${chosen === i ? ' chosen' : ''}" data-i="${i}">
                    <img src="assets/cards/missions/${m.filename}" alt="${m.name}">
                </div>`).join('');
            const pick = missions[chosen];
            ov.innerHTML = `
                <div class="pp-inner chemy">
                    <div class="pp-title">Life Essence</div>
                    <div class="pp-sub">Choose one of your <b>active missions</b> — it will no longer have any requirement</div>
                    <div class="pp-cards">${cards}</div>
                    <div class="pp-actions">
                        <button class="btn-royal primary" id="leConfirm">
                            <span>Bless ${pick.name} — no requirement</span>
                        </button>
                    </div>
                </div>`;
            ov.querySelectorAll('.pp-card').forEach(el => {
                el.onclick = () => { chosen = parseInt(el.dataset.i, 10); render(); };
            });
            ov.querySelector('#leConfirm').onclick = () => {
                const m = missions[chosen];
                mpPub('lepick', { missionId: m.id });
                m._reqWaived = true;
                addLogEntry(`Life Essence blesses ${m.name} — it no longer has any requirement`);
                showNotification(`${m.name} no longer has any requirement`, 'play');
                ov.classList.remove('active');
                renderGameState();
                resolve();
            };
        };
        render();
        ov.classList.add('active');
    });
}

// ─── SCORING — the victory ceremony ─────────────────────────

// Placement colors: 1st gold, 2nd silver, 3rd bronze, the rest muted.
// Indexed by finish order so every table size (3/4/5) reads the same.
const VS_PLACES = [
    { cls: 'p1', color: '#e8c34b' },
    { cls: 'p2', color: '#c6ccd6' },
    { cls: 'p3', color: '#cd8a4b' },
];
const VS_ORDINAL = ['1st', '2nd', '3rd', '4th', '5th'];

// Inline trophy cup — ours, never an emoji (same doctrine as .crown-ico).
function vsTrophy(color) {
    return `<svg class="vs-trophy" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3h10v6a5 5 0 0 1-10 0Z" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>
        <path d="M7 4.2H4.1a3.5 3.5 0 0 0 3.4 4.4M17 4.2h2.9a3.5 3.5 0 0 1-3.4 4.4" fill="none" stroke="${color}" stroke-width="1.7"/>
        <path d="M10.7 13.4h2.6v3.2h-2.6z" fill="${color}"/>
        <rect x="7.6" y="16.9" width="8.8" height="2.7" rx="0.7" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="0.8"/>
    </svg>`;
}

function showScoring() {
    const scores = game.getWinner();

    // Each row carries its player's final Power — the lifetime-Power
    // leaderboard accumulates it per game (calculatePower is a pure read).
    scores.forEach(s => { s.power = game.calculatePower(s.playerIndex); });

    // Snapshot BEFORE posting — the deltas below say what THIS game did,
    // measured against where you stood when it began.
    const before = (window.FLB && typeof FLB.snapshot === 'function')
        ? FLB.snapshot() : { rating: 0, stars: 0 };

    // Post YOUR result to the leaderboard the moment scoring resolves —
    // rating points vs the table + best-Favor for today's daily board.
    // Seated persona rivals post rating-only placements to their permanent
    // rows; generic bots present as people but never post. In multiplayer
    // every client posts its OWN human — only the HOST posts the personas
    // (three clients must not triple-pay a persona's delta).
    const personaPlaces = (!mpActive() || FMP.isHost())
        ? scores.map((s, i) => {
            const gp = game.players[s.playerIndex];
            // finalScore rides along so personas can post to the daily board
            // "just like regular players" (Wyatt 7/18) — it was not in the
            // payload, so the persona daily post had nothing to write.
            return gp && gp._personaUid
                ? { uid: gp._personaUid, name: gp.name, place: i,
                    power: s.power || 0, finalScore: s.finalScore || 0 }
                : null;
        }).filter(Boolean)
        : [];
    // Every seat's table rating, in placement order — the Elo pairwise
    // field for my delta AND the personas' (null = generic bot).
    const tableRatings = scores.map(s => {
        const gp = game.players[s.playerIndex];
        return gp && typeof gp._tableRating === 'number' ? gp._tableRating : null;
    });
    const myHeroId = game.players[0] && game.players[0].character
        ? game.players[0].character.id : null;
    clearSoloSave();   // the table finished — nothing left to resume
    if (window.FLB) {
        // The resolved XP (computed INSIDE the posting transaction) paints
        // the victory chip late and raises the Level 5 ceremony — never a
        // re-read of the row, so it can neither miss nor double-fire.
        FLB.postGameResult(scores, personaPlaces,
            { ratings: tableRatings, myChar: myHeroId })
            .then(xp => { if (xp) paintVictoryXp(xp); })
            .catch(() => { /* offline — no track moved, no chip */ });
    }
    // WANTED: finishing ahead of today's named rival pays Stars once
    // per window (modes.js owns the claim and the once-a-day gate).
    if (window.FMODES) FMODES.rivalGameOver(scores);
    if (mpActive()) FMP.gameOver();   // host tidies the record; everyone detaches

    // Achievements: hero victories, single-game feats, The Master. Runs AFTER
    // postGameResult so the row exists on a first-ever game (lazy join), and is
    // deliberately un-awaited — a slow grant must never hold up the victory
    // screen. It celebrates itself when it lands.
    if (window.FACH && window.FLB) {
        const meFirst = scores.length && scores[0].name === 'You';
        const snap = FACH.seatSnapshot(game, meFirst);
        if (snap) Promise.resolve(FLB.postGameResult).then(() => FACH.sync(snap));
    }

    document.getElementById('game-screen').classList.remove('active');
    document.getElementById('scoring-screen').classList.add('active');

    // Late toasts (melee results, mission payouts) float above this screen
    // — the ceremony opens on a clean stage.
    const toasts = document.getElementById('notifications');
    if (toasts) toasts.innerHTML = '';

    const content = document.getElementById('scoringContent');
    const winner = scores[0];
    const place = scores.findIndex(s => s.playerIndex === 0);
    const youWon = place === 0;

    const headline = youWon ? 'You Are Victorious!' : `${winner.name} Claims the Throne`;
    const personal = youWon
        ? 'The realm bows before its new sovereign.'
        : `You finished ${VS_ORDINAL[place] || (place + 1) + 'th'}.`;

    // Rating + Stars deltas, shown BIG. Rating persists via postGameResult
    // (works offline too — the local adapter keeps the same ledgers);
    // per-game Stars appear once the store economy exposes FLB.gameStars.
    let deltas = '';
    if (window.FLB && place >= 0) {
        // The same pairwise Elo the write uses (1.00–7.00 display) — the
        // sheet and the ledger can never disagree on what this game did.
        const rr = typeof FLB.tableDelta === 'function'
            ? FLB.tableDelta(scores, tableRatings, myHeroId) : null;
        if (rr) {
            const rc = (typeof FLB.ratingColor === 'function') ? FLB.ratingColor(rr.after) : '';
            const rcStyle = rc ? ` style="color:${rc};text-shadow:0 0 12px ${rc}66"` : '';
            deltas += `<div class="vs-delta rating">
            <span class="vs-d-what">✦ Rating</span><b>${FLB.fmtRatingDelta(rr.delta)}</b>
            <span class="vs-d-arrow">→</span><b class="vs-d-new"${rcStyle} data-total="${rr.after}" data-fmt="rating">0</b>
        </div>`;
        }
        if (typeof FLB.gameStars === 'function') {
            const sDelta = FLB.gameStars(place, scores.length);
            const newStars = (before.stars || 0) + sDelta;
            deltas += `<div class="vs-delta stars">
                <span class="vs-d-what">★ Stars</span><b>+${sDelta}</b>
                <span class="vs-d-arrow">→</span><b class="vs-d-new" data-total="${newStars}">0</b>
            </div>`;
        }
    }

    // The score sheet from the box — one color-coded grid, heirs across,
    // categories down, tallied the way the table does it after a real game
    // (Missions / Adventures / Artifacts / Character / Prestige / Scorn).
    // Artifacts carries every non-adventure card's favor.
    // ⚠ The Philosopher's Stone gold conversion is GONE (Wyatt 7/18: "that's
    // not a mechanic in the game"). It used to be folded into this cell,
    // which is what he first saw as the Stone "sticking itself in there" on
    // players who never held the card -- it keyed off the fungible token
    // counter, not playedCards. Splitting it into its own row made it
    // visible; looking at it made it obvious it should not exist at all.
    // Stones remain purely a REQUIREMENT resource.
    // ⚠ 7/19: the Artifacts cell was a CATCH-ALL — artFavor + every other
    // non-adventure card — so Forbidden Lab, Mind's Eye, Fortune Teller and
    // Marketplace Sales all turned up under "Artifacts" (Wyatt). It reads the
    // real artifact set now: rulebook p.8 counts "Collected Adventure &
    // Artifact Favor" and those are the only two families that bear Favor.
    // The one printed exception is Chemical Y's "+15 if you own Chemical X"
    // on a potion; otherCardFavor rides with Adventures, where the rest of
    // that card's text lives ("multiply an Adventure card's Favor by 2"), and
    // the drill-down names it outright so the number stays traceable.
    const advAll = (s) => (s.advFavor || 0) + (s.otherCardFavor || 0);
    const SHEET_ROWS = [
        { label: 'Missions',   key: 'missions',  drill: true, icon: 'assets/icons/mission.png',  c: '#c2a14d', v: s => s.missionFavor || 0 },
        { label: 'Adventures', key: 'adventure', drill: true, icon: 'assets/icons/maps.png',     c: '#4c8a63', v: s => advAll(s) },
        { label: 'Artifacts',  key: 'artifact',  drill: true, icon: 'assets/icons/philosopher.png', c: '#8a63a8', v: s => s.artFavor || 0 },
        { label: 'Character',  key: 'character', drill: true, icon: 'assets/icons/favor.png',    c: '#75695a', v: s => s.characterFavor || 0 },
        { label: 'Prestige',   key: 'prestige',  icon: 'assets/icons/prestige.png', c: '#3f9fd0', v: s => s.prestige || 0 },
        { label: 'Scorn',      key: 'scorn',     icon: 'assets/icons/scorn.png',    c: '#c0463e', v: s => s.scorn || 0, neg: true },
    ];
    const heads = scores.map((s, i) => {
        const ch = game.players[s.playerIndex].character;
        const p = VS_PLACES[i];
        return `<div class="vsg-head${s.playerIndex === 0 ? ' me' : ''}${i === 0 ? ' win' : ''}" style="--ri:0">
            ${ch && ch.filename ? `<img class="vsg-face" src="assets/characters/${ch.filename}" alt="">` : ''}
            <span class="vsg-ord"${p ? ` style="color:${p.color}"` : ''}>${p ? vsTrophy(p.color) : ''}${VS_ORDINAL[i] || (i + 1) + 'th'}</span>
            <span class="vsg-hname">${s.name}</span>
        </div>`;
    }).join('');
    const bodyRows = SHEET_ROWS.map((r, ri) => {
        const cells = scores.map((s, i) => {
            const raw = r.v(s);
            const txt = r.neg && raw > 0 ? `−${raw}` : `${raw}`;
            // Missions / Adventures / Artifacts / Character cells open a
            // breakdown of the cards & missions behind the number (Wyatt 7/17).
            const drill = r.drill
                ? ` drill" onclick="showScoreBreakdown(${s.playerIndex}, '${r.key}')" title="See what made up this ${r.label} score`
                : '';
            return `<div class="vsg-cell${s.playerIndex === 0 ? ' me' : ''}${i === 0 ? ' win' : ''}${r.neg && raw > 0 ? ' bad' : ''}${drill}" style="--rowC:${r.c};--ri:${ri + 1}">${txt}</div>`;
        }).join('');
        return `<div class="vsg-label" style="--rowC:${r.c};--ri:${ri + 1}">${r.icon ? `<img src="${r.icon}" alt="">` : ''}<span>${r.label}</span></div>${cells}`;
    }).join('');
    // The total row's stagger index follows the row count, so adding a sheet
    // row can never leave it animating on top of the last body row.
    const totalRi = SHEET_ROWS.length + 1;
    const totalCells = scores.map((s, i) =>
        `<div class="vsg-cell total${s.playerIndex === 0 ? ' me' : ''}${i === 0 ? ' win' : ''}" style="--ri:${totalRi}"><b data-total="${s.finalScore}" data-cd="1150">0</b></div>`).join('');
    const grid = `
        <div class="vs-grid" style="--vsgCols:${scores.length}">
            <div class="vsg-corner" style="--ri:0"></div>${heads}
            ${bodyRows}
            <div class="vsg-label total" style="--rowC:#efe6cf;--ri:${totalRi}"><img src="${PURSE_ICONS.favor}" alt=""><span>Total</span></div>${totalCells}
        </div>`;

    content.innerHTML = `
        <button class="vs-leave" onclick="location.reload()" title="Leave to Menu" aria-label="Leave">✕</button>
        <div class="vs-head${youWon ? ' win' : ''}">
            ${youWon ? '<div class="champ-rays"></div>' : ''}
            <div class="vs-headline">${headline}</div>
            <div class="vs-personal">${personal}</div>
        </div>
        ${deltas ? `<div class="vs-deltas">${deltas}</div>` : ''}
        <div class="scoring-scroll">${grid}</div>
        <div class="scoring-actions">
            <button class="btn-royal" onclick="location.reload()">
                <span>Main Menu</span>
            </button>
            <button class="btn-royal primary" onclick="location.reload()">
                <span>Play Again</span>
            </button>
        </div>
    `;

    // Roll every total up from 0 (the Melee splash count-up, ease-out).
    // data-fmt="rating" totals hold internal Elo and read as 1.00–7.00.
    animateVsTotals(content);
}

// The count-up, callable for late-arriving chips too (the XP delta lands
// when its transaction commits, after the sheet has already rolled).
function animateVsTotals(root) {
    root.querySelectorAll('[data-total]').forEach(b => {
        if (b._vsRolled) return;   // once per element
        b._vsRolled = true;
        const target = parseInt(b.dataset.total, 10) || 0;
        const show = b.dataset.fmt === 'rating'
            ? (v) => (Math.max(0, Math.min(7000, v)) / 1000).toFixed(2)
            : (v) => Math.round(v);
        const dur = 900;
        let t0 = null;
        const tick = (t) => {
            if (t0 === null) t0 = t;
            const k = Math.min(1, (t - t0) / dur);
            b.textContent = show(target * (1 - Math.pow(1 - k, 3)));
            if (k < 1) requestAnimationFrame(tick);
        };
        setTimeout(() => requestAnimationFrame(tick), parseInt(b.dataset.cd, 10) || 350);
    });
}

// ═══ The hero's Gilt Ribbon on the victory screen (spec §10) ═════════
// A delta chip beside the rating chip: level numeral + ribbon + the Favor
// banked. The level arrow appears ONLY when this game actually crossed a
// level — "3 → 3" reads like a bug. Ordinary level-ups stay this quiet;
// Level 5 alone raises the champ overlay, dressed as the board turning.
function paintVictoryXp(xp) {
    const content = document.getElementById('scoringContent');
    const hero = window.FAVOR_DATA.characters.find(c => c.id === xp.charId);
    if (!content || !hero || !window.FLB) return;
    let row = content.querySelector('.vs-deltas');
    if (!row) {
        // Offline sheets render no deltas row — the chip builds its own
        // home in the same slot so the layout stays the design's.
        const head = content.querySelector('.vs-head');
        if (!head) return;
        row = document.createElement('div');
        row.className = 'vs-deltas';
        head.insertAdjacentElement('afterend', row);
    }
    const gained = Math.max(0, xp.fvAfter - xp.fvBefore);
    const rose = xp.levelAfter > xp.levelBefore;
    const chip = document.createElement('div');
    chip.className = 'vs-delta xp';
    chip.innerHTML = `
        <span class="vs-d-what">${hero.name} · Level</span>
        ${rose ? `<b>${xp.levelBefore}</b><span class="vs-d-arrow">→</span><b class="vs-d-new" data-total="${xp.levelAfter}">0</b>`
               : `<b>${xp.levelAfter}</b>`}
        <span class="vs-d-fv">+${gained} Favor</span>
        <div class="vs-d-rb">${FLB.xpRibbonHtml(xp.fvAfter, 9, 11)}</div>`;
    row.appendChild(chip);
    animateVsTotals(chip);

    // Level 5 — the one that gets a ceremony (fourth champ dress).
    const sideBLv = (typeof FLB.sideBLevel === 'function') ? FLB.sideBLevel() : 5;
    if (hero.altSlots && xp.levelBefore < sideBLv && xp.levelAfter >= sideBLv
        && typeof FLB.showSideBCelebration === 'function') {
        setTimeout(() => { FLB.showSideBCelebration(hero); }, 1400);
    }
}

// ═══ SCORE BREAKDOWN — tap a sheet cell, see the cards behind the number ══
// Missions / Adventures / Artifacts / Character each open the exact cards or
// missions that fed that score, per player (Wyatt 7/17). Prestige & Scorn have
// no breakdown. Every value is recomputed the same way calculateFinalScores
// does, so the rows always sum to the cell.
function showScoreBreakdown(pi, cat) {
    const gp = game.players[pi];
    if (!gp) return;
    const cardFav = (c) => (c.favor ? c.favor * (c._favorDoubled ? 2 : 1) : 0)
        + (typeof game.dynamicCardFavor === 'function' ? game.dynamicCardFavor(pi, c) : 0);
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    const name = pi === 0 ? 'You' : gp.name;

    let title = '', items = [], notes = [], total = 0;

    if (cat === 'missions') {
        title = 'Missions';
        // A mission pays its printed favorValue PLUS whatever its success
        // special worked out to. Four missions print 0 and pay entirely
        // through the special — Golden Fiddle ("2 Favor for Each Charisma"),
        // Trust of the Elders, The Shadow Guide, King of the Sky. Reading
        // favorValue alone scored those at zero and printed "No missions
        // completed for Favor" over a game that had just paid out (Wyatt
        // 7/19). The ledger says what each one actually paid, and names the
        // formula so the number is checkable against the card.
        const led = (gp.favorLog || []).filter(e => e.src === 'mission');
        const claimed = new Set();
        (gp.completedMissions || []).forEach(m => {
            const lines = led.filter((e, ei) => e.label === m.name && !claimed.has(ei));
            led.forEach((e, ei) => { if (e.label === m.name) claimed.add(ei); });
            const v = (m.favorValue || 0) + lines.reduce((n, e) => n + e.amount, 0);
            if (!v) return;
            const how = lines.map(e => e.formula).filter(Boolean).join(', ');
            items.push({ img: `assets/cards/missions/${m.filename}`,
                label: m.name + (how ? ` — ${how}` : ''), val: v });
            total += v;
        });
        // Nothing should land here, but a mission-sourced payment must never
        // go missing from the panel that owns it: the rows have to sum to the
        // sheet cell no matter what paid them.
        led.forEach((e, ei) => {
            if (claimed.has(ei)) return;
            items.push({ img: PURSE_ICONS.favor, label: e.label, val: e.amount });
            total += e.amount;
        });
        if (!items.length) notes.push('No missions completed for Favor.');
    } else if (cat === 'adventure' || cat === 'artifact') {
        title = cat === 'adventure' ? 'Adventures' : 'Artifacts';
        // Rulebook p.8 counts "Collected Adventure & Artifact Favor" — those
        // are the only two families that bear Favor, so those are the only two
        // card rows on the sheet.
        //
        // Every card OF the family is listed even at +0: a held Favor card
        // that vanishes is the worse bug (Wyatt 7/18, the Family Ring). Cards
        // of the other four families are listed only if they actually paid,
        // which after the 7/19 retype means Chemical Y's printed Chemical-X
        // bonus and nothing else. That asymmetry is the whole fix — listing
        // them unconditionally is what put Forbidden Lab, Mind's Eye, Fortune
        // Teller and Marketplace Sales under "Artifacts" (Wyatt 7/19), and
        // simply flipping the filter would have moved the same pile under
        // Adventures. Between them the two panels still account for every
        // Favor a card paid, so the rows sum to the sheet.
        const belongs = (type, v) => type === cat
            || (cat === 'adventure' && type !== 'artifact' && v !== 0);
        (gp.playedCards || []).forEach(c => {
            const v = cardFav(c);
            if (!belongs(c.type, v)) return;
            items.push({ img: `assets/cards/regular/${c.filename}`,
                label: c.name + (c._favorDoubled ? ' (×2)' : ''), val: v });
            total += v;
        });
        // Card-sourced ledger payments — the Lost North + Lost South map
        // bonus — book to the family of the card that paid them, so the panel
        // still sums to the cell.
        (gp.favorLog || []).filter(e => e.src === 'card' && belongs(e.type, e.amount)).forEach(e => {
            items.push({ img: e.file ? `assets/cards/regular/${e.file}` : PURSE_ICONS.favor,
                label: e.label, val: e.amount });
            total += e.amount;
        });
        if (!items.length) {
            notes.push(cat === 'adventure' ? 'No Adventure cards played.'
                : 'No Artifacts played.');
        }
    } else if (cat === 'character') {
        title = 'Character';
        // The character board, and nothing else. This row used to render the
        // whole player.favor bucket as "Favor earned in play (rewards &
        // missions)" — a caption that contradicted the panel's own subtitle
        // and swallowed every mission payout, so it showed +6 on a board slot
        // holding no Favor at all (Wyatt 7/19). Mission Favor is now in the
        // Missions row where it belongs; what's left here is the slot you
        // ended on.
        const char = gp.character;
        const slot = char && char.slots ? char.slots[gp.sliderPosition] : null;
        if (slot && slot.favor) {
            const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
            items.push({ img: char ? `assets/characters/${char.filename}` : PURSE_ICONS.favor,
                label: `${char ? char.name : 'Board'} slot bonus (${posNames[gp.sliderPosition] || 'slot'})`, val: slot.favor });
        }
        (gp.favorLog || []).filter(e => e.src === 'character').forEach(e => {
            items.push({ img: PURSE_ICONS.favor, label: e.label, val: e.amount });
        });
        // Favor the ledger can't account for — see calculateFinalScores. It
        // should always be 0; if it isn't, it shows up here rather than
        // quietly going missing from the total.
        const unattributed = (gp.favor || 0)
            - (gp.favorLog || []).reduce((n, e) => n + e.amount, 0);
        if (unattributed) items.push({ img: PURSE_ICONS.favor, label: 'Favor earned in play', val: unattributed });
        total = items.reduce((n, x) => n + x.val, 0);
        notes.push('Your standing on the character board when the game ended.');
        if (!items.length) notes.push('No Favor from the character board.');
    } else { return; }

    // Favor-bearing rows first — a panel that opens on a wall of +0 reads as
    // "nothing counted" even when the total above it is right (Wyatt 7/19).
    // The zeros still render: "where did my card go" is the worse bug, and
    // that is why they were unguarded in the first place (Wyatt 7/18).
    items.sort((a, b) => b.val - a.val);
    if (items.some(i => i.val === 0) && items.some(i => i.val !== 0)) {
        notes.push('Cards showing +0 paid you in skills, Power or gold — not Favor.');
    }

    let ov = document.getElementById('scoreBreakdown');
    if (!ov) { ov = document.createElement('div'); ov.id = 'scoreBreakdown'; document.body.appendChild(ov); }
    const rows = items.map(it => `
        <div class="sb-row">
            <img class="sb-thumb" src="${it.img}" alt="" onclick="event.stopPropagation(); zoomCard('${it.img}')">
            <span class="sb-name">${it.label}</span>
            <b class="sb-val">${it.val >= 0 ? '+' : ''}${it.val}</b>
        </div>`).join('');
    ov.innerHTML = `
        <div class="sb-inner" onclick="event.stopPropagation()">
            <button class="sb-x" onclick="closeScoreBreakdown()" aria-label="Close">✕</button>
            <div class="sb-head"><span class="sb-who">${name}</span> · ${title}
                <b class="sb-total">${total} Favor</b></div>
            <div class="sb-list">${rows}${notes.map(n => `<div class="sb-note">${n}</div>`).join('')}</div>
        </div>`;
    ov.classList.add('active');
    ov.onclick = () => closeScoreBreakdown();
}
function closeScoreBreakdown() {
    const ov = document.getElementById('scoreBreakdown');
    if (ov) ov.classList.remove('active');
}

// ─── PLAYER STATS (renderStats alias for backward compat) ──

function renderStats(state) {
    renderStatsPanel(state);
    renderBottomStats(state);
}

// ═══ CARD PEEK — press & hold "boom" (Battlegrounds-style) ═══════════
// Hold any card (hand, table, missions, panels) ~a third of a second and it
// blows up to full readable size with keyword plaques beside it explaining
// exactly what it does. Release or tap to put it down. Works with mouse too.

// Wording follows the rulebook's own Card Types page (p.11). Wisdom was
// MISSING here entirely — with 12 wisdom cards in the deck after the 7/19
// retype, a whole family was peeking with no plaque at all.
const PEEK_TYPE_INFO = {
    endeavor:       ['Endeavor', 'Upgrades your character skills.'],
    weapon:         ['Weapon', 'Power for the Melee.'],
    artifact:       ['Artifact', 'An item desired by the Queen. Artifacts award bountiful Favor.'],
    wisdom:         ['Wisdom', 'Insight that grants rare skills and expands your Knowledge.'],
    adventure:      ['Adventure', 'A quest that grants rich Favor.'],
    potion:         ['Potion', 'Fires off instantly when played.'],
    mission_letter: ['Mission Letter', 'Spend 1 Gold to take a mission from the pool.'],
    mission:        ['Mission', 'Meet its skill requirement — Favor if you succeed, Scorn if you fail.'],
};

let _peekIndexMap = null;
function peekLookup(src) {
    if (!_peekIndexMap) {
        _peekIndexMap = {};
        ((window.FAVOR_DATA || {}).cards || []).forEach(c => {
            _peekIndexMap['assets/cards/regular/' + c.filename] = { kind: 'card', data: c };
        });
        ((window.FAVOR_DATA || {}).missions || []).forEach(m => {
            _peekIndexMap['assets/cards/missions/' + m.filename] = { kind: 'mission', data: m };
        });
    }
    return _peekIndexMap[src] || null;
}

// "Survival ×2" style aggregation for skill lists.
function peekSkillCounts(list) {
    const counts = {};
    (list || []).forEach(s => { counts[s] = (counts[s] || 0) + 1; });
    return Object.entries(counts).map(([s, n]) =>
        `<span class="pk-skill"><img src="assets/icons/${s}.png" alt="">${s.charAt(0).toUpperCase() + s.slice(1)}${n > 1 ? ' ×' + n : ''}</span>`
    ).join('');
}

function peekPlaque(title, body, cls) {
    return `<div class="peek-plaque ${cls || ''}"><div class="pk-title">${title}</div><div class="pk-body">${body}</div></div>`;
}

function buildPeekPlaques(src) {
    const hit = peekLookup(src);
    if (!hit) return '';
    const d = hit.data;
    let out = '';

    if (hit.kind === 'card') {
        const t = PEEK_TYPE_INFO[d.type];
        if (t) out += peekPlaque(t[0], t[1], 'type');
        if (d.skills && d.skills.length) out += peekPlaque('Grants', peekSkillCounts(d.skills));
        if (d.cost) out += peekPlaque('Cost', `${d.cost} Gold to play`);
        if (d.requirements && d.requirements.length) out += peekPlaque('Requires', peekSkillCounts(d.requirements), 'req');
        const r = d.rewards || {};
        const rr = [];
        if (r.gold) rr.push(`+${r.gold} Gold`);
        if (r.prestige) rr.push(`+${r.prestige} Prestige`);
        if (r.favor) rr.push(`+${r.favor} Favor`);
        if (rr.length) out += peekPlaque('Rewards', rr.join(' · '));
        if (d.favor) out += peekPlaque('Favor', `Scores ${d.favor} Favor for the Queen`, 'type');
        if (r.scorn) out += peekPlaque('Beware', `+${r.scorn} Scorn`, 'scorn');
        if (d.special && SPECIAL_DESCRIPTIONS[d.special]) out += peekPlaque('Special', SPECIAL_DESCRIPTIONS[d.special], 'special');
        if (d.reqMaps && d.reqMaps.length) out += peekPlaque('Map Route', `Play ${d.reqMaps.join(' or ')} first and its Map plays this card for free.`, 'special');
        if (d.grantsMap) out += peekPlaque('Grants Map', d.grantsMap, 'special');
    } else {
        const t = PEEK_TYPE_INFO.mission;
        out += peekPlaque(t[0], t[1], 'type');
        if (d.favorValue) out += peekPlaque('Worth', `${d.favorValue} Favor`);
        if (d.requirements && d.requirements.length) out += peekPlaque('Requires', peekSkillCounts(d.requirements), 'req');
        const s = d.successRewards || {};
        const sr = [];
        if (s.favor) sr.push(`+${s.favor} Favor`);
        if (s.gold) sr.push(`+${s.gold} Gold`);
        if (s.prestige) sr.push(`+${s.prestige} Prestige`);
        if (sr.length) out += peekPlaque('On Success', sr.join(' · '));
        const f = d.failurePenalties || {};
        if (f.scorn) out += peekPlaque('On Failure', `+${f.scorn} Scorn`, 'scorn');
        if (d.grantsMap) out += peekPlaque('Grants Map', d.grantsMap, 'special');
    }
    return out;
}

function openCardPeek(src) {
    const ov = document.getElementById('cardPeek');
    if (!ov) return;
    ov.innerHTML = `<img class="peek-card" src="${src}" alt="">`;
    ov.classList.add('active');
    if (typeof coachTick === 'function') coachTick();
}

function closeCardPeek() {
    const ov = document.getElementById('cardPeek');
    if (ov) ov.classList.remove('active');
    if (typeof coachTick === 'function') coachTick();
}

// Long-press detection (delegated; survives every re-render).
let _peekTimer = null;
let _peekStart = null;
let _peekShowing = false;
let _peekSwallowClick = false;

document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest && e.target.closest('[data-peek]');
    if (!t) return;
    _peekStart = { x: e.clientX, y: e.clientY };
    clearTimeout(_peekTimer);
    _peekTimer = setTimeout(() => {
        _peekShowing = true;
        openCardPeek(t.getAttribute('data-peek'));
    }, 340);
}, { passive: true });

document.addEventListener('pointermove', (e) => {
    if (!_peekTimer || !_peekStart) return;
    if (Math.abs(e.clientX - _peekStart.x) > 10 || Math.abs(e.clientY - _peekStart.y) > 10) {
        clearTimeout(_peekTimer); _peekTimer = null;
    }
}, { passive: true });

function _peekRelease() {
    clearTimeout(_peekTimer); _peekTimer = null;
    if (_peekShowing) {
        _peekShowing = false;
        _peekSwallowClick = true;              // don't let the release "click" the card
        setTimeout(() => { _peekSwallowClick = false; }, 400);
        closeCardPeek();
    }
}
document.addEventListener('pointerup', _peekRelease, { passive: true });
document.addEventListener('pointercancel', _peekRelease, { passive: true });
document.addEventListener('click', (e) => {
    if (_peekSwallowClick) { e.stopPropagation(); e.preventDefault(); _peekSwallowClick = false; }
}, true);
// Long-press shouldn't summon the browser's image context menu / save sheet —
// on peek-able cards or on the hand fan (where a long finger-press is a bloom).
document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest) return;
    if (e.target.closest('[data-peek]') || e.target.closest('.tv-hand .hand-card')) e.preventDefault();
});

// ── Hover peek (mouse): point at any SMALL card and the full card floats
// beside it, Battlegrounds-big — played stacks, mission pips, sidebar
// minis, anything peek-able. Hand cards bloom in place instead, and the
// already-big cards (action sheet, overlays) are excluded. Touch devices
// keep hold-to-peek.
const HOVER_PEEK_RATIO = 333 / 500;   // card scan aspect
function _hoverPeekHide() {
    const ov = document.getElementById('hoverPeek');
    if (ov) ov.classList.remove('active');
}
document.addEventListener('pointerover', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    if (!e.target.closest) return;
    const t = e.target.closest('.stack-card, .mission-pip, .mini-card, [data-peek]');
    const ov = document.getElementById('hoverPeek');
    if (!ov) return;
    if (!t || t.closest('.hand-card, .action-panel, .card-peek, .card-zoom, .mission-lb')) {
        ov.classList.remove('active');
        return;
    }
    const src = t.getAttribute('data-peek') || (t.tagName === 'IMG' ? t.getAttribute('src') : null);
    if (!src) { ov.classList.remove('active'); return; }
    const img = document.getElementById('hoverPeekImg');
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    const vw = window.innerWidth, vh = window.innerHeight;
    const h = Math.min(vh * 0.88, 680), w = h * HOVER_PEEK_RATIO;
    const r = t.getBoundingClientRect();
    // Beside the small card: right if there's room, else left, clamped.
    let x = r.right + 18;
    if (x + w > vw - 10) x = r.left - 18 - w;
    x = Math.max(10, Math.min(x, vw - w - 10));
    const y = Math.max(10, Math.min(r.top + r.height / 2 - h / 2, vh - h - 10));
    ov.style.left = Math.round(x) + 'px';
    ov.style.top = Math.round(y) + 'px';
    ov.classList.add('active');
});
// Click means a real action (lightbox, zoom, select) — get out of the way.
document.addEventListener('pointerdown', (e) => {
    if (!e.pointerType || e.pointerType === 'mouse') _hoverPeekHide();
}, true);
document.addEventListener('scroll', _hoverPeekHide, true);

// ── Hand gestures (Hearthstone/Battlegrounds) ──
// Touch a hand card and it BLOOMS to near screen height in place — that's
// the read. Slide along the fan and each card blooms in turn (browse).
// DRAG UP past the lift line and the card detaches and follows your
// finger; release up top → its action sheet (play / discard / …).
// Release back down low, or a plain tap, commits nothing.
let _bloomEl = null;
let _bloomStartEl = null;

// Bloom geometry: fit the bloomed card to the ACTUAL screen, for both the
// phone hand (#tvHand) and the desktop hand (#handZone). The scale var
// fills the viewport height minus a breathing margin — capped on the phone
// at the tall-phone look, on desktop at ~680px where the 333x500 card
// scans start going soft. --bloomShift nudges edge cards inward so a
// bloomed card near the fan's ends stays fully on-screen. Runs after each
// hand render and on resize/rotate; uses offsetLeft (transform-free) so
// the fan's rotate/lift styling can't skew the math.
const _BLOOM_ZONES = [
    // tv: fixed 86x120 cards, cap at the tall-phone look.
    { id: 'tvHand',   varName: '--bloomScale',     maxScale: 3.15, breathe: 26 },
    // desktop: resting size scales with the window (--handCardH), so the
    // card is MEASURED and the cap is a final pixel height (the 333x500
    // scans go soft past ~680px).
    { id: 'handZone', varName: '--bloomScaleDesk', maxPx: 680,     breathe: 40 },
];
function _tvBloomLayout() {
    const vw = window.innerWidth, vh = window.innerHeight, pad = 10;
    _BLOOM_ZONES.forEach(zdef => {
        const zone = document.getElementById(zdef.id);
        if (!zone || !zone.offsetWidth) return;   // that layout is hidden
        const first = zone.querySelector('.hand-card');
        if (!first || !first.offsetHeight) return;
        const cardH = first.offsetHeight;
        const cardW = first.offsetWidth;
        const cap = zdef.maxScale || (zdef.maxPx / cardH);
        const scale = Math.max(1, Math.min(cap, (vh - zdef.breathe) / cardH));
        document.documentElement.style.setProperty(zdef.varName, scale.toFixed(3));
        const halfW = (cardW * scale) / 2;
        const zoneLeft = zone.getBoundingClientRect().left;
        zone.querySelectorAll('.hand-card').forEach(card => {
            const cx = zoneLeft + card.offsetLeft + card.offsetWidth / 2;
            let shift = 0;
            if (cx - halfW < pad) shift = pad - (cx - halfW);
            else if (cx + halfW > vw - pad) shift = (vw - pad) - (cx + halfW);
            card.style.setProperty('--bloomShift', Math.round(shift) + 'px');
        });
    });
}
window.addEventListener('resize', () => requestAnimationFrame(_tvBloomLayout));
window.addEventListener('orientationchange', () => setTimeout(_tvBloomLayout, 60));

function _bloomSet(el) {
    if (_bloomEl === el) return;
    if (_bloomEl) _bloomEl.classList.remove('bloom');
    _bloomEl = el;
    if (el) el.classList.add('bloom');
}

// Drag-up state: how far the finger must climb before the bloom hands
// the card to the drag (and the same line the release must clear to
// commit — letting go below it just tucks the card home).
const HAND_DRAG_LIFT = 60;
// Rise past this and the card in your hand LOCKS: an ascending pull that
// drifts sideways must not glide onto a neighbor mid-play. Browsing stays
// live while the finger rides level along the fan; dip back under the
// band and the glide resumes (the check is per-move, not a latch).
const HAND_GLIDE_BAND = 24;
let _handDrag = null;

document.addEventListener('pointerdown', (e) => {
    const card = e.target.closest && e.target.closest('.tv-hand .hand-card');
    if (!card) return;
    _bloomStartEl = card;
    _handDrag = { startX: e.clientX, startY: e.clientY, active: false, card: null, baseTransform: '' };
    _bloomSet(card);
}, { passive: true });

// The card detaches from the fan and rides the finger (straightened,
// shrunk so the table stays readable — the Battlegrounds pull).
function _handDragStart(ev) {
    const card = _bloomEl || _bloomStartEl;
    if (!card || !_handDrag) return;
    // One throw per round: your card is already in (take it back first),
    // or the hand on screen is next round's face-down stack — no lift.
    if (!game || game.phase !== 'gameplay' || game.pendingActivations[0] !== null
        || card.classList.contains('facedown')) return;
    _handDrag.active = true;
    _handDrag.card = card;
    _handDrag.baseTransform = card.style.transform;
    card.classList.remove('bloom');
    _bloomEl = null;                     // the drag owns the card now
    card.classList.add('dragging');
    const strip = document.getElementById('tvHandStrip');
    if (strip) strip.classList.add('drag-from');
    _handDragFollow(ev);
}

function _handDragFollow(ev) {
    const d = _handDrag;
    if (!d || !d.card) return;
    const dx = ev.clientX - d.startX;
    const dy = ev.clientY - d.startY;
    // Inline !important: the hover-bloom rule is !important too, and a
    // mouse-driven drag must not fight it mid-gesture.
    d.card.style.setProperty('transform',
        `translate(${Math.round(dx)}px, ${Math.round(dy - 24)}px) scale(1.45)`, 'important');
}

// Release: above the lift line → this card's action sheet is the next
// beat; below it (or a cancelled pointer) → the card tucks back home.
function _handDragEnd(e, allowCommit) {
    const d = _handDrag;
    _handDrag = null;
    if (!d || !d.active || !d.card) return;
    const card = d.card;
    card.classList.remove('dragging');        // transition comes back on
    card.style.removeProperty('transform');   // drop the !important drag transform
    card.style.transform = d.baseTransform;   // snap home
    const strip = document.getElementById('tvHandStrip');
    if (strip) strip.classList.remove('drag-from');
    if (allowCommit && (d.startY - e.clientY) > HAND_DRAG_LIFT) {
        // Swallow this release's synthetic click so it can't land on
        // whatever renders under the finger after the throw.
        _peekSwallowClick = true;
        setTimeout(() => { _peekSwallowClick = false; }, 400);
        const i = parseInt(card.getAttribute('data-hand-i'), 10);
        if (!isNaN(i)) setTimeout(() => throwCard(i), 0);
    }
}

// Glide: map finger X to the card whose RESTING slot is nearest — never
// hit-test the screen, because the bloomed card itself sits on top and
// would swallow its neighbors' territory (that's what made the old glide
// skip every other card). Coalesced to one update per frame so 120Hz
// touch screens don't flood the handler.
let _bloomMoveEv = null;
function _bloomNearest(clientX) {
    const zone = document.getElementById('tvHand');
    if (!zone) return null;
    const zoneLeft = zone.getBoundingClientRect().left;
    let best = null, bestD = Infinity;
    zone.querySelectorAll('.hand-card').forEach(card => {
        const cx = zoneLeft + card.offsetLeft + card.offsetWidth / 2;
        const d = Math.abs(clientX - cx);
        if (d < bestD) { bestD = d; best = card; }
    });
    return best;
}
document.addEventListener('pointermove', (e) => {
    if (!_bloomStartEl) return;
    if (_bloomMoveEv) { _bloomMoveEv = e; return; }
    _bloomMoveEv = e;
    requestAnimationFrame(() => {
        const ev = _bloomMoveEv;
        _bloomMoveEv = null;
        if (!_bloomStartEl || !ev) return;
        if (_handDrag && _handDrag.active) { _handDragFollow(ev); return; }
        const rise = _handDrag ? (_handDrag.startY - ev.clientY) : 0;
        if (_handDrag && rise > HAND_DRAG_LIFT) {
            _handDragStart(ev);
            return;
        }
        // Ascending past the band: the card is spoken for — no glide swap.
        if (rise > HAND_GLIDE_BAND) return;
        const card = _bloomNearest(ev.clientX);
        if (card) _bloomSet(card);
    });
}, { passive: true });

function _bloomRelease(e) {
    _handDragEnd(e, e.type !== 'pointercancel');
    _bloomSet(null);
    _bloomStartEl = null;
}
document.addEventListener('pointerup', _bloomRelease, { passive: true });
document.addEventListener('pointercancel', _bloomRelease, { passive: true });

// ═══ DESKTOP DRAG-TO-PLAY — the phone's Hearthstone pull, mouse-driven ═══
// Press a fan card and pull: it leaves the fan and rides the cursor;
// release above the same HAND_DRAG_LIFT line and its action sheet opens —
// exactly the phone gesture. Release low and it tucks back home. A plain
// click (no pull) still selects the classic way, and hover-bloom keeps
// working: the drag's inline !important transform is the only thing that
// outranks the hover rule, and only while dragging.
const DESK_DRAG_SLOP = 8;   // px of travel before a press becomes a drag
let _deskDrag = null;

document.addEventListener('pointerdown', (e) => {
    if (isCompactLandscape() || e.button !== 0) return;
    const card = e.target.closest && e.target.closest('#handZone .hand-card');
    if (!card) return;
    // One throw per round; the reveal-phase hand is face down and inert.
    if (!game || game.phase !== 'gameplay' || game.pendingActivations[0] !== null
        || card.classList.contains('facedown')) return;
    _deskDrag = { startX: e.clientX, startY: e.clientY, active: false,
                  card, baseTransform: card.style.transform };
}, { passive: true });

document.addEventListener('pointermove', (e) => {
    const d = _deskDrag;
    if (!d) return;
    if (!d.active) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= DESK_DRAG_SLOP) return;
        d.active = true;
        d.card.classList.add('dragging');
        const zone = document.getElementById('handZone');
        if (zone) zone.classList.add('drag-from');
    }
    d.card.style.setProperty('transform',
        `translate(${Math.round(e.clientX - d.startX)}px, ${Math.round(e.clientY - d.startY - 24)}px) scale(1.45)`,
        'important');
}, { passive: true });

function _deskDragEnd(e, allowCommit) {
    const d = _deskDrag;
    _deskDrag = null;
    if (!d || !d.active) return;
    const card = d.card;
    card.classList.remove('dragging');        // transition comes back on
    card.style.removeProperty('transform');   // drop the !important drag transform
    card.style.transform = d.baseTransform;   // snap home
    const zone = document.getElementById('handZone');
    if (zone) zone.classList.remove('drag-from');
    // A real drag's release must never read as a click: a low release
    // would otherwise "click" the card it just put back and open the
    // sheet the player was cancelling out of.
    _peekSwallowClick = true;
    setTimeout(() => { _peekSwallowClick = false; }, 400);
    if (allowCommit && (d.startY - e.clientY) > HAND_DRAG_LIFT) {
        const i = parseInt(card.getAttribute('data-hand-i'), 10);
        if (!isNaN(i)) setTimeout(() => throwCard(i), 0);
    }
}
document.addEventListener('pointerup', (e) => _deskDragEnd(e, true), { passive: true });
document.addEventListener('pointercancel', (e) => _deskDragEnd(e, false), { passive: true });

// The fan is <img>s — without this, the browser's native image drag
// hijacks the pointer stream on the very first pull.
document.addEventListener('dragstart', (e) => {
    if (e.target.closest && e.target.closest('.hand-card')) e.preventDefault();
});

// ═══ MELEE SPLASH — end-of-act tournament flair ═══════════════════════
// A quick full-screen moment (Battlegrounds combat splash energy): banner,
// every heir's Power counts up, the strongest flares gold and takes
// Prestige. Tap to skip; resolves a promise so the act flow waits for it.

// ═══ MISSION CEREMONY — the missions phase, player by player ═══════════
// One beat per resolved mission: the attempting player takes the stage,
// their mission card lands, a wax verdict stamps it, and the ACTUAL payout
// (engine deltas — per-asset favor included) pops in as chips. Tap once to
// reveal the verdict early, tap again for the next beat. Borrow choices the
// player still owes come AFTER the ceremony, exactly as before.
// Wyatt 7/14: the mission phase read too fast to follow — the stamp landed and
// the beat was gone. Every beat in the ceremony AND the mission-draw beat now
// runs 40% longer. Applied ON TOP of CINEMATIC_SPEED (not instead of it), so the
// audit suite's 0.05 still shrinks the whole phase to a blink.
const MISSION_PACE = 1.4;

function showMissionCeremony(missionResults, actNum) {
    return new Promise((resolve) => {
        const el = document.getElementById('missionCeremony');
        const beats = [];
        (missionResults || []).forEach(pr => pr.results.forEach(r => beats.push({ pi: pr.playerIndex, r })));
        if (!el || !beats.length) { resolve(); return; }

        const acts = ['I', 'II', 'III'];
        const speed = () => (window.CINEMATIC_SPEED || 1) * MISSION_PACE;
        const perPlayer = {};
        beats.forEach(b => { (perPlayer[b.pi] = perPlayer[b.pi] || []).push(b); });

        el.innerHTML = `
            <div class="mc-inner">
                <div class="ms-banner"><img class="mc-banner-icon" src="assets/icons/mission.png" alt="">Missions<span class="ms-act">Act ${acts[actNum - 1] || actNum}</span></div>
                <div class="mc-stage"></div>
                <div class="ms-hint">tap — reveal, then onward</div>
            </div>`;
        const stage = el.querySelector('.mc-stage');

        let bi = 0, timer = null, closed = false, stampedAt = 0;

        const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
        const chip = (icon, label, cls) =>
            `<span class="mc-chip ${cls}"><img src="assets/icons/${icon}.png" alt="">${label}</span>`;

        // ── Did they even have the prerequisites? ────────────────────────
        // probeMissionRequirements has always computed `missing`, and
        // resolveMissions has always forwarded it as `details` on every
        // result -- and no renderer has ever read it. Wyatt 7/18: "you don't
        // know if they had the prerequisites to get the big reward."
        const REQ_NAMES = { minds_eye: "Mind's Eye", philosopher_stone: "Philosopher's Stone" };
        const prettyReq = (r) => {
            const m = /^([a-z_]+)(\s*×\s*\d+)?$/.exec(String(r));
            return m ? (REQ_NAMES[m[1]] || cap(m[1])) + (m[2] || '') : String(r);
        };
        const reqLine = (b) => {
            const miss = ((b.r.details || {}).missing) || [];
            if (b.r.success) {
                return `<div class="mc-req ok">${b.r.borrowed
                    ? 'Requirements met — with borrowed help'
                    : 'Requirements met'}</div>`;
            }
            if (!miss.length) return '';
            return `<div class="mc-req bad">Short of ${miss.map(prettyReq).join(', ')}</div>`;
        };

        // ── WHICH cards a bulk discard actually took ─────────────────────
        // The engine used to flatten them to a count, so a Secret Grotto
        // failure showed the prestige it paid and never the cards it cost
        // (Wyatt 7/18: "we never got to see which cards he discarded").
        const discardStrip = (b) => {
            const cards = ((b.r.deltas || {}).discarded) || [];
            if (!cards.length) return '';
            return `<div class="mc-took"><span class="mc-took-lab">Discarded</span>
                ${cards.map(c => `<span class="mc-took-card">
                    <img src="assets/cards/regular/${c.filename}" alt="">
                    <em>${c.name}</em></span>`).join('')}</div>`;
        };

        // ── Who ELSE this resolution moved ───────────────────────────────
        // "Who got gold? Who is affected by this?" -- others_gain_5_gold and
        // friends pay every other seat, and a borrow fee lands in a specific
        // lender's purse. None of it was measured before.
        const othersRow = (b) => {
            const others = ((b.r.deltas || {}).others) || [];
            const sign = (n, w) => `${n > 0 ? '+' : '−'}${Math.abs(n)} ${w}`;
            const bits = others.map(o => {
                const parts = [];
                if (o.gold) parts.push(sign(o.gold, 'Gold'));
                if (o.prestige) parts.push(sign(o.prestige, 'Prestige'));
                if (o.scorn) parts.push(sign(o.scorn, 'Scorn'));
                if (o.favor) parts.push(sign(o.favor, 'Favor'));
                if (o.stones) parts.push(sign(o.stones, 'Stone'));
                return parts.length
                    ? `<span class="mc-other ${(o.gold + o.prestige + o.favor) >= 0 ? 'good' : 'bad'}">
                        <b>${o.playerIndex === 0 ? 'You' : o.name}</b>${parts.join(', ')}</span>`
                    : '';
            }).filter(Boolean);
            return bits.length
                ? `<div class="mc-others"><span class="mc-others-lab">Also affected</span>${bits.join('')}</div>`
                : '';
        };

        // ── A conditional reward that MISSED ─────────────────────────────
        // Recording only the payout meant a gate that failed said nothing at
        // all. Asserting the counterfactual is the whole point of the beat.
        const gateChips = (b) => (((b.r.deltas || {}).gates) || [])
            .filter(g => !g.met)
            .map(g => chip(g.unit, `No ${g.card} — ${g.value} ${cap(g.unit)} lost`, 'bad'))
            .join('');

        // Honest payout chips from the engine's measured deltas — plus the
        // printed skill grants and map, which deltas can't see.
        const rewardChips = (b) => {
            const m = b.r.mission;
            const d = b.r.deltas || {};
            const goldGain = (d.gold || 0) + (b.r.borrowed || 0); // reward gross of the borrow fee
            // THE CONSEQUENCE LEADS, at headline size. Wyatt: "the mission phase
            // needs to highlight what happens when you win and lose MORE — if you
            // fail and gain 30 Scorn, it should stop the game and show that this
            // player is getting 30 Scorn." A failure leads with what it cost you;
            // a success leads with what it paid. Everything else follows as
            // ordinary chips, and the beat holds longer when a headline lands.
            // A mission's printed favorValue is banked at SCORING, not at the
            // resolution — the deltas can't see it, which is why a success
            // used to land with a bare stamp and no payoff (Wyatt 7/18:
            // "missions being successful and then nothing's happening").
            // Fold it into the success headline so the win reads on screen.
            const favorGain = (d.favor || 0) + (b.r.success ? (m.favorValue || 0) : 0);
            // A fail that PAYS (Alchemic Seige's +20 Prestige, the Fortune
            // Teller's 50 on The Labyrinth) headlines its prestige when no
            // scorn landed — those rewards used to resolve invisibly.
            const lead = b.r.success
                ? (favorGain > 0 ? 'favor' : null)
                : ((d.scorn || 0) > 0 ? 'scorn'
                    : ((d.prestige || 0) > 0 ? 'prestige' : null));

            const chips = [];
            if (lead === 'scorn') chips.push(chip('scorn', `+${d.scorn} Scorn`, 'bad big'));
            if (lead === 'favor') chips.push(chip('favor', `+${favorGain} Favor`, 'good big'));
            if (lead === 'prestige') chips.push(chip('prestige', `+${d.prestige} Prestige`, 'good big'));

            if (favorGain > 0 && lead !== 'favor') chips.push(chip('favor', `+${favorGain} Favor`, 'good'));
            if (goldGain > 0) chips.push(chip('gold', `+${goldGain} Gold`, 'good'));
            if (d.prestige > 0 && lead !== 'prestige') chips.push(chip('prestige', `+${d.prestige} Prestige`, 'good'));
            if (d.scorn < 0) chips.push(chip('scorn', `−${-d.scorn} Scorn`, 'good'));
            if (d.stones > 0) chips.push(chip('philosopher', `+${d.stones} Philosopher's Stone`, 'good'));
            if (d.mindsEye > 0) chips.push(chip('minds_eye', `+${d.mindsEye} Mind's Eye`, 'good'));
            if (b.r.success && m.successRewards && m.successRewards.skills) {
                Object.entries(m.successRewards.skills).forEach(([sk, n]) =>
                    chips.push(chip(sk, `+${n} ${cap(sk)}`, 'good')));
            }
            if (b.r.success && m.grantsMap) chips.push(chip('maps', `${m.grantsMap} Map`, 'good'));
            if (b.r.borrowed) chips.push(chip('gold', `Borrowed help −${b.r.borrowed}g`, 'bad'));
            if (goldGain < 0) chips.push(chip('gold', `−${-goldGain} Gold`, 'bad'));
            if (d.favor < 0) chips.push(chip('favor', `−${-d.favor} Favor`, 'bad'));
            if (d.prestige < 0) chips.push(chip('prestige', `−${-d.prestige} Prestige`, 'bad'));
            if (d.scorn > 0 && lead !== 'scorn') chips.push(chip('scorn', `+${d.scorn} Scorn`, 'bad'));
            return chips.join('');
        };

        // The whole beat body, in reading order: what they needed, what moved,
        // what a missed gate cost, which cards it took, who else it touched.
        //
        // ⚠ THE EMPTY BEAT. The Labyrinth carries failurePenalties:{} and a
        // conditional failSpecial, so failing it without the Fortune Teller
        // moved NOTHING -- all six measured deltas 0, every one of the
        // thirteen chip conditionals false, rewardChips returning "". The beat
        // rendered a card and a Failed stamp over an empty rewards div and,
        // with no headline chip, held the SHORT window and moved on. That is
        // exactly Wyatt's "if someone fails Labyrinth, you don't really see it
        // happen". A beat must never render nothing: when nothing measurable
        // moved, state the mission's printed consequence instead.
        const beatBody = (b) => {
            const chips = rewardChips(b);
            const gates = gateChips(b);
            const took = discardStrip(b);
            const others = othersRow(b);
            let fallback = '';
            if (!chips && !gates && !took && !others) {
                const worth = b.r.mission.favorValue || 0;
                fallback = b.r.success
                    ? `<span class="mc-chip flat">Completed — no further reward</span>`
                    : (worth > 0
                        ? chip('favor', `${worth} Favor forfeit`, 'bad big')
                        : `<span class="mc-chip flat">Failed — no penalty, the mission is simply lost</span>`);
            }
            return reqLine(b) + chips + gates + fallback + took + others;
        };

        const renderBeat = (b) => {
            const p = game.players[b.pi];
            const char = p.character;
            const portrait = char ? `assets/characters/${char.filename}` : 'assets/ui/cover.jpg';
            const mine = perPlayer[b.pi];
            const nth = mine.indexOf(b) + 1;
            stage.className = 'mc-stage';   // fresh beat: clears stamped/fail
            stage.innerHTML = `
                <div class="mc-player">
                    <img class="mc-portrait" src="${portrait}" alt="">
                    <div class="mc-pname">${b.pi === 0 ? 'You' : p.name}</div>
                    <div class="mc-pcount">Mission ${nth} of ${mine.length}</div>
                </div>
                <div class="mc-cardwrap">
                    <img class="mc-card" src="assets/cards/missions/${b.r.mission.filename}" alt="${b.r.mission.name}">
                    <div class="mc-stamp">${b.r.success ? 'Complete' : 'Failed'}</div>
                </div>
                <div class="mc-rewards"></div>`;
            timer = setTimeout(() => stamp(b), 1000 * speed());
        };

        const stamp = (b) => {
            if (closed || stage.classList.contains('stamped')) return;
            clearTimeout(timer);
            stampedAt = Date.now();
            stage.classList.add('stamped');
            if (!b.r.success) stage.classList.add('fail');
            const rw = stage.querySelector('.mc-rewards');
            rw.innerHTML = beatBody(b);
            [...rw.children].forEach((c, i) => { c.style.animationDelay = `${0.12 + i * 0.13}s`; });
            // A real consequence (the headline chip) gets extra time on screen —
            // 30 Scorn should land, not scroll by. Wyatt also says the endgame
            // "happens really quick", and Act 3 puts many missions in play, so
            // the hold is CAPPED: legibility is the right seconds, not more of
            // them. Beats can no longer be empty, so the short window is now
            // only ever spent on a genuinely light beat.
            const heavy = rw.querySelector('.mc-chip.big');
            const hold = Math.min((heavy ? 2700 : 1700) + rw.children.length * 260, 5200);
            timer = setTimeout(next, hold * speed());
        };

        const next = () => {
            if (closed) return;
            clearTimeout(timer);
            bi++;
            if (bi >= beats.length) { close(); return; }
            renderBeat(beats[bi]);
        };

        const close = () => {
            if (closed) return;
            closed = true;
            clearTimeout(timer);
            el.classList.remove('active');
            el.onclick = null;
            setTimeout(resolve, 280);
        };

        // Tap once = reveal the verdict now; tap again = next mission. A
        // quick double-tap used to swallow a verdict whole (Turbo Grandma's
        // Royal Ball advanced with no stamp on 7/18's recording) — the
        // second tap must wait until the stamp has actually been seen.
        // Input debounce, not cinema: scale by CINEMATIC_SPEED alone, NOT
        // MISSION_PACE (the 1.4 pushed the gate past the audit's tap cadence).
        el.onclick = () => {
            if (!stage.classList.contains('stamped')) stamp(beats[bi]);
            else if (Date.now() - stampedAt > 380 * (window.CINEMATIC_SPEED || 1)) next();
        };

        el.classList.add('active');
        renderBeat(beats[0]);
    });
}

// ═══ MISSION DEALT — "wait, what did I just get?" ═════════════════════
// Some resolutions DEAL missions: failing The Midnight Crash hands every player
// an Act 3 mission. The engine did that in total silence — the card appeared in
// your hand and the only trace was one line in the log. Wyatt: "slow the game
// down… the player should see — what mission did I get? Oh, I got this one.
// That's cool. A few seconds to look at it, then the game moves on."
// One beat per dealing card: YOUR card, big, a few seconds, tap to move on.
// Reuses the ceremony's stage so it looks native and costs no new CSS.
function showMissionDrawBeat() {
    const draws = (game && game._missionDraws) || [];
    const el = document.getElementById('missionCeremony');
    if (!el || !draws.length) return Promise.resolve();
    game._missionDraws = [];                        // narrated once, never twice

    const speed = () => (window.CINEMATIC_SPEED || 1) * MISSION_PACE;

    return draws.reduce((chain, ev) => chain.then(() => new Promise((resolve) => {
        const mine = ev.drawn.find(d => d.playerIndex === 0);
        if (!mine) { resolve(); return; }           // nothing of yours to read
        const others = ev.drawn.filter(d => d.playerIndex !== 0);
        const m = mine.mission;
        const char = game.players[0].character;
        const portrait = char ? `assets/characters/${char.filename}` : 'assets/ui/cover.jpg';

        let closed = false, timer = null;
        const close = () => {
            if (closed) return;
            closed = true;
            clearTimeout(timer);
            el.classList.remove('active');
            el.onclick = null;
            setTimeout(resolve, 280);
        };

        el.innerHTML = `
            <div class="mc-inner">
                <div class="ms-banner">
                    <img class="mc-banner-icon" src="assets/icons/mission.png" alt="">${ev.source}
                    <span class="ms-act">All Players Draw</span>
                </div>
                <div class="mc-stage">
                    <div class="mc-player">
                        <img class="mc-portrait" src="${portrait}" alt="">
                        <div class="mc-pname">You</div>
                        <div class="mc-pcount">Your new mission</div>
                    </div>
                    <div class="mc-cardwrap">
                        <img class="mc-card" src="assets/cards/missions/${m.filename}" alt="${m.name}">
                    </div>
                    <div class="mc-rewards">
                        <span class="mc-chip good"><img src="assets/icons/mission.png" alt="">${m.name}</span>
                        ${m.act ? `<span class="mc-chip">Due Act ${m.act}</span>` : ''}
                        ${others.length ? `<span class="mc-chip">${others.length} rival${others.length > 1 ? 's' : ''} drew one too</span>` : ''}
                    </div>
                </div>
                <div class="ms-hint">tap to continue</div>
            </div>`;
        [...el.querySelectorAll('.mc-chip')].forEach((c, i) => {
            c.style.animationDelay = `${0.25 + i * 0.14}s`;
        });

        el.classList.add('active');
        el.onclick = close;
        // A few seconds to actually read it — Wyatt's ask — then move on by itself
        // so an unattended seat (or a multiplayer table) can never stall here.
        timer = setTimeout(close, 4200 * speed());
    })), Promise.resolve());
}

// ═══ MELEE — end-of-act battle & coronation cinematic ═════════════════
// The reveal itself lives in js/melee.js (Skylar's system — self-contained,
// it also drives testrealm/tools/melee-preview.html). Here we just hand it
// the results, the portraits and the engine's power arithmetic, and await
// the promise so the act flow waits for the moment. Unattended it advances
// on its own (per-fighter fallback + autoClose), so MP never stalls on a seat.
function showMeleeSplash(results, actNum) {
    const el = document.getElementById('meleeSplash');
    if (!el || !results || !results.length || typeof playMeleeCinematic !== 'function') {
        return Promise.resolve();
    }
    return playMeleeCinematic(el, results, actNum, {
        speed: window.CINEMATIC_SPEED || 1,
        // Auto-play the whole melee at a calm, thematic pace — never wait on a
        // tap at each fighter (Wyatt 7/17). Continue still lets you skip ahead.
        forgeHoldMs: 3600,
        autoCloseMs: 5200,
        powerIcon: 'assets/icons/power.png',
        portraitFor: (pi) => {
            const p = (pi != null && game.players[pi]) ? game.players[pi] : null;
            return p && p.character ? `assets/characters/${p.character.filename}` : 'assets/ui/cover.jpg';
        },
        breakdownFor: (pi) => (typeof game.powerBreakdown === 'function' ? game.powerBreakdown(pi) : null),
        // Mission cards live in their own art folder.
        cardImgFor: (filename, mission) => (filename ? `assets/cards/${mission ? 'missions' : 'regular'}/${filename}` : null),
        // Physical prestige token art by denomination (25 lacks the "Copy of" prefix).
        prestigeTokenFor: (d) => (d === 25
            ? 'assets/tokens/Tokens_Design_v1_Prestige_25_v1.jpg'
            : `assets/tokens/Copy of Tokens_Design_v1_Prestige_${d}_v1.jpg`)
    });
}


// ─── CARD ZOOM ─────────────────────────────────────────────

function zoomCard(src) {
    document.getElementById('zoomImg').src = src;
    document.getElementById('cardZoom').classList.add('active');
}

function closeZoom() {
    document.getElementById('cardZoom').classList.remove('active');
}

// Close action panel on outside click.
// Player chips, sidebar rows and their ◀▶ neighbor tags are NOT "outside":
// they open overlays that step the panel aside and restore it on close —
// dismissing here would eat the selection under that dance (tapping a
// neighbor arrow used to silently kill the panel; that was the whole bug).
document.addEventListener('click', (e) => {
    if (!e.target.closest('.hand-card') && !e.target.closest('.action-panel')
        && !e.target.closest('.pmat') && !e.target.closest('.opp-entry')
        && !e.target.closest('.nt-tag') && !e.target.closest('#tvBoardThumb')) {
        hideActionPanel();
    }
});

// ESC closes all game overlays; arrows browse the mission browser
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeAllOverlays();
        closeZoom();
        closeCardPeek();
    }
    if (document.getElementById('missionLB')?.classList.contains('active')) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); mbStep(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); mbStep(1); }
    }
});

// ─── UTILITIES ─────────────────────────────────────────────

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ═══ Table skins — cosmetic play surfaces (The Table Maker) ═════════════
// A skin is a material, never a scene: every option keeps the same warm
// vignette so gameplay reads identically. Free while we tune; Stars later.
const TABLE_SKINS = [
    { id: 'oak',    name: 'Royal Oak',        cls: '',            swatch: '' },
    { id: 'leather', name: 'Oxblood Leather', cls: 'skin-leather', swatch: 'tsw-leather' },
    { id: 'velvet', name: 'Crimson Velvet',   cls: 'skin-velvet', swatch: 'tsw-velvet' },
    { id: 'queens', name: "The Queen's Table", cls: 'skin-queens', swatch: 'tsw-queens' },
];

function currentTableSkin() {
    try { return localStorage.getItem('favor_table_skin') || 'oak'; } catch (e) { return 'oak'; }
}

function applyTableSkin(id) {
    const skin = TABLE_SKINS.find(s => s.id === id) || TABLE_SKINS[0];
    try { localStorage.setItem('favor_table_skin', skin.id); } catch (e) {}
    const g = document.getElementById('game-screen');
    if (g) {
        TABLE_SKINS.forEach(s => { if (s.cls) g.classList.remove(s.cls); });
        if (skin.cls) g.classList.add(skin.cls);
    }
    renderStoreTables();
}
window.applyTableSkin = applyTableSkin;

function renderStoreTables() {
    const holder = document.getElementById('stTables');
    if (!holder) return;
    const cur = currentTableSkin();
    holder.innerHTML = TABLE_SKINS.map(s => `
        <div class="st-table-card${s.id === cur ? ' equipped' : ''}"
             onclick="event.stopPropagation(); applyTableSkin('${s.id}')">
            <div class="st-table-swatch ${s.swatch}"
                 ${s.swatch ? '' : 'style="background: radial-gradient(ellipse at 50% 40%, #6b4a30 0%, #4a3020 55%, #2a1a10 100%)"'}></div>
            <div class="st-table-plate">
                <span class="st-table-name">${s.name}</span>
                <span class="st-table-state">${s.id === cur ? '✦ On your table' : 'Free — tap to equip'}</span>
            </div>
        </div>`).join('');
}

// The store panel is FLB's (meta.js, loads after us) — watch its class
// instead of patching its code, and paint our shelf whenever it opens.
(function () {
    const panel = document.getElementById('storePanel');
    if (!panel) return;
    new MutationObserver(() => {
        if (panel.classList.contains('active')) renderStoreTables();
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
})();

// Restore the equipped table on load; ?table=<id> overrides (review/testing).
(function () {
    let id = currentTableSkin();
    try {
        const q = new URLSearchParams(location.search).get('table');
        if (q && TABLE_SKINS.some(s => s.id === q)) id = q;
    } catch (e) {}
    applyTableSkin(id);
})();
