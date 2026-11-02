# Phase 119: Finish shop review and Freezer drawer [M]
Plain: pressing Finish shop opens one review sheet where you confirm what you bought, split any of it between "use this week" and the freezer, and one Confirm puts it all in the pantry (with Undo); the Pantry tab gets an "In the freezer" group showing how long each thing has been frozen.

Prototype: `design-prototypes/ui-concepts/stock-b.html` (review sheet `#rv`, `rowHTML`/`splitHTML`, `confirmRv`, `prow`/`drawPantry`; pantry-tab styling from the existing checklist, commit 3d6cc8f).

**Requires Phase 116** (unbuilt; spec `.claude/specs/phase116.md`). It adds the dock's `Finish shop` button, `drawDock`, the `finishShop()` wrap-up handler and `MP.ShoppingList.progress`. This phase replaces `finishShop()`'s body. If 116 is not built when this builds, stop: the entry point does not exist (do not invent the dock).

## Decisions

User-chosen (2026-11-01):
- **Split storage**: the freezer half of a split item is its own pantry item named `"<name> (frozen)"` (`storage: "freezer"`); the fridge/cupboard half keeps the plain name. The pantry is keyed by name and the Worker's `itemsError` rejects duplicates, so one name can never hold both halves. No schema change for the split.
- **Weeks frozen**: new optional pantry-item field `frozenOn` (ISO date). Set only on freezer items, only by this review's Confirm. It is "when it went in the freezer", not a purchase date. Worker `itemsError` accepts it; CLAUDE.md's pantry invariant gets one clause.

Own calls:
- **Sheet**: opens from the dock's Finish shop (enabled as Phase 116 defines). One row per ticked plan line (`packs > 0`, state `got`); skipped and unticked lines are left out, listed in a "Left out, not ticked: …" note. Ticked ad-hoc (`x:`) lines get a row too (unpriced, no plan need, no split chip). Two-column stepper "Use this week | To freezer" (`+`/`−` move one `step` between them; the two always sum to the bought amount), an editable Amount, storage radio (Fridge / Freezer / Cupboard), Use-by date, and a "Rest after plan" chip that sets the freezer part to `amount − plan need` (clamped 0..amount). A line with `bulk.freeze > 0` opens already split with that prefill. Defaults: amount = the list line's `needed` (value+unit) or `packs` as a plain number when no `needed`; storage from `MP.ShelfLife.storageFor` (`.storage`); use-by from `MP.ShelfLife.estimateUseBy` or empty.
- **Freezer half**: use-by defaults to `MP.ShelfLife.addMonths(today, 3)`, `frozenOn` = today. A row whose storage radio is Freezer is wholly frozen: no split, it keeps the plain name with `storage: "freezer"` and the same `frozenOn`/use-by defaults; only a split creates the `(frozen)` item.
- **Adding to existing stock**: if the pantry already holds the item and both quantities `parseQty` with the same unit, the new qty is the sum; otherwise the bought amount replaces it (`add` replaces today) and the row shows a "replaces what you had" note. Pure helper `MP.ShoppingList.sumQty(have, add)` (`shopping-list.js`) next to `remainingQty`, structured `{ value, unit, raw }` result like `remainingQty`.
- **Single batch + Undo**: Confirm builds ops with the pure `MP.ShoppingList.reviewOps(rows, pantryItems, todayIso)` → `{ ops, undoOps }`, then writes once via `MP.Sync.writeLocalItems("pantry", applyOps(...))` and `queueOp` per op (the existing op log; no new route or KV key). `undoOps` restores each touched name to its prior state (`remove` for a name that did not exist; `add` with the old qty plus `storage`/`useBy`/`frozenOn` ops for one that did). Toast "N entries added to the pantry, M in the freezer" with Undo (`toast(msg, label, fn)` in `app.js`). After Confirm the dock's Finish shop button also does Phase 116's wrap-up (delete the ticked ad-hoc lines, with Undo restoring them to `got`); one toast, one Undo that reverses both.
- **New op type** `frozenOn` in `applyOps` (`hermes-sync.js`): valid ISO date sets it, anything else clears it; the `add` branch's no-qty rebuild also keeps `frozenOn` (like `useBy`/`storage`). A pantry item that stops being `storage: "freezer"` (the existing `storage` op) drops `frozenOn`.
- **Pantry tab "In the freezer" group**: items with `storage === "freezer"` (not `out`), shown first, sorted oldest `frozenOn` first. Chip: `"N wk"` or "just frozen" (< 1 week); "· use soon" from 8 weeks (`MP.ShelfLife.frozenWeeks(item, todayIso)` pure → whole weeks or `null` with no `frozenOn`; a freezer item without `frozenOn` shows no weeks chip). The remaining items form "Fridge & cupboard". Existing row behaviour (tick = used up, inline qty edit, remove, add item, storage select) is unchanged. Hermes-created freezer items without `frozenOn` just have no chip.
- **"Fill from order photo"** is a disabled stub button with the note "Hermes will read a photo of your order and fill this in. Not built yet." No handler, no route.
- **Second pantry writer**: this adds a second app-side `qty` writer next to `commitCook` (the review's Confirm), and extends the Pantry tab's writes to include `frozenOn` via the review only. CLAUDE.md invariants updated (see Files touched). The review never deducts stock, never touches Cooks, `eatPortion` or the food log, and the generator/`rankByGap`/`buildLists` still do not read `frozenOn`.
- **Planner reads**: `(frozen)` items are `storage: "freezer"`, already excluded from `pantryIndex`-style live stock (`shopping-list.js` `live` filter, line 532) and the shelf-life/cook reads; do not add the name to any matcher. Leftover logic that reads freezer items (`shopping-list.js:175`) is unchanged.

## Files touched
- `shopping-list.js`: `MP.ShoppingList.sumQty`, `reviewOps`, added to the `MP.ShoppingList` export. Pure; Worker already imports the file (root shim in place), so no shim change.
- `shelf-life.js`: `MP.ShelfLife.frozenWeeks` (added to the export). Pure.
- `hermes-sync.js`: `applyOps` `frozenOn` op; `add` no-qty branch keeps `frozenOn`; `storage` op drops it for non-freezer.
- `worker/worker.js`: `itemsError` accepts `frozenOn` (ISO date or absent). Rerun `node tools/routes_build.mjs` only if a route changes (none does). Add one case to `tools/worker_test.mjs` (bad `frozenOn` rejected, good accepted).
- `shopping.js`: replace Phase 116's `finishShop()` body with `openReviewSheet()` / `confirmReview()`; Pantry tab freezer grouping in `pantryHtml`; wiring in `renderPantry`.
- `shopping.html`: the review sheet container (`#shop-review`, dialog markup like the meal sheet).
- `style.css`: review sheet, stepper split, freezer group chips, dark and light, reduced motion. Tokens from `docs/UI_STYLE.md`, no new colour.
- `sw.js`: `CACHE` bump (first Logic task).
- `test.html`: `sumQty`, `reviewOps`, `frozenWeeks`, `applyOps frozenOn` cases.
- `tools/browser-check/walk.mjs`: assertions below.
- `CLAUDE.md`: (1) pantry-writer invariant (the line "`plan.js`'s `commitCook` remains the only pantry **writer**" and the `qty` line "`commitCook` is the only app-side writer of `qty`") gains "the Finish shop review's Confirm (Phase 119, `shopping.js` `confirmReview`, via `reviewOps`) is the second, one batch with Undo"; (2) the `qty`/pantry-field line gains `frozenOn` ("freezer items only, set only by that review; not a purchase date"); (3) "The Pantry tab never writes the pantry" line (products invariant) stays true for the Pantry tab and needs no change. Grep `commitCook` and `pantry writer` to find the exact lines.
- `docs/ARCHITECTURE.md`: only if it states "commitCook is the only pantry writer" (grep `only pantry`).

## Signatures
- `MP.ShoppingList.sumQty(have, add)` (pure) → structured qty or `null` when units differ/unparseable. Consumer: `reviewOps`.
- `MP.ShoppingList.reviewOps(rows, pantryItems, todayIso)` (pure) → `{ ops, undoOps }`. `rows` = `[{ name, amount: {value,unit}|null, freeze: number (same unit, 0..amount), store, useBy, wholeFreezer }]`. Emits `add`/`storage`/`useBy`/`frozenOn` ops (all with `list: "pantry"`). Consumer: `confirmReview` writes `ops` and keeps `undoOps` for the toast.
- `MP.ShelfLife.frozenWeeks(item, todayIso)` (pure) → integer or `null`. Consumer: `pantryHtml`.
- `shopping.js`: `openReviewSheet()` (consumer: the dock Finish shop button), `confirmReview()` (consumer: the sheet's Confirm button; also runs Phase 116's ad-hoc wrap-up and the single toast).

## Edge cases
- No ticked plan lines (only ad-hoc, or none): sheet still opens with the ad-hoc rows or an empty "Nothing ticked" state; Confirm just does the wrap-up.
- Amount edited to 0 or blank: the row is dropped from the batch (no zero-qty `add`); freeze clamps to the amount.
- Unit-less/uncountable lines (`needed` null, e.g. essentials): amount is a plain count; `sumQty` returns null and the bought value replaces.
- `(frozen)` item already in the pantry: second shop sums into it (same name, same unit) and refreshes `frozenOn` to today and `useBy`.
- A pantry item marked `out` and re-bought: `add` clears `out` (existing behaviour).
- Offline: ops queue as today; Undo queues the inverse ops.
- Confirm twice: the button disables on first press.
- Excluded/hard-exclusion content is not involved (no meals written).

## Verification
`python3 check.py` (pass `timeout 600000`; or `python3 check.py --changed`) covers data_check, test.html, `worker_test.mjs` and the ui pages; the walk runs inside it. `node tools/worker_test.mjs` for the Worker case alone. No real credential needed.

`walk.mjs` (fresh profile, seeded plan, a pantry seeded with one existing item, PC and 390 px, dark and light, `--shots`) asserts each of:
- (a) Finish shop opens the review sheet with one row per ticked plan line; a skipped line and an unticked line have no row and appear in the "Left out" note;
- (b) a `bulk.freeze` line opens pre-split and the two stepper values always sum to the amount; the "Rest after plan" chip sets the freezer part to amount − plan need;
- (c) the disabled "Fill from order photo" button is present and does nothing;
- (d) Confirm writes `mp_pantry` once: a split row yields a plain-name item and a `"<name> (frozen)"` item with `storage: "freezer"` and `frozenOn` = today; no duplicate normalised names;
- (e) a row for an item already in the pantry with a matching unit sums the quantities;
- (f) Undo restores `MP.Sync.localItems("pantry")` exactly to its pre-Confirm value (deep equal) and the ad-hoc lines return to `got`;
- (g) the Pantry tab shows "In the freezer" first, a seeded item with `frozenOn` 9 weeks ago shows "9 wk · use soon", one frozen today shows "just frozen", a freezer item with no `frozenOn` shows no chip;
- (h) the sheet closes on Escape, focus returns to Finish shop, and at 390 px there is no horizontal scroll and no console errors;
- (i) Confirm leaves `mp_cooks`, `mp_eatenLog` and the plan unchanged (only the pantry and the ad-hoc list change).

Screenshots: `node tools/browser-check/ui-check.mjs --theme-key mp_theme --shots out/`, compared with `stock-b.html` by eye through `prototype-preview` at 390 px and PC, both themes.

## Tasks
Logic (TDD)
- [ ] 1. `sw.js` `CACHE` bump; `sumQty`, `reviewOps` (`shopping-list.js`), `frozenWeeks` (`shelf-life.js`) + `test.html` cases (sum same unit / unit mismatch, split into two items, whole-freezer row, existing-item sum and replace, undoOps inverse, `frozenWeeks` boundaries 0/7/56 days and no date); run `python3 data_check.py`.
- [ ] 2. `hermes-sync.js` `frozenOn` op in `applyOps` (+ `test.html` case: set, clear on bad date, kept by qty-less add, dropped when storage leaves freezer); `worker/worker.js` `itemsError` + `tools/worker_test.mjs` case.
- [ ] 3. `shopping.js`: `openReviewSheet` (rows from the first shop block's ticked lines, ad-hoc rows, left-out note, defaults) and `confirmReview` (batch write, single toast with Undo, Phase 116 wrap-up); `shopping.html` container; Pantry tab freezer grouping and chips.
- [ ] 4. `CLAUDE.md` invariant edits (and `docs/ARCHITECTURE.md` if it carries the statement).

UI (follow `ui-build`)
- [ ] 5. `style.css`: review sheet, stepper split, freezer group and chips, light and dark, reduced motion.
- [ ] 6. `walk.mjs`: assertions (a) to (i).
- [ ] 7. Look at both themes at 390 px and PC with `prototype-preview` against `stock-b.html`; fix differences.
