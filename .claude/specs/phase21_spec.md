# Phase 21 — Pantry-driven automatic variant selection

**Goal:** have the generator pick a meal's variant (Phase 14's `meal.variants`)
from what `/pantry` says is in stock, instead of always leaving `variantId`
unset and defaulting to the base recipe.

Phase 14 already shipped the `variants` schema and the `MP.effectiveMeal`
resolver; Phase 11 already shipped pantry key matching. This phase adds **no
new data model and no new matching logic** — it is one scorer, one argument
threaded through, and one field written on a slot.

---

## Decisions (answered **1B, 2A, 3A**; relayed verbatim from the user by the dispatching coordinator)

| # | Decision | Chosen |
|---|---|---|
| D1 | Tie-break when no variant fully matches pantry stock | **B — fewest missing ingredients wins**, with the base recipe scored as just another candidate and **winning all ties**. Not "complete match only" (Path A), which with a partly-stocked real pantry would almost never fire. |
| D2 | Pantry-picked variant vs. the manual picker | **A — no provenance tracking.** The generator writes `variantId` at generation time; `setSlotVariant` (`plan.js:138`) overwrites it freely afterwards and that is final. No `variantAuto` flag. |
| D3 | How the generator gets the pantry | **A — synchronous local mirror.** `plan.js` reads `MP.Sync.localItems("pantry")` and passes a prebuilt key index into `MP.Generator.generatePlan`. Nothing in the generate/render path becomes `async`. |

D3's accepted cost, stated plainly so it is not rediscovered as a bug: on a
first page load before any Hermes fetch, generation uses the **last mirrored**
pantry, which may be stale. `MP.Sync.fetchItems` (`hermes-sync.js:124-136`)
already falls back to that exact same mirror whenever Hermes is unreachable, so
Path B would have bought freshness only in that one narrow window — not worth
making the render path async for.

D2 note: `regenerate()` (`plan.js:107`) already discards the whole plan,
mealIds included, so manual variant picks are lost on regenerate **today**.
This phase does not change that and must not try to preserve them.

---

## Findings (verified, do not re-derive)

- `MP.effectiveMeal(meal, variantId)` — `data.js:169`. Merges the variant over
  the meal, preserves `meal.id`, returns `meal` **unchanged** when `variantId`
  is null/unknown or the variant has no `ingredients`. No mutation. Safe to
  call with anything.
- **The matching primitive already exists**: `pantryOverlap(meal, have)` at
  `discover.js:254` — counts a meal's ingredients present in a pantry index. It
  is a one-liner over `MP.ShoppingList.normalizeKey`.
- `MP.ShoppingList.normalizeKey(text)` — `shopping-list.js:48`. Lowercase,
  non-alphanumeric → `_`, trailing `s` stripped per word (`baked_beans` →
  `baked_bean`). Exact match after normalization.
- `MP.ShoppingList.pantryIndex(pantry)` — `shopping-list.js:59`. Takes the
  **response body** (`{ items: [...] }`), not a bare array, and returns
  `{ normalizedKey: qtyString }`.
- `MP.Sync.localItems(list)` — `hermes-sync.js:143`. **Synchronous**, returns
  the mirror's `items` **array** (`[]` on missing/malformed), never throws.
  Shape mismatch with `pantryIndex` — see §3.
- `generatePlan(library, tags, targets, shelfData, startDate, budget)` —
  `generator.js:48`. Fully synchronous, never reads pantry today.
- **`place(day, slotType, meal, countsTowardBudget)` — `generator.js:56-66` is
  the single choke point.** All four scheduling call sites (`:137` batch/
  leftover, `:148` quick dinner fill, `:161` other slots) route through it, and
  it currently writes `{ mealId }` only. One change here covers every slot;
  do not patch the call sites individually.
- `pickMeal` (`:74-111`) ranks by `MP.Nutrition.rankByGap` (`:82`) then
  optionally narrows by the Phase 17 `budget` step (`:88-105`). Variant choice
  happens **after** a meal is already chosen — it never re-enters this function.
- `MP.ShoppingList.buildLists` already resolves `slot.variantId` through
  `MP.effectiveMeal` in `purchaseOccurrences` (`shopping-list.js:148`), so the
  shopping list picks this up with **no change** — see "Downstream" below.
- `plan.js:608 commitCook` reads `eatCtx.variantId` and passes it to
  `MP.Cooks.open`; `plan.js:641 eatPortion` never touches pantry. Neither needs
  changing — both already handle a set `variantId`.
- Only **one** meal in `meals.json` has a non-empty `variants` array
  (`chorizo-pasta` → `cream-sauce`). This phase ships correct but nearly
  invisible until more variants exist; the tests carry the real coverage.

## Non-goals

- **No pantry depletion across the plan.** Two meals both wanting the last tin
  each score it as in stock. Accepted ceiling, marked with a `ponytail:`
  comment naming plan-wide depletion tracking as the upgrade path.
- **No new matching/normalization logic**, no fuzzy matching, no quantity
  comparison. Presence of the normalized key is the whole test, exactly as
  Discover already does it.
- **No async anywhere** (D3). No new fetch, no loading state, no new dependency.
- **No variant choice for meals without `variants`** — and therefore none for
  leftover children, which carry `leftover_*` ingredients and no variants. No
  special-casing needed; the empty-variants guard covers it.
- **No `variantAuto` field, no manual-pick preservation across regenerate** (D2).
- **No UI change.** The existing picker (`app.js:288-311`) already renders the
  current `variantId`; it will simply show a preselected variant.

### Invariant this phase must not break

Variant selection runs **after** `pickMeal` has already chosen the meal, and
never re-orders or filters candidates. Same rule CLAUDE.md fixes for cost:
**nutrition ranking decides which meal; the pantry only decides which version
of that meal.** Do not move variant scoring into `pickMeal`.

---

## §1 `shopping-list.js` — promote one helper

Move `pantryOverlap` out of `discover.js:254` to sit beside its two
dependencies (`normalizeKey` `:48`, `pantryIndex` `:59`) and export it from the
`MP.ShoppingList` object (`:275`):

```
pantryOverlap(meal, have) -> number   // count of meal.ingredients whose normalized key is in `have`
```

- Body is unchanged from the Discover original.
- Returns `0` for a falsy/absent `ingredients` array or an empty `have`. Never
  throws.

This is a move, not a second copy — `toast()` is already triplicated
(`app.js:73`) and that is not a pattern to extend.

## §2 `discover.js` — repoint, delete local copy

- Delete the local `pantryOverlap` (`:254-256`).
- Its caller now uses `MP.ShoppingList.pantryOverlap(...)`. `discover.html`
  already loads `shopping-list.js` (used for `normalizeKey`), so there is
  nothing to wire.
- `pantryIndexCached()` (`:243-251`) is unchanged.

## §3 `plan.js` — supply the pantry index (D3)

In the `generatePlan()` wrapper (`:90-95`), build the index synchronously and
pass it as a new trailing argument:

```
const have = MP.ShoppingList.pantryIndex({ items: MP.Sync.localItems("pantry") });
```

- **The `{ items: ... }` wrap is required** — `pantryIndex` expects the response
  body, `localItems` returns a bare array. Passing the array directly yields an
  empty index and silently disables the whole phase.
- Pass `have` as the 7th argument to `MP.Generator.generatePlan`.
- No other change in `plan.js`. `loadPlan` (`:97`), `regenerate` (`:107`),
  `commitCook` (`:608`) and `eatPortion` (`:641`) are untouched.

## §4 `generator.js` — the scorer and one written field

**Signature gains a trailing optional argument:**

```
generatePlan(library, tags, targets, shelfData, startDate, budget, have)
```

`have` defaults to `{}` when omitted, so every existing caller and every
existing test keeps working with base recipes only.

**New module-local function:**

```
pickVariant(meal, have) -> string | null   // a variant id, or null for the base recipe
```

- Returns `null` immediately when `meal` has no non-empty `variants` array, or
  when `have` is empty. This is the fast path for almost every meal.
- Otherwise scores the base and each variant by **missing count**:
  `ingredients.length - MP.ShoppingList.pantryOverlap(candidate, have)`, where
  each candidate is `MP.effectiveMeal(meal, v.id)` (and the base is `meal`).
- Lowest missing count wins. **The base wins all ties** (D1) — including the
  all-zero-stock case, where every candidate ties at its own length only if
  lengths match; base-wins-ties plus strict `<` comparison gives base priority
  without a separate branch.
- Compares raw counts, not ratios: a 3-ingredient variant missing 3 loses to a
  5-ingredient base missing 2.
- Never throws on a malformed variant — `MP.effectiveMeal` already returns the
  base meal when a variant lacks `ingredients`.
- Carries the `ponytail:` comment for the no-depletion ceiling (see Non-goals).

**`place` (`:56-66`) — the only write site:**

```
days[day - 1].slots[slotType] = { mealId: meal ? meal.id : null };
```
becomes a slot that **also carries `variantId` when, and only when,
`pickVariant` returns non-null**. An empty slot (`meal` null) and a
base-recipe slot both keep the exact `{ mealId }` shape they have today — do
not write `variantId: null`, which would bloat every stored plan and change
`JSON.stringify` output for every existing slot.

No change to `pickMeal`, the batch loop (`:116-140`), the quick fill
(`:142-149`) or the other-slots fill (`:151-163`).

## Downstream (expected, not a bug)

Once the generator sets `variantId`, `MP.ShoppingList.buildLists` resolves it
through `MP.effectiveMeal` at `shopping-list.js:148` — so **the shopping list
will start listing the variant's ingredients** for an auto-picked slot, with no
code change. That is the intended effect (buy what completes the recipe you
can actually cook), and it is the thing to sanity-check in the manual pass.

Cost badges (Phase 18) deliberately keep using the **base** meal — that
behaviour is specified in `phase18_spec.md` and must not be "fixed" here.

---

## Edge cases

| Case | Behaviour |
|---|---|
| Hermes disabled / never synced | `localItems` returns `[]` → `have` is `{}` → `pickVariant` returns `null` everywhere → base recipes, exactly as today. |
| Pantry mirror malformed JSON | `localItems` already returns `[]`. No throw, no broken plan. |
| Meal with no `variants` (all but one today) | `null`, fast path, no `variantId` written. |
| Leftover child meal (`leftoverOf` set) | No `variants` → base. Never diverges from the parent cook. |
| Variant with no `ingredients` | `MP.effectiveMeal` returns the base, so it scores identically to base and loses the tie to base. |
| Every candidate fully missing | Base wins (D1 tie rule). |
| Two variants tie below base | First in `variants` order wins. Order in `meals.json` is the tiebreak; do not sort. |
| User then picks manually | `setSlotVariant` overwrites; picking "base" deletes the field (D2). |
| `regenerate()` | Whole plan rebuilt, variants re-picked from current stock. Manual picks lost — unchanged from today. |
| Stored plans from before this phase | No `variantId` → `MP.effectiveMeal` returns base. No migration needed. |

## §5 Tests — `test.html` **group 39**

Group 38 is Phase 20 (`test.html:1418`), so this is **group 39**. Follow the
group-38 pattern: fixture object literals plus `check(name, bool)`. Write these
before the code.

- `pantryOverlap` after the move: still exported and correct from
  `MP.ShoppingList` — counts matched normalized keys, `0` for a meal with no
  `ingredients`, `0` for an empty index.
- `pickVariant`: meal with no `variants` → `null`; empty `have` → `null`.
- `pickVariant`: variant fully in stock, base not → returns that variant's id.
- `pickVariant`: base fully in stock, variant not → `null` (base).
- `pickVariant` **D1 tie-break**: neither fully matches, variant missing fewer
  → variant id. Neither matches, equal missing counts → `null` (base wins ties).
- `pickVariant`: variant lacking `ingredients` never wins.
- `place`/`generatePlan` integration: with a `have` that favours the variant, the
  scheduled slot has `variantId`; with `have` omitted entirely, **no slot has a
  `variantId` key at all** (regression guard for the stored-plan shape).
- Regression guard: `generatePlan` output with no `have` argument is otherwise
  identical to the group-38 expectations — this phase adds a field, it does not
  change which meals get scheduled.

## §6 Docs

- `docs/roadmap.md` — Phase 21 → **Status: Complete**; one "as built" note
  recording D1 (fewest-missing, base wins ties), D2 (no provenance field) and
  D3 (synchronous mirror read, stale-on-first-load accepted). Leave the goal
  line intact.
- `CLAUDE.md` — extend the invariants: the pantry chooses **which variant of an
  already-chosen meal**, never which meal — nutrition ranking is untouched,
  same rule as cost. Note the generator is now a second pantry **reader**
  (`commitCook` is still the only pantry **writer**).
- `docs/ARCHITECTURE.md` — `pantryOverlap` now lives in `shopping-list.js`
  beside `normalizeKey`/`pantryIndex`; generator takes an optional `have` index.
- `SPEC.md` — one line: plans prefer the version of a recipe you have
  ingredients for.
- `docs/FUTURE.md` — mark the parked pantry-based variant-picking idea shipped;
  park **plan-wide pantry depletion** as the known ceiling this phase skipped.

## §7 Manual pass

- With a real synced pantry, regenerate a plan: does `chorizo-pasta` land on
  `cream-sauce` when the cream is in stock, and base when it is not?
- Open `shopping.html` for that plan and confirm the list reflects the **picked
  variant's** ingredients (the Downstream section above) and still totals sanely.
- Open the variant picker on that slot: the auto-picked variant must show as
  currently selected, and picking base must stick (D2).
- With Hermes disabled entirely: plans generate as before, all base recipes, no
  console error.
