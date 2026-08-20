#!/usr/bin/env node
/**
 * App Store screenshots v2 — the current-era set at Apple's device sizes
 * (Wyatt 8/20: the store shots must match the CURRENT menu; the game looks
 * a lot better than the July captures the listing still wears).
 *
 * Scenes = the Steam-v2 dramatic set (approved 8/13), menu FIRST per the
 * 8/20 ask, with one mobile substitution: the desktop hover-bloom is gated
 * @media (hover:hover) so real phones never see it — the authentic mobile
 * equivalent is the hand-inspect spread (openHandInspect).
 *
 *   cd ~/playfavor && python3 -m http.server 8891 &
 *   node shell/store/capture-shots-appstore.mjs
 *
 * Shots land in shell/store/shots/appstore-v2/{iphone69,ipad13}/ at
 * 2868×1320 and 2752×2064 — the sizes the live listing already uses.
 * Pure-UI staging only — showScoring (which posts) is never called.
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const URL = process.env.SHOT_URL || 'http://localhost:8891/';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'appstore-v2');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const FORMS = [
  { key: 'iphone69', width: 956,  height: 440,  dpr: 3, mobile: true },   // 2868×1320
  { key: 'ipad13',   width: 1376, height: 1032, dpr: 2, mobile: true },   // 2752×2064
].filter(f => !process.env.FORM || f.key === process.env.FORM);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});

async function boot(form) {
  const page = await browser.newPage();
  await page.setViewport({
    width: form.width, height: form.height, deviceScaleFactor: form.dpr,
    isMobile: form.mobile, hasTouch: form.mobile,
  });
  const baseUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  await page.setUserAgent(baseUA + ' FavorShell-iOS/1.0');  // shell UA: Mint stays hidden
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('favorUid', 'uauditshots001');
    localStorage.setItem('favorName', 'Lady Plum');
    localStorage.setItem('favorAvatar', 'knight');
    localStorage.setItem('favorQueue', '5');               // full 5-seat table — fuller podium
    localStorage.setItem('favorCoachDone', '1');
  });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });
  await page.evaluate(() => { const v = document.getElementById('buildVersion'); if (v) v.remove(); });
  return page;
}

async function shot(page, form, name) {
  await sleep(450);
  await page.screenshot({ path: join(ROOT, form.key, `${name}.png`) });
  console.log(`  ✓ ${form.key}/${name}`);
}

async function clearStage(page) {
  for (let i = 0; i < 6; i++) {
    const more = await page.evaluate(() => {
      const skip = [...document.querySelectorAll('a,button,span,div')]
        .find(el => el.children.length === 0 && /skip tips/i.test(el.textContent));
      if (skip) { skip.click(); return true; }
      const x = document.querySelector('.coach-x');
      if (x && x.offsetParent) { x.click(); return true; }
      return false;
    });
    if (!more) break;
    await sleep(250);
  }
  await page.evaluate(() => {
    const n = document.getElementById('notifications');
    if (n) n.innerHTML = '';
    document.querySelectorAll('.stat-float, .game-toast').forEach(el => el.remove());
    const th = document.getElementById('throwHint');   // tutorial pill — noise in marketing
    if (th) th.style.display = 'none';
  });
}

async function intoGame(page) {
  await page.evaluate(() => {
    // Full roster on the hero grid — 3 starters alone leave the frame empty.
    localStorage.setItem('favorOwned', JSON.stringify(FAVOR_DATA.characters.map(c => c.id)));
    window._mpSkipQueue = true;
    document.querySelector('#title-screen .ts-play').click();
  });
  try {
    await page.waitForFunction(() => document.querySelector('.character-card')?.offsetParent, { timeout: 20000 });
  } catch (e) {
    const diag = await page.evaluate(() => ({
      title: document.getElementById('title-screen')?.className,
      charSel: document.getElementById('character-select')?.className,
      cards: document.querySelectorAll('.character-card').length,
      overlays: [...document.querySelectorAll('.overlay.active, .modal.active, [id$="Ov"].active')].map(el => el.id || el.className),
      queue: document.getElementById('queueScreen')?.className,
    }));
    console.log('  intoGame DIAG:', JSON.stringify(diag));
    await page.screenshot({ path: join(ROOT, 'debug-intogame.png') });
    throw e;
  }
  await sleep(600);
}

async function openHeroModal(page) {
  // Card click opens the hero detail modal; its #cdConfirm starts the game.
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.character-card')];
    cards[Math.floor(cards.length / 2)].click();
  });
  await page.waitForSelector('#cdConfirm', { visible: true });
  await sleep(400);
}

async function confirmHero(page) {
  await page.evaluate(() => document.getElementById('cdConfirm').click());
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 25000 });
  await sleep(1800);
  await clearStage(page);
}

async function dressTable(page) {
  await page.evaluate(() => {
    const take = (names) => names.map(n => ({ ...FAVOR_DATA.cards.find(c => c.name === n) }))
      .filter(c => c.name);
    const p0 = game.players[0];
    p0.gold = 14; p0.prestige = 12; p0.favor = 18; p0.scorn = 1;
    p0.playedCards = take(['Hunting', 'First Aid', 'Forbidden Lab', 'Warm Mentorship', 'Prospecting Journal']);
    game.players[1].playedCards = take(['Trapping', 'Cooking', 'Endless Sparring']);
    game.players[2].playedCards = take(['Tombstone', 'Blackbird']);
    game.players[1].gold = 9; game.players[2].gold = 11;
    game.applySlotSkills(p0);
    renderGameState();
  });
  await sleep(600);
}

for (const form of FORMS) {
  mkdirSync(join(ROOT, form.key), { recursive: true });
  console.log(`── ${form.key} (${form.width}×${form.height} @${form.dpr}x)`);

  // ══ PAGE A: menu → hero select → table → hand inspect → missions → melee ══
  const page = await boot(form);
  const tv = await page.evaluate(() => {
    const b = document.getElementById('tvBtn');
    return b ? (b.offsetParent ? 'visible' : 'hidden') : 'absent';
  });
  console.log(`  tvBtn on this form: ${tv}`);
  await clearStage(page);
  await shot(page, form, '1-menu');

  await intoGame(page);
  if (form.key === 'iphone69') {
    // The 3-hero draft grid can't fill a phone-landscape frame (the desktop
    // auto-fit stretch is gated min-width:1100px) — the hero DETAIL modal is
    // the frame-filling authentic screen at this size.
    await openHeroModal(page);
    await sleep(500);
    await shot(page, form, '7-hero-select');
  } else {
    await shot(page, form, '7-hero-select');
    await openHeroModal(page);
  }

  await confirmHero(page);
  await dressTable(page);
  await sleep(900);
  await clearStage(page);
  await shot(page, form, '4-table');

  // ── Your hand, spread big — the real mobile card-viewing screen ──
  await page.evaluate(() => openHandInspect());
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('#handOvSpread .ov-hand-card')];
    return imgs.length >= 4 && imgs.every(i => i.complete && i.naturalWidth > 0);
  }, { timeout: 15000 });
  await sleep(700);
  await clearStage(page);
  await shot(page, form, '5-hand-inspect');
  await page.evaluate(() => closeHandInspect());

  // ── Choose a Mission — three cards, big art, real stakes line ──
  await page.evaluate(() => showMissionSelectUI());
  await page.waitForSelector('#missionSelect .mission-option img', { visible: true });
  await sleep(900);                      // card art paints
  await clearStage(page);
  await shot(page, form, '6-mission-choice');
  await page.evaluate(() => {
    const ov = document.getElementById('missionSelect');
    ov.classList.remove('active'); ov.innerHTML = '';
  });

  // ── Mission triumph ceremony — Water Temple success, +Favor headline ──
  await page.evaluate(() => {
    window.CINEMATIC_SPEED = 2;          // stretch the beat holds for the camera
    const m = FAVOR_DATA.missions.find(x => x.name === 'Water Temple');
    window._mcDone = false;
    showMissionCeremony([{
      playerIndex: 0,
      results: [{ mission: m, success: true, borrowed: 0,
        deltas: { gold: 6, prestige: 10, stones: 2 }, details: {} }],
    }], 3).then(() => { window._mcDone = true; window.CINEMATIC_SPEED = 1; });
  });
  await page.waitForSelector('#missionCeremony .mc-chip.big', { visible: true });
  await sleep(1700);                     // chips cascade in
  await shot(page, form, '3-mission-triumph');
  await page.evaluate(() => document.getElementById('missionCeremony').click());
  await page.waitForFunction(() => window._mcDone === true, { timeout: 30000 }).catch(() => {});

  // ── Melee coronation — Act III podium, champion crowned ──
  await page.evaluate(() => {
    game.currentAct = 3;
    const powers = [31, 24, 18, 13, 9];  // You take the crown; clean tiers, no ties
    game.players.forEach((p, i) => { p.skills.power = powers[i] || 7; });
    const results = game.resolveMelee();
    window._meleeDone = false;
    playMeleeCinematic(document.getElementById('meleeSplash'), results, 3, {
      speed: 1, forgeHoldMs: 60000, autoCloseMs: 0,   // hold the podium for the camera
      powerIcon: 'assets/icons/power.png',
      portraitFor: (pi) => {
        const p = (pi != null && game.players[pi]) ? game.players[pi] : null;
        return p && p.character ? `assets/characters/${p.character.filename}` : 'assets/ui/cover.jpg';
      },
      breakdownFor: (pi) => (typeof game.powerBreakdown === 'function' ? game.powerBreakdown(pi) : null),
      cardImgFor: (filename, mission) => (filename ? `assets/cards/${mission ? 'missions' : 'regular'}/${filename}` : null),
      prestigeTokenFor: (d) => (d === 25
        ? 'assets/tokens/Tokens_Design_v1_Prestige_25_v1.jpg'
        : `assets/tokens/Copy of Tokens_Design_v1_Prestige_${d}_v1.jpg`),
    }).then(() => { window._meleeDone = true; });
  });
  await page.waitForSelector('#meleeSplash .ms-skip');
  await sleep(1600);                     // roll-call underway → state 'playing'
  await page.evaluate(() => document.querySelector('#meleeSplash .ms-skip').click());
  await page.waitForSelector('#meleeSplash .lit');
  await sleep(1500);                     // sparks settle, tokens paint
  await page.evaluate(() => { const h = document.querySelector('#meleeSplash .ms-hint'); if (h) h.remove(); });
  await shot(page, form, '2-melee-champion');
  await page.close();

  // ══ PAGE B (fresh boot): leaderboard + emporium ══
  const pb = await boot(form);
  // Page A seeded favorOwned for the hero grid — clear it so the Emporium
  // shows real star prices instead of ten OWNED badges.
  await pb.evaluate(() => { localStorage.removeItem('favorOwned'); });
  await pb.reload({ waitUntil: 'networkidle2' });
  await pb.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });
  await pb.evaluate(() => { const v = document.getElementById('buildVersion'); if (v) v.remove(); });
  await pb.evaluate(() => FLB.openLeaderboard('alltime'));
  await pb.waitForFunction(() => document.querySelectorAll('#lbBody .lb-row').length >= 3, { timeout: 15000 });
  await shot(pb, form, '9-leaderboard');
  await pb.evaluate(() => FLB.closeLeaderboard());

  await pb.evaluate(() => FLB.openStore());
  await pb.waitForFunction(() => document.querySelectorAll('.st-card').length === 10, { timeout: 10000 });
  await shot(pb, form, '8-emporium');
  await pb.close();
}

// Scrub the shot identity from Firebase (belt & suspenders — no game was posted).
const pg = await browser.newPage();
await pg.goto(URL, { waitUntil: 'domcontentloaded' });
await pg.evaluate(async () => {
  try { await firebase.database().ref('favor/players/uauditshots001').remove(); } catch (e) {}
});
await browser.close();
console.log('done');
