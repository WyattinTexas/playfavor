#!/usr/bin/env node
/**
 * FAVOR — pre-handoff UI audit. Plays the build like a user (real clicks,
 * real touches) and fails loudly on visual miscues the engine suites can't
 * see. Run before EVERY handoff to Wyatt:
 *
 *   python3 -m http.server 8891 --directory .. &   (repo root)
 *   node tools/ui-audit.mjs
 *
 * Needs puppeteer-core (globally installed) + system Chrome.
 * Screenshots land in tools/audit-shots/ — LOOK at them before shipping.
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

// testrealm2 is retired (Wyatt 7/15) — the repo root IS playfavor.net.
const URL = process.env.AUDIT_URL || 'http://localhost:8891/';
// Wall-clock at launch — the final integrity gate uses it to bound its
// persona-contamination sweep to THIS run's window.
const RUN_START = Date.now();
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
  // Coach marks fire on BOTH form factors now — flows must stay deterministic.
  // MUST be pre-parse (evaluateOnNewDocument): ui.js snapshots _coachSeen at
  // load, so a post-load localStorage write is inert. The coach flow asserts
  // the ladder ids explicitly, so drift between this list and COACH_STEPS
  // fails loudly there.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('favor_coach_seen', JSON.stringify(
      ['welcome', 'missions', 'hand', 'skills', 'pass', 'rivals',
       'scorn', 'favor', 'ring', 'melee', 'emblem']));
  });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    return b && b.offsetParent;
  }, { timeout: 20000 });
  // Deterministic BOT characters, not just the pinned human hero: identity-
  // shuffle the UI helper so the offer is always the first three of the
  // roster and bots always draw merchant/fisherman(/duchess/scientist).
  // Since hero select began offering only OWNED heroes, the five store
  // heroes sit in the bot pool EVERY run — and a Scientist bot's center
  // slot grants Knowledge, which makes him an alternate lender and breaks
  // "player 1 sole lender" rigs by character draw. (The engine's own
  // deck shuffle is game.shuffle — untouched by this.)
  // ALSO pin the queue: favorQueue persists in the shared profile, and the
  // 5-player viewport flow leaves '5' behind — a 5p game seats Scientist
  // at p4 = the human's LEFT neighbor, and getBorrowableSkills iterates
  // left-first, so HE gets picked as lender over the rigged player 1.
  await page.evaluate(() => {
    window.shuffleArray = (a) => [...a];
    localStorage.setItem('favorQueue', '3');
    // Pin the Emblem seed: seat 0, personas OFF, no boon — every rig below
    // assumes the human acts first and the table is the four generic bots.
    // The emblem/persona/boon flow rigs its own seed and skips this pin.
    window._pinEmblemSeed = 0;
    // Solo save-resume must never leak between flows: no checkpoints from
    // rigged tables, and no stale save intercepting the Play tap. The
    // leave/resume flow un-sets the seam and manages its own save.
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
    // Deterministic rigs: always play the roster's FIRST hero, exactly as
    // when the select screen offered all ten — three random offerings
    // would shuffle the slot-bonus math under the slide-picker flows.
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

// ── Throw-first flow helpers (7/16 rework) ──────────────────────────
// The pick-time action sheet is gone: a drag/throw commits the card face
// down, rivals throw on human-paced timers, the last card locks the
// round, hands pass, and YOUR reveal chooser opens at your activation
// slot (startGame pins the Emblem to seat 0, so you reveal first).
//
// throwAndAwaitChoice(page, i): throw hand card i, hurry the rivals
// along the same engine path the timers would take (deterministic, no
// stagger wait), and resolve once the reveal chooser is up. The chooser
// is the old action sheet — same labels — so existing text-matched
// button clicks keep working against it.
async function throwAndAwaitChoice(page, i = 0) {
  await page.evaluate((idx) => throwCard(idx), i);
  await page.evaluate(() => {
    for (let s = 1; s < game.playerCount; s++) {
      if (game.pendingActivations[s] === null && game.players[s].hand.length) {
        aiPickCard(s);
      }
    }
    renderGameState();
    maybeLockThrows();
  });
  await page.waitForFunction(() => window._finalChoicePending === true, { timeout: 20000 });
}

// Answer the open reveal chooser by button-label regex (falls back to
// data-act), e.g. answerChoice(page, /discard \(\+3g\)/i).
async function answerChoice(page, re) {
  await page.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    const b = [...document.querySelectorAll('#actionPanel .action-btn')]
      .find(x => rx.test(x.textContent) && !x.disabled);
    if (b) b.click();
  }, re.source);
}

// ═══ PHONE: touch glide must bloom exactly ONE card ═══
console.log('── Phone: glide blooms exactly one card (no sticky-hover double)');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('phone: ' + m.text()); });
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(page);
  await sleep(500);   // strip is always open — nothing to raise
  // Freeze the rivals' throw timers: a rival render mid-glide rebuilds the
  // hand and orphans the .bloom element under the held finger (the same
  // trap the drag flows freeze against).
  await page.evaluate(() => {
    for (let i = 1; i < game.playerCount; i++) {
      if (game.pendingActivations[i]) game.unpickCard(i);
    }
    window.CINEMATIC_SPEED = 1000;
    beginThrowPhase();
    renderGameState();
  });
  await sleep(200);

  const centers = await page.evaluate(() => {
    const zone = document.getElementById('tvHand');
    const zl = zone.getBoundingClientRect().left;
    return [...zone.querySelectorAll('.hand-card')].map(c => zl + c.offsetLeft + c.offsetWidth / 2);
  });
  ok(centers.length >= 3, `hand rendered (${centers.length} cards)`);

  const y = 375;
  await page.touchscreen.touchStart(centers[0], y);
  await sleep(200);
  await page.touchscreen.touchMove(centers[1], y);
  await sleep(120);
  await page.touchscreen.touchMove(centers[2], y);
  await sleep(250);

  const mid = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.tv-hand .hand-card')];
    const rests = cards.filter(c => !c.classList.contains('bloom')).map(c => c.getBoundingClientRect().height);
    const restH = Math.min(...rests);
    const bloomed = cards.filter(c => c.getBoundingClientRect().height > restH * 1.6);
    const b = document.querySelector('.tv-hand .hand-card.bloom');
    const r = b ? b.getBoundingClientRect() : null;
    return {
      bloomedCount: bloomed.length,
      bloomClassCount: cards.filter(c => c.classList.contains('bloom')).length,
      bloom: r ? { top: r.top, bottom: r.bottom, h: r.height, vh: window.innerHeight } : null,
    };
  });
  await page.screenshot({ path: join(SHOTS, 'phone-glide.png') });
  ok(mid.bloomedCount === 1, `mid-glide: exactly one enlarged card (got ${mid.bloomedCount})`);
  ok(mid.bloomClassCount === 1, 'exactly one .bloom class');
  ok(mid.bloom && mid.bloom.h >= mid.bloom.vh * 0.88,
    `bloom fills the screen (${mid.bloom ? Math.round(mid.bloom.h / mid.bloom.vh * 100) : 0}% of height)`);
  ok(mid.bloom && mid.bloom.top >= 0 && mid.bloom.bottom <= mid.bloom.vh + 1,
    'bloomed card fully on-screen despite the strip crop');

  // ── Task-1 layering: the bloomed card must PAINT above the phase pill.
  // elementFromPoint exercises real hit-test stacking — synthetic clicks
  // bypass it, which is exactly how this class of bug slips through.
  await page.evaluate(() => {   // pill fixture: visible as in a worded phase
    const b = document.getElementById('phaseBar');
    b.style.display = '';
    if (!b.textContent.trim()) b.innerHTML =
      '<span class="act-tag">Act I</span><span class="phase-text">Missions</span>';
  });
  const layer = await page.evaluate(() => {
    const b = document.querySelector('.tv-hand .hand-card.bloom');
    const pill = document.getElementById('phaseBar');
    if (!b || !pill) return { miss: true };
    const br = b.getBoundingClientRect(), pr = pill.getBoundingClientRect();
    const l = Math.max(br.left, pr.left), r = Math.min(br.right, pr.right);
    const t = Math.max(br.top, pr.top), bo = Math.min(br.bottom, pr.bottom);
    if (l >= r || t >= bo) return { overlap: false };
    const el = document.elementFromPoint((l + r) / 2, (t + bo) / 2);
    return {
      overlap: true,
      hitCard: b === el || b.contains(el),
      hit: el ? (el.className.toString() || el.id || el.tagName) : 'none',
      pillInTable: document.getElementById('table-view').contains(pill),
    };
  });
  ok(layer.overlap === true, 'bloomed card overlaps the phase pill (fixture valid)');
  ok(layer.hitCard === true, `bloomed card paints ABOVE the phase pill (hit: ${layer.hit})`);
  ok(layer.pillInTable === true, 'phase pill lives inside #table-view while compact');

  await page.touchscreen.touchEnd();
  await sleep(400);
  const after = await page.evaluate(() => ({
    bloomsLeft: document.querySelectorAll('.tv-hand .hand-card.bloom').length,
    enlarged: [...document.querySelectorAll('.tv-hand .hand-card')].filter(c => c.getBoundingClientRect().height > 260).length,
    panel: !!document.querySelector('.action-panel.active'),
  }));
  ok(after.bloomsLeft === 0 && after.enlarged === 0, `release: all cards back to rest (bloom=${after.bloomsLeft}, big=${after.enlarged})`);
  ok(!after.panel, 'glide release alone opens nothing');

  // ── Drag-up commits (Hearthstone pull): lift a card out and release ──
  console.log('── Phone: drag a card up and release → the throw');
  // Freeze the rivals' throw timers (they scale by CINEMATIC_SPEED) so the
  // take-back window stays open for the whole gesture sequence.
  await page.evaluate(() => {
    // Any rival who already threw takes it back (engine-clean), so the
    // whole table is guaranteed un-locked for the gesture checks.
    for (let i = 1; i < game.playerCount; i++) {
      if (game.pendingActivations[i]) game.unpickCard(i);
    }
    window.CINEMATIC_SPEED = 1000;
    beginThrowPhase();
  });
  await sleep(150);
  await page.touchscreen.touchStart(centers[1], y);
  await sleep(150);
  await page.touchscreen.touchMove(centers[1] + 4, y - 40);   // under the lift line: still browsing
  await sleep(150);
  ok(await page.evaluate(() => !document.querySelector('.hand-card.dragging')),
    'small lift stays in browse mode');
  await page.touchscreen.touchMove(centers[1] + 10, y - 160); // well past the line
  await sleep(250);
  const midDrag = await page.evaluate(() => ({
    dragging: !!document.querySelector('.hand-card.dragging'),
    dimmed: [...document.querySelectorAll('.tv-hand .hand-card:not(.dragging)')]
      .every(c => parseFloat(getComputedStyle(c).opacity) < 0.7),
  }));
  ok(midDrag.dragging, 'past the lift line the card detaches and follows the finger');
  ok(midDrag.dimmed, 'the rest of the fan dims during the drag');
  await page.screenshot({ path: join(SHOTS, 'phone-drag-up.png') });
  await page.touchscreen.touchEnd();
  await sleep(500);
  const committed = await page.evaluate(() => ({
    panel: !!document.querySelector('.action-panel.active'),
    thrown: !!game.pendingActivations[0],
    zone: document.getElementById('thrownZone').classList.contains('active'),
    undoBtn: !!document.querySelector('#thrownZone .tz-undo'),
    dragLeft: !!document.querySelector('.hand-card.dragging'),
  }));
  ok(committed.thrown && !committed.panel, 'release up top THROWS the card — no sheet appears');
  ok(committed.zone && committed.undoBtn, 'the face-down card shows with its take-back');
  ok(!committed.dragLeft, 'the drag element snapped home');
  await page.screenshot({ path: join(SHOTS, 'phone-drag-commit.png') });
  // Take it back so the gesture checks below start from a full hand.
  await page.evaluate(() => undoThrow());
  await sleep(300);
  ok(await page.evaluate(() => !game.pendingActivations[0] && game.players[0].hand.length === 7),
    'Take it Back restores the full hand');

  // Plain tap = read only, never a throw.
  await page.touchscreen.touchStart(centers[0], y);
  await sleep(150);
  await page.touchscreen.touchEnd();
  await sleep(450);
  ok(await page.evaluate(() => !document.querySelector('.action-panel.active') && !game.pendingActivations[0]),
    'a plain tap opens nothing and throws nothing');

  // Drag up, then back down = cancel.
  await page.touchscreen.touchStart(centers[1], y);
  await sleep(120);
  await page.touchscreen.touchMove(centers[1], y - 160);
  await sleep(180);
  await page.touchscreen.touchMove(centers[1], y - 12);
  await sleep(150);
  await page.touchscreen.touchEnd();
  await sleep(450);
  const cancelled = await page.evaluate(() => ({
    panel: !!document.querySelector('.action-panel.active'),
    dragging: !!document.querySelector('.hand-card.dragging'),
  }));
  ok(!cancelled.panel && !cancelled.dragging, 'dragging back down cancels cleanly');

  // THE PICKUP-SWAP BUG (Wyatt 7/6 night): pulling a card up while the
  // finger drifts sideways over a neighbor must NOT swap cards mid-play —
  // past the glide band the card in hand is locked.
  await page.touchscreen.touchStart(centers[2], y);
  await sleep(150);
  await page.touchscreen.touchMove(centers[2], y - 34);        // above the band, below the lift line
  await sleep(140);
  await page.touchscreen.touchMove(centers[4], y - 48);        // hard sideways drift over a neighbor
  await sleep(160);
  const lockedBloom = await page.evaluate(() => {
    const b = document.querySelector('.tv-hand .hand-card.bloom');
    return b ? parseInt(b.getAttribute('data-hand-i'), 10) : -1;
  });
  ok(lockedBloom === 2, `ascending drift cannot swap the card (still holding #${lockedBloom})`);
  await page.touchscreen.touchMove(centers[4] + 20, y - 160);  // keep drifting on the way up
  await sleep(220);
  const draggedIdx = await page.evaluate(() => {
    const d = document.querySelector('.hand-card.dragging');
    return d ? parseInt(d.getAttribute('data-hand-i'), 10) : -1;
  });
  ok(draggedIdx === 2, `the drag carries the card you picked up (#${draggedIdx})`);
  const cardAt2 = await page.evaluate(() => game.players[0].hand[2].id);
  await page.touchscreen.touchEnd();
  await sleep(500);
  const pickedRight = await page.evaluate(() => ({
    thrownId: game.pendingActivations[0] ? game.pendingActivations[0].id : null,
  }));
  ok(pickedRight.thrownId === cardAt2, `the throw commits that same card (#2 → ${pickedRight.thrownId})`);
  await page.evaluate(() => undoThrow());
  await sleep(200);
  await page.close();
}

// ═══ PHONE: Wingspan HUD — zones, chip taps, popovers, panel-aside ═══
console.log('── Phone: HUD — all zones live, chips/rails tap through, panel steps aside');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('hud: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('hud pageerror: ' + e.message));
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(page);

  // Rig: a mission in every state + a played card so every zone has content.
  await page.evaluate(() => {
    const p = game.players[0];
    const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    p.hand = [pick('First Aid'), pick('Trapping'), pick('Hunting')];
    for (let i = 1; i < game.playerCount; i++) game.players[i].hand = [pick('First Aid'), pick('Trapping'), pick('Hunting')];
    p.missions = [{ ...FAVOR_DATA.missions[3] }];
    p.completedMissions = [{ ...FAVOR_DATA.missions[4] }];
    p.failedMissions = [{ ...FAVOR_DATA.missions[5] }];
    p.playedCards.push(pick('First Aid'));
    game.players[1].playedCards.push(pick('Hunting'));   // rival has a card to lend
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
    document.getElementById('notifications').innerHTML = '';
    const fx = document.getElementById('tvFx'); if (fx) fx.innerHTML = '';
  });
  await sleep(400);

  await page.evaluate(() => {   // pill fixture: visible as in a worded phase
    const b = document.getElementById('phaseBar');
    b.style.display = '';
    if (!b.textContent.trim()) b.innerHTML =
      '<span class="act-tag">Act I</span><span class="phase-text">Missions</span>';
  });
  const zones = await page.evaluate(() =>
    ['tvPurse', 'tvSkills', 'tvSeats', 'tvMissionRail', 'tvBoardThumb', 'tvStage', 'tvHand', 'phaseBar'].map(id => {
      const el = document.getElementById(id);
      const r = el ? el.getBoundingClientRect() : null;
      return { id, ok: !!r && r.width > 0 && r.height > 0 };
    }));
  ok(zones.every(z => z.ok), `all 8 HUD zones render (missing: ${zones.filter(z => !z.ok).map(z => z.id).join(',') || 'none'})`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll');
  ok(await page.evaluate(() =>
    ['tvLeftDrawer', 'tvRightDrawer'].every(id => { const el = document.getElementById(id); return !el || el.offsetParent === null; })),
    'left/right drawers gone from view');
  ok(await page.evaluate(() => {
    const strip = document.getElementById('tvHandStrip');
    return strip && getComputedStyle(strip).transform === 'none' && strip.querySelectorAll('.hand-card').length === 3;
  }), 'hand strip pinned open with the fan visible');

  // Tap a skill chip → its transient name label (no hover on phones).
  await page.evaluate(() => document.querySelector('#tvSkills .tv-skill-chip').click());
  await sleep(150);
  ok(await page.evaluate(() => {
    const t = document.getElementById('tvChipTip');
    return !!t && /survival/i.test(t.textContent);
  }), 'skill chip tap shows its name tooltip');

  // Rival chip → their full purse + summed skills as one HUD-language
  // chip rail, then board (ring on its track) + played cards. No stat
  // pills, no reveal toggle.
  await page.evaluate(() => document.querySelector('#tvSeats .pmat.opp').click());
  await sleep(400);
  const opp = await page.evaluate(() => {
    const ring = document.getElementById('oppOvRing');
    const wrap = ring ? ring.parentElement.getBoundingClientRect() : null;
    const r = ring ? ring.getBoundingClientRect() : null;
    const vis = el => !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
    const rail = document.getElementById('oppOvChips');
    return {
      active: document.getElementById('oppOverlay').classList.contains('active'),
      stacks: document.querySelectorAll('#oppOvStacks .tv-stack-card').length,
      played: game.players[1].playedCards.length,
      ringShown: vis(ring) && r.width > 4,
      ringPct: ring ? ((r.left + r.width / 2 - wrap.left) / wrap.width) * 100 : -1,
      expectPct: BOARD_OV_TRACK.lefts[game.players[1].sliderPosition],
      statsShown: vis(document.getElementById('oppOvStats')),
      toggleShown: vis(document.getElementById('oppOvToggle')),
      chipsShown: vis(rail) && rail.children.length >= 10,   // 4 purse + 6 skills minimum
      panelShown: vis(document.getElementById('oppOvPanel')),
      boardLeftOfStacks: (() => {
        const b = document.querySelector('.opp-ov-boardwrap').getBoundingClientRect();
        const s = document.getElementById('oppOvStacks').getBoundingClientRect();
        return b.right <= s.left + 2;
      })(),
    };
  });
  ok(opp.active, 'rival chip opens the rival overlay');
  ok(opp.stacks === opp.played && opp.played >= 1,
    `their played cards show immediately as stacks (${opp.stacks}/${opp.played})`);
  ok(opp.boardLeftOfStacks, 'board sits left, cards beside it');
  ok(opp.ringShown && Math.abs(opp.ringPct - opp.expectPct) < 2,
    `their ring rides the board track (${opp.ringPct.toFixed(1)}% vs ${opp.expectPct}%)`);
  ok(opp.chipsShown && !opp.panelShown, 'their purse + summed skills ride the HUD chip rail (desktop panel hidden)');
  ok(!opp.statsShown, 'no stat pills — chips, board and cards carry it all');
  ok(!opp.toggleShown, 'no View Played Cards toggle');
  await page.screenshot({ path: join(SHOTS, 'hud-rival-overlay.png') });
  await page.evaluate(() => closeOppOverlay());
  await sleep(250);

  // Your chip and the board thumb both open the board overlay.
  await page.evaluate(() => document.querySelector('#tvSeats .pmat.you').click());
  await sleep(300);
  ok(await page.evaluate(() => document.getElementById('boardOverlay').classList.contains('active')), 'your chip opens the board overlay');
  await page.keyboard.press('Escape');
  await sleep(250);
  await page.evaluate(() => document.getElementById('tvBoardThumb').click());
  await sleep(300);
  ok(await page.evaluate(() => document.getElementById('boardOverlay').classList.contains('active')), 'board thumb opens the board overlay');
  const thumbRing = await page.evaluate(() => {
    const ring = document.querySelector('#tvBoardThumb .thumb-ring');
    if (!ring) return null;
    const wrap = document.getElementById('tvBoardThumb').getBoundingClientRect();
    const r = ring.getBoundingClientRect();
    return {
      centerPct: ((r.left + r.width / 2 - wrap.left) / wrap.width) * 100,
      expect: BOARD_OV_TRACK.lefts[game.players[0].sliderPosition],
    };
  });
  ok(thumbRing && Math.abs(thumbRing.centerPct - thumbRing.expect) < 2,
    `thumb ring rides the overlay track (${thumbRing && thumbRing.centerPct.toFixed(1)}% vs ${thumbRing && thumbRing.expect}%)`);
  await page.keyboard.press('Escape');
  await sleep(250);

  // Mission rail thumb → the browser.
  await page.evaluate(() => document.querySelector('#tvMissionRail .tv-mission:not(.ghost)').click());
  await sleep(300);
  ok(await page.evaluate(() => document.getElementById('missionLB').classList.contains('active')), 'mission thumb opens the browser');
  await page.keyboard.press('Escape');
  await sleep(250);

  // Mission Journal: the rail chip is a journal button now — no ✓/✕
  // tally. Inside: Current + Completed as BIG cards; failed absent;
  // tapping a current card layers the browser (with Turn In) on top,
  // closing the browser lands BACK on the journal.
  const chip = await page.evaluate(() => {
    const c = document.querySelector('.tv-mym');
    return { text: c.textContent, hasIcon: !!c.querySelector('.mym-icon') };
  });
  ok(!/[✓✕●]/.test(chip.text) && chip.hasIcon, 'rail chip is a journal button (no tally glyphs)');
  await page.evaluate(() => document.querySelector('.tv-mym').click());
  await sleep(400);
  const mj = await page.evaluate(() => ({
    open: document.getElementById('missionJournal').classList.contains('active'),
    sections: [...document.querySelectorAll('#mjBody .mj-section-title')].map(t => t.textContent),
    current: document.querySelectorAll('#mjBody .mj-card:not(.done)').length,
    done: document.querySelectorAll('#mjBody .mj-card.done').length,
    failedShown: [...document.querySelectorAll('#mjBody .mj-card img')]
      .some(i => (game.players[0].failedMissions || []).some(f => f.name === i.alt)),
    dueNote: document.querySelector('#mjBody .mj-card:not(.done) .mj-due')?.textContent || '',
  }));
  ok(mj.open, 'journal button opens the Mission Journal');
  ok(mj.sections.length === 2 && /Current/.test(mj.sections[0]) && /Completed/.test(mj.sections[1]),
    `journal has Current + Completed sections (${mj.sections.join(' / ')})`);
  ok(mj.current >= 1 && mj.done >= 1, `both sections hold cards (${mj.current} current, ${mj.done} done)`);
  ok(!mj.failedShown, 'failed missions do NOT appear in the journal');
  ok(/Due/.test(mj.dueNote), `current cards carry a due note (${mj.dueNote})`);
  await page.screenshot({ path: join(SHOTS, 'hud-mission-journal.png') });
  await page.evaluate(() => document.querySelector('#mjBody .mj-card:not(.done)').click());
  await sleep(500);
  const layered = await page.evaluate(() => ({
    lb: document.getElementById('missionLB').classList.contains('active'),
    journalStillUp: document.getElementById('missionJournal').classList.contains('active'),
    turnIn: !!document.getElementById('missionTurnIn'),
  }));
  ok(layered.lb && layered.turnIn, 'journal card opens the browser focused with Turn In');
  ok(layered.journalStillUp, 'journal keeps the stage beneath the browser');
  await page.evaluate(() => closeMissionLB());
  await sleep(300);
  const backTo = await page.evaluate(() => ({
    journal: document.getElementById('missionJournal').classList.contains('active'),
    panel: document.getElementById('actionPanel').classList.contains('active'),
  }));
  ok(backTo.journal && !backTo.panel, 'closing the browser lands back on the journal (panel stays aside)');
  await page.keyboard.press('Escape');
  await sleep(250);

  // Gear menu is removed (Wyatt 7/6): nothing but the four purse chips top-left.
  ok(await page.evaluate(() =>
    !document.querySelector('.tv-gear') && document.querySelectorAll('#tvPurse .tv-purse-chip').length === 4),
    'purse is four chips, no gear button');

  // Panel-aside: reveal chooser up → rival chip → panel steps aside → returns on close.
  await throwAndAwaitChoice(page, 0);
  ok(await page.evaluate(() => document.getElementById('actionPanel').classList.contains('active')), 'reveal chooser opens at your activation slot');
  await page.evaluate(() => document.querySelector('#tvSeats .pmat.opp').click());
  await sleep(350);
  const aside = await page.evaluate(() => ({
    ov: document.getElementById('oppOverlay').classList.contains('active'),
    panel: document.getElementById('actionPanel').classList.contains('active'),
  }));
  ok(aside.ov && !aside.panel, 'action panel steps aside while the overlay has the stage');
  await page.screenshot({ path: join(SHOTS, 'hud-panel-aside.png') });
  await page.evaluate(() => closeOppOverlay());
  await sleep(400);
  ok(await page.evaluate(() => document.getElementById('actionPanel').classList.contains('active')),
    'action panel returns when the overlay closes');
  // Answer it honestly — a forced dismissal would strand the round's await.
  await answerChoice(page, /discard \(\+3g\)/);
  await sleep(400);

  // The strip stays on stage even with no cards to hold.
  await page.evaluate(() => { game.players[0].hand = []; game.phase = 'activate'; renderGameState(); });
  await sleep(250);
  ok(await page.evaluate(() => {
    const strip = document.getElementById('tvHandStrip');
    const r = strip.getBoundingClientRect();
    return r.width > 0 && r.top < window.innerHeight;
  }), 'hand strip stays visible between hands');

  // Delta FX aimed at the chip rail stay on-screen (top-edge targets flip
  // to the downward drop — the classic climb would start above the screen).
  const fxCheck = await page.evaluate(async () => {
    // The real round played above leaves its own token-drop in flight —
    // clear the stage so exactly the two probes below are measured.
    const fxHost = document.getElementById('tvFx'); if (fxHost) fxHost.innerHTML = '';
    tvDropToken(tvMatEl(1), 'gold', 3);
    tvAnimateNewCard(tvMatEl(2), FAVOR_DATA.cards.find(c => c.name === 'Hunting'));
    await new Promise(r => setTimeout(r, 420));
    return [...document.querySelectorAll('#tvFx > *')].map(el => {
      const r = el.getBoundingClientRect();
      return { cls: el.className, onScreen: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight };
    });
  });
  ok(fxCheck.length === 2 && fxCheck.every(f => f.onScreen && / below/.test(f.cls)),
    `chip-rail delta FX play on-screen (${fxCheck.map(f => f.cls.split(' ')[0] + (f.onScreen ? '·ok' : '·OFF')).join(', ')})`);
  await sleep(900);

  // Coach marks anchor the new zones and never speak drawer.
  const coach = await page.evaluate(async () => {
    game.phase = 'gameplay';
    game.players[0].hand = [{ ...FAVOR_DATA.cards.find(c => c.name === 'First Aid') }];
    resetCoach();
    renderGameState();
    await new Promise(r => setTimeout(r, 500));
    const c = document.getElementById('coach');
    const g = document.getElementById('coach-glow').getBoundingClientRect();
    const chip = document.querySelector('#tvSeats .pmat.you').getBoundingClientRect();
    const overlap = !(g.right < chip.left || g.left > chip.right || g.bottom < chip.top || g.top > chip.bottom);
    const allCopy = COACH_STEPS.map(s => s.text).join(' ');
    return {
      shown: c.classList.contains('show'),
      firstIsWelcome: /seated at the table/i.test(c.textContent),
      anchored: overlap,
      cleanCopy: !/drawer|arrow/i.test(allCopy),
    };
  });
  ok(coach.shown && coach.firstIsWelcome && coach.anchored, 'welcome tip shows framed on your seat chip');
  ok(coach.cleanCopy, 'no coach copy mentions drawers or arrows');
  await page.evaluate(() => skipAllCoach());
  await page.close();
}

// ═══ PHONE: the HUD holds at every reference viewport — 5-player worst case ═══
console.log('── Phone: 844/932/667 × 5 players — zones fit, nothing overlaps, no h-scroll');
for (const [w, h] of [[844, 390], [932, 430], [667, 375]]) {
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`vp${w}: ` + m.text()); });
  page.on('pageerror', e => consoleErrors.push(`vp${w} pageerror: ` + e.message));
  await page.setViewport({ width: w, height: h, hasTouch: true, isMobile: true });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    // Layout flow — pin the seed (seat 0, no personas, no boon) so chip
    // sizes and zone fits never depend on who happened to sit down.
    window._pinEmblemSeed = 0;
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card') && document.querySelector('.character-card').offsetParent, { timeout: 20000 });
  await page.evaluate(() => {
    localStorage.setItem('favorQueue', '5');   // the menu queue picker owns table size now
    document.querySelector('.character-card').click();
  });
  // 7/20 §2: a tap opens the fullscreen board read — Confirm lives there.
  await page.waitForFunction(() => document.getElementById('charDetail').classList.contains('active'), { timeout: 20000 });
  await page.evaluate(() => document.getElementById('cdConfirm').click());
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players.length === 5, { timeout: 20000 });
  await sleep(1000);
  await page.evaluate(() => {
    // Fullest rails: all skills + a flex chip + a special + missions.
    const p = game.players[0];
    p.skills = { survival: 2, charisma: 1, alchemy: 3, prospecting: 1, knowledge: 2, power: 1 };
    p.flexSkills = [['charisma', 'prospecting']];
    p.philosopherStone = 1;
    p.missions = [{ ...FAVOR_DATA.missions[3] }];
    p.completedMissions = [{ ...FAVOR_DATA.missions[4] }];
    if (typeof skipAllCoach === 'function') skipAllCoach();
    renderGameState();
    document.getElementById('notifications').innerHTML = '';
    const fx = document.getElementById('tvFx'); if (fx) fx.innerHTML = '';
  });
  await sleep(300);
  await page.evaluate(() => {   // pill fixture: visible as in a worded phase
    const b = document.getElementById('phaseBar');
    b.style.display = '';
    if (!b.textContent.trim()) b.innerHTML =
      '<span class="act-tag">Act I</span><span class="phase-text">Missions</span>';
  });
  const m = await page.evaluate(() => {
    const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { id, l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const zones = ['tvPurse', 'tvSkills', 'tvSeats', 'tvMissionRail', 'tvBoardThumb', 'phaseBar'].map(rect);
    const z = id => zones.find(x => x.id === id);
    const overlap = (a, b) => !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
    const pairs = [
      ['tvPurse', 'tvSeats'], ['tvSeats', 'tvMissionRail'], ['tvPurse', 'tvMissionRail'],
      ['tvPurse', 'phaseBar'], ['tvSeats', 'phaseBar'], ['phaseBar', 'tvMissionRail'],
      ['tvMissionRail', 'tvBoardThumb'], ['phaseBar', 'tvBoardThumb'],
    ];
    return {
      chips: document.querySelectorAll('#tvSeats .pmat[data-pi]').length,
      hits: pairs.filter(([a, b]) => overlap(z(a), z(b))).map(p => p.join('×')),
      off: zones.filter(x => x.l < -1 || x.t < -1 || x.r > window.innerWidth + 1 || x.b > window.innerHeight + 1).map(x => x.id),
      hscroll: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  ok(m.chips === 5, `${w}x${h}: five seat chips render (${m.chips})`);
  ok(m.hits.length === 0, `${w}x${h}: no HUD zones overlap (${m.hits.join(', ') || 'clean'})`);
  ok(m.off.length === 0, `${w}x${h}: every zone fully on-screen (${m.off.join(', ') || 'clean'})`);
  ok(!m.hscroll, `${w}x${h}: no horizontal scroll`);
  await page.screenshot({ path: join(SHOTS, `hud-5p-${w}x${h}.png`) });
  await page.close();
}

// ═══ JUICY STATS: phone 2-col rail + desktop token totem fit their screens ═══
console.log('── Juicy stats: phone purse/rail two-column, desktop panel + strip fit');
{
  // Phone: purse 2×2, skill rail 2 columns, both clear of the stage.
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('juicy-phone: ' + m.text()); });
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(page);
  await page.evaluate(() => {
    const p = game.players[0];
    p.gold = 12; p.favor = 4; p.scorn = 2; p.prestige = 4;
    p.skills = { survival: 2, charisma: 1, alchemy: 0, prospecting: 3, knowledge: 1, power: 2 };
    p.flexSkills = [['charisma', 'prospecting']];
    p.philosopherStone = 1;
    renderGameState();
  });
  await sleep(500);
  const ph = await page.evaluate(() => {
    const purse = [...document.querySelectorAll('.tv-purse-chip')].map(c => c.getBoundingClientRect());
    const chips = [...document.querySelectorAll('.tv-skill-chip')].map(c => c.getBoundingClientRect());
    const icon = document.querySelector('.tv-purse-chip img').getBoundingClientRect();
    const numFs = parseFloat(getComputedStyle(document.querySelector('.tv-skill-chip b')).fontSize);
    const stage = document.querySelector('.tv-stage').getBoundingClientRect();
    const railRight = Math.max(...chips.map(r => r.right), ...purse.map(r => r.right));
    return {
      purse2col: purse.length === 4 && Math.abs(purse[0].top - purse[1].top) < 2 && purse[2].top > purse[0].bottom - 2,
      rail2col: chips.length >= 6 && Math.abs(chips[0].top - chips[1].top) < 2 && chips[2].top > chips[0].bottom - 2,
      iconW: icon.width, numFs,
      chipCount: chips.length,
      lastChipBottom: Math.max(...chips.map(r => r.bottom)), vh: window.innerHeight,
      railClearsStage: railRight <= stage.left + 1,
    };
  });
  ok(ph.purse2col, 'phone purse is a 2×2 grid of big chips');
  ok(ph.rail2col, `phone skill rail flows two columns (${ph.chipCount} chips)`);
  ok(ph.iconW >= 30, `purse icons are juicy (${Math.round(ph.iconW)}px ≥ 30)`);
  ok(ph.numFs >= 18, `rail numbers are juicy (${ph.numFs}px ≥ 18)`);
  ok(ph.lastChipBottom <= ph.vh - 100, `all ${ph.chipCount} chips clear the hand strip (${Math.round(ph.lastChipBottom)} ≤ ${ph.vh - 100})`);
  ok(ph.railClearsStage, 'rail clears the stage cards');
  await page.close();

  // Desktop, both target sizes, WORST-CASE rows (flex + phil stone):
  // panel must not scroll, strip must sit fully on-screen below it.
  for (const [w, h, minVal] of [[1440, 900, 30], [1280, 800, 24]]) {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push('juicy-desktop: ' + m.text()); });
    await page.setViewport({ width: w, height: h });
    await startGame(page);
    await page.evaluate(() => {
      const p = game.players[0];
      p.gold = 12; p.favor = 4; p.scorn = 2; p.prestige = 4;
      p.skills = { survival: 2, charisma: 1, alchemy: 0, prospecting: 3, knowledge: 1, power: 2 };
      p.flexSkills = [['charisma', 'prospecting']];
      p.philosopherStone = 1;
      renderGameState();
    });
    await sleep(600);
    const d = await page.evaluate(() => {
      const panel = document.getElementById('statsPanel');
      const strip = document.getElementById('missionStrip');
      const stacks = document.getElementById('cardStacks').getBoundingClientRect();
      const pr = panel.getBoundingClientRect(), sr = strip.getBoundingClientRect();
      return {
        noScroll: panel.scrollHeight <= panel.clientHeight + 1,
        panelBottom: pr.bottom, stripTop: sr.top, stripBottom: sr.bottom,
        vh: window.innerHeight,
        tokenVal: parseFloat(getComputedStyle(document.querySelector('.token-val')).fontSize),
        stacksClear: stacks.left >= pr.right - 1,
      };
    });
    ok(d.noScroll, `${w}x${h}: stats panel shows everything, no inner scroll`);
    ok(d.stripTop >= d.panelBottom, `${w}x${h}: mission strip sits below the panel`);
    ok(d.stripBottom <= d.vh + 1, `${w}x${h}: mission strip fully on-screen (${Math.round(d.stripBottom)} ≤ ${d.vh})`);
    ok(d.tokenVal >= minVal, `${w}x${h}: token numbers juicy (${d.tokenVal}px ≥ ${minVal})`);
    ok(d.stacksClear, `${w}x${h}: card stacks clear the wider panel`);
    await page.screenshot({ path: join(SHOTS, `juicy-stats-${w}x${h}.png`) });
    await page.close();
  }
}

// ═══ DESKTOP: played cards stack by FAMILY (card color) — potions show ═══
console.log('── Desktop: stacks group by card family — a played potion is on the field');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('stacks: ' + m.text()); });
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);
  await page.evaluate(() => {
    const p = game.players[0];
    const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    // Mind Eraser is the rulebook's POTION exemplar. Concoction stood here
    // until 7/19, when the card-art audit found it wearing a blue ENDEAVOR
    // frame — one of 20 cards typed from a false "border colour = act" premise.
    p.playedCards = [pick('Great North Connection'), pick('Family Ring'),
                     pick('Mind Eraser'), pick('Mining Guild'), pick("Philosopher's Stone")];
    renderGameState();
  });
  await sleep(400);
  const st = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('#cardStacks .stack-label')].map(l => l.textContent),
    colored: [...document.querySelectorAll('#cardStacks .card-stack')]
      .every(s => (s.getAttribute('style') || '').includes('--typeC')),
  }));
  // Five families, in the rulebook's own IDEAL CARD PLACEMENT order (p.11):
  // Adventures -> Artifacts -> Weapons -> Wisdom -> Endeavors -> Potions.
  ok(st.labels.join('|') === 'Adventures|Artifacts|Wisdom|Endeavors|Potions',
    `stacks read by family, in placement order (${st.labels.join(', ')})`);
  ok(st.colored, 'every family label wears its color');
  await page.screenshot({ path: join(SHOTS, 'stacks-by-family.png') });
  await page.close();
}

// ═══ DESKTOP: final card keeps its choices ═══
console.log('── Desktop: last two cards — player chooses BOTH fates');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('desktop: ' + m.text()); });
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  // Trim to exactly two known cards through the engine.
  await page.evaluate(() => {
    const p = game.players[0];
    p.gold = 30;
    const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    p.hand = [pick('First Aid'), pick('Trapping')];
    p.skills.power = 1; // Trapping/First Aid reqs safety
    renderGameState();
  });
  await sleep(400);

  // Throw through the REAL path: a 2-card hand pairs both face down, and
  // the reveal presents TWO choosers back to back — picked card first.
  await throwAndAwaitChoice(page, 0);
  ok(await page.evaluate(() =>
    /your card is revealed/i.test(document.querySelector('.action-panel').textContent)),
    'the picked card reveals with its own chooser first');
  await answerChoice(page, /play/);

  // The FINAL card must present a choice panel, not auto-resolve.
  let choiceShown = false;
  try {
    await page.waitForFunction(() =>
      window._finalChoicePending === true &&
      document.querySelector('.action-panel.active') &&
      /final card/i.test(document.querySelector('.action-panel').textContent), { timeout: 9000 });
    choiceShown = true;
  } catch (e) {}
  await page.screenshot({ path: join(SHOTS, 'final-card-choice.png') });
  ok(choiceShown, 'final card shows its own action panel');

  // The chooser must SHOW the card — it lives in pending, nothing blooms
  // beside the panel, so the panel itself carries the art (Wyatt, 7/11).
  const art = await page.evaluate(() => {
    const panel = document.querySelector('.action-panel');
    const img = panel && panel.querySelector('.action-card-img');
    const r = img ? img.getBoundingClientRect() : { width: 0 };
    return { final: !!(panel && panel.classList.contains('final-choice')), w: r.width };
  });
  ok(art.final && art.w > 80, `final chooser shows the card art (${Math.round(art.w)}px wide)`);

  if (choiceShown) {
    const acted = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.action-panel [data-act]')].find(x => x.dataset.act === 'play' || x.dataset.act === 'discard');
      if (!b) return null;
      const act = b.dataset.act;
      b.click();
      return act;
    });
    await sleep(2500);
    const state = await page.evaluate(() => ({
      played: game.players[0].playedCards.length,
      pendingCleared: !game.pendingActivations[0],
    }));
    ok(acted && state.pendingCleared, `choice applied (${acted}), round continued`);
  }
  await page.close();
}

// ═══ LAST-TWO RULE: each player's pair activates back-to-back ═══
console.log('── Final round order: last two cards play in a row, never interleaved');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('lasttwo: ' + m.text()); });
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  // Rig the FINAL round — everyone holds their last two (inert) cards —
  // and trace the true activation order off the engine call itself.
  await page.evaluate(() => {
    window.CINEMATIC_SPEED = 0.05;
    const fa = FAVOR_DATA.cards.find(c => c.name === 'First Aid');
    game.players.forEach((p, i) => {
      p.hand = [{ ...fa, id: `lt_a_${i}` }, { ...fa, id: `lt_b_${i}` }];
    });
    game.pendingActivations = new Array(game.playerCount).fill(null);
    game.phase = 'gameplay';
    window._trace = [];
    const real = game.activateCard.bind(game);
    game.activateCard = (pi, cardId, mode, extra) => {
      window._trace.push(pi);
      return real(pi, cardId, mode, extra);
    };
    renderGameState();
  });
  await sleep(300);
  // Throw the pair in and reveal: chooser #1 = the picked card, with
  // nothing activated yet anywhere at the table.
  await throwAndAwaitChoice(page, 0);
  ok(await page.evaluate(() => window._trace.length === 0),
    'the reveal chooser opens before anything has activated');
  await page.evaluate(() => {
    const b = document.querySelector('#actionPanel [data-act="play"]') ||
              document.querySelector('#actionPanel [data-act="discard"]');
    b.click();
  });

  // Your leftover's chooser must open before ANY rival has activated.
  await page.waitForFunction(() => window._finalChoicePending === true, { timeout: 12000 });
  const beforeRivals = await page.evaluate(() => window._trace.every(pi => pi === 0));
  ok(beforeRivals, 'your second card presents its chooser before any rival plays');

  await page.evaluate(() => {
    const b = document.querySelector('#actionPanel [data-act="play"]') ||
              document.querySelector('#actionPanel [data-act="discard"]');
    b.click();
  });
  await page.waitForFunction(() => window._trace && window._trace.length >= 6, { timeout: 30000 });
  const seats = await page.evaluate(() => window._trace.slice(0, 6));
  ok(seats[0] === 0 && seats[1] === 0 && seats[2] === seats[3] &&
     seats[4] === seats[5] && seats[2] !== seats[4],
    `pairs contiguous — order ${seats.join(',')} (both last cards in a row, no one in between)`);
  await page.close();
}

// ═══ HERO SELECT: three choices, picking auto-scrolls to Begin ═══
console.log('── Hero select: 3 random heroes, bots draw from the leftovers, scroll to Begin');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('hero-select: ' + m.text()); });
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    return b && b.offsetParent;
  }, { timeout: 20000 });
  await page.evaluate(() => {
    // This flow keeps the REAL seed path (offer/seating fuzz) but must
    // not enter the live matchmaking queue.
    window._mpSkipQueue = true;
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card')?.offsetParent, { timeout: 20000 });
  const sel = await page.evaluate(() => ({
    cards: document.querySelectorAll('.character-card').length,
    roster: window.FAVOR_DATA.characters.length,
    btnHidden: document.getElementById('confirmBtn').style.display === 'none',
  }));
  ok(sel.cards === 3, `exactly three heroes offered (${sel.cards} of ${sel.roster})`);
  ok(sel.btnHidden, 'Begin stays hidden until a hero is picked');

  // 7/20 §2: tapping a hero opens the near-fullscreen board read — the
  // Begin-on-grid step and the FLIP-to-center ring are retired; Confirm
  // lives inside the detail view.
  const offered = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.character-card')];
    cards[cards.length - 1].click();
    return cards.map(c => c.dataset.id);
  });
  await sleep(400);
  const detail = await page.evaluate(() => ({
    open: document.getElementById('charDetail').classList.contains('active'),
    hero: (document.querySelector('#charDetail .cd-title h2') || {}).textContent || '',
    ring: !!document.querySelector('#charDetail .cd-ring'),
    epithets: [...document.querySelectorAll('.character-card')].every(c => c.querySelector('.epithet')),
  }));
  ok(detail.open && detail.ring,
    `tap opens the compact board read, ring on the center slot (${detail.hero})`);
  ok(detail.epithets, 'every offering wears its printed epithet');
  await page.screenshot({ path: join(SHOTS, 'hero-select-3.png') });

  // Confirm from the detail — and every bot drew from the NON-offered seven.
  await page.evaluate(() => document.getElementById('cdConfirm').click());
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 20000 });
  const bots = await page.evaluate(() => game.players.slice(1).map(p => p.character.id));
  const youTook = await page.evaluate(() => game.players[0].character.id);
  ok(bots.every(id => !offered.includes(id)),
    `bots drew from the leftovers (${bots.join(', ')} ∉ offered ${offered.join(', ')})`);
  ok(!bots.includes(youTook), 'nobody doubles your hero');
  await page.close();
}

// ═══ DESKTOP: rival rail — quiet entries, REAL click opens the whole spread ═══
console.log('── Desktop: rival rail entries + overlay (real mouse click)');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('rail: ' + m.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  await startGame(page);
  await page.evaluate(() => {
    const take = (names) => names.map(n => ({ ...FAVOR_DATA.cards.find(c => c.name === n) }));
    const r = game.players[1];
    r.playedCards = take(['First Aid', 'Trapping', 'Hunting']);
    r.gold = 9; r.favor = 6; r.scorn = 1; r.prestige = 12; r.sliderPosition = 3;
    game.emblemHolder = 1;
    renderGameState();
  });
  await sleep(500);

  const rail = await page.evaluate(() => ({
    ringDots: document.querySelectorAll('.opp-ring-row, .opp-entry .ring-dot').length,
    statPills: document.querySelectorAll('.opp-entry .stat-pill').length,
    goldArt: document.querySelectorAll('.opp-entry .opp-gold-row img').length,
    emblems: document.querySelectorAll('.opp-entry .emblem-badge').length,
    emoji: /[\u{1FA99}\u{2B50}\u{1F451}]/u.test(document.getElementById('gameSidebar').innerHTML),
  }));
  ok(rail.ringDots === 0, 'rail: 1-5 ring-dot rows are gone');
  ok(rail.statPills === 0, 'rail: favor/scorn pills are gone');
  ok(rail.goldArt >= 2, `rail: gold shows as real coin art (${rail.goldArt} entries)`);
  ok(rail.emblems === 1, 'rail: emblem holder wears the Emblem token, not an emoji');
  ok(!rail.emoji, 'rail: zero emoji glyphs in the sidebar');

  // The regression that mattered: a REAL mouse click on the FIRST entry's
  // top band (where the floating log/music buttons used to sit and eat
  // the click). elementFromPoint + mouse.click — no synthetic el.click().
  const spot = await page.evaluate(() => {
    const e = document.querySelector('.opp-entry');
    const r = e.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + 10);
    return { x: r.left + r.width / 2, y: r.top + 10, clear: e.contains(el),
             hit: el ? (el.id || el.className.toString().slice(0, 30)) : 'none' };
  });
  ok(spot.clear, `first entry's top band takes the click (hit: ${spot.hit})`);
  await page.mouse.click(spot.x, spot.y);
  await sleep(700);
  const ov = await page.evaluate(() => {
    const ring = document.getElementById('oppOvRing').getBoundingClientRect();
    const board = document.getElementById('oppOvBoard').getBoundingClientRect();
    const panel = document.getElementById('oppOvPanel');
    const pr = panel.getBoundingClientRect();
    return {
      open: document.getElementById('oppOverlay').classList.contains('active'),
      boardBig: board.height > 250,
      ringOnBoard: ring.width > 10 && ring.left > board.left && ring.right < board.right,
      ringLeft: document.getElementById('oppOvRing').style.left,
      cards: document.querySelectorAll('#oppOvCards img').length,
      pillArt: document.querySelectorAll('#oppOvStats .pill-icon').length,
      panelShown: panel.offsetParent !== null && pr.width > 100,
      panelSkillRows: panel.querySelectorAll('.skill-row:not(.flex-skill):not(.special-ability)').length,
      panelTokens: panel.querySelectorAll('.token-val').length,
      panelLeftOfBoard: pr.right <= board.left + 2,
      panelIn: pr.top >= 0 && pr.bottom <= window.innerHeight + 1,
      chipsHidden: (() => { const c = document.getElementById('oppOvChips'); return !c || c.offsetParent === null; })(),
    };
  });
  ok(ov.open, 'REAL click on the rail opens the rival overlay');
  ok(ov.boardBig, 'overlay board is big (desktop)');
  ok(ov.ringOnBoard && ov.ringLeft === '66.3%', `their ring rides the board track (${ov.ringLeft})`);
  ok(ov.cards === 3, `all played cards shown (${ov.cards})`);
  ok(ov.pillArt === 4, 'overlay stats use real token art');
  ok(ov.panelShown && ov.panelSkillRows === 6 && ov.panelTokens === 4,
    `their variables read like YOUR stats panel (6 skill rows, 4 tokens incl. Favor — got ${ov.panelSkillRows}/${ov.panelTokens})`);
  ok(ov.panelLeftOfBoard && ov.panelIn, 'panel sits left of the board, fully on-screen');
  ok(ov.chipsHidden, 'phone chip rail stays hidden on desktop');
  await page.screenshot({ path: join(SHOTS, 'rival-overlay-desktop.png') });
  await page.close();
}

// ═══ DESKTOP: hand outranks the phase pill without DOM-order luck ═══
console.log('── Desktop: hover-bloom and selected cards paint above the phase pill');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('desktop-pill: ' + m.text()); });
  // 620px tall: still desktop layout (compact needs ≤540), but short enough
  // that the 680px-capped bloom actually reaches the pill band at the top.
  await page.setViewport({ width: 1420, height: 620 });
  await startGame(page);
  await sleep(400);
  // Freeze the rivals' throw timers: their renders rebuild the hand DOM
  // under the stationary mouse and headless Chrome drops the :hover match
  // (the same trap the drag flows freeze against).
  await page.evaluate(() => {
    for (let i = 1; i < game.playerCount; i++) {
      if (game.pendingActivations[i]) game.unpickCard(i);
    }
    window.CINEMATIC_SPEED = 1000;
    beginThrowPhase();
    renderGameState();
  });
  await sleep(200);

  await page.evaluate(() => {   // pill fixture: visible as in a worded phase
    const b = document.getElementById('phaseBar');
    b.style.display = '';
    if (!b.textContent.trim()) b.innerHTML =
      '<span class="act-tag">Act I</span><span class="phase-text">Missions</span>';
  });
  // Reparent restore: on desktop the pill lives at game-screen level.
  const home = await page.evaluate(() => {
    const pill = document.getElementById('phaseBar');
    return {
      inTable: document.getElementById('table-view').contains(pill),
      inScreen: document.getElementById('game-screen').contains(pill),
    };
  });
  ok(!home.inTable && home.inScreen, 'phase pill parked at #game-screen level on desktop');

  // Hover-bloom the center card with a REAL mouse move; the bloom reaches
  // the pill band, and the card must win the hit-test there.
  const c = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.hand-zone .hand-card')];
    const mid = cards[Math.floor(cards.length / 2)];
    const r = mid.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(c.x, c.y);
  await sleep(450);
  const hoverLayer = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.hand-zone .hand-card')]
      .find(x => x.matches(':hover'));
    const pill = document.getElementById('phaseBar');
    if (!b || !pill) return { miss: true };
    const br = b.getBoundingClientRect(), pr = pill.getBoundingClientRect();
    const l = Math.max(br.left, pr.left), r = Math.min(br.right, pr.right);
    const t = Math.max(br.top, pr.top), bo = Math.min(br.bottom, pr.bottom);
    if (l >= r || t >= bo) return { overlap: false };
    const el = document.elementFromPoint((l + r) / 2, (t + bo) / 2);
    return { overlap: true, hitCard: b === el || b.contains(el),
             hit: el ? (el.className.toString() || el.id || el.tagName) : 'none' };
  });
  ok(hoverLayer.overlap === true, 'desktop hover-bloom overlaps the pill (fixture valid)');
  ok(hoverLayer.hitCard === true, `hover-bloomed card paints ABOVE the pill (hit: ${hoverLayer.hit})`);
  await page.screenshot({ path: join(SHOTS, 'desktop-pill-bloom.png') });

  // (The old .selected z-duel checks retired with the pick-time panel —
  // clicking no longer selects; hover-bloom above is the whole story.)
  await page.close();
}

// ═══ MISSION BROWSER: one click shows the whole row, never spends anything ═══
console.log('── Mission browser: full set, focus browsing, Life Essence stays held');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('mission-browser: ' + m.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  await startGame(page);
  await page.evaluate(() => {
    const p = game.players[0];
    p.missions = [{ ...FAVOR_DATA.missions.find(m => m.name === 'A Day With the Birds') }];
    p.completedMissions = [{ ...FAVOR_DATA.missions.find(m => m.name !== 'A Day With the Birds') }];
    p.skills.knowledge = 3;   // meets A Day With the Birds on merits
    // The realm deal is random and taking a mission REMOVES it from the
    // row (engine: chooseMission splices + replaces) — if the deal put
    // the rigged held mission on the realm row too, swap it for one that
    // isn't in play, or "no Turn In on realm missions" flakes by name.
    const inPlay = new Set([...p.missions, ...p.completedMissions, ...game.visibleMissions].map(m => m.name));
    game.visibleMissions = game.visibleMissions.map(m =>
      m.name === 'A Day With the Birds'
        ? { ...FAVOR_DATA.missions.find(x => !inPlay.has(x.name)) }
        : m);
    renderGameState();
  });
  await sleep(500);

  // From an AVAILABLE pip: the browser shows ALL the realm's missions.
  const realm = await page.evaluate(() => {
    const visible = game.getState(0).visibleMissions.map(m => m.name);
    const pip = document.querySelector('.mission-pip.available');
    const clicked = pip.alt;
    pip.click();
    return { visible, clicked };
  });
  await sleep(600);
  const realmView = await page.evaluate(() => ({
    open: document.getElementById('missionLB').classList.contains('active'),
    title: document.getElementById('mbTitle').textContent,
    cards: document.querySelectorAll('#mbTrack .mb-card').length,
    focusLabel: document.getElementById('missionLBLabel').textContent,
    turnIn: !!document.getElementById('missionTurnIn'),
  }));
  ok(realmView.open, 'available pip opens the browser');
  ok(realmView.title === 'Missions of the Realm', `realm set titled right (${realmView.title})`);
  ok(realmView.cards === realm.visible.length && realmView.cards >= 2,
    `ALL ${realm.visible.length} realm missions laid out (${realmView.cards})`);
  ok(realmView.focusLabel === realm.clicked, `clicked mission opens focused (${realmView.focusLabel})`);
  ok(!realmView.turnIn, 'no Turn In on missions that are not yours');
  await page.screenshot({ path: join(SHOTS, 'mission-browser-realm.png') });

  // Arrows and click-to-focus move the center.
  await page.evaluate(() => mbStep(1));
  await sleep(500);
  const after = await page.evaluate(() => document.getElementById('missionLBLabel').textContent);
  ok(after === realm.visible[1], `arrow steps focus (${after})`);
  await page.evaluate(() => document.querySelector('#mbTrack .mb-card[data-i="0"]').click());
  await sleep(500);
  const back = await page.evaluate(() => document.getElementById('missionLBLabel').textContent);
  ok(back === realm.visible[0], 'clicking a card focuses it');

  // Tap-stability (Wyatt 7/17): a tapped mission KEEPS its focus while
  // the smooth scroll is still in flight — the mid-flight tracker used
  // to demote it back to the first card when iOS cancelled the glide.
  const stable = await page.evaluate(async () => {
    const last = document.querySelectorAll('#mbTrack .mb-card').length - 1;
    document.querySelector(`#mbTrack .mb-card[data-i="${last}"]`).click();
    const mid = await new Promise(r => setTimeout(() => r({
      i: _mbIndex, snapping: _mbSnapping,
      focusOn: (document.querySelector('#mbTrack .mb-card.focus') || { dataset: {} }).dataset.i,
    }), 120));
    await new Promise(r => setTimeout(r, 900));
    return {
      last: String(last), mid,
      settled: _mbIndex === last && !_mbSnapping,
      focusEnd: (document.querySelector('#mbTrack .mb-card.focus') || { dataset: {} }).dataset.i,
    };
  });
  ok(stable.mid.i === +stable.last && stable.mid.focusOn === stable.last && stable.mid.snapping,
    `mid-glide the tapped card holds focus (i=${stable.mid.i}, guard on)`);
  ok(stable.settled && stable.focusEnd === stable.last,
    'the glide settles on the tapped card and the guard releases');
  await page.evaluate(() => closeMissionLB());
  await sleep(200);

  // From YOUR pip: current + completed; Turn In only on the held one —
  // and a Life Essence BLESSING on the held mission survives the whole
  // browse (the old design consumed the essence just to label the button).
  const mine = await page.evaluate(() => {
    const p = game.players[0];
    p.missions[0]._reqWaived = true;   // Life Essence blessing on the held mission
    const goldBefore = p.gold;
    document.querySelector('.mission-pip.active').click();
    return { goldBefore, held: p.missions[0].name, done: p.completedMissions[0].name };
  });
  await sleep(600);
  const mineView = await page.evaluate(() => ({
    title: document.getElementById('mbTitle').textContent,
    cards: document.querySelectorAll('#mbTrack .mb-card').length,
    focusLabel: document.getElementById('missionLBLabel').textContent,
    turnIn: !!document.getElementById('missionTurnIn'),
    essence: !!(game.players[0].missions[0] && game.players[0].missions[0]._reqWaived),
  }));
  ok(mineView.title === 'Your Missions', 'your pip opens YOUR set');
  ok(mineView.cards === 2, `current + completed laid out (${mineView.cards})`);
  ok(mineView.focusLabel === mine.held && mineView.turnIn, 'held mission focused with Turn In attached');
  ok(mineView.essence === true, 'browsing leaves the Life Essence blessing intact');
  await page.evaluate(() => mbStep(1));
  await sleep(500);
  const doneView = await page.evaluate(() => ({
    label: document.getElementById('missionLBLabel').textContent,
    turnIn: !!document.getElementById('missionTurnIn'),
    essence: !!(game.players[0].missions[0] && game.players[0].missions[0]._reqWaived),
    gold: game.players[0].gold,
  }));
  ok(/completed/.test(doneView.label) && !doneView.turnIn, 'completed mission shows no Turn In');
  ok(doneView.essence === true && doneView.gold === mine.goldBefore,
    'browsing every card moved nothing (blessing held, gold unchanged)');
  await page.screenshot({ path: join(SHOTS, 'mission-browser-mine.png') });
  await page.evaluate(() => { delete game.players[0].missions[0]._reqWaived; closeMissionLB(); });
  await sleep(250);

  // Desktop entry: the strip's Journal button opens the same ledger.
  await page.evaluate(() => document.querySelector('.mj-open').click());
  await sleep(400);
  const dj = await page.evaluate(() => ({
    open: document.getElementById('missionJournal').classList.contains('active'),
    cards: document.querySelectorAll('#mjBody .mj-card').length,
  }));
  ok(dj.open && dj.cards === 2, `desktop Journal button opens the ledger (${dj.cards} cards)`);
  await page.screenshot({ path: join(SHOTS, 'mission-journal-desktop.png') });
  await page.evaluate(() => closeMissionJournal());
  await page.close();
}

// ═══ PHONE: mission browser panel-aside dance ═══
console.log('── Phone: rail thumb opens the browser, action panel steps aside');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('mb-phone: ' + m.text()); });
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(page);
  await sleep(400);
  await throwAndAwaitChoice(page, 0);
  const panelBefore = await page.evaluate(() => document.querySelector('.action-panel').classList.contains('active'));
  await page.evaluate(() => document.querySelector('.tv-mission').click());
  await sleep(600);
  const mid = await page.evaluate(() => ({
    open: document.getElementById('missionLB').classList.contains('active'),
    cards: document.querySelectorAll('#mbTrack .mb-card').length,
    panel: document.querySelector('.action-panel').classList.contains('active'),
  }));
  ok(panelBefore, 'reveal chooser was up (fixture valid)');
  ok(mid.open && mid.cards >= 2, `rail thumb opens the realm browser (${mid.cards} cards)`);
  ok(!mid.panel, 'action panel steps aside while the browser has the stage');
  await page.screenshot({ path: join(SHOTS, 'mission-browser-phone.png') });
  await page.evaluate(() => closeMissionLB());
  await sleep(300);
  const panelAfter = await page.evaluate(() => document.querySelector('.action-panel').classList.contains('active'));
  ok(panelAfter, 'action panel restores after the browser closes');
  await answerChoice(page, /discard \(\+3g\)/);
  await sleep(300);
  await page.close();
}

// ═══ DESKTOP: mission turn-in by choice ═══
console.log('── Desktop: held mission offers Turn In Now, resolves by choice');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('mission: ' + m.text()); });
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  await page.evaluate(() => {
    const p = game.players[0];
    p.missions = [{ ...FAVOR_DATA.missions.find(m => m.name === 'Wanted: Crazy Lou') }];
    game.phase = 'gameplay';
    renderGameState();
    openMissionBrowser('mine', 'Wanted: Crazy Lou');
  });
  await sleep(400);

  const unmet = await page.evaluate(() => {
    const b = document.getElementById('missionTurnIn');
    return { exists: !!b, text: b ? b.textContent : '', due: !!document.querySelector('.mission-lb-due') };
  });
  ok(unmet.exists, 'Turn In button present for held mission');
  ok(/fail/i.test(unmet.text), 'unmet mission warns it would FAIL');
  ok(unmet.due, 'due-act note shown for multi-act window');
  await page.screenshot({ path: join(SHOTS, 'mission-turnin.png') });

  await page.evaluate(() => {
    closeMissionLB();
    game.players[0].skills.power = 15;
    openMissionBrowser('mine', 'Wanted: Crazy Lou');
  });
  await sleep(300);
  const met = await page.evaluate(() => document.getElementById('missionTurnIn').textContent);
  ok(/requirements met/i.test(met), 'met mission offers success turn-in');
  await page.evaluate(() => document.getElementById('missionTurnIn').click());
  await sleep(600);
  const done = await page.evaluate(() => ({
    completed: game.players[0].completedMissions.length,
    held: game.players[0].missions.length,
  }));
  ok(done.completed === 1 && done.held === 0, 'turn-in completed the mission immediately');
  await page.close();
}

// ═══ DESKTOP: Chemical Y picker — choose ONE adventure to double ═══
console.log('── Desktop: Chemical Y presents the choose-one picker');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('chemY: ' + m.text()); });
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  // Rig: two adventures down, requirements met, Chemical Y as the pick.
  await page.evaluate(() => {
    const p = game.players[0];
    const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    p.playedCards.push(pick('Fur Trading'), pick('Forming a Bond'));
    p.skills.alchemy = 6;
    p.philosopherStone = 1;
    p.gold = 30;
    p.hand = [pick('Chemical Y'), pick('First Aid')];
    renderGameState();
  });
  await sleep(300);
  await throwAndAwaitChoice(page, 0);
  await answerChoice(page, /play/);

  let pickerShown = false;
  try {
    await page.waitForFunction(() =>
      document.getElementById('promisePicker').classList.contains('active') &&
      /Chemical Y/i.test(document.getElementById('promisePicker').textContent), { timeout: 9000 });
    pickerShown = true;
  } catch (e) {}
  await page.screenshot({ path: join(SHOTS, 'chemy-picker.png') });
  ok(pickerShown, 'Chemical Y picker appears on play');

  if (pickerShown) {
    const result = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#promisePicker .pp-card')];
      cards[cards.length - 1].click(); // choose the second adventure
      document.getElementById('chemYConfirm').click();
      return null;
    });
    await sleep(500);
    const state = await page.evaluate(() => ({
      doubled: game.players[0].playedCards.filter(c => c._favorDoubled).map(c => c.name),
      badge: document.querySelectorAll('.stack-card.doubled').length,
    }));
    ok(state.doubled.length === 1, `exactly one card doubled (${state.doubled.join(',')})`);
    ok(state.badge === 1, 'doubled card wears its gold ring in the stacks');
  }
  await page.close();
}

// ═══ LIFE ESSENCE PICKER: choose ONE active mission, requirement gone ═══
console.log('── Life Essence picker: bless one active mission, it probes free');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('lepick: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);

  // Two known active missions, no skills — then fire the picker exactly
  // as the post-activation hook does (fire-and-flag, never awaited here).
  await page.evaluate(() => {
    const p = game.players[0];
    const pool = FAVOR_DATA.missions;
    p.missions = [{ ...pool[0] }, { ...pool[6] }];
    p.skills.knowledge = 0;
    renderGameState();
    window._leDone = false;
    showLifeEssencePicker().then(() => { window._leDone = true; });
  });
  await page.waitForFunction(() =>
    document.getElementById('promisePicker').classList.contains('active') &&
    /Life Essence/i.test(document.getElementById('promisePicker').textContent), { timeout: 6000 });
  const view = await page.evaluate(() => ({
    cards: document.querySelectorAll('#promisePicker .pp-card').length,
    missionArt: [...document.querySelectorAll('#promisePicker .pp-card img')]
      .every(i => /assets\/cards\/missions\//.test(i.getAttribute('src'))),
    confirm: (document.getElementById('leConfirm') || {}).textContent || '',
  }));
  ok(view.cards === 2, `both active missions offered (${view.cards})`);
  ok(view.missionArt, 'the choices are the mission cards themselves');
  ok(/no requirement/i.test(view.confirm), `confirm says what it does (${view.confirm.trim()})`);
  await page.screenshot({ path: join(SHOTS, 'life-essence-picker.png') });

  await page.evaluate(() => { document.querySelector('#promisePicker .pp-card[data-i="1"]').click(); });
  await sleep(200);
  await page.evaluate(() => { document.getElementById('leConfirm').click(); });
  await page.waitForFunction(() => window._leDone, { timeout: 6000 });
  const after = await page.evaluate(() => ({
    waived: game.players[0].missions.map(m => !!m._reqWaived).join(','),
    overlay: document.getElementById('promisePicker').classList.contains('active'),
    probe: game.probeMissionRequirements(0, game.players[0].missions[1]).success,
  }));
  ok(after.waived === 'false,true', `exactly the chosen mission is blessed (${after.waived})`);
  ok(after.probe === true, 'blessed mission probes success with zero skills');
  ok(!after.overlay, 'picker closes on confirm');
  await page.close();
}

// ═══ DOUBLE MISSION LETTER FINALE (Wyatt's 7/5 freeze) ═══
// Final 2 cards BOTH letters, 1 gold: play #1 through the real panel, take a
// mission, then letter #2's chooser must appear, SURVIVE stray clicks, and
// still offer Discard at 0 gold — on desktop AND phone.
async function doubleLetterFlow(mode) {
  console.log(`── ${mode}: double Mission Letter finale — chooser appears and survives stray clicks`);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`letters-${mode}: ` + m.text()); });
  page.on('pageerror', e => consoleErrors.push(`letters-${mode} pageerror: ` + e.message));
  if (mode === 'phone') await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  else await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  await page.evaluate(() => {
    const p = game.players[0];
    const letters = FAVOR_DATA.cards.filter(c => c.type === 'mission_letter' && c.act === 1);
    p.hand = [letters[0], letters[1]];
    p.gold = 1;
    p.sliderPosition = 4;
    for (let i = 1; i < game.playerCount; i++) game.players[i].hand = game.players[i].hand.slice(0, 2);
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
  });
  await sleep(400);

  await throwAndAwaitChoice(page, 0);
  const played = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.action-panel .action-btn')]
      .find(x => /mission letter/i.test(x.textContent) && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  });
  ok(played, 'letter #1 played through the reveal chooser');

  let msShown = false;
  try {
    await page.waitForFunction(() => document.getElementById('missionSelect').classList.contains('active')
      && document.querySelector('.mission-option'), { timeout: 9000 });
    msShown = true;
  } catch (e) {}
  ok(msShown, 'mission select opens for letter #1');
  if (msShown) await page.evaluate(() => document.querySelector('.mission-option').click());

  let chooser = false;
  try {
    await page.waitForFunction(() =>
      document.querySelector('.action-panel.active') &&
      /final card/i.test(document.querySelector('.action-panel').textContent), { timeout: 9000 });
    chooser = true;
  } catch (e) {}
  ok(chooser, 'letter #2 presents the final-card chooser');

  if (chooser) {
    // The freeze reproducer: stray clicks outside the chooser must NOT dismiss it.
    await page.evaluate(() => document.body.click());
    if (mode === 'phone') { await page.touchscreen.touchStart(420, 60); await page.touchscreen.touchEnd(); }
    else {
      // Dead table space LEFT of the chooser — the panel is wider now that
      // it carries the card art, so the old fixed point (850,500) lands ON
      // its buttons and "dismisses" it by pressing one.
      const left = await page.evaluate(() =>
        document.querySelector('.action-panel').getBoundingClientRect().left);
      await page.mouse.click(Math.max(300, Math.round(left) - 45), 500);
    }
    await sleep(350);
    const after = await page.evaluate(() => {
      const p = document.querySelector('.action-panel');
      const r = p.getBoundingClientRect();
      return {
        active: p.classList.contains('active'),
        onScreen: r.width > 100 && r.top >= 0 && r.bottom <= window.innerHeight + 2,
        buttons: [...p.querySelectorAll('button')].map(b => b.textContent.trim()),
      };
    });
    ok(after.active, 'chooser survives stray outside clicks');
    ok(after.onScreen, `chooser visible in ${mode} viewport`);
    ok(after.buttons.some(t => /discard \(\+3g\)/i.test(t)), `Discard offered at 0 gold (${after.buttons.join(' · ')})`);
    await page.screenshot({ path: join(SHOTS, `double-letter-${mode}.png`) });

    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.action-panel [data-act]')].find(x => x.dataset.act === 'discard');
      b.click();
    });
    await sleep(2000);
    const done = await page.evaluate(() => ({
      gold: game.players[0].gold,
      pendingCleared: !game.pendingActivations[0],
      panelGone: !document.querySelector('.action-panel.active'),
    }));
    ok(done.pendingCleared && done.gold === 3, `letter #2 discards for +3g, round continues (gold=${done.gold})`);
    ok(done.panelGone, 'chooser closes after the choice');
  } else {
    await page.screenshot({ path: join(SHOTS, `double-letter-${mode}.png`) });
  }
  await page.close();
}
await doubleLetterFlow('desktop');
await doubleLetterFlow('phone');

// ═══ DESKTOP: board thumbnail shows the ring at the current slot ═══
console.log('── Desktop: board thumb ring marks the slot and follows slides');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('thumbring: ' + m.text()); });
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  const measure = () => page.evaluate(() => {
    const ring = document.querySelector('#boardThumb .thumb-ring');
    if (!ring) return null;
    const wrap = ring.parentElement.getBoundingClientRect();
    const r = ring.getBoundingClientRect();
    return {
      pos: game.players[0].sliderPosition,
      leftStyle: ring.style.left,
      centerPct: ((r.left + r.width / 2 - wrap.left) / wrap.width) * 100,
      expectPct: BOARD_OV_TRACK.lefts[game.players[0].sliderPosition],
      ringW: r.width,
    };
  });

  let m = await measure();
  ok(!!m, 'thumb ring rendered');
  if (m) {
    ok(Math.abs(m.centerPct - m.expectPct) < 1.5, `ring centered on slot ${m.pos + 1} (${m.centerPct.toFixed(1)}% vs ${m.expectPct}%)`);
    ok(m.ringW > 5, `ring visible at thumb scale (${m.ringW.toFixed(1)}px wide)`);
  }

  // Slide right (the engine's paid move — payToSlide's UI wrapper now only
  // answers at your reveal) — the thumb must follow without reopening anything.
  await page.evaluate(() => {
    game.players[0].gold = 30;
    game.moveSlider(0, 1);
    renderGameState();
  });
  await sleep(600);
  const m2 = await measure();
  ok(m2 && m2.pos !== m.pos, `slide moved the ring (slot ${m.pos + 1} → ${m2 && m2.pos + 1})`);
  ok(m2 && Math.abs(m2.centerPct - m2.expectPct) < 1.5, `thumb ring follows the slide (${m2 && m2.centerPct.toFixed(1)}% vs ${m2 && m2.expectPct}%)`);
  await page.screenshot({ path: join(SHOTS, 'thumb-ring.png') });
  await page.close();
}

// ═══ DESKTOP: mission borrow chooser at the due date ═══
console.log('── Desktop: due mission short a borrowable skill — chooser offers both doors');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('borrow-due: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('borrow-due pageerror: ' + e.message));
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  await page.evaluate(() => {
    const p = game.players[0];
    const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    const kCard = FAVOR_DATA.cards.find(c => (c.skills || []).includes('knowledge'));
    p.missions = [{ ...FAVOR_DATA.missions.find(m => m.name === 'A Day With the Birds') }];
    p.skills.knowledge = 2;         // 1 short of the 3 required
    p.gold = 10;
    game.players[1].playedCards.push({ ...kCard });     // the lender
    // Last round of the act: one KNOWN card each (random leftovers could
    // move gold around and flake the ledger checks), then missions resolve.
    p.hand = [pick('First Aid')];
    for (let i = 1; i < game.playerCount; i++) game.players[i].hand = [pick('First Aid')];
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
  });
  await sleep(300);
  await throwAndAwaitChoice(page, 0);
  await answerChoice(page, /discard \(\+3g\)/);

  let chooser = false;
  try {
    await page.waitForFunction(() =>
      document.getElementById('promisePicker').classList.contains('active') &&
      /Mission Due/i.test(document.getElementById('promisePicker').textContent), { timeout: 18000 });
    chooser = true;
  } catch (e) {}
  ok(chooser, 'borrow chooser pauses the mission phase');

  if (chooser) {
    // Wyatt 7/14: the chooser must let you pick WHO lends — the 2g fee lands in
    // THEIR purse, so it used to silently fund whichever neighbour came first.
    const offer = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('#promisePicker .bw-row')].map(r => ({
        pi: parseInt(r.dataset.pi, 10),
        off: r.classList.contains('off'),
        name: r.querySelector('.bw-name')?.textContent,
      })),
      fail: document.getElementById('mbFail')?.textContent.trim(),
      art: !!document.querySelector('#promisePicker .pp-card img, #promisePicker .bw-art'),
      sub: document.querySelector('#promisePicker .pp-sub')?.textContent || '',
    }));
    const lenders = offer.rows.filter(r => !r.off);
    ok(lenders.length >= 1, `the chooser lists the neighbours who can lend (${lenders.map(l => l.name).join(', ')})`);
    ok(/fee is paid/i.test(offer.sub), 'and says the fee is paid TO them — the pick has a cost');
    ok(/Let it Fail/i.test(offer.fail || ''), 'declining stays a real option');
    ok(offer.art, 'the lenders are shown by portrait');
    await page.screenshot({ path: join(SHOTS, 'mission-borrow-chooser.png') });

    // Pick a SPECIFIC lender and prove the fee follows the pick.
    const pick = lenders[0].pi;
    const before = await page.evaluate((pi) => ({
      gold: game.players[0].gold,
      picked: game.players[pi].gold,
      others: game.players.map(p => p.gold),
    }), pick);
    await page.evaluate((pi) => {
      document.querySelector(`#promisePicker .bw-row[data-pi="${pi}"]:not(.off)`).click();
    }, pick);
    await sleep(250);
    // One missing skill = tap-to-commit; if a Confirm exists, press it.
    await page.evaluate(() => { const b = document.getElementById('mbConfirm'); if (b) b.click(); });
    await sleep(250);
    const after = await page.evaluate((pi) => ({
      completed: game.players[0].completedMissions.length,
      failed: game.players[0].failedMissions.length,
      gold: game.players[0].gold,
      picked: game.players[pi].gold,
      others: game.players.map(p => p.gold),
      closed: !document.getElementById('promisePicker').classList.contains('active'),
    }), pick);
    ok(after.completed === 1 && after.failed === 0, 'borrowing completes the mission');
    ok(after.gold === before.gold - 2, `it costs you 2g (${before.gold}→${after.gold})`);
    ok(after.picked === before.picked + 2,
      `and the 2g goes to the lender YOU PICKED (seat ${pick}: ${before.picked}→${after.picked})`);
    // Nobody else's purse moved.
    const movedOthers = after.others.filter((g, i) => i !== 0 && i !== pick && g !== before.others[i]);
    ok(movedOthers.length === 0, 'and no other neighbour is paid a penny');
    ok(after.closed, 'chooser closes; the act rolls on');
  }
  await page.close();
}

// ═══ DESKTOP: Let it Fail gets a real ceremony beat ═══
// 7/18 recording: declining Alchemic Seige paid its +20-Prestige fail reward
// in total silence — the toast fired behind the NEXT chooser. The decline now
// plays a mission-ceremony beat whose headline is the prestige that landed.
console.log('── Desktop: declined mission plays a fail beat — the prestige reward LANDS');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('fail-beat: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('fail-beat pageerror: ' + e.message));
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  await page.evaluate(() => {
    const p = game.players[0];
    // Alchemic Seige: short its (borrowable) Alchemy, stone in hand, so the
    // due-date chooser opens; its failure pays +20 Prestige and no scorn.
    p.missions = [{ ...FAVOR_DATA.missions.find(m => m.name === 'Alchemic Seige') }];
    p.philosopherStone = 1;
    p.skills.alchemy = 0;
    const aCard = FAVOR_DATA.cards.find(c => (c.skills || []).includes('alchemy'));
    game.players[1].playedCards.push({ ...aCard });
    // Fire the chooser directly — never await an evaluate gated on a UI click.
    showMissionBorrowChooser(p.missions[0]);
  });
  await page.waitForFunction(() =>
    document.getElementById('promisePicker').classList.contains('active') &&
    /Mission Due/i.test(document.getElementById('promisePicker').textContent), { timeout: 8000 });
  const prestigeBefore = await page.evaluate(() => game.players[0].prestige);
  await page.evaluate(() => document.getElementById('mbFail').click());

  let beatUp = false;
  try {
    await page.waitForFunction(() =>
      document.getElementById('missionCeremony').classList.contains('active'), { timeout: 6000 });
    beatUp = true;
  } catch (e) {}
  ok(beatUp, 'declining plays a ceremony beat instead of a buried toast');

  if (beatUp) {
    await page.waitForFunction(() =>
      document.querySelector('.mc-stage').classList.contains('stamped'), { timeout: 8000 });
    await sleep(400);   // chips animate in
    const beat = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('.mc-chip')];
      const lead = chips[0];
      return {
        stamp: document.querySelector('.mc-stamp').textContent,
        card: document.querySelector('.mc-card').alt,
        chips: chips.map(c => c.textContent.trim()),
        leadBig: !!lead && lead.classList.contains('big') && lead.classList.contains('good'),
        leadText: lead ? lead.textContent.trim() : '(none)',
      };
    });
    ok(beat.stamp === 'Failed' && beat.card === 'Alchemic Seige',
      `the beat stamps the declined mission FAILED (${beat.card})`);
    ok(beat.chips.some(t => /\+20 Prestige/.test(t)),
      `the +20 Prestige fail reward is on screen (${beat.chips.join(' · ')})`);
    ok(beat.leadBig && /\+20 Prestige/.test(beat.leadText),
      `a scorn-less fail HEADLINES its prestige ("${beat.leadText}")`);
    await page.screenshot({ path: join(SHOTS, 'mission-fail-beat.png') });

    // The beat closes on its own and the engine really paid out.
    await page.waitForFunction(() =>
      !document.getElementById('missionCeremony').classList.contains('active'), { timeout: 15000 });
    const eng = await page.evaluate(() => ({
      prestige: game.players[0].prestige,
      failed: game.players[0].failedMissions.length,
    }));
    ok(eng.prestige === prestigeBefore + 20,
      `engine banked the prestige (${prestigeBefore}→${eng.prestige})`);
    ok(eng.failed === 1, 'and the mission sits in failedMissions');
  }
  await page.close();
}

// ═══ ENDGAME LEGIBILITY: every beat says who, what was missing, what it took ═══
// Wyatt 7/18: "the whole end of the game happens really quick, so you can't
// even really know what happens... it really needs to be understandable for
// all players, each mission that gets played. What's happening? Who got gold?
// Who is affected by this?"
console.log('── Endgame legibility: shortfalls, discarded card art, who else got paid, missed gates');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('legibility: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('legibility pageerror: ' + e.message));
  await page.setViewport({ width: 1420, height: 900 });
  await startGame(page);

  // Drive showMissionCeremony with a REAL engine resolution each time, so the
  // beat is rendering engine truth rather than a hand-built fixture.
  // `shot` is taken INSIDE this helper, at the same instant the DOM is read.
  // Taken afterwards it raced a stale timer: closeBeat() only drops the
  // active class, so the PREVIOUS ceremony's pending next()/close() was
  // still armed and could tear down the beat we were trying to photograph.
  const playBeat = async (rig, shot) => {
    await page.evaluate((body) => {
      window.CINEMATIC_SPEED = 1;          // beats must stay up long enough to read
      // eslint-disable-next-line no-new-func
      new Function(body)();
    }, rig);
    await page.waitForFunction(() =>
      document.querySelector('.mc-stage')
      && document.querySelector('.mc-stage').classList.contains('stamped'), { timeout: 10000 });
    // Children stagger in at 0.12 + i*0.13s, so a short wait reads the right
    // DOM but SCREENSHOTS a half-faded beat — and the shots are the only
    // thing that catches layout and occlusion. Wait out the whole stagger
    // (still well inside the beat's ~3.8s hold at CINEMATIC_SPEED 1).
    await sleep(1100);
    if (shot) await page.screenshot({ path: join(SHOTS, shot) });
    return page.evaluate(() => {
      const rw = document.querySelector('.mc-rewards');
      return {
        text: rw ? rw.textContent.replace(/\s+/g, ' ').trim() : '',
        children: rw ? rw.children.length : 0,
        req: (document.querySelector('.mc-req') || {}).textContent || '',
        tookCards: [...document.querySelectorAll('.mc-took-card img')].map(i => i.getAttribute('src')),
        tookNames: [...document.querySelectorAll('.mc-took-card em')].map(e => e.textContent),
        others: [...document.querySelectorAll('.mc-other')].map(o => o.textContent.replace(/\s+/g, ' ').trim()),
      };
    });
  };
  const closeBeat = async () => {
    await page.evaluate(() => {
      const el = document.getElementById('missionCeremony');
      if (el) el.classList.remove('active');
    });
    await sleep(120);
  };

  // 1 · THE LABYRINTH, no Fortune Teller. failurePenalties {} plus a
  // conditional failSpecial meant every measured delta was 0 and rewardChips
  // returned "" — the beat rendered a card and a stamp over an empty div and
  // held the SHORT window. "If someone fails Labyrinth, you don't really see
  // it happen."
  const lab = await playBeat(`
    const p = game.players[0];
    const m = { ...FAVOR_DATA.missions.find(x => x.name === 'The Labyrinth') };
    p.missions = [m]; p.playedCards = [];
    p.skills.survival = 1; p.skills.knowledge = 0;
    const det = game.checkMissionRequirements(0, m).details;
    const d = game.measureResolution(0, () => game.applyMissionFailure(0, m));
    showMissionCeremony([{ playerIndex: 0, results: [{ mission: m, success: false, deltas: d, details: det }] }], 3);
  `, 'beat-labyrinth-empty-fixed.png');
  ok(lab.children > 0, 'a zero-delta failure no longer renders an EMPTY beat');
  ok(/Fortune Teller/.test(lab.text) && /50/.test(lab.text),
    `the conditional reward that MISSED states what was lost (${lab.text})`);
  ok(/Short of/.test(lab.req) && /Survival|Knowledge|Mind/.test(lab.req),
    `and the beat says what they were short of (${lab.req.trim()})`);
  await closeBeat();

  // 2 · SECRET GROTTO — the discard Wyatt watched happen invisibly. "We never
  // got to see which cards he discarded, which is important because otherwise
  // we just see the prestige he gets for it."
  const grotto = await playBeat(`
    const p = game.players[0];
    const m = { ...FAVOR_DATA.missions.find(x => x.name === 'Secret Grotto') };
    p.missions = [m];
    p.playedCards = ['Enchanted Flames', 'Tombstone']   // Royal Hilt is an ARTIFACT since 7/19
      .map((n, i) => ({ ...FAVOR_DATA.cards.find(c => c.name === n), id: 'wg' + i }));
    const det = game.checkMissionRequirements(0, m).details;
    const d = game.measureResolution(0, () => game.applyMissionFailure(0, m));
    showMissionCeremony([{ playerIndex: 0, results: [{ mission: m, success: false, deltas: d, details: det }] }], 2);
  `, 'beat-discard-cards.png');
  ok(grotto.tookNames.length === 2,
    `a bulk discard names the cards it took (${grotto.tookNames.join(', ') || 'none'})`);
  ok(grotto.tookCards.length === 2 && grotto.tookCards.every(s => /assets\/cards\/regular\//.test(s)),
    'and shows their ART, not just a count');
  ok(/Prestige/.test(grotto.text),
    `the prestige it paid is still on screen beside them (${grotto.text.slice(0, 90)})`);
  await closeBeat();

  // 3 · WHO GOT GOLD. others_gain_5_gold pays every other seat — mutations
  // entirely outside the measured seat, so the question had no answer.
  const paid = await playBeat(`
    const p = game.players[0];
    const m = { ...FAVOR_DATA.missions.find(x => (x.failSpecial || '') === 'others_gain_5_gold') };
    p.missions = [m];
    const det = game.checkMissionRequirements(0, m).details;
    const d = game.measureResolution(0, () => game.applyMissionFailure(0, m));
    showMissionCeremony([{ playerIndex: 0, results: [{ mission: m, success: false, deltas: d, details: det }] }], 2);
  `, 'beat-who-got-gold.png');
  ok(paid.others.length >= 2,
    `the beat names every OTHER seat the failure moved (${paid.others.length})`);
  ok(paid.others.every(t => /\+5 Gold/.test(t)),
    `and says what each of them got (${paid.others.join(' | ')})`);
  await closeBeat();

  // 4 · A SUCCESS states its requirements were met — the other half of
  // "you don't know if they had the prerequisites to get the big reward".
  const won = await playBeat(`
    const p = game.players[0];
    const m = { ...FAVOR_DATA.missions.find(x => x.name === 'A Day With the Birds') };
    p.missions = [m]; p.skills.knowledge = 9;
    const det = game.checkMissionRequirements(0, m).details;
    const d = game.measureResolution(0, () => { game.applyMissionRewards(0, m); });
    showMissionCeremony([{ playerIndex: 0, results: [{ mission: m, success: true, deltas: d, details: det }] }], 1);
  `);
  ok(/Requirements met/.test(won.req), `a success confirms the requirements were met (${won.req.trim()})`);
  await closeBeat();
  await page.close();
}

// ═══ DESKTOP: Turn In Now can borrow too ═══
console.log('── Desktop: Turn In Now offers Borrow & Complete when a neighbor covers the gap');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('borrow-turnin: ' + m.text()); });
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  await page.evaluate(() => {
    const p = game.players[0];
    const kCard = FAVOR_DATA.cards.find(c => (c.skills || []).includes('knowledge'));
    p.missions = [{ ...FAVOR_DATA.missions.find(m => m.name === 'A Day With the Birds') }];
    p.skills.knowledge = 2;
    p.gold = 10;
    // PIN the lender: player 1 holds the only knowledge card on the
    // table — a random AI having played their own knowledge card once
    // routed the fee to player 2 and flaked the lender assert.
    game.players[1].playedCards = [{ ...kCard }];
    game.players[2].playedCards = [];
    game.phase = 'gameplay';
    renderGameState();
    openMissionBrowser('mine', p.missions[0].name);
  });
  await sleep(400);

  const lb = await page.evaluate(() => ({
    borrow: document.getElementById('missionBorrowIn')?.textContent.trim(),
    turnIn: document.getElementById('missionTurnIn')?.textContent.trim(),
  }));
  ok(/Borrow & Complete \(−2g\)/.test(lb.borrow || ''), `lightbox offers the borrow (${lb.borrow})`);
  ok(/would FAIL/i.test(lb.turnIn || ''), 'plain turn-in still warns it would fail');
  await page.screenshot({ path: join(SHOTS, 'mission-borrow-turnin.png') });

  const before = await page.evaluate(() => ({ lender: game.players[1].gold }));
  await page.evaluate(() => document.getElementById('missionBorrowIn').click());
  await sleep(500);
  const after = await page.evaluate(() => ({
    completed: game.players[0].completedMissions.length,
    gold: game.players[0].gold,
    lender: game.players[1].gold,
    lbClosed: !document.getElementById('missionLB').classList.contains('active'),
  }));
  ok(after.completed === 1 && after.gold === 8 && after.lender === before.lender + 2,
    `turn-in borrow completes and pays the lender (completed ${after.completed}, gold ${after.gold}, lender ${before.lender}→${after.lender})`);
  ok(after.lbClosed, 'lightbox closes after the borrow');
  await page.close();
}

// ═══ SLIDE-RING PICKER: one button, pick a slot on the board itself ═══
async function slidePickerFlow(mode) {
  console.log(`── ${mode}: ⇄ Discard: Slide Ring — one button, board picks the slot`);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`slidepick-${mode}: ` + m.text()); });
  page.on('pageerror', e => consoleErrors.push(`slidepick-${mode} pageerror: ` + e.message));
  if (mode === 'phone') await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  else await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  await page.evaluate(() => {
    const p = game.players[0];
    const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    p.hand = [pick('First Aid'), pick('Trapping'), pick('Hunting')];
    p.gold = 7;
    p.sliderPosition = 2;
    // Even hand sizes — passHands rotates hands, so a lopsided rig would
    // hand the human an empty hand and skew the ledger checks.
    for (let i = 1; i < game.playerCount; i++) {
      game.players[i].hand = [pick('First Aid'), pick('Trapping'), pick('Hunting')];
    }
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
  });
  await sleep(300);
  await throwAndAwaitChoice(page, 0);

  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('.action-panel .action-btn')].map(b => b.textContent.trim()));
  const slideBtns = buttons.filter(t => /Slide Ring/i.test(t));
  ok(slideBtns.length === 1 && /⇄/.test(slideBtns[0]), `ONE slide button (${slideBtns.join(' | ') || 'none'})`);
  ok(!buttons.some(t => /(←|→)\s*$|^\s*(←|→)/.test(t) && /Slide Ring/i.test(t)), 'old ←/→ pair is gone');

  // Open the picker, then CANCEL with Escape — panel must come back.
  await page.evaluate(() => {
    [...document.querySelectorAll('.action-panel .action-btn')].find(b => /Slide Ring/i.test(b.textContent)).click();
  });
  await sleep(350);
  let ov = await page.evaluate(() => ({
    active: document.getElementById('boardOverlay').classList.contains('active'),
    pickable: document.querySelectorAll('.board-ov-slot.pickable').length,
    dimmed: document.querySelectorAll('.board-ov-slot.dimmed').length,
    hint: document.getElementById('boardOvHint')?.textContent || '',
    panelAside: !document.querySelector('.action-panel.active'),
  }));
  ok(ov.active, 'board opens in pick-a-slot mode');
  ok(ov.panelAside, 'action panel steps aside — nothing covers the circles');
  ok(ov.pickable === 2, `exactly the two adjacent circles glow (${ov.pickable})`);
  ok(ov.dimmed === 2, `far circles are dead (${ov.dimmed})`);
  ok(/pays the toll/i.test(ov.hint), 'hint explains the toll');
  if (mode === 'desktop') await page.screenshot({ path: join(SHOTS, 'slide-picker.png') });

  await page.keyboard.press('Escape');
  await sleep(400);
  const afterEsc = await page.evaluate(() => ({
    ovClosed: !document.getElementById('boardOverlay').classList.contains('active'),
    panelBack: document.querySelector('.action-panel').classList.contains('active'),
    hand: game.players[0].hand.length,
    thrown: !!game.pendingActivations[0],
  }));
  ok(afterEsc.ovClosed && afterEsc.panelBack && afterEsc.hand === 2 && afterEsc.thrown,
    'Escape cancels back to the reveal chooser, thrown card untouched');

  // Backdrop cancel — the same click must not eat the re-opened panel.
  await page.evaluate(() => {
    [...document.querySelectorAll('.action-panel .action-btn')].find(b => /Slide Ring/i.test(b.textContent)).click();
  });
  await sleep(300);
  await page.evaluate(() => document.getElementById('boardOverlay').click());
  await sleep(400);
  const afterBk = await page.evaluate(() => ({
    ovClosed: !document.getElementById('boardOverlay').classList.contains('active'),
    panelBack: document.querySelector('.action-panel').classList.contains('active'),
  }));
  ok(afterBk.ovClosed && afterBk.panelBack, 'backdrop cancels back to the action panel too');

  // Pick the RIGHT circle — free slide, the discard is the payment.
  await page.evaluate(() => {
    [...document.querySelectorAll('.action-panel .action-btn')].find(b => /Slide Ring/i.test(b.textContent)).click();
  });
  await sleep(300);
  // Same click handler serves taps; headless touch does not synthesize
  // clicks reliably, so drive the handler directly on both layouts (the
  // phone-glide flow already proves the raw touch pipeline).
  await page.evaluate(() => {
    const slots = [...document.querySelectorAll('.board-ov-slot.pickable')];
    slots[slots.length - 1].click();
  });
  await sleep(2200);
  const done = await page.evaluate(() => ({
    pos: game.players[0].sliderPosition,
    hand: game.players[0].hand.length,
    gold: game.players[0].gold,
    ovClosed: !document.getElementById('boardOverlay').classList.contains('active'),
  }));
  ok(done.pos === 3, `ring slid one space right (slot ${done.pos + 1})`);
  ok(done.hand === 2, 'the card left the hand as the payment');
  ok(done.gold === 7, `free — no gold spent or gained (${done.gold})`);
  ok(done.ovClosed, 'board closed after the pick');
  await page.close();
}
await slidePickerFlow('desktop');
await slidePickerFlow('phone');

// ═══ DESKTOP: final-card chooser uses the same picker ═══
console.log('── Desktop: final card slides via the picker, chooser survives the trip');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('slidepick-final: ' + m.text()); });
  await page.setViewport({ width: 1420, height: 800 });
  await startGame(page);

  await page.evaluate(() => {
    const p = game.players[0];
    const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    p.hand = [pick('First Aid'), pick('Trapping')];
    p.gold = 9;
    p.skills.power = 1;
    p.sliderPosition = 2;
    for (let i = 1; i < game.playerCount; i++) game.players[i].hand = [pick('First Aid')];
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
  });
  await sleep(300);
  await throwAndAwaitChoice(page, 0);
  await answerChoice(page, /play/);

  await page.waitForFunction(() =>
    document.querySelector('.action-panel.active') &&
    /final card/i.test(document.querySelector('.action-panel').textContent), { timeout: 9000 });
  const chooserBtns = await page.evaluate(() =>
    [...document.querySelectorAll('.action-panel [data-act]')].map(b => b.dataset.act));
  ok(chooserBtns.includes('discard_slide_pick') && !chooserBtns.includes('discard_slide_left'),
    `chooser carries ONE slide action (${chooserBtns.join(',')})`);

  await page.evaluate(() => {
    [...document.querySelectorAll('.action-panel [data-act]')].find(b => b.dataset.act === 'discard_slide_pick').click();
  });
  await sleep(350);
  const midState = await page.evaluate(() => ({
    ovActive: document.getElementById('boardOverlay').classList.contains('active'),
    pickable: document.querySelectorAll('.board-ov-slot.pickable').length,
    panelAside: !document.querySelector('.action-panel.active'),
  }));
  ok(midState.ovActive && midState.pickable === 2, 'picker takes the stage for the final card');
  ok(midState.panelAside, 'chooser steps aside while picking');
  await page.screenshot({ path: join(SHOTS, 'slide-picker-final.png') });

  // Escape must bring the chooser back, promise intact and buttons live.
  await page.keyboard.press('Escape');
  await sleep(300);
  const backState = await page.evaluate(() => ({
    ovClosed: !document.getElementById('boardOverlay').classList.contains('active'),
    chooserBack: document.querySelector('.action-panel').classList.contains('active'),
    stillFinal: /final card/i.test(document.querySelector('.action-panel').textContent),
  }));
  ok(backState.ovClosed && backState.chooserBack && backState.stillFinal,
    'Escape returns to the final-card chooser, promise intact');

  // Go again and pick for real this time.
  await page.evaluate(() => {
    [...document.querySelectorAll('.action-panel [data-act]')].find(b => b.dataset.act === 'discard_slide_pick').click();
  });
  await sleep(350);

  const goldAtPick = await page.evaluate(() => game.players[0].gold);
  await page.evaluate(() => document.querySelectorAll('.board-ov-slot.pickable')[0].click()); // left circle
  await sleep(2200);
  const done = await page.evaluate(() => ({
    pos: game.players[0].sliderPosition,
    pendingCleared: !game.pendingActivations[0],
    gold: game.players[0].gold,
    panelClosed: !document.querySelector('.action-panel.active'),
    discarded: game.discardPile.some(c => c.name === 'Trapping'),
  }));
  ok(done.pos === 1 && done.pendingCleared, `final card slid the ring left (slot ${done.pos + 1}), round continued`);
  // No 5g fee — slot LANDING effects (Explorer's left circle pays gold)
  // are legitimate and expected, only the toll must be absent.
  ok(done.gold >= goldAtPick, `no slide fee charged (${goldAtPick}g → ${done.gold}g incl. slot bonus)`);
  ok(done.discarded && done.panelClosed, 'final card paid the toll and the chooser closed');
  await page.close();
}

// ═══ ROYAL MENU + LEADERBOARD + DAILY CHAMPIONS (Task 5) ═══
console.log('── Menu: Play Now / queue / leaderboard / profile / Daily Champion loop');
{
  // ⚠ 'uqa' + an ORDINARY name, not 'uaudit'/'Audit Herald': this block ends
  // by asserting the daily-champion crown and its overlay, and settlement now
  // (correctly) refuses to crown anything that looks like test residue — that
  // filter exists because six leftover 'Audit Herald' rows took a real
  // player's bronze on 2026-07-18. uqa rows still stay off other players'
  // boards and are swept by the final integrity gate; they are simply
  // CROWNABLE, which is the whole point of this flow.
  const AUDIT_UID = 'uqa' + Math.random().toString(36).slice(2, 6);
  const PAST_KEY = '2020-01-02';   // synthetic long-dead window, never collides
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('menu: ' + m.text()); });
  // Seed identity BEFORE meta.js boots (runs on every navigation).
  await page.evaluateOnNewDocument((u) => {
    localStorage.setItem('favorUid', u);
    localStorage.setItem('favorName', 'Herald Quinn');
  }, AUDIT_UID);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  // The chip fills from an un-awaited async read — wait for the text, not
  // a fixed beat (a slow Firebase get flaked this at 600ms).
  await page.waitForFunction(() =>
    (document.getElementById('profileChip').textContent || '').trim().length > 0, { timeout: 10000 })
    .catch(() => {});
  await sleep(200);

  // Menu renders: Play Now leads a single column beside the box art,
  // segmented 3/4/5 table picker, Leaderboard/Store pair, quiet row.
  const menu = await page.evaluate(() => ({
    mode: FLB.mode,
    play: !!([...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')].find(b => /\bplay\b/i.test(b.textContent) && !/how to play/i.test(b.textContent))),
    seg: [...document.querySelectorAll('#queueSeg button[data-q]')].map(b => b.dataset.q),
    segLit: document.querySelectorAll('#queueSeg button.on').length,
    lbBtn: !!([...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')].find(b => /leaderboard/i.test(b.textContent))),
    storeBtn: !!([...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')].find(b => /store/i.test(b.textContent))),
    howto: !!([...document.querySelectorAll('#title-screen .ts-card .ts-plaque')].find(b => /how to play/i.test(b.textContent))),
    promptTest: !!document.getElementById('promptTestToggle'),
    chip: document.getElementById('profileChip').textContent.trim(),
    oldDropdownGone: !document.getElementById('playerCountSelect'),
  }));
  console.log(`   (leaderboard backend: ${menu.mode})`);
  ok(menu.play && menu.lbBtn && menu.storeBtn, 'menu renders Play Now + Leaderboard + Store');
  ok(menu.seg.join('|') === '3|4|5' && menu.segLit === 1,
    `segmented table picker offers 3/4/5 with one lit (${menu.seg.join(',')})`);
  ok(menu.howto && menu.promptTest, "How to Play + Prompt Test survive (Skylar's tutorial hooks)");
  ok(/Herald Quinn/.test(menu.chip), `profile chip carries the royal name (${menu.chip.split('\n')[0]})`);
  ok(menu.oldDropdownGone, 'player-count dropdown is gone from character select');

  // Wingspan-stage geometry: the PLAY tile dwarfs the mid tiles, the grid
  // sits fully on-screen, and the rival plaque stands tall beside it.
  const geo = await page.evaluate(() => {
    const grid = document.querySelector('.ts-grid').getBoundingClientRect();
    const tile = (t) => [...document.querySelectorAll('.ts-card')]
      .find(c => (c.querySelector('.ts-plaque') || {}).textContent === t);
    const play = tile('Play').getBoundingClientRect();
    const mid = tile('Skirmish').getBoundingClientRect();
    const plaque = document.getElementById('rivalPlaque').getBoundingClientRect();
    return {
      gridOn: grid.top >= 0 && grid.bottom <= window.innerHeight + 1,
      playBiggest: play.height > mid.height * 1.6,
      plaqueTall: plaque.height >= 120,
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  ok(geo.gridOn && !geo.hscroll, 'menu grid fully on-screen, no h-scroll');
  ok(geo.playBiggest, 'PLAY is the unmistakable primary tile');
  ok(geo.plaqueTall, 'the rival plaque stands tall in the grid');
  await page.screenshot({ path: join(SHOTS, 'menu-desktop.png') });

  // Queue choice persists (segmented tap).
  await page.evaluate(() => { document.querySelector('#queueSeg button[data-q="4"]').click(); });
  ok(await page.evaluate(() => FLB.queueSize()) === 4, 'table picker persists the chosen size');
  ok(await page.evaluate(() =>
    document.querySelector('#queueSeg button[data-q="4"]').classList.contains('on')
    && document.querySelectorAll('#queueSeg button.on').length === 1),
    'the tapped segment lights and the old one dims');

  // ⚠ THE LADDER CHANGED THE SIGN, not just the magnitude (Wyatt 7/18).
  // This rig is a fresh player at 1.00 — BELOW the 2.00 no-fall line — so
  // last place now GAINS its consolation token. The old assertion demanded
  // lossDelta < 0 and would fail on a correct ladder. Sub-SOFT rules are
  // asserted here; the full rule set lives in engine-smoke.
  const elo = await page.evaluate(() => {
    // The 4th arg is the ROW to compute against — the same parameter
    // postGameResult uses to hand the txn's server row in. Passing a fresh
    // {} makes this hermetic: the audit uid's real row accumulates a streak
    // across runs, and a 3-win streak doubles gains, which would have made
    // these numbers drift run to run.
    const at = (order) => FLB.tableDelta(
      order.map(n => ({ name: n })), [null, null, null], 'knight', {});
    const win = at(['You', 'A', 'B']);
    const mid = at(['A', 'You', 'B']);
    const loss = at(['A', 'B', 'You']);
    return {
      winDelta: win.delta, lossDelta: loss.delta, midDelta: mid.delta,
      winShown: FLB.fmtRating(win.after), startShown: FLB.fmtRating(win.before),
      capOk: [win.delta, loss.delta, mid.delta].every(d => Math.abs(d) <= 300),
      sloped: win.delta > mid.delta && mid.delta > loss.delta,
      noDeadZone: [win.delta, mid.delta, loss.delta]
        .every(d => FLB.fmtRatingDelta(d) !== '+0.00'),
      charTracks: win.charId === 'knight' && win.charDelta > 0,
      floorCeil: FLB.fmtRating(-500) === '0.00' && FLB.fmtRating(9999) === '7.00',
    };
  });
  ok(elo.startShown === '1.00', `a fresh player reads 1.00 (${elo.startShown})`);
  // Fresh 1.00 vs two 1200 bots: adj 1.1, band 2.0x, no streak.
  // 1st  ps 1.00 -> 100 x 1.00 x 1.1 x 2.0 = 220
  // 2nd  ps 0.30 -> 100 x 0.30 x 1.1 x 2.0 = 66
  // 3rd  ps −0.40 -> −44, floored to MIN_LAST 10 because 1000 < SOFT
  ok(elo.winDelta === 220 && elo.lossDelta === 10,
    `sub-2.00: a win pays 220 and LAST PLACE STILL GAINS its token (win +${elo.winDelta}, last +${elo.lossDelta})`);
  ok(elo.sloped, `every placement is distinguishable (${elo.winDelta} > ${elo.midDelta} > ${elo.lossDelta})`);
  ok(elo.noDeadZone,
    'no placement renders "+0.00" — the dead zone that made 4th place read as nothing');
  ok(elo.capOk, 'nothing exceeds the MAX_SWING rail of 300');
  ok(elo.charTracks, 'the ridden hero\'s own ledger moves with the game');
  ok(elo.floorCeil, 'display clamps to the 0.00–7.00 rails');

  // A finished game posts rating + daily best; bots never post.
  await page.evaluate(async () => {
    await FLB.postGameResult([
      { name: 'You', finalScore: 55 },
      { name: 'Prince Aldric', finalScore: 40 },
      { name: 'Lady Elara', finalScore: 30 },
    ], [], { ratings: [null, null, null], myChar: 'knight' });
  });
  await sleep(600);
  await page.evaluate(() => FLB.openLeaderboard('alltime'));
  await sleep(900);
  // Scoped to YOUR OWN row, not the whole board: /1\.0[0-9]/ against the
  // full text matched any of the nine real players sitting at 1.04-1.24, so
  // it passed without ever looking at the audit player's rating.
  const at = await page.evaluate(() => {
    const mine = [...document.querySelectorAll('.lb-row')].find(r => r.classList.contains('me'));
    return { all: document.getElementById('lbBody').textContent, me: mine ? mine.textContent : '' };
  });
  ok(/Herald Quinn/.test(at.me) && /✦ 1\.22/.test(at.me),
    `RATING board carries your own 1.22 on the 1.00–7.00 scale (${at.me.trim()})`);
  ok(!/\d+ W · \d+ G/.test(at.all), 'win/game counters left the board rows');
  ok(!/Aldric|Elara|Cassius/.test(at.all), 'bots stay OFF the leaderboard');
  // The ten character chips ride under the tabs; the ridden hero's board
  // carries your row, an unridden hero's board sits empty.
  await page.evaluate(() => FLB.openLeaderboard('char:knight'));
  await sleep(700);
  const charKn = await page.evaluate(() => ({
    chips: document.querySelectorAll('.lb-chartab').length,
    on: !!document.querySelector('.lb-chartab.on'),
    text: document.getElementById('lbBody').textContent,
  }));
  ok(charKn.chips === 11 && charKn.on, 'hero rail: 10 heroes + All-Heroes chip, the open board\'s chip lit');
  // A FRESH hero starts at 1.00 and takes the 2.0x band like anyone below
  // the line: 1st of 3 vs two 1200 bots = 100 x 1.00 x 1.1 x 2.0 = +220.
  // A veteran picking up a new character climbs that ledger fast. Intended.
  ok(/Herald Quinn/.test(charKn.text) && /✦ 1\.22/.test(charKn.text),
    `the Knight board carries your Knight rating, 1.22 after one win (${charKn.text.trim().slice(0, 60)})`);
  // Pick the unridden hero from LIVE data instead of hardcoding one. This
  // asserted 'magician' until 7/18, when a real player (Banana71) rode the
  // Magician into a rated game and the board correctly stopped being empty —
  // the test was encoding "nobody plays the Magician", which is not a fact
  // about the code and gets less true every week.
  const unridden = await page.evaluate(async () => {
    let all = {};
    try {
      all = await (await fetch('https://testroom-75200-default-rtdb.firebaseio.com/favor/players.json')).json() || {};
    } catch (e) { /* offline — fall through to the null branch */ }
    const ridden = new Set();
    Object.values(all).forEach(p => {
      if (p && p.chars) Object.entries(p.chars).forEach(([id, c]) => { if ((c || {}).g > 0) ridden.add(id); });
    });
    const pick = ((window.FAVOR_DATA || {}).characters || []).find(c => !ridden.has(c.id));
    return pick ? { id: pick.id, name: pick.name } : null;
  });
  if (unridden) {
    await page.evaluate((id) => FLB.openLeaderboard('char:' + id), unridden.id);
    await sleep(700);
    const charMg = await page.evaluate(() => document.getElementById('lbBody').textContent);
    ok(new RegExp(`No one has ridden the ${unridden.name}`).test(charMg),
      `an unridden hero's board says so instead of lying (${unridden.name})`);
  } else {
    ok(true, 'every hero has been ridden into a rated game — no empty board left to check');
  }
  await page.evaluate(() => FLB.openLeaderboard('alltime'));
  await sleep(400);
  await page.evaluate(() => FLB.openLeaderboard('daily'));
  await sleep(900);
  const daily = await page.evaluate(() => document.getElementById('lbBody').textContent);
  ok(/Herald Quinn/.test(daily) && /55/.test(daily), 'DAILY shows your best single-game Favor (55)');
  await page.screenshot({ path: join(SHOTS, 'leaderboard.png') });
  await page.evaluate(() => FLB.closeLeaderboard());

  // ⚠ Renames to 'Sir QUINNsworth', not 'Sir Auditsworth'. That old name is
  // literally in TEST_NAMES, and this flow plants its daily-champion row
  // under whatever the player is called — so settlement (which now refuses
  // to crown anything that looks like residue) dropped its own fixture and
  // no crown, stars or overlay ever arrived.
  await page.evaluate(() => FLB.openProfile());
  await sleep(400);
  await page.evaluate(() => { document.getElementById('pfName').value = 'Sir Quinnsworth'; });
  await page.evaluate(() => document.getElementById('pfSave').click());
  await sleep(700);
  const renamed = await page.evaluate(() => ({
    chip: document.getElementById('profileChip').textContent,
    stored: localStorage.getItem('favorName'),
  }));
  ok(/Sir Quinnsworth/.test(renamed.chip) && renamed.stored === 'Sir Quinnsworth', 'rename persists to chip + storage');

  // Daily Champion: plant a long-past window, then a FRESH LOAD must
  // settle it, award stars, and greet the champion with the overlay.
  await page.evaluate(async (KEY) => {
    const me = FLB.uid();
    if (FLB.mode === 'firebase') {
      await firebase.database().ref(`favor/daily/${KEY}/scores/${me}`)
        .set({ name: 'Sir Quinnsworth', best: 61, at: 1577934245000 });
      await firebase.database().ref(`favor/settled/${KEY}`).remove();
    } else {
      const t = JSON.parse(localStorage.getItem('favorLB') || '{}');
      t.daily = t.daily || {};
      t.daily[KEY] = { scores: { [me]: { name: 'Sir Quinnsworth', best: 61, at: 1577934245000 } } };
      if (t.settled) delete t.settled[KEY];
      localStorage.setItem('favorLB', JSON.stringify(t));
    }
  }, PAST_KEY);
  await page.reload({ waitUntil: 'networkidle2' });     // ← "next visit"
  let champShown = false;
  try {
    await page.waitForFunction(() => document.getElementById('champOverlay').classList.contains('active'), { timeout: 12000 });
    champShown = true;
  } catch (e) {}
  const champ = await page.evaluate(() => ({
    title: document.getElementById('champTitle').textContent,
    sub: document.getElementById('champSub').textContent,
  }));
  ok(champShown, 'congrats overlay greets the champion on next load');
  ok(champ.title === 'You Placed 1st — You are the Daily Champion!', `1st-place wording exact (${champ.title})`);
  ok(/50 Stars/.test(champ.sub), 'champion earned 50 Stars');
  await page.screenshot({ path: join(SHOTS, 'champ-overlay.png') });
  await page.evaluate(() => document.getElementById('champBtn').click());
  await sleep(500);
  const standing = await page.evaluate(async () => {
    await FLB.renderProfileChip(); await new Promise(r => setTimeout(r, 400));
    return document.getElementById('profileChip').textContent;
  });
  ok(/1/.test(standing.replace('Sir Quinnsworth', '')), 'crown count rides the chip next to the rating');

  // Second load: settled + drained → silence (idempotent).
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);
  ok(await page.evaluate(() => !document.getElementById('champOverlay').classList.contains('active')),
    'no double congrats — settlement is exactly-once');

  // Leave no trace: the audit's identity + planted windows are removed.
  await page.evaluate(async (KEY) => {
    const me = FLB.uid();
    if (FLB.mode === 'firebase') {
      await firebase.database().ref(`favor/players/${me}`).remove();
      await firebase.database().ref(`favor/daily/${KEY}`).remove();
      await firebase.database().ref(`favor/settled/${KEY}`).remove();
      const days = (await firebase.database().ref('favor/daily').get()).val() || {};
      for (const k of Object.keys(days)) {   // all keys — boundary-straddle safe
        await firebase.database().ref(`favor/daily/${k}/scores/${me}`).remove();
      }
    } else {
      localStorage.removeItem('favorLB');
    }
  }, PAST_KEY);
  await page.close();
}

// ═══ PHONE: menu fits landscape ═══
console.log('── Phone: royal menu at 844×390');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('menu-phone: ' + m.text()); });
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await sleep(500);
  const m = await page.evaluate(() => {
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.top < window.innerHeight && r.bottom > 0; };
    const tile = (t) => [...document.querySelectorAll('.ts-card .ts-plaque')].find(p => p.textContent.trim() === t);
    return {
      play: vis(tile('Play')),
      seg: vis(document.getElementById('queueSeg')),
      chip: vis(document.getElementById('profileChip')),
      skirm: vis(tile('Skirmish')),
      privateGame: vis(tile('Private Game')),
      plaque: vis(document.getElementById('rivalPlaque'))
        && !!document.querySelector('#rivalPlaque .drp-name')
        && /^\d\d:\d\d:\d\d$/.test((document.getElementById('drpClock') || {}).textContent || ''),
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  ok(m.play && m.seg && m.chip, 'Play + table picker + profile chip all reachable on a phone');
  ok(m.skirm && m.privateGame, 'Skirmish and Private Game tiles reachable on a phone');
  ok(m.plaque, 'the WANTED plaque renders with its name and ticking clock');
  ok(!m.hscroll, 'no horizontal scroll on the phone menu');
  await page.screenshot({ path: join(SHOTS, 'menu-phone.png') });
  await page.close();
}

// ═══ NEIGHBOR-TARGET HIGHLIGHT: reader cards light up WHO they read ═══
// Engine truth: for player 0, left neighbor = LAST player, right = players[1].
// Desktop sidebar renders i ascending, so RIGHT = top entry, LEFT = bottom.
for (const mode of ['desktop', 'phone']) {
  console.log(`── ${mode}: neighbor-target highlight — select lights the players a card reads`);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`nt-${mode}: ` + m.text()); });
  if (mode === 'phone') await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  else await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);
  await sleep(400);

  // Rig a known hand: two readers + one inert card, then select each.
  // The act-start toast floats over the seat row for a beat — clear it so
  // the tag hit-tests probe the REAL resting layout, not a passing banner.
  await page.evaluate(() => {
    const byName = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    game.players[0].hand = [byName('Royal Hilt'), byName('Marketplace Sales'), byName('First Aid')];
    renderGameState();
    document.querySelectorAll('.game-toast').forEach(t => t.remove());
  });
  await sleep(200);

  const sel = mode === 'phone' ? '#tvSeats .pmat' : '#gameSidebar .opp-entry';
  const readMarks = (s) => page.evaluate((q) => {
    const n = game.playerCount;
    const grab = (pi) => {
      const el = document.querySelector(`${q}[data-pi="${pi}"]`);
      if (!el) return null;
      const tag = el.querySelector(':scope > .nt-tag');
      let tr = null, hit = null;
      if (tag) {
        tr = tag.getBoundingClientRect();
        // Real hit-test on the tag (it's pointer-events:none, so flip it
        // for the probe — occlusion bugs pass synthetic checks otherwise).
        tag.style.pointerEvents = 'auto';
        const at = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
        tag.style.pointerEvents = '';
        hit = at === tag;
      }
      return { read: el.classList.contains('nt-read'), tag: tag ? tag.textContent : null,
               onScreen: tr ? (tr.top >= 0 && tr.bottom <= innerHeight && tr.width > 10) : null,
               hit, rect: tr ? { l: tr.left, t: tr.top, r: tr.right, b: tr.bottom } : null };
    };
    return { n, left: grab(n - 1), right: grab(1),
             selfPanel: document.getElementById('statsPanel').classList.contains('nt-read'),
             selfChip: (document.querySelector(`#tvSeats .pmat[data-pi="0"]`) || { classList: { contains: () => false } }).classList.contains('nt-read'),
             total: document.querySelectorAll('.nt-read').length };
  }, s);

  // 1 · Royal Hilt (neighbors only) — driven exactly as the reveal
  // chooser drives it (setTargetHighlights on chooser render); the full
  // chooser integration is step 5 below.
  await page.evaluate(() => setTargetHighlights(game.players[0].hand[0]));
  await sleep(300);
  let m = await readMarks(sel);
  ok(m.left && m.left.read && m.left.tag === '◀ Left Neighbor',
    `Royal Hilt marks the LAST player as left neighbor (${m.left && m.left.tag})`);
  ok(m.right && m.right.read && m.right.tag === 'Right Neighbor ▶',
    `Royal Hilt marks players[1] as right neighbor (${m.right && m.right.tag})`);
  ok(m.left.onScreen === true && m.right.onScreen === true, 'both tags fully on screen');
  ok(m.left.hit === true && m.right.hit === true, 'both tags win the hit-test — nothing paints over them');
  ok(!m.selfPanel && !m.selfChip, 'no self mark for a neighbors-only card');
  if (mode === 'phone') {
    const apart = m.left.rect.t >= m.right.rect.b || m.right.rect.t >= m.left.rect.b
      || m.left.rect.l >= m.right.rect.r || m.right.rect.l >= m.left.rect.r;
    ok(apart, 'phone left/right tags never collide (staggered rungs)');
  }
  await page.screenshot({ path: join(SHOTS, `nt-${mode}.png`) });

  // Marks must survive a full re-render mid-selection (innerHTML rebuilds).
  await page.evaluate(() => renderGameState());
  await sleep(150);
  m = await readMarks(sel);
  ok(m.left.read && m.right.read && m.left.tag === '◀ Left Neighbor',
    'marks + tags survive renderGameState (re-applied after rebuild)');

  // 2 · Marketplace Sales (neighbors + SELF)
  await page.evaluate(() => setTargetHighlights(game.players[0].hand[1]));
  await sleep(300);
  m = await readMarks(sel);
  ok(m.left.read && m.right.read, 'Marketplace Sales still marks both neighbors');
  if (mode === 'phone') ok(m.selfChip, 'Marketplace Sales rings YOUR seat chip (self-read)');
  else {
    const selfTag = await page.evaluate(() =>
      (document.querySelector('#statsPanel > .nt-tag') || {}).textContent || null);
    ok(m.selfPanel && selfTag === 'You', `Marketplace Sales marks your stats panel with a "You" tag (${selfTag})`);
  }
  await page.screenshot({ path: join(SHOTS, `nt-${mode}-self.png`) });

  // 3 · Inert card → nothing marked.
  await page.evaluate(() => setTargetHighlights(game.players[0].hand[2]));
  await sleep(250);
  m = await readMarks(sel);
  ok(m.total === 0, `First Aid marks nobody (${m.total} marks)`);

  // 4 · The REVEAL CHOOSER is the live caller now: throwing Royal Hilt
  // lights the neighbors while the chooser is up, answering clears all.
  await page.evaluate(() => { window.CINEMATIC_SPEED = 0.05; });
  await throwAndAwaitChoice(page, 0);
  await sleep(200);
  const live = await page.evaluate(() => document.querySelectorAll('.nt-read').length);
  ok(live >= 2, `reveal chooser lights the read seats (${live} marks)`);
  await answerChoice(page, /discard \(\+3g\)/);
  await sleep(300);
  const after = await page.evaluate(() => ({
    reads: document.querySelectorAll('.nt-read').length,
    tags: document.querySelectorAll('.nt-tag').length,
  }));
  ok(after.reads === 0 && after.tags === 0, 'answering the chooser clears every ring and tag');
  await page.close();
}

// ═══ BORROW & PLAY CHOOSER: button first, THEN "from whom?" ═══
// Wyatt's 7/7 report: the ◀▶ arrows looked like lender pickers and tapping
// one silently killed the panel. Now the arrows/chips open the rival peek
// (panel steps aside + returns) and Borrow & Play opens a real chooser —
// both neighbors shown, the one with nothing to lend grayed with why.
for (const mode of ['desktop', 'phone']) {
  console.log(`── ${mode}: Borrow & Play — lender chooser + tap-a-neighbor no longer eats the panel`);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`borrow-${mode}: ` + m.text()); });
  page.on('pageerror', e => consoleErrors.push(`borrow-${mode} pageerror: ` + e.message));
  if (mode === 'phone') await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  else await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);
  await sleep(400);

  // Rig: find a card short exactly ONE skill that NO seat lends naturally
  // (so we fully control the lender), then hand the RIGHT neighbor (p1)
  // the only lending card. Left neighbor (last player) has nothing.
  const rig = await page.evaluate(() => {
    const cand = FAVOR_DATA.cards.filter(c => {
      if (c.cost || (c.rewards && c.rewards.gold) || c.special) return false;
      const probe = game.checkRequirements(0, { ...c });
      return !probe.canPlay && probe.missingSkills.length === 1 && (probe.missingSpecial || []).length === 0;
    });
    const natural = game.getBorrowableSkills(0);
    const reqCard = cand.find(c => !natural[game.checkRequirements(0, { ...c }).missingSkills[0]]);
    if (!reqCard) return null;
    const skill = game.checkRequirements(0, { ...reqCard }).missingSkills[0];
    const lender = FAVOR_DATA.cards.find(c => (c.skills || []).includes(skill) && c.name !== reqCard.name);
    const byName = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    const p0 = game.players[0];
    p0.hand = [{ ...reqCard }, byName('Marketplace Sales'), byName('First Aid')];
    p0.gold = 12;
    for (let i = 1; i < game.playerCount; i++) {
      game.players[i].hand = [byName('First Aid'), byName('First Aid'), byName('First Aid')];
    }
    game.players[1].playedCards.push({ ...lender });
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
    document.querySelectorAll('.game-toast').forEach(t => t.remove());
    return { cardName: reqCard.name, skill, lenderName: lender.name,
             lenderGold: game.players[1].gold,
             otherGold: game.players[game.playerCount - 1].gold, n: game.playerCount };
  });
  ok(!!rig, 'rig found a controllable one-skill-short card', 'no candidate — data drifted?');

  // A · Tap-a-neighbor regression: throw the reader card (index 1) so the
  // ◀▶ tags appear on the reveal chooser, then tap the RIGHT chip/tag —
  // the rival peek must open and the chooser must come back, marks intact.
  await page.evaluate(() => { window.CINEMATIC_SPEED = 0.05; });
  await throwAndAwaitChoice(page, 1);
  await sleep(250);
  await page.evaluate((m) => {
    if (m === 'phone') {
      const tag = document.querySelector('#tvSeats .pmat.nt-right .nt-tag');
      (tag || document.querySelector('#tvSeats .pmat[data-pi="1"]')).click();
    } else {
      document.querySelector('#gameSidebar .opp-entry[data-pi="1"]').click();
    }
  }, mode);
  await sleep(450);
  const peek = await page.evaluate(() => ({
    opp: document.getElementById('oppOverlay').classList.contains('active'),
    panelAside: !document.querySelector('.action-panel.active'),
    pending: !!window._finalChoicePending,
  }));
  ok(peek.opp, 'tapping the neighbor arrow/chip opens the rival peek');
  ok(peek.panelAside, 'panel steps aside under the peek');
  ok(peek.pending, 'the reveal choice survives underneath');
  await page.evaluate(() => closeOppOverlay());
  await sleep(450);
  const back = await page.evaluate(() => ({
    panel: document.querySelector('.action-panel').classList.contains('active'),
    marks: document.querySelectorAll('.nt-read').length,
  }));
  ok(back.panel && back.marks >= 2, 'closing the peek restores the chooser — nothing disappears');

  // Finish the round honestly, then re-rig a fresh throw phase for part B
  // (hands rotate at the lock, so the borrow card must be re-dealt).
  await answerChoice(page, /discard \(\+3g\)/);
  await page.waitForFunction(() => game.phase === 'gameplay' && !window._finalChoicePending,
    { timeout: 20000 });
  await page.evaluate((r) => {
    const byName = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    const p0 = game.players[0];
    p0.hand = [byName(r.cardName), byName('Marketplace Sales'), byName('First Aid')];
    p0.gold = 12;
    for (let i = 1; i < game.playerCount; i++) {
      game.players[i].hand = [byName('First Aid'), byName('First Aid'), byName('First Aid')];
      game.players[i].gold = i === 1 ? r.lenderGold : r.otherGold;
      // Part A's round let the rivals play their rigged First Aids — reset
      // the table so ONLY p1 lends the missing skill, as the rig demands.
      game.players[i].playedCards = i === 1 ? [byName(r.lenderName)] : [];
    }
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
  }, rig);
  await sleep(250);

  // B · The chooser: Borrow & Play first, THEN whom.
  await throwAndAwaitChoice(page, 0);
  const hasBtn = await page.evaluate(() =>
    [...document.querySelectorAll('.action-panel .action-btn')].some(b => /Borrow & Play/i.test(b.textContent)));
  ok(hasBtn, 'Borrow & Play offered (right neighbor can lend)');
  await page.evaluate(() => {
    [...document.querySelectorAll('.action-panel .action-btn')].find(b => /Borrow & Play/i.test(b.textContent)).click();
  });
  await sleep(400);
  const chooser = await page.evaluate(() => {
    const ov = document.getElementById('promisePicker');
    const rows = [...ov.querySelectorAll('.bw-row')];
    const row = (pi) => rows.find(r => r.dataset.pi === String(pi));
    const lender = row(1), other = row(game.playerCount - 1);
    return {
      active: ov.classList.contains('active'),
      title: (ov.querySelector('.pp-title') || {}).textContent || '',
      rows: rows.length,
      lenderOn: lender && !lender.classList.contains('off'),
      lenderTag: lender ? (lender.querySelector('.bw-tag') || {}).textContent || '' : '',
      otherOff: other && other.classList.contains('off'),
      otherNote: other ? (other.querySelector('.bw-note') || {}).textContent || '' : '',
    };
  });
  ok(chooser.active && /Borrow/i.test(chooser.title), 'chooser overlay opens on Borrow & Play');
  ok(chooser.rows === 2, `both neighbors on stage (${chooser.rows} rows)`);
  ok(chooser.lenderOn && /Right Neighbor/.test(chooser.lenderTag), 'the lender row is live and tagged ▶');
  ok(chooser.otherOff && /^No /.test(chooser.otherNote), `the empty-handed neighbor sits grayed with why ("${chooser.otherNote}")`);
  await page.screenshot({ path: join(SHOTS, `borrow-chooser-${mode}.png`) });

  // Cancel lands back on the chooser, thrown card untouched.
  await page.evaluate(() => document.getElementById('bwCancel').click());
  await sleep(450);
  const cancel = await page.evaluate(() => ({
    ovGone: !document.getElementById('promisePicker').classList.contains('active'),
    panel: document.querySelector('.action-panel').classList.contains('active'),
    pending: !!game.pendingActivations[0],
    hand: game.players[0].hand.length,
  }));
  ok(cancel.ovGone && cancel.panel && cancel.pending && cancel.hand === 2,
    'Cancel returns to the reveal chooser, thrown card untouched', JSON.stringify(cancel));

  // Tap the lender = commit (single missing skill needs no second confirm).
  await page.evaluate(() => {
    [...document.querySelectorAll('.action-panel .action-btn')].find(b => /Borrow & Play/i.test(b.textContent)).click();
  });
  await sleep(400);
  await page.evaluate(() => {
    [...document.querySelectorAll('#promisePicker .bw-row')].find(r => !r.classList.contains('off')).click();
  });
  await page.waitForFunction((name) =>
    game.players[0].playedCards.some(c => c.name === name) &&
    game.pendingActivations.every(a => !a),
    { timeout: 30000 }, rig.cardName);
  const ledger = await page.evaluate(() => ({
    p0: game.players[0].gold,
    lender: game.players[1].gold,
    other: game.players[game.playerCount - 1].gold,
  }));
  ok(ledger.p0 === 10, `borrower paid 2g (12 → ${ledger.p0})`);
  ok(ledger.lender === rig.lenderGold + 2, `the CHOSEN lender received the fee (${rig.lenderGold} → ${ledger.lender})`);
  ok(ledger.other === rig.otherGold, 'the other neighbor got nothing');
  await page.close();
}

// ═══ BORROW & PLAY MULTI-SKILL: scrolls, auto-advances, buttons in reach ═══
// Wyatt 7/8: with two skills to borrow the second section and the
// Confirm/Cancel row sat below the fold with NO scroll. The section list
// now scrolls (title + actions pinned) and each pick carries you to the
// next open decision. Also: the resting board thumb is 2× (236px).
{
  console.log('── Phone: multi-skill borrow scrolls + auto-advances; board thumb 2×');
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('borrow-multi: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('borrow-multi pageerror: ' + e.message));
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(page);
  await sleep(400);

  // 2× thumb: sized up, and the stage floor still clears it.
  const thumb = await page.evaluate(() => {
    const t = document.getElementById('tvBoardThumb').getBoundingClientRect();
    const s = document.getElementById('tvStage').getBoundingClientRect();
    return { w: t.width, left: t.left, bottom: t.bottom, stageRight: s.right, vh: innerHeight };
  });
  ok(thumb.w >= 230 && thumb.w <= 242, `board thumb is 2× (${Math.round(thumb.w)}px wide)`);
  ok(thumb.bottom <= thumb.vh, 'bigger thumb stays fully on-screen');
  ok(thumb.stageRight <= thumb.left + 2, 'stage floor still clears the bigger thumb');

  // Rig: a card short TWO distinct skills nobody lends naturally; the
  // RIGHT neighbor (p1) holds both lender cards, the left none.
  const rig = await page.evaluate(() => {
    const natural = game.getBorrowableSkills(0);
    const cand = FAVOR_DATA.cards.filter(c => {
      if (c.cost || (c.rewards && c.rewards.gold) || c.special) return false;
      const probe = game.checkRequirements(0, { ...c });
      const uniq = [...new Set(probe.missingSkills)];
      return !probe.canPlay && uniq.length >= 2 && (probe.missingSpecial || []).length === 0
        && uniq.every(s => !natural[s]);
    });
    const reqCard = cand[0];
    if (!reqCard) return null;
    const missing = game.checkRequirements(0, { ...reqCard }).missingSkills;
    const uniq = [...new Set(missing)];
    const byName = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    uniq.forEach(s => {
      const lender = FAVOR_DATA.cards.find(c => (c.skills || []).includes(s) && c.name !== reqCard.name);
      game.players[1].playedCards.push({ ...lender });
    });
    const p0 = game.players[0];
    p0.hand = [{ ...reqCard }, byName('First Aid'), byName('First Aid')];
    p0.gold = 30;
    for (let i = 1; i < game.playerCount; i++) {
      game.players[i].hand = [byName('First Aid'), byName('First Aid'), byName('First Aid')];
    }
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
    document.querySelectorAll('.game-toast').forEach(t => t.remove());
    return { cardName: reqCard.name, sections: uniq.length, fee: missing.length * 2,
             lenderGold: game.players[1].gold };
  });
  ok(!!rig && rig.sections >= 2, `rig: two-skill borrow card on hand (${rig && rig.cardName})`);

  await throwAndAwaitChoice(page, 0);
  await page.evaluate(() => {
    [...document.querySelectorAll('.action-panel .action-btn')].find(b => /Borrow & Play/i.test(b.textContent)).click();
  });
  await sleep(450);

  const open = await page.evaluate(() => {
    const ov = document.getElementById('promisePicker');
    const sc = ov.querySelector('.bw-scroll');
    const cancel = ov.querySelector('#bwCancel').getBoundingClientRect();
    const confirm = ov.querySelector('#bwConfirm');
    return {
      bw: !!ov.querySelector('.pp-inner.bw'),
      sections: ov.querySelectorAll('.bw-section').length,
      undecided: ov.querySelectorAll('.bw-section.undecided').length,
      scrolls: sc.scrollHeight > sc.clientHeight + 1,
      cancelInView: cancel.bottom <= innerHeight + 1 && cancel.top >= 0,
      confirmDisabled: confirm && confirm.disabled,
    };
  });
  ok(open.sections === rig.sections, `one section per missing skill (${open.sections})`);
  ok(open.scrolls, 'section list is scrollable (content taller than the screen)');
  ok(open.cancelInView, 'Confirm/Cancel row pinned ON SCREEN below the scroller');
  ok(open.confirmDisabled === true, 'confirm waits until every skill has a lender');
  await page.screenshot({ path: join(SHOTS, 'borrow-multi-phone.png') });

  // Pick the first section's lender → the list auto-advances to the next.
  await page.evaluate(() => {
    document.querySelector('#promisePicker .bw-section.undecided .bw-row:not(.off)').click();
  });
  await sleep(700);   // smooth-scroll settles
  const advanced = await page.evaluate(() => {
    const sc = document.querySelector('#promisePicker .bw-scroll');
    const next = document.querySelector('#promisePicker .bw-section.undecided');
    const r = next && next.getBoundingClientRect();
    return {
      undecided: document.querySelectorAll('#promisePicker .bw-section.undecided').length,
      scrolled: sc.scrollTop > 4,
      nextVisible: r ? (r.top < innerHeight * 0.9 && r.bottom > 0) : false,
    };
  });
  ok(advanced.undecided === rig.sections - 1, 'pick marks its section decided');
  ok(advanced.scrolled && advanced.nextVisible, 'auto-advance scrolls the next decision into view',
    JSON.stringify(advanced));
  await page.screenshot({ path: join(SHOTS, 'borrow-multi-advanced.png') });

  // Finish: pick the rest, confirm, and the CHOSEN lender collects every fee.
  await page.evaluate(() => {
    [...document.querySelectorAll('#promisePicker .bw-section.undecided')].forEach(sec =>
      sec.querySelector('.bw-row:not(.off)').click());
  });
  await sleep(400);
  await page.evaluate(() => document.getElementById('bwConfirm').click());
  await page.waitForFunction((name) =>
    game.players[0].playedCards.some(c => c.name === name) &&
    game.pendingActivations.every(a => !a),
    { timeout: 30000 }, rig.cardName);
  const ledger = await page.evaluate(() => ({
    p0: game.players[0].gold,
    lender: game.players[1].gold,
  }));
  ok(ledger.p0 === 30 - rig.fee, `borrower paid every fee (30 → ${ledger.p0})`);
  ok(ledger.lender === rig.lenderGold + rig.fee, `lender collected all of it (${rig.lenderGold} → ${ledger.lender})`);
  await page.close();
}

// ═══ RING SLIDE: tap-or-drag, confirm chip INSIDE the art, one direction ═══
// Wyatt's 7/7 report: halo appeared but nothing confirmable — the old
// bubble hung above the board RECT, off-screen on phones. The chip now
// lives in the art; this asserts it lands INSIDE the viewport.
for (const mode of ['desktop', 'phone']) {
  console.log(`── ${mode}: paid ring slide — reachable circles, on-screen confirm, direction lock`);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`ring-${mode}: ` + m.text()); });
  page.on('pageerror', e => consoleErrors.push(`ring-${mode} pageerror: ` + e.message));
  if (mode === 'phone') await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  else await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);
  await sleep(300);

  // Paid slides live at YOUR reveal now (rulebook p.4: before choosing an
  // action) — reach the chooser first, then the board opens over it.
  await page.evaluate(() => {
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
    document.querySelectorAll('.game-toast').forEach(t => t.remove());
  });

  // Skylar's judge-at-the-drop model composes with the throw-first rule:
  // during the THROW phase the ring still grabs, but every circle is
  // blocked — a drop glides home and says "slides on your turn".
  await page.evaluate(() => { game.players[0].gold = 70; openBoardOverlay(); });
  await sleep(350);
  const preReveal = await page.evaluate(() => ({
    grab: document.getElementById('boardOvRing').classList.contains('grab'),
    reach: document.querySelectorAll('.board-ov-slot.reach').length,
  }));
  ok(preReveal.grab && preReveal.reach === 0,
    `throw phase: ring grabs but nothing is reachable (${preReveal.reach})`);
  if (mode === 'desktop') {
    const geo0 = await page.evaluate(() => {
      const w = document.querySelector('.board-ov-boardwrap').getBoundingClientRect();
      const r = document.getElementById('boardOvRing').getBoundingClientRect();
      return { wl: w.left, ww: w.width, rx: r.left + r.width / 2, ry: r.top + r.height / 2 };
    });
    await page.mouse.move(geo0.rx, geo0.ry);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(geo0.rx + (geo0.wl + geo0.ww * 0.663 - geo0.rx) * (i / 6), geo0.ry);
      await sleep(20);
    }
    await page.mouse.up();
    await sleep(500);
    const bounced = await page.evaluate(() => ({
      home: document.getElementById('boardOvRing').style.left === '50%',
      confirm: document.getElementById('boardOvConfirm').classList.contains('active'),
      told: /slides on your turn/i.test(document.getElementById('notifications').textContent),
    }));
    ok(bounced.home && !bounced.confirm, 'a pre-reveal drop glides the ring home, no confirm');
    ok(bounced.told, 'and the player hears WHY (slides live at your reveal)');
  }
  await page.evaluate(() => closeBoardOverlay());
  await sleep(300);

  await throwAndAwaitChoice(page, 0);
  await page.evaluate(() => {
    const p = game.players[0];
    p.gold = 70;                                // Wyatt's scenario: plenty of gold
    p.sliderPosition = 2;
    // Slot coins now pay EVERY landing (claimedSlots is gone — see
    // applySliderAbilities). This flow slides RIGHT, and the Explorer's slots 4
    // and 5 carry no coins (Mind's Eye / Philosopher's Stone events only, both
    // idempotent), so the fee math below stays pure at a clean −5 per space.
    renderGameState();
    openBoardOverlay();
  });
  await sleep(400);
  const st1 = await page.evaluate(() => ({
    ov: document.getElementById('boardOverlay').classList.contains('active'),
    reach: document.querySelectorAll('.board-ov-slot.reach').length,
    grab: document.getElementById('boardOvRing').classList.contains('grab'),
    hint: document.getElementById('boardOvHint').textContent,
  }));
  ok(st1.ov, 'board overlay opens');
  ok(st1.reach === 4, `all four other circles reachable at 70g (${st1.reach})`);
  ok(st1.grab, 'ring is grabbable');
  ok(/drag your ring/i.test(st1.hint), 'hint teaches tap-or-drag');

  // Tap one right → ring rides out, confirm chip appears ON SCREEN.
  await page.evaluate(() => { document.querySelectorAll('.board-ov-slot')[3].click(); });
  await sleep(500);
  const st2 = await page.evaluate(() => {
    const c = document.getElementById('boardOvConfirm');
    const r = c.getBoundingClientRect();
    const ring = document.getElementById('boardOvRing');
    return {
      active: c.classList.contains('active'),
      inView: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.height > 20,
      text: c.textContent,
      ringLeft: ring.style.left,
      pending: ring.classList.contains('pending'),
      ghost: document.getElementById('boardOvGhost').classList.contains('show'),
    };
  });
  ok(st2.active, 'confirm chip appears on tap');
  ok(st2.inView, 'confirm chip lands fully ON SCREEN (the dead-tap bug)', st2.inView ? '' : JSON.stringify(st2));
  ok(/1 space/.test(st2.text) && /−5 Gold/.test(st2.text), 'chip prices one space at 5 Gold');
  ok(st2.ringLeft === '66.3%' && st2.pending, `ring waits on the target pulsing (${st2.ringLeft})`);
  ok(st2.ghost, 'ghost ring marks home');
  await page.screenshot({ path: join(SHOTS, `ring-confirm-${mode}.png`) });

  // ✕ → ring glides home, nothing charged.
  await page.evaluate(() => {
    [...document.querySelectorAll('#boardOvConfirm .btn-royal')].find(b => !b.classList.contains('primary')).click();
  });
  await sleep(500);
  const st3 = await page.evaluate(() => ({
    gone: !document.getElementById('boardOvConfirm').classList.contains('active'),
    ringLeft: document.getElementById('boardOvRing').style.left,
    gold: game.players[0].gold,
    pos: game.players[0].sliderPosition,
  }));
  ok(st3.gone && st3.ringLeft === '50%' && st3.gold === 70 && st3.pos === 2,
    '✕ cancels — ring glides home, purse untouched', JSON.stringify(st3));

  // Two spaces → −10, board STAYS OPEN (repeatable), direction remembered.
  await page.evaluate(() => { document.querySelectorAll('.board-ov-slot')[4].click(); });
  await sleep(350);
  const price2 = await page.evaluate(() => document.getElementById('boardOvConfirm').textContent);
  ok(/2 spaces/.test(price2) && /−10 Gold/.test(price2), 'two-space chip prices −10 Gold');
  await page.evaluate(() => { document.querySelector('#boardOvConfirm .btn-royal.primary').click(); });
  await sleep(1400);
  const st4 = await page.evaluate(() => ({
    pos: game.players[0].sliderPosition,
    gold: game.players[0].gold,
    ovOpen: document.getElementById('boardOverlay').classList.contains('active'),
    dir: game.players[0]._paidSlideDir,
  }));
  ok(st4.pos === 4 && st4.gold === 60, `paid 10g for two spaces (slot ${st4.pos + 1}, ${st4.gold}g)`);
  ok(st4.ovOpen, 'board stays open — sliding is repeatable');
  ok(st4.dir === 1, 'engine holds the turn direction');

  // Reverse tap in the SAME turn → blocked, every leftward circle reads why.
  await page.evaluate(() => { document.querySelectorAll('.board-ov-slot')[2].click(); });
  await sleep(400);
  const st5 = await page.evaluate(() => ({
    confirm: document.getElementById('boardOvConfirm').classList.contains('active'),
    pos: game.players[0].sliderPosition,
    blocked: document.querySelectorAll('.board-ov-slot.blocked').length,
    tip: document.querySelectorAll('.board-ov-slot')[2].title,
  }));
  ok(!st5.confirm && st5.pos === 4, 'reverse tap this turn: no confirm, no move');
  ok(st5.blocked === 4, `all leftward circles blocked (${st5.blocked})`);
  ok(/direction per turn/i.test(st5.tip), `tooltip says why ("${st5.tip}")`);

  // DRAG (mouse pointer path — phones reuse the same pointer handlers).
  if (mode === 'desktop') {
    await page.evaluate(() => {
      const p = game.players[0];
      p._paidSlideDir = null;
      p.sliderPosition = 2;
      p.gold = 20;
      renderBoardOvSlots();
    });
    await sleep(350);
    const geo = await page.evaluate(() => {
      const w = document.querySelector('.board-ov-boardwrap').getBoundingClientRect();
      const r = document.getElementById('boardOvRing').getBoundingClientRect();
      return { wl: w.left, ww: w.width, rx: r.left + r.width / 2, ry: r.top + r.height / 2 };
    });
    const targetX = geo.wl + geo.ww * 0.334;   // slot-1 circle center
    await page.mouse.move(geo.rx, geo.ry);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(geo.rx + (targetX - geo.rx) * (i / 8), geo.ry);
      await sleep(20);
    }
    await page.mouse.up();
    await sleep(500);
    const drag = await page.evaluate(() => ({
      confirm: document.getElementById('boardOvConfirm').classList.contains('active'),
      text: document.getElementById('boardOvConfirm').textContent,
      ringLeft: document.getElementById('boardOvRing').style.left,
    }));
    ok(drag.confirm && /−5 Gold/.test(drag.text), 'DRAG: releasing near a circle shows its confirm');
    ok(drag.ringLeft === '33.4%', `DRAG: ring locks over the drop circle (${drag.ringLeft})`);
    await page.screenshot({ path: join(SHOTS, 'ring-drag.png') });
    await page.evaluate(() => { document.querySelector('#boardOvConfirm .btn-royal.primary').click(); });
    await sleep(900);
    const after = await page.evaluate(() => ({ pos: game.players[0].sliderPosition, gold: game.players[0].gold }));
    // 20g − 5g toll + the 4g coin the Explorer's slot 2 pays = 19g. That coin is
    // the point: it now pays EVERY landing (Wyatt's report — see
    // applySliderAbilities), where the old once-per-game rule left this at 15g.
    ok(after.pos === 1 && after.gold === 19,
      `DRAG: pay & slide lands and the slot's coin PAYS (slot ${after.pos + 1}, ${after.gold}g)`);
  }
  await page.close();
}

// ═══ STATS CHIPS: purse order, Mind's Eye digit, flex pair both faces ═══
// Wyatt 7/7: Mind's Eye showed ✓ instead of its count, the flex chip's
// lone icon read as a duplicate skill, and the purse should read
// gold·prestige / favor·scorn.
for (const mode of ['desktop', 'phone']) {
  console.log(`── ${mode}: stat chips — purse order, Mind's Eye count, flex pair`);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`chips-${mode}: ` + m.text()); });
  page.on('pageerror', e => consoleErrors.push(`chips-${mode} pageerror: ` + e.message));
  if (mode === 'phone') await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  else await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);
  await sleep(300);

  const rig = await page.evaluate(() => {
    const p = game.players[0];
    const eye = FAVOR_DATA.cards.find(c => c.special === 'minds_eye');
    const flex = FAVOR_DATA.cards.find(c => c.special === 'alchemy_or_prospecting');
    if (!eye || !flex) return null;
    p.playedCards.push({ ...eye }, { ...flex });
    game.applySlotSkills(p);          // rebuilds skills + flexSkills from the table
    renderGameState();
    document.querySelectorAll('.game-toast').forEach(t => t.remove());
    return { eyeCount: game.getMindsEyeCount(0), flexPairs: p.flexSkills.length };
  });
  ok(!!rig && rig.eyeCount >= 1 && rig.flexPairs >= 1, 'rig: a Mind\'s Eye and a flex card on the table',
    JSON.stringify(rig));

  if (mode === 'phone') {
    const rail = await page.evaluate(() => {
      const purse = [...document.querySelectorAll('#tvPurse .tv-purse-chip')]
        .map(c => ['gold', 'prestige', 'favor', 'scorn'].find(k => c.classList.contains(k)));
      const eyeChip = [...document.querySelectorAll('#tvSkills .tv-skill-chip.special')]
        .find(c => c.querySelector('img[alt="Mind\'s Eye"]'));
      const flexChip = document.querySelector('#tvSkills .tv-skill-chip.flex');
      return {
        purse,
        eyeVal: eyeChip ? eyeChip.querySelector('b').textContent : null,
        flexIcons: flexChip ? flexChip.querySelectorAll('.flex-pair .skill-svg').length : 0,
        flexStar: flexChip ? flexChip.querySelector('b').textContent : null,
      };
    });
    ok(rail.purse.join(',') === 'gold,prestige,favor,scorn',
      `purse 2×2 reads gold·prestige / favor·scorn (${rail.purse.join(',')})`);
    ok(rail.eyeVal === String(rig.eyeCount), `Mind's Eye chip shows its COUNT (${rail.eyeVal})`);
    ok(rail.flexIcons === 2, `flex chip wears BOTH faces of the pair (${rail.flexIcons} icons)`);
    ok(rail.flexStar === '✦', `single flex unit still stars (${rail.flexStar})`);
  } else {
    const panel = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#statsPanel .skill-row.special-ability')];
      const eyeRow = rows.find(r => /Mind/.test(r.textContent));
      const flexRow = document.querySelector('#statsPanel .skill-row.flex-skill');
      return {
        eyeVal: eyeRow ? eyeRow.querySelector('.skill-value').textContent : null,
        flexIcons: flexRow ? flexRow.querySelectorAll('.skill-icon.flex-pair .skill-svg').length : 0,
      };
    });
    ok(panel.eyeVal === String(rig.eyeCount), `desktop Mind's Eye row shows its COUNT (${panel.eyeVal})`);
    ok(panel.flexIcons === 2, `desktop flex row wears both faces (${panel.flexIcons} icons)`);
  }
  await page.screenshot({ path: join(SHOTS, `stat-chips-${mode}.png`) });
  await page.close();
}

// ═══ VICTORY SCREEN: dynamic headline, placement colors, deltas, count-up ═══
console.log('── Victory screen: win + non-win ceremonies, deltas, phone fit');
{
  const AUDIT_UID = 'uaudit' + Math.random().toString(36).slice(2, 8);
  // Favor rigs are exact: no cards played + every hero's center slot grants
  // zero favor, so these values ARE the finish order. A known purse +
  // skill spread rides along so the holdings strip can be asserted.
  const rigScoring = (pg, youFavor, p1Favor, p2Favor) => pg.evaluate((a, b, c) => {
    // Through the ledger, never a raw write: player.favor is DERIVED from
    // favorLog since 7/19, so a direct assignment scores nothing. 'character'
    // is the source this rig is standing in for.
    game.awardFavor(0, a, 'character', 'Rigged standing');
    game.awardFavor(1, b, 'character', 'Rigged standing');
    game.awardFavor(2, c, 'character', 'Rigged standing');
    game.players[0].gold = 12;
    game.players[0].prestige = 7;
    game.players[0].scorn = 2;
    game.players[0].bonusSkills = { knowledge: 3, power: 2 };
    game.applySlotSkills(game.players[0]);
    showScoring();
  }, youFavor, p1Favor, p2Favor);

  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('victory: ' + m.text()); });
  await page.evaluateOnNewDocument((u) => {
    localStorage.setItem('favorUid', u);
    localStorage.setItem('favorName', 'Audit Herald');
    localStorage.setItem('favorQueue', '3');
  }, AUDIT_UID);
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });

  // ── WIN ──
  await rigScoring(page, 100, 10, 5);
  await sleep(300);
  const win = await page.evaluate(() => {
    const g = document.querySelector('.vs-grid');
    const cells = g ? [...g.querySelectorAll('.vsg-cell')] : [];
    return {
      headline: (document.querySelector('.vs-headline') || {}).textContent,
      personal: (document.querySelector('.vs-personal') || {}).textContent,
      rays: !!document.querySelector('.vs-head.win .champ-rays'),
      oldH1: !!document.querySelector('#scoring-screen .select-title'),
      rowLabels: g ? [...g.querySelectorAll('.vsg-label span')].map(s => s.textContent) : [],
      heads: g ? [...g.querySelectorAll('.vsg-head')].map(h => ({
        cls: h.className,
        name: (h.querySelector('.vsg-hname') || {}).textContent,
        face: !!h.querySelector('.vsg-face'),
        trophy: !!h.querySelector('svg.vs-trophy'),
      })) : [],
      cells: cells.length,
      // Addressed BY ROW LABEL, not by a hardcoded index. These were literal
      // offsets (cells[9], cells[15]) until 7/18, when the Gold Exchange row
      // landed between Artifacts and Character and silently moved every one
      // of them. A sheet row is a thing the design will keep adding.
      byLabel: (() => {
        if (!g) return {};
        const cols = [...g.querySelectorAll('.vsg-head')].length;
        const labels = [...g.querySelectorAll('.vsg-label')]
          .map(l => (l.querySelector('span') || {}).textContent);
        const at = (label, col) => {
          const ri = labels.indexOf(label);
          return ri < 0 ? null : cells[ri * cols + col];
        };
        const cell = (label) => {
          const c = at(label, 0);
          return c ? { t: c.textContent, bad: c.classList.contains('bad'), drill: c.classList.contains('drill') } : null;
        };
        return { character: cell('Character'), scorn: cell('Scorn'),
                 prestige: cell('Prestige'), stone: cell("Philosopher's Stone"),   // must be absent
                 artifacts: cell('Artifacts') };
      })(),
      totals: g ? [...g.querySelectorAll('.vsg-cell.total b')].map(b => b.dataset.total) : [],
      noGoldCol: g ? !/tiebreak/i.test(g.textContent) : false,
      ratingDelta: (document.querySelector('.vs-delta.rating b') || {}).textContent,
      ratingNew: (document.querySelector('.vs-delta.rating .vs-d-new') || { dataset: {} }).dataset.total,
      starDelta: (document.querySelector('.vs-delta.stars b') || {}).textContent,
      starNew: (document.querySelector('.vs-delta.stars .vs-d-new') || { dataset: {} }).dataset.total,
      playAgain: !!([...document.querySelectorAll('.scoring-actions .btn-royal')].find(b => /play again/i.test(b.textContent))),
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  ok(win.headline === 'You Are Victorious!', `win headline (${win.headline})`);
  ok(win.rays, 'gold rays crown a human win');
  ok(win.personal === 'The realm bows before its new sovereign.', `win personal line (${win.personal})`);
  ok(!win.oldH1, '"The Queen Has Decided" h1 is gone');
  // ⚠ NO stone row. The gold x stones -> Favor conversion was removed
  // entirely on 7/18 — Wyatt: "that's not a mechanic in the game". No card
  // prints it; every Philosopher's Stone reference is a requirement or a
  // grant of the token. Splitting it out of Artifacts is what made it
  // visible enough to recognise as invented.
  ok(win.rowLabels.join('|') === 'Missions|Adventures|Artifacts|Character|Prestige|Scorn|Total',
    `score sheet rows as printed (${win.rowLabels.join(', ')})`);
  ok(win.heads.length === 3 && win.heads[0].name === 'You' && /\bwin\b/.test(win.heads[0].cls)
    && win.heads[0].trophy && win.heads[0].face,
    '1st column: You — portrait, trophy, champion glow');
  ok(win.heads.every(h => h.face), 'every heir wears their portrait');
  ok(win.cells === 21, `7 rows × 3 heirs of cells (${win.cells})`);
  ok(win.byLabel.character && win.byLabel.character.t === '100',
    `rigged favor lands in the Character row (${(win.byLabel.character || {}).t})`);
  ok(win.byLabel.scorn && win.byLabel.scorn.t === '−2' && win.byLabel.scorn.bad,
    `scorn reads −2 in red (${(win.byLabel.scorn || {}).t})`);
  ok(!win.byLabel.stone && !win.rowLabels.some(l => /stone|gold exchange/i.test(l)),
    'no Philosopher\'s Stone / Gold Exchange row — gold does not convert to Favor');
  ok(win.totals.join(',') === '105,10,5', `totals = favor + prestige − scorn (${win.totals.join(',')})`);
  ok(win.noGoldCol, 'no gold tiebreaker column');
  ok(/^\+\d\.\d\d$/.test(win.ratingDelta),
    `a win gains rating, shown 1.00–7.00 style (${win.ratingDelta})`);
  // The old bound was the K-cap (1096). Under the ladder a fresh 1.00 win
  // pays far more — that is the entire point of the 2.0x fast band — and
  // the rail is MAX_SWING 300, not a K multiple.
  ok(+win.ratingNew > 1000 && +win.ratingNew <= 1300,
    `a fresh player's win lands well above 1000 and inside the 300 rail (${win.ratingNew})`);
  ok(+win.ratingNew - 1000 >= 100,
    `and it is SUBSTANTIAL, not the old three hundredths (+${+win.ratingNew - 1000})`);
  ok(win.starDelta === '+10', `win pays +10 Stars (${win.starDelta})`);
  ok(win.starNew === '10', `fresh player's star target = 10 (${win.starNew})`);
  ok(win.playAgain, 'Play Again survives');
  ok(!win.hscroll, 'no horizontal scroll');

  // The prestige row carries the rigged 7 — sheet cells are engine truth.
  ok(win.byLabel.prestige && win.byLabel.prestige.t === '7',
    `prestige row reads the rigged 7 (${(win.byLabel.prestige || {}).t})`);

  // Count-up actually lands on the totals (grid totals start ~1150ms in).
  await sleep(2400);
  const landed = await page.evaluate(() => {
    const b = document.querySelector('.vs-grid .vsg-cell.total b');
    return {
      top: b ? b.textContent : null,
      target: b ? b.dataset.total : null,
      rating: (document.querySelector('.vs-delta.rating .vs-d-new') || {}).textContent,
      ratingTarget: (document.querySelector('.vs-delta.rating .vs-d-new') || { dataset: {} }).dataset.total,
    };
  });
  ok(landed.top === landed.target
    && landed.rating === (parseInt(landed.ratingTarget, 10) / 1000).toFixed(2),
    `count-up lands (score ${landed.top}/${landed.target}, rating ${landed.rating})`);
  await page.screenshot({ path: join(SHOTS, 'vs-desktop-win.png') });

  // ⚠⚠ THE DISPLAY/LEDGER SEAM. The sheet computed from the local _me cache
  // while the write computed from the server row inside its transaction.
  // Under Elo a stale cache meant a slightly wrong number; under the ladder
  // it can mean a DIFFERENT RULE — the sheet showing a floor-protected gain
  // while the write applies a fall, because the two disagreed about which
  // side of the 2.00 line the game started on. They must agree exactly.
  const seam = await page.evaluate(async (u) => {
    const shown = parseInt((document.querySelector('.vs-delta.rating .vs-d-new') || { dataset: {} }).dataset.total, 10);
    let wrote = null;
    for (let i = 0; i < 40; i++) {
      const s = await firebase.database().ref(`favor/players/${u}/rating`).get();
      if (s.exists()) { wrote = s.val(); if (wrote === shown) break; }
      await new Promise(r => setTimeout(r, 250));
    }
    return { shown, wrote };
  }, AUDIT_UID);
  ok(seam.shown === seam.wrote,
    `the sheet's rating and the ledger's write agree exactly (shown ${seam.shown}, wrote ${seam.wrote})`);

  // ── NON-WIN (finish 3rd) — startGame navigates fresh ──
  await startGame(page);
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await rigScoring(page, 5, 100, 50);
  await sleep(300);
  const loss = await page.evaluate(() => ({
    headline: (document.querySelector('.vs-headline') || {}).textContent,
    rays: !!document.querySelector('.vs-head .champ-rays'),
    personal: (document.querySelector('.vs-personal') || {}).textContent,
    myColIdx: [...document.querySelectorAll('.vs-grid .vsg-head')].findIndex(h => h.classList.contains('me')),
    ratingDelta: (document.querySelector('.vs-delta.rating b') || {}).textContent,
  }));
  ok(/Claims the Throne$/.test(loss.headline) && !/You/.test(loss.headline),
    `rival win headline (${loss.headline})`);
  ok(!loss.rays, 'no rays when a rival takes the throne');
  ok(loss.personal === 'You finished 3rd.', `personal line (${loss.personal})`);
  ok(loss.myColIdx === 2, `your column stands 3rd on the sheet (idx ${loss.myColIdx})`);
  // ⚠ Sub-2.00 LAST PLACE GAINS its consolation token — "last place should
  // push you up until 2.0, just slightly". This demanded a negative delta
  // and would fail on a correct ladder. Above 2.00 it would be negative;
  // this rig's player is nowhere near it.
  ok(loss.ratingDelta === '+0.01',
    `sub-2.00 last place still gains its token, not a fall (${loss.ratingDelta})`);
  await page.screenshot({ path: join(SHOTS, 'vs-desktop-loss.png') });

  // ── Firebase hygiene: remove every trace of the audit player.
  // postGameResult's LAST write is the daily best — wait for it so the
  // remove can't race a still-in-flight write (which would resurrect
  // the row moments after the scrub and flake this very check). ──
  const cleaned = await page.evaluate(async (u) => {
    if (FLB.mode !== 'firebase') return 'local-mode (nothing remote to clean)';
    const KEY = FLB.currentDateKey();
    for (let i = 0; i < 40; i++) {
      const d = await firebase.database().ref(`favor/daily/${KEY}/scores/${u}`).get();
      if (d.exists()) break;
      await new Promise(r => setTimeout(r, 250));
    }
    // The rating/stars/daily txns fire un-awaited from showScoring — a
    // straggler can resurrect the row AFTER a single remove (flaked one
    // run in three). Remove, settle, verify; repeat until the read stays
    // empty. Sweeping EVERY daily key matters: residue on yesterday's
    // board would get CROWNED at settlement.
    let verdict = 'RESIDUE';
    for (let attempt = 0; attempt < 6 && verdict === 'RESIDUE'; attempt++) {
      await firebase.database().ref(`favor/players/${u}`).remove();
      const days = (await firebase.database().ref('favor/daily').get()).val() || {};
      for (const k of Object.keys(days)) {
        await firebase.database().ref(`favor/daily/${k}/scores/${u}`).remove();
      }
      await new Promise(r => setTimeout(r, 500));
      const p = await firebase.database().ref(`favor/players/${u}`).get();
      const d = await firebase.database().ref(`favor/daily/${KEY}/scores/${u}`).get();
      verdict = (!p.exists() && !d.exists()) ? 'clean' : 'RESIDUE';
    }
    return verdict;
  }, AUDIT_UID);
  ok(cleaned !== 'RESIDUE', `audit player scrubbed from favor/* (${cleaned})`);
  await page.close();

  // ── PHONE: the ceremony fits 844×390 ──
  const phone = await browser.newPage();
  phone.on('console', m => { if (m.type() === 'error') consoleErrors.push('victory-phone: ' + m.text()); });
  await phone.evaluateOnNewDocument((u) => {
    localStorage.setItem('favorUid', u);
    localStorage.setItem('favorName', 'Audit Herald');
    localStorage.setItem('favorQueue', '3');
  }, AUDIT_UID + 'p');
  await phone.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(phone);
  await phone.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await rigScoring(phone, 100, 10, 5);
  await sleep(1500);
  const pfit = await phone.evaluate(() => {
    const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.top < window.innerHeight; };
    const btn = [...document.querySelectorAll('.scoring-actions .btn-royal')].find(b => /play again/i.test(b.textContent));
    btn.scrollIntoView({ block: 'end' });
    return {
      headline: vis(document.querySelector('.vs-headline')),
      deltas: vis(document.querySelector('.vs-delta.rating')),
      grid: vis(document.querySelector('.vs-grid')),
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      btnReachable: vis(btn),
      screenScrolls: document.getElementById('scoring-screen').scrollHeight >= document.getElementById('scoring-screen').clientHeight,
    };
  });
  ok(pfit.headline && pfit.deltas, 'phone: headline + rating delta visible');
  ok(pfit.grid, 'phone: the score sheet is on stage');
  ok(pfit.btnReachable, 'phone: Play Again reachable (scrolls into view)');
  ok(!pfit.hscroll, 'phone: no horizontal scroll');
  await phone.screenshot({ path: join(SHOTS, 'vs-phone.png') });
  await phone.evaluate(async (u) => {
    if (FLB.mode !== 'firebase') return;
    const KEY = FLB.currentDateKey();
    for (let i = 0; i < 40; i++) {   // wait out in-flight posts (see above)
      const d = await firebase.database().ref(`favor/daily/${KEY}/scores/${u}`).get();
      if (d.exists()) break;
      await new Promise(r => setTimeout(r, 250));
    }
    await firebase.database().ref(`favor/players/${u}`).remove();
    const days = (await firebase.database().ref('favor/daily').get()).val() || {};
    for (const k of Object.keys(days)) {   // all keys — see boundary note above
      await firebase.database().ref(`favor/daily/${k}/scores/${u}`).remove();
    }
  }, AUDIT_UID + 'p');
  await phone.close();
}

// ═══ CHARACTER STORE: grid, gating, seeded purchase, hero-select pool ═══
console.log('── Store: 10-hero shelf, transaction gating, purchase joins the select pool');
{
  const AUDIT_UID = 'uaudit' + Math.random().toString(36).slice(2, 8);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('store: ' + m.text()); });
  await page.evaluateOnNewDocument((u) => {
    localStorage.setItem('favorUid', u);
    localStorage.setItem('favorName', 'Audit Herald');
    localStorage.setItem('favorQueue', '3');
    localStorage.removeItem('favorOwned');
  }, AUDIT_UID);
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await sleep(400);

  // Menu carries the Store button; Skylar's hooks survive beside it
  // (How to Play lives in the quiet row as a .menu-link now).
  const menu = await page.evaluate(() => ({
    store: !!([...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')].find(b => /store/i.test(b.textContent))),
    howto: !!([...document.querySelectorAll('#title-screen .ts-card .ts-plaque')].find(b => /how to play/i.test(b.textContent))),
    promptTest: !!document.getElementById('promptTestToggle'),
  }));
  ok(menu.store && menu.howto && menu.promptTest, 'menu: Store button beside How to Play + Prompt Test');

  // Fresh player: 10 heroes on the shelf, five free, five for sale.
  await page.evaluate(() => FLB.openStore());
  await sleep(600);
  const shelf = await page.evaluate(() => ({
    cards: document.querySelectorAll('.st-card').length,
    owned: document.querySelectorAll('.st-card .st-owned').length,
    forSale: [...document.querySelectorAll('.st-card .st-buy')].map(b => b.textContent.trim()),
    balance: document.getElementById('storeStars').textContent.trim(),
    art: [...document.querySelectorAll('.st-card img')].every(i => i.src.includes('assets/characters/')),
  }));
  ok(shelf.cards === 10, `all ten heroes on the shelf (${shelf.cards})`);
  ok(shelf.owned === 5, `five free heroes wear Owned (${shelf.owned})`);
  ok(shelf.forSale.length === 5 && shelf.forSale.every(t => t === '★ 100'),
    `five store heroes priced ★ 100 (${shelf.forSale.join(', ')})`);
  ok(/★ 0/.test(shelf.balance), `fresh balance reads ★ 0 (${shelf.balance})`);
  ok(shelf.art, 'every shelf card shows the real character art');

  // Board inspect: tap a painting → the whole board on the easel (print-
  // res hd/ recut) with name + the same buy tag ("hmm, maybe I'll buy").
  await page.evaluate(() => { document.querySelector('.st-card[data-char="duchess"] .st-frame img').click(); });
  await page.waitForFunction(() => {
    const i = document.querySelector('#storeInspect .st-insp-frame img');
    return i && i.complete && i.naturalWidth > 0;
  }, { timeout: 8000 });
  await sleep(350);
  const insp = await page.evaluate(() => {
    const box = document.getElementById('storeInspect');
    const img = box.querySelector('.st-insp-frame img');
    const r = img.getBoundingClientRect();
    return {
      active: box.classList.contains('active'),
      hd: img.src.includes('assets/characters/hd/'),
      big: r.width >= window.innerWidth * 0.55,
      fits: r.width <= window.innerWidth && r.height <= window.innerHeight,
      name: (box.querySelector('.st-name') || {}).textContent,
      buy: ((box.querySelector('.st-buy') || {}).textContent || '').trim(),
    };
  });
  ok(insp.active, 'tapping a painting opens the board inspect');
  ok(insp.hd, 'the easel shows the print-res recut (hd/)');
  ok(insp.big && insp.fits, 'board fills the stage and stays on-screen');
  ok(insp.name === 'Duchess' && /★ 100/.test(insp.buy),
    `easel carries name + price (${insp.name}, ${insp.buy})`);
  // Rulebook flavor: italic epithet, DIFFICULTY star row, the printed Tip.
  const flavor = await page.evaluate(() => ({
    epithet: (document.querySelector('#storeInspect .st-epithet') || {}).textContent,
    diff: (document.querySelector('#storeInspect .st-insp-diff') || {}).textContent || '',
    tip: (document.querySelector('#storeInspect .st-insp-tip') || {}).textContent || '',
    shelfStars: [...document.querySelectorAll('.st-card .st-diff')].length === 10 &&
      [...document.querySelectorAll('.st-card .st-diff')].every(d => /★/.test(d.textContent)),
  }));
  ok(flavor.epithet === 'Philanthropist' && /DIFFICULTY/.test(flavor.diff) && /★★★/.test(flavor.diff),
    `easel speaks rulebook — ${flavor.epithet}, ${flavor.diff.trim()}`);
  ok(/Your Generosity will be Rewarded/.test(flavor.tip), 'the printed Tip rides the easel');
  ok(flavor.shelfStars, 'every shelf plate wears its difficulty stars');
  await page.screenshot({ path: join(SHOTS, 'store-inspect.png') });

  // Broke tap from the easel: BOTH buttons say why (shared selector),
  // and the easel survives the 1.2s restore re-render.
  await page.evaluate(() => { document.querySelector('#storeInspect .st-buy').click(); });
  await sleep(250);
  const brokeBeat = await page.evaluate(() => ({
    insp: (document.querySelector('#storeInspect .st-buy') || {}).textContent,
    shelf: (document.querySelector('.st-card[data-char="duchess"] .st-buy') || {}).textContent,
  }));
  ok(brokeBeat.insp === 'Not enough ★' && brokeBeat.shelf === 'Not enough ★',
    `broke tap says why on easel AND shelf (${brokeBeat.insp} / ${brokeBeat.shelf})`);
  await sleep(1400);
  const restored = await page.evaluate(() => ({
    active: document.getElementById('storeInspect').classList.contains('active'),
    buy: ((document.querySelector('#storeInspect .st-buy') || {}).textContent || '').trim(),
  }));
  ok(restored.active && /★ 100/.test(restored.buy),
    `easel survives the re-render, price restored (${restored.buy})`);

  // Scrim click closes just the easel — the stall stays open.
  await page.evaluate(() => { document.getElementById('storeInspect').click(); });
  await sleep(250);
  const inspClosed = await page.evaluate(() => ({
    insp: document.getElementById('storeInspect').classList.contains('active'),
    store: document.getElementById('storePanel').classList.contains('active'),
    cards: document.querySelectorAll('.st-card').length,
  }));
  ok(!inspClosed.insp && inspClosed.store && inspClosed.cards === 10,
    'scrim closes the easel, the stall stays open');

  // Broke: the buy path refuses and nothing is written.
  const broke = await page.evaluate(async () => {
    const r = await FLB.buyCharacter('duchess');
    return { r, owned: FLB.ownedIds().length };
  });
  ok(broke.r.ok === false && broke.r.why === 'stars' && broke.owned === 5,
    `broke player refused (${broke.r.why}); pool stays at 5`);

  // Seed a purse (the champions-test pattern), then buy the Duchess.
  await page.evaluate(async () => {
    if (FLB.mode === 'firebase') {
      await firebase.database().ref(`favor/players/${FLB.uid()}/stars`).set(250);
    } else {
      const t = JSON.parse(localStorage.getItem('favorLB') || '{}');
      t.players = t.players || {}; t.players[FLB.uid()] = { ...(t.players[FLB.uid()] || {}), stars: 250 };
      localStorage.setItem('favorLB', JSON.stringify(t));
    }
  });
  await page.evaluate(() => FLB.openStore());
  await sleep(600);
  ok(/★ 250/.test(await page.evaluate(() => document.getElementById('storeStars').textContent)),
    'seeded balance shows ★ 250');
  await page.evaluate(() => FLB.askBuy('duchess'));
  await sleep(200);
  const confirmTxt = await page.evaluate(() =>
    (document.querySelector('.st-card[data-char="duchess"] .st-buy') || {}).textContent);
  ok(/Buy — ★ 100\?/.test(confirmTxt || ''), `tap asks for confirmation (${confirmTxt})`);
  // Fire WITHOUT awaiting: confirmBuy's promise includes the celebration,
  // which only a click resolves — awaiting it from evaluate deadlocks the
  // protocol (180s timeout). Braces make the arrow return undefined.
  await page.evaluate(() => { FLB.confirmBuy('duchess'); });
  await page.waitForFunction(() => document.getElementById('champOverlay').classList.contains('active'), { timeout: 8000 });
  const cheer = await page.evaluate(() => document.getElementById('champTitle').textContent);
  ok(cheer === 'Duchess Joins Your Court!', `royal celebration fires (${cheer})`);
  await page.screenshot({ path: join(SHOTS, 'store-celebration.png') });
  await page.evaluate(() => document.getElementById('champBtn').click());
  await sleep(400);

  const after = await page.evaluate(async () => {
    const remote = FLB.mode === 'firebase'
      ? (await firebase.database().ref(`favor/players/${FLB.uid()}`).get()).val()
      : JSON.parse(localStorage.getItem('favorLB')).players[FLB.uid()];
    return {
      balance: document.getElementById('storeStars').textContent.trim(),
      duchessOwnedBadge: !!document.querySelector('.st-card[data-char="duchess"] .st-owned'),
      mirror: JSON.parse(localStorage.getItem('favorOwned') || '[]'),
      pool: FLB.ownedIds(),
      remoteStars: remote && remote.stars,
      remoteOwned: remote && remote.owned && remote.owned.duchess === true,
      remoteName: remote && remote.name,
    };
  });
  ok(/★ 150/.test(after.balance), `balance drops to ★ 150 (${after.balance})`);
  ok(after.duchessOwnedBadge, 'Duchess card flips to Owned');
  ok(after.mirror.includes('duchess'), `localStorage mirror carries the purchase (${after.mirror})`);
  ok(after.pool.length === 6 && after.pool.includes('duchess'), 'owned pool grows to 6');
  ok(after.remoteStars === 150 && after.remoteOwned === true,
    `ledger: stars 150 + owned/duchess true (${after.remoteStars})`);
  ok(!!after.remoteName, 'first purchase materialized the player row (lazy join)');
  await page.screenshot({ path: join(SHOTS, 'store-desktop.png') });

  // Exactly-once + can't-afford gating straight at the transaction.
  const guards = await page.evaluate(async () => {
    const twice = await FLB.buyCharacter('duchess');
    if (FLB.mode === 'firebase') {
      await firebase.database().ref(`favor/players/${FLB.uid()}/stars`).set(50);
    } else {
      const t = JSON.parse(localStorage.getItem('favorLB')); t.players[FLB.uid()].stars = 50;
      localStorage.setItem('favorLB', JSON.stringify(t));
    }
    const poor = await FLB.buyCharacter('scientist');
    const remote = FLB.mode === 'firebase'
      ? (await firebase.database().ref(`favor/players/${FLB.uid()}`).get()).val()
      : JSON.parse(localStorage.getItem('favorLB')).players[FLB.uid()];
    return { twice, poor, stars: remote.stars, scientistOwned: !!(remote.owned && remote.owned.scientist) };
  });
  ok(guards.twice.ok === false, 'double-buy refused (exactly once)');
  ok(guards.poor.ok === false && guards.stars === 50 && !guards.scientistOwned,
    `50★ can't buy a 100★ hero — no decrement, no ownership (${guards.stars})`);

  // Buying MUST re-open the sticky offer. It's reused for 10 minutes while every
  // id in it stays owned, and a purchase never invalidated it — so the hero you
  // just paid ★100 for could not be offered to you until the roll expired, while
  // the celebration told you she'd "joined your select pool". (Fixed in
  // FLB.confirmBuy; this is the regression guard.)
  const sticky = await page.evaluate(() => localStorage.getItem('favorOffer'));
  ok(sticky === null, 'buying a hero re-opens the sticky offer so she can actually be dealt');

  // Hero select draws ONLY from owned — and the Duchess can now be offered.
  const pool = await page.evaluate(() => {
    const owned = new Set(FLB.ownedIds());
    let allOwned = true, duchessSeen = false;
    for (let i = 0; i < 20; i++) {
      // The sticky offer pins ONE roll on purpose (no re-rolling by backing out),
      // so clear it per shuffle — what's under test here is that the ROLL itself
      // can offer her, which is precisely what ★100 is supposed to buy.
      localStorage.removeItem('favorOffer');
      showCharacterSelect();
      _offeredHeroes.forEach(c => {
        if (!owned.has(c.id)) allOwned = false;
        if (c.id === 'duchess') duchessSeen = true;
      });
    }
    return { allOwned, duchessSeen };
  });
  ok(pool.allOwned, 'every hero-select offer is an OWNED hero (20 shuffles)');
  ok(pool.duchessSeen, 'the bought Duchess joins the offer pool');

  // Victory ceremony now shows the star delta against the live balance.
  await startGame(page);
  await page.evaluate(() => {
    game.players[0].favor = 100; game.players[1].favor = 10; game.players[2].favor = 5;
    showScoring();
  });
  await sleep(1600);
  const vs = await page.evaluate(() => ({
    delta: (document.querySelector('.vs-delta.stars b') || {}).textContent,
    target: (document.querySelector('.vs-delta.stars .vs-d-new') || { dataset: {} }).dataset.total,
  }));
  ok(vs.delta === '+10' && vs.target === '60', `ceremony stars: +10 → 60 on a 50★ purse (${vs.delta} → ${vs.target})`);

  // Leave no trace (wait out the in-flight post first — see victory flow).
  const scrub = await page.evaluate(async () => {
    if (FLB.mode !== 'firebase') { localStorage.removeItem('favorLB'); return 'local'; }
    const KEY = FLB.currentDateKey();
    for (let i = 0; i < 40; i++) {
      const d = await firebase.database().ref(`favor/daily/${KEY}/scores/${FLB.uid()}`).get();
      if (d.exists()) break;
      await new Promise(r => setTimeout(r, 250));
    }
    // Remove-verify-retry — un-awaited txn stragglers resurrect a single
    // remove (see the victory flow's note).
    let verdict = 'RESIDUE';
    for (let attempt = 0; attempt < 6 && verdict === 'RESIDUE'; attempt++) {
      await firebase.database().ref(`favor/players/${FLB.uid()}`).remove();
      const days = (await firebase.database().ref('favor/daily').get()).val() || {};
      for (const k of Object.keys(days)) {   // all keys — see boundary note above
        await firebase.database().ref(`favor/daily/${k}/scores/${FLB.uid()}`).remove();
      }
      await new Promise(r => setTimeout(r, 500));
      const p = await firebase.database().ref(`favor/players/${FLB.uid()}`).get();
      verdict = p.exists() ? 'RESIDUE' : 'clean';
    }
    return verdict;
  });
  ok(scrub !== 'RESIDUE', `audit player scrubbed from favor/* (${scrub})`);
  await page.close();

  // Phone: the shelf fits 844×390 (grid scrolls, no horizontal spill).
  const phone = await browser.newPage();
  phone.on('console', m => { if (m.type() === 'error') consoleErrors.push('store-phone: ' + m.text()); });
  await phone.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await phone.goto(URL, { waitUntil: 'networkidle2' });
  await phone.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await phone.evaluate(() => FLB.openStore());
  await sleep(600);
  const pfit = await phone.evaluate(() => {
    const grid = document.getElementById('storeBody');
    const inner = document.querySelector('.st-inner');
    return {
      cards: grid.querySelectorAll('.st-card').length,
      scrolls: grid.scrollHeight > grid.clientHeight + 1,
      innerFits: inner.getBoundingClientRect().height <= window.innerHeight + 1,
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  ok(pfit.cards === 10 && pfit.innerFits && !pfit.hscroll,
    `phone shelf: 10 heroes, panel fits, no h-scroll (scrolls=${pfit.scrolls})`);
  ok(await phone.evaluate(() => document.querySelectorAll('.st-pack').length === 4),
    'phone: the Royal Mint row rides the same panel');
  await phone.screenshot({ path: join(SHOTS, 'store-phone.png') });
  await phone.close();
}

// ═══ THE ROYAL MINT: packs → PayPal checkout URL → Stars just arrive ═══
console.log('── Royal Mint: bundle plaques, honest checkout URL, IPN delivery beat');
{
  const AUDIT_UID = 'uauditmint' + Math.random().toString(36).slice(2, 8);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('mint: ' + m.text()); });
  await page.evaluateOnNewDocument((u) => {
    localStorage.setItem('favorUid', u);
    localStorage.setItem('favorName', 'Audit Herald');
    localStorage.removeItem('favorPendingStars');
    localStorage.removeItem('favorOwned');
  }, AUDIT_UID);
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });

  ok(await page.evaluate(() =>
    !!([...document.querySelectorAll('.menu-link')].find(b => /get stars/i.test(b.textContent)))),
    'menu quiet row carries ★ Get Stars');

  await page.evaluate(() => FLB.openStore());
  await sleep(600);
  const mint = await page.evaluate(() => ({
    packs: [...document.querySelectorAll('.st-pack')].map(p => ({
      stars: p.querySelector('.st-pack-stars').textContent.trim(),
      price: p.querySelector('.st-pack-buy').textContent.trim(),
    })),
    aboveShelves: (() => {
      const m = document.getElementById('storePacks').getBoundingClientRect();
      const g = document.getElementById('storeBody').getBoundingClientRect();
      return m.top < g.top;
    })(),
  }));
  ok(mint.packs.length === 4 &&
     mint.packs.map(p => p.price).join('|') === '$4.00|$6.00|$25.00|$40.00' &&
     mint.packs.map(p => p.stars).join('|') === '★ 50|★ 100|★ 500|★ 1,000',
    `four bundles at Nation pricing (${mint.packs.map(p => p.stars + ' ' + p.price).join(', ')})`);
  ok(mint.aboveShelves, 'the Mint sits above the hero shelves');

  // Buy the ★100 pack: confirm beat, then the checkout tab — intercepted.
  await page.evaluate(() => {
    window._openedUrl = null;
    window.open = (u) => { window._openedUrl = u; return null; };
    document.querySelector('.st-pack[data-pack="favor.stars100"] .st-pack-buy').click();
  });
  await sleep(200);
  ok(await page.evaluate(() =>
    /PayPal/.test(document.querySelector('.st-pack[data-pack="favor.stars100"] .st-pack-buy').textContent)),
    'first tap arms a PayPal confirm beat');
  await page.evaluate(() => {
    document.querySelector('.st-pack[data-pack="favor.stars100"] .st-pack-buy').click();
  });
  await sleep(300);
  const checkout = await page.evaluate((u) => {
    const url = window._openedUrl || '';
    const q = new URL(url).searchParams;
    return {
      host: new URL(url).host,
      cmd: q.get('cmd'),
      business: q.get('business'),
      amount: q.get('amount'),
      currency: q.get('currency_code'),
      invoiceOk: new RegExp('^' + u + '\\.favor\\.stars100\\.\\d{14}$').test(q.get('invoice') || ''),
      notify: q.get('notify_url'),
      pending: !!localStorage.getItem('favorPendingStars'),
      waiting: !!document.getElementById('storeWait'),
    };
  }, AUDIT_UID);
  ok(checkout.host === 'www.paypal.com' && checkout.cmd === '_xclick', `checkout is a PayPal _xclick tab (${checkout.host})`);
  ok(checkout.business === 'gablewyatt@gmail.com', 'payment goes to Wyatt\'s PayPal');
  ok(checkout.amount === '6.00' && checkout.currency === 'USD', `honest price on the tab (${checkout.amount} ${checkout.currency})`);
  ok(checkout.invoiceOk, 'invoice carries uid.pack.timestamp — the IPN contract');
  ok(checkout.notify === 'https://nationgame.live/api/favor/paypal/ipn', 'notify_url points at the box IPN');
  ok(checkout.pending && checkout.waiting, 'store shows the waiting-for-treasury beat');
  await page.screenshot({ path: join(SHOTS, 'store-mint.png') });

  // The box IPN delivers: stars + congrats land in Firebase; the watcher
  // notices within a poll tick and the Mint celebrates.
  await page.evaluate(async (u) => {
    await firebase.database().ref(`favor/players/${u}/msgQueue`).push({
      type: 'star_purchase', stars: 100, item: 'favor.stars100', at: Date.now() });
    await firebase.database().ref(`favor/players/${u}/stars`).set(100);
  }, AUDIT_UID);
  let celebrated = false;
  try {
    await page.waitForFunction(() =>
      document.getElementById('champOverlay').classList.contains('active') &&
      /Royal Mint Delivers/i.test(document.getElementById('champTitle').textContent), { timeout: 12000 });
    celebrated = true;
  } catch (e) { /* asserted below */ }
  ok(celebrated, 'delivery celebrated — "The Royal Mint Delivers!"');
  await page.screenshot({ path: join(SHOTS, 'store-mint-delivered.png') });
  await page.evaluate(() => document.getElementById('champBtn').click());
  await sleep(400);
  const after = await page.evaluate(() => ({
    balance: document.getElementById('storeStars').textContent.trim(),
    pending: !!localStorage.getItem('favorPendingStars'),
    waiting: !!document.getElementById('storeWait'),
  }));
  ok(/★ 100/.test(after.balance), `balance banner reads the new Stars (${after.balance})`);
  ok(!after.pending && !after.waiting, 'pending mark + waiting beat cleared after delivery');

  // A cancelled checkout leaves no residue on the next visit.
  await page.evaluate(() => localStorage.setItem('favorPendingStars',
    JSON.stringify({ packId: 'favor.stars50', stars: 50, at: Date.now() })));
  await page.goto(URL + '?paypal=cancel', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  // WAIT for the cleanup, don't race it — a fixed beat after a cold boot
  // flaked one run in four on nothing but network weather.
  const cancelClean = await page.waitForFunction(() =>
    !localStorage.getItem('favorPendingStars') && location.search === '',
    { timeout: 8000 }).then(() => true, () => false);
  ok(cancelClean, 'cancel return clears the pending mark and cleans the URL');

  // Leave no trace.
  const scrub = await page.evaluate(async (u) => {
    for (let i = 0; i < 6; i++) {
      await firebase.database().ref(`favor/players/${u}`).remove();
      await new Promise(r => setTimeout(r, 400));
      const p = await firebase.database().ref(`favor/players/${u}`).get();
      if (!p.exists()) return 'clean';
    }
    return 'RESIDUE';
  }, AUDIT_UID);
  ok(scrub === 'clean', `mint audit player scrubbed from favor/* (${scrub})`);
  await page.close();
}

// ═══ AVATARS + LEADERBOARD OVERHAUL: crests, medals, Power board ═══
console.log('── Avatars + boards: crest picker, whole-row post, medals, Power, your row');
{
  const AUDIT_UID = 'uauditcrest' + Math.random().toString(36).slice(2, 8);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('crest: ' + m.text()); });
  await page.evaluateOnNewDocument((u) => {
    localStorage.setItem('favorUid', u);
    localStorage.setItem('favorName', 'Audit Herald');
    // Start crestless ONCE — this hook re-runs on startGame's later
    // navigation and must not wipe the crest we just picked.
    if (!localStorage.getItem('__crestFlowSeeded')) {
      localStorage.removeItem('favorAvatar');
      localStorage.setItem('__crestFlowSeeded', '1');
    }
  }, AUDIT_UID);
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });

  // Personas' lifetime power must never feel an audit — capture to compare.
  const ashPowerBefore = await page.evaluate(() =>
    firebase.database().ref('favor/players/persona_ashcroft/power').get().then(s => s.val()));

  // 1 · The crest picker: ten paintings, picking one dresses the chip.
  await page.evaluate(() => FLB.openProfile());
  await sleep(300);
  ok(await page.evaluate(() => document.querySelectorAll('.pf-avatars .pf-av').length === 10),
    'profile offers all ten crests');
  await page.evaluate(() => document.querySelector('.pf-av[data-av="knight"]').click());
  await sleep(600);
  const crest = await page.evaluate(() => ({
    picked: document.querySelector('.pf-av[data-av="knight"]').classList.contains('on'),
    mirror: localStorage.getItem('favorAvatar'),
    chip: !!document.querySelector('#profileChip .av-disc img[src*="Knight"], #profileChip .av-disc img[src*="knight"]'),
  }));
  ok(crest.picked && crest.mirror === 'knight', `crest picked + mirrored (${crest.mirror})`);
  ok(crest.chip, 'the profile chip wears the crest');
  await page.screenshot({ path: join(SHOTS, 'profile-crests.png') });

  // 1b · The profile leads with STANDING, not the crest picker (Wyatt 7/18:
  // "viewing profile is bad — you just see the different avatars you can
  // choose and then you don't really see much else").
  const pf = await page.evaluate(() => {
    const body = document.getElementById('profileBody');
    const kids = [...body.children];
    const idx = (sel) => kids.findIndex(k => k.matches(sel) || k.querySelector(sel));
    const cs = getComputedStyle(body);
    return {
      standingFirst: kids.length > 0 && kids[0].classList.contains('pf-standing'),
      standingBeforePicker: idx('.pf-standing') < idx('.pf-avatars'),
      rating: !!body.querySelector('.pf-standing .pf-rating-val'),
      tier: /Tier \d/.test((body.querySelector('.pf-tier') || {}).textContent || ''),
      record: /\d+ W · \d+ played/.test((body.querySelector('.pf-record') || {}).textContent || ''),
      sections: [...body.querySelectorAll('.pf-sec')].map(s => s.firstChild.textContent.trim()),
      pickerStill: body.querySelectorAll('.pf-avatars .pf-av').length,
      scrolls: cs.overflowY === 'auto',
      // The panel must not hang on a modal: FACH.sync() is async, WRITES,
      // and awaits celebrate(), which blocks on user clicks.
      openedSync: true,
    };
  });
  ok(pf.standingFirst && pf.standingBeforePicker,
    'the profile LEADS with standing; the crest picker is demoted below it');
  ok(pf.rating && pf.tier && pf.record,
    'standing carries rating, tier and record at a glance');
  ok(pf.sections.length >= 2, `it has real sections now (${pf.sections.join(' / ')})`);
  ok(pf.pickerStill === 10, 'all ten crests are still pickable, just no longer the centrepiece');
  ok(pf.scrolls, '#profileBody scrolls on its own so the title stays pinned');

  // Per-hero ledgers — the biggest win, and every field was already in _me.
  await page.evaluate(async (u) => {
    // ⚠ fiddler/doctor deliberately: NOTHING else in this suite asserts on
    // them. Rigging duchess here silently rewrote the ledger the crest
    // flow's own postGameResult assertions read a few hundred lines later,
    // and they failed on a number this rig had put there.
    await firebase.database().ref(`favor/players/${u}/chars`).update({
      fiddler: { r: 1240, g: 3, best: 88 }, doctor: { r: 1080, g: 1, best: 41 },
    });
    // renderProfileChip is what reassigns _me — readRow only fetches.
    await FLB.renderProfileChip();
    FLB.closeProfile(); FLB.openProfile();
  }, AUDIT_UID);
  await sleep(500);
  const heroes = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.pf-hero')];
    return {
      n: cells.length,
      first: cells[0] ? cells[0].textContent.replace(/\s+/g, ' ').trim() : '',
      ordered: cells.length >= 2
        && parseFloat(cells[0].querySelector('.pf-hero-r').textContent)
           >= parseFloat(cells[1].querySelector('.pf-hero-r').textContent),
      bests: cells.filter(c => c.querySelector('.lb-best')).length,
    };
  });
  ok(heroes.n >= 2, `every ridden hero carries its own ledger row (${heroes.n})`);
  ok(/1\.24/.test(heroes.first) && /3 games/.test(heroes.first),
    `each shows crest, rating, games and best score (${heroes.first})`);
  ok(heroes.ordered, 'ranked by your rating with that hero');
  ok(heroes.bests >= 2, 'and each carries its high score');
  await page.screenshot({ path: join(SHOTS, 'profile-standing.png') });

  // Phone portrait AND landscape: the richer panel must still fit.
  for (const [w, h, tag] of [[375, 667, 'portrait'], [667, 375, 'landscape']]) {
    await page.setViewport({ width: w, height: h });
    await sleep(350);
    const fit = await page.evaluate(() => {
      const inner = document.querySelector('.pf-inner');
      const r = inner.getBoundingClientRect();
      return {
        onScreen: r.top >= -1 && r.bottom <= window.innerHeight + 2,
        hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    ok(fit.onScreen && !fit.hscroll, `the profile fits ${w}x${h} ${tag} with no horizontal scroll`);
    await page.screenshot({ path: join(SHOTS, `profile-${tag}.png`) });
  }
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluate(() => FLB.closeProfile());
  await page.evaluate(() => FLB.closeProfile());

  // 2 · One finished game = ONE whole-row post: rating, stars, power,
  // games/wins/streak land together (loss first, then a win).
  await page.evaluate(async () => {
    await FLB.postGameResult([
      { name: 'Rival A', finalScore: 70, power: 20, playerIndex: 1 },
      { name: 'You', finalScore: 60, power: 34, playerIndex: 0 },
      { name: 'Rival B', finalScore: 50, power: 10, playerIndex: 2 },
    ], [], { ratings: [null, null, null], myChar: 'duchess' });
    await FLB.postGameResult([
      { name: 'You', finalScore: 80, power: 40, playerIndex: 0 },
      { name: 'Rival A', finalScore: 45, power: 15, playerIndex: 1 },
      { name: 'Rival B', finalScore: 30, power: 5, playerIndex: 2 },
    ], [], { ratings: [null, null, null], myChar: 'duchess' });
  });
  await sleep(400);
  const row = await page.evaluate((u) =>
    firebase.database().ref(`favor/players/${u}`).get().then(s => s.val()), AUDIT_UID);
  // The LADDER, worked by hand: fresh 1000 vs two 1200 bots (adj 1.1),
  // band 2.0x below the 2.00 line.
  //   2nd of 3: ps 0.30 -> 100 x 0.30 x 1.100 x 2.0 =  66 -> 1066
  //   1st of 3: ps 1.00 -> 100 x 1.00 x 1.067 x 2.0 = 213 -> 1279
  // ⚠ wins is 2, not 1: isWin is place < ceil(n * 0.4), so 2nd of 3 is a
  // win now — "coming in 2nd in a 5 player game should be considered a
  // win" (Wyatt 7/18). The streak follows it to 2. Stars are unchanged.
  ok(row && row.rating === 1279 && row.ratingV === 2 && row.stars === 16,
    `the ladder lands 1066 → 1279 with ratingV 2, stars 6+10=16 (${row && row.rating}/${row && row.stars})`);
  ok(row && row.power === 74 && row.games === 2 && row.wins === 2 &&
     row.streak === 2 && row.bestStreak === 2,
    `power 74, 2 games, TWO wins (2nd of 3 counts), streak 2 ride the same transaction`);
  ok(row && row.chars && row.chars.duchess && row.chars.duchess.g === 2
     && row.chars.duchess.r === 1279,
    `the Duchess ledger rode both games to the same 1279 (${row && row.chars && JSON.stringify(row.chars.duchess)})`);
  ok(row && row.avatar === 'knight', 'the crest rides the game post too');

  // 3 · All-Time: medals on the podium, crest discs, your row glows.
  await page.evaluate(() => FLB.openLeaderboard('alltime'));
  await sleep(700);
  const at = await page.evaluate((u) => {
    const rows = [...document.querySelectorAll('.lb-row')];
    const mine = rows.find(r => r.classList.contains('me'));
    return {
      medals: document.querySelectorAll('.lb-medal.m1, .lb-medal.m2, .lb-medal.m3').length,
      discs: rows.every(r => r.querySelector('.av-disc')),
      me: !!mine, you: mine ? /You/.test(mine.textContent) : false,
      sub: mine ? /W · \d+ G/.test(mine.textContent) : false,
      scale: mine ? /✦ \d\.\d\d/.test(mine.textContent) : false,
    };
  }, AUDIT_UID);
  ok(at.medals === 3, `top three wear medals (${at.medals})`);
  ok(at.discs, 'every row wears a crest disc');
  ok(at.me && at.you, 'YOUR row is highlighted and tagged You');
  ok(!at.sub && at.scale, 'rows carry a 1.00–7.00 rating and NO win/game counters (Wyatt 7/17)');
  await page.screenshot({ path: join(SHOTS, 'lb-alltime.png') });

  // 4 · Power is RETIRED; the ten character boards take its place.
  const noPower = await page.evaluate(() =>
    ![...document.querySelectorAll('.lb-tab')].some(t => /power/i.test(t.textContent)));
  ok(noPower, 'the Power tab is gone from the tab row');
  await page.evaluate(() => FLB.openLeaderboard('char:duchess'));
  await sleep(700);
  const cb = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.lb-row')];
    const mine = rows.find(r => r.classList.contains('me'));
    return {
      chips: document.querySelectorAll('.lb-chartab').length,
      lit: !!document.querySelector('.lb-chartab.on'),
      me: !!mine,
      myScore: mine ? mine.querySelector('.lb-score').textContent : '',
    };
  });
  ok(cb.chips === 11 && cb.lit, `hero rail chips ride the panel (10 + All Heroes), the open one lit (${cb.chips})`);
  // 1279 internal renders 1.28 — the same two games the row assertion above
  // works out by hand under the ladder.
  ok(cb.me && /✦ 1\.28/.test(cb.myScore),
    `the Duchess board carries your Duchess rating 1.28 (${cb.myScore.trim()})`);
  await page.screenshot({ path: join(SHOTS, 'lb-characters.png') });

  // 5 · Daily keeps the best single game, now with crests.
  await page.evaluate(() => FLB.openLeaderboard('daily'));
  await sleep(700);
  const daily = await page.evaluate(() => {
    const mine = [...document.querySelectorAll('.lb-row')].find(r => r.classList.contains('me'));
    return mine ? mine.textContent : '';
  });
  ok(/80/.test(daily), `daily carries your best single-game Favor (80)`);

  // 5b · Rating + Top Scores (Wyatt 7/18). The All-Time board always sorted
  // by rating — only the LABEL was wrong. Top Scores flattens every past
  // daily window, so it is an all-time high table with no new write path.
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('.lb-tab')].map(t => t.textContent.trim()));
  ok(tabs.length === 3 && tabs[0] === 'Rating' && tabs[2] === 'Top Scores',
    `three text tabs: ${tabs.join(' / ')}`);
  ok(!tabs.some(t => /all.?time/i.test(t)), 'the All-Time label is retired for Rating');

  await page.evaluate(() => FLB.openLeaderboard('topscores'));
  await sleep(900);
  const top = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.lb-row')];
    const scores = rows.map(r => parseInt((r.querySelector('.lb-score') || {}).textContent || '0', 10));
    return {
      rows: rows.length,
      descending: scores.every((s, i) => i === 0 || scores[i - 1] >= s),
      favorIcon: rows.length > 0 && !!rows[0].querySelector('.lb-score .lb-ico'),
      noRating: !rows.some(r => /✦/.test(r.textContent)),
      railLit: !!document.querySelector('.lb-chartab.all.on'),
      tabLit: (document.querySelector('.lb-tab.on') || {}).dataset
        ? document.querySelector('.lb-tab.on').dataset.tab : '',
      capped: rows.length <= 21,   // 20 + your own appendix row
    };
  });
  ok(top.rows >= 1 && top.descending, `Top Scores ranks single-game highs descending (${top.rows} rows)`);
  ok(top.favorIcon && top.noRating, 'Top Scores rows carry a Favor score, not a rating');
  ok(top.capped, `the board is a TOP TWENTY (${top.rows} rows incl. any appendix)`);
  ok(top.tabLit === 'topscores', 'the Top Scores tab lights when open');

  // ⚠ The one line that silently breaks: overallOn in renderCharTabs. A new
  // tab key that misses it mis-lights the "All Heroes" rail chip.
  const rail = [];
  for (const t of ['alltime', 'daily', 'topscores']) {
    await page.evaluate((x) => FLB.openLeaderboard(x), t);
    await sleep(500);
    rail.push(await page.evaluate(() => !!document.querySelector('.lb-chartab.all.on')));
  }
  ok(rail.every(Boolean), `the All Heroes rail chip lights on all three overall tabs (${rail.join(',')})`);
  await page.screenshot({ path: join(SHOTS, 'lb-topscores.png') });
  await page.evaluate(() => FLB.closeLeaderboard());

  // 6 · The crest is home in-game: the board thumb's plate carries your
  // crest + royal name (never the stats panel — its no-scroll fit is law).
  await startGame(page);
  const ident = await page.evaluate(() => {
    const plate = document.querySelector('#boardThumb .thumb-name');
    const img = plate && plate.querySelector('.av-disc:not(.av-empty) img');
    const panel = document.getElementById('statsPanel');
    return {
      there: !!plate,
      knight: img ? /knight/i.test(img.src) : false,
      name: plate ? plate.textContent.trim() : '',
      panelFits: panel ? panel.scrollHeight <= panel.clientHeight + 1 : false,
    };
  });
  ok(ident.there && ident.knight && /Audit Herald/.test(ident.name),
    `your crest + royal name ride the board plate (${ident.name})`);
  ok(ident.panelFits, 'stats panel keeps its no-scroll fit');

  // Leave no trace — player row, this window's daily rows, and the
  // shared-profile crest keys (localStorage outlives this flow).
  const scrub2 = await page.evaluate(async (u) => {
    localStorage.removeItem('favorAvatar');
    localStorage.removeItem('__crestFlowSeeded');
    for (let i = 0; i < 6; i++) {
      await firebase.database().ref(`favor/players/${u}`).remove();
      const days = await firebase.database().ref('favor/daily').get().then(s => s.val() || {});
      for (const k of Object.keys(days)) {
        await firebase.database().ref(`favor/daily/${k}/scores/${u}`).remove();
      }
      await new Promise(r => setTimeout(r, 400));
      const p = await firebase.database().ref(`favor/players/${u}`).get();
      if (!p.exists()) return 'clean';
    }
    return 'RESIDUE';
  }, AUDIT_UID);
  ok(scrub2 === 'clean', `crest audit player scrubbed from favor/* (${scrub2})`);
  const ashPowerAfter = await page.evaluate(() =>
    firebase.database().ref('favor/players/persona_ashcroft/power').get().then(s => s.val()));
  ok(ashPowerAfter === ashPowerBefore,
    `REAL persona power untouched (${ashPowerAfter}, was ${ashPowerBefore})`);
  await page.close();
}

// ═══ MISSION CEREMONY: player-by-player beats, honest payout chips ═══
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('ceremony: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);

  // Rig: AI p1 completes King of the Sky holding 2 stones (per-asset favor
  // must show the REAL payout), AI p2 fails Defending the Kingdom (+10
  // Scorn penalty chip). Human holds nothing — emblemHolder 0 makes the
  // beat order deterministic: p1 first, p2 second. dueAct pinned to 1 so
  // both resolve in the rigged act.
  await page.evaluate(() => {
    const ai1 = game.players[1], ai2 = game.players[2];
    game.players[0].missions = [];
    ai1.philosopherStone = 2;
    ai1.skills.survival = 4; ai1.skills.power = 12;
    ai1.missions = [{ ...window.FAVOR_DATA.missions.find(m => m.name === 'King of the Sky'), activationRound: 1, dueAct: 1 }];
    ai2.missions = [{ ...window.FAVOR_DATA.missions.find(m => m.name === 'Defending the Kingdom'), activationRound: 1, dueAct: 1 }];
    endActPhases();
  });
  await page.waitForFunction(() => document.getElementById('missionCeremony').classList.contains('active'), { timeout: 8000 });
  await sleep(450);   // beat 1 on stage, verdict still sealed (past the §4 tap guard)

  const beat1 = await page.evaluate(() => ({
    name: document.querySelector('.mc-pname').textContent,
    card: document.querySelector('.mc-card').alt,
    stamped: document.querySelector('.mc-stage').classList.contains('stamped'),
  }));
  ok(beat1.card === 'King of the Sky' && !beat1.stamped,
    `beat 1: ${beat1.name} attempts King of the Sky, verdict unrevealed`);

  await page.evaluate(() => document.getElementById('missionCeremony').click());   // reveal
  await sleep(500);
  const verdict1 = await page.evaluate(() => ({
    stamp: document.querySelector('.mc-stamp').textContent,
    fail: document.querySelector('.mc-stage').classList.contains('fail'),
    chips: [...document.querySelectorAll('.mc-chip')].map(c => c.textContent.trim()),
  }));
  ok(verdict1.stamp === 'Complete' && !verdict1.fail, `tap reveals the verdict (${verdict1.stamp})`);
  ok(verdict1.chips.some(t => /\+20 Favor/.test(t)),
    `payout chip shows the real per-stone favor (${verdict1.chips.join(' · ')})`);
  await page.screenshot({ path: join(SHOTS, 'mission-ceremony-complete.png') });

  await page.evaluate(() => document.getElementById('missionCeremony').click());   // next beat
  await sleep(500);
  const beat2 = await page.evaluate(() => ({
    card: document.querySelector('.mc-card').alt,
    stamped: document.querySelector('.mc-stage').classList.contains('stamped'),
  }));
  ok(beat2.card === 'Defending the Kingdom' && !beat2.stamped,
    'second tap advances to the next player\'s mission');

  await page.evaluate(() => document.getElementById('missionCeremony').click());   // reveal the failure
  await sleep(500);
  const verdict2 = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.mc-chip')];
    const lead = chips[0];
    return {
      stamp: document.querySelector('.mc-stamp').textContent,
      fail: document.querySelector('.mc-stage').classList.contains('fail'),
      chips: chips.map(c => c.textContent.trim()),
      leadText: lead ? lead.textContent.trim() : '(none)',
      leadBig: !!lead && lead.classList.contains('big') && lead.classList.contains('bad'),
      leadPx: lead ? parseFloat(getComputedStyle(lead).fontSize) : 0,
    };
  });
  ok(verdict2.stamp === 'Failed' && verdict2.fail, `failure beat stamps FAILED (${verdict2.stamp})`);
  ok(verdict2.chips.some(t => /\+10 Scorn/.test(t)),
    `penalty chip shows +10 Scorn (${verdict2.chips.join(' · ')})`);
  // Wyatt: a failure's cost has to LAND, not read as one chip among many.
  ok(verdict2.leadBig && /\+10 Scorn/.test(verdict2.leadText),
    `the CONSEQUENCE leads the list at headline size ("${verdict2.leadText}")`);
  ok(verdict2.leadPx >= 20, `headline chip is genuinely bigger (${verdict2.leadPx}px vs 14.5px base)`);
  await page.screenshot({ path: join(SHOTS, 'mission-ceremony-failed.png') });

  await page.evaluate(() => document.getElementById('missionCeremony').click());   // past the last beat
  await page.waitForFunction(() => !document.getElementById('missionCeremony').classList.contains('active'), { timeout: 6000 });
  await page.waitForFunction(() => document.getElementById('meleeSplash').classList.contains('active'), { timeout: 20000 });
  ok(true, 'ceremony closes and the act flows on into the Melee');
  await page.evaluate(() => document.getElementById('meleeSplash').click());
  await page.close();

  // Phone: one stamped beat fits 844×390 with chips readable.
  const phone = await browser.newPage();
  phone.on('console', m => { if (m.type() === 'error') consoleErrors.push('ceremony-phone: ' + m.text()); });
  await phone.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(phone);
  await phone.evaluate(() => {
    const ai1 = game.players[1];
    game.players[0].missions = [];
    ai1.philosopherStone = 2;
    ai1.skills.survival = 4; ai1.skills.power = 12;
    ai1.missions = [{ ...window.FAVOR_DATA.missions.find(m => m.name === 'King of the Sky'), activationRound: 1, dueAct: 1 }];
    game.players[2].missions = [];
    endActPhases();
  });
  await phone.waitForFunction(() => document.getElementById('missionCeremony').classList.contains('active'), { timeout: 8000 });
  await sleep(450);   // past the inherited-tap guard (§4) — no human taps at +0ms
  await phone.evaluate(() => document.getElementById('missionCeremony').click());
  await sleep(500);
  const pfitc = await phone.evaluate(() => {
    const card = document.querySelector('.mc-card').getBoundingClientRect();
    const chips = [...document.querySelectorAll('.mc-chip')].map(c => c.getBoundingClientRect());
    return {
      cardIn: card.top >= 0 && card.bottom <= window.innerHeight + 1,
      chipsIn: chips.length > 0 && chips.every(r => r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1),
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  ok(pfitc.cardIn && pfitc.chipsIn && !pfitc.hscroll,
    `phone ceremony fits 844×390 (card ${pfitc.cardIn}, chips ${pfitc.chipsIn}, hscroll ${pfitc.hscroll})`);
  await phone.screenshot({ path: join(SHOTS, 'mission-ceremony-phone.png') });
  await phone.close();
}

// ═══ A CARD'S GOLD COST GATES PLAY ═══════════════════════════════════
// checkRequirements never looked at card.cost, so the Play button lit up, the
// engine refused with success:false (which no caller checked), and the card
// evaporated — no play, no discard, no refund.
// Re-rigged 7/13 PM: this used to be driven with Mind Warper, but the art audit
// found Mind Warper never had a gold cost — its `cost: 6` was the count badge
// off its 6-Alchemy REQUIREMENT. The gate is now proven on Father's Lab, which
// really does print a 3-gold coin, and Mind Warper gets its own free-play check
// below (that phantom cost, not the silent bail, was Wyatt's actual bug).
{
  console.log('── Gold cost gates the Play button (Father\'s Lab — a REAL 3-gold coin)');
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('cost-gate: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);

  // Father's Lab has no skill requirement — so the ONLY gap is the purse.
  // The chooser probe: showCardChoice renders the same buttons the reveal
  // shows; answering Discard just resolves the promise (nothing applies),
  // so the probe leaves the engine untouched.
  const short = await page.evaluate(async () => {
    const p = game.players[0];
    p.gold = 2;                                    // the card costs 3
    p.hand = [{ ...window.FAVOR_DATA.cards.find(c => c.name === "Father's Lab") }];
    renderGameState();
    const card = p.hand[0];
    game.pickCard(0, 0);
    showCardChoice(card, 0);
    await new Promise(r => setTimeout(r, 80));
    const btn = [...document.querySelectorAll('#actionPanel .action-btn')]
      .find(b => /Play|Need/.test(b.textContent));
    const chk = game.checkRequirements(0, card);
    const out = {
      text: btn ? btn.textContent.trim() : '(no button)',
      disabled: btn ? btn.disabled : false,
      canPlay: chk.canPlay,
      borrowOffered: [...document.querySelectorAll('#actionPanel .action-btn')]
        .some(b => /Borrow/.test(b.textContent)),
    };
    document.querySelector('#actionPanel [data-act="discard"]').click();
    game.unpickCard(0);   // restore the rig hand for the rich beat
    return out;
  });
  ok(short.canPlay === false, 'engine: canPlay is FALSE one gold short of the cost');
  ok(short.disabled && /Need/.test(short.text) && /3 Gold/.test(short.text),
    `Play is disabled and NAMES the gap: "${short.text}"`);
  ok(!short.borrowOffered, 'and Borrow is not offered — you cannot borrow your way out of being broke');
  await page.screenshot({ path: join(SHOTS, 'cost-gate-short.png') });

  // One more gold: the same card is playable, and it actually grants.
  const rich = await page.evaluate(async () => {
    const p = game.players[0];
    p.gold = 3;
    renderGameState();
    const card = p.hand[0];
    game.pickCard(0, 0);
    showCardChoice(card, 0);
    await new Promise(r => setTimeout(r, 80));
    const btn = [...document.querySelectorAll('#actionPanel .action-btn')]
      .find(b => /Play/.test(b.textContent) && !/Need/.test(b.textContent));
    const enabled = !!btn && !btn.disabled;
    document.querySelector('#actionPanel [data-act="discard"]').click();
    const res = game.activateCard(0, card.id, 'play');
    return { enabled, text: btn ? btn.textContent.trim() : '', ok: res.success,
             gold: p.gold, alchemy: p.skills.alchemy || 0 };
  });
  ok(rich.enabled, `at 3 Gold the Play button lives ("${rich.text}")`);
  ok(rich.ok && rich.gold === 0 && rich.alchemy === 3,
    `and Father's Lab pays its 3 Gold for 3 Alchemy (gold ${rich.gold}, alchemy ${rich.alchemy})`);
  await page.close();
}

// ═══ MIND WARPER PLAYS FOR FREE — the REAL fix for Wyatt's report ═══════
// "Mind Warper didn't turn my Scorn into Prestige." It was blamed on the silent
// cost bail, but the deeper cause is that the printed card has NO gold coin at
// all. With the phantom cost gone it simply works, at zero gold.
{
  console.log('── Mind Warper converts Scorn at ZERO gold (phantom cost removed)');
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('mind-warper: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);

  const r = await page.evaluate(async () => {
    const p = game.players[0];
    p.bonusSkills = { alchemy: 6 };
    game.applySlotSkills(p);
    p.philosopherStone = 1;
    p.scorn = 10;
    p.gold = 0;                                    // broke — and it must not matter
    const mw = window.FAVOR_DATA.cards.find(c => c.name === 'Mind Warper');
    p.hand = [{ ...mw }];
    renderGameState();
    const card = p.hand[0];
    const canPlay = game.checkRequirements(0, card).canPlay;
    game.pickCard(0, 0);
    showCardChoice(card, 0);
    await new Promise(r => setTimeout(r, 80));
    const btn = [...document.querySelectorAll('#actionPanel .action-btn')]
      .find(b => /Play|Need/.test(b.textContent));
    document.querySelector('#actionPanel [data-act="discard"]').click();
    const res = game.activateCard(0, card.id, 'play');
    return { cost: mw.cost || 0, canPlay, text: btn ? btn.textContent.trim() : '',
             ok: res.success, scorn: p.scorn, prestige: p.prestige, gold: p.gold };
  });
  ok(!r.cost, `Mind Warper carries no gold cost (cost=${r.cost})`);
  ok(r.canPlay === true, `playable at 0 gold — Play reads "${r.text}"`);
  ok(r.ok && r.scorn === 0 && r.prestige === 10,
    `and it converts: 10 Scorn → ${r.prestige} Prestige (scorn ${r.scorn})`);
  ok(r.gold === 0, 'and no gold was taken');
  await page.close();
}

// ═══ MIDNIGHT CRASH DEALS THE TABLE A MISSION — and now you SEE it ═══
// Its failure hands every player an Act 3 mission. The engine did that in total
// silence: the card appeared in your hand, and only the log knew.
{
  console.log('── The Midnight Crash deals a mission — and the player is shown it');
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('draw-beat: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);

  await page.evaluate(() => {
    game.players.forEach(pl => { pl.missions = []; });
    const p = game.players[0];
    p.favor = 0;                                   // needs 4 Favor & 3 Alchemy → fails
    p.bonusSkills = {};
    game.applySlotSkills(p);
    p.skills.alchemy = 0;
    p.missions = [{ ...window.FAVOR_DATA.missions.find(m => m.name === 'The Midnight Crash'),
                    activationRound: 1, dueAct: 1 }];
    endActPhases();
  });
  // The ceremony narrates the failure first…
  await page.waitForFunction(() => document.getElementById('missionCeremony').classList.contains('active'), { timeout: 8000 });
  await sleep(450);   // past the inherited-tap guard (§4) — no human taps at +0ms
  await page.evaluate(() => document.getElementById('missionCeremony').click());   // reveal the verdict
  await sleep(450);
  await page.evaluate(() => document.getElementById('missionCeremony').click());   // …then past it, into the deal
  await sleep(900);

  const beat = await page.evaluate(() => {
    const el = document.getElementById('missionCeremony');
    const act = el.querySelector('.ms-act');
    const banner = el.querySelector('.ms-banner');
    const card = el.querySelector('.mc-card');
    const pc = el.querySelector('.mc-pcount');
    return {
      active: el.classList.contains('active'),
      act: act ? act.textContent.trim() : '',
      banner: banner ? banner.textContent.trim() : '',
      card: card ? card.alt : '',
      cardIn: card ? (card.getBoundingClientRect().height > 180) : false,
      pcount: pc ? pc.textContent.trim() : '',
      myMissions: game.players[0].missions.map(m => m.name),
      everyoneGotOne: game.players.every(p => p.missions.length > 0),
    };
  });
  ok(beat.active && /All Players Draw/i.test(beat.act), `the deal gets its own beat ("${beat.act}")`);
  ok(/Midnight Crash/i.test(beat.banner), `the banner names what caused it ("${beat.banner}")`);
  ok(beat.card && beat.myMissions.includes(beat.card), `it shows YOUR new mission (${beat.card})`);
  ok(beat.cardIn, 'the card is big enough to actually read');
  ok(/new mission/i.test(beat.pcount), `and says whose it is ("${beat.pcount}")`);
  ok(beat.everyoneGotOne, 'every player really was dealt one');
  await page.screenshot({ path: join(SHOTS, 'mission-draw-beat.png') });
  await page.close();
}

// ═══ THE MAGICIAN'S PICK ONE — the player chooses (was a silent auto-take) ═══
// The board reads "Pick One". It used to take whichever skill you had least of,
// without asking — and the grant didn't even survive the next skill recalc.
{
  console.log("── Magician's Pick One: the player chooses, and the grant sticks");
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('slotpick: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);

  await page.evaluate(() => {
    const p = game.players[0];
    p.character = window.FAVOR_DATA.characters.find(c => c.id === 'magician');
    const slot = p.character.slots.findIndex(s => s.special === 'pick_one');
    p.sliderPosition = slot - 1;          // one step short of it
    p.gold = 40;
    p._paidSlideDir = null;
    p.bonusSkills = {};
    game.applySlotSkills(p);
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
    document.querySelectorAll('.game-toast').forEach(t => t.remove());
  });
  // Paid slides answer at YOUR reveal now — reach it, then slide onto the slot.
  await throwAndAwaitChoice(page, 0);
  await page.evaluate(() => {
    payToSlide(1);                        // NOT awaited — it blocks on the picker
  });
  await sleep(700);

  const pick = await page.evaluate(() => {
    const ov = document.getElementById('promisePicker');
    const tiles = [...ov.querySelectorAll('.pp-skill')];
    return {
      active: ov.classList.contains('active'),
      title: (ov.querySelector('.pp-title') || {}).textContent || '',
      options: tiles.map(e => e.dataset.s),
      iconsLoaded: tiles.every(e => { const i = e.querySelector('img'); return i && i.complete && i.naturalWidth > 0; }),
      inView: tiles.every(e => { const r = e.getBoundingClientRect();
        return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; }),
      grantedYet: JSON.stringify(game.players[0].bonusSkills || {}),
    };
  });
  ok(pick.active && /Pick One/i.test(pick.title), `the picker takes the stage ("${pick.title}")`);
  ok(pick.options.length === 4, `all four board options offered (${pick.options.join(', ')})`);
  ok(pick.iconsLoaded, 'each option wears its real skill icon');
  ok(pick.inView, 'every tile is on-screen and tappable');
  ok(pick.grantedYet === '{}', 'NOTHING is granted until you choose (the old auto-take is gone)');
  await page.screenshot({ path: join(SHOTS, 'slot-pick-one.png') });

  // Choose CHARISMA — deliberately NOT the weakest, so an auto-picker would have
  // taken something else. This is what proves the choice is actually yours.
  const after = await page.evaluate(async () => {
    const aiWouldTake = game.aiSlotPick(0);
    [...document.querySelectorAll('.pp-skill')].find(e => e.dataset.s === 'charisma').click();
    const btn = document.getElementById('slotPickConfirm');
    const label = btn.textContent.trim();
    btn.click();
    await new Promise(r => setTimeout(r, 80));
    const p = game.players[0];
    const chaAfterPick = p.skills.charisma || 0;
    game.applySlotSkills(p);              // THE recalc that used to erase the grant
    return {
      aiWouldTake,
      label,
      closed: !document.getElementById('promisePicker').classList.contains('active'),
      bonus: p.bonusSkills.charisma || 0,
      cha: p.skills.charisma || 0,
      survives: (p.skills.charisma || 0) === chaAfterPick && chaAfterPick >= 1,
      pending: !!p._pendingSlotPick,
    };
  });
  ok(/Take \+1 Charisma/i.test(after.label), `the button names the pick ("${after.label}")`);
  ok(after.closed, 'confirming closes the picker');
  ok(after.bonus === 1 && after.cha >= 1, `Charisma granted (bonusSkills ${after.bonus}, total ${after.cha})`);
  ok(after.aiWouldTake !== 'charisma',
    `and it is genuinely YOUR pick — the old auto-take would have grabbed '${after.aiWouldTake}'`);
  ok(after.survives, `the grant SURVIVES applySlotSkills (charisma ${after.cha}) — it never used to`);
  ok(!after.pending, 'the pause flag is cleared');

  // ── MULTIPLAYER: the pick must STREAM, or two clients' engines diverge the
  // moment a Magician lands here. Stub the wire and prove the publish fires with
  // the chosen skill. (mpPub reads window.FMP live, so stubbing it is enough.)
  const streamed = await page.evaluate(async () => {
    const p = game.players[0];
    const slot = p.character.slots.findIndex(s => s.special === 'pick_one');
    p.sliderPosition = slot;                  // stand on it; the picker reads the slot
    p.bonusSkills = {};
    p._pendingSlotPick = null;
    game.applySlotSkills(p);

    const sent = [];
    const realFMP = window.FMP;
    window.FMP = { active: () => true, publish: (type, data) => { sent.push({ type, data }); } };

    const done = showSlotSkillPicker();
    await new Promise(r => setTimeout(r, 60));
    [...document.querySelectorAll('.pp-skill')].find(e => e.dataset.s === 'alchemy').click();
    document.getElementById('slotPickConfirm').click();
    await done;

    window.FMP = realFMP;
    return { sent, alchemy: p.bonusSkills.alchemy || 0 };
  });
  ok(streamed.sent.length === 1 && streamed.sent[0].type === 'slot_pick',
    `the pick publishes a 'slot_pick' move (${JSON.stringify(streamed.sent.map(s => s.type))})`);
  ok(streamed.sent[0] && streamed.sent[0].data && streamed.sent[0].data.skill === 'alchemy',
    `the streamed move carries the chosen skill (${streamed.sent[0] && streamed.sent[0].data.skill})`);
  ok(streamed.alchemy === 1, 'and the same engine call applies it locally');

  // The receiving end: a remote seat awaits that move in stream order, and a
  // booted seat falls back to the deterministic AI pick every client computes.
  ok(await page.evaluate(() =>
    /waitFor\(cs, 'slot_pick'\)/.test(String(mpActivateRemote)) &&
    /aiSlotPick/.test(String(mpActivateRemote)) &&
    /applySlotPick/.test(String(mpActivateRemote))),
    "a remote seat awaits 'slot_pick' from the stream, with the AI fallback on boot");
  await page.close();
}

// ═══ CHEMICAL X — "move to ANY slot" is the PLAYER's choice ══════════════════
// It used to shove the ring to slot 5 (or slot 1 if you were already right)
// without asking. The BOARD is the picker: every circle lights up, the move is
// free, and it is MANDATORY — a stray backdrop tap must not strand the round.
{
  console.log('── Chemical X: the player moves the ring to ANY slot (was auto-shoved)');
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('chemx: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);

  await page.evaluate(() => {
    window.CINEMATIC_SPEED = 0.05;
    const p = game.players[0];
    p.bonusSkills = { alchemy: 3 };              // Chemical X needs 3 Alchemy…
    game.applySlotSkills(p);
    p.gold = 20;                                 // …and 2 Gold
    p.sliderPosition = 2;                        // centre
    p.hand = [{ ...window.FAVOR_DATA.cards.find(c => c.name === 'Chemical X') }];
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
    document.querySelectorAll('.game-toast').forEach(t => t.remove());
  });
  // The REAL path: throw → reveal → Play → the drain opens the board.
  await throwAndAwaitChoice(page, 0);
  await answerChoice(page, /play/);
  await page.waitForFunction(() =>
    document.getElementById('boardOverlay').classList.contains('active'), { timeout: 20000 });
  await sleep(450);

  const board = await page.evaluate(() => {
    const slots = [...document.querySelectorAll('.board-ov-slot')];
    return {
      hint: document.getElementById('boardOvHint').textContent,
      pickable: slots.filter(s => s.classList.contains('pickable')).length,
      pos: game.players[0].sliderPosition,
    };
  });
  ok(/any circle/i.test(board.hint), `the board itself becomes the picker ("${board.hint}")`);
  ok(board.pickable === 4,
    `EVERY other circle is live — not just the neighbours (${board.pickable} of 4)`);
  ok(board.pos === 2, 'and the ring has not moved yet — no more auto-shove');
  await page.screenshot({ path: join(SHOTS, 'chem-x-any-slot.png') });

  // The move is mandatory. An unresolved modal chooser is exactly how a round
  // silently freezes, so closing must be refused while it is pending.
  const guard = await page.evaluate(() => {
    closeBoardOverlay();
    return document.getElementById('boardOverlay').classList.contains('active');
  });
  ok(guard, 'a stray backdrop tap CANNOT close it — the move is mandatory (no silent freeze)');

  // Take slot 1: TWO spaces away (a normal slide could never reach it in one go)
  // and the opposite end from where the auto-pick always went.
  const after = await page.evaluate(async () => {
    const aiWould = game.aiFreeSliderPos(0);
    const goldBefore = game.players[0].gold;
    document.querySelectorAll('.board-ov-slot')[0].click();
    await new Promise(r => setTimeout(r, 450));
    const p = game.players[0];
    return {
      aiWould, goldBefore, pos: p.sliderPosition, gold: p.gold,
      power: p.skills.power || 0,
      closed: !document.getElementById('boardOverlay').classList.contains('active'),
      pending: !!p._pendingSliderMove,
    };
  });
  ok(after.pos === 0, `the ring lands on the slot YOU chose (slot ${after.pos + 1})`);
  ok(after.aiWould !== 0,
    `and it is genuinely your pick — the old auto-shove took slot ${after.aiWould + 1}`);
  ok(after.gold === after.goldBefore, `the move is FREE — no toll (gold ${after.gold})`);
  ok(after.power === 3, `the slot's skills apply immediately (Power ${after.power})`);
  ok(after.closed && !after.pending, 'the board closes and the round moves on');

  // ── MULTIPLAYER: the slot must STREAM, or the two clients' boards diverge the
  // moment Chemical X is played. Stub the wire and prove the publish fires.
  const streamed = await page.evaluate(async () => {
    const p = game.players[0];
    p.sliderPosition = 2;
    p._pendingSliderMove = true;
    const sent = [];
    const realFMP = window.FMP;
    window.FMP = { active: () => true, publish: (type, data) => { sent.push({ type, data }); } };

    const done = showChemXPicker();
    await new Promise(r => setTimeout(r, 350));
    document.querySelectorAll('.board-ov-slot')[4].click();   // Far Right
    await done;

    window.FMP = realFMP;
    return { sent, pos: p.sliderPosition };
  });
  ok(streamed.sent.length === 1 && streamed.sent[0].type === 'slider_move',
    `the move publishes a 'slider_move' (${JSON.stringify(streamed.sent.map(s => s.type))})`);
  ok(streamed.sent[0] && streamed.sent[0].data && streamed.sent[0].data.pos === 4,
    `the streamed move carries the chosen slot (${streamed.sent[0] && streamed.sent[0].data.pos})`);
  ok(streamed.pos === 4, 'and the same engine call lands the ring locally');

  ok(await page.evaluate(() =>
    /waitFor\(cs, 'slider_move'\)/.test(String(mpActivateRemote)) &&
    /aiFreeSliderPos/.test(String(mpActivateRemote)) &&
    /applyFreeSliderMove/.test(String(mpActivateRemote))),
    "a remote seat awaits 'slider_move' from the stream, with the AI fallback on boot");
  await page.close();
}

// ═══ MELEE CINEMATIC (Skylar's system): forge rows → clash → podium ═══
console.log('── Melee cinematic: forge rows, live coin, podium + prestige tokens');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('melee: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('melee pageerror: ' + e.message));
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);

  // A juicy field: power cards, a Fuzzy Head strike, a WON coin — then the
  // cinematic driven exactly as the act flow drives it (fire-and-flag).
  await page.evaluate(() => {
    window.CINEMATIC_SPEED = 0.15;            // paced but audit-fast
    const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    const [p0, p1, p2] = game.players;
    p0.skills.power = 6; p0.playedCards = [pick('Reckless Training'), pick('Fuzzy Head')];
    game.resolveSpecial(0, p0.playedCards[1]);
    p1.skills.power = 6; p1.playedCards = [pick('Shot of Courage')];
    game._rand = () => 0.2;                   // heads
    game.resolveSpecial(1, p1.playedCards[0]);
    p2.skills.power = 2;
    const results = game.resolveMelee();
    window._meleeDone = false;
    showMeleeSplash(results, 1).then(() => { window._meleeDone = true; });
  });
  await page.waitForFunction(() => document.getElementById('meleeSplash').classList.contains('active'), { timeout: 8000 });
  const arena = await page.evaluate(() => ({
    combatants: document.querySelectorAll('.ms-combatant').length,
    rings: document.querySelectorAll('.ms-combatant .ms-ring').length,
    skip: !!document.querySelector('.ms-skip'),
    skipShown: (() => {
      const el = document.querySelector('.ms-skip');
      return !!el && el.getBoundingClientRect().width > 0;
    })(),
  }));
  ok(arena.combatants === 3, `all heirs enter the arena (${arena.combatants})`);
  ok(arena.rings === 3, 'every board wears its slider ring');
  ok(arena.skip && !arena.skipShown,
    'the Skip chip is retired for players (still in the DOM for rigs)');

  // Forge: the first fighter's contributors deal into the card row.
  await page.waitForFunction(() => document.querySelectorAll('.ms-cardrow .ms-rowitem').length >= 1, { timeout: 12000 });
  await page.screenshot({ path: join(SHOTS, 'melee-forge.png') });

  // Skip ▸▸ jumps to the coronation; tokens + crown must be on stage.
  await page.evaluate(() => document.querySelector('.ms-skip').click());
  await sleep(700);
  const podium = await page.evaluate(() => {
    const champ = document.querySelector('.ms-tier.champ');
    return {
      tiers: document.querySelectorAll('.ms-tier.show').length,
      champ: !!champ,
      crown: !!(champ && champ.querySelector('.ms-crown')),
      tokens: document.querySelectorAll('.ms-ptoken').length,
      hint: document.querySelector('.ms-hint').classList.contains('show'),
    };
  });
  ok(podium.tiers >= 2 && podium.champ && podium.crown, 'podium revealed, champion crowned');
  ok(podium.tokens >= 1, 'prestige paid in physical token art');
  ok(podium.hint, 'tap-to-continue hint shows');
  await page.screenshot({ path: join(SHOTS, 'melee-podium.png') });

  // A tap on the result closes it and the awaited promise resolves —
  // that promise is what lets the act advance in the real flow.
  await page.evaluate(() => document.getElementById('meleeSplash').click());
  await page.waitForFunction(() => window._meleeDone === true, { timeout: 6000 });
  const closed = await page.evaluate(() => !document.getElementById('meleeSplash').classList.contains('active'));
  ok(closed, 'tap on the result closes the cinematic (promise resolves)');
  await page.close();

  // Phone: skip straight to the podium — the coronation fits 844×390.
  const phone = await browser.newPage();
  phone.on('console', m => { if (m.type() === 'error') consoleErrors.push('melee-phone: ' + m.text()); });
  await phone.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(phone);
  await phone.evaluate(() => {
    window.CINEMATIC_SPEED = 0.15;
    game.players[0].skills.power = 9; game.players[1].skills.power = 5; game.players[2].skills.power = 2;
    showMeleeSplash(game.resolveMelee(), 1);
  });
  await phone.waitForFunction(() => document.getElementById('meleeSplash').classList.contains('active'), { timeout: 8000 });
  await phone.evaluate(() => document.querySelector('.ms-skip').click());
  await sleep(700);
  const pfitm = await phone.evaluate(() => ({
    champ: !!document.querySelector('.ms-tier.champ.show'),
    hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    onStage: (() => { const r = document.querySelector('.ms-podium').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 2; })(),
  }));
  ok(pfitm.champ && !pfitm.hscroll && pfitm.onStage,
    `phone: coronation fits 844×390 (champ ${pfitm.champ}, hscroll ${pfitm.hscroll}, onStage ${pfitm.onStage})`);
  await phone.screenshot({ path: join(SHOTS, 'melee-phone.png') });
  await phone.close();
}

// ═══ MELEE: tap anywhere advances the forge — except the scroll strip ═══
console.log('── Score sheet: every drill-down sums to its own cell (Wyatt 7/19)');
{
  // "Sum of all breakdown panels === final Favor shown on the scoreboard",
  // and "Character panel value is reconstructable from an itemized log."
  // Before the ledger, a Knowledge-scaling mission paid into the opaque
  // player.favor, surfaced under CHARACTER as "+6 · Favor earned in play
  // (rewards & missions)", and the Missions panel said "No missions completed
  // for Favor" — two panels disagreeing about the same payment.
  const AUDIT_UID = 'uaudit' + Math.random().toString(36).slice(2, 8);
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('sheet: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('sheet pageerror: ' + e.message));
  await page.evaluateOnNewDocument((u) => {
    localStorage.setItem('favorUid', u);
    localStorage.setItem('favorName', 'Audit Ledger');
    localStorage.setItem('favorQueue', '3');
  }, AUDIT_UID);
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);

  // One seat paid from every source at once: a mission that prints NO flat
  // Favor and pays entirely by formula (Golden Fiddle, "2 Favor for Each
  // Charisma"), a flat-value mission, an Adventure, an Artifact, and two
  // cards that pay nothing — one of which (Fortune Teller) Wyatt found
  // sitting in the Artifacts panel while wearing a magenta wisdom frame.
  await page.evaluate(() => {
    const card = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    const mission = (n) => ({ ...FAVOR_DATA.missions.find(m => m.name === n) });
    const p = game.players[0];
    p.bonusSkills = { charisma: 4, knowledge: 3 };
    game.applySlotSkills(p);
    p.playedCards = [card('Generous Donations'), card('Family Ring'),
                     card('Fortune Teller'), card('Forbidden Lab')];
    const gf = mission('Golden Fiddle');
    game.applyMissionRewards(0, gf);
    p.completedMissions.push(gf);
    p.completedMissions.push(mission('Tavern Legend'));
    showScoring();
  });
  await sleep(400);

  const cells = await page.evaluate(() => {
    const g = document.querySelector('.vs-grid');
    const cols = [...g.querySelectorAll('.vsg-head')].length;
    const cs = [...g.querySelectorAll('.vsg-cell')];
    const labels = [...g.querySelectorAll('.vsg-label')].map(l => (l.querySelector('span') || {}).textContent);
    const out = {};
    ['Missions', 'Adventures', 'Artifacts', 'Character'].forEach(L => {
      const ri = labels.indexOf(L);
      out[L] = ri < 0 ? null : parseInt(cs[ri * cols + 0].textContent, 10);
    });
    return out;
  });
  const panelOf = (cat) => page.evaluate((c) => {
    showScoreBreakdown(0, c);
    const ov = document.getElementById('scoreBreakdown');
    const r = {
      rows: [...ov.querySelectorAll('.sb-row')].map(x => ({
        name: (x.querySelector('.sb-name') || {}).textContent || '',
        val: parseInt((x.querySelector('.sb-val') || {}).textContent, 10) || 0,
      })),
      total: parseInt((ov.querySelector('.sb-total') || {}).textContent, 10),
      notes: [...ov.querySelectorAll('.sb-note')].map(n => n.textContent).join(' | '),
    };
    closeScoreBreakdown();
    return r;
  }, cat);

  for (const [label, cat] of [['Missions', 'missions'], ['Adventures', 'adventure'],
                              ['Artifacts', 'artifact'], ['Character', 'character']]) {
    const pan = await panelOf(cat);
    const sum = pan.rows.reduce((n, r) => n + r.val, 0);
    ok(sum === cells[label] && pan.total === cells[label],
      `${label}: its rows sum to its cell (rows ${sum} · panel ${pan.total} · cell ${cells[label]})`);
  }

  const miss = await panelOf('missions');
  ok(miss.rows.some(r => /Golden Fiddle/.test(r.name) && r.val > 0),
    `Golden Fiddle pays a real, non-zero amount under Missions (${miss.rows.map(r => r.name + ' ' + r.val).join(' · ') || 'none'})`);
  ok(miss.rows.some(r => /Golden Fiddle/.test(r.name) && /per Charisma/.test(r.name)),
    'and the row names the formula, so the number is checkable against the card');
  ok(!/No missions completed for Favor/.test(miss.notes),
    'no "No missions completed for Favor" over a game that paid out');

  const arts = await panelOf('artifact');
  ok(arts.rows.every(r => !/Fortune Teller|Forbidden Lab|Marketplace Sales|Mind's Eye/.test(r.name)),
    `the Artifacts panel holds only artifacts (${arts.rows.map(r => r.name).join(', ') || 'empty'})`);
  ok(arts.rows.some(r => /Family Ring/.test(r.name)),
    'and it does hold the one real artifact played');

  const chr = await panelOf('character');
  ok(!/rewards & missions/i.test(chr.rows.map(r => r.name).join(' ')),
    `the Character panel no longer claims mission Favor (${chr.rows.map(r => r.name).join(', ') || 'empty'})`);

  // Shoot the PANEL, not whatever is on top of it. Winning this rig unlocks
  // "The Explorer's Victory", and its .ach-pop celebration covered the whole
  // sheet in the first run of this block — the assertions read the DOM and
  // passed, but the screenshot was of a modal. A shot nobody can read is not
  // evidence.
  await page.evaluate(async () => {
    for (const ov of document.querySelectorAll('.ach-pop')) {
      const b = ov.querySelector('.ach-ok');
      if (b) b.click();
    }
    await new Promise(r => setTimeout(r, 400));
    showScoreBreakdown(0, 'missions');
  });
  await sleep(300);
  await page.screenshot({ path: join(SHOTS, 'score-sheet-ledger.png') });
  await page.evaluate(() => { closeScoreBreakdown(); });
  await page.close();
}

console.log('── Melee taps: every frame is live, a tap hurries the beat, none of it skips');
{
  // Own page at a SLOWER speed than the flow above: production passes
  // forgeHoldMs 3600 (js/ui.js), so at CINEMATIC_SPEED 0.15 the unattended
  // fallback is ~540 ms and would race the taps we are trying to observe.
  // 0.5 leaves ~1.8 s per beat. (The old comment here claimed 15000 × speed
  // and "a 7.5 s window" — that is melee.js's DEFAULT, not what ui.js
  // passes, so this block has been racing a 1.8 s window while asserting it
  // had 7.5.)
  //
  // Phone viewport on purpose — .ms-cardrow is a wide band across the bottom
  // of the stage, which is where the dead zone lived. LANDSCAPE 844×390, not
  // portrait: FAVOR gates portrait behind a "Turn Your Device" screen, and
  // the first cut of this block ran the whole melee behind that gate. It
  // passed anyway, because #meleeSplash is a body-level z-10600 sibling and
  // page.evaluate(el.click()) bypasses hit-testing — the exact way an
  // occlusion bug sails through every assertion and only shows in the
  // screenshot. Landscape is how the game is actually held.
  const meleePage = async () => {
    const p = await browser.newPage();
    p.on('console', m => { if (m.type() === 'error') consoleErrors.push('melee-tap: ' + m.text()); });
    p.on('pageerror', e => consoleErrors.push('melee-tap pageerror: ' + e.message));
    await p.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await startGame(p);
    await p.evaluate(() => {
      window.CINEMATIC_SPEED = 0.5;
      const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
      const [p0, p1, p2] = game.players;
      p0.skills.power = 6; p0.playedCards = [pick('Reckless Training')];
      p1.skills.power = 4; p1.playedCards = [pick('Shot of Courage')];
      p2.skills.power = 2;
      // Stamp when the first Continue paints — that is the end of the
      // opening stretch, the 6.5 s of inert screen Wyatt was tapping at.
      window._tContinue = 0;
      const t0 = performance.now();
      new MutationObserver(() => {
        if (!window._tContinue && document.querySelector('.ms-continue')) {
          window._tContinue = performance.now() - t0;
        }
      }).observe(document.getElementById('meleeSplash'), { childList: true, subtree: true });
      showMeleeSplash(game.resolveMelee(), 1);
    });
    return p;
  };
  const tContinue = (p) => p.waitForFunction(() => window._tContinue > 0, { timeout: 20000 })
    .then(() => p.evaluate(() => window._tContinue));

  // 1 · THE HEADLINE: taps during the opening — before any Continue exists —
  // shorten it. This is the regression that matters: advanceTap is armed only
  // inside waitContinue(), so before 7/19 every one of these taps was a
  // silent no-op and this stretch was dead screen.
  const ctrl = await meleePage();
  const ctrlMs = await tContinue(ctrl);
  await ctrl.close();

  const fast = await meleePage();
  for (let i = 0; i < 14; i++) {
    await fast.evaluate(() => document.getElementById('meleeSplash').click());
    await sleep(70);
  }
  const fastMs = await tContinue(fast);
  ok(fastMs < ctrlMs,
    `tapping the opening hurries it — no dead zone before Continue (${Math.round(fastMs)}ms tapped vs ${Math.round(ctrlMs)}ms idle)`);
  ok(fastMs > ctrlMs * 0.3,
    `and it EXPEDITES rather than skipping — the beats still play (${Math.round(fastMs)}ms is not instant)`);

  // 2 · Mashing never jumps to the podium. "Expedite should be slight."
  for (let i = 0; i < 20; i++) {
    await fast.evaluate(() => document.getElementById('meleeSplash').click());
    await sleep(35);
  }
  const jumped = await fast.evaluate(() => document.querySelectorAll('.ms-tier.show').length);
  ok(jumped === 0, `20 rapid taps do not skip to the result (${jumped} tiers shown)`);
  await fast.screenshot({ path: join(SHOTS, 'melee-tap-anywhere.png') });
  await fast.close();

  // 3 · The card row: a PRESS advances, a SWIPE still only scrolls.
  // This inverts the old assertion on purpose. Blanket-ignoring .ms-cardrow
  // made a 126px full-width band inert, and the band moves as the row fills
  // — the same gesture worked or didn't 12px apart (Wyatt 7/19,
  // "inconsistent and feels broken").
  const rowPage = await meleePage();
  // The stage must actually be on screen, not behind the rotation gate —
  // this is the guard that would have caught the portrait mistake.
  ok(await rowPage.evaluate(() => {
    const s = document.getElementById('meleeSplash');
    const r = s && s.getBoundingClientRect();
    return !!r && r.width > 300 && r.height > 200
      && document.elementFromPoint(r.width / 2, 40) !== null;
  }), 'the melee stage is on screen and hit-testable at this viewport');
  await rowPage.waitForFunction(() => !!document.querySelector('.ms-continue')
    && !!document.querySelector('.ms-cardrow'), { timeout: 20000 });
  const rowIsScroller = await rowPage.evaluate(() =>
    getComputedStyle(document.querySelector('.ms-cardrow')).overflowX === 'auto');
  ok(rowIsScroller, '.ms-cardrow is still a horizontal scroller');

  await rowPage.evaluate(() => document.querySelector('.ms-cardrow').click());
  const rowAdvanced = await rowPage.waitForFunction(() => !document.querySelector('.ms-continue'), { timeout: 4000 })
    .then(() => true).catch(() => false);
  ok(rowAdvanced, 'a PRESS on .ms-cardrow advances like anywhere else');

  // A real drag: pointer events fire, the handler sees >8px of travel and
  // swallows the click that a swipe emits on release.
  await rowPage.waitForFunction(() => !!document.querySelector('.ms-continue')
    && !!document.querySelector('.ms-cardrow'), { timeout: 20000 });
  const box = await rowPage.evaluate(() => {
    const r = document.querySelector('.ms-cardrow').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await rowPage.touchscreen.touchStart(box.x, box.y);
  await rowPage.touchscreen.touchMove(box.x - 60, box.y);
  await rowPage.touchscreen.touchEnd();
  await sleep(500);
  const heldOnSwipe = await rowPage.evaluate(() => !!document.querySelector('.ms-continue'));
  ok(heldOnSwipe, 'but a SWIPE across it does not — scroll-to-read stays safe');

  // 4 · Continue still works, and a double-tap cannot skip a fighter:
  // waitContinue nulls advanceTap before it resolves.
  await rowPage.evaluate(() => {
    const b = document.querySelector('.ms-continue');
    if (b) { b.click(); b.click(); }
  });
  await sleep(600);
  const oneStep = await rowPage.evaluate(() => ({
    fighters: document.querySelectorAll('.ms-tuck').length,
    combatants: document.querySelectorAll('.ms-combatant').length,
  }));
  ok(oneStep.fighters <= oneStep.combatants,
    `a double-tap advances one fighter, never two (${oneStep.fighters} tucked of ${oneStep.combatants})`);
  await rowPage.close();
}

// ═══ ARCHEUS: the victim is ASKED, and the table is TOLD ═══
// Wyatt 7/18: "Arceus got played by another player, and then I never had to
// discard a card. I should have had to discard a weapon card, but it never
// even told me." Both halves — no prompt, and no visible feed entry.
console.log('── Archeus: a human victim picks their weapon; every loss reaches the feed');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('archeus: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('archeus pageerror: ' + e.message));
  await page.setViewport({ width: 1420, height: 860 });
  await startGame(page);

  // A rival plays Archeus. You hold two weapons; an AI holds one.
  await page.evaluate(() => {
    const w = (n, id) => ({ ...FAVOR_DATA.cards.find(c => c.name === n), id });
    game.players[0].playedCards = [w('Enchanted Flames', 'z1'), w('Shark Tooth', 'z2')];
    game.players[1].playedCards = [w('Tombstone', 'z3')];
    game.phase = 'gameplay';
    game.resolveSpecial(2, { ...FAVOR_DATA.cards.find(c => c.name === 'Archeus'), id: 'zarch' });
    window._archeusDone = false;
    drainWeaponDiscards().then(() => { window._archeusDone = true; });
  });
  const asked = await page.waitForFunction(() =>
    document.getElementById('promisePicker').classList.contains('active')
    && /Archeus/i.test(document.getElementById('promisePicker').textContent),
    { timeout: 8000 }).then(() => true).catch(() => false);
  ok(asked, 'playing Archeus PROMPTS the human victim instead of taking a weapon silently');

  const picker = await page.evaluate(() => ({
    cards: document.querySelectorAll('#promisePicker .pp-card').length,
    sub: (document.querySelector('#promisePicker .pp-sub') || {}).textContent || '',
    confirmOff: !!document.querySelector('#promisePicker #ppConfirm[disabled]'),
  }));
  ok(picker.cards === 2, `only your WEAPONS are offered, not your whole table (${picker.cards})`);
  ok(/1 weapon/i.test(picker.sub), `it asks for exactly one (${picker.sub.trim()})`);
  ok(picker.confirmOff, 'and will not confirm until you pick');
  await page.screenshot({ path: join(SHOTS, 'archeus-picker.png') });

  // Pick the SECOND weapon — the one the old findIndex would never have
  // taken, which is what proves the choice is real.
  const out = await page.evaluate(async () => {
    const before = game.players[0].playedCards.map(c => c.name);
    document.querySelectorAll('#promisePicker .pp-card')[1].click();
    document.querySelector('#promisePicker #ppConfirm').click();
    await new Promise(r => setTimeout(r, 400));
    return {
      before,
      after: game.players[0].playedCards.map(c => c.name),
      aiLeft: game.players[1].playedCards.length,
      feed: document.getElementById('logEntries').innerText,
      closed: !document.getElementById('promisePicker').classList.contains('active'),
    };
  });
  ok(out.closed && out.after.length === 1 && out.after[0] === 'Enchanted Flames',
    `the weapon YOU chose is the one taken (${out.before.join(', ')} -> ${out.after.join(', ')})`);
  ok(out.aiLeft === 0, 'an AI victim gives up its weapon too');
  ok(/Archeus forces you to discard Shark Tooth/i.test(out.feed),
    'your loss is named in the VISIBLE feed (addLog only ever reached the save snapshot)');
  ok(/Archeus forces .*Tombstone/i.test(out.feed),
    `and so is the rival's (${(out.feed.match(/Archeus[^\n]*/g) || []).join(' | ')})`);
  await page.evaluate(() => window._archeusDone);
  await page.screenshot({ path: join(SHOTS, 'archeus-feed.png') });
  await page.close();
}

// ═══ OPPONENT VIEW: summed stats in the inspect overlay + the play spotlight ═══
console.log('── Opponent view: inspect panel/chips sum their spread; spotlight = who + BIG card + chips');
{
  // Shared rig: rival 1 gets a KNOWN spread the surfaces must sum faithfully.
  const rigRival = () => {
    const byName = n => FAVOR_DATA.cards.find(c => c.name === n);
    const p = game.players[1];
    p.playedCards = ['Hunting', 'Mind Eraser', 'Mining Guild'].map(n => ({ ...byName(n) }));
    p.gold = 14; p.prestige = 6; p.scorn = 3; p.favor = 22;
    p.skills = { survival: 4, charisma: 2, alchemy: 3, prospecting: 1, knowledge: 2, power: 5 };
    p.flexSkills = [['charisma', 'prospecting']];
    p.philosopherStone = 2;
    game.emblemHolder = 1;
    renderGameState();
  };

  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('oppview: ' + m.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  await startGame(page);
  await page.evaluate(rigRival);
  await page.evaluate(() => openOppOverlay(1));
  await sleep(500);
  const panel = await page.evaluate(() => {
    const el = document.getElementById('oppOvPanel');
    return {
      tokens: [...el.querySelectorAll('.token-val')].map(x => x.textContent.trim()).join(','),
      skills: [...el.querySelectorAll('.skill-row:not(.flex-skill):not(.special-ability) .skill-value')]
        .map(x => x.textContent.trim()).join(','),
      flex: !!el.querySelector('.skill-row.flex-skill'),
      phil: (el.querySelectorAll('.skill-row.special-ability')[0] || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(),
      emblem: !!el.querySelector('.emblem-tag'),
    };
  });
  ok(panel.tokens === '14,6,22,3', `token totem = their purse incl. Favor (${panel.tokens})`);
  ok(panel.skills === '4,2,3,1,2,5', `six skills summed exactly (${panel.skills})`);
  ok(panel.flex && /Philosopher's Stone/.test(panel.phil) && /\b2\b/.test(panel.phil) && panel.emblem,
    `flex pair, full "Philosopher's Stone" ×2 and Emblem Holder all present (${panel.phil})`);
  await page.screenshot({ path: join(SHOTS, 'opp-inspect-desktop.png') });
  await page.evaluate(() => closeOppOverlay());
  await sleep(300);

  // ── Spotlight: the play is the moment — no track, no pills, no history ──
  await page.evaluate(() => { showCardSpotlight(1, { ...FAVOR_DATA.cards.find(c => c.name === 'Hunting') }, 'play'); });
  await sleep(900);
  const spot = await page.evaluate(() => {
    const sp = document.getElementById('cardSpotlight');
    const card = sp.querySelector('.spotlight-card');
    const r = card ? card.getBoundingClientRect() : null;
    return {
      track: !!sp.querySelector('.opp-slot-track'),
      pills: !!sp.querySelector('.stat-pill'),
      thumbs: !!sp.querySelector('.opp-turn-played'),
      cardBig: !!r && r.height >= window.innerHeight * 0.45,
      cardIn: !!r && r.top >= 0 && r.bottom <= window.innerHeight + 1,
      title: (sp.querySelector('.spl-title') || { textContent: '' }).textContent,
      names: sp.querySelectorAll('.spotlight-name').length,
      chips: [...sp.querySelectorAll('.spl-chips .mc-chip')].map(c => c.textContent.trim()),
    };
  });
  ok(!spot.track && !spot.pills && !spot.thumbs, 'no slot track, no purse pills, no history thumbnails');
  ok(spot.cardBig && spot.cardIn, 'the card IS the moment (≥45% of screen height, on-screen)');
  ok(/plays/.test(spot.title) && spot.names === 1, 'one headline (who + verb), card name said once');
  ok(spot.chips.length === 1 && /\+2 Survival/.test(spot.chips[0]),
    `Hunting reads +2 Survival (${spot.chips.join('|') || 'none'})`);
  await page.screenshot({ path: join(SHOTS, 'spotlight-play-desktop.png') });
  await page.evaluate(() => document.getElementById('cardSpotlight').click());
  await sleep(500);

  // Mission Letter: the two-chip story (pays 1g, buys a mission)
  await page.evaluate(() => { showCardSpotlight(1, { ...FAVOR_DATA.cards.find(c => c.type === 'mission_letter') }, 'play'); });
  await sleep(700);
  const letter = await page.evaluate(() =>
    [...document.querySelectorAll('#cardSpotlight .spl-chips .mc-chip')].map(c => c.textContent.trim()));
  ok(letter.length === 2 && /1 Gold/.test(letter[0]) && /Chooses a Mission/.test(letter[1]),
    `Mission Letter reads -1 Gold + Chooses a Mission (${letter.join('|')})`);
  await page.evaluate(() => document.getElementById('cardSpotlight').click());
  await sleep(500);

  // Discard variant: red verb, honest +3 Gold
  await page.evaluate(() => { showCardSpotlight(1, { ...FAVOR_DATA.cards.find(c => c.name === 'Concoction') }, 'discard'); });
  await sleep(700);
  const disc = await page.evaluate(() => ({
    variant: document.getElementById('cardSpotlight').classList.contains('discard-variant'),
    verb: (document.querySelector('#cardSpotlight .spl-verb') || { textContent: '' }).textContent,
    chips: [...document.querySelectorAll('#cardSpotlight .spl-chips .mc-chip')].map(c => c.textContent.trim()).join('|'),
  }));
  ok(disc.variant && /discards/.test(disc.verb) && /\+3 Gold/.test(disc.chips),
    `discard variant: red verb + honest +3 Gold (${disc.chips})`);
  await page.screenshot({ path: join(SHOTS, 'spotlight-discard-desktop.png') });
  await page.evaluate(() => document.getElementById('cardSpotlight').click());
  await page.close();

  // ── Phone 844×390: chip rail sums the spread; spotlight reads left-to-right ──
  const phone = await browser.newPage();
  phone.on('console', m => { if (m.type() === 'error') consoleErrors.push('oppview-phone: ' + m.text()); });
  await phone.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(phone);
  await phone.evaluate(rigRival);
  await phone.evaluate(() => openOppOverlay(1));
  await sleep(500);
  const rail = await phone.evaluate(() => {
    const el = document.getElementById('oppOvChips');
    const r = el.getBoundingClientRect();
    return {
      purse: [...el.querySelectorAll('.tv-purse-chip b')].map(x => x.textContent.trim()).slice(0, 4).join(','),
      skills: [...el.querySelectorAll('.tv-skill-chip:not(.flex):not(.special) b')].map(x => x.textContent.trim()).join(','),
      flex: !!el.querySelector('.tv-skill-chip.flex'),
      specials: el.querySelectorAll('.tv-skill-chip.special').length,
      emblem: !!el.querySelector('.tv-purse-chip.emblem'),
      inViewport: r.left >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  ok(rail.purse === '14,6,22,3', `full purse incl. Favor on the rail (${rail.purse})`);
  ok(rail.skills === '4,2,3,1,2,5', `six skills as HUD chips (${rail.skills})`);
  ok(rail.flex && rail.specials >= 1 && rail.emblem, 'flex pair, Phil. Stone and Emblem chips present');
  ok(rail.inViewport && !rail.hscroll, 'rail fits the phone viewport, no horizontal scroll');
  await phone.screenshot({ path: join(SHOTS, 'opp-inspect-phone.png') });
  await phone.evaluate(() => closeOppOverlay());
  await sleep(300);

  await phone.evaluate(() => { showCardSpotlight(1, { ...FAVOR_DATA.cards.find(c => c.name === 'Hunting') }, 'play'); });
  await sleep(900);
  const pspot = await phone.evaluate(() => {
    const sp = document.getElementById('cardSpotlight');
    const card = sp.querySelector('.spotlight-card').getBoundingClientRect();
    const head = sp.querySelector('.spl-head').getBoundingClientRect();
    const pay = sp.querySelector('.spl-payoff').getBoundingClientRect();
    const inV = r => r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.right <= window.innerWidth + 1;
    return {
      cardBig: card.height >= window.innerHeight * 0.66,
      row: head.right <= card.left + 2 && card.right <= pay.left + 2,
      allIn: [card, head, pay].every(inV),
    };
  });
  ok(pspot.cardBig, 'phone spotlight: card takes ≥66% of screen height');
  ok(pspot.row, 'reads left-to-right: who | card | payoff');
  ok(pspot.allIn, 'every beat on-screen, nothing clipped');
  await phone.screenshot({ path: join(SHOTS, 'spotlight-play-phone.png') });
  await phone.evaluate(() => document.getElementById('cardSpotlight').click());
  await phone.close();
}

// ═══ DESKTOP: drag-to-THROW — the phone's Hearthstone pull, mouse-driven ═══
console.log('── Desktop: drag a card up and release → the throw (face down, take-back)');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('desk-drag: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('desk-drag pageerror: ' + e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await startGame(page);
  await sleep(400);
  // Freeze the rivals' throw timers (they scale by CINEMATIC_SPEED) so the
  // undo window stays open for the whole gesture sequence below.
  await page.evaluate(() => {
    // Any rival who already threw takes it back (engine-clean), so the
    // whole table is guaranteed un-locked for the gesture checks.
    for (let i = 1; i < game.playerCount; i++) {
      if (game.pendingActivations[i]) game.unpickCard(i);
    }
    window.CINEMATIC_SPEED = 1000;
    beginThrowPhase();
  });
  await sleep(200);

  // Middle card, same as the hover-bloom flow: the left rail's mission
  // strip overhangs the leftmost card's center at this viewport.
  const measureMid = () => page.evaluate(() => {
    const cards = [...document.querySelectorAll('#handZone .hand-card')];
    const card = cards[Math.floor(cards.length / 2)];
    const r = card.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, i: parseInt(card.getAttribute('data-hand-i'), 10) };
  });
  const c = await measureMid();
  ok(!isNaN(c.i), `desktop hand cards carry data-hand-i (#${c.i})`);

  // Press + tiny wiggle: below the slop, no drag yet.
  await page.mouse.move(c.x, c.y);
  await sleep(300);
  await page.mouse.down();
  await page.mouse.move(c.x + 4, c.y - 4);
  await sleep(120);
  ok(await page.evaluate(() => !document.querySelector('#handZone .hand-card.dragging')),
    'sub-slop wiggle stays a click, not a drag');

  // Pull up past the lift line: card detaches and rides the cursor.
  await page.mouse.move(c.x + 30, c.y - 160, { steps: 8 });
  await sleep(250);
  const midDrag = await page.evaluate(() => {
    const d = document.querySelector('#handZone .hand-card.dragging');
    return {
      dragging: !!d,
      followed: d ? /scale\(1\.45\)/.test(d.style.transform) : false,
      dimmed: [...document.querySelectorAll('#handZone .hand-card:not(.dragging)')]
        .every(x => parseFloat(getComputedStyle(x).opacity) < 0.7),
      hoverDead: [...document.querySelectorAll('#handZone .hand-card:not(.dragging)')]
        .every(x => getComputedStyle(x).pointerEvents === 'none'),
    };
  });
  ok(midDrag.dragging, 'past the lift line the card detaches (mouse)');
  ok(midDrag.followed, 'the card rides the cursor at drag scale');
  ok(midDrag.dimmed && midDrag.hoverDead, 'the rest of the fan dims and goes hover-dead');
  await page.screenshot({ path: join(SHOTS, 'desktop-drag-up.png') });

  // Release up top → THE THROW: face down, no popup, take-back on offer.
  await page.mouse.up();
  await sleep(500);
  const committed = await page.evaluate(() => ({
    panel: !!document.querySelector('.action-panel.active'),
    thrown: !!game.pendingActivations[0],
    zone: document.getElementById('thrownZone').classList.contains('active'),
    undoBtn: !!document.querySelector('#thrownZone .tz-undo'),
    hand: game.players[0].hand.length,
    dragLeft: !!document.querySelector('#handZone .hand-card.dragging'),
  }));
  ok(committed.thrown && !committed.panel, 'release up top THROWS the card — no popup appears');
  ok(committed.zone && committed.undoBtn, 'the face-down card shows with its take-back');
  ok(!committed.dragLeft, 'the drag element snapped home');
  await page.screenshot({ path: join(SHOTS, 'desktop-drag-commit.png') });

  // Take it back — the physical undo, open until the last card drops.
  await page.evaluate(() => document.querySelector('#thrownZone .tz-undo').click());
  await sleep(350);
  const undone = await page.evaluate(() => ({
    thrown: !!game.pendingActivations[0],
    zone: document.getElementById('thrownZone').classList.contains('active'),
    hand: game.players[0].hand.length,
  }));
  ok(!undone.thrown && !undone.zone, 'Take it Back retrieves the card');
  ok(undone.hand === 7, `the hand is whole again (${undone.hand})`);

  const fresh = async () => {
    await page.evaluate(() => renderGameState());
    await sleep(250);
    return measureMid();
  };

  // Drag up then back low = cancel: no sheet, and the release click
  // must NOT re-select the card it just put back.
  const c2 = await fresh();
  await page.mouse.move(c2.x, c2.y);
  await page.mouse.down();
  await page.mouse.move(c2.x + 10, c2.y - 160, { steps: 6 });
  await sleep(180);
  const midCancel = await page.evaluate(() => !!document.querySelector('#handZone .hand-card.dragging'));
  await page.mouse.move(c2.x + 2, c2.y - 8, { steps: 6 });
  await sleep(150);
  await page.mouse.up();
  await sleep(450);
  const cancelled = await page.evaluate(() => ({
    panel: !!document.querySelector('.action-panel.active'),
    dragging: !!document.querySelector('#handZone .hand-card.dragging'),
  }));
  ok(midCancel, 'cancel fixture: the drag really engaged before dropping back');
  ok(!cancelled.panel && !cancelled.dragging, 'dragging back down cancels cleanly (release ≠ click)');

  // A plain click is a read, not a commit: nothing throws, nothing opens.
  const c3 = await fresh();
  await page.mouse.move(c3.x, c3.y);
  await sleep(200);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(400);
  const clicked = await page.evaluate(() => ({
    panel: !!document.querySelector('.action-panel.active'),
    thrown: !!game.pendingActivations[0],
  }));
  ok(!clicked.panel && !clicked.thrown, 'a plain click never throws and opens nothing');
  await page.close();
}

// ═══ STAT FLOATS: a gain pops "+N" off the stat itself, both layouts ═══
console.log('── Quiet throw: no phase words, 3s take-back grace, Emblem flare, casual names');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('quiet-throw: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('quiet-throw pageerror: ' + e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await startGame(page);
  await sleep(400);

  // Regular solo table: fake humans wear the casual pool, never the
  // renaissance style (Wyatt 7/17), and never a persona's name unless
  // the seat IS a persona.
  const names = await page.evaluate(() => ({
    bots: game.players.slice(1).filter(p => !p._personaUid).map(p => p.name),
    pool: window.CASUAL_AI_NAMES,
  }));
  ok(names.bots.length > 0 && names.bots.every(n => names.pool.includes(n)),
    `regular-game bots wear casual names (${names.bots.join(', ')})`);
  ok(names.bots.every(n => !/Prince|Princess|Lord|Lady|Count|Dame|Duke|Baron/.test(n)),
    'no renaissance titles on fake humans');

  // The hint label reads the new line.
  const label = await page.evaluate(() =>
    (document.querySelector('.th-label') || {}).textContent);
  ok(label === 'Drag a card up to play it', `throw hint label (${label})`);

  // Phase bar carries NO words during throw/reveal.
  await page.evaluate(() => {
    for (let i = 1; i < game.playerCount; i++) {
      if (game.pendingActivations[i]) game.unpickCard(i);
    }
    window.CINEMATIC_SPEED = 1000;   // park the rivals' own timers
    beginThrowPhase();
  });
  await sleep(200);
  const quiet = await page.evaluate(() => ({
    phase: game.phase,
    barHidden: document.getElementById('phaseBar').style.display === 'none',
    barEmpty: !document.getElementById('phaseBar').textContent.trim(),
  }));
  ok(quiet.phase === 'gameplay' && quiet.barHidden && quiet.barEmpty,
    'the Act/Throw pill is gone while cards go in');

  // All cards in → THREE seconds of grace, take-back alive the whole way.
  await page.evaluate(() => {
    for (let i = 1; i < game.playerCount; i++) {
      if (game.pendingActivations[i] === null && game.players[i].hand.length) aiPickCard(i);
    }
    throwCard(0);
  });
  await sleep(1100);
  const inGrace = await page.evaluate(() => ({
    phase: game.phase,
    locked: !!(_throwUx && _throwUx.locked),
    undoBtn: !!document.querySelector('#thrownZone .tz-undo'),
  }));
  ok(inGrace.phase === 'gameplay' && !inGrace.locked && inGrace.undoBtn,
    'one second after the last card, the table still holds (grace open)');

  // A take-back inside the grace cancels the pending lock entirely.
  await page.evaluate(() => undoThrow());
  await sleep(2600);
  const cancelled = await page.evaluate(() => ({
    locked: !!(_throwUx && _throwUx.locked),
    myPending: game.pendingActivations[0],
  }));
  ok(!cancelled.locked && cancelled.myPending === null,
    'a take-back inside the grace cancels the lock — nothing fires at 3s');

  // Re-throw, then peek at the missions mid-grace: an open overlay hides
  // the take-back, so the clock must WAIT — no lock behind your back
  // (Wyatt 7/17: "the undo button didn't work at a key moment").
  await page.evaluate(() => { throwCard(0); openMissionBrowser('realm'); });
  await sleep(4600);
  const deferred = await page.evaluate(() => ({
    locked: !!(_throwUx && _throwUx.locked),
    browserOpen: document.getElementById('missionLB').classList.contains('active'),
  }));
  ok(deferred.browserOpen && !deferred.locked,
    'the grace clock waits while an overlay hides the take-back (4.6s in, still open)');
  await page.evaluate(() => closeMissionLB());
  const flared = await page.waitForFunction(() => _throwUx && _throwUx.locked,
    { timeout: 9000 }).then(() => page.evaluate(() => ({
      flare: !!document.querySelector('.em-first'),
      toastText: document.getElementById('notifications').textContent,
      undoOffered: !!document.querySelector('#thrownZone .tz-undo'),
    })));
  ok(flared.flare, 'after the overlay closes, a fresh beat runs and the Emblem flares');
  ok(!/reveals? first/i.test(flared.toastText), 'no "reveals first" banner anywhere');
  ok(flared.undoOffered, 'SOLO: the take-back button rides through the lock beat');

  // ...and it WORKS mid-beat: the pass is abandoned, the table re-opens.
  const reopened = await page.evaluate(() => {
    undoThrow();
    return {
      locked: !!(_throwUx && _throwUx.locked),
      pending: game.pendingActivations[0],
      phase: game.phase,
    };
  });
  ok(!reopened.locked && reopened.pending === null && reopened.phase === 'gameplay',
    'take-back DURING the lock beat re-opens the table (the pass is abandoned)');
  await page.close();
}

console.log('── Leave & resume: skirmish walks away clean, a regular table keeps your seat');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('leave: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('leave pageerror: ' + e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await startGame(page);
  await sleep(400);
  // The helper seams saves OFF for every other flow — this one manages
  // its own. Clean the table (any early AI throws back to hands), park
  // the rival timers, and re-open the round so the checkpoint fires.
  await page.evaluate(() => {
    window._noSoloSave = false;
    // The pin built the deterministic table; releasing it now lets the
    // checkpoint fire (pinned tables never save — the rig seam).
    delete window._pinEmblemSeed;
    for (let i = 0; i < game.playerCount; i++) {
      if (game.pendingActivations[i]) game.unpickCard(i);
    }
    window.CINEMATIC_SPEED = 1000;
    beginThrowPhase();
  });
  await sleep(300);

  const saved = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('favorSoloSave') || 'null');
    return {
      exists: !!s, act: s && s.g.currentAct,
      names: s ? s.g.players.map(p => p.name).join('|') : '',
      liveNames: game.players.map(p => p.name).join('|'),
      handIds: s ? s.g.players[0].hand.map(c => c.id).join(',') : 'save-missing',
      liveHand: game.players[0].hand.map(c => c.id).join(','),
      gold: s && s.g.players[0].gold,
    };
  });
  ok(saved.exists && saved.names === saved.liveNames && saved.handIds === saved.liveHand,
    'a regular round start checkpoints the whole table');

  // The door: visible AND genuinely tappable (real hit-test).
  const door = await page.evaluate(() => {
    const d = document.getElementById('gameLeave');
    const r = d.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { visible: r.width > 10, hitsDoor: hit === d || d.contains(hit) };
  });
  ok(door.visible && door.hitsDoor, 'the leave door is visible and wins its own hit-test');

  await page.evaluate(() => document.getElementById('gameLeave').click());
  await sleep(250);
  const sheet = await page.evaluate(() => ({
    open: document.getElementById('leaveSheet').classList.contains('active'),
    copy: document.getElementById('leaveSheet').textContent.replace(/\s+/g, ' '),
  }));
  ok(sheet.open && /seat is saved/i.test(sheet.copy) && /Save & Leave/i.test(sheet.copy),
    'a regular game offers Save & Leave with honest copy');
  await page.evaluate(() => {
    [...document.querySelectorAll('#leaveSheet .btn-royal')]
      .find(b => /keep playing/i.test(b.textContent)).click();
  });
  ok(await page.evaluate(() => !document.getElementById('leaveSheet').classList.contains('active')),
    'Keep Playing closes the sheet');

  const left = await page.evaluate(() => {
    let reloads = 0;
    const real = FLB.applyUpdate;
    FLB.applyUpdate = () => reloads++;
    document.getElementById('gameLeave').click();
    [...document.querySelectorAll('#leaveSheet .btn-royal')]
      .find(b => /save & leave/i.test(b.textContent)).click();
    FLB.applyUpdate = real;
    return { reloads, saveKept: !!localStorage.getItem('favorSoloSave') };
  });
  ok(left.reloads === 1 && left.saveKept, 'Save & Leave reloads out and KEEPS the checkpoint');

  // Back at the menu (real reload): PLAY offers the waiting table.
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await page.evaluate(() => { startGame(); });
  await sleep(300);
  const resume = await page.evaluate(() => ({
    open: document.getElementById('leaveSheet').classList.contains('active'),
    copy: document.getElementById('leaveSheet').textContent.replace(/\s+/g, ' '),
  }));
  ok(resume.open && /A Table Awaits/i.test(resume.copy), 'PLAY offers the waiting table first');
  await page.evaluate(() => {
    [...document.querySelectorAll('#leaveSheet .btn-royal')]
      .find(b => /resume game/i.test(b.textContent)).click();
  });
  await page.waitForFunction(() => typeof game !== 'undefined' && game
    && document.getElementById('game-screen').classList.contains('active'), { timeout: 10000 });
  await sleep(400);
  const resumed = await page.evaluate(() => ({
    names: game.players.map(p => p.name).join('|'),
    hand: game.players[0].hand.map(c => c.id).join(','),
    gold: game.players[0].gold,
    act: game.currentAct,
    phase: game.phase,
    heroLinked: !!(game.players[0].character
      && FAVOR_DATA.characters.includes(game.players[0].character)),
  }));
  ok(resumed.names === saved.liveNames && resumed.hand === saved.liveHand
     && resumed.gold === saved.gold && resumed.act === saved.act && resumed.phase === 'gameplay',
    `the table returns exactly as left (Act ${resumed.act}, hands byte-identical)`);
  ok(resumed.heroLinked, 'characters re-link to canonical defs on resume');
  await page.screenshot({ path: join(SHOTS, 'resume-table.png') });

  // Finishing the table burns the save.
  await page.evaluate(() => {
    game.players.forEach((p, i) => { p.favor = 50 - i * 10; });
    try { showScoring(); } catch (e) { /* the ceremony may want more rig — the save clear is what's under test */ }
  });
  await sleep(800);
  ok(await page.evaluate(() => !localStorage.getItem('favorSoloSave')),
    'a finished table clears its save');

  // SKIRMISH: the same door, honest copy, and NO save behind.
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FMODES && window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await page.evaluate(() => {
    window.shuffleArray = (a) => [...a];
    window._pinEmblemSeed = 0;
    localStorage.setItem('favorQueue', '3');
    FMODES.beginSkirmish(3);
  });
  await page.waitForFunction(() => document.getElementById('character-select').classList.contains('active')
    && document.querySelector('.character-card'), { timeout: 15000 });
  await page.evaluate(() => {
    const c = document.querySelector('.character-card');
    selectCharacter(c.dataset.id, c);
    document.getElementById('confirmBtn').click();
  });
  await page.waitForFunction(() => typeof game !== 'undefined' && game
    && game.players.length && game.players[0].character
    && document.getElementById('game-screen').classList.contains('active'), { timeout: 20000 });
  await sleep(600);
  const sk = await page.evaluate(() => {
    let reloads = 0;
    const real = FLB.applyUpdate;
    FLB.applyUpdate = () => reloads++;
    const doorR = document.getElementById('gameLeave').getBoundingClientRect();
    document.getElementById('gameLeave').click();
    const copy = document.getElementById('leaveSheet').textContent.replace(/\s+/g, ' ');
    [...document.querySelectorAll('#leaveSheet .btn-royal')]
      .find(b => /^leave$/i.test(b.textContent.trim())).click();
    FLB.applyUpdate = real;
    return { doorVisible: doorR.width > 10, copy, reloads,
             save: !!localStorage.getItem('favorSoloSave') };
  });
  ok(sk.doorVisible, 'the skirmish table wears the same door');
  ok(/skirmish/i.test(sk.copy) && /nothing is recorded/i.test(sk.copy),
    'skirmish leave copy is honest');
  ok(sk.reloads === 1 && !sk.save, 'leaving a skirmish reloads out with NO save behind');
  await page.close();
}

console.log('── Blind Faith pairing: the panel, the probe and the melee agree');
{
  const page = await browser.newPage();
  page.on('pageerror', e => consoleErrors.push('pairing pageerror: ' + e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await startGame(page);
  await sleep(300);
  const pair = await page.evaluate(() => {
    const p = game.players[0];
    const by = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n), id: 'rig_' + n });
    p.playedCards = [by('Blind Faith'), by("Heaven's Blade")];
    p.skills.power = 6;
    p.gold = 15;
    renderGameState();
    const shown = document.querySelector('#statsPanel .skill-row[data-stat="power"] .skill-value');
    const lou = FAVOR_DATA.missions.find(m => m.name === 'Wanted: Crazy Lou');
    game.players[1].playedCards = [by('Blind Faith')];
    const plan = game.missionBorrowPlan(0, { ...lou });
    return {
      panel: shown ? shown.textContent : null,
      melee: game.calculatePower(0),
      deficit: game.unmetSkillReqs(0, { power: 15 }).power || 0,
      plan: !!plan, planCost: plan && plan.cost,
    };
  });
  ok(pair.panel === '12', `the left panel shows the paired 12 Power (${pair.panel})`);
  ok(pair.melee === 12, `the melee tallies the same 12 (${pair.melee})`);
  ok(pair.deficit === 3 && pair.plan && pair.planCost === 6,
    `Wanted: Crazy Lou sees a 3 deficit and offers the 6-gold borrow (${pair.planCost})`);
  await page.close();
}

console.log('── Phone leaderboard: character chips stand whole (no half-cut row)');
{
  const page = await browser.newPage();
  page.on('pageerror', e => consoleErrors.push('lb-chips pageerror: ' + e.message));
  await page.setViewport({ width: 932, height: 430, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await page.evaluate(() => FLB.openLeaderboard('alltime'));
  await sleep(1000);
  const chips = await page.evaluate(() => {
    const inner = document.querySelector('.lb-inner').getBoundingClientRect();
    const rs = [...document.querySelectorAll('.lb-chartab')].map(c => c.getBoundingClientRect());
    return {
      count: rs.length,
      whole: rs.every(r => r.height >= 22 && r.left >= inner.left - 1 && r.right <= inner.right + 1),
      pill: rs.every(r => r.width > r.height),   // rail rows now read as pills, not circles
    };
  });
  ok(chips.count === 11 && chips.whole && chips.pill,
    `the hero rail renders whole inside the panel at 932×430 (${chips.count})`);
  await page.screenshot({ path: join(SHOTS, 'lb-chips-phone.png') });
  await page.close();
}

console.log('── Stat floats: +N rises off the grown stat (desktop rail + phone chips)');
{
  // Desktop: +3 Charisma (Wyatt's Settling Claims beat) + gold/favor purse.
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('stat-float: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('stat-float pageerror: ' + e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await startGame(page);
  await sleep(400);

  await page.evaluate(() => {
    const p = game.players[0];
    p.bonusSkills = { ...(p.bonusSkills || {}), charisma: ((p.bonusSkills || {}).charisma || 0) + 3 };
    game.applySlotSkills(p);   // bonusSkills only lands on the skill rebuild
    p.gold += 4;
    p.favor = (p.favor || 0) + 5;
    renderGameState();
  });
  await sleep(350);   // mid-flight (floats stagger 130ms apart)
  const desk = await page.evaluate(() => {
    const floats = [...document.querySelectorAll('.stat-float')].map(f => {
      const r = f.getBoundingClientRect();
      return { text: f.textContent, x: r.left, y: r.top + r.height / 2, bad: f.classList.contains('bad') };
    });
    // New geometry: LEVEL with the stat's row (y), in the open air right
    // of the panel (x past the rail) — never rising across the row above.
    const levelRightOf = (sel, railSel) => {
      const a = document.querySelector(sel);
      const rail = document.querySelector(railSel);
      if (!a || !rail) return null;
      const ar = a.getBoundingClientRect(), rr = rail.getBoundingClientRect();
      return (f) => Math.abs(f.y - (ar.top + ar.height / 2)) < 45 && f.x >= rr.right;
    };
    const chaPlace = levelRightOf('#statsPanel [data-stat="charisma"]', '#statsPanel');
    const goldPlace = levelRightOf('#statsPanel [data-stat="gold"]', '#statsPanel .resource-tokens');
    return {
      texts: floats.map(f => f.text).sort().join(','),
      chaPlaced: !!floats.find(f => f.text === '+3' && chaPlace && chaPlace(f)),
      goldPlaced: !!floats.find(f => f.text === '+4' && goldPlace && goldPlace(f)),
      anyBad: floats.some(f => f.bad),
      onBody: [...document.querySelectorAll('.stat-float')].every(f => f.parentElement === document.body),
    };
  });
  ok(desk.texts === '+3,+4,+5', `desktop floats for every gain (${desk.texts})`);
  ok(desk.chaPlaced, '+3 pops level with the Charisma row, right of the panel');
  ok(desk.goldPlaced, '+4 pops level with the gold token, clear of the totem');
  ok(!desk.anyBad, 'no scorn styling on plain gains');
  ok(desk.onBody, 'floats live on document.body (re-render-proof)');
  // Pacing: the activation loop must wait the "+N" beat out before the
  // next player's spotlight (floats were playing under rival turns), and
  // then hold a breath of CLEAR table before the rival's full-screen
  // takeover (Wyatt: the popup was buried under the other players' plays).
  ok(await page.evaluate(() =>
    typeof statFloatWait === 'function' && /statFloatWait\(\)/.test(String(activateAllCards))),
    'activation loop awaits the +N beat before the next spotlight');
  ok(await page.evaluate(() => /hadFloats/.test(String(activateAllCards)) &&
    /\(mine \? 900 : 350\)\s*\*\s*window\.CINEMATIC_SPEED/.test(String(activateAllCards))),
    'a clear-air breather separates your payoff from the next player’s takeover — and YOURS is the long one (900ms)');
  // Wyatt 7/13: on the last round your two cards resolve back-to-back and the
  // rivals used to start the instant the second landed — "they blur past".
  ok(await page.evaluate(() =>
    /\(mine \? 650 : 300\)\s*\*\s*window\.CINEMATIC_SPEED/.test(String(activateAllCards))),
    'your last TWO cards get room between them (650ms) — two moves, not one smear');
  await page.screenshot({ path: join(SHOTS, 'stat-float-desktop.png') });
  await sleep(2400);   // floats live 1750ms + up to 260ms stagger
  ok(await page.evaluate(() => document.querySelectorAll('.stat-float').length === 0),
    'floats clean themselves up');

  // The payoff is ONE beat: play a real card through the pipeline and the
  // "+N" floats must be on stage WHILE your card banner shows (they used
  // to fire after it, half-faded by the time the eye arrived).
  await page.evaluate(() => {
    window.CINEMATIC_SPEED = 1;
    const p = game.players[0];
    const gainer = FAVOR_DATA.cards.find(c => (c.skills || []).length >= 2 &&
      !(c.requirements && Object.keys(c.requirements).length) && !c.special);
    p.hand = [{ ...(gainer || FAVOR_DATA.cards.find(c => c.name === 'First Aid')), id: 'float_rig' }];
    p.hand.push({ ...FAVOR_DATA.cards.find(c => c.name === 'First Aid'), id: 'float_pad' });
    game.pendingActivations = new Array(game.playerCount).fill(null);
    game.phase = 'gameplay';
    renderGameState();
  });
  await sleep(250);
  await throwAndAwaitChoice(page, 0);
  await answerChoice(page, /play/);
  let overlap = false;
  for (let t = 0; t < 30 && !overlap; t++) {
    overlap = await page.evaluate(() =>
      document.querySelector('.mini-spotlight') && document.querySelectorAll('.stat-float').length > 0);
    await sleep(100);
  }
  ok(overlap, 'banner and "+N" floats share the stage — one payoff beat');
  // The auto-paired second card asks too — answer it honestly.
  try {
    await page.waitForFunction(() => window._finalChoicePending === true, { timeout: 8000 });
    await answerChoice(page, /discard \(\+3g\)/);
  } catch (e) {}
  await page.close();

  // Phone: skill gain floats on the rail chip; purse gains keep their
  // token-drop narration and do NOT double up with a float.
  const phone = await browser.newPage();
  phone.on('console', m => { if (m.type() === 'error') consoleErrors.push('stat-float-phone: ' + m.text()); });
  await phone.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(phone);
  await sleep(400);

  await phone.evaluate(() => {
    const p = game.players[0];
    p.bonusSkills = { ...(p.bonusSkills || {}), prospecting: ((p.bonusSkills || {}).prospecting || 0) + 2 };
    game.applySlotSkills(p);   // bonusSkills only lands on the skill rebuild
    p.gold += 3;
    renderGameState();
  });
  await sleep(350);
  const ph = await phone.evaluate(() => {
    const floats = [...document.querySelectorAll('.stat-float')].map(f => {
      const r = f.getBoundingClientRect();
      return { text: f.textContent, x: r.left, y: r.top + r.height / 2, right: r.right };
    });
    const chip = document.querySelector('#tvSkills [data-stat="prospecting"]');
    const rail = document.getElementById('tvSkills');
    const cr = chip ? chip.getBoundingClientRect() : null;
    const rr = rail ? rail.getBoundingClientRect() : null;
    return {
      count: floats.length,
      text: floats[0] ? floats[0].text : '',
      placed: !!(cr && rr && floats[0]
        && Math.abs(floats[0].y - (cr.top + cr.height / 2)) < 40
        && floats[0].x >= rr.right),
      onScreen: floats.every(f => f.right <= window.innerWidth && f.y >= 0),
      goldDrop: !!document.querySelector('.tv-token-drop.gold'),
    };
  });
  ok(ph.count === 1 && ph.text === '+2', `phone: exactly the skill float, no purse double (${ph.count}× "${ph.text}")`);
  ok(ph.placed && ph.onScreen, 'the +2 pops level with the Prospecting chip, right of the rail, on-screen');
  ok(ph.goldDrop, 'gold keeps its seat-chip token drop');
  await phone.screenshot({ path: join(SHOTS, 'stat-float-phone.png') });
  await phone.close();
}

// ═══ EMBLEM + PERSONAS + RANK-1 BOON — rated start, act pass, choosers ═══
// These beats rig FLB.tableSeed with uaudit-prefixed uids ONLY — the five
// real persona_* rows must never feel an audit (asserted at the end).
console.log('── Emblem/personas/boon: rated seat, act pass, both boon paths, persona post');

// Shared launcher: the startGame dance WITHOUT the emblem pin — this flow
// exercises the real seed path with a rigged seed injected pre-confirm.
async function startSeeded(page, seedRig) {
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    return b && b.offsetParent;
  }, { timeout: 20000 });
  await page.evaluate((rig) => {
    window.shuffleArray = (a) => [...a];
    window._mpSkipQueue = true;   // real seed path, no live queue
    // Seeded fixtures are rigs too: no checkpoints out, no stale save
    // intercepting the Play tap (same seam as the startGame helper).
    window._noSoloSave = true;
    localStorage.removeItem('favorSoloSave');
    localStorage.setItem('favorQueue', '3');
    FLB.tableSeed = async () => rig;
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  }, seedRig);
  await page.waitForFunction(() => document.querySelector('.character-card') && document.querySelector('.character-card').offsetParent, { timeout: 20000 });
  await page.evaluate(() => {
    selectedCharacter = FAVOR_DATA.characters[0].id;
    document.querySelector('.character-card').classList.add('selected');
    document.getElementById('confirmBtn').style.display = 'inline-block';
  });
  await page.evaluate(() => document.getElementById('confirmBtn').click());
}

// ── Beat 1: rated table — persona takes the Emblem, claims the boon,
//    the act boundary passes it, and the placement posts to its row. ──
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('emblem: ' + m.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  const AUDIT_UID = 'uaudit' + Math.random().toString(36).slice(2, 8);
  const P_UID = AUDIT_UID + 'p1';
  await page.evaluateOnNewDocument((u) => {
    localStorage.setItem('favorUid', u);
    localStorage.setItem('favorName', 'Audit Noble');
    localStorage.setItem('favorQueue', '3');
  }, AUDIT_UID);

  await startSeeded(page, {
    myRow: { uid: AUDIT_UID, rating: 1400 },
    topRow: { uid: P_UID, name: 'Lord Ashcroft', score: 1960 },
    personas: [{ key: 'ashcroft', uid: P_UID, name: 'Lord Ashcroft', hero: 'knight',
                 seedRating: 1960, rating: 1960, strong: ['power', 'survival'] }],
    forceSeats: ['ashcroft'],   // rig seam — real seeds never set it
  });
  await page.waitForFunction(() => typeof game !== 'undefined' && game
    && game.players.length === 3 && game.players[0].character, { timeout: 20000 });
  await sleep(1200);
  await page.evaluate(() => { const x = document.querySelector('.coach-x'); if (x && x.offsetParent) x.click(); });

  const mode = await page.evaluate(() => FLB.mode);
  ok(mode === 'firebase', `live board reachable for the persona-post beat (${mode})`);

  // The REAL persona row moves with real play (Wyatt's games pay Ashcroft
  // his placements) — capture the live value now and assert the AUDIT run
  // leaves it exactly where it stood, whatever that is today.
  const realBefore = await page.evaluate(async () =>
    (await firebase.database().ref('favor/players/persona_ashcroft/rating').get()).val());

  const start = await page.evaluate(() => ({
    emblem: game.emblemHolder,
    p1name: game.players[1].name,
    p1uid: game.players[1]._personaUid,
    p1boon: { ...(game.players[1].bonusSkills || {}) },
    p1power: game.players[1].skills.power || 0,
    railBadgeOn: (() => {
      const e = document.querySelector('.opp-entry .emblem-badge');
      return e ? e.closest('.opp-entry').dataset.pi : 'none';
    })(),
    log: document.getElementById('logEntries').innerText,
  }));
  ok(start.emblem === 1, `rated table: highest rating holds the Act-1 Emblem (seat ${start.emblem})`);
  ok(start.p1name === 'Lord Ashcroft' && start.p1uid === P_UID,
    `persona seated under its own row uid (${start.p1name})`);
  ok(start.log.includes('Lord Ashcroft holds the Emblem'), 'Act-1 seat announced in the log');
  ok(start.railBadgeOn === '1', `rail badge rides the persona's entry (pi=${start.railBadgeOn})`);
  ok(start.p1boon.power === 1 && start.p1power === 1,
    `persona claimed the rank-1 boon (+1 power → ${start.p1power})`);
  ok(start.log.includes("realm's #1"), 'persona boon announced publicly');
  await page.screenshot({ path: join(SHOTS, 'emblem-persona-start.png') });

  // Act boundary: engine passes it +1 clockwise; the badge moves with it.
  await page.evaluate(() => { game.startAct(2); renderGameState(); });
  await sleep(400);
  const pass2 = await page.evaluate(() => ({
    emblem: game.emblemHolder,
    railBadgeOn: (() => {
      const e = document.querySelector('.opp-entry .emblem-badge');
      return e ? e.closest('.opp-entry').dataset.pi : 'none';
    })(),
  }));
  ok(pass2.emblem === 2, `act boundary passes the Emblem +1 clockwise (seat ${pass2.emblem})`);
  ok(pass2.railBadgeOn === '2', `the badge moved with it (pi=${pass2.railBadgeOn})`);
  await page.screenshot({ path: join(SHOTS, 'emblem-act2-pass.png') });

  // Persona placement posts to ITS row: rating AND — new on 7/18 — a daily
  // score, "just like regular players". Still no Stars, and the podium
  // filter keeps it off the crowns (asserted in its own beat below).
  await page.evaluate(() => {
    game.players[0].favor = 50; game.players[1].favor = 100; game.players[2].favor = 5;
    showScoring();
  });
  const post = await page.evaluate(async (puid) => {
    for (let i = 0; i < 40; i++) {
      const s = await firebase.database().ref(`favor/players/${puid}/rating`).get();
      if (s.exists()) break;
      await new Promise(r => setTimeout(r, 250));
    }
    const row = (await firebase.database().ref(`favor/players/${puid}`).get()).val() || {};
    const key = FLB.currentDateKey();
    const d = (await firebase.database().ref(`favor/daily/${key}/scores/${puid}`).get()).val();
    return { rating: row.rating, ratingV: row.ratingV, wins: row.wins,
             stars: row.stars === undefined ? null : row.stars, daily: d };
  }, P_UID);
  ok(post.rating > 1000 && post.rating <= 1300 && post.ratingV === 2,
    `persona 1st place gained rating on the uaudit row (${post.rating}, v${post.ratingV})`);
  ok(post.stars === null, 'persona earns no Stars — a currency it could never spend');
  ok(post.daily && post.daily.best > 0,
    `the persona's high score reaches the daily board (best ${post.daily && post.daily.best})`);
  ok(post.daily && post.daily.persona === true,
    'and is stamped persona:true so settlement can filter it');

  // Leave no trace — remove-verify-retry for BOTH uids across every daily
  // key, then prove the REAL persona rows never felt any of this.
  const scrub = await page.evaluate(async (uids) => {
    let verdict = 'RESIDUE';
    for (let attempt = 0; attempt < 6 && verdict === 'RESIDUE'; attempt++) {
      for (const u of uids) {
        await firebase.database().ref(`favor/players/${u}`).remove();
        const days = (await firebase.database().ref('favor/daily').get()).val() || {};
        for (const k of Object.keys(days)) {
          await firebase.database().ref(`favor/daily/${k}/scores/${u}`).remove();
        }
      }
      await new Promise(r => setTimeout(r, 500));
      let residue = false;
      for (const u of uids) {
        if ((await firebase.database().ref(`favor/players/${u}`).get()).exists()) residue = true;
      }
      verdict = residue ? 'RESIDUE' : 'clean';
    }
    const real = (await firebase.database().ref('favor/players/persona_ashcroft/rating').get()).val();
    return { verdict, real };
  }, [AUDIT_UID, P_UID]);
  ok(scrub.verdict === 'clean', `audit rows scrubbed from favor/* (${scrub.verdict})`);
  ok(scrub.real === realBefore, `REAL persona_ashcroft row untouched (rating ${scrub.real}, was ${realBefore})`);
  await page.close();
}

// ── Beat 1b: ⚠⚠ THE CROWN COLLISION. Personas rank on the daily board now,
//    and settleDue pays Stars, increments champs and pushes a royal overlay
//    for each of the top three. Unfiltered, a persona would take a crown and
//    its Stars FROM A REAL HUMAN, wear crowns on the leaderboard, and grow an
//    orphan msgQueue on a permanent row that will never log in. The filter
//    belongs at the PODIUM, not on the board — Wyatt: "prevent them from
//    getting the crowns. That's fine."
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('crown-filter: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  const H_UID = 'uqacrown' + Math.random().toString(36).slice(2, 6);
  const P_UID = H_UID + 'persona';
  // A CLOSED window far in the past, so settleDue must settle it and no real
  // board can be touched. Cleaned up unconditionally below.
  const KEY = '2019-03-04';
  await page.evaluateOnNewDocument((u) => {
    localStorage.setItem('favorUid', u);
    localStorage.setItem('favorName', 'Crown Claimant');
  }, H_UID);
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });

  const crown = await page.evaluate(async ({ key, h, p }) => {
    const db = firebase.database();
    await db.ref(`favor/settled/${key}`).remove();
    // The persona posts the HIGHEST score of the window. If it were eligible
    // it would take gold outright.
    await db.ref(`favor/daily/${key}/scores/${p}`).set({ name: 'Audit Persona', best: 9999, at: 1, persona: true });
    // ⚠ TEST RESIDUE, scoring between the persona and the human. On
    // 2026-07-18 six leftover 'Audit Herald' rows outranked every real player
    // but two and settleDue paid one of them BRONZE — a crown and 10 Stars
    // taken from a human. The boards had always filtered these by name;
    // settlement had not.
    await db.ref(`favor/daily/${key}/scores/uauditresidue1`).set({ name: 'Audit Herald', best: 5000, at: 1 });
    await db.ref(`favor/daily/${key}/scores/${h}`).set({ name: 'Crown Claimant', best: 12, at: 2 });
    // A REAL player whose NAME merely looks test-ish must still be crowned.
    // The filter is uid-based on purpose: TEST_NAMES matches `audit .*`, so
    // a name rule would permanently and invisibly bar someone called
    // "Audit Trail" from ever winning. Ordinary uid => eligible.
    await db.ref(`favor/daily/${key}/scores/uqarealname1`).set({ name: 'Audit Trail', best: 8, at: 3 });
    await FLB.settleDue();
    const settled = (await db.ref(`favor/settled/${key}`).get()).val() || {};
    const prow = (await db.ref(`favor/players/${p}`).get()).val() || {};
    const hrow = (await db.ref(`favor/players/${h}`).get()).val() || {};
    return {
      podium: (settled.podium || []).map(x => x.uid),
      podiumNames: (settled.podium || []).map(x => x.name),
      topName: (settled.podium || [])[0] ? settled.podium[0].name : null,
      personaStars: prow.stars === undefined ? null : prow.stars,
      personaChamps: prow.champs || null,
      personaMsgs: prow.msgQueue ? Object.keys(prow.msgQueue).length : 0,
      humanStars: hrow.stars === undefined ? null : hrow.stars,
      humanGold: ((hrow.champs || {}).gold) || 0,
    };
  }, { key: KEY, h: H_UID, p: P_UID });

  ok(!crown.podium.includes(P_UID),
    `the persona is filtered OUT of the podium despite the top score (podium: ${crown.podium.length})`);
  ok(!crown.podiumNames.some(n => /audit herald/i.test(n || '')),
    `and so is TEST RESIDUE by UID, which really did steal a human's bronze on 7/18 (${crown.podiumNames.join(', ')})`);
  ok(crown.podiumNames.includes('Audit Trail'),
    'but a REAL player merely NAMED like a test row is still crowned — the filter is uid-based, never name-based');
  ok(crown.podium.includes(H_UID) && crown.topName === 'Crown Claimant',
    `and the crown goes to the human below them (${crown.topName})`);
  ok(crown.personaStars === null && !crown.personaChamps,
    'a persona takes no Stars and accrues no champs crowns');
  ok(crown.personaMsgs === 0,
    'and no royal overlay is queued on a row that will never log in');
  ok(crown.humanGold === 1 && crown.humanStars > 0,
    `the human really was paid — gold crown ${crown.humanGold}, stars ${crown.humanStars}`);

  const swept = await page.evaluate(async ({ key, h, p }) => {
    const db = firebase.database();
    await db.ref(`favor/daily/${key}`).remove();
    await db.ref('favor/players/uauditresidue1').remove();
    await db.ref('favor/players/uqarealname1').remove();
    await db.ref(`favor/settled/${key}`).remove();
    await db.ref(`favor/players/${h}`).remove();
    await db.ref(`favor/players/${p}`).remove();
    await new Promise(r => setTimeout(r, 400));
    return !(await db.ref(`favor/daily/${key}`).get()).exists()
      && !(await db.ref(`favor/players/${h}`).get()).exists();
  }, { key: KEY, h: H_UID, p: P_UID });
  ok(swept, 'the fabricated window and both audit rows are swept');
  await page.close();
}

// ── Beat 2: the human is #1 — the chooser holds the stage until a pick. ──
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('boon: ' + m.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  // topRow = MY uid → the human chooser path; built in-page so the uid
  // always matches whatever the profile carries. Never posted, no scrub.
  await page.evaluate(() => {
    window.shuffleArray = (a) => [...a];
    window._mpSkipQueue = true;   // real seed path, no live queue
    localStorage.setItem('favorQueue', '3');
    FLB.tableSeed = async () => ({
      myRow: { uid: FLB.uid(), rating: 300 },
      topRow: { uid: FLB.uid(), name: 'Me', score: 300 },
      personas: [],
    });
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
  await page.evaluate(() => document.getElementById('confirmBtn').click());

  await page.waitForFunction(() => document.getElementById('promisePicker')
    && document.getElementById('promisePicker').classList.contains('active')
    && document.querySelectorAll('.boon-tile').length === 6, { timeout: 20000 });
  ok(true, 'human #1: the boon chooser takes the stage at game start');
  await page.screenshot({ path: join(SHOTS, 'boon-chooser.png') });

  // No dismiss-without-pick: Escape and backdrop clicks change nothing.
  await page.keyboard.press('Escape');
  await page.mouse.click(8, 892);
  await sleep(300);
  const held = await page.evaluate(() => ({
    active: document.getElementById('promisePicker').classList.contains('active'),
    emblem: game.emblemHolder,
    log: document.getElementById('logEntries').innerText,
  }));
  ok(held.active, 'chooser survives Escape + backdrop clicks (the Queen does not offer twice)');
  ok(held.emblem === 0, `sole rated player holds the Emblem (seat ${held.emblem})`);
  ok(held.log.includes('You hold the Emblem'), 'your Act-1 seat announced in the log');

  const before = await page.evaluate(() => game.players[0].skills.knowledge || 0);
  await page.evaluate(() => {
    document.querySelector('.boon-tile[data-skill="knowledge"]').click();
  });
  await sleep(150);
  await page.evaluate(() => document.getElementById('boonConfirm').click());
  await page.waitForFunction(() => !document.getElementById('promisePicker').classList.contains('active'), { timeout: 8000 });

  const claimed = await page.evaluate((prev) => {
    const p = game.players[0];
    const row = [...document.querySelectorAll('#statsPanel .skill-row')]
      .find(r => (r.textContent || '').includes('Knowledge'));
    const shown = row ? parseInt((row.querySelector('.skill-value') || {}).textContent, 10) : -1;
    // The boon must COUNT: 2 more knowledge (rigged as mission rewards)
    // makes 3 — 'A Day With the Birds' needs exactly 3. Pure probe.
    const birds = FAVOR_DATA.missions.find(m => m.name === 'A Day With the Birds');
    const shortBefore = game.probeMissionRequirements(0, { ...birds }).success;
    p.bonusSkills.knowledge += 2;
    game.applySlotSkills(p);
    const passesNow = game.probeMissionRequirements(0, { ...birds }).success;
    return {
      skill: p.skills.knowledge - 2,   // minus the rig → boon's own effect
      bonus: (p.bonusSkills || {}).knowledge,
      shown, shortBefore, passesNow,
    };
  }, before);
  ok(claimed.skill === before + 1, `+1 Knowledge landed (${before} → ${claimed.skill})`);
  ok(claimed.bonus === 3 && claimed.shown === before + 1,
    `stats panel shows the boon (${claimed.shown})`);
  ok(!claimed.shortBefore && claimed.passesNow,
    'a 3-Knowledge mission passes WITH the boon in the sum (fails without the rig)');
  await page.screenshot({ path: join(SHOTS, 'boon-claimed.png') });
  await page.close();
}

// ── Beat 3: rated but NOT #1 — no chooser, ever. ──
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('no-boon: ' + m.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  await startSeeded(page, {
    myRow: { uid: 'whoever', rating: 50 },
    topRow: { uid: 'uauditghost_not_seated', name: 'Absent King', score: 999 },
    personas: [],
  });
  await page.waitForFunction(() => typeof game !== 'undefined' && game
    && game.players.length === 3 && game.players[0].character, { timeout: 20000 });
  await sleep(900);
  const quiet = await page.evaluate(() => ({
    picker: document.getElementById('promisePicker').classList.contains('active'),
    bonus: Object.keys(game.players[0].bonusSkills || {}).length,
    emblem: game.emblemHolder,
  }));
  ok(!quiet.picker, 'non-#1 never sees the chooser');
  ok(quiet.bonus === 0, 'and receives no boon');
  ok(quiet.emblem === 0, `sole rated seat still takes the Emblem (seat ${quiet.emblem})`);
  await page.close();
}

// ═══ COMMIT-FIRST: pledge at Play Now, sticky offer, no re-roll ═══
console.log('── Commit-first: Play pledges, the offer sticks, backing out re-rolls nothing');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('pledge: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await page.evaluate(() => {
    window._mpSkipQueue = true;             // this flow proves offer stickiness, not the wire
    localStorage.removeItem('favorOffer');  // fresh pledge
    localStorage.setItem('favorQueue', '3');
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card')?.offsetParent, { timeout: 20000 });
  const first = await page.evaluate(() => ({
    ids: [...document.querySelectorAll('.character-card')].map(c => c.dataset.id).sort().join(','),
    back: !!document.getElementById('qpBack'),
    stored: !!localStorage.getItem('favorOffer'),
  }));
  ok(first.back, 'solo path keeps a way home (Return to the Menu)');
  ok(first.stored, 'the offer is written at the pledge');

  // Back out, Play again — the SAME three heroes (nothing to re-roll for).
  await page.evaluate(() => document.getElementById('qpBack').click());
  await page.waitForFunction(() => {
    const t = document.getElementById('title-screen');
    return t && !t.classList.contains('hidden') && t.style.display !== 'none';
  }, { timeout: 6000 });
  ok(true, 'Return to the Menu lands back on the title screen');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card')?.offsetParent, { timeout: 20000 });
  const second = await page.evaluate(() =>
    [...document.querySelectorAll('.character-card')].map(c => c.dataset.id).sort().join(','));
  ok(second === first.ids, `the offer STUCK across the retry (${second})`);

  // Beginning a real table consumes the pledge — the next Play re-rolls.
  await page.evaluate(() => {
    selectedCharacter = document.querySelector('.character-card').dataset.id;
    document.querySelector('.character-card').classList.add('selected');
    document.getElementById('confirmBtn').style.display = 'inline-block';
    window._pinEmblemSeed = 0;   // fast classic table for the consume check
  });
  await page.evaluate(() => document.getElementById('confirmBtn').click());
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 20000 });
  ok(await page.evaluate(() => !localStorage.getItem('favorOffer')),
    'starting the table consumes the sticky offer');
  await page.close();
}

// ═══ MULTIPLAYER — background queue, MATCH FOUND ring, timed pick,
//     real 2-client accept handshake, lockstep, AFK boot ═══
// Two ISOLATED browser contexts play each other through the real Firebase
// queue. Timers are shrunk via FMP._T so the whole story runs in seconds.
console.log('── Multiplayer: queue chip, MATCH FOUND, timed pick, 2-client handshake, AFK boot');
{
  // Leave no stale matchmaking state behind OR in front.
  const purgeMp = async (pg) => pg.evaluate(async () => {
    await firebase.database().ref('favor/mp/queue').remove();
    return true;
  });

  // ── Beat 1: the SOLO theater — Play Now queues in the background (the
  //    menu stays), the chip rides the leaderboard AND the store, the
  //    window expires into the MATCH FOUND ring over whatever's open.
  //    Decline goes home free; a lapse gets the quiet toast; Accept opens
  //    the 20s pick and 0:00 auto-picks the ringed hero into a table. ──
  {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push('mp-solo: ' + m.text()); });
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(URL, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
    await purgeMp(page);
    const clickPlay = () => page.evaluate(() => {
      const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
        .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
      b.click();
    });
    const chipOn = () => page.waitForFunction(() => {
      const c = document.getElementById('queueChip');
      return c && c.classList.contains('on');
    }, { timeout: 8000 });
    const popupOn = (t = 12000) => page.waitForFunction(() => {
      const m = document.getElementById('matchFound');
      return m && m.classList.contains('on');
    }, { timeout: t });
    // Real hit-testing (synthetic clicks bypass stacking): the point at the
    // chip's center must actually BE the chip, panels open or not.
    const chipHit = () => page.evaluate(() => {
      const c = document.getElementById('queueChip');
      if (!c) return false;
      const r = c.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!(el && el.closest('#queueChip'));
    });

    // 1a — Play Now queues in the BACKGROUND: menu keeps the stage.
    await page.evaluate(() => {
      window.shuffleArray = (a) => [...a];
      localStorage.setItem('favorQueue', '3');
      FMP._T.windowMin = 30000; FMP._T.windowSpread = 1;   // no expiry during the chip beats
    });
    await clickPlay();
    await chipOn();
    const bg = await page.evaluate(() => ({
      titleUp: !document.getElementById('title-screen').classList.contains('hidden'),
      selectUp: document.getElementById('character-select').classList.contains('active'),
    }));
    ok(bg.titleUp && !bg.selectUp, 'Play Now returns the MENU (queue rides in the background)');
    ok(await page.evaluate(async () =>
      !!(await firebase.database().ref('favor/mp/queue/3').get()).val()),
      'the queue entry was written at Play Now — before any hero was seen');
    ok(await chipHit(), 'the queue chip (timer + Withdraw) is up and truly on top');

    // 1b — Withdraw is honest: chip gone, entry gone, still home.
    await page.evaluate(() => document.getElementById('qcWithdraw').click());
    await page.waitForFunction(() => !document.getElementById('queueChip').classList.contains('on'), { timeout: 6000 });
    ok(await page.evaluate(async () =>
      !(await firebase.database().ref('favor/mp/queue/3').get()).exists()),
      'Withdraw removes the entry — no ghost seat left behind');

    // 1c — the chip persists across the Leaderboard AND the Store, and the
    // MATCH FOUND ring lands over the open store.
    await page.evaluate(() => { FMP._T.windowMin = 4500; FMP._T.windowSpread = 1; });
    await clickPlay();
    await chipOn();
    await page.evaluate(() => FLB.openLeaderboard());
    await sleep(450);
    ok(await chipHit(), 'chip stays visible (and hit-testable) OVER the leaderboard');
    await page.evaluate(() => { FLB.closeLeaderboard(); FLB.openStore(); });
    await sleep(450);
    ok(await chipHit(), 'chip stays visible OVER the store');
    await page.screenshot({ path: join(SHOTS, 'queue-chip-store.png') });
    await popupOn();
    await sleep(600);   // let the ring's landing animation finish — shots mid-flight read as "dimmed"
    const mfLook = await page.evaluate(() => {
      const mf = document.getElementById('matchFound');
      const mid = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return {
        court: /Match Found/i.test(mf.textContent) && /3 Players/.test(mf.textContent),
        buttons: !!(document.getElementById('mfAccept') && document.getElementById('mfDecline')),
        onTop: !!(mid && mid.closest('#matchFound')),
        storeStill: document.getElementById('storePanel').classList.contains('active'),
        chipYielded: !document.getElementById('queueChip').classList.contains('on'),
      };
    });
    ok(mfLook.court && mfLook.buttons, 'MATCH FOUND ring: "Match Found" copy + READY/DECLINE');
    ok(mfLook.onTop && mfLook.storeStill, 'the ring lands OVER the open store (root stacking)');
    ok(mfLook.chipYielded, 'the chip yields the stage to the ring');
    await page.screenshot({ path: join(SHOTS, 'queue-matchfound-store.png') });
    ok(await page.evaluate(async () =>
      !(await firebase.database().ref('favor/mp/queue/3').get()).exists()),
      'the solo window leaves the queue the moment the ring shows');

    // Decline: home free, no penalty, store untouched beneath.
    await page.evaluate(() => document.getElementById('mfDecline').click());
    await page.waitForFunction(() => !document.getElementById('matchFound').classList.contains('on'), { timeout: 6000 });
    const afterDecline = await page.evaluate(() => ({
      chip: document.getElementById('queueChip').classList.contains('on'),
      store: document.getElementById('storePanel').classList.contains('active'),
      game: typeof game !== 'undefined' && !!game,
    }));
    ok(!afterDecline.chip && !afterDecline.game, 'Decline = out of the queue, back to browsing, no table');
    ok(afterDecline.store, 'the store never flinched');
    await page.evaluate(() => FLB.closeStore());

    // 1d — a LAPSE is a decline with an apology.
    await page.evaluate(() => { FMP._T.windowMin = 1200; FMP._T.accept = 900; });
    await clickPlay();
    await popupOn(9000);
    await page.waitForFunction(() => !document.getElementById('matchFound').classList.contains('on'), { timeout: 6000 });
    ok(await page.evaluate(() =>
      /moved on without you/i.test(document.getElementById('notifications').textContent)),
      'the lapse toast: "The table moved on without you."');
    ok(await page.evaluate(() => !document.getElementById('queueChip').classList.contains('on')),
      'and the lapse leaves the queue (chip gone)');

    // 1e — ACCEPT → the 20-second pick (shrunk): clock in the ribbon, the
    // ringed CENTER hero pre-highlighted, no way back; 0:00 auto-picks and
    // the table forms (the fill presents as people — Wyatt's pattern).
    await page.evaluate(() => { FMP._T.windowMin = 1200; FMP._T.accept = 10000; FMP._T.pick = 2600; });
    await clickPlay();
    await popupOn(9000);
    await page.evaluate(() => document.getElementById('mfAccept').click());
    await page.waitForFunction(() =>
      document.getElementById('character-select').classList.contains('active')
      && !!document.getElementById('pickClock'), { timeout: 8000 });
    // Robot-speed accepts land here while the chip's 0.3s fade-out (begun
    // at the ring) is still in flight — settle so the shot shows the truth
    // a human sees, and the hero paintings finish decoding.
    await sleep(500);
    const pickLook = await page.evaluate(() => ({
      preselected: (document.querySelector('.character-card.selected') || {}).dataset?.id || null,
      centerId: FAVOR_DATA.characters[1].id,
      begin: document.getElementById('confirmBtn').offsetParent !== null,
      noBack: !document.getElementById('qpBack'),
      clock: document.getElementById('pickClock').textContent,
    }));
    ok(pickLook.preselected === pickLook.centerId,
      `the ringed center hero is pre-highlighted (${pickLook.preselected})`);
    ok(pickLook.begin && pickLook.noBack, 'Begin is armed and there is NO way back (v1)');
    ok(/^0:\d\d$/.test(pickLook.clock), `the pick clock ticks in the ribbon (${pickLook.clock})`);
    await page.screenshot({ path: join(SHOTS, 'queue-pick-clock.png') });
    // Touch nothing — 0:00 must throw you in with the ringed hero.
    await page.waitForFunction(() => typeof game !== 'undefined' && game
      && game.players.length === 3 && game.players[0].character, { timeout: 15000 });
    const solo = await page.evaluate(() => ({
      active: FMP.active(),
      hero: game.players[0].character.id,
      centerId: FAVOR_DATA.characters[1].id,
      rivals: game.players.slice(1).map(p => p.name),
      offerLeft: !!localStorage.getItem('favorOffer'),
    }));
    ok(!solo.active, 'solo theater → NOT a network game');
    ok(solo.hero === solo.centerId, `auto-pick took the ringed hero (${solo.hero})`);
    ok(solo.rivals.length === 2 && solo.rivals.every(n => n && n !== 'You'),
      `the fake humans fill the table (${solo.rivals.join(' & ')})`);
    ok(!solo.offerLeft, 'the sticky offer is consumed by the real table');
    await page.close();
  }

  // ── Beats 2-4: a REAL match between two isolated clients. ──
  // A crash here (Chrome bogging down 40 minutes in, Firebase latency)
  // must cost ONE failed check, never the whole run's tally.
  try {
    const mkContext = async () => (browser.createBrowserContext
      ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
    const ctxA = await mkContext();
    const ctxB = await mkContext();
    const A_UID = 'uauditmpa' + Math.random().toString(36).slice(2, 6);
    const B_UID = 'uauditmpb' + Math.random().toString(36).slice(2, 6);

    const boot = async (ctx, uid, name, extra) => {
      const pg = await ctx.newPage();
      pg.on('console', m => { if (m.type() === 'error') consoleErrors.push(`mp-${name}: ` + m.text()); });
      pg.on('pageerror', e => consoleErrors.push(`mp-${name} pageerror: ` + e.message));
      await pg.evaluateOnNewDocument((u, n) => {
        localStorage.setItem('favorUid', u);
        localStorage.setItem('favorName', n);
        localStorage.setItem('favorQueue', '3');
      }, uid, name);
      await pg.setViewport({ width: 1280, height: 800 });
      await pg.goto(URL, { waitUntil: 'networkidle2' });
      await pg.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
      await pg.evaluate((cfg) => {
        window.shuffleArray = (a) => [...a];
        window.CINEMATIC_SPEED = 0.05;      // fast spotlights for the audit
        FMP._T.windowMin = 30000;           // never fall solo mid-beat
        FMP._T.windowSpread = 1;
        Object.assign(FMP._T, cfg || {});
        const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
          .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
        b.click();
      }, extra || {});
      // Queued = the chip is up; the menu keeps the stage (background queue).
      await pg.waitForFunction(() => {
        const c = document.getElementById('queueChip');
        return c && c.classList.contains('on');
      }, { timeout: 12000 });
      return pg;
    };
    const ringOn = (pg, t = 25000) => pg.waitForFunction(() => {
      const m = document.getElementById('matchFound');
      return m && m.classList.contains('on');
    }, { timeout: t });
    const acceptRing = (pg) => pg.evaluate(() => document.getElementById('mfAccept').click());
    const onPickScreen = (pg) => pg.waitForFunction(() =>
      document.getElementById('character-select').classList.contains('active')
      && !!document.getElementById('pickClock'), { timeout: 15000 });
    const pickAndBegin = (pg, idx) => pg.evaluate((i) => {
      const c = [...document.querySelectorAll('#characterGrid .character-card')];
      selectCharacter(c[i].dataset.id, c[i]);
      document.getElementById('confirmBtn').click();
    }, idx);

    // A queues first (earliest entry — A hosts). The AFK clock stays at
    // its real 2 minutes through the handshake and beat 3: the throw
    // collector arms it at ROUND start now, so a shrunk clock would boot
    // B while the suite is still reading the sealed table. Beat 4 shrinks
    // it live, right before B goes silent.
    const pA = await boot(ctxA, A_UID, 'Audit MpA', {});
    await sleep(900);
    const pB = await boot(ctxB, B_UID, 'Audit MpB', {});
    pB.on('pageerror', e => { pB.evaluate((m) => { (window.__bErrs = window.__bErrs || []).push(m); }, 'PAGEERROR: ' + e.message).catch(() => {}); });
    pB.on('console', m => { if (m.type() === 'error') { const t = m.text(); pB.evaluate((x) => { (window.__bErrs = window.__bErrs || []).push(x); }, t).catch(() => {}); } });

    // ── Beat 2a: the proposal reaches BOTH clients as a MATCH FOUND ring. ──
    await Promise.all([ringOn(pA), ringOn(pB)]);
    ok(true, 'two queued clients — the proposal rings BOTH');

    // ── Beat 2b: B declines. A requeues KEEPING its elapsed priority; B is
    //    out with no penalty. ──
    await pB.evaluate(() => document.getElementById('mfDecline').click());
    await pA.waitForFunction(() =>
      !document.getElementById('matchFound').classList.contains('on')
      && document.getElementById('queueChip').classList.contains('on'), { timeout: 15000 });
    ok(true, "B's decline sinks the table — A is re-queued (ring down, chip back)");
    ok(await pA.evaluate(() =>
      /declined/i.test((document.getElementById('qcSub') || {}).textContent || '')),
      "A's chip says why: a noble declined, the search continues");
    const aEntry = await pA.evaluate(async (u) =>
      (await firebase.database().ref('favor/mp/queue/3/' + u).get()).val(), A_UID);
    ok(!!aEntry && !aEntry.gameId, "A's entry SURVIVED the abort, untagged (priority kept)");
    await pB.waitForFunction(() => !document.getElementById('matchFound').classList.contains('on'), { timeout: 8000 });
    ok(await pB.evaluate(async (u) =>
      !(await firebase.database().ref('favor/mp/queue/3/' + u).get()).exists(), B_UID),
      "B's entry is gone — declined out of the queue, no penalty");
    ok(await pB.evaluate(() => !document.getElementById('queueChip').classList.contains('on')
      && !document.getElementById('title-screen').classList.contains('hidden')),
      'B is back on the plain menu');

    // ── Beat 2c: B re-enters; A (older entry) hosts the second proposal;
    //    both ACCEPT → both land on the 20s pick → picks seal → LIVE. ──
    await pB.evaluate(() => startGame());
    await Promise.all([ringOn(pA), ringOn(pB)]);
    ok(true, 'B re-queues and the second table rings both');
    await Promise.all([acceptRing(pA), acceptRing(pB)]);
    await Promise.all([onPickScreen(pA), onPickScreen(pB)]);
    ok(true, 'both accepts land on the Choose Your Hero clock');
    await pA.screenshot({ path: join(SHOTS, 'mp-pick-hostA.png') });
    await Promise.all([pickAndBegin(pA, 0), pickAndBegin(pB, 2)]);

    const inGame = (pg) => pg.waitForFunction(() => typeof game !== 'undefined' && game
      && game.players.length === 3 && game.players[0].character && FMP.active(), { timeout: 25000 });
    await Promise.all([inGame(pA), inGame(pB)]);
    ok(true, 'all accepted + picked → the sealed table goes live on both clients');

    const stateOf = (pg) => pg.evaluate(() => ({
      seat: FMP.mySeat(),
      host: FMP.isHost(),
      seed: FMP.record().seed,
      hero: game.players[0].character.id,
      hero0: FAVOR_DATA.characters[0].id,
      hero2: FAVOR_DATA.characters[2].id,
      names: game.players.map(p => p.name),
      handsCanon: [0, 1, 2].map(cs =>
        game.players[FMP.localIdx(cs)].hand.map(c => c.id).join(',')).join(';'),
      emblemCanon: FMP.canonSeat(game.emblemHolder),
      hash: mpStateHash(),
    }));
    const sA = await stateOf(pA), sB = await stateOf(pB);
    ok(sA.host && !sB.host && sA.seat === 0 && sB.seat === 1,
      `the SURVIVOR's older entry hosts (A seat ${sA.seat}, B seat ${sB.seat})`);
    ok(sA.hero === sA.hero0 && sB.hero === sB.hero2,
      `each client got ITS OWN pick (A ${sA.hero}, B ${sB.hero})`);
    ok(sA.seed === sB.seed, 'both clients build from one seed');
    ok(sA.names.includes('Audit MpB') && sB.names.includes('Audit MpA'),
      'each client sees the other by name at the table');
    ok(sA.handsCanon === sB.handsCanon,
      'LOCKSTEP: every hand identical across clients (canonical order)');
    ok(sA.emblemCanon === sB.emblemCanon, `Emblem agrees across clients (canonical seat ${sA.emblemCanon})`);
    await pA.screenshot({ path: join(SHOTS, 'mp-match-hostA.png') });
    await pB.screenshot({ path: join(SHOTS, 'mp-match-clientB.png') });

    // ── Beat 3: one full lockstep round — both THROW, the stream locks the
    //    table on both clients, and each answers its reveal with a discard. ──
    await pA.evaluate(() => throwCard(0));
    await sleep(250);
    await pB.evaluate(() => throwCard(0));
    const answerDiscard = async (pg) => {
      await pg.waitForFunction(() => window._finalChoicePending === true, { timeout: 30000 });
      await pg.evaluate(() => {
        const b = [...document.querySelectorAll('#actionPanel .action-btn')]
          .find(x => /discard \(\+3g\)/i.test(x.textContent) && !x.disabled);
        if (b) b.click();
      });
    };
    await Promise.all([answerDiscard(pA), answerDiscard(pB)]);
    // Next round's bots pick the instant finishRound hands over, so the
    // all-pendings-null state is transient — gate on YOUR seat + the hand.
    const roundDone = (pg) => pg.waitForFunction(() => game.phase === 'gameplay'
      && game.pendingActivations[0] === null
      && game.players[0].hand.length === 6, { timeout: 30000 }).then(() => true, () => false);
    const [rdA, rdB] = await Promise.all([roundDone(pA), roundDone(pB)]);
    ok(rdA && rdB, `both clients finish the round (A ${rdA}, B ${rdB})`);
    const hA = await pA.evaluate(() => mpStateHash());
    const hB = await pB.evaluate(() => mpStateHash());
    ok(hA === hB, `LOCKSTEP: state hashes agree after a full round (${hA} vs ${hB})`);
    const bLog = await pB.evaluate(() => document.getElementById('logEntries').innerText);
    ok(/Audit MpA (discards|plays)/.test(bLog), "B's log narrates A's move (stream applied)");

    // ── Beat 4: A throws, B goes silent — the 2-minute boot (shrunk to
    //    4.5s NOW; the collector's clock reads it live) converts B's seat
    //    to AI everywhere and kicks B out. ──
    await pA.evaluate(() => { FMP._T.afk = 4500; });
    await pA.evaluate(() => throwCard(0));
    const booted = await pA.waitForFunction(() =>
      game.players[1] && game.players[1]._remoteHuman === false, { timeout: 20000 })
      .then(() => true, () => false);
    ok(booted, "host's AFK clock boots the silent seat (remote → AI)");
    // The boot unblocks the lock; A's own reveal still asks.
    await answerDiscard(pA);
    const round2 = await pA.waitForFunction(() => game.phase === 'gameplay'
      && game.pendingActivations[0] === null
      && game.players[0].hand.length === 5, { timeout: 30000 })
      .then(() => true, () => false);
    const aLog = await pA.evaluate(() => document.getElementById('logEntries').innerText);
    ok(round2, 'the table plays on with the AI in the empty seat');
    ok(/removed for inactivity/i.test(aLog), 'the boot is announced at the table');
    // 30s, not 15: B is waiting on an afk_boot BROADCAST to round-trip through
    // Firebase, and by this point the suite is deep into a long browser run with
    // two live MP matches behind it. The assertion is unchanged — B must still be
    // told and sent back to the menu — this is only patience. A tight window here
    // flaked 3 runs in 5 on unrelated commits, with no error on B and the seat
    // still in the match: it simply had not heard yet.
    const bBooted = await pB.waitForFunction(() =>
      document.getElementById('champOverlay').classList.contains('active')
      && /Removed for Inactivity/i.test(document.getElementById('champTitle').textContent),
      { timeout: 30000 }).then(() => true, () => false);
    if (!bBooted) {
      const diag = await pB.evaluate(() => ({
        errs: (window.__bErrs || []).slice(0, 5),
        mpActive: typeof mpActive === 'function' ? mpActive() : 'n/a',
        ovClass: document.getElementById('champOverlay').className,
        title: document.getElementById('champTitle').textContent,
      })).catch(e => ({ evalFailed: e.message }));
      console.log('    [diag B]', JSON.stringify(diag));
    }
    ok(bBooted, 'the booted player is told and returned to the menu path');
    await pB.screenshot({ path: join(SHOTS, 'mp-afk-booted.png') });

    // ── Leave no trace: THIS game, any prior crashed run's orphans, and
    //    the queue — then prove nothing uaudit remains. ──
    const swept = await pA.evaluate(async () => {
      const gid = FMP.gid();
      if (gid) await firebase.database().ref(`favor/mp/games/${gid}`).remove();
      await firebase.database().ref('favor/mp/queue').remove();
      const games = (await firebase.database().ref('favor/mp/games').get()).val() || {};
      for (const [id, rec] of Object.entries(games)) {
        if ((rec.roster || []).some(r => r.uid && r.uid.startsWith('uaudit'))) {
          await firebase.database().ref(`favor/mp/games/${id}`).remove();
        }
      }
      const after = (await firebase.database().ref('favor/mp/games').get()).val() || {};
      const stray = Object.values(after).some(rec =>
        (rec.roster || []).some(r => r.uid && r.uid.startsWith('uaudit')));
      return { stray };
    });
    ok(!swept.stray, 'favor/mp swept clean of audit uids');
    await pA.close(); await pB.close();
    await ctxA.close(); await ctxB.close();
  } catch (e) {
    ok(false, 'MP match story crashed — treat as latency-first, rerun', e.message.slice(0, 160));
  }
}

// ═══ ACHIEVEMENTS: grant → celebration → gallery ════════════════════════
// The DB layer is STUBBED for this flow. FACH.sync() writes to players/{uid},
// and the real board must never carry an audit account's achievements — the
// scrubs would have to chase yet another node. Stubbing readRow/mergeRow keeps
// the whole flow on the client while still driving the real UI.
{
  console.log('── Achievements: unlock celebration + gallery');
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('achievements: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FACH && window.FLB, { timeout: 20000 });

  // NOTE: fire sync with BRACES — do NOT await it. FACH.sync() awaits its own
  // celebration overlay, which only resolves on a click, so awaiting it here
  // deadlocks the CDP protocol and kills the whole suite (learned the hard way).
  await page.evaluate(() => {
    // Stub the row: nothing earned yet, nine heroes already beaten.
    window._achRow = { stars: 0, achievements: {}, charWins: {
      explorer: true, knight: true, bandit: true, merchant: true, fisherman: true,
      duchess: true, scientist: true, doctor: true, fiddler: true,
    }, champs: {} };
    window.FLB.readRow = async () => JSON.parse(JSON.stringify(window._achRow));
    window.FLB.mergeRow = async (fn) => {
      window._achRow = fn(window._achRow);
      return { committed: true, value: window._achRow };
    };
    // Beat the tenth hero: The Magician's Victory AND The Master, together.
    window.FACH.sync({ won: true, characterId: 'magician', peakPower: 0,
                       peakGold: 0, potionsPlayed: 0, foretoldDoom: false });
  });

  // The celebration is on screen and NAMES the achievement.
  await page.waitForSelector('.ach-pop.in .ach-card', { timeout: 8000 });
  const wrote = await page.evaluate(() => ({
    ids: Object.keys(window._achRow.achievements), stars: window._achRow.stars,
  }));
  ok(wrote.ids.includes('win_magician') && wrote.ids.includes('master_of_all'),
    'the 10th win grants that victory AND The Master', wrote.ids.join(','));
  ok(wrote.stars === 220, `and pays 20★ + 200★ = ${wrote.stars}★ into the store purse`);
  const pop = await page.evaluate(() => {
    const c = document.querySelector('.ach-pop .ach-card');
    return {
      name: c.querySelector('.ach-name').textContent,
      stars: c.querySelector('.ach-stars').textContent.trim(),
      tier: c.querySelector('.ach-tier').textContent.trim(),
      legendary: c.classList.contains('ach-legendary'),
    };
  });
  ok(/Victory|Master/.test(pop.name), `the celebration names it ("${pop.name}")`);
  ok(/\d+/.test(pop.stars), `and shows its Stars ("${pop.stars}")`);
  await page.screenshot({ path: join(SHOTS, 'achievement-unlock.png') });

  // Claim dismisses it (and the second one queues behind — sequential, never stacked).
  const stacked = await page.evaluate(() => document.querySelectorAll('.ach-pop').length);
  ok(stacked === 1, 'only ONE celebration on screen at a time (they queue)', String(stacked));
  // Claim the first; the second (The Master) queues in behind it.
  await page.evaluate(() => document.querySelector('.ach-ok').click());
  await page.waitForFunction(
    () => document.querySelectorAll('.ach-pop').length === 1
       && /Master/.test(document.querySelector('.ach-pop .ach-name').textContent),
    { timeout: 8000 });
  ok(true, 'and the second celebration follows it, one at a time');
  await page.evaluate(() => document.querySelector('.ach-ok').click());
  await page.waitForFunction(() => document.querySelectorAll('.ach-pop').length === 0,
    { timeout: 8000 });

  // Gallery: 17 cells, the secret still masked.
  await page.evaluate(() => window.FACH.openGallery());
  await page.waitForSelector('#achGallery.open .ach-cell', { timeout: 8000 });
  const gal = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#achGallery .ach-cell')];
    const secret = document.querySelector('#achGallery .ach-cell.secret');
    return {
      count: cells.length,
      got: cells.filter(c => c.classList.contains('got')).length,
      secretMasked: secret ? secret.querySelector('b').textContent : '(none)',
      sub: document.querySelector('#achGallery .ach-sub').textContent,
    };
  });
  ok(gal.count === 24, `the gallery lists all 24 achievements (${gal.count})`);
  ok(gal.got === 2, `and marks the 2 just earned as unlocked (${gal.got})`);
  ok(gal.secretMasked === '???', `the SECRET stays hidden until it fires ("${gal.secretMasked}")`);
  await page.screenshot({ path: join(SHOTS, 'achievement-gallery.png') });

  await page.evaluate(() => window.FACH.closeGallery());
  await page.close();
}

// ═══ HELD MISSION: the act boundary ASKS — attempt now, or hold ═════════
// Wanted: Crazy Lou activates in Act 1 but is only forced at the end of Act 3.
// It must offer the choice at every boundary until then, and holding must never
// auto-fail it.
{
  console.log('── Held mission: Act 1 boundary offers Attempt / Hold, and Hold carries it');
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('held-mission: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('held-mission pageerror: ' + e.message));
  await page.setViewport({ width: 1420, height: 850 });
  await startGame(page);

  await page.evaluate(() => {
    const p = game.players[0];
    const pick = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    // Crazy Lou: 15 Power, activates Act 1, due Act 3. Nowhere near met.
    p.missions = [{ ...FAVOR_DATA.missions.find(m => m.name === 'Wanted: Crazy Lou') }];
    p.gold = 10;
    p.hand = [pick('First Aid')];
    for (let i = 1; i < game.playerCount; i++) game.players[i].hand = [pick('First Aid')];
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
  });
  await sleep(300);
  await throwAndAwaitChoice(page, 0);
  await answerChoice(page, /discard \(\+3g\)/);

  const asked = await page.waitForFunction(() =>
    document.getElementById('promisePicker').classList.contains('active') &&
    /Crazy Lou/i.test(document.getElementById('promisePicker').textContent) &&
    document.getElementById('emHold'), { timeout: 18000 }).then(() => true, () => false);
  ok(asked, 'the Act 1 boundary ASKS about the held mission (it is not silently skipped)');

  const copy = await page.evaluate(() => {
    const ov = document.getElementById('promisePicker');
    return {
      sub: ov.querySelector('.pp-sub').textContent,
      attempt: ov.querySelector('#emAttempt').textContent.trim(),
      hold: ov.querySelector('#emHold').textContent.trim(),
    };
  });
  ok(/Act 3/.test(copy.sub), `it names the due act ("${copy.sub.slice(0, 60)}...")`);
  ok(/FAIL/i.test(copy.attempt), `and tells the truth: "${copy.attempt}"`);
  ok(/Hold until Act 3/i.test(copy.hold), `and offers "${copy.hold}"`);
  await page.screenshot({ path: join(SHOTS, 'held-mission-choice.png') });

  // HOLD it — it must survive into Act 2, unfailed.
  await page.evaluate(() => document.getElementById('emHold').click());
  const survived = await page.waitForFunction(() =>
    game.players[0].missions.some(m => m.name === 'Wanted: Crazy Lou')
    && !game.players[0].failedMissions.some(m => m.name === 'Wanted: Crazy Lou'),
    { timeout: 15000 }).then(() => true, () => false);
  ok(survived, 'holding it carries the mission forward — it is NOT auto-failed');
  await page.close();
}

// ═══ MISSION LETTER resolves IN SEAT ORDER, not the instant you click ═══
// Wyatt: "it plays my first card, then lets everyone else go, then my second."
// Solo used to activate a Letter immediately, which split your final pair
// around the whole table when you did not hold the Emblem.
{
  console.log('── Mission Letter: your last two cards stay back-to-back (seat order)');
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('letter-order: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('letter-order pageerror: ' + e.message));
  await page.setViewport({ width: 1420, height: 850 });
  await startGame(page);

  await page.evaluate(() => {
    window.CINEMATIC_SPEED = 0.05;
    game.emblemHolder = 1;                       // you do NOT act first
    const p = game.players[0];
    const letter = FAVOR_DATA.cards.find(c => c.type === 'mission_letter');
    const filler = (n) => ({ ...FAVOR_DATA.cards.find(c => c.name === n) });
    p.gold = 10;
    p.hand = [{ ...letter, id: 9101 }, filler('First Aid')];   // your LAST TWO
    for (let i = 1; i < game.playerCount; i++) {
      game.players[i].hand = [filler('First Aid'), filler('Trapping')];
    }
    game.pendingActivations = new Array(game.playerCount).fill(null);
    // record the true activation order
    window.__order = [];
    const orig = game.activateCard.bind(game);
    game.activateCard = (pi, id, action, ...rest) => {
      window.__order.push(pi === 0 ? 'YOU' : 'AI' + pi);
      return orig(pi, id, action, ...rest);
    };
    renderGameState();
  });
  await sleep(300);
  // Throw the pair in: the Emblem seat's reveals run FIRST, then your
  // chooser opens for the Letter — the decision now truly lives at your
  // seat's activation slot.
  await throwAndAwaitChoice(page, 0);
  await answerChoice(page, /letter/);

  // The Letter's mission pick opens at YOUR reveal — take one.
  await page.waitForFunction(() =>
    document.querySelector('.mission-option') && document.querySelector('.mission-option').offsetParent,
    { timeout: 15000 });
  await page.evaluate(() => document.querySelector('.mission-option').click());

  // Your auto-paired second card asks last — answer it.
  await page.waitForFunction(() => window._finalChoicePending === true, { timeout: 15000 });
  await answerChoice(page, /discard \(\+3g\)/);
  await page.waitForFunction(() => (window.__order || []).length >= game.playerCount * 2,
    { timeout: 20000 });
  const order = await page.evaluate(() => (window.__order || []).slice());
  const youAt = order.indexOf('YOU');
  ok(youAt > 0, `you do NOT jump the table — the Emblem seat goes first (${order.join(' ')})`);
  // Everything before you must be AI; nothing after you until your 2nd card.
  ok(order.slice(0, youAt).every(x => x !== 'YOU'),
    'and every other seat has finished BOTH its cards before your turn');
  ok(order[order.length - 1] === 'YOU',
    'your Letter lands on YOUR turn, last in seat order — the pair is not split');
  await page.screenshot({ path: join(SHOTS, 'letter-seat-order.png') });
  await page.close();
}

// ═══ MULTIPLAYER: a HELD MISSION is streamed, not decided for you ════════
// A mission inside its window but not yet due is the holder's call at every act
// boundary. In MP that is one more decision that must be staged in canonical
// seat order — the holder chooses, everyone else applies the SAME choice — or
// the tables fork. Its own match, because it drives an act boundary to the end.
{
  console.log('── MP: held mission — the holder decides, the stream carries it');
  try {
    const mkContext = async () => (browser.createBrowserContext
      ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
    const ctxA = await mkContext();
    const ctxB = await mkContext();
    const A_UID = 'uaudithma' + Math.random().toString(36).slice(2, 6);
    const B_UID = 'uaudithmb' + Math.random().toString(36).slice(2, 6);

    const boot = async (ctx, uid, name) => {
      const pg = await ctx.newPage();
      pg.on('console', m => { if (m.type() === 'error') consoleErrors.push(`mphm-${name}: ` + m.text()); });
      pg.on('pageerror', e => consoleErrors.push(`mphm-${name} pageerror: ` + e.message));
      await pg.evaluateOnNewDocument((u, n) => {
        localStorage.setItem('favorUid', u);
        localStorage.setItem('favorName', n);
        localStorage.setItem('favorQueue', '3');
      }, uid, name);
      await pg.setViewport({ width: 1280, height: 800 });
      await pg.goto(URL, { waitUntil: 'networkidle2' });
      await pg.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
      await pg.evaluate(() => {
        window.shuffleArray = (a) => [...a];
        window.CINEMATIC_SPEED = 0.05;
        FMP._T.windowMin = 30000;
        FMP._T.windowSpread = 1;
        [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
          .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent)).click();
      });
      await pg.waitForFunction(() => {
        const c = document.getElementById('queueChip');
        return c && c.classList.contains('on');
      }, { timeout: 12000 });
      return pg;
    };
    // The new handshake: ring → accept → 20s pick → Begin.
    const throughTheRing = async (pg, cardIdx) => {
      await pg.waitForFunction(() => {
        const m = document.getElementById('matchFound');
        return m && m.classList.contains('on');
      }, { timeout: 25000 });
      await pg.evaluate(() => document.getElementById('mfAccept').click());
      await pg.waitForFunction(() =>
        document.getElementById('character-select').classList.contains('active')
        && !!document.getElementById('pickClock'), { timeout: 15000 });
      await pg.evaluate((i) => {
        const c = [...document.querySelectorAll('#characterGrid .character-card')];
        selectCharacter(c[i].dataset.id, c[i]);
        document.getElementById('confirmBtn').click();
      }, cardIdx);
    };

    const pA = await boot(ctxA, A_UID, 'A');
    await sleep(900);
    const pB = await boot(ctxB, B_UID, 'B');
    await Promise.all([throughTheRing(pA, 0), throughTheRing(pB, 2)]);
    const inGame = (pg) => pg.waitForFunction(() => typeof game !== 'undefined' && game
      && game.players.length === 3 && game.players[0].character && FMP.active(), { timeout: 25000 });
    await Promise.all([inGame(pA), inGame(pB)]);
    ok(true, 'two clients matched for the held-mission table (through the new handshake)');

    // Let the host's START-OF-GAME desync stamp land FIRST. It carries the
    // pre-rig hash; if we mutate the table before B consumes it, B sees a
    // mismatch against its own (rigged) state, calls leaveGame() and drops to
    // solo — and then nothing streams. Rig only once both tables agree.
    await sleep(2500);
    const hashOf = (pg) => pg.evaluate(() => mpStateHash());
    const [h0A, h0B] = await Promise.all([hashOf(pA), hashOf(pB)]);
    ok(h0A === h0B, `the fresh table already agrees (${h0A} vs ${h0B})`);
    const stillMp = await pB.evaluate(() => FMP.active());
    ok(stillMp, 'and B is still in the match (it did not fall back to solo)');

    // Rig Crazy Lou (activates Act 1, due Act 3, 15 Power) on CANONICAL SEAT 0,
    // MET, on BOTH clients. Empty every hand so the act ends when we drive it.
    const rig = (pg) => pg.evaluate(() => {
      const li = FMP.localIdx(0);
      const p = game.players[li];
      p.missions = [{ ...FAVOR_DATA.missions.find(m => m.name === 'Wanted: Crazy Lou') }];
      p.bonusSkills = { power: 15 };
      game.applySlotSkills(p);
      game.players.forEach(x => { x.hand = []; });
      game.pendingActivations = game.players.map(() => null);
    });
    await Promise.all([rig(pA), rig(pB)]);

    const seat0 = (pg) => pg.evaluate(() => {
      const p = game.players[FMP.localIdx(0)];
      return { held: (p.missions || []).map(m => m.name), done: (p.completedMissions || []).map(m => m.name),
               favor: p.favor, gold: p.gold };
    });
    ok((await seat0(pA)).held.includes('Wanted: Crazy Lou'), 'canonical seat 0 holds a not-yet-due mission');
    const [h1A, h1B] = await Promise.all([hashOf(pA), hashOf(pB)]);
    ok(h1A === h1B, `and the rig itself is symmetric — both tables still agree (${h1A} vs ${h1B})`);

    await Promise.all([ pA.evaluate(() => { endActPhases(); }), pB.evaluate(() => { endActPhases(); }) ]);

    const chooserA = await pA.waitForFunction(() =>
      document.getElementById('promisePicker').classList.contains('active')
      && /Crazy Lou/i.test(document.getElementById('promisePicker').textContent),
      { timeout: 20000 }).then(() => true, () => false);
    ok(chooserA, 'the HOLDER is asked (chooser up on their client)');
    const chooserB = await pB.evaluate(() =>
      document.getElementById('promisePicker').classList.contains('active')
      && /Crazy Lou/i.test(document.getElementById('promisePicker').textContent));
    ok(!chooserB, 'and NOT on the other client — nobody decides it for them');
    ok(/deciding/i.test(await pB.evaluate(() => document.body.innerText)),
      'the other client is told they are deciding, not left hanging');
    await pA.screenshot({ path: join(SHOTS, 'mp-held-mission-holder.png') });
    await pB.screenshot({ path: join(SHOTS, 'mp-held-mission-peer.png') });

    // They attempt it. It is MET, so it must COMPLETE — on BOTH tables.
    await pA.evaluate(() => document.getElementById('emAttempt').click());
    const settled = (pg) => pg.waitForFunction(() =>
      (game.players[FMP.localIdx(0)].completedMissions || []).some(m => m.name === 'Wanted: Crazy Lou'),
      { timeout: 25000 }).then(() => true, () => false);
    const [dA, dB] = await Promise.all([settled(pA), settled(pB)]);
    ok(dA, 'the holder\'s table completes the mission they attempted');
    ok(dB, 'and the PEER table completes it too — the streamed decision was applied');

    const [aA, aB] = await Promise.all([seat0(pA), seat0(pB)]);
    ok(aA.gold === aB.gold && aA.favor === aB.favor,
      `LOCKSTEP: the payout agrees (gold ${aA.gold}/${aB.gold}, favor ${aA.favor}/${aB.favor})`);
    ok(!aA.held.length && !aB.held.length, 'and it leaves both hands');

    // Ride it all the way through the act boundary and compare the host's own
    // desync hash. If this diverges the real game would drop to solo.
    const advanced = (pg) => pg.waitForFunction(() => game.currentAct === 2, { timeout: 30000 })
      .then(() => true, () => false);
    await Promise.all([advanced(pA), advanced(pB)]);
    await sleep(1500);
    const rowsOf = (pg) => pg.evaluate(() => {
      const n = game.playerCount;
      const rows = [];
      for (let cs = 0; cs < n; cs++) {
        const p = game.players[FMP.localIdx(cs)];
        rows.push([p.gold, p.prestige, p.scorn, p.favor,
          (p.hand || []).map(c => c.id).join(','),
          (p.playedCards || []).map(c => c.id).join(','),
          (p.missions || []).map(m => m.id || m.name).join(',')].join('|'));
      }
      rows.push((game.visibleMissions || []).map(m => m.id || m.name).join(','));
      rows.push(String(FMP.canonSeat(game.emblemHolder)));
      return { rows, hash: mpStateHash() };
    });
    const [rA, rB] = await Promise.all([rowsOf(pA), rowsOf(pB)]);
    if (rA.hash !== rB.hash) {
      rA.rows.forEach((row, i) => {
        if (row !== rB.rows[i]) console.log(`    [desync row ${i}]\n      A: ${row}\n      B: ${rB.rows[i]}`);
      });
    }
    ok(rA.hash === rB.hash,
      `LOCKSTEP: the tables still agree after the act advances (${rA.hash} vs ${rB.hash})`);

    // Leave no trace: this flow ends mid-game (no gameOver → no host
    // cleanup), so its 'live' record would sit until the 6h sweep.
    await pA.evaluate(async () => {
      const gid = FMP.gid();
      if (gid) await firebase.database().ref(`favor/mp/games/${gid}`).remove();
      await firebase.database().ref('favor/mp/queue').remove();
    });
    await ctxA.close(); await ctxB.close();
  } catch (e) {
    ok(false, 'MP held-mission flow crashed', e.message);
  }
}

// ═══ FIRST-GAME GUIDED LAYER — desktop coach + honest action panel ═══
console.log('── First game: desktop coach marks, favor token, price-before-commit');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('coach-desk: ' + m.text()); });
  await page.setViewport({ width: 1440, height: 900 });
  await startGame(page);

  // startGame seeds every coach id as seen (deterministic flows) — this flow
  // is ABOUT the coach, so un-see them and let the heartbeat re-evaluate.
  await page.evaluate(async () => {
    localStorage.removeItem('favor_coach_seen');
    resetCoach();
    renderGameState();
    await new Promise(r => setTimeout(r, 400));
  });

  const welcome = await page.evaluate(() => {
    const c = document.getElementById('coach');
    const g = document.getElementById('coach-glow').getBoundingClientRect();
    const thumb = document.querySelector('#boardThumb').getBoundingClientRect();
    const overlap = !(g.right < thumb.left || g.left > thumb.right || g.bottom < thumb.top || g.top > thumb.bottom);
    return { shown: c.classList.contains('show'), isWelcome: /seated at the table/i.test(c.textContent), overlap };
  });
  ok(welcome.shown && welcome.isWelcome && welcome.overlap, 'DESKTOP welcome tip shows framed on the player plate');

  const missions = await page.evaluate(async () => {
    dismissCoach();
    if (typeof coachTick === 'function') coachTick();
    await new Promise(r => setTimeout(r, 300));
    const c = document.getElementById('coach');
    const g = document.getElementById('coach-glow').getBoundingClientRect();
    const strip = document.querySelector('#missionStrip').getBoundingClientRect();
    const overlap = !(g.right < strip.left || g.left > strip.right || g.bottom < strip.top || g.top > strip.bottom);
    return { shown: c.classList.contains('show'), isMissions: /Missions of the Realm/i.test(c.textContent), overlap };
  });
  ok(missions.shown && missions.isMissions && missions.overlap, 'dismiss advances to the missions tip on the strip');

  const ladder = await page.evaluate(() => COACH_STEPS.map(s => s.id).join(','));
  ok(ladder === 'welcome,missions,hand,skills,pass,rivals,scorn,favor,ring,melee,emblem',
    `coach ladder covers the first game (${ladder})`);

  // Favor — the win condition — has a permanent desktop counter.
  const favorTok = await page.evaluate(() => {
    const t = document.querySelector('#statsPanel .resource-token[data-stat="favor"]');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { val: t.querySelector('.token-val').textContent.trim(), visible: r.width > 10 && r.height > 6 };
  });
  ok(!!favorTok && favorTok.visible && favorTok.val === '0',
    `desktop stats panel shows the FAVOR counter (${favorTok && favorTok.val})`);

  // Honest reveal chooser: a scorn-priced card warns BEFORE commit. The
  // two rigged cards are a final pair — chooser #1 = Endless Sparring,
  // chooser #2 = Forbidden Lab, exactly the old two panels in sequence.
  await page.evaluate(() => {
    skipAllCoach();
    game.phase = 'gameplay';
    game.players[0].hand = [
      { ...FAVOR_DATA.cards.find(c => c.name === 'Endless Sparring') },
      { ...FAVOR_DATA.cards.find(c => c.name === 'Forbidden Lab') },
    ];
    game.players[0].skills.power = 1;   // meets the req so Play is LIVE while the price shows
    game.pendingActivations = new Array(game.playerCount).fill(null);
    window.CINEMATIC_SPEED = 0.05;
    renderGameState();
  });
  await throwAndAwaitChoice(page, 0);
  const priced = await page.evaluate(() => {
    const panel = document.getElementById('actionPanel');
    return {
      grants: (panel.querySelector('.action-skills') || {}).textContent || '',
      price: (panel.querySelector('.action-price') || {}).textContent || '',
      playLive: !![...panel.querySelectorAll('button')].find(b => /play/i.test(b.textContent) && !b.disabled),
    };
  });
  ok(/^Grants/.test(priced.grants) && /Knowledge/.test(priced.grants), `grants line is labeled (${priced.grants})`);
  ok(/Price/.test(priced.price) && /\+5 Scorn/.test(priced.price) && priced.playLive,
    `the 5-Scorn price shows BEFORE commit, beside a live Play (${priced.price})`);

  // … and a flex card explains its either/or in plain words (chooser #2).
  await answerChoice(page, /play/);
  await page.waitForFunction(() =>
    window._finalChoicePending === true &&
    /Forbidden Lab/i.test(document.getElementById('actionPanel').textContent), { timeout: 12000 });
  const flex = await page.evaluate(() => {
    const panel = document.getElementById('actionPanel');
    return {
      special: (panel.querySelector('.action-special') || {}).textContent || '',
      price: (panel.querySelector('.action-price') || {}).textContent || '',
    };
  });
  ok(/Alchemy or Prospecting/i.test(flex.special) && !/auto-picked/i.test(flex.special),
    `flex card explains itself in plain words (${flex.special})`);
  ok(/\+2 Scorn/.test(flex.price), `Forbidden Lab's 2-Scorn price shows (${flex.price})`);

  await page.screenshot({ path: join(SHOTS, 'coach-desktop-panel.png') });
  await answerChoice(page, /discard \(\+3g\)/);
  await sleep(300);
  await page.close();
}

// ═══ SKIRMISH — vs AI at the menu size, ANY owned hero, thematic names ═══
console.log('── Skirmish: any owned hero, thematic AI, no leaderboard personas');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('skirmish: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('skirmish pageerror: ' + e.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await page.evaluate(() => {
    window.shuffleArray = (a) => [...a];
    window._pinEmblemSeed = 0;
    localStorage.setItem('favorQueue', '3');   // the menu seg must NOT decide a skirmish
  });

  const menu = await page.evaluate(() => ({
    tiles: ['Skirmish', 'Private Game'].map(t =>
      !![...document.querySelectorAll('.ts-card .ts-plaque')].find(p => p.textContent.trim() === t)),
    plaque: !!document.getElementById('rivalPlaque'),
  }));
  ok(menu.tiles.every(Boolean) && menu.plaque, 'Skirmish, Private Game and the rival plaque all on the menu');

  // The door asks the size FIRST (Wyatt 7/16) — a table of four, please.
  await page.evaluate(() => FMODES.openSkirmish());
  await sleep(250);
  const sizes = await page.evaluate(() => ({
    open: document.getElementById('skirmishPick').classList.contains('active'),
    options: [...document.querySelectorAll('#skirmishPick .sk-size b')].map(b => b.textContent),
  }));
  ok(sizes.open && sizes.options.join(',') === '3,4,5',
    `Skirmish asks how many players first (${sizes.options.join('/')})`);
  await page.screenshot({ path: join(SHOTS, 'skirmish-sizes.png') });
  await page.evaluate(() => FMODES.beginSkirmish(4));
  await page.waitForFunction(() =>
    document.getElementById('character-select').classList.contains('active')
    && document.querySelectorAll('.character-card').length > 0, { timeout: 15000 });
  const select = await page.evaluate(() => ({
    cards: document.querySelectorAll('.character-card').length,
    owned: FLB.ownedIds().length,
  }));
  ok(select.cards === select.owned && select.cards >= 5,
    `Skirmish select offers EVERY owned hero (${select.cards} of ${select.owned})`);
  await page.screenshot({ path: join(SHOTS, 'skirmish-select.png') });

  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.character-card')];
    const last = cards[cards.length - 1];           // NOT a 3-offer card
    selectCharacter(last.dataset.id, last);
    document.getElementById('confirmBtn').click();
  });
  await page.waitForFunction(() => typeof game !== 'undefined' && game
    && game.players.length && game.players[0].character, { timeout: 20000 });
  const table = await page.evaluate(() => ({
    count: game.playerCount,
    personas: game.players.filter(p => p._personaAI).length,
    names: game.players.slice(1).map(p => p.name),
    mode: window._gameMode,
  }));
  ok(table.count === 4, `the table is the size the DOOR asked for, not the menu seg (${table.count})`);
  ok(table.personas === 0, 'a Skirmish is PURE vs-AI — no leaderboard personas seated');
  const THEMATIC = ['The Lady Vespurine', 'Count Balthazar', 'Lord Ashcropt', 'Dame Rosalind',
                    'Prince Aldric', 'Princess Sera', 'Lord Cassius', 'Lady Elara'];
  ok(table.names.every(n => THEMATIC.includes(n)),
    `Skirmish rivals wear thematic names (${table.names.join(', ')})`);
  await page.close();
}

// ═══ WANTED (daily rival) — one named rival a day, Stars once per window ═══
console.log('── Wanted: deterministic pick, drifting bounty, intro plaque, claim-once');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('rival: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('rival pageerror: ' + e.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await page.evaluate(() => {
    window.shuffleArray = (a) => [...a];
    window._pinEmblemSeed = 0;
    localStorage.setItem('favorQueue', '3');
  });

  const det = await page.evaluate(() => {
    const days = [];
    for (let i = 0; i < 21; i++) {
      const d = new Date(Date.UTC(2026, 6, 5 + i));
      days.push(FMODES.rivalOfDay(d.toISOString().slice(0, 10)).key);
    }
    const stable = FMODES.rivalOfDay('2026-07-16').key === FMODES.rivalOfDay('2026-07-16').key;
    const noAdjacentRepeat = days.every((k, i) => i === 0 || k !== days[i - 1]);
    // Ten themed rivals — one per character, each under a crafted name.
    const heroes = new Set(window.FAVOR_DATA.characters.map(c => c.id));
    const pool = [];
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i));
      const r = FMODES.rivalOfDay(d.toISOString().slice(0, 10));
      if (!pool.some(p => p.key === r.key)) pool.push(r);
    }
    // The bounty (Wyatt 7/16): bandit = flat 100 ★; everyone else drifts
    // 25..75 in steps of 5, deterministic per (day, rival).
    const bounties = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const r = FMODES.rivalOfDay(d);
      bounties.push({ key: r.key, stars: FMODES.rivalStars(r, d), again: FMODES.rivalStars(r, d) });
    }
    const banditB = bounties.filter(b => b.key === 'bandit');
    const otherB = bounties.filter(b => b.key !== 'bandit');
    // Direct check — rivalStars keys off rival.key alone, so the bandit
    // flat-100 must hold on ANY day, not just days the sample surfaced him.
    const bandit100Direct = ['2026-01-01', '2026-07-16', '2027-03-09']
      .every(k => FMODES.rivalStars({ key: 'bandit' }, k) === 100);
    return {
      days: days.join(','), stable, noAdjacentRepeat,
      poolSize: pool.length,
      allHeroes: pool.every(r => heroes.has(r.hero)),
      named: pool.every(r => r.name && r.name.length > 8 && r.name !== r.hero),
      banditSeen: banditB.length,
      bandit100: bandit100Direct && banditB.every(b => b.stars === 100),
      othersRanged: otherB.every(b => b.stars >= 25 && b.stars <= 75 && b.stars % 5 === 0),
      othersDrift: new Set(otherB.map(b => b.stars)).size > 1,
      bountyStable: bounties.every(b => b.stars === b.again),
    };
  });
  ok(det.stable, 'the pick is deterministic for a given day');
  ok(det.noAdjacentRepeat, `no rival two days running (${det.days.slice(0, 90)}…)`);
  ok(det.poolSize === 10 && det.allHeroes,
    `TEN rivals, one per character (${det.poolSize} seen across 40 days)`);
  ok(det.named, 'every rival wears a crafted name, not a character id');
  ok(det.banditSeen > 0 && det.bandit100,
    `the Bandit's head is always worth 100 ★ (${det.banditSeen} bandit days checked)`);
  ok(det.othersRanged && det.othersDrift && det.bountyStable,
    'every other bounty drifts 25–75 in steps of 5, deterministic per day');

  // The MENU plaque — Nation's Challenger look: name, ★ stakes, live clock.
  const plaque = await page.evaluate(() => {
    FMODES.renderRivalPlaque();
    const rival = FMODES.rivalOfDay();
    const card = document.getElementById('rivalPlaque');
    const badge = card.querySelector('.drp-badge');
    const cr = card.getBoundingClientRect();
    const br = badge ? badge.getBoundingClientRect() : null;
    return {
      head: (card.querySelector('.drp-head') || {}).textContent || '',
      name: (card.querySelector('.drp-name') || {}).textContent || '',
      expect: rival.name,
      art: !!card.querySelector('.drp-art'),
      bounty: FMODES.rivalStars(rival),
      stars: ((card.querySelector('.drp-stars') || {}).textContent || '')
        .includes('+' + FMODES.rivalStars(rival)),
      clock: /^\d\d:\d\d:\d\d$/.test((document.getElementById('drpClock') || {}).textContent || ''),
      badge: !!badge,
      // The ! overhangs the card's top-right corner OVER the edge (Wyatt
      // 7/16) — the old ts-card overflow clip cut it off. Overhang plus
      // overflow:visible together mean the full circle paints.
      badgeOverhangs: !!br && br.top < cr.top && br.right > cr.right
        && getComputedStyle(card).overflow === 'visible',
      tall: cr.height >= 120,
    };
  });
  ok(/wanted/i.test(plaque.head) && plaque.name === plaque.expect,
    `the WANTED plaque names today's rival (${plaque.name})`);
  ok(plaque.art && plaque.stars && plaque.clock,
    `portrait, today's bounty (★ +${plaque.bounty}) and a ticking HH:MM:SS clock on the plaque`);
  ok(plaque.badge, 'the red ! badge rides an unbeaten day');
  ok(plaque.badgeOverhangs, 'the ! badge overhangs the corner un-clipped, over the card edge');
  ok(plaque.tall, 'the plaque stands tall in the menu grid');
  await page.screenshot({ path: join(SHOTS, 'rival-plaque.png') });

  // The PREBOOT (Wyatt 7/18: "the wanted character wasn't really showing up
  // ... and I closed the app"). index.html paints the plaque at parse time
  // from its own copy of the rival table. That copy is the drift hazard, so
  // it is pinned here: rename or reorder a rival in modes.js without touching
  // index.html and this goes red.
  const pre = await page.evaluate(async () => {
    const src = await (await fetch('index.html?preboot=' + Date.now())).text();
    const block = src.slice(src.indexOf('var ROSTER'), src.indexOf('function hashKey'));
    const pairs = [...block.matchAll(/\['([a-z]+)',\s*'([^']+)'\]/g)]
      .map(m => m[1] + '|' + m[2]).sort();
    // What modes.js actually serves, swept wide enough to see every rival.
    const live = new Set();
    const d = new Date();
    for (let i = 0; i < 40; i++) {
      d.setDate(d.getDate() + 1);
      live.add((r => r.hero + '|' + r.name)(FMODES.rivalOfDay(d.toISOString().slice(0, 10))));
    }
    const tags = [...src.matchAll(/<script([^>]*)\ssrc=/g)].map(m => m[1]);
    return {
      pairs, live: [...live].sort(),
      // Compare against the script TAG, not the string "js/modes.js" — the
      // preboot's own comment names the file, and that mention comes first.
      before: src.indexOf('var ROSTER') > 0
        && src.indexOf('var ROSTER') < src.indexOf('src="js/modes.js'),
      deferred: tags.filter(t => /\bdefer\b/.test(t)).length,
      tags: tags.length,
      audio: (document.getElementById('themeMusic') || {}).getAttribute('preload'),
      preload: !!document.querySelector('link[rel="preload"][as="image"]'),
    };
  });
  ok(pre.pairs.length === 10 && pre.pairs.join() === pre.live.join(),
    `the preboot rival table matches modes.js exactly (${pre.pairs.length} rivals pinned)`);
  ok(pre.before, 'the plaque paints before modes.js is even requested');
  ok(pre.deferred === pre.tags && pre.tags >= 14,
    `every script tag is deferred, so 762 KB never blocks the parser (${pre.deferred}/${pre.tags})`);
  ok(pre.audio === 'none', 'the 482 KB theme is not fetched before the player presses anything');
  ok(pre.preload, "the rival's portrait is preloaded from the head");

  await page.evaluate(() => FMODES.openDailyRival());
  await sleep(300);
  const intro = await page.evaluate(() => {
    const ov = document.getElementById('rivalIntro');
    const rival = FMODES.rivalOfDay();
    const flat = ov.textContent.replace(/\s+/g, ' ');
    const inner = ov.querySelector('.ri-inner').getBoundingClientRect();
    const btnsFit = [...ov.querySelectorAll('.ri-actions .btn-royal')]
      .every(b => {
        const r = b.getBoundingClientRect();
        const s = b.querySelector('span');
        // Inside the panel AND the label inside the button (.btn-royal
        // clips overflow — a too-wide nowrap span reads "NOT TODA").
        return r.left >= inner.left - 1 && r.right <= inner.right + 1
          && s && s.getBoundingClientRect().width <= r.width - 4;
      });
    return {
      active: ov.classList.contains('active'),
      titled: /Wanted/.test(flat),
      named: ov.textContent.includes(rival.name),
      art: !!ov.querySelector('.ri-art'),
      bounty: FMODES.rivalStars(rival),
      stakes: flat.includes('+' + FMODES.rivalStars(rival) + ' ★'),
      btnsFit,
    };
  });
  ok(intro.active && intro.titled && intro.named,
    'the WANTED intro names today\'s rival');
  ok(intro.art && intro.stakes, `portrait + today's +${intro.bounty}★ stakes on the plaque`);
  ok(intro.btnsFit, 'Not Today / Face Them sit inside the panel (no edge bleed)');
  await page.screenshot({ path: join(SHOTS, 'daily-rival-intro.png') });

  await page.evaluate(() => FMODES.beginRivalGame());
  await page.waitForFunction(() =>
    document.getElementById('character-select').classList.contains('active'), { timeout: 15000 });
  await page.evaluate(() => {
    // Never mirror-match the rig: pick a hero that is NOT today's rival's,
    // so the rides-their-own-character assert holds on every calendar day.
    const rival = FMODES.rivalOfDay();
    const c = [...document.querySelectorAll('.character-card')]
      .find(x => x.dataset.id !== rival.hero) || document.querySelector('.character-card');
    selectCharacter(c.dataset.id, c);
    document.getElementById('confirmBtn').click();
  });
  await page.waitForFunction(() => typeof game !== 'undefined' && game
    && game.players.length && game.players[0].character, { timeout: 20000 });
  const table = await page.evaluate(() => {
    const rival = FMODES.rivalOfDay();
    const seat = game.players.find(p => p.name === rival.name);
    return {
      count: game.playerCount,
      seated: !!seat,
      sharp: !!(seat && seat._personaAI),
      hero: seat && seat.character && seat.character.id,
      expectHero: rival.hero,
      uid: seat && seat._personaUid,
      // The rival's head start (Wyatt 7/16): a second copy of the gold
      // their ridden hero starts with — and ONLY the rival gets it.
      gold: seat && seat.gold,
      expectGold: seat && seat.character ? seat.character.startingGold * 2 : -1,
      othersStock: game.players.every(p => p === seat
        || p.gold === (p.character ? p.character.startingGold : 0)),
    };
  });
  ok(table.count === 3, `the rival table seats three (${table.count})`);
  ok(table.seated && table.sharp, 'today\'s rival sits at the table with the sharp persona brain');
  ok(table.hero === table.expectHero, `astride their own character (${table.hero})`);
  ok(!table.uid, 'and with NO leaderboard identity — a rival never posts a row');
  ok(table.gold === table.expectGold && table.othersStock,
    `the rival rides with a second copy of their starting gold (${table.gold} = 2× stock); everyone else starts stock`);

  // Claim path: stub the star grant, drive the scoring hook directly.
  const claims = await page.evaluate(async () => {
    const calls = [];
    const real = FLB.claimRivalWin;
    FLB.claimRivalWin = async (key, stars) => { calls.push({ key, stars }); return calls.length === 1; };
    const rival = FMODES.rivalOfDay();
    await FMODES.rivalGameOver([{ name: 'You' }, { name: rival.name }, { name: 'Filler' }]);   // ahead → claim
    await FMODES.rivalGameOver([{ name: rival.name }, { name: 'You' }, { name: 'Filler' }]);   // behind → no claim
    window._gameMode = 'rival';   // rigGameOver clears nothing; ensure mode intact for the 2nd win
    await FMODES.rivalGameOver([{ name: 'You' }, { name: rival.name }, { name: 'Filler' }]);   // claim refused (stub false)
    FLB.claimRivalWin = real;
    return { calls, expect: FMODES.rivalStars(rival, FLB.currentDateKey()) };
  });
  ok(claims.calls.length === 2 && claims.calls.every(c => c.stars === claims.expect),
    `beating the rival claims today's +${claims.expect}★ through the once-a-day gate (${claims.calls.length} claim calls)`);
  await page.close();
}

// ═══ UPDATE PILL — a newer live stamp wears the notice on the menu ═══
console.log('── Update pill: fresh stays clean, stale wears it, tap reloads, menu-only');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('updpill: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('updpill pageerror: ' + e.message));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && typeof FLB.checkForUpdate === 'function',
    { timeout: 15000 });

  // Fresh client: the real index carries OUR stamp — no pill.
  const fresh = await page.evaluate(async () => {
    await FLB.checkForUpdate();
    return !document.getElementById('updatePill');
  });
  ok(fresh, 'a fresh client asks and stays clean (live stamp == mine)');

  // Stale client: the live index answers with a FUTURE stamp — pill on.
  const shown = await page.evaluate(async () => {
    const real = window.fetch;
    window.fetch = async () => ({ ok: true, text: async () => 'src="js/ui.js?v=99999999999999"' });
    await FLB.checkForUpdate();
    await FLB.checkForUpdate();   // second sighting must not double the pill
    window.fetch = real;
    const pills = document.querySelectorAll('#updatePill, .update-pill');
    const p = document.getElementById('updatePill');
    const r = p ? p.getBoundingClientRect() : null;
    const chip = document.querySelector('.profile-chip').getBoundingClientRect();
    return {
      count: pills.length,
      text: p ? p.textContent : '',
      visible: !!r && r.width > 40,
      topRight: !!r && r.top >= chip.bottom - 2 && (innerWidth - r.right) < 160,
    };
  });
  ok(shown.count === 1 && /Update Ready/.test(shown.text),
    'a stale client wears ONE Update Ready pill');
  ok(shown.visible && shown.topRight, 'the pill sits top-right under the profile chip');
  await page.screenshot({ path: join(SHOTS, 'update-pill.png') });

  // Tap = the reload door (stubbed so the page survives the audit).
  const tapped = await page.evaluate(() => {
    let calls = 0;
    const real = FLB.applyUpdate;
    FLB.applyUpdate = () => calls++;
    document.getElementById('updatePill').click();
    FLB.applyUpdate = real;
    return calls;
  });
  ok(tapped === 1, 'tapping the pill asks for the reload');

  // The pill is a TITLE-SCREEN child — when the menu leaves, so does it.
  const gated = await page.evaluate(() => {
    const ts = document.getElementById('title-screen');
    ts.style.display = 'none';
    const w = document.getElementById('updatePill').getBoundingClientRect().width;
    ts.style.display = '';
    return w === 0;
  });
  ok(gated, 'the pill lives in the title screen — it can never cover a live table');
  await page.close();
}

// ═══ EMOTES — Nation's six, streamed to every screen at the table ═══
console.log('── Emotes: publish on tap, bubble on the right seat, cooldown holds');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('emotes: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('emotes pageerror: ' + e.message));
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);
  await sleep(300);

  const wire = await page.evaluate(async () => {
    const sent = [];
    const handlers = {};
    const realFMP = window.FMP;
    window.FMP = {
      active: () => true,
      publish: (type, data) => sent.push({ type, data }),
      onBroadcast: (type, cb) => { handlers[type] = cb; },
      localIdx: (s) => s,
      mySeat: () => 0,
    };
    FMODES.attachEmotes();

    // The stream echoes YOUR emote back — it must not double-bubble.
    handlers.emote({ seat: 0, e: 'hearts' });

    FMODES.emote('hearts');                      // publishes + own bubble
    FMODES.emote('fuming');                      // inside the cooldown — swallowed
    await new Promise(r => setTimeout(r, 120));
    const own = document.querySelectorAll('.emote-bubble').length;
    handlers.emote({ seat: 1, e: 'thumbsup' });  // a rival's reaction arrives
    await new Promise(r => setTimeout(r, 120));
    const bubbles = [...document.querySelectorAll('.emote-bubble')];
    const rivalChip = document.querySelector('#gameSidebar .opp-entry[data-pi="1"]');
    const rr = rivalChip.getBoundingClientRect();
    const overRival = bubbles.some(b => {
      const br = b.getBoundingClientRect();
      return Math.abs((br.left + br.width / 2) - (rr.left + rr.width / 2)) < rr.width;
    });
    window.FMP = realFMP;
    return { sent, own, total: bubbles.length, overRival };
  });
  ok(wire.sent.length === 1 && wire.sent[0].type === 'emote' && wire.sent[0].data.e === 'hearts',
    `one tap = one 'emote' move; the cooldown swallowed the spam (${wire.sent.length} sent)`);
  ok(wire.own === 1, `your own bubble shows once — the stream echo never doubles it (${wire.own})`);
  ok(wire.total >= 2 && wire.overRival, 'a rival\'s reaction lands in THEIR bubble');
  await page.screenshot({ path: join(SHOTS, 'emote-bubbles.png') });

  const tray = await page.evaluate(() => {
    FMODES.toggleEmoteTray();
    const t = document.getElementById('emoteTray');
    return {
      active: t.classList.contains('active'),
      count: t.querySelectorAll('img').length,
      srcs: [...t.querySelectorAll('img')].every(i => /assets\/emotes\//.test(i.getAttribute('src'))),
    };
  });
  ok(tray.active && tray.count === 6 && tray.srcs, `the tray offers Nation's six (${tray.count})`);
  await page.close();
}

// ═══ PRIVATE ROOM — host + code, friends join, AI fills, uniqueness ═══
console.log('── Private room: host/join by code, size in-room, Start → picking → live');
{
  try {
    const mkContext = async () => (browser.createBrowserContext
      ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
    const ctxA = await mkContext();
    const ctxB = await mkContext();
    const A_UID = 'uauditrma' + Math.random().toString(36).slice(2, 6);
    const B_UID = 'uauditrmb' + Math.random().toString(36).slice(2, 6);

    const boot = async (ctx, uid, name) => {
      const pg = await ctx.newPage();
      pg.on('console', m => { if (m.type() === 'error') consoleErrors.push(`room-${name}: ` + m.text()); });
      pg.on('pageerror', e => consoleErrors.push(`room-${name} pageerror: ` + e.message));
      await pg.evaluateOnNewDocument((u, n) => {
        localStorage.setItem('favorUid', u);
        localStorage.setItem('favorName', n);
        localStorage.setItem('favorQueue', '3');
      }, uid, name);
      await pg.setViewport({ width: 1280, height: 800 });
      await pg.goto(URL, { waitUntil: 'networkidle2' });
      await pg.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
      await pg.evaluate(() => {
        window.shuffleArray = (a) => [...a];
        window.CINEMATIC_SPEED = 0.05;
      });
      return pg;
    };

    const pA = await boot(ctxA, A_UID, 'Audit RoomA');
    const pB = await boot(ctxB, B_UID, 'Audit RoomB');

    // Host: the lobby shows a shareable code.
    await pA.evaluate(() => { FMODES.openPrivateRoom(); FMODES.hostRoom(); });
    await pA.waitForFunction(() => document.querySelector('#roomOverlay .rm-code'), { timeout: 12000 });
    const code = await pA.evaluate(() => document.querySelector('#roomOverlay .rm-code').textContent.trim());
    ok(/^[A-Z2-9]{5}$/.test(code), `host receives a 5-char room code (${code})`);
    await pA.screenshot({ path: join(SHOTS, 'room-lobby-host.png') });

    // Join by code — both lobbies list both nobles.
    await pB.evaluate((c) => {
      FMODES.openPrivateRoom();
      document.getElementById('rmCode').value = c;
      FMODES.joinRoom();
    }, code);
    const bothListed = (pg) => pg.waitForFunction(() =>
      document.querySelectorAll('#roomOverlay .rm-row:not(.open)').length === 2, { timeout: 12000 })
      .then(() => true, () => false);
    const [lA, lB] = await Promise.all([bothListed(pA), bothListed(pB)]);
    ok(lA && lB, 'both lobbies list both nobles');

    // The host picks the game size IN the room; AI fills the rest.
    await pA.evaluate(() => FMODES.roomSetSize(4));
    const sizeShown = await pB.waitForFunction(() =>
      document.querySelectorAll('#roomOverlay .rm-row.open').length === 2, { timeout: 8000 })
      .then(() => true, () => false);
    ok(sizeShown, 'size 4 with 2 humans shows two AI seats — on the JOINER\'s lobby');
    await pB.screenshot({ path: join(SHOTS, 'room-lobby-joiner.png') });

    // Start → both clients land on the pick screen with the clock.
    await pA.evaluate(() => FMODES.startRoomGame());
    const picking = (pg) => pg.waitForFunction(() =>
      document.getElementById('character-select').classList.contains('active')
      && !!document.getElementById('pickClock'), { timeout: 20000 }).then(() => true, () => false);
    const [kA, kB] = await Promise.all([picking(pA), picking(pB)]);
    ok(kA && kB, 'Start opens the timed hero pick on both clients');

    // Both pick DIFFERENT heroes (uniqueness holds by construction); the
    // sealed roster resolves any collision — asserted below by identity.
    await pA.evaluate(() => {
      const c = [...document.querySelectorAll('#characterGrid .character-card')][0];
      selectCharacter(c.dataset.id, c);
      document.getElementById('confirmBtn').click();
    });
    await pB.evaluate(() => {
      const cards = [...document.querySelectorAll('#characterGrid .character-card')];
      const c = cards[cards.length - 1];
      selectCharacter(c.dataset.id, c);
      document.getElementById('confirmBtn').click();
    });
    const live = (pg) => pg.waitForFunction(() =>
      typeof game !== 'undefined' && game && game.players.length && FMP.active(), { timeout: 25000 })
      .then(() => true, () => false);
    const [gA, gB] = await Promise.all([live(pA), live(pB)]);
    ok(gA && gB, 'the sealed room goes live on both clients');

    const stateOf = (pg) => pg.evaluate(() => ({
      n: game.playerCount,
      humans: game.players.filter((p, i) => i === 0 || p._remoteHuman).length,
      names: game.players.map(p => p.name),
      heroes: game.players.map(p => p.character.id),
      handsCanon: [0, 1, 2, 3].map(cs =>
        game.players[FMP.localIdx(cs)].hand.map(c => c.id).join(',')).join(';'),
    }));
    const [sA, sB] = await Promise.all([stateOf(pA), stateOf(pB)]);
    ok(sA.n === 4 && sB.n === 4, `the table is the room's size (${sA.n})`);
    ok(sA.humans === 2 && sB.humans === 2, 'two humans, two AI — the realm filled the seats');
    ok(sA.names.includes('Audit RoomB') && sB.names.includes('Audit RoomA'),
      'friends see each other by name');
    ok(new Set(sA.heroes).size === 4, `no two players share a hero (${sA.heroes.join(', ')})`);
    ok(sA.handsCanon === sB.handsCanon, 'LOCKSTEP: both tables deal identically');

    // Leave no trace.
    await pA.evaluate(async (c) => {
      const gid = FMP.gid();
      FMP.leaveGame();
      if (gid) await firebase.database().ref(`favor/mp/games/${gid}`).remove();
      await firebase.database().ref(`favor/mp/rooms/${c}`).remove();
    }, code);
    await pB.evaluate(() => FMP.leaveGame());

    // Empty room folds on the shrunk clock.
    await pA.evaluate(() => { FMP._T.roomEmpty = 2500; FMODES.openPrivateRoom(); FMODES.hostRoom(); });
    await pA.waitForFunction(() => document.querySelector('#roomOverlay .rm-code'), { timeout: 12000 });
    const emptyCode = await pA.evaluate(() => document.querySelector('#roomOverlay .rm-code').textContent.trim());
    const folded = await pA.waitForFunction(() =>
      !document.querySelector('#roomOverlay .rm-code'), { timeout: 12000 }).then(() => true, () => false);
    const recGone = await pA.evaluate(async (c) =>
      !(await firebase.database().ref(`favor/mp/rooms/${c}`).get()).exists(), emptyCode);
    ok(folded && recGone, 'an empty room folds at the deadline and sweeps its record');

    await ctxA.close(); await ctxB.close();
  } catch (e) {
    ok(false, 'private-room flow crashed', e.message);
  }
}

// ═══ SIDE B: level math, ribbon, the two-step chooser, resolved table ═══
console.log('── Side B: ribbon + badges + chooser + the table rides the B board');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('sideb: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('favor_coach_seen', JSON.stringify(
      ['welcome', 'missions', 'hand', 'skills', 'pass', 'rivals',
       'scorn', 'favor', 'ring', 'melee', 'emblem']));
  });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await page.evaluate(() => {
    window.shuffleArray = (a) => [...a];
    localStorage.setItem('favorQueue', '3');
    window._pinEmblemSeed = 0;
    window._noSoloSave = true;
    localStorage.removeItem('favorSoloSave');
    localStorage.removeItem('favorSidePref');
    localStorage.removeItem('favorOffer');
  });

  // The level curve is pure arithmetic — assert it cold. 7/20 ramp:
  // step(n)=min(75+15(n−1),300) → L2 at 75, L5 (Side B) at 390.
  const lv = await page.evaluate(() => [
    FLB.heroLevel(0), FLB.heroLevel(74), FLB.heroLevel(75),
    FLB.heroLevel(389), FLB.heroLevel(390),
    FLB.heroLevel(10 ** 9), FLB.heroLevelPct(120),
  ]);
  ok(lv[0] === 1 && lv[1] === 1 && lv[2] === 2, `curve anchor: 74→1, 75→2 (${lv.slice(0, 3)})`);
  ok(lv[3] === 4 && lv[4] === 5, `Side B sits at 390 (389→4, 390→5)`);
  ok(lv[5] === 100, 'level caps at 100');
  ok(Math.abs(lv[6] - 50) < 0.01, `mid-level fill reads 50% at 120 fv (${lv[6]})`);

  // Rig the Knight to Level 6 — the chooser must appear for him alone.
  await page.evaluate(() => {
    FLB.heroFv = (id) => id === 'knight' ? 1000 : 0;
    FLB.sideBUnlocked = (id) => id === 'knight';
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal, #title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() =>
    document.querySelectorAll('#characterGrid .character-card').length >= 3, { timeout: 15000 });

  const sel = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#characterGrid .character-card')];
    const byId = {};
    cards.forEach(c => {
      const badge = c.querySelector('.side-badge');
      byId[c.dataset.id] = {
        badge: badge ? badge.textContent.trim() : null,
        lit: !!(badge && badge.classList.contains('lit')),
        ribbon: !!c.querySelector('.hs-xp .rb'),
        lvl: c.querySelector('.hs-xp .rb-num') ? c.querySelector('.hs-xp .rb-num').textContent.trim() : null,
      };
    });
    return byId;
  });
  ok(sel.knight && sel.knight.lit && /Side A ⇄ B/.test(sel.knight.badge),
    `Knight's badge is LIT (${sel.knight && sel.knight.badge})`);
  ok(sel.explorer && sel.explorer.badge === null,
    "Explorer wears NO badge — a locked player must not know Side B exists (7/20 §1)");
  ok(Object.values(sel).every(c => c.ribbon), 'every offered hero wears the ribbon');
  ok(sel.knight.lvl === '8', `Knight's ribbon reads Level 8 at 1,000 Favor on the new curve (${sel.knight.lvl})`);

  // Tap the Knight — the board goes near-fullscreen (7/20 §2), slots
  // spelled out from DATA; the A/B choice lives here.
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('#characterGrid .character-card')]
      .find(x => x.dataset.id === 'knight');
    c.click();
  });
  await sleep(350);
  const detailA = await page.evaluate(() => {
    const el = document.getElementById('charDetail');
    const frame = el.querySelector('.cd-frame');
    const ring = el.querySelector('.cd-ring');
    return {
      active: el.classList.contains('active'),
      strip: !!el.querySelector('.cd-slot'),
      frameW: frame ? Math.round(frame.getBoundingClientRect().width) : 0,
      ring: !!ring,
      ringLeft: ring ? ring.style.left : '',
      tabs: [...el.querySelectorAll('.cd-tab')].map(t => t.textContent.trim()),
      aOn: !!el.querySelector('.cd-tab[data-side="a"].on'),
    };
  });
  ok(detailA.active && !detailA.strip,
    'the detail opens as a compact card — no slot summaries (7/20 pm)');
  ok(detailA.frameW > 0 && detailA.frameW <= 500,
    `the card is COMPACT (${detailA.frameW}px wide ≤ 500)`);
  ok(detailA.ring && detailA.ringLeft === '50%',
    `the ring rides the CENTER slot of the viewed board (${detailA.ringLeft})`);
  ok(detailA.aOn && detailA.tabs.length === 2 && /Oathbreaker/.test(detailA.tabs[1]),
    `the A/B tabs are here, each wearing its epithet (${detailA.tabs.join(' | ')})`);
  await page.screenshot({ path: join(SHOTS, 'sideb-detail-a.png') });

  await page.evaluate(() => document.querySelector('#charDetail .cd-tab[data-side="b"]').click());
  await sleep(250);
  const detailB = await page.evaluate(() => {
    const el = document.getElementById('charDetail');
    return {
      bOn: !!el.querySelector('.cd-tab[data-side="b"].on'),
      art: (el.querySelector('.cd-art img') || {}).src || '',
      ring: !!el.querySelector('.cd-ring'),
    };
  });
  ok(detailB.bOn && /Knight_B\.jpg/.test(detailB.art), 'Side B tab swaps in the real B painting');
  ok(detailB.ring, 'the ring stays on the B board too');
  await page.screenshot({ path: join(SHOTS, 'sideb-detail-b.png') });

  // Back leaves the grid unchanged; re-open and Confirm locks it in.
  await page.evaluate(() => document.getElementById('cdBack').click());
  await sleep(150);
  const backOk = await page.evaluate(() => ({
    closed: !document.getElementById('charDetail').classList.contains('active'),
    selEmpty: !window.selectedCharacter,
  }));
  ok(backOk.closed, 'Back folds the detail without selecting');
  await page.evaluate(() => {
    [...document.querySelectorAll('#characterGrid .character-card')]
      .find(x => x.dataset.id === 'knight').click();
  });
  await sleep(300);
  await page.evaluate(() => document.getElementById('cdConfirm').click());
  await page.waitForFunction(() =>
    document.getElementById('game-screen').classList.contains('active'), { timeout: 20000 });
  await sleep(400);

  const table = await page.evaluate(() => ({
    side: game.players[0].side,
    art: game.players[0].character.filename,
    epithet: game.players[0].character.epithet,
    power: game.players[0].skills.power || 0,
    botSides: game.players.slice(1).map(p => p.side),
    botArts: game.players.slice(1).map(p => p.character.filename),
    pref: (JSON.parse(localStorage.getItem('favorSidePref') || '{}')).knight || null,
    thumb: (document.querySelector('#tvBoardThumb img') || {}).src || '',
  }));
  ok(table.side === 'b', 'the table seats you on Side B');
  ok(table.art === 'Knight_B.jpg' && table.epithet === 'Oathbreaker',
    `your seat rides the B board (${table.art}, ${table.epithet})`);
  ok(table.power === 2, `Knight B's center grants Power 2 (${table.power})`);
  ok(table.botSides.every(s => s === 'a') && table.botArts.every(a => !/_B\.jpg/.test(a)),
    'every bot rides Side A');
  ok(table.pref === 'b', "the confirmed side becomes the hero's default");
  ok(/Knight_B\.jpg/.test(table.thumb) || table.thumb === '',
    'the board thumb shows the B painting');
  await page.screenshot({ path: join(SHOTS, 'sideb-table.png') });

  // §5 (7/20): the slide preview is a NET delta — gains and the leaving
  // slot's losses — measured through the engine.
  const delta = await page.evaluate(() => {
    const p = game.players[0];
    const before = { pos: p.sliderPosition, skills: { ...p.skills }, peak: { ...(p.peakSkills || {}) } };
    // Knight B: center (Power 2) → slot 0 (Knowledge 3, Power 3).
    const d = game.previewSlotDelta(0, 0);
    const after = { pos: p.sliderPosition, skills: { ...p.skills }, peak: { ...(p.peakSkills || {}) } };
    // And the confirm bubble renders the chips. ⚠ _ovSlideTarget is a
    // top-level `let` — bare-name assignment reaches the script binding;
    // window._ovSlideTarget would only shadow it.
    openBoardOverlay();
    _ovSlideTarget = 0;
    renderBoardOvConfirm();
    const bub = document.querySelector('#boardOvConfirm .sc-delta');
    const chips = bub ? [...bub.querySelectorAll('.sc-d')].map(x => x.textContent.trim()) : [];
    const bubbleUp = document.getElementById('boardOvConfirm').classList.contains('active');
    return { d, before, after, chips, bubbleUp };
  });
  ok(delta.d && delta.d.knowledge === 3 && delta.d.power === 1,
    `preview measures the NET move (Knowledge +3, Power +1 → ${JSON.stringify(delta.d)})`);
  ok(delta.before.pos === delta.after.pos
    && JSON.stringify(delta.before.skills) === JSON.stringify(delta.after.skills),
    'the preview is pure — position and skills restored');
  ok(JSON.stringify(delta.before.peak) === JSON.stringify(delta.after.peak),
    'the preview mints no peak telemetry');
  ok(delta.bubbleUp && delta.chips.length === 2,
    `the confirm bubble wears the ± chips (${delta.chips.join(' ')})`);
  await page.screenshot({ path: join(SHOTS, 'slide-delta.png') });
  // A LOSING move reads negative: from slot 0 back to center.
  const delta2 = await page.evaluate(() => {
    game.players[0].sliderPosition = 0;
    game.applySlotSkills(game.players[0]);
    const d = game.previewSlotDelta(0, 2);
    game.players[0].sliderPosition = 2;
    game.applySlotSkills(game.players[0]);
    _ovSlideTarget = null;
    if (typeof closeBoardOverlay === 'function') closeBoardOverlay();
    else document.getElementById('boardOverlay').classList.remove('active');
    return d;
  });
  ok(delta2 && delta2.knowledge === -3 && delta2.power === -1,
    `the leaving slot's loss shows as −N (${JSON.stringify(delta2)})`);

  // §4 (7/20): the mission ceremony must NEVER play under the z-9999
  // action panel — Wyatt's "completed it and went straight to the melee".
  // Force the panel up, fire a real ceremony, and look.
  const occl = await page.evaluate(() => {
    const panel = document.getElementById('actionPanel');
    panel.classList.add('active');
    const m = window.FAVOR_DATA.missions.find(x => x.name === 'A Day With the Birds')
      || window.FAVOR_DATA.missions[0];
    const done = showMissionCeremony([{ playerIndex: 0, results: [{
      mission: m, success: true,
      deltas: { favor: m.favorValue || 10, gold: 0, prestige: 0, scorn: 0, stones: 0, discarded: [], others: [] },
      details: { missing: [] },
    }] }], 2);
    window._ceremonyDone = false;
    done.then(() => { window._ceremonyDone = true; });
    return {
      ceremonyUp: document.getElementById('missionCeremony').classList.contains('active'),
      panelUp: panel.classList.contains('active'),
    };
  });
  ok(occl.ceremonyUp, 'ceremony raised with the action panel previously up');
  ok(!occl.panelUp, 'the panel STEPS ASIDE — the ceremony owns the stage (§4 fix)');
  await sleep(1400);
  await page.screenshot({ path: join(SHOTS, 'mission-ceremony-visible.png') });
  await page.evaluate(() => document.getElementById('missionCeremony').click());  // reveal (guard already past)
  await sleep(500);
  await page.evaluate(() => document.getElementById('missionCeremony').click());  // onward
  await page.waitForFunction(() => window._ceremonyDone === true, { timeout: 15000 });
  const restored = await page.evaluate(() => ({
    panelBack: document.getElementById('actionPanel').classList.contains('active'),
    ceremonyDown: !document.getElementById('missionCeremony').classList.contains('active'),
  }));
  ok(restored.ceremonyDown && restored.panelBack,
    'ceremony closed and the panel came back (mid-act turn-ins keep their panel)');
  await page.evaluate(() => document.getElementById('actionPanel').classList.remove('active'));

  // Victory chip: crossing paints the arrow; not crossing stays quiet.
  const chip = await page.evaluate(() => {
    const content = document.getElementById('scoringContent');
    content.innerHTML = '<div class="vs-head"></div>';
    // 5→6, NOT 4→5: a Side-B-level crossing correctly ARMS the delayed
    // ceremony (t+1400ms), which would then re-raise the overlay mid-way
    // through the dismissal assertions below — this chip test is about the
    // arrow, so it crosses a level the ceremony doesn't care about.
    paintVictoryXp({ charId: 'knight', fvBefore: 980, fvAfter: 1100, levelBefore: 5, levelAfter: 6 });
    const c1 = content.querySelector('.vs-delta.xp');
    const crossed = {
      exists: !!c1, arrow: !!(c1 && c1.querySelector('.vs-d-arrow')),
      fv: c1 ? (c1.querySelector('.vs-d-fv') || {}).textContent : null,
      rb: !!(c1 && c1.querySelector('.rb')),
    };
    content.innerHTML = '<div class="vs-head"></div>';
    paintVictoryXp({ charId: 'knight', fvBefore: 820, fvAfter: 900, levelBefore: 5, levelAfter: 5 });
    const c2 = content.querySelector('.vs-delta.xp');
    return { crossed, flat: { arrow: !!(c2 && c2.querySelector('.vs-d-arrow')) } };
  });
  ok(chip.crossed.exists && chip.crossed.arrow && chip.crossed.rb,
    'a level crossing paints the arrowed chip + ribbon');
  ok(chip.crossed.fv === '+120 Favor', `the chip names the Favor banked (${chip.crossed.fv})`);
  ok(!chip.flat.arrow, 'no crossing → no arrow (3 → 3 reads like a bug)');

  // The Level-5 ceremony: fourth champ dress, the board turns over.
  await page.evaluate(() => {
    const knight = window.FAVOR_DATA.characters.find(c => c.id === 'knight');
    FLB.showSideBCelebration(knight);
  });
  await sleep(1300);
  const champ = await page.evaluate(() => ({
    active: document.getElementById('champOverlay').classList.contains('active'),
    title: document.getElementById('champTitle').textContent,
    flip: !!document.querySelector('#champArt .cf-inner'),
    turned: !!document.querySelector('#champArt .cf-inner.turned'),
    backArt: (document.querySelector('#champArt .cf-back img') || {}).src || '',
  }));
  ok(champ.active && /Turns the Board/.test(champ.title), `the ceremony raises (${champ.title})`);
  ok(champ.flip && champ.turned, 'the board flip runs and lands turned');
  ok(/Knight_B\.jpg/.test(champ.backArt), 'the flip lands on the B painting');
  await page.screenshot({ path: join(SHOTS, 'sideb-ceremony.png') });
  await page.evaluate(() => document.getElementById('champBtn').click());
  await sleep(200);
  // The overlay is a SHARED singleton — a boot-queued dress (daily crown,
  // star delivery) may legitimately raise it again at any moment. MY
  // dismissal is proven by the art stage emptying (done() owns that);
  // asserting on .active would blame this dress for someone else's.
  const after = await page.evaluate(() => ({
    active: document.getElementById('champOverlay').classList.contains('active'),
    title: document.getElementById('champTitle').textContent,
    art: document.getElementById('champArt').innerHTML,
  }));
  ok(after.art === '', 'dismissed — the art stage is left empty for other dresses',
    after.active ? `(overlay re-raised by: "${after.title}")` : '');

  // The earned hero: data-driven lock. A rigged earnedOnly row renders
  // locked on the shelf, refuses purchase, and the latch does NOT fire
  // for an unqualified row. (No real earnedOnly hero exists yet.)
  const store = await page.evaluate(async () => {
    const fake = { id: 'testearn', name: 'The Unnamed', filename: 'Explorer.jpg',
      difficulty: 3, epithet: 'Earned Only', tip: '', earnedOnly: true, slots: [] };
    window.FAVOR_DATA.characters.push(fake);
    const owned = FLB.ownedIds();
    const buy = await FLB.buyCharacter('testearn');
    FLB.openStore();
    await new Promise(r => setTimeout(r, 600));
    const card = document.querySelector('.st-card[data-char="testearn"]');
    const earnTxt = card && card.querySelector('.st-earn');
    FLB.closeStore();
    // Clean stage first — a queued boot dress (daily crown, stars) may hold
    // the singleton; the latch is judged by ITS OWN dress, not by .active.
    document.getElementById('champOverlay').classList.remove('active');
    localStorage.removeItem('favorShownUnlock_testearn');
    await FLB.checkEarnedHero();
    const latchFired = document.getElementById('champOverlay').classList.contains('active')
      && /Answers Your Renown/.test(document.getElementById('champTitle').textContent);
    window.FAVOR_DATA.characters.pop();
    localStorage.removeItem('favorEarned');
    localStorage.removeItem('favorShownUnlock_testearn');
    return { owned: owned.includes('testearn'), why: buy.why,
      shelf: !!card, earnTxt: earnTxt ? earnTxt.textContent : null, latchFired };
  });
  ok(!store.owned, 'an unqualified player does not own the earned hero');
  ok(store.why === 'earned_only', `buyCharacter refuses it outright (${store.why})`);
  ok(store.shelf && /Reach Level 5 with two heroes/.test(store.earnTxt || ''),
    `the shelf lock advertises the goal (${store.earnTxt})`);
  ok(!store.latchFired, 'the unlock latch stays quiet for an unqualified row');

  // 7/20 pm: the throw hint yields to EVERY overlay (:has() gating) — it
  // must vanish while the mission browser is up and return when it folds.
  const hint = await page.evaluate(() => {
    const h = document.getElementById('throwHint');
    h.classList.add('active');
    const shownBefore = getComputedStyle(h).display !== 'none';
    openMissionBrowser('realm');
    const hiddenDuring = getComputedStyle(h).display === 'none';
    closeMissionLB();
    const shownAfter = getComputedStyle(h).display !== 'none';
    h.classList.remove('active');
    return { shownBefore, hiddenDuring, shownAfter };
  });
  ok(hint.shownBefore && hint.hiddenDuring && hint.shownAfter,
    `the drag hint yields to an open overlay and returns after (${JSON.stringify(hint)})`);

  await page.evaluate(() => localStorage.removeItem('favorSidePref'));
  await page.close();
}

// ═══ 7/20 pm: achievements gallery never overlaps — any metrics ═══
console.log('── Achievements gallery: rows size to content at any text metric');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('achfit: ' + m.text()); });
  await page.setViewport({ width: 1024, height: 700 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FACH && window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await page.evaluate(() => FACH.openGallery());
  await page.waitForFunction(() => document.querySelectorAll('.ach-cell').length > 0, { timeout: 8000 })
    .catch(() => {});
  await sleep(300);   // fonts settle — the original bug WAS a font-swap race
  const fit = await page.evaluate(() => {
    const overlaps = () => {
      const cells = [...document.querySelectorAll('.ach-cell')].map(c => c.getBoundingClientRect());
      let n = 0;
      for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i], b = cells[j];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 8
          && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) n++;
      }
      return n;
    };
    const base = overlaps();
    // Simulate a device inflating text (the Overlap.jpg failure mode).
    const st = document.createElement('style');
    st.textContent = '.ach-cell-body b{font-size:23px!important}.ach-cell-body span{font-size:20px!important}.ach-cell-stars{font-size:22px!important}';
    document.head.appendChild(st);
    const inflated = overlaps();
    st.remove();
    FACH.closeGallery();
    return { base, inflated, cells: document.querySelectorAll('.ach-cell').length };
  });
  ok(fit.cells >= 20, `gallery rendered (${fit.cells} cells)`);
  ok(fit.base === 0, `no overlapping cells at base metrics (${fit.base})`);
  ok(fit.inflated === 0, `no overlapping cells with text inflated ~60% (${fit.inflated})`);
  await page.close();
}

// ═══ 7/20 pm: the Court Seal — preview validates, claim swaps the device ═══
console.log('── Court Seal: preview names the row; claim takes the seat');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('seal: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode === 'firebase', { timeout: 15000 });
  const seal = await page.evaluate(async () => {
    const originalUid = FLB.uid();
    const bad = await FLB.previewSeal('not a seal!!');
    const self = await FLB.previewSeal(originalUid);
    const ghost = await FLB.previewSeal('unosuchsealzzzz');
    // A real row to restore into — swept by the integrity gate's uaudit* rule.
    const code = 'uauditseal' + Math.random().toString(36).slice(2, 6);
    await firebase.database().ref(`favor/players/${code}`).set({
      name: 'Seal Bearer', rating: 2310, ratingV: 2, games: 14, stars: 3,
      owned: { doctor: true }, avatar: 'doctor',
    });
    const prev = await FLB.previewSeal(code);
    const claim = prev.ok ? FLB.claimSeal(code, prev.row, { noReload: true }) : { ok: false };
    const after = {
      uid: localStorage.getItem('favorUid'),
      name: localStorage.getItem('favorName'),
      avatar: localStorage.getItem('favorAvatar'),
      owned: JSON.parse(localStorage.getItem('favorOwned') || '[]'),
    };
    // Put the page back on its own identity and sweep the fixture row.
    localStorage.setItem('favorUid', originalUid);
    localStorage.removeItem('favorName');
    localStorage.removeItem('favorAvatar');
    localStorage.setItem('favorOwned', '[]');
    await firebase.database().ref(`favor/players/${code}`).remove();
    return { bad: bad.why, self: self.why, ghost: ghost.why,
      prevOk: prev.ok, prevName: prev.name, claimOk: claim.ok, after, code };
  });
  ok(seal.bad === 'shape', `garbage is refused by shape (${seal.bad})`);
  ok(seal.self === 'self', `your own seal is refused (${seal.self})`);
  ok(seal.ghost === 'unknown', `an unclaimed seal finds no court (${seal.ghost})`);
  ok(seal.prevOk && seal.prevName === 'Seal Bearer', `preview names the account (${seal.prevName})`);
  ok(seal.claimOk && seal.after.uid === seal.code, 'claim swaps this device onto the seal');
  ok(seal.after.name === 'Seal Bearer' && seal.after.avatar === 'doctor'
    && seal.after.owned.includes('doctor'),
    'name, crest and owned heroes ride along');
  await page.close();
}

// ═══ FINAL INTEGRITY GATE: no audit run may leave a mark on a REAL row ═══
// Personas post daily scores as of 7/18, which opens a contamination path
// that did not exist before: an audit game that seated a real persona would
// write favor/daily/{key}/scores/persona_* into the LIVE tree, and that row
// would rank on Daily and Top Scores as a score no human ever played.
// startGame pins _pinEmblemSeed, which leaves `seed` null and seats no
// personas at all — but that is one flag away from being wrong, so it is
// checked rather than assumed. The never-delete rule protects the permanent
// players/persona_* ROW; a daily entry is disposable, so anything found
// inside this run's window is swept. Bounded by RUN_START so a legitimate
// persona score from a real game is never destroyed.
{
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  const contam = await page.evaluate(async (since) => {
    const db = firebase.database();
    const days = (await db.ref('favor/daily').get()).val() || {};
    const hits = [];
    for (const [key, day] of Object.entries(days)) {
      for (const [u, s] of Object.entries((day && day.scores) || {})) {
        if (u.startsWith('persona_') && s && (s.at || 0) >= since) {
          hits.push(`${key}/${u} (best ${s.best})`);
          await db.ref(`favor/daily/${key}/scores/${u}`).remove();
        }
      }
    }
    // uaudit* rows are audit residue by construction — no real player can be
    // named one. Sweep any straggler, then assert the sweep worked. (Two
    // uauditcrest rows had been sitting in the live tree since the 7/18
    // flaked run; the boards filter them by name, so they were invisible
    // rather than harmless.)
    // ⚠ AND the daily BOARDS, not just the player rows. This gate swept
    // players only until 2026-07-18, when six leftover 'Audit Herald' daily
    // rows outranked every real player but two and settleDue paid one of them
    // bronze — a crown and 10 Stars taken from a human. podiumSort now
    // filters them defensively, but the residue should not exist at all.
    const dailyStray = [];
    for (const [key, day] of Object.entries(days)) {
      for (const u of Object.keys((day && day.scores) || {})) {
        if (/^(uaudit|uqa)/.test(u)) {
          dailyStray.push(`${key}/${u}`);
          await db.ref(`favor/daily/${key}/scores/${u}`).remove();
        }
      }
    }
    const before = Object.keys((await db.ref('favor/players').get()).val() || {})
      .filter(u => /^(uaudit|uqa)/.test(u));
    for (const u of before) await db.ref(`favor/players/${u}`).remove();
    await new Promise(r => setTimeout(r, 400));
    const stray = Object.keys((await db.ref('favor/players').get()).val() || {})
      .filter(u => /^(uaudit|uqa)/.test(u));
    return { hits, swept: before, stray, dailyStray };
  }, RUN_START);
  ok(contam.hits.length === 0,
    `no REAL persona posted a daily score during this run (${contam.hits.join(', ') || 'clean'})`);
  ok(contam.stray.length === 0,
    `favor/players carries no uaudit*/uqa* residue (swept ${contam.swept.length}: ${contam.swept.join(', ') || 'none'})`);
  ok(true, `daily boards swept of ${contam.dailyStray.length} audit row(s)${contam.dailyStray.length ? ': ' + contam.dailyStray.slice(0, 6).join(', ') : ''}`);
  await page.close();
}

ok(consoleErrors.length === 0, 'zero console errors across all flows', consoleErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${fail === 0 ? `✅ UI AUDIT: ${pass} checks passed — now LOOK at tools/audit-shots/` : `❌ UI AUDIT: ${fail} FAILED, ${pass} passed`}`);
process.exit(fail ? 1 : 0);
