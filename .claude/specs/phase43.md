# Phase 43: Pantry and leftover read routes: cookable, substitutions, leftovers, quick fallback [L]

Plain: The assistant can tell you what you can cook right now, what leftovers you have (fridge or freezer), and what to eat on a night you're not cooking; the Today card shows your leftovers with "Freeze 1".

Requires Phase 32 (done), Phase 34 (built: `useBy`, `estimateUseBy`, `expiringItems`, `GET /expiring`), Phase 20/31 (`MP.Cooks`, done).
Build in the section order below (A → D); each section is testable alone.

## Decisions

**User-chosen (2026-10-22):**
- **Leftovers sync to the Worker.** `mp_cooks` is local-only today, so the app pushes the whole array to a new KV key
  `cooks` on every change (best-effort, same as `pushEatenLog`). `PUT /cooks` is Hermes-token only (the app's token);
  the assistant only gets `GET /leftovers`.
- **Freezing = "Freeze 1" on the Today strip + a last-day nudge.** Each tap moves one portion from a fridge record to its
  freezer twin. Frozen portions keep `cooked_leftovers.frozenMonths` (3) instead of `fridgeDays` (3). A fridge leftover on
  its last day shows "eat or freeze today" (amber) in the strip and `lastDay: true` on the route. No cook-time split.

**Own calls:**
- **Can-cook check is already shared.** `pantryOverlap` (`shopping-list.js`) is what the generator/Discover use and the
  Worker already imports the module. Extract its per-ingredient test as `hasEnough(ing, have)`; `pantryOverlap` calls it
  (zero behaviour change). No mirrored copy anywhere. No app UI for cookable: parity is the one shared `cookable()`
  function, asserted in test.html and through the Worker on the same fixture.
- **Ingredient count ignores `isSkippedIngredient`** (leftover_ keys) when deciding ready/near-miss. Ready = 0 missing,
  near-miss = 1-2 missing. Hard exclusions via `MP.Exclusions.check` apply. Caps: `?n=` 1-20, default 10 per list.
- **Order everywhere:** use-by urgency (soonest `useBy` among the pantry items the meal uses / the leftover's eat-by),
  `null` urgency last; then `proteinGramsApprox` desc (`MP.Nutrition.dayCoverage([meal], tags, targets)`).
- **No user-entered eat-by on leftovers** (YAGNI: no field exists, and adding a date input per leftover is clutter).
  Eat-by is always the estimate, `basis: "estimate"`. Parked in `docs/FUTURE.md`.
- **Closing a leftover:** eaten (existing "Ate a portion" / assistant eat-requests, both already call `MP.Cooks.take`) or
  "Threw away" (new `MP.Cooks.discard`, sets `portionsLeft: 0`). Waste figures not built.
- **`storage` on pantry items** sits beside `qty`/`useBy`, optional, `"fridge"|"freezer"|"cupboard"`; no migration (absent =
  category default, shown as estimate). Set by the Pantry tab (a small select) or the assistant's `PUT /pantry` (order/pack
  intake). Category default: `fridgeDays` → fridge, `frozenMonths` without `fridgeDays` → freezer, `ambient` → cupboard,
  uncategorised → `null` (never guessed).
- **Frozen use-by:** when effective storage is `freezer` and the category has `frozenMonths`, `estimateUseBy` = shop day +
  `frozenMonths` calendar months; a freezer item whose category has no `frozenMonths` → `null`. Entered `useBy` still wins.
  `/expiring` inherits this (frozen items fall out of a 2-day window naturally).
- **A frozen cooked leftover** shows in `/quick` as `kind: "leftover"` with `storage: "freezer"`, never duplicated as a
  pantry item (leftovers are `mp_cooks` records, not pantry items).
- **`/quick`** mixes: open leftovers (fridge and freezer), pantry items with effective storage `freezer`, and ready
  (0-missing) library meals with `prepEffort: "quick"`. `?n=` 1-20, default 5. Suggestions only; nothing is cooked or deducted.
- **Invariant amendments (edit `CLAUDE.md` in this commit):** pantry item = quantity + optional `useBy` + optional
  `storage`; the Pantry tab writes `useBy` and `storage`, and only those. `MP.Cooks` is mirrored to KV `cooks` via
  `MP.Sync.pushCooks`; the portion-eat path still never touches the pantry.

## Files touched
- `shopping-list.js`: `hasEnough`, `cookable`, `quickPicks` (pure, root-shimmed, exported on `MP.ShoppingList`).
- `shelf-life.js`: `storageFor`, `leftoverView`, `leftoverEatBy`; `estimateUseBy` freezer branch; `addMonths` helper.
- `plan.js`: `MP.Cooks` gains `storage`, `freezeOne`, `discard`; prune via `leftoverEatBy`; `openFor` fridge-first;
  every write calls `MP.Sync.pushCooks`; Leftovers section in `renderTodayCard`.
- `hermes-sync.js`: `pushCooks(records)` (best-effort `PUT /cooks`, never throws), called once from `start()`; new op
  `{ list: "pantry", type: "storage", name, storage }` in `applyOps` (`null`/`""` clears); `add` preserves `storage`.
- `shopping.js`: storage select on each Pantry-tab row (placeholder shows the default as "fridge (est.)").
- `style.css`: leftover rows, amber last-day state, storage select. Tokens only.
- `worker/worker.js`: `KEYS["/cooks"] = "cooks"` + `cooksError`; `itemsError` validates `storage`; `GET /cookable`,
  `GET /substitutions`, `GET /leftovers`, `GET /quick`; add the four GETs to `ASSISTANT_ALLOWED` (not `PUT /cooks`);
  `import SUB_GROUPS from "../substitution-groups.json"`.
- `docs/HERMES.md` (four routes, `storage`, `/cooks`), `CLAUDE.md` (invariants above), `docs/FUTURE.md` (entered eat-by,
  waste figures), `sw.js` bump `CACHE`.
- `test.html`, `tools/worker_test.mjs`, `tools/browser-check/walk.mjs` (one step: Freeze 1 on a seeded leftover).

## Signatures / schemas
```
ShoppingList.hasEnough(ing, have) -> bool
ShoppingList.cookable(library, pantryItems, plan, todayIso, { n, tags, targets, shelfData })
  -> { ready: [Pick], nearMiss: [Pick] }
  Pick = { id, name, prepEffort, proteinGramsApprox, missing: [ingredientName], urgency: { name, useBy, basis, daysLeft } | null }
ShoppingList.quickPicks(library, pantryItems, cooks, plan, todayIso, { n, tags, targets, shelfData }) -> [QuickItem]
  QuickItem = { kind: "leftover", id, mealId, name, portionsLeft, storage, eatBy, basis: "estimate", daysLeft, proteinGramsApprox|null }
            | { kind: "frozen", name, qty, useBy|null, basis: "entered"|"estimate"|null, daysLeft|null, storageBasis }
            | { kind: "meal", ...Pick }
ShelfLife.storageFor(item, shelfData) -> { storage, basis: "entered"|"estimate" } | null
ShelfLife.leftoverEatBy(record, shelfData) -> "YYYY-MM-DD" | null      // cookedAt date + fridgeDays, or + frozenMonths months if storage freezer
ShelfLife.leftoverView(records, todayIso, shelfData) -> [{ id, mealId, name, portionsLeft, storage, cookedAt, eatBy, basis: "estimate", daysLeft, lastDay }]
  // portionsLeft > 0 only, eatBy >= today only, soonest first; lastDay = storage fridge && daysLeft === 0
MP.Cooks.freezeOne(cookId) -> freezer record | null   // fridge -1; twin id `${fridgeId}:frozen` +1 (created if absent)
MP.Cooks.discard(cookId) -> bool
cook record: { id, mealId, name, variantId, cookedAt, portionsLeft, storage?: "fridge"|"freezer" }   // absent = fridge
```
Routes (all GET, both tokens, `?today=` as `/expiring`: ISO else Worker UTC date, bad → 400; the app always sends it):
- `GET /cookable?n=` → `{ today, ready, nearMiss }` from KV `library.meals`, `pantry.items`, `plan`. `n` outside 1-20 → 400.
- `GET /substitutions` → `substitution-groups.json` verbatim.
- `GET /leftovers` → `{ today, leftovers: leftoverView(KV cooks) }`.
- `GET /quick?n=` → `{ today, items: quickPicks(...) }`. `n` outside 1-20 → 400.
`PUT /cooks` body: array of cook records (validated: `id`,`mealId`,`name`,`cookedAt` strings, `portionsLeft` integer ≥ 0,
`storage` absent or fridge/freezer; ≤ 200 records), Hermes token only.

## Edge cases
- Pantry with no dates and no plan: cookable/quick still answer, `urgency: null`, sorted by protein only.
- Empty pantry → `ready: []`, near-miss only for meals with ≤ 2 non-skipped ingredients. Empty freezer → `/quick` still 200.
- KV `library`/`pantry`/`cooks`/`plan` null or malformed → treated as empty, never 500.
- A meal with zero non-skipped ingredients is excluded (not "ready").
- Old cook records with no `storage` = fridge. Frozen record must not be pruned at 3 days (prune uses `leftoverEatBy`).
- Freeze 1 on the last fridge portion leaves the fridge record at 0 (pruned); freezing twice increments the same twin.
- `applyEatRequests`/"Ate a portion" take the fridge record before the freezer one (`openFor` fridge-first, then newest).
- Leftover whose meal was deleted from the library: listed with its stored `name`, `proteinGramsApprox: null`.
- Pantry item `storage` with a bad value from the mirror → ignored (category default). `PUT /pantry` with a bad value → 400
  "storage must be fridge, freezer or cupboard".
- `pushCooks` with no Worker configured is a no-op; failures are swallowed (same as `pushEatenLog`).

## Verification
- `python3 check.py` passes (test.html, worker harness, UI pages + walk at PC and 390 px, both themes).
- test.html: `hasEnough` parity with old `pantryOverlap` cases; `cookable` ready/near-miss/skipped-ingredient/exclusion/
  ordering/cap; no-plan no-date pantry; `storageFor` entered vs each category default vs uncategorised; `estimateUseBy`
  freezer months; `leftoverView` lastDay/ordering/expired dropped; `freezeOne` split + repeat; `discard`; prune keeps a
  frozen record at day 5; `quickPicks` mix and order with an empty freezer; `storage` op set/clear and `add` preserving it.
- `node tools/worker_test.mjs`: `/cookable` returns the same ids as test.html's `cookable` on the shared fixture; the four
  GETs 200 for both tokens, 401 for none; `PUT /cooks` 403 for the assistant token, 400 on a bad record; `?n=99` 400;
  bad `?today=` 400; `PUT /pantry` with bad `storage` 400; round trip keeps `storage`.

## Tasks
### A. Cookable + substitutions (Logic, TDD)
- [ ] `hasEnough` extracted, `pantryOverlap` uses it; test.html parity cases
- [ ] `cookable` in `shopping-list.js`; test.html cases
- [ ] Worker `GET /cookable`, `GET /substitutions`, `ASSISTANT_ALLOWED`; worker_test parity + auth cases
### B. Pantry storage (Logic, TDD → UI)
- [ ] `storageFor`, `addMonths`, freezer branch in `estimateUseBy`; test.html cases
- [ ] `storage` op + `add` preserve in `applyOps`; `itemsError` validation; worker_test round trip
- [ ] UI (`ui-build`): Pantry-tab storage select with "(est.)" default placeholder
### C. Leftovers (Logic, TDD → UI)
- [ ] `leftoverEatBy`, `leftoverView`; `MP.Cooks` `storage`, `freezeOne`, `discard`, prune via eat-by, fridge-first `openFor`
- [ ] `pushCooks` + `PUT /cooks` (Hermes-only, `cooksError`) + `GET /leftovers`; worker_test cases
- [ ] UI (`ui-build`): Leftovers section on `#today-card` (Ate one / Freeze 1 / Threw away, amber "eat or freeze today")
### D. Quick fallback
- [ ] `quickPicks` + `GET /quick`; test.html + worker_test cases
### Docs and close
- [ ] `CLAUDE.md` invariants, `docs/HERMES.md`, `docs/FUTURE.md`, `sw.js` `CACHE`, walk.mjs step
- [ ] `tasks.md` Live line; mark Phase 43 in `docs/roadmap.md` with what was verified
