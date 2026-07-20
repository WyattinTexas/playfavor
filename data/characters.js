/**
 * FAVOR — Character Board Data (5-Slot System)
 * 10 playable characters, each with a 5-position slider board
 *
 * Slots: 0 (far left) through 4 (far right)
 * Players start at slot 2 (center). Moving costs 5 Gold per space.
 *
 * Each slot can have:
 *   - skills: {} — ongoing skill bonuses while ring is on this slot
 *   - gold: N — gold bonus, paid EVERY time you land on the slot
 *   - favor: N — end-of-game Favor (blue badge value)
 *   - scorn: N — scorn penalty, taken EVERY time you land on the slot
 *   - special: "string" — event effect or ongoing ability
 *   - pickOptions: [] — for "pick_one" specials
 *
 * Rules — the DIGITAL game diverges from print here (Wyatt's call, 2026-07-13):
 *   - Skills are available every turn while ring is at that position
 *   - Rulebook p.10 says "Gold Coins & Events ... are only activated once".
 *     The digital game instead pays a slot out EVERY time you land on it:
 *     the once-per-game gate made a paid slide onto an already-taken coin do
 *     nothing, with no explanation, and it read as a bug.
 *   - The three events a free discard-slide could farm (steal_3_prestige_each,
 *     choose_mission, pick_one) recharge once per ACT — see
 *     SLOT_EVENTS_ONCE_PER_ACT in engine/gameState.js. Everything else re-fires.
 *   - Favor is tallied at end of game based on final ring position
 *   - "The free skill activates immediately each movement"
 *
 * startingGold includes any center-slot gold (e.g. Duchess = 3 base + 5 center = 8)
 *
 * ── Side B (7/19) ────────────────────────────────────────────────────
 * altFilename / altEpithet / altSlots describe the hero's SECOND board,
 * unlocked at hero Level 5 (see docs/FAVOR-XP-SIDEB-SPEC.md). A character
 * without altSlots has no Side B and never shows the badge — the feature
 * ships hero by hero as art lands. Values are read off Wyatt's painted
 * alt boards VERBATIM (masters: ~/Downloads/alt/alt_Character_Boards/) —
 * the print board IS the Side B spec; do not "reconcile" them against
 * Side A's digital retunes. The engine resolves a per-player view at
 * initPlayers ({...base, slots: altSlots, ...}) — the base objects here
 * are shared singletons and are never mutated. Side B startingGold is
 * derived: 3 base + (altSlots[2].gold || 0), center gold pre-claimed.
 *
 * Side B slot specials new with these boards:
 *   - adventure_card_5_prestige: playing an Adventure card pays +5 Prestige
 *   - weapon_card_3_gold:        playing a Weapon card pays +3 Gold
 *   - free_potion_per_round:     1 Potion per round plays FREE — its
 *     requirements AND any gold cost are waived (Wyatt 7/20: "cost" on
 *     this slot reads like the Map grammar, "play the card for no cost")
 *   - alchemy_adds_to_power:     Alchemy total adds to Power while here
 *   - minds_eye_x8:              8 Mind's Eyes (ongoing +8 Knowledge)
 *   - pick_one may now offer specials (minds_eye / philosopher_stone)
 *     alongside skills — Magician B slot 3.
 */

window.FAVOR_DATA = window.FAVOR_DATA || {};

window.FAVOR_DATA.characters = [
    {
        id: "explorer",
        name: "Explorer",
        filename: "Explorer.jpg",
        difficulty: 2,
        epithet: "Renaissance Man",
        tip: "Know your opponents' Power.",
        subtitle: "Renaissance Man",
        startingGold: 3,
        slots: [
            { favor: 9, skills: { power: 3 } },
            { gold: 4, skills: { prospecting: 3 } },
            { skills: { survival: 2 } },                        // center — start
            { special: "minds_eye" },
            { favor: 15, special: "philosopher_stone" }
        ],
        altFilename: "Explorer_B.jpg",
        altEpithet: "Trailblazer",
        altSlots: [
            { favor: 15, special: "philosopher_stone" },
            { gold: 2, skills: { prospecting: 2 } },
            { skills: { survival: 1 } },                        // center — start
            { skills: { survival: 4 } },
            { skills: { survival: 3, power: 3 } }
        ]
    },
    {
        id: "knight",
        name: "Knight",
        filename: "Knight.jpg",
        difficulty: 2,
        epithet: "Deadly Duelist",
        tip: "A Skillful Knight gets the Glory.",
        subtitle: "Deadly Duelist",
        startingGold: 3,
        slots: [
            { favor: 18 },
            { gold: 4 },
            { skills: { power: 1 } },                           // center — start
            { skills: { knowledge: 3 } },
            { skills: { power: 5 } }
        ],
        altFilename: "Knight_B.jpg",
        altEpithet: "Oathbreaker",                              // locked in the spec
        altSlots: [
            { skills: { knowledge: 3, power: 3 } },
            { skills: { survival: 2 } },
            { skills: { power: 2 } },                           // center — start
            { favor: 8 },
            { scorn: 15, skills: { power: 7 } }                 // the gambit slot
        ]
    },
    {
        id: "bandit",
        name: "Bandit",
        filename: "Bandit.jpg",
        difficulty: 4,
        epithet: "Opportunist",
        tip: "Scorn can be a Strength.",
        subtitle: "Opportunist",
        startingGold: 3,
        slots: [
            { scorn: 5, special: "steal_3_prestige_each" },
            { scorn: 5, special: "steal_2_gold_each" },
            { skills: { power: 2 } },                           // center — start
            { gold: 8 },
            { special: "philosopher_stone_x2" }
        ],
        altFilename: "Bandit_B.jpg",
        altEpithet: "Highwayman",
        altSlots: [
            { skills: { power: 3 }, special: "steal_2_gold_each" },
            { skills: { charisma: 2 } },
            { skills: { survival: 1 } },                        // center — start
            { special: "adventure_card_5_prestige" },
            { gold: 7 }
        ]
    },
    {
        id: "merchant",
        name: "Merchant",
        filename: "Merchant.jpg",
        difficulty: 3,
        epithet: "Ultimate Trader",
        tip: "Steady Plotting brings Prosperity.",
        subtitle: "Ultimate Trader",
        startingGold: 3,
        slots: [
            { gold: 5, special: "philosopher_stone" },
            { gold: 5, skills: { prospecting: 5 } },
            { special: "borrow_any_player" },                    // center — start
            { special: "convert_gold_to_prestige", skills: { charisma: 4 } },
            { gold: 7, favor: 10 }
        ],
        altFilename: "Merchant_B.jpg",
        altEpithet: "Guildmaster",
        altSlots: [
            // The up-arrow ringed by the four skill minis = TRADE WITH
            // ANYONE (Wyatt's audit 7/20) — the same borrow_any_player his
            // Side A center carries, not a skill grant.
            { gold: 5, special: "borrow_any_player" },
            { gold: 7, skills: { prospecting: 3 } },
            { special: "weapon_card_3_gold" },                   // center — start
            { favor: 10 },
            { skills: { charisma: 5 }, special: "convert_gold_to_prestige" }
        ]
    },
    {
        id: "fisherman",
        name: "Fisherman",
        filename: "Fisherman.jpg",
        difficulty: 2,
        epithet: "The Mindful",
        tip: "Go fishin' for a Mission.",
        subtitle: "The Mindful",
        startingGold: 3,
        slots: [
            { favor: 12, special: "philosopher_stone" },
            { skills: { prospecting: 3, charisma: 4 } },
            { skills: { survival: 1 } },                        // center — start
            { skills: { knowledge: 3 } },
            { skills: { survival: 8 } }
        ],
        altFilename: "Fisherman_B.jpg",
        altEpithet: "The Far-Seeing",
        altSlots: [
            { special: "minds_eye_x8" },
            { skills: { knowledge: 4 } },
            { skills: { survival: 2 } },                        // center — start
            { skills: { charisma: 5 } },
            { skills: { survival: 6 } }
        ]
    },
    {
        id: "duchess",
        name: "Duchess",
        filename: "Duchess.jpg",
        difficulty: 3,
        epithet: "Philanthropist",
        tip: "Your Generosity will be Rewarded.",
        subtitle: "Philanthropist",
        startingGold: 8,                                         // 3 base + 5 center gold
        slots: [
            { gold: 12, special: "give_1_gold_each" },
            { skills: { knowledge: 4 } },
            { gold: 5 },                                         // center — start (gold pre-claimed)
            { skills: { prospecting: 4 } },
            { favor: 16, special: "all_others_1_scorn" }
        ],
        altFilename: "Duchess_B.jpg",
        altEpithet: "Velvet Glove",
        altSlots: [
            { skills: { knowledge: 10 }, special: "give_1_gold_each" },
            { special: "all_others_1_scorn" },
            { gold: 3 },                                         // center — start (gold pre-claimed)
            { skills: { prospecting: 6 } },
            { favor: 16 }
        ]
    },
    {
        id: "scientist",
        name: "Scientist",
        filename: "Scientist.jpg",
        difficulty: 4,
        epithet: "Grandmaster Alchemist",
        tip: "Nothing in life is Free.",
        subtitle: "Grandmaster Alchemist",
        startingGold: 3,
        slots: [
            { special: "minds_eye", skills: { knowledge: 8 } },
            { special: "philosopher_stone" },
            { skills: { knowledge: 2 } },                       // center — start
            { skills: { alchemy: 6 } },
            { favor: 14 }
        ],
        altFilename: "Scientist_B.jpg",
        altEpithet: "Transmuter",
        altSlots: [
            { skills: { prospecting: 3 }, special: "philosopher_stone" },
            { special: "alchemy_adds_to_power" },
            { skills: { knowledge: 1 } },                       // center — start
            { skills: { alchemy: 4 } },
            { scorn: 10, skills: { knowledge: 12 } }
        ]
    },
    {
        id: "doctor",
        name: "Doctor",
        filename: "Doctor.jpg",
        difficulty: 2,
        epithet: "Medical Expert",
        tip: "Just before dusk, Alchemy you may Trust.",
        subtitle: "Medical Expert",
        startingGold: 3,
        slots: [
            { favor: 13, gold: 3 },
            { skills: { survival: 3 } },
            { skills: { alchemy: 1 } },                         // center — start
            { gold: 4, skills: { knowledge: 3 } },
            { skills: { alchemy: 5, knowledge: 5 } }
        ],
        altFilename: "Doctor_B.jpg",
        altEpithet: "Apothecary",
        altSlots: [
            { favor: 15 },
            { skills: { knowledge: 4 } },
            { skills: { alchemy: 2 } },                         // center — start
            { skills: { knowledge: 4 }, special: "minds_eye" },
            { special: "free_potion_per_round" }
        ]
    },
    {
        id: "fiddler",
        name: "Fiddler",
        filename: "Fiddler.jpg",
        difficulty: 5,
        epithet: "The Wildcard",
        tip: "The Key is in the Cards.",
        subtitle: "The Wildcard",
        startingGold: 3,
        slots: [
            { gold: 5, skills: { charisma: 16 } },
            { special: "minds_eye_x5" },
            { skills: { charisma: 2 } },                        // center — start
            { gold: 2, special: "mission_fail_10_gold" },
            { favor: 12, skills: { knowledge: 2 } }
        ],
        altFilename: "Fiddler_B.jpg",
        altEpithet: "Firebrand",
        altSlots: [
            { scorn: 20, skills: { alchemy: 4 } },              // the high-roller slot
            { skills: { charisma: 10 } },
            { skills: { charisma: 1 } },                        // center — start
            { gold: 6 },
            { favor: 20 }
        ]
    },
    {
        id: "magician",
        name: "Magician",
        filename: "Magician.jpg",
        difficulty: 4,
        epithet: "Virtuoso",
        tip: "Make the Impossible Possible.",
        subtitle: "Virtuoso",
        startingGold: 3,
        slots: [
            { gold: 3, skills: { knowledge: 5 } },
            { special: "choose_mission" },
            { skills: { charisma: 1 } },                        // center — start
            { special: "pick_one",
              pickOptions: ["survival", "charisma", "prospecting", "alchemy"] },
            { special: "minds_eye_and_philosopher" }
        ],
        altFilename: "Magician_B.jpg",
        altEpithet: "Illusionist",
        altSlots: [
            { skills: { charisma: 6, knowledge: 5 } },
            { skills: { alchemy: 3 } },
            { skills: { charisma: 2 } },                        // center — start
            { special: "pick_one",
              pickOptions: ["minds_eye", "philosopher_stone", "knowledge", "power"] },
            { special: "choose_mission" }
        ]
    }
];
