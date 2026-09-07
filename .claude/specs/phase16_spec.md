# Phase 16 — Discover card detail view

**Goal:** Make a Discover suggestion card tappable, opening a full detail view —
recipe, ingredients, nutrition — for a TheMealDB result that is **not yet in the
library**, without inventing a new visual surface and without relaxing the
`esc()` invariant on untrusted third-party content.

---

## Provenance of the decisions below

**No Decision Gate was answered by the user.** The dispatching prompt set a
policy of "state your own recommendation and proceed by default; only pause for
something genuinely high-stakes or hard to reverse". Nothing in this phase clears
that bar — every decision below is ~20 lines of page-local code, reversible in a
single commit — so no gate was raised and none was answered.

Every D-number below is therefore **the planner's own call**, not a user
selection. D1 in particular is a deliberate deviation from the roadmap's literal
wording (see below); if that one surprises you, confirm before shipping.

---

## Decisions taken

**D1. Discover renders its own detail sheet in `discover.js`. It does not load
`app.js`, and `app.js`'s `openDetail` is not touched.** This deviates from the
roadmap's literal phrasing ("reusing the Library's existing `openDetail` modal in
`app.js`") because that reuse is not actually available:

- `app.js` is **not loaded on `discover.html`** (script list, discover.html
  lines 68-75) and its top-level bootstrap binds index-only DOM.
- `app.js` `openDetail(meal)` (lines 162-187) renders exactly two actions —
  **Edit** (`openForm(meal)`, line 179) and **Delete** (`deleteMeal(meal)`, line
  180). Both assume the meal is already in the library and address it by `id`. A
  not-yet-liked TheMealDB result has neither meaning; both buttons would be wrong
  or destructive.
- The project's real, shipped convention is already per-page: **`plan.js` has its
  own `openDetail(meal, variantId)`** (lines 298-322) rendering into page-local
  `#detail-overlay` / `#detail-sheet`, and `tagRowHtml` is already duplicated in
  both `app.js:117` and `plan.js:74`.

The roadmap's *intent* — don't build a second detail **surface** — is honoured:
Discover reuses the existing `.modal-overlay` / `.modal-sheet` CSS (style.css
276-322) and the exact `#detail-overlay` / `#detail-sheet` markup pattern from
`plan.html:48-50`, so it looks and behaves like the surface the user already
knows. What is not shared is ~20 lines of template string.

**Explicitly rejected: extracting a shared `mealDetailHtml()` into `data.js` and
refactoring `app.js` + `plan.js` onto it.** That is a refactor of two shipped,
working surfaces (with different actions, and plan's variant handling) in service
of a third caller. Not this phase. See *Deliberately skipped*.

**D2. There is no data-shape adapter, because none is needed.** The roadmap
assumes one; the assumption is wrong. `pool` entries in `discover.js` are already
put through `MP.MealDB.toMeal(detail)` (mealdb.js 52-64) before they enter the
pool, so a Discover card's meal **already has the app's meal shape** —
`{id, name, source, mealTypes, batchCook, servings, description, instructions,
ingredients: [{key, qty, label}], image}`. Saved-for-later entries
(`MP.getSavedLater()`) are the same objects, persisted. **Do not write a mapper.**

**D3. Nutrition reuses `MP.Nutrition.tagsForMeal(meal, tags)` (nutrition.js:45,
exported line 97) and renders nutrient *names only* — no high/med/low levels, and
no network lookup.** TheMealDB has no nutrition data to fetch, so a "live nutrient
lookup" is not an option that exists. `tagsForMeal` is already shipped and
already tested (Phase 15, test group 34), so this phase adds **zero new nutrition
logic** and does not duplicate `tagRowHtml` a third time.

Accepted consequence: `extractIngredients` keys are snake-cased raw TheMealDB
ingredient names (`"chicken_breast"`, mealdb.js:46), so many will not match
`ingredient-nutrient-tags.json` and the list will often be short or **empty**.
Empty is a normal outcome, not a bug — render the section only when non-empty
(§2). Do not "fix" it by fuzzy-matching keys; that is a different phase.

**D4. The sheet's only actions are Close and "♥ Add to library".** No Edit, no
Delete (D1), no "Save for later", no "Add to plan". For a deck card the button
delegates to the **existing** `decide(el, "like")` (discover.js:85-104) so the
deck advances, the toast fires and `idx` stays consistent — it does **not** call
`MP.addToLibrary` directly, which would desync the deck.

**D5. Tap is detected inside the existing `makeDraggable` `up()` handler
(discover.js:66-78), not with a new `click` listener.** A `click` listener on a
pointer-dragged card fires after every swipe. The existing handler already knows
`dx`/`dy`; the tap branch is the `else` at line 74 narrowed by a movement
threshold. `swipe.js` (which has `MP.makeSwipeable`'s `onTap`) is **not** loaded
on `discover.html` and must not be added — the movement check is three lines.

**D6. Saved-for-later cards are tappable too.** Same sheet, same render; the only
difference is the "Add to library" button uses that grid's existing
add-then-remove behaviour (discover.js:182-187). Skipping it would mean the same
card is tappable in one place and dead in another.

**D7. Every interpolated field goes through `esc()`.** This is the phase's one
real constraint (CLAUDE.md invariant). `instructions` is new: it is the longest,
least sanitised string TheMealDB returns and no existing surface has rendered it
for an unliked result. Full field list in §2.

---

## What this phase is made of

| Roadmap item | Spec section |
|---|---|
| `discover.html` — the sheet markup | 1 |
| `discover.js` — `openDetail(meal, onAdd)` | 2 |
| `discover.js` — tap detection + wiring | 3 |
| Confirmed unchanged | 4 |
| Tests (group 35) | 5 |
| Docs | 6 |

---

## 1. `discover.html` — the sheet markup

Add, immediately before `<div id="toast-root">` (line 66), the same block
`plan.html` uses at lines 48-50:

```
<div id="detail-overlay" class="modal-overlay hidden" style="z-index:60;">
  <div id="detail-sheet" class="modal-sheet"></div>
</div>
```

Identical ids, classes and `z-index` to `plan.html` — the styling already exists
in `style.css` (276-322) and needs **no** new CSS rule. Also drop the
`style="cursor:default;"` from the saved-grid card template (discover.js:166) now
that those cards are interactive.

No new `<script>` tag. Every helper this phase needs (`esc` from data.js,
`MP.Nutrition` from nutrition.js) is already loaded (discover.html 68-75).

---

## 2. `discover.js` — `openDetail`

```
openDetail(meal, onAdd) -> void
   // meal  : a toMeal()-shaped object (D2) — deck pool entry or saved entry
   // onAdd : () => void, what the "Add to library" button runs (D4).
   //         Deck card passes () => decide(topCardEl, "like")
   //         Saved card passes the grid's existing add-then-remove handler
```

Renders into `#detail-sheet` and un-hides `#detail-overlay`, mirroring
`plan.js:298-322`. Sheet contents, in order:

| Block | Source field | Escaping |
|---|---|---|
| Close button | — | static |
| Image (omit if falsy) | `meal.image` | `esc()` on `src` **and** `alt` |
| Title `<h2>` | `meal.name` | `esc()` |
| Nutrient row (omit if `[]`) | `tagsForMeal` (D3) | `esc(labelize(n))` per name |
| Description `<p>` | `meal.description \|\| ""` | `esc()` |
| `<h3>Ingredients` + `<ul>` | `meal.ingredients[]` | `esc(i.label \|\| labelize(i.key))`, `esc(i.qty)` |
| `<h3>Instructions` + `<p>` | `meal.instructions \|\| ""` | `esc()` (D7) |
| Actions: `♥ Add to library` | — | static |

Reuse `ingredientListHtml`'s exact line shape from `plan.js:107-111`
(`label || labelize(key)`, `" — " + qty` only when `qty` is truthy) — TheMealDB
measures are frequently empty strings and must not render a dangling dash.

**Nutrient row:** call `MP.Nutrition.load()` (already used at discover.js:288)
and pass its `tags` to `tagsForMeal`. Because `load()` is async and the sheet must
open on the tap frame, render the sheet **first** and fill the nutrient row in
when the promise resolves; if it rejects, leave the row out. The sheet must never
wait on, or fail because of, the tags file.

**Close:** the `.close-btn` listener adds `hidden` back to the overlay, exactly as
`plan.js:317-319`. Also close on overlay-backdrop click. No history/hashchange
handling, no focus trap beyond what the existing modal CSS gives.

`instructions` can be long — the existing `.modal-sheet` CSS already scrolls; do
not truncate it. `meal.description` is TheMealDB's instructions truncated to 140
chars (mealdb.js:60), so description and instructions will visibly overlap on
these cards. That is accepted, not fixed here.

---

## 3. `discover.js` — tap detection and wiring

**Deck (top card only).** In `makeDraggable`'s `up()` (lines 66-78), the current
`else` at line 74 is "not a swipe → snap back". Split it: if
`Math.abs(dx) < 8 && Math.abs(dy) < 8`, it was a tap → snap back **and** call
`openDetail(pool[idx], () => decide(el, "like"))`. Otherwise snap back as today.

- 8px, not 0 — a finger always moves a little.
- `dx`/`dy` are closure variables that persist across gestures; reset them to `0`
  in `down()` so a tap immediately after a swipe can't inherit the previous
  gesture's delta. **This is the one real bug risk in the phase.**
- Only the top card is draggable (`if (i === 0) makeDraggable(el)`, line 138), so
  only the top card becomes tappable. Cards behind it stay inert — correct, they
  are decoration.
- `decide` reads `pool[idx]` (line 86), not a captured meal, so passing
  `() => decide(el, "like")` keeps the deck's single source of truth. Do not
  refactor `decide` to take a meal.

**Saved grid.** In `renderSaved`'s per-card wiring (lines 179-192) add a click
listener on the card that calls `openDetail(meal, addHandler)` where `addHandler`
is the same body as the existing `.add-btn` listener (add → `removeSavedLater` →
toast → `renderSaved()`) — extract it to a local `const` and use it in both
places rather than writing it twice. The card listener must **ignore clicks that
land on a button**: `if (e.target.closest("button")) return;` — otherwise "Add to
library" and "Remove" both also open the sheet.

Adding from the sheet must close the sheet.

---

## 4. Confirmed unchanged

| Thing | Why it stays put |
|---|---|
| `app.js` — `openDetail`, `tagRowHtml`, Edit/Delete | D1; Discover never loads this file |
| `plan.js` — its own `openDetail` (298-322) | The model being copied, not refactored |
| `mealdb.js` — `toMeal`, `extractIngredients` | Already the right shape (D2) |
| `nutrition.js` | `tagsForMeal` reused as-is; no new helper (D3) |
| `data.js` — `esc`, `labelize`, `saveForLater`, `addToLibrary` | Called, not changed |
| `decide()` signature and body (85-104) | Wrapped in a closure, not reworked (D4) |
| `cardInner` / `cardImageHtml` / `renderDeck` layout | The deck's look is unchanged |
| Swipe thresholds (100px), fan angles, filmstrip | Untouched — only the `else` branch splits |
| `style.css` | `.modal-overlay`/`.modal-sheet` already cover it; no new rule |
| `worker/`, `hermes-sync.js`, KV keys | No bridge involvement at all |
| Generator, shopping list, shelf-life, `meals.json` | Not touched (this is why it was sequenced first) |
| `MP.Exclusions` filtering | Applied upstream at pool build; the sheet re-filters nothing |
| Zero dependencies, no build step | Nothing added |

`sw.js`: no new file is added, so no precache change. `discover.html` is already
in the shell — confirm and leave alone.

---

## 5. `test.html` — group 35

Group 34 is Phase 15; this is **group 35**. This phase is mostly DOM, so the
assertion surface is deliberately thin — do not invent testable indirection to
pad it.

- **Tap threshold** — extract the decision as a tiny pure predicate
  (`isTap(dx, dy)`) and assert: `(0,0)` and `(5,-4)` are taps; `(12,0)`,
  `(0,-30)` and `(101,0)` are not. This is the branch that breaks silently.
- `MP.MealDB.toMeal` — assert the returned object carries `instructions`,
  `image` and an `ingredients` array of `{key, qty, label}` for a fixture detail,
  i.e. that D2's "no adapter needed" premise holds. A regression here is what
  would quietly empty the sheet.
- `MP.Nutrition.tagsForMeal` — assert a meal built from a TheMealDB-style fixture
  (raw snake-cased keys, none in the tag map) returns `[]` and does not throw.
  This pins D3's expected-empty case as intended behaviour.

Escaping is a **manual-pass** item, not an assertion — `esc()` itself is already
covered and the risk here is a *missed* interpolation, which only the DOM shows.

---

## 6. Docs

- `SPEC.md` — one line under the Discover section: cards open a read-only detail
  sheet; the meal is not in the library until liked.
- `docs/roadmap.md` — flip Phase 16 to **Status: Complete** in the same commit as
  the code, and correct the phase's sequencing note, which asserts a data-shape
  adapter is needed (D2) and that `app.js`'s modal is reused (D1). Leave the goal
  line itself; append a one-line "as built" correction.
- `docs/ARCHITECTURE.md` — no change. Discover is browser-only and outside the
  Worker contract; there is no data flow here to document.
- `CLAUDE.md` — no change. No invariant moves; the `esc()` one is reinforced.

---

## Deliberately skipped

- **Extracting a shared meal-detail renderer** across `app.js`/`plan.js`/
  `discover.js` (and the already-duplicated `tagRowHtml`). Add when a *fourth*
  page needs it, or when the three renders next need the same edit — refactoring
  two shipped surfaces for one new caller is the expensive direction.
- **Editing/deleting/planning from the Discover sheet.** The meal is not in the
  library; there is nothing to edit. Like it first.
- **A real nutrition panel** (calories, macros per serving). TheMealDB does not
  supply it and CLAUDE.md forbids upgrading the approximate tag system into
  fake-precise math. The nutrient-name row is the honest ceiling.
- **Fuzzy-matching TheMealDB ingredient names onto `ingredient-nutrient-tags.json`
  keys** so the nutrient row fills in more often. Real, but it is a data/matching
  phase with its own tests, not a detail-view phase. Revisit if the row is empty
  so often it looks broken.
- **Deep-linking / back-button-closes-sheet.** No other modal in this app does it.
- **Making the second and third fan cards tappable.** They are decoration behind
  the top card; tapping one would need a reorder animation nobody asked for.
