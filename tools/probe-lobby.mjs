import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://localhost:8891/', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.FLB && FLB.mode === 'firebase', { timeout: 15000 });
await page.evaluate(() => { FMODES.openPrivateRoom(); });
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: 'tools/audit-shots/probe-room-door.png' });
await page.evaluate(() => FMODES.hostRoom());
await page.waitForFunction(() => document.querySelector('#roomOverlay .rm-code'), { timeout: 12000 });
await page.evaluate(() => FMODES.roomSetSize(4));
await new Promise(r => setTimeout(r, 600));
const geo = await page.evaluate(() => {
  const inner = document.querySelector('.rm-inner');
  const r = inner.getBoundingClientRect();
  return {
    w: Math.round(r.width),
    hscroll: inner.scrollWidth > inner.clientWidth + 1,
    overlayScroll: document.getElementById('roomOverlay').scrollWidth > window.innerWidth + 1,
    rows: [...document.querySelectorAll('.rm-row')].map(x => x.textContent.trim()),
    note: (document.querySelector('.rm-note') || {}).textContent,
    startBtn: (document.querySelector('.rm-actions .primary span') || {}).textContent,
  };
});
console.log(JSON.stringify(geo, null, 1));
await page.screenshot({ path: 'tools/audit-shots/probe-room-lobby.png' });
const code = await page.evaluate(() => document.querySelector('#roomOverlay .rm-code').textContent.trim());
await page.evaluate(async (c) => {
  FMODES.closePrivateRoom();
  await firebase.database().ref(`favor/mp/rooms/${c}`).remove();
}, code);
await browser.close();
console.log('LOBBY PROBE DONE');
