#!/usr/bin/env node
/**
 * PROBE — final-round order: when everyone holds their last TWO cards,
 * does each player play both back-to-back (correct rule) or does the
 * table alternate single cards? Traces game.activateCard call order.
 *
 *   python3 -m http.server 8891 --directory .. &
 *   node tools/probe-lasttwo.mjs
 */
import puppeteer from 'puppeteer-core';

const URL = process.env.AUDIT_URL || 'http://localhost:8891/testrealm2/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

// ── startGame (ui-audit pins: identity shuffle, 3p queue, emblem seat 0) ──
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('#title-screen .btn-royal')]
    .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
  return b && b.offsetParent;
}, { timeout: 20000 });
await page.evaluate(() => {
  window.shuffleArray = (a) => [...a];
  localStorage.setItem('favorQueue', '3');
  window._pinEmblemSeed = 0;
});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#title-screen .btn-royal')]
    .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
  b.click();
});
await page.waitForFunction(() => document.querySelector('.character-card') && document.querySelector('.character-card').offsetParent, { timeout: 20000 });
await page.evaluate(() => {
  selectedCharacter = FAVOR_DATA.characters[0].id;
  document.querySelector('.character-card').classList.add('selected');
  document.getElementById('confirmBtn').style.display = 'inline-block';
});
await page.evaluate(() => document.getElementById('confirmBtn').click());
await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 20000 });
await sleep(1200);
await page.evaluate(() => { const x = document.querySelector('.coach-x'); if (x && x.offsetParent) x.click(); });

// ── Rig the FINAL round: everyone holds exactly 2 inert cards ──
await page.evaluate(() => {
  window.CINEMATIC_SPEED = 0.05;
  const fa = FAVOR_DATA.cards.find(c => c.name === 'First Aid');
  game.players.forEach((p, i) => {
    p.hand = [
      { ...fa, id: `rig_a_${i}` },
      { ...fa, id: `rig_b_${i}` },
    ];
  });
  game.pendingActivations = new Array(game.playerCount).fill(null);
  game.phase = 'gameplay';

  // Trace every activation (pi + which rig card) in true order.
  window._trace = [];
  const realActivate = game.activateCard.bind(game);
  game.activateCard = (pi, cardId, mode, extra) => {
    window._trace.push(`P${pi}:${cardId}:${mode}`);
    return realActivate(pi, cardId, mode, extra);
  };
  renderGameState();
});

// ── Human plays hand card 0 (the real Play-button entry point) ──
await page.evaluate(() => { playSelectedCard(0); });

// The leftover card presents the final-card chooser — choose Play.
await page.waitForFunction(() => window._finalChoicePending === true, { timeout: 20000 });
await page.evaluate(() => {
  const b = document.querySelector('#actionPanel [data-act="play"]');
  if (b) b.click(); else document.querySelector('#actionPanel [data-act="discard"]').click();
});

// All six activations (3 players × 2 cards) should land.
await page.waitForFunction(() => window._trace && window._trace.length >= 6, { timeout: 30000 });
const trace = await page.evaluate(() => window._trace);

console.log('ACTIVATION ORDER:');
trace.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));

const seats = trace.map(t => t.split(':')[0]);
const contiguous = seats.join(',').match(/^(P\d,)?(P0,P0|P0,P0,P1,P1,P2,P2)/) ||
  (seats[0] === seats[1] && seats[2] === seats[3] && seats[4] === seats[5]);
console.log(contiguous
  ? '\nVERDICT: pairs are CONTIGUOUS — each player plays both cards back-to-back.'
  : '\nVERDICT: ALTERNATION — players do NOT play their last two back-to-back.');

await browser.close();
process.exit(0);
