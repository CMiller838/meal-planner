# Phase 64: Three candidate weeks [M]
Plain: A "Compare 3 weeks" button builds a cheapest, a highest-protein and a quickest version of your fortnight, shows them side by side with cost, protein and quick-dinner count, and lets you pick one.

Requires Phase 27 (budget pressure, done) and Phase 35 (done). Does not depend on Phase 66; if 66 lands first, picking a candidate follows whatever `regenerate()` does with locked/eaten slots (same replace path).

## Decisions
- **User: "quickest" = new `prefs.noBatch` switch (option B).** The existing busy knob cannot make a quicker plan: the dinner fill already passes `prefer: "quick"`, and the batch-run pick passes `prefer: "batch"`, which skips the busy layer, so all-busy still cooks weekend batches. `noBatch` skips the batch-run loop in `generatePlan` so every dinner goes through the quick fill. Reorder/skip only: no new scoring, nothing filtered from the pool.
- **User: no cook-minutes column.** No meal carries minutes (`meals.json` 0 of 16, and `mealdb.js` `toMeal` has no source). The third metric is "quick dinners N of 14" from `prepEffort` (`MP.Generator.effortOf`).
- **Own call: cheapest** = `prefs.budgetTarget = 1` (£1/week), so `pressureFor` reads 1 after the first slot and `shortlistSizeFor` widens to `maxShortlist`. Existing knob, no code change. Needs `packData.planning.budgetTarget` config (already present); absent means cheapest equals default and the card says so.
- **Own call: highest-protein** = a prefer chip `{ id:"protein-boost", kind:"prefer", tags:["protein"] }` added to `prefs.chips`/`prefs.vocab.chips` for that one run. Reorders after `rankByGap` via `rankSlot`'s existing chip layer (`chipHits` reads the `protein: "high"` ingredient tags). The chip is defined in `plan-preferences.json` under a new `candidates` key, not in `chips`, so "Plan with me" never lists it.
- **Own call: metrics.** Cost = sum of `costIndex[mealId].cost` over non-leftover slots (the figure the budget layer already compares; label "~£"). Protein = `MP.Nutrition.weekCoverage(...).proteinGramsApprox` per week, shown as "~g (approx)". Coverage = count of missing + partial nutrients per fortnight (`weekCoverage`). All three are existing helpers; the approximate/coverage-checklist model is kept, no fake precision.
- **Own call: where and how.** A secondary button "Compare 3 weeks" beside "Generate Plan" on `plan.html` opens a sheet with three cards (reuse the `swap-sheet` overlay pattern). "Use this plan" does `plan = candidate; savePlan(); renderPlan()` after the same `confirm` as Generate. Closing the sheet changes nothing (nothing is saved until Use). Each candidate runs through the same `generatePlan` closure with a `prefs` override, so exclusions, ratings and profile hard terms apply exactly as for one-tap Generate.
- **Own call: user's own busy days/chips/budget are kept** and the candidate's override is layered on top (cheapest overrides `budgetTarget`; protein adds a chip; quickest sets `noBatch`).

## Files touched
- `generator.js`: `if (!prefs.noBatch)` around the batch-run loop (`for (const run of runs)`, ~line 296). `generatePlan` with `noBatch` unset is byte-identical to today. Also `ponytail:` comment: noBatch trades leftovers for daily cooking; no cook-time model.
- `plan.js`: `generatePlan(override)` takes an optional prefs override merged last (line 133); new `candidateWeeks()`, `renderCompareSheet()`, button handler near line 1207. `plan.js` already loads `plan-preferences.json` vocab into `prefs.vocab`; read `candidates` from the same fetch (`MP.PlanPrefs.loadVocab()` returns the whole JSON).
- `plan-preferences.json`: add `candidates: { cheapest: { budgetTarget: 1 }, protein: { chip: {...} }, quickest: { noBatch: true } }`.
- `plan.html`: the button next to `#generate-btn`. `style.css`: three-column cards (stack at 390 px) using existing tokens/`.slot-card`-style surface; no new colours. `sw.js`: bump `CACHE`.
- `test.html`, `tools/browser-check/walk.mjs`: new assertions and walk step.
- Worker: no change (`generator.js` is shim-safe; `prefs.noBatch` is read the same way in Worker callers and defaults off). No `CLAUDE.md` pinned shape changes (`mp_planPrefs` untouched; override is in-memory only).
- No new cross-file dependency (plan.js already uses `MP.Generator`, `MP.Nutrition`, `MP.ShoppingList`).

## Signatures
```
MP.Generator.generatePlan(..., prefs)   // prefs.noBatch?: boolean  (true: skip batch runs)
plan.js: generatePlan(override?)        // override merged over prefs; default call unchanged
plan.js: candidateWeeks() -> [{ key:"cheapest"|"protein"|"quickest", label, plan, cost, proteinG:[wk1,wk2], gaps, quickDinners }]
plan.js: planMetrics(plan) -> { cost, proteinG:[n,n], gaps, quickDinners }   // pure, exposed for test.html
```

## Edge cases
- Library too small for the three to differ: show them anyway; a card equal to another gets a muted "same as <label>" note (compare serialised `mealId`s), never hidden.
- No `packData` (`budget` null): cost shows "n/a", cheapest equals default.
- Leftover slots (`leftoverOf`) add no cost and no quick-dinner count.
- Slots with `mealId: null` count nothing.
- Excluded meals never appear (the Phase 51/52 hard filters run inside `rankSlot` for every candidate).
- Compare is generation-only: it never writes `mp_planPrefs`, the pantry, or KV. Using a candidate saves `mp_plan` through the normal `savePlan()` (mirror to Hermes as today).
- Guided walkthrough active (`guidedActive`): disable the button.
- Three `generatePlan` runs on a 14-day plan are synchronous; if >300 ms on phone, show a spinner state on the button (check in walk).

## Verification
- `python3 check.py`
- `python3 tools/spec_lint.py phase64`
- `test.html` assertions (add): `generatePlan` with `noBatch` has no batch parent dinner and no leftover slots, and with `noBatch` unset equals the pre-change output; `planMetrics` on a hand-built plan returns the expected cost, protein and quick count; on the seeded library the cheapest plan's cost <= the default plan's, the protein plan's `proteinG` >= default's, the quickest plan's `quickDinners` >= default's (>= not >, a 16-meal library may tie), and at least two of the three differ from default in `mealId` sequence; no candidate contains a mushroom or standalone-egg meal.
- Browser walk (`tools/browser-check`, fresh profile, PC and 390 px, both themes): open Compare, three cards render with all three metrics, close leaves `mp_plan` unchanged, Use this plan replaces it and the page re-renders, no console errors. No real credential needed.

## Tasks
Logic (TDD)
- [ ] `prefs.noBatch` in `generator.js` + `test.html` cases (unset = identical output)
- [ ] `plan-preferences.json` `candidates` block
- [ ] `planMetrics(plan)` + `candidateWeeks()` + test.html assertions
UI
- [ ] "Compare 3 weeks" button and sheet (cards, "same as" note, Use this plan with confirm), both themes, 390 px
- [ ] `sw.js` CACHE bump; `walk.mjs` step
- [ ] Live: on the phone PWA, open Compare on your real library and confirm the three weeks look meaningfully different and "Use this plan" lands on the plan page.
