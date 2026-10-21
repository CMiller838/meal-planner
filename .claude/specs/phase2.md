# Phase 2 Spec — Plan generator & browse quality

Roadmap: `docs/roadmap.md` → Phase 2. Source of scope: `docs/OUTLINE.md`.
Read `SPEC.md` before touching planning logic — the nutrition/shelf-life numbers
are deliberate.

## Decisions taken (user-confirmed)

| Gate | Decision |
|---|---|
| 1. Variety guard | **Path B** — rewrite `generatePlan()` to genuinely select from the library: rank by nutrient gap per slot, skip already-used meals, build batch-cook leftover runs. Delete the hardcoded `BREAKFAST_CYCLE` / `LUNCH_CYCLE` / `DINNER_CYCLE` / `SNACK_ID` arrays. |
| 1b. Weeknight rule | Real calendar via `Date.getDay()`, **inverted** from the usual assumption. The user works Sat + Sun. **Fri/Sat/Sun = cook once** (one batch meal + leftovers across the stretch). **Mon–Thu = cook fresh**, favour `prepEffort: "quick"`. |
| 2. Prep-effort data | **Path A** — `prepEffort: "quick" \| "batch"` field on each meal record in `meals.json`, next to `batchCook`/`servings`. Absent ⇒ treated as `"quick"`. Discover-added meals get `"quick"` explicitly. |
| 3. Browse search | **Path A** — one `<input type="search">` above the library grid, live filter on name + mealTypes + ingredient keys/labels, case-insensitive substring. |

---

## 1. Calendar model

### Current state (verified)

- `plan.js` `generatePlan()` returns `{ days: [{ day: 1..14, slots }] }`. **No date is
  stored anywhere.** Day numbers are positional only.
- `shelf-life.js` `shopDayFor(dayNum)` returns `dayNum <= 7 ? 1 : 8` — shop days are
  **fixed day-positions**, not weekdays. That stays true.
- Day 1 = the day the user pressed Generate (per `SPEC.md`), but nothing recorded it.

### Change

Add `startDate` to the plan object:

```
plan := {
  startDate: "YYYY-MM-DD",          // local date of day 1, set at generation time
  days: [ { day: 1..14, slots: { breakfast|lunch|dinner|snack: { mealId } } } ]
}
```

`days[]` shape is **unchanged** — `shelf-life.js`, `moveSlot()`, `renderPlan()` and the
swap picker keep working untouched.

**Migration:** a plan already in `localStorage["mp_plan"]` has no `startDate`. Do not
invent one and do not force-regenerate. If `plan.startDate` is missing, weekday labels
are omitted and the plan renders exactly as today. The next Generate adds it.

### Date helpers (in `generator.js`, see §2)

```
isoToday()                       -> "YYYY-MM-DD"   // local, not UTC
weekdayOf(startDate, dayNum)     -> 0..6           // 0=Sun … 6=Sat
```

**Edge case — do not use `new Date("2026-09-07")`.** That parses as UTC and shifts the
weekday for anyone west of Greenwich. Split the ISO string and build
`new Date(y, m - 1, d)`, then `setDate(d + (dayNum - 1))`, then `.getDay()`. DST is a
non-issue because we only ever read `.getDay()`.

### The Fri/Sat/Sun rule, stated exactly

A **cook-once run** is a maximal group of *consecutive day-positions* (1..14) whose real
weekday is Friday (5), Saturday (6) or Sunday (0).

Grouping is by **day-position adjacency**, not by `getDay()` value — Fri=5, Sat=6, Sun=0
are calendar-consecutive but numerically discontinuous. Runs are naturally clipped at the
plan boundary, which is what produces truncated runs.

```
weekendRuns(startDate) -> number[][]   // e.g. [[5,6,7],[12,13,14]]
```

Worked examples (assert these):

| `startDate` weekday | day→weekday | `weekendRuns` |
|---|---|---|
| **Monday** | 1=Mon … 5=Fri, 6=Sat, 7=Sun, 8=Mon … 12=Fri, 13=Sat, 14=Sun | `[[5,6,7],[12,13,14]]` |
| **Saturday** | 1=Sat, 2=Sun, 3=Mon … 7=Fri, 8=Sat, 9=Sun, 10=Mon … 14=Fri | `[[1,2],[7,8,9],[14]]` |
| **Friday** | 1=Fri, 2=Sat, 3=Sun, … 8=Fri, 9=Sat, 10=Sun, … | `[[1,2,3],[8,9,10]]` |

Dinner placement:

- **Run of length ≥ 2:** the run's **first day is the cook day** — place a batch meal
  there and cover the rest of the run with leftovers (§3). This is "cook once across
  Friday and the weekend".
- **Run of length 1** (only ever a truncated run at day 1 or day 14): treat it as an
  ordinary day — quick meal, no batch.
- **Every other day (Mon–Thu, and any run day leftovers couldn't cover):** favour
  `prepEffort: "quick"`.

**Scope: dinner slot only.** Breakfast/lunch/snack are quick by nature and stay on the
plain variety-guard path. Not an oversight — do not extend the rule to other slots.

The rule is computed per **real calendar date derived from `startDate`**, never from a
fixed day-position. A plan generated on a Wednesday has its runs at days 3–5 and 10–12;
nothing in the code may assume day 5 is a Friday.

---

## 2. New module: `generator.js`

`plan.js` is a page controller and its generator is unreachable from a test page. Extract
the pure logic into a sibling of `nutrition.js` / `shelf-life.js` — same `MP.*` IIFE
shape, no DOM, no `fetch`, all inputs passed in.

```
window.MP.Generator = { generatePlan, weekendRuns, weekdayOf, isoToday };

/**
 * Build a fresh 14-day plan from the user's library.
 * Pure: no DOM, no localStorage, no fetch. Same inputs => same output.
 * @param {Meal[]} library
 * @param {Object} tags        ingredient-nutrient-tags.json contents
 * @param {Object} targets     nutrition-targets.json contents
 * @param {Object} shelfData   shelf-life.json contents
 * @param {string} [startDate] ISO "YYYY-MM-DD"; defaults to isoToday()
 * @returns {{startDate: string, days: Array<{day:number, slots:Object}>}}
 */
generatePlan(library, tags, targets, shelfData, startDate)
```

### Selection state

```
usedOn      : { [mealId]: number[] }   // day-positions already assigned
lastUsedDay : { [mealId]: number }     // max(usedOn[id]); absent = never used
```

### `pickMeal(pool, dayNum, dayMealsSoFar, opts)` — internal

`opts = { prefer: "quick" | "batch" | null, excludeIds: Set<string> }`

1. `candidates = pool.filter(m => !opts.excludeIds.has(m.id))`.
   `excludeIds` always contains whatever was placed in the same slot **the previous day**
   — no accidental back-to-back repeats outside a real leftover run.
2. **Gap ranking:** `gap = dayCoverage(dayMealsSoFar, tags, targets)`;
   `gapNutrients = [...gap.missing, ...gap.partial]`;
   `ranked = MP.Nutrition.rankByGap(candidates, gapNutrients, tags)`. Reuse the existing
   function — this is the same ranking the swap picker already shows the user.
3. **Preference partition** (soft, never a hard filter): if `opts.prefer` is set, stable-
   partition `ranked` into `[matches prefer] ++ [rest]`, where a meal "matches" when
   `effortOf(meal) === opts.prefer`. A too-small library must still fill 14 days.
4. **Variety guard:** stable-partition the result into
   `[never used] ++ [used, oldest-used-first]`, i.e. ascending `lastUsedDay`. Ties keep
   ranking order.
5. Return the head, or `null` if the pool was empty (slot renders as `tap to add`, which
   `renderPlan()` already handles).

`effortOf(meal)` = `meal.prepEffort || "quick"` — the single place the default lives.

### Fill order

1. Compute `runs = weekendRuns(startDate)`.
2. **Dinners first** (they anchor leftovers and shopping):
   - For each run with `length >= 2`, fill it per §3.
   - Every remaining dinner day, ascending: `pickMeal(dinnerPool, day, [], {prefer:"quick"})`.
     (`dayMealsSoFar` is empty here — dinner is placed before the day's other slots, so
     the gap ranking for dinner is against an empty day, i.e. plain nutrient-density
     ranking. Intentional: dinner is the biggest meal and should not be chosen to patch
     a breakfast's gaps.)
3. **Then breakfast, lunch, snack**, day 1→14, in that order, each with the day's
   already-placed meals as `dayMealsSoFar`, `prefer: null`. Later slots therefore fill
   the gaps the dinner left — which is exactly what the day-coverage strip reports.

---

## 3. Leftover runs (cook once)

Two leftover mechanisms already exist in the data and **both are already understood by
`shelf-life.js`** — reuse them, invent neither:

- **Same-id repetition.** The same `mealId` on consecutive days. `evaluateSlot()` sees
  `meal.batchCook` and `findCookedDay()` anchors the run start. (Today's hardcoded
  `chilli-con-carne, chilli-con-carne` is this.)
- **`leadsTo` chain.** A batch meal carries `leadsTo: [childId]`; the child carries
  `leftoverOf: parentId` and uses a `leftover_*` ingredient key.
  `roast-chicken → chicken-fajitas` is the only chain in the seed data.
  `evaluateSlot()` resolves `leftoverOf` back to the parent's cooked day.

### Run fill algorithm

Given a run `[d0, d1, …]` of length `L` (2 or 3):

1. **Candidate batch meals:** `dinnerPool.filter(m => m.batchCook === true)`.
2. **Shelf-life filter:** keep only `MP.ShelfLife.rawSafeOn(m, d0, shelfData)` (§4) — no
   point generating a plan that immediately warns about itself.
3. Rank the survivors with `pickMeal(..., {prefer: "batch"})`; take the head → `parent`.
4. **Coverage** = `min(L, parent.servings || 2, 3)`. The hard 3 is
   `shelf-life.json.cooked_leftovers.fridgeDays` — cooked day `d0` is safe through
   `d0 + 3 - 1`. Read it from `shelfData`, do not hardcode `3`.
5. **Fill days `d0 … d0+coverage-1`:**
   - `d0` ← `parent.id`.
   - Subsequent days ← the first id in `parent.leadsTo` that exists in the library, if
     any; otherwise `parent.id` again (same-id repetition).
6. **Any run day beyond `coverage`** falls through to the ordinary quick-meal path in
   §2 step 2. Cooking twice is the correct answer when nothing in the library stretches
   that far — silently serving 4-day-old leftovers is not.
7. **No safe batch candidate at all** (step 2 empties the pool): place the best-ranked
   batch meal anyway and let the existing shelf-life warning + "Move to day N" button do
   its job. Do not suppress the warning.

### Known ceiling — flag it, don't fix it here

With the seed library and a **Monday** start, the run cook day is day 5. Shop day is
day 1, and `raw_chicken` / `raw_beef_mince` are `fridgeDays: 2` — so `roast-chicken` and
`chilli-con-carne` are already out of window by Friday. Only `chorizo-pasta`
(`chorizo_opened`, 14 days) survives, and it has `servings: 2`, so Sunday gets a second
cook. That is the honest output of the current data, not a bug in this algorithm.

Leave a `ponytail:` comment at the shelf-life filter naming the ceiling. The real fix is
freezer-aware planning (buy day 1, freeze, defrost Thursday), which needs state this
project has deliberately refused (`CLAUDE.md`: no purchase-date or per-SKU tracking).
**Add it to `docs/FUTURE.md`, do not build it in this phase.** The cheap mitigation is
data, not code: more long-shelf-life / frozen batch dinners in `meals.json`.

---

## 4. `shelf-life.js` — one new export

The generator needs the "would this raw ingredient already be off?" test that
`evaluateSlot()` computes internally. Export it rather than duplicating
`INGREDIENT_CATEGORY` and the window maths in `generator.js`.

```
/**
 * True if the meal's most perishable raw ingredient is still within its
 * fridge window on dayNum, counting from that week's shop day.
 * True when the meal has no tracked perishable (pantry/tinned/spices).
 */
rawSafeOn(meal, dayNum, shelfData) -> boolean
```

Implementation is three lines over the existing private helpers:
`worstRawCategory(meal, shelfData)`; `null` ⇒ `true`; otherwise
`buildWarning(dayNum, shopDayFor(dayNum), cat, shelfData) === null`.

Add to the `MP.ShelfLife` export object. **Nothing else in `shelf-life.js` changes** —
category-based, shop day = 1 and 8, cooked day = first scheduled day, all as-is.

---

## 5. `prepEffort` data migration

Add `"prepEffort"` to every record in `meals.json`, placed next to `batchCook`:

| id | `batchCook` | `servings` | `prepEffort` |
|---|---|---|---|
| roast-chicken | true | 4 | `"batch"` |
| chilli-con-carne | true | 3 | `"batch"` |
| chorizo-pasta | true | 2 | `"batch"` |
| chicken-fajitas | false | 2 | `"quick"` |
| salmon-rice-broccoli | false | 1 | `"quick"` |
| beef-mince-baked-beans | false | 1 | `"quick"` |
| tuna-rice-veg | false | 1 | `"quick"` |
| toastie-ham-cheese | false | 1 | `"quick"` |
| toastie-chicken-cheese | false | 1 | `"quick"` |
| chicken-rice-veg-lunch | false | 1 | `"quick"` |
| french-toast | false | 1 | `"quick"` |
| porridge | false | 1 | `"quick"` |
| oats-yogurt-banana | false | 1 | `"quick"` |
| egg-pb-toast-snack | false | 1 | `"quick"` |

Rule: `batchCook: true` ⇒ `"batch"`, everything else `"quick"`. `chicken-fajitas` is
`"quick"` despite being a leftover child — it *is* a quick assembly job, and its role in a
run comes from `leftoverOf`, not from `prepEffort`.

**Existing users' `localStorage["mp_library"]`** is a copy of the seed made on first run
and will not have the field. No migration code — `effortOf()` defaults absent to
`"quick"`, so an unmigrated library degrades to "everything is quick", which still
generates a valid plan (just fewer batch runs). Writing a localStorage migration for a
single-user app is not worth the code.

**Discover-added meals:** `MP.addToLibrary(meal)` in `data.js` must set
`prepEffort: "quick"` on the record it stores if the field is absent. TheMealDB has no
effort concept; one line at the point of conversion, and the library stays uniform.

---

## 6. Browse & Add search

`index.html`, inside the "Your Library" section, immediately before `#library-grid`:

```html
<input type="search" id="library-search" class="search-input"
       placeholder="Search your library — name, meal type or ingredient"
       aria-label="Search your library">
```

Native `type="search"` gives the clear button, mobile search keyboard and Escape-to-clear
for free. No debounce — the library is tens of items, filtering is a synchronous array
scan.

Filter predicate goes in `data.js` next to `esc`/`labelize` so the test page can load it
without `app.js`'s DOM dependencies:

```
/**
 * Case-insensitive substring match over name, mealTypes, and ingredient
 * keys/labels. Blank/whitespace query returns the array unfiltered.
 */
MP.filterMeals(meals, query) -> Meal[]
```

Matched haystack per meal, joined and lowercased once:
`meal.name`, `...meal.mealTypes`, and for each ingredient `ing.key` (with `_` → space, so
"greek yogurt" matches `greek_yogurt`) plus `ing.label` when present.

`app.js`:
- `renderLibrary()` takes no argument still, but reads the current query from
  `#library-search` and renders `MP.filterMeals(library, q)`.
- `init()` adds `document.getElementById("library-search").addEventListener("input", renderLibrary)`.
- When the filtered result is empty **and** the query is non-blank, render
  `<p class="empty">No meals match “…”.</p>` into the grid — query text via `esc()`.
- Card markup, tag rows and the click-to-detail wiring are unchanged. The Discover deck
  is unaffected; it is a separate section and must not be filtered.

Escaping: `MP.filterMeals` only reads strings, never writes HTML. The existing `esc()`
path in `renderLibrary()` stays exactly as-is — TheMealDB content is still untrusted.

---

## 7. Wiring changes

**`plan.js`**
- Delete `BREAKFAST_CYCLE`, `LUNCH_CYCLE`, `SNACK_ID`, `DINNER_CYCLE` and the body of
  `generatePlan()`.
- `generatePlan()` becomes a thin call:
  `MP.Generator.generatePlan(library, tagsData.tags, tagsData.targets, shelfData)`.
- **Ordering bug to avoid:** `loadPlan()` is currently called in `init()` *after* the
  `Promise.all`, which is correct — but the Generate button handler also calls
  `generatePlan()`, and both now need `library`/`tagsData`/`shelfData` populated. They are
  by then; just don't hoist the call.
- `renderPlan()` day heading: `Day ${d.day}` → `Day ${d.day} · ${WEEKDAY[weekdayOf(...)]}`
  when `plan.startDate` is present, plain `Day N` when it is not. Short names
  (`Mon`,`Tue`,…). This is how the user eyeballs that the Fri/Sat/Sun rule fired.

**`plan.html`** — add `<script src="generator.js"></script>` **before** `plan.js`.
`index.html` does not need it.

**`sw.js`** — add `"generator.js"` to `SHELL` **and bump `CACHE` to `"meal-planner-v2"`**.
Without the version bump, installed PWAs keep serving the v1 shell and never fetch the new
file. Do **not** add `test.html` to the shell.

---

## 8. Verification (TDD + ponytail: one runnable check per non-trivial piece)

No test runner exists and none is being added (`CLAUDE.md`). The project's own "just open
it in a browser" model is the runner:

**`test.html`** at the repo root — a plain page that `<script>`-includes `data.js`,
`nutrition.js`, `shelf-life.js`, `generator.js`, then runs `assert`-style checks in one
inline script and prints `PASS`/`FAIL` lines into a `<pre>`. No framework, no fixtures, no
build step. Fetch-based `load()` functions are bypassed by passing literal fixture objects
straight to the pure functions. Open with the same `python3 -m http.server 8000`.

Checks — the minimum set that fails if the logic breaks:

1. `weekendRuns` from a known **Monday** === `[[5,6,7],[12,13,14]]`.
2. `weekendRuns` from a known **Saturday** === `[[1,2],[7,8,9],[14]]` (covers both
   truncated-run edges, at day 1 and at day 14).
3. `weekdayOf(startDate, 1)` returns the same weekday as a locally-constructed `Date` for
   that ISO string — guards the UTC-parse trap in §1.
4. Generated plan: the first day of every run of length ≥ 2 holds a `batchCook` meal, and
   the run's leftover days hold either the same id or a `leadsTo` child.
5. Generated plan: **no dinner id appears on consecutive days except inside a run** —
   this is the variety guard, and it is the check that fails loudest if the rewrite
   regresses to the old hardcoded cycle.
6. Generated plan from a deliberately tiny library (2 dinners, 1 breakfast, 1 lunch,
   1 snack): all 14 days fill, nothing throws, and dinners alternate — proves the
   oldest-used-first reuse fallback.
7. `MP.ShelfLife.rawSafeOn` on the real `shelf-life.json` values: `chorizo-pasta` on day 5
   is `true`; `roast-chicken` on day 5 is `false`; a pantry-only meal is `true`.
8. `MP.filterMeals`: matches by name fragment, by meal type (`"dinner"`), by ingredient
   (`"yogurt"` finds `greek_yogurt`); blank query returns the full array.

Plus one manual pass, since the rest is UI: open `plan.html`, Generate, confirm the day
headings show weekdays, that Fri/Sat/Sun share one cooked meal, that Mon–Thu vary, and
that the search box on `index.html` filters live.

---

## 9. Out of scope / notes for later

- **Stale doc label:** `docs/ARCHITECTURE.md:8` still reads
  `**Hermes bridge (new, Phase 2)**`. The roadmap has since split the work — the Hermes
  bridge is **Phase 4**. A one-line correction if it is trivially in reach while editing
  docs; otherwise leave it, it is not this phase's scope and must not pull architecture
  edits into a generator PR.
- **Freezer-aware batch planning** (see §3 ceiling) → `docs/FUTURE.md`.
- Shopping-list aggregation is **Phase 3** — this phase must not start summing
  ingredients, but the batch runs it generates are what Phase 3 will aggregate.
- No new dependency is introduced anywhere in this phase. Everything above is vanilla JS
  over data files that already exist.
