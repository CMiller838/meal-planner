# Phase 103: Drag a meal to another slot or day [M]
Plain: On the plan grid you can pick up a meal and drop it on another slot to swap them, or drag a day's heading onto another day to swap whole days; a meal that can't go there springs back and says why.

Requires Phase 82 (done: `MP.swapSlots`/`MP.swapDays`, `applyResult`, `mp_planUndo` snapshot). No Worker, KV, pantry or generator change.

## Decisions
Already built (grep): `openSwapWith` / `openSwapDay` sheets (`plan.js` ~996-1014) already call `swapSlots`/`swapDays` through `applyResult` (snapshot, save, re-render, Undo toast); the Day-view "Swap with…" and "⇄ Swap day" buttons stay as the list fallback. `moveSlot(day, slotType, toDay)` (`plan.js` ~1417) is an old same-slot-type swap for shelf-life "Move to day N" buttons that skips refusal checks and undo: left alone. Nothing draggable exists on the plan grid (`.dragging` in `style.css` is the Discover fan deck only).
1. Own call: **drop slot on slot = `MP.swapSlots`** (an empty or eating-out target is a plain exchange, so "move to a free slot" is the same gesture). Held slots, batch/leftover members and a leftover-before-cook are refused by `swapSlots` itself; the refusal toast ("Can't do that: …") is `applyResult`'s existing text, and the card springs back.
2. Own call: **drag a day heading (a `⠿` grip on the `<h3>`) onto another day-row = `MP.swapDays`**; this is the only way to move a batch cook with its leftovers.
3. Own call: pointer events only (`pointerdown`/`move`/`up`/`cancel`), mouse and touch alike, no HTML5 drag-and-drop (it does not fire on touch). A drag starts after 8 px of movement for mouse; on touch after a 250 ms hold (so scrolling the page still works; `touch-action: pan-y` stays and is set to `none` on the card only once the hold fires). A plain tap still opens the day view.
4. Own call: while dragging, a clone ghost follows the pointer (`transform` only), valid-looking targets highlight under it via `document.elementFromPoint`, drop on nothing or on itself cancels. Reduced motion: no spring-back animation, instant.
5. Own call: **keyboard fallback** = on a focused `.slot-card`: `Alt+Arrow` swaps with the neighbouring slot (left/right = previous/next slot of that day, up/down = same slot type on the previous/next day), through the same `swapSlots` call. Focus stays on the moved slot after re-render. (Day-view buttons remain the screen-reader path; cards get `tabindex="0"` and `role="button"`.)
6. Own call: the drag/keyboard code is one small function `wireDragSwap(root)` called at the end of `renderPlan` beside `wireMoveBtns`; it only builds `{day, slot}` pairs and calls `applyResult(MP.swapSlots(...))`. It never edits `plan` itself, so it never touches the pantry, never re-flows and undo is the existing `mp_planUndo` one-level snapshot.
7. Own call: the Plan with me week grid (`renderChatWeek`) is excluded: its cards open the swap deck and its edits are chat cards (Phase 89). Not a gap.

## Files touched
- `plan.js`: `wireDragSwap(root)` (new, near `wireMoveBtns` ~1137), called from `renderPlan` (~1395); `slot-card` template (~1360) gains `tabindex="0" role="button"`; day `<h3>` gains the grip (`<span class="day-grip" aria-label="Drag to swap days">⠿</span>`). Uses `applyResult`, `MP.swapSlots`, `MP.swapDays`, `byIdMap` (all in `plan.js`; `swapSlots`/`swapDays` defined in `data.js`, which already has the `window`→`root` shim; nothing new for the Worker).
- `style.css`: `.slot-card.drag-src`, `.drag-ghost`, `.slot-card.drop-ok`, `.day-row.drop-ok`, `.day-grip`, using existing tokens (accent/butter border), animated per `docs/UI_STYLE.md`, `prefers-reduced-motion` branch.
- `sw.js`: bump `CACHE` (`style.css`/`plan.js` are cached; `data_check.py` fails the commit otherwise). No new file, so no `SHELL` entry; no script tag changes.
- `test.html`: no new pure logic (swap is covered at ~1097-1108); add one case that `wireDragSwap`'s keyboard neighbour helper `neighbour(day, slot, dir)` is correct at the edges.
- `tools/browser-check/ui-check.mjs`: a drag step (below).
- `CLAUDE.md`: append to the Phase 82 invariant line: "Plan-grid drag and Alt+Arrow (Phase 103) are only another caller of `swapSlots`/`swapDays` through `applyResult`; they never edit the plan directly."

## Signatures
- `wireDragSwap(root)`: no return; consumer: `renderPlan`.
- `neighbour(plan, day, slot, dir) -> { day, slot } | null` (`dir` = `left|right|up|down`; null at the grid edge or when `dir` runs off the plan). Consumer: the Alt+Arrow handler. Pure, exposed as `MP.Plan.neighbour` for the test.

## Edge cases
- Drop on itself, outside the grid, or on a gap between cards: cancel, no snapshot, no toast.
- Dropping on a held (eaten/locked/frozen) card, a batch or leftover member: refused with the existing reason toast; the Undo snapshot is not taken (`applyResult` only snapshots on change).
- A past day's slot: `swapSlots` has no past rule today (Phase 82 allows editing the past); this phase does not add one, but eaten slots are held so the common case is refused already.
- Page scrolls while a finger is down before the 250 ms hold: the drag never starts. Hold fires then finger moves: page does not scroll.
- Re-render during a drag (sync poll): drag cancels on `renderPlan`.
- Two-week grid: cross-week drops work (days 1..14, up to 28 per Phase 83); the ghost auto-scrolls the page near the viewport edge (simple 40 px band, `scrollBy`).
- Guided/chat mode (`guidedActive`, `chat`): `wireDragSwap` returns early when either is set, so an unsaved walkthrough is never mutated.

## Verification
- `python3 check.py` (data_check incl. `sw.js` bump, `test.html` incl. the `neighbour` case and the existing swap cases at ~1097-1108, ui pages and ui walk).
- `node tools/browser-check/ui-check.mjs --theme-key mp_theme --shots out/` extended: generate a plan, drag lunch of day 1 onto lunch of day 2 with mouse events and assert both names swapped and the shopping list lines follow; drag a batch cook's dinner (expect the refusal toast, plan unchanged); drag a day grip onto another day (assert swapped); Alt+ArrowRight on a focused card swaps; Undo restores. PC and 390 px, dark and light, fresh browser profile; also touch emulation (hold 250 ms then move) and a plain tap still opening the day view.

## Tasks
Logic (TDD)
- [ ] `MP.Plan.neighbour(plan, day, slot, dir)` + `test.html` edge cases (first/last slot of a day, day 1 up, last day down, 28-day plan)
UI
- [ ] `wireDragSwap(root)`: pointer drag with ghost, drop highlight, spring-back, auto-scroll band, cancel on re-render (`ui-build` skill, `docs/UI_STYLE.md`)
- [ ] Day-heading grip + `swapDays` drop; Alt+Arrow keyboard swap with focus kept
- [ ] `style.css` classes with reduced-motion branch; `sw.js` `CACHE` bump
- [ ] `ui-check.mjs` drag/keyboard/refusal/undo steps; `CLAUDE.md` invariant line
- [ ] Live: on the installed phone PWA, press-hold a lunch, drag it onto another day's lunch, check the shopping list follows, then try dragging a batch-cook dinner and see it refused; check the page still scrolls normally.
