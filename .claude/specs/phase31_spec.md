# Phase 31 — Partial-ingredient leftover tracking

The pantry becomes a **running balance**. A cook that uses half a pack leaves a
remainder that stays a real number with its unit — so the next day's plan, the
next shopping list and the next variant pick all draw on what is actually left,
not on "present / absent".

Two things make that true, and they are the whole phase:

1. A computed remainder stops collapsing to a display string
   (`{value, unit, raw}` instead of `"350g"`), so repeated partial eats neither
   re-round nor lose their unit.
2. `pantryOverlap` stops asking "is it there?" and asks "is there **enough**?",
   which gives `generator.js`'s `pickVariant` quantity-awareness with a
   zero-line diff in `generator.js`.

Last phase of v5, and the only one with a hard prerequisite: Phase 30
(`.claude/specs/phase30_spec.md`) shipped the `{value, unit, raw}` shape this
phase now produces as well as consumes.

## Decisions

### Answered by the user at this phase's gates

| Gate | Pick | Meaning |
|---|---|---|
| 1 — remainder shape | **B** | A computed remainder is **structured** `{value, unit, raw}`, reusing Phase 30's shape. Not a plain string, and not a growing provenance string (Path C rejected). |
| 2 — overlap semantics | **A** | Upgrade `pantryOverlap` **in place**. An ingredient still counts as present whenever either side is unparseable **or** the units don't match; only a both-parseable, unit-matched, genuinely-insufficient amount drops out. Empty-qty items stay countable ("present, amount unknown"). |
| 3 — call sites | **A** | `eatPlan` and `applyOps` stay **two callers of one shared function**. No op field carrying a pre-computed remainder. |

Consequences, stated once so no task re-opens them:

- Gate 1 is what fixes the two latent defects in today's `fmtRemaining`
  (`shopping-list.js:275-279`), which are invisible until remainders persist
  across days and are the reason this phase exists:
  - it formats through `.toFixed(1)`, so **every** partial eat re-rounds its
    own input — drift accumulates over a pack's life;
  - its zero case returns the bare string `"0"` **with no unit**, which
    re-parses as `{value: 0, unit: "each"}`. A later eat of `"50 g"` against
    that then hits `eatPlan`'s `haveQty.unit !== usedQty.unit` branch and
    reports *"units differ"* instead of a clean shortfall.
  Keeping `value` a number and `unit` alongside it kills both for free.
- Gate 2 Path A is a root-cause fix at the one chokepoint all three callers
  already route through (`discover.js:261`, `generator.js:197`,
  `generator.js:200`). No second overlap function, no flag parameter.
- Gate 2's fallback rule is what makes the Discover side-effect a non-event:
  TheMealDB pool meals mostly have no parseable `qty`, so they land in the
  fallback and `discover.js`'s `orderPool` ordering is unchanged in practice.
- Gate 3: the arithmetic already lives in exactly **one** function. Collapsing
  to one *caller* would cost an op field plus a branch and buy nothing —
  `applyOps` must keep its own computation regardless, because `"sub"` ops can
  arrive from Hermes carrying no such field.

### Calls made without a gate (they follow from the above)

- **`fmtRemaining` is renamed `remainingQty`.** It no longer formats — it
  returns a qty object. Five references total (`shopping-list.js:318, 322`,
  the export at `shopping-list.js:330`, `hermes-sync.js:183`, and `test.html`
  Test 31). A function whose name says `fmt` but returns a structure is the
  kind of thing that causes a wrong call at 3am; the rename is cheaper than
  the misunderstanding. **No back-compat alias** — single app, no external
  callers.
- **`raw` on a computed remainder is the freshly formatted text**
  (`"350g"`), not the original pack wording. A stale `"500g Tesco spinach bag"`
  attached to 350 g actively misdescribes the amount (Gate 1 Path C, rejected).
  Screenshot provenance is therefore still lost on first cook — accepted, and
  now explicitly permanent rather than a deferred TODO.
- **`raw` is mandatory on the result, not optional.** Not cosmetic: a
  structured qty reaches the Worker through the existing `PUT /pantry` /
  `PUT /adhoc` relay, and Phase 30's `qtyError` (`worker/worker.js`) **400s an
  object missing `raw`**. A remainder without `raw` would fail its own sync.
- **`value` is rounded to 3 decimal places**, `Math.round(v * 1000) / 1000`,
  purely to stop IEEE-754 residue (`0.3 - 0.1`) accumulating over a pack's
  life. This is not the `.toFixed(1)` display rounding being reintroduced —
  display rounds to 1 dp in `raw`, arithmetic keeps 3.
- **`pantryIndex` is a zero-line diff.** The coordinator's sub-fix
  ("empty-qty items stay countable") needs no change there: `pantryIndex`
  already stores `item.qty || ""` (`shopping-list.js:95`), so the key *exists*
  with a falsy value. The bug is in the **reader** — `pantryOverlap` tests
  truthiness, so an empty-qty item is silently uncounted today. Moving it to
  the `!== undefined` test that `buildLists` already uses
  (`shopping-list.js:224`) makes the two files agree. **Do not edit
  `pantryIndex`.**
- **Overlap stays an integer count**, not fractional partial credit. Nothing
  downstream wants a score; `pickVariant` compares counts.
- **The pantry `"sub"` op still carries `qty: usedText`** — the free text the
  user typed in the eat sheet. Gate 3 keeps `applyOps` computing its own
  remainder from it.
- **No new dependency, no build step** (`CLAUDE.md`).

## Findings (verified, do not re-derive)

- `shopping-list.js:275-279` — `fmtRemaining(have, used)` → string. Clamps at
  0, appends `have.unit`, trims a trailing `.0` — **except** the `remaining === 0`
  early return, which drops the unit entirely.
- `shopping-list.js:269-271` — the stale ponytail note. Its *first* clause is
  still true after this phase (`buildLists` does still subtract the same pantry
  snapshot on both shop days); only its pointer — "belongs in Phase 12's
  deduction flow" — is stale, since deduction shipped later and *this* phase is
  what makes the pantry a real balance. Rewrite, don't delete.
- `shopping-list.js:91-98` — `pantryIndex` stores `item.qty || ""`. Never
  stores `undefined`, so `!== undefined` is an exact "key present" test.
- `shopping-list.js:101-103` — `pantryOverlap` filters on truthiness of the
  indexed value. Exactly **three** callers: `discover.js:261` (`orderPool`),
  `generator.js:197` (base meal), `generator.js:200` (per variant). A prior
  scan reported a fourth at `shopping-list.js:185` — **that is wrong**, line
  185 is an `MP.effectiveMeal` call inside `purchaseOccurrences`.
- `shopping-list.js:49-67` — `parseQty` accepts both forms, normalizes
  `kg`→`g` / `l`→`ml` via `UNIT_MULT`, defaults a bare number to
  `unit: "each"`. **Always returns a non-empty `unit`** when it returns at all
  — which is why `remainingQty`'s `unit` can never be `""`.
- `shopping-list.js:287-328` — `eatPlan`. Pushes
  `{list:"pantry", type:"sub", name, qty: usedText}`, plus
  `{list:"adhoc", type:"add", name, qty: <used − have>}` on shortfall. Row
  shape `{key, label, used, have, after, shortfall, note}`.
- **`eatPlan`'s note strings interpolate `haveText` raw**
  (`shopping-list.js:310`: `can't subtract from "${haveText}"`;
  `shopping-list.js:314`: `units differ ("${haveText}" vs "${usedText}")`).
  Since Phase 30 `haveText` can be an **object** → these already render
  `[object Object]`. A live Phase 30 gap this phase closes.
- **`plan.js:625`** — `` `${esc(row.have)} → ${esc(row.after)}` ``. `row.have`
  is the pantry qty as stored, so this **already renders `[object Object]`
  today** for a structured pantry item. Second live Phase 30 gap; Gate 1 makes
  `row.after` an object too, so both halves of this line need `MP.qtyText`.
- `plan.js:642` — `eatPlan`'s **second** caller: `renderEatSheet`, a read-only
  preview. `plan.js:733` (`commitCook`) is the writing one. Both agree because
  Gate 3 keeps one shared implementation.
- `hermes-sync.js:171-197` — `applyOps` is pure (`items.map(spread)`), skips
  malformed ops, never throws. `"sub"` (178-183) parses both sides, requires a
  unit match, writes the result. `"add"` (184-191) writes `op.qty` verbatim
  when truthy — an object passes through unchanged.
- `worker/worker.js` `qtyError` (Phase 30) — object form requires finite
  non-negative `value`, non-empty string `unit`, non-empty string `raw`.
  `value: 0` is legal.
- `data.js:24-31` — `qtyText`: string → itself; object → `raw`, else
  `value + " " + unit`; anything else → `""`.
- `sw.js:4` — `CACHE = "meal-planner-v23"` (Phase 30).
- `test.html` — helper is `check(name, condition)` plus `deepEqual`. Existing
  qty coverage: **Test 31** (~lines 753-855, `fmtRemaining` + `eatPlan` +
  `applyOps`, ~16 assertions) and **group 46** (Phase 30, ends line 2180,
  including the `applyOps` → `"350g"` string assertion at line 2178). Both need
  updating. Highest existing group is 46, so the new group is **47**.

## Non-goals

- **No plan-wide pantry depletion during generation.** `generator.js:190-192`'s
  ponytail note ("two meals may both count the last tin as in stock") **still
  stands** after this phase: `plan.js:98` builds the `have` index once, and
  every slot is scored against that same static snapshot. Gate 2 makes each
  slot ask "is there enough for *this* meal?", not "is there enough for this
  meal *given what earlier slots already claimed?*". Simulating consumption
  across the plan is a real feature with real ordering questions — it was not
  gated, and inventing it here is scope creep. The note gets amended to say
  precisely this, not deleted.
- **No purchase-date or per-SKU tracking.** Quantities only. Category-based
  shelf-life stays the default for any item without a tracked quantity —
  `shelf-life.js` / `shelf-life.json` are a **zero-line diff**
  (`CLAUDE.md`, roadmap Phase 31).
- **No new endpoint, route, KV key or op type.** Remainders travel through the
  existing `PUT /pantry` / `PUT /adhoc` relay and the existing
  `sub`/`add`/`remove` op vocabulary.
- **No `worker/worker.js` diff.** `qtyError` already accepts exactly the shape
  this phase produces. If a task finds itself editing the Worker, something
  upstream is wrong.
- **No change to the two-shop-day subtraction in `buildLists`.** Both shop days
  still net off the same pantry snapshot; that ceiling survives and stays a
  ponytail note.
- **No `meals.json` quantity backfill.** The roadmap's own note stands: the fix
  for imprecise totals is filling in quantities, not a smarter parser. An
  ingredient with no parseable `qty` simply takes Gate 2's fallback.
- **No migration.** String and structured `qty` coexist permanently; an item
  only becomes structured once something computes a remainder for it.
- **No fractional/partial-credit overlap score.**
- **No new UI.** The eat sheet gains no control; two display expressions change
  so they stop printing `[object Object]`.

### Invariants this phase must not break

- **`commitCook` (`plan.js:729-758`) remains the only pantry writer.**
  `eatPortion` (`plan.js:762-777`) still calls none of `eatPlan`, `applyOps`,
  `writeLocalItems`, `queueOp`. This phase adds **no** new write path — it
  changes the *shape* of what the existing one writes.
- **`qty` stays one field, string-or-object** — never a second sibling field.
  `parseQty` remains the only reader of its structure, `MP.qtyText` the only
  reader of its display text.
- **Pantry stock never reorders nutrition.** `pickVariant` still only chooses a
  variant of an already-chosen meal; `rankByGap` still decides *which* meal.
  `generator.js` is a **zero-line diff**.
- **No `innerHTML` with unescaped external content.** Every new `qtyText` call
  in a template stays *inside* the existing `esc(...)`, never outside it.
- **`applyOps` stays pure** — no input mutation, no throw on a malformed op.
- Fetch-then-write, whole-array-replace semantics for `/pantry` and `/adhoc`
  are unchanged.

## §1 `shopping-list.js` — `fmtRemaining` → `remainingQty`

```js
/** have/used are {value,unit} from parseQty, already unit-matched by the
 *  caller. Returns a structured qty for have - used, clamped at 0. */
function remainingQty(have, used)   // ({value,unit}, {value,unit}) -> {value, unit, raw}
```

| Field | Rule |
|---|---|
| `value` | `Math.max(0, have.value - used.value)`, then rounded to 3 dp to kill float residue. Never negative, never `NaN` (both inputs are `parseQty` outputs). |
| `unit` | `have.unit`, verbatim. Non-empty by construction — `parseQty` always supplies one (`"each"` by default). |
| `raw` | Display text: the value at **at most 1 dp with a trailing `.0` trimmed**, immediately followed by `unit`. Never empty. |

The one behavioural change inside the formatting: **the zero case keeps its
unit** — `"0g"`, not today's bare `"0"`. `value: 0` with `unit: "g"` is the
structural truth; `raw` should not contradict it.

Rename at all five references (`shopping-list.js:318`, `:322`, the
`MP.ShoppingList` export at `:330`, `hermes-sync.js:183`, `test.html` Test 31).
No alias is left behind.

### §1b The stale ponytail note (`shopping-list.js:269-271`)

Rewrite in place. It must still name the surviving ceiling and drop the dead
pointer:

- **Keep:** both shop days net off the same pantry snapshot, so `buildLists`
  double-counts what's on hand across a fortnight.
- **Drop:** "the pantry is not a running balance in this phase" and "belongs in
  Phase 12's deduction flow" — deduction shipped, and cook-time deduction now
  *does* maintain a real balance.
- **Upgrade path to name:** per-shop-day depletion in `buildLists`, if it ever
  matters.

## §2 `shopping-list.js` — `pantryOverlap` learns "enough"

```js
/** Count of a meal's ingredients on hand in sufficient quantity. */
function pantryOverlap(meal, have)   // unchanged signature
```

Decision table for one ingredient, evaluated in order. A module-local helper is
fine; it does not need exporting (coverage goes through `pantryOverlap`).

| Condition | Counts? | Why |
|---|---|---|
| `have[normalizeKey(ing.key)] === undefined` | **No** | Not in the pantry at all. |
| Stock present but empty (`""`) | **Yes** | "Present, amount unknown" — Phase 30's semantics, and what `buildLists:224` already assumes. **This is the behaviour change vs. today**, where `""` is falsy and silently uncounted. |
| `parseQty(ing.qty)` is `null` (recipe amount unknown) | **Yes** | Gate 2 fallback. |
| `parseQty(stock)` is `null` (pantry amount unparseable) | **Yes** | Gate 2 fallback. |
| Units differ after normalization | **Yes** | Gate 2 fallback — can't compare `"bunch"` to `"g"`, so don't pretend to. |
| Both parse, units match, `stock.value >= need.value` | **Yes** | Enough. |
| Both parse, units match, `stock.value < need.value` | **No** | **The new case.** Not enough for this recipe. |

`ing.qty` is free text on `meals.json` ingredients and parses through the exact
same `parseQty` the pantry side uses, so `kg`/`g` and `l`/`ml` are already
normalized on both sides before comparison — the same unit-match discipline
`eatPlan` uses (`shopping-list.js:313`).

Signature, export list and every call site are unchanged. `generator.js` and
`discover.js` are **zero-line diffs**; `pickVariant` becomes quantity-aware by
consequence.

### §2b `generator.js`'s ponytail note (`generator.js:190-192`)

**Comment-only edit — no code change in this file.** Amend it to state the
ceiling that actually survives: variant picking now checks each slot has
*enough*, but scoring still runs against one static pantry snapshot built once
at `plan.js:98`, so two slots can still both count the same last tin. Upgrade
path: depletion tracking across the plan, if it matters.

## §3 `shopping-list.js` — `eatPlan`

Structure, op vocabulary and row shape are unchanged. Three edits:

1. `after` (`:318`) is now `remainingQty(haveQty, usedQty)` — a **structured
   qty**, not a string. Consumers render it through `MP.qtyText` (§5).
2. The shortfall remainder (`:322`) is likewise structured, and goes onto the
   ad-hoc `add` op as `qty`. It carries `raw`, so it passes `qtyError` when that
   array reaches `PUT /adhoc`.
3. **The two note strings stop printing `[object Object]`**: wrap `haveText`
   (and `usedText`, for symmetry) in `MP.qtyText` at `:310` and `:314`. Wording
   otherwise unchanged — `can't subtract from "<text>"` and
   `units differ ("<have>" vs "<used>")`.

The pantry `sub` op is untouched: still `qty: usedText`.

## §4 `hermes-sync.js` — one rename, no logic change

`applyOps`'s `"sub"` branch (`:183`) calls `remainingQty` instead of
`fmtRemaining` and writes the structured result to `result[idx].qty`. That is
the **entire** diff in this file.

It keeps working unchanged because:
- `parseQty(result[idx].qty)` (`:180`) already accepts the object form, so a
  second `sub` against an already-structured item re-parses losslessly — this
  is what makes the balance survive repeated partial eats;
- the unit-match guard (`:182`) is unchanged;
- `"add"` (`:187`, `:190`) writes `op.qty` verbatim and an object is truthy, so
  a structured shortfall lands on the ad-hoc list with no diff.

## §5 `plan.js` — the eat-sheet row (display only)

`plan.js:625`, both halves:

```js
`<span class="eat-after">${esc(MP.qtyText(row.have))} → ${esc(MP.qtyText(row.after))}</span>`
```

`row.have` needs it for a **pre-existing** Phase 30 reason (a structured pantry
qty renders `[object Object]` there today); `row.after` needs it because of
Gate 1. `MP.qtyText` stays **inside** `esc(...)` — `raw` can originate from a
Hermes screenshot read and is untrusted.

No other `plan.js` change. `commitCook` (`:729-758`) keeps its exact call
order; `eatPortion` keeps touching nothing.

## §6 `sw.js`

- Bump `CACHE` (line 4) `"meal-planner-v23"` → `"meal-planner-v24"`.
- No shell-array change — no new file ships.

## §7 Tests — `test.html`

### 7a. Update existing groups (they currently assert the old behaviour)

- **Test 31** (~753-855) — rename `fmtRemaining` → `remainingQty` and change
  its result assertions from strings to structured qtys, including
  `eatPlan`'s `after` and the shortfall op's `qty`.
- **Group 46, line 2178** — `applyOps "sub"` on a structured qty now yields
  `{value: 350, unit: "g", raw: "350g"}`, not the string `"350g"`.
- Everything Test 31 asserts about **rows, notes, op vocabulary and shortfall
  detection stays true** — if one of those assertions breaks, the change went
  wider than this spec.

### 7b. New group 47 — "Phase 31 — running-balance pantry"

Pure functions only (`test.html` is DOM-free by design).

**`remainingQty`:**
- `({500,"g"}, {150,"g"})` → `{value: 350, unit: "g", raw: "350g"}`.
- Clamps: `({100,"g"}, {250,"g"})` → `value: 0`, and **`unit: "g"` with
  `raw: "0g"`** — the unit-less-zero defect, asserted directly.
- `raw` rounds to 1 dp while `value` does not: e.g. `({1,"each"}, {0.33,"each"})`
  → `value` is `0.67`, `raw` is `"0.7each"`.
- Float residue: `({0.3,"each"}, {0.1,"each"})` → `value === 0.2` exactly.
- **Repeated-eat drift (the regression this phase exists to prevent):** feed
  `remainingQty`'s own output back through `parseQty` three times, subtracting
  a fractional amount each round, and assert the final `value` equals the exact
  arithmetic result. Under the old string round-trip this accumulated `.toFixed(1)`
  error.
- **Unit survives an empty pack:** subtract to 0, re-`parseQty` the result, and
  assert `unit === "g"` (not `"each"`) — then a further `eatPlan` against it
  reports a **shortfall**, not `"units differ"`.

**`pantryOverlap`** (one row per §2 line):
- Absent key → not counted.
- `qty: ""` → **counted** (behaviour change).
- Recipe qty unparseable (`"a splash"`) → counted.
- Pantry qty unparseable (`"Bisto"`) → counted.
- Unit mismatch (`"1 bunch"` vs needs `"200g"`) → counted.
- `500g` stock, needs `200g` → counted.
- `100g` stock, needs `200g` → **not** counted.
- `2kg` stock, needs `500g` → counted (normalization applies across both sides).
- Structured stock `{value:500,unit:"g",raw:"500g bag"}`, needs `700g` → not
  counted.

**`pickVariant` through the new overlap** (`MP.Generator.pickVariant` is
exported): a variant whose extra ingredient is in the pantry but **short** is
no longer preferred over one whose ingredients are all sufficiently stocked.
This is the phase's user-visible behaviour and the reason `generator.js` can
stay a zero-line diff.

**End-to-end balance:** `eatPlan` → `applyOps` → `eatPlan` again against the
updated items. Assert the second cook sees the reduced amount, and that two
successive half-pack cooks leave `value: 0` with the unit intact.

**`qtyText`** on a computed remainder returns `raw` (`"350g"`), never
`[object Object]`.

## §8 Docs

- **`CLAUDE.md`** — amend the Phase 30 `qty` invariant bullet rather than
  adding a rival one: a computed remainder is now **structured**
  (`MP.ShoppingList.remainingQty`, the only producer), the pantry is a running
  balance across cooks, `pantryOverlap` means "on hand **in sufficient
  quantity**" with unparseable/unit-mismatched/amount-unknown falling back to
  "present", and `commitCook` is still the only pantry writer. Keep the
  quantity-only rule (no price/pack size/purchase date) verbatim.
- **`docs/ARCHITECTURE.md:78-88`** — the sentence "A cook deduction collapses a
  structured `qty` back to a plain string via `fmtRemaining`" is now **false**.
  Replace: a cook deduction produces a structured remainder, so the pantry is a
  running balance. Also update the Phase 21 pantry-variant note (~`:207-215`)
  to say overlap is quantity-aware, still a reader-only path.
- **`docs/HERMES.md`** — one sentence on `/pantry` and `/adhoc`: the **app
  itself** now writes structured quantities (a cook remainder, and a shortfall
  ad-hoc line), so Hermes must not assume an ad-hoc or pantry `qty` is free
  text just because a human didn't type it. No endpoint, route or contract
  change.
- **`docs/roadmap.md`** Phase 31 (lines 166-186) — mark **Shipped**, record
  gates 1B / 2A / 3A and the one-line outcome, in the same style as Phase 30's
  shipped block (`:154-164`). Note that `generator.js:190-192`'s depletion
  ceiling survives.
- **`SPEC.md`** — untouched (no planning rule, nutrition target or plan-slot
  change).

## Edge cases

| Case | Required behaviour |
|---|---|
| 500 g pantry, cook uses 150 g | `qty` becomes `{value:350, unit:"g", raw:"350g"}`. Shopping list shows `have 350g`; next cook subtracts from 350. |
| Same item cooked from three times, fractional each time | `value` is exact to 3 dp throughout; no `.toFixed(1)` drift. Only `raw` is rounded, and only for display. |
| Cook uses exactly the whole pack | `{value:0, unit:"g", raw:"0g"}`. Item **stays** in the pantry at zero (no `remove` op — this phase adds no new op). It no longer satisfies `pantryOverlap` for any positive need. |
| A later cook against that zero item | `parseQty` → `{0,"g"}`, units match, so it's a clean **shortfall** (ad-hoc line for the full amount) — not today's spurious `"units differ"`. |
| Pantry `qty: ""` (present, amount unknown) | Now **counts** as on hand for overlap. `eatPlan` still can't subtract (`parseQty("")` → `null`) and reports its "can't subtract" note. Both are correct and independent. |
| Pantry item absent entirely | Unchanged — `eatPlan` row `note: "not tracked"`, no op. |
| Structured pantry qty in the eat-sheet preview | Renders its `raw` (`have 500g bag → 350g`), **not** `[object Object]`. Regression-tests a live Phase 30 gap. |
| Units differ (`"1 bunch"` vs `"200g"`) | `eatPlan` note unchanged; `pantryOverlap` **counts it as present** (Gate 2 fallback). No wrong subtraction, no silent drop. |
| Shortfall (have 100 g, use 250 g) | Pantry → `{0,"g","0g"}`; ad-hoc gains `{value:150, unit:"g", raw:"150g"}`. Both survive `qtyError` because `raw` is present. |
| That ad-hoc line rendered | `shopping.js:91` already uses `MP.qtyText` (Phase 30) — zero diff, shows `150g`. |
| Hermes PUTs a plain-string `qty`, app then cooks from it | String in, structured out. Both forms coexist; no migration. |
| Hermes sends its own `"sub"` op | Works unchanged — `applyOps` computes the remainder itself (Gate 3), no op field required. |
| Two slots in one generated plan both need the last tin | **Both still count it** — `generator.js:190-192`'s ceiling, explicitly out of scope. |
| `raw` containing HTML (`"<b>2kg</b>"`) from a screenshot | Escaped at every render site, including the two new `qtyText` calls at `plan.js:625`. |
| Old app version reading a structured remainder | Renders `[object Object]`. Same accepted trade as Phase 30; cache bumped to v24. |

## §9 Manual pass

1. `python3 -m http.server 8000`. Existing **string**-qty pantry data renders
   exactly as before on `shopping.html` — `have 2`, `(some)`, totals unchanged.
2. Set a pantry item to `500g` (string). Plan → cook a meal using `150g` of it.
   Eat sheet preview reads `500g → 350g`. Commit; pantry shows `350g`.
3. Cook from it **again** using `150g` → `200g`. And a third time → `50g`. No
   drift, no `[object Object]`, units never lost.
4. Cook using more than remains → pantry hits `0g` and an ad-hoc line appears
   for the difference. The ad-hoc line shows a real amount, not `[object Object]`.
5. Cook against that `0g` item → reported as a shortfall, **not** "units
   differ".
6. `PUT /pantry` a structured `{value, unit, raw}` item, cook from it: the eat
   sheet shows its `raw` on the left of the arrow (this is the Phase 30 gap —
   confirm it's fixed), and the remainder replaces it afterwards.
7. Confirm the round-trip: after a cook, the pantry array syncs (`204`, no
   `400` from `qtyError`) — i.e. the computed remainder really did carry `raw`.
8. **Variant check:** a meal with two variants where the pantry holds *some but
   not enough* of variant A's distinctive ingredient and plenty of variant B's
   → Generate picks **B**. Before this phase it could pick A.
9. **Portion check:** eat a leftover portion — no pantry write, no ad-hoc line,
   pantry qty unchanged. (`commitCook` is still the only writer.)
10. Discover page ordering still looks sane with a stocked pantry (the Gate 2
    fallback should make it effectively unchanged).
11. Offline (DevTools → Offline, after one load on v24): shopping and plan pages
    both still work.
12. Dark **and** light: the `have … → …` eat row with a long `raw` doesn't
    overflow.
