# Tasks

Per-phase breakdowns are written by `plan-phase` (phase mode), just before each
phase is built. Placeholders below track roadmap progress only.

Previous checklist (Phases 1-15, all shipped) archived at
`.claude/archive/tasks_20260906.md`. Previous checklist (Phases 16-21, all
shipped) archived at `.claude/archive/tasks_20260913.md`. Previous checklist
(Phases 22-26, all shipped) archived at `.claude/archive/tasks_20260920.md`.

---

## Phase 27: Budget soft-preference

Spec: `.claude/specs/phase27.md`. Decisions: 1B (adaptive pressure),
2A (per-week), 3A (extend `mp_planPrefs`).

### Logic & Backend Tasks (TDD — write the group 44 assertions first, then the code)

- [x] §8 Tests group 44 — **the regression guard first**: `generatePlan(...)`
      with `prefs.budgetTarget = 0` is deep-equal to the same call with the
      field absent and to `prefs: {}`. Group 43 is Phase 26
      (`test.html:1743`), so this is **group 44**
- [x] §8 Tests group 44 — `rankSlot` with `pressure: 0` vs `pressure` absent →
      identical ordering
- [x] §8 Tests group 44 — `rankSlot` with `pressure: 1` on a fixture whose
      5th-ranked meal is the cheapest: it reaches the head at pressure 1 and
      does **not** at pressure 0
- [x] §8 Tests group 44 — `rankSlot` at any pressure returns every meal in the
      pool (minus `excludeIds`): same length, same id-set. Nothing is filtered
- [x] §8 Tests group 44 — degrades: `budget.budgetTarget` config absent, and
      `maxShortlist <= shortlistSize`, both give ordering identical to
      pressure 0
- [x] §8 Tests group 44 — spend accumulation: tight target yields a lower
      total plan cost (summed via `MP.ShoppingList.costIndex`) than target 0,
      **and** every one of the 14 days still has a non-null dinner
- [x] §8 Tests group 44 — leftover days (`countsTowardBudget === false`) add
      nothing to spend
- [x] §8 Tests group 44 — per-half reset (D2): a week-1 blowout leaves week 2
      identical to the cheap-week-1 fixture
- [x] §8 Tests group 44 — `MP.PlanPrefs.get()`: no key → `budgetTarget: 0`;
      `"75"` → `75`; `null` / `"abc"` / `-5` / `{}` / `NaN` → `0`, no throw
- [x] §8 Tests group 44 — `save([2], ["comfort"], 75)` round-trips with
      `budgetTarget: 75` and untouched `busyDays`/`chips`;
      `save([], [], undefined)` stores `0`, not `undefined`
- [x] §1 `pack-sizes.json` — add `planning.budgetTarget`
      `{ max: 120, step: 5, default: 0, maxShortlist: 10 }`. No other change
      to the file; no number from this block may appear as a literal in JS
- [x] §2.1 `plan-with-me.js` — `MP.PlanPrefs.get()` returns `budgetTarget`
      (finite `>= 0`, else `0`); `save(busyDays, chips, budgetTarget)` takes
      and coerces a third arg. `save` writes exactly what it's given — no
      "preserve previous when undefined" behaviour
- [x] §4.1 `generator.js` — add `shortlistSizeFor(budget, pressure)` (linear
      between `shortlistSize` and `maxShortlist`, integer, clamped both ends,
      not exported) and use it for the `ranked.slice(0, …)` width at line 123.
      The scoring, min-score winners and LRU tie-break below it are unchanged
- [x] §4.1 `generator.js` — update the layer comment (lines 79-81) so layer 4
      reads "budget shortlist (width scales with budget pressure)". Layer
      order unchanged
- [x] §4.2 `generator.js` — `spent = { first: 0, second: 0 }`; accumulate
      `entry.cost` inside `place()`'s existing `if (entry)` branch (line 185),
      which already excludes leftover days
- [x] §4.2 `generator.js` — `pressureFor(dayNum)`: target is
      `prefs.budgetTarget` used as-is (£/week, not halved); expected =
      `target * (dayInHalf - 1) / 7`; `clamp((spent[half] - expected) / target,
      0, 1)`; `0` when there's no target or no config. Thread it through
      `pickMeal` (line 198-199) as `pressure:`. No other call site changes,
      no export change
- [x] §5 `hermes-sync.js:290` — pass `remote.budgetTarget` as `save`'s third
      arg. `pushPlanPrefs` needs no change; no new route
- [x] Confirm **zero-line diff** in `plan.js`, `worker/worker.js`,
      `shopping-list.js`, `nutrition.js` — new `planning` keys and
      `budgetTarget` already reach the generator via existing plumbing
      (spec §"Findings"). Editing `plan.js` means something is wrong

### UI & Layout Tasks (rapid visual prototyping)

- [x] §3 `plan-with-me.html` — `<h3>Weekly budget</h3>` + `#budget-row` with
      `<input id="budget-range" type="range">` and `#budget-label`, inserted
      after `#chip-row` and before `.top-actions`. Markup `max`/`step`/`value`
      are placeholders overwritten from data
- [x] §3 `plan-with-me.html` — add `<script src="shopping-list.js">` before
      `plan-with-me.js`
- [x] §3 `style.css` — `.budget-row { display:flex; align-items:center;
      gap:.6rem }` and `#budget-range { flex:1 }` beside the Phase 23
      `.chip-row` rule. No custom thumb/track styling
- [x] §2.2 `plan-with-me.js` — `renderBudget(planning)` wires the slider from
      `MP.ShoppingList.load()`'s `planning.budgetTarget`; hides `#budget-row`
      when the load fails or the block is absent (same pattern as the chip
      row, lines 73-76). Slider `max` widens to fit a saved value above it
- [x] §2.2 `plan-with-me.js` — prefill `budgetTarget` in `init()` (line 96)
      alongside busy days/chips; one `input` listener updating the label via
      `textContent` (`"No target"` / `"£75 a week"`) and `renderSummary()`
- [x] §2.2 `plan-with-me.js` — `renderSummary()` appends `· £N/wk` only when
      the target is non-zero; the zero case reads exactly as today
- [x] §2.2 `plan-with-me.js` — Generate handler (line 132) passes
      `budgetTarget` to `MP.PlanPrefs.save`. Nothing else in that handler
      changes
- [x] §6 `sw.js` — bump `CACHE` to `"meal-planner-v20"`; grep the shell array
      for `shopping-list.js` and add it only if missing. No new files
- [x] §9 Manual pass — items 1-11 (one-tap Generate unchanged with no target;
      slider tracks in £5 steps; tight target still fills all 14 days; loose
      target matches the no-target plan; prefill; missing/corrupt key;
      blocked `pack-sizes.json`; dark + light; offline on v20)
- [x] §7 Docs — `docs/roadmap.md` Phase 27 records the resolved fork and is
      marked shipped; `CLAUDE.md` updates the `mp_planPrefs` shape to include
      `budgetTarget` and extends the "Cost weighting never reorders nutrition"
      bullet; `docs/ARCHITECTURE.md` gets the same shape update plus the new
      `planning.budgetTarget` block; `SPEC.md` only if it enumerates plan
      preferences

## Phase 28: Generic ingredient-substitution groups

Spec: `.claude/specs/phase28.md`. Decisions: 1B (new
`substitution-groups.json`), 2B (materialised swap on the plan slot).

### Logic & Backend Tasks (TDD — write the group 45 assertions first, then the code)

- [ ] §10 Tests group 45 — **the regression guard first**: `generatePlan(...)`
      with `budget.groups` absent is deep-equal to the same call with
      `budget.groups = {}`, and no slot gains a `subs` key. Group 44 is
      Phase 27 (`test.html:1800`), so this is **group 45**
- [ ] §10 Tests group 45 — `rankSlot` with `budget.groups` set returns every
      meal in the pool (minus `excludeIds`): same length, same id-set.
      Nothing is filtered
- [ ] §10 Tests group 45 — `subCredit: 0` gives ordering identical to
      `budget.groups` absent; a swap-only meal reaches the head with
      `subCredit` set and not with `subCredit: 0`; an exact-overlap meal of
      the same cost still outranks a swap-only one (`reuseCredit > subCredit`)
- [ ] §10 Tests group 45 — **the test this phase exists for**: `generatePlan`
      writes `subs: [{ from, to, label }]` on the slot, and
      `MP.ShoppingList.buildLists` then contains the swapped-in key and not
      the swapped-out one — one pack covering two dinners
- [ ] §10 Tests group 45 — **exclusion gate**: a swap that would put veg in a
      toastie (and one with mushroom wrongly listed as a group member) leaves
      the meal placed with **no** `subs`. The exclusion rejects the swap,
      never the meal
- [ ] §10 Tests group 45 — at most one swap per meal (`subs.length === 1` on a
      two-swappable-ingredient fixture); leftover days
      (`countsTowardBudget === false`) get no `subs`; a week-1 purchase never
      enables a week-2 swap
- [ ] §10 Tests group 45 — `MP.applySubs`: swaps key/label, keeps `qty` and
      `meal.id`, leaves other ingredients alone, never mutates the input;
      `undefined` / `[]` / non-array / unmatched `from` all return the meal
      unchanged with no throw
- [ ] §10 Tests group 45 — `MP.effectiveMeal(meal, variantId, subs)` applies
      the variant **then** the subs; a sub not matching the variant's
      ingredients is a no-op; two-argument calls behave exactly as before
- [ ] §10 Tests group 45 — `MP.subsLabel` (`[]`/`undefined` → `""`) and
      `MP.ShoppingList.groupIndex` (`{}`/`null`/missing `groups` → `{}`;
      duplicate key → first group wins; members keyed by normalised key)
- [ ] §1 `substitution-groups.json` — new root file: `{ note, groups: [{ id,
      label, members: [{ key, label }] }] }`. Seed **two or three** groups only,
      from ingredients genuinely interchangeable in this library. **Never list
      mushroom.** `substitutions.json` is not touched
- [ ] §2 `pack-sizes.json` — add `planning.subCredit: 0.30`. Must stay below
      `reuseCredit`; no other change to the file, no literal in JS
- [ ] §3.1 `shopping-list.js` — `loadGroups()` (memoised fetch, `{}` on
      failure, same pattern as the `pack-sizes.json` loader at lines 13-17)
      and `groupIndex(groupsData)` → `{ [normalizeKey(key)]: { groupId,
      members } }`, first group wins on a duplicate. Export both. Reuse
      `normalizeKey` — **no second alias table**
- [ ] §3.2 `plan.js:92-94` — add `groups: MP.ShoppingList.groupIndex(await
      MP.ShoppingList.loadGroups())` to the `budget` object. `subCredit`
      arrives free via the existing `...packData.planning` spread
- [ ] §4 `data.js` — `applySubs(meal, subs)` (exact `ing.key === sub.from`,
      no normaliser, keeps `qty`, never mutates, same object back when empty)
      and `subsLabel(subs)`; `effectiveMeal(meal, variantId, subs)` gains an
      optional third arg applied **after** the variant merge. Export
      `applySubs`/`subsLabel`; existing 2-arg calls unchanged
- [ ] §5.1 `generator.js` — `groupMates(groups, normKey)` and
      `subsFor(meal, half, groups)`: first recipe-order ingredient absent from
      `half` with a group mate present in `half`; returns `[]` or one
      `{ from, to, label }`. **Last step before returning is
      `MP.Exclusions.check(MP.applySubs(...))` — `!ok` → `[]`.** Neither helper
      is exported (reached via `rankSlot`/`generatePlan`, Phase 27 precedent)
- [ ] §5.2 `generator.js` — layer 4 score line only (lines 137-141) becomes
      `c.cost - reuseCredit * overlap - subCredit * swaps` (swaps is 0 or 1,
      `subCredit` finite else 0). The shortlist width, min-score winners and
      LRU tie-break below it are unchanged; layers 1-3 untouched
- [ ] §5.2 `generator.js` — update the layer comment (lines 78-82) so layer 4
      reads "budget shortlist (cost, pack reuse + group substitutions)".
      Layer order unchanged
- [ ] §5.3 `generator.js` — `place()`: hoist `half`, compute `subs` from the
      **effective** (variant-resolved) meal, skip it for
      `countsTowardBudget === false`, write `subs` onto the slot **only when
      non-empty**, and map `entry.keys` through the swap before `half.add` so a
      third meal can reuse the pack. `spent` is unchanged. No signature or
      export change (`generator.js:294`)
- [ ] §6 `shopping-list.js:153` (`purchaseOccurrences`), `shelf-life.js:127`,
      `plan.js:125` (`effectiveMealAt`) and `plan.js:584` (`openEatSheet`) —
      pass `slot.subs` as `effectiveMeal`'s third arg. `plan.js:584` is what
      makes `commitCook`'s pantry deduction swap-correct
- [ ] §6 `hermes-sync.js:235` — one line mirroring the `variantId` line so the
      pushed plan carries `subs`. No new route, no Worker change
- [ ] §6 Confirm **zero-line diff** in `substitutions.json`, `mealdb.js`,
      `worker/worker.js`, `exclusions.js`, `nutrition.js`, `plan-with-me.js`,
      and in `plan.js`'s `setSlotMeal` / `setSlotVariant` / `applyPlacements`
      (a fresh slot object already drops stale subs; remote placements never
      carry them). Editing any of these means something is wrong

### UI & Layout Tasks (rapid visual prototyping)

- [ ] §6/§7 `plan.js:534` (day card) and `plan.js:471-475` + `plan.js:579`
      (`openDetail(meal, variantId, subs)`) — resolve with `slot.subs` and
      append `MP.subsLabel(slot.subs)` beside the existing `MP.variantLabel`
      output, via `textContent` (or `esc()` if interpolated). No `innerHTML`
      with unescaped content
- [ ] §7 `style.css` — only if the variant label has no muted style to reuse:
      one span rule beside it. No new component
- [ ] §8 `sw.js` — bump `CACHE` to `"meal-planner-v21"` and add
      `"substitution-groups.json"` to the shell array beside
      `"substitutions.json"` (line 33). One new file this phase
- [ ] §11 Manual pass — items 1-10 (one-tap Generate unchanged; swap note on a
      day card and in the detail sheet with the original qty; shopping list
      shows the swapped-in key only; pantry deducts the swapped ingredient;
      meal change clears the swap; blocked `substitution-groups.json`;
      hand-added mushroom group never reaches a plan; garbage `mp_plan.subs`;
      dark + light; offline on v21)
- [ ] §9 Docs — `docs/roadmap.md` Phase 28 records the resolved fork (new file
      + materialised `slot.subs`) and is marked shipped; `CLAUDE.md` gains the
      substitution-groups invariant (data-file-only swaps, exclusions
      re-checked after the swap and a failed check drops the swap not the meal,
      never reorders nutrition, `slot.subs` is generator-written only,
      `substitutions.json` stays exclusion-only); `docs/ARCHITECTURE.md` gets
      the new data file, `planning.subCredit` and the slot `subs` field;
      `SPEC.md` only if it enumerates data files or the plan-slot shape

## Phase 29: Live-build-watching (staged local generation render)

Spec: `.claude/specs/phase29.md`. No gates this phase — the roadmap gate
(`docs/roadmap.md:106-125`, Gate 1 Path A) already fixed the mechanism as a
staged **local** render, and both remaining forks collapse under the CSS-stagger
approach (flag on `renderPlan`, no interaction handling needed). Render-side
only: `generator.js` gets a **zero-line diff**.

### Logic & Backend Tasks (TDD — no new test group; see §6)

- [x] §6 Confirm **no new `test.html` group** is added (group 45 / Phase 28 at
      `test.html:1933` stays the latest) — this phase adds no pure logic. Run
      the existing suite before and after: every group must still pass, and any
      generator assertion that changes means `generator.js` was wrongly touched
- [x] §1 `plan.js` — `renderPlan(staged)` gains one optional parameter
      (default falsy). Add `STAGE_STEP_MS = 30` / `STAGE_MAX_MS = 1800` as
      module constants. Body unchanged up to and including
      `root.innerHTML = html` (`plan.js:238`) and the handler wiring
      (`plan.js:240-246`)
- [x] §1 `plan.js` — after `wireMoveBtns(root)` and **before**
      `if (dayCtx) renderDayView();`: when `staged`, `root.classList.add(
      "staging")` and set each `.slot-card`'s `style.animationDelay` to
      `Math.min(i * STAGE_STEP_MS, STAGE_MAX_MS) + "ms"` in `querySelectorAll`
      document order; **`else` branch must `classList.remove("staging")`** —
      `#plan-root` survives the `innerHTML` swap, so an unstaged re-render that
      leaves the class on makes every card animate at once
- [x] §1 Add the ponytail comment naming the ceiling (cosmetic staging of a
      finished plan; upgrade path is a `function*` `generatePlan` yielding per
      `place()`, deferred on purpose)
- [x] §2 `plan.js:110-114` — `regenerate(staged)` gains the same pass-through;
      last line becomes `renderPlan(staged)`. No other line moves
- [x] §2 `plan.js:869-874` — the `hermes-generate` handler calls
      `regenerate(true)`. **Only** call site that stages. `ackPlanFlag`,
      hiding `#hermes-banner` and the toast are unchanged and still run
      immediately, concurrently with the reveal
- [x] §2 `plan.js:863-868` (`generate-btn`) and every other `renderPlan()`
      caller (`plan.js:256, 337, 415, 459, 731, 756, 843, 904`) — **zero-line
      diff**, all stay instant. Verify none passes `renderPlan` as a function
      reference (none does today), so no event object can arrive as `staged`
- [x] Confirm **zero-line diff** in `generator.js`, `worker/worker.js`,
      `hermes-sync.js`, `nutrition.js`, `shelf-life.js`, `shopping-list.js`,
      `data.js`. Editing any of them means the phase went wrong — no progress
      callback, no async/yielding `generatePlan`, no endpoint, no polling
- [x] Confirm `plan.js` still loads in `test.html` with no `#plan-root`
      (`plan.js:917-919`) — all new code sits inside `renderPlan`, nothing new
      runs at file-evaluation time

### UI & Layout Tasks (rapid visual prototyping)

- [x] §3 `style.css` — one `@keyframes mp-slot-in` (opacity 0→1,
      `translateY(6px)`→none) and `#plan-root.staging .slot-card { opacity: 0;
      animation: mp-slot-in 220ms ease-out forwards; }`, beside the existing
      `.slot-card` rule. Opacity/transform only — nothing that reflows. Scoped
      to `#plan-root` so day-sheet/swap-deck cards are untouched. First
      `@keyframes` in the repo
- [x] §3 `style.css` — `@media (prefers-reduced-motion: reduce)` resets
      `#plan-root.staging .slot-card` to `opacity: 1; animation: none`.
      Accessibility basic, not optional
- [x] §4 `sw.js` — bump `CACHE` (line 4) `"meal-planner-v21"` →
      `"meal-planner-v22"`. **No shell-array change** — no new file ships
- [x] §7 Manual pass — items 1-10 (instant first paint and instant one-tap
      Generate; banner Generate fills day-by-day over ~1.5-2s with the banner
      gone and toast fired at once; mid-reveal day tap and mid-reveal
      **Move to day N** both behave; later renders show no residual fading;
      reload gives back the same `mp_plan`; reduced-motion emulation shows the
      full grid instantly; dark + light legible with no layout shift; offline
      on v22)
- [x] §5 Docs — `docs/roadmap.md` Phase 29 records the resolved shape (staged
      CSS reveal of an already-final plan, `renderPlan(staged)`,
      `hermes-generate` only, generator untouched) and is marked shipped;
      `CLAUDE.md` gains the invariant (render-side only, `generatePlan` stays
      synchronous, one render function with a flag rather than a second render
      path, coverage/warnings computed once against the final plan, mid-reveal
      interaction needs no blocking or cancellation); `docs/ARCHITECTURE.md`
      notes the optional `staged` argument and the `#plan-root.staging`
      convention; `SPEC.md` untouched (no data file, plan-slot or planning-rule
      change)

## Phase 30: Hermes quantity ingestion (screenshot → structured quantities)

Spec: `.claude/specs/phase30.md`. Gates answered by the user: 1A
(`{value, unit, raw}`, all three required when present), 2A (extend existing
`pantry` items — no new KV key, no new route), 3A (quantity only — no price,
no pack size).

### Logic & Backend (TDD — write the group-46 assertion first, watch it fail)

- [x] §7 `test.html` group 46 "Phase 30 — structured quantities" — add the
      assertions **before** any source change: `parseQty("500g")` ===
      `parseQty({value:500,unit:"g",raw:"500g"})` === `{500,"g"}`;
      `{value:2,unit:"kg",raw:"2kg"}` → `{2000,"g"}`; missing `value`, `NaN`
      `value`, `null`, `undefined`, `""` → `null`; existing free-text cases
      unchanged (bare number, `kg`, unparseable)
- [x] §3 `shopping-list.js` `parseQty` — one guard at the top of the existing
      function (lines 48-59): non-null object with finite `value` + string
      `unit` → `{value, unit}` through the same `UNIT_MULT` normalization,
      else fall through to today's byte-identical regex path. Extend the
      doc-comment ponytail note (lines 43-47) with one line. Group 46 goes
      green
- [x] §2 `data.js` `qtyText(qty)` — string → itself, `{value,unit,raw}` →
      `raw`, missing `raw` → `value + " " + unit`, anything else → `""`.
      Export as `MP.qtyText` beside `MP.esc` (line 299). Add its group-46
      assertions (never returns `[object Object]`). **Do not touch
      `parseIngredients` / meal-ingredient `qty`**
- [x] §3 `shopping-list.js:217` — `pantryQty = MP.qtyText(raw) || "(some)"`.
      `pantryIndex` (line 87) and `pantryOverlap` stay **zero-diff** (an object
      is truthy and passes through `item.qty || ""`). Add the group-46
      `pantryIndex`/`pantryOverlap`/`buildLists` assertions (structured qty
      survives the index; `needed.value` reduced on a unit match)
- [x] §7 `applyOps` regression assertion — a `"sub"` op against a structured
      item yields a correct **string** qty (500 g − 150 g → `"350 g"`).
      `hermes-sync.js` itself is a **zero-line diff**
- [x] §1 `worker/worker.js` `qtyError(qty)` — `(any) -> string|null`: absent
      OK, string OK, `{value: finite non-negative number, unit: non-empty
      string, raw: non-empty string}` OK, everything else (array, number,
      boolean, partial object) a `400` naming the offending field. Call it from
      `itemsError`'s existing per-item loop (lines 172-183), same message
      style, same all-or-nothing rejection. **No route, `KEYS`, CORS or auth
      change** — Gate 2
- [x] Confirm the zero-diff files really are zero-diff: `generator.js`,
      `nutrition.js`, `shelf-life.js`, `plan.js`, `app.js`, `mealdb.js`,
      `hermes-sync.js`, and every `*.json` data file

### UI & Layout

- [x] §4 `shopping.js:91` — `esc(item.qty || "")` → `esc(MP.qtyText(item.qty))`
      for ad-hoc lines. `shopping.js:44` (`esc(line.pantryQty)`) needs **no**
      change — §3 already guarantees a string. Ad-hoc add form (lines 104,
      127-133) keeps producing free text
- [x] Grep for any other pantry/ad-hoc `qty` interpolation; leave
      `plan.js:186` and `app.js:167` alone (meal-ingredient qty, out of scope)
- [x] §5 `sw.js:4` — `CACHE` `"meal-planner-v22"` → `"meal-planner-v23"`. No
      shell-array change (no new file)

### Docs

- [x] §6 `docs/HERMES.md` — the phase's only externally-visible deliverable:
      `/pantry` table row (line 17) and the `GET /pantry` / `PUT /pantry`
      section (lines 52-59) document `qty` as free-text string **or**
      `{value, unit, raw}` (all three required, `value` finite non-negative,
      `unit`/`raw` non-empty, `raw` = what the screenshot said, unit not
      enum-checked); same sentence for `/adhoc` (lines 61-69); new capability
      row for screenshot → `GET /pantry` → merge by name → `PUT /pantry`,
      stating explicitly that it is **not** a new endpoint and never a source
      of price data
- [x] §6 `docs/roadmap.md` Phase 30 (lines 137-153) — record the resolved
      shape (dual-form `qty`, existing `PUT /pantry`, no new KV key, quantity
      only) and mark shipped
- [x] §6 `CLAUDE.md` — one Architecture-invariants bullet: pantry/ad-hoc `qty`
      is a string or `{value, unit, raw}`; `MP.ShoppingList.parseQty` is the
      only reader of its structure and `MP.qtyText` the only reader of its
      text; quantity only (pricing stays `pack-sizes.json`, shelf-life stays
      category-based, no purchase dates); quantities arrive through the
      existing `PUT /pantry` relay, never a new endpoint
- [x] §6 `docs/ARCHITECTURE.md` — note the dual-form `qty` beside the
      pantry/sync description. `SPEC.md` untouched

### Manual pass (§8)

- [x] §8 Run all 8 steps: existing string quantities render unchanged; a
      structured `PUT /pantry` → `204`, shows `have 500g bag` and reduces
      `needed`; missing `raw` / bare number / string `value` each → `400` with
      KV unchanged (all-or-nothing); plain-string `qty` still `204` on
      `/pantry` and `/adhoc`; `raw` of `"<b>2kg</b>"` renders as literal text;
      a cook deduction leaves a correct string qty and no portion-eat touches
      the pantry; offline works on v23; long `raw` doesn't overflow in dark
      **or** light

## Phase 31: Partial-ingredient leftover tracking

Spec: `.claude/specs/phase31.md`. Gates answered by the user: 1B (a
computed remainder is structured `{value, unit, raw}`, not a string), 2A
(`pantryOverlap` upgraded in place to "enough", with unparseable /
unit-mismatched / amount-unknown falling back to "present"), 3A (`eatPlan` and
`applyOps` stay two callers of one shared function).

Prerequisite: Phase 30 (shipped). **`worker/worker.js`, `generator.js`,
`discover.js`, `shelf-life.js` and every `*.json` are zero-line diffs** — if a
task starts editing one, stop and re-read the spec.

### Logic & Backend (TDD — write the group-47 assertion first, watch it fail)

- [x] §7b `test.html` group 47 "Phase 31 — running-balance pantry" — add the
      `remainingQty` assertions **before** any source change: `({500,"g"},
      {150,"g"})` → `{value:350, unit:"g", raw:"350g"}`; clamp to
      `{value:0, unit:"g", raw:"0g"}` (**unit survives an empty pack** — the
      defect); `raw` rounds to 1 dp while `value` keeps 3
      (`({1,"each"},{0.33,"each"})` → `value 0.67`, `raw "0.7each"`); float
      residue `({0.3},{0.1})` → `value === 0.2` exactly
- [x] §1 `shopping-list.js:275-279` — `fmtRemaining` → **`remainingQty(have,
      used)`** returning `{value, unit, raw}`: `value` = `Math.max(0, have.value
      - used.value)` rounded to 3 dp, `unit` = `have.unit` verbatim, `raw` =
      value at ≤1 dp (trailing `.0` trimmed) + `unit`, **including the zero
      case** (`"0g"`, not `"0"`). `raw` is mandatory — `qtyError` 400s an object
      without it. Rename all five references (`:318`, `:322`, the export at
      `:330`, `hermes-sync.js:183`, Test 31). **No back-compat alias.** Group 47
      goes green
- [x] §7b + §1 Repeated-eat drift regression — feed `remainingQty`'s output back
      through `parseQty` three times subtracting a fractional amount each round;
      final `value` must equal the exact arithmetic. Plus: subtract to zero,
      re-parse, assert `unit === "g"` (not `"each"`), then `eatPlan` against it
      reports a **shortfall**, not `"units differ"`
- [x] §7b `pantryOverlap` assertions (one per §2 decision-table row) — absent →
      no; `qty: ""` → **yes** (behaviour change); recipe qty unparseable → yes;
      pantry qty unparseable → yes; unit mismatch → yes; 500g vs needs 200g →
      yes; 100g vs needs 200g → **no**; 2kg vs needs 500g → yes; structured
      `{500,"g"}` vs needs 700g → no
- [x] §2 `shopping-list.js:101-103` — `pantryOverlap` counts "on hand **in
      sufficient quantity**": absence is `have[normalizeKey(ing.key)] ===
      undefined` (the `!== undefined` test `buildLists:224` already uses, **not**
      truthiness); `parseQty` both sides; insufficient only when both parse
      **and** units match. Module-local helper is fine, no export.
      **`pantryIndex` stays zero-diff** — it already stores `item.qty || ""`;
      the bug is in the reader. Signature and all three call sites unchanged
- [x] §3 `shopping-list.js:318, 322` — `eatPlan`'s `after` and its shortfall
      remainder become structured qtys. Op vocabulary, row shape and the pantry
      `sub` op's `qty: usedText` all **unchanged** (Gate 3)
- [x] §3 `shopping-list.js:310, 314` — wrap `haveText`/`usedText` in
      `MP.qtyText` inside the two note strings. Live Phase 30 gap: a structured
      qty currently prints `[object Object]` mid-sentence. Wording otherwise
      unchanged
- [x] §4 `hermes-sync.js:183` — call `remainingQty`; write the structured result
      to `result[idx].qty`. **That is the entire diff in this file** — the
      `parseQty` calls (`:180-181`), the unit guard (`:182`) and the `"add"`
      branch all stay as-is, and `applyOps` stays pure
- [x] §7a Update the existing groups that assert the old behaviour: **Test 31**
      (~753-855) rename + string→structured results; **group 46 line 2178**
      `applyOps "sub"` now yields `{value:350, unit:"g", raw:"350g"}`. Rows,
      notes, op vocabulary and shortfall detection must all still pass — if one
      breaks, the change went wider than the spec
- [x] §7b End-to-end balance + `pickVariant` assertions — `eatPlan` → `applyOps`
      → `eatPlan` again sees the reduced amount; two half-pack cooks leave
      `value: 0` with the unit intact; a variant whose extra ingredient is
      stocked but **short** is no longer preferred over a fully-stocked one
      (`MP.Generator.pickVariant`, exercising the zero-line-diff claim)
- [x] §1b + §2b Ponytail comments — rewrite `shopping-list.js:269-271` (**keep**
      the both-shop-days clause, it's still true; **drop** "not a running
      balance" and the dead "Phase 12's deduction flow" pointer; name
      per-shop-day depletion as the upgrade path). Amend `generator.js:190-192`
      to say the ceiling that survives: scoring still runs against one static
      snapshot from `plan.js:98`, so two slots can both count the last tin.
      **Comment-only — `generator.js` gains no code change**
- [x] Confirm the zero-diff files really are zero-diff: `worker/worker.js`
      (`qtyError` already accepts this shape), `generator.js` (code),
      `discover.js`, `shelf-life.js`, `nutrition.js`, `app.js`, `shopping.js`,
      and every `*.json` data file

### UI & Layout

- [x] §5 `plan.js:625` — **both** halves:
      `${esc(MP.qtyText(row.have))} → ${esc(MP.qtyText(row.after))}`.
      `row.have` needs it for a pre-existing Phase 30 reason (structured pantry
      qty renders `[object Object]` today), `row.after` because of Gate 1.
      `MP.qtyText` stays **inside** `esc(...)` — `raw` is untrusted screenshot
      text. No other `plan.js` change; `commitCook`'s call order is untouched
      and `eatPortion` still touches nothing pantry-related
- [x] §6 `sw.js:4` — `CACHE` `"meal-planner-v23"` → `"meal-planner-v24"`. No
      shell-array change (no new file)

### Docs

- [x] §8 `CLAUDE.md` — **amend** the Phase 30 `qty` invariant bullet, don't add
      a rival one: a computed remainder is structured
      (`MP.ShoppingList.remainingQty`, its only producer), the pantry is a
      running balance across cooks, `pantryOverlap` means "on hand in sufficient
      quantity" with unparseable / unit-mismatched / amount-unknown falling back
      to present, `commitCook` still the only writer. Keep the quantity-only
      rule (no price, pack size or purchase date) verbatim
- [x] §8 `docs/ARCHITECTURE.md:78-88` — the sentence "a cook deduction collapses
      a structured `qty` back to a plain string via `fmtRemaining`" is now
      **false**; replace with the running-balance description. Also update the
      Phase 21 pantry-variant note (~`:207-215`): overlap is quantity-aware,
      still reader-only
- [x] §8 `docs/HERMES.md` — one sentence on `/pantry` and `/adhoc`: the **app
      itself** now writes structured quantities (cook remainder, shortfall
      ad-hoc line), so a `qty` isn't free text just because no human typed it.
      No endpoint, route or contract change
- [x] §8 `docs/roadmap.md` Phase 31 (lines 166-186) — mark **Shipped**, record
      gates 1B / 2A / 3A and the outcome, same style as Phase 30's shipped block
      (`:154-164`). Note that `generator.js:190-192`'s plan-wide depletion
      ceiling deliberately survives. `SPEC.md` untouched

### Manual pass (§9)

- [x] §9 Run all 12 steps: existing string quantities unchanged; three
      successive `150g` cooks off a `500g` pack give `350g` → `200g` → `50g`
      with no drift; over-cooking hits `0g` plus a real ad-hoc line; a cook
      against `0g` reports a shortfall **not** "units differ"; a Hermes-written
      structured item shows its `raw` on the left of the eat-sheet arrow (Phase
      30 gap fixed); the post-cook pantry sync returns `204` not `400` (proving
      `raw` was carried); Generate picks the variant that's *sufficiently*
      stocked; a leftover portion-eat writes nothing to the pantry; Discover
      ordering effectively unchanged; offline works on v24; long `raw` doesn't
      overflow the eat row in dark **or** light

## Phase 33: Product nutrition reference (scan a barcode, read a photo)

- [x] 33a: records, `/products`, barcode scan, Pantry tab: `.claude/specs/phase33a.md` (built; `MP.Products` in test.html, `/products` in tools/worker_test.mjs, Pantry step in walk.mjs)
- [ ] Live: scan a real pack on the Pixel PWA, record saved and visible after reload
- [ ] Live: assistant writes one product from a label photo via PUT /products and it shows on the Pantry tab
- [x] 33b: CoFID vitamin/mineral fill-in: `.claude/specs/phase33b.md` (built; fillFromCofid in test.html; spot checks: chicken light meat raw protein 24.0 g, broccoli boiled vit C 44 mg, semi-skimmed milk calcium 120 mg)
- [ ] Live: on the Pixel PWA set a product's ingredient to rice, reopen it: vitamins/minerals show "est." with the OGL footnote
- [ ] Live: with the real Worker, an assistant-written product record gets CoFID-filled and pushed after a Pantry tab visit

## Phase 34: Use-by dates, expiring-soon route and "use it up"

- [ ] Spec and tasks (requires 33a): `.claude/specs/phase34.md`

## Phase 35: Weekly nutrient-gap view and gym-day targets

- [x] Spec and tasks: `.claude/specs/phase35.md`
- [ ] Live: on the phone PWA, plan page after logging meals: tick "Gym day today", protein line reads "gym-day target" (+20 g); edit placeholder `gymDay` numbers in `nutrition-targets.json`

## Phase 36: Cost per 25 g protein and product ranking

Requires 33a (`MP.Products`, `/products`). Decisions (own calls): price = product `price`+`pack`; if absent, fall back to
`MP.ShoppingList.priceFor(ingredient)` and mark "est."; a product with an estimate/`off`-less protein basis still ranks
but shows the "est." marker; no shopping-list rows (YAGNI). Informational only, never sorts or filters meals.
- [ ] Logic (TDD): `MP.Products.proteinValue(product, packData)` → `{ per25g, estimated } | null` (null when no protein, no pack size, or a non-g pack; ml products excluded); `rank(products, packData)` ascending by `per25g`
- [ ] `products.js` is under the `window`→`root` shim; check it stays Worker-importable (`data_check.py`)
- [ ] Worker: read-only `GET /product-ranking` (calls `rank` on KV `products` + `pack-sizes.json`), added to `ASSISTANT_ALLOWED`; 405 on non-GET
- [ ] UI: "£x.xx / 25 g protein" line on the product sheet (view mode) and a "Best protein value" list under All products on the Pantry tab, "est." marker where price or protein is an estimate
- [ ] Bump `CACHE` in `sw.js`; both themes, PC + 390 px; `docs/HERMES.md` one line for the route; mark roadmap `— done`


## Phase 37: Per-day effort hints from the assistant

- [x] Spec and tasks: `.claude/specs/phase37.md` (all spec tasks built; Node harness for `/dayHints` + `/ranking`, `test.html`, `check.py`, chip checked at PC and 390 px)
- [ ] Live: the assistant sends a busy hint for tomorrow; the chip shows on the phone PWA's plan page, and tapping it dismisses it


## Phase 39: "Ran out" items steer the plan

- [ ] Roadmap: `docs/roadmap.md` Phase 39 [S]. Requires Phase 32 (done). Design: an out item stays in the pantry list with `out: true`; no new endpoint/KV key (rides `PUT /pantry`).
- [ ] Logic (TDD): `pantryIndex` (`shopping-list.js`) skips `out` items, so `pantryOverlap`, `buildLists` and the generator's pantry reads treat them as absent (meal kept, ingredient lands on the shopping list). One change, all readers.
- [ ] Logic (TDD): `markOut(name)` helper in the pantry write path: sets `out: true` and drops qty; ignored when the name isn't already in the pantry (never-stocked). Never writes a negative qty.
- [ ] Logic (TDD): clear `out` when the item is ticked bought on Shopping, or when its pantry qty is set above zero (`commitCook` stays the only deduction writer; it must not set or clear `out`).
- [ ] Worker: allow `out` through the `PUT /pantry` merge and `ASSISTANT_ALLOWED` validation; add to `data_check`/worker tests (no new route; do not widen `ASSISTANT_TOKEN`).
- [ ] UI: "Ran out" toggle on a pantry row (Pantry/Shopping surface), `esc()` on names, checked PC + 390 px, both themes (`ui-build`).
- [ ] Verify: out flag + `qty` zero never goes negative; ran-out on unknown item no-ops; bump `CACHE` in `sw.js`; mark roadmap `— done`.

## Phase 40: Cooking mode data: steps, timers and a confirm-cook route

Spec: `.claude/specs/phase40.md` (tasks live there).
- [ ] Live: spot-check the seeded method times (roast chicken 90 min oven, chilli 40 min simmer) against the sources in the commit body.
- [ ] Live: with the real ASSISTANT_TOKEN, `PUT /meal-method` on a meal; Browse shows "Drafted", Accept clears it, a repeat PUT returns 409.

## Phase 41: One-tap logs: routine items and water/caffeine counters
- Spec: `.claude/specs/phase41.md`
- [x] Logic: `MP.Today`, pool filter (generator `rankSlot`/`generatePlan`), Worker `/today` + `VALIDATE.today`, `counters.json` + `data_check`, `sw.js` bump
- [x] UI: Today card on `plan.html` (routine chips, water/caffeine, gym toggle)
- [ ] Live: assistant sets `gym` via `PUT /today` and the protein shake chip appears on the phone PWA's Today card
