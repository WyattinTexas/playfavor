#!/usr/bin/env node
/**
 * FAVOR — one-time persona rename (Wyatt 7/16): the five leaderboard
 * citizens get realistic names; the thematic style moves to Skirmish AI.
 *
 * PATCH-only, never delete: each row's `name` field updates in place —
 * rating/stars/games history stays untouched (favor-avatars-leaderboard
 * rule). Runs through the page's own Firebase handle so it carries the
 * exact permissions the game has.
 *
 *   python3 -m http.server 8891 --directory . &   (repo root)
 *   node tools/rename-personas.mjs
 */
import puppeteer from 'puppeteer-core';

const URL = process.env.AUDIT_URL || 'http://localhost:8891/';

const RENAMES = {
  persona_ashcroft:   'HotshotGG',
  persona_balthazar:  'Athene',
  persona_vespertine: 'Sneaky Penguin',
  persona_rosalind:   'Mable Stadango',
  persona_thorne:     'Papa Johns',
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });

const mode = await page.evaluate(() => FLB.mode);
if (mode !== 'firebase') {
  console.error(`ABORT: leaderboard offline (mode=${mode}) — nothing patched.`);
  await browser.close();
  process.exit(1);
}

const result = await page.evaluate(async (renames) => {
  const out = [];
  for (const [uid, name] of Object.entries(renames)) {
    const ref = firebase.database().ref(`favor/players/${uid}`);
    const before = (await ref.get()).val();
    if (!before) { out.push({ uid, ok: false, why: 'row missing' }); continue; }
    await ref.child('name').set(name);           // PATCH one field, never the row
    const after = (await ref.child('name').get()).val();
    out.push({ uid, ok: after === name, was: before.name, now: after,
               rating: before.rating, games: before.games });
  }
  return out;
}, RENAMES);

let bad = 0;
for (const r of result) {
  if (r.ok) console.log(`  ✓ ${r.uid}: "${r.was}" → "${r.now}" (rating ${r.rating}, games ${r.games || 0} untouched)`);
  else { bad++; console.log(`  ✗ ${r.uid}: ${r.why || 'verify failed'}`); }
}
await browser.close();
console.log(bad ? `❌ ${bad} rows failed` : '✅ all five persona rows renamed in place');
process.exit(bad ? 1 : 0);
