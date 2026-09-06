# Phase 14 — Meal variants

**Goal:** Support variations of the same base meal (a different sauce or side for
one recipe) as linked variants rather than duplicate library entries, so the
generator's variety guard, Browse search and Discover treat a family of variants
as one meal, while the user can still pick a specific variant when planning.

---

## Provenance of the decisions below

One Decision Gate was raised at planning time. The answer recorded here
(**Gate 1 = A**, nested `variants` array) was **relayed to the planner by the
coordinating agent as the user's answer**. It *agrees* with the planner's stated
recommendation, and it agrees with the user's own parked note at
`docs/FUTURE.md:88-105`, so the risk of misattribution is low — but it was not
typed directly into this planner's transcript. Builder: if D1 surprises you,
confirm before migrating `meals.json`.

D8 (the plan-slot `variantId` widening) was **not** gated — the planner flagged
it in the same message and the coordinator confirmed it should be specced as a
deliberate, documented replacement of a Phase 13 assertion.

---

## Decisions taken

**D1 (Gate 1 = A). A variant family is one library entry.** A meal object gains
an optional `variants: []` array. There is no `variantOf` / `baseMealId` /
grouping-id field, and variants are never separate library rows.

**D2. The base meal's own top-level fields ARE the default variant.** A meal with
no `variants` key behaves exactly as today. `variantId: null` on a plan slot means
"the base recipe". Nothing needs backfilling — the migration is a no-op for all 14
existing meals.

**D3. This is why the goal is nearly free.** Because a family is one `meal.id`,
the variety guard (`generator.js` excludes by id), Browse search (`filterMeals`),
Discover's dedupe (`excludeIds()` maps `library` to ids) and the worker's
unique-id check *already* treat a family as one meal. **None of those four code
paths change.** Do not "improve" them into variant-awareness — that would be
re-adding the cost Path A was chosen to avoid.

**D4. One resolver function is the only new concept.**
`MP.effectiveMeal(meal, variantId)` merges a variant over its base and returns a
plain meal-shaped object. Every consumer of a meal's `ingredients` /
`instructions` (shopping list, nutrition, shelf-life, plan rendering) goes through
it. One chokepoint, not a variant branch in each caller.

**D5. A variant may override only `name`, `ingredients`, `instructions`,
`servings`, `prepEffort`.** Everything else (`mealTypes`, `batchCook`, `leadsTo`,
`image`, `source`, `id`) is a property of the *family* and lives only on the base.
A variant cannot be a different meal type or a different batch-cook shape — if it
is, it is a different meal, not a variant.

**D6. The generator does not choose variants.** It plans by `mealId` exactly as
today and leaves `variantId` unset, i.e. the base recipe. Pantry-driven automatic
variant selection is explicitly out of scope for this phase (see "Deliberately
skipped").

**D7. The user picks a variant from the plan day view**, reusing the existing
swap-picker interaction rather than a new control. Variants are *authored* in the
existing Phase 6 add/edit modal.

**D8. A plan slot gains an optional `variantId`.** `{mealId, variantId?, eatenAt}`.
This widens the Phase 13 KV `plan` mirror and **retires** its "slot keys are
exactly `mealId` and `eatenAt`" assertion in `test.html` group 32. That assertion
is to be *replaced*, not deleted quietly, and `docs/HERMES.md` must say the mirror
now carries `variantId`. Hermes needs it to know which recipe is actually cooked.

**D9. No new dependency, no new file.** All work lands in existing files.

---

## What this phase is made of

| Roadmap item | Spec section |
|---|---|
| Variant schema on `meals.json` | 1 |
| Resolver + library plumbing | 2 |
| Variant authoring in the edit modal | 3 |
| Picking a variant when planning | 4 |
| Shopping list / nutrition / shelf-life correctness | 5 |
| Worker + sync + mirror | 6 |
| Confirming search/Discover/variety-guard are untouched | 7 |
| Tests | 8 |
| Docs | 9 |

---

## 1. `meals.json` — one optional field

```
{
  id, name, source, mealTypes, batchCook, prepEffort,
  servings?, description?, instructions, ingredients, image?,
  leadsTo?, leftoverOf?,

  variants?: [
    {
      id:           string   // slug, unique WITHIN this meal only
      name:         string   // short label, e.g. "cream sauce"
      ingredients:  [{key, qty, label}]   // full replacement, not a delta
      instructions?: string
      servings?:     number
      prepEffort?:   string
    }
  ]
}
```

`ingredients` on a variant is a **full replacement list**, never a patch. A delta
format would need merge/removal semantics for a feature with 14 meals in it.

Variant `id` is scoped to its parent — `"cream"` may exist under two different
meals. The globally-unique thing is still `meal.id`, which is what every existing
code path keys on (D3).

**Migration:** none. `variants` absent ⇒ current behaviour. Seed `meals.json` may
optionally gain variants for `chorizo-pasta` (the meal that motivated the parked
note) as a worked example — one meal, not all fourteen.

---

## 2. `data.js` — the resolver and two helpers

```
effectiveMeal(meal, variantId)  -> meal-shaped object
   // variantId null/undefined/unknown  => returns `meal` unchanged (same object)
   // otherwise { ...meal, ...variantFields }, keeping meal.id
   // NEVER mutates `meal`; never changes `id`

findVariant(meal, variantId)    -> variant | null
variantLabel(meal, variantId)   -> string   // "" for the base variant
```

`effectiveMeal` returning the *original object* on the null path matters: it keeps
every existing call site allocation-free and makes "no variants" provably
identical to today.

**Edge cases:** a meal with `variants: []`, a `variantId` that no longer exists
(the user deleted that variant while it was planned), a variant missing
`ingredients`. All three fall back to the base meal rather than throwing or
rendering an empty recipe. An unknown `variantId` is *silently* treated as base —
it is a stale reference, not an error worth a banner.

`upsertMeal` (line 69) and `removeFromLibrary` (line 79) are unchanged: variants
ride along inside the meal object they already persist wholesale.

`filterMeals` (line 174) is **unchanged** per D3. It searches `name`, `mealTypes`
and ingredient keys/labels of the base meal only — a family matches as one row,
which is the goal. Do not extend it to search variant ingredients.

---

## 3. `app.js` / `index.html` — authoring variants in the existing modal

Extends `openForm()` (app.js ~219-247) and the existing `#modal-sheet`. No new
modal, no new page, no separate "variants" screen.

New markup inside the existing form, below `#form-ingredients`:

- `#form-variants` — container listing current variants, one row each:
  variant name + an ingredient-count summary + Edit / Delete buttons.
- `#form-variant-add` — "Add variant" button.
- When adding/editing a variant, the same form swaps into a variant sub-mode:
  `#form-variant-name`, `#form-variant-ingredients` (the same newline-delimited
  textarea format and the same `slugify()` parse the base ingredients field
  already uses, data.js line 88), `#form-variant-instructions`, plus
  `#form-variant-save` / `#form-variant-cancel`.

Reusing the existing ingredient textarea parser is the point — variants must not
grow a second ingredient-entry format.

Functions:

```
renderVariantList(meal)                 -> void   // into #form-variants
openVariantEditor(meal, variantId|null) -> void   // null = new variant
collectVariant()                        -> {id, name, ingredients, instructions}
```

Variant ids are generated with the existing `slugify()` on the variant name, with
a numeric suffix on collision within the same meal.

**Edge cases:** deleting a variant that is referenced by a plan slot is allowed —
the slot silently degrades to the base recipe per §2. Renaming a variant keeps its
id. A variant with an empty name or empty ingredient list is rejected inline via
the existing `#form-msg`, not saved.

**Security:** variant `name`/`instructions` are user-typed, but they round-trip
through KV and Hermes, so every interpolation still goes through `esc()`
(data.js line 14) per the repo invariant.

---

## 4. `plan.js` — picking a variant for a slot

Slot shape becomes `{mealId, variantId?, eatenAt?}` (D8). `variantId` is omitted
entirely when the base recipe is used — never written as `null` — so existing
plans stay byte-identical until a variant is actually chosen.

- The day view renders the variant label after the meal name when one is set:
  `Chorizo & Pasta — cream sauce`, via `variantLabel()`, escaped.
- The existing swap-picker entry point gains a second action for meals that have
  variants: a "Variant" choice listing the base ("Original") plus each variant.
  Selecting one writes `variantId` into the slot and calls the existing
  `savePlan()`. Meals with no variants show no such control at all.

```
openVariantPicker(day, slotType)  -> void
setSlotVariant(day, slotType, variantId|null) -> void
```

`setSlotVariant` reuses `savePlan()` (line 36), so the existing
`"mp:plan-saved"` dispatch already pushes the updated mirror — no new sync
trigger.

**Edge case:** changing a slot's *meal* must clear any `variantId` from that slot
(a variant of the old meal is meaningless on the new one). This is the one real
correctness trap in the phase — fix it in the shared slot-write path, not in each
caller.

`applyPlacements` (Phase 13): a Hermes placement may carry an optional
`variantId`. If present and unknown for that meal, drop the field and apply the
placement against the base rather than rejecting the whole placement.

---

## 5. Consumers that must resolve the variant

Every place that turns a *planned slot* into ingredients or a recipe must call
`MP.effectiveMeal(meal, slot.variantId)` instead of using the raw library meal:

- `shopping-list.js` — wherever a slot is expanded into its ingredient lines.
  This is the highest-value one: choosing the cream-sauce variant must change the
  shopping list, or the feature is decorative.
- `nutrition.js` — coverage scoring reads `ingredients`.
- `shelf-life.js` — category warnings read `ingredients`.
- `plan.js` — the day view's recipe/instructions display.

Anything operating on the *library* rather than a planned slot (Browse cards,
`filterMeals`, Discover, the variety guard) keeps using the base meal — D3.

---

## 6. `worker/worker.js`, `hermes-sync.js`, the mirror

**`mealsError()` (worker lines 65-77):** unchanged for existing fields. Add: if
`meal.variants` is present it must be an array, and each entry must be an object
with a non-empty string `id`, a non-empty string `name`, and an `ingredients`
array; variant ids must be unique within that meal. Absent `variants` is valid.
Reject the whole PUT on any bad entry, matching the existing all-or-nothing
contract.

**`planMirror(plan)` (hermes-sync.js):** carries `variantId` through when the slot
has one, omits it otherwise. Slot keys become `mealId`, `eatenAt`, and optionally
`variantId` — nothing else. The mirror still carries no names, ingredients or
recipe text; Hermes joins against the `library` key, which now contains the
variants.

No new KV key. No change to the ack/watermark scheme, the `X-Auth-Token` check,
CORS, or `mp_sync_ops`.

---

## 7. Confirmed unchanged

| Thing | Why it stays put |
|---|---|
| `generator.js` variety guard (lines 66-137) | Keys on `meal.id`; a family is one id (D3) |
| `generator.js` batch/leftover chains (`leadsTo`) | Family-level, not variant-level (D5) |
| `filterMeals` (data.js 174) | A family should match as one Browse row |
| `discover.js` `excludeIds()` (line 210) | Already id-based; a family is one id |
| Discover ranking chain (`rankByGap` → `orderByTaste` → `orderPool`) | Untouched |
| `mp_prefs` counters | Per-meal, not per-variant — no fourth dimension |
| Exclusions (mushrooms, standalone egg meals, toastie veg) | Still enforced on the base meal |
| KV key list (7 keys), auth, CORS | Untouched |
| `esc()` as the only route into HTML | Still |
| Zero dependencies, no build step | Nothing added |

---

## 8. `test.html` — group 33 (plus one edit to group 32)

Pure-function assertions, matching the existing harness style:

- `effectiveMeal` — returns the *same object* for a null/unknown `variantId`;
  merges `ingredients`/`instructions`/`name` for a known one; never mutates the
  base meal (assert the base's ingredients after the call); keeps `meal.id`
  unchanged; falls back to base for a variant missing `ingredients`; survives
  `variants: []`.
- `findVariant` / `variantLabel` — `null` / `""` for the base; correct label for a
  known variant; no throw for a meal with no `variants` key.
- Variety guard regression — a meal *with* variants still cannot appear on
  consecutive non-batch days (proves D3: variants did not weaken the guard).
- `filterMeals` regression — a family with variants returns exactly one row.
- Slot handling — changing a slot's meal clears `variantId` (§4's trap);
  `applyPlacements` with an unknown `variantId` applies against the base rather
  than rejecting.
- `mealsError` — accepts a meal with no `variants`; accepts a valid `variants`
  array; rejects a non-array `variants`, a variant with no `id`, a variant with no
  `ingredients` array, and duplicate variant ids within one meal.

**Group 32 edit (D8, deliberate replacement):** the existing `planMirror`
assertion that a slot's keys are *exactly* `mealId` + `eatenAt` is replaced by:
keys are a subset of `{mealId, eatenAt, variantId}`; `variantId` is present when
the slot has one and **absent** (not `null`) when it does not; still no
name/ingredient/recipe fields. Leave a one-line comment in the test naming Phase
14 as the reason, so the change reads as intentional.

---

## 9. Docs

- `docs/ARCHITECTURE.md` — document the `variants` field as part of the meal
  schema and state the invariant plainly: *a variant family is one `meal.id`;
  variety guard, Browse search and Discover dedupe are id-based and deliberately
  variant-blind.* Note the plan slot's optional `variantId`.
- `docs/HERMES.md` — the `library` key's meals may carry `variants`; the `plan`
  mirror's slots may carry `variantId`; placements may optionally specify one.
- `docs/FUTURE.md` — the parked note at lines 88-105 is now partly delivered.
  Rewrite it to cover only the still-parked half: pantry-driven *automatic*
  variant selection.
- `SPEC.md` — one line on variants under the meal-library section.
- `docs/roadmap.md` — flip Phase 14 to **Status: Complete** in the same commit as
  the code.

---

## Deliberately skipped

- **Pantry-driven automatic variant picking** (the second half of the parked
  note). The generator plans by meal, the user picks the variant (D6). Add when
  manual picking proves annoying enough to want it automated — the resolver and
  schema this phase adds are exactly what that would build on.
- **Per-variant images, prep times, nutrition overrides.** Add when a variant
  actually differs enough to need one.
- **Per-variant preference counters.** `mp_prefs` stays per-meal.
- **Variants of variants / variant inheritance.** No.
