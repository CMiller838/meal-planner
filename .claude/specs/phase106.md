# Phase 106: Eaten, by nutrient [M]
Plain: a new "Eaten" page shows, for today and the last 7 days, how much of each nutrient you actually ate against your target, saying for every number whether it was measured or estimated and how much of your food had data.

Requires: nothing unbuilt (Phases 35, 41, 52, 57, 80 are done/built). Phase 107 later widens the measured foods; this phase must read well with today's 29 mapped ingredients.

## Decisions
**User-chosen (2026-10-27)**
- Planned-meal eats get **estimated** amounts (ingredient qty × CoFID), labelled "estimate", alongside measured food-log amounts. Not "measured only".

**Own calls**
- **App-only, no Worker route.** The app reads its own library and logs (`mp_eatenLog`, `MP.Sync.localFoodLog()`); no KV key, no `ASSISTANT_ALLOWED` change. New pure code lives in a new `eaten.js` (not `nutrition.js`), so no `root` shim and no Worker import. It needs `shopping-list.js` (`parseQty`, `normalizeKey`) loaded before it: only `eaten.html` loads it.
- **Display-only.** Nothing here feeds `rankByGap`, `rankSlot`, the generator or the existing tag-based coverage/gap strip (CLAUDE.md: tagging is a checklist; the estimator is a separate read-only layer, labelled estimate, never "upgraded" into the checklist).
- **Estimator (per planned meal, per serving).** For each meal ingredient: grams = `parseQty(qty)` when unit is `g` (value) or `ml` (value, density 1 g/ml: milk-like only, stated in the row footnote); `each`/`slices` = value × `food-log.json` `itemGrams[normalizeKey(key)]`; anything else (`handful`, `tbsp`, `tins`, free text, structured with unknown unit) = no data. CoFID food = `cofid.map[ing.key].default` → `cofid.foods[id].nutrients` (per 100 g). Amount = Σ grams/100 × nutrient ÷ `meal.servings`. A nutrient missing from a CoFID food is skipped (unknown), never 0. Meal `dataShare` = ingredients with grams **and** a CoFID food ÷ ingredient count. Meal not in the library (orphan) = share 0, all unknown.
- **One eaten-log entry = one serving** (`logPortion` writes one per portion), so a planned entry = the meal's per-serving estimate × 1.
- **Food-log entries** (`MP.Sync.localFoodLog()`, `kind !== "stock"`, have `nutrients: {key: {value, basis}}`) are measured as logged; a missing key is unknown. Their share = known tracked rows ÷ tracked rows.
- **Row basis** = the lowest-precedence basis among contributors using `MP.Products.isEstimate` semantics (`label/off` = "measured", `cofid/usda/estimate` = "estimate"; any planned-meal contributor = "estimate"). If some eaten items contributed nothing to a nutrient, the row says "at least X, N items unknown"; with no contributor at all it says "unknown" (never 0).
- **Salt-only → sodium:** when an entry has `salt_g` and no `sodium_mg`, sodium_mg = `salt_g × 400` (salt ÷ 2.5, ×1000), same basis. Done in `eaten.js`, never written back.
- **Sugars target:** `sugars_g_cap: 90` in `nutrition-targets.json` (total sugars incl. fruit/milk; NHS free-sugar guidance is 30 g, which `addedSugars_g` in Phase 107 will carry). 90 is my number, not from SPEC: add the line to `SPEC.md` "Nutrition targets" and a `- [ ] Live:` to confirm it. `_cap` keys are already ignored by `foodAsEaten`/tag scoring and `sugars` is not in `TRACKED_NUTRIENTS`, so nothing else moves.
- **Targets used:** `Nutrition.withProfile(targets, MP.Sync.settings())`, plus `withGymDay` for **today only** when `MP.Today.get().gym` (same as the gap strip). Week = average per logged day vs the daily target (days with no entries excluded, listed as "not logged", as Phase 35).
- **Water** (Phase 41 counter) shown beside, not scored: today's `MP.Today.get().water` cups of `counters.json` `waterGoal`. There is no water history locally, so the week view shows "today only".
- **Health link:** optional `healthUrl` string in `nutrition-targets.json`; the "Open health page" link renders only when it is a non-empty `https://` string. The URL is not in this repo: left `""`, set via the Live task. Builder must grep every iteration over targets (`Object.entries/values/keys` of targets in `*.js`, `worker/*.js`) and confirm a string value is harmless (`foodAsEaten` only compares keys; check the rest).
- **Placement:** new page `eaten.html`, "Eaten" link in the nav of all six pages. Today/Week toggle, one row per nutrient (bar to target, value, "of target", basis chip), caps (sugars, saturates, sodium) turn warning-coloured when over. House style: `docs/UI_STYLE.md`, `ui-build` skill.

## Files touched
- `eaten.html`, `eaten.js` (new; names checked free), `style.css` (rows, bars, chips; tokens only)
- `nutrition-targets.json` (`sugars_g_cap`, `healthUrl`), `SPEC.md` (sugars line)
- `index.html`, `discover.html`, `plan.html`, `plan-with-me.html`, `shopping.html`: nav link. Grep `*.html` for any other page with `class="nav"`.
- `sw.js` (add `eaten.html`, `eaten.js` to SHELL; bump `CACHE`), `data_check.py` only if it hardcodes a page list (it globs)
- `test.html` (cases below). `tools/browser-check/ui-check.mjs` globs pages, no edit; add an Eaten click-through step to `walk.mjs`.
- `CLAUDE.md`: add one invariant line (below) under Architecture invariants.
- `eaten.html` loads, in order: `data.js`, `prefs.js`, `nutrition.js`, `shopping-list.js`, `products.js`, `hermes-sync.js`, `eaten.js` (`Nutrition.load`, `MP.Today`, `MP.Sync`, `Products.isEstimate`; grep each dependency's `MP.X` use in `eaten.js` against this list before finishing).

## Signatures (no bodies) — `eaten.js`, exported as `MP.Eaten`
- `mealAmounts(meal, cofid, itemGrams, parseQty, normalizeKey) → { per: {nutrient: {value, basis:"estimate"}}, share }`: per serving.
- `entryAmounts(entry, ctx) → { per: {nutrient: {value, basis}}, share }`: planned entry (via `ctx.byId` + `mealAmounts`) or food-log entry (measured, salt→sodium).
- `rollUp(entries, ctx, rows) → { rows: [{key, value|null, basis, unknownItems, over}], share, items }`: one day.
- `weekRollUp(entriesByDate, ctx, rows) → { rows, loggedDays, notLogged }`: daily average vs target.
- `ROWS`: the 17 nutrient keys in display order (data in `eaten.js` as a list of `[key, label, unit, isCap]`, targets stay in the JSON).
- Consumers: `renderEaten()` in `eaten.js` calls `rollUp`/`weekRollUp` and renders the "N% of today's food had data" line from `share`; the Today/Week toggle calls `weekRollUp`. `mealAmounts` is consumed by `entryAmounts` only.

## Edge cases
- No entries today: "Nothing logged yet" (no zeros). Orphan planned entry (meal deleted): counts in `items`, share 0.
- `servings` 0/absent → treat as 1. `qty` structured `{value, unit, raw}` handled by `parseQty` (null = no data).
- Ingredient without a CoFID map key (most of them today): no data, lowers `share`; the line says so honestly ("~30% of today's food had data").
- Food-log entry with `kind: "stock"` excluded. Entries outside the London day excluded (reuse the `Intl.DateTimeFormat("en-CA", {timeZone: "Europe/London"})` day key from `plan.js` `renderGapStrip`).
- All text from the library/food log via `esc()` (data.js) or `textContent`.
- Offline: `cofid.json`/`food-log.json` fetch failure → planned amounts all unknown, food-log amounts still show.

## Verification
- `python3 check.py` (all four lines pass; `data_check.py` confirms the `sw.js` bump).
- `node tools/browser-check/ui-check.mjs --theme-key mp_theme` from `tools/browser-check` (eaten page at PC and 390 px, both themes). No real credential needed.
- New `test.html` cases (the `check.py ui` run covers them): see Tasks.

## Tasks
Logic (TDD, in `test.html`; build and pass these before any UI)
- [ ] `nutrition-targets.json`: add `sugars_g_cap: 90`, `healthUrl: ""`; grep all target iterations are string-safe; `SPEC.md` sugars line.
- [ ] `mealAmounts`: 200 g chicken_breast-style ingredient gives grams/100 × CoFID; `2 slices` white_bread uses itemGrams; `handful` and an unmapped key add no data and lower `share`; `servings: 2` halves; missing CoFID nutrient stays absent (not 0).
- [ ] `entryAmounts`: food-log entry keeps its basis; `salt_g: 2.5` and no sodium → `sodium_mg` 1000; sodium present wins over salt; orphan planned entry share 0.
- [ ] `rollUp`: sums contributors; one non-contributing item → `unknownItems: 1`; no contributor → `value: null`; cap row `over` true past target; basis "estimate" if any planned contributor.
- [ ] `weekRollUp`: averages over logged days only; `notLogged` lists the empty days; gym uplift applied to today only.
UI (`ui-build`)
- [ ] `eaten.html` + `eaten.js` render: Today/Week toggle, 17 rows with bar/value/target/basis chip, "unknown" and "at least X" states, data-share line, water card (today only, not scored), health link only when `healthUrl` is https.
- [ ] Nav link on all pages; `sw.js` SHELL + `CACHE` bump; `walk.mjs` step: open Eaten, toggle Week, assert a row's chip text.
- [ ] Check at PC and 390 px, dark and light, with a fresh profile (empty state) and seeded eaten log + food log; bad input (corrupt `mp_eatenLog`, `cofid.json` blocked).
- [ ] `CLAUDE.md` invariant: "The Eaten page (Phase 106) is display-only: `MP.Eaten` (`eaten.js`) reads `mp_eatenLog`, the local food log, `cofid.json` and `food-log.json` `itemGrams`; planned-meal amounts are always labelled estimates, an absent nutrient is unknown (never 0), and nothing it computes feeds ranking, the generator or the tag-based coverage."
- [ ] Live: confirm the 90 g total-sugars cap is the number you want.
- [ ] Live: give the nutrition assistant's health page URL (set `healthUrl`), then check the link opens it.
