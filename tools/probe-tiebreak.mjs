#!/usr/bin/env node
/**
 * FAVOR — 7/23 probe: the Labyrinth "fine" and the unexplained tie.
 *
 *   python3 -m http.server 8891 --directory . &   (repo root)
 *   node tools/probe-tiebreak.mjs
 *
 * Two things Wyatt saw at the table:
 *   1. Failing The Labyrinth WITHOUT the Fortune Teller rendered a red
 *      "50 Prestige lost" chip — it reads as a 50-point fine. Nothing is
 *      deducted (the engine only ever ADDS the 50 when she's held), so the
 *      beat must never claim a cost.
 *   2. The table's first tie: 73 to 73, HotshotGG took the throne on gold,
 *      and the sheet said nothing about why. Gold is not a scoring row, so
 *      the number that decided the game was the one number not on screen.
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const URL = process.env.AUDIT_URL || 'http://localhost:8891/';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), 'audit-shots');
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});

async function startGame(page) {
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('favor_coach_seen', JSON.stringify(
      ['welcome', 'missions', 'hand', 'skills', 'pass', 'rivals',
       'scorn', 'favor', 'ring', 'melee', 'emblem']));
    localStorage.setItem('favorTelemetryOff', '1');
  });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    return b && b.offsetParent;
  }, { timeout: 20000 });
  await page.evaluate(() => {
    window.shuffleArray = (a) => [...a];
    localStorage.setItem('favorQueue', '3');
    window._pinEmblemSeed = 0;
    window._noSoloSave = true;
    localStorage.removeItem('favorSoloSave');
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card') && document.querySelector('.character-card').offsetParent, { timeout: 20000 });
  await page.evaluate(() => {
    selectedCharacter = FAVOR_DATA.characters[0].id;
    document.querySelector('.character-card').classList.add('selected');
    document.getElementById('confirmBtn').style.display = 'inline-block';
  });
  await page.waitForFunction(() => document.getElementById('confirmBtn') && document.getElementById('confirmBtn').offsetParent, { timeout: 20000 });
  await page.evaluate(() => document.getElementById('confirmBtn').click());
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 20000 });
  await sleep(1200);
  await page.evaluate(() => { const x = document.querySelector('.coach-x'); if (x && x.offsetParent) x.click(); });
}

const consoleErrors = [];

// ═══ 1. THE LABYRINTH — a missed conditional is not a fine ═══════════
console.log('\n— The Labyrinth: a gate that missed must not read as a penalty —');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('labyrinth: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);

  // Two beats, same mission, opposite gates: AI p1 fails The Labyrinth with
  // nothing on the table; AI p2 fails it holding the Fortune Teller. Every
  // table is stripped of played cards so no seat can borrow its way out.
  const prestigeBefore = await page.evaluate(() => {
    game.players.forEach(p => { p.playedCards = []; p.missions = []; });
    const lab = () => ({ ...window.FAVOR_DATA.missions.find(m => m.name === 'The Labyrinth'), activationRound: 1, dueAct: 1 });
    game.players[1].missions = [lab()];
    game.players[2].missions = [lab()];
    game.players[2].playedCards = [{ ...window.FAVOR_DATA.cards.find(c => c.name === 'Fortune Teller'), id: 'ft-rig' }];
    const before = game.players.map(p => p.prestige);
    endActPhases();
    return before;
  });
  await page.waitForFunction(() => document.getElementById('missionCeremony').classList.contains('active'), { timeout: 8000 });
  await sleep(450);

  await page.evaluate(() => document.getElementById('missionCeremony').click());   // reveal beat 1
  await sleep(500);
  const noTeller = await page.evaluate(() => ({
    card: document.querySelector('.mc-card').alt,
    stamp: document.querySelector('.mc-stamp').textContent,
    chips: [...document.querySelectorAll('.mc-chip')].map(c => ({
      text: c.textContent.replace(/\s+/g, ' ').trim(),
      bad: c.classList.contains('bad'),
      color: getComputedStyle(c).color,
    })),
    prestige: game.players[1].prestige,
  }));
  ok(noTeller.card === 'The Labyrinth' && noTeller.stamp === 'Failed',
    `beat 1: The Labyrinth, failed (${noTeller.card} / ${noTeller.stamp})`);
  ok(!noTeller.chips.some(c => c.bad),
    `NO red penalty chip when the Fortune Teller is absent (${JSON.stringify(noTeller.chips.map(c => c.text))})`);
  // "the mission is simply lost" is the mission, not a resource — what must
  // never appear is a RESOURCE being taken (the old "50 Prestige lost").
  ok(!noTeller.chips.some(c => /(Prestige|Favor|Gold|Scorn)\s+lost|forfeit|−\d|-\d/.test(c.text)),
    `nothing on screen claims a resource cost (${noTeller.chips.map(c => c.text).join(' · ')})`);
  ok(noTeller.chips.some(c => /No penalty/i.test(c.text)),
    'the beat says outright that no penalty landed');
  ok(noTeller.chips.some(c => /Fortune Teller.*would have paid \+50 Prestige/i.test(c.text)),
    'and still states the counterfactual — the bonus that never came');
  ok(noTeller.prestige === prestigeBefore[1],
    `and the engine really did move no Prestige (${prestigeBefore[1]} → ${noTeller.prestige})`);
  await page.screenshot({ path: join(SHOTS, 'labyrinth-no-teller.png') });

  await page.evaluate(() => document.getElementById('missionCeremony').click());   // next beat
  await sleep(600);
  await page.evaluate(() => document.getElementById('missionCeremony').click());   // reveal beat 2
  await sleep(500);
  const withTeller = await page.evaluate(() => ({
    card: document.querySelector('.mc-card').alt,
    chips: [...document.querySelectorAll('.mc-chip')].map(c => c.textContent.replace(/\s+/g, ' ').trim()),
    prestige: game.players[2].prestige,
  }));
  ok(withTeller.card === 'The Labyrinth' && withTeller.chips.some(t => /\+50 Prestige/.test(t)),
    `held, the Fortune Teller still headlines her +50 (${withTeller.chips.join(' · ')})`);
  ok(withTeller.prestige === prestigeBefore[2] + 50,
    `and pays it for real (${prestigeBefore[2]} → ${withTeller.prestige})`);
  await page.screenshot({ path: join(SHOTS, 'labyrinth-with-teller.png') });
  await page.close();
}

// ═══ 2. THE TIE — say who won it, and why ════════════════════════════
console.log('\n— A tie on Total: name the tiebreak —');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('tie: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 900 });
  await startGame(page);

  // Wyatt's board, rebuilt: a rival and the human dead level on 73, the
  // rival ahead on gold. Nothing is posted anywhere — the rigged 73 must
  // never reach the daily leaderboard.
  const rig = await page.evaluate(() => {
    if (window.FLB) FLB.postGameResult = () => Promise.resolve(null);
    window.FACH = null; window.FMODES = null; window.FTEL = null;
    game.players.forEach(p => {
      p.playedCards = []; p.completedMissions = []; p.favorLog = [];
      p.favor = 0; p.prestige = 0; p.scorn = 0; p.philosopherStone = 0;
    });
    game.players[1].name = 'HotshotGG';
    // Board standing is whatever the slider left behind — top it up with
    // Prestige so the totals land exactly where Wyatt's did.
    const target = [73, 73, 11];
    game.calculateFinalScores().forEach(s => {
      game.players[s.playerIndex].prestige = target[s.playerIndex] - s.finalScore;
    });
    game.players[0].gold = 9;
    game.players[1].gold = 14;
    game.players[2].gold = 30;   // a losing seat with the most gold on the table
    showScoring();
    return game.calculateFinalScores().map(s => ({ n: s.name, f: s.finalScore, g: s.gold }));
  });
  await sleep(2600);   // past the total row's 1150ms-delayed count-up
  const tie = await page.evaluate(() => {
    const note = document.querySelector('.vs-tiebreak');
    const cells = [...document.querySelectorAll('.vsg-cell.tiebreak')];
    return {
      note: note ? note.textContent.replace(/\s+/g, ' ').trim() : '(none)',
      noteVisible: !!note && !!note.offsetParent,
      row: cells.map(c => ({ v: c.textContent.trim(), live: c.classList.contains('live') })),
      label: (document.querySelector('.vsg-label.tiebreak') || {}).textContent,
      ords: [...document.querySelectorAll('.vsg-ord')].map(o => o.textContent.trim()),
      names: [...document.querySelectorAll('.vsg-hname')].map(o => o.textContent.trim()),
      totals: [...document.querySelectorAll('.vsg-cell.total')].map(o => o.textContent.trim()),
      hscroll: document.querySelector('.scoring-scroll').scrollWidth > document.querySelector('.scoring-scroll').clientWidth + 1,
    };
  });
  console.log('    standings:', JSON.stringify(rig));
  console.log('    note:', tie.note);
  ok(tie.noteVisible, 'a tiebreak note is on screen');
  ok(/Tied at 73 with HotshotGG/.test(tie.note), `it names the total and the rival ("${tie.note}")`);
  ok(/most Gold breaks the tie/i.test(tie.note), 'it names the tiebreak rule');
  ok(/HotshotGG 14/.test(tie.note) && /You 9/.test(tie.note),
    'and shows both purses, so the order is checkable');
  ok(tie.row.length === 3 && tie.row[0].v === '14' && tie.row[1].v === '9',
    `the sheet grows a Gold row under the total (${JSON.stringify(tie.row)})`);
  ok(tie.row[0].live && tie.row[1].live && !tie.row[2].live,
    'only the seats the tie actually caught are lit — the 30-gold third place is not');
  ok(!tie.hscroll, 'the sheet still fits without horizontal scroll');
  ok(tie.totals.join() === '73,73,11', `the totals finished counting up to the tie (${tie.totals.join(' · ')})`);
  await page.screenshot({ path: join(SHOTS, 'victory-tiebreak.png') });

  // The same tie, WON. The note has to read right from the throne too.
  await page.evaluate(() => {
    game.players[0].gold = 14; game.players[1].gold = 9;
    showScoring();
  });
  await sleep(2600);
  const won = await page.evaluate(() => ({
    headline: document.querySelector('.vs-headline').textContent.trim(),
    note: (document.querySelector('.vs-tiebreak') || {}).textContent.replace(/\s+/g, ' ').trim(),
  }));
  ok(/Victorious/i.test(won.headline) && /most Gold breaks the tie: You 14, HotshotGG 9/.test(won.note),
    `winning the tiebreak reads the same way from 1st ("${won.note}")`);

  // Level on Gold TOO — seat order settles it, which is no reason at all.
  // The note must not invent one.
  const dead = await page.evaluate(() => {
    game.players[0].gold = 9; game.players[1].gold = 9;
    showScoring();
    return (document.querySelector('.vs-tiebreak') || {}).textContent.replace(/\s+/g, ' ').trim();
  });
  await sleep(300);
  ok(/level on Gold too \(9 each\)/.test(dead) && !/breaks the tie/.test(dead),
    `a gold-level tie claims no rule it can't back ("${dead}")`);
  await page.evaluate(() => { game.players[0].gold = 9; game.players[1].gold = 14; });

  // And when nothing is tied, none of it appears.
  await page.evaluate(() => {
    game.players[1].prestige += 4;      // break the tie
    showScoring();
  });
  await sleep(1400);
  const clean = await page.evaluate(() => ({
    note: !!document.querySelector('.vs-tiebreak'),
    row: document.querySelectorAll('.vsg-cell.tiebreak').length,
  }));
  ok(!clean.note && clean.row === 0,
    `an untied game shows neither the note nor the Gold row (note ${clean.note}, cells ${clean.row})`);
  await page.screenshot({ path: join(SHOTS, 'victory-no-tiebreak.png') });

  // Phone: the note must not blow out the head on a 844×390 stage.
  await page.setViewport({ width: 844, height: 390 });
  await page.evaluate(() => { game.players[1].prestige -= 4; showScoring(); });
  await sleep(1400);
  const phone = await page.evaluate(() => {
    const n = document.querySelector('.vs-tiebreak');
    const sc = document.getElementById('scoring-screen');
    return {
      up: !!n && !!n.offsetParent,
      // The WHOLE point is that it reads without being hunted for: the note
      // must sit above the fold before anyone touches the screen.
      aboveFold: !!n && n.getBoundingClientRect().bottom <= window.innerHeight + 1,
      cost: Math.round(n.getBoundingClientRect().height),
      hscroll: sc.scrollWidth > sc.clientWidth + 1,
      exitVisible: document.querySelector('.scoring-actions').getBoundingClientRect().top < window.innerHeight,
    };
  });
  ok(phone.up && phone.aboveFold && !phone.hscroll,
    `phone 844×390: note reads before any scroll, no h-scroll (${JSON.stringify(phone)})`);
  ok(phone.cost <= 30, `and it costs the compact head only ${phone.cost}px`);
  ok(phone.exitVisible, 'the way out is still pinned on screen');
  await page.screenshot({ path: join(SHOTS, 'victory-tiebreak-phone.png') });

  // #scoring-screen is overflow-y:auto by design ("short screens scroll
  // instead of clipping") — so the Gold receipt has to be REACHABLE.
  const reach = await page.evaluate(() => {
    const sc = document.getElementById('scoring-screen');
    sc.scrollTop = sc.scrollHeight;
    const c = document.querySelector('.vsg-cell.tiebreak');
    const r = c.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight,
             actionsTop: Math.round(document.querySelector('.scoring-actions').getBoundingClientRect().top) };
  });
  ok(reach.bottom <= reach.actionsTop + 2 && reach.top > 0,
    `scrolled down, the Gold row clears the pinned buttons (row ${reach.top}–${reach.bottom}, buttons at ${reach.actionsTop})`);
  await page.screenshot({ path: join(SHOTS, 'victory-tiebreak-phone-scrolled.png') });
  await page.close();
}

await browser.close();
ok(consoleErrors.length === 0, `no console errors (${consoleErrors.length})`, consoleErrors.join(' | '));
console.log(`\n${fail === 0 ? 'ALL CLEAN' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
