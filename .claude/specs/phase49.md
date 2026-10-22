# Phase 49: Week-plan draft and apply routes [M]
Plain: you can plan a week with the assistant in chat; it proposes a week, and you tap Apply in the app to adopt it.

Requires Phase 37 (built) and Phase 48 (spec written, not built: build 48 first; `/overnight` queue order). Apply logs
through Phase 48's `logWrite`. Assistant side: `notion_assistant` Phase 68, not needed to build or test this phase.

## Decisions

- **Apply path (user-chosen): pending draft + app banner.** `apply` stores a pending draft in KV key `planDraft`; the app
  pulls it, shows Apply / Dismiss and merges through its own code. The Worker never writes the `plan` mirror (the app's
  `localStorage` plan is the authority; the KV `plan` is a derived copy).
- **Generator runs in the Worker** (own call; `/ranking` precedent, the Worker already bundles it). **`generator.js` has a
  zero-line diff**: constraints are applied around it, not inside it:
  - `avoid`: meals filtered out of the library before `Generator.generatePlan`.
  - `budget`: passed as `prefs.budgetTarget`; the budget object is built like `plan.js`'s `generatePlan()` (`costIndex`,
    `groupIndex`, `packData.planning`).
  - effort hints: `DayHints.resolve` + `DayHints.merge` into `prefs`, exactly as `ranking()` does.
  - pantry: `ShoppingList.pantryIndex` from KV `pantry`.
  - `days` / `keep`: generate all 14 days, then **merge**: any slot that is eaten (`eatenAt`), in `keep`, or on a day not in
    `days` is copied from the KV `plan` mirror instead of the generated one.
- **Merge rule for a partly-filled plan (own call):** eaten and kept slots are never replaced; an empty slot on a requested
  day takes the generated meal. If no `plan` mirror exists the draft is the generated plan for the requested days.
- // ponytail: a merge can split a batch-cook/leftover chain at a kept/eaten boundary (parent kept, child regenerated).
  Accepted: the user sees the draft before applying. Upgrade path is pre-seeding `generatePlan`, which is out of scope.
- **Idempotent apply:** `draft.id` is a hash of the canonical JSON of `changes`, so the same constraints give the same id
  and applying twice stores the same `planDraft`. Re-applying an id the app already acked is a no-op (200 `already applied`).
- **Adjusting** a draft = call `POST /plan/draft` again with changed constraints; there is no server-side draft state.
- **Same draft in app and route** holds because both call the same `Generator.generatePlan` with the same inputs.
- **Assistant token reach:** `POST /plan/draft`, `POST /plan/apply`, `GET /planDraft`. `PUT /planDraft` stays app/Hermes only
  (the ack).

## Files touched

- `worker/worker.js`: `draftPlan(body, env)`, `applyDraft(body, env, who)`, `draftId`; routes `POST /plan/draft`,
  `POST /plan/apply`; `KEYS["/planDraft"]`, `VALIDATE.planDraft`; `ASSISTANT_ALLOWED` += the two POSTs and `GET /planDraft`;
  CORS gains `POST` (if Phase 48 has not already); `ITEMS.planDraft = [null]` in Phase 48's table so apply is logged/undoable.
- `tools/worker_test.mjs`: draft/apply asserts.
- `hermes-sync.js`: `fetchPlanDraft()`, `ackPlanDraft(id)`; fire `mp:plandraft` event.
- `plan.js`, `plan.html`, `style.css` (only if no existing class fits): the draft banner, reusing the placements banner styling.
- `sw.js`: bump `CACHE`. `docs/ARCHITECTURE.md`: KV row `planDraft`, endpoint rows.

## Signatures / schemas

```
POST /plan/draft  body { days?: number[1..14],        // default: every day
                         keep?: [{ day, slot }],       // slots never to replace
                         avoid?: string[],             // meal ids
                         budget?: number }             // GBP/week, > 0
 -> 200 { draft: { id, startDate, changes: [{ day, slot, before: {mealId, variantId?}|null, after: {mealId, variantId?} }],
                   summary: string }, plan: { days }  // full merged week for the assistant to describe
 -> 400 bad body (day out of range, unknown slot, budget <= 0, non-array) · 409 "library must be synced first"
POST /plan/apply  body { draft }                       // the object returned by /plan/draft
 -> 200 { id, status: "pending" | "already pending" | "already applied" }
 -> 400 bad shape or a mealId not in the library · 409 library not synced
KV planDraft = { id, at: ISO, pending: boolean, ackedId?: string, startDate, changes }   // app acks with PUT { pending:false, ackedId }
async function draftPlan(body, env) -> Response
function draftId(changes) -> string              // pure, stable hash of canonical JSON
```

## Edge cases

- `keep` or eaten slot on a requested day: copied from the mirror, never in `changes`.
- Draft with zero `changes` -> 200 with empty `changes`; `apply` of it -> 400 "nothing to apply".
- `avoid` removes every meal for a slot type: that slot comes back `{ mealId: null }` and is left out of `changes`.
- App plan has drifted since the draft: the app applies via `MP.Plan.applyPlacements`, which rejects eaten slots and unknown
  meals and reports them in the banner; nothing is overwritten silently.
- `planDraft` malformed or absent: app shows no banner. A newer `apply` overwrites a pending older one.
- Dismiss acks the id like Apply but changes nothing. Meal names in the banner go through `esc()`.

## Verification

- No real credential needed: the harness's in-memory env uses fake tokens (`a` = assistant, `h` = app/Hermes).
- `node tools/worker_test.mjs` and `python3 check.py` all green.
- Asserts: the same body twice gives the same `draft.id` and `changes`; `avoid` ids never appear in `after`; `keep` and eaten
  slots absent from `changes`; `days:[3]` changes nothing outside day 3; the draft's generated meals equal
  `Generator.generatePlan` called directly with the same library/pantry/prefs (app == route); bad day/budget -> 400;
  assistant `POST /plan/apply` stores `planDraft` with `pending:true` and logs one Phase 48 activity entry; second apply ->
  `already pending`; after `PUT /planDraft {pending:false, ackedId}` apply -> `already applied`; assistant `PUT /planDraft`
  -> 403; apply with an unknown mealId -> 400.
- UI: serve the site, intercept `GET /planDraft` with Playwright, open Plan at PC and 390 px in both themes: banner lists the
  changes, Apply updates the plan and acks, an eaten slot is reported "already eaten" and kept, Dismiss leaves the plan alone.

## Tasks

Logic (TDD in `tools/worker_test.mjs` first)
- [ ] `draftId`, `draftPlan` (avoid filter, budget/prefs/hints/pantry wiring, merge rule); asserts above
- [ ] `applyDraft` + `planDraft` key/validator, idempotency, activity logging; routes, `ASSISTANT_ALLOWED`, CORS
- [ ] `hermes-sync.js`: `fetchPlanDraft`, `ackPlanDraft`; `docs/ARCHITECTURE.md` rows

UI (`ui-build` skill)
- [ ] Banner in `plan.js`/`plan.html` (Apply via `MP.Plan.applyPlacements` then `savePlan()`, Dismiss, reasons for rejects);
      `sw.js` CACHE bump
- [ ] Check PC + 390 px, dark + light; `python3 check.py`
- [ ] Live: with the real Worker, ask the assistant to draft a week, open the installed PWA, tap Apply, see the week change
