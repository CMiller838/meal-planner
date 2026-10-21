// Smoke-check every page of a static site in a real browser: PC and phone widths, both themes.
//   node ui-check.mjs [--root ../..] [--pages index.html,plan.html] [--theme-key mp_theme] [--shots dir] [--suite test.html]
// Serves --root on a free port (node http, no dependency). Per page x viewport x theme it fails on: a page error or
// console error (network failures are ignored: third-party APIs are blocked in sandboxes), horizontal scroll, an empty
// body, or a theme that did not apply. --suite runs a page that prints "N passed, M failed" (the project's test page).
// --theme-key: localStorage key the app reads its theme from; without it the theme is set as data-theme on <html>.
// Exit 1 on any failure. Browser: BROWSER_CHANNEL=msedge|chrome drives an installed browser instead of the download.
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(arg('root', '../..'));
const pages = arg('pages', fs.readdirSync(root).filter(f => f.endsWith('.html') && f !== arg('suite', 'test.html')).sort().join(',')).split(',');
const themeKey = arg('theme-key', ''), shots = arg('shots', ''), suite = arg('suite', 'test.html');
const VIEWPORTS = { pc: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const THEMES = ['dark', 'light'];
const NOISE = /Failed to load resource|net::ERR|CORS|ERR_|favicon/i;
const { base, close } = await serve(root);
const browser = await chromium.launch(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {});
if (shots) fs.mkdirSync(shots, { recursive: true });
let failed = 0;
const report = (ok, label, why = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${why ? ': ' + why : ''}`); };

if (fs.existsSync(path.join(root, suite))) {
  const page = await browser.newPage();
  await page.goto(`${base}/${suite}`);
  const text = await page.waitForFunction(() => /\d+ passed, \d+ failed/.test(document.body.innerText) && document.body.innerText, null, { timeout: 60000 })
    .then(h => h.jsonValue()).catch(() => '');
  const m = /(\d+) passed, (\d+) failed/.exec(text);
  report(!!m && m[2] === '0', suite, m ? `${m[1]} passed, ${m[2]} failed` : 'no summary found');
  if (m && m[2] !== '0') console.log(text.split('\n').filter(l => l.startsWith('FAIL')).slice(0, 15).map(l => '     ' + l).join('\n'));
  await page.close();
}

for (const [vp, size] of Object.entries(VIEWPORTS)) for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: size });
  if (themeKey) await ctx.addInitScript(([k, t]) => localStorage.setItem(k, t), [themeKey, theme]);
  for (const name of pages) {
    const page = await ctx.newPage(), errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(m.text()); });
    await page.goto(`${base}/${name}`, { waitUntil: 'load' });
    if (!themeKey) await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
    await page.waitForTimeout(700);
    const s = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, len: document.body.innerText.trim().length, theme: document.documentElement.dataset.theme }));
    const why = [errs.length && errs[0].slice(0, 160), s.over > 1 && `horizontal scroll ${s.over}px`, s.len < 20 && 'empty page', s.theme && s.theme !== theme && `theme is ${s.theme}`].filter(Boolean).join('; ');
    report(!why, `${name} ${vp} ${theme}`, why);
    if (shots) await page.screenshot({ path: path.join(shots, `${name.replace('.html', '')}-${vp}-${theme}.png`) });
    await page.close();
  }
  await ctx.close();
}
await browser.close(); close();
console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
