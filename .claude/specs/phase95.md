# Phase 95: Kitchen-first opener [M]
Plain: Every planning chat starts by asking what you've already cooked, what's left and what you have in, and Hermes plans around your answer without buying for food you already have.

Requires Phase 93 (done: `leftover`/`leftoverPortions` slots, `openLeftoverCooks`) and Phase 94 (bridge prompt rewrite, same `build_prompt`: build 94 first, read the file as it is then).

## Decisions
Already built (found by grep, not re-done): the opener line in `tools/hermes_chat_bridge.py` `build_prompt` already asks the kitchen question, and the app applies a `stock` edit in any chat (`plan.js` ~2644). What is missing:
1. The prompt calls `stock` "fridge mode only", so Hermes never sends it in a normal chat. Own call: allow it in every chat.
2. Chat `place` cannot say "already cooked, N portions" (only `cookId` of an existing Cooks record). Own call: `place` gains `leftover: true, portions: 1-12` (same meaning as Phase 93's `/placements`; mutually exclusive with `cookId`).
3. The Cooks record is opened on **Save**, not on place: the working copy is stateless on Exit (`guidedActive`), and `MP.Cooks` is persistent. `saveChat` calls `openLeftoverCooks` after `savePlan`.
4. Own call: no "needs X" notes outside fridge mode (a 14-day plan against a short list would be all noise). Outside fridge mode `chat.stock` is the chip row plus Hermes's own memory of the thread only. Stock stays session-only and never touches the pantry or shopping list; Hermes says so if asked.
5. A `leftover: true` place skips the "no cook of its parent dinner" orphan check (it is already cooked).

## Files touched
- `plan-chat.js`: `place` validator (`leftover`, `portions`, refuse both with `cookId`); `describe` ("already cooked, N portions").
- `data.js` `placeSlots`: write `leftover`/`leftoverPortions` on the slot, skip the orphan check, refuse non-booleans/with `cookId`.
- `plan.js` `saveChat`: call `openLeftoverCooks(plan, library)` then save. `applyPlacements`/`openLeftoverCooks` unchanged.
- `hermes-sync.js` `planMirror`: carry `leftover`/`leftoverPortions` (it whitelists fields and strips them today, so the Worker's `/shopping` would buy for a leftover slot). Check `worker_test.mjs` still passes.
- `tools/hermes_chat_bridge.py`: `EDIT_TYPES` (place gets `leftover`/`portions`; `stock` line drops "fridge mode only"); prompt line mapping answers: cooked meals -> `place` with `leftover`+`portions` (or `cookId` when the briefing's cooks list already has it), loose ingredients -> `stock`; opener keeps asking, once, every chat.
- `CLAUDE.md`: extend the Phase 90b fridge-mode invariant (stock any chat) and Phase 93 line (chat place may carry `leftover`).
- `sw.js` `CACHE` bump. No Worker route change (no `routes.json` rebuild); `plan-chat.js` is shared with the Worker, no `window` use added.

## Signatures
- `place` edit: `{ type, day, slot, mealId, variantId?, cookId?, leftover?: true, portions?: 1-12 }` (`portions` needs `leftover`).
- `MP.placeSlots` refusal reasons added: "leftover can't also be a cook", "portions need leftover".

## Edge cases
- `leftover` on a held/eaten slot: refused as today. Leftover place then a normal place on the same slot: last wins, no Cooks record.
- Exit before Save: no Cooks record, plan untouched. Save twice / reload: `cookOpened` makes it idempotent; an already-open record for that meal is reused (Phase 80).
- `portions` without `leftover`, `leftover: "yes"`, `portions: 0/13/1.5`: dropped by `validateReply`.
- Old Hermes reply with no `leftover`: unchanged behaviour.

## Verification
- `python3 tools/test_hermes_chat_bridge.py` and `python3 check.py` (test.html + ui walk; no real credential needed, stub responder).

## Tasks
Logic (TDD)
- [ ] `test.html` (beside the Phase 88 place cases ~3155): `validateReply` keeps `place` with `leftover`+`portions`, drops bad ones; `placeSlots` flags the slot, skips the orphan check, refuses `cookId`+`leftover`, stays pure.
- [ ] `plan-chat.js` validator + `describe`; `data.js` `placeSlots`.
- [ ] `planMirror` carries the fields; add a `worker_test.mjs`/`test.html` case that a mirrored leftover slot survives.
- [ ] `saveChat` opens the Cooks record once (test via `MP.Plan.openLeftoverCooks` as Phase 93's case does); Exit-without-Save case asserts `MP.Cooks.all()` unchanged.
- [ ] Bridge: `EDIT_TYPES`/prompt change; `test_hermes_chat_bridge.py` asserts a non-fridge prompt now mentions `stock` and `leftover`, and the opener still asks the kitchen question.
UI
- [ ] None beyond the existing chip row; drive a chat with `tools/browser-check` using a stub reply that sends `stock` + a leftover `place`: chip shows, slot reads as leftover, Save opens one Cooks record (PC + 390 px, both themes). Bump `sw.js`; update `CLAUDE.md` lines.
