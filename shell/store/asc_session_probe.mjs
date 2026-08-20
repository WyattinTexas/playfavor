#!/usr/bin/env node
// Probe the ASC profile-copy rig on :9345 — does the copied session hold?
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9345', defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto('https://appstoreconnect.apple.com/apps', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 3000));
console.log('URL:', page.url());
const text = await page.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n+/g, ' | '));
console.log('BODY:', text);
await page.screenshot({ path: process.env.SHOT || '/tmp/asc_probe.png' });
browser.disconnect();
