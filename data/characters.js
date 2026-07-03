/**
 * FAVOR — Character Board Data (5-Slot System)
 * 10 playable characters, each with a 5-position slider board
 *
 * Slots: 0 (far left) through 4 (far right)
 * Players start at slot 2 (center). Moving costs 5 Gold per space.
 *
 * Each slot can have:
 *   - skills: {} — ongoing skill bonuses while ring is on this slot
 *   - gold: N — one-time gold bonus (activated once when arriving)
 *   - favor: N — end-of-game Favor (blue badge value)
 *   - scorn: N — one-time scorn penalty (activated once when arriving)
 *   - special: "string" — one-time event effect or ongoing ability
 *   - pickOptions: [] — for "pick_one" specials
 *
 * Rules (from rulebook p.10):
 *   - Skills are available every turn while ring is at that position
 *   - Gold, Scorn & Events activate ONLY ONCE (tracked by claimedSlots)
 *   - Favor is tallied at end of game based on final ring position
 *   - "The free skill activates immediately each movement"
 *
 * startingGold includes any center-slot gold (e.g. Duchess = 3 base + 5 center = 8)
 */

window.FAVOR_DATA = window.FAVOR_DATA || {};

window.FAVOR_DATA.characters = [
    {
        id: "explorer",
        name: "Explorer",
        filename: "Explorer.jpg",
        difficulty: 2,
        tip: "Know your opponents' Power.",
        subtitle: "Renaissance Man",
        startingGold: 3,
        slots: [
            { favor: 9, skills: { power: 3 } },
            { gold: 4, skills: { prospecting: 3 } },
            { skills: { survival: 2 } },                        // center — start
            { special: "minds_eye" },
            { favor: 15, special: "philosopher_stone" }
        ]
    },
    {
        id: "knight",
        name: "Knight",
        filename: "Knight.jpg",
        difficulty: 2,
        tip: "A Skillful Knight gets the Glory.",
        subtitle: "Deadly Duelist",
        startingGold: 3,
        slots: [
            { favor: 18 },
            { gold: 4 },
            { skills: { power: 1 } },                           // center — start
            { skills: { knowledge: 3 } },
            { skills: { power: 5 } }
        ]
    },
    {
        id: "bandit",
        name: "Bandit",
        filename: "Bandit.jpg",
        difficulty: 3,
        tip: "Scorn can be a Strength.",
        subtitle: "Opportunist",
        startingGold: 3,
        slots: [
            { scorn: 5, special: "steal_3_prestige_each" },
            { scorn: 5, special: "steal_2_gold_each" },
            { skills: { power: 2 } },                           // center — start
            { gold: 8 },
            { special: "philosopher_stone_x2" }
        ]
    },
    {
        id: "merchant",
        name: "Merchant",
        filename: "Merchant.jpg",
        difficulty: 3,
        tip: "Steady Plotting brings Prosperity.",
        subtitle: "Ultimate Trader",
        startingGold: 3,
        slots: [
            { gold: 5, special: "philosopher_stone" },
            { gold: 5, skills: { prospecting: 5 } },
            { special: "borrow_any_player" },                    // center — start
            { special: "convert_gold_to_prestige", skills: { charisma: 4 } },
            { gold: 7, favor: 10 }
        ]
    },
    {
        id: "fisherman",
        name: "Fisherman",
        filename: "Fisherman.jpg",
        difficulty: 2.5,
        tip: "Go fishin' for a Mission.",
        subtitle: "The Mindful",
        startingGold: 3,
        slots: [
            { favor: 12, special: "philosopher_stone" },
            { skills: { prospecting: 3, charisma: 4 } },
            { skills: { survival: 1 } },                        // center — start
            { skills: { knowledge: 3 } },
            { skills: { survival: 8 } }
        ]
    },
    {
        id: "duchess",
        name: "Duchess",
        filename: "Duchess.jpg",
        difficulty: 2.5,
        tip: "Your Generosity will be Rewarded.",
        subtitle: "Philanthropist",
        startingGold: 8,                                         // 3 base + 5 center gold
        slots: [
            { gold: 12, special: "give_1_gold_each" },
            { skills: { knowledge: 4 } },
            { gold: 5 },                                         // center — start (gold pre-claimed)
            { skills: { prospecting: 4 } },
            { favor: 16, special: "all_others_1_scorn" }
        ]
    },
    {
        id: "scientist",
        name: "Scientist",
        filename: "Scientist.jpg",
        difficulty: 3,
        tip: "Nothing in life is Free.",
        subtitle: "Grandmaster Alchemist",
        startingGold: 3,
        slots: [
            { special: "minds_eye", skills: { knowledge: 8 } },
            { special: "philosopher_stone" },
            { skills: { knowledge: 2 } },                       // center — start
            { skills: { alchemy: 6 } },
            { favor: 14 }
        ]
    },
    {
        id: "doctor",
        name: "Doctor",
        filename: "Doctor.jpg",
        difficulty: 3,
        tip: "Just before dusk, Alchemy you may Trust.",
        subtitle: "Medical Expert",
        startingGold: 3,
        slots: [
            { favor: 13, gold: 3 },
            { skills: { survival: 3 } },
            { skills: { alchemy: 1 } },                         // center — start
            { gold: 4, skills: { knowledge: 3 } },
            { skills: { alchemy: 5, knowledge: 5 } }
        ]
    },
    {
        id: "fiddler",
        name: "Fiddler",
        filename: "Fiddler.jpg",
        difficulty: 4,
        tip: "The Key is in the Cards.",
        subtitle: "The Wildcard",
        startingGold: 3,
        slots: [
            { gold: 5, skills: { charisma: 16 } },
            { special: "minds_eye_x5" },
            { skills: { charisma: 2 } },                        // center — start
            { gold: 2, special: "mission_fail_10_gold" },
            { favor: 12, skills: { knowledge: 2 } }
        ]
    },
    {
        id: "magician",
        name: "Magician",
        filename: "Magician.jpg",
        difficulty: 3,
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
        ]
    }
];
