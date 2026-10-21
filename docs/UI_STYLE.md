# UI style

The one place the project's UI facts live. `ui-prototyper`, `restyle-from-prototype`, `ui-build` and
`prototype-preview` read this file. Filled from the existing app (no prototype was picked), so
`restyle-from-prototype` will overwrite the matching sections the next time a prototype is applied.

**Status:** from-existing-app (Cork Kitchen theme, `style.css`)

## Paths
- Prototypes dir: `design-prototypes/ui-concepts/` (cork-kitchen*.html is the applied direction; field-ledger and table-edition are alternatives)
- Stylesheet / token file: `style.css` (tokens at the top, `:root` + `[data-theme="dark"]` / `[data-theme="light"]`)
- Page and component sources: plain HTML pages (`index`, `discover`, `plan`, `plan-with-me`, `shopping`, `test`), each with its
  same-named `.js`; shared logic in `data.js`, `generator.js`, `nutrition.js`, `shopping-list.js`. No build step, no framework.
- Shared pieces: `.nav` (sticky top bar, theme toggle `#theme-toggle`), `.empty`, `.banner`, `.toast`, `.modal-overlay`/`.modal-sheet`. Escape
  external text with `esc()` from `data.js`.

## Preview
- Run: `python3 -m http.server 8000`, then `http://localhost:8000/<page>.html`. State is browser `localStorage`, so there is no real data to
  protect. Checks: `python3 check.py ui` (every page, PC and phone, both themes), `prototype-preview` for screenshots, and the tester also runs Edge on Windows.
- Pages worth checking: index, discover, plan, plan-with-me, shopping, test.html (the pass/fail count).
- Themes: `data-theme="dark"` (default) or `"light"` on `<html>`, applied by `MP.initTheme` and the toggle button.
- Phone width to check: 390. Mobile-first single column; `@media (min-width: 640px)` widens grids.

## Tokens
Warm corkboard backdrop, paper cards, terracotta and sage accents.

| role | token | dark / light |
|---|---|---|
| background | `--bg`, `--bg-2` | `#1c1410`, `#26190f` / `#6b4f3a`, `#7a5c44` |
| surface | `--surface`, `--surface-alt` | `#241a13`, `#2c2018` / `#fdf6ec`, `#f7ecda` |
| text | `--text`, `--text-dim` | `#f3e6d4`, `#c9b79f` / `#2b1d14`, `#6b5847` |
| accent | `--accent`, `--accent-2`, `--butter` | `#d4633b`, `#7a9a6b`, `#e8b74a` / `#d4633b`, `#5c8a4c`, `#e8b74a` |
| danger | `--danger` | `#ff6b4a` / `#c1421a` |
| border, shadow | `--border`, `--shadow` | `#4a382b`, `rgba(15,9,5,.45)` / `#e3d3ba`, `rgba(43,29,20,.18)` |
| radius | `--radius` | `18px` cards; `.8rem` buttons and toasts; `999px` pills |
| font | body | "Segoe UI Rounded", Nunito, "Trebuchet MS", system-ui, sans-serif; weights 700-800 for buttons, tags, nav |

Known gap: a few literals sit outside the tokens (`.btn:hover` `#b94f2c`, the nav active glow, white on accent). Move them into tokens
when next touched, do not add more.

## Motion
- Presses and hovers 150-200 ms (`translateY(-1px)`, `scale(.95)` on active); theme change fades background and colour over .4 s.
- Cards rest at a slight random tilt (`--r`) and lift flat on hover with an overshoot curve `cubic-bezier(.2, .9, .3, 1.4)`, .35 s.
- Plan slots stagger in with `mp-slot-in` (220 ms, 6 px rise). Swipe/fan cards use transform transitions, none while dragging.
- Every animation sits behind `prefers-reduced-motion: reduce` (see the `mp-slot-in` block). `transform` and `opacity` only.

## Patterns
- Nav: sticky translucent bar, pill links, active link filled with `--accent`, round icon buttons.
- Cards: paper surface, image on top, `.card-body`, `.card-actions`, uppercase `.tag` chips; grids are one column, widening at 640 px.
- Sheets: bottom `.modal-sheet` over a dark overlay; confirmations and undo via `.toast`.
- Status: colour plus text (`--danger`, `--accent-2`, `--butter`), `.banner` / `.hermes-banner` for notices; empty states use `.empty`.
- Plan screens: `.week-block`, `.day-row`, `.slot-card`; shopping uses `.shop-block` / `.shop-line`.

## Component sources
Swipe deck, fan and filmstrip are original to this project (prototypes `cork-kitchen-swipe-*.html`). Nothing is adapted from a library.
