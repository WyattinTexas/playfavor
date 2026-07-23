#!/usr/bin/env node
// ═══ probe-telemetry — Phase 1 verification (Hard-AI program) ═══════════════
//
// Plays REAL full games through the real UI (no rigs, no telemetry-off flag)
// and proves the transcript pipeline end to end:
//
//   node tools/probe-telemetry.mjs skirmish [url]   # solo table, seeded deal
//   node tools/probe-telemetry.mjs rival    [url]   # stamps mode:'rival'
//   node tools/probe-telemetry.mjs mp       [url]   # 2-context private room —
//                                                   # HOST uploads, joiner not
//
// Each run asserts: exactly ONE new row lands in favor/telemetry/games, the
// payload is well-formed (seats/decisions/result), and — for solo — the
// recorded seed RE-DEALS the exact hands the pick rows captured (the replay
// guarantee). Every run scrubs its own residue: telemetry row, players rows,
// daily scores, mp game + room. Default url http://localhost:8891 (start
// `python3 -m http.server 8891` in the repo root).
import puppeteer from 'puppeteer-core';

const MODE = process.argv[2] || 'skirmish';
const URL = process.argv[3] || 'http://localhost:8891/';
// --keep leaves the game's telemetry row in place (the production-proof
// transcript the pull tool round-trips); players/daily residue still scrubs.
const KEEP = process.argv.includes('--keep');
const DB = 'https://testroom-75200-default-rtdb.firebaseio.com';
const SHOT_DIR = process.env.TELPROBE_SHOTS || '/tmp';

let pass = 0, fail = 0;
const ok = (c, l, d = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${l}${c ? '' : '  ← ' + d}`); };
const telKeys = async () => Object.keys(
    (await (await fetch(`${DB}/favor/telemetry/games.json?shallow=true`)).json()) || {});
const rm = (p) => fetch(`${DB}/favor/${p}.json`, { method: 'DELETE' });

const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', args: ['--mute-audio'],
});

const consoleErrs = [];
async function mkPage(uid, name) {
    const ctx = await (browser.createBrowserContext
        ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
    const pg = await ctx.newPage();
    pg.on('pageerror', e => consoleErrs.push(`[${name}] PAGEERROR: ${e.message}`));
    pg.on('console', m => { if (m.type() === 'error') consoleErrs.push(`[${name}] ${m.text().slice(0, 160)}`); });
    await pg.evaluateOnNewDocument((u, n) => {
        localStorage.setItem('favorUid', u);
        localStorage.setItem('favorName', n);
        localStorage.setItem('favorQueue', '3');
        localStorage.setItem('favor_coach_seen', JSON.stringify(
            ['welcome', 'missions', 'hand', 'skills', 'pass', 'rivals',
             'scorn', 'favor', 'ring', 'melee', 'emblem']));
        // NOT favorTelemetryOff — the upload is exactly what this probe tests.
    }, uid, name);
    await pg.setViewport({ width: 1280, height: 800 });
    await pg.goto(URL, { waitUntil: 'networkidle2' });
    await pg.waitForFunction(() => window.FLB && FLB.mode === 'firebase', { timeout: 20000 });
    await pg.evaluate(() => { window.CINEMATIC_SPEED = 0.03; });
    return pg;
}

// One tick of "a player who always discards": throw the first card, resolve
// the reveal with the +3g discard, click through any chooser overlay. Human
// depth isn't the point — the RECORDING of every seat is.
function tick() {
    try {
        const x = document.querySelector('.coach-x');
        if (x && x.offsetParent) x.click();
        if (document.getElementById('scoring-screen').classList.contains('active')) return { done: true };
        if (typeof game === 'undefined' || !game) return { nogame: true };

        const pp = document.getElementById('promisePicker');
        if (pp && pp.classList.contains('active')) {
            const btns = [...pp.querySelectorAll('.btn-royal')].filter(b => !b.disabled && b.offsetParent);
            const b = btns.find(q => q.classList.contains('primary')) || btns[0];
            if (b) b.click();
            else { const t = pp.querySelector('.pp-inner [class*="tile"], .pp-inner [class*="card"]'); if (t) t.click(); }
        }
        const panel = document.getElementById('actionPanel');
        if (panel && panel.classList.contains('active')) {
            const btns = [...panel.querySelectorAll('.action-btn')].filter(b => !b.disabled && b.offsetParent);
            const d = btns.find(q => /discard \(\+3g\)/i.test(q.textContent))
                || btns.find(q => /discard/i.test(q.textContent));
            if (d) d.click();
        }
        if (game.phase === 'gameplay') {
            if (!game.pendingActivations[0] && game.players[0].hand.length
                && (!window._throwUx || !window._throwUx.locked)) throwCard(0);
            if (!(window.FMP && FMP.active())) {
                for (let s = 1; s < game.playerCount; s++) {
                    if (game.pendingActivations[s] === null && game.players[s].hand.length) aiPickCard(s);
                }
                maybeLockThrows();
            }
        }
        return { act: game.currentAct, phase: game.phase, n: window.FTEL ? FTEL.decisionCount() : -1 };
    } catch (e) { return { err: String(e) }; }
}

async function playToScoring(pg, label, timeoutMs = 300000) {
    const t0 = Date.now();
    let lastN = -1, lastMove = Date.now();
    for (;;) {
        const st = await pg.evaluate(tick);
        if (st.done) return true;
        if (st.err) console.log(`  [${label}] tick err: ${st.err}`);
        if (st.n !== lastN) { lastN = st.n; lastMove = Date.now(); }
        if (Date.now() - lastMove > 45000 || Date.now() - t0 > timeoutMs) {
            const shot = `${SHOT_DIR}/telprobe-stall-${label}.png`;
            await pg.screenshot({ path: shot });
            console.log(`  [${label}] STALLED at`, JSON.stringify(st), '→', shot);
            return false;
        }
        await new Promise(r => setTimeout(r, 300));
    }
}

const heroPick = async (pg, last = false) => {
    await pg.waitForFunction(() => document.getElementById('character-select').classList.contains('active')
        && document.querySelectorAll('.character-card').length > 0, { timeout: 20000 });
    await pg.evaluate((l) => {
        const cs = [...document.querySelectorAll('.character-card')];
        const c = l ? cs[cs.length - 1] : cs[0];
        selectCharacter(c.dataset.id, c);
        document.getElementById('confirmBtn').click();
    }, last);
};

// Offline replay: the recorded seed + heroes must re-deal the exact Act-1
// hands the pick rows captured. Loads the engine the engine-smoke way.
async function replayMatches(payload) {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const src = (p) => readFileSync(join(root, p), 'utf8');
    const w = {};
    const FavorGame = new Function('window',
        src('data/cards.js') + '\n' + src('data/missions.js') + '\n' +
        src('data/characters.js') + '\n' + src('data/achievements.js') + '\n' +
        src('engine/gameState.js') + '\nreturn FavorGame;')(w);
    const g = new FavorGame(payload.size);
    g.setSeed(payload.seed);
    g.loadDecks();
    g.initPlayers(payload.seats.map(s => ({ characterId: s.hero, playerName: s.name, side: s.side })));
    g.startAct(1);
    for (const s of payload.seats) {
        const dealt = g.players[s.cs].hand.map(c => c.name).join('|');
        const firstPick = payload.decisions.find(d => d.t === 'pick' && d.cs === s.cs && d.act === 1 && d.round === 0);
        if (!firstPick || !firstPick.hand) return `seat ${s.cs}: no act1/round0 pick row with a hand`;
        if (firstPick.hand.join('|') !== dealt) return `seat ${s.cs}: dealt [${dealt}] ≠ recorded [${firstPick.hand.join('|')}]`;
    }
    return true;
}

function assertPayload(p, wantMode, label) {
    ok(!!p, `${label}: payload exists`);
    if (!p) return;
    ok(p.tv === 1 && typeof p.build !== 'undefined', `${label}: tv 1, build ${p.build}`);
    ok(p.mpv === 22, `${label}: mpv 22`, String(p.mpv));
    ok(p.mode === wantMode, `${label}: mode '${p.mode}'`, `wanted '${wantMode}'`);
    ok(Array.isArray(p.seats) && p.seats.length === p.size, `${label}: ${p.seats.length}/${p.size} seat rows`);
    ok(p.seats.every(s => s.hero && s.name && typeof s.cs === 'number'), `${label}: every seat has cs/hero/name`);
    const picks = p.decisions.filter(d => d.t === 'pick');
    const actStarts = p.decisions.filter(d => d.t === 'act_start').map(d => d.act);
    ok(actStarts.join(',') === '1,2,3', `${label}: act_start rows 1,2,3`, actStarts.join(','));
    ok(picks.length >= p.size * 10, `${label}: ${picks.length} pick rows (≥${p.size * 10})`);
    ok(picks.every(d => Array.isArray(d.hand) ? d.hand.includes(d.picked) : typeof d.picked === 'string'),
        `${label}: every pick names a card from its hand`);
    ok(p.seats.every(s => picks.some(d => d.cs === s.cs)), `${label}: pick rows for every seat`);
    const acts = p.decisions.filter(d => d.t === 'act');
    ok(acts.length >= p.size * 10, `${label}: ${acts.length} activation rows`);
    ok(acts.every(d => d.ctx && typeof d.ctx.gold === 'number'), `${label}: activations carry ctx`);
    ok(p.decisions.some(d => d.t === 'missions_resolve'), `${label}: missions_resolve present`);
    ok(p.result && p.result.rows.length === p.size
        && p.result.rows.every(r => typeof r.finalScore === 'number'),
        `${label}: result rows with finalScores`);
    ok(Array.isArray(p.result.placements) && p.result.placements.length === p.size,
        `${label}: placements`);
    ok(JSON.stringify(p).length <= 26000, `${label}: payload ${JSON.stringify(p).length}B ≤ cap`);
}

async function scrub(uids, telKey) {
    if (telKey && !KEEP) await rm(`telemetry/games/${telKey}`);
    if (telKey && KEEP) console.log(`  (kept transcript ${telKey})`);
    for (const u of uids) {
        await rm(`players/${u}`);
        const days = Object.keys((await (await fetch(`${DB}/favor/daily.json?shallow=true`)).json()) || {});
        for (const d of days) await rm(`daily/${d}/scores/${u}`);
    }
}

const stampUid = (tag) => `uaudit-tel${tag}${Math.random().toString(36).slice(2, 6)}`;
console.log(`\nTELEMETRY PROBE — ${MODE} @ ${URL}`);
const before = await telKeys();

if (MODE === 'skirmish' || MODE === 'rival') {
    const uid = stampUid(MODE[0]);
    const pg = await mkPage(uid, 'Tel Probe');
    if (MODE === 'skirmish') {
        await pg.evaluate(() => { FMODES.openSkirmish(); FMODES.beginSkirmish(3); });
    } else {
        await pg.evaluate(() => { FMODES.openDailyRival(); FMODES.beginRivalGame(); });
    }
    await heroPick(pg);
    await pg.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 20000 });
    ok(await pg.evaluate(() => window.FTEL && FTEL.active()), 'FTEL transcript opened at the table');
    const done = await playToScoring(pg, MODE);
    ok(done, 'played a REAL full game to the victory screen');

    const payload = await pg.evaluate(() => FTEL.payloadPreview());
    assertPayload(payload, MODE === 'rival' ? 'rival' : 'skirmish', MODE);
    ok(typeof payload.seed === 'number', `solo table is seeded (${payload.seed})`);
    ok(payload.seats[0].uid === uid, 'seat 0 carries the player uid');
    if (MODE === 'rival') {
        const rSeat = payload.seats.find(s => s.kind === 'rival');
        ok(!!rSeat, `the rival seat is stamped kind:'rival' (${rSeat && rSeat.name})`);
    } else {
        ok(payload.seats.filter(s => s.kind === 'bot').length === 2, 'skirmish table: 2 bot seats, no personas');
    }
    const rep = await replayMatches(payload);
    ok(rep === true, 'REPLAY: recorded seed re-deals the exact recorded hands', String(rep));

    await new Promise(r => setTimeout(r, 2500));   // the fire-and-forget push
    const after = await telKeys();
    const fresh = after.filter(k => !before.includes(k));
    ok(fresh.length === 1, `exactly ONE transcript landed (${fresh.length})`);
    if (fresh.length === 1) {
        const row = await (await fetch(`${DB}/favor/telemetry/games/${fresh[0]}.json`)).json();
        ok(row && row.seed === payload.seed && row.decisions.length === payload.decisions.length,
            'the Firebase row IS the payload (seed + decision count match)');
    }
    await scrub([uid], fresh[0]);
    await pg.browserContext().close();
} else if (MODE === 'mp') {
    const uidA = stampUid('a'), uidB = stampUid('b');
    const A = await mkPage(uidA, 'Probe A');
    const B = await mkPage(uidB, 'Probe B');
    await A.evaluate(() => { FMODES.openPrivateRoom(); FMODES.hostRoom(); });
    await A.waitForFunction(() => document.querySelector('#roomOverlay .rm-code'), { timeout: 15000 });
    const code = await A.evaluate(() => document.querySelector('#roomOverlay .rm-code').textContent.trim());
    console.log(`  room ${code}`);
    await B.evaluate((c) => { FMODES.openPrivateRoom(); document.getElementById('rmCode').value = c; FMODES.joinRoom(); }, code);
    await Promise.all([A, B].map(pg => pg.waitForFunction(
        () => document.querySelectorAll('#roomOverlay .rm-row:not(.open)').length === 2, { timeout: 15000 })));
    await A.evaluate(() => FMODES.startRoomGame());
    await heroPick(A);
    await heroPick(B, true);
    await Promise.all([A, B].map(pg => pg.waitForFunction(
        () => typeof game !== 'undefined' && game && game.players.length && window.FMP && FMP.active(), { timeout: 30000 })));
    const isHostA = await A.evaluate(() => FMP.isHost());
    console.log(`  live — host is ${isHostA ? 'A' : 'B'}`);

    const [dA, dB] = await Promise.all([playToScoring(A, 'mpA'), playToScoring(B, 'mpB')]);
    ok(dA && dB, 'both clients played the room game to the victory screen');

    const pA = await A.evaluate(() => FTEL.payloadPreview());
    const pB = await B.evaluate(() => FTEL.payloadPreview());
    assertPayload(pA, 'room', 'host-side');
    ok(pA && pB && pA.decisions.length === pB.decisions.length,
        `lockstep: both clients recorded ${pA && pA.decisions.length} decisions`,
        `${pA && pA.decisions.length} vs ${pB && pB.decisions.length}`);
    ok(pA && pB && JSON.stringify(pA.result.rows) === JSON.stringify(pB.result.rows),
        'lockstep: identical result rows on both clients');
    ok(pA && pA.seats.some(s => s.kind === 'remote') && pA.seats.some(s => s.kind === 'human'),
        'seats stamp human + remote');

    await new Promise(r => setTimeout(r, 2500));
    const after = await telKeys();
    const fresh = after.filter(k => !before.includes(k));
    ok(fresh.length === 1, `exactly ONE transcript landed — the host's (${fresh.length})`);
    const gid = await A.evaluate(() => FMP.gid());
    await A.evaluate(() => FMP.leaveGame()).catch(() => {});
    await B.evaluate(() => FMP.leaveGame()).catch(() => {});
    if (gid) await rm(`mp/games/${gid}`);
    await rm(`mp/rooms/${code}`);
    await scrub([uidA, uidB], fresh[0]);
    await A.browserContext().close();
    await B.browserContext().close();
} else {
    console.log(`unknown mode '${MODE}' — skirmish | rival | mp`);
    process.exit(2);
}

const benign = consoleErrs.filter(e => !/favicon|net::ERR_|404/i.test(e));
ok(benign.length === 0, 'zero console errors through the whole game', benign.slice(0, 3).join(' | '));
await browser.close();
console.log(fail ? `\n❌ ${MODE}: ${fail} failed, ${pass} passed` : `\n✅ ${MODE}: ${pass}/${pass}`);
process.exit(fail ? 1 : 0);
