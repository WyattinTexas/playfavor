#!/usr/bin/env node
/**
 * Records the FAVOR announce trailer's gameplay footage: a scripted run through
 * the real game at 1920x1080, captured with CDP screencast so animations stay
 * smooth (page.screenshot() polls too slowly to keep motion).
 *
 *   cd ~/playfavor && python3 -m http.server 8891 &
 *   node shell/store/capture-trailer.mjs
 *
 * Writes JPEG frames + frames.txt (ffmpeg concat list, real per-frame durations)
 * to shell/store/trailer/frames/. build-trailer.sh turns those into the MP4.
 */
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const URL = process.env.SHOT_URL || 'http://localhost:8891/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'trailer', 'frames');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1920,1080', '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
const baseUA = await browser.userAgent();
await page.setUserAgent(baseUA + ' FavorShell-Steam/1.0');   // Mint hidden, exactly like the Steam build
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('favorUid', 'utrailer00001');
  localStorage.setItem('favorName', 'Lady Plum');
  localStorage.setItem('favorAvatar', 'knight');
  localStorage.setItem('favorQueue', '3');
  localStorage.setItem('favorCoachDone', '1');
});
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });
await page.evaluate(() => { const v = document.getElementById('buildVersion'); if (v) v.remove(); });

// Coach tips are good UX, but they narrate over the shots — clear them on sight.
const clearCoach = () => page.evaluate(() => {
  const skip = [...document.querySelectorAll('a,button,span,div')]
    .find(el => el.children.length === 0 && /skip tips/i.test(el.textContent));
  if (skip) skip.click();
  const x = document.querySelector('.coach-x');
  if (x && x.offsetParent) x.click();
  document.querySelectorAll('.coach-tip, .coach-bubble').forEach(el => el.remove());
});

// ── screencast ────────────────────────────────────────────────────────────────
const client = await page.createCDPSession();
const frames = [];
client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const i = frames.length;
  const name = `f${String(i).padStart(5, '0')}.jpg`;
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
  frames.push({ name, t: metadata.timestamp });
  try { await client.send('Page.screencastFrameAck', { sessionId }); } catch {}
});

const center = async (sel, nth = 0) => page.evaluate((s, n) => {
  const el = [...document.querySelectorAll(s)].filter(e => e.offsetParent)[n];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}, sel, nth);

const hover = async (sel, nth = 0) => {
  const p = await center(sel, nth);
  if (p) await page.mouse.move(p.x, p.y, { steps: 12 });
};
const click = async (sel, nth = 0) => {
  const p = await center(sel, nth);
  if (p) { await page.mouse.move(p.x, p.y, { steps: 10 }); await sleep(160); await page.mouse.click(p.x, p.y); }
  return !!p;
};

await client.send('Page.startScreencast', {
  format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1,
});

// 1 · The royal menu — cursor drifts onto PLAY NOW
await page.mouse.move(960, 900);
await sleep(400);
await hover('#title-screen .btn-royal');
await sleep(1600);

// 2 · Hero select — browse the court, then choose
await page.evaluate(() => { window._mpSkipQueue = true; });
await click('#title-screen .btn-royal');
await page.waitForFunction(() => document.querySelector('.character-card')?.offsetParent, { timeout: 20000 });
await sleep(700);
await hover('.character-card', 0); await sleep(750);
await hover('.character-card', 3); await sleep(750);
const heroCount = await page.evaluate(() => document.querySelectorAll('.character-card').length);
const pick = Math.min(2, Math.max(0, heroCount - 1));
await click('.character-card', pick);
await sleep(1300);                                    // selection ring blooms
await click('#confirmBtn');

// 3 · The table
await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 25000 });
await sleep(1500);
await clearCoach();
await sleep(1200);

// A purse worth showing off (a fresh Act-1 board is bare).
await page.evaluate(() => {
  const take = (names) => names.map(n => ({ ...FAVOR_DATA.cards.find(c => c.name === n) })).filter(c => c.name);
  const p0 = game.players[0];
  p0.gold = 16; p0.prestige = 11; p0.favor = 17; p0.scorn = 1;
  p0.playedCards = take(['Hunting', 'First Aid', 'Warm Mentorship']);
  game.players[1].playedCards = take(['Trapping', 'Cooking']);
  game.players[2].playedCards = take(['Tombstone']);
  game.players[1].gold = 9; game.players[2].gold = 12;
  game.applySlotSkills(p0);
  renderGameState();
});
await sleep(1500);
await clearCoach();

// 4 · Consider a card — the action sheet puts the art up big
let played = false;
for (let i = 0; i < 5 && !played; i++) {
  await page.evaluate((idx) => selectHandCard(idx), i);
  await sleep(1100);
  const canPlay = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#actionPanel .action-btn')]
      .find(x => /Play/i.test(x.textContent) && !x.disabled);
    return !!b;
  });
  if (!canPlay) { await page.evaluate(() => hideActionPanel()); await sleep(250); continue; }
  await sleep(1500);                                   // let the sheet breathe on screen
  // 5 · Play it — the +attribute floats are the payoff
  await page.evaluate(() => {
    [...document.querySelectorAll('#actionPanel .action-btn')]
      .find(x => /Play/i.test(x.textContent) && !x.disabled).click();
  });
  played = true;
  await sleep(2600);
}
await clearCoach();
await sleep(400);

// 6 · Your character board
await page.evaluate(() => openBoardOverlay());
await sleep(2400);
await page.evaluate(() => closeBoardOverlay());
await sleep(700);

// 7 · The realm's leaderboard (crests + medals, live data)
await page.evaluate(() => { hideActionPanel(); FLB.openLeaderboard('alltime'); });
await page.waitForFunction(() => document.querySelectorAll('#lbBody .lb-row').length >= 3, { timeout: 12000 }).catch(() => {});
await sleep(2600);

await client.send('Page.stopScreencast');
await sleep(400);

// Scrub the trailer identity from the live realm.
await page.evaluate(async () => {
  try { await firebase.database().ref('favor/players/utrailer00001').remove(); } catch (e) {}
});
await browser.close();

// ── concat list with true frame durations ────────────────────────────────────
if (frames.length < 30) { console.error(`only ${frames.length} frames — aborting`); process.exit(1); }
const lines = [];
for (let i = 0; i < frames.length - 1; i++) {
  const d = Math.max(0.008, Math.min(1.5, frames[i + 1].t - frames[i].t));
  lines.push(`file '${frames[i].name}'`, `duration ${d.toFixed(4)}`);
}
lines.push(`file '${frames[frames.length - 1].name}'`, 'duration 0.2', `file '${frames[frames.length - 1].name}'`);
writeFileSync(join(OUT, 'frames.txt'), lines.join('\n') + '\n');

const span = frames[frames.length - 1].t - frames[0].t;
console.log(`frames: ${frames.length}  span: ${span.toFixed(1)}s  avg fps: ${(frames.length / span).toFixed(1)}`);
