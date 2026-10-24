# Phase 81: Eating out, named, and skip that asks [M]
Plain: tell it "Spoons, burger and chips" for a slot and it counts as eaten (estimated); skipping a meal asks what to do with it.

Requires: Phase 63 (`reflowPlan`, `data.js`), 80a (`POST /food-log`, `worker/food-log.js`), 80b (`mp_foodLog` mirror, `plan.js` "Also eaten"). All built.

## Decisions
**User-chosen (2026-10-24)**
- Skip asks each time: push to tomorrow / move to a later free slot / swap for something else / drop it.
- Unplanned food = name plus a description, estimated through the 80a resolver.
**Own calls**
- Slot shape grows, nothing replaces it: `{ eatingOut: true, name?, text?, foodLogId? }`. `{ eatingOut: true }` alone still works.
- The app logs the estimate with `POST /food-log` (`kind: eat`, `when` = the slot's date and time, `id` = a fresh uuid stored as `foodLogId`). First task: grep `hermes-sync.js` for which token the app sends and whether `POST /food-log` accepts it; if it does not, do not widen `ASSISTANT_TOKEN`: store `text` on the slot, show "estimate pending" and let the assistant log it (the 80b mirror then fills coverage).
- Offline or Worker error: the slot still saves, the estimate stays pending, never blocks.
- "Drop it" = today's `doReflow({ skipped })`. "Push" and "Move" are pure helpers next to `reflowPlan` (`data.js`), no generator change, no pantry write (CLAUDE.md: re-flow never writes the pantry).
- Push = the meal goes to the same slot next day, same-slot meals after it shift one day, the last falls off the plan. Held slots (eaten, locked, past) are never displaced; push stops at one.
- Move = pick a later non-held slot; that slot's meal is freed and re-flowed via `reflowPlan`. Swap = existing `openSwapPicker`.
- Batch cooks and leftover chains move as a unit (`chainDays`); a chain cannot be pushed past the plan end (offer Drop).

## Files touched
`data.js` (`MP.pushSlot`, `MP.moveSlot`, extend `reflowInputError`), `plan.js` (skip sheet, eating-out sheet, slot card label/name, `doReflow`), `hermes-sync.js` (`planMirror` whitelists slot fields: add `name`, `text`, `foodLogId`; `fetchFoodLog` unchanged), `nutrition.js` (`foodAsEaten` already counts food log; no change expected), `style.css`, `sw.js` (bump `CACHE`), `test.html`, `CLAUDE.md` (invariant: eating-out slot shape).

## Signatures
- `MP.pushSlot(plan, day, slot, mealsById, fromDay) -> { plan, changes, ignored }`
- `MP.moveSlot(plan, from:{day,slot}, to:{day,slot}, mealsById, fromDay, generate) -> { plan, changes, ignored }`
- Eating-out slot: `{ eatingOut: true, name: string<=60, text: string<=200, foodLogId?: string }`

## Edge cases
Skipping a locked/eaten/past slot (ignored, as today); push off the plan end; eating out on an already-eaten slot (rejected); empty name (default "Eating out"); `esc()` on `name`/`text` always; re-flow keeps `name`/`text` (sticky eating-out).

## Verification
`python3 check.py`; `node tools/worker_test.mjs`; unit asserts in test.html for push (shift, held stop, chain), move, sticky named eating-out; browser at PC and 390 px, both themes: skip a dinner and take each choice, mark Friday dinner "Spoons, burger and chips", reload, undo. No real credential needed.

## Tasks
Logic (TDD)
- [ ] `pushSlot`, `moveSlot` and input validation, with asserts
- [ ] Eating-out slot fields survive re-flow and `planMirror`
UI (`ui-build`)
- [ ] Skip sheet with four choices; eating-out sheet (name, what you had); named card label and "estimate" tag
- [ ] Undo path reuses `mp_planUndo`
- [ ] Live: mark a real dinner as Spoons on the phone PWA and confirm the estimate shows
