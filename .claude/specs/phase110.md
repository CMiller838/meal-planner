# Phase 110: Dinners only, remove breakfast, lunch and snack [L]
Plain: the app plans one dinner a night; breakfasts and lunches leave the plan but stay one tap to log.

Requires: nothing unbuilt. Next: Phase 111 (dinner-share targets): until it lands, coverage reads dinner-only against full daily targets, which is expected.

## Decisions
- **User-chosen: non-dinner library meals are kept, log-only.** `mealTypes` keeps only `"dinner"`; `[]` means "not a dinner". The generator, chat `place`, cook-now and the Worker never pick one. Browse Eat and the "I ate" bar still log them (with tags). Nothing is deleted.
- **Own call (ADR, `docs/ARCHITECTURE.md` "v13 - dinners only"): keep the `d.slots.dinner` shape**, not a flat `d.dinner`. ~150 call sites, `planMirror`, `mp_planUndo` and the KV mirror key on `d.slots[t]`; setting every slot list to `["dinner"]` keeps them all working.
- **Own call: one pure normaliser `MP.dinnersOnly(plan)` (`data.js`)** reduces each day's `slots` to `{ dinner }` (absent stays absent) and drops `plan.firstSlot`; null/malformed in = same out; a clean plan comes back deep-equal. Every `mp_plan` reader runs through it (list under Files touched). The Worker's loops use `SLOT_TYPES`, so stale mirror keys are inert; the next `planMirror` push cleans KV. `data.js` already has the `window`→`root` shim; `dinnersOnly` uses no `window`.
- **Own call: library normalised on read.** `getLibrary` (`data.js`) maps every meal's `mealTypes` to `(mealTypes || []).filter(t => t === "dinner")` on every call, writing back unstamped only when something changed (same rule as `fillMethods`: a stamp would make it look like a newer edit). Covers libraries pulled from KV too. `mealdb.js` `toMeal`: Breakfast category → `[]`.
- **Own call: `firstSlot` (Phase 83) removed end to end** (one slot = no-op; a later start date covers "start tomorrow"). The Worker *ignores* an incoming `firstSlot` (no 400) so an older bridge keeps working; `plan-chat.js` drops it from a `start` edit silently.
- **Own call: `lunchEffort` (Phase 99) and the guided "Also choose" passes are deleted**, not hidden.
- No migration for ratings (keyed by meal id), `mp_eatenLog` or food-log entries (no slot field: `hermes-sync.js` `logPortion`). A `fromCook` lunch slot dropped by `dinnersOnly` leaves its Cooks portions untouched.

## Files touched
Pattern: every `SLOT_TYPES` / `SLOTS` / `SLOT_ORDER` list becomes `["dinner"]`; branches for other slots are deleted.
- `generator.js`: delete `OTHER_SLOTS`, its fill loop (~450-465), `skipDay1` and `firstSlot` in the return; locked loop over `["dinner"]`.
- `data.js`: add `dinnersOnly` + export; `getLibrary` strip; slot lists at the `keep`/placement validator (~359), `SLOT_ORDER` (~379), `reflowPlan`/`rollPlan` `SLOTS`; `placeSlots` "not a dinner meal" (~446); a cook fills dinner only (~456); `rollPlan` stamp drops `firstSlot`; `eatMeal` reads through `dinnersOnly`; delete `lunchEffort` + `MP.lunchEffort`.
- `plan.js`: `SLOT_TYPES`; `OUT_TIME` dinner only; delete `GUIDED_EXTRAS`/`parseGuidedSlots` (guided passes always `["dinner"]`); brief drops `lunchEffort` (~676) and `firstSlot` (~682); cook-now leftovers when `slotType === "dinner"` (~1599); `genOpts` loses `firstSlot` (~44, 57, 424, 2299, 3208 `first` param); coverage partial-day flag (~1497, 1965) and `early` (~2561) go; `loadPlan`, `restore`, readers ~2381/2513/3200 through `MP.dinnersOnly`.
- `plan-with-me.html` + `plan-with-me.js`: remove `#first-slot` label/select and the "Also choose" heading + `#also-row`, and their handlers (`first`/`slots` URL params).
- `index.html` + `app.js`: remove `#library-filters` and the `activeType` filter (~278); meal form type checkboxes (~541, 619, 686) → one `Plan as a dinner` checkbox (`["dinner"]` or `[]`); Browse card for a meal without `dinner` shows a `Not planned` label (house style `docs/UI_STYLE.md`); search over mealTypes (`data.js` ~815) unchanged.
- `shopping-list.js`: `SLOT_TYPES`; delete the batch-lunch rule (~288-291). `shopping.js` `loadPlan` through `MP.dinnersOnly`.
- `plan-chat.js`: `SLOTS`; `freeze` places `slot === "dinner"` (~91); `types()` keeps only dinner (a `mealCreate` with `["lunch"]` gets `[]`); `start` drops `firstSlot` (~68-69, 198).
- `bar-chat.js`: `OUT_TIME`, `SLOTS`, `readPlan` through `MP.dinnersOnly`.
- `hermes-sync.js`: `SLOT_TYPES`; mirror/pull drop `firstSlot` (~334, 546); plan read at ~627 through `MP.dinnersOnly`.
- `mealdb.js`: Breakfast → `[]`.
- `worker/worker.js`: `SLOT_TYPES = ["dinner"]`; 400 messages "slot must be dinner"; `firstSlot` removed from `/plan/generate` body, `freshStart`, `startOpts`, `runGenerator`, mirror read (~326) (ignored when sent); `draftError` mealTypes check unchanged code (now dinner only).
- `tools/hermes_chat_bridge.py`: `EDIT_TYPES`/`BAR_EDIT_TYPES` "slot is always dinner"; freeze places dinner; drop the "Breakfast, lunch and dinner only…" and Lunches sentences (~149-150) for "Plan dinners only". `tools/test_hermes_chat_bridge.py` line 28: drop `lunchEffort`, assert `"lunchEffort" not in p`.
- `sw.js`: `CACHE` bump (task 1).
- `test.html`, `tools/worker_test.mjs` (~557-590), `tools/browser-check/walk.mjs` (~196-259).
- Docs: `SPEC.md` slot wording; `CLAUDE.md` invariants: Phase 83 line (drop `opts.firstSlot`, `plan.firstSlot`, URL `first`), Phase 105/90a freeze/cook slot wording if it says lunch; `docs/ARCHITECTURE.md` new `## v13 - dinners only (Phase 110)` (already written at planning); `docs/roadmap.md` heading on commit.

## Signatures
- `MP.dinnersOnly(plan) -> plan` (`data.js`, pure). Consumers: `plan.js` `loadPlan`/`restore`/reload readers, `shopping.js` `loadPlan`, `bar-chat.js` `readPlan`, `hermes-sync.js` plan read, `data.js` `eatMeal`.
- `getLibrary()` unchanged signature; returned meals' `mealTypes ⊆ ["dinner"]`. Consumers: every library reader (unchanged).
- `generatePlan(library, …, locked, opts)`: `opts.days` only; return has no `firstSlot`.

## Edge cases
- Old plan whose day has only lunch: day keeps `slots: {}` (an empty dinner slot, fillable), never removed.
- Old `mp_planUndo` snapshot with lunches: `restore` returns it normalised.
- `fromCook`/`frozenFrom`/`eatingOut` dinner slots survive `dinnersOnly` untouched.
- A meal with `mealTypes: ["lunch","dinner"]` stays plannable as a dinner.
- Hermes sends `slot: "lunch"` in a chat/bar edit or `/plan/edit` → dropped by `validateReply` / 400 from the Worker; nothing applies.
- `POST /plan/generate` with `firstSlot: "lunch"` and a `startDate` → 200, field ignored.
- Library with every meal non-dinner: generator leaves dinners empty, no crash (existing empty-pool path).

## Verification
- `python3 check.py` (timeout 600000) all green; `node tools/worker_test.mjs`; `python3 tools/test_hermes_chat_bridge.py`.
- `grep -nE "breakfast|lunch|snack" *.js worker/*.js tools/hermes_chat_bridge.py` hits only `mealdb.js`'s Breakfast-category check and comments.
- `walk.mjs` asserts each of: an old-shape `mp_plan` (breakfast+lunch+dinner) loads with only `[data-slot="dinner"]` cards and the same dinner meal ids; a generated plan has exactly one `.slot-card` per day; `plan-with-me.html` has no `#also-row` and no `#first-slot`; Browse has no `#library-filters`, a non-dinner meal card shows "Not planned" and its Eat still adds an `mp_eatenLog` entry; drag dinner day 1 → day 2 swaps them (and Alt+Arrow keeps focus); the shopping list renders items. Checked at PC and 390 px, dark and light (`prototype-preview`).
- No real credential needed: Worker tests use fakes.

## Tasks
### Logic (TDD)
- [ ] 1. `test.html` cases for `MP.dinnersOnly` (old shape, only-lunch day, `firstSlot` dropped, null, clean = equal) and the `getLibrary` strip (unstamped write-back only on change); implement in `data.js`; bump `sw.js` `CACHE`.
- [ ] 2. Generator: delete other-slot fill, `skipDay1`, `firstSlot`; update `test.html` generator/Phase 83 cases (one slot per day; no `firstSlot` case).
- [ ] 3. `data.js` slot lists, `placeSlots`/cook dinner-only, `rollPlan` stamp, `eatMeal` via `dinnersOnly`, delete `lunchEffort` (+ its Phase 99 `test.html` cases); `plan-chat.js` slots/freeze/`types()`/`start`; `shopping-list.js` + `shopping.js`; `bar-chat.js`; `hermes-sync.js`; `mealdb.js`. Move remaining `test.html` breakfast/lunch fixtures to dinner; add `validateReply` drops a `slot: "lunch"` edit.
- [ ] 4. Worker: `SLOT_TYPES`, messages, `firstSlot` removed/ignored; `worker_test.mjs`: replace the `b1` breakfast fixtures, assert `slot: "breakfast"` → 400 on `/plan/edit`, `firstSlot` ignored on `/plan/generate`.
- [ ] 5. Bridge prompt text + `test_hermes_chat_bridge.py`.
### UI (`ui-build`)
- [ ] 6. Plan with me: remove first-slot select and "Also choose" + handlers.
- [ ] 7. Browse: remove type chips + filter; "Not planned" label; form "Plan as a dinner" checkbox.
- [ ] 8. `plan.js`: `SLOT_TYPES`, guided passes, `OUT_TIME`, brief keys, cook-now leftovers, coverage flag, readers via `dinnersOnly`; plan grid still lays out cleanly with one row (PC + 390 px, both themes).
- [ ] 9. `walk.mjs`: rewrite drag/Alt+Arrow steps to dinner across days, delete the guided `slots=lunch` step, add one assertion per Verification bullet.
- [ ] 10. Docs: `SPEC.md`, `CLAUDE.md` invariant lines.
