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

- [ ] Not yet planned — run `@planner Phase 3`

## Phase 4 — Hermes bridge (Cloudflare Worker + KV)

- [ ] Not yet planned — run `@planner Phase 4`

## Phase 5 — Hermes conversational capabilities

- [ ] Not yet planned — run `@planner Phase 5`
