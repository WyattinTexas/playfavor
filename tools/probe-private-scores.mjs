// Does a PRIVATE GAME count? Host a room solo (AI fill), go live, then run
// the REAL showScoring() posting path with rigged placements and read back
// what Firebase recorded for the audit uid: rating, games, hero XP (chars
// ledger), and the daily-champion board row. Personas are de-fanged before
// scoring so no live persona row moves. Every trace is deleted at the end.
import puppeteer from 'puppeteer-core';
const URL = 'http://localhost:8891/';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--mute-audio'],
});
const UID = 'uauditpriv' + Math.random().toString(36).slice(2, 6);
let code = null;
try {
  const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await pg.evaluateOnNewDocument((u) => {
    localStorage.setItem('favorUid', u);
    localStorage.setItem('favorName', 'Audit Hermit');
    localStorage.setItem('favorQueue', '3');
  }, UID);
  await pg.setViewport({ width: 1280, height: 800 });
  await pg.goto(URL, { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => window.FLB && FLB.mode === 'firebase', { timeout: 15000 });
  await pg.evaluate(() => { window.CINEMATIC_SPEED = 0.05; });

  // Host a private game, alone, and start it — open seats play as AI.
  await pg.evaluate(() => { FMODES.openPrivateRoom(); FMODES.hostRoom(); });
  await pg.waitForFunction(() => document.querySelector('#roomOverlay .rm-code'), { timeout: 12000 });
  code = await pg.evaluate(() => document.querySelector('#roomOverlay .rm-code').textContent.trim());
  console.log('room:', code);
  await pg.evaluate(() => FMODES.startRoomGame());
  await pg.waitForFunction(() => document.getElementById('character-select').classList.contains('active') && !!document.getElementById('pickClock'), { timeout: 20000 });
  await pg.evaluate(() => { const c = [...document.querySelectorAll('#characterGrid .character-card')][0]; selectCharacter(c.dataset.id, c); document.getElementById('confirmBtn').click(); });
  await pg.waitForFunction(() => typeof game !== 'undefined' && game && game.players.length && window.FMP && FMP.active(), { timeout: 30000 });
  const table = await pg.evaluate(() => ({
    mp: FMP.active(),
    names: game.players.map(p => p.name),
    heroes: game.players.map(p => p.character.id),
    personas: game.players.filter(p => p._personaUid).length,
  }));
  console.log('live private table:', JSON.stringify(table));

  // Snapshot my row BEFORE, then run the true scoring pipeline with rigged
  // placements (You 1st, 34 Favor). Personas de-fanged: this probe is about
  // the HUMAN ledger; live persona rows must not move.
  const out = await pg.evaluate(async () => {
    const before = await firebase.database().ref(`favor/players/${localStorage.getItem('favorUid')}`).get().then(s => s.val());
    game.players.forEach(p => { delete p._personaUid; delete p._personaAI; });
    const rows = game.players.map((p, i) => ({
      playerIndex: i, name: p.name, finalScore: i === 0 ? 34 : 20 - i,
    })).sort((a, b) => b.finalScore - a.finalScore);
    game.getWinner = () => rows;
    let xpRes = 'unset';
    const origPost = FLB.postGameResult;
    FLB.postGameResult = (...a) => { const p = origPost(...a); p.then(x => { xpRes = x; }).catch(e => { xpRes = 'ERR:' + e.message; }); return p; };
    showScoring();
    for (let i = 0; i < 60 && xpRes === 'unset'; i++) await new Promise(r => setTimeout(r, 250));
    const uid = localStorage.getItem('favorUid');
    const key = FLB.currentDateKey();
    const row = await firebase.database().ref(`favor/players/${uid}`).get().then(s => s.val());
    const daily = await firebase.database().ref(`favor/daily/${key}/scores/${uid}`).get().then(s => s.val());
    return { before, xpRes, key, row, daily };
  });
  console.log('BEFORE row:', JSON.stringify(out.before));
  console.log('XP result:', JSON.stringify(out.xpRes));
  console.log('AFTER row:', JSON.stringify(out.row));
  console.log('DAILY row (' + out.key + '):', JSON.stringify(out.daily));

  const r = out.row || {};
  const hero = table.heroes[0];
  const checks = {
    'rating written': typeof r.rating === 'number' && r.rating > 0,
    'game counted': (r.games || 0) === 1,
    'hero XP banked (fv=34)': !!(r.chars && r.chars[hero] && r.chars[hero].fv === 34),
    'xp returned to victory chip': !!(out.xpRes && out.xpRes.fvAfter === 34),
    'daily-champion row (best=34)': !!(out.daily && out.daily.best === 34),
  };
  let fail = 0;
  for (const [k, v] of Object.entries(checks)) { console.log((v ? 'PASS' : 'FAIL') + '  ' + k); if (!v) fail++; }

  // cleanup: game record, room, player row, daily row, any other daily keys
  await pg.evaluate(async (c) => {
    const uid = localStorage.getItem('favorUid');
    const gid = FMP.gid && FMP.gid();
    try { FMP.leaveGame(); } catch (e) {}
    const db = firebase.database();
    if (gid) await db.ref(`favor/mp/games/${gid}`).remove();
    if (c) await db.ref(`favor/mp/rooms/${c}`).remove();
    const days = await db.ref('favor/daily').get().then(s => Object.keys(s.val() || {}));
    for (const d of days) await db.ref(`favor/daily/${d}/scores/${uid}`).remove();
    await db.ref(`favor/players/${uid}`).remove();
  }, code);
  const clean = await pg.evaluate(async () => {
    const uid = localStorage.getItem('favorUid');
    const p = await firebase.database().ref(`favor/players/${uid}`).get().then(s => s.val());
    return p === null;
  });
  console.log('cleanup verified:', clean);
  console.log(fail ? `PROBE FAIL (${fail})` : 'PROBE ALL PASS');
} finally {
  await browser.close();
}
