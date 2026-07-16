import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://localhost:8891/', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => window.FLB && FLB.mode !== 'connecting', { timeout: 15000 });
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: 'tools/audit-shots/probe-bg-desktop.png' });
await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: 'tools/audit-shots/probe-bg-phone.png' });
await browser.close();
console.log('BG SHOTS DONE');
