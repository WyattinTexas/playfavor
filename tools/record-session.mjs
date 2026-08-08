#!/usr/bin/env node
/**
 * Live-play footage recorder (v3 — single window, on-game overlay) — the
 * ads re-cut wants HUMAN-PLAYED footage; staged scenes filmed "really
 * bad" (8/8).
 *
 * ONE Chrome window, the game fullscreen inside it, and a small ⏺ REC
 * overlay ON the game. Press it and it vanishes BEFORE capture starts
 * (never in a frame); while recording, glide the mouse to the
 * bottom-right corner to reveal ⏹ STOP + timer/GB (those reveal frames
 * are the reach-for-stop tail — never ad material). Each ⏺…⏹ take
 * becomes sessions/<stamp>/ with session.mp4, auto-mined highlight
 * candidates, sheet.png, notes.md — Finder opens on the clips.
 *
 *   Wyatt's door: double-click "Record GVT" on the Desktop.
 *   Terminal:  node tools/record-session.mjs                     # FAVOR
 *              SHOT_URL=https://playgvt.net/ node tools/…        # GVT
 *
 * Safety rails: nothing records until ⏺; a take auto-stops at
 * REC_MAX_MIN (90) minutes or under 8 GB free disk; temp frames are
 * rolled into H.264 chunks continuously (~75 MB/min, never a JPEG
 * flood); ` (backtick) bookmarks a moment.
 *
 * Capture laws: CDP screencast of the page surface (no OS cursor), true
 * per-frame durations, Steam UA (Mint + TV hidden), coach pre-seen,
 * telemetry off, occlusion-throttling disabled (an unfocused window
 * otherwise silently captures nothing — the empty-take lesson).
 *
 *   --test N   headless smoke: record N seconds immediately.
 *   --no-mine  skip auto-mining.   REC_NTH=1|2|4  capture-rate knob.
 */
import { mkdirSync, writeFileSync, copyFileSync, rmSync, readdirSync, statSync, statfsSync } from 'fs';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const URL = process.env.SHOT_URL || 'http://localhost:8891/';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SESSIONS = join(ROOT, 'marketing', 'footage', 'sessions');
const TEST = process.argv.includes('--test');
const TEST_SECS = TEST ? Number(process.argv[process.argv.indexOf('--test') + 1] || 15) : 0;
const NO_MINE = process.argv.includes('--no-mine');
const NTH = Number(process.env.REC_NTH || 2);
const MAX_MIN = Number(process.env.REC_MAX_MIN || 90);   // a take auto-stops here
const MIN_FREE_GB = 8;                                   // …or when disk gets this low
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const freeGB = () => { try { const s = statfsSync(ROOT); return s.bavail * s.bsize / 1e9; } catch { return 999; } };

// ── the local server (FAVOR default; remote SHOT_URLs skip this) ──────
async function ensureServer() {
  try {
    const r = await fetch(URL, { signal: AbortSignal.timeout(2500) });
    if (r.ok) return console.log(`· game reachable at ${URL}`);
  } catch { /* not up */ }
  if (!URL.includes('localhost:8891')) { console.error(`✗ cannot reach ${URL}`); process.exit(1); }
  spawn('python3', ['-m', 'http.server', '8891'], { cwd: ROOT, detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    try { if ((await fetch(URL, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* boot */ }
  }
  console.log('· started python3 -m http.server 8891 (left running)');
}

function ff(args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], opts);
    let err = '';
    p.stderr.on('data', d => err += d);
    p.on('close', c => c === 0 ? res() : rej(new Error(`ffmpeg: ${err.slice(-400)}`)));
  });
}

// ── take lifecycle ────────────────────────────────────────────────────
// One "take" = one ⏺…⏹ span. Frames land as JPEGs with true durations
// (the trailer rig's law) and leave as H.264 chunks as you play; the
// newest frame always seeds the next chunk so holds never break.
const CHUNK_FRAMES = 2000;
const CHUNK_SECS = 120;
let rec = null;              // active take, or null
let phase = 'idle';          // idle | rec | stitching | mining
let lastMsg = '';
let finalizing = Promise.resolve();

function mkTake() {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '');
  const dir = join(SESSIONS, (TEST ? 'test_' : '') + stamp);
  const t = {
    dir, tmp: join(dir, '.tmp'), segs: join(dir, 'segs'),
    pending: [], chunkStart: Date.now(), segN: 0, frameN: 0, mp4Bytes: 0,
    firstT: null, wall0: Date.now(), markers: [], encodeQ: Promise.resolve(),
  };
  mkdirSync(t.tmp, { recursive: true });
  mkdirSync(t.segs, { recursive: true });
  return t;
}

function rollChunk(t, final = false) {
  if (t.pending.length < (final ? 1 : 2)) return;
  const take = final ? t.pending : t.pending.slice(0, -1);
  const seed = final ? null : t.pending[t.pending.length - 1];
  t.pending = final ? [] : [seed];
  t.chunkStart = Date.now();
  const seg = `seg_${String(t.segN++).padStart(3, '0')}`;
  const lines = [];
  for (let i = 0; i < take.length; i++) {
    const next = i + 1 < take.length ? take[i + 1].t : (seed ? seed.t : take[i].t + 0.2);
    lines.push(`file '${take[i].file}'`, `duration ${Math.max(0.005, next - take[i].t).toFixed(4)}`);
  }
  if (final) lines.push(`file '${take[take.length - 1].file}'`);
  writeFileSync(join(t.tmp, `${seg}.txt`), lines.join('\n') + '\n');
  t.encodeQ = t.encodeQ.then(async () => {
    await ff(['-y', '-f', 'concat', '-safe', '0', '-i', `${seg}.txt`,
      '-vf', 'scale=in_range=full:out_range=tv,format=yuv420p',
      '-c:v', 'h264_videotoolbox', '-b:v', '10M', '-maxrate', '14M',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-fps_mode', 'vfr', '-movflags', '+faststart', join(t.segs, `${seg}.mp4`)], { cwd: t.tmp });
    try { t.mp4Bytes += statSync(join(t.segs, `${seg}.mp4`)).size; } catch { /* stat only */ }
    for (const f of take) if (!seed || f.file !== seed.file) rmSync(join(t.tmp, f.file), { force: true });
    rmSync(join(t.tmp, `${seg}.txt`), { force: true });
    const span = take[take.length - 1].t - take[0].t;
    console.log(`· ${seg} — ${take.length} frames, ${span.toFixed(1)}s (${(take.length / Math.max(0.1, span)).toFixed(0)} fps)`);
  }).catch(e => console.error(`✗ ${seg}: ${e.message}`));
}

// Idle guard + safety rails. A forgotten take can't eat the disk: it
// auto-stops at REC_MAX_MIN minutes or when free space runs low. And a
// long AFK stretch sends no frames, so roll what we have and re-seed the
// still to keep the timeline wall-true.
setInterval(() => {
  if (rec && Date.now() - rec.wall0 > MAX_MIN * 60000) {
    console.log(`\n⚠ take hit the ${MAX_MIN} min cap — auto-stopping`);
    lastMsg = `auto-stopped at ${MAX_MIN} min`;
    return void stopRec();
  }
  if (rec && freeGB() < MIN_FREE_GB) {
    console.log(`\n⚠ disk under ${MIN_FREE_GB} GB free — auto-stopping`);
    lastMsg = `auto-stopped: low disk`;
    return void stopRec();
  }
  if (!rec || Date.now() - rec.chunkStart < CHUNK_SECS * 1000) return;
  if (rec.pending.length >= 2) return rollChunk(rec);
  if (rec.pending.length === 1) {
    const still = rec.pending[0];
    const copy = `f${String(rec.frameN++).padStart(6, '0')}.jpg`;
    copyFileSync(join(rec.tmp, still.file), join(rec.tmp, copy));
    rec.pending.push({ file: copy, t: Date.now() / 1000 });
    rollChunk(rec);
  }
}, 5000);

// ── browser: ONE window, the game, nothing else ───────────────────────
await ensureServer();
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: TEST ? 'new' : false,
  userDataDir: join(ROOT, 'marketing', 'footage', TEST ? '.chrome-test' : '.chrome-play'),
  defaultViewport: TEST ? { width: 1920, height: 1080, deviceScaleFactor: 1 } : null,
  args: [
    '--window-size=1920,1148', '--window-position=0,0', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble',
    // Keep frames flowing even when the window is occluded or unfocused
    // (macOS otherwise stops compositing → a take silently captures
    // nothing — the 8/8 empty-take lesson).
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    ...(TEST ? ['--mute-audio'] : ['--start-fullscreen']),
  ],
});
const baseUA = await browser.userAgent();
const page = (await browser.pages())[0] || await browser.newPage();

// The record/stop/mark door for the overlay (named to never collide).
await page.exposeFunction('__recCmd', async (cmd) => {
  if (cmd === 'start') startRec();
  if (cmd === 'stop') stopRec();
  if (cmd === 'mark' && rec) { rec.markers.push(Date.now() / 1000); page.evaluate(() => window.__blip?.()).catch(() => {}); }
  return {
    phase,
    secs: rec ? (Date.now() - rec.wall0) / 1000 : 0,
    frames: rec ? rec.frameN : 0,
    marks: rec ? rec.markers.length : 0,
    gb: rec ? (rec.mp4Bytes + rec.pending.length * 180000) / 1e9 : 0,
    free: freeGB(),
    last: lastMsg,
  };
});

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
  setInterval(() => document.getElementById('buildVersion')?.remove(), 2000);

  // ` = bookmark this moment (ignored while typing). The wee blip lands
  // AFTER the moment, so cut windows never contain it.
  window.__marks = [];
  window.__blip = () => {
    const d = document.createElement('div');
    d.textContent = '◉ marked';
    d.style.cssText = 'position:fixed;right:10px;bottom:64px;z-index:2147483646;font:600 12px system-ui;' +
      'color:#ffd76a;opacity:.8;pointer-events:none;transition:opacity .5s';
    document.body.appendChild(d);
    setTimeout(() => d.style.opacity = '0', 250);
    setTimeout(() => d.remove(), 900);
  };
  addEventListener('keydown', (e) => {
    if (e.key !== '`' || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    window.__marks.push(Date.now());
    window.__blip();
  }, true);

  // ── the on-game record overlay (the only UI there is) ───────────────
  // Idle: a red ⏺ REC pill, bottom-right. Click → it hides FIRST, then
  // capture starts 450 ms later — the button is never in a frame. While
  // recording nothing shows; dwell the mouse in the bottom-right corner
  // to reveal ⏹ STOP + timer (reach-for-stop frames are discard-tail).
  const boot = () => {
    if (!document.body || document.getElementById('__recui')) return;
    const ui = document.createElement('div');
    ui.id = '__recui';
    ui.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;' +
      'font:700 14px system-ui;display:flex;gap:8px;align-items:center';
    ui.innerHTML =
      '<button id="__recmark" style="all:unset;cursor:pointer;background:rgba(35,38,45,.95);color:#ffd76a;' +
        'padding:10px 12px;border-radius:10px;display:none">◉ MARK</button>' +
      '<div id="__recinfo" style="background:rgba(20,22,26,.92);color:#aab3c2;padding:10px 12px;' +
        'border-radius:10px;display:none;font:600 13px ui-monospace,monospace"></div>' +
      '<button id="__recbtn" style="all:unset;cursor:pointer;background:#b3261e;color:#fff;padding:12px 18px;' +
        'border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.45)">⏺ REC</button>';
    document.body.appendChild(ui);
    const btn = ui.querySelector('#__recbtn'), info = ui.querySelector('#__recinfo'), mark = ui.querySelector('#__recmark');
    let mode = 'idle', revealed = false, inCorner = false, cornerT = 0;
    const fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const render = (s) => {
      mode = s.phase;
      if (s.phase === 'rec') {
        ui.style.display = revealed ? 'flex' : 'none';
        btn.textContent = '⏹ STOP'; btn.style.background = '#3a3f49';
        mark.style.display = 'inline-block'; info.style.display = 'block';
        info.textContent = '● ' + fmt(s.secs) + ' · ' + s.gb.toFixed(1) + 'GB · ◉' + s.marks + ' · free ' + s.free.toFixed(0) + 'GB';
      } else {
        revealed = false;
        ui.style.display = 'flex';
        mark.style.display = 'none';
        if (s.phase === 'idle') {
          btn.textContent = '⏺ REC'; btn.style.background = '#b3261e';
          info.style.display = s.last ? 'block' : 'none'; info.textContent = s.last || '';
        } else {
          btn.textContent = s.phase === 'stitching' ? '⌛ STITCHING' : '⛏ MINING';
          btn.style.background = 'rgba(35,38,45,.95)'; info.style.display = 'none';
        }
      }
    };
    btn.onclick = async () => {
      if (mode === 'idle') {
        ui.style.display = 'none';
        await new Promise(r => setTimeout(r, 450));
        window.__recCmd('start');
      } else if (mode === 'rec') { revealed = false; window.__recCmd('stop'); }
    };
    mark.onclick = () => window.__recCmd('mark');
    addEventListener('mousemove', (e) => {
      inCorner = (innerWidth - e.clientX < 190) && (innerHeight - e.clientY < 100);
      if (inCorner && mode === 'rec' && !revealed && !cornerT) {
        cornerT = setTimeout(() => { if (inCorner && mode === 'rec') { revealed = true; ui.style.display = 'flex'; } cornerT = 0; }, 600);
      }
      if (!inCorner) {
        if (cornerT) { clearTimeout(cornerT); cornerT = 0; }
        if (revealed && mode === 'rec') { revealed = false; ui.style.display = 'none'; }
      }
    });
    setInterval(async () => { try { render(await window.__recCmd('status')); } catch { /* node gone */ } }, 1000);
  };
  if (document.readyState !== 'loading') boot();
  else addEventListener('DOMContentLoaded', boot);
});

await page.goto(URL, { waitUntil: 'networkidle2' });
if (URL.includes('localhost:8891')) {
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 })
    .catch(() => console.log('· board still connecting (fine for solo play)'));
}
// One window, one page: close anything else (crash-restored tabs etc.).
for (const p of await browser.pages()) if (p !== page) await p.close().catch(() => {});

const client = await page.createCDPSession();
client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  if (rec) {
    const file = `f${String(rec.frameN++).padStart(6, '0')}.jpg`;
    writeFileSync(join(rec.tmp, file), Buffer.from(data, 'base64'));
    const t = metadata.timestamp || Date.now() / 1000;
    if (rec.firstT === null) rec.firstT = t;
    rec.pending.push({ file, t });
    if (rec.pending.length >= CHUNK_FRAMES) rollChunk(rec);
  }
  try { await client.send('Page.screencastFrameAck', { sessionId }); } catch { /* teardown race */ }
});

setInterval(async () => {
  try {
    const m = await page.evaluate(() => { const x = window.__marks || []; window.__marks = []; return x; });
    if (rec) for (const t of m) { rec.markers.push(t / 1000); console.log('· ◉ marked'); }
  } catch { /* page mid-nav or gone */ }
}, 2500);

// ── start / stop ──────────────────────────────────────────────────────
async function startRec() {
  if (phase !== 'idle') return;
  rec = mkTake();
  phase = 'rec';
  lastMsg = '';
  await client.send('Page.startScreencast', {
    format: 'jpeg', quality: 85, maxWidth: 1920, maxHeight: 1200, everyNthFrame: NTH,
  });
  console.log(`\n● RECORDING → ${rec.dir}`);
}

function stopRec() {
  if (phase !== 'rec' || !rec) return finalizing;
  const t = rec;
  rec = null;
  phase = 'stitching';
  console.log('\n· ⏹ stopped — stitching …');
  finalizing = (async () => {
    try { await client.send('Page.stopScreencast'); } catch { /* gone */ }
    await sleep(400);
    rollChunk(t, true);
    await t.encodeQ;
    if (t.segN === 0) {
      rmSync(t.dir, { recursive: true, force: true });
      lastMsg = 'take was empty (no frames)';
      phase = 'idle';
      return;
    }
    const list = Array.from({ length: t.segN }, (_, i) => `file 'segs/seg_${String(i).padStart(3, '0')}.mp4'`).join('\n');
    writeFileSync(join(t.dir, 'segs.txt'), list + '\n');
    await ff(['-y', '-f', 'concat', '-safe', '0', '-i', 'segs.txt', '-c', 'copy',
      '-movflags', '+faststart', 'session.mp4'], { cwd: t.dir });
    rmSync(join(t.dir, 'segs.txt'), { force: true });
    rmSync(t.segs, { recursive: true, force: true });
    rmSync(t.tmp, { recursive: true, force: true });
    writeFileSync(join(t.dir, 'meta.json'), JSON.stringify({
      startedWall: new Date(t.wall0).toISOString(),
      frames: t.frameN, url: URL,
      markers: t.markers.map(x => Number((x - t.firstT).toFixed(2))).filter(x => x >= 0),
    }, null, 2) + '\n');
    console.log(`✓ ${join(t.dir, 'session.mp4')}`);
    if (!NO_MINE) {
      phase = 'mining';
      await new Promise(r => spawn('node', [join(ROOT, 'tools', 'mine-session.mjs'), t.dir],
        { stdio: 'inherit' }).on('close', r));
      let n = 0;
      try { n = readdirSync(join(t.dir, 'candidates')).filter(f => f.endsWith('.mp4')).length; } catch { /* none */ }
      lastMsg = `✓ ${n} clips — folder opened`;
      if (!TEST) spawn('open', [join(t.dir, 'candidates')], { stdio: 'ignore' }).unref();
    } else {
      lastMsg = `✓ saved ${t.dir.split('/').pop()}`;
    }
    phase = 'idle';
  })().catch(e => { console.error(`✗ finalize: ${e.message}`); lastMsg = `✗ ${e.message}`; phase = 'idle'; });
  return finalizing;
}

// ── shutdown ──────────────────────────────────────────────────────────
let closing = false;
async function shutdown(why) {
  if (closing) return; closing = true;
  console.log(`\n· shutting down (${why})`);
  await stopRec();
  await finalizing;
  try { await browser.close(); } catch { /* gone */ }
  process.exit(0);
}
page.on('close', () => shutdown('game window closed'));
browser.on('disconnected', () => shutdown('chrome quit'));
process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('terminated'));

if (TEST) {
  let i = 0;
  setInterval(() => {
    const x = 400 + 1100 * Math.abs(Math.sin(i / 9)); i++;
    client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 600 + 200 * Math.sin(i / 5) }).catch(() => {});
  }, 150);
  await startRec();
  setTimeout(() => shutdown('test timer'), TEST_SECS * 1000);
} else {
  console.log('\n● READY — hit the red ⏺ REC pill (bottom-right of the game) and play.');
  console.log('    while recording: mouse to the bottom-right corner reveals ⏹ STOP');
  console.log('    ` (backtick) = bookmark a cool moment · takes auto-mine into Finder');
}
