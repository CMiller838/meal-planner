# Phase 112: Tonight hero and dinner menu board [L]
Plain: the Plan page opens on a big "Tonight" card with the buttons you need, above a 14-night timeline where leftover nights are visibly joined to the night you cook.

Requires Phase 110 (dinners only; specced, unbuilt). Fallback so this builds either way: every render reads `mealAt(day, "dinner")` / `slots.dinner` explicitly, never `SLOT_TYPES`, so extra slots in an old plan are simply not drawn. Prototype picked 2026-11-01: `design-prototypes/ui-concepts/dinner-board-a.html` (hero + timeline; phone-first).

## Decisions
User-chosen: board A (Tonight hero + vertical timeline); phone-first, hero above the timeline, two columns from 900 px.
Own calls:
- **Render swap only, no data change.** `renderPlan` (`plan.js` ~1465) replaces each `.day-row`'s 3-column `.slot-grid` with one timeline card per night. The card keeps the classes/attributes the drag code and `walk.mjs` already rely on: `.day-row[data-day]` wrapper, `.slot-card[data-day][data-slot="dinner"]`, `.day-grip`, `.slot-meal`, `wireMoveBtns` warnings. So `wireDragSwap` (Phase 103, only another caller of `swapSlots`/`swapDays`) and Alt+Arrow are untouched.
- **No new plan state.** Open/closed card, the hero and the chain bars are derived at render. Chain data comes from one pure helper `MP.dinnerChain(plan, byId)` (`data.js`): per day `{ kind: "cook"|"leftover"|null, srcDay, linkNext, orphan }`; a leftover is a slot whose meal has `leftoverOf` (or `fromCook`) with its cook on an earlier day; `orphan` when that cook night is skipped / eating out. Consumer: `renderPlan` (bar + "Leftover of Thu 29 Oct" label). It never edits or ranks.
- **Hero day** = today's plan day (`planDayOf(plan.startDate, today, plan.days.length)`); no start date or today outside the plan: the first night not eaten/skipped, tagged "Next up". All-eaten: no hero.
- **Hero and card actions reuse existing handlers, none reimplemented:** Cook now = `MP.CookMode.open` (as the day view's Recipe/cook button, `plan.js` ~1867); Swap = `openSwapPicker`; Skip = `openSkipSheet`; Eating out = `openOutSheet`; I ate it = `openDoneSheet`; Lock = `toggleLock`; Details = `openDayView` (kept: recipe, variant, ingredients). Cook now is enabled for tonight only (as in the prototype). Reroll / Swap day stay as small card actions.
- **Kept untouched:** `#meter-strip`/`renderMeter`, `renderGapStrip`, `#today-card`, `#tomorrow-card` (Phase 75), per-week "Week N" headings and summary line, the top action buttons (Phase 114 restyles the shell), `renderChatWeek` (its own grid).
- Nutrient chips on the hero/cards are the meal's existing tags (`tagRowHtml`), display-only.
- Staging (`renderPlan(staged)`) animates the timeline cards via the same `.slot-card` animation-delay code, unchanged.
- No new dependency, no new file (CSS in `style.css`, JS in `plan.js`, helper in `data.js`). House style `docs/UI_STYLE.md` (Cork Kitchen tokens; reduced motion respected; 44 px targets).

## Files touched
- `plan.js`: `renderPlan` card markup + new `renderTonight(day)`; `data-act` click delegation on `#plan-root`/hero calling the handlers above; expand/collapse (`aria-expanded`, keyboard Enter/Space on the card header; the header still opens nothing else, `openDayView` is the Details button, so the old whole-card click that opened the day sheet moves to Details).
- `plan.html`: `<section id="tonight" aria-label="Tonight">` above `#plan-root` (inside a `.board` wrapper with `#plan-root`, `#meter-strip`; ensure `ate-box.js` is still loaded).
- `data.js`: `MP.dinnerChain` + export (no `window` use; `data.js` already has the shim).
- `style.css`: `.board`, `.hero`, `.tl`, `.node`, `.lk`, `.tc` (from the prototype, renamed to the file's token names; both themes; 390 px and PC); `sw.js`: `CACHE` bump (task 1).
- `test.html` (dinnerChain cases), `tools/browser-check/walk.mjs` (board interactions). `tools/browser-check/ui-check.mjs` needs no change (plan.html is already a checked page).
- `docs/UI_STYLE.md`: one line for the timeline/hero pattern. `docs/roadmap.md` heading on commit.

## Signatures
- `MP.dinnerChain(plan, byId) -> [{ day, kind, srcDay|null, linkNext: bool, orphan: bool }]` (`data.js`, pure; one entry per `plan.days`).
- `renderTonight(day) -> void` (`plan.js`; writes `#tonight`, called from `renderPlan`). Consumers of its buttons: the existing handlers listed above.

## Edge cases
- Eating-out night: shows the name/"Eating out", no cook/chain, no meal tags. Eaten: badge + "Mark not eaten" is NOT added (no existing un-eat path); eaten cards show Eaten and only Details. Skipped/empty night: "Nothing planned" + Add a meal (`openSwapPicker`).
- Leftover whose cook night was skipped/out: `orphan`, label "No cook: source night skipped", no bar.
- Locked / eaten / batch cards: Swap and Lock follow the existing rules (`cardSkip`, `isHeld`); a refused action shows the existing toast, no new copy.
- Plan with no `startDate`: dates fall back to "Day N" (`dayHeading`).
- 28-day plan (Phase 83): the loop covers `plan.days.length`, week headings every 7 days.
- Past nights are dimmed and still expandable. Reduced motion: no stagger/expand animation.
- Guided review (`guidedActive`) and chat open: hero hidden while `guidedActive` (as `#tomorrow-card`).

## Verification
- `python3 check.py` (timeout 600000) green; `python3 tools/spec_lint.py phase112`.
- `walk.mjs` asserts each of: `#tonight` shows tonight's dinner name with a Cook now button; a plan with a batch + leftover shows `.lk` on the cook night and the leftover card label "Leftover of"; a leftover whose cook is skipped shows "No cook"; clicking a timeline header expands its actions (`aria-expanded` true) and a second click collapses; hero Skip opens the skip sheet, Swap the swap picker, Eating out the out sheet, I ate it the done sheet; Cook now on a non-tonight card is disabled; Details opens the day sheet; drag night 1 onto night 2 and Alt+Arrow still swap (existing asserts, selectors unchanged); eaten tonight shows "Eaten" and no hero Cook now; no hero when all nights are eaten; guided mode hides `#tonight`. Run at PC and 390 px, dark and light, via `prototype-preview`/screenshots (`--shots`).
- No real credential needed.

## Tasks
### Logic (TDD)
- [ ] 1. `test.html` cases for `MP.dinnerChain` (cook→2 leftovers linkNext chain; lone meal null; orphan when cook skipped; eating-out cook; `fromCook`; empty plan); implement in `data.js`; bump `sw.js` `CACHE`.
### UI (`ui-build`, restyle from `dinner-board-a.html`)
- [ ] 2. `plan.html` `#tonight` + `.board` wrapper; `style.css` board/hero/timeline/card styles from the prototype in house tokens, both themes, PC and 390 px.
- [ ] 3. `plan.js`: card markup in `renderPlan` using `MP.dinnerChain`; `renderTonight`; action delegation to the existing handlers; expand/collapse + keyboard; hide hero while `guidedActive`.
- [ ] 4. `walk.mjs` assertions from Verification (each listed behaviour its own assert), update selectors that assumed the 3-slot grid only if Phase 110 has not already; screenshots at both widths and themes.
- [ ] 5. `docs/UI_STYLE.md` line; run `python3 check.py`.
