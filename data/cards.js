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

  { id: cid(), name: "Concoction", audit: "1 Alchemy. Act 1. No Req.", filename: "Cauldron Card.jpg", act: 1, type: "potion",
    cost: null, skills: ["alchemy"], requirements: [], rewards: {} },

  { id: cid(), name: "Cooking", audit: "1 Survival, 1 Alchemy. Req: 1 Knowledge, Act 1", filename: "Cooking Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["survival", "alchemy"], requirements: ["knowledge"], rewards: {} },

  { id: cid(), name: "Dark Cauldron", audit: "2 Alchemy, Cost 1 Gold to play. Act 2", filename: "Dark Cauldron Card.jpg", act: 2, type: "endeavor",
    cost: 1, skills: ["alchemy", "alchemy"], requirements: [], rewards: {} },

  { id: cid(), name: "Herbal Remedies", audit: "3 Survival, Cost 1 Gold to play. Act 2", filename: "Meado Weed Card.jpg", act: 2, type: "endeavor",
    cost: 1, skills: ["survival", "survival", "survival"], requirements: [], rewards: {} },

  { id: cid(), name: "Hunting", audit: "2 Survival, Req: 1 Power. Act 1", filename: "Hunting Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["survival", "survival"], requirements: ["power"], rewards: {} },

  { id: cid(), name: "Maester's Favor", audit: "3 Charisma, Cost 1 Gold to play. Act 2", filename: "Golden Feather Card.jpg", act: 2, type: "endeavor",
    cost: 1, skills: ["charisma", "charisma", "charisma"], requirements: [], rewards: {} },

  // AUDIT FIX 2026-07-13 (visual, art = ground truth): the card prints
  // "1 Alchemy OR 1 Survival" but `skills` listed BOTH, and the engine's recalc
  // applies every `skills` entry literally — so this card was granting 2 skills
  // for 1 gold. It was missed by the 7/5 flex-skill rework (which converted
  // Mining Guild + Forbidden Lab). Now a real flex unit, like its siblings.
  { id: cid(), name: "Hermit's Lab", audit: "1 Alchemy OR 1 Survival, Cost 1 Gold to play. Act 1", filename: "Forest Lab Card.jpg", act: 1, type: "endeavor",
    cost: 1, skills: [], requirements: [], rewards: {}, special: "alchemy_or_survival" },

  { id: cid(), name: "Father's Lab", audit: "3 Alchemy, Cost 3 Gold to play. Act 2", filename: "Potion Lab Card.jpg", act: 2, type: "endeavor",
    cost: 3, skills: ["alchemy", "alchemy", "alchemy"], requirements: [], rewards: {} },

  { id: cid(), name: "Mining Guild", audit: "1 Charisma OR 1 Prospecting, Cost 2 Gold to play. Act 1", filename: "Scorched Roost Card.jpg", act: 1, type: "endeavor",
    cost: 2, skills: [], requirements: [], rewards: {}, special: "charisma_or_prospecting" },

  { id: cid(), name: "Pearl Diving", audit: "2 Prospecting, Req: 1 Survival. Act 1", filename: "Obsidian Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["prospecting", "prospecting"], requirements: ["survival"], rewards: {} },

  { id: cid(), name: "Gemstone Mine", audit: "3 Prospecting, Cost 2 Gold to play. Act 2", filename: "Obsidian Source Card.jpg", act: 2, type: "endeavor",
    cost: 2, skills: ["prospecting", "prospecting", "prospecting"], requirements: [], rewards: {} },

  // AUDIT FIX 2026-07-13 (visual, art = ground truth): `skills: ["knowledge"]`
  // was a PHANTOM grant — on the card, Knowledge appears only as the silver-oval
  // REQUIREMENT. The grant is the Alchemy-OR-Prospecting flex pair, already
  // carried by `special`. The requirement had been copy-pasted into the grants.
  { id: cid(), name: "Forbidden Lab", audit: "2 Scorn, 1 Alchemy OR 1 Prospecting, Req: 1 Knowledge. Act 1", filename: "The Outcast_s Hut Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: [], requirements: ["knowledge"], rewards: { scorn: 2 }, special: "alchemy_or_prospecting" },

  { id: cid(), name: "First Aid", audit: "1 Survival. Act 1. No Req.", filename: "Talking Sprout Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["survival"], requirements: [], rewards: {} },

  { id: cid(), name: "Trapping", audit: "1 Survival. Act 1. No Req.", filename: "Trapping Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["survival"], requirements: [], rewards: {} },

  { id: cid(), name: "Negotiate", audit: "1 Charisma. Act 1. No Req.", filename: "Negotiate Card.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["charisma"], requirements: [], rewards: {} },

  { id: cid(), name: "Diplomacy", audit: "1 Charisma. Act 1. No Req.", filename: "Roost Feather Card.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["charisma"], requirements: [], rewards: {} },

  { id: cid(), name: "New Frontier", audit: "4 Survival, 2 Charisma, Req: 1 Mind's Eye, Act 2", filename: "New Frontier Card.jpg", act: 2, type: "adventure",
    cost: null, skills: ["survival", "survival", "survival", "survival", "charisma", "charisma"], requirements: ["minds_eye"], rewards: {} },

  { id: cid(), name: "Favor of the Princess", audit: "2 Alchemy, 2 Survival, 2 Charisma, 2 Prospecting, 2 Power, Req: 3 Charisma, Act 3", filename: "Nimbus 2000 Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["alchemy", "alchemy", "survival", "survival", "charisma", "charisma", "prospecting", "prospecting", "power", "power"],
    requirements: ["charisma", "charisma", "charisma"], rewards: {} },

  { id: cid(), name: "Fierce Rival", audit: "2 Knowledge, 2 Power, Req: 2 Power, Act 3", filename: "Rigorous Training Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["knowledge", "knowledge", "power", "power"], requirements: ["power", "power"], rewards: {} },

  // ═══ ACT 2 — GREEN/TEAL BORDER ═════════════════════════════════

  { id: cid(), name: "Alchemist Apprentice", audit: "2 Alchemy, Req: 1 Alchemy, Act 1", filename: "Alchemist Apprentice Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["alchemy", "alchemy"], requirements: ["alchemy"], rewards: {} },

  { id: cid(), name: "Moment of Reflection", grantsMap: "Lost North Map", audit: "1 Knowledge, 2 Favor, Lost North Map Map, Req: 1 Power, Act 1", filename: "A Moment with the Stars Card.jpg", act: 1, type: "adventure",
    cost: null, skills: ["knowledge"], requirements: ["power"], rewards: {}, favor: 2,
    special: "map_lost_north" },

  { id: cid(), name: "Melee Spectacular", audit: "Gain 2 Gold for each Power that both of your two neighboring players currently have. Req: 1 Power, Act 2", filename: "Aerial Spectacular Card.jpg", act: 2, type: "adventure",
    cost: null, skills: [], requirements: ["power"], rewards: {}, special: "gold_2_per_power_neighbors" },

  { id: cid(), name: "Settling Claims", audit: "3 Charisma, 5 Favor Req: 2 Charisma, Act 2", filename: "Befriending Eagles Card.jpg", act: 2, type: "adventure",
    cost: null, skills: ["charisma", "charisma", "charisma"], requirements: ["charisma", "charisma"], rewards: {}, favor: 5 },

  // AUDIT FIX 2026-07-13: requirement coin reads 2. Chemical X and Fuzzy Head
  // had their Alchemy requirements swapped with each other (art 2/3, data 3/2).
  { id: cid(), name: "Chemical X", audit: "Move Character Slider to any slot, Req: 2 Alchemy, Act 3,", filename: "Chemical D1 Card.jpg", act: 3, type: "potion",
    cost: null, skills: [], requirements: ["alchemy", "alchemy"], rewards: {},
    special: "move_slider_any", combo: "1/2" },

  { id: cid(), name: "Chemical Y", audit: "Choose an Adventure card you have, multiply its Favor amount by 2. Req: 6 Alchemy & 1 Philosopher's Stone. If you own Chemical X: 15 Favor, Act 3", filename: "Chemical D2 Card.jpg", act: 3, type: "potion",
    cost: null, skills: [], requirements: ["alchemy", "alchemy", "alchemy", "alchemy", "alchemy", "alchemy", "philosopher_stone"], rewards: {},
    special: "double_adventure_favor", combo: "2/2" },

  // AUDIT FIX 2026-07-13: requirement coin reads 3 (swapped with Chemical X).
  { id: cid(), name: "Fuzzy Head", audit: "Reduce the power of other players during this melee round by 3. Req: 3 Alchemy, Act 2", filename: "Cursed Coating Card.jpg", act: 2, type: "potion",
    cost: null, skills: [], requirements: ["alchemy", "alchemy", "alchemy"], rewards: {},
    special: "minus_3_power_all_others" },

  { id: cid(), name: "Endless Sparring", audit: "2 Knowledge, 5 Scorn, Req: 1 Power, Act 1", filename: "Dual of Novices.jpg", act: 1, type: "adventure",
    cost: null, skills: ["knowledge", "knowledge"], requirements: ["power"], rewards: { scorn: 5 } },

  { id: cid(), name: "Leading the Charge", audit: "2 Survival, 10 Favor Req: 8 Charisma, Act 3", filename: "Enter the Tree Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["survival", "survival"], requirements: ["charisma", "charisma", "charisma", "charisma", "charisma", "charisma", "charisma", "charisma"], rewards: {}, favor: 10 },

  { id: cid(), name: "Mind Warper", audit: "Turns your Scorn into Prestige when played, Req: 6 Alchemy & 1 Philosopher's Stone, Act 3", filename: "Experiment 66 Card.jpg", act: 3, type: "potion",
    cost: null, skills: [], requirements: ["alchemy", "alchemy", "alchemy", "alchemy", "alchemy", "alchemy", "philosopher_stone"], rewards: {},
    special: "scorn_to_prestige" },

  { id: cid(), name: "Facing the River Fiend", reqMaps: ["The Minister's Plan"], audit: "15 Favor, Req: 7 Survival & 7 Power OR The Minister's Plan Map, Act 3", filename: "Facing Fiendfyre Card.jpg", act: 3, type: "adventure",
    cost: null, skills: [],
    requirements: ["survival", "survival", "survival", "survival", "survival", "survival", "survival", "power", "power", "power", "power", "power", "power", "power"], rewards: {}, favor: 15,
    combo: "The Minister's Plan" },

  { id: cid(), name: "Finding the Lost Corridor", grantsMap: "Reunited", reqMaps: ["Her Lost Father", "Golden Fiddle"], audit: "10 Favor & Reunited Map, Req: 2 Mind's Eye OR Her Lost Father Map OR The Magic Fiddle Map, Act 2", filename: "Finding the Lost Corridor Card.jpg", act: 2, type: "adventure",
    cost: null, skills: [], requirements: ["minds_eye", "minds_eye"], rewards: {}, favor: 10, combo: "Reunited" },

  { id: cid(), name: "Forming a Bond", audit: "1 Survival, 7 Favor, Req: 1 Charisma, Act 1", filename: "Forming a Bond Card.jpg", act: 1, type: "adventure",
    cost: null, skills: ["survival"], requirements: ["charisma"], rewards: {}, favor: 7 },

  // AUDIT FIX 2026-07-13: Survival grant coin reads 3, not 5.
  { id: cid(), name: "The Tree Tunnels", special: "philosopher_stone", audit: "3 Survival, 2 Knowledge, 1 Philosopher's Stone, 3 Favor, Req: 1 Mind's Eye, Act 3", filename: "Friends in the Sky Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["survival", "survival", "survival", "knowledge", "knowledge"], requirements: ["minds_eye"], rewards: {}, favor: 3 },

  { id: cid(), name: "Fur Trading", audit: "8 Gold, 3 Favor, Req: 1 Charisma, Act 1", filename: "Fur Trading Card.jpg", act: 1, type: "adventure",
    cost: null, skills: [], requirements: ["charisma"], rewards: { gold: 8 }, favor: 3 },

  // AUDIT FIX 2026-07-14 (Wyatt confirmed): the card is 18 Gold -> 1 Knowledge +
  // 25 Favor. The Knowledge shield is bare (= x1); the "3" was never on it. I had
  // flagged the ART as the suspect here — wrong way round, the DATA was.
  { id: cid(), name: "Generous Donations", audit: "1 Knowledge, 25 Favor, Req: 18 Gold, Act 2", filename: "Generous Donation Card.jpg", act: 2, type: "adventure",
    cost: 18, skills: ["knowledge"], reqGold: 18, requirements: [], rewards: {}, favor: 25 },

  { id: cid(), name: "A Hidden Door", grantsMap: "The Shadow Guide", audit: "5 Favor & The Shadow Guide Map, Req: 3 Survival & 1 Knowledge, Act 2", filename: "Ghost Studies Card.jpg", act: 2, type: "adventure",
    cost: null, skills: [], requirements: ["survival", "survival", "survival", "knowledge"], rewards: {}, favor: 5 },

  { id: cid(), name: "Gold Luster", audit: "Req: 3 Alchemy & 1 Philosopher's Stone, Turn all your gold into prestige, Act 2", filename: "Glowing Manipulation Card.jpg", act: 2, type: "potion",
    cost: null, skills: [], requirements: ["alchemy", "alchemy", "alchemy", "philosopher_stone"], rewards: {},
    special: "gold_to_prestige" },

  { id: cid(), name: "Her Lost Father", grantsMap: "Finding the Lost Corridor", audit: "1 Prospecting & 3 Gold & 3 Scorn & Finding the Lost Corridor Map, No Req, Act 1", filename: "Her Lost Father Card.jpg", act: 1, type: "adventure",
    cost: null, skills: ["prospecting"], requirements: [], rewards: { gold: 3, scorn: 3 },
    special: "map_finding_lost_corridor" },

  { id: cid(), name: "Chemical Z", audit: "1 Philosopher's Stone & 5 Scorn & 15 Scorn to all other players, Req: 5 Alchemy & 5 Prospecting, Act 3", filename: "Liquid Doom Card.jpg", act: 3, type: "potion",
    cost: null, skills: [],
    requirements: ["alchemy", "alchemy", "alchemy", "alchemy", "alchemy", "prospecting", "prospecting", "prospecting", "prospecting", "prospecting"],
    // AUDIT FIX 2026-07-13: the card (and this row's own audit text) says OTHERS
    // receive 15 Scorn; only the special said 5. You still take 5 yourself.
    // NOTE: the art also prints a Philosopher's Stone shield the data has never
    // carried — but it's drawn with a SILVER (requirement) oval in a GRANT
    // position, so the art contradicts itself. Left alone pending a design call.
    rewards: { scorn: 5 }, special: "others_15_scorn" },

  { id: cid(), name: "Duplicating Goo", audit: "Gain gold equal to the amount of gold you have, Req: 3 Alchemy & 1 Philosopher's Stone, Act 2", filename: "Liquid Gold Card.jpg", act: 2, type: "potion",
    cost: null, skills: [], requirements: ["alchemy", "alchemy", "alchemy", "philosopher_stone"], rewards: {},
    special: "multiply_gold_x2" },

  { id: cid(), name: "Shot of Courage", audit: "Next Melee Flip a coin if the result is heads gain +4 Power, Req: 3 Alchemy & 3 Prospecting, Act 3", filename: "Liquid Wind Card.jpg", act: 3, type: "potion",
    cost: null, skills: [],
    requirements: ["alchemy", "alchemy", "alchemy", "prospecting", "prospecting", "prospecting"],
    rewards: {}, special: "coin_flip_4_power" },

  { id: cid(), name: "Life Essence", audit: "Choose one of your Active Missions: this Mission no longer has any Requirement, Req: 4 Alchemy & 1 Minds Eye, Act 3", filename: "Stream of Life Card.jpg", act: 3, type: "potion",
    cost: null, skills: [], requirements: ["alchemy", "alchemy", "alchemy", "alchemy", "minds_eye"], rewards: {},
    special: "remove_mission_requirements" },

  // AUDIT FIX 2026-07-13: the card and the engine special both say 13; only this
  // transcription said 15. Engine was right — the text was wrong.
  { id: cid(), name: "Mind Eraser", audit: "Remove 13 Scorn, Req: 1 Prospecting & 1 Alchemy, Act 3", filename: "Trouble Brew Card.jpg", act: 2, type: "potion",
    cost: null, skills: [], requirements: ["prospecting", "alchemy"], rewards: {},
    special: "remove_13_scorn" },

  { id: cid(), name: "Marketplace Sales", audit: "Gain 2 Gold for each Alchemy that both of your two neighboring players and yourself currently have. Req: 1 Alchemy & 1 Charisma, Act 2", filename: "Perscription Elixers Card.jpg", act: 2, type: "potion",
    cost: null, skills: [], requirements: ["alchemy", "charisma"], rewards: {},
    special: "gold_2_per_alchemy_triangle" },

  { id: cid(), name: "Market Trade Exchange", reqMaps: ["Great North Connection"], audit: "6 Charisma & 10 Gold Req: 4 Charisma & 4 Knowledge OR The Great North Connection Map, Act 3", filename: "Market Trade Exhange Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["charisma", "charisma", "charisma", "charisma", "charisma", "charisma"],
    requirements: ["charisma", "charisma", "charisma", "charisma", "knowledge", "knowledge", "knowledge", "knowledge"],
    rewards: { gold: 10 }, special: "trade_route" },

  { id: cid(), name: "Prospecting Journal", audit: "1 Knowledge & 1 Prospecting, Req: 1 Prospecting, Act 1", filename: "Prospecting Journal Card.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["knowledge", "prospecting"], requirements: ["prospecting"], rewards: {} },

  { id: cid(), name: "Badge of Courage", audit: "1 Knowledge * 5 Favor, Req: 5 Favor, Act 1", filename: "Badge of Courage Card.jpg", act: 1, type: "adventure",
    cost: null, skills: ["knowledge"], reqFavor: 5, requirements: [],
    rewards: {}, favor: 5 },

  // AUDIT FIX 2026-07-13: three bare Knowledge shields on the art = 3, not 4.
  { id: cid(), name: "Thorns of Treachery", audit: "3 Knowledge, Req: 3 Charisma, Act 2", filename: "Mystery Dueling Culb Card.jpg", act: 2, type: "endeavor",
    cost: null, skills: ["knowledge", "knowledge", "knowledge"], requirements: ["charisma", "charisma", "charisma"], rewards: {} },

  // AUDIT FIX 2026-07-13: grant coin reads 2 (the 4 is the REQUIREMENT coin).
  { id: cid(), name: "Fang's Truce", special: "favor_per_survival_x2", audit: "2 Survival & 2 Favor for each Survival you have, Req: 4 Survival, Act 3", filename: "nduring Hardship Card.jpg", act: 3, type: "endeavor",
    cost: null, skills: ["survival", "survival"], requirements: ["survival", "survival", "survival", "survival"], rewards: {} },

  { id: cid(), name: "Mystery Intrigue Club", audit: "7 Knowledge, Req: 2 Prospecting & 5 Gold, Act 3", filename: "Protecting Your Friends Card.jpg", act: 3, type: "endeavor",
    cost: 5, skills: ["knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge"],
    reqGold: 5, requirements: ["prospecting", "prospecting"], rewards: {} },

  { id: cid(), name: "Reckless Training", audit: "2 Power & 5 Scorn, Req none, Act 1", filename: "Reckless Training Card.jpg", act: 1, type: "endeavor",
    cost: null, skills: ["power", "power"], requirements: [], rewards: { scorn: 5 } },

  { id: cid(), name: "Reunited", special: "philosopher_stone", reqMaps: ["Finding the Lost Corridor"], audit: "22 Favor & 1 Philosopher's Stone, Req: 12 Knowledge & 1 Mind's Eye & 1 Philosopher's Stone OR Finding the Lost Corridor Map, Act 3", filename: "Reunited Card.jpg", act: 3, type: "adventure",
    cost: null, skills: [],
    requirements: ["knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "minds_eye", "philosopher_stone"],
    rewards: {}, favor: 22, combo: "Finding the Lost Corridor" },

  { id: cid(), name: "Great North Connection", grantsMap: "Market Trade Exchange", reqMaps: ["Helping the Merchant"], audit: "You may borrow Survival/Alchemy/Charisma/Prospecting from any player & 5 Favor & Market Trade Exchange Map, Req: 1 Charisma & 1 Power OR Helping the Merchant Map, Act 2", filename: "The Great Nort Connection Card.jpg", act: 2, type: "adventure",
    cost: null, skills: [], requirements: ["charisma", "power"], rewards: {}, favor: 5,
    special: "trade_route" },

  // AUDIT FIX 2026-07-13: the card prints a map scroll (the alternative to its
  // 5/5/5 requirement) that the data never carried — so the map route to playing
  // this card did not exist and you could only ever hard-cast it. The scroll
  // reads "Unexpected Companion", which is the PRINTED title of the mission this
  // data calls "A Day With the Birds" (the mission that grants this very map).
  { id: cid(), name: "The Alchemist's Daughter", reqMaps: ["A Day With the Birds"], audit: "1 Alchemy & 1 Mind's Eye & 18 Favor, Req: 5 Charisma, 5 Alchemy, 5 Power OR A Day With the Birds Map, Act 3", filename: "The Great Eagle Rider Card.jpg", act: 3, type: "adventure",
    cost: null, skills: ["alchemy"],
    requirements: ["charisma", "charisma", "charisma", "charisma", "charisma", "alchemy", "alchemy", "alchemy", "alchemy", "alchemy", "power", "power", "power", "power", "power"],
    rewards: {}, favor: 18, special: "minds_eye" },

  // AUDIT FIX 2026-07-13: the Mind's Eye grant coin reads 3. Data granted only 1
  // (bare `minds_eye`) while the audit text claimed 4 — all three disagreed.
  { id: cid(), name: "Shattering the Mirror Prison", reqMaps: ["The Shadow Guide"], audit: "3 Mind's Eye & 5 Favor, Req: 9 Knowledge OR The Shadow Guide Map, Act 3", filename: "Shattering the Mirror Prison Card.jpg", act: 3, type: "adventure",
    cost: null, skills: [], requirements: ["knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge", "knowledge"],
    rewards: {}, favor: 5, special: "minds_eye_x3" },

  { id: cid(), name: "Tribute to the Fallen", audit: "10 Favor, Act 2,Req: None", filename: "Tribute to the Fallen Card.jpg", act: 2, type: "adventure",
    cost: null, skills: [], requirements: [], rewards: {}, favor: 10 },

  { id: cid(), name: "Warm Mentorship", audit: "8 Favor, Act 1,Req: None", filename: "Warm Mentorship Card.jpg", act: 1, type: "adventure",
    cost: null, skills: [], requirements: [], rewards: {}, favor: 8 },

  // AUDIT FIX 2026-07-13: grant icon is the CAULDRON (alchemy), not a feather.
  { id: cid(), name: "Enchanted Flames", audit: "3 Alchemy & 2 Power, Req: 3 Prospecting & 3 Knowledge, Act 3", filename: "Flash Enchantment Card.jpg", act: 3, type: "weapon",
    cost: null, skills: ["alchemy", "alchemy", "alchemy", "power", "power"],
    requirements: ["prospecting", "prospecting", "prospecting", "knowledge", "knowledge", "knowledge"], rewards: {} },

  // ═══ ACT 3 — PINK/PURPLE BORDER ════════════════════════════════

  { id: cid(), name: "Eight Stances", audit: "1 Knowledge, Req: none, Act 1", filename: "Eight Stances.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["knowledge"], requirements: [], rewards: {} },

  { id: cid(), name: "Philosopher's Stone", audit: "1 Knowledge & 1 Philosopher's Stone, Req: 1 Knowledge & 1 Prospecting & 1 Alchemy, Act 2", filename: "Elder Wand Card.jpg", act: 2, type: "artifact",
    cost: null, skills: ["knowledge"], requirements: ["knowledge", "prospecting", "alchemy"], rewards: {},
    special: "philosopher_stone" },

  { id: cid(), name: "Fortune Teller", audit: "1 Mind's Eye & 3 Scorn, Req: None, Act 2", filename: "Fortune Teller Card.jpg", act: 2, type: "artifact",
    cost: null, skills: [], requirements: [], rewards: { scorn: 3 }, special: "minds_eye" },

  { id: cid(), name: "Forgotten Temple", grantsMap: "Sacred Chest", audit: "Map of Sacred Chest & 1 Knowledge & 2 Scorn, Req: None, Act 1", filename: "Forgotten Temple.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["knowledge"], requirements: [], rewards: { scorn: 2 },
    special: "sacred_chest" },

  { id: cid(), name: "Philosopher's Scepter", audit: "2 Knowledge & 1 Philosopher's Stone, No Req, Act 3", filename: "Apprentice Wand Card.jpg", act: 3, type: "artifact",
    cost: null, skills: ["knowledge", "knowledge"], requirements: [], rewards: {}, special: "philosopher_stone" },

  { id: cid(), name: "Oaths of the Crown", audit: "1 Knowledge, Req: none, Act 1", filename: "Oaths Crown.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["knowledge"], requirements: [], rewards: {} },

  { id: cid(), name: "Father's Teachings", audit: "1 Knowledge, Req: none, Act 1", filename: "Herbology 101 Card.jpg", act: 1, type: "wisdom",
    cost: null, skills: ["knowledge"], requirements: [], rewards: {} },

  { id: cid(), name: "Lens of Truth", audit: "3 Survival & 1 Mind's Eye, Req: None, Act 3", filename: "Lens of Truth Card.jpg", act: 3, type: "wisdom",
    cost: null, skills: ["survival", "survival", "survival"], requirements: [], rewards: {}, special: "minds_eye" },

  { id: cid(), name: "Mind's Eye", audit: "1 Alchemy & 1 Mind's Eye, Req: 1 Alchemy & 1 Prospecting & 1 Knowledge, Act 2", filename: "Mind_s Eye Card.jpg", act: 2, type: "artifact",
    cost: null, skills: ["alchemy"], requirements: ["alchemy", "prospecting", "knowledge"], rewards: {},
    special: "minds_eye" },

  { id: cid(), name: "Royal Library", audit: "5 Knowledge, Req: None, Act 3", filename: "Royal Library.jpg", act: 3, type: "endeavor",
    cost: null, skills: ["knowledge", "knowledge", "knowledge", "knowledge", "knowledge"], requirements: [], rewards: {}, special: "knowledge_x5" },

  { id: cid(), name: "Sacred Stone", audit: "1 Philosopher's Stone & 5 Scorn, Req: None, Act 2", filename: "Sacred Stone Card.jpg", act: 2, type: "artifact",
    cost: null, skills: [], requirements: [], rewards: { scorn: 5 }, special: "philosopher_stone" },

  { id: cid(), name: "Family Ring", audit: "Favor equal to your total Knowledge x2,Req: 3 Knowledge & 1 Philosopher's Stone, Act 3", filename: "Time Turner Card.jpg", act: 3, type: "artifact",
    cost: null, skills: [], requirements: ["knowledge", "knowledge", "knowledge", "philosopher_stone"], rewards: {},
    special: "favor_per_knowledge_x2" },

  { id: cid(), name: "Lucky Pendant", special: "favor_per_quest_x5", audit: "Favor equal to your total Successful Quests x5,Req: 5 Prospecting, Act 3", filename: "Lucky Pendant Card.jpg", act: 3, type: "artifact",
    cost: null, skills: [], requirements: ["prospecting", "prospecting", "prospecting", "prospecting", "prospecting"], rewards: {} },

  { id: cid(), name: "Great Vault Key", special: "favor_per_sur_cha_pro", audit: "1 Favor for each Survival you have & 1 Favor for each Charisma you have & 1 Favor for each Prospecting you have, Req: 4 Gold, Act 3", filename: "Great Vault Key Card.jpg", act: 3, type: "artifact",
    cost: 4, skills: [], reqGold: 4, requirements: [], rewards: {} },

  { id: cid(), name: "Sacred Chest", reqMaps: ["Forgotten Temple"], audit: "8 Favor for each Wisdom Card you have, Req: 12 Gold OR Forgotten Temple Map,Act 3", filename: "Sacred Chest Card.jpg", act: 3, type: "artifact",
    cost: 12, skills: [], reqGold: 12, requirements: [], rewards: {}, special: "favor_per_wisdom_x8" },

  { id: cid(), name: "Secret Lab", audit: "5 Favor for each Potions Card you have, Req: 2 Mind's Eye,Act 3", filename: "Secret Lab Card.jpg", act: 3, type: "artifact",
    cost: null, skills: [], requirements: ["minds_eye", "minds_eye"], rewards: {},
    special: "minds_eye_x2_philosopher_stone_x5" },

  { id: cid(), name: "Royal Hilt", audit: "1 Favor for each Power your left & right neighbor have, Req: 2 Power & 1 Mind's Eye, Act 3", filename: "Golden Snitch Card.jpg", act: 3, type: "weapon",
    cost: null, skills: [], requirements: ["power", "power", "minds_eye"], rewards: {}, special: "favor_per_neighbor_power" },

  { id: cid(), name: "Lost North Map", reqMaps: ["Man's Best Friend", "Moment of Reflection"], audit: "5 Favor, Req: 3 Survival & 3 Prospecting & 1 Mind's Eye OR Man's Best Friend Map OR Moment of Reflection Map, Act 2", filename: "Lost North Map.jpg", act: 2, type: "adventure",
    cost: null, skills: [], requirements: ["survival", "survival", "survival", "prospecting", "prospecting", "prospecting", "minds_eye"], rewards: {}, favor: 5,
    combo: "1/2", special: "map" },

  // AUDIT FIX 2026-07-14 (art v7): the three requirement shields are BARE — 1
  // Survival, 1 Charisma, 1 Mind's Eye. The old 3/3/1 came from the print-res
  // original in ~/Downloads/Favor_Assets/, which is STALE for this one card: it
  // still carries the x3 coins AND the pre-rename "The Thinking Tree" scroll.
  // The art shipped in the game already had neither. ⚠ This leaves the South
  // half far cheaper than the North (which really does keep 3 Survival + 3
  // Prospecting) — flagged to Wyatt as possibly-unintended asymmetry.
  { id: cid(), name: "Lost South Map", reqMaps: ["Cameron's Expedition", "Tunnel of Trinkets"], audit: "5 Favor & If you have the Lost North Map 20 additional Favor, Req: 1 Survival & 1 Charisma & 1 Mind's Eye OR Cameron's Expedition Map OR Tunnel of Trinkets Map, Act 2", filename: "Lost South Map.jpg", act: 2, type: "adventure",
    cost: null, skills: [], requirements: ["survival", "charisma", "minds_eye"], rewards: {}, favor: 5,
    combo: "2/2", special: "map" },

  // ═══ GREY/SILVER — WEAPONS ══════════════════════════════════════

  { id: cid(), name: "Tombstone", audit: "1 power, req: none, Act 1", filename: "Beat Stick Card.jpg", act: 1, type: "weapon",
    cost: null, skills: ["power"], requirements: [], rewards: {} },

  { id: cid(), name: "Shark Tooth", audit: "2 power, req: 1 Gold, Act 1", filename: "Dusty Card.jpg", act: 1, type: "weapon",
    cost: 1, skills: ["power", "power"], reqGold: 1, requirements: [], rewards: {} },

  { id: cid(), name: "Ol' Bessy", audit: "1 power, req: none, Act 1", filename: "Ol_ Bessy Card.jpg", act: 1, type: "weapon",
    cost: null, skills: ["power"], requirements: [], rewards: {} },

  { id: cid(), name: "Training Friend", audit: "1 power, req: none, Act 1", filename: "Training Friend.jpg", act: 1, type: "weapon",
    cost: null, skills: ["power"], requirements: [], rewards: {} },

  // AUDIT FIX 2026-07-13 (visual, art = ground truth): Deadeye's data was fully
  // INVERTED here. The printed card REQUIRES 5 Survival (leaf x5, silver ovals,
  // left) and GRANTS 2 Mind's Eye + 1 Power (gold ovals, right). It is a real
  // power card. This fix was made in the retired `testrealm/` realm on 7/10 and
  // was LOST when testrealm2 was promoted to root on 7/12 — restored here, along
  // with the `minds_eye_x2` engine hook it depends on.
  { id: cid(), name: "Deadeye", audit: "2 Mind's Eye & 1 Power, Req: 5 Survival, Act 3", filename: "All Seer Card.jpg", act: 3, type: "weapon",
    cost: null, skills: ["power"],
    requirements: ["survival", "survival", "survival", "survival", "survival"], rewards: {},
    special: "minds_eye_x2" },

  { id: cid(), name: "Blind Faith", audit: "1 power, req: none, Act 2", filename: "Griffin Boots Card.jpg", act: 2, type: "weapon",
    cost: null, skills: ["power"], requirements: [], rewards: {}, combo: "1/2" },

  { id: cid(), name: "Heaven's Blade", special: "power_6_if_blind_faith", audit: "2 Power & 6 Additional Power if you own Blind Faith, Req: 2 Knowledge, Act 3", filename: "Griffin Talons Card.jpg", act: 3, type: "weapon",
    cost: null, skills: ["power", "power"], requirements: ["knowledge", "knowledge"], rewards: {}, combo: "2/2" },

  { id: cid(), name: "Archeus", audit: "5 Scorn & All other Players must discard 1 weapon card they have & 6 Additional Power if you own Blind Faith, Req: 4 Survival, 4 Knowledge, 1 Mind's Eye, Act 3", filename: "Griffin Wings Card.jpg", act: 3, type: "weapon",
    cost: null, skills: [], requirements: ["survival", "survival", "survival", "survival", "knowledge", "knowledge", "knowledge", "knowledge", "minds_eye"], rewards: { scorn: 5 },
    combo: "2/2", special: "discard_opponent_weapon" },

  // AUDIT FIX 2026-07-13: the audit text was garbled — "Req: 2 Prospecting &
  // 1 Prospecting" is a corruption of "Req: 2 Gold & 1 Prospecting". The card
  // prints ONE bare Prospecting shield and a real 2-gold coin. That corruption
  // is what inflated requirements to 3 Prospecting.
  { id: cid(), name: "Wild Steel", audit: "2 Power, 2 Survival, Req: 2 Gold & 1 Prospecting, Act 2", filename: "Seeker Goggles Card.jpg", act: 2, type: "weapon",
    cost: 2, skills: ["power", "power", "survival", "survival"], reqGold: 2, requirements: ["prospecting"], rewards: {} },

  { id: cid(), name: "Dawnharbinger", grantsMap: "King of the Sky", audit: "1 Power, 2 Charisma, The King of the Sky Map, Req: 1 Survival & 1 Prospecting, Act 2", filename: "Keeper Gloves Card.jpg", act: 2, type: "weapon",
    cost: null, skills: ["power", "charisma", "charisma"], requirements: ["survival", "prospecting"], rewards: {},
    special: "king_of_the_sky" },

  { id: cid(), name: "Destroyer", audit: "4 Power, Req: 3 Prospecting, Act 2", filename: "Angry Beaters Card.jpg", act: 2, type: "weapon",
    cost: null, skills: ["power", "power", "power", "power"], requirements: ["prospecting", "prospecting", "prospecting"], rewards: {} },

  { id: cid(), name: "Guardian", grantsMap: "Defend the Throne", audit: "2 Power, 1 Prospecting, Defend the Throne Map, Req: 1 Power & 1 Prospecting, Act 2", filename: "Guardian Card.jpg", act: 2, type: "weapon",
    cost: null, skills: ["power", "power", "prospecting"], requirements: ["power", "prospecting"], rewards: {},
    special: "defend_the_throne" },

  { id: cid(), name: "Blackbird", audit: "2 Power, Req: 1 Survival, Act 1", filename: "Teather Bark Card.jpg", act: 1, type: "weapon",
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
