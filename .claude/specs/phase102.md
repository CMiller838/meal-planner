# Phase 102: Type it anywhere, with recents [M]
Plain: A bar at the bottom of every page where you type what you ate, pick a match, and it is logged; your recent extras are one tap away.

Requires Phase 92 (done: `MP.Sync.logPortion`, `MP.tickPlanEaten`), Phase 80a/81 (done: `POST /food-log`, `postFoodLog`, `localFoodLog`). Independent of 94-101.

## Decisions
Already built (grep): Browse's Eat sheet (`app.js` ~310-340) logs a library meal via `logPortion` and ticks a slot via `MP.tickPlanEaten`; `MP.Sync.postFoodLog(entry)` posts one entry and refreshes the `mp_foodLog` mirror (`localFoodLog()`); the Worker `POST /food-log` parses free text (`FoodLog.parse`), resolves nutrients, and takes `name` + `grams`/`count` entries. No shared script is on every page: this phase adds one.
1. **User-chosen:** a docked bar fixed at the bottom of every page (index, discover, plan, shopping, plan-with-me). Tapping the field opens a suggestion list and the recents strip above it; blur/Esc/outside tap collapses it.
2. Own call: new file `ate-box.js` (`MP.AteBox`), self-initialising on `DOMContentLoaded`; it injects its own DOM, so no per-page markup. Each HTML page loads it after `hermes-sync.js` (CLAUDE.md script rule); pages lacking `nutrition.js`/`shopping-list.js` (shopping, plan-with-me) get the food-name list from `pack-sizes.json` keys only (a stated fallback, not an error).
3. Own call: suggestion sources, in order, max 8, de-duplicated, matched by case-insensitive prefix-then-substring on the typed text: (a) library meals (`MP.getLibrary()`), (b) recents (distinct names in `localFoodLog()` kind `eat`, newest first), (c) foods = `MP.knownKeys(tags, packItems)` labelised (`MP.labelize`). Nothing typed: no list, only the recents strip.
4. Own call: picking a **library meal** = `MP.Sync.logPortion(meal, now, 1)` then `MP.tickPlanEaten` for today (same code path as Browse Eat, extracted into `MP.eatMeal(meal, whenIso, n)` in `data.js` so `app.js` and the bar share it; this adds `MP.eatMeal` as the one place that pairs the log with the tick). Never touches pantry or Cooks.
5. Own call: picking a **recent or food**, or pressing Enter on free text, = `MP.Sync.postFoodLog({ id: crypto.randomUUID(), action: "eat", text, when: now })`; the Worker owns parsing, grams and nutrients, so the client sends no nutrient numbers. A `needs-grams` result is toasted "Add an amount, e.g. 150g chicken" and the text stays in the field. The Worker's existing pantry deduction on a matching stock item is unchanged and documented (it is the food-log path, not a portion-eat).
6. Own call: **recents strip** = the last 10 distinct off-plan names from `localFoodLog()` (`kind: "eat"`, no `group`), each a chip. One tap logs `{ id, action: "eat", name, grams | count }` using the amount of that name's newest entry ("your usual portion"); no stored amount on the entry means the chip puts the name in the field instead of posting. Chips show an inline "✓" for 1.5 s, then a toast with Undo (`MP.Sync.removeFoodEntry(id)`).
7. Own call: speech works through the phone keyboard mic; the field is a plain `<input type="text" enterkeyhint="done" autocomplete="off">`, no Web Speech API, no dependency.
8. Own call: sync off (`Sync` disabled): library-meal picks still log locally; free text/recents are disabled with the caption "Turn on Hermes sync to log free text". Offline post error: toast "Couldn't log, try again", nothing queued (matches Phase 81's "estimate pending" handling only for eating-out slots, which this bar does not create).
9. Own call: the bar hides while a modal sheet is open (`body.sheet-open` or the existing sheet class; builder greps the modal class) and respects safe-area inset; page bottoms get `padding-bottom` so content is never covered.

## Files touched
- `ate-box.js` (new): `MP.AteBox.init()`, suggestion + recents rendering, Enter/pick/chip handlers. All dynamic strings through `MP.esc` / `textContent` (CLAUDE.md invariant).
- `data.js` (`window`->`root` shim already present): add `MP.eatMeal(meal, whenIso, n)` -> `{ ticked }`; `app.js` Eat sheet calls it (replacing its inline log+tick, ~327-340) so there is one implementation.
- `hermes-sync.js`: no change (reuse `postFoodLog`, `removeFoodEntry`, `localFoodLog`, `logPortion`).
- `index.html`, `discover.html`, `plan.html`, `shopping.html`, `plan-with-me.html`: one `<script src="ate-box.js">` after `hermes-sync.js`; `sw.js`: add `ate-box.js` to `SHELL`, bump `CACHE`.
- `style.css`: `.ate-bar`, `.ate-list`, `.ate-recents` using existing tokens, dark default, animated (`docs/UI_STYLE.md`, `ui-build` skill); body bottom padding.
- `test.html` (cases below), `tools/browser-check/ui-check.mjs` (every page shows the bar; a pick logs once), `CLAUDE.md` (one invariant line: the bar is a portion-eat/food-log writer only, never the pantry directly), `docs/ARCHITECTURE.md` (one line).

## Signatures
- `MP.AteBox.suggest(text, { library, recents, foods }) -> [{ kind: "meal"|"recent"|"food", label, meal?, name? }]` (pure; consumer: the list renderer).
- `MP.AteBox.recents(entries) -> [{ name, grams?, count? }]` (pure, max 10, newest first, excludes `group`/`kind !== "eat"`; consumer: the chip strip and `suggest`).
- `MP.eatMeal(meal, whenIso, n) -> { ticked: { day, slot, plan } | null }` (consumers: Browse Eat handler, the bar's meal pick, which toasts "plan ticked").

## Edge cases
- Empty/whitespace input: Enter does nothing. Text > 120 chars: truncated like `plan.js` labels (`slice(0,120)`).
- Meal already ticked / no plan / no matching slot today: log only, no tick, no error.
- Same pick tapped twice quickly: the id is fresh each time but the button disables for 1 s (double-tap guard).
- Excluded foods: the bar does not filter, it logs what was eaten (a mushroom eaten is still recorded); hard exclusions apply to planning/Discover only.
- Malformed `mp_foodLog` mirror: `localFoodLog()` returns [] so no chips; nothing throws.
- Page without `MP.Nutrition`/`MP.ShoppingList` loaded: foods list falls back as in Decision 2.
- Keyboard open on a phone: bar sits above it (`visualViewport` offset, or `position: sticky` inside the viewport fallback); builder checks at 390 px.

## Verification
- `python3 check.py` (data_check incl. `sw.js` cache bump and SHELL entry; `test.html` cases: `suggest` ordering/dedupe/prefix-before-substring/max 8/empty; `recents` max 10, dedupe, excludes group and stock; `eatMeal` logs n entries, ticks the matching slot today, pure plan untouched when none, pantry untouched).
- `node tools/worker_test.mjs` unchanged and green (no Worker change).
- Serve the site and drive it with `tools/browser-check`: on every page, type a library meal and pick it; type free text and Enter; tap a recent chip; Undo; sheet-open hides the bar; PC and 390 px, both themes, fresh profile; bad input (empty, 500 chars, `<img onerror>` text shows literally). No real credential needed (the Worker is faked in the browser check).

## Tasks
Logic (TDD)
- [x] `MP.AteBox.suggest` / `recents` + `test.html` cases above
- [x] `MP.eatMeal` in `data.js` + cases; switch `app.js` Eat sheet to it (consumer of `ticked`)
UI
- [ ] `ate-box.js` bar, list, recents strip, Undo toast, sync-off caption (`ui-build` skill, `docs/UI_STYLE.md`)
- [ ] Script tag on all five pages, `sw.js` SHELL + `CACHE` bump, `style.css`, `ui-check.mjs` bar checks
- [ ] CLAUDE.md invariant line + ARCHITECTURE.md line
- [ ] Live: on the installed phone PWA, say "two slices of toast" into the keyboard mic, tap Enter, then tap it again from the recents chip; check both land in the food log and the keyboard does not cover the bar.
