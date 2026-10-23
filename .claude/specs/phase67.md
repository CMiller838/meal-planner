# Phase 67: Batch-cycle design [M]
Plain: The planner now picks two or three batch cooks for the fortnight up front and puts the leftover days on your busy days, so a heavy week is covered by a cook the day before instead of a weekend-only batch.

Requires: Phase 59 (freezer spares) and Phase 66 (`locked`, `filled` seeding) are built. No unbuilt dependency.

## Decisions

No open gate; every fork had a clear answer from the invariants.

- **Own call: cook days are chosen first, by a pure helper, then the existing run loop places them.** New
  `batchRuns(startDate, busyDays, freeDays)` returns the list of day-runs the loop iterates today as `runs`. Placement
  (`pickMeal`, `place`, `spares`, freezing, locks) is untouched; nutrition still decides the meal and `rankSlot` has a zero
  diff.
- **Own call: with no busy days the result equals today's `weekendRuns` runs.** Weekend runs (Fri/Sat/Sun, after the existing
  "start at first non-busy day" rotation) stay the base. A plan with no `busyDays` is byte-identical to today's.
- **Own call: extra runs are added for busy clusters the weekend runs don't cover.** A busy cluster = consecutive days in
  `busyDays`. If none of its days fall in an existing run, add a run whose cook day is the nearest non-busy day before the
  cluster (prefer a `freeDays` day within 2 days before; none before, e.g. the cluster starts on day 1: no run), length
  `min(cluster length + 1, 3)` (3 = `cooked_leftovers.fridgeDays`). Total runs capped at 3 per fortnight; when over, keep the
  weekend runs first, then larger clusters, ties earliest. Runs are returned sorted by cook day.
- **Own call: gym days dropped.** The roadmap mentions gym days, but the generator has no gym input (Phase 35's `gym=1` is
  a per-call nutrition uplift, not a plan pref). Only `busyDays` and `freeDays` exist, so only they drive the cycle. Stated
  here so nobody looks for it.
- **Own call: no new setting, UI, route or KV key.** `mp_planPrefs` keeps its shape; the Worker's `/plan/draft` and the
  one-tap Generate pick the change up because both call `generatePlan`. `noBatch` still cooks no runs.

## Files touched

- `generator.js` (new `batchRuns`, exported on `MP.Generator`; `generatePlan` uses it in place of the inline `runs` map). It
  already has the `window` → `root` shim and the Worker imports it: add no bare `window.` reference.
- `test.html` (assertions below)
- `sw.js` (bump `CACHE`; `generator.js` is cached)

New file names: none. No new dependency, route or KV key. `CLAUDE.md` invariants are unaffected (`rankSlot`,
`mp_planPrefs` and the batch/leftover primitive are not changed).

## Signatures

```
MP.Generator.batchRuns(startDate, busyDays, freeDays) -> number[][]   // runs of consecutive day numbers, sorted, max 3
generatePlan(...)  // unchanged signature
```

## Edge cases

- `busyDays` empty or absent: runs equal today's (rotated) weekend runs.
- Cluster already touched by a weekend run: no extra run for it.
- Cluster at day 1 (no day before): no extra run; those days fall to the quick fill as today.
- Cluster at the end (day 14): run is clipped to day 14; a run shorter than 2 is skipped by the existing `run.length < 2` rule.
- More than 3 candidate runs: cap at 3 by the rule above.
- Locked days: the existing "coverage stops at a locked day" slice and `filled` still apply to the new runs.
- No batch meal fits a run: the run is skipped as today (`!parent`), days go to the quick fill.
- Frozen spares (Phase 59) still land at `cookDay + 5` or later, so a late extra run's spares are dropped when no day fits.
- `ponytail:` comment on `batchRuns`: greedy cluster choice, no look at which meals exist; upgrade path is scoring candidate
  cook days by the portions they would cover.

## Verification

- `python3 check.py` (data_check including the `sw.js` cache bump, `test.html` assertions, pages at PC and phone in both themes)
- `python3 tools/spec_lint.py phase67`
- Assertions to add to `test.html`:
  - `batchRuns(Monday, [], [])` deep-equals `weekendRuns(Monday)`; and a full `generatePlan` with no busy days equals the plan
    from before the change over the same seeds (compare to the Phase 59 fixtures).
  - `batchRuns(Monday, [2,3], [])` returns a run starting day 1 or the nearest earlier free day: cook day is never busy; day
    1 cluster returns no extra run; never more than 3 runs.
  - For startDates across a full week × busy sets `[]`, `[3,4]`, `[2,3,9,10]`: every batch parent (isBatch, not `frozenFrom`)
    has its leftover slots on cook day + 1..2 only, and any spare portion is a `frozenFrom` slot at least 5 days later.
  - Busy days that are in a cluster get a leftover (or batch) dinner, not a fresh quick pick, when a batch meal exists.
  - A locked dinner inside a new run stops its coverage (Phase 66 rule still holds).
- No Worker harness change needed: `/plan/draft` calls `generatePlan`; run `node tools/worker_test.mjs` once to confirm still green.

## Tasks

### Logic (TDD)
- [ ] Write the `test.html` assertions above (failing first).
- [ ] Add `batchRuns` and export it; replace the inline `runs` map in `generatePlan`.
- [ ] Run `test.html` via `python3 check.py ui`, then `python3 check.py` and `node tools/worker_test.mjs`.

### UI
- [ ] None (no UI surface changes). Bump `CACHE` in `sw.js`.
