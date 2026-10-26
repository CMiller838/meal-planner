# Done phases (archived from docs/roadmap.md)

Sections moved unchanged once a phase is `— done`. History, not active tracking.

## Phase 27: Budget soft-preference — done

**Goal:** A user-set target cost (per plan or per week) that turns up how
hard `generator.js`'s existing `budget` step (layer 4, `generator.js:121-140`)
leans cheap — widening/weighting the `shortlistSize` shortlist it already
picks from. New knobs are data in `pack-sizes.json`'s `planning` block
(alongside today's `shortlistSize: 4` / `reuseCredit: 0.60`), plus the control
to set the target and persist it with the other plan preferences.

*First, because it is the smallest must-have with no dependencies and the most
immediate payoff — it adds no new file, no new endpoint and no new concept,
just a dial on machinery that has shipped since Phase 17. Strictly a
soft-preference: no hard cap, and because the step only reorders among
candidates `rankByGap` already ranked top, a budget target can never reorder
nutrition nor make a plan fail to fill.*

**Resolved:** adaptive pro-rata pressure (1B), not a static dial — `place()`
accumulates spend per half as it fills the plan, and `pickMeal` feeds a 0..1
"how far over pace" figure into `rankSlot`, which widens the cost shortlist
(never re-scores nutrition, never filters). Per-week/per-half (2A), reusing
the day-1/day-8 partition `halfKeys` already maintains — a week-1 blowout
never biases week 2. Stored as `mp_planPrefs.budgetTarget` (3A), a plain
£/week number where `0` means no target, same settings-not-plan-state class as
`busyDays`/`chips`.

## Phase 28: Generic ingredient-substitution groups — done

**Goal:** A data file of swappable ingredient groups (e.g. onion/pepper as
"aromatic veg"), letting the generator substitute an equivalent ingredient
into one slot's recipe when another slot already requires a group-mate — so
one pack covers two dinners. Swaps are restricted to the file's defined groups
(never free-form) and must still pass the hard content exclusions after
substitution.

*After 27 because the payoff is measured through the very same layer-4
machinery 27 re-tunes — the `budget` step's per-ingredient overlap credit is
exactly what a consolidating substitution is trying to earn, so building this
against a shortlist about to be re-weighted means scoring it twice. Soft
ordering only: cheap to swap with 27 if the substitution work is the more
appealing build. Note for the spec: a narrow `substitutions.json` already
exists (exclusion swap-ins keyed by excluded substring, read by `mealdb.js`
and `worker/worker.js`) — the spec must decide extend-vs-new-file rather than
assume a greenfield data file, and whichever wins, exclusions are enforced
after the swap, never bypassed by it. `shopping-list.js`'s `normalizeKey`
ponytail note already names an alias map as its upgrade path; that is adjacent
to this table and worth checking for overlap before inventing two.*

**Resolved:** new `substitution-groups.json` (D1) — kept separate from
`substitutions.json`'s exclusion swap-ins so `mealdb.js`/`worker/worker.js`
get a zero-line diff. A swap is materialised on the plan slot as `slot.subs`
(D2), resolved through `MP.effectiveMeal`/`MP.applySubs` so the shopping list,
pantry deduction, shelf-life pass and detail sheet all see it. Scored in
`generator.js`'s existing layer-4 `budget` step via a new `subCredit`
(`pack-sizes.json`), kept below `reuseCredit` so an exact overlap always
outranks a swap. Seed data ships one real group from the current library
(`onion`/`peppers`) rather than invented pairings that don't hold up
ingredient-for-ingredient.

## Phase 29: Live-build-watching (staged local generation render) — done

**Goal:** When a Hermes-raised plan request is accepted from the existing
banner, render the plan filling in slot-by-slot as the local `generatePlan`
loop produces picks, instead of snapping straight to a finished grid.

*Decided at the roadmap gate (Gate 1, Path A — answered directly by the user):
what gets watched is **the app's own generation**, not remote activity. Hermes
never generates a plan — `PUT /planFlag` only raises the banner and `plan.js`
runs `generatePlan()` locally — so a staged local render is the only mechanism
that can be genuinely per-pick, and it needs no endpoint, no polling and no
new infrastructure. The rejected alternative was polling `GET /placements`
while a "building" view is open; it was rejected because KV's ~60s eventual
consistency makes that chunky rather than live, and because it spends network
on watching a queue the app already pulls on `visibilitychange`. Worker push
(SSE / Durable Objects) was never in scope: a new stateful Cloudflare
primitive to watch a browser-side loop. Depends on nothing; placed third only
so the render path isn't re-verified against two generator changes. No new
write path — v4's rule that every Hermes plan write goes through
`/placements` propose-then-app-applies is unchanged.*

**Shipped:** cosmetic CSS-stagger reveal of an already-final plan, not a live
generator trace (`generator.js` gets a zero-line diff, confirmed by spec).
`renderPlan(staged)` gains one optional boolean, defaulting falsy for every
existing bare call site; only the `hermes-generate` handler passes `true`.
Staged cards get `.staging` on `#plan-root` plus a per-card `animationDelay`
(30ms/card, capped 1800ms) driving one new `@keyframes mp-slot-in` in
`style.css`, opacity/transform only so nothing reflows; `prefers-reduced-motion:
reduce` shows the full grid instantly. Coverage/warnings are computed once
against the final plan, not per stage. `sw.js` cache bumped to v22.

## Phase 30: Hermes quantity ingestion (screenshot → structured quantities) — done

**Goal:** The data path that gives `meals.json` ingredients and pantry items
real quantities: Hermes reads user-sent shopping screenshots and writes
structured quantity updates through the existing Worker+KV relay pattern
(fetch-then-write, shape-validated only, same shape as `/pantry` / `/library`),
plus whatever quantity shape the app agrees to accept.

*Split from Phase 31 at the roadmap gate (Gate 2, Path B — answered directly
by the user) because the quantity **data shape** is the one genuinely unknown
thing in v5, and speccing remainder arithmetic on a shape that hasn't survived
contact with a real screenshot is the classic rework trap. Ships no visible
user feature on its own — that is the accepted cost of landing the shape
first. Explicitly not Asda scraping or any unofficial API: the outline
re-confirms that non-goal, and `docs/FUTURE.md` keeps a live/official grocer
feed parked pending a real partner/affiliate API.*

**Shipped.** Gates: 1A (`{value, unit, raw}`, all three required when
present), 2A (extend the existing `pantry`/`adhoc` items — no new KV key, no
new route), 3A (quantity only — no price, no pack size, no purchase date).
`worker/worker.js`'s `itemsError` gained one validator (`qtyError`); no route,
`KEYS`, CORS or auth change. `MP.ShoppingList.parseQty` is the only reader of
the structure and `MP.qtyText` (`data.js`) the only reader of its display
text; every existing pantry/ad-hoc display and arithmetic site (`buildLists`,
`mealCost`, `applyOps`'s `"sub"` branch) got the object for free through those
two chokepoints. A cook deduction still collapses a structured qty to a
string via `fmtRemaining` — `raw` provenance is lost at that point, expected
and left to Phase 31. `sw.js` cache bumped to v23, no new file.

## Phase 31: Partial-ingredient leftover tracking — done

**Goal:** Pantry items carry a real quantity rather than present/absent, so a
recipe using half a pack leaves a trackable remainder the next day's plan can
draw on. Touches the pantry read path (`shopping-list.js`'s `pantryIndex` /
`pantryOverlap` / `eatPlan`, and `generator.js`'s `pickVariant`) and the single
pantry write path (`plan.js`'s `commitCook`).

*Last, and the only phase in v5 with a hard prerequisite — it cannot work
before Phase 30 lands real quantities. Two existing ponytail notes already
mark this exact ground and should be read as the spec's starting point:
`shopping-list.js:20-23` ("the fix for imprecise totals is filling in
meals.json quantities, not a smarter parser") and `generator.js:148` ("no
plan-wide pantry depletion — two meals may both count the last tin as in
stock"). This is an upgrade of the existing free-text `qty` field, not a new
one. Per the outline's Constraints this is a deliberate, scoped relaxation of
the "category-based shelf-life, no per-SKU tracking" invariant — **quantities,
not purchase dates**, and category-based shelf-life stays the default for any
item without a tracked quantity. `commitCook` must remain the only pantry
writer; `eatPortion` must still never touch anything pantry-related.*

**Shipped.** Gates: 1B (a computed remainder is structured `{value, unit,
raw}`, reusing Phase 30's shape — not a plain string), 2A (`pantryOverlap`
upgraded in place to mean "on hand **in sufficient quantity**", with
unparseable/unit-mismatched/amount-unknown stock falling back to "present"),
3A (`eatPlan` and `applyOps` stay two callers of one shared function, no op
field carrying a pre-computed remainder). `fmtRemaining` is renamed
`remainingQty` and now returns `{value, unit, raw}` — `value` rounds to 3dp to
kill float residue across repeated partial eats, `raw` is display text at
≤1dp and keeps its unit even at zero (fixing the old bare `"0"` defect that
caused a false "units differ" on a second cook against an emptied pack). The
pantry is now a running balance: `hermes-sync.js`'s `applyOps` and
`shopping-list.js`'s `eatPlan` are unchanged callers of the one shared
implementation. `generator.js:190-192`'s plan-wide depletion ceiling
deliberately survives — scoring still runs against one static pantry
snapshot per generation, so two slots can still both count the same last tin;
only per-slot "is there enough for *this* meal" is quantity-aware now.
`worker/worker.js`, `generator.js`'s code, `discover.js`, `shelf-life.js` and
every `*.json` data file stayed zero-line diffs. `sw.js` cache bumped to v24,
no new file.

---

## Phase 32: Personal-assistant connector (shopping list + "I ate X" queue) — done

**Goal:** The personal assistant (`notion_assistant`, its Phase 15 / ADR-054)
reads the planned two-week shopping list and queues voice-logged meals, with
its own credential — never Hermes's.

**Shipped; Worker deployed 2026-10-12** (live: `ASSISTANT_TOKEN` gets 200 on its five routes, 403 on `/pantry` and `PUT /plan`, 401 for a wrong token; the assistant's `/shopping` call returned the real 14+14-line list). `worker/worker.js` accepts a second
token, `ASSISTANT_TOKEN`, scoped to `GET /library`, `/plan`, `/eaten-log`,
`/shopping` and `GET`/`PUT /eat-requests` (anything else answers 403 for it).
`GET /shopping` runs `MP.ShoppingList.buildLists` itself over the KV plan
mirror, library and pantry, with `pack-sizes.json` imported and passed in, so
there's still one list implementation. That's why the `window` → `root` shim
now also covers `data.js`, `shelf-life.js` and `shopping-list.js`.
`PUT /eat-requests` is a request queue modelled on `/placements`.
`hermes-sync.js`'s `syncEatRequests` applies new requests on the plan page,
after `syncPlacements`, through `plan.js`'s `applyEatRequests`. That function
uses the same eat flow as the Eat sheet: an open cook is a portion and never
touches the pantry, otherwise it's a cook at the planned quantities via
`eatPlan` and the shared `applyCookOps`. The request's `eatenAt` is kept, so
the eaten-log id matches the assistant's row. A request with no un-eaten slot
holding that meal on that day is rejected in the existing banner, never
forced. The `/plan` push already carried `subs` (Phase 28). Verified with 495
passing `test.html` checks, including `matchEatRequests` and parity between
`buildLists` over the `/plan` mirror and over the local plan. Against
`wrangler dev`: `/shopping`, `/eat-requests` validation, 401 on a wrong token
and 403 outside the assistant's scope. A headless run of `plan.html` applied a
queued request and showed the rejection banner. `sw.js` is at v25.

**Deploy:** `wrangler secret put ASSISTANT_TOKEN`, then `wrangler deploy`.

**Amended 2026-10-17 (assistant Phase 32a):** `ASSISTANT_ALLOWED` also covers `GET /discover`, `GET|PUT /pantry`, `/adhoc`, `/placements`, `GET /prefs`, `PUT /planFlag` and `PUT /library`. The library PUT is append only for the assistant (403 if an existing meal is dropped or changed). Deployed 2026-10-19.

**Amended 2026-10-19 (assistant Phase 33a):** `ASSISTANT_ALLOWED` also covers read-only `GET /nutrition?date=YYYY-MM-DD`: the eaten log for that Europe/London day scored with `MP.Nutrition.dayCoverage`, the uneaten planned slots, and up to 3 `rankByGap(["protein"])` swaps when protein is under 80%. 400 on a bad date. Deployed 2026-10-19 (version d4b1b5bf), live call returned the real plan and swaps.

---

## Phase 58: Aisle-ordered shopping list [S] — done

**Added 2026-10-22.** Shopping lines are grouped and ordered by Asda store layout (produce, bakery, meat and fish, chilled,
frozen, cupboard, household) so one walk covers the list. The aisle comes from a category table kept as data (extend
`pack-sizes.json` categories, no inline constants); an unmatched line falls into "Other", never dropped. Ordering is display
only: `MP.ShoppingList.buildLists` stays the one implementation and its quantities and totals are untouched. **Verify:** every
line of a generated list appears exactly once in some aisle; ticking a line keeps its aisle; phone and PC, both themes.
Requires Phase 55. Not in `notion_assistant` (checked 2026-10-22).

**Verified 2026-10-23:** check.py 9/9; tester PASS (every line once across aisles, tick keeps aisle, PC + 390px, both themes).

## Phase 67: Batch-cycle design [M] — done (built 2026-10-23; check.py 9/9, worker_test ok, tester PASS)

**Added 2026-10-22.** The generator picks two or three batch cooks for the fortnight first, then places their leftover chains
around gym and busy days. Works inside the `MP.isBatch` chain rules. **Verify:** every batch's portions land in the following
1–2 days or are frozen (Phase 59). Requires Phase 59.

## Phase 73: Tie questions and trade-off cards [M] — done

**Added 2026-10-22.** In the Phase 72 chat, when the top two candidates score within a margin kept as data, Hermes asks one
question card ("chicken curry or chilli?"); ignoring it applies the default. When a plan is over budget, a card offers meal-level
swaps with the numbers ("swap Wed and Fri saves £9, costs 12 g protein"), computed by the generator, never by Hermes, and applied
only on accept. **Verify:** a tie produces exactly one card; accepting a swap changes the totals shown. Requires Phases 27, 72 (was "75", a stale renumber).
Verified 2026-10-23: check.py 10/10 (test.html gapScore/tieFor/budgetSwaps cases, walk tie + trade-off cards at PC and phone, Exit leaves mp_plan identical); tester PASS.

## Phase 82: Swap days and edit past days [M] — done

**Done 2026-10-26** (tester PASS: swap days/slots, past backfill, pantry untouched, undo; PC+390px, both themes).

**Added 2026-10-24.** Swap any two meals or whole days in one action, and backfill or correct what you ate on earlier days (a
meal, or eating out with a description). Re-flow stays on request only. **Verify:** swapping Tue and Thu moves leftovers and
shelf-life warnings with them; a past dinner can be set to "Spoons" without touching the pantry; undo restores. Requires Phase 81.
