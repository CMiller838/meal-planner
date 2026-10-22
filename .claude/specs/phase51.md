# Phase 51: Meal ratings, flags and reasons ("never again") [M]
Plain: give any meal a 👍/👎 and a short note, mark it "never again", and ask the assistant why a meal was suggested.

Requires Phase 32 (done). Phase 48 (activity log, spec written, `/overnight` builds it first) is a soft dependency:
if `ITEMS`/`logWrite` are missing in `worker/worker.js` when this is built, skip the `ITEMS.ratings` entry and say so in
the commit. The old "Requires Phase 42" is satisfied: 42 was merged into this phase. Assistant side: `notion_assistant`
Phases 61 and 73, not needed to build or test this.

## Decisions

- **User-chosen: 👍/👎 gently nudge the generator, visibly.** A new reorder layer in `rankSlot` (`generator.js`), placed
  after the busy/free layers and before the `budget` step: 👍 meals move ahead of neutral, 👎 meals behind, order inside
  each group unchanged. It never re-scores and never filters, and `/why` says "ranked up: you liked this".
- **Own call: one record, not a second set of flags.** 👍 is `liked`, 👎 is `disliked` (deprioritise only, per the
  roadmap's preference); `never` is a separate boolean, the only hard exclude. Per meal:
  `{ rating: "up"|"down"|null, note: string, never: boolean, at: ISO }`.
- **Own call: `never` is a hard exclude of the generator pool**, applied at the top of `rankSlot` with no
  "pool too small" fallback (unlike `excludeIds`), same standing as `MP.Exclusions`. It removes the meal from
  suggestions and plans only: the meal stays in the library, Browse and shopping history, and un-flagging restores it.
  A meal already in the current plan is left in place (no silent plan edit) and shows a "flagged never" badge.
- **Own call: storage is its own KV key `ratings`** (`{ meals: { [mealId]: Record } }`), not the `prefs` counters
  (`prefs.js`, whole-key pushed by the app, assistant read-only: sharing it would let a push clobber an assistant
  rating). The counters stay as they are (Discover taste).
- **Own call: writes go through one per-meal route** so app and assistant land in the same record without whole-key
  clobbering: `PUT /meal/:id/rating`, body any of `{ rating, note, never }` merged into that meal's record, server
  stamps `at`. `rating: null` clears; unknown meal id → 404; note trimmed to 120 chars. Both tokens may call it. The
  app mirrors the key to `mp_ratings` (pull on load/sync, merge per meal by newest `at`).
- **Own call: `/why` reasons are only real ranking terms.** The roadmap's "uses expiring item X" and "within budget" are
  NOT inputs to `rankSlot`/`/ranking` today (use-by and budget are not read there), so they are left out rather than
  invented. Codes: `fills_gap` (meal covers a nutrient `dayCoverage` says is short), `chip` (matches an active prefer
  chip), `quick` (busy day and the meal's effort is the busy vocab's `preferEffort`), `liked`, `disliked`.
  `GET /why?meal=&day=&slot=` computes them from the same inputs as `GET /ranking` via one shared helper, so the two
  never drift. Read-only; assistant token allowed.

## Files touched

- `generator.js`: `ratingLayer` inside `rankSlot`; `never` filter; both read `opts.ratings` (a `{id: Record}` map).
  `plan.js` passes it at its `generatePlan` and swap-pool call sites (`plan.js:97-102`, `:399`); the Worker passes it
  at `ranking` and `why`. `generator.js` stays the one ranking implementation (CLAUDE.md fourth-caller rule).
- `ratings.js` (new, `window`→`root` shim like `exclusions.js`): `MP.Ratings` get/set/merge/`neverIds`/`byId`.
- `worker/worker.js`: `KEYS` `/ratings`, `METHOD_PATH`-style `RATING_PATH`, `putMealRating`, `why`, shared
  `rankingReasons`; `ASSISTANT_ALLOWED` gains `GET /ratings`, `PUT /meal-rating`, `GET /why`.
- `tools/worker_test.mjs`, `test.html`: asserts below.
- `hermes-sync.js`: `fetchRatings()`, `pushRating(id, patch)` (best-effort, never throws).
- `app.js`, `index.html`, `style.css` (only if no class fits): rating row in the meal detail sheet (`openDetail`,
  `app.js:163`), 👎/👍 state and a "Never again" toggle with Undo toast, badge on the card.
- `sw.js`: add `ratings.js` to the cache list and bump `CACHE`. `docs/ARCHITECTURE.md`: KV row `ratings`, route rows.
  `CLAUDE.md`: one invariant line (ratings are a nudge layer, `never` the only filter).

## Signatures / schemas

```
KV ratings: { meals: { [mealId]: { rating: "up"|"down"|null, note: string, never: boolean, at: string } } }
MP.Ratings.get() -> {id: Record}          MP.Ratings.set(id, patch) -> Record   MP.Ratings.merge(remoteMeals) -> void
MP.Ratings.neverIds() -> Set<string>
PUT /meal/:id/rating   body {rating?, note?, never?} -> 200 Record
GET /ratings -> { meals: {...} }
GET /why?meal=&day=1-14&slot=dinner -> { mealId, rank|null, reasons: [{ code, text }], approximate: true }
rankSlot opts.ratings: {id: Record}   // absent/empty = today's behaviour
```

## Edge cases

- All pool meals `never` for a slot type: `rankSlot` returns `[]`; `generatePlan` and the swap sheet must leave that slot
  empty/"nothing available" rather than throw (builder: check `pickMeal` callers handle `[]`).
- Meal id in `ratings` that left the library: ignored by the generator, kept in the record.
- Rating written offline in the app then assistant writes the same meal: newest `at` wins per meal, per-field not needed.
- `/why` for a meal not in the day's slot pool: `rank: null`, reasons still computed from the meal alone.
- Losing `ratings` degrades to today's behaviour (no nudge, nothing excluded).
- Untrusted text: the note is user/assistant free text, rendered with `textContent`/`esc()`, never `innerHTML`.

## Verification

- `node tools/worker_test.mjs`: `PUT /meal/:id/rating` merges fields into one record from both tokens, stamps `at`,
  404 on unknown meal, `rating:null` clears, note capped; assistant token gets `GET /ratings` and `GET /why` but not
  `PUT /ratings`; `/why` reason codes each flip off when their input is removed (no active chip → no `chip`, no gap →
  no `fills_gap`, rating cleared → no `liked`). No real credential needed (test tokens only).
- `python3 check.py` (test.html asserts): `rankSlot` with `ratings` puts 👍 before neutral before 👎, is a pure
  reorder (same set, same length), a `never` meal is absent from `generatePlan` output over many runs until un-flagged,
  and with empty ratings output is identical to today's; `MP.Ratings.merge` keeps the newest `at` per meal.
- UI (`python3 check.py ui` plus a driven run via `tools/browser-check`, fresh profile, sync stubbed): rate 👍 with a
  note, flip to 👎, clear; toggle Never again and Undo; badge shows on the card; PC and 390 px, dark and light.

## Tasks

### Logic (TDD)
- [ ] `worker_test.mjs` asserts, then `putMealRating`, `GET /ratings`, `why` + shared `rankingReasons`, allowlist
- [ ] test.html asserts, then `ratings.js` and the `rankSlot` layer + `never` filter; thread `opts.ratings` through
      `plan.js` and the Worker's `ranking`
- [ ] `hermes-sync.js` `fetchRatings`, `pushRating`

### UI (ui-build skill)
- [ ] Rating row in the detail sheet (👍 👎, note field, Never again + Undo), card badge, "ranked up: you liked this" hint
      on plan slots the layer moved
- [ ] Bump `sw.js` `CACHE`, add `ratings.js` to the cache list
