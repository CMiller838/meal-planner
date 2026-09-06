# Tasks

Per-phase breakdowns are written by `@planner` in phase mode, just before each
phase is built. Placeholders below track roadmap progress only.

## Phase 1 — MVP meal planner

- [x] Shipped direct from `SPEC.md` (pre-dates this checklist; see `git log`)

## Phase 2 — Plan generator & browse quality

Spec: `.claude/specs/phase2_spec.md`. Logic tasks are TDD — write the check in
`test.html` first, watch it fail, then implement.

### Data & schema

- [x] Add `prepEffort` to all 14 records in `meals.json` — `"batch"` for the three
      `batchCook: true` meals, `"quick"` for the rest (spec §5 table)
- [x] `data.js` — `MP.addToLibrary(meal)` sets `prepEffort: "quick"` when absent, so
      Discover-added meals stay uniform (no localStorage migration; `effortOf` defaults)

### Logic & Backend Tasks (TDD)

- [x] New `generator.js` — `MP.Generator` IIFE, same shape as `nutrition.js`/`shelf-life.js`:
      pure, no DOM, no fetch
- [x] `weekdayOf(startDate, dayNum)` + `isoToday()` — build dates as `new Date(y, m-1, d)`,
      never `new Date("YYYY-MM-DD")` (UTC-parse trap)
- [x] Check: `weekdayOf` agrees with a locally-constructed `Date` for day 1
- [x] `weekendRuns(startDate)` — maximal consecutive day-positions in 1..14 whose weekday
      is Fri/Sat/Sun, grouped by day adjacency not by `getDay()` value
- [x] Check: Monday start === `[[5,6,7],[12,13,14]]`; Saturday start === `[[1,2],[7,8,9],[14]]`
- [x] `shelf-life.js` — export `rawSafeOn(meal, dayNum, shelfData)` over the existing
      private `worstRawCategory`/`buildWarning`/`shopDayFor`; nothing else in the file changes
- [x] Check: `chorizo-pasta` day 5 true, `roast-chicken` day 5 false, pantry-only meal true
- [x] `generatePlan(library, tags, targets, shelfData, startDate)` — rewrite: gap-ranked
      selection via `MP.Nutrition.rankByGap`, unused-first then oldest-used-first reuse,
      previous-day exclusion; returns `{ startDate, days }` with `days[]` shape unchanged
- [x] Cook-once runs: run length ≥ 2 ⇒ batch meal on run day 1, leftovers via `leadsTo`
      child or same-id repeat, coverage `min(L, servings, cooked_leftovers.fridgeDays)`
      read from `shelfData`; overflow days fall through to a quick meal
- [x] Shelf-life filter on batch candidates + `ponytail:` comment naming the ceiling
      (raw chicken/mince are out of window by Friday on a Monday-start plan)
- [x] Mon–Thu and non-run days favour `prepEffort: "quick"` — soft partition, never a
      hard filter
- [x] Check: every run's first day holds a `batchCook` meal; run days hold the same id or
      a `leadsTo` child
- [x] Check: no dinner id on consecutive days outside a run (the variety guard itself)
- [x] Check: tiny library (2 dinners, 1 each other slot) still fills all 14 days and
      alternates dinners — the oldest-used-first fallback
- [x] `data.js` — `MP.filterMeals(meals, query)`: case-insensitive substring over name,
      `mealTypes`, ingredient keys (`_` → space) and labels; blank query returns all
- [x] Check: matches by name fragment, by `"dinner"`, by `"yogurt"` → `greek_yogurt`;
      blank query returns the full array
- [x] `plan.js` — delete `BREAKFAST_CYCLE`/`LUNCH_CYCLE`/`SNACK_ID`/`DINNER_CYCLE`, call
      `MP.Generator.generatePlan(...)`; `loadPlan()` leaves a pre-existing plan without
      `startDate` alone (no forced regenerate)
- [x] New `test.html` at repo root — script-includes `data.js`, `nutrition.js`,
      `shelf-life.js`, `generator.js`, runs the asserts above with literal fixtures,
      prints PASS/FAIL into a `<pre>`. No framework, no build step, not in the SW shell

### UI & Layout Tasks

- [x] `index.html` — `<input type="search" id="library-search" class="search-input">`
      inside the "Your Library" section, directly above `#library-grid`, with `aria-label`
- [x] `app.js` — `renderLibrary()` reads `#library-search` and renders
      `MP.filterMeals(library, q)`; `input` listener wired in `init()`; Discover deck
      unaffected
- [x] Empty state: non-blank query with no matches renders a `.empty` line, query text
      through `esc()`
- [x] `style.css` — `.search-input` styling, full-width, matching existing card/nav tokens,
      dark mode first
- [x] `plan.js` `renderPlan()` — day heading shows `Day N · Mon` when `plan.startDate`
      exists, plain `Day N` when it does not

### Wiring & verification

- [x] `plan.html` — `<script src="generator.js">` before `plan.js`
- [x] `sw.js` — add `"generator.js"` to `SHELL` **and** bump `CACHE` to `"meal-planner-v2"`
- [ ] Manual pass: serve, open `plan.html`, Generate — weekday labels correct, Fri/Sat/Sun
      share one cooked meal, Mon–Thu vary, shelf-life warnings still render; `index.html`
      search filters live. **Not run** — no headless browser available in this environment;
      logic verified instead via `test.html`'s checks run under Node against the real data
      files. Run this manual pass before shipping.
- [x] Mark Phase 2 complete in `docs/roadmap.md` and commit docs + code together
      (`.claude/rules/roadmap-gating.md`)

### Deferred (do not build in this phase)

- [ ] `docs/FUTURE.md` — log freezer-aware batch planning (buy day 1, freeze, defrost
      Thursday) as the real fix for the shelf-life ceiling
- [ ] Note only: `docs/ARCHITECTURE.md:8` labels the Hermes bridge "(new, Phase 2)" — it
      is Phase 4 since the roadmap split. One-line fix only if trivially in reach; do not
      pull architecture edits into this phase

## Phase 3 — Shopping list from the 2-week plan

Spec: `.claude/specs/phase3_spec.md`. Logic tasks are TDD — write the check in
`test.html` first, watch it fail, then implement. Purely additive over Phase 2:
no changes to `generator.js`, `meals.json` or the plan schema.

### Data & schema

- [x] New `pack-sizes.json` — `{ "pricesAsOf": "YYYY-MM", "items": { <ingredientKey>:
      { label, packSize, unit, price, staple? } } }`, keyed by the same `key` as
      `meals.json` (spec §1)
- [x] Seed all 29 purchasable ingredient keys currently in `meals.json` (spec §0 list).
      `unit` **must match how meals express that ingredient** — `white_bread` is
      `"slices"`, not `"g"`, or its line silently degrades to 1 pack
- [x] Flag `staple: true` on `gravy`, `teriyaki_sauce`, `white_sauce`, `peanut_butter`
      only; prices are the maintainer's estimate, `pricesAsOf` records when

### Logic & Backend Tasks (TDD)

- [x] New `shopping-list.js` — `MP.ShoppingList` IIFE, same shape as
      `shelf-life.js`/`generator.js`: pure, no DOM, no `localStorage`; `load()` fetches
      and caches `pack-sizes.json` mirroring `MP.ShelfLife.load()`
- [x] `parseQty(qtyText)` — leading-number regex, `kg`→`g` and `l`→`ml` ×1000, bare number
      ⇒ `"each"`, ranges take the lower bound, no match ⇒ `null`. `ponytail:` comment: the
      fix for imprecision is filling in `meals.json` quantities, not a smarter parser
- [x] Check: `"500g"`→`{500,"g"}`, `"2 slices"`→`{2,"slices"}`, `"1.5kg"`→`{1500,"g"}`,
      `"1-2"`→`{1,"each"}`; `""`/`"handful, grated"`/`"Bisto"`/`"whole"` → `null`
- [x] `packsFor(needed, item)` — `Math.max(1, Math.ceil(needed/packSize))`; unknown item,
      null needed, or unit mismatch all ⇒ 1. Never guess cross-unit conversions
- [x] Check: 900g/500g ⇒ 2; 500g/500g ⇒ 1; null needed ⇒ 1; `tbsp` vs `g` pack ⇒ 1
- [x] `buildLists(plan, mealsById, packData)` → `{ "1": ShopList, "8": ShopList }` with
      `{ shopDay, lines, staples, unpriced, total }` (spec §2 shapes)
- [x] Purchase occurrences: every non-null slot, **except** a dinner whose `mealId` equals
      the previous day's dinner *and* whose meal is `batchCook: true`. Dinner slot only —
      never dedupe breakfast/lunch/snack. No scaling by `servings` or run length
- [x] Check: `chilli-con-carne` on days 5, 6, 7 yields `beef_mince` **once** (500g, 1 pack).
      *The loudest check in this phase — it fails if the dedupe is ever "simplified" away*
- [x] Check: the same non-`batchCook` breakfast on days 1 and 2 counts **twice**
- [x] Ingredient exclusion, both forms: `key` starting `leftover_`, **and** `qty` matching
      `/leftover|from roast/i` — the second catches `toastie-chicken-cheese`'s
      `{"key":"chicken_breast","qty":"leftover, sliced"}`, a non-`leftover_` key that must
      not be bought
- [x] Check: `chicken-fajitas` contributes `tortillas` but not `leftover_chicken`;
      `toastie-chicken-cheese` contributes `white_bread`/`cheese` but not `chicken_breast`
- [x] Shop-day split via `MP.ShelfLife.shopDayFor(day)` — reuse it, don't re-implement the
      `<= 7` test; assignment is by cook/eat day
- [x] Check: a dinner on day 7 lands in list `1`; the same meal on day 8 lands in list `8`
- [x] Summing: group by key per shop day; sum only when every occurrence parses to the same
      unit, otherwise `needed: null` for the whole line. Route to `staples` /`unpriced`/
      `lines`; `total` sums `lines` only and is rounded to 2dp once at the end
- [x] Check: unknown key lands in `unpriced` and contributes 0; `staple: true` lands in
      `staples` and is excluded; `total` matches a hand-computed fixture sum
- [x] Edge cases: no plan, `mealId: null` slots, `mealId` missing from the library, empty
      `ingredients` — all skipped silently, nothing throws (spec §5 table)
- [x] `test.html` — add `<script src="shopping-list.js">` to its includes; all checks above
      use literal fixtures, never `load()`

### UI & Layout Tasks

- [x] New `shopping.html` — copy `plan.html`'s head/nav scaffolding, `#shopping-meta` +
      `#shopping-root`. Includes: `data.js`, `shelf-life.js`, `shopping-list.js`,
      `shopping.js` only — **not** `nutrition.js`/`swipe.js`/`mealdb.js`/`generator.js`
- [x] New `shopping.js` page controller (DOM + `localStorage`), split from the pure module
      the same way `plan.js` splits from `generator.js`
- [x] Render two `.shop-block` sections, one per shop day, as a single injected HTML string
      (same approach as `renderPlan()`), each with heading, total, and `.shop-list` lines
- [x] **Escaping:** every `label`, `meals` entry and `key` interpolated into HTML goes
      through `MP.esc()` — Discover-added meal names are untrusted TheMealDB content
- [x] Staples and unpriced groups as native `<details>`/`<summary>` — no accordion JS
- [x] Per-line native `<input type="checkbox">` inside a `<label>` (whole row tappable,
      a11y for free); ticked ⇒ `.ticked` class. Total does **not** change when ticking
- [x] Tick state at `localStorage["mp_shopping_ticked"]` = `{ startDate, keys: ["1:key"] }`;
      discard the whole record when stored `startDate` !== `plan.startDate` (that *is* the
      clear-on-regenerate rule — no separate hook in `plan.js`). One delegated `change`
      listener on `#shopping-root`, not one per line
- [x] Empty state: no plan ⇒ `.empty` line linking to `plan.html`
- [x] `style.css` — `.shop-block`, `.shop-line`, `.shop-qty`, `.shop-name`, `.shop-price`,
      `.shop-why`, `.shop-total`, `.ticked`, `.shop-extra`; reuse existing card/nav tokens,
      dark mode first

### Wiring & verification

- [x] Nav — add `<a href="shopping.html">Shopping</a>` to `index.html`, `plan.html` and
      `shopping.html`, `class="active"` on the current page only
- [x] `sw.js` — add `"shopping.html"`, `"shopping-list.js"`, `"shopping.js"`,
      `"pack-sizes.json"` to `SHELL` **and** bump `CACHE` to `"meal-planner-v3"`.
      `test.html` stays out of the shell
- [ ] Manual pass: serve, generate a plan, open `shopping.html` — two blocks, plausible
      totals, ticks survive reload, regenerating clears ticks, page renders offline after
      one visit. **Not run** — no headless browser available in this environment; logic
      verified instead via `test.html`'s checks run under Node against the real data
      files (same as Phase 2). Run this manual pass before shipping.
- [x] Mark Phase 3 complete in `docs/roadmap.md` and commit docs + code together
      (`.claude/rules/roadmap-gating.md`)

### Deferred (do not build in this phase)

- [ ] `docs/FUTURE.md` — most `meals.json` `qty` fields are empty, so most lines are
      "1 pack" and the total is a floor, not an estimate; the fix is data, not code
- [ ] Not built deliberately: print/export, "remaining total" as you tick, price history,
      multi-store switching, aisle grouping (add aisle grouping first if the list ever
      gets long enough to be annoying in-store)

## Phase 4 — Hermes bridge (Cloudflare Worker + KV)

Spec: `.claude/specs/phase4_spec.md`. Logic tasks are TDD — write the check in
`test.html` first, watch it fail, then implement. The repo is public: no library
data, no Worker URL and no token may ever be committed.

Read spec §0 first. The two traps it names (the seed library pushing over
Hermes' real one; pull/push ping-pong) are what most of this checklist exists to
prevent — both are silent data loss, not edge cases.

### Backend — `worker/` (Cloudflare)

- [x] New `worker/wrangler.toml` — `name`, `main = "worker.js"`, `compatibility_date`,
      one `[[kv_namespaces]]` block with `binding = "MP_KV"`. Nothing else: no `[vars]`,
      no routes, no custom domain (the free `*.workers.dev` subdomain is the endpoint)
- [x] `.gitignore` — add `.wrangler/`. **No `worker/package.json`** — Wrangler runs via
      `npx`, so nothing is installed or committed and the repo's zero-dependency shape
      stays literally true
- [x] New `worker/worker.js` — module-syntax `export default { async fetch(request, env) }`.
      No router, no framework, no dependencies
- [x] **`OPTIONS` handled first, before the auth check** ⇒ `204` + CORS headers. A browser
      preflight cannot carry `X-Auth-Token`; auth-before-preflight is the one bug that
      curls perfectly and fails from the app
- [x] CORS headers on **every** response including 400/401/404/405 — `Allow-Origin: *`,
      `Allow-Methods: GET, PUT, OPTIONS`, `Allow-Headers: Content-Type, X-Auth-Token`,
      `Max-Age: 86400`. One shared helper so no path can forget them
- [x] Auth: `X-Auth-Token` header vs `env.AUTH_TOKEN` ⇒ `401` on mismatch. Plain compare +
      `ponytail:` comment naming the non-constant-time ceiling
- [x] Path allowlist `const KEYS = { "/library": "library", "/planFlag": "planFlag" }` ⇒
      unknown path `404`. **This two-entry object is what stops the bridge becoming a
      general API** — adding a key here should feel like a decision
- [x] Method gate: `GET`/`PUT` only, anything else ⇒ `405`
- [x] `GET` ⇒ `env.MP_KV.get(key)`; missing key ⇒ body `"null"`, **never a 404**, so the
      client has one code path (`await r.json()` gives the object or `null`)
- [x] `PUT` ⇒ `await request.text()`, `JSON.parse` in `try/catch` ⇒ `400` on throw; not a
      plain object (`null`, non-object, or `Array.isArray`) ⇒ `400`; otherwise
      `MP_KV.put(key, text)` storing the **original text verbatim** (do not re-serialise)
      ⇒ `204`
- [x] The Worker never inspects field names, never computes nutrition/shelf-life/plans and
      never reads `meals.json`. ARCHITECTURE.md's shared-module note applies to Phase 5's
      conversational layer — there is nothing to import here

### Logic & Backend Tasks — app side (TDD)

- [x] `data.js` — `saveLibrary(meals)` additionally stamps
      `localStorage["mp_library_updated_at"] = new Date().toISOString()` and fires
      `window.dispatchEvent(new Event("mp:library-saved"))`. `data.js` gains no fetch, no
      config and no knowledge of sync
- [x] `data.js` — **`getLibrary()`'s first-run seed must bypass `saveLibrary()`** and
      write `mp_library` directly, leaving the stamp absent. *Trap 1: a stamped seed would
      push 14 default meals over Hermes' real library on any fresh browser.* One-line
      change, disproportionate consequence — leave a comment saying so
- [x] `data.js` — `MP.applyRemoteLibrary(meals, updatedAt)`: writes `mp_library` **and**
      stamps the *remote's* timestamp, firing **no** event. *Trap 2: applying a pull via
      `saveLibrary()` would stamp a newer local time and push it straight back.* Solve it
      with the separate write path, not with an "am I syncing" flag
- [x] `data.js` — `MP.libraryStamp()` ⇒ ISO string or `null`
- [x] New `hermes-sync.js` — `MP.Sync` IIFE, same shape as `shelf-life.js`/`shopping-list.js`.
      Loading it has **zero effect** when unconfigured: it only reads `localStorage`, and
      `start()` is called by the page controller, never at module scope
- [x] `decide(localStamp, remote)` ⇒ `"pull"|"push"|"noop"` — parse both to numbers
      (`localStamp` absent ⇒ `0`, remote absent/unparseable ⇒ `-1`), then one comparison.
      No special-casing; the seven-row table in spec §3a falls out of it
- [x] Check: `decide(null, {updatedAt:"2026-09-01…"})` ⇒ `"pull"` — *the Trap 1 check; it
      fails the moment an unstamped local library starts pushing*
- [x] Check: `decide(null, null)` ⇒ `"push"` (first-ever bootstrap from the seed);
      `decide("2026-09-02…", null)` ⇒ `"push"`
- [x] Check: local newer ⇒ `"push"`; remote newer ⇒ `"pull"`
- [x] Check: identical timestamps ⇒ `"noop"` — *fails if polling ever starts pushing on
      every tick and thrashing KV*
- [x] Check: unparseable remote `updatedAt` ⇒ `"push"` (garbage gets overwritten, sync
      never freezes)
- [x] `needsPlan(flag, localAckedAt)` ⇒ boolean —
      `requestedAt > max(flag.ackedAt, localAckedAt)`; missing flag or `requestedAt` ⇒ false
- [x] Check: `needsPlan(null, null)` and `needsPlan({}, null)` ⇒ false; unacked flag ⇒ true;
      `ackedAt` after `requestedAt` ⇒ false; a second `requestedAt` after an ack ⇒ true
- [x] Check: unacked flag but `localAckedAt` after `requestedAt` ⇒ **false** — *the KV
      ~60s propagation suppression; this is the check that stops the banner flickering back*
- [x] `config()` / `saveConfig(url, token)` over `mp_hermes_url` + `mp_hermes_token`;
      `enabled` = both non-empty. `saveConfig` trims and **strips a trailing `/`** or every
      request hits `//library` and 404s
- [x] Private `req(method, path, body)` — sets `X-Auth-Token` + `Content-Type`, throws on
      non-2xx, returns parsed JSON (`null` for 204)
- [x] `syncLibrary()` ⇒ `"pull"|"push"|"noop"|"off"|"error"`. Not enabled ⇒ `"off"`, no
      fetch. Module-level `inflight` boolean guard, `finally`-cleared. Any throw is caught
      ⇒ `"error"` — **sync never throws into page init**
- [x] **Re-read `MP.libraryStamp()` after the GET resolves** and pass *that* to `decide()`,
      never a value captured before the `await`. This one line is the whole race fix: an
      edit made while the GET was in flight flips `pull` to `push` and survives
- [x] Apply: `"pull"` ⇒ `MP.applyRemoteLibrary(...)` then dispatch `"mp:library-pulled"`;
      `"push"` ⇒ `PUT /library` with `{ updatedAt, meals }`, stamping the same value
      locally when it was previously unstamped; `"noop"` ⇒ nothing
- [x] Guard the apply: a remote blob whose `meals` is not an array ⇒ treat as `noop`, do
      **not** wipe the local library. (Remote `meals: []` **is** legitimate and is pulled)
- [x] `syncPlanFlag()` ⇒ flag object or `null`. `ackPlanFlag(requestedAt)` ⇒
      `PUT /planFlag { requestedAt, ackedAt: now }` echoing back the `requestedAt` it
      **saw** (so a newer request landing in between isn't silently acked), and mirrors the
      same `ackedAt` into `localStorage["mp_hermes_plan_acked"]`
- [x] `start()` — listen for `"mp:library-saved"` ⇒ `syncLibrary()`; listen for
      `visibilitychange` ⇒ `syncLibrary()` when `visibilityState === "visible"`
      (`visibilitychange` not `focus`: this is an installed Android PWA); one immediate
      `syncLibrary()`. No debounce, no retry/backoff — `ponytail:` comment naming that
      ceiling, upgrade path goes in `docs/FUTURE.md`
- [x] `test.html` — add `<script src="hermes-sync.js">` to its includes. Literal fixtures
      only; never call `syncLibrary`/`config`/anything touching the network

### UI & Layout Tasks

- [x] `index.html` — new last `<section class="section">` in `<main>` with a native
      `<details id="sync-settings">`: `#sync-status`, `#sync-url` (`type="url"`),
      `#sync-token` (`type="password"`, `autocomplete="off"`), `#sync-save` button.
      `<details>` for the collapse, same as Phase 3's staples group — no accordion JS
- [x] `app.js` — populate both inputs from `MP.Sync.config()` via `.value`, never
      `innerHTML`
- [x] `app.js` — `#sync-save` click ⇒ `saveConfig()` then `syncLibrary()`, rendering the
      result into `#sync-status` with `textContent`: `Not set up` / `Syncing…` /
      `Pulled library from Hermes` / `Pushed library to Hermes` / `In sync` /
      `Sync failed — check the URL and token`. No further error detail — the two realistic
      causes (wrong token, typo'd URL) are fixed in those same two boxes
- [x] `app.js` — listen for `"mp:library-pulled"` ⇒ re-`MP.getLibrary()` + `renderLibrary()`,
      so a Hermes-side change appears without a manual refresh
- [x] `app.js` — call `MP.Sync.start()` in `init()`, **not awaited**. Page render must
      never wait on the network
- [x] `plan.html` — `<div id="hermes-banner" class="banner hidden">` inside `<main>` above
      the plan grid, with static text and a `#hermes-generate` button. Static content,
      nothing interpolated, nothing to escape
- [x] `plan.js` `init()` — after the existing `renderPlan()`, fire-and-forget
      `MP.Sync.start()` + `syncPlanFlag()`; unhide the banner only when
      `needsPlan(flag, localStorage["mp_hermes_plan_acked"])`. Sync error or unconfigured
      ⇒ banner simply never appears, no error UI on this page
- [x] `plan.js` — `#hermes-generate` click ⇒ the existing generate/save/render three lines
      **without** the `confirm()` (tapping the banner *is* the consent), then
      `ackPlanFlag(requestedAt)`, hide the banner, `toast(...)`. The existing Generate
      button keeps its `confirm()` unchanged
- [x] `style.css` — `#sync-settings`, `.sync-field`, `.banner`; reuse the existing card /
      `.btn` / `.muted` tokens and Phase 3's `<details>` styling, dark mode first.
      `.hidden` already exists

### Wiring & verification

- [x] `index.html` and `plan.html` — `<script src="hermes-sync.js">` before `app.js` /
      `plan.js`. **`shopping.html` deliberately does not get it** (it derives from an
      already-generated plan) — comment so it doesn't look like an oversight
- [x] `sw.js` — add `"hermes-sync.js"` to `SHELL` **and** bump `CACHE` to
      `"meal-planner-v4"`. `test.html` and the `worker/` files stay out of the shell —
      the Worker is a different origin and is never served from here
- [x] Confirm **no `sw.js` change is needed for Worker traffic**: the fetch handler already
      returns early on `url.origin !== location.origin` and non-`GET`. Don't "fix" it
- [x] Deploy: `npx wrangler login` → `npx wrangler kv namespace create MP_KV` → paste the
      id into `wrangler.toml` → `npx wrangler secret put AUTH_TOKEN` (generate a long
      random token; it goes in the app's settings box, **never** in the repo) →
      `npx wrangler deploy`. Live at `https://meal-planner-bridge.cody-dev.workers.dev`
- [x] Worker smoke test via curl against the live URL (spec §7b table, all 11 rows): no
      token ⇒ 401; wrong token ⇒ 401; `OPTIONS` with no token ⇒ 204 + all four CORS
      headers; unknown path ⇒ 404; `DELETE` ⇒ 405; `GET /planFlag` before any write ⇒
      `null`; `PUT` then `GET /library` round-trips byte-identically; body `not json` ⇒
      400; body `[1,2]` ⇒ 400; every response carries `Access-Control-Allow-Origin`.
      Run directly against the deployed Worker rather than `wrangler dev` first — same
      assertions, one less step
- [x] Repeat the 401 / preflight / PUT / GET curls once against the live `*.workers.dev`
      URL after deploying. No `worker/smoke.sh` — this is a deploy-once backend; write the
      script only if you find yourself retyping these
- [x] `docs/ARCHITECTURE.md` — "(new, Phase 2)" → Phase 4; `docs/FUTURE.md` — "Phase 2's
      Hermes bridge" → "Phase 4's". Stale roadmap-split numbering; clears the note carried
      in Phase 2's deferred list
- [x] Manual pass (partial — done against the live Worker with the user's own browser):
      URL + token pasted into the sync section, Save & sync now reported `Pulled library
      from Hermes`; `MP.addToLibrary()` + a curl-simulated concurrent edit round-tripped
      correctly (push then pull) after a bad test-seed timestamp was corrected. **Not
      run**: the `plan.html` `planFlag` banner (curl a flag, confirm it appears/acks/stays
      gone) and the offline-after-one-visit check on all three pages. Do these before
      relying on the banner feature
- [x] Mark Phase 4 complete in `docs/roadmap.md` and commit docs + code together
      (`.claude/rules/roadmap-gating.md`)

### Deferred (do not build in this phase)

- [x] `docs/FUTURE.md` — offline edits are lost to last-write-wins: an edit made while
      offline is silently overwritten by any newer remote write. The fix is a queued push
      with retry/backoff, not a smarter `decide()`
- [x] `docs/FUTURE.md` — no conflict UI: the app never tells you it discarded a local
      version. Revisit if a real overwrite is ever noticed in practice
- [ ] Not built deliberately: retry/backoff, offline write queue, per-meal merge, syncing
      the plan itself or `mp_shopping_ticked`, a `settings.html` page, multi-device
      presence, any endpoint beyond the two allowlisted keys
- [ ] Phase 5 depends on these endpoints and **must not widen them**. A third KV key is a
      deliberate Phase 5 decision against the `KEYS` allowlist, not a drive-by addition

## Phase 5 — Hermes conversational capabilities

Spec: `.claude/specs/phase5_spec.md`. Logic tasks are TDD — write the check in
`test.html` first, watch it fail, then implement.

Read spec §0 first. Hermes is n8n and lives outside this repo, so three of the
four capabilities in the roadmap goal need **no repo code** — the whole build is
the shared exclusion module plus one read-only Worker route. The rule that shapes
everything: *a hard dietary exclusion enforced by prompt text is not enforced.*

**Answering Phase 4's deferred question: no third KV key.** `KEYS` stays at two
entries; `/discover` touches no storage and is deliberately not in it.

### 0. Housekeeping — do this first

- [x] **Commit Phase 4.** Committed together with Phase 3 (also never committed) as one
      `feat:` commit before Phase 5 code
- [x] Delete the stray empty artifact `worker/e` (a shell-redirect leftover) in that same
      cleanup commit
- [x] Confirm `.gitignore` still covers `.wrangler/` and that
      `worker/.wrangler/cache/wrangler-account.json` is **not** staged — it is local
      account state, and the repo is public

### 1. Data & schema

- [x] New `substitutions.json` at repo root — `{ "note": "...", "mushroom": { "key":
      "courgette", "label": "Courgette" } }` (spec §2). One entry, one replacement each,
      **not** an array of options
- [x] The `note` field must say the load-bearing part out loud: *a term with no entry here
      degrades to a blanket reject, never to a pass*

### 2. Logic & Backend Tasks — `exclusions.js` (TDD)

- [x] New `exclusions.js` at repo root — `MP.Exclusions` IIFE. **Must not depend on
      `data.js`** (the Worker never loads it) and must not touch `window`/`document`/
      `localStorage`/`sessionStorage` anywhere, not even inside a function body. Use the
      `(function (root) { ... })(typeof globalThis !== "undefined" ? globalThis : this)`
      wrapper from spec §1 so the same file loads in a `<script>` and in a Worker bundle
- [x] Rule terms as constants in this file (`MUSHROOM`, `EGG`, `TOASTIE`, `TOASTIE_VEG`),
      not a JSON file — `CLAUDE.md`'s data-not-constants invariant is about tunable
      nutrition numbers, and there must be exactly one place to read the rules
- [x] `hasMushroom(ingredients)` — substring match on **both** `key` and `label`
- [x] Check: `[{key:"mushrooms"}]` ⇒ true; `[{key:"beef", label:"Mushroom Soup Mix"}]` ⇒
      true (*the label check — TheMealDB labels are the untidy side*); `[{key:
      "chicken_breast"}]` ⇒ false
- [x] `isStandaloneEgg(meal)` — egg present **and** at most one non-egg ingredient.
      `ponytail:` comment naming the ceiling (counting ingredients, not understanding
      dishes; upgrade path is an explicit id allow/deny list, not a cleverer count)
- [x] Check: bare egg ⇒ true; egg + bread ⇒ true; seed `french-toast` ⇒ false
- [x] **Check: seed `egg-pb-toast-snack` ⇒ false.** *The loud one — it fails the moment
      the egg rule is written broadly enough to delete a meal the user actually eats*
- [x] `hasVegInToastie(meal)` — only applies when `meal.id`/`meal.name` matches
      `/toastie|toasted sandwich/i`; non-toasties always pass
- [x] Check: toastie + `onions` ⇒ true; seed `toastie-ham-cheese` ⇒ false; a non-toastie
      containing `onions` ⇒ false (*the rule is veg-in-toasties, not a veg dislike*)
- [x] `check(meal)` ⇒ `{ ok, reasons: string[] }`, reasons being short human strings
      Hermes can read aloud
- [x] **Check: every meal in `meals.json` passes `check().ok`.** *The best single check in
      this phase — any rule written too broadly fails here immediately*
- [x] `sanitize(meal, subs)` ⇒ `{ meal, substituted: [{from,to}] } | null`, in spec §1's
      exact order: egg/toastie ⇒ `null` first (no swap exists for either), then swap every
      mushroom ingredient keeping `qty` verbatim, then **`null` if any mushroom remains**
      because `subs` had no entry
- [x] `sanitize` **never mutates its input** — build a fresh object and a fresh
      `ingredients` array
- [x] Comment the safety property: *`sanitize` can only ever return a meal that would pass
      `check()`* — it is what makes `/discover` trustworthy
- [x] Check: mushroom meal ⇒ no mushroom in the result, `substituted.length === 1`, **and
      the original input object still contains mushroom** (the non-mutation assert)
- [x] Check: standalone-egg meal ⇒ `null`; clean meal ⇒ same ingredients, `substituted: []`
- [x] Check: `sanitize(mushroomMeal, {})` ⇒ `null`, not a pass-through (*the degrade-to-
      reject property; it fails if a missing substitution ever becomes a silent allow*)
- [x] `test.html` — add `<script src="exclusions.js">` to its includes

### 3. Logic & Backend Tasks — `mealdb.js` refactor (net deletion)

- [x] Move `extractIngredients`/`toMeal` onto the module surface as `MP.MealDB.toMeal(detail)`
      — the Worker imports this file for the mapping rather than reimplementing it
- [x] Every `sessionStorage`/`window` reference must sit **inside** `getDiscoverPool`'s
      body, never at module scope; attach to `globalThis.MP` self-containedly like
      `exclusions.js`. Precedent: `hermes-sync.js` loads with zero effect when unconfigured
- [x] **Delete `hasMushroom` (lines 16–22) and its `.filter(d => !hasMushroom(d))`** —
      replace with `.map(MP.MealDB.toMeal).map(m => MP.Exclusions.sanitize(m, subs))
      .filter(Boolean)`. Root-cause fix: the app's Discover deck now enforces all three
      rules and offers the same substitution Hermes does, instead of only filtering mushrooms
- [x] Cached `load()` for `substitutions.json` on the existing `MP.MealDB` module,
      mirroring `MP.ShelfLife.load()` — don't invent a new loader module
- [x] Fetch failure ⇒ fall back to `{}` so mushroom meals are rejected outright. Degrades
      to Phase 1 behaviour, never to a pass

### 4. Backend — `worker/worker.js`

- [x] Imports at the top: `import "../exclusions.js"`, `import "../mealdb.js"`,
      `import SUBS from "../substitutions.json"`. No new dependency — Workers have native
      `fetch` and Wrangler/esbuild imports JSON natively
- [x] Route `/discover` **after** the existing OPTIONS + auth checks and **before** the
      `KEYS` lookup. `GET` only ⇒ anything else `405`. `KEYS` is untouched and
      `Access-Control-Allow-Methods` stays `GET, PUT, OPTIONS`
- [x] `q` non-empty ⇒ `search.php?s=<encodeURIComponent(q)>`; blank/absent ⇒ `random.php`.
      Both return full detail, so **no `lookup.php` N+1**. `filter.php?i=` deliberately
      unsupported — it returns stubs, and ingredient-led browsing is the app's Discover deck
- [x] Pipeline: `data.meals ?? []` → `MP.MealDB.toMeal` → `MP.Exclusions.sanitize(m, SUBS)`
      → first **8** non-null
- [x] `200` body `{ query, meals: [...], rejected: [{name, reasons}] }` (spec §3). Meals are
      **already in the app's library shape** so Hermes can drop one into a `PUT /library`
      with no field translation; `substituted` is always present (`[]` when unchanged) so
      the chat layer has one code path; `rejected` capped at 8
- [x] TheMealDB non-2xx / network error / unparseable body ⇒ `502 "discovery upstream
      failed"`. Never a 500, never a partial list
- [x] `{"meals": null}` from TheMealDB (no match) ⇒ `200` with `meals: []`, `rejected: []`

### 5. Backend — `PUT /library` shape validation (trust boundary)

- [x] `libraryError(parsed)` ⇒ error reason string or `null`. Rejects with `400` when
      `meals` is not an array, an element is not a plain object, an element's `id`/`name`
      is not a non-empty string, `ingredients` is not an array, or two elements share an `id`
- [x] `meals: []` **stays legal** — Phase 4 established an empty remote library as
      legitimate and `hermes-sync.js` already distinguishes it from a malformed blob.
      Do not regress that
- [x] `/planFlag` keeps Phase 4's generic plain-object check — the new validation is
      `/library`-only
- [x] **Shape only, no exclusion checks on `PUT`** — running `check()` here would let a
      rule tweak lock the user out of saving their own library. Comment it so it doesn't
      look like an oversight
- [x] `ponytail:` comment: field presence, not deep validation; tighten only if a real
      malformed write gets through

### 6. Wiring & verification

- [x] `index.html` — `<script src="exclusions.js">` **before** `mealdb.js`.
      `plan.html`/`shopping.html` deliberately don't get it (neither touches TheMealDB)
- [x] `sw.js` — add `"exclusions.js"` and `"substitutions.json"` to `SHELL` **and** bump
      `CACHE` to `"meal-planner-v5"`. `test.html` and `worker/` stay out of the shell
- [ ] `npx wrangler deploy`, then the curl smoke table (spec §9, all 12 rows): `/discover`
      no token ⇒ 401; `OPTIONS /discover` ⇒ 204 + four CORS headers; `PUT /discover` ⇒ 405;
      `?q=chicken` ⇒ 200 with well-formed meals; **`?q=mushroom` ⇒ no `"mushroom"` anywhere
      in the `meals` array**; no `q` ⇒ one random meal; `?q=zzzznotathing` ⇒ `meals: []`;
      `PUT /library {"meals":"nope"}` ⇒ 400; duplicate ids ⇒ 400; `meals: []` ⇒ 204;
      a real library ⇒ 204 and byte-identical round trip; `/planFlag` unchanged.
      **Not run** — no deployed environment/wrangler credentials available in this
      environment; the same 12 assertions (except the live-`fetch` details) were verified
      against `worker/worker.js` directly with a mocked TheMealDB + KV in Node. Run the
      real `npx wrangler deploy` + curl pass before relying on this in production
- [x] The `?q=mushroom` row is the one that proves the phase: if it ever returns a mushroom,
      the shared module is not actually being imported by the Worker — verified via the
      Node harness above (no mushroom in any returned/rejected *ingredient*; per spec §10
      a meal's *name* mentioning mushroom is not itself a failure, rules read ingredients)
- [ ] Manual pass: serve, open `index.html`, swipe the Discover deck — suggestions still
      appear, none contain mushroom, and a substituted card shows its swapped ingredient.
      **Not run** — no headless browser available in this environment. Run this before
      shipping
- [ ] Manual pass: from n8n (or curl standing in for it), run each row of the §7 contract
      end to end — discover → add to library → app pulls it; edit an ingredient → app
      pulls it; trigger phrase → banner appears on `plan.html`. **Not run** — depends on
      the live Worker deploy above and an n8n workflow that lives outside this repo
- [x] Mark Phase 5 complete in `docs/roadmap.md` and commit docs + code together
      (`.claude/rules/roadmap-gating.md`)

### 7. Docs

- [x] New `docs/HERMES.md` — the n8n-side contract (spec §7): the four capabilities mapped
      to their HTTP calls, request/response shapes, the `X-Auth-Token` requirement, and the
      note that URL and token live in n8n credentials and never in this repo. A contract,
      not a tutorial
- [x] Record in it that Hermes **never renders a plan as chat text** (`docs/OUTLINE.md:36-38`)
      and that KV is eventually consistent (~60s), so n8n must not read back a write to
      confirm it
- [x] `docs/FUTURE.md` — no `/coverage` endpoint. Revisit trigger: *if Hermes' coverage
      answers ever disagree with the plan page's banner, expose `MP.Nutrition.dayCoverage`
      as `GET /coverage` rather than teaching n8n the scoring rules*

### Deferred (do not build in this phase)

- [ ] Not built deliberately: a `/coverage` or `/nutrition` endpoint, `filter.php?i=`
      support on `/discover`, multiple substitution options per ingredient, substitutions
      for anything but mushroom, a `PUT /meal` delta endpoint, an ingredient-editing UI in
      the app, a third KV key, caching TheMealDB responses in the Worker, rate limiting
- [ ] The n8n workflow itself lives outside this repo and is not version-controlled here —
      `docs/HERMES.md` is the only record of the contract it depends on

## Phase 6 — Library CRUD & Browse cleanup

Spec: `.claude/specs/phase6_spec.md`. Logic tasks are TDD — write the check in
`test.html` first, watch it fail, then implement.

Read spec §0 first. Pure app-side work: **no Worker change, no new KV key, no new
dependency, no new JS file.** Delete/edit propagate to Hermes for free —
`MP.saveLibrary()` already stamps and fires `mp:library-saved`, which
`MP.Sync.start()` already listens for. Do not add a tombstone or any sync code.

The two traps this checklist exists to prevent, both silent data loss:
*an edit dropping the fields the form doesn't show* (§3d) and *a textarea
round-trip folding a non-numeric `qty` into the label* (§2), which would make
Phase 3's shopping list buy leftover chicken it already has.

### 1. Strip the duplicate Discover deck (do this first — it's a deletion)

- [x] `index.html` — delete lines 36–40, the `<section>` holding `#swipe-deck` and
      `.swipe-hint`. `discover.html` is the real Discover page (fan deck, `#fan-deck`,
      `discover.js`) and **nothing about it changes**
- [x] `app.js` — delete `discoverPool` (line 8), `excludeIds()` (104–108), `renderDeck()`
      (110–149), and the `MP.MealDB.getDiscoverPool` try/catch + `renderDeck()` call in
      `init()` (193–198). Keep `cardImageHtml`/`tagRowHtml`/`collectMealTags` —
      `renderLibrary` uses them
- [x] `index.html` — remove `<script src="swipe.js">` and `<script src="mealdb.js">`.
      **Do not delete either file**: `plan.js:198` uses `MP.makeSwipeable` and
      `discover.js` needs `mealdb.js`. Both stay in `sw.js`'s `SHELL`
- [x] Leave a one-line comment in `index.html`'s script block saying why this page no
      longer loads them, so it doesn't read as an oversight
- [x] `index.html` — keep `<script src="exclusions.js">` (§3c uses `MP.Exclusions.check`)
      and **add** `<script src="shopping-list.js">` (§2 needs `pack-sizes.json` keys;
      already in the SW shell since Phase 3)

### 2. Logic & Backend Tasks — the ingredient text format (TDD)

- [x] `data.js` — `MP.parseIngredients(text, knownKeys)` ⇒ `[{key, qty, label}]`.
      Two accepted line forms, tried in order: **`label — qty`** (em dash or spaced
      hyphen, split on the first occurrence) then **`<qty> label`** (leading quantity)
- [x] The leading-quantity tokeniser uses a `UNIT` regex allowlist
      (`g|kg|ml|l|tbsp|tsp|slices?|cans?|tins?|packs?|cloves?|handfuls?|bunch(es)?|pinch(es)?|rashers?|fillets?`).
      A bare `"500g"` with nothing after it is a **label**, not a qty
- [x] Emitted `qty` strings must stay parseable by `MP.ShoppingList.parseQty` — match its
      shapes (`"500g"`, `"2 slices"`, `"1-2"`), don't invent new ones
- [x] Key snapping, first hit wins: exact slug → singular/plural (`s` on/off) → **longest**
      known key that is a substring of the slug or vice versa → raw slug
- [x] **Never emit an empty `key`** — `data.js:77` does `ing.key.replace(...)` and throws
      on one. Empty slug ⇒ `"ingredient"`
- [x] `label` is stored **exactly as typed** (trimmed), not title-cased
- [x] `ponytail:` comment naming the ceiling: substring matching, not a synonym table —
      `"mince"` won't find `beef_mince`. Upgrade path is an `aliases` list in
      `pack-sizes.json`, not a fuzzier matcher
- [x] `data.js` — `MP.ingredientsToText(ingredients)` ⇒ one line per ingredient,
      `label — qty` when `qty` is non-empty else just the label, falling back to
      `labelize(key)` when `label` is absent
- [x] Check: `"500g chicken breast"` ⇒ `{key:"chicken_breast", qty:"500g"}`;
      `"2 slices white bread"` ⇒ `qty:"2 slices"`, `key:"white_bread"`
- [x] **Check: `"2 chicken breasts"` ⇒ `qty:"2"`** — *the unit-allowlist check; it fails
      the moment the parser treats any second token as a unit*
- [x] Check: `"1-2 tortillas"` ⇒ `{qty:"1-2", key:"tortillas"}`;
      `"Chicken Breast — leftover, sliced"` ⇒ `{key:"chicken_breast", qty:"leftover, sliced"}`
- [x] Check: `""` ⇒ `[]`; blank/whitespace-only lines dropped;
      `parseIngredients("zzz unknown thing", [])` ⇒ key `"zzz_unknown_thing"`, non-empty
- [x] **Check: every ingredient of every meal in `meals.json` round-trips —**
      `parseIngredients(ingredientsToText([ing]), keys)[0]` has the same `key` **and** the
      same `qty`. *The loudest check in this phase. `toastie-chicken-cheese`'s
      `{key:"chicken_breast", qty:"leftover, sliced"}` breaks first, and when it does,
      Phase 3's shopping list starts buying chicken it already has*

### 3. Logic & Backend Tasks — library mutation helpers (TDD)

- [x] `data.js` — `MP.upsertMeal(meal)` ⇒ new library array: replace by `id`, else append.
      Persists via `saveLibrary()` (stamp + `mp:library-saved`) — that, and nothing else,
      is the Hermes propagation
- [x] `data.js` — `MP.removeFromLibrary(mealId)` ⇒ new library array; absent id is a
      silent no-op. Also persists via `saveLibrary()`
- [x] Both **re-read `mp_library` from `localStorage` themselves** rather than trusting a
      caller-held array — same pattern as `addToLibrary` (`data.js:60`), and it is what
      makes Undo safe across a concurrent Hermes pull
- [x] `data.js` — `MP.findSimilarName(meals, name, ignoreId)` ⇒ first similar meal or
      `null`. Normalise `toLowerCase().replace(/[^a-z0-9]/g, "")`; match on equality, or
      containment where the shorter string is ≥ 4 chars; skip `ignoreId`
- [x] `ponytail:` comment: containment, not edit distance — `"Chilli"`/`"Chili"` won't
      match. Add a real distance function only if near-dupes actually pile up
- [x] Check: exact match ⇒ found; `"Chicken Fajitas"` vs `"chicken fajitas!"` ⇒ found;
      `"Chilli"` vs `"Roast Chicken"` ⇒ null; `ignoreId` on the only match ⇒ null;
      a 3-char substring name ⇒ null (the ≥ 4 floor)
- [x] Check `upsertMeal`/`removeFromLibrary` against a two-meal `mp_library` fixture,
      restoring the original value in a `finally`: upsert of an existing id replaces in
      place and does **not** grow the array; upsert of a new id appends; remove of an
      absent id is a no-op; `mp_library_updated_at` moves on all three
- [x] `test.html` — no new script tags needed (`data.js`, `exclusions.js`,
      `shopping-list.js` already included, `meals.json` already fetched)

### 4. UI & Layout Tasks — the shared Add/Edit form

- [x] `app.js` — `openForm(meal)` renders the form into the **existing** `#modal-sheet` /
      `#modal-overlay`; `meal === null` is Add mode, a library meal is Edit mode.
      `openDetail` keeps its read-only render
- [x] Fields: `#form-name` (text, required), `#form-description` (textarea rows=2),
      `#form-instructions` (textarea rows=6, the roadmap's "recipe"), `#form-ingredients`
      (textarea rows=6, placeholder showing both accepted line forms), four
      `.form-type` checkboxes (`breakfast`/`lunch`/`dinner`/`snack`), `#form-msg`,
      `#form-save` (`.btn`), `#form-cancel` (`.ghost`)
- [x] **Every prefilled value is set with `.value`/`.checked` after insertion**, never
      interpolated into the HTML string — library records hold untrusted TheMealDB text
- [x] Reuse `.sync-field` for the label+input pairs (`index.html:46-52` is exactly this
      shape); add `textarea` to the existing `.sync-field input` CSS rule rather than
      writing a new class
- [x] `app.js` — `readForm(original)` spreads `...(original || {})` **first**, then
      overwrites only `name`, `description`, `instructions`, `mealTypes`, `ingredients`
- [x] **`batchCook`, `leadsTo`, `leftoverOf`, `servings`, `prepEffort`, `image`, `source`
      and `id` must survive an edit untouched.** *Editing `roast-chicken`'s description
      must not break its batch-cook chain into `chicken-fajitas`*
- [x] **`id` is never recomputed on edit, even when the name changes** — a saved `mp_plan`
      references meals by `mealId`, and `leadsTo`/`leftoverOf` reference them by id
- [x] Add mode sets the downstream defaults: `id: "user-" + slug(name) + "-" +
      Date.now().toString(36)`, `source: "manual"`, `prepEffort: "quick"`,
      `batchCook: false` (`shopping-list.js`'s dinner dedupe reads it), `servings: 1`,
      `image: null`
- [x] Save step 1 — blank name ⇒ `#form-msg` `"A meal needs a name."`, stop. *Not
      cosmetic: the Worker's `libraryError()` 400s the whole library push if any meal has
      an empty `name`/`id`, which silently breaks sync for every other meal too*
- [x] Save step 2 — `MP.Exclusions.check(candidate)`; `!ok` ⇒ `#form-msg`
      `` `Can't save — ${reasons.join(", ")}.` `` and **stop**. Blocking, and it runs on
      **Edit as well as Add** — an edit can introduce a mushroom just as easily
- [x] Save step 3 — `MP.upsertMeal(candidate)`, `closeDetail()`, `renderLibrary()`,
      `toast('Saved "<name>"')`
- [x] Soft duplicate-name warning wired to the name field's `input` event:
      `MP.findSimilarName(library, name, original?.id)` ⇒ `#form-msg` via `textContent`,
      `Similar to "<name>" — add anyway if it's different.` **Never blocks Save**
- [x] `app.js` `init()` — add `MP.ShoppingList.load()` to the existing `Promise.all`;
      build `knownKeys` from `Object.keys(tagsData.tags)` + `Object.keys(packData.items)`,
      filtering out keys starting with `_` (drops `"_note"`). A failed fetch ⇒ `[]`,
      never a broken page init

### 5. UI & Layout Tasks — detail modal actions, delete + undo

- [x] `openDetail` gains a `.modal-actions` row under the instructions: `#detail-edit`
      (`.btn`, "Edit") and `#detail-delete` (`.ghost danger`, "Delete")
- [x] `#detail-edit` ⇒ `openForm(meal)` — re-renders the same sheet, no close/reopen flicker
- [x] `#detail-delete` ⇒ native `confirm(`Remove "<name>" from your library?`)`, then
      `MP.removeFromLibrary(meal.id)`, `closeDetail()`, `renderLibrary()`. No custom
      confirm dialog — that's a modal inside a modal for one yes/no
- [x] Undo: `toast(`Removed "<name>"`, "Undo", () => { library = MP.addToLibrary(meal);
      renderLibrary(); })`. `addToLibrary` is the right primitive — it re-reads storage,
      refuses on id collision, and `{prepEffort:"quick", ...meal}` preserves the record's
      own `prepEffort`
- [x] `app.js` — extend its local `toast(msg, actionLabel, onAction)`: message via
      `textContent`, button appended as a real element, timeout **1800ms** without an
      action and **6000ms** with one (1.8s is not long enough to tap Undo on a phone)
- [x] Extend **only** `app.js`'s copy — `toast` is triplicated (`discover.js:12`,
      `plan.js:17`); extracting a shared module is a refactor this phase didn't ask for.
      `ponytail:` comment saying so
- [x] `ponytail:` comment on the undo path: undo lives exactly as long as the toast —
      no trash, no history. Once it expires, the delete has already synced and is gone

### 6. UI & Layout Tasks — filter chips

- [x] `index.html` — `<button id="add-meal" class="btn">+ Add a meal</button>` beside the
      "Your Library" `<h2>`; click ⇒ `openForm(null)`
- [x] `index.html` — static `#library-filters .chip-row` between `#library-search` and
      `#library-grid`: five `<button class="chip" data-type="...">` for
      `""`/`breakfast`/`lunch`/`dinner`/`snack`, `All` carrying `.active`. Five static
      buttons need no JS to build
- [x] `app.js` — module-level `let activeType = ""`; one **delegated** `click` listener on
      `#library-filters` using `e.target.closest(".chip")`; sets `activeType`, toggles
      `.active` across the row, calls `renderLibrary()`
- [x] `renderLibrary()` — keep `MP.filterMeals(library, query)` and add one line:
      `.filter((m) => !activeType || (m.mealTypes || []).includes(activeType))`.
      **Do not push the type filter into `MP.filterMeals`** — it's tested (Phase 2) and
      does one job
- [x] Empty state, all four combinations, both interpolated values through `esc()`:
      blank+All ⇒ `Your library is empty.`; blank+type ⇒ `No <type> meals in your library
      yet.`; query+All ⇒ `No meals match "<q>".` (unchanged); query+type ⇒
      `No <type> meals match "<q>".`

### 7. Styling

- [x] `style.css` — `.chip-row` (flex, wrap, `gap: .4rem`), `.chip` (`.tag`'s metrics +
      `button.ghost`'s colours, bigger tap target ~2rem min-height), `.chip.active`
      (mirror `.nav a.active`: `--accent` background, white text)
- [x] `.sync-field textarea` — add `textarea` to the existing `.sync-field input` selector
      (style.css:356) rather than duplicating it; plus `resize: vertical` and
      `font-family: inherit` (textareas default to monospace)
- [x] `.modal-actions` (flex, `gap: .6rem`), `button.ghost.danger` (`--danger` colour and
      border), `#form-msg` (`.muted` metrics) + `#form-msg.error` (`--danger`),
      `.toast button` (transparent, `--accent`, bold, `margin-left: .75rem`)
- [x] All new rules use existing custom properties, dark mode first. No new CSS file, no
      framework, no icon font

### 8. Wiring & verification

- [x] `sw.js` — bump `CACHE` to `"meal-planner-v6"`. **No `SHELL` change** — no new file is
      added and `shopping-list.js` has been in the shell since Phase 3
- [x] Confirm no `manifest.json`, `worker/`, `docs/HERMES.md` or `docs/ARCHITECTURE.md`
      change is needed. The KV surface and the Worker's `KEYS` allowlist stay untouched
- [x] **Manual pass — the edit-preservation check: open `roast-chicken`, Edit, change only
      the description, Save, then confirm the stored record still has `batchCook: true`
      and its `leadsTo` array.** Do this before committing; it is the phase's one
      silent-data-loss failure mode
- [x] Manual pass: serve, open `index.html` — no Discover section; Add a meal with
      ingredients typed both ways; the near-dupe warning appears but doesn't block; a
      mushroom ingredient **is** blocked with a reason; chips + search narrow together;
      Delete confirms, removes, and Undo restores within the toast window
- [x] Manual pass: with Hermes sync configured, delete a meal and confirm the next
      `GET /library` no longer contains it — no new sync code should have been needed
- [x] Mark Phase 6 complete in `docs/roadmap.md` and commit docs + code together
      (`.claude/rules/roadmap-gating.md`)

### Deferred (do not build in this phase)

- [ ] Not built deliberately: bulk edit or multi-select delete; an image field/upload;
      editing `servings`/`batchCook`/`prepEffort`/`leadsTo` from the form (generator
      primitives — a different phase's decision); trash/undo history beyond the toast;
      per-field conflict resolution; plan cleanup when a referenced meal is deleted;
      a shared toast module; a synonym/alias table for ingredient keys; a structured
      ingredient-row editor; multi-select filter chips; any new endpoint, KV key or
      dependency
- [ ] Note only: `shelf-life.js` is loaded by `index.html` but unused by `app.js`. It
      predates this phase — leave it alone rather than pulling an unrelated cleanup in
- [ ] `docs/FUTURE.md` — an ingredient-key alias table (so `"mince"` finds `beef_mince`)
      is the upgrade path for §2's substring matcher. Revisit trigger: if hand-added meals
      keep landing in the shopping list's `unpriced` group

## Phase 7 — Mobile chrome & Discover filters

Spec: `.claude/specs/phase7_spec.md`. Logic tasks are TDD — write the check in
`test.html` first, watch it fail, then implement.

Read spec §0 first. Pure app-side work: **no Worker change, no new KV key, no new
dependency, no new JS file, no new CSS file, no change to the meal record.** Two
features that are the same piece of work twice — a horizontally scrollable strip
of pills — sharing one `.hscroll` utility class.

The two traps this checklist exists to prevent, both of which look fine in a
desktop preview: *a flex child that can't shrink doesn't scroll, it overflows the
page* (§4), and *two quick chip taps paint the slower response last* (§3).

Gate answers baked in below: chips are **TheMealDB categories**, a category is a
**random 12 of the whole list** (not the first 12), and the nav's **brand and
theme toggle stay pinned** while only the links scroll.

### 1. Logic & Backend Tasks — `mealdb.js` category pools (TDD)

- [x] `mealdb.js` — `MP.MealDB.sampleIds(list, limit, rnd)` ⇒ up to `limit` unique
      `idMeal` strings. Dedupe in input order, then **Fisher-Yates with a descending
      loop** (`for (let i = ids.length - 1; i > 0; i--)`), then `slice(0, limit)`
- [x] `rnd` defaults to `Math.random` and is injected **only** by `test.html` — it exists
      to make the shuffle checkable, not to be configured by callers
- [x] Not `sort(() => Math.random() - .5)` — that shuffle is biased and
      implementation-dependent, and Fisher-Yates is four lines either way
- [x] `mealdb.js` — `const CATEGORIES = ["Chicken","Beef","Seafood","Pasta","Pork","Lamb",
      "Vegetarian","Breakfast"]`, exported on `MP.MealDB`. Strings must match TheMealDB's
      category names **exactly, including capitalisation** — a typo silently returns an
      empty deck
- [x] Hardcoded, **not** fetched from `list.php?c=list`: that's a request on every cold
      load for a list that hasn't changed in years, and we want 8 of its 14 entries
- [x] **Delete `PER_INGREDIENT_LIMIT`** (`mealdb.js:13`). `POOL_LIMIT = 10` stays; add
      `CANDIDATE_LIMIT = 12` (the number of `lookup.php` calls per pool build)
- [x] `fetchPoolUncached(category)` — category branch: one
      `filter.php?c=<encodeURIComponent(category)>` ⇒ `sampleIds(d.meals || [],
      CANDIDATE_LIMIT)`. **No `.catch()` on this call** — a dead `filter.php` must reach
      `discover.js` as a network error, not as an indistinguishable empty deck
- [x] `fetchPoolUncached("")` — All branch: keep the five-ingredient `Promise.all` fan-out
      with its per-ingredient `.catch(() => [])`, but **stop slicing each result to 3**;
      concat all five lists and pass the lot through the same `sampleIds(..., 12)`
- [x] Everything after candidate selection is **unchanged**: the `lookup.php` fan-out,
      `toMeal`, `MP.Exclusions.sanitize`, `.slice(POOL_LIMIT)`, `.map(r => r.meal)`
- [x] `getDiscoverPool(excludeIds, category)` — new optional second argument, `""` or
      omitted = the liked-ingredient pool. Cache key becomes
      `` `${SS_POOL}:${category || ""}` `` — one cached pool per chip
- [x] Wrap the `sessionStorage.setItem` in a `try/catch` that swallows the error. Nine
      cached pools is ~300KB, but a quota/private-mode throw here currently takes down
      page load for a cache write we can simply skip
- [x] The `excludeIds` filter still runs **after** the cache read, unchanged — a cached
      pool must still hide meals liked or dismissed since it was fetched
- [x] **`toMeal`'s `mealTypes` mapping is unchanged** (`strCategory === "Breakfast"` ⇒
      `["breakfast"]`, else `["dinner"]`). Do not build a category→mealType table now that
      seven more categories can reach it
- [x] `test.html` — add `<script src="mealdb.js"></script>` **after** `exclusions.js`.
      `mealdb.js` only defines and exports at load (no fetch, no `sessionStorage` at module
      scope), so including it is inert
- [x] **Check: `sampleIds([{idMeal:"1"},{idMeal:"2"},{idMeal:"3"}], 2, () => 0.999999)` ⇒
      `["1","2"]`** — *the exact-permutation check. `rnd()` near 1 makes `j === i` at every
      step, so a correct descending Fisher-Yates returns input order. It fails if the loop
      is ascending, if `rnd` is ignored, or if `Math.random` was hardcoded*
- [x] Check: `sampleIds([{idMeal:"1"},{idMeal:"1"},{idMeal:"2"}], 5, () => 0.999999)` ⇒
      `["1","2"]` — dedupe by `idMeal`, first occurrence wins
- [x] **Check: set preservation** — for a 20-element list,
      `sampleIds(list, 20).slice().sort()` `deepEqual` the input ids sorted. *The shuffle
      must not drop, duplicate or invent an id; this is what catches a wrong swap*
- [x] Check: `sampleIds([], 5)` ⇒ `[]`; `sampleIds(list, 0)` ⇒ `[]`;
      `sampleIds(list3, 99)` ⇒ all 3 (a limit above the unique count is not an error)
- [x] Check: `toMeal({strCategory:"Pasta", …}).mealTypes` ⇒ `["dinner"]` and
      `strCategory: "Breakfast"` ⇒ `["breakfast"]` — guards the mapping above
- [x] Check: `deepEqual(MP.MealDB.CATEGORIES, ["Chicken","Beef","Seafood","Pasta","Pork",
      "Lamb","Vegetarian","Breakfast"])` — `test.html` can't reach `discover.html`'s DOM,
      so the chip/category parity is asserted from this side and eyeballed in §5

### 2. UI & Layout Tasks — the mobile nav strip

- [x] `index.html`, `discover.html`, `plan.html`, `shopping.html` — wrap **only** the four
      `<a>` elements in `<div class="nav-links hscroll">`. `<span class="brand">` and
      `<button id="theme-toggle">` stay **outside** the wrapper — that is what pins them
- [x] The `.active` class stays exactly where it is on each page; the four navs remain
      byte-identical to each other apart from it
- [x] `data.js` — two lines at the end of `initTheme()` (line 229-237, already called by
      all four page controllers):
      `const active = document.querySelector(".nav-links a.active");`
      `if (active) active.scrollIntoView({ inline: "nearest", block: "nearest" });`
- [x] **`block: "nearest"` is not optional** — without it `scrollIntoView` scrolls the
      document vertically too, and because `.nav` is `position: sticky` every phone page
      load jumps down past the header. `inline: "nearest"` is a no-op when the link
      already fits, so `index.html` and desktop are unaffected and no overflow check is needed
- [x] No `tabindex`, no `role="tablist"`, no arrow-key handling. The links stay real `<a>`
      elements in DOM order and browsers scroll a focused element into view natively

### 3. UI & Layout Tasks — Discover chips

- [x] `discover.html` — static `#discover-filters` with `class="chip-row hscroll"`, placed
      between the `<p class="muted">` hint and `<div class="fan-wrap">` (currently line 32):
      nine `<button class="chip" data-cat="...">` for `""` (All) plus the eight
      `CATEGORIES`, `All` carrying `.active`. Nine static buttons need no JS to build
- [x] `data-cat` values go straight into the `filter.php?c=` query, so they must match
      §1's `CATEGORIES` exactly. No script-tag change — `discover.html` already loads
      `data.js`, `exclusions.js`, `mealdb.js`, `discover.js`
- [x] `discover.js` — module-level `let activeCat = ""` and `let loadFailed = false`
- [x] `discover.js` — extract `async function excludeIds()` from `init()` (lines 202-207,
      moved verbatim) so a chip switch respects likes made since page load, rather than
      reusing a list captured at init
- [x] `discover.js` — `async function loadPool(cat)`: set `activeCat`/`loadFailed`, paint
      a static `<div class="swipe-empty">Loading suggestions…</div>` into `#fan-deck` and
      clear `#fan-progress`/`#fan-filmstrip`, then
      `await MP.MealDB.getDiscoverPool(await excludeIds(), cat)` in a `try/catch`
      (`catch` ⇒ `loadFailed = true`, `next = []`)
- [x] **`if (cat !== activeCat) return;` immediately after the await** — a slower earlier
      request must not paint over a newer chip's deck. Then `pool = next; idx = 0;
      renderDeck();`
- [x] `discover.js` — one **delegated** `click` listener on `#discover-filters` using
      `e.target.closest(".chip")`, mirroring `app.js:290`: toggle `.active` across the row,
      then `loadPool(chip.dataset.cat)`
- [x] Re-tapping the already-active chip is a **no-op** so swipe position is preserved —
      **except** when `loadFailed`, where a re-tap is the retry the error message asks for
- [x] `renderDeck()` empty state becomes three branches: `loadFailed` ⇒ `Couldn't reach
      TheMealDB — check your connection and tap the chip again.`; `activeCat` set ⇒
      `No more ${esc(activeCat)} suggestions — try another chip.`; otherwise the existing
      `📌 No more suggestions right now — check back later.` unchanged
- [x] `activeCat` goes through `esc()` even though it is our own static string — it is
      interpolated into `innerHTML`, and the house rule is about the sink, not the source
- [x] `discover.js` `init()` — replace the inline library/exclude/pool block (lines
      202-213) with `await loadPool("")`. `MP.initTheme()` and `renderSaved()` stay first
      and unchanged. The chip resets to `All` on every load; the per-chip session cache is
      what makes that cheap

### 4. Styling

- [x] `style.css` — the shared strip utility, **placed immediately after the `.chip` block
      (line 418)**: `.hscroll { flex-wrap: nowrap; overflow-x: auto; min-width: 0;
      scrollbar-width: none; -ms-overflow-style: none; }`,
      `.hscroll::-webkit-scrollbar { display: none; }`, `.hscroll > * { flex: 0 0 auto; }`
- [x] **Placement is load-bearing**: `.chip-row` sets `flex-wrap: wrap` at line 406 and
      `.hscroll` has identical specificity, so it only wins by coming later in the file
- [x] **`min-width: 0` is the declaration the mobile half lives or dies on** — without it
      the nav row grows past the viewport and the *page* scrolls sideways instead of the
      strip. It looks almost right in a desktop devtools preview
- [x] `style.css` base (mobile-first, matching the file's existing convention):
      `.nav .brand { display: none; }` (modify the rule at line 68),
      `.nav-links { display: flex; gap: .5rem; flex: 1 1 auto; }`,
      `.nav .icon-btn { flex: 0 0 auto; }`, and `white-space: nowrap` on `.nav a` (line 85)
- [x] Inside the **existing** `@media (min-width: 640px)` block at line 134:
      `.nav .brand { display: flex; }` and `.nav-links { flex: 0 1 auto; }`. These two
      lines exist to make the ≥640px nav **pixel-identical to today**
- [x] **Keep `margin-right: auto` on `.brand`** (line 70) — moving it to `.nav-links`
      changes the desktop layout for no reason
- [x] No `.chip` change — Phase 6 built it (`style.css:407-418`) and it is reused verbatim.
      No `#library-filters` change — five chips fit at phone widths; leave it wrapping
- [x] All new rules use existing custom properties, dark mode first. No new CSS file, no
      framework, no icon font, no scroll-snap or edge-fade affordances

### 5. Wiring & verification

- [x] `sw.js` — bump `CACHE` to `"meal-planner-v7"`. **No `SHELL` change** — no new file is
      added and all four pages plus `mealdb.js` are already cached
- [x] Confirm no `manifest.json`, `worker/`, `docs/HERMES.md`, `docs/ARCHITECTURE.md` or
      `meals.json` change is needed. This phase does not write to the meal record, which
      is why it sequences before Phase 8
- [ ] **Manual pass — the mobile nav, at 360px in devtools *and* on a real phone: the
      links scroll horizontally, the page itself does not scroll sideways, the theme
      toggle stays reachable, and opening `shopping.html` shows the Shopping tab already
      scrolled into view without the page jumping down.** The page-scrolls-sideways failure
      is the one a desktop preview hides. **Not run** — no headless browser available in
      this environment; the CSS/JS were verified by reading (`.hscroll`'s `min-width: 0`
      placement after `.chip-row`, `block: "nearest"` on `scrollIntoView`). Run before shipping
- [ ] Manual pass: `discover.html` — every chip loads a deck; the chip row scrolls rather
      than wrapping; swiping still likes/passes/saves; tapping two chips quickly leaves the
      **second** chip's deck on screen; re-tapping the active chip does not reset progress.
      **Not run** — same limitation; the stale-response guard and no-op logic were verified
      by code reading. Run before shipping
- [ ] Manual pass: a Vegetarian or Pasta deck shows meals that could not have come from the
      five hardcoded ingredients — that is the whole phase in one observation. **Not run**
- [x] Eyeballed every `data-cat` in `discover.html` against `MP.MealDB.CATEGORIES` — matches
      exactly (both lists: Chicken, Beef, Seafood, Pasta, Pork, Lamb, Vegetarian, Breakfast)
- [ ] Manual pass: airplane-mode a category chip ⇒ the connection message appears and
      re-tapping the chip retries; all four pages still render offline after one visit.
      **Not run**
- [ ] Manual pass: verify desktop (≥640px) nav is unchanged against a before screenshot —
      brand visible, links and toggle right-aligned. **Not run**
- [x] Mark Phase 7 complete in `docs/roadmap.md` and commit docs + code together
      (`.claude/rules/roadmap-gating.md`)

### Deferred (do not build in this phase)

- [ ] **Free-text search on Discover** — settled in the roadmap: the search box the outline
      mentions is the Library's, and none is being added here. The chips are how Discover
      is steered
- [ ] **The outline's "using what's left" chip** — needs pantry data; it belongs to
      Phase 11 and must not be pulled forward
- [ ] Nutrient-gap ranking of the pool is **Phase 10**, which depends on this phase having
      restructured how the pool is built. Do not rank here
- [ ] Not built deliberately: multi-select chips; persisting the last-used chip across
      visits; area/cuisine chips; fetching the category list from `list.php?c=list`;
      Dessert/Side/Starter/Goat/Vegan/Miscellaneous chips; a bottom tab bar or hamburger
      menu; scroll-snap or edge-fade affordances on either strip; making `#library-filters`
      scroll; infinite scroll or a "load more" button on the deck; any change to `.chip`
      styling, the meal record, `meals.json`, the Worker, or the dependency set
- [ ] Known asymmetry, accepted: an offline **All** chip shows the generic empty message
      rather than the connection one, because the five-ingredient fan-out catches its own
      per-ingredient failures by design. Reworking it into an all-or-nothing error path is
      not this phase's job

## Phase 8 — Meal image backfill

Spec: `.claude/specs/phase8_spec.md`. Logic tasks are TDD — write the check in
`test.html` first, watch it fail, then implement.

Read spec §0 first. Pure app-side work: **no schema change, no Worker change, no
new KV key, no new dependency, no new JS file, no new CSS file, no `meals.json`
edit.** Photos sync to Hermes for free — `hermes-sync.js:81` serialises the whole
meals array with no field allow-list, and `worker.js`'s `libraryError()` never
looks at `image`. Do not add sync or Worker code.

The three things this checklist exists to prevent: *Phase 6 deleted
`<script src="mealdb.js">` from `index.html`, so the whole feature is a silent
`TypeError` until it goes back* (§5); *an un-budgeted photo throws inside
`MP.saveLibrary`'s `setItem`, the modal closes, and the edit is gone* (§2, §3);
and *`readForm` is being changed, which is the function Phase 6 guarded against
dropping `batchCook`/`leadsTo` on an edit* (§3).

No Decision Gate was raised — the roadmap settled the architecture and the rest
are implementation defaults, listed in the spec's decisions table. The two most
overridable: the seed backfill is a **runtime button over the live library, not
a `meals.json` edit**, and the name lookup fires on the name field's **`change`
event, not on save**.

### 1. Logic & Backend Tasks — `mealdb.js` lookup by name (TDD)

- [x] `mealdb.js` — `MP.MealDB.thumbFromSearch(data, name)` ⇒ thumbnail URL or `null`.
      `(data && data.meals) || []`, then: the first result whose normalised `strMeal`
      equals the normalised `name` **and** has a `strMealThumb`, else the first result
      with any `strMealThumb`, else `null`
- [x] Normalise with `String(s).toLowerCase().replace(/[^a-z0-9]/g, "")` — the same rule
      as `MP.findSimilarName`, **deliberately duplicated rather than imported**:
      `mealdb.js` is imported by `worker/worker.js`, which never loads `data.js`
- [x] `mealdb.js` — `async function imageByName(name)` ⇒ `Promise<string|null>`.
      Blank/whitespace name ⇒ `null` **with no fetch**; otherwise
      `search.php?s=${encodeURIComponent(name.trim())}` ⇒ `thumbFromSearch(data, name)`
- [x] **`.catch(() => null)` on the fetch** — every caller is a UI event handler, so this
      must never throw. A dead network and no match are the same outcome here, and that
      is correct: the manual attach is the fallback either way
- [x] One request, **no `lookup.php` N+1** — `search.php?s=` returns full detail objects,
      the same shape `lookup.php?i=` returns, so `strMealThumb` is already in the body
      (same reason Phase 5's `/discover` route uses it)
- [x] No caching layer. These are one-shot user-initiated calls; a `sessionStorage` cache
      would be state to invalidate for no measured gain
- [x] **No `MP.Exclusions` call and no fallback searches.** Nothing from TheMealDB enters
      the library — only a URL string lands on a meal the user already owns. Comment both
      so neither reads as an oversight against the Phase 5 invariant
- [x] `ponytail:` comment naming the ceiling: exact-then-first, no fuzzy matching. Upgrade
      path is a similarity floor on `strMeal`, not a cleverer query
- [x] Export both on the module surface:
      `{ toMeal, load, getDiscoverPool, sampleIds, CATEGORIES, imageByName, thumbFromSearch }`
- [x] `test.html` — no new script tags needed (`data.js` and `mealdb.js` are both already
      included). New check group 27
- [x] Check: `thumbFromSearch({meals: null}, "x")` ⇒ `null` — *the no-match shape.
      `search.php` returns `meals: null`, not `[]`, and getting it wrong throws on `.find`*
- [x] Check: `thumbFromSearch(null, "x")` ⇒ `null`; `thumbFromSearch({}, "x")` ⇒ `null`
- [x] Check: `{meals:[{strMeal:"A",strMealThumb:""},{strMeal:"B",strMealThumb:"b.jpg"}]}`
      with name `"z"` ⇒ `"b.jpg"` — first result **with a thumb**, not first result
- [x] **Check: `{meals:[{strMeal:"Chilli prawn linguine",strMealThumb:"wrong.jpg"},
      {strMeal:"chilli!",strMealThumb:"right.jpg"}]}` with name `"Chilli"` ⇒
      `"right.jpg"`** — *the exact-match preference plus its case/punctuation
      normalisation. It fails the moment someone simplifies this to "take the first"*
- [x] Check: `{meals:[{strMeal:"Chilli"}]}` with name `"Chilli"` ⇒ `null` — an exact name
      match with no thumbnail is still no thumbnail
- [x] **Check: `esc("data:image/jpeg;base64,/9j/4AAQSkZJRg+ab/cd=")` comes back
      unchanged** — *the data-URL survival check. `esc` is provably a no-op on base64
      today; this fails if it is ever "improved" into something URL-encoding, which would
      break every stored photo at once and only on screen*
- [x] Check: `esc('data:image/jpeg;base64,AAA" onerror="x')` contains `&quot;` and no raw
      `"` — the escaping still does its real job on a data-URL-shaped string
- [x] Check: every meal in `meals.json` has `image === null` or a non-empty string

### 2. Logic & Backend Tasks — the downscale pipeline (`app.js`)

- [x] `app.js` — `async function shrinkImage(file)` ⇒ `Promise<string>` (a JPEG data-URL),
      rejecting with `Error("not-an-image" | "too-big" | "decode-failed")`. Short
      machine-readable messages, mapped to user copy in one `IMAGE_ERRORS` object
- [x] Lives in `app.js`, **not** `mealdb.js` or `data.js` — only the form uses it and it
      needs `document`; `mealdb.js` must stay Worker-importable
- [x] Constants: `MAX_DIM = 640`, `QUALITIES = [0.72, 0.6, 0.5, 0.4]`, `MAX_CHARS = 70000`,
      `MAX_FILE_BYTES = 20 * 1024 * 1024`
- [x] Guards first, before any decode: `!file.type.startsWith("image/")` ⇒ `"not-an-image"`;
      `file.size > MAX_FILE_BYTES` ⇒ `"too-big"`. **`accept="image/*"` is a picker hint,
      not validation** — Android hands back whatever it likes
- [x] `URL.createObjectURL(file)` + `new Image()`, **not `FileReader`** — one fewer async
      hop and it never materialises the full-size original as base64 in memory.
      `URL.revokeObjectURL` in a `finally`
- [x] `img.onerror` ⇒ `"decode-failed"`. *This is the likely real failure: an iPhone
      `.heic` does not decode in Chrome*
- [x] `scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight))`, draw
      to a canvas at the rounded scaled dimensions. Never upscale
- [x] **Quality ladder, not a fixed quality**: return the first
      `canvas.toDataURL("image/jpeg", q)` whose `.length <= MAX_CHARS`. JPEG size depends
      on image content, not dimensions — a flat plate at 640/0.72 is ~25KB and a busy
      photo is ~200KB, so any single fixed quality either looks bad or overruns the quota
- [x] If none fits: redraw at half those dimensions and return
      `toDataURL("image/jpeg", 0.5)` **unconditionally**. `ponytail:` comment naming the
      two-pass ceiling — upgrade path is a binary search on quality, not a third pass
- [x] Comment why `MAX_CHARS = 70000`: base64 is 4/3 of the bytes, so ≈51KB of JPEG (the
      roadmap's "roughly 50KB"); `localStorage` is UTF-16, so ~137KB of quota per photo and
      ~2MB for all 14 seed meals against a ~5MB origin quota
- [x] Comment that **no EXIF handling is needed** — current browsers default `<img>` to
      `image-orientation: from-image` and `drawImage` honours it, so a portrait phone photo
      lands upright. Say it out loud so nobody adds an EXIF parser (a dependency)
- [x] **No `catch {}` anywhere in this pipeline.** Every throw path is surfaced in
      `#form-msg` — the point of the phase is that the user knows whether their photo took
- [x] Not checkable in `test.html` (needs a real decoded image and a canvas) — its budget
      is verified in §5's manual pass instead

### 3. UI & Layout Tasks — the photo field on the add/edit form

- [x] `app.js` `openForm` — new block in the template string between the Ingredients
      `<label>` (lines 167-169) and the Meal types `<div>` (line 170):
      `<div class="sync-field">Photo`, an `<img id="form-image-preview" class="form-photo
      hidden" alt="">`, and a `<div class="form-photo-row">` holding
      `<input type="file" id="form-image" accept="image/*">` and
      `<button id="form-image-clear" class="ghost hidden">Remove photo</button>`
- [x] A `<div class="sync-field">`, not a `<label>` — same reason the meal-types block
      above it is a `<div>` (a `<label>` wrapping two controls is ambiguous)
- [x] **No `capture` attribute** — it forces the camera and removes "choose from gallery",
      which is the more common path for a meal photo
- [x] `app.js` — module-level `let formImage = null;` beside `activeType`. The file input
      cannot be prefilled and the preview's `src` is not a reliable store, so the pending
      value lives in a variable
- [x] `openForm` sets `formImage = meal ? meal.image || null : null;` first thing, and
      calls a local `showImage()` once at the end
- [x] `showImage()` — the single place that renders `formImage`: `preview.src = formImage`
      **as a property, never interpolated into `innerHTML`**, and `.hidden` toggled on both
      the preview and the clear button by `!!formImage`
- [x] `readForm` — **one** new line in the overwrite block, after `ingredients`:
      `image: formImage,`. It goes in the overwrite block, not the `original ||` defaults
      block (whose existing `image: null` stays for Add mode's shape)
- [x] **This is the one field Phase 6 froze that is now deliberately writable.**
      `batchCook`, `leadsTo`, `leftoverOf`, `servings`, `prepEffort`, `source` and `id` are
      still preserved by the spread and must stay that way
- [x] `#form-image` `change` listener: bail on no file; `#form-msg` ⇒ `"Shrinking photo…"`;
      `await shrinkImage(file)` in a `try/catch` setting `formImage` or the mapped error;
      then **`fileIn.value = ""`** (so re-picking the same file fires `change` again) and
      `showImage()`
- [x] `IMAGE_ERRORS` copy: `not-an-image` ⇒ `"That file isn't an image."`; `too-big` ⇒
      `"That photo is too large — try one under 20MB."`; `decode-failed` ⇒ `"Couldn't read
      that image. iPhone HEIC photos often need converting to JPEG first."`; `default` ⇒
      `"Couldn't use that image."`. **The HEIC hint is not padding** — it is the most
      likely real failure and without it the message is unactionable
- [x] `#form-image-clear` click ⇒ `formImage = null; fileIn.value = ""; showImage();`
      Nothing is persisted until Save, so this is not a delete
- [x] `nameInput` **`change`** listener (a *second* listener — the existing `input` listener
      at line 194 keeps doing the near-dupe check and is not touched): return early if
      `formImage` is already set, else `await MP.MealDB.imageByName(nameInput.value)` and
      set + `showImage()` on a hit
- [x] **`input` would fire a TheMealDB request per keystroke.** `change` fires on
      blur/commit, so the platform does the debouncing
- [x] **Re-check `!formImage` after the `await`** before assigning — the user can pick a
      photo while the lookup is in flight, and their choice must win
- [x] Never re-look-up when an image already exists: a name edit must not clobber a photo.
      The escape hatch is Remove photo, then re-commit the name
- [x] **`saveForm` — wrap `library = MP.upsertMeal(candidate)` in a `try/catch`**; on throw,
      `#form-msg.error` ⇒ `"Couldn't save — browser storage is full. Remove a photo from
      another meal and try again."` and **`return` with the modal still open**
- [x] *Why it is not optional:* `MP.saveLibrary` (`data.js:41-45`) calls `setItem`
      unguarded, and photos are the first thing in this app big enough to hit the quota.
      Without the guard the modal closes, the toast says `Saved "X"`, and nothing was saved
- [x] **Do not "fix" this in `data.js`** by swallowing the error there — a silent
      `saveLibrary` would break Hermes sync everywhere else too. The guard belongs where a
      human can act on it
- [x] Nothing else in `saveForm` changes: the blank-name check and `MP.Exclusions.check`
      still run first, and **no lookup runs on save** — an offline save must never hang

### 4. UI & Layout Tasks — the backfill button

- [x] `index.html` `.section-head` (lines 31-34) — `<button id="backfill-images"
      class="ghost">Find images</button>` before `#add-meal`. Ghost, not `.btn`: it is the
      secondary action next to Add
- [x] `app.js` — `async function backfillImages(btn)`, wired in `init()` beside the other
      listeners (line 288). Only ever writes into an empty field; it cannot overwrite a photo
- [x] `const missing = library.filter((m) => !m.image)` — `!m.image` catches `null` **and**
      `""`. Empty ⇒ `toast("Every meal already has an image.")` and no requests
- [x] `btn.disabled = true` and a `btn.textContent` counter (`Looking up 3/9…`) as it goes —
      `textContent`, never `innerHTML`. Restore both in a `finally`
- [x] **Sequential `for...of`, not `Promise.all`** — nine parallel requests at a free public
      API for a once-pressed button is rude for no benefit; the user watches a counter
      either way. `imageByName` returns `null` on failure, so no `try/catch` in the loop
- [x] Collect hits in a `Map` keyed by meal id, then **one write, not N**: re-read the
      library from storage, `.map` the matched ids to `{ ...m, image: found.get(m.id) }`,
      and call `MP.saveLibrary(library)` **once**, inside a `try/catch` that toasts the
      quota message
- [x] **Re-read rather than trusting the module-level `library` array** — a Hermes pull can
      land during a nine-request loop. Same reasoning that made Phase 6's `upsertMeal`
      re-read storage
- [x] Calling `MP.upsertMeal` per hit would fire `mp:library-saved` nine times and push
      nine times to KV. Don't
- [x] Finish with `renderLibrary()` and `toast(`Found ${found.size} of ${missing.length}
      images.`)` — **including when `found.size === 0`**, which is a real and expected
      outcome for names like *Chorizo & Pasta*
- [x] **No automatic version of this.** The lookup never runs on page load: nine outbound
      requests every visit, to fill a field that is allowed to be empty, is the kind of
      background work that becomes a mystery when TheMealDB is slow

### 5. Styling, wiring & verification

- [x] `style.css` — append after the `.sync-field` block (lines 355-374):
      `.form-photo { display: block; width: 100%; max-height: 10rem; object-fit: cover;
      border-radius: .6rem; margin-top: .4rem; }`,
      `.form-photo-row { display: flex; align-items: center; gap: .6rem; margin-top: .4rem; }`,
      `.form-photo-row input[type="file"] { font-size: .85rem; color: var(--text-dim); }`
- [x] **The file-input override is why the row exists:** the existing
      `.sync-field input, .sync-field textarea` rule (line 360) sets `width: 100%` and a
      padded box, which makes a file input look like a broken text field
- [x] **No `.card-img` change** — it already sets `aspect-ratio: 16/9; object-fit: cover`
      (lines 159-164), so a 640px data-URL renders exactly like a TheMealDB thumbnail.
      All new rules use existing custom properties, dark mode first. No new CSS file
- [x] **`index.html` — put `<script src="mealdb.js"></script>` back**, after `exclusions.js`
      and before `app.js`. *Phase 6 deleted it; without it the whole feature is a silent
      `TypeError` inside a `change` handler that nobody ever sees*
- [x] **Rewrite the Phase 6 comment at lines 72-73** — `swipe.js` is still deliberately not
      loaded here, `mealdb.js` now is, and the comment must say why so the next cleanup
      doesn't delete it again
- [x] `sw.js` — bump `CACHE` to `"meal-planner-v8"`. **No `SHELL` change** — no new file is
      added and `mealdb.js` has been in the shell since Phase 1
- [x] Confirm no `manifest.json`, `worker/`, `docs/HERMES.md`, `docs/ARCHITECTURE.md` or
      `meals.json` change is needed. The KV surface, the Worker's `KEYS` allowlist and
      `libraryError()` stay untouched — photos sync as a side effect of the existing
      whole-array serialisation
- [ ] **Manual pass — the budget: attach a real phone photo, then check the stored `image`
      string length in devtools is ≤ 70 000, the preview is upright (not rotated 90°), and
      the card thumbnail is not visibly worse than a TheMealDB one.** `test.html` cannot
      cover this; it is the phase's core claim **Not run** — no headless browser available in this environment; the logic was verified by reading and by the pure-function checks in test.html. Run before shipping.
- [ ] **Manual pass — the edit-preservation check, re-run because `readForm` changed: open
      `roast-chicken`, attach a photo, Save, confirm the stored record still has
      `batchCook: true` and its `leadsTo` array.** Phase 6's silent-data-loss failure mode **Not run** — no headless browser available in this environment; the logic was verified by reading and by the pure-function checks in test.html. Run before shipping.
- [ ] Manual pass: press "Find images" with the 9 null-image meals present — the counter
      advances, the toast reports honestly, no existing image is overwritten **Not run** — no headless browser available in this environment; the logic was verified by reading and by the pure-function checks in test.html. Run before shipping.
- [ ] Manual pass: type a name TheMealDB definitely has (e.g. *Beef Wellington*) into a new
      meal and tab out — the preview appears without touching the file picker **Not run** — no headless browser available in this environment; the logic was verified by reading and by the pure-function checks in test.html. Run before shipping.
- [ ] Manual pass: airplane mode — committing a name is a silent no-op with no hang, and
      saving a meal still works normally **Not run** — no headless browser available in this environment; the logic was verified by reading and by the pure-function checks in test.html. Run before shipping.
- [ ] Manual pass: pick a non-image file and a >20MB file — both are refused with their own
      message and nothing is set **Not run** — no headless browser available in this environment; the logic was verified by reading and by the pure-function checks in test.html. Run before shipping.
- [ ] Manual pass: with Hermes sync configured, attach a photo and confirm the next
      `GET /library` carries the data-URL — no sync code should have been needed **Not run** — no headless browser available in this environment; the logic was verified by reading and by the pure-function checks in test.html. Run before shipping.
- [x] Mark Phase 8 complete in `docs/roadmap.md` and commit docs + code together
      (`.claude/skills/roadmap-gating/`)

### Deferred (do not build in this phase)

- [x] **No `meals.json` edit.** `meals.json` is only the first-run seed; the real library
      lives in `localStorage`/KV, so committing thumbnail URLs would fix a library nobody
      is using. The §4 button fixes both, and a fresh seed identically
- [x] **Images on the plan page belong to Phase 9**, which is sequenced after this one
      precisely so it can assume the library has images. Do not pull it forward
- [x] Accepted, with a `ponytail:` ceiling comment: the name search is a substring match, so
      *Chilli* can return *Chilli prawn linguine*'s photo. The image is visible in the form
      before saving and in the grid after, and Edit → Remove photo is one tap. Add a
      similarity floor only if wrong photos actually turn up
- [x] Accepted, with a `ponytail:` ceiling comment: `renderLibrary` interpolates data-URLs
      into one injected HTML string (~630KB for 9 photos, re-escaped on every search
      keystroke). Upgrade path is assigning `.src` after insertion — not this phase's job
- [x] Not built deliberately: an automatic lookup on page load or on save; progressive/fuzzy
      name search or a second query with fewer words; caching `search.php` responses;
      running `MP.Exclusions` over a name-lookup result; cropping, rotation, filters or any
      image-editing UI; a `capture` attribute; multiple photos per meal; a separate
      thumbnail/full-size pair; an EXIF parser; WebP/AVIF output; IndexedDB or the Cache API
      for images; uploading to R2 or a CDN; image validation or a field allow-list in the
      Worker; excluding photos from the Hermes payload; a placeholder-image generator; any
      change to `.card-img`, `discover.js`, `generator.js`, the meal schema, the Worker, or
      the dependency set

## Phase 9 — Expanded plan day view

Spec: `.claude/specs/phase9_spec.md`. A day tap opens a new bottom sheet showing all four
slots for that day — thumb, name, description, tags, ingredients, shelf-life warning — and
each slot gets a Swap button into the **unchanged** `openSwapPicker`. No schema change, no
new dependency, no new file, no change to the swipe deck.

### Logic & Backend Tasks (TDD — write the check first)

- [x] `test.html` check group **28** (next free number after 27; the file reuses 23/24
      mid-file — do not renumber): `MP.ShelfLife.checkPlanWarnings` over a hand-built plan
      returns a key that is exactly `` `${day}-${slotType}` ``, its value has a string
      `message` and a number `moveToDay`, `moveToDay` is in `1..14` and `!== day`, and a safe
      slot's key is `undefined` (not `null`/`{}`). This is the one contract two independent
      render paths now share, and a mismatch fails silently
- [x] `test.html` group 28: every meal in `meals.json` has an `ingredients` array — the day
      view calls `ingredientListHtml` for all four slots, not just the tapped meal
- [x] `plan.js` — promote `warnings` to module scope (`let warnings = {};` beside `plan`,
      line 15) and change `renderPlan`'s `const warnings = ...` (line 78) to a plain
      assignment. Do **not** recompute `checkPlanWarnings` in the day view
- [x] `plan.js` — extract `warningHtml(day, slotType, warn)` from the inline string at line
      104 (returns `""` when `!warn`); route line 104 through it. Output must be byte-identical
- [x] `plan.js` — extract `ingredientListHtml(meal)` from `openDetail` lines 220-222; call it
      from `openDetail`'s `<ul>` and delete the local `ingredientsHtml` const
- [x] `plan.js` — extract `wireMoveBtns(scope)` from lines 121-126 (`root` → `scope`, keep
      `e.stopPropagation()`); `renderPlan` calls `wireMoveBtns(root)`
- [x] `plan.js` — extract `dayHeading(day)` from lines 92-94; `renderPlan` calls it
- [x] `plan.js` — `candidatesFor` (line 143) null-slot guard: `const slot = plan.days[day-1]
      .slots[slotType]; const currentId = slot ? slot.mealId : null;` — `mealAt` already
      guards this exact access, `candidatesFor` does not, and this phase puts an "Add a meal"
      button directly on that path
- [x] `plan.js` — `let dayCtx = null;` plus `openDayView(day)` / `closeDayView()` /
      `renderDayView()` in a new `// ---- Expanded day view ----` section (spec §2c). No
      `sheet.scrollTop` reset on repaint
- [x] `plan.js` — **the entry point**: `.slot-card` click handler (lines 115-120) calls
      `openDayView(Number(el.dataset.day))` instead of `openSwapPicker`. Keep the
      `e.target.closest(".move-btn")` guard; leave the now-unread `data-slot` attribute alone
- [x] `plan.js` — one line at the end of `renderPlan()`: `if (dayCtx) renderDayView();`
      This is the **only** refresh mechanism — do not add refresh calls to `moveSlot` or to
      `renderSwapCards`'s `onSwipeRight`; both already call `renderPlan`
- [x] `plan.js` — `init()`: backdrop listener on `#day-overlay` → `closeDayView()`, matching
      the two existing overlay listeners (lines 253-257)
- [x] Confirm untouched: `openSwapPicker` internals (154-158), `closeSwapPicker`,
      `renderSwapDeck`, `renderSwapCards` (including the `plan.js:210` `openDetail` call from
      the swipe deck), `moveSlot`, and `renderPlan`'s day-cell HTML apart from the helper
      call-throughs

### UI & Layout Tasks (visual, no TDD)

- [x] `plan.html` — add `<div id="day-overlay" class="modal-overlay hidden"
      style="z-index:40;"><div id="day-sheet" class="modal-sheet"></div></div>` immediately
      before `#swap-overlay` (line 41). **z-index 40 is load-bearing**: base overlay is 50 and
      detail is 60, so the day sheet must sit beneath both. No script tag changes
- [x] `plan.js` — `daySlotHtml(day, slotType)` (spec §2d): `.slot-type` label, then either the
      filled block (4rem thumb or 🍽 placeholder + name + description, `tagRowHtml(meal)`,
      `leftoverOf` note, ingredient list, `warningHtml`, **Swap** + **Recipe** buttons) or the
      empty block (`.muted` "Nothing planned." + **Add a meal**). `alt=""` on the thumb — the
      name is right beside it
- [x] `plan.js` — `renderDayView` wires `.day-swap-btn` → `openSwapPicker(day, b.dataset.slot)`
      and `.day-recipe-btn` → `openDetail(meal)`, plus `wireMoveBtns(sheet)` and the `.close-btn`
- [x] `esc()` every `meal.name`, `meal.description`, `meal.image`, ingredient label and
      `warn.message`. `slotType` is interpolated raw (module constant, as at line 102)
- [x] `style.css` — widen two existing selectors rather than copying their bodies:
      `.slot-card .slot-type, .day-slot .slot-type` (line 486) and
      `.slot-card .slot-warning, .day-slot .slot-warning` (line 493)
- [x] `style.css` — append the 9 new rules after `.ingredient-list` (line 315). **Specificity
      traps**: `.modal-sheet .day-thumb` (not `.day-thumb`) or `.modal-sheet img`'s
      `width:100%; aspect-ratio:16/9; margin-bottom:1rem` wins and the thumb renders as a
      full-width hero; `.day-slot .day-slot-note` (not `.day-slot-note`) or `.day-slot p` wins.
      Existing custom properties only, no new CSS file, no media query
- [x] No new scroll container — `.modal-sheet` is already `max-height:88vh; overflow-y:auto`
      with a sticky close button

### Wiring & verification

- [x] `sw.js` — bump `CACHE` to `"meal-planner-v9"`. No `SHELL` change (no new file)
- [x] Confirm no change to `index.html`, `discover.html`, `shopping.html`, `app.js`,
      `discover.js`, `generator.js`, `shelf-life.js`, `data.js`, `worker/`, `meals.json`,
      `manifest.json`, `docs/HERMES.md`, `docs/ARCHITECTURE.md`
- [ ] Manual: tap a slot → all four slots shown + the day coverage line; sheet scrolls with a
      pinned ✕
- [ ] Manual: **Swap** opens the picker *over* the day sheet (day sheet still visible behind);
      confirming a swap closes only the picker and the day sheet repaints with the new meal,
      its ingredients and an updated coverage line
- [ ] Manual: **Recipe** opens the detail sheet above both; closing it returns to the day view
- [ ] Manual: **Move to day** inside the day sheet toasts, updates the grid behind, and leaves
      the sheet open; the grid's own Move buttons still work and do **not** open the day view
- [ ] Manual: an empty slot shows "Nothing planned." + **Add a meal** and opens the picker with
      no console error (the §2f guard)
- [ ] Manual on phone width: thumbs are 4rem squares (not heroes), placeholder tiles align with
      real photos, backdrop tap and ✕ both close
- [x] `docs/roadmap.md` Phase 9 ⇒ `(Status: Complete)` in the same commit as the code
- [x] Not built: editing/deleting a meal from the day view, drag-and-drop, cook/ate actions
      (Phase 12), day-to-day swipe inside the sheet, a `?day=N` route or history state,
      accordions, inline instructions, per-day shopping list, serving maths, per-slot nutrition
      beyond the existing coverage line, a shared `MP.cardImageHtml` + the `app.js`/`discover.js`
      dedupe (a `/simplify` candidate), Escape-key handling or focus traps, making `.slot-card`
      a real `<button>`, or any change to `openSwapPicker`'s internals, the swipe deck,
      `generator.js`, the meal schema, the Worker, or the dependency set

## Phase 10 — Nutrient-gap-aware Discover

Spec: `.claude/specs/phase10_spec.md`. Discover's pool is reordered by the nutrients the
liked-meal library under-covers — a **second caller** of `MP.Nutrition.dayCoverage` +
`rankByGap`, wired exactly as `plan.js`'s swap suggestions already wire them. No schema
change, no new dependency, no new file, no `nutrition.js`/`mealdb.js`/`exclusions.js` edit,
no `style.css` change, no change to the swipe deck.

### Logic & Backend Tasks (TDD — write the check first)

- [x] `test.html` check group **29** (next free number after 28; the file reuses 23/24
      mid-file — do not renumber): `MP.Nutrition.rankByGap` returns a **permutation, never a
      filter** — same length and same set of `id`s as the input, for a non-empty gap list, an
      empty gap list, and candidates matching no gap. A dropped candidate shows up only as a
      deck that runs out early
- [x] `test.html` group 29: `rankByGap` actually orders — with `gaps: ["iron"]` and two
      candidates where only the second has a `high`-iron ingredient, the second comes back first
- [x] `test.html` group 29: a candidate with `ingredients: []` scores 0 and does **not** throw
      (a TheMealDB record whose measures all parse away yields an empty list)
- [x] `test.html` group 29: `dayCoverage` over the **entire** seed library as one meal set
      returns `missing` and `partial` arrays that are subsets of `TRACKED_NUTRIENTS` and are
      **disjoint** — the deck concatenates them, so an overlap double-weights a nutrient
- [x] `test.html` group 29: `MP.labelize` returns a non-empty string for every entry of
      `MP.Nutrition.TRACKED_NUTRIENTS` — otherwise the note line renders raw `vitB12`
- [x] `discover.js` — add `libraryGaps()` beside `excludeIds()` (line 206): `Promise.all`
      of `MP.getLibrary()` + `MP.Nutrition.load()`, then
      `dayCoverage(library, nut.tags, nut.targets)` → `[...missing, ...partial]`. Wrap the
      whole body in `try`/`catch` returning `[]` — **a nutrition failure must degrade to
      today's unordered deck, never to an empty deck or a thrown init**
- [x] `discover.js` — `loadPool` (218-235): `const [ids, g] = await Promise.all([excludeIds(),
      libraryGaps()])` (one cached `getLibrary` fetch, two awaits), then
      `getDiscoverPool(ids, cat)`, then `if (gaps.length) next = MP.Nutrition.rankByGap(next,
      gaps, (await MP.Nutrition.load()).tags)` — the second `load()` hits `nutrition.js`'s
      cache, no second fetch
- [x] `discover.js` — **the trap**: rank the local `next`, **before** the
      `if (cat !== activeCat) return;` stale-response guard (line 231), and never assign to the
      module-level `pool` from inside the ranking step — that reinstates the race the guard exists
      to kill
- [x] `discover.js` — `ponytail:` comment on the rank call naming the ceiling: this reorders
      the 10 `POOL_LIMIT` already picked, it does not widen the pick; raise `POOL_LIMIT` if the
      top card stops feeling gap-relevant
- [x] Confirm untouched: `nutrition.js` (all four exports byte-identical), `mealdb.js`
      (`getDiscoverPool`, `toMeal`, `POOL_LIMIT`, the exclusion chain 142-148), `exclusions.js`,
      and `discover.js`'s `decide`, `renderDeck`, `cardInner`, `cardImageHtml`, `makeDraggable`,
      filmstrip, saved pile and chip handler (237-244)

### UI & Layout Tasks (visual, no TDD)

- [x] `discover.html` — **the load-bearing line**: `<script src="nutrition.js"></script>`
      between `data.js` (line 66) and `exclusions.js` (line 67). Without it `MP.Nutrition` is
      undefined, `libraryGaps`'s `catch` swallows it, and the phase silently never happens
- [x] `discover.html` — `<p class="muted" id="gap-note" style="text-align:center;"></p>` after
      the `#discover-filters` row (line 43), before `.fan-wrap` (line 44). Reuses `.muted` and
      the sibling paragraph's inline centring — **no new CSS rule, no `style.css` change**
- [x] `discover.js` — `renderGapNote(gaps)`: `el.textContent = top ? \`Ranked to fill: ${top}\`
      : ""` where `top` is `gaps.slice(0, 3).map(MP.labelize).join(", ")`, plus
      `el.hidden = !top`. `textContent`, not `innerHTML`. Top 3 only — a day-one library can be
      missing 8 of 11 nutrients and an eight-item list above the deck is noise
- [x] `discover.js` — call `renderGapNote(gaps)` **after** the stale-response guard, beside
      `renderDeck()`, so an abandoned chip's load never paints the note
- [x] `discover.js` — `MP.labelize` is not in line 6's destructure (`esc` only); either add it
      there or call it qualified

### Wiring & verification

- [x] `sw.js` — bump `CACHE` to `"meal-planner-v10"`. **No `SHELL` change**: `nutrition.js`
      (13), `ingredient-nutrient-tags.json` (26) and `nutrition-targets.json` (28) are already
      listed
- [x] Confirm no change to `style.css`, `index.html`, `plan.html`, `shopping.html`, `app.js`,
      `plan.js`, `generator.js`, `shelf-life.js`, `shopping-list.js`, `swipe.js`, `data.js`,
      `meals.json`, `nutrition-targets.json`, `ingredient-nutrient-tags.json`, `manifest.json`,
      `worker/`, `docs/HERMES.md`, `docs/ARCHITECTURE.md`
- [ ] Manual: open Discover → "Ranked to fill: …" names up to 3 nutrients and the top card's
      ingredients plausibly hit at least one of them. **Not run** — no headless browser
      available in this environment; ranking/permutation/degradation logic verified instead
      via `test.html` group 29 run under Node against the real data files. Run this manual
      pass before shipping
- [ ] Manual: tap through several chips → deck reloads, note stays consistent, no console error
      and no delay beyond the existing fetch. **Not run**, same reason
- [ ] Manual: like a meal then tap a chip → still loads; the note may not change (one meal
      rarely closes a library-wide gap) — the point is it does not error or blank the deck.
      **Not run**, same reason
- [ ] Manual: block `nutrition-targets.json` in devtools → deck still loads **unranked** with
      the note hidden. This is the isolation check for `libraryGaps`'s `catch`. **Not run**,
      same reason
- [ ] Manual: comment out the `nutrition.js` tag → same graceful (silent) degradation; confirm,
      then put it back. **Not run**, same reason
- [ ] Manual on phone width: the note is one centred line and does not push the deck below the
      fold; an empty note collapses (it is `hidden`). **Not run**, same reason
- [x] `docs/roadmap.md` Phase 10 ⇒ `(Status: Complete)` in the same commit as the code
- [x] Not built: a per-card "covers: iron" badge, exposing per-candidate scores from
      `rankByGap`, widening `POOL_LIMIT` so ranking picks from a larger set (the named
      `ponytail:` ceiling), re-ranking the live deck after each like, per-category or
      per-slot-type gap lists, weighting `missing` above `partial`, gap-aware ranking of the
      saved pile / browse page / plan generator, a "why this meal" explainer, caching gaps in
      `localStorage`, or any change to the high/med/low tag weights (it is a coverage checklist,
      not a calculator)

## Phase 11 — Pantry-aware shopping

Spec: `.claude/specs/phase11_spec.md`. First app-side consumer of the `/pantry` endpoint
Phase 4 shipped: `buildLists` gains an optional 4th `pantry` argument and subtracts on-hand
quantities, and Discover gets Phase 7's deferred "using what's left" chip as a **ranking**
toggle. Read-only — no PUT, no pantry editing UI, no eat-flow deduction (all Phase 12). No
new file, no new dependency, no `worker/` edit, no `meals.json`/`pack-sizes.json` schema
change, no change to the staples/unpriced split or the tick-state keys.

### Logic & Backend Tasks (TDD — write the check first)

- [x] `test.html` check group **30** (next free number after 29; the file reuses 23/24
      mid-file — do not renumber): `MP.ShoppingList.normalizeKey` maps `"Chicken Breasts"`,
      `"chicken-breast"`, `" Chicken_Breast "` and `"chicken breast"` all to
      `chicken_breast`, and `normalizeKey(null)` is `""` without throwing
- [x] `test.html` group 30: `pantryIndex(null)`, `pantryIndex({})` and
      `pantryIndex({items: "nope"})` all return `{}`
- [x] `test.html` group 30: **back-compat guard** — `buildLists(plan, mealsById, packData)`
      with no 4th argument is deep-equal to `buildLists(plan, mealsById, packData, null)`.
      This is what keeps groups 11-17 meaningful
- [x] `test.html` group 30: needing 800g with pantry `"300g"` ⇒ `needed.value === 500` and
      `packs` recomputed from 500, not 800
- [x] `test.html` group 30: pantry qty ≥ needed ⇒ `packs === 0`, `lineCost === 0`, the line
      is **still present in `lines`**, and `total` equals the no-pantry total minus that
      line's original `lineCost`
- [x] `test.html` group 30: needed `"1kg"` + pantry `"300g"` subtracts (both normalize to
      `g`); needed `"2 tins"` + pantry `"300g"` does **not** — `onHand === null`,
      `pantryQty` set, `packs` unchanged
- [x] `test.html` group 30: unparseable (`"a bit"`) and empty (`""`) pantry qty leave
      `packs` unchanged with `pantryQty` set — the "never silently drop a grocery" check
- [x] `test.html` group 30: unmeasured ingredient (`qty: ""` ⇒ `needed === null`) with a
      pantry match does not throw and leaves `packs` unchanged
- [x] `test.html` group 30: `orderPool` is a **permutation, never a filter** — same length
      and same set of ids for a non-empty pantry, an empty pantry `{}`, and a meal with
      `ingredients: []` (scores 0, does not throw)
- [x] `hermes-sync.js` — add `fetchPantry()` beside `syncPlanFlag()` (line 92) and to the
      `MP.Sync` export (line 116): `GET /pantry` via `req()`, returns
      `{updatedAt, items}` or `null`. Modelled on `syncPlanFlag`, **not** `syncLibrary` —
      no `decide()`, no `inflight` guard, no PUT
- [x] `hermes-sync.js` — `if (!config().enabled)` returns the localStorage mirror (never
      fetches a relative URL); on success mirror `body` to `mp_pantry` **only if**
      `Array.isArray(body.items)` (same defensive rule as `syncLibrary`'s
      `Array.isArray(remote.meals)` guard); on throw or bad shape return the parsed mirror
      or `null`. **Never throws to the caller**
- [x] `hermes-sync.js` — `ponytail:` comment: read-only mirror, Phase 12 adds the write
      path and whatever conflict rule it needs. `start()` stays unchanged (pantry is
      fetched on demand by the two pages that use it, not on every page load)
- [x] `shopping-list.js` — `normalizeKey(text)`: lowercase → trim → non-alphanumeric runs
      to `_` → strip leading/trailing `_` → strip one trailing `s` per `_`-separated word.
      Nullish ⇒ `""`. Applied to **both** sides so neither needs a special case
- [x] `shopping-list.js` — `ponytail:` comment on `normalizeKey` naming the ceiling: exact
      match after normalization only, no synonyms/irregular plurals/unit words
      (`"tin of chopped tomatoes"` will not match `chopped_tomatoes`); upgrade path is a
      small alias map in `pack-sizes.json`, not a fuzzy-match dependency
- [x] `shopping-list.js` — `pantryIndex(pantry)` → `{ [normalizeKey(item.name)]: item.qty || "" }`;
      `null`/malformed ⇒ `{}`; later duplicates win
- [x] `shopping-list.js` — `packsFor` (line 37): add `if (needed.value <= 0) return 0;`
      rather than relying on `Math.ceil(0 / packSize)` staying 0 through future edits
- [x] `shopping-list.js` — `buildLists(plan, mealsById, packData, pantry?)`: build
      `const have = pantryIndex(pantry)` once at the top. Omitted pantry ⇒ `{}` ⇒ every
      branch below no-ops and output is **byte-identical to today**
- [x] `shopping-list.js` — subtraction sits **after `needed` is computed and before
      `packsFor(needed, item)`**: `have[normalizeKey(key)]` miss ⇒ skip entirely; hit ⇒ set
      `line.pantryQty = raw || "(some)"` **always**, then subtract only when
      `needed && onHand && onHand.unit === needed.unit` (reusing `parseQty` on the pantry
      text, so kg→g / l→ml already match), clamped with `Math.max(0, …)`
- [x] `shopping-list.js` — unit mismatch, unparseable qty, empty qty or `needed === null`
      ⇒ **no subtraction**, `line.onHand = null`, note still shown. Never silently drop a
      grocery from the list
- [x] `shopping-list.js` — a fully-covered line **stays in `lines`** with `packs: 0` and
      `lineCost: 0`; `total` falls out of the existing sum with **no special case** and no
      fourth category. Staples/unpriced go through the same path; sorting (lines 115-118)
      untouched so the list does not reshuffle between shops
- [x] `shopping-list.js` — `ponytail:` comment: both shop days subtract the same pantry
      amount, the pantry is not a running balance in this phase — a balance belongs in
      Phase 12's deduction flow
- [x] `shopping-list.js` — export `normalizeKey` and `pantryIndex` on `MP.ShoppingList`
      (line 125)
- [x] `shopping.js` — `init()` (line 83): add `MP.Sync.fetchPantry()` to the existing
      `Promise.all` and pass it as `buildLists`' 4th argument. `fetchPantry` never rejects,
      so the `Promise.all` cannot be poisoned by it
- [x] `discover.js` — module state beside `pool`/`idx`/`activeCat`/`loadFailed` (lines
      9-12): `pantryFirst = false`, `pantryKeys = null`
- [x] `discover.js` — `pantryIndexCached()` beside `libraryGaps()`: cached
      `MP.Sync.fetchPantry()` → `MP.ShoppingList.pantryIndex(...)`. Whole body in
      `try`/`catch` returning `{}` — **a pantry failure must degrade to today's deck order,
      never to an empty deck or a thrown init**
- [x] `discover.js` — `pantryOverlap(meal, have)` (count of ingredients whose
      `normalizeKey` is in `have`) and `orderPool(list, have)` (index-decorated stable sort,
      descending overlap — `map` to `{m, i, s}`, sort by `s` desc then `i` asc, `map` back;
      do not trust engine sort stability). Zero-overlap meals come **last, not out**
- [x] `discover.js` — `loadPool` (line 241): apply
      `if (pantryFirst) next = orderPool(next, await pantryIndexCached())` after Phase 10's
      gap ranking and **before** the `if (cat !== activeCat) return;` stale guard — the
      identical trap Phase 10 documented. Rank the local `next`; never assign to the
      module-level `pool` from inside the ranking step
- [x] `discover.js` — `ponytail:` comment on `pantryOverlap`: raw unweighted count, one
      pantry staple ranks like one pantry protein; weight by pack price only if the
      ordering proves useless in real use

### UI & Layout Tasks (rapid visual prototyping)

- [x] `shopping.js` — `lineHtml` (line 32): when `line.pantryQty` is set, append
      `<span class="have">have ${esc(line.pantryQty)}</span>` after the label. **`esc()` is
      mandatory** — pantry text is user/Hermes-entered free text arriving over the network,
      same trust boundary as TheMealDB
- [x] `shopping.js` — `lineHtml`: add `covered` to the `<li class="shop-line">` class list
      when `line.packs === 0`. `blockHtml` (line 48), the `details` blocks, tick state and
      `mp_shopping_ticked` keys all stay unchanged
- [x] `style.css` — two rules only: `.shop-line .have` (small, muted, inline after the
      label) and `.shop-line.covered` (reduced opacity). **Do not `display: none` a covered
      line** — "I thought I had that" is exactly when the user needs to see it
- [x] `discover.html` — add `<button class="chip" data-filter="pantry" aria-pressed="false">Using
      what's left</button>` last inside `#discover-filters` (lines 33-43). A distinct
      attribute, **not** a synthetic `data-cat` value, so a category stays selectable while
      the toggle is on
- [x] `discover.js` — chip handler (line 270) currently delegates on `.chip[data-cat]` and
      will not fire for the new chip: add a sibling branch for `.chip[data-filter="pantry"]`
      that flips `pantryFirst`, sets `aria-pressed`, toggles the same `active` class the
      category chips use, then re-orders **in place without refetching**
      (`pool = orderPool(pool, await pantryIndexCached())`, `idx = 0`, re-render). Toggling
      off re-runs `loadPool(activeCat)` to restore gap order
- [x] `discover.html` — add `<script src="shopping-list.js">` and
      `<script src="hermes-sync.js">` before `discover.js` (line 71)
- [x] `shopping.html` — add `<script src="hermes-sync.js">` before `shopping.js` (line 40);
      `shopping-list.js` is already there (line 39)
- [x] `sw.js` — bump `CACHE` to `"meal-planner-v11"`. **No `SHELL` additions** — no new
      file, and every newly referenced script is already listed
- [ ] Manual pass (`python3 -m http.server 8000`): sync **unconfigured** ⇒ shopping list and
      Discover behave exactly as before, no console error, chip toggles and changes nothing.
      **Not run** — no headless browser available in this environment; the equivalent logic
      (pantry omitted ⇒ byte-identical `buildLists` output) is verified in `test.html` group
      30 instead. Run this manual pass before shipping
- [ ] Manual pass: sync configured with a partial and a full pantry match ⇒ partial line
      shows a reduced quantity plus "have …", full line greys out at £0, total drops by
      exactly that line. **Not run** — same limitation; the subtraction/coverage math is
      covered by `test.html` group 30, but the actual rendered `.have`/`.covered` styling has
      not been eyeballed
- [ ] Manual pass: airplane mode after one successful load ⇒ the `mp_pantry` mirror still
      subtracts. **Not run** — requires a real browser + Hermes deployment to exercise the
      localStorage mirror path end to end
- [ ] Manual pass: toggle the Discover chip on/off across two categories ⇒ the deck never
      empties and the card count is identical either way. **Not run** — `orderPool`'s
      permutation property is exercised by hand-reasoning only per the spec's fallback (no
      DOM-free test hook for `discover.js`); this manual pass is the real check for it
- [x] Flip `docs/roadmap.md` Phase 11 to **Status: Complete** in the *same commit* as the
      code — not before

## Phase 12 — Eat flow & split shopping lists

Spec: `.claude/specs/phase12_spec.md`. Phase 11 made the app a pantry *reader*; this makes it a
*writer* and adds the second list the shortfall lands in. The user explicitly answered both
Decision Gates **1B, 2A**: the ad-hoc list is a **synced KV key** (`/adhoc`, Gate 1 Path B —
chosen over the planner's localStorage-only recommendation, for maximum Hermes read/write
connectivity) and every write is **local-first with a replayed pending-op log** (Gate 2 Path A —
the app must stay fully usable with sync off). No new dependency,
no new JS file, no change to `buildLists` or the planned list.

### Logic & Backend Tasks (TDD — write the check first)

- [ ] `test.html` check group **31** (next free after 30): `fmtRemaining({value:800,unit:"g"},
      {value:300,unit:"g"}) === "500g"`; over-consumption clamps to `"0"` and is **never
      negative**; no trailing `.0` (`1.5kg` − `500g` ⇒ `"1000g"`)
- [ ] `test.html` group 31: `eatPlan` **not-tracked** case — an ingredient absent from the pantry
      gives `after === null`, `note === "not tracked"`, `shortfall === false` and **zero ops**.
      This is the check that stops the ad-hoc list filling with everything you cook
- [ ] `test.html` group 31: `eatPlan` clean deduction — pantry `"800g"`, used `"300g"` ⇒ one
      `sub` op, `after === "500g"`, `shortfall === false`, **no** `add` op
- [ ] `test.html` group 31: `eatPlan` shortfall — pantry `"200g"`, used `"500g"` ⇒ `after === "0"`,
      `shortfall === true`, exactly **two** ops (a `pantry`/`sub` and an `adhoc`/`add` whose `qty`
      is the `300g` remainder)
- [ ] `test.html` group 31: `eatPlan` unparseable pantry qty (`"half a bag"`) ⇒ **zero ops**,
      `after === null`, `note` names the text — the "never silently destroy pantry data" check
- [ ] `test.html` group 31: `eatPlan` unit mismatch (pantry `"2 tins"`, used `"300g"`) ⇒ zero ops,
      `after === null`; unmeasured ingredient (`qty: ""`) ⇒ zero ops, no throw
- [ ] `test.html` group 31: `eatPlan` empty/omitted `used` entry ⇒ ingredient skipped entirely, no
      ops; and `eatPlan(meal, used, null)` (no pantry at all) ⇒ zero ops, every row
      `"not tracked"`, no throw — **the Hermes-is-off guarantee in assertion form**
- [ ] `test.html` group 31: `applyOps` **anti-clobber** — a `sub` against a freshly fetched remote
      array reduces only the matched item and returns a remotely-edited sibling **untouched**.
      This is what justifies putting the ad-hoc list in KV at all
- [ ] `test.html` group 31: `applyOps` `sub` for a name not present remotely (Hermes deleted it) ⇒
      array unchanged, no throw, **no phantom item created**
- [ ] `test.html` group 31: `applyOps` `add` appends a new name but **replaces the `qty` of an
      existing normalized name** rather than duplicating — it must not be able to produce a body
      the Worker's duplicate-name validator would 400 on
- [ ] `test.html` group 31: `applyOps` `remove` drops the match and no-ops a miss;
      `applyOps(items, [])` is deep-equal to `items`; `applyOps([], ops)` does not throw; a
      malformed op (`{}`, `{type:"nonsense"}`) is **skipped, not thrown on**
- [ ] `test.html` group 31: `applyOps` **purity** — the input array and its item objects are not
      mutated (deep-equal a pre-call clone afterwards)
- [ ] `test.html` group 31: back-compat — `buildLists(plan, mealsById, packData, pantry)` still
      produces the group-30 result. Phase 12 must not move the planned list at all
- [ ] `worker/worker.js` — rename `pantryError` (lines 76-87) to **`itemsError`**, body unchanged:
      it already validates exactly the shape `adhoc` needs (array `items`, non-empty string `name`,
      no case-insensitive duplicates)
- [ ] `worker/worker.js` — `GET /adhoc` + `PUT /adhoc` beside the `/pantry` handlers (lines
      107-136), same 204/400/401 behaviour, KV key `"adhoc"`. Collapse `/pantry` and `/adhoc` into
      one branch over `["pantry", "adhoc"]` rather than copy-pasting — but **do not** generalise to
      "any key" (`ARCHITECTURE.md:86-89`, don't grow it into a general API)
- [ ] `worker/worker.js` — deploy and confirm `GET /adhoc` returns `null` and a `PUT` round-trips
      **before** any app code depends on it. No new secret, no `wrangler.toml` change
- [ ] `shopping-list.js` — `fmtRemaining(have, used)`: `have - used` clamped at 0, formatted
      (`"500g"`), trailing `.0` trimmed. Units assumed already matched by the caller
- [ ] `shopping-list.js` — `eatPlan(meal, used, pantry)` → `{ops, rows}`. **Pure: no I/O, no
      storage writes** — the caller does both. `used` is `{[key]: qtyString}`; an absent or empty
      entry means that ingredient was **not consumed** and is skipped
- [ ] `shopping-list.js` — `eatPlan` decision table: no pantry match ⇒ no ops, no shortfall,
      `note: "not tracked"` (**absence means untracked, not "I have none"**); parseable + same unit
      + `have >= used` ⇒ one `sub`; `have < used` ⇒ `sub` clamping to `"0"` **plus** an `adhoc`
      `add` for the remainder, `shortfall: true`; unparseable/unit-mismatch/no-qty ⇒ no ops,
      `after: null`, `note` naming the reason
- [ ] `shopping-list.js` — an item driven to exactly 0 **keeps its pantry entry** with `qty: "0"`,
      it is not removed. Deleting it loses the fact that it's a thing you buy, and Hermes is the
      pantry's other editor
- [ ] `shopping-list.js` — `ponytail:` comment: matching inherits Phase 11's `normalizeKey` exact
      match wholesale, no synonyms and no unit conversion beyond `parseQty`'s kg→g / l→ml. Same
      ceiling, same upgrade path (alias map) — **do not add a second matching strategy here**
- [ ] `shopping-list.js` — export `fmtRemaining` and `eatPlan`. `buildLists`, `packsFor`,
      `parseQty`, `normalizeKey`, `pantryIndex` and the line shape are **unchanged**
- [ ] `hermes-sync.js` — generalise Phase 11's `fetchPantry` into `fetchItems(list)` (`"pantry"` |
      `"adhoc"`): same body with `"/pantry"` → `` `/${list}` `` and `"mp_pantry"` → `` `mp_${list}` ``.
      Every Phase 11 rule preserved: disabled config returns the mirror without touching the
      network, a non-array `items` is a failure so a malformed blob never wipes the mirror,
      **never throws to the caller**
- [ ] `hermes-sync.js` — keep `fetchPantry()` as a one-line alias for `fetchItems("pantry")` so
      Phase 11's callers (`shopping.js:95`, `discover.js`'s `pantryIndexCached`) need **no edit**
- [ ] `hermes-sync.js` — `localItems(list)` (mirror's items, `[]` on missing/malformed) and
      `writeLocalItems(list, items)` (mirror = `{updatedAt: now, items}`). Synchronous — the ad-hoc
      list must paint with **no network in the critical path**
- [ ] `hermes-sync.js` — new localStorage keys `mp_adhoc` (same shape as `mp_pantry`) and
      `mp_sync_ops` (`[{list, type, name, qty?}]`, oldest first) beside the existing keys (lines 9-12)
- [ ] `hermes-sync.js` — `queueOp(op)` appends to `mp_sync_ops`
- [ ] `hermes-sync.js` — `applyOps(items, ops)`: **PURE** (new array, mutates nothing, never throws
      on a malformed op — skip it), matched by `MP.ShoppingList.normalizeKey` on both sides. `sub`
      ⇒ recompute qty via `fmtRemaining`, but leave the item **exactly as-is** on a miss / either
      side unparseable / differing units. `add` ⇒ replace qty by normalized name else append
      (drop `qty` when empty). `remove` ⇒ drop the match, miss is a no-op. Exported for `test.html`
- [ ] `hermes-sync.js` — `flushOps()`: `!config().enabled` ⇒ `"off"` with ops **left queued**; no
      ops ⇒ `"noop"`; else per list **GET fresh from the network (never the mirror — this is the
      whole point)** → `applyOps` → PUT → drop that list's ops → `writeLocalItems` so the mirror
      converges. Any throw ⇒ **ops stay queued**, return `"error"`, never throw to the caller
- [ ] `hermes-sync.js` — `ponytail:` comment on `flushOps`: at-least-once, not exactly-once — a PUT
      that succeeds with a lost response replays its `sub` and double-deducts. Single user, low
      frequency, cost is retyping one qty; add op ids + server-side dedupe only if it actually bites
- [ ] `hermes-sync.js` — `start()` (lines 134-140) gains **one line**: call `flushOps()` alongside
      the existing sync work, so a queue built up offline drains on the next connected load
- [ ] `plan.js` — `mp_plan` slot gains an optional `eatenAt: "<ISO8601>"`, written only by this
      flow. Local-only: `ARCHITECTURE.md:74` says the plan is never stored in KV and **Phase 13
      owns that question**. `MP.Generator` is **not touched** — a regenerated plan simply has no
      `eatenAt`, which is correct
- [ ] `plan.js` — `commitEat()` is the **only writer**, in this exact order: `eatPlan` → apply ops
      to **both mirrors immediately** (`applyOps` + `writeLocalItems`) → `queueOp` each → write
      `eatenAt` + `renderPlan()` when `eatCtx.day` is set → `closeEatSheet()` + toast → **then**
      `flushOps()` fire-and-forget, **unawaited, after the UI has already updated**
- [ ] `plan.js` — steps 2-5 above are synchronous and must complete **before** `flushOps()` is even
      called. That ordering *is* the local-first decision — if it inverts, the flow breaks the
      moment Hermes is off

### UI & Layout Tasks (rapid visual prototyping)

- [ ] `plan.html` — one overlay pair before `#swap-overlay` (line 41), matching Phase 9's
      convention exactly: `<div id="eat-overlay" class="modal-overlay hidden" style="z-index:70;">`
      wrapping `<div id="eat-sheet" class="modal-sheet"></div>`. Above `#day-overlay` so the day
      sheet stays visible behind it
- [ ] `plan.html` — add `<script src="shopping-list.js">` before `plan.js` (line 59); `hermes-sync.js`
      is already loaded (line 58) and both are already in `sw.js`'s `SHELL`
- [ ] `plan.js` — module state `let eatCtx = null;` (`{meal, day, slotType}`; `day`/`slotType`
      `null` for a library eat) beside `dayCtx` (line 260), plus `openEatSheet(meal, day, slotType)`,
      `closeEatSheet()`, `renderEatSheet(pantry)`, `commitEat()`
- [ ] `plan.js` — `openEatSheet` awaits `fetchItems("pantry")`, but renders **immediately** with a
      "checking pantry…" line rather than holding the sheet closed on the network. Unconfigured or
      offline ⇒ mirror or `null` ⇒ sheet still opens with every row "not tracked". **The flow is
      never blocked by the bridge**
- [ ] `plan.js` — sheet body: `esc()`d meal name; one `.eat-row` per ingredient with a
      `<input type="text" class="eat-qty" data-key="…">` pre-filled with the recipe qty and the
      `have → after` summary or `note`; **clearing the input excludes that ingredient**
- [ ] `plan.js` — re-run `eatPlan` on every `input` event and repaint only the summary spans. This
      is the roadmap's "review the remaining ingredient quantities" — it has to update live or
      editing a quantity is guesswork
- [ ] `plan.js` — a shortfall count line ("2 items will be added to your ad-hoc list", nothing when
      zero), plus `Confirm` and `Cancel`. **`Cancel` writes nothing at all**
- [ ] `plan.js` — **every pantry string and ingredient label goes through `esc()`** before reaching
      `innerHTML`. Pantry text is Hermes/user free text over the network — same trust boundary as
      TheMealDB (`CLAUDE.md` invariant)
- [ ] `plan.js` — plan entry point: `<button class="ghost day-eat-btn" data-slot="${slotType}">Eat</button>`
      in `daySlotHtml`'s filled-slot `.day-slot-actions` row (line 273) beside Swap and Recipe,
      wired in `renderDayView` beside the existing `.day-swap-btn`/`.day-recipe-btn` loops
      (lines 317-322) → `openEatSheet(mealAt(day, slot), day, slot)`
- [ ] `plan.js` — an already-eaten slot renders the button as `Eaten ✓`, **`disabled`**, with a
      `<p class="day-slot-note">` giving the date. Re-tapping is a mis-tap, not a feature
- [ ] `plan.js` — library entry point: `<button class="ghost detail-eat-btn">Eat this</button>` in
      `openDetail(meal)`'s sheet (line 239) → `openEatSheet(meal, null, null)`. **Same sheet, same
      commit**, no `eatenAt` written. `closeEatSheet` returns you to the day view you came from
- [ ] `shopping.js` — `adhocHtml(items)` and `renderAdhoc()` painting `#adhoc-root` from
      `MP.Sync.localItems("adhoc")` **synchronously** (instant, no network), then
      `fetchItems("adhoc")` in the background and re-render if it returns something
- [ ] `shopping.js` — each ad-hoc line is a checkbox + `esc(item.name)` + `esc(item.qty || "")` and
      **nothing else** — no packs, no price, no shop-day. Ticking queues a `remove` op, writes the
      mirror, re-renders, then calls `flushOps()` unawaited (same ordering rule as `commitEat`)
- [ ] `shopping.js` — an "Add an item" row (name input, optional qty input, button) ⇒ an `add` op
      through the identical path. This is the "want to buy this week" half of the outline item and
      the only way to use the list without eating something
- [ ] `shopping.js` — empty list renders the section with a one-line `.muted` placeholder, **not
      hidden** (a missing section reads as a bug); and `renderAdhoc()` goes **outside** the "no plan
      yet" early return (lines 88-93) so the ad-hoc list works before a plan has ever been generated
- [ ] `shopping.js` — the planned-list rendering (`lineHtml`, `blockHtml`, `fmtQty`,
      `mp_shopping_ticked` and its key scheme) is **untouched**
- [ ] `shopping.html` — `<div id="adhoc-root">` in its own `<section class="section">` with
      `<h2>Ad-hoc list</h2>`, **after** the planned-list section (lines 30-34): the two-week shop is
      why the page exists. No script tag changes — both scripts already load (lines 39-40)
- [ ] `style.css` — `.eat-row` (label / qty input / summary on one line, wrapping on narrow
      phones), `.eat-row .eat-after` (muted), `.eat-row.shortfall .eat-after` (**reuse the existing
      shelf-life warning colour variable — do not introduce a colour**), `.shop-block.adhoc` (same
      block styling as the planned blocks), `.adhoc-add`. No change to `.shop-line`, `.shop-block`,
      `.have`/`.covered` or any modal rule
- [ ] `sw.js` — bump `CACHE` to `"meal-planner-v12"`. **No `SHELL` additions** — no new file
- [ ] `docs/ARCHITECTURE.md` — the KV schema (lines 64-74) lists two keys and is **already stale**
      (Phase 4 shipped `pantry`): add both `pantry` and `adhoc`, and fix the line-90 invariant
      ("never stores anything beyond `library` and `planFlag`") to name all four keys. Add one line
      that the two item lists are local-first with a replayed op log, so the app is fully usable
      with the bridge unreachable
- [ ] `docs/HERMES.md` — `GET /adhoc` / `PUT /adhoc` capability row + a section mirroring
      `/pantry`'s (same body shape, same fetch-then-write rule), described as the "ran out of / want
      to buy this week" list so Hermes uses it for "add X to my shopping list" instead of writing to
      `/pantry`. State explicitly that the **planned** two-week list is not on the bridge (it is
      derived from the local plan) so Hermes cannot be asked to edit it
- [ ] Manual pass (`python3 -m http.server 8000`): **sync switched off entirely** ⇒ open a day, Eat
      a meal, confirm: every row "not tracked", slot flips to `Eaten ✓`, nothing throws, **no
      network request attempted**. Add an ad-hoc item by hand ⇒ persists across a reload
- [ ] Manual pass: sync configured, pantry with a partial and a full match ⇒ quantities drop by the
      right amounts in Hermes, the over-consumed item lands on the ad-hoc list with the correct
      remainder, and the planned list reflects the reduced pantry on next load
- [ ] Manual pass: **offline then online** ⇒ airplane mode, eat two meals and tick an ad-hoc line,
      reconnect, reload: `flushOps` drains and the server matches local state
- [ ] Manual pass: **concurrent edit** ⇒ with an op queued offline, change a *different* pantry item
      via Hermes, then reconnect: both changes survive. This is the check that putting the ad-hoc
      list in KV was worth it
- [ ] Manual pass: re-tap Eat on an already-eaten slot ⇒ disabled, no second deduction
- [ ] Flip `docs/roadmap.md` Phase 12 to **Status: Complete** in the *same commit* as the code

## Phase 13 — Hermes plan placement & preference learning

- [x] Not yet planned — run `@planner Phase 13` for the spec and task breakdown
