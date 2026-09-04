# Phase 3 Spec — Shopping list from the 2-week plan

Roadmap: `docs/roadmap.md` → Phase 3. Source of scope: `docs/OUTLINE.md` lines 40–46.
Read `SPEC.md` before touching planning logic. Phase 2's generator output
(`.claude/specs/phase2_spec.md` §3) is what this phase aggregates — batch runs and
`leadsTo` chains are load-bearing here, not incidental.

## Decisions taken (user-confirmed)

| Gate | Decision |
|---|---|
| 1. Quantities | **Path A** — parse the existing free-text `qty` string with one regex. No `meals.json` schema migration. Unparseable/empty ⇒ "as needed", 1 pack. |
| 2. UI home | **Path B** — new `shopping.html` page, third nav link on all three pages, added to the service-worker shell so it works offline in-store. |
| 3. Staples & tick-off | **Path B** — `staple: true` in the pack data moves an item to a collapsed "Check you have these" group excluded from the total; per-line checkboxes persisted in `localStorage`, cleared when the plan is regenerated. |
| Data file | `pack-sizes.json`, keyed by the same ingredient `key` as `meals.json`. Unknown keys (Discover-added TheMealDB meals) go to an "unpriced — check in store" group, never silently dropped. |
| Caching | `sw.js` `CACHE` → `"meal-planner-v3"`, all four new files added to `SHELL`. |

---

## 0. The data reality this phase is built on

Verified against `meals.json` — **47 ingredient entries across 13 meals, of which only
about 10 carry a parseable quantity**:

```
"qty": "500g"      "qty": "2 slices"   "qty": "1 tin"   "qty": "1"      "qty": "1-2"
"qty": ""          "qty": "grated"     "qty": "whole"   "qty": "Bisto"  "qty": "roasted"
"qty": "handful, grated"               "qty": "from roast"              "qty": "splash"
```

Consequence, stated plainly so nobody treats it as a bug later: **with today's data most
lines will resolve to "1 pack" of the default pack size.** That is the correct output —
you buy one bag of rice whether the recipe wanted 60g or 80g. The upgrade path is *data*
(fill in `qty` strings over time), not code. Leave a `ponytail:` comment saying so at
`parseQty`.

The 29 purchasable ingredient keys currently in use (plus `leftover_chicken`, which is
never bought):

```
baked_beans  banana  beef_mince  broccoli  cannellini_beans  carrots  cheese
chicken_breast  chicken_roast  chilli_beans  chorizo  egg  frozen_veg  gravy
greek_yogurt  milk  oats  onion  pasta  peanut_butter  peppers  potatoes  rice
salmon  teriyaki_sauce  tortillas  tuna_tin  white_bread  white_sauce
```

---

## 1. New data file: `pack-sizes.json`

Same hand-maintained pattern as `shelf-life.json` / `ingredient-nutrient-tags.json`
(`docs/OUTLINE.md:80` — no public Asda API, entered by hand). Nested under `items` so the
file can carry a staleness marker without special-casing an underscore key.

```json
{
  "pricesAsOf": "2026-09",
  "items": {
    "beef_mince": { "label": "Beef mince, 5% fat", "packSize": 500, "unit": "g",      "price": 4.00 },
    "white_bread": { "label": "White loaf",        "packSize": 16,  "unit": "slices", "price": 1.10 },
    "gravy":      { "label": "Gravy granules",     "packSize": 1,   "unit": "each",   "price": 1.60, "staple": true }
  }
}
```

### Field contract

| Field | Type | Rule |
|---|---|---|
| `label` | string | Display name. Falls back to `MP.labelize(key)` if absent — don't duplicate what `labelize` already gets right. |
| `packSize` | number | Amount in one Asda pack, in `unit`. |
| `unit` | `"g" \| "ml" \| "each" \| "slices" \| "tins"` | **Must be the unit the meals express that ingredient in.** `white_bread` is `slices`, not `g`, because every recipe says "2 slices". Getting this wrong silently degrades the line to 1 pack. |
| `price` | number | GBP, pack price. |
| `staple` | boolean, optional | `true` ⇒ "Check you have these" group, excluded from the total. Absent ⇒ `false`. |

### Seed values

Seed all 29 keys above. Prices are the maintainer's estimate to be corrected in-store —
say that in a comment-equivalent (`pricesAsOf`), don't pretend they're authoritative.

Default `staple: true` on condiments/long-life sauces only: `gravy`, `teriyaki_sauce`,
`white_sauce`, `peanut_butter`. Everything else unflagged. This is the user's own data
file — re-flagging to taste is a one-line edit, not a code change.

---

## 2. New module: `shopping-list.js` (pure logic)

Sibling of `nutrition.js` / `shelf-life.js` / `generator.js`. Same `MP.*` IIFE shape, no
DOM, no `localStorage`, all inputs passed in. This is the file `test.html` loads.

```js
window.MP.ShoppingList = { load, buildLists, parseQty, packsFor };

/** Fetch + cache pack-sizes.json. Mirrors MP.ShelfLife.load(). */
load() -> Promise<PackData>

/**
 * Split a plan into the two shop-day lists.
 * Pure: no DOM, no fetch, no localStorage. Same inputs => same output.
 * @param {{startDate?: string, days: Array}} plan   as stored at localStorage["mp_plan"]
 * @param {Object<string, Meal>} mealsById
 * @param {PackData} packData                        pack-sizes.json contents
 * @returns {{ "1": ShopList, "8": ShopList }}
 */
buildLists(plan, mealsById, packData)
```

### Return shapes

```
ShopList := {
  shopDay : 1 | 8,
  lines   : Line[],     // priced, non-staple — sorted by label
  staples : Line[],     // staple:true       — sorted by label
  unpriced: Line[],     // key absent from packData.items — sorted by label
  total   : number      // sum of lines[].lineCost only. Never includes staples or unpriced.
}

Line := {
  key      : string,
  label    : string,
  needed   : { value: number, unit: string } | null,   // null = "as needed"
  packSize : number | null,
  unit     : string | null,
  packs    : number,          // >= 1
  price    : number | null,   // pack price
  lineCost : number,          // packs * price, or 0 when price is null
  meals    : string[]         // distinct meal names using it, for the "why" line
}
```

`total` rounded to 2dp **once, at the end** — never accumulate pre-rounded line costs.

---

## 3. `parseQty(qtyText)` — the free-text parser

```js
/**
 * Pull a leading number + unit out of a human-written qty string.
 * @param {string} qtyText
 * @returns {{value: number, unit: string} | null}   null = unquantified
 */
parseQty(qtyText)
```

Rules, in order:

1. Blank/whitespace ⇒ `null`.
2. Match `/^\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|slices?|tins?|tbsp|tsp)?/i` against the string.
   No match at the start ⇒ `null` (this is what catches `"handful, grated"`, `"Bisto"`,
   `"whole"`, `"roasted"`, `"splash"`, `"any shape"`, `"from roast"`).
3. Normalise: `kg` → `g` ×1000, `l` → `ml` ×1000, `slice`→`slices`, `tin`→`tins`,
   lowercase. A bare number with no unit ⇒ `unit: "each"` (`"1"` banana, `"1-2"` eggs).
4. **Ranges take the lower bound.** `"1-2"` ⇒ `{1, "each"}` — the regex stops at the first
   number, which gives this for free. Under-buying an egg is recoverable; the alternative
   is parsing ranges nobody wrote deliberately.
5. `tbsp`/`tsp` parse but will almost never unit-match a pack, so they land at 1 pack via
   §4. That's fine and intended.

Add a `ponytail:` comment: *naive leading-number parse; the fix for imprecise totals is
filling in `qty` in meals.json, not a smarter parser.*

---

## 4. `packsFor(needed, item)` — rounding to real pack sizes

```js
/**
 * @param {{value:number, unit:string}|null} needed
 * @param {{packSize:number, unit:string}|null} item
 * @returns {number} packs to buy, always >= 1
 */
packsFor(needed, item)
```

- `item` missing (unknown key) ⇒ `1`.
- `needed` null ⇒ `1`. ("as needed" — one pack.)
- `needed.unit !== item.unit` ⇒ `1`. Do **not** guess cross-unit conversions; a recipe
  asking for "2 tbsp" of something sold in grams gets one pack and no invented maths.
- Otherwise `Math.max(1, Math.ceil(needed.value / item.packSize))`.

Worked: 900g mince against a 500g pack ⇒ 2. 500g against 500g ⇒ 1. 28 slices of bread
against a 16-slice loaf ⇒ 2.

---

## 5. Aggregation — the part that must not double-buy

### 5a. Which (day, meal) pairs count as a *purchase*

Walk `plan.days` ascending, and for each day walk `slots` in order
`breakfast, lunch, dinner, snack`. Each non-null `mealId` is a purchase occurrence
**except**:

> **Batch dedupe (dinner slot only):** skip a dinner whose `mealId` is identical to the
> *previous day's* dinner `mealId` **and** whose meal has `batchCook: true`.

Rationale, and why both conditions are needed:

- Batch-cook/leftover chains are a **dinner** primitive (`CLAUDE.md`, Architecture
  invariants). Porridge on 14 consecutive mornings is fourteen breakfasts, not one batch —
  never dedupe breakfast/lunch/snack.
- The `batchCook` condition matters because a non-batch dinner repeated on consecutive days
  means you genuinely cooked it twice. (Phase 2's variety guard makes this rare, not
  impossible.)
- A batch meal's `qty` **already describes the whole batch** — `beef_mince: "500g"` is
  3 servings per `SPEC.md:26`. So one occurrence per *cook*, and **no scaling by
  `servings` or by run length.** Scaling would double-buy on top of the dedupe.
- Non-consecutive repeats (day 3 and day 9) are two separate cooks and both count. They
  fall in different shop weeks anyway.

### 5b. Which ingredients within a counted meal are bought

Skip an ingredient when **either**:

1. `ing.key` starts with `"leftover_"` (e.g. `leftover_chicken` in `chicken-fajitas`), or
2. `ing.qty` matches `/leftover|from roast/i`.

Condition 2 is not redundant — it is the one real trap in this data:
`toastie-chicken-cheese` uses `{"key": "chicken_breast", "qty": "leftover, sliced"}`, a
**non-`leftover_` key that is nonetheless not bought**. Without this guard the list buys a
chicken breast for a toastie made from Sunday's roast. There is a test for exactly this.

Everything else in a `leftoverOf` child meal **is** bought — `chicken-fajitas` still needs
tortillas, peppers, onion, rice, cheese and cannellini beans.

### 5c. Which shop day a purchase lands in

`MP.ShelfLife.shopDayFor(day)` — `1` for days 1–7, `8` for days 8–14. Reuse it; do not
re-implement the `<= 7` test. Assignment is by the **cook/eat day**, so a batch cooked on
day 7 and eaten on day 8 is bought in shop 1, which is correct.

### 5d. Summing

Per shop day, group occurrences by ingredient `key`. Within a group:

- Sum `parseQty(ing.qty)` values across occurrences **only where every occurrence in the
  group parses to the same unit**. Any `null` or unit disagreement in the group ⇒
  `needed: null` for the whole line (one mixed line is "as needed", not a bogus subtotal).
- `packs = packsFor(needed, item)`; `lineCost = packs * price` (`0` when unpriced).
- `meals` = distinct meal names, insertion-ordered.

Route the line to `staples` if `item.staple`, to `unpriced` if the key is absent from
`packData.items`, otherwise to `lines`.

### Edge cases to handle explicitly

| Case | Behaviour |
|---|---|
| No plan in `localStorage` | Page renders an empty state + link to `plan.html`. `buildLists` is never called with `null`. |
| Plan with `mealId: null` slots | Skipped silently; a half-empty plan still produces a list. |
| `mealId` not in `mealsById` (deleted from library) | Skipped; do not throw. |
| Meal with `ingredients: []` or missing | Contributes nothing. |
| Every line unpriced | `total` is `0`; UI shows the unpriced group, not "£0.00 total" as if shopping were free. |
| Pre-Phase-2 plan with no `startDate` | Works — nothing here reads `startDate` except the tick-off key (§7). |

---

## 6. `shopping.html` + `shopping.js` (page controller)

Split follows the existing convention exactly: pure module (`shopping-list.js`, loaded by
`test.html`) vs. page controller (`shopping.js`, DOM + `localStorage`), the same way
`generator.js` splits from `plan.js`.

### Page structure

Copy `plan.html`'s head/nav/script scaffolding verbatim, then:

```html
<main>
  <section class="section">
    <h2>Shopping list</h2>
    <p id="shopping-meta" class="muted"></p>   <!-- "From your plan starting Mon 7 Sep · prices as of 2026-09" -->
  </section>
  <div id="shopping-root"></div>
</main>
```

`#shopping-root` gets two blocks, one per shop day, built as one HTML string and injected
once — same approach as `renderPlan()`:

```html
<section class="shop-block">
  <h3>Shop day 1 <span class="shop-total">£23.40</span></h3>
  <ul class="shop-list">
    <li class="shop-line">
      <label>
        <input type="checkbox" data-shop="1" data-key="beef_mince">
        <span class="shop-qty">1 × 500g</span>
        <span class="shop-name">Beef mince, 5% fat</span>
        <span class="shop-price">£4.00</span>
      </label>
      <span class="shop-why">Chilli con carne</span>
    </li>
  </ul>

  <details class="shop-extra">
    <summary>Check you have these (4)</summary> ... staples ...
  </details>
  <details class="shop-extra">
    <summary>Unpriced — check in store (2)</summary> ... unpriced ...
  </details>
</section>
```

- `<details>`/`<summary>` is the native collapse — no JS, no accordion component.
- Native `<input type="checkbox">` inside a `<label>` gives the whole row as a tap target
  and keyboard/screen-reader behaviour for free. Do not build a custom toggle.
- Ticked line ⇒ `.ticked` class on the `<li>` (strikethrough + dimmed). The total does
  **not** change when items are ticked — a total that moves while you shop is a total you
  can't sanity-check against the till.

### Escaping — non-negotiable

`line.meals` contains meal names, and a Discover-added TheMealDB meal's name is **untrusted
third-party content** (`CLAUDE.md`, architecture invariants). Every `label`, `meals` entry
and `key` interpolated into the HTML string goes through `MP.esc()`. Numbers may be
interpolated directly.

### Empty state

No `mp_plan` in storage, or a plan with no meals:
`<p class="empty">No plan yet — <a href="plan.html">generate a 2-week plan</a> first.</p>`

---

## 7. Tick-off persistence

```
localStorage["mp_shopping_ticked"] = { "startDate": "2026-09-07", "keys": ["1:beef_mince", "8:rice"] }
```

- Key format `"<shopDay>:<ingredientKey>"` — the same ingredient can be ticked
  independently in week 1 and week 2.
- On load: if the stored `startDate` !== `plan.startDate`, **discard the whole record** and
  start empty. That is the "cleared on regenerate" rule, and it costs one comparison — no
  separate clear-on-generate hook in `plan.js`, which would be a second place to forget.
- A plan with no `startDate` (pre-Phase-2) stores `startDate: null`; comparison still works.
- Written on every checkbox `change`. One delegated listener on `#shopping-root`, not one
  per line.

---

## 8. Wiring

**Nav** — add to `index.html`, `plan.html` and `shopping.html`, after the 2-Week Plan link,
with `class="active"` on the current page only:

```html
<a href="shopping.html">Shopping</a>
```

**`shopping.html` script includes**, in this order:

```html
<script src="data.js"></script>
<script src="shelf-life.js"></script>
<script src="shopping-list.js"></script>
<script src="shopping.js"></script>
<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");</script>
```

`nutrition.js`, `swipe.js`, `mealdb.js` and `generator.js` are **not** needed here — don't
copy `plan.html`'s include list wholesale. `shelf-life.js` is required, for `shopDayFor`.

**`sw.js`** — add `"shopping.html"`, `"shopping-list.js"`, `"shopping.js"`,
`"pack-sizes.json"` to `SHELL` **and bump `CACHE` to `"meal-planner-v3"`**. Without the
bump, installed PWAs keep serving the v2 shell and never fetch any of it. `test.html` stays
out of the shell.

**`style.css`** — `.shop-block`, `.shop-line`, `.shop-qty`, `.shop-name`, `.shop-price`,
`.shop-why`, `.shop-total`, `.ticked`, `.shop-extra`. Reuse existing card/nav colour tokens;
dark mode is the default and must be styled first.

**No changes to** `generator.js`, `nutrition.js`, `meals.json`, `plan.js` or the plan
schema. This phase is purely additive over Phase 2's output.

---

## 9. Verification (TDD — write the check first, watch it fail)

Same runner as Phase 2: `test.html`, `check(name, condition)` + `deepEqual`, no framework.
Add `<script src="shopping-list.js"></script>` to its includes and pass literal fixtures to
the pure functions (never `load()`).

1. `parseQty`: `"500g"`→`{500,"g"}`; `"2 slices"`→`{2,"slices"}`; `"1.5kg"`→`{1500,"g"}`;
   `"1-2"`→`{1,"each"}`; `""`, `"handful, grated"`, `"Bisto"`, `"whole"` → `null`.
2. `packsFor`: 900g/500g pack ⇒ 2; 500g/500g ⇒ 1; `null` needed ⇒ 1; unit mismatch
   (`{2,"tbsp"}` vs a `g` pack) ⇒ 1; unknown item ⇒ 1.
3. **Batch dedupe:** a plan with `chilli-con-carne` as dinner on days 5, 6 and 7 yields
   `beef_mince` **once** at 500g / 1 pack — not 3. *The loudest check in this phase; it is
   the one that fails if someone "simplifies" the dedupe away.*
4. **Non-batch repeat is not deduped:** the same non-`batchCook` breakfast on days 1 and 2
   counts twice.
5. **Leftover exclusion, both forms:** `chicken-fajitas` contributes `tortillas` but not
   `leftover_chicken`; `toastie-chicken-cheese` contributes `white_bread` and `cheese` but
   **not** `chicken_breast` (its `qty` is `"leftover, sliced"`).
6. **Shop-day split:** a dinner on day 7 lands in list `1`; the same meal on day 8 lands in
   list `8`.
7. **Unknown key** (a fabricated Discover ingredient absent from the fixture pack data)
   lands in `unpriced` and contributes `0` to `total`.
8. **`staple: true`** lands in `staples` and is excluded from `total`.
9. `total` equals the hand-computed sum of `lines[].lineCost` for a small fixture plan.

Plus one manual pass (UI, so it can't be asserted): serve, generate a plan, open
`shopping.html` — two blocks appear, totals look plausible, ticking survives a reload,
regenerating the plan clears the ticks, and the page still renders with the network off
after one visit (PWA shell).

---

## 10. Out of scope / notes for later

- **No new dependency.** Regex parsing, `<details>`, `<input type="checkbox">` and
  `localStorage` are all native. Nothing here justifies a units library or a framework.
- **Not built, deliberately:** printing/exporting the list, a "remaining total as you tick"
  figure, price history, per-store switching, or grouping by supermarket aisle. Add the
  aisle grouping first if the list ever gets long enough to be annoying in-store.
- **`docs/FUTURE.md`** already parks per-meal cost tags *because* this phase covers the
  budget need — leave that entry alone, don't build it here.
- **Known ceiling to record, not fix:** most `qty` fields are empty, so most lines are
  "1 pack" and the total is a floor, not an estimate. The fix is filling in `meals.json`
  quantities over time. Worth one line in `docs/FUTURE.md` once the phase ships.
