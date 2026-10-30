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
  await step('phone polish (Phase 108): tab bar at the bottom with the active page, a sheet drags down to close, a short drag snaps back', async () => {
    if (page.viewportSize().width >= 640) return;
    const bar = await page.evaluate(() => { const n = document.querySelector('.nav-links'), r = n.getBoundingClientRect(); return { bottom: Math.round(r.bottom) === innerHeight, active: n.querySelector('a.active')?.textContent, pos: getComputedStyle(n).position }; });
    if (bar.pos !== 'fixed' || !bar.bottom || !/Browse/.test(bar.active)) throw new Error('tab bar: ' + JSON.stringify(bar));
    await page.locator('#library-grid .card').first().click();
    await page.waitForSelector('#modal-overlay:not(.hidden)');
    await page.waitForTimeout(400); // entry animation
    const r = await page.locator('#modal-sheet').boundingBox();
    const dragBy = async (dy) => { await page.mouse.move(r.x + r.width / 2, r.y + 10); await page.mouse.down(); await page.mouse.move(r.x + r.width / 2, r.y + 10 + dy, { steps: 4 }); await page.mouse.up(); };
    await dragBy(40);
    if (await page.locator('#modal-overlay.hidden').count()) throw new Error('a 40 px drag closed the sheet');
    await dragBy(160);
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
  await step('plan: drag a card onto another swaps, a day grip swaps days, Alt+Arrow swaps, a tap still opens the day (Phase 103)', async () => {
    await page.goto(`${base}/plan.html`);
    await page.waitForSelector('#plan-root .slot-card');
    const names = () => page.evaluate(() => [...document.querySelectorAll('#plan-root .day-row[data-day="1"] .slot-meal')].map((e) => e.textContent));
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
    await drag('#plan-root .slot-card[data-day="1"][data-slot="breakfast"]', '#plan-root .slot-card[data-day="1"][data-slot="lunch"]');
    const n1 = await names();
    if (n0[0] !== n1[1] || n0[1] !== n1[0] || n0[0] === n0[1]) {
      const t = await page.textContent('.toast');
      if (!/Can.t do that/.test(t)) throw new Error('drag neither swapped nor refused: ' + n0 + ' -> ' + n1 + ' ' + t);
    }
    if (await page.locator('#day-view:visible, .day-sheet:visible').count()) throw new Error('a drop opened the day view');
    await page.evaluate(() => { document.querySelector('#plan-root .slot-card[data-day="3"][data-slot="lunch"]').focus(); });
    const n2 = await page.evaluate(() => document.querySelector('#plan-root .slot-card[data-day="4"][data-slot="lunch"] .slot-meal').textContent);
    await page.keyboard.press('Alt+ArrowDown');
    const f = await page.evaluate(() => document.activeElement.dataset.day + document.activeElement.dataset.slot);
    if (f !== '4lunch') throw new Error('focus not kept on the moved slot: ' + f);
    await page.evaluate(() => document.querySelector('#plan-root .slot-card[data-day="1"][data-slot="lunch"]'));
    const d1 = await page.textContent('#plan-root .day-row[data-day="1"] .slot-card[data-slot="dinner"] .slot-meal');
    const d2 = await page.textContent('#plan-root .day-row[data-day="2"] .slot-card[data-slot="dinner"] .slot-meal');
    await drag('#plan-root .day-row[data-day="1"] .day-grip', '#plan-root .day-row[data-day="2"] h3');
    const e1 = await page.textContent('#plan-root .day-row[data-day="1"] .slot-card[data-slot="dinner"] .slot-meal');
    if (d1 !== d2 && e1 === d1) { const t = await page.textContent('.toast'); if (!/Can.t do that|Swapped days/.test(t)) throw new Error('day drag neither swapped nor refused: ' + t); }
    await page.click('#plan-root .slot-card[data-day="5"][data-slot="lunch"]');
    await page.waitForSelector('.day-swap-btn');
    await shot('plan-drag');
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
    await page.click('#plan-root .slot-card');
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
    await page.click('#swap-sheet .cooknow-place');
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
    await page.waitForSelector('#shopping-root .shop-line, #shopping-root li', { timeout: 8000 });
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
    await page.reload(); await page.waitForSelector('#library-grid .card');
    await page.fill('#library-search', 'chicken rice');
    await page.waitForTimeout(300);
    const bad = await page.$$eval('#library-grid .card', cs => cs.length);
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
  await step('no uncaught page errors during the walk', async () => { if (errs.length) throw new Error(errs[0]); });
  await ctx.close();
}
await browser.close(); srv?.close();
console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
