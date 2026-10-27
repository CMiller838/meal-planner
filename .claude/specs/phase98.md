# Phase 98: Make it cheaper, with the live total [M]
Plain: In a planning chat Hermes always knows what the shop will cost, and "make it cheaper" gives you ingredient swaps with the £ saved, each on an Add/No card.

Requires Phase 94 (bridge sends a per-turn `Context:` and the briefing only on the opener/when changed: build 94 first, read `tools/hermes_chat_bridge.py` as it is then). Builds on Phases 76 (`GET /swaps`), 28 (`slot.subs`), 90a (bulk card pattern).

## Decisions
Already built (found by grep, not re-done): per-turn `chatContext` already sends `weekCost`/`budgetTarget`; the briefing already carries `bulk`; the Worker `swaps()` holds the cheaper-swap logic inline; chat `bulk` cards (`applyBulkEdits`, Accept/No row) are the card pattern.
1. **Live total rides in the per-turn context, not the briefing** (own call): the briefing is not resent every turn, so a total there goes stale after each edit. `chatContext` gains `shop: { total, perShop: [{ shopDay, total }] }` from `planMetrics(plan).shops` (already `{shopDay,total}`; `null` totals dropped; absent `packData` = key omitted). Context cap is 4000 chars: the block is small.
2. **Cheaper candidates ride in the context too**, top 3 (`cheaper: [{ key, to, shopDay, saving }]`), recomputed each turn so they track the working plan. Hermes proposes from this list only (same rule as `bulk`).
3. **One swap implementation** (own call): extract the body of `swaps()` into `ShoppingList.cheaperSwaps` in `shopping-list.js`; the Worker route and the app both call it. A second copy is the bug. Exclusion re-check and `applySubs` are passed in as a callback (`ok(mealsWithSub)`), so `shopping-list.js` gains no new dependency on `exclusions.js`/`data.js`.
4. **New chat edit `cheaper {key, to, shopDay}`** (own call; `bulk` is the template). The app recomputes the saving (Hermes's number is never shown), refuses a pair not in `cheaperSwaps` output, shows `Swap X for Y on shop N, saves about £S` with Add/No. Accept writes `slot.subs` on every unheld, uneaten slot in that shop's days whose meal uses `key` (`shopDayFor(day, shopOffset(plan)) === shopDay`); Undo removes exactly those subs. Max 3 per reply.
5. **Ingredient swaps only on cards; meal swaps stay on the existing `place`** (own call, narrows the roadmap line "ingredient or meal swaps"): Phase 89's ticker already shows each re-pick's £ delta, and a second card type for meals would duplicate it. Hermes states a meal swap's saving from the next turn's `shop.total` vs the previous.
6. **Never raises cost unprompted and never touches nutrition ranking**: cards are user-asked; `cheaperSwaps` reorders nothing, `tagChanges` is shown on the card text when non-empty ("less vitamin C"). `slot.subs` stays generator-OR-accepted-card written: update the Phase 28 invariant in `CLAUDE.md`.
Today's only group is onion/peppers (g vs each, so swaps are `estimated`): the card says "about" and the spec does not widen `substitution-groups.json`.

## Files touched
- `shopping-list.js` (defines `groupIndex`, `priceFor`, `packsFor`, `normalizeKey`, `buildLists`): add `cheaperSwaps`. Already carries the `window` → `root` shim; Worker imports it already.
- `worker/worker.js`: `swaps()` (l.~766) becomes a thin caller; no route change, so no `routes.json` rebuild.
- `plan-chat.js` (`MP.PlanChat.validateReply`, runs in Worker `POST /chat/reply` and app): add `cheaper` to the edit table (l.~85), cap 3 (l.~108), summary line (l.~184).
- `plan.js`: `chatContext` (l.~817) add `shop`/`cheaper`; new `applyCheaperEdits` beside `applyBulkEdits` (l.~617); reply handler (l.~2635) and card row (l.~2558-2593, treat like `x.bulk`).
- `tools/hermes_chat_bridge.py`: `EDIT_TYPES` entry for `cheaper`; one prompt line ("context.shop is the live total; for 'make it cheaper' propose only from context.cheaper; mention saving ~£, never raise cost unprompted").
- `CLAUDE.md`: Phase 28 `slot.subs` invariant line. `sw.js`: bump `CACHE`. Pages: `plan.js` already loads `shopping-list.js`; no new cross-file dependency (grep `*.html` anyway).
- Tests: `test.html` (beside Phase 90a block, l.~3557), `tools/worker_test.mjs` (Phase 76 block l.~890), `tools/test_hermes_chat_bridge.py` (l.~20 prompt assert).

## Signatures
```
ShoppingList.cheaperSwaps(list, usingMealsOf, { groupIdx, pack, tags, limit, ok }) -> [{ lineId, key, label, meals, to:{key,label,qty}, was:{packs,cost}, now:{packs,cost}, saving, estimated, tagChanges }]  // same shape as GET /swaps
  // usingMealsOf(line) -> meal objects; ok(mealList, sub[]) -> bool (hard exclusions re-check); pure
plan.js applyCheaperEdits(edits, ctx) -> { cards: [{ edit, text, accept(), undo() }], refused }
PlanChat edit: { type: "cheaper", key, to, shopDay }
```
Consumers: `swaps()` (Worker) and `chatContext`/`applyCheaperEdits` (app) call `cheaperSwaps`; the reply handler consumes `cards` (pending card, Accept runs `accept`, `undoBulk`-style undo) and `refused` (shown as a plain chat line).

## Edge cases
No packData / no groups / nothing cheaper: `shop` omitted or `cheaper: []`, `cheaper` edit refused with a line, never an error. Hermes sends a pair not in the list: refused. Swap rejected by hard exclusions: not in the list. Slot held or eaten: skipped. No slot qualifies at accept time: card refused up front. Plan edited between proposal and Accept: recompute is at proposal; Accept applies to the then-current qualifying slots. Unknown edit type fields: `validateReply` drops. 4000-char context cap: drop `cheaper` first, then `perShop`.

## Verification
- `python3 tools/test_hermes_chat_bridge.py`
- `node tools/worker_test.mjs`
- `python3 check.py --changed`
No real credential needed (test fakes only). Same `/swaps` output before and after the extraction is the regression check.

## Tasks
Logic (TDD)
- [ ] `ShoppingList.cheaperSwaps` extracted from `swaps()` (test.html: same output as Phase 76 fixture, `ok` rejection drops a mate, no group = empty); Worker `swaps()` calls it, `worker_test.mjs` Phase 76 block unchanged and green.
- [ ] `validateReply`: `cheaper` accepted with key/to/shopDay, bad shopDay or missing `to` dropped, 4th in a reply dropped (test.html PlanChat block).
- [ ] `applyCheaperEdits`: card text with £, refusal for a pair not offered, Accept writes `slot.subs` only on unheld uneaten matching slots in that shop's days, Undo restores exactly (test.html).
- [ ] `chatContext`: `shop.total`/`perShop` equal `planMetrics(plan).shops`, `cheaper` top 3, JSON stays under 4000 chars with a big plan; keys omitted without packData.
- [ ] Bridge: `EDIT_TYPES` + prompt line; extend the l.20 assert with `cheaper` and `context.shop`.
UI
- [ ] Reply handler builds the cards and the existing Add/No row renders them (follow `ui-build`; check at 390 px and PC, both themes, via `check.py ui`); `sw.js` `CACHE` bumped; `CLAUDE.md` invariant updated.
- [ ] Live: in Plan with Hermes ask "make it cheaper": a swap card shows a £ saving, Add changes the shopping list total by about that, Undo restores it, and later turns quote the new total.
