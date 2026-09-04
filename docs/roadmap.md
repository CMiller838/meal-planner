# Roadmap

Active roadmap. Superseded versions live in `.claude/archive/` — this file is
updated in place, never forked into a versioned copy.

Source of scope: `docs/OUTLINE.md` (Phase 2 must-haves) against the stack in
`docs/ARCHITECTURE.md`. Parked ideas in `docs/FUTURE.md` are explicitly not
sequenced here.

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
