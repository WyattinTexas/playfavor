#!/usr/bin/env node
// ═══ arena — headless self-play for the Hard brain (Hard-AI §5e) ════════════
//
// Loads data + engine + playbook + ai the engine-smoke way (fake window),
// drives full 3-player games through the SAME engine methods the UI uses,
// and reports Hard-vs-casual results. The driver mirrors js/ui.js's AI
// orchestration exactly: picks → passHands → activation in emblem order
// (casual: canPlay?play:discard + mission letters; hard: FAI preSlide +
// chooseAction) → resolveMissions → resolveMelee → next act.
//
//   node tools/arena.mjs [N]           # N games (default 500)
//
// GATES (exit 1 on any miss):
//   · Hard wins ≥65% of seats-normalized games vs casual
//   · determinism — same seed twice ⇒ identical log hash
//   · casual-vs-casual identical with ai.js loaded vs absent
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const N = Number(process.argv[2]) || 500;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(root, p), 'utf8');

function makeLoader(withAI) {
    const window = {};
    const FavorGame = new Function('window',
        src('data/cards.js') + '\n' + src('data/missions.js') + '\n' +
        src('data/characters.js') + '\n' + src('data/achievements.js') + '\n' +
        src('data/playbook.js') + '\n' +
        src('engine/gameState.js') + '\n' +
        (withAI ? src('js/ai.js') + '\n' : '') +
        'return FavorGame;')(window);
    return { window, FavorGame };
}

const HEROES = ['explorer', 'knight', 'bandit', 'merchant', 'fisherman',
    'duchess', 'scientist', 'doctor', 'fiddler', 'magician'];

// ── The casual brain, verbatim from js/ui.js (non-persona paths) ─────────
function casualPick(g, pi) {
    const player = g.players[pi];
    let bestIndex = 0, bestScore = -1;
    player.hand.forEach((card, i) => {
        let score = 0;
        if (card.skills) score += card.skills.length * 2;
        if (card.rewards) {
            if (card.rewards.gold) score += card.rewards.gold;
            if (card.rewards.prestige) score += card.rewards.prestige * 3;
            if (card.rewards.favor) score += card.rewards.favor * 2;
            if (card.rewards.scorn) score -= card.rewards.scorn * 2;
        }
        if (card.skills && card.skills.includes('power')) score += 3;
        const { canPlay } = g.checkRequirements(pi, card);
        if (canPlay) score += 5;
        if (score > bestScore) { bestScore = score; bestIndex = i; }
    });
    g.pickCard(pi, bestIndex);
}
function casualBestMission(g, pi) {
    let bestIdx = 0, bestScore = -Infinity;
    g.visibleMissions.forEach((m, i) => {
        const score = m.favor || m.successReward?.favor || 0;
        if (score > bestScore) { bestScore = score; bestIdx = i; }
    });
    return bestIdx;
}

function runGame(L, seed, heroes, levels, stats) {
    const { window: W, FavorGame } = L;
    const FAI = W.FAI || null;
    // A fresh page load, simulated: the engine deals REFERENCES into decks,
    // so in-game marks (Chemical Y's _favorDoubled, Life Essence's
    // _reqWaived, the act-boundary _attemptNow) stick to the shared data
    // objects. Production reloads between tables; 500 arena games in one
    // loader must scrub or game N pollutes game N+1.
    (W.FAVOR_DATA.cards || []).forEach(c => { delete c._favorDoubled; });
    (W.FAVOR_DATA.missions || []).forEach(m => {
        delete m._reqWaived; delete m._attemptNow;
    });
    const g = new FavorGame(3);
    g.setSeed(seed);
    g.loadDecks();
    g.initPlayers(heroes.map((id, i) => ({ characterId: id, playerName: 'P' + i })));
    levels.forEach((lv, i) => { if (lv === 'hard') g.players[i]._aiLevel = 'hard'; });

    for (let act = 1; act <= 3; act++) {
        g.startAct(act);
        let guard = 0;
        while (g.players.some(p => p.hand.length) && ++guard < 12) {
            for (let i = 0; i < 3; i++) {
                if (!g.players[i].hand.length || g.pendingActivations[i]) continue;
                if (FAI && FAI.isHard(g, i)) FAI.pickCard(g, i);
                else casualPick(g, i);
            }
            g.passHands();
            for (let k = 0; k < 3; k++) {
                const pi = (g.emblemHolder + k) % 3;
                const pending = g.pendingActivations[pi];
                if (!pending) continue;
                const cards = Array.isArray(pending) ? pending : [pending];
                for (const card of cards) {
                    if (FAI && FAI.isHard(g, pi)) {
                        const slid = FAI.preSlide(g, pi);
                        if (slid && stats) { stats.slides += slid; }
                        const dec = FAI.chooseAction(g, pi, card);
                        if (dec.action === 'mission_letter' && card.type === 'mission_letter'
                            && g.players[pi].gold >= 1 && g.visibleMissions.length > 0) {
                            const result = g.activateCard(pi, card.id, 'mission_letter');
                            if (result && result.chooseMission) g.chooseMission(pi, FAI.bestMission(g, pi));
                        } else if (dec.action === 'play'
                            && (dec.borrow || g.checkRequirements(pi, card).canPlay)) {
                            const played = g.activateCard(pi, card.id, 'play', dec.borrow || []);
                            if (!played || !played.success) g.activateCard(pi, card.id, 'discard');
                        } else if (dec.action === 'discard_slide' && (dec.dir === -1 || dec.dir === 1)) {
                            g.activateCard(pi, card.id, 'discard_slide', dec.dir);
                            if (stats) stats.dslides++;
                        } else {
                            g.activateCard(pi, card.id, 'discard');
                        }
                    } else {
                        // ui.js casual branch, verbatim shape
                        if (card.type === 'mission_letter') {
                            if (g.players[pi].gold >= 1 && g.visibleMissions.length > 0) {
                                const result = g.activateCard(pi, card.id, 'mission_letter');
                                if (result && result.chooseMission) g.chooseMission(pi, casualBestMission(g, pi));
                            } else {
                                g.activateCard(pi, card.id, 'discard');
                            }
                        } else if (g.checkRequirements(pi, card).canPlay) {
                            g.activateCard(pi, card.id, 'play');
                        } else {
                            g.activateCard(pi, card.id, 'discard');
                        }
                    }
                }
            }
            g.pendingActivations = new Array(3).fill(null);
            g.phase = 'gameplay';
        }
        // Deliberate-failure census BEFORE resolution consumes the state.
        if (FAI && stats) {
            for (let pi = 0; pi < 3; pi++) {
                if (!FAI.isHard(g, pi)) continue;
                (g.players[pi].missions || []).forEach(m => {
                    if (!m.activationRound || m.activationRound > g.currentAct) return;
                    if (g.missionDueAct(m) > g.currentAct) return;
                    if (g.checkMissionRequirements(pi, m).success
                        && FAI.wantsFailOnPurpose(g, pi, m)) stats.failOnPurpose++;
                });
            }
        }
        g.phase = 'missions';
        g.resolveMissions();
        g.resolveMelee();
        if (FAI && stats) {
            for (let pi = 0; pi < 3; pi++) {
                if (FAI.isHard(g, pi)) {
                    const hero = g.players[pi].character.id;
                    stats.park[hero] = stats.park[hero] || {};
                    stats.park[hero][act] = stats.park[hero][act] || [0, 0, 0, 0, 0];
                    stats.park[hero][act][g.players[pi].sliderPosition]++;
                }
            }
        }
    }
    const scores = g.calculateFinalScores();
    if (stats) {
        for (let pi = 0; pi < 3; pi++) {
            const p = g.players[pi];
            const b = (FAI && FAI.isHard(g, pi)) ? stats.h : stats.c;
            if (!b) continue;
            b.done += (p.completedMissions || []).length;
            b.failed += (p.failedMissions || []).length;
            b.gold += p.gold || 0;
            b.weapons += (p.playedCards || []).filter(c => c.type === 'weapon').length;
            b.played += (p.playedCards || []).length;
            b.n++;
        }
    }
    return { scores, log: g.log };
}

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; };
// log rows are {message,...} objects — hash the MESSAGES, not [object Object].
const logLines = (r) => r.log.map(e => (e && e.message) ? e.message : String(e));
const logHash = (r) => hash(logLines(r).join('\n') + '||' + JSON.stringify(r.scores.map(s => [s.name, s.finalScore, s.gold])));

// Distinct hero triple for game i — deterministic, all heroes cycled.
function triple(i) {
    const a = i % 10, b = (a + 1 + (i % 8)) % 10;
    let c = (b + 1 + (i % 7)) % 10;
    if (c === a) c = (c + 1) % 10;
    const fix = (x, y, z) => (y === x ? (x + 1) % 10 : y);
    const B = fix(a, b), C = (c === a || c === B) ? ((Math.max(a, B, c) + 1) % 10) : c;
    return [HEROES[a], HEROES[B], HEROES[C === a || C === B ? (C + 1) % 10 : C]];
}

// Debug: `node tools/arena.mjs diff <seed>` — first casual log divergence
// between the with-ai and without-ai loaders.
if (process.argv[2] === 'diff') {
    const seed = Number(process.argv[3]) || 5000;
    const i = seed - 5000;
    const h = triple(i * 13 + 3);
    const a = runGame(makeLoader(true), seed, h, ['casual', 'casual', 'casual'], null);
    const b = runGame(makeLoader(false), seed, h, ['casual', 'casual', 'casual'], null);
    const la = logLines(a), lb = logLines(b);
    for (let k = 0; k < Math.max(la.length, lb.length); k++) {
        if (la[k] !== lb[k]) {
            console.log(`line ${k}\n  withAI: ${la[k]}\n  no-ai:  ${lb[k]}`);
            console.log('  context:', la.slice(Math.max(0, k - 3), k).join(' | '));
            break;
        }
    }
    console.log('scores withAI:', a.scores.map(s => s.finalScore).join(','),
        '| no-ai:', b.scores.map(s => s.finalScore).join(','));
    process.exit(0);
}

// ── 1 · Hard-vs-casual ───────────────────────────────────────────────────
const L = makeLoader(true);
const stats = { slides: 0, dslides: 0, failOnPurpose: 0, park: {},
    h: { done: 0, failed: 0, gold: 0, weapons: 0, played: 0, n: 0 },
    c: { done: 0, failed: 0, gold: 0, weapons: 0, played: 0, n: 0 } };
const cat = { hard: {}, cas: {} };
const losses = [], lossCat = {};
let hardWins = 0, hardScore = 0, casScore = 0, games = 0;
const perHero = {};
for (let i = 0; i < N; i++) {
    const heroes = triple(i);
    const hardSeat = i % 3;
    const levels = ['casual', 'casual', 'casual']; levels[hardSeat] = 'hard';
    const r = runGame(L, 1000 + i, heroes, levels, stats);
    const winner = r.scores[0];
    const hardName = 'P' + hardSeat;
    const hero = heroes[hardSeat];
    perHero[hero] = perHero[hero] || { g: 0, w: 0 };
    perHero[hero].g++;
    if (winner.name === hardName) { hardWins++; perHero[hero].w++; }
    else {
        const hs = r.scores.find(s => s.name === hardName);
        losses.push({ hard: hs.finalScore, win: winner.finalScore, gap: winner.finalScore - hs.finalScore });
        ['missionFavor', 'advFavor', 'artFavor', 'characterFavor', 'prestige', 'scorn']
            .forEach(k => { lossCat[k] = (lossCat[k] || 0) + ((winner[k] || 0) - (hs[k] || 0)); });
    }
    r.scores.forEach(s => {
        const bucket = (s.name === hardName) ? cat.hard : cat.cas;
        const w = (s.name === hardName) ? 1 : 0.5;
        if (s.name === hardName) hardScore += s.finalScore;
        else casScore += s.finalScore / 2;
        ['missionFavor', 'advFavor', 'artFavor', 'otherCardFavor', 'characterFavor', 'prestige', 'scorn']
            .forEach(k => { bucket[k] = (bucket[k] || 0) + (s[k] || 0) * w; });
    });
    games++;
}
const winPct = (100 * hardWins / games);
console.log(`\nARENA — ${games} games, hard seat rotating, heroes cycling`);
console.log(`  HARD wins:  ${hardWins}/${games} = ${winPct.toFixed(1)}%   (gate ≥65; 3p par 33.3)`);
console.log(`  mean finalScore — hard ${(hardScore / games).toFixed(1)} vs casual ${(casScore / games).toFixed(1)}`);
console.log(`  paid slide steps/game ${(stats.slides / games).toFixed(2)} · discard-slides/game ${(stats.dslides / games).toFixed(2)} · deliberate fails ${stats.failOnPurpose}`);
console.log('  per-hero (hard seat): ' + Object.entries(perHero)
    .sort((a, b) => b[1].w / b[1].g - a[1].w / a[1].g)
    .map(([h, s]) => `${h} ${(100 * s.w / s.g).toFixed(0)}%`).join('  '));
console.log('  park (hard, end of act): ' + Object.entries(stats.park).slice(0, 4)
    .map(([h, acts]) => `${h}:` + Object.entries(acts).map(([a, arr]) =>
        `A${a}→${arr.indexOf(Math.max(...arr))}`).join(',')).join('  '));
const fmtCat = (b) => Object.entries(b).map(([k, v]) => `${k.replace('Favor', '')} ${(v / games).toFixed(1)}`).join('  ');
console.log('  hard   breakdown: ' + fmtCat(cat.hard));
console.log('  casual breakdown: ' + fmtCat(cat.cas));
const seatRow = (b) => `missions ${(b.done / b.n).toFixed(2)}✓/${(b.failed / b.n).toFixed(2)}✗ · end gold ${(b.gold / b.n).toFixed(1)} · weapons ${(b.weapons / b.n).toFixed(2)} · played ${(b.played / b.n).toFixed(1)}`;
console.log('  hard   seat: ' + seatRow(stats.h));
console.log('  casual seat: ' + seatRow(stats.c));
if (losses.length) {
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    console.log(`  LOSSES (${losses.length}): hard mean ${mean(losses.map(l => l.hard)).toFixed(1)}, winner mean ${mean(losses.map(l => l.win)).toFixed(1)}, close (gap≤10) ${losses.filter(l => l.gap <= 10).length}`);
    console.log('  winner-minus-hard in losses: ' + Object.entries(lossCat)
        .map(([k, v]) => `${k.replace('Favor', '')} ${(v / losses.length).toFixed(1)}`).join('  '));
}

// ── 2 · Determinism — same seed twice, identical log hash ────────────────
const d1 = logHash(runGame(L, 777, triple(7), ['casual', 'hard', 'casual'], null));
const d2 = logHash(runGame(L, 777, triple(7), ['casual', 'hard', 'casual'], null));
const deterministic = d1 === d2;
console.log(`  determinism: ${deterministic ? 'IDENTICAL' : 'FORK — ' + d1 + ' vs ' + d2}`);

// ── 3 · Casual-vs-casual unchanged with FAI aboard ───────────────────────
const L0 = makeLoader(false);
let casualSame = true;
for (let i = 0; i < 25; i++) {
    const h = triple(i * 13 + 3);
    const a = logHash(runGame(L, 5000 + i, h, ['casual', 'casual', 'casual'], null));
    const b = logHash(runGame(L0, 5000 + i, h, ['casual', 'casual', 'casual'], null));
    if (a !== b) { casualSame = false; console.log(`  casual fork at seed ${5000 + i}`); break; }
}
console.log(`  casual-vs-casual with/without ai.js: ${casualSame ? 'IDENTICAL (25 seeds)' : 'FORKED'}`);

const pass = winPct >= 65 && deterministic && casualSame;
console.log(pass ? `\n✅ ARENA GATES PASS` : `\n❌ ARENA GATES FAIL`);
process.exit(pass ? 0 : 1);
