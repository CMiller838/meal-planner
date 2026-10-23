# Phase 68: Rolling plan [L]
Plain: Your plan always shows the next 14 days: each morning yesterday drops off and a new day is added from what's in your pantry, and you shop every 7 days.

Requires Phase 63 (re-flow) and Phase 66 (lock and fill): both built 2026-10-23, live checks pending. Their code
(`MP.reflowPlan`, `generatePlan`'s `locked` arg) exists, so no fallback is needed.

## Decisions

User-chosen (2026-10-23):
- **Rolling is a toggle, on by default.** `mp_planPrefs.rolling` (boolean, absent = `true`). Off = today's fixed fortnight,
  byte-identical.
- **Shop cadence: every 7 days from the plan's anchor.** No weekday setting. The anchor is the start date of the plan the
  window first rolled from, and it never moves on a roll. A full regenerate (Generate / Plan with me / candidate weeks)
  starts a new anchor (= new `startDate`).
- **The roll runs when the Plan page opens** (and on `visibilitychange` back to visible on that page). Today and Shopping
  stay date-correct without it; the newest day just appears once Plan is opened.

Own calls:
- **The window stays day-numbered 1–14 from `startDate`.** A roll renumbers it. Routes, validators (`day 1-14`), `planDayOf`,
  `reflowFromDay` and the Today view are unchanged. ADR: `docs/ARCHITECTURE.md` "v10 - rolling plan".
- **Shop cadence is one integer.** `offset = days(startDate - shopAnchor) mod 7` (0 when `shopAnchor` is absent).
  `shopDayFor(dayNum, offset) = dayNum - ((dayNum - 1 + offset) mod 7)`. Offset 0 gives day 1 and day 8, so fixed mode and
  every existing caller stay identical. A shop day can be ≤ 0, meaning the cycle's shop happened before the window.
- **A roll is a lock-everything re-generate.** New pure `MP.rollPlan` (data.js, next to `reflowPlan`): shift the kept days
  down, append empty days, call `generate(locked = every kept slot)` (the Phase 66 path) and take only the appended days
  from the result. Pantry `have`, ratings, use-it-up and day hints come in through the existing `plan.js` `generatePlan`
  wrapper, so the new day is "from the current pantry" with no new code.
- **Weeks become shop cycles in the generator.** `halfKeys`/`spent` (`day <= 7` today) are keyed by `shopDayFor(day,
  prefs.shopOffset)`, and `pressureFor`'s day-in-half becomes day-in-cycle. `prefs.shopOffset` is per call (like
  `prefs.useUp`) and never stored. Absent = 0 = today's behaviour.
- **Shopping tick IDs stay stable across rolls.** New `MP.ShoppingList.planLineId(plan, shopDay, key)`. Without `shopAnchor`
  it returns the existing `lineId(startDate, shopDay, key)` (fixed-mode ticks untouched). With one, it returns
  `lineId(<shop date ISO>, 1, key)`, which doesn't change when `startDate` moves. Toggling modes mid-cycle loses that
  cycle's ticks once; accepted.
- **Day-numbered queues are rebased, not dropped blindly.** A pending plan draft carries `startDate`: on apply,
  `day -= days(plan.startDate - draft.startDate)` and changes landing < 1 are ignored ("past"). Placements carry no
  start date: those with `requestedAt < plan.rolledAt` shift by `days(plan.startDate - plan.rolledFrom)`, and < 1 is
  rejected "past". `rollPlan` writes `rolledFrom` and `rolledAt`. ponytail: one roll of history. Two rolls between a
  placement and its apply can misplace it by a day. Rolls only happen on Plan open, and that's where placements apply
  (roll first), so this needs two rolls with no Plan open in between.
- **A frozen portion whose cook day dropped off stays frozen.** `frozenFrom` shifts with the roll and may go ≤ 0.
  `frozenParentDay` trusts a value < 1 (parent cooked before the window) instead of returning null. Otherwise the
  shopping list would re-buy it.
- **A roll clears `mp_planUndo`** (its day numbers are stale).
- **Shift ≥ 14 is a fresh plan** (nothing survives, `shopAnchor` kept so the cadence holds).
- **Shopping page hides cycles already over**: a list whose shop date + 7 ≤ today (only possible before a roll).
- **No new route or KV key.** `planMirror` carries `shopAnchor` so the Worker's `GET /shopping` and its generator calls
  (`/plan/draft`, re-flow draft) use the same offset.

## Files touched

- `data.js`: new `MP.rollPlan`; `frozenParentDay` trusts `from < 1`. Has the `window` → `root` shim (Worker imports
  it): no bare `window.`.
- `shelf-life.js`: `shopDayFor(dayNum, offset)`, new `shopOffset(plan)`, `rawSafeOn(meal, dayNum, shelfData, offset)`,
  `checkPlanWarnings` and `estimateUseBy` use the plan's offset. Shimmed, Worker-imported.
- `generator.js`: `halfKeys`/`spent` keyed by shop cycle (`place`, the locked pre-pass, `rankSlot`'s line ~212,
  `pressureFor`); `rawSafeOn` gets the offset. Shimmed, Worker-imported.
- `shopping-list.js`: `buildLists` groups by `shopDayFor(day, offset)` (keys no longer fixed `{1, 8}`), new `planLineId`.
  Shimmed, Worker-imported.
- `shopping.js`: the three `lineId(plan.startDate, …)` calls → `planLineId(plan, …)`; hide finished cycles; heading uses the
  shop date.
- `plan.js`: `rollIfDue()` on load and on visible (before placements and drafts apply); a fresh generate with rolling on
  sets `shopAnchor = startDate`; `applyPlacements` and the draft apply rebase; pass `prefs.shopOffset` into the
  generator wrapper; clear `LS_UNDO` on roll.
- `plan-with-me.js`: `MP.PlanPrefs` get/save carry `rolling` (6th `save` arg); a toggle "Rolling plan (new day each
  morning)" on the settings screen.
- `hermes-sync.js`: `planMirror` copies `shopAnchor`; the prefs pull passes `remote.rolling` to `save` (line ~373).
- `worker/worker.js`: `PUT /prefs` validator accepts `rolling` boolean (near line 1011); `runGenerator`/`/shopping` use
  `ShelfLife.shopOffset(mirror)` (`lineId` call at ~604 → `planLineId`).
- `test.html`: assertions below. `worker/worker_test.mjs`: one `/shopping` case with `shopAnchor`.
- `sw.js`: bump `CACHE`.
- `CLAUDE.md`: the `mp_planPrefs` invariant's field list gains `rolling`; the shelf-life invariant line ("shop day = day
  1 and day 8") becomes "every 7 days from `plan.shopAnchor` (day 1 and day 8 when absent)".
- `docs/ARCHITECTURE.md`: "v10 - rolling plan" already written at planning.

New names checked free: `rollPlan`, `planLineId`, `shopOffset`, `shopAnchor`, `rolledFrom`, `rolledAt`. No new dependency,
route or KV key.

## Signatures / schemas

```
plan: { startDate, days[14], generatedAt, shopAnchor?: ISO, rolledFrom?: ISO, rolledAt?: ISO-datetime }
mp_planPrefs: { updatedAt, busyDays, chips, budgetTarget, freezeBatches, repeatGap, rolling? }   // absent = true

MP.rollPlan(plan, todayIso, generate) -> { plan, shift } | null        // data.js, pure; null when shift <= 0
   // generate(locked, startDate) -> full 14-day plan (plan.js passes its generatePlan wrapper)
MP.ShelfLife.shopOffset(plan) -> 0..6
MP.ShelfLife.shopDayFor(dayNum, offset = 0) -> int (may be <= 0)
MP.ShelfLife.rawSafeOn(meal, dayNum, shelfData, offset = 0)
MP.ShoppingList.planLineId(plan, shopDay, key) -> string
MP.ShoppingList.buildLists(plan, …) -> { [shopDay]: list }             // keys are this plan's shop days
generatePlan(..., prefs)  // reads prefs.shopOffset (per call, default 0)
```

## Edge cases

- Rolling off, or `startDate` is today or in the future: `rollPlan` returns null; nothing is written.
- Kept days keep `eatenAt`, `locked`, `variantId`, `subs`, `eatingOut`, `frozenFrom` (shifted). `day` fields are renumbered.
- A leftover on new day 1 whose parent cook dropped off: `evaluateSlot` already returns null for a missing cook day. Check
  that no false warning appears.
- A batch cooked on an appended day 14 whose chain would run past the window: the existing run truncation and freezer
  spares handle it. ponytail: the next roll doesn't continue the chain. Revisit if it shows up.
- Budget pressure in a partial cycle (days of that cycle already dropped): only the cycle's remaining days count. Accepted.
- Draft whose every change lands < 1: the banner shows nothing to apply and it is acked as stale.
- Shopping page with no plan, fixed plan, or rolled plan: no console error. Fixed-mode lists and IDs are identical to
  today's.
- Toggle rolling on with an existing fixed plan: the next roll sets `shopAnchor = old startDate`, so the cadence continues.

## Verification

- `python3 check.py` passes (data_check sees the `sw.js` bump; ui pages + ui walk).
- `node worker/worker_test.mjs` passes, including a `/shopping` case with `shopAnchor` 3 days before `startDate`.
- Node/test.html assertions:
  - `shopDayFor(d, 0)` equals the old `d <= 7 ? 1 : 8` for d = 1..14; `shopDayFor(1, 3)` = -2, `shopDayFor(5, 3)` = 5.
  - `rollPlan` with shift 2: days 3–14 become 1–12 with slots deep-equal, days 13–14 come from `generate`, `locked`
    passed to `generate` holds every kept slot, `shopAnchor` = old `startDate`, `frozenFrom` shifted by 2.
  - shift 0 → null; shift 20 → fresh 14 days, `shopAnchor` kept.
  - `frozenParentDay` with `frozenFrom: -1` returns -1; with 3 and a different parent meal, null (unchanged).
  - `generatePlan` with no `prefs.shopOffset` gives the same output as before (fixed seed, compare to HEAD's
    `git show HEAD:generator.js` via a Node harness).
  - `planLineId` without `shopAnchor` equals `lineId(startDate, shopDay, key)`. With one, it stays the same before and after
    a 1-day roll.
  - placement with `requestedAt < rolledAt` on day 5 after a 2-day roll lands on day 3; one on day 1 is rejected "past".
- Drive it (Playwright, `tools/browser-check`, fresh profile, PC and 390 px, both themes): generate a plan, set
  `startDate` back 2 days in `mp_plan`, reload Plan. Check the first card is today, two new days at the end, no console
  errors. Shopping shows only current/future cycles and keeps a ticked line ticked across the roll. Toggle rolling off,
  set `startDate` back again, reload: no roll.

## Tasks

Logic (TDD):
- [x] `shelf-life.js`: `shopDayFor(dayNum, offset)`, `shopOffset(plan)`, `rawSafeOn`/`checkPlanWarnings`/`estimateUseBy` use it
- [x] `generator.js`: halves → shop cycles via `prefs.shopOffset`; prove the no-offset output is unchanged
- [x] `shopping-list.js`: `buildLists` groups by cycle; `planLineId`
- [x] `data.js`: `rollPlan`; `frozenParentDay` trusts `< 1`
- [x] `plan.js`: `applyPlacements` + draft-apply rebase
- [x] `plan-with-me.js` / `hermes-sync.js` / `worker/worker.js`: `rolling` pref end to end, `shopAnchor` in mirror, Worker offset
- [x] `CLAUDE.md` invariant lines (prefs fields, shop-day rule)

UI:
- [x] `plan.js`: `rollIfDue()` on load and on visible, before placements/drafts; clear undo; fresh generate sets `shopAnchor`
- [x] `plan-with-me.js` settings toggle (ui-build, both themes, 390 px)
- [x] `shopping.js`: `planLineId`, hide finished cycles, shop-date headings
- [x] `sw.js` CACHE bump
