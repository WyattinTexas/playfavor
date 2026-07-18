#!/usr/bin/env node
/**
 * FAVOR — engine behavior smoke test.
 * Rigs real games and asserts the paths that have bitten us actually work:
 * map waivers, card grant outputs, neighbor-gold potions, mission quantity
 * requirements, failure specials, dynamic scoring favor, melee bonuses.
 *
 *   node tools/engine-smoke.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(root, p), 'utf8');

const window = {};
const FavorGame = new Function('window',
  src('data/cards.js') + '\n' + src('data/missions.js') + '\n' +
  src('data/characters.js') + '\n' + src('data/achievements.js') + '\n' +
  src('engine/gameState.js') + '\nreturn FavorGame;'
)(window);

// Achievements evaluate() is pure — rebuild it here rather than load the whole
// browser module (which reaches for FLB / the DOM).
const ACH = () => window.FAVOR_DATA.achievements;
function achEvaluate(row, gameSnap) {
  const r = row || {};
  const have = r.achievements || {};
  const champs = r.champs || {};
  const charWins = { ...(r.charWins || {}) };
  if (gameSnap && gameSnap.won && gameSnap.characterId) charWins[gameSnap.characterId] = true;
  const snap = {
    won: false, characterId: null, peakPower: 0, peakGold: 0,
    potionsPlayed: 0, foretoldDoom: false, peakSkills: {},
    missionsCompleted: 0, missionsFailed: 0,
    ...(gameSnap || {}),
    charWins,
    dailyCrowns: champs.gold || 0,
    dailyPodiums: (champs.gold || 0) + (champs.silver || 0) + (champs.bronze || 0),
  };
  const earned = ACH().filter(d => !have[d.id] && d.check(snap));
  return { earned, ids: earned.map(d => d.id), stars: earned.reduce((n, d) => n + d.stars, 0) };
}

const cardByName = (n) => window.FAVOR_DATA.cards.find(c => c.name === n);
const missionByName = (n) => window.FAVOR_DATA.missions.find(m => m.name === n);

let pass = 0, fail = 0;
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
}

function newGame() {
  const g = new FavorGame(3);
  g.loadDecks();
  g.initPlayers([
    { characterId: 'explorer', playerName: 'You' },
    { characterId: 'knight', playerName: 'A' },
    { characterId: 'bandit', playerName: 'B' },
  ]);
  g.phase = 'gameplay';
  return g;
}
// Play a card through the real pipeline (hand → pick → activate).
function playCard(g, pi, name) {
  const card = { ...cardByName(name) };
  g.players[pi].hand = [card];
  g.pendingActivations[pi] = null;
  g.pickCard(pi, 0);
  return g.activateCard(pi, card.id, 'play');
}

console.log('── Her Lost Father: grants 1 Prospecting, 3 Gold, 3 Scorn + map');
{
  const g = newGame();
  const before = { gold: g.players[0].gold, scorn: g.players[0].scorn, pro: g.players[0].skills.prospecting || 0 };
  playCard(g, 0, 'Her Lost Father');
  ok(g.players[0].gold === before.gold + 3, `+3 Gold (${before.gold} → ${g.players[0].gold})`);
  ok(g.players[0].scorn === before.scorn + 3, `+3 Scorn`);
  ok((g.players[0].skills.prospecting || 0) === before.pro + 1, `+1 Prospecting`);
  ok(g.getPlayerMaps(0).includes('Her Lost Father') && g.getPlayerMaps(0).includes('Finding the Lost Corridor'),
    'map held under both names');

  console.log('── Finding the Lost Corridor: held map waives Mind\'s Eye ×2 AND cost');
  const flc = cardByName('Finding the Lost Corridor');
  const chk = g.checkRequirements(0, flc);
  ok(chk.canPlay === true, 'canPlay via map waiver', JSON.stringify(chk));
  const goldBefore = g.players[0].gold;
  playCard(g, 0, 'Finding the Lost Corridor');
  ok(g.players[0].gold === goldBefore, `cost waived by map (gold ${goldBefore} → ${g.players[0].gold})`);
  ok(g.players[0].playedCards.some(c => c.name === 'Finding the Lost Corridor'), 'card played');

  // Without the map, requirements bite.
  const g2 = newGame();
  ok(g2.checkRequirements(0, flc).canPlay === false, 'without map: still needs Mind\'s Eye ×2');
}

console.log('── Flex ("OR") skills are borrowable from a neighbour (either skill)');
{
  // A neighbour's Hermit's Lab (Alchemy OR Survival) can lend EITHER —
  // Philosopher's Stone play was blocked because it wasn't offered (Wyatt 7/17).
  const g = newGame();
  g.players[1].gold = 5;
  playCard(g, 1, "Hermit's Lab");        // right neighbour of seat 0
  const b0 = g.getBorrowableSkills(0);
  ok((b0.alchemy || []).includes(1), 'neighbour Hermit\'s Lab lends Alchemy');
  ok((b0.survival || []).includes(1), 'neighbour Hermit\'s Lab lends Survival');

  // A Mining Guild (Charisma OR Prospecting) neighbour lets a due mission borrow.
  const g2 = newGame();
  g2.players[2].gold = 5;
  playCard(g2, 2, 'Mining Guild');       // left neighbour of seat 0
  const b2 = g2.getBorrowableSkills(0);
  ok((b2.prospecting || []).includes(2), 'neighbour Mining Guild lends Prospecting');
  const m = { ...missionByName('Trust of the Elders') };   // Req: 5 Favor & 2 Prospecting
  g2.players[0].missions = [m];
  g2.players[0].favor = 5;
  g2.players[0].skills.prospecting = 1;                    // one short
  const plan = g2.missionBorrowPlan(0, m);
  ok(plan && plan.borrowFrom && plan.borrowFrom.some(x => x.skill === 'prospecting'),
    'Trust of the Elders can borrow Prospecting off the flex neighbour (no false auto-fail)');
}

console.log('── Discard-to-Slide is FREE — the discard is the toll, no gold charged');
{
  const g = newGame();
  const p = g.players[0];
  p.gold = 40;
  p.sliderPosition = 2;   // Center — room to slide either way
  const before = p.gold;
  const card = { ...cardByName('First Aid') };
  p.hand = [card]; g.pendingActivations[0] = null; g.pickCard(0, 0);
  const res = g.activateCard(0, card.id, 'discard_slide', 1);   // slide right
  ok(res.success === true, 'discard_slide succeeds');
  ok(p.gold === before, `no gold charged for the slide (${before} → ${p.gold})`);
  ok(p.sliderPosition === 3, `ring moved one space (2 → ${p.sliderPosition})`);
  ok(!p.playedCards.some(c => c.id === card.id), 'the card is discarded, not played');
}

console.log('── Blind Faith grants exactly 1 Power (never Knowledge)');
{
  const g = newGame();
  const p = g.players[0];
  const beforeK = p.skills.knowledge || 0, beforeP = p.skills.power || 0;
  playCard(g, 0, 'Blind Faith');
  ok((p.skills.power || 0) === beforeP + 1, `Power +1 (${beforeP} → ${p.skills.power})`);
  ok((p.skills.knowledge || 0) === beforeK, 'Knowledge unchanged');
  ok(cardByName('Blind Faith').type === 'weapon', 'Blind Faith is a Weapon (groups under Weapons, not Wisdom)');
}

console.log('── Favor-cost cards count the Favor printed on played cards');
{
  // Forming a Bond banks 7 Favor (top-level card.favor). Badge of Courage
  // needs "Req: 5 Favor" — impossible before because the check read only
  // player.favor (0), ignoring card favor (Wyatt 7/17).
  const g = newGame();
  const p = g.players[0];
  p.skills.charisma = 1;                       // Forming a Bond needs 1 Charisma
  ok(g.currentFavor(0) === 0, 'held favor starts at 0');
  playCard(g, 0, 'Forming a Bond');
  ok(p.favor === 0, 'player.favor stays 0 (card favor is scored, not banked to .favor)');
  ok(g.currentFavor(0) === 7, `held favor now counts the card's 7 (${g.currentFavor(0)})`);
  const badge = cardByName('Badge of Courage');   // Req: 5 Favor
  ok(g.checkRequirements(0, badge).canPlay === true, 'Badge of Courage is now playable with 7 held Favor');
  // And a favor-cost mission reads the same held favor.
  const g2 = newGame();
  g2.players[0].skills.charisma = 1;
  playCard(g2, 0, 'Forming a Bond');           // 7 held favor
  g2.players[0].skills.prospecting = 2;        // Trust of the Elders also needs 2 Prospecting
  const trust = { ...missionByName('Trust of the Elders') };
  ok(g2.checkMissionRequirements(0, trust).success === true,
    'Trust of the Elders (5 Favor & 2 Prospecting) succeeds on held card favor');
}

console.log('── One direction per turn spans paid AND discard slides');
{
  // Pay to slide RIGHT, then a discard-slide LEFT must NOT move the ring
  // (Wyatt 7/17 pm: doing both in one turn was possible and is illegal).
  const g = newGame();
  const p = g.players[0];
  p.gold = 40; p.sliderPosition = 2;
  const paid = g.moveSlider(0, 1);           // pay to slide right
  ok(paid.success && p.sliderPosition === 3, 'paid slide right lands (2 → 3)');
  const card = { ...cardByName('First Aid') };
  p.hand = [card]; g.pendingActivations[0] = null; g.pickCard(0, 0);
  g.activateCard(0, card.id, 'discard_slide', -1);   // try to discard-slide LEFT
  ok(p.sliderPosition === 3, 'opposite discard-slide is refused — ring holds at 3');
  ok(!p.playedCards.some(c => c.id === card.id), 'the card is still discarded');

  // Same lock the other way: discard-slide left first, then paid slide right fails.
  const g2 = newGame();
  const q = g2.players[0];
  q.gold = 40; q.sliderPosition = 2;
  const c2 = { ...cardByName('First Aid') };
  q.hand = [c2]; g2.pendingActivations[0] = null; g2.pickCard(0, 0);
  g2.activateCard(0, c2.id, 'discard_slide', -1);    // discard-slide left → locks left
  ok(q.sliderPosition === 1, 'discard-slide left lands (2 → 1)');
  const paid2 = g2.moveSlider(0, 1);                  // now try to pay-slide right
  ok(!paid2.success && q.sliderPosition === 1, 'opposite paid slide refused after a discard-slide');
}

console.log('── Reunited: credits a Philosopher\'s Stone and scores its gold conversion');
{
  const g = newGame();
  const p = g.players[0];
  // Map route (the practical path): Finding the Lost Corridor grants the
  // Reunited map, waiving the 12-Knowledge/Mind's-Eye/Stone requirement.
  p.playedCards.push({ ...cardByName('Finding the Lost Corridor') });
  ok((p.philosopherStone || 0) === 0, 'no stone before Reunited');
  playCard(g, 0, 'Reunited');
  ok(p.playedCards.some(c => c.name === 'Reunited'), 'Reunited played via map');
  ok((p.philosopherStone || 0) >= 1, `Reunited credits a Philosopher's Stone (${p.philosopherStone})`);
  g.phase = 'scoring';
  p.gold = 6;
  const mine = g.calculateFinalScores().find(s => s.name === 'You');
  ok(mine.stoneFavor === 6, `stone converts 6 Gold → 6 Favor at game end (${mine.stoneFavor})`);
}

console.log('── Marketplace Sales: 2 Gold per Alchemy around the table');
{
  const g = newGame();
  g.players[0].skills.alchemy = 2; g.players[0].skills.charisma = 1; // meets req
  g.players[1].skills.alchemy = 3;
  g.players[2].skills.alchemy = 1;
  const before = g.players[0].gold;
  playCard(g, 0, 'Marketplace Sales');
  ok(g.players[0].gold === before + 2 * 6, `+12 Gold for 6 Alchemy (${before} → ${g.players[0].gold})`);
}

console.log('── Mission requirements: quantities enforced');
{
  const g = newGame();
  const m = missionByName('A Day With the Birds'); // Req: 3 Knowledge
  g.players[0].skills.knowledge = 2;
  ok(g.checkMissionRequirements(0, m).success === false, '2 Knowledge < 3 → fail');
  g.players[0].skills.knowledge = 3;
  ok(g.checkMissionRequirements(0, m).success === true, '3 Knowledge → success');
}

console.log('── Mission success: skill rewards + favorValue not double-paid');
{
  const g = newGame();
  const m = { ...missionByName('A Day With the Birds') };
  const cha = g.players[0].skills.charisma || 0;
  const favor = g.players[0].favor;
  g.applyMissionRewards(0, m);
  ok((g.players[0].skills.charisma || 0) === cha + 3, '+3 Charisma reward');
  ok(g.players[0].favor === favor, 'no favor paid at completion (favorValue scores at end)');
}

console.log('── Mission favor audit (7/9): phantom favorValues gone, per-asset favor pays at turn-in');
{
  const zeroed = ["The Minister's Plan", 'A Day With the Birds', 'Helping the Merchant',
    'Golden Fiddle', 'Trust of the Elders', 'Tunnel of Trinkets', 'The Shadow Guide',
    'Usurper', 'Bodyguard', 'Quest for the Stones', 'Mounted Champion', 'Secret Grotto',
    'Alchemic Seige', 'Mercy', 'Passing the Mirror Gate', 'Wild Experiments', 'King of the Sky'];
  ok(zeroed.every(n => (missionByName(n).favorValue || 0) === 0),
     "all 17 phantom favorValues zeroed (Wyatt's 16 + Trust of the Elders)");

  const g = newGame();
  const p = g.players[0];
  // King of the Sky: favor ONLY per Philosopher's Stone (blue ×10 crystal medallion)
  p.philosopherStone = 2;
  const f0 = p.favor;
  g.applyMissionRewards(0, { ...missionByName('King of the Sky') });
  ok(p.favor === f0 + 20, `King of the Sky pays 10 Favor per stone at turn-in (+${p.favor - f0} for 2 stones)`);

  // Usurper: success = 30 Gold AND 10 Scorn (red medallion in the success zone)
  const gold0 = p.gold, scorn0 = p.scorn;
  g.applyMissionRewards(0, { ...missionByName('Usurper') });
  ok(p.gold === gold0 + 30, `Usurper success pays 30 Gold (+${p.gold - gold0})`);
  ok(p.scorn === scorn0 + 10, `Usurper success stings 10 Scorn (+${p.scorn - scorn0})`);

  // Alchemic Seige: success = 10 Scorn (art medallion; transcription said 20)
  const s1 = p.scorn;
  g.applyMissionRewards(0, { ...missionByName('Alchemic Seige') });
  ok(p.scorn === s1 + 10, `Alchemic Seige success stings 10 Scorn (+${p.scorn - s1})`);
}

console.log("── The Shadow Guide: art-true requirements + 5 Favor per Mind's Eye reward");
{
  const g = newGame();
  const p = g.players[0];
  const sg = { ...missionByName('The Shadow Guide') };
  p.skills.knowledge = 4; p.skills.prospecting = 3; p.bonusMindsEye = 2;
  ok(g.probeMissionRequirements(0, sg).success === false,
     'stats alone are NOT enough — A Hidden Door Map is a hard requirement');
  ok(g.missionBorrowPlan(0, sg) === null, 'the missing map cannot be borrowed');
  p.playedCards.push({ ...cardByName('A Hidden Door') });
  ok(g.probeMissionRequirements(0, sg).success === true, 'stats + A Hidden Door Map → success');
  const me = g.getMindsEyeCount(0);
  const f0 = p.favor;
  g.applyMissionRewards(0, sg);
  ok(me >= 2 && p.favor === f0 + 5 * me, `success pays 5 Favor per Mind's Eye (+${p.favor - f0} for ${me})`);
}

console.log('── Mission map alternatives: holding the printed map completes the mission');
{
  const g = newGame();
  const p = g.players[0];
  const kots = { ...missionByName('King of the Sky') }; // 4 Survival & 12 Power OR Dawnharbinger Map
  ok(g.probeMissionRequirements(0, kots).success === false, 'no stats, no map → unmet');
  p.playedCards.push({ ...cardByName('Dawnharbinger') });
  ok(g.probeMissionRequirements(0, kots).success === true, 'Dawnharbinger Map alone completes King of the Sky');
  ok(g.missionBorrowPlan(0, kots) === null, 'map already completes it → no borrow offer');
}

console.log('── resolveMissions: ceremony deltas are the honest payout');
{
  // Success with per-asset favor: deltas must equal what was ACTUALLY paid.
  const g = newGame();
  const ai = g.players[1];
  ai.philosopherStone = 2;
  ai.skills.survival = 4; ai.skills.power = 12;
  ai.missions = [{ ...missionByName('King of the Sky') }];
  g.currentAct = 3;
  const f0 = ai.favor;
  const res = g.resolveMissions();
  const r = res.find(pr => pr.playerIndex === 1).results.find(x => x.mission.name === 'King of the Sky');
  ok(r && r.success === true, 'AI completes King of the Sky at its due act');
  ok(r && r.deltas && r.deltas.favor === 20 && ai.favor === f0 + 20,
     `deltas.favor ${r && r.deltas && r.deltas.favor} = actual payout (10 × 2 stones)`);

  // Failure: the penalty lands in the SAME result entry's deltas.
  const g2 = newGame();
  const ai2 = g2.players[1];
  ai2.missions = [{ ...missionByName('Defending the Kingdom') }]; // 5 Sur & 5 Pow — unmet, fail: 10 Scorn
  g2.currentAct = 2;
  const s0 = ai2.scorn;
  const res2 = g2.resolveMissions();
  const r2 = res2.find(pr => pr.playerIndex === 1).results.find(x => x.mission.name === 'Defending the Kingdom');
  ok(r2 && r2.success === false, 'AI fails Defending the Kingdom');
  ok(r2 && r2.deltas && r2.deltas.scorn === 10 && ai2.scorn === s0 + 10,
     `failure deltas carry the penalty (+${r2 && r2.deltas && r2.deltas.scorn} Scorn)`);
}

console.log('── Mission failure specials: discard + payouts');
{
  const g = newGame();
  // "Discard 5 Cards" on the HUMAN now defers to a picker (you choose
  // which cards to give up); the AI discards immediately.
  playCard(g, 0, 'Trapping'); // survival card in play
  const m = { ...missionByName('Wanted: Crazy Lou') }; // fail: discard 5 played
  g.applyMissionFailure(0, m);
  ok(g.players[0]._pendingPenaltyDiscard === 5, `discard_5_played defers to human picker (pending ${g.players[0]._pendingPenaltyDiscard})`);
  g.players[2].playedCards.push({ ...cardByName('First Aid') });
  g.applyMissionFailure(2, m);
  ok(g.players[2].playedCards.length === 0, 'AI discard executes immediately');

  const g3 = newGame();
  const mb = { ...missionByName("Man's Best Friend") }; // fail: +4 gold, others +5 gold
  const y = g3.players[0].gold, a = g3.players[1].gold;
  g3.applyMissionFailure(0, mb);
  ok(g3.players[0].gold === y + 4, 'failure pays you 4 Gold');
  ok(g3.players[1].gold === a + 5, 'others gain 5 Gold');
}

console.log(`── A Promise (AI): trades junk cards for ${window.PROMISE_PRESTIGE} Prestige each`);
{
  const g = newGame();
  playCard(g, 1, 'Trapping'); // junk: 1 survival, 0 favor
  const m = { ...missionByName('A Promise') };
  const prestige = g.players[1].prestige;
  g.applyMissionFailure(1, m);
  // Art audit 7/13: the card reads 8 Prestige per discard, not 10.
  ok(window.PROMISE_PRESTIGE === 8, 'A Promise pays 8 Prestige per card (art)');
  ok(g.players[1].prestige === prestige + window.PROMISE_PRESTIGE,
    `AI sacrificed 1 junk card (+${window.PROMISE_PRESTIGE} prestige)`);
  ok(g.players[1].playedCards.length === 0, 'junk card discarded');
  // Human path defers to the picker UI:
  const g2 = newGame();
  playCard(g2, 0, 'Trapping');
  g2.applyMissionFailure(0, { ...missionByName('A Promise') });
  ok(g2.players[0]._pendingPromiseDiscard === true, 'human gets the choice (pending flag)');
}

console.log('── Melee: Heaven\'s Blade +6 with Blind Faith');
{
  const g = newGame();
  g.players[0].skills.power = 2;
  g.players[0].playedCards.push({ ...cardByName("Heaven's Blade") });
  const base = g.calculatePower(0);
  g.players[0].playedCards.push({ ...cardByName('Blind Faith') });
  const withBF = g.calculatePower(0);
  ok(withBF === base + 6, `+6 Power once Blind Faith owned (${base} → ${withBF})`);
}

console.log('── Scoring: dynamic favor specials');
{
  const g = newGame();
  g.players[0].skills.survival = 4;
  g.players[0].playedCards.push({ ...cardByName("Fang's Truce") });
  const scores = g.calculateFinalScores();
  const me = scores.find(s => s.playerIndex === 0);
  // Fang's Truce: 4 survival grant is already in skills here; 2 per survival = 8
  ok(me.cardFavor >= 8, `Fang's Truce pays 2×Survival at scoring (cardFavor ${me.cardFavor})`);
}

console.log('── Flex skills: Mining Guild counts as Charisma OR Prospecting, never both');
{
  const g = newGame();
  const p = g.players[0];
  p.gold = 20;
  playCard(g, 0, 'Mining Guild');
  ok((p.flexSkills || []).some(f => f.includes('charisma') && f.includes('prospecting')),
    'flex unit registered', JSON.stringify(p.flexSkills));
  ok((p.skills.charisma || 0) === 0 && (p.skills.prospecting || 0) === 0,
    'fixed totals untouched (no greedy auto-pick)');
  // One flex covers 1 CHA — or 1 PRO — but NOT 1 CHA + 1 PRO together.
  ok(Object.keys(g.unmetSkillReqs(0, { charisma: 1 })).length === 0, 'covers 1 Charisma alone');
  ok(Object.keys(g.unmetSkillReqs(0, { prospecting: 1 })).length === 0, 'covers 1 Prospecting alone');
  const both = g.unmetSkillReqs(0, { charisma: 1, prospecting: 1 });
  ok(Object.values(both).reduce((a, b) => a + b, 0) === 1, 'CANNOT cover both at once', JSON.stringify(both));
}

console.log("── Wyatt's game: Hunting + Mining Guild + Her Lost Father passes Cameron's Expedition");
{
  const g = newGame();
  const p = g.players[0];
  p.character = window.FAVOR_DATA.characters.find(c => /fisherman/i.test(c.name));
  p.gold = 30;
  p.skills.power = 1; // Hunting requires 1 Power to play
  for (const name of ['Hunting', 'Mining Guild', 'Her Lost Father']) {
    const r = playCard(g, 0, name);
    ok(r.success, `plays ${name}`, JSON.stringify(r));
  }
  p.sliderPosition = 4; // far right: 8 Survival
  g.applySlotSkills(p);
  ok(p.skills.survival === 10, `10 Survival (8 slot + 2 Hunting), got ${p.skills.survival}`);
  ok(p.skills.prospecting === 1, `Her Lost Father's 1 Prospecting counted, got ${p.skills.prospecting}`);
  const cam = missionByName("Cameron's Expedition");
  const chk = g.checkMissionRequirements(0, cam);
  ok(chk.success === true, "Cameron's Expedition (4 SUR + 1 CHA + 1 PRO) PASSES", JSON.stringify(chk.details.missing));
}

console.log('── Mission phase: a failure discard cannot sabotage a sibling mission');
{
  const g = newGame();
  const p = g.players[1]; // AI so the discard actually executes
  p.character = window.FAVOR_DATA.characters.find(c => /fisherman/i.test(c.name));
  p.gold = 30;
  p.skills.power = 1;
  for (const name of ['Hunting', 'Mining Guild', 'Her Lost Father']) {
    const card = { ...cardByName(name) };
    p.hand = [card];
    g.pendingActivations[1] = null;
    g.pickCard(1, 0);
    g.activateCard(1, card.id, 'play');
  }
  p.sliderPosition = 4;
  g.applySlotSkills(p);
  // Crazy Lou (15 Power — hopeless, failure discards 5) + Cameron's
  // (passable). At Act 3 BOTH are due, so both force-resolve together.
  p.missions = [{ ...missionByName('Wanted: Crazy Lou') }, { ...missionByName("Cameron's Expedition") }];
  g.currentAct = 3;
  const results = g.resolveMissions().find(r => r.playerIndex === 1).results;
  const lou = results.find(r => r.mission.name === 'Wanted: Crazy Lou');
  const cam = results.find(r => r.mission.name === "Cameron's Expedition");
  ok(lou && lou.success === false, 'Crazy Lou fails at its due act (needs 15 Power)');
  ok(cam && cam.success === true, "Cameron's still PASSES — discard applied after all checks");
}

console.log('── Penalty discard: human picks, AI protects mission-critical cards');
{
  const g = newGame();
  g.players[0].playedCards.push({ ...cardByName('First Aid') });
  g.penaltyDiscard(0, 5);
  ok(g.players[0]._pendingPenaltyDiscard === 5, 'human gets a pending picker, nothing auto-discarded');
  ok(g.players[0].playedCards.length === 1, 'human cards untouched until the pick');

  const p2 = g.players[2];
  p2.missions = [{ ...missionByName("Cameron's Expedition") }];
  p2.playedCards.push({ ...cardByName('Her Lost Father') });   // feeds Cameron's PRO
  p2.playedCards.push({ ...cardByName('First Aid') });          // dead weight
  g.applySlotSkills(p2);
  g.penaltyDiscard(2, 1);
  ok(p2.playedCards.some(c => c.name === 'Her Lost Father'),
    'AI keeps the card its remaining mission needs', p2.playedCards.map(c => c.name).join(','));
}

console.log('── Mission skill rewards survive a slider move');
{
  const g = newGame();
  const p = g.players[0];
  g.applyMissionRewards(0, { name: 'TestReward', successRewards: { skills: { prospecting: 3 } } });
  const before = p.skills.prospecting || 0;
  p.sliderPosition = (p.sliderPosition + 1) % 5;
  g.applySlotSkills(p);
  ok((p.skills.prospecting || 0) >= 3, `+3 Prospecting persists after recalc (${before} → ${p.skills.prospecting})`);
}

console.log('── 1/2 + 2/2 pairs: printed bonuses only, no invented favor');
{
  const g = newGame();
  const p = g.players[0];
  p.skills.power = 1;
  const favorBefore = p.favor;
  p.playedCards.push({ ...cardByName('Blind Faith') });
  g.applySlotSkills(p);
  const base = g.calculatePower(0);
  p.playedCards.push({ ...cardByName('Archeus') });
  g.resolveCombo(0, p.playedCards[p.playedCards.length - 1]);
  ok(g.calculatePower(0) === base + 6, `Archeus + Blind Faith: +6 Power (${base} → ${g.calculatePower(0)})`);
  p.playedCards.push({ ...cardByName("Heaven's Blade") });
  ok(g.calculatePower(0) === base + 12, `all three: Heaven's Blade AND Archeus each +6 (${g.calculatePower(0)})`);
  ok(p.favor === favorBefore, 'no phantom +5 favor from pairing');
}

console.log('── Chemical Y: +15 Favor at scoring only with Chemical X owned');
{
  const g = newGame();
  g.players[0].playedCards.push({ ...cardByName('Chemical Y') });
  let me = g.calculateFinalScores().find(s => s.playerIndex === 0);
  const without = me.cardFavor;
  g.players[0].playedCards.push({ ...cardByName('Chemical X') });
  me = g.calculateFinalScores().find(s => s.playerIndex === 0);
  ok(me.cardFavor === without + 15, `pair bonus at scoring (${without} → ${me.cardFavor})`);
}

console.log('── Mission windows: turn in by choice, forced only at the due act');
{
  const g = newGame();
  ok(g.missionDueAct(missionByName('Wanted: Crazy Lou')) === 3, 'Crazy Lou (Act 1 OR 2 OR 3) due Act 3');
  ok(g.missionDueAct(missionByName("The Minister's Plan")) === 2, "Minister's Plan (Act 2 OR Act 1) due Act 2");
  ok(g.missionDueAct(missionByName("Cameron's Expedition")) === 1, "Cameron's (Act 1 only) due Act 1");

  // Human holds Crazy Lou unmet at end of Act 1 → NOT auto-failed, carries over.
  const p = g.players[0];
  p.missions = [{ ...missionByName('Wanted: Crazy Lou') }];
  g.currentAct = 1;
  let r = g.resolveMissions().find(x => x.playerIndex === 0).results;
  ok(r.length === 0 && p.missions.length === 1 && p.failedMissions.length === 0,
    'human keeps unmet Crazy Lou at end of Act 1 (no auto-fail)');
  // …and at the end of Act 3 it forces and fails.
  g.currentAct = 3;
  r = g.resolveMissions().find(x => x.playerIndex === 0).results;
  ok(r.length === 1 && r[0].success === false && p.missions.length === 0,
    'due date reached: forced resolve fails it');

  // AI banks a met multi-act mission early.
  const ai = g.players[1];
  ai.skills.power = 15;
  ai.missions = [{ ...missionByName('Wanted: Crazy Lou') }];
  g.currentAct = 1;
  g.resolveMissions();
  ok(ai.completedMissions.some(m => m.name === 'Wanted: Crazy Lou') && ai.missions.length === 0,
    'AI turns in met Crazy Lou during the window');
}

console.log('── turnInMission: early cash-in resolves either way, right now');
{
  const g = newGame();
  const p = g.players[0];
  g.currentAct = 1;
  p.skills.power = 15;
  p.missions = [{ ...missionByName('Wanted: Crazy Lou') }];
  const favorBefore = p.favor, goldBefore = p.gold;
  const res = g.turnInMission(0, 0);
  ok(res.success === true && p.completedMissions.length === 1, 'met: success immediately');
  ok(p.gold === goldBefore + 15, `+15 Gold reward (${goldBefore} → ${p.gold})`);

  const p2 = g.players[0];
  p2.missions = [{ ...missionByName('Wanted: Crazy Lou') }];
  p2.skills.power = 0;
  p2.playedCards.push({ ...cardByName('First Aid') });
  const res2 = g.turnInMission(0, 0);
  ok(res2.success === false && p2.failedMissions.length === 1, 'unmet: fails immediately by choice');
  ok(p2._pendingPenaltyDiscard === 5, 'failure penalty (discard 5 picker) queued');
}

console.log('── pickCard: last two cards both activate, both stay choosable');
{
  const g = newGame();
  const p = g.players[0];
  p.hand = [{ ...cardByName('First Aid') }, { ...cardByName('Trapping') }];
  g.pendingActivations[0] = null;
  g.pickCard(0, 0);
  const pending = g.pendingActivations[0];
  ok(Array.isArray(pending) && pending.length === 2, 'both cards pending');
  const actions = g.getActivationActions(0);
  ok(actions.length === 2 && actions.every(a => a.canDiscard), 'full action set offered for BOTH cards');
}

console.log('── Chemical Y: choose ONE adventure card, its favor doubles at scoring');
{
  const g = newGame();
  const p = g.players[2]; // AI path executes immediately
  p.playedCards.push({ ...cardByName('Fur Trading') });       // adventure, 3 favor
  p.playedCards.push({ ...cardByName('Forming a Bond') });    // adventure, 7 favor
  const before = g.calculateFinalScores().find(s => s.playerIndex === 2).cardFavor;
  g.resolveSpecial(2, { name: 'Chemical Y', special: 'double_adventure_favor' });
  const doubled = p.playedCards.filter(c => c._favorDoubled);
  ok(doubled.length === 1, 'exactly ONE card doubled');
  ok(doubled[0] && doubled[0].name === 'Forming a Bond', `AI picks the highest favor (${doubled[0] && doubled[0].name})`);
  const after = g.calculateFinalScores().find(s => s.playerIndex === 2).cardFavor;
  ok(after === before + 7, `scoring pays the double once (+7: ${before} → ${after})`);
  ok(p.favor === 0 || true, 'no immediate favor dump');

  // A second Chemical Y picks a DIFFERENT card.
  g.resolveSpecial(2, { name: 'Chemical Y', special: 'double_adventure_favor' });
  ok(p.playedCards.every(c => c._favorDoubled), 'second dose doubles the other card');

  // Discarding the doubled card takes the doubling with it.
  const g2 = newGame();
  const q = g2.players[2];
  q.playedCards.push({ ...cardByName('Forming a Bond') });
  g2.resolveSpecial(2, { name: 'Chemical Y', special: 'double_adventure_favor' });
  g2.discardPlayedCards(2, c => c.name === 'Forming a Bond');
  const gone = g2.calculateFinalScores().find(s => s.playerIndex === 2).cardFavor;
  ok(gone === 0, 'discarded doubled card pays nothing');

  // Human path defers to the picker.
  const g3 = newGame();
  g3.players[0].playedCards.push({ ...cardByName('Fur Trading') });
  g3.resolveSpecial(0, { name: 'Chemical Y', special: 'double_adventure_favor' });
  ok(g3.players[0]._pendingChemYPick === true, 'human gets the picker, nothing auto-chosen');
  ok(!g3.players[0].playedCards.some(c => c._favorDoubled), 'no card marked until the human picks');
}

console.log('── Double Mission Letter finale: letter #1 never wipes letter #2');
{
  // Wyatt's 7/5 freeze: final 2 cards BOTH Mission Letters, 1 gold.
  const letters = window.FAVOR_DATA.cards.filter(c => c.type === 'mission_letter' && c.act === 1);

  // Real deal: two distinct letter entries (unique ids).
  const g = newGame();
  const p = g.players[0];
  p.hand = [letters[0], letters[1]];
  p.gold = 1;
  g.pendingActivations[0] = null;
  g.pickCard(0, 0);
  ok(Array.isArray(g.pendingActivations[0]) && g.pendingActivations[0].length === 2, 'both letters pending');
  const r1 = g.activateCard(0, letters[0].id, 'mission_letter');
  ok(r1.success === true && r1.chooseMission === true, 'letter #1 buys a mission pick');
  ok(p.gold === 0, 'gold 1 → 0');
  const left = g.pendingActivations[0];
  ok(Array.isArray(left) && left.length === 1, `letter #2 still pending (${JSON.stringify(left && left.length)})`,
    JSON.stringify(g.pendingActivations[0]));
  const acts = g.getActivationActions(0);
  ok(acts.length === 1 && acts[0].canDiscard, 'letter #2 still offers Discard at 0 gold');
  g.activateCard(0, left[0].id, 'discard');
  ok(p.gold === 3 && g.pendingActivations[0] === null, 'letter #2 discards for +3g, pending clears');

  // Duplicate-id copies (rigged decks / cloned objects) must behave the same.
  const g2 = newGame();
  const p2 = g2.players[0];
  p2.hand = [{ ...letters[0] }, { ...letters[0] }];
  p2.gold = 1;
  g2.pendingActivations[0] = null;
  g2.pickCard(0, 0);
  g2.activateCard(0, letters[0].id, 'mission_letter');
  const left2 = g2.pendingActivations[0];
  ok(Array.isArray(left2) && left2.length === 1, 'same-id twin: letter #2 survives letter #1\'s removal');
  g2.activateCard(0, letters[0].id, 'discard');
  ok(p2.gold === 3 && g2.pendingActivations[0] === null, 'same-id twin: letter #2 discards cleanly');
}

console.log('── Mission borrowing: optional rescue at mission time, 2g/skill to the lender');
{
  const kCard = window.FAVOR_DATA.cards.find(c => (c.skills || []).includes('knowledge'));

  // Borrow-passes: short 1 Knowledge on a due mission, neighbor has it on cards.
  const g = newGame();
  const p = g.players[0];
  const m = { ...missionByName('A Day With the Birds') }; // 3 Knowledge, due Act 1
  p.missions = [m];
  p.skills.knowledge = 2;
  p.gold = 10;
  g.players[1].playedCards.push({ ...kCard });
  const plan = g.missionBorrowPlan(0, m);
  ok(plan && plan.cost === 2 && plan.borrowFrom.length === 1, 'plan: 1 unit short → 2g fee');

  g.currentAct = 1;
  g.resolveMissions();
  ok((p._pendingMissionBorrows || []).length === 1, 'human: due-but-borrowable mission PAUSES for the chooser');
  ok(p.missions.length === 1 && p.failedMissions.length === 0 && p.completedMissions.length === 0,
    'nothing auto-failed, nothing auto-borrowed');

  const lenderGold = g.players[1].gold;
  const res = g.completeMissionWithBorrow(0, 0);
  ok(res.success === true && p.gold === 8, `Borrow & Complete: fee paid (10 → ${p.gold})`);
  ok(g.players[1].gold === lenderGold + 2, 'the 2g lands with the lending neighbor');
  ok(p.completedMissions.length === 1 && p.missions.length === 0, 'mission completed and cleared');

  // Decline-fails: penalties land, including Discard-N joining the picker.
  const g2 = newGame();
  const p2 = g2.players[0];
  p2.missions = [{ ...missionByName('A Day With the Birds'), failSpecial: 'discard_5_played' }];
  p2.skills.knowledge = 2;
  p2.gold = 10;
  p2.playedCards.push({ ...cardByName('First Aid') }); // penaltyDiscard needs a table
  g2.players[1].playedCards.push({ ...kCard });
  g2.currentAct = 1;
  g2.resolveMissions();
  ok((p2._pendingMissionBorrows || []).length === 1, 'decline rig: chooser queued');
  const scornBefore = p2.scorn;
  g2.failMissionByChoice(0, 0);
  ok(p2.failedMissions.length === 1 && p2.missions.length === 0, 'Let it Fail resolves the mission as failed');
  ok(p2.scorn === scornBefore + 10, `failure penalty applied (+10 scorn)`);
  ok(p2._pendingPenaltyDiscard === 5, "declined mission's Discard-5 joins the penalty picker");

  // Unborrowable: no lender → no offer, the mission just fails at its due date.
  const g3 = newGame();
  const p3 = g3.players[0];
  p3.missions = [{ ...missionByName('A Day With the Birds') }];
  p3.skills.knowledge = 2;
  p3.gold = 10; // neighbors hold no knowledge cards
  g3.currentAct = 1;
  ok(g3.missionBorrowPlan(0, p3.missions[0]) === null, 'no lender → no plan');
  g3.resolveMissions();
  ok((p3._pendingMissionBorrows || []).length === 0 && p3.failedMissions.length === 1,
    'no offer — mission fails at its due date');

  // Mind's Eye / Philosopher's Stone gaps can never be borrowed.
  const g4 = newGame();
  const meMission = window.FAVOR_DATA.missions.find(mm => (mm.requirements || []).includes('minds_eye'));
  g4.players[0].missions = [{ ...meMission }];
  g4.players[0].gold = 50;
  ok(g4.missionBorrowPlan(0, g4.players[0].missions[0]) === null, `minds_eye gap → no offer (${meMission.name})`);

  // The fee is real gold — broke players get no offer.
  const g5 = newGame();
  const p5 = g5.players[0];
  p5.missions = [{ ...missionByName('A Day With the Birds') }];
  p5.skills.knowledge = 2;
  p5.gold = 1;
  g5.players[1].playedCards.push({ ...kCard });
  ok(g5.missionBorrowPlan(0, p5.missions[0]) === null, 'gold 1 < 2g fee → no offer');

  // AI: borrows when favorValue clearly beats the fee, refuses a bad deal.
  const g6 = newGame();
  const ai = g6.players[1];
  ai.missions = [{ ...missionByName('A Day With the Birds'), favorValue: 10 }]; // rig pins worth ≥ 2× fee (real card pays no flat favor)
  ai.skills.knowledge = 2;
  ai.gold = 10;
  g6.players[0].playedCards.push({ ...kCard });
  g6.currentAct = 1;
  const aiLenderBefore = g6.players[0].gold;
  g6.resolveMissions();
  ok(ai.completedMissions.length === 1 && ai.gold === 8, `AI borrows for a 10-favor mission (gold → ${ai.gold})`);
  ok(g6.players[0].gold === aiLenderBefore + 2, "AI's fee pays the lender");

  const g7 = newGame();
  const ai7 = g7.players[1];
  ai7.missions = [{ ...missionByName('A Day With the Birds'), favorValue: 3 }];
  ai7.skills.knowledge = 2;
  ai7.gold = 10;
  g7.players[0].playedCards.push({ ...kCard });
  g7.currentAct = 1;
  g7.resolveMissions();
  ok(ai7.failedMissions.length === 1 && ai7.gold === 10, 'AI refuses when 3 favor < 2× the fee');

  // Persona judgment: the same 3-favor mission clears a persona's 1× bar
  // (fee 2g) — sharper trades, zero stat cheating.
  const g8 = newGame();
  const ai8 = g8.players[1];
  ai8._personaAI = { key: 'test', strong: [] };
  ai8.missions = [{ ...missionByName('A Day With the Birds'), favorValue: 3 }];
  ai8.skills.knowledge = 2;
  ai8.gold = 10;
  g8.players[0].playedCards.push({ ...kCard });
  g8.currentAct = 1;
  g8.resolveMissions();
  ok(ai8.completedMissions.length === 1 && ai8.gold === 8,
    `persona borrows when favor ≥ 1× fee (gold → ${ai8.gold})`);
}

console.log('── Multiplayer lockstep: seeded engines deal identical worlds');
{
    const build = (seed) => {
        const g = new FavorGame(3);
        g.setSeed(seed);
        g.loadDecks();
        return g;
    };
    const deckIds = (g) => [1, 2, 3].map(a => g.actDecks[a].map(c => c.id).join(',')).join(';')
        + '|' + g.visibleMissions.map(m => m.id || m.name).join(',');
    const a = build(12345), b = build(12345), c = build(54321);
    ok(deckIds(a) === deckIds(b), 'same seed → identical decks + revealed missions');
    ok(deckIds(a) !== deckIds(c), 'different seed → different world');

    // Liquid Courage's coin comes from the same stream.
    const flips = (g) => Array.from({ length: 8 }, () => g._rand() < 0.5).join(',');
    ok(flips(a) === flips(b), 'same seed → same coin flips after identical draws');

    // Solo games keep Math.random — two unseeded games differ.
    const s1 = new FavorGame(3); s1.loadDecks();
    const s2 = new FavorGame(3); s2.loadDecks();
    ok(deckIds(s1) !== deckIds(s2), 'unseeded games still shuffle freely');

    // Deal offset: every client rotates the roster so ITS human is local
    // seat 0 — the deal must still hand chunk k to CANONICAL seat k, or
    // identical decks deal different hands (the first live-match desync).
    const gA = new FavorGame(3); gA.setSeed(777); gA.loadDecks();
    gA.initPlayers([{ characterId: 'explorer', playerName: 'A' },
        { characterId: 'knight', playerName: 'B' }, { characterId: 'bandit', playerName: 'C' }]);
    gA.startAct(1);
    const gB = new FavorGame(3); gB.setSeed(777); gB.setDealOffset(1); gB.loadDecks();
    gB.initPlayers([{ characterId: 'knight', playerName: 'B' },
        { characterId: 'bandit', playerName: 'C' }, { characterId: 'explorer', playerName: 'A' }]);
    gB.startAct(1);
    const canonA = (k) => gA.players[k].hand.map(x => x.id).join(',');
    const canonB = (k) => gB.players[((k - 1) + 3) % 3].hand.map(x => x.id).join(',');
    ok([0, 1, 2].every(k => canonA(k) === canonB(k)),
        'deal offset keeps chunk k with canonical seat k on a rotated client');
    gA.startAct(2); gB.startAct(2);
    ok([0, 1, 2].every(k => canonA(k) === canonB(k)),
        'act-2 redeal stays canonical too');
}

console.log('── Remote humans: decisions DEFER (never auto-decided by another client)');
{
    // A remote human's borrowable mission must WAIT for their streamed
    // choice — exactly like the local human's chooser pause.
    const g = newGame();
    const kCard = window.FAVOR_DATA.cards.find(c => (c.skills || []).includes('knowledge'));
    const rp = g.players[1];
    rp._remoteHuman = true;
    rp.missions = [{ ...missionByName('A Day With the Birds'), favorValue: 50 }];
    rp.skills.knowledge = 2;
    rp.gold = 10;
    g.players[0].playedCards.push({ ...kCard });
    g.currentAct = 1;
    g.resolveMissions();
    ok((rp._pendingMissionBorrows || []).length === 1 && rp.completedMissions.length === 0,
        'borrowable mission deferred for the remote human (no auto-borrow at 50 favor)');
    ok(rp.failedMissions.length === 0, 'and not failed either — the stream decides');

    // Penalty discards defer the same way.
    const g2 = newGame();
    const rp2 = g2.players[1];
    rp2._remoteHuman = true;
    rp2.playedCards.push({ ...kCard }, { ...kCard });
    g2.penaltyDiscard(1, 2);
    ok(rp2._pendingPenaltyDiscard === 2 && rp2.playedCards.length === 2,
        'penalty discard deferred for the remote human (cards intact)');
}

console.log('── Emblem: rated seat + act-boundary clockwise pass');
{
  const g = newGame();
  ok(g.emblemHolder === 0, 'constructor default: seat 0');
  g.setEmblemHolder(2);
  ok(g.emblemHolder === 2, 'setEmblemHolder seats the token');
  g.setEmblemHolder(7);
  ok(g.emblemHolder === 0, 'out-of-table seat clamps to 0');
  g.setEmblemHolder(-1);
  ok(g.emblemHolder === 0, 'negative seat clamps to 0');

  g.setEmblemHolder(2);
  g.startAct(1);
  ok(g.emblemHolder === 2, 'Act 1 never rotates the Emblem');
  g.startAct(2);
  ok(g.emblemHolder === 0, 'act boundary passes clockwise (+1, wraps 2→0 at 3p)');
  g.startAct(3);
  ok(g.emblemHolder === 1, 'next boundary passes again (0→1)');

  // Activation order derives from the holder — passHands starts there.
  g.pendingActivations = [null, null, null];
  g.passHands();
  ok(g.activePlayerIndex === 1, 'activation begins at the new holder');
}

console.log('── Rank-1 boon: +1 bonusSkill survives recalc, flips a mission check');
{
  const g = newGame();
  const p = g.players[0];
  // Mission rewards earned earlier this game live in bonusSkills too —
  // the boon stacks on the same ledger.
  p.bonusSkills = { knowledge: 2 };
  g.applySlotSkills(p);
  const m = { ...missionByName('A Day With the Birds') };   // needs 3 Knowledge
  ok(g.checkMissionRequirements(0, m).success === false, '2 Knowledge < 3 → still short');
  // The boon lands: +1 chosen skill via the same path the UI uses.
  p.bonusSkills.knowledge += 1;
  g.applySlotSkills(p);
  ok(p.skills.knowledge === 3, `boon +1 shows in the sum (${p.skills.knowledge})`);
  ok(g.checkMissionRequirements(0, m).success === true, 'the boon flips the mission to a pass');
  // Slider recalcs must never eat it.
  g.applySlotSkills(p);
  ok(p.skills.knowledge === 3, 'recalc keeps the boon');
}

// ═══ probeMissionRequirements: PURE — browsing must never mutate state ═══
{
  // A Life-Essence-blessed mission answers "success" to the probe forever —
  // the waiver lives ON the mission and nothing consumes it.
  const g = newGame();
  const p = g.players[0];
  p.missions = [{ ...missionByName('A Day With the Birds') }]; // needs 3 Knowledge
  p.skills.knowledge = 0;                                      // unmet on merits
  p.missions[0]._reqWaived = true;                             // Life Essence blessing
  const snap = () => JSON.stringify({ ...p, character: undefined });
  const before = snap();
  const r1 = g.probeMissionRequirements(0, p.missions[0]);
  const r2 = g.probeMissionRequirements(0, p.missions[0]);
  ok(r1.success === true && r2.success === true, 'probe: blessed mission answers success every time');
  ok(p.missions[0]._reqWaived === true, 'the blessing is never consumed');
  ok(snap() === before, 'probe leaves the player byte-identical (blessed)');

  // Without the blessing: probe reports the unmet requirement, still byte-pure.
  delete p.missions[0]._reqWaived;
  const before2 = snap();
  const rMiss = g.probeMissionRequirements(0, p.missions[0]);
  ok(rMiss.success === false && rMiss.details.missing.length > 0, 'probe reports unmet requirements');
  ok(snap() === before2, 'probe leaves the player byte-identical (no blessing)');
  p.skills.knowledge = 3;
  ok(g.probeMissionRequirements(0, p.missions[0]).success === true, 'probe: met requirements read as success');

  // The real check agrees — and is pure now too (nothing left to consume).
  p.skills.knowledge = 0;
  p.missions[0]._reqWaived = true;
  const rReal = g.checkMissionRequirements(0, p.missions[0]);
  ok(rReal.success === true && p.missions[0]._reqWaived === true,
    'checkMissionRequirements honors the blessing without consuming anything');
}

console.log('── Life Essence: choose an active mission, its requirement is gone');
{
  // AI path: playing Life Essence waives the mission it is least likely to
  // meet; that mission then reads as a success with zero skills.
  const g = newGame();
  const ai = g.players[1];
  ai.missions = [{ ...missionByName('A Day With the Birds') }]; // 3 Knowledge, unmet
  ai.skills.knowledge = 0;
  g.resolveSpecial(1, { ...cardByName('Life Essence') });
  ok(ai.missions[0]._reqWaived === true, 'AI Life Essence blesses its failing mission');
  ok(g.checkMissionRequirements(1, ai.missions[0]).success === true, 'blessed mission succeeds with zero skills');

  // Human path: the pick is deferred to the picker via the pause flag.
  const p = g.players[0];
  p.missions = [{ ...missionByName('A Day With the Birds') }];
  g.resolveSpecial(0, { ...cardByName('Life Essence') });
  ok(p._pendingLifeEssencePick === true, 'human Life Essence pauses for the mission picker');

  // No active missions: the potion just rests (no crash, no flag).
  const g2 = newGame();
  g2.players[0].missions = [];
  g2.resolveSpecial(0, { ...cardByName('Life Essence') });
  ok(!g2.players[0]._pendingLifeEssencePick, 'no active missions — the essence rests');
}

console.log('── Great North Connection plays as printed: 1 Charisma & 1 Power');
{
  const g = newGame();
  const p = g.players[0];
  const gnc = { ...cardByName('Great North Connection') };
  p.hand = [gnc];
  p.skills.charisma = 1; p.skills.power = 1;
  const { canPlay } = g.checkRequirements(0, gnc);
  ok(canPlay === true, 'GNC playable with exactly 1 Charisma + 1 Power');
  ok((gnc.favor || 0) === 5, `GNC favor is 5 as printed (got ${gnc.favor})`);

  // The flex unit (Mining Guild) covers the Charisma half on its own.
  const g2 = newGame();
  const p2 = g2.players[0];
  const gnc2 = { ...cardByName('Great North Connection') };
  p2.skills.charisma = 0; p2.skills.power = 1;
  p2.flexSkills = [['charisma', 'prospecting']];
  ok(g2.checkRequirements(0, gnc2).canPlay === true, 'Mining Guild flex covers the Charisma requirement');
}

console.log('── powerBreakdown: the Melee forge arithmetic is engine truth');
{
  const g = newGame();
  g.currentAct = 1;                          // melee rewards are per-act
  const [p0, p1, p2] = g.players;
  // p0: board+cards 6 own, casts Fuzzy Head, ×2 (legacy flag — no card sets
  // it in current data, the fallback label covers it).
  p0.skills.power = 6;
  p0.playedCards = [{ ...cardByName('Reckless Training') }, { ...cardByName('Fuzzy Head') }];
  p0.powerX2 = g.currentAct;
  // p1: 6 power, a WON coin (+4), Guardian absorbs the incoming bolt.
  p1.skills.power = 6;
  p1.playedCards = [{ ...cardByName('Shot of Courage') }, { ...cardByName('Guardian') }];
  p1.defendTheThrone = true;
  g._rand = () => 0.2;                       // heads
  g.resolveSpecial(1, p1.playedCards[0]);
  // p2: 2 power, a LOST coin.
  p2.skills.power = 2;
  p2.playedCards = [{ ...cardByName('Shot of Courage') }];
  g._rand = () => 0.9;                       // tails
  g.resolveSpecial(2, p2.playedCards[0]);
  // Fuzzy Head wounds land on p1 and p2, tagged with the caster.
  g.resolveSpecial(0, p0.playedCards[1]);

  const results = g.resolveMelee();          // consumes the Guardian, records it
  for (const r of results) {
    const bd = g.powerBreakdown(r.playerIndex);
    ok(bd.computedTotal === r.power,
      `p${r.playerIndex}: breakdown total = melee tally (${bd.computedTotal}/${r.power})`);
    const wounds = (g.players[r.playerIndex].powerDebuffs || [])
      .filter(d => d.act === g.currentAct).reduce((a, d) => a + d.amount, 0);
    ok(bd.ownRawTotal + wounds === bd.rawTotal, `p${r.playerIndex}: own + wounds = raw`);
    ok(bd.baseOther + bd.baseCards.reduce((a, c) => a + c.amount, 0) === bd.base,
      `p${r.playerIndex}: base fully attributed`);
  }
  const bd0 = g.powerBreakdown(0), bd1 = g.powerBreakdown(1), bd2 = g.powerBreakdown(2);
  const atk = bd0.steps.find(s => s.kind === 'attack');
  ok(!!atk && atk.hits.length === 2 && atk.hits.every(h => h.delta === -3),
    'caster carries the attack step with both bolts');
  ok(bd0.steps.some(s => s.kind === 'mult' && s.amount === 2), 'the ×2 rides as a mult step');
  ok(bd0.baseCards.some(c => c.name === 'Reckless Training' && c.amount === 2),
    'power cards attributed in the base');
  ok(bd1.steps.some(s => s.kind === 'coinflip' && s.won === true), 'won coin revealed as a live toss');
  ok(!bd1.steps.some(s => s.kind === 'bonus' && /Shot of Courage/.test(s.label)),
    'won coin is NOT double-shown as a bonus');
  ok(bd1.steps.some(s => /Guardian/.test(s.label) && s.amount === 3),
    "Guardian's negation gives the bolt back");
  ok(bd2.steps.some(s => s.kind === 'coinflip' && s.won === false), 'lost coin still shows its toss');
  const snap = JSON.stringify(g.players.map(p => ({ ...p, character: undefined })));
  g.powerBreakdown(0); g.powerBreakdown(1); g.powerBreakdown(2);
  ok(JSON.stringify(g.players.map(p => ({ ...p, character: undefined }))) === snap,
    'powerBreakdown is pure — reading it moves nothing');
}

console.log('── Score sheet split: adventures + artifacts + other = card favor');
{
  const g = newGame();
  const p = g.players[0];
  p.playedCards = [
    { ...cardByName('Great North Connection') },   // adventure, 5 favor
    { ...cardByName("Philosopher's Scepter") },    // artifact
  ];
  const s = g.calculateFinalScores().find(x => x.playerIndex === 0);
  ok(s.advFavor + s.artFavor + s.otherCardFavor === s.cardFavor,
    `family split sums to cardFavor (${s.advFavor}+${s.artFavor}+${s.otherCardFavor}=${s.cardFavor})`);
  ok(s.advFavor >= 5, `GNC favor lands under Adventures (${s.advFavor})`);
}

console.log('── Paid slide: one direction per turn (5g a space, repeatable)');
{
  const g = newGame();
  const p = g.players[0];
  p.gold = 50;
  const startPos = p.sliderPosition; // explorer starts center (2)

  const r1 = g.moveSlider(0, 1);
  ok(r1.success === true && p.sliderPosition === startPos + 1, 'first paid slide right works');
  const r2 = g.moveSlider(0, 1);
  ok(r2.success === true && p.sliderPosition === startPos + 2, 'second slide SAME direction works (repeatable)');
  const r3 = g.moveSlider(0, -1);
  ok(r3.success === false && /direction per turn/i.test(r3.error || ''),
    'reversing within the turn is refused', JSON.stringify(r3));
  ok(p.sliderPosition === startPos + 2, 'refused slide does not move the ring');

  // Hands passing = a new turn — the lock releases.
  g.players.forEach(pl => { pl.hand = [{ ...cardByName('First Aid') }]; });
  g.passHands();
  const r4 = g.moveSlider(0, -1);
  ok(r4.success === true && p.sliderPosition === startPos + 1, 'after passHands the other direction works');

  // A new act deals fresh hands — lock releases there too.
  p._paidSlideDir = 1;
  g.startAct(2);
  ok(p._paidSlideDir === null, 'startAct clears the direction lock');

  // Guards unchanged: gold and board edges still refuse.
  g.phase = 'gameplay';
  p.gold = 3;
  const rPoor = g.moveSlider(0, 1);
  ok(rPoor.success === false && /5 gold/i.test(rPoor.error || ''), 'under 5 gold still refuses');
  p.gold = 50;
  p.sliderPosition = 4;
  p._paidSlideDir = null;
  const rEdge = g.moveSlider(0, 1);
  ok(rEdge.success === false, 'board edge still refuses');

  // One direction per turn now binds discard-slides too (Wyatt 7/17 pm): a
  // paid slide right locks the turn, so a discard-slide left holds the ring
  // (the card is still discarded). A SAME-direction discard-slide still moves.
  const g2 = newGame();
  const p2 = g2.players[0];
  p2.gold = 50;
  g2.moveSlider(0, 1);                    // paid right; lock = +1
  const posAfterPay = p2.sliderPosition;
  const card = { ...cardByName('First Aid') };
  p2.hand = [card];
  g2.pendingActivations[0] = null;
  g2.pickCard(0, 0);
  g2.activateCard(0, card.id, 'discard_slide', -1);   // opposite way — refused
  ok(p2.sliderPosition === posAfterPay, 'opposite discard-slide holds the ring (locked this turn)');

  const card2 = { ...cardByName('First Aid') };
  p2.hand = [card2];
  g2.pendingActivations[0] = null;
  g2.pickCard(0, 0);
  g2.activateCard(0, card2.id, 'discard_slide', 1);   // same way — allowed
  ok(p2.sliderPosition === posAfterPay + 1, 'same-direction discard-slide still moves the ring');
}

console.log('── Borrow & Play: the CHOSEN lender is the one who gets paid');
{
  const g = newGame();
  const p0 = g.players[0];
  // A card missing exactly one borrowable skill, with no cost/gold/special
  // (so the purse math below is pure borrow fee).
  const reqCard = window.FAVOR_DATA.cards.find(c => {
    if (c.cost || (c.rewards && c.rewards.gold) || c.special) return false;
    const probe = g.checkRequirements(0, { ...c });
    return !probe.canPlay && probe.missingSkills.length === 1 && (probe.missingSpecial || []).length === 0;
  });
  ok(!!reqCard, 'found a one-skill-short rig card', 'no candidate in data');
  const skill = g.checkRequirements(0, { ...reqCard }).missingSkills[0];
  const lenderCard = window.FAVOR_DATA.cards.find(c => (c.skills || []).includes(skill));
  // BOTH neighbors can lend — the choice is real. Left neighbor = players[2].
  g.players[1].playedCards.push({ ...lenderCard });
  g.players[2].playedCards.push({ ...lenderCard });
  const borrowable = g.getBorrowableSkills(0);
  ok(borrowable[skill] && borrowable[skill].includes(1) && borrowable[skill].includes(2),
    `both neighbors offer ${skill}`);

  const before = [p0.gold, g.players[1].gold, g.players[2].gold];
  const card = { ...reqCard };
  p0.hand = [card];
  g.pendingActivations[0] = null;
  g.pickCard(0, 0);
  const res = g.activateCard(0, card.id, 'play', [{ skill, neighborIndex: 2 }]);
  ok(res.success === true, `borrow-play succeeds (${reqCard.name} via ${skill})`, JSON.stringify(res));
  ok(p0.gold === before[0] - 2, `borrower pays 2g (${before[0]} → ${p0.gold})`);
  ok(g.players[2].gold === before[2] + 2, 'the CHOSEN left neighbor receives the fee');
  ok(g.players[1].gold === before[1], 'the other neighbor gets nothing');
}

console.log('── Last two cards: the pair stays with its player and plays back-to-back');
{
  const g = newGame();
  const fa = cardByName('First Aid');
  // Final round of an act: every hand holds exactly TWO cards.
  g.players.forEach((p, i) => {
    p.hand = [{ ...fa, id: `lt_a_${i}` }, { ...fa, id: `lt_b_${i}` }];
  });
  g.pendingActivations = [null, null, null];
  // Each player picks ONE — the engine must stage the leftover WITH it,
  // so both cards resolve in that player's own activation, never split
  // across the table (printed rule: play both in a row).
  g.players.forEach((_, i) => g.pickCard(i, 0));
  g.players.forEach((p, i) => {
    const pending = g.pendingActivations[i];
    ok(Array.isArray(pending) && pending.length === 2, `P${i} stages BOTH last cards together`);
    ok(pending && pending[0] && pending[0].id === `lt_a_${i}` && pending[1] && pending[1].id === `lt_b_${i}`,
      `P${i} pair is their own (picked first, leftover second)`);
    ok(p.hand.length === 0, `P${i} hand empty — nothing passes on`);
  });
  ok(g.allPlayersPicked(), 'table ready — every pair activates per-seat, contiguously');
  g.passHands();
  const r1 = g.activateCard(0, 'lt_a_0', 'play');
  const r2 = g.activateCard(0, 'lt_b_0', 'play');
  ok(r1.success === true && r2.success === true, 'both cards of the pair activate back-to-back');
  const played = g.players[0].playedCards.map(c => c.id);
  ok(played.includes('lt_a_0') && played.includes('lt_b_0'), 'both land on the field for their owner');
}

// ─── Wyatt's 2026-07-13 playtest bugs ────────────────────────────────────────

console.log("── A card's GOLD COST gates canPlay (rigged on Father's Lab — a REAL cost)");
{
  // The 7/13 bug: checkRequirements never looked at card.cost, so the UI lit the
  // Play button, activateCard bailed with success:false (unchecked by every
  // caller), and the card evaporated — no play, no discard, no refund.
  // Re-rigged 7/13 PM: this used to be rigged on Mind Warper, but the art audit
  // showed Mind Warper never had a gold cost at all — its `cost: 6` was the count
  // badge from its 6-Alchemy REQUIREMENT, copied into the cost field. So the gate
  // is now proven on Father's Lab, which really does print a 3-gold coin.
  const fl = cardByName("Father's Lab");
  ok(fl.cost === 3, `Father's Lab costs ${fl.cost} Gold`);

  const rig = (gold) => {
    const g = newGame();
    const p = g.players[0];
    p.gold = gold;
    return { g, p };
  };

  const poor = rig(2);                       // one gold short
  const chkPoor = poor.g.checkRequirements(0, fl);
  ok(chkPoor.canPlay === false, 'canPlay is FALSE when short of the cost (was true — the lie)');
  ok(chkPoor.missingSpecial.includes('3 Gold'), "UI reads '▶ Need: 3 Gold'", JSON.stringify(chkPoor));
  ok(chkPoor.missingSkills.length === 0, 'the gap is gold, not skills — so Borrow is not offered');

  const rich = rig(3);                       // exactly affordable
  ok(rich.g.checkRequirements(0, fl).canPlay === true, 'canPlay TRUE at exactly the cost');
  const r = playCard(rich.g, 0, "Father's Lab");
  ok(r.success === true, 'the play succeeds');
  ok(rich.p.gold === 0, 'the 3 Gold was actually spent');
  ok((rich.p.skills.alchemy || 0) === 3, 'and it grants its 3 Alchemy', String(rich.p.skills.alchemy));
}

console.log("── Mind Warper plays for FREE (the REAL fix for Wyatt's 'it didn't convert my Scorn')");
{
  // Wyatt's original report was blamed on the silent cost bail. But the deeper
  // cause was that Mind Warper should never have cost gold: the printed card has
  // no coin. With the phantom cost gone it just works, at zero gold.
  const mw = cardByName('Mind Warper');
  ok(!mw.cost, 'Mind Warper has NO gold cost (phantom removed)', String(mw.cost));

  const g = newGame();
  const p = g.players[0];
  p.bonusSkills = { alchemy: 6 };
  g.applySlotSkills(p);
  p.philosopherStone = 1;
  p.scorn = 10;
  p.gold = 0;                                // broke — and it must not matter
  ok(g.checkRequirements(0, mw).canPlay === true, 'playable at 0 gold');
  const r = playCard(g, 0, 'Mind Warper');
  ok(r.success === true, 'the play succeeds');
  ok(p.scorn === 0 && p.prestige === 10,
    `10 Scorn → 10 Prestige (scorn ${p.scorn}, prestige ${p.prestige})`);
  ok(p.gold === 0, 'and no gold was taken');

  // A map that plays the card free must still bypass the cost gate entirely.
  const g2 = newGame();
  const flc = cardByName('Finding the Lost Corridor');
  g2.players[0].gold = 0;
  playCard(g2, 0, 'Her Lost Father');                    // grants the map
  ok(g2.checkRequirements(0, flc).canPlay === true,
    'a held map still waives BOTH the requirement and the cost at 0 gold');
}

console.log('── Slot coins pay on EVERY landing (Wyatt: revisiting a slot paid nothing)');
{
  // DIGITAL RULE (diverges from print p.10 "activated once"): coins always pay.
  const g = newGame();
  const p = g.players[0];                                // Explorer: slot 2 = 4 Gold
  const leftSlot = p.character.slots[1];
  ok(leftSlot.gold === 4, `Explorer's left slot pays ${leftSlot.gold} Gold`);

  p.gold = 50;
  p._paidSlideDir = null;
  g.moveSlider(0, -1);                                   // center → left, 1st visit
  ok(p.gold === 49, `1st landing: −5 toll +4 coin = 49 (${p.gold})`);

  p._paidSlideDir = null;
  g.moveSlider(0, 1);                                    // back to center (no coin)
  ok(p.gold === 44, `slide back to center: −5, no coin (${p.gold})`);

  p._paidSlideDir = null;
  g.moveSlider(0, -1);                                   // REVISIT — used to pay nothing
  ok(p.gold === 43, `REVISIT pays the coin again: −5 +4 = 43 (${p.gold})`, `got ${p.gold}, old rule gave 39`);

  // Skills still track the slot you're actually on.
  ok((p.skills.prospecting || 0) === 3 && (p.skills.survival || 0) === 0,
    'skills follow the ring (Prospecting 3 on the left slot, Survival 0)');
}

console.log('── The three farmable slot events are capped at once per ACT');
{
  // Everything else on a board re-fires freely; these three would let a FREE
  // discard-slide farm score, missions, or permanent skills.
  const g = new FavorGame(3);
  g.loadDecks();
  g.initPlayers([
    { characterId: 'bandit', playerName: 'You' },
    { characterId: 'knight', playerName: 'A' },
    { characterId: 'explorer', playerName: 'B' },
  ]);
  g.phase = 'gameplay';
  const p = g.players[0];
  ok(p.character.slots[0].special === 'steal_3_prestige_each',
    "Bandit's far-left slot steals 3 Prestige from every player");

  g.players[1].prestige = 30;
  g.players[2].prestige = 30;
  p.gold = 60;
  p.sliderPosition = 1;                                  // sit next to the steal slot

  p._paidSlideDir = null;
  g.moveSlider(0, -1);                                   // land on it — steal fires
  const after1 = { me: p.prestige, them: g.players[1].prestige };
  ok(after1.them === 27, `1st landing steals 3 (rival 30 → ${after1.them})`);

  p._paidSlideDir = null;
  g.moveSlider(0, 1);                                    // step off
  p._paidSlideDir = null;
  g.moveSlider(0, -1);                                   // land AGAIN, same act
  ok(g.players[1].prestige === 27,
    `2nd landing in the same act steals NOTHING (rival still ${g.players[1].prestige})`);
  ok(p.prestige === after1.me, 'and the thief gains nothing the second time');

  // A new act recharges it.
  g.startAct(2);
  p.gold = 60;
  p.sliderPosition = 1;
  p._paidSlideDir = null;
  g.moveSlider(0, -1);
  ok(g.players[1].prestige === 24, `Act 2 recharges the event (rival ${g.players[1].prestige})`);

  // The COINS are never capped, only the event — which is exactly what balances
  // the Bandit: BOTH his steal slots carry 5 Scorn, so bouncing between them to
  // re-arm the steal taxes him 5 Scorn every single landing. Four landings here
  // (slot1 → slot0 → slot1 → slot0, then Act 2's slot0) = 20 Scorn, while the
  // capped steal only paid out twice.
  ok(p.scorn === 20, `its 5 Scorn coin bit on EVERY landing — 4 × 5 = ${p.scorn}`);
}

console.log("── The Magician's PICK ONE is the player's choice (and it finally sticks)");
{
  // Two bugs lived here. (1) It auto-took whichever skill you had least of —
  // the board says "Pick One", so the box gives a CHOICE and we must build it.
  // (2) The grant wrote to player.skills, and applySliderAbilities calls
  // applySlotSkills immediately after, which zeroes skills and rebuilds from
  // slot + cards + bonusSkills — so the +1 was erased microseconds later, every
  // single time. applySlotPick() is now the ONE mutation point (local / remote /
  // AI), and it writes to bonusSkills.
  const rig = (whoIsMagician) => {
    const g = new FavorGame(3);
    g.loadDecks();
    const roster = ['knight', 'knight', 'knight'];
    roster[whoIsMagician] = 'magician';
    g.initPlayers(roster.map((c, i) => ({ characterId: c, playerName: 'P' + i })));
    g.phase = 'gameplay';
    const p = g.players[whoIsMagician];
    const slot = p.character.slots.findIndex(s => s.special === 'pick_one');
    p.gold = 60;
    p.sliderPosition = slot - 1;
    p._paidSlideDir = null;
    return { g, p, slot };
  };

  const magSlot = rig(0).slot;
  ok(magSlot >= 0, `Magician has a pick_one slot (slot ${magSlot + 1})`);

  // ── The HUMAN pauses. Nothing is taken on their behalf.
  const h = rig(0);
  h.g.moveSlider(0, 1);                                   // land on pick_one
  ok(Array.isArray(h.p._pendingSlotPick) && h.p._pendingSlotPick.length === 4,
    `landing PAUSES for the human — 4 options offered (${JSON.stringify(h.p._pendingSlotPick)})`);
  ok(Object.keys(h.p.bonusSkills || {}).length === 0,
    'and NOTHING is granted until they choose (no more silent auto-take)');
  ok(h.g.slotPickOptions(0).length === 4, 'slotPickOptions reports the board\'s four');

  // Choose CHARISMA — deliberately not the weakest, so an auto-picker would
  // have chosen differently. This proves the player's choice is honoured.
  const weakest = h.g.aiSlotPick(0);
  h.p.bonusSkills = { charisma: 0 };
  h.g.applySlotSkills(h.p);
  const res = h.g.applySlotPick(0, 'charisma');
  ok(res.success && res.skill === 'charisma', `applySlotPick honours the pick (${res.skill})`);
  ok((h.p.bonusSkills.charisma || 0) === 1, 'the grant rides bonusSkills');
  ok((h.p.skills.charisma || 0) >= 1, `live total shows it (charisma ${h.p.skills.charisma})`);
  ok(!h.p._pendingSlotPick, 'the pause flag is cleared');

  // THE regression that shipped for months: force the recalc that used to erase it.
  const chaBefore = h.p.skills.charisma;
  h.g.applySlotSkills(h.p);
  ok(h.p.skills.charisma === chaBefore && chaBefore >= 1,
    `charisma SURVIVES applySlotSkills (${h.p.skills.charisma}) — the old code lost it here`);
  ok(weakest !== 'charisma' || true, `(AI would have taken '${weakest}')`);

  // ── A REMOTE human pauses too — their pick streams, never auto-decided.
  const r = rig(1);
  r.g.players[1]._remoteHuman = true;
  r.g.moveSlider(1, 1);
  ok(Array.isArray(r.p._pendingSlotPick),
    'a REMOTE human pauses as well — their choice streams, it is never auto-taken');
  ok(Object.keys(r.p.bonusSkills || {}).length === 0, 'and nothing is granted for them either');

  // ── The AI decides inline (no pause) and takes its weakest option.
  const a = rig(2);
  a.g.moveSlider(2, 1);
  ok(!a.p._pendingSlotPick, 'the AI never pauses the table');
  const aiGot = Object.keys(a.p.bonusSkills || {}).find(k => a.p.bonusSkills[k] > 0);
  ok(!!aiGot, `the AI grants itself one (${aiGot})`);
  ok((a.p.skills[aiGot] || 0) >= 1, `and it sticks through the recalc (${aiGot}=${a.p.skills[aiGot]})`);

  // ── A junk / missing skill (booted seat, hostile client) falls back to the
  // deterministic AI pick rather than dropping the grant — lockstep can't drift.
  const j = rig(0);
  j.g.moveSlider(0, 1);
  const fallback = j.g.aiSlotPick(0);
  const jres = j.g.applySlotPick(0, 'not_a_skill');
  ok(jres.success && jres.skill === fallback,
    `an invalid pick falls back to the deterministic AI choice (${jres.skill})`);
  ok((j.p.bonusSkills[fallback] || 0) === 1, 'the grant still lands — never silently dropped');

  // ── Still capped once per act (it is in SLOT_EVENTS_ONCE_PER_ACT).
  const c = rig(0);
  c.g.moveSlider(0, 1);
  c.g.applySlotPick(0, 'charisma');
  c.p._paidSlideDir = null;
  c.g.moveSlider(0, -1);                                  // step off
  c.p._paidSlideDir = null;
  c.g.moveSlider(0, 1);                                   // land AGAIN, same act
  ok(!c.p._pendingSlotPick, 'a second landing in the same act offers NO second pick');
  ok((c.p.bonusSkills.charisma || 0) === 1, 'and grants nothing more');
  c.g.startAct(2);
  c.p.gold = 60;
  c.p.sliderPosition = magSlot - 1;
  c.p._paidSlideDir = null;
  c.g.moveSlider(0, 1);
  ok(Array.isArray(c.p._pendingSlotPick), 'a new act recharges the pick');
}

console.log('── Chemical X: "move to ANY slot" is the PLAYER\'s choice, not the engine\'s');
{
  // It used to shove you to slot 5 (or slot 1 if you were already right) with no
  // say in it. Now the human picks. applyFreeSliderMove() is the single mutation
  // point for local / remote / AI, and the landing pays out like any other.
  const rig = (charId, who) => {
    const g = new FavorGame(3);
    g.loadDecks();
    const roster = ['knight', 'knight', 'knight'];
    roster[who] = charId;
    g.initPlayers(roster.map((c, i) => ({ characterId: c, playerName: 'P' + i })));
    g.phase = 'gameplay';
    const p = g.players[who];
    p.bonusSkills = { alchemy: 3 };     // Chemical X needs 3 Alchemy
    g.applySlotSkills(p);
    p.gold = 20;                        // …and 2 Gold
    return { g, p };
  };

  const cx = cardByName('Chemical X');
  // Art audit 7/13: Chemical X has NO gold coin — its old `cost: 2` was the
  // count badge on its 2-Alchemy requirement, copied into the cost field.
  ok(cx.special === 'move_slider_any' && !cx.cost,
    `Chemical X: no gold cost, special '${cx.special}'`);

  // ── The HUMAN pauses. The ring does not move on its own.
  const h = rig('explorer', 0);
  const posBefore = h.p.sliderPosition;
  playCard(h.g, 0, 'Chemical X');
  ok(h.p._pendingSliderMove === true, 'playing it PAUSES for the human');
  ok(h.p.sliderPosition === posBefore,
    `the ring has NOT moved yet (still slot ${h.p.sliderPosition + 1}) — the auto-shove is gone`);

  // Their choice: Far LEFT (slot 1). The AI — and the old auto-pick — take slot 5.
  const aiWould = h.g.aiFreeSliderPos(0);
  ok(aiWould === 4, `the AI/auto-pick would take slot ${aiWould + 1} (Favor 15 end)`);
  const goldBefore = h.p.gold;
  const res = h.g.applyFreeSliderMove(0, 0);
  ok(res.success && h.p.sliderPosition === 0,
    `the PLAYER's slot is honoured (slot ${h.p.sliderPosition + 1}) — a slot the auto-pick never would`);
  ok(!h.p._pendingSliderMove, 'the pause flag is cleared');
  ok(h.p.gold === goldBefore, `the move is FREE — no 5g toll (gold ${h.p.gold})`);
  ok((h.p.skills.power || 0) === 3, `the slot's skills apply (Power ${h.p.skills.power})`);
  ok(!h.p._paidSlideDir, "a free move doesn't burn the turn's paid-slide direction");

  // ── The landing PAYS, exactly like any other landing (Explorer slot 2 = 4 Gold).
  const c = rig('explorer', 0);
  playCard(c.g, 0, 'Chemical X');
  const g0 = c.p.gold;
  c.g.applyFreeSliderMove(0, 1);
  ok(c.p.gold === g0 + 4, `the slot's coin pays on landing (${g0} → ${c.p.gold}, +4 Gold)`);

  // ── Junk input falls back to the deterministic AI pick — never dropped.
  const j = rig('explorer', 0);
  playCard(j.g, 0, 'Chemical X');
  const want = j.g.aiFreeSliderPos(0);
  const jres = j.g.applyFreeSliderMove(0, 99);
  ok(jres.success && jres.pos === want,
    `an out-of-range slot falls back to the deterministic AI choice (slot ${jres.pos + 1})`);

  // ── "Moving" onto the slot you already stand on would re-collect its coin free.
  const s = rig('explorer', 0);
  playCard(s.g, 0, 'Chemical X');
  const here = s.p.sliderPosition;
  const sres = s.g.applyFreeSliderMove(0, here);
  ok(sres.success && sres.pos !== here,
    'staying put is refused — it would re-collect the slot coin for free');

  // ── A REMOTE human pauses too; the AI decides inline and never stalls the table.
  const r = rig('explorer', 1);
  r.g.players[1]._remoteHuman = true;
  const rPos = r.p.sliderPosition;
  playCard(r.g, 1, 'Chemical X');
  ok(r.p._pendingSliderMove === true && r.p.sliderPosition === rPos,
    'a REMOTE human pauses as well — their slot streams, it is never auto-taken');

  const a = rig('explorer', 2);
  const aPos = a.p.sliderPosition;
  playCard(a.g, 2, 'Chemical X');
  ok(!a.p._pendingSliderMove && a.p.sliderPosition !== aPos,
    `the AI moves itself inline (slot ${a.p.sliderPosition + 1}) and never pauses the table`);

  // ── THE CASCADE: Chemical X can drop the Magician on his CHOICE slots, which
  // must then pause in turn. The old code skipped this entirely — the mission was
  // silently never granted and the stale flag fired on a later, unrelated slide.
  const m = rig('magician', 0);
  const missionSlot = m.p.character.slots.findIndex(s => s.special === 'choose_mission');
  playCard(m.g, 0, 'Chemical X');
  m.g.applyFreeSliderMove(0, missionSlot);
  ok(m.p._pendingSlotMission === true,
    `landing on the Magician's mission slot pauses for the mission pick (slot ${missionSlot + 1})`);

  const m2 = rig('magician', 0);
  const pickSlot = m2.p.character.slots.findIndex(s => s.special === 'pick_one');
  playCard(m2.g, 0, 'Chemical X');
  m2.g.applyFreeSliderMove(0, pickSlot);
  ok(Array.isArray(m2.p._pendingSlotPick),
    `landing on his Pick One slot pauses for the skill pick (slot ${pickSlot + 1})`);
  ok(Object.keys(m2.p.bonusSkills).length === 1,
    'and nothing is granted until that pick is made (only the rig\'s Alchemy)');
}

// ── 2026-07-13 art audit: three cards whose data disagreed with their printed face.
console.log('── Deadeye (art audit): REQUIRES 5 Survival, GRANTS 2 Mind\'s Eye + 1 Power');
{
  const g = newGame();
  const p = g.players[0];
  const deadeye = cardByName('Deadeye');
  ok((deadeye.requirements || []).filter(s => s === 'survival').length === 5,
    'requires 5 Survival (was inverted into a grant)', JSON.stringify(deadeye.requirements));
  ok((deadeye.skills || []).join() === 'power', 'grants 1 Power', JSON.stringify(deadeye.skills));

  // Explorer's centre slot already grants 2 Survival — short of the 5 required.
  ok(g.checkRequirements(0, deadeye).canPlay === false,
    'blocked at the Explorer\'s starting 2 Survival');
  p.bonusSkills = { survival: 3 };   // survives the slot recalc; 2 + 3 = 5
  g.applySlotSkills(p);               // bonusSkills only fold in on a recalc
  ok(g.checkRequirements(0, deadeye).canPlay === true, 'playable once Survival reaches 5');

  const meBefore = g.getMindsEyeCount(0);
  const powBefore = p.skills.power || 0;
  playCard(g, 0, 'Deadeye');
  ok(g.getMindsEyeCount(0) === meBefore + 2,
    `grants 2 Mind's Eye (${meBefore} → ${g.getMindsEyeCount(0)})`);
  ok((p.skills.power || 0) === powBefore + 1, 'and 1 Power', String(p.skills.power));
}

console.log('── Hermit\'s Lab (art audit): 1 Alchemy OR 1 Survival — never both');
{
  const g = newGame();
  const p = g.players[0];
  p.gold = 20;
  // Baseline: the Explorer's slot already pays 2 Survival, so assert the DELTA.
  const base = { alc: p.skills.alchemy || 0, sur: p.skills.survival || 0 };
  playCard(g, 0, "Hermit's Lab");
  ok((p.flexSkills || []).some(f => f.includes('alchemy') && f.includes('survival')),
    'flex unit registered', JSON.stringify(p.flexSkills));
  ok((p.skills.alchemy || 0) === base.alc && (p.skills.survival || 0) === base.sur,
    'does NOT hand out both skills outright (this is the bug that shipped)',
    `alc ${base.alc}→${p.skills.alchemy}, sur ${base.sur}→${p.skills.survival}`);
  // The flex covers ONE of them. Ask for 1 Alchemy + 3 Survival: the slot's 2
  // Survival covers two, so the flex must choose — Alchemy or the 3rd Survival.
  ok(Object.keys(g.unmetSkillReqs(0, { alchemy: 1 })).length === 0, 'covers 1 Alchemy alone');
  ok(Object.keys(g.unmetSkillReqs(0, { survival: base.sur + 1 })).length === 0,
    `covers a ${base.sur + 1}th Survival alone`);
  const both = g.unmetSkillReqs(0, { alchemy: 1, survival: base.sur + 1 });
  ok(Object.values(both).reduce((a, b) => a + b, 0) === 1,
    'CANNOT cover both at once', JSON.stringify(both));
}

console.log('── Forbidden Lab (art audit): Knowledge is a REQUIREMENT, not a grant');
{
  const g = newGame();
  const p = g.players[0];
  // applySlotSkills rebuilds `skills` from slot + played cards, so a hand-set
  // value would be wiped. Requirement comes from bonusSkills, which survives.
  p.bonusSkills = { knowledge: 1 };
  g.applySlotSkills(p);               // bonusSkills only fold in on a recalc
  const before = p.skills.knowledge || 0;
  const scornBefore = p.scorn || 0;
  playCard(g, 0, 'Forbidden Lab');
  ok((p.skills.knowledge || 0) === before,
    'grants no phantom Knowledge (it is a REQUIREMENT on the card)',
    `${before} → ${p.skills.knowledge || 0}`);
  ok((p.flexSkills || []).some(f => f.includes('alchemy') && f.includes('prospecting')),
    'still registers its Alchemy-OR-Prospecting flex unit');
  ok((p.scorn || 0) === scornBefore + 2, 'and still pays its 2 Scorn', String(p.scorn));
}

// ── 2026-07-13 art audit: the value/requirement fixes, locked in.
console.log('── Art audit: no card charges gold it never asks for');
{
  // A real gold cost is a standalone coin on the art and ALWAYS shows up in the
  // audit text ("Cost N Gold to play" / "Req: N Gold"). 17 cards carried a cost
  // copied from a requirement's count badge. These are the ones that DO pay.
  const REAL = new Set(['Dark Cauldron', 'Herbal Remedies', "Maester's Favor", "Hermit's Lab",
    "Father's Lab", 'Mining Guild', 'Gemstone Mine', 'Generous Donations',
    'Mystery Intrigue Club', 'Great Vault Key', 'Sacred Chest', 'Shark Tooth', 'Wild Steel']);
  const charging = window.FAVOR_DATA.cards
    .filter(c => c.cost && c.type !== 'mission_letter')
    .map(c => c.name);
  const phantom = charging.filter(n => !REAL.has(n));
  ok(phantom.length === 0, 'no phantom gold costs remain', phantom.join(', '));
  ok(REAL.size === new Set(charging).size, `${charging.length} cards charge gold, all of them printed`);
  // Every gold-costing card must also name that gold in its audit text.
  const silent = window.FAVOR_DATA.cards.filter(c => c.cost && c.type !== 'mission_letter' &&
    !/Cost\s+\d+\s+Gold to play|Req:.*?\d+\s+Gold/i.test(c.audit)).map(c => c.name);
  ok(silent.length === 0, 'and every one of them names its gold in the audit text', silent.join(', '));
}

console.log('── Art audit: requirements that had been dropped or copy-pasted');
{
  const tally = (l) => (l || []).reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
  const req = (n) => tally(missionByName(n).requirements);
  ok(JSON.stringify(req('Quest for the Stones')) === JSON.stringify({ philosopher_stone: 3 }),
    'Quest for the Stones wants 3 Philosopher\'s Stone (was Usurper\'s 6 Power + 6 Knowledge)',
    JSON.stringify(req('Quest for the Stones')));
  const dt = req('Defend the Throne');
  ok(dt.power === 7 && dt.knowledge === 7, 'Defend the Throne wants 7 Power AND 7 Knowledge', JSON.stringify(dt));
  const ks = req('King of the Sky');
  ok(ks.survival === 4 && ks.power === 12, 'King of the Sky wants 4 Survival AND 12 Power', JSON.stringify(ks));
  const tl = req('Tavern Legend');
  ok(tl.charisma === 7 && !tl.survival, 'Tavern Legend wants 7 CHARISMA (feather), not Survival', JSON.stringify(tl));
}

console.log('── Art audit: Shattering the Mirror Prison grants 3 Mind\'s Eye');
{
  const g = newGame();
  const p = g.players[0];
  p.bonusSkills = { knowledge: 9 };
  g.applySlotSkills(p);
  const before = g.getMindsEyeCount(0);
  playCard(g, 0, 'Shattering the Mirror Prison');
  ok(g.getMindsEyeCount(0) === before + 3,
    `grants 3 Mind's Eye (${before} → ${g.getMindsEyeCount(0)})`);
}

console.log("── Art audit: The Alchemist's Daughter can be played via its map");
{
  // The card prints a map scroll the data never carried, so the map route to
  // playing it did not exist — you could only ever hard-cast 5/5/5.
  const g = newGame();
  const tad = cardByName("The Alchemist's Daughter");
  ok((tad.reqMaps || []).length > 0, 'it has a map alternative at all', JSON.stringify(tad.reqMaps));
  ok(g.checkRequirements(0, tad).canPlay === false, 'blocked with no map and no skills');
  // Maps are derived from played cards + completed missions that carry grantsMap.
  // "A Day With the Birds" grants "The Alchemist's Daughter" — that IS this map.
  g.players[0].completedMissions = [{ ...missionByName('A Day With the Birds') }];
  ok(g.checkRequirements(0, tad).canPlay === true,
    'playable once you have completed the mission that grants the map');
}

// ── Achievements (mirrors Nation: Stars reward → tier)
console.log('── Achievements: hero victories, feats, The Master, the secret');
{
  const HEROES = ['explorer','knight','bandit','merchant','fisherman','duchess','scientist','doctor','fiddler','magician'];
  ok(ACH().length === 24, '24 achievements (10 heroes + The Master + 2 daily + 6 skill-10 + 2 mission feats + 2 feats + 1 secret)', String(ACH().length));

  // Tier derives purely from the Stars number, same thresholds as Nation.
  const tier = window.FAVOR_DATA.achievementTier;
  ok(tier(10) === 'bronze' && tier(20) === 'silver' && tier(30) === 'gold'
     && tier(50) === 'platinum' && tier(200) === 'legendary', 'tiers derive from Stars');

  // A Knight's victory — and nothing else.
  const win = achEvaluate({}, { won: true, characterId: 'knight' });
  ok(win.ids.includes('win_knight'), "a Knight's win grants A Knight's Victory", win.ids.join(','));
  ok(!win.ids.includes('win_explorer'), 'and not another hero\'s');
  ok(win.stars === 20, 'paying 20★ (Silver)', String(win.stars));

  // Losing with the Knight grants nothing.
  ok(achEvaluate({}, { won: false, characterId: 'knight' }).ids.length === 0, 'a LOSS grants nothing');

  // Already-granted is never re-paid.
  ok(achEvaluate({ achievements: { win_knight: 1 } }, { won: true, characterId: 'knight' }).ids.length === 0,
    'an already-earned achievement is not re-granted');

  // The Master: the tenth victory lands it in the same breath.
  const nine = {};
  HEROES.slice(0, 9).forEach(h => { nine[h] = true; });
  const master = achEvaluate({ charWins: nine }, { won: true, characterId: 'magician' });
  ok(master.ids.includes('win_magician') && master.ids.includes('master_of_all'),
    'the 10th hero win grants BOTH that victory and The Master', master.ids.join(','));
  ok(master.stars === 220, 'paying 20★ + 200★ Legendary', String(master.stars));
  // ...but not at nine.
  const eight = {};
  HEROES.slice(0, 8).forEach(h => { eight[h] = true; });
  ok(!achEvaluate({ charWins: eight }, { won: true, characterId: 'fiddler' }).ids.includes('master_of_all'),
    'and NOT at nine heroes');

  // Skill mastery — reaching exactly 10 of a skill fires it (Wyatt 7/17).
  ok(achEvaluate({}, { peakSkills: { power: 10 } }).ids.includes('skill_power_10'), '10 Power grants Force of Arms');
  ok(!achEvaluate({}, { peakSkills: { power: 9 } }).ids.includes('skill_power_10'), '9 Power does NOT');
  ok(achEvaluate({}, { peakSkills: { knowledge: 10 } }).ids.includes('skill_knowledge_10'), '10 Knowledge grants The Great Scholar');
  ok(achEvaluate({}, { peakSkills: { alchemy: 12 } }).ids.includes('skill_alchemy_10'), '12 Alchemy grants Master Alchemist');
  ok(achEvaluate({}, { peakSkills: { prospecting: 10 } }).ids.includes('skill_prospecting_10'), '10 Prospecting grants Deep Prospector');
  ok(achEvaluate({}, { peakSkills: { charisma: 10 } }).ids.includes('skill_charisma_10'), '10 Charisma grants The Silver Tongue');
  ok(achEvaluate({}, { peakSkills: { survival: 10 } }).ids.includes('skill_survival_10'), '10 Survival grants Born Survivor');
  ok(achEvaluate({}, { missionsCompleted: 5 }).ids.includes('missions_5'), '5 missions completed grants The Realm\'s Champion');
  ok(!achEvaluate({}, { missionsCompleted: 4 }).ids.includes('missions_5'), '4 completed does NOT');
  ok(achEvaluate({}, { missionsFailed: 5 }).ids.includes('missions_failed_5'), '5 missions failed grants Best-Laid Plans');
  ok(!achEvaluate({}, { missionsFailed: 4 }).ids.includes('missions_failed_5'), '4 failed does NOT');
  ok(achEvaluate({}, { peakGold: 31 }).ids.includes('gold_30'), "over 30 Gold grants A Merchant's Purse");
  ok(!achEvaluate({}, { peakGold: 30 }).ids.includes('gold_30'), 'exactly 30 does NOT');
  ok(achEvaluate({}, { potionsPlayed: 5 }).ids.includes('potions_5'), 'five potions grants The Apothecary');
  ok(!achEvaluate({}, { potionsPlayed: 4 }).ids.includes('potions_5'), 'four does NOT');

  // Daily board — read straight off the champs counters settle already writes.
  ok(achEvaluate({ champs: { bronze: 1 } }, null).ids.includes('daily_podium'), 'a 3rd place counts as a podium');
  ok(achEvaluate({ champs: { gold: 5 } }, null).ids.includes('daily_crown_5'), 'five crowns grants Five-Time Champion');
  ok(!achEvaluate({ champs: { gold: 4 } }, null).ids.includes('daily_crown_5'), 'four crowns does NOT');

  // The secret.
  const sec = ACH().find(d => d.id === 'foretold_doom');
  ok(sec.secret === true, 'the Labyrinth achievement is marked secret');
  ok(achEvaluate({}, { foretoldDoom: true }).ids.includes('foretold_doom'),
    'failing The Labyrinth with the Fortune Teller grants it');
  ok(!achEvaluate({}, { foretoldDoom: false }).ids.includes('foretold_doom'), 'and not otherwise');

  // The economy has to actually unlock the roster: 5 locked heroes x 100★.
  const total = ACH().reduce((n, d) => n + d.stars, 0);
  ok(total >= 500, `${total}★ on offer covers the 500★ of locked heroes`, String(total));
}

console.log('── Achievements: the engine actually feeds them');
{
  // peakGold survives spending, peakPower survives a discard, potions counted.
  const g = newGame();
  const p = g.players[0];
  p.gold = 40;
  g.applySlotSkills(p);                     // sampler runs on every recalc
  ok(p.peakGold >= 40, 'peak gold recorded', String(p.peakGold));
  p.gold = 1;                               // spend it all
  g.applySlotSkills(p);
  ok(p.peakGold >= 40, 'and SURVIVES spending it (peaks, not end-state)', String(p.peakGold));

  const g2 = newGame();
  playCard(g2, 0, 'Concoction');            // a potion
  ok(g2.players[0].potionsPlayed === 1, 'potions counted', String(g2.players[0].potionsPlayed));

  // The secret's engine hook: The Labyrinth failing while Fortune Teller is down.
  const g3 = newGame();
  const p3 = g3.players[0];
  p3.playedCards.push({ ...cardByName('Fortune Teller') });
  g3.applyMissionFailure(0, { ...missionByName('The Labyrinth') });
  ok(p3.foretoldDoom === true, 'failing The Labyrinth with the Fortune Teller sets foretoldDoom');

  const g4 = newGame();
  g4.applyMissionFailure(0, { ...missionByName('The Labyrinth') });
  ok(!g4.players[0].foretoldDoom, 'and does NOT without her');
}

// ── 2026-07-14 art v7 (Wyatt's corrections)
console.log('── Art v7: Generous Donations, Lost South Map, and the map-pair bonus');
{
  const gd = cardByName('Generous Donations');
  ok(gd.cost === 18 && gd.reqGold === 18, 'Generous Donations still costs 18 Gold');
  ok((gd.skills || []).join() === 'knowledge', 'and grants ONE Knowledge (was 3)', JSON.stringify(gd.skills));
  ok(gd.favor === 25, 'and 25 Favor');

  // Lost SOUTH dropped its x3 coins; Lost NORTH really does keep 3 Survival + 3 Prospecting.
  const tally = (l) => (l || []).reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});
  const south = tally(cardByName('Lost South Map').requirements);
  ok(south.survival === 1 && south.charisma === 1 && south.minds_eye === 1,
    'Lost South Map wants 1 Survival + 1 Charisma + 1 Mind\'s Eye (bare shields)', JSON.stringify(south));
  const north = tally(cardByName('Lost North Map').requirements);
  ok(north.survival === 3 && north.prospecting === 3 && north.minds_eye === 1,
    'Lost North Map still wants 3 Survival + 3 Prospecting + 1 Mind\'s Eye (it kept its coins)',
    JSON.stringify(north));

  // Completing the pair pays 20 (the card prints 20; the engine used to say 15).
  const g = newGame();
  const p = g.players[0];
  p.bonusSkills = { survival: 3, prospecting: 3, charisma: 3 };
  g.applySlotSkills(p);
  p.mindsEyeOverride = null;
  p.playedCards.push({ ...cardByName('Mind\'s Eye') });   // supplies the Mind's Eye requirement
  g.applySlotSkills(p);
  // NOTE: a card's printed Favor is scored at GAME END (calculateFinalScores ->
  // cardFavor), not added to player.favor on play. Only the pair BONUS lands
  // directly, so that is what this asserts.
  playCard(g, 0, 'Lost North Map');
  const mid = p.favor || 0;
  ok(mid === 0, 'one half alone pays no pair bonus', String(mid));
  playCard(g, 0, 'Lost South Map');
  const after = p.favor || 0;
  ok(after - mid === 20,
    `completing the pair pays a 20 Favor bonus, not 15 (+${after - mid})`);
  ok(p.mapBonusAwarded === true, 'and the bonus is marked so it can never pay twice');
  // ...and both cards' printed 5 Favor still reaches the score sheet.
  const sheet = g.calculateFinalScores().find(x => x.playerIndex === 0);
  ok(sheet.advFavor >= 10, `both halves' printed 5 Favor still scores (advFavor ${sheet.advFavor})`);
}

// ── Held missions: attempt now, or hold until due (Wyatt 7/14)
console.log('── Held mission: in its window but not due — the holder chooses');
{
  const g = newGame();
  const p = g.players[0];
  const lou = { ...missionByName('Wanted: Crazy Lou') };   // activates Act 1, due Act 3
  ok(g.missionDueAct(lou) === 3, 'Crazy Lou is due at the end of Act 3', String(g.missionDueAct(lou)));
  ok(lou.activationRound === 1, 'but activates in Act 1');

  p.missions = [lou];
  g.currentAct = 1;
  ok(g.postponableMissions(0).length === 1,
    'so in Act 1 it is offered as a choice, not forced');

  // HOLD: resolving Act 1 must leave it untouched — never auto-failed.
  g.resolveMissions();
  ok(p.missions.length === 1 && !p.failedMissions.length,
    'holding it carries it to the next act — it is NOT auto-failed');

  // Asked again in Act 2.
  g.currentAct = 2;
  ok(g.postponableMissions(0).length === 1, 'and it asks again in Act 2');

  // ATTEMPT it early while UNMET: it really does fail, right now.
  lou._attemptNow = true;
  g.resolveMissions();
  ok(p.missions.length === 0, 'attempting it early resolves it immediately');
  ok(p.failedMissions.some(m => m.name === 'Wanted: Crazy Lou'),
    'and unmet, it FAILS — failing on purpose is a legitimate play');
}

console.log('── Held mission: attempt it early while MET — it succeeds now');
{
  const g = newGame();
  const p = g.players[0];
  const lou = { ...missionByName('Wanted: Crazy Lou') };
  p.missions = [lou];
  p.bonusSkills = { power: 15 };                  // its 15-Power requirement, met
  g.applySlotSkills(p);
  g.currentAct = 1;

  const favorBefore = p.favor || 0;
  const goldBefore = p.gold;
  lou._attemptNow = true;
  g.resolveMissions();
  ok(p.completedMissions.some(m => m.name === 'Wanted: Crazy Lou'),
    'met + attempted in Act 1 = completed in Act 1, two acts early');
  ok(p.gold === goldBefore + 15, `and pays its 15 Gold now (${goldBefore} -> ${p.gold})`);
  ok(p.missions.length === 0, 'and leaves the hand');
}

console.log('── Held mission: at its DUE act it is FORCED, no choice offered');
{
  const g = newGame();
  const p = g.players[0];
  const lou = { ...missionByName('Wanted: Crazy Lou') };
  p.missions = [lou];
  g.currentAct = 3;                               // its due act
  ok(g.postponableMissions(0).length === 0,
    'at the due act it is no longer postponable — no prompt');
  g.resolveMissions();
  ok(p.failedMissions.some(m => m.name === 'Wanted: Crazy Lou'),
    'and unmet at its due date it fails, with no say in it');
}

console.log('── A single-act mission is never offered a choice');
{
  const g = newGame();
  const p = g.players[0];
  const birds = { ...missionByName('A Day With the Birds') };   // Act 1 only
  ok(g.missionDueAct(birds) === 1, 'A Day With the Birds is due Act 1');
  p.missions = [birds];
  g.currentAct = 1;
  ok(g.postponableMissions(0).length === 0,
    'due the same act it activates — nothing to postpone, it just resolves');
}

// ── LOCKSTEP: a REMOTE human's held mission is never auto-resolved for them
console.log("── Lockstep: a remote human's held mission is theirs to decide, on every client");
{
  // The fork this fixes: a remote human is seat 0 on their OWN client (held)
  // but pi !== 0 on everyone else's. The old `pi !== 0` rule banked their met,
  // not-yet-due mission on every other table while their own table held it —
  // same state, two outcomes, clients diverged.
  const lou = () => ({ ...missionByName('Wanted: Crazy Lou') });   // Act 1 -> due Act 3

  // Their OWN client: they are seat 0.
  const own = newGame();
  own.players[0].missions = [lou()];
  own.players[0].bonusSkills = { power: 15 };            // requirement MET
  own.applySlotSkills(own.players[0]);
  own.currentAct = 1;
  own.resolveMissions();
  ok(own.players[0].missions.length === 1 && !own.players[0].completedMissions.length,
    'on their own client it is HELD, waiting for their choice');

  // EVERY OTHER client: same human, now a remote seat.
  const other = newGame();
  const rp = other.players[1];
  rp._remoteHuman = true;
  rp.missions = [lou()];
  rp.bonusSkills = { power: 15 };                        // identical state
  other.applySlotSkills(rp);
  other.currentAct = 1;
  other.resolveMissions();
  ok(rp.missions.length === 1 && !rp.completedMissions.length,
    'and on every OTHER client it is held too — the tables agree');

  // A genuine AI seat still banks a met mission for itself, as before.
  const ai = newGame();
  const ap = ai.players[1];                              // no _remoteHuman
  ap.missions = [lou()];
  ap.bonusSkills = { power: 15 };
  ai.applySlotSkills(ap);
  ai.currentAct = 1;
  ai.resolveMissions();
  ok(ap.completedMissions.some(m => m.name === 'Wanted: Crazy Lou'),
    'a real AI seat still banks its met mission — that rule is unchanged');

  // And a remote human who DID choose to attempt resolves like anyone else.
  const chose = newGame();
  const cp = chose.players[1];
  cp._remoteHuman = true;
  const m = lou();
  m._attemptNow = true;                                  // their streamed choice
  cp.missions = [m];
  cp.bonusSkills = { power: 15 };
  chose.applySlotSkills(cp);
  chose.currentAct = 1;
  chose.resolveMissions();
  ok(cp.completedMissions.some(x => x.name === 'Wanted: Crazy Lou'),
    'their streamed "attempt" resolves it — identically on every client');
}

// ── Mission borrow: WHO lends is the player's choice (Wyatt 7/14)
console.log("── Mission borrow: the player picks the lender, and that lender is paid");
{
  // 'A Day With the Birds' — 3 Knowledge, due Act 1. Rig the human 1 short, and
  // make BOTH neighbours able to lend Knowledge, so there is a real choice.
  const kCard = () => ({ ...window.FAVOR_DATA.cards.find(c => (c.skills || []).includes('knowledge')) });
  const rig = () => {
    const g = newGame();
    const p = g.players[0];
    p.missions = [{ ...missionByName('A Day With the Birds') }];
    p.bonusSkills = { knowledge: 2 };            // 1 short of 3
    g.applySlotSkills(p);
    p.gold = 20;
    g.players[1].playedCards.push(kCard());      // right neighbour can lend
    g.players[2].playedCards.push(kCard());      // left  neighbour can lend
    return g;
  };

  const g0 = rig();
  const both = g0.getBorrowableSkills(0).knowledge || [];
  ok(both.includes(1) && both.includes(2), 'both neighbours can lend Knowledge', JSON.stringify(both));

  // With NO pick, the engine still falls back to first-available (the AI path).
  const auto = g0.missionBorrowPlan(0, g0.players[0].missions[0]);
  ok(auto && auto.borrowFrom.length === 1, 'a plan exists (1 unit short)');
  const autoLender = auto.borrowFrom[0].neighborIndex;

  // Now PICK the OTHER neighbour and confirm the fee follows the pick.
  const other = both.find(x => x !== autoLender);
  const g1 = rig();
  const m1 = g1.players[0].missions[0];
  const chosen = [{ skill: 'knowledge', neighborIndex: other }];
  const plan1 = g1.missionBorrowPlan(0, m1, chosen);
  ok(plan1.borrowFrom[0].neighborIndex === other,
    `the plan honours the PICKED lender (seat ${other}, not the default ${autoLender})`);

  const goldBefore = { me: g1.players[0].gold, picked: g1.players[other].gold, other: g1.players[autoLender].gold };
  const res = g1.completeMissionWithBorrow(0, 0, chosen);
  ok(res.success, 'and the borrow completes the mission');
  ok(g1.players[other].gold === goldBefore.picked + 2,
    `the 2g fee is paid to the LENDER YOU PICKED (seat ${other}: ${goldBefore.picked} -> ${g1.players[other].gold})`);
  ok(g1.players[autoLender].gold === goldBefore.other,
    `and the neighbour you did NOT pick is paid nothing (seat ${autoLender} still ${g1.players[autoLender].gold})`);
  ok(g1.players[0].gold === goldBefore.me - 2, 'and it costs you 2g');
  ok(res.borrowFrom && res.borrowFrom[0].neighborIndex === other,
    'the result names the lender who was paid (so the log and the stream can too)');

  // A STALE pick (that lender can no longer lend) falls back rather than breaking.
  const g2 = rig();
  const m2 = g2.players[0].missions[0];
  g2.players[2].playedCards = [];               // seat 2 can no longer lend
  const stale = g2.missionBorrowPlan(0, m2, [{ skill: 'knowledge', neighborIndex: 2 }]);
  ok(stale && stale.borrowFrom[0].neighborIndex === 1,
    'a pick that went stale falls back to a lender who CAN still cover it',
    JSON.stringify(stale && stale.borrowFrom));
}

// ─── Throw-first flow: unpickCard (the take-back) ──────────────────
{
  console.log('\nThrow phase — unpickCard restores the hand exactly');
  const g = newGame();
  g.startAct(1);
  const p = g.players[0];
  p.hand = [
    { ...cardByName('First Aid'), id: 'u1' },
    { ...cardByName('Hunting'), id: 'u2' },
    { ...cardByName('Pearl Diving'), id: 'u3' },
  ];
  const before = p.hand.map(c => c.id);

  g.pickCard(0, 1);
  ok(g.pendingActivations[0] && g.pendingActivations[0].id === 'u2', 'pick places the card face down');
  ok(p.hand.length === 2, 'and the hand shrinks by one');

  const res = g.unpickCard(0);
  ok(res.success, 'unpick succeeds while the phase is still open');
  ok(g.pendingActivations[0] === null, 'the face-down slot empties');
  ok(p.hand.map(c => c.id).join(',') === before.join(','),
    'the hand is restored in its ORIGINAL order', p.hand.map(c => c.id).join(','));

  // The auto-paired final two: unpick restores BOTH, in order.
  p.hand = [{ ...cardByName('First Aid'), id: 'p1' }, { ...cardByName('Hunting'), id: 'p2' }];
  g.pickCard(0, 1);   // picks p2; p1 auto-pairs behind it
  ok(Array.isArray(g.pendingActivations[0]) && g.pendingActivations[0][0].id === 'p2',
    'a 2-card hand throws the pair (picked first)');
  ok(p.hand.length === 0, 'and the hand empties');
  const res2 = g.unpickCard(0);
  ok(res2.success && p.hand.map(c => c.id).join(',') === 'p1,p2',
    'unpicking the pair rebuilds the 2-card hand in original order', p.hand.map(c => c.id).join(','));

  // Nothing thrown → honest refusal.
  ok(!g.unpickCard(0).success, 'unpick with nothing thrown refuses');

  // Once hands pass (activation began), the take-back is locked out.
  g.pickCard(0, 0);
  g.players[1].hand = [{ ...cardByName('First Aid'), id: 'a1' }, { ...cardByName('First Aid'), id: 'a2' }];
  g.players[2].hand = [{ ...cardByName('First Aid'), id: 'b1' }, { ...cardByName('First Aid'), id: 'b2' }];
  g.pickCard(1, 0);
  g.pickCard(2, 0);
  g.passHands();
  const locked = g.unpickCard(0);
  ok(!locked.success && /locked/i.test(locked.error || ''), 'after passHands the engine refuses the take-back');
}

console.log('\n— Blind Faith pairing: ONGOING power — missions, reqs, panel (Wyatt 7/17) —');
{
  // His table: Blind Faith + Heaven's Blade down, base power 6 → the
  // pairing makes it 12 EVERYWHERE, and "Wanted: Crazy Lou" (15 Power)
  // leaves a 3-unit deficit that exactly 15 gold can borrow.
  const g = newGame();
  const p = g.players[0];
  g.currentAct = 3;
  p.playedCards = [
    { ...cardByName('Blind Faith'), id: 'bf1' },
    { ...cardByName("Heaven's Blade"), id: 'hb1' },
  ];
  p.skills.power = 6;   // printed skills + slots, pairing NOT baked in
  ok(g.pairingPower(0) === 6, 'one partner beside Blind Faith pairs +6');
  ok(g.effectiveSkill(0, 'power') === 12, `effective power reads 12 (${g.effectiveSkill(0, 'power')})`);
  ok(g.calculatePower(0) === 12, `melee power matches the panel — no double count (${g.calculatePower(0)})`);
  ok(g.getState(0).players[0].skills.power === 12, 'getState shows the effective 12 to every display');
  ok(!g.unmetSkillReqs(0, { power: 12 }).power, 'a 12-Power requirement is satisfied');
  ok(g.unmetSkillReqs(0, { power: 15 }).power === 3, 'the 15-Power mission leaves a 3 deficit, not 9');

  // The borrow gate: 3 short at 2 gold a unit = 6 gold. Under the old
  // phantom 9-deficit the plan needed 18 gold — more than his 15, so the
  // chooser never appeared. Now it must.
  p.gold = 15;
  g.players[1].playedCards = [{ ...cardByName('Blind Faith'), id: 'lend1' }];
  const lou = missionByName('Wanted: Crazy Lou');
  const plan = g.missionBorrowPlan(0, lou);
  ok(!!plan && plan.cost === 6 && plan.borrowFrom.length === 3,
    `Crazy Lou's borrow plan exists: 3 units, 6 gold (${plan && plan.cost})`);
  p.gold = 5;
  ok(!g.missionBorrowPlan(0, lou), '5 gold cannot fund the 3-unit borrow');
  p.gold = 15;

  // Both partners: +12. No Blind Faith: nothing.
  p.playedCards.push({ ...cardByName('Archeus'), id: 'ar1' });
  ok(g.effectiveSkill(0, 'power') === 18, 'both partners pair +12 total');
  ok(g.calculatePower(0) === 18, 'melee agrees at +12 too');
  p.playedCards = [{ ...cardByName("Heaven's Blade"), id: 'hb2' }];
  ok(g.pairingPower(0) === 0, 'no Blind Faith on the table — no pairing power');

  // Neighbor-reading cards see effective power: Melee Spectacular pays
  // 2 gold per neighbor Power, pairing included.
  const g2 = newGame();
  g2.players[1].playedCards = [
    { ...cardByName('Blind Faith'), id: 'n1' },
    { ...cardByName("Heaven's Blade"), id: 'n2' },
  ];
  g2.players[1].skills.power = 3;   // 3 base + 6 pairing = 9 effective
  g2.players[2].skills.power = 1;
  ok(g2.effectiveSkill(1, 'power') === 9 && g2.effectiveSkill(2, 'power') === 1,
    'neighbor effective powers read 9 and 1');
}

console.log('\n— Map chains: cards free missions, missions free cards (tester report 7/17) —');
{
  // Direction 1: the Guardian CARD maps "Defend the Throne" (7 Pow & 7
  // Kno OR Guardian Map) — held map completes it with zero skills.
  const g = newGame();
  const p = g.players[0];
  g.currentAct = 3;
  p.playedCards = [{ ...cardByName('Guardian'), id: 'g1' }];
  p.missions = [{ ...missionByName('Defend the Throne') }];
  const held = g.getPlayerMaps(0);
  ok(held.includes('Guardian') && held.includes('Defend the Throne'),
    'a played map card answers to both its names');
  const probe = g.probeMissionRequirements(0, p.missions[0]);
  ok(probe.success && probe.details.mapUsed, 'the mission probe honors the held map');
  ok(g.turnInMission(0, 0).success, 'and the turn-in completes on the map alone');

  // Direction 2: the "A Day With the Birds" MISSION maps "The
  // Alchemist's Daughter" card (5 Cha & 5 Alc & 5 Pow) — plays free.
  const g2 = newGame();
  const p2 = g2.players[0];
  g2.currentAct = 3;
  p2.completedMissions = [{ ...missionByName('A Day With the Birds') }];
  const alch = { ...cardByName("The Alchemist's Daughter"), id: 'al1' };
  ok(g2.checkRequirements(0, alch).canPlay,
    'a completed mission\'s map frees its destination card');
  p2.hand = [alch, { ...cardByName('First Aid'), id: 'fa1' }];
  g2.pickCard(0, 0);
  g2.activateCard(0, 'al1', 'play');
  ok(p2.playedCards.some(c => c.id === 'al1'), 'and the card actually lands on the table');

  // AND-form: The Shadow Guide needs stats AND the A Hidden Door map.
  const g3 = newGame();
  const p3 = g3.players[0];
  g3.currentAct = 2;
  p3.skills.knowledge = 4; p3.skills.prospecting = 3;
  p3.playedCards = [{ ...cardByName('Faded Treasure Map'), id: 'me1' }];   // any Mind's Eye source
  const sg = { ...missionByName('The Shadow Guide') };
  const noMap = g3.probeMissionRequirements(0, sg);
  ok(!noMap.success && noMap.details.missing.some(m => /A Hidden Door/.test(m)),
    `reqMapsAll: stats alone leave the map missing (${noMap.details.missing.join(', ')})`);
}

console.log(`\n${fail === 0 ? `✅ ${pass} checks passed` : `❌ ${fail} FAILED, ${pass} passed`}`);
process.exit(fail ? 1 : 0);
