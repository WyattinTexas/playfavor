#!/usr/bin/env node
// ═══ telemetry-pull — export favor/telemetry/games to local JSONL ═══════════
//
// Phase 3's input (Hard-AI program): pages the transcript set down over the
// RTDB REST API (orderBy $key, batches of PAGE) and writes one game per line
// to data/telemetry/games-<stamp>.jsonl (gitignored — the truth stays in
// Firebase). Prints counts by mode and hero so the growth of the training
// set is watchable at a glance.
//
//   node tools/telemetry-pull.mjs                  # full export
//   node tools/telemetry-pull.mjs --out somewhere  # different directory
//   node tools/telemetry-pull.mjs --max 500        # cap (spot checks)
//
// Exit code 0 even when the set is empty — an empty set is a fact, not a
// failure. Anything HTTP is a real failure and exits 1.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DB = 'https://testroom-75200-default-rtdb.firebaseio.com';
const PATH = 'favor/telemetry/games';
const PAGE = 200;

const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const outDir = arg('--out', join(process.cwd(), 'data', 'telemetry'));
const maxGames = Number(arg('--max', Infinity)) || Infinity;

async function fetchPage(startAfterKey) {
    // orderBy $key needs no .indexOn; startAt is INCLUSIVE, so pages after
    // the first re-fetch their pivot row and we drop it client-side.
    let url = `${DB}/${PATH}.json?orderBy=${encodeURIComponent('"$key"')}&limitToFirst=${PAGE}`;
    if (startAfterKey) url += `&startAt=${encodeURIComponent(JSON.stringify(startAfterKey))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RTDB ${res.status} ${res.statusText} on ${url}`);
    return (await res.json()) || {};
}

const rows = [];          // [key, game]
let lastKey = null;
let bytes = 0;
for (;;) {
    const page = await fetchPage(lastKey);
    const keys = Object.keys(page).sort();     // RTDB push keys sort chronologically
    const fresh = keys.filter(k => k !== lastKey);
    if (!fresh.length) break;
    for (const k of fresh) {
        rows.push([k, page[k]]);
        bytes += JSON.stringify(page[k]).length;
    }
    lastKey = keys[keys.length - 1];
    process.stdout.write(`\r  fetched ${rows.length} game(s)…`);
    if (rows.length >= maxGames) break;
    if (keys.length < PAGE) break;   // short page = the set's end
}
console.log(`\r  fetched ${rows.length} game(s)   `);

mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const outFile = join(outDir, `games-${stamp}.jsonl`);
writeFileSync(outFile, rows.map(([k, g]) => JSON.stringify({ _key: k, ...g })).join('\n') + (rows.length ? '\n' : ''));

// ── The glanceable report ────────────────────────────────────────────────
const count = (fn) => rows.reduce((m, [, g]) => {
    const k = fn(g) || '?';
    m[k] = (m[k] || 0) + 1;
    return m;
}, {});
const fmt = (m) => Object.entries(m).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}:${n}`).join('  ') || '(none)';

const humanSeat = (g) => (g.seats || []).find(s => s.kind === 'human');
console.log(`\nTELEMETRY PULL — ${rows.length} game(s), ${(bytes / 1024).toFixed(1)} KB in RTDB`);
console.log(`  by mode:  ${fmt(count(g => g.mode))}`);
console.log(`  by hero:  ${fmt(count(g => (humanSeat(g) || {}).hero))}   (human seat)`);
console.log(`  resumed:  ${rows.filter(([, g]) => g.resumed).length}   booted-seat games: ${rows.filter(([, g]) => g.result && g.result.booted).length}`);
const withElo = rows.filter(([, g]) => humanSeat(g) && typeof humanSeat(g).elo === 'number');
console.log(`  human elo present: ${withElo.length}/${rows.length}`);
console.log(`  → ${outFile}`);
