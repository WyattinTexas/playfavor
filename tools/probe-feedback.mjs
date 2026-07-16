import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});
const page = await browser.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://localhost:8891/', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
await page.evaluate(() => { window.shuffleArray = (a) => [...a]; window._pinEmblemSeed = 0; });
await new Promise(r => setTimeout(r, 1800));

console.log('plaque:', await page.evaluate(() => ({
  name: (document.querySelector('#rivalPlaque .drp-name') || {}).textContent,
  stars: (document.querySelector('#rivalPlaque .drp-stars') || {}).textContent,
  clock: (document.getElementById('drpClock') || {}).textContent,
  badge: !!document.querySelector('#rivalPlaque .drp-badge'),
  h: Math.round(document.getElementById('rivalPlaque').getBoundingClientRect().height),
})));
await page.screenshot({ path: 'tools/audit-shots/probe-menu.png' });

await page.evaluate(() => FMODES.openSkirmish());
await new Promise(r => setTimeout(r, 250));
console.log('skirmish sizes:', await page.evaluate(() =>
  [...document.querySelectorAll('#skirmishPick .sk-size b')].map(b => b.textContent).join('/')));
await page.screenshot({ path: 'tools/audit-shots/probe-skirmish-pick.png' });
await page.evaluate(() => FMODES.beginSkirmish(5));
await page.waitForFunction(() => document.getElementById('character-select').classList.contains('active'), { timeout: 15000 });
await page.evaluate(() => {
  const c = document.querySelector('.character-card');
  selectCharacter(c.dataset.id, c);
  document.getElementById('confirmBtn').click();
});
await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 20000 });
console.log('skirmish table:', await page.evaluate(() => ({
  n: game.playerCount, names: game.players.slice(1).map(p => p.name) })));

// Rival day sweep: pool coverage + names.
console.log('rival pool sweep:', await page.evaluate(() => {
  const seen = {};
  for (let i = 0; i < 40; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const r = FMODES.rivalOfDay(d);
    seen[r.key] = r.name;
  }
  return seen;
}));
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
