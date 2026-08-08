#!/usr/bin/env node
/**
 * FAVOR — turn a chosen moment of live-play footage into a builder-native
 * shot: 1920×1080 full-range JPEGs + frames.txt (the trailer rig's exact
 * format) under marketing/applovin/frames/<shotname>/, ready for a row in
 * marketing/applovin/build_ads.sh.
 *
 *   node tools/export-shot.mjs <session dir | session.mp4> <start> <len> <shotname>
 *
 * start = seconds (72.5) or mm:ss (1:12.5). Sessions capture at the
 * display's native size; anything off-1920×1080 is scaled-and-center-
 * cropped here so the builder's 607px pan windows always mean the same
 * thing.
 */
import { readdirSync, writeFileSync, mkdirSync, rmSync, statSync } from 'fs';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [, , src, startArg, lenArg, shot] = process.argv;
if (!src || !startArg || !lenArg || !shot || !/^[a-z0-9_]+$/i.test(shot)) {
  console.error('usage: node tools/export-shot.mjs <session dir | session.mp4> <start s|mm:ss> <len s> <shotname>');
  process.exit(1);
}
const MP4 = statSync(src).isDirectory() ? join(src, 'session.mp4') : src;
const start = startArg.includes(':')
  ? startArg.split(':').reduce((a, x) => a * 60 + Number(x), 0)
  : Number(startArg);
const len = Number(lenArg);
const DIR = join(ROOT, 'marketing', 'applovin', 'frames', shot);
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

await new Promise((res, rej) => {
  const p = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', start.toFixed(3), '-i', MP4, '-t', len.toFixed(3),
    '-vf', 'fps=30,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,' +
           'scale=in_range=tv:out_range=full',
    '-q:v', '2', join(DIR, 'f%05d.jpg')]);
  let err = ''; p.stderr.on('data', d => err += d);
  p.on('close', c => c === 0 ? res() : rej(new Error(err.slice(-400))));
});

const frames = readdirSync(DIR).filter(f => f.endsWith('.jpg')).sort();
if (frames.length < 30) { console.error(`✗ only ${frames.length} frames came out — window off the end?`); process.exit(1); }
const lines = [];
const D = (1 / 30).toFixed(4);
for (let i = 0; i < frames.length - 1; i++) lines.push(`file '${frames[i]}'`, `duration ${D}`);
lines.push(`file '${frames[frames.length - 1]}'`, 'duration 0.2', `file '${frames[frames.length - 1]}'`);
writeFileSync(join(DIR, 'frames.txt'), lines.join('\n') + '\n');
console.log(`✓ ${shot}: ${frames.length} frames (${(frames.length / 30).toFixed(1)}s usable) → ${DIR}`);
console.log(`  build row:  X_YourAd |${shot} |15 |58.00 |pan 656 656   (tune len/music/treatment)`);
