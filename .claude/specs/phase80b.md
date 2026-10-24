# Phase 80b: Log anything — the app shows off-plan food [M]
Plain: anything you logged off-plan through the assistant shows on the Plan page's Today card and counts in "Last 7 days". A library meal you ate that wasn't on the plan is now recorded instead of being turned away.

Requires Phase 80a (`GET /food-log`, KV `foodLog`, `Nutrition.foodAsEaten`, `food-log.json`). Shared decisions live
in `.claude/specs/phase80a.md`.

## Decisions
- **User-chosen: no log box in the app.** The app only reads `foodLog`.
- **Mirror**: `MP.Sync.fetchFoodLog()` (`hermes-sync.js`) does a GET of `/food-log` into localStorage `mp_foodLog`
  (read-only, never pushed). It runs on Plan page load and in the same sync tick as `syncEatRequests` (l.~767).
  With sync off or offline it keeps the last mirror.
  `MP.Sync.localFoodLog()` returns its `entries`, or `[]`.
- **Gap strip** (`plan.js` `renderGapStrip`, l.~742): the log becomes `mp_eatenLog` plus each `kind !== "stock"`
  food entry mapped through `MP.Nutrition.foodAsEaten(e, targets, foodData.tagShare)`. No other change to
  `weekGaps`. `food-log.json` loads with `MP.Nutrition.load()` (add it to that `Promise.all` as `foodLog`, returning
  `{ tags, targets, foodLog }`). Every caller of `load()` destructures, so the extra field is safe: grep to confirm.
- **Today card**: a short "Also eaten" list of today's off-plan entries (name, grams, `~` before estimated grams,
  "some nutrients unconfirmed" when there are any), inside the existing Today card render (`renderTodayCard`).
  Names go through `esc()`.
- **Eat-requests off-plan**: in `matchEatRequests` (`plan.js` l.~1677), a library meal with no matching slot on that day
  (`not-planned`, or the request's date is outside the plan) goes to a new `offPlan` list instead of `rejected`.
  `applyEatRequests` applies it through the same cook branch (an open cook means a portion, else
  `eatPlan`/`applyCookOps` then `MP.Cooks.open`) and `logPortion`, with no slot written. The idempotency guard is
  that a `mp_eatenLog` id `${mealId}:${eatenAt}` already present means `eaten`. `unknown-meal` stays rejected (the
  assistant uses `POST /food-log` for those). The banner shows an "Logged off-plan:" list. Update the
  `applyCookOps` comment ("Only commitCook and applyEatRequests' cook branch call it") only if wording changes.
- `sw.js`: add `food-log.json` to the cached files, bump `CACHE`.

## Files touched
- `hermes-sync.js`: `fetchFoodLog`, `localFoodLog`, the sync-tick call.
- `nutrition.js`: `load()` also fetches `food-log.json`.
- `plan.js`: `renderGapStrip`, `renderTodayCard`, `matchEatRequests` (+ `offPlan`), `applyEatRequests`, `eatBannerHtml`.
- `style.css`: only if the "Also eaten" list needs a rule; reuse the existing Today card list classes first.
- `test.html`: `matchEatRequests` off-plan cases and `foodAsEaten` in the gap strip maths.
- `sw.js`: cache list + `CACHE` bump.
- Pages: `plan.html` already loads `hermes-sync.js` and `nutrition.js` before `plan.js`; there's no new script, so no
  include change (grep to confirm).

## Edge cases
- An empty or malformed `mp_foodLog`: treated as `[]`, no throw.
- `kind: "stock"` entries never show or count.
- An off-plan request replayed: the second one is `eaten`, and the pantry deducts once.
- An off-plan request for a day outside the plan: applied off-plan, not rejected.
- An entry with `nutrients: {}`: listed in "Also eaten" as having no nutrient data, and adds no tags.

## Verification
- `python3 check.py` (test.html: `matchEatRequests` puts not-planned library meals in `offPlan`, keeps unknown-meal
  rejected, and a replay is `eaten`; ui pages + walk at PC and phone widths, dark and light).
- `node tools/browser-check/ui-check.mjs --theme-key mp_theme --shots out/`, run with a seeded `mp_foodLog`
  fixture: the Today card shows "Also eaten" and the gap strip counts it. No real credential needed.

## Tasks
### Logic (TDD, test.html)
- [x] `matchEatRequests` `offPlan` + replay guard
- [x] `applyEatRequests` off-plan apply (portion or cook, no slot)
- [x] `fetchFoodLog`/`localFoodLog` + `Nutrition.load` `foodLog`
### UI (`ui-build` skill)
- [x] Gap strip includes food entries
- [x] Today card "Also eaten" list, both themes, 390 px
- [x] Banner "Logged off-plan" list
- [x] `sw.js` cache list + bump
