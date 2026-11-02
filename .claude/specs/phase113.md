# Phase 113: Swipe Discover for dinners [M]
Plain: Discover shows one big dinner card on top of a small stack: swipe right to add it to your library, left to dismiss it, tap for details, and Undo if you slip.

Prototype picked 2026-11-01: `design-prototypes/ui-concepts/discover-swipe-a.html` (phone-first). Requires nothing built: Discover already has a 3-card fan deck (`discover.js`, `swipe` pointer drag, `fan-*` CSS); this phase reshapes it, so spec only the delta. Phase 110 (Breakfast category → no meal types) is independent: this phase only removes the Breakfast chip.

## Decisions
User-chosen: swipe A (stack, right add, left dismiss, tap = details, button + keyboard fallbacks, Undo, nutrient-gap chips); phone-first.
Own calls:
- **Up-swipe / ↑ now opens Details, not "save for later".** "Save for later" survives unchanged as data and as the pile under the deck; it moves to a button in the Details sheet (`MP.saveForLater`). Roadmap and prototype have no save gesture; dropping the pile would orphan saved meals.
- **Prototype filters not carried over:** area, "Quick ≤30 min" and "Cheap £" need data TheMealDB `toMeal` does not capture (no area, no minutes), and a "hidden by your rules" count is not kept by the cached pool. Kept: the existing category chips (minus Breakfast, dinners only) and "Using what's left". Cost shows via the existing `costBadgeHtml`.
- **Gap chips** = nutrients the meal covers that the library is short on: new pure `MP.Nutrition.gapHits(meal, gaps, tags)` (the meal's `tagsForMeal` ∩ `gaps`, in `gaps` order, first 2). Display only: the deck order stays `rankByGap` → taste → pantry, untouched. `libraryGaps()` already computes `gaps` in `discover.js`.
- **Undo** is in-page only (`hist` stack, cleared on chip change/reload): it reverses the last decision: add → `MP.removeFromLibrary(id)`, dismiss → new `MP.undismiss(id)`, save → `MP.removeSavedLater(id)`, and steps `idx` back. It does not reverse the soft taste counter `Prefs.bump` (ordering nudge only).
- **Details sheet** reuses the app's `.modal-overlay`/`.modal-sheet` markup and `MP.enableSheetDrag` (`data.js`), added to `discover.html`: photo, name, cost badge, gap chips, ingredient list, buttons Dismiss / Save for later / Add to library / Close. Escape closes, focus moves in and returns. Phase 115 later replaces it with the one shared Details sheet.
- **Restyle in place:** keep `#fan-deck`/`.fan-card` ids and classes where they fit, restyle to the prototype; drop the filmstrip (`.fan-filmstrip`, `.film-card`: only Discover uses them) and the ★ button. Keyboard: ← dismiss, → add, ↑ or Enter details, Z undo (ignored while an input has focus or the sheet is open).
- Hard exclusions unchanged: the pool is already sanitised in `mealdb.js` (mushrooms, eggs, profile terms); nothing here adds a path that bypasses it. No new dependency, no new file.

## Files touched
- `discover.js` (controller rewrite of `cardInner`, `makeDraggable`, `decide`, `renderDeck`; remove `renderFilmstrip`; add history/undo, sheet, keyboard); `discover.html` (deck + buttons + Undo + toast + modal markup, Breakfast chip removed, copy "Swipe right to add, left to dismiss, tap for details"; script list already has `ate-box.js`).
- `data.js`: `MP.undismiss(mealId)` (+ export). `nutrition.js` (already `root`-shimmed): `gapHits` + export. `sw.js`: `CACHE` bump (task 1).
- `mealdb.js`: drop `"Breakfast"` from `CATEGORIES` (only `sampleIds`/exports use it; grep first).
- `style.css`: restyle `.fan-*`, add stack offsets, gap chip, details-sheet bits; both themes, 390 px and PC, reduced motion, 44 px targets; remove `.fan-filmstrip*`/`.film-card`.
- `test.html` (gapHits, undismiss), `tools/browser-check/walk.mjs` (Discover steps; seed the pool via `sessionStorage` key `mp_discover_pool:` so no network is needed). `ui-check.mjs` already covers `discover.html`.
- `docs/UI_STYLE.md`: one line for the card-stack pattern. `docs/roadmap.md` heading on commit.

## Signatures
- `MP.Nutrition.gapHits(meal, gaps, tags) -> string[]` (pure; consumer: `discover.js` card and sheet chips via `MP.labelize`).
- `MP.undismiss(mealId) -> void` (`data.js`; consumer: Undo and the empty-state "Bring back N dismissed" button in `discover.js`).
- `discover.js` internal: `decide(dir)` (`add|dismiss|save`), `undo()`, `openDetails(meal)`.

## Edge cases
- Empty pool: the existing messages (load failed / no more in this category) plus, when `MP.getDismissed().size`, a "Bring back N dismissed" button (`undismiss` each, reload pool); chip with no results keeps its message.
- Undo with an empty history: button disabled, Z ignored. Undo after the sheet action works the same.
- A tap under 6 px opens Details; a drag under 100 px springs back; pointercancel springs back. Only the top card is draggable; the page still scrolls vertically past the deck (`touch-action: none` on the top card only).
- Double-tap / key-repeat during the 240 ms fly-out is ignored (busy flag).
- Chip switch mid-animation: `loadPool`'s existing `cat !== activeCat` guard stays.
- Meal with no image: existing placeholder; no tags covered: no chips, no empty row.
- Reduced motion: no fly-out/stack animation, decisions apply immediately.
- External strings (name, ingredient labels) go through `esc()`; never raw `innerHTML`.

## Verification
- `python3 check.py` (timeout 600000) green; `python3 tools/spec_lint.py phase113`.
- `test.html` asserts: `gapHits` returns only gap nutrients the meal covers, in gap order, max 2, `[]` for none/no ingredients; `undismiss` removes the id from `getDismissed()` and leaves others.
- `walk.mjs` (seeded pool of ≥4 meals, run at PC and 390 px, dark and light, `--shots`) asserts each of: top card shows name, a gap chip and an ingredient line; Add button adds the meal to the library and advances; Dismiss puts it in `getDismissed()`; a pointer drag right past 100 px adds, left dismisses, a short drag springs back and changes nothing; a tap opens the Details sheet, Escape closes it and focus returns to the card; ↑ and Enter open Details, ← → decide, Z undoes; Undo after an add removes it from the library and brings the card back, after a dismiss un-dismisses it; sheet "Save for later" lands the meal in the pile below; Undo is disabled with no history; no Breakfast chip; empty deck shows "Bring back N dismissed" and it restores the cards; no horizontal scroll; no uncaught page errors.
- No real credential needed.

## Tasks
### Logic (TDD)
- [x] 1. `test.html` cases for `gapHits` and `undismiss`; implement in `nutrition.js` / `data.js`; bump `sw.js` `CACHE`.
### UI (`ui-build`, restyle from `discover-swipe-a.html`)
- [x] 2. `discover.html` markup (deck, Dismiss/Details/Add, Undo, toast, modal, no Breakfast chip); drop Breakfast from `mealdb.js` `CATEGORIES`; `style.css` restyle in both themes at PC and 390 px.
- [x] 3. `discover.js`: new card (photo, cost badge, gap chips, ingredient line), pointer drag + tap, `decide`/history/`undo`, Details sheet with Save for later, keyboard, empty state + bring back, reduced motion.
- [x] 4. `walk.mjs` steps for each behaviour in Verification, screenshots at both widths and themes.
- [x] 5. `docs/UI_STYLE.md` line; run `python3 check.py`.
