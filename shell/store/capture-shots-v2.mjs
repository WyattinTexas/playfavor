#!/usr/bin/env node
/**
 * Steam screenshots v2 — the DRAMATIC set (Wyatt 8/13: "the screenshots
 * really don't show exciting parts of the game, like choosing a mission
 * reward or who won the melee").
 *
 * Adds three staged high-drama moments to the v1 screens:
 *   · the Melee coronation podium (champion crowned, prestige tokens)
 *   · a Mission triumph ceremony beat (+Favor headline chips)
 *   · the Choose-a-Mission picker (three mission cards, big art)
 *
 *   cd ~/playfavor && python3 -m http.server 8891 &
 *   node shell/store/capture-shots-v2.mjs
 *
 * Shots land in shell/store/shots/steam-v2/. Pure-UI staging only —
 * showScoring (which posts to the leaderboard) is never called.
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const URL = process.env.SHOT_URL || 'http://localhost:8891/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'steam-v2');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});

async function boot() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const baseUA = await browser.userAgent();
  await page.setUserAgent(baseUA + ' FavorShell-iOS/1.0');  // shell UA: Mint stays hidden
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('favorUid', 'uauditshots001');
    localStorage.setItem('favorName', 'Lady Plum');
    localStorage.setItem('favorAvatar', 'knight');
    localStorage.setItem('favorQueue', '5');               // full 5-seat table — fuller podium
    localStorage.setItem('favorCoachDone', '1');
  });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });
  await page.evaluate(() => { const v = document.getElementById('buildVersion'); if (v) v.remove(); });
  return page;
}

async function shot(page, name) {
  await sleep(450);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
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
    const th = document.getElementById('throwHint');   // tutorial pill — noise in marketing
    if (th) th.style.display = 'none';
  });
}

async function intoGame(page) {
  await page.evaluate(() => {
    // Full roster on the hero grid — 3 starters alone leave the frame empty.
    localStorage.setItem('favorOwned', JSON.stringify(FAVOR_DATA.characters.map(c => c.id)));
    window._mpSkipQueue = true;
    document.querySelector('#title-screen .ts-play').click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card')?.offsetParent, { timeout: 20000 });
  await sleep(600);
}

async function confirmHero(page) {
  // Card click opens the hero detail modal; its #cdConfirm starts the game.
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.character-card')];
    cards[Math.floor(cards.length / 2)].click();
  });
  await page.waitForSelector('#cdConfirm', { visible: true });
  await sleep(400);
  await page.evaluate(() => document.getElementById('cdConfirm').click());
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 25000 });
  await sleep(1800);
  await clearStage(page);
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

// ══ PAGE A: menu → hero select → table → card sheet → mission picker → ceremony ══
{
  const page = await boot();
  // The ad TV is not in the submitted Steam build — keep it out of the shot.
  await page.evaluate(() => { const tv = document.getElementById('tvBtn'); if (tv) tv.remove(); });
  await shot(page, '1-menu');

  await intoGame(page);
  await shot(page, '2-hero-select');   // the full hero grid, no modal

  await confirmHero(page);
  await dressTable(page);
  await sleep(900);
  await clearStage(page);
  await shot(page, '3-table');

  // The pick-time action sheet is gone from the game — hover-bloom a hand
  // card instead (the card rises big out of the fan).
  {
    const pt = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.hand-card')].filter(c => c.offsetParent);
      const c = cards[cards.length - 1];   // rightmost — face-up, richest art
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (pt) { await page.mouse.move(pt.x, pt.y); await sleep(700); }
    await clearStage(page);
    await shot(page, '4-card-bloom');
    await page.mouse.move(960, 200);
    await sleep(400);
  }

  // ── Choose a Mission — three cards, big art, real stakes line ──
  await page.evaluate(() => showMissionSelectUI());
  await page.waitForSelector('#missionSelect .mission-option img', { visible: true });
  await sleep(900);                      // card art paints
  await clearStage(page);
  await shot(page, '5-mission-choice');
  await page.evaluate(() => {
    const ov = document.getElementById('missionSelect');
    ov.classList.remove('active'); ov.innerHTML = '';
  });

  // ── Mission triumph ceremony — Water Temple success, +18 Favor headline ──
  await page.evaluate(() => {
    window.CINEMATIC_SPEED = 2;          // stretch the beat holds for the camera
    const m = FAVOR_DATA.missions.find(x => x.name === 'Water Temple');
    window._mcDone = false;
    showMissionCeremony([{
      playerIndex: 0,
      results: [{ mission: m, success: true, borrowed: 0,
        deltas: { gold: 6, prestige: 10, stones: 2 }, details: {} }],
    }], 3).then(() => { window._mcDone = true; window.CINEMATIC_SPEED = 1; });
  });
  await page.waitForSelector('#missionCeremony .mc-chip.big', { visible: true });
  await sleep(1700);                     // chips cascade in (0.12 + i*0.13s delays)
  await shot(page, '6-mission-triumph');
  await page.evaluate(() => document.getElementById('missionCeremony').click());
  await page.waitForFunction(() => window._mcDone === true, { timeout: 30000 }).catch(() => {});

  // ── Melee coronation — Act III podium, champion crowned, 30-Prestige spread ──
  await page.evaluate(() => {
    game.currentAct = 3;
    const powers = [31, 24, 18, 13, 9];  // You take the crown; clean tiers, no ties
    game.players.forEach((p, i) => { p.skills.power = powers[i] || 7; });
    const results = game.resolveMelee();
    window._meleeDone = false;
    playMeleeCinematic(document.getElementById('meleeSplash'), results, 3, {
      speed: 1, forgeHoldMs: 60000, autoCloseMs: 0,   // hold the podium for the camera
      powerIcon: 'assets/icons/power.png',
      portraitFor: (pi) => {
        const p = (pi != null && game.players[pi]) ? game.players[pi] : null;
        return p && p.character ? `assets/characters/${p.character.filename}` : 'assets/ui/cover.jpg';
      },
      breakdownFor: (pi) => (typeof game.powerBreakdown === 'function' ? game.powerBreakdown(pi) : null),
      cardImgFor: (filename, mission) => (filename ? `assets/cards/${mission ? 'missions' : 'regular'}/${filename}` : null),
      prestigeTokenFor: (d) => (d === 25
        ? 'assets/tokens/Tokens_Design_v1_Prestige_25_v1.jpg'
        : `assets/tokens/Copy of Tokens_Design_v1_Prestige_${d}_v1.jpg`),
    }).then(() => { window._meleeDone = true; });
  });
  await page.waitForSelector('#meleeSplash .ms-skip');
  await sleep(1600);                     // roll-call underway → state 'playing'
  await page.evaluate(() => document.querySelector('#meleeSplash .ms-skip').click());
  await page.waitForSelector('#meleeSplash .lit');
  await sleep(1500);                     // sparks settle, tokens paint
  await page.evaluate(() => { const h = document.querySelector('#meleeSplash .ms-hint'); if (h) h.remove(); });
  await shot(page, '7-melee-champion');

  await page.close();
}

// ══ PAGE B (fresh boot): leaderboard + emporium ══
{
  const page = await boot();
  // Page A seeded favorOwned for the hero grid — clear it so the Emporium
  // shows real star prices instead of ten OWNED badges.
  await page.evaluate(() => { localStorage.removeItem('favorOwned'); if (window.FLB && FLB.openStore) {} });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });
  await page.evaluate(() => { const v = document.getElementById('buildVersion'); if (v) v.remove(); });
  await page.evaluate(() => FLB.openLeaderboard('alltime'));
  await page.waitForFunction(() => document.querySelectorAll('#lbBody .lb-row').length >= 3, { timeout: 15000 });
  await shot(page, '8-leaderboard');
  await page.evaluate(() => FLB.closeLeaderboard());

  await page.evaluate(() => FLB.openStore());
  await page.waitForFunction(() => document.querySelectorAll('.st-card').length === 10, { timeout: 10000 });
  await shot(page, '9-emporium');
  await page.close();
}

// Scrub the shot identity from Firebase (belt & suspenders — no game was posted).
const pg = await browser.newPage();
await pg.goto(URL, { waitUntil: 'domcontentloaded' });
await pg.evaluate(async () => {
  try { await firebase.database().ref('favor/players/uauditshots001').remove(); } catch (e) {}
});
await browser.close();
console.log('done');
