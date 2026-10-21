# Phase 34: Use-by dates, expiring-soon route and "use it up" [L]

**Requires Phase 33a** (the Pantry tab on `shopping.html`). Build after it; if 33a is not `— done`, stop and say so.
Merged old Phases 34 + 38; build the data part first, the route/suggestions second, one commit.

## Goal
Optional per-item `useBy` (ISO `YYYY-MM-DD`) on pantry items, typed in the app or written by the assistant. A labelled
shelf-life estimate shows when blank. A "use these up" strip on the Pantry tab, `GET /expiring`, and a "use it up" button
that lists existing meals using expiring items. Suggestions only: nothing is cooked, deducted or planned.

## Decisions
**User-chosen (2026-10-21):**
- Entry = a date field on each Pantry-tab row (app) **and** the assistant via `PUT /pantry` (photo intake reads a
  printed date; blank if it can't).

**Own calls:**
- **Invariants amended in this commit** (edit `CLAUDE.md`): "Quantity only: no ... purchase date on a pantry item" becomes
  "quantity, plus optional `useBy`"; "`commitCook` is the only pantry writer" becomes "the only writer of `qty`; the
  Pantry tab's date field also writes `useBy`, and only that". "No purchase-date tracking" stays true: `useBy` is a
  use-by, not a purchase date, and the estimate still comes from shop day.
- `useBy` sits beside `qty` on the item. `parseQty`/`qtyText`/`remainingQty` untouched; a partial eat keeps it
  (`applyOps` `sub` already spreads the item). A full removal drops it with the item.
- **Estimate when blank:** item's category via `INGREDIENT_CATEGORY` (export it from `shelf-life.js`), skipping
  `ambient`/no-`fridgeDays` categories. Date = most recent shop day on or before today (`plan.startDate`, or +7 once
  past day 7; if no plan, no estimate) + `fridgeDays`. No category = omitted, never guessed. Shown "est. use by Thu",
  muted italic, distinct from an entered date.
- **Prompt on add:** the app does not add pantry items, so there is nothing to prompt on. Instead a row with a fresh-category
  item and no `useBy` shows an "Add use-by" link (the date field, collapsed).
- **No generator change** (`generator.js` zero-line diff). Near-expiry reordering is rejected here and parked in
  `docs/FUTURE.md` along with frozen stock (`frozenOn`/`frozenMonths`), which is deliberately not built.
- **No one-tap pin into the plan.** Suggestions open the existing meal sheet.
- **Default window 2 days**, overdue included, `GET /expiring?days=N` (N 0-30, default 2; else 400).

## Files touched
- `shelf-life.js`: export `INGREDIENT_CATEGORY`; add `estimateUseBy(item, plan, todayIso)` and `expiringItems(items, plan, todayIso, days)` (pure, root-shimmed, shared with the Worker).
- `hermes-sync.js`: new op `{ list: "pantry", type: "useBy", name, useBy }` in `applyOps` (empty/null `useBy` clears the field; `add` with no `qty` must keep an existing `useBy`... see edge cases).
- `worker/worker.js`: `itemsError` validates `useBy` (string matching `^\d{4}-\d{2}-\d{2}$` and a real date, else "useBy must be YYYY-MM-DD"); new `GET /expiring` computed from KV `pantry` + `plan`; add `"GET /expiring"` to `ASSISTANT_ALLOWED`.
- `shopping.js` / `style.css`: use-it-up strip, row date field, estimate styling, use-it-up sheet. Tokens only.
- `docs/HERMES.md`: `useBy` on the pantry body, `/expiring`. `CLAUDE.md`: the two invariant edits. `docs/FUTURE.md`: parked items. `sw.js`: bump `CACHE`.
- `test.html`, `tools/browser-check/walk.mjs` (one step).

## Signatures
```
estimateUseBy(item, plan, todayIso) -> "YYYY-MM-DD" | null
expiringItems(items, plan, todayIso, days) -> [{ name, qty, useBy, basis: "entered"|"estimate", daysLeft }]  // soonest first; daysLeft < 0 = overdue
```
`GET /expiring` -> `{ days, today, items: [...as above] }`. `today` from the request's `?today=` (ISO) else Worker UTC date; the app passes its local date.
Use-it-up: `mealsUsing(keys, library) -> [{ meal, hits: [name] }]`, ranked by number of expiring items used then soonest `useBy`; pure helper in `shopping-list.js` using `normalizeKey`; excludes hard-excluded meals via `MP.Exclusions.check`.

## Edge cases
- Old pantry items with no `useBy` load unchanged. Malformed stored `useBy` in the mirror is ignored (treated blank), never thrown.
- Assistant `PUT /pantry` that omits `useBy` on an item it fetched is a write of the whole array: it must fetch-then-write (already HERMES.md rule); document that dropping the field clears it.
- Local `add` op with the same name replaces `qty` only: preserve `useBy`.
- Date in a different local day than the Worker's UTC: the app always sends `?today=`.
- A date field set to a past date is allowed (marks overdue).
- No plan, so no shop day, so no estimate; entered dates still show.

## Verification
test.html: date validation (good/bad/impossible 2026-02-30), entered vs estimate, ambient and uncategorised omitted,
overdue ordering, `sub` op keeps `useBy`, `useBy` op set/clear, old items load, `mealsUsing` ranking and exclusion.
Worker: `/pantry` round trip keeps `useBy`; bad date 400; `/expiring` 200 for both tokens, 403 for none, `?days=99` 400,
estimates carry `basis:"estimate"`. UI via `check.py` at PC and phone, both themes: strip, date entry, estimate styling,
use-it-up sheet. Live (user, `tasks.md`): enter a date on the phone PWA and see it sync to the assistant's `GET /pantry`.

## Tasks
### Logic (TDD)
- [ ] `estimateUseBy`, `expiringItems` + export `INGREDIENT_CATEGORY` in `shelf-life.js`; test.html cases
- [ ] `useBy` op + `add` preserving `useBy` in `applyOps`; test.html cases
- [ ] `mealsUsing` in `shopping-list.js`; test.html cases
- [ ] Worker: `useBy` validation, `GET /expiring`, `ASSISTANT_ALLOWED`
### UI (`ui-build`)
- [ ] Pantry-tab row: entered date / muted estimate / "Add use-by" field
- [ ] "Use these up" strip, soonest first, overdue marked
- [ ] "Use it up" button + sheet listing meals (opens existing meal sheet)
### Docs and close
- [ ] `CLAUDE.md` two invariants, `docs/HERMES.md`, `docs/FUTURE.md`, bump `sw.js` `CACHE`
- [ ] Live check line in `tasks.md`; mark Phase 34 `— done` with what was verified
