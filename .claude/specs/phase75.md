# Phase 75: Tomorrow lock-in on Today [M]
Plain: the Today card on the plan page shows tomorrow's dinner with three better-ranked alternatives you can pick in one tap, and a "Keep" button that locks it.

Requires: Phase 66 (locks, `slot.locked`, `toggleLock`) done. Phase 54 is the Worker `GET /day` route; the app's Today screen is `#today-card` in `plan.html` (`renderTodayCard`, `plan.js`), which does not read `/day`, so no dependency on it. Independent of Phases 69-71 (reuses `candidatesFor`, which Phase 69 leaves untouched).

## Decisions

All own calls; no open gate.

- **Dinner only (own call).** The roadmap says "tomorrow's meal" and the assistant owns tonight's cook-or-skip, so this is the cook decision with a lead time. Breakfast/lunch/snack choices stay in Phase 60's screens.
- **Reuse, don't re-rank.** Alternatives are the first 3 of `candidatesFor(tomorrowDay, "dinner")` (`plan.js`), the same ranked order the swap deck walks. No second ranking, `generator.js` zero diff, no Worker change.
- **Pick = `setSlotMeal`** (`plan.js`): it already sets `{ mealId, locked: true }` and saves via the `guidedActive` gate. So picking an alternative also keeps it, and only tomorrow's slot changes. "Keep" = `toggleLock(day, "dinner")` (locks the batch chain days too, as today).
- **Exclusions re-checked at pick time (roadmap Verify):** `rankSlot` already drops `never` and hard-term meals, but the pick handler also runs `MP.Exclusions.check(MP.effectiveMeal(meal), MP.Sync.hardTerms())` and refuses with a toast when it fails. Belt and braces, no relaxing.
- **No alternatives when the swap would break a chain:** tomorrow's dinner is a leftover (`em.leftoverOf`, same guard as `plan.js` ~l.692), a batch parent (`MP.isBatch`), eaten (`eatenAt`), or empty. The card then shows the meal name plus a one-line reason ("Leftovers", "Batch cook: change it in the day view") and, for a locked-able meal, only Keep.
- **Locked tomorrow:** shows "Kept 🔒"; alternatives still show (a pick replaces it and stays locked). The old meal reappears as a candidate, so a mis-tap is one tap to undo. No separate undo stack.
- **Tomorrow outside the plan** (`planDayOf` returns null, e.g. today is day 14 or the plan is stale): the card is omitted. No Telegram push, no new route, KV key or setting.

## Files touched

- `plan.js`: `renderTomorrowCard()` (called from `renderTodayCard`'s end and after `renderPlan`), `pickTomorrow(day, mealId)`; reuse `planDayOf`, `candidatesFor`, `setSlotMeal`, `toggleLock`, `effectiveMealAt`, `toast`, `esc`
- `plan.html`: a `<div id="tomorrow-card">` under `#today-card` (line ~49)
- `style.css`: `.tomorrow-card`, `.tomorrow-alt` chips/buttons using existing tokens, both themes, 390 px, reduced-motion = no animation (follow `ui-build`, `docs/UI_STYLE.md`)
- `sw.js` (bump `CACHE`), `tools/browser-check/walk.mjs` (new case), `docs/roadmap.md` (mark done with what was verified)
- No new file, dependency, route or KV key; plan.js is browser-only so no `window` shim concern. `generator.js`, `worker/` zero diff.

## Signatures

```
plan.js: renderTomorrowCard()  // reads plan, planDayOf(plan.startDate, tomorrowIso, plan.days.length)
         pickTomorrow(day, mealId) -> boolean  // exclusions check, setSlotMeal, renderPlan + renderTomorrowCard
```

## Edge cases

- Today is the last plan day, or no plan exists: no card, no error.
- Tomorrow's dinner empty: no card.
- Fewer than 3 candidates: show what exists; none: show the meal and Keep only.
- Candidate fails the exclusion re-check: toast "Excluded: <reason>", slot unchanged.
- Meal name/ingredients come from TheMealDB: `esc()` / `textContent` only.
- Pick while `guidedActive`: `setSlotMeal` skips `savePlan` as designed; the card is not shown during the walkthrough.
- Date uses local `toLocaleDateString("en-CA")`, like the Today card, +1 day via local `Date` (DST-safe: `setDate(getDate()+1)`).

## Verification

- `python3 check.py` (data_check with the `sw.js` bump, `test.html`, pages at PC and phone in both themes, ui walk)
- `python3 tools/spec_lint.py phase75`
- Browser walk (`tools/browser-check`, fresh profile, seeded plan with start date = today, PC and 390 px, dark and light): the card shows tomorrow's dinner and 3 alternatives equal to the first 3 of `candidatesFor`; tapping one changes only day+1's dinner in `mp_plan` and sets `locked`; Keep sets `locked` without changing `mealId`; a seeded plan whose tomorrow dinner is a leftover shows no alternatives; a plan starting 14 days ago shows no card.
- Bad input: a candidate made to fail `MP.Exclusions.check` is refused and `mp_plan` is unchanged.
- No real credential needed.

## Tasks

Logic (TDD):
- [x] `pickTomorrow` with exclusion re-check; `renderTomorrowCard` guards (leftover, batch parent, eaten, empty, outside plan)
- [x] Test (walk.mjs): alternatives match `candidatesFor` order; pick changes only tomorrow; excluded pick refused

UI (follow `ui-build`, `docs/UI_STYLE.md`):
- [x] Card markup, Keep button, 3 alternative buttons; both themes at PC and 390 px
- [x] Bump `CACHE` in `sw.js`; mark Phase 75 done in `docs/roadmap.md`
- [ ] Live: on the phone PWA, open Plan tonight and swap tomorrow's dinner in one tap; Keep it and confirm the lock shows in the day view
