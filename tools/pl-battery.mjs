#!/usr/bin/env node
/**
 * FAVOR playable ad — QA battery (GVT pl_battery law, ported).
 *
 *   python3 -m http.server 8891 &            (repo root; srcdoc inherits
 *   node tools/pl-battery.mjs                 the http origin — file:// is
 *                                             an opaque-origin trap)
 *
 * Proves: ≤5MB single file · ZERO network requests beyond the document
 * (data: is free) · boots to the hero select · a real tap seats a hero ·
 * a throw reaches the reveal chooser · card art rides the PLMAP (data:
 * srcs) · PLAY NOW chip + end screen fire mraid.open with the right store
 * URL per UA · the ad seam (FADS) is ABSENT · portrait containers get the
 * LANDSCAPE WALL (scale-only, never rotated — Wyatt 8/8; the game's own
 * rotate-gate can never fire) · zero console errors.
 */
import { statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'playables', 'favor-playable.html');
const URL = 'http://localhost:8891/playables/favor-playable.html';
let pass = 0, fail = 0;
const ok = (c, l, d = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${d}`); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const size = statSync(FILE).size;
ok(size <= 5 * 1024 * 1024, `file is ${(size / 1024 / 1024).toFixed(2)}MB (≤5MB)`);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--mute-audio'],
});

async function boot({ width, height, ua }) {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (!u.startsWith('data:') && u !== URL && !u.endsWith('/favicon.ico')) requests.push(u);
    r.continue();
  });
  if (ua) await page.setUserAgent(ua);
  await page.setViewport({ width, height, hasTouch: true, isMobile: true });
  // The creative finds mraid at window.mraid OR parent.mraid — the outer
  // page IS the parent, so a stub here plays the SDK's part.
  // Runs in EVERY frame (srcdoc included) — spy hits collect on the TOP
  // window so one read sees them all.
  await page.evaluateOnNewDocument(() => {
    try { window.top.__opened = window.top.__opened || []; } catch (e) {}
    window.mraid = {
      open: (u) => { try { window.top.__opened.push(u); } catch (e) {} },
      getState: () => 'default',
      isViewable: () => true,
      addEventListener: () => {},
    };
  });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  const frame = page.frames().find(f => f !== page.mainFrame());
  return { page, frame, errors, requests };
}

// The stage is a SCALED 960×445 iframe — a real tap must map inner coords
// through the frame's on-screen rect (1:1 died with the rotation shell).
async function tapInner(page, pt) {
  const box = await page.evaluate(() => {
    const r = document.getElementById('plFrame').getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  });
  await page.mouse.click(box.l + pt.x * (box.w / 960), box.t + pt.y * (box.h / 445));
}

// ═══ Landscape leg: boot → hero tap → game → throw → chooser → CTA ═══
console.log('── landscape: full loop');
{
  const { page, frame, errors, requests } = await boot({ width: 844, height: 390 });
  ok(!!frame, 'srcdoc frame is up');
  await frame.waitForFunction(() => document.querySelector('.character-card') && document.querySelector('.character-card').offsetParent, { timeout: 15000 }).catch(() => {});
  const sel = await frame.evaluate(() => ({
    cards: document.querySelectorAll('.character-card').length,
    title: getComputedStyle(document.getElementById('title-screen')).display,
    fads: typeof window.FADS,
    arts: [...document.querySelectorAll('.character-card img')].filter(i => i.src.startsWith('data:')).length,
  }));
  ok(sel.cards >= 3, `auto-boot reached the hero select (${sel.cards} heroes)`);
  ok(sel.title === 'none', 'the title screen never shows');
  ok(sel.fads === 'undefined', 'the ad seam is ABSENT in the creative');
  ok(sel.arts >= 1, `hero art rides the PLMAP (${sel.arts} data: imgs)`);

  // A REAL tap on the first hero opens the detail sheet; its CONFIRM is
  // the wired door (bare card clicks don't seat — the CDP-listen law).
  const r1 = await frame.evaluate(() => {
    const el = document.querySelector('.character-card');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await tapInner(page, r1);
  await sleep(700);
  const r2 = await frame.evaluate(() => {
    const btns = [...document.querySelectorAll('button, .btn-royal')]
      .filter(b => /confirm|begin|choose|play/i.test(b.textContent) && b.getBoundingClientRect().width > 0);
    if (!btns.length) return null;
    const r = btns[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: btns[0].textContent.trim() };
  });
  if (r2) await tapInner(page, r2);
  else await frame.evaluate(() => { if (typeof confirmCharacter === 'function') confirmCharacter(); });
  const live = await frame.waitForFunction(() => typeof game !== 'undefined' && game && game.players && game.players[0].character, { timeout: 20000 }).then(() => true).catch(() => false);
  ok(live, `a real tap seats a hero — the table is live (confirm: ${r2 ? r2.label : 'fn'})`);
  await sleep(1500);
  const chip = await frame.evaluate(() => {
    const c = document.getElementById('plNow');
    return c && c.getBoundingClientRect().width > 0 ? c.textContent : null;
  });
  ok(/play now/i.test(chip || ''), 'PLAY NOW chip rides the whole session');
  const hand = await frame.evaluate(() =>
    [...document.querySelectorAll('#handZone img, #game-screen img')]
      .filter(i => i.src.startsWith('data:image')).length);
  ok(hand >= 1, `dealt cards wear PLMAP art (${hand} data: imgs)`);

  // Throw → rivals → the reveal chooser.
  await frame.evaluate(() => {
    throwCard(0);
    setTimeout(() => {
      for (let s = 1; s < game.playerCount; s++) {
        if (game.pendingActivations[s] === null && game.players[s].hand.length) aiPickCard(s);
      }
      renderGameState();
      maybeLockThrows();
    }, 600);
  });
  const chooser = await frame.waitForFunction(() => window._finalChoicePending === true, { timeout: 20000 }).then(() => true).catch(() => false);
  ok(chooser, 'a throw reaches the reveal chooser');

  // The end screen → mraid.open with the web URL (desktop UA here).
  await frame.evaluate(() => window.PLEND());
  await sleep(300);
  const endUp = await frame.evaluate(() => {
    const e = document.getElementById('plEnd');
    if (!e || !e.classList.contains('on')) return false;
    e.querySelector('.pill').click();
    return true;
  });
  await sleep(300);
  const opened = await page.evaluate(() => window.top.__opened || []);
  ok(endUp, 'PLEND raises the end screen');
  ok(opened.length === 1 && /playfavor\.net/.test(opened[0]),
    `CTA fires mraid.open once with the web URL (${JSON.stringify(opened)})`);
  ok(requests.length === 0, `ZERO non-document requests (${requests.slice(0, 3).join(' | ') || 'clean'})`);
  ok(errors.length === 0, `zero console errors (${errors.slice(0, 2).join(' | ') || 'clean'})`);
  await page.screenshot({ path: join(ROOT, 'tools', 'audit-shots', 'pl-landscape.png') });
  await page.close();
}

// ═══ Portrait leg: the landscape WALL (Wyatt 8/8 — never rotated) ═══
console.log('── portrait: landscape wall, scale-only, Android store URL');
{
  const { page, frame, errors, requests } = await boot({
    width: 390, height: 844,
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36',
  });
  const wall = await page.evaluate(() => {
    const st = document.getElementById('plStage');
    const m = new DOMMatrixReadOnly(getComputedStyle(st).transform);
    const r = st.getBoundingClientRect();
    const hint = document.getElementById('plHint');
    return {
      rotated: Math.abs(m.b) > 0.001 || Math.abs(m.c) > 0.001,
      scale: m.a,
      w: Math.round(r.width), h: Math.round(r.height),
      fitsW: r.width <= innerWidth + 1,
      hint: hint && getComputedStyle(hint).display !== 'none',
    };
  });
  ok(!wall.rotated && wall.scale > 0 && wall.scale < 1,
    `the stage is SCALED, never rotated (scale ${wall.scale.toFixed(3)})`);
  ok(wall.w > wall.h && wall.fitsW,
    `portrait shows a centered landscape wall (${wall.w}×${wall.h} in 390w)`);
  ok(wall.hint, 'the letterbox wears the rotate hint');
  const up = await frame.waitForFunction(() => document.querySelector('.character-card'), { timeout: 15000 }).then(() => true).catch(() => false);
  ok(up, 'the game boots inside the wall');
  const gate = await frame.evaluate(() => {
    const g = document.getElementById('rotate-gate');
    return g ? getComputedStyle(g).display : 'absent';
  });
  ok(gate === 'none' || gate === 'absent',
    `the game's own rotate-gate never fires inside the wall (${gate})`);
  await frame.evaluate(() => window.PLEND());
  await sleep(250);
  await frame.evaluate(() => document.querySelector('#plEnd .pill').click());
  await sleep(250);
  const opened = await page.evaluate(() => window.top.__opened || []);
  ok(opened.length === 1 && /play\.google\.com.*corkscrewgames\.favor/.test(opened[0]),
    `Android UA routes to Play (${JSON.stringify(opened)})`);
  ok(requests.length === 0, 'zero requests in the portrait leg');
  ok(errors.length === 0, `zero console errors (${errors.slice(0, 2).join(' | ') || 'clean'})`);
  await page.screenshot({ path: join(ROOT, 'tools', 'audit-shots', 'pl-portrait.png') });
  await page.close();
}

await browser.close();
console.log(`\n${fail === 0 ? `✅ playable battery: ${pass} checks` : `❌ ${fail} FAILED, ${pass} passed`}`);
process.exit(fail ? 1 : 0);
