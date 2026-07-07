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
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#title-screen .btn-royal')]
      .find(x => /play/i.test(x.textContent) && !/how/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card') && document.querySelector('.character-card').offsetParent, { timeout: 20000 });
  await page.evaluate(() => document.querySelector('.character-card').click());
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

  // Mission rail thumb → lightbox.
  await page.evaluate(() => document.querySelector('#tvMissionRail .tv-mission:not(.ghost)').click());
  await sleep(300);
  ok(await page.evaluate(() => document.getElementById('missionLB').classList.contains('active')), 'mission thumb opens the lightbox');
  await page.keyboard.press('Escape');
  await sleep(250);

  // My Missions popover: ● ✓ ✕ rows, row hands off to the lightbox with Turn In.
  await page.evaluate(() => document.querySelector('.tv-mym').click());
  await sleep(300);
  const mym = await page.evaluate(() => ({
    open: document.getElementById('tvPopoverHost').classList.contains('active'),
    rows: [...document.querySelectorAll('#tvPopoverHost .tv-mission-row')].map(r => r.className.replace('tv-mission-row', '').trim()),
  }));
  ok(mym.open, 'My Missions popover opens');
  ok(mym.rows.includes('active') && mym.rows.includes('done') && mym.rows.includes('failed'),
    `popover lists active/done/failed rows (${mym.rows.join(',')})`);
  await page.screenshot({ path: join(SHOTS, 'hud-mymissions.png') });
  await page.evaluate(() => document.querySelector('#tvPopoverHost .tv-mission-row.active').click());
  await sleep(350);
  const afterRow = await page.evaluate(() => ({
    lb: document.getElementById('missionLB').classList.contains('active'),
    pop: document.getElementById('tvPopoverHost').classList.contains('active'),
    turnIn: !!document.getElementById('missionTurnIn'),
  }));
  ok(afterRow.lb && !afterRow.pop, 'popover row hands off to the lightbox');
  ok(afterRow.turnIn, 'held mission shows Turn In inside the lightbox');
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
    document.getElementById('playerCountSelect').value = '5';
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
    openMissionLB('assets/cards/missions/' + p.missions[0].filename, 'Wanted: Crazy Lou');
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
    openMissionLB('assets/cards/missions/' + game.players[0].missions[0].filename, 'Wanted: Crazy Lou');
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
    game.players[1].playedCards.push({ ...kCard });
    game.phase = 'gameplay';
    renderGameState();
    openMissionLB('assets/cards/missions/' + p.missions[0].filename, p.missions[0].name);
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

ok(consoleErrors.length === 0, 'zero console errors across all flows', consoleErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n${fail === 0 ? `✅ UI AUDIT: ${pass} checks passed — now LOOK at tools/audit-shots/` : `❌ UI AUDIT: ${fail} FAILED, ${pass} passed`}`);
process.exit(fail ? 1 : 0);
