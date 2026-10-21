---
name: prototype-preview
description: Actually open and interact with a UI page in a real browser (Playwright) instead of only reading its HTML/CSS source. Navigates to a local prototype .html file or a running dev-server URL, optionally expands `<details>` disclosures and clicks elements, takes a screenshot, and reports console and page errors. Use whenever asked to "check", "test", "verify", "look at" or "screenshot" a page, whenever about to claim a UI change works without having seen it render, and always as the verification step after ui-prototyper or restyle-from-prototype touches pages. Don't leave "visually verify in a browser" as a follow-up for the user.
---

# Prototype Preview

Reading HTML/CSS tells you what a page *should* look like. It cannot tell you whether a disclosure actually opens,
whether a click handler is missing, or whether the browser throws a console error. This skill drives a real browser
against the page and reports what happened. Use it instead of asserting that a page "looks right" from source.

## What this covers

`docs/UI_STYLE.md` **Preview** names this project's pages, how to start the real app on temp data, and its themes.

- Any static `.html` file (path) or any `http(s)://` URL the project serves locally.
- For the real app, start it on **temp data and a free port**, never real data, then point the script at it.

## One-time setup

Playwright lives in `tools/browser-check/` (test tooling, kept apart from the app's dependencies). If `node_modules/`
or the browser build is missing:

```bash
cd tools/browser-check
npm install
npx playwright install chromium
```

If the global browser cache is read-only (sandboxes), keep the browser local instead:

```bash
export PLAYWRIGHT_BROWSERS_PATH="$(pwd)/.browsers"
npm install --cache "$TMPDIR/npm-cache"
npx playwright install chromium
```

`playwright install --with-deps` needs sudo; plain `install chromium` usually works without it. To drive an installed
system browser instead of a download, set `BROWSER_CHANNEL=msedge` (or `chrome`).

## Running a check

```bash
cd tools/browser-check
node check.mjs <url-or-file> \
  --expand "details" \
  --screenshot /path/to/out.png \
  --text "h1,main"
```

- `<url-or-file>`: an `http(s)://` URL, or a path to a local `.html` file (relative paths resolve against your
  current shell directory).
- `--expand`: comma-separated selectors; every matching closed `<details>` gets its `:scope > summary` clicked open.
- `--click`: comma-separated selectors clicked in order, for anything that isn't a `<details>` (buttons, links,
  dialog triggers).
- `--screenshot`: PNG output path (viewport-sized). Read it back with the Read tool and actually look at it.
- `--text`: comma-separated selectors; their `innerText` after all interactions is returned in the JSON, so you can
  confirm specific content is present without eyeballing the screenshot.
- `--wait`: milliseconds to pause after load before interacting (default 0; only for pages that do async work on
  load).

The script prints one JSON object: `{ url, title, texts, consoleErrors, pageErrors }`. Treat any non-empty
`consoleErrors` or `pageErrors` as a real finding, not noise, and report it.

## Reading a screenshot

`--screenshot` only writes a file. Always follow up with the Read tool on that path before telling the user something
renders correctly. A headless browser may lack an emoji font, so emoji icons can show as empty boxes: that is an
environment gap, not a page defect.

## Checking every page at once

After a shared CSS/component change, loop over all pages and just check for errors rather than screenshotting each:

```bash
cd tools/browser-check
for page in ../../path/to/pages/*.html; do
  node check.mjs "$page" --expand "details"
done
```

Take individual screenshots only for pages you actually need to see. For responsive checks, view the key pages at a
desktop and a phone width (edit the viewport in `check.mjs` for that run) and in each theme the project ships.

## Meal Planner notes

- Pages: see **Preview** in `docs/UI_STYLE.md`. Themes are `localStorage.mp_theme` = `dark` | `light` (read by `getTheme` in `data.js`).
- `python3 check.py ui` already runs `test.html` and every page at PC and phone in both themes; use this skill for
  screenshots (`node ui-check.mjs --shots dir`, `node walk.mjs --shots dir`) and one-off interaction.
- TheMealDB and Hermes are blocked in the sandbox: Discover renders empty there. Expected.
