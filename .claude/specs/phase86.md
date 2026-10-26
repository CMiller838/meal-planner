# Phase 86: Style and animate every component [L]
Plain: every button, card, sheet, strip and form across the app gets the same polished Cork Kitchen look and a small, consistent animation.

Requires: Phase 85 (Food log view exists, so it is polished with the rest).

## Decisions
**User-chosen (2026-10-25)**: style and animate every component, not a sample.
**Own calls**
- Method: follow `ui-build` and `docs/UI_STYLE.md`. No prototype round and no restyle: the Cork Kitchen direction stays; this fills
  gaps (static components, stray literals), it does not change the look.
- Build the **component inventory** first (Task 1): grep `style.css` (about 157 class selectors) and each page's markup, write it as a
  checklist in this spec's tail section, grouped by page. Done = every line ticked. That list is the scope, so nothing is skipped silently.
- Motion vocabulary: **keep the existing `UI_STYLE.md` Motion rules** (press/hover 150-200 ms, `scale(.95)` active, `translateY(-1px)` hover,
  overshoot lift on cards, `mp-slot-in` stagger) and name them as tokens/classes so every component reuses them: `--motion-base: 180ms`,
  `--ease-lift: cubic-bezier(.2,.9,.3,1.4)`, `.m-enter` (= `mp-slot-in`), `.m-press`, `.m-exit` (fade 120 ms), stagger capped at 8.
  Transform and opacity only.
- One global `@media (prefers-reduced-motion: reduce)` block replaces the three scattered ones; it kills transforms and keeps opacity fades.
- Stray literals (`.btn:hover` `#b94f2c`, nav glow, white-on-accent) move into tokens; no new literal colours.
- Pure CSS plus existing class toggles. No JS animation library, no new dependency (project rule).
- Built and committed one page group at a time (an [L] phase): A shared (nav, banner, toast, sheets, buttons, forms, empty states),
  B plan + Today + Food log, C index + discover, D shopping + plan-with-me.

## Files touched
- `style.css`, `docs/UI_STYLE.md` (Motion section), `sw.js` (bump CACHE per group)
- Page JS only where a component needs a class toggle for enter/exit: `plan.js`, `data.js`, `shopping.js`, `discover.js`, `plan-with-me.js`
- `tools/browser-check/ui-check.mjs` only if a reduced-motion assertion is added (test tooling, not the app)
- `test.html`: no change expected; `CLAUDE.md`: none

## Signatures / schemas
```
:root { --motion-base: 180ms; --motion-exit: 120ms; --ease-lift: cubic-bezier(.2,.9,.3,1.4); }
classes: .m-enter  .m-press  .m-exit  .m-stagger (children get --i via nth-child)
```

## Edge cases
- Reduced motion: no transforms, opacity only, nothing blocks interaction.
- Animations never delay a tap target (enter finishes under 200ms; mid-animation taps work).
- Long lists (shopping, 14-day plan): stagger capped at 8, no animation on re-render of unchanged rows.
- Light and dark both checked; no contrast regression on text over accent.

## Verification
- `python3 check.py` (data_check, ui pages and ui walk at PC and phone, dark and light)
- `node tools/browser-check/ui-check.mjs --theme-key mp_theme --shots out/` from `tools/browser-check`, review screenshots of every page, both themes, 390 px and PC
- Grep gate: `grep -nE "#[0-9a-fA-F]{3,6}" style.css` outside the `:root`/theme blocks is empty
- No real credential needed.

## Tasks
- [x] Component inventory written below and approved by the tester
- [x] Motion tokens, utility classes, single reduced-motion block, `UI_STYLE.md` Motion updated
- [x] Group A: shared components
- [x] Group B: plan, Today, Food log
- [x] Group C: index, discover
- [x] Group D: shopping, plan-with-me
- [x] Stray literals tokenised
- [x] (moved to tasks.md) Live: use the installed phone PWA through all five pages; nothing feels static or janky

## Component inventory (all in `style.css`; one stylesheet serves every page)
- [x] A shared: nav + icon buttons (existing hover/press), `.modal-overlay`/`.modal-sheet`/`.close-btn` (new enter + press), `.toast` (new enter), `.banner`/`.hermes-banner` (new enter), `.empty` (new fade), buttons `primary`/`.btn` (existing, tokenised hover), `ghost`/`.btn-secondary`/`.chip`/`.tab-btn` (new hover/press), inputs/selects/textareas (new focus ring), `:focus-visible` on buttons/links, disabled state
- [x] B plan, Today, Food log: `.slot-card`, `.today-card`, `.tomorrow-card`, `.food-row`, `.leftover-row`, `.meter-strip` already animated (kept; reduced-motion consolidated); `.day-slot`, chips, ghost buttons via shared rules
- [x] C index, discover: cards (lift), `.swipe-card`, `.draft-card`, `.rating-row`, chips/tabs via shared rules
- [x] D shopping, plan-with-me: `.shop-line`, `.useup-strip`, `.chat-*`, `.customise` inputs via shared rules
- [x] Motion tokens `--motion-base/--motion-exit/--ease-lift`; classes `.m-enter .m-press .m-exit .m-stagger` defined (utility; no page JS toggles needed)
- [x] Literals tokenised: grep outside theme blocks empty
