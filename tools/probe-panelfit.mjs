// One-shot probe: does the 4-token stats panel fit with NO inner scroll at
// the two desktop viewports the ui-audit "juicy desktop" flow checks?
// Mirrors that flow's rig exactly (fullest panel: flex row + phil stone).
import puppeteer from 'puppeteer-core';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const URL = process.env.AUDIT_URL || 'http://localhost:8891/';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--mute-audio', '--no-first-run'],
});

for (const [w, h] of [[1440, 900], [1280, 800]]) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('favor_coach_seen', JSON.stringify(
      ['welcome', 'missions', 'hand', 'skills', 'pass', 'rivals',
       'scorn', 'favor', 'ring', 'melee', 'emblem']));
    window._pinEmblemSeed = 0;
  });
  await page.setViewport({ width: w, height: h });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    window.shuffleArray = (a) => [...a];
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
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(() => {
    const p = game.players[0];
    p.gold = 12; p.favor = 4; p.scorn = 2; p.prestige = 4;
    p.skills = { survival: 2, charisma: 1, alchemy: 0, prospecting: 3, knowledge: 1, power: 2 };
    p.flexSkills = [['charisma', 'prospecting']];
    p.philosopherStone = 1;
    renderGameState();
  });
  await new Promise(r => setTimeout(r, 700));
  const d = await page.evaluate(() => {
    const panel = document.getElementById('statsPanel');
    const strip = document.getElementById('missionStrip');
    return {
      noScroll: panel.scrollHeight <= panel.clientHeight + 1,
      scrollH: panel.scrollHeight, clientH: panel.clientHeight,
      slack: panel.clientHeight - panel.scrollHeight,
      tokens: document.querySelectorAll('#statsPanel .resource-token').length,
      tokenVal: parseFloat(getComputedStyle(document.querySelector('.token-val')).fontSize),
      stripBelow: strip.getBoundingClientRect().top >= panel.getBoundingClientRect().bottom,
      stripOn: strip.getBoundingClientRect().bottom <= innerHeight + 1,
      panelBottom: Math.round(panel.getBoundingClientRect().bottom),
      stripTop: Math.round(strip.getBoundingClientRect().top),
      overlapPx: Math.round(panel.getBoundingClientRect().bottom - strip.getBoundingClientRect().top),
      tokensBlockH: Math.round(document.querySelector('.resource-tokens').getBoundingClientRect().height),
      emblemTag: !!document.querySelector('#statsPanel .emblem-tag'),
    };
  });
  console.log(`${w}x${h}:`, JSON.stringify(d));
  await page.close();
}
await browser.close();
