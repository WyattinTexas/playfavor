#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// THRONE ROOM draw probe — the 9:18 partition, exercised dry.
//
// Loads js/mp.js with a stub window (the engine-smoke idiom) and
// drives FMP._thronePartition — the PURE, dateKey-seeded partition the
// draw claimant runs — at every awkward hall size the design doc names
// (1, 2, 3, 4, 5, 6, 7, 8, 9, 13). Asserts the partition LAW:
//
//   · every table seats 4 or 5;
//   · AI fill marks ONLY the remainder table (1–3 leftover humans in a
//     4-seat frame) — full tables are full of humans;
//   · every fresh uid is seated exactly once — nobody left standing,
//     nobody cloned;
//   · seeded determinism — the same dateKey names the same tables on
//     every run and every load (a claim-txn retry, or two clients
//     racing, must agree), and a different night shuffles differently.
//
// Run: node tools/probe-throne-draw.mjs   (from the repo root)
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function ok(cond, label) {
    if (cond) { passed++; console.log(`  ✓ ${label}`); }
    else { failed++; console.log(`  ✗ ${label}`); }
}

// ── Load mp.js against a stub window (no firebase, no DOM) ──────────
function loadPartition() {
    const src = readFileSync(join(ROOT, 'js', 'mp.js'), 'utf8');
    const window = {};
    const document = { readyState: 'complete', addEventListener() {} };
    const noop = () => 0;
    new Function('window', 'document', 'localStorage',
        'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        src)(window, document, { getItem: () => null, setItem() {} },
        noop, noop, noop, noop);
    if (!window.FMP || typeof window.FMP._thronePartition !== 'function') {
        throw new Error('FMP._thronePartition missing — is the probe seam exported?');
    }
    return window.FMP._thronePartition;
}

const partition = loadPartition();
const KEY = '2026-08-03';
const uidsOf = (n) => Array.from({ length: n }, (_, i) => `noble_${String(i + 1).padStart(2, '0')}`);

console.log('═══ THRONE DRAW PROBE — partition law at every hall size ═══');

for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 13]) {
    const uids = uidsOf(n);
    const games = partition(uids, KEY);
    console.log(`\n── ${n} in the hall → ${games.map(g =>
        `${g.uids.length}${g.ai ? `+${g.size - g.uids.length}AI` : ''}`).join(' · ') || 'no games'} ──`);

    ok(games.every(g => g.size === 4 || g.size === 5),
        'every table seats 4 or 5');
    ok(games.filter(g => g.ai).length <= 1,
        'at most one AI-filled table');
    ok(games.every(g => g.ai
            ? (g.uids.length >= 1 && g.uids.length <= 3 && g.size === 4)
            : g.uids.length === g.size),
        'AI fill ONLY on the remainder (1–3 humans in a 4-seat frame); full tables all-human');
    const seated = games.flatMap(g => g.uids);
    ok(seated.length === n && new Set(seated).size === n
        && seated.every(u => uids.includes(u)),
        'every fresh uid seated exactly once');
    if (n >= 1 && n <= 3) {
        ok(games.length === 1 && games[0].ai === true,
            `${n} alone → one Hard-AI remainder table`);
    }
    if (n === 4) ok(games.length === 1 && !games[0].ai, '4 → one full human table, no AI');
    if (n === 5) ok(games.length === 1 && games[0].size === 5 && !games[0].ai,
        '5 → one full table of 5 (never strand a human when a clean split exists)');
    if (n === 9) ok(games.length === 2 && games.every(g => !g.ai),
        '9 → two full human tables (5+4 in some order)');

    // Determinism inside one load — a txn retry replays the same answer.
    ok(JSON.stringify(partition(uids, KEY)) === JSON.stringify(games),
        'same night, same tables (in-load determinism)');
}

// ── Cross-load determinism — two clients racing the claim agree ────
{
    const other = loadPartition();
    const a = JSON.stringify(partition(uidsOf(13), KEY));
    const b = JSON.stringify(other(uidsOf(13), KEY));
    console.log('\n── two independent loads, one night ──');
    ok(a === b, 'a fresh load (a racing client) deals the identical draw');

    const c = JSON.stringify(partition(uidsOf(13), '2026-08-04'));
    ok(a !== c, 'a different night shuffles differently');

    // Input order must not matter — the claimant sorts before shuffling.
    const scrambled = uidsOf(13).reverse();
    ok(JSON.stringify(partition(scrambled, KEY)) === a,
        'lobby read order is irrelevant (sorted before the seeded shuffle)');

    // The empty hall: the draw claims quietly and the night settles.
    ok(partition([], KEY).length === 0, 'an empty hall partitions to no games');
}

console.log(`\n${failed ? '❌' : '✅'} ${passed} checks passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
