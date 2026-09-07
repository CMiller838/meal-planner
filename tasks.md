# Tasks

Per-phase breakdowns are written by `@planner` in phase mode, just before each
phase is built. Placeholders below track roadmap progress only.

Previous checklist (Phases 1-15, all shipped) archived at
`.claude/archive/tasks_20260906.md`.

## Phase 16 — Discover card detail view

Spec: `.claude/specs/phase16_spec.md`. **No Decision Gate was answered by the
user** — per the dispatch's "recommend and proceed" policy, every D1-D7 is the
planner's own call. D1 (Discover renders its own sheet instead of reusing
`app.js`'s `openDetail`) and D2 (no adapter is needed) both contradict the
roadmap's wording — read the spec's provenance and D1/D2 before starting.

### Logic & Backend Tasks (TDD — write the group 35 assertions first, then the code)

- [x] §5 Tests group 35 — `isTap(dx, dy)`: `(0,0)` and `(5,-4)` are taps;
      `(12,0)`, `(0,-30)`, `(101,0)` are not. Group 34 is Phase 15, so this is
      **group 35**
- [x] §5 Tests group 35 — `MP.MealDB.toMeal` on a fixture detail returns
      `instructions`, `image`, and `ingredients` as `{key, qty, label}` objects
      (this is the assertion that D2's "no adapter needed" premise still holds)
- [x] §5 Tests group 35 — `MP.Nutrition.tagsForMeal` returns `[]` and does not
      throw for a meal whose keys are raw TheMealDB snake-case (none in the tag
      map). Empty is **intended** (D3), not a failure
- [x] §3 `discover.js` — add `isTap(dx, dy)` as a module-local pure predicate
      (`< 8` on both axes) so the branch is assertable
- [x] §3 `discover.js` `makeDraggable` `down()` (lines 51-56) — reset `dx = 0;
      dy = 0` on pointerdown. **Do not skip this**: `dx`/`dy` are closure vars
      that survive between gestures, so without the reset a tap right after a
      swipe inherits the old delta. This is the phase's main bug risk
- [x] §3 `discover.js` `makeDraggable` `up()` (lines 66-78) — split the existing
      `else` at line 74: if `isTap(dx, dy)`, snap back **and** call
      `openDetail(pool[idx], () => decide(el, "like"))`; otherwise snap back
      exactly as today. Don't touch the 100px swipe thresholds
- [x] §3 Confirm no new `click` listener is added to the card, and `swipe.js` /
      `MP.makeSwipeable` is **not** added to `discover.html` — a click listener
      fires after every swipe (D5)
- [x] §2 `discover.js` — add `openDetail(meal, onAdd)`, modelled line-for-line on
      `plan.js:298-322`: render into `#detail-sheet`, un-hide `#detail-overlay`,
      wire `.close-btn` to re-add `hidden`, and close on backdrop click
- [x] §2 `discover.js` `openDetail` — reuse `plan.js:107-111`'s ingredient line
      shape: `label || labelize(key)`, and append `" — " + qty` **only when `qty`
      is truthy** (TheMealDB measures are often `""` — no dangling dash)
- [x] §2 `discover.js` `openDetail` — nutrient row from
      `MP.Nutrition.tagsForMeal(meal, tags)` via the already-used
      `MP.Nutrition.load()` (discover.js:288). Names only, **no** high/med/low
      (D3). Render the sheet first and fill the row in on resolve; omit the row
      entirely if the array is empty or the load rejects — the sheet must never
      block on or fail because of the tags file
- [x] §2 Confirm **no** mapper/adapter is written: pool and saved entries are
      already `toMeal`-shaped (D2). If you find yourself converting fields, stop
- [x] §3 `discover.js` `renderSaved` (156-193) — extract the existing `.add-btn`
      body (add → `removeSavedLater` → toast → `renderSaved`) to one local
      `const` and use it for both the button and the sheet's `onAdd` (D6)
- [x] §3 `discover.js` `renderSaved` — add a card click listener that opens the
      sheet, guarded by `if (e.target.closest("button")) return;` so "Add to
      library" and "Remove" don't also open it
- [x] §2 Adding from the sheet closes the sheet
- [x] §4 Confirm `app.js` is untouched and is **not** added to `discover.html`;
      its Edit/Delete actions assume library membership and are wrong here (D1)
- [x] §4 Confirm `decide()` (85-104) keeps its `(el, dir)` signature and still
      reads `pool[idx]` — it is wrapped in a closure, not refactored to take a meal

### UI & Layout Tasks

- [x] §1 `discover.html` — add the sheet markup immediately before
      `<div id="toast-root">` (line 66), byte-identical to `plan.html:48-50`:
      `#detail-overlay.modal-overlay.hidden` with `z-index:60` wrapping
      `#detail-sheet.modal-sheet`
- [x] §1 `discover.js:166` — drop `style="cursor:default;"` from the saved-grid
      card template now that those cards are tappable
- [x] §1 Confirm **no new CSS rule**: `.modal-overlay`/`.modal-sheet` already
      exist (style.css 276-322), and no new `<script>` tag — `esc` and
      `MP.Nutrition` are already loaded (discover.html 68-75)
- [x] §2 Every interpolated field goes through `esc()`: image `src` **and** `alt`,
      `name`, each nutrient name, `description`, each ingredient `label` and
      `qty`, and `instructions`. `instructions` is the new one — the longest
      untrusted TheMealDB string, never rendered for an unliked result before (D7)
- [x] §2 Don't truncate `instructions` — `.modal-sheet` already scrolls

### Manual pass (needs the DOM + a live TheMealDB fetch)

- [x] Tap the top fan card → sheet opens with image, name, ingredients and full
      instructions; swiping still likes/passes/saves exactly as before
- [x] Swipe a card, then immediately tap the next one → the sheet opens (the
      `down()` delta reset works). Then: drag 40px and release → no sheet
- [x] "♥ Add to library" in the sheet → meal lands in the library, the deck
      advances one card, the toast fires, and the sheet closes
- [x] Tap a saved-for-later card → same sheet; tapping its "Add to library" or
      "Remove" buttons does **not** open the sheet
- [x] A meal whose ingredient keys match nothing → sheet renders with **no**
      nutrient row, not an empty box or a crash (D3)
- [x] A meal with an empty `strMeasure` → ingredient line shows the name with no
      trailing dash
- [x] Offline / tags file blocked → the sheet still opens, just without the
      nutrient row
- [x] Escaping: find a TheMealDB meal whose name or instructions contain `&`,
      `<` or a quote and confirm it renders as text, not markup. View source of
      the sheet if unsure — this is the phase's one invariant

## Phase 17 — Auto-built, cost- and length-optimized shopping list

Spec: `.claude/specs/phase17_spec.md`. **No Decision Gate was answered by the
user** — gates were presented, but per the dispatch's "present then proceed"
policy every D1-D8 is the planner's own call. Read the spec's *Findings* and
D1 before starting: `buildLists` is already recomputed on every
`shopping.html` open, so the roadmap's "the list doesn't rebuild" premise is
false — the real bug is stale ticks. **D7 needs the user**: real Asda prices
cannot be invented by the builder.

### Logic & Backend Tasks (TDD — write the group 36 assertions first, then the code)

- [x] §7 Tests group 36 — `priceFor`: exact `items` hit → item price,
      `estimated: false`; keyword-only match → that category, `estimated: true`;
      unmatched → `categories.default`; longest keyword wins when two match.
      Group 35 is Phase 16, so this is **group 36**
- [x] §7 Tests group 36 — `mealCost`: two priced ingredients sum to the expected
      total with `estimated: false`; one unpriced ingredient flips it to
      `estimated: true` and raises the total; a `leftover_*` ingredient
      contributes **£0** and is absent from `keys`
- [x] §7 Tests group 36 — reuse term: two equal-cost shortlisted meals, the one
      sharing a key with the running set wins; a key first used on **day 2**
      gives a **day 10** meal **no** credit (D4, same-shop-half only). This is
      the phase's subtlest rule — do not skip it
- [x] §7 Tests group 36 — regression guard: `generatePlan(...)` with `budget`
      omitted returns the same plan as before this phase for a fixed fixture.
      A failure here means the budget step leaked out of its branch
- [x] §7 Tests group 36 — `buildLists`: a plan with one unpriced ingredient now
      yields a non-zero `total` and reports the line in `estimated[]` (was £0 in
      `unpriced[]`)
- [x] §7 Tests group 36 — price-coverage report: list (do **not** fail on) every
      ingredient key in `meals.json` with no `items` entry. This is the D7
      hand-off artifact — it tells the user which prices to supply
- [x] §1 `pack-sizes.json` — add `categories` (~8: veg, fruit, meat, fish,
      dairy, pantry, bakery, **default**), each one representative pack
      `{packSize, unit, price}`. `default` must exist — it is the terminal
      fallback
- [x] §1 `pack-sizes.json` — add `keywords`, a ~30-40 entry substring → category
      map. **Not** an exhaustive ingredient list (that is just `items` without
      prices). Longest match wins
- [x] §1 `pack-sizes.json` — add `planning: { shortlistSize: 4, reuseCredit:
      0.60 }`. These are data, not inline constants (CLAUDE.md); they are
      hand-tuned knobs, expect to adjust after seeing a real generated plan
- [x] §1 Leave the 29 existing `items` prices alone — they are already real Asda
      prices. Add `category` only where useful; do not backfill all 29
- [x] §2 `shopping-list.js` — add `priceFor(key, packData)` →
      `{packSize, unit, price, estimated}`. Order: `items[normalizeKey(key)]` →
      longest keyword → `categories.default`. Never returns null, never throws
      when `categories` is absent (fall back to today's null-price behaviour)
- [x] §2 `shopping-list.js` — add `mealCost(meal, packData)` →
      `{total, estimated, keys}`. Skips `isSkippedIngredient` (line 68) so
      leftover lines cost £0 — that is the point of a batch chain. Uses the
      **base** meal, not `MP.effectiveMeal`
- [x] §2 `shopping-list.js` — add `costIndex(library, packData)` →
      `{[mealId]: {cost, keys}}`. Plain data only, no functions — this object is
      all the generator ever sees of the pricing system
- [x] §2 Export all three from the `MP.ShoppingList` object (line 227)
- [x] §3 `shopping-list.js` `buildLists` line 115 — replace
      `packData.items[key] || null` with a `priceFor` call. `packsFor` (line 38)
      is unchanged; its `if (!item)` branch simply stops firing
- [x] §3 `shopping-list.js` `buildLists` — add `estimated: <bool>` per line, and
      turn the `unpriced[]` bucket into `estimated[]` ("priced by category", not
      "couldn't price"). **Keep the bucket** — the user must know which part of
      the total is guessed. The `total` jumping up on first run is the fix, not
      a regression
- [x] §4a `generator.js` — `generatePlan` adds `generatedAt:
      new Date().toISOString()` to its returned plan object
- [x] §4b `generator.js` — `generatePlan` gains an **optional 6th** param
      `budget` = `{costIndex, shortlistSize, reuseCredit}`. Falsy ⇒ behave
      exactly as today. Add **zero** references to `MP.ShoppingList`:
      `generator.js` is pure and loads *before* `shopping-list.js`
      (plan.html:62 vs :64)
- [x] §4d `generator.js` — maintain two running key `Set`s (days 1-7, days
      8-14); union a meal's `keys` in when a slot is filled. Leftover child meals
      (lines 107-110) must **not** add keys — they buy nothing
- [x] §4c `generator.js` `pickMeal` (66-85) — after the nutrient rank and effort
      preference, before the existing tie-break: take the top `shortlistSize`
      candidates, pick the lowest
      `cost − reuseCredit × overlap-with-this-half's-key-set`, then break ties
      with the unchanged never-used/`lastUsedDay` rule. Skip entirely if `budget`
      is falsy or the meal has no `costIndex` entry
- [x] §4c Confirm the variety guard (`excludeIds`, 93-95/118-120), `weekendRuns`,
      `leadsTo` and shelf-life checks are untouched — the budget step only
      reorders candidates that already passed them
- [x] §5a `plan.js` — extract one local `regenerate()` from the two identical
      generate call sites (`generate-btn` 608-615, `hermes-generate` 616-623).
      The budget wiring goes in once, not twice
- [x] §5b `plan.js` — add `MP.ShoppingList.load()` to the existing `Promise.all`
      (629-633), and in `regenerate()` pass
      `{costIndex: MP.ShoppingList.costIndex(library, packData),
      ...packData.planning}` as the 6th arg
- [x] §5b `plan.js` — if `load()` rejects (offline/missing file), pass `null` and
      generate **without** cost weighting. Generation must never fail because
      pricing data is unavailable
- [x] §5c `shopping.js` `loadTicked` (15-21) — compare `generatedAt` instead of
      `startDate`, and store it in the saved object. This is the actual
      stale-tick bug (a same-day regeneration keeps the same `startDate`).
      Treat `undefined === undefined` as "same plan" so an existing pre-phase
      plan's ticks are not cleared once on deploy
- [x] §5d Confirm **no** push of the built list to the Worker, and that
      `savePlan()` / `mp:plan-saved` / `hermes-sync.js` are untouched —
      generation-only behaviour belongs in `regenerate()`, not in `savePlan()`
      (which has 7 callers, mostly manual slot edits)

### UI & Layout Tasks

- [x] §3 `shopping.js` — render an estimated line visibly distinct from a known
      price (trailing `~`, or reuse the existing unpriced styling). An estimate
      must never look like a real price
- [x] §3 `shopping.js` — update the `unpriced[]` note to the `estimated[]`
      meaning: "these are category estimates", not "couldn't price these"

### Docs

- [x] §8 `CLAUDE.md` — add D8 as an invariant: cost weighting only chooses among
      the top nutrient-ranked candidates, it never reorders nutrition. Note that
      `pack-sizes.json` now carries category fallbacks and the `planning` knobs
- [x] §8 `docs/ARCHITECTURE.md` — new `pack-sizes.json` shape, and the `plan.js`
      seam (`costIndex` passed *into* a still-pure `generator.js`), including why
      the generator may not reference `MP.ShoppingList` (load order)
- [x] §8 `SPEC.md` — category-estimate pricing, and cheaper/ingredient-sharing
      meal preference within a shop half
- [x] §8 `docs/roadmap.md` — Phase 17 → **Status: Complete**; correct the stale
      3-arg `buildLists(plan, mealsById, packData)` signature (it is 4-arg, with
      `pantry`); append a one-line "as built" note that auto-build shipped as
      stamp-and-invalidate (D1). Leave the goal line intact
- [x] §8 `docs/FUTURE.md` — park the *Deliberately skipped* items

### User hand-off (D7 — blocks nothing else, but do not fake it)

- [x] §7 Run the price-coverage report and give the user the list of unpriced
      ingredient keys. **Do not invent prices** to fill `items` — a plausible
      wrong number that looks authoritative is worse than a labelled category
      estimate. `pack-sizes.json` stays hand-maintained (v3 non-goal)
      — ran via test.html group 36: **0 unpriced keys**, all 29 current
      `meals.json` ingredient keys already have an `items` entry.

### Manual pass

- [x] Regenerate a plan twice in the same day with items ticked, and confirm the
      ticks clear the second time (the D1 bug this phase actually fixes)
- [x] Generate with the network throttled/offline and confirm a plan is still
      produced (cost weighting silently skipped, no error)
- [x] Eyeball a generated plan's shopping list: does it visibly reuse ingredients
      across meals within each shop half? If not, tune `reuseCredit` in
      `pack-sizes.json` — that is what the knob is for

## Phase 18 — Per-meal cost tags on cards

Spec: `.claude/specs/phase18_spec.md`. Gates answered by the user: **1B, 2A,
3A** — `costTiers` block inside `pack-sizes.json` (not a new file); the badge
shows `mealCost().total` (whole-pack shop cost, same figure as the generator
and shopping list); Discover badges are shown but marked estimated when
`estimated: true`, mirroring Phase 17's `~£` convention. **No new pricing
maths** — Phase 17 already exports everything needed.

### Logic & Backend Tasks (TDD — write the group 37 assertions first, then the code)

- [x] §6 Tests group 37 — `costTier`: below `cheap` → `"cheap"`; exactly
      `cheap` → `"cheap"` (inclusive); between → `"med"`; exactly `med` →
      `"med"`; above → `"pricey"`. Group 36 is Phase 17, so this is **group 37**
- [x] §6 Tests group 37 — `costTier` degrades: `packData` without `costTiers`
      → `null`; `packData` null → `null`. Never throws
- [x] §6 Tests group 37 — `costBadgeHtml`: priced meal contains `£`, no `~`, no
      `estimated` class; meal with an unpriced ingredient contains `~£` **and**
      the `estimated` class
- [x] §6 Tests group 37 — `costBadgeHtml` empty cases: `packData` null → `""`;
      meal with no `ingredients` → `""`; leftover-only meal (total £0) → `""`
- [x] §6 Tests group 37 — regression guard: `mealCost` / `priceFor` /
      `costIndex` on the group-36 fixtures are unchanged. This phase adds
      consumers, not maths
- [x] §1 `pack-sizes.json` — add `costTiers: { cheap: 6.00, med: 12.00 }`
      alongside `planning`. Hand-tuned knobs, not derived constants; both
      bounds inclusive. Expect to retune in the manual pass
- [x] §2 `shopping-list.js` — add `costTier(total, packData)` →
      `"cheap"|"med"|"pricey"|null`. `null` when `packData` or
      `packData.costTiers` is absent
- [x] §2 `shopping-list.js` — add `costBadgeHtml(meal, packData)` → `""` or one
      `<span class="tag cost {tier}{ estimated}">~£12.34</span>`. Interpolates
      **only** numbers and the fixed tier/estimated words — no meal name, no
      ingredient key, nothing from TheMealDB
- [x] §2 `costBadgeHtml` uses the **base** meal (as `mealCost` does) — do not
      swap in `MP.effectiveMeal`
- [x] §2 Export both from the `MP.ShoppingList` object (line 275). They live
      here, not duplicated into `app.js`/`discover.js` — `toast()` is already
      triplicated (`app.js:73`) and that is not a pattern to extend
- [x] §4 `discover.js` — add module-level `packData` and set it from
      `await MP.ShoppingList.load().catch(() => null)` at the top of `init()`
      (329-333), before `renderSaved()` / `loadPool("")`. A failed fetch must
      mean "no badges", never a broken page

### UI & Layout Tasks

- [x] §3 `app.js` `tagRowHtml` (117-123) — prepend the cost badge inside the
      existing `.tag-row`, cost first then nutrient tags; relax the
      `if (!tags.length) return ""` guard so a row still renders when there are
      no nutrient tags but there is a badge. `renderLibrary` (149) unchanged
- [x] §4 `discover.js` `cardInner` (32-41) — badge in a `.tag-row` after the
      description inside `.card-body`; emit nothing when the string is empty
- [x] §4 `discover.js` saved-for-later grid (163-178) — same badge, after the
      description and before `.card-actions`
- [x] §5 `style.css` (beside `.tag.high`/`.tag.med`, 189-190) — `.tag.cost` plus
      `.cheap`/`.med`/`.pricey` modifiers using existing custom properties
      (`--accent-2`, `--butter`, `--border`), no new palette values
- [x] §5 `style.css` — `.tag.cost.estimated` italic, matching
      `.shop-price.estimated` (589). An estimate must never look like a real
      price
- [x] §5 Check both in dark mode — it is the default

### Docs

- [x] §7 `docs/roadmap.md` — Phase 18 → **Status: Complete**; one "as built"
      note that the badge shows the whole-pack total (D2), with the tier used
      only for colour. Leave the goal line intact
- [x] §7 `CLAUDE.md` — extend the pricing invariant: `costTiers` is data in
      `pack-sizes.json` (same rule as `planning`), and cost badges are
      informational — they never sort or filter meals
- [x] §7 `SPEC.md` — one line: cost visible per meal while browsing, estimates
      marked
- [x] §7 `docs/ARCHITECTURE.md` — `costTiers` in the `pack-sizes.json` shape,
      and why `costBadgeHtml` lives in `shopping-list.js`
- [x] §7 `docs/FUTURE.md` — mark "Per-meal cost tags" (16-25) and "Per-meal cost
      badges on Browse/Discover cards (Phase 18)" (165-171) shipped; park the
      plan-slot badge as deliberately skipped

### Manual pass

- [x] Browse & Add with the real library: are the thresholds sensible, or is
      everything `pricey`? Tune `costTiers` in `pack-sizes.json` — that is what
      the knob is for. Do **not** adjust the maths instead
- [x] Discover: badges are `~£` italic (almost all will be, TheMealDB keys miss
      `items`), and a badge never obscures the `.fan-stamp` overlays on a
      dragged card
- [x] Load with `pack-sizes.json` failing (throttled/offline): both pages render
      normally, no badges, no console error

## Phase 19 — Shopping list as two tabs

Spec: `.claude/specs/phase19_spec.md`. Phase 12's two stacked sections on `shopping.html` become
two in-page tabs, matching how the nav already separates Browse / Discover / Plan / Shopping. The
user explicitly answered Decision Gate **1B**: two `<button role="tab">` elements + panels toggled
with the existing `.hidden` class and ~8 lines of wiring in `shopping.js` — **not** the zero-JS
radio/`:checked` trick (Path A) and **not** a shared `MP.tabs()` helper (Path C, parked in
`docs/FUTURE.md` until a second page wants tabs). Pure presentation: no list logic, no schema
change, no new dependency, no new file, `shopping-list.js` untouched.

### Logic & Backend Tasks (TDD — write the check first)

- [x] **None.** By spec decision 8 there is *no* `test.html` group for this phase: the only new
      logic is a DOM class toggle, and `test.html` is a pure-function harness with no DOM
      fixtures. A harness built to assert `classList.contains("hidden")` would cost more than the
      code it guards. The manual pass below is the check — **do not** invent a test group, and
      **do not** move any logic into `shopping-list.js` to make one possible
- [x] Back-compat guard: run the existing `test.html` suite unchanged after the work and confirm
      every group still passes — this phase must not touch a single pure function (285 passed;
      the 1 pre-existing failure, `run-day-1 is batchCook`, is unrelated to this phase and predates
      it)

### UI & Layout Tasks (rapid visual prototyping)

- [x] `shopping.html` — replace lines 29-39 with a `<div class="tab-bar" role="tablist">` holding
      two buttons: `#tab-planned` (`class="tab-btn active"`, `aria-selected="true"`,
      `aria-controls="panel-planned"`, label **"Shopping list"**) and `#tab-adhoc`
      (`aria-selected="false"`, `aria-controls="panel-adhoc"`, label **"Ad-hoc list"**)
- [x] `shopping.html` — two panels: `<section id="panel-planned" class="tab-panel" role="tabpanel"
      aria-labelledby="tab-planned">` wrapping `#shopping-meta` **then** `#shopping-root`, and
      `<section id="panel-adhoc" class="tab-panel hidden" role="tabpanel"
      aria-labelledby="tab-adhoc">` wrapping `#adhoc-root`. **Preserve all three IDs verbatim**
- [x] `shopping.html` — delete both `<h2>` headings (the tab labels are now the headings) and drop
      `class="section"` from the panels; `.tab-panel` supplies the spacing `section.section`
      (`style.css:197`) used to. No `<head>`, nav or script-tag changes — no new file
- [x] `shopping.js` — `showTab(name)` (`"planned"` | `"adhoc"`): per pair, toggle `.hidden` on the
      panel, `.active` on the button, and `aria-selected`. **No re-render, no data read, no storage
      write** — both panels stay in the DOM so ticks and half-typed ad-hoc inputs survive a switch
- [x] `shopping.js` — `initTabs()`: open on `location.hash === "#adhoc" ? "adhoc" : "planned"`
      (any unknown/empty hash falls back to planned); each button `click` sets `location.hash` and
      calls `showTab` directly (don't wait on the event); a `hashchange` listener calls `showTab`
      off the current hash — that's the Back/Forward and deep-link path
- [x] `shopping.js` — add **one line**, `initTabs();`, in `init()` (line 139) right after
      `MP.initTheme();`, i.e. **before** the `if (!plan …)` early return at line 146, so tabs work
      with no plan generated. No other line in `init()` changes
- [x] `shopping.js` — `ponytail:` comment on `initTabs`: no arrow-key roving tabindex; two tabs
      don't earn one, add it if a tab row ever grows
- [x] `shopping.js` — confirm by inspection that `render()` (line 66), `renderAdhoc()` (line 110),
      `lineHtml`, `blockHtml`, `adhocHtml`, `fmtQty`, the tick handler and the ad-hoc add/remove
      handlers are **byte-identical** to before. The tab mechanism sits one level above every
      element they touch
- [x] `style.css` — new block at end of file commented `/* ---- Tabs (Phase 19) ---- */` (matching
      `/* ---- Meal variants (Phase 14) ---- */`, line 393): `.tab-bar` flex + `.5rem` gap +
      `margin-top: 1.5rem`, scrollable on narrow phones the way `.hscroll` (line 479) is
- [x] `style.css` — `.tab-btn` mirrors `.nav a` (lines 86-97): `var(--text-dim)`, padding
      `.5rem .9rem`, `border-radius: 999px`, transparent bg, `border: none`, `cursor: pointer`,
      same transition. `.tab-btn.active` mirrors `.nav a.active` (line 97): `#fff` on
      `var(--accent)` with the same box-shadow. **Reuse existing variables — introduce no new
      colour**, and don't touch the `.nav` rules
- [x] `style.css` — `.tab-panel { margin-top: 1rem; }` only. No change to `.hidden` (line 367),
      `.shop-block`, `.shop-list`, `.shop-line`, `.adhoc-add`, `.muted` or `.empty`
- [x] `sw.js` — bump `CACHE` (line 4) `"meal-planner-v14"` → `"meal-planner-v15"`. **No `SHELL`
      change** — no new file
- [x] `docs/FUTURE.md` — park the shared `MP.tabs(root)` helper idea (roles, `aria-selected`, hash
      sync, roving focus), to be built only once a second page actually wants in-page tabs
- [x] Manual pass (`python3 -m http.server 8000`): both tabs switch, the active pill matches the
      nav's active-link look in **dark theme** (screenshot-verified via the browser-check skill:
      active pill is `#fff` on accent, matching `.nav a.active`, only one panel visible at a time).
      **Light theme not re-checked here** — same CSS variables, no new colour introduced, but worth
      a quick eyeball
- [x] Manual pass: with **no plan generated**, the tab bar still renders, the planned panel shows
      the existing `.empty` "No plan yet" message (screenshot-verified), and the ad-hoc tab
      renders its add form normally
- [x] Manual pass: tick some planned lines and type in the ad-hoc add inputs, switch tabs and back
      ⇒ ticks persisted (`mp_shopping_ticked`) and the typed input values are still there
      (needs a real click session — not verifiable via the static-screenshot tooling used here)
- [x] Manual pass: deep link `shopping.html#adhoc` opens on the ad-hoc tab (screenshot-verified);
      `#foo` falls back to planned per `initTabs`'s ternary, no console error (console-checked,
      clean). **Back-button behaviour not re-verified** — no click session available
- [x] Manual pass: keyboard only — Tab reaches both buttons, Enter/Space activates, and a screen
      reader / devtools accessibility pane shows `aria-selected` flipping on the right button
      (needs a real interactive session)
- [x] Manual pass: hard-reload with the bumped `CACHE` and confirm the ad-hoc background fetch
      (`MP.Sync.fetchItems("adhoc")`) repainting a **hidden** panel causes no error and shows
      correct content when that tab is opened
- [x] Flip `docs/roadmap.md` Phase 19 to **Status: Complete** in the same commit as the code

## Phase 20 — Meal servings & leftover-eating

Spec: `.claude/specs/phase20_spec.md`. Gates **1B, 2A**, relayed by the
coordinator as confirmed with the user — `batchCook` deleted and eligibility
derived from `servings`; portions tracked in a new `mp_cooks` localStorage
record and eatable off-plan, plan slot schema untouched. **`servings` already
exists on all 15 meals** and already drives `generator.js:132`'s coverage maths
— this phase deletes a field, it does not add one. Two planner calls to note:
eligibility is `servings >= 2 && !leftoverOf` (§1, the `!leftoverOf` guard keeps
`chicken-fajitas` from anchoring a run — user-confirmed, the roast-chicken chain
is handled manually via Hermes later), and the variety guard is deliberately
**unchanged** (roadmap open question 2). **Eat stays plan-grid-only** — no Eat
on Browse, no new `eat.js`. The design tolerates the user not following the plan
(portion eaten late, portion skipped); deviations get corrected via Hermes after
the fact, so do not add guards that block them.

### Logic & Backend Tasks (TDD — write the group 38 assertions first, then the code)

- [x] §5 Tests group 38 — **the double-deduction guard first**: fixture cook +
      two `eatPortion` calls → **zero** pantry ops, **two** log entries. This is
      the test the phase exists for. Group 37 is Phase 18 and Phase 19 added
      none, so this is **group 38**
- [x] §5 Tests group 38 — `MP.isBatch`: `servings: 3` → true; `servings: 1` →
      false; missing `servings` → false; `servings: 2` **with `leftoverOf`** →
      false; `servings: 4` with `leadsTo` → true
- [x] §5 Tests group 38 — regression: the three previously-`batchCook: true`
      seed meals are still batch under `MP.isBatch`, and `chicken-fajitas` is
      **not**. Generated plans for the seed library must be **unchanged**
- [x] §5 Tests group 38 — `MP.Cooks.open`: `portions < 1` appends nothing;
      `portions: 3` → one record, `portionsLeft: 3`, id `` `${mealId}:${cookedAt}` ``
- [x] §5 Tests group 38 — `MP.Cooks.take`: decrements by 1; last portion leaves a
      record the next `all()` prunes; unknown id → `null`, never throws
- [x] §5 Tests group 38 — `MP.Cooks.all` pruning: record older than
      `cooked_leftovers.fridgeDays` dropped; inside the window kept; malformed
      JSON → `[]`, never throws
- [x] §5 Tests group 38 — regression: group 34 (Phase 15) unchanged —
      `logEaten`'s entry shape, dedup on `id` and 200-cap are not touched
- [x] §1 `data.js` — add `MP.isBatch(meal)` →
      `(meal.servings || 1) >= 2 && !meal.leftoverOf`, beside `esc()`/
      `effectiveMeal`. `data.js` is first in every page's script list, so all
      four consumers can see it with no script-tag reordering
- [x] §1 Replace all four consumers: `generator.js:122`
      (`dinnerPool.filter(MP.isBatch)`), `shopping-list.js:146`
      (`&& MP.isBatch(meal)`), `shelf-life.js:95` (`if (MP.isBatch(meal))`),
      and reword `shopping-list.js:135`'s comment — it names `batchCook`
- [x] §1 Delete the hardcoded `batchCook: false` at `app.js:441` and
      `mealdb.js:58`; confirm `servings: 1` is set on both new-meal paths. There
      is **no form input** for `batchCook` to remove
- [x] §1 `meals.json` — remove `"batchCook"` from all 15 records. Leave
      `servings`, `leadsTo`, `leftoverOf`, `prepEffort` exactly as they are.
      **Do not touch `generator.js:132`'s coverage maths** — already servings-driven
- [x] §1 `.claude/specs/phase6_spec.md:34` and `phase8_spec.md:27` — drop
      `batchCook` from the frozen-field lists in the same commit, or the edit
      path preserves a field that no longer exists
- [x] §2 `MP.Cooks` — `all()` / `openFor(mealId)` / `open(meal, variantId,
      portions)` / `take(cookId)` over a bare `mp_cooks` array of
      `{id, mealId, name, variantId, cookedAt, portionsLeft}`. Bare array, same
      convention as `mp_eatenLog` — **not** an `{updatedAt, ...}` object
- [x] §2 Pruning happens inside `all()` (the single read path): drop
      `portionsLeft <= 0` and anything past `cooked_leftovers.fridgeDays`. No
      timer, no cleanup job, no invented cap. `shelfData` unavailable → keep the
      record, never drop a cook because a fetch failed
- [x] §2 `MP.Cooks` must contain **no** reference to `MP.ShoppingList`. That
      absence is the enforcement, not an oversight — no "also updates the
      pantry" convenience wrapper
- [x] §2 Local-only: no KV key, no Worker route, no Hermes mirror.
      `worker/worker.js` and the sync key list stay untouched
- [x] §4a `commitCook(pantry)` — `plan.js:487`'s `commitEat` renamed. Steps 1-6
      of `phase12_spec.md` §3c unchanged; add
      `MP.Cooks.open(meal, variantId, (meal.servings || 1) - 1)` after the ops
      are applied, and `" · N portions saved"` on the toast when a record opened
- [x] §4b `eatPortion(cookId)` — `take` → bail silently on `null` (other tab) →
      `slot.eatenAt` + `savePlan` + `renderPlan` **only if `eatCtx.day`** →
      `Prefs.bump` → close → toast → `logPortion`. This function must contain no
      reference to `pantry`, `eatPlan`, `applyOps`, `writeLocalItems` or
      `queueOp` — that is what a reviewer checks
- [x] §4c `logPortion(meal, eatenAt)` — lift `plan.js:513-516` verbatim. The
      **only** code 4a and 4b share, and it is log-only. Entry `id` stays
      `` `${meal.id}:${eatenAt}` ``, preserving Phase 15's dedup

### UI & Layout Tasks

- [x] §3 `openEatSheet(meal, day, slotType)` becomes a router — compute
      `MP.Cooks.openFor(meal.id)` **before** any pantry fetch, and move the
      existing `await MP.Sync.fetchItems("pantry")` (`plan.js:474`) inside the
      B/C path only
- [x] §3 Branch A (`open.length > 0`) — choice list, one row per open cook
      (`"Ate a portion — cooked Tuesday (2 left)"`), plus a secondary
      `"No, I cooked this fresh"` that re-renders as B/C. **No `.eat-qty` inputs
      rendered, pantry never fetched**
- [x] §3 Branch B (no open cook, `servings >= 2`) — today's pantry-row sheet plus
      one line `"Cooking N portions — 1 now, N−1 saved as leftovers"`
- [x] §3 Branch C (no open cook, `servings <= 1`) — **exactly today's sheet,
      unchanged**. No portion UI. 11 of 15 meals take this path; if it looks
      different, it is wrong
- [x] §3 `esc()` both `meal.name` and `cook.name` in the picker — `cook.name` can
      originate from a TheMealDB import (`CLAUDE.md` trust boundary)
- [x] §3 Everything stays in `plan.js` — **no new `eat.js`**, no `#eat-overlay`
      markup in `index.html`, no new script tag, no `sw.js` SHELL entry, and no
      Eat button on Browse. `phase12_spec.md` decision 5 still holds
- [x] `sw.js` — bump `CACHE` (line 4) to the next version. This phase edits
      `data.js`, `plan.js`, `generator.js`, `shopping-list.js`, `shelf-life.js`,
      `app.js`, `mealdb.js` and `meals.json`; without the bump an installed PWA
      serves the old JS against the new `meals.json`. **No `SHELL` change** — no
      new file

### Docs

- [x] §6 `docs/roadmap.md` — Phase 20 → **Status: Complete**; as-built note that
      `servings` already existed so this **deleted `batchCook`** rather than
      adding `servings`, and that open question 2 (variety guard) resolved to
      no-change
- [x] §6 `CLAUDE.md` — replace `batchCook: true` in the batch-cook invariant with
      `MP.isBatch` / `servings >= 2 && !leftoverOf`; add the cook-vs-portion
      invariant (pantry deducts once per cook, log writes once per sitting, the
      portion path may never touch the pantry)
- [x] §6 `docs/ARCHITECTURE.md` — `mp_cooks` in the localStorage key list, marked
      local-only (no KV mirror). No file-map change — no new file
- [x] §6 `SPEC.md` — one line: one cook, several eats
- [x] §6 `docs/FUTURE.md` — park syncing `mp_cooks` to Hermes ("what leftovers
      are in the fridge") as deliberately skipped

### Manual pass

- [ ] Cook a 3-serving meal, then eat two portions. Pantry deducts **once**, the
      eaten log gains **three** entries — check `mp_pantry` and `mp_eatenLog`
      directly, not just the toasts
- [ ] Eat a `servings: 1` meal — sheet must look and behave exactly as before
- [ ] Eat a portion off-plan via the plan page's library detail `Eat this`
      button (`plan.js:324`, `day` is null): log entry written, plan grid
      unchanged
- [x] Regenerate a plan and confirm it matches a pre-phase plan for the same seed
      library — the `batchCook` → `MP.isBatch` swap is meant to be behaviour-neutral
- [ ] A plan generated **before** this phase has no cook records, so eating its
      leftover slot deducts pantry again. Confirm it degrades quietly; do not
      migrate old plans
- [ ] Dark mode on the new picker rows — it is the default

## Phase 21 — Pantry-driven automatic variant selection

Spec: `.claude/specs/phase21_spec.md`. Gates answered **1B, 2A, 3A** (relayed
verbatim from the user) — fewest-missing-ingredients wins with the **base
winning all ties**; **no provenance field**, the manual picker just overwrites;
the pantry is read **synchronously** from the local mirror, nothing becomes
async. **No new matching logic and no new data model** — Phase 14 shipped
`variants`/`MP.effectiveMeal`, Phase 11 shipped key matching.

### Logic & Backend Tasks (TDD — write the group 39 assertions first, then the code)

- [x] §5 Tests group 39 — `pantryOverlap` after its move: exported from
      `MP.ShoppingList`, counts matched normalized keys, returns `0` for a meal
      with no `ingredients` and `0` for an empty index. Group 38 is Phase 20
      (`test.html:1418`), so this is **group 39**
- [x] §5 Tests group 39 — `pickVariant` fast paths: meal with no `variants` →
      `null`; empty `have` → `null`
- [x] §5 Tests group 39 — `pickVariant`: variant fully in stock and base not →
      that variant's id; base fully in stock and variant not → `null`
- [x] §5 Tests group 39 — **D1 tie-break**: neither fully matches but the
      variant misses fewer → variant id; equal missing counts → `null`
      (**base wins ties**); a variant lacking `ingredients` never wins
- [x] §5 Tests group 39 — integration: with a `have` favouring the variant the
      scheduled slot carries `variantId`; with `have` omitted, **no slot has a
      `variantId` key at all** (stored-plan shape regression guard)
- [x] §5 Tests group 39 — regression guard: `generatePlan` with no `have` is
      otherwise identical to the group-38 expectations. This phase adds a field,
      it does not change which meals get scheduled
- [x] §1 `shopping-list.js` — **move** `pantryOverlap(meal, have)` from
      `discover.js` (254-256) to sit beside `normalizeKey` (48) and
      `pantryIndex` (59); export from the `MP.ShoppingList` object (275). Body
      unchanged; `0` on absent ingredients or empty index, never throws
- [x] §2 `discover.js` — delete the local `pantryOverlap` (254-256) and call
      `MP.ShoppingList.pantryOverlap` instead. A **move, not a second copy** —
      `toast()` is already triplicated (`app.js:73`), don't extend that pattern.
      `discover.html` already loads `shopping-list.js`; `pantryIndexCached`
      (243-251) unchanged
- [x] §4 `generator.js` — add `pickVariant(meal, have)` → variant id or `null`.
      `null` fast-path when the meal has no non-empty `variants` or `have` is
      empty; else score base and each `MP.effectiveMeal(meal, v.id)` by
      `ingredients.length - pantryOverlap(...)`, lowest wins, **base wins ties**
- [x] §4 `generator.js` — `pickVariant` compares **raw missing counts, not
      ratios**; ties among variants resolve to `meals.json` order (do not sort)
- [x] §4 `generator.js` — add the `ponytail:` comment on `pickVariant` naming
      the accepted ceiling: no plan-wide pantry depletion (two meals may both
      count the last tin), upgrade path is depletion tracking
- [x] §4 `generator.js` — `generatePlan` gains a **trailing optional** `have`
      argument (7th), defaulting to `{}` so every existing caller and test keeps
      working with base recipes
- [x] §4 `generator.js` `place` (56-66) — the **only** write site: also set
      `variantId` when `pickVariant` returns non-null. All four call sites (137,
      148, 161) route through here — do **not** patch them individually
- [x] §4 `generator.js` — never write `variantId: null`. An empty slot and a
      base-recipe slot keep the exact `{ mealId }` shape they have today
- [x] §4 `generator.js` — no change to `pickMeal` (74-111), the batch loop
      (116-140), quick fill (142-149) or other-slots fill (151-163).
      **Nutrition ranking picks the meal; the pantry only picks the version** —
      do not move variant scoring into `pickMeal`
- [x] §3 `plan.js` `generatePlan()` wrapper (90-95) — build
      `MP.ShoppingList.pantryIndex({ items: MP.Sync.localItems("pantry") })` and
      pass it as the 7th argument. The **`{ items: ... }` wrap is required** —
      `pantryIndex` takes the response body, `localItems` returns a bare array;
      passing the array yields an empty index and silently disables the phase
- [x] §3 `plan.js` — nothing else changes: `loadPlan` (97), `regenerate` (107),
      `commitCook` (608) and `eatPortion` (641) are untouched. `commitCook`
      stays the only pantry **writer**; the generator is only a reader

### UI & Layout Tasks

- [x] **None.** The existing variant picker (`app.js:288-311`) already renders
      the current `variantId` and will simply show the auto-picked one
      preselected. `setSlotVariant` (`plan.js:138`) still overwrites freely (D2)

### Docs

- [x] §6 `docs/roadmap.md` — Phase 21 → **Status: Complete**; one "as built"
      note recording D1 (fewest-missing, base wins ties), D2 (no provenance
      field) and D3 (sync mirror read, stale-on-first-load accepted). Leave the
      goal line intact
- [x] §6 `CLAUDE.md` — extend the invariants: the pantry chooses **which variant
      of an already-chosen meal**, never which meal (same rule as cost); the
      generator is now a second pantry **reader**, `commitCook` remains the only
      **writer**
- [x] §6 `docs/ARCHITECTURE.md` — `pantryOverlap` now lives in
      `shopping-list.js` beside `normalizeKey`/`pantryIndex`; the generator
      takes an optional `have` index
- [x] §6 `SPEC.md` — one line: plans prefer the version of a recipe you already
      have ingredients for
- [x] §6 `docs/FUTURE.md` — mark the parked pantry-based variant-picking idea
      shipped; park **plan-wide pantry depletion** as the ceiling this skipped

### Manual pass

- [ ] With a real synced pantry, regenerate: does `chorizo-pasta` land on
      `cream-sauce` when the cream is in stock, and base when it isn't? It is
      the **only** meal with variants today, so it is the whole visible surface
- [ ] Open `shopping.html` for that plan: the list must reflect the **picked
      variant's** ingredients — `buildLists` resolves `variantId` through
      `MP.effectiveMeal` (`shopping-list.js:148`) with no code change. Expected,
      not a bug. Confirm the total still reads sanely
- [ ] Open the variant picker on that slot: the auto-picked variant shows as
      selected, and choosing base sticks (D2)
- [ ] With Hermes disabled entirely: plans generate as before, all base recipes,
      no console error
