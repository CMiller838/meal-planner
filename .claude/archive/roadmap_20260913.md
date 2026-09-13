# Roadmap

Active roadmap. Superseded versions live in `.claude/archive/` — this file is
updated in place, never forked into a versioned copy.

Source of scope: `docs/OUTLINE.md` — the Phase 2 must-haves for Phases 1-6 (v1),
the "Meal Planner — v2 Outline" must-haves and nice-to-haves for Phases 7-13, and
the "Meal Planner — v3 Outline" must-haves and nice-to-haves for Phases 16-19 —
against the stack in `docs/ARCHITECTURE.md`. Parked ideas in `docs/FUTURE.md`
are explicitly not sequenced here (the one exception: v3's per-meal cost tag,
which the v3 outline explicitly un-parks now that cost is the version's theme).
Phase 20 (meal servings/leftovers) and Phase 21 (pantry-driven variant
selection) are not in the original `docs/OUTLINE.md` either — added directly
to the roadmap, same as Phases 14-15 were for v1 (Phase 21 was a
previously-parked `docs/FUTURE.md` idea, now promoted).

Previous roadmap (Phases 1-15, all shipped) archived at
`.claude/archive/roadmap_20260906.md`.

---

# v3 — cost-awareness (Phases 16-21)

## Phase 16 — Discover card detail view (Status: Complete)

**Goal:** Make a Discover suggestion card tappable, opening a full detail view —
recipe, ingredients, nutrition — reusing the Library's existing `openDetail`
modal in `app.js` rather than building a second detail surface.

*Sequenced first because it is the only v3 phase that touches neither the
generator nor the shopping list, so it carries no risk into the cost work that
follows, and because it is the cheapest: Phase 6 already shipped the modal this
phase renders into, and `discover.js` currently wires only swipe/like/skip, so
the change is a click handler plus a data shape adapter for a not-yet-liked
TheMealDB result. Its one real constraint is Phase 1's invariant that every
TheMealDB string goes through `esc()` — an untrusted-content surface the Library
modal has never had to serve before.*

**As built:** no adapter was needed — `discover.js` pool/saved entries are
already `toMeal()`-shaped — and the sheet is Discover's own `openDetail` in
`discover.js`, not `app.js`'s (whose Edit/Delete actions assume library
membership). See `.claude/specs/phase16_spec.md` D1/D2 for why.

## Phase 17 — Auto-built, cost- and length-optimized shopping list (Status: Complete)

**Goal:** Rebuild the shopping list the moment a 2-week plan is generated, and
make what it produces favour cheap, reusable ingredients while actively keeping
the list short — rather than aggregating whatever the plan happens to need.

*The v3 outline lists these as two must-haves; they are sequenced as one phase
because they are the same seam. `generator.js` has zero coupling to
`shopping-list.js` today, and both items are that coupling: one adds the
generate → rebuild trigger, the other lets cost feed back into what the
generator picks in the first place. Splitting them would mean re-plumbing the
same seam twice. Depends on Phase 11, whose
`MP.ShoppingList.buildLists(plan, mealsById, packData)` and on-hand subtraction
are what the cost weighting leans harder on, and on the hand-maintained Asda
pack-price data in `pack-sizes.json` — which stays hand-maintained, per v3's
non-goal on real-time pricing.*

*Open scoping for this phase's spec (deliberately not settled here): the shape
of the cost signal in plan generation (a per-ingredient cost weight? a per-meal
one?) and what "short" means concretely (a target max line count? a reuse
threshold?). The outline flags both as `@planner` phase-spec decisions.*

*Two more concrete items folded into this phase's scoping rather than split out,
since both refine the same "cheap and reusable" must-have:*
- *Price data quality: when `pack-sizes.json` is populated/extended for this
  phase, prices should reflect real current Asda pack prices, not placeholder
  round numbers. For an ingredient with no explicit entry, replace today's single
  global "1 pack of the default size" fallback with a small set of **category
  averages** (veg, meat, dairy, pantry, etc.) in the same data file, so an
  unmatched ingredient prices against its category rather than one arbitrary
  default.*
- *Cross-meal ingredient reuse: beyond aggregating identical ingredient lines
  (already Phase 3's job), the generator should be able to favour scheduling
  meals within the same 2-week cycle that share an ingredient or cut — e.g. a
  whole chicken serving both a roast and fajitas, or one pack of peppers
  covering both fajitas and chilli — so one purchase serves two recipes instead
  of two separate packs. This is an ingredient-overlap signal alongside the
  cost-weight signal, both to be shaped at `@planner` phase-spec time.*

**As built:** `MP.ShoppingList.buildLists(plan, mealsById, packData, pantry)`
is 4-arg (`pantry` was added in Phase 11) — correcting this section's stale
3-arg reference above. The cost signal is per-meal (`mealCost`/`costIndex` in
`shopping-list.js`), passed into `generatePlan` as an optional 6th `budget`
argument so `generator.js` stays pure with zero references to
`MP.ShoppingList`. "Short" is emergent, not a line-count cap: within the
nutrient-ranked shortlist, `pickMeal` picks the lowest
`cost − reuseCredit × same-half ingredient overlap`. "Auto-build" shipped as
stamp-and-invalidate — `generatePlan` stamps a `generatedAt` on the plan, and
`shopping.js` keys ticked checkboxes to it instead of `startDate` — not a
persisted rebuild; the list was already recomputed on every `shopping.html`
open (Phase 3), so the real bug was stale ticks surviving a same-day
regeneration, which this fixes directly. `pack-sizes.json` gained
`categories`/`keywords` category-fallback pricing and a `planning` knobs
block, per this section's "price data quality" scoping. See
`.claude/specs/phase17_spec.md`.

## Phase 18 — Per-meal cost tags on cards (Status: Complete)

**Goal:** Show a cheap/med/pricey badge per meal on Library and Discover cards,
following the existing nutrient-tag pattern, so cost is visible while browsing
rather than only as a total after a plan is built.

*First of the nice-to-haves, and sequenced after Phase 17 because it is a second
consumer of the same per-meal cost figure Phase 17 has to derive to weight the
generator at all — building it earlier would mean inventing that costing twice.
Reuses the nutrient-tag rendering path, and inherits Phase 1's invariant that
tags are data, not inline constants: the cheap/med/pricey thresholds belong in a
data file alongside `nutrition-targets.json`, not hardcoded in JS. Rendering on
Discover cards additionally depends on Phase 16 having established how a
not-yet-liked TheMealDB result is mapped to a meal-shaped record.*

As built: the badge shows `mealCost().total` — the same whole-pack figure the
shopping list and generator use — not a bare cheap/med/pricey word; the tier
is used only to colour the badge. See `.claude/specs/phase18_spec.md`.

## Phase 19 — Shopping list as two tabs (Status: Complete)

**Goal:** Move Phase 12's planned and ad-hoc lists from two stacked sections on
`shopping.html` into two separate tab views, matching how Browse/Plan/Discover/
Shopping are already separate tabs.

*Last, and the only phase here that is safe to drop: the outline is explicit
that this is a layout preference, not a real pain point — no confusion between
the two lists exists today. No new list logic; it re-presents Phase 12's
existing split. Sequenced after Phase 17 so the tabs are built against the list
contents the cost/length work settles, rather than being restyled twice.*

## Phase 20 — Meal servings & leftover-eating (Status: Complete)

*As-built: `servings` already existed on every meal (added earlier for
coverage maths), so this phase **deleted `batchCook`** rather than adding
`servings` — `MP.isBatch(meal)` (`servings >= 2 && !leftoverOf`) replaces it
at all four call sites. Open question 2 (how the variety guard treats a
2-slot meal) resolved to **no change** — leftover eating is post-hoc
bookkeeping, not planning, so the guard still only spaces scheduled cooks.*

**Goal:** Track a serving count per meal (most dinners ≥2), let one cook supply
more than one eat — e.g. tonight's dinner and tomorrow's lunch — without forcing
every extra portion into its own scheduled plan slot, and make the eat flow
distinguish "cooked" (deduct pantry, once) from "ate a portion" (log to the
Phase 15 nutrient log, once per sitting).

*Not in the original `docs/OUTLINE.md` — added directly to the roadmap, same as
Phases 14-15 were for v1. Generalizes the existing `batchCook: true`
leftover-chain mechanic (already "a planning primitive" per `CLAUDE.md`) into a
`servings: N` field on every meal instead of an opt-in flag on some: the
generator already knows how to schedule a leftover into the next 1-2 days and
skip re-deducting pantry ingredients for it, so this reuses that machinery
rather than inventing parallel logic. Sequenced last because it depends on
Phase 17 having settled the shopping-list/generator coupling and cost signal —
fewer distinct meals needed per cycle changes what "short list" and "cost
weight" mean, so it should land after that shape is fixed, not before. Also
touches Phase 12's eat flow (cook-vs-eat becomes two events on one meal
instance) and Phase 15's nutrient log (logs per portion eaten, not per cook).*

*Open scoping for this phase's spec: whether leftover portions must land in an
actual plan slot at all, or can be eaten off-plan (e.g. lunch on a day with no
scheduled lunch slot) with only a log entry and no plan-grid change; how the
variety guard treats a 2-slot meal for repeat/spacing purposes; and whether
`batchCook` is replaced by `servings` outright or the two fields coexist for a
transition period. Per-portion sizing itself is settled, not open: `CLAUDE.md`
now fixes portion size at a hungry 20-year-old male appetite (bigger than a
generic serving guide, ingredient `qty` rounded to practical kitchen
fractions) — this phase's `servings: N` count is layered on top of that
per-portion size, not a replacement for it.*

## Phase 21 — Pantry-driven automatic variant selection (Status: Complete)

**Goal:** Have the generator pick a meal's variant (Phase 14's `meal.variants`)
automatically based on what `/pantry` says is in stock, instead of always
leaving `variantId` unset and defaulting to the base recipe.

*Not in the original `docs/OUTLINE.md` — this was a parked `docs/FUTURE.md`
idea, now promoted directly to the roadmap. No new data model: Phase 14
already shipped the `variants` schema and the `MP.effectiveMeal(meal,
variantId)` resolver this phase reads through, and Phase 11 already shipped
the app's only pantry consumer (`MP.ShoppingList.buildLists`) — this is a
second pantry consumer, in the generator instead of the shopping list.
Sequenced last because it depends on Phase 20 having settled how `servings`
and leftover-chain scheduling work: a variant choice interacts with which
slot a meal (or its leftover) lands in, so the generator's slot-filling logic
should be stable before this adds a second axis of choice to it.*

*Open scoping for this phase's spec: the tie-break when no variant's
ingredients fully match pantry stock (fall back to base recipe, or to the
variant with the fewest missing ingredients?), and whether a pantry-picked
variant can be overridden by the existing manual picker on the same slot.*

*As built: D1 — fewest-missing-ingredients wins, with the base recipe scored
as just another candidate and winning all ties. D2 — no provenance field; the
generator writes `variantId` at generation time and the existing manual picker
(`setSlotVariant`) overwrites it freely afterwards, same as before. D3 — the
generator reads the pantry synchronously off `MP.Sync.localItems("pantry")`
(the same local mirror `MP.Sync.fetchItems` already falls back to when Hermes
is unreachable); a first page load before any Hermes fetch can generate off a
stale mirror, accepted rather than making the render path async.*

---
