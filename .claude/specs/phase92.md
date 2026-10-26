# Phase 92: Eat from Browse [M]
Plain: tap any meal or snack in Browse, press Eat, choose how many portions (and optionally when), and it is logged for your nutrition; if it's today's planned meal, the plan ticks it too.

Requires: nothing unbuilt. Reuses Phase 80-82 pieces (`logPortion`, eaten log, `backfillSlot` rules). Not a free-text logger: off-plan food that isn't in the library already goes through `POST /food-log` (Hermes) and the Plan page's "Food log" sheet.

## Decisions
**User-chosen (2026-10-26)**
- Eat from Browse is log-only, **unless it lines up with today's plan**, then that plan slot is marked eaten too.
- The Plan page already lets you open a slot and press Eat (day sheet `.day-eat-btn`, detail `Eat this`, `plan.js:1552`/`1516`); that stays as is (it also deducts the pantry via `commitCook`). No change there.
**Own calls**
- Browse Eat never touches the pantry or `MP.Cooks` (portion-eat invariant): it is "I ate this", not "I cooked this".
- Portions = 1-6, logged as **one eaten-log entry per portion** (no new field, no nutrition change; coverage stays a checklist).
- Time defaults to now; a native `<input type="datetime-local">` allows backdating (max = now; no future).
- Plan tick: only when the chosen time falls on today (London date), the plan has an uneaten, non-eating-out slot with this `mealId` today, and then only the first portion ticks it (`eatenAt`); remaining portions are plain entries. Past/other days: no tick (Phase 82 backfill owns that).
- Entry point: the Browse meal detail sheet only (`app.js:271`), next to Rate/Edit/Delete.
- Two taps (Eat opens an inline row, Log confirms) are the mis-tap guard; no separate Undo.

## Files touched
- `hermes-sync.js` (defining file of `MP.Sync`): add `logPortion(meal, eatenAt, n)`; export it. Loaded on `index.html` after `nutrition.js` already; `plan.js` pages load it too.
- `plan.js`: `logPortion` (line ~1761) becomes a one-line call to `MP.Sync.logPortion(meal, eatenAt, 1)`; no other change.
- `data.js` (defining file of `MP.*` plan helpers, already `window`→`root` shimmed): add pure `MP.tickPlanEaten`.
- `app.js`: Eat button + inline portions row in the detail sheet; reads/writes `mp_plan` directly and dispatches `mp:plan-saved` (as `plan.js savePlan` does) so `hermes-sync.js` pushes the mirror.
- `index.html`/`style.css`: only if the row needs markup/tokens (house style: `docs/UI_STYLE.md`, tokens, both themes, PC + 390 px).
- Grep `*.html` for pages loading `app.js` but not `nutrition.js`/`hermes-sync.js` (index.html loads both).
- `sw.js` (bump `CACHE`), `test.html`.
- `CLAUDE.md`: extend the "Cook vs. portion" invariant with one clause: Browse Eat (Phase 92) is a portion-eat via `MP.Sync.logPortion`, may tick a matching plan slot, never touches pantry or Cooks.

## Signatures
- `MP.Sync.logPortion(meal, eatenAt, n=1) → Promise<void>`: loads tags, calls `logEaten` n times; ids `${meal.id}:${eatenAt}` then `...#2`..`#n`. Consumers: `plan.js logPortion` (n=1) and the new Browse handler in `app.js`; both fire-and-forget as before.
- `MP.tickPlanEaten(plan, mealId, todayIso, whenIso) → { plan, day, slot } | null`: pure; first uneaten slot today (by `plan.startDate` + day offset) whose `mealId` matches and is not `eatingOut`; sets `eatenAt = whenIso`. Consumer: the `app.js` handler, which saves `mp_plan` and dispatches `mp:plan-saved` when non-null, and says "plan ticked" in its toast.

## Edge cases
- n out of 1-6 or non-integer: clamped to 1-6. Empty/future datetime: falls back to now.
- No `mp_plan` yet or malformed JSON: log only, no throw. Plan has no `startDate`: no tick.
- Same meal twice today (lunch and dinner): ticks the first uneaten only.
- Duplicate tap within the same ms: `logEaten` dedups by id, so no double entry.
- Offline / Worker off: eaten log is local-first; the push is fire-and-forget as today.
- Meal with `leftoverOf` or batch: still log-only/portion-eat; no Cooks record opened.
- Meal name with HTML: rendered via `esc()`/`textContent` only.

## Verification
- `python3 check.py` (test.html asserts: `tickPlanEaten` ticks first matching uneaten today slot, skips eaten/eatingOut/other days/no startDate, is pure; `MP.Sync.logPortion` writes n entries with distinct ids and never touches pantry storage)
- Browser run (Playwright via `tools/browser-check`, fresh profile, no real credential needed): Browse → open meal → Eat → 2 portions → Log: `mp_eatenLog` gains 2 entries, `mp_planItems`/pantry unchanged; meal in today's plan gets `eatenAt`; backdated entry does not tick; PC and 390 px, both themes.

## Tasks
Logic (TDD)
- [ ] `MP.tickPlanEaten` in `data.js` + test.html asserts (cases above)
- [ ] `MP.Sync.logPortion(meal, eatenAt, n)` in `hermes-sync.js` + asserts (n entries, ids, no pantry write)
- [ ] `plan.js logPortion` delegates to `MP.Sync.logPortion` (its consumer; existing Plan eat paths unchanged)
UI (follow `ui-build`)
- [ ] Browse detail sheet: Eat button, inline row (− n +, datetime-local, Log/Cancel), toast "Logged 2 × Name" (+ "plan ticked")
- [ ] `app.js` handler: clamp, call `MP.Sync.logPortion`, `MP.Prefs.bump(meal,"eaten")` once, `tickPlanEaten` → save `mp_plan` + dispatch `mp:plan-saved`
Wrap-up
- [ ] CLAUDE.md invariant clause, `sw.js` CACHE bump, `python3 check.py`
