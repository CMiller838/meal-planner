# Phase 62: Taste profile from ratings [M]
Plain: your 👍/👎 ratings teach the app which ingredients and cook styles you like, so Discover and the plan favour more of them.

Requires Phase 51 (built: `ratings.js`, `rankSlot` ratings layer).

## Decisions

- **User-chosen: no cuisine.** The roadmap's "cuisines" is dropped: `mealdb.js` `toMeal` discards `strArea` and library meals
  have no such field. The profile learns **ingredient keys + cook style** only; Verify becomes ingredient-based.
- **Own call: extend, don't duplicate.** `prefs.js` `orderByTaste`/`tasteScores` already rank Discover by ingredient tokens
  from like/dismiss/eaten counters. The ratings profile is a second input into that same ordering, normalised by token
  frequency the same way, so a token in everything (salt, oil) can't dominate.
- **Own call: derived on read, never stored.** `MP.Ratings.tasteProfile(ratings, meals)` recomputes from `mp_ratings` each
  call (16-100 meals, trivial), so deleting ratings restores today's order with no stale copy and no new KV key.
- **Own call: weights mirror `Prefs.scoreOf`.** 👍 +2, 👎 -3, `never` -4 per rated meal; a meal's score is spread over its
  tokens (`ingredient key` each, plus `effort:<prepEffort>`) divided by that token's library frequency. Notes are ignored.
- **Own call: inert until 3 rated meals** (`planning.tasteMinRated`), so one stray 👍 can't skew a plan.
- **Own call: nudge, not a re-score.** In `rankSlot`, a new layer 3c after the ratings layer reorders only the **top
  `planning.tasteWindow` (4)** of each rating group (up / neutral / down) by profile score, stable; the rest of the list and
  all nutrition order stays put. It never filters; `never` stays the one filter. Both knobs live in `pack-sizes.json`
  `planning` (data, not inline constants).
- **Own call: Worker Discover is unchanged.** `GET /discover` is random/search passthrough with no ranking; only the app's
  Discover page and `rankSlot` (so `GET /ranking`) use the profile. `/why` gets no new reason code (taste is not an
  input it explains; the existing `liked`/`disliked` stay accurate).

## Files touched

- `ratings.js` (has the `window`→`root` shim, Worker imports it): add `tasteProfile(ratings, meals)` and
  `tasteScore(profile, meal)`, export on `MP.Ratings`.
- `generator.js`: layer 3c in `rankSlot` reading `opts.taste` (a profile, absent/empty = today's order);
  `generatePlan` (`generator.js:228`) builds it once via `MP.Ratings.tasteProfile(ratings, library)` and passes it in the
  `rankSlot` opts at `generator.js:282`. Update the layer comment (`generator.js:120`).
- `plan.js:478`: swap-pool `rankSlot` call passes `taste: MP.Ratings.tasteProfile(MP.Ratings.get(), library)`.
- `worker/worker.js:214`: `rankSlot` call passes `taste` from `ratings` + `library` (both already in scope at `:196-219`).
- `prefs.js`: `orderByTaste(list, prefs, meals, taste)`, optional 4th arg added to each meal's token score.
- `discover.js:296`: pass `MP.Ratings.tasteProfile(MP.Ratings.get(), [...library, ...MP.getSavedLater()])`.
- `discover.html`: add `<script src="ratings.js">` before `discover.js` (new cross-file dependency; also grep every `*.html`
  loading `generator.js` or `prefs.js` consumers for a page with `generator.js`/`discover.js` but not `ratings.js`; `sw.js`
  already caches `ratings.js`).
- `pack-sizes.json` `planning`: `"tasteWindow": 4, "tasteMinRated": 3`.
- `test.html`, `tools/worker_test.mjs`: asserts below. `sw.js`: bump `CACHE`. `CLAUDE.md`: extend the Phase 51 ratings
  invariant with "taste profile (Phase 62) is derived from `mp_ratings`, reorder-only, never stored".

## Signatures / schemas

```
MP.Ratings.tasteProfile(ratings: {id: Record}, meals: Meal[]) -> { n: number, tokens: { [token]: number } }
    // n = rated meals found in `meals`; n < planning.tasteMinRated -> tokens {} (inert)
MP.Ratings.tasteScore(profile, meal) -> number     // sum of profile.tokens over meal's tokens; 0 when inert
rankSlot opts.taste: profile | undefined           // absent/inert = identical output
MP.Prefs.orderByTaste(list, prefs, meals, taste?)  // taste adds to tokenScore; absent = today's order
```

## Edge cases

- No ratings, or fewer than `tasteMinRated` rated meals found in `meals`: profile inert, outputs identical to today.
- Rated id no longer in the library: skipped (not counted in `n`).
- Discover candidates (TheMealDB) have no `prepEffort`: only ingredient tokens score for them.
- Tied scores keep input order (stable); the window never moves a meal across rating groups.
- A pool smaller than `tasteWindow` just reorders what exists; a slot never empties because of taste.

## Verification

- `python3 check.py` (test.html asserts): `tasteProfile` inert below 3 rated meals; with 10 ratings a candidate sharing
  ingredients with 👍 meals scores above one sharing with 👎 meals; `rankSlot` with `taste` is a permutation of the
  no-taste output (same set and length), only the top window of a rating group moves, and rating groups keep
  up/neutral/down order; `orderByTaste` with a profile puts liked-ingredient candidates ahead and with `taste` absent
  equals today's order; clearing ratings restores the original Discover order.
- `node tools/worker_test.mjs`: `GET /ranking` with seeded ratings reorders only inside the window and is identical with
  `ratings` removed. No real credential needed (test tokens only).
- UI (`python3 check.py ui`, driven run via `tools/browser-check`, fresh profile): rate 10 library meals, open Discover
  with a stubbed TheMealDB pool, confirm the top five shift toward liked ingredients, then clear ratings and confirm the
  original order returns; PC and 390 px, dark and light.

## Tasks

### Logic (TDD)
- [x] `test.html` asserts, then `ratings.js` `tasteProfile`/`tasteScore`; `pack-sizes.json` knobs
- [x] `rankSlot` layer 3c + `generatePlan` / `plan.js:478` / `worker.js:214` pass `taste`; `worker_test.mjs` assert
- [x] `prefs.js` `orderByTaste` 4th arg; `discover.js` passes the profile; `discover.html` loads `ratings.js`

### UI
- [x] No new UI. Check Discover and the swap sheet by eye (`ui-build` checklist) for the reorder; bump `sw.js` `CACHE`; update `CLAUDE.md`
