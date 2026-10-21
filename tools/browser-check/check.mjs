#!/usr/bin/env node
// Drive a real browser against a local prototype file or a dev-server URL.
// Usage:
//   node check.mjs <url-or-file> [--expand "sel1,sel2"] [--click "sel1,sel2"]
//                  [--screenshot out.png] [--text "sel1,sel2"] [--wait ms]
//
// <url-or-file>   http(s) URL, or a filesystem path (relative paths are
//                 resolved against the current directory, not this script).
// --expand        comma-separated selectors; for each, if it's a <details>
//                 element that isn't already open, click its :scope > summary.
//                 Use this for the accordion pattern (details.group, details.item-d)
//                 used in prototype pages.
// --click         comma-separated selectors clicked in order (any element).
// --screenshot    path to save a full-page PNG. Defaults to none.
// --text          comma-separated selectors whose innerText is captured after
//                  all expand/click steps and returned in the JSON result.
// --wait          milliseconds to wait after load before interacting (default 0).
//
// Requires PLAYWRIGHT_BROWSERS_PATH set to the local .browsers/ folder in this
// directory (the global playwright cache is read-only in this environment):
//   PLAYWRIGHT_BROWSERS_PATH="$(pwd)/.browsers" node check.mjs ...
//
// Prints one JSON object to stdout: { url, title, texts, consoleErrors, pageErrors }

import { chromium } from 'playwright';
import path from 'node:path';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[++i]; }
    else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const target = args._[0];
if (!target) {
  console.error('Usage: node check.mjs <url-or-file> [--expand sel1,sel2] [--click sel1,sel2] [--screenshot out.png] [--text sel1,sel2] [--wait ms]');
  process.exit(1);
}

const url = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);
const expandSelectors = args.expand ? args.expand.split(',').map(s => s.trim()) : [];
const clickSelectors = args.click ? args.click.split(',').map(s => s.trim()) : [];
const textSelectors = args.text ? args.text.split(',').map(s => s.trim()) : [];
const waitMs = args.wait ? Number(args.wait) : 0;

const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}); // BROWSER_CHANNEL=msedge drives the Windows Edge
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
const pageErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', e => pageErrors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
if (waitMs) await page.waitForTimeout(waitMs);

for (const sel of expandSelectors) {
  const el = page.locator(sel).first();
  const count = await page.locator(sel).count();
  for (let i = 0; i < count; i++) {
    const item = page.locator(sel).nth(i);
    const isOpen = await item.evaluate(node => node.tagName === 'DETAILS' ? node.open : true).catch(() => true);
    if (!isOpen) {
      await item.locator(':scope > summary').first().click({ trial: false }).catch(() => {});
    }
  }
}

for (const sel of clickSelectors) {
  await page.locator(sel).first().click();
}
if (waitMs) await page.waitForTimeout(waitMs);

const texts = {};
for (const sel of textSelectors) {
  texts[sel] = await page.locator(sel).allInnerTexts();
}

if (args.screenshot) {
  await page.screenshot({ path: path.resolve(args.screenshot), fullPage: false });
}

const title = await page.title();
await browser.close();

console.log(JSON.stringify({ url, title, texts, consoleErrors, pageErrors }, null, 2));
