# Phase 28 — Generic ingredient-substitution groups

A data file of interchangeable ingredient groups (e.g. onion/pepper as
"aromatic veg"). When one dinner in a shopping half already requires a group
member, the generator may swap an equivalent ingredient into a later slot's
recipe so one pack covers both — scored inside `generator.js`'s existing
`budget` step (layer 4, `generator.js:133-152`), and recorded on the plan slot
so the shopping list and pantry actually reflect the swap.

Strictly a soft preference, same class as cost/chips/busy/pantry. It never
re-scores nutrition, never filters a meal out of the pool, never caps
anything, and can never make a plan fail to fill. Swaps come only from the
data file's defined groups — never free-form — and the swapped recipe is
re-checked against the hard content exclusions before it is kept. With no
groups file, every byte of generated output is identical to today's.

## Decisions (answered 1B, 2B)

Relayed to me by the coordinating agent as the user's own picks, both matching
my recommendation.

| # | Decision | Chosen | Why |
|---|----------|--------|-----|
| D1 | Where the groups live | **B — new `substitution-groups.json`** | `substitutions.json`'s contract is "every top-level key is an excluded-ingredient substring", and `worker/worker.js:60` passes the whole object into `sanitize` as `subs`. A `groups` key there would read as a fake excluded ingredient named "groups". A separate file keeps exclusion swap-ins (1:1, rejection-driven) apart from consolidation groups (N-way, cost-driven), gives `mealdb.js` and `worker/worker.js` a **zero-line diff**, and matches `docs/OUTLINE.md:350-352`, which asks for a new data file. A v5 nice-to-have (Hermes "use these up", `OUTLINE.md:374-378`) is already pencilled in as a second reader of this table. |
| D2 | What a substitution does | **B — materialised swap on the plan slot** | Credit-only scoring would rank meals that *could* share a pack higher without ever swapping anything, so you would still buy the pepper *and* the onion — the phase would ship without its stated payoff, and `reuseCredit` already covers exact overlap. B records the swap as `slot.subs`, resolved through the one existing chokepoint (`MP.effectiveMeal`), so the shopping list, pantry deduction, shelf-life pass and detail sheet all see the swapped recipe. |

### Calls made without a gate (trivial forks, noted for the record)

- **Reuse `MP.ShoppingList.normalizeKey`** (`shopping-list.js:48-57`) for group
  lookup. `costIndex.keys` are already normalised (`shopping-list.js:103`), so
  the half's key Set is in that space and group members must be too. No second
  alias table — this is the alias map that `normalizeKey`'s ponytail note
  (`shopping-list.js:44-47`) already names as its upgrade path.
- **At most one swap per meal.** A structural rule, not a knob: two swaps make
  a recipe unrecognisable and the second one's payoff is marginal. Not
  configurable — a config for a value that never changes is complexity.
- **`sub.from` records the ingredient's raw `ing.key`, not its normalised
  form.** Group *lookup* is normalised; the recorded swap is an exact
  `ing.key` match, so `applySubs` needs no normaliser and therefore no
  dependency on `shopping-list.js` being loaded (it is not, in the Worker).
- **`subCredit` is data** (`pack-sizes.json`'s `planning` block), and must be
  **below `reuseCredit`** so a genuine exact-ingredient overlap always outranks
  a swap. Missing → the feature is off.
- **The groups index rides on the existing `budget` object**, built where
  `costIndex` is built (`plan.js:92-94`). No new argument to `generatePlan` or
  `rankSlot`, so the other three `rankSlot` callers are untouched.
- **No new generator exports.** Like Phase 27's `shortlistSizeFor`, the new
  helpers are reached through `rankSlot`/`generatePlan` in tests; `slot.subs`
  is observable output.
- **A key listed in two groups: first group wins.** Documented, not an error,
  no validator.
- **Remote placements never carry `subs`** — `plan.js:798` builds a fresh
  `slotValue` and only copies `variantId`. A Hermes-proposed placement is a
  meal choice, not a recipe edit. Zero-line change, deliberate.
- **`sw.js` cache bumps `meal-planner-v20` → `meal-planner-v21`** and the shell
  array gains `substitution-groups.json`.
- **Tests are group 45** (group 44 is Phase 27, `test.html:1800`).

## Findings (verified, do not re-derive)

- `substitutions.json` is `{ note, mushroom: { key, label } }` — nothing else.
  Live readers: `mealdb.js:100-109` (`load()`, memoised, `.catch(() => ({}))`),
  `worker/worker.js:8` → `worker/worker.js:60`, and `sw.js:33` (already cached).
  **`generator.js` does not read it today and will not after this phase.**
- `MP.Exclusions.check(meal)` (`exclusions.js:45-51`) → `{ ok, reasons }`,
  covering all three hard rules. `sanitize(meal, subs)` (`exclusions.js:55-70`)
  is the *Discover* path — it does its own mushroom swap-in and returns `null`
  for standalone-egg/veg-in-toastie. **`check` is the right post-swap gate
  here, not `sanitize`** — the swap is already chosen; we only need a verdict.
- `generator.js:139`: `const overlap = c.keys.filter((k) => half.has(k)).length;`
  with `c = budget.costIndex[m.id]` → `{ cost, keys }` and `half` the per-week
  Set fed at `generator.js:200`.
- `place(day, slotType, meal, countsTowardBudget)` (`generator.js:190-204`) is
  the **single** point where a slot object is written and where `half` is fed.
  It is the one and only place a swap can be materialised correctly.
- `plan.js:92-94` builds `budget = { costIndex: ..., ...packData.planning }`,
  so **new `planning` keys reach the generator with no `plan.js` change** —
  only the `groups` index needs a (2-line) `plan.js` addition.
- `MP.effectiveMeal(meal, variantId)` (`data.js:169-175`) is the one recipe
  resolver, and `findVariant` only resolves ids authored in `meal.variants`
  (`data.js:154-157`), validated again at `plan.js:799` — so a swap **cannot**
  ride the variant plumbing as a synthetic variant id without changing the
  resolver. Hence a separate `subs` field.
- `setSlotMeal` (`plan.js:135-138`) already writes a **fresh** slot object, so
  a meal change drops stale `subs` for free — **no change needed there**.
  `setSlotVariant` (`plan.js:140-146`) spreads the old slot and keeps `subs`;
  that is safe because a sub whose `from` isn't in the recipe is a no-op (§4).
- `commitCook` (`plan.js:709-730`) reads `eatCtx.meal`, set from
  `plan.js:584`'s `MP.effectiveMeal(meal, slot.variantId)` — so adding `subs`
  to that one call makes the pantry deduction swap-correct.
- `shopping-list.js:153` (`purchaseOccurrences`) is where the consolidation is
  actually cashed in.
- `sw.js:4` `CACHE = "meal-planner-v20"`. Latest test group is 44.

## Non-goals

- **No free-form substitution.** Only members of a group in the data file, and
  only an ingredient the recipe actually contains.
- **No re-scoring of nutrition.** `MP.Nutrition.rankByGap` is untouched and
  still runs first; layer 4 continues to reorder only what it produced.
- **No filtering.** A meal is never dropped because a swap is unavailable or
  rejected — `rankSlot` still returns every meal in the pool.
- **No user-facing swap editor.** Swaps are generated, displayed (§6) and
  replaced by changing the slot's meal. No "swap this ingredient" control, no
  per-meal opt-out, no undo button.
- **No change to `MP.Cooks` records.** A cook opened from a swapped slot
  stores `variantId` only; the nutrient log for its leftover portions reflects
  the base recipe. Group swaps are like-for-like veg — the coverage checklist
  barely moves, and threading `subs` through cook records is a second
  persistence format for no payoff. Revisit only if a group with a real
  nutrient delta is ever added.
- **No change to `mealdb.js`, `worker/worker.js`, `exclusions.js`,
  `nutrition.js`, `substitutions.json`, `app.js`, `discover.js`,
  `plan-with-me.js`, `prefs.js`.** `GET /ranking` and the manual swap picker
  pass no `budget`, so layer 4 — and therefore substitution — is inactive
  there, same as Phase 27.
- **No shopping-list savings display.** "You saved £2 by swapping" is not in
  scope; the swap shows on the plan card, the saving shows as a smaller list.
- No new dependency, no build step (CLAUDE.md).

### Invariants this phase must not break

- **Hard content exclusions are enforced *after* the swap, never bypassed by
  it** (CLAUDE.md; `OUTLINE.md:409-411`). `subsFor` returns a swap only if
  `MP.Exclusions.check(applySubs(meal, [swap])).ok` is true. This is the last
  step before a swap is returned, in the one function that produces swaps —
  there is no other path by which a `subs` entry can come into existence in
  the app (remote placements are rejected, §5).
- **Substitution never reorders nutrition.** Same rule as cost, pantry, chips
  and busy days: the swap credit only re-weights within the layer-4 shortlist
  that `rankByGap` already produced, and `pickVariant`/`pickMeal` are untouched.
- **A plan can never fail to fill.** No early return, no filter, no `continue`
  added on account of substitution.
- **`rankSlot` stays the one ranking implementation** — all four callers
  (`plan.js` ×3, `worker/worker.js`) keep working unchanged when
  `budget.groups` is absent. No caller gets a substitution-aware variant of it.
- **Knobs are data, not inline constants** (CLAUDE.md). `subCredit` and the
  entire group vocabulary live in JSON; no ingredient name and no weight
  appears as a literal in `generator.js`.
- **No `innerHTML` with unescaped content.** The swap label (§6) is written
  with `textContent`, or through `esc()` if it must be interpolated.
- **`guidedActive` stays the only save gate.** `subs` are written by the
  generator into the in-memory plan; no new `savePlan()` call site.

## §1 `substitution-groups.json` — new data file (D1)

New file at the repo root, beside `substitutions.json`. Read by `plan.js`
(via `shopping-list.js`'s loader, §3.1) only.

```jsonc
{
  "note": "Interchangeable ingredient groups for shopping consolidation. Any member may be swapped for any other member of the same group, in one slot's recipe, when the swap makes a pack already bought that week cover a second dinner. Cost-driven only — unrelated to substitutions.json, which is exclusion swap-ins. Swaps are always re-checked against the hard content exclusions afterwards, so a group must never list mushroom.",
  "groups": [
    {
      "id": "aromatic_veg",
      "label": "Aromatic veg",
      "members": [
        { "key": "onion", "label": "Onion" },
        { "key": "red_onion", "label": "Red onion" },
        { "key": "red_pepper", "label": "Red pepper" }
      ]
    }
  ]
}
```

| Field | Type | Notes |
|-------|------|-------|
| `groups` | array | Missing/not-an-array → feature off, no error. |
| `id` | string | Stable identifier. Not shown to the user; used for the "first group wins" tie-break and future readers. |
| `label` | string | Human name for the group. Not currently rendered; kept so a future "use these up" reader has it. |
| `members` | array | Ingredient entries in `meals.json`'s `{ key, label }` shape. Fewer than 2 members → inert group, no error. |

Seed content: **two or three groups, no more.** Start with `aromatic_veg`
above plus, if the library supports it, a leafy-greens group (spinach/kale)
and a tinned-pulse group (chickpeas/cannellini beans/butter beans). Only list
ingredients that are genuinely interchangeable in *this* library's recipes —
a wrong group is worse than a missing one. **Never list mushroom** in any
group (it is hard-excluded; the post-swap check would reject it anyway, but it
must not be offered).

Matching is on `MP.ShoppingList.normalizeKey(member.key)`. A key appearing in
two groups resolves to the first group in file order.

## §2 `pack-sizes.json` — one new `planning` knob (data)

`planning` (line 61) gains one key. Everything else in the file is untouched.

```jsonc
"planning": {
  "shortlistSize": 4,
  "reuseCredit": 0.60,
  "subCredit": 0.30,
  "budgetTarget": { "max": 120, "step": 5, "default": 0, "maxShortlist": 10 }
}
```

| Key | Type | Notes |
|-----|------|-------|
| `subCredit` | number | £-equivalent credit for one available group swap, applied in layer 4's score. **Must be `< reuseCredit`** so an exact ingredient overlap always beats a swap. Missing/non-finite → treated as `0`, i.e. swaps are still materialised but earn no ranking credit. |

## §3 Loading the groups

### 3.1 `shopping-list.js` — loader + index

Two additions beside the existing memoised `pack-sizes.json` loader
(`shopping-list.js:13-17`), same pattern, same failure behaviour.

```js
/** Memoised fetch of substitution-groups.json. Never throws; -> {} on failure. */
async function loadGroups()                 // -> Promise<object>

/** Flatten groups to a lookup. -> { [normalizedKey]: { groupId, members: [{key,label}] } }
 *  First group wins on a duplicate key. {} for missing/invalid data. */
function groupIndex(groupsData)             // (object|null) -> object
```

`members` in the index keeps the group's **full** member list (including the
key itself); `groupMates` (§4.2) filters the self key out at use time.

`MP.ShoppingList` exports gain `loadGroups` and `groupIndex`. Nothing else in
`shopping-list.js` changes except §5's one-line `purchaseOccurrences` edit.

### 3.2 `plan.js` — hang it on `budget`

At the existing `budget` construction (`plan.js:92-94`), one added property:

```js
groups: MP.ShoppingList.groupIndex(await MP.ShoppingList.loadGroups()),
```

This is `plan.js`'s **only** logic change this phase (§5 adds call-site
arguments). If the fetch fails, `groupIndex({})` is `{}` and the feature is
silently off.

## §4 `data.js` — `applySubs` + `effectiveMeal`'s third argument

### 4.1 New

```js
/** Apply slot substitutions to a recipe. Same object back (no allocation) for
 *  a missing/empty subs list. A sub whose `from` matches no ingredient `key`
 *  is a silent no-op — a stale sub degrades like a stale variantId rather than
 *  throwing. Never mutates `meal`; always keeps `meal.id`. */
function applySubs(meal, subs)      // (meal, Array<{from,to,label}>|undefined) -> meal

/** "" when there are no subs, else "with red pepper" (labels, comma-joined). */
function subsLabel(subs)            // (Array|undefined) -> string
```

`applySubs` maps `meal.ingredients`, replacing a matched entry's `key`/`label`
with the sub's `to`/`label` and **keeping its `qty` unchanged** (group members
are like-for-like by definition; re-deriving a quantity is out of scope).
Matching is exact on `ing.key === sub.from` — no normalisation (see the
auto-decisions).

### 4.2 Changed

```js
function effectiveMeal(meal, variantId, subs)   // subs optional, applied AFTER the variant merge
```

Order matters: the variant is merged first (it may replace the whole
ingredient list), then subs are applied to the result. A sub that no longer
matches the variant's ingredients is a no-op, which is the intended degrade.

`MP.` exports gain `applySubs` and `subsLabel`. Every existing two-argument
`effectiveMeal` call keeps working unchanged.

## §5 `generator.js` — score and materialise the swap (D2)

### 5.1 New helpers (not exported)

```js
/** Other members of `normKey`'s group, or [] when it has none. */
function groupMates(groups, normKey)        // (object|undefined, string) -> Array<{key,label}>

/**
 * The single swap (or none) that would make `meal` reuse a key already bought
 * this half. Returns [] or a one-element [{ from, to, label }].
 * `from` is the recipe's raw ing.key; `to`/`label` are the group member's.
 * Rejects the swap if the swapped recipe fails MP.Exclusions.check — the hard
 * content exclusions are enforced AFTER substitution, never bypassed by it.
 */
function subsFor(meal, half, groups)        // (meal, Set<string>, object) -> Array
```

`subsFor` walks `meal.ingredients` in recipe order and takes the **first**
ingredient whose normalised key is *not* in `half` but which has a group mate
whose normalised key *is* in `half`. That mate is the swap target. It then
builds `MP.applySubs(meal, [swap])` and returns `[]` unless
`MP.Exclusions.check(...)` says `ok`. Also returns `[]` when `groups` is
absent/empty or the meal has no ingredients.

> **ponytail:** one swap per meal, first match wins — not the swap that saves
> the most money. Upgrade path is scoring all candidate swaps by pack price if
> a real plan visibly leaves money on the table; not worth it for a list this
> small.

### 5.2 `rankSlot` — the swap credit (layer 4)

Inside the existing `if (budget)` block, the **only** change is the score line
(`generator.js:137-141`):

```js
const scored = shortlist.map((m) => {
  const c = budget.costIndex[m.id];
  const overlap = c.keys.filter((k) => half.has(k)).length;
  const swaps = subsFor(m, half, budget.groups).length;      // 0 or 1
  return { m, score: c.cost - budget.reuseCredit * overlap - subCreditOf(budget) * swaps };
});
```

where `subCreditOf(budget)` is a finite `budget.subCredit` or `0`. Everything
below — the min-score winners, the least-recently-used tie-break, the
`head.concat(rest)` return — is **unchanged**, as is everything above it
(nutrition, chips, effort, shortlist width).

`subsFor` runs only over the shortlist (at most `maxShortlist`, 10) so the
added work is bounded and trivial.

Update the layer comment (`generator.js:78-82`) so layer 4 reads
"budget shortlist (cost, pack reuse + group substitutions)". Layers and their
order do not change.

### 5.3 `place()` — materialise it

`place` (`generator.js:190-204`) currently computes `half` inside the budget
branch. Hoist that one line so the swap can be computed before the slot object
is written; the branch's conditions are otherwise unchanged.

```js
function place(day, slotType, meal, countsTowardBudget) {
  const variantId = meal ? pickVariant(meal, have) : null;
  const half = day <= 7 ? halfKeys.first : halfKeys.second;
  const subs = meal && budget && budget.groups && countsTowardBudget !== false
    ? subsFor(MP.effectiveMeal(meal, variantId), half, budget.groups)
    : [];
  // slot: { mealId } (+ variantId when set, + subs when non-empty)
  ...
}
```

- The swap is computed against the **effective** (variant-resolved) recipe, so
  a variant that already contains the group mate produces no swap.
- `subs` is written onto the slot object **only when non-empty** — a plan with
  no swaps is byte-identical to today's.
- A leftover day (`countsTowardBudget === false`) gets **no** swap: it reuses
  the parent cook's recipe and must not diverge from it.
- Inside the existing `if (entry)` block, the keys fed into `half` must reflect
  the swap, so a *third* meal can reuse the swapped-in pack:
  `entry.keys` mapped through the subs (`normalizeKey(from)` → `normalizeKey(to)`)
  before `half.add`. `spent` is **unchanged** — a swap's price delta is within
  the noise of pack pricing and re-costing a swapped recipe would mean a second
  `mealCost` call per slot for no decision it feeds.

No change to `generatePlan`'s signature, to `pickMeal`, or to `MP.Generator`'s
exports (`generator.js:294`).

## §6 Call sites that must pass `slot.subs`

Each is a one-argument addition. **No other slot-reading code changes.**

| File:line | Change |
|-----------|--------|
| `plan.js:125` (`effectiveMealAt`) | `MP.effectiveMeal(meal, slot.variantId, slot.subs)` — covers `dayMeals`, the day's other-slot context (`plan.js:270`) and the shelf-life/nutrition passes that read through it. |
| `plan.js:534` (day card) | Same third argument; the card's label line appends `MP.subsLabel(slot.subs)` beside the existing `MP.variantLabel` output, via `textContent`. |
| `plan.js:579` / `plan.js:471-475` (`openDetail`) | `openDetail(meal, variantId, subs)` — pass `slot.subs`; the sheet resolves with it and shows the swap note (`plan.js:475`). |
| `plan.js:584` (`openEatSheet`) | `MP.effectiveMeal(meal, slot.variantId, slot.subs)` — this is what makes `commitCook`'s pantry deduction (`plan.js:709-730`) swap-correct. |
| `plan.js:493` (detail-sheet eat button) | Passes the already-effective `effMeal`; no change beyond `openDetail` receiving `subs`. |
| `shelf-life.js:127` | `MP.effectiveMeal(meal, slot.variantId, slot.subs)`. |
| `shopping-list.js:153` (`purchaseOccurrences`) | `MP.effectiveMeal(meal, slot.variantId, slot.subs)` — **this is where the consolidation is cashed in.** |
| `hermes-sync.js:235` | One line mirroring the `variantId` line: `if (slot.subs && slot.subs.length) slots[slotType].subs = slot.subs;` so the pushed plan view is truthful. |

Explicitly **not** changed: `plan.js:135` `setSlotMeal` (a fresh slot object
already drops stale subs), `plan.js:140` `setSlotVariant` (stale subs degrade
to a no-op), `plan.js:401` (variant picker), `plan.js:798-799`
(`applyPlacements` — remote placements never carry subs),
`worker/worker.js:135`.

## §7 UI

The swap is shown, never edited. Wherever the variant label already renders
(`plan.js:475` detail sheet, `plan.js:535` day card), append the output of
`MP.subsLabel(slot.subs)` — `""` when there are no subs, else
`"with red pepper"`. Written with `textContent` (or `esc()` if interpolated),
in the existing muted/secondary style used by the variant label. **No new CSS
class unless the variant label has none to reuse**, in which case one muted
span rule beside it.

## §8 `sw.js`

- Bump `CACHE` (line 4) `"meal-planner-v20"` → `"meal-planner-v21"`.
- Add `"substitution-groups.json"` to the shell array (beside
  `"substitutions.json"`, line 33). This is the only new file shipped.

## §9 Docs

- **`docs/roadmap.md`** Phase 28 (lines 73-93): record the resolved fork — new
  `substitution-groups.json` (D1), materialised `slot.subs` re-checked against
  exclusions (D2). Mark shipped when done.
- **`CLAUDE.md`**: add one Architecture-invariants bullet — substitution groups
  are data (`substitution-groups.json`), swaps come only from the file's
  groups, layer 4 credits them but never re-scores nutrition or filters,
  `MP.Exclusions.check` runs on the swapped recipe and a failed check drops the
  swap (never the meal), `slot.subs` is generator-written only, and
  `substitutions.json` remains a separate exclusion-only concern. Note
  `slot.subs`'s shape alongside the existing `variantId` note.
- **`docs/ARCHITECTURE.md`**: document `substitution-groups.json` beside the
  `pack-sizes.json`/`ingredient-nutrient-tags.json` data-file descriptions
  (around line 179), the new `planning.subCredit` knob, and the `subs` field in
  the plan-slot shape.
- **`SPEC.md`**: leave unless it enumerates the data files or the plan-slot
  shape; if it does, add both.

## Edge cases

| Case | Required behaviour |
|------|--------------------|
| `substitution-groups.json` 404s / invalid JSON | `loadGroups()` → `{}` → `groupIndex` → `{}` → `budget.groups` empty → no swaps, no credit. Plan byte-identical to pre-Phase-28. No console error beyond the fetch's own. |
| `groups` present but every group has <2 members | `groupMates` always returns `[]`. Inert, no error. |
| A key listed in two groups | First group in file order wins. Documented, not validated. |
| A swap would introduce a hard-excluded ingredient (veg into a toastie, or a mushroom wrongly listed in a group) | `subsFor` returns `[]`. **The meal is still placed, unswapped** — an exclusion rejects the swap, never the meal. Guarded by a test. |
| The recipe already contains the group mate | Its normalised key is in `half` after the first meal, so no ingredient qualifies (the candidate must be *absent* from `half`); no swap. |
| Meal has no `ingredients`, or none priced | `subsFor` → `[]`; `costIndex` entry may be absent, in which case the shortlist filter already drops it from layer 4 (existing behaviour). |
| Leftover day (`countsTowardBudget === false`) | No swap written; the leftover slot resolves to the parent's recipe as today. Guarded by a test. |
| Half boundary | `half` resets on day 8, so a week-2 swap can only reuse a week-2 purchase. Same rule as `reuseCredit`. |
| User changes the slot's meal after generation | `setSlotMeal` writes a fresh slot object → `subs` gone. No stale swap. |
| User changes the slot's variant after generation | `subs` survive; a sub whose `from` isn't in the variant's ingredients is a silent no-op. Never throws. |
| A hand-edited / older `mp_plan` with a garbage `subs` value | `applySubs` returns the meal unchanged for a non-array or empty list; unmatched `from` is a no-op. Never throws. |
| Hermes placement applied to a swapped slot | The slot is replaced wholesale (`plan.js:798`); `subs` are dropped. Correct — a remote meal choice is not a recipe edit. |
| Swap picker / `GET /ranking` | Neither passes `budget`, so neither sees groups. Unchanged. |
| `subCredit` missing, non-finite, or `>= reuseCredit` | Missing/non-finite → `0` (swaps still materialise, no ranking credit). A value above `reuseCredit` is *not* validated — it would let a swap outrank an exact overlap, which is a data mistake, not a crash. Noted in `pack-sizes.json`'s comment. |
| Offline (PWA) | `substitution-groups.json` is in the v21 shell cache; behaviour identical offline. |

## §10 Tests — `test.html` group 45

Logic-only, no DOM. Group 44 is Phase 27 (`test.html:1800`), so this is
**group 45**. Write these before the code.

- **Regression guard first:** `generatePlan(...)` with `budget.groups` absent
  is deep-equal to the same call with `budget.groups = {}` and to a
  pre-Phase-28 call. No slot gains a `subs` key.
- `rankSlot` with `budget.groups` set returns **every** meal in the pool (minus
  `excludeIds`) — same length, same id-set. Nothing is filtered.
- `rankSlot` ordering with `subCredit: 0` is identical to `budget.groups`
  absent — credit off means ranking untouched.
- `rankSlot` with a fixture where a meal's only distinguishing ingredient is a
  group mate of a key already in `half`: it reaches the head with `subCredit`
  set and does **not** with `subCredit: 0`. Proves the credit works.
- An exact-overlap meal still outranks a swap-only meal of the same cost
  (`reuseCredit > subCredit`).
- `generatePlan` writes `subs: [{ from, to, label }]` on the slot when a swap
  applies, and the swapped key appears in the **shopping list** produced by
  `MP.ShoppingList.buildLists` while the original key does not — i.e. one pack
  covers two dinners. This is the test the phase exists for.
- **Exclusion gate:** a fixture whose group swap would put a vegetable into a
  toastie (and one with a mushroom wrongly listed as a group member) →
  the slot is still filled with that meal, and `slot.subs` is absent. The
  exclusion rejects the swap, not the meal.
- At most one swap per meal: a fixture with two swappable ingredients yields
  `subs.length === 1`.
- Leftover days: a batch meal chained into the next day leaves the leftover
  slot with no `subs`.
- Per-half: a week-1 purchase never enables a week-2 swap.
- `MP.applySubs(meal, [{from:"pepper",to:"onion",label:"Onion"}])` — swaps the
  matching ingredient's key/label, keeps its `qty`, keeps `meal.id`, leaves
  other ingredients untouched, and does **not** mutate the input.
- `applySubs` degrades: `undefined`, `[]`, a non-array, and a `from` matching
  no ingredient all return the meal unchanged, no throw.
- `MP.effectiveMeal(meal, variantId, subs)` applies the variant **then** the
  subs; a sub not matching the variant's ingredients is a no-op. Two-argument
  calls behave exactly as before.
- `MP.subsLabel`: `[]`/`undefined` → `""`; one sub → `"with Onion"` (matching
  whatever wording §4.1 settles on).
- `groupIndex`: `{}`/`null`/missing `groups` → `{}`; a duplicate key resolves
  to the first group; members are keyed by normalised key.

## §11 Manual pass

1. `python3 -m http.server 8000`, open `plan.html`. One-tap Generate still
   generates in one tap, all 14 days filled.
2. Generate a few plans and look for a swap note on a day card ("with red
   pepper"). Open that day's detail sheet — the swapped ingredient shows in the
   ingredient list, with its original quantity.
3. Open the shopping list for that week: the swapped-in ingredient appears
   once, the swapped-out one is gone, and the week's total is no higher.
4. Cook/eat the swapped meal: the pantry deduction removes the swapped-in
   ingredient, not the original.
5. Change that slot's meal — the swap note disappears. Change the variant
   instead — nothing throws.
6. DevTools → Network → block `substitution-groups.json` → reload and
   generate: no swap notes, no console exception, plan still fills.
7. Hand-edit `substitution-groups.json` to put `mushroom` in a group, reload,
   generate repeatedly: no mushroom ever appears in a plan. (Then revert.)
8. Hand-edit `mp_plan` to give a slot `subs: "nonsense"`, reload `plan.html`
   and the shopping list: no exception, slot renders unswapped.
9. Dark and light mode: the swap note is legible in both.
10. Offline (DevTools → Offline, after one load): plan and shopping list still
    work from the v21 cache.
