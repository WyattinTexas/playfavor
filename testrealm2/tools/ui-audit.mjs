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

const URL = process.env.AUDIT_URL || 'http://localhost:8891/testrealm2/';
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
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
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
  });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
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

// ═══ PHONE: touch glide must bloom exactly ONE card ═══
console.log('── Phone: glide blooms exactly one card (no sticky-hover double)');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('phone: ' + m.text()); });
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await startGame(page);
  await sleep(500);   // strip is always open — nothing to raise

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
  console.log('── Phone: drag a card up and release → action sheet');
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
    buttons: [...document.querySelectorAll('.action-panel .action-btn')].map(b => b.textContent.trim()),
    dragLeft: !!document.querySelector('.hand-card.dragging'),
  }));
  ok(committed.panel, 'release up top opens the action sheet');
  ok(committed.buttons.some(t => /discard \(\+3g\)/i.test(t)),
    `sheet offers the choices (${committed.buttons.slice(0, 3).join(' · ') || 'none'})`);
  ok(!committed.dragLeft, 'the card snapped home');
  await page.screenshot({ path: join(SHOTS, 'phone-drag-commit.png') });
  await page.evaluate(() => { window._finalChoicePending = false; hideActionPanel(); });
  await sleep(300);

  // Plain tap = read only, never the sheet.
  await page.touchscreen.touchStart(centers[0], y);
  await sleep(150);
  await page.touchscreen.touchEnd();
  await sleep(450);
  ok(await page.evaluate(() => !document.querySelector('.action-panel.active')),
    'a plain tap opens nothing');

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
  await page.touchscreen.touchEnd();
  await sleep(500);
  const pickedRight = await page.evaluate(() => ({
    panel: !!document.querySelector('.action-panel.active'),
    sel: selectedHandCard,
  }));
  ok(pickedRight.panel && pickedRight.sel === 2, `the sheet opens for that same card (selected #${pickedRight.sel})`);
  await page.evaluate(() => { window._finalChoicePending = false; hideActionPanel(); });
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

  // Rival chip → board (ring on its track) + played cards, all at once;
  // no stat pills, no reveal toggle — board + cards only.
  await page.evaluate(() => document.querySelector('#tvSeats .pmat.opp').click());
  await sleep(400);
  const opp = await page.evaluate(() => {
    const ring = document.getElementById('oppOvRing');
    const wrap = ring ? ring.parentElement.getBoundingClientRect() : null;
    const r = ring ? ring.getBoundingClientRect() : null;
    const vis = el => !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
    return {
      active: document.getElementById('oppOverlay').classList.contains('active'),
      stacks: document.querySelectorAll('#oppOvStacks .tv-stack-card').length,
      played: game.players[1].playedCards.length,
      ringShown: vis(ring) && r.width > 4,
      ringPct: ring ? ((r.left + r.width / 2 - wrap.left) / wrap.width) * 100 : -1,
      expectPct: BOARD_OV_TRACK.lefts[game.players[1].sliderPosition],
      statsShown: vis(document.getElementById('oppOvStats')),
      toggleShown: vis(document.getElementById('oppOvToggle')),
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
  ok(!opp.statsShown, 'no stat pills — board + cards is all that is revealed');
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

  // Panel-aside: hand panel up → rival chip → panel steps aside → returns on close.
  await page.evaluate(() => selectHandCard(0));
  await sleep(300);
  ok(await page.evaluate(() => document.getElementById('actionPanel').classList.contains('active')), 'action panel opens for a hand card');
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
  await page.evaluate(() => { window._finalChoicePending = false; hideActionPanel(); });

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
      firstIsWelcome: /chip is/i.test(c.textContent),
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
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card') && document.querySelector('.character-card').offsetParent, { timeout: 20000 });
  await page.evaluate(() => {
    localStorage.setItem('favorQueue', '5');   // the menu queue picker owns table size now
    document.querySelector('.character-card').click();
  });
  await page.waitForFunction(() => document.getElementById('confirmBtn') && document.getElementById('confirmBtn').offsetParent, { timeout: 20000 });
  await page.evaluate(() => document.getElementById('confirmBtn').click());
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

  // Pick card 0 through the REAL panel.
  await page.evaluate(() => selectHandCard(0));
  await sleep(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.action-panel .action-btn')].find(x => /play/i.test(x.textContent) && !x.disabled);
    b.click();
  });

  // The FINAL card must present a choice panel, not auto-resolve.
  let choiceShown = false;
  try {
    await page.waitForFunction(() =>
      document.querySelector('.action-panel.active') &&
      /final card/i.test(document.querySelector('.action-panel').textContent), { timeout: 9000 });
    choiceShown = true;
  } catch (e) {}
  await page.screenshot({ path: join(SHOTS, 'final-card-choice.png') });
  ok(choiceShown, 'final card shows its own action panel');

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

// ═══ HERO SELECT: three choices, picking auto-scrolls to Begin ═══
console.log('── Hero select: 3 random heroes, bots draw from the leftovers, scroll to Begin');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('hero-select: ' + m.text()); });
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    return b && b.offsetParent;
  }, { timeout: 20000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
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

  // Pick the LAST card and let the auto-scroll carry Begin into view.
  await page.evaluate(() => {
    const cards = document.querySelectorAll('.character-card');
    cards[cards.length - 1].click();
  });
  await sleep(900);   // smooth scroll settles
  const after = await page.evaluate(() => {
    const b = document.getElementById('confirmBtn');
    const r = b.getBoundingClientRect();
    return { shown: b.style.display !== 'none',
             inView: r.top >= 0 && r.bottom <= window.innerHeight + 1,
             top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
  });
  ok(after.shown, 'Begin Your Journey appears on pick');
  ok(after.inView, `auto-scroll carries Begin into the viewport (${after.top}..${after.bottom} in ${after.vh})`);
  await page.screenshot({ path: join(SHOTS, 'hero-select-3.png') });

  // Begin works, and every bot drew from the seven NON-offered heroes.
  const drew = await page.evaluate(() => {
    const offered = [...document.querySelectorAll('.character-card')].map(c => c.dataset.id);
    document.getElementById('confirmBtn').click();
    return offered;
  });
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 20000 });
  const bots = await page.evaluate(() =>
    game.players.slice(1).map(p => p.character.id));
  const youTook = drew[drew.length - 1];
  ok(bots.every(id => !drew.includes(id)),
    `bots drew from the leftovers (${bots.join(', ')} ∉ offered ${drew.join(', ')})`);
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
    return {
      open: document.getElementById('oppOverlay').classList.contains('active'),
      boardBig: board.height > 250,
      ringOnBoard: ring.width > 10 && ring.left > board.left && ring.right < board.right,
      ringLeft: document.getElementById('oppOvRing').style.left,
      cards: document.querySelectorAll('#oppOvCards img').length,
      pillArt: document.querySelectorAll('#oppOvStats .pill-icon').length,
    };
  });
  ok(ov.open, 'REAL click on the rail opens the rival overlay');
  ok(ov.boardBig, 'overlay board is big (desktop)');
  ok(ov.ringOnBoard && ov.ringLeft === '66.3%', `their ring rides the board track (${ov.ringLeft})`);
  ok(ov.cards === 3, `all played cards shown (${ov.cards})`);
  ok(ov.pillArt === 4, 'overlay stats use real token art');
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

  // Selected state must not depend on the mouse still hovering: the layout
  // bump has to fire for .selected on its own.
  await page.mouse.move(5, 400);           // park the mouse away from the hand
  await sleep(250);
  await page.evaluate(() => selectHandCard(0));
  await sleep(350);
  const selLayer = await page.evaluate(() => {
    const layout = document.querySelector('.game-layout');
    const z = parseInt(getComputedStyle(layout).zIndex, 10);
    const pillZ = parseInt(getComputedStyle(document.getElementById('phaseBar')).zIndex, 10);
    return { z, pillZ, selected: !!document.querySelector('.hand-card.selected') };
  });
  ok(selLayer.selected, 'a hand card is selected (fixture valid)');
  ok(selLayer.z > selLayer.pillZ,
    `.game-layout outranks the pill while a card is selected (${selLayer.z} > ${selLayer.pillZ})`);
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
  await page.evaluate(() => closeMissionLB());
  await sleep(200);

  // From YOUR pip: current + completed; Turn In only on the held one —
  // and a held LIFE ESSENCE survives the whole browse (the old lightbox
  // consumed it just to label the button).
  const mine = await page.evaluate(() => {
    const p = game.players[0];
    p.removeMissionRequirements = true;   // Life Essence held
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
    essence: game.players[0].removeMissionRequirements,
  }));
  ok(mineView.title === 'Your Missions', 'your pip opens YOUR set');
  ok(mineView.cards === 2, `current + completed laid out (${mineView.cards})`);
  ok(mineView.focusLabel === mine.held && mineView.turnIn, 'held mission focused with Turn In attached');
  ok(mineView.essence === true, 'opening the browser did NOT consume the Life Essence');
  await page.evaluate(() => mbStep(1));
  await sleep(500);
  const doneView = await page.evaluate(() => ({
    label: document.getElementById('missionLBLabel').textContent,
    turnIn: !!document.getElementById('missionTurnIn'),
    essence: game.players[0].removeMissionRequirements,
    gold: game.players[0].gold,
  }));
  ok(/completed/.test(doneView.label) && !doneView.turnIn, 'completed mission shows no Turn In');
  ok(doneView.essence === true && doneView.gold === mine.goldBefore,
    'browsing every card moved nothing (essence held, gold unchanged)');
  await page.screenshot({ path: join(SHOTS, 'mission-browser-mine.png') });
  await page.evaluate(() => { game.players[0].removeMissionRequirements = false; closeMissionLB(); });
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
  await page.evaluate(() => selectHandCard(0));
  await sleep(300);
  const panelBefore = await page.evaluate(() => document.querySelector('.action-panel').classList.contains('active'));
  await page.evaluate(() => document.querySelector('.tv-mission').click());
  await sleep(600);
  const mid = await page.evaluate(() => ({
    open: document.getElementById('missionLB').classList.contains('active'),
    cards: document.querySelectorAll('#mbTrack .mb-card').length,
    panel: document.querySelector('.action-panel').classList.contains('active'),
  }));
  ok(panelBefore, 'action panel was up (fixture valid)');
  ok(mid.open && mid.cards >= 2, `rail thumb opens the realm browser (${mid.cards} cards)`);
  ok(!mid.panel, 'action panel steps aside while the browser has the stage');
  await page.screenshot({ path: join(SHOTS, 'mission-browser-phone.png') });
  await page.evaluate(() => closeMissionLB());
  await sleep(300);
  const panelAfter = await page.evaluate(() => document.querySelector('.action-panel').classList.contains('active'));
  ok(panelAfter, 'action panel restores after the browser closes');
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
    selectHandCard(0);
  });
  await sleep(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.action-panel .action-btn')].find(x => /play/i.test(x.textContent) && !x.disabled);
    b.click();
  });

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

  await page.evaluate(() => selectHandCard(0));
  await sleep(300);
  const played = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.action-panel .action-btn')]
      .find(x => /mission letter/i.test(x.textContent) && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  });
  ok(played, 'letter #1 played through the hand panel');

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
    else await page.mouse.click(850, 500);
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

  // Slide right (pay 5g) — the thumb must follow without reopening anything.
  await page.evaluate(() => { game.players[0].gold = 30; payToSlide(1); });
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
  await page.evaluate(() => selectHandCard(0));
  await sleep(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.action-panel .action-btn')].find(x => /discard \(\+3g\)/i.test(x.textContent));
    b.click();
  });

  let chooser = false;
  try {
    await page.waitForFunction(() =>
      document.getElementById('promisePicker').classList.contains('active') &&
      /Mission Due/i.test(document.getElementById('promisePicker').textContent), { timeout: 18000 });
    chooser = true;
  } catch (e) {}
  ok(chooser, 'borrow chooser pauses the mission phase');

  if (chooser) {
    const offer = await page.evaluate(() => ({
      yes: document.getElementById('borrowYes')?.textContent.trim(),
      no: document.getElementById('borrowNo')?.textContent.trim(),
      art: !!document.querySelector('#promisePicker .pp-card img'),
    }));
    ok(/Borrow & Complete \(−2g\)/.test(offer.yes || ''), `offer prices the gap (${offer.yes})`);
    ok(/Let it Fail/i.test(offer.no || ''), 'declining stays a real option');
    ok(offer.art, 'the mission card itself is shown');
    await page.screenshot({ path: join(SHOTS, 'mission-borrow-chooser.png') });

    const before = await page.evaluate(() => ({ gold: game.players[0].gold, lender: game.players[1].gold }));
    await page.evaluate(() => document.getElementById('borrowYes').click());
    await sleep(150);
    const after = await page.evaluate(() => ({
      completed: game.players[0].completedMissions.length,
      failed: game.players[0].failedMissions.length,
      gold: game.players[0].gold,
      lender: game.players[1].gold,
      closed: !document.getElementById('promisePicker').classList.contains('active'),
    }));
    ok(after.completed === 1 && after.failed === 0, 'Borrow & Complete completes the mission');
    ok(after.gold === before.gold - 2 && after.lender === before.lender + 2,
      `2g fee moved to the lender (you ${before.gold}→${after.gold}, lender ${before.lender}→${after.lender})`);
    ok(after.closed, 'chooser closes; the act rolls on');
  }
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
  await page.evaluate(() => selectHandCard(0));
  await sleep(300);

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
  }));
  ok(afterEsc.ovClosed && afterEsc.panelBack && afterEsc.hand === 3,
    'Escape cancels back to the action panel, card untouched');

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
  await page.evaluate(() => selectHandCard(0));
  await sleep(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.action-panel .action-btn')].find(x => /play/i.test(x.textContent) && !x.disabled);
    b.click();
  });

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
  const AUDIT_UID = 'uaudit' + Math.random().toString(36).slice(2, 8);
  const PAST_KEY = '2020-01-02';   // synthetic long-dead window, never collides
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('menu: ' + m.text()); });
  // Seed identity BEFORE meta.js boots (runs on every navigation).
  await page.evaluateOnNewDocument((u) => {
    localStorage.setItem('favorUid', u);
    localStorage.setItem('favorName', 'Audit Herald');
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

  // Menu renders: Play Now, queue picker, Leaderboard, profile chip.
  const menu = await page.evaluate(() => ({
    mode: FLB.mode,
    play: !!([...document.querySelectorAll('#title-screen .btn-royal')].find(b => /play now/i.test(b.textContent))),
    queue: !!document.getElementById('queueSelect'),
    queueOpts: [...document.querySelectorAll('#queueSelect option')].map(o => o.textContent.trim()),
    lbBtn: !!([...document.querySelectorAll('#title-screen .btn-royal')].find(b => /leaderboard/i.test(b.textContent))),
    howto: !!([...document.querySelectorAll('#title-screen .btn-royal')].find(b => /how to play/i.test(b.textContent))),
    promptTest: !!document.getElementById('promptTestToggle'),
    chip: document.getElementById('profileChip').textContent.trim(),
    oldDropdownGone: !document.getElementById('playerCountSelect'),
  }));
  console.log(`   (leaderboard backend: ${menu.mode})`);
  ok(menu.play && menu.lbBtn && menu.queue, 'menu renders Play Now + queue picker + Leaderboard');
  ok(menu.queueOpts.join('|') === '3 Players|4 Players|5 Players', `queue offers the three tables (${menu.queueOpts.join(', ')})`);
  ok(menu.howto && menu.promptTest, "How to Play + Prompt Test survive (Skylar's tutorial hooks)");
  ok(/Audit Herald/.test(menu.chip), `profile chip carries the royal name (${menu.chip.split('\n')[0]})`);
  ok(menu.oldDropdownGone, 'player-count dropdown is gone from character select');
  await page.screenshot({ path: join(SHOTS, 'menu-desktop.png') });

  // Queue choice persists.
  await page.evaluate(() => { const s = document.getElementById('queueSelect'); s.value = '4'; s.onchange(); });
  ok(await page.evaluate(() => FLB.queueSize()) === 4, 'queue picker persists the chosen table size');

  // Rating points table (+25 / +10 / −10 / 0 middle).
  const pts = await page.evaluate(() => [
    FLB.ratingDelta(0, 3), FLB.ratingDelta(1, 3), FLB.ratingDelta(2, 3),
    FLB.ratingDelta(2, 5), FLB.ratingDelta(4, 5),
  ]);
  ok(pts.join(',') === '25,10,-10,0,-10', `rating points table (+25/+10/mid 0/last −10) → ${pts.join(',')}`);

  // A finished game posts rating + daily best; bots never post.
  await page.evaluate(async () => {
    await FLB.postGameResult([
      { name: 'You', finalScore: 55 },
      { name: 'Prince Aldric', finalScore: 40 },
      { name: 'Lady Elara', finalScore: 30 },
    ]);
  });
  await sleep(600);
  await page.evaluate(() => FLB.openLeaderboard('alltime'));
  await sleep(900);
  const at = await page.evaluate(() => document.getElementById('lbBody').textContent);
  ok(/Audit Herald/.test(at) && /25/.test(at), 'ALL-TIME shows your rating (+25 for the win)');
  ok(!/Aldric|Elara|Cassius/.test(at), 'bots stay OFF the leaderboard');
  await page.evaluate(() => FLB.openLeaderboard('daily'));
  await sleep(900);
  const daily = await page.evaluate(() => document.getElementById('lbBody').textContent);
  ok(/Audit Herald/.test(daily) && /55/.test(daily), 'DAILY shows your best single-game Favor (55)');
  await page.screenshot({ path: join(SHOTS, 'leaderboard.png') });
  await page.evaluate(() => FLB.closeLeaderboard());

  // Rename persists (profile panel).
  await page.evaluate(() => FLB.openProfile());
  await sleep(400);
  await page.evaluate(() => { document.getElementById('pfName').value = 'Sir Auditsworth'; });
  await page.evaluate(() => document.getElementById('pfSave').click());
  await sleep(700);
  const renamed = await page.evaluate(() => ({
    chip: document.getElementById('profileChip').textContent,
    stored: localStorage.getItem('favorName'),
  }));
  ok(/Sir Auditsworth/.test(renamed.chip) && renamed.stored === 'Sir Auditsworth', 'rename persists to chip + storage');

  // Daily Champion: plant a long-past window, then a FRESH LOAD must
  // settle it, award stars, and greet the champion with the overlay.
  await page.evaluate(async (KEY) => {
    const me = FLB.uid();
    if (FLB.mode === 'firebase') {
      await firebase.database().ref(`favor/daily/${KEY}/scores/${me}`)
        .set({ name: 'Sir Auditsworth', best: 61, at: 1577934245000 });
      await firebase.database().ref(`favor/settled/${KEY}`).remove();
    } else {
      const t = JSON.parse(localStorage.getItem('favorLB') || '{}');
      t.daily = t.daily || {};
      t.daily[KEY] = { scores: { [me]: { name: 'Sir Auditsworth', best: 61, at: 1577934245000 } } };
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
  ok(/1/.test(standing.replace('Sir Auditsworth', '')), 'crown count rides the chip next to the rating');

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
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.top < window.innerHeight; };
    const play = [...document.querySelectorAll('#title-screen .btn-royal')].find(b => /play now/i.test(b.textContent));
    return {
      play: vis(play),
      queue: vis(document.getElementById('queueSelect')),
      chip: vis(document.getElementById('profileChip')),
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  ok(m.play && m.queue && m.chip, 'Play Now + queue + profile chip all reachable on a phone');
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

  // 1 · Royal Hilt (neighbors only)
  await page.evaluate(() => selectHandCard(0));
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
  await page.evaluate(() => selectHandCard(1));
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

  // 3 · Inert card → nothing marked; close → everything clears.
  await page.evaluate(() => selectHandCard(2));
  await sleep(250);
  m = await readMarks(sel);
  ok(m.total === 0, `First Aid marks nobody (${m.total} marks)`);
  await page.evaluate(() => { selectHandCard(0); });
  await sleep(250);
  await page.evaluate(() => hideActionPanel());
  await sleep(150);
  const after = await page.evaluate(() => ({
    reads: document.querySelectorAll('.nt-read').length,
    tags: document.querySelectorAll('.nt-tag').length,
  }));
  ok(after.reads === 0 && after.tags === 0, 'panel close clears every ring and tag');
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
    return { cardName: reqCard.name, skill, lenderGold: game.players[1].gold,
             otherGold: game.players[game.playerCount - 1].gold, n: game.playerCount };
  });
  ok(!!rig, 'rig found a controllable one-skill-short card', 'no candidate — data drifted?');

  // A · Tap-a-neighbor regression: select the reader card (index 1) so the
  // ◀▶ tags appear, then tap the RIGHT chip/tag — the rival peek must open
  // and the panel must come back with the selection intact.
  await page.evaluate(() => selectHandCard(1));
  await sleep(350);
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
    sel: selectedHandCard,
  }));
  ok(peek.opp, 'tapping the neighbor arrow/chip opens the rival peek');
  ok(peek.panelAside, 'panel steps aside under the peek');
  ok(peek.sel === 1, `selection survives (${peek.sel})`);
  await page.evaluate(() => closeOppOverlay());
  await sleep(450);
  const back = await page.evaluate(() => ({
    panel: document.querySelector('.action-panel').classList.contains('active'),
    sel: selectedHandCard,
  }));
  ok(back.panel && back.sel === 1, 'closing the peek restores the panel — nothing disappears');

  // B · The chooser: Borrow & Play first, THEN whom.
  await page.evaluate(() => selectHandCard(0));
  await sleep(350);
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

  // Cancel lands back on the card.
  await page.evaluate(() => document.getElementById('bwCancel').click());
  await sleep(450);
  const cancel = await page.evaluate(() => ({
    ovGone: !document.getElementById('promisePicker').classList.contains('active'),
    panel: document.querySelector('.action-panel').classList.contains('active'),
    sel: selectedHandCard,
    hand: game.players[0].hand.length,
  }));
  ok(cancel.ovGone && cancel.panel && cancel.sel === 0 && cancel.hand === 3,
    'Cancel returns to the action panel, card untouched', JSON.stringify(cancel));

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

  await page.evaluate(() => {
    const p = game.players[0];
    p.gold = 70;                                // Wyatt's scenario: plenty of gold
    p.sliderPosition = 2;
    p.claimedSlots = new Set([0, 1, 2, 3, 4]);  // pre-claimed: fee math stays pure
    game.pendingActivations = new Array(game.playerCount).fill(null);
    renderGameState();
    document.querySelectorAll('.game-toast').forEach(t => t.remove());
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
    ok(after.pos === 1 && after.gold === 15, `DRAG: pay & slide lands (slot ${after.pos + 1}, ${after.gold}g)`);
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
  // zero favor, so these values ARE the finish order.
  const rigScoring = (pg, youFavor, p1Favor, p2Favor) => pg.evaluate((a, b, c) => {
    game.players[0].favor = a;
    game.players[1].favor = b;
    game.players[2].favor = c;
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
  const win = await page.evaluate(() => ({
    headline: (document.querySelector('.vs-headline') || {}).textContent,
    personal: (document.querySelector('.vs-personal') || {}).textContent,
    rays: !!document.querySelector('.vs-head.win .champ-rays'),
    oldH1: !!document.querySelector('#scoring-screen .select-title'),
    places: [...document.querySelectorAll('.vs-place')].map(el => ({
      cls: el.className, trophy: !!el.querySelector('svg.vs-trophy'),
      name: el.querySelector('.vs-name').textContent,
    })),
    ratingDelta: (document.querySelector('.vs-delta.rating b') || {}).textContent,
    ratingNew: (document.querySelector('.vs-delta.rating .vs-d-new') || { dataset: {} }).dataset.total,
    starDelta: (document.querySelector('.vs-delta.stars b') || {}).textContent,
    starNew: (document.querySelector('.vs-delta.stars .vs-d-new') || { dataset: {} }).dataset.total,
    tableCls: [...document.querySelectorAll('.scoring-table tr')].slice(1).map(r => r.className),
    playAgain: !!([...document.querySelectorAll('.scoring-actions .btn-royal')].find(b => /play again/i.test(b.textContent))),
    hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  ok(win.headline === 'You Are Victorious!', `win headline (${win.headline})`);
  ok(win.rays, 'gold rays crown a human win');
  ok(win.personal === 'The realm bows before its new sovereign.', `win personal line (${win.personal})`);
  ok(!win.oldH1, '"The Queen Has Decided" h1 is gone');
  ok(win.places.length === 3, `placement ladder rows = table size (${win.places.length})`);
  ok(/\bp1\b/.test(win.places[0].cls) && win.places[0].trophy && win.places[0].name === 'You',
    '1st row: gold class + trophy + You');
  ok(/\bp2\b/.test(win.places[1].cls) && win.places[1].trophy, '2nd row: silver class + trophy');
  ok(/\bp3\b/.test(win.places[2].cls) && win.places[2].trophy, '3rd row: bronze class + trophy');
  ok(win.ratingDelta === '+25', `rating delta reads +25 (${win.ratingDelta})`);
  ok(win.ratingNew === '25', `fresh player's new rating target = 25 (${win.ratingNew})`);
  ok(win.starDelta === '+10', `win pays +10 Stars (${win.starDelta})`);
  ok(win.starNew === '10', `fresh player's star target = 10 (${win.starNew})`);
  ok(win.tableCls.every((c, i) => c.includes(['vs-p1', 'vs-p2', 'vs-p3'][i])),
    `breakdown rows wear placement colors (${win.tableCls.join(' · ')})`);
  ok(win.playAgain, 'Play Again survives');
  ok(!win.hscroll, 'no horizontal scroll');

  // Count-up actually lands on the totals.
  await sleep(1500);
  const landed = await page.evaluate(() => ({
    top: (document.querySelector('.vs-place.p1 .vs-total') || {}).textContent,
    target: (document.querySelector('.vs-place.p1 .vs-total') || { dataset: {} }).dataset.total,
    rating: (document.querySelector('.vs-delta.rating .vs-d-new') || {}).textContent,
  }));
  ok(landed.top === landed.target && landed.rating === '25',
    `count-up lands (score ${landed.top}/${landed.target}, rating ${landed.rating})`);
  await page.screenshot({ path: join(SHOTS, 'vs-desktop-win.png') });

  // ── NON-WIN (finish 3rd) — startGame navigates fresh ──
  await startGame(page);
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
  await rigScoring(page, 5, 100, 50);
  await sleep(300);
  const loss = await page.evaluate(() => ({
    headline: (document.querySelector('.vs-headline') || {}).textContent,
    rays: !!document.querySelector('.vs-head .champ-rays'),
    personal: (document.querySelector('.vs-personal') || {}).textContent,
    myRow: ((document.querySelector('.vs-place.me') || {}).className || ''),
    ratingDelta: (document.querySelector('.vs-delta.rating b') || {}).textContent,
  }));
  ok(/Claims the Throne$/.test(loss.headline) && !/You/.test(loss.headline),
    `rival win headline (${loss.headline})`);
  ok(!loss.rays, 'no rays when a rival takes the throne');
  ok(loss.personal === 'You finished 3rd.', `personal line (${loss.personal})`);
  ok(/\bp3\b/.test(loss.myRow), 'your row wears bronze in 3rd');
  ok(loss.ratingDelta === '−10', `last place reads −10 (${loss.ratingDelta})`);
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
    await firebase.database().ref(`favor/players/${u}`).remove();
    // Sweep EVERY daily key — a run straddling the 22:00 ET boundary
    // posts on one key while a KEY recomputed later points at another,
    // and residue on yesterday's board would get CROWNED at settlement.
    const days = (await firebase.database().ref('favor/daily').get()).val() || {};
    for (const k of Object.keys(days)) {
      await firebase.database().ref(`favor/daily/${k}/scores/${u}`).remove();
    }
    const p = await firebase.database().ref(`favor/players/${u}`).get();
    const d = await firebase.database().ref(`favor/daily/${KEY}/scores/${u}`).get();
    return (!p.exists() && !d.exists()) ? 'clean' : 'RESIDUE';
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
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      btnReachable: vis(btn),
      screenScrolls: document.getElementById('scoring-screen').scrollHeight >= document.getElementById('scoring-screen').clientHeight,
    };
  });
  ok(pfit.headline && pfit.deltas, 'phone: headline + rating delta visible');
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

  // Menu carries the Store button; Skylar's hooks survive beside it.
  const menu = await page.evaluate(() => ({
    store: !!([...document.querySelectorAll('#title-screen .btn-royal')].find(b => /store/i.test(b.textContent))),
    howto: !!([...document.querySelectorAll('#title-screen .btn-royal')].find(b => /how to play/i.test(b.textContent))),
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

  // Hero select draws ONLY from owned — and the Duchess now shows up.
  const pool = await page.evaluate(() => {
    const owned = new Set(FLB.ownedIds());
    let allOwned = true, duchessSeen = false;
    for (let i = 0; i < 20; i++) {
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
    await firebase.database().ref(`favor/players/${FLB.uid()}`).remove();
    const days = (await firebase.database().ref('favor/daily').get()).val() || {};
    for (const k of Object.keys(days)) {   // all keys — see boundary note above
      await firebase.database().ref(`favor/daily/${k}/scores/${FLB.uid()}`).remove();
    }
    const p = await firebase.database().ref(`favor/players/${FLB.uid()}`).get();
    return p.exists() ? 'RESIDUE' : 'clean';
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
  await phone.screenshot({ path: join(SHOTS, 'store-phone.png') });
  await phone.close();
}

ok(consoleErrors.length === 0, 'zero console errors across all flows', consoleErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${fail === 0 ? `✅ UI AUDIT: ${pass} checks passed — now LOOK at tools/audit-shots/` : `❌ UI AUDIT: ${fail} FAILED, ${pass} passed`}`);
process.exit(fail ? 1 : 0);
