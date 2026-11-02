# Phase 118a: Plan with me wizard [M]
Plain: Plan with me becomes a phone-first step-by-step setup (start date, nights, busy weekdays, budget, preferences, review) that hands you to the plan.

Requires Phase 110 (no `#first-slot`, no "Also choose"). Phase 114's shell (tabs + docked bar) applies if built; the wizard
keeps both visible. Prototype: `design-prototypes/ui-concepts/planchat-a.html` (picked 2026-11-01), plus a start-date step.
Phase 118 is split: this part builds and tests alone (it hands off to today's `plan.html?guided=1`); Phase 118b changes what
`guided=1` opens. Shared decisions for both live here.

## Decisions
- **User-chosen (Phase 118 gates, 2026-11-01):**
  - After the wizard, the chat walks the generated plan night by night as accept/reject cards, working with the Hermes bridge off (built in 118b).
  - Busy nights are **weekday toggles** (tap Tue = every Tuesday in the plan), stored as night numbers: `mp_planPrefs` shape unchanged.
  - The plan page's "Plan with Hermes" button opens this wizard (118b).
- **Own call:** one page, six `.wiz-step[data-step]` sections shown one at a time: Start, Nights, Busy, Budget, Preferences,
  Review. Progress bar `#wiz-prog`; Back `#wiz-prev` / Next `#wiz-next` row in-flow under the step (not fixed: the "I ate"
  bar must stay on screen, `tools/browser-check/ui-check.mjs` line 86). Back is hidden on step 1; on Review, Next is replaced
  by `#pwm-generate-btn` ("Start planning").
- **Own call: keep existing ids** so code and tests hold: `#start-date`, `#plan-days`, `#busy-grid` (now 7 weekday toggles
  Mon..Sun, `data-weekday` 0-6), `#chip-row`, `#budget-range`, `#budget-label`, `#shop-day`, `#repeat-gap`, `#freeze-batches`,
  `#rolling-plan`, `#notes-section`/`#notes-list`, `#pref-summary`, `#pwm-generate-btn`.
- **Own call:** Start step = `<input type="date">` (min today) + Today/Tomorrow chips + a range line ("Thu 5 Nov to Wed 18 Nov").
  Nights step = −/+ stepper (1-28) + 7/14/21/28 chips, writing `#plan-days` (kept as the value holder).
- **Own call:** Review = summary rows (nights + range, busy, budget, preferences) + `<details>` "More options" (shop day,
  repeats, freezer, rolling) + the read-only standing notes.
- **Own call:** Start planning saves exactly as today (`MP.PlanPrefs.save` with all 7 args, `MP.Sync.pushPlanPrefs()`), with
  `busyDays = busyFromWeekdays(start, days, weekdays)`, then `location.href = "plan.html?guided=1&start=…&days=…&shop=…"`.
- **Own call:** while on the page the weekday set is the source; changing the start date or nights only changes the busy
  nights computed at save. Init pre-presses `weekdaysFromBusy(start, prefs.busyDays)`.
- No ADR: no architectural fork.

## Files touched
- `plan-with-me.html`: wizard markup (steps, progress, Back/Next); keep the nav block and script list (incl. `ate-box.js`).
- `plan-with-me.js`: two pure helpers on `MP.PlanPrefs`; page controller rewritten as a step controller (`get`/`save`/`loadVocab`/`profileBudget` unchanged).
- `style.css`: wizard styles from planchat-a with house tokens (both themes, 390 px).
- `sw.js`: bump `CACHE` (first Logic task).
- `test.html`: helper cases.
- `tools/browser-check/walk.mjs`: wizard steps; the notes step (~line 369) opens Review before waiting on `#notes-list li`.
- `docs/UI_STYLE.md`: wizard component (via `restyle-from-prototype`).

## Signatures
- `MP.PlanPrefs.busyFromWeekdays(startIso, days, weekdays) -> number[]` (`plan-with-me.js`, pure, browser only; the Worker
  does not import this file, no shim). Nights `1..days` whose weekday (`startIso` + n−1, local noon) is in `weekdays`,
  ascending. Consumer: the Start planning handler.
- `MP.PlanPrefs.weekdaysFromBusy(startIso, busyDays) -> number[]` (same file, pure): sorted unique weekdays of the given
  nights. Consumer: page init, to pre-press toggles.

## Edge cases
- No stored prefs: nothing pressed, budget "No target", defaults as today.
- Profile budget lock (`profileBudget() > 0`): slider disabled, label "£N/wk · set in Profile.md", saved value unchanged (as today).
- No `plan-preferences.json` vocab: Preferences step says "No preferences available".
- No `planning.budgetTarget` config: Budget step shows "No target" text, no slider.
- Start cleared → today; past start not selectable (min).
- 1 night (only one weekday can be busy); 28 nights.
- Bad helper input: empty weekdays → `[]`; `days` outside 1..28 clamps; invalid date → treated as today.

## Verification
- `python3 check.py` (timeout 600000): all green.
- `walk.mjs` asserts each of:
  - Next walks all 6 steps (progress bar fills), Back returns one step, Back hidden on step 1;
  - start date = the next Monday, 14 nights, Tue on → Start planning saves `mp_planPrefs.busyDays` `[2,9]`;
  - Start planning lands on `plan.html?guided=1` with `days=14` in the URL;
  - Review shows the standing notes (updated notes step) and More options holds `#shop-day`;
  - PC and 390 px, dark and light, no horizontal scroll (screenshots).
- No real credential needed.

## Tasks
### Logic (TDD)
- [ ] 1. `test.html` cases: Monday start + Tue + 14 → `[2,9]`; Sunday start wraps the week; days 1; empty weekdays → `[]`;
      `weekdaysFromBusy(busyFromWeekdays(...))` round-trips; then implement both in `plan-with-me.js`; bump `sw.js` `CACHE`.
### UI
- [ ] 2. `restyle-from-prototype` from `planchat-a.html` into `plan-with-me.html` + `style.css`: 6 steps incl. the start-date step, house tokens, both themes, 390 px.
- [ ] 3. `plan-with-me.js` step controller: show/hide steps, progress, Back/Next, stepper + chips, weekday toggles, budget, chips, Review summary + More options, Start planning (save + URL).
- [ ] 4. `walk.mjs`: the Verification assertions above (each its own check); update the notes step.
