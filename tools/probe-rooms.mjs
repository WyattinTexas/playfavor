import puppeteer from 'puppeteer-core';
const URL = 'http://localhost:8891/';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});
const mk = async (uid, name) => {
  const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log(`[${name}] PAGEERROR:`, e.message));
  pg.on('console', m => { if (m.type() === 'error') console.log(`[${name}] err:`, m.text().slice(0, 140)); });
  await pg.evaluateOnNewDocument((u, n) => {
    localStorage.setItem('favorUid', u);
    localStorage.setItem('favorName', n);
    localStorage.setItem('favorQueue', '3');
  }, uid, name);
  await pg.setViewport({ width: 1280, height: 800 });
  await pg.goto(URL, { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => window.FLB && FLB.mode === 'firebase', { timeout: 15000 });
  await pg.evaluate(() => { window.shuffleArray = (a) => [...a]; window.CINEMATIC_SPEED = 0.05; });
  return { ctx, pg };
};
const A = await mk('uprobea' + Math.random().toString(36).slice(2, 6), 'Probe A');
const B = await mk('uprobeb' + Math.random().toString(36).slice(2, 6), 'Probe B');

await A.pg.evaluate(() => { FMODES.openPrivateRoom(); FMODES.hostRoom(); });
await A.pg.waitForFunction(() => document.querySelector('#roomOverlay .rm-code'), { timeout: 12000 });
const code = await A.pg.evaluate(() => document.querySelector('#roomOverlay .rm-code').textContent.trim());
console.log('code:', code);

await B.pg.evaluate((c) => { FMODES.openPrivateRoom(); document.getElementById('rmCode').value = c; FMODES.joinRoom(); }, code);
const both = await Promise.all([A.pg, B.pg].map(pg =>
  pg.waitForFunction(() => document.querySelectorAll('#roomOverlay .rm-row:not(.ai)').length === 2, { timeout: 12000 }).then(() => true, () => false)));
console.log('both listed:', both);

await A.pg.evaluate(() => FMODES.roomSetSize(4));
const aiRows = await B.pg.waitForFunction(() => document.querySelectorAll('#roomOverlay .rm-row.ai').length === 2, { timeout: 8000 }).then(() => true, () => false);
console.log('joiner sees size 4 (+2 AI):', aiRows);

await A.pg.evaluate(() => FMODES.startRoomGame());
const picking = await Promise.all([A.pg, B.pg].map(pg =>
  pg.waitForFunction(() => document.getElementById('character-select').classList.contains('active') && !!document.getElementById('pickClock'), { timeout: 20000 }).then(() => true, () => false)));
console.log('both picking:', picking);

await A.pg.evaluate(() => { const c = [...document.querySelectorAll('#characterGrid .character-card')][0]; selectCharacter(c.dataset.id, c); document.getElementById('confirmBtn').click(); });
await B.pg.evaluate(() => { const cs = [...document.querySelectorAll('#characterGrid .character-card')]; const c = cs[cs.length - 1]; selectCharacter(c.dataset.id, c); document.getElementById('confirmBtn').click(); });
const live = await Promise.all([A.pg, B.pg].map(pg =>
  pg.waitForFunction(() => typeof game !== 'undefined' && game && game.players.length && window.FMP && FMP.active(), { timeout: 25000 }).then(() => true, () => false)));
console.log('both live:', live);

if (live.every(Boolean)) {
  const sA = await A.pg.evaluate(() => ({
    n: game.playerCount,
    humans: game.players.filter((p, i) => i === 0 || p._remoteHuman).length,
    names: game.players.map(p => p.name),
    heroes: game.players.map(p => p.character.id),
    hands: [0, 1, 2, 3].map(cs => game.players[FMP.localIdx(cs)].hand.map(c => c.id).join(',')).join(';'),
  }));
  const sB = await B.pg.evaluate(() => ({
    names: game.players.map(p => p.name),
    hands: [0, 1, 2, 3].map(cs => game.players[FMP.localIdx(cs)].hand.map(c => c.id).join(',')).join(';'),
  }));
  console.log('A table:', sA.n, sA.humans, 'humans |', sA.names.join(', '), '|', sA.heroes.join(','));
  console.log('hands agree:', sA.hands === sB.hands);
  console.log('B sees A:', sB.names.includes('Probe A'));
}

// cleanup
await A.pg.evaluate(async (c) => {
  const gid = FMP.gid();
  FMP.leaveGame();
  if (gid) await firebase.database().ref(`favor/mp/games/${gid}`).remove();
  await firebase.database().ref(`favor/mp/rooms/${c}`).remove();
}, code);
await B.pg.evaluate(() => FMP.leaveGame());
await browser.close();
console.log('PROBE DONE');
