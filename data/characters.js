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
 *   - special: "string" — one-time event effect
 *   - pickOptions: [] — for "pick_one" specials
 *
 * Rules (from rulebook p.10):
 *   - Skills are available every turn while ring is at that position
 *   - Gold & Events activate ONLY ONCE (tracked by claimedSlots)
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
            { favor: 10, skills: { power: 1 } },
            { gold: 4, skills: { charisma: 3 } },
            { skills: { survival: 1 } },                    // center — start
            { skills: { knowledge: 2 } },
            { favor: 15, skills: { alchemy: 1 } }
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
            { favor: 22 },
            { gold: 5 },
            { },                                              // center — start
            { skills: { knowledge: 2 } },
            { skills: { power: 4 } }
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
            { special: "steal_2_prestige_each" },
            { special: "steal_1_gold_each" },
            { skills: { power: 1 } },                        // center — start
            { gold: 8 },
            { skills: { alchemy: 3 } }
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
            { gold: 5, skills: { alchemy: 1 } },
            { skills: { charisma: 2 } },
            { skills: { prospecting: 1 },                    // center — start
              special: "convert_gold_to_prestige" },
            { favor: 15 },
            { gold: 7 }
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
            { favor: 12 },
            { skills: { alchemy: 1 } },
            { skills: { charisma: 3 } },                     // center — start
            { skills: { survival: 5 } },
            { favor: 15 }
        ]
    },
    {
        id: "duchess",
        name: "Duchess",
        filename: "Duchess.jpg",
        difficulty: 2.5,
        tip: "Your Generosity will be Rewarded.",
        subtitle: "Philanthropist",
        startingGold: 8,                                      // 3 base + 5 center gold
        slots: [
            { favor: 12, special: "give_1_gold_each" },
            { skills: { knowledge: 2 } },
            { gold: 5 },                                      // center — start (gold pre-claimed)
            { skills: { charisma: 4 } },
            { favor: 18, special: "all_others_1_scorn" }
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
            { special: "minds_eye", skills: { knowledge: 5 } },
            { skills: { alchemy: 1 } },
            { skills: { knowledge: 1 } },                    // center — start
            { special: "philosopher_stone", skills: { knowledge: 5 } },
            { favor: 18 }
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
            { favor: 15, gold: 3 },
            { skills: { survival: 3 } },
            { skills: { alchemy: 1 } },                      // center — start
            { gold: 5 },
            { special: "philosopher_stone", skills: { knowledge: 3 } }
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
        specialNote: "Failing any Mission Grants 10 Gold",
        slots: [
            { gold: 5 },
            { skills: { charisma: 15 } },
            { special: "minds_eye", skills: { knowledge: 2 } }, // center — start
            { skills: { charisma: 2 } },
            { favor: 16 }
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
            { gold: 8, skills: { knowledge: 3 } },
            { skills: { prospecting: 3 } },
            { skills: { charisma: 1 } },                     // center — start
            { special: "pick_one",
              pickOptions: ["survival", "charisma", "alchemy", "knowledge"] },
            { special: "minds_eye", skills: { alchemy: 1 } }
        ]
    }
];
