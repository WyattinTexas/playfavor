#!/usr/bin/env node
/**
 * FAVOR — one-time rating migration to Nation's 1.00–7.00 Elo scale
 * (Wyatt 7/17). Every favor/players row still on the old +25-per-win
 * integer scale maps rating → old*4 + 1000 (order preserved; the old
 * board lands between 1.00 and ~2.2) and gets stamped ratingV: 2.
 *
 * PATCH-only, never delete (persona rows are PERMANENT). Rows already
 * stamped ratingV 2 are skipped — safe to re-run any time; new-code
 * clients also self-migrate legacy rows on their next write, so this
 * script is the sweep that catches everyone who never plays again.
 *
 *   python3 -m http.server 8891 --directory . &   (repo root)
 *   node tools/migrate-ratings-70.mjs
 */
import puppeteer from 'puppeteer-core';

const URL = process.env.AUDIT_URL || 'http://localhost:8891/';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--mute-audio'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });
const mode = await page.evaluate(() => FLB.mode);
if (mode !== 'firebase') {
  console.error(`ABORT: leaderboard offline (mode=${mode}) — nothing migrated`);
  await browser.close();
  process.exit(1);
}

const report = await page.evaluate(async () => {
  const clamp = (r) => Math.max(0, Math.min(7000, Math.round(r)));
  const snap = await firebase.database().ref('favor/players').get();
  const players = snap.val() || {};
  const out = { migrated: [], skipped: 0, stubs: 0 };
  for (const [uid, row] of Object.entries(players)) {
    if (!row || row.rating == null) { out.stubs++; continue; }
    if (row.ratingV === 2) { out.skipped++; continue; }
    const to = clamp(row.rating * 4 + 1000);
    await firebase.database().ref(`favor/players/${uid}`)
      .update({ rating: to, ratingV: 2 });
    out.migrated.push(`${row.name || uid}: ${row.rating} -> ${to} (${(to / 1000).toFixed(2)})`);
  }
  return out;
});

console.log(`migrated ${report.migrated.length} rows, ${report.skipped} already v2, ${report.stubs} ratingless stubs left alone`);
report.migrated.forEach(l => console.log('  ' + l));
await browser.close();
