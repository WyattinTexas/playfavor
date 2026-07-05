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
  src('data/characters.js') + '\n' + src('engine/gameState.js') + '\nreturn FavorGame;'
)(window);

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

console.log('── A Promise (AI): trades junk cards for 10 Prestige each');
{
  const g = newGame();
  playCard(g, 1, 'Trapping'); // junk: 1 survival, 0 favor
  const m = { ...missionByName('A Promise') };
  const prestige = g.players[1].prestige;
  g.applyMissionFailure(1, m);
  ok(g.players[1].prestige === prestige + 10, `AI sacrificed 1 junk card (+10 prestige)`);
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

console.log(`\n${fail === 0 ? `✅ ${pass} checks passed` : `❌ ${fail} FAILED, ${pass} passed`}`);
process.exit(fail ? 1 : 0);
