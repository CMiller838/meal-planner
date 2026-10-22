# Phase 54: Day route: one read-only source for the Today screen [M]

Plain: The app's Today card and the assistant's Today view can read the same one-call summary of your day (meals, routine items, water/caffeine, expiring food, leftovers, coverage), so they never disagree.

Requires Phase 41 (built: KV `today`, `MP.Today`), Phase 34 (built: `ShelfLife.expiringItems`), Phase 35 (built: `withGymDay`, `eatenDayCoverage`). Phase 43 (leftovers) is **unbuilt**: fallback below. Roadmap's old Phases 44/45/46 were merged into 43/41/35.

## Decisions
- **Route is `GET /day`, not `/today`** (user-chosen). `/today` is Phase 41's raw counters record (`{date,water,caffeine,gym,routineDone}`) that the app syncs through; it stays untouched.
- **No cook-or-skip state** (user-chosen). The roadmap's field has no source in the data; the phase stays read-only. A meal's state is `planned` or `eaten` (slot `eatenAt`); there is no `cooked` state because slots carry none.
- Flat list of typed cards (own call, as the roadmap suggests): `{ type, ... }` in a fixed order, so each side renders what it wants.
- Reuse, don't re-implement (own call): meals + coverage come from the same code `GET /nutrition?date=` runs (extract its day branch into one helper both routes call); expiring from `ShelfLife.expiringItems`; routines from `MP.Today.dueRoutines` (needs the shim check below); leftovers from Phase 43's `ShelfLife.leftoverView`.
- **Leftovers fallback** (own call): until Phase 43 builds `leftoverView` / KV `cooks`, `leftovers` is `[]`. Guard with `typeof ShelfLife.leftoverView === "function"` and an absent/malformed `cooks` key → empty, so the route works before and after 43.
- Freshness (own call): response carries `assembledAt` (ISO now) and `date`. KV is eventually consistent; no server cache.
- `date` defaults to today in Europe/London (same as `/nutrition`); `gym=1` applies `withGymDay`; if KV `today.date` differs from `date`, counters are zero and routines all undone (a day with no taps is zero, not missing).
- Both tokens may call it (add `"GET /day"` to `ASSISTANT_ALLOWED`); read-only, no new KV key.

## Files touched
`worker/worker.js` (route, `ASSISTANT_ALLOWED`, extracted day helper), `today.js` or wherever `MP.Today` lives only if its `dueRoutines` needs the `window`→`root` shim (CLAUDE.md invariant), `tools/worker_test.mjs`, `docs/ARCHITECTURE.md` (one route line). No app UI change, so no `sw.js` bump unless a cached file changes (if `MP.Today` is edited, bump `CACHE`).

## Signatures / schemas
```
GET /day?date=YYYY-MM-DD&gym=1   -> 200
{ date, assembledAt, gym: bool,
  cards: [
    { type: "meal", slot, mealId, name, state: "planned" | "eaten", eatenAt? },
    { type: "routine", mealId, name, done: bool },
    { type: "counter", counter: "water" | "caffeine", count },
    { type: "expiring", name, useBy, basis, daysLeft },
    { type: "leftover", id, mealId, name, portionsLeft, storage, eatBy, daysLeft, lastDay },
    { type: "coverage", proteinGramsApprox, proteinTarget, missing, partial }
  ] }
```
Meal cards: planned slots from the `plan` mirror for that date plus eaten-log entries for that date (as `/nutrition` does). Expiring window: 2 days (as `/expiring` default), overdue included. 400 on bad `date` or `gym`.

## Edge cases
- Empty day, empty KV (`plan`, `pantry`, `today`, `eatenLog`, `cooks` null/malformed) → 200, no meal/routine/expiring/leftover cards; counter cards with count 0; coverage card still present. Never 500.
- Date outside the plan's two weeks → no planned meals, eaten entries still listed.
- Routine item deleted from the library but still in `routineDone` → ignored.
- Assistant token on `PUT /day` → 405/403 (route is GET-only); other assistant paths unchanged.

## Verification
- `node tools/worker_test.mjs`: seeded KV day returns the expected card types in order; a meal logged via `PUT /eaten-log` shows as `eaten`; empty KV → 200 with zero counters and no meal cards; bad `date`/`gym` → 400; both tokens 200, no token 401; `/day` coverage numbers equal `/nutrition?date=` on the same fixture; `/today` round trip unchanged.
- `python3 check.py` passes. No real credential needed (test fakes only).

## Tasks
### Logic (TDD)
- [ ] Extract `/nutrition`'s day branch into one helper; `/nutrition` output unchanged (existing worker_test cases still pass)
- [ ] `dayCards(...)` assembling the cards above; leftovers guarded for Phase 43
- [ ] Worker `GET /day` + `ASSISTANT_ALLOWED`; worker_test cases above
- [ ] Confirm `MP.Today.dueRoutines` is Worker-importable (root shim, no bare `window.`); fix if not
### Docs
- [ ] ARCHITECTURE.md route line; mark roadmap phase done on commit
- [ ] Live: ask the assistant for its Today view after logging a meal in the app and check they match (needs `notion_assistant` Phase 85)
