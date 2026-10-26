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

**Done phases** (full sections in `.claude/archive/roadmap-done.md`): 27 Budget soft-preference, 28 Generic ingredient-substitution groups, 29 Live-build-watching (staged local generation render), 30 Hermes quantity ingestion (screenshot → structured quantities), 31 Partial-ingredient leftover tracking, 32 Personal-assistant connector (shopping list + "I ate X" queue), 58 Aisle-ordered shopping list, 67 Batch-cycle design, 73 Tie questions and trade-off cards.

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

**Added 2026-10-19.** Cooking mode itself was the assistant's; moved here as Phase 79 on 2026-10-24. The planner supplies what it needs:
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

## Phase 43: Pantry and leftover read routes: cookable, substitutions, leftovers, quick fallback [L] — built 2026-10-22, live checks pending


_Verified 2026-10-22: worker_test ok, check.py 8/8 (test.html asserts, ui pages, ui walk). Built by the pipeline, tester found no defects but its Edge walk was denied (Edge since dropped from the tester); patch hand-merged onto Phases 50-54 with `git apply --3way` and re-checked. New UI (Today leftovers, Pantry storage select) not re-viewed by eye at PC/390 px. Phase 48 absent._
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

## Phase 48: Activity log and undo for every assistant write [L] — built 2026-10-22, live checks pending

_Verified 2026-10-22: worker_test ok, check.py 8/8. Built by the pipeline, tester found no defects but its Edge walk was denied (Edge since dropped from the tester); patch hand-merged onto Phases 43, 50-54 with `git apply --3way` (worker_test blocks reordered so 48 runs on its own fixtures). New UI not re-viewed by eye at PC/390 px. Phases 50-52 shipped without activity logging (`ITEMS.drafts`, `.ratings`, settings): wire them in a follow-up._

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

## Phase 49: Week-plan draft and apply routes [M] — built 2026-10-22, live checks pending

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

## Phase 54: Today route (one source for the Today screen) [M] — built 2026-10-22, live checks pending

**Added 2026-10-19.** `GET /day` (not `/today`, which is Phase 41's raw counters record; spec 2026-10-22) returns what a Today screen needs in one call: the day's planned meals and their state
(planned, cooked, eaten), routine items due and done (Phase 41), counters (Phase 41), expiring-soon items (Phase 34), leftovers
(Phase 43), the day's coverage (with `gym=1` when given, Phase 35) (cook-or-skip state dropped: no source data). The app's Today view and the
assistant's Today view both read it, so they cannot disagree. Read-only, assembled from existing data. **Decisions:** the shape
(keep it a flat list of typed cards so each side can render what it wants), and caching (KV is eventually consistent, so the
route says when it was assembled). **Verify:** a meal logged in the app appears in the route within the KV delay; an empty day
returns empty lists, not an error. Requires Phases 41, 44, 45, 46. Assistant side: `notion_assistant` Phase 85.

## Phase 55: Shopping list as the single shared state [L] — built 2026-10-22, live checks pending

**Added 2026-10-19.** The planner's shopping list becomes the one list. Each line has a stable id, a state (`needed`, `got`,
`skipped`), a `source` (plan, ran-out tick, assistant, manual) and `updatedAt`, so the app, Google Tasks and the assistant's
Shop-now button can all tick items and the last real change wins per line (not per list). "Got" items flow into the pantry
only through the existing intake preview, never directly. **Decisions:** whether to migrate the current list shape or add
the fields alongside it, and how a line removed on one side is treated (tombstone with `updatedAt`, so a stale device cannot
bring it back). **Verify:** two devices ticking different lines both survive; a tick and an un-tick race resolves to the later
one; no line is duplicated by a sync loop. Requires Phase 32. Assistant side: `notion_assistant` Phase 86.

## Phase 56: Hermes contract rewrite and tool parity [M] — built 2026-10-22, live checks pending

**Added 2026-10-19.** `docs/HERMES.md` is rewritten as the single contract for every route that now exists (v6 adds more than
twenty), with request and response shapes, which are read-only, which write (and so need the preview-confirm-undo path), and the
errors each can return. A machine-readable route list (`worker/routes.json`) is generated from the Worker so the contract
cannot drift from the code, and a test fails if a route exists in the Worker but not in the list. The old Hermes-only
endpoints (`/planFlag`, `/library`, `/pantry` raw PUTs) are kept for the app but marked "app-side"; Hermes uses the activity-logged
routes from Phase 48 for writes. **Verify:** the list matches the Worker; every write route in the list is covered by Phase 48.
Assistant side: `notion_assistant` Phase 89.

## Phase 57: Measured nutrient levels for new ingredients (CoFID) [M] — built 2026-10-22, live checks pending

**Added 2026-10-22** (from Phase 50 planning: the user wants accurate health tracking, not assistant-guessed tags). An
ingredient that isn't in `ingredient-nutrient-tags.json` (one added from a draft or a TheMealDB import, shown as "not tracked
yet") gets its low/med/high levels **derived from measured CoFID per-100 g values** by a threshold rule kept as data (for
example a share of the daily target per 100 g), never typed in by hand or inferred by the assistant. It extends
`tools/cofid-map.json` + `tools/cofid_build.py`, and the tags file stays the single source. Needs the CoFID 2021 xlsx (a user
step). **Verify:** re-deriving the existing 33 ingredients reproduces their current levels or lists every difference for the
user to approve; a newly mapped ingredient stops showing "not tracked yet". Requires Phase 50.

**Built 2026-10-22:** `tools/cofid_derive.py` + `tools/cofid-levels.json` + `tools/test_cofid_derive.py` (in `check.py`). Verified: self-check passes; `diff` on the 29 shared keys (28 disagree somewhere, expected: tags are serving-sized judgments) lists 160 differences: 120 nutrients derived but untagged, 8 tagged but not derived (e.g. protein for beans), 32 level mismatches. Run `python3 tools/cofid_derive.py diff` for the list; no existing tag was changed. Live: map one new ingredient with the xlsx.

## Phase 59: Freezer-aware batch planning [L] — built 2026-10-23, live checks pending

Verified: check.py 9/9, worker_test ok, test.html freeze assertions (placement >= cookDay+5, opt-outs, no shelf-life warning, defrost notes, buildLists unchanged, planMirror). Chorizo pasta flagged `freezable:false`.

**Added 2026-10-22** (promotes the `docs/FUTURE.md` entry). The generator may cook a batch meal, freeze the spare portions
and schedule them later in the 2-week plan, using Phase 43's `storage` and `frozenMonths` helpers and the existing
`MP.isBatch` chain rules. Frozen portions are a new leftover kind with a defrost lead time (a "defrost tonight" note the evening
before); the pantry is still deducted once, at the cook (`commitCook`). Nutrition ranking still decides which meal; freezing
only changes where its portions land. **Verify:** a plan with a 4-portion batch freezes two and places them 5+ days later;
shelf-life warnings do not fire on frozen portions; eating a frozen portion never touches the pantry. Requires Phase 43.
Assistant side already covers storage guidance (`notion_assistant` Phase 46); scheduling is not there.

## Phase 60: Choice screens for breakfast, lunch and snacks [M] — built 2026-10-23, live checks pending

**Added 2026-10-22** (promotes the `docs/FUTURE.md` entry). The guided "Plan with me" walkthrough offers the top three ranked
meals for non-dinner slots, as it does for dinner, with "pick for me" as the default. Choices only reorder `rankByGap`'s output
and go through `guidedActive`, so abandoning the walkthrough leaves `mp_plan` untouched. **Verify:** each slot shows three
distinct meals; skipping all gives the same plan as one-tap Generate; exclusions never appear as an option. Requires Phase 24.

**Verified 2026-10-23:** `check.py` 9/9, tester PASS (all-skip plan equals plain guided plan; one lunch pick changes only that slot; close leaves `mp_plan` unsaved; PC + phone).

## Phase 61: Repeat-rate control [S] — built 2026-10-23, live checks pending

**Added 2026-10-22.** A setting for how soon the same meal may reappear (for example at most twice in 14 days, or a minimum gap
in days) and a "rotate favourites" switch. It lives in `mp_planPrefs`/profile settings as a plain number, is applied in
`rankSlot` as a reorder layer after ratings (never a filter, so a small pool can still repeat), and degrades to today's behaviour
when unset. **Verify:** a 14-day plan from a 12-meal library respects the cap; with a 3-meal library it still fills every slot.
Requires Phase 51. Not in `notion_assistant` (checked 2026-10-22).

**Built 2026-10-23.** `repeatGap` (0–14) in `mp_planPrefs`, `rankSlot` layer 3c, Worker pass-through; check.py 9/9 and tester PASS (unit assertions for 12-meal gap and 3-meal fill).

## Phase 62: Taste profile from ratings [M] — built 2026-10-23, live checks pending

**Added 2026-10-22.** Ratings, notes and "never again" flags (Phase 51) build a profile of cuisines, main ingredients and cook
styles you favour, stored as data derived from `mp_ratings`, never hand-typed. It reorders Discover's TheMealDB suggestions and
breaks ties in `rankSlot` after the ratings layer; it never re-scores nutrition and never filters (`never` stays the one filter).
**Verify:** after 10 ratings, Discover's top five shift toward liked cuisines; deleting ratings restores today's order. Requires
Phase 51. Not in `notion_assistant` (checked 2026-10-22).

**Built 2026-10-23, verified:** check.py 9/9, worker_test ok, unit asserts for profile/rankSlot window/orderByTaste; no cuisine (ingredients + cook style only). Discover reorder with a stubbed pool is unit-proven only.

## Phase 63: Mid-week re-flow [L] — built 2026-10-23, live checks pending

**Added 2026-10-22.** Skipping a cook, eating out or running out of an ingredient re-plans only the remaining days. Eaten and
cooked days are frozen, the user's manual edits are kept, and leftover chains, pantry stock and use-by dates are recomputed for
the rest of the plan. Exposed as an app button and a Worker route for Hermes through the Phase 48 activity log (so it is
undoable). The assistant today only offers a one-evening fallback (`notion_assistant` Phase 47). **Verify:** skipping Tuesday's
batch cook moves its dependent leftover slots; edited slots do not change; undo restores the plan. Requires Phases 43, 48, 49.

**Verified 2026-10-23:** check.py 9/9, worker_test ok; unit asserts for chain-unit skip, locked/eaten/past frozen, ranOut, sticky eating-out, restore deep-equal, real-generator replace; browser at PC and 390 px, both themes (Skip cook, Eating out, Undo re-flow); tester PASS after one fix (skipped meals excluded from the pool).

## Phase 64: Three candidate weeks [M] — built 2026-10-23, live checks pending

**Added 2026-10-22.** Generate cheapest, highest-protein and quickest versions of the fortnight and show them side by side
(cost, protein, cook minutes, coverage); the user picks one. Uses the existing `budget`, pressure and busy-effort knobs in
`generator.js` with different settings, no new scoring. **Verify:** the three plans differ on their headline metric and all
respect exclusions. Requires Phases 27, 35.

**Verified 2026-10-23:** check.py 9/9 (test.html 702 pass incl. noBatch, planMetrics, cheapest/protein/quickest vs default, exclusions); walk covers Compare/close/Use at PC and phone; tester PASS.

## Phase 65: Use-it-up week [M] — built 2026-10-23, live checks pending

**Added 2026-10-22.** A generation mode that seeds the plan from expiring and in-stock items (Phases 34, 39, 43) first, then
fills the rest by nutrition. Nutrition still decides which meal; stock only orders the shortlist. **Verify:** with three items
expiring, the first week uses them before their use-by dates. Requires Phases 34, 43.
Verified 2026-10-23: check.py 9/9, test.html group 65 (item meals placed by use-by day, consume-once, window, baseline equality), worker_test useUp 400/200, tester PASS (button + toast PC/390 px, both themes).

## Phase 66: Lock and fill [M] — built 2026-10-23, live checks pending

**Verified 2026-10-23:** check.py 9/9, worker_test ok (locked slot survives /plan/draft), tester PASS (browser: lock kept on Generate, Reroll leaves other days, Unlock all, PC and 390px). Known nit: Generate shows "Plan regenerated" over "Nothing to fill" when all locked.
**Added 2026-10-22.** Pin meals or slots (the Sunday batch, the gym-day shake); the generator fills around them. "Reroll
Wednesday" regenerates one day with locks respected, replacing today's whole-plan `regenerate` as the only option. Locks live in
the plan, not in `mp_planPrefs`. **Verify:** locked slots survive a full regenerate; a one-day reroll leaves other days alone.

## Phase 68: Rolling plan [L] — built 2026-10-23, live checks pending

**Added 2026-10-22.** The fixed 2-week block becomes a window that rolls forward daily: finished days drop off and a new day is
appended from the current pantry. Shop days (day 1 and day 8) are replaced by a rolling shop cadence, so Phase 63 and the
shelf-life pass must be reconciled first. **Open decision:** keep the 2-week view as an option? Requires Phase 63.

## Phase 69: Swipe deck per slot [M] — built 2026-10-23, live checks pending

**Added 2026-10-22.** Tapping a slot opens a deck of its ranked candidates; swipe right to take, left to pass. Reuses `swipe.js`
(Discover's gesture code) rather than a second gesture implementation. The deck only walks `rankSlot`'s existing order. Likes and
passes feed the taste profile (Phase 62) when it exists, and are stateless otherwise. **Verify:** passing three meals shows the
next three ranked; taking one sets the slot through `setSlotMeal` (so `guidedActive` still gates saving); phone and PC, both
themes. Requires Phase 24.

**Built 2026-10-23:** one `renderDeck` (swap + guided) with Take/Pass buttons, arrow keys and an "n left" counter; takes and passes are stateless, so the taste-feed line was dropped. Verified: check.py 9/9, walk.mjs pass x3 / ArrowLeft / ArrowRight take, guided take stays unsaved, double click fires once, reduced motion, PC and 390 px.

## Phase 70: Live nutrient and cost meter while editing [M] — built 2026-10-23, live checks pending
**Verified 2026-10-23:** check.py 9/9; tester PASS (swap changes only that week's meter, fixGap closes the gap, 390 px no overflow). Live: phone PWA check in tasks.md.

**Added 2026-10-22.** As meals are swapped, the coverage bars and weekly cost animate to the new values, and a "fix this gap"
button offers the swap that closes the biggest gap, taken from `rankByGap`. Coverage and warnings currently render once per plan
(Phase 29's rule); this adds a delta render on edit only, not on the staged generate reveal. **Verify:** swapping one dinner
changes only the affected bars; "fix this gap" never offers an excluded meal. Requires Phase 35.

## Phase 71: What-if preview on a candidate [S] — built 2026-10-23, live checks pending

**Added 2026-10-22.** Long-press (PC: hover) a candidate meal to see, before committing, its effect on protein, weekly cost, cook
minutes and the shopping lines it adds. Computed by running the same `rankSlot`, `buildLists` and cost code on a copy of the
plan, never a second implementation. Writes nothing. **Verify:** the preview matches the numbers after actually taking the meal.
Requires Phase 70.

**Verified 2026-10-23:** `MP.Plan.whatIf` (planMetrics + buildLists on a clone) deltas equal planMetrics after the swap, plan unmutated (test.html); hover preview leaves `mp_plan` byte-identical (walk.mjs); check.py 9/9. Phone long-press untested (live).

## Phase 72: Planning chat with Hermes (guided, animated) [L] — built 2026-10-23, live checks pending

**Added 2026-10-22** (decided with the user: Hermes interprets, full-screen guided flow, one message at a time). A full-screen
flow in the app steps through the plan one day at a time, a chat bar under each day card. The user types ("busy Monday, cheap
Thursday, no cooking Sunday"); the message goes to Hermes through the Worker, which returns **structured constraints and edits,
never meals** (busy/free days, chips, budget, locks). The app applies them to the generator, which picks the meals through
`rankSlot`, and the affected slots re-pick with the Phase 29 staged animation so every choice is visible. Where several meals fit,
the day card shows the top three as selectable cards (the Phase 69 deck is the same component); "pick for me" is the default.
Every Hermes edit shows as a highlighted diff with per-slot accept or reject (Phase 49 draft/apply is the transport). Stateless
exit through `guidedActive`: abandoning leaves `mp_plan` untouched. If Hermes is offline the flow degrades to today's Plan with me
screen. **Decided 2026-10-23:** offline falls back to the Plan with me screen; Phase 66 is built first.
**Transport (decided 2026-10-23):** KV relay like `hermes-generate` (app posts the message, Hermes replies via a
draft route), polled about once a second while the chat is open, so no inbound path to the PC is needed. A Worker call out to
Hermes is deferred: it would need a public endpoint on the PC, a shared secret, rate limiting and a narrow translate-only
service so Hermes' own tools are never exposed. **Conversational (decided 2026-10-23):** free wording, no fixed
phrases ("I'm wrecked Monday, and money's tight this week" is valid). Hermes keeps the thread of the session, so "make that one
quicker" or "what about Friday?" resolve against what was just said. It leads the walkthrough: it opens with a short question,
suggests ideas unprompted from the plan's real gaps (a protein shortfall, something expiring, an over-budget week), asks one
question at a time and says when it is unsure instead of guessing. Whatever it understands is echoed back as a plain-English line
under its reply ("Monday: quick meals, Thursday: under £3") so a misreading is visible before slots move. Hermes' reply is
always validated against a fixed set of edit types; an unrecognised one is dropped and Hermes is asked to rephrase. Exclusions,
allergies and `never` stay enforced in code whatever is typed. A typing indicator covers relay latency. **Verify:** typing
"no cooking Sunday" re-picks Sunday only,
within exclusions; a vague message ("something nicer on Friday") gets a clarifying question, not a guess; a rejected edit leaves
the slot unchanged; PC and phone, both themes. Requires Phases 24, 29, 49, 66.

## Phase 74: Learn from rejections [S] — built 2026-10-23, live checks pending

**Added 2026-10-22.** A rejected edit or declined suggestion in the chat can carry a reason; it is saved as a Phase 51 rating
or reason (`PUT /meal/:id/rating`, the only writer) and logged through Phase 48, so the next draft re-ranks without being told
again. Reorders only; `never` remains the sole filter. **Verify:** reject a meal with "too fiddly", regenerate, and it ranks lower;
undo removes the reason. Requires Phases 51, 72 (was "75", a stale renumber).
**Verified 2026-10-23:** worker_test (X-Actor PUT logged, undo restamps `at`/neutral record, bare PUT unlogged); walk.mjs (Skip writes nothing, reason chip writes `mp_ratings` down+note); test.html (rejected meal ranks last); `check.py` passes. Live: phone check in tasks.md.

## Phase 75: Tomorrow lock-in on Today [M] — built 2026-10-23, live checks pending

**Added 2026-10-22.** The Today screen (Phase 54) shows tomorrow's meal with three ranked alternatives for one tap, and "keep"
locks it (Phase 66). Tonight's cook-or-skip stays with the assistant (`notion_assistant` Phase 47); this adds tomorrow, which it
does not cover. No Telegram push in this phase. **Verify:** picking an alternative changes tomorrow's slot only and re-checks
exclusions. Requires Phases 54, 66.

**Verified 2026-10-23:** `check.py` 10/10; walk (PC + phone): alternatives equal `candidatesFor` top 3, Keep locks without changing the meal, a pick changes only day 2 and locks, a refused exclusion leaves `mp_plan` byte-identical, a leftover tomorrow shows no alternatives, last plan day (rolling off) shows no card.


## Phase 76: Cheaper swaps route [M] — built 2026-10-24, live checks pending

**Added 2026-10-23** (from `notion_assistant` Phase 44; the planner is the meal specialist). `GET /swaps?day=` returns, for the priciest
shopping lines, in-group alternatives from `substitution-groups.json` that cost less by `pack-sizes.json`, each with
`tagChanges` (nutrient levels that differ via `ingredient-nutrient-tags.json`) and a re-check against the hard exclusions. Read-only
suggestions; the assistant applies an accepted one through `POST /shopping/lines`. **Verify:** a swap onto an excluded food is never
returned; a tag change is listed; no group, no swap. Requires Phases 28, 55.

**Verified 2026-10-24:** `worker_test.mjs` covers a priced swap (`estimated`, `tagChanges`), `never` on the mate, a mushroom mate, no-group line, skipped line, 400s, assistant/app/no token. Live: the assistant's answer against the deployed Worker.

## Phase 77: Weekly spend log [S] — built 2026-10-24, live checks pending
**Verified 2026-10-24:** `node tools/worker_test.mjs` (repeat POST keeps one row, undo restores, bad week/total/source 400, `budgetTarget` on GET) and `check.py --changed`; tester PASS.

**Added 2026-10-23.** `POST /spend { week, total, source: asda|manual|estimate }` (logged, undoable via Phase 48) and `GET /spend`
(weeks, plus `budgetTarget` from `/settings`), one row per week and shop day so a re-preview overwrites rather than adds. The
cost meter (Phase 70) may show planned against actual. **Verify:** a repeat POST for the same key does not double; undo restores.
Assistant side: Phase 44.

## Phase 78: Pantry audit route [M] — built 2026-10-24, live checks pending

**Added 2026-10-23.** `GET /pantry/audit?location=` returns the next batch to confirm for a location (fridge, freezer, cupboard) and
`GET /pantry/sanity` the monthly findings (negative or implausible quantities, long-untouched items, perishables with no use-by,
duplicates). Read-only; answers go back through the existing pantry write, never a delete on its own. Snoozes are stored per
finding. **Verify:** each finding class fires on a fixture pantry; a snoozed finding is withheld. Requires Phases 34, 48.
Assistant side: Phase 43a.

**Built 2026-10-24.** `GET /pantry/audit`, `GET /pantry/sanity`, `POST /pantry/audit` (side store KV `pantryAudit`, never writes `pantry`; logged and undoable). Verified: `node tools/worker_test.mjs` covers all five finding classes, snooze/clear/expiry, batch ordering and `remaining`, unknown-name 400 with nothing stored, undo, pantry byte-identical, 400s and auth. Live check pending.

## Phase 79: Cooking mode [M] — built 2026-10-24, live checks pending

**Added 2026-10-24** (moved from `notion_assistant` Phase 46; the assistant keeps prep session and portions). A Cook button on a
meal opens a step-by-step screen over Phase 40's `GET /meal/:id/method`: one step at a time, big text for the phone, Next/Back,
and a timer button on any step with minutes (counts down in the app; a phone-clock timer link where the platform allows).
`drafted` steps are labelled as such; a meal with no method shows its ingredient list only. The last step offers Confirm cook,
which goes through the existing `PUT /eat-requests` (`commitCook`), so it deducts exactly once, same as the assistant's `log_meal`.
**Verify:** confirm twice deducts once; a running timer survives Next/Back; no-method fallback; PC and 390 px, both themes.
Requires Phase 40. Assistant side: none (voice stays wake word every time).

## Phase 80: Log anything [L] — built 2026-10-24, live checks pending

**80a built 2026-10-24, live checks pending** (Worker resolver, `POST/GET /food-log`; verified by `worker_test.mjs`, `check.py` 10/10 and the tester). **80b built 2026-10-24** (app mirrors `GET /food-log`; Today card "Also eaten", gap strip counts it, off-plan eat-requests applied without a slot; verified by test.html, `check.py` 10/10, seeded-mirror browser run at PC and 390 px both themes, and the tester).

**Added 2026-10-24.** Today only food that matches a plan slot counts as eaten, so off-plan meals, staples and supplements
are rejected or can't be logged. This phase adds one path that needs no plan slot, for eating and for stocking the pantry:

- **Resolver.** Free text such as "chicken 200g", "2 waffles" or "1 potato" resolves in this order: your saved products
  (label or barcode data), your pantry items, a generic food from `cofid.json` (so basics like chicken, rice and eggs need no AI),
  then the AI lookup below. No match and no data logs the entry with empty nutrients (missing, never zero) and says so.
- **Amounts.** Grams are the unit of record. A count ("1 potato", "2 waffles") converts through a typical grams-per-item stored
  on the product, flagged as an estimate; the log keeps both the count and the grams. A food with no known item weight asks once.
- **Food log.** Each entry is `{when, name, grams, count?, nutrients, source}` with nutrients frozen at log time, not tied to a
  plan slot. It feeds the weekly nutrient totals and the Phase 32 queue reports it as `off_plan` instead of rejecting it.
  Replaying the same entry id is a no-op, so nothing deducts twice.
- **Pantry.** Eating something in the pantry deducts it (never below zero, logged and undoable). Saying you have something
  ("200 servings of glycine", "20 Guayusa tea bags") adds it through the same resolver. Not in the pantry: logged, no deduction.
- **AI fill with cross-checking.** For an unknown food the lookup gathers values from at least two trusted sources (CoFID, USDA
  FoodData Central, Open Food Facts, the manufacturer's own page). Per nutrient: if two or more sources agree within the
  tolerance, save the mean as `basis: "estimate"` with the source names recorded. If they disagree, or only one source has it,
  leave that nutrient empty and list it as unconfirmed. A label photo or barcode (`label` / `off`) always outranks an estimate.
- **Supplements and composites.** Supplements (glycine, tea) count toward totals when they have confirmed data and are otherwise
  only logged and deducted. A composite item such as a pot noodle is one product with its label nutrients, not split into ingredients.
- **Today's food** (waffles, hoisin duck pot noodle, tea, glycine, chilli) is logged through this path once it ships. The stale
  empty waffle eat-requests from 2026-10-24 get cleared then.

Rules: planned-slot eats and `commitCook` are unchanged. No new dependency. Writes go through the existing activity log so they undo.
**Open points** (for `plan-phase`): the agreement tolerance per nutrient (starting point 15% for energy and macros, 25% for
micros); which sources the lookup may call and how (Hermes search vs direct API); whether the resolver lives in the Worker or the
client; item-weight defaults list; whether "I have X" without a quantity asks or assumes one pack.
**Verify:** a basic food resolves from CoFID with no AI; "2 waffles" logs grams and count; an off-plan eat deducts the pantry once
and replaying it deducts nothing; two agreeing sources save as `estimate` with sources, two disagreeing sources save nothing for
that nutrient; a label value overwrites an estimate; a no-data item logs with empty nutrients; undo restores the pantry.
Requires Phases 30, 31, 32, 34. Assistant side: `notion_assistant` Phase 54.

## Phase 81: Eating out, named, and skip that asks [M] — built 2026-10-24, live checks pending

**Added 2026-10-24.** "Eating out" is a nameless marker today and Skip silently re-plans. An eating-out slot now takes a name and
what you had (e.g. "Spoons — burger and chips"), estimated through the Phase 80a resolver. Skip asks: push to tomorrow, move to a
later free slot, swap for something else, or drop it (today's re-flow). **Verify:** the Spoons dinner shows its name and counts toward
coverage as an estimate; each of the four skip choices leaves the plan correct and undoable. Requires Phases 63, 80a, 80b.

## Phase 82: Swap days and edit past days [M] — done 2026-10-26 (tester PASS: swap days/slots, past backfill, pantry untouched, undo; PC+390px, both themes)

**Added 2026-10-24.** Swap any two meals or whole days in one action, and backfill or correct what you ate on earlier days (a
meal, or eating out with a description). Re-flow stays on request only. **Verify:** swapping Tue and Thu moves leftovers and
shelf-life warnings with them; a past dinner can be set to "Spoons" without touching the pantry; undo restores. Requires Phase 81.

## Phase 83: Flexible plan start and length [L] — built 2026-10-26, live checks pending

**Added 2026-10-24.** Generate a plan that starts on any date, from any first meal (dinner on day 1 leaves earlier slots empty),
for 1 to 28 days, with a chosen shop weekday. One-tap Generate stays one tap with today's defaults. **Verify:** a plan starting
Thursday dinner for 10 days has no Thursday breakfast or lunch, shopping and shelf-life follow the chosen shop day, and a default
Generate is unchanged. Requires Phases 68 (rolling, shop anchor), 82.

Built 2026-10-26: check.py 10/10, worker_test ok, tester PASS (guided flow at 390 px: 10-day dinner-first plan, shop anchor). Live: Thursday-dinner plan on the phone, check Shopping.

## Phase 84: Tell it anything: chat and assistant control [M] — built 2026-10-26, live checks pending

**Added 2026-10-24.** The planning chat and the assistant can start a plan on a date, skip, mark eating out, swap and backfill, by
plain message ("start Thursday dinner, I'm at Spoons Friday"). Edits are validated constraints and park as a pending draft like
Phase 63. **Verify:** each message type produces the matching draft, an unknown edit is dropped, nothing applies unseen. Requires
Phases 72, 81, 82, 83.

## Phase 85: Log and show every meal Hermes sends [M] — built 2026-10-26, live checks pending

**Added 2026-10-25.** Food and meals only, through the Phase 80a path (no new store). Hermes can log a whole meal (a name plus its
components, e.g. "Spoons burger meal": burger, chips, drink) as one grouped entry, and remove a wrong entry. The app gets a Food log
view: every day, every entry (grouped meals collapse), amount, nutrients with their basis, unknown shown as unknown. **Verify:** a
three-item meal logs as one group with summed known nutrients and unknowns listed; replaying it changes nothing; a removed entry
disappears from the view and from coverage; a meal logged by Hermes shows on Today and in the Food log view. Requires Phases 80a, 80b.

## Phase 86: Style and animate every component [L] — not started

**Added 2026-10-25.** A full polish pass over every component on every page (nav, cards, slot cards, sheets, banners, strips,
meter, chips, forms, toasts, empty states, shopping rows, discover deck, plan-with-me, Food log): each gets tokenised styling, a
motion for enter, press, change and exit, a reduced-motion fallback, and a checked look in both themes at PC and 390 px. Stray
literals move into tokens. **Verify:** a component inventory in the spec is fully ticked, `check.py ui` passes, screenshots of
every page in both themes at both widths show no unstyled or static component, reduced motion disables all non-essential motion.
Requires Phase 85 (so the Food log view is polished with the rest).

## Phase 87: Plan with Hermes can create and change meals [L] — not started

**Added 2026-10-26.** With Phases 83 and 84 the chat sets the start date, first meal, length and shop day. This adds meals: Hermes
can create a new meal, edit one (ingredients, servings, effort, meal types, method) or remove an unused one, from the chat. Changes
apply at once (user-chosen) as cards with one-tap Undo, after the hard checks (allergies, `never` foods, no mushrooms, no standalone
egg meals, no vegetables in toasties). **Verify:** "add a turkey chilli, 4 servings" creates a meal that can be planned and shows in
Browse; "make the chilli use turkey" edits it and the shopping list follows; a mushroom meal is refused with the reason; Undo restores
the previous meal. Requires Phases 50, 52, 72, 83, 84.
