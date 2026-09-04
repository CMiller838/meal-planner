# Phase 6 Spec — Library CRUD & Browse cleanup

Roadmap: `docs/roadmap.md` → Phase 6. Source of scope: `docs/OUTLINE.md` lines 93–160.

Pure app-side work. **No new backend surface, no Worker change, no new KV key, no new
dependency, no new JS file.** The phase's net effect on `index.html` is a deletion plus a
form; the sync half is free because `MP.saveLibrary()` already stamps and fires
`mp:library-saved`, which `MP.Sync.start()` already listens for (`hermes-sync.js:109`).

## Decisions taken (user-confirmed)

| Gate | Decision |
|---|---|
| 1. How ingredients are typed in | **Path B** — one textarea, one ingredient per line; the parser snaps the derived key onto a real key from `ingredient-nutrient-tags.json` + `pack-sizes.json` when one matches. Path A's raw slug would silently strip a hand-added meal of its nutrient tags and drop it into the shopping list's "unpriced" pile with nothing saying why. |
| 2. Where the Add form lives | **Path B** — one form serving both Add and Edit, rendered into the **existing** `#modal-sheet`. Not a separate `<details>` section: that duplicates the fields, the exclusion check, the duplicate-name warning and the save path. |
| 3. Filter chips | **Path A** — single-select `All · Breakfast · Lunch · Dinner · Snack`, static markup, one delegated listener, one string of state. AND-combined with the search box. |
| Undo mechanism | The existing `.toast`, extended with an optional action button. No trash, no history — the undo window *is* the toast lifetime. |
| Where the new pure functions live | `data.js`. It already hosts `esc`/`labelize`/`filterMeals`; a new module for three functions is a file nobody needs. |

---

## 0. What this phase is actually made of

| Roadmap item | Where it lands |
|---|---|
| Strip the leftover Discover section | `index.html` §1 + `app.js` §1 — **a deletion**, ~45 lines out |
| Manual "Add a meal" form | §2 parser + §3 form, shared with Edit |
| Edit in the detail modal | §3 — same form, prefilled |
| Delete + confirm + undo toast | §4 — `confirm()` (native) + `.toast` + one new `data.js` helper |
| Removal propagates to Hermes | **No code.** `saveLibrary()` → stamp → `mp:library-saved` → `syncLibrary()` pushes the whole array. Last-write-wins already deletes remotely. Do not add a tombstone |
| Meal-type filter chips | §5 — static markup, one `.filter()` line |

**The trap that shapes §3:** an edit must preserve every field the form does not show —
`batchCook`, `leadsTo`, `leftoverOf`, `servings`, `prepEffort`, `image`, `id`, `source`.
Editing `roast-chicken`'s description must not quietly break its batch-cook chain into
`chicken-fajitas`, and must not change its `id`, which a saved plan (`mp_plan`) references
by `mealId`. Spread the original, overwrite only the five edited fields.

**The trap that shapes §2:** `toastie-chicken-cheese` carries
`{"key":"chicken_breast","qty":"leftover, sliced"}` with **no label**. Phase 3's shopping
list excludes that line by matching `/leftover|from roast/i` against `qty`
(`.claude/specs/phase3_spec.md` §2). A textarea round-trip that folds a non-numeric `qty`
into the label silently un-excludes it and buys the chicken twice. §2's `label — qty`
form exists solely to stop that.

---

## 1. `index.html` + `app.js` — strip the duplicate Discover deck

`index.html` lines **36–40** (`<section>` containing `#swipe-deck` and `.swipe-hint`) are
the leftover inline deck from before `discover.html` existed. Delete the whole section.

`discover.html` is the real one (fan deck, `#fan-deck`, `discover.js`) and **nothing about
it changes**.

Then in `index.html`:

- Delete `<script src="swipe.js">` (line 65) and `<script src="mealdb.js">` (line 68).
- **Keep** `<script src="exclusions.js">` — §3 uses `MP.Exclusions.check()`.
- **Add** `<script src="shopping-list.js">` — §2 needs `pack-sizes.json` keys. Already in
  the SW shell since Phase 3, so this costs one tag and one cached fetch.

**Do not delete `swipe.js` or `mealdb.js` themselves.** `plan.js:198` calls
`MP.makeSwipeable`, `discover.js` needs `mealdb.js`. Both stay in `sw.js`'s `SHELL`.
Leave a one-line comment in `index.html`'s script block saying why this page no longer
loads them, so it doesn't read as an oversight.

In `app.js`, delete outright:

- `discoverPool` (line 8)
- `excludeIds()` (104–108)
- `renderDeck()` (110–149)
- the `MP.MealDB.getDiscoverPool` try/catch and `renderDeck()` call in `init()` (193–198)

`cardImageHtml`, `tagRowHtml` and `collectMealTags` stay — `renderLibrary` uses them.

`shelf-life.js` is also unused by `app.js`, but it predates this phase — leave it alone.

---

## 2. `data.js` — the ingredient text format (new pure functions)

Two inverse functions, both pure, both checked in `test.html`.

### Textarea format

One ingredient per line. Two accepted forms, tried in this order:

1. **`label — qty`** (em dash, spaced) — the explicit form, matching how `openDetail`
   already *displays* an ingredient. Anything after the dash is the qty verbatim.
   Also accept a spaced hyphen ` - ` as the separator.
2. **`<qty> label`** — a leading quantity, the natural way to type it.

```js
/** Parse the ingredients textarea into meal-record ingredient objects.
 *  Never returns an entry with an empty `key` — data.js:77 does
 *  `ing.key.replace(...)` and would throw on one.
 *  @param {string} text
 *  @param {string[]} knownKeys  union of ingredient-nutrient-tags + pack-sizes keys
 *  @returns {Array<{key: string, qty: string, label: string}>} */
MP.parseIngredients(text, knownKeys)

/** Inverse: render ingredients back into textarea text, one per line.
 *  Emits `label — qty` when qty is non-empty, else just the label.
 *  Falls back to labelize(key) when `label` is absent.
 *  @param {Array<{key,qty?,label?}>} ingredients
 *  @returns {string} */
MP.ingredientsToText(ingredients)
```

### `parseIngredients` — the algorithm

Split on `\n`, trim each line, drop blanks. Per line:

1. If the line contains ` — ` or ` - `, split on the **first** occurrence:
   `label` = left trimmed, `qty` = right trimmed. Skip to step 3.
2. Otherwise tokenise on whitespace and take a leading quantity:

   ```
   i = 0
   if (/^\d/.test(tokens[0]))      i = 1
   if (i === 1 && UNIT.test(tokens[1] || ""))  i = 2
   qty   = tokens.slice(0, i).join(" ")
   label = tokens.slice(i).join(" ")
   if (!label) { qty = ""; label = line }      // a bare "500g" is a name, not a qty
   ```

   ```js
   const UNIT = /^(g|kg|ml|l|tbsp|tsp|slices?|cans?|tins?|packs?|cloves?|handfuls?|bunch(es)?|pinch(es)?|rashers?|fillets?)$/i;
   ```

   The unit list is what stops `"2 chicken breasts"` parsing as qty `"2 chicken"`.
   Worked examples: `"500g chicken breast"` ⇒ `{qty:"500g", label:"chicken breast"}`;
   `"2 slices white bread"` ⇒ `{qty:"2 slices", label:"white bread"}`;
   `"1-2 tortillas"` ⇒ `{qty:"1-2", label:"tortillas"}`;
   `"2 chicken breasts"` ⇒ `{qty:"2", label:"chicken breasts"}`;
   `"chicken breast"` ⇒ `{qty:"", label:"chicken breast"}`.

   These qty strings stay parseable by `MP.ShoppingList.parseQty` — that is the point of
   matching its shapes rather than inventing new ones.

3. Derive the slug: `label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")`.
   Empty slug ⇒ `"ingredient"`.
4. Snap the slug to a known key, first hit wins:
   1. exact `slug` in `knownKeys`
   2. `slug` with a trailing `s` removed, or `slug + "s"`
   3. the **longest** known key that is a substring of `slug`, or that `slug` is a
      substring of (so `"chicken breast fillets"` ⇒ `chicken_breast`, and
      `"Chicken Breast — leftover, sliced"` ⇒ `chicken_breast`)
   4. no hit ⇒ the raw slug (the meal still saves; it just carries no tags/price)
5. Emit `{key, qty, label}` with `label` **exactly as typed** (trimmed) — not title-cased.

`ponytail:` comment required, naming the ceiling: *substring matching, not a synonym
table — `"mince"` will not find `beef_mince` and `"chicken thighs"` will not find
`chicken_breast`. The upgrade path is an `aliases` list in `pack-sizes.json`, not a fuzzier
matcher.*

### `knownKeys` at the call site (`app.js`)

```js
knownKeys = [...Object.keys(tagsData.tags), ...Object.keys(packData.items)]
              .filter((k) => !k.startsWith("_"))    // drops "_note"
```
`packData` from `await MP.ShoppingList.load()`, added to `init()`'s existing
`Promise.all`. A failed fetch ⇒ fall back to `[]`; the form still works, keys just don't
snap. Never let it break page init.

---

## 3. `app.js` — the shared Add/Edit form

### Modal, two modes

`openDetail(meal)` keeps its current read-only render (unchanged except §3d's action
row). A second renderer, `openForm(meal)`, writes the form into the **same**
`#modal-sheet` / `#modal-overlay`.

```js
/** @param {object|null} meal  null = Add mode, a library meal = Edit mode */
function openForm(meal)

/** Read the form fields into a meal record, merged over the original.
 *  @param {object|null} original
 *  @returns {object} a full meal record */
function readForm(original)
```

### 3a. Form markup (built in `openForm`, escaped)

Every prefilled value is set with `.value` / `.checked` **after** insertion, never
interpolated into the HTML string — TheMealDB-sourced names and descriptions live in the
library and are untrusted (`CLAUDE.md`). The only interpolated text is the static heading.

| Field | Element | Notes |
|---|---|---|
| Name | `#form-name` `<input type="text">` | required |
| Description | `#form-description` `<textarea rows="2">` | |
| Recipe | `#form-instructions` `<textarea rows="6">` | the roadmap's "recipe" |
| Ingredients | `#form-ingredients` `<textarea rows="6">` | placeholder shows both accepted line forms |
| Meal types | four `<input type="checkbox" class="form-type" value="breakfast\|lunch\|dinner\|snack">` inside `.sync-field`-styled labels | multi-select, matching the `mealTypes` array |
| Message | `#form-msg` `<p>` | soft warning or blocking error, `textContent` only |
| Actions | `#form-save` `.btn`, `#form-cancel` `.ghost` | |

Reuse `.sync-field` for the label+input pairs — it already styles exactly this shape
(`index.html:46-52`). Add `.sync-field textarea` to the existing `.sync-field input` rule
rather than a new class.

### 3b. Duplicate-name warning (soft, non-blocking)

```js
/** First library meal with a confusably similar name, or null.
 *  @param {Array} meals  @param {string} name  @param {string|null} ignoreId
 *  @returns {object|null} */
MP.findSimilarName(meals, name, ignoreId)
```

Normalise both sides to `toLowerCase().replace(/[^a-z0-9]/g, "")`. Match when the
normalised strings are equal, **or** one contains the other and the shorter is ≥ 4
characters. Skip the meal whose `id === ignoreId` (so editing a meal never warns about
itself).

Wired to the name field's `input` event; writes
`Similar to "<name>" — add anyway if it's different.` into `#form-msg` via `textContent`.
Never blocks Save. `ponytail:` comment: *containment, not edit distance — "Chilli" and
"Chili" will not match each other. Add a real distance function only if near-dupes
actually pile up.*

### 3c. Save (`#form-save`)

1. `name` blank after trim ⇒ `#form-msg` gets `"A meal needs a name."`, stop.
   *(Non-negotiable: the Worker's `libraryError()` rejects the whole library push with a
   400 if any meal has an empty `name` or `id` — a blank name here silently breaks sync
   for every other meal too.)*
2. Build the candidate via `readForm(original)`.
3. `MP.Exclusions.check(candidate)` ⇒ `!ok` ⇒ `#form-msg` gets
   `` `Can't save — ${reasons.join(", ")}.` `` and **stop**. Blocking, and it runs on Edit
   too: an edit can introduce a mushroom just as easily as an add can
   (`docs/OUTLINE.md:117-119`).
4. `library = MP.upsertMeal(candidate)` (§3e), `closeDetail()`, `renderLibrary()`,
   `toast('Saved "<name>"')`.

### 3d. `readForm(original)` — field preservation

```js
{
  ...(original || {}),                         // batchCook, leadsTo, leftoverOf,
                                               // servings, prepEffort, image, id, source
  name, description, instructions,
  mealTypes: [...checked boxes, in breakfast/lunch/dinner/snack order],
  ingredients: MP.parseIngredients(text, knownKeys),
}
```

Add mode (`original === null`) additionally sets the defaults every downstream module
expects:

```js
id: "user-" + slug(name) + "-" + Date.now().toString(36),
source: "manual",        // written, never read — informational for Hermes
prepEffort: "quick",
batchCook: false,        // shopping-list.js's dinner dedupe reads this
servings: 1,
image: null,
```

**`id` is never recomputed in Edit mode**, even when the name changes — a saved plan
(`mp_plan`) references meals by `mealId`, and `leadsTo`/`leftoverOf` reference them by id.

### 3e. Detail modal action row + `data.js` helpers

`openDetail` gains one `.modal-actions` row under the instructions:

```html
<div class="modal-actions">
  <button id="detail-edit" class="btn">Edit</button>
  <button id="detail-delete" class="ghost danger">Delete</button>
</div>
```

`#detail-edit` ⇒ `openForm(meal)` (re-renders the same sheet; no close/reopen flicker).

Two new `data.js` exports, both persisting through `saveLibrary()` so the stamp bumps and
`mp:library-saved` fires — that, and nothing else, is the Hermes propagation:

```js
/** Replace the meal with this id, or append if it's new. @returns {Array} the new library */
MP.upsertMeal(meal)

/** Remove by id. No-op (still returns the array) if the id isn't present.
 *  @returns {Array} the new library */
MP.removeFromLibrary(mealId)
```

Both read the current `mp_library` from `localStorage` themselves rather than trusting a
caller-held array — same pattern as `addToLibrary` (`data.js:60`), and it is what makes
Undo safe across a concurrent Hermes pull.

The library grid button `+ Add a meal` (§5 markup) ⇒ `openForm(null)`.

---

## 4. Delete + undo

`#detail-delete`:

```js
if (!confirm(`Remove "${meal.name}" from your library?`)) return;
library = MP.removeFromLibrary(meal.id);
closeDetail();
renderLibrary();
toast(`Removed "${meal.name}"`, "Undo", () => {
  library = MP.addToLibrary(meal);   // re-adds the captured record verbatim
  renderLibrary();
});
```

Native `confirm()` — a custom confirm dialog is a modal inside a modal for one yes/no.

`addToLibrary` is the right undo primitive: it re-reads storage, refuses on id collision,
and `{prepEffort: "quick", ...meal}` preserves the record's own `prepEffort`. It appends
rather than restoring the original array position — library order is not meaningful to any
consumer, so that is not worth code.

### `toast` gains an action (in `app.js` only)

```js
/** @param {string} msg
 *  @param {string} [actionLabel]  when present, renders a button
 *  @param {Function} [onAction]   invoked once, then the toast is removed */
function toast(msg, actionLabel, onAction)
```

Message via `textContent`, button appended as a real element. Timeout **1800ms** as today
when there's no action, **6000ms** when there is — 1.8s is not long enough to find and tap
Undo on a phone.

`toast` is currently triplicated (`app.js:10`, `discover.js:12`, `plan.js:17`). Extend
**only** `app.js`'s copy; extracting a shared toast module is a refactor this phase did not
ask for. `ponytail:` comment naming it: *third copy of toast; extract to `data.js` if a
second page ever needs the action button.*

`ponytail:` comment on the undo path: *undo lives exactly as long as the toast — there is
no trash and no history (`docs/OUTLINE.md:155-157`). If the toast expires, the delete has
already synced to Hermes and is gone.*

---

## 5. Meal-type filter chips

### `index.html` — static markup, inside the Library section

Between `#library-search` and `#library-grid`:

```html
<div id="library-filters" class="chip-row">
  <button class="chip active" data-type="">All</button>
  <button class="chip" data-type="breakfast">Breakfast</button>
  <button class="chip" data-type="lunch">Lunch</button>
  <button class="chip" data-type="dinner">Dinner</button>
  <button class="chip" data-type="snack">Snack</button>
</div>
```

Five static buttons need no JS to build. Above them, alongside the `<h2>`, the
`<button id="add-meal" class="btn">+ Add a meal</button>`.

### `app.js`

Module-level `let activeType = "";`. One delegated listener on `#library-filters`:

```js
document.getElementById("library-filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  activeType = chip.dataset.type;
  /* toggle .active across the row, then */ renderLibrary();
});
```

`renderLibrary()` keeps `MP.filterMeals(library, query)` for the text search and adds one
line:

```js
const filtered = MP.filterMeals(library, query)
  .filter((m) => !activeType || (m.mealTypes || []).includes(activeType));
```

**Do not push the type filter into `MP.filterMeals`** — it is tested (Phase 2) and does one
job; one `.filter()` at the call site is the smaller change.

### Empty state

Replaces the current query-only branch. Escape both interpolated values.

| Query | Chip | Message |
|---|---|---|
| blank | `All` | `Your library is empty.` |
| blank | a type | `No <type> meals in your library yet.` |
| set | `All` | `No meals match "<q>".` (unchanged from Phase 2) |
| set | a type | `No <type> meals match "<q>".` |

---

## 6. `style.css`

All new rules use existing custom properties (`--surface-alt`, `--border`, `--accent`,
`--text-dim`, `--danger`, `--radius`), dark mode first.

- `.chip-row` — flex, `flex-wrap: wrap`, `gap: .4rem`, `margin: .6rem 0`.
- `.chip` — borrow `.tag`'s metrics (style.css:173) and `button.ghost`'s colours (325);
  larger tap target than `.tag` (min-height ~2rem, `.4rem .8rem` padding), `cursor: pointer`.
- `.chip.active` — mirror `.nav a.active` (line 95): `--accent` background, white text.
- `.sync-field textarea` — add `textarea` to the existing `.sync-field input` selector
  (line 356) rather than duplicating the rule; plus `resize: vertical`,
  `font-family: inherit` (textareas default to monospace).
- `.modal-actions` — flex, `gap: .6rem`, `margin-top: 1rem`.
- `button.ghost.danger` — `color: var(--danger); border-color: var(--danger)`.
- `#form-msg` — `.muted` metrics; `#form-msg.error` uses `--danger`.
- `.toast button` — transparent, `color: var(--accent)`, bold, `margin-left: .75rem`.
- `#add-meal` — sits beside the `<h2>`; a `.section h2` flex row or a simple
  `float`/`margin` is fine, whichever is one line.

No new CSS file, no framework, no icon font.

---

## 7. `test.html` additions

`data.js`, `exclusions.js` and `shopping-list.js` are already included; `meals.json` is
already fetched at the top. No new script tags needed.

- `parseIngredients("500g chicken breast", keys)` ⇒ `{key:"chicken_breast", qty:"500g", label:"chicken breast"}`
- `parseIngredients("2 slices white bread", keys)` ⇒ `qty:"2 slices"`, `key:"white_bread"`
- `parseIngredients("2 chicken breasts", keys)` ⇒ `qty:"2"` — *the unit-list check; it
  fails the moment the parser treats any second token as a unit*
- `parseIngredients("1-2 tortillas", keys)` ⇒ `{qty:"1-2", key:"tortillas"}`
- `parseIngredients("Chicken Breast — leftover, sliced", keys)` ⇒
  `{key:"chicken_breast", qty:"leftover, sliced"}`
- `parseIngredients("", keys)` ⇒ `[]`; blank lines and whitespace-only lines dropped
- `parseIngredients("zzz unknown thing", [])` ⇒ key `"zzz_unknown_thing"`, **non-empty** —
  *`data.js:77` does `ing.key.replace(...)` and throws on an empty key*
- **Check: every ingredient of every meal in `meals.json` round-trips —**
  `parseIngredients(ingredientsToText([ing]), keys)[0]` has the same `key` **and** the same
  `qty` as `ing`. *The loudest check in this phase. `toastie-chicken-cheese`'s
  `{key:"chicken_breast", qty:"leftover, sliced"}` is the one that breaks first, and when it
  does, Phase 3's shopping list starts buying chicken it already has.*
- `findSimilarName` — exact match ⇒ found; `"Chicken Fajitas"` vs `"chicken fajitas!"` ⇒
  found; `"Chilli"` vs `"Roast Chicken"` ⇒ null; `ignoreId` set to the only match ⇒ null;
  a 3-character name that is a substring of another ⇒ null (the ≥ 4 floor)
- `upsertMeal` / `removeFromLibrary` are `localStorage` writers, so check them the way the
  library is checked elsewhere — set `mp_library` to a two-meal fixture, call, read back,
  restore the original value in a `finally`. Assert: upsert of an existing id replaces in
  place and does **not** grow the array; upsert of a new id appends; remove of an absent id
  is a no-op returning the same contents; `mp_library_updated_at` moves on all three.

---

## 8. Edge cases

| Case | Behaviour |
|---|---|
| Edit a seed meal with `batchCook`/`leadsTo` | Both preserved — `readForm` spreads the original first. **Check this by hand on `roast-chicken` before committing** |
| Edit changes the name | `id` unchanged, so an existing `mp_plan` still resolves the meal |
| Save with an empty ingredients textarea | `ingredients: []` — legal, and the Worker's `libraryError` accepts an empty array |
| Save with a blank name | Blocked with a message; never written (the Worker would 400 the whole library) |
| Ingredient line with no recognisable key | Saves with the raw slug; the meal shows no nutrient tags and lands in the shopping list's `unpriced` group. Not an error |
| Delete then Undo after a Hermes pull landed | Safe: `addToLibrary` re-reads `localStorage`, so it re-adds into the *pulled* library, not a stale array |
| Delete then let the toast expire | Gone. The delete already pushed via `mp:library-saved` |
| Delete a meal that a saved plan references | The plan keeps the dangling `mealId`; `plan.js` already tolerates a missing meal (Phase 3 §5). **Do not** add plan cleanup — out of scope |
| Two hand-added meals with the same name | Allowed (soft warning only); ids differ via the `Date.now()` suffix, so the Worker's duplicate-id check is satisfied |
| `pack-sizes.json` fails to load | `knownKeys` falls back to nutrient-tag keys alone; the form still works |
| Filter chip + search both set | AND — the chip narrows, then the query narrows further |
| Modal open in form mode, user taps the overlay | Existing `closeDetail` fires and edits are lost without warning. Accepted — matches the current modal behaviour; a dirty-check prompt is not in scope |

---

## 9. Wiring

- `sw.js` — bump `CACHE` to `"meal-planner-v6"`. **No `SHELL` change**: no new file is
  added, and `shopping-list.js` has been in the shell since Phase 3.
- No `manifest.json`, `worker/`, `docs/HERMES.md` or `docs/ARCHITECTURE.md` change. The
  KV surface and the Worker's `KEYS` allowlist are untouched.
- `docs/roadmap.md` Phase 6 ⇒ `(Status: Complete)` in the same commit as the code
  (`.claude/rules/roadmap-gating.md`).

---

## 10. Deliberately not built

Bulk edit or multi-select delete; an image field or upload (hand-added meals stay
placeholder-carded); editing `servings`/`batchCook`/`prepEffort`/`leadsTo` (the generator's
primitives — changing them from a form is a different phase's decision); a trash/undo
history beyond the toast; per-field conflict resolution; plan cleanup on delete; a shared
toast module; a synonym/alias table for ingredient keys; a structured ingredient-row
editor; multi-select filter chips; any new endpoint, KV key or dependency.
