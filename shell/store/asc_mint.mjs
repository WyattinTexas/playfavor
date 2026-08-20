#!/usr/bin/env node
/**
 * THE UI-MINT DANCE (proven 8/20): the JWT API cannot put FIRST consumables
 * on a review submission — only the ASC web UI's "Add for Review" button can
 * (favor_store.py submit then adds the version item to the same draft).
 *
 * Needs an ASC-logged-in Chrome on :9345 — the profile-copy rig:
 *   RIG=<scratch>/ascrig; mkdir -p "$RIG/Default"
 *   cp "~/Library/Application Support/Google/Chrome/Local State" "$RIG/"
 *   cp .../Default/{Cookies,Preferences,"Secure Preferences"} "$RIG/Default/"
 *   rsync -a .../Default/"Local Storage" "$RIG/Default/"
 *   Chrome --user-data-dir="$RIG" --profile-directory=Default \
 *     --remote-debugging-port=9345 --headless=new  (delete $RIG after!)
 *
 * ⚠⚠ Traps (all bit 8/20):
 *  - The add MUST be a REAL mouse click (page.mouse at coordinates):
 *    synthetic el.click() opens the button's menu but the menuitem's add
 *    handler ignores untrusted events — it "picks" and nothing lands.
 *  - Match ONLY [role=menuitem] "Draft Submission (N)": the top bar has a
 *    "Draft Submissions (N)" pill (plural) that merely opens the drawer,
 *    and the menu's other entry "Create New Submission" must never match.
 *  - The API item count lags the click by a few seconds — verify with
 *    patience: GET /v1/reviewSubmissions/<draft>/items.
 *  - Direct-URL product pages take ~5s to hydrate; act after a long settle.
 */
import puppeteer from 'puppeteer-core';

const APP = '6790169069';
const IAPS = [
  ['stars.s',  '6798394839'],
  ['stars.m',  '6798394873'],
  ['stars.l',  '6798394735'],
  ['stars.xl', '6798394736'],
];
const OUT = process.env.OUT || '/tmp';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9345', defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });

async function rectOf(matchFn) {
  return page.evaluate((fnSrc) => {
    const fn = eval(fnSrc);
    const el = fn();
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: el.textContent.trim().slice(0, 60) };
  }, matchFn.toString());
}

for (const [name, id] of IAPS) {
  console.log(`── ${name} (${id})`);
  await page.goto(`https://appstoreconnect.apple.com/apps/${APP}/distribution/iaps/${id}`,
    { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(6000);

  const state = await page.evaluate(() => document.body.innerText.slice(0, 2000));
  if (/remove from submission/i.test(state)) { console.log('   already on a submission, skipping'); continue; }

  const btn = await rectOf(() =>
    [...document.querySelectorAll('button, [role="button"]')]
      .find(el => el.offsetParent && /^add for review$/i.test(el.textContent.trim())));
  if (!btn) {
    console.log('   ✗ no Add for Review button');
    await page.screenshot({ path: `${OUT}/mint-${name}-nobutton.png` });
    continue;
  }
  await page.mouse.click(btn.x, btn.y);
  await sleep(1600);

  // First product ever: the click alone creates the draft (no menu appears).
  const item = await rectOf(() =>
    [...document.querySelectorAll('[role="menuitem"]')]
      .find(el => el.offsetParent && /^draft submission \(\d+\)/i.test(el.textContent.trim()) &&
                  !/create new/i.test(el.textContent)));
  if (item) {
    console.log('   menu shows:', item.text);
    await page.mouse.move(item.x, item.y);
    await sleep(300);
    await page.mouse.click(item.x, item.y);
  } else {
    console.log('   no chooser — first item created the draft');
  }
  await sleep(3000);
  await page.screenshot({ path: `${OUT}/mint-${name}.png` });
}

await page.close();
browser.disconnect();
console.log('mint done — verify: GET /v1/reviewSubmissions?filter[state]=READY_FOR_REVIEW → items');
