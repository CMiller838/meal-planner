# Phase 37: Per-day effort hints from the assistant [M]

Requires Phase 32 (assistant token, done). Assistant side: `notion_assistant` Phase 52. A hint is a **reorder** of
`rankByGap`'s output (same layer as the busy chip), never a re-score, never a filter. Nothing is locked.

## Decisions (all own calls, nothing was a toss-up)

- **Separate KV key `dayHints`, not a field inside the plan.** The roadmap said "in the plan if it already syncs". It does,
  but the app *overwrites* `/plan` on every push, so an assistant write into it would be clobbered (and `PUT /plan` is not
  in `ASSISTANT_ALLOWED`). `dayHints` is assistant-written, app-read-only. Not `planPrefs` either: that is the user's
  settings (CLAUDE.md invariant), keyed by day number 1-14, and Hermes-synced; hints are keyed by calendar date.
- **Keyed by ISO date**, so a hint survives plan regeneration and "past days ignored" is a plain date compare.
- **Shape:** `{ updatedAt, days: { "YYYY-MM-DD": { effort: "busy"|"normal"|"free", why?: string } } }`.
- **Expiry:** no cleanup job. `resolve` drops dates before today and dates outside the plan; the Worker PUT rejects >28 dates
  so the blob cannot grow. The assistant rewrites the whole blob each sync.
- **Merge with user prefs:** effective busy days = `planPrefs.busyDays` ∪ busy hints. `free` hint: dinner/lunch prefer
  `batch` effort (existing `opts.prefer` mechanism's reorder, applied via a `freeDays` list). `normal`: no effect.
  A user-set busy day always wins over a `free` hint.
- **Override:** each hint shows as a chip on the day header with its `why` ("Busy · 2 lectures + gym"). Tap = dismiss for
  that hint version: `mp_dayHintOff` = `{ date: hintUpdatedAt }` in localStorage; a newer `updatedAt` revives it.
  Local only, never pushed, no new Worker route.
- **`demoteEffort` is unused in code** (only `preferEffort` is read in `generator.js`). Not adding it: busy = prefer quick,
  as today. Roadmap wording was loose; no behaviour change implied.
- No new dependency. `why` is assistant text: render with `textContent` only.

## Files touched

- `day-hints.js` (new; checked, no clash) with the `window`→`root` shim: `MP.DayHints`.
- `generator.js`: `rankSlot` reads `prefs.freeDays`; ~4 lines beside the busy reorder. No other change.
- `worker/worker.js`: `KEYS["/dayHints"]="dayHints"`, `ASSISTANT_ALLOWED` += `GET /dayHints`, `PUT /dayHints`,
  `dayHintsError` in the validators map, `ranking()` resolves hints into `prefs` and returns `hint` in its reply.
- `hermes-sync.js`: `fetchDayHints()` (GET, failure-silent, returns `null`). `plan.js`: fetch once at init next to prefs,
  merge via `MP.DayHints.merge`, render the chip. `plan.html`, `test.html`, `sw.js` (SHELL entry + `CACHE` bump).
- `docs/ARCHITECTURE.md` / CLAUDE.md: one line each for the new key (assistant-written, read-only in the app).

## Signatures

```
MP.DayHints.resolve(hints, startDate, todayIso, off)
  -> { busyDays: number[], freeDays: number[], byDay: { [n]: { effort, why } } }   // day numbers 1-14
MP.DayHints.merge(prefs, resolved) -> prefs'   // busyDays union; freeDays minus user-busy; vocab/chips untouched
MP.DayHints.dismiss(date, updatedAt) / MP.DayHints.offMap()
dayHintsError(parsed) -> string|null   // worker
```

## Edge cases

- No hints / `null` / malformed blob / Worker unreachable: today's behaviour exactly (zero effect).
- Hint date before today, or outside the 14-day plan, or `normal`: ignored. Unknown `effort`: Worker 400; client ignores.
- Same date in `busyDays` and a `free` hint: busy wins. Dismissed hint: ignored until `updatedAt` changes.
- Weekend-run batch rotation (`generator.js` ~268) keeps reading only user `busyDays`; hint-busy days feed it through the
  merged `prefs.busyDays`, which is intended (a busy Friday pushes the cook day on).
- `why` > 80 chars: Worker 400. HTML in `why` shows as text.

## Verification

- Node harness (no server): `resolve` drops past/out-of-range/dismissed, maps dates to day numbers; `merge` precedence.
- Same pool, `busy` day vs not: quick meals first on the busy day; the set of meals and relative nutrient order inside each
  effort group is unchanged (compare to `rankByGap` output). `free` day: batch first. Past-dated hint: identical to no hint.
- Worker: assistant token GET/PUT `/dayHints` 200; bad effort / >28 dates / long `why` 400; other write routes still 403;
  `/ranking` marks the day busy and returns the hint reason.
- UI (`ui-build`): chip with `why` on PC and 390 px, both themes; tap dismisses; bad input (`<b>` in `why`) shows as text.
- `python3 check.py`.

## Tasks

### Logic (TDD)
- [ ] `day-hints.js`: `resolve`, `merge`, `dismiss`/`offMap` + `test.html` assertions
- [ ] `generator.js`: `prefs.freeDays` → batch-first reorder; assertion that the nutrient order within groups is unchanged
- [ ] Worker: key, allowlist, `dayHintsError`, `ranking()` integration; Node harness checks
- [ ] `hermes-sync.js` `fetchDayHints()`; `plan.js` fetch + merge at init
### UI
- [ ] Day-header hint chip with `why`, tap to dismiss, via `ui-build`
- [ ] Bump `sw.js` `CACHE` and add `day-hints.js` to SHELL; add to `plan.html`/`test.html`; ARCHITECTURE/CLAUDE.md lines
- [ ] `python3 check.py`; roadmap heading `— done` with what was verified
- [ ] `- [ ] Live:` line in `tasks.md`: assistant sends a busy hint for tomorrow, chip shows on the phone PWA
