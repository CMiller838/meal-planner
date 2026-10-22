// Click through the app's core flow like a user, on PC and phone: browse -> open a meal -> toggle theme -> generate a
// 2-week plan -> see the shopping list. Meal Planner specific (ids come from the pages). Seeds nothing: the app loads its
// own seed library. Usage: node walk.mjs [--shots dir] [--base http://host:port]  (default: serves the repo itself).
// BROWSER_CHANNEL=msedge drives Edge. Exit 1 on any failed step.
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const shots = arg('shots', '');
const srv = arg('base') ? null : await serve(path.resolve('../..'));
const base = arg('base') || srv.base;
const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});
if (shots) fs.mkdirSync(shots, { recursive: true });
let failed = 0;

for (const [vp, size] of Object.entries({ pc: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } })) {
  const ctx = await browser.newContext({ viewport: size }), page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const step = async (name, fn) => {
    const t0 = Date.now(), ms = () => ` (${((Date.now() - t0) / 1000).toFixed(1)}s)`;
    try { await fn(); console.log(`ok   ${vp} ${name}${ms()}`); }
    catch (e) { failed++; console.log(`FAIL ${vp} ${name}: ${String(e.message).split('\n')[0].slice(0, 160)}`); }
  };
  const shot = n => shots && page.screenshot({ path: path.join(shots, `walk-${vp}-${n}.png`) });
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);

  await step('browse: library lists meals', async () => {
    await page.goto(`${base}/index.html`);
    await page.waitForSelector('#library-grid .card');
    if (await page.locator('#library-grid .card').count() < 3) throw new Error('fewer than 3 meal cards');
    await shot('browse');
  });
  await step('browse: search narrows the list', async () => {
    const all = await page.locator('#library-grid .card').count();
    await page.fill('#library-search', 'toastie');
    await page.waitForTimeout(300);
    const some = await page.locator('#library-grid .card').count();
    if (!(some >= 1 && some < all)) throw new Error(`search left ${some} of ${all} cards`);
    await page.fill('#library-search', '');
  });
  await step('browse: a meal opens its sheet and closes', async () => {
    await page.locator('#library-grid .card').first().click();
    await page.waitForSelector('#modal-overlay:not(.hidden)');
    await shot('meal-sheet');
    await page.keyboard.press('Escape');
    if (await page.locator('#modal-overlay:not(.hidden)').count()) await page.mouse.click(5, 5);
    await page.waitForSelector('#modal-overlay.hidden', { state: 'attached' });
  });
  await step('theme toggle flips dark/light and persists', async () => {
    const before = await theme();
    await page.click('#theme-toggle');
    const after = await theme();
    if (before === after) throw new Error(`still ${after}`);
    await page.reload();
    if (await theme() !== after) throw new Error('theme not kept after reload');
    await page.click('#theme-toggle');
  });
  await step('plan: Generate builds a 2-week plan', async () => {
    await page.goto(`${base}/plan.html`);
    await page.click('#generate-btn');
    await page.waitForSelector('#plan-root .slot-card', { timeout: 15000 });
    if (await page.locator('#plan-root .slot-card').count() < 7) throw new Error('fewer than 7 plan slots');
    await shot('plan');
  });
  await step('shopping: list is built from the plan', async () => {
    await page.goto(`${base}/shopping.html`);
    await page.waitForSelector('#shopping-root .shop-line', { timeout: 10000 });
    await shot('shopping');
  });
  await step('pantry: tab, scan sheet check-digit error, manual product saves and lists with est.', async () => {
    await page.goto(`${base}/shopping.html#pantry`);
    await page.waitForSelector('#panel-pantry:not(.hidden) #scan-btn');
    await page.click('#scan-btn');
    await page.fill('#scan-digits', '1234567890123');
    await page.click('#scan-go');
    await page.waitForFunction(() => /check digit/.test(document.getElementById('scan-msg').textContent));
    await page.keyboard.press('Escape');
    await page.click('#add-product-btn');
    await page.fill('#pf-name', 'Walk <b>rice</b>');
    await page.fill('[data-nutrient="protein_g"]', '7.5');
    await page.click('#pf-save');
    await page.waitForSelector('#pantry-root .prod-chip[data-open]');
    await page.evaluate(() => {
      const m = JSON.parse(localStorage.getItem('mp_products'));
      m.products[0].nutrients.fat_g = { value: 1, basis: 'estimate' };
      localStorage.setItem('mp_products', JSON.stringify(m));
    });
    await page.reload();
    await page.click('#pantry-root .prod-chip[data-open]');
    await page.waitForSelector('.prod-table .est');
    if (await page.locator('.modal-sheet b').count()) throw new Error('product name rendered as HTML');
    await shot('pantry');
    await page.keyboard.press('Escape');
  });
  await step('pantry: overdue use-by shows in the strip, use it up lists meals, date entry sticks', async () => {
    await page.evaluate(() => localStorage.setItem('mp_pantry', JSON.stringify({ updatedAt: new Date().toISOString(), items: [{ name: 'cheese', qty: '200g', useBy: '2020-01-01' }, { name: 'bread' }] })));
    await page.reload();
    await page.waitForSelector('.useup-strip li.over');
    await page.click('#useup-btn');
    await page.waitForSelector('.modal-sheet [data-meal]');
    await shot('useitup');
    await page.keyboard.press('Escape');
    await page.click('[data-useby="bread"]', { timeout: 1000 }).catch(() => {}); // bread only has the link when an estimate exists
    await page.click('[data-useby="cheese"]');
    await page.fill('#useby-in', '2099-01-01');
    await page.click('#useby-save');
    await page.waitForSelector('.useby:not(.over)');
    if (await page.locator('.useup-strip').count()) throw new Error('strip should be empty after moving the date');
  });
  await step('no uncaught page errors during the walk', async () => { if (errs.length) throw new Error(errs[0]); });
  await ctx.close();
}
await browser.close(); srv?.close();
console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
