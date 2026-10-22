# Setup suggestions: speeding up the build pipeline

Written 2026-10-22. Goal: cut phase build time without raising token spend much. Nothing below is applied yet; the
"Status" column is updated as each is done, so the next `/overnight` can be compared against these numbers.

## What was measured (builder sessions only, `logs/pipeline-*.json`)

| Phase | Wall | API time | Turns |
|---|---|---|---|
| 35 | 247s | 162s | 25 |
| 33a | 251s | 190s | 23 |
| 33b | 332s | 236s | 24 |
| 40 | 382s | 282s | 35 |
| 36 | 504s | 164s | 21 |
| 37 | 573s | 328s | 34 |
| 34 (UI stage) | 667s | 170s | 24 |

Phase 34 stage 1 and phase 41 report a wall time shorter than API time, so they are ignored as unreliable. Phase 36
end to end: build started about 12:56, committed 13:02, self-improve commit 13:04.

30 to 75% of each session is not model time. Per-step timing is not recorded, so the split is unknown. The tester
agent's own model time may not be counted in `duration_api_ms` (unconfirmed).

## Where the time probably goes (from reading the scripts, not timed)

- `check.py` runs its checks strictly one after another (`check.py:118`).
- It runs up to 3 times per phase: the builder's `runner`, the tester, and the pre-commit hook. The Stop hook adds
  `--changed` runs.
- `ui-check.mjs` loads 6 pages x 2 viewports x 2 themes = 24 times in sequence, each with a fixed 700 ms sleep.
- The deploy does not block: the post-commit hook runs it with `nohup ... &`.
- Every stage starts a cold session and re-reads the spec and code.
- Self-improve adds about 2 minutes, only when the builder reports an improvement.

## Options, evaluation and recommendation

| # | Option | Time saved | Token effect | Risk | Recommendation | Status |
|---|---|---|---|---|---|---|
| 0 | Log start/end time per stage to `logs/stage-times.tsv` in `pipeline.sh` | none directly, but shows what to fix | 0 | none | Do first | APPLIED 2026-10-22: `logs/stage-times.tsv` (wall s per stage) and `logs/check-times.tsv` (s per check) |
| 1 | Run `check.py` checks in parallel (`ThreadPoolExecutor`, stdlib, cap 4 workers) | total becomes the slowest check, not the sum | 0 | low: both browser checks bind free ports (`listen(0)`), box has 12 cores and 15 GB; print results in order; watch fixed waits for flakiness | Do | APPLIED 2026-10-22 (`CHECK_JOBS=1` = serial) |
| 2 | Run the 4 viewport/theme contexts in `ui-check.mjs` with `Promise.all` | about 15 s per run | 0 | low | Do (small gain once #1 is in) | APPLIED 2026-10-22: `ui pages` 12.8 s to 5.4 s |
| 3 | Skip a repeat `check.py` run when the tree is unchanged since the last green run (hash stamp) | removes 1 to 2 full runs per phase | negative (smaller runner reports) | medium | Do after #1, with the safeguards below, if still worthwhile | not applied |
| 4 | Move self-improve off the critical path | about 2 min, only on phases with an edit | 0 | high: needs a clean tree, edits `.claude/` while the next phase builds | Skip (or batch at queue end) | not applied |
| 5 | Phases in parallel in separate worktrees | large for independent phases | same per phase; usage-limit bursts more likely | high: breaks "one phase, one commit" and the single `sw.js`/deploy writer | Skip: phases are only 5 to 10 min | not applied |
| 6 | Faster tester (narrower scope, faster model) | possibly the biggest, unmeasured | saves tokens; a weaker tester risks quality | medium | Decide after #0 shows the tester's share | not applied |

Before committing any of this, run `tools/test_guard.py`: it blocks staged diffs that loosen test files. Parallelising
`ui-check.mjs` should not count as loosening, but check.

## Ways to reduce the risk of #3 to #6

**#3 skip repeat runs**
- Write the stamp only after a fully green, full run (exit 0, not `--changed`).
- Hash `git ls-files -s`, every untracked non-ignored file and `check.py` itself, so editing the checker invalidates it.
- Only the builder's `runner` and the tester may honour the stamp. The pre-commit hook always runs the full suite.
- `secrets` and `test guard` always run (they depend on the staged diff).
- Add a `--no-stamp` flag and a selftest that a one-byte change invalidates the stamp.

**#4 self-improve off the critical path**
- Use the existing "propose a patch, don't apply" path (`pipeline.sh:206`) by default.
- Run the evaluator in a detached `git worktree` at the commit it reviews, so it never needs a clean main tree.
- Apply patches only at queue end or between phases; `git apply --check` must reject any path outside `SI_FORBIDDEN`'s allowlist.
- Alternative: batch all `SELF-IMPROVE` lines into one session at queue end (fewer cold starts, fewer tokens).

**#5 phases in parallel**
- Parallelise only phases whose specs declare disjoint file lists; `pipeline.sh --plan` prints the overlap and refuses otherwise.
- Each phase builds in its own worktree. One serial integrator rebases onto main, bumps `sw.js` `CACHE` once, ticks
  `roadmap.md` and `tasks.md`, runs the full `check.py`, makes one commit per phase and deploys.
- Cap concurrency at 2 and share the usage-limit backoff (`pipeline.sh:139`).
- Prove it on two small, known-independent phases before using it on the real queue.

**#6 faster tester**
- Keep the model. Cut scope to the changed-file list (already passed) and have it use the parallel `check.py`.
- Test any model swap on past phases with a seeded defect; keep it only if the defect is still caught.
  `tools/tester_evidence.py` already blocks a PASS with no checks run.
- Add a per-stage time cap lower than the current 10800 s.

## Plan

1. Apply #0, #1, #2 once phase39 has finished (the working tree is shared with the running build; `check.py` is a CORE module).
2. Time `check.py` before and after.
3. Run another `/overnight`, then compare stage times against the table above.
4. Decide #3 and #6 from that data. Leave #4 and #5 unless the queue gets much longer.

## Result of applying #0 to #2 (2026-10-22, uncommitted)

Per-check timing (new `logs/check-times.tsv`) showed the real bottleneck was not what the scripts suggested:
`ui walk` took 65 s of a 81 s `check.py` run. Per-step timing in `walk.mjs` pinned it on one line: the optional
`page.click('[data-useby="bread"]').catch(() => {})` waited Playwright's default 30 s click timeout, twice (PC and
phone). Capping it at `{ timeout: 1000 }` (no assertion changed) fixed it.

| `check.py` full run | Time |
|---|---|
| original, serial | 80.7 s |
| parallel only | 65.3 s |
| parallel + walk fix + ui-check combos in parallel | 7.8 s |

Since `check.py` runs up to 3 times per phase, that is roughly 3.5 minutes saved per phase. Files changed: `check.py`,
`tools/browser-check/ui-check.mjs`, `tools/browser-check/walk.mjs` (step timing + the 1 s cap), `tools/pipeline.sh`.
Not yet committed. #3 (skip repeat runs) is now probably not worth its risk: a full run is 8 s.

Gotcha found: `pipeline.sh`'s `park` step (a blocked phase) archives and deletes ALL untracked files, not just the
phase's. This file was swept into `logs/blocked-phase39-*.tar` and had to be restored. Keep notes committed or in
a tracked path before queuing an overnight run.
