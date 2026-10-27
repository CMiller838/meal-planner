# Phase 99: Low-effort lunch suggestions [M]
Plain: When you plan with Hermes, it knows which lunches are almost no work (toasties, assembled bowls, reheated leftovers) and suggests those first, only offering a new lunch when none fit.

## Decisions
Already built (found by grep, not re-done): the lunch rules (never an empty lunch, no wraps/mushrooms/egg) are in the bridge prompt and `docs/MEAL_PLANNING_EXAMPLE.md`; the brief already carries `prepEffort`, `totalMins`/`estMins`, `leftoverOf`; `mealCreate` already takes `mealTypes`/`totalMins` and is gated by an Add/No card; hard exclusions + profile `never` already run on every `mealCreate` (wraps are enforced via the user's profile `never`, not inline code: do not add a wrap constant). What is missing:
1. Own call: a pure `MP.lunchEffort(meal)` returns `"reheat"` (has `leftoverOf`), `"assemble"` (mins <= 15, where mins = `totalMins` else `estMins`; no mins known: `prepEffort` "quick" counts as assemble) or `"cook"`. Reuses `estMins`; no new meal field, nothing stored.
2. Own call: the brief marks `lunchEffort` only on meals whose `mealTypes` include `lunch` (keeps the brief small).
3. Own call: prompt-only guidance, no app-side refusal. Hermes is told to fill lunch slots from library meals with `lunchEffort` reheat/assemble first, and to propose `mealCreate` with `mealTypes:["lunch"]`, `totalMins <= 15` only when nothing fits. A `cap` edit is dinner-only in the app; Hermes is told to treat it as the lunch ceiling too, by choice, not enforcement.
4. Own call: no generator change. One-tap Generate is untouched (`generator.js` zero-line diff).

## Files touched
- `data.js`: add `lunchEffort(meal)` beside `estMins` (~line 389), export as `MP.lunchEffort` (line ~804). Pure, no `window` use; the Worker does not import it.
- `plan.js` `chatBriefing` (~line 667): spread `...(types.includes("lunch") ? { lunchEffort: MP.lunchEffort(m) } : {})` into each meal. The 60 000-char trim steps are unchanged (`lunchEffort` is a few bytes).
- `tools/hermes_chat_bridge.py` `build_prompt`: one sentence after the "never leave a lunch empty" line (see Signatures). Read the file as it is after Phase 94/95 build.
- `test.html` (near the `chatBriefing` cases, ~line 3227) and `tools/test_hermes_chat_bridge.py` (`# build_prompt` block).
- `sw.js` `CACHE` bump (data.js and plan.js are cached). No Worker route change (no `routes.json` rebuild).

## Signatures
- `MP.lunchEffort(meal) -> "reheat" | "assemble" | "cook"`. Consumer: `chatBriefing` (only caller) and the test cases.
- Prompt sentence: "Lunches: prefer library meals whose lunchEffort is reheat or assemble (about 15 minutes or under) and keep the cooking down; only when none fit propose a mealCreate with mealTypes [\"lunch\"] and totalMins 15 or less; no wraps, mushrooms or standalone egg."

## Edge cases
- Meal with no `method` and no `totalMins`: `prepEffort` decides ("quick" assemble, "batch" cook). Missing `prepEffort` defaults to quick (matches `effortOf`).
- A batch parent (servings >= 2, no `leftoverOf`) is `cook`; its leftover child is `reheat`.
- `mealCreate` with `mealTypes` omitted still defaults to dinner: the prompt line tells Hermes to pass lunch explicitly.
- A dinner-only meal never gets the key.

## Verification
`python3 check.py --changed` then `python3 check.py` (use `timeout 600000`). New cases pass in `test.html` and `python3 tools/test_hermes_chat_bridge.py`. No real credential needed.

## Tasks
Logic (TDD)
- [x] `test.html`: `MP.lunchEffort` cases: leftoverOf -> reheat; totalMins 10 -> assemble; totalMins 40 -> cook; no mins + quick -> assemble; no mins + batch -> cook; estMins from steps used when no totalMins.
- [x] `test.html`: `chatBriefing` marks `lunchEffort` on a lunch meal and omits it on a dinner-only meal.
- [x] `data.js`: implement `lunchEffort`, export it.
- [x] `plan.js` `chatBriefing`: add the key (consumer of `lunchEffort`).
- [x] `tools/hermes_chat_bridge.py`: add the lunch sentence; assert it in `test_hermes_chat_bridge.py` ("lunchEffort" in prompt, "mealCreate" and "15" present).
- [x] Bump `sw.js` `CACHE`; mark the roadmap heading `— done` with what was verified when committing.
UI
- None (chat output only).
