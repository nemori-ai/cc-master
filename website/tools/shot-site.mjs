#!/usr/bin/env node
/**
 * shot-site.mjs — capture built pages for visual review.
 * Usage: node tools/shot-site.mjs [urlPath] [outPrefix] [--dark] [--slices N]
 * Scrolls through the page first so reveal animations settle, then captures
 * viewport slices (outPrefix-00.png …) — avoids Chrome's 16384px texture cap.
 */
import { chromium } from 'playwright-core';

const urlPath = process.argv[2] || '/';
const outPrefix = process.argv[3] || '/tmp/site';
const dark = process.argv.includes('--dark');
const slicesIdx = process.argv.indexOf('--slices');
const maxSlices = slicesIdx >= 0 ? Number(process.argv[slicesIdx + 1]) : 20;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  baseURL: process.env.SITE_BASE || 'http://localhost:4321',
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: dark ? 'dark' : 'light',
});
await ctx.addInitScript((theme) => localStorage.setItem('ccm-theme', theme), dark ? 'dark' : 'light');
const page = await ctx.newPage();
await page.goto(urlPath, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// scroll through to trigger reveals
const height = await page.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < height; y += 700) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(140);
}
await page.waitForTimeout(900);

const total = Math.min(Math.ceil(height / 900), maxSlices);
for (let i = 0; i < total; i++) {
  await page.evaluate((y) => window.scrollTo(0, y), i * 900);
  await page.waitForTimeout(240);
  await page.screenshot({ path: `${outPrefix}-${String(i).padStart(2, '0')}.png` });
}
console.log(`✓ ${total} slices → ${outPrefix}-*.png (page ${height}px)`);
await browser.close();
