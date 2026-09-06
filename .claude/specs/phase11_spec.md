# Phase 11 — Pantry-aware shopping

**Goal:** Consume the already-shipped `/pantry` endpoint so the shopping list subtracts
what is already on hand, and give Discover the "using what's left" chip that Phase 7
deferred here.

No new file. No new dependency. No schema change to `meals.json`, `pack-sizes.json`,
`nutrition-targets.json` or the Worker. `worker/worker.js` is **not touched** — Phase 4
shipped `/pantry` complete, this phase is purely its first app-side consumer.

## Decisions taken

| # | Decision | Why |
|---|---|---|
| 1 | Pantry is fetched by a new **`MP.Sync.fetchPantry()`** modelled on `syncPlanFlag()` (plain GET, returns object or `null`), **not** on `syncLibrary()` | Phase 11 only reads. `syncLibrary`'s stamp/`decide`/push machinery exists because the library has a local writer; the pantry has none until Phase 12. `syncPlanFlag` is the existing precedent for a read-only endpoint and is two lines |
| 2 | Last good pantry is mirrored to `localStorage.mp_pantry`; a failed/unconfigured fetch falls back to the mirror | The shopping list is used standing in a supermarket on a phone. Three lines buys offline correctness on the one page that needs it most, and hands Phase 12 the local copy it will write to |
| 3 | Matching is **normalized exact match**: lowercase → non-alphanumeric to `_` → strip one trailing `s` per word, applied to *both* the pantry `name` and the ingredient `key` | Symmetric normalization, so `"Chicken Breasts"` and `chicken_breast` meet in the middle with no per-side special cases. No fuzzy/synonym matching — `ponytail:` comment names the ceiling |
| 4 | Subtraction happens **inside `buildLists`**, after `needed` is computed and before `packsFor()`; `packs` is recomputed from the remainder | The one place all shop days and both categorizations already route through. Callers get pantry-awareness for free |
| 5 | A fully-covered line **stays in `lines`** with `packs: 0`, `lineCost: 0` — no fourth category | `total` already sums `lineCost`, so a covered line costs nothing without any new sum. The tick-state key scheme (`"${shopDay}:${line.key}"`) keeps working untouched. A `covered` flag + CSS is the whole render change |
| 6 | Unparseable / unit-mismatched pantry qty ⇒ **no subtraction**, but the raw text is surfaced as a note | Never silently drop a grocery. `"a bit of rice"` must not delete rice from the list; showing "have: a bit of rice" next to the full quantity lets the human decide |
| 7 | `buildLists` takes pantry as an **optional 4th argument** | `buildLists(plan, mealsById, packData)` with no pantry must behave byte-identically to today, or check groups 11–17 break |
| 8 | The Discover chip **ranks, does not filter** | Same call shape as Phase 10's gap ranking, and a filter over a 10-meal TheMealDB pool against a handful of pantry names produces an empty deck most of the time. Ranking degrades to "today's order" instead of "no cards" |
| 9 | The chip is a **toggle** (`data-filter="pantry"`, `aria-pressed`), separate from `data-cat` | It is orthogonal to category — a category chip picks the pool, this reorders whatever pool is loaded. Reusing `data-cat` would make "chicken" and "using what's left" mutually exclusive, which is wrong |

## What this phase is made of

| Roadmap item | Sections |
|---|---|
| App reads `/pantry` for the first time | §1 `hermes-sync.js` |
| Shopping list subtracts on-hand quantities | §2 `shopping-list.js`, §3 `shopping.js`, §4 `style.css` |
| "Using what's left" Discover chip (deferred from Phase 7) | §5 `discover.js`, §6 `discover.html` |
| Checks | §7 `test.html` group 30 |
| Wiring | §8 |

---

## 1. `hermes-sync.js` — read-only pantry fetch

Add beside `syncPlanFlag()` (line 92), and to the `MP.Sync` export at line 116.

```
MP.Sync.fetchPantry() -> Promise<{ updatedAt: string, items: [{name, qty?}] } | null>
```

- `if (!config().enabled)` ⇒ return the localStorage mirror (or `null`). Unconfigured
  sync must not attempt a fetch against a relative URL.
- `GET /pantry` via the existing `req()`.
- On success: if `Array.isArray(body.items)`, write `JSON.stringify(body)` to
  `localStorage.mp_pantry` and return `body`. A body without an `items` array is
  treated as a failure — same defensive rule as `syncLibrary`'s `Array.isArray(remote.meals)`
  guard, so a malformed blob never wipes the mirror.
- On throw / bad shape: return the parsed mirror, or `null` if there is none. Never throw
  to the caller — every consumer must degrade to "no pantry".
- No `inflight` guard, no `decide()`, no PUT. `ponytail:` comment: read-only mirror,
  Phase 12 adds the write path and whatever conflict rule it needs.

`start()` is **unchanged** — the pantry is fetched on demand by the two pages that use it,
not on every page load.

## 2. `shopping-list.js` — normalization + subtraction

Still pure and DOM-free. Two new exported helpers plus one new `buildLists` parameter.

```
MP.ShoppingList.normalizeKey(text)          -> string
MP.ShoppingList.pantryIndex(pantry)         -> { [normKey]: rawQtyString }
MP.ShoppingList.buildLists(plan, mealsById, packData, pantry?) -> { 1: list, 8: list }
```

**`normalizeKey(text)`** — `String(text)` → lowercase → trim → non-alphanumeric runs to
`_` → strip leading/trailing `_` → strip a single trailing `s` from each `_`-separated
word. `"Chicken Breasts"`, `"chicken-breast"` and `chicken_breast` all yield
`chicken_breast`. Empty/nullish input ⇒ `""`.

`ponytail:` comment on this function: exact match after normalization only — no synonyms,
no plural irregulars, no unit words. `"tin of chopped tomatoes"` will not match
`chopped_tomatoes`. Upgrade path is a small alias map in `pack-sizes.json` if real pantry
data proves it necessary; do not reach for a fuzzy-match library.

**`pantryIndex(pantry)`** — `pantry` may be `null`/malformed ⇒ `{}`. Otherwise reduce
`pantry.items` to `{ [normalizeKey(item.name)]: item.qty || "" }`. Later duplicates win
(the Worker's `pantryError` already rejects case-insensitive duplicate names, so this is
only reachable via normalization collisions, e.g. `"Egg"` + `"eggs"`).

**`buildLists` change** — build `const have = pantryIndex(pantry)` once at the top
(`pantry` omitted ⇒ `{}` ⇒ every branch below is a no-op and output is identical to
today's). Then, in the per-ingredient path **after `needed` is computed and before
`packsFor(needed, item)` is called**:

- `const raw = have[normalizeKey(key)]` — `undefined` ⇒ nothing changes, skip all of this.
- Otherwise set `line.pantryQty = raw || "(some)"` on the emitted line — always, even when
  no subtraction is possible. This is the only thing the user sees for decision 6.
- `const onHand = parseQty(raw)` (reuse the existing parser — same kg→g / l→ml
  normalization as `needed`, so the units are already comparable).
- Subtract only when `needed`, `onHand` and their units all line up:
  `needed && onHand && onHand.unit === needed.unit`. Then
  `needed = { value: Math.max(0, needed.value - onHand.value), unit: needed.unit }` and
  set `line.onHand = onHand`.
- Unit mismatch, unparseable qty, empty qty, or a `needed` of `null` (unmeasured
  ingredient) ⇒ no subtraction, `line.onHand = null`, note still shown.
- `packsFor` then runs on the reduced `needed`. A remainder of `0` must give
  `packs: 0`; add the `if (needed.value <= 0) return 0;` guard in `packsFor` rather than
  relying on `Math.ceil(0 / packSize)` staying 0 through future edits.
- `lineCost` is `packs * price` as today, so it falls to 0 on its own and `total` follows.
  Do not special-case the total.

New optional line fields (everything else in the line shape is unchanged):

| Field | Type | Meaning |
|---|---|---|
| `pantryQty` | `string \| undefined` | Raw pantry text, set whenever a pantry entry matched |
| `onHand` | `{value, unit} \| null \| undefined` | Parsed amount actually subtracted; `null` when matched but not subtractable |

Staples and unpriced lines go through the same code path — a staple you already have still
gets its note. Sorting (lines 115-118) is untouched; covered lines stay in label order
rather than sinking to the bottom, so the list does not reshuffle between shops.

## 3. `shopping.js` — render the note, wire the fetch

- `init()` (line 83): add `MP.Sync.fetchPantry()` to the existing `Promise.all` alongside
  `MP.getLibrary()` / `MP.ShoppingList.load()`, and pass the result as `buildLists`' 4th
  argument. `fetchPantry` never rejects, so the `Promise.all` cannot be poisoned by it.
- `lineHtml(shopDay, line, ticked, showPrice)` (line 32): when `line.pantryQty` is set,
  append `<span class="have">have ${esc(line.pantryQty)}</span>` after the label.
  **`esc()` it** — pantry text is Hermes/user-entered free text arriving over the network,
  same trust boundary as TheMealDB.
- Same function: add `covered` to the `<li class="shop-line">` class list when
  `line.packs === 0`, and render the quantity as the remainder `buildLists` returned (the
  existing `fmtQty(line.needed)` call already does this — no change).
- `blockHtml` (line 48) is unchanged. No new `<details>` block, no reordering.
- Tick state, `mp_shopping_ticked` and its key scheme: unchanged.

## 4. `style.css`

Two rules only:

- `.shop-line .have` — small, muted, inline after the label.
- `.shop-line.covered` — reduced opacity on the label/qty. Do **not** `display: none` a
  covered line; "I thought I had that" is exactly when the user needs to see it.

No change to the shopping list layout, the `details` blocks, or any nav/chip styling.

## 5. `discover.js` — "using what's left" ranking

- New module-level state beside `pool`/`idx`/`activeCat`/`loadFailed` (lines 9-12):
  `let pantryFirst = false;` and `let pantryKeys = null;` (cached index, fetched once).
- New helper beside `libraryGaps()`:
  ```
  async function pantryIndexCached() -> { [normKey]: string }   // {} on any failure
  ```
  `if (pantryKeys) return pantryKeys;` → `MP.Sync.fetchPantry()` →
  `MP.ShoppingList.pantryIndex(...)` → cache → return. Whole body in `try`/`catch`
  returning `{}`, matching `libraryGaps()`'s "degrade to today's deck, never to an empty
  deck or a thrown init" rule.
- New pure local helper:
  ```
  function pantryOverlap(meal, have) -> number   // count of meal.ingredients whose normalizeKey is in have
  ```
- New pure local helper:
  ```
  function orderPool(list, have) -> Array   // stable sort, descending pantryOverlap
  ```
  Must be a **permutation, never a filter** — same length, same ids, zero-overlap meals
  simply come last. Use an index-decorated sort (`map` to `{m, i, s}` → sort by
  `s` desc then `i` asc → `map` back) rather than trusting engine sort stability.
- `loadPool(cat)` (line 241): after the existing gap ranking produces `next`, and
  **before** the `if (cat !== activeCat) return;` stale-response guard and before `pool`
  is assigned — the identical trap Phase 10 documented — apply
  `if (pantryFirst) next = orderPool(next, await pantryIndexCached())`. Rank the local
  `next`; never touch the module-level `pool` from inside the ranking step.
- Chip handler (line 270): the existing delegation is on `.chip[data-cat]`, so it does not
  fire for the new chip. Add a sibling branch for `.chip[data-filter="pantry"]`: flip
  `pantryFirst`, set `aria-pressed`, toggle the `active` class the category chips already
  use, then **re-order the pool in place without refetching** — `pool = orderPool(pool,
  await pantryIndexCached())`, `idx = 0`, re-render. Toggling off re-runs `loadPool(activeCat)`
  to restore the gap order (one cached-pool path is not worth keeping a pristine copy around).
- `ponytail:` comment on `pantryOverlap`: overlap is a raw count, unweighted — a meal
  matching one pantry staple ranks with a meal matching one pantry protein. Weight by pack
  price only if the ordering proves useless in real use.

## 6. `discover.html`

- One chip inside `#discover-filters` (lines 33-43), visually last:
  `<button class="chip" data-filter="pantry" aria-pressed="false">Using what's left</button>`.
  A distinct attribute, not a synthetic `data-cat` value, so the delegation branches cannot
  collide and a category stays selectable while the toggle is on.
- Add `<script src="shopping-list.js"></script>` and `<script src="hermes-sync.js"></script>`
  before `discover.js` (line 71) — Discover now needs `normalizeKey`/`pantryIndex` and
  `MP.Sync`. Both are already in `sw.js`'s `SHELL`, so no cache-list change.
- `shopping.html` already loads `shopping-list.js` (line 39) but **not** `hermes-sync.js` —
  add it before `shopping.js` (line 40).

## 7. `test.html` — check group 30

Next free number after **29** (the file reuses 23/24 mid-file — do not renumber).

- `normalizeKey`: `"Chicken Breasts"`, `"chicken-breast"`, `" Chicken_Breast "` and
  `"chicken breast"` all equal `chicken_breast`; `normalizeKey(null)` is `""` and does not
  throw.
- `pantryIndex(null)`, `pantryIndex({})` and `pantryIndex({items: "nope"})` all return `{}`.
- **Back-compat:** `buildLists(plan, mealsById, packData)` with no 4th argument returns a
  result deep-equal to `buildLists(plan, mealsById, packData, null)`. This is the guard that
  keeps groups 11-17 meaningful.
- Subtraction: a plan needing 800g of an ingredient with pantry `"300g"` yields
  `needed.value === 500` and packs recomputed from 500, not 800.
- Full coverage: pantry qty ≥ needed ⇒ `packs === 0`, `lineCost === 0`, the line is still
  **present in `lines`**, and `total` equals the same list built with no pantry minus that
  line's original `lineCost`.
- Unit normalization crosses the parser: needed `"1kg"` + pantry `"300g"` subtracts (both
  land in `g`), needed `"2 tins"` + pantry `"300g"` does **not** subtract — `onHand` is
  `null`, `pantryQty` is set, `packs` is unchanged from the no-pantry build.
- Unparseable qty (`"a bit"`) and empty qty (`""`): `packs` unchanged, `pantryQty` set.
  This is the "never silently drop a grocery" check.
- Unmeasured ingredient (`qty: ""` in `meals.json`, so `needed` is `null`) with a pantry
  match: does not throw, `packs` unchanged.
- `pantryOverlap`-equivalent ordering: `orderPool` returns a permutation — same length and
  same set of ids as its input, for a non-empty pantry, an empty pantry (`{}`), and a meal
  with `ingredients: []` (scores 0, does not throw).

`discover.js`'s helpers are module-private today; expose `orderPool`/`pantryOverlap` on the
existing `MP.Discover`-style test hook if one exists, otherwise assert only the
`shopping-list.js` half here and cover ordering by hand in the manual pass.

## Confirmed unchanged

| Thing | Why it stays put |
|---|---|
| `worker/worker.js`, `worker/wrangler.toml` | `/pantry` shipped complete in Phase 4; this is its first consumer, not a revision |
| `docs/HERMES.md` | The documented contract is already what the app consumes |
| `meals.json`, `pack-sizes.json`, `shelf-life.json`, `nutrition-targets.json` | No schema change; pantry lives server-side |
| `MP.Sync.syncLibrary` / `decide` / `start()` | Read-only pantry needs none of the last-write-wins machinery |
| `parseQty` behaviour | Reused verbatim on the pantry side — one parser, one set of unit rules |
| `mp_shopping_ticked` keys, `blockHtml`, the staples/unpriced split | Decision 5 exists so none of this has to move |
| Phase 10's gap ranking | Pantry ordering composes on top of it, does not replace it |
| The swipe deck, `POOL_LIMIT`, `excludeIds()` | The chip reorders the pool, it does not widen or filter it |

## 8. Wiring

1. `hermes-sync.js` — `fetchPantry()` + export.
2. `shopping-list.js` — `normalizeKey`, `pantryIndex`, `packsFor` zero-guard, `buildLists`
   4th arg + subtraction, exports.
3. `test.html` group 30 (write before 2 lands, per TDD).
4. `shopping.js` init + `lineHtml`; `style.css` two rules; `shopping.html` script tag.
5. `discover.js` + `discover.html`.
6. `sw.js` — bump `CACHE` to `"meal-planner-v11"`. No `SHELL` additions: no new file, and
   every script newly referenced is already listed.
7. **Manual test pass** (`python3 -m http.server 8000`):
   - With sync unconfigured: shopping list and Discover behave exactly as before; no
     network error in the console; the chip toggles and simply changes nothing.
   - With sync configured and a pantry containing a partial and a full match: the partial
     line shows a reduced quantity plus "have …", the full line greys out at £0, and the
     total drops by exactly that line.
   - Airplane mode after one successful load: the mirror still subtracts.
   - Discover: toggle the chip on/off across two categories, confirm the deck never empties
     and the card count is identical either way.
8. Flip `docs/roadmap.md` Phase 11 to **Status: Complete** in the *same commit* as the
   code — not before.

## Edge cases

| Case | Behaviour |
|---|---|
| Sync unconfigured / never set up | `fetchPantry()` returns the mirror or `null`; `buildLists` gets `null` ⇒ today's list exactly |
| `/pantry` KV key never written | Worker GET returns whatever KV holds; a body without `items` is treated as failure ⇒ mirror or `null` |
| Network down, mirror present | Mirror is used; the list is stale but subtracts |
| Network down, no mirror | No subtraction, no error UI, no console throw |
| Pantry name matches nothing | No line changes — the pantry entry is silently unused (correct: you own things you are not cooking) |
| Pantry qty > needed | Clamped at 0 by `Math.max`, never negative packs, never a negative `lineCost` |
| Same ingredient needed on both shop days | Both days subtract the same pantry amount — the pantry is not a running balance in this phase. `ponytail:` comment; Phase 12's deduction flow is where a balance belongs |
| Normalization collision (`"Egg"` and `"eggs"`) | Later item wins; Worker already blocks the case-insensitive duplicate |
| Malicious/odd pantry text | `esc()` on render; never `innerHTML` with raw pantry text |
| Batch-cook / leftover lines | Untouched — the `leftover_` and `/leftover|from roast/i` skips run before the pantry code is reached |

## Deliberately not built

- **Writing the pantry back** after a shop, or any PUT — Phase 12.
- **In-app pantry editing UI** — Phase 12. Hermes is the only writer in Phase 11.
- **Eat-flow deduction / running balance across shop days** — Phase 12.
- **Fuzzy, synonym or alias matching** — normalized exact match, ceiling named in a
  `ponytail:` comment; add an alias map only if real pantry data demands it.
- **A fourth `covered` list category** and any change to the staples/unpriced split.
- **Pantry-driven filtering** of the Discover deck (as opposed to ranking).
- **Per-SKU or purchase-date pantry tracking** — explicitly out per `CLAUDE.md`.
- **Expiry/shelf-life on pantry items** — `shelf-life.js` stays category-based.
