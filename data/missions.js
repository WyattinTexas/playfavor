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

    { id: mid(), name: "The Minister's Plan", grantsMap: "Facing the River Fiend", audit: "Success Req: 15 Gold & 1 Prospecting, Act 2 OR Act 1 Success Reward: 1 Prospecting, 1 Mind's Eye, Facing the River Fiend Map Failure Reward: 5 Gold & 20 Scorn", filename: "Act 1_The Minister_s Plan Card.jpg",
      act: 1, activationRound: 2, favorValue: 15,
      requirements: ["alchemy", "knowledge"],
      successRewards: { favor: 5, prestige: 5 },
      failurePenalties: { scorn: 5 },
      flavorText: "Facing the River Fiend" },

    { id: mid(), name: "A Day With the Birds", grantsMap: "The Alchemist's Daughter", audit: "Success Req: 3 Knowledge, Act 1 Success Reward: 3 Charisma, The Alchemist's Daughter Map Failure Reward: 10 Scorn", filename: "Act 1_A Day With the Birds Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["survival", "charisma"],
      successRewards: { favor: 5, gold: 3 },
      failurePenalties: { scorn: 3 } },

    { id: mid(), name: "Burst of Fulfillment", grantsMap: "Lost North Map", audit: "Success Req: 3 Survival & 2 Charisma, Act 1 Success Reward: 10 Favor, 1 Knowledge, Lost North Map Map Failure Reward: 4 Gold & All other players receive 5 Gold", filename: "Act 1_Burst of Fulfillment Card.jpg",
      act: 1, activationRound: 1, favorValue: 8,
      requirements: ["charisma"],
      successRewards: { favor: 5, prestige: 3 },
      failurePenalties: { scorn: 2 } },

    { id: mid(), name: "Helping the Merchant", grantsMap: "Great North Connection", audit: "Success Req: 3 Survival & 3 Power, Act 1 Success Reward: 1 Prospecting, 5 Gold, The Great North Connection Map Failure Reward: Discard One Played Card", filename: "Act 1_Helping the Merchant Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["prospecting", "charisma"],
      successRewards: { favor: 5, gold: 5 },
      failurePenalties: { scorn: 3 } },

    { id: mid(), name: "Protecting Family", audit: "Success Req: 2 Mind's Eye & 2 Philosopher's Stone, Act 1 OR Act 2 OR Act 3 Success Reward: 15 Favor Failure Reward: Discard all Weapon Cards. Gain 5 Prestige for each discarded card.", filename: "Act 1_Protecting Family Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["power", "survival"],
      successRewards: { favor: 5, prestige: 3 },
      failurePenalties: { scorn: 3 } },

    { id: mid(), name: "Cameron's Expedition", placeholderName: "Talking Thomas", grantsMap: "Lost South Map", audit: "Success Req: 4 Survival & 1 Charisma & 1 Prospecting, Act 1 Success Reward: 10 Favor, 1 Philosopher's Stone, Lost South Map Map Failure Reward: Discard all Wisdom Cards, Gain 8 Gold for Each Discarded Card", filename: "Act 1_Talking Thomas Card.jpg",
      act: 1, activationRound: 1, favorValue: 8,
      requirements: ["knowledge"],
      successRewards: { favor: 5, gold: 3 },
      failurePenalties: { scorn: 2 } },

    { id: mid(), name: "Wanted: Crazy Lou", placeholderName: "Taming a Dragon", audit: "Success Req: 15 Power, Act 1 OR Act 2 OR Act 3 Success Reward: 30 Favor, 15 Gold Failure Reward: Discard 5 Cards", filename: "Act 1_Taming a Dragon Card.jpg",
      act: 1, activationRound: 1, favorValue: 12,
      requirements: ["survival", "power"],
      successRewards: { favor: 5, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Testament to Courage", audit: "Success Req: 2 Knowledge & 2 Charisma & 2 Power, Act 1 Success Reward: 10 Favor, 2 Knowledge Failure Reward: All other players receive 3 Prestige", filename: "Act 1_Testament to Courage Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["power", "charisma"],
      successRewards: { favor: 5, prestige: 3 },
      failurePenalties: { scorn: 3 } },

    { id: mid(), name: "Golden Fiddle", placeholderName: "The Door Knob", grantsMap: "Finding the Lost Corridor", audit: "Success Req: 3 Survival & 1 Knowledge, Act 1 Success Reward: 2 Favor for Each Charisma you have, Finding the Lost Corridor Map Failure Reward: All other players receive 3 Gold", filename: "Act 1_The Door Knob Card.jpg",
      act: 1, activationRound: 1, favorValue: 8,
      requirements: ["knowledge", "prospecting"],
      successRewards: { favor: 5, gold: 3 },
      failurePenalties: { scorn: 2 } },

    { id: mid(), name: "The Midnight Crash", audit: "Success Req: 4 Favor & 3 Alchemy, Act 1 Success Reward: 2 Favor, 3 Prospecting Failure Reward: All Players Draw One Act 3 Mission", filename: "Act 1_The Midnight Crash Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["survival", "alchemy"],
      successRewards: { favor: 5, gold: 3 },
      failurePenalties: { scorn: 3 } },

    { id: mid(), name: "Trust of the Elders", audit: "Success Req: 5 Favor & 2 Prospecting, Act 1 Success Reward: 1 Favor for Each Knowledge you have, 2 Knowledge Failure Reward: Gain 10 Scorn per Knowledge you have", filename: "Act 1_Trust of the Elders Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["knowledge", "charisma"],
      successRewards: { favor: 5, prestige: 3 },
      failurePenalties: { scorn: 3 } },

    { id: mid(), name: "Tunnel of Trinkets", grantsMap: "Lost South Map", audit: "Success Req: 5 Favor & 1 Charisma & 1 Knowledge & 1 Survival, Act 1 Success Reward: 8 Gold, Lost South Map Map Failure Reward: All players receive 2 Gold", filename: "Act 1_Tunnel of Trinkets Card.jpg",
      act: 1, activationRound: 1, favorValue: 10,
      requirements: ["prospecting", "survival"],
      successRewards: { favor: 5, gold: 5 },
      failurePenalties: { scorn: 3 } },

    // ═══════════════════════════════════════════════════════════
    // ACT 2 MISSIONS (12 cards) — Activate Round 2 or 3
    // ═══════════════════════════════════════════════════════════

    { id: mid(), name: "Defending the Kingdom", placeholderName: "A Dance with Dragons", audit: "Success Req: 5 Survival & 5 Power, Act 2 Success Reward: 12 Favor Failure Reward: 10 Scorn", filename: "Act 2_A Dance with Dragons Card.jpg",
      act: 2, activationRound: 2, favorValue: 20,
      requirements: ["power", "survival", "alchemy"],
      successRewards: { favor: 10, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Tavern Legend", placeholderName: "A Surprise Light in the Night", audit: "Success Req: 7 Survival, Act 2 Success Reward: 5 Favor & 6 Charisma & 4 Alchemy Failure Reward: Gain 2 Scorn for Each Charisma you have", filename: "Act 2_A Surprise Light in the Night Card.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["knowledge", "alchemy"],
      successRewards: { favor: 8, gold: 5 },
      failurePenalties: { scorn: 4 } },

    { id: mid(), name: "The Falls' Dark Sussurus", placeholderName: "Facing the Hard Truth", audit: "Success Req: 9 Power, Act 2 Success Reward: 15 Favor & 2 Philosopher's Stones Failure Reward: You receive 1 Gold", filename: "Act 2_Facing the Hard Truth Card.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["knowledge", "charisma"],
      successRewards: { favor: 8, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "The Shadow Guide", placeholderName: "Ghosts in the Mirror", grantsMap: "Shattering the Mirror Prison", reqMaps: ["A Hidden Door"], audit: "Success Req: 5 Favor for each Mind's Eye you have & A Hidden Door Map, Act 2 Success Reward: Shattering the Mirror Prison Map Failure Reward: 10 Scorn", filename: "Act 2_Ghosts in the Mirror Card.jpg",
      act: 2, activationRound: 2, favorValue: 18,
      requirements: ["knowledge", "alchemy", "survival"],
      successRewards: { favor: 10, prestige: 3 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Usurper", placeholderName: "Hogsmade Holdup", audit: "Success Req: 6 Power & 6 Knowledge, Act 2 Success Reward: 10 Scorn, 30 Gold Failure Reward: 30 Scorn", filename: "Act 2_Hogsmade Holdup Card.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["power", "prospecting"],
      successRewards: { favor: 8, gold: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Great Scholar", placeholderName: "Hogwarts Valedictorian", audit: "Success Req: 8 Knowledge, Act 2 OR Act 3 Success Reward: 10 Favor, 8 Knowledge Failure Reward: Gain 2 Prestige Per Knowledge you have", filename: "Act 2_Hogwarts Valdictorian Card.jpg",
      act: 2, activationRound: 2, favorValue: 18,
      requirements: ["knowledge", "knowledge"],
      successRewards: { favor: 10, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Bodyguard", placeholderName: "Negotiations with Villains", audit: "Success Req: 5 Power & 3 Knowledge, Act 2 Success Reward: 1 Prospecting, 10 Gold Failure Reward: Discard 1 Card", filename: "Act 2_Negotiations with Villains Card.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["charisma", "power"],
      successRewards: { favor: 8, prestige: 3 },
      failurePenalties: { scorn: 4 } },

    { id: mid(), name: "Quest for the Stones", placeholderName: "Protecting Family II", audit: "Success Req: 6 Power & 6 Knowledge, Act 2 OR Act 3 Success Reward: Turn all your Scorn into Prestige Failure Reward: 15 Scorn", filename: "Act 2_Protecting Family Card copy.jpg",
      act: 2, activationRound: 2, favorValue: 18,
      requirements: ["power", "survival", "charisma"],
      successRewards: { favor: 10, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "Terror of the Mountain", placeholderName: "Rescuing the Soon to be Devoured", audit: "Success Req: 5 Survival & 9 Power, Act 2 OR Act 3 Success Reward: 5 Survival, 15 Favor Failure Reward: 5 Scorn", filename: "Act 2_Rescuing the Soon to be Devoured Card.jpg",
      act: 2, activationRound: 2, favorValue: 18,
      requirements: ["power", "survival"],
      successRewards: { favor: 10, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    { id: mid(), name: "A Promise", placeholderName: "Teaching a Natural", audit: "Success Req: 1 Knowledge, Act 2 Success Reward: 5 Favor, 2 Knowledge Failure Reward: Discard at least 1 Card. Gain 10 Prestige for each discarded Card", filename: "Act 2_Teaching a Natural Card.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["knowledge", "charisma"],
      successRewards: { favor: 8, prestige: 3 },
      failurePenalties: { scorn: 4 } },

    { id: mid(), name: "Mounted Champion", placeholderName: "To Believe in Someone", audit: "Success Req: 7 Survival, Act 2 Success Reward: 3 Power Failure Reward: 5 Scorn", filename: "Act 2_To Believe in Someone Card.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["charisma", "survival"],
      successRewards: { favor: 8, gold: 5 },
      failurePenalties: { scorn: 4 } },

    { id: mid(), name: "Secret Grotto", placeholderName: "Facing the Hard Truth (copy)", audit: "Success Req: 6 Survival & 3 Knowledge, Act 2 Success Reward: 3 Prospecting, 1 Philosopher's Stone Failure Reward: Discard all Power Cards, Gain 15 Prestige for each discarded Card", filename: "Act 2_Facing the Hard Truth Card copy.jpg",
      act: 2, activationRound: 2, favorValue: 15,
      requirements: ["knowledge", "charisma"],
      successRewards: { favor: 8, prestige: 5 },
      failurePenalties: { scorn: 5 } },

    // ═══════════════════════════════════════════════════════════
    // ACT 3 MISSIONS (12 cards) — Activate Round 3
    // ═══════════════════════════════════════════════════════════

    { id: mid(), name: "Royal Ball", placeholderName: "Burst of Fulfillment III", audit: "Success Req: 10 Charisma, Act 3 Success Reward: 15 Favor, 2 Mind's Eye Failure Reward: 5 Scorn", filename: "Act 3_Burst of Fulfillment Card.jpg",
      act: 3, activationRound: 3, favorValue: 25,
      requirements: ["charisma", "charisma", "knowledge"],
      successRewards: { favor: 15, prestige: 10 },
      failurePenalties: { scorn: 8 } },

    { id: mid(), name: "Ice Caverns", placeholderName: "Capturing the Golden Horcrux", audit: "Success Req: 6 Survival & 2 Mind's Eyes, Act 3 Success Reward: 10 Favor, 15 Prospecting Failure Reward: 10 Scorn", filename: "Act 3_Capturing of the Golden Horcrux Card.jpg",
      act: 3, activationRound: 3, favorValue: 30,
      requirements: ["knowledge", "alchemy", "prospecting"],
      successRewards: { favor: 20, prestige: 10 },
      failurePenalties: { scorn: 10 } },

    { id: mid(), name: "Alchemic Seige", placeholderName: "Fiery Pillaging", audit: "Success Req: 1 Alchemy & 1 Philosopher's Stone, Act 3 Success Reward: 20 Scorn Failure Reward: Gain 20 Prestige", filename: "Act 3_Fiery Pillaging Card.jpg",
      act: 3, activationRound: 3, favorValue: 25,
      requirements: ["power", "power", "survival"],
      successRewards: { favor: 15, prestige: 10 },
      failurePenalties: { scorn: 8 } },

    { id: mid(), name: "Mercy", placeholderName: "Honoring a Fallen Friend", audit: "Success Req: 7 Power, Act 3 Success Reward: Remove 20 Scorn Failure Reward: All other players remove 15 Scorn", filename: "Act 3_Honoring a Fallen Friend Card.jpg",
      act: 3, activationRound: 3, favorValue: 25,
      requirements: ["charisma", "knowledge", "survival"],
      successRewards: { favor: 15, prestige: 5 },
      failurePenalties: { scorn: 8 } },

    { id: mid(), name: "Passing the Mirror Gate", placeholderName: "Passing the Mirror Gate", audit: "Success Req: 4 Alchemy & 6 Prospecting, Act 3 Success Reward: Chose on of your Artifacts & duplicate the chosen card. Failure Reward: Discard 1 Artifact", filename: "Act 3_Passing the Mirror Gate Card.jpg",
      act: 3, activationRound: 3, favorValue: 28,
      requirements: ["knowledge", "alchemy", "survival"],
      successRewards: { favor: 18, prestige: 10 },
      failurePenalties: { scorn: 10 } },

    { id: mid(), name: "Building the Bridge", placeholderName: "Rescuing the Devoured III", audit: "Success Req: 20 Gold & 4 Survival & 4 Prospecting & 1 Philosopher's Stone, Act 3 Success Reward: 25 Favor Failure Reward: 10 Scorn", filename: "Act 3_Rescuing the Soon to be Devoured Card copy.jpg",
      act: 3, activationRound: 3, favorValue: 25,
      requirements: ["power", "survival", "charisma"],
      successRewards: { favor: 15, prestige: 10 },
      failurePenalties: { scorn: 8 } },

    { id: mid(), name: "Defend the Throne", placeholderName: "Singing a Farewell Together", reqMaps: ["Guardian"], audit: "Success Req: 7 Power & 7 Knowledge OR Guardian Map, Act 3 Success Reward: 18 Favor Failure Reward: 5 Scorn", filename: "Act 3_Singing a Farewell Together Card.jpg",
      act: 3, activationRound: 3, favorValue: 22,
      requirements: ["charisma", "charisma"],
      successRewards: { favor: 12, prestige: 5 },
      failurePenalties: { scorn: 7 } },

    { id: mid(), name: "Water Temple", placeholderName: "Solving the Forest Puzzle", audit: "Success Req: 10 Survival, 1 Mind's Eye, Act 3 Success Reward: 15 Favor & 2 Philosopher's Stones Failure Reward: 5 Scorn", filename: "Act 3_Solving the Forest Puzzle Card.jpg",
      act: 3, activationRound: 3, favorValue: 25,
      requirements: ["knowledge", "survival", "alchemy"],
      successRewards: { favor: 15, prestige: 5 },
      failurePenalties: { scorn: 8 } },

    { id: mid(), name: "The Labyrinth", placeholderName: "Solving the Riddle", audit: "Success Req: 3 Survival & 2 Knowledge & 1 Mind's Eye, Act 3 Success Reward: 10 Favor & 2 Knowledge Failure Reward: None, If you have the Fortune Teller gain 50 Prestige", filename: "Act 3_Solving the Riddle Card.jpg",
      act: 3, activationRound: 3, favorValue: 22,
      requirements: ["knowledge", "knowledge"],
      successRewards: { favor: 12, prestige: 10 },
      failurePenalties: { scorn: 7 } },

    { id: mid(), name: "Wild Experiments", placeholderName: "Splitting Personalities", audit: "Success Req: 8 Alchemy & 4 Prospecting, Act 3 Success Reward: Chose on of your potions & duplicate the chosen card. Effects of the potion activate immediatley. Failure Reward: 15 Scorn", filename: "Act 3_Splitting Personalities Card.jpg",
      act: 3, activationRound: 3, favorValue: 25,
      requirements: ["alchemy", "knowledge", "charisma"],
      successRewards: { favor: 15, prestige: 5 },
      failurePenalties: { scorn: 8 } },

    { id: mid(), name: "King of the Sky", placeholderName: "Taking on Wizard Outlaws", reqMaps: ["Dawnharbinger"], audit: "Success Req: 4 Survival & 12 Power OR Dawn Harbinger Map, Act 3 Success Reward: 10 Favor for each Philosopher's Stone you have Failure Reward: 10 Scorn", filename: "Act 3_Taking on Wizard Outlaws Card.jpg",
      act: 3, activationRound: 3, favorValue: 28,
      requirements: ["power", "power", "knowledge"],
      successRewards: { favor: 18, prestige: 10 },
      failurePenalties: { scorn: 10 } },

    { id: mid(), name: "Champion of Legend", placeholderName: "World Cup Champions", audit: "Success Req: 8 Power & 5 Knowledge, Act 3 Success Reward: 10 Favor, 4 Power Failure Reward: Discard all Prestige & Scorn", filename: "Act 3_World Cup Champions Card.jpg",
      act: 3, activationRound: 3, favorValue: 30,
      requirements: ["power", "power", "charisma"],
      successRewards: { favor: 20, prestige: 15 },
      failurePenalties: { scorn: 10 } },
];

console.log(`[FAVOR] Loaded ${window.FAVOR_DATA.missions.length} mission cards`);
