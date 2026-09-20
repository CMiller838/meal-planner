# Phase 27 — Budget soft-preference

A per-week target cost, set on the "Plan with me" screen and persisted in
`mp_planPrefs`, that turns up how hard `generator.js`'s existing `budget` step
(layer 4, `generator.js:121-140`) leans cheap as a plan half fills.

Strictly a soft preference. It never re-scores nutrition, never filters a meal
out of the pool, never caps anything, and can never make a plan fail to fill.
With no target saved, every byte of generated output is identical to today's.

## Decisions (answered 1B, 2A, 3A)

Relayed to me by the coordinating agent as the user's own picks, all three
matching my recommendation.

| # | Decision | Chosen | Why |
|---|----------|--------|-----|
| D1 | What the target number actually does | **B — adaptive pressure** | `generatePlan` accumulates spend as it places meals (one line in `place()`, which already looks up the cost entry) and feeds a pro-rata ahead/behind figure into `rankSlot`, which widens the cost shortlist when the half is running over. The static-dial alternative made the number near-decorative — £70 and £90 would have differed only by shortlist width, and the plan would never aim at the figure. |
| D2 | Per-week or per-plan | **A — per-week (per 7-day half)** | Matches the day-1 / day-8 shop days, and reuses the partition `halfKeys` (`generator.js:175`) already maintains. A week-1 blowout does not punish week 2, and "£X a week" is the unit a shop is actually budgeted in. |
| D3 | Where the value lives | **A — extend `mp_planPrefs`** to `{ updatedAt, busyDays, chips, budgetTarget }` | Same class of thing (settings, never a meal id or date), same screen, same init read, and `hermes-sync.js`'s pull becomes a one-word change. A second key would mean a second parser, a second sync path and a second thing to lose, for one number. |

### Calls made without a gate (trivial forks, noted for the record)

- **Native `<input type="range">`**, not a stepper, preset buttons or a text
  field. Platform control, free keyboard/touch support, no new CSS beyond a
  width. `min="0"`, `max`/`step` from data.
- **`0` is the off value.** `budgetTarget: 0` (and a missing/garbage value)
  means "no target", which is exactly today's behaviour. No separate enable
  checkbox, no nullable field.
- **`min` is not a config knob.** The slider starts at 0 because 0 is the off
  state; a configurable floor above 0 would make "off" unreachable. Only
  `max`, `step`, `default` and `maxShortlist` are data.
- **Only the shortlist widens; `reuseCredit` is left alone.** The roadmap says
  "widening/weighting"; widening alone is the whole effect and one knob is
  easier to reason about than two interacting ones. Add the credit boost later
  if a tight target visibly under-delivers.
- **No change to the swap picker** (`plan.js:287`, `candidatesFor`) — it
  already passes no `budget`, so layer 4 is inactive there. A manual swap is
  the user's explicit choice; budget must not reorder it.
- **No change to `worker/worker.js`** — `worker.js:117` also calls `rankSlot`
  with no `budget`, so `GET /ranking` is untouched.
- **`get()` does not clamp to `max`.** It coerces to a finite number `>= 0`;
  the slider enforces the range and the generator clamps pressure. A
  hand-edited `budgetTarget: 9999` behaves as "no pressure ever", which is
  correct and needs no validator.
- **`sw.js` cache bumps `meal-planner-v19` → `meal-planner-v20`.**
- **Tests are group 44** (group 43 is Phase 26, `test.html:1743`).

## Findings (verified, do not re-derive)

- `plan.js:889` sets `prefs = Object.assign({ vocab }, MP.PlanPrefs.get())`
  once at init. **Both** entry points flow through `generatePlan()`
  (`plan.js:91-97`): `?guided=1` → line 893, plain load → `loadPlan()` line
  896. `CLAUDE.md`'s "both entry points" claim is accurate — one wiring point.
- `plan.js:92-94` builds `budget = { costIndex: MP.ShoppingList.costIndex(...),
  ...packData.planning }`. **New `planning` keys therefore reach the generator
  with no `plan.js` change**, and `budgetTarget` reaches it via `prefs` for the
  same reason. `plan.js` is expected to have a **zero-line diff** this phase;
  if you find yourself editing it, re-read §3.
- `generatePlan(library, tags, targets, shelfData, startDate, budget, have,
  prefs)` — `budget` is the 6th arg, `prefs` the 8th. No signature change.
- `place(day, slotType, meal, countsTowardBudget)` (`generator.js:177-190`)
  already resolves `budget.costIndex[meal.id]` and already skips
  `countsTowardBudget === false` (leftover days). It is the one and only place
  spend can be accumulated correctly.
- `halfKeys = { first: new Set(), second: new Set() }` (`generator.js:175`),
  chosen by `day <= 7` in both `place()` and `rankSlot`. The spend accumulator
  mirrors it exactly.
- `MP.ShoppingList.costIndex(library, packData)` (`shopping-list.js:131-138`)
  → `{ [mealId]: { cost: number, keys: string[] } }`. `cost` is a rounded
  pack-price total, `0` for a meal with no priced ingredients.
- `costTiers` (`pack-sizes.json:62`): cheap ≤ £6.00, med ≤ £12.00 per meal —
  useful only as a sanity check on sensible `max` values; this phase does not
  read them.
- `MP.PlanPrefs.save(busyDays, chips)` has exactly **two** callers:
  `plan-with-me.js:132` and `hermes-sync.js:290`. Both change.
- `hermes-sync.js:296-301`'s `pushPlanPrefs` reads the whole raw record out of
  `localStorage` and pushes it, so it carries a new field with **no change**.
- `sw.js:4` `CACHE = "meal-planner-v19"`. Latest test group is 43.

## Non-goals

- **No hard cap.** Nothing ever refuses to place a meal, returns fewer
  candidates, or leaves a slot empty because of cost. `rankSlot` still returns
  every meal in the pool.
- **No re-scoring of nutrition.** `MP.Nutrition.rankByGap` is untouched and
  still runs first; layer 4 continues to reorder only what it produced.
- **No per-plan spend display, no "you're £12 over" banner, no shopping-list
  total change.** The target influences generation; reporting against it is
  not in scope.
- **No change to `shopping-list.js`** (`costIndex`, `mealCost`, `costTier`,
  `costBadgeHtml` all stay as-is), `nutrition.js`, `plan.js`, `worker/`,
  `shelf-life.js`, `app.js`, `discover.js`, `prefs.js`.
- **No new cost data.** No per-SKU prices, no purchase dates, no regional
  pricing. `pack-sizes.json`'s existing prices are the only source.
- No new dependency, no build step (CLAUDE.md).

### Invariants this phase must not break

- **Cost weighting never reorders nutrition** (CLAUDE.md). Pressure changes
  *how many* of `rankByGap`'s top candidates get cost-compared; it never
  changes their nutrition ranking and never reaches outside the shortlist.
- **A plan can never fail to fill.** No early return, no filter, no `continue`
  added on account of budget.
- **One-tap Generate stays one tap** and is never blocked by a missing target.
  `budgetTarget` absent/0/garbage → pressure is always 0 → `shortlistSize`
  stays `4` → output identical to today's, guarded by a test (§8).
- **`mp_planPrefs` is settings, not plan state.** `budgetTarget` is a plain
  number; the key still never holds a meal id or a date. Losing the key
  degrades to today's behaviour.
- **`MP.PlanPrefs` remains the only reader/writer of `mp_planPrefs`**, and
  `hermes-sync.js` keeps going through `get`/`save`, never `localStorage`
  directly.
- **Knobs are data, not inline constants** (CLAUDE.md). No `4`, `10`, `120` or
  `5` literal appears in `generator.js` or `plan-with-me.js`; all come from
  `pack-sizes.json`.
- **`rankSlot` stays the one ranking implementation** — its four callers
  (`plan.js` ×2, `worker.js`, `generatePlan`) keep working unchanged when
  `opts.pressure` is absent.

## §1 `pack-sizes.json` — new `planning` knobs (data)

`planning` (line 61) gains one nested block. Everything else in the file is
untouched.

```jsonc
"planning": {
  "shortlistSize": 4,
  "reuseCredit": 0.60,
  "budgetTarget": {
    "max": 120,            // slider ceiling, £ per week
    "step": 5,             // slider granularity, £
    "default": 0,          // 0 = no target (slider's initial position)
    "maxShortlist": 10     // shortlist size at full pressure
  }
}
```

| Key | Type | Notes |
|-----|------|-------|
| `max` | number | £/week ceiling offered by the slider. 120 ≈ 14 dinners at the `med` tier plus slack. |
| `step` | number | £ increment. 5 keeps the slider to 25 positions — thumb-friendly. |
| `default` | number | Slider position when nothing is saved. **Must be 0** unless the user asks for an opt-out default; anything else changes first-run plans. |
| `maxShortlist` | number | Shortlist size when pressure is 1. Must be `>= shortlistSize`; if it isn't, the effective size clamps to `shortlistSize` and the feature is a no-op (acceptable, no error). |

`planning.budgetTarget` missing entirely → the whole feature no-ops (no
slider rendered, pressure always 0). Same degrade rule as everywhere else; no
hardcoded fallback numbers in JS.

## §2 `plan-with-me.js` — storage + slider

### 2.1 `MP.PlanPrefs` (lines 8-44)

```js
/** Never throws. Bad/missing → { busyDays: [], chips: [], budgetTarget: 0 }. */
function get()                                   // -> { busyDays, chips, budgetTarget }

/** Stamps updatedAt, sorts busyDays, writes. Returns the saved object. */
function save(busyDays, chips, budgetTarget)     // -> { updatedAt, busyDays, chips, budgetTarget }
```

- `get()` coercion for the new field: `Number(parsed.budgetTarget)`; anything
  not finite or `< 0` → `0`. No upper clamp (see auto-decisions). Existing
  `busyDays`/`chips` coercion is unchanged.
- `save()`'s third parameter is coerced the same way, so a caller passing
  `undefined` (an older record, a partial Hermes payload) stores `0` rather
  than `undefined`. **Do not** add "preserve previous value when undefined"
  behaviour — `save` writes exactly what it is given, which is what the
  last-write-wins sync assumes.
- `MP.PlanPrefs = { KEY, get, save, loadVocab };` — exports unchanged.

### 2.2 Page controller

A third section between the chip row and the actions (§3). Config comes from
`pack-sizes.json` via `MP.ShoppingList.load()`, which is already memoised
(`shopping-list.js:13-17`) — `plan-with-me.html` must now load
`shopping-list.js` (§3).

```js
let budgetTarget = 0;                  // £/week, 0 = no target

function renderBudget(planning)        // wires #budget-row from planning.budgetTarget; hides the row when absent
function budgetLabel(v)                // -> "No target" | "£75 a week"
```

- **Prefill:** seed `budgetTarget` from `MP.Sync.fetchPlanPrefs()` /
  `MP.PlanPrefs.get()` in `init()` (line 96), same as `busyDays`/`chips`. A
  saved value above `max` still renders — set the slider's `max` to
  `Math.max(config.max, saved)` so the thumb is never silently snapped down.
- **Input handler:** one `input` listener on the range; update
  `budgetTarget`, set the label via `textContent`, call `renderSummary()`.
- **Summary line** (`renderSummary`, line 86) gains the target when non-zero:
  `"3 busy days · 2 preferences · £75/wk"`. When zero, the line reads exactly
  as it does today — no "no budget" noise.
- **Generate handler** (line 132): `MP.PlanPrefs.save([...busyDays],
  [...chips], budgetTarget)`. Everything else in that handler is unchanged.
- **Failure:** `MP.ShoppingList.load()` rejects or `planning.budgetTarget` is
  missing → hide `#budget-row` (same pattern as the chip row at line 73-76).
  Busy days, chips, save and Generate all still work; `budgetTarget` is then
  whatever was already saved and is still persisted untouched.

## §3 `plan-with-me.html` — slider markup

Insert after the `#chip-row` block, before `.top-actions`:

```html
<h3>Weekly budget</h3>
<div id="budget-row" class="budget-row">
  <input id="budget-range" type="range" min="0" max="120" step="5" value="0"
         aria-describedby="budget-label">
  <span id="budget-label" class="muted">No target</span>
</div>
```

`max`/`step`/`value` in the markup are placeholders overwritten by
`renderBudget()` from data — they exist so the control is sane for the one
frame before `pack-sizes.json` resolves.

Scripts: add `<script src="shopping-list.js"></script>` before
`plan-with-me.js` (for `MP.ShoppingList.load`). `shopping-list.js` needs
`data.js`, which this page already loads.

`style.css`: one rule beside the `.chip-row` block added in Phase 23 —
`.budget-row { display: flex; align-items: center; gap: .6rem; }` and
`#budget-range { flex: 1; }`. No custom thumb/track styling; the native
control already respects the colour scheme.

## §4 `generator.js` — spend accumulator + pressure (D1, D2)

### 4.1 `rankSlot` — pressure widens the shortlist

`opts` (line 86) gains one optional field:

```js
const { tags, targets, prefs, budget, halfKeys, pressure } = opts;
// pressure: number 0..1, absent/0 => today's behaviour exactly
```

Inside the `if (budget)` block (line 121), the only change is which slice
width is used:

```js
const size = shortlistSizeFor(budget, pressure);   // -> integer >= budget.shortlistSize
const shortlist = ranked.slice(0, size).filter((m) => budget.costIndex[m.id]);
```

Everything below that line — the `cost - reuseCredit * overlap` scoring, the
min-score winners, the least-recently-used tie-break, the `head.concat(rest)`
return — is **unchanged**.

```js
/**
 * Shortlist width for the current budget pressure.
 * No target / no config / pressure 0 -> budget.shortlistSize (today's 4).
 * Never below shortlistSize, never above maxShortlist.
 */
function shortlistSizeFor(budget, pressure)   // (object, number|undefined) -> number
```

Linear interpolation between `shortlistSize` and
`budgetTarget.maxShortlist`, rounded to an integer, clamped both ends.
Not exported — it is reached through `rankSlot` in tests.

Update the layer comment (line 79-81) so layer 4 reads as
"budget shortlist (width scales with budget pressure)". Layers and their order
do not change.

### 4.2 `generatePlan` — accumulate spend, compute pressure

```js
const spent = { first: 0, second: 0 };   // £ per half, mirrors halfKeys
```

In `place()` (inside the existing `if (entry)` branch at line 185, which
already excludes leftover days via `countsTowardBudget !== false`):

```js
spent[day <= 7 ? "first" : "second"] += entry.cost;
```

One new local function:

```js
/**
 * How far this half is running over its pro-rata target, 0..1.
 * 0 when there is no target, no config, or spend is at/under pace.
 */
function pressureFor(dayNum)   // (number) -> number
```

- Target per half is `prefs.budgetTarget` (a £/week figure, D2) — used as-is,
  **not** halved or doubled.
- No target (`0`, missing, non-finite) or no `budget`/`budget.budgetTarget`
  config → return `0`.
- Pro-rata expectation for day `d` within its half (`dayInHalf = d <= 7 ? d :
  d - 7`): `target * (dayInHalf - 1) / 7` — i.e. day 1 and day 8 expect zero
  spend so far, day 7 and day 14 expect the full target.
- `pressure = clamp((spent[half] - expected) / target, 0, 1)`. Under pace →
  `0` (nutrition-first, today's narrow shortlist). A full target's worth over
  pace → `1` (widest shortlist).

Threaded through the existing `pickMeal` helper (line 198-199), which already
spreads the shared opts:

```js
const pickMeal = (pool, dayNum, dayMealsSoFar, opts) =>
  rankSlot(pool, dayNum, dayMealsSoFar,
    { ...opts, tags, targets, prefs, budget, halfKeys, lastUsedDay, pressure: pressureFor(dayNum) })[0] || null;
```

No other call site changes. `MP.Generator`'s exports (line 265) are unchanged.

> **ponytail:** pressure is day-ordered — slots placed early in a half are
> picked before any overspend can register, so the last days of a half absorb
> most of the correction. Same order-dependence `halfKeys` and recency already
> have. Upgrade path, if it ever matters, is a second pass over the half; not
> worth it until a real plan misses badly.

## §5 `hermes-sync.js` — carry the new field

- Line 290: `MP.PlanPrefs.save(remote.busyDays, remote.chips)` →
  `MP.PlanPrefs.save(remote.busyDays, remote.chips, remote.budgetTarget)`.
  A remote payload from an older client has no `budgetTarget` → `save`
  coerces to `0` → no target. That is correct last-write-wins behaviour: the
  older record genuinely had no target.
- `pushPlanPrefs` (line 296) pushes the raw stored record and needs **no**
  change.
- No new route, no Worker change (`GET /ranking` does not use `budget`).

## §6 `sw.js`

- Bump `CACHE` (line 4) `"meal-planner-v19"` → `"meal-planner-v20"`.
- Shell array: add `"shopping-list.js"` **only if it isn't already listed** —
  grep first; it almost certainly is (the shopping pages use it). No new files
  ship this phase.

## §7 Docs

- **`docs/roadmap.md`** Phase 27 (lines 48-62): record the resolved fork —
  per-week target (D2), adaptive pro-rata pressure widening the shortlist
  (D1), stored in `mp_planPrefs` (D3). Mark shipped when done.
- **`CLAUDE.md`**: update the `mp_planPrefs` invariant from
  `{ updatedAt, busyDays, chips }` to
  `{ updatedAt, busyDays, chips, budgetTarget }`, keeping the "settings, not
  plan state — never a meal id or date" rule and noting `budgetTarget` is a
  £/week number where `0` means no target. Extend the "Cost weighting never
  reorders nutrition" bullet with one sentence: the Phase 27 target only
  scales how many of `rankByGap`'s top candidates layer 4 cost-compares, and
  can never filter, cap, or re-rank.
- **`docs/ARCHITECTURE.md`**: same shape update wherever `mp_planPrefs` is
  documented (Phase 23 put it near line 112), plus the new
  `planning.budgetTarget` block in the `pack-sizes.json` description.
- **`SPEC.md`**: leave unless it enumerates plan preferences; if it does, add
  the weekly target.

## Edge cases

| Case | Required behaviour |
|------|--------------------|
| No `mp_planPrefs`, or `budgetTarget` absent | `get()` → `0`. Pressure always 0, shortlist stays 4, plan byte-identical to pre-Phase-27. |
| `budgetTarget` is `"75"`, `null`, `NaN`, `-10` | Coerced to `0` by `get()`/`save()` except a valid numeric string, which becomes `75`. Never throws. |
| `budgetTarget` above `max` (hand-edited or synced) | Kept. Slider `max` widens to fit it. Pressure is simply never large, so it behaves as "no target". |
| `pack-sizes.json` 404s / invalid | `packData` null → `plan.js:92-94` already passes `budget: null` → the whole layer-4 block is skipped, exactly as today. Setup screen hides `#budget-row`. |
| `planning.budgetTarget` block missing | `shortlistSizeFor` returns `budget.shortlistSize`; `pressureFor` returns 0. Feature absent, nothing breaks. |
| `maxShortlist <= shortlistSize` | Effective size clamps to `shortlistSize`. Feature is a no-op. No warning, no throw. |
| Target set absurdly low (e.g. £20/wk) | Pressure saturates at 1 within a couple of days; shortlist sits at `maxShortlist`. The plan still fills all 14 days, still nutrition-ranked, just consistently picking the cheapest of a wider top slice. **Never** an empty slot or a failed generate. |
| Target set at/above realistic spend | Pressure stays 0 all fortnight; identical to no target. |
| A meal has no priced ingredients (`cost: 0`) | Already handled: `costIndex` gives `cost: 0`, `place()` adds 0, the shortlist filter keeps it. Unchanged. |
| Leftover day (`countsTowardBudget === false`) | Adds nothing to `spent` — a leftover is not a second shop. Guarded by a test. |
| Half boundary | `spent.second` starts at 0 on day 8 regardless of week 1 (D2). A week-1 overspend does not bias week 2. |
| Swap picker / `GET /ranking` | Neither passes `budget`, so neither sees pressure. Unchanged. |
| Offline (PWA) | No new files; v20 cache bump only. `shopping-list.js` and `pack-sizes.json` are already cached. |

## §8 Tests — `test.html` group 44

Logic-only, no DOM. Group 43 is Phase 26 (`test.html:1743`), so this is
**group 44**. Write these before the code.

- **Regression guard first** (the test this phase exists for):
  `generatePlan(...)` with `prefs.budgetTarget = 0` produces a plan deep-equal
  to the same call with `prefs.budgetTarget` absent, **and** deep-equal to a
  call with `prefs: {}`. One-tap Generate is unchanged.
- `rankSlot` with `pressure: 0` vs `pressure` absent → identical ordering.
- `rankSlot` with `pressure: 1` and a fixture where the 5th-ranked meal is by
  far the cheapest: it reaches the head at pressure 1 (shortlist widened) and
  does **not** at pressure 0. Proves widening works.
- `rankSlot` at any pressure returns **every** meal in the pool (minus
  `excludeIds`) — length and id-set unchanged. Proves nothing is filtered.
- `rankSlot` at any pressure with `budget.budgetTarget` config absent →
  ordering identical to pressure 0.
- `maxShortlist` less than `shortlistSize` → ordering identical to pressure 0.
- Spend accumulation: `generatePlan` over a fixture library where every dinner
  is priced, with a deliberately tight target, yields a lower total plan cost
  (summed via `MP.ShoppingList.costIndex`) than the same call with target 0 —
  while filling all 14 days with a non-null dinner in every slot.
- Leftover days don't count: a fixture with a batch meal chained into the next
  day produces the same `spent`-driven behaviour as one where the leftover day
  is empty (assert via the resulting plan, not internals).
- Per-half reset (D2): a plan whose week 1 blows the target does not produce a
  week 2 that differs from the same fixture with a cheap week 1. Week 2's
  pressure starts at 0.
- `MP.PlanPrefs.get()` with no key → `budgetTarget: 0`.
- `get()` coercion: stored `"75"` → `75`; `null`, `"abc"`, `-5`, `{}`, `NaN`
  → `0`; no throw for each.
- `save([2], ["comfort"], 75)` round-trips through `get()` with
  `budgetTarget: 75` intact and `busyDays`/`chips` unaffected.
- `save([], [], undefined)` → stored `budgetTarget: 0` (not `undefined`,
  not missing) — guards the Hermes older-payload path.

## §9 Manual pass

1. `python3 -m http.server 8000`, open `plan.html`. One-tap Generate still
   generates in one tap with no target ever set — and the plan looks like it
   did before this phase.
2. Open `plan-with-me.html`. Slider sits at 0, label reads "No target", summary
   line reads exactly as before.
3. Drag the slider — label tracks in £5 steps, summary line gains `· £N/wk`.
   Drag back to 0 — the `/wk` part disappears.
4. Set a tight target (e.g. £40/wk), Generate, and eyeball the plan: all 14
   days filled, cheaper meals cluster toward the back half of each week.
   Cross-check against the shopping list's totals.
5. Set a loose target (e.g. £120/wk), Generate — plan should look like the
   no-target plan.
6. Re-open `plan-with-me.html`: the saved target is pre-selected on the slider.
7. `localStorage.removeItem("mp_planPrefs")`, reload both pages — no errors,
   slider at 0, one-tap Generate normal.
8. DevTools → set `mp_planPrefs.budgetTarget` to `"abc"` → reload: slider at 0,
   no console exception.
9. DevTools → Network → block `pack-sizes.json` → reload the setup screen:
   budget row hidden, busy grid/chips/Generate all still work; `plan.html`
   still generates.
10. Dark and light mode: the slider and its label are legible in both.
11. Offline (DevTools → Offline, after one load): both pages still work from
    the v20 cache.
