#!/usr/bin/env node
/**
 * FAVOR — highlight miner for live-play footage sessions.
 *
 * Reads sessions/<stamp>/session.mp4 (from record-session.mjs) and surfaces
 * the moments worth cutting into ads:
 *
 *   1. every ` bookmark you tapped while playing (meta.json markers) —
 *      the window ENDS just after the mark, since you tap after the cool
 *      thing happens;
 *   2. the highest-motion stretches — frame-difference energy sampled at
 *      2 Hz finds throw flights, melee cinematics, ceremonies, floats.
 *
 * Each candidate becomes a small preview clip in candidates/ (QuickLook
 * them in Finder), beside sheet.png — the whole session as a timestamped
 * thumbnail wall — and notes.md with the export command for each pick.
 *
 *   node tools/mine-session.mjs marketing/footage/sessions/<stamp> [--top N] [--len S]
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'fs';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argPath = process.argv[2];
if (!argPath) { console.error('usage: node tools/mine-session.mjs <session dir | session.mp4> [--top N] [--len S]'); process.exit(1); }
const opt = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
const TOP = opt('--top', 14);
const LEN = opt('--len', 12);

const SESS = statSync(argPath).isDirectory() ? argPath : dirname(argPath);
const MP4 = join(SESS, 'session.mp4');
const CAND = join(SESS, 'candidates');
if (!existsSync(MP4)) { console.error(`✗ no session.mp4 in ${SESS}`); process.exit(1); }
const meta = existsSync(join(SESS, 'meta.json')) ? JSON.parse(readFileSync(join(SESS, 'meta.json'), 'utf8')) : {};
rmSync(CAND, { recursive: true, force: true });
mkdirSync(CAND, { recursive: true });

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, opts);
    let out = '', err = '';
    p.stdout?.on('data', d => out += d);
    p.stderr?.on('data', d => err += d);
    p.on('close', c => c === 0 ? res(out) : rej(new Error(`${cmd} failed: ${err.slice(-400)}`)));
  });
}
const ff = (args, opts) => run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], opts);
const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}m${String(Math.round(t % 60)).padStart(2, '0')}s`;

const DUR = Number(await run('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration',
  '-of', 'default=nw=1:nk=1', MP4]));
console.log(`· session: ${(DUR / 60).toFixed(1)} min — sampling activity …`);

// ── activity curve: mean abs pixel change across each half second ─────
const actFile = join(SESS, '.activity.txt');
await ff(['-i', MP4, '-vf',
  `fps=2,scale=192:108,format=gray,tblend=all_mode=difference,signalstats,` +
  `metadata=print:key=lavfi.signalstats.YAVG:file=${actFile}`, '-f', 'null', '-']);
const samples = [];   // { t, act }
{
  let t = null;
  for (const line of readFileSync(actFile, 'utf8').split('\n')) {
    const mt = line.match(/pts_time:([\d.]+)/);
    if (mt) { t = Number(mt[1]); continue; }
    const ma = line.match(/YAVG=([\d.]+)/);
    if (ma && t !== null) { samples.push({ t, act: Number(ma[1]) }); t = null; }
  }
  rmSync(actFile, { force: true });
}
// Light smoothing so one-frame flashes don't outrank sustained action.
const act = samples.map((s, i) => {
  const w = samples.slice(Math.max(0, i - 2), i + 3);
  return { t: s.t, v: w.reduce((a, x) => a + x.act, 0) / w.length };
});
const sorted = [...act.map(a => a.v)].sort((a, b) => a - b);
const base = sorted[Math.floor(sorted.length / 2)] || 0;

// ── pick windows: bookmarks first, then top motion, no overlaps ───────
const picks = [];
const overlaps = (t0) => picks.some(p => Math.abs(p.t0 - t0) < LEN * 0.75);
for (const m of meta.markers || []) {
  const t0 = Math.max(0, Math.min(m - LEN + 2, DUR - LEN));   // window ends ~2s past the tap
  if (!overlaps(t0)) picks.push({ t0, kind: 'mark', score: Infinity });
}
const W = Math.max(2, Math.round(LEN * 2));
const scored = [];
for (let i = 0; i + W < act.length; i += 2) {
  scored.push({ t0: act[i].t, score: act.slice(i, i + W).reduce((a, x) => a + x.v, 0) / W });
}
scored.sort((a, b) => b.score - a.score);
const floor = Math.max(3, Math.min(TOP, Math.floor(DUR / LEN)));
for (const s of scored) {
  if (picks.length >= TOP) break;
  if (overlaps(s.t0)) continue;
  if (s.score < base * 1.25 && picks.length >= floor) break;
  picks.push({ t0: s.t0, kind: 'auto', score: s.score });
}
picks.sort((a, b) => (b.score === a.score ? a.t0 - b.t0 : b.score - a.score));

// ── contact sheet: the whole session at a glance, one thumb per 15 s ──
const thumbs = Math.max(1, Math.ceil(DUR / 15));
const rows = Math.ceil(thumbs / 10);
const label = `drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text=%{pts\\:hms}:` +
  `fontsize=16:fontcolor=white:box=1:boxcolor=black@0.55:x=4:y=h-20`;
const tile = `fps=1/15,scale=213:120,${label},tile=10x${rows}:padding=2:color=0x101010`;
await ff(['-i', MP4, '-vf', tile, '-frames:v', '1', join(SESS, 'sheet.png')])
  .catch(() => ff(['-i', MP4, '-vf', `fps=1/15,scale=213:120,tile=10x${rows}:padding=2:color=0x101010`,
    '-frames:v', '1', join(SESS, 'sheet.png')]));

// ── preview clips (2 s pre-roll for context) ──────────────────────────
const lines = [`# ${SESS.split('/').pop()} — candidates`, '',
  meta.startedWall ? `Recorded ${meta.startedWall} · ${(DUR / 60).toFixed(1)} min · ${picks.length} candidates` : '', ''];
let n = 0;
for (const p of picks) {
  n++;
  const start = Math.max(0, p.t0 - 2);
  const clipLen = Math.min(LEN + 3.5, DUR - start);
  const name = `${String(n).padStart(2, '0')}_${p.kind}_${mmss(p.t0)}.mp4`;
  await ff(['-ss', start.toFixed(2), '-i', MP4, '-t', clipLen.toFixed(2),
    '-vf', 'scale=960:-2', '-an', '-c:v', 'h264_videotoolbox', '-b:v', '3M',
    '-movflags', '+faststart', join(CAND, name)]);
  const tag = p.kind === 'mark' ? '◉ your bookmark' : `motion ${p.score.toFixed(1)} (base ${base.toFixed(1)})`;
  lines.push(`- **${name}** — ${mmss(p.t0)}–${mmss(p.t0 + LEN)} · ${tag}`,
    `  export: \`node tools/export-shot.mjs ${SESS} ${p.t0.toFixed(1)} ${LEN} <shotname>\``);
  console.log(`· ${name}  ${tag}`);
}
lines.push('', 'Review: QuickLook the clips, note keepers, then export each as a shot and',
  'add a row to marketing/applovin/build_ads.sh — same grammar as the staged scenes.');
writeFileSync(join(CAND, 'notes.md'), lines.filter(l => l !== null).join('\n') + '\n');
console.log(`✓ ${picks.length} candidates → ${CAND}`);
console.log(`✓ session overview → ${join(SESS, 'sheet.png')}`);
