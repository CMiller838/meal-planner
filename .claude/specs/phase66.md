# Phase 66: Lock and fill [M]
Plain: pin a meal you want to keep (the Sunday batch, a favourite lunch) and regenerate or reroll one day without losing it; the rest fills in around it.

Requires: Phase 24 (guided walkthrough, `guidedActive`) done; Phase 49 (`/plan/draft`) done. Needed first by Phases 75 and 78.

## Decisions

All own calls except where marked; no open gate (each fork had a clear answer from the invariants).

- **A lock is a flag on the slot**: `slot.locked = true` beside `mealId`/`variantId`/`subs`/`eatenAt`. Not in `mp_planPrefs`
  (settings, never plan state) and not a new KV key. The generator never writes it; only the user does.
- **Eaten slots (`eatenAt`) count as locked for every regenerate and reroll.** Today `regenerate()` replaces the whole plan
  and loses them; the Worker's `/plan/draft` already keeps them. They show no lock icon and cannot be unlocked.
- **The generator fills around locks, not afterwards.** `generatePlan` gains one trailing arg `locked` (same shape as
  `days[].slots`, `{ [day]: { [slotType]: slot } }`). Locked slots are pre-placed (their cost, `halfKeys`, `lastUsedDay`
  count), then dinners, batch runs and other slots fill the rest. Nutrition ranking is untouched (`rankSlot` has zero diff).
- **A leftover chain is one unit.** Locking, unlocking or rerolling any dinner in a batch chain acts on all its days (parent
  plus leftover days). Half a chain re-rolled is a broken plan (CLAUDE.md batch primitive). A toast says "Locked 3 days
  (batch chain)". Chain = consecutive dinner slots from a `MP.isBatch` meal whose later slots are its `leadsTo` child
  (`leftoverOf === parent.id`) or the same meal, mirroring the generator's own run-building.
- **A manual swap keeps the lock** (you chose that meal for that slot); a variant change never touches it.
- **Reroll day = `generatePlan` with every other slot passed as `locked`**, then copy only that day back. Neighbours and
  budget therefore shape the reroll with no second implementation.
- **Generate and the Hermes request keep locks.** The confirm text becomes "Regenerate the unlocked meals? N locked meals are
  kept." An "Unlock all" button, shown only while locks exist, is the way out. `hermes-generate` calls the same
  `regenerate()`, so it keeps them too.
- **Worker `/plan/draft` seeds locks too**: mirror slots that are `locked`, eaten, in `keep`, or on a day outside `days` are
  passed as `locked`, so the draft fills around them. The existing post-merge copy stays as a safety net.

## Files touched

- `generator.js` (`generatePlan` trailing `locked` arg; seed pass; coverage stops at a locked day; no `rankSlot` change)
- `data.js` (`MP.chainDays(planDays, mealsById, day)`; already has the `window`→`root` shim, the Worker imports it)
- `plan.js` (`regenerate`, `rerollDay`, `setSlotMeal` keeps `locked`, `toggleLock`, lock icon, Reroll and Unlock all buttons)
- `plan.html` (toolbar "Unlock all"), `style.css` (lock icon, reroll button, both themes)
- `hermes-sync.js` (`planMirror` must carry `locked`; it currently strips unknown slot fields)
- `worker/worker.js` (`draftPlan` builds and passes `locked`)
- `test.html` (assertions), `tools/worker_test.mjs` (draft honours a locked slot), `sw.js` (bump `CACHE`)
- `docs/HERMES.md` (one line: `/plan/draft` fills around locked slots; the mirror may carry `locked`)

New file names: none. No new dependency, route or KV key.

## Signatures

```
generatePlan(library, tags, targets, shelfData, startDate, budget, have, prefs, ratings, locked)
  // locked: { [day:1-14]: { [slotType]: { mealId, variantId?, subs?, locked?, eatenAt? } } } | undefined
  // returns the usual plan; locked slots appear unchanged, byte for byte
MP.chainDays(days, mealsById, day) -> number[]   // [day] when not in a chain; sorted ascending
plan.js: rerollDay(day), toggleLock(day, slotType), unlockAll(), lockedMap(exceptDay?)
```

## Edge cases

- Everything locked: generate is a no-op that keeps the plan (toast "Nothing to fill").
- Locked meal later excluded (a new allergy, a `never` rating): it is kept and the existing exclusion warning shows; the
  user unlocks or swaps. The generator never places an excluded meal itself.
- Locked dinner inside what would be a batch run: the run's coverage stops at the first locked or eaten day; later days fall
  to the quick fill. Locking a batch parent also locks its chain (above), so this only arises from a hand-built plan.
- Recency: a locked meal on day d+1 is excluded from day d's pick (as day d-1 already is), so it is not repeated back to back.
- Empty slot (`mealId: null`) cannot be locked (no lock control shown).
- Guided walkthrough (`guidedActive`): locking, rerolling and setting a slot are all unsaved until "Looks good", like swaps.
- Old plans without `locked` behave exactly as today. Mirror: `planMirror` adds `locked: true` only when set.
- Reroll on a day with no unlocked slot: toast "All meals on this day are locked".
- `ponytail:` comment in the generator: lock-aware recency only looks one day ahead; a locked meal 3 days later can still repeat
  nearby. Upgrade path is a window, not worth it until it is noticed.

## Verification

- `python3 check.py` (data_check including the `sw.js` cache bump, `test.html` assertions, pages at PC and phone in both themes)
- `node tools/worker_test.mjs` (a locked slot survives `/plan/draft` and the draft fills the rest)
- `python3 tools/spec_lint.py phase66`
- Assertions to add to `test.html`: a plan with 3 locked slots regenerates with those slots identical and the others
  changed at least once over 5 seeds; `rerollDay(5)` leaves days 1-4 and 6-14 identical; locking a batch parent locks its
  leftover days; `generatePlan` with `locked` undefined equals today's output (same seeds); an excluded meal never appears
  in a filled slot; `planMirror` carries `locked`.
- Browser walk (`tools/browser-check`, fresh profile): lock a slot, Generate, it stays; Reroll a day, the other days do not
  move; Unlock all; phone width and both themes.

## Tasks

Logic (TDD):
- [ ] `MP.chainDays` in `data.js` + tests (chain, non-chain, edge of the plan)
- [ ] `generatePlan` `locked` arg: seed pass (cost, `halfKeys`, `lastUsedDay`), skip seeded slots in run/quick/other fills, stop run coverage at a locked day, next-day exclusion; undefined `locked` is byte-identical to today
- [ ] `planMirror` carries `locked`; `setSlotMeal` keeps it
- [ ] `plan.js`: `lockedMap`, `regenerate` passes locks (eaten implicit), `rerollDay`, `toggleLock` (chain-wide), `unlockAll`
- [ ] Worker `draftPlan` builds `locked` from mirror + `keep` + days outside `days`; `worker_test.mjs` case

UI (follow `ui-build`, `docs/UI_STYLE.md`):
- [ ] Lock icon on `.slot-card`; Lock/Unlock in the day sheet's action row; Reroll button on each `.day-row` heading
- [ ] Toolbar "Unlock all" (hidden when no locks); Generate confirm text with the locked count
- [ ] Lock-in animation (short, `prefers-reduced-motion` respected); both themes at PC and 390 px
- [ ] Bump `CACHE` in `sw.js`; mark Phase 66 done in `docs/roadmap.md` with what was verified

Human-only checks go in `tasks.md` as `- [ ] Live:` lines (below).
