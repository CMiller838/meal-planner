# Phase 82: Swap days and edit past days [M]
Plain: swap any two meals or whole days in one tap, and fix what you actually ate on earlier days.

Requires: Phase 81 (named eating-out slot; `pushSlot`/`moveSlot` helpers in `data.js`).

## Decisions
**User-chosen (2026-10-24)**: swap two meals/days; edit past days; re-flow only on request (existing Re-plan action and `mp_planUndo`).
**Own calls**
- `MP.swapSlots` (two slots) and `MP.swapDays` (whole days) are pure, in `data.js` beside `reflowPlan`. Either side held (eaten, locked) is refused with a reason, except in past-edit mode below.
- Leftover chains move together: swapping a batch cook swaps its `chainDays`; refuse a swap that puts a leftover before its cook.
- After a swap, shelf-life and shopping recompute because they read the plan; no extra code. Nothing re-flows automatically.
- Past-day edit = on a past slot, "What did I actually eat?": a library meal (marks it eaten at that date via the existing `eatPortion`, never `commitCook`, never the pantry; CLAUDE.md "cook vs portion"), or eating out with a name and text (Phase 81 sheet, `when` = that day). Optional "I cooked it" link calls the existing `commitCook` flow and asks first.
- Past edits never re-flow and are one-level undoable.

## Files touched
`data.js` (`swapSlots`, `swapDays`), `plan.js` (swap UI in the day sheet and a "Swap with…" day action, past-slot edit sheet, `isHeld`), `style.css`, `sw.js` (bump `CACHE`), `test.html`, `CLAUDE.md` (invariant: past edits use `eatPortion`, never the pantry).

## Signatures
- `MP.swapSlots(plan, a:{day,slot}, b:{day,slot}, mealsById) -> { plan, changes, ignored }`
- `MP.swapDays(plan, d1, d2, mealsById) -> { plan, changes, ignored }`

## Edge cases
Swap with an empty or eating-out slot (allowed, moves the marker); leftover before cook; swap across the shop-day boundary (warnings recompute); backfill a slot already eaten (replaces its log entry, never double counts); date in the future (rejected).

## Verification
`python3 check.py`; unit asserts in test.html for both swaps (chains, held refusal, eating-out) and for a past backfill leaving the pantry unchanged; browser at PC and 390 px, both themes: swap Tue and Thu, backfill yesterday as Spoons, undo. No real credential needed.

## Tasks
Logic (TDD)
- [x] `swapSlots`, `swapDays` with asserts
- [x] Past backfill helper calls `eatPortion` only (assert no pantry writer called)
UI (`ui-build`)
- [x] Swap affordance on slot card and day header; past-slot edit sheet
