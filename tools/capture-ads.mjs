#!/usr/bin/env node
/**
 * FAVOR — AppLovin UA ad footage capture (design/ads/ADS-V1.md §UA).
 *
 * Five scripted gameplay scenes recorded off the real game at 1920×1080 via
 * CDP screencast (page.screenshot polls too slowly for motion — the trailer
 * rig's law). Each scene writes JPEG frames + frames.txt (true per-frame
 * durations) to marketing/applovin/frames/<scene>/, plus a 1080×1920 still
 * of endcard.html. marketing/applovin/build_ads.sh cuts the five 9:16 ads.
 *
 *   cd ~/playfavor && python3 -m http.server 8891 &
 *   node tools/capture-ads.mjs            # all scenes
 *   node tools/capture-ads.mjs melee      # one scene (iteration)
 *
 * Lives in tools/ so puppeteer-core resolves (ESM ignores NODE_PATH).
 */
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const URL = process.env.SHOT_URL || 'http://localhost:8891/';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = join(ROOT, 'marketing', 'applovin', 'frames');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const only = process.argv[2] || null;

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1920,1080', '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1'],
});
const baseUA = await browser.userAgent();

// ── per-scene page with the trailer's proven boot ─────────────────────
async function openPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  // Steam UA: Mint + TV hidden — footage stays clean of every store rail.
  await page.setUserAgent(baseUA + ' FavorShell-Steam/1.0');
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('favorUid', 'uadcapture001');
    localStorage.setItem('favorName', 'Lady Plum');
    localStorage.setItem('favorAvatar', 'knight');
    localStorage.setItem('favorQueue', '3');
    localStorage.setItem('favorCoachDone', '1');
    localStorage.setItem('favorTelemetryOff', '1');
    localStorage.setItem('favor_coach_seen', JSON.stringify(
      ['welcome', 'missions', 'hand', 'skills', 'pass', 'rivals',
       'scorn', 'favor', 'ring', 'melee', 'emblem']));
  });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });
  await page.evaluate(() => { const v = document.getElementById('buildVersion'); if (v) v.remove(); });
  return page;
}

const clearCoach = (page) => page.evaluate(() => {
  const skip = [...document.querySelectorAll('a,button,span,div')]
    .find(el => el.children.length === 0 && /skip tips/i.test(el.textContent));
  if (skip) skip.click();
  const x = document.querySelector('.coach-x');
  if (x && x.offsetParent) x.click();
  document.querySelectorAll('.coach-tip, .coach-bubble').forEach(el => el.remove());
});

const center = (page, sel, nth = 0) => page.evaluate((s, n) => {
  const el = [...document.querySelectorAll(s)].filter(e => e.offsetParent)[n];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}, sel, nth);
const hover = async (page, sel, nth = 0) => {
  const p = await center(page, sel, nth);
  if (p) await page.mouse.move(p.x, p.y, { steps: 12 });
};
const click = async (page, sel, nth = 0) => {
  const p = await center(page, sel, nth);
  if (p) { await page.mouse.move(p.x, p.y, { steps: 10 }); await sleep(160); await page.mouse.click(p.x, p.y); }
  return !!p;
};

// ── screencast plumbing (per scene) ───────────────────────────────────
async function record(page, dir, run) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const client = await page.createCDPSession();
  const frames = [];
  client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(data, 'base64'));
    frames.push({ name, t: metadata.timestamp });
    try { await client.send('Page.screencastFrameAck', { sessionId }); } catch { /* raced teardown */ }
  });
  await client.send('Page.startScreencast', {
    format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1,
  });
  await run();
  await client.send('Page.stopScreencast');
  await sleep(300);
  if (frames.length < 30) throw new Error(`only ${frames.length} frames in ${dir}`);
  const lines = [];
  for (let i = 0; i < frames.length - 1; i++) {
    const d = Math.max(0.008, Math.min(1.5, frames[i + 1].t - frames[i].t));
    lines.push(`file '${frames[i].name}'`, `duration ${d.toFixed(4)}`);
  }
  lines.push(`file '${frames[frames.length - 1].name}'`, 'duration 0.2', `file '${frames[frames.length - 1].name}'`);
  writeFileSync(join(dir, 'frames.txt'), lines.join('\n') + '\n');
  const span = frames[frames.length - 1].t - frames[0].t;
  console.log(`  ${dir.split('/').pop()}: ${frames.length} frames, ${span.toFixed(1)}s, ${(frames.length / span).toFixed(1)} fps`);
}

// Shared: title → hero select → live table (real clicks, real bloom).
async function bootToTable(page, { flourish = false, pick = 2 } = {}) {
  if (flourish) { await page.mouse.move(960, 900); await sleep(300); await hover(page, '#title-screen .ts-play'); await sleep(1200); }
  await page.evaluate(() => { window._mpSkipQueue = true; });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('#title-screen .ts-card')]
      .find(x => /play/i.test(x.textContent) && !/how|private|skirmish/i.test(x.textContent));
    b.click();
  });
  await page.waitForFunction(() => document.querySelector('.character-card')?.offsetParent, { timeout: 20000 });
  await sleep(600);
  if (flourish) {
    await hover(page, '.character-card', 0); await sleep(700);
    await hover(page, '.character-card', 3); await sleep(700);
  }
  const heroCount = await page.evaluate(() => document.querySelectorAll('.character-card').length);
  await click(page, '.character-card', Math.min(pick, Math.max(0, heroCount - 1)));
  await sleep(flourish ? 1200 : 700);
  await click(page, '#confirmBtn');
  await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 25000 });
  await sleep(1200);
  await clearCoach(page);
  await sleep(600);
}

// One full throw round: card flies, rivals answer, the reveal chooser
// comes up, we PLAY, the floats land, rival spotlights roll.
async function throwRound(page, { dwell = 1500 } = {}) {
  await page.evaluate(() => {
    const p0 = game.players[0];
    const i = p0.hand.findIndex(c => { try { return checkRequirements(c, p0) !== false; } catch (e) { return true; } });
    throwCard(Math.max(0, i));
  }).catch(() => page.evaluate(() => throwCard(0)));
  await sleep(1000);
  await page.evaluate(() => {
    for (let s = 1; s < game.playerCount; s++) {
      if (game.pendingActivations[s] === null && game.players[s].hand.length) aiPickCard(s);
    }
    renderGameState();
    maybeLockThrows();
  });
  await page.waitForFunction(() => window._finalChoicePending === true, { timeout: 25000 });
  await sleep(dwell);                       // the chooser's art breathes
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#actionPanel .action-btn')].filter(b => !b.disabled);
    const b = btns.find(x => /^play\b/i.test(x.textContent.trim())) || btns[0];
    if (b) b.click();
  });
}

const SCENES = {
  // A · the first hand — menu flourish, hero pick, throw, reveal, floats
  async firstplay() {
    const page = await openPage();
    await record(page, join(BASE, 'firstplay'), async () => {
      await bootToTable(page, { flourish: true });
      await page.evaluate(() => {
        const take = (names) => names.map(n => ({ ...FAVOR_DATA.cards.find(c => c.name === n) })).filter(c => c.name);
        const p0 = game.players[0];
        p0.gold = 14; p0.prestige = 8; p0.favor = 12;
        p0.playedCards = take(['Hunting', 'First Aid']);
        game.applySlotSkills(p0);
        renderGameState();
      });
      await sleep(900);
      await throwRound(page, { dwell: 1800 });
      await sleep(6000);                     // floats + rival spotlights
      await clearCoach(page);
      await sleep(1800);
    });
    await page.close();
  },

  // B · missions — the herald's ceremony, then the royal board
  async missions() {
    const page = await openPage();
    await record(page, join(BASE, 'missions'), async () => {
      await bootToTable(page);
      const ok = await page.evaluate(() => {
        const by = (n) => ({ ...FAVOR_DATA.missions.find(m => m.name === n) });
        const p0 = game.players[0], p1 = game.players[1], p2 = game.players[2];
        p0.skills = { ...p0.skills, survival: 6, power: 12, knowledge: 4 };
        p0.philosopherStone = 2;
        p0.missions = [by('King of the Sky')];
        p1.missions = [by('Defending the Kingdom')];   // unmet — the herald's bad news
        p2.missions = [by('A Day With the Birds')];
        p2.skills = { ...p2.skills, knowledge: 3 };
        game.currentAct = 3;
        const res = game.resolveMissions();
        renderGameState();
        if (!res || !res.length) return false;
        showMissionCeremony(res, 3);
        return true;
      });
      if (!ok) throw new Error('mission rig yielded no results');
      await sleep(12000);                    // beats reveal (tap-or-timer pacing)
      await page.evaluate(() => { const el = document.getElementById('missionCeremony'); if (el) el.click(); });
      await sleep(4000);
      await page.evaluate(() => { document.getElementById('missionCeremony')?.classList.remove('active'); });
      await page.evaluate(() => openBoardOverlay());
      await sleep(3500);
      await page.evaluate(() => closeBoardOverlay());
      await sleep(800);
    });
    await page.close();
  },

  // C · the melee — Skylar's cinematic, the flashiest 15 seconds we own
  async melee() {
    const page = await openPage();
    await record(page, join(BASE, 'melee'), async () => {
      await bootToTable(page);
      const ok = await page.evaluate(() => {
        const take = (names) => names.map(n => ({ ...FAVOR_DATA.cards.find(c => c.name === n) })).filter(c => c.name);
        const powerCards = FAVOR_DATA.cards.filter(c => (c.skills || []).includes('power')).slice(0, 6).map(c => c.name);
        game.players.forEach((p, i) => {
          p.playedCards = take(powerCards.slice(i * 2, i * 2 + 2));
          p.prestige = 8 + i * 3;
          game.applySlotSkills(p);
        });
        const res = game.resolveMelee();
        if (!res || !res.length) return false;
        showMeleeSplash(res, 2);
        return true;
      });
      if (!ok) throw new Error('melee rig yielded no results');
      await sleep(20000);                    // the full cinematic + forge hold
    });
    await page.close();
  },

  // D · WANTED — the daily rival: plaque, poster, Face Them, first throw
  async wanted() {
    const page = await openPage();
    await record(page, join(BASE, 'wanted'), async () => {
      await page.mouse.move(960, 720); await sleep(300);
      await hover(page, '#rivalPlaque'); await sleep(1400);
      await page.evaluate(() => FMODES.openDailyRival());
      await sleep(2600);                     // the poster breathes
      await page.evaluate(() => { window._mpSkipQueue = true; });
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('#rivalIntro button')]
          .find(x => /face them|rematch/i.test(x.textContent));
        if (b) b.click();
      });
      await page.waitForFunction(() => document.querySelector('.character-card')?.offsetParent, { timeout: 20000 });
      await sleep(700);
      const heroCount = await page.evaluate(() => document.querySelectorAll('.character-card').length);
      await click(page, '.character-card', Math.min(1, heroCount - 1));
      await sleep(900);
      await click(page, '#confirmBtn');
      await page.waitForFunction(() => typeof game !== 'undefined' && game && game.players[0].character, { timeout: 25000 });
      await sleep(1400);
      await clearCoach(page);
      await throwRound(page, { dwell: 1200 });
      await sleep(4000);
    });
    await page.close();
  },

  // E · the crowning — a fat final sheet, then the daily champions
  async victory() {
    const page = await openPage();
    await record(page, join(BASE, 'victory'), async () => {
      await bootToTable(page);
      await page.evaluate(() => {
        const take = (names) => names.map(n => ({ ...FAVOR_DATA.cards.find(c => c.name === n) })).filter(c => c.name);
        game.players.forEach((p, i) => {
          p.favor = [46, 31, 24][i] || 20;
          p.gold = [18, 9, 12][i] || 8;
          p.prestige = [14, 11, 6][i] || 5;
          p.scorn = [2, 6, 9][i] || 4;
          p.completedMissions = [];
          p.playedCards = take(['Hunting', 'First Aid', 'Warm Mentorship'].slice(0, 2 + (i === 0 ? 1 : 0)));
        });
        game.currentAct = 3;
        showScoring();
      });
      await sleep(9000);                     // the sheet's reveal cinematics
      await page.evaluate(() => { hideActionPanel && hideActionPanel(); FLB.openLeaderboard('daily'); });
      await page.waitForFunction(() => document.querySelectorAll('#lbBody .lb-row').length >= 1, { timeout: 12000 }).catch(() => {});
      await sleep(3200);
    });
    await page.close();
  },
};

// ── the end card still (1080×1920) ────────────────────────────────────
async function endcard() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await page.goto(URL + 'marketing/applovin/endcard.html', { waitUntil: 'networkidle0' });
  await sleep(600);
  await page.screenshot({ path: join(BASE, '..', 'endcard.png') });
  console.log('  endcard.png captured');
  await page.close();
}

const keys = only ? [only] : Object.keys(SCENES);
for (const k of keys) {
  if (!SCENES[k]) { console.error(`no scene "${k}" (have: ${Object.keys(SCENES).join(', ')})`); process.exit(1); }
  console.log(`── scene: ${k}`);
  try { await SCENES[k](); }
  catch (e) { console.error(`  ✗ ${k} failed: ${e.message}`); process.exitCode = 1; }
}
if (!only || only === 'endcard') await endcard();

// Scrub the capture identity from the live realm (trailer law).
const scrub = await browser.newPage();
await scrub.goto(URL, { waitUntil: 'networkidle2' });
await scrub.evaluate(async () => {
  try { await firebase.database().ref('favor/players/uadcapture001').remove(); } catch (e) { /* offline */ }
});
await scrub.close();
await browser.close();
console.log('capture done');
