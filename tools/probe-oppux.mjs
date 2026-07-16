#!/usr/bin/env node
/**
 * Probe: opponent-view UX — opp inspect overlay + play spotlight,
 * desktop + phone. Screenshots → tools/audit-shots/oppux-*.png.
 * Usage: node tools/probe-oppux.mjs [tag]   (tag prefixes filenames)
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const URL = process.env.AUDIT_URL || 'http://localhost:8891/testrealm2/';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'audit-shots');
mkdirSync(SHOTS, { recursive: true });
const TAG = process.argv[2] || 'before';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--mute-audio'],
});

async function startGame(page) {
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    return b && b.offsetParent;
  }, { timeout: 20000 });
  await page.evaluate(() => {
    window.shuffleArray = (a) => [...a];
    localStorage.setItem('favorQueue', '3');
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card') && document.querySelector('.character-card').offsetParent, { timeout: 20000 });
  await page.evaluate(() => {
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

// Give opponent 1 a rich spread so the panel has something to sum.
function rigOpponent() {
  const byName = n => FAVOR_DATA.cards.find(c => c.name === n);
  const p = game.players[1];
  p.playedCards = ['Hunting', 'Concoction', 'Cooking', 'Mining Guild', 'Blind Faith']
    .map(n => ({ ...byName(n) })).filter(c => c.name);
  p.gold = 14; p.prestige = 6; p.scorn = 3; p.favor = 22;
  p.skills = { survival: 4, charisma: 2, alchemy: 3, prospecting: 1, knowledge: 2, power: 5 };
  p.flexSkills = [['charisma', 'prospecting']];
  p.philosopherStone = 2;
  game.emblemHolder = 1;
  renderGameState();
}

// ── Desktop: opp overlay + spotlight ──
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('  [desk console.error]', m.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  await startGame(page);
  await page.evaluate(rigOpponent);
  await page.evaluate(() => openOppOverlay(1));
  await sleep(700);
  await page.screenshot({ path: join(SHOTS, `oppux-${TAG}-desk-overlay.png`) });
  await page.evaluate(() => closeOppOverlay());
  await sleep(300);

  // Spotlight: play with skills+special, then a mission letter, then discard
  await page.evaluate(() => { showCardSpotlight(1, { ...FAVOR_DATA.cards.find(c => c.name === 'Hunting') }, 'play'); });
  await sleep(900);
  await page.screenshot({ path: join(SHOTS, `oppux-${TAG}-desk-spot-play.png`) });
  await page.evaluate(() => document.getElementById('cardSpotlight').click());
  await sleep(500);

  await page.evaluate(() => { showCardSpotlight(2, { ...FAVOR_DATA.cards.find(c => c.type === 'mission_letter') }, 'play'); });
  await sleep(900);
  await page.screenshot({ path: join(SHOTS, `oppux-${TAG}-desk-spot-letter.png`) });
  await page.evaluate(() => document.getElementById('cardSpotlight').click());
  await sleep(500);

  await page.evaluate(() => { showCardSpotlight(1, { ...FAVOR_DATA.cards.find(c => c.name === 'Concoction') }, 'discard'); });
  await sleep(900);
  await page.screenshot({ path: join(SHOTS, `oppux-${TAG}-desk-spot-discard.png`) });
  await page.evaluate(() => document.getElementById('cardSpotlight').click());
  await page.close();
}

// ── Phone 844×390: opp overlay + spotlight ──
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('  [phone console.error]', m.text()); });
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(page);
  await page.evaluate(rigOpponent);
  await page.evaluate(() => openOppOverlay(1));
  await sleep(700);
  await page.screenshot({ path: join(SHOTS, `oppux-${TAG}-phone-overlay.png`) });
  await page.evaluate(() => closeOppOverlay());
  await sleep(300);

  await page.evaluate(() => { showCardSpotlight(1, { ...FAVOR_DATA.cards.find(c => c.name === 'Hunting') }, 'play'); });
  await sleep(900);
  await page.screenshot({ path: join(SHOTS, `oppux-${TAG}-phone-spot-play.png`) });
  await page.evaluate(() => document.getElementById('cardSpotlight').click());
  await page.close();
}

await browser.close();
console.log(`probe done → tools/audit-shots/oppux-${TAG}-*.png`);
