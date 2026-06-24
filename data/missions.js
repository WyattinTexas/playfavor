/**
 * FAVOR — Mission Card Database
 * 36 total: 12 per Act
 * Each mission has requirements, activation round, success rewards, failure penalties
 */

window.FAVOR_DATA = window.FAVOR_DATA || {};

let _mid = 1;
function mid() { return _mid++; }

window.FAVOR_DATA.missions = [

    // ═══════════════════════════════════════════════════════════
    // ACT 1 MISSIONS (12 cards) — Activate Round 1 or 2
    // ═══════════════════════════════════════════════════════════

    { id: mid(), name: "The Minister's Plan", filename: "Act 1_The Minister_s Plan Card.jpg",
      act: 1, activationRound: 2, favorValue: 15,
      requirements: ["alchemy", "knowledge"],
      successRewards: { favor: 5, prestige: 5 },
      failurePenalties: { scorn: 5 },
      flavorText: "Facing the River Fiend" },

    { id: mid(), name: "A Day With the Birds", filename: "Act 1_A Day With the Birds Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["survival", "charisma"],
      successRewards: { favor: 5, gold: 3 },
      failurePenalties: { scorn: 3 } },

    { id: mid(), name: "Burst of Fulfillment", filename: "Act 1_Burst of Fulfillment Card.jpg",
      act: 1, activationRound: 1, favorValue: 8,
      requirements: ["charisma"],
      successRewards: { favor: 5, prestige: 3 },
      failurePenalties: { scorn: 2 } },

    { id: mid(), name: "Helping the Merchant", filename: "Act 1_Helping the Merchant Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["prospecting", "charisma"],
      successRewards: { favor: 5, gold: 5 },
      failurePenalties: { scorn: 3 } },

    { id: mid(), name: "Protecting Family", filename: "Act 1_Protecting Family Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["power", "survival"],
      successRewards: { favor: 5, prestige: 3 },
      failurePenalties: { scorn: 3 } },

    { id: mid(), name: "Talking Thomas", filename: "Act 1_Talking Thomas Card.jpg",
      act: 1, activationRound: 1, favorValue: 8,
      requirements: ["knowledge"],
      successRewards: { favor: 5, gold: 3 },
      failurePenalties: { scorn: 2 } },

    { id: mid(), name: "Taming a Dragon", filename: "Act 1_Taming a Dragon Card.jpg",
      act: 1, activationRound: 1, favorValue: 12,
      requirements: ["survival", "power"],
      successRewards: { favor: 5, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Testament to Courage", filename: "Act 1_Testament to Courage Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["power", "charisma"],
      successRewards: { favor: 5, prestige: 3 },
      failurePenalties: { scorn: 3 } },

    { id: mid(), name: "The Door Knob", filename: "Act 1_The Door Knob Card.jpg",
      act: 1, activationRound: 1, favorValue: 8,
      requirements: ["knowledge", "prospecting"],
      successRewards: { favor: 5, gold: 3 },
      failurePenalties: { scorn: 2 } },

    { id: mid(), name: "The Midnight Crash", filename: "Act 1_The Midnight Crash Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["survival", "alchemy"],
      successRewards: { favor: 5, gold: 3 },
      failurePenalties: { scorn: 3 } },

    { id: mid(), name: "Trust of the Elders", filename: "Act 1_Trust of the Elders Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["knowledge", "charisma"],
      successRewards: { favor: 5, prestige: 3 },
      failurePenalties: { scorn: 3 } },

    { id: mid(), name: "Tunnel of Trinkets", filename: "Act 1_Tunnel of Trinkets Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["prospecting", "survival"],
      successRewards: { favor: 5, gold: 5 },
      failurePenalties: { scorn: 3 } },

    // ═══════════════════════════════════════════════════════════
    // ACT 2 MISSIONS (12 cards) — Activate Round 2 or 3
    // ═══════════════════════════════════════════════════════════

    { id: mid(), name: "A Dance with Dragons", filename: "Act 2_A Dance with Dragons Card.jpg",
      act: 2, activationRound: 2, favorValue: 20,
      requirements: ["power", "survival", "alchemy"],
      successRewards: { favor: 10, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "A Surprise Light in the Night", filename: "Act 2_A Surprise Light in the Night Card.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["knowledge", "alchemy"],
      successRewards: { favor: 8, gold: 5 },
      failurePenalties: { scorn: 4 } },

    { id: mid(), name: "Facing the Hard Truth", filename: "Act 2_Facing the Hard Truth Card.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["knowledge", "charisma"],
      successRewards: { favor: 8, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Ghosts in the Mirror", filename: "Act 2_Ghosts in the Mirror Card.jpg",
      act: 2, activationRound: 2, favorValue: 18,
      requirements: ["knowledge", "alchemy", "survival"],
      successRewards: { favor: 10, prestige: 3 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Hogsmade Holdup", filename: "Act 2_Hogsmade Holdup Card.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["power", "prospecting"],
      successRewards: { favor: 8, gold: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Hogwarts Valedictorian", filename: "Act 2_Hogwarts Valdictorian Card.jpg",
      act: 2, activationRound: 2, favorValue: 18,
      requirements: ["knowledge", "knowledge"],
      successRewards: { favor: 10, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Negotiations with Villains", filename: "Act 2_Negotiations with Villains Card.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["charisma", "power"],
      successRewards: { favor: 8, prestige: 3 },
      failurePenalties: { scorn: 4 } },

    { id: mid(), name: "Protecting Family II", filename: "Act 2_Protecting Family Card copy.jpg",
      act: 2, activationRound: 2, favorValue: 18,
      requirements: ["power", "survival", "charisma"],
      successRewards: { favor: 10, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Rescuing the Soon to be Devoured", filename: "Act 2_Rescuing the Soon to be Devoured Card.jpg",
      act: 2, activationRound: 2, favorValue: 18,
      requirements: ["power", "survival"],
      successRewards: { favor: 10, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Teaching a Natural", filename: "Act 2_Teaching a Natural Card.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["knowledge", "charisma"],
      successRewards: { favor: 8, prestige: 3 },
      failurePenalties: { scorn: 4 } },

    { id: mid(), name: "To Believe in Someone", filename: "Act 2_To Believe in Someone Card.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["charisma", "survival"],
      successRewards: { favor: 8, gold: 5 },
      failurePenalties: { scorn: 4 } },

    { id: mid(), name: "Facing the Hard Truth (copy)", filename: "Act 2_Facing the Hard Truth Card copy.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["knowledge", "charisma"],
      successRewards: { favor: 8, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    // ═══════════════════════════════════════════════════════════
    // ACT 3 MISSIONS (12 cards) — Activate Round 3
    // ═══════════════════════════════════════════════════════════

    { id: mid(), name: "Burst of Fulfillment III", filename: "Act 3_Burst of Fulfillment Card.jpg",
      act: 3, activationRound: 3, favorValue: 25,
      requirements: ["charisma", "charisma", "knowledge"],
      successRewards: { favor: 15, prestige: 10 },
      failurePenalties: { scorn: 8 } },

    { id: mid(), name: "Capturing the Golden Horcrux", filename: "Act 3_Capturing of the Golden Horcrux Card.jpg",
      act: 3, activationRound: 3, favorValue: 30,
      requirements: ["knowledge", "alchemy", "prospecting"],
      successRewards: { favor: 20, prestige: 10 },
      failurePenalties: { scorn: 10 } },

    { id: mid(), name: "Fiery Pillaging", filename: "Act 3_Fiery Pillaging Card.jpg",
      act: 3, activationRound: 3, favorValue: 25,
      requirements: ["power", "power", "survival"],
      successRewards: { favor: 15, prestige: 10 },
      failurePenalties: { scorn: 8 } },

    { id: mid(), name: "Honoring a Fallen Friend", filename: "Act 3_Honoring a Fallen Friend Card.jpg",
      act: 3, activationRound: 3, favorValue: 25,
      requirements: ["charisma", "knowledge", "survival"],
      successRewards: { favor: 15, prestige: 5 },
      failurePenalties: { scorn: 8 } },

    { id: mid(), name: "Passing the Mirror Gate", filename: "Act 3_Passing the Mirror Gate Card.jpg",
      act: 3, activationRound: 3, favorValue: 28,
      requirements: ["knowledge", "alchemy", "survival"],
      successRewards: { favor: 18, prestige: 10 },
      failurePenalties: { scorn: 10 } },

    { id: mid(), name: "Rescuing the Devoured III", filename: "Act 3_Rescuing the Soon to be Devoured Card copy.jpg",
      act: 3, activationRound: 3, favorValue: 25,
      requirements: ["power", "survival", "charisma"],
      successRewards: { favor: 15, prestige: 10 },
      failurePenalties: { scorn: 8 } },

    { id: mid(), name: "Singing a Farewell Together", filename: "Act 3_Singing a Farewell Together Card.jpg",
      act: 3, activationRound: 3, favorValue: 22,
      requirements: ["charisma", "charisma"],
      successRewards: { favor: 12, prestige: 5 },
      failurePenalties: { scorn: 7 } },

    { id: mid(), name: "Solving the Forest Puzzle", filename: "Act 3_Solving the Forest Puzzle Card.jpg",
      act: 3, activationRound: 3, favorValue: 25,
      requirements: ["knowledge", "survival", "alchemy"],
      successRewards: { favor: 15, prestige: 5 },
      failurePenalties: { scorn: 8 } },

    { id: mid(), name: "Solving the Riddle", filename: "Act 3_Solving the Riddle Card.jpg",
      act: 3, activationRound: 3, favorValue: 22,
      requirements: ["knowledge", "knowledge"],
      successRewards: { favor: 12, prestige: 10 },
      failurePenalties: { scorn: 7 } },

    { id: mid(), name: "Splitting Personalities", filename: "Act 3_Splitting Personalities Card.jpg",
      act: 3, activationRound: 3, favorValue: 25,
      requirements: ["alchemy", "knowledge", "charisma"],
      successRewards: { favor: 15, prestige: 5 },
      failurePenalties: { scorn: 8 } },

    { id: mid(), name: "Taking on Wizard Outlaws", filename: "Act 3_Taking on Wizard Outlaws Card.jpg",
      act: 3, activationRound: 3, favorValue: 28,
      requirements: ["power", "power", "knowledge"],
      successRewards: { favor: 18, prestige: 10 },
      failurePenalties: { scorn: 10 } },

    { id: mid(), name: "World Cup Champions", filename: "Act 3_World Cup Champions Card.jpg",
      act: 3, activationRound: 3, favorValue: 30,
      requirements: ["power", "power", "charisma"],
      successRewards: { favor: 20, prestige: 15 },
      failurePenalties: { scorn: 10 } },
];

console.log(`[FAVOR] Loaded ${window.FAVOR_DATA.missions.length} mission cards`);
