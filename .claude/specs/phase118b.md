# Phase 118b: Night-by-night Hermes chat [L]
Plain: after the wizard, each night's dinner arrives as a card you accept, reject (with a reason) or swipe, under a strip of nights with the running cost; "Keep the rest" finishes in one tap.

Requires Phase 118a (wizard) and Phase 110 (one dinner slot). Uses Phase 111's `place.why` if built; without it the card has
no "Because" line. Prototype: `design-prototypes/ui-concepts/planchat-c.html` (cards, swipe, pill strip). Shared user
decisions: see `.claude/specs/phase118a.md`.

## Decisions
- **User-chosen:** cards walk the generated plan; it works with the Hermes bridge off (input disabled with one line
  "Hermes is offline: accept or reject the cards, Save still works"; no redirect).
- **User-chosen:** `#plan-chat-btn` navigates to `plan-with-me.html`. `#plan-fridge-btn` and `plan.html?chat=1` keep today's
  chat over the current plan.
- **Own call:** `guided=1` generates as today (`plan.js` init ~3201-3211), then `openChat({ walk: true })` instead of
  `startGuidedWalkthrough`. Delete `startGuidedWalkthrough`, `renderGuidedStep`, `advanceGuided`, `finishWalkthroughLoop`, the
  `guided` variable, the deck's `"guided"` mode branches (`renderDeck`/`renderDeckCards`/`takeMeal`/`passMeal`/`closeSwapPicker`),
  and `#guided-review-banner`/`#guided-commit-btn` (the in-thread wrap card replaces the review). `guidedActive` stays the
  working-copy flag (set by `openChat`).
- **Own call: walk state** `chat.walk = { done: Set<day>, passed: { [day]: Set<mealId> } }`. A card (`li.night-card` in `#chat-log`)
  shows the night's current meal: `dayHeading`, name, mins (`cookMinsFor`), `MP.ShoppingList.costBadgeHtml(meal, packData)`,
  `tagRowHtml(meal)`, and `why` when a Hermes place set it. External text through `esc()`.
  - Accept / swipe right (`MP.makeSwipeable`, `swipe.js`) → `done.add(day)`, card shows "Accepted" + Undo (Undo reopens it), next card = lowest undone non-auto night.
  - Reject / swipe left → existing `reasonForm` (a reason writes a down rating, Skip writes nothing) → add the meal to
    `passed[day]` → `setSlotMeal(day, "dinner", first candidatesFor(day, "dinner") not in passed[day])`; the old card shows
    "Replaced" and a new card for the same night follows. No candidate left → note "No other dinners for this night", current kept and done.
- **Own call:** leftover, eating-out, `fromCook` and `frozenFrom` nights get a one-line thread entry and are auto-done (the old walkthrough skipped them too).
- **Own call:** any Hermes change (`chat.changes` entry) to a night removes it from `done` and appends a new card for it;
  Reject on such a card = `setChange(c, true)` (reverts) then the reason form. In walk mode `#chat-diff`/`#chat-diff-all`,
  `.cw-cols`, `#chat-prev`/`#chat-next` and `#chat-day-title` are hidden.
- **Own call: pill strip** replaces `.cw-strip` in both modes: one pill per plan night (scrolls horizontally, the page never
  does), `.ok` done, `.pend` current, busy dot (`basePrefs.busyDays`), changed dot. Tap: walk → scroll to and flash that
  night's latest card (toast "not reached yet" if none); non-walk → select the day as today's tiles do. Meter line =
  done/total (walk) and the `renderTicker` cost against `effectiveBudget() * days / 7` (bar turns `over` past it).
- **Own call:** suggestion pills (Quicker, Cheaper, More veg, Fish, Surprise me) send their text via `sendChat` with
  `chat.day` = the pending night; hidden when Hermes is offline.
- **Own call:** "Keep the rest" (strip) marks every remaining night done. The wrap-up renders in-thread (both modes) from
  `wrapUp(plan)`, keeping the ids `#wrap-back`/`#wrap-save`/`#wrap-shop` (`#chat-save` opens it; walk shows it on its own
  when the last night is done). `#chat-wrap-overlay` goes.
- **Own call:** walk Exit (button or Escape) = `closeChat()` then `location.href = "plan.html"` (mp_plan untouched, no
  generated plan left in memory). Non-walk Exit unchanged.
- **Own call:** in non-walk mode Hermes change rows stay `li.diff-row` with their text span and Accept/Reject buttons (same
  text: existing walk steps hold), restyled as cards with swipe right/left = Accept/Reject.
- **Own call:** `chatBriefing` adds `walk: true` in walk mode; bridge prompt line: "When brief.walk is true the user is
  reviewing a generated plan night by night: reply in one short line and change only the nights they ask about."
- No ADR: no architectural fork (reuses the chat panel, `guidedActive`, `setSlotMeal`, `candidatesFor`, `reasonForm`, `wrapUp`).

## Files touched
- `plan.js`: `openChat(opts)` walk mode, walk state/handlers, `walkNights`, pill strip in `renderChatWeek`, in-thread wrap
  (`renderWrap`), diff rows as cards, `#plan-chat-btn` → `plan-with-me.html`, delete the guided walkthrough code, `guided=1`
  init branch, `chatBriefing` `walk`, Escape handler.
- `plan.html`: remove `#guided-review-banner`, `#chat-wrap-overlay`; add `#chat-strip` meter line, `#chat-keep-rest`, `#chat-sug` pills.
- `style.css`: night cards, pill strip, pills, in-thread wrap (house tokens, both themes, 390 px).
- `sw.js`: bump `CACHE` (first Logic task).
- `test.html`: `walkNights` cases.
- `tools/hermes_chat_bridge.py` + `tools/test_hermes_chat_bridge.py`: the `brief.walk` sentence.
- `tools/browser-check/walk.mjs`: new steps; the `openChat` helper (~289) goes to `plan.html?chat=1` instead of clicking
  `#plan-chat-btn`; delete the guided-deck step (~240-263); `#wrap-save` steps keep working.
- `CLAUDE.md`: the `guidedActive` invariant (Phase 24 walkthrough/review) → "the walk chat (Phase 118b) and Plan chat";
  the Phase 72 line's "Exit leaves `mp_plan` untouched via `guidedActive`" stays true.
- `docs/UI_STYLE.md`: night card, pill strip (via `restyle-from-prototype`).

## Signatures
- `MP.Plan.walkNights(plan, mealsById) -> [{ day, auto }]` (`plan.js`, pure; the Worker does not import `plan.js`, no shim).
  `auto` = `"leftover"` (effective meal has `leftoverOf`), `"out"` (`eatingOut`), `"cook"` (`fromCook`), `"frozen"`
  (`frozenFrom`) or `null` (a card). Null/malformed plan → `[]`. Consumers: walk start (auto lines + first card) and the
  next-night pick after each Accept/Reject.
- `openChat(opts)`: `opts === true` stays the fridge path; `{ walk: true }` = walk mode (no fallback redirect, offline allowed).

## Edge cases
- Bridge off, stale, or no Hermes config: walk opens, cards work, input + pills disabled/hidden, Save works.
- Hermes changes the pending night while its reason form is open: the form closes, a new card follows.
- Rejecting a batch cook: `setSlotMeal` re-flows its leftover nights as today; those nights' auto lines update.
- Every candidate passed for a night; a 1-night plan; a plan whose nights are all auto (wrap card at once).
- Double tap / swipe racing a button: one action per card (guard on card state, as `takeMeal` guards the top card).
- Reduced motion: no fly-off delay.

## Verification
- `python3 check.py` (timeout 600000) all green; `python3 tools/test_hermes_chat_bridge.py`.
- `walk.mjs` (`/chat` mocked by `page.route`; no real credential needed) asserts each of:
  - wizard Start planning → `#plan-chat` open with exactly one pending `.night-card` and one pill per plan night; `mp_plan` unchanged;
  - Accept → the next night's card appears, pill 1 has `.ok`;
  - a synthetic swipe right on the pending card = Accept;
  - Reject + "too fiddly" → one down rating with that note, a new card for the same night with a different meal, the old card "Replaced";
  - Reject + Skip → no rating written;
  - a leftover night shows a line, not a card;
  - tapping a pill flashes that night's card;
  - Keep the rest → wrap card; `#wrap-save` writes `mp_plan` and closes the chat;
  - Exit mid-walk → back on `plan.html`, `mp_plan` identical;
  - no Hermes config → cards still work, `#chat-input` disabled, URL stays `plan.html`;
  - mocked Hermes `place` on an accepted night → that pill loses `.ok` and a new card for the night appears;
  - `#plan-chat-btn` navigates to `plan-with-me.html`;
  - existing chat steps pass through `plan.html?chat=1`.
  - PC and 390 px, dark and light, no horizontal scroll (screenshots).

## Tasks
### Logic (TDD)
- [ ] 1. `test.html` `walkNights` cases (leftover / eatingOut / fromCook / frozenFrom auto, plain dinner null, null plan → `[]`); implement in `plan.js`, export on `MP.Plan`; bump `sw.js` `CACHE`.
- [ ] 2. Walk mode: `openChat({ walk: true })` (offline allowed, `brief.walk`), walk state, Accept/Undo/Reject/Keep the rest, Hermes change reopens a night, walk Exit; `guided=1` branch; delete the guided walkthrough code and banner.
- [ ] 3. Bridge prompt sentence + `test_hermes_chat_bridge.py` assertion that the prompt mentions `brief.walk`.
### UI
- [ ] 4. `restyle-from-prototype` from `planchat-c.html`: night cards, pill strip + meter, suggestion pills, in-thread wrap card, diff rows as swipe cards (non-walk).
- [ ] 5. `#plan-chat-btn` → `plan-with-me.html`.
- [ ] 6. `walk.mjs`: each Verification assertion as its own check; `openChat` helper via `?chat=1`; drop the guided-deck step.
- [ ] 7. `CLAUDE.md` `guidedActive` line.
