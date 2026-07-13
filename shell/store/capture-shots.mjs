#!/usr/bin/env node
/**
 * Store screenshots for FAVOR — iPhone 6.9" (2868×1320), iPad 13" (2752×2064),
 * Steam desktop (1920×1080). Drives the PRODUCTION build served at
 * localhost:8891/ with the shell UA (Mint hidden — store-safe on every rail).
 *
 *   cd ~/playfavor && python3 -m http.server 8891 &
 *   node shell/store/capture-shots.mjs
 *
 * Shots land in shell/store/shots/{iphone69,ipad13,steam}/.
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const URL = process.env.SHOT_URL || 'http://localhost:8891/';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'shots');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const FORMS = [
  { key: 'iphone69', width: 956,  height: 440,  dpr: 3, mobile: true },   // 2868×1320
  { key: 'ipad13',   width: 1376, height: 1032, dpr: 2, mobile: true },   // 2752×2064
  { key: 'steam',    width: 1920, height: 1080, dpr: 1, mobile: false },  // 1920×1080
];

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});

async function boot(form) {
  const page = await browser.newPage();
  await page.setViewport({
    width: form.width, height: form.height, deviceScaleFactor: form.dpr,
    isMobile: form.mobile, hasTouch: form.mobile,
  });
  const baseUA = await browser.userAgent();
  await page.setUserAgent(
    (form.mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
      : baseUA) + ' FavorShell-iOS/1.0');  // shell UA on every form: Mint stays hidden
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('favorUid', 'uauditshots001');
    localStorage.setItem('favorName', 'Lady Plum');
    localStorage.setItem('favorAvatar', 'knight');
    localStorage.setItem('favorQueue', '3');
    localStorage.setItem('favorCoachDone', '1');
  });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });
  // The version stamp is honest in-game but noise in marketing shots.
  await page.evaluate(() => { const v = document.getElementById('buildVersion'); if (v) v.remove(); });
  return page;
}

async function shot(page, form, name) {
  await sleep(450);
  await page.screenshot({ path: join(ROOT, form.key, `${name}.png`) });
  console.log(`  ✓ ${form.key}/${name}`);
}

// Marketing shots need a CLEAR stage: no coach tips, no lingering act
// toasts, no mid-flight "+N" floats.
async function clearStage(page) {
  for (let i = 0; i < 6; i++) {
    const more = await page.evaluate(() => {
      const skip = [...document.querySelectorAll('a,button,span,div')]
        .find(el => el.children.length === 0 && /skip tips/i.test(el.textContent));
      if (skip) { skip.click(); return true; }
      const x = document.querySelector('.coach-x');
      if (x && x.offsetParent) { x.click(); return true; }
      return false;
    });
    if (!more) break;
    await sleep(250);
  }
  await page.evaluate(() => {
    const n = document.getElementById('notifications');
    if (n) n.innerHTML = '';
    document.querySelectorAll('.stat-float, .game-toast').forEach(el => el.remove());
  });
}

// Start a solo game deterministically enough to look great.
async function intoGame(page) {
  await page.evaluate(() => {
    window._mpSkipQueue = true;
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card')?.offsetParent, { timeout: 20000 });
  await sleep(600);
}

async function confirmHero(page) {
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.character-card')];
    cards[Math.floor(cards.length / 2)].click();
  });
  await sleep(700);
  await page.evaluate(() => document.getElementById('confirmBtn').click());
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 25000 });
  await sleep(1800);
  await page.evaluate(() => { const x = document.querySelector('.coach-x'); if (x && x.offsetParent) x.click(); });
  await sleep(300);
}

// Dress the table: rich played stacks, juicy purse, full hand.
async function dressTable(page) {
  await page.evaluate(() => {
    const take = (names) => names.map(n => ({ ...FAVOR_DATA.cards.find(c => c.name === n) }))
      .filter(c => c.name);
    const p0 = game.players[0];
    p0.gold = 14; p0.prestige = 12; p0.favor = 18; p0.scorn = 1;
    p0.playedCards = take(['Hunting', 'First Aid', 'Forbidden Lab', 'Warm Mentorship', 'Prospecting Journal']);
    game.players[1].playedCards = take(['Trapping', 'Cooking', 'Endless Sparring']);
    game.players[2].playedCards = take(['Tombstone', 'Blackbird']);
    game.players[1].gold = 9; game.players[2].gold = 11;
    game.applySlotSkills(p0);
    renderGameState();
  });
  await sleep(600);
}

for (const form of FORMS) {
  mkdirSync(join(ROOT, form.key), { recursive: true });
  console.log(`── ${form.key} (${form.width}×${form.height} @${form.dpr}x)`);
  const page = await boot(form);

  // 1 · Royal menu
  await shot(page, form, '1-menu');

  // 2 · Hero select (ring on the center hero)
  await intoGame(page);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.character-card')];
    cards[Math.floor(cards.length / 2)].click();
  });
  await shot(page, form, '2-hero-select');

  // 3 · The table mid-game
  await page.evaluate(() => document.getElementById('confirmBtn').click());
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 25000 });
  await sleep(1800);
  await clearStage(page);
  await dressTable(page);
  await sleep(900);              // let the delta animations land...
  await clearStage(page);        // ...then sweep the stage clean
  await shot(page, form, '3-table');

  // 4 · A card considered (action sheet with the art big)
  await page.evaluate(() => selectHandCard(Math.min(2, game.players[0].hand.length - 1)));
  await clearStage(page);
  await shot(page, form, '4-card-sheet');
  await page.evaluate(() => hideActionPanel());

  // 5 · Your character board, ring on the track
  await page.evaluate(() => openBoardOverlay());
  await clearStage(page);
  await shot(page, form, '5-board');
  await page.evaluate(() => closeBoardOverlay());

  // 6 · Leaderboard (medals + crests, real realm data)
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });
  await page.evaluate(() => { const v = document.getElementById('buildVersion'); if (v) v.remove(); });
  await page.evaluate(() => FLB.openLeaderboard('alltime'));
  await page.waitForFunction(() => document.querySelectorAll('#lbBody .lb-row').length >= 3, { timeout: 15000 });
  await shot(page, form, '6-leaderboard');
  await page.evaluate(() => FLB.closeLeaderboard());

  // 7 · The Royal Emporium (hero shelf; Mint hidden by the shell UA)
  await page.evaluate(() => FLB.openStore());
  await page.waitForFunction(() => document.querySelectorAll('.st-card').length === 10, { timeout: 10000 });
  await shot(page, form, '7-emporium');

  await page.close();
}

// Scrub the shot identity from Firebase (it never posted a game, but the
// name write on rename/lastSeen paths could exist — belt & suspenders).
const pg = await browser.newPage();
await pg.goto(URL, { waitUntil: 'domcontentloaded' });
await pg.evaluate(async () => {
  try { await firebase.database().ref('favor/players/uauditshots001').remove(); } catch (e) {}
});
await browser.close();
console.log('done');
