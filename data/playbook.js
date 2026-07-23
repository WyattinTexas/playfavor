// ═══ FAVOR — the Hard AI's playbook (v1, hand-authored) ═════════════════════
//
// Tunable tables the Hard brain (js/ai.js, FAI) reads. Phase 3 of the
// Hard-AI program regenerates this file FROM RECORDED PLAYER DATA
// (tools/build-playbook.mjs) — until then every number here is a designer
// guess, chosen to be sane rather than optimal. The playbook is code:
// changes here change AI behavior on every client ⇒ MPV bump when touched.
//
// Determinism: everything below is a constant. FAI must stay pure — no
// randomness, no clocks — so lockstep multiplayer can simulate Hard seats
// identically on every client.
window.FAVOR_PLAYBOOK = {
    v: 1,

    // What a Gold is worth in expected final points, by act. Gold buys
    // slides (5g/space), borrows (2g/unit) and card costs early; by Act 3
    // most of it will never convert to score (tiebreak aside) unless a
    // convert line exists.
    goldRate: { 1: 0.45, 2: 0.3, 3: 0.15 },

    // Mirror of the engine's MELEE_REWARDS (module-scoped there, unreadable
    // from the browser). audit: engine/gameState.js ~28 — keep in sync.
    meleeRewards: {
        1: { 1: 5, 2: 3, 3: 1 },
        2: { 1: 15, 2: 5, 3: 3 },
        3: { 1: 30, 2: 15, 3: 5 },
    },
    // Confidence that today's power ranking still holds at the melee —
    // early in an act everyone still has cards to land.
    meleeConfidence: { 1: 0.6, 2: 0.7, 3: 0.8 },
    // Power is CUMULATIVE — a unit landed in Act 1 fights all three
    // melees (5/15/30 pools), so early power multiplies.
    meleeFutureWeight: { 1: 2.2, 2: 1.6, 3: 1 },

    // Requirement-token unit worth (they gate the best Act-3 cards and
    // several missions): Philosopher's Stones appear in 9 requirement
    // lines + favor_per_philstone_x10; Mind's Eyes in 8.
    stoneValue: 3.5,
    eyeValue: 2.5,

    // A skill unit's floor value even when nothing in sight needs it —
    // requirements keep coming (act decks + mission flips).
    skillBaseValue: 0.35,

    // How much of a still-unmet card/mission's value one enabling unit
    // carries, by how many units short the requirement still is.
    enablementByGap: { 1: 0.55, 2: 0.3, 3: 0.15 },

    // End-slot favor pays only if you END the game there — weight by act.
    slotFavorWeight: { 1: 0.15, 2: 0.5, 3: 0.9 },

    // Growth headroom for favor_per_* formulas: expected further growth of
    // a focused skill between now and scoring, by act.
    skillGrowth: { 1: 5, 2: 3, 3: 1 },

    // Relative-harm/help factor: a point moved on an opponent is worth
    // this much of a point on yourself (placement is what's scored).
    rivalWeight: 0.5,

    // Paid-slide planner: minimum net points before the ring moves, and
    // the most paid spaces one activation will buy.
    slideThreshold: 1.2,
    slideMaxSteps: 2,

    // Slot specials the planner can price (per landing / while parked).
    slotSpecialValue: {
        philosopher_stone: 3.5, philosopher_stone_x2: 6,
        minds_eye: 2.5, minds_eye_x5: 4, minds_eye_and_philosopher: 6,
        choose_mission: 5, pick_one: 3,
        borrow_any_player: 2, convert_gold_to_prestige: 2,
        steal_3_prestige_each: 4, steal_2_gold_each: 1.5,
        give_1_gold_each: -1, all_others_1_scorn: 1,
        mission_fail_10_gold: 1,
    },

    // Map chains: owning the named Map unlocks the listed follow-cards
    // (reqMaps) — worth a slice of what they pay. Hand-priced by chain
    // depth; Phase 3 can learn these.
    mapChainValue: {
        'Finding the Lost Corridor': 8,   // → Reunited (22 Favor)
        'Her Lost Father': 6,             // → Finding the Lost Corridor → Reunited
        'The Minister\'s Plan': 5,        // → Facing the River Fiend (15 Favor)
        'Great North Connection': 4,      // → Market Trade Exchange
        'The Shadow Guide': 3, 'Reunited': 0, 'Golden Fiddle': 4,
        'Lost North Map': 5,              // pairs +20 with Lost South
        'A Hidden Door': 3, 'Forgotten Temple': 4,   // → Sacred Chest cost waiver
        'Sacred Chest': 4, 'Dawnharbinger': 2, 'Guardian': 2,
        'King of the Sky': 2, 'Defend the Throne': 2,
        'Moment of Reflection': 3, 'Man\'s Best Friend': 3,
        'Cameron\'s Expedition': 2, 'Tunnel of Trinkets': 2,
        'Helping the Merchant': 2, 'The Magic Fiddle': 3,
    },

    // Where each hero wants the ring parked, act → slot (0-4). PRIORS, not
    // rules — the evaluator can override when the table says otherwise.
    // Canonical entry (Wyatt): Fisherman Act 3 → slot 4 (Survival 8; play
    // Fang's Truce from there). Phase 3 replaces these with data.
    parkTargets: {
        explorer: { 3: 4 },              // Favor 15 + Stone
        knight: { 3: 0 },                // Favor 18
        bandit: { 3: 4 },                // Stones ×2
        merchant: { 3: 4 },              // Gold 7 + Favor 10
        fisherman: { 3: 4 },             // Survival 8 — the canonical park
        duchess: { 3: 4 },               // Favor 16
        scientist: { 1: 0, 3: 4 },       // Knowledge 8 early; Favor 14 late
        doctor: { 3: 0 },                // Favor 13 + Gold 3
        fiddler: { 1: 0, 3: 4 },         // Charisma 16 early; Favor 12 late
        magician: { 3: 4 },              // Eye + Stone
    },
    parkPriorBonus: 5,
};
