# Architecture

## Stack

- **App (unchanged from Phase 1)**: static site, vanilla JS/CSS, no
  framework, no build step, no backend. Deployed to GitHub Pages. State in
  browser `localStorage`. PWA via `manifest.json` + `sw.js`.
- **Hermes bridge (new, Phase 4)**: a single **Cloudflare Worker** backed by
  **Workers KV**, deployed with Wrangler from a `worker/` directory in this
  same repo. Secret-token-gated. This is the *only* backend in the project —
  it exists solely to sync the liked-meal library and a couple of small
  flags between the app and Hermes (n8n), and is not a general API.

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
Hermes (n8n, HTTP node)  <---->  Cloudflare Worker  <---->  Workers KV
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

Two keys, both plain JSON values, no versioning scheme beyond `updatedAt`:

- `library` → `{ updatedAt: <ISO8601>, meals: [ ...same shape as meals.json items... ] }`
  Both the app and Hermes read this on load/poll and PUT the full array
  back on any change (add/remove/edit a meal, edit ingredients).
- `planFlag` → `{ requestedAt: <ISO8601>, ackedAt: <ISO8601|null> }`
  Hermes PUTs a new `requestedAt` to ask for a plan; the app polls, and
  when `requestedAt > ackedAt` it runs the existing local generator and
  PUTs back `ackedAt = requestedAt`. The plan itself is never stored in KV.

## Worker endpoints

- `GET /library`, `PUT /library`
- `GET /planFlag`, `PUT /planFlag`
- All requests require `X-Auth-Token: <secret>`, checked against a Wrangler
  secret binding (`wrangler secret put AUTH_TOKEN`) — never committed to
  the repo (public repo, no personal data or secrets in git history).

## Non-obvious invariants

- Phase 1's "no backend" rule is relaxed **only** for this Worker. Nothing
  else in the app may add a server dependency without confirming with the
  user first — this now includes the Worker's own scope: don't grow it
  into a general API.
- The Worker never stores anything beyond `library` and `planFlag`. It does
  not compute nutrition, shelf-life, or plans — it's a sync relay, and the
  actual logic stays in the shared JS modules it imports from the app.
- KV is eventually consistent — don't add a feature that reads-after-write
  and assumes immediacy.
- Nutrition targets are fixed (no training/rest-day flexing) — Hermes must
  not be given a way to alter `nutrition-targets.json` values at runtime.
