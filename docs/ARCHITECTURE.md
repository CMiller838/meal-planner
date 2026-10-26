# Architecture

## Stack

- **App (unchanged from Phase 1)**: static site, vanilla JS/CSS, no
  framework, no build step, no backend. Deployed to GitHub Pages. State in
  browser `localStorage`. PWA via `manifest.json` + `sw.js`.
- **Hermes bridge (new, Phase 4)**: a single **Cloudflare Worker** backed by
  **Workers KV**, deployed with Wrangler from a `worker/` directory in this
  same repo. Secret-token-gated. This is the *only* backend in the project —
  it exists solely to sync the liked-meal library and a couple of small
  flags between the app and Hermes (the hosted agent at
  hermes-agent.nousresearch.com), and is not a general API.

## Why Worker + KV (not a DB, not a PC-hosted service)

- Must run for free, 24/7, independent of whether Cody's PC/browser is open
  → rules out anything self-hosted. Cloudflare's free tier covers both
  compute (Workers) and storage (KV) at this traffic (one user, low
  frequency) with no cost.
- The data being synced is one small JSON blob (the library) plus two tiny
  flags — no relational structure, no querying beyond "read the whole
  thing" → KV's key/value model is a better fit than provisioning a real
  database for this.
- KV is eventually consistent (edge propagation, ~60s worst case globally).
  Acceptable here: writes come from a single human via chat or the app, not
  concurrent high-frequency clients. Do not build anything on this bridge
  that assumes read-after-write consistency.

**Alternatives considered**: Supabase/Postgres (rejected — relational power
not needed for one JSON blob, adds an account/service to manage); a
Worker + D1 (rejected — same reason, SQL not needed); polling a GitHub Gist
(rejected — repo is public, and Gist history would leak library data even
if the Gist itself were secret).

## Data flow

```
Hermes (hosted agent)   <---->  Cloudflare Worker  <---->  Workers KV
                                        ^
                                        |  (poll on load/focus + on local edit)
                                        v
                                    App (browser, localStorage)
```

- The app is still the only place a 2-week plan is generated or rendered.
  Hermes can *trigger* generation (via a flag) but never renders a plan as
  chat text.
- Every write to the bridge is a full overwrite of one KV value with a
  server-set `updatedAt`. There is no per-field merge logic on the Worker —
  "last-write-wins" is satisfied trivially because each key holds one JSON
  document and the most recent PUT always wins. Per-meal `updatedAt` inside
  the library array exists only so the *app* can show "changed via Hermes"
  affordances if it wants to; the Worker itself doesn't need to understand
  it.
- Exclusion rules (mushrooms, standalone egg, veg-in-toasties) and the
  nutrient-tag data must give identical answers in both runtimes. Rather
  than reimplementing them in the Worker, `worker/` imports the same
  `ingredient-nutrient-tags.json`, `shelf-life.json`, and exclusion-rule
  module the app uses (Wrangler bundles local files at deploy time) —
  single source of truth, no drift between app-side and Hermes-side
  filtering.

## KV schema

Nine keys, all plain JSON values, no versioning scheme beyond `updatedAt`:

- `library` → `{ updatedAt: <ISO8601>, meals: [ ...same shape as meals.json items... ] }`
  Both the app and Hermes read this on load/poll and PUT the full array
  back on any change (add/remove/edit a meal, edit ingredients). A meal may
  carry an optional `variants: [{id, name, ingredients, instructions?,
  servings?, prepEffort?}]` (Phase 14) — a linked variation of the same
  recipe, still one `meal.id`. See "Meal variants" below.
- `planFlag` → `{ requestedAt: <ISO8601>, ackedAt: <ISO8601|null> }`
  Hermes PUTs a new `requestedAt` to ask for a plan; the app polls, and
  when `requestedAt > ackedAt` it runs the existing local generator and
  PUTs back `ackedAt = requestedAt`.
- `activity` → `{ entries: Entry[] }`, newest first, capped at 200 (Phase 48). Entry `{ id, at, who: "assistant"|"app", key, why, summary, changes: [{id, before, after}], undoes? }`; written only by the Worker for `ASSISTANT_TOKEN` writes and undos, append-only.
- `planDraft` → `{ id, at, pending, ackedId?, startDate, changes: [{day, slot, before, after}] }` (Phase 49). Written by `POST /plan/apply` (pending) and acked by the app's `PUT /planDraft {pending:false, ackedId}` (Hermes token only); the Worker never writes the `plan` mirror. `id` is a hash of `changes`, so re-applying is a no-op.
- `pantry` → `{ updatedAt: <ISO8601>, items: [{name, qty?}] }` — what food is
  on hand, read by the shopping list (Phase 11) and deducted from by the eat
  flow (Phase 12). `qty` (Phase 30) is a free-text string **or** a structured
  `{ value, unit, raw }` object — when structured, all three fields are
  required (`value` finite non-negative, `unit`/`raw` non-empty). `raw` is
  what a Hermes-read shopping screenshot literally said; `unit` is not
  enum-checked. `MP.ShoppingList.parseQty` is the only reader of the
  structure, `MP.qtyText` (`data.js`) the only reader of its display text. A
  cook deduction (Phase 31) produces a structured remainder via
  `MP.ShoppingList.remainingQty` — the pantry is a running balance across
  cooks, though `raw` provenance is still lost at that point (`raw` becomes
  freshly formatted display text, not the original pack wording).
- `shopping` (Phase 55) → `{ updatedAt, lines: [{id, state, updatedAt, source?, label?, qty?}] }`; `adhoc` is read once to
  migrate, then superseded (the `/adhoc` shim writes `shopping`).
- `adhoc` (legacy) → `{ updatedAt: <ISO8601>, items: [{name, qty?}] }` — the same
  shape as `pantry` (including the string-or-structured `qty`), but for a
  scratch "ran out of / want to buy this week" list, separate from the
  two-week planned shop (Phase 12).
- `plan` (Phase 13) → `{ updatedAt, startDate, days: [{day, slots: {<slotType>:
  {mealId, eatenAt, variantId?, subs?}}}] }`. **The plan of record is still
  `mp_plan` in localStorage** — this key is a derived, best-effort, app-written
  mirror (`mealId`/`eatenAt`/optional `variantId`/optional `subs`, no name or
  recipe data) that exists so Hermes can see what's already scheduled before
  proposing a placement. It is stale by construction (pushed on save, not
  read-after-write) and **the app never reads it back** — if the mirror and
  `mp_plan` ever disagree, `mp_plan` wins. `variantId` (Phase 14) is present
  only when the slot has one, never written as `null`; `subs` (Phase 28,
  `[{from, to, label}]`) likewise only when a swap applies.
- `placements` (Phase 13) → `{ updatedAt, placements: [{id, day, slot,
  mealId, mealName, variantId?, requestedAt}] }`. Hermes-owned request queue,
  replaced wholesale on each PUT; the app drains it, applies each entry
  against its local `mp_plan` (never the mirror), and acks by `requestedAt`.
  An optional `variantId` (Phase 14) that isn't valid for that meal is
  dropped rather than rejecting the whole placement — it applies against the
  base recipe.
- `prefs` (Phase 13) → `{ updatedAt, prefs: {<mealId>: {name, liked,
  dismissed, eaten, lastAt}} }`. App-owned like/dismiss/eaten counters,
  mirrored from local `mp_prefs` for Hermes to read; also feeds the app's
  own Discover taste ranking.
- `eatenLog` (Phase 15, route `/eaten-log`) → a **bare JSON array** (not an
  `{updatedAt, ...}` object — nothing acks or merges this key) of
  `{id, mealId, name, eatenAt, tags}`, newest last, capped at 200 entries
  (oldest dropped on append). Client-owned, capped, write-only mirror of
  local `mp_eatenLog`: the app never reads this key back, and there is no
  server-side append (whole-array PUT, same relay pattern as `pantry`).
  `tags` are nutrient names resolved by `tagsForMeal` and **frozen at eat
  time** — re-tagging an ingredient later doesn't rewrite past entries.
- `planPrefs` (v4) → `{ updatedAt, busyDays: [<1..14>], chips: [<chipId>] }` —
  the last-used "Plan with me" settings, mirrored from local `mp_planPrefs`.
  Two-way (both sides read and PUT), last-write-wins by `updatedAt` via the
  existing `MP.Sync.decide`. See v4 below.

- `mp_cooks` (Phase 20, localStorage only) → a **bare JSON array** of
  `{id, mealId, name, variantId, cookedAt, portionsLeft}` — open leftover
  portions from a multi-serving cook. **Local-only: no KV key, no Worker
  route, no Hermes mirror.** Pruned on read (`MP.Cooks.all()`) by
  `portionsLeft <= 0` and `shelf-life.json`'s `cooked_leftovers.fridgeDays`.

Writes to `pantry`, `adhoc`, `plan` and `prefs` are **local-first**: the app
updates its localStorage mirror synchronously and renders from it, then
either replays a pending-op log (`pantry`/`adhoc`) or does a best-effort,
failure-silent push (`plan`/`prefs`) in the background. This keeps the app
fully usable with the bridge unreachable — sync is never on the critical
path. `planPrefs` (v4) follows the `prefs` pattern with one difference: it is
also *pulled* (Hermes may write it), on open of the Plan-with-me screen only.

- `products` (Phase 33a) -> `{ updatedAt, products: Product[] }`, mirrored in localStorage `mp_products`, merged per record
  (`MP.Products.merge`, newer `updatedAt` wins). Reference data, see "v6 - product records" below.

## Worker endpoints

The authoritative route list is `export const ROUTES` in `worker/worker.js` (generated to `worker/routes.json`, probed by `tools/worker_test.mjs`; contract in `docs/HERMES.md`). The list below is older prose.

- `GET /library`, `PUT /library`
- `GET /planFlag`, `PUT /planFlag`
- `GET /pantry`, `PUT /pantry`
- `GET /adhoc`, `PUT /adhoc` (shim over `shopping`), `GET /shopping/lines`, `POST /shopping/lines`
- `GET /plan`, `PUT /plan`
- `GET /placements`, `PUT /placements`
- `GET /prefs`, `PUT /prefs`
- `GET /eaten-log`, `PUT /eaten-log`
- `GET /planPrefs`, `PUT /planPrefs` (v4)
- `GET /dayHints`, `PUT /dayHints` (Phase 37; assistant-written `{ updatedAt, days: { ISO date: { effort, why } } }`, read-only in the app)
- `GET /meal/:id/method`, `PUT /meal-method` (Phase 40; meal `method: [{text, minutes?}]` + `methodStatus`; the assistant's PUT forces `drafted`, 409 on an accepted meal; confirm-cook is the existing `PUT /eat-requests`, no new route)
- `GET /ratings`, `PUT /meal/:id/rating`, `GET /why` (Phase 51; KV `ratings` = `{ meals: { id: { rating, note, never, at } } }`, written only through the per-meal route, both tokens; `/why` reasons share `slotContext` with `/ranking`)
- `POST /drafts`, `GET /drafts`, `DELETE /drafts/:id` (Phase 50; KV `drafts` = `{ updatedAt, drafts: Draft[] }`, newest first, max 20; both tokens; no PUT. Ingredients matched on POST via `snapKey`; hard exclusions 422. Accept is app-side: `upsertMeal` + `DELETE`, meal carries `fromDraft`)
- `GET /settings`, `PUT /settings` (Phase 52; KV `settings` = `{ updatedAt, targets, budgetTarget, allergies, dislikes, likes, never }`, written only by the PUT through `normalizeSettings`, both tokens; GET answers `{}` when absent)
- `GET /products`, `PUT /products` (Phase 33a; whole-key product reference records, shape-checked by `productsError`)
- `GET /activity`, `POST /activity/undo` (Phase 48; body `{id, force?}`, 409 `already undone` / `changed since` / validator reason; `?dryRun=1` on any logged PUT previews the diff; optional `X-Reason` header)
- `POST /plan/draft` (body `{days?, keep?, avoid?, budget?}` -> `{draft, plan}`, stores nothing; runs `Generator.generatePlan` unchanged, then merges over the plan mirror: eaten/kept/out-of-`days` slots are copied), `POST /plan/apply` (body `{draft}` -> `{id, status: pending|already pending|already applied}`, logged in `activity`), `GET /planDraft` (assistant), `PUT /planDraft` (app/Hermes only) (Phase 49), `POST /plan/reflow` (body `{skipped?, eatingOut?, ranOut?}` -> `{draft, plan}`, parks a `reflow: true` draft; `MP.reflowPlan` in `data.js` is the one implementation, app button and Worker both call it) (Phase 63)
- `GET /ranking` (v4, read-only — no PUT, deliberately)
- All requests require `X-Auth-Token: <secret>`, checked against a Wrangler
  secret binding (`wrangler secret put AUTH_TOKEN`) — never committed to
  the repo (public repo, no personal data or secrets in git history).

## Non-obvious invariants

- Phase 1's "no backend" rule is relaxed **only** for this Worker. Nothing
  else in the app may add a server dependency without confirming with the
  user first — this now includes the Worker's own scope: don't grow it
  into a general API.
- The Worker never stores anything beyond `library`, `planFlag`, `pantry`,
  `adhoc`, `plan`, `placements`, `prefs`, `eatenLog`, and `planPrefs`. Apart
  from `/ranking` (v4, computed read-only from keys it already holds) it does
  not compute nutrition, shelf-life, or plans — it's a sync relay, and the
  actual logic stays in the shared JS modules it imports from the app.
- The `plan` mirror is one-way: written by the app, read by Hermes, never
  read back by the app. `mp_plan` in localStorage is always the plan of
  record; adding a mirror→app read path would defeat the reason the mirror
  is safe to have at all.
- KV is eventually consistent — don't add a feature that reads-after-write
  and assumes immediacy.
- Nutrition targets are fixed (no training/rest-day flexing) — Hermes must
  not be given a way to alter `nutrition-targets.json` values at runtime.
- **Meal variants (Phase 14): a variant family is one `meal.id`.** A meal's
  optional `variants` array holds linked recipe variations (a different sauce
  or side); there is no separate `variantOf`/grouping id and variants are
  never separate library rows. Because a family is one id, the generator's
  variety guard, Browse search (`filterMeals`) and Discover's dedupe
  (`excludeIds()`) already treat a family as one meal and are **deliberately
  variant-blind** — they must not be made variant-aware. `MP.effectiveMeal
  (meal, variantId)` is the one chokepoint that resolves a slot's ingredients/
  instructions; every consumer of a planned meal's recipe (shopping list,
  nutrition, shelf-life, plan rendering) goes through it rather than adding
  its own variant branch.
- **Cost-weighted generation (Phase 17), local-only, no Hermes involvement.**
  `pack-sizes.json` gained `categories` (~8 aisle fallbacks, `default`
  terminal), `keywords` (substring → category, longest match wins), and
  `planning: {shortlistSize, reuseCredit}`. `shopping-list.js` exports
  `priceFor`/`mealCost`/`costIndex` — `costIndex(library, packData)` is the
  only thing `generator.js` ever sees of pricing, as a plain
  `{[mealId]: {cost, keys}}` map — `plan.js`, which loads both, builds the
  `costIndex` and passes it into `generatePlan(..., budget)` as an optional
  6th argument. Cost only ever reorders *within* the nutrient-ranked
  shortlist `pickMeal` already produces — it never changes that ranking.
- **Per-meal cost badges (Phase 18), rendering only, no new pricing maths.**
  `pack-sizes.json` gained `costTiers: {cheap, med}` (hand-tuned thresholds,
  both bounds inclusive). `shopping-list.js` exports `costTier(total,
  packData)` and `costBadgeHtml(meal, packData)` — both live there rather than
  in `app.js`/`discover.js` so the render helper isn't duplicated a third
  time. `costBadgeHtml` calls `mealCost` on the **base** meal (matching Phase
  17) and interpolates only numbers and the fixed tier/estimated words, never
  meal data, into the `<span>` it returns. `app.js`'s `tagRowHtml` and
  `discover.js`'s card renderers prepend it to the existing `.tag-row`;
  `discover.js` fetches its own `packData` via `MP.ShoppingList.load()` since
  `app.js`'s module-level `packData` isn't shared across pages.
- **Pantry-driven variant selection (Phase 21).** `pantryOverlap` moved from
  `discover.js` to `shopping-list.js` (beside `normalizeKey`/`pantryIndex`) and
  is exported from `MP.ShoppingList`; Discover's `orderPool` now calls the
  exported version rather than a local copy. `generator.js` gained
  `pickVariant(meal, have)`, called only from `place()`, and `generatePlan`
  gained an optional trailing `have` argument (a pantry key index) — `plan.js`
  builds it synchronously from `MP.ShoppingList.pantryIndex({ items:
  MP.Sync.localItems("pantry") })` and passes it through. This is a second
  pantry **reader**; `plan.js`'s `commitCook` remains the only pantry writer.
  As of Phase 31, `pantryOverlap` is quantity-aware — "in sufficient
  quantity", not just "present" — so `pickVariant` now prefers a variant
  whose ingredients are fully stocked over one that's merely present but
  short. Still a reader-only path; `generator.js` itself is unchanged.

## v4 — guided planning ("Plan with me") + ranking read access

Scope: an *optional* pre-plan screen (busy days + preference chips), a
dinner-only choice walkthrough, a review step, and read-only Hermes access to
the generator's ranking. One-tap "Generate Plan" stays exactly as it is — the
guided flow is a second entry point, never a replacement.

### Files

- **New**: `plan-with-me.html` + `plan-with-me.js` (setup screen only),
  `plan-preferences.json` (chip vocabulary + busy-day knobs).
- **Changed**: `generator.js` (ranking export + busy/chip layers), `plan.js`
  (walkthrough + review mode, passes prefs into `generatePlan`), `plan.html`
  (one extra entry button beside `#generate-btn`), `hermes-sync.js`
  (`planPrefs` pull/push), `nutrition.js` + `generator.js` (`window` →
  `root` shim so the Worker can import them, same line exclusions.js
  already has), `worker/worker.js` (`/planPrefs`, `/ranking`), `sw.js`
  (shell list + cache bump), `style.css` (busy-grid cells, chip row).
- **Deliberately unchanged**: `app.js`, `discover.js`, `shopping*.js`,
  `prefs.js`, `data.js`'s library layer.

### Screen split (why only one new page)

Project convention is one HTML file per page, but the guided flow is three
steps and only the first is new UI:

1. **Setup** → `plan-with-me.html`: a compact 7×2 `.busy-grid` of 14
   tap-toggle buttons (the plan grid's *shape*, not its markup — `.day-row`
   is a rotated card with nested slot cards) + chip row. Prefilled from
   `mp_planPrefs`. "Generate" writes `mp_planPrefs` and navigates to
   `plan.html?guided=1`. From Phase 23, `plan.js` reads `mp_planPrefs` on
   **both** entry points — one-tap Generate is preference-aware too, never
   replaced — and `MP.PlanPrefs` (defined in `plan-with-me.js`, loaded on
   both pages) is the key's only reader/writer.
2. **Dinner choice (3 cards × ~14 slots)** → **reuses the existing swap
   picker on plan.html**: `#swap-overlay`/`#swap-sheet` +
   `renderSwapCards()`'s `.swipe-deck` already renders exactly "top 3 ranked
   candidates, swipe right to accept". The walkthrough in `plan.js` is a
   loop that opens it per dinner slot with generator-ranked candidates
   instead of `candidatesFor()`'s, then advances.
3. **Review** → **the existing plan grid on plan.html**, plus the existing
   per-slot `.day-swap-btn` → `openSwapPicker()` affordance, with a
   "Looks good" commit button while `guided=1`.

Steps 2 and 3 add **no new component** — building a second page for them
would mean duplicating `renderPlan`, the swipe deck and the detail sheet.
The cost is a small step-through state machine in `plan.js`.

### `plan-preferences.json`

Data, not JS constants — same rule as `ingredient-nutrient-tags.json` /
`pack-sizes.json`:

Shipped shape (Phase 22) — criteria are **flat** on the chip, not nested
under a `match` object:

```json
{
  "busy": { "preferEffort": "quick", "demoteEffort": "batch" },
  "chips": [
    { "id": "comfort", "label": "Comfort food", "kind": "prefer",
      "keywords": ["pasta", "pie", "stew"], "prepEffort": "batch" },
    { "id": "light", "label": "Lighter week", "kind": "prefer",
      "tags": ["fibre_g", "vitC_mg"] },
    { "id": "no-spice", "label": "Less spice", "kind": "avoid",
      "keywords": ["chilli", "curry"] }
  ]
}
```

- `kind` is only `prefer` | `avoid`. The criteria are any of `keywords`
  (lowercase substring over meal name + ingredient keys), `tags` (suffixed
  nutrient keys from `nutrition-targets.json` — `fibre_g`, `vitC_mg`, not
  bare `fibre`), `prepEffort` (a single string, matched exactly against
  `effortOf(meal)`). A chip hits if ANY listed criterion matches.
- `busy.demoteEffort` is a single string, and there is no `leftoverBias` key —
  the leftover/run preference is run-selection logic in `generatePlan`, not
  data (Phase 22 §4.4).
- Phase 23's chip UI reads `id`, `label` and `kind` only, so the criteria
  shape can change without touching `plan-with-me.js`.
- Chips are a **reorder**, never a filter: an `avoid` match goes to the tail
  of the already-ranked list, not out of the pool — same
  "pool-too-small → fall back" behaviour `pickMeal`'s `excludeIds` already
  has, so a plan can never fail to fill because of a chip.
- Unknown chip ids (e.g. from a stale Hermes write) are ignored silently.

### Generator changes

`generatePlan(library, tags, targets, shelfData, startDate, budget, have,
prefs)` — `prefs` is `{ busyDays: [1..14], chips: [id], vocab }`, one more
optional trailing arg, same as Phases 17/21.

`pickMeal` is split into `rankSlot(...) → ranked[]` and
`pickMeal = rankSlot(...)[0]`. `rankSlot` is exported on `MP.Generator` and
is the **single ranking source** for all three consumers: the in-app
walkthrough, the review swap picker, and the Worker's `/ranking`.

Layer order inside `rankSlot` (each step only reorders the output of the one
above — nutrition is never re-scored):

1. `MP.Nutrition.rankByGap` — nutrient-gap ranking. **Unchanged, authoritative.**
2. Chips — `prefer` matches to the head, `avoid` matches to the tail (stable).
3. Effort/busy — existing `opts.prefer`, plus on a busy day
   `busy.preferEffort` is forced and `busy.demoteEffort` entries sink to the
   tail.
4. Budget shortlist (Phase 17) — unchanged, now operating on the reordered list.
5. `pickVariant` (Phase 21) at `place()` — unchanged.

Busy days also touch **run selection**, not ranking: in the existing batch/
leftover-run loop a busy day is not chosen as the cook day (`d0`) when a
non-busy day in the run can be, and runs whose leftover days land on busy
days are preferred. This uses the existing batch-cook/leftover primitive —
no new data model, no `prepEffort` values added.

### Hermes: `GET /planPrefs` / `PUT /planPrefs`

Generic two-key relay, same style as `/pantry`. Body `{ updatedAt, busyDays,
chips }`; shape-validated only — `busyDays` an array of integers 1–14 (unique),
`chips` an array of non-empty strings; both may be `[]`. Chip ids are *not*
validated against `plan-preferences.json` (the generator ignores unknowns) so
a vocabulary edit can never lock out a write, same reasoning as `/library`'s
no-dietary-rules rule.

"Trigger the interactive flow" needs **no new endpoint**: Hermes PUTs
`/planPrefs`, then the existing `PUT /planFlag`. The app's existing
plan-request banner gains a second button that opens `plan-with-me.html`
prefilled from the pulled `planPrefs` instead of generating immediately.

Implementation (Phase 25, shipped): the pull entry point is
`MP.Sync.fetchPlanPrefs()`, called from `plan-with-me.js`'s prefill; the push
is `MP.Sync.pushPlanPrefs()`, fired un-awaited from `#pwm-generate-btn` after
`MP.PlanPrefs.save(...)`. The banner's new "Plan with me" button acks
`planFlag` on click (D1), same moment as Dismiss — so `ackedAt` means "the
user responded", not "a plan exists", for both buttons alike.

### Hermes: `GET /ranking`

One read-only endpoint covering both "why was X picked" and "give me the top
N" — they're the same computation, so they're one route.

`GET /ranking?day=<1..14>&slot=dinner&n=<1..10>` (`slot` defaults `dinner`,
`n` defaults 3). `200`:

```json
{ "day": 5, "slot": "dinner", "shortOn": ["fibre", "vitD"],
  "current": { "mealId": "chorizo-pasta", "variantId": null },
  "candidates": [ { "mealId": "...", "name": "...", "rank": 1,
                    "covers": ["fibre"], "prepEffort": "quick",
                    "chipHits": ["comfort"] } ],
  "busyDay": true, "approximate": true }
```

- Computed server-side by importing the app's own `nutrition.js` +
  `generator.js` (`rankSlot`) and bundled `ingredient-nutrient-tags.json` /
  `nutrition-targets.json` / `plan-preferences.json`, over the `library`,
  `plan` and `planPrefs` KV values — no new state, no writes.
- `400` on a bad `day`/`slot`/`n`; `409` if `library` or `plan` is missing.
- `current` comes from the **stale-by-construction** `plan` mirror, so the
  whole response is advisory: `approximate: true` is always set and also
  flags that steps 4–5 (cost shortlist, pantry variant) are **not** applied
  server-side — the Worker doesn't carry `pack-sizes.json` pricing or build
  a pantry index. Hermes must phrase answers as "it's ranking these highest",
  never as "this is what the app will pick".
- **No `PUT /ranking`, ever.** Hermes acts on a ranking only through the
  existing `PUT /placements` queue, which the app still re-checks against
  local `mp_plan`. v4 adds no write path.
- `MP.Generator`'s export list gained `chipHits` and `activeChips` (Phase
  26) so the Worker can annotate each candidate's `chipHits` without a
  second copy of the chip-matching rule. `nutrition.js` and `generator.js`
  also picked up the `window` → `root` shim `exclusions.js` already used
  (`(function (root) { const MP = (root.MP = root.MP || {}); … })(typeof
  globalThis !== "undefined" ? globalThis : this);`), which is what lets
  `worker/worker.js` import them directly — no behaviour change in the
  browser, where `globalThis === window`.
- The Worker mirrors `plan.js`'s `candidatesFor` for the `rankSlot`
  arguments (day's other slots, no `prefer`/`budget`/`halfKeys`/
  `lastUsedDay`) but, unlike `candidatesFor`, **keeps the current meal in
  the pool** — `/ranking` answers "why was X picked", so X needs its own
  `rank` alongside the `current` field.

### v4 invariants

- **`rankSlot` is the one ranking implementation.** If a fourth consumer
  appears it calls `rankSlot` — don't copy the layer order. `plan.js`'s
  `candidatesFor` is folded into it rather than kept as a parallel ranking.
- **Busy days and chips are layers 2–3, never layer 1.** They reorder what
  `rankByGap` produced; anything that changes nutrient scoring itself is out
  of scope for this feature (same rule as cost in Phase 17 and pantry in
  Phase 21).
- **The guided flow is optional and stateless on exit.** Abandoning it
  leaves `mp_plan` untouched; only the final commit writes a plan, through
  the same save path as one-tap generate (so `mp:plan-saved` → `pushPlan`
  still fires exactly once).
- **`mp_planPrefs` is settings, not plan state.** It never contains meal
  ids, and losing it degrades to "no busy days, no chips, no budget target" —
  i.e. today's behaviour. Phase 27 extends its shape to
  `{ updatedAt, busyDays, chips, budgetTarget }`; `budgetTarget` is a plain
  £/week number, `0` meaning no target.
- **Budget soft-preference (Phase 27), local-only.** `pack-sizes.json`'s
  `planning` block gained `budgetTarget: {max, step, default, maxShortlist}`
  (slider config, £/week) alongside Phase 17's `shortlistSize`/`reuseCredit`.
  `generator.js`'s `generatePlan` accumulates spend per half (`place()`) and
  turns it into a 0..1 pro-rata "pressure" (`pressureFor`) that widens layer
  4's shortlist (`shortlistSizeFor`) — never re-scores nutrition, never caps,
  never leaks between halves. `plan.js` needed no change: it already spreads
  `packData.planning` into `budget` and already assembles `prefs` from
  `MP.PlanPrefs.get()`.
- **Generic ingredient-substitution groups (Phase 28), local-only.** New
  `substitution-groups.json` (`{note, groups: [{id, label, members:
  [{key,label}]}]}`) is a *consolidation* concern, separate from
  `substitutions.json`'s exclusion swap-ins — `shopping-list.js`'s
  `groupIndex` flattens it to `{[normalizedKey]: {groupId, members}}`, first
  group wins on a duplicate key. `pack-sizes.json`'s `planning` gained
  `subCredit` (£-equivalent credit for one swap; kept below `reuseCredit` so
  an exact overlap always outranks a swap). `generator.js`'s layer 4
  (`subsFor`) finds at most one swap per meal that would let it reuse a key
  already bought that half, re-checks it against `MP.Exclusions.check`, and
  `place()` materialises it as `slot.subs: [{from, to, label}]` — written
  only when non-empty, so a plan with no swaps is byte-identical to
  pre-Phase-28 output. `data.js`'s `MP.applySubs`/`MP.subsLabel` and a third
  `subs` argument on `MP.effectiveMeal` (applied *after* the variant merge)
  are the single chokepoint every `variantId` reader already used — shopping
  list, pantry deduction, shelf-life, plan rendering — so no consumer grew a
  second substitution branch. Leftover days and remote (Hermes) placements
  never carry `subs`: a leftover slot reuses its parent's recipe verbatim,
  and a remote placement is a meal choice, not a recipe edit.
- **Staged local generation render (Phase 29), render-side only.** `plan.js`'s
  `renderPlan` gained an optional `staged` argument (default falsy); when
  true it adds `#plan-root.staging` and a per-`.slot-card` `animationDelay`
  (document order, 30ms/card, capped 1800ms) driving a CSS `@keyframes` fade
  in `style.css`. `regenerate(staged)` threads it through; only the
  `hermes-generate` handler passes `true`, so accepting a Hermes plan request
  is the only path where the grid fills in visibly — one-tap Generate and
  every other `renderPlan()` caller stay instant. `generator.js`'s
  `generatePlan` is untouched and still runs synchronously to completion
  before any pixel changes; the reveal is cosmetic staging of an
  already-final plan, not a live trace of the generator loop.

**Alternatives considered**: a third HTML page for the choice/review steps
(rejected — would duplicate `renderPlan` + the swipe deck); an app-pushed
"ranking mirror" KV key instead of computing in the Worker (rejected — stale,
and can't answer an arbitrary slot query); free-text preference input
(rejected in the outline — structured chips only); a new Hermes write route
for guided plans (rejected in the outline — `/placements` stays the only
write path).

## v6 - product records (Phase 33a)

A product is a **separate reference record** (brand, pack, price, per-100 g/ml nutrition with provenance per nutrient),
not a field of the pantry or the library. It is informational only: `rankByGap`'s approximate low/med/high tags stay the
generator's only nutrition input, and nothing in planning reads `products`. There are two nutrition sources on purpose:
coarse tags decide what to cook, label data answers "what is in this pack". Records come from a barcode scan
(Open Food Facts, fetched from the browser), typing the label, or the assistant writing one after reading a photo.
Storage is one KV key on the existing relay, no new route type. A pantry item shows the newest product whose
`ingredient` equals its normalised name, so the pantry shape and `commitCook`'s sole-writer role are untouched.

**CoFID fill (Phase 33b).** Vitamins/minerals come from `cofid.json`, generated by `tools/cofid_build.py` from the UK CoFID 2021 xlsx
via the hand-reviewed `tools/cofid-map.json` (ingredient key -> food code). Values are estimates (`basis: "cofid"`, shown "est.").
Contains public sector information licensed under the Open Government Licence v3.0. Source: McCance and Widdowson's The
Composition of Foods Integrated Dataset 2021.
**Derived tags (Phase 57).** `tools/cofid_derive.py apply` adds tags for mapped keys missing from `ingredient-nutrient-tags.json` (share of daily target per 100 g, thresholds in `tools/cofid-levels.json`); existing tags are never overwritten, `diff` lists disagreements.
A human picks the food code (`find`), the rule picks the levels; absent nutrient = untagged.

## v7 - activity log and undo (Phase 48)

**Fork: log in the Worker, not in the assistant.** Every assistant write already passes through the Worker, so the Worker
diffs the old and new KV value per item and appends one `activity` entry per write. The assistant cannot skip it, and
the "before" comes from live KV, not from the assistant's possibly stale copy. Only `ASSISTANT_TOKEN` writes are logged:
the app's own syncs (library push, plan mirror, eaten log) would flood a 200-entry cap within a day and push out the
entries worth undoing; the app already has its own undo toasts. Undo restores the recorded `before` per item, only when
each item still equals its recorded `after` (otherwise 409 listing what changed, with `force` to override), and is itself
an appended entry, so the log stays append-only. Spec: `.claude/specs/phase48.md`.

## v8 - profile settings (Phase 52)
Profile.md in the vault (assistant side) is the one editor; the Worker stores its normalised form in KV `settings` and the
app only reads it (`MP.Sync.fetchSettings` -> `mp_settings`). Targets merge per key over `nutrition-targets.json`
(`Nutrition.withProfile`, applied by `Nutrition.load` and the Worker's `/ranking`, `/why`, `/nutrition`). Allergies and
`never` are hard terms matched with `Exclusions.termHit` (substring of ingredient key/label): `rankSlot` filters them with
no small-pool fallback, `/discover`, `mealdb.js` and the add-meal check reject them. Likes and dislikes join `rankSlot`'s
chip prefer/avoid groups (reorder only). While `budgetTarget > 0` it overrides `mp_planPrefs.budgetTarget` at read time
(`PlanPrefs.get`) and the slider is disabled. Phase 48's `logWrite` was absent when built, so `PUT /settings` is not logged.
Spec: `.claude/specs/phase52.md`.

## v8 - day route (Phase 54)
`GET /day?date=&gym=1` (both tokens, read-only) returns the Today screen as one ordered card list (meal, routine, counter, expiring, leftover, coverage) plus `assembledAt`. It reuses `dayView` (shared with `/nutrition?date=`), `MP.dueRoutines` (moved to `data.js` so the Worker can import it; `MP.Today.dueRoutines` delegates) and `ShelfLife.expiringItems`; leftovers stay `[]` until Phase 43's `leftoverView` exists. `/today` is unchanged.

## v9 - shared shopping state (Phase 55)
One KV key `shopping` (`{ updatedAt, lines }`) holds every shopping line's state (`needed|got|skipped|deleted`, `updatedAt`,
`source`). Plan lines stay computed by `buildLists`; only their state is stored, id `p:<startDate>:<shopDay>:<key>` so ticks
survive a same-start regenerate. The ad-hoc list folded in as `x:<key>` lines (user-chosen over a separate overlay, so one
store holds every line). Writes go through `POST /shopping/lines`, merged per line by later `updatedAt` (tie keeps current,
future stamps clamped, removal is a `deleted` tombstone pruned after 30 days), so two devices ticking different lines both
survive. `GET|PUT /adhoc` are a shim over it until Phase 56; the whole-list `PUT /adhoc` keeps its lost-update risk. "Got"
never writes the pantry: the assistant's intake preview is the only path in.

## v11 - planning chat (Phase 72)
The "Plan with Hermes" chat thread lives in one SQLite-backed Durable Object, `ChatRoom` (`idFromName("plan")`, binding `CHAT`, migration `v1`), not KV: KV is eventually consistent and caches reads for up to ~60 s, which a ~1 s chat poll can't use. It holds only the current session (cap 40 messages); KV stays the store for everything else and plan state stays in `localStorage`/KV. Hermes is reached by a PC-side bridge (`tools/hermes_chat_bridge.py`) that polls the Worker, so no inbound path to the PC is needed (a Worker call out to Hermes was deferred: public endpoint, secret, rate limiting). Replies are constraints and edits only, validated by `MP.PlanChat.validateReply` in both Worker and app; the app applies them through `generatePlan(override, lockedMap(days))`, so `rankSlot` stays the one ranker. Session constraints (`chatPrefs`) are never stored.

## v12 - Hermes places meals (Phase 88)
Hermes may now choose meals: a `place` edit puts a library meal in a slot, so for those slots `rankSlot` is no longer the
picker. The safety line moves from "Hermes never returns meals" to "every placement passes the same hard checks"
(`MP.placeSlots`, `data.js`: exclusions, allergies, `never`, slot type, held slots, leftover order); nutrition is shown
by the meter, never re-scored. The briefing is built by the app (the localStorage authority) once per session and
carried in the `ChatRoom` open message (up to 60 000 chars); the bridge re-sends it each turn and adds KV-only `spend`.
Meal create/edit/remove wait for a user confirm card; per-weekday time caps are stored in `mp_planPrefs.timeCaps`.
One-tap Generate and Plan with me stay the offline fallback, unchanged.

## v9 - standing notes (Phase 91)

`Meals/Notes.md` (vault) -> assistant -> `PUT /notes` -> KV `notes` -> app cache `mp_notes` (`MP.Sync.fetchNotes`/`notes`).
Read-only "Standing notes" list on Plan with me; `brief.notes` in the chat briefing. Hermes may suggest one with a `note`
chat edit: a card in the chat, saved only on Accept (`POST /notes/pending`), after which the assistant appends it to
`Notes.md`. Notes never enter `rankSlot`/`generatePlan`: Hermes turns them into edits it already has.
