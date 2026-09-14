# Roadmap

Active roadmap. Superseded versions live in `.claude/archive/` — this file is
updated in place, never forked into a versioned copy.

Source of scope: `docs/OUTLINE.md`'s "Meal Planner — v4 Outline" must-haves,
against the file/endpoint plan in `docs/ARCHITECTURE.md`'s "v4 — guided
planning ("Plan with me") + ranking read access". v4 has no nice-to-haves —
ideas raised during the interview are parked in `docs/FUTURE.md` and are
explicitly not sequenced here.

Previous roadmap (Phases 1-15, all shipped) archived at
`.claude/archive/roadmap_20260906.md`. Previous roadmap (Phases 16-21, all
shipped) archived at `.claude/archive/roadmap_20260913.md`.

---

# v4 — guided planning (Phases 22-26)

Architecture calls out three kinds of work in this version, and they are not
interchangeable:

- **Generator logic:** Phase 22 (`rankSlot` + chip/busy layers).
- **Setup screen / UI:** Phase 23 (`plan-with-me.html`), Phase 24 (the
  walkthrough + review state machine in `plan.js` — no new page).
- **Hermes / Worker:** Phase 25 (`/planPrefs` relay), Phase 26 (`/ranking`).

`rankSlot` is the single ranking source for all three consumers (in-app
walkthrough, review swap picker, Worker `/ranking`), so Phase 22 lands first
and both the walkthrough (24) and the Worker endpoint (26) depend on it.
Phases 25 and 26 are sequenced last because Hermes read/propose access is
additive — the guided flow is fully usable in-app without either.

## Phase 22 — `rankSlot` extraction + chip/busy ranking layers — shipped

**Goal:** Split `pickMeal` into `rankSlot(...) → ranked[]` (with
`pickMeal = rankSlot(...)[0]`), export it on `MP.Generator`, and add the new
preference layers: `plan-preferences.json` chip vocabulary (layer 2,
prefer-to-head / avoid-to-tail) and busy-day effort bias (layer 3), plus the
busy-day effect on batch/leftover run selection. `generatePlan` gains a
trailing optional `prefs` arg.

*First, because every other v4 phase consumes it — the walkthrough, the review
picker and the Worker's `/ranking` all read the same ranked list, and building
any of them first would mean inventing a second ranking to throw away.
Inherits the v4 invariant that chips/busy are layers 2-3 only: they reorder
what `MP.Nutrition.rankByGap` produced and never re-score nutrition (same rule
as cost in Phase 17 and pantry variants in Phase 21). Chips are a reorder, not
a filter, so a plan can never fail to fill. Ships headless — no UI yet, prefs
simply default to empty and the existing one-tap Generate behaves identically.*

## Phase 23 — "Plan with me" setup screen — shipped

**Goal:** New `plan-with-me.html` + `plan-with-me.js`: a compact 7×2
`.busy-grid` of 14 tap-toggle buttons (mirroring the plan grid's *shape*, not
its markup — `.day-row` is a rotated card with nested slot cards, unusable as
a cell) and a chip row rendered from `plan-preferences.json`, prefilled from
`mp_planPrefs`, whose Generate button saves prefs and navigates to
`plan.html?guided=1`. Also wires the prefs into `plan.js` — the generate path
(`generatePlan`'s 8th arg) and the swap picker's `rankSlot` call — so saved
prefs apply to **both** entry points and the screen's effect is visible this
phase. Adds the entry button beside `#generate-btn` on `plan.html`, the
busy-grid styles in `style.css` (the `.chip` class already exists), and the
new files to `sw.js`'s shell list + cache bump.

*Pure setup-screen UI — the only genuinely new page in v4. Strictly it needs
only `mp_planPrefs` and the chip vocabulary to exist, so it could be built
alongside Phase 22 rather than after it; sequenced after anyway so the chip
list it renders is the one the generator actually scores against, rather than
being rebuilt when the vocabulary settles. Cheap to reorder if the UI is the
more appealing thing to build first. One-tap Generate stays untouched — this
is a second entry point, never a replacement.*

## Phase 24 — Guided walkthrough + review mode in `plan.js` — shipped

**Goal:** The `guided=1` step-through state machine: loop the existing
`#swap-overlay` / `renderSwapCards()` swipe deck over the ~14 dinner slots
showing `rankSlot`'s top 3 candidates, then land on the existing plan grid as
a review step with the existing day→Swap affordance (inside the day detail
sheet, two taps: open day → Swap) and a "Looks good" commit button.
Breakfast/lunch/snack stay auto-filled, unchanged.

*Adds no new component by design — building a second page for the choice and
review steps would duplicate `renderPlan`, the swipe deck and the detail
sheet, so the cost is a small state machine in `plan.js` instead. Depends on
Phase 22 for the candidate list and Phase 23 for the prefs the flow is entered
with. Must preserve the v4 invariant that the flow is stateless on exit:
abandoning it leaves `mp_plan` untouched, and only the final commit writes,
through the same save path as one-tap generate so `mp:plan-saved` → `pushPlan`
still fires exactly once.*

## Phase 25 — Hermes `planPrefs` sync + conversational flow trigger — shipped

**Goal:** `GET`/`PUT /planPrefs` on `worker/worker.js` as a generic two-key
relay in the style of `/pantry` (body `{ updatedAt, busyDays, chips }`,
shape-validated only), the matching pull/push in `hermes-sync.js`, and a
second button on the existing plan-request banner that opens
`plan-with-me.html` prefilled from the pulled prefs instead of generating
immediately.

*First of the two Hermes phases and the smaller one: "trigger the interactive
flow" needs no new endpoint at all — Hermes PUTs `/planPrefs` then the
existing `PUT /planFlag`, so this is a relay plus one banner button. Chip ids
are deliberately not validated against `plan-preferences.json` (the generator
ignores unknowns), so a vocabulary edit can never lock out a write — same
reasoning as `/library`'s no-dietary-rules rule. Depends on Phase 23 for the
screen the banner button opens.*

D1: the new "Plan with me" banner button acks `planFlag` immediately on
click (same moment as Dismiss), then navigates — `ackedAt` means "the user
responded", not "a plan exists", for both buttons. The Worker's `fetch`
handler needed no change at all: `KEYS`/`VALIDATE` already drive routing,
auth, and CORS generically, so the whole Worker diff was one `KEYS` entry and
one validator function.

## Phase 26 — Hermes `GET /ranking` (read-only ranking access) — shipped

**Goal:** One read-only Worker route
(`GET /ranking?day=<1..14>&slot=dinner&n=<1..10>`) covering both "why was X
picked" and "give me the top N" — the same computation — by importing the
app's own `nutrition.js` + `generator.js` (`rankSlot`) with bundled
`ingredient-nutrient-tags.json` / `nutrition-targets.json` /
`plan-preferences.json` over the `library`, `plan` and `planPrefs` KV values.
Includes the `window` → `root` shim on `nutrition.js` and `generator.js` that
`exclusions.js` already has.

*Last, and the only phase that makes app modules run outside the browser —
sequenced after the generator work is final so the shim wraps a settled
`rankSlot` rather than one still being reshaped. No new state and no writes:
`approximate: true` is always set, flagging both that `current` comes from the
stale-by-construction `plan` mirror and that layers 4-5 (cost shortlist,
pantry variant) are not applied server-side, since the Worker carries neither
`pack-sizes.json` pricing nor a pantry index. **No `PUT /ranking`, ever** —
Hermes acts on a ranking only through the existing `/placements`
propose-then-app-applies queue, which the app still re-checks against local
`mp_plan`. v4 adds no write path.*

*Resolved (D1, `.claude/specs/phase26_spec.md`): bundling is the existing
`exclusions.js` import pattern (`wrangler` bundles the ES module imports and
the JSON defaults at deploy, no build-step change) — no separate
inlined-vs-fetched question. `chipHits`/`activeChips` are exported from
`MP.Generator` and the Worker calls them per-candidate rather than
reimplementing the chip rule; `shortOn` is `dayCoverage(others,…).missing`
concat `.partial`, recomputed in the Worker since `rankSlot` doesn't return
it. `covers` needed no new export — `MP.Nutrition.tagsForMeal` already
existed.*

---
