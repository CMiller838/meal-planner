# Phase 104: Portion and leftover adjust [M]
Plain: when you log a meal from Browse you can set how big your portion was (half to double), and for a batch meal tap "Keep the rest" to save the whole portions you didn't eat as leftovers.

Requires: Phase 92 (done: Browse Eat row, `MP.Sync.logPortion`). No pantry, generator or KV-key change; one Worker validator change.

## Decisions
**User-chosen (2026-10-27)**
1. **Log-time only.** The size slider sits in the Browse Eat row (`app.js openEatRow`). No "Logged today" edit list; a wrong entry is fixed by the existing paths, not edited.
2. **Honest-partial coverage.** An eaten entry with `portion < 1` counts as *partial* for its nutrients and its protein grams scale. `portion >= 1` counts fully for tags; protein grams scale both ways. Coverage stays a low/med/high checklist, not gram maths.
3. **"Keep the rest" = whole portions only.** Offered only when it leaves at least one whole portion; fractions are never saved to Cooks.
**Own calls**
- The existing 1-6 count stepper stays (n entries). New slider = size of each: 0.5-2, step 0.25, default 1, shown as `0.5×`. Each of the n entries carries `portion` (field written only when size != 1, so every old caller and old entry is unchanged).
- Tags are frozen on the entry at log time already (`logPortion` reads `tagsForMeal`), which is the "re-freeze at log time" rule; nothing else is stored.
- Keep the rest: shown only when `MP.isBatch(meal)` and `rest = floor(servings - n * size) >= 1`. A checkbox "Keep the rest (N portions)" in the row, unticked by default. On Log it calls `MP.Cooks.open(meal, null, rest)`. No pantry deduction: you are keeping food already cooked, not cooking (ingredients are not touched, `commitCook` stays the only pantry writer). Phase 92's "never touches Cooks" becomes "touches Cooks only on that explicit tick".
- **Cooks must be reachable from `index.html`**: `MP.Cooks` lives in `plan.js` (not loaded on Browse). Extract the block (`plan.js` ~43-138, `LS_COOKS`, `cooksAll`...`MP.Cooks = {...}`) verbatim into a new `cooks.js`; it needs `shelfData`, so add `MP.Cooks.setShelf(sd)` (default null = never prune on age, the module's existing fallback) and have `plan.js` call it where it loads `shelfData`. Loaded by `plan.html`, `test.html` and `index.html`, always before `plan.js`/`app.js` and after `data.js`; in `sw.js` list. Grep `*.html` for pages loading `hermes-sync.js` (it calls `MP.Cooks.all()` guarded by `if (MP.Cooks)`): no new hard dependency.
- Protein per portion = `dayCoverage([meal], tags, targets).proteinGramsApprox` (the same approximation as today).

## Files touched
- `cooks.js` (new; name checked free): the extracted Cooks block + `setShelf`.
- `plan.js`: remove the block, call `MP.Cooks.setShelf(shelfData)` after shelf data loads. Existing `MP.Cooks.*` call sites unchanged.
- `hermes-sync.js` (`MP.Sync.logPortion`): add `size` param.
- `nutrition.js` (`eatenDayCoverage`, line ~103; shimmed for the Worker already): honest-partial. Callers: `plan.js` ~1195, `weekGaps`, Worker `/day`/`/nutrition` (line ~555, ~635); all get it for free.
- `worker/worker.js` `eatenLogError` (line ~1378): add `"portion"` to `ALLOWED_KEYS`, require number in [0.5, 2] when present. `worker/worker_test.mjs`: cases.
- `app.js` `openEatRow`: slider, Keep-the-rest checkbox, call changes. `style.css`/`index.html`: only the row's markup/tokens (`docs/UI_STYLE.md`).
- `sw.js` (add `cooks.js`, bump `CACHE`), `test.html`.
- `CLAUDE.md`: "Cook vs. portion" invariant: Browse Eat may open a Cooks record only via the explicit Keep the rest tick, never the pantry; `eatenLog` entries may carry `portion` (0.5-2).

## Signatures
- `MP.Sync.logPortion(meal, eatenAt, n=1, size=1) → Promise<void>`: `size` clamped to [0.5, 2] and rounded to 0.25; entries get `portion: size` only when size != 1. Consumer: `app.js` Log handler (plan.js callers pass nothing).
- `MP.Nutrition.eatenDayCoverage(entries, byId, tags, targets)`: unchanged signature. Known entry with `portion < 1`: dropped from the `dayCoverage` set, its frozen `tags` join `orphanTags` (partial), `extraProtein += portion * perPortionProtein`. `portion > 1`: stays known, `extraProtein += (portion - 1) * perPortionProtein`.
- `MP.Cooks.setShelf(sd)`: consumer `plan.js` after its shelf fetch. `MP.Cooks.open(meal, variantId, portions)`: existing; new consumer `app.js` Log handler (toast says "kept N").

## Edge cases
- size outside 0.5-2 or NaN: clamped, NaN = 1. Old entries without `portion`: identical to today.
- Orphan entry (meal left library) with a `portion`: ignore the portion (existing orphan path).
- Keep the rest hidden for non-batch and `leftoverOf` meals, and when `floor(...) < 1` (e.g. 2 servings, ate 1.5).
- `mp_cooks` malformed or storage full: `MP.Cooks` already tolerates; log still succeeds, toast omits "kept".
- Worker rejects a `portion` outside range: whole PUT fails 400 (same as other bad keys); the app only ever sends valid values.
- Duplicate ids: unchanged (`logEaten` dedups).
- Meal name with HTML: `esc()`/`textContent` only.

## Verification
- `python3 check.py` (test.html: `eatenDayCoverage` with `portion` 0.5 makes a covered nutrient partial, 1.5 stays covered, protein scales; `logPortion` size clamp and field-only-when-not-1; `MP.Cooks` still passes the Phase 20/43 asserts after extraction; Keep-the-rest maths)
- `node worker/worker_test.mjs` (eatenLogError accepts `portion` 0.5/2, rejects 0.4/3/"1")
- Browser run (`tools/browser-check`, fresh profile, no real credential needed): Browse → 3-serving batch meal → Eat → size 0.5 ×2 → Keep the rest shows 2 → Log: `mp_eatenLog` has 2 entries with `portion: 0.5`, `mp_cooks` has a record `portionsLeft: 2`, `mp_planItems` unchanged; a 1-serving meal shows no Keep the rest; PC and 390 px, both themes.

## Tasks
Logic (TDD)
- [ ] Extract Cooks to `cooks.js` + `setShelf`; `plan.js`/html/`sw.js` wiring; existing Cooks asserts still green
- [ ] `eatenDayCoverage` honest-partial + test.html asserts
- [ ] `MP.Sync.logPortion` `size` + asserts
- [ ] Worker `eatenLogError` `portion` + `worker_test.mjs`
UI (follow `ui-build`)
- [ ] Eat row: size slider with `0.5×` readout, Keep-the-rest checkbox (shown per the rule above), Log handler calls `logPortion(..., n, size)` and `MP.Cooks.open`, toast "Logged 2 × Name (0.5×) — kept 2"
Wrap-up
- [ ] CLAUDE.md invariant edits, `sw.js` CACHE bump, `python3 check.py`
- [ ] Live: on the phone PWA, log half a batch meal with Keep the rest and see the leftover on the Plan page
