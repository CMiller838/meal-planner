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
