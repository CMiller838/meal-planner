# Roadmap

Active roadmap. Superseded versions live in `.claude/archive/` — this file is
updated in place, never forked into a versioned copy.

Source of scope: `docs/OUTLINE.md` — the Phase 2 must-haves for Phases 1-6 (v1),
the "Meal Planner — v2 Outline" must-haves and nice-to-haves for Phases 7-13 —
against the stack in `docs/ARCHITECTURE.md`. Parked ideas in `docs/FUTURE.md`
are explicitly not sequenced here.

---

## Phase 1 — MVP meal planner (Status: Complete)

**Goal:** Ship a static, browser-only planner: liked-meal library, 2-week plan
generation, nutrient-coverage scoring, shelf-life/leftover warnings,
TheMealDB discovery, PWA install.

Shipped ahead of this roadmap, direct from `SPEC.md`; history in `git log`.

---

## Phase 2 — Plan generator & browse quality (Status: Complete)

**Goal:** Fix the generator's rough edges from real use and make a growing
library navigable — repeat/variety guard, data-driven prep-effort tags the
generator can favour on weeknights, and ingredient/meal-type search on Browse
& Add.

*Sequenced first because the prep-effort tag changes the meal record shape,
which every later phase (shopping list, KV sync) reads.*

## Phase 3 — Shopping list from the 2-week plan (Status: Complete)

**Goal:** Turn a generated plan into a per-shop-day (day 1 / day 8) shopping
list: aggregate ingredient quantities, round to real Asda pack sizes from a new
hand-maintained data file, and show a rough total cost.

*Follows Phase 2 because it aggregates generator output, which the variety
guard and batch-cook chains change.*

## Phase 4 — Hermes bridge (Cloudflare Worker + KV) (Status: Complete)

**Goal:** Stand up the secret-gated Worker + KV sync so the liked-meal library
moves both ways between the app and Hermes (last-write-wins), and the app acts
on a Hermes-set "generate a new plan" flag.

*The only backend work in the project; isolated so the app-side schema is
settled before anything syncs it. Deployable and testable on its own, with no
conversational layer yet.*

Extended post-Phase 6 with a `/pantry` endpoint (same relay pattern as
`/library`) so Hermes can track what food is on hand — see `docs/HERMES.md`.
Not app-consuming yet; the v1 retro (below) adopted pantry-driven shopping/
eat-flow features for v2 to build on it.

## Phase 5 — Hermes conversational capabilities (Status: Complete)

**Goal:** Give Hermes the chat skills on top of the bridge: recipe and
nutrition Q&A over the existing tag data, add/remove/change ingredients within
a meal, TheMealDB discovery applying the app's exclusion rules but offering a
mushroom-substituted version instead of a blanket reject, and the "generate a
new plan" trigger phrase.

*Entirely dependent on Phase 4's endpoints and shared exclusion-rule module.*

## Phase 6 — Library CRUD & Browse cleanup (Status: Complete)

**Goal:** Strip the leftover duplicate Discover section out of `index.html`,
add a manual "Add a meal" form (name, description, recipe, meal type, with a
soft duplicate-name warning), give the library detail modal Edit and Delete
actions (delete backed by a confirm + undo toast) — description, recipe, and
meal type become editable and a meal can be removed, with the removal
propagating to Hermes via the existing whole-library sync — and add
meal-type filter chips to the Library grid alongside the existing search.

*Pure app-side UI/data work on top of the settled Phase 1 library schema and
Phase 4 sync mechanism — no new backend surface, independent of Phases 2-5's
generator/shopping-list work.*

---

# v2 — usability polish (Phases 7-13)

Scope from `docs/OUTLINE.md`'s "Meal Planner — v2 Outline". Phases 7-9 are the
v2 must-haves; Phases 10-13 are its nice-to-haves, sequenced after rather than
parked. No stack change — the `@architect` step was skipped deliberately, since
every phase below fits the existing static-site + Hermes Worker/KV shape and
adds no dependency.

## Phase 7 — Mobile chrome & Discover filters (Status: Complete)

**Goal:** Make the top nav a horizontally scrollable strip at phone widths, and
add category filter chips above the Discover results so the deck is no longer
fixed to one hardcoded ingredient pool.

*Grouped because they are the same piece of work twice — a horizontally
scrollable strip of pills. Both reuse the `.chip-row`/`.chip` component and
`.nav` layout already in `style.css`, so one styling pass covers both, and the
chips rebuild the Discover pool through the `filter.php` → `lookup.php` two-step
`mealdb.js` already uses. Sequenced first because neither touches the meal
record, so it carries no risk into the data work that follows.*

*Settled scope:* chips only — Discover has no free-text search today (the pool
comes from five hardcoded ingredients in `mealdb.js`, and the search box the
outline refers to is the Library's), and none is being added; the chips are how
Discover is steered. The outline's "using what's left" chip needs pantry data
and defers to Phase 11 rather than pulling a nice-to-have forward.

## Phase 8 — Meal image backfill (Status: Complete)

**Goal:** Fill in missing meal images — a TheMealDB lookup by name first, with a
manual photo attach in the add/edit form as the fallback, downscaled to a small
JPEG data-URL on the way in.

*The only phase that writes to the meal record and the only one that changes
what the Hermes sync payload carries, so it is isolated. Sequenced before the
expanded day view purely so that view is built against a library that actually
has images rather than eight placeholder tiles — 8 of the 14 seed meals still
carry `image: null`.*

*Settled scope:* an uploaded photo is downscaled via `<canvas>` to roughly 50KB
and stored in the existing `image` field as a data-URL, so there is no schema
change and no new dependency. It syncs to KV like any other field — the library
blob is the off-device copy, and excluding photos from it would mean losing them
with a browser-data clear.

## Phase 9 — Expanded plan day view (Status: Complete)

**Goal:** Replace the compact day interaction on the 2-week plan with a full
expanded view of that day's meals, ingredients and warnings.

*Last of the must-haves because it renders what the previous two fix — images
from Phase 8 and the shared strip/modal styling from Phase 7. It also has the
largest behavioural surface: a day tap currently goes straight to the swap
picker, so this phase re-plumbs that entry point.*

*Settled scope:* the expanded view becomes the day tap's destination and each
meal inside it gets a Swap action opening the existing `openSwapPicker`
unchanged — swapping moves one tap deeper rather than being rebuilt inline.

## Phase 10 — Nutrient-gap-aware Discover (Status: Complete)

**Goal:** Rank Discover suggestions by the nutrients the current liked-meal
library under-covers.

*First of the nice-to-haves because it is the cheapest: `MP.Nutrition`'s
`dayCoverage().missing` and `rankByGap()` already exist and are already wired
this exact way for the plan's swap suggestions, so this is a second caller, not
new logic. Depends on Phase 7 having restructured how the Discover pool is
built, which is what it ranks.*

## Phase 11 — Pantry-aware shopping (Status: Complete)

**Goal:** Consume the already-shipped `/pantry` endpoint so the shopping list
subtracts what is already on hand — covering both bulk-buy/reuse of ingredients
that outlast one 2-week cycle and pantry-driven cost reduction.

*Those two outline items are one code path: `MP.ShoppingList.buildLists(plan,
mealsById, packData)` gaining on-hand quantities. This is the first time the app
reads pantry data at all — Phase 4's endpoint has never had an app-side consumer
— so it has to precede anything that writes back to it. Also the natural home
for Phase 7's deferred "using what's left" Discover chip.*

## Phase 12 — Eat flow & split shopping lists (Status: Complete)

**Goal:** Mark a meal eaten from the plan or library, review the remaining
ingredient quantities, confirm, deduct from the pantry, and drop any shortfall
onto a separate ad-hoc shopping list alongside the existing planned one.

*The eat flow and the planned/ad-hoc list split are the same feature from
opposite ends — the shortfall the eat flow produces needs a list to land in, and
that list is the ad-hoc one. Depends on Phase 11 having established pantry
read/write in the app.*

## Phase 13 — Hermes plan placement & preference learning (Status: Complete)

**Goal:** Let Hermes place a specific meal into a specific plan slot, and let
the app and Hermes adapt suggestions from actual like/dismiss/eaten behaviour
rather than the static tags and exclusion rules alone.

*Last because both need something no earlier phase provides. Plan-slot placement
requires a plan surface in KV, which `docs/ARCHITECTURE.md` currently rules out
("the plan itself is never stored in KV") — a real architecture decision to take
at this phase's planning step, not polish. Preference learning wants eaten
history, which only exists once Phase 12 has shipped.*

## Phase 14 — Meal variants (Status: Complete)

**Goal:** Support variations of the same base meal (e.g. a different sauce or
side for one recipe) as linked variants rather than duplicate library entries,
so the generator's variety guard, Browse search, and Discover treat a family
of variants as one meal while the user can still pick a specific variant when
planning.

*Not in the original `docs/OUTLINE.md` — added directly to the roadmap. A
`meals.json` schema change (a variant needs to reference its base meal), so
it depends on Phase 2's variety-guard field shape and reuses Phase 6's
edit/delete CRUD for the variant-management UI. Sequenced after the v2
must-haves/nice-to-haves since it's a new data-model shape, not polish on the
existing one.*

## Phase 15 — Eaten-meal nutrient logging for Hermes (Status: Complete)

**Goal:** When a meal is marked eaten (Phase 12's eat flow), append an entry
— meal name, date, nutrient tags from `ingredient-nutrient-tags.json` — to a
new `/eaten-log` Hermes-bridge endpoint (same relay pattern as `/pantry`), so
Hermes can answer questions about whether nutrient/vitamin/vegetable variety
is being maintained over time rather than only what's in the current plan.

*Not in the original `docs/OUTLINE.md` — added directly to the roadmap.
Depends on Phase 12 for the mark-eaten trigger point; reuses Phase 4's
Worker+KV relay pattern and existing nutrient-tag data, so it's a new log
endpoint and a write-on-eat call, not new scoring logic.*
