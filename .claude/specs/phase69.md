# Phase 69: Swipe deck per slot [M]
Plain: The swap deck on a meal slot now has Take and Pass buttons and arrow keys, shows how many options are left, and the planner and guided walkthrough share one deck.

Requires: Phase 24 (guided walkthrough, `guidedActive`) done. Phase 62 not needed (see Decisions).

## Decisions

- **Roadmap contradicted (user gate, 2026-10-23):** the deck already exists (`renderSwapDeck`/`renderSwapCards` for Swap, `renderGuidedDeck`/`renderGuidedCards` for the walkthrough, both on `MP.makeSwipeable`, both walking `rankSlot`'s order via `candidatesFor`). Chosen: **polish and unify**, not a new deck.
- **Takes and passes are stateless (user-chosen).** Nothing is written to `mp_ratings`, KV or `mp_planPrefs`; the taste profile stays derived from explicit ratings only. A pass is "not for this slot now", not a dislike. The roadmap's taste-feed line is dropped.
- **Entry stays the Swap / Add a meal button in the day sheet (own call).** A slot-card tap already opens the day view, so stealing it would break that; no new entry point.
- **One renderer, two modes (own call).** `renderDeck()` replaces the four functions above; `swapCtx.mode` is `"swap"` or `"guided"`. They differ only in heading/hint, how many cards show (swap 3, guided dinner 5 / extras 3, kept as is), and the take/exhausted outcome (swap: close + `renderPlan`; guided: `advanceGuided`).
- **Take and Pass buttons plus ArrowRight/ArrowLeft** call the same `takeMeal`/`passMeal` the swipe callbacks call: one code path. Keys only act while `#swap-overlay` is open with a deck; Escape closes as the ✕ does. Buttons play a short fly-off class (reduced-motion: none) then call the handler.
- **A counter "n left"** under the deck (candidates remaining). Empty state keeps today's text. Passing shows the next ranked candidate; nothing re-ranks.
- `rankSlot`, `candidatesFor`, `setSlotMeal` and `guidedActive` semantics are untouched: takes still go through `setSlotMeal`, so guided saving stays gated.

## Files touched

- `plan.js` (merge the four deck functions into `renderDeck`, `takeMeal`, `passMeal`; key handler; no change to `candidatesFor`/`setSlotMeal`)
- `style.css` (`.deck-actions`, button fly-off class, both themes; `swipe.js` unchanged; `generator.js` zero diff)
- `tools/browser-check/walk.mjs` (existing `#swap-deck .swipe-card` checks keep passing; add button and key cases)
- `sw.js` (bump `CACHE`), `docs/roadmap.md` (mark done with what was verified, and note the dropped taste feed)
- No new file, dependency, route or KV key; no `window` shim concern (plan.js is browser-only; the Worker does not import it).

## Signatures

```
plan.js: renderDeck(), takeMeal(meal), passMeal(meal)   // swapCtx = { day, slotType, candidates, mode }
```

## Edge cases

- No candidates: swap mode shows the empty message; guided mode skips the step (as today).
- Passing every card: swap mode shows the empty message with the counter at 0; guided mode advances.
- Leftover slot in guided mode still skips (empty candidates, as today).
- Locked slot (Phase 66): taking a meal keeps the lock via `setSlotMeal`, unchanged.
- Arrow keys ignored when focus is in an input or the detail sheet is open over the deck.
- Rapid double click on Take: the handler guards on the top card so only one `setSlotMeal` fires.
- Abandoning the guided deck (✕) before "Looks good" leaves `mp_plan` untouched (`guidedActive`).

## Verification

- `python3 check.py` (data_check with the `sw.js` bump, `test.html`, pages at PC and phone in both themes, ui walk)
- `python3 tools/spec_lint.py phase69`
- Browser walk (`tools/browser-check`, fresh profile, PC and 390 px, dark and light): open Swap on a dinner, press Pass three times and the next three ranked meals show in `candidatesFor` order; Take sets the slot and `mp_plan` changes; in `?guided=1` Take does not save until "Looks good"; ArrowRight/ArrowLeft behave as Take/Pass; counter decrements.
- No real credential needed.

## Tasks

Logic (TDD):
- [ ] `takeMeal`/`passMeal`/`renderDeck` with `mode`; swipe, buttons and keys all route through them
- [ ] Test (walk.mjs): pass x3 shows ranked next three; take calls `setSlotMeal`; guided take leaves storage unsaved

UI (follow `ui-build`, `docs/UI_STYLE.md`):
- [ ] Take/Pass buttons and "n left" counter; fly-off animation respecting `prefers-reduced-motion`; both themes at PC and 390 px
- [ ] Bump `CACHE` in `sw.js`; mark Phase 69 done in `docs/roadmap.md`
