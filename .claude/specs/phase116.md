# Phase 116: Shopping aisle accordion [M]
Plain: the Shopping list shows one card per supermarket aisle with a progress bar and a tick animation, your extra items sit inside their aisle, and a dock at the bottom shows this week's total against your budget and a Finish shop button.

Prototype picked 2026-11-01: `design-prototypes/ui-concepts/shopping-a.html` (list tab and dock; the Pantry checklist tab is already built, commit 3d6cc8f, so it is not touched). Requires nothing unbuilt: the phone tab bar and `--tabbar-h` come from Phase 108, and the docked "I ate" bar from Phase 102 (`body.has-ate-bar`). Phase 114/115 restyle the nav and the meal sheet but do not touch the list render, so they may land before or after.

## Decisions

User-chosen (2026-11-01):
- **Finish shop = wrap-up only.** The dock button is disabled until every counted line is ticked. Pressing it deletes the ticked ad-hoc lines (the old "Clear got" behaviour) and toasts "Shop complete" with Undo (restores them to `got`). Plan lines stay ticked and **nothing writes the pantry**. The toast never says the pantry was updated. Stocking the pantry and the freezer from the shop is Phase 119, which replaces this handler with a review sheet.

Own calls:
- **One accordion card per aisle** inside each shop block, from the existing `MP.ShoppingList.groupByAisle(lines, packData)`, in store order. Header: aisle label, `ticked/total`, a progress bar (`scaleX`), a chevron; `aria-expanded` on the header button. A card whose lines are all ticked gets `.done` and a short bump animation once, then collapses itself. Open state is an in-memory `Set` per render session (not stored), seeded with every aisle that still has unticked lines.
- **What counts** in an aisle's total: lines with `packs > 0` that are not `skipped`. Covered (`packs === 0`) and skipped lines still render (struck/dimmed as today) but are not counted.
- **Rows keep the existing behaviour**: checkbox `data-shop`/`data-key` → `MP.Sync.setLine({id, state})`, skip/restore button, `have` and freeze hints, meals-why line, price. Only the wrapper changes, plus the prototype's tick animation (box check draws in, row settles; CSS only, instant under `prefers-reduced-motion`).
- **Essentials** become one more card ("Essentials", unpriced). The "Check you have these" (staples) and "Estimated" `<details>` stay below the aisle cards, unchanged.
- **Ad-hoc list folds into the aisles; the Ad-hoc tab goes.** Each `x:` line (`extras()`) is shown as a row in the aisle `MP.ShoppingList.aisleFor(normalizeKey(label), packData)` returns, with an "added" tag, its qty, a tick and a delete (×). Ticking calls `setLine` + `clearOut` as today. The add form (name + optional qty, the existing `#adhoc-add-btn` handler logic) moves to the foot of the list panel. There is no aisle picker: `aisleFor` decides, and unknown names land in "Other". Ad-hoc rows are unpriced and count toward progress but not the total. The tab bar is `Shopping list | Pantry`; `#adhoc` in the URL hash opens the list tab. With no plan, the empty state still shows the add form and any ad-hoc lines (in an "Other" card), so the list is usable without a plan.
- **Dock.** A fixed bar above the tab bar (above the "I ate" bar when `body.has-ate-bar`), phone and PC. It follows the first visible shop block (the current cycle): `£total`, "of £budget budget · £N left" or "£N over", a budget bar (`.over` turns it red), "In trolley £X · g of n ticked", and **Finish shop**. Budget = `MP.PlanPrefs.get().budgetTarget` (already prefers the profile `settings.budgetTarget`); `0` = no target, so the budget text and bar are hidden and only total and trolley show. The dock sets `--dock-h` on `:root` so the page padding and `.toast` clear it. Hidden on the Pantry tab and when there is no plan and no ad-hoc line. Display only: the total is the block's `list.total`, never re-priced.
- **Pure helper.** `MP.ShoppingList.progress(lines, isGot)` does the counting for the aisle headers and the dock, so it has a `test.html` case. It lives in `shopping-list.js`, which the Worker already imports and which has the `root` shim; the helper is pure, so no shim change.
- **No new dependency, route or KV key.** `plan-with-me.js` is loaded on `shopping.html` for `MP.PlanPrefs` (its top-level DOM code is already guarded, since `plan.html` loads it without the Plan-with-me markup; the builder confirms the console stays clean).

## Files touched
- `shopping-list.js`: `MP.ShoppingList.progress` (exported on the existing object).
- `shopping.js`: `lineHtml` wrapper kept; `aisleHtml` → accordion cards; `blockHtml`/`essentialsHtml`; `render` (dock, open set, `.just`/`.done` animation); ad-hoc rows folded in (`adhocLineHtml`, `adhocHtml`, `renderAdhoc` removed or merged into `render`); `TABS`/`tabFromHash`/`showTab` drop `adhoc`; `finishShop`.
- `shopping.html`: remove `#tab-adhoc`/`#panel-adhoc`; add `#shop-dock`; add `<script src="plan-with-me.js">` after `prefs.js` (before `shopping.js`).
- `style.css`: `.aisle-card`, `.ah` header, progress bar, tick animation, `.shop-dock`, `--dock-h` padding/toast rules, dark and light, reduced motion. Tokens from `docs/UI_STYLE.md`, no new colour.
- `sw.js`: `CACHE` bump (first Logic task).
- `test.html`: `progress` cases.
- `tools/browser-check/walk.mjs`: assertions below (the existing "shopping: list is built from the plan" step selector `#shopping-root .shop-line` stays valid).
- `CLAUDE.md`: no invariant line changes. Add one clause to the shop line of Architecture invariants only if the builder finds a pinned statement about the Ad-hoc tab (grep `Ad-hoc`).

## Signatures
- `MP.ShoppingList.progress(lines, isGot)` (pure) → `{ n, g, cost, gotCost }`. `lines` = list lines (`packs`, `lineCost`, `key`); `isGot(line)` → bool; a line counts when `packs > 0` and `!isSkipped(line)` where skipped is read by the caller through the same predicate (pass lines already filtered of skipped). Consumers: the aisle header (`shopping.js` `aisleCardHtml`) and the dock (`drawDock`).
- `shopping.js`: `aisleCardHtml(plan, shopDay, group, states, openSet)`, `drawDock(plan, lists, states)`, `finishShop()` (consumer: the dock button; deletes ticked `x:` lines via `setLine`, toasts with Undo).

## Edge cases
- No plan → empty state, add form and ad-hoc lines still shown; dock shows only trolley/ticked when there are ad-hoc lines, no total or budget.
- `budgetTarget = 0` → no budget bar. Total over budget → "£N over", bar red.
- A rolling plan with a past cycle hidden by `cycleOver` → the dock follows the first remaining block.
- Two shop blocks → each has its own heading and total; the dock reflects the first only.
- Ticking from another device (`visibilitychange` refetch) re-renders; the open set survives; an aisle that completes remotely collapses without animating.
- Undo after Finish shop restores the ad-hoc lines to `got` and re-enables nothing else.
- A very long aisle label or item name wraps, no horizontal scroll at 390 px.
- `finishShop` with no ad-hoc lines just toasts "Shop complete".

## Verification
`python3 check.py` (pass `timeout 600000`; or `python3 check.py --changed`) covers data_check, test.html and the ui pages; the walk runs inside it. No real credential needed.

`walk.mjs` (fresh profile, seeded plan with `mp_planPrefs` budgetTarget set, PC and 390 px, dark and light, `--shots`) asserts each of:
- (a) the list renders `.aisle-card` elements, each header showing `g/n` and a progress bar, and the first aisle with unticked lines is `aria-expanded="true"`;
- (b) ticking one line raises that aisle's `g` by 1 and the dock's "ticked" count by 1, and "In trolley" rises;
- (c) ticking the last line of an aisle gives the card `.done`, and the header toggle collapses and re-expands it (`aria-expanded` flips);
- (d) with `budgetTarget` 60 the dock shows the budget text and bar; with `budgetTarget` 0 the budget text and bar are absent;
- (e) adding "bin bags" through the add form creates a row tagged "added" inside an aisle card, and × removes it;
- (f) **Finish shop** is disabled until every counted line is ticked, then enabled; pressing it deletes the ticked ad-hoc lines, toasts "Shop complete" and Undo brings them back; `mp_pantry` (via `MP.Sync.localItems("pantry")`) is identical before and after;
- (g) `#adhoc` in the URL opens the list tab and there is no `#tab-adhoc`;
- (h) at 390 px no horizontal scroll (`scrollWidth <= innerWidth`), the dock sits above the tab bar and does not cover the last list row (scroll to bottom, last row's bottom ≤ dock top), and no console errors.
Screenshots: `node tools/browser-check/ui-check.mjs --theme-key mp_theme --shots out/`, compared with `shopping-a.html` by eye through `prototype-preview` at 390 px and PC, both themes.

## Tasks
Logic (TDD)
- [ ] 1. `sw.js` `CACHE` bump; `MP.ShoppingList.progress` + `test.html` cases (empty, all ticked, skipped and covered excluded, cost sums); run `python3 data_check.py`.
- [ ] 2. `shopping.js`: accordion render with the open set, `.just`/`.done` state, Essentials card, staples/estimated kept; ad-hoc rows folded in via `aisleFor`; add form at the foot; drop the Ad-hoc tab (`TABS`, `tabFromHash`, `showTab`, hash `#adhoc` → list).
- [ ] 3. `shopping.js`: `drawDock` (budget from `MP.PlanPrefs.get()`, first visible block) and `finishShop` (Undo, no pantry write); `shopping.html` markup and `plan-with-me.js` script.

UI (follow `ui-build`)
- [ ] 4. `style.css`: aisle cards, header progress bar, tick animation, aisle-done bump, dock above tab bar and ate bar, `--dock-h` padding and toast offsets, light and dark, reduced motion.
- [ ] 5. `walk.mjs`: assertions (a) to (h).
- [ ] 6. Look at both themes at 390 px and PC with `prototype-preview` against `shopping-a.html`; fix differences.
