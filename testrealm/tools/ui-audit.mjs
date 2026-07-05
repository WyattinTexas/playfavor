#!/usr/bin/env node
/**
 * FAVOR — pre-handoff UI audit. Plays the build like a user (real clicks,
 * real touches) and fails loudly on visual miscues the engine suites can't
 * see. Run before EVERY handoff to Wyatt:
 *
 *   python3 -m http.server 8891 --directory .. &   (repo root)
 *   node tools/ui-audit.mjs
 *
 * Needs puppeteer-core (globally installed) + system Chrome.
 * Screenshots land in tools/audit-shots/ — LOOK at them before shipping.
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const URL = process.env.AUDIT_URL || 'http://localhost:8891/testrealm/';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'audit-shots');
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});

async function startGame(page) {
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    return b && b.offsetParent;
  }, { timeout: 20000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card') && document.querySelector('.character-card').offsetParent, { timeout: 20000 });
  await page.evaluate(() => document.querySelector('.character-card').click());
  await page.waitForFunction(() => document.getElementById('confirmBtn') && document.getElementById('confirmBtn').offsetParent, { timeout: 20000 });
  await page.evaluate(() => document.getElementById('confirmBtn').click());
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 20000 });
  await sleep(1200);
  await page.evaluate(() => { const x = document.querySelector('.coach-x'); if (x && x.offsetParent) x.click(); });
}

const consoleErrors = [];

// ═══ PHONE: touch glide must bloom exactly ONE card ═══
console.log('── Phone: glide blooms exactly one card (no sticky-hover double)');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('phone: ' + m.text()); });
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(page);
  await page.evaluate(() => { tvHandOpen = true; applyDrawerStates(); });
  await sleep(500);

  const centers = await page.evaluate(() => {
    const zone = document.getElementById('tvHand');
    const zl = zone.getBoundingClientRect().left;
    return [...zone.querySelectorAll('.hand-card')].map(c => zl + c.offsetLeft + c.offsetWidth / 2);
  });
  ok(centers.length >= 3, `hand rendered (${centers.length} cards)`);

  const y = 375;
  await page.touchscreen.touchStart(centers[0], y);
  await sleep(200);
  await page.touchscreen.touchMove(centers[1], y);
  await sleep(120);
  await page.touchscreen.touchMove(centers[2], y);
  await sleep(250);

  const mid = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.tv-hand .hand-card')];
    const rests = cards.filter(c => !c.classList.contains('bloom')).map(c => c.getBoundingClientRect().height);
    const restH = Math.min(...rests);
    const bloomed = cards.filter(c => c.getBoundingClientRect().height > restH * 1.6);
    return { bloomedCount: bloomed.length, bloomClassCount: cards.filter(c => c.classList.contains('bloom')).length };
  });
  await page.screenshot({ path: join(SHOTS, 'phone-glide.png') });
  ok(mid.bloomedCount === 1, `mid-glide: exactly one enlarged card (got ${mid.bloomedCount})`);
  ok(mid.bloomClassCount === 1, 'exactly one .bloom class');

  await page.touchscreen.touchEnd();
  await sleep(400);
  const after = await page.evaluate(() => ({
    bloomsLeft: document.querySelectorAll('.tv-hand .hand-card.bloom').length,
    enlarged: [...document.querySelectorAll('.tv-hand .hand-card')].filter(c => c.getBoundingClientRect().height > 260).length,
  }));
  ok(after.bloomsLeft === 0 && after.enlarged === 0, `release: all cards back to rest (bloom=${after.bloomsLeft}, big=${after.enlarged})`);
  await page.evaluate(() => { const ap = document.querySelector('.action-panel'); if (ap) ap.classList.remove('active'); if (typeof deselectHandCard === 'function') try { deselectHandCard(); } catch (e) {} });
  await page.close();
}

// ═══ DESKTOP: final card keeps its choices ═══
console.log('── Desktop: last two cards — player chooses BOTH fates');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('desktop: ' + m.text()); });
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  // Trim to exactly two known cards through the engine.
  await page.evaluate(() => {
    const p = game.players[0];
    p.gold = 30;
    const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    p.hand = [pick('First Aid'), pick('Trapping')];
    p.skills.power = 1; // Trapping/First Aid reqs safety
    renderGameState();
  });
  await sleep(400);

  // Pick card 0 through the REAL panel.
  await page.evaluate(() => selectHandCard(0));
  await sleep(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.action-panel .action-btn')].find(x => /play/i.test(x.textContent) && !x.disabled);
    b.click();
  });

  // The FINAL card must present a choice panel, not auto-resolve.
  let choiceShown = false;
  try {
    await page.waitForFunction(() =>
      document.querySelector('.action-panel.active') &&
      /final card/i.test(document.querySelector('.action-panel').textContent), { timeout: 9000 });
    choiceShown = true;
  } catch (e) {}
  await page.screenshot({ path: join(SHOTS, 'final-card-choice.png') });
  ok(choiceShown, 'final card shows its own action panel');

  if (choiceShown) {
    const acted = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.action-panel [data-act]')].find(x => x.dataset.act === 'play' || x.dataset.act === 'discard');
      if (!b) return null;
      const act = b.dataset.act;
      b.click();
      return act;
    });
    await sleep(2500);
    const state = await page.evaluate(() => ({
      played: game.players[0].playedCards.length,
      pendingCleared: !game.pendingActivations[0],
    }));
    ok(acted && state.pendingCleared, `choice applied (${acted}), round continued`);
  }
  await page.close();
}

// ═══ DESKTOP: mission turn-in by choice ═══
console.log('── Desktop: held mission offers Turn In Now, resolves by choice');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('mission: ' + m.text()); });
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  await page.evaluate(() => {
    const p = game.players[0];
    p.missions = [{ ...FAVOR_DATA.missions.find(m => m.name === 'Wanted: Crazy Lou') }];
    game.phase = 'gameplay';
    renderGameState();
    openMissionLB('assets/cards/missions/' + p.missions[0].filename, 'Wanted: Crazy Lou');
  });
  await sleep(400);

  const unmet = await page.evaluate(() => {
    const b = document.getElementById('missionTurnIn');
    return { exists: !!b, text: b ? b.textContent : '', due: !!document.querySelector('.mission-lb-due') };
  });
  ok(unmet.exists, 'Turn In button present for held mission');
  ok(/fail/i.test(unmet.text), 'unmet mission warns it would FAIL');
  ok(unmet.due, 'due-act note shown for multi-act window');
  await page.screenshot({ path: join(SHOTS, 'mission-turnin.png') });

  await page.evaluate(() => {
    closeMissionLB();
    game.players[0].skills.power = 15;
    openMissionLB('assets/cards/missions/' + game.players[0].missions[0].filename, 'Wanted: Crazy Lou');
  });
  await sleep(300);
  const met = await page.evaluate(() => document.getElementById('missionTurnIn').textContent);
  ok(/requirements met/i.test(met), 'met mission offers success turn-in');
  await page.evaluate(() => document.getElementById('missionTurnIn').click());
  await sleep(600);
  const done = await page.evaluate(() => ({
    completed: game.players[0].completedMissions.length,
    held: game.players[0].missions.length,
  }));
  ok(done.completed === 1 && done.held === 0, 'turn-in completed the mission immediately');
  await page.close();
}

// ═══ DESKTOP: Chemical Y picker — choose ONE adventure to double ═══
console.log('── Desktop: Chemical Y presents the choose-one picker');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('chemY: ' + m.text()); });
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  // Rig: two adventures down, requirements met, Chemical Y as the pick.
  await page.evaluate(() => {
    const p = game.players[0];
    const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    p.playedCards.push(pick('Fur Trading'), pick('Forming a Bond'));
    p.skills.alchemy = 6;
    p.philosopherStone = 1;
    p.gold = 30;
    p.hand = [pick('Chemical Y'), pick('First Aid')];
    renderGameState();
    selectHandCard(0);
  });
  await sleep(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.action-panel .action-btn')].find(x => /play/i.test(x.textContent) && !x.disabled);
    b.click();
  });

  let pickerShown = false;
  try {
    await page.waitForFunction(() =>
      document.getElementById('promisePicker').classList.contains('active') &&
      /Chemical Y/i.test(document.getElementById('promisePicker').textContent), { timeout: 9000 });
    pickerShown = true;
  } catch (e) {}
  await page.screenshot({ path: join(SHOTS, 'chemy-picker.png') });
  ok(pickerShown, 'Chemical Y picker appears on play');

  if (pickerShown) {
    const result = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#promisePicker .pp-card')];
      cards[cards.length - 1].click(); // choose the second adventure
      document.getElementById('chemYConfirm').click();
      return null;
    });
    await sleep(500);
    const state = await page.evaluate(() => ({
      doubled: game.players[0].playedCards.filter(c => c._favorDoubled).map(c => c.name),
      badge: document.querySelectorAll('.stack-card.doubled').length,
    }));
    ok(state.doubled.length === 1, `exactly one card doubled (${state.doubled.join(',')})`);
    ok(state.badge === 1, 'doubled card wears its gold ring in the stacks');
  }
  await page.close();
}

ok(consoleErrors.length === 0, 'zero console errors across all flows', consoleErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${fail === 0 ? `✅ UI AUDIT: ${pass} checks passed — now LOOK at tools/audit-shots/` : `❌ UI AUDIT: ${fail} FAILED, ${pass} passed`}`);
process.exit(fail ? 1 : 0);
