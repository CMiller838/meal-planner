# Roadmap

Active roadmap. Superseded versions live in `.claude/archive/` — this file is
updated in place, never forked into a versioned copy.

Source of scope: `docs/OUTLINE.md`'s "Meal Planner — v5 Outline" must-haves.
**Unlike v4, there is no matching `docs/ARCHITECTURE.md` section yet** — v4 was
sequenced against "v4 — guided planning ("Plan with me") + ranking read
access", but ARCHITECTURE.md has no v5 section, so the phase sequencing below
is **provisional pending an architecture pass** and may be re-cut once the
file/endpoint plan is written. v5's nice-to-haves (Hermes weekly "use these
up" list, live cost-progress in the walkthrough, near-expiry pantry nudges)
are explicitly not sequenced here, same convention as v4.

Previous roadmap (Phases 1-15, all shipped) archived at
`.claude/archive/roadmap_20260906.md`. Previous roadmap (Phases 16-21, all
shipped) archived at `.claude/archive/roadmap_20260913.md`. Previous roadmap
(Phases 22-26, all shipped) archived at
`.claude/archive/roadmap_20260920.md`.

---

# v5 — cost steering, substitutions and real quantities (Phases 27-31)

Three kinds of work again, and they are not interchangeable:

- **Generator logic:** Phase 27 (budget soft-preference), Phase 28
  (substitution groups) — both land in `rankSlot`'s layer 4, the existing cost
  step.
- **UI:** Phase 29 (staged render of the app's own generation).
- **Hermes / Worker + data:** Phase 30 (quantity ingestion), Phase 31
  (remainder tracking).

The only hard ordering dependency in v5 is 30 → 31: a part-used pack can't be
tracked until `meals.json` carries real quantities, and per the outline's
Constraints that data arrives via Hermes reading shopping screenshots, not a
manual bulk data-entry pass. Everything else is sequenced by simplicity and
value, not by necessity. 27 → 28 is a soft ordering (both re-tune the same
layer-4 overlap machinery); 29 depends on nothing and is placed third only so
its render path isn't re-tested against two generator changes.

Unchanged from v4 and not up for renegotiation in any phase below: cost,
chips, busy-day effort, pantry variants and now substitutions are all
**reorderings of what `MP.Nutrition.rankByGap` already produced** — none of
them re-score nutrition, and none of them can filter a meal out of the pool,
so a plan can never fail to generate.

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

# v6 — real products, use-by dates, a weekly nutrient view and assistant links (Phases 33-56)

Added 2026-10-19 from a planning chat with the user. Provisional until an architecture pass, same as v5. The user wants
Chronometer-style product data (scan a barcode, or have the assistant read photos of an order) with exact values where
they exist and clearly labelled estimates where they don't. The assistant side is `notion_assistant` Phases 48-89; Phases 37-56 below are the planner halves of those.

**Assistant writes (added 2026-10-19):** everything the assistant changes here is preview, then confirm, then logged with undo (Phase 48). One writer per data type; the vault copy of planner data is generated (Phase 52).

**Rules that stay fixed (the planner's invariants, restated because every phase below touches them):**
- The low/med/high tags in `ingredient-nutrient-tags.json` stay the only input to `rankByGap`. Real product values are
  **informational**: they never re-score, filter or reorder the generator. Two nutrition sources is deliberate.
- Every stored value carries its provenance, and anything not read off a label or a lab table shows as an estimate in the UI.
- No new dependency without asking. Phase 33 is designed to need none (see its first decision).
- Order: 33 → 34 and 33 → 36 are real dependencies. 35 depends on nothing and can go first if wanted.

> Merged 2026-10-21: similar not-started phases were combined, keeping the lowest number (51 for ratings, since it needs 48).
> Old to new: 38→34, 46→35, 45→41, 44 and 47→43, 42→51. Assistant-side `notion_assistant` phase numbers are unchanged.

## Phase 33: Product nutrition reference (scan a barcode, read a photo) [L] — built 2026-10-22, live checks pending

**Where it lives:** the barcode scanner is in this app (the phone PWA) and nowhere else. The notion_assistant has no scanner;
its Phase 48 reads photos and uses the records created here. The planner is the specialist for meals, ingredients, pantry and
products, and the assistant (day-to-day) reads and writes it through the assistant token.

**Goal:** A per-product record (brand, pack size, price if known, nutrition per 100g and per serving, and a link to the
planner's ingredient key) that can be filled by scanning a barcode on the phone or by the assistant reading a photo of
the pack or order. The record is reference data: shown on pantry items and in a product sheet, and used for "cost per 25 g
protein" (Phase 36) and for the assistant's answers. The generator never reads it.

**Decisions to settle in the spec (research done 2026-10-19):**
- **Scanning with no dependency:** `BarcodeDetector` is built into Chrome on Android (caniuse: supported from Chrome for
  Android 83; the user's Pixel 10a qualifies). It is not on iOS Safari or desktop Firefox, and iOS isn't a target. The
  fallback is typing the barcode digits. A WASM ponyfill (`barcode-detector` on npm, zxing-wasm underneath) would add a
  dependency, so it is **not** used unless the user approves it.
- **Where values come from, in order:** (1) the pack's own label, read from a photo or typed, which gives
  energy, fat, saturates, carbs, sugars, fibre, protein and salt, so exact; (2) Open Food Facts by barcode
  (`/api/v2/product/{barcode}`, free, no key, ODbL, crowd-sourced, so UK own-brand coverage and accuracy vary and each hit
  is checked against the label if a photo exists); (3) generic fill-in from UK CoFID (McCance and Widdowson, Quadram) for
  vitamins and minerals that UK labels don't print, flagged as an estimate; (4) USDA FoodData Central only if CoFID has no
  match. Cronometer's own docs make the same point: barcode and label data usually carry about 15 nutrients, lab tables carry
  70+, so micronutrient totals from branded products undercount unless filled from a generic food.
  **Licence check at spec time:** CoFID is published under the Open Government Licence, but older documents describe Crown
  copyright; confirm and record the attribution before shipping any CoFID-derived values.
- **Provenance per nutrient:** `{ value, basis: "label" | "off" | "cofid" | "usda" | "estimate" }`. The UI shows a small
  "est." marker for anything that isn't `label` or `off`. Missing stays missing (null), never zero, and totals say how many
  products had no value for that nutrient (Cronometer calls this data confidence).
- **Storage:** a new Worker KV key and `/products` route (barcode → record; the planner's invariant "no new endpoint" was
  scoped to Phase 30 only). The assistant token gets read and write, so photos read on the PC and scans made on the phone land
  in the same place. Needs a new ADR line in `ASSISTANT_ALLOWED` and `docs/HERMES.md`. Open: store on the pantry item
  instead? Rejected for now: the pantry stays quantity only (`CLAUDE.md`), so the product is a separate record that the
  pantry item points to by key.
- **Unit normalisation:** records are per 100 g or 100 ml with a stated serving size; cooked-versus-raw is noted on the record
  where it matters (rice, pasta, chicken).
- **Safety:** all external strings (OFF names, brands, ingredient text) go through `esc()`; OFF data is untrusted third-party
  content.

**Verify:** test.html cases for the record shape, provenance rules, null-versus-zero and the barcode check digit; a real scan
on the Pixel; one product read from a label photo; `/products` 403 for no token and 200 for the assistant token.

## Phase 34: Use-by dates, expiring-soon route and "use it up" [L] — built 2026-10-22, live checks pending

Verified: test.html, worker harness, check.py 8/8, tester PASS (PC + 390 px, both themes). Merged from old Phases 34, 38. Build as one phase; each part keeps its own decisions and verify.

### Part: Use-by dates on pantry items
**Goal:** An optional per-item `useBy` date on the pantry, entered by the user, with shelf-life estimates only as a labelled
fallback. This is the user's explicit request, so it deliberately amends two `CLAUDE.md` invariants ("quantity only" on pantry
items and "no purchase-date tracking"); the spec updates both lines in the same commit.

**Decisions to settle in the spec:**
- **The user enters the date.** Adding a fresh item (meat, fish, dairy, fresh veg and anything `shelf-life.json` marks with a
  `fridgeDays`) prompts for a use-by date. Tins and dry goods don't prompt; they can still carry one.
- **Estimate when blank:** shop day plus the category's `fridgeDays` from `shelf-life.json`, shown as "est. use by Thu" in a
  muted style next to real dates, so the two are never confused. The assistant's photo intake can read a printed use-by date;
  if it can't, it leaves the field blank and the estimate shows.
- **Shape:** `useBy` as an ISO date string on the pantry item next to the structured `qty`. `parseQty`, `qtyText` and
  `remainingQty` are untouched; a partial eat keeps the date. `commitCook` stays the only pantry writer.
- **What it does:** a "use these up" strip on the pantry page (sorted by date, past-date items marked), and a read-only
  field on `GET /pantry` so the assistant and Google Tasks can use it. It does **not** reorder the generator in this phase.
  Whether `pickVariant`/layer 4 may favour near-expiry stock is an open point for the spec, because `CLAUDE.md` says pantry
  stock never reorders nutrition; if allowed it follows the same reorder-only rule. The v5 "near-expiry nudges" note
  belongs here.
- Frozen stock: a `frozenOn` date or "frozen" flag changes the estimate to `frozenMonths`. Open point.

**Verify:** test.html for date parsing, estimate-versus-entered display, a partial eat keeping `useBy`, old pantry items with
no date still loading; the Worker `/pantry` round trip keeps the field.

### Part: Expiring-soon read route and "use it up" suggestions
Builds on Phase 34. A read-only route (`GET /expiring?days=N`) returns pantry items with a use-by date
inside the window, soonest first, each marked `entered` or `estimate`. The app's Pantry page shows the same list at the top, and
a "use it up" button suggests the meals from the existing set that use the expiring items, soonest first. Suggestions only;
the generator is not changed and nothing is cooked or deducted. **Decisions:** the default window (2 days for fresh), how
frozen items are treated, and whether an expiring item can be pinned into the next plan with one tap.
**Verify:** estimates are visibly marked in the response and the UI; an item with no date and no category is omitted, not guessed.
Requires Phase 34. Assistant side: `notion_assistant` Phase 54.

## Phase 35: Weekly nutrient-gap view and gym-day targets [M] — built 2026-10-21, live checks pending

Verified 2026-10-21: check.py 7/7, test.html Phase 35 cases, Worker harness (`date=` byte-identical to HEAD, `gym=1`, `from/to`, all 400s), plan page strip at PC/390 px in both themes; tester PASS.

Merged from old Phases 35, 46. Build as one phase; each part keeps its own decisions and verify.

### Part: Weekly nutrient-gap view
**Goal:** A 7-day view of the eaten log at tag level: which of the planner's tracked nutrients (vitamin D, B12, iron,
calcium, magnesium, fibre and so on) were covered on how many days, and which were missed on most days. Extends the existing
`dayCoverage` scoring across a window; it adds no new scoring rules and no exact amounts.

**Decisions to settle in the spec:**
- A new `weekCoverage(eatenLog, endDate)` in `nutrition.js`, built on `dayCoverage`, so the Worker can call it (the
  `window` → `root` shim already covers the file).
- Output per nutrient: days covered out of days logged, and a flag when it was missed on 3 or more days. Days with nothing
  logged are shown as "not logged", not as a gap.
- Display as a simple strip per nutrient on the plan page, and a Worker `GET /nutrition?from=&to=` form for the assistant
  (extending Phase 33a's read-only route, which the assistant's roadmap Phase 51 consumes).
- Optional later step, only after Phase 33: show approximate amounts for a nutrient where the eaten meals' ingredients have
  product values, always labelled estimated. Not in this phase.
- The weekly view is informational. It doesn't change what the generator picks.

**Verify:** test.html with a fixture week (full, partial, empty days); the Worker route against `wrangler dev`.

### Part: Gym-day nutrition targets
`nutrition-targets.json` gets an optional `gymDay` block of uplifts (protein, energy and carbohydrate;
for example a few extra grams of protein), kept as data with the user's own numbers and not inline in code. `GET /nutrition`
takes `gym=1` (the assistant sends it when a session is logged or planned that day) and `dayCoverage` uses the base targets plus
the uplift for that call only. The planner never reads the gym app itself. **Rule:** the targets stay approximate, and the UI
says "gym-day target" when the uplift is in use. **Decisions:** the uplift values (the user's call), and whether the app lets
the user toggle gym day by hand when the assistant is not connected.
**Verify:** without `gym=1` the output is byte-for-byte what it is today; the uplift never changes `rankByGap`'s tag inputs, only
the coverage numbers. Requires Phase 32a/33a (the existing route). Assistant side: `notion_assistant` Phase 66.

## Phase 36: Cost per 25 g protein and product ranking [S] — built 2026-10-22, live checks pending

**Goal:** Using Phase 33 product records and `pack-sizes.json` prices, show cost per 25 g protein per product and rank the
user's items by protein value for money, on the pantry/product sheet and as an assistant answer. Informational only, like the
cost badges (Phase 18): it never sorts or filters meals.

**Decisions to settle in the spec:** where the price comes from when a product has no price (fall back to `pack-sizes.json`,
mark as estimate), how to treat products whose protein is a label value versus an estimate (rank them, show the marker), and
whether to add it to the shopping list rows. Requires Phase 33.
**Verified 2026-10-22:** `check.py` 8/8 (test.html proteinValue/rank cases, `tools/worker_test.mjs` `/product-ranking` 200/401/405), product sheet and Pantry "Best protein value" list at PC and 390 px, both themes, bad/empty input and `esc()`. Live checks left in `tasks.md`.

## Phase 37: Per-day effort hints from the assistant [M] — built 2026-10-21, live checks pending

**Added 2026-10-19.** The assistant knows the calendar (lectures, shifts, gym); the planner knows meals. The assistant sends
a per-day hint (`busy` / `normal` / `free`) and the planner uses its existing busy-mode mapping (`preferEffort: quick`,
`demoteEffort: batch`) for that day only, and prefers batch cooking on `free` days. It is a reorder of `rankByGap`'s output,
never a re-score, same as the existing busy chip. A hint is a suggestion the user can override in the app; nothing is locked.
**Decisions to settle in the spec:** where hints are stored (a small `dayHints` map in the plan, not a new KV namespace if the
plan already syncs), how stale hints expire, and whether the user can see why a day was marked busy ("2 lectures + gym").
**Verify:** a `busy` day ranks quick meals first and never changes the nutrient ranking; hints for past days are ignored.
Requires Phase 32 (assistant token). Assistant side: `notion_assistant` Phase 52.
**Verified 2026-10-21:** `test.html` (resolve/merge/dismiss, freeDays reorder keeps in-group order), Worker harness (assistant GET/PUT `/dayHints` 204/200, bad effort/>28 dates/long `why` 400, other writes 403, `/ranking` marks the day busy + returns `hint`), plan chip at PC and 390 px with `<b>` shown as text and tap-dismiss persisting, `check.py`. Live check left in `tasks.md`.

## Phase 39: "Ran out" items steer the plan [S] — built 2026-10-22, live checks pending

**Added 2026-10-19.** When an item is ticked as run out (from the Google Tasks pantry list or the app), the planner records it
as out-of-stock on the pantry and the next plan generation treats meals that need it as needing a shop (they are not removed,
and the shopping list gains the item). The ad-hoc list already exists; this adds only the out flag and its effect on the
"can I cook this now" check. **Decisions:** the flag clears when the item is bought (shopping tick) or when the pantry quantity
is set above zero, and a ran-out tick on a never-stocked item is ignored. **Verify:** the pantry write path stays
`commitCook`/merge only; the out flag cannot make a quantity go negative.
**Verified 2026-10-22:** `check.py` 8/8; test.html + worker_test cases for out/clear/never-stocked/non-boolean; Pantry "Ran out" button at PC and 390 px, both themes; tester PASS.
Requires Phase 32. Assistant side: `notion_assistant` Phase 49.

## Phase 40: Cooking mode data: steps, timers and a confirm-cook route [M] — built 2026-10-22, live checks pending

**Added 2026-10-19.** Cooking mode itself is the assistant's (voice, timers, step by step). The planner supplies what it needs:
(1) a method for each meal, as an ordered list of short steps, each with an optional timer in minutes, kept in the meal data
and not inline in code; (2) `GET /meal/:id/method`; (3) a confirm-cook call that runs the existing `commitCook` path, the only
thing that deducts from the pantry, so an assistant confirmation and an in-app confirmation produce the same result.
**Open points:** the current meals may have no steps. Decide whether to write them by hand over time, or let the assistant
draft steps from the ingredient list, which are then marked `drafted` in the UI until the user accepts them. A meal with no
method falls back to its ingredient list only.
**Verify:** confirm-cook twice does not deduct twice (idempotent per cook id); partial-ingredient leftovers from Phase 31 are
still recorded. Requires Phase 32. Assistant side: `notion_assistant` Phase 57.
**Verified 2026-10-22:** `check.py` 8/8 (incl. new `tools/worker_test.mjs` against the real Worker: 400/403/404/409); confirm-cook replay/duplicate rejected in `matchEatRequests` (test.html); UI at PC and 390 px, both themes. Confirm-cook uses the existing `PUT /eat-requests` (no new route).

## Phase 41: One-tap logs: routine items and water/caffeine counters [M] — built 2026-10-22, live checks pending

Verified 2026-10-22: check.py 8/8, worker_test round trip, test.html Phase 41 cases, Today card at PC and 390 px in both themes; tester PASS.
Merged from old Phases 41, 45. Build as one phase; each part keeps its own decisions and verify.

### Part: Routine items (magnesium tea, protein shake): one-tap "had it"
Things the user takes on a pattern rather than cooks: the magnesium tea before bed, the protein shake on
a gym day. Each is a routine item in the data (not inline): name, when it applies (`daily`, or `gymDays`), a usual time for the
reminder, and the same nutrient tags a meal carries (the shake counts toward protein). A "Had it" button in the app logs it
to the eaten log exactly like a meal, with one tap and no plan placement, so it shows in `/nutrition` and the weekly view
(Phase 35). The planner shows today's due items on the Today view and which are done.
**Decisions to settle in the spec:** whether routine items live in the meal library with a `routine` flag or in their own small
file (prefer the flag, so the eaten log and tags need no new shape); how "gym day" reaches the planner (the assistant tells it,
since the gym log is the assistant's; the planner never reads the gym app itself); that a second tap the same day is undo, not a
double log.
**Verify:** logging a routine item twice in a day is blocked or reversible; the generator ranking is unchanged apart from
routine items now counting toward the day's coverage like any eaten meal.
Requires Phase 32. Assistant side: `notion_assistant` Phase 60 (the reminders).

### Part: Tap counters: water and caffeine
Two counters that are not meals: water (glasses or bottles) and caffeine (cups). Same one-tap pattern as
routine items (Phase 41): a "+1" button on the Today view, stored per day, undo by tapping "-1". They are not in the eaten log
and never touch the pantry or the generator. Caffeine is shown as cups, with an optional rough mg figure per cup type held as
data and labelled approximate. **Decisions:** whether the counters live in a small new KV key or in the existing prefs (prefer
the smallest change that survives the sync model), and the daily water goal, which is the user's to set and defaults to none.
**Verify:** counters sync between app and assistant without double counting; a day with no taps is zero, not missing.
Requires Phase 32. Assistant side: `notion_assistant` Phase 64.

## Phase 43: Pantry and leftover read routes: cookable, substitutions, leftovers, quick fallback [L] — blocked 2026-10-22: PIPELINE: BLOCKED tester verdict INCOMPLETE because the Edge walk run was denied; allow the copy to C:\Users\cody\browser-check and re-run the tester, or accept

Merged from old Phases 43, 44, 47. Build as one phase; each part keeps its own decisions and verify.

### Part: "Can I cook it now" read route and substitution-group read route
Two read-only routes for the assistant, because both are computed in the app today.
(1) `GET /cookable` returns meals the pantry covers now, with the missing ingredients for the near-misses, each with its use-by
urgency (Phase 34/38) and its protein, so "what can I make?" can be answered without opening the app. It reuses the app's
existing can-cook check; nothing new is scored. (2) `GET /substitutions` serves `substitution-groups.json`, which is local-only
today (Phase 28), so the assistant can offer cheaper swaps (assistant Phase 59). Both are suggestions-only data.
**Decisions:** whether the check should be moved into shared code the Worker can run or kept in the app and mirrored (follow the
`/nutrition` precedent from Phase 33a, which already runs `dayCoverage` and `rankByGap` in the Worker), and the cap on results.
**Verify:** same answer in the app and from the route for the same pantry; a pantry with no dates still works.
Requires Phase 32. Assistant side: `notion_assistant` Phases 59 and 63.

### Part: Leftovers read route
`GET /leftovers` returns cooked leftover portions (from Phase 20/31 chains): meal, portions left, cooked
date, and an eat-by that is entered if the user set one and otherwise the category estimate, marked as an estimate. A small
"Leftovers" strip on the Today view shows the same. **Decisions:** where the cooked date comes from (`commitCook` already runs
at cook time), and how a leftover is closed (eaten via the eaten log, or thrown away with one tap, which also feeds the
waste figures if that idea is added later).
**Verify:** eating a leftover reduces portions without touching the pantry twice. Requires Phase 34 (eat-by).
Assistant side: `notion_assistant` Phase 58.

### Part: Storage location and the quick-fallback read route
For "I'm not cooking tonight": (1) each pantry item gets an optional `storage` of `fridge`, `freezer` or
`cupboard` (set from the order or pack, default from its category, with a default shown as an estimate like use-by dates in
Phase 34), so frozen food the user has saved can be found. (2) `GET /quick?n=` returns the quickest things to eat from the pantry,
frozen items and the meals that suit a busy day (the existing `prepEffort: quick`), ordered by use-by urgency, then protein.
Suggestions only; nothing is cooked or deducted by the route. **Decisions:** how a frozen item that is also a cooked leftover
from Phase 43 is shown, whether `storage` fits in the existing pantry item shape or needs a small migration, and how to treat
frozen items' use-by (months, per the existing `frozenMonths`, not days).
**Verify:** an item with no `storage` still works and shows its category default marked as an estimate; the route works with an
empty freezer. Requires Phase 34. Assistant side: `notion_assistant` Phase 67.

## Phase 48: Activity log and undo for every assistant write [L] — blocked 2026-10-22: PIPELINE: BLOCKED Tester verdict INCOMPLETE: the Windows Edge walk was denied by the permission classifier, so it needs the user to run it or to decide whether 

**Added 2026-10-19.** Every change the assistant makes through the token (pantry, plan, ratings, routine/tap logs, drafts) is
recorded in an `activity` list: time, who (assistant or app), what changed (before and after), and the reason in a short line.
The app shows it as an "Activity" view with a one-tap **Undo** per entry; the assistant can call the same undo. Undo restores
the recorded "before" only if nothing newer has touched that item (otherwise it says what changed since and asks).
**The rule every phase below follows (stated once here):** the assistant only changes planner data as *preview, then confirm,
then log with undo*. Nothing is written silently, nothing is deleted without an undo, and a confirm covers one batch.
**Decisions:** where `activity` lives (a capped KV list, e.g. last 200, with older entries exported to the vault by Phase 52),
and which writes are exempt (one-tap logs such as "had it" are logged but need no preview).
**Verify:** undo of a pantry change returns the exact quantities; a stale undo is refused with a clear message; the log is
append-only. Requires Phase 32. Assistant side: `notion_assistant` Phases 75 and 78.

## Phase 49: Week-plan draft and apply routes [M] — blocked 2026-10-22: PIPELINE: BLOCKED Phase 48 (activity log `logWrite`/`ITEMS`) is not built, only blocked and saved as a patch. It must be completed and committed before Phase 49

**Added 2026-10-19.** For planning a week together in chat. `POST /plan/draft` takes constraints (days to fill, the per-day effort
hints from Phase 37, meals to keep, meals to avoid, a budget cap) and returns a *proposed* week built by the existing generator
(tags, pantry, use-by urgency, gap ranking) without saving it. `POST /plan/apply` takes a draft and writes it, logged to the
activity list (Phase 48). A draft can be adjusted by re-calling with changes ("swap Wednesday for something quick"). The
generator and its scoring are unchanged; this only exposes it. **Decisions:** whether the generator runs in the Worker or in the
app (follow the `/nutrition` precedent), and how a partly-filled existing plan is merged.
**Verify:** the same constraints give the same draft in the app and via the route; apply is idempotent.
Requires Phases 37 and 48. Assistant side: `notion_assistant` Phase 68.

## Phase 50: Draft meals and recipe import [L] — built 2026-10-22, live checks pending

**Added 2026-10-19.** A meal can be saved as a **draft**: name, ingredients with amounts, steps, and nutrient tags that are
marked `inferred` (low/med/high only, never exact numbers). Drafts are visible in the app, are excluded from the generator and
the plan, and become real library meals only when the user accepts them (editing first if wanted). Two sources feed it: a meal
described in words, and an imported recipe (link, screenshot or cookbook photo) with a `source` field and a list of anything
that could not be read. Ingredient names are matched to the existing ingredient list; unknown ones are flagged for the user to
map or add. **Verify:** a draft never appears in generated plans; accepting it makes it appear; rejecting it deletes the draft
only. Requires Phase 48. Assistant side: `notion_assistant` Phases 71 and 72.

## Phase 51: Meal ratings, flags and reasons ("never again") [M] — built 2026-10-22, live checks pending

_Verified 2026-10-22: worker_test, test.html asserts, check.py 8/8, tester PASS (driven UI PC/390, dark/light). Phase 48 absent, so no `ITEMS.ratings` entry._

Merged from old Phases 42, 51. Build as one phase; each part keeps its own decisions and verify.

### Part: Meal ratings
A rating per meal (👍 / 👎, plus an optional one-line note such as "too salty") stored with the existing
app-owned like/dismiss counters, and shown on the meal. The assistant can write a rating through the token after its weekly
check-in. **Rule:** ratings are informational until the user chooses otherwise. Whether they ever nudge the generator is a
separate decision for the spec; if yes it is a reorder only, never a re-score, and visible ("ranked up: you liked this").
**Verify:** a rating from the assistant and one from the app land in the same record; ratings never delete or hide a meal.
Requires Phase 32. Assistant side: `notion_assistant` Phase 61.

### Part: Reasons and "never again" flags
(1) The generator already knows why it ranks a meal; expose it as short structured reasons per suggestion
(uses expiring item X, closes iron gap, quick, liked before, within budget) via `GET /why?meal=`. Nothing is re-scored; this
reads the existing ranking inputs. (2) Per-meal user flags: `never` (excluded from suggestions, kept in the library, undoable),
`liked`, and `disliked`, alongside the ratings from Phase 51. **Decisions:** whether `disliked` only deprioritises or excludes
(prefer deprioritise; `never` is the hard exclude), and the wording of reasons so they stay accurate to the real inputs.
**Verify:** every reason shown corresponds to a real term in the ranking; a `never` meal is never generated until un-flagged.
Requires Phases 42 and 48. Assistant side: `notion_assistant` Phase 73.

## Phase 52: Vault data layer and personal profile [M] — built 2026-10-22, live checks pending

**Added 2026-10-19.** The user wants all meal data in Obsidian so every tool (the assistant, Gemini, NotebookLM) can read it.
The planner runs on Workers KV so the phone app works anywhere with no PC on, and the vault is a folder on the PC. Both facts
stay true, so the design is: **KV remains the live store; the vault holds a complete Markdown copy; one writer per data type.**
- **Profile (vault-first):** `Meals/Profile.md`, edited by the user in Obsidian, holds targets (from `nutrition-targets.json`),
  allergies, dislikes, spice level, equipment, usual cooking time, budget, gym days and goals (with start and target values).
  The assistant syncs it into the planner as data. The planner reads it and no longer keeps a second copy of those settings.
- **Everything else (KV-first, vault mirror):** pantry, products, meals, plan, eaten log, leftovers, ratings, activity and
  drafts are written to the vault as readable Markdown or frontmatter files by the assistant after each change, plus a daily
  full snapshot. Files are read-only for the purposes of data (the header says so); editing a mirrored file does nothing, except
  Profile.md and drafts, which are designed to be edited.
**Decisions to settle in the spec:** the folder layout and file shape (one file per meal, one per pantry item, or tables);
how the vault reaches the assistant when the PC is off (mirror lags, which is fine for reading); conflict handling if Profile.md
and the app both change; and whether a drafts folder is the place to review and accept them.
**Verify:** wipe the mirror and rebuild it from KV identically; changing Profile.md changes the planner's targets after the
next sync; nothing in the mirror carries a secret or the token. Requires Phases 32, 34 and 48.
Assistant side: `notion_assistant` Phase 77; reuses the vault access from its Phase 28.

## Phase 53: Portion scaling route [S] — built 2026-10-22, live checks pending

**Built 2026-10-22; verified by `worker_test.mjs`, `test.html` and `check.py` 8/8, tester PASS.** Storage reads `shelf-life.json` `cooked_leftovers` directly (Phase 43 helpers were not built).

**Added 2026-10-19.** `GET /scale?meal=&portions=` returns the meal's ingredients scaled to N portions, the shortfall against the
pantry (what to buy, what is already covered), the cook-time note, and storage guidance for the leftovers (fridge days, freezer
months, marked as estimates per Phase 34). Reads the existing servings and quantities; no new scoring. **Decisions:** how
free-text quantities ("1, diced", "2 cloves") scale (scale only when a number can be parsed, otherwise return the original line
flagged "check this"), and a cap on portions. **Verify:** scaling to the meal's own servings returns the original; an
unparseable line is flagged and never silently changed. Requires Phases 34 and 43 (old 47 merged into 43; supplies `frozenMonths` storage helpers). Assistant side: `notion_assistant` Phase 83.

## Phase 54: Today route (one source for the Today screen) [M] — not started

**Added 2026-10-19.** `GET /day` (not `/today`, which is Phase 41's raw counters record; spec 2026-10-22) returns what a Today screen needs in one call: the day's planned meals and their state
(planned, cooked, eaten), routine items due and done (Phase 41), counters (Phase 41), expiring-soon items (Phase 34), leftovers
(Phase 43), the day's coverage (with `gym=1` when given, Phase 35) (cook-or-skip state dropped: no source data). The app's Today view and the
assistant's Today view both read it, so they cannot disagree. Read-only, assembled from existing data. **Decisions:** the shape
(keep it a flat list of typed cards so each side can render what it wants), and caching (KV is eventually consistent, so the
route says when it was assembled). **Verify:** a meal logged in the app appears in the route within the KV delay; an empty day
returns empty lists, not an error. Requires Phases 41, 44, 45, 46. Assistant side: `notion_assistant` Phase 85.

## Phase 55: Shopping list as the single shared state [L] — not started

**Added 2026-10-19.** The planner's shopping list becomes the one list. Each line has a stable id, a state (`needed`, `got`,
`skipped`), a `source` (plan, ran-out tick, assistant, manual) and `updatedAt`, so the app, Google Tasks and the assistant's
Shop-now button can all tick items and the last real change wins per line (not per list). "Got" items flow into the pantry
only through the existing intake preview, never directly. **Decisions:** whether to migrate the current list shape or add
the fields alongside it, and how a line removed on one side is treated (tombstone with `updatedAt`, so a stale device cannot
bring it back). **Verify:** two devices ticking different lines both survive; a tick and an un-tick race resolves to the later
one; no line is duplicated by a sync loop. Requires Phase 32. Assistant side: `notion_assistant` Phase 86.

## Phase 56: Hermes contract rewrite and tool parity [M] — not started

**Added 2026-10-19.** `docs/HERMES.md` is rewritten as the single contract for every route that now exists (v6 adds more than
twenty), with request and response shapes, which are read-only, which write (and so need the preview-confirm-undo path), and the
errors each can return. A machine-readable route list (`worker/routes.json`) is generated from the Worker so the contract
cannot drift from the code, and a test fails if a route exists in the Worker but not in the list. The old Hermes-only
endpoints (`/planFlag`, `/library`, `/pantry` raw PUTs) are kept for the app but marked "app-side"; Hermes uses the activity-logged
routes from Phase 48 for writes. **Verify:** the list matches the Worker; every write route in the list is covered by Phase 48.
Assistant side: `notion_assistant` Phase 89.

## Phase 57: Measured nutrient levels for new ingredients (CoFID) [M] — not started

**Added 2026-10-22** (from Phase 50 planning: the user wants accurate health tracking, not assistant-guessed tags). An
ingredient that isn't in `ingredient-nutrient-tags.json` (one added from a draft or a TheMealDB import, shown as "not tracked
yet") gets its low/med/high levels **derived from measured CoFID per-100 g values** by a threshold rule kept as data (for
example a share of the daily target per 100 g), never typed in by hand or inferred by the assistant. It extends
`tools/cofid-map.json` + `tools/cofid_build.py`, and the tags file stays the single source. Needs the CoFID 2021 xlsx (a user
step). **Verify:** re-deriving the existing 33 ingredients reproduces their current levels or lists every difference for the
user to approve; a newly mapped ingredient stops showing "not tracked yet". Requires Phase 50.
