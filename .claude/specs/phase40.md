# Phase 40: Cooking mode data: steps, timers and a confirm-cook route [M]

Requires Phase 32 (done). Assistant side: `notion_assistant` Phase 57.

## Decisions
- **Mixed sourcing (user-chosen):** a method is hand-written in the meal form, or *drafted* by the assistant (researched) and
  shown as "drafted" until the user taps Accept. Both coexist per meal.
- **Seeding (user-chosen):** the 14 meals in `meals.json` get AI-split steps with researched times, status `drafted`. The
  builder must confirm each time/step with its own research (WebSearch, standard mode) and note sources in the commit body.
- **Confirm-cook = the existing `/eat-requests` queue (own call, contradicts roadmap):** the Worker cannot run `commitCook`
  (browser code; pantry lives in localStorage). The assistant `PUT /eat-requests` and the app's `applyEatRequests` cook
  branch deducts via `eatPlan`. Id `mealId:eatenAt` already makes it idempotent. **No new confirm-cook route; no Worker
  pantry write.** `commitCook`/`applyCookOps` stay the only pantry writers.
- **Data shape (own call):** meal gains `method: [{ text, minutes? }]` and `methodStatus: "drafted" | "accepted"`
  (absent method = none; hand-written saves as `accepted`). `instructions` stays untouched as the fallback text.
- **Assistant write (own call):** new narrow `PUT /meal-method` (assistant-allowed), because `PUT /library` is append-only.
  Body `{ mealId, method }`. The Worker forces `methodStatus: "drafted"`, 409s if the meal's status is `accepted`, and never
  touches any other meal field.

## Files touched
`meals.json` (seed methods), `data.js` (`MP.methodOf(meal)` normaliser; seed-merge check), `app.js` (step editor in meal form,
Drafted badge + Accept/Edit in the meal sheet), `plan.js` (detail sheet shows steps if present), `worker/worker.js`
(`GET /meal/:id/method`, `PUT /meal-method`, allowlist prefix match, validator), `style.css`, `sw.js` (bump `CACHE`),
`data_check.py`, `docs/ARCHITECTURE.md` (one line), `docs/roadmap.md`.

## Signatures / schemas
- `MP.methodOf(meal) -> { status: "accepted"|"drafted"|"none", steps: [{text, minutes|null}] }`
- `GET /meal/:id/method -> { mealId, name, status, steps, ingredients:[{key,qty}] }` (ingredients always, so a `none` meal
  falls back to the ingredient list). 404 unknown meal; library read from KV as `shopping()` does.
- `PUT /meal-method { mealId, method }` -> 200 `{ mealId, status:"drafted" }`. Validate: 1-30 steps, `text` non-empty string
  <= 300 chars, `minutes` absent or integer 1-600, no other keys.
- `ASSISTANT_ALLOWED` is exact-match: add `"PUT /meal-method"`, and match `GET /meal/<id>/method` by regex before the check.

## Edge cases
- Existing users' library copies may not pick up new `meals.json` fields: builder checks how seeds merge in `data.js` and adds
  a one-time fill of `method` only where the library meal has none (never overwrite an edited or accepted method).
- Editing a drafted method by hand makes it `accepted`. Accepting syncs through the normal `saveLibrary` path.
- Meal with variants: `variantId` instructions stay as is; method applies to the base meal only (state in UI: no variant steps).
- Steps are untrusted text: `esc()` in every `innerHTML`. Worker rejects non-string/oversized steps.
- Hard exclusions (no mushrooms, no standalone egg, no veg in toasties): seeded/drafted steps must not introduce them.
- `GET` for a meal with `none` returns 200 with empty steps, not 404.

## Verification
- Confirm-cook twice: two identical queue entries (same id) and a replay after `eatenAt` is set -> one pantry deduction,
  second reported as `eaten`/duplicate. Partial-ingredient leftover remainders (Phase 31) still recorded.
- `PUT /meal-method` on an accepted meal -> 409; ASSISTANT_TOKEN cannot reach any other new write; bad bodies -> 400.
- Every seeded meal has steps; every `minutes` is plausible and sourced; no excluded ingredient appears.
- `python3 check.py`; UI via `ui-build` at PC and 390 px, both themes.

## Tasks
Logic (TDD)
- [x] `MP.methodOf` normaliser + test.html cases (none / drafted / accepted / bad shape)
- [x] Worker `GET /meal/:id/method`, `PUT /meal-method`, allowlist prefix match, validator; worker test cases incl. 409/400/403
- [x] Seed-merge fill for `method` without overwriting edits
- [x] Confirm-cook idempotency test through `matchEatRequests`/`applyEatRequests` (duplicate id + already eaten)
- [x] Seed `meals.json` methods (drafted), each step/time researched and checked; note sources in commit body

UI
- [x] Step editor (add/remove/reorder, optional minutes) in the meal form; save marks `accepted`
- [x] Drafted badge + Accept / Edit in meal sheet; steps list in plan detail sheet (`esc()`)
- [x] Bump `sw.js` `CACHE`; mark roadmap Phase 40 `— done` with what was verified
