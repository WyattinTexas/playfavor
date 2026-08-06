#!/usr/bin/env node
// Probe: Settings → "Test the Throne Room" rehearsal flow, end to end.
// Asserts: button exists, hall opens on a bent 1970s night, the draw
// seats a 4-table with AI fill, the seal goes live, the record carries
// NO rec.throne stamp (no 3×/purse/board), and the clock unbends.
// Cleans up its own RTDB traces (night, game record, player row).
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-drbango/b4d99dd5-675b-4cad-829f-4d65b5034ef0/scratchpad/probe-shots';
mkdirSync(SHOTS, { recursive: true });
const URL = 'http://localhost:8891/';
let pass = 0, fail = 0;
const ok = (c, l, d = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${d}`); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('favor_coach_seen', JSON.stringify(
    ['welcome', 'missions', 'hand', 'skills', 'pass', 'rivals',
     'scorn', 'favor', 'ring', 'melee', 'emblem']));
  localStorage.setItem('favorTelemetryOff', '1');
});
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.FSET && window.FMODES && window.FMP && FMP.available && FMP.available(), { timeout: 20000 });

// 1) The Settings panel carries the section + button.
await page.evaluate(() => { FSET.open(); });
await sleep(400);
const btnInfo = await page.evaluate(() => {
  const secs = [...document.querySelectorAll('#setOverlay .set-sec')];
  const sec = secs.find(s => /Throne Room/i.test(s.querySelector('.set-sec-title')?.textContent || ''));
  if (!sec) return null;
  const btn = sec.querySelector('button.set-upd-btn');
  return { label: sec.querySelector('.set-build span')?.textContent, btn: btn?.textContent };
});
ok(btnInfo && /Enter the Hall/.test(btnInfo.btn || ''), `Settings section present ("${btnInfo?.label}" → "${btnInfo?.btn}")`);
await page.screenshot({ path: `${SHOTS}/1-settings.png` });

// Shrink the pick window so the seal lands fast (the documented seam).
await page.evaluate(() => { FMP._T.pick = 5000; FMP._T.pickGrace = 1000; });

// 2) Press it — the hall opens on a bent past night.
await page.evaluate(() => {
  const secs = [...document.querySelectorAll('#setOverlay .set-sec')];
  const sec = secs.find(s => /Throne Room/i.test(s.querySelector('.set-sec-title')?.textContent || ''));
  sec.querySelector('button.set-upd-btn').click();
});
await sleep(800);
const hall = await page.evaluate(() => ({
  active: document.getElementById('throneHall')?.classList.contains('active'),
  testing: FMP.throne.testing(),
  phase: FMP.throne.phase().phase,
  key: FMP.throne.phase().key,
  rehearsalNote: /rehearsal/i.test(document.getElementById('throneHall')?.textContent || ''),
  standing: document.getElementById('thrCount')?.textContent || '',
}));
ok(hall.active, 'hall opened');
ok(hall.testing === true, 'FMP.throne.testing() is true');
ok(hall.phase === 'open', `bent night phase is open (key ${hall.key})`);
ok(hall.key < '1980' && hall.key >= '1970', `fake dateKey is a 1970s date (${hall.key})`);
ok(hall.rehearsalNote, 'the hall shows the rehearsal note');
await page.screenshot({ path: `${SHOTS}/2-hall.png` });
const nightKey = hall.key;
const myUid = await page.evaluate(() => FLB.uid());

// 3) Ride to the bar → draw → ceremony → pick → seal → live.
console.log('  … waiting for the bar (≤60s) + seal');
await page.waitForFunction(() =>
  document.getElementById('thrCeremony')?.classList.contains('on')
  || document.querySelector('.thr-missed'), { timeout: 90000 });
const missed = await page.evaluate(() => !!document.querySelector('.thr-missed'));
ok(!missed, 'the draw seated us (not missed)');
await page.screenshot({ path: `${SHOTS}/3-ceremony.png` });

await page.waitForFunction(() => {
  const gs = document.getElementById('game-screen');
  return gs && gs.classList.contains('active') && window.FMP && FMP.active();
}, { timeout: 60000 });
const live = await page.evaluate(async () => {
  const gid = FMP.gid();
  const rec = FMP.record();
  const raw = (await firebase.database().ref(`favor/mp/games/${gid}`).get()).val();
  return {
    gid, status: raw && raw.status,
    seats: raw && raw.roster ? raw.roster.length : 0,
    aiSeats: raw && raw.roster ? raw.roster.filter(r => !r.human).length : 0,
    throneStamp: raw ? raw.throne : 'norec',
    recThrone: rec ? rec.throne : 'norec',
    clockBent: typeof window._throneNow === 'function',
    testing: FMP.throne.testing(),
  };
});
ok(live.status === 'live', `table sealed live (gid ${live.gid})`);
ok(live.seats === 4 && live.aiSeats === 3, `4 seats, 3 hard-AI fill (${live.seats}/${live.aiSeats} ai)`);
ok(live.throneStamp === undefined && live.recThrone === undefined,
  `rec.throne WITHHELD — no 3×/purse/board (${live.throneStamp}/${live.recThrone})`);
ok(live.clockBent === false, 'the night clock unbent at teardown');
ok(live.testing === false, 'testing flag cleared');
await sleep(1500);
await page.screenshot({ path: `${SHOTS}/4-live.png` });

// 4) Real door sanity: with the clock unbent, tonight's door reads real time.
const door = await page.evaluate(() => FMP.throne.phase());
ok(door.key >= '2026', `door back on the real calendar (${door.key}, ${door.phase})`);

// 5) Clean up every trace.
await page.evaluate(async (gid, key, uid) => {
  await firebase.database().ref(`favor/mp/games/${gid}`).remove();
  await firebase.database().ref(`favor/throne/${key}`).remove();
  await firebase.database().ref(`players/${uid}`).remove();
}, live.gid, nightKey, myUid);
const residue = await page.evaluate(async (gid, key, uid) => {
  const g = (await firebase.database().ref(`favor/mp/games/${gid}`).get()).exists();
  const t = (await firebase.database().ref(`favor/throne/${key}`).get()).exists();
  const p = (await firebase.database().ref(`players/${uid}`).get()).exists();
  return { g, t, p };
}, live.gid, nightKey, myUid);
ok(!residue.g && !residue.t && !residue.p, `RTDB traces removed (game/night/player: ${residue.g}/${residue.t}/${residue.p})`);

await browser.close();
console.log(`\n${fail === 0 ? `✅ ${pass} probe checks passed` : `❌ ${fail} FAILED, ${pass} passed`}`);
process.exit(fail ? 1 : 0);
