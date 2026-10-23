# Phase 73: Tie questions and trade-off cards [M]
Plain: In the Hermes planning chat, when two dinners are about equally good you get one quick "this or that?" card, and when a week is over budget a card offers specific swaps with the £ saved and protein lost.

Requires Phase 72 (planning chat: `#plan-chat`, `chatContext`, working copy under `guidedActive`) and Phase 70
(`planMetrics` `weekCost`), both queued before this in `/overnight`. Phase 27 (budget target, `pack-sizes.json` `planning`)
is done. The roadmap's "Requires 75" was a stale renumber (the chat was Phase 74→72, this phase 75→73) and is corrected to 72.
No fallback: both cards live inside the Phase 72 chat. If `#plan-chat` is absent, stop and report rather than build.

## Decisions

**User-chosen (2026-10-23)**
- **The tie card is app-written, not Hermes-worded.** The app detects the tie and shows a tappable two-meal card under the
  day card, styled as a Hermes bubble. No new chat edit type and no relay round trip. The tie is also listed in
  `chatContext.cards` so Hermes knows it's on screen and doesn't contradict it.

**Own calls**
- **What counts as a tie:** dinner slot only, for the day card in focus. Compare the current dinner with `candidatesFor(day,
  "dinner")[0]`. Both are scored by `MP.Nutrition.gapScore` against the gaps left by that day's other slots (`dayCoverage`).
  It's a tie when `|a − b| <= planning.tieMargin` (default `0`, in `pack-sizes.json`). Skip held slots (`isHeld`: locked or
  eaten), leftovers (`leftoverOf`), frozen (`frozenFrom`) and batch heads (`MP.isBatch`), and skip when there's no candidate.
- **`gapScore` is extracted, not duplicated.** `rankByGap`'s inline per-meal score loop becomes
  `MP.Nutrition.gapScore(meal, gapNutrients, tags)`, and `rankByGap` calls it, so there's one scoring implementation and
  `rankByGap`'s output is byte-identical. `nutrition.js` already has the `window` → `root` shim, so nothing changes for the
  Worker.
- **One question at a time:** a tie card shows only when Hermes' latest reply has `ask: false`, at most one per day card,
  and each day is asked at most once per chat session (answered or ignored). Ignoring it keeps the current meal (the
  default). Picking the other meal goes through `setSlotMeal` (working copy only under `guidedActive`) and adds a Phase 72
  diff row.
- **Trade-off card trigger:** the effective weekly target is the chat's `budget` edit if one is set this session, else
  `settings.budgetTarget > 0`, else `mp_planPrefs.budgetTarget`. `0` means no card. The card is computed after each applied
  reply and on chat open, for each week where `planMetrics(plan).weekCost[w]` is over target. There's at most one card on
  screen, for the first over-budget week.
- **Swaps are computed in the app (the generator side), never by Hermes.** `budgetSwaps(week, overBy)` (`plan.js`, beside
  Phase 70's `fixGap`):
  1. For each non-skipped dinner in that week (same skip rule as ties), try the top `planning.shortlistSize` of
     `candidatesFor(day, "dinner")` on a cloned plan.
  2. Run `planMetrics` on each clone, and keep candidates with `saving > 0`.
  3. Greedily take the best saving per dinner (a tie goes to the smaller protein loss), up to `planning.tradeMaxSwaps`
     (default `2`, data), stopping once `overBy` is covered.
  4. Recompute the card's numbers with one `planMetrics` on the plan with every chosen swap applied, not a sum.
  `candidatesFor` already applies exclusions, allergies and `never`, so a swap can't introduce one. `ponytail:` batch heads
  are skipped instead of re-chaining their leftovers; add re-chaining if most over-budget weeks are batch-heavy.
- **Card wording:** "Swap Wed (Chilli → Bean stew) and Fri (… → …): saves £9, costs 12 g protein". A protein gain reads
  "adds N g protein". Weekday names come from `plan.startDate`. Accept applies every swap through `setSlotMeal`, adds diff
  rows and re-renders the card's totals line ("Week 1: £64 → £55 · protein 410 g → 398 g"). "Not now" dismisses it until
  `weekCost` changes.
- **Nothing new is stored:** no KV key, route, `mp_planPrefs` field or Worker change. Both cards are session UI over the
  working copy, so exiting the chat leaves `mp_plan` byte-identical (Phase 72's `guidedActive` rule).

## Files touched
- `nutrition.js`: extract `gapScore`, `rankByGap` uses it, export on `MP.Nutrition`. The shim is already present.
- `plan.js`: `tieFor(day)`, `budgetSwaps(week, overBy)`, `effectiveBudget()`, render/answer hooks in the Phase 72 chat
  (`renderTieCard`, `renderTradeCard`), and `chatContext` gains `cards: string[]`. Reuses `candidatesFor` (l.623),
  `planMetrics` (l.154, +`weekCost` from Phase 70), `setSlotMeal` (l.338), `isHeld` (l.233), `MP.isBatch` (`data.js`).
- `pack-sizes.json`: `planning.tieMargin: 0`, `planning.tradeMaxSwaps: 2`.
- `plan.html`: a card host inside `#plan-chat` (below the day card), if Phase 72 didn't leave one.
- `style.css`: `.chat-card` (tie and trade-off), both themes, 390 px, tokens from `docs/UI_STYLE.md`, an entry animation that
  is static under reduced motion.
- `test.html`: assertions below.
- `tools/browser-check/walk.mjs`: a chat walk case (with `/chat` mocked, as in Phase 72).
- `sw.js`: bump `CACHE`.
- `docs/HERMES.md`: one line under "Planning chat": `context.cards` lists on-screen tie or trade-off cards, and Hermes must
  not pick between them.
- `docs/roadmap.md`: change Phase 73's and Phase 74's "Requires … 75" to 72, and mark Phase 73 done on completion.

## Signatures / schemas
```
// nutrition.js
MP.Nutrition.gapScore(meal, gapNutrients: string[], tags) -> number

// plan.js
tieFor(day) -> { day, slot: "dinner", current: meal, alt: meal } | null
effectiveBudget() -> number            // £/week, 0 = none
budgetSwaps(week: 0|1, overBy: number) -> {
  week, swaps: [{ day, from: meal, to: meal }],
  before: { cost, proteinG }, after: { cost, proteinG }   // that week's numbers from planMetrics
} | null
chatContext(day) -> { ...Phase 72 fields, cards: string[] }   // e.g. "tie Tue: Chicken curry or Chilli"

// pack-sizes.json planning
"tieMargin": 0, "tradeMaxSwaps": 2
```

## Edge cases
- Meal names are untrusted (TheMealDB): rendered with `textContent`/`esc()` only.
- The tie's alternative is the same meal as the current one: `candidatesFor` already excludes `currentId`, so this can't
  happen. Assert it anyway.
- No swap saves money, or every dinner is held: no card. An over-budget week with nothing to offer shows nothing (no
  empty card).
- The chosen swaps don't fully cover `overBy`: show the card anyway with the real saving (no "fixes it" claim).
- A Hermes reply with `ask: true` arrives while a tie card is open: the tie card hides, and it isn't re-asked for that day.
- Accepting a swap pushes the other week over or under target: recompute after accept, which may show the second week's card.
- Library without `packData`: `weekCost` is `null`, so there's never a trade-off card.
- Exit mid-card: the working copy is discarded and `mp_plan` is unchanged.

## Verification
- `python3 check.py` (data_check with the `sw.js` bump, `test.html`, pages at PC and phone in both themes, ui walk)
- `python3 tools/spec_lint.py phase73`
- test.html:
  - `rankByGap` order is unchanged after the `gapScore` extraction (the existing assertions still pass, plus one comparing
    sorted-by-`gapScore` order).
  - `tieFor` returns non-null for a fixture day whose top two have equal `gapScore`, and null when they differ by more than
    `tieMargin`, for a locked slot, or for a leftover slot.
  - `budgetSwaps` never returns a `never`-rated or allergy meal, never touches a held, leftover or batch-head slot, returns
    at most `tradeMaxSwaps` swaps, and its `after.cost` equals `planMetrics` of the swapped plan.
- Browser walk (fresh profile, `/chat` mocked, PC and 390 px, dark and light):
  - A fixture tie day shows exactly one tie card. Tapping the alternative changes that slot in the working copy only
    (`mp_plan` unchanged until Save).
  - With a budget below the week's cost, the trade-off card shows. Accept changes the totals line and adds diff rows.
  - Exit leaves `mp_plan` byte-identical.
- No real credential needed.

## Tasks

### Logic (TDD)
- [x] Extract `MP.Nutrition.gapScore`, with `rankByGap` calling it; test.html order assertion.
- [x] `pack-sizes.json` `planning.tieMargin`, `planning.tradeMaxSwaps`.
- [x] `tieFor(day)` with the skip rules; test.html cases.
- [x] `effectiveBudget()` and `budgetSwaps(week, overBy)` (greedy, planMetrics-recomputed); test.html cases.
- [x] `chatContext` adds `cards`, and a `docs/HERMES.md` line.

### UI (ui-build skill)
- [x] Tie card (two meal buttons, ignorable, one per day, only when `ask` is false) → `setSlotMeal` and a diff row.
- [x] Trade-off card (swap lines, saving and protein, Accept / Not now, totals line updated after accept).
- [x] `.chat-card` style, entry animation (reduced-motion static), both themes at PC and 390 px.
- [x] walk.mjs chat case. Bump `CACHE` in `sw.js`. Roadmap: fix the 73/74 Requires lines and mark 73 done.
