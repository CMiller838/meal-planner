# Phase 59: Freezer-aware batch planning [L]

Plain: When you cook a big batch, the plan freezes the spare portions and brings them back as a later dinner (with a "defrost tonight" reminder the evening before), instead of forcing every portion into the next three days.

Requires Phase 43 (built, live checks pending: `storageFor`, `leftoverEatBy`, `MP.Cooks.freezeOne`, `cooked_leftovers.frozenMonths`).

## Decisions
- **User: freezing is a plan setting plus a per-meal opt-out.** `mp_planPrefs` gains `freezeBatches` (boolean, default `true`, absent = true); `meals.json` meals may carry `"freezable": false` (absent = freezable). Both must allow it. This widens the `mp_planPrefs` invariant in CLAUDE.md from `{updatedAt,busyDays,chips,budgetTarget}`: update that line when building.
- **User: slot marker.** A frozen portion is an ordinary dinner slot `{ mealId, frozenFrom: <cookDay> }`. No second structure.
- **User: defrost note on plan card and Today.** Derived at render, never stored.
- **Own call: nutrition still decides the meal.** Freezing only decides where an already-chosen batch's spare portions land (`generator.js` placement step, after `pickMeal`). `rankByGap`/`rankSlot` are not touched.
- **Own call: spare = `servings - coverage`.** Today the fridge run covers `min(run.length, servings, cooked_leftovers.fridgeDays)`; the rest were silently dropped. Each spare portion (cap 2) goes to the earliest unfilled dinner day `>= cookDay + 5` and `<= 14`. No free day: that portion is not frozen (never displaces a placed meal).
- **Own call: frozen portions have no shelf-life warning** (frozen shelf life is months; 14 days is far inside `frozenMonths`).
- **Own call: no extra shopping or pantry.** A frozen slot adds no ingredients to `buildLists`; the pantry is still deducted once at `commitCook`.
- **Own call: cook-time freezing.** `commitCook` moves the planned number of portions to the freezer via `MP.Cooks.freezeOne` (cooks only; pantry never touched).

## Files touched
- `generator.js`: after the batch-run loop (~line 300-325), place frozen slots via `place()` then add `frozenFrom` (extend `place`'s slot literal). Read `prefs.freezeBatches` and `meal.freezable`. Already has the `window`→`root` shim (Worker imports it).
- `shelf-life.js`: `evaluateSlot` returns `null` when `slot.frozenFrom`; new `defrostNotes(plan, mealsById)`. Has the shim.
- `shopping-list.js` (line ~259 batch dedupe): skip slots with `frozenFrom` when summing ingredients. Has the shim.
- `plan-with-me.js` (`MP.PlanPrefs` get/save, ~lines 15-40): add `freezeBatches`; `hermes-sync.js` `pushPlanPrefs`/`fetchPlanPrefs` (~line 370) carry it; `worker/worker.js` `/planPrefs` validation (grep the route, accept a boolean).
- `hermes-sync.js` `planMirror` (~line 306): whitelist `frozenFrom` (it strips unknown fields).
- `plan.js`: plan-card marker and defrost note (near line 755 `day-slot-note`), Today card (`renderTodayCard`, line ~301), `commitCook` freezing (~line 926-944), a "Freeze spare portions" toggle in the plan setup / prefs UI.
- `meals.json`: set `"freezable": false` on any meal that does not freeze (review the 16 batch meals).
- `style.css`, `sw.js` (bump `CACHE`), `test.html`, `docs/roadmap.md`, `tasks.md`, `CLAUDE.md` (planPrefs invariant).
- No new cross-file dependency between `<script>` modules.

## Signatures / schemas
- slot: `{ mealId, frozenFrom?: number /* cook day 1-14 */, variantId?, subs? }`
- `MP.PlanPrefs`: `{ updatedAt, busyDays, chips, budgetTarget, freezeBatches }`; `save(busyDays, chips, budgetTarget, freezeBatches)`
- `MP.ShelfLife.defrostNotes(plan, mealsById) -> { [day]: [{ mealId, forDay }] }` (note on day `forDay - 1`)

## Edge cases
- Cook day busy/moved, user swaps the parent: `frozenFrom` points at a day that no longer cooks that meal. `defrostNotes` and the card only trust it when that day still holds the same `mealId`; otherwise treat as a plain slot.
- Hermes/user `PUT /plan` placements without the field are unaffected.
- Plan shorter than cookDay+5, or all later dinners filled: no frozen slot, no error.
- `freezeBatches` false or `freezable:false`: output equals today's plan (regression check).
- Eating a frozen portion goes through `eatPortion` only; it must never call pantry code.
- Defrost note on day 1 for a frozen slot on day 2 is impossible by the +5 rule; a user-moved slot just gets no note when `forDay - 1 < 1`.

## Verification
- `python3 check.py`
- `node --test`-style assertions added to `test.html`: a 4-serving freezable batch on a Monday-start plan yields frozen slots `>= cookDay + 5` with `frozenFrom`; none with `freezeBatches:false` or `freezable:false`; `evaluateSlot` is null for frozen slots; `buildLists` totals unchanged by frozen slots; `planMirror` keeps `frozenFrom`.
- `node tools/worker_test.mjs` (planPrefs accepts `freezeBatches`).
- Drive the plan page and Today in a fresh profile at PC and 390 px, both themes (`prototype-preview`, `ui-build`).
- No real credential needed.

## Tasks
Logic (TDD)
- [x] `defrostNotes` + `evaluateSlot` frozen skip in `shelf-life.js`, tests first
- [x] generator frozen placement, `freezeBatches`/`freezable` gates; no-freeze plan identical to before
- [x] `buildLists` skips frozen slots; `planMirror` whitelist; PlanPrefs + Worker route field
- [x] `commitCook` freezes planned portions through `MP.Cooks.freezeOne`
UI (`ui-build`)
- [x] Plan card "Frozen portion of day N" marker and "Defrost tonight" note; Today card note the evening before
- [x] "Freeze spare portions" toggle in plan setup; bump `CACHE` in `sw.js`
- [ ] Live: `- [ ] Live:` in `tasks.md`: in the installed phone PWA generate a plan with chilli, confirm a frozen dinner 5+ days later and the defrost note on Today the evening before
