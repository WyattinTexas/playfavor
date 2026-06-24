/**
 * FAVOR — Master Card Database (Agent-Verified + Visual Audit v2)
 * 107 cards total: 92 regular + 15 mission letters
 * Card names verified from actual card images (filenames often don't match)
 * Border colors: blue=Act1, green/teal=Act2, pink/purple=Act3, grey=weapons, gold=letters
 * Skills: survival, charisma, alchemy, prospecting, knowledge, power
 * Icon key: leaf=survival, feather=charisma, dark-bomb=alchemy, flame/orange-crystal=prospecting, book=knowledge, sword=power
 */

window.FAVOR_DATA = window.FAVOR_DATA || {};

let _cardId = 1;
function cid() { return _cardId++; }

window.FAVOR_DATA.cards = [

  // ═══ ACT 1 — BLUE BORDER ═══════════════════════════════════════

  { id: cid(), name: "Concoction", filename: "Cauldron Card.jpg", act: 1, type: "potion",
    cost: null, skills: ["alchemy"], requirements: [], rewards: {} },

  { id: cid(), name: "Cooking", filename: "Cooking Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["knowledge", "survival", "alchemy"], requirements: [], rewards: {} },

  { id: cid(), name: "Dark Cauldron", filename: "Dark Cauldron Card.jpg", act: 2, type: "endeavor",
    cost: 1, skills: ["alchemy", "alchemy"], requirements: [], rewards: {} },

  { id: cid(), name: "Herbal Remedies", filename: "Meado Weed Card.jpg", act: 2, type: "endeavor",
    cost: 1, skills: ["survival", "survival", "survival"], requirements: [], rewards: {} },

  { id: cid(), name: "Hunting", filename: "Hunting Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["power", "survival", "survival"], requirements: [], rewards: {} },

  { id: cid(), name: "Maester's Favor", filename: "Golden Feather Card.jpg", act: 2, type: "endeavor",
    cost: 1, skills: ["charisma", "charisma", "charisma"], requirements: [], rewards: {} },

  { id: cid(), name: "Hermit's Lab", filename: "Forest Lab Card.jpg", act: 1, type: "endeavor",
    cost: 1, skills: ["alchemy", "survival"], requirements: [], rewards: {}, special: "or_choice" },

  { id: cid(), name: "Father's Lab", filename: "Potion Lab Card.jpg", act: 2, type: "endeavor",
    cost: 3, skills: ["alchemy", "alchemy", "alchemy"], requirements: [], rewards: {} },

  { id: cid(), name: "Mining Guild", filename: "Scorched Roost Card.jpg", act: 1, type: "endeavor",
    cost: 2, skills: [], requirements: [], rewards: {}, special: "charisma_or_prospecting" },

  { id: cid(), name: "Pearl Diving", filename: "Obsidian Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["survival", "prospecting"], requirements: [], rewards: {} },

  { id: cid(), name: "Gemstone Mine", filename: "Obsidian Source Card.jpg", act: 2, type: "endeavor",
    cost: 2, skills: ["prospecting", "prospecting", "prospecting"], requirements: [], rewards: {} },

  { id: cid(), name: "Forbidden Lab", filename: "The Outcast_s Hut Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["knowledge"], requirements: [], rewards: { scorn: 2 }, special: "alchemy_or_prospecting" },

  { id: cid(), name: "First Aid", filename: "Talking Sprout Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["survival"], requirements: [], rewards: {} },

  { id: cid(), name: "Trapping", filename: "Trapping Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["survival"], requirements: [], rewards: {} },

  { id: cid(), name: "Negotiate", filename: "Negotiate Card.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["charisma"], requirements: [], rewards: { prestige: 1 } },

  { id: cid(), name: "Diplomacy", filename: "Roost Feather Card.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["charisma"], requirements: [], rewards: { prestige: 1 } },

  { id: cid(), name: "New Frontier", filename: "New Frontier Card.jpg", act: 2, type: "adventure",
    cost: null, skills: ["survival", "survival"], requirements: [], rewards: { prestige: 1 },
    special: "minds_eye" },

  { id: cid(), name: "Favor of the Princess", filename: "Nimbus 2000 Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["alchemy", "alchemy", "survival", "survival", "charisma", "charisma", "prospecting", "prospecting", "power", "power"],
    requirements: ["charisma", "charisma", "charisma"], rewards: {},
    special: "philosopher_stone" },

  { id: cid(), name: "Fierce Rival", filename: "Rigorous Training Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["power", "power", "power", "knowledge"], requirements: [], rewards: { gold: 2 } },

  // ═══ ACT 2 — GREEN/TEAL BORDER ═════════════════════════════════

  { id: cid(), name: "Alchemist Apprentice", filename: "Alchemist Apprentice Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["alchemy", "alchemy", "alchemy"], requirements: [], rewards: {},
    special: "minds_eye" },

  { id: cid(), name: "Moment of Reflection", filename: "A Moment with the Stars Card.jpg", act: 1, type: "adventure",
    cost: null, skills: ["power", "knowledge"], requirements: [], rewards: {}, favor: 2,
    special: "map_lost_north" },

  { id: cid(), name: "Melee Spectacular", filename: "Aerial Spectacular Card.jpg", act: 2, type: "adventure",
    cost: null, skills: ["power"], requirements: ["power"], rewards: {}, special: "power_x2" },

  { id: cid(), name: "Settling Claims", filename: "Befriending Eagles Card.jpg", act: 2, type: "adventure",
    cost: 3, skills: ["charisma"], requirements: ["charisma", "charisma"], rewards: {}, favor: 5 },

  { id: cid(), name: "Chemical X", filename: "Chemical D1 Card.jpg", act: 3, type: "potion",
    cost: 2, skills: ["alchemy"], requirements: [], rewards: {},
    special: "move_slider_any", combo: "1/2" },

  { id: cid(), name: "Chemical Y", filename: "Chemical D2 Card.jpg", act: 3, type: "potion",
    cost: 6, skills: ["alchemy", "prospecting"], requirements: [], rewards: {}, favor: 15,
    special: "double_adventure_favor", combo: "2/2" },

  { id: cid(), name: "Fuzzy Head", filename: "Cursed Coating Card.jpg", act: 2, type: "potion",
    cost: 3, skills: ["alchemy"], requirements: [], rewards: {},
    special: "minus_3_power_all_others" },

  { id: cid(), name: "Endless Sparring", filename: "Dual of Novices.jpg", act: 1, type: "adventure",
    cost: null, skills: ["power", "knowledge", "knowledge"], requirements: [], rewards: { scorn: 5 } },

  { id: cid(), name: "Leading the Charge", filename: "Enter the Tree Card.jpg", act: 3, type: "adventure",
    cost: 8, skills: ["charisma", "survival", "survival"], requirements: [], rewards: {}, favor: 10 },

  { id: cid(), name: "Mind Warper", filename: "Experiment 66 Card.jpg", act: 3, type: "potion",
    cost: 6, skills: [], requirements: ["alchemy", "prospecting"], rewards: {},
    special: "scorn_to_prestige" },

  { id: cid(), name: "Facing the River Fiend", filename: "Facing Fiendfyre Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["survival", "survival", "survival", "survival", "power", "power", "power", "power", "power", "power"],
    requirements: [], rewards: { prestige: 5 }, favor: 18,
    combo: "The Minister's Plan" },

  { id: cid(), name: "Finding the Lost Corridor", filename: "Finding the Lost Corridor Card.jpg", act: 2, type: "adventure",
    cost: 2, skills: ["knowledge"], requirements: [], rewards: {}, favor: 10,
    special: "minds_eye", combo: "Reunited" },

  { id: cid(), name: "Forming a Bond", filename: "Forming a Bond Card.jpg", act: 1, type: "adventure",
    cost: null, skills: ["charisma", "survival"], requirements: [], rewards: {}, favor: 7 },

  { id: cid(), name: "The Tree Tunnels", filename: "Friends in the Sky Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["survival", "knowledge", "knowledge", "knowledge"], requirements: [], rewards: {},
    favor: 5, special: "minds_eye" },

  { id: cid(), name: "Fur Trading", filename: "Fur Trading Card.jpg", act: 1, type: "adventure",
    cost: null, skills: ["charisma"], requirements: [], rewards: { gold: 8 }, favor: 3 },

  { id: cid(), name: "Generous Donations", filename: "Generous Donation Card.jpg", act: 2, type: "adventure",
    cost: 18, skills: ["knowledge"], requirements: [], rewards: {}, favor: 25 },

  { id: cid(), name: "A Hidden Door", filename: "Ghost Studies Card.jpg", act: 2, type: "adventure",
    cost: 3, skills: [], requirements: ["survival", "knowledge"], rewards: {}, favor: 5,
    special: "The Shadow Guide" },

  { id: cid(), name: "Gold Luster", filename: "Glowing Manipulation Card.jpg", act: 2, type: "potion",
    cost: 3, skills: [], requirements: ["alchemy", "prospecting"], rewards: {},
    special: "gold_to_prestige" },

  { id: cid(), name: "Her Lost Father", filename: "Her Lost Father Card.jpg", act: 1, type: "adventure",
    cost: null, skills: [], requirements: [], rewards: {}, favor: 3,
    special: "map_finding_lost_corridor" },

  { id: cid(), name: "Chemical Z", filename: "Liquid Doom Card.jpg", act: 3, type: "potion",
    cost: null, skills: [],
    requirements: ["prospecting", "prospecting", "prospecting", "prospecting", "alchemy", "alchemy", "alchemy", "alchemy"],
    rewards: { prestige: 5 }, special: "others_5_scorn" },

  { id: cid(), name: "Duplicating Goo", filename: "Liquid Gold Card.jpg", act: 2, type: "potion",
    cost: null, skills: [], requirements: ["alchemy", "prospecting"], rewards: {},
    special: "multiply_gold_x2" },

  { id: cid(), name: "Shot of Courage", filename: "Liquid Wind Card.jpg", act: 3, type: "potion",
    cost: null, skills: [],
    requirements: ["prospecting", "prospecting", "prospecting", "alchemy", "alchemy", "alchemy"],
    rewards: {}, special: "coin_flip_4_power" },

  { id: cid(), name: "Life Essence", filename: "Stream of Life Card.jpg", act: 3, type: "potion",
    cost: null, skills: ["alchemy"], requirements: [], rewards: {},
    special: "remove_mission_requirements" },

  { id: cid(), name: "Mind Eraser", filename: "Trouble Brew Card.jpg", act: 2, type: "potion",
    cost: null, skills: [], requirements: ["prospecting", "alchemy"], rewards: {},
    special: "remove_13_scorn" },

  { id: cid(), name: "Marketplace Sales", filename: "Perscription Elixers Card.jpg", act: 2, type: "potion",
    cost: null, skills: ["alchemy", "charisma"], requirements: [], rewards: {},
    special: "philosopher_stone", combo: "x2" },

  { id: cid(), name: "Market Trade Exchange", filename: "Market Trade Exhange Card.jpg", act: 3, type: "adventure",
    cost: null, skills: [],
    requirements: ["charisma", "charisma", "charisma", "charisma", "charisma", "charisma", "charisma", "charisma", "knowledge", "knowledge"],
    rewards: { gold: 15 }, special: "trade_route" },

  { id: cid(), name: "Prospecting Journal", filename: "Prospecting Journal Card.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["knowledge", "prospecting"], requirements: ["prospecting"], rewards: {} },

  { id: cid(), name: "Badge of Courage", filename: "Badge of Courage Card.jpg", act: 1, type: "artifact",
    cost: 5, skills: [], requirements: ["knowledge", "knowledge", "knowledge", "knowledge", "knowledge"],
    rewards: {}, favor: 5 },

  { id: cid(), name: "Thorns of Treachery", filename: "Mystery Dueling Culb Card.jpg", act: 2, type: "endeavor",
    cost: 3, skills: ["knowledge", "knowledge", "knowledge"], requirements: [], rewards: { prestige: 1 } },

  { id: cid(), name: "Fang's Truce", filename: "nduring Hardship Card.jpg", act: 3, type: "endeavor",
    cost: 4, skills: ["survival", "survival"], requirements: [], rewards: {}, favor: 2 },

  { id: cid(), name: "Mystery Intrigue Club", filename: "Protecting Your Friends Card.jpg", act: 3, type: "endeavor",
    cost: 5, skills: ["knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge"],
    requirements: ["prospecting", "prospecting"], rewards: {} },

  { id: cid(), name: "Reckless Training", filename: "Reckless Training Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["power", "power"], requirements: [], rewards: { scorn: 5 } },

  { id: cid(), name: "Reunited", filename: "Reunited Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["prospecting"],
    requirements: ["knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge"],
    rewards: {}, favor: 22, combo: "Finding the Lost Corridor" },

  { id: cid(), name: "Great North Connection", filename: "The Great Nort Connection Card.jpg", act: 2, type: "adventure",
    cost: null, skills: ["survival", "prospecting"], requirements: ["charisma", "power"], rewards: { prestige: 5 },
    special: "trade_route" },

  { id: cid(), name: "The Alchemist's Daughter", filename: "The Great Eagle Rider Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["alchemy"],
    requirements: ["charisma", "charisma", "charisma", "charisma", "charisma", "alchemy", "alchemy", "alchemy", "alchemy", "alchemy", "power", "power", "power", "power", "power"],
    rewards: {}, favor: 18, special: "minds_eye" },

  { id: cid(), name: "Shattering the Mirror Prison", filename: "Shattering the Mirror Prison Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["knowledge"], requirements: ["knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge"],
    rewards: {}, favor: 5, special: "minds_eye" },

  { id: cid(), name: "Tribute to the Fallen", filename: "Tribute to the Fallen Card.jpg", act: 2, type: "adventure",
    cost: null, skills: [], requirements: [], rewards: {}, favor: 10 },

  { id: cid(), name: "Warm Mentorship", filename: "Warm Mentorship Card.jpg", act: 1, type: "adventure",
    cost: null, skills: [], requirements: [], rewards: {}, favor: 8 },

  { id: cid(), name: "Enchanted Flames", filename: "Flash Enchantment Card.jpg", act: 3, type: "weapon",
    cost: null, skills: ["power", "power", "alchemy", "alchemy", "alchemy"],
    requirements: ["knowledge", "knowledge", "knowledge", "prospecting", "prospecting", "prospecting"], rewards: {} },

  // ═══ ACT 3 — PINK/PURPLE BORDER ════════════════════════════════

  { id: cid(), name: "Eight Stances", filename: "Eight Stances.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["knowledge"], requirements: [], rewards: {} },

  { id: cid(), name: "Philosopher's Stone", filename: "Elder Wand Card.jpg", act: 2, type: "artifact",
    cost: null, skills: ["knowledge", "prospecting"], requirements: ["alchemy", "prospecting", "knowledge"], rewards: {},
    special: "philosopher_stone" },

  { id: cid(), name: "Fortune Teller", filename: "Fortune Teller Card.jpg", act: 2, type: "artifact",
    cost: null, skills: [], requirements: [], rewards: { prestige: 3 }, special: "minds_eye" },

  { id: cid(), name: "Forgotten Temple", filename: "Forgotten Temple.jpg", act: 1, type: "adventure",
    cost: null, skills: ["knowledge"], requirements: [], rewards: { prestige: 2 },
    special: "sacred_chest" },

  { id: cid(), name: "Philosopher's Scepter", filename: "Apprentice Wand Card.jpg", act: 3, type: "artifact",
    cost: null, skills: ["knowledge", "prospecting"], requirements: [], rewards: {},
    favor: 2, special: "philosopher_stone" },

  { id: cid(), name: "Oaths of the Crown", filename: "Oaths Crown.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["knowledge"], requirements: [], rewards: {} },

  { id: cid(), name: "Father's Teachings", filename: "Herbology 101 Card.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["knowledge"], requirements: [], rewards: {} },

  { id: cid(), name: "Lens of Truth", filename: "Lens of Truth Card.jpg", act: 3, type: "wisdom",
    cost: null, skills: ["survival"], requirements: [], rewards: {}, special: "minds_eye" },

  { id: cid(), name: "Mind's Eye", filename: "Mind_s Eye Card.jpg", act: 2, type: "artifact",
    cost: null, skills: ["alchemy"], requirements: ["alchemy", "alchemy", "prospecting", "knowledge"], rewards: {},
    special: "minds_eye" },

  { id: cid(), name: "Royal Library", filename: "Royal Library.jpg", act: 3, type: "endeavor",
    cost: null, skills: ["knowledge"], requirements: [], rewards: {}, special: "knowledge_x5" },

  { id: cid(), name: "Sacred Stone", filename: "Sacred Stone Card.jpg", act: 2, type: "artifact",
    cost: null, skills: ["prospecting"], requirements: [], rewards: { prestige: 5 }, special: "philosopher_stone" },

  { id: cid(), name: "Family Ring", filename: "Time Turner Card.jpg", act: 3, type: "artifact",
    cost: 3, skills: ["knowledge", "prospecting"], requirements: [], rewards: {},
    special: "knowledge_x2" },

  { id: cid(), name: "Lucky Pendant", filename: "Lucky Pendant Card.jpg", act: 3, type: "artifact",
    cost: 5, skills: [], requirements: [], rewards: {}, favor: 5 },

  { id: cid(), name: "Great Vault Key", filename: "Great Vault Key Card.jpg", act: 3, type: "artifact",
    cost: 4, skills: ["survival", "charisma", "prospecting"], requirements: [], rewards: {} },

  { id: cid(), name: "Sacred Chest", filename: "Sacred Chest Card.jpg", act: 3, type: "artifact",
    cost: 12, skills: [], requirements: [], rewards: {}, special: "philosopher_stone_x8" },

  { id: cid(), name: "Secret Lab", filename: "Secret Lab Card.jpg", act: 3, type: "artifact",
    cost: null, skills: [], requirements: [], rewards: {},
    special: "minds_eye_x2_philosopher_stone_x5" },

  { id: cid(), name: "Royal Hilt", filename: "Golden Snitch Card.jpg", act: 3, type: "weapon",
    cost: 2, skills: ["power"], requirements: [], rewards: {}, special: "minds_eye" },

  { id: cid(), name: "Lost North Map", filename: "Lost North Map.jpg", act: 2, type: "adventure",
    cost: null, skills: [], requirements: ["survival", "prospecting"], rewards: {}, favor: 5,
    combo: "1/2", special: "map" },

  { id: cid(), name: "Lost South Map", filename: "Lost South Map.jpg", act: 2, type: "adventure",
    cost: null, skills: [], requirements: ["survival", "charisma"], rewards: { gold: 20 }, favor: 5,
    combo: "2/2", special: "map" },

  // ═══ GREY/SILVER — WEAPONS ══════════════════════════════════════

  { id: cid(), name: "Tombstone", filename: "Beat Stick Card.jpg", act: 1, type: "weapon",
    cost: null, skills: ["power"], requirements: [], rewards: {} },

  { id: cid(), name: "Shark Tooth", filename: "Dusty Card.jpg", act: 1, type: "weapon",
    cost: 1, skills: ["power", "power"], requirements: [], rewards: {} },

  { id: cid(), name: "Ol' Bessy", filename: "Ol_ Bessy Card.jpg", act: 1, type: "weapon",
    cost: null, skills: ["power"], requirements: [], rewards: {} },

  { id: cid(), name: "Training Friend", filename: "Training Friend.jpg", act: 1, type: "weapon",
    cost: null, skills: ["power"], requirements: [], rewards: {} },

  { id: cid(), name: "Deadeye", filename: "All Seer Card.jpg", act: 3, type: "weapon",
    cost: null, skills: ["power"],
    requirements: ["survival", "survival", "survival", "survival", "survival"], rewards: {},
    special: "minds_eye" },

  { id: cid(), name: "Blind Faith", filename: "Griffin Boots Card.jpg", act: 2, type: "weapon",
    cost: null, skills: ["power"], requirements: ["power"], rewards: {}, combo: "1/2" },

  { id: cid(), name: "Heaven's Blade", filename: "Griffin Talons Card.jpg", act: 3, type: "weapon",
    cost: 2, skills: ["power"], requirements: ["knowledge", "knowledge"], rewards: {},
    favor: 6, combo: "2/2" },

  { id: cid(), name: "Archeus", filename: "Griffin Wings Card.jpg", act: 3, type: "weapon",
    cost: null, skills: ["power"], requirements: ["survival", "knowledge"], rewards: {}, favor: 5,
    combo: "2/2", special: "discard_opponent_weapon" },

  { id: cid(), name: "Wild Steel", filename: "Seeker Goggles Card.jpg", act: 2, type: "weapon",
    cost: 2, skills: ["power", "power", "survival", "survival"], requirements: ["prospecting"], rewards: {} },

  { id: cid(), name: "Dawnharbinger", filename: "Keeper Gloves Card.jpg", act: 2, type: "weapon",
    cost: null, skills: ["power", "charisma", "charisma"], requirements: ["survival", "prospecting"], rewards: {},
    special: "king_of_the_sky" },

  { id: cid(), name: "Destroyer", filename: "Angry Beaters Card.jpg", act: 2, type: "weapon",
    cost: 3, skills: ["power", "power", "power", "power"], requirements: ["prospecting"], rewards: {} },

  { id: cid(), name: "Guardian", filename: "Guardian Card.jpg", act: 2, type: "weapon",
    cost: null, skills: ["power", "power", "prospecting"], requirements: ["power", "prospecting"], rewards: {},
    special: "defend_the_throne" },

  { id: cid(), name: "Blackbird", filename: "Teather Bark Card.jpg", act: 1, type: "weapon",
    cost: null, skills: ["power", "power"], requirements: ["survival"], rewards: {} },

  // ═══ MISSION LETTERS — GOLD BORDER ═══════════════════════════════

  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card.jpg", act: 1, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card(1).jpg", act: 1, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card(2).jpg", act: 1, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card 2.jpg", act: 1, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card 2(1).jpg", act: 1, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card 2(2).jpg", act: 2, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card 3.jpg", act: 2, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card 3(1).jpg", act: 2, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card 3(2).jpg", act: 2, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card 4.jpg", act: 2, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card 4(1).jpg", act: 3, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card 4(2).jpg", act: 3, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card 5.jpg", act: 3, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card 5(1).jpg", act: 3, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
  { id: cid(), name: "Mission Letter", filename: "Letter (x4) Card 5(2).jpg", act: 3, type: "mission_letter",
    cost: 1, skills: [], requirements: [], rewards: {} },
];

// Note: Asset 11.png is a raw art asset, not a playable card — excluded from data

console.log(`[FAVOR] Loaded ${window.FAVOR_DATA.cards.length} cards`);
// Verify act distribution
const acts = {1:0, 2:0, 3:0};
window.FAVOR_DATA.cards.forEach(c => acts[c.act]++);
console.log(`[FAVOR] Act distribution: Act1=${acts[1]}, Act2=${acts[2]}, Act3=${acts[3]}`);
