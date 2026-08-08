#!/usr/bin/env node
/**
 * FAVOR — live-play footage recorder (the ads re-cut wants HUMAN-PLAYED
 * footage — capture-ads.mjs's staged scenes filmed "really bad", 8/8).
 *
 * Opens a real, playable Chrome window on the game and records everything
 * you do via CDP screencast — same frame law as the trailer rig (JPEG +
 * true per-frame durations), but rolled into chunk MP4s as you play so an
 * hour of footage costs ~4 GB, not ~80. No cursor ever appears in the
 * capture (screencast films the page surface, not the OS pointer).
 *
 *   cd ~/playfavor && node tools/record-session.mjs
 *
 *   · play as long as you like — solo, daily rival, online, anything
 *   · saw something cool? TAP ` (backtick) — it's bookmarked for the cut
 *   · done? close the Chrome window (or Ctrl+C here)
 *
 * On close it stitches sessions/<stamp>/session.mp4 and auto-runs
 * mine-session.mjs, which surfaces your marks + the highest-motion moments
 * as ready-to-review clips. export-shot.mjs then turns a chosen moment
 * into a builder-native shot for marketing/applovin/build_ads.sh.
 *
 * Capture laws carried over: Steam UA (Mint + TV hidden — footage stays
 * clean of every store rail), coach pre-seen, telemetry off, buildVersion
 * scrubbed. Solo saves are NOT suppressed — this is real play.
 *
 *   --test N   headless smoke: record N seconds of the title screen,
 *              then finalize + mine (separate throwaway profile).
 *   --no-mine  skip the auto-mine at the end.
 */
import { mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const URL = process.env.SHOT_URL || 'http://localhost:8891/';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEST = process.argv.includes('--test');
const TEST_SECS = TEST ? Number(process.argv[process.argv.indexOf('--test') + 1] || 15) : 0;
const NO_MINE = process.argv.includes('--no-mine');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const SESS = join(ROOT, 'marketing', 'footage', 'sessions', (TEST ? 'test_' : '') + stamp);
const TMP = join(SESS, '.tmp');
const SEGS = join(SESS, 'segs');
mkdirSync(TMP, { recursive: true });
mkdirSync(SEGS, { recursive: true });

// ── the local server (capture law: film the repo, not prod) ───────────
async function ensureServer() {
  try {
    const r = await fetch(URL, { signal: AbortSignal.timeout(1500) });
    if (r.ok) return console.log(`· server already up at ${URL}`);
  } catch { /* not up */ }
  spawn('python3', ['-m', 'http.server', '8891'], { cwd: ROOT, detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    try { if ((await fetch(URL, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* boot */ }
  }
  console.log(`· started python3 -m http.server 8891 (left running)`);
}

// ── chunk roller — frames land as JPEGs, leave as H.264 ───────────────
// True per-frame durations (the trailer rig's law) go straight into each
// chunk's concat list, so session.mp4 is a faithful VFR timeline: stills
// hold, 90 fps flourishes stay 90 fps. The newest frame always seeds the
// next chunk so display holds never break at a boundary.
const CHUNK_FRAMES = 2000;      // roll when this many are pending…
const CHUNK_SECS = 120;         // …or this much wall time has passed
let pending = [];               // [{ file, t }] epoch-second timestamps
let chunkStart = Date.now();
let segN = 0;
let frameN = 0;
let firstT = null;
let encodeQ = Promise.resolve();
let encBusy = 0;

function ff(args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], opts);
    let err = '';
    p.stderr.on('data', d => err += d);
    p.on('close', c => c === 0 ? res() : rej(new Error(`ffmpeg (${args.join(' ').slice(0, 80)}…): ${err.slice(-400)}`)));
  });
}

function rollChunk(final = false) {
  if (pending.length < (final ? 1 : 2)) return;
  // Non-final: hold back the newest frame — it opens the next chunk.
  const take = final ? pending : pending.slice(0, -1);
  const seed = final ? null : pending[pending.length - 1];
  pending = final ? [] : [seed];
  chunkStart = Date.now();
  const seg = `seg_${String(segN++).padStart(3, '0')}`;
  const lines = [];
  for (let i = 0; i < take.length; i++) {
    const next = i + 1 < take.length ? take[i + 1].t : (seed ? seed.t : take[i].t + 0.2);
    lines.push(`file '${take[i].file}'`, `duration ${Math.max(0.005, next - take[i].t).toFixed(4)}`);
  }
  if (final) lines.push(`file '${take[take.length - 1].file}'`);
  const list = `${seg}.txt`;
  writeFileSync(join(TMP, list), lines.join('\n') + '\n');
  encBusy++;
  encodeQ = encodeQ.then(async () => {
    await ff(['-y', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', 'scale=in_range=full:out_range=tv,format=yuv420p',
      '-c:v', 'h264_videotoolbox', '-b:v', '10M', '-maxrate', '14M',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-fps_mode', 'vfr', '-movflags', '+faststart', join(SEGS, `${seg}.mp4`)], { cwd: TMP });
    for (const f of take) if (!seed || f.file !== seed.file) rmSync(join(TMP, f.file), { force: true });
    rmSync(join(TMP, list), { force: true });
    const span = take[take.length - 1].t - take[0].t;
    const live = firstT ? ((take[take.length - 1].t - firstT) / 60).toFixed(1) : '?';
    console.log(`· ${seg} — ${take.length} frames, ${span.toFixed(1)}s (session ${live} min)`);
  }).catch(e => console.error(`✗ ${seg} encode: ${e.message}`)).finally(() => encBusy--);
}

// Idle guard — a long think/AFK stretch sends no frames; roll what we
// have and re-seed the still so the timeline stays wall-true.
const idleTimer = setInterval(() => {
  if (Date.now() - chunkStart < CHUNK_SECS * 1000) return;
  if (pending.length >= 2) return rollChunk();
  if (pending.length === 1) {
    const still = pending[0];
    const copy = `f${String(frameN++).padStart(6, '0')}.jpg`;
    copyFileSync(join(TMP, still.file), join(TMP, copy));
    pending.push({ file: copy, t: Date.now() / 1000 });
    rollChunk();
  }
}, 5000);

// ── browser ───────────────────────────────────────────────────────────
await ensureServer();
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: TEST ? 'new' : false,
  userDataDir: join(ROOT, 'marketing', 'footage', TEST ? '.chrome-test' : '.chrome-play'),
  defaultViewport: TEST ? { width: 1920, height: 1080, deviceScaleFactor: 1 } : null,
  args: [
    '--window-size=1920,1148', '--window-position=0,0', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    ...(TEST ? ['--mute-audio'] : ['--start-fullscreen']),
  ],
});
const baseUA = await browser.userAgent();
const page = (await browser.pages())[0] || await browser.newPage();
// Steam UA: Mint + TV hidden — footage stays clean of every store rail.
await page.setUserAgent(baseUA + ' FavorShell-Steam/1.0');
await page.evaluateOnNewDocument(() => {
  const seed = (k, v) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); };
  seed('favorUid', 'wyattfootage01');
  seed('favorName', 'Wyatt');
  seed('favorAvatar', 'knight');
  seed('favorCoachDone', '1');
  seed('favor_coach_seen', JSON.stringify(
    ['welcome', 'missions', 'hand', 'skills', 'pass', 'rivals',
     'scorn', 'favor', 'ring', 'melee', 'emblem']));
  localStorage.setItem('favorTelemetryOff', '1');
  // ` = bookmark this moment (ignored while typing in a field). A wee
  // corner blip confirms it — it lands AFTER the moment, so the cut
  // window (ending at the mark) never contains it.
  window.__marks = [];
  addEventListener('keydown', (e) => {
    if (e.key !== '`' || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    window.__marks.push(Date.now());
    const d = document.createElement('div');
    d.textContent = '◉ marked';
    d.style.cssText = 'position:fixed;right:10px;bottom:8px;z-index:99999;font:600 12px system-ui;' +
      'color:#ffd76a;opacity:.8;pointer-events:none;transition:opacity .5s';
    document.body.appendChild(d);
    setTimeout(() => d.style.opacity = '0', 250);
    setTimeout(() => d.remove(), 900);
  }, true);
  setInterval(() => document.getElementById('buildVersion')?.remove(), 2000);
});
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 })
  .catch(() => console.log('· board still connecting (fine for solo play)'));

// ── screencast ────────────────────────────────────────────────────────
const client = await page.createCDPSession();
const markers = [];
client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = `f${String(frameN++).padStart(6, '0')}.jpg`;
  writeFileSync(join(TMP, file), Buffer.from(data, 'base64'));
  const t = metadata.timestamp || Date.now() / 1000;
  if (firstT === null) firstT = t;
  pending.push({ file, t });
  if (pending.length >= CHUNK_FRAMES) rollChunk();
  try { await client.send('Page.screencastFrameAck', { sessionId }); } catch { /* teardown race */ }
});
await client.send('Page.startScreencast', {
  format: 'jpeg', quality: 85, maxWidth: 1920, maxHeight: 1200, everyNthFrame: 2,
});

const markTimer = setInterval(async () => {
  try {
    const m = await page.evaluate(() => { const x = window.__marks || []; window.__marks = []; return x; });
    for (const t of m) { markers.push(t / 1000); console.log(`· ◉ marked at session ${((t / 1000 - firstT) / 60).toFixed(1)} min`); }
  } catch { /* page mid-nav or gone */ }
}, 4000);

console.log('');
console.log('● RECORDING — play as long as you like.');
console.log('    tap ` (backtick) when something cool happens to bookmark it');
console.log('    close the Chrome window (or Ctrl+C here) when you are done');
console.log('');

// Test mode: sweep the pointer over the title so hover blooms make frames.
let wiggle = null;
if (TEST) {
  let i = 0;
  wiggle = setInterval(() => {
    const x = 400 + 1100 * Math.abs(Math.sin(i / 9)); i++;
    client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 600 + 200 * Math.sin(i / 5) }).catch(() => {});
  }, 150);
  setTimeout(() => finalize('test timer'), TEST_SECS * 1000);
}

// ── finalize ──────────────────────────────────────────────────────────
let closing = false;
async function finalize(why) {
  if (closing) return; closing = true;
  clearInterval(idleTimer); clearInterval(markTimer); if (wiggle) clearInterval(wiggle);
  console.log(`\n· finishing (${why}) — stitching session.mp4 …`);
  try { await client.send('Page.stopScreencast'); } catch { /* gone */ }
  await sleep(400);
  try { rollChunk(true); } catch (e) { console.error(`✗ final roll: ${e.message}`); }
  await encodeQ;
  try { await browser.close(); } catch { /* already closed */ }
  if (segN === 0) { console.error('✗ no frames were captured'); process.exit(1); }
  const list = Array.from({ length: segN }, (_, i) => `file 'segs/seg_${String(i).padStart(3, '0')}.mp4'`).join('\n');
  writeFileSync(join(SESS, 'segs.txt'), list + '\n');
  await ff(['-y', '-f', 'concat', '-safe', '0', '-i', 'segs.txt', '-c', 'copy',
    '-movflags', '+faststart', 'session.mp4'], { cwd: SESS });
  rmSync(join(SESS, 'segs.txt'), { force: true });
  rmSync(SEGS, { recursive: true, force: true });
  rmSync(TMP, { recursive: true, force: true });
  writeFileSync(join(SESS, 'meta.json'), JSON.stringify({
    startedWall: new Date(firstT * 1000).toISOString(),
    frames: frameN, url: URL,
    markers: markers.map(t => Number((t - firstT).toFixed(2))),
  }, null, 2) + '\n');
  console.log(`✓ ${join(SESS, 'session.mp4')}`);
  if (!NO_MINE) {
    console.log('· mining highlights …');
    await new Promise(r => spawn('node', [join(ROOT, 'tools', 'mine-session.mjs'), SESS],
      { stdio: 'inherit' }).on('close', r));
    if (!TEST) spawn('open', [join(SESS, 'candidates')], { stdio: 'ignore' }).unref();
  }
  process.exit(0);
}
browser.on('disconnected', () => finalize('window closed'));
process.on('SIGINT', () => finalize('Ctrl+C'));
process.on('SIGTERM', () => finalize('terminated'));
