# Phase 90a: Freezer-first placement and bulk buys across the plan [L]
Plain: Hermes can put meals you already have in the freezer into the plan, and suggest buying bigger packs that also cover
later weeks; the shop list changes only once you accept.

Requires Phase 88 (`MP.placeSlots`, `chatBriefing`, `context.brief`, the confirm-card pattern; spec `.claude/specs/phase88.md`).
Phase 90b (`.claude/specs/phase90b.md`) builds on this one; the Decisions below cover both.

## Decisions
User-chosen (2026-10-26):
- **Bulk buys are proposals.** Hermes sends a `bulk` edit; the app shows a card "Buy 1 kg chicken thighs on shop 1, freeze
  500 g, saves £1.20 over the plan" [Accept] [No]. Only Accept writes `plan.bulk`; the shopping list changes then.
- **Fridge mode input** (90b): typed in the chat, session-only, never written to the pantry. Photos go to Hermes on Telegram,
  which already updates the pantry through `PUT /pantry` (Phase 30); fridge mode reads the pantry.
- **Missing items in fridge mode** (90b): placed, with a note "needs X, Y" (never a refusal).

Own calls:
- **Freezer first = a `place` of an existing cook.** `place` gains optional `cookId` (an `MP.Cooks` record id, either
  storage). The slot is stored `{ mealId, fromCook: cookId }`. `MP.placeSlots` checks: record exists with
  `portionsLeft` > the number of other `fromCook` slots already pointing at it, the record's meal is the `mealId`, the slot is
  a dinner or lunch, and the slot date is on or before the record's `eatBy` (`MP.ShelfLife.leftoverView`). Each failure is a
  refusal note. The generator is not taught this (Hermes plans; one-tap Generate stays as it is).
- **A `fromCook` slot buys nothing**: `purchaseOccurrences` (`shopping-list.js:273`) skips it, as it does `frozenFrom`.
  `MP.ShelfLife.defrostNotes` adds the night-before note when the record's storage is `freezer`. Eating it takes that record:
  the eat sheet passes `slot.fromCook` to `eatPortion` when the record is still open (else today's `cooksOpenFor` order).
  Never touches the pantry (cook vs portion invariant).
- **Bulk data**: `pack-sizes.json` `items.<key>` gains optional `bulk: { packSize, price, label }` (same units as the item).
  Seed about 8 entries (chicken thighs 1 kg, beef mince 1 kg, chicken breast 1 kg, rice 2 kg, pasta 1 kg, frozen peas 1 kg,
  oats 1 kg, cheddar 800 g) priced as Asda estimates; a Live task checks them. Data, not inline constants.
- **Bulk is allowed only for keys that keep**: the key's shelf-life category has `frozenMonths` (it's frozen at shop) or no
  `fridgeDays` (cupboard). Fridge-only keys are refused with a reason.
- **`plan.bulk = [{ key, shopDay }]`** is plan state (beside `shopAnchor`), written only by the app's Accept on the bulk card.
  `buildLists` applies it: on `shopDay` the line for `key` is sized to the summed need of that shop and every later shop in
  the plan, priced at the bulk pack (`ceil(need / bulk.packSize)` packs, plus normal packs when cheaper for the rest:
  ponytail: greedy, bulk packs first, then the cheapest normal mix for the remainder; enough for two pack sizes). Later
  shops drop that key's line. The line carries `bulk: { freeze, coversDays }` (`freeze` = amount beyond that shop's own need,
  in the item's unit) for the "freeze 500 g" note. `planMirror` copies `bulk` so Worker `GET /shopping` matches the app.
- **Total cost over the plan**: `MP.ShoppingList.bulkOptions(plan, byId, packData, shelfData)` returns, per bulk-able key
  used on two or more shops, `{ key, label, shopDay, normal, bulk, saving, kept }`: `normal`/`bulk` = summed £ over all shops
  of the plan, `kept` = £ value of the remainder left after the last day (pro rata of the bulk price), and `saving` =
  `normal - (bulk - kept)`. Only keys with `saving > 0` are returned. The horizon is the plan length (1-28 days).
- **`buildLists` covers the whole plan**, not a fixed 14 days (`shopping-list.js:295` builds shop days from
  `length: 14`, so days 15-28 have no group). Shop days come from `plan.days.length`.
- **Brief additions** (Phase 88's `chatBriefing`): `cooks: [{ cookId, mealId, name, portions, storage, eatBy }]` (open
  `MP.Cooks` records), `shopDays: [n]`, each meal and variant gets `cost` (`MP.ShoppingList.mealCost(...).total`, rounded
  to 0.01), and `bulk: bulkOptions(...)`. Trim order when over 60000 (Phase 88's rule) is unchanged; `cost` is kept.
- **`bulk` edit** `{ type: "bulk", key, shopDay }` (key <=60) in `MP.PlanChat.validateReply`'s NORM; at most 5 per reply.
  The app recomputes `bulkOptions` and refuses a key that isn't there (no saving, not bulk-able, not on 2+ shops) with a note.
  Hermes's own `saving` figure is never shown; the card shows the app's numbers.
- **Bridge prompt** (`tools/hermes_chat_bridge.py`): one shop a week; use `cooks` (freezer first) before buying; propose
  `bulk` from the brief's list only; pick cheaper variants by `cost`; plan batch cooks with leftover and freezer chains.
- **Undo / exit**: an accepted bulk card has Undo (removes the entry). Bulk entries live in the working plan, so Exit leaves
  `mp_plan` untouched (`guidedActive`). On roll (`data.js` ~575, where `frozenFrom` shifts) `shopDay` shifts the same way;
  an entry that falls below day 1 is dropped (the remainder is then whatever the user put in the pantry).

## Files touched
- `plan-chat.js`: NORM `place.cookId` (<=120), `bulk`; `describe` line for `bulk`.
- `data.js` (Worker-imported, shimmed: no top-level `window`): `placeSlots` `fromCook` checks (ctx gains `cooks`); roll
  shifts `plan.bulk`; `heldAt`/held helpers unchanged (`fromCook` is not held).
- `shopping-list.js` (shimmed): `purchaseOccurrences` skips `fromCook`; `buildLists` shop days from plan length, applies
  `plan.bulk`; new `bulkOptions`; export both.
- `shelf-life.js` (shimmed): `defrostNotes` handles `fromCook` with a freezer record (needs the cooks list as a 3rd arg;
  callers pass `MP.Cooks.all()` or `[]`; the Worker caller passes KV `cooks`).
- `plan.js`: `chatBriefing` additions; `applyChatEdits` passes `cooks` to `placeSlots` and routes `bulk` to a card;
  bulk card (Accept / No, then Undo) beside Phase 88's meal cards; eat sheet uses `slot.fromCook`; `defrostNotes` callers.
- `hermes-sync.js`: `planMirror` copies `slot.fromCook` and `plan.bulk`.
- `pack-sizes.json`: `bulk` entries. `worker/worker.js`: `/shopping` and `/swaps` already call `buildLists` on the mirror;
  check the `defrostNotes` call site, if any, passes KV cooks.
- `tools/hermes_chat_bridge.py` + `tools/test_hermes_chat_bridge.py`: prompt lines.
- `test.html`, `tools/worker_test.mjs`: asserts. `sw.js`: CACHE bump. `data_check.py`: validate `bulk` shape if it
  validates `pack-sizes.json` items.
- `CLAUDE.md`: one invariant line (a `fromCook` slot buys nothing and eats via `eatPortion`, never the pantry; `plan.bulk` is
  written only by the bulk card's Accept and read only by `buildLists`/`bulkOptions`; generator never reads either).
  `docs/HERMES.md` Planning chat section: `cookId`, `bulk`, brief fields.

## Signatures / schemas
- Slot: `{ mealId, fromCook?: string, ...existing }`. Plan: `{ ..., bulk?: [{ key, shopDay }] }`.
- `MP.placeSlots(plan, places, byId, ctx)` with `ctx.cooks: [cookRecord]` (added). Consumer: `applyChatEdits` (as Phase 88).
- `MP.ShoppingList.bulkOptions(plan, byId, packData, shelfData) → [{ key, label, shopDay, normal, bulk, saving, kept }]`.
  Consumers: `chatBriefing` (brief `bulk`), `applyChatEdits`'s `bulk` branch (validate + card numbers).
- `buildLists(...)` line gains `bulk?: { freeze, coversDays: [n] }`. Consumers: shopping page line note ("freeze 500 g",
  `shopping.js` renderer), Phase 90b's shop panel.
- `MP.ShelfLife.defrostNotes(plan, mealsById, cooks)`. Consumer: `plan.js:1062` Today card.
- NORM `bulk { key <=60, shopDay int 1-28 }`, max 5; `place.cookId?` string <=120.

## Edge cases
- Two `place`s pointing at a cook with 1 portion left: the second is refused ("only 1 portion left").
- `cookId` for an eaten-out or discarded record: refused. Record past `eatBy` on the slot's day: refused.
- `bulk` for a key used on one shop only, or where the bulk pack costs more: refused with a note.
- Bulk accepted, then the chat removes every later use: `buildLists` still sizes to the real need (may then be a single
  normal pack); the card's saving is not rewritten (numbers were for that moment).
- Units differ between the bulk pack and a meal's qty (e.g. "2 thighs" vs g): that need is treated as unknown, as
  `buildLists` does today; `bulkOptions` skips a key with any unknown need.
- A 21-day and a 28-day plan: `buildLists` returns 3 / 4 shop lists without throwing.
- Plan without `bulk` or with no cooks: output identical to today (regression asserts).

## Verification
- `python3 check.py` (test.html: `placeSlots` cookId accept and each refusal incl. over-allocation; `purchaseOccurrences`
  skip; `buildLists` 28-day plan; bulk application moves later lines to the first shop with `freeze`; `bulkOptions` saving
  and `kept`; roll shifts/drops `bulk`; `planMirror` keeps `fromCook`/`bulk`; validateReply `bulk`/`cookId`;
  `defrostNotes` with a freezer cook; bridge self-test prompt lines).
- `node tools/worker_test.mjs` (`GET /shopping` on a mirror with `bulk` matches app `buildLists`).
- Browser run with a mocked Worker chat (Playwright, `tools/browser-check`), as in Phase 88: a reply with a freezer `place`
  and one `bulk` shows the slot card and a bulk card; Accept then Undo; the defrost note appears on the day before.
  PC and 390 px, both themes. No real credential needed.

## Tasks
Logic (TDD):
- [ ] `shopping-list.js`: shop days from plan length (test a 28-day plan first)
- [ ] `fromCook`: `purchaseOccurrences` skip, `placeSlots` checks, `planMirror`, `defrostNotes` + callers
- [ ] `pack-sizes.json` `bulk` seeds; `bulkOptions`; `buildLists` applies `plan.bulk`; roll shifts it; `planMirror`
- [ ] `plan-chat.js` NORM `bulk` + `place.cookId`; `chatBriefing` cooks/shopDays/cost/bulk
- [ ] `applyChatEdits`: `cooks` into `placeSlots`; `bulk` → recompute, refuse or card
- [ ] Eat sheet takes `slot.fromCook`; bridge prompt + self-test; worker_test case
UI (`ui-build`):
- [ ] Bulk card (Accept / No, Undo) in the chat; "freeze N" note on shopping lines; "from freezer" tag on `fromCook` cells
- [ ] Docs: HERMES.md, CLAUDE.md invariant line; bump `sw.js` CACHE
