/**
 * FAVOR — Achievement Database
 *
 * Mirrors Nation's system: every achievement carries a Stars reward, and the
 * TIER derives purely from that number, so the data stays a single int.
 *   Bronze 10 · Silver 20 · Gold 30–40 · Platinum 50 · Legendary 200
 *
 * Stars are the same currency the character store spends (★100 per hero, first
 * five free) — so earning these is how you unlock the rest of the roster.
 * Total on offer: 570★, against the 500★ needed for all five locked heroes.
 *
 * `check` runs at game over against a snapshot of YOUR seat and your lifetime
 * stats — see js/achievements.js. It must be a pure function: no side effects,
 * no engine calls. Anything it needs is on the snapshot.
 *
 *   s.won            — you placed first
 *   s.characterId    — the hero you played
 *   s.peakPower      — the highest Power you reached in the game
 *   s.peakGold       — the most Gold you held at once
 *   s.potionsPlayed  — Potion cards on your field at the end
 *   s.foretoldDoom   — you failed The Labyrinth holding the Fortune Teller
 *   s.charWins       — { characterId: true } — heroes you have EVER won with
 *   s.dailyPodiums   — times you have finished top three on a daily board
 *   s.dailyCrowns    — times you have been Champion of the Day
 */

window.FAVOR_DATA = window.FAVOR_DATA || {};

// Nation's thresholds, unchanged.
window.FAVOR_DATA.achievementTier = (stars) =>
    stars >= 200 ? 'legendary'
  : stars >= 50  ? 'platinum'
  : stars >= 30  ? 'gold'
  : stars >= 20  ? 'silver'
  :                'bronze';

// The ten heroes, in roster order. A victory with each is its own achievement —
// the ids here MUST match data/characters.js.
const HEROES = [
    ['explorer',  'Explorer',  "The Explorer's Victory"],
    ['knight',    'Knight',    "A Knight's Victory"],
    ['bandit',    'Bandit',    "The Bandit's Victory"],
    ['merchant',  'Merchant',  "The Merchant's Victory"],
    ['fisherman', 'Fisherman', "The Fisherman's Victory"],
    ['duchess',   'Duchess',   "The Duchess's Victory"],
    ['scientist', 'Scientist', "The Scientist's Victory"],
    ['doctor',    'Doctor',    "The Doctor's Victory"],
    ['fiddler',   'Fiddler',   "The Fiddler's Victory"],
    ['magician',  'Magician',  "The Magician's Victory"],
];

const HERO_VICTORIES = HEROES.map(([id, name, title]) => ({
    id: `win_${id}`,
    name: title,
    desc: `Claim the throne as the ${name}.`,
    stars: 20,                                   // Silver ×10 = 200★
    hero: id,
    check: (s) => s.won && s.characterId === id,
}));

window.FAVOR_DATA.achievements = [

    ...HERO_VICTORIES,

    {
        id: 'master_of_all',
        name: 'The Master',
        desc: 'Claim the throne as all ten heroes.',
        stars: 200,                              // Legendary
        check: (s) => HEROES.every(([id]) => s.charWins[id]),
    },

    // ── The daily board ───────────────────────────────────────────────
    {
        id: 'daily_podium',
        name: 'On the Podium',
        desc: 'Finish a day in the top three of the daily board.',
        stars: 30,                               // Gold
        check: (s) => s.dailyPodiums >= 1,
    },
    {
        id: 'daily_crown_5',
        name: 'Five-Time Champion',
        desc: 'Be crowned Champion of the Day five times.',
        stars: 50,                               // Platinum
        check: (s) => s.dailyCrowns >= 5,
    },

    // ── Skill mastery: reach 10 of a skill in one game (Wyatt 7/17) ───
    {
        id: 'skill_power_10',
        name: 'Force of Arms',
        desc: 'Reach 10 Power in a single game.',
        stars: 10,                               // Bronze
        check: (s) => (s.peakSkills && s.peakSkills.power >= 10),
    },
    {
        id: 'skill_knowledge_10',
        name: 'The Great Scholar',
        desc: 'Reach 10 Knowledge in a single game.',
        stars: 10,
        check: (s) => (s.peakSkills && s.peakSkills.knowledge >= 10),
    },
    {
        id: 'skill_alchemy_10',
        name: 'Master Alchemist',
        desc: 'Reach 10 Alchemy in a single game.',
        stars: 10,
        check: (s) => (s.peakSkills && s.peakSkills.alchemy >= 10),
    },
    {
        id: 'skill_prospecting_10',
        name: 'Deep Prospector',
        desc: 'Reach 10 Prospecting in a single game.',
        stars: 10,
        check: (s) => (s.peakSkills && s.peakSkills.prospecting >= 10),
    },
    {
        id: 'skill_charisma_10',
        name: 'The Silver Tongue',
        desc: 'Reach 10 Charisma in a single game.',
        stars: 10,
        check: (s) => (s.peakSkills && s.peakSkills.charisma >= 10),
    },
    {
        id: 'skill_survival_10',
        name: 'Born Survivor',
        desc: 'Reach 10 Survival in a single game.',
        stars: 10,
        check: (s) => (s.peakSkills && s.peakSkills.survival >= 10),
    },

    // ── Mission feats (Wyatt 7/17) ────────────────────────────────────
    {
        id: 'missions_5',
        name: 'The Realm\'s Champion',
        desc: 'Complete five missions in a single game.',
        stars: 20,                               // Silver
        check: (s) => (s.missionsCompleted || 0) >= 5,
    },
    {
        id: 'missions_failed_5',
        name: 'Best-Laid Plans',
        desc: 'Fail five missions in a single game.',
        stars: 20,                               // Silver
        check: (s) => (s.missionsFailed || 0) >= 5,
    },

    // ── Single-game feats ─────────────────────────────────────────────
    {
        id: 'gold_30',
        name: "A Merchant's Purse",
        desc: 'Hold more than 30 Gold in a single game.',
        stars: 10,                               // Bronze
        check: (s) => s.peakGold > 30,
    },
    {
        id: 'potions_5',
        name: 'The Apothecary',
        desc: 'Play five Potions in a single game.',
        stars: 20,                               // Silver
        check: (s) => s.potionsPlayed >= 5,
    },

    // ── Secret ────────────────────────────────────────────────────────
    // Hidden in the gallery until it fires: the name and description are the
    // reward. Do not surface the hint anywhere.
    {
        id: 'foretold_doom',
        name: 'She Saw It Coming',
        desc: 'Fail The Labyrinth while the Fortune Teller sits on your field.',
        stars: 50,                               // Platinum
        secret: true,
        check: (s) => s.foretoldDoom,
    },
];
