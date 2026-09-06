# Phase 10 Spec — Nutrient-gap-aware Discover

Roadmap: `docs/roadmap.md` → Phase 10. Scope is settled there and is not re-litigated here:
Discover's suggestion pool is **reordered** by the nutrients the liked-meal library under-covers.
This is a **second caller of `MP.Nutrition.dayCoverage` + `rankByGap`**, wired exactly as
`plan.js`'s swap picker already wires them (`plan.js:163-174`) — no new nutrition logic, no new
scoring, no new data file.

**No schema change, no new dependency, no new JS file, no new CSS rule, no `meals.json` edit, no
`nutrition.js` edit, no `mealdb.js` edit, no `exclusions.js` edit, no Worker change, no change to
the swipe deck, `decide()`, the filmstrip or the saved-for-later pile.** Three small pieces: one
`<script>` tag and one empty `<p>` in `discover.html`, ~15 lines in `discover.js` (`loadPool`
plus one helper), and a `sw.js` cache bump.

## Decisions taken

No Decision Gate was raised. The roadmap settled the feature; everything left is a single-file,
one-commit-reversible implementation default. They are listed so any can be overridden before the
build starts.

| Choice | Decision |
|---|---|
| Where ranking happens | **`discover.js`, after `getDiscoverPool()` returns** — not inside `mealdb.js`. `mealdb.js`'s filter chain (142-148) enforces *content policy* (mushrooms, standalone eggs, veg-in-toasties) which must hold for every consumer of the API; ranking is a *Discover-page preference* driven by library state `mealdb.js` currently knows nothing about. Ranking there would make the API client depend on `MP.getLibrary` + `MP.Nutrition` to reorder its own output. Zero-line diff to `mealdb.js` is also the shortest one |
| What gets ranked | The **already-capped, already-excluded 10** that `getDiscoverPool` returns. `POOL_LIMIT` (`mealdb.js`) still picks *which* 10 by shuffle; Phase 10 only picks their **order**. Raising `POOL_LIMIT` so ranking chooses from a wider set is a real upgrade and is deliberately not taken here — it multiplies TheMealDB lookups per chip tap for a nice-to-have. Mark it with a `ponytail:` comment naming the ceiling |
| Where gaps are computed | **Inside `loadPool()`**, once per page load and once per chip tap — not memoised at module scope, not recomputed per card or per like. `excludeIds()` is already refetched per chip tap for exactly this reason (a like since page load must count), and `MP.getLibrary()` + `MP.Nutrition.load()` are both already cached (`data.js`, `nutrition.js:15-24`), so the second and later taps cost a `dayCoverage` pass over the library and nothing else |
| Does a like re-rank the live deck | **No.** `decide()` is untouched. The pool loaded for this chip keeps its order until the next chip tap or reload. Re-ranking mid-deck would reshuffle the cards under the user's thumb, and one liked meal moves a library-wide coverage sum by at most one `high` tag |
| Gap source | `dayCoverage(library, tags, targets)` over the **whole library as one meal set** — same function, different input, per the roadmap. `[...missing, ...partial]`, mirroring `plan.js:171`. `partial` will rarely fire at library scale (scores sum across every meal); it is included so the two call sites stay identical rather than because it changes much |
| Empty gap list | `pool = raw` unranked. A library that covers all 11 tracked nutrients has nothing to rank *by*; `rankByGap` with `[]` scores every candidate 0 and (stable sort) returns the input order anyway, so the guard is documentation, not behaviour |
| Failure isolation | The whole gap computation sits in **its own `try`/`catch` returning `[]`**. Discover works today with no nutrition data loaded at all; a failed `nutrition-targets.json` fetch or a seed-library failure must degrade to today's unordered deck, never to an empty deck or a thrown init |
| Making the ordering visible | **One line above the deck**: "Ranked to fill: iron, vitamin D, calcium" in an existing `.muted` paragraph, top 3 gaps only, hidden when there are none. Ranking is otherwise **completely invisible** — the user cannot tell a gap-ranked deck from a shuffled one, and an invisible feature is an unverifiable one |
| Per-card "covers: iron" badge | **Not built.** It needs a per-meal re-scoring helper that duplicates `rankByGap`'s internal weighting (`nutrition.js:66-82` does not expose per-candidate scores), and `cardInner` is rendered for the deck *and* the filmstrip. The one header line buys the same legibility for a fifth of the code |
| Nutrient label rendering | Existing `MP.labelize` (`data.js:21`, `MP.labelize` at 242), as `plan.js:71` already does for its "Short on:" line. Same wording style, no new label map |

---

## 0. What this phase is actually made of

| Roadmap item | Where it lands |
|---|---|
| Rank Discover by under-covered nutrients | §2b — `libraryGaps()` + three lines in `loadPool` |
| Reuses `dayCoverage().missing` / `rankByGap()` unchanged | §2b; `nutrition.js` is **not edited** (§4) |
| Second caller, not new logic | The `plan.js:163-174` shape, with the library in place of "the day's other slots" |
| Depends on Phase 7's restructured pool build | §2b splices in **after** `getDiscoverPool` returns and **before** the `cat !== activeCat` stale-response guard; the chip flow at `discover.js:237-244` is untouched |

**The trap that shapes §2b.** `loadPool` has a stale-response guard —
`if (cat !== activeCat) return;` (`discover.js:231`) — that protects against a slow fetch for chip
A landing after the user has tapped chip B. Ranking must happen **before** that guard, on the
local `next`, and must never assign to the module-level `pool` itself. Assigning `pool` from
inside the ranking step would reinstate exactly the race the guard exists to kill.

**The second trap.** `discover.html` does **not** load `nutrition.js` today (its script list is
lines 66-70: `data.js`, `exclusions.js`, `mealdb.js`, `discover.js`). Without the new tag,
`MP.Nutrition` is `undefined` and the `catch` in §2b silently swallows it — the deck keeps
working and the feature simply never happens, with no console error the user would notice. The
`<script>` tag in §1 is the load-bearing line of this phase.

`nutrition.js`, `nutrition-targets.json` and `ingredient-nutrient-tags.json` are **already in
`sw.js`'s `SHELL`** (lines 13, 26, 28) because `plan.html` loads them — so §6 is a cache-version
bump with no `SHELL` edit.

---

## 1. `discover.html` — two lines

Script tag, inserted **between `data.js` (line 66) and `exclusions.js` (line 67)** so the load
order matches `test.html:10-17` and `plan.html`:

```html
<script src="nutrition.js"></script>
```

Gap note, inserted immediately **after** the `#discover-filters` chip row (closing `</div>`,
line 43) and **before** `<div class="fan-wrap">` (line 44):

```html
<p class="muted" id="gap-note" style="text-align:center;"></p>
```

Empty by default, filled by §2c. Reuses `.muted` and the same inline `text-align:center` as the
sibling paragraph at line 32 — **no new CSS rule and no `style.css` change in this phase**. An
empty `<p class="muted">` collapses to its margin; if that margin reads as a gap in the layout,
set `textContent = ""` *and* `hidden = true` (§2c already does).

---

## 2. `discover.js`

### 2a. Module state — nothing new

`pool`, `idx`, `activeCat`, `loadFailed` (lines 9-12) are unchanged. The gap list is a **local**
inside `loadPool`; it is used once per load and never read again, so hoisting it to module scope
would be state nobody reads.

### 2b. `libraryGaps()` — the one new function

Placed beside `excludeIds()` (`discover.js:206-215`), whose shape it mirrors — async, called
once per `loadPool`, reads current library state:

```js
/** Nutrients the whole liked-meal library under-covers, worst-first-ish, for ranking the deck.
 *  Same call pair as plan.js's swap suggestions, with the library as the meal set instead of
 *  one day's other slots. Returns [] if nutrition data can't load — Discover must still work.
 *  @returns {Promise<string[]>} subset of MP.Nutrition.TRACKED_NUTRIENTS
 */
async function libraryGaps()
```

Body:

```js
try {
  const [library, nut] = await Promise.all([MP.getLibrary(), MP.Nutrition.load()]);
  const cov = MP.Nutrition.dayCoverage(library, nut.tags, nut.targets);
  return [...cov.missing, ...cov.partial];
} catch (e) {
  return [];
}
```

`loadPool` (`discover.js:218-235`) — the fetch block becomes:

```js
let next;
let gaps = [];
try {
  const [ids, g] = await Promise.all([excludeIds(), libraryGaps()]);
  gaps = g;
  next = await MP.MealDB.getDiscoverPool(ids, cat);
  // ponytail: reorders the 10 the pool already picked, doesn't widen the pick.
  // Raise mealdb POOL_LIMIT if the top card stops feeling gap-relevant.
  if (gaps.length) {
    const { tags } = await MP.Nutrition.load();     // cached; no second fetch
    next = MP.Nutrition.rankByGap(next, gaps, tags);
  }
} catch (e) {
  loadFailed = true;
  next = [];
}
if (cat !== activeCat) return;
pool = next;
idx = 0;
renderGapNote(gaps);
renderDeck();
```

- `excludeIds()` and `libraryGaps()` run in **one `Promise.all`** — both await `MP.getLibrary()`,
  which is cached in `data.js`, so this is two awaits on one fetch, not two fetches.
- The `rankByGap` call is inside the **existing** `try`. A throw there is a genuine failure of the
  load (it would leave `next` half-formed), and the existing `loadFailed` empty state is the right
  answer. `libraryGaps`'s own `catch` is what keeps a *nutrition-only* failure non-fatal.
- `await MP.Nutrition.load()` a second time hits `nutrition.js`'s `cache` (line 15-24) and returns
  the same object — cheaper than threading `tags` out of `libraryGaps`, which would change its
  return type to satisfy one caller.
- `renderGapNote(gaps)` goes **after** the stale-response guard, beside `renderDeck()`, so an
  abandoned chip's gaps never paint. Gaps are library-wide and identical for every chip, so in
  practice the text does not change between taps — it is re-rendered anyway because the load path
  owns it.

### 2c. `renderGapNote(gaps)`

```js
/** One line above the deck explaining the ordering. Hidden when there is nothing to fill.
 *  @param {string[]} gaps */
function renderGapNote(gaps)
```

Body:

```js
const el = document.getElementById("gap-note");
const top = gaps.slice(0, 3).map(MP.labelize).join(", ");
el.textContent = top ? `Ranked to fill: ${top}` : "";
el.hidden = !top;
```

- `textContent`, not `innerHTML` — nutrient keys are internal constants, but the house rule is
  "`esc()` or `textContent`" and `textContent` is the shorter of the two here.
- Top 3 only. The library can be missing 8 of 11 tracked nutrients on day one; an eight-item list
  above the deck is noise, and the first three are the ones actually driving the top cards.
- `MP.labelize` is destructured at the top of `plan.js`/`app.js` but **not** in `discover.js`
  (line 6 destructures `esc` only). Either add it to that destructure or call `MP.labelize`
  qualified — one line either way, no preference.

---

## 3. What is deliberately not re-rendered

`renderDeck`, `cardInner`, `cardImageHtml`, `makeDraggable`, `decide`, the filmstrip, the
progress line, the saved-for-later pile, the three control buttons and the chip handler
(`discover.js:237-244`) are **all untouched**. The deck receives a differently-ordered array and
renders it exactly as before. `pool` is still consumed sequentially by `idx`.

---

## 4. Confirmed unchanged

| File / function | Change |
|---|---|
| `nutrition.js` (`dayCoverage`, `rankByGap`, `load`, `TRACKED_NUTRIENTS`) | **None.** Called with new inputs from a new place; every function is byte-identical |
| `mealdb.js` (`getDiscoverPool`, `toMeal`, `POOL_LIMIT`, `CATEGORIES`, the exclusion chain 142-148) | **None.** Ranking composes *after* the returned array |
| `exclusions.js` | **None.** Content exclusions still run inside `mealdb.js`, before ranking ever sees a meal |
| `discover.js` `decide` / `renderDeck` / `cardInner` / swipe wiring | **None** |
| `data.js`, `plan.js`, `app.js`, `generator.js`, `shelf-life.js`, `shopping-list.js`, `swipe.js`, `hermes-sync.js` | **None** |
| `style.css` | **None** — §1 reuses `.muted` |
| `meals.json`, `nutrition-targets.json`, `ingredient-nutrient-tags.json`, `substitutions.json`, `manifest.json`, `worker/` | **None** |

---

## 5. `test.html` additions

New check group **29** (next free number after group 28; the file reuses 23/24 mid-file — **do
not renumber anything**). **No new script tags** — `nutrition.js` is already loaded at
`test.html:11`.

The ranking itself is three lines of glue inside `discover.js`'s IIFE with nothing exported;
extracting a function purely to assert it would be scaffolding. What is worth pinning is the one
contract the deck newly depends on, where a break fails **silently** (the deck still renders,
just wrongly ordered — or worse, short):

- **`rankByGap` returns a permutation, never a filter.** Given a hand-built candidate array,
  the result has the **same length** and the **same set of `id`s** as the input, for a non-empty
  gap list, for an empty gap list, and for candidates that match **no** gap nutrient. A dropped
  candidate would show up only as a deck that runs out early
- **It actually orders.** With `gaps: ["iron"]` and two candidates where only the second has a
  `high`-iron ingredient, the second comes back first
- **`ingredients: []` does not throw** — a TheMealDB record whose measures all parse away yields
  an empty ingredient list, and `rankByGap` must score it 0 rather than crash the whole load
- **`dayCoverage` over the *entire* seed library** (every meal in `meals.json` as one meal set)
  returns `missing` and `partial` arrays that are subsets of `MP.Nutrition.TRACKED_NUTRIENTS` and
  are **disjoint** — the deck concatenates them into one gap list, so an overlap would double-weight
  a nutrient
- **`MP.labelize` returns a non-empty string for every entry of `TRACKED_NUTRIENTS`** — the note
  line renders raw keys otherwise (`vitB12` instead of "Vit B12")

Everything else in this phase — the script tag, the note's placement, whether the top card *feels*
gap-relevant — is only observable in a browser and is verified in §6's manual pass, which is the
honest place for it.

---

## 6. Wiring

- `discover.html` — the `nutrition.js` script tag **and** `#gap-note` (§1). The script tag is the
  one line that silently disables the whole phase if forgotten.
- `sw.js` — bump `CACHE` to `"meal-planner-v10"` (currently `"meal-planner-v9"`, line 4). **No
  `SHELL` change**: `nutrition.js` (13), `ingredient-nutrient-tags.json` (26) and
  `nutrition-targets.json` (28) are already listed.
- No `style.css`, `index.html`, `plan.html`, `shopping.html`, `manifest.json`, `worker/`,
  `docs/HERMES.md` or `docs/ARCHITECTURE.md` change — confirm this rather than editing anything.
- `docs/roadmap.md` Phase 10 ⇒ `(Status: Complete)` in the same commit as the code
  (`.claude/skills/roadmap-gating/`).

**Manual pass:**

1. Open `discover.html` with a small library (a few meals) → "Ranked to fill: …" appears above the
   deck naming up to 3 nutrients, and the top card's ingredients plausibly hit at least one of them.
2. Tap through several chips → the deck reloads, the note stays consistent, no console error and
   no visible delay beyond the existing fetch.
3. Like a meal, then tap a chip → the reload still works; the note may or may not change (one meal
   rarely closes a library-wide gap) — the point is that it does not error or blank the deck.
4. Temporarily rename `nutrition-targets.json` in devtools' network blocking → the deck still
   loads and renders, unranked, with the note hidden. **This is the isolation check** for §2b's
   `catch`.
5. Temporarily comment out the `nutrition.js` script tag → same graceful degradation (this is the
   silent-failure mode §0 warns about; confirm it is silent, then put the tag back).
6. Offline (SW cache) reload of `discover.html` → the page shell loads from cache; the deck shows
   its existing network-failure empty state, not a thrown init.
7. On phone width: the note is one line, centred, and does not push the deck below the fold.

---

## 7. Edge cases

| Case | Behaviour |
|---|---|
| Empty library (fresh install, seed only) | Seed `meals.json` is the library, so gaps come from it; if it covers everything, `gaps` is `[]`, the note hides and the deck is today's shuffled order |
| Library covers all 11 tracked nutrients | `gaps` `[]` → unranked. Correct: nothing to rank by |
| Library missing 8 of 11 | All 8 rank the deck; the note names the first 3 |
| Every candidate scores 0 against the gaps | Stable sort keeps the shuffled order — the deck degrades to today's behaviour rather than to a fixed order |
| Candidate with `ingredients: []` | Scores 0, sorts last-ish, still shown. Never dropped (§5's permutation check) |
| A gap nutrient no ingredient in `ingredient-nutrient-tags.json` carries | Contributes 0 to every candidate; ranking falls back to the other gaps. Not an error |
| `nutrition-targets.json` / `ingredient-nutrient-tags.json` fail to load | `libraryGaps` catches → `[]` → unranked deck, hidden note. **Discover never breaks for a ranking nicety** |
| `MP.Nutrition` undefined (script tag missing) | Same path — the `catch` swallows the `TypeError`. Silent by design; §6 step 5 is how you notice |
| TheMealDB fetch fails | Unchanged: existing `loadFailed` empty state. Ranking never runs |
| Chip tapped while a slower load is in flight | The `cat !== activeCat` guard (line 231) still fires **before** `pool` is assigned and before the note repaints — ranking happens on the local `next`, never on `pool` |
| Category chip active (e.g. Seafood) | Gaps are library-wide, not per-category. A Seafood-only pool ranked by "missing calcium" may have a weak best card — correct and honest; filtering the gap list by category would be inventing new logic |
| Meal excluded by mushroom/egg/toastie rules | Already gone before ranking sees it (`mealdb.js:142-148`). Ranking can never resurface an excluded meal |
| Meal already in the library or dismissed | Already excluded via `excludeIds()`. Unchanged |
| Liking a meal mid-deck | Deck order is frozen for this load by design; the like counts at the next chip tap or reload |
| Two nutrients tie | `rankByGap`'s existing sort decides. Not stabilised further — an arbitrary but consistent order between two equally-good meals is not a bug |
| Nutrient key rendering | `MP.labelize` for every key in the note; no raw `vitB12` reaches the DOM |
| Untrusted content | Nothing new is interpolated from TheMealDB in this phase. `cardInner`'s existing `esc()` calls are untouched, and the note uses `textContent` |

---

## 8. Deliberately not built

A per-card "covers: iron, vitamin D" badge; exposing per-candidate scores from `rankByGap`;
widening `POOL_LIMIT` so ranking picks from a larger set (the named `ponytail:` ceiling);
re-ranking the live deck after each like; per-category or per-slot-type gap lists; weighting
`missing` above `partial`; gap-aware ranking of the saved-for-later pile, the browse page or the
plan generator; a "why this meal" explainer sheet; caching gaps in `localStorage`; recomputing
coverage from anything other than the existing tag/target JSON; any change to the tagging
system's approximate high/med/low weights (it is a coverage checklist, not a calculator); any
edit to `nutrition.js`, `mealdb.js`, `exclusions.js`, the swipe deck, the meal schema, the
Worker, `style.css`, or the dependency set.
