# Phase 108: Phone-first polish, simple and animated [L]
Plain: Every page looks calmer and moves smoothly on a phone: a bottom tab bar, bigger buttons, sheets you drag down to close, and soft transitions between pages.

Requires Phase 86 (done: tokens and `.m-*` motion utilities in `style.css`). Build after 94-107 so it polishes their final markup; if any is unbuilt, polish what exists and leave their new elements to inherit the shared classes.

## Decisions
- User chose: polish pass, keep Cork Kitchen (no prototype round, no new look).
- Own call: bottom tab bar at `max-width: 639px` replaces the scrolling top links (top bar keeps brand + theme toggle); PC layout unchanged.
- Own call: page transition is a CSS-only fade/rise on `main` entry (`.m-enter`); no View Transitions API, no router, no dependency.
- Own call: sheets close by dragging down past ~80 px (pointer events, `transform` only), plus the existing close button and overlay tap.
- Own call: simplify by hiding secondary controls behind existing disclosures (`<details>`/sheet), never by deleting a feature.
- Tokens only: new values go in `style.css` `:root`; no raw hex outside the theme blocks. Motion rules in `docs/UI_STYLE.md` apply: `transform`/`opacity` only, one reduced-motion block.

## Files touched
- `style.css`: tab bar, safe-area padding (`env(safe-area-inset-bottom)`), 44 px min tap targets, spacing scale, sheet drag state, page-entry motion.
- `index.html`, `discover.html`, `plan.html`, `plan-with-me.html`, `shopping.html`: same `<nav>` markup, tab bar added identically (grep that all five match).
- `data.js`: `MP.enableSheetDrag(sheetEl, onClose)` shared helper (no `window` use at top level).
- `plan.js`, `discover.js`, `index.js`, `shopping.js`: call it where `.modal-sheet` opens; no logic change.
- `docs/UI_STYLE.md`: Patterns (tab bar, sheet drag), Tokens if any added.
- `sw.js` `CACHE` bump. No Worker change, no `routes.json`.

## Signatures
- `MP.enableSheetDrag(sheetEl: HTMLElement, onClose: () => void): () => void` (returns a detach function; called by every sheet opener).

## Edge cases
- Drag only from the sheet's handle/top edge so inner scroll and swipe-deck gestures still work; scrolled-down sheet never drags.
- Tab bar must not cover the sticky meter strip, toasts or the last list row (bottom padding on `main`); keyboard open on iOS/Android does not float it over inputs.
- `prefers-reduced-motion`: no drag animation or page rise, instant close.
- Both themes, 390 px and 360 px, landscape phone; PC (>=640 px) looks as before.

## Verification
- `python3 check.py` passes (all pages PC + phone, both themes, ui walk).
- `cd tools/browser-check && PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers node ui-check.mjs --theme-key mp_theme --shots out/` and inspect screenshots of every page at 390 px, dark and light.
- No real credential needed.

## Tasks
### Logic (TDD)
- [x] `test.html`: `MP.enableSheetDrag` closes past threshold, snaps back under it, detach removes listeners
### UI (follow `ui-build`)
- [x] Bottom tab bar on all five pages, active tab highlighted, safe-area padding
- [x] Tap-target and spacing pass on every component (nav, cards, chips, forms, slot cards, shop lines, meter, toasts)
- [x] Sheet drag-to-close on every `.modal-sheet` opener
- [x] Page-entry and list stagger motion on each page via existing `.m-*` utilities
- [x] Declutter: move secondary controls into disclosures where a screen shows more than ~5 actions
- [x] Update `docs/UI_STYLE.md`, bump `sw.js` `CACHE`, tick roadmap heading `— done` with what was verified
