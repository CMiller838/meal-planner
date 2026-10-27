# Phase 105: Freeze-ahead prompts [M]
Plain: When a batch dinner makes more portions than the next day or two will eat, Hermes offers to freeze the extras and puts them in later in the plan, with a "defrost tonight" reminder and nothing extra to buy.

Requires Phase 88 (`MP.placeSlots`, chat cards), Phase 59 (`frozenFrom` slots, built) and Phase 90a (`place.cookId`, `fromCook`, brief `cooks`; built, live checks pending). Phase 94 (not started) also edits the bridge prompt: both only add or change prompt lines, `EDIT_TYPES` stays the shared block; whichever builds second merges.

## Decisions
User-chosen (2026-10-27):
- **Both batch kinds.** A batch not cooked yet (planned dinner) and a batch already cooked (an `MP.Cooks` fridge record).

Own calls:
- **Planned batch = `place` with `freezeFrom`.** `place` gains optional `freezeFrom` (int 1-28, the cook day). The slot is stored `{ mealId, frozenFrom: freezeFrom }`, the Phase 59 shape: defrost note, no shelf-life warning, buys nothing, `commitCook` freezes the portion when the batch is cooked. No new slot field. Mutually exclusive with `cookId` (both present = edit dropped).
- **`placeSlots` checks for `freezeFrom`** (each failure a refusal note): the slot is a dinner; day `freezeFrom` holds a dinner of the same `mealId` that `MP.isBatch` and is not itself `frozenFrom`/`fromCook`; `meal.freezable !== false`; `p.day >= freezeFrom + 3` (inside the fridge run it would just be a leftover); portions: `servings` minus 1 (the cook) minus the leftover days in `MP.chainDays` minus other `frozenFrom` slots pointing at `freezeFrom` must be > 0 ("only N spare portions"). `prefs.freezeBatches === false` does not refuse an explicit user request, it only stops Hermes being told there are spares.
- **Cooked batch = `freeze` edit** `{ type: "freeze", cookId, places: [{ day, slot }] }` (1-4 places, slot lunch|dinner, cookId <=120). It is a proposal: the app shows an Accept/No card "Freeze 2 portions of Chilli and eat them Tue dinner, Thu dinner" (same card pattern as `bulk`). Only Accept writes: `MP.Cooks.freezeOne(cookId)` once per place, then each place becomes `{ mealId, fromCook: <freezer twin id> }` in the working plan. The twin id is `${cookId}:frozen` (`cooksFreezeOne`, `plan.js:120`). Hermes never has to know it.
- **Propose-time check is a dry run**: `placeSlots` with `ctx.cooks` replaced by the record minus N portions plus a synthetic twin `{ ...rec, id: twin, storage: "freezer", portionsLeft: N }` (so the eat-by check uses the freezer's months, not the fridge's days). Refused places are dropped with their reason; none left = a refusal line, no card. The fridge record must be `storage !== "freezer"` and `portionsLeft - N` must still cover its existing `fromCook` slots. On Accept the same check runs again against the real, post-freeze cooks (the plan may have moved since the card appeared) and anything refused is reported as a note.
- **No Undo on the freeze card** once accepted, like the Leftovers "Freeze 1" button (there is no thaw path, and one is not worth building). The pending card is only ever Accept / No. After Accept the row reads "Froze N portions" and the slots can be rerolled like any other. Exit leaves `mp_plan` untouched (`guidedActive`) but the freezer move stays, as for Phase 87 meal edits.
- **The brief says where the spares are** (`chatBriefing`, `plan.js:660`): new `spares: [{ day, mealId, spare }]` for planned batch dinners (spare = servings - 1 - chain leftover days - `frozenFrom` slots on it; only `spare > 0`, `meal.freezable !== false`, and only when `prefs.freezeBatches !== false`, else `[]`), and each `cooks` entry gains `spare` = `portionsLeft` minus the `fromCook` slots already on it (fridge records only; freezer records `spare: 0`). Hermes decides how many to freeze and where; the app rechecks everything.
- **Generator and Worker rankings are not touched** (one-tap Generate keeps its Phase 59 freezing). No pantry write anywhere (`freezeOne` writes cooks only).
- **Bridge prompt** (`tools/hermes_chat_bridge.py`): two `EDIT_TYPES` lines (`place.freezeFrom`, `freeze`) and one rule line: when the briefing's `spares` or a fridge cook's `spare` is above 0, offer once to freeze the extras and say which later slots you'd put them in; skip it when `freezeBatches` is false or the user says no; never freeze what the next 1-2 days will eat.

## Files touched
- `plan-chat.js` (Worker-imported, already shimmed): NORM `place.freezeFrom`, new `freeze`; `describe` lines; `validateReply` cap of 3 `freeze` per reply (like `bulks`).
- `data.js` (Worker-imported, shimmed, no top-level `window`): `placeSlots` `freezeFrom` branch (above).
- `plan.js`: `chatBriefing` (`spares`, `cooks[].spare`); `applyFreezeEdits(edits, ctx)` beside `applyBulkEdits` (`plan.js:~620`) returning `{ cards, refused }`; `onChatReply` routes `freeze` to cards and adds `freeze` to the `rest` exclusion list (`plan.js:~2647`) so it never reaches `applyChatEdits`; `answerMeal` handles `x.freeze`; export `applyFreezeEdits` on `MP.Plan` (`plan.js:2290`).
- `hermes-sync.js`: `planMirror` already whitelists `frozenFrom` and `fromCook` (lines 325-326): no change, assert in tests.
- `tools/hermes_chat_bridge.py` + `tools/test_hermes_chat_bridge.py` (the prompt `assert all(t in p for t in ...)` line 20: add `freezeFrom`, `"freeze"`).
- `test.html`, `tools/worker_test.mjs` (`POST /chat/reply` accepts a `freeze` and a `place.freezeFrom`, drops a bad one). `sw.js`: bump `CACHE`.
- `CLAUDE.md`: one invariant line (below). `docs/HERMES.md` Planning chat section: `place.freezeFrom`, `freeze`, brief `spares` / `cooks[].spare`.
- No new `<script>` dependency between modules; no new file, route or KV key.

CLAUDE.md line to add: **Freeze-ahead (Phase 105): chat `place.freezeFrom` writes a Phase 59 `frozenFrom` slot; a chat `freeze` only becomes a card, and Accept moves portions with `MP.Cooks.freezeOne` and fills `fromCook` slots. Neither touches the pantry; the generator is not taught either.**

## Signatures / schemas
- NORM `place`: `{ ..., freezeFrom?: int 1-28 }` (not with `cookId`). NORM `freeze`: `{ type: "freeze", cookId: string<=120, places: [{ day: 1-28, slot: "lunch"|"dinner" }] }`, 1-4 places, distinct.
- `MP.placeSlots(plan, places, byId, ctx)` unchanged signature; place objects may carry `freezeFrom`. Consumer: `applyChatEdits` (existing).
- `MP.Plan.applyFreezeEdits(edits, ctx) -> { cards: [{ edit, text, accept() }], refused: [{ edit, why }] }`; `ctx = { plan, byId, cooks, shelfData }` (defaults as in `applyBulkEdits`). Consumer: `onChatReply` (pushes cards into `chat.meals` as `{ freeze: true, pending: true, text, accept }`, refusals as plain lines); `accept()`'s return (`{ froze, notes }`) is consumed by `answerMeal`, which sets the row text and toasts each note.
- Brief: `spares: [{ day, mealId, spare }]`, `cooks[].spare: number`. Consumer: Hermes only (prompt line).

## Edge cases
- `freezeFrom` day holds a different meal, a leftover, or is itself frozen: refused. Plan parent later moved or swapped: `MP.frozenParentDay` already treats the slot as plain.
- Two `place`s in one reply for the same spare when only one is left: the second is refused ("only 1 spare portion").
- `freeze` for a freezer record, a record with `portionsLeft` 0, a cook whose meal is not freezable (`freezable:false`): refused.
- Accept when the fridge record has since been eaten down: the post-freeze recheck refuses the missing places, reports a note, and freezes only as many as were placed (freeze after the recheck passes, never before).
- A `fromCook` place past the freezer's eat-by (months): refused as today.
- Plan with no batch dinners and no cooks: `spares: []`, behaviour identical to today (regression assert).
- 21/28-day plans: day bounds are 1..28 as everywhere.

## Verification
- `python3 tools/test_hermes_chat_bridge.py`
- `node tools/worker_test.mjs`
- `python3 check.py` (test.html cases: `placeSlots` `freezeFrom` accepted and each refusal incl. too-early, wrong meal, no spare, `freezable:false`, with `frozenFrom` set on the slot; `buildLists` adds nothing for it and `defrostNotes` names it; `validateReply` keeps/drops `freeze` and `freezeFrom`+`cookId`; `chatBriefing` `spares` and `cooks[].spare` incl. `freezeBatches:false` giving `[]`; `applyFreezeEdits` dry-run refusals, Accept freezes then fills `fromCook` slots, pantry untouched, recheck refusal; bridge self-test prompt tokens).
- Browser run with a mocked Worker chat (Playwright, `tools/browser-check`, as in Phases 88 and 90a): seed a cooked 4-portion fridge record and a planned batch; a mocked reply with one `place.freezeFrom` and one `freeze` shows the slot with the "defrost" note and a freeze card; Accept shows "Froze N portions" and the `fromCook` slots; No leaves the record alone. PC and 390 px, both themes. No real credential needed.

## Tasks
Logic (TDD):
- [ ] `data.js` `placeSlots`: `freezeFrom` branch and refusals; tests first
- [ ] `plan-chat.js`: NORM `freeze`, `place.freezeFrom` (with `cookId` exclusion), `describe`, cap of 3 `freeze`; tests incl. `worker_test.mjs`
- [ ] `plan.js`: `chatBriefing` `spares` / `cooks[].spare`; `applyFreezeEdits` (dry run, accept, recheck); `answerMeal` consumes the accept result
- [ ] Bridge: `EDIT_TYPES` lines + rule line + `test_hermes_chat_bridge.py` tokens
UI (`ui-build`):
- [ ] Freeze card in the chat (reuse the bulk card row: Accept / No), result row after Accept; check PC + 390 px, both themes
- [ ] Docs: `docs/HERMES.md`, `CLAUDE.md` line, bump `sw.js` `CACHE`
