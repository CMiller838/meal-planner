# Phase 101: "Ate something else", with push-back [M]
Plain: Tap a meal in your plan and say whether you ate it, ate something else, or skipped it; a skipped meal is offered the sensible next step, and Hermes can do the same when you tell it.

Requires Phase 82 (done: `backfillSlot`), Phase 81 (done: `pushSlot`/`moveSlot`), Phase 84 (done: `POST /plan/edit`, `applyPlanEdits`), Phase 59 (done: `Cooks.freezeOne`). Touches `tools/hermes_chat_bridge.py` lightly: build after Phase 94 so the two do not collide.

## Decisions
Already built (grep): Eat + Skip buttons on the day sheet, the Skip sheet (push / move / swap / drop), `openBackfillSheet` ("What did you actually eat?", library search + eating out, past/today slots only via `day-ate-btn`), `MP.backfillSlot`, chat edits `skip`/`out`/`backfill`, `POST /plan/edit` (always parks a draft). Spec only the delta.
1. **User-chosen:** Eat and Skip collapse into one button per uneaten slot opening a "Did you eat it?" sheet: *Ate it* (the existing `commitCook`/Eat path, unchanged), *Ate something else* (`openBackfillSheet`, now also offered for any uneaten slot not in the future), *Skipped* (the existing Skip sheet).
2. **User-chosen:** Hermes may apply `skip`/`out`/`backfill` without a draft, from the Worker too: `POST /plan/edit` accepts `userSaid: true`, honoured only for `X-Actor: hermes` and only when every edit is `skip`/`out`/`backfill` (any `start`/`swap`/`swapDay` or a non-Hermes caller: the flag is ignored and a normal draft is parked).
3. Own call: a `userSaid` draft carries `direct: true`. The app adopts it on `fetchPlanDraft` with no banner, through the same apply code as the banner's Apply (extracted into one `applyDraft`), snapshots `mp_planUndo` first, toasts "Hermes recorded: ..." with Undo, then acks. The Worker still never writes the plan itself; the app's `localStorage` stays the authority.
4. Own call: **the draft Apply path today drops backfilled meals' food-log entries and an eating-out slot's name/text** (it copies `{eatingOut:true}` only). The draft now carries `backfilled: [{day, slot, entry}]` (`entry` = `{mealId}` or `{eatingOut,name,text}`, from `applyPlanEdits`'s `backfilled`, `replaced` dropped); the app re-runs `MP.backfillSlot` per entry locally and logs with `logPortion` / `POST /food-log`. This fixes banner drafts as well.
5. Own call: the suggested move for a skipped meal is computed, preselected in the Skip sheet, never forced: the other choices stay. `MP.suggestSkipMove(plan, day, slot, mealsById, shelfData, fromDay) -> { how: "push"|"drop"|"freeze", why }`. Rules, in order: a leftover slot with an open fridge Cook record -> `freeze` (`MP.Cooks.freezeOne`, one portion; shown only then); the meal's next-day raw-safety (`MP.ShelfLife.rawSafeOn(meal, day+1, shelfData, shopOffset)`) false, or day+1 is past the plan end -> `drop`; else `push`. An uncooked batch cook is never offered the freezer (nothing to freeze); push or drop only.
6. Own call: nutrition still picks replacements (`reflowPlan` -> generator); the suggestion is informational and never reorders or filters anything.
7. Own call: "recents" and a persistent type-it box are Phase 102. The Ate-something-else sheet keeps its library search and eating-out fields; no recents here.
8. Own call: **Browse likes vs `GET /library`**: Browse reads `data.js`'s library (`loadLibrary`), `GET /library` is its synced KV copy; a test asserts the Worker's `planInputs().library` ids equal the pushed library ids (no Hermes-side filter), nothing new built. Hermes already receives every liked meal in the briefing (Phase 88).

## Files touched
- `plan.js`: day-sheet slot buttons (~1719 `day-eat-btn`, ~1763 `day-skip-btn`, ~1799-1812 handlers) -> one `day-done-btn` opening `openDoneSheet(day, slot)`; `openSkipSheet` preselects the suggestion and adds a "Freeze one portion" button when `how === "freeze"`; `openBackfillSheet` gate: any non-future slot; extract `applyDraft(draft, changes)` from `renderPlanDraftBanner` (~2109) and call it from the banner's Apply and from a new `mp:plandraft` branch for `draft.direct`; undo toast restores `mp_planUndo` and unlogs the draft's backfilled entries.
- `data.js` (`window`->`root` shim already present): add `MP.suggestSkipMove`; `MP.applyPlanEdits` unchanged (already returns `backfilled`).
- `shelf-life.js`: none (reuse `rawSafeOn`, `shopOffset`).
- `worker/worker.js`: `editRoute` (~461): read `body.userSaid`, honour only `X-Actor: hermes` + only-skip/out/backfill, set `draft.direct`, add `draft.backfilled` (whitelisted fields) to every draft from this route; `draftId`/`planDraftError` (~1452) accept the two new fields; update the `/plan/edit` note (~1531). Rerun `node tools/routes_build.mjs`, commit `worker/routes.json`.
- `hermes-sync.js`: `fetchPlanDraft` (~539) passes `direct`/`backfilled` through unchanged (it already forwards the whole object); `planMirror` is not involved (no new slot field).
- `tools/hermes_chat_bridge.py`: one prompt sentence: "when the user has just said what they ate or skipped, reply with the `skip`/`out`/`backfill` edit; it applies at once with an Undo" (app chat path is unchanged: those edits already go through `applyChatEdits`).
- `tools/worker_test.mjs`, `test.html`, `tools/browser-check/ui-check.mjs` (the click-walk uses the Eat/Skip selectors), `sw.js` (bump `CACHE`).
- `CLAUDE.md`: amend the Phase 84 invariant ("Chat/assistant plan actions ... nothing applies unseen") with: a Hermes `userSaid` skip/out/backfill is adopted by the app without a draft banner, undoable; the Worker still never writes the plan. `docs/ARCHITECTURE.md`: one line under the Phase 84 paragraph.

## Signatures
- `MP.suggestSkipMove(plan, day, slot, mealsById, shelfData, fromDay, cooks) -> { how: "push"|"drop"|"freeze", why: string }`. Consumer: `openSkipSheet` (preselect + `why` caption). Pure, never writes.
- `openDoneSheet(day, slotType)` (plan.js, UI): consumers = the day-sheet button.
- `applyDraft(draft, changes) -> Promise<void>` (plan.js): consumers = banner Apply, direct adopt.
- `POST /plan/edit` body gains `userSaid?: boolean`; draft gains `direct?: true`, `backfilled?: [{day, slot, entry}]`. Consumer of `backfilled`: `applyDraft` (logs via `logPortion` / `postFoodLog`).

## Edge cases
- Future-day slot: the sheet offers Ate it / Skipped only (backfill refuses future days, `backfillSlot` message shown if reached via chat).
- Already eaten / locked / frozen slot: no button (unchanged); Skipped on a held slot is refused by `pushSlot`/`moveSlot` with its reason.
- `freeze` suggestion with no open Cook record or a `freezer` record already: not offered; falls to push/drop.
- Direct draft whose slots already changed (user edited between): `applyDraft` uses `MP.backfillSlot`/`reflow` results against the live plan; a refused edit is toasted, nothing partial is acked as success.
- Same draft id adopted twice (two syncs): `ackPlanDraft` first; an already-acked id is ignored (`pending:false`).
- Backfilled eating-out with no name/text: refused by the existing validator.
- Offline/sync off: nothing arrives, nothing applies (unchanged).

## Verification
- `node tools/worker_test.mjs` (new cases: `userSaid` + Hermes + skip -> `direct:true` and `backfilled` present; `userSaid` as assistant -> no `direct`; `userSaid` with `swap` -> no `direct`; library ids from `planInputs` equal pushed ids).
- `python3 check.py` (data_check, test.html cases for `suggestSkipMove`: leftover with open fridge record -> freeze; next-day raw-unsafe -> drop; plan end -> drop; default push; uncooked batch never freeze; ui-check click-walk updated to the new button).
- Serve the site and drive it with `tools/browser-check`: tap a slot, each of the three paths, PC and 390 px, both themes; bad input (empty eating-out, future slot); confirm Ate-something-else logs once and never touches the pantry.

## Tasks
Logic (TDD)
- [ ] `MP.suggestSkipMove` + `test.html` cases above
- [ ] Worker `editRoute`: `userSaid`/`direct`/`backfilled`, actor + edit-type guard, `planDraftError`, route note; `worker_test.mjs` cases; `node tools/routes_build.mjs`
- [ ] `applyDraft` extraction; `backfilled` re-run via `MP.backfillSlot` + `logPortion`/`postFoodLog` (consumer of `backfilled`); direct adopt with snapshot, toast and Undo (unlogs the entries)
UI
- [ ] `openDoneSheet`, `day-done-btn` replacing Eat/Skip; backfill sheet enabled for non-future slots; Skip sheet preselect + `why` + freeze button (`ui-build` skill, `docs/UI_STYLE.md`)
- [ ] Bridge prompt sentence; update `ui-check.mjs` selectors; bump `sw.js` `CACHE`; CLAUDE.md + ARCHITECTURE.md lines
- [ ] Live: tell Hermes in Telegram "I had pasta instead of the curry, push the curry to tomorrow" and see it apply on the phone with Undo.
