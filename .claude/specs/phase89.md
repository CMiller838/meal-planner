# Phase 89: Weekly plan view with live diff, ticker and wrap-up [L]
Plain: planning with Hermes shows the whole week next to the chat, with what each change does to cost and nutrient gaps,
cook times per dinner, and a last checklist before the plan is saved and sent to shopping.

Requires Phase 88 (`totalMins`, `MP.estMins`, `mp_planPrefs.timeCaps`, `place` edits). Built after it in the queue.

## Decisions
User-chosen:
- **Phone layout = dinner strip + day.** At <900 px: a 7-tile strip (one tile per day: short dinner name, cook time,
  over-cap mark, changed dot); tapping a tile shows that day's 4 slot cards below it (today's `chat-day` view). At
  >=900 px: full 7 columns x 4 slot rows, chat docked on the right. One render function (`renderChatWeek`), two CSS
  layouts (the slot rows are hidden on phone; the selected day's slots show under the strip).

Own calls:
- **The grid replaces the one-day view.** `chat-day-nav` (‹ day ›) becomes ‹ Week N › (`chat.week`, 0-based, steps
  of 7 days, clamped to `plan.days.length`). `chat.day` stays (the selected day: phone detail, and the `day` sent to
  Hermes); stepping a week selects that week's first day. Tie/trade cards (`renderChatCards`) are unchanged.
  `renderChatDay` is deleted, not kept beside it.
- **Ticker baseline = the plan when the chat opened.** `chat.base = planMetrics(JSON.parse(chat.snapshot))` once at
  open. The ticker shows, for the week on screen: cost `£X (±£Δ)` and gaps `N (±Δ)` from `planMetrics(plan)` vs
  `chat.base`; each reply that changes a number briefly flashes it (CSS class, reduced-motion = no flash). Display-only,
  same rule as the Phase 70 meter: never edits, never ranks.
- **Diff: whole-week accept/reject.** `chat.changes` stays per reply. Above the rows, when >1 change: "Accept all" /
  "Reject all" buttons, which run the existing per-row `set(r)` over every row (same code path, no second path). Changed
  cells in the grid keep `.slot-diff`; a rejected one drops it.
- **Cook time on each dinner cell**: `meal.totalMins` else `~MP.estMins(meal)` (the `~` marks an estimate), else
  nothing. Over cap: the day's dinner minutes > `timeCaps[weekday]` (Phase 88; weekday from `plan.startDate`) → the
  cell gets `.over-cap` and a "over 20 min" label. Leftover/frozen/eating-out dinners count 0 min. Display-only.
- **Wrap-up**: Save opens a checklist sheet instead of saving at once: (1) nutrient gaps left per week
  (`planMetrics().weekGaps`, labelled), (2) leftovers: orphan leftovers (a leftover dinner with no earlier cook) and
  spare batch portions (a batch dinner whose `servings - 1` exceeds the leftover/repeat dinners of it scheduled within
  `shelfData.cooked_leftovers.fridgeDays` after it), (3) items to buy: line count and £ total per shop from
  `MP.ShoppingList.buildLists(plan, byId, packData, pantry)`. Buttons: "Back to chat", "Save", "Save & shop" (Save, then
  `location.href = "shopping.html"`; the shopping list already reads `mp_plan`, no handoff data). Informational only:
  nothing blocks Save. An empty section shows "None".
- **`MP.Plan.wrapUp(pl, ctx)`** is pure (testable in test.html like `fixGap`); `orphanLeftovers` (data.js) gets
  exported as `MP.orphanLeftovers` for it (data.js stays shim-clean).

## Files touched
- `plan.html`: chat section: week nav, `#chat-ticker`, `#chat-week` (replaces `#chat-day`), `#chat-wrap` sheet
  (hidden); diff header buttons.
- `plan.js`: `renderChatWeek` (replaces `renderChatDay`; every call site, incl. `renderPlan`'s `if (chat)` line and
  `onChatReply`), `renderTicker`, `cookMinsFor(day)`, `wrapUp` + `renderWrap`, Accept/Reject all in `renderChatDiff`,
  `chat.week`/`chat.base` in `openChat`, Save → wrap-up in `initChat`; export `wrapUp` on `MP.Plan` (line ~2092).
- `data.js`: export `orphanLeftovers` on `MP`.
- `style.css`: `.chat-week` grid (>=900 px: chat docked right, `.plan-chat` max width widened), phone strip, `.over-cap`,
  ticker + flash (inside the existing reduced-motion block), wrap-up sheet. Tokens only (`docs/UI_STYLE.md`).
- `test.html`: asserts below. `sw.js`: CACHE bump.
- `CLAUDE.md`: one invariant line: the week grid, ticker, cook-time and over-cap flag and wrap-up are display-only; the
  wrap-up never blocks Save.

## Signatures / schemas
- `renderChatWeek(staged)`. Consumers: `openChat`, `onChatReply`, `renderPlan`, week/day nav, diff `set()`.
- `cookMinsFor(day) → { mins: number|null, est: bool, cap: number|null, over: bool }`. Consumer: `renderChatWeek`.
- `renderTicker(flash)`. Consumer: `renderChatWeek` (flash when a reply changed the numbers).
- `wrapUp(pl, ctx) → { gaps: [[nutrient]x weeks], orphans: [{ day, name }], spare: [{ day, name, portions }],
  shops: [{ shopDay, lines, total|null }] }`. Consumer: `renderWrap` (the Save button's sheet).

## Edge cases
- Plan of 1-6 days or 15-28 days: weeks = ceil(days/7); the last week shows only the days it has; cost/gaps per week
  follow `planMetrics` (it splits at day 7: weeks 3-4 fold into week 2 there, so the ticker shows week 2+ as one, stated).
- `firstSlot` day 1: slots before it render empty and greyed, as on the main plan.
- No `packData` (cost null): ticker shows gaps only; wrap-up shows lines without £.
- No `startDate`: no weekday → no cap check (labels "Day N").
- Accept all after some rows were rejected individually: every row ends accepted.
- Wrap-up opened, then Back: the chat is unchanged (no save, `guidedActive` still on).
- Leftover dinner counted spare/orphan only for `dinner` slots (same as `orphanLeftovers`).

## Verification
- `python3 check.py` (test.html: `wrapUp` orphan + spare portions + shops; cook mins totalMins vs `~est` vs none,
  over-cap with a `timeCaps` entry, leftover dinner = 0; ticker deltas equal `planMetrics` differences vs the snapshot).
- Browser run (Playwright via `tools/browser-check`, mocked chat replies as in Phase 88's verification): PC 1280 px shows
  7 columns with chat on the right; 390 px shows the strip, tapping a tile shows its slots, no horizontal page scroll;
  a reply with 3 places flashes the ticker and marks 3 cells; Reject all restores them; Save opens the wrap-up, Save &
  shop lands on `shopping.html` with the plan saved. Both themes. No real credential needed.

## Tasks
Logic (TDD):
- [x] `data.js`: export `MP.orphanLeftovers`
- [x] `plan.js`: `wrapUp` (pure, exported) with orphans, spare portions, shops
- [x] `plan.js`: `cookMinsFor` (totalMins / est / cap / over) and ticker deltas vs `chat.base`
UI (`ui-build`):
- [x] `renderChatWeek` + week nav replacing `renderChatDay` (all call sites); PC grid with chat docked, phone strip + day
- [x] Ticker with flash; cook time and over-cap on dinner cells
- [x] Accept all / Reject all over the existing `set()`
- [x] Save → wrap-up sheet (Back / Save / Save & shop)
- [x] CLAUDE.md invariant line; bump `sw.js` CACHE
