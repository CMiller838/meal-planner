# Meal Planner — Phase 2 Outline

## Problem

Phase 1 shipped a static, browser-only meal planner (library + 2-week plan,
nutrition/shelf-life logic, TheMealDB discovery). It only works when Cody is
sitting at the app on his phone. He also runs a separate personal AI
assistant, Hermes (phone-based, conversational, backed by the hosted
hermes-agent.nousresearch.com agent), and wants to
discover, like/dislike, and tweak meals through that conversation instead of
only through the swipe UI — then have a plan generated from whatever he's
told Hermes he likes. The planner itself also has some rough edges from
real use: no shopping list, the generator can repeat meals, no way to
prioritize quick meals on busy days, and no way to find a specific meal once
the library grows.

## Users

Solo tool, one user (Cody), no sign-up, no sharing — unchanged from Phase 1.

## Must-haves

- **Hermes integration**, via a Cloudflare Worker + KV store (free tier,
  secret-token-gated, runs 24/7 independent of any PC/browser being open):
  - Two-way sync of the liked-meal library between the app and Hermes.
    Both sides can write; last-write-wins on conflicts.
  - Hermes can hold recipe *and* nutrition Q&A conversations about a meal,
    using the same `ingredient-nutrient-tags.json` / `nutrition-targets.json`
    the app already uses (approximate-coverage framing, not precise
    calorie math).
  - Hermes can add/remove/change ingredients within a meal via conversation
    — new capability, no ingredient-editing UI exists today.
  - Hermes searches TheMealDB directly for discovery, applying the same
    exclusion rules as the app (see below) — but instead of a blanket
    reject on a mushroom-containing recipe, it should offer a substituted
    version when a reasonable swap exists.
  - "Generate a new plan" via chat updates the library/settings and tells
    Cody it's ready — the actual 2-week plan is still generated and viewed
    in the app, not rendered as chat text.
  - Nutrition targets stay fixed (no training-day/rest-day flexing).
- **Shopping list generated from the 2-week plan**: aggregates ingredient
  quantities across the plan, split by shop day (day 1 / day 8, matching
  the existing shelf-life "shop day" assumption), rounded to real Asda pack
  sizes, with a rough total cost estimate using Asda prices. Needs a new
  small data file (pack sizes + approximate prices per ingredient) — no
  scraping or live API, Asda has none public; prices/pack-sizes entered and
  maintained by hand, same pattern as `shelf-life.json`.
- **Repeat/variety guard in the plan generator**: don't schedule the same
  dinner twice within a 2-week plan unless it's part of a batch-cook /
  leftover chain.
- **Prep-effort tag** (quick/weeknight vs. batch/weekend) per meal, data-
  driven like the existing nutrient tags — the generator should be able to
  favor quick meals on plan days.
- **Search/filter on the Browse & Add page** — by ingredient or meal type.

## Nice-to-haves

None carried into this phase's scope beyond the must-haves above — see
`docs/FUTURE.md` for ideas that came up but were explicitly parked instead.

## Constraints

- The whole system (app + Hermes bridge) must run for free, 24/7,
  regardless of whether Cody's PC is on — this is why the bridge is a
  Cloudflare Worker + KV (serverless, free tier) rather than anything
  hosted on a personal machine.
- Existing Phase 1 invariants still apply except where this phase
  explicitly changes them: no `innerHTML` with unescaped TheMealDB/external
  content, nutrition targets and nutrient tags stay data-driven (not inline
  constants), shelf-life stays category-based (no purchase-date tracking),
  batch-cook/leftover chains remain a planning primitve, hard content
  exclusions (mushrooms, standalone egg, veg-in-toasties) stay enforced in
  code/data, dark-mode-default.
- The Phase 1 "no backend" invariant is explicitly relaxed for the Hermes
  bridge only (a secret-gated serverless Worker+KV), not for the rest of
  the site — the app itself stays static and must still "just open and
  work" from GitHub Pages with no build step.
- Repo is public — nothing containing Cody's personal library data may be
  committed to it or to a Gist; the Worker+KV store, gated by a secret only
  Cody/Hermes hold, is the only place that data lives outside localStorage.
- Asda pack-size/price data is manually maintained (no public Asda API).

## Non-goals

- Multi-user support, accounts, or sharing.
- A live/real-time nutrition API or precise calorie tracking — the
  approximate tag-coverage system stays as-is.
- Purchase-date-based shelf-life tracking.
- iOS-specific PWA work (Android Chrome only, per Phase 1).

---

# Meal Planner — Phase 6 Outline

## Problem

Real use of the library surfaced gaps: `index.html` still carries a leftover
inline swipe-deck from before `discover.html` existed, duplicating Discover
on two tabs. There's no way to add a meal by hand (only via liking a
Discover card), no way to set or change a meal's breakfast/lunch/dinner type
after the fact, no way to fix a meal's description or recipe once it's in
the library, and no way to remove a meal you no longer want — the library
only ever grows.

## Users

Solo tool, one user (Cody) — unchanged.

## Must-haves

- **Remove the duplicate inline Discover section from `index.html`** —
  `index.html` becomes "Your Library" only (search + card grid); Discover
  stays solely on `discover.html`, nothing else about that page changes.
- **Manual "Add a meal" form** on the Library tab: name, description,
  recipe/ingredients, and meal type(s) (breakfast/lunch/dinner, multi-select
  like the existing `mealTypes` array) — a real way to add a meal without
  going through Discover. New meals still run through the existing hard
  content exclusions (mushrooms, standalone egg, veg-in-toasties) before
  they're accepted into the library. A non-blocking warning appears on the
  form if an existing library meal has a very similar name, so near-dupes
  don't pile up unnoticed — it's a nudge, not a block.
- **Edit existing library meals**: the detail modal (`openDetail` in
  `app.js`) gets an Edit button that makes description, recipe/ingredients,
  and meal type fields editable in place, plus a Save action that writes
  back through `MP.saveLibrary`/bumps the library stamp so Hermes sync picks
  it up.
- **Remove a meal from the liked library**: a Delete button in the same
  detail modal, with a confirm prompt before it removes, plus a brief
  "Undo" toast after removal (single mutation point, so undo is just
  re-adding the same record before the toast expires). Deletion bumps the
  library stamp the same way an edit does, so the existing whole-array
  last-write-wins sync (`hermes-sync.js`) naturally propagates the removal
  to Hermes on the next sync — no tombstone/new sync mechanism needed, since
  sync already replaces the whole `meals` array rather than diffing entries.
- **Meal-type filter on the Library grid**: filter chips (breakfast/lunch/
  dinner/snack, matching the existing `mealTypes` categories) above the
  library grid, alongside the existing text search — reuses the `mealTypes`
  data every meal already carries.

## Nice-to-haves

None — see `docs/FUTURE.md` for ideas raised but parked instead.

## Constraints

- Reuses the existing detail-modal pattern and `MP.*` library helpers in
  `data.js` rather than introducing new UI surfaces; existing Phase 1
  invariants (no `innerHTML` with unescaped external content, data-driven
  nutrient tags, category-based shelf-life, hard content exclusions,
  dark-mode-default) still apply unchanged.
- No new backend/API surface — edit and delete are local `mp_library`
  mutations that ride the existing Hermes Worker+KV sync as-is.

## Non-goals

- No versioning/undo history for edits or deletes — delete is a normal
  confirm-then-remove, not a recoverable trash.
- No per-field conflict resolution — edits and deletes stay under the
  existing whole-library last-write-wins model (see `docs/FUTURE.md` for the
  already-parked "no conflict UI" item, which applies here too).
