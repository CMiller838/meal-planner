# Phase 17 — Auto-built, cost- and length-optimized shopping list

**Goal:** Make a regenerated plan produce a correct, un-stale shopping list with
no extra step, and make the generator prefer meals that are cheap and that
**reuse ingredients already being bought in the same shop half** — so the list
gets shorter as a consequence of reuse, not by a line-count cap.

---

## Provenance of the decisions below

**No Decision Gate was answered by the user.** The gates below were presented to
the user in the dispatching turn, but the dispatch also said "you may proceed to
write the spec/tasks after presenting… don't block awaiting a separate go-ahead
unless a decision is genuinely contentious." So every **D-number below is the
planner's own call**, not a user selection.

Two of them warrant an explicit look before the builder starts:

- **D1** deviates from the roadmap's literal wording ("trigger the shopping list
  rebuild"), because the premise behind that wording turns out to be false — see
  D1. Same situation as Phase 16's D1/D2.
- **D7** (real Asda prices) **cannot be resolved by the builder at all.** Only
  the user has the price data. The builder must not invent prices; it emits the
  list of unpriced keys and stops there.

---

## Findings that shape the phase

Established by reading `generator.js`, `shopping-list.js`, `shopping.js`,
`plan.js`, `plan.html` and `pack-sizes.json`:

1. **`buildLists` is pure and its output is ephemeral.** `shopping.js:152`
   recomputes it from `mp_plan` on *every* `shopping.html` open. There is no
   persisted, stale list anywhere. The roadmap's "the list only rebuilds when the
   user visits `shopping.html`" is true but harmless — by the time it's visible,
   it's current.
2. **The real bug is stale ticks.** `loadTicked` (shopping.js:15-21) resets
   checkboxes only when `plan.startDate` changes. A same-day regeneration
   produces the *same* `startDate`, so the previous plan's ticked lines survive
   onto the new plan's list. This is what "the list didn't rebuild" actually
   looks like in use.
3. **`generator.js` is a pure module and loads *before* `shopping-list.js`**
   (`plan.html:62` vs `:64`). It may not reference `MP.ShoppingList`.
4. **`buildLists` is 4-arg**, `buildLists(plan, mealsById, packData, pantry)`
   (shopping-list.js:91) — the roadmap's 3-arg signature is stale. Correct the
   roadmap line as part of this phase.
5. **`packsFor` returns `1` for any unpriced ingredient** (shopping-list.js:38)
   and the line lands in `unpriced[]` contributing **£0** to the total. With 29
   priced entries, the displayed total is systematically *under*-stated today.
6. **`mp:plan-saved` already exists** as a coupling seam (plan.js:38 →
   hermes-sync.js:344), and `savePlan()` has **7 callers** — most of them manual
   slot edits, not generation. It is therefore the wrong hook for a
   generation-only behaviour.

---

## Decisions taken

**D1. "Auto-builds on generation" is implemented as *stamp-and-invalidate*, not
as a persisted rebuild.** `generatePlan` stamps a `generatedAt` onto the plan;
`shopping.js` keys ticked checkboxes to `generatedAt` instead of `startDate`. The
list keeps rebuilding on open, as today.

Rejected: writing a `mp_shopping_built` snapshot to localStorage on generate.
That adds a second source of truth beside `mp_plan` — which `CLAUDE.md` names the
plan of record — plus a cache that goes stale against the 7 manual-edit
`savePlan()` callers, and it would **not** fix finding #2. The user-visible
outcome of D1 is identical (open the tab → correct list, nothing wrongly
pre-ticked) for about three lines and no new state.

**D2. The cost signal is per-meal, computed in `shopping-list.js`, and *passed
into* the generator.** New exports `mealCost()` and `costIndex()` live beside the
existing pricing math (`parseQty`/`packsFor`/`normalizeKey`) so the pack maths
exists once. `generatePlan` gains an **optional 6th parameter**; when omitted it
behaves exactly as today. `generator.js` gains **zero** references to
`MP.ShoppingList` (finding #3), and `plan.js` — which already loads both — is
the only place the two modules meet.

Rejected: a per-ingredient cost weight. `pickMeal` ranks whole meals; there is no
per-ingredient decision point for a weight to attach to.

**D3. "Short" is not a cap. It is emergent from the reuse term.** Nutrient
ranking stays primary and is never overridden: `pickMeal` takes the **top
`shortlistSize` nutrient-ranked candidates** and, among only those, picks the
lowest `budgetScore`. A hard max-line-count would be an unsatisfiable constraint
fighting the nutrition targets `CLAUDE.md` calls deliberate.

**D4. Reuse credit counts only within the same shop half.** Shop days are day 1
and day 8 (`CLAUDE.md`, shelf-life). A pack bought on day 1 does not save money
on a day-10 meal, so a day-10 meal earns no credit for a key first used on day 2.
Two running key sets, one per half.

**D5. Cost and reuse are one term, not two.** `budgetScore = cost − reuseCredit ×
(number of this meal's ingredient keys already in the current half's key set)`,
lower is better. Cross-meal reuse (the whole-chicken and the peppers examples)
and list shortness are the same signal seen from two ends; a separate
"overlap signal" alongside a "cost weight" would be two knobs tuning one
behaviour.

**D6. Unpriced ingredients fall back exact → keyword → default category**, all
resolved from data in `pack-sizes.json`. This replaces the `£0`-and-`unpriced[]`
behaviour of finding #5. An estimated line is flagged `estimated: true` and shown
as such — an estimate must never be presented as a known price.

**D7. Real prices come from the user; the builder emits the gap.** Per v3's
non-goal, `pack-sizes.json` stays hand-maintained. The builder writes the
`categories`/`keywords` structure and a test that **lists every ingredient key in
`meals.json` with no `items` entry**, then stops. It must not invent plausible
prices to fill `items` — a wrong number that looks authoritative is worse than a
category estimate that is labelled as one.

**D8. Cost never outranks nutrition, and this becomes a stated invariant.**
`docs/OUTLINE.md` is explicit ("prioritizing healthiness over cheapest-possible")
and Phase 18 will be a second consumer of the same figure. Add the line to
`CLAUDE.md` so it survives the next phase.

---

## What this phase is made of

| Item | Spec section |
|---|---|
| `pack-sizes.json` — categories, keywords, `category` on items | 1 |
| `shopping-list.js` — `priceFor`, `mealCost`, `costIndex` | 2 |
| `shopping-list.js` — `buildLists` uses the fallback | 3 |
| `generator.js` — `generatedAt` + the budget shortlist | 4 |
| `plan.js` / `shopping.js` — the seam and the tick fix | 5 |
| Confirmed unchanged | 6 |
| Tests (group 36) | 7 |
| Docs | 8 |

---

## 1. `pack-sizes.json`

Three changes, all additive. Existing `items` entries keep their exact shape.

```
{
  "items": {
    "<key>": { "label", "packSize", "unit", "price", "staple"?, "category"? }
  },
  "categories": {
    "<category>": { "packSize": <number>, "unit": "<unit>", "price": <number> }
  },
  "keywords": { "<substring>": "<category>" },
  "planning": { "shortlistSize": <int>, "reuseCredit": <number> }
}
```

- **`categories`** — about eight: `veg`, `fruit`, `meat`, `fish`, `dairy`,
  `pantry`, `bakery`, `default`. Each is one representative pack for that aisle
  (e.g. veg ≈ one `each`-unit item, meat ≈ one `g`-unit pack). `default` is the
  terminal fallback and must exist.
- **`keywords`** — a small substring → category map (`"pepper": "veg"`,
  `"chicken": "meat"`, `"cheese": "dairy"`, …). Aim for ~30-40 entries covering
  the aisles, **not** an exhaustive ingredient list — an exhaustive list is just
  `items` again without prices. Longest matching substring wins, so `"chicken"`
  and `"chicken_stock"` can resolve differently.
- **`category`** on existing `items` entries is optional and is **not** used for
  pricing (they already have a price). Add it only where Phase 18 would want it;
  do not backfill all 29 for its own sake.
- **`planning`** holds the two tuning knobs (D3/D5), as data — `CLAUDE.md`
  forbids inline constants for this kind of number. Suggested starting values:
  `shortlistSize: 4`, `reuseCredit: 0.60`. *ponytail: hand-tuned constants, not
  a fitted model — adjust in the JSON after seeing a real generated plan.*

---

## 2. `shopping-list.js` — three new exports

```
priceFor(key, packData) -> { packSize, unit, price, estimated }
   // key       : raw or already-normalized ingredient key
   // Resolution order, first hit wins:
   //   1. packData.items[normalizeKey(key)]         -> estimated: false
   //   2. longest keyword substring match           -> estimated: true
   //   3. packData.categories.default               -> estimated: true
   // Never returns null. Never throws on a missing categories block —
   // if categories is absent, fall back to today's behaviour (null price).
```

```
mealCost(meal, packData) -> { total, estimated, keys }
   // total     : number, sum over ingredients of packsFor(needed, resolved) * resolved.price
   // estimated : true if ANY ingredient resolved via keyword/default
   // keys      : normalizeKey()'d keys of the counted ingredients (feeds D5)
   // Skips isSkippedIngredient(ing) (shopping-list.js:68) — leftover_* lines and
   // "from roast" quantities cost nothing; that is the whole point of a batch chain.
   // Uses the BASE meal, not MP.effectiveMeal() — the generator picks meal ids,
   // and variant selection happens later in plan.js (CLAUDE.md: id is the unit).
```

```
costIndex(library, packData) -> { [mealId]: { cost, keys } }
   // Thin map over mealCost. This object is the ONLY thing generator.js ever
   // sees of the pricing system (D2) — it is plain data, no functions.
```

Add all three to the `MP.ShoppingList` export object at line 227.

---

## 3. `shopping-list.js` — `buildLists` uses the fallback

At line 115, `const item = packData.items[key] || null` becomes a `priceFor`
call. Consequences to handle explicitly:

- `packsFor` is unchanged — it already takes a `{packSize, unit}` and `priceFor`
  always returns one, so the `if (!item)` branch at line 38 simply stops firing.
- Each line gains `estimated: <bool>`. `shopping.js` renders an estimated line
  with a marker (a trailing `~` on the price, or the existing unpriced styling) —
  **an estimate must be visibly distinct from a known price**.
- `unpriced[]` now always resolves to a price, so it stops being "has no price"
  and becomes "priced by category". Keep the array, rename its meaning in the
  return shape to `estimated[]`, and update `shopping.js`'s render of it from a
  "couldn't price these" note to a "these are category estimates" note. Do not
  silently drop the bucket — the user needs to know which part of the total is
  guessed.
- The `total` will jump on first run, because previously-£0 lines now carry a
  cost. That is the fix, not a regression.

---

## 4. `generator.js`

**4a. Stamp the plan (D1).** `generatePlan` adds `generatedAt:
new Date().toISOString()` to its returned `{startDate, days}` object. One field,
no other generator behaviour depends on it.

**4b. Optional cost input (D2).**

```
generatePlan(library, tags, targets, shelfData, startDate?, budget?) -> plan
   // budget : { costIndex, shortlistSize, reuseCredit } or null/undefined.
   //          When falsy, selection behaves EXACTLY as today — this is the
   //          regression guard, and it is asserted in §7.
```

**4c. The budget shortlist inside `pickMeal` (lines 66-85).** The existing order
is: `rankByGap` → effort preference → never-used/`lastUsedDay` tie-break. Insert
the budget step **after** the nutrient rank and effort preference have produced
their ordering, and **before** the final tie-break:

- Take the first `shortlistSize` candidates of the current ordering.
- Score each: `budgetScore = costIndex[id].cost − reuseCredit × overlap`, where
  `overlap` is how many of that meal's `keys` are already in the running key set
  **for the current shop half** (D4).
- Pick the lowest `budgetScore`; break ties with the existing never-used /
  `lastUsedDay` rule, unchanged.
- If `budget` is falsy, or the meal has no `costIndex` entry, skip the step
  entirely and fall through to today's behaviour.

**4d. The running key sets (D4).** `generatePlan` maintains two `Set`s — days
1-7 and days 8-14. When a slot is filled, union in that meal's `keys`. A meal
scheduled on day `d` consults the set for `d <= 7 ? first : second`. Leftover
child meals (line 107-110) must **not** add keys — they buy nothing.

The variety guard (`excludeIds`, lines 93-95/118-120) and all batch-cook
handling are untouched. The budget step only reorders candidates that already
passed those filters.

---

## 5. `plan.js` and `shopping.js` — the seam

**5a. One regeneration chokepoint.** `plan.js` has two generate call sites,
`generate-btn` (608-615) and `hermes-generate` (616-623), with identical
`plan = generatePlan(); savePlan(); renderPlan();` bodies. Extract a local
`regenerate()` used by both — the budget wiring must not be added twice, and a
future third caller must not miss it.

**5b. Wiring the budget.** `plan.js` already loads `shopping-list.js`
(plan.html:64). In `regenerate()`, build
`{ costIndex: MP.ShoppingList.costIndex(library, packData), ...packData.planning }`
and pass it as the 6th arg. `packData` comes from `MP.ShoppingList.load()` —
add it to the existing `Promise.all` at plan.js:629-633 rather than fetching it
on each regeneration.

If `load()` rejects (offline, missing file), pass `null` and generate without
cost weighting. **Generation must never fail because pricing data is
unavailable** — a plan with no cost weighting is fine; no plan is not.

**5c. The tick fix (D1, finding #2).** In `shopping.js:15-21`, `loadTicked`
compares `stored.startDate !== plan.startDate`; change the comparison to
`generatedAt`, and store `generatedAt` in the saved object. A plan loaded from
before this phase has no `generatedAt` (`undefined`) — treat `undefined ===
undefined` as "same plan", so an existing plan's ticks survive the upgrade rather
than clearing once on deploy.

**5d. No new sync.** Do not push the built list to the Worker. `CLAUDE.md`:
"Don't grow the Worker into a general API." `mp:plan-saved` → `pushPlan` already
mirrors the plan itself and is untouched.

---

## 6. Confirmed unchanged

| Thing | Why it stays put |
|---|---|
| `MP.Nutrition.rankByGap` and the nutrient targets | D8 — cost never reorders nutrition, it only picks within its shortlist |
| `parseQty`, `normalizeKey`, `packsFor`, `pantryIndex` | Reused verbatim; `priceFor` wraps, it does not replace |
| `eatPlan`, `fmtRemaining` | Eat flow is Phase 15's; no cost involvement |
| Pantry subtraction (shopping-list.js:121-130) | Including its "not a running balance" caveat (166-168) — not this phase's bug |
| `isSkippedIngredient` (68-70) | Now also used by `mealCost`; body unchanged |
| Variety guard, `weekendRuns`, `leadsTo`, shelf-life checks | The budget step runs after these filters, never around them |
| `savePlan()` and its 7 callers, `mp:plan-saved`, `hermes-sync.js` | Finding #6 — generation-only behaviour goes in `regenerate()`, not `savePlan()` |
| `worker/`, KV keys, `docs/HERMES.md` contract | No bridge involvement (5d) |
| `mp_plan` as plan of record | D1 — no competing snapshot key is introduced |
| The 29 existing `items` entries' prices | Real Asda prices already; only `category` may be added |
| Zero dependencies, no build step | Nothing added |

`sw.js`: no new file, so no precache change — `pack-sizes.json` is already
fetched by `load()`. Confirm it is in the precache list and leave it alone.

---

## 7. `test.html` — group 36

Group 35 is Phase 16, so this is **group 36**. This phase is nearly all pure
logic, so unlike Phase 16 the assertion surface is real — cover it properly.

- **`priceFor`** — exact hit returns the item's own price with
  `estimated: false`; a key matching only a keyword returns that category with
  `estimated: true`; an unmatched key returns `categories.default`; the longest
  keyword wins when two match.
- **`mealCost`** — a fixture meal of two priced ingredients sums to the expected
  total with `estimated: false`; adding one unpriced ingredient makes it
  `estimated: true` and raises the total; a `leftover_*` ingredient contributes
  **£0** and does not appear in `keys`.
- **Reuse term** — given two shortlisted meals of equal cost, the one sharing a
  key with the running set is picked; given a key first used on **day 2**, a
  **day 10** meal gets **no** credit for it (D4). This is the phase's subtlest
  rule and the one that will silently rot.
- **Regression guard** — `generatePlan(...)` with `budget` omitted returns the
  same plan as before this phase for a fixed library/fixture. If this fails,
  the budget step leaked out of its branch.
- **`buildLists`** — a plan containing one unpriced ingredient now yields a
  non-zero `total` and reports that line in `estimated[]`, where it previously
  yielded £0 and `unpriced[]` (finding #5).
- **Price-coverage report** — an assertion that lists (does not fail on) every
  ingredient key in `meals.json` with no `items` entry. This is the D7 hand-off
  artifact: it tells the user exactly which prices to supply.

---

## 8. Docs

- `SPEC.md` — the shopping list prices unmatched ingredients by category
  estimate, and the generator prefers cheaper, ingredient-sharing meals within a
  shop half without overriding nutrient coverage.
- `CLAUDE.md` — add D8 as an architecture invariant: *cost weighting only ever
  chooses among the top nutrient-ranked candidates; it never reorders nutrition.*
  Also note `pack-sizes.json` now carries category fallbacks and the `planning`
  knobs, so the "targets are data, not inline constants" rule covers them too.
- `docs/ARCHITECTURE.md` — the new `pack-sizes.json` shape, and the `plan.js`
  seam (`costIndex` passed *into* a still-pure `generator.js`), including why the
  generator may not reference `MP.ShoppingList` (load order, plan.html:62-64).
- `docs/roadmap.md` — flip Phase 17 to **Status: Complete**, correct the stale
  3-arg `buildLists(plan, mealsById, packData)` signature (finding #4), and
  append a one-line "as built" note that the auto-build was delivered as
  stamp-and-invalidate (D1), leaving the goal line itself intact.
- `docs/FUTURE.md` — park the skipped items below.

---

## Deliberately skipped

- **Persisting a built shopping list** (`mp_shopping_built`). D1. Add when
  something that *isn't* `shopping.html` needs to read the list — e.g. if Hermes
  is ever given it.
- **A hard max-line-count target.** D3. Revisit only if a real generated plan
  still produces an unmanageably long list after the reuse term is tuned.
- **Making pantry a running balance across shop days** (shopping-list.js:166-168).
  Pre-existing, acknowledged in a comment, and orthogonal to cost weighting.
- **Synonym/plural/unit-word matching** for ingredient keys
  (`normalizeKey`'s ponytail note at line 44). The category fallback now makes an
  unmatched key merely *approximate* instead of free, which removes most of the
  pain. An alias map is still the upgrade path — not this phase.
- **Per-meal cost badges on cards.** That is Phase 18, and it consumes
  `mealCost` unchanged — which is precisely why `mealCost` is exported rather
  than kept private to the generator.
- **Optimising across both shop halves jointly** (e.g. moving a meal from day 10
  to day 5 to share a pack). That is a scheduling search, not a scoring term; the
  greedy per-slot pick is the honest ceiling here.
  *ponytail: greedy, not optimal — a two-pass swap heuristic is the upgrade path
  if the generated lists still look repetitive across halves.*
