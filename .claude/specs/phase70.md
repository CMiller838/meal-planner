# Phase 70: Live nutrient and cost meter while editing [M]
Plain: a bar strip under the nav shows each week's protein, nutrient gaps and cost, animates when you swap a meal, and a "Fix this gap" button offers the one swap that closes the biggest gap.

Requires: Phase 35 (`weekGaps`, plan-page strips) and Phase 64 (`planMetrics`) built; Phase 69's swap deck is not needed (Fix-this-gap has its own card).

## Decisions
- **Roadmap finding:** the plan page has no coverage bars and no weekly cost today (coverage is text in `coverageHtml`/`.week-summary`; cost exists only in the Phase 64 compare sheet). So this phase builds the meter, then animates it. *(Own call.)*
- **Placement: sticky strip under the nav, both weeks side by side (Wk 1 | Wk 2).** *(User-chosen: sticky.)* Both weeks at once avoids scroll tracking. On 390 px each week is a compact column.
- **Per week:** protein bar (`weekCoverage.proteinGramsApprox` / `proteinTarget * 7`, clamped 0..100%, labelled "approx"), gap count with the first few nutrient names, and `~£` cost. Nothing precise: same low/med/high model, no new scoring.
- **One implementation:** extend `planMetrics` (`plan.js`) to also return `weekCost: [c1, c2]` and `weekGaps: [[nutrient…], [nutrient…]]` (additive: `cost`, `proteinG`, `gaps`, `quickDinners` unchanged so the compare sheet is untouched). The meter calls `planMetrics(plan)`; no second cost or coverage code.
- **Delta render on edit only.** `renderPlan(staged)` calls `renderMeter(staged)`. First render, `staged === true` (Phase 29 reveal) and `prefers-reduced-motion` set values instantly. Any other render compares to the last values held in a module var `lastMeter` and animates only what changed: bar width via CSS `transition`, numbers via a ~400 ms `requestAnimationFrame` count-up. The meter's DOM is built once and its text/width updated in place (never `innerHTML` per render) so unchanged bars do not move. `generator.js` zero diff.
- **Fix this gap = a suggestion card, never an auto-edit.** Target = the week with more gaps (tie: week 1); gap nutrient = first of `weekCoverage.missing` then `partial`. Candidates: for each non-locked, non-leftover, non-eaten **dinner** slot in that week, take `candidatesFor(day, "dinner")` (already runs `rankSlot`: `never` ratings, allergy/never terms and variety guard applied) and reorder with `MP.Nutrition.rankByGap(cands, [nutrient], tags)` (reorder only). Keep the best candidate whose week coverage, recomputed with the swap on a copy of the week's meals, no longer lists that nutrient as missing or partial. If none closes it, the button reads "No single swap closes <nutrient>" and is disabled. Card: "Day N dinner: A → B, closes <nutrient>" with **Swap** and **Not this**.
- **Swap** calls `setSlotMeal` (so it sets `locked`, saves, and `guidedActive` still gates saving) then `renderPlan()`; **Not this** hides the card for that day+meal until the next render that changes the plan. No new storage, no new KV key, no Worker change.
- **Meal ranking rule kept:** nutrition (`rankByGap`) decides the meal; cost is displayed only, never used to pick the fix.
- **Cost n/a:** when `packData` is missing, cost shows "n/a" like the compare sheet.
- **Gym-day:** meter uses base targets (the plan is weekly; gym toggle is for today's eaten strip only).

## Files touched
- `plan.js`: `planMetrics` (+`weekCost`, `weekGaps`), new `renderMeter`, `fixGap`, call from `renderPlan`; reads `candidatesFor`, `setSlotMeal`.
- `plan.html`: `<div id="meter-strip">` above `#gap-strip` (sticky).
- `style.css`: `.meter-strip`, `.meter-bar` (Cork Kitchen tokens, both themes, reduced-motion rule).
- `test.html`: Phase 70 cases. `sw.js`: bump `CACHE` (`data_check.py` fails otherwise).
- `docs/UI_STYLE.md`: one line on the meter pattern. `nutrition.js` unchanged (no shim change); Worker unchanged.
- Cross-file dependency: `plan.js` already loads `nutrition.js`, `exclusions.js`, `generator.js`, `shopping-list.js` on `plan.html`; no new `MP.X` use, no other page needs changes.
- `CLAUDE.md`: add an invariant line: the meter is display-only, animates on edit only, and Fix-this-gap only reorders `candidatesFor` output.

## Signatures
- `planMetrics(pl, ctx) -> { cost, weekCost: [n|null, n|null], proteinG: [a, b], gaps, weekGaps: [string[], string[]], quickDinners }`
- `renderMeter(staged: boolean): void`; `fixGap(): { day, from, to, nutrient } | null`

## Edge cases
- Empty plan or empty slots (no meal): protein 0, all nutrients missing; empty and `eatingOut` slots are skipped by `fixGap`.
- Locked, eaten (`eatenAt`), leftover (`leftoverOf`) and frozen (`frozenFrom`) slots are never swapped by Fix-this-gap.
- Slot with a variant/subs: swapping to a new meal starts a fresh slot (existing `setSlotMeal` rule).
- Rapid swaps mid-animation: new target replaces the running count-up (cancel the frame).
- Reduced motion, first paint, staged reveal: instant values.
- Bad input: plan with unknown mealId is ignored by `planMetrics` (already skips missing meals).
- Sticky strip must not cover the day-view overlay or the swap sheet (z-index below `#swap-overlay`).

## Verification
- `python3 check.py` passes (data_check cache bump, test.html assertions, ui pages at PC/phone in both themes, ui walk).
- test.html: `planMetrics` week arrays sum to the existing `cost`; `fixGap` never returns a meal with a `never` rating or an allergy term, never a locked/leftover slot, and the returned swap really removes the nutrient from the week's missing/partial; reorder-only (same candidate set as `candidatesFor`).
- Browser (`node tools/browser-check/ui-check.mjs --theme-key mp_theme --shots out/` plus a Playwright walk): swap one dinner and only that week's affected bars/numbers change (other week's DOM text and width untouched); staged generate shows no count-up; at 390 px both weeks fit without horizontal scroll.
- No real credential needed.

## Tasks
### Logic (TDD)
- [ ] `planMetrics`: add `weekCost`, `weekGaps`; test they reconcile with `cost`/`gaps`.
- [ ] `fixGap`: pick week, nutrient, best closing dinner swap via `candidatesFor` + `rankByGap`; tests for exclusions, locks, no-fix case.
### UI
- [ ] `#meter-strip` markup, CSS bars and tokens, both themes, reduced-motion.
- [ ] `renderMeter` with `lastMeter` delta (build DOM once, update in place, count-up, cancel on re-entry).
- [ ] Fix-this-gap button + suggestion card (Swap / Not this), wired to `setSlotMeal`.
- [ ] Bump `sw.js` `CACHE`; `docs/UI_STYLE.md` line; `CLAUDE.md` invariant line.
- [ ] Live: on the phone PWA, swap a dinner from the plan page and watch the bars and £ move; tap "Fix this gap" and take the swap.
