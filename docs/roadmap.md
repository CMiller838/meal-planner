# Roadmap

Active roadmap. Superseded versions live in `.claude/archive/` — this file is
updated in place, never forked into a versioned copy.

Source of scope: `docs/OUTLINE.md`'s "Meal Planner — v5 Outline" must-haves.
**Unlike v4, there is no matching `docs/ARCHITECTURE.md` section yet** — v4 was
sequenced against "v4 — guided planning ("Plan with me") + ranking read
access", but ARCHITECTURE.md has no v5 section, so the phase sequencing below
is **provisional pending an architecture pass** and may be re-cut once the
file/endpoint plan is written. v5's nice-to-haves (Hermes weekly "use these
up" list, live cost-progress in the walkthrough, near-expiry pantry nudges)
are explicitly not sequenced here, same convention as v4.

Previous roadmap (Phases 1-15, all shipped) archived at
`.claude/archive/roadmap_20260906.md`. Previous roadmap (Phases 16-21, all
shipped) archived at `.claude/archive/roadmap_20260913.md`. Previous roadmap
(Phases 22-26, all shipped) archived at
`.claude/archive/roadmap_20260920.md`.

---

# v5 — cost steering, substitutions and real quantities (Phases 27-31)

Three kinds of work again, and they are not interchangeable:

- **Generator logic:** Phase 27 (budget soft-preference), Phase 28
  (substitution groups) — both land in `rankSlot`'s layer 4, the existing cost
  step.
- **UI:** Phase 29 (staged render of the app's own generation).
- **Hermes / Worker + data:** Phase 30 (quantity ingestion), Phase 31
  (remainder tracking).

The only hard ordering dependency in v5 is 30 → 31: a part-used pack can't be
tracked until `meals.json` carries real quantities, and per the outline's
Constraints that data arrives via Hermes reading shopping screenshots, not a
manual bulk data-entry pass. Everything else is sequenced by simplicity and
value, not by necessity. 27 → 28 is a soft ordering (both re-tune the same
layer-4 overlap machinery); 29 depends on nothing and is placed third only so
its render path isn't re-tested against two generator changes.

Unchanged from v4 and not up for renegotiation in any phase below: cost,
chips, busy-day effort, pantry variants and now substitutions are all
**reorderings of what `MP.Nutrition.rankByGap` already produced** — none of
them re-score nutrition, and none of them can filter a meal out of the pool,
so a plan can never fail to generate.

## Phase 27 — Budget soft-preference (shipped)

**Goal:** A user-set target cost (per plan or per week) that turns up how
hard `generator.js`'s existing `budget` step (layer 4, `generator.js:121-140`)
leans cheap — widening/weighting the `shortlistSize` shortlist it already
picks from. New knobs are data in `pack-sizes.json`'s `planning` block
(alongside today's `shortlistSize: 4` / `reuseCredit: 0.60`), plus the control
to set the target and persist it with the other plan preferences.

*First, because it is the smallest must-have with no dependencies and the most
immediate payoff — it adds no new file, no new endpoint and no new concept,
just a dial on machinery that has shipped since Phase 17. Strictly a
soft-preference: no hard cap, and because the step only reorders among
candidates `rankByGap` already ranked top, a budget target can never reorder
nutrition nor make a plan fail to fill.*

**Resolved:** adaptive pro-rata pressure (1B), not a static dial — `place()`
accumulates spend per half as it fills the plan, and `pickMeal` feeds a 0..1
"how far over pace" figure into `rankSlot`, which widens the cost shortlist
(never re-scores nutrition, never filters). Per-week/per-half (2A), reusing
the day-1/day-8 partition `halfKeys` already maintains — a week-1 blowout
never biases week 2. Stored as `mp_planPrefs.budgetTarget` (3A), a plain
£/week number where `0` means no target, same settings-not-plan-state class as
`busyDays`/`chips`.

## Phase 28 — Generic ingredient-substitution groups — Shipped

**Goal:** A data file of swappable ingredient groups (e.g. onion/pepper as
"aromatic veg"), letting the generator substitute an equivalent ingredient
into one slot's recipe when another slot already requires a group-mate — so
one pack covers two dinners. Swaps are restricted to the file's defined groups
(never free-form) and must still pass the hard content exclusions after
substitution.

*After 27 because the payoff is measured through the very same layer-4
machinery 27 re-tunes — the `budget` step's per-ingredient overlap credit is
exactly what a consolidating substitution is trying to earn, so building this
against a shortlist about to be re-weighted means scoring it twice. Soft
ordering only: cheap to swap with 27 if the substitution work is the more
appealing build. Note for the spec: a narrow `substitutions.json` already
exists (exclusion swap-ins keyed by excluded substring, read by `mealdb.js`
and `worker/worker.js`) — the spec must decide extend-vs-new-file rather than
assume a greenfield data file, and whichever wins, exclusions are enforced
after the swap, never bypassed by it. `shopping-list.js`'s `normalizeKey`
ponytail note already names an alias map as its upgrade path; that is adjacent
to this table and worth checking for overlap before inventing two.*

**Resolved:** new `substitution-groups.json` (D1) — kept separate from
`substitutions.json`'s exclusion swap-ins so `mealdb.js`/`worker/worker.js`
get a zero-line diff. A swap is materialised on the plan slot as `slot.subs`
(D2), resolved through `MP.effectiveMeal`/`MP.applySubs` so the shopping list,
pantry deduction, shelf-life pass and detail sheet all see it. Scored in
`generator.js`'s existing layer-4 `budget` step via a new `subCredit`
(`pack-sizes.json`), kept below `reuseCredit` so an exact overlap always
outranks a swap. Seed data ships one real group from the current library
(`onion`/`peppers`) rather than invented pairings that don't hold up
ingredient-for-ingredient.

## Phase 29 — Live-build-watching (staged local generation render)

**Goal:** When a Hermes-raised plan request is accepted from the existing
banner, render the plan filling in slot-by-slot as the local `generatePlan`
loop produces picks, instead of snapping straight to a finished grid.

*Decided at the roadmap gate (Gate 1, Path A — answered directly by the user):
what gets watched is **the app's own generation**, not remote activity. Hermes
never generates a plan — `PUT /planFlag` only raises the banner and `plan.js`
runs `generatePlan()` locally — so a staged local render is the only mechanism
that can be genuinely per-pick, and it needs no endpoint, no polling and no
new infrastructure. The rejected alternative was polling `GET /placements`
while a "building" view is open; it was rejected because KV's ~60s eventual
consistency makes that chunky rather than live, and because it spends network
on watching a queue the app already pulls on `visibilitychange`. Worker push
(SSE / Durable Objects) was never in scope: a new stateful Cloudflare
primitive to watch a browser-side loop. Depends on nothing; placed third only
so the render path isn't re-verified against two generator changes. No new
write path — v4's rule that every Hermes plan write goes through
`/placements` propose-then-app-applies is unchanged.*

## Phase 30 — Hermes quantity ingestion (screenshot → structured quantities)

**Goal:** The data path that gives `meals.json` ingredients and pantry items
real quantities: Hermes reads user-sent shopping screenshots and writes
structured quantity updates through the existing Worker+KV relay pattern
(fetch-then-write, shape-validated only, same shape as `/pantry` / `/library`),
plus whatever quantity shape the app agrees to accept.

*Split from Phase 31 at the roadmap gate (Gate 2, Path B — answered directly
by the user) because the quantity **data shape** is the one genuinely unknown
thing in v5, and speccing remainder arithmetic on a shape that hasn't survived
contact with a real screenshot is the classic rework trap. Ships no visible
user feature on its own — that is the accepted cost of landing the shape
first. Explicitly not Asda scraping or any unofficial API: the outline
re-confirms that non-goal, and `docs/FUTURE.md` keeps a live/official grocer
feed parked pending a real partner/affiliate API.*

## Phase 31 — Partial-ingredient leftover tracking

**Goal:** Pantry items carry a real quantity rather than present/absent, so a
recipe using half a pack leaves a trackable remainder the next day's plan can
draw on. Touches the pantry read path (`shopping-list.js`'s `pantryIndex` /
`pantryOverlap` / `eatPlan`, and `generator.js`'s `pickVariant`) and the single
pantry write path (`plan.js`'s `commitCook`).

*Last, and the only phase in v5 with a hard prerequisite — it cannot work
before Phase 30 lands real quantities. Two existing ponytail notes already
mark this exact ground and should be read as the spec's starting point:
`shopping-list.js:20-23` ("the fix for imprecise totals is filling in
meals.json quantities, not a smarter parser") and `generator.js:148` ("no
plan-wide pantry depletion — two meals may both count the last tin as in
stock"). This is an upgrade of the existing free-text `qty` field, not a new
one. Per the outline's Constraints this is a deliberate, scoped relaxation of
the "category-based shelf-life, no per-SKU tracking" invariant — **quantities,
not purchase dates**, and category-based shelf-life stays the default for any
item without a tracked quantity. `commitCook` must remain the only pantry
writer; `eatPortion` must still never touch anything pantry-related.*

---
