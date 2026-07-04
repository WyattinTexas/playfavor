/**
 * FAVOR — Game State Engine
 * A drafting card game of royal succession for 3-5 players
 * Played over 3 Acts, each with: Gameplay → Missions → Melee
 */

const PHASES = {
    SETUP: 'setup',
    CHARACTER_SELECT: 'character_select',
    GAMEPLAY: 'gameplay',
    ACTIVATE: 'activate',
    MISSIONS: 'missions',
    MELEE: 'melee',
    SCORING: 'scoring',
    GAME_OVER: 'game_over'
};

const SKILLS = ['survival', 'charisma', 'alchemy', 'prospecting', 'knowledge', 'power'];

const MELEE_REWARDS = {
    1: { 1: 5,  2: 3,  3: 1  },
    2: { 1: 15, 2: 5,  3: 3  },
    3: { 1: 30, 2: 15, 3: 5  }
};

const CARDS_PER_HAND = 7;
const STARTING_GOLD = 3;
const SLIDER_MOVE_COST = 5;
const SLIDER_POSITIONS = 5;       // 5 slots (0-4), center = 2
const SLIDER_CENTER = 2;
const BORROW_SKILL_COST = 2;

class FavorGame {
    constructor(playerCount) {
        if (playerCount < 3 || playerCount > 5) {
            throw new Error('Favor requires 3-5 players');
        }

        this.playerCount = playerCount;
        this.currentAct = 0;         // 0 = not started, 1-3
        this.phase = PHASES.SETUP;
        this.emblemHolder = 0;        // Player index with the Emblem
        this.activePlayerIndex = 0;   // Current player acting
        this.turnInAct = 0;           // Which draft turn within the act

        this.players = [];
        this.actDecks = { 1: [], 2: [], 3: [] };
        this.missionDecks = { 1: [], 2: [], 3: [] };
        this.visibleMissions = [];    // 3 face-up missions
        this.discardPile = [];

        this.hands = [];              // Current hands being drafted
        this.pendingActivations = []; // Cards placed face-down awaiting reveal

        this.log = [];
    }

    // ─── SETUP ─────────────────────────────────────────────────

    initPlayers(characterChoices) {
        // characterChoices: array of { characterId, playerName }
        this.players = characterChoices.map((choice, i) => {
            const char = this.getCharacter(choice.characterId);
            return {
                index: i,
                name: choice.playerName,
                character: char,
                sliderPosition: SLIDER_CENTER,  // 0-4, center = 2
                gold: char ? char.startingGold : STARTING_GOLD,
                prestige: 0,
                scorn: 0,
                favor: 0,
                playedCards: [],
                missions: [],
                completedMissions: [],
                failedMissions: [],
                hand: [],
                skills: {},
                claimedSlots: new Set([SLIDER_CENTER])  // center gold/special pre-claimed at start
            };
        });

        // Initialize skill counts from center slot
        this.players.forEach(p => {
            SKILLS.forEach(s => p.skills[s] = 0);
            // Apply skills from center slot (starting position)
            this.applySlotSkills(p);
        });
    }

    getCharacter(id) {
        return window.FAVOR_DATA.characters.find(c => c.id === id);
    }

    loadDecks() {
        const allCards = window.FAVOR_DATA.cards;
        const allMissions = window.FAVOR_DATA.missions;

        // Separate cards by act and shuffle
        for (let act = 1; act <= 3; act++) {
            this.actDecks[act] = this.shuffle(allCards.filter(c => c.act === act));
            this.missionDecks[act] = this.shuffle(allMissions.filter(m => m.act === act));
        }

        // Reveal top 3 Act 1 missions
        this.visibleMissions = this.missionDecks[1].splice(0, 3);
    }

    // ─── ACT FLOW ──────────────────────────────────────────────

    startAct(actNumber) {
        this.currentAct = actNumber;
        this.turnInAct = 0;
        this.addLog(`Act ${actNumber} begins!`);

        // Deal cards to each player from the current act's deck
        // Handle variable deck sizes gracefully
        const deckSize = this.actDecks[actNumber].length;
        const cardsPerPlayer = Math.min(CARDS_PER_HAND, Math.floor(deckSize / this.playerCount));

        if (cardsPerPlayer < 2) {
            this.addLog(`Warning: Not enough cards in Act ${actNumber} deck (${deckSize} cards)`);
        }

        this.hands = [];
        for (let i = 0; i < this.playerCount; i++) {
            const hand = this.actDecks[actNumber].splice(0, cardsPerPlayer);
            this.hands.push(hand);
        }

        // Assign initial hands
        this.players.forEach((p, i) => {
            p.hand = this.hands[i];
        });

        this.phase = PHASES.GAMEPLAY;
        this.pendingActivations = new Array(this.playerCount).fill(null);
    }

    // ─── GAMEPLAY PHASE: DRAFTING ──────────────────────────────

    /**
     * Player picks a card from their hand and places it face-down.
     * When all players have picked, hands rotate left.
     */
    pickCard(playerIndex, cardIndex) {
        const player = this.players[playerIndex];
        const card = player.hand[cardIndex];

        if (!card) throw new Error('Invalid card selection');

        // Place face-down
        this.pendingActivations[playerIndex] = card;
        player.hand.splice(cardIndex, 1);

        // Check if it's the last 2 cards — play both
        if (player.hand.length === 1) {
            // Auto-play the remaining card
            this.pendingActivations[playerIndex] = [this.pendingActivations[playerIndex], player.hand[0]];
            player.hand = [];
        }

        return card;
    }

    allPlayersPicked() {
        return this.pendingActivations.every(a => a !== null);
    }

    /**
     * After all players picked, rotate hands left and begin activation.
     */
    passHands() {
        // Rotate hands to the left (player 0's hand goes to last player)
        const temp = this.players[0].hand;
        for (let i = 0; i < this.playerCount - 1; i++) {
            this.players[i].hand = this.players[i + 1].hand;
        }
        this.players[this.playerCount - 1].hand = temp;

        this.phase = PHASES.ACTIVATE;
        this.activePlayerIndex = this.emblemHolder;
    }

    // ─── GAMEPLAY PHASE: ACTIVATION ────────────────────────────

    /**
     * Get available actions for the current activating player.
     */
    getActivationActions(playerIndex) {
        const pending = this.pendingActivations[playerIndex];
        const cards = Array.isArray(pending) ? pending : [pending];
        const actions = [];

        cards.forEach(card => {
            // Check if player can play the card
            const { canPlay, missingSkills, missingSpecial } = this.checkRequirements(playerIndex, card);

            actions.push({
                card,
                canPlay,
                missingSkills,
                missingSpecial,
                // Mind's Eye / Philosopher's Stone / Gold / Favor gaps can't be borrowed
                canBorrow: !canPlay && missingSpecial.length === 0 && missingSkills.length > 0,
                borrowCost: missingSkills.length * BORROW_SKILL_COST,
                canDiscard: true  // Always allowed — gain 3 gold or move slider
            });
        });

        return actions;
    }

    /**
     * Check if a player meets a card's requirements.
     * - Skill requirements (borrowable) → missingSkills
     * - Mind's Eye / Philosopher's Stone / Gold / Favor (NOT borrowable) → missingSpecial
     * - reqMaps: holding any listed map waives the whole requirement clause ("... OR [X] Map")
     */
    checkRequirements(playerIndex, card) {
        const player = this.players[playerIndex];
        const missing = [];
        const missingSpecial = [];

        // Map waiver: audit clauses read "Req: <skills/gold> OR [Source] Map" —
        // holding the map satisfies the entire clause.
        if (card.reqMaps && card.reqMaps.length > 0) {
            const held = this.getPlayerMaps(playerIndex);
            if (card.reqMaps.some(m => held.includes(m))) {
                return { canPlay: true, missingSkills: [], missingSpecial: [] };
            }
        }

        if (card.requirements && card.requirements.length > 0) {
            // Tally required quantities per entry
            const reqCounts = {};
            card.requirements.forEach(req => {
                reqCounts[req] = (reqCounts[req] || 0) + 1;
            });

            for (const [req, needed] of Object.entries(reqCounts)) {
                if (req === 'minds_eye') {
                    const have = this.getMindsEyeCount(playerIndex);
                    for (let i = 0; i < needed - have; i++) missingSpecial.push("Mind's Eye");
                } else if (req === 'philosopher_stone') {
                    const have = player.philosopherStone || 0;
                    for (let i = 0; i < needed - have; i++) missingSpecial.push("Philosopher's Stone");
                } else {
                    const have = this.getPlayerSkillTotal(playerIndex, req);
                    if (have < needed) {
                        // Add the shortfall to missing array
                        for (let i = 0; i < needed - have; i++) {
                            missing.push(req);
                        }
                    }
                }
            }
        }

        // Gold / Favor floor requirements (having, not spending)
        if (card.reqGold && player.gold < card.reqGold) {
            missingSpecial.push(`${card.reqGold} Gold`);
        }
        if (card.reqFavor && player.favor < card.reqFavor) {
            missingSpecial.push(`${card.reqFavor} Favor`);
        }

        return {
            canPlay: missing.length === 0 && missingSpecial.length === 0,
            missingSkills: missing,
            missingSpecial
        };
    }

    /**
     * Count Mind's Eye sources a player holds (played cards + character slot specials).
     */
    getMindsEyeCount(playerIndex) {
        const player = this.players[playerIndex];
        let count = 0;
        const char = player.character;
        const slot = char && char.slots ? char.slots[player.sliderPosition] : null;
        if (slot && slot.special) {
            if (slot.special === 'minds_eye' || slot.special === 'minds_eye_and_philosopher') count += 1;
            if (slot.special === 'minds_eye_x5') count += 5;
        }
        for (const c of player.playedCards) {
            if (c.special === 'minds_eye' || c.special === 'The Shadow Guide' || c.special === 'minds_eye_and_philosopher') count += 1;
            if (c.special === 'minds_eye_x5') count += 5;
            if (c.special === 'minds_eye_x2_philosopher_stone_x5') count += 2;
        }
        count += player.bonusMindsEye || 0; // mission success rewards
        return count;
    }

    /**
     * Maps a player holds — granted by playing source cards with grantsMap.
     * A map answers to BOTH its names: the destination it leads to (the
     * source card's grantsMap, e.g. "Finding the Lost Corridor") AND the
     * source card it came from (destination audits say "OR Her Lost Father
     * Map"). reqMaps lists source-card names, so both must resolve.
     */
    getPlayerMaps(playerIndex) {
        const player = this.players[playerIndex];
        const held = [];
        const collect = (c) => {
            if (c && c.grantsMap) {
                held.push(c.grantsMap);  // destination name
                held.push(c.name);       // source name (reqMaps convention)
            }
        };
        player.playedCards.forEach(collect);
        // Completed missions grant their maps too (e.g. The Minister's Plan
        // → Facing the River Fiend).
        (player.completedMissions || []).forEach(collect);
        return held;
    }

    /**
     * Get total skill count for a player (from skills tally + played card skills).
     */
    getPlayerSkillTotal(playerIndex, skill) {
        const player = this.players[playerIndex];
        return player.skills[skill] || 0;
    }

    /**
     * Check if a player (or their neighbors) have a skill.
     */
    playerHasSkill(playerIndex, skill) {
        const player = this.players[playerIndex];

        // Check own skills (character + played cards + completed missions)
        if (player.skills[skill] > 0) return true;

        // Check played cards for the skill
        for (const card of player.playedCards) {
            if (card.skills && card.skills.includes(skill)) return true;
        }

        return false;
    }

    /**
     * Get borrowable skills from neighbors.
     */
    getBorrowableSkills(playerIndex) {
        const player = this.players[playerIndex];

        // Merchant's "borrow_any_player" slot: can borrow from ALL players
        const char = player.character;
        const currentSlot = char && char.slots ? char.slots[player.sliderPosition] : null;
        const canBorrowAny = currentSlot && currentSlot.special === 'borrow_any_player';

        let sources;
        if (canBorrowAny) {
            sources = [];
            for (let i = 0; i < this.playerCount; i++) {
                if (i !== playerIndex) sources.push(i);
            }
        } else {
            const leftNeighbor = (playerIndex - 1 + this.playerCount) % this.playerCount;
            const rightNeighbor = (playerIndex + 1) % this.playerCount;
            sources = [leftNeighbor, rightNeighbor];
        }

        const borrowable = {};
        sources.forEach(ni => {
            SKILLS.forEach(skill => {
                // Only skills from played cards can be borrowed (not slider proficiency)
                if (this.playerHasSkillOnCards(ni, skill)) {
                    if (!borrowable[skill]) borrowable[skill] = [];
                    borrowable[skill].push(ni);
                }
            });
        });

        return borrowable;
    }

    playerHasSkillOnCards(playerIndex, skill) {
        const player = this.players[playerIndex];
        for (const card of player.playedCards) {
            if (card.skills && card.skills.includes(skill)) return true;
        }
        // Check character board current slot skills
        if (player.character && player.character.slots) {
            const slot = player.character.slots[player.sliderPosition];
            if (slot && slot.skills && slot.skills[skill]) return true;
        }
        return false;
    }

    /**
     * Activate a card: play it, borrow skills if needed, apply effects.
     */
    activateCard(playerIndex, cardId, action, borrowFrom = []) {
        const player = this.players[playerIndex];

        if (action === 'play') {
            const card = this.findPendingCard(playerIndex, cardId);

            // Enforce requirements at the engine level — borrowed skills cover skill gaps only;
            // Mind's Eye / Philosopher's Stone / Gold / Favor requirements can never be borrowed.
            const req = this.checkRequirements(playerIndex, card);
            if (!req.canPlay) {
                const uncovered = req.missingSkills.slice();
                borrowFrom.forEach(b => {
                    const i = uncovered.indexOf(b.skill);
                    if (i !== -1) uncovered.splice(i, 1);
                });
                if (uncovered.length > 0 || req.missingSpecial.length > 0) {
                    return { success: false, error: 'Requirements not met: ' + [...uncovered, ...req.missingSpecial].join(', ') };
                }
            }

            // Pay borrow costs
            let borrowCost = 0;
            borrowFrom.forEach(b => {
                borrowCost += BORROW_SKILL_COST;
            });
            if (borrowCost > 0) {
                if (player.gold < borrowCost) {
                    return { success: false, error: 'Not enough gold to borrow skills' };
                }
                player.gold -= borrowCost;
                // Pay gold to the neighbors
                borrowFrom.forEach(b => {
                    this.players[b.neighborIndex].gold += BORROW_SKILL_COST;
                });
            }

            // Pay card cost if any — unless a held Map plays it for free
            // (tutorial/rulebook: "A Map lets you play its linked card for free").
            const mapFree = card.reqMaps && card.reqMaps.length > 0 &&
                this.getPlayerMaps(playerIndex).some(m => card.reqMaps.includes(m));
            if (card.cost && card.cost > 0 && !mapFree) {
                if (player.gold < card.cost) {
                    return { success: false, error: 'Not enough gold' };
                }
                player.gold -= card.cost;
            } else if (card.cost && card.cost > 0 && mapFree) {
                this.addLog(`${player.name}'s Map plays ${card.name} for free`);
            }

            // Play the card
            player.playedCards.push(card);
            this.applyCardEffects(playerIndex, card);
            this.removePendingCard(playerIndex, cardId);

            this.addLog(`${player.name} plays ${card.name}`);
            return { success: true };

        } else if (action === 'discard') {
            const card = this.findPendingCard(playerIndex, cardId);
            this.discardPile.push(card);
            this.removePendingCard(playerIndex, cardId);

            // Gain 3 gold OR move slider one space
            // For now default to gold; UI will offer choice
            player.gold += 3;
            this.addLog(`${player.name} discards ${card.name} for 3 gold`);
            return { success: true, discardChoice: true };

        } else if (action === 'discard_slide') {
            const card = this.findPendingCard(playerIndex, cardId);
            const direction = borrowFrom; // direction is passed via borrowFrom param
            this.discardPile.push(card);
            this.removePendingCard(playerIndex, cardId);

            // Move slider instead of gaining gold
            const newPos = player.sliderPosition + direction;
            if (newPos >= 0 && newPos <= (SLIDER_POSITIONS - 1)) {
                player.sliderPosition = newPos;
                this.applySliderAbilities(player);
                const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
                this.addLog(`${player.name} discards ${card.name} to slide to ${posNames[newPos]}`);
            }
            return { success: true };

        } else if (action === 'mission_letter') {
            const card = this.findPendingCard(playerIndex, cardId);
            if (player.gold < 1) {
                return { success: false, error: 'Need 1 gold to play a Mission Letter' };
            }
            player.gold -= 1;
            this.discardPile.push(card);
            this.removePendingCard(playerIndex, cardId);

            // Player must choose from visible missions
            return { success: true, chooseMission: true, availableMissions: this.visibleMissions };
        }
    }

    chooseMission(playerIndex, missionIndex) {
        const player = this.players[playerIndex];
        const mission = this.visibleMissions.splice(missionIndex, 1)[0];
        player.missions.push(mission);

        // Replace with top card from current act's mission deck
        const replacement = this.missionDecks[this.currentAct].shift();
        if (replacement) {
            this.visibleMissions.push(replacement);
        }

        this.addLog(`${player.name} takes mission: ${mission.name}`);
    }

    /**
     * Move slider on character board.
     * Costs 5 gold per space. Must move in one direction per turn.
     */
    moveSlider(playerIndex, direction) {
        const player = this.players[playerIndex];
        const newPos = player.sliderPosition + direction; // -1 left, +1 right

        if (newPos < 0 || newPos > (SLIDER_POSITIONS - 1)) {
            return { success: false, error: 'Cannot move slider further in that direction' };
        }

        if (player.gold < SLIDER_MOVE_COST) {
            return { success: false, error: 'Need 5 gold to move slider' };
        }

        player.gold -= SLIDER_MOVE_COST;
        player.sliderPosition = newPos;

        // Apply new position's one-time bonuses and recalc skills
        this.applySliderAbilities(player);

        const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
        this.addLog(`${player.name} moves slider to ${posNames[newPos]} (slot ${newPos + 1})`);
        return { success: true };
    }

    /**
     * Apply one-time bonuses (gold, specials) from the current slot if not yet claimed.
     * Then recalculate all skills from the current slot + played cards.
     */
    applySliderAbilities(player) {
        const char = player.character;
        if (!char || !char.slots) return;

        const pos = player.sliderPosition;
        const slot = char.slots[pos];
        if (!slot) return;

        // One-time bonuses: only if this slot hasn't been claimed before
        if (!player.claimedSlots) player.claimedSlots = new Set([SLIDER_CENTER]);

        if (!player.claimedSlots.has(pos)) {
            player.claimedSlots.add(pos);

            // One-time gold
            if (slot.gold) {
                player.gold += slot.gold;
                this.addLog(`${player.name} receives ${slot.gold} Gold from slot ${pos + 1}`);
            }

            // One-time scorn
            if (slot.scorn) {
                player.scorn += slot.scorn;
                this.addLog(`${player.name} takes ${slot.scorn} Scorn from slot ${pos + 1}`);
            }

            // One-time special events
            if (slot.special) {
                this.resolveSlotSpecial(player, slot.special, slot);
            }
        }

        // Recalc skills (slot skills + card skills)
        this.applySlotSkills(player);
    }

    /**
     * Set player skills = current slot skills + all card-based skills.
     * Called whenever slider moves or skills need recalculating.
     */
    applySlotSkills(player) {
        const char = player.character;
        if (!char || !char.slots) return;

        // Reset skills to zero
        SKILLS.forEach(s => player.skills[s] = 0);

        // Add skills from current slider slot
        const slot = char.slots[player.sliderPosition];
        if (slot && slot.skills) {
            Object.entries(slot.skills).forEach(([skill, value]) => {
                if (SKILLS.includes(skill)) {
                    player.skills[skill] = (player.skills[skill] || 0) + value;
                }
            });
        }

        // Add ongoing knowledge from slot Mind's Eye specials
        if (slot && slot.special) {
            if (slot.special === 'minds_eye') {
                player.skills.knowledge = (player.skills.knowledge || 0) + 1;
            } else if (slot.special === 'minds_eye_x5') {
                player.skills.knowledge = (player.skills.knowledge || 0) + 5;
            } else if (slot.special === 'minds_eye_and_philosopher') {
                player.skills.knowledge = (player.skills.knowledge || 0) + 1;
            }
        }

        // Re-add skills from all played cards
        player.playedCards.forEach(c => {
            if (c.skills) {
                c.skills.forEach(skill => {
                    if (SKILLS.includes(skill)) {
                        player.skills[skill] = (player.skills[skill] || 0) + 1;
                    }
                });
            }
            // Re-apply card special skill bonuses
            if (c.special === 'minds_eye' || c.special === 'The Shadow Guide') {
                player.skills.knowledge = (player.skills.knowledge || 0) + 1;
            }
            if (c.special === 'knowledge_x5') {
                player.skills.knowledge = (player.skills.knowledge || 0) + 4;
            }
            if (c.special === 'knowledge_x2') {
                player.skills.knowledge = (player.skills.knowledge || 0) + 1;
            }
            if (c.special === 'minds_eye_x2_philosopher_stone_x5') {
                player.skills.knowledge = (player.skills.knowledge || 0) + 2;
            }
            if (c.special === 'charisma_or_prospecting') {
                const charCount = player.skills.charisma || 0;
                const prospCount = player.skills.prospecting || 0;
                const chosen = charCount <= prospCount ? 'charisma' : 'prospecting';
                player.skills[chosen] = (player.skills[chosen] || 0) + 1;
            }
            if (c.special === 'alchemy_or_prospecting') {
                const alchC = player.skills.alchemy || 0;
                const prospC = player.skills.prospecting || 0;
                const chosen = alchC <= prospC ? 'alchemy' : 'prospecting';
                player.skills[chosen] = (player.skills[chosen] || 0) + 1;
            }
        });
    }

    /**
     * Resolve one-time special effects from character board slots.
     */
    resolveSlotSpecial(player, special, slot) {
        switch (special) {
            case 'steal_3_prestige_each':
                for (let i = 0; i < this.playerCount; i++) {
                    if (i !== player.index) {
                        const stolen = Math.min(3, this.players[i].prestige);
                        this.players[i].prestige -= stolen;
                        player.prestige += stolen;
                        this.addLog(`${player.name} steals ${stolen} Prestige from ${this.players[i].name}`);
                    }
                }
                break;

            case 'steal_2_gold_each':
                for (let i = 0; i < this.playerCount; i++) {
                    if (i !== player.index) {
                        const stolen = Math.min(2, this.players[i].gold);
                        this.players[i].gold -= stolen;
                        player.gold += stolen;
                        this.addLog(`${player.name} steals ${stolen} Gold from ${this.players[i].name}`);
                    }
                }
                break;

            case 'give_1_gold_each':
                for (let i = 0; i < this.playerCount; i++) {
                    if (i !== player.index) {
                        this.players[i].gold += 1;
                        player.gold -= 1;
                        this.addLog(`${player.name} gives 1 Gold to ${this.players[i].name}`);
                    }
                }
                break;

            case 'all_others_1_scorn':
                for (let i = 0; i < this.playerCount; i++) {
                    if (i !== player.index) {
                        this.players[i].scorn += 1;
                        this.addLog(`${this.players[i].name} receives 1 Scorn from ${player.name}`);
                    }
                }
                break;

            case 'convert_gold_to_prestige':
                if (player.gold > 0) {
                    const converted = player.gold;
                    player.prestige += converted;
                    player.gold = 0;
                    this.addLog(`${player.name} converts ${converted} Gold into ${converted} Prestige`);
                }
                break;

            case 'philosopher_stone':
                if (!player.philosopherStone) player.philosopherStone = 0;
                player.philosopherStone = Math.max(player.philosopherStone, 1);
                this.addLog(`${player.name} gains Philosopher's Stone (1:1 gold\u2192favor)`);
                break;

            case 'philosopher_stone_x2':
                if (!player.philosopherStone) player.philosopherStone = 0;
                player.philosopherStone = Math.max(player.philosopherStone, 2);
                this.addLog(`${player.name} gains 2\u00D7 Philosopher's Stone (2:1 gold\u2192favor)`);
                break;

            case 'minds_eye':
                // Mind's Eye: ongoing +1 knowledge (handled in applySlotSkills)
                this.addLog(`${player.name} gains Mind's Eye from character board`);
                break;

            case 'minds_eye_x5':
                // 5 Mind's Eyes: ongoing +5 knowledge (handled in applySlotSkills)
                this.addLog(`${player.name} gains 5\u00D7 Mind's Eye from character board`);
                break;

            case 'minds_eye_and_philosopher':
                // Mind's Eye (+1 knowledge ongoing) + Philosopher's Stone (1:1)
                if (!player.philosopherStone) player.philosopherStone = 0;
                player.philosopherStone = Math.max(player.philosopherStone, 1);
                this.addLog(`${player.name} gains Mind's Eye + Philosopher's Stone from character board`);
                break;

            case 'borrow_any_player':
                // Ongoing: while on this slot, can borrow from any player (handled in getBorrowableSkills)
                this.addLog(`${player.name} can now borrow skills from any player`);
                break;

            case 'mission_fail_10_gold':
                // Ongoing: while on this slot, failing a mission grants 10 gold (handled in applyMissionFailure)
                this.addLog(`${player.name}'s slot: failing a mission grants 10 Gold`);
                break;

            case 'choose_mission':
                // One-time: choose a mission from the visible pool (free, no gold cost)
                if (this.visibleMissions.length > 0) {
                    if (player.index === 0) {
                        // Human player: flag for UI to show mission select
                        player._pendingSlotMission = true;
                    } else {
                        // AI: auto-pick best mission
                        let bestIdx = 0;
                        let bestFavor = -1;
                        this.visibleMissions.forEach((m, i) => {
                            const favor = m.favor || (m.successRewards ? m.successRewards.favor : 0) || 0;
                            if (favor > bestFavor) { bestFavor = favor; bestIdx = i; }
                        });
                        this.chooseMission(player.index, bestIdx);
                    }
                    this.addLog(`${player.name} chooses a mission from the pool`);
                }
                break;

            case 'pick_one':
                // Auto-pick: choose the skill the player has least of from options
                if (slot.pickOptions && slot.pickOptions.length > 0) {
                    let bestSkill = slot.pickOptions[0];
                    let bestVal = player.skills[bestSkill] || 0;
                    slot.pickOptions.forEach(s => {
                        const val = player.skills[s] || 0;
                        if (val < bestVal) { bestSkill = s; bestVal = val; }
                    });
                    player.skills[bestSkill] = (player.skills[bestSkill] || 0) + 1;
                    this.addLog(`${player.name} picks ${bestSkill} from board`);
                }
                break;
        }
    }

    applyCardEffects(playerIndex, card) {
        const player = this.players[playerIndex];

        // Add skills from card
        if (card.skills) {
            card.skills.forEach(skill => {
                if (SKILLS.includes(skill)) {
                    player.skills[skill] = (player.skills[skill] || 0) + 1;
                }
            });
        }

        // Apply immediate rewards
        if (card.rewards) {
            if (card.rewards.gold) player.gold += card.rewards.gold;
            if (card.rewards.prestige) player.prestige += card.rewards.prestige;
            if (card.rewards.scorn) player.scorn += card.rewards.scorn;
            if (card.rewards.favor) player.favor += card.rewards.favor;
        }

        // Resolve special ability if present
        if (card.special) {
            this.resolveSpecial(playerIndex, card);
        }

        // Resolve combo bonus if present
        if (card.combo) {
            this.resolveCombo(playerIndex, card);
        }
    }

    // ─── SPECIAL ABILITIES ───────────────────────────────────

    /**
     * Resolve a card's special ability.
     * Called from applyCardEffects when card.special exists.
     */
    resolveSpecial(playerIndex, card) {
        const player = this.players[playerIndex];
        const special = card.special;

        switch (special) {

            // --- Skill choice specials ---

            case 'or_choice':
                // Hermit's Lab: choose between skill sets. Auto-pick first option.
                // Card already grants its listed skills, so no extra action needed.
                this.addLog(`${player.name}'s ${card.name}: chose first skill option`);
                break;

            case 'charisma_or_prospecting':
                // Mining Guild: auto-pick whichever the player has less of
                {
                    const charCount = player.skills.charisma || 0;
                    const prospCount = player.skills.prospecting || 0;
                    const chosen = charCount <= prospCount ? 'charisma' : 'prospecting';
                    player.skills[chosen] = (player.skills[chosen] || 0) + 1;
                    this.addLog(`${player.name}'s ${card.name}: gained ${chosen} (auto-picked lesser)`);
                }
                break;

            case 'alchemy_or_prospecting':
                // Forbidden Lab: auto-pick whichever the player has less of
                {
                    const alchC = player.skills.alchemy || 0;
                    const prospC = player.skills.prospecting || 0;
                    const chosen = alchC <= prospC ? 'alchemy' : 'prospecting';
                    player.skills[chosen] = (player.skills[chosen] || 0) + 1;
                    this.addLog(`${player.name}'s ${card.name}: gained ${chosen} (auto-picked lesser)`);
                }
                break;

            // --- Philosopher's Stone variants (end-of-game gold→favor) ---

            case 'philosopher_stone':
                // 1:1 gold→favor at end of game
                if (!player.philosopherStone) player.philosopherStone = 0;
                player.philosopherStone = Math.max(player.philosopherStone, 1);
                this.addLog(`${player.name} gains Philosopher's Stone (1:1 gold→favor at game end)`);
                break;

            case 'philosopher_stone_x10':
                // Sacred Chest: 10:1 gold→favor at end of game
                if (!player.philosopherStone) player.philosopherStone = 0;
                player.philosopherStone = Math.max(player.philosopherStone, 10);
                this.addLog(`${player.name} gains Sacred Chest (10:1 gold→favor at game end)`);
                // Also check Forgotten Temple combo (works both directions)
                {
                    const hasForgottenTemple = player.playedCards.some(c => c.name === 'Forgotten Temple');
                    if (hasForgottenTemple && !player._sacredChestComboAwarded) {
                        player._sacredChestComboAwarded = true;
                        player.favor += 10;
                        this.addLog(`${player.name}'s Sacred Chest + Forgotten Temple combo: +10 Favor!`);
                    }
                }
                break;

            case 'minds_eye_x2_philosopher_stone_x5':
                // Secret Lab: +2 Knowledge AND philosopher_stone at 5:1
                player.skills.knowledge = (player.skills.knowledge || 0) + 2;
                if (!player.philosopherStone) player.philosopherStone = 0;
                player.philosopherStone = Math.max(player.philosopherStone, 5);
                this.addLog(`${player.name}'s Secret Lab: +2 Knowledge, Philosopher's Stone (5:1)`);
                break;

            // --- Mind's Eye (knowledge bonus) ---

            case 'minds_eye':
            case 'The Shadow Guide':
                // +1 Knowledge bonus
                player.skills.knowledge = (player.skills.knowledge || 0) + 1;
                this.addLog(`${player.name}'s ${card.name}: +1 Knowledge (Mind's Eye)`);
                break;

            // --- Knowledge multipliers ---

            case 'knowledge_x5':
                // Royal Library: grants 5 knowledge total (card already gave 1, add 4 more)
                player.skills.knowledge = (player.skills.knowledge || 0) + 4;
                this.addLog(`${player.name}'s Royal Library: +5 Knowledge total`);
                break;

            case 'knowledge_x2':
                // Family Ring: grants 2 knowledge total (card already gave some, add 1 more)
                player.skills.knowledge = (player.skills.knowledge || 0) + 1;
                this.addLog(`${player.name}'s Family Ring: +2 Knowledge total`);
                break;

            // --- Melee power modifiers (stored as flags, applied in calculatePower) ---

            case 'power_x2':
                // Melee Spectacular: double power for this act's melee
                player.powerX2 = this.currentAct;
                this.addLog(`${player.name}'s Melee Spectacular: Power DOUBLED for Act ${this.currentAct} melee!`);
                break;

            case 'minus_3_power_all_others':
                // Fuzzy Head: each OTHER player loses 3 power for melee
                for (let i = 0; i < this.playerCount; i++) {
                    if (i !== playerIndex) {
                        if (!this.players[i].powerDebuffs) this.players[i].powerDebuffs = [];
                        this.players[i].powerDebuffs.push({ amount: -3, act: this.currentAct, source: card.name });
                        this.addLog(`${this.players[i].name} receives -3 power from ${player.name}'s Fuzzy Head`);
                    }
                }
                break;

            case 'coin_flip_4_power':
                // Liquid Courage: 50% chance to gain 4 power for melee
                {
                    const won = Math.random() < 0.5;
                    if (won) {
                        if (!player.powerBonuses) player.powerBonuses = [];
                        player.powerBonuses.push({ amount: 4, act: this.currentAct, source: card.name });
                        this.addLog(`${player.name}'s Liquid Courage: HEADS! +4 Power for melee`);
                    } else {
                        this.addLog(`${player.name}'s Liquid Courage: TAILS! No bonus`);
                    }
                }
                break;

            case 'king_of_the_sky':
                // Dawnharbinger: +3 power if player has most survival
                {
                    if (!player.powerBonuses) player.powerBonuses = [];
                    player.powerBonuses.push({ amount: 3, act: this.currentAct, source: card.name, conditional: 'most_survival' });
                    this.addLog(`${player.name}'s Dawnharbinger: +3 Power if most Survival at melee`);
                }
                break;

            case 'defend_the_throne':
                // Guardian: negate first power-reduction targeting this player
                player.defendTheThrone = true;
                this.addLog(`${player.name}'s Guardian: will negate first power reduction`);
                break;

            // --- Slider manipulation ---

            case 'move_slider_any':
                // Chemical X: move slider to any position for free, then apply abilities
                // Auto-pick: move to the end with best unclaimed rewards (prefer slot 4/favor)
                {
                    const oldPos = player.sliderPosition;
                    let newPos;
                    if (oldPos <= 2) newPos = 4;  // move toward favor end
                    else newPos = 0;               // if already right, go left
                    player.sliderPosition = newPos;
                    this.applySliderAbilities(player);
                    const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
                    this.addLog(`${player.name}'s Chemical X: moved slider to ${posNames[newPos]} for free`);
                }
                break;

            // --- Favor/economy specials ---

            case 'double_adventure_favor':
                // Chemical Y: double all favor earned from adventure cards played so far
                {
                    let adventureFavor = 0;
                    player.playedCards.forEach(c => {
                        if (c.type === 'adventure' && c.favor) {
                            adventureFavor += c.favor;
                        }
                    });
                    if (adventureFavor > 0) {
                        player.favor += adventureFavor;
                        this.addLog(`${player.name}'s Chemical Y: doubled adventure favor (+${adventureFavor})`);
                    } else {
                        this.addLog(`${player.name}'s Chemical Y: no adventure favor to double`);
                    }
                }
                break;

            case 'scorn_to_prestige':
                // Mind Warper: convert all Scorn into Prestige 1:1
                {
                    const converted = player.scorn;
                    if (converted > 0) {
                        player.prestige += converted;
                        player.scorn = 0;
                        this.addLog(`${player.name}'s Mind Warper: converted ${converted} Scorn → Prestige`);
                    } else {
                        this.addLog(`${player.name}'s Mind Warper: no Scorn to convert`);
                    }
                }
                break;

            case 'gold_to_prestige':
                // Gold Luster: convert all Gold into Prestige 1:1
                {
                    const converted = player.gold;
                    if (converted > 0) {
                        player.prestige += converted;
                        player.gold = 0;
                        this.addLog(`${player.name}'s Gold Luster: converted ${converted} Gold → Prestige`);
                    } else {
                        this.addLog(`${player.name}'s Gold Luster: no Gold to convert`);
                    }
                }
                break;

            case 'others_5_scorn':
                // Chemical Z: all other players gain 5 Scorn
                for (let i = 0; i < this.playerCount; i++) {
                    if (i !== playerIndex) {
                        this.players[i].scorn += 5;
                        this.addLog(`${this.players[i].name} gains 5 Scorn from ${player.name}'s Chemical Z`);
                    }
                }
                break;

            case 'multiply_gold_x2':
                // Duplicating Goo: double current Gold
                {
                    const before = player.gold;
                    player.gold *= 2;
                    this.addLog(`${player.name}'s Duplicating Goo: Gold ${before} → ${player.gold}`);
                }
                break;

            case 'gold_2_per_alchemy_triangle':
                // Marketplace Sales: 2 Gold for each Alchemy you AND both
                // neighbors currently have.
                {
                    const n = this.playerCount;
                    const left = this.players[(playerIndex + n - 1) % n];
                    const right = this.players[(playerIndex + 1) % n];
                    const alch = (player.skills.alchemy || 0)
                        + (left.skills.alchemy || 0) + (right.skills.alchemy || 0);
                    const gained = 2 * alch;
                    player.gold += gained;
                    this.addLog(`${player.name}'s Marketplace Sales: ${alch} Alchemy around the table → +${gained} Gold`);
                }
                break;

            case 'gold_2_per_power_neighbors':
                // Melee Spectacular: 2 Gold for each Power your two
                // neighboring players currently have.
                {
                    const n = this.playerCount;
                    const left = this.players[(playerIndex + n - 1) % n];
                    const right = this.players[(playerIndex + 1) % n];
                    const pow = (left.skills.power || 0) + (right.skills.power || 0);
                    const gained = 2 * pow;
                    player.gold += gained;
                    this.addLog(`${player.name}'s Melee Spectacular: neighbors' ${pow} Power → +${gained} Gold`);
                }
                break;

            case 'remove_mission_requirements':
                // Life Essence: next mission auto-succeeds
                player.removeMissionRequirements = true;
                this.addLog(`${player.name}'s Life Essence: next mission ignores requirements`);
                break;

            case 'remove_13_scorn':
                // Mind Eraser: remove up to 13 Scorn
                {
                    const removed = Math.min(13, player.scorn);
                    player.scorn -= removed;
                    this.addLog(`${player.name}'s Mind Eraser: removed ${removed} Scorn`);
                }
                break;

            case 'discard_opponent_weapon':
                // Archeus: each opponent discards one weapon
                for (let i = 0; i < this.playerCount; i++) {
                    if (i !== playerIndex) {
                        const opponent = this.players[i];
                        const weaponIndex = opponent.playedCards.findIndex(c => c.type === 'weapon');
                        if (weaponIndex !== -1) {
                            const weapon = opponent.playedCards.splice(weaponIndex, 1)[0];
                            this.discardPile.push(weapon);
                            // Recalculate skills after removing the weapon
                            this.recalcPlayerSkillsFromCards(i);
                            this.addLog(`${opponent.name} forced to discard ${weapon.name} by Archeus`);
                        } else {
                            this.addLog(`${opponent.name} has no weapons to discard`);
                        }
                    }
                }
                break;

            case 'trade_route':
                // Market Trade Exchange / Great North Connection: +3 Gold per adventure card played
                {
                    const adventureCount = player.playedCards.filter(c => c.type === 'adventure').length;
                    const bonus = adventureCount * 3;
                    if (bonus > 0) {
                        player.gold += bonus;
                        this.addLog(`${player.name}'s ${card.name}: +${bonus} Gold (${adventureCount} adventure cards × 3)`);
                    } else {
                        this.addLog(`${player.name}'s ${card.name}: no adventure cards played yet`);
                    }
                }
                break;

            case 'sacred_chest':
                // Forgotten Temple + Sacred Chest synergy: +10 Favor if both are played
                {
                    const hasForgottenTemple = player.playedCards.some(c => c.name === 'Forgotten Temple');
                    const hasSacredChest = player.playedCards.some(c => c.name === 'Sacred Chest');
                    if (hasForgottenTemple && hasSacredChest && !player._sacredChestComboAwarded) {
                        player._sacredChestComboAwarded = true;
                        player.favor += 10;
                        this.addLog(`${player.name}'s Forgotten Temple + Sacred Chest combo: +10 Favor!`);
                    }
                }
                break;

            // --- Map cards (need both halves for bonus) ---

            case 'map':
            case 'map_lost_north':
            case 'map_finding_lost_corridor':
                this.resolveMapBonus(playerIndex, card);
                break;

            default:
                this.addLog(`${player.name}'s ${card.name}: unknown special "${special}" (ignored)`);
                break;
        }
    }

    /**
     * Check if both map halves (1/2 and 2/2) are played. If so, grant +15 Favor.
     */
    resolveMapBonus(playerIndex, card) {
        const player = this.players[playerIndex];

        // Look for any card with combo "1/2" and any with combo "2/2" among played cards
        const hasHalf1 = player.playedCards.some(c =>
            c.combo === '1/2' && (c.special === 'map' || c.special === 'map_lost_north' || c.special === 'map_finding_lost_corridor')
        );
        const hasHalf2 = player.playedCards.some(c =>
            c.combo === '2/2' && (c.special === 'map' || c.special === 'map_lost_north' || c.special === 'map_finding_lost_corridor')
        );

        if (hasHalf1 && hasHalf2) {
            // Only grant once — check if we already awarded it
            if (!player.mapBonusAwarded) {
                player.mapBonusAwarded = true;
                player.favor += 15;
                this.addLog(`${player.name} completes the Map! Both halves found: +15 Favor!`);
            }
        }
    }

    /**
     * Resolve combo bonuses. Many cards reference another card by name or by "1/2"/"2/2".
     * If both combo partners are in the player's playedCards, grant a bonus.
     */
    resolveCombo(playerIndex, card) {
        const player = this.players[playerIndex];

        // Skip map combos — handled by resolveMapBonus
        if (card.special === 'map' || card.special === 'map_lost_north' || card.special === 'map_finding_lost_corridor') {
            return;
        }

        // Skip "x2" combo marker on Marketplace Sales — that's not a card reference
        if (card.combo === 'x2') {
            // Marketplace Sales: philosopher_stone already handled, "x2" is flavor
            return;
        }

        // 1/2 + 2/2 weapon combos (Blind Faith + Heaven's Blade, Chemical X + Chemical Y)
        if (card.combo === '1/2' || card.combo === '2/2') {
            const partnerCombo = card.combo === '1/2' ? '2/2' : '1/2';
            // Find partner among played cards that shares the same combo system
            // (same act+type or explicitly linked)
            const partner = player.playedCards.find(c =>
                c.id !== card.id &&
                c.combo === partnerCombo &&
                c.type === card.type
            );
            if (partner && !player[`combo_${Math.min(card.id, partner.id)}_${Math.max(card.id, partner.id)}`]) {
                player[`combo_${Math.min(card.id, partner.id)}_${Math.max(card.id, partner.id)}`] = true;
                player.favor += 5;
                this.addLog(`${player.name} combo! ${card.name} + ${partner.name}: +5 Favor`);
            }
            return;
        }

        // Named combo: card.combo references another card's name
        if (typeof card.combo === 'string') {
            const partner = player.playedCards.find(c => c.name === card.combo && c.id !== card.id);
            if (partner) {
                // Avoid double-awarding: use sorted id pair as key
                const comboKey = `combo_${Math.min(card.id, partner.id)}_${Math.max(card.id, partner.id)}`;
                if (!player[comboKey]) {
                    player[comboKey] = true;
                    player.favor += 5;
                    this.addLog(`${player.name} combo! ${card.name} + ${partner.name}: +5 Favor`);
                }
            }
        }
    }

    /**
     * Recalculate a player's skills from their played cards after a card is removed.
     * Resets card-based skills and re-tallies from playedCards.
     */
    recalcPlayerSkillsFromCards(playerIndex) {
        const player = this.players[playerIndex];
        // Use the unified slot+card recalc
        this.applySlotSkills(player);
    }

    findPendingCard(playerIndex, cardId) {
        const pending = this.pendingActivations[playerIndex];
        if (Array.isArray(pending)) {
            return pending.find(c => c.id === cardId);
        }
        return pending && pending.id === cardId ? pending : null;
    }

    removePendingCard(playerIndex, cardId) {
        const pending = this.pendingActivations[playerIndex];
        if (Array.isArray(pending)) {
            this.pendingActivations[playerIndex] = pending.filter(c => c.id !== cardId);
            if (this.pendingActivations[playerIndex].length === 0) {
                this.pendingActivations[playerIndex] = null;
            }
        } else {
            this.pendingActivations[playerIndex] = null;
        }
    }

    /**
     * Advance to the next player's activation.
     */
    nextActivation() {
        // Move clockwise from emblem holder
        this.activePlayerIndex = (this.activePlayerIndex + 1) % this.playerCount;

        // If we've gone around the table
        if (this.activePlayerIndex === this.emblemHolder) {
            // Check if hands are empty (act is over)
            const allHandsEmpty = this.players.every(p => p.hand.length === 0);
            const allActivated = this.pendingActivations.every(a => a === null);

            if (allHandsEmpty && allActivated) {
                // Move to missions phase
                this.phase = PHASES.MISSIONS;
                return 'missions';
            } else if (allActivated) {
                // Back to drafting — pick up passed hands
                this.phase = PHASES.GAMEPLAY;
                this.turnInAct++;
                this.pendingActivations = new Array(this.playerCount).fill(null);
                return 'draft';
            }
        }

        return 'next_player';
    }

    // ─── MISSIONS PHASE ────────────────────────────────────────

    resolveMissions() {
        const results = [];

        // Start with emblem holder, go clockwise
        let pi = this.emblemHolder;
        for (let i = 0; i < this.playerCount; i++) {
            const player = this.players[pi];
            const playerResults = [];

            player.missions.forEach((mission, mi) => {
                // Check if mission activates this act or earlier
                if (mission.activationRound && mission.activationRound <= this.currentAct) {
                    const { success, details } = this.checkMissionRequirements(pi, mission);

                    if (success) {
                        this.applyMissionRewards(pi, mission);
                        player.completedMissions.push(mission);
                        playerResults.push({ mission, success: true, details });
                    } else {
                        this.applyMissionFailure(pi, mission);
                        player.failedMissions.push(mission);
                        playerResults.push({ mission, success: false, details });
                    }
                }
            });

            // Remove resolved missions from active list
            player.missions = player.missions.filter(m =>
                !m.activationRound || m.activationRound > this.currentAct
            );

            results.push({ playerIndex: pi, results: playerResults });
            pi = (pi + 1) % this.playerCount;
        }

        return results;
    }

    checkMissionRequirements(playerIndex, mission) {
        const player = this.players[playerIndex];

        // Life Essence: next mission auto-succeeds, ignore requirements
        if (player.removeMissionRequirements) {
            player.removeMissionRequirements = false; // Consumed
            this.addLog(`${player.name}'s Life Essence: mission requirements bypassed!`);
            return {
                success: true,
                details: { missing: [], canBorrow: {}, lifeEssenceUsed: true }
            };
        }

        const missing = [];
        let met = true;

        // Quantity-aware requirements: "3 Knowledge" needs knowledge >= 3
        // (the old check only asked "do you have any"). minds_eye and
        // philosopher_stone entries count against those totals.
        const reqCounts = {};
        (mission.requirements || []).forEach(req => { reqCounts[req] = (reqCounts[req] || 0) + 1; });
        Object.entries(reqCounts).forEach(([req, n]) => {
            let have;
            if (req === 'minds_eye') have = this.getMindsEyeCount(playerIndex);
            else if (req === 'philosopher_stone') have = player.philosopherStone || 0;
            else have = player.skills[req] || 0;
            if (have < n) {
                missing.push(n > 1 ? `${req} ×${n}` : req);
                met = false;
            }
        });
        if (mission.reqGold && player.gold < mission.reqGold) {
            missing.push(`${mission.reqGold} Gold`); met = false;
        }
        if (mission.reqFavor && player.favor < mission.reqFavor) {
            missing.push(`${mission.reqFavor} Favor`); met = false;
        }
        // The Shadow Guide: needs 5 Favor for each Mind's Eye you hold.
        if (mission.reqSpecial === 'favor_5_per_minds_eye') {
            const need = 5 * this.getMindsEyeCount(playerIndex);
            if (player.favor < need) { missing.push(`${need} Favor (5 per Mind's Eye)`); met = false; }
        }

        return {
            success: met,
            details: { missing, canBorrow: this.getBorrowableSkills(playerIndex) }
        };
    }

    playerTotalSkill(playerIndex, skill) {
        const player = this.players[playerIndex];
        return (player.skills[skill] || 0) > 0;
    }

    applyMissionRewards(playerIndex, mission) {
        const player = this.players[playerIndex];
        const s = mission.successRewards || {};
        if (s.favor) player.favor += s.favor;
        if (s.prestige) player.prestige += s.prestige;
        if (s.gold) player.gold += s.gold;
        // Skill rewards go straight into the running tally.
        if (s.skills) {
            Object.entries(s.skills).forEach(([sk, n]) => {
                player.skills[sk] = (player.skills[sk] || 0) + n;
            });
        }
        if (s.mindsEye) player.bonusMindsEye = (player.bonusMindsEye || 0) + s.mindsEye;
        if (s.philosopherStone) {
            player.philosopherStone = Math.max(player.philosopherStone || 0, s.philosopherStone);
        }
        if (mission.successSpecial) this.resolveMissionSuccessSpecial(playerIndex, mission);
        this.addLog(`${player.name} completes mission: ${mission.name}`);
    }

    resolveMissionSuccessSpecial(playerIndex, mission) {
        const player = this.players[playerIndex];
        switch (mission.successSpecial) {
            case 'favor_per_charisma_x2': {
                const f = 2 * (player.skills.charisma || 0);
                player.favor += f;
                this.addLog(`${player.name}: +${f} Favor (2 per Charisma)`);
                break;
            }
            case 'favor_per_knowledge_x1': {
                const f = player.skills.knowledge || 0;
                player.favor += f;
                this.addLog(`${player.name}: +${f} Favor (1 per Knowledge)`);
                break;
            }
            case 'philosopher_stone_x2_grant':
                player.philosopherStone = Math.max(player.philosopherStone || 0, 2);
                this.addLog(`${player.name} gains 2 Philosopher's Stones`);
                break;
            case 'scorn_to_prestige_all': {
                const s = player.scorn;
                player.prestige += s;
                player.scorn = 0;
                this.addLog(`${player.name} turns ${s} Scorn into Prestige`);
                break;
            }
            case 'remove_20_scorn':
                player.scorn = Math.max(0, player.scorn - 20);
                this.addLog(`${player.name} removes up to 20 Scorn`);
                break;
            case 'favor_per_philstone_x10': {
                const f = 10 * (player.philosopherStone || 0);
                player.favor += f;
                this.addLog(`${player.name}: +${f} Favor (10 per Philosopher's Stone)`);
                break;
            }
            case 'duplicate_artifact': {
                const arts = player.playedCards.filter(c => c.type === 'artifact');
                const pick = arts[arts.length - 1];
                if (pick) {
                    const copy = { ...pick, id: `${pick.id}_dup${Date.now() % 100000}` };
                    player.playedCards.push(copy);
                    (copy.skills || []).forEach(sk => { player.skills[sk] = (player.skills[sk] || 0) + 1; });
                    this.addLog(`${player.name} duplicates ${pick.name}`);
                }
                break;
            }
            case 'duplicate_potion': {
                const pots = player.playedCards.filter(c => c.type === 'potion');
                const pick = pots[pots.length - 1];
                if (pick) {
                    const copy = { ...pick, id: `${pick.id}_dup${Date.now() % 100000}` };
                    player.playedCards.push(copy);
                    if (copy.special) this.resolveSpecial(playerIndex, copy); // potions fire instantly
                    this.addLog(`${player.name} duplicates ${pick.name} — it fires again!`);
                }
                break;
            }
        }
    }

    // Remove played cards (mission failure effects). Their skill grants come
    // off the running tally so requirements/Melee stay truthful.
    discardPlayedCards(playerIndex, filterFn, limit = Infinity) {
        const player = this.players[playerIndex];
        const removed = [];
        for (let i = player.playedCards.length - 1; i >= 0 && removed.length < limit; i--) {
            if (filterFn(player.playedCards[i])) removed.push(...player.playedCards.splice(i, 1));
        }
        removed.forEach(c => (c.skills || []).forEach(sk => {
            if (player.skills[sk]) player.skills[sk]--;
        }));
        if (removed.length) this.addLog(`${player.name} discards ${removed.map(c => c.name).join(', ')}`);
        return removed.length;
    }

    resolveMissionFailSpecial(playerIndex, mission) {
        const player = this.players[playerIndex];
        const everyoneElse = this.players.filter((_, i) => i !== playerIndex);
        switch (mission.failSpecial) {
            case 'others_gain_5_gold': everyoneElse.forEach(p => p.gold += 5); break;
            case 'others_gain_3_gold': everyoneElse.forEach(p => p.gold += 3); break;
            case 'others_gain_3_prestige': everyoneElse.forEach(p => p.prestige += 3); break;
            case 'others_remove_15_scorn': everyoneElse.forEach(p => p.scorn = Math.max(0, p.scorn - 15)); break;
            case 'all_gain_2_gold': this.players.forEach(p => p.gold += 2); break;
            case 'you_gain_1_gold': player.gold += 1; break;
            case 'gain_20_prestige': player.prestige += 20; break;
            case 'scorn_2_per_charisma': player.scorn += 2 * (player.skills.charisma || 0); break;
            case 'scorn_10_per_knowledge': player.scorn += 10 * (player.skills.knowledge || 0); break;
            case 'prestige_2_per_knowledge': player.prestige += 2 * (player.skills.knowledge || 0); break;
            case 'discard_1_played': this.discardPlayedCards(playerIndex, () => true, 1); break;
            case 'discard_5_played': this.discardPlayedCards(playerIndex, () => true, 5); break;
            case 'discard_1_artifact': this.discardPlayedCards(playerIndex, c => c.type === 'artifact', 1); break;
            case 'discard_weapons_gain_5_prestige': {
                const n = this.discardPlayedCards(playerIndex, c => c.type === 'weapon');
                player.prestige += 5 * n;
                break;
            }
            case 'discard_wisdom_gain_8_gold': {
                const n = this.discardPlayedCards(playerIndex, c => c.type === 'wisdom');
                player.gold += 8 * n;
                break;
            }
            case 'discard_power_gain_15_prestige': {
                const n = this.discardPlayedCards(playerIndex, c => c.type === 'weapon');
                player.prestige += 15 * n;
                break;
            }
            case 'discard_1_gain_10_prestige': {
                const n = this.discardPlayedCards(playerIndex, () => true, 1);
                player.prestige += 10 * n;
                break;
            }
            case 'fortune_teller_50_prestige':
                if (player.playedCards.some(c => c.name === 'Fortune Teller')) {
                    player.prestige += 50;
                    this.addLog(`${player.name}'s Fortune Teller foresaw this: +50 Prestige!`);
                }
                break;
            case 'lose_all_prestige_and_scorn':
                this.addLog(`${player.name} loses all Prestige (${player.prestige}) and Scorn (${player.scorn})`);
                player.prestige = 0;
                player.scorn = 0;
                break;
            case 'all_draw_act3_mission':
                this.players.forEach(p => {
                    const m = (this.missionDecks[3] || []).shift();
                    if (m) { p.missions.push(m); this.addLog(`${p.name} draws an Act 3 mission: ${m.name}`); }
                });
                break;
        }
    }

    applyMissionFailure(playerIndex, mission) {
        const player = this.players[playerIndex];
        if (mission.failurePenalties) {
            if (mission.failurePenalties.scorn) player.scorn += mission.failurePenalties.scorn;
            // Audit "Failure Reward: N Gold" — some failures PAY the loser.
            if (mission.failurePenalties.gold) player.gold += mission.failurePenalties.gold;
            if (mission.failurePenalties.goldLoss) {
                player.gold = Math.max(0, player.gold - mission.failurePenalties.goldLoss);
            }
        }
        if (mission.failSpecial) this.resolveMissionFailSpecial(playerIndex, mission);

        // Fiddler slot 4: gain 10 gold on mission failure while on that slot
        const char = player.character;
        if (char && char.slots) {
            const currentSlot = char.slots[player.sliderPosition];
            if (currentSlot && currentSlot.special === 'mission_fail_10_gold') {
                player.gold += 10;
                this.addLog(`${player.name}'s board bonus: +10 Gold from mission failure`);
            }
        }

        this.addLog(`${player.name} fails mission: ${mission.name}`);
    }

    // ─── MELEE PHASE ───────────────────────────────────────────

    resolveMelee() {
        const act = this.currentAct;
        const rewards = MELEE_REWARDS[act];

        // Calculate each player's total Power
        const powerTotals = this.players.map((p, i) => ({
            playerIndex: i,
            power: this.calculatePower(i),
            name: p.name
        }));

        // Sort by power descending
        powerTotals.sort((a, b) => b.power - a.power);

        // Award prestige based on placement (ties share placement)
        const results = [];
        let placement = 1;
        let i = 0;

        while (i < powerTotals.length) {
            // Find all players tied at this power level
            const tied = [powerTotals[i]];
            while (i + 1 < powerTotals.length && powerTotals[i + 1].power === powerTotals[i].power) {
                i++;
                tied.push(powerTotals[i]);
            }

            // Award prestige for this placement
            const prestReward = rewards[placement] || 0;
            tied.forEach(t => {
                this.players[t.playerIndex].prestige += prestReward;
                results.push({
                    playerIndex: t.playerIndex,
                    name: t.name,
                    power: t.power,
                    placement,
                    prestige: prestReward
                });
            });

            placement += tied.length;
            i++;
        }

        this.addLog(`Act ${act} Melee results: ${results.map(r => `${r.name}: ${r.power} power, ${r.prestige} prestige`).join('; ')}`);

        return results;
    }

    calculatePower(playerIndex) {
        const player = this.players[playerIndex];

        // player.skills.power already includes all power from cards + slider
        // (accumulated by applyCardEffects and applySliderAbilities)
        let power = player.skills.power || 0;

        // Heaven's Blade: +6 Power while you also own Blind Faith.
        if (player.playedCards.some(c => c.special === 'power_6_if_blind_faith') &&
            player.playedCards.some(c => c.name === 'Blind Faith')) {
            power += 6;
        }

        // --- Apply special melee modifiers ---

        // Apply power bonuses (Liquid Courage, King of the Sky)
        if (player.powerBonuses) {
            player.powerBonuses.forEach(bonus => {
                if (bonus.act === this.currentAct) {
                    if (bonus.conditional === 'most_survival') {
                        // King of the Sky: only if this player has most survival
                        const mySurvival = player.skills.survival || 0;
                        let hasMost = true;
                        for (let i = 0; i < this.playerCount; i++) {
                            if (i !== playerIndex && (this.players[i].skills.survival || 0) >= mySurvival) {
                                hasMost = false;
                                break;
                            }
                        }
                        if (hasMost && mySurvival > 0) {
                            power += bonus.amount;
                        }
                    } else {
                        power += bonus.amount;
                    }
                }
            });
        }

        // Apply power debuffs (Fuzzy Head: -3 from other players)
        if (player.powerDebuffs) {
            let totalDebuff = 0;
            player.powerDebuffs.forEach(debuff => {
                if (debuff.act === this.currentAct) {
                    totalDebuff += debuff.amount;
                }
            });

            // Defend the Throne: negate the first power reduction
            if (totalDebuff < 0 && player.defendTheThrone) {
                // Negate the first -3 debuff (absorb one instance)
                totalDebuff = Math.min(0, totalDebuff + 3);
                player.defendTheThrone = false; // Used up
            }

            power += totalDebuff;
        }

        // Power x2 (Melee Spectacular)
        if (player.powerX2 === this.currentAct) {
            power *= 2;
        }

        // Power cannot go below 0
        return Math.max(0, power);
    }

    // ─── ACT TRANSITIONS ───────────────────────────────────────

    endAct() {
        if (this.currentAct < 3) {
            const nextAct = this.currentAct + 1;

            // Clear old missions and load fresh ones for the new act
            // Any unclaimed missions from the previous act are discarded
            this.visibleMissions = [];
            while (this.visibleMissions.length < 3 && this.missionDecks[nextAct].length > 0) {
                this.visibleMissions.push(this.missionDecks[nextAct].shift());
            }
            this.addLog(`New Act ${nextAct} missions revealed`);

            this.startAct(nextAct);
            return 'next_act';
        } else {
            this.phase = PHASES.SCORING;
            return 'scoring';
        }
    }

    // ─── SCORING ───────────────────────────────────────────────

    // Cards whose Favor is computed from game state at scoring time.
    dynamicCardFavor(playerIndex, card) {
        const p = this.players[playerIndex];
        const n = this.playerCount;
        switch (card.special) {
            case 'favor_per_survival_x2':
                return 2 * (p.skills.survival || 0);
            case 'favor_per_quest_x5':
                return 5 * (p.completedMissions || []).length;
            case 'favor_per_sur_cha_pro':
                return (p.skills.survival || 0) + (p.skills.charisma || 0) + (p.skills.prospecting || 0);
            case 'favor_per_wisdom_x8':
                return 8 * p.playedCards.filter(c => c.type === 'wisdom').length;
            case 'favor_per_neighbor_power': {
                const left = this.players[(playerIndex + n - 1) % n];
                const right = this.players[(playerIndex + 1) % n];
                return (left.skills.power || 0) + (right.skills.power || 0);
            }
            default:
                return 0;
        }
    }

    calculateFinalScores() {
        return this.players.map((p, i) => {
            // Favor from completed missions
            let missionFavor = 0;
            p.completedMissions.forEach(m => {
                if (m.favorValue) missionFavor += m.favorValue;
            });

            // Favor from adventure and artifact cards (static + dynamic)
            let cardFavor = 0;
            p.playedCards.forEach(card => {
                if (card.favor) cardFavor += card.favor;
                cardFavor += this.dynamicCardFavor(i, card);
            });

            // Character favor from current slider position
            let characterFavor = p.favor;
            const char = p.character;
            if (char && char.slots && char.slots[p.sliderPosition]) {
                const endSlot = char.slots[p.sliderPosition];
                if (endSlot.favor) characterFavor += endSlot.favor;
            }

            // Philosopher's Stone: convert remaining Gold into Favor
            // Uses the best conversion rate the player has acquired
            let stoneFavor = 0;
            if (p.philosopherStone && p.philosopherStone > 0 && p.gold > 0) {
                stoneFavor = p.gold * p.philosopherStone;
                this.addLog(`${p.name}'s Philosopher's Stone: ${p.gold} Gold × ${p.philosopherStone} = ${stoneFavor} Favor`);
            }

            // Total score
            const totalFavor = missionFavor + cardFavor + characterFavor + stoneFavor;
            const totalPrestige = p.prestige;
            const totalScorn = p.scorn;
            const finalScore = totalFavor + totalPrestige - totalScorn;

            return {
                playerIndex: i,
                name: p.name,
                missionFavor,
                cardFavor,
                characterFavor,
                stoneFavor,
                totalFavor,
                prestige: totalPrestige,
                scorn: totalScorn,
                finalScore,
                gold: p.gold  // Tiebreaker (gold still counts even after stone conversion)
            };
        }).sort((a, b) => {
            if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
            return b.gold - a.gold; // Tiebreaker: most gold
        });
    }

    getWinner() {
        const scores = this.calculateFinalScores();
        this.phase = PHASES.GAME_OVER;
        this.addLog(`${scores[0].name} wins with ${scores[0].finalScore} points!`);
        return scores;
    }

    // ─── UTILITIES ─────────────────────────────────────────────

    shuffle(array) {
        const a = [...array];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    addLog(msg) {
        this.log.push({ time: Date.now(), act: this.currentAct, phase: this.phase, message: msg });
    }

    /**
     * Get the full game state (for rendering / network sync).
     */
    getState(forPlayerIndex = null) {
        return {
            phase: this.phase,
            currentAct: this.currentAct,
            emblemHolder: this.emblemHolder,
            activePlayerIndex: this.activePlayerIndex,
            visibleMissions: this.visibleMissions,
            players: this.players.map((p, i) => ({
                index: i,
                name: p.name,
                character: p.character ? p.character.name : null,
                sliderPosition: p.sliderPosition,
                gold: p.gold,
                prestige: p.prestige,
                scorn: p.scorn,
                favor: p.favor,
                playedCards: p.playedCards,
                missions: p.missions,
                completedMissions: p.completedMissions,
                failedMissions: p.failedMissions,
                handSize: p.hand.length,
                // Only show hand to the owning player
                hand: (forPlayerIndex === i) ? p.hand : null,
                skills: p.skills,
                pendingCard: this.pendingActivations[i] !== null
            })),
            log: this.log.slice(-20)
        };
    }
}

// Export for both browser and Node
if (typeof module !== 'undefined') module.exports = { FavorGame, PHASES, SKILLS, MELEE_REWARDS };
if (typeof window !== 'undefined') window.FavorGame = FavorGame;
