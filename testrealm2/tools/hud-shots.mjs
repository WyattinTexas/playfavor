#!/usr/bin/env node
/**
 * FAVOR — HUD screenshot rig. Boots the game, pins a DETERMINISTIC state
 * (fixed characters, hands, purses, missions), and screenshots the table
 * view at the three reference phone viewports plus a desktop control shot.
 *
 *   python3 -m http.server 8891 --directory ~/playfavor &
 *   node tools/hud-shots.mjs [phone|desktop|all]
 *
 * Shots land in tools/audit-shots/ — EYEBALL every one before shipping.
 * The desktop shot doubles as the "desktop pixel-untouched" control:
 * capture before the mobile work, re-run after, compare.
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const URL = process.env.AUDIT_URL || 'http://localhost:8891/testrealm2/';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'audit-shots');
mkdirSync(SHOTS, { recursive: true });

const mode = process.argv[2] || 'all';
const tag = process.argv[3] || '';
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
  await page.evaluate(() => {
    // Deterministic rigs: always play the roster's FIRST hero, exactly as
    // when the select screen offered all ten — three random offerings
    // would shuffle the slot-bonus math under the slide-picker flows.
    selectedCharacter = FAVOR_DATA.characters[0].id;
    document.querySelector('.character-card').classList.add('selected');
    document.getElementById('confirmBtn').style.display = 'inline-block';
  });
  await page.waitForFunction(() => document.getElementById('confirmBtn') && document.getElementById('confirmBtn').offsetParent, { timeout: 20000 });
  await page.evaluate(() => document.getElementById('confirmBtn').click());
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 20000 });
  await sleep(1200);
  await page.evaluate(() => { const x = document.querySelector('.coach-x'); if (x && x.offsetParent) x.click(); });
}

// Pin every visual input so identical runs paint identical pixels.
async function rigState(page) {
  await page.evaluate(() => {
    const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    const bySkill = (s) => ({ ...FAVOR_DATA.cards.find(c => (c.skills || [])[0] === s && c.type !== 'mission_letter') });
    const mission = (i) => ({ ...FAVOR_DATA.missions[i] });

    game.players.forEach((p, i) => {
      p.character = FAVOR_DATA.characters[i];
      p.name = i === 0 ? 'You' : ['Ivan', 'Mara', 'Otto'][i - 1];
      p.sliderPosition = [2, 1, 3, 4][i] ?? 2;
      p.gold = [12, 8, 15, 5][i] ?? 8;
      p.prestige = [4, 0, 6, 2][i] ?? 0;
      p.scorn = [2, 1, 0, 3][i] ?? 0;
      p.favor = [7, 3, 11, 0][i] ?? 0;
      p.playedCards = [];
      p.missions = []; p.completedMissions = []; p.failedMissions = [];
    });
    const you = game.players[0];
    you.playedCards = [bySkill('survival'), bySkill('survival'), bySkill('charisma'),
                       bySkill('prospecting'), bySkill('knowledge'), bySkill('power')]
      .filter(c => c && c.name);
    you.skills = { survival: 2, charisma: 1, alchemy: 0, prospecting: 3, knowledge: 1, power: 2 };
    you.flexSkills = [['charisma', 'prospecting']];
    you.philosopherStone = 1;
    you.missions = [mission(3)];
    you.completedMissions = [mission(4)];
    you.failedMissions = [mission(5)];
    you.hand = [pick('First Aid'), pick('Trapping'), pick('Hunting'),
                FAVOR_DATA.cards.find(c => c.type === 'mission_letter')].map(c => ({ ...c }));
    game.players[1].playedCards = [bySkill('alchemy'), bySkill('power'), bySkill('charisma')].filter(Boolean);
    game.players[2].playedCards = [bySkill('knowledge')].filter(Boolean);
    game.visibleMissions = [mission(0), mission(1)];   // 2 live + 1 ghost slot
    game.emblemHolder = 2;
    game.activePlayerIndex = 0;
    game.phase = 'gameplay';
    game.currentAct = 2;
    if (typeof selectedCharacter !== 'undefined') selectedCharacter = FAVOR_DATA.characters[0].id;
    // Silence transient chrome: notifications + coach bubbles.
    const n = document.getElementById('notifications'); if (n) n.innerHTML = '';
    if (typeof skipAllCoach === 'function') skipAllCoach();
    // Freeze every animation so identical runs paint identical pixels
    // (the pulsing slot dot alone shifts bytes between shots).
    if (!document.getElementById('rigFreeze')) {
      const st = document.createElement('style');
      st.id = 'rigFreeze';
      st.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
      document.head.appendChild(st);
    }
    renderGameState();
  });
  await sleep(700);
  await page.evaluate(() => {
    const n = document.getElementById('notifications'); if (n) n.innerHTML = '';
    // The rig's state jump fires delta FX (token drops, mission reveals) —
    // wipe them so shots capture the layout, not a transient.
    const fx = document.getElementById('tvFx'); if (fx) fx.innerHTML = '';
  });
  await sleep(150);
}

const PHONES = [
  { w: 844, h: 390 },   // iPhone 12-14 landscape
  { w: 932, h: 430 },   // iPhone Pro Max landscape
  { w: 667, h: 375 },   // iPhone SE landscape
];

if (mode === 'phone' || mode === 'all') {
  for (const v of PHONES) {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`  PAGEERROR ${v.w}x${v.h}: ${e.message}`));
    await page.setViewport({ width: v.w, height: v.h, hasTouch: true, isMobile: true });
    await startGame(page);
    await rigState(page);
    const file = `hud-${v.w}x${v.h}${tag ? '-' + tag : ''}.png`;
    await page.screenshot({ path: join(SHOTS, file) });
    console.log(`  📸 ${file}`);
    await page.close();
  }
}

if (mode === 'desktop' || mode === 'all') {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log(`  PAGEERROR desktop: ${e.message}`));
  await page.setViewport({ width: 1440, height: 900 });
  await startGame(page);
  await rigState(page);
  const file = `desktop-1440x900${tag ? '-' + tag : ''}.png`;
  await page.screenshot({ path: join(SHOTS, file) });
  console.log(`  📸 ${file}`);
  await page.close();
}

await browser.close();
console.log('Done — LOOK at tools/audit-shots/');
