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
    await page.click('#plan-root .slot-card');
    await page.click('.day-swap-btn[data-slot="dinner"]');
    await page.waitForSelector('#swap-deck .swipe-card');
    const before = await page.evaluate(() => localStorage.getItem('mp_plan'));
    await page.hover('#swap-deck .swipe-card');
    await page.waitForSelector('#swap-deck .whatif');
    if (!/Protein/.test(await page.textContent('.whatif'))) throw new Error('preview has no protein line');
    if (before !== await page.evaluate(() => localStorage.getItem('mp_plan'))) throw new Error('preview changed mp_plan');
    await page.click('#swap-sheet .close-btn');
  });
  await step('swap deck: Pass x3 walks the ranked order, counter drops, Take changes the plan, arrow keys work', async () => {
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card');
    await page.click('#plan-root .slot-card');
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
  await step('guided: slots=lunch adds a 3-card Lunch pass after dinners; closing leaves mp_plan untouched', async () => {
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card'); // init saves mp_plan after its awaits; clearing earlier races it
    await page.evaluate(() => localStorage.removeItem('mp_plan'));
    await page.goto(`${base}/plan.html?guided=1&slots=lunch,junk`);
    await page.waitForSelector('#swap-sheet h2');
    let h = await page.textContent('#swap-sheet h2');
    if (!/Dinner/.test(h)) throw new Error('first pass should be Dinner: ' + h);
    for (let i = 0; i < 30 && /Dinner/.test(h); i++) {   // pick the top dinner card (right) each day
      await page.evaluate(() => {   // synthetic drag (a toast can sit over the card)
        const c = document.querySelector('#swap-deck .swipe-card');
        const ev = (t, x, el) => el.dispatchEvent(new MouseEvent(t, { clientX: x, clientY: 100, bubbles: true }));
        ev('mousedown', 100, c); ev('mousemove', 400, window); ev('mouseup', 400, window);
      });
      await page.waitForTimeout(450);
      h = (await page.textContent('#swap-sheet h2').catch(() => '')) || '';
    }
    if (!/Lunch/.test(h)) throw new Error('expected a Lunch pass, got: ' + h);
    if (await page.locator('#swap-deck .swipe-card').count() > 3) throw new Error('lunch deck over 3 cards');
    await shot('guided-lunch');
    await page.click('#swap-sheet .close-btn');
    await page.waitForSelector('#guided-review-banner:not(.hidden)');
    if (await page.evaluate(() => localStorage.getItem('mp_plan'))) throw new Error('mp_plan saved before Looks good');
  });
  // Phase 72: planning chat, /chat mocked by page.route (no Worker, no credential)
  const chatMock = { msgs: [], seq: 0, session: null, reply: null, bridgeAgeMs: 0 };
  await page.route('https://fake.test/**', route => {
    const req = route.request(), u = new URL(req.url()), m = chatMock;
    const ok = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
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
  await step('chat: slot tap opens the deck with Pick for me', async () => {
    chatMock.reply = { text: 'ok', edits: [] };
    await openChat();
    await page.click('#chat-week .cw-col.sel .slot-card[data-slot="dinner"]');
    await page.waitForSelector('#swap-deck .swipe-card');
    await page.click('.deck-pick');
    await page.waitForSelector('#swap-overlay.hidden', { state: 'attached' });
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
  await step('no uncaught page errors during the walk', async () => { if (errs.length) throw new Error(errs[0]); });
  await ctx.close();
}
await browser.close(); srv?.close();
console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
