# Phase 84: Tell it anything: chat and assistant control [M]
Plain: say "start Thursday dinner, I'm at Spoons Friday" in the chat or to the assistant and the plan does it, for you to accept.

Requires: Phases 72 (`plan-chat.js`, `POST /chat/reply`), 81, 82, 83. Assistant side: `notion_assistant` (separate repo).

## Decisions
**User-chosen**: chat, buttons and the assistant message path all reach the same actions.
**Own calls**
- New chat edit types in `plan-chat.js` `validateReply`: `start {date, firstSlot?, days?, shopDay?}`, `skip {day, slot, how: push|move|drop, to?}`, `out {day, slot, name?, text?}`, `swap {a, b}` / `swapDay {a, b}`, `backfill {day, slot, mealId|name+text}`. Unknown types or bad fields are dropped as today; edits stay constraints/actions, never meals chosen by Hermes (`start` regenerates through `generatePlan`).
- Applying goes through the Phase 81/82/83 helpers only; one implementation per action.
- Worker: extend `POST /plan/draft` with `startDate`, `firstSlot`, `days`, `shopDay`; add `POST /plan/edit` taking `{ edits: [...] }`, validated by the same `validateReply`, parked as a pending `planDraft` like `reflowRoute`. The app applies it; nothing applies unseen. Naming gate resolved: new route `/plan/edit` (grep found no existing one); rerun `node tools/routes_build.mjs` and commit `worker/routes.json`.
- Assistant scope: add only `POST /plan/edit` to `ASSISTANT_ALLOWED` if `POST /plan/reflow` is already there; do not widen further.
- "I ate out" with a description: the assistant calls `POST /food-log` first, then `/plan/edit` `out` with the same text.

## Files touched
`plan-chat.js`, `plan.js` (apply path, `PlanChat.describe` lines), `worker/worker.js` (`/plan/draft`, `/plan/edit`, `ROUTES`, `ASSISTANT_ALLOWED`), `worker/routes.json`, `docs/HERMES.md` (route docs), `tools/worker_test.mjs`, `test.html`, `sw.js` (bump `CACHE`), `CLAUDE.md` (invariant line for chat edit types).

## Signatures
- `POST /plan/edit` body `{ edits: Edit[], source?: string }` -> `{ id, status: "parked", dropped: [] }`
- `PlanChat.validateReply` returns the new types normalised.

## Edge cases
Date in the past for `start` (dropped); `backfill` for a future slot (dropped); more than `EDITS_MAX`; edits touching held slots (reported in `ignored`, not applied); two edits on one slot (last wins, reported).

## Verification
`python3 check.py`; `node tools/worker_test.mjs`; asserts for every new type (valid, invalid, dropped); `node tools/routes_build.mjs` leaves `worker/routes.json` unchanged. No real credential needed (test fakes only).

## Tasks
Logic (TDD)
- [ ] Validators for the new edit types
- [ ] `/plan/edit` route, `/plan/draft` start fields, routes.json
UI (`ui-build`)
- [ ] Chat "understood" lines and Accept flow for the new types
- [ ] Live: send each example message through the assistant and accept the draft
