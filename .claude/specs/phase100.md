# Phase 100: Cook-now suggestions [M]
Plain: Tap "Cook now" on a slot (or ask Hermes "what can I make with what's in?") and see up to three meals you can cook right now without buying anything, plus any leftovers already cooked, and place one with a tap.

Soft dependency: the bridge edits touch `tools/hermes_chat_bridge.py`'s `EDIT_TYPES`/prompt; build after Phases 94 and 95 and read the file as it is then. Without Phase 95, `chat.stock` is only filled in fridge mode: cook-now just counts whatever is in it (empty = pantry only).

## Decisions
Already built (found by grep, not re-done): `MP.ShoppingList.cookable` (`shopping-list.js:132`) already computes "ready" meals (nothing missing, `hasEnough`, hard exclusions) and serves `GET /cookable`; `candidatesFor(day, slotType)` (`plan.js:1426`) is the one ranked, rating-aware candidate list; `MP.placeSlots` + `applyChatEdits` place a meal with all hard checks; `MP.Cooks.all()` holds open leftovers.
1. **User-chosen: both surfaces.** An in-app "Cook now" entry (swap sheet + chat) and a Hermes `cookNow` edit that opens the same list.
2. Own call: "nothing to buy" = `cookable`'s `ready` (every non-leftover ingredient on hand in sufficient quantity). No near-misses shown.
3. Own call: "on hand" = local pantry (`MP.Sync.localItems("pantry")`) plus session `chat.stock` (in chat only). Stock is merged into the item list passed to `cookable` for this call; the pantry is never written (the Phase 90b rule).
4. Own call: order = `candidatesFor(day, slotType)` filtered to the ready ids, so nutrition ranking, ratings, chips and exclusions decide the order (cook-now is a filter on top, never a re-score). Top 3 shown; "Something else?" shows the next 3; at the end it says "That's all I can find" and wraps to the first page.
5. Own call: open leftovers (`MP.Cooks.all()` with `portionsLeft > 0`, meal has the slot type, lunch/dinner only) appear in a separate "Already cooked" group above the meals, max 2, soonest eat-by first, not paged. Placing one sends `place` with `cookId` through `applyChatEdits` (so `placeSlots` checks eat-by and portions left). Leftover rows are chat-only (outside chat there is no portion bookkeeping on the swap sheet).
6. Own call: placing a meal in chat = `applyChatEdits([{type:"place",...}])` (diff card with Undo, refusals shown); outside chat = `setSlotMeal(day, slotType, id)` + `renderPlan()`, the same call the swap deck's Take uses. No pantry write either way.
7. Own call: the Hermes `cookNow` edit is display-only like `stock`/`note`: it adds a chat card "Cook-now options for <day> <slot>" with a Show button that opens the sheet. Nothing opens unasked, nothing is applied.

## Files touched
- `shopping-list.js`: `cookable` gains `o.all` (skip the `slice(0, n)` cap; `clampN` stops at 20, which would drop ready meals before the slot filter). Worker caller unchanged. `MP.ShoppingList` already exports `cookable`.
- `plan.js`: `cookNowFor(day, slotType, offset)`, `openCookNow(day, slotType)` (renders into `#swap-sheet`, mode `"cooknow"`), entry points: a "Cook now" button in `renderDeck`'s non-guided head, a chat chip, and the `cookNow` card handler in the reply path next to the `stock` handling (~2644; add `"cookNow"` to the `rest` exclusion list). Export `cookNowFor` on `MP.Plan` for tests.
- `plan.html`: one chat button `#chat-cooknow` beside `#chat-stock` (opens the sheet for `chat.day`, dinner).
- `style.css`: rows and group label using existing tokens (`docs/UI_STYLE.md`). Sheet rows animate in with the existing stagger class; reduced motion respected.
- `plan-chat.js` (shared with the Worker, no `window` use): `NORM.cookNow`, `describe` line. `hermes-sync.js` unchanged.
- `tools/hermes_chat_bridge.py`: `EDIT_TYPES` line for `cookNow`, plus one prompt sentence: when asked what can be cooked from what is in, send `cookNow` for the slot instead of listing meals from memory. `tools/test_hermes_chat_bridge.py`: assert both.
- `test.html`, `tools/browser-check` walk: new cases (see Verification).
- `CLAUDE.md`: new invariant line (Cook-now, Phase 100): display-only filter over `candidatesFor`, never writes pantry, stock session-only.
- `sw.js` `CACHE` bump (plan.js, shopping-list.js, plan-chat.js, style.css, plan.html are cached). No Worker route change, no `routes.json` rebuild; `worker_test.mjs` must still pass (it imports `plan-chat.js` and `shopping-list.js`).

## Signatures
- `cookable(library, pantryItems, plan, todayIso, { all: true })` -> same shape, `ready` uncapped.
- `MP.Plan.cookNowFor({ day, slotType, offset, stock }) -> { meals: [meal x<=3], leftovers: [{ cookId, mealId, name, portions, eatBy }], more: boolean }`. Consumers: `openCookNow` (renders it) and the test cases.
- Edit: `{ type: "cookNow", day, slot }` (day 1-14, slot one of the four). Consumer: the reply path (card) and `describe`.

## Edge cases
- Empty pantry and no stock: sheet says "Nothing in the cupboard covers a whole meal. Add what you have in Pantry or tell Hermes." No error.
- Slot already holds the only ready meal: it is excluded (`candidatesFor` drops `currentId`).
- Eaten/locked/frozen slot: the button is hidden; a placement is refused by `placeSlots` with its reason, shown in the diff.
- `cookNow` for an unknown day/slot: dropped by `validateReply`. Duplicate `cookNow` edits in one reply: one card.
- Mushroom/egg/allergy/`never`: already excluded (`cookable` -> `Exclusions.check`, `candidatesFor` -> ratings). Profile hard terms: `candidatesFor`'s pool is not term-filtered, so also drop meals failing `MP.Exclusions.check(m, MP.Sync.hardTerms())`.
- Skipped ingredients (`leftover_` keys) never count as missing (existing `cookable` behaviour).
- Offline: everything is local; works.

## Verification
`python3 check.py --changed`, then `python3 check.py` (pass `timeout 600000`), `node tools/worker_test.mjs`, `python3 tools/test_hermes_chat_bridge.py`. Cases: `cookable({all:true})` returns more than 20 ready meals; `cookNowFor` returns only ready meals in `candidatesFor` order, paging with offset, `more` false on the last page; stock merged in makes a meal ready and the pantry array is unchanged; an open cook appears under `leftovers`, a spent one does not; `validateReply` keeps a good `cookNow` and drops a bad day; the walk opens the sheet from the swap deck and from the chat chip, places a meal and sees the slot change, at PC and 390 px, both themes. No real credential needed.

## Tasks
Logic (TDD)
- [x] `test.html`: `cookable` with `{all:true}` over 25 ready meals returns 25; without it still 20 (clampN).
- [x] `test.html`: `MP.Plan.cookNowFor` cases from Verification (order = candidatesFor filtered; paging; stock merge leaves pantry untouched; leftovers group; hard-term meal dropped; empty pantry -> empty meals).
- [x] `test.html` / `plan-chat` cases: `validateReply` keeps `{cookNow, day:2, slot:"dinner"}`, drops `day:99` and a missing slot; `describe` names it.
- [x] `shopping-list.js`: add `o.all`. `plan.js`: implement `cookNowFor`, export on `MP.Plan` (consumer: `openCookNow`).
- [x] `plan-chat.js`: `NORM.cookNow`, `describe`. `tools/hermes_chat_bridge.py`: `EDIT_TYPES` + prompt sentence; assert both in `test_hermes_chat_bridge.py`.
UI
- [x] `openCookNow` sheet (follow the `ui-build` skill and `docs/UI_STYLE.md`): "Already cooked" group, up to 3 meal rows (name, prep effort, protein if known, Place button), "Something else?" button, empty state; entries from the swap deck head and `#chat-cooknow`; reply-path `cookNow` card with Show. Place goes via `applyChatEdits` in chat, `setSlotMeal` outside.
- [x] Browser walk case for both entry points, both widths, both themes; screenshots checked by eye.
- [x] `CLAUDE.md` invariant line; bump `sw.js` `CACHE`; mark the roadmap heading `— done` with what was verified when committing.
