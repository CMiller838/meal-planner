# Parked Ideas

Ideas raised during planning but not currently scheduled. Each entry: what it
is, why it was parked, and a concrete trigger for revisiting.

## Library export/import (JSON download/paste)

Download the liked-meal library (`mp_library`) as a JSON file, and a paste
box to restore it. Would double as a manual backup.

- **Why parked**: Phase 4's Hermes bridge (Cloudflare Worker + KV) already
  gives the library an off-device copy, which covers the main backup need.
- **Revisit trigger**: if the Worker+KV store is ever unreliable/lost, or
  before removing reliance on it, add a manual export/import as a fallback.

## Per-meal cost tags — shipped (Phase 18)

Shipped as `~£`/cheap-med-pricey badges on Library and Discover cards, via
`MP.ShoppingList.costBadgeHtml`. See `docs/roadmap.md` Phase 18.

## Freezer-aware batch planning

Track a "buy day 1, freeze, defrost Thursday" cycle so batch-cook dinners
(roast chicken, chilli) stay shelf-life-safe into a Fri/Sat/Sun cook-once
run, instead of only chorizo (14-day shelf life) surviving to Friday on a
Monday-start plan.

- **Why parked**: needs purchase-date/per-SKU tracking, which `CLAUDE.md`
  deliberately refuses for this project. The generator (`generator.js`)
  flags the ceiling with a `ponytail:` comment at its shelf-life filter
  instead of solving it.
- **Revisit trigger**: if the current category-based shelf-life model
  keeps producing plans where only one batch meal is ever safe for the
  weekend run — the cheap mitigation today is adding more long-shelf-life
  batch dinners to `meals.json`, not code.

## Fill in `meals.json` quantities for accurate shopping totals

Phase 3's shopping list (`shopping-list.js`) sums parsed `qty` strings, but
most `meals.json` ingredients have blank or unparseable `qty` (e.g. `""`,
`"handful, grated"`, `"whole"`), so most lines resolve to "1 pack of the
default size" rather than a precise amount.

- **Why parked**: the spec (`.claude/specs/phase3_spec.md` §0) is explicit
  that this is a data problem, not a code problem — a smarter parser can't
  extract a quantity nobody wrote down.
- **Revisit trigger**: none needed — this is an ongoing "fill in `qty` as
  you go" task, not a one-time fix. Do it opportunistically when editing a
  meal for another reason.

## "Eating out" placeholder slot

A non-meal option for a plan slot (e.g. takeaway night) so it doesn't break
the plan grid or confuse shelf-life warnings.

- **Why parked**: not a current pain point — no indication takeaway nights
  are happening often enough to need explicit modeling yet.
- **Revisit trigger**: if eating-out nights become regular enough that
  working around them in the plan UI gets annoying.

## Hermes sync: offline write queue / retry-backoff

Phase 4's `hermes-sync.js` is last-write-wins with no retry: an edit made
while offline (or during a failed request) is silently overwritten by any
newer remote write once connectivity returns, and there's no queued retry.

- **Why parked**: `decide()` is deliberately a plain timestamp comparison,
  not a merge; a queued push with retry/backoff is a bigger feature than a
  tweak to it.
- **Revisit trigger**: if an offline edit is ever actually lost in practice.

## Hermes sync: no conflict UI

The app never tells you it discarded a local library version on pull — it
just applies the remote silently.

- **Why parked**: last-write-wins was the chosen model for this phase; a
  conflict UI implies a merge model instead.
- **Revisit trigger**: if a real overwrite is ever noticed and it matters
  which version was lost.

## Pantry-driven automatic variant selection — shipped (Phase 21)

Phase 14 shipped the manual half: a meal entry can hold `variants`, each with
its own `ingredients`/`instructions`, picked from the plan day view. Phase 21
shipped the automatic half: `generator.js`'s `pickVariant` scores the base
recipe and each variant by missing-ingredient count against the pantry
(`MP.ShoppingList.pantryOverlap`), base wins ties, and `place()` writes the
winner's `variantId` onto the slot. No new data model — built entirely on the
Phase 14 resolver (`MP.effectiveMeal`) and schema (`meal.variants`).

**Parked as the accepted ceiling**: no plan-wide pantry depletion — two meals
scheduled in the same plan may each count the same single tin as "in stock,"
since `pickVariant` scores each meal independently with no running deduction
across the plan. Marked with a `ponytail:` comment in `generator.js`.

- **Revisit trigger**: a real pantry gets thin enough (few of an item) that
  two meals both claiming it produces a visibly wrong shopping list.

## `/coverage` endpoint for Hermes

Phase 5's Q&A capability answers nutrition questions by having Hermes fetch
`ingredient-nutrient-tags.json` / `nutrition-targets.json` directly, rather
than exposing `MP.Nutrition.dayCoverage()` over HTTP.

- **Why parked**: chat Q&A is qualitative ("is this high in protein?"), and
  the tag files answer that directly — an endpoint would exist only to
  compute a score nobody asks for in a sentence.
- **Revisit trigger**: if Hermes' coverage answers ever disagree with the
  plan page's banner, expose `dayCoverage` as `GET /coverage` rather than
  teaching Hermes the scoring rules.

## Persisting a built shopping list (Phase 17)

Phase 17 shipped auto-build as stamp-and-invalidate (a `generatedAt` stamp
the shopping page ticks against), not a persisted `mp_shopping_built`
snapshot.

- **Why parked**: a snapshot would be a second source of truth beside
  `mp_plan` (the plan of record), goes stale against the 7 manual-edit
  `savePlan()` callers, and doesn't fix anything the stamp doesn't already
  fix.
- **Revisit trigger**: something other than `shopping.html` needs to read
  the built list — e.g. if Hermes is ever given it.

## Hard max-line-count for the shopping list (Phase 17)

"Short" list length is emergent from the reuse-credit scoring term, not a
cap enforced separately.

- **Why parked**: a hard cap would fight the nutrition targets the
  generator is required to hit first — an unsatisfiable constraint.
- **Revisit trigger**: a real generated plan still produces an unmanageably
  long list after `reuseCredit`/`shortlistSize` (`pack-sizes.json`) are
  tuned against actual use.

## Synonym/plural/unit-word ingredient-key matching (Phase 17)

`normalizeKey`'s exact-match-only limitation (no synonyms, no unit words like
"tin of") is now softened by the Phase 17 category fallback — an unmatched
key is priced approximately instead of contributing £0.

- **Why parked**: the fallback removes most of the practical pain; a fuzzy
  alias map is real added complexity for a shrinking problem.
- **Revisit trigger**: the `estimated[]` bucket stays large/noisy after
  `pack-sizes.json`'s `keywords` list is filled out.

## Optimising cost across both shop halves jointly (Phase 17)

The Phase 17 budget step is a greedy per-slot pick within one shop half; it
never moves a meal from day 10 to day 5 to share a pack across halves.

- **Why parked**: that's a scheduling search, not a per-meal scoring term —
  a materially bigger piece of logic than this phase's scope.
- **Revisit trigger**: generated lists still look repetitive/wasteful across
  the two halves after the reuse term is tuned. A two-pass swap heuristic is
  the suggested upgrade path, not a full solver.

## Per-meal cost badges on Browse/Discover cards — shipped (Phase 18)

Shipped. See `docs/roadmap.md` Phase 18.

## Cost badge on 2-Week Plan slots

Phase 18 scoped badges to Library/Discover only; `plan.js`'s `daySlotHtml`
doesn't show one. `shopping.html` already gives the plan's real total.

- **Why parked**: deliberately out of Phase 18's scope (see
  `.claude/specs/phase18_spec.md` non-goals) — a plan slot is a decision
  already made, not a browsing choice.
- **Revisit trigger**: if a user wants cost visible while reviewing/editing an
  already-generated plan, not just while picking meals.

## Shared `MP.tabs(root)` helper

Phase 19 wired `shopping.html`'s two tabs by hand (~8 lines in `shopping.js`
plus the `.tab-bar`/`.tab-btn`/`.tab-panel` CSS convention) rather than
building a reusable helper.

- **Why parked**: Gate 1 Path C, rejected by the user in favour of Path B —
  one consumer isn't enough to shape a good API; a guessed abstraction is
  worse than copying four lines of markup.
- **Revisit trigger**: a second page wants in-page tabs — build the helper
  then, shaped by both pages' actual needs.

## Sync `mp_cooks` to Hermes

Phase 20's open-leftover-portion records (`mp_cooks`) are local-only — no KV
key, no Worker route, no Hermes mirror.

- **Why parked**: nothing asked for it; Phase 20's scope was the local
  cook-vs-eat split, not a new sync surface.
- **Revisit trigger**: Hermes wants to answer "what leftovers are in the
  fridge" — e.g. to avoid proposing a placement for a meal that already has
  an open portion sitting uneaten.

## Choice screens for breakfast/lunch/snack slots (v4 interview)

v4's dinner-only 3-card picker could in principle extend to every slot, not
just dinner.

- **Why parked**: a 2-week plan has up to 56 slots total; a 3-way choice on
  every one is a lot of taps for slots (breakfast/snack) that are already
  well served by the existing Day A/B rotation with no real variety
  decision to make. Dinner is where the real trade-offs (effort, leftovers,
  cost) actually live.
- **Revisit trigger**: if lunch/breakfast variety becomes an actual
  complaint once the dinner-only version has been used for a while.

## Free-text preference input for the pre-plan screen (v4 interview)

A text box like Hermes chat ("not much fish this week, feeling curries")
instead of structured preference chips.

- **Why parked**: the app is a static, no-backend site with no client-side
  NLP; interpreting free text would mean calling out to the hosted Hermes
  agent mid-flow, turning a local pre-plan screen into something that needs
  network + Hermes availability to function. Structured chips solve the
  same "steer the mood of this plan" need without that dependency.
- **Revisit trigger**: if structured chips prove too limiting in practice
  and the Hermes round-trip latency/failure-state cost is judged worth it.

## Live/official Asda data feed (v5 interview)

An official Asda affiliate/partner data feed (distinct from scraping their
consumer site, which is ruled out — see the v5 outline's constraints) that
would give real prices/pack sizes without manual entry or Hermes-assisted
screenshot reading.

- **Why parked**: no such feed is confirmed to exist; v5 proceeds on manual +
  Hermes-screenshot entry instead.
- **Revisit trigger**: if Cody confirms Asda (or a comparable grocer) offers
  a real partner/affiliate API.

## Partial-ingredient leftover tracking as a hard prerequisite (v5 interview)

Originally raised as blocking on filling in `meals.json` quantities wholesale
before the feature could work at all.

- **Why parked as stated, adopted differently instead**: the v5 outline
  adopts a scoped version — pantry items gain real quantity, filled in via
  Hermes reading shopping screenshots rather than a manual wholesale
  data-entry pass — so this specific "block on manual bulk quantity entry"
  framing is superseded, not carried forward as-is.
- **Revisit trigger**: n/a — see the v5 outline's "Partial-ingredient
  leftover tracking" must-have instead.

## Hermes direct plan writes (bypassing the app's re-check) (v4 interview)

Letting Hermes's `/placements` (or a future write endpoint) apply
immediately, overriding what the app would otherwise reject — e.g. an
already-eaten slot.

- **Why parked**: explicitly rejected during the v4 interview — Hermes's
  expanded v4 access is read/propose only; the app stays the sole write
  authority, same safety model as the existing `docs/HERMES.md` contract.
- **Revisit trigger**: none currently anticipated — would need a real
  reason the propose-then-app-applies model is causing friction in
  practice.
