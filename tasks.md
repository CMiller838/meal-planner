# Tasks

Per-phase breakdowns are written by `@planner` in phase mode, just before each
phase is built. Placeholders below track roadmap progress only.

Previous checklist (Phases 1-15, all shipped) archived at
`.claude/archive/tasks_20260906.md`. Previous checklist (Phases 16-21, all
shipped) archived at `.claude/archive/tasks_20260913.md`.

## Phase 22 — `rankSlot` extraction + chip/busy ranking layers

Spec: `.claude/specs/phase22_spec.md`. Decisions: D1 fold `candidatesFor`
now, D2 declarative chip matcher, D3 five-chip vocabulary. Ships headless —
with empty `prefs` every output must be identical to today's.

### Logic & Backend Tasks (TDD — write the check first where marked)

- [x] Write `plan-preferences.json` at repo root: `_note`, `busy`
      (`preferEffort: "quick"`, `demoteEffort: "batch"`), `chips` array (§1).
- [x] Fill the five chip entries: `comfort`, `light` (prefer); `no-spice`,
      `less-red-meat`, `no-pasta` (avoid), per §1's schema table.
- [x] Sanity-check every keyword list against seeded `meals.json` names and
      ingredient keys — no chip may hit zero meals or all meals.
- [x] `generator.js`: add module-level `chipVocab(prefs)`, `chipHits(meal,
      chip, tags)`, `activeChips(prefs)` (§2). Not exported.
- [x] Test group 40: `chipHits` — keyword on name, keyword on ingredient key,
      tag matches only `"high"`, exact `prepEffort`, empty-criteria chip hits
      nothing.
- [x] `generator.js`: move `pickMeal` out of `generatePlan`'s closure to
      module level as `rankSlot(pool, dayNum, dayMealsSoFar, opts)`; make
      `tags`, `targets`, `budget`, `halfKeys`, `lastUsedDay` explicit `opts`
      members (§3).
- [x] Layer 1 verbatim: keep lines 99-105 (exclude, line-101 empty-pool
      fallback, `dayCoverage`, `rankByGap`) unchanged.
- [x] Layer 4: replace the early `return ...[0]` at 126 with a head-hoist of
      `neverW.concat(usedW)` + the remaining `ranked`, dedup by id.
- [x] Layer 5: replace `return never.concat(used)[0]` at 133 with the array.
- [x] Test: `rankSlot` with no `prefs` — `[0]` equals the old `pickMeal`
      result for a pinned fixture, and length equals pool minus exclusions.
- [x] Add the `pickMeal` closure inside `generatePlan` (§3) so call sites at
      152, 170, 183 stay untouched; verify by diff.
- [x] Layer 2 (chips): stable partition into prefer / neither / avoid;
      prefer wins when a meal hits both kinds; skipped when both lists empty.
- [x] Test: prefer chip promotes a lower-nutrition match and removing it
      restores order; avoid chip tails without dropping; both-hit → prefer;
      unknown chip id is a no-op.
- [x] Layer 3 (busy): after the existing `opts.prefer` partition, apply
      `busy.preferEffort`/`demoteEffort` only when `dayNum` is in
      `prefs.busyDays` **and** `opts.prefer !== "batch"`.
- [x] Test: busy day biases quick to head; `prefer: "batch"` call unaffected.
- [x] `generatePlan`: add trailing optional `prefs` arg, `prefs = prefs || {}`
      on entry (§4.1).
- [x] Busy-day run rotation in the weekend-run loop: start at the first
      non-busy day when `run[0]` is busy and a non-busy day exists; leave
      all-busy runs alone. Add the `ponytail:` comment from §4.4.
- [x] Test: rotation picks the first non-busy cook day; all-busy run unchanged.
- [x] Add `rankSlot` to the `MP.Generator` export (line 191).
- [x] `plan.js`: repoint `candidatesFor` (261) from `MP.Nutrition.rankByGap`
      to `MP.Generator.rankSlot(pool, day, otherSlotMeals, { tags, targets,
      prefs })` with `prefs = {}`; do not pass `budget`/`lastUsedDay` (§5).
- [x] Test: `generatePlan` with `prefs = {}` and with `prefs` omitted produce
      identical `days` (ignore `generatedAt`).
- [x] Walk §"Edge cases" and confirm each row — especially that chips never
      filter and a plan can never fail to fill.

### UI & Layout Tasks

- [x] None. This phase ships headless — no page, no style, no `sw.js` change
      (`plan-preferences.json` is not fetched by any page until Phase 23).

### Docs

- [x] `docs/ARCHITECTURE.md`: correct `rankSlot`'s signature to the `opts`
      form; note the `prefer: "batch"` exemption from busy bias.
- [x] `docs/roadmap.md`: mark Phase 22 shipped; delete its "Open scoping"
      note (both questions answered by D1 and D3).
- [x] `CLAUDE.md`: add chips/busy as layers 2-3 to the cost/pantry invariant
      paragraph; add `plan-preferences.json` to the "data, not inline
      constants" list.
- [x] `SPEC.md`: only if it enumerates generator layers. (Left unchanged —
      it doesn't.)

### Manual pass

- [x] Generate a plan on `plan.html` — 14 days fill, no console errors.
- [x] Same seed date + library as `git show HEAD:` version ⇒ identical plan.
- [x] Swap picker order unchanged on two different days.
- [x] Console: `MP.Generator.rankSlot` with a `comfort` chip promotes comfort
      meals and still returns the full pool.

## Phase 23 — "Plan with me" setup screen

Spec: `.claude/specs/phase23_spec.md`. Decisions: D1 compact `.busy-grid`
(not literal `.day-row` reuse), D2 wire prefs into `plan.js` this phase
(both entry points), D3 `{updatedAt, busyDays, chips}` with no version field.
One-tap Generate stays one tap — it only becomes preference-aware.

### Logic & Backend Tasks (TDD — write the check first where marked)

- [x] New `plan-with-me.js`: `MP.PlanPrefs = { KEY, get, save }` with
      `KEY = "mp_planPrefs"`, IIFE + `"use strict"`, modelled on `prefs.js`
      (§2.1). No shared storage wrapper — one key, one module.
- [x] `get()`: defensive `JSON.parse(... || "{}")` in `try`/`catch`; filter
      `busyDays` to unique ints 1-14, `chips` to strings; never validates chip
      ids against the vocabulary; never throws (§1, §2.1).
- [x] `save(busyDays, chips)`: stamps ISO `updatedAt`, sorts `busyDays`
      ascending, writes, returns the saved object. No `v`/version field (D3).
- [x] Test group 41: `get()` with key absent, `"not json"`, `"null"`, `"[]"`,
      `"3"` → `{ busyDays: [], chips: [] }` each, no throw.
- [x] Test: `get()` filters `[0, 3, 15, "4", 3, 14]` → `[3, 14]`; keeps
      unknown chip ids; drops non-string chips.
- [x] Test: `save([11, 2], ["comfort"])` round-trips via `get()` with
      `busyDays` `[2, 11]` and a parseable ISO `updatedAt`; `save([], [])`
      round-trips to the empty shape.
- [x] `plan-with-me.js`: memoised `loadVocab()` — `fetch("plan-preferences
      .json")`, `.catch(() => null)` (§2.2). Returning `null` must be
      survivable everywhere it's used.
- [x] `plan.js`: build `prefs = { vocab, busyDays, chips }` once at init
      (module scope, beside `library`/`tagsData`) from `MP.PlanPrefs.get()`
      + `loadVocab()` (§5).
- [x] `plan.js:95`: pass `prefs` as `generatePlan`'s trailing 8th arg — this
      is the one-tap path too (D2).
- [x] `plan.js:269`: replace `candidatesFor`'s hardcoded `prefs: {}` in the
      `rankSlot` opts with the same `prefs` object.
- [x] Test: `generatePlan` with prefs from a saved `mp_planPrefs` differs from
      the `{}` call when a busy day + chip are set, and is **identical** when
      both are empty (guards the untouched one-tap behaviour).
- [x] Confirm `generator.js` is not modified in this phase at all (§"Non-goals").
- [x] Walk §"Edge cases" and confirm each row — especially corrupt JSON,
      `vocab: null`, and all-14-days-busy still filling a plan.

### UI & Layout Tasks

- [x] New `plan-with-me.html` from `plan.html`'s skeleton (same `<head>`,
      same inline `<nav class="nav">`, `initTheme()`); scripts are `data.js`
      + `plan-with-me.js` only (§3). No new nav link.
- [x] `#busy-grid`: 14 `<button class="busy-cell" data-day="N"
      aria-pressed="false">` with day number + short weekday, weekday derived
      from `new Date()` + offset via `toLocaleDateString` (no `generator.js`
      import just for `weekdayOf`).
- [x] `#chip-row`: rendered from `loadVocab()`'s `chips`, reading `id` /
      `label` / `kind` **only**; labels through `esc()`; row hidden entirely
      when vocab is `null`.
- [x] Prefill both from `MP.PlanPrefs.get()`; drop chip ids absent from the
      loaded vocabulary at prefill.
- [x] One delegated `click` listener per container; toggle the Set and flip
      the class + `aria-pressed` on that element only, no full re-render.
- [x] `#pref-summary` via `textContent` — e.g. "3 busy days · 2 preferences",
      or "No busy days, no preferences". Updates on every toggle.
- [x] `#pwm-generate-btn`: always enabled; `MP.PlanPrefs.save(...)` then
      `location.href = "plan.html?guided=1"`. Writes nothing but
      `mp_planPrefs` — no `mp_plan`, no `mp:plan-saved`.
- [x] Page controller no-ops when `#busy-grid` is absent (the file is also
      loaded on `plan.html` for `MP.PlanPrefs`).
- [x] `plan.html`: add `<a id="plan-with-me-btn" class="btn-secondary"
      href="plan-with-me.html">Plan with me</a>` after `#generate-btn` in
      `.top-actions` (line 37), and `<script src="plan-with-me.js">` before
      `plan.js`.
- [x] `style.css` beside `.day-row`/`.slot-grid` (≈499-528): `.busy-grid`
      (7 cols, all widths), `.busy-cell` (~44px+ tap target), `.busy-day`,
      `.busy-dow`, `.busy-cell.is-busy` (accent fill, mirroring
      `.chip.active`), `.chip-row`. Existing tokens only — no new colours.
- [x] Reuse the existing `.chip` / `.chip.active` (467-478) — no new chip CSS.
      Grep for `.btn-secondary` and reuse it; only add one if absent.
- [x] `sw.js`: bump `CACHE` (line 4) to `"meal-planner-v17"`; add
      `plan-with-me.html`, `plan-with-me.js` and `plan-preferences.json` to
      the shell array.

### Docs

- [x] `docs/roadmap.md` Phase 23 (52-59): replace "reusing the plan grid's
      markup" with the compact 7×2 `.busy-grid` description (D1); note the
      `plan.js` prefs wiring (D2); mark shipped.
- [x] `docs/ARCHITECTURE.md` 257-268: correct the `plan-preferences.json`
      example to the shipped shape — flat `keywords`/`tags`/`prepEffort` (no
      `match` wrapper), `busy` without `leftoverBias`, suffixed nutrient keys
      (`fibre_g`, `vitC_mg`).
- [x] `docs/ARCHITECTURE.md` 234-237: same D1 busy-grid wording fix; note
      `plan.js` reads `mp_planPrefs` for both entry points from Phase 23 and
      that `MP.PlanPrefs` is its only reader/writer.
- [x] `CLAUDE.md`: add `mp_planPrefs` ("settings, not plan state — losing it
      degrades to today's behaviour") and the "one-tap Generate is never
      replaced, only preference-aware" line.
- [x] `SPEC.md`: only if it enumerates pages; add `plan-with-me.html` if so.

### Manual pass

- [x] `plan.html`: one-tap Generate unchanged; "Plan with me" beside it.
- [x] `plan-with-me.html`: 14 cells in two rows of seven, whole fortnight
      visible without scrolling at phone width; cell 1 = today's weekday.
- [x] Tap 3 days + 2 chips → accent fill, summary updates; Generate lands on
      `plan.html?guided=1` and a plan generates (no walkthrough — expected).
- [x] Re-open the setup screen: same days and chips pre-selected.
- [x] `comfort` + busy days set → quick meals cluster on busy days; cleared →
      plan looks like it did before this phase.
- [x] `localStorage.removeItem("mp_planPrefs")` → both pages clean, no errors.
- [x] `mp_planPrefs` set to `"{{{"` → grid empty, no console exception.
- [x] Block `plan-preferences.json` in DevTools → chip row absent, busy grid
      and Generate still work.
- [x] Dark + light mode legible; offline load works from the v17 cache.

## Phase 24 — Guided walkthrough + review mode in `plan.js`

Spec: `.claude/specs/phase24_spec.md`. Decisions: G1 forward-only (no
back-stack, corrections happen at review via the existing two-tap day→Swap),
G2 an un-chosen/skipped slot keeps its generated meal, commit never blocked.
No new page — a state machine over the existing `#swap-overlay` deck and
plan grid.

### Logic & Backend Tasks

- [ ] `plan.js`: add module state `guidedActive` (bool) and `guided`
      (`{ days, idx }` or `null`) (§1).
- [ ] `setSlotMeal`/`setSlotVariant`: only call `savePlan()` when
      `!guidedActive` (§2). Confirm every other caller (normal swap deck,
      variant picker) is unaffected outside guided mode.
- [ ] `init()`: read `new URLSearchParams(location.search).get("guided")`.
      When `"1"`: set `guidedActive = true`, `plan = generatePlan()` (no
      `savePlan()`), call `startGuidedWalkthrough()`. Otherwise keep the
      existing `loadPlan(); savePlan(); renderPlan();` unchanged (§3).
- [ ] `startGuidedWalkthrough`/`renderGuidedStep`/`advanceGuided`/
      `finishWalkthroughLoop`: sequence `plan.days.map(d => d.day)`, dinner
      slot only, skip (no UI) any day whose `candidatesFor` is empty,
      G2-keep-and-advance on exhaustion (§4).
- [ ] `renderGuidedDeck`/`renderGuidedCards`: step-counter heading instead of
      "Swap {slot} — Day {n}"; swipe-right calls `setSlotMeal` then
      `advanceGuided()`; swipe-left removes the candidate and re-renders, or
      advances if none remain; tap still opens the recipe detail (§4.1).
- [ ] `closeSwapPicker()`: branch — `if (guided) return
      finishWalkthroughLoop();` before the existing hide/reset body (§4.2).
      Confirm this covers both the deck's `close-btn` and the
      overlay-backdrop click with no new listeners.
- [ ] `#guided-commit-btn` handler: `guidedActive = false; savePlan();
      history.replaceState(null, "", "plan.html");` hide the banner, toast
      "Plan saved" (§5).
- [ ] Confirm `generator.js`, `rankSlot`, `MP.PlanPrefs`, `plan-with-me.js`
      are not modified this phase (§"Non-goals").
- [ ] Walk §"Edge cases" and confirm each row — especially reload
      mid-walkthrough, ✕/backdrop exit, and zero-alternative days.

### UI & Layout Tasks

- [ ] `plan.html`: add `#guided-review-banner` (`class="banner hidden"`) near
      `#hermes-banner`, with `#guided-commit-btn` inside (§5). No new CSS —
      reuses `.banner`/`.btn`.
- [ ] Confirm the swipe deck opens immediately on `plan.html?guided=1` with
      no plan-grid flash first, and that the review grid only renders once,
      at the end of the loop.

### Docs

- [ ] `docs/roadmap.md` (74-93): mark Phase 24 shipped; correct the
      "existing per-slot `.day-swap-btn` affordance" wording to note it's
      two taps (open day → Swap), not one (§7).
- [ ] `CLAUDE.md`: add the `guidedActive`-flag invariant to the architecture
      list — it's what keeps the walkthrough and review step stateless on
      exit; don't add a second save path that bypasses it.

### Manual pass

- [ ] `plan-with-me.html` → Generate lands on `plan.html?guided=1`, deck
      opens on Day 1 immediately.
- [ ] Swipe right advances with a pick; swipe left through all 3 advances
      without one; tapping a card opens/closes the recipe detail correctly.
- [ ] After Day 14, deck closes, plan grid renders with the review banner.
- [ ] Day→Swap edit during review updates the grid but **not**
      `localStorage.mp_plan` (DevTools check) until "Looks good" is tapped.
- [ ] "Looks good" saves, hides the banner, drops `?guided=1` from the URL.
- [ ] Abandon mid-walkthrough or mid-review (close tab / navigate away) →
      reopening `plan.html` shows the plan exactly as it was before.
- [ ] Reload mid-walkthrough (`?guided=1` still in URL) → restarts cleanly
      from Day 1, no console error.
- [ ] ✕ / overlay-backdrop mid-walkthrough → jumps straight to review with
      remaining days at their generated meals.
- [ ] One-tap `#generate-btn` on a plain `plan.html` visit is unchanged.
- [ ] Dark mode: review banner and deck legible (no new CSS expected).
