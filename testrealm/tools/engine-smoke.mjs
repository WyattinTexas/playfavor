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
  playCard(g, 0, 'Trapping'); // survival card in play
  const m = { ...missionByName('Wanted: Crazy Lou') }; // fail: discard 5 played
  const played = g.players[0].playedCards.length;
  g.applyMissionFailure(0, m);
  ok(g.players[0].playedCards.length === Math.max(0, played - 5), `discard_5_played (${played} → ${g.players[0].playedCards.length})`);

  const g3 = newGame();
  const mb = { ...missionByName("Man's Best Friend") }; // fail: +4 gold, others +5 gold
  const y = g3.players[0].gold, a = g3.players[1].gold;
  g3.applyMissionFailure(0, mb);
  ok(g3.players[0].gold === y + 4, 'failure pays you 4 Gold');
  ok(g3.players[1].gold === a + 5, 'others gain 5 Gold');
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

console.log(`\n${fail === 0 ? `✅ ${pass} checks passed` : `❌ ${fail} FAILED, ${pass} passed`}`);
process.exit(fail ? 1 : 0);
