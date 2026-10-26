# Phase 87: Plan with Hermes can create and change meals [L]
Plain: in the Plan with Hermes chat you can tell it to add a new meal or change an existing one, and it happens straight away with an Undo.

Requires: Phases 50 (drafts, `MP.draftToMeal`), 52 (profile exclusions), 72 (chat), 83 and 84 (chat sets start date, first slot, length, shop day, skip, swap, backfill). Built after both.

## Decisions
**User-chosen (2026-10-26)**: full control from the chat; changes apply at once with one-tap Undo, not propose-and-confirm. Date and shop-day control is Phases 83/84 (this phase only checks they are reachable from the chat).
**Own calls**
- This deliberately overrides two rules, and CLAUDE.md is updated in the same commit: Phase 72 "chat edits are constraints, never meals" and Phase 50 "only an app accept moves a meal into the library". Everything else about the chat stays: replies are validated in the Worker (`POST /chat/reply`) and again in the app; unknown or invalid edits are dropped.
- New edit types in `plan-chat.js` `NORM`: `mealCreate {name, mealTypes[], servings?, prepEffort?, ingredients:[{key|name, qty}], method?[]}`, `mealEdit {mealId, patch}` (patch whitelist: name, description, mealTypes, servings, prepEffort, ingredients, method), `mealRemove {mealId}`. No other field is patchable (never `id`, `source`, `leftoverOf`, tags, cost).
- Apply path = existing writers only: create through `MP.draftToMeal` shape then `upsertMeal`, edit through `upsertMeal`, remove through the existing remove function; the library then syncs by the normal `PUT /library`. No new storage and no new route.
- Hard checks before any write, in the app (the authority) with `MP.Exclusions.check` and profile terms (`Exclusions.termHit`): a meal that fails is refused, the card says why, nothing is written. Ingredient keys snap to known keys (`matchDraftIngredients`); an unknown name keeps a slugified key and shows as "no price yet".
- `mealRemove` is refused while the meal is in the current plan or is a batch parent of a placed leftover; the card names the day.
- Undo: each applied change is a card in the chat with Undo (restores the previous meal object, or deletes the created one). The change is also logged to activity with `X-Actor: hermes` so Phase 48 undo works after the chat closes.
- Editing a meal already placed in the plan does not re-flow the plan; the plan reads the new meal through `mealsById`, and the shopping list and shelf-life follow. Locked or eaten slots keep their meal id.
- The chat bridge prompt (`tools/hermes_chat_bridge.py` `EDIT_TYPES`) lists the new types, with the rule that Hermes must give ingredients as `key` from the library's known keys when it can.
- Limits: at most 3 meal edits per reply; names <= 60, ingredients <= 20, method steps <= 12.

## Files touched
- `plan-chat.js` (NORM types, `describe` lines), `plan.js` (`applyChatEdits` meal branch, Undo cards), `data.js` (reuse `upsertMeal`, `draftToMeal`, remove; add `MP.patchMeal(meal, patch)` pure), `exclusions.js` (reuse only)
- `worker/worker.js` (`/chat/reply` validation already imports `plan-chat.js`; activity log entry), `tools/hermes_chat_bridge.py` (prompt), `tools/worker_test.mjs`, `test.html`
- `docs/HERMES.md`, `CLAUDE.md` (amend the Phase 50 and Phase 72 invariant lines), `sw.js` (bump `CACHE`)
- Window shim: `plan-chat.js` already shimmed; no new bare `window.` at top level.

## Signatures / schemas
```
Edit += { type:"mealCreate", name, mealTypes, servings?, prepEffort?, ingredients:[{key?,name?,qty}], method? }
      | { type:"mealEdit", mealId, patch:{...whitelist} } | { type:"mealRemove", mealId }
MP.patchMeal(meal, patch) -> meal            // pure, whitelist only
MP.Plan.applyChatEdits(edits, ctx) -> { applied:[{edit, undo}], refused:[{edit, why}] }
```

## Edge cases
- Mushroom / standalone egg meal / vegetables in a toastie / allergy or `never` term: refused with the reason, nothing written.
- `mealEdit` or `mealRemove` on an unknown id, or a patch with a non-whitelisted field: dropped (unknown id) or the field ignored.
- Duplicate name: allowed, id differs; the card says "similar to <name>".
- Edit that makes a placed leftover's parent unbatchable: refused.
- Chat Exit: plan reverts via the snapshot; meal changes do NOT auto-revert (they live in the library), so Exit warns "N meal changes stay; Undo them first" and offers Undo all.
- Offline: library write is local; sync resumes by the normal pending path.

## Verification
- `python3 check.py` (test.html asserts for every new type: valid, invalid, whitelist, refused by each hard check, remove-in-plan refused, patch purity)
- `node tools/worker_test.mjs` (`/chat/reply` accepts and normalises the three types, drops bad ones, activity entry written)
- Browser run with a mocked Worker chat: create, edit, remove, Undo, mushroom refusal, at PC and 390 px, both themes. No real credential needed.

## Tasks
Logic (TDD)
- [ ] `NORM` validators for the three types and limits
- [ ] `MP.patchMeal` pure whitelist patch
- [ ] `applyChatEdits` meal branch with hard checks, refusal reasons and undo records
- [ ] Worker `/chat/reply` coverage and activity logging; bridge prompt
UI
- [ ] Result cards with Undo, Exit warning with Undo all
- [ ] CLAUDE.md invariant amendments, `docs/HERMES.md`, bump `sw.js` CACHE
- [ ] Live: on the phone ask Hermes "add a turkey chilli, 4 servings", plan it, then Undo it
