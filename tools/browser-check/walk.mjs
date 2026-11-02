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
    catch (e) { failed++; console.log(`FAIL ${vp} ${name}: ${process.env.WALK_FULL ? String(e.message).slice(0, 1500) : String(e.message).split("\n")[0].slice(0, 160)}`); }
  };
  const shot = n => shots && page.screenshot({ path: path.join(shots, `walk-${vp}-${n}.png`) });
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);

  await step('browse: library lists meals', async () => {
    await page.goto(`${base}/index.html`);
    await page.waitForSelector('#library-grid .meal-card');
    if (await page.locator('#library-grid .meal-card').count() < 3) throw new Error('fewer than 3 meal cards');
    await shot('browse');
  });
  await step('browse: search narrows the list', async () => {
    const all = await page.locator('#library-grid .meal-card').count();
    await page.fill('#library-search', 'toastie');
    await page.waitForTimeout(300);
    const some = await page.locator('#library-grid .meal-card').count();
    if (!(some >= 1 && some < all)) throw new Error(`search left ${some} of ${all} cards`);
    await page.fill('#library-search', '');
    await page.evaluate(() => document.activeElement.blur()); // focused search hides the phone tab bar
  });
  await step('browse: a meal opens its sheet and closes', async () => {
    await page.evaluate(() => document.querySelector('#library-grid .meal-card .mc-ph').click());
    await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    await shot('meal-sheet');
    await page.keyboard.press('Escape');
    if (await page.locator('#meal-sheet-overlay:not(.hidden)').count()) await page.mouse.click(5, 5);
    await page.waitForSelector('#meal-sheet-overlay.hidden', { state: 'attached' });
  });
  await step('phone polish (Phase 108): tab bar at the bottom with the active page, a sheet drags down to close, a short drag snaps back', async () => {
    if (page.viewportSize().width >= 640) return;
    await page.waitForTimeout(500); // tab-bar show transition after the search blur
    const bar = await page.evaluate(() => { const n = document.querySelector('.nav-links'), r = n.getBoundingClientRect(); return { bottom: Math.round(r.bottom) === innerHeight, active: n.querySelector('a.active')?.textContent, pos: getComputedStyle(n).position }; });
    if (bar.pos !== 'fixed' || !bar.bottom || !/Browse/.test(bar.active)) throw new Error('tab bar: ' + JSON.stringify(bar));
    await page.evaluate(() => document.querySelector('#library-grid .meal-card .mc-ph').click());
    await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    await page.waitForTimeout(400); // entry animation
    const r = await page.locator('#meal-sheet').boundingBox();
    const dragBy = async (dy) => { await page.mouse.move(r.x + r.width / 2, r.y + 10); await page.mouse.down(); await page.mouse.move(r.x + r.width / 2, r.y + 10 + dy, { steps: 4 }); await page.mouse.up(); };
    await dragBy(40);
    if (await page.locator('#meal-sheet-overlay.hidden').count()) throw new Error('a 40 px drag closed the sheet');
    await dragBy(160);
    await page.waitForSelector('#meal-sheet-overlay.hidden', { state: 'attached' });
  });
  await step('app shell (Phase 114): icon tabs in order, bar hides on focus; PC pills and centred bar card', async () => {
    const info = await page.evaluate(() => { const n = document.querySelector('.nav-links'), cs = getComputedStyle(n), b = document.querySelector('.ate-bar')?.getBoundingClientRect();
      return { fixed: cs.position === 'fixed', tabs: [...n.querySelectorAll('a')].map((a) => a.querySelector('.tab-l')?.textContent + (a.querySelector('svg use') ? '+ic' : '')), activeIc: !!n.querySelector('a.active svg use'), bw: b && b.width, bx: b && b.left + b.width / 2, iw: innerWidth }; });
    if (info.tabs.join() !== 'Tonight+ic,Browse+ic,Discover+ic,Shopping+ic,Eaten+ic') throw new Error('tabs ' + info.tabs);
    if (!info.activeIc) throw new Error('active pill has no icon');
    if (page.viewportSize().width >= 640) {
      if (info.fixed) throw new Error('PC nav is fixed');
      if (info.bw && (info.bw > 721 || Math.abs(info.bx - info.iw / 2) > 2)) throw new Error('PC bar ' + info.bw + ' @' + info.bx);
      return;
    }
    if (!info.fixed) throw new Error('phone nav not fixed');
    const input = page.locator('.ate-input');
    if (await input.count()) {
      if (await page.locator('.ate-recents:visible').count()) throw new Error('recents visible before focus');
      await input.focus(); await page.waitForTimeout(350);
      const hid = await page.evaluate(() => { const n = document.querySelector('.nav-links'); return getComputedStyle(n).visibility === 'hidden' || n.getBoundingClientRect().top >= innerHeight; });
      if (!hid) throw new Error('tab bar still shown while typing');
      await input.blur(); await page.waitForTimeout(350);
      const back = await page.evaluate(() => document.querySelector('.nav-links').getBoundingClientRect().top < innerHeight);
      if (!back) throw new Error('tab bar did not return');
    }
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
  await step('phase 111: day chip shows protein against the dinner share with no "Short on"; meter target is 7 x the share; iron-short log steers early dinners', async () => {
    const chip = await page.locator('#plan-root .coverage-list').first().innerText();
    const m = chip.match(/Protein ~(\d+)g \/ (\d+)g/i);
    if (!m || m[2] !== '60') throw new Error('chip: ' + chip);
    if (/Short on/i.test(await page.locator('#plan-root').innerText().then(t => t.split('Short across')[0]))) throw new Error('Short on still shown');
    const wk = await page.evaluate(() => { const l = document.querySelector('.m-prot'), b = document.querySelector('.meter-bar'); return { prot: parseInt(l.textContent.replace(/\D*(\d+).*/, '$1')), w: parseFloat(b.style.width) }; });
    if (wk.prot && Math.abs(wk.w - Math.min(100, wk.prot / 420 * 100)) > 1.5) throw new Error('meter width ' + JSON.stringify(wk));
    const score = async seeded => page.evaluate(async seeded => {
      localStorage.removeItem('mp_eatenLog');
      if (seeded) {
        const lib = JSON.parse(localStorage.getItem('mp_library') || '[]');
        const tags = (await (await fetch('ingredient-nutrient-tags.json')).json());
        const t = tags.tags || tags, dayOf = i => new Date(Date.now() - i * 86400000).toISOString();
        const dud = lib.find(x => !(x.ingredients || []).some(g => t[g.key] && t[g.key].iron));
        localStorage.setItem('mp_eatenLog', JSON.stringify([1, 2, 3, 4].map(i => ({ id: 'w' + i, mealId: dud.id, eatenAt: dayOf(i) }))));
      }
      document.querySelector('#generate-btn').click();
      await new Promise(r => setTimeout(r, 2500));
      const t = ((await (await fetch('ingredient-nutrient-tags.json')).json()).tags) || (await (await fetch('ingredient-nutrient-tags.json')).json());
      const plan = JSON.parse(localStorage.getItem('mp_plan'));
      return plan.days.slice(0, 3).reduce((n, d) => { const m = JSON.parse(localStorage.getItem('mp_library')).find(x => x.id === (d.slots.dinner || {}).mealId); return n + ((m && m.ingredients) || []).filter(g => t[g.key] && t[g.key].iron).length; }, 0);
    }, seeded);
    const base0 = await score(false), seeded = await score(true);
    await page.evaluate(() => localStorage.removeItem('mp_eatenLog'));
    if (seeded < base0) throw new Error(`iron-tagged ingredients early: seeded ${seeded} < unseeded ${base0}`);
  });
  await step('plan: Compare 3 weeks shows three cards; close keeps the plan, Use replaces it', async () => {
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card');
    const before = await page.evaluate(() => localStorage.getItem('mp_plan'));
    await page.click('#compare-btn');
    await page.waitForSelector('.compare-card');
    if (await page.locator('.compare-card').count() !== 3) throw new Error('expected 3 candidate cards');
    const txt = await page.textContent('.compare-grid');
    if (!/Cost/.test(txt) || !/Protein/.test(txt) || !/of 14/.test(txt)) throw new Error('missing a metric');
    await shot('compare');
    await page.click('#swap-sheet .close-btn');
    if (await page.evaluate(() => localStorage.getItem('mp_plan')) !== before) throw new Error('close changed mp_plan');
    await page.click('#compare-btn');
    page.once('dialog', (d) => d.accept());
    await page.click('.use-candidate >> nth=2');
    await page.waitForSelector('#plan-root .slot-card');
    if (await page.evaluate(() => localStorage.getItem('mp_plan')) === before) throw new Error('Use did not replace the plan');
  });
  await step('shopping: list is built from the plan', async () => {
    await page.goto(`${base}/shopping.html`);
    await page.waitForSelector('#shopping-root .shop-line', { timeout: 10000 });
    await shot('shopping');
  });
  await step('pantry freezer group (Phase 119): first, weeks chips, undated has none', async () => {
    await page.goto(`${base}/shopping.html`);
    await page.evaluate(() => { const d = n => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA');
      MP.Sync.writeLocalItems('pantry', [{ name: 'Rice', qty: '1kg' }, { name: 'Old peas', storage: 'freezer', frozenOn: d(63) }, { name: 'New fish', storage: 'freezer', frozenOn: d(0) }, { name: 'Mystery mince', storage: 'freezer' }]); });
    await page.goto(`${base}/shopping.html#pantry`);
    await page.waitForSelector('.pan-group');
    if ((await page.locator('.pan-group').first().textContent()) !== 'In the freezer') throw new Error('freezer group not first');
    const row = n => page.locator('#pantry-root .prod-row', { hasText: n });
    if (!/9 wk · use soon/.test(await row('Old peas').innerText())) throw new Error('9 wk chip missing');
    if (!/just frozen/.test(await row('New fish').innerText())) throw new Error('just frozen chip missing');
    if (await row('Mystery mince').locator('.frz-chip').count()) throw new Error('undated freezer item shows a chip');
    await page.evaluate(() => MP.Sync.writeLocalItems('pantry', []));
  });
  await step('shopping accordion (Phase 116): cards, ticks, done collapse, dock budget, add/remove, Finish shop, #adhoc', async () => {
    const msgs = [];
    page.on('console', m => { if (m.type() === 'error') msgs.push(m.text()); });
    const setBudget = b => page.evaluate(v => localStorage.setItem('mp_planPrefs', JSON.stringify({ updatedAt: new Date().toISOString(), budgetTarget: v })), b);
    const load = async () => { await page.goto(`${base}/shopping.html`); await page.waitForSelector('.aisle-card .shop-line', { state: 'attached', timeout: 10000 }); };
    const ticked = async () => parseInt((await page.innerText('.dock-ticked')).split(' ')[0], 10);
    const trolley = async () => parseFloat(await page.innerText('.dock-tv'));
    await page.goto(`${base}/shopping.html`); await setBudget(60); await load();
    { const g = await page.evaluate(() => { const d = document.querySelector('#shop-dock').getBoundingClientRect(), b = document.querySelector('.ate-bar'); return { db: d.bottom, bt: b ? b.getBoundingClientRect().top : 1e9 }; });
      if (g.db > g.bt + 1) throw new Error(`dock bottom ${g.db} overlaps ate bar top ${g.bt}`); }
    // (a)
    const cards = page.locator('#shopping-root .aisle-card');
    if (await cards.count() < 2) throw new Error('expected several aisle cards');
    for (const c of await cards.all()) {
      if (!/^\d+\/\d+$/.test((await c.locator('.ah-count').innerText()).trim())) throw new Error('header lacks g/n');
      if (!await c.locator('.ah-bar').count()) throw new Error('header lacks progress bar');
    }
    const first = page.locator('#shopping-root .shop-block').first().locator('.aisle-card').first();
    if (await first.locator('.ah-btn').getAttribute('aria-expanded') !== 'true') throw new Error('first aisle not expanded');
    if (await page.locator('.just-ticked, .aisle-card.just').count()) throw new Error('animation class on first paint');
    // (b)
    const pending = '.shop-line:not(.covered):not(.skipped):not(.ticked)';
    const key = await first.getAttribute('data-aisle');
    const card = () => page.locator(`.aisle-card[data-aisle="${key}"]`);
    const g0 = parseInt((await card().locator('.ah-count').innerText()).split('/')[0], 10), t0 = await ticked(), v0 = await trolley();
    await card().locator(pending).filter({ has: page.locator('.shop-price:not(:empty)') }).first().locator('input').click();
    if (parseInt((await card().locator('.ah-count').innerText()).split('/')[0], 10) !== g0 + 1) throw new Error('aisle g did not rise');
    if (await ticked() !== t0 + 1) throw new Error('dock ticked did not rise');
    if (!(await trolley() > v0)) throw new Error('In trolley did not rise');
    if (await page.locator('.shop-line.just-ticked').count() !== 1) throw new Error('tick animation class missing');
    // (c)
    while (await card().locator(pending).count()) {
      await card().locator(pending).first().locator('input').click();
    }
    if (!await card().evaluate(e => e.classList.contains('done'))) throw new Error('card not .done');
    if (!await page.locator('.aisle-card.just').count()) throw new Error('done bump class missing');
    await page.waitForFunction(k => [...document.querySelectorAll('.aisle-card')].find(c => c.dataset.aisle === k).querySelector('.ah-btn').getAttribute('aria-expanded') === 'false', key, { timeout: 4000 });
    await card().locator('.ah-btn').click();
    if (await card().locator('.ah-btn').getAttribute('aria-expanded') !== 'true') throw new Error('expand failed');
    await card().locator('.ah-btn').click();
    if (await card().locator('.ah-btn').getAttribute('aria-expanded') !== 'false') throw new Error('collapse failed');
    await shot('shopping-accordion');
    // (d)
    if (!await page.locator('.dock-budget').count() || !await page.locator('.dock-bar').count()) throw new Error('budget 60: dock budget text/bar missing');
    await setBudget(0); await load();
    if (await page.locator('.dock-budget, .dock-bar').count()) throw new Error('budget 0: dock budget should be absent');
    if (await page.locator('.just-ticked, .aisle-card.just').count()) throw new Error('animation class after plain reload');
    await setBudget(60); await load();
    // (e)
    await page.fill('#adhoc-name', 'bin bags'); await page.click('#adhoc-add-btn');
    const row = page.locator('.aisle-card .shop-line', { hasText: 'bin bags' });
    if (!await row.locator('.added-tag').count()) throw new Error('added row/tag missing');
    await row.locator('[data-del]').click();
    if (await row.count()) throw new Error('× did not remove the added row');
    // (f)
    await page.fill('#adhoc-name', 'bin bags'); await page.click('#adhoc-add-btn');
    if (!await page.locator('#finish-shop').isDisabled()) throw new Error('Finish shop should start disabled');
    await page.locator('#shopping-root .shop-block:first-child .shop-line:not(.covered):not(.ticked) [data-skip]').first().click();
    for (let i = 0; i < 200; i++) {
      const more = await page.evaluate(() => {
        const el = document.querySelector('#shopping-root .shop-block:first-child .aisle-card .shop-line:not(.covered):not(.skipped):not(.ticked) input[type=checkbox]');
        if (el) el.click();
        return !!el;
      });
      if (!more) break;
    }
    if (await page.locator('#finish-shop').isDisabled()) throw new Error('Finish shop should enable when all ticked');
    const pantry = () => page.evaluate(() => JSON.stringify(MP.Sync.localItems('pantry')));
    const same = () => page.evaluate(() => ['mp_cooks', 'mp_eatenLog', 'mp_plan'].map(k => localStorage.getItem(k)).join('|'));
    const rows = page.locator('#shop-review .rv-row');
    // Phase 119 review sheet: (a) rows = ticked lines, skipped one in the Left out note
    const nTicked = await page.locator('#shopping-root .shop-block:first-child .shop-line.ticked:not(.covered):has(.shop-qty)').count(); // essentials have no qty and no row
    const skippedName = await page.evaluate(() => (document.querySelector('#shopping-root .shop-block:first-child .shop-line.skipped .shop-name') || {}).textContent);
    await page.click('#finish-shop');
    await page.waitForSelector('#shop-review .rv-row'); await page.waitForTimeout(500); await shot('shop-review');
    if (await rows.count() !== nTicked) throw new Error(`review rows ${await rows.count()} != ticked ${nTicked}`);
    if (skippedName && !(await page.innerText('.rv-left')).includes(skippedName.trim())) throw new Error('skipped line missing from Left out note');
    // (c) photo stub is disabled
    if (!await page.locator('#rv-photo').isDisabled() || !/Not built yet/.test(await page.innerText('.rv-photo-note'))) throw new Error('photo stub wrong');
    // (h) Escape closes, focus returns, no horizontal scroll
    if (vp === 'phone' && await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('review sheet scrolls horizontally');
    const r0 = await rows.first().evaluate(li => ({ name: li.querySelector('.rv-top b').textContent, unit: (li.querySelector('[data-amt]').parentElement.textContent.trim().replace(/^Amount\s*/, '')) || 'each' }));
    await page.keyboard.press('Escape');
    if (await page.locator('#modal-overlay:not(.hidden)').count()) throw new Error('Escape did not close the review');
    if (await page.evaluate(() => document.activeElement && document.activeElement.id) !== 'finish-shop') throw new Error('focus did not return to Finish shop');
    // seed an existing matching-unit item for row 0, then reopen
    await page.evaluate(([n, u]) => MP.Sync.writeLocalItems('pantry', [{ name: n, qty: u === 'each' ? '1' : '100' + u }]), [r0.name, r0.unit]);
    const p0 = await pantry(), same0 = await same();
    await page.click('#finish-shop');
    await page.waitForSelector('#shop-review .rv-row');
    if (await rows.first().locator('.rv-note').count()) throw new Error('matching unit should sum, not "replaces"');
    // (b) stepper sums to the amount; Rest after plan = amount - need
    const split = rows.filter({ has: page.locator('.rv-split') }).last();
    const splitName = await split.locator('.rv-top b').textContent();
    await split.locator('[data-amt]').fill('500'); await split.locator('[data-amt]').dispatchEvent('change');
    const sp = rows.filter({ hasText: splitName });
    await sp.locator('[data-mv="1"]').click();
    const vals = async () => sp.evaluate(li => ({ u: parseFloat(li.querySelector('.rv-use').textContent), f: parseFloat(li.querySelector('.rv-fz').textContent) }));
    { const v = await vals(); if (Math.abs(v.u + v.f - 500) > 0.5 || !(v.f > 0)) throw new Error('stepper split does not sum: ' + JSON.stringify(v)); }
    await sp.locator('[data-mv="-1"]').click(); await sp.locator('[data-mv="1"]').click();
    { const v = await vals(); if (Math.abs(v.u + v.f - 500) > 0.5) throw new Error('stepper sum drifted'); }
    const need = parseFloat((await sp.locator('.rv-top .muted').textContent()).replace(/[^\d.]/g, ''));
    await sp.locator('[data-rest]').click();
    { const v = await vals(); if (Math.abs(v.f - Math.max(0, 500 - need)) > 0.5) throw new Error(`Rest after plan: freezer ${v.f}, expected ${Math.max(0, 500 - need)}`); }
    { const v = await vals(); await sp.locator(v.f >= 500 ? '[data-mv="-1"]' : '[data-mv="1"]').click(); } // keep both halves real for (d)
    const fzWant = (await vals()).f;
    // (d) Confirm: one write, plain + (frozen) items
    await page.click('#rv-confirm');
    await page.waitForSelector('.toast:has-text("in the freezer")');
    const items = await page.evaluate(() => MP.Sync.localItems('pantry'));
    const keys = items.map(i => i.name.toLowerCase());
    if (new Set(keys).size !== keys.length) throw new Error('duplicate pantry names');
    const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
    const fz = items.find(i => i.name === `${splitName} (frozen)`);
    if (!fz || fz.storage !== 'freezer' || fz.frozenOn !== today) throw new Error('frozen half wrong: ' + JSON.stringify(fz));
    if (!items.find(i => i.name === splitName)) throw new Error('plain half missing');
    if (fzWant > 0 && !(fz.qty.value > 0)) throw new Error('frozen qty missing');
    // (e) the seeded row summed
    const seeded = items.find(i => i.name.toLowerCase() === r0.name.toLowerCase());
    if (!seeded || !(seeded.qty.value > (r0.unit === 'each' ? 1 : 100))) throw new Error('existing item not summed: ' + JSON.stringify(seeded));
    // (i) nothing but pantry + ad-hoc changed
    if (await same() !== same0) throw new Error('Confirm touched cooks / eaten log / plan');
    if (await page.locator('.aisle-card .shop-line', { hasText: 'bin bags' }).count()) throw new Error('ticked ad-hoc line not deleted');
    // (f) Undo restores exactly
    await page.click('.toast button:text("Undo")');
    if (!await page.locator('.aisle-card .shop-line.ticked', { hasText: 'bin bags' }).count()) throw new Error('Undo did not restore the ad-hoc line as got');
    if (await pantry() !== p0) throw new Error('Undo did not restore the pantry: ' + await pantry() + ' vs ' + p0);
    await page.evaluate(() => MP.Sync.writeLocalItems('pantry', []));
    await page.locator('.aisle-card .shop-line', { hasText: 'bin bags' }).locator('[data-del]').dispatchEvent('click'); // its card is collapsed (all ticked), so a real click can't reach ×
    // (g)
    await page.goto(`${base}/shopping.html#adhoc`);
    await page.waitForSelector('#panel-planned:not(.hidden)');
    if (await page.locator('#tab-adhoc').count()) throw new Error('#tab-adhoc should be gone');
    // (h)
    if (vp === 'phone') {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const r = await page.evaluate(() => {
        const dock = document.getElementById('shop-dock').getBoundingClientRect(), tab = document.querySelector('.nav-links').getBoundingClientRect();
        return { sw: document.documentElement.scrollWidth, iw: innerWidth, dockBottom: dock.bottom, tabTop: tab.top, dockTop: dock.top, formBottom: document.getElementById('adhoc-form').getBoundingClientRect().bottom };
      });
      if (r.sw > r.iw) throw new Error(`horizontal scroll ${r.sw} > ${r.iw}`);
      if (r.dockBottom > r.tabTop + 1) throw new Error('dock overlaps the tab bar');
      if (r.formBottom > r.dockTop + 1) throw new Error('dock covers the end of the list');
    }
    if (msgs.length) throw new Error('console errors: ' + msgs[0]);
  });
  await step('eaten: seeded food log shows a measured row, Week toggle works', async () => {
    await page.goto(`${base}/eaten.html`);
    await page.evaluate(() => localStorage.setItem('mp_foodLog', JSON.stringify({ entries: [{ id: 'w1', kind: 'eat', name: 'Walk bar', when: new Date().toISOString(), nutrients: { protein_g: { value: 12, basis: 'label' }, sodium_mg: { value: 9999, basis: 'label' } } }] })));
    await page.goto(`${base}/eaten.html`);
    await page.waitForSelector('.eaten-row[data-key="protein_g"] .eaten-chip.measured', { timeout: 10000 });
    if (!(await page.locator('.eaten-row[data-key="sodium_mg"]').getAttribute('class')).includes('over')) throw new Error('sodium cap not flagged over');
    if (!/unknown/.test(await page.locator('.eaten-row[data-key="zinc_mg"] .eaten-val').textContent())) throw new Error('zinc should be unknown');
    await page.click('[data-mode="week"]');
    await page.waitForSelector('.eaten-row[data-key="protein_g"] .eaten-chip.measured');
    await shot('eaten');
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
  await step('plan: Today card lists a seeded leftover and Freeze 1 moves a portion to the freezer', async () => {
    await page.goto(`${base}/plan.html`);
    await page.evaluate(async () => {
      const lib = await fetch('meals.json').then(r => r.json());
      const m = (Array.isArray(lib) ? lib : lib.meals)[0];
      localStorage.setItem('mp_cooks', JSON.stringify([{ id: `${m.id}:seed`, mealId: m.id, name: m.name, variantId: null, cookedAt: new Date().toISOString(), portionsLeft: 2 }]));
    });
    await page.reload();
    await page.waitForSelector('.leftover-row [data-left-freeze]');
    await page.click('[data-left-freeze]');
    await page.waitForFunction(() => document.querySelectorAll('.leftover-row').length === 2 && /freezer/.test(document.body.innerText));
    await shot('leftovers');
  });
  await step('what-if: hovering the top deck card shows a preview and leaves mp_plan byte-identical', async () => {
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card');
    await page.click('#plan-root .slot-card .tc-h'); await page.click('#plan-root .slot-card .tc-b [data-tn="details"]');
    await page.click('.day-swap-btn[data-slot="dinner"]');
    await page.waitForSelector('#swap-deck .swipe-card');
    const before = await page.evaluate(() => localStorage.getItem('mp_plan'));
    await page.hover('#swap-deck .swipe-card');
    await page.waitForSelector('#swap-deck .whatif');
    if (!/Protein/.test(await page.textContent('.whatif'))) throw new Error('preview has no protein line');
    if (before !== await page.evaluate(() => localStorage.getItem('mp_plan'))) throw new Error('preview changed mp_plan');
    await page.click('#swap-sheet .close-btn');
  });
  await step('plan: drag a card onto another swaps, a day grip swaps days, Alt+Arrow swaps, a tap still opens the day (Phase 103)', async () => {
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card');
    const names = () => page.evaluate(() => [...document.querySelectorAll('#plan-root .slot-card[data-slot="dinner"][data-day="1"] .slot-meal, #plan-root .slot-card[data-slot="dinner"][data-day="2"] .slot-meal')].map((e) => e.textContent));
    const drag = async (from, to) => {
      await page.locator(from).first().scrollIntoViewIfNeeded();
      await page.evaluate(([f]) => { const a = document.querySelector(f).getBoundingClientRect(); scrollBy(0, a.top - 0.3 * innerHeight); }, [from]); // sticky meter and docked bars (tab bar, ate-bar) can cover a row at the viewport edge
      const a = await page.locator(from).first().boundingBox(), b = await page.locator(to).first().boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
      await page.mouse.up();
    };
    const n0 = await names();
    await drag('#plan-root .slot-card[data-day="1"][data-slot="dinner"]', '#plan-root .slot-card[data-day="2"][data-slot="dinner"]');
    const n1 = await names();
    if (n0[0] !== n1[1] || n0[1] !== n1[0] || n0[0] === n0[1]) {
      const t = await page.textContent('.toast');
      if (!/Can.t do that/.test(t)) throw new Error('drag neither swapped nor refused: ' + n0 + ' -> ' + n1 + ' ' + t);
    }
    if (await page.locator('#day-view:visible, .day-sheet:visible').count()) throw new Error('a drop opened the day view');
    await page.evaluate(() => { document.querySelector('#plan-root .slot-card[data-day="3"][data-slot="dinner"] .tc-h').focus(); });
    const n2 = await page.evaluate(() => document.querySelector('#plan-root .slot-card[data-day="4"][data-slot="dinner"] .slot-meal').textContent);
    await page.keyboard.press('Alt+ArrowDown');
    const f = await page.evaluate(() => (c => c.dataset.day + c.dataset.slot)(document.activeElement.closest('.slot-card')));
    if (f !== '4dinner') throw new Error('focus not kept on the moved slot: ' + f);
    await page.evaluate(() => document.querySelector('#plan-root .slot-card[data-day="1"][data-slot="dinner"]'));
    const d1 = await page.textContent('#plan-root .day-row[data-day="1"] .slot-card[data-slot="dinner"] .slot-meal');
    const d2 = await page.textContent('#plan-root .day-row[data-day="2"] .slot-card[data-slot="dinner"] .slot-meal');
    await drag('#plan-root .day-row[data-day="1"] .day-grip', '#plan-root .day-row[data-day="2"] h3');
    const e1 = await page.textContent('#plan-root .day-row[data-day="1"] .slot-card[data-slot="dinner"] .slot-meal');
    if (d1 !== d2 && e1 === d1) { const t = await page.textContent('.toast'); if (!/Can.t do that|Swapped days/.test(t)) throw new Error('day drag neither swapped nor refused: ' + t); }
    await page.click('#plan-root .slot-card[data-day="5"] .tc-h'); await page.click('#plan-root .slot-card[data-day="5"] [data-tn="details"]');
    await page.waitForSelector('.day-swap-btn');
    await shot('plan-drag');
  });
  await step('swap deck: Pass x3 walks the ranked order, counter drops, Take changes the plan, arrow keys work', async () => {
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card');
    await page.click('#plan-root .slot-card .tc-h'); await page.click('#plan-root .slot-card .tc-b [data-tn="details"]');
    await page.click('.day-swap-btn[data-slot="dinner"]');
    await page.waitForSelector('#swap-deck .swipe-card');
    const names = () => page.locator('#swap-deck .swipe-card h3').allTextContents();
    const left = async () => parseInt(await page.textContent('.deck-left'), 10);
    const first = await names(); const n0 = await left();
    for (let i = 0; i < 3; i++) { await page.click('.deck-pass'); await page.waitForTimeout(400); }
    const after = await names();
    if (await left() !== n0 - 3) throw new Error('counter did not drop by 3');
    if (n0 >= 6 && first[0] === after[0]) throw new Error('top card unchanged after 3 passes');
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(400);
    if (await left() !== n0 - 4) throw new Error('ArrowLeft did not pass');
    const top = (await names())[0];
    const before = await page.evaluate(() => localStorage.getItem('mp_plan'));
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('#swap-overlay.hidden', { state: 'attached' });
    const saved = await page.evaluate(() => localStorage.getItem('mp_plan'));
    if (saved === before) throw new Error('Take did not change mp_plan');
  });
  await step('phase 112: Tonight hero + dinner board (hero actions, chain labels, expand, cook gate, eaten, guided hides hero)', async () => {
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card');
    const setPlan = async (mut) => {
      await page.evaluate((m) => { const p = JSON.parse(localStorage.getItem('mp_plan')); p.startDate = MP.Generator.isoToday(); new Function('p', m)(p); localStorage.setItem('mp_plan', JSON.stringify(p)); }, mut);
      await page.reload(); await page.waitForSelector('#plan-root .slot-card');
    };
    await setPlan(`p.days[0].slots.dinner = { mealId: 'roast-chicken' }; p.days[1].slots.dinner = { mealId: 'chicken-fajitas' };`);
    const hero = await page.textContent('#tonight');
    if (await page.locator('#tonight[hidden]').count()) throw new Error('hero hidden');
    if (!/Tonight/.test(hero) || !/Cook now/.test(hero) || !/Roast chicken/i.test(hero)) throw new Error('hero lacks tonight/cook now/name: ' + hero.slice(0, 160));
    if (!await page.locator('#plan-root .day-row[data-day="1"] .lk, #plan-root .day-row[data-day="1"].lk').count()) throw new Error('no .lk link on cook night');
    if (!/Leftover of/.test(await page.textContent('#plan-root .day-row[data-day="2"]'))) throw new Error('no "Leftover of" label');
    const hd = '#plan-root .slot-card[data-day="3"] .tc-h';
    await page.click(hd);
    if (await page.getAttribute(hd, 'aria-expanded') !== 'true') throw new Error('header click did not expand');
    if (!await page.locator('#plan-root .slot-card[data-day="3"] [data-tn="cook"][disabled]').count()) throw new Error('Cook now on a non-tonight card not disabled');
    await page.click(hd);
    if (await page.getAttribute(hd, 'aria-expanded') !== 'false') throw new Error('second click did not collapse');
    await page.click(hd); await page.click('#plan-root .slot-card[data-day="3"] [data-tn="details"]');
    await page.waitForSelector('.day-swap-btn');
    await page.evaluate(() => document.querySelectorAll('.modal-overlay').forEach((o) => o.classList.add('hidden')));
    await page.click('#tonight [data-tn="skip"]'); await page.waitForSelector('#eat-overlay:not(.hidden) .skip-why'); await page.click('#eat-sheet .close-btn');
    await page.click('#tonight [data-tn="out"]'); await page.waitForSelector('#eat-overlay:not(.hidden) .out-name'); await page.click('#eat-sheet .close-btn');
    await page.click('#tonight [data-tn="done"]'); await page.waitForSelector('#eat-overlay:not(.hidden) [data-act="ate"]'); await page.click('#eat-sheet .close-btn');
    await page.click('#tonight [data-tn="swap"]'); await page.waitForSelector('#swap-overlay:not(.hidden) #swap-deck'); await page.click('#swap-sheet .close-btn');
    await shot('plan-board');
    await setPlan(`p.days[0].slots.dinner = { mealId: 'chicken-fajitas' };`);
    if (!/No cook/.test(await page.textContent('#plan-root .day-row[data-day="1"]'))) throw new Error('orphan leftover lacks "No cook"');
    await setPlan(`p.days[0].slots.dinner = { mealId: 'roast-chicken', eatenAt: new Date().toISOString() };`);
    if (!/Eaten/.test(await page.textContent('#plan-root .day-row[data-day="1"]'))) throw new Error('eaten night lacks "Eaten"');
    if (/Cook now/.test(await page.textContent('#tonight'))) throw new Error('hero Cook now on an eaten night');
    await setPlan(`delete p.startDate; p.days.forEach(d => { if (d.slots.dinner) d.slots.dinner.eatenAt = new Date().toISOString(); });`);
    if (!await page.locator('#tonight[hidden]').count()) throw new Error('hero shown with every night eaten');
    await page.evaluate(() => localStorage.removeItem('mp_plan'));
    await page.goto(`${base}/plan.html?guided=1`);
    await page.waitForSelector('#swap-sheet h2');
    if (!await page.locator('#tonight[hidden]').count()) throw new Error('hero visible in guided mode');
    await page.click('#swap-sheet .close-btn');
    await page.evaluate(() => localStorage.removeItem('mp_plan'));
  });
  await step('guided: one Dinner pass only (slots= ignored); closing leaves mp_plan untouched', async () => {
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card'); // init saves mp_plan after its awaits; clearing earlier races it
    await page.evaluate(() => localStorage.removeItem('mp_plan'));
    await page.goto(`${base}/plan.html?guided=1&slots=lunch,junk&first=lunch`);
    await page.waitForSelector('#swap-sheet h2');
    let h = await page.textContent('#swap-sheet h2');
    if (!/Dinner/.test(h)) throw new Error('first pass should be Dinner: ' + h);
    await page.click('#swap-sheet .close-btn');
    await page.waitForSelector('#guided-review-banner:not(.hidden)');
    if (await page.evaluate(() => localStorage.getItem('mp_plan'))) throw new Error('mp_plan saved before Looks good');
  });
  await step('phase 118a: wizard walks 6 steps, Back, busy weekday toggle saves [2,9], lands on guided=1 days=14, Review shows notes + More options', async () => {
    await page.goto(`${base}/plan-with-me.html`);
    await page.waitForSelector('#wiz-next');
    if (!await page.locator('#wiz-prev').isHidden()) throw new Error('Back visible on step 1');
    const next = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d.toLocaleDateString('sv'); });
    await page.fill('#start-date', next); await page.dispatchEvent('#start-date', 'change');
    const w0 = await page.evaluate(() => document.getElementById('wiz-prog').style.width);
    await page.click('#wiz-next');
    const w1 = await page.evaluate(() => document.getElementById('wiz-prog').style.width);
    if (parseFloat(w1) <= parseFloat(w0)) throw new Error('progress did not fill: ' + w0 + ' -> ' + w1);
    await page.click('#wiz-prev');
    if (await page.locator('.wiz-step[data-step="0"]').isHidden()) throw new Error('Back did not return to step 1');
    await page.click('#wiz-next'); await page.click('#wiz-next');
    await page.evaluate(() => document.querySelectorAll('#busy-grid .is-busy').forEach((b) => b.click()));
    await page.click('#busy-grid [data-weekday="2"]');
    for (let i = 0; i < 3; i++) await page.click('#wiz-next');
    if (!await page.locator('#pwm-generate-btn').isVisible()) throw new Error('no Start planning on Review');
    if (!await page.locator('#wiz-next').isHidden()) throw new Error('Next visible on Review');
    await page.click('.customise summary');
    if (!await page.locator('.customise #shop-day').isVisible()) throw new Error('More options lacks #shop-day');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('horizontal scroll');
    await shot('wizard-review');
    await page.click('#pwm-generate-btn');
    await page.waitForURL(/plan\.html\?guided=1.*days=14/, { timeout: 8000 });
    const bd = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_planPrefs')).busyDays);
    if (JSON.stringify(bd) !== '[2,9]') throw new Error('busyDays ' + JSON.stringify(bd));
  });
  await step('phase 110: old-shape plan loads dinners only; one card per day; no first-slot / also-row / library-filters; Not planned label', async () => {
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card');
    const ids = await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('mp_plan')); return p.days.map((d) => d.slots.dinner && d.slots.dinner.mealId); });
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem('mp_plan'));
      p.firstSlot = 'lunch';
      p.days.forEach((d) => { d.slots.breakfast = { ...d.slots.dinner }; d.slots.lunch = { ...d.slots.dinner }; });
      localStorage.setItem('mp_plan', JSON.stringify(p));
    });
    await page.reload();
    await page.waitForSelector('#plan-root .slot-card');
    const bad = await page.locator('#plan-root .slot-card:not([data-slot="dinner"])').count();
    if (bad) throw new Error('non-dinner cards rendered: ' + bad);
    const perDay = await page.evaluate(() => [...document.querySelectorAll('#plan-root .day-row')].every((r) => r.querySelectorAll('.slot-card').length === 1));
    if (!perDay) throw new Error('a day has != 1 slot card');
    const ids2 = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_plan')).days.map((d) => d.slots.dinner && d.slots.dinner.mealId));
    if (JSON.stringify(ids) !== JSON.stringify(ids2)) throw new Error('dinner ids changed');
    await page.goto(`${base}/plan-with-me.html`);
    await page.waitForSelector('#pwm-generate-btn', { state: 'attached' });
    if (await page.locator('#also-row, #first-slot').count()) throw new Error('also-row / first-slot still present');
    await page.goto(`${base}/index.html`);
    await page.waitForSelector('#library-grid .meal-card');
    if (await page.locator('#library-filters').count()) throw new Error('library-filters still present');
    await page.evaluate(() => {
      const lib = JSON.parse(localStorage.getItem('mp_library') || 'null');
      if (lib) { lib[0].mealTypes = []; localStorage.setItem('mp_library', JSON.stringify(lib)); }
    });
    await page.reload();
    await page.waitForSelector('#library-grid .meal-card');
    if (!await page.locator('#library-grid .tag.not-planned').count()) throw new Error('no Not planned label');
  });
  // Phase 72: planning chat, /chat mocked by page.route (no Worker, no credential)
  const chatMock = { msgs: [], seq: 0, session: null, reply: null, bridgeAgeMs: 0 };
  await page.route('https://fake.test/**', route => {
    const req = route.request(), u = new URL(req.url()), m = chatMock;
    const ok = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/notes') return ok({ updatedAt: 'x', items: ['No fish'], pending: chatMock.notePending || [] });
    if (u.pathname === '/notes/pending') { // Phase 91: first Accept fails, the retry saves
      if (!chatMock.noteFailed) { chatMock.noteFailed = true; return route.fulfill({ status: 500, body: '{}' }); }
      chatMock.notePending = [{ id: 'n1', text: req.postDataJSON().text, at: 'x' }];
      return ok({ updatedAt: 'x', items: ['No fish'], pending: chatMock.notePending });
    }
    if (u.pathname !== '/chat') return route.fulfill({ status: 404, body: '{}' });
    if (req.method() === 'GET') return ok({ session: m.session, openAt: 'x', bridgeSeenAt: null, messages: m.msgs.filter(x => x.id > Number(u.searchParams.get('since') || 0)) });
    const b = req.postDataJSON();
    if (b.open) {
      m.session = b.session; m.msgs = []; const id = ++m.seq;
      m.msgs.push({ id, from: 'user', open: true, text: '' }, { id: ++m.seq, from: 'hermes', replyTo: id, text: 'What does the week look like?', edits: [], ask: false });
      return ok({ session: b.session, bridgeSeenAt: new Date(Date.now() - m.bridgeAgeMs).toISOString() });
    }
    if (b.close) return ok({});
    const id = ++m.seq; m.msgs.push({ id, from: 'user', text: b.text });
    m.msgs.push(Object.assign({ id: ++m.seq, from: 'hermes', replyTo: id, ask: false, edits: [] }, m.reply));
    return ok({ id });
  });
  const planLS = () => page.evaluate(() => localStorage.getItem('mp_plan'));
  const openChat = async () => {
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card');
    await page.evaluate(() => { localStorage.setItem('mp_hermes_url', 'https://fake.test'); localStorage.setItem('mp_hermes_token', 't'); });
    await page.reload();
    await page.waitForSelector('#plan-root .slot-card');
    await page.click('#plan-chat-btn');
    await page.waitForSelector('#plan-chat:not([hidden]) .chat-bubble.hermes', { timeout: 8000 });
  };
  const say = async text => { await page.waitForSelector('#chat-input:not([disabled])', { timeout: 8000 }); await page.fill('#chat-input', text); await page.click('#chat-send'); };
  await step('chat: noCook Sunday changes only day 7, diff rows, Reject restores, Exit leaves mp_plan identical', async () => {
    chatMock.bridgeAgeMs = 0; chatMock.reply = { text: 'Done, Sunday is easy.', edits: [{ type: 'noCook', day: 7 }, { type: 'bogus', day: 2 }] };
    await openChat();
    const before = await planLS();
    await say('no cooking Sunday');
    await page.waitForSelector('.chat-understood', { timeout: 8000 });
    if (!/quick meals/.test(await page.textContent('.chat-understood'))) throw new Error('understood line: ' + await page.textContent('.chat-understood'));
    await page.waitForSelector('#chat-input:not([disabled])');
    const rows = await page.locator('#chat-diff .diff-row span').allTextContents();
    // day 7 plus its batch chain (a re-pick widens to the chain, like rerollDay); which days that is depends on today's generated plan
    const chain = await page.evaluate(async b => { const lib = await MP.getLibrary(); return MP.chainDays(JSON.parse(b).days, Object.fromEntries(lib.map(m => [m.id, m])), 7); }, before);
    if (rows.some(r => !chain.some(d => r.startsWith(`Day ${d} `)))) throw new Error('diff touches a day outside the day-7 chain ' + chain + ': ' + rows.join(' | '));
    await shot('chat'); await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); await shot('chat-light');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('horizontal scroll');
    if (rows.length) {
      await page.click('#chat-diff .diff-row button:text("Reject")');
      if (!await page.locator('#chat-diff .diff-row.rejected').count()) throw new Error('Reject did not mark the row');
      // Phase 74: Skip writes no rating; a reason chip writes a down rating with the note
      const rated = () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('mp_ratings') || '{}')).filter(r => r.rating === 'down' && r.note === 'too fiddly').length);
      await page.click('#chat-diff .chat-reason button:text("Skip")');
      if (await rated()) throw new Error('Skip wrote a rating');
      await page.click('#chat-diff .diff-row button:text("Accept")');
      await page.click('#chat-diff .diff-row button:text("Reject")');
      await page.click('#chat-diff .chat-reason button:text("too fiddly")');
      if (await rated() !== 1) throw new Error('reason did not write mp_ratings');
    }
    await page.click('#chat-exit');
    await page.waitForSelector('#plan-chat', { state: 'hidden' });
    if (await planLS() !== before) throw new Error('Exit changed mp_plan');
  });
  await step('chat: Save commits the working copy', async () => {
    await openChat();
    const before = await planLS();
    await say('no cooking Sunday');
    await page.waitForSelector('.chat-understood', { timeout: 8000 });
    const n = await page.locator('#chat-diff .diff-row').count();
    await page.click('#chat-save');
    await page.click('#wrap-save');
    await page.waitForSelector('#plan-chat', { state: 'hidden' });
    if (n && await planLS() === before) throw new Error('Save did not change mp_plan');
  });
  await step('chat: ask:true shows the question and the edits still apply (Phase 88)', async () => {
    chatMock.reply = { text: 'Which day do you mean?', ask: true, edits: [{ type: 'noCook', day: 7 }] };
    await openChat();
    await say('make it quick');
    await page.waitForFunction(() => [...document.querySelectorAll('.chat-bubble.hermes')].some(b => /Which day/.test(b.textContent)), null, { timeout: 8000 });
    await page.waitForSelector('.chat-understood', { timeout: 8000 });
    await page.click('#chat-exit');
  });
  await step('chat: a note card saves only on Accept, shows the error then retries, Dismiss writes nothing (Phase 91)', async () => {
    const orig = await planLS();
    chatMock.noteFailed = false; chatMock.notePending = [];
    chatMock.reply = { text: 'Noted.', edits: [{ type: 'note', text: '<b>Hates</b> Sunday cooking' }, { type: 'note', text: 'no fish' }, { type: 'note', text: 'Likes soup' }] };
    await openChat();
    await say('I hate cooking on Sundays');
    await page.waitForSelector('#chat-meals .chat-meal-add', { timeout: 8000 });
    if (await page.locator('#chat-meals .chat-meal-add').count() !== 2) throw new Error('expected 2 note cards (duplicate of "No fish" dropped)');
    if (await page.locator('#chat-meals b').count()) throw new Error('note text was rendered as HTML');
    await shot('chat-note');
    await page.click('#chat-meals .chat-meal-add >> nth=0');
    await page.waitForSelector('#chat-meals .chat-meal-err');
    if (await page.evaluate(() => (localStorage.getItem('mp_notes') || '').includes('Hates'))) throw new Error('cache written before a successful save');
    await page.click('#chat-meals .chat-meal-add >> nth=0');
    await page.waitForFunction(() => /waiting for Obsidian/.test(document.getElementById('chat-meals').innerText));
    await page.click('#chat-meals .chat-meal-no');
    if (await page.locator('#chat-meals .chat-meal-add').count() !== 0) throw new Error('Dismiss left a card');
    await page.click('#chat-exit');
    await page.waitForSelector('#plan-chat', { state: 'hidden' });
    if (await planLS() !== orig) throw new Error('note edits changed mp_plan');
    await page.goto(`${base}/plan-with-me.html`);
    await page.waitForSelector('#wiz-next');
    for (let i = 0; i < 5; i++) await page.click('#wiz-next');
    await page.waitForSelector('#notes-list li');
    if (!/No fish/.test(await page.locator('#notes-list').innerText()) || !/waiting for Obsidian/.test(await page.locator('#notes-list').innerText())) throw new Error('Standing notes list: ' + await page.locator('#notes-list').innerText());
    await shot('notes-list');
  });
  await step('chat: 5 places show 5 slot cards, a new meal waits on Add/No, Add then Undo, a place of a pending meal is refused (Phase 88)', async () => {
    const ids = ['roast-chicken', 'chilli-con-carne', 'chorizo-pasta', 'salmon-rice-broccoli', 'tuna-rice-veg'];
    chatMock.reply = { text: 'Done', edits: [...ids.map((mealId, i) => ({ type: 'place', day: i + 1, slot: 'dinner', mealId })),
      { type: 'place', day: 6, slot: 'dinner', mealId: 'turkey-chilli-bowl' },
      { type: 'mealCreate', name: 'Turkey chilli bowl', mealTypes: ['dinner'], ingredients: [{ name: 'turkey mince', qty: '500 g' }] }] };
    await openChat();
    const before = await planLS();
    const lib0 = await page.evaluate(() => (JSON.parse(localStorage.getItem('mp_library') || '[]').length));
    await say('fill the first five dinners');
    await page.waitForSelector('#chat-meals .chat-meal-add', { timeout: 8000 });
    if (await page.locator('#chat-meals .chat-meal-add').count() !== 1) throw new Error('expected one Add card');
    if (await page.locator('#chat-meals .chat-meal-no').count() !== 1) throw new Error('expected one No button');
    const rows = await page.locator('#chat-diff .diff-row button:text("Accept")').count();
    if (rows < 1 || rows > 5) throw new Error('slot cards: ' + rows);
    if (!/add the meal first/i.test(await page.locator('#plan-chat').innerText())) throw new Error('pending place not refused: ' + (await page.locator('.chat-bubble').allInnerTexts()).slice(3).map(t => t.slice(-90)).join(' // '));
    if (await page.evaluate(() => (JSON.parse(localStorage.getItem('mp_library') || '[]').length)) !== lib0) throw new Error('meal added before Add');
    await page.click('#chat-meals .chat-meal-add');
    await page.waitForSelector('#chat-meals button:text("Undo")', { timeout: 5000 });
    await page.click('#chat-meals button:text("Undo")');
    await page.waitForSelector('#chat-meals .rejected');
    await page.click('#chat-exit');
    await page.waitForSelector('#plan-chat', { state: 'hidden' });
    if (await planLS() !== before) throw new Error('Exit changed mp_plan');
  });
  await step('chat: a place with why shows "Because:", one without shows none (Phase 111)', async () => {
    chatMock.reply = { text: 'Done', edits: [{ type: 'place', day: 1, slot: 'dinner', mealId: 'roast-chicken', why: 'iron has been low' }, { type: 'place', day: 2, slot: 'dinner', mealId: 'chilli-con-carne' }] };
    await openChat();
    await say('two dinners');
    await page.waitForSelector('#chat-diff .diff-row', { timeout: 8000 });
    const rows = await page.locator('#chat-diff .diff-row').allInnerTexts();
    const n = rows.filter(t => /Because: iron has been low/.test(t)).length;
    if (n !== 1 || rows.filter(t => /Because:/.test(t)).length !== 1) throw new Error('because rows: ' + JSON.stringify(rows));
    await page.click('#chat-exit');
    await page.waitForSelector('#plan-chat', { state: 'hidden' });
  });
  await step('chat: bulk cards Accept writes plan.bulk, Undo clears it, Exit leaves mp_plan identical (Phase 90a)', async () => {
    const orig = await planLS();
    await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('mp_plan')); p.days.forEach(d => { d.slots = {}; }); [0, 8].forEach(i => { p.days[i].slots.dinner = { mealId: 'chilli-con-carne' }; }); localStorage.setItem('mp_plan', JSON.stringify(p)); });
    await page.reload();
    chatMock.reply = { text: 'Bulk it', edits: ['rice', 'pasta', 'oats', 'beef_mince', 'chicken_breast', 'chicken_thighs'].map(key => ({ type: 'bulk', key, shopDay: 1 })) };
    await openChat();
    const before = await planLS();
    await say('buy in bulk');
    await page.waitForFunction(() => [...document.querySelectorAll('.chat-bubble.hermes')].length > 1, null, { timeout: 8000 });
    await page.waitForTimeout(500);
    const cards = page.locator('#chat-meals .chat-meal:has(.chat-meal-add)');
    const n = await cards.count();
    if (n) {
      if (!/Buy .* saves £/.test(await cards.first().innerText())) throw new Error('bulk card text: ' + await cards.first().innerText());
      await shot('chat-bulk');
      await page.click('#chat-meals .chat-meal-add');
      await page.waitForSelector('#chat-meals button:text("Undo")', { timeout: 5000 });
      await page.click('#chat-meals button:text("Undo")');
      await page.waitForSelector('#chat-meals .rejected');
    }
    await page.click('#chat-exit');
    await page.waitForSelector('#plan-chat', { state: 'hidden' });
    const same = await planLS() === before;
    await page.evaluate(o => localStorage.setItem('mp_plan', o), orig);
    await page.reload();
    if (!same) throw new Error('Exit changed mp_plan');
    if (!n) throw new Error('no bulk card offered for beef mince on shops 1 and 8');
  });
  await step('chat: place.freezeFrom shows a defrost slot, a freeze card Accept fills fromCook slots, No leaves the record alone, Exit leaves mp_plan identical (Phase 105)', async () => {
    const orig = await planLS(), origCooks = await page.evaluate(() => localStorage.getItem('mp_cooks'));
    const cookedAt = new Date().toISOString(), cookId = `roast-chicken:${cookedAt}`;
    await page.evaluate(([cookedAt, cookId]) => { const p = JSON.parse(localStorage.getItem('mp_plan')); p.days.forEach(d => { d.slots = {}; }); p.days[0].slots.dinner = { mealId: 'chilli-con-carne' }; localStorage.setItem('mp_plan', JSON.stringify(p));
      localStorage.setItem('mp_cooks', JSON.stringify([{ id: cookId, mealId: 'roast-chicken', name: 'Roast chicken', variantId: null, cookedAt, portionsLeft: 4 }])); }, [cookedAt, cookId]);
    await page.reload();
    chatMock.reply = { text: 'Freeze some', edits: [{ type: 'place', day: 5, slot: 'dinner', mealId: 'chilli-con-carne', freezeFrom: 1 }, { type: 'freeze', cookId, places: [{ day: 7, slot: 'dinner' }, { day: 8, slot: 'dinner' }] }] };
    await openChat();
    const before = await planLS(), pantry0 = await page.evaluate(() => localStorage.getItem('mp_pantry'));
    await say('freeze the extras');
    await page.waitForSelector('#chat-meals .chat-meal-add', { timeout: 8000 });
    if (!/Freeze 2 portions of .*Roast Chicken/.test(await page.locator('#chat-meals').innerText())) throw new Error('freeze card: ' + await page.locator('#chat-meals').innerText());
    if (await page.evaluate(() => localStorage.getItem('mp_cooks')).then(c => JSON.parse(c).length) !== 1) throw new Error('cooks written before Accept');
    await shot('chat-freeze');
    await page.click('#chat-meals .chat-meal-add');
    await page.waitForFunction(() => /Froze 2 portions/.test(document.querySelector('#chat-meals').innerText), null, { timeout: 5000 });
    const cooks = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_cooks')));
    if (cooks.length !== 2 || cooks.find(c => c.storage === 'freezer').portionsLeft !== 2 || cooks.find(c => !c.storage || c.storage === 'fridge').portionsLeft !== 2) throw new Error('cooks after Accept: ' + JSON.stringify(cooks));
    if (await page.evaluate(() => localStorage.getItem('mp_pantry')) !== pantry0) throw new Error('freeze touched the pantry');
    await page.click('#chat-exit');
    await page.waitForSelector('#plan-chat', { state: 'hidden' });
    const same = await planLS() === before;
    await page.evaluate(([o, c]) => { localStorage.setItem('mp_plan', o); if (c === null) localStorage.removeItem('mp_cooks'); else localStorage.setItem('mp_cooks', c); }, [orig, origCooks]);
    await page.reload();
    if (!same) throw new Error('Exit changed mp_plan');
  });
  await step('chat: fridge mode shows stock chips, a "needs" note and the shop panel; Exit leaves mp_plan and mp_pantry identical (Phase 90b)', async () => {
    const orig = await planLS();
    await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('mp_plan')); const d = new Date(); d.setDate(d.getDate() - 1); p.startDate = d.toLocaleDateString('sv'); delete p.shopAnchor; delete p.firstSlot; p.days.forEach(x => { x.slots = {}; }); localStorage.setItem('mp_plan', JSON.stringify(p)); });
    await page.reload();
    chatMock.reply = { text: 'From the fridge', edits: [{ type: 'stock', items: [{ name: 'rice', qty: '500 g' }, { name: 'pasta' }, { name: 'chorizo' }] }, { type: 'place', day: 2, slot: 'dinner', mealId: 'chorizo-pasta' }, { type: 'place', day: 3, slot: 'dinner', mealId: 'tuna-rice-veg' }] };
    const pantry0 = await page.evaluate(() => localStorage.getItem('mp_pantry'));
    await page.click('#plan-fridge-btn');
    await page.waitForSelector('#plan-chat:not([hidden]) .chat-bubble.hermes', { timeout: 8000 });
    await say('rice, pasta and chorizo');
    await page.waitForFunction(() => document.querySelectorAll('.chat-bubble.understood').length > 1, null, { timeout: 8000 }).catch(async e => { throw new Error(e.message + ' bubbles: ' + (await page.locator('.chat-bubble').allInnerTexts()).join(' / ')); });
    const before = await planLS();
    if (!/You said you have: rice \(500 g\), pasta, chorizo/.test(await page.textContent('#chat-stock'))) throw new Error('stock chips: ' + await page.textContent('#chat-stock'));
    const bubbles = await page.locator('.chat-bubble.understood').allInnerTexts();
    if (!bubbles.some(t => /Chorizo Pasta.*needs White Sauce/i.test(t) || /needs White Sauce/i.test(t))) throw new Error('no needs note: ' + bubbles.join(' | '));
    if (bubbles.some(t => /needs .*Rice/.test(t) || /needs Chorizo/.test(t))) throw new Error('stock should count as have: ' + bubbles.join(' | '));
    await page.click('#chat-shop summary');
    if (!/new/.test(await page.textContent('#chat-shop-count'))) throw new Error('shop count: ' + await page.textContent('#chat-shop-count'));
    if (!(await page.locator('#chat-shop li.new').count())) throw new Error('no new shop lines');
    await shot('chat-fridge');
    await page.click('#chat-exit');
    await page.waitForSelector('#plan-chat', { state: 'hidden' });
    const same = (await page.evaluate(() => localStorage.getItem('mp_pantry'))) === pantry0;
    await page.evaluate(o => localStorage.setItem('mp_plan', o), orig);
    await page.reload();
    if (!same) throw new Error('Exit changed mp_pantry');
  });
  await step('chat: slot tap opens the deck with Pick for me', async () => {
    chatMock.reply = { text: 'ok', edits: [] };
    await openChat();
    await page.click('#chat-week .cw-col.sel .slot-card[data-slot="dinner"]');
    await page.waitForSelector('#swap-deck .swipe-card');
    await page.click('.deck-pick');
    await page.waitForSelector('#swap-overlay.hidden', { state: 'attached' });
    await page.click('#chat-exit');
  });
  // Phase 100: cook-now, from the swap deck and from the chat chip
  const W = (sel, o) => page.waitForSelector(sel, { timeout: 4000, ...o }).catch(() => { throw new Error('wait ' + sel); });
  await step('cook-now: empty state, then a stocked pantry lists a meal; Place from the deck and from chat changes the slot (Phase 100)', async () => {
    await page.goto(`${base}/plan.html`);
    await W('#plan-root .slot-card');
    await page.evaluate(() => MP.Sync.writeLocalItems('pantry', []));
    await page.click('#plan-root .slot-card .tc-h'); await page.click('#plan-root .slot-card .tc-b [data-tn="details"]');
    await page.click('.day-swap-btn[data-slot="dinner"]');
    await W('.deck-cooknow');
    await page.click('.deck-cooknow');
    await W('#swap-sheet .swipe-empty');
    await page.click('#swap-sheet .close-btn');
    const id = await page.evaluate(async () => {
      const lib = JSON.parse(localStorage.getItem('mp_library') || '[]');
      const keys = new Set(window.candidatesFor(1, 'dinner').flatMap((x) => x.ingredients.map((g) => g.key)));
      MP.Sync.writeLocalItems('pantry', [...keys].map((k) => ({ name: k })));
      return 0;
    });
    await page.click('.day-swap-btn[data-slot="dinner"]');
    await page.click('.deck-cooknow');
    await W('#swap-sheet .cooknow-place', { timeout: 3000 }).catch(async (e) => { throw new Error('no rows: ' + (await page.innerText('#swap-sheet')) + ' / ' + id); });
    await page.click('#swap-sheet .cooknow-place');
    await page.waitForSelector('#swap-overlay.hidden', { state: 'attached' });
    await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('mp_plan')); delete p.days[0].slots.dinner.locked; localStorage.setItem('mp_plan', JSON.stringify(p)); });
    await page.reload();
    await page.waitForSelector('#plan-root .slot-card');
    chatMock.reply = { text: 'ok', edits: [{ type: 'cookNow', day: 1, slot: 'dinner' }, { type: 'cookNow', day: 1, slot: 'dinner' }] };
    await openChat();
    await say('what can I make with what is in?');
    await W('#chat-meals .chat-cooknow-show');
    if (await page.locator('#chat-meals .chat-cooknow-show').count() !== 1) throw new Error('duplicate cookNow cards');
    await page.click('#chat-meals .chat-cooknow-show');
    await W('#swap-sheet .cooknow-place');
    await page.click('#swap-sheet .close-btn');
    await page.click('#chat-cooknow');
    await W('#swap-sheet .cooknow-place');
    await page.locator('#swap-sheet .cooknow-place').last().click(); // dinner day 1 already holds the first ready meal from the deck step
    await W('#chat-diff .diff-row');
    await page.click('#chat-exit');
  });
  // Phase 73: tie and trade-off cards (tieMargin widened so the generated plan has a tie; a £5 budget forces a trade-off)
  await step('chat: tie card (one, ignorable, alt swaps the working copy only) and trade-off card (Accept adds diff rows, Exit restores)', async () => {
    chatMock.reply = { text: 'ok', edits: [] };
    await openChat();
    await page.evaluate(() => localStorage.setItem('mp_planPrefs', JSON.stringify({ updatedAt: new Date().toISOString(), budgetTarget: 5 })));
    await page.click('#chat-exit');
    await openChat();
    await page.evaluate(async () => { (await MP.ShoppingList.load()).planning.tieMargin = 1000; });
    for (let i = 0; i < 14 && !await page.locator('#chat-cards .chat-tie').count(); i++) { if (i === 7) await page.click('#chat-next'); await page.locator('.cw-tile').nth(i % 7).dispatchEvent('click'); }
    if (!await page.locator('#chat-cards .chat-tie').count()) throw new Error('no tie card on any day with tieMargin 1000');
    if (await page.locator('#chat-cards .chat-tie').count() !== 1) throw new Error('expected exactly one tie card');
    await shot('chat-cards'); await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; }); await shot('chat-cards-light');
    const planBefore = await planLS();
    await page.locator('#chat-cards .chat-tie button').nth(1).click();
    await page.waitForSelector('#chat-diff .diff-row');
    if (await page.locator('#chat-cards .chat-tie').count()) throw new Error('tie card re-asked for the same day');
    if (await planLS() !== planBefore) throw new Error('tie pick saved mp_plan');
    if (await page.locator('#chat-cards .chat-trade').count()) {
      const rows = await page.locator('#chat-diff .diff-row').count();
      await page.click('#chat-cards .chat-trade button.primary');
      await page.waitForFunction(n => document.querySelectorAll('#chat-diff .diff-row').length > n, rows, { timeout: 8000 });
      if (!(await page.locator('.chat-understood').allTextContents()).some(t => /Week 1: £\d+ → £\d+ · protein/.test(t))) throw new Error('no totals line after Accept');
    } else throw new Error('no trade-off card with a £5 budget');
    await page.click('#chat-exit');
    if (await planLS() !== planBefore) throw new Error('Exit changed mp_plan');
  });
  await step('chat: a stale bridge lands on plan-with-me.html', async () => {
    chatMock.bridgeAgeMs = 120000;
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card');
    await page.click('#plan-chat-btn');
    await page.waitForURL(/plan-with-me\.html/, { timeout: 8000 });
    chatMock.bridgeAgeMs = 0;
  });
  await step('tomorrow card: alternatives, pick changes only day+1, Keep locks, excluded pick refused, last day has no card', async () => {
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card');
    const seed = async (start, leftover) => {
      await page.evaluate(async ([off, lo]) => {
        const lib = await fetch('meals.json').then(r => r.json());
        const one = (Array.isArray(lib) ? lib : lib.meals).find(m => m.mealTypes.includes('dinner') && !m.leftoverOf && !((m.servings || 1) >= 2));
        const p = JSON.parse(localStorage.getItem('mp_plan'));
        const d = new Date(); d.setDate(d.getDate() - off);
        p.startDate = d.toLocaleDateString('en-CA');
        p.days.forEach(x => { if (x.slots.dinner) { x.slots.dinner = { mealId: x.slots.dinner.mealId }; } });
        p.days[1].slots.dinner = { mealId: lo ? 'chicken-fajitas' : one.id };
        localStorage.setItem('mp_plan', JSON.stringify(p));
      }, [start, !!leftover]);
      await page.reload(); await page.waitForSelector('#plan-root .slot-card');
    };
    await seed(0);
    await page.waitForSelector('#tomorrow-card:not([hidden]) .tomorrow-alt');
    const n = await page.locator('.tomorrow-alt').count();
    if (n < 1 || n > 3) throw new Error('expected 1-3 alternatives, got ' + n);
    const want = await page.evaluate(() => window.candidatesFor(2, 'dinner').slice(0, 3).map(m => m.id));
    const got = await page.$$eval('.tomorrow-alt', bs => bs.map(b => b.dataset.alt));
    if (JSON.stringify(want) !== JSON.stringify(got)) throw new Error('alternatives differ from candidatesFor order');
    await shot('tomorrow');
    const before = await planLS();
    await page.click('#tomorrow-keep');
    let p = JSON.parse(await planLS()), b = JSON.parse(before);
    if (!p.days[1].slots.dinner.locked || p.days[1].slots.dinner.mealId !== b.days[1].slots.dinner.mealId) throw new Error('Keep must lock without changing the meal');
    const altId = await page.getAttribute('.tomorrow-alt', 'data-alt');
    await page.click('.tomorrow-alt');
    p = JSON.parse(await planLS());
    if (p.days[1].slots.dinner.mealId !== altId || !p.days[1].slots.dinner.locked) throw new Error('pick did not set + lock tomorrow');
    p.days.forEach((d, i) => { if (i !== 1 && JSON.stringify(d) !== JSON.stringify(b.days[i])) throw new Error('pick changed day ' + (i + 1)); });
    const snap = await planLS();
    const refused = await page.evaluate(() => {
      const orig = window.MP.Exclusions.check;
      window.MP.Exclusions.check = () => ({ ok: false, reasons: ['test'] });
      const r = window.pickTomorrow(2, window.candidatesFor(2, 'dinner')[0].id);
      window.MP.Exclusions.check = orig;
      return r;
    });
    if (refused === true) throw new Error('excluded meal was picked');
    if (await planLS() !== snap) throw new Error('refused pick changed mp_plan');
    await seed(0, true);
    await page.waitForSelector('#tomorrow-card:not([hidden])');
    if (await page.locator('.tomorrow-alt').count() || !/Leftovers/.test(await page.innerText('#tomorrow-card'))) throw new Error('leftover tomorrow should show no alternatives');
    await page.evaluate(() => localStorage.setItem('mp_planPrefs', JSON.stringify({ rolling: false })));
    await seed(13);
    if (!(await page.evaluate(() => document.getElementById('tomorrow-card').hidden))) throw new Error('card shown on last plan day');
  });
  // Phase 109: the docked bar's Ask mode (Hermes) and Browse search-and-log; /chat is the same page.route mock above
  const flog = { entries: [] };
  await page.route('https://fake.test/food-log', route => {
    const req = route.request();
    if (req.method() === 'POST') { const e = req.postDataJSON().entries[0]; if (e.name && e.grams) flog.entries.push({ id: e.id, kind: 'eat', name: e.name, grams: e.grams, when: e.when }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flog) });
  });
  const stateKeys = () => page.evaluate(() => JSON.stringify(['mp_pantry', 'mp_cooks', 'mp_pantry_ops'].map(k => localStorage.getItem(k))));
  const askBar = async (text, reply) => {
    chatMock.bridgeAgeMs = 0; chatMock.reply = reply;
    await page.click('.ate-mode[data-mode="ask"]');
    await page.fill('.ate-input', text);
    await page.press('.ate-input', 'Enter');
    await page.waitForSelector('.ate-bubble.typing', { state: 'detached', timeout: 10000 });
  };
  const seedPlan = async (pg) => {
    await page.goto(`${base}/plan.html`);
    await page.evaluate(() => { localStorage.removeItem('mp_plan'); localStorage.removeItem('mp_planPrefs'); localStorage.setItem('mp_hermes_url', 'https://fake.test'); localStorage.setItem('mp_hermes_token', 't'); sessionStorage.clear(); });
    await page.goto(`${base}/${pg}`);
    if (pg === 'plan.html') await page.waitForSelector('#plan-root .slot-card');
    if (pg === 'plan.html') await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('mp_plan')); p.startDate = new Date().toLocaleDateString('en-CA'); localStorage.setItem('mp_plan', JSON.stringify(p)); });
    await page.reload();
    if (pg === 'plan.html') await page.waitForSelector('#plan-root .slot-card');
    await page.waitForSelector('.ate-mode[data-mode="ask"]:not([hidden])');
    await page.evaluate(() => { window.__marker = 1; window.__live = 0; addEventListener('mp:plan-live', () => window.__live++); });
  };
  await step('bar Ask on Shopping: a swapDay reply changes mp_plan in place (no reload), the list redraws, Undo restores', async () => {
    await page.goto(`${base}/plan.html`); await page.evaluate(() => localStorage.removeItem('mp_plan')); // fresh plan
    await seedPlan('plan.html'); await page.goto(`${base}/shopping.html`);
    await page.waitForSelector('#shopping-root .shop-line, #shopping-root li', { state: 'attached', timeout: 8000 });
    await page.waitForSelector('.ate-mode[data-mode="ask"]:not([hidden])');
    await page.evaluate(() => { window.__marker = 1; window.__live = 0; addEventListener('mp:plan-live', () => window.__live++); });
    const before = JSON.parse(await planLS());
    await askBar('swap Tuesday and Wednesday', { text: 'Swapped them.', edits: [{ type: 'swapDay', a: 2, b: 3 }] });
    const after = JSON.parse(await planLS());
    if (JSON.stringify(after.days[1].slots) !== JSON.stringify(before.days[2].slots) || JSON.stringify(after.days[2].slots) !== JSON.stringify(before.days[1].slots)) throw new Error('days 2 and 3 not swapped in mp_plan');
    if (await page.evaluate(() => [window.__marker, window.__live].join()) !== '1,1') throw new Error('page reloaded or mp:plan-live missed');
    if (!/Hermes did/.test(await page.innerText('.ate-thread'))) throw new Error('no "Hermes did" bubble');
    if (await page.evaluate(() => localStorage.getItem('mp_planUndo')) !== JSON.stringify(before)) throw new Error('snapshot is not the pre-edit plan');
    await shot('bar-ask');
    await page.click('.ate-msg button:text("Undo")');
    if (JSON.stringify(JSON.parse(await planLS())) !== JSON.stringify(before)) throw new Error('Undo did not restore the plan');
  });
  await step('bar Ask on Plan: a swapDay redraws the grid in place; with the Plan chat open the bar is not offered', async () => {
    await seedPlan('plan.html');
    const grid0 = await page.innerText('#plan-root');
    await askBar('swap Tuesday and Wednesday', { text: 'Done.', edits: [{ type: 'swapDay', a: 2, b: 3 }] });
    if (await page.evaluate(() => window.__marker) !== 1) throw new Error('page reloaded');
    if (await page.innerText('#plan-root') === grid0) throw new Error('plan grid did not redraw');
    await openChat();
    if (await page.locator('.ate-bar').isVisible()) throw new Error('bar visible while the Plan chat is open');
    await page.click('#chat-exit'); await page.waitForSelector('#plan-chat', { state: 'hidden' });
  });
  await step('bar Ask: non-live edits apply nothing and link to Plan with me; meals rows list library ids only', async () => {
    await seedPlan('discover.html');
    const before = await planLS();
    await askBar('make me a new recipe and a budget', { text: 'Needs the planner.', edits: [{ type: 'mealCreate', name: 'X', ingredients: [{ key: 'rice', qty: '1' }] }, { type: 'budget', perWeek: 30 }] });
    if (await planLS() !== before) throw new Error('plan changed');
    if (!await page.locator('.ate-thread a[href="plan-with-me.html"]').count()) throw new Error('no Plan with me link');
    const ids = await page.evaluate(async () => (await MP.getLibrary()).slice(0, 8).map(m => m.id));
    await askBar('quick chicken?', { text: 'Try these.', edits: [{ type: 'meals', ids: [...ids, 'no-such-meal'] }] });
    if (await page.locator('.ate-meal').count()) throw new Error('>6 ids should drop the whole meals edit');
    await askBar('quick chicken?', { text: 'Try these.', edits: [{ type: 'meals', ids: [ids[0], ids[1], 'no-such-meal'] }] });
    if (await page.locator('.ate-meal').count() !== 2) throw new Error('expected 2 meal rows (unknown id dropped)');
  });
  await step('bar bad input: empty Ask, 1001 chars, stale bridge show a message, Log unaffected', async () => {
    await seedPlan('discover.html');
    await page.click('.ate-mode[data-mode="ask"]');
    await page.press('.ate-input', 'Enter');
    if (!/Type a question/.test(await page.innerText('.ate-msg'))) throw new Error('empty Ask not refused');
    if (await page.evaluate(() => document.querySelector('.ate-input').maxLength) !== 1000) throw new Error('Ask maxlength');
    await page.evaluate(() => { sessionStorage.removeItem('mp_barSession'); });
    chatMock.bridgeAgeMs = 120000;
    await page.fill('.ate-input', 'hello'); await page.press('.ate-input', 'Enter');
    await page.waitForFunction(() => /Hermes isn't answering/.test(document.querySelector('.ate-thread').innerText), null, { timeout: 8000 });
    chatMock.bridgeAgeMs = 0;
    await page.click('.ate-mode[data-mode="log"]');
    if (await page.evaluate(() => document.querySelector('.ate-input').maxLength) !== 120) throw new Error('Log mode input changed');
  });
  await step('browse: "chicken rice" needs both; a food Eat without grams asks for an amount, with grams logs; pantry/cooks untouched', async () => {
    await page.goto(`${base}/index.html`);
    await page.evaluate(() => { localStorage.setItem('mp_hermes_url', 'https://fake.test'); localStorage.setItem('mp_hermes_token', 't'); });
    await page.reload(); await page.waitForSelector('#library-grid .meal-card');
    await page.fill('#library-search', 'chicken rice');
    await page.waitForTimeout(300);
    const bad = await page.$$eval('#library-grid .meal-card', cs => cs.length);
    const ok = await page.evaluate(async () => { const l = await MP.getLibrary(); return MP.filterMeals(l, 'chicken').filter(m => /rice/i.test(JSON.stringify(m))).length; });
    if (bad !== ok) throw new Error(`browse shows ${bad}, expected ${ok} meals with chicken and rice`);
    await page.fill('#library-search', 'chicken');
    await page.waitForSelector('#library-foods .food-row');
    const keys0 = await stateKeys();
    await page.click('#library-foods .food-row button');
    await page.waitForSelector('.toast:has-text("Add an amount")', { timeout: 5000 });
    await page.fill('#library-foods .food-row input', '150');
    await page.click('#library-foods .food-row button');
    await page.waitForSelector('.toast:has-text("Logged")', { timeout: 5000 });
    if (!flog.entries.some(e => e.grams === 150)) throw new Error('food not logged with grams');
    if (await stateKeys() !== keys0) throw new Error('pantry/cooks changed');
    await shot('browse-foods');
  });
  await step('bar Ask at the phone width sits above the tab bar; thread scrolls; no horizontal scroll (both themes)', async () => {
    await seedPlan('discover.html');
    await askBar('hi', { text: 'x '.repeat(200), edits: [] });
    await page.waitForTimeout(500); // bottom transition
    const typing = await page.evaluate(() => Math.round(innerHeight - document.querySelector('.ate-bar').getBoundingClientRect().bottom));
    if (typing !== 0) throw new Error('bar not flush with the bottom while typing: ' + typing);
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForTimeout(500);
    const g = await page.evaluate(() => { const b = document.querySelector('.ate-bar').getBoundingClientRect(), n = document.querySelector('.nav-links').getBoundingClientRect(), t = document.querySelector('.ate-thread'); return { above: b.bottom <= n.top + 1 || getComputedStyle(document.querySelector('.nav-links')).position !== 'fixed', scrolls: t.scrollHeight > t.clientHeight, over: document.documentElement.scrollWidth > innerWidth, h: t.getBoundingClientRect().height < innerHeight * 0.45 }; });
    if (!g.above || g.over || !g.h) throw new Error('layout: ' + JSON.stringify(g));
    for (const th of ['light', 'dark']) { await page.evaluate(t => { document.documentElement.dataset.theme = t; }, th); await shot('bar-' + th); }
  });
  await step('discover (Phase 113): card stack, buttons, drag, tap/Esc, keys, undo, save, bring back, no Breakfast chip', async () => {
    const tagKeys = await page.evaluate(async () => Object.keys(await (await fetch('ingredient-nutrient-tags.json')).json()).filter(k => k[0] !== '_'));
    const mk = (n, keys) => ({ id: `api-t${n}`, name: `Test meal ${n}`, source: 'themealdb', mealTypes: ['dinner'], servings: 1, description: 'd', instructions: '', image: null, ingredients: keys.map(k => ({ key: k, qty: '1', label: k.replace(/_/g, ' ') })) });
    const pool = [mk(1, tagKeys.slice(0, 20)), mk(2, ['rice']), mk(3, ['rice']), mk(4, ['rice']), mk(5, ['rice'])];
    const seed = async () => {
      await page.goto(`${base}/discover.html`);
      await page.evaluate(p => { sessionStorage.clear(); sessionStorage.setItem('mp_discover_pool:', JSON.stringify(p)); localStorage.removeItem('mp_saved_later'); }, pool);
      await page.reload(); await page.waitForSelector('#fan-deck .fan-card.top');
    };
    const inLib = id => page.evaluate(async i => (await MP.getLibrary()).some(m => m.id === i), id);
    const dismissed = () => page.evaluate(() => [...MP.getDismissed()]);
    const topName = () => page.innerText('#fan-deck .fan-card.top h3');
    const settle = () => page.waitForTimeout(400);
    await seed();
    if (await page.locator('#discover-filters [data-cat="Breakfast"]').count()) throw new Error('Breakfast chip present');
    const txt = await page.innerText('#fan-deck .fan-card.top');
    if (!/Test meal 1/.test(txt) || !/Ingredients/.test(txt)) throw new Error('top card content: ' + txt);
    if (!await page.locator('#fan-deck .fan-card.top .fan-gap').count()) throw new Error('no gap chip on the top card');
    if (!await page.locator('#fan-undo:disabled').count()) throw new Error('Undo enabled with no history');
    await shot('discover');
    await page.click('#fan-like'); await settle();
    if (!await inLib('api-t1')) throw new Error('Add did not add to the library');
    if (await topName() !== 'Test meal 2') throw new Error('did not advance');
    await page.click('#fan-skip'); await settle();
    if (!(await dismissed()).includes('api-t2')) throw new Error('Dismiss did not dismiss');
    // drag: short springs back, right adds, left dismisses
    const drag = async (dx) => { const b = await page.locator('#fan-deck .fan-card.top').boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 6 }); await page.mouse.up(); await settle(); };
    await drag(50);
    if (await topName() !== 'Test meal 3' || await page.locator('#meal-sheet-overlay:not(.hidden)').count()) throw new Error('short drag changed state');
    await drag(160);
    if (!await inLib('api-t3')) throw new Error('drag right did not add');
    await drag(-160);
    if (!(await dismissed()).includes('api-t4')) throw new Error('drag left did not dismiss');
    // undo: dismiss then add
    await page.click('#fan-undo'); await settle();
    if ((await dismissed()).includes('api-t4') || await topName() !== 'Test meal 4') throw new Error('Undo after dismiss');
    // tap opens details, Esc closes and focus returns
    const b = await page.locator('#fan-deck .fan-card.top').boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    await shot('discover-sheet');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#meal-sheet-overlay.hidden', { state: 'attached' });
    if (!await page.evaluate(() => document.activeElement.classList.contains('top'))) throw new Error('focus did not return to the card');
    // keys
    await page.keyboard.press('ArrowUp'); await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter'); await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowRight'); await settle();
    if (!await inLib('api-t4')) throw new Error('ArrowRight did not add');
    await page.keyboard.press('z'); await settle();
    if (await inLib('api-t4') || await topName() !== 'Test meal 4') throw new Error('Z did not undo an add');
    await page.keyboard.press('ArrowLeft'); await settle();
    if (!(await dismissed()).includes('api-t4')) throw new Error('ArrowLeft did not dismiss');
    // sheet Save for later lands in the pile
    await page.click('#fan-details'); await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    await page.click('#meal-sheet [data-act="save"]'); await settle();
    if (!/Test meal 5/.test(await page.innerText('#saved-grid'))) throw new Error('not in the saved pile');
    // empty deck: bring back
    if (!/Bring back \d+ dismissed/.test(await page.innerText('#fan-deck'))) throw new Error('no bring-back button');
    await shot('discover-empty');
    await page.click('#fan-bring-back'); await page.waitForSelector('#fan-deck .fan-card.top');
    if ((await dismissed()).length) throw new Error('dismissed not restored');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('horizontal scroll');
    for (const th of ['light', 'dark']) { await page.evaluate(t => { document.documentElement.dataset.theme = t; }, th); await page.waitForTimeout(500); await shot('discover-' + th); }
    await page.evaluate(async () => { await MP.removeFromLibrary('api-t1'); await MP.removeFromLibrary('api-t3'); localStorage.removeItem('mp_saved_later'); sessionStorage.clear(); });
  });
  await step('phase 115: Browse cards + chips, shared Details sheet (ticks, variants, Add to plan + Undo, held night, Eat, Cook mode, Esc, gap notes)', async () => {
    await page.goto(`${base}/index.html`);
    await page.waitForSelector('#library-grid .meal-card');
    const cards = () => page.locator('#library-grid .meal-card').count();
    const c0 = await page.locator('#library-grid .meal-card').first();
    // 1. card anatomy
    if (!await c0.locator('.mc-ph').count() || !await c0.locator('.mc-meta').count() || !await c0.locator('[data-act="eat"]').count() || !await c0.locator('[data-act="details"]').count()) throw new Error('card anatomy');
    if (!await page.locator('#library-grid .mc-cost').count()) throw new Error('no cost badge');
    // 2. chips
    const all = await cards();
    const chip = (k) => page.evaluate((k) => document.querySelector(`[data-chip="${k}"]`).click(), k);
    await chip('quick'); const q = await cards();
    await chip('batch'); const qb = await cards();
    if (!(q < all && qb < q)) throw new Error(`chips ${all} > ${q} > ${qb}`);
    await chip('quick'); await chip('batch');
    if (await cards() !== all) throw new Error('chips did not clear');
    // 3. sheet anatomy: description above photo, ingredient checkboxes, numbered method
    await page.evaluate(() => localStorage.removeItem('mp_pantry')); await page.reload(); await page.waitForSelector('#library-grid .meal-card');
    await page.fill('#library-search', 'chorizo'); await page.evaluate(() => document.activeElement.blur());
    await page.evaluate(() => document.querySelector('#library-grid .meal-card [data-act="details"]').click());
    await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    const anat = await page.evaluate(() => { const d = document.querySelector('#meal-sheet .ms-desc'), p = document.querySelector('#meal-sheet .ms-photo'); return { order: !!(d && p && (d.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING)), boxes: document.querySelectorAll('#meal-sheet .ms-ings input[type=checkbox]').length, steps: document.querySelectorAll('#meal-sheet ol.ms-steps li').length }; });
    if (!anat.order || anat.boxes < 2 || anat.steps < 1) throw new Error('sheet anatomy ' + JSON.stringify(anat));
    // 4. ticking lowers "to buy"; pantry untouched
    const buy = () => page.evaluate(() => +document.querySelector('#meal-sheet .ms-buy').textContent.match(/\d+/)[0]);
    const pan = () => page.evaluate(() => localStorage.getItem('mp_pantry'));
    const [b0, p0] = [await buy(), await pan()];
    await page.evaluate(() => document.querySelector('#meal-sheet .ms-ings input[type=checkbox]').click());
    if (await buy() !== b0 - 1 || await pan() !== p0) throw new Error('tick: buy ' + b0 + '->' + await buy());
    // 5. variant changes the ingredient list
    const ingTxt = () => page.innerText('#meal-sheet .ms-ings');
    const i0 = await ingTxt();
    await page.evaluate(() => document.querySelectorAll('#meal-sheet .ms-variants input')[1].click());
    if (await ingTxt() === i0) throw new Error('variant did not change ingredients');
    await page.evaluate(() => document.querySelectorAll('#meal-sheet .ms-variants input')[0].click());
    await shot('browse-sheet');
    await page.evaluate(() => localStorage.removeItem('mp_plan'));
    await page.goto(`${base}/plan.html`); await page.waitForSelector('#plan-root .slot-card'); await page.waitForTimeout(300);
    await page.goBack(); await page.waitForSelector('#library-grid .meal-card');
    await page.evaluate(() => document.querySelector('#library-grid .meal-card [data-act="details"]').click());
    await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    // seed: day 2 has a meal, day 3 is eaten (held)
    await page.evaluate(() => {
      const t = new Date().toLocaleDateString('sv');
      const p = JSON.parse(localStorage.getItem('mp_plan')); p.startDate = t;
      p.days.forEach((d) => { d.slots = {}; });
      p.days[1].slots.dinner = { mealId: 'roast-chicken' };
      p.days[2].slots.dinner = { mealId: 'roast-chicken', eatenAt: new Date().toISOString() };
      localStorage.setItem('mp_plan', JSON.stringify(p));
    });
    // 6/8. Add to plan -> night picker (held disabled) -> night 2
    await page.evaluate(() => document.querySelector('#meal-sheet [data-act="plan"]').click());
    await page.waitForSelector('#meal-sheet .ms-night');
    if (!await page.locator('#meal-sheet .ms-night[data-day="3"]:disabled').count()) throw new Error('held night not disabled');
    await page.evaluate(() => document.querySelector('#meal-sheet .ms-night[data-day="2"]').click());
    await page.waitForSelector('.toast');
    const day2 = () => page.evaluate(() => JSON.parse(localStorage.getItem('mp_plan')).days[1].slots.dinner.mealId);
    if (await day2() !== 'chorizo-pasta' || !/Added .* to /.test(await page.innerText('.toast'))) throw new Error('add to plan: ' + await day2());
    // 7. Undo
    await page.evaluate(() => [...document.querySelectorAll('.toast button')].find((b) => /Undo/.test(b.textContent)).click());
    await page.waitForTimeout(200);
    if (await day2() !== 'roast-chicken') throw new Error('undo did not restore day 2');
    // 9. Eat logs one entry and the card shows Eaten today
    await page.evaluate(() => localStorage.removeItem('mp_eatenLog'));
    await page.evaluate(() => document.querySelector('#library-grid .meal-card [data-act="eat"]').click());
    await page.waitForSelector('#meal-sheet .eat-log');
    await page.evaluate(() => document.querySelector('#meal-sheet .eat-log').click());
    await page.waitForSelector('#library-grid .mc-bd');
    if (await page.evaluate(() => JSON.parse(localStorage.getItem('mp_eatenLog')).length) !== 1) throw new Error('eat did not log exactly one entry');
    // 10/11. Cook mode opens #cook-overlay; Escape closes the sheet and focus returns to the opener
    await page.evaluate(() => document.querySelector('#library-grid .meal-card [data-act="details"]').click());
    await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    await page.evaluate(() => document.querySelector('#meal-sheet [data-act="cook"]').click());
    await page.waitForSelector('#cook-overlay:not(.hidden)');
    await page.evaluate(() => document.getElementById('cook-overlay').classList.add('hidden'));
    await page.evaluate(() => { const b = document.querySelector('#library-grid .meal-card [data-act="details"]'); b.focus(); b.click(); });
    await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#meal-sheet-overlay.hidden', { state: 'attached' });
    if (!await page.evaluate(() => document.activeElement.dataset.act === 'details')) throw new Error('focus did not return to the opener');
    // 15. gap notes for a meal with no description and no method
    await page.evaluate(() => MP.addToLibrary({ id: 'walk-gap', name: 'Walk gap meal', servings: 1, mealTypes: ['dinner'], ingredients: [{ key: 'rice', label: 'Rice' }] }));
    await page.reload(); await page.fill('#library-search', 'Walk gap'); await page.evaluate(() => document.activeElement.blur());
    await page.evaluate(() => document.querySelector('#library-grid .meal-card [data-act="details"]').click());
    await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    const gap = await page.innerText('#meal-sheet');
    if (!/No description yet/.test(gap) || !/No method yet/.test(gap)) throw new Error('gap notes missing');
    await page.keyboard.press('Escape');
    await page.evaluate(() => MP.removeFromLibrary('walk-gap'));
    // 16. no horizontal scroll, dock visible
    await page.evaluate(() => document.querySelector('#library-grid .meal-card [data-act="details"]')?.click());
    await page.reload(); await page.waitForSelector('#library-grid .meal-card');
    await page.evaluate(() => document.querySelector('#library-grid .meal-card [data-act="details"]').click());
    await page.waitForSelector('#meal-sheet-overlay:not(.hidden)'); await page.waitForTimeout(400);
    const lay = await page.evaluate(() => { const d = document.querySelector('#meal-sheet .ms-dock').getBoundingClientRect(), n = document.querySelector('.nav-links').getBoundingClientRect(); return { hs: document.documentElement.scrollWidth > innerWidth, dockVisible: d.bottom <= innerHeight + 1 && d.height > 20, aboveTab: getComputedStyle(document.querySelector('.nav-links')).position !== 'fixed' || d.bottom <= n.top + 1 || +getComputedStyle(document.getElementById('meal-sheet-overlay')).zIndex > 30 }; });
    if (lay.hs || !lay.dockVisible) throw new Error('layout ' + JSON.stringify(lay));
    await page.keyboard.press('Escape');
    // 12. Plan: Recipe button opens the same sheet with Cook mode / Eat / Swap; a variant pick sets variantId
    await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('mp_plan')); p.days[1].slots.dinner = { mealId: 'chorizo-pasta' }; localStorage.setItem('mp_plan', JSON.stringify(p)); });
    await page.goto(`${base}/plan.html`); await page.waitForSelector('#plan-root .slot-card[data-day="2"]');
    await page.click('#plan-root .slot-card[data-day="2"] .tc-h'); await page.click('#plan-root .slot-card[data-day="2"] [data-tn="details"]');
    await page.click('.day-recipe-btn[data-slot="dinner"]');
    await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    const acts = await page.evaluate(() => [...document.querySelectorAll('#meal-sheet .ms-dock [data-act]')].map((b) => b.dataset.act).join());
    if (acts !== 'cook,eat,swap') throw new Error('plan dock ' + acts);
    await page.evaluate(() => document.querySelectorAll('#meal-sheet .ms-variants input')[1].click());
    const vid = await page.evaluate(() => JSON.parse(localStorage.getItem('mp_plan')).days[1].slots.dinner.variantId);
    if (!vid) throw new Error('plan variant pick did not set variantId');
    await page.keyboard.press('Escape');
    // 13. Discover: tap on the top card opens the sheet with its three actions (covered in depth by the discover step)
    // 14. Shopping use-it-up meal opens the same sheet
    await page.goto(`${base}/shopping.html#pantry`);
    await page.evaluate(() => localStorage.setItem('mp_pantry', JSON.stringify({ updatedAt: new Date().toISOString(), items: [{ name: 'cheese', qty: '200g', useBy: '2020-01-01' }] })));
    await page.reload(); await page.waitForSelector('.useup-strip li.over');
    await page.click('#useup-btn'); await page.waitForSelector('.modal-sheet [data-meal]');
    await page.click('.modal-sheet [data-meal]');
    await page.waitForSelector('#meal-sheet-overlay:not(.hidden)');
    await page.keyboard.press('Escape');
    await page.evaluate(() => localStorage.removeItem('mp_pantry'));
  });
  await step('no uncaught page errors during the walk', async () => { if (errs.length) throw new Error(errs[0]); });
  await ctx.close();
}
await browser.close(); srv?.close();
console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
