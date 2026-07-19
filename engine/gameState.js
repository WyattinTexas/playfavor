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

// Flex ("OR") cards grant one of two skills, chosen per check. A neighbour
// holding one can lend EITHER skill (the borrower pays for the one they need).
const FLEX_SKILL_PAIRS = {
    charisma_or_prospecting: ['charisma', 'prospecting'],
    alchemy_or_prospecting: ['alchemy', 'prospecting'],
    alchemy_or_survival: ['alchemy', 'survival'],
};

const MELEE_REWARDS = {
    1: { 1: 5,  2: 3,  3: 1  },
    2: { 1: 15, 2: 5,  3: 3  },
    3: { 1: 30, 2: 15, 3: 5  }
};

const CARDS_PER_HAND = 7;
// A Promise pays this much Prestige per sacrificed card. The number lives in one
// place because it is awarded from FOUR call sites (engine AI path + the human's
// picker + the remote-player path in ui.js) — it used to be a hardcoded 10 in
// each, and the printed card actually reads 8.
const PROMISE_PRESTIGE = 8;
const STARTING_GOLD = 3;
const SLIDER_MOVE_COST = 5;
const SLIDER_POSITIONS = 5;       // 5 slots (0-4), center = 2
const SLIDER_CENTER = 2;
const BORROW_SKILL_COST = 2;

// Slot events that recharge ONCE PER ACT rather than firing on every landing.
// Everything else on a character board re-fires freely (see applySliderAbilities).
// These three are the only ones a free discard-slide could farm: repeatable
// score theft, a mission per landing, and a permanent skill per landing.
const SLOT_EVENTS_ONCE_PER_ACT = new Set([
    'steal_3_prestige_each',   // Bandit slot 1 — prestige IS score; 3 × every rival, repeatable
    'choose_mission',          // Magician slot 2 — a mission is worth up to 30 Favor
    'pick_one'                 // Magician slot 4 — a permanent skill, every landing
]);

class FavorGame {
    constructor(playerCount) {
        if (playerCount < 3 || playerCount > 5) {
            throw new Error('Favor requires 3-5 players');
        }

        this.playerCount = playerCount;
        this.currentAct = 0;         // 0 = not started, 1-3
        this.phase = PHASES.SETUP;
        this._rand = Math.random;    // seedable — see setSeed()
        this.emblemHolder = 0;        // Player index with the Emblem (rated start seats it; act boundaries pass it +1)
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
                // favor is DERIVED from favorLog — see awardFavor. Never
                // write it directly.
                favor: 0,
                favorLog: [],
                playedCards: [],
                missions: [],
                completedMissions: [],
                failedMissions: [],
                hand: [],
                skills: {},
                // Slot events that recharge per act (SLOT_EVENTS_ONCE_PER_ACT).
                // Coins re-fire on every landing, so nothing tracks them.
                // You START on center rather than LANDING on it — initPlayers
                // calls applySlotSkills, never applySliderAbilities, so the
                // center coin correctly doesn't pay out at setup.
                _actSlotEvents: new Set()
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

    /**
     * Seat the Emblem before Act 1 (rated start — the UI decides WHO from
     * the leaderboard; the engine only records the seat). Anything outside
     * the table clamps to seat 0, the classic default.
     */
    setEmblemHolder(idx) {
        this.emblemHolder =
            (Number.isInteger(idx) && idx >= 0 && idx < this.playerCount) ? idx : 0;
    }

    /**
     * Seed every random the engine consumes (deck shuffles, Liquid
     * Courage's coin) with mulberry32 — multiplayer lockstep needs every
     * client to deal the same cards and flip the same coins. Call BEFORE
     * loadDecks. Solo games never call this and keep Math.random.
     */
    setSeed(seed) {
        let s = (seed >>> 0) || 1;
        this._rand = () => {
            s |= 0; s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /**
     * Multiplayer deal alignment: every client rotates the shared roster
     * so ITS human sits at local seat 0, which means "local seat i" names
     * a DIFFERENT canonical player on every client. Deck chunk k must
     * always land with CANONICAL seat k or the clients deal different
     * hands from identical decks. The offset is the client's canonical
     * seat: local player i holds canonical seat (i + offset) % n, so it
     * takes chunk (i + offset) % n. Solo games leave it 0.
     */
    setDealOffset(k) {
        this._dealOffset = Number.isInteger(k) ? ((k % this.playerCount) + this.playerCount) % this.playerCount : 0;
    }

    startAct(actNumber) {
        this.currentAct = actNumber;
        this.turnInAct = 0;

        // Act boundary: the Emblem passes one seat clockwise — the same +1
        // circle activation order and borrow neighbors already walk.
        // Activation and mission order derive from emblemHolder, so the
        // whole table shifts with it for free.
        if (actNumber > 1) {
            this.emblemHolder = (this.emblemHolder + 1) % this.playerCount;
            const holder = this.players[this.emblemHolder];
            if (holder) this.addLog(`The Emblem passes to ${holder.name}`);
        }

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

        // Assign initial hands — a fresh act is a fresh turn for the
        // paid-slide direction lock too. The deal offset keeps chunk k
        // with canonical seat k across rotated multiplayer clients.
        this.players.forEach((p, i) => {
            p.hand = this.hands[(i + (this._dealOffset || 0)) % this.playerCount];
            p._paidSlideDir = null;
            // New act — the farmable slot events (steal-prestige / choose-mission
            // / pick-one) recharge. Coins never needed tracking; they always pay.
            p._actSlotEvents = new Set();
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

        // Where the throw came from — unpickCard() rebuilds the hand
        // byte-identical if the player takes the card back.
        player._thrownRestore = { cardIndex, paired: false };

        // Place face-down
        this.pendingActivations[playerIndex] = card;
        player.hand.splice(cardIndex, 1);

        // Check if it's the last 2 cards — play both
        if (player.hand.length === 1) {
            // Auto-play the remaining card
            this.pendingActivations[playerIndex] = [this.pendingActivations[playerIndex], player.hand[0]];
            player.hand = [];
            player._thrownRestore.paired = true;
        }

        return card;
    }

    /**
     * Take a thrown card back — physical rule: any player may retrieve
     * their face-down card until EVERY player has thrown. The moment the
     * last card goes in, everything locks; the UI enforces that moment,
     * and the engine refuses once hands have passed (phase left GAMEPLAY).
     */
    unpickCard(playerIndex) {
        if (this.phase !== PHASES.GAMEPLAY) {
            return { success: false, error: 'Cards are locked in' };
        }
        const player = this.players[playerIndex];
        const pending = this.pendingActivations[playerIndex];
        if (!pending) return { success: false, error: 'Nothing thrown' };

        const restore = player._thrownRestore || { cardIndex: player.hand.length, paired: false };
        if (Array.isArray(pending)) {
            // The auto-paired final two came out of a 2-card hand —
            // rebuild it in its original order.
            const [picked, leftover] = pending;
            player.hand = restore.cardIndex === 0 ? [picked, leftover] : [leftover, picked];
        } else {
            const at = Math.min(restore.cardIndex, player.hand.length);
            player.hand.splice(at, 0, pending);
        }
        player._thrownRestore = null;
        this.pendingActivations[playerIndex] = null;
        return { success: true };
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

        // New turn — the paid-slide direction lock releases.
        this.players.forEach(p => { p._paidSlideDir = null; });

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
    // ─── THE FAVOR LEDGER ──────────────────────────────────────
    /**
     * Every Favor payment, itemized at the moment it is paid.
     *
     * player.favor used to be an opaque scalar: card combos, map bonuses,
     * mission rewards and mission success specials all added into the same
     * bucket, and calculateFinalScores had nowhere to put that bucket but the
     * Character row. So Trust of the Elders — favorValue 0, "1 Favor for each
     * Knowledge you have" — paid +6 into a row captioned "Your standing on the
     * character board", while the Missions panel, which only ever read
     * m.favorValue, said "No missions completed for Favor" (Wyatt 7/19). The
     * number was real. The attribution was fiction.
     *
     * Now NOTHING writes player.favor directly. Every payment goes through
     * awardFavor, which records what paid it, what it was for and when. The
     * score sheet reads the ledger, so every cell reconstructs down to the
     * line item.
     *
     * player.favor stays the authoritative total and the log itemizes it —
     * rather than the total being re-derived FROM the log, which would mean a
     * stray `player.favor = n` silently evaporating on the next payment. Any
     * part of the total the log can't explain surfaces on the character board
     * instead of vanishing (see calculateFinalScores). That also makes the
     * pre-ledger solo save a non-event: its total simply arrives unexplained.
     *
     * src: 'mission' → the Missions row · 'card' → the row for that card's
     * family · 'character' → the character board. Plain arrays of plain
     * objects, so the log survives the solo-save JSON round-trip and the
     * multiplayer stream untouched.
     */
    awardFavor(playerIndex, amount, src, label, extra = {}) {
        const player = this.players[playerIndex];
        // A zero payment is not a line item — "Golden Fiddle: +0" on a table
        // with no Charisma is noise, and the mission still shows as completed.
        if (!amount) return 0;
        if (!player.favorLog) player.favorLog = [];
        player.favorLog.push({ amount, src, label, act: this.currentAct, ...extra });
        player.favor = (player.favor || 0) + amount;
        return amount;
    }

    /** Ledger favor for one source ('mission' | 'card' | 'character'). */
    favorFromLog(playerIndex, src, filter) {
        return (this.players[playerIndex].favorLog || [])
            .filter(e => e.src === src && (!filter || filter(e)))
            .reduce((n, e) => n + e.amount, 0);
    }

    /**
     * The Favor a player HOLDS right now — the threshold "Req: N Favor" cards
     * and missions read against. player.favor is only the ledger total; card
     * favor and mission favor are summed SEPARATELY at scoring, so a check
     * against player.favor alone never saw the 7 Favor from a played "Forming
     * a Bond" and made Favor-cost cards impossible (Wyatt 7/17). Held favor =
     * ledger + played-card favor + completed-mission favor + the slot bonus.
     *
     * Derived from current board state on every call, never incrementally
     * patched: play a Favor-bearing card and it rises the same frame; lose
     * that card to a discard, a steal or Archeus and it falls by exactly the
     * same amount, because the card is simply no longer in playedCards.
     */
    currentFavor(playerIndex) {
        const p = this.players[playerIndex];
        let f = p.favor || 0;
        (p.playedCards || []).forEach(card => {
            f += (card.favor ? card.favor * (card._favorDoubled ? 2 : 1) : 0)
               + this.dynamicCardFavor(playerIndex, card);
        });
        (p.completedMissions || []).forEach(m => { if (m.favorValue) f += m.favorValue; });
        const char = p.character;
        const slot = char && char.slots ? char.slots[p.sliderPosition] : null;
        if (slot && slot.favor) f += slot.favor;
        return f;
    }

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

            // Skill requirements resolve together so flex units (Mining
            // Guild etc.) can be assigned wherever they're short.
            const skillReqs = {};
            for (const [req, needed] of Object.entries(reqCounts)) {
                if (req === 'minds_eye') {
                    const have = this.getMindsEyeCount(playerIndex);
                    for (let i = 0; i < needed - have; i++) missingSpecial.push("Mind's Eye");
                } else if (req === 'philosopher_stone') {
                    const have = player.philosopherStone || 0;
                    for (let i = 0; i < needed - have; i++) missingSpecial.push("Philosopher's Stone");
                } else {
                    skillReqs[req] = needed;
                }
            }
            const unmet = this.unmetSkillReqs(playerIndex, skillReqs);
            Object.entries(unmet).forEach(([req, short]) => {
                for (let i = 0; i < short; i++) missing.push(req);
            });
        }

        // Gold / Favor floor requirements (having, not spending)
        if (card.reqGold && player.gold < card.reqGold) {
            missingSpecial.push(`${card.reqGold} Gold`);
        }
        if (card.reqFavor && this.currentFavor(playerIndex) < card.reqFavor) {
            missingSpecial.push(`${card.reqFavor} Favor`);
        }

        // The card's gold COST (spending, not a floor). activateCard has always
        // refused an unaffordable play — but canPlay never knew, so the UI lit
        // the Play button, the engine bailed with success:false (which no call
        // site checked), and the card evaporated: never played, never discarded,
        // no refund. 45 of 105 cards carry a cost; Wyatt met it as "Mind Warper
        // didn't turn my Scorn into Prestige". A map that plays the card free
        // short-circuits at the top, so this never fires on a map-waived play.
        if (card.cost && card.cost > 0 && player.gold < card.cost) {
            missingSpecial.push(`${card.cost} Gold`);
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
            if (c.special === 'minds_eye_x2') count += 2;
            if (c.special === 'minds_eye_x3') count += 3;
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
            // A flex card (Hermit's Lab / Mining Guild / Forbidden Lab) can
            // lend EITHER of its two skills — the borrower buys the one they
            // need, so it counts as a source for that skill (Wyatt 7/17:
            // couldn't borrow Prospecting/Alchemy off a neighbor's OR card).
            const pair = FLEX_SKILL_PAIRS[card.special];
            if (pair && pair.includes(skill)) return true;
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

            // A plain card (no special) never triggers a slot recalc, so the
            // achievement sampler has to fire here too — otherwise Potions are
            // never counted and peak Gold misses a card that paid out.
            this.sampleSeatStats(player);

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

            // One direction per turn — a discard-slide shares the lock with the
            // paid slide (Wyatt 7/17: paying right then discard-sliding left in
            // the same turn was possible and is not allowed). The card is still
            // discarded either way; the ring only moves if the direction is free.
            const newPos = player.sliderPosition + direction;
            const dirClash = player._paidSlideDir && direction !== player._paidSlideDir;
            if (!dirClash && newPos >= 0 && newPos <= (SLIDER_POSITIONS - 1)) {
                player.sliderPosition = newPos;
                player._paidSlideDir = direction;   // locks the turn's slide direction
                this.applySliderAbilities(player);
                const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
                this.addLog(`${player.name} discards ${card.name} to slide to ${posNames[newPos]}`);
            } else if (dirClash) {
                this.addLog(`${player.name} discards ${card.name} — ring held (already slid ${player._paidSlideDir < 0 ? 'left' : 'right'} this turn)`);
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

        // One direction per turn: the first paid slide of the turn locks the
        // direction until hands next pass (or a new act deals). Discard-slides
        // are a different mechanic and stay free of this lock.
        if (player._paidSlideDir && direction !== player._paidSlideDir) {
            const dirName = player._paidSlideDir < 0 ? 'left' : 'right';
            return { success: false, error: `One direction per turn — you already slid ${dirName} this turn` };
        }

        player.gold -= SLIDER_MOVE_COST;
        player.sliderPosition = newPos;
        player._paidSlideDir = direction;

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

        // DIGITAL RULE (Wyatt's call, 2026-07-13) — a deliberate divergence from
        // the printed rulebook p.10 ("Gold Coins & Events ... are only activated
        // once"). A slot now pays out EVERY time you land on it. The old
        // per-game `claimedSlots` gate is exactly why paying 5 Gold to slide
        // onto a coin you'd taken earlier did nothing, with nothing said.
        //
        // COINS always re-fire. The 5g toll plus one-direction-per-turn keeps
        // even the Duchess's 12g slot at roughly +1 gold/turn — not a pump worth
        // playing. Scorn slots re-fire for the same reason (the Bandit's steal
        // slots each carry 5 Scorn, which is what balances them).
        if (slot.gold) {
            player.gold += slot.gold;
            this.addLog(`${player.name} receives ${slot.gold} Gold from slot ${pos + 1}`);
        }
        if (slot.scorn) {
            player.scorn += slot.scorn;
            this.addLog(`${player.name} takes ${slot.scorn} Scorn from slot ${pos + 1}`);
        }

        // EVENTS re-fire too, except the three a free discard-slide could farm
        // (SLOT_EVENTS_ONCE_PER_ACT) — those recharge once per act. The other 11
        // events are already safe to repeat: the Mind's Eye / Philosopher's Stone
        // grants are Math.max no-ops, borrow_any_player and mission_fail_10_gold
        // are ongoing positional abilities resolved elsewhere, and the steal /
        // give / convert events are bounded by gold that actually has to exist.
        if (slot.special) {
            if (SLOT_EVENTS_ONCE_PER_ACT.has(slot.special)) {
                if (!player._actSlotEvents) player._actSlotEvents = new Set();
                if (player._actSlotEvents.has(slot.special)) {
                    this.addLog(`${player.name}: slot ${pos + 1}'s event already used this act`);
                } else {
                    player._actSlotEvents.add(slot.special);
                    this.resolveSlotSpecial(player, slot.special, slot);
                }
            } else {
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
    /**
     * Chemical X's free move: put the ring on ANY slot, no toll. The slot then
     * pays out exactly as if you'd slid there (coin + event), because you landed
     * on it. THE single mutation point — the local board picker, a remote seat's
     * streamed slot, and the AI heuristic all land here, so every client moves
     * the ring identically at the same point in the stream.
     *
     * A move onto the slot you already occupy is refused: it would re-collect
     * that slot's coin for free, and "move the slider" has to actually move it.
     * An out-of-range slot falls back to the deterministic AI pick rather than
     * dropping the card's effect.
     *
     * NOT subject to the one-direction-per-turn lock — that governs paid slides
     * (Wyatt's ruling); the card says ANY slot, and it pays no toll.
     */
    applyFreeSliderMove(playerIndex, pos) {
        const player = this.players[playerIndex];
        player._pendingSliderMove = false;

        const valid = Number.isInteger(pos) && pos >= 0 && pos < SLIDER_POSITIONS
            && pos !== player.sliderPosition;
        const target = valid ? pos : this.aiFreeSliderPos(playerIndex);
        if (target === player.sliderPosition) return { success: false, error: 'Nowhere to move' };

        player.sliderPosition = target;
        this.applySliderAbilities(player);   // the landing pays out, as any landing does
        const posNames = ['Far Left', 'Left', 'Center', 'Right', 'Far Right'];
        this.addLog(`${player.name}'s Chemical X: ring moves to ${posNames[target]} (free)`);
        return { success: true, pos: target };
    }

    /**
     * The AI's destination — and the fallback EVERY client computes identically
     * when a human's pick never arrives (AFK boot). Values the slot's end-game
     * Favor first, then its purse and skills. Pure: reads state, mutates nothing.
     */
    aiFreeSliderPos(playerIndex) {
        const player = this.players[playerIndex];
        const slots = (player.character && player.character.slots) || [];
        let best = player.sliderPosition;
        let bestScore = -Infinity;
        slots.forEach((s, i) => {
            if (i === player.sliderPosition) return;      // it has to move
            let score = (s.favor || 0) * 3 + (s.gold || 0) - (s.scorn || 0) * 2;
            if (s.skills) Object.values(s.skills).forEach(v => { score += v; });
            if (s.special) score += 2;
            if (score > bestScore) { bestScore = score; best = i; }
        });
        return best;
    }

    /**
     * The skills the player's CURRENT slot offers to "Pick One" from — empty
     * unless they're standing on a pick_one slot (the Magician's 4th).
     */
    slotPickOptions(playerIndex) {
        const p = this.players[playerIndex];
        const slot = (p && p.character && p.character.slots)
            ? p.character.slots[p.sliderPosition] : null;
        return (slot && slot.special === 'pick_one' && Array.isArray(slot.pickOptions))
            ? slot.pickOptions.slice()
            : [];
    }

    /**
     * The AI's choice — and the fallback EVERY client computes identically when a
     * human's pick never arrives (AFK boot / silent seat). Shore up your weakest
     * option. Pure: reads state, mutates nothing.
     */
    aiSlotPick(playerIndex, options) {
        const opts = (options && options.length) ? options : this.slotPickOptions(playerIndex);
        if (!opts.length) return null;
        const p = this.players[playerIndex];
        let best = opts[0];
        opts.forEach(s => {
            if ((p.skills[s] || 0) < (p.skills[best] || 0)) best = s;
        });
        return best;
    }

    /**
     * Grant the chosen "Pick One" skill. THE single mutation point: the local
     * picker, a remote seat's streamed move, and the AI heuristic all land here,
     * so every client mutates identically at the same point in the move stream.
     * An unknown or absent skill falls back to the deterministic AI pick rather
     * than silently dropping the grant.
     */
    applySlotPick(playerIndex, skill) {
        const player = this.players[playerIndex];
        const opts = this.slotPickOptions(playerIndex);
        player._pendingSlotPick = null;
        if (!opts.length) return { success: false, error: 'No pick available here' };

        const chosen = opts.includes(skill) ? skill : this.aiSlotPick(playerIndex, opts);
        // bonusSkills, NOT player.skills — applySlotSkills rebuilds skills from
        // slot + played cards + bonusSkills, and would erase a raw write.
        if (!player.bonusSkills) player.bonusSkills = {};
        player.bonusSkills[chosen] = (player.bonusSkills[chosen] || 0) + 1;
        this.applySlotSkills(player);
        this.addLog(`${player.name} picks ${chosen} from the board`);
        return { success: true, skill: chosen };
    }

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
        // Flex skills (either/or cards) are collected separately: one unit
        // usable as EITHER option, chosen per check, never both and never
        // twice. They stay OUT of player.skills so displayed totals don't
        // wander as other skills change; requirement checks allocate them
        // against whatever is short (see unmetSkillReqs).
        player.flexSkills = [];
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
            // Family Ring and Secret Lab grant NO skills -- both are scoring
            // cards. See favor_per_knowledge_x2 / favor_per_potion_x5 in
            // dynamicCardFavor.
            if (c.special === 'charisma_or_prospecting') {
                player.flexSkills.push(['charisma', 'prospecting']);
            }
            if (c.special === 'alchemy_or_prospecting') {
                player.flexSkills.push(['alchemy', 'prospecting']);
            }
            if (c.special === 'alchemy_or_survival') {
                player.flexSkills.push(['alchemy', 'survival']);
            }
        });

        // Mission success rewards ("3 Prospecting") persist for the rest of
        // the game — they must survive this rebuild.
        if (player.bonusSkills) {
            Object.entries(player.bonusSkills).forEach(([skill, n]) => {
                if (SKILLS.includes(skill)) {
                    player.skills[skill] = (player.skills[skill] || 0) + n;
                }
            });
        }

        this.sampleSeatStats(player);
    }

    /**
     * Achievement telemetry for one seat. PEAKS, not end-state: gold you earn
     * and then spend still counts toward "hold more than 30 Gold", and Power
     * you later lose to a penalty discard still counts toward "reach 10 Power".
     * Sampled from applySlotSkills (the universal recalc, so it fires on every
     * card play, slot move and mission reward) and again after melee, which
     * pays out without touching skills.
     *
     * Pure bookkeeping — it must never gate a rule or change a score.
     */
    sampleSeatStats(player) {
        if (!player) return;
        const i = this.players.indexOf(player);
        if (i < 0) return;
        player.peakGold = Math.max(player.peakGold || 0, player.gold || 0);
        player.peakPower = Math.max(player.peakPower || 0, this.calculatePower(i) || 0);
        player.potionsPlayed = (player.playedCards || []).filter(c => c.type === 'potion').length;
        // Peak of every skill this game — the "reach 10 X" achievements read
        // these (Wyatt 7/17). Power uses effectiveSkill so Blind Faith etc. count.
        player.peakSkills = player.peakSkills || {};
        ['survival', 'charisma', 'alchemy', 'prospecting', 'knowledge', 'power'].forEach(sk => {
            const v = sk === 'power' ? this.effectiveSkill(i, 'power') : (player.skills[sk] || 0);
            player.peakSkills[sk] = Math.max(player.peakSkills[sk] || 0, v || 0);
        });
    }

    /**
     * Which of `reqCounts` ({skill: n}) can't be covered by fixed skills
     * plus flex units? Each flex unit covers ONE unit of either of its two
     * options — never both. Exact search over flex assignments (the list is
     * tiny), so "1 Charisma & 1 Prospecting with one Mining Guild + one
     * fixed Prospecting" resolves correctly no matter the order.
     * Returns a {skill: unitsStillMissing} map — empty means satisfied.
     */
    unmetSkillReqs(playerIndex, reqCounts) {
        const player = this.players[playerIndex];
        const deficit = {};
        Object.entries(reqCounts).forEach(([skill, n]) => {
            const short = n - this.effectiveSkill(playerIndex, skill);
            if (short > 0) deficit[skill] = short;
        });
        const flex = player.flexSkills || [];
        const total = (d) => Object.values(d).reduce((a, b) => a + b, 0);
        if (!total(deficit) || !flex.length) return deficit;

        let best = deficit;
        const tryAssign = (i, def) => {
            if (!total(def)) { best = def; return true; }
            if (i >= flex.length) {
                if (total(def) < total(best)) best = def;
                return false;
            }
            for (const opt of flex[i]) {
                if (def[opt]) {
                    const next = { ...def };
                    if (next[opt] === 1) delete next[opt]; else next[opt]--;
                    if (tryAssign(i + 1, next)) return true;
                }
            }
            return tryAssign(i + 1, def); // this flex unit goes unused
        };
        tryAssign(0, deficit);
        return best;
    }

    /**
     * Grant N Philosopher's Stones from a character-board slot, once per
     * game per slot special. Slot events re-fire on every landing (see
     * applySlotBonus) and the stone tally now STACKS, so without this gate
     * a player could farm stones by sliding back and forth over the slot.
     * No board carries the same stone special twice, so keying by special
     * name is unambiguous. Returns true if the grant paid out.
     */
    grantSlotStones(player, key, n) {
        // ⚠ A PLAIN OBJECT, deliberately, not a Set: a Set does not survive a
        // JSON round-trip. Nothing serializes players today, but the moment
        // save/resume or MP sync JSON-encodes them the gate would silently
        // reset and slot stones would re-grant on every landing -- runaway
        // inflation, and the sliding-back-and-forth farm this gate exists to
        // stop. An object survives the trip.
        if (!player._slotStoneGranted) player._slotStoneGranted = {};
        if (player._slotStoneGranted[key]) return false;
        player._slotStoneGranted[key] = true;
        player.philosopherStone = (player.philosopherStone || 0) + n;
        return true;
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
                // Stones STACK (3 stone cards = 3 stones, Wyatt 7/18), so the
                // old Math.max idempotency no longer guards slot re-fires.
                // Each slot's stone grant pays once per game instead.
                if (this.grantSlotStones(player, 'philosopher_stone', 1)) {
                    this.addLog(`${player.name} gains Philosopher's Stone (1:1 gold\u2192favor)`);
                }
                break;

            case 'philosopher_stone_x2':
                if (this.grantSlotStones(player, 'philosopher_stone_x2', 2)) {
                    this.addLog(`${player.name} gains 2\u00D7 Philosopher's Stone (2:1 gold\u2192favor)`);
                }
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
                if (this.grantSlotStones(player, 'minds_eye_and_philosopher', 1)) {
                    this.addLog(`${player.name} gains Mind's Eye + Philosopher's Stone from character board`);
                }
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
                    if (player.index === 0 || player._remoteHuman) {
                        // Human (local OR remote) — the flag pauses for a
                        // choice: local shows the picker, remote awaits the
                        // owner's streamed pick. Never auto-decided.
                        player._pendingSlotMission = true;
                    } else {
                        // AI: auto-pick best mission
                        let bestIdx = 0;
                        let bestFavor = -1;
                        this.visibleMissions.forEach((m, i) => {
                            const favor = this.missionFavorEstimate(player.index, m);
                            if (favor > bestFavor) { bestFavor = favor; bestIdx = i; }
                        });
                        this.chooseMission(player.index, bestIdx);
                    }
                    this.addLog(`${player.name} chooses a mission from the pool`);
                }
                break;

            case 'pick_one':
                // The Magician's board reads "Pick One" — so the PLAYER picks.
                // Rules fidelity: where the box gives a choice, build the choice.
                // This used to silently auto-take whichever skill you had least of.
                //
                // ⚠ And the grant never even LANDED: it wrote to player.skills,
                // and applySliderAbilities calls applySlotSkills immediately after
                // this, which zeroes player.skills and rebuilds it from slot +
                // played cards + bonusSkills. The +1 was erased microseconds after
                // it was granted, every single time. Skill grants must ride
                // bonusSkills to survive the recalc — applySlotPick() is now the
                // ONE mutation point for local, remote and AI alike, so every
                // client applies the identical change at the identical moment.
                if (slot.pickOptions && slot.pickOptions.length > 0) {
                    if (player.index === 0 || player._remoteHuman) {
                        // Human (local OR remote) — the flag pauses for a choice:
                        // local shows the picker, remote awaits the owner's
                        // streamed pick. Never auto-decided.
                        player._pendingSlotPick = slot.pickOptions.slice();
                    } else {
                        this.applySlotPick(player.index, this.aiSlotPick(player.index));
                    }
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
            if (card.rewards.favor) {
                this.awardFavor(playerIndex, card.rewards.favor, 'card', card.name,
                    { type: card.type, file: card.filename });
            }
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
                // Mining Guild: a flex skill — counts as Charisma OR
                // Prospecting per check, never both, never twice. The card
                // is already in playedCards, so a recalc registers it.
                this.applySlotSkills(player);
                this.addLog(`${player.name}'s ${card.name}: +1 Charisma OR Prospecting (chosen when needed)`);
                break;

            case 'alchemy_or_prospecting':
                // Forbidden Lab: flex — Alchemy OR Prospecting per check.
                this.applySlotSkills(player);
                this.addLog(`${player.name}'s ${card.name}: +1 Alchemy OR Prospecting (chosen when needed)`);
                break;

            case 'alchemy_or_survival':
                // Hermit's Lab: flex — Alchemy OR Survival per check.
                this.applySlotSkills(player);
                this.addLog(`${player.name}'s ${card.name}: +1 Alchemy OR Survival (chosen when needed)`);
                break;

            // --- Philosopher's Stone variants (end-of-game gold→favor) ---

            case 'philosopher_stone':
                // The token itself. It is a REQUIREMENT resource — Chemical Y,
                // Mind Warper, Gold Luster, Family Ring, Duplicating Goo and
                // Reunited each want one, and Quest for the Stones wants
                // THREE, which is why the tally has to stack (Wyatt 7/18: "we
                // had 3 and it registered as 1"). It is not worth Favor by
                // itself; the gold-conversion scoring was never a real rule.
                player.philosopherStone = (player.philosopherStone || 0) + 1;
                this.addLog(`${player.name} gains a Philosopher's Stone`);
                break;

            // ⚠ 'philosopher_stone_x10' removed 7/18: DEAD CODE that no card
            // ever used. Its comment claimed Sacred Chest, and the ten stones
            // it purported to grant were the source of the "Sacred Chest x10"
            // claim — there is no such grant and there never was. (That
            // comment then asserted Sacred Chest was favor_per_wisdom_x8
            // "exactly as printed", which was ALSO wrong — see
            // favor_per_artifact_x8 in dynamicCardFavor. Three different
            // readings of one card, none of them from looking at it.)

            // --- Mind's Eye (knowledge bonus) ---

            case 'minds_eye':
            case 'The Shadow Guide':
                // +1 Knowledge bonus
                player.skills.knowledge = (player.skills.knowledge || 0) + 1;
                this.addLog(`${player.name}'s ${card.name}: +1 Knowledge (Mind's Eye)`);
                break;

            case 'minds_eye_x2':
                // Deadeye: grants 2 Mind's Eye (counted in getMindsEyeCount)
                this.addLog(`${player.name}'s ${card.name}: +2 Mind's Eye`);
                break;

            case 'minds_eye_x3':
                // Shattering the Mirror Prison: grants 3 Mind's Eye
                this.addLog(`${player.name}'s ${card.name}: +3 Mind's Eye`);
                break;

            // --- Knowledge multipliers ---

            case 'knowledge_x5':
                // Royal Library: grants 5 knowledge total (card already gave 1, add 4 more)
                player.skills.knowledge = (player.skills.knowledge || 0) + 4;
                this.addLog(`${player.name}'s Royal Library: +5 Knowledge total`);
                break;

            // Family Ring used to land here as a SKILL grant (+1 Knowledge,
            // logged as "+2 Knowledge total"), but the printed card reads
            // "Favor equal to your total Knowledge x2" -- the engine was
            // playing a different card than the box, and the phantom Knowledge
            // also inflated requirement checks. It scores in dynamicCardFavor
            // now, like every other favor_per_* artifact.

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
                        // `from` records the caster so the Melee can fire its bolts.
                        this.players[i].powerDebuffs.push({ amount: -3, act: this.currentAct, source: card.name, from: playerIndex });
                        this.addLog(`${this.players[i].name} receives -3 power from ${player.name}'s Fuzzy Head`);
                    }
                }
                break;

            case 'coin_flip_4_power':
                // Shot of Courage: next Melee, flip a coin — heads = +4 Power.
                // The outcome is decided HERE (seeded — MP lockstep) but
                // recorded on coinFlips win OR lose, so the Melee can reveal
                // it as a live toss. `coin` tags the won bonus so
                // powerBreakdown shows ONE coin step, not a bonus + a toss.
                {
                    const won = this._rand() < 0.5;
                    if (!player.coinFlips) player.coinFlips = [];
                    player.coinFlips.push({ source: card.name, act: this.currentAct, won: won, amount: 4 });
                    if (won) {
                        if (!player.powerBonuses) player.powerBonuses = [];
                        player.powerBonuses.push({ amount: 4, act: this.currentAct, source: card.name, coin: true });
                        this.addLog(`${player.name}'s ${card.name}: HEADS! +4 Power for melee`);
                    } else {
                        this.addLog(`${player.name}'s ${card.name}: TAILS! No bonus`);
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
                // Chemical X: "Move Character Slider to ANY slot." Any slot — so
                // the PLAYER picks (rules fidelity: where the box gives a choice,
                // build the choice). It used to shove you to slot 5 — or slot 1 if
                // you were already right — which is not a choice at all, and could
                // dump you somewhere you'd never have gone.
                // applyFreeSliderMove() is THE single mutation point for local,
                // remote and AI alike, so every client lands the ring identically.
                if (player.index === 0 || player._remoteHuman) {
                    // Human (local OR remote) — the flag pauses for a choice:
                    // local opens the board, remote awaits the owner's streamed
                    // slot. Never auto-decided.
                    player._pendingSliderMove = true;
                } else {
                    this.applyFreeSliderMove(player.index, this.aiFreeSliderPos(player.index));
                }
                break;

            // --- Favor/economy specials ---

            case 'double_adventure_favor':
                // Chemical Y, per the card: "Choose an Adventure card you
                // have, multiply its Favor amount by 2" — ONE card, chosen.
                // The pick is marked on the card and pays at scoring, so a
                // later discard takes the doubling with it. A card doubles
                // at most once; a second Chemical Y picks a different one.
                // (Pair bonus +15 w/ Chemical X pays in dynamicCardFavor.)
                {
                    const advs = player.playedCards.filter(c =>
                        c.type === 'adventure' && (c.favor || 0) > 0 && !c._favorDoubled);
                    if (!advs.length) {
                        this.addLog(`${player.name}'s Chemical Y: no adventure favor to double`);
                        break;
                    }
                    if (playerIndex === 0 || player._remoteHuman) {
                        // Human (local or remote) chooses via picker/stream
                        // right after this activation resolves.
                        player._pendingChemYPick = true;
                    } else {
                        const best = advs.reduce((a, b) => ((b.favor || 0) > (a.favor || 0) ? b : a));
                        best._favorDoubled = true;
                        this.addLog(`${player.name}'s Chemical Y doubles ${best.name} (+${best.favor} Favor at scoring)`);
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

            case 'others_15_scorn':
                // Chemical Z: all other players gain 15 Scorn. The art and the
                // card's own audit text both read 15 — the old `others_5_scorn`
                // was the outlier (you still take 5 yourself, via rewards.scorn).
                for (let i = 0; i < this.playerCount; i++) {
                    if (i !== playerIndex) {
                        this.players[i].scorn += 15;
                        this.addLog(`${this.players[i].name} gains 15 Scorn from ${player.name}'s Chemical Z`);
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
                    // "Power your neighbors currently have" = effective
                    // power (Blind Faith pairings included) — same read
                    // the missions and the panel use.
                    const pow = this.effectiveSkill((playerIndex + n - 1) % n, 'power')
                        + this.effectiveSkill((playerIndex + 1) % n, 'power');
                    const gained = 2 * pow;
                    player.gold += gained;
                    this.addLog(`${player.name}'s Melee Spectacular: neighbors' ${pow} Power → +${gained} Gold`);
                }
                break;

            case 'remove_mission_requirements':
                // Life Essence, per the card: "Choose One of Your Active
                // Missions — This Mission no longer has any Requirement."
                // ONE active (not yet resolved) mission is chosen and marked
                // _reqWaived for good. With no active missions the potion
                // simply rests on the field (cards that count potions still
                // see it).
                {
                    const active = (player.missions || []).filter(m => !m._reqWaived);
                    if (!active.length) {
                        this.addLog(`${player.name}'s Life Essence: no active missions — the essence rests`);
                        break;
                    }
                    if (playerIndex === 0 || player._remoteHuman) {
                        // Human (local or remote) chooses via picker/stream
                        // right after this activation resolves.
                        player._pendingLifeEssencePick = true;
                    } else {
                        // AI: waive the mission it is least likely to meet —
                        // the highest-value one that currently fails; if all
                        // pass today, protect the most valuable anyway.
                        const failing = active.filter(m => !this.probeMissionRequirements(playerIndex, m).success);
                        const pool = failing.length ? failing : active;
                        const best = pool.reduce((a, b) =>
                            (this.missionFavorEstimate(playerIndex, b) > this.missionFavorEstimate(playerIndex, a) ? b : a));
                        best._reqWaived = true;
                        this.addLog(`${player.name}'s Life Essence: ${best.name} no longer has any requirement`);
                    }
                }
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
                // ARCHEUS, as printed: "All other Players must discard 1 weapon
                // card they have." The VICTIM chooses which weapon.
                //
                // This used to findIndex the first weapon in play order and
                // splice it, unconditionally, for every victim — including
                // seat 0 and remote humans. Wyatt 7/18: "Arceus got played by
                // another player, and then I never had to discard a card. I
                // should have had to discard a weapon card, but it never even
                // told me." Every other human-choice special guards with
                // (playerIndex === 0 || _remoteHuman) and sets a pause flag for
                // the phase loop to await; this one set none, so there was
                // nothing for endActPhases or mpEndActStages to wait on.
                //
                // ⚠ That silent findIndex was also the ONLY reason MP tables
                // did not fork here: every client independently computed the
                // same first weapon. Giving the victim a choice makes the
                // outcome client-specific, which is why this needs a streamed
                // move and MPV 14.
                // ⚠ The only notice this ever gave was addLog(), which feeds
                // the save/serialize snapshot and NOTHING the player sees --
                // the visible feed is ui.js's addLogEntry. grep "forced to
                // discard" across js/ and engine/ returned exactly one hit,
                // this line. So the AI victims' losses are recorded here for
                // the UI to narrate; human victims narrate their own pick.
                this._archeusTook = [];
                for (let i = 0; i < this.playerCount; i++) {
                    if (i === playerIndex) continue;
                    const opponent = this.players[i];
                    if (!opponent.playedCards.some(c => c.type === 'weapon')) {
                        this.addLog(`${opponent.name} has no weapons to discard`);
                        continue;
                    }
                    // Humans defer to a picker; AI seats resolve immediately
                    // on the same keep-score every penalty discard uses.
                    const had = [...opponent.playedCards];
                    this.penaltyDiscard(i, 1, {
                        filter: c => c.type === 'weapon',
                        pend: '_pendingWeaponDiscard',
                    });
                    const gone = had.filter(c => !opponent.playedCards.includes(c));
                    if (gone.length) this._archeusTook.push({ playerIndex: i, cards: gone });
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
                // ⚠ REMOVED 7/19 — the +10 "Forgotten Temple + Sacred Chest
                // combo" was INVENTED, the same class of bug as the gold→Favor
                // conversion (7/18), Family Ring's phantom skill grant and
                // Secret Lab. Neither card prints it. Forgotten Temple reads
                // "Map of Sacred Chest & 1 Knowledge & 2 Scorn" — it hands you
                // the map, which is exactly what its grantsMap field already
                // does. Sacred Chest costs 12 Gold to play, and rulebook p.12
                // defines a Map as "the ability to play the Card for no cost"
                // — so the map waives the 12. That waiver is the entire
                // relationship between the two cards; there is no bonus on
                // top of it.
                // The special stays declared so the play still logs, and so it
                // can't fall through to the "unknown special" branch.
                this.addLog(`${player.name}'s ${card.name} grants the Sacred Chest map`);
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
                // AUDIT FIX 2026-07-14: pays 20, not 15. The Lost South Map prints
                // a blue 20 beside its "2/2" plaque, and its own audit text says
                // "If you have the Lost North Map 20 additional Favor". The engine
                // was the only voice saying 15 — and no checker looked at combos.
                this.awardFavor(playerIndex, 20, 'card', 'Both Map halves found',
                    { type: card.type, file: card.filename });
                this.addLog(`${player.name} completes the Map! Both halves found: +20 Favor!`);
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

        // 1/2 + 2/2 pairs: the 2/2 card prints its OWN bonus for owning the
        // 1/2 partner — there is no generic combo reward. Heaven's Blade and
        // Archeus each pay +6 Power at the Melee (calculatePower, ongoing
        // while both are down); Chemical Y pays +15 Favor at scoring
        // (dynamicCardFavor). Here we just announce a pairing completing.
        if (card.combo === '1/2' || card.combo === '2/2') {
            const own = (n) => player.playedCards.some(c => c.name === n);
            if (own('Blind Faith')) {
                const partners = ["Heaven's Blade", 'Archeus'].filter(own);
                if (partners.length && ['Blind Faith', "Heaven's Blade", 'Archeus'].includes(card.name)) {
                    this.addLog(`${player.name}'s Blind Faith pairing: +6 Power from ${partners.join(' and from ')} at the Melee`);
                }
            }
            if (own('Chemical X') && own('Chemical Y') &&
                (card.name === 'Chemical X' || card.name === 'Chemical Y')) {
                this.addLog(`${player.name}'s Chemical X + Chemical Y pairing: +15 Favor at scoring`);
            }
            return;
        }

        // ⚠ REMOVED 7/19 — a blanket "+5 Favor for a named combo" that no card
        // prints. Exactly three cards carry a string combo, and on all three
        // the string is a MAP that leaked into the combo field:
        //   Facing the River Fiend  → "The Minister's Plan"      (its reqMaps)
        //   Finding the Lost Corridor → "Reunited"               (its grantsMap)
        //   Reunited                → "Finding the Lost Corridor"(its reqMaps)
        // Their printed text is "15 Favor", "10 Favor & Reunited Map" and
        // "22 Favor & 1 Philosopher's Stone" — no combo bonus on any of them.
        // The comment above already established there is no generic combo
        // reward for the 1/2 + 2/2 pairs; this was the same false assumption
        // wearing a different hat, and it is the kind of untraceable Favor
        // Wyatt flagged on 7/19 ("the +6 is not traceable to anything").
        // Real pair bonuses are printed on the card and live where they
        // belong: Heaven's Blade / Archeus +6 Power in calculatePower,
        // Chemical Y's +15 Favor in dynamicCardFavor, the Lost North + Lost
        // South +20 in resolveMapBonus.
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
            // Remove ONE instance only — duplicate ids (two Mission Letters)
            // must not wipe the sibling card. Build a NEW array: callers
            // (activateAllCards) iterate a captured snapshot of the old one,
            // so mutating it in place would skip the cards after this one.
            const idx = pending.findIndex(c => c && c.id === cardId);
            const next = idx === -1 ? pending.slice()
                : pending.slice(0, idx).concat(pending.slice(idx + 1));
            this.pendingActivations[playerIndex] = next.length === 0 ? null : next;
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

    /**
     * A mission's DUE act — the last act in its printed window. Audits read
     * "Act 1 OR Act 2 OR Act 3": the mission may be turned in during ANY
     * listed act (player's choice, see turnInMission) and is only FORCED to
     * resolve — failing if unmet — at the end of its final listed act.
     * Parsed from the audit head (before "Success Reward", so failure text
     * that mentions acts can't skew it) and cached on the mission.
     */
    missionDueAct(mission) {
        if (mission.dueAct) return mission.dueAct;
        const head = (mission.audit || '').split(/Success Reward/i)[0];
        const acts = [...head.matchAll(/Act\s*(\d)/gi)].map(m => parseInt(m[1], 10));
        mission.dueAct = acts.length ? Math.max(...acts) : (mission.activationRound || mission.act || 1);
        return mission.dueAct;
    }

    /**
     * What completing this mission is WORTH in favor right now — the printed
     * favorValue plus whatever its per-asset success special would pay at
     * this moment. Pure valuation for AI decisions (borrow fees, mission
     * picks); pays nothing.
     */
    missionFavorEstimate(playerIndex, mission) {
        const p = this.players[playerIndex];
        let favor = mission.favorValue || 0;
        switch (mission.successSpecial) {
            case 'favor_per_charisma_x2':   favor += 2 * (p.skills.charisma || 0); break;
            case 'favor_per_knowledge_x1':  favor += (p.skills.knowledge || 0); break;
            case 'favor_per_minds_eye_x5':  favor += 5 * this.getMindsEyeCount(playerIndex); break;
            case 'favor_per_philstone_x10': favor += 10 * (p.philosopherStone || 0); break;
        }
        return favor;
    }

    /**
     * Turn a held mission in EARLY, by choice — it resolves immediately,
     * success or failure, exactly as it would at its due date.
     */
    /**
     * Missions this seat is holding that are INSIDE their window but not yet
     * forced: activated, and due in a LATER act. Each one is a decision at the
     * act boundary — attempt it now (pass or fail on what you have), or hold it
     * and be asked again next act. Wanted: Crazy Lou activates in Act 1 but is
     * only due at the end of Act 3, so it asks three times.
     * Pure — no side effects.
     */
    postponableMissions(playerIndex) {
        const player = this.players[playerIndex];
        return (player.missions || []).filter(m =>
            m.activationRound
            && m.activationRound <= this.currentAct
            && this.missionDueAct(m) > this.currentAct);
    }

    turnInMission(playerIndex, missionIndex) {
        const player = this.players[playerIndex];
        const mission = player.missions[missionIndex];
        if (!mission) return { success: false, error: 'No such mission' };

        const { success, details } = this.checkMissionRequirements(playerIndex, mission);
        player.missions.splice(missionIndex, 1);
        if (success) {
            this.applyMissionRewards(playerIndex, mission);
            player.completedMissions.push(mission);
        } else {
            player.failedMissions.push(mission);
            this.applyMissionFailure(playerIndex, mission);
            this.addLog(`${player.name} turns in ${mission.name} early — and fails it`);
        }
        return { success, details, mission };
    }

    /**
     * Can borrowed skills rescue this mission? Returns {borrowFrom, cost}
     * exactly like card borrows (2g per unit, paid to the lender), or null
     * when it can't: any Mind's Eye / Philosopher's Stone / Gold / Favor gap
     * is unborrowable, and gold must cover the fee WITHOUT breaking a
     * hold-N-gold requirement. Pure analysis — no side effects.
     */
    missionBorrowPlan(playerIndex, mission, chosen) {
        const player = this.players[playerIndex];
        if (mission._reqWaived) return null; // Life Essence: succeeds on its own

        const reqCounts = {};
        (mission.requirements || []).forEach(req => { reqCounts[req] = (reqCounts[req] || 0) + 1; });
        const skillReqs = {};
        for (const [req, n] of Object.entries(reqCounts)) {
            if (req === 'minds_eye') {
                if (this.getMindsEyeCount(playerIndex) < n) return null;
            } else if (req === 'philosopher_stone') {
                if ((player.philosopherStone || 0) < n) return null;
            } else {
                skillReqs[req] = n;
            }
        }
        if (mission.reqFavor && this.currentFavor(playerIndex) < mission.reqFavor) return null;
        if (mission.reqMaps && mission.reqMaps.length) {
            const held = this.getPlayerMaps(playerIndex);
            // A map ALTERNATIVE already completes it → nothing to borrow;
            // a missing reqMapsAll map can never be borrowed.
            if (!mission.reqMapsAll && mission.reqMaps.some(mp => held.includes(mp))) return null;
            if (mission.reqMapsAll && !mission.reqMaps.every(mp => held.includes(mp))) return null;
        }

        const gaps = this.unmetSkillReqs(playerIndex, skillReqs);
        const borrowable = this.getBorrowableSkills(playerIndex);
        // `chosen` = the player's picked lenders, [{skill, neighborIndex}, ...].
        // The 2g-per-unit fee is paid TO the lender, so WHO lends is a real
        // decision (you may not want to fund the leader) — it is never the
        // engine's to make. Every pick is RE-VALIDATED here: a lender can slide
        // off the very slot that granted the skill between the click and the
        // resolution. A stale pick falls back to any current lender, exactly
        // like resolveBorrowPlan does for cards. With no picks (the AI, and
        // every probe that only asks "is a borrow possible?") this is the old
        // first-available behavior, unchanged.
        const pool = Array.isArray(chosen) ? chosen.slice() : [];
        const borrowFrom = [];
        for (const [skill, short] of Object.entries(gaps)) {
            if (!borrowable[skill] || borrowable[skill].length === 0) return null;
            for (let k = 0; k < short; k++) {
                const ci = pool.findIndex(b => b.skill === skill
                    && borrowable[skill].includes(b.neighborIndex));
                const pick = ci >= 0 ? pool.splice(ci, 1)[0] : null;
                borrowFrom.push({ skill, neighborIndex: pick ? pick.neighborIndex : borrowable[skill][0] });
            }
        }
        if (borrowFrom.length === 0) return null; // nothing missing — no borrow needed

        const cost = borrowFrom.length * BORROW_SKILL_COST;
        // Covers both the fee and any hold-N-gold requirement — the borrow
        // may not pay for itself by breaking the mission's gold check.
        if (player.gold < cost + (mission.reqGold || 0)) return null;

        return { borrowFrom, cost };
    }

    /**
     * Borrow the missing skills and complete the mission — the player's
     * CHOICE, never automatic. Gold pays the lending neighbors, exactly
     * like card borrows.
     */
    completeMissionWithBorrow(playerIndex, missionIndex, chosen) {
        const player = this.players[playerIndex];
        const mission = player.missions[missionIndex];
        if (!mission) return { success: false, error: 'No such mission' };
        const plan = this.missionBorrowPlan(playerIndex, mission, chosen);
        if (!plan) return { success: false, error: 'Borrowing cannot complete this mission' };

        player.gold -= plan.cost;
        plan.borrowFrom.forEach(b => {
            this.players[b.neighborIndex].gold += BORROW_SKILL_COST;
        });
        player.missions.splice(missionIndex, 1);
        this.applyMissionRewards(playerIndex, mission);
        player.completedMissions.push(mission);
        const skills = plan.borrowFrom.map(b => b.skill).join(', ');
        const lenders = [...new Set(plan.borrowFrom.map(b => this.players[b.neighborIndex].name))].join(' & ');
        this.addLog(`${player.name} borrows ${skills} from ${lenders} (−${plan.cost}g) to complete ${mission.name}`);
        // borrowFrom comes back so callers can name the lenders who were PAID —
        // the fee lands in their purse, so the log has to say whose.
        return { success: true, mission, cost: plan.cost, borrowFrom: plan.borrowFrom };
    }

    /**
     * Decline the borrow offer — the mission fails now, penalties and all.
     * (Failing on purpose is a legitimate play; see turnInMission.)
     */
    failMissionByChoice(playerIndex, missionIndex) {
        const player = this.players[playerIndex];
        const mission = player.missions[missionIndex];
        if (!mission) return { success: false, error: 'No such mission' };
        player.missions.splice(missionIndex, 1);
        player.failedMissions.push(mission);
        this.applyMissionFailure(playerIndex, mission);
        this.addLog(`${player.name} lets ${mission.name} fail`);
        return { success: false, mission };
    }

    /**
     * Run `fn` and report everything it changed, from the point of view of
     * seat `idx`. Used for every mission resolution and by the UI for the
     * failure paths that happen outside resolveMissions.
     */
    measureResolution(idx, fn) {
        const snap = (q) => ({
            favor: q.favor, gold: q.gold, prestige: q.prestige,
            scorn: q.scorn, stones: q.philosopherStone || 0,
        });
        const diff = (a, b) => ({
            favor: b.favor - a.favor, gold: b.gold - a.gold,
            prestige: b.prestige - a.prestige, scorn: b.scorn - a.scorn,
            stones: b.stones - a.stones,
        });
        const before = this.players.map(snap);
        const beforeEye = this.getMindsEyeCount(idx);
        const ledger = { discarded: [], gates: [] };
        this._resLedger = ledger;
        try { fn(); } finally { this._resLedger = null; }
        const after = this.players.map(snap);

        const d = diff(before[idx], after[idx]);
        d.mindsEye = this.getMindsEyeCount(idx) - beforeEye;
        d.discarded = ledger.discarded;
        d.gates = ledger.gates;
        d.others = [];
        this.players.forEach((q, j) => {
            if (j === idx) return;
            const dd = diff(before[j], after[j]);
            if (dd.favor || dd.gold || dd.prestige || dd.scorn || dd.stones) {
                d.others.push({ playerIndex: j, name: q.name, ...dd });
            }
        });
        return d;
    }

    resolveMissions() {
        const results = [];

        // Missions dealt BY a resolution (The Midnight Crash's failure deals the
        // whole table an Act 3 mission). Cleared each act so last act's deal
        // can't narrate twice.
        this._missionDraws = [];

        // What each resolution actually PAID or COST — the mission ceremony
        // shows these honest deltas. Per-asset favor depends on the player's
        // state at this exact moment, so recomputing later would lie.
        //
        // Wyatt 7/18: "Who got gold? Who is affected by this?" The old snapshot
        // was SIX SCALARS ON ONE SEAT, so three whole classes of consequence
        // were structurally invisible. Measured now, alongside them:
        //   others    — every OTHER seat the resolution moved. others_gain_5_gold
        //               and friends mutate players outside the measured seat, so
        //               "who got gold" had no answer to give.
        //   discarded — the actual CARD OBJECTS a bulk discard took. The engine
        //               flattened them to a count, so a Secret Grotto failure
        //               showed the prestige it paid and never the cards it cost.
        //   gates     — conditional failure rewards, and whether they FIRED. A
        //               gate that missed must be able to say so, or a mission
        //               like The Labyrinth renders a literally empty beat.
        // measureResolution lives on the class so the UI's out-of-band failure
        // paths (a declined borrow, a deliberate turn-in-and-fail) measure a
        // mission EXACTLY the way a due-date resolution does, and their
        // ceremony beats carry the same information.
        const measure = (idx, fn) => this.measureResolution(idx, fn);

        // Start with emblem holder, go clockwise
        let pi = this.emblemHolder;
        for (let i = 0; i < this.playerCount; i++) {
            const player = this.players[pi];
            const playerResults = [];

            // Two passes: every due mission is CHECKED (and successes paid
            // out) before any failure penalty lands. A failure that discards
            // played cards must never strip the skills a sibling mission in
            // this same phase was counting on.
            //
            // ⚠ AND the success pass runs to a FIXED POINT. A mission's
            // success rewards can grant SKILLS, and those skills are on the
            // table for every sibling still resolving in this same phase.
            // Wyatt 7/18: "the first mission you choose gives you power if
            // you're successful... the attributes I gained from the first
            // mission didn't come into account for the later missions, which
            // it is supposed to."
            //
            // Grants DID chain — but only in whatever order player.missions
            // happened to sit in, which is acquisition order and not anything
            // the player controls. Mounted Champion (+3 Power) before Champion
            // of Legend (needs 8 Power) passed BOTH; the same two missions the
            // other way round failed Champion of Legend outright. Sweeping
            // until a sweep completes nothing new is order-independent, so the
            // player always gets every completion they earned and every client
            // agrees. Success rewards never take a skill away, and `resolved`
            // only grows, so this always converges.
            const failed = [];
            const resolved = new Set();
            // ⚠ `_remoteHuman`, never `pi === 0`: pi is the LOCAL seat index,
            // so a remote human is 0 on their own client and non-zero on
            // everyone else's. Keying rules on pi is a lockstep fork.
            const humanSeat = pi === 0 || player._remoteHuman;
            const inWindow = (m) => !!m.activationRound && m.activationRound <= this.currentAct;
            // FORCED at the end of its due act; before that it is still the
            // holder's call (the act-boundary chooser sets _attemptNow, and an
            // attempted mission then walks exactly the same road as a due one).
            const isDue = (m) => this.missionDueAct(m) <= this.currentAct || m._attemptNow === true;

            let progressed = true;
            while (progressed) {
                progressed = false;
                player.missions.forEach((mission) => {
                    if (resolved.has(mission) || !inWindow(mission)) return;
                    // Not due and not attempted: a HUMAN seat decides this at
                    // the act boundary, never automatically. Only a true AI
                    // seat banks a met mission for itself; an unmet one is
                    // HELD, never auto-failed.
                    if (!isDue(mission) && humanSeat) return;
                    const { success, details } = this.checkMissionRequirements(pi, mission);
                    if (!success) return;
                    resolved.add(mission);
                    const deltas = measure(pi, () => this.applyMissionRewards(pi, mission));
                    player.completedMissions.push(mission);
                    playerResults.push({ mission, success: true, details, deltas });
                    progressed = true;   // its rewards may unlock a sibling
                });
            }

            // Fixed point reached — nothing else can be met on skills alone.
            // ONLY NOW may a due mission borrow or fail.
            player.missions.forEach((mission, mi) => {
                if (resolved.has(mission) || !inWindow(mission) || !isDue(mission)) return;
                // Re-read the shortfall against the FINAL state, so a beat
                // reports what they were actually short of at the end.
                const { details } = this.checkMissionRequirements(pi, mission);
                {
                    // Unmet at its due date — can borrowed skills save it?
                    // Borrowing is a CHOICE, never automatic: the human gets
                    // a chooser (endActPhases pauses the phase, same pattern
                    // as _pendingPenaltyDiscard); the AI borrows only when
                    // the mission's favor clearly beats the gold fee.
                    const plan = this.missionBorrowPlan(pi, mission);
                    if (plan && humanSeat) {
                        player._pendingMissionBorrows = player._pendingMissionBorrows || [];
                        player._pendingMissionBorrows.push(mission);
                        return; // stays in player.missions; the chooser/stream resolves it
                    }
                    // Persona rivals judge the trade sharper: any mission
                    // worth at least the fee is taken; generic bots still
                    // demand a clear 2× win. Judgment only — no stat cheats.
                    const borrowBar = plan ? plan.cost * (player._personaAI ? 1 : 2) : Infinity;
                    if (plan && !humanSeat && this.missionFavorEstimate(pi, mission) >= borrowBar) {
                        const deltas = measure(pi, () => {
                            player.gold -= plan.cost;
                            plan.borrowFrom.forEach(b => {
                                this.players[b.neighborIndex].gold += BORROW_SKILL_COST;
                            });
                            this.applyMissionRewards(pi, mission);
                        });
                        resolved.add(mission);
                        player.completedMissions.push(mission);
                        this.addLog(`${player.name} borrows ${plan.borrowFrom.map(b => b.skill).join(', ')} (−${plan.cost}g) to complete ${mission.name}`);
                        playerResults.push({ mission, success: true, details, borrowed: plan.cost, deltas });
                        return;
                    }
                    resolved.add(mission);
                    failed.push(mission);
                    player.failedMissions.push(mission);
                    playerResults.push({ mission, success: false, details });
                }
            });
            failed.forEach(mission => {
                const deltas = measure(pi, () => this.applyMissionFailure(pi, mission));
                const entry = playerResults.find(r => r.mission === mission && !r.success);
                if (entry) entry.deltas = deltas;
            });

            // Remove only what actually resolved — missions still inside
            // their window carry over to the next act.
            player.missions = player.missions.filter(m => !resolved.has(m));

            results.push({ playerIndex: pi, results: playerResults });
            pi = (pi + 1) % this.playerCount;
        }

        return results;
    }

    checkMissionRequirements(playerIndex, mission) {
        // Pure since the Life Essence rework: the waiver is chosen at play
        // time and lives ON the mission (_reqWaived), so checking is safe
        // from anywhere. Kept as the resolve-time entry point.
        return this.probeMissionRequirements(playerIndex, mission);
    }

    /**
     * PURE preview of checkMissionRequirements — same verdict, zero side
     * effects: a held Life Essence still answers "success" but is NOT
     * consumed, and nothing is logged. Rendering N missions in the
     * browser calls this N times and the player's state never moves.
     */
    probeMissionRequirements(playerIndex, mission) {
        const player = this.players[playerIndex];

        // Life Essence already blessed this mission — no requirement at all.
        if (mission._reqWaived) {
            return {
                success: true,
                details: { missing: [], canBorrow: {}, reqWaived: true }
            };
        }

        const missing = [];
        let met = true;

        // Quantity-aware requirements: "3 Knowledge" needs knowledge >= 3
        // (the old check only asked "do you have any"). minds_eye and
        // philosopher_stone entries count against those totals. Skill
        // requirements resolve together so flex units (Mining Guild's
        // Charisma-OR-Prospecting) can cover whichever is short.
        const reqCounts = {};
        (mission.requirements || []).forEach(req => { reqCounts[req] = (reqCounts[req] || 0) + 1; });
        const skillReqs = {};
        Object.entries(reqCounts).forEach(([req, n]) => {
            if (req === 'minds_eye') {
                if (this.getMindsEyeCount(playerIndex) < n) {
                    missing.push(n > 1 ? `${req} ×${n}` : req);
                    met = false;
                }
            } else if (req === 'philosopher_stone') {
                if ((player.philosopherStone || 0) < n) {
                    missing.push(n > 1 ? `${req} ×${n}` : req);
                    met = false;
                }
            } else {
                skillReqs[req] = n;
            }
        });
        Object.entries(this.unmetSkillReqs(playerIndex, skillReqs)).forEach(([req, short]) => {
            missing.push(short > 1 ? `${req} ×${short}` : req);
            met = false;
        });
        if (mission.reqGold && player.gold < mission.reqGold) {
            missing.push(`${mission.reqGold} Gold`); met = false;
        }
        if (mission.reqFavor && this.currentFavor(playerIndex) < mission.reqFavor) {
            missing.push(`${mission.reqFavor} Favor`); met = false;
        }
        // Mission maps come in two printed forms: an ALTERNATIVE ("7 Power &
        // 7 Knowledge OR Guardian Map" — holding it completes the mission by
        // itself) or, with reqMapsAll, one MORE requirement alongside the
        // stats (The Shadow Guide's A Hidden Door).
        if (mission.reqMaps && mission.reqMaps.length) {
            const held = this.getPlayerMaps(playerIndex);
            if (mission.reqMapsAll) {
                mission.reqMaps.forEach(mp => {
                    if (!held.includes(mp)) { missing.push(`${mp} Map`); met = false; }
                });
            } else if (mission.reqMaps.some(mp => held.includes(mp))) {
                return {
                    success: true,
                    details: { missing: [], canBorrow: this.getBorrowableSkills(playerIndex), mapUsed: true }
                };
            }
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
        if (s.favor) {
            this.awardFavor(playerIndex, s.favor, 'mission', mission.name,
                { file: mission.filename });
        }
        if (s.prestige) player.prestige += s.prestige;
        if (s.gold) player.gold += s.gold;
        // Some successes sting: Usurper and Alchemic Seige print Scorn in the
        // SUCCESS zone (red medallion) — a reward can hurt.
        if (s.scorn) player.scorn += s.scorn;
        // Skill rewards persist in bonusSkills — applySlotSkills rebuilds
        // the tally from scratch, so a direct write here would vanish on
        // the next slider move.
        if (s.skills) {
            if (!player.bonusSkills) player.bonusSkills = {};
            Object.entries(s.skills).forEach(([sk, n]) => {
                player.bonusSkills[sk] = (player.bonusSkills[sk] || 0) + n;
                player.skills[sk] = (player.skills[sk] || 0) + n;
            });
        }
        if (s.mindsEye) player.bonusMindsEye = (player.bonusMindsEye || 0) + s.mindsEye;
        if (s.philosopherStone) {
            // Mission stone rewards stack too (a mission resolves once).
            player.philosopherStone = (player.philosopherStone || 0) + s.philosopherStone;
        }
        if (mission.successSpecial) this.resolveMissionSuccessSpecial(playerIndex, mission);
        this.addLog(`${player.name} completes mission: ${mission.name}`);
    }

    resolveMissionSuccessSpecial(playerIndex, mission) {
        const player = this.players[playerIndex];
        // Scaled mission payouts are MISSION favor. They used to land in the
        // opaque player.favor and surface under Character; the ledger books
        // them to the mission that paid them, so the Missions row shows the
        // real total and the drill-down names the formula (Wyatt 7/19).
        const payMission = (f, formula) => {
            this.awardFavor(playerIndex, f, 'mission', mission.name,
                { file: mission.filename, formula });
            this.addLog(`${player.name}: +${f} Favor (${formula})`);
        };
        switch (mission.successSpecial) {
            case 'favor_per_charisma_x2':
                payMission(2 * (player.skills.charisma || 0), '2 per Charisma');
                break;
            case 'favor_per_knowledge_x1':
                payMission(player.skills.knowledge || 0, '1 per Knowledge');
                break;
            case 'favor_per_minds_eye_x5':
                payMission(5 * this.getMindsEyeCount(playerIndex), "5 per Mind's Eye");
                break;
            case 'philosopher_stone_x2_grant':
                player.philosopherStone = (player.philosopherStone || 0) + 2;
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
            case 'favor_per_philstone_x10':
                // King of the Sky — the one printed mechanic that pays FOR
                // stones. Stones themselves are a requirement resource, never
                // a scoring multiplier (see calculateFinalScores).
                payMission(10 * (player.philosopherStone || 0), "10 per Philosopher's Stone");
                break;
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

    /**
     * "Discard N Cards" mission penalty. In the physical game the OWNER
     * chooses which cards to give up — the old code silently took the N
     * most recent, which could strip exactly the skills the player was
     * keeping for later (how Wyatt lost Her Lost Father's Prospecting).
     * Human: defer to a picker (UI shows it after mission resolution).
     * AI: sacrifice dead weight — protect cards feeding remaining missions,
     * maps, specials, and skill grants.
     */
    /**
     * opts.filter — restrict what may be given up (Archeus takes a WEAPON,
     *   not any played card). Without it, anything on the table is fair game.
     * opts.pend — which pause flag a human seat's deferral lands on, so a
     *   weapon discard and a mission-failure discard cannot be conflated in
     *   one counter (they have different constraints and different prompts).
     */
    penaltyDiscard(playerIndex, n, opts) {
        const filter = opts && opts.filter;
        const pend = (opts && opts.pend) || '_pendingPenaltyDiscard';
        const player = this.players[playerIndex];
        const pool = filter ? player.playedCards.filter(filter) : player.playedCards;
        if (!pool.length) return 0;
        if (playerIndex === 0 || player._remoteHuman) {
            // The FULL debt is recorded, not what they happen to hold right
            // now: the pickers clamp to the cards actually on the table at
            // display time, and a discard owed is still owed.
            player[pend] = (player[pend] || 0) + n;
            return 0;
        }
        const take = Math.min(n, pool.length);
        const needed = new Set();
        (player.missions || []).forEach(m => (m.requirements || []).forEach(r => needed.add(r)));
        const keepScore = (c) =>
            ((c.skills || []).some(sk => needed.has(sk)) ? 100 : 0) +
            (c.grantsMap ? 50 : 0) + (c.special ? 25 : 0) +
            ((c.skills || []).length * 10) + (c.favor || 0);
        const dump = [...pool].sort((a, b) => keepScore(a) - keepScore(b)).slice(0, take);
        return this.discardPlayedCards(playerIndex, c => dump.includes(c), take);
    }

    // Remove played cards (mission failure effects). Their skill grants come
    // off the running tally so requirements/Melee stay truthful.
    discardPlayedCards(playerIndex, filterFn, limit = Infinity) {
        const player = this.players[playerIndex];
        const removed = [];
        for (let i = player.playedCards.length - 1; i >= 0 && removed.length < limit; i--) {
            if (filterFn(player.playedCards[i])) removed.push(...player.playedCards.splice(i, 1));
        }
        if (removed.length) {
            // Full recalc: fixed skills AND flex units (either/or cards)
            // both come off the books together.
            this.applySlotSkills(player);
            this.addLog(`${player.name} discards ${removed.map(c => c.name).join(', ')}`);
            // Hand the CARDS to whoever is measuring this resolution (Wyatt
            // 7/18: "we never got to see which cards he discarded, which is
            // important because otherwise we just see the prestige he gets for
            // it"). Outside a measured resolution there is no ledger and this
            // is a no-op, so every existing caller is untouched -- they all
            // consume the count, which is still what this returns.
            if (this._resLedger) this._resLedger.discarded.push(...removed);
        }
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
            case 'scorn_5_per_knowledge':  player.scorn += 5  * (player.skills.knowledge || 0); break;   // Trust of the Elders (art: 5, not 10)
            case 'prestige_2_per_knowledge': player.prestige += 2 * (player.skills.knowledge || 0); break;
            case 'discard_1_played': this.penaltyDiscard(playerIndex, 1); break;
            case 'discard_5_played': this.penaltyDiscard(playerIndex, 5); break;
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
            case 'discard_power_gain_10_prestige': {
                // Secret Grotto — art reads 10 Prestige per discarded Power card.
                const n = this.discardPlayedCards(playerIndex, c => c.type === 'weapon');
                player.prestige += 10 * n;
                break;
            }
            case 'discard_any_gain_8_prestige_each':
                // A Promise: discard AS MANY of your played cards as you like,
                // +8 Prestige each (art reads 8). The human picks via UI after
                // mission resolution; the AI trades away its low-value cards.
                if (playerIndex === 0 || player._remoteHuman) {
                    player._pendingPromiseDiscard = true;
                } else {
                    const cheap = player.playedCards.filter(c =>
                        !c.special && (c.favor || 0) < 10 && !(c.skills || []).includes('power'));
                    const n = cheap.length
                        ? this.discardPlayedCards(playerIndex, c => cheap.includes(c))
                        : 0;
                    if (n) {
                        player.prestige += PROMISE_PRESTIGE * n;
                        this.addLog(`${player.name} honors A Promise: ${n} card(s) discarded, +${PROMISE_PRESTIGE * n} Prestige`);
                    }
                }
                break;
            case 'fortune_teller_50_prestige': {
                // A CONDITIONAL failure reward. The Labyrinth also carries an
                // EMPTY failurePenalties, so when this gate misses, literally
                // nothing moves -- every measured delta comes back 0 and the
                // ceremony renders a card, a Failed stamp and an empty reward
                // row (Wyatt 7/18: "if someone fails Labyrinth, you don't
                // really see it happen"). Record the gate either way so the
                // beat can state the counterfactual instead of showing nothing.
                const held = player.playedCards.some(c => c.name === 'Fortune Teller');
                if (held) {
                    player.prestige += 50;
                    player.foretoldDoom = true;   // secret achievement: "She Saw It Coming"
                    this.addLog(`${player.name}'s Fortune Teller foresaw this: +50 Prestige!`);
                }
                if (this._resLedger) {
                    this._resLedger.gates.push({
                        card: 'Fortune Teller', met: held, value: 50, unit: 'prestige',
                    });
                }
                break;
            }
            case 'lose_all_prestige_and_scorn':
                this.addLog(`${player.name} loses all Prestige (${player.prestige}) and Scorn (${player.scorn})`);
                player.prestige = 0;
                player.scorn = 0;
                break;
            case 'all_draw_act3_mission': {
                // The Midnight Crash: failing it deals EVERY player an Act 3
                // mission. This used to happen in total silence — a mission
                // appeared in your hand and the only trace was one line in the
                // log (Wyatt: "let the player SEE what mission they got").
                // Record the deal so the ceremony can give it a real beat.
                const drawn = [];
                this.players.forEach(p => {
                    const m = (this.missionDecks[3] || []).shift();
                    if (m) {
                        p.missions.push(m);
                        drawn.push({ playerIndex: p.index, mission: m });
                        this.addLog(`${p.name} draws an Act 3 mission: ${m.name}`);
                    }
                });
                if (drawn.length) {
                    if (!this._missionDraws) this._missionDraws = [];
                    this._missionDraws.push({ source: mission.name, drawn });
                }
                break;
            }
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
        // consume:true — the ONE call that may spend a Guardian's shield.
        const powerTotals = this.players.map((p, i) => ({
            playerIndex: i,
            power: this.calculatePower(i, true),
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
                this.sampleSeatStats(this.players[t.playerIndex]);   // melee pays without touching skills
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

    /**
     * Blind Faith pairings: Heaven's Blade AND Archeus each print
     * "+6 Additional Power if you own Blind Faith" — ONGOING power while
     * both cards are down (both partners owned = +12). It rides missions,
     * card requirements and the skill panel, not just the Melee (Wyatt
     * 7/17: a 15-Power mission must see it, and so must the borrow gate).
     */
    pairingPower(playerIndex) {
        const player = this.players[playerIndex];
        if (!player.playedCards.some(c => c.name === 'Blind Faith')) return 0;
        let bonus = 0;
        player.playedCards.forEach(c => {
            if (c.special === 'power_6_if_blind_faith' || c.name === 'Archeus') bonus += 6;
        });
        return bonus;
    }

    /**
     * A skill as the RULES see it right now — fixed skills plus any
     * ongoing printed bonuses (today: the Blind Faith power pairings).
     * Every requirement check reads through here so a bonus can never
     * count in one phase and vanish in another.
     */
    effectiveSkill(playerIndex, skill) {
        const base = this.players[playerIndex].skills[skill] || 0;
        return skill === 'power' ? base + this.pairingPower(playerIndex) : base;
    }

    /**
     * A seat's Melee Power.
     *
     * ⚠ PURE BY DEFAULT — only resolveMelee passes consume:true.
     * Guardian's "negate the first power reduction" is a one-shot, and
     * spending it is a RULES event that may happen exactly once, at the
     * melee. This used to spend it on EVERY call — and sampleSeatStats,
     * which documents itself as "pure bookkeeping … must never gate a rule
     * or change a score", calls it from applySlotSkills on every card play,
     * slot move and mission reward. So the shield was burned by a telemetry
     * sample the moment any debuff sat on the board, acts before the strike
     * it was bought to survive.
     *
     * A pure read still REPORTS the absorption, including after the melee
     * has spent it (via _throneDefended) — otherwise a Guardian holder read
     * 3 Power at the melee and 0 at scoring, understating their own power on
     * the leaderboard, and powerBreakdown's computedTotal === calculatePower
     * contract quietly broke.
     */
    calculatePower(playerIndex, consume = false) {
        const player = this.players[playerIndex];

        // player.skills.power already includes all power from cards + slider
        // (accumulated by applyCardEffects and applySliderAbilities); the
        // Blind Faith pairing rides through the same ongoing-power helper
        // the mission/requirement probes use — one source, no double count.
        let power = (player.skills.power || 0) + this.pairingPower(playerIndex);

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

            // Defend the Throne: negate the first power reduction. Already
            // spent THIS act means the absorption is history — re-apply it so
            // every later read matches what the melee actually showed.
            const spent = player._throneDefended && player._throneDefended.act === this.currentAct;
            if (totalDebuff < 0 && (player.defendTheThrone || spent)) {
                const absorbed = spent ? player._throneDefended.amount : Math.min(3, -totalDebuff);
                totalDebuff = Math.min(0, totalDebuff + absorbed);
                if (consume && !spent) {
                    player.defendTheThrone = false; // Used up — one strike only
                    // Recorded so powerBreakdown can SHOW the negation truthfully.
                    player._throneDefended = { act: this.currentAct, amount: absorbed };
                }
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

    /**
     * The Melee cinematic's arithmetic — calculatePower, ATTRIBUTED. Pure
     * (no defendTheThrone consumption; it reads what calculatePower already
     * recorded). Contract (js/melee.js): { base, baseOther, baseCards,
     * steps, ownRawTotal, rawTotal, sliderPosition, computedTotal } where
     *   · baseCards = every power-granting played card / completed mission
     *   · steps: bonus / coinflip (won) / attack (hits[] — wounds I DEAL;
     *     wounds I take arrive via the attacker's hits, no step of my own)
     *     / mult (×2, engine applies it last)
     *   · ownRawTotal + wounds-I-take === rawTotal; max(0, rawTotal) ===
     *     computedTotal === calculatePower. The meters lock to these, so
     *     the reveal can never drift from the engine's tally.
     */
    powerBreakdown(playerIndex) {
        const player = this.players[playerIndex];
        const act = this.currentAct;
        const steps = [];
        const base = player.skills.power || 0;
        // ⚠ A card gets ONE face in the melee row. Guardian is the card that
        // exposed this (Wyatt 7/19: "an opponent played two Guardian cards in
        // the same melee"): it grants 2 Power through `skills` AND fires a
        // power `special`, so powerBreakdown emitted its art once as a
        // baseCard and again as the negation step — and melee.js dealt both
        // into the same fighter's row, badged +2 and +3. The engine held
        // exactly one Guardian the whole time; only the display doubled.
        // Heaven's Blade and Dawnharbinger have the identical shape.
        // melee.js already skips art-less steps while still announcing their
        // label and amount, so dropping the second face costs nothing.
        const baseFaces = new Set();
        const artOf = (name) => {
            const c = player.playedCards.find(x => x.name === name);
            if (!c || !c.filename) return null;
            return baseFaces.has(c.filename) ? null : c.filename;
        };

        // Attribute the base: every power-granting played card, every
        // completed mission whose success reward paid power, and
        // baseOther = whatever remains (the character board's slot).
        const baseCards = [];
        player.playedCards.forEach(c => {
            const n = (c.skills || []).filter(s => s === 'power').length;
            if (n > 0) {
                baseCards.push({ name: c.name, filename: c.filename || null, amount: n, mission: false });
                if (c.filename) baseFaces.add(c.filename);
            }
        });
        (player.completedMissions || []).forEach(m => {
            const n = (m.successRewards && m.successRewards.skills && m.successRewards.skills.power) || 0;
            if (n > 0) baseCards.push({ name: m.name, filename: m.filename || null, amount: n, mission: true });
        });
        const baseOther = Math.max(0, base - baseCards.reduce((a, c) => a + c.amount, 0));

        let own = base;

        // Blind Faith pairings (+6 each for Heaven's Blade / Archeus)
        if (player.playedCards.some(c => c.name === 'Blind Faith')) {
            player.playedCards.forEach(c => {
                if (c.special === 'power_6_if_blind_faith' || c.name === 'Archeus') {
                    own += 6;
                    // Same one-face rule — Heaven's Blade also grants 2 Power
                    // through skills, so it already has a baseCard face.
                    steps.push({ kind: 'bonus', label: c.name + ' + Blind Faith', amount: 6,
                        filename: (c.filename && !baseFaces.has(c.filename)) ? c.filename : null });
                }
            });
        }

        // Power bonuses — King of the Sky only if it actually pays (same
        // tie rule as calculatePower). Coin winners are counted here but
        // SHOWN as the live toss below (`coin` tags them out of the steps).
        (player.powerBonuses || []).forEach(bonus => {
            if (bonus.act !== act) return;
            if (bonus.conditional === 'most_survival') {
                const mine = player.skills.survival || 0;
                let hasMost = true;
                for (let i = 0; i < this.playerCount; i++) {
                    if (i !== playerIndex && (this.players[i].skills.survival || 0) >= mine) { hasMost = false; break; }
                }
                if (hasMost && mine > 0) {
                    own += bonus.amount;
                    steps.push({ kind: 'bonus', label: bonus.source || 'Bonus', amount: bonus.amount, filename: artOf(bonus.source) });
                }
            } else {
                own += bonus.amount;
                if (!bonus.coin) steps.push({ kind: 'bonus', label: bonus.source || 'Bonus', amount: bonus.amount, filename: artOf(bonus.source) });
            }
        });

        // Coin flips (Shot of Courage) — a live toss that lands on its real,
        // play-time-decided result. Won flips already added their +4 above.
        (player.coinFlips || []).forEach(flip => {
            if (flip.act !== act) return;
            steps.push({ kind: 'coinflip', label: flip.source || 'Shot of Courage', amount: flip.amount || 4, won: !!flip.won, filename: artOf(flip.source) });
        });

        // Guardian's absorbed strike (recorded by calculatePower at resolve):
        // the wound still flies in full below — this step gives it back.
        if (player._throneDefended && player._throneDefended.act === act && player._throneDefended.amount > 0) {
            own += player._throneDefended.amount;
            steps.push({ kind: 'bonus', label: 'Guardian — negates the strike', amount: player._throneDefended.amount, filename: artOf('Guardian') });
        }

        // Wounds I take (they arrive as the attackers' bolts, not my steps).
        const woundsTaken = (player.powerDebuffs || [])
            .filter(d => d.act === act)
            .reduce((a, d) => a + d.amount, 0);

        // Wounds I DEAL — my attack step fires its bolts at every victim.
        const myAttacks = {};
        for (let i = 0; i < this.playerCount; i++) {
            if (i === playerIndex) continue;
            (this.players[i].powerDebuffs || []).forEach(d => {
                if (d.act !== act || d.from !== playerIndex) return;
                const key = d.source || 'Attack';
                const a = (myAttacks[key] = myAttacks[key] || { label: key, amount: d.amount, hits: [] });
                a.hits.push({ playerIndex: i, delta: d.amount });
            });
        }
        Object.values(myAttacks).forEach(a => {
            steps.push({ kind: 'attack', label: a.label, amount: a.amount, filename: artOf(a.label), hits: a.hits });
        });

        // Power ×2 — the engine applies it LAST (after wounds), so the
        // doubled total is engine truth even for a wounded fighter. The
        // label/art come from whichever played card set the flag.
        const mult = (player.powerX2 === act);
        if (mult) {
            const mc = player.playedCards.find(c => c.special === 'power_x2');
            steps.push({ kind: 'mult', label: mc ? mc.name : 'Power ×2', amount: 2, filename: mc ? (mc.filename || null) : null });
        }

        const rawTotal = (own + woundsTaken) * (mult ? 2 : 1);
        // The lock value: what the fighter's own forge sums to, defined so
        // that ownRawTotal + wounds-shown === rawTotal exactly.
        const ownRawTotal = rawTotal - woundsTaken;

        return {
            base, baseOther, baseCards, steps,
            ownRawTotal, rawTotal,
            sliderPosition: player.sliderPosition,
            computedTotal: Math.max(0, rawTotal)
        };
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
            case 'favor_per_knowledge_x2':
                // Family Ring, exactly as printed: "Favor equal to your total
                // Knowledge x2". Reads the plain skill tally, matching its
                // siblings favor_per_knowledge_x1 and favor_per_survival_x2.
                return 2 * (p.skills.knowledge || 0);
            case 'favor_per_sur_cha_pro':
                return (p.skills.survival || 0) + (p.skills.charisma || 0) + (p.skills.prospecting || 0);
            case 'favor_per_artifact_x8':
                // Sacred Chest, exactly as printed: "8 Favor for each Artifact
                // Card you have" — the purple oval in its Favor medallion is
                // the artifact family, the same grammar as Secret Lab's green
                // oval for potions. It was favor_per_wisdom_x8 until Wyatt
                // caught it on 7/19; nothing in the game counts Wisdom cards.
                // Counts itself — it is an artifact you have.
                return 8 * p.playedCards.filter(c => c.type === 'artifact').length;
            case 'favor_per_potion_x5':
                // Secret Lab, exactly as printed: "5 Favor for each Potions
                // Card you have". It was implemented as +2 Mind's Eye, +2
                // Knowledge and +5 Philosopher's Stones -- a different card
                // entirely, on a card that already REQUIRES 2 Mind's Eye.
                return 5 * p.playedCards.filter(c => c.type === 'potion').length;
            case 'favor_per_neighbor_power': {
                // Effective power — the pairing counts here too.
                return this.effectiveSkill((playerIndex + n - 1) % n, 'power')
                    + this.effectiveSkill((playerIndex + 1) % n, 'power');
            }
            case 'double_adventure_favor':
                // Chemical Y's printed pair bonus: "If you own Chemical X:
                // 15 Favor" (its doubling effect fires at play time).
                return p.playedCards.some(c => c.name === 'Chemical X') ? 15 : 0;
            default:
                return 0;
        }
    }

    calculateFinalScores() {
        return this.players.map((p, i) => {
            // Favor from missions — the printed favorValue on every completed
            // mission PLUS every mission-sourced ledger entry: successRewards
            // favor and the scaled success specials (Golden Fiddle's "2 Favor
            // for Each Charisma", Trust of the Elders' per-Knowledge, King of
            // the Sky's per-stone). Those four missions print favorValue 0 and
            // pay entirely through their special, so a row that read only
            // favorValue scored them at zero and reported "No missions
            // completed for Favor" while the Favor sat in the Character row
            // (Wyatt 7/19).
            let missionFavor = this.favorFromLog(i, 'mission');
            p.completedMissions.forEach(m => {
                if (m.favorValue) missionFavor += m.favorValue;
            });

            // Favor from played cards (static + dynamic), split by family
            // for the score sheet: Adventures / Artifacts / everything else.
            // Chemical Y's chosen adventure counts double (_favorDoubled).
            // Card-sourced ledger entries (the Lost North + Lost South map
            // bonus) book to the family of the card that paid them.
            let advFavor = 0, artFavor = 0, otherCardFavor = 0;
            const addByFamily = (type, f) => {
                if (type === 'adventure') advFavor += f;
                else if (type === 'artifact') artFavor += f;
                else otherCardFavor += f;
            };
            p.playedCards.forEach(card => {
                addByFamily(card.type, (card.favor ? card.favor * (card._favorDoubled ? 2 : 1) : 0)
                    + this.dynamicCardFavor(i, card));
            });
            (p.favorLog || []).forEach(e => { if (e.src === 'card') addByFamily(e.type, e.amount); });
            const cardFavor = advFavor + artFavor + otherCardFavor;

            // The character board — the slot the slider ended on, and nothing
            // else. This row is captioned "your standing on the character
            // board" and now means exactly that; it used to absorb the whole
            // player.favor bucket, which is how a Knowledge mission's payout
            // ended up labelled as a board standing.
            // Anything sitting in player.favor that the ledger can't account
            // for. Nothing in the engine writes player.favor directly any
            // more, but a stray write must never silently vanish from the
            // sheet — an unexplained number is a bug you can SEE, a missing
            // one is a bug you can't. This also keeps the reconciliation
            // invariant total (currentFavor === totalFavor) unconditional.
            const ledgerTotal = (p.favorLog || []).reduce((n, e) => n + e.amount, 0);
            const unattributed = (p.favor || 0) - ledgerTotal;
            let characterFavor = this.favorFromLog(i, 'character') + unattributed;
            const char = p.character;
            if (char && char.slots && char.slots[p.sliderPosition]) {
                const endSlot = char.slots[p.sliderPosition];
                if (endSlot.favor) characterFavor += endSlot.favor;
            }

            // ⚠ REMOVED 7/18 (Wyatt: "that's not a mechanic in the game").
            // Scoring used to convert leftover Gold into Favor at the end of
            // the game: stoneFavor = gold x philosopherStone. NO CARD PRINTS
            // THAT. Every Philosopher's Stone reference on every card is
            // either a REQUIREMENT ("Req: 1 Philosopher's Stone") or a grant
            // of the token itself — the tally is a resource that gates cards
            // and missions, never a scoring multiplier. It was house-ruled in,
            // and once stones started stacking it dominated: in Wyatt's game
            // an AI scored 98 of its 121 points from that one line.
            // The nearest REAL mechanics are printed on specific cards and are
            // untouched: Gold Luster turns your gold into Prestige, and
            // Duplicating Goo doubles your gold.

            // Total score
            const totalFavor = missionFavor + cardFavor + characterFavor;
            const totalPrestige = p.prestige;
            const totalScorn = p.scorn;
            const finalScore = totalFavor + totalPrestige - totalScorn;

            return {
                playerIndex: i,
                name: p.name,
                missionFavor,
                cardFavor,
                advFavor,
                artFavor,
                otherCardFavor,
                characterFavor,
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
            const j = Math.floor(this._rand() * (i + 1));
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
                // Favor the player HOLDS (ledger + card + mission + slot) —
                // what the HUD shows and Req: N Favor reads (Wyatt 7/17).
                favorHeld: this.currentFavor(i),
                // The itemized ledger behind player.favor, so a remote seat's
                // score sheet drills down exactly like a local one.
                favorLog: p.favorLog || [],
                playedCards: p.playedCards,
                missions: p.missions,
                completedMissions: p.completedMissions,
                failedMissions: p.failedMissions,
                handSize: p.hand.length,
                // Only show hand to the owning player
                hand: (forPlayerIndex === i) ? p.hand : null,
                // Displays show what the RULES count — power reads through
                // effectiveSkill so the Blind Faith pairing shows on the
                // panel exactly as missions and requirements will see it.
                skills: { ...p.skills, power: this.effectiveSkill(i, 'power') },
                flexSkills: p.flexSkills || [],
                pendingCard: this.pendingActivations[i] !== null
            })),
            log: this.log.slice(-20)
        };
    }
}

// Export for both browser and Node
if (typeof module !== 'undefined') module.exports = { FavorGame, PHASES, SKILLS, MELEE_REWARDS };
if (typeof window !== 'undefined') {
    window.FavorGame = FavorGame;
    window.PROMISE_PRESTIGE = PROMISE_PRESTIGE;   // ui.js awards A Promise too
}
