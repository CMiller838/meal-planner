# Tasks

Per-phase breakdowns are written by `@planner` in phase mode, just before each
phase is built. Placeholders below track roadmap progress only.

Previous checklist (Phases 1-15, all shipped) archived at
`.claude/archive/tasks_20260906.md`. Previous checklist (Phases 16-21, all
shipped) archived at `.claude/archive/tasks_20260913.md`. Previous checklist
(Phases 22-26, all shipped) archived at `.claude/archive/tasks_20260920.md`.

---

## Phase 27 — Budget soft-preference

Spec: `.claude/specs/phase27_spec.md`. Decisions: 1B (adaptive pressure),
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

## Phase 28 — Generic ingredient-substitution groups

Spec: `.claude/specs/phase28_spec.md`. Decisions: 1B (new
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

## Phase 29 — Live-build-watching (staged local generation render)

## Phase 30 — Hermes quantity ingestion (screenshot → structured quantities)

## Phase 31 — Partial-ingredient leftover tracking
