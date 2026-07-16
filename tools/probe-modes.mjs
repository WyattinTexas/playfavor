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
await page.evaluate(() => { window.shuffleArray = (a) => [...a]; window._pinEmblemSeed = 0; localStorage.setItem('favorQueue', '3'); });

// 1 · menu trio present
const trio = await page.evaluate(() => [...document.querySelectorAll('.menu-trio .btn-royal span')].map(s => s.textContent));
console.log('trio:', trio.join(' | '));

// 2 · rival intro opens + names today's rival
await page.evaluate(() => FMODES.openDailyRival());
await new Promise(r => setTimeout(r, 400));
console.log('rival intro:', await page.evaluate(() => ({
  active: document.getElementById('rivalIntro').classList.contains('active'),
  name: (document.querySelector('.ri-name') || {}).textContent,
})));
await page.evaluate(() => FMODES.closeRivalIntro());

// 3 · room door renders (no live host — just the door)
await page.evaluate(() => FMODES.openPrivateRoom());
console.log('room door:', await page.evaluate(() => ({
  active: document.getElementById('roomOverlay').classList.contains('active'),
  host: !!document.querySelector('.rm-host'),
  input: !!document.getElementById('rmCode'),
})));
await page.evaluate(() => FMODES.closePrivateRoom());

// 4 · Skirmish → all owned select → begin → thematic table
await page.evaluate(() => FMODES.openSkirmish());
await page.waitForFunction(() => document.getElementById('character-select').classList.contains('active') && document.querySelectorAll('.character-card').length > 0, { timeout: 15000 });
console.log('skirmish select cards:', await page.evaluate(() => document.querySelectorAll('.character-card').length));
await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.character-card')];
  const last = cards[cards.length - 1];
  selectCharacter(last.dataset.id, last);
  document.getElementById('confirmBtn').click();
});
await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players.length && game.players[0].character, { timeout: 20000 });
console.log('skirmish table:', await page.evaluate(() => ({
  n: game.playerCount,
  personas: game.players.filter(p => p._personaAI).length,
  names: game.players.slice(1).map(p => p.name),
  myHero: game.players[0].character.id,
  mode: window._gameMode,
})));
console.log('console errors:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
