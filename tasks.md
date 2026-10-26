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

- [x] Spec and tasks (requires 33a): `.claude/specs/phase34.md` (built; Node harness, test.html, check.py, tester PASS at PC and 390 px)
- [ ] Live: enter a use-by date on the phone PWA's Pantry tab and see it appear in the assistant's `GET /pantry` and `GET /expiring`

## Phase 35: Weekly nutrient-gap view and gym-day targets

- [x] Spec and tasks: `.claude/specs/phase35.md`
- [ ] Live: on the phone PWA, plan page after logging meals: tick "Gym day today", protein line reads "gym-day target" (+20 g); edit placeholder `gymDay` numbers in `nutrition-targets.json`

## Phase 36: Cost per 25 g protein and product ranking

Requires 33a (`MP.Products`, `/products`). Decisions (own calls): price = product `price`+`pack`; if absent, fall back to
`MP.ShoppingList.priceFor(ingredient)` and mark "est."; a product with an estimate/`off`-less protein basis still ranks
but shows the "est." marker; no shopping-list rows (YAGNI). Informational only, never sorts or filters meals.
- [x] Logic (TDD): `MP.Products.proteinValue(product, packData)` → `{ per25g, estimated } | null` (null when no protein, no pack size, or a non-g pack; ml products excluded); `rank(products, packData)` ascending by `per25g`
- [x] `products.js` is under the `window`→`root` shim; check it stays Worker-importable (`data_check.py`)
- [x] Worker: read-only `GET /product-ranking` (calls `rank` on KV `products` + `pack-sizes.json`), added to `ASSISTANT_ALLOWED`; 405 on non-GET
- [x] UI: "£x.xx / 25 g protein" line on the product sheet (view mode) and a "Best protein value" list under All products on the Pantry tab, "est." marker where price or protein is an estimate
- [x] Bump `CACHE` in `sw.js`; both themes, PC + 390 px; `docs/HERMES.md` one line for the route; mark roadmap `— done`

- [ ] Live: with the real KV products, `GET /product-ranking` with the ASSISTANT_TOKEN returns a `ranked` list, cheapest first
- [ ] Live: on the phone PWA, Shopping > Pantry: a product with pack and price shows "£x.xx / 25 g protein" and the Best protein value list is in order

## Phase 37: Per-day effort hints from the assistant

- [x] Spec and tasks: `.claude/specs/phase37.md` (all spec tasks built; Node harness for `/dayHints` + `/ranking`, `test.html`, `check.py`, chip checked at PC and 390 px)
- [ ] Live: the assistant sends a busy hint for tomorrow; the chip shows on the phone PWA's plan page, and tapping it dismisses it


## Phase 39: "Ran out" items steer the plan

- [x] Roadmap: `docs/roadmap.md` Phase 39 [S]. Requires Phase 32 (done). Design: an out item stays in the pantry list with `out: true`; no new endpoint/KV key (rides `PUT /pantry`).
- [x] Logic (TDD): `pantryIndex` (`shopping-list.js`) skips `out` items, so `pantryOverlap`, `buildLists` and the generator's pantry reads treat them as absent (meal kept, ingredient lands on the shopping list). One change, all readers.
- [x] Logic (TDD): `markOut(name)` helper in the pantry write path: sets `out: true` and drops qty; ignored when the name isn't already in the pantry (never-stocked). Never writes a negative qty.
- [x] Logic (TDD): clear `out` when the item is ticked bought on Shopping, or when its pantry qty is set above zero (`commitCook` stays the only deduction writer; it must not set or clear `out`).
- [x] Worker: allow `out` through the `PUT /pantry` merge and `ASSISTANT_ALLOWED` validation; add to `data_check`/worker tests (no new route; do not widen `ASSISTANT_TOKEN`).
- [x] UI: "Ran out" toggle on a pantry row (Pantry/Shopping surface), `esc()` on names, checked PC + 390 px, both themes (`ui-build`).
- [x] Verify: out flag + `qty` zero never goes negative; ran-out on unknown item no-ops; bump `CACHE` in `sw.js`; mark roadmap `— done`.
- [ ] Live: on the phone PWA, Shopping > Pantry, tap "Ran out" on a stocked item, Generate a plan: the meal stays and the ingredient is on the Shopping list; tick it bought and the out state clears.

## Phase 40: Cooking mode data: steps, timers and a confirm-cook route

Spec: `.claude/specs/phase40.md` (tasks live there).
- [ ] Live: spot-check the seeded method times (roast chicken 90 min oven, chilli 40 min simmer) against the sources in the commit body.
- [ ] Live: with the real ASSISTANT_TOKEN, `PUT /meal-method` on a meal; Browse shows "Drafted", Accept clears it, a repeat PUT returns 409.

## Phase 41: One-tap logs: routine items and water/caffeine counters
- Spec: `.claude/specs/phase41.md`
- [x] Logic: `MP.Today`, pool filter (generator `rankSlot`/`generatePlan`), Worker `/today` + `VALIDATE.today`, `counters.json` + `data_check`, `sw.js` bump
- [x] UI: Today card on `plan.html` (routine chips, water/caffeine, gym toggle)
- [ ] Live: assistant sets `gym` via `PUT /today` and the protein shake chip appears on the phone PWA's Today card

## Phase 43: Pantry and leftover read routes: cookable, substitutions, leftovers, quick fallback
- Spec: `.claude/specs/phase43.md`
- [ ] Live: on the phone PWA, cook a batch meal, tap Freeze 1 on the Today card, and see the frozen portion in the assistant's `GET /leftovers` and `GET /quick`

## Phase 48: Activity log and undo for every assistant write
- Spec: `.claude/specs/phase48.md`
- [x] Worker: ITEMS/diffItems/logWrite/undoActivity, routes, dryRun, X-Reason, CORS, allow-list; `tools/worker_test.mjs` asserts
- [x] `hermes-sync.js` fetchActivity/undoActivity/resyncKey; ARCHITECTURE.md rows
- [x] Assistant activity section (index.html, app.js, style.css), sw.js CACHE bump
- [ ] Live: ask the assistant to change a pantry item, see it in Assistant activity on the phone PWA, tap Undo and see the old quantity back

## Phase 49: Week-plan draft and apply routes
- Spec: `.claude/specs/phase49.md`
- [x] `draftId`, `draftPlan`, `applyDraft`, `planDraft` key/validator, routes, `ASSISTANT_ALLOWED`, activity logging; asserts in `tools/worker_test.mjs`
- [x] `hermes-sync.js` `fetchPlanDraft`/`ackPlanDraft`; `docs/ARCHITECTURE.md` rows
- [x] Banner in `plan.js`/`plan.html` (reuses `.hermes-banner`), `sw.js` CACHE v44
- [x] Checked PC 1200 dark + 390 light with Playwright (intercepted `GET /planDraft`): banner lists changes, Apply updates plan and acks, eaten slot reported "already eaten" and kept, Dismiss leaves plan alone
- [ ] Live: with the real Worker, ask the assistant to draft a week, open the installed PWA, tap Apply, see the week change

## Phase 50: Draft meals and recipe import
- Spec: `.claude/specs/phase50.md`
- [ ] Live: ask the assistant to draft a meal from a photo or link; it shows under Drafts in Browse, map an unknown ingredient, Accept; it is in the library and a generated plan can pick it (needs notion_assistant Phase 45)

## Phase 51: Meal ratings, flags and reasons ("never again")
- Spec: `.claude/specs/phase51.md`
- [ ] Live: rate a meal 👍 with a note in the phone PWA, ask the assistant to read it; flag a meal Never again, regenerate the plan and see it absent; ask "why this meal?" (needs notion_assistant Phases 61 and 73)

## Phase 52: Vault data layer and personal profile
- Spec: `.claude/specs/phase52.md`
- [x] Worker `/settings` + normalizeSettings, termHit/withProfile, rankSlot profile, sync/plan/UI wiring, docs; check.py 8/8, worker_test ok, tester PASS (browser: hard-term generate, budget lock, Profile line). Phase 48 absent: no `logWrite`/`ITEMS.settings`; no `/nutrition` targets assert
- [ ] Live: edit `Meals/Profile.md` (calories, an allergy, budget), Apply in the assistant, reload the phone PWA: targets, Plan-with-me budget and generated plan reflect it

## Phase 53: Portion scaling route
Requires Phase 43 (storage/`frozenMonths` helpers) built first. Decided: scale a line only when `MP.ShoppingList.parseQty` reads a leading number (replace that number in the original text, keep the rest, e.g. "2 cloves" → "3 cloves"; structured qty scales `value`); otherwise return the line unchanged with `check: true`. Portions are an integer 1–12, else 400. No new scoring.
- [x] `scaleMeal(meal, portions)` in `shopping-list.js` (pure, Worker-importable): `[{ key, qty, scaled, check }]`, ratio `portions / meal.servings`, `effectiveMeal`-resolved, skips `isSkippedIngredient`
- [x] Shortfall from the scaled lines via `pantryIndex` + `parseQty` (same rule as `pantryOverlap`: absent → buy, unit mismatch/unparseable stock → covered): `{ buy: [...], covered: [...] }`
- [x] Cook-time note: sum of `method[].minutes` plus `prepEffort`; no method → `null` (never guessed)
- [x] Storage: the `cooked_leftovers` category via Phase 43's `shelf-life.js` helpers → `{ fridgeDays, freezerMonths, estimate: true }` only when `portions > 1` leftovers exist
- [x] Worker `GET /scale?meal=&portions=` (reads `library` + `pantry` KV, 404 unknown meal, 400 bad portions); add to `ASSISTANT_ALLOWED`
- [x] Tests in `test.html` + `tools/worker_test.mjs`: portions = own servings returns every qty unchanged; "handful, grated" flagged `check` and unchanged; "2 cloves" ×1.5 → "3 cloves"; portions 0/13/"x" → 400; empty pantry → everything in `buy`
- [x] `python3 check.py` green
- [ ] Live: ask the assistant "scale the chilli to 6" and check the buy list against the pantry (needs `notion_assistant` Phase 83)

## Phase 54: Day route: one read-only source for the Today screen
- Spec: `.claude/specs/phase54.md`
- [x] Logic: dayView extraction, dayCards, `GET /day` + `ASSISTANT_ALLOWED`, worker_test cases, `MP.dueRoutines` Worker-importable
- [x] ARCHITECTURE.md route line
- [ ] Live: ask the assistant for its Today view after logging a meal in the app and check they match (needs `notion_assistant` Phase 85)

## Phase 55: Shopping list as the single shared state
- Spec: `.claude/specs/phase55.md`
- [ ] Live: tick a line on the phone PWA and a different line on the PC within a minute, reload both: both ticks show on both
- [ ] Live: once notion_assistant Phase 44 ships, tick a line in Google Tasks and see it got in the app (no duplicate line)

## Phase 56: Hermes contract rewrite and tool parity
- Spec: `.claude/specs/phase56.md`
- [x] Logic: actor cases, `ROUTES` + `routes_build.mjs`, drift probe and reverse scan in `worker_test.mjs`
- [x] Docs: `docs/HERMES.md` rewrite, ARCHITECTURE line
- [ ] Live: have Hermes add an item to the shopping list sending `X-Actor: hermes`; it shows in the app's Assistant activity with Undo

## Phase 57: Measured nutrient levels for new ingredients (CoFID)
- Spec: `.claude/specs/phase57.md`
- [ ] Live: with the CoFID 2021 xlsx, map one new ingredient and confirm "not tracked yet" disappears (see spec)

## Phase 66: Lock and fill
- Spec: `.claude/specs/phase66.md`
- [x] Logic, worker, UI, CACHE bump (built 2026-10-23); check.py 9/9, worker_test ok
- [ ] Live: in the installed phone PWA lock a dinner, tap Generate and see it stay; Reroll one day and check the other days do not change; Unlock all

## Phase 58: Aisle-ordered shopping list [S]
- [x] Data: add `aisles` to `pack-sizes.json` — ordered `[{ id, label, keywords[] }]` (produce, bakery, meat & fish, chilled, frozen, cupboard, household); reuse the existing `keywords` list's coverage, no inline constants in JS
- [x] Logic (TDD): `MP.ShoppingList.aisleFor(key, packData)` in `shopping-list.js` — longest-keyword match on `normalizeKey`, items-level `aisle` override allowed, unmatched/absent `aisles` → `"other"` (never throws, never drops); export it. Pure, no `window` ref (Worker imports this file). `buildLists` untouched
- [x] Logic: `MP.ShoppingList.groupByAisle(lines, packData)` → ordered `[{ id, label, lines }]`, "Other" last, every input line exactly once; add both to `test.html` assertions
- [x] UI (`ui-build`): `shopping.js` `blockHtml` renders `lines`, `staples`, `estimated` each via `groupByAisle` with an aisle sub-heading (`.shop-aisle`, tokens from `style.css`); ticking/skipping re-renders in the same aisle; skip empty aisles
- [x] Bump `CACHE` in `sw.js` (`pack-sizes.json`/`shopping.js` are cached); load order unchanged (no new cross-file dep)
- [x] Verify: `python3 check.py` passes; generated list has every line exactly once across aisles, unmatched in "Other", tick keeps aisle; PC + 390px, both themes

## Phase 59: Freezer-aware batch planning
- Spec: `.claude/specs/phase59.md`
- [x] Logic, generator, shopping/mirror/prefs/worker, commitCook freezing, plan-card/Today notes, setup toggle, CACHE bump
- [ ] Live: in the installed phone PWA generate a plan containing chilli; confirm a frozen dinner 5+ days after the cook and the "Defrost tonight" note on Today the evening before

## Phase 60: Choice screens for breakfast, lunch and snacks
- Spec: `.claude/specs/phase60.md` — all spec tasks built 2026-10-23 (parseGuidedSlots, multi-pass guided, toggle row, deck per slot type, CACHE v49, walk.mjs step).
- [ ] Live: on the phone PWA, Plan with me, tick Breakfast and Lunch, Generate: dinner pass, then Breakfast, then Lunch, up to 3 cards each, counter spans all passes.

## Phase 61: Repeat-rate control [S]
Requires Phase 51 (built). Decision (own call): one plain number `repeatGap` (min days between the same meal; 0 = off) in `mp_planPrefs`; "rotate favourites" is not a separate switch, it is `repeatGap` plus the existing 👍 layer (a 👍 meal inside its gap drops behind neutral ones). Not in `notion_assistant` (roadmap 2026-10-22).
- [x] Logic (TDD): `generator.js` `rankSlot` — new layer after ratings (3c): stable-move meals with `dayNum - lastUsedDay[id] < opts.prefs.repeatGap` to the tail; reorder only, never a filter (a 3-meal library still fills every slot); `repeatGap` absent/0 = today's order. Add to `test.html`: 12-meal library 14-day plan has no meal inside the gap; 3-meal library fills every slot
- [x] Logic: `plan-with-me.js` `MP.PlanPrefs.get/save` carry `repeatGap` (int 0–14, junk → 0); `save` takes it as a 4th arg, update both callers (`hermes-sync.js:370` pull, `plan-with-me.js` save) and the `CLAUDE.md` `mp_planPrefs` invariant line (`{ updatedAt, busyDays, chips, budgetTarget, repeatGap }`)
- [x] Worker: `worker/worker.js` lines ~210 and ~252 build `prefs` from `planPrefs` — pass `repeatGap: pp.repeatGap || 0` so `/ranking` and the draft route match the app (`rankSlot` stays the one implementation); no new route or KV key
- [x] UI (`ui-build`): `plan-with-me.html`/`.js` — a "Repeat a meal no sooner than" stepper/select (Off, 3, 5, 7 days) beside the budget slider; saved with the other prefs
- [x] Bump `CACHE` in `sw.js`
- [x] Verify: `python3 check.py` passes (9/9).
- [ ] Live: fresh profile, gap 7 → plan shows no repeat within 7 days; gap unset → plan identical to before; PC + 390px, both themes

## Phase 62: Taste profile from ratings
Spec: `.claude/specs/phase62.md` [M] (no cuisine, ingredient + cook-style profile derived from `mp_ratings`, reorder-only).
- [x] Logic, wiring, `sw.js` CACHE, CLAUDE.md (built 2026-10-23)
- [ ] Live: Phase 62 — after rating 3+ meals, Discover leans toward 👍 ingredients; clearing ratings restores the order.

## Phase 63: Mid-week re-flow
- Spec: `.claude/specs/phase63.md`
- [x] `MP.reflowPlan` / `MP.Plan.reflow` pure + asserts; `snapshot`/`restore`, Activity-undo hook
- [x] Worker `POST /plan/reflow` (shared `planInputs`/`runGenerator`/`parkDraft`), `ASSISTANT_ALLOWED`, routes.json; `setSlotMeal` locks; Phase 66 spec amended
- [x] Skip / Eating out buttons in the day sheet, Undo re-flow toast, "Eating out" slot state, sw.js bump
- [ ] Live: with the real Worker, ask the assistant to re-flow after skipping a cook; Apply in the installed PWA; Undo

## Phase 64: Three candidate weeks
- Spec: `.claude/specs/phase64.md` [M] (cheapest / highest-protein / quickest fortnights side by side; adds `prefs.noBatch`).
- [x] noBatch, candidates block, planMetrics/candidateWeeks, Compare sheet, sw.js bump, walk step
- [ ] Live: on the phone PWA, open Compare on your real library and confirm the three weeks look meaningfully different and "Use this plan" lands on the plan page.

## Phase 65: Use-it-up week
- Spec: `.claude/specs/phase65.md` [M] (one-tap fortnight that cooks expiring pantry items first; `prefs.useUp`, reorders the shortlist only).
- [x] `ShoppingList.useUpItems` + test.html asserts
- [x] `rankSlot` layer 3e + `generatePlan` consume set + asserts
- [x] `pack-sizes.json` `planning.useUpWindow`; `plan.js` passes `useUp`
- [x] Worker `draftPlan` `useUp` flag + `worker_test.mjs` case
- [x] "Use it up" button + empty-state toast
- [x] Bump `CACHE`; `CLAUDE.md` invariant line
- [ ] Live: Phase 65 — with real pantry use-by dates, press Use it up and confirm the expiring items show in the first meals
- [ ] Live: Phase 61 — Worker accepts `PUT /planPrefs` with `repeatGap` via real Hermes and it syncs back on pull.

## Phase 67: Batch-cycle design
- [x] batchRuns + test.html assertions + sw.js bump (built 2026-10-23)

Spec: `.claude/specs/phase67.md` (build it with `/build` or queue it for `/overnight`).

## Phase 68: Rolling plan
- Spec: `.claude/specs/phase68.md`
- [ ] Live: next morning on the phone PWA, open Plan: yesterday is gone, a new day 14 is added, and the shopping ticks are kept
- [ ] Live: open Shopping after a roll: headings show shop dates ("Shop 2026-MM-DD") and a line ticked before the roll is still ticked

## Phase 69: Swipe deck per slot
- Spec: `.claude/specs/phase69.md`
- [ ] Live: on the phone PWA, open Swap on a dinner, swipe and use Take/Pass; the slot changes and the counter drops

## Phase 70: Live nutrient and cost meter while editing
- Spec: `.claude/specs/phase70.md`
- [x] `planMetrics` weekCost/weekGaps; `fixGap` (tests in test.html)
- [x] `#meter-strip` markup, CSS, `renderMeter` delta/count-up, Fix-this-gap card, `sw.js` CACHE, UI_STYLE + CLAUDE.md lines
- [ ] Live: on the phone PWA, swap a dinner from the plan page and watch the bars and £ move; tap "Fix this gap" and take the swap

## Phase 71: What-if preview on a candidate [S]
Requires Phase 70 (extends `planMetrics` with `weekCost`) and Phase 69 (deck cards are the candidates). Writes nothing.
- [x] `plan.js`: `whatIf(day, slotType, meal)`: clone `plan` (`structuredClone`), set that slot via the same path `setSlotMeal` uses (no `savePlan`), return `{ dProteinG, dCost, effort/minutes, newLines }` by diffing `planMetrics(copy)` vs `planMetrics(plan)` and `MP.ShoppingList.buildLists(copy, ...)` vs the live lists (lines present only in the copy). No second cost/coverage code
- [x] Cook time: sum of the meal's step `minutes` where any exist (per-step field, only some steps have it), else `MP.Generator.effortOf(meal)` label; never invent minutes
- [x] Deck card (`renderDeck`): PC hover and phone long-press (~450 ms, cancelled by swipe movement) show a small preview popover from `whatIf`; textContent/`esc()` only, no new dependency
- [x] `style.css`: `.whatif` popover, both themes, 390 px fits, reduced-motion = no animation; bump `CACHE` in `sw.js`
- [x] `test.html`/`walk.mjs`: assert `whatIf` deltas equal `planMetrics` after actually calling `setSlotMeal` with the same meal, and `mp_plan` is byte-identical after a preview
- [x] `docs/roadmap.md`: mark Phase 71 done with what was verified (roadmap-gating)
- [ ] Live: on the phone PWA, long-press a swap candidate and confirm the numbers match after taking it, the popover stays while held, and dragging cancels it (check Android doesn't fire pointercancel at ~450 ms)

## Phase 72: Planning chat with Hermes (guided, animated)
- Spec: `.claude/specs/phase72.md`
- [ ] Live: after the deploy, the Telegram report says the Worker redeployed (first Durable Object migration)
- [ ] Live: put `MP_WORKER_URL` and `MP_AUTH_TOKEN` in `.env`, start `python3 tools/hermes_chat_bridge.py` on the PC, open "Plan with Hermes": Hermes opens with a question about a real gap
- [ ] Live: type "no cooking Sunday": only Sunday re-picks, animated; "something nicer on Friday" gets a clarifying question, not a guess
- [ ] Live: on the phone PWA, reject one changed slot, Save, and check the plan kept the rest; stop the bridge and confirm the button falls back to Plan with me

## Phase 73: Tie questions and trade-off cards
- Spec: `.claude/specs/phase73.md`

## Phase 74: Learn from rejections [S]
Requires Phase 72 (the chat's per-slot Reject, `plan-chat.js`, unbuilt: build after it). Reuses Phase 51 ratings and Phase 48's log; no new route or KV key.
- [x] `worker/worker.js`: add `ratings: ["meals", null]` to `ITEMS` (object map, like `dayHints`); `putMealRating(request, env, mealId, who)` diffs before/after with `diffItems("ratings", …)` and calls `logWrite({ who, key: "ratings", why: reasonOf(request), changes })` when `who` is set; pass `actor` at the call site (~l.1317). `restore` for `ratings`: a `before` of null becomes `{ rating: null, note: "", never: false, at: now }` and any restored record is restamped `at: now`, else the app's newest-`at` merge (`MP.Ratings.merge`) keeps the rejected note and undo never reaches the phone
- [x] `hermes-sync.js`: `pushRating(id, patch, reason)` sends `X-Actor: hermes` + `X-Reason` only when `reason` is given (the chat reject); the rating-row sheet calls stay unlogged as today
- [x] `plan-chat.js` Reject: after Reject, show an optional one-line reason (quick chips "too fiddly", "too pricey", "not in the mood", "had it lately" + free text, `maxlength` = `NOTE_MAX`, skippable); on submit `MP.Ratings.set(afterMealId, { rating: "down", note })` then `MP.Sync.pushRating`. Skip writes nothing (a reject is not a dislike unless a reason is given). `textContent` only
- [x] `docs/roadmap.md` Phase 74 + `worker/routes.json`: `PUT /meal/:id/rating` row becomes `log: "logged"`; rerun `node tools/routes_build.mjs`; update `CLAUDE.md` Ratings invariant (ratings now in `ITEMS`, undoable)
- [x] `tools/worker_test.mjs`: a rating PUT with `X-Actor: hermes` appends one activity entry; `POST /activity/undo` restores the prior record (or the neutral one) with a fresh `at`; the app-token PUT without a header logs nothing
- [x] `test.html`/`walk.mjs`: reject with reason "too fiddly" writes `mp_ratings[id]` `{ rating: "down", note }`; the same meal then ranks lower in `rankSlot` than before (no-reason reject writes nothing); `python3 check.py` passes
- [x] Bump `CACHE` in `sw.js` if `plan-chat.js`/`hermes-sync.js` change; mark Phase 74 done with what was verified (roadmap-gating)
- [ ] Live: on the phone PWA, reject a chat change with "too fiddly", regenerate, confirm it ranks lower; undo it from Activity and confirm the note is gone

## Phase 75: Tomorrow lock-in on Today
- Spec: `.claude/specs/phase75.md`
- [ ] Live: on the phone PWA, swap tomorrow's dinner from the Today card in one tap, then Keep it and confirm the lock shows in the day view

## Phase 76: Cheaper swaps route
Spec: `.claude/specs/phase76.md`
- [x] Extract the `shopping()` list-building helper (`loadShopLists`); `/shopping` tests unchanged
- [x] `swaps()`: shop-list select, priciest grouped lines, `packsFor`/`priceFor` cost compare, exclusion re-check per using meal (allergies+never), `tagChanges`, sort/limit
- [x] Route branch, `ROUTES` row, `ASSISTANT_ALLOWED`, `node tools/routes_build.mjs`
- [x] `worker_test.mjs` cases
- [x] Mark Phase 76 in `docs/roadmap.md`
- [ ] Live: ask the assistant "any cheaper swaps this week?" against the deployed Worker and confirm the answer matches `GET /swaps`

## Phase 77: Weekly spend log [S]
- [x] `spend` KV key `{ updatedAt, weeks: { "<shop-day ISO>": { total, source, at } } }`; add `spend: ["weeks", null]` to `ITEMS` (`worker/worker.js` ~1157) so it is logged and undoable (Phase 48); model the handler on `putMealRating`
- [x] `POST /spend { week, total, source }`: validate `week` is an ISO date, `total` a finite number >= 0, `source` in asda|manual|estimate (else 400); the key is `week`, so a repeat overwrites, never adds
- [x] `GET /spend` returns `{ weeks, budgetTarget }` (`budgetTarget` from `readSettings`, `0` when unset); empty store returns `{ weeks: {}, budgetTarget }`
- [x] Register both in `ROUTES` + `ASSISTANT_ALLOWED` (assistant reads and writes), rerun `node tools/routes_build.mjs`, commit `worker/routes.json`
- [x] `tools/worker_test.mjs`: repeat POST same week leaves one row; `POST /activity/undo` restores the prior total; bad week/total/source rejected; GET shows `budgetTarget`
- [x] Skipped: planned-vs-actual on the cost meter (roadmap says "may"); add when the user asks. No `data_check`/`sw.js` change (Worker only)
- [x] Verify: `node tools/worker_test.mjs` and `python3 check.py --changed`
- [ ] Live: with the assistant, log a week's Asda total, repeat it with a new figure, confirm one row and that undo restores

## Phase 78: Pantry audit route
Spec: `.claude/specs/phase78.md`
- [x] `pantrySanity()` finding classes + named thresholds + snooze filter
- [x] `pantryAudit()` batch selection and ordering
- [x] `postPantryAudit()`: validation, store write, `logWrite`, `ITEMS.pantryAudit = [null]`, undo works
- [x] Route branches, `ROUTES` rows, `ASSISTANT_ALLOWED`, `node tools/routes_build.mjs`
- [x] `worker_test.mjs` cases (incl. pantry byte-identical)
- [x] `CLAUDE.md` invariant line, HERMES.md route row; Phase 78 marked in `docs/roadmap.md`
- [ ] Live: with the assistant, run a fridge audit against the deployed Worker, confirm two items and snooze one finding, confirm `GET /pantry/sanity` withholds it

## Phase 79: Cooking mode
- [x] Spec [M]: `.claude/specs/phase79.md`
- [ ] Live: cook a meal step by step on the phone PWA with a timer running, confirm cook, check the pantry deducted once
- [ ] Live: timer finishing on the phone: screen stays awake, vibrates, strip chip pulses, toast names the step

## Phase 80: Log anything
- [x] Spec 80a [L] (Worker resolver, food log, cross-checked lookup): `.claude/specs/phase80a.md`
- [x] Spec 80b [M] (app shows off-plan food, eat-requests off-plan): `.claude/specs/phase80b.md`
- [ ] Live: get a free USDA FoodData Central key and run `npx wrangler secret put USDA_API_KEY` in `worker/`
- [ ] Live: log today's food (waffles, hoisin duck pot noodle, tea, glycine, chilli) through the assistant; check grams, unconfirmed nutrients and the pantry
- [ ] Live: log an off-plan library meal through the assistant; Plan page shows it under "Also eaten" and a "Logged off-plan:" banner, and a reload does not deduct the pantry twice
- [ ] Live: clear the stale empty waffle eat-requests from 2026-10-24

## Phase 81: Eating out, named, and skip that asks
Spec: `.claude/specs/phase81.md`

- [x] `pushSlot`, `moveSlot` and input validation, with asserts
- [x] Eating-out slot fields survive re-flow and `planMirror`
- [x] Skip sheet with four choices; eating-out sheet (name, what you had); named card label and "estimate" tag
- [x] Undo path reuses `mp_planUndo`
- [ ] Live: mark a real dinner as Spoons (burger and chips) on the phone PWA; day sheet shows "Estimate pending" then "Estimate logged", coverage includes it
- [ ] Live: skip a non-batch dinner, Move to a later slot; meal lands there, old slot re-planned, Undo restores both

## Phase 82: Swap days and edit past days
Spec: `.claude/specs/phase82.md`

## Phase 83: Flexible plan start and length
Spec: `.claude/specs/phase83.md`
- [x] Generator day count and `firstSlot`, default-output unchanged test
- [x] `shopAnchorFor`; lift the 14-day bounds listed above
- [x] Coverage ignores slots before `firstSlot` on day 1
- [x] "Customise" disclosure: date, first meal, length, shop day
- [ ] Live: generate a plan starting Thursday dinner on the phone and check Shopping

## Phase 84: Tell it anything: chat and assistant control
Spec: `.claude/specs/phase84.md`

- [x] Validators for the new edit types
- [x] `/plan/edit` route, `/plan/draft` start fields, routes.json
- [x] Chat "understood" lines and Accept flow for the new types
- [ ] Known gap: a chat/assistant `backfill` updates the plan but does not log the food (`applyPlanEdits` returns `backfilled`, unconsumed); assistant should also call `POST /food-log`
- [ ] Live: send each example message through the assistant and accept the draft

## Phase 85: Log and show every meal Hermes sends
Spec: `.claude/specs/phase85.md`

## Phase 86: Style and animate every component
Spec: `.claude/specs/phase86.md`

## Phase 87: Plan with Hermes can create and change meals
Spec: `.claude/specs/phase87.md`
