# Phase 79: Cooking mode [M]
Plain: tap Cook on a meal and get one big step at a time on your phone, with timers on the steps that need them, then confirm the cook at the end.

Requires: Phase 40 (built: `MP.methodOf`, `methodStatus`, `GET /meal/:id/method`). Needs no Worker change.

## Decisions
- **Steps are read locally, not fetched** (own call; the roadmap says "over `GET /meal/:id/method`"): the app's library (`MP.methodOf(meal)`, `data.js`) is the authority and the Worker copy is a mirror, so the screen works offline in the kitchen. The route stays for the assistant. Same `{status, steps:[{text, minutes|null}]}` shape either way.
- **Confirm cook = the existing `commitCook`** (own call; the roadmap names `PUT /eat-requests`, which is the assistant's queue, not an app call): the last step's "Confirm cook" closes the cook screen and calls `openEatSheet(meal, null, null, variantId)`, whose Confirm runs `commitCook`. Quantity edits, shortfalls, leftover record all come for free. `commitCook` nulls `eatCtx`, so a double tap is a no-op: deducts once. No new pantry writer, no new path.
- **Entry point**: a `Cook` button next to `Eat this` in `plan.js` `openDetail` (the one detail sheet reached from every plan slot). Browse's sheet is untouched (it has no eat flow).
- **Timers** (own call): one per step with `minutes`, started by a button on that step; stored as `{ step, endAt }` with `endAt = Date.now() + ms`, remaining time recomputed each tick, so they survive Next/Back, a throttled background tab and a re-render. Several can run at once; a strip above the step shows every running timer (tap to jump to its step). On finish: `navigator.vibrate` (where present), the strip item pulses, and a toast. Timers are in-memory only: closing the cook screen or reloading drops them (`// ponytail:` ceiling, persist `endAt` in `sessionStorage` if that bites). No phone-clock intent link (platform-specific, skipped; add when asked).
- **Screen stays on**: `navigator.wakeLock.request("screen")` on open, released on close, best effort in try/catch (no-op where unsupported).
- **Drafted** steps carry a "Drafted by your assistant" label on every step; a meal with no method shows the ingredient list only, with the Cook screen's Confirm cook still offered.
- **Variants**: steps are for the base recipe (existing note in the detail sheet); the cook screen shows that note and lists the *effective* meal's ingredients (the variant/subs the user will actually cook).
- **Gates**: none; every fork has a clear default.

## Files touched
- `cook-mode.js` (new, name checked free): `MP.CookMode.open(meal, effMeal, onConfirm)`; renders into a new `#cook-overlay`. Pure helper `timerLeft(t, now)` exported for tests. No `window.` at top level beyond the `MP` namespace pattern the other app files use (the Worker does not import it).
- `plan.html`: `<script src="cook-mode.js">` **before** `plan.js` (plan.js now uses `MP.CookMode`), plus `<div id="cook-overlay" class="modal-overlay hidden" style="z-index:65;">`. Grep `*.html` for other pages loading `plan.js`: `test.html` loads it too (line 24), add the script there before it.
- `plan.js` (`openDetail`, ~l.1220-1241): Cook button; handler calls `MP.CookMode.open(meal, effMeal, () => openEatSheet(effMeal, null, null, variantId))`.
- `style.css`: cook screen styles from the Cork Kitchen tokens (large step text, sticky Back/Next, timer strip); follow `docs/UI_STYLE.md` and the `ui-build` skill.
- `sw.js`: add `"cook-mode.js"` to the cached list, bump `CACHE` (data_check fails otherwise).
- `test.html`: Phase 79 cases.
- `docs/roadmap.md`: mark Phase 79 done when committed. No new CLAUDE.md invariant needed (it adds no stored shape or pantry path).

## Signatures
- `MP.CookMode.open(meal, effMeal, onConfirm)`; `close()`
- `MP.CookMode.timerLeft({ endAt }, now) -> ms` (clamped at 0)

## Edge cases
- No method: ingredients only, no Next/Back, Confirm cook shown. Drafted: label shown.
- Step without `minutes`: no timer button. Restarting a running timer: button becomes Cancel.
- Timer that finishes while on another step: strip pulses, vibrates, toast names the step number.
- Back on step 1 / Next past the last step: disabled; last step's Next becomes Confirm cook.
- Confirm cook tapped twice or the eat sheet confirmed twice: pantry deducted once.
- Close mid-cook (✕ or Escape) with no confirm: nothing written, `mp_plan` and pantry untouched.
- Meal text goes through `esc()` or `textContent` (CLAUDE.md: untrusted content).

## Verification
- `python3 check.py` (data_check cache bump, test.html assertions, pages at PC and phone, both themes).
- test.html: `timerLeft` clamps at 0 and counts down from `endAt`; a timer survives step changes (state kept per session); no-method meal renders ingredients and no Next; Confirm cook called twice runs `commitCook` once (pantry fixture deducted exactly once).
- `node tools/browser-check/ui-check.mjs --theme-key mp_theme --shots out/` for the plan page, then drive it with `prototype-preview`: open a meal, Cook, start a timer, Next/Back, confirm timer still running, finish through Confirm cook; at PC and 390 px, dark and light; a meal with no method; fresh profile.

## Tasks
Logic (TDD)
- [ ] `timerLeft` + per-session timer state (start, cancel, finished) in `cook-mode.js`, tests in `test.html`
- [ ] Confirm-twice-deducts-once test against a pantry fixture
UI
- [ ] `#cook-overlay`, step screen, Back/Next, timer button and strip, drafted label, no-method fallback
- [ ] Wake lock open/close; vibrate on finish
- [ ] Cook button in `openDetail`; `sw.js` list + `CACHE` bump; script tags in `plan.html` and `test.html`
- [ ] Both themes at PC and 390 px via `prototype-preview`
