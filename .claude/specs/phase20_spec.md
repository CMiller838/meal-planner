# Phase 20 — Meal servings & leftover-eating

**Goal:** One cook supplies more than one eat. `servings: N` (already on every
meal) becomes the single source of leftover-chain eligibility, and the eat flow
splits into two events: **Cooked** (deducts pantry, once per cook instance) and
**Ate a portion** (writes one nutrient-log entry per sitting, never touches the
pantry).

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **`batchCook` is deleted; batch eligibility derives from `servings >= 2`** — Gate 1, Path B, relayed by the coordinator as confirmed with the user | The user's stated eating pattern is that most real meals are multi-serving and eaten across dinner + next-day lunch. One field, not two |
| 2 | **Portions live in a new `mp_cooks` localStorage record; extra portions are eaten off-plan** — Gate 2, Path A, relayed by the coordinator as confirmed with the user | The phase goal is explicitly "without forcing every extra portion into its own scheduled plan slot". The plan slot schema `{mealId, variantId?, eatenAt?}` is untouched, so Phase 21, `applyPlacements` and the Hermes `plan` mirror all keep working unchanged |
| 3 | **Double-deduction is prevented structurally, not by convention** — the portion-eat path never fetches the pantry, never calls `MP.ShoppingList.eatPlan`, and shares no code with `commitCook` except a log-only helper | The coordinator's requirement was explicit that this be impossible by construction. See §4 |
| 4 | **`MP.isBatch(meal)` is one shared predicate in `data.js`**, not the same expression re-derived at four call sites | `batchCook` has four live consumers (§1). A derived rule copy-pasted four times is the version that drifts |
| 5 | **Batch eligibility is `servings >= 2 && !leftoverOf`** — the `!leftoverOf` guard is mine, not the coordinator's; see "Flagged forks" | A `leftoverOf` meal is a chain *child*. Without the guard `chicken-fajitas` can be picked as a run *anchor* and cooked fresh, but its ingredients assume leftover roast chicken already exists |
| 6 | **Everything stays in `plan.js`; no new `eat.js`, no new file** | The Eat action stays plan-grid-only (see non-goals), so `phase12_spec.md` decision 5 still holds: a new file would be a new `sw.js` SHELL entry and a new script tag to buy nothing |
| 7 | **`mp_cooks` is local-only — no KV key, no Worker route, no Hermes mirror** | Nothing asked for it. `sw.js`/`worker.js` stay untouched |
| 8 | **Cook records expire on the existing `cooked_leftovers.fridgeDays` window**, not on an invented cap | Leftovers past the fridge window are not edible, so an expired record is not data worth keeping. Reuses `shelf-life.json`, no new number |

## Findings (verified, do not re-derive)

- `servings` already exists on **all 15 meals** as a required field. Values ≥ 2:
  `roast-chicken` 4, `chilli-con-carne` 3, `chorizo-pasta` 2, `chicken-fajitas` 2.
  Every other meal is `servings: 1`.
- `batchCook: true` today is exactly 3 meals (`meals.json:40, 81, 101`). Under
  decision 5 the derived set is **the same 3** — `chicken-fajitas` is excluded by
  `leftoverOf`. Net generator behaviour change: **none**.
- `batchCook` has four non-test consumers: `generator.js:122` (batch candidate
  filter), `shopping-list.js:146` (dinner dedupe, guarded by comment at 135),
  `shelf-life.js:95` (cooked-leftovers window), `app.js:441` + `mealdb.js:58`
  (hardcoded `false` on new meals — no form input exists for it).
- `generator.js:132` already computes
  `Math.min(run.length, parent.servings || 2, shelfData.cooked_leftovers.fridgeDays)`.
  **Coverage maths is already servings-driven and does not change.**
- `commitEat(pantry)` (`plan.js:487-517`) is today's single event: `eatPlan` →
  apply ops to both mirrors → `queueOp` → `slot.eatenAt` if `day` → `Prefs.bump`
  → toast → `flushOps` → async tags → `MP.Sync.logEaten`.
- Both eat entry points are in `plan.js` and both stay there: the detail modal's
  `.detail-eat-btn` (324, wired 330, `openEatSheet(effMeal, null, null)` — this
  is already an off-plan eat, `day` is null) and the day-slot `.day-eat-btn`
  (356, wired 421). `#eat-overlay` markup is `plan.html:51-52` only.
- `MP.Sync.logEaten(entry)` (`hermes-sync.js:327`, exported 361) takes
  `{id, mealId, name, eatenAt, tags}`, dedups on `id`, caps at 200.
- Variety guard is `excludeIds` + `prevMealId` (`generator.js:68-72`), one day
  back, applied at 120-121, 145-146, 155-156.

## Non-goals

- **No per-portion resizing.** `CLAUDE.md` fixes portion size at a hungry
  20-year-old male appetite; `servings` is a count on top of that. Ingredient
  `qty` is not divided, scaled or re-rounded anywhere in this phase.
- **No change to the variety/repeat-spacing guard.** Leftover *eating* is
  post-hoc bookkeeping, not planning; the guard keeps spacing scheduled cooks
  exactly as today. (Roadmap open question 2, resolved: no-change.)
- **No change to `generator.js`'s run-fill algorithm, coverage maths, or
  leftover slot shape.** Only the one-line candidate filter at 122 changes.
- **No plan slot schema change.** No `cookedAt`, no `portionsLeft` on a slot.
- **No pantry-deduction logic change.** `MP.ShoppingList.eatPlan` and
  `shelf-life.js`'s cooked-day rule are untouched; this phase only changes *how
  often* the existing deduction fires.
- **Eat stays plan-grid-only.** No Eat action is added to Browse/`app.js`, no new
  file, no markup duplicated into `index.html`. Ad-hoc eating of something that
  is not in the app at all (a sausage bought on the way home) is out of scope and
  handled by messaging Hermes separately — do not build toward it.
- **No Phase 21 work** — no pantry-driven variant choice.

**Design note — tolerate deviation, don't prevent it.** The user does not follow
the plan exactly: a leftover gets eaten a day late, a portion gets skipped, a
cook happens off-schedule. Corrections happen through Hermes after the fact, so
nothing here should validate, block or reconcile a portion eaten "at the wrong
time". `mp_cooks` deliberately has no scheduled-day field and no link to a plan
slot — a cook record is just "N portions exist, cooked at time T". This is why
Gate 2 Path A (off-plan eating, no forced slot) was the right call, and it is the
reason to resist adding "you already ate this" guards later.

---

## §1 `MP.isBatch` and the `batchCook` removal

`data.js` — one export beside `esc()` / `effectiveMeal`:

```
/** True if this meal yields leftovers worth chaining: multi-serving and not
 *  itself a leftover child. Replaces the removed `batchCook` field. */
MP.isBatch(meal) -> boolean          // (meal.servings || 1) >= 2 && !meal.leftoverOf
```

Then replace every consumer:

| File:line | Was | Becomes |
|---|---|---|
| `generator.js:122` | `dinnerPool.filter((m) => m.batchCook === true)` | `dinnerPool.filter(MP.isBatch)` |
| `shopping-list.js:146` | `&& meal.batchCook` | `&& MP.isBatch(meal)` |
| `shelf-life.js:95` | `if (meal.batchCook)` | `if (MP.isBatch(meal))` |
| `app.js:441` | `batchCook: false,` | delete the line; `servings: 1` is already the new-meal default |
| `mealdb.js:58` | `batchCook: false,` | delete the line; ensure `servings: 1` is set |

`meals.json` — remove the `"batchCook"` key from all 15 records. Leave
`servings`, `leadsTo`, `leftoverOf`, `prepEffort` exactly as they are.

`shopping-list.js:135`'s comment must be reworded — it names `batchCook`.

**Load-order note:** `data.js` is first in every page's script list
(`index.html:69`, `plan.html:56`, `shopping.html:47`, `discover.html:68`,
`test.html:10`), so `MP.isBatch` is available to all four consumers with no
script-tag reordering.

**Cache bump:** `sw.js`'s `CACHE` (line 4) must go to the next version in the
same commit — this phase edits eight cached files, and an installed PWA would
otherwise serve the old JS against the new `meals.json`. `SHELL` is unchanged.

**Docs freeze:** Phases 6 and 8 froze `batchCook` as a field an edit must
preserve (`phase6_spec.md:34`, `phase8_spec.md:27`). That frozen-field list must
drop `batchCook` in the same commit, or the edit path preserves a field that no
longer exists.

## §2 `mp_cooks` — the cook record

New localStorage key `mp_cooks`, a **bare JSON array** (same shape convention as
`mp_eatenLog`, which is deliberately not an `{updatedAt, ...}` object):

```
[{
  id:           string,   // `${mealId}:${cookedAt}` — same convention as the eaten-log id
  mealId:       string,
  name:         string,   // denormalised for the picker label; the library may change later
  variantId:    string | null,
  cookedAt:     string,   // ISO8601
  portionsLeft: number    // integer >= 0
}]
```

Lives in `plan.js` alongside the flow that owns it:

```
MP.Cooks.all()                    -> array          // parsed, expired entries pruned
MP.Cooks.openFor(mealId)          -> array          // portionsLeft > 0, newest first
MP.Cooks.open(meal, variantId, portions) -> record  // appends; no-op when portions < 1
MP.Cooks.take(cookId)             -> record | null  // decrements portionsLeft by 1, persists
```

- **Pruning** (inside `all()`, the single read path): drop any record whose
  `cookedAt` is older than `shelfData.cooked_leftovers.fridgeDays` days, and any
  with `portionsLeft <= 0`. Pruning on read means no timer and no cleanup job.
- `MP.Cooks` **never** imports or calls anything from `MP.ShoppingList`. That
  absence is decision 3's enforcement, not an accident — do not add a
  convenience wrapper that "also updates the pantry".
- A malformed/absent `mp_cooks` parses to `[]`. Never throws, never blocks a meal
  being eaten.

## §3 The eat sheet's three branches

`openEatSheet(meal, day, slotType)` becomes a router. Compute
`const open = MP.Cooks.openFor(meal.id)` **before** any pantry fetch.

| Branch | Condition | Sheet | Confirm action |
|---|---|---|---|
| **A. Portion available** | `open.length > 0` | Choice list: one row per open cook, `"Ate a portion — cooked Tuesday (2 left)"`, plus a secondary `"No, I cooked this fresh"` that re-renders as B or C | `eatPortion(cookId)` — §4b |
| **B. Fresh multi-serving cook** | `open.length === 0` && `(meal.servings \|\| 1) >= 2` | Today's pantry-row sheet, plus one line: `"Cooking N portions — 1 now, N−1 saved as leftovers"` | `commitCook()` — §4a, opens a record with `portionsLeft = servings − 1` |
| **C. Single-serving** | `open.length === 0` && `(meal.servings \|\| 1) <= 1` | **Exactly today's sheet, unchanged** — no portion UI, no extra line | `commitCook()` — §4a, opens no record |

Branch C is the no-visible-change path and covers 11 of 15 meals. Branch A is
reachable for a `servings: 1` meal only if a record somehow exists; the
`portionsLeft` check makes that harmless rather than special-cased.

**In branch A the pantry is never fetched and no `.eat-qty` inputs are
rendered.** `openEatSheet`'s existing `await MP.Sync.fetchItems("pantry")`
(`plan.js:474`) moves *inside* the B/C path.

Labels use `esc()` on `meal.name` and on `cook.name` — the latter can originate
from a TheMealDB import (`CLAUDE.md` trust boundary).

## §4 The two events

### 4a. `commitCook(pantry)` — the only pantry writer

`plan.js:487`'s `commitEat` renamed and extended. Steps 1-6 of
`phase12_spec.md` §3c are unchanged (`eatPlan` → apply ops to both mirrors →
`queueOp` → `slot.eatenAt` when `day` → `Prefs.bump` → toast → `flushOps`). Two
additions, after the ops are applied:

- `MP.Cooks.open(meal, variantId, (meal.servings || 1) - 1)` — the `-1` is the
  portion being eaten right now. `servings: 1` therefore opens nothing.
- Toast gains `" · N portions saved"` when a record was opened.

Then `logPortion(meal, eatenAt)` (below) — the existing tail at `plan.js:513-516`,
extracted verbatim.

### 4b. `eatPortion(cookId)` — never touches the pantry

```
function eatPortion(cookId)   // decrement, log, close. No pantry, no ops, no eatPlan.
```

1. `const cook = MP.Cooks.take(cookId)`; bail silently if `null` (already eaten
   in another tab).
2. If `eatCtx.day` is set, write `slot.eatenAt` + `savePlan()` + `renderPlan()`
   — the grid stays honest when the portion *was* a scheduled leftover slot, and
   `applyPlacements`' `"eaten"` rejection reason keeps working.
3. `MP.Prefs.bump(meal, "eaten")` — a portion eaten is still a preference signal.
4. `closeEatSheet()`, toast `"Portion eaten — N left"`.
5. `logPortion(meal, eatenAt)`.

This function contains no reference to `pantry`, `eatPlan`, `applyOps`,
`writeLocalItems` or `queueOp`. **That is the invariant a reviewer checks.**

### 4c. `logPortion(meal, eatenAt)` — the only shared code

```
function logPortion(meal, eatenAt)   // tags lookup + MP.Sync.logEaten, fire-and-forget
```

Lifted unchanged from `plan.js:513-516`. Log-only: it is the sole thing 4a and
4b share, so sharing it cannot leak a pantry write into the portion path. Entry
`id` stays `` `${meal.id}:${eatenAt}` ``, preserving Phase 15's dedup (D6).

**One entry per sitting**: 4a logs one (the portion eaten at cook time), 4b logs
one per call. A 3-serving meal cooked then eaten twice more = 3 log entries, 1
pantry deduction.

## Edge cases

- **Two tabs eat the same last portion.** `MP.Cooks.take` re-reads localStorage,
  decrements, writes. The loser gets `null` and bails silently — no error toast,
  no negative counter.
- **Meal deleted from the library while a cook is open.** `openFor` is queried by
  `mealId` from a meal that exists, so an orphan record is simply never reachable
  and prunes out on its window. Do not add a cascade delete.
- **Meal edited (renamed) after cooking.** The picker shows the denormalised
  `cook.name`. Accepted, same trade-off Phase 15 took for log entries (D2).
- **Cook record survives past the fridge window with portions left.** Pruned on
  read. The user eating 4-day-old leftovers is a shelf-life warning's job, not
  this counter's.
- **`servings: 0` or missing.** `(meal.servings || 1)` → treated as 1, branch C.
- **`shelfData` unavailable when pruning.** Fall back to keeping the record;
  never drop a cook because a fetch failed.
- **A leftover slot the generator scheduled is eaten via branch A**, and the
  parent cook was never recorded (plan generated before this phase shipped). No
  open record exists → branch B/C, pantry deducted again. Accepted: pre-existing
  plans predate the model. Note it in the manual pass, do not migrate old plans.

## §5 Tests — `test.html` group 38

Group 37 is Phase 18 and Phase 19 added none, so this is **group 38**.

- `MP.isBatch`: `servings: 3` → true; `servings: 1` → false; missing `servings`
  → false; `servings: 2` with `leftoverOf` set → **false**; `servings: 4` with
  `leadsTo` → true.
- Regression: the three previously-`batchCook: true` seed meals are still batch
  under `MP.isBatch`, and `chicken-fajitas` is **not**. This is decision 5's guard.
- Regression: the existing run-fill assertion (`test.html:63-75`) now asserts
  run-day-1 satisfies `MP.isBatch` instead of `first.batchCook`. Generated plans
  for the seed library must be **unchanged** — assert that explicitly.
- `MP.Cooks.open`: `portions < 1` appends nothing; `portions: 3` appends one
  record with `portionsLeft: 3`; id is `mealId:cookedAt`.
- `MP.Cooks.take`: decrements by 1; taking the last portion leaves a record that
  the next `all()` prunes; unknown id → `null`, no throw.
- `MP.Cooks.all`: record older than `cooked_leftovers.fridgeDays` is pruned;
  record inside the window is kept; malformed JSON → `[]`, never throws.
- **Double-deduction guard:** a fixture cook + two `eatPortion` calls produce
  **zero** pantry ops and **two** log entries. This is the test the phase exists
  for — write it first.
- Regression: group 34 (Phase 15 log) fixtures unchanged — `logEaten`'s entry
  shape, dedup and 200-cap are untouched.

## §6 Docs

- `docs/roadmap.md` — Phase 20 → **Status: Complete**; as-built note that
  `servings` already existed so this deleted `batchCook` rather than adding
  `servings`, and that open question 2 (variety guard) resolved to no-change.
- `CLAUDE.md` — replace the `batchCook: true` mention in the batch-cook invariant
  with `MP.isBatch` / `servings >= 2 && !leftoverOf`; add the cook-vs-portion
  invariant (pantry deducts once per cook, log writes once per sitting, the
  portion path may never touch the pantry).
- `docs/ARCHITECTURE.md` — `mp_cooks` in the localStorage key list, marked
  local-only (no KV mirror). No file-map change — no new file.
- `SPEC.md` — one line: one cook, several eats.
- `docs/FUTURE.md` — park syncing `mp_cooks` to Hermes ("what leftovers are in
  the fridge") as deliberately skipped.
- `phase6_spec.md` / `phase8_spec.md` frozen-field lists — see §1.

## §7 Manual pass

- Cook a 3-serving meal, then eat two portions. Pantry deducts **once**; the
  eaten log has **three** entries. Check `mp_pantry` and `mp_eatenLog` directly.
- Eat a `servings: 1` meal — the sheet must look and behave exactly as before.
- Eat a portion off-plan via the plan page's library detail `Eat this` button
  (`plan.js:324`, `day` is null). Log entry written, plan grid unchanged.
- Regenerate a plan and confirm it matches a pre-phase plan for the same seed.
- Dark mode on the new picker rows — it is the default.
