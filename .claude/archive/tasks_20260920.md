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

- [x] `plan.js`: add module state `guidedActive` (bool) and `guided`
      (`{ days, idx }` or `null`) (§1).
- [x] `setSlotMeal`/`setSlotVariant`: only call `savePlan()` when
      `!guidedActive` (§2). Confirm every other caller (normal swap deck,
      variant picker) is unaffected outside guided mode.
- [x] `init()`: read `new URLSearchParams(location.search).get("guided")`.
      When `"1"`: set `guidedActive = true`, `plan = generatePlan()` (no
      `savePlan()`), call `startGuidedWalkthrough()`. Otherwise keep the
      existing `loadPlan(); savePlan(); renderPlan();` unchanged (§3).
- [x] `startGuidedWalkthrough`/`renderGuidedStep`/`advanceGuided`/
      `finishWalkthroughLoop`: sequence `plan.days.map(d => d.day)`, dinner
      slot only, skip (no UI) any day whose `candidatesFor` is empty,
      G2-keep-and-advance on exhaustion (§4).
- [x] `renderGuidedDeck`/`renderGuidedCards`: step-counter heading instead of
      "Swap {slot} — Day {n}"; swipe-right calls `setSlotMeal` then
      `advanceGuided()`; swipe-left removes the candidate and re-renders, or
      advances if none remain; tap still opens the recipe detail (§4.1).
- [x] `closeSwapPicker()`: branch — `if (guided) return
      finishWalkthroughLoop();` before the existing hide/reset body (§4.2).
      Confirm this covers both the deck's `close-btn` and the
      overlay-backdrop click with no new listeners.
- [x] `#guided-commit-btn` handler: `guidedActive = false; savePlan();
      history.replaceState(null, "", "plan.html");` hide the banner, toast
      "Plan saved" (§5).
- [x] Confirm `generator.js`, `rankSlot`, `MP.PlanPrefs`, `plan-with-me.js`
      are not modified this phase (§"Non-goals").
- [x] Walk §"Edge cases" and confirm each row — especially reload
      mid-walkthrough, ✕/backdrop exit, and zero-alternative days.

### UI & Layout Tasks

- [x] `plan.html`: add `#guided-review-banner` (`class="banner hidden"`) near
      `#hermes-banner`, with `#guided-commit-btn` inside (§5). No new CSS —
      reuses `.banner`/`.btn`.
- [x] Confirm the swipe deck opens immediately on `plan.html?guided=1` with
      no plan-grid flash first, and that the review grid only renders once,
      at the end of the loop.

### Docs

- [x] `docs/roadmap.md` (74-93): mark Phase 24 shipped; correct the
      "existing per-slot `.day-swap-btn` affordance" wording to note it's
      two taps (open day → Swap), not one (§7).
- [x] `CLAUDE.md`: add the `guidedActive`-flag invariant to the architecture
      list — it's what keeps the walkthrough and review step stateless on
      exit; don't add a second save path that bypasses it.

### Manual pass

- [x] `plan-with-me.html` → Generate lands on `plan.html?guided=1`, deck
      opens on Day 1 immediately.
- [x] Swipe right advances with a pick; swipe left through all 3 advances
      without one; tapping a card opens/closes the recipe detail correctly.
- [x] After Day 14, deck closes, plan grid renders with the review banner.
- [x] Day→Swap edit during review updates the grid but **not**
      `localStorage.mp_plan` (DevTools check) until "Looks good" is tapped.
- [x] "Looks good" saves, hides the banner, drops `?guided=1` from the URL.
- [x] Abandon mid-walkthrough or mid-review (close tab / navigate away) →
      reopening `plan.html` shows the plan exactly as it was before.
- [x] Reload mid-walkthrough (`?guided=1` still in URL) → restarts cleanly
      from Day 1, no console error.
- [x] ✕ / overlay-backdrop mid-walkthrough → jumps straight to review with
      remaining days at their generated meals.
- [x] One-tap `#generate-btn` on a plain `plan.html` visit is unchanged.
- [x] Dark mode: review banner and deck legible (no new CSS expected).

## Phase 25 — Hermes `planPrefs` sync + conversational flow trigger

Spec: `.claude/specs/phase25_spec.md`. Decision: D1 the new banner button acks
`planFlag` **immediately** on click (same moment as Dismiss), then navigates.
Trivial calls: KV key `"planPrefs"` (not `"prefs"` — already taken); one extra
button inside the existing `#hermes-banner`; a `syncPlanFlag`-style single
GET/PUT pair in `hermes-sync.js`, not a `fetchItems` list helper.
Pull happens on open of `plan-with-me.html` only (`ARCHITECTURE.md:128-129`).

### Logic & Backend Tasks (TDD — write the check first where marked)

- [x] `worker/worker.js` `KEYS` (11-15): add `"/planPrefs": "planPrefs"`.
      Confirm it does **not** collide with the existing `/prefs` → `"prefs"`.
- [x] `worker/worker.js`: new `planPrefsError(parsed)` beside `prefsError`
      (133-137), same size/style. Required: plain object; `updatedAt` a string
      that `Date.parse`es finite; `busyDays` an array of integers 1-14;
      `chips` an array of strings. Returns a reason string or `null` (§1.2).
- [x] `planPrefsError` must **not** validate chip ids against
      `plan-preferences.json`, and must **not** default missing fields —
      relay rule + the `/library` no-dietary-rules reasoning (§"Non-goals").
- [x] Duplicates in `busyDays` are **not** an error (the client's `get()`
      already dedupes) — don't add a second place that has to agree.
- [x] `worker/worker.js` `VALIDATE` (163-172): add `planPrefs: planPrefsError`.
- [x] Read the `fetch` handler (174-226) and confirm **no change is needed** —
      `KEYS`/`VALIDATE` drive auth, GET, PUT, CORS, 404/405 already (§1.4).
      If you find yourself editing it, stop and re-read §1.
- [x] `planPrefsError` verified standalone in Node against the §8 bad/good
      bodies (`{}`, bad `updatedAt`, `busyDays:[0,15]`, `chips:[7]`, `[1,2,3]`
      each reject with a reason; a good body and an unknown-chip-id body both
      pass). Live curl against a deployed Worker (§8 steps 1-5, plus the
      `/prefs` no-collision check) is still a manual step — no Worker deploy
      target in this sandbox.
- [x] `hermes-sync.js`: private `localPlanPrefsStamp()` → raw `updatedAt` from
      `localStorage[MP.PlanPrefs.KEY]`, `""` on missing/corrupt (§2.1).
      `MP.PlanPrefs.get()` drops `updatedAt`, which is why this exists.
- [x] `hermes-sync.js`: `fetchPlanPrefs()` — no-op to `MP.PlanPrefs.get()`
      when `!config().enabled`; `GET /planPrefs` in `try`/`catch`; reuse the
      existing `decide()` (22-28, generic despite its comment) →
      pull / fire-and-forget push / noop. Returns
      `{ busyDays, chips }` always. Never throws (§2.1).
- [x] Pull branch writes **through `MP.PlanPrefs.save()`**, never
      `localStorage.setItem` — keeps `MP.PlanPrefs` the only writer and
      re-runs its filters on a Worker-bypassing body (CLAUDE.md invariant).
- [x] `hermes-sync.js`: `pushPlanPrefs()` — PUTs the **stored** object with
      its existing `updatedAt` (no re-stamp), `.catch(() => {})`, no-op when
      disabled or nothing stored. Same contract as `pushPrefs` (§2.2).
- [x] Export `fetchPlanPrefs, pushPlanPrefs` from `MP.Sync` (358-361); keep
      `localPlanPrefsStamp` private.
- [x] Test group 42: `decide` with a `planPrefs`-shaped remote → `"pull"` /
      `"push"` / `"noop"` / `remote = null` → `"push"` (confirms the reuse).
- [x] Test: corrupt local `mp_planPrefs` (`"{{{"`, `"null"`, `"[]"`) loses to
      a valid remote — assert `"pull"`.
- [x] Test: pull coercion — `MP.PlanPrefs.save([0,"3",15,7,7],
      ["comfort",3,null])` round-trips via `get()` to
      `{ busyDays: [7], chips: ["comfort"] }`.
- [x] Confirm `generator.js`, `nutrition.js`, `plan-preferences.json` and the
      `MP.PlanPrefs` implementation itself are **not** modified.
- [x] Walk §"Edge cases" and confirm each row — especially `"null"` from an
      unwritten key, a garbage remote body never clearing local prefs, and
      every bridge failure degrading to local prefs with no visible error.

### UI & Layout Tasks

- [x] `plan.html` `#hermes-banner` (~30-34): add
      `<button id="hermes-plan-with-me" class="btn">Plan with me</button>`
      between `#hermes-generate` and `#hermes-dismiss`. Existing `.banner` /
      `.btn` classes only — **no new CSS** (§4.1).
- [x] If three buttons wrap badly at phone width, add `flex-wrap` to the
      existing `.banner` rule — not a new banner layout. (Not needed — no
      overflow observed; left as-is per the spec's "if" clause.)
- [x] `plan.js` (beside the handlers at 845-854): `#hermes-plan-with-me` →
      `await MP.Sync.ackPlanFlag(pendingRequestedAt)` in `try`/`catch`, then
      `location.href = "plan-with-me.html"`. No query param (§4.2, D1).
- [x] Confirm `initHermesBanner()` (742-749) and both existing handlers are
      **unchanged**, and `pendingRequestedAt` (740) is reused as-is.
- [x] `plan-with-me.html`: add `<script src="hermes-sync.js"></script>` before
      `plan-with-me.js`. Only markup change to this page (§5).
- [x] `plan-with-me.js` prefill: swap `MP.PlanPrefs.get()` for
      `MP.Sync ? await MP.Sync.fetchPlanPrefs() : MP.PlanPrefs.get()` — same
      return shape, so the vocabulary-drop step is untouched (§3).
- [x] `plan-with-me.js` `#pwm-generate-btn`: after `MP.PlanPrefs.save(...)`,
      call `MP.Sync.pushPlanPrefs()` **un-awaited**, then navigate as today.
      Never await it — that would put the bridge on the path of a tap.
- [x] Confirm the setup screen still writes nothing but `mp_planPrefs` (no
      `mp_plan`, no `mp:plan-saved`) and one-tap `#generate-btn` on
      `plan.html` is byte-identical.
- [x] `sw.js`: bump `CACHE` (line 4) one step from its **current** value (read
      it, don't assume). No shell-array additions — no new files this phase.

### Docs

- [x] `docs/roadmap.md` Phase 25 (92-107): note D1 and that the Worker's
      `fetch` handler needed no change; mark shipped.
- [x] `docs/ARCHITECTURE.md` v4 Hermes section (322-334): pull entry point is
      `MP.Sync.fetchPlanPrefs()` from `plan-with-me.js`'s prefill, push is
      `pushPlanPrefs()` fired un-awaited on Generate, and the banner's "Plan
      with me" acks `planFlag` on click (D1) — so `ackedAt` means "the user
      responded", not "a plan exists", for it and Dismiss alike. Lines 112-115
      and 141 are already correct; leave them.
- [x] `CLAUDE.md`: one line on the `mp_planPrefs` invariant — `MP.PlanPrefs`
      stays the only reader/writer; `hermes-sync.js` goes through it.
- [x] `SPEC.md`: no change expected (no new page, no new user-facing rule).

### Manual pass

- [ ] §8 steps 1-5 curl checks pass (see the Logic tasks above).
- [ ] Newer remote body → `plan-with-me.html` shows the remote selection and
      `mp_planPrefs` matches it.
- [ ] Change the selection, tap Generate → `GET /planPrefs` shows the new body.
- [ ] Local `updatedAt` edited forward → remote is overwritten, nothing pulled.
- [ ] Bridge config cleared / Worker blocked → screen prefills from local,
      Generate works, no visible error.
- [ ] Full Hermes flow: `PUT /planPrefs` then `PUT /planFlag` → banner shows
      three buttons; "Plan with me" acks immediately (`ackedAt ===
      requestedAt` on `GET /planFlag`) and opens the prefilled screen.
- [ ] Back on `plan.html`: banner stays hidden; Generate/Dismiss unchanged on
      a fresh `requestedAt`.
- [ ] Offline after one load: both pages from the bumped cache, local prefill,
      no console exception.
- [ ] Dark + light mode: three-button banner legible, no overflow at phone
      width.

## Phase 26 — Hermes `GET /ranking` (read-only, computed in the Worker)

Spec: `.claude/specs/phase26_spec.md`. Decision: D1 — export `chipHits` and
`activeChips` from `MP.Generator` (`generator.js:266`); the Worker owns **no**
chip logic. Trivial calls: the Worker mirrors `plan.js`'s `candidatesFor`
(266-275) for its `rankSlot` args but **keeps the current meal in the pool**;
`shortOn` recomputed via `dayCoverage` rather than returned out of `rankSlot`;
`covers` needs no new export (`MP.Nutrition.tagsForMeal`); plain-string 400/409
bodies in the existing `json(status, reason)` style; all four slot types
accepted. **No `PUT /ranking`, ever** — the write path stays `/placements`.

### Logic & Backend Tasks (TDD — write the check first where marked)

- [x] `nutrition.js`: replace `window.MP = window.MP || {};` (line 3) and the
      bare IIFE (5, 98) with the `exclusions.js` shim shape —
      `(function (root) { const MP = (root.MP = root.MP || {}); … })(typeof
      globalThis !== "undefined" ? globalThis : this);` (§1.1). Body unchanged.
- [x] `generator.js`: same shim (lines 5, 7, 267). Body unchanged. Confirm no
      `window.` reference remains in either file.
- [x] Confirm `MP.Nutrition.load()` is **left as-is** and that nothing added
      this phase calls it — it is browser-only `fetch` (§"Findings").
- [x] TDD: Node harness importing both files with no `window` — assert
      `globalThis.MP.Nutrition.dayCoverage` and `globalThis.MP.Generator.rankSlot`
      exist and `rankSlot` runs against the seed library (§7 steps 1-2).
- [x] `generator.js:266` (D1): export list becomes
      `{ generatePlan, rankSlot, weekendRuns, weekdayOf, isoToday, pickVariant,
      chipHits, activeChips }`. **No function body is touched** (§1.2).
- [x] `worker/worker.js` (beside 4-6): `import "../nutrition.js";
      import "../generator.js";` + default imports of
      `ingredient-nutrient-tags.json`, `nutrition-targets.json`,
      `plan-preferences.json`; `const Nutrition/Generator = globalThis.MP.…`
      beside line 8 (§2). No `wrangler.toml` change, no new dependency.
- [x] Confirm `data.js` / `shelf-life.js` / `shopping-list.js` are **not**
      imported — `rankSlot` never touches `MP.isBatch`, `MP.ShelfLife`,
      `MP.effectiveMeal`, `MP.ShoppingList` (§"Findings").
- [x] `worker/worker.js` `fetch` handler: one `/ranking` branch beside
      `/discover`'s (198-201), **before** the `KEYS` lookup; 405 on non-GET
      (§3.1). `KEYS`/`VALIDATE`/the PUT block stay untouched.
- [x] New `async function ranking(params, env)` near `discover` (34-62) (§3.2).
- [x] Validation (400s): `day` required integer 1-14 (`"day must be 1-14"`);
      `slot` defaults `"dinner"`, else must be in `SLOT_TYPES`; `n` defaults
      `3`, else integer 1-10. Use `Number.isInteger(Number(v))`, **not**
      `parseInt` (`parseInt("5abc") === 5`).
- [x] State load: `Promise.all` of `library`/`plan`/`planPrefs` KV. Missing,
      `"null"`, unparseable, empty-array `library` or `days`-less `plan` →
      **409** `"library and plan must be synced first"`. Missing `planPrefs`
      is **200** with `{ busyDays: [], chips: [] }` — never a 409.
- [x] `rankSlot` call mirrors `candidatesFor`: `others` = the day's other
      slots, `prefs = { vocab: PLAN_VOCAB, busyDays, chips }`, pool filtered by
      `mealTypes`. **No `prefer`, no `budget`, no `halfKeys`, no
      `lastUsedDay`, no `excludeIds`**, and the current meal stays in the pool.
- [x] Annotation: `shortOn` from `dayCoverage(others,…).missing + .partial`;
      per candidate `covers = tagsForMeal(m, TAGS)` ∩ `shortOn`;
      `chipHits` = ids from `Generator.chipHits` over
      `activeChips(prefs).prefer.concat(.avoid)` — **both** kinds listed;
      `prepEffort` defaults `"quick"`.
- [x] Response exactly per `ARCHITECTURE.md:351-357`: `day`, `slot`, `shortOn`,
      `current` (`variantId` always present, `null` for base; `null` when the
      slot is empty), `candidates` (`rank` 1-based), `busyDay`, and
      `approximate: true` **unconditionally**.
- [x] Confirm the Worker performs **no** `env.MP_KV.put` on this path and that
      no `PUT /ranking` exists (§"Non-goals" — never, not "not yet").
- [x] Confirm no chip/nutrient rule got copied into `worker.js` — if there's an
      `if (chip.keywords…)` in the Worker, D1 was implemented wrong
      (`ARCHITECTURE.md:377-379`).
- [x] Test group 43: `MP.Generator.chipHits` and `activeChips` are exported
      functions (the un-export regression guard).
- [x] Test: `chipHits` — name keyword, ingredient-key keyword, `"high"` tag,
      `prepEffort`, no-match → `false`, criteria-less chip → `false`, meal with
      no `ingredients` → no throw.
- [x] Test: `activeChips` — splits by `kind`, drops unknown ids, and `{}` /
      `null` / no-`vocab` → `{ prefer: [], avoid: [] }`.
- [x] Test: `covers` derivation — `tagsForMeal(m, tags).filter(t =>
      shortOn.includes(t))` keeps only the intersection, `[]` when nothing.
- [x] Groups 1-42 still pass — they are the real regression test for the shim.
      `rankSlot` itself is **not** re-tested (group 22 stands; no logic change).
- [x] Walk §"Edge cases" and confirm each row — especially the 409 vs. 200
      split on missing `planPrefs`, an empty pool returning 200, and a
      `mealId` absent from `library` not crashing `current`.

### UI & Layout Tasks

- [x] None — `/ranking` adds no page, no markup, no CSS. Confirm `plan.js`,
      `plan.html`, `plan-with-me.*`, `style.css` are **unmodified**.
- [x] `sw.js`: bump `CACHE` (line 4) one step from its **current** value (read
      it, don't assume). No shell-array additions — `worker/worker.js` isn't in
      the PWA shell and both shimmed files are already listed.

### Docs

- [x] `docs/roadmap.md` Phase 26 (116-140): record D1, that bundling resolved
      to the existing `exclusions.js` import pattern (no build-step change),
      and that `covers` needed no new export; mark shipped.
- [x] `docs/ARCHITECTURE.md` `GET /ranking` (343-373): leave the JSON block and
      bullets as-is; add only the two new `MP.Generator` exports in the 360-363
      bullet, the `root` shim on `nutrition.js`/`generator.js`, and the
      `candidatesFor`-mirroring-but-keeps-current-meal note.
- [x] `CLAUDE.md`: one line — the `window` → `root` shim now covers
      `nutrition.js` and `generator.js` too (the Worker imports them); don't
      reintroduce a bare `window.` there. Optional half-line: `rankSlot` has a
      fourth caller and still must not be copied.
- [x] `SPEC.md`: no change (no page, no user-facing rule) — confirm explicitly.

### Manual pass

- [x] §7 steps 1-2: Node shim smoke test passes (see the Logic tasks above).
- [ ] `GET /ranking?day=5` → 200, `slot:"dinner"`, 3 candidates,
      `approximate: true`. `?day=5&slot=lunch&n=10` → `rank` 1..n ascending.
- [ ] Every bad param → 400 with its reason: `day=0`, `day=15`, `day=abc`,
      `day` omitted, `slot=brunch`, `n=0`, `n=11`.
- [ ] Empty/absent `library` → 409; same for `plan`; restore → 200.
- [ ] Delete `planPrefs` → 200, `busyDay: false`, all `chipHits` empty.
- [ ] `PUT /planPrefs` with `busyDays:[5]` + a chip id → `busyDay: true`, the
      chip id appears in `chipHits`, prefer-matches lead `candidates`.
- [ ] `PUT /ranking` → 405; `OPTIONS` → 204 + CORS; no token → 401;
      `GET /rankings` → 404.
- [ ] Worker order matches the app: the swap picker for the same day/slot shows
      the same order once the current meal is removed.
- [ ] `/plan`, `/library`, `/planPrefs`, `/placements`, `/discover` all
      unchanged — they share the handler.
- [ ] Browser regression: `test.html` all green (1-43) — **384 passed, 1
      failed** (`run-day-1 is MP.isBatch; leftover days are same id or
      leadsTo child`), pre-existing and unrelated to this phase (no
      batch/leftover code touched); group 43 itself is all green. Needs a
      look before calling this row done. `index.html`/`plan.html` manual
      generate/swap/save pass not yet done (no browser MCP in this sandbox).
- [ ] Offline after one load: both pages from the bumped cache, no new failure
      path (the app never calls `/ranking`).
