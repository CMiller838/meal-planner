# Phase 63: Mid-week re-flow [L]
Plain: skip a cook, eat out or run out of something, and only the rest of the week re-plans, with your eaten and edited meals untouched and an undo.

Requires Phase 66 (`slot.locked`, `generatePlan`'s trailing `locked` arg, `MP.chainDays`; built before this in `/overnight` order) and Phases 43, 48, 49 (built).

## Decisions

User-chosen:
- **Undo = app-side snapshot.** Before applying, the app saves the old plan to `mp_planUndo`. An "Undo re-flow" toast/button and the Activity "Undo" for the matching entry both restore it. Phase 48's log only reverts KV keys; the app's `localStorage` plan is the authority.
- **Manual edits = auto-lock.** `setSlotMeal` also sets `locked: true`, so hand-swapped slots survive a re-flow. This amends Phase 66's "only the user locks" line (a swap is the user's act); amend `.claude/specs/phase66.md` in the same build.
- **Split apply path.** The app button applies instantly with an undo toast. `POST /plan/reflow` (Hermes) stores a pending `planDraft` (Phase 49) and the existing banner applies it.

Own calls:
- **Re-flow = `Generator.generatePlan` with `locked` seeded**: past days, eaten slots, locked slots, plus a skipped/eating-out slot emptied. Nutrition still decides the meal; `generator.js`/`rankSlot` gain no diff beyond Phase 66.
- **A chain moves as one unit** (`MP.chainDays`, `data.js`): skipping a batch cook frees its leftover days; an eaten parent keeps the chain.
- **Input** `{ skipped: [{day, slot}], eatingOut: [{day, slot}], ranOut: [string] }`. `ranOut` keys feed the same pantry-removal path as Phase 39 for the generator's `have` index only; re-flow never writes the pantry (`commitCook` stays the only writer). Eating out leaves the slot empty with an "Eating out" note; it is never regenerated.
- **Idempotent**: draft id = `draftId(changes)` (Phase 49). Same input twice gives the same draft.
- // ponytail: past days = before today's date; a mid-day re-flow keeps today's un-eaten slots re-plannable. Upgrade: time-of-day cutoff.

## Files touched

- `worker/worker.js`: `reflowPlan(body, env)`, a shared helper extracted from `draftPlan` (read KV, prefs/budget, seed `locked`); route `POST /plan/reflow`; `ROUTES`, `ASSISTANT_ALLOWED`, `ITEMS` (logged/undoable). No `reflow` route exists yet.
- `plan.js`: `reflow()`, `MP.Plan.snapshot()/restore()`, "Skip / eating out" controls on a slot, undo toast, `setSlotMeal` sets `locked`. Defined in `plan.js`; `applyPlacements` reused for the Hermes path.
- `plan.html`, `style.css` (both themes, PC + 390 px), `sw.js` (bump `CACHE`).
- `hermes-sync.js`: the Activity-undo entry for a reflow draft calls `MP.Plan.restore`; `planMirror` carries `locked` (Phase 66 also lists this).
- `data.js` (`MP.chainDays` reuse; already has the `window`→`root` shim, Worker imports it).
- `tools/worker_test.mjs`, `test.html`; `docs/HERMES.md`, `docs/ARCHITECTURE.md` (route row); `CLAUDE.md` (one line: `mp_planUndo` is a one-level snapshot, not plan state).
- If `plan.js` is loaded by another page without `data.js`, every loading page needs both: grep `*.html` before finishing.

## Signatures / schemas

```
POST /plan/reflow  body { skipped?: [{day,slot}], eatingOut?: [{day,slot}], ranOut?: string[] }
 -> 200 { draft: { id, startDate, changes: [{ day, slot, before, after }], summary }, plan: { days } }
 -> 400 bad day/slot/ranOut · 409 "library must be synced first" · 409 "no plan to re-flow"
MP.Plan.reflow(plan, input, library, ctx) -> { plan, changes }   // pure, shared by button and tests
MP.Plan.snapshot(plan) / MP.Plan.restore() -> plan | null        // localStorage mp_planUndo, one level
```

## Edge cases
- Empty input or nothing to change: 200 with empty `changes`; no snapshot written.
- Slot in `skipped` that is eaten or locked: ignored, reported in `summary`.
- Skipped slot is not a batch cook: only that slot is re-planned.
- Second re-flow overwrites the single snapshot; Undo then restores the latest only.
- Restore when the plan has since changed: restore anyway but confirm in the toast ("Back to before the re-flow").
- Bad input (day 0, 15, unknown slot, non-array): 400, plan untouched.

## Verification
- No real credential needed: the harness's in-memory env uses fake tokens.
- `node tools/worker_test.mjs` and `python3 check.py` pass.
- Asserts: skipping Tuesday's batch cook moves its dependent leftover slots; locked, eaten and past slots identical before/after; `ranOut` key absent from the regenerated plan's plan; same body twice gives same draft id; assistant `POST /plan/reflow` stores `planDraft` and logs one activity entry; bad body gives 400; `restore()` returns the exact prior plan (deep-equal).
- UI (`ui-build`, `prototype-preview`): skip, eating out and undo at PC and 390 px, dark and light; Hermes draft banner applies.

## Tasks

Logic (TDD in `tools/worker_test.mjs` / `test.html` first)
- [ ] `MP.Plan.reflow` pure function; chain-unit and lock seeding asserts
- [ ] `snapshot`/`restore` and Activity-undo hook
- [ ] Worker `reflowPlan` + shared helper, route, `ASSISTANT_ALLOWED`, `ITEMS`; `setSlotMeal` sets `locked`; amend Phase 66 spec

UI (`ui-build` skill)
- [ ] Skip / eating-out controls, undo toast, empty "Eating out" slot state; `sw.js` CACHE bump
- [ ] Check PC + 390 px, dark + light; `python3 check.py`
- [ ] Live: with the real Worker, ask the assistant to re-flow after skipping a cook; Apply in the installed PWA; Undo
