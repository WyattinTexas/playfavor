/**
 * FAVOR — The Ledger of Deeds
 *
 * Deeds are the SECOND trophy system, deliberately separate from the
 * achievements in data/achievements.js: those pay Stars and keep their own
 * gallery off the title screen, untouched. A deed pays NOTHING (Skylar 8/3)
 * — a name, a rank, and the moment it fires. That is the whole reward, and
 * it is why this list can be long and strange: with no currency attached,
 * a deed for finishing on minus fourteen costs the economy nothing.
 *
 * Because there are no Stars, the RANK cannot be derived from a payout the
 * way achievementTier() derives one — so `rank` is an explicit field here.
 *   bronze · silver · gold · platinum · legendary
 *
 * Flags:
 *   secret — hidden in the gallery until it fires; the name IS the reward
 *   ruin   — a disaster: it celebrates in the cracked ash frame, not gold
 *
 * `check(s)` must be PURE — no side effects, no engine calls. Everything it
 * needs is on the snapshot built by js/deeds.js (see seatSnapshot there for
 * the full field list). A check that throws is caught and treated as false,
 * so a bad deed can never take the victory screen down with it.
 *
 * `num` is the plan's catalogue number (deeds-preview.html) — kept so a
 * conversation about "C4" and a row in this file are obviously the same
 * thing. `id` is the storage key and must never change once shipped.
 */

window.FAVOR_DATA = window.FAVOR_DATA || {};

window.FAVOR_DATA.deedRanks = ['bronze', 'silver', 'gold', 'platinum', 'legendary'];

// The six card types, as data/cards.js spells them.
const DEED_TYPES = ['endeavor', 'weapon', 'artifact', 'adventure', 'potion', 'wisdom'];

window.FAVOR_DATA.deeds = [

    // ══ A · The Almanac ══════════════════════════════════════════════
    // These read the Almanac's lifetime book. It lives per-device until the
    // book syncs to the player record, so `s.alm` is null when the Almanac
    // is absent and every check here folds to false rather than throwing.
    {
        id: 'alm_first', num: 'A1', rank: 'bronze',
        name: 'First Light',
        desc: 'Record your first entry in the Almanac.',
        check: (s) => !!s.alm && (s.alm.cards + s.alm.missions) >= 1,
    },
    {
        id: 'alm_act1', num: 'A2', rank: 'gold',
        name: 'The First Chapter',
        desc: 'Discover every card in Act I.',
        check: (s) => !!s.alm && s.alm.acts[1] && s.alm.acts[1].got >= s.alm.acts[1].total,
    },
    {
        id: 'alm_act2', num: 'A3', rank: 'gold',
        name: 'The Second Chapter',
        desc: 'Discover every card in Act II.',
        check: (s) => !!s.alm && s.alm.acts[2] && s.alm.acts[2].got >= s.alm.acts[2].total,
    },
    {
        id: 'alm_act3', num: 'A4', rank: 'gold',
        name: 'The Third Chapter',
        desc: 'Discover every card in Act III.',
        check: (s) => !!s.alm && s.alm.acts[3] && s.alm.acts[3].got >= s.alm.acts[3].total,
    },
    {
        id: 'alm_weapon', num: 'A5a', rank: 'silver',
        name: 'The Armory',
        desc: 'Discover every Weapon.',
        check: (s) => deedTypeFull(s, 'weapon'),
    },
    {
        id: 'alm_potion', num: 'A5b', rank: 'silver',
        name: 'The Apothecary',
        desc: 'Discover every Potion.',
        check: (s) => deedTypeFull(s, 'potion'),
    },
    {
        id: 'alm_artifact', num: 'A5c', rank: 'silver',
        name: 'The Reliquary',
        desc: 'Discover every Artifact.',
        check: (s) => deedTypeFull(s, 'artifact'),
    },
    {
        id: 'alm_adventure', num: 'A5d', rank: 'silver',
        name: "The Wanderer's Road",
        desc: 'Discover every Adventure.',
        check: (s) => deedTypeFull(s, 'adventure'),
    },
    {
        id: 'alm_endeavor', num: 'A5e', rank: 'silver',
        name: 'The Ledger of Endeavors',
        desc: 'Discover every Endeavor.',
        check: (s) => deedTypeFull(s, 'endeavor'),
    },
    {
        id: 'alm_wisdom', num: 'A5f', rank: 'silver',
        name: 'The Library',
        desc: 'Discover every Wisdom.',
        check: (s) => deedTypeFull(s, 'wisdom'),
    },
    {
        id: 'alm_missions', num: 'A6', rank: 'legendary',
        name: 'The Mission Roll',
        desc: 'Complete all thirty-six missions across your games.',
        check: (s) => !!s.alm && s.alm.missions >= s.alm.missionsTotal,
    },
    {
        id: 'alm_full', num: 'A7', rank: 'legendary',
        name: 'Bound in Full',
        desc: 'Every card and every mission in the Almanac. The whole book.',
        check: (s) => !!s.alm && s.alm.cards >= s.alm.cardsTotal
            && s.alm.missions >= s.alm.missionsTotal,
    },

    // ══ B · Rituals of the Hand ══════════════════════════════════════
    {
        id: 'ritual_5', num: 'B1', rank: 'bronze',
        name: 'A Familiar Hand',
        desc: 'Play any one card five times across your games.',
        check: (s) => !!s.alm && s.alm.topCard >= 5,
    },
    {
        id: 'ritual_10', num: 'B2', rank: 'silver',
        name: 'Ritual of Ten',
        desc: 'Play the same card ten times.',
        check: (s) => !!s.alm && s.alm.topCard >= 10,
    },
    {
        id: 'full_court', num: 'B3', rank: 'gold',
        name: 'The Full Court',
        desc: 'Play a card of every type in a single game.',
        check: (s) => DEED_TYPES.every(t => (s.typesPlayed || []).includes(t)),
    },
    {
        id: 'artifacts_3', num: 'B4', rank: 'silver',
        name: 'The Reliquary Hoard',
        desc: 'Hold three Artifacts on your field at once.',
        check: (s) => (s.peakOnField || {}).artifact >= 3,
    },
    {
        id: 'weapons_5', num: 'B5', rank: 'silver',
        name: 'Bristling',
        desc: 'Hold five Weapons on your field at once.',
        check: (s) => (s.peakOnField || {}).weapon >= 5,
    },
    {
        id: 'empty_hand', num: 'B6', rank: 'silver',
        name: 'Nothing Left to Play',
        desc: 'Finish a game with an empty hand.',
        check: (s) => s.handLeft === 0,
    },

    // ══ C · Ruin & Comedy ════════════════════════════════════════════
    {
        id: 'in_the_red', num: 'C1', rank: 'silver', ruin: true,
        name: 'In the Red',
        desc: 'Finish a game with a negative final score.',
        check: (s) => s.finalScore < 0,
    },
    {
        id: 'scorn_10', num: 'C2', rank: 'bronze', ruin: true,
        name: 'The Scorned',
        desc: 'End a game carrying ten Scorn.',
        check: (s) => s.scorn >= 10,
    },
    {
        id: 'rock_bottom', num: 'C3', rank: 'gold', ruin: true,
        name: 'Rock Bottom',
        desc: 'Finish last, in the negative, with no gold left.',
        check: (s) => s.finalScore < 0 && s.gold <= 0
            && s.tableSize > 1 && s.place === s.tableSize - 1,
    },
    {
        id: 'debtors_prison', num: 'C4', rank: 'gold', ruin: true,
        name: "Debtor's Prison",
        desc: 'End a game owing gold.',
        check: (s) => s.gold < 0,
    },
    {
        id: 'pauper_king', num: 'C5', rank: 'silver',
        name: 'The Pauper King',
        desc: 'Win with the least gold at the table.',
        check: (s) => s.won && s.tableSize > 1 && s.goldRank === s.tableSize - 1,
    },
    {
        id: 'photo_finish', num: 'C6', rank: 'gold',
        name: 'Photo Finish',
        desc: 'Win a game decided on the gold tiebreaker.',
        check: (s) => s.won && s.tiedOnScore,
    },
    {
        id: 'long_road', num: 'C7', rank: 'platinum',
        name: 'The Long Road Back',
        desc: 'Win after entering Act III in last place.',
        check: (s) => s.won && s.tableSize > 1
            && s.actThreePlace === s.tableSize - 1,
    },

    // ══ D · Mastery ══════════════════════════════════════════════════
    {
        id: 'renaissance', num: 'D1', rank: 'platinum',
        name: 'The Renaissance Heir',
        desc: 'Reach five in all six skills in one game.',
        check: (s) => ['survival', 'charisma', 'alchemy', 'prospecting', 'knowledge', 'power']
            .every(k => (s.peakSkills || {})[k] >= 5),
    },
    {
        id: 'twin_peaks', num: 'D2', rank: 'gold',
        name: 'Twin Peaks',
        desc: 'Reach ten in two different skills in one game.',
        check: (s) => Object.values(s.peakSkills || {}).filter(v => v >= 10).length >= 2,
    },
    {
        id: 'juggernaut', num: 'D3', rank: 'gold',
        name: 'The Juggernaut',
        desc: 'Reach fifteen Power in a single game.',
        check: (s) => s.peakPower >= 15,
    },
    {
        id: 'purse_50', num: 'D4', rank: 'silver',
        name: "The King's Purse",
        desc: 'Hold fifty Gold at once.',
        check: (s) => s.peakGold >= 50,
    },
    {
        id: 'score_150', num: 'D5', rank: 'platinum',
        name: 'A Reign of Legend',
        desc: 'Win with a final score over one hundred and fifty.',
        check: (s) => s.won && s.finalScore > 150,
    },
    {
        id: 'streak_3', num: 'D6', rank: 'gold',
        name: 'Unbroken',
        desc: 'Win three games in a row.',
        check: (s) => s.bestStreak >= 3,
    },
    {
        id: 'streak_10', num: 'D7', rank: 'platinum',
        name: 'The Dynasty',
        desc: 'Win ten games in a row.',
        check: (s) => s.bestStreak >= 10,
    },

    // ══ E · Service to the Realm ═════════════════════════════════════
    {
        id: 'three_acts', num: 'E1', rank: 'silver',
        name: 'Servant of Three Acts',
        desc: 'Complete a mission in every act of one game.',
        check: (s) => [1, 2, 3].every(a => (s.missionLog || []).some(m => m.act === a)),
    },
    {
        id: 'perfect_record', num: 'E2', rank: 'gold',
        name: 'A Perfect Record',
        desc: 'Complete every mission you accepted — at least three, none failed.',
        check: (s) => s.missionsCompleted >= 3 && s.missionsFailed === 0,
    },
    {
        id: 'whole_court', num: 'E3', rank: 'gold',
        name: 'The Whole Court Helped',
        desc: 'Complete a mission with skill borrowed from three different rivals.',
        check: (s) => (s.missionLog || []).some(m => m.lenders >= 3),
    },
    {
        id: 'labyrinth', num: 'E4', rank: 'gold',
        name: 'Out of the Maze',
        desc: 'Complete The Labyrinth.',
        check: (s) => (s.missionLog || []).some(m => m.name === 'The Labyrinth'),
    },
    {
        id: 'prompt_service', num: 'E5', rank: 'silver',
        name: 'Prompt Service',
        desc: 'Turn a mission in during the very act it opens.',
        check: (s) => (s.missionLog || []).some(m => m.act === m.openedAct),
    },

    // ══ F · Heroes & Boards ══════════════════════════════════════════
    {
        id: 'sideb_one', num: 'F1', rank: 'silver',
        name: 'The Other Face',
        desc: 'Unlock Side B on any hero.',
        check: (s) => s.sideBUnlocked >= 1,
    },
    {
        id: 'sideb_win', num: 'F2', rank: 'gold',
        name: 'The Turned Card',
        desc: 'Win a game playing a Side B board.',
        check: (s) => s.won && s.onSideB,
    },
    {
        id: 'sideb_all', num: 'F3', rank: 'legendary',
        name: 'Ten Faces',
        desc: 'Unlock Side B on every hero.',
        check: (s) => s.sideBUnlocked >= s.heroesTotal && s.heroesTotal > 0,
    },
    {
        id: 'played_all', num: 'F4', rank: 'gold',
        name: 'Know Every Face',
        desc: 'Play a game as each of the ten heroes.',
        check: (s) => s.heroesPlayed >= s.heroesTotal && s.heroesTotal > 0,
    },
    {
        id: 'natural_talent', num: 'F5', rank: 'silver',
        name: 'Natural Talent',
        desc: 'Win the first game you ever play with a hero.',
        check: (s) => s.won && s.gamesWithHero === 1,
    },
    {
        id: 'end_of_track', num: 'F6', rank: 'bronze',
        name: 'To the End of the Track',
        desc: "Finish a game standing on your board's final slot.",
        check: (s) => s.slotCount > 0 && s.slotPos === s.slotCount - 1,
    },

    // ══ G · The Table ════════════════════════════════════════════════
    {
        id: 'five_player_win', num: 'G1', rank: 'gold',
        name: 'Against the Field',
        desc: 'Win a five-player game.',
        check: (s) => s.won && s.tableSize >= 5,
    },
    {
        id: 'beat_human', num: 'G2', rank: 'gold',
        name: 'First Among Peers',
        desc: 'Win a game against another person.',
        check: (s) => s.won && s.humans >= 2,
    },
    {
        id: 'bounty_collected', num: 'G3', rank: 'silver',
        name: 'Bounty Collected',
        desc: "Finish ahead of the day's WANTED rival.",
        check: (s) => s.beatRival,
    },
    {
        id: 'the_regulars', num: 'G4', rank: 'gold',
        name: 'The Regulars',
        desc: 'Play ten games with other people at the table.',
        check: (s) => s.humanGames >= 10,
    },
    {
        id: 'perennial', num: 'G5', rank: 'platinum',
        name: 'The Perennial',
        desc: 'Be crowned Champion of the Day twenty-five times.',
        check: (s) => s.dailyCrowns >= 25,
    },

    // ══ H · Sealed ═══════════════════════════════════════════════════
    {
        id: 'devil_went_down', num: 'H1', rank: 'platinum', secret: true,
        name: 'The Devil Went Down',
        desc: 'Complete the Golden Fiddle mission playing as the Fiddler.',
        check: (s) => s.characterId === 'fiddler'
            && (s.missionLog || []).some(m => m.name === 'Golden Fiddle'),
    },
    {
        id: 'bandits_bounty', num: 'H2', rank: 'gold', secret: true,
        name: "Bandit's Bounty",
        desc: 'Steal ten Gold from the table in a single game.',
        check: (s) => s.goldStolen >= 10,
    },
    {
        id: 'long_way_round', num: 'H3', rank: 'platinum', secret: true,
        name: 'The Long Way Round',
        desc: 'Reach Reunited the honest way — every step of the chain in one game.',
        check: (s) => ['Her Lost Father', 'Finding the Lost Corridor', 'Reunited']
            .every(n => (s.cardsPlayed || []).includes(n)),
    },
    {
        id: 'doctor_is_in', num: 'H4', rank: 'gold', secret: true,
        name: 'The Doctor Is In',
        desc: "Take the free potion in all three acts of one game.",
        check: (s) => [1, 2, 3].every(a => (s.freePotionActs || []).includes(a)),
    },
    {
        id: 'winter_of_court', num: 'H5', rank: 'silver', secret: true, ruin: true,
        name: 'Winter of the Court',
        desc: 'Lose a game having completed no mission and played no card.',
        check: (s) => !s.won && s.cardsPlayedCount === 0 && s.missionsCompleted === 0,
    },
    {
        id: 'price_of_promise', num: 'H6', rank: 'platinum', secret: true, ruin: true,
        name: 'The Price of a Promise',
        desc: "Take more than 80 Prestige from A Knight's Promise in one game.",
        check: (s) => s.promisePrestige > 80,
    },
    {
        id: 'last_page', num: 'H7', rank: 'legendary', secret: true,
        // THE CAPSTONE. `s.deedsHeld` is the set of deeds granted INCLUDING
        // the ones landing in this very sync (js/deeds.js folds them in
        // before testing), so the deed that completes the ledger and this
        // one celebrate in the same breath — the pattern The Master uses.
        // capstone:true keeps it out of its own requirement.
        capstone: true,
        name: 'The Last Page',
        desc: 'Earn every other deed in the ledger.',
        check: (s) => s.deedsOutstanding === 0,
    },
];

// Every card of a type discovered? The Almanac counts by NAME, and the
// totals come from the live card data, so adding cards moves the goalposts
// for anyone who has not finished that shelf yet.
function deedTypeFull(s, type) {
    if (!s.alm || !s.alm.types || !s.alm.types[type]) return false;
    const t = s.alm.types[type];
    return t.total > 0 && t.got >= t.total;
}
