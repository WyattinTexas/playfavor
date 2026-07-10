/**
 * FAVOR — UI Controller
 * Manages screens, rendering, player interaction
 * Includes cinematic card spotlight system
 */

let game = null;
let selectedCharacter = null;
let musicPlaying = false;
let selectedHandCard = null;

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
    "charisma_or_prospecting":       "Gain Charisma or Prospecting (auto-picked).",
    "alchemy_or_prospecting":        "Gain Alchemy or Prospecting (auto-picked).",
    "minds_eye":                     "+1 Knowledge (Mind's Eye).",
    "philosopher_stone":             "Converts Gold to Favor at game end!",
    "map_lost_north":                "Reveals a hidden path to the North.",
    "power_x2":                      "Doubles your Power for Melee!",
    "move_slider_any":               "Move your slider to any position!",
    "double_adventure_favor":        "Doubles Favor from all Adventures!",
    "minus_3_power_all_others":      "All opponents lose 3 Power!",
    "scorn_to_prestige":             "Converts all Scorn into Prestige!",
    "map_finding_lost_corridor":     "Unlocks the Finding the Lost Corridor adventure.",
    "The Shadow Guide":              "Summons the Shadow Guide to lead the way.",
    "gold_to_prestige":              "Converts Gold into Prestige!",
    "others_5_scorn":                "All opponents gain 5 Scorn!",
    "multiply_gold_x2":              "Doubles your Gold!",
    "coin_flip_4_power":             "Flip a coin: win = +4 Power!",
    "remove_mission_requirements":   "Removes all mission requirements!",
    "remove_13_scorn":               "Removes up to 13 Scorn!",
    "trade_route":                   "Opens a trade route for lasting profit.",
    "discard_opponent_weapon":       "Destroys one weapon from each opponent!",
    "sacred_chest":                  "Unlocks the Sacred Chest for treasure.",
    "knowledge_x5":                  "Gain 5 Knowledge!",
    "knowledge_x2":                  "Doubles your Knowledge!",
    "philosopher_stone_x10":         "10x Philosopher's Stone conversion!",
    "minds_eye_x2_philosopher_stone_x5": "2x Mind's Eye + 5x Philosopher's Stone!",
    "map":                           "A fragment of the ancient map.",
    "king_of_the_sky":               "King of the Sky -- dominates Melee!",
    "defend_the_throne":             "Defends the throne from all challengers!",
    "gold_2_per_alchemy_triangle":   "2 Gold for each Alchemy you and both neighbors have.",
    "gold_2_per_power_neighbors":    "2 Gold for each Power your two neighbors have.",
    "favor_per_survival_x2":         "Scores 2 Favor for each Survival you have.",
    "favor_per_quest_x5":            "Scores 5 Favor per completed mission.",
    "favor_per_sur_cha_pro":         "Scores 1 Favor per Survival, Charisma & Prospecting.",
    "favor_per_wisdom_x8":           "Scores 8 Favor for each Wisdom card you have.",
    "favor_per_neighbor_power":      "Scores 1 Favor for each Power your neighbors have.",
    "power_6_if_blind_faith":        "+6 Power in Melee while you own Blind Faith.",
};

// ─── SLOT SPECIAL LABELS (Character Board) ───────────────
const SLOT_SPECIAL_LABELS = {
    "steal_3_prestige_each":       "Steal 3 Prestige",
    "steal_2_gold_each":           "Steal 2 Gold each",
    "give_1_gold_each":            "Give 1 Gold each",
    "all_others_1_scorn":          "Others +1 Scorn",
    "convert_gold_to_prestige":    "Gold \u2192 Prestige",
    "philosopher_stone":           "Philosopher\u2019s Stone",
    "philosopher_stone_x2":        "2\u00D7 Philosopher\u2019s Stone",
    "minds_eye":                   "Mind\u2019s Eye",
    "minds_eye_x5":                "5\u00D7 Mind\u2019s Eye",
    "minds_eye_and_philosopher":   "Mind\u2019s Eye + Phil. Stone",
    "pick_one":                    "Choose a Skill",
    "borrow_any_player":           "Borrow from any player",
    "mission_fail_10_gold":        "Fail mission \u2192 +10 Gold",
    "choose_mission":              "Choose a Mission",
};

/**
 * Build a compact label array for a character board slot.
 * Returns an array of short strings like ["+5 Gold", "Power +1", "15 Favor"].
 */
function buildSlotLabel(slot) {
    if (!slot) return ['(empty)'];
    const parts = [];

    // Skills
    if (slot.skills) {
        Object.entries(slot.skills).forEach(([skill, val]) => {
            const name = skill.charAt(0).toUpperCase() + skill.slice(1);
            parts.push(`${name} +${val}`);
        });
    }

    // One-time gold
    if (slot.gold) parts.push(`+${slot.gold} Gold`);

    // One-time scorn
    if (slot.scorn) parts.push(`+${slot.scorn} Scorn`);

    // Favor
    if (slot.favor) parts.push(`${slot.favor} Favor`);

    // Special
    if (slot.special && SLOT_SPECIAL_LABELS[slot.special]) {
        parts.push(SLOT_SPECIAL_LABELS[slot.special]);
    }

    if (parts.length === 0) parts.push('\u2014');
    return parts;
}

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

/**
 * Build a read-only mini slot track for an opponent's character board.
 */
function buildMiniSlotTrack(playerIndex) {
    const player = game.players[playerIndex];
    const char = player.character;
    if (!char || !char.slots) return '';

    const posNames = ['1', '2', '3', '4', '5'];
    const claimed = player.claimedSlots || new Set([2]);

    let cells = '';
    for (let i = 0; i < 5; i++) {
        const isCurrent = i === player.sliderPosition;
        const isClaimed = claimed.has(i) && !isCurrent;
        const stateClass = isCurrent ? 'current' : isClaimed ? 'claimed' : 'unclaimed';
        const labels = buildSlotLabel(char.slots[i]);

        cells += `<div class="opp-slot-cell ${stateClass}">
            <div class="opp-slot-num">${posNames[i]}</div>
            <div class="opp-slot-rewards">${labels.map(l => `<div class="opp-slot-line">${l}</div>`).join('')}</div>
        </div>`;
    }

    return `<div class="opp-slot-track">
        ${cells}
        <div class="opp-slot-ring" style="transform: translateX(${player.sliderPosition * 100}%)"></div>
    </div>`;
}

function buildSpotlightContent(playerIndex, card, action) {
    const isDiscard = (action === 'discard' || action === 'discard_slide');
    const player = game.players[playerIndex];
    const playerName = player.name;
    const char = player.character;
    const avatarSrc = char ? `assets/characters/${char.filename}` : '';
    const charName = char ? char.name : '';

    const actionLabel = isDiscard
        ? `${playerName} discards...`
        : `${playerName} plays...`;

    // Build new card display
    const imgSrc = `assets/cards/regular/${card.filename}`;
    const safeCardName = card.name.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    const actionTag = isDiscard ? 'DISCARDING' : 'NOW PLAYING';

    // Build effect description for the new card
    let effectText = '';
    if (isDiscard) {
        effectText = action === 'discard_slide' ? 'Slider move' : '+3 Gold';
    } else if (card.special && SPECIAL_DESCRIPTIONS[card.special]) {
        effectText = SPECIAL_DESCRIPTIONS[card.special];
    } else {
        const parts = [];
        if (card.rewards) {
            if (card.rewards.gold) parts.push(`+${card.rewards.gold}g`);
            if (card.rewards.prestige) parts.push(`+${card.rewards.prestige} Pres`);
            if (card.rewards.favor) parts.push(`+${card.rewards.favor} Fav`);
        }
        if (card.favor) parts.push(`+${card.favor} Fav`);
        if (card.skills && card.skills.length > 0) parts.push(card.skills.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(', '));
        effectText = parts.join(' \u00B7 ');
    }

    // Stats
    const state = game.getState(0);
    const ps = state.players[playerIndex];

    // Previously played cards (before this card is added)
    const playedCards = player.playedCards || [];
    let playedHtml = '';
    if (playedCards.length > 0) {
        playedHtml = `<div class="opp-turn-played">
            ${playedCards.slice(-8).map(c =>
                `<img class="opp-turn-played-card" src="assets/cards/regular/${c.filename}" alt="${c.name}">`
            ).join('')}
        </div>`;
    }

    let html = `<div class="spotlight-backdrop"></div>`;
    html += `<div class="opp-turn-inner">`;

    // Header
    html += `<div class="opp-turn-header">
        <img class="opp-turn-avatar" src="${avatarSrc}" alt="${charName}">
        <div class="opp-turn-header-info">
            <div class="opp-turn-name">${playerName}</div>
            <div class="opp-turn-char">${charName}</div>
        </div>
    </div>`;

    // Ring track
    html += `<div class="opp-turn-ring">${buildMiniSlotTrack(playerIndex)}</div>`;

    // Stats
    html += `<div class="opp-turn-stats">${statPillsHtml(ps)}</div>`;

    // Action label
    html += `<div class="spotlight-player">${actionLabel}</div>`;

    // New card + previously played
    html += `<div class="opp-turn-cards-area">`;
    html += playedHtml;
    html += `<div class="opp-turn-new-card ${isDiscard ? 'discard' : 'play'}">
        <div class="opp-turn-new-tag">${actionTag}</div>
        <img src="${imgSrc}" alt="${safeCardName}" onerror="this.style.display='none'">
        <div class="opp-turn-new-name">${card.name}</div>
        ${effectText ? `<div class="opp-turn-new-effect">${effectText}</div>` : ''}
    </div>`;
    html += `</div>`;

    html += `<div class="spotlight-dismiss">click to continue</div>`;
    html += `</div>`;

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
        favor: p.favor
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
        { key: 'favor', prev: _prevStats.favor, curr: p.favor, cls: 'favor-change', label: 'Favor' },
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

function showNotification(msg, type = 'info') {
    const container = document.getElementById('notifications');
    if (!container) return;

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

function startGame() {
    document.getElementById('title-screen').classList.add('hidden');
    setTimeout(() => {
        document.getElementById('title-screen').style.display = 'none';
        showCharacterSelect();
    }, 1200);
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
    { text: `Each round you're dealt a hand. <b>Play one card, then pass the rest</b> to the next player. Everyone drafts from the same hands \u2014 choose wisely!`,
      art: `<div class="ht-fan"><img src="assets/cards/regular/Trapping Card.jpg" alt=""><img src="assets/cards/regular/Cooking Card.jpg" alt=""><img src="assets/cards/regular/Negotiate Card.jpg" alt=""></div>` },
    { text: `On your turn, <b>play a card</b> to gain its skills (you'll need the right skills for some). Not useful? <b>Discard it for +3 gold</b> \u2014 or to slide your ring.`,
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
// Phone table-view only (desktop players have the How-to-Play deck).

function coachSumSkills(sk) {
    if (!sk) return 0;
    return Object.values(sk).reduce((a, b) => a + (b || 0), 0);
}
function coachMyTurn(s) {
    const hand = s.players[0].hand;
    return s.activePlayerIndex === 0 && hand && hand.length > 0
        && s.phase !== 'scoring' && s.phase !== 'game_over';
}

const COACH_STEPS = [
    { id: 'welcome',
      text: `You're seated at the table — this chip is <b>you</b>. Tap it (or your board, top right) to open your full board.`,
      anchor: () => document.querySelector('#tvSeats .pmat.you'),
      place: 'bottom',
      when: () => true },
    { id: 'missions',
      text: `These are the <b>Missions of the Realm</b> — complete them for <b>Favor</b>, the points that win the crown. Tap one to read it.`,
      anchor: () => document.getElementById('tvMissionRail'),
      place: 'bottom',
      when: (s) => (s.visibleMissions || []).length > 0 },
    { id: 'hand',
      text: `Your turn! <b>Drag a card up</b> out of your hand and let go — then choose: play it, discard it for gold, or more.`,
      anchor: () => document.getElementById('tvHandStrip'),
      place: 'top',
      when: (s) => coachMyTurn(s) },
    { id: 'rivals',
      text: `Tap a <b>rival's chip</b> to see their board and played cards — and borrow a skill when you're short.`,
      anchor: () => document.querySelector('#tvSeats .pmat.opp'),
      place: 'bottom',
      when: (s) => s.players.some((p, i) => i !== 0 && coachSumSkills(p.skills) > 0) },
    { id: 'skills',
      text: `Your <b>skills</b> live here, always in view — the cards you play grow them. Tap an icon for its name.`,
      anchor: () => document.getElementById('tvSkills'),
      place: 'right',
      when: (s) => coachSumSkills(s.players[0].skills) > 0 },
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
    if (!isCompactLandscape() || typeof game === 'undefined' || !game || coachOverlayOpen()) {
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
function coachPromptTestOn() {
    try { return localStorage.getItem('favor_prompt_test') === '1'; } catch (e) { return false; }
}
// If Prompt Test is on, wipe seen-state at the start of each game so tips replay.
function coachApplyPromptTest() {
    if (coachPromptTestOn()) { _coachSeen = new Set(); coachSaveSeen(); _coachActive = null; coachStartHeartbeat(); }
}
// BATTLE TEST — when on, a new game jumps straight to the brink of the Act 1
// Melee: every player begins with a full, legally-played board and exactly one
// card left in hand. Play it (bots follow) and the Melee resolves at once —
// a fast path for iterating on the battle screen without playing a whole act.
function toggleBattleTest(on) {
    try { localStorage.setItem('favor_battle_test', on ? '1' : '0'); } catch (e) {}
}
function battleTestOn() {
    try { return localStorage.getItem('favor_battle_test') === '1'; } catch (e) { return false; }
}
// Restore both checkboxes to their saved state on load (scripts run after DOM).
(function () {
    try {
        const cb = document.getElementById('promptTestToggle');
        if (cb) cb.checked = coachPromptTestOn();
        const bt = document.getElementById('battleTestToggle');
        if (bt) bt.checked = battleTestOn();
    } catch (e) {}
})();

// ─── CHARACTER SELECT ──────────────────────────────────────

// The three heroes offered THIS game — the other seven are "already
// taken" by the other players in your queue, and the bots genuinely
// draw from those leftovers in confirmCharacter.
let _offeredHeroes = [];

function showCharacterSelect() {
    const screen = document.getElementById('character-select');
    screen.classList.add('active');

    const grid = document.getElementById('characterGrid');
    grid.innerHTML = '';

    if (!window.FAVOR_DATA || !window.FAVOR_DATA.characters) {
        grid.innerHTML = '<p style="color: var(--gold); grid-column: 1/-1; text-align: center;">Loading character data...</p>';
        return;
    }

    // The offer draws from the heroes YOU OWN (first five are everyone's;
    // store purchases join the pool — FLB.ownedIds). Owned is always ≥5,
    // so three offerings never starve. Bots still draw from all ten.
    const ownedIds = (window.FLB && typeof FLB.ownedIds === 'function')
        ? FLB.ownedIds()
        : window.FAVOR_DATA.characters.slice(0, 5).map(c => c.id);
    const ownedChars = window.FAVOR_DATA.characters.filter(c => ownedIds.includes(c.id));
    _offeredHeroes = shuffleArray(ownedChars).slice(0, 3);
    _offeredHeroes.forEach(char => {
        const card = document.createElement('div');
        card.className = 'character-card fade-in';
        card.dataset.id = char.id;
        card.onclick = () => selectCharacter(char.id, card);

        const stars = '\u2605'.repeat(Math.floor(char.difficulty)) + (char.difficulty % 1 ? '\u00BD' : '');

        card.innerHTML = `
            <img src="assets/characters/${char.filename}" alt="${char.name}">
            <div class="character-info">
                <h3>${char.name}</h3>
                <div class="difficulty">Difficulty: ${stars}</div>
                <div class="tip">${char.tip || ''}</div>
            </div>
        `;

        grid.appendChild(card);
    });
}

function selectCharacter(id, cardEl) {
    document.querySelectorAll('.character-card').forEach(c => c.classList.remove('selected'));
    cardEl.classList.add('selected');
    selectedCharacter = id;
    const btn = document.getElementById('confirmBtn');
    btn.style.display = 'inline-block';
    // Begin Your Journey sits below the fold on phones — picking a hero
    // carries you straight down to it (#character-select is the scroller;
    // rAF lets the reveal land in layout first).
    requestAnimationFrame(() =>
        btn.scrollIntoView({ behavior: 'smooth', block: 'end' }));
}

function confirmCharacter() {
    if (!selectedCharacter) return;

    // Table size = the queue you joined on the menu (persisted; the old
    // in-select dropdown moved there so Play Now can never skip past it).
    const playerCount = (window.FLB && FLB.queueSize()) || 3;

    game = new FavorGame(playerCount);
    game.loadDecks();

    // Bots draw from the heroes that were NOT offered to you — the other
    // "players" in your queue already took theirs, so the three on your
    // screen (minus your pick) stay off the table.
    const offered = _offeredHeroes.map(c => c.id);
    const allChars = window.FAVOR_DATA.characters.map(c => c.id);
    let available = allChars.filter(id => id !== selectedCharacter && !offered.includes(id));
    // Safety: never run short of rivals (10 - 3 offered = 7 ≥ 4 bots today).
    if (available.length < playerCount - 1) {
        available = allChars.filter(id => id !== selectedCharacter);
    }

    const choices = [{ characterId: selectedCharacter, playerName: 'You' }];

    const shuffled = shuffleArray(available);
    const aiNames = ['Prince Aldric', 'Princess Sera', 'Lord Cassius', 'Lady Elara'];
    for (let i = 0; i < playerCount - 1; i++) {
        choices.push({ characterId: shuffled[i], playerName: aiNames[i] });
    }

    game.initPlayers(choices);

    document.getElementById('character-select').classList.remove('active');

    game.startAct(1);
    addLogEntry('\u2550\u2550\u2550 Act 1 begins \u2550\u2550\u2550');

    // BATTLE TEST \u2014 fast-forward the whole act to its final card, so the
    // Melee is one play away. Everyone keeps a full, rule-legal board.
    if (battleTestOn()) {
        setupBattleTest();
        showNotification('Battle Test \u2014 play your last card for the Melee!', 'act');
    } else {
        showNotification('Act 1 Begins \u2014 Choose wisely.', 'act');
    }

    // If Prompt Test is checked, replay the tutorial prompts this game.
    if (typeof coachApplyPromptTest === 'function') coachApplyPromptTest();

    showGameScreen();
}

// ─── BATTLE TEST SETUP ─────────────────────────────────────
// Advance a fresh Act 1 to its very last card for every player. We PLAY the
// pre-board through the real engine (activateCard) so skills, gold and Power
// all accumulate exactly as they would in a real act — the Melee totals are
// genuine, not faked. Each card is only ever played when the engine says its
// requirements are currently met, so no rule is ever broken. Every player is
// left holding exactly one still-playable card; playing it ends the act.
function setupBattleTest() {
    const PRE_PLAYED_TARGET = 5;   // aim for ~4–5 played cards per player
    // Unique-id source for the cloned cards, well clear of the real deck's ids.
    let cloneId = 900000;

    // A shuffled pool of fresh Act 1 card clones for one player. Clones so the
    // same card can seed several boards, and so playing one never mutates the
    // shared data or another player's copy.
    const freshPool = () => shuffleArray(
        window.FAVOR_DATA.cards
            .filter(c => c.act === 1 && c.type !== 'mission_letter')
            .map(c => Object.assign(JSON.parse(JSON.stringify(c)), { id: ++cloneId }))
    );

    // Play one currently-legal card from the pool into the player's board.
    // Returns the played card, or null if nothing in the pool is playable now.
    const playOneLegal = (pi, pool) => {
        const idx = pool.findIndex(card => {
            const { canPlay } = game.checkRequirements(pi, card);
            const affordable = !card.cost || game.players[pi].gold >= card.cost;
            return canPlay && affordable;
        });
        if (idx === -1) return null;
        const [card] = pool.splice(idx, 1);
        // activateCard reads the card from pendingActivations, so stage it there.
        game.pendingActivations[pi] = card;
        const res = game.activateCard(pi, card.id, 'play');
        game.pendingActivations[pi] = null;
        return (res && res.success) ? card : null;
    };

    for (let pi = 0; pi < game.playerCount; pi++) {
        const pool = freshPool();

        // Build the board: keep playing legal cards until the target is met or
        // the pool runs dry of anything currently playable.
        let played = 0;
        while (played < PRE_PLAYED_TARGET) {
            if (!playOneLegal(pi, pool)) break;
            played++;
        }

        // Leave exactly one still-playable card in hand — the act's final play.
        // (Search from the now-current board state so it's guaranteed legal.)
        const lastIdx = pool.findIndex(card => {
            const { canPlay } = game.checkRequirements(pi, card);
            const affordable = !card.cost || game.players[pi].gold >= card.cost;
            return canPlay && affordable;
        });
        game.players[pi].hand = lastIdx === -1 ? [] : [pool[lastIdx]];
    }

    // Fresh gameplay turn: nothing pending, human to act, board reflects the
    // pre-played cards. Playing the final card cascades to the Melee.
    game.phase = 'gameplay';
    game.pendingActivations = new Array(game.playerCount).fill(null);
    game.activePlayerIndex = 0;

    // Defensive: no current Act 1 card raises a human choice on play, but if one
    // ever does, its pre-played one-time choice is "already decided" here — clear
    // any stray pending-UI flags so no overlay dangles over the fast-forward.
    const you = game.players[0];
    you._pendingChemYPick = false;
    you._pendingPromiseDiscard = false;
    you._pendingSlotMission = false;

    addLogEntry('⚔ Battle Test — boards pre-played, one card each remains');
}

// ─── GAME SCREEN ───────────────────────────────────────────

// ─── SKILL GROUP MAPPING FOR CARD STACKS ─────────────────

const SKILL_GROUPS = {
    alchemy:     { label: 'Alchemy',     order: 0 },
    survival:    { label: 'Survival',    order: 1 },
    charisma:    { label: 'Charisma',    order: 2 },
    prospecting: { label: 'Prospecting', order: 3 },
    knowledge:   { label: 'Knowledge',   order: 4 },
    power:       { label: 'Power',       order: 5 },
};

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

function getCardSkillGroup(card) {
    if (card.skills && card.skills.length > 0) {
        return card.skills[0]; // Primary skill
    }
    return 'misc';
}

// ─── GAME SCREEN ───────────────────────────────────────────

function showGameScreen() {
    document.getElementById('game-screen').classList.add('active');
    renderGameState();
}

function renderGameState() {
    if (!game) return;

    const state = game.getState(0);

    renderPhaseBar(state);
    renderBoardThumb(state);
    renderStatsPanel(state);
    renderMissionStrip(state);
    renderCardStacks(state);
    renderSidebar(state);
    renderHand(state);
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
        'gameplay': 'Draft Phase — Pick a Card',
        'activate': 'Activation Phase',
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
        'gameplay': 'Draft',
        'activate': 'Activation',
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
    const phaseText = compact ? formatPhaseShort(state.phase) : formatPhase(state.phase);
    bar.innerHTML = `
        <span class="act-tag">Act ${acts[state.currentAct - 1] || state.currentAct}</span>
        <span class="phase-text">${phaseText}</span>
    `;
}

// ── Board Thumbnail ──

function renderBoardThumb(state) {
    const el = document.getElementById('boardThumb');
    const char = window.FAVOR_DATA.characters.find(c => c.id === selectedCharacter);
    if (!char) return;

    // The ring rides the thumb at the same %-based track the big overlay
    // uses (BOARD_OV_TRACK), so the mini board always shows where you are.
    // Rebuilt on every renderGameState, so slides stay in sync.
    const cur = (typeof game !== 'undefined' && game && game.players[0])
        ? game.players[0].sliderPosition : 2;
    el.innerHTML = `
        <div class="thumb-boardwrap">
            <img src="assets/characters/${char.filename}" alt="${char.name}">
            <img class="thumb-ring" src="assets/ui/slider-ring.png" alt=""
                 style="left:${BOARD_OV_TRACK.lefts[cur]}%; top:${BOARD_OV_TRACK.top}%">
        </div>
        <div class="thumb-footer">
            <span class="thumb-name">${char.name}</span>
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

function renderStatsPanel(state) {
    const panel = document.getElementById('statsPanel');
    const player = state.players[0];
    const gp = game.players[0];
    const emblem = state.emblemHolder === 0 ? `<div class="emblem-tag">${emblemBadge()} Emblem Holder</div>` : '';

    // Resource tokens row
    const resourcesHtml = `
        <div class="resource-tokens">
            <span class="resource-token gold-token">
                <img src="assets/tokens/Copy of Tokens_Design_v1_Gold_1_v1.jpg" alt="Gold" class="token-img">
                <span class="token-val gold-val">${player.gold}</span>
            </span>
            <span class="resource-token prestige-token">
                <img src="assets/tokens/Copy of Tokens_Design_v1_Prestige_1_v1.jpg" alt="Prestige" class="token-img">
                <span class="token-val prestige-val">${player.prestige}</span>
            </span>
            <span class="resource-token scorn-token">
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
            <div class="skill-row">
                <span class="skill-icon">${s.icon}</span>
                <span class="skill-label">${s.label}</span>
                <span class="skill-value${val > 0 ? ' has-skill' : ''}">${val}</span>
            </div>`;
    });

    // Flex skills (Mining Guild etc.): one unit, EITHER option per use —
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
            <div class="skill-row flex-skill" title="Counts as ${cap(a)} OR ${cap(b)} — your choice each time, never both">
                <span class="skill-icon flex-pair">${SKILL_ICONS[a]}${SKILL_ICONS[b]}</span>
                <span class="skill-label">${cap(a)} <i>or</i> ${cap(b)}</span>
                <span class="skill-value has-skill">${n > 1 ? '×' + n : '✦'}</span>
            </div>`;
    });

    // Special abilities: Philosopher's Stone & Mind's Eye \u2014 the engine
    // count (cards + slot + mission rewards), shown as the digit it is.
    const hasPhilosopher = gp.philosopherStone && gp.philosopherStone > 0;
    const mindsEyeCount = game.getMindsEyeCount(0);

    if (hasPhilosopher) {
        skillsHtml += `
            <div class="skill-row special-ability">
                <span class="skill-icon">${SKILL_ICONS.philosopher}</span>
                <span class="skill-label">Phil. Stone</span>
                <span class="skill-value has-skill">${gp.philosopherStone}:1</span>
            </div>`;
    }
    if (mindsEyeCount > 0) {
        skillsHtml += `
            <div class="skill-row special-ability" title="Mind's Eye \u2014 already counted in Knowledge">
                <span class="skill-icon">${SKILL_ICONS.minds_eye}</span>
                <span class="skill-label">Mind's Eye</span>
                <span class="skill-value has-skill">${mindsEyeCount}</span>
            </div>`;
    }
    skillsHtml += '</div>';

    // No act badge (the phase pill says it) and no ring-dot row (the board
    // thumb above wears the ring ON the art) — the panel is tokens + skills.
    panel.innerHTML = `
        ${resourcesHtml}
        ${skillsHtml}
        ${emblem}
    `;

    // Position dynamically after board thumb loads (desktop only — in compact
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

    // Group cards by primary skill
    const groups = {};
    player.playedCards.forEach(card => {
        const group = getCardSkillGroup(card);
        if (!groups[group]) groups[group] = [];
        groups[group].push(card);
    });

    // Sort groups by defined order
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        const oa = SKILL_GROUPS[a] ? SKILL_GROUPS[a].order : 99;
        const ob = SKILL_GROUPS[b] ? SKILL_GROUPS[b].order : 99;
        return oa - ob;
    });

    let html = '';
    sortedKeys.forEach(key => {
        const label = SKILL_GROUPS[key] ? SKILL_GROUPS[key].label : 'Other';
        const cards = groups[key];

        html += '<div class="card-stack">';
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

        html += `
            <div class="opp-entry${isActive ? ' active-turn' : ''}" data-pi="${i}"
                 onclick="openOppOverlay(${i})">
                <img class="opp-avatar" src="${avatarSrc}">
                <div class="opp-details">
                    <span class="opp-name">${p.name}${emblem}</span>
                    <div class="opp-gold-row">
                        <img src="${PURSE_ICONS.gold}" alt="Gold"><b>${p.gold}</b>
                    </div>
                    <div class="mini-stack">
                        ${p.playedCards.slice(-5).map(c =>
                            `<img class="mini-card" src="assets/cards/regular/${c.filename}" alt="${c.name}">`
                        ).join('')}
                    </div>
                </div>
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

    let html = '<div class="hand-hint" onclick="event.stopPropagation(); openHandInspect()">Click to inspect hand</div>';
    html += '<div class="hand-arc">';

    hand.forEach((card, i) => {
        const angle = startAngle + step * i;
        const lift = -Math.abs(angle) * 0.4;
        const isSelected = selectedHandCard === i;

        html += `<div class="hand-card${isSelected ? ' selected' : ''}"
                    style="transform: rotate(${angle}deg) translateY(${lift}px)"
                    onclick="event.stopPropagation(); selectHandCard(${i})"
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
        <div class="stat favor">${player.favor}</div>
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
        <span class="stat-pill favor"><img class="pill-icon" src="${PURSE_ICONS.favor}" alt="Favor"> ${ps.favor || 0} Favor</span>
        <span class="stat-pill scorn"><img class="pill-icon" src="${PURSE_ICONS.scorn}" alt="Scorn"> ${ps.scorn} Scorn</span>
    `;
}

function renderTvPurse(state) {
    const el = document.getElementById('tvPurse');
    if (!el) return;
    const p = state.players[0];
    const chip = (k, img, val, label) =>
        `<span class="tv-purse-chip ${k}" onclick="tvChipTip(event, '${label}')">
            <img src="${img}" alt="${label}"><b>${val}</b></span>`;
    // 2×2 reading order (Wyatt's 7/7 call): gold · prestige on top,
    // favor · scorn beneath.
    el.innerHTML =
        chip('gold', PURSE_ICONS.gold, p.gold, 'Gold')
      + chip('prestige', TOKEN_IMG.prestige, p.prestige, 'Prestige')
      + chip('favor', PURSE_ICONS.favor, p.favor || 0, 'Favor')
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
        h += `<span class="tv-skill-chip${val > 0 ? '' : ' zero'}"
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
                    onclick="tvChipTip(event, 'Philosopher\\'s Stone — ${gp.philosopherStone}:1')">
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
    return `
        <div class="pmat ${isYou ? 'you' : 'opp'} seat-chip${isActive ? ' active' : ''}" data-pi="${i}"
             onclick="event.stopPropagation(); ${open}" title="${p.name}">
            <img class="chip-art" src="${artSrc}" alt="${p.name}">
            ${crown}${youTag}
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
    const char = window.FAVOR_DATA.characters.find(c => c.id === selectedCharacter);
    if (!char) return;
    const cur = (game && game.players[0]) ? game.players[0].sliderPosition : 2;
    el.innerHTML = `
        <img class="tv-thumb-board" src="assets/characters/${char.filename}" alt="${char.name}">
        <img class="thumb-ring" src="assets/ui/slider-ring.png" alt=""
             style="left:${BOARD_OV_TRACK.lefts[cur]}%; top:${BOARD_OV_TRACK.top}%">`;
    el.onclick = () => openBoardOverlay();
}

// Tucked skill-group stacks — shared by the center stage (your cards)
// and the rival overlay (their cards read exactly like yours).
function buildSkillStacks(cards) {
    const groups = {};
    cards.forEach(c => {
        const g = getCardSkillGroup(c);
        (groups[g] = groups[g] || []).push(c);
    });
    const keys = Object.keys(groups).sort((x, y) =>
        (SKILL_GROUPS[x] ? SKILL_GROUPS[x].order : 99) - (SKILL_GROUPS[y] ? SKILL_GROUPS[y].order : 99));
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
        h += `<span class="tv-stack-label">${SKILL_GROUPS[k] ? SKILL_GROUPS[k].label : 'Other'}</span></div>`;
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

    // Playable glow (Battlegrounds-style): on your turn, cards you can
    // actually play get a soft green edge so options read at a glance.
    const myTurn = state.activePlayerIndex === 0 && state.phase === 'gameplay';

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

    let html = '<div class="hand-arc">';
    hand.forEach((card, i) => {
        const angle = startAngle + step * i;
        const lift = -Math.abs(angle) * 0.4;
        const isSelected = selectedHandCard === i;
        let playable = false;
        if (myTurn) {
            if (card.type === 'mission_letter') {
                playable = game.players[0].gold >= 1 && (state.visibleMissions || []).length > 0;
            } else {
                try { playable = game.checkRequirements(0, card).canPlay; } catch (e) { playable = false; }
            }
        }
        // No tap-to-select here: committing a card is the DRAG-UP gesture
        // (touch = bloom to read, drag up + release = action sheet).
        html += `<div class="hand-card${isSelected ? ' selected' : ''}${playable ? ' playable' : ''}"
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
        const prev = _tvPrev[i];

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
    const char = window.FAVOR_DATA.characters.find(c => c.id === selectedCharacter);
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
        if (pick.mode === 'hand') {
            setTimeout(() => selectHandCard(pick.cardIndex), 0);
        } else {
            document.getElementById('actionPanel').classList.add('active');
        }
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

function openSlidePicker(cardIndex) {
    if (!game || game.phase !== 'gameplay') return;
    _slidePick = { mode: 'hand', cardIndex };
    hideActionPanel();
    openBoardOverlay();
}

function openSlidePickerFinal(onPick) {
    _slidePick = { mode: 'final', onPick };
    // Direct class toggle — hideActionPanel() is guarded while the final
    // choice is pending, and that guard must stay for stray clicks.
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
    if (!game || game.phase !== 'gameplay' || _slidePick) return ok;
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
    if (!game || game.phase !== 'gameplay') return 'The ring slides during gameplay rounds';
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
        ring.classList.toggle('grab', !picking && reach.size > 0);
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
    holder.innerHTML = BOARD_OV_TRACK.lefts.map((L, i) => {
        const steps = Math.abs(i - cur);
        const pickable = picking && steps === 1;
        const reachable = reach.has(i);
        const tip = i === cur
            ? 'Your ring is here'
            : picking
                ? (pickable ? `Slide to ${posNames[i]} \u2014 the discard pays` : 'One space per discard')
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
        ? 'Pick a glowing circle \u2014 the discarded card pays the toll'
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

    // Pick-a-slot mode: the discard pays the toll, one space only.
    if (_slidePick) {
        const step = i - player.sliderPosition;
        if (Math.abs(step) !== 1) return;
        const pick = _slidePick;
        _slidePick = null;
        closeBoardOverlay();
        if (pick.mode === 'hand') discardToSlide(pick.cardIndex, step);
        else pick.onPick(step);
        return;
    }

    if (i === player.sliderPosition) {
        if (_ovSlideTarget !== null) _ovSlideCancel();   // tapping home = never mind
        return;
    }
    if (!game || game.phase !== 'gameplay') {
        showNotification('The ring slides during gameplay rounds', 'error');
        return;
    }
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

// \u2500\u2500 Ring drag \u2014 grab the ring, ride the track, drop it on a circle \u2500\u2500
// Maps finger X to the nearest REACHABLE slot (never past gold or the
// direction lock); release off home shows the same confirm chip as a tap.
let _ovDragging = false;
let _ovDragJustEnded = 0;

function _ovRingDragInit() {
    const ring = document.getElementById('boardOvRing');
    if (!ring || ring._dragWired) return;
    ring._dragWired = true;

    let startX = 0, engaged = false, rect = null;

    const slotAtX = (clientX) => {
        const pct = ((clientX - rect.left) / rect.width) * 100;
        const reach = _ovPaidReach();
        const cur = game.players[0].sliderPosition;
        let best = cur, bestD = Infinity;
        BOARD_OV_TRACK.lefts.forEach((L, i) => {
            if (i !== cur && !reach.has(i)) return;
            const d = Math.abs(L - pct);
            if (d < bestD) { bestD = d; best = i; }
        });
        return best;
    };

    ring.addEventListener('pointerdown', (e) => {
        if (_slidePick || !game || game.phase !== 'gameplay') return;
        if (_ovPaidReach().size === 0) return;
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
        // Follow the finger along the track, clamped to the reachable span.
        const reach = _ovPaidReach();
        const cur = game.players[0].sliderPosition;
        const idxs = [cur, ...reach];
        const minL = Math.min(...idxs.map(i => BOARD_OV_TRACK.lefts[i]));
        const maxL = Math.max(...idxs.map(i => BOARD_OV_TRACK.lefts[i]));
        const pct = Math.min(maxL, Math.max(minL, ((e.clientX - rect.left) / rect.width) * 100));
        ring.style.left = pct + '%';
        // Live halo on the circle it would snap to.
        const snap = slotAtX(e.clientX);
        document.querySelectorAll('#boardOvSlots .board-ov-slot').forEach((el, i) =>
            el.classList.toggle('snap', i === snap && i !== cur));
    });

    const release = (e) => {
        if (!_ovDragging) return;
        _ovDragging = false;
        const wasEngaged = engaged;
        engaged = false;
        ring.classList.remove('dragging');
        document.querySelectorAll('#boardOvSlots .board-ov-slot.snap')
            .forEach(el => el.classList.remove('snap'));
        if (!wasEngaged) { renderBoardOvSlots(); return; }   // a tap, not a drag
        _ovDragJustEnded = Date.now();
        const snap = slotAtX(e.clientX);
        _ovSlideTarget = (snap === game.players[0].sliderPosition) ? null : snap;
        renderBoardOvSlots();   // ring settles on the target (or glides home)
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
        const groups = Math.max(1, new Set(played.map(getCardSkillGroup)).size);
        const avail = window.innerWidth * 0.40 - 4;          // tracks the CSS max-width: 40vw
        const per = (avail - (groups - 1) * 10) / groups;    // 10px stack gap
        const fitH = Math.max(64, Math.min(Math.round(per / 0.666), Math.round(window.innerHeight * 0.28)));
        oppStacks.style.setProperty('--tvStackCardH', fitH + 'px');
    }

    document.getElementById('oppOvStats').innerHTML = statPillsHtml(p);

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
    // the center; on idle, snap it exactly (rAF + short debounce).
    track.onscroll = () => {
        requestAnimationFrame(_mbTrackFocus);
        clearTimeout(_mbScrollT);
        _mbScrollT = setTimeout(() => mbFocus(_mbIndex, true), 130);
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
        track.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
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
            const res = game.completeMissionWithBorrow(0, mi);
            closeMissionLB();
            if (res.success) {
                showNotification(`Mission complete: ${name}! (−${res.cost}g to your neighbor)`, 'mission');
                addLogEntry(`You borrow skills (−${res.cost}g) and complete ${name}`);
            } else {
                showNotification(res.error || 'Borrow fell through', 'error');
            }
            renderGameState();
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
        const res = game.turnInMission(0, mi);
        closeMissionLB();
        if (res.success) {
            showNotification(`Mission complete: ${name}!`, 'mission');
            addLogEntry(`You turn in ${name} — success!`);
        } else {
            showNotification(`Mission failed: ${name}`, 'error');
            addLogEntry(`You turn in ${name} — failed`);
        }
        // Crazy Lou-style penalties: the discard picker fires right away.
        const pend = game.players[0]._pendingPenaltyDiscard || 0;
        if (pend) {
            game.players[0]._pendingPenaltyDiscard = 0;
            showPenaltyDiscardPicker(pend).then(() => renderGameState());
        }
        renderGameState();
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

function selectHandCard(index) {
    if (game.phase !== 'gameplay') return;

    if (typeof coachMarkSeen === 'function') coachMarkSeen('hand');
    selectedHandCard = index;
    renderHand(game.getState(0));
    showActionPanel(index);
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

// ─── ACTION PANEL ──────────────────────────────────────────

function showActionPanel(cardIndex) {
    const panel = document.getElementById('actionPanel');
    const card = game.players[0].hand[cardIndex];
    if (!card) return;

    const { canPlay, missingSkills, missingSpecial = [] } = game.checkRequirements(0, card);
    const isMissionLetter = card.type === 'mission_letter';
    const skills = card.skills || [];
    const typeName = (card.type || 'card').replace(/_/g, ' ');

    // The card itself sits beside the buttons (readable, peek-able) so the
    // decision and the actions live together \u2014 no more covered/cut-off card.
    let html = `<img class="action-card-img" src="assets/cards/regular/${card.filename}"
                     alt="${card.name}" data-peek="assets/cards/regular/${card.filename}">`;
    html += '<div class="action-body"><div class="action-header">';
    html += `<div class="action-card-name">${card.name}</div>`;
    html += `<div class="action-card-type">${typeName.charAt(0).toUpperCase() + typeName.slice(1)}</div>`;
    html += `<div class="action-purse"><img src="${TOKEN_IMG.gold}" alt="Gold"> Your purse: <b>${game.players[0].gold} Gold</b></div>`;

    if (skills.length > 0) {
        html += `<div class="action-skills">${skills.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' \u00B7 ')}</div>`;
    }

    if (card.rewards) {
        const r = [];
        if (card.rewards.gold) r.push(`+${card.rewards.gold} Gold`);
        if (card.rewards.prestige) r.push(`+${card.rewards.prestige} Prestige`);
        if (card.rewards.favor) r.push(`+${card.rewards.favor} Favor`);
        if (r.length) html += `<div class="action-rewards">${r.join(' \u00B7 ')}</div>`;
    }

    html += '</div><div class="action-buttons">';

    if (isMissionLetter) {
        // Mission letters can ONLY be used as mission letters or discarded — no "Play"
        if (game.players[0].gold >= 1 && game.visibleMissions.length > 0) {
            html += `<button class="btn-royal primary action-btn" onclick="playMissionLetter(${cardIndex})"><span>Mission Letter (\u22121g)</span></button>`;
        } else {
            html += `<button class="btn-royal action-btn" disabled style="opacity:0.3;cursor:default"><span>Need 1g for Mission Letter</span></button>`;
        }
    } else {
        // Regular card — Play button
        if (canPlay) {
            html += `<button class="btn-royal primary action-btn" onclick="playSelectedCard(${cardIndex})"><span>\u25B6 Play</span></button>`;
        } else {
            const needed = [...missingSkills, ...missingSpecial];
            html += `<button class="btn-royal action-btn" disabled style="opacity:0.3;cursor:default"><span>\u25B6 Need: ${needed.join(', ')}</span></button>`;

            // Borrow option \u2014 only skill gaps are borrowable; Mind's Eye / Philosopher's
            // Stone / Gold / Favor requirements can never be borrowed (see tutorial).
            if (missingSpecial.length === 0 && missingSkills.length > 0) {
                const borrowable = game.getBorrowableSkills(0);
                const canBorrowAll = missingSkills.every(s => borrowable[s] && borrowable[s].length > 0);
                const borrowCost = missingSkills.length * 2;
                if (canBorrowAll && game.players[0].gold >= borrowCost) {
                    html += `<button class="btn-royal primary action-btn" onclick="playWithBorrow(${cardIndex})"><span>Borrow & Play (\u2212${borrowCost}g)</span></button>`;
                }
            }
        }
    }

    // Discard — always available, offers +3g or slide
    html += `<button class="btn-royal action-btn" onclick="discardSelectedCard(${cardIndex})"><span>\u2715 Discard (+3g)</span></button>`;

    // Discard to slide — ONE button; the board itself opens in pick-a-slot
    // mode and the circles beside the ring take the discard as payment.
    html += `<button class="btn-royal action-btn" onclick="openSlidePicker(${cardIndex})"><span>\u21c4 Discard: Slide Ring</span></button>`;

    html += '</div></div>';

    panel.innerHTML = html;
    panel.classList.add('active');
    setTargetHighlights(card);
    if (typeof coachTick === 'function') coachTick();
}

function hideActionPanel() {
    // The final-card chooser awaits a Promise that ONLY its buttons resolve.
    // Dismissing it (outside click, etc.) would strand that await and freeze
    // the round — so while it's pending the panel refuses to hide.
    if (window._finalChoicePending) return;
    document.getElementById('actionPanel').classList.remove('active');
    selectedHandCard = null;
    clearTargetHighlights();
    if (typeof coachTick === 'function') coachTick();
}

// ─── FINAL CARD CHOICE ─────────────────────────────────────
// With two cards left you pick one and the last card activates too — but
// WHAT it does (play / borrow / mission letter / discard / slide) is still
// the player's call, exactly like any other card. Resolves an action string.
function showFinalCardChoice(card) {
    return new Promise((resolve) => {
        // Mark the chooser as pending BEFORE it renders: hideActionPanel()
        // is a no-op while this is set, so no stray click can strand the await.
        window._finalChoicePending = true;
        const panel = document.getElementById('actionPanel');
        const player = game.players[0];
        const { canPlay, missingSkills, missingSpecial = [] } = game.checkRequirements(0, card);
        const isMissionLetter = card.type === 'mission_letter';

        let html = `<img class="action-card-img" src="assets/cards/regular/${card.filename}"
                         alt="${card.name}" data-peek="assets/cards/regular/${card.filename}">`;
        html += '<div class="action-body"><div class="action-header">';
        html += `<div class="action-card-name">${card.name}</div>`;
        html += `<div class="action-card-type">Your final card — choose its fate</div>`;
        html += `<div class="action-purse"><img src="${TOKEN_IMG.gold}" alt="Gold"> Your purse: <b>${player.gold} Gold</b></div>`;
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
            html += btn('▶ Play', 'play', true);
        } else {
            const needed = [...missingSkills, ...missingSpecial];
            html += `<button class="btn-royal action-btn" disabled style="opacity:0.3;cursor:default"><span>▶ Need: ${needed.join(', ')}</span></button>`;
            if (missingSpecial.length === 0 && missingSkills.length > 0) {
                const borrowable = game.getBorrowableSkills(0);
                const canBorrowAll = missingSkills.every(s => borrowable[s] && borrowable[s].length > 0);
                const borrowCost = missingSkills.length * 2;
                if (canBorrowAll && player.gold >= borrowCost) {
                    html += btn(`Borrow & Play (−${borrowCost}g)`, 'borrow_play', true);
                }
            }
        }
        html += btn('✕ Discard (+3g)', 'discard', false);
        html += btn('⇄ Discard: Slide Ring', 'discard_slide_pick', false);
        html += '</div></div>';

        panel.innerHTML = html;
        panel.classList.add('active');
        setTargetHighlights(card);
        if (typeof coachTick === 'function') coachTick();

        panel.querySelectorAll('[data-act]').forEach(b => {
            b.onclick = () => {
                // Slide is a two-step choice: the board opens in pick-a-slot
                // mode; cancelling lands back here, chooser still up (it
                // never closed — hideActionPanel is guarded while pending).
                if (b.dataset.act === 'discard_slide_pick') {
                    openSlidePickerFinal((direction) => {
                        window._finalChoicePending = false;
                        panel.classList.remove('active');
                        clearTargetHighlights();
                        resolve(direction < 0 ? 'discard_slide_left' : 'discard_slide_right');
                    });
                    return;
                }
                // Borrow is two beats here too: pick the lender first. The
                // panel steps aside directly (the pending guard stays armed
                // against stray clicks); cancel re-surfaces it.
                if (b.dataset.act === 'borrow_play') {
                    panel.classList.remove('active');
                    showBorrowChooser(card).then(chosen => {
                        if (!chosen) { panel.classList.add('active'); return; }
                        window._finalBorrowChoice = chosen;
                        window._finalChoicePending = false;
                        clearTargetHighlights();
                        resolve('borrow_play');
                    });
                    return;
                }
                window._finalChoicePending = false;
                panel.classList.remove('active');
                clearTargetHighlights();
                resolve(b.dataset.act);
            };
        });
    });
}

// Apply the chosen action to the final card through the normal engine paths.
async function resolveFinalCardChoice(card) {
    const act = await showFinalCardChoice(card);
    await showMiniSpotlight(card, act === 'play' || act === 'borrow_play' || act === 'mission_letter' ? 'play' : 'discard');

    if (act === 'play') {
        game.activateCard(0, card.id, 'play');
        addLogEntry(`You also play ${card.name}`);
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
        }
    } else if (act === 'mission_letter') {
        const result = game.activateCard(0, card.id, 'mission_letter');
        if (result && result.chooseMission) {
            renderGameState();
            await showMissionSelectAsync();
        }
    } else if (act === 'discard_slide_left' || act === 'discard_slide_right') {
        game.activateCard(0, card.id, 'discard_slide', act === 'discard_slide_left' ? -1 : 1);
        addLogEntry(`You discard ${card.name} to slide your ring`);
        if (game.players[0]._pendingSlotMission) {
            game.players[0]._pendingSlotMission = false;
            renderGameState();
            await showMissionSelectAsync();
        }
    } else {
        game.activateCard(0, card.id, 'discard');
        addLogEntry(`You discard ${card.name} (+3 Gold)`);
    }
}

// ─── CARD ACTIONS ──────────────────────────────────────────

function playSelectedCard(cardIndex) {
    if (!game || game.phase !== 'gameplay') return;

    const card = game.players[0].hand[cardIndex];
    if (!card) return;

    const { canPlay } = game.checkRequirements(0, card);
    if (!canPlay) {
        showNotification(`Cannot play ${card.name}!`, 'error');
        return;
    }

    game.pickCard(0, cardIndex);
    hideActionPanel();

    const skillText = card.skills && card.skills.length > 0
        ? ` \u2014 ${card.skills.join(', ')}`
        : '';
    showNotification(`Played: ${card.name}${skillText}`, 'play');
    addLogEntry(`You play ${card.name}`);

    processRound('play');
}

function discardSelectedCard(cardIndex) {
    if (!game || game.phase !== 'gameplay') return;

    const card = game.players[0].hand[cardIndex];
    if (!card) return;

    game.pickCard(0, cardIndex);
    hideActionPanel();

    game.players[0]._discardNext = true;

    showNotification(`Discarded: ${card.name} (+3 Gold)`, 'discard');
    addLogEntry(`You discard ${card.name} for 3 Gold`);

    processRound('discard');
}

async function playMissionLetter(cardIndex) {
    if (!game || game.phase !== 'gameplay') return;

    const card = game.players[0].hand[cardIndex];
    if (!card || game.players[0].gold < 1) return;

    game.pickCard(0, cardIndex);
    hideActionPanel();

    addLogEntry('You play a Mission Letter');

    // Immediately activate the mission letter (deducts 1g, discards the card)
    const result = game.activateCard(0, card.id, 'mission_letter');

    // Show mini spotlight for visual feedback
    await showMiniSpotlight(card, 'play');

    if (result && result.chooseMission) {
        // Show mission select immediately and wait for the player's choice
        renderGameState();
        await showMissionSelectAsync();
    }

    // Now continue the round (AI picks, hand passing, activations)
    // pendingActivations[0] is already null since the letter was activated above
    processRound('mission_letter_done');
}

// Borrow & Play is TWO beats: the button first, THEN "from whom?" \u2014 the
// chooser shows both neighbors (one may have nothing to lend; it sits
// grayed with the reason). The 2g-per-skill fee goes TO the lender, so
// who gets paid is the player's call \u2014 never auto-picked.
function playWithBorrow(cardIndex) {
    if (!game || game.phase !== 'gameplay') return;

    const card = game.players[0].hand[cardIndex];
    if (!card) return;

    // Special requirements (Mind's Eye / Philosopher's Stone / Gold / Favor) can't be borrowed
    const { missingSpecial = [] } = game.checkRequirements(0, card);
    if (missingSpecial.length > 0) {
        showNotification(`Cannot borrow for: ${missingSpecial.join(', ')}`, 'error');
        return;
    }

    showBorrowChooser(card).then(chosen => {
        if (!chosen) {
            // Cancelled \u2014 land back on the card. Re-selected a tick later
            // so this click's own outside-click handler can't eat the panel.
            setTimeout(() => selectHandCard(cardIndex), 0);
            return;
        }

        game.pickCard(0, cardIndex);
        hideActionPanel();

        game.players[0]._borrowNext = chosen;   // [{skill, neighborIndex}] \u2014 consumed at activation

        const lenders = [...new Set(chosen.map(b => game.players[b.neighborIndex].name))].join(' & ');
        const borrowCost = chosen.length * 2;
        showNotification(`Borrowing from ${lenders} \u2014 playing ${card.name} (\u2212${borrowCost}g)`, 'play');
        addLogEntry(`You borrow from ${lenders} and play ${card.name}`);

        processRound('borrow_play');
    });
}

function discardToSlide(cardIndex, direction) {
    if (!game || game.phase !== 'gameplay') return;

    const card = game.players[0].hand[cardIndex];
    if (!card) return;

    const player = game.players[0];
    const newPos = player.sliderPosition + direction;
    if (newPos < 0 || newPos > 4) return;

    game.pickCard(0, cardIndex);
    hideActionPanel();

    game.players[0]._discardSlideNext = direction;

    const dirName = direction < 0 ? 'left' : 'right';
    const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
    showNotification(`Discarded ${card.name} \u2014 Slider moves ${dirName} to ${posNames[newPos]}`, 'play');
    addLogEntry(`You discard ${card.name} to slide ${dirName}`);

    processRound('discard_slide');
}

// Pay 5 Gold to move slider (can do anytime during gameplay)
async function payToSlide(direction) {
    if (!game || game.phase !== 'gameplay') return;

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
    } else {
        showNotification(result.error, 'error');
    }
}

// ─── ROUND PROCESSING ─────────────────────────────────────

async function processRound(humanAction) {
    // AI picks
    for (let i = 1; i < game.playerCount; i++) {
        if (game.pendingActivations[i] === null && game.players[i].hand.length > 0) {
            aiPickCard(i);
        }
    }

    // For mission_letter_done, player 0's pending is already null (activated immediately).
    // Check that all OTHER players have picked.
    const allReady = humanAction === 'mission_letter_done'
        ? game.pendingActivations.every((a, i) => i === 0 || a !== null)
        : game.allPlayersPicked();

    if (!allReady) {
        renderGameState();
        return;
    }

    game.passHands();

    const needsMissionSelect = await activateAllCards(humanAction);

    if (needsMissionSelect) {
        renderGameState();
        showMissionSelectUI();
        return;
    }

    finishRound();
}

async function activateAllCards(humanAction) {
    let needsMissionSelect = false;

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
                // Human player — quick mini-spotlight (you already know what you picked)
                if (humanAction === 'discard_slide' && cardIdx === 0 && game.players[0]._discardSlideNext !== undefined) {
                    await showMiniSpotlight(card, 'discard_slide');

                    const direction = game.players[0]._discardSlideNext;
                    game.activateCard(0, card.id, 'discard_slide', direction);
                    game.players[0]._discardSlideNext = undefined;

                    // Magician slot 2: choose_mission triggered by slider move
                    if (game.players[0]._pendingSlotMission) {
                        game.players[0]._pendingSlotMission = false;
                        renderGameState();
                        await showMissionSelectAsync();
                    }
                } else if (humanAction === 'discard' && cardIdx === 0 && game.players[0]._discardNext) {
                    await showMiniSpotlight(card, 'discard');

                    game.activateCard(0, card.id, 'discard');
                    game.players[0]._discardNext = false;
                } else if (humanAction === 'borrow_play' && cardIdx === 0 && game.players[0]._borrowNext) {
                    await showMiniSpotlight(card, 'play');

                    // The lender was CHOSEN in the borrow chooser at pick time;
                    // resolveBorrowPlan re-validates it against the table now.
                    const { borrowFrom, uncovered } = resolveBorrowPlan(card, game.players[0]._borrowNext);
                    if (uncovered) {
                        game.activateCard(0, card.id, 'discard');
                        showNotification(`No one can lend for ${card.name} anymore — discarded (+3g)`, 'error');
                        addLogEntry(`No neighbor could lend for ${card.name} — discarded (+3 Gold)`);
                    } else {
                        game.activateCard(0, card.id, 'play', borrowFrom);
                    }
                    game.players[0]._borrowNext = false;
                } else if (cardIdx > 0 || humanAction === 'mission_letter_done') {
                    // The auto-activated FINAL card: the player still chooses
                    // its fate — play / borrow / letter / discard / slide.
                    // (After a Mission Letter pick the leftover card arrives at
                    // index 0, but it was never explicitly chosen either.)
                    renderGameState();
                    await resolveFinalCardChoice(card);
                } else {
                    // Default: play if possible
                    const isMissionLetter = card.type === 'mission_letter';

                    if (isMissionLetter) {
                        // Mission letters can't be "played" — auto-discard if no choice given
                        await showMiniSpotlight(card, 'discard');
                        game.activateCard(0, card.id, 'discard');
                        addLogEntry(`${card.name} auto-discarded (mission letter)`);
                    } else {
                        const { canPlay } = game.checkRequirements(0, card);
                        if (canPlay) {
                            await showMiniSpotlight(card, 'play');
                            game.activateCard(0, card.id, 'play');
                        } else {
                            await showMiniSpotlight(card, 'discard');
                            game.activateCard(0, card.id, 'discard');
                        }
                    }
                }
            }

            // Chemical Y just resolved for the human: pick which adventure
            // card doubles, before anything else moves.
            if (pi === 0 && game.players[0]._pendingChemYPick) {
                game.players[0]._pendingChemYPick = false;
                renderGameState();
                await showChemYPicker();
            }

            if (pi !== 0) {
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

            // Brief pause between cards from the same player
            if (cardIdx < cards.length - 1) {
                await new Promise(r => setTimeout(r, 300 * window.CINEMATIC_SPEED));
            }
        }
    }

    return needsMissionSelect;
}

function finishRound() {
    const allEmpty = game.players.every(p => p.hand.length === 0);
    if (allEmpty) {
        renderGameState();
        setTimeout(() => endActPhases(), 1000);
    } else {
        game.phase = 'gameplay';
        game.pendingActivations = new Array(game.playerCount).fill(null);
        renderGameState();
    }
}

// ─── MISSION SELECT ────────────────────────────────────────

function showMissionSelectUI() {
    const overlay = document.getElementById('missionSelect');

    let html = '<div class="mission-select-content">';
    html += '<h2 class="select-title" style="font-size: 28px; margin-bottom: 20px;">Choose a Mission</h2>';
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

// AI picks the best available mission (highest favor value)
function aiBestMission(playerIndex) {
    let bestIdx = 0;
    let bestFavor = -1;
    game.visibleMissions.forEach((m, i) => {
        const favor = m.favor || m.successReward?.favor || 0;
        if (favor > bestFavor) {
            bestFavor = favor;
            bestIdx = i;
        }
    });
    return bestIdx;
}

function aiPickCard(playerIndex) {
    const player = game.players[playerIndex];
    if (!player.hand || player.hand.length === 0) return;

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

        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    });

    game.pickCard(playerIndex, bestIndex);
}

// ─── END OF ACT ────────────────────────────────────────────

function endActPhases() {
    const actNum = game.currentAct;

    // MISSIONS PHASE
    game.phase = 'missions';
    renderGameState();
    const missionResults = game.resolveMissions();

    let missionDelay = 500;
    let hasMissionResults = false;

    missionResults.forEach(pr => {
        pr.results.forEach(r => {
            hasMissionResults = true;
            const playerName = pr.playerIndex === 0 ? 'You' : game.players[pr.playerIndex].name;
            if (r.success) {
                setTimeout(() => showNotification(`${playerName} completed: ${r.mission.name}!`, 'mission'), missionDelay);
                addLogEntry(`${playerName} completed mission: ${r.mission.name}`);
            } else {
                setTimeout(() => showNotification(`${playerName} failed: ${r.mission.name}`, 'error'), missionDelay);
                addLogEntry(`${playerName} failed mission: ${r.mission.name}`);
            }
            missionDelay += 600;
        });
    });

    if (!hasMissionResults) {
        addLogEntry('No missions resolved this act');
    }

    // A PROMISE — the player chooses how many played cards to sacrifice
    // (+10 Prestige each) before the Melee begins.
    const promisePending = game.players[0]._pendingPromiseDiscard;
    if (promisePending) game.players[0]._pendingPromiseDiscard = false;

    // MISSION BORROW — due missions short only on borrowable skills were
    // paused by resolveMissions (same pause pattern as the penalty picker).
    // The player decides each one FIRST: a declined mission fails here, so
    // its own "Discard N" penalty joins the picker read below.
    const borrowsPending = (game.players[0]._pendingMissionBorrows || []).slice();
    game.players[0]._pendingMissionBorrows = [];

    // MELEE PHASE
    const meleeStart = hasMissionResults ? missionDelay + 400 : 800;

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
                renderGameState();
            }
        };

        if (meleeResults.length > 0) {
            showMeleeSplash(meleeResults, actNum).then(() => setTimeout(advanceAct, 450));
        } else {
            setTimeout(advanceAct, 2000);
        }
    }, meleeStart);

    const afterBorrows = () => borrowsPending.reduce(
        (chain, m) => chain.then(() => showMissionBorrowChooser(m)), Promise.resolve());
    // PENALTY DISCARD — a failed mission says "Discard N Cards": the player
    // picks which (physical-game agency), not the engine. Read AFTER the
    // borrow choosers so declined missions' penalties are included.
    const afterPenalty = () => {
        const penaltyPending = game.players[0]._pendingPenaltyDiscard || 0;
        game.players[0]._pendingPenaltyDiscard = 0;
        return penaltyPending ? showPenaltyDiscardPicker(penaltyPending) : Promise.resolve();
    };
    const afterPromise = promisePending
        ? () => showPromiseDiscardPicker()
        : () => Promise.resolve();
    afterBorrows().then(afterPenalty).then(afterPromise).then(startMelee);
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
                return `${head}<div class="bw-rows">${seatCards}</div>`;
            }).join('');

            const needTxt = sections.map(([s, u]) => `${cap(s)}${u > 1 ? ' ×' + u : ''}`).join(', ');
            const ready = sections.every(([s]) => choice[s] !== undefined);

            ov.innerHTML = `
                <div class="pp-inner">
                    <div class="pp-title">Borrow &amp; Play</div>
                    <div class="pp-sub"><b>${card.name}</b> needs <b>${needTxt}</b> —
                        ${single ? 'tap the neighbor who lends it' : 'pick a lender for each skill'}.
                        The fee is paid <b>to them</b>${anyLender ? ' · your Merchant slot lets anyone lend' : ''}.</div>
                    ${sectionHtml}
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
function showMissionBorrowChooser(mission) {
    return new Promise((resolve) => {
        const ov = document.getElementById('promisePicker');
        const mi = game.players[0].missions.indexOf(mission);
        const plan = mi >= 0 ? game.missionBorrowPlan(0, mission) : null;
        if (!ov || mi < 0 || !plan) {
            // The window closed between phases — resolve it honestly as the
            // failure it already was at its due date.
            if (mi >= 0) {
                game.failMissionByChoice(0, mi);
                showNotification(`Mission failed: ${mission.name}`, 'error');
                renderGameState();
            }
            resolve();
            return;
        }

        const counts = {};
        plan.borrowFrom.forEach(b => { counts[b.skill] = (counts[b.skill] || 0) + 1; });
        const shortTxt = Object.entries(counts)
            .map(([s, n]) => `${s.charAt(0).toUpperCase() + s.slice(1)}${n > 1 ? ' ×' + n : ''}`)
            .join(', ');
        const lenders = [...new Set(plan.borrowFrom.map(b => game.players[b.neighborIndex].name))].join(' & ');

        ov.innerHTML = `
            <div class="pp-inner">
                <div class="pp-title">Mission Due: ${mission.name}</div>
                <div class="pp-sub">You're short <b>${shortTxt}</b> — ${lenders} can lend it for <b>${plan.cost} Gold</b>.</div>
                <div class="pp-cards"><div class="pp-card" style="cursor:default">
                    <img src="assets/cards/missions/${mission.filename}" alt="${mission.name}"
                         style="width:auto;height:min(42vh,340px)">
                </div></div>
                <div class="pp-actions">
                    <button class="btn-royal primary" id="borrowYes"><span>Borrow & Complete (−${plan.cost}g)</span></button>
                    <button class="btn-royal" id="borrowNo"><span>Let it Fail</span></button>
                </div>
            </div>`;

        ov.querySelector('#borrowYes').onclick = () => {
            const idx = game.players[0].missions.indexOf(mission);
            const res = game.completeMissionWithBorrow(0, idx);
            ov.classList.remove('active');
            if (res.success) {
                showNotification(`Mission complete: ${mission.name}! (−${res.cost}g to your neighbor)`, 'mission');
                addLogEntry(`You borrow skills (−${res.cost}g) and complete ${mission.name}`);
            } else {
                // Plan somehow died under the click — the due date still rules.
                game.failMissionByChoice(0, idx);
                showNotification(`Mission failed: ${mission.name}`, 'error');
                addLogEntry(`You fail ${mission.name}`);
            }
            renderGameState();
            resolve();
        };
        ov.querySelector('#borrowNo').onclick = () => {
            const idx = game.players[0].missions.indexOf(mission);
            game.failMissionByChoice(0, idx);
            ov.classList.remove('active');
            showNotification(`Mission failed: ${mission.name}`, 'error');
            addLogEntry(`You let ${mission.name} fail`);
            renderGameState();
            resolve();
        };
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

// ═══ A PROMISE — choose any number of played cards to sacrifice ═══════
// Faithful to the card: "Discard at least 1 Card, gain 10 Prestige for
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
                    <div class="pp-sub">Sacrifice any of your played cards — <b>+10 Prestige each</b></div>
                    <div class="pp-cards">${cards}</div>
                    <div class="pp-actions">
                        <button class="btn-royal" id="ppKeep"><span>Keep All</span></button>
                        <button class="btn-royal primary" id="ppConfirm">
                            <span>${chosen.size ? `Sacrifice ${chosen.size} — +${chosen.size * 10} Prestige` : 'Sacrifice none'}</span>
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
                if (chosen.size) {
                    const picked = [...chosen].map(i => player.playedCards[i]);
                    const n = game.discardPlayedCards(0, c => picked.includes(c));
                    player.prestige += 10 * n;
                    showNotification(`A Promise: sacrificed ${n} card${n > 1 ? 's' : ''} for +${10 * n} Prestige`, 'melee');
                    addLogEntry(`You sacrifice ${n} card(s) to A Promise: +${10 * n} Prestige`);
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

    // Snapshot BEFORE posting — the deltas below say what THIS game did,
    // measured against where you stood when it began.
    const before = (window.FLB && typeof FLB.snapshot === 'function')
        ? FLB.snapshot() : { rating: 0, stars: 0 };

    // Post YOUR result to the leaderboard the moment scoring resolves —
    // rating points vs the table + best-Favor for today's daily board.
    // Rivals present as people but never post (real players only).
    if (window.FLB) FLB.postGameResult(scores);

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
    const fmtDelta = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0');
    let deltas = '';
    if (window.FLB && place >= 0) {
        const rDelta = FLB.ratingDelta(place, scores.length);
        const newRating = Math.max(0, (before.rating || 0) + rDelta);
        deltas += `<div class="vs-delta rating">
            <span class="vs-d-what">✦ Rating</span><b>${fmtDelta(rDelta)}</b>
            <span class="vs-d-arrow">→</span><b class="vs-d-new" data-total="${newRating}">0</b>
        </div>`;
        if (typeof FLB.gameStars === 'function') {
            const sDelta = FLB.gameStars(place, scores.length);
            const newStars = (before.stars || 0) + sDelta;
            deltas += `<div class="vs-delta stars">
                <span class="vs-d-what">★ Stars</span><b>+${sDelta}</b>
                <span class="vs-d-arrow">→</span><b class="vs-d-new" data-total="${newStars}">0</b>
            </div>`;
        }
    }

    // Placement ladder — color-coded, trophies for the podium, totals roll.
    const rows = scores.map((s, i) => {
        const p = VS_PLACES[i];
        return `<div class="vs-place ${p ? p.cls : 'pn'}${s.playerIndex === 0 ? ' me' : ''}">
            <span class="vs-ord">${VS_ORDINAL[i] || (i + 1) + 'th'}</span>
            ${p ? vsTrophy(p.color) : '<span class="vs-trophy none"></span>'}
            <span class="vs-name">${s.name}</span>
            <b class="vs-total" data-total="${s.finalScore}">0</b>
        </div>`;
    }).join('');

    content.innerHTML = `
        <div class="vs-head${youWon ? ' win' : ''}">
            ${youWon ? '<div class="champ-rays"></div>' : ''}
            <div class="vs-headline">${headline}</div>
            <div class="vs-personal">${personal}</div>
        </div>
        ${deltas ? `<div class="vs-deltas">${deltas}</div>` : ''}
        <div class="vs-places">${rows}</div>
        <div class="scoring-scroll">
            <table class="scoring-table">
                <tr>
                    <th>Heir</th>
                    <th>Mission Favor</th>
                    <th>Card Favor</th>
                    <th>Character Favor</th>
                    <th>Prestige</th>
                    <th>Scorn</th>
                    <th>Total</th>
                    <th>Gold (Tiebreaker)</th>
                </tr>
                ${scores.map((s, i) => `
                    <tr class="vs-${VS_PLACES[i] ? VS_PLACES[i].cls : 'pn'}${i === 0 ? ' winner' : ''}">
                        <td>${s.name}</td>
                        <td>${s.missionFavor}</td>
                        <td>${s.cardFavor}</td>
                        <td>${s.characterFavor}</td>
                        <td>${s.prestige}</td>
                        <td>${s.scorn ? '−' + s.scorn : 0}</td>
                        <td><strong>${s.finalScore}</strong></td>
                        <td>${s.gold}</td>
                    </tr>
                `).join('')}
            </table>
        </div>
        <div class="scoring-actions">
            <button class="btn-royal primary" onclick="location.reload()">
                <span>Play Again</span>
            </button>
        </div>
    `;

    // Roll every total up from 0 (the Melee splash count-up, ease-out).
    content.querySelectorAll('[data-total]').forEach(b => {
        const target = parseInt(b.dataset.total, 10) || 0;
        const dur = 900;
        let t0 = null;
        const tick = (t) => {
            if (t0 === null) t0 = t;
            const k = Math.min(1, (t - t0) / dur);
            b.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
            if (k < 1) requestAnimationFrame(tick);
        };
        setTimeout(() => requestAnimationFrame(tick), 350);
    });
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

const PEEK_TYPE_INFO = {
    endeavor:       ['Endeavor', 'Builds your skills.'],
    weapon:         ['Weapon', 'Power for the Melee.'],
    artifact:       ['Artifact', 'Grants lasting Favor.'],
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
        // Swallow this release's synthetic click so the outside-click
        // handler can't instantly hide the sheet we're about to open.
        _peekSwallowClick = true;
        setTimeout(() => { _peekSwallowClick = false; }, 400);
        const i = parseInt(card.getAttribute('data-hand-i'), 10);
        if (!isNaN(i)) setTimeout(() => selectHandCard(i), 0);
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

// ═══ MELEE — end-of-act coronation cinematic ══════════════════════════
// The reveal itself lives in js/melee.js (self-contained, also drives the
// tools/melee-preview.html harness). Here we just hand it the results and the
// portraits, and await the promise so the act flow waits for the moment.

function showMeleeSplash(results, actNum) {
    const el = document.getElementById('meleeSplash');
    if (!el || !results || !results.length || typeof playMeleeCinematic !== 'function') {
        return Promise.resolve();
    }
    const musicBtn = document.getElementById('musicBtn');
    return playMeleeCinematic(el, results, actNum, {
        speed: window.CINEMATIC_SPEED || 1,
        sound: !(musicBtn && musicBtn.classList.contains('muted')),
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
        // sapFx / cardsFx / herald default on; autoClose uses the built-in fallback
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
