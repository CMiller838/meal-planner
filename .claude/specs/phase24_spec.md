# Phase 24 — Guided walkthrough + review mode in `plan.js`

No new page. `plan.html?guided=1` (the link Phase 23's `plan-with-me.js:133`
already produces) loops the existing `#swap-overlay` swipe deck over each of
the 14 dinner slots showing `rankSlot`'s top-3 candidates, then lands on the
existing plan grid as a review step with a "Looks good" commit button.
Breakfast/lunch/snack stay auto-filled, unchanged.

## Decisions (answered 1B, 2A)

Confirmed by the user directly in the coordinating conversation after two
Decision Gates (both matching my recommendation).

| # | Decision | Chosen | Why |
|---|----------|--------|-----|
| G1 | Back/skip mid-walkthrough | **B — forward-only.** No back-stack, no per-slot "skip" button in the deck itself. Corrections happen at the review step via the existing day→Swap affordance. | Matches the swipe deck's existing left/right-only interaction model — building a history stack across 14 slots is real state for a v1 flow that already has a correction path. **Correction note:** `.day-swap-btn` (plan.js:451) lives inside the per-day detail sheet (`renderDayView`, plan.js:460), not directly on the plan grid — so a review-step correction is *tap the day → tap Swap*, two taps, not one. `docs/roadmap.md:78-80`'s "existing per-slot `.day-swap-btn` affordance" undersells this by one tap; noted here and in §7. |
| G2 | Un-chosen (skipped) dinner slot | **A — keeps the generated meal.** Exhausting or declining all 3 candidates (or exiting the walkthrough early) leaves that day's dinner exactly as `generatePlan()` produced it. Commit is never blocked. | Every dinner slot already has a valid, nutrient-ranked meal the instant the plan is generated — the walkthrough only ever *replaces* it, never *removes* it. Blanking a slot would introduce "empty dinner" as a new state every downstream reader (shopping list, shelf-life, coverage, `commitCook`) would have to tolerate, for a v1 flow that doesn't need it. |

### Calls made without a gate (trivial forks, noted for the record)

- **Entering guided mode always regenerates a fresh plan**, in-memory only
  (`plan = generatePlan()`, no `savePlan()`) — it does not reuse whatever is
  currently in `mp_plan`. This is what makes the busy-days/chips the user
  just set on `plan-with-me.html` actually visible in the walkthrough; reusing
  the stored plan would silently ignore the prefs they just saved. Mirrors
  `regenerate()` (plan.js:107-110) minus the immediate save/render.
- **The deck's `✕` and clicking the overlay backdrop both mean the same
  thing during a walkthrough: jump straight to review**, applying G2 to every
  remaining day. Not a second "cancel entirely" affordance — closing the tab
  or navigating away is what "abandon" means, and that already satisfies the
  stateless-on-exit invariant with zero code (see Findings).
- **The review step's "Looks good" button reuses `.banner`** (style.css:420,
  already used for `#hermes-banner`) rather than new banner CSS.
- **No `sw.js` cache bump.** Phase 22 set this precedent
  (`.claude/specs/phase22_spec.md:330`): a bump is for shell-file-list
  changes (new files), not content edits to files already in `SHELL`. This
  phase only edits `plan.js`/`plan.html`/`style.css`, all already listed.
- **Cooking/eating during the review step is out of scope.** The review grid
  is the real `renderPlan()`, so the existing eat/cook sheet is reachable
  from it. Those write pantry/log state through their own paths regardless of
  `mp_plan`'s save state today — this phase doesn't change or gate that.

## Findings (verified, do not re-derive)

- `setSlotMeal(day, slotType, mealId)` (plan.js:135-138) and
  `setSlotVariant` (plan.js:140-…) each call `savePlan()` internally, every
  time. This is the load-bearing fact for the whole phase: without
  suppressing it, the very first swipe-right in the walkthrough would write
  `mp_plan` and fire `mp:plan-saved`, breaking the stateless-on-exit
  invariant. Both gain a module-level guard (§2).
- `candidatesFor(day, slotType)` (plan.js:262-270) already excludes the
  slot's current meal and returns the *full* `rankSlot`-ordered pool — the
  existing swap deck (`renderSwapCards`, plan.js:331-361) just slices the
  first 3. The walkthrough reuses `candidatesFor` unchanged.
- `#swap-overlay` (plan.html:46-47) is an empty `#swap-sheet` populated at
  render time — the deck heading, hint text and even the "N of 14" progress
  line are free to replace per-render; no new DOM/CSS structure needed for
  the deck itself.
- Plan shape: `plan.days` is exactly 14 entries, `plan.days[i].day` is 1-14,
  every day has a `dinner` slot (`SLOT_TYPES`, plan.js:8) — confirmed no
  day-skipping logic exists in `generatePlan`'s output shape. The walkthrough
  sequence is simply `plan.days.map(d => d.day)`.
- `init()` (plan.js:783-… ) currently runs `plan = loadPlan(); savePlan();
  renderPlan();` unconditionally, after `prefs` is assembled
  (`plan.js:782`). This is the one branch point: guided entry replaces those
  three lines, non-guided keeps them byte-identical.
- No `URLSearchParams` usage exists anywhere in the codebase yet (confirmed
  by planner's earlier grep) — this phase's `init()` change is the first.
- `closeSwapPicker()` (plan.js:279-283) is already the single place the
  overlay-backdrop click and the deck's `close-btn` both route through
  (plan.js:748-750, and every `renderSwapDeck`/`renderVariantPicker`
  close-btn wiring) — branching it on walkthrough state (§2.3) covers both
  exits for free, no new listener.
- `openVariantPicker`/day detail view are unreachable while the walkthrough
  overlay is open (nothing else renders until `renderPlan()` runs at the end
  of the loop), so no separate guard is needed there beyond the
  `guidedActive` save-suppression already covering `setSlotVariant`.

## Non-goals

- No new page, no new file. Everything lives in `plan.js` (+ a few lines of
  `plan.html` markup, + a few lines of `style.css`).
- No back-stack, no per-slot skip button, no progress persistence across a
  reload (G1). Reloading mid-walkthrough restarts it from day 1 on a newly
  generated plan — acceptable, since nothing was saved yet anyway.
- No change to `generator.js`, `rankSlot`, `plan-preferences.json`,
  `MP.PlanPrefs`, or `plan-with-me.js`/`.html` — Phases 22/23 finished those.
- No change to `commitCook`, `eatPortion`, the pantry-write boundary, or
  `MP.Cooks`.
- No Hermes change (`/planPrefs` relay is Phase 25, `/ranking` is Phase 26).
- No new dependency, no build step (`CLAUDE.md`).

### Invariants this phase must not break

- **Stateless on exit.** From the moment `?guided=1` is read until the
  "Looks good" tap, `mp_plan` in localStorage is never written. Closing the
  tab, navigating to another page, or reloading at any point during the
  walkthrough or review step leaves `mp_plan` exactly as it was before this
  visit.
- **One save, one event.** The final commit calls `savePlan()` exactly once,
  the same function the one-tap path uses, so `mp:plan-saved` → `pushPlan`
  fires exactly once, in the same shape as today.
- **Cook vs. portion boundary untouched.** `commitCook` remains the only
  pantry writer; nothing in the walkthrough or review step calls it.
- **Chips/busy remain layers 2-3.** The fresh plan this phase generates goes
  through the same `generatePlan(..., prefs)` call as `regenerate()` — no
  separate ranking path.
- **No `innerHTML` with unescaped external content** (`CLAUDE.md`) — the deck
  cards already go through `esc()` (plan.js:340-ish, unchanged code path).

## §1 `plan.js` — module state

```js
let guidedActive = false; // true from ?guided=1 entry until "Looks good" commit
let guided = null;        // { days: number[], idx: number } — active only during the swipe loop, null during review
```

`guided` is `null` during the review step; `guidedActive` stays `true`
throughout the walkthrough *and* the review step, and only flips back to
`false` inside the commit handler.

## §2 `setSlotMeal` / `setSlotVariant` — save suppression

```js
function setSlotMeal(day, slotType, mealId) {
  plan.days[day - 1].slots[slotType] = { mealId };
  if (!guidedActive) savePlan();
}

function setSlotVariant(day, slotType, variantId) {
  // ...existing mutation...
  if (!guidedActive) savePlan();
}
```

One-line change to each. Every other caller (the normal swap deck, the
variant picker, both reachable outside guided mode) is unaffected since
`guidedActive` is `false` there.

## §3 `init()` — entry branch

Replace the unconditional block after `prefs = Object.assign(...)`
(plan.js:782) with:

```js
const guidedParam = new URLSearchParams(location.search).get("guided") === "1";
if (guidedParam) {
  guidedActive = true;
  plan = generatePlan();   // fresh plan honouring the prefs just saved — NOT persisted
  startGuidedWalkthrough();
} else {
  plan = loadPlan();
  savePlan();
  renderPlan();
}
initHermesBanner();
```

`initHermesBanner()` runs either way — the Hermes request banner is unrelated
to guided mode.

## §4 Walkthrough loop

```js
function startGuidedWalkthrough() {
  guided = { days: plan.days.map((d) => d.day), idx: 0 };
  renderGuidedStep();
}

function renderGuidedStep() {
  if (!guided || guided.idx >= guided.days.length) return finishWalkthroughLoop();
  const day = guided.days[guided.idx];
  const candidates = candidatesFor(day, "dinner");
  if (!candidates.length) {           // no alternatives at all (tiny library) — G2, keep + advance
    guided.idx++;
    return renderGuidedStep();
  }
  swapCtx = { day, slotType: "dinner", candidates };
  renderGuidedDeck();
  document.getElementById("swap-overlay").classList.remove("hidden");
}

function advanceGuided() {
  guided.idx++;
  renderGuidedStep();
}

function finishWalkthroughLoop() {
  document.getElementById("swap-overlay").classList.add("hidden");
  swapCtx = null;
  guided = null;
  renderPlan();
  document.getElementById("guided-review-banner").classList.remove("hidden");
}
```

### 4.1 `renderGuidedDeck()` / `renderGuidedCards()`

Copies of `renderSwapDeck`/`renderSwapCards` (plan.js:321-361) with two
differences: the heading is a step counter instead of "Swap {slot} — Day
{n}", and the close button and both swipe handlers route through
`advanceGuided()`/`closeSwapPicker()` instead of `closeSwapPicker()` alone.

```js
function renderGuidedDeck() {
  const sheet = document.getElementById("swap-sheet");
  const { day } = swapCtx;
  sheet.innerHTML = `<button class="close-btn" aria-label="Skip to review">✕</button>
    <h2>Day ${day} of ${plan.days.length} — Dinner</h2>
    <p class="swipe-hint" style="margin-top:0;">Step ${guided.idx + 1} of ${guided.days.length} ·
    Swipe right to pick · swipe left for another option · tap to view recipe</p>
    <div id="swap-deck" class="swipe-deck" style="height:340px;"></div>`;
  sheet.querySelector(".close-btn").addEventListener("click", closeSwapPicker);
  renderGuidedCards();
}

function renderGuidedCards() {
  const deck = document.getElementById("swap-deck");
  deck.innerHTML = "";
  // swapCtx.candidates is always non-empty here (renderGuidedStep filtered the empty case)
  swapCtx.candidates.slice(0, 3).forEach((meal, idx) => {
    // ...identical card markup to renderSwapCards (plan.js:340-350)...
    if (idx === 0) {
      MP.makeSwipeable(card, {
        onSwipeRight: () => {
          setSlotMeal(swapCtx.day, "dinner", meal.id);
          toast(`Day ${swapCtx.day}: using "${meal.name}"`);
          advanceGuided();
        },
        onSwipeLeft: () => {
          swapCtx.candidates = swapCtx.candidates.filter((m) => m.id !== meal.id);
          if (!swapCtx.candidates.length) advanceGuided();
          else renderGuidedCards();
        },
        onTap: () => openDetail(meal),
      });
    }
    deck.appendChild(card);
  });
}
```

### 4.2 `closeSwapPicker()` — branch on walkthrough state

```js
function closeSwapPicker() {
  if (guided) return finishWalkthroughLoop();
  document.getElementById("swap-overlay").classList.add("hidden");
  swapCtx = null;
  variantCtx = null;
}
```

This is the only change to the existing function. It's already the single
handler for both the deck's `close-btn` and the overlay-backdrop click
(plan.js:748-750), so both exits get "skip to review" for free — no new
listeners.

## §5 Review step — commit banner

`plan.html`, inside `<main>` near `#hermes-banner` (line 30):

```html
<div id="guided-review-banner" class="banner hidden">
  <span>Review your plan — tap any day to swap a meal, then confirm.</span>
  <button id="guided-commit-btn" class="btn">Looks good</button>
</div>
```

`init()`'s listener wiring (alongside the other banner listeners, plan.js
~748-756):

```js
document.getElementById("guided-commit-btn").addEventListener("click", () => {
  guidedActive = false;
  savePlan();
  history.replaceState(null, "", "plan.html"); // drop ?guided=1 so a reload doesn't re-enter
  document.getElementById("guided-review-banner").classList.add("hidden");
  toast("Plan saved");
});
```

No new CSS — `.banner` (style.css:420) and `.btn` already style this
identically to `#hermes-banner`.

## §6 Not in this phase

No `URLSearchParams` beyond the single `guided` read. No change to
`candidatesFor`, `rankSlot`, `generatePlan`'s signature, `MP.PlanPrefs`, or
`commitCook`/`eatPortion`. `mp:plan-saved` still fires from exactly one place
(`savePlan()`), called from exactly one new call site (§5) plus its existing
callers.

## §7 Docs

- **`docs/roadmap.md`** (lines 74-93): mark Phase 24 shipped. Correct line
  79's "existing per-slot `.day-swap-btn` affordance" to note it's inside the
  day detail sheet (two taps: open day → Swap), not directly on the grid.
- **`CLAUDE.md`**: add one line to the architecture-invariants list —
  `plan.js`'s `guidedActive` flag is what makes the guided walkthrough and
  its review step stateless on exit; `setSlotMeal`/`setSlotVariant` only
  persist immediately when it's `false`. Don't add a second save path that
  bypasses the flag.

## Edge cases

| Case | Required behaviour |
|------|--------------------|
| Library has zero alternative dinners for a given day | `candidatesFor` returns `[]`; that day is skipped with no UI, generated meal kept (G2). |
| User swipes left through all 3 candidates | Auto-advances to the next day, generated meal kept (G2). |
| User taps ✕ or the overlay backdrop mid-walkthrough | Jumps straight to review; every remaining day keeps its generated meal (G2). |
| User reloads mid-walkthrough or mid-review (before "Looks good") | `?guided=1` is still in the URL, so `init()` regenerates a fresh plan and restarts the walkthrough from day 1. `mp_plan` is untouched either way. |
| User closes the tab mid-walkthrough or mid-review | `mp_plan` untouched — nothing was ever written. |
| User taps "Looks good" | `savePlan()` fires once, `mp:plan-saved` fires once, URL drops `?guided=1`. |
| User cooks/eats a meal during the review step, then abandons without "Looks good" | Pantry/log write immediately as always (unrelated to `mp_plan`'s save state); only the meal-slot picks stay unsaved. Documented limitation, not solved this phase. |
| `?guided=1` present but `mp_planPrefs` was never set | `MP.PlanPrefs.get()` already degrades to `{ busyDays: [], chips: [] }` (Phase 23) — walkthrough runs over a plan identical to one-tap Generate's output. |

## §8 Tests — `test.html`

No new pure-logic module is introduced (the walkthrough is DOM/state-machine
wiring over existing functions), so no new `test.html` group. The one
testable unit is the `setSlotMeal`/`setSlotVariant` save-suppression, but
`MP.Plan` only exports `applyPlacements`/`logPortion` (plan.js:742) for
headless testing — `setSlotMeal` itself isn't reachable outside a DOM, so
this is covered by the manual pass instead.

## §9 Manual pass

1. `python3 -m http.server 8000`, open `plan-with-me.html`, pick a couple of
   busy days and a chip, tap Generate. Lands on `plan.html?guided=1` and the
   swipe deck opens immediately on Day 1's dinner (no plan grid flash first).
2. Swipe right on a card — toast confirms the pick, deck advances to Day 2.
   Swipe left through all 3 on another day — deck advances without a pick.
   Tap a card — recipe detail opens as it does today; closing it returns to
   the same card.
3. After Day 14, the deck closes and the normal plan grid renders with the
   "Review your plan…/Looks good" banner visible.
4. Tap a day, tap Swap on the dinner slot, pick a different meal — the grid
   updates immediately (existing behaviour) but `localStorage.mp_plan` is
   still the *previous* plan (DevTools check) — proving review edits aren't
   persisted yet.
5. Tap "Looks good" — banner disappears, toast confirms save,
   `localStorage.mp_plan` now matches what's on screen, and the URL bar no
   longer shows `?guided=1`.
6. Repeat steps 1-3, then close the tab (or navigate to `index.html`)
   instead of tapping "Looks good" — reopen `plan.html` directly: the plan
   is exactly what it was before starting the guided flow (or the seeded
   default, on a first-ever run).
7. Reload the browser mid-walkthrough (`?guided=1` still in the URL) — the
   walkthrough restarts cleanly from Day 1 on a fresh plan; no console error.
8. Tap ✕ on the deck partway through — jumps straight to review with the
   remaining days at their generated meals; "Looks good" still saves
   correctly from there.
9. One-tap `#generate-btn` on a plain `plan.html` visit (no `guided` param)
   is completely unchanged — no banner, no deck, immediate save as today.
10. Dark mode: the review banner and deck read correctly (no new CSS beyond
    reusing `.banner`, so this should need no fixes).
