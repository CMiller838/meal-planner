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

Seven keys, all plain JSON values, no versioning scheme beyond `updatedAt`:

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
- `pantry` → `{ updatedAt: <ISO8601>, items: [{name, qty?}] }` — what food is
  on hand, read by the shopping list (Phase 11) and deducted from by the eat
  flow (Phase 12).
- `adhoc` → `{ updatedAt: <ISO8601>, items: [{name, qty?}] }` — the same
  shape as `pantry`, but for a scratch "ran out of / want to buy this week"
  list, separate from the two-week planned shop (Phase 12).
- `plan` (Phase 13) → `{ updatedAt, startDate, days: [{day, slots: {<slotType>:
  {mealId, eatenAt, variantId?}}}] }`. **The plan of record is still `mp_plan`
  in localStorage** — this key is a derived, best-effort, app-written mirror
  (`mealId`/`eatenAt`/optional `variantId` only, no name or recipe data) that
  exists so Hermes can see what's already scheduled before proposing a
  placement. It is stale by construction (pushed on save, not
  read-after-write) and **the app never reads it back** — if the mirror and
  `mp_plan` ever disagree, `mp_plan` wins. `variantId` (Phase 14) is present
  only when the slot has one, never written as `null`.
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

Writes to `pantry`, `adhoc`, `plan` and `prefs` are **local-first**: the app
updates its localStorage mirror synchronously and renders from it, then
either replays a pending-op log (`pantry`/`adhoc`) or does a best-effort,
failure-silent push (`plan`/`prefs`) in the background. This keeps the app
fully usable with the bridge unreachable — sync is never on the critical
path.

## Worker endpoints

- `GET /library`, `PUT /library`
- `GET /planFlag`, `PUT /planFlag`
- `GET /pantry`, `PUT /pantry`
- `GET /adhoc`, `PUT /adhoc`
- `GET /plan`, `PUT /plan`
- `GET /placements`, `PUT /placements`
- `GET /prefs`, `PUT /prefs`
- `GET /eaten-log`, `PUT /eaten-log`
- All requests require `X-Auth-Token: <secret>`, checked against a Wrangler
  secret binding (`wrangler secret put AUTH_TOKEN`) — never committed to
  the repo (public repo, no personal data or secrets in git history).

## Non-obvious invariants

- Phase 1's "no backend" rule is relaxed **only** for this Worker. Nothing
  else in the app may add a server dependency without confirming with the
  user first — this now includes the Worker's own scope: don't grow it
  into a general API.
- The Worker never stores anything beyond `library`, `planFlag`, `pantry`,
  `adhoc`, `plan`, `placements`, `prefs`, and `eatenLog`. It does not compute nutrition,
  shelf-life, or plans — it's a sync relay, and the actual logic stays in
  the shared JS modules it imports from the app.
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
