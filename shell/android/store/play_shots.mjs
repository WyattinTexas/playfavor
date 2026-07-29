#!/usr/bin/env node
/**
 * Google Play screenshots for FAVOR — the Android twin of
 * shell/store/capture-shots.mjs (same seven scenes, same dressing), shot in
 * Play's three 16:9 profiles with the FavorShell-Android UA so the PayPal
 * Mint is hidden in every frame (store-safe on every rail — and a standing
 * proof the widened meta.js gate works).
 *
 *   cd ~/playfavor && python3 -m http.server 8891 &
 *   node shell/android/store/play_shots.mjs
 *
 * Shots land OUTSIDE the repo: ~/Desktop/favor-googleplay-1.0/store-shots/
 * {phone,tablet7,tablet10}/. Play caps a set at 8; this takes 7.
 * Also renders the feature graphic master: feature-raw-2048x1000.png
 * (halve to shell/android/store/feature1024x500.png with sips).
 */
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import puppeteer from 'puppeteer-core';

const URL = process.env.SHOT_URL || 'http://localhost:8891/';
const ROOT = join(homedir(), 'Desktop', 'favor-googleplay-1.0', 'store-shots');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Three DISTINCT logical widths (real layout differences, not rescales) —
// the GVT profile set, proven on its Play listing prep.
const FORMS = [
  { key: 'phone',    width: 960,  height: 540, dpr: 2, mobile: true },   // 1920×1080
  { key: 'tablet7',  width: 1024, height: 576, dpr: 2, mobile: true },   // 2048×1152
  { key: 'tablet10', width: 1280, height: 720, dpr: 2, mobile: false },  // 2560×1440
];

const DROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 FavorShell-Android/1.0';

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
  await page.setUserAgent(DROID_UA);
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('favorUid', 'uauditshots001');
    localStorage.setItem('favorName', 'Lady Plum');
    localStorage.setItem('favorAvatar', 'knight');
    localStorage.setItem('favorQueue', '3');
    // The coach ladder's CURRENT key (the audit's list) + the legacy flag.
    localStorage.setItem('favor_coach_seen', JSON.stringify(
      ['welcome', 'missions', 'hand', 'skills', 'pass', 'rivals',
       'scorn', 'favor', 'ring', 'melee', 'emblem']));
    localStorage.setItem('favorCoachDone', '1');
    localStorage.setItem('favorTelemetryOff', '1');
    window._noSoloSave = true;
  });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });
  // The version stamp is honest in-game but noise in marketing shots.
  await page.evaluate(() => { const v = document.getElementById('buildVersion'); if (v) v.remove(); });
  // The shell gate, asserted before a single frame is taken.
  const gated = await page.evaluate(() => document.body.classList.contains('ios-shell'));
  if (!gated) throw new Error('FavorShell-Android UA did not gate the Mint — DO NOT SHIP THESE SHOTS');
  return page;
}

async function shot(page, form, name) {
  await sleep(450);
  await page.screenshot({ path: join(ROOT, form.key, `${name}.png`) });
  console.log(`  ✓ ${form.key}/${name}`);
}

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

async function intoGame(page) {
  await page.evaluate(() => {
    window._mpSkipQueue = true;
    // The redesigned menu puts PLAY on a .ts-card (the ui-audit's own
    // startGame selector) — the old .btn-royal-only finder went stale.
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card')?.offsetParent, { timeout: 20000 });
  await sleep(600);
}

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

  // 2 · The hero confirm card (two-column: painted art + tips — the
  // redesigned select flow's own showcase moment)
  await intoGame(page);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.character-card')];
    cards[Math.floor(cards.length / 2)].click();
  });
  await page.waitForFunction(() => {
    const b = document.getElementById('cdConfirm');
    return b && b.offsetParent;
  }, { timeout: 15000 });
  await sleep(700);
  await shot(page, form, '2-hero-select');

  // 3 · The table mid-game
  await page.evaluate(() => document.getElementById('cdConfirm').click());
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 25000 });
  await sleep(1800);
  await clearStage(page);
  await dressTable(page);
  await sleep(900);
  await clearStage(page);
  await shot(page, form, '3-table');

  // 5 · Your character board, ring on the track (shot before the throw so
  // the table underneath is still clean)
  await page.evaluate(() => openBoardOverlay());
  await clearStage(page);
  await shot(page, form, '5-board');
  await page.evaluate(() => closeBoardOverlay());

  // 4 · A card considered — the reveal chooser (7/16 throw-first rework:
  // the pick-time sheet is gone; throw, lock the round, the chooser opens
  // with the art big — the ui-audit's own throwAndAwaitChoice path)
  await page.evaluate(() => throwCard(Math.min(2, game.players[0].hand.length - 1)));
  await page.evaluate(() => {
    for (let s = 1; s < game.playerCount; s++) {
      if (game.pendingActivations[s] === null && game.players[s].hand.length) {
        aiPickCard(s);
      }
    }
    renderGameState();
    maybeLockThrows();
  });
  await page.waitForFunction(() => window._finalChoicePending === true, { timeout: 20000 });
  await clearStage(page);
  await shot(page, form, '4-card-sheet');

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

// Feature graphic master: the title screen's own art at 2048×1000 (halve to
// 1024×500 with sips) — the GVT method, the store keeps the brand.
{
  const form = { key: 'feature', width: 1024, height: 500, dpr: 2, mobile: false };
  const page = await boot(form);
  await clearStage(page);
  // The GVT law: the title screen's OWN art, chrome hidden — wordmark +
  // vista only, no buttons in the banner.
  await page.evaluate(() => {
    ['.ts-grid', '#profileChip', '#settingsBtn', '#notifications']
      .forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));
  });
  await sleep(600);
  await page.screenshot({ path: join(ROOT, '..', 'feature-raw-2048x1000.png') });
  console.log('  ✓ feature-raw-2048x1000.png');
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
