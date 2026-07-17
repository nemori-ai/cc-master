#!/usr/bin/env node
/**
 * capture.mjs — capture ccm web-viewer screenshots + interaction loop for the site.
 *
 * Prereqs: `ccm` on PATH; a demo home seeded with boards (default /tmp/ccm-site-demo,
 * seeded from tests/fixtures/board.example.json by tools/seed-demo-home.sh).
 * Uses system Chrome via playwright-core (no browser download).
 *
 * Usage: node tools/capture.mjs [--only name1,name2] [--no-video]
 * Output: website/assets-src/*.png|*.webm (raw, gitignored) → optimize-images.mjs next.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, '..', 'assets-src');
const HOME = process.env.CCM_DEMO_HOME || '/tmp/ccm-site-demo';
const VIEWPORT = { width: 1600, height: 1000 };
const SCALE = 2;

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1].split(',').map((s) => s.trim()) : null;
})();
const noVideo = process.argv.includes('--no-video');

const SHOTS = [
  { name: 'viewer-graph-dark', theme: 'dark', view: 'graph' },
  { name: 'viewer-graph-light', theme: 'light', view: 'graph' },
  { name: 'viewer-board-dark', theme: 'dark', view: 'board' },
  { name: 'viewer-timeline-dark', theme: 'dark', view: 'timeline' },
  { name: 'viewer-agents-dark', theme: 'dark', view: 'agents' },
  { name: 'viewer-decision-dark', theme: 'dark', view: 'graph', task: 'D1' },
  { name: 'viewer-decision-light', theme: 'light', view: 'graph', task: 'D1' },
  { name: 'viewer-switcher-dark', theme: 'dark', view: 'graph', switcher: true },
];

function ensureService() {
  const out = execFileSync(
    'ccm',
    ['web-viewer', 'start', '--home', HOME, '--no-open', '--json'],
    { encoding: 'utf8' },
  );
  const svc = JSON.parse(out).service;
  const token = fs.readFileSync(svc.token_file, 'utf8').trim();
  return { base: `${svc.base_url}/?token=${token}` };
}

async function newPage(browser, shot, videoDir) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: shot.theme,
    ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } } } : {}),
  });
  await context.addInitScript(
    ([theme, view]) => {
      localStorage.setItem('ccm-theme', theme);
      localStorage.setItem('ccm-view', view);
    },
    [shot.theme, shot.view],
  );
  const page = await context.newPage();
  return { context, page };
}

async function settle(page, ms = 2600) {
  await page.waitForLoadState('load');
  await page.waitForTimeout(ms); // fonts + dagre layout + first poll
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const { base } = ensureService();
  console.log(`viewer: ${base.replace(/token=.{6}.*/, 'token=…')}`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const shot of SHOTS) {
      if (only && !only.includes(shot.name)) continue;
      const { context, page } = await newPage(browser, shot);
      const url = shot.task ? `${base}&task=${shot.task}` : base;
      await page.goto(url, { waitUntil: 'load' });
      await settle(page);
      if (shot.switcher) {
        await page.click('button.board-chip');
        await page.waitForTimeout(700);
      }
      const file = path.join(RAW, `${shot.name}.png`);
      await page.screenshot({ path: file });
      console.log(`✓ ${shot.name}.png`);
      await context.close();
    }

    if (!noVideo && (!only || only.includes('viewer-loop'))) {
      const videoDir = path.join(RAW, '.video-tmp');
      fs.rmSync(videoDir, { recursive: true, force: true });
      const shot = { theme: 'dark', view: 'graph' };
      const { context, page } = await newPage(browser, shot, videoDir);
      await page.goto(base, { waitUntil: 'load' });
      await settle(page, 2200);
      // gentle pan
      await page.mouse.move(820, 420);
      await page.mouse.down();
      await page.mouse.move(760, 380, { steps: 14 });
      await page.mouse.up();
      await page.waitForTimeout(900);
      // zoom in a touch
      await page.mouse.wheel(0, -320);
      await page.waitForTimeout(1100);
      // open the decision card (deep link keeps recording in the same tab)
      await page.goto(`${base}&task=D1`, { waitUntil: 'load' });
      await settle(page, 2800);
      // back to the graph
      await page.goto(base, { waitUntil: 'load' });
      await settle(page, 1600);
      await context.close(); // finalizes the .webm
      const vids = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
      if (vids.length) {
        fs.renameSync(path.join(videoDir, vids[0]), path.join(RAW, 'viewer-loop.webm'));
        console.log('✓ viewer-loop.webm');
      }
      fs.rmSync(videoDir, { recursive: true, force: true });
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
