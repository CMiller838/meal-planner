# Phase 60: Choice screens for breakfast, lunch and snacks [M]

Plain: In "Plan with me" you can tick breakfast, lunch or snacks and get three meals to choose from for each day, the way dinners already work; leave them unticked and nothing changes.

Requires Phase 24 (built: guided walkthrough in `plan.js`, `guidedActive`).

## Decisions
- **User: opt-in per slot type (option A).** `plan-with-me.html` gets an "Also choose" row with three toggles (breakfast, lunch, snack), all off by default. Dinners are always walked first, exactly as today; each ticked type then gets its own 14-day pass.
- **Own call: carried in the URL, not `mp_planPrefs`.** Generate goes to `plan.html?guided=1&slots=breakfast,lunch`. Keeps the pinned `mp_planPrefs` shape (`{updatedAt,busyDays,chips,budgetTarget}`) and the Worker/Hermes prefs route untouched; the toggles reset each visit (a one-off choice, not a setting). `plan.js` whitelists the param to `breakfast|lunch|snack` and ignores anything else.
- **Own call: three cards for non-dinner slots** (roadmap), dinner stays five. "Pick for me" = do nothing: the generated meal stays (`candidatesFor` excludes the current meal from the alternatives, so the deck shows alternatives only). A close/skip on any step leaves that slot as generated.
- **Own call: leftover slots are skipped** (`effectiveMealAt(day, slot).leftoverOf`), as are days with no candidates, as dinners do today.
- **Own call: reorder only.** `candidatesFor` already calls `MP.Generator.rankSlot` (exclusions, ratings, profile `never` applied there); no new ranking, no filter. Choices go through `setSlotMeal`, so `guidedActive` still keeps `mp_plan` untouched until "Looks good".

## Files touched
- `plan.js` (guided state `{ passes, pass, days, idx }`, `renderGuidedStep`/`renderGuidedDeck`/`renderGuidedCards` take the slot type, `?slots=` parse near line 1243; `candidatesFor` unchanged)
- `plan-with-me.html`, `plan-with-me.js` (toggle row; Generate builds the URL; no `MP.PlanPrefs` change)
- `style.css` (toggle row reuses `.chip` / `.chip.active`; add nothing unless needed)
- `sw.js` (bump `CACHE`), `test.html`, `tools/browser-check/walk.mjs` (guided walk with slots)
- No new cross-file dependency, no Worker change (`generator.js` zero-line diff).

## Signatures
- `guided = { passes: ["dinner", ...extras], pass: 0, days: number[], idx: 0 }`; `nextGuidedStep()` advances idx, then pass, then `finishWalkthroughLoop()`.
- `parseGuidedSlots(search) -> string[]`: extras filtered to `["breakfast","lunch","snack"]`, deduped, in that fixed order; always prefixed with `"dinner"`. Pure, exposed for `test.html`.
- Deck size: `slotType === "dinner" ? 5 : 3`; heading `Day N of M — <Slot>`, step counter spans all passes.

## Edge cases
- `?slots=` empty, unknown or `dinner` repeated: dinners only, identical to today.
- Every candidate swiped away: slot keeps its generated meal, step advances.
- Closing (✕) mid-pass goes to review with `mp_plan` untouched; "Looks good" is the only save.
- A pass where all slots are leftovers or empty is skipped silently.

## Verification
- `python3 check.py`
- `test.html`: `parseGuidedSlots` cases (empty, junk, dupes, order).
- Browser walk (`tools/browser-check/walk.mjs`, PC and 390px, both themes, fresh profile): with `slots=breakfast,lunch,snack` skip every step and compare `mp_plan` after "Looks good" to the plan from plain `?guided=1`/one-tap Generate (same meals); pick one lunch and confirm only that slot changed; every card shown is non-excluded (no mushroom, no egg-only); abandon mid-pass and confirm `mp_plan` unchanged; no console errors. No real credential needed.

## Tasks
Logic (TDD)
- [x] `parseGuidedSlots` + `test.html` assertions
- [x] Multi-pass `guided` state and `nextGuidedStep`, skip leftover/empty slots
UI (`ui-build`)
- [x] "Also choose" toggle row in `plan-with-me.html`/`.js` (aria-pressed, reuse `.chip`), URL built on Generate
- [x] Guided deck heading/counter/deck size per slot type
- [x] Bump `CACHE` in `sw.js`; extend `walk.mjs`; PC + 390px, both themes
