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
    // Pin the Emblem seed: seat 0, personas OFF, no boon — every rig below
    // assumes the human acts first and the table is the four generic bots.
    // The emblem/persona/boon flow rigs its own seed and skips this pin.
    window._pinEmblemSeed = 0;
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
    // Layout flow — pin the seed (seat 0, no personas, no boon) so chip
    // sizes and zone fits never depend on who happened to sit down.
    window._pinEmblemSeed = 0;
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
    p.playedCards = [pick('Great North Connection'), pick('Concoction'),
                     pick('Mining Guild'), pick("Philosopher's Stone")];
    renderGameState();
  });
  await sleep(400);
  const st = await page.evaluate(() => ({
    labels: [...document.querySelectorAll('#cardStacks .stack-label')].map(l => l.textContent),
    colored: [...document.querySelectorAll('#cardStacks .card-stack')]
      .every(s => (s.getAttribute('style') || '').includes('--typeC')),
  }));
  ok(st.labels.join('|') === 'Adventures|Artifacts|Endeavors|Potions',
    `stacks read by family, the potion is on the field (${st.labels.join(', ')})`);
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
  await page.evaluate(() => playSelectedCard(0));

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
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    return b && b.offsetParent;
  }, { timeout: 20000 });
  await page.evaluate(() => {
    // This flow keeps the REAL seed path (offer/seating fuzz) but must
    // not enter the live matchmaking queue.
    window._mpSkipQueue = true;
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
  // The ring is a fixture of the CENTER slot — the tapped hero glided in.
  await sleep(400);   // FLIP swap settles
  const ring = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.character-card')];
    return {
      selIdx: cards.findIndex(c => c.classList.contains('selected')),
      epithets: cards.every(c => c.querySelector('.epithet')),
    };
  });
  ok(ring.selIdx === 1, `the ring holds the center slot — tapped hero glided into it (idx ${ring.selIdx})`);
  ok(ring.epithets, 'every offering wears its printed epithet');
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
  ok(ov.panelShown && ov.panelSkillRows === 6 && ov.panelTokens === 3,
    `their variables read like YOUR stats panel (6 skill rows, 3 tokens — got ${ov.panelSkillRows}/${ov.panelTokens})`);
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

  // Hover must outrank a selected neighbor (z 33 vs 31): with the middle
  // card selected, hover the card beside it — the BLOOM wins the hit-test
  // over the selected card's territory (a selected card used to paint
  // over the bloom of the card you were reading — Wyatt's screenshot).
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.hand-zone .hand-card')];
    selectHandCard(Math.floor(cards.length / 2));
  });
  await sleep(300);
  const duelPt = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.hand-zone .hand-card')];
    const mid = Math.floor(cards.length / 2);
    const sel = cards[mid].getBoundingClientRect();
    const hov = cards[mid + 1].getBoundingClientRect();
    return { hx: hov.left + hov.width / 2, hy: hov.top + hov.height / 2,
             sx: sel.left + sel.width / 2, sy: sel.top + sel.height / 2 };
  });
  await page.mouse.move(duelPt.hx, duelPt.hy);
  await sleep(450);
  const duel = await page.evaluate((pt) => {
    const hovered = [...document.querySelectorAll('.hand-zone .hand-card')].find(x => x.matches(':hover'));
    const el = document.elementFromPoint(pt.sx, pt.sy);
    return {
      hovered: !!hovered,
      bloomWins: !!(hovered && (hovered === el || hovered.contains(el))),
      hit: el ? (el.className.toString() || el.tagName) : 'none',
    };
  }, duelPt);
  ok(duel.hovered, 'a neighbor of the selected card is hovered (fixture valid)');
  ok(duel.bloomWins, `hover-bloom paints ABOVE the selected neighbor (hit: ${duel.hit})`);
  await page.screenshot({ path: join(SHOTS, 'desktop-bloom-over-selected.png') });

  // Outside click closes the panel AND strips .selected — the class used
  // to linger (nothing re-renders on hide) and bury later blooms at z 31.
  // (400,60): empty felt between the board thumb and the phase pill —
  // clear of the root-level action panel, which is exempt from the hide.
  await page.mouse.move(400, 60);
  await page.mouse.down(); await page.mouse.up();
  await sleep(300);
  const cleared = await page.evaluate(() => ({
    panel: !!document.querySelector('.action-panel.active'),
    stale: document.querySelectorAll('.hand-card.selected').length,
  }));
  ok(!cleared.panel && cleared.stale === 0,
    `outside click leaves no stale .selected behind (${cleared.stale})`);
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

  // Menu renders: Play Now leads a single column beside the box art,
  // segmented 3/4/5 table picker, Leaderboard/Store pair, quiet row.
  const menu = await page.evaluate(() => ({
    mode: FLB.mode,
    play: !!([...document.querySelectorAll('#title-screen .btn-royal')].find(b => /play now/i.test(b.textContent))),
    seg: [...document.querySelectorAll('#queueSeg button[data-q]')].map(b => b.dataset.q),
    segLit: document.querySelectorAll('#queueSeg button.on').length,
    lbBtn: !!([...document.querySelectorAll('#title-screen .btn-royal')].find(b => /leaderboard/i.test(b.textContent))),
    storeBtn: !!([...document.querySelectorAll('#title-screen .btn-royal')].find(b => /store/i.test(b.textContent))),
    howto: !!([...document.querySelectorAll('.menu-link')].find(b => /how to play/i.test(b.textContent))),
    promptTest: !!document.getElementById('promptTestToggle'),
    chip: document.getElementById('profileChip').textContent.trim(),
    oldDropdownGone: !document.getElementById('playerCountSelect'),
  }));
  console.log(`   (leaderboard backend: ${menu.mode})`);
  ok(menu.play && menu.lbBtn && menu.storeBtn, 'menu renders Play Now + Leaderboard + Store');
  ok(menu.seg.join('|') === '3|4|5' && menu.segLit === 1,
    `segmented table picker offers 3/4/5 with one lit (${menu.seg.join(',')})`);
  ok(menu.howto && menu.promptTest, "How to Play + Prompt Test survive (Skylar's tutorial hooks)");
  ok(/Audit Herald/.test(menu.chip), `profile chip carries the royal name (${menu.chip.split('\n')[0]})`);
  ok(menu.oldDropdownGone, 'player-count dropdown is gone from character select');

  // Landscape-first geometry: the art panel sits fully LEFT of the menu
  // column, the primary dwarfs the secondaries, everything on-screen.
  const geo = await page.evaluate(() => {
    const art = document.querySelector('.title-art').getBoundingClientRect();
    const col = document.querySelector('.title-menu').getBoundingClientRect();
    const play = document.querySelector('.menu-play').getBoundingClientRect();
    const pair = document.querySelector('.menu-pair .btn-royal').getBoundingClientRect();
    return {
      sideBySide: art.right <= col.left + 1,
      colOn: col.top >= 0 && col.bottom <= window.innerHeight + 1,
      artOn: art.top >= 0 && art.bottom <= window.innerHeight + 1,
      playBigger: play.height > pair.height * 1.4 && play.width >= col.width - 2,
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  ok(geo.sideBySide, 'landscape stage: box art left, menu column right');
  ok(geo.colOn && geo.artOn && !geo.hscroll, 'stage fully on-screen, no h-scroll');
  ok(geo.playBigger, 'Play Now is the unmistakable primary (full-width, tallest)');
  await page.screenshot({ path: join(SHOTS, 'menu-desktop.png') });

  // Queue choice persists (segmented tap).
  await page.evaluate(() => { document.querySelector('#queueSeg button[data-q="4"]').click(); });
  ok(await page.evaluate(() => FLB.queueSize()) === 4, 'table picker persists the chosen size');
  ok(await page.evaluate(() =>
    document.querySelector('#queueSeg button[data-q="4"]').classList.contains('on')
    && document.querySelectorAll('#queueSeg button.on').length === 1),
    'the tapped segment lights and the old one dims');

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
    const art = document.querySelector('.title-art').getBoundingClientRect();
    const col = document.querySelector('.title-menu').getBoundingClientRect();
    return {
      play: vis(play),
      seg: vis(document.getElementById('queueSeg')),
      chip: vis(document.getElementById('profileChip')),
      sideBySide: art.right <= col.left + 1,
      hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  ok(m.play && m.seg && m.chip, 'Play Now + table picker + profile chip all reachable on a phone');
  ok(m.sideBySide, 'landscape phone keeps the side-by-side stage');
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

  await page.evaluate(() => selectHandCard(0));
  await sleep(350);
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

  await page.evaluate(() => {
    const p = game.players[0];
    p.gold = 70;                                // Wyatt's scenario: plenty of gold
    p.sliderPosition = 2;
    // Slot coins now pay EVERY landing (claimedSlots is gone — see
    // applySliderAbilities). This flow slides RIGHT, and the Explorer's slots 4
    // and 5 carry no coins (Mind's Eye / Philosopher's Stone events only, both
    // idempotent), so the fee math below stays pure at a clean −5 per space.
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
    game.players[0].favor = a;
    game.players[1].favor = b;
    game.players[2].favor = c;
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
      charYou: cells[9] ? cells[9].textContent : null,       // Character row × your column
      scornYou: cells[15] ? { t: cells[15].textContent, bad: cells[15].classList.contains('bad') } : {},
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
  ok(win.rowLabels.join('|') === 'Missions|Adventures|Artifacts|Character|Prestige|Scorn|Total',
    `score sheet rows as printed (${win.rowLabels.join(', ')})`);
  ok(win.heads.length === 3 && win.heads[0].name === 'You' && /\bwin\b/.test(win.heads[0].cls)
    && win.heads[0].trophy && win.heads[0].face,
    '1st column: You — portrait, trophy, champion glow');
  ok(win.heads.every(h => h.face), 'every heir wears their portrait');
  ok(win.cells === 21, `7 rows × 3 heirs of cells (${win.cells})`);
  ok(win.charYou === '100', `rigged favor lands in the Character row (${win.charYou})`);
  ok(win.scornYou.t === '−2' && win.scornYou.bad, `scorn reads −2 in red (${win.scornYou.t})`);
  ok(win.totals.join(',') === '105,10,5', `totals = favor + prestige − scorn (${win.totals.join(',')})`);
  ok(win.noGoldCol, 'no gold tiebreaker column');
  ok(win.ratingDelta === '+25', `rating delta reads +25 (${win.ratingDelta})`);
  ok(win.ratingNew === '25', `fresh player's new rating target = 25 (${win.ratingNew})`);
  ok(win.starDelta === '+10', `win pays +10 Stars (${win.starDelta})`);
  ok(win.starNew === '10', `fresh player's star target = 10 (${win.starNew})`);
  ok(win.playAgain, 'Play Again survives');
  ok(!win.hscroll, 'no horizontal scroll');

  // The prestige row carries the rigged 7 — sheet cells are engine truth.
  const presYou = await page.evaluate(() =>
    [...document.querySelectorAll('.vs-grid .vsg-cell')][12].textContent);
  ok(presYou === '7', `prestige row reads the rigged 7 (${presYou})`);

  // Count-up actually lands on the totals (grid totals start ~1150ms in).
  await sleep(2400);
  const landed = await page.evaluate(() => {
    const b = document.querySelector('.vs-grid .vsg-cell.total b');
    return {
      top: b ? b.textContent : null,
      target: b ? b.dataset.total : null,
      rating: (document.querySelector('.vs-delta.rating .vs-d-new') || {}).textContent,
    };
  });
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
    myColIdx: [...document.querySelectorAll('.vs-grid .vsg-head')].findIndex(h => h.classList.contains('me')),
    ratingDelta: (document.querySelector('.vs-delta.rating b') || {}).textContent,
  }));
  ok(/Claims the Throne$/.test(loss.headline) && !/You/.test(loss.headline),
    `rival win headline (${loss.headline})`);
  ok(!loss.rays, 'no rays when a rival takes the throne');
  ok(loss.personal === 'You finished 3rd.', `personal line (${loss.personal})`);
  ok(loss.myColIdx === 2, `your column stands 3rd on the sheet (idx ${loss.myColIdx})`);
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
    store: !!([...document.querySelectorAll('#title-screen .btn-royal')].find(b => /store/i.test(b.textContent))),
    howto: !!([...document.querySelectorAll('.menu-link')].find(b => /how to play/i.test(b.textContent))),
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
  await sleep(600);
  ok(await page.evaluate(() => !localStorage.getItem('favorPendingStars') &&
      location.search === ''),
    'cancel return clears the pending mark and cleans the URL');

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
  await page.evaluate(() => FLB.closeProfile());

  // 2 · One finished game = ONE whole-row post: rating, stars, power,
  // games/wins/streak land together (loss first, then a win).
  await page.evaluate(async () => {
    await FLB.postGameResult([
      { name: 'Rival A', finalScore: 70, power: 20, playerIndex: 1 },
      { name: 'You', finalScore: 60, power: 34, playerIndex: 0 },
      { name: 'Rival B', finalScore: 50, power: 10, playerIndex: 2 },
    ], []);
    await FLB.postGameResult([
      { name: 'You', finalScore: 80, power: 40, playerIndex: 0 },
      { name: 'Rival A', finalScore: 45, power: 15, playerIndex: 1 },
      { name: 'Rival B', finalScore: 30, power: 5, playerIndex: 2 },
    ], []);
  });
  await sleep(400);
  const row = await page.evaluate((u) =>
    firebase.database().ref(`favor/players/${u}`).get().then(s => s.val()), AUDIT_UID);
  ok(row && row.rating === 35 && row.stars === 16,
    `rating 10+25=35, stars 6+10=16 in one row (${row && row.rating}/${row && row.stars})`);
  ok(row && row.power === 74 && row.games === 2 && row.wins === 1 &&
     row.streak === 1 && row.bestStreak === 1,
    `power 74, 2 games, 1 win, streak 1 ride the same transaction`);
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
    };
  }, AUDIT_UID);
  ok(at.medals === 3, `top three wear medals (${at.medals})`);
  ok(at.discs, 'every row wears a crest disc');
  ok(at.me && at.you, 'YOUR row is highlighted and tagged You');
  ok(at.sub, `your record rides the row (wins · games)`);
  await page.screenshot({ path: join(SHOTS, 'lb-alltime.png') });

  // 4 · Power: lifetime ⚔ accumulates; seeded personas anchor the top.
  await page.evaluate(() => FLB.openLeaderboard('power'));
  await sleep(700);
  const pw = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.lb-row')];
    const scores = rows.map(r => parseInt(r.querySelector('.lb-score').textContent.replace(/[^\d]/g, ''), 10));
    const mine = rows.find(r => r.classList.contains('me'));
    return {
      sorted: scores.every((s, i) => i === 0 || scores[i - 1] >= s),
      top: rows[0] ? rows[0].textContent : '',
      myScore: mine ? mine.querySelector('.lb-score').textContent : '',
      icon: rows[0] ? !!rows[0].querySelector('.lb-ico') : false,
    };
  });
  ok(pw.sorted, 'Power board sorts by lifetime power');
  ok(/Ashcroft/.test(pw.top), `seeded persona anchors the top (${pw.top.slice(0, 40).trim()}…)`);
  ok(/74/.test(pw.myScore) && pw.icon, `your two games total ⚔ 74 (${pw.myScore.trim()})`);
  await page.screenshot({ path: join(SHOTS, 'lb-power.png') });

  // 5 · Daily keeps the best single game, now with crests.
  await page.evaluate(() => FLB.openLeaderboard('daily'));
  await sleep(700);
  const daily = await page.evaluate(() => {
    const mine = [...document.querySelectorAll('.lb-row')].find(r => r.classList.contains('me'));
    return mine ? mine.textContent : '';
  });
  ok(/80/.test(daily), `daily carries your best single-game Favor (80)`);
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
  await sleep(350);   // beat 1 on stage, verdict still sealed

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

// ═══ A CARD'S GOLD COST GATES PLAY (Wyatt: "Mind Warper did nothing") ═══
// checkRequirements never looked at card.cost, so the Play button lit up, the
// engine refused with success:false (which no caller checked), and the card
// evaporated — no play, no discard, no refund. 45 of 105 cards carry a cost.
{
  console.log('── Gold cost gates the Play button (Wyatt\'s Mind Warper)');
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('cost-gate: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await startGame(page);

  // Requirements MET (6 Alchemy + 1 Philosopher's Stone), purse ONE gold short.
  const short = await page.evaluate(() => {
    const p = game.players[0];
    p.bonusSkills = { alchemy: 6 };
    game.applySlotSkills(p);
    p.philosopherStone = 1;
    p.scorn = 10;
    p.gold = 5;                                    // the card costs 6
    p.hand = [{ ...window.FAVOR_DATA.cards.find(c => c.name === 'Mind Warper') }];
    renderGameState();
    showActionPanel(0);
    const btn = [...document.querySelectorAll('#actionPanel .action-btn')]
      .find(b => /Play|Need/.test(b.textContent));
    const chk = game.checkRequirements(0, p.hand[0]);
    return {
      text: btn ? btn.textContent.trim() : '(no button)',
      disabled: btn ? btn.disabled : false,
      canPlay: chk.canPlay,
      borrowOffered: [...document.querySelectorAll('#actionPanel .action-btn')]
        .some(b => /Borrow/.test(b.textContent)),
    };
  });
  ok(short.canPlay === false, 'engine: canPlay is FALSE one gold short of the cost');
  ok(short.disabled && /Need/.test(short.text) && /6 Gold/.test(short.text),
    `Play is disabled and NAMES the gap: "${short.text}"`);
  ok(!short.borrowOffered, 'and Borrow is not offered — you cannot borrow your way out of being broke');
  await page.screenshot({ path: join(SHOTS, 'cost-gate-short.png') });

  // One more gold: the same card is playable, and it actually converts.
  const rich = await page.evaluate(async () => {
    const p = game.players[0];
    p.gold = 6;
    renderGameState();
    showActionPanel(0);
    const btn = [...document.querySelectorAll('#actionPanel .action-btn')]
      .find(b => /Play/.test(b.textContent) && !/Need/.test(b.textContent));
    const enabled = !!btn && !btn.disabled;
    // Drive the real engine path and confirm the special fires.
    const card = p.hand[0];
    game.pickCard(0, 0);
    const res = game.activateCard(0, card.id, 'play');
    return { enabled, text: btn ? btn.textContent.trim() : '', ok: res.success, scorn: p.scorn, prestige: p.prestige };
  });
  ok(rich.enabled, `at 6 Gold the Play button lives ("${rich.text}")`);
  ok(rich.ok && rich.scorn === 0 && rich.prestige === 10,
    `and Mind Warper converts: 10 Scorn → ${rich.prestige} Prestige, scorn now ${rich.scorn}`);
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
  }));
  ok(arena.combatants === 3, `all heirs enter the arena (${arena.combatants})`);
  ok(arena.rings === 3, 'every board wears its slider ring');
  ok(arena.skip, 'Skip chip offered');

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

// ═══ OPPONENT VIEW: summed stats in the inspect overlay + the play spotlight ═══
console.log('── Opponent view: inspect panel/chips sum their spread; spotlight = who + BIG card + chips');
{
  // Shared rig: rival 1 gets a KNOWN spread the surfaces must sum faithfully.
  const rigRival = () => {
    const byName = n => FAVOR_DATA.cards.find(c => c.name === n);
    const p = game.players[1];
    p.playedCards = ['Hunting', 'Concoction', 'Mining Guild'].map(n => ({ ...byName(n) }));
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
  ok(panel.tokens === '14,6,3', `token totem = their purse (${panel.tokens})`);
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

// ═══ DESKTOP: drag-to-play — the phone's Hearthstone pull, mouse-driven ═══
console.log('── Desktop: drag a card up and release → action sheet (click still works)');
{
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('desk-drag: ' + m.text()); });
  page.on('pageerror', e => consoleErrors.push('desk-drag pageerror: ' + e.message));
  await page.setViewport({ width: 1440, height: 900 });
  await startGame(page);
  await sleep(400);

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

  // Release up top → the action sheet, for THIS card.
  await page.mouse.up();
  await sleep(500);
  const committed = await page.evaluate(() => ({
    panel: !!document.querySelector('.action-panel.active'),
    sel: selectedHandCard,
    dragLeft: !!document.querySelector('#handZone .hand-card.dragging'),
  }));
  ok(committed.panel && committed.sel === c.i, `release up top opens the sheet for that card (selected #${committed.sel})`);
  ok(!committed.dragLeft, 'the card snapped home');
  await page.screenshot({ path: join(SHOTS, 'desktop-drag-commit.png') });
  await page.evaluate(() => { window._finalChoicePending = false; hideActionPanel(); });
  await sleep(300);

  // hideActionPanel leaves the .selected card (and its fan reflow) in
  // place until the next render — re-render and re-measure before the
  // next gesture or the coordinates go stale.
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

  // The classic desktop click flow survives untouched.
  const c3 = await fresh();
  await page.mouse.move(c3.x, c3.y);
  await sleep(200);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(400);
  const clicked = await page.evaluate(() => ({
    panel: !!document.querySelector('.action-panel.active'),
    sel: selectedHandCard,
  }));
  ok(clicked.panel && clicked.sel === c3.i, `a plain click still selects and opens the sheet (#${clicked.sel})`);
  await page.evaluate(() => { window._finalChoicePending = false; hideActionPanel(); });
  await page.close();
}

// ═══ STAT FLOATS: a gain pops "+N" off the stat itself, both layouts ═══
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
  await page.evaluate(() => playSelectedCard(0));
  let overlap = false;
  for (let t = 0; t < 30 && !overlap; t++) {
    overlap = await page.evaluate(() =>
      document.querySelector('.mini-spotlight') && document.querySelectorAll('.stat-float').length > 0);
    await sleep(100);
  }
  ok(overlap, 'banner and "+N" floats share the stage — one payoff beat');
  await page.evaluate(() => { window._finalChoicePending = false; hideActionPanel(); });
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
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    return b && b.offsetParent;
  }, { timeout: 20000 });
  await page.evaluate((rig) => {
    window.shuffleArray = (a) => [...a];
    window._mpSkipQueue = true;   // real seed path, no live queue
    localStorage.setItem('favorQueue', '3');
    FLB.tableSeed = async () => rig;
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
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
    myRow: { uid: AUDIT_UID, rating: 100 },
    topRow: { uid: P_UID, name: 'Lord Ashcroft', score: 240 },
    personas: [{ key: 'ashcroft', uid: P_UID, name: 'Lord Ashcroft', hero: 'knight',
                 seedRating: 240, rating: 240, strong: ['power', 'survival'] }],
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

  // Persona placement posts to ITS row: rating only — no Stars, no daily.
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
    const daily = (await firebase.database().ref(`favor/daily/${key}/scores/${puid}`).get()).exists();
    return { rating: row.rating, stars: row.stars === undefined ? null : row.stars, daily };
  }, P_UID);
  ok(post.rating === 25, `persona 1st place posted +25 to the uaudit row (${post.rating})`);
  ok(post.stars === null, 'persona earns no Stars');
  ok(!post.daily, 'persona stays off the daily board');

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
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
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
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
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
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
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

// ═══ MULTIPLAYER — queue window, real 2-client match, lockstep, AFK boot ═══
// Two ISOLATED browser contexts play each other through the real Firebase
// queue. Timers are shrunk via FMP._T so the whole story runs in seconds.
console.log('── Multiplayer: solo window, 2-client match, lockstep round, AFK boot');
{
  // Leave no stale matchmaking state behind OR in front.
  const purgeMp = async (pg) => pg.evaluate(async () => {
    await firebase.database().ref('favor/mp/queue').remove();
    return true;
  });

  // ── Beat 1: nobody else queued — the window expires into the classic
  //    table (the fake humans get you; Wyatt's Nation pattern). ──
  {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push('mp-solo: ' + m.text()); });
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(URL, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
    await purgeMp(page);
    await page.evaluate(() => {
      window.shuffleArray = (a) => [...a];
      localStorage.setItem('favorQueue', '3');
      // Window long enough for the pledge asserts below (entry is read
      // ~1.3-2.5s after Play), short enough to expire into the solo table.
      FMP._T.windowMin = 5000; FMP._T.windowSpread = 1;
      const b = [...document.querySelectorAll('#title-screen .btn-royal')]
        .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
      b.click();
    });
    await page.waitForFunction(() => document.querySelector('.character-card') && document.querySelector('.character-card').offsetParent, { timeout: 20000 });
    // COMMIT-FIRST: the pledge ribbon rides the select screen — you were
    // queued at Play Now, before any hero was seen (Wyatt's re-roll fix).
    const pledge = await page.evaluate(() => ({
      queued: !!document.getElementById('qpWithdraw'),
      dot: !!document.querySelector('#queuePledge .qp-dot'),
    }));
    ok(pledge.queued && pledge.dot, 'select screen shows the pledge (Withdraw + live dot)');
    ok(await page.evaluate(async () =>
      !!(await firebase.database().ref('favor/mp/queue/3').get()).val()),
      'the queue entry was written AT Play Now — before any hero was seen');
    await page.evaluate(() => {
      selectedCharacter = FAVOR_DATA.characters[0].id;
      document.querySelector('.character-card').classList.add('selected');
      document.getElementById('confirmBtn').style.display = 'inline-block';
    });
    await page.evaluate(() => document.getElementById('confirmBtn').click());
    await page.waitForFunction(() =>
      document.getElementById('promisePicker').classList.contains('active')
      && /Searching the Realm/i.test(document.getElementById('promisePicker').textContent), { timeout: 8000 });
    ok(true, 'confirming a hero opens the Searching the Realm beat');
    await page.screenshot({ path: join(SHOTS, 'mp-searching.png') });
    await page.waitForFunction(() => typeof game !== 'undefined' && game
      && game.players.length === 3 && game.players[0].character, { timeout: 15000 });
    const solo = await page.evaluate(() => ({
      active: FMP.active(),
      rivals: game.players.slice(1).map(p => p.name),
      queueLeft: null,
    }));
    ok(!solo.active, 'window expired → NOT a network game');
    ok(solo.rivals.length === 2 && solo.rivals.every(n => n && n !== 'You'),
      `the fake humans fill the table (${solo.rivals.join(' & ')})`);
    const qleft = await page.evaluate(async () =>
      (await firebase.database().ref('favor/mp/queue').get()).val());
    ok(!qleft, 'queue entry cleaned up after the window expired');
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
        const b = [...document.querySelectorAll('#title-screen .btn-royal')]
          .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
        b.click();
      }, extra || {});
      // 40 minutes into a run Chrome can swallow the first paint after the
      // title fade — a formed match may ALSO have auto-consumed the select
      // (commit-first). Accept either; re-tap Play once before giving up.
      const selectOrGame = () => pg.waitForFunction(() =>
        (document.querySelector('.character-card') && document.querySelector('.character-card').offsetParent)
        || (typeof game !== 'undefined' && game && game.players && game.players[0].character),
        { timeout: 12000 });
      try { await selectOrGame(); } catch (e) {
        console.log(`   (mp-${name}: select slow — re-tapping Play)`);
        await pg.evaluate(() => {
          if (typeof game !== 'undefined' && game) return;
          const t = document.getElementById('title-screen');
          t.classList.remove('hidden'); t.style.display = '';
          startGame();
        });
        await selectOrGame();
      }
      // If the table already formed (auto-start), there is nothing to pick.
      const inSelect = await pg.evaluate(() =>
        !!(document.querySelector('.character-card') && document.querySelector('.character-card').offsetParent));
      if (inSelect) {
        await pg.evaluate(() => {
          selectedCharacter = FAVOR_DATA.characters[0].id;
          document.querySelector('.character-card').classList.add('selected');
          document.getElementById('confirmBtn').style.display = 'inline-block';
        });
        await pg.evaluate(() => document.getElementById('confirmBtn').click());
      }
      return pg;
    };

    // A hosts (earliest entry, 4s AFK clock for beat 4); B joins.
    const pA = await boot(ctxA, A_UID, 'Audit MpA', { afk: 4500 });
    await sleep(900);
    const pB = await boot(ctxB, B_UID, 'Audit MpB', {});

    const inGame = (pg) => pg.waitForFunction(() => typeof game !== 'undefined' && game
      && game.players.length === 3 && game.players[0].character && FMP.active(), { timeout: 25000 });
    await Promise.all([inGame(pA), inGame(pB)]);
    ok(true, 'two queued clients matched into one live table');

    const stateOf = (pg) => pg.evaluate(() => ({
      seat: FMP.mySeat(),
      host: FMP.isHost(),
      seed: FMP.record().seed,
      names: game.players.map(p => p.name),
      handsCanon: [0, 1, 2].map(cs =>
        game.players[FMP.localIdx(cs)].hand.map(c => c.id).join(',')).join(';'),
      emblemCanon: FMP.canonSeat(game.emblemHolder),
      hash: mpStateHash(),
    }));
    const sA = await stateOf(pA), sB = await stateOf(pB);
    ok(sA.host && !sB.host && sA.seat === 0 && sB.seat === 1,
      `first in queue hosts (A seat ${sA.seat}, B seat ${sB.seat})`);
    ok(sA.seed === sB.seed, 'both clients build from one seed');
    ok(sA.names.includes('Audit MpB') && sB.names.includes('Audit MpA'),
      'each client sees the other by name at the table');
    ok(sA.handsCanon === sB.handsCanon,
      'LOCKSTEP: every hand identical across clients (canonical order)');
    ok(sA.emblemCanon === sB.emblemCanon, `Emblem agrees across clients (canonical seat ${sA.emblemCanon})`);
    await pA.screenshot({ path: join(SHOTS, 'mp-match-hostA.png') });
    await pB.screenshot({ path: join(SHOTS, 'mp-match-clientB.png') });

    // ── Beat 3: one full lockstep round — both discard their first card. ──
    await pA.evaluate(() => discardSelectedCard(0));
    await sleep(250);
    await pB.evaluate(() => discardSelectedCard(0));
    const roundDone = (pg) => pg.waitForFunction(() => game.phase === 'gameplay'
      && game.pendingActivations.every(a => a === null)
      && game.players[0].hand.length === 6, { timeout: 30000 }).then(() => true, () => false);
    const [rdA, rdB] = await Promise.all([roundDone(pA), roundDone(pB)]);
    ok(rdA && rdB, `both clients finish the round (A ${rdA}, B ${rdB})`);
    const hA = await pA.evaluate(() => mpStateHash());
    const hB = await pB.evaluate(() => mpStateHash());
    ok(hA === hB, `LOCKSTEP: state hashes agree after a full round (${hA} vs ${hB})`);
    const bLog = await pB.evaluate(() => document.getElementById('logEntries').innerText);
    ok(/Audit MpA (discards|plays)/.test(bLog), "B's log narrates A's move (stream applied)");

    // ── Beat 4: A picks, B goes silent — the 2-minute boot (shrunk to
    //    4.5s) converts B's seat to AI everywhere and kicks B out. ──
    await pA.evaluate(() => discardSelectedCard(0));
    const booted = await pA.waitForFunction(() =>
      game.players[1] && game.players[1]._remoteHuman === false, { timeout: 20000 })
      .then(() => true, () => false);
    ok(booted, "host's AFK clock boots the silent seat (remote → AI)");
    const round2 = await pA.waitForFunction(() => game.phase === 'gameplay'
      && game.pendingActivations.every(a => a === null)
      && game.players[0].hand.length === 5, { timeout: 30000 })
      .then(() => true, () => false);
    const aLog = await pA.evaluate(() => document.getElementById('logEntries').innerText);
    ok(round2, 'the table plays on with the AI in the empty seat');
    ok(/removed for inactivity/i.test(aLog), 'the boot is announced at the table');
    const bBooted = await pB.waitForFunction(() =>
      document.getElementById('champOverlay').classList.contains('active')
      && /Removed for Inactivity/i.test(document.getElementById('champTitle').textContent),
      { timeout: 15000 }).then(() => true, () => false);
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

ok(consoleErrors.length === 0, 'zero console errors across all flows', consoleErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${fail === 0 ? `✅ UI AUDIT: ${pass} checks passed — now LOOK at tools/audit-shots/` : `❌ UI AUDIT: ${fail} FAILED, ${pass} passed`}`);
process.exit(fail ? 1 : 0);
