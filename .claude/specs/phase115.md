# Phase 115: Browse cards and full-recipe Details sheet [L]
Plain: Browse shows big photo cards, and tapping any meal anywhere (Browse, Plan, Discover, Shopping) opens the same recipe sheet: a short description, photo, stats, tickable ingredients, numbered method, variant choice and buttons to add it to a night, eat it or cook it.

Prototype picked 2026-11-01: `design-prototypes/ui-concepts/browse-a.html` (cards + the `V.sheet` Details sheet). Requires Phase 110 (dinner-only `slots.dinner`, `#library-filters` gone), Phase 113 (Discover's own Details sheet, replaced here) and Phase 114 (shell; the sheet dock sits above the tab bar). All three are queued before this one in `/overnight`. Kept at [L]: it is one shared module replacing four sheet implementations across four pages, not a new data flow. No ADR needed.

## Decisions

User-chosen (2026-11-01):
- **Add to plan = night picker.** Tapping it swaps the dock for a row of the plan's coming nights (today to the last plan day), each showing its current dinner name, "Free" or "Eating out". Held nights (eaten, locked, frozen) are disabled. Picking one places the meal through `MP.BarChat.applyLive({ edits: [{ type: "place", day, slot: "dinner", mealId, variantId? }] })` (`bar-chat.js`, already loaded on every page). That call does the `mp_planUndo` snapshot, the `mp_plan` write, `mp:plan-saved`/`mp:plan-live`, the hard checks (`MP.placeSlots`) and returns `undo()`. A toast reads "Added <meal> to <Fri 6 Nov>" with Undo. A refusal shows its reason in the toast. With no `mp_plan` the button reads "No plan yet" and links to `plan.html`.
- **Browse filters = chips only.** A chip row under the existing search: Quick (≤30 min: `totalMins || MP.estMins`, else `prepEffort === "quick"`), Budget (lowest `costTier`), Batch (`MP.isBatch`), then one chip per nutrient in `nutrition-targets.json`. A nutrient chip matches a meal whose tag for it is high or med (the same map `collectMealTags` builds). Chips AND with each other and with the search. There is no ingredient-token panel: Phase 109's search already does must-contain-all.

Own calls:
- **One module, `meal-sheet.js` → `MP.MealSheet`.** It builds its own overlay on first open (`#meal-sheet-overlay` / `#meal-sheet`, z-index 60 like today's `#detail-overlay`), so no page needs markup. It uses `MP.enableSheetDrag` (`data.js`). Escape and a scrim click close it, focus moves in on open and goes back to the opener on close. At ≥900px it is a right side panel (prototype CSS). Browser-only: no Worker import, so no `root` shim.
- **Callers pass what differs; the sheet renders the rest.** Each page passes its own `tagsHtml` (it already has `tagRowHtml` and its own `tagsData`/`packData`), its dock `actions` and its `more` buttons. That gives one renderer, and no tag or cost helper moves.
- **Ingredient ticks are session-only** (per open, never stored), as in the prototype. "In pantry" = the ingredient's `normalizeKey` is present in `MP.ShoppingList.pantryIndex({ items: MP.Sync.localItems("pantry") })`. The heading count "N to buy" = ingredients neither in the pantry nor ticked. Display only: nothing writes the pantry.
- **Variant picker.** Radio chips (Standard + `meal.variants`) re-render the ingredient list through `MP.effectiveMeal(meal, variantId, subs)`. In the Plan context (opened from a slot) a pick calls `opts.onVariant(variantId)` → `setSlotVariant(day, "dinner", id)`. Elsewhere the pick is session-only and is passed on to Add to plan and Cook mode. The note "Steps are for the base recipe" shows when a variant is picked and steps exist (as today).
- **Gap notes.** Empty `description` → "No description yet". No `methodOf` steps and no `instructions` → "No method yet. Ask Hermes to draft one." A drafted method shows the Drafted badge. Accept steps stays a Browse-only `more` button.
- **Dock per context** (prototype: primary + ok + plain):
  - Browse: Add to plan · Eat (existing `openEatRow`, rendered inside the sheet) · Cook mode. More: Edit, Delete, Accept steps (drafted only), plus the rating row (`MP.Ratings.rowEl`, mounted via `afterRender`).
  - Plan slot: Cook mode · Eat (`openEatSheet`) · Swap (`openSwapPicker`).
  - Discover: Add to library · Dismiss · Save for later (Phase 113's buttons, same handlers).
  - Shopping (`mealSheet`, use-it-up list): Add to plan only.
- **Cook mode from Browse** loads `cook-mode.js` on `index.html` (its only `MP.*` dependencies, `esc`/`methodOf`/`qtyText`, live in `data.js`) and adds the `#cook-overlay` markup copied from `plan.html`. On finish `onConfirm` opens Browse's eat row. Cook mode itself is not restyled (Phase 117 dropped).
- **Cards (browse-a):** a photo button (image, or the existing 🍽 placeholder) with the cost badge top-right and an "Eaten today" badge top-left (an `mp_eatenLog` entry for this meal id dated today), then name, a meta line (mins · servings · effort), tag chips, and Eat + Details buttons. The photo and Details open the sheet, and Eat opens the sheet with its eat row already shown. Phase 110's "Not planned" label stays.

## Files touched
- `meal-sheet.js` (new): `MP.MealSheet`.
- `data.js`: `MP.chipFilter` (pure) next to `filterMeals` (`MP.estMins` is already exported).
- `app.js`: card markup, chip row + filtering, `openDetail` → `MP.MealSheet.open` (old body deleted), Add to plan picker wiring, Cook mode.
- `index.html`: `#browse-chips` row under `#library-search`; `<script>` for `meal-sheet.js` and `cook-mode.js` before `app.js` (after `bar-chat.js`/`shopping-list.js`); `#cook-overlay` markup.
- `plan.js`: `openDetail` → `MP.MealSheet.open` (plan context). The Phase 102 swipe `onTap` (~1779) and the day view Recipe button keep calling `openDetail`. `plan.html`: remove `#detail-overlay`, add the `meal-sheet.js` script before `plan.js`; check `plan.js` ~1823's "detail open" guard against the new overlay id.
- `discover.js` / `discover.html`: Phase 113's `openDetails` → `MP.MealSheet.open`, its modal markup removed if nothing else uses it, script added before `discover.js`.
- `shopping.js` / `shopping.html`: `mealSheet` → `MP.MealSheet.open`, script added before `shopping.js`.
- `style.css`: `.meal-card` (browse-a card), `.chip-row` chips, sheet (`.ms-*`: grab, scroll area, dock, stats, ingredient tick rows, `.hv` pantry pill, numbered steps, night picker). Both themes, 390 px and PC, reduced motion, 44 px targets. Old Browse `.card` rules are removed only if nothing else uses them (grep first).
- `sw.js`: `CACHE` bump + `meal-sheet.js` in the cached list.
- `test.html`: `MP.chipFilter` and `MP.MealSheet.toBuy` cases, plus `meal-sheet.js` in its script list.
- `tools/browser-check/walk.mjs`: assertions below.
- `CLAUDE.md`: one invariant line: "`MP.MealSheet` (`meal-sheet.js`, Phase 115) is the one meal Details sheet. Its ticks are session-only and display-only. Add to plan goes only through `MP.BarChat.applyLive` `place`; it never writes the pantry or Cooks."

## Signatures
- `MP.MealSheet.open(meal, opts)` → void. `opts = { variantId?, subs?, tagsHtml?, untracked?(key) → bool, actions: [{ id, label, kind: "pri"|"ok"|"", onClick(ctx) }], more?: [same], onVariant?(variantId), afterRender?(sheetEl, ctx), eatOpen?: bool }`. `ctx = { meal, variantId, sheetEl, close }`. Consumers: `app.js`, `plan.js`, `discover.js`, `shopping.js`.
- `MP.MealSheet.close()` → void. Called by action handlers that navigate away (Cook mode, Swap, Dismiss).
- `MP.MealSheet.pickNight(meal, variantId)` → void. Built-in handler behind any `{ id: "plan" }` action: renders the night row and calls `applyLive`. Its `{ applied, refused, undo }` result is consumed right there (toast + Undo). `MP.MealSheet.nights(plan, today)` (pure) → `[{ day, date, label, state: "free"|"meal"|"out"|"held", name? }]` feeds that row and is tested in `test.html`.
- `MP.MealSheet.toBuy(effMeal, have, ticks)` (pure) → number. Consumer: the ingredients heading count, re-run on every tick.
- `MP.chipFilter(meals, chips, ctx)` (pure, `data.js`) → meals. `chips` ⊂ `["quick","budget","batch", <nutrient>...]`, `ctx = { tags, packData }`. Consumer: `app.js` `renderLibrary`, after `MP.filterMeals`.

## Edge cases
- The meal has no image → placeholder in both the card and the sheet. A meal from TheMealDB with only `instructions` → a paragraph, not steps. Every TheMealDB string goes through `esc()`.
- A variant with `subs` from a plan slot → ingredients via `effectiveMeal`, plus the subs label line (as today).
- Add to plan when the meal has no `dinner` in `mealTypes` → `placeSlots` refuses ("not a dinner meal") → toast. The "Not planned" card label already warns.
- Night picker when the plan has rolled past (no night from today on) → "No nights left in this plan", with a link to Plan.
- Undo after Add to plan restores the earlier dinner (the `applyLive` undo). The Plan page redraws via `mp:plan-live`.
- Sheet opened over the Plan day view → it stacks above it (z-index 60 > day sheet) and closing it returns focus inside the day sheet.
- Discover meal not in the library → no Add to plan and no Cook mode (Discover dock only).
- Chips with no matches → "No dinners match" + Clear filters, as in the prototype.

## Verification
`python3 check.py` (pass `timeout 600000`) covers data_check, test.html and ui pages; the walk runs inside it. No real credential needed (Hermes is not called: `applyLive` takes a locally built `place` edit).

`walk.mjs` (fresh profile, seeded library and plan, PC and 390 px, dark and light, `--shots`) asserts each of:
1. Browse shows `.meal-card`s with a photo button, a cost badge, a meta line and Eat + Details.
2. The Quick chip narrows the count and Quick + Batch narrows it further; Clear restores it.
3. Details opens `#meal-sheet` with the description above the photo, then ingredients with checkboxes and a numbered method.
4. Ticking an ingredient lowers the "to buy" count and the pantry is unchanged (`mp_pantry`/`localItems` equal before and after).
5. Picking a variant changes the ingredient list.
6. Add to plan → night picker → pick night 2 → the toast names the night, and `mp_plan` day 2 dinner is the meal.
7. Undo restores the earlier day 2 dinner.
8. A held (eaten) night is disabled in the picker.
9. Eat in the sheet logs one `mp_eatenLog` entry and the card then shows "Eaten today".
10. Cook mode opens `#cook-overlay` on Browse.
11. Escape closes the sheet and focus returns to the opener.
12. Plan: the day view Recipe button opens the same `#meal-sheet` with Cook mode / Eat / Swap, and a variant pick there sets the slot's `variantId`.
13. Discover: tap on the top card opens `#meal-sheet` with Add to library / Dismiss / Save for later.
14. Shopping use-it-up meal opens `#meal-sheet`.
15. A meal with empty description and no method shows both gap notes.
16. No horizontal scroll at 390 px, the sheet dock is visible above the tab bar, and there are no uncaught page errors.

## Tasks
Logic (TDD in `test.html` first):
- [ ] 1. `sw.js` CACHE bump + `meal-sheet.js` in the cached list. `data.js` `MP.chipFilter`. Tests: quick by `totalMins`, by `estMins`, by `prepEffort` fallback; budget tier; batch; a nutrient high/med hits and low misses; several chips AND; empty chips = all.
- [ ] 2. `meal-sheet.js` pure parts: `toBuy` (pantry hit, tick, both, unknown key) and `nights` (free / meal / out / held states; days before today dropped; no plan → []). Add to `test.html`'s script list.

UI (follow `ui-build`, prototype `browse-a.html`):
- [ ] 3. `meal-sheet.js` render + `open`/`close`/`pickNight`: overlay, drag, Escape/scrim, focus trap and return, gap notes, variant picker, ticks, dock/more, night picker → `applyLive` + toast/Undo, side panel ≥900px; `style.css` `.ms-*` in both themes.
- [ ] 4. Browse: `index.html` chips row, scripts, `#cook-overlay`; `app.js` browse-a cards, chip filtering, `openDetail` → `MealSheet` with the Browse dock/more/rating row/eat row/Cook mode; old body deleted; `.meal-card` CSS.
- [ ] 5. Plan: `plan.js` `openDetail` → `MealSheet` (onVariant → `setSlotVariant`, Cook mode/Eat/Swap); remove `#detail-overlay` from `plan.html`, fix the ~1823 guard.
- [ ] 6. Discover and Shopping: `openDetails` / `mealSheet` → `MealSheet`; script tags; remove dead modal markup and CSS (grep first).
- [ ] 7. `walk.mjs`: one assertion per Verification item 1-16. `CLAUDE.md` invariant line. `python3 check.py` green; screenshots checked at PC and 390 px, both themes.
