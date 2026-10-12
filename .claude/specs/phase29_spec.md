# Phase 29 — Live-build-watching (staged local generation render)

Accepting a Hermes-raised plan request from the existing banner no longer snaps
straight to a finished 14-day grid: the slots reveal progressively, in day
order, so the user watches the plan fill in. Everything else about the plan —
the meals chosen, the coverage numbers, the warnings, the saved `mp_plan` — is
byte-identical to today's.

This is a **render-side phase only**. `generator.js` is not touched, not
restructured into an async/yielding generator, and `generatePlan()` still runs
synchronously to completion before a single pixel changes. The reveal is
cosmetic staging of an already-final plan, not a live trace of the generator
loop.

## Decisions

### Resolved at the roadmap gate — cited, not re-litigated

`docs/roadmap.md:106-125` (Gate 1, Path A, answered directly by the user):
what gets watched is **the app's own local generation**, not remote activity.
Hermes never generates a plan — `PUT /planFlag` only raises the banner and
`plan.js` runs `generatePlan()` locally. So: **no new endpoint, no polling of
`GET /placements`, no worker push (SSE / Durable Objects), no new write path.**
v4's rule that every Hermes plan write goes through `/placements`
propose-then-app-applies is unchanged. The phase is placed third specifically so
this render path isn't re-verified against two later *generator* changes —
which is exactly why the generator must stay untouched here.

### The mechanism (stated, not gated — it follows from the above)

`MP.Generator.generatePlan` (`generator.js:209-327`) is a synchronous,
single-pass, **non-day-order** loop: weekend batch/leftover runs first (in
arbitrary day order per run), then dinners day 1→14, then `OTHER_SLOTS` nested
per slot type day 1→14. It returns the whole `{ startDate, days, generatedAt }`
object at once and yields nothing intermediate. Restructuring it into a
generator function is out of scope by the roadmap note above.

Therefore: run `generatePlan()` exactly as today (its compute is
imperceptible), render the **complete** grid as today, and reveal the already-
present `.slot-card` elements progressively. The reveal order is the grid's own
DOM order — week 1 day 1 → week 2 day 14, four slots per day — which is
day-order and legible, deliberately *not* the generator's internal placement
order. Watching the real loop tick-by-tick would require the generator change
this phase exists to avoid.

### Calls made without a gate (trivial forks, noted for the record)

- **CSS animation with a per-card `animation-delay`, not `setTimeout` /
  `requestAnimationFrame` staggering.** No timer handles to hold, nothing to
  cancel on a re-render, no state that can outlive the DOM it animates. The
  browser owns the schedule. This is the single decision that makes both of the
  forks raised in the dispatch trivial:
  - **Separate function vs. flag on `renderPlan()`** → an optional
    `renderPlan(staged)` argument (default `false`). Staging is one added class
    plus a per-card inline `animationDelay`, both applied only when `staged` is
    true. Every existing caller (`moveSlot`, the `mp:placements-applied`
    listener, guided walkthrough, swap picker, eat/cook paths, `init`) calls
    `renderPlan()` bare and gets a **zero-line, zero-behaviour** diff. A second
    near-duplicate render function would be two copies of a 45-line
    `innerHTML` builder to keep in sync — the exact thing that rots.
  - **Interaction mid-reveal** → neither blocked, ignored, nor cancelled.
    The cards are fully rendered, wired and clickable from t=0; only `opacity`
    and `transform` animate. Tapping a day mid-reveal opens the day view
    normally, and a `renderPlan()` from any other path replaces the DOM
    outright, which ends the animation for free. No cancel API, no `.finish()`
    call, no guard flag.
- **Stagger: 30ms per card, 220ms fade-and-rise per card, delay capped at
  1800ms.** 14 days × 4 `SLOT_TYPES` = 56 cards → ~1.7s to full reveal. Inline
  constants in `plan.js` (not data): these are animation timing, not a planning
  knob — CLAUDE.md's "data, not inline constants" rule is about nutrition /
  cost / preference numbers that change plan output, and these change nothing.
- **Staged only from `hermes-generate`.** The one-tap `generate-btn` and every
  other path stay instant. `regenerate()` gains the same optional pass-through
  argument, so making Generate staged later is a one-word change if wanted.
- **The week summary, day coverage line and shelf-life warnings render at t=0,
  fully, against the final plan.** They are computed once from the complete
  `plan` (as `renderPlan` already does at `plan.js:205, 211, 233`) — nothing
  is recomputed per stage. The numbers are therefore correct throughout; they
  are simply ahead of the visual reveal, which is honest (the plan *is*
  finished) and avoids 56 recomputations of `weekCoverage` /
  `checkPlanWarnings` for a cosmetic effect.
- **`prefers-reduced-motion: reduce` disables the reveal** (cards render
  visible immediately). Accessibility basic, not a simplification to skip.
- **No new test group.** This phase adds no pure logic; `test.html` is
  DOM-free by design and group 45 (Phase 28, `test.html:1933`) stays the
  latest. Verification is the §7 manual pass.

## Findings (verified, do not re-derive)

- `plan.js:869-874` — the `hermes-generate` handler: `regenerate()`, then
  `await MP.Sync.ackPlanFlag(pendingRequestedAt)`, hide `#hermes-banner`,
  toast. `regenerate()` is synchronous and completes before the `await`.
- `plan.js:110-114` — `regenerate()` is `plan = generatePlan(); savePlan();
  renderPlan();`. Two callers: `generate-btn` (`plan.js:863-868`) and
  `hermes-generate`.
- `plan.js:203-248` — `renderPlan()` builds both weeks into one `html` string,
  assigns `root.innerHTML = html` (`plan.js:238`), then wires `.slot-card`
  click handlers (`plan.js:240-245`), `wireMoveBtns(root)` and
  `if (dayCtx) renderDayView();`.
- **Every** `renderPlan()` call site is a bare zero-argument call —
  `plan.js:113, 256, 337, 415, 459, 731, 756, 843, 904`. None passes it as a
  function reference to an event listener or `.forEach`, so an optional first
  parameter cannot be accidentally fed a truthy event object.
- `plan.js:919` — `if (document.getElementById("plan-root")) init();` guards
  the DOM entry point; `plan.js` also loads in `test.html` for pure-function
  testing. All new code in this phase lives **inside** `renderPlan`, which is
  only reachable via `init()` or another render caller, so nothing new runs at
  file-evaluation time.
- `SLOT_TYPES = ["breakfast", "lunch", "dinner", "snack"]` (`plan.js:8`) → 4
  cards per day row, 56 across the plan.
- `generator.js:209-327` places weekend batch/leftover runs first, then dinners
  day 1→14, then `OTHER_SLOTS` per slot type day 1→14. Confirms the real
  placement order is not day-order and cannot be observed without changing the
  function.
- `style.css` currently has **no** `@keyframes` and **no**
  `prefers-reduced-motion` block anywhere in the repo — both are new here.
- `sw.js:4` — `CACHE = "meal-planner-v21"` (Phase 28).

## Non-goals

- **No change to `generator.js`.** Not its signature, not its loop order, not
  into a generator/async function, not a progress callback argument. Zero-line
  diff. This is the phase's placement rationale.
- **No change to what is generated.** Same plan object, same `savePlan()`,
  same `mp_plan` bytes as an unstaged run with the same inputs.
- **No progress bar, no percentage, no "building…" overlay, no per-slot
  text.** The cards appearing *are* the progress indicator.
- **No staged reveal on any other path** — one-tap Generate, `moveSlot`, the
  swap picker, `mp:placements-applied`, the guided walkthrough and first paint
  all stay instant.
- **No artificial delay in the computation.** `generatePlan()` is not slowed,
  chunked, `await`ed or deferred to make the reveal look "real".
- **No network, no endpoint, no polling, no Worker change** (roadmap gate).
  Zero-line diff in `worker/worker.js`, `hermes-sync.js`, `generator.js`,
  `nutrition.js`, `shelf-life.js`, `shopping-list.js`, `data.js`.
- No new dependency, no build step, no animation library (CLAUDE.md).

### Invariants this phase must not break

- **`rankSlot` stays the one ranking implementation** and `generator.js` is
  untouched, so all four callers are trivially unaffected.
- **`guidedActive` stays the only save gate.** No new `savePlan()` call site;
  `regenerate()`'s existing `savePlan()` is unmoved and still runs *before*
  the render, so an abandoned reveal cannot lose the plan.
- **No `innerHTML` with unescaped external content.** The reveal adds a class
  and an inline `animationDelay` to already-built elements — no new string
  interpolation into HTML at all.
- **`plan.js` must still load in `test.html`** with no `#plan-root`
  (`plan.js:917-919`). No new top-level DOM access.
- **Dark mode defaults on** — the animation must be legible in both themes
  (it animates opacity/transform only, so it inherits the existing card
  colours; verified in §7).

## §1 `plan.js` — `renderPlan(staged)`

One optional parameter, default falsy. The entire existing body is unchanged
up to and including `root.innerHTML = html` (`plan.js:238`) and the handler
wiring (`plan.js:240-246`).

```js
const STAGE_STEP_MS = 30;    // per-card delay increment
const STAGE_MAX_MS = 1800;   // delay cap, so the tail never drags

function renderPlan(staged) // (boolean=) -> void
```

After `wireMoveBtns(root)` and **before** `if (dayCtx) renderDayView();`, the
only added block:

```js
if (staged) {
  root.classList.add("staging");
  root.querySelectorAll(".slot-card").forEach((el, i) => {
    el.style.animationDelay = Math.min(i * STAGE_STEP_MS, STAGE_MAX_MS) + "ms";
  });
} else {
  root.classList.remove("staging");
}
```

- `querySelectorAll` returns cards in document order → week 1 day 1
  breakfast/lunch/dinner/snack, … , week 2 day 14 snack. That is the reveal
  order; no sorting, no index maths beyond the counter.
- The `else` branch matters: the class lives on the persistent `#plan-root`
  element, which survives an `innerHTML` swap, so an unstaged re-render must
  clear it. The freshly built cards carry no inline delay, so they would
  otherwise all animate at once.
- `if (dayCtx) renderDayView();` stays the last line — an open day sheet
  repaints as today, unstaged.

> **ponytail:** cosmetic staging of a finished plan, not a live generator
> trace. Upgrade path, if genuine per-pick liveness is ever wanted, is turning
> `MP.Generator.generatePlan` into a `function*` that yields after each
> `place()` — deliberately deferred so this render path isn't re-verified
> against the two generator phases that follow.

## §2 `plan.js` — `regenerate(staged)` and the one caller that passes `true`

```js
function regenerate(staged)   // (boolean=) -> void
```

Body unchanged except the last line becomes `renderPlan(staged);`.

| Call site | Change |
|-----------|--------|
| `plan.js:869-874` `hermes-generate` handler | `regenerate(true)`. Nothing else in the handler moves — `ackPlanFlag`, hiding `#hermes-banner` and the toast all still run immediately, concurrently with the reveal. The banner disappearing while the grid fills is the intended read. |
| `plan.js:863-868` `generate-btn` handler | **None.** `regenerate()` stays instant. |

These two lines (`§1`'s block plus `renderPlan(staged)` / `regenerate(true)`)
are the phase's entire JS diff.

## §3 `style.css` — one keyframe, two rules, one media query

Placed beside the existing `.slot-card` rule.

```css
@keyframes mp-slot-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

#plan-root.staging .slot-card {
  opacity: 0;
  animation: mp-slot-in 220ms ease-out forwards;
}

@media (prefers-reduced-motion: reduce) {
  #plan-root.staging .slot-card { opacity: 1; animation: none; }
}
```

- `forwards` holds the end state, so a card that finishes stays visible even
  though the base rule sets `opacity: 0`.
- `opacity`/`transform` only — no layout property animates, so the grid never
  reflows and nothing shifts under a mid-reveal tap.
- Scoped to `#plan-root.staging`, so no other `.slot-card` in the app (day
  sheet, swap deck) is affected.
- No new colour, no new component, no theme-specific rule — it inherits the
  card's existing dark/light styling.

## §4 `sw.js`

- Bump `CACHE` (line 4) `"meal-planner-v21"` → `"meal-planner-v22"`, so the
  updated `plan.js` and `style.css` are re-fetched for offline users.
- **No shell-array change** — this phase ships no new file.

## §5 Docs

- **`docs/roadmap.md`** Phase 29 (lines 106-125): record the resolved shape —
  staged CSS reveal of an already-final plan, `renderPlan(staged)` flag,
  `hermes-generate` only, generator untouched. Mark shipped when done.
- **`CLAUDE.md`**: one Architecture-invariants bullet — the Hermes-accepted
  staged reveal is render-side only; `generatePlan` stays synchronous and
  `generator.js` has a zero-line diff; `renderPlan(staged)` is a flag on the
  one render function (never a second render path), staging is a CSS
  `animation-delay` stagger over already-wired cards, so mid-reveal
  interaction needs no blocking or cancellation; coverage/warnings are
  computed once against the final plan.
- **`docs/ARCHITECTURE.md`**: note `renderPlan`'s optional `staged` argument
  and the `#plan-root.staging` convention beside the plan-rendering
  description.
- **`SPEC.md`**: leave it — no data file, no plan-slot shape, no planning rule
  changes.

## Edge cases

| Case | Required behaviour |
|------|--------------------|
| Any non-Hermes render during the reveal (`moveSlot`, swap confirm, eat/cook, `mp:placements-applied`, guided) | `renderPlan()` with no argument: `.staging` is removed and the DOM is rebuilt, so the animation stops and everything is instantly visible. No cancel logic. |
| User taps a day / slot mid-reveal | Opens the day view as normal — cards are wired at t=0 and only opacity animates. The overlay covers the still-revealing grid; on close the reveal has finished or continues harmlessly. |
| User navigates away or reloads mid-reveal | `savePlan()` already ran inside `regenerate()` before the render, so the plan is persisted regardless. Nothing is lost. |
| `prefers-reduced-motion: reduce` | Cards render fully visible immediately; the class and inline delays are still set and simply have no effect. |
| Two `hermes-generate` taps in quick succession | The second `regenerate(true)` rebuilds the DOM and restarts the reveal from card 0. Fresh elements, fresh delays — no accumulation, no leaked timers (there are none). |
| Fewer cards than expected (a short/partial `plan.days`) | The index-based delay just runs shorter. No assumption of 56 cards anywhere. |
| `#plan-root` absent (`test.html`) | `renderPlan` is never called; the staging block is inside it. Unchanged from today. |
| `ackPlanFlag` network call fails/hangs after `regenerate(true)` | Unchanged behaviour — the reveal is already running independently of the `await`; the existing handler's error surface is untouched. |
| Offline (PWA) | Identical — the reveal is local CSS. v22 cache serves the updated `plan.js`/`style.css`. |
| A future staged Generate | Pass `true` from `generate-btn`; no other change. Deliberately not done. |

## §6 Tests

**No new `test.html` group.** This phase introduces no pure function: the diff
is one optional boolean parameter, a class toggle, an inline style and a CSS
keyframe. `test.html` has no DOM harness and group 45 (Phase 28,
`test.html:1933`) remains the latest.

The one regression that matters is covered by existing groups and by §7.2:
`generatePlan` output must be unchanged. If any existing assertion in
`test.html` fails after this phase, the generator was touched and the phase is
wrong.

## §7 Manual pass

1. `python3 -m http.server 8000`, open `plan.html`. First paint is instant —
   no reveal on load.
2. One-tap **Generate** → confirm → plan appears instantly, all 14 days, four
   slots each. Unchanged from today.
3. Raise the Hermes banner (`PUT /planFlag`, or hand-clear
   `mp_hermes_plan_acked` and reload), tap the banner's **Generate**: the grid
   fills in day by day over roughly 1.5-2s, top to bottom, banner disappears
   and the toast fires immediately.
4. Repeat and tap a day row **while it is still filling** — the day view opens
   normally with the right meals; close it, grid is intact.
5. Mid-reveal, use a shelf-life **Move to day N** button: the grid re-renders
   instantly (no partial fade) and the moved slot is correct.
6. After a staged reveal completes, trigger any other render (swap a meal,
   mark one eaten): it is instant, with no residual fading.
7. Reload after a staged generate: the plan that was revealed is the plan that
   loads from `mp_plan`, identical.
8. DevTools → Rendering → **Emulate `prefers-reduced-motion: reduce`** → the
   banner Generate path shows the full grid immediately, no fade.
9. Dark **and** light mode: cards fade in legibly in both; no flash of wrong
   colour, no layout shift while revealing.
10. Offline (DevTools → Offline, after one load on v22): plan page and the
    staged reveal both still work.
