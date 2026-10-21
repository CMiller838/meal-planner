# Phase 7 Spec — Mobile chrome & Discover filters

Roadmap: `docs/roadmap.md` → Phase 7 (lines 91–108). Source of scope:
`docs/OUTLINE.md` v2, lines 182–183 (scrollable mobile tab bar) and 188–190
(Discover category filters).

Pure app-side work. **No new backend surface, no Worker change, no new KV key, no new
dependency, no new JS file, no new CSS file.** Two features that are the same piece of
work twice — a horizontally scrollable strip of pills — plus one new pure function in
`mealdb.js`.

## Decisions taken (user-confirmed)

| Gate | Decision |
|---|---|
| 1. What the chips filter by | **Path A** — TheMealDB *categories* via `filter.php?c=`. `All` keeps today's five-liked-ingredient sourcing. Path B (ingredient chips) reshuffles the same five-ingredient world and can't express "Pasta" or "Vegetarian" at all, which is the roadmap's stated problem |
| 2. What happens when a category runs dry | **Path B** — shuffle the *full* category id list (Fisher-Yates) and sample 12, cached per chip in `sessionStorage`. `filter.php` returns the same order every time, so a deterministic first-12 makes each chip a well that empties permanently after two sessions |
| 3. Mobile nav | **Path B** — brand and theme toggle pinned, only the four links scroll, active link auto-scrolled into view from the existing `MP.initTheme()` |
| Extension of Gate 2 to the `All` chip | The `All` branch goes through the **same** `sampleIds` function. It costs zero extra code (one call site each) and `All` dries up for exactly the same reason a category does. Its `PER_INGREDIENT_LIMIT = 3` constant is **deleted** — the fix is removing a cap, not adding one |
| Where the new pure function lives | `mealdb.js`, beside `toMeal`/`extractIngredients`, which are already pure and already documented as Worker-importable. A new file for one function is a file nobody needs |
| Chip markup | Static in `discover.html`, one delegated listener — the same shape as Phase 6's `#library-filters` (`index.html:36-41`, `app.js:290`) |

---

## 0. What this phase is actually made of

| Roadmap item | Where it lands |
|---|---|
| Nav scrolls at phone widths | §1 — one `<div>` wrapper in 4 HTML files, ~10 CSS lines, 2 JS lines in `data.js` |
| Discover no longer fixed to one pool | §2 — `mealdb.js` gains a `category` argument and one pure function |
| Category filter chips | §3 markup + §4 wiring |
| Shared scrollable-strip styling | §5 — one `.hscroll` utility used by both halves |

**The trap that shapes §5:** a flex child does not overflow-scroll unless it can shrink.
Without `min-width: 0` on `.nav-links`, the nav row grows past the viewport and the
*page* scrolls sideways instead of the strip. This is the single most likely way the
mobile half ships broken, and it looks almost right in a desktop devtools preview.

**The trap that shapes §4:** switching chips fires ~13 network requests. Tap two chips
quickly and the slower response lands last, painting Chicken's deck under a Pasta chip.
The guard is two lines (`if (cat !== activeCat) return;`) and there is no other one.

---

## 1. The mobile nav strip

### 1a. Markup — all four HTML files

`index.html`, `discover.html`, `plan.html`, `shopping.html` all carry byte-identical navs
except which link has `.active`. Wrap **only** the four `<a>` elements:

```html
<nav class="nav">
  <span class="brand">🍽 Meal Planner</span>
  <div class="nav-links hscroll">
    <a href="index.html">Browse &amp; Add</a>
    <a href="discover.html">Discover</a>
    <a href="plan.html">2-Week Plan</a>
    <a href="shopping.html">Shopping</a>
  </div>
  <button id="theme-toggle" class="icon-btn" title="Toggle dark/light mode">🌓</button>
</nav>
```

The `.active` class stays exactly where it is on each page. The `<span class="brand">` and
the `<button id="theme-toggle">` stay **outside** the wrapper — that is what pins them.

### 1b. `data.js` — scroll the active link into view

Two lines at the end of `initTheme()` (`data.js:229-237`), which every page already calls:

```js
const active = document.querySelector(".nav-links a.active");
if (active) active.scrollIntoView({ inline: "nearest", block: "nearest" });
```

`block: "nearest"` is **not optional**. Without it, `scrollIntoView` scrolls the document
vertically as well, and because `.nav` is `position: sticky`, every page load on a phone
jumps down past the header. `inline: "nearest"` is a no-op when the link already fits, so
`index.html` and desktop are unaffected — no overflow check needed.

Runs at the end of `initTheme` so the theme is applied first; all four pages load their
scripts at the end of `<body>`, so layout exists by then.

### 1c. Accessibility

Nothing to add. The links stay real `<a>` elements in DOM order, and browsers scroll a
focused element into view natively, so keyboard tabbing through an off-screen link works
without JS. Do **not** add `tabindex`, `role="tablist"` or arrow-key handling.

---

## 2. `mealdb.js` — category-sourced pools

### 2a. New pure function (TDD)

```js
/** Unique idMeal values from filter.php results, shuffled, capped at `limit`.
 *  Fisher-Yates, descending loop, so rnd() === ~1 yields the identity permutation.
 *  @param {Array<{idMeal: string}>} list  raw `filter.php` results (any of ?c= / ?i=)
 *  @param {number} limit
 *  @param {Function} [rnd]  defaults to Math.random; injected only by test.html
 *  @returns {string[]} */
MP.MealDB.sampleIds(list, limit, rnd)
```

Algorithm, pinned because §6's first check depends on it:

```
ids = unique, truthy idMeal values in input order
for (let i = ids.length - 1; i > 0; i--) {
  const j = Math.floor((rnd || Math.random)() * (i + 1));
  swap ids[i], ids[j]
}
return ids.slice(0, limit)
```

Fisher-Yates rather than `sort(() => Math.random() - .5)` — the sort version is biased and
implementation-dependent, and this is four lines either way.

### 2b. Constants

```js
const CATEGORIES = ["Chicken", "Beef", "Seafood", "Pasta", "Pork", "Lamb", "Vegetarian", "Breakfast"];
const CANDIDATE_LIMIT = 12;   // lookup.php calls per pool build
```

`CATEGORIES` is exported on `MP.MealDB` for the §6 chip-parity check only; the chips
themselves are static markup. Strings must match TheMealDB's category names **exactly,
including capitalisation**. Dessert / Side / Starter / Goat / Vegan / Miscellaneous are
deliberately excluded — they aren't dinners.

**Delete `PER_INGREDIENT_LIMIT`** (`mealdb.js:13`). `POOL_LIMIT = 10` stays.

Hardcoded rather than fetched from `list.php?c=list`: that's a request on every cold load
for a list TheMealDB hasn't changed in years, and we only want 8 of its 14 entries anyway.

### 2c. `fetchPoolUncached(category)`

```js
if (category) {
  // No .catch() here — a dead filter.php must reach discover.js's handler as a
  // network error, not as an indistinguishable empty deck.
  const d = await fetchJson(`${BASE}filter.php?c=${encodeURIComponent(category)}`);
  candidateIds = sampleIds(d.meals || [], CANDIDATE_LIMIT);
} else {
  const lists = await Promise.all(
    LIKED_INGREDIENTS.map((ing) =>
      fetchJson(`${BASE}filter.php?i=${encodeURIComponent(ing)}`)
        .then((d) => d.meals || [])
        .catch(() => [])        // partial failure tolerated on the All fan-out
    )
  );
  candidateIds = sampleIds([].concat(...lists), CANDIDATE_LIMIT);
}
```

Everything after this is **unchanged**: the `lookup.php` fan-out, `toMeal`,
`MP.Exclusions.sanitize`, `.slice(POOL_LIMIT)`, `.map(r => r.meal)`.

Request budget is unchanged or lower: today's All path is 5 filter + up to 15 lookup; the
new All path is 5 filter + 12 lookup, and a category is 1 filter + 12 lookup.

Note the `All` branch no longer slices each ingredient's results to 3 — it pools every
result from all five ingredients (~150-200 ids) and samples 12. That is the deletion of a
cap, and it is what stops `All` drying up too.

### 2d. `getDiscoverPool(excludeIds, category)`

```js
/** @param {string[]} excludeIds
 *  @param {string} [category]  "" or omitted = the liked-ingredient pool
 *  @returns {Promise<Array>} meal records, minus excluded ids */
```

- Cache key: `` `${SS_POOL}:${category || ""}` `` — one cached pool per chip, so switching
  back and forth in a session is instant and costs nothing.
- Wrap `sessionStorage.setItem` in a `try/catch` that swallows the error. Nine cached pools
  is roughly 300KB, comfortably inside quota, but a quota/private-mode throw here would
  currently take down the whole page load for a cache write we can simply skip.
- The `excludeIds` filter still runs **after** the cache read, unchanged — so a cached pool
  correctly hides meals liked or dismissed since it was fetched.

`toMeal`'s `mealTypes` mapping is **unchanged**: `strCategory === "Breakfast"` ⇒
`["breakfast"]`, everything else ⇒ `["dinner"]`. That is still right for all eight chips.
Do not build a category→mealType table; §6 has a check that fails if someone does.

---

## 3. `discover.html` — chip markup

Static, between the `<p class="muted">` hint and `<div class="fan-wrap">` (currently
line 32):

```html
<div id="discover-filters" class="chip-row hscroll">
  <button class="chip active" data-cat="">All</button>
  <button class="chip" data-cat="Chicken">Chicken</button>
  <button class="chip" data-cat="Beef">Beef</button>
  <button class="chip" data-cat="Seafood">Seafood</button>
  <button class="chip" data-cat="Pasta">Pasta</button>
  <button class="chip" data-cat="Pork">Pork</button>
  <button class="chip" data-cat="Lamb">Lamb</button>
  <button class="chip" data-cat="Vegetarian">Vegetarian</button>
  <button class="chip" data-cat="Breakfast">Breakfast</button>
</div>
```

Nine static buttons need no JS to build. `data-cat` values are passed straight into the
`filter.php?c=` query, so they must match §2b's `CATEGORIES` exactly.

No script-tag change: `discover.html` already loads `data.js`, `exclusions.js`,
`mealdb.js`, `discover.js`.

---

## 4. `discover.js` — wiring

### 4a. New module state

```js
let activeCat = "";
let loadFailed = false;
```

### 4b. Extract the exclusion list from `init()`

```js
/** Ids the deck must never show: already in the library, dismissed, or saved for later.
 *  Recomputed per load so a chip switch respects likes made since page load.
 *  @returns {Promise<string[]>} */
async function excludeIds()
```

Body is `discover.js:202-207` moved verbatim.

### 4c. `loadPool(cat)`

```js
/** Fetch, install and render the deck for one chip. @param {string} cat  "" = All */
async function loadPool(cat)
```

1. `activeCat = cat; loadFailed = false;`
2. Paint the loading state: `#fan-deck` gets
   `<div class="swipe-empty">Loading suggestions…</div>`, `#fan-progress` and
   `#fan-filmstrip` cleared. Static text, no interpolation.
3. `try { next = await MP.MealDB.getDiscoverPool(await excludeIds(), cat); }`
   `catch { loadFailed = true; next = []; }`
4. **`if (cat !== activeCat) return;`** — a slower earlier request must not paint over a
   newer chip's deck.
5. `pool = next; idx = 0; renderDeck();`

### 4d. Chip listener

One delegated `click` on `#discover-filters`, mirroring `app.js:290`:

```js
const chip = e.target.closest(".chip");
if (!chip) return;
/* toggle .active across the row, then */ loadPool(chip.dataset.cat);
```

No-op the click if `chip.dataset.cat === activeCat`, so re-tapping the current chip doesn't
throw away swipe position — **except** when `loadFailed` is true, where a re-tap is the
retry the error message tells the user to perform.

### 4e. `renderDeck()` empty state

The one existing branch becomes three. Only the third is new text for the existing case:

| Condition | Message |
|---|---|
| `loadFailed` | `Couldn't reach TheMealDB — check your connection and tap the chip again.` |
| `activeCat` set | `No more ${esc(activeCat)} suggestions — try another chip.` |
| otherwise | `📌 No more suggestions right now — check back later.` (unchanged) |

`activeCat` is our own static string, but it goes through `esc()` anyway — it is
interpolated into `innerHTML`, and the house rule is about the sink, not the source.

### 4f. `init()`

Replace the inline library/exclude/pool block (`discover.js:202-213`) with
`await loadPool("")`. `MP.initTheme()` and `renderSaved()` stay first and unchanged.

The chip resets to `All` on every page load; the per-chip session cache is what makes that
cheap. Persisting the last chip is in §9.

---

## 5. `style.css`

All new rules use existing custom properties, mobile-first like the rest of the file (base
rules are the phone case; `@media (min-width: 640px)` blocks add desktop).

### 5a. The shared strip utility — **must be placed after `.chip-row` (line 406)**

```css
.hscroll { flex-wrap: nowrap; overflow-x: auto; min-width: 0; scrollbar-width: none; -ms-overflow-style: none; }
.hscroll::-webkit-scrollbar { display: none; }
.hscroll > * { flex: 0 0 auto; }
```

`.chip-row` sets `flex-wrap: wrap` at line 406. `.hscroll` has identical specificity, so
**it only wins if it comes later in the file.** Put it immediately after the `.chip`
block (line 418) and the ordering is safe by construction.

`min-width: 0` is the load-bearing declaration — see §0.

### 5b. Nav

```css
.nav .brand { display: none; }            /* modify the existing rule at line 68 */
.nav-links { display: flex; gap: .5rem; flex: 1 1 auto; }
.nav .icon-btn { flex: 0 0 auto; }
```

and inside the **existing** `@media (min-width: 640px)` block at line 134:

```css
.nav .brand { display: flex; }
.nav-links { flex: 0 1 auto; }
```

Those two desktop lines exist to make the ≥640px nav **pixel-identical to today**: the
brand's `margin-right: auto` (line 70) keeps pushing the links and toggle right, and
`flex: 0 1 auto` stops the wrapper from stretching. Keep `margin-right: auto` on `.brand`
— moving it to `.nav-links` changes the desktop layout for no reason.

`.nav a` (line 85) gets `white-space: nowrap` so a two-word link never wraps inside the
strip.

### 5c. Not needed

No `.chip` change — Phase 6 built it (`style.css:407-418`) and it is reused verbatim.
No `#library-filters` change — five chips fit at phone widths; leave it wrapping.

---

## 6. `test.html` additions

Add one script tag, **after** `exclusions.js`: `<script src="mealdb.js"></script>`.
`mealdb.js`'s IIFE only defines and exports at load — no fetch, no `sessionStorage` — so
including it is inert. Export `sampleIds` and `CATEGORIES` on `MP.MealDB` alongside the
existing three.

New check group 26, using the existing `check()` / `deepEqual()` helpers:

- `sampleIds([{idMeal:"1"},{idMeal:"2"},{idMeal:"3"}], 2, () => 0.999999)` ⇒ `["1","2"]`
  — *the exact-permutation check. `rnd()` near 1 makes `j === i` at every step, so a
  correct descending Fisher-Yates returns input order. It fails if the loop is ascending,
  if `rnd` is ignored, or if `Math.random` was hardcoded.*
- `sampleIds([{idMeal:"1"},{idMeal:"1"},{idMeal:"2"}], 5, () => 0.999999)` ⇒ `["1","2"]`
  — dedupe by `idMeal`, first occurrence wins
- **Set preservation:** for a 20-element list, `sampleIds(list, 20).slice().sort()`
  `deepEqual` the input ids sorted — *the shuffle must not drop, duplicate or invent an
  id. This is the check that catches a wrong swap.*
- `sampleIds([], 5)` ⇒ `[]`; `sampleIds(list, 0)` ⇒ `[]`
- `sampleIds(list3, 99)` ⇒ all 3 — a limit above the unique count is not an error
- `toMeal({idMeal:"1", strCategory:"Pasta", strMeal:"x", strInstructions:"y"}).mealTypes`
  ⇒ `["dinner"]`, and the same with `strCategory: "Breakfast"` ⇒ `["breakfast"]`
  — *guards the mapping against being "upgraded" into a category→mealType table now that
  seven more categories can reach it*
- **Chip parity:** every `data-cat` in `discover.html`'s `#discover-filters` (other than
  `""`) appears in `MP.MealDB.CATEGORIES`. `test.html` can't reach `discover.html`'s DOM,
  so assert the inverse instead: `CATEGORIES.length === 8` and `deepEqual(CATEGORIES,
  ["Chicken","Beef","Seafood","Pasta","Pork","Lamb","Vegetarian","Breakfast"])`, and check
  the markup by eye in §8's manual pass. A typo'd category silently returns an empty deck,
  which is why it gets a check at all.

---

## 7. Edge cases

| Case | Behaviour |
|---|---|
| Two chips tapped in quick succession | The stale response is dropped by `cat !== activeCat` (§4c step 4). Without it the earlier, slower fetch paints last |
| Re-tapping the chip already active | No-op — swipe position is preserved. Unless `loadFailed`, where a re-tap retries |
| A category yields fewer than 12 meals | Deck is short. Not an error; `sampleIds` returns what exists |
| Every sampled meal is sanitized away (mushrooms) | Empty deck, `No more <Category> suggestions — try another chip.` Correct, not an error |
| Returning to a chip already swiped through this session | Cached pool, but `excludeIds` now covers those meals, so the deck is empty with the category message. Correct — they're in the library |
| Offline / TheMealDB down, category chip | `filter.php` throws (no `.catch()` in that branch by design) ⇒ `loadFailed` ⇒ connection message ⇒ re-tap retries |
| Offline / TheMealDB down, `All` chip | Per-ingredient `.catch(() => [])` swallows it, so the deck is empty with the original generic message rather than the connection one. Accepted asymmetry — the All fan-out is designed to survive partial failure, and reworking it into an all-or-nothing error path is not this phase's job |
| `sessionStorage` unavailable or full | The `setItem` `try/catch` skips caching; every chip switch simply refetches |
| Liking a meal off the Breakfast chip | It lands in the library with `mealTypes: ["breakfast"]` via the existing `toMeal` mapping. Correct — that's what the plan generator needs |
| Nav on a 320px phone | Brand hidden, four links scroll, toggle pinned. The active link is scrolled into view on load |
| Nav at ≥640px | Byte-for-byte the current layout — that's what §5b's two desktop lines buy |
| Keyboard tab to an off-screen nav link | Browser scrolls focus into view natively. No JS |
| `#library-filters` on `index.html` | Untouched. Still wraps |

---

## 8. Wiring

- `sw.js` — bump `CACHE` to `"meal-planner-v7"`. **No `SHELL` change**: no new file is
  added and all four pages plus `mealdb.js` are already cached.
- No `manifest.json`, `worker/`, `docs/HERMES.md` or `docs/ARCHITECTURE.md` change. The KV
  surface and the Worker's `KEYS` allowlist are untouched. `meals.json` is untouched — this
  phase does not write to the meal record, which is why it sequences before Phase 8.
- `docs/roadmap.md` Phase 7 ⇒ `(Status: Complete)` in the same commit as the code
  (`.claude/rules/roadmap-gating.md`).

---

## 9. Deliberately not built

Free-text search on Discover (settled in the roadmap: the search box the outline mentions
is the Library's, and none is being added here); the outline's "using what's left" chip
(needs pantry data — Phase 11); nutrient-gap ranking of the pool (Phase 10, which depends
on this phase having restructured how the pool is built); multi-select chips; persisting
the last-used chip across visits; area/cuisine chips; fetching the category list from
`list.php?c=list`; Dessert/Side/Starter/Goat/Vegan/Miscellaneous chips; a bottom tab bar or
hamburger menu; scroll-snap or edge-fade affordances on either strip; making
`#library-filters` scroll; infinite scroll or a "load more" button on the deck; any change
to `.chip` styling, the meal record, `meals.json`, the Worker, or the dependency set.
