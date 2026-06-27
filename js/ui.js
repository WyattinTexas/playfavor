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
};

// ─── SLOT SPECIAL LABELS (Character Board) ───────────────
const SLOT_SPECIAL_LABELS = {
    "steal_2_prestige_each":       "Steal 2 Prestige",
    "steal_2_gold_each":           "Steal 2 Gold each",
    "give_1_gold_each":            "Give 1 Gold each",
    "all_others_1_scorn":          "Others +1 Scorn",
    "convert_gold_to_prestige":    "Gold \u2192 Prestige",
    "philosopher_stone":           "Philosopher\u2019s Stone",
    "philosopher_stone_x2":        "2\u00D7 Philosopher\u2019s Stone",
    "minds_eye":                   "Mind\u2019s Eye",
    "minds_eye_x3":                "3\u00D7 Mind\u2019s Eye",
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
    html += `<div class="opp-turn-stats">
        <span class="stat-pill gold"><i class="coin-icon">\uD83E\uDE99</i> ${ps.gold}</span>
        <span class="stat-pill prestige">\u2B50 ${ps.prestige}</span>
        <span class="stat-pill favor">${ps.favor || 0} Favor</span>
        <span class="stat-pill scorn">${ps.scorn} Scorn</span>
    </div>`;

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

function showRules() {
    alert('Rules viewer coming soon \u2014 for now, check the physical rulebook!');
}

// ─── CHARACTER SELECT ──────────────────────────────────────

function showCharacterSelect() {
    const screen = document.getElementById('character-select');
    screen.classList.add('active');

    const grid = document.getElementById('characterGrid');
    grid.innerHTML = '';

    if (!window.FAVOR_DATA || !window.FAVOR_DATA.characters) {
        grid.innerHTML = '<p style="color: var(--gold); grid-column: 1/-1; text-align: center;">Loading character data...</p>';
        return;
    }

    window.FAVOR_DATA.characters.forEach(char => {
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
    document.getElementById('confirmBtn').style.display = 'inline-block';
}

function confirmCharacter() {
    if (!selectedCharacter) return;

    const playerCount = parseInt(document.getElementById('playerCountSelect').value);

    game = new FavorGame(playerCount);
    game.loadDecks();

    const allChars = window.FAVOR_DATA.characters.map(c => c.id);
    const available = allChars.filter(id => id !== selectedCharacter);

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
    showNotification('Act 1 Begins \u2014 Choose wisely.', 'act');

    showGameScreen();
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

function renderPhaseBar(state) {
    const bar = document.getElementById('phaseBar');
    bar.innerHTML = `
        <span class="act-tag">Act ${state.currentAct}</span>
        <span class="phase-text">${formatPhase(state.phase)}</span>
    `;
}

// ── Board Thumbnail ──

function renderBoardThumb(state) {
    const el = document.getElementById('boardThumb');
    const char = window.FAVOR_DATA.characters.find(c => c.id === selectedCharacter);
    if (!char) return;

    el.innerHTML = `
        <img src="assets/characters/${char.filename}" alt="${char.name}">
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
    const emblem = state.emblemHolder === 0 ? '<div class="emblem-tag">\uD83D\uDC51 Emblem Holder</div>' : '';
    const sliderPos = gp.sliderPosition;
    const posNames = ['1', '2', '3', '4', '5'];

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

    // Special abilities: Philosopher's Stone & Mind's Eye
    const hasPhilosopher = gp.philosopherStone && gp.philosopherStone > 0;
    const hasMindsEye = (gp.playedCards || []).some(c =>
        c.special === 'minds_eye' || c.special === 'The Shadow Guide' || c.special === 'minds_eye_x2_philosopher_stone_x5'
    );

    if (hasPhilosopher) {
        skillsHtml += `
            <div class="skill-row special-ability">
                <span class="skill-icon">${SKILL_ICONS.philosopher}</span>
                <span class="skill-label">Phil. Stone</span>
                <span class="skill-value has-skill">${gp.philosopherStone}:1</span>
            </div>`;
    }
    if (hasMindsEye) {
        skillsHtml += `
            <div class="skill-row special-ability">
                <span class="skill-icon">${SKILL_ICONS.minds_eye}</span>
                <span class="skill-label">Mind's Eye</span>
                <span class="skill-value has-skill">\u2713</span>
            </div>`;
    }
    skillsHtml += '</div>';

    panel.innerHTML = `
        <div class="act-badge">Act ${state.currentAct}</div>
        ${resourcesHtml}
        ${skillsHtml}
        <div class="ring-indicator">
            Ring: ${[0,1,2,3,4].map(pos => {
                const charData = window.FAVOR_DATA.characters.find(c => c.id === selectedCharacter);
                const tip = charData ? buildSlotLabel(charData.slots[pos]).join(', ') : '';
                return `<span class="ring-dot${pos === sliderPos ? ' ring-active' : ''}" title="${tip}">${posNames[pos]}</span>`;
            }).join('')}
        </div>
        ${emblem}
    `;

    // Position dynamically after board thumb loads
    requestAnimationFrame(() => {
        const thumb = document.getElementById('boardThumb');
        if (thumb && thumb.offsetHeight > 20) {
            panel.style.top = (thumb.offsetTop + thumb.offsetHeight + 6) + 'px';
        }
    });
}

// ── Mission Strip ──

function renderMissionStrip(state) {
    const strip = document.getElementById('missionStrip');
    const missions = game.players[0].missions || [];
    const completedMissions = game.players[0].completedMissions || [];
    const allAcquired = [...missions, ...completedMissions];

    let html = '';

    // Active/Acquired missions section
    if (allAcquired.length > 0) {
        html += '<div class="mission-section">';
        html += '<span class="strip-label">Active Missions</span>';
        html += '<div class="mission-pips">';
        allAcquired.forEach(m => {
            const isComplete = completedMissions.includes(m);
            html += `<img class="mission-pip${isComplete ? ' completed' : ' active'}"
                        src="assets/cards/missions/${m.filename}"
                        alt="${m.name}"
                        onclick="openMissionLB('assets/cards/missions/${m.filename}', '${m.name.replace(/'/g, "\\'")}')">`;
        });
        html += '</div></div>';
    }

    // Available missions from pool
    if (state.visibleMissions && state.visibleMissions.length > 0) {
        html += '<div class="mission-section">';
        html += '<span class="strip-label">Available Missions</span>';
        html += '<div class="mission-pips">';
        state.visibleMissions.forEach(m => {
            html += `<img class="mission-pip available"
                        src="assets/cards/missions/${m.filename}"
                        alt="${m.name}"
                        onclick="openMissionLB('assets/cards/missions/${m.filename}', '${m.name.replace(/'/g, "\\'")}')">`;
        });
        html += '</div></div>';
    }

    if (!html) {
        html = '<span class="strip-label">No Missions</span>';
    }

    strip.innerHTML = html;

    // Position below stats panel
    requestAnimationFrame(() => {
        const statsPanel = document.getElementById('statsPanel');
        if (statsPanel && statsPanel.offsetHeight > 10) {
            strip.style.top = (statsPanel.offsetTop + statsPanel.offsetHeight + 6) + 'px';
        }
    });
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
            html += `<img class="stack-card" src="assets/cards/regular/${card.filename}"
                        alt="${card.name}"
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

    state.players.forEach((p, i) => {
        if (i === 0) return;

        const isActive = state.activePlayerIndex === i;
        const emblem = state.emblemHolder === i ? ' \uD83D\uDC51' : '';
        const char = game.players[i].character;
        const avatarSrc = char ? `assets/characters/${char.filename}` : '';
        const sliderPos = game.players[i].sliderPosition; // 0-4
        const posLabels = ['1', '2', '3', '4', '5'];

        html += `
            <div class="opp-entry${isActive ? ' active-turn' : ''}"
                 onclick="openOppOverlay(${i})">
                <img class="opp-avatar" src="${avatarSrc}">
                <div class="opp-details">
                    <span class="opp-name">${p.name}${emblem}</span>
                    <div class="opp-ring-row">
                        ${[0,1,2,3,4].map(pos => {
                            const tip = char ? buildSlotLabel(char.slots[pos]).join(', ') : '';
                            return `<span class="ring-dot${pos === sliderPos ? ' ring-active' : ''}" title="${tip}">${posLabels[pos]}</span>`;
                        }).join('')}
                    </div>
                    <div class="opp-stats-row">
                        <span class="stat-pill gold"><i class="coin-icon">\uD83E\uDE99</i> ${p.gold}</span>
                        <span class="stat-pill favor">${p.favor || 0}</span>
                        <span class="stat-pill scorn">${p.scorn}</span>
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

// ═══ OVERLAY FUNCTIONS ═══════════════════════════════════════

// ── Board Overlay ──

function openBoardOverlay() {
    const char = window.FAVOR_DATA.characters.find(c => c.id === selectedCharacter);
    if (!char) return;

    document.getElementById('boardOvImg').src = `assets/characters/${char.filename}`;
    document.getElementById('boardOvName').textContent = char.name;

    renderBoardOvSlider();
    renderBoardOvStrip(char.id);

    document.getElementById('boardOverlay').classList.add('active');
}

function closeBoardOverlay() {
    document.getElementById('boardOverlay').classList.remove('active');
}

function renderBoardOvSlider() {
    const player = game.players[0];
    const char = player.character;
    if (!char || !char.slots) return;

    const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
    const canLeft = player.sliderPosition > 0 && player.gold >= 5;
    const canRight = player.sliderPosition < 4 && player.gold >= 5;
    const claimed = player.claimedSlots || new Set([2]);

    let cellsHtml = '';
    for (let i = 0; i < 5; i++) {
        const slot = char.slots[i];
        const isCurrent = i === player.sliderPosition;
        const isClaimed = claimed.has(i) && !isCurrent;
        const stateClass = isCurrent ? 'current' : isClaimed ? 'claimed' : 'unclaimed';
        const labels = buildSlotLabel(slot);

        cellsHtml += `
            <div class="slot-cell ${stateClass}" data-slot="${i}">
                <div class="slot-pos-name">${posNames[i]}</div>
                <div class="slot-rewards">
                    ${labels.map(l => `<div class="slot-reward-line">${l}</div>`).join('')}
                </div>
                ${isClaimed ? '<div class="slot-claimed-check">\u2713</div>' : ''}
            </div>`;
    }

    document.getElementById('boardOvSlider').innerHTML = `
        <button class="slider-btn${canLeft ? '' : ' disabled'}" onclick="payToSlide(-1); renderBoardOvSlider(); renderGameState()">
            \u25C0 <span class="slider-cost">5g</span>
        </button>
        <div class="slot-track">
            ${cellsHtml}
            <div class="slot-ring" style="transform: translateX(${player.sliderPosition * 100}%)"></div>
        </div>
        <button class="slider-btn${canRight ? '' : ' disabled'}" onclick="payToSlide(1); renderBoardOvSlider(); renderGameState()">
            <span class="slider-cost">5g</span> \u25B6
        </button>
    `;
}

function renderBoardOvStrip(activeId) {
    const strip = document.getElementById('boardOvStrip');
    const chars = window.FAVOR_DATA.characters;

    strip.innerHTML = chars.map(c => {
        const isActive = c.id === (activeId || selectedCharacter);
        return `<img class="char-option${isActive ? ' active' : ''}"
                    src="assets/characters/${c.filename}"
                    onclick="switchBoardOv(this, '${c.id}')">`;
    }).join('');
}

function switchBoardOv(el, charId) {
    document.querySelectorAll('.board-ov-strip .char-option').forEach(o => o.classList.remove('active'));
    el.classList.add('active');

    const char = window.FAVOR_DATA.characters.find(c => c.id === charId);
    if (!char) return;

    const img = document.getElementById('boardOvImg');
    img.style.animation = 'none';
    img.offsetHeight;
    img.style.animation = 'ovZoom 0.35s cubic-bezier(0.16,1,0.3,1)';
    img.src = `assets/characters/${char.filename}`;
    document.getElementById('boardOvName').textContent = char.name;
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

    document.getElementById('oppOvAvatar').src = `assets/characters/${char.filename}`;
    document.getElementById('oppOvName').textContent = p.name;
    document.getElementById('oppOvBoard').src = `assets/characters/${char.filename}`;

    document.getElementById('oppOvStats').innerHTML = `
        <span class="stat-pill gold"><i class="coin-icon">\uD83E\uDE99</i> ${p.gold}</span>
        <span class="stat-pill prestige">\u2B50 ${p.prestige}</span>
        <span class="stat-pill favor">${p.favor || 0} Favor</span>
        <span class="stat-pill scorn">${p.scorn} Scorn</span>
    `;

    const cardsEl = document.getElementById('oppOvCards');
    cardsEl.innerHTML = '';
    p.playedCards.forEach(card => {
        const wrap = document.createElement('div');
        wrap.className = 'opp-ov-card-wrap';
        const safeName = card.name.replace(/'/g, "\\'");
        wrap.innerHTML = `
            <img src="assets/cards/regular/${card.filename}" alt="${card.name}">
            <div class="lend-btn" onclick="requestLend(${playerIndex}, '${safeName}')">Lend Skills</div>
        `;
        cardsEl.appendChild(wrap);
    });

    document.getElementById('oppOverlay').classList.add('active');
}

function closeOppOverlay() {
    document.getElementById('oppOverlay').classList.remove('active');
}

function requestLend(oppIndex, cardName) {
    const oppName = game.players[oppIndex].name;
    const toast = document.getElementById('lendToast');
    toast.textContent = `Request sent to ${oppName} — "${cardName}"`;
    toast.classList.add('active');
    setTimeout(() => toast.classList.remove('active'), 2500);
}

// ── Mission Lightbox ──

function openMissionLB(src, name) {
    document.getElementById('missionLBImg').src = src;
    document.getElementById('missionLBLabel').textContent = name;
    document.getElementById('missionLB').classList.add('active');
}

function closeMissionLB() {
    document.getElementById('missionLB').classList.remove('active');
}

// ── ESC closes all overlays ──

function closeAllOverlays() {
    closeBoardOverlay();
    closeHandInspect();
    closeOppOverlay();
    closeMissionLB();
}

function selectHandCard(index) {
    if (game.phase !== 'gameplay') return;

    selectedHandCard = index;
    renderHand(game.getState(0));
    showActionPanel(index);
}

// ─── ACTION PANEL ──────────────────────────────────────────

function showActionPanel(cardIndex) {
    const panel = document.getElementById('actionPanel');
    const card = game.players[0].hand[cardIndex];
    if (!card) return;

    const { canPlay, missingSkills } = game.checkRequirements(0, card);
    const isMissionLetter = card.type === 'mission_letter';
    const skills = card.skills || [];
    const typeName = (card.type || 'card').replace(/_/g, ' ');

    let html = '<div class="action-header">';
    html += `<div class="action-card-name">${card.name}</div>`;
    html += `<div class="action-card-type">${typeName.charAt(0).toUpperCase() + typeName.slice(1)}</div>`;

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
            html += `<button class="btn-royal action-btn" disabled style="opacity:0.3;cursor:default"><span>\u25B6 Need: ${missingSkills.join(', ')}</span></button>`;

            // Borrow option
            const borrowable = game.getBorrowableSkills(0);
            const canBorrowAll = missingSkills.every(s => borrowable[s] && borrowable[s].length > 0);
            const borrowCost = missingSkills.length * 2;
            if (canBorrowAll && game.players[0].gold >= borrowCost) {
                html += `<button class="btn-royal primary action-btn" onclick="playWithBorrow(${cardIndex})"><span>Borrow & Play (\u2212${borrowCost}g)</span></button>`;
            }
        }
    }

    // Discard — always available, offers +3g or slide
    html += `<button class="btn-royal action-btn" onclick="discardSelectedCard(${cardIndex})"><span>\u2715 Discard (+3g)</span></button>`;

    // Discard to slide — only if slider can move
    const player = game.players[0];
    if (player.sliderPosition > 0) {
        html += `<button class="btn-royal action-btn" onclick="discardToSlide(${cardIndex}, -1)"><span>\u2190 Discard to Slide Left</span></button>`;
    }
    if (player.sliderPosition < 4) {
        html += `<button class="btn-royal action-btn" onclick="discardToSlide(${cardIndex}, 1)"><span>Discard to Slide Right \u2192</span></button>`;
    }

    html += '</div>';

    panel.innerHTML = html;
    panel.classList.add('active');
}

function hideActionPanel() {
    document.getElementById('actionPanel').classList.remove('active');
    selectedHandCard = null;
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

function playWithBorrow(cardIndex) {
    if (!game || game.phase !== 'gameplay') return;

    const card = game.players[0].hand[cardIndex];
    if (!card) return;

    game.pickCard(0, cardIndex);
    hideActionPanel();

    game.players[0]._borrowNext = true;

    const { missingSkills } = game.checkRequirements(0, card);
    const borrowCost = missingSkills.length * 2;
    showNotification(`Borrowed skills & played: ${card.name} (\u2212${borrowCost}g)`, 'play');
    addLogEntry(`You borrow skills and play ${card.name}`);

    processRound('borrow_play');
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
        renderBoardOvSlider();

        // Magician slot 2: choose a mission from the pool
        if (player._pendingSlotMission) {
            player._pendingSlotMission = false;
            await showMissionSelectAsync();
            renderGameState();
            renderBoardOvSlider();
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

                    const { missingSkills } = game.checkRequirements(0, card);
                    const borrowable = game.getBorrowableSkills(0);
                    const borrowFrom = missingSkills.map(s => ({
                        skill: s,
                        neighborIndex: borrowable[s][0]
                    }));
                    game.activateCard(0, card.id, 'play', borrowFrom);
                    game.players[0]._borrowNext = false;
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
                            if (cardIdx > 0) {
                                addLogEntry(`You also play ${card.name}`);
                            }
                        } else {
                            await showMiniSpotlight(card, 'discard');
                            game.activateCard(0, card.id, 'discard');
                            if (cardIdx > 0) {
                                addLogEntry(`${card.name} auto-discarded (missing requirements)`);
                            }
                        }
                    }
                }
            } else {
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
                <img src="assets/cards/missions/${m.filename}" alt="${m.name}">
                <div style="font-family: Cinzel, serif; color: var(--gold); margin-top: 8px; font-size: 14px;">${m.name}</div>
            </div>
        `;
    });

    html += '</div></div>';
    overlay.innerHTML = html;
    overlay.classList.add('active');
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

    // MELEE PHASE
    const meleeStart = hasMissionResults ? missionDelay + 400 : 800;

    setTimeout(() => {
        game.phase = 'melee';
        renderGameState();
        const meleeResults = game.resolveMelee();

        if (meleeResults.length > 0) {
            const ordinals = ['1st', '2nd', '3rd', '4th', '5th'];
            addLogEntry(`--- Act ${actNum} Melee ---`);
            meleeResults.forEach(r => {
                addLogEntry(`${ordinals[r.placement - 1] || r.placement + 'th'}: ${r.name} \u2014 Power ${r.power}, +${r.prestige} Prestige`);
            });
            showNotification(`Melee Winner: ${meleeResults[0].name} (Power: ${meleeResults[0].power})`, 'melee');
        }

        // ACT TRANSITION
        setTimeout(() => {
            const result = game.endAct();
            if (result === 'scoring') {
                showScoring();
            } else {
                addLogEntry(`\u2550\u2550\u2550 Act ${game.currentAct} begins \u2550\u2550\u2550`);
                showNotification(`Act ${game.currentAct} Begins!`, 'act');
                renderGameState();
            }
        }, 2000);
    }, meleeStart);
}

// ─── SCORING ───────────────────────────────────────────────

function showScoring() {
    const scores = game.getWinner();

    document.getElementById('game-screen').classList.remove('active');
    document.getElementById('scoring-screen').classList.add('active');

    const content = document.getElementById('scoringContent');
    const winner = scores[0];

    content.innerHTML = `
        <h2 style="font-family: 'Cinzel', serif; color: var(--gold); font-size: 28px; margin: 20px 0;">
            ${winner.name} Claims the Throne!
        </h2>
        <p style="color: var(--text-light); opacity: 0.7; margin-bottom: 20px;">
            Final Score: ${winner.finalScore} points
        </p>
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
                <tr class="${i === 0 ? 'winner' : ''}">
                    <td>${s.name}</td>
                    <td>${s.missionFavor}</td>
                    <td>${s.cardFavor}</td>
                    <td>${s.characterFavor}</td>
                    <td>${s.prestige}</td>
                    <td>-${s.scorn}</td>
                    <td><strong>${s.finalScore}</strong></td>
                    <td>${s.gold}</td>
                </tr>
            `).join('')}
        </table>
        <div style="margin-top: 40px;">
            <button class="btn-royal primary" onclick="location.reload()">
                <span>Play Again</span>
            </button>
        </div>
    `;
}

// ─── PLAYER STATS (renderStats alias for backward compat) ──

function renderStats(state) {
    renderStatsPanel(state);
    renderBottomStats(state);
}

// ─── CARD ZOOM ─────────────────────────────────────────────

function zoomCard(src) {
    document.getElementById('zoomImg').src = src;
    document.getElementById('cardZoom').classList.add('active');
}

function closeZoom() {
    document.getElementById('cardZoom').classList.remove('active');
}

// Close action panel on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.hand-card') && !e.target.closest('.action-panel')) {
        hideActionPanel();
    }
});

// ESC closes all game overlays
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeAllOverlays();
        closeZoom();
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
