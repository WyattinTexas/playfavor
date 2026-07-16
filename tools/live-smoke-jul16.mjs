#!/usr/bin/env node
// FAVOR — 7/16 ship live smoke: boots PRODUCTION (playfavor.net), proves
// the throw-first loop + the three new doors on the real deploy.
//   node tools/live-smoke-jul16.mjs [expectedStamp]
import puppeteer from 'puppeteer-core';

const EXPECT = process.argv[2] || null;
const URL = 'https://playfavor.net/' + (EXPECT ? `?v=${EXPECT}` : '');
let pass = 0, fail = 0;
const ok = (c, l, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${l} ${c ? '' : d}`); };

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--mute-audio'],
});
const page = await browser.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.setViewport({ width: 1280, height: 800 });
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });

const stamp = await page.evaluate(() => {
  const ui = [...document.querySelectorAll('script')].find(s => (s.src || '').includes('js/ui.js'));
  return ui ? ui.src.split('?v=')[1] : null;
});
ok(!EXPECT || stamp === EXPECT, `live stamp ${stamp}${EXPECT ? ` (expected ${EXPECT})` : ''}`);
ok(await page.evaluate(() => !!window.FMODES && !!FMP.collectThrows && !!FLB.claimRivalWin),
  'modes + throw protocol + rival claim all aboard');

const doors = await page.evaluate(() => ({
  tiles: [...document.querySelectorAll('.ts-card .ts-plaque')].map(s => s.textContent.trim()),
  plaqueName: (document.querySelector('#rivalPlaque .drp-name') || {}).textContent || '',
  clock: /^\d\d:\d\d:\d\d$/.test((document.getElementById('drpClock') || {}).textContent || ''),
}));
ok(doors.tiles.includes('Skirmish') && doors.tiles.includes('Private Game'),
  `menu tiles live (${doors.tiles.join('|')})`);
ok(doors.plaqueName.length > 8 && doors.clock,
  `the rival plaque ticks on the menu (${doors.plaqueName})`);

const rival = await page.evaluate(() => { FMODES.openDailyRival(); return {
  on: document.getElementById('rivalIntro').classList.contains('active'),
  name: (document.querySelector('.ri-name') || {}).textContent || '',
}; });
ok(rival.on && rival.name.length > 2, `Daily Rival plaque names ${rival.name}`);
await page.evaluate(() => FMODES.closeRivalIntro());

// A REAL skirmish through the REAL throw loop on production.
await page.evaluate(() => {
  window.shuffleArray = (a) => [...a];
  window._pinEmblemSeed = 0;
  localStorage.setItem('favorQueue', '3');
  FMODES.openSkirmish();
  FMODES.beginSkirmish(3);   // the door asks the size first now
});
await page.waitForFunction(() => document.getElementById('character-select').classList.contains('active')
  && document.querySelectorAll('.character-card').length > 0, { timeout: 15000 });
await page.evaluate(() => {
  const c = [...document.querySelectorAll('.character-card')][0];
  selectCharacter(c.dataset.id, c);
  document.getElementById('confirmBtn').click();
});
await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 20000 });
await new Promise(r => setTimeout(r, 1200));
await page.evaluate(() => { const x = document.querySelector('.coach-x'); if (x && x.offsetParent) x.click(); });

const hint = await page.evaluate(() => document.getElementById('throwHint').classList.contains('active'));
ok(hint, 'the finger throw-hint shows on the first hand');

await page.evaluate(() => throwCard(0));
const thrown = await page.evaluate(() => ({
  pending: !!game.pendingActivations[0],
  zone: document.getElementById('thrownZone').classList.contains('active'),
  panel: !!document.querySelector('.action-panel.active'),
  hintGone: !document.getElementById('throwHint').classList.contains('active'),
}));
ok(thrown.pending && thrown.zone && !thrown.panel && thrown.hintGone,
  'the throw lands face down — no popup, hint retired, take-back on offer');

await page.evaluate(() => undoThrow());
ok(await page.evaluate(() => !game.pendingActivations[0] && game.players[0].hand.length === 7),
  'Take it Back restores the hand');

await page.evaluate(() => {
  throwCard(2);
  for (let s = 1; s < game.playerCount; s++) {
    if (game.pendingActivations[s] === null && game.players[s].hand.length) aiPickCard(s);
  }
  maybeLockThrows();
});
await page.waitForFunction(() => window._finalChoicePending === true, { timeout: 20000 });
ok(true, 'all cards in → lock → YOUR reveal chooser opens first (emblem pinned)');
const paySlide = await page.evaluate(() =>
  [...document.querySelectorAll('#actionPanel .action-btn')].some(b => /Pay to Slide/i.test(b.textContent)));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#actionPanel .action-btn')].find(x => /discard \(\+3g\)/i.test(x.textContent));
  b.click();
});
await new Promise(r => setTimeout(r, 1000));
const after = await page.evaluate(() => ({ gold: game.players[0].gold, pending: !!game.pendingActivations[0] }));
ok(!after.pending && after.gold >= 6, `the discard resolved at the reveal (+3g → ${after.gold})`);
ok(await page.evaluate(() => game.players.slice(1).every(p => !p._personaAI)), 'skirmish table stayed persona-free');

ok(errs.length === 0, 'zero console errors on production', errs.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n❌ LIVE SMOKE: ${fail} failed, ${pass} passed` : `\n✅ LIVE SMOKE: ${pass}/${pass} on playfavor.net`);
process.exit(fail ? 1 : 0);
