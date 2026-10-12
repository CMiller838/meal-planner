# Phase 30 — Hermes quantity ingestion (screenshot → structured quantities)

A pantry item's `qty` may now carry a **structured** quantity —
`{ value, unit, raw }` — instead of only free text. Hermes reads a shopping
screenshot, and writes those quantities through the **existing**
`GET /pantry` → merge → `PUT /pantry` relay. The app accepts, persists,
round-trips and displays them.

This phase ships **no visible user feature** and that is deliberate (roadmap
`docs/roadmap.md:137-153`): it lands the data *shape* before Phase 31 builds
remainder arithmetic on top of it. On screen the only difference is that a
pantry-sourced "have 500 g" line reads what the screenshot said instead of
whatever free text was typed.

## Decisions

### Answered by the user at this phase's gates

| Gate | Pick | Meaning |
|---|---|---|
| 1 — shape | **A** | `{ value, unit, raw }`. When `qty` is an object, **all three are required**; `value` a finite number, `unit` and `raw` non-empty strings. |
| 2 — location | **A** | Extend the **existing** `pantry` items. **No new KV key, no new route, no new endpoint.** |
| 3 — metadata | **A** | **Quantity only.** No `price`, no `packSize`, no store, no purchase date on the item. |

Consequences, stated once so no task re-opens them:

- Gate 2 makes the Worker diff one **validator** change, not a route change.
  `PUT /pantry` already is the fetch-then-write, shape-validated,
  whole-array-replace relay the outline's Constraints name
  (`docs/OUTLINE.md:396-403`). A `POST /pantry-qty`-style second write path
  would be a second way to write the same key — rejected.
- Gate 3 keeps this out of `pack-sizes.json`'s territory. Pricing stays
  manually maintained data (`CLAUDE.md`), unrelated to what's in the pantry.
- Gate 1's `raw` is what makes the change backwards-compatible: every existing
  display site can render a structured qty by reading `raw`, and every
  existing parser can keep working because `{value, unit}` is *already*
  exactly what `MP.ShoppingList.parseQty` returns today.

### Calls made without a gate (they follow from the above)

- **`qty` stays one field, string-or-object.** Not a second sibling field
  (`qty` + `quantity`). Two fields for one concept is the thing that rots, and
  `raw` already holds what the string held.
- **Scope is pantry items only**, not `meals.json` ingredient `qty`. Gate 2
  picked the pantry as the location, and pantry is what Phase 31 reads. Library
  ingredient `qty` stays free text, unchanged, and `PUT /library`'s validation
  is untouched.
- **`MP.ShoppingList.parseQty` is the one place structure is understood**, and
  it already produces `{value, unit}`. Teaching it to accept an object at the
  top is a 3-line change that makes `mealCost`, `buildLists` and
  `MP.Sync.applyOps`'s `"sub"` branch structured-aware for free — no new
  parser, no second code path.
- **`MP.qtyText(qty)` in `data.js` is the one place text is extracted.**
  Display sites currently interpolate `item.qty` straight into HTML; an object
  would render `[object Object]`. One accessor, three call sites.
- **A structured qty collapses to a string after a cook deduction.**
  `applyOps`'s `"sub"` branch writes `fmtRemaining(have, used)`
  (`hermes-sync.js:180-183`), which returns display text. The result re-parses
  correctly (`"350 g"` → `{350, "g"}`), so nothing breaks; the `raw`
  screenshot provenance is simply gone once the item has been partly used.
  Preserving it is Phase 31's problem, not this phase's — noted as a
  `ponytail:` comment, not fixed here.
- **`unit` is not enum-validated at the Worker.** `docs/HERMES.md`'s contract
  is shape-validation only; a unit whitelist in the Worker would reject a
  screenshot reading `"bunch"` and lock the user out of their own data. The
  app normalizes what it knows (`UNIT_MULT`) and treats the rest as an opaque
  unit string, which is exactly today's behaviour for free text.
- **No new dependency, no build step** (`CLAUDE.md`).

## Findings (verified, do not re-derive)

- `worker/worker.js:172-183` — `itemsError(body)` validates `/pantry` and
  `/adhoc`: `items` must be an array, each item a non-empty `name`, no
  duplicate names (case-insensitive, trimmed). **`qty` is not validated at
  all today.** Routed via `VALIDATE` (`worker.js:254-264`) and the generic key
  handler (`worker.js:286-321`), which `JSON.parse`s the body
  (`worker.js:298`) and `env.MP_KV.put(kvKey, body)`s it (`worker.js:317`).
  Auth is the `X-Auth-Token` compare at `worker.js:272`. `KEYS`
  (`worker.js:18-22`) already maps `"/pantry"` → `"pantry"`.
- `shopping-list.js:48-59` — `parseQty(qtyText)` → `{ value, unit } | null`.
  Normalizes `kg`→`g`, `l`→`ml` via `UNIT_MULT` (`shopping-list.js:10`),
  defaults a bare number to `unit: "each"`. Carries the ponytail note at
  `shopping-list.js:43-47` ("the fix for imprecise totals is filling in
  meals.json quantities, not a smarter parser").
- `shopping-list.js:83-90` — `pantryIndex(pantry)` stores `item.qty || ""` per
  `normalizeKey(item.name)`. An object already passes through this line
  untouched — **zero diff needed here**.
- `shopping-list.js:93-95` — `pantryOverlap` tests truthiness of the indexed
  value only; an object is truthy. Zero diff.
- `shopping-list.js:214-224` — `buildLists` reads `have[normalizeKey(key)]`
  into `raw`, then `pantryQty = raw || "(some)"` (**display**, line 217) and
  `onHand = parseQty(raw)` (**arithmetic**, line 218). These two lines are the
  whole of the shopping-list impact.
- `shopping.js:44` — `${line.pantryQty ? ... esc(line.pantryQty) ...}` renders
  the "have X" chip; `shopping.js:91` renders ad-hoc `esc(item.qty || "")`.
  Both are string-interpolation sites.
- `hermes-sync.js:143-150` — `localItems(list)` / `writeLocalItems(list, items)`
  persist `{ updatedAt, items }` to `mp_<list>`; both are shape-agnostic
  (JSON round-trip), so a structured `qty` survives storage with **no change**.
- `hermes-sync.js:171-197` — `applyOps(items, ops)`: `"sub"` goes through
  `MP.ShoppingList.parseQty` (lines 180-181) then writes `fmtRemaining(...)`;
  `"add"` sets `item.qty = op.qty` verbatim (lines 187, 190). Op shape is
  `{ list, type, name, qty? }` with a free-text `qty` — **unchanged by this
  phase** (the app's own ops stay text).
- `data.js:14-19` — `esc(str)`, exported as `MP.esc` (`data.js:299`).
  `data.js:107-141` — `parseIngredients` produces `{ key, qty, label }` with a
  free-text `qty`; **out of scope**, unchanged.
- `sw.js:4` — `CACHE = "meal-planner-v22"` (Phase 29).
- `test.html` group 45 is Phase 28's; Phase 29 added none, so the new group is
  **46**.

## Non-goals

- **No new endpoint, no new route, no new KV key, no `POST`** (Gate 2). The
  Worker gains validator lines only; its route table is a zero-line diff.
- **No Asda scraping, no live/unofficial grocer API** (`docs/OUTLINE.md:396`,
  `docs/FUTURE.md`). The only source of quantities is Hermes reading a
  user-sent screenshot and PUTting the merged array.
- **No image handling in this repo.** The app never sees a screenshot; OCR /
  image input lives entirely in Hermes.
- **No remainder arithmetic, no plan-wide pantry depletion, no running
  balance** — that is Phase 31 (`generator.js:148`'s note stands).
- **No `meals.json` quantity backfill**, no bulk data-entry pass, no change to
  `data.js`'s ingredient parsing or `PUT /library` validation.
- **No price, pack size, store or purchase date** on a pantry item (Gate 3) —
  and therefore still no per-SKU or purchase-date shelf-life tracking
  (`CLAUDE.md`).
- **No UI to enter a structured quantity by hand.** The ad-hoc `qty` input
  (`shopping.js:104`) keeps producing free text.
- **No migration.** Existing string `qty` values stay strings forever; the two
  forms coexist permanently.

### Invariants this phase must not break

- **`commitCook` remains the only pantry writer**; `eatPortion` still touches
  nothing pantry-related. This phase adds no write path — Hermes's write is
  the pre-existing `PUT /pantry`.
- **Category-based shelf-life stays the default** for any item without a
  tracked quantity. Nothing in `shelf-life.js` changes.
- **Pantry stock never reorders nutrition.** `generator.js` is a zero-line
  diff; `pickVariant` still only chooses a variant of an already-chosen meal.
- **No `innerHTML` with unescaped external content.** `raw` comes from Hermes
  reading a photo — it is untrusted third-party text and must go through
  `esc()` at every render site (it does: the `qtyText` calls sit *inside* the
  existing `esc(...)`).
- **Cost/pack-size data stays data** in `pack-sizes.json`; Gate 3 keeps the
  pantry out of it.
- Fetch-then-write, whole-array-replace semantics for `/pantry` are unchanged.

## §1 `worker/worker.js` — `itemsError()` learns `qty`

The phase's only Worker change; no route, no `KEYS`, no CORS, no auth change.

```js
/** null when the qty is acceptable, else a reason string.
 *  Accepts: absent, free-text string, or { value, unit, raw }. */
function qtyError(qty)   // (any) -> string|null
```

Rules (all-or-nothing, matching the endpoint's existing style):

| `qty` | Verdict |
|---|---|
| absent / `undefined` / `null` | OK (unchanged) |
| `string` (any, including `""`) | OK (unchanged — free text stays legal) |
| object with finite numeric `value`, non-empty string `unit`, non-empty string `raw` | **OK (new)** |
| object missing/mis-typed any of the three | `400` — names which field |
| object with `NaN`/`Infinity` `value`, or `value < 0` | `400` |
| array, number, boolean | `400` (a tightening — today these silently pass) |

`itemsError` (`worker.js:172-183`) calls `qtyError(item.qty)` inside its
existing per-item loop and returns that reason prefixed the same way its
current messages are. Extra object keys are ignored, not rejected (the rest of
the relay is equally tolerant), but nothing else is *promised* — Gate 3 means
`price`/`packSize` are simply not part of the contract.

> This is a trust boundary: `qty` arrives from an outside agent and lands in
> KV that the app then reads. Validating it is not the corner to cut.

## §2 `data.js` — one accessor

```js
/** Display text for a pantry/ad-hoc qty in either form.
 *  string -> itself; { value, unit, raw } -> raw; anything else -> "". */
function qtyText(qty)   // (string|object|undefined) -> string
```

Exported as `MP.qtyText` beside `MP.esc` (`data.js:299`). Prefers `raw`
verbatim — it is what the screenshot said, which is more honest than
re-rendering `value + unit`. Falls back to `value + " " + unit` only if `raw`
is missing (it cannot be, per §1, for anything that came through the Worker —
but local mirrors predate no rule at all).

`data.js`'s ingredient parsing is **not** touched.

## §3 `shopping-list.js` — `parseQty` accepts the object

```js
function parseQty(qty)   // (string|object|undefined) -> { value, unit } | null
```

One guard added at the top of the existing function
(`shopping-list.js:48-59`), before the free-text path:

- `qty` is a non-null object with a finite `value` and a string `unit` →
  build `{ value, unit }` from those fields, run it through the same
  `UNIT_MULT` normalization the text path uses (so `{3, "kg"}` →
  `{3000, "g"}`), and return it.
- Anything else → today's regex path, byte-identical.

The doc comment at `shopping-list.js:43-47` keeps its ponytail note and gains
one line: structured quantities skip the parse entirely.

Every existing caller is then correct with no diff — `mealCost`
(`shopping-list.js:131`), `buildLists`'s ingredient totals
(`shopping-list.js:198`), `buildLists`'s `onHand` (`shopping-list.js:218`),
and `applyOps`'s `"sub"` branch (`hermes-sync.js:180-181`).

**One line changes in `buildLists`** (`shopping-list.js:217`):

```js
pantryQty = MP.qtyText(raw) || "(some)";
```

`pantryIndex` (line 87) and `pantryOverlap` are **zero-diff** — an object is
truthy and passes through `item.qty || ""` unchanged.

## §4 `shopping.js` — two display sites

| Line | Change |
|---|---|
| `shopping.js:44` | `esc(line.pantryQty)` — **no change.** §3 already made `pantryQty` a string. |
| `shopping.js:91` | `esc(item.qty \|\| "")` → `esc(MP.qtyText(item.qty))` — ad-hoc items can receive a structured qty from a Hermes write to `/adhoc` (same validator). |

The ad-hoc add form (`shopping.js:104, 127-133`) is unchanged: typed input
stays free text.

Check for any other site that interpolates a **pantry or ad-hoc** `qty`
directly; `plan.js:186` and `app.js:167` interpolate *meal ingredient* `qty`,
which is out of scope and must **not** be changed.

## §5 `sw.js`

- Bump `CACHE` (line 4) `"meal-planner-v22"` → `"meal-planner-v23"`.
- No shell-array change — no new file ships.

## §6 Docs

- **`docs/HERMES.md`** — the one externally-visible deliverable of this phase.
  - The `/pantry` row in the capability table (line 17) and the
    `GET /pantry` / `PUT /pantry` section (lines 52-59): `qty` is a free-text
    string **or** `{ value, unit, raw }` — all three required when structured,
    `value` a finite non-negative number, `unit` and `raw` non-empty strings.
    `raw` is what the screenshot literally said. Unit is not enum-checked;
    prefer `g`/`ml`/`each` where the screenshot allows. Unchanged: whole-array
    replace, fetch-then-write, no read-after-write.
  - The same sentence on `/adhoc` (lines 61-69), which shares the validator.
  - A new capability-table row: reading a shopping screenshot → structured
    pantry quantities, via `GET /pantry` → merge into the existing items by
    name → `PUT /pantry`. Explicitly **not** a new endpoint, and explicitly
    never a source of price data.
- **`docs/roadmap.md`** Phase 30 (lines 137-153): record the resolved shape
  (`qty` string-or-`{value,unit,raw}`, existing `PUT /pantry`, no new key,
  quantity-only) and mark shipped.
- **`CLAUDE.md`** — one Architecture-invariants bullet: a pantry/ad-hoc `qty`
  is a free-text string **or** `{ value, unit, raw }`; `MP.ShoppingList.parseQty`
  is the only reader of its structure and `MP.qtyText` the only reader of its
  text; quantity only (no price/pack size/purchase date — pricing stays
  `pack-sizes.json`'s job and shelf-life stays category-based); quantities
  arrive through the existing `PUT /pantry` relay, never a new endpoint.
- **`docs/ARCHITECTURE.md`** — note the dual-form `qty` beside the pantry/sync
  description.
- **`SPEC.md`** — untouched (no planning rule, nutrition target or plan-slot
  change).

## Edge cases

| Case | Required behaviour |
|---|---|
| `qty: { value: 500, unit: "g", raw: "500g Tesco spinach" }` | Accepted; `parseQty` → `{500, "g"}`; shopping list shows `have 500g Tesco spinach`; subtracts 500 g from that ingredient's need when units match. |
| `qty: { value: 2, unit: "kg", raw: "2kg" }` | `UNIT_MULT` normalizes to `{2000, "g"}` — same as the text path does for `"2kg"`. |
| `qty: { value: 500, unit: "g" }` (no `raw`) | `400` from the Worker (Gate 1: all three required). A locally-stored one predating validation still renders via `qtyText`'s `value + unit` fallback. |
| `qty: { value: "500", unit: "g", raw: "500g" }` | `400` — `value` must be a number, not a numeric string. |
| `qty: 500` (bare number) | `400`. Tightening of today's unvalidated field; Hermes must send a string or the object. |
| `qty: ""` / `qty` absent | Unchanged — item is "present, amount unknown"; the list shows `(some)`. |
| Structured qty, unit the pack data doesn't share (`"bunch"` vs `"g"`) | `onHand` is discarded for arithmetic (`shopping-list.js:219-223`, existing behaviour) but **still displayed** as `have <raw>`. No crash, no wrong subtraction. |
| A cook deducts from a structured item | `applyOps` `"sub"` → `fmtRemaining` → item becomes a **string** qty. Still correct, `raw` provenance lost. Expected; Phase 31 owns preserving it. |
| Hermes PUTs a structured qty for an item the app doesn't have | Normal `/pantry` whole-array-replace semantics — the item appears. No new behaviour. |
| Two devices / app and Hermes writing concurrently | Unchanged last-write-wins on the whole array (`hermes-sync.js:22-28`). This phase adds no merge logic. |
| `raw` containing HTML (`"<b>2kg</b>"`) | Rendered escaped — it passes through `esc()` at every site. Screenshot text is untrusted. |
| Old app version reading a structured qty | Pre-Phase-30 code renders `[object Object]`. Acceptable: single-user app, PWA cache bumped to v23; not worth a migration. |
| `generator.js` / `pickVariant` | Zero diff. It only tests pantry truthiness via `pantryOverlap`. |

## §7 Tests — `test.html` group 46

Pure functions only (`test.html` is DOM-free by design). Group 46, "Phase 30 —
structured quantities":

- `parseQty("500g")` and `parseQty({ value: 500, unit: "g", raw: "500g" })`
  return the **same** `{500, "g"}`.
- `parseQty({ value: 2, unit: "kg", raw: "2kg" })` → `{2000, "g"}`
  (normalization applies to both forms).
- `parseQty({ unit: "g", raw: "g" })`, `parseQty({ value: NaN, ... })`,
  `parseQty(null)`, `parseQty(undefined)`, `parseQty("")` → `null`.
- `parseQty` on every existing free-text case still returns what it did
  (regression: at least one bare number, one `kg`, one unparseable string).
- `qtyText` — string in / same string out; object → `raw`; object without
  `raw` → `"500 g"`; `undefined` → `""`; never returns `[object Object]`.
- `pantryIndex` keeps a structured qty intact (`typeof idx.spinach ===
  "object"`), and `pantryOverlap` still counts that ingredient as on hand.
- `buildLists` with a pantry item carrying a structured qty: the line's
  `pantryQty` is a **string** (the `raw`) and `needed.value` is reduced by
  `value` when units match.
- A `"sub"` op through `MP.Sync.applyOps` against a structured item leaves a
  correct string qty (e.g. 500 g − 150 g → `"350 g"`).

The Worker's `qtyError` is not loadable in `test.html`. It is covered by §8.2
instead — if that ever changes, extracting it is a later phase's call, not a
reason to add a harness here.

## §8 Manual pass

1. `python3 -m http.server 8000`, open `shopping.html`. Existing pantry data
   (string `qty`) renders exactly as before — `have 2`, `(some)`, totals
   unchanged.
2. `PUT /pantry` with one item's `qty` as
   `{ "value": 500, "unit": "g", "raw": "500g bag" }` → `204`. Reload the app:
   that item shows `have 500g bag`, and an ingredient needing grams of it has
   its `needed` reduced accordingly.
3. `PUT /pantry` with `qty: { "value": 500, "unit": "g" }` → `400` naming
   `raw`. Same for `qty: 500` and `qty: { "value": "500", ... }`. Confirm the
   whole PUT is rejected (all-or-nothing) and KV is unchanged.
4. `PUT /pantry` with a plain string `qty` → still `204`, still renders as
   today. Same for `/adhoc`.
5. `raw` of `"<b>2kg</b>"` renders as literal text, not bold — no unescaped
   injection.
6. Cook a meal that uses that ingredient (plan → cook): the pantry item's qty
   becomes the remaining amount as a string, shopping list re-derives cleanly,
   and no pantry write happens on a portion-eat.
7. Offline (DevTools → Offline, after one load on v23): shopping and plan
   pages both still work.
8. Dark **and** light: the `have …` chip with a long `raw` string doesn't
   overflow its line.
