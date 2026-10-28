# Phase 97: Change meals and ingredients to suit you [L]
Plain: Tell Hermes "thighs instead of breast this week" or "less sauce, add peppers" and it changes just that meal this week (or the meal for good, your pick), and several waiting meal changes are approved with one tap.

Requires Phases 28 (slot subs), 84 (`applyPlanEdits`), 87-88 (meal edit cards): all done.

## Decisions
1. **User-chosen:** batch approval = **"Add all" / "No all" on the waiting library meal-edit cards** (`mealCreate`/`mealEdit`/`mealRemove`, shown when 2+ are pending). Slot changes already have `chat-accept-all`. Notes, bulk and sub-choice cards keep their own taps.
2. **User-chosen:** a slot sub may also **add** an ingredient, **remove** one, or **change an amount** (`qty`), so "less sauce" really buys less. Entry shape stays one object in `slot.subs`: `{ from, to, label, qty? }`; `from: null` = add `to`, `to: null` = remove `from`, `from === to` with `qty` = amount change, both different = today's swap. No sibling field.
3. Own call: one new chat edit `{ type: "sub", day, slot, subs: [{from?, to?, label?, qty?}], scope?: "week" | "meal" }` (1-5 entries, 8 subs per slot max). `scope: "week"` applies at once as an ordinary highlighted plan row (per-row Reject, Accept all). `scope: "meal"` and absent scope show **one card** with **Just this week / Change the meal / No**. "Change the meal" derives a `mealEdit` patch (`ingredients` = the meal with the subs applied) and runs it through `applyMealEdits` (same hard checks, Undo, `X-Actor: hermes`). The library meal is untouched by "Just this week".
4. Own call: the slot path is `MP.applyPlanEdits` (pure, `data.js`), so the Worker's `POST /plan/edit` gets it free; there only `scope` absent/`week` is kept (a draft carries slot changes, not library edits). New optional arg `opts = { terms }` for the hard exclusion terms: app passes `MP.Sync.hardTerms()`, Worker its allergies+never list (grep `hardTerms` in `worker/worker.js` ~778 and the settings `planInputs` already loads).
5. Own call, refusals (nothing written, reason shown): no meal in the slot; slot held (locked/eaten/past); eating-out; leftover slot (`meal.leftoverOf`: "change the cook day instead"); a `from` that matches no ingredient of the effective meal (ignored, like a stale sub); `MP.Exclusions.check(applySubs(effective, subs), terms)` fails (mushroom, standalone egg, allergy, `never`). A new sub with the same `from` (or same `to` for an add) as an existing one replaces it; others append.
6. Own call: the generator is a sub **reader** only. `generator.js` ~349 reads `slot.subs[0]` for cost; loop over all subs and skip a null side. Ranking, pantry and nutrition ordering unchanged (CLAUDE.md "Substitution groups" invariant): only the invariant text changes from "generator-written only" to "generator or chat `sub`, always through the Exclusions check".
7. Own call: shelf-life and the shopping list already read subs through `effectiveMeal`, so an added or removed ingredient reaches them with no change; a `qty` override reaches `buildLists` the same way.

## Files touched
- `data.js` (`applySubs` ~309: handle `from: null` add (append `{ key: to, label, qty }`), `to: null` remove (filter), `qty` override; `subsLabel`: "with X" / "without X" / "plus X" / "X (qty)"; `applyPlanEdits` ~613: new `sub` branch via a new pure `subSlot(plan, day, slot, subs, mealsById, fromDay, terms)` returning `{ plan, ignored }`, `opts` 7th arg). Already behind the `window` -> `root` shim; no new global.
- `plan-chat.js` (`NORM.sub`, bounds above, `describe` line; `MP.PlanChat` exports unchanged).
- `plan.js` (`applyChatEdits` ~507: add `"sub"` (scope week/absent) to the `acts` list and pass `{ terms: MP.Sync.hardTerms() }`; `onChatReply` ~2640: scope-less/`meal` subs become a `chat.meals` card `{ sub: true, edit }`; `renderChatMeals`/`answerMeal` ~2570: three-button card, "Change the meal" -> `applyMealEdits` with a derived patch, "Just this week" -> the `applyChatEdits` path so the row lands in `chat.changes`; "Add all"/"No all" buttons calling `answerMeal` for each pending `mealCreate|mealEdit|mealRemove` card; `describe` strings).
- `generator.js` (~349 cost pass over every sub). Zero other generator change.
- `hermes-sync.js` `planMirror` (~327) already copies `slot.subs` whole: grep to confirm null `from`/`to` and `qty` survive (no whitelist inside the entries).
- `worker/worker.js` (`editRoute` ~470: add `"sub"` to the allowed list, drop `scope === "meal"`; pass `{ terms }`; update the `/plan/edit` route note ~1531), `worker/routes.json` (rerun `node tools/routes_build.mjs`).
- `tools/hermes_chat_bridge.py` (`EDIT_TYPES`: the `sub` line, one sentence on scope and add/remove/qty) + `tools/test_hermes_chat_bridge.py` if it asserts prompt text.
- `test.html`, `tools/worker_test.mjs`, `sw.js` (bump `CACHE`).
- `CLAUDE.md` invariants "Substitution groups (Phase 28)" and "Chat/assistant plan actions (Phase 84)" (add `sub`; `slot.subs` entry shape with null side and `qty`); `docs/ARCHITECTURE.md` ~line 106 (`subs` shape).
- Cross-file check: if `data.js` now calls `MP.Exclusions` in `subSlot`, grep `*.html` for pages loading `data.js` without `exclusions.js` before it.

## Signatures
- `NORM.sub(e) -> { type: "sub", day, slot, subs: [{ from: string|null, to: string|null, label?: string, qty?: string }], scope?: "week"|"meal" } | false`. Rules: each entry needs `from` or `to`; `label` required when `to` is set (<=60); `qty` <=40; `from === to` needs `qty`.
- `subSlot(plan, day, slot, subs, mealsById, fromDay, terms) -> { plan, ignored: [{ day, slot, reason }] }` (pure). Consumers: `applyPlanEdits` (its `changes` come from `diffPlans`, rendered by `applyChatEdits` and parked by the Worker).
- `applySubs(meal, subs)` unchanged signature, extended entries. Consumers: `effectiveMeal` and so every existing reader.
- `applyPlanEdits(plan, edits, mealsById, fromDay, generate, todayIso, opts?)`. `opts.terms` consumer: `subSlot`.

## Edge cases
- Sub on a batch cook head: applies to the cook slot only (leftover slots buy nothing, refused as above).
- Re-roll, swap and move carry the slot object, so subs follow a swap and vanish on a re-pick. A re-flow of a held slot keeps them (held slots come back identical).
- Add with no `qty`: shopping line uses the library default (blank qty), never 0.
- A sub that removes the only ingredient or leaves the meal empty: refused ("nothing left to cook").
- Hermes sends `sub` for a meal it just proposed (pending `mealCreate`): refused like `place` ("add the meal first").
- Offline or no sync: slot subs are plain `mp_plan` state, no network needed.

## Verification
- `node tools/worker_test.mjs` (new: `sub` through `/plan/edit` parks a draft; `scope: "meal"` dropped; mushroom add refused)
- `python3 tools/test_hermes_chat_bridge.py`
- `python3 check.py --changed`, then `python3 check.py` (UI walk covers the chat card on PC and 390 px, both themes)
- No real credential needed (test fakes only).

## Tasks
Logic (TDD, `test.html` + worker_test):
- [ ] `applySubs`: swap (unchanged), add, remove, qty override, stale `from` no-op, unchanged-object return when no subs; `subsLabel` wording.
- [ ] `subSlot`: refusals in Decision 5 each have a case; merge/replace rule; cap of 8; result passes `Exclusions.check` (mushroom `to` refused, nothing written).
- [ ] `NORM.sub` bounds (0 entries, 6 entries, both null, `from === to` without qty, bad scope, long label).
- [ ] `applyPlanEdits` with a `sub` edit plus a `swap` in one call; `diffPlans` shows the slot change.
- [ ] `applyChatEdits` returns a `chat.changes` row for a week-scoped sub (consumer: `renderChatWeek`/diff list, already rendered).
- [ ] Derived "Change the meal" patch: `applySubs(meal, subs).ingredients` -> `{ key, name, qty }`; consumer `applyMealEdits` (it already logs `X-Actor: hermes` and returns Undo).
- [ ] Generator cost pass with 2 subs, one null side (no throw; `normalizeKey` never receives null).
- [ ] Bridge prompt line + Worker route note + `routes.json` rebuilt.
UI (follow `ui-build`, `docs/UI_STYLE.md`):
- [ ] Sub-choice card: three buttons, wraps cleanly at 390 px, animated in like the other chat cards, both themes.
- [ ] "Add all" / "No all" row above the meal cards when 2+ pending; hidden otherwise; each resulting card keeps its own Undo.
- [ ] Meal detail and plan slot show "with / without / plus" text for a subbed slot.
- [ ] Bump `sw.js` `CACHE`; update CLAUDE.md and ARCHITECTURE.md lines listed above.
