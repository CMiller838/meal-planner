# Phase 83: Flexible plan start and length [L]
Plain: start a plan on any day, from any meal, for as many days as you like, with your own shop day.

Requires: Phase 68 (rolling plan, `shopAnchor`, `shopOffset`), Phase 82. Gate-free: all four controls were chosen by the user (2026-10-24).

## Decisions
**User-chosen**: start date, first meal, length, shop day.
**Own calls**
- Generator takes a day count `n` (1 to 28, default 14) in place of the hard-coded 14: `generator.js` lines using `14` (`weekendRuns`, `batchRuns`, `generatePlan` loops, leftover loop) all read `n`. `generatePlan(..., locked)` already receives `startDate`; add `opts.firstSlot` (`breakfast|lunch|dinner|snack`) so day 1 slots before it stay empty.
- Shop day: a weekday `0..6`; `shopAnchor` = the latest date with that weekday on or before `startDate` (offset 0..6 per `shelf-life.js` `shopOffset`). Default unchanged (anchor = start).
- Start is today or later; a future `startDate` is never rolled (`rollPlan` already returns null). Rolling keeps `days.length` when it appends. Plans of 1 to 3 days have no weekend batch runs; fine.
- One-tap Generate keeps today's defaults. A "Customise" disclosure on the Plan setup holds the four controls. They are per-generation overrides, not stored in `mp_planPrefs` (that holds settings only).
- The `isDay` bound (1..14) is lifted to 1..28 everywhere it is hard-coded: `plan-chat.js`, `data.js` (`reflowInputError`, `reflowFromDay` clamp), `day-hints.js`, Worker `planDraft` validation, `hermes-sync.js`.
- `plan.firstSlot` is stored on the plan; `planMirror` (`hermes-sync.js`) must carry it.

## Files touched
`generator.js`, `plan.js` (setup UI, `generatePlan` wrapper, `planDayOf`), `plan-with-me.js` (setup screen), `data.js`, `shelf-life.js` (no change expected; verify offsets), `plan-chat.js`, `day-hints.js`, `hermes-sync.js`, `worker/worker.js` (draft/reflow bound, `GET /ranking` uses generator), `style.css`, `sw.js` (bump `CACHE`), `test.html`, `tools/worker_test.mjs`, `CLAUDE.md` (generator day count, `plan.firstSlot`, shop-day override). The `window`→`root` shim already covers `generator.js`.

## Signatures
- `generatePlan(library, tags, targets, shelfData, startDate, budget, have, prefs, ratings, locked, opts?: { days?: number, firstSlot?: string })`
- `MP.shopAnchorFor(startDate, weekday) -> ISO date`

## Edge cases
`days=1`; first meal dinner on day 1 (nutrition ranking treats the day as partial; coverage must not flag missing breakfast/lunch as a gap); a 28-day plan's pressure/shortlist and batch runs; start date in the past (rejected, use Phase 82); shop weekday equal to the start weekday; the Worker `GET /ranking` for a non-14 plan.

## Verification
`python3 check.py`; `node tools/worker_test.mjs`; unit asserts: default call returns today's 14-day plan byte for byte, Thursday-dinner 10-day plan has no Thursday breakfast or lunch, anchor weekday correct, 28 days generates without error; browser at PC and 390 px both themes. No real credential needed.

## Tasks
Logic (TDD)
- [ ] Generator day count and `firstSlot`, default-output unchanged test
- [ ] `shopAnchorFor`; lift the 14-day bounds listed above
- [ ] Coverage ignores slots before `firstSlot` on day 1
UI (`ui-build`)
- [ ] "Customise" disclosure: date, first meal, length, shop day
- [ ] Live: generate a plan starting Thursday dinner on the phone and check Shopping
