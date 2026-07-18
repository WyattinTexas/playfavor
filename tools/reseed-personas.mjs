#!/usr/bin/env node
/**
 * FAVOR — spread the persona rungs across the ladder's real range
 * (Wyatt 7/18).
 *
 * The five personas were seeded 1960/1740/1560/1380/1240, which all sat
 * inside the band humans clear in a couple of weeks: on 7/18 every real
 * player was rated 1.04-1.24 (median 1.10) and the top persona was 1.96.
 * Under the banded ladder the population would have passed the entire
 * table within a month and had nobody left to chase. The new spread —
 * 1200 / 1700 / 2200 / 2800 / 3500 — keeps rungs above the population for
 * months.
 *
 * PATCH-only, and personas are NEVER deleted: their history IS the board's
 * history. This writes exactly two fields (rating, ratingV) via update(),
 * leaving games/wins/power/champs/chars untouched.
 *
 * Idempotent: a row already sitting at its target seed is skipped, so
 * re-running is safe. A persona with a REAL history (>= KEEP_GAMES games)
 * has earned its position and is left alone — drift is the ladder working —
 * unless you pass --force. On 7/18 all five had 0-2 games and near-zero
 * drift, so all five took the new rungs.
 *
 *   python3 -m http.server 8891 --directory . &   (repo root)
 *   node tools/reseed-personas.mjs [--force] [--dry]
 */
import puppeteer from 'puppeteer-core';

const URL = process.env.AUDIT_URL || 'http://localhost:8891/';
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry');

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--mute-audio'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 20000 });
const mode = await page.evaluate(() => FLB.mode);
if (mode !== 'firebase') {
  console.error(`ABORT: leaderboard offline (mode=${mode}) — nothing reseeded`);
  await browser.close();
  process.exit(1);
}

const report = await page.evaluate(async ({ force, dry }) => {
  const defs = FLB.personaDefs();          // the PERSONAS table, seeds included
  const out = { wrote: [], skipped: [], missing: [], mode: { force, dry } };
  for (const d of defs) {
    const seed = d.seedRating;
    const ref = firebase.database().ref(`favor/players/${d.uid}`);
    const row = (await ref.get()).val();
    if (!row) {
      // No row yet — the persona seeds itself on its first game. Nothing
      // to patch, and creating a bare row here would materialize a
      // gameless citizen on the board.
      out.missing.push(`${d.name} (${d.uid}) — no row yet, will seed at ${seed} on first game`);
      continue;
    }
    const cur = row.ratingV === 2 ? row.rating : (row.rating == null ? null : row.rating * 4 + 1000);
    if (cur === seed) { out.skipped.push(`${d.name}: already ${(seed / 1000).toFixed(2)}`); continue; }
    // A row with a REAL history has earned its position; only --force
    // overrides. A handful of games is not a history — reseeding those is
    // the difference between a deliberate ladder of rungs and a half-applied
    // spread, which is worse than either arrangement.
    const KEEP_GAMES = 10;
    if (!force && (row.games || 0) >= KEEP_GAMES && cur != null) {
      out.skipped.push(`${d.name}: ${(cur / 1000).toFixed(2)} after ${row.games} game(s) — earned drift kept (use --force to override)`);
      continue;
    }
    if (!dry) await ref.update({ rating: seed, ratingV: 2 });
    out.wrote.push(`${d.name}: ${cur == null ? '(unrated)' : (cur / 1000).toFixed(2)} -> ${(seed / 1000).toFixed(2)}`);
  }
  return out;
}, { force: FORCE, dry: DRY });

console.log(`${DRY ? '[DRY RUN] ' : ''}reseeded ${report.wrote.length}, skipped ${report.skipped.length}, absent ${report.missing.length}`);
report.wrote.forEach(l => console.log('  + ' + l));
report.skipped.forEach(l => console.log('  = ' + l));
report.missing.forEach(l => console.log('  ? ' + l));
await browser.close();
