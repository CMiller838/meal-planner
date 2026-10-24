# Phase 65: Use-it-up week [M]
Plain: one tap builds a fortnight that cooks your soon-to-expire pantry items first, then fills the rest by nutrition as usual.

Requires: Phases 34 (`ShelfLife.expiringItems`) and 43 (`storage`), both built. Phase 64 also adds a `prefs` field (`noBatch`) and 66 a slot flag; this phase adds only `prefs.useUp`, no new `generatePlan` argument, so the three merge cleanly.

## Decisions
- **Mode is a pref, not a new generator** (own call): `prefs.useUp = { items: [{ name, useBy }], window }`. Absent/empty = today's plan, byte-identical. `generatePlan`'s signature is unchanged.
- **Stock only reorders the shortlist** (roadmap + CLAUDE.md pantry rule): new `rankSlot` layer 3d, after ratings and before budget. Of the first `window` meals `rankByGap` ranked, those using an eligible expiring item move to the head, most items first then soonest `useBy`; everything else keeps order. Never re-scores, never filters; a meal outside the window is not lifted, so nutrition still decides.
- **Eligible** = item's `useBy` falls on/after that slot's date (`startDate + dayNum - 1`; an already-overdue item is eligible on day 1, user decides if it is safe). Once `place()` schedules a meal using an item, the item is **consumed** and stops lifting later meals (the plan uses each once, not a week of onion dishes). Match by `ShoppingList.normalizeKey` on ingredient key vs item name, same as `mealsUsing`.
- **Items come from** `MP.ShelfLife.expiringItems(items, plan, today, 14, shelfData)` minus `out` items (Phase 39), `useBy` entered or estimated (reuse, no new tracking). Frozen/`storage:"freezer"` items are skipped: they do not expire this fortnight.
- **`window`** is data: `pack-sizes.json` `planning.useUpWindow` (default 6), no inline constant.
- **Entry points** (own call, no gate): a "Use it up" button beside Generate on `plan.html` (confirm like Generate, then `regenerate()` with `useUp` on; the pref is per-call, never stored in `mp_planPrefs`), and `POST /plan/draft` gains optional `useUp: true` so Hermes gets parity (Worker builds items from its `pantry` KV). Button hidden/disabled with a toast "Nothing is expiring" when the list is empty.

## Files touched
- `generator.js`: `rankSlot` layer 3d + doc comment; `generatePlan` keeps a `useUpLeft` set, `place()` consumes. Worker imports it: no `window.` at top level.
- `shopping-list.js`: `MP.ShoppingList.useUpItems(pantryItems, plan, todayIso, shelfData)` (thin wrapper: `expiringItems` + drop `out`/freezer) so app and Worker share one builder.
- `pack-sizes.json`: `planning.useUpWindow`.
- `plan.js` (`generatePlan()` ~l.133, button handler ~l.1205), `plan.html` (button next to `#generate-btn`, l.43).
- `worker/worker.js` `draftPlan` (~l.233): accept `useUp`, set `prefs.useUp`; update the `/plan/draft` route note (~l.1130).
- `sw.js` `CACHE` bump; `test.html`; `tools/worker_test.mjs`. Load order unchanged (no new cross-file dep).
- `CLAUDE.md`: one line in Architecture invariants: use-up is a per-call pref, reorders the shortlist only, never stored.

## Signatures
- `useUpItems(pantryItems, plan, todayIso, shelfData) -> [{ name, useBy }]` (soonest first)
- `rankSlot(..., opts)`: `opts.prefs.useUp`, plus `opts.useUpLeft` (Set of normalized names still unconsumed; generatePlan owns it)
- `POST /plan/draft` body: `{ ..., useUp?: boolean }` (non-boolean -> 400)

## Edge cases
- No expiring items, or `useUp` absent: plan identical to today's (assert by deep-equal in test).
- Item matches no library meal: ignored silently. Three expiring items all in one meal: that meal wins once, all three consumed.
- Hard exclusions/`never`/allergies still filter first; a use-up meal that is excluded is simply not in `ranked`.
- Slot types: applies to every slot's pool (breakfast/lunch/snack too); batch parent consumes on day 1 of its run, leftovers do not re-consume.
- Junk `useBy` handled by `expiringItems` (treated blank).

## Verification
- `python3 check.py` passes (test.html assertions below + worker harness + ui checks).
- `node tools/worker_test.mjs` covers `/plan/draft` with `useUp`.
- Asserts: library of 12 meals, 3 pantry items with `useBy` days 2/4/6 each used by exactly one meal, each placed on or before its day; with `useUp` absent the plan equals the baseline; a meal outside the window is never lifted; a consumed item does not lift a second meal; `useUp` + 3-meal library still fills every slot.
- Browser (`tools/browser-check`, fresh profile, seeded pantry): button visible, toast when empty, plan changes when stocked; PC + 390 px, both themes.

## Tasks
Logic (TDD)
- [ ] `ShoppingList.useUpItems` + test.html asserts (drops `out`, drops freezer, soonest first)
- [ ] `rankSlot` layer 3d + `generatePlan` consume set + the asserts above
- [ ] `pack-sizes.json` `planning.useUpWindow`; `plan.js` `generatePlan()` passes `useUp` when asked
- [ ] Worker `draftPlan` `useUp` flag + `worker_test.mjs` case
UI (`ui-build`)
- [ ] "Use it up" button beside Generate Plan, empty-state toast, both themes at PC and 390 px
- [ ] Bump `CACHE` in `sw.js`; add the `CLAUDE.md` invariant line
- [ ] Live: with real pantry use-by dates, press Use it up and confirm the expiring items show in the first meals
