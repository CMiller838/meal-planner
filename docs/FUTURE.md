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

## Per-meal cost tags

A rough `cheap`/`med`/`pricey` tag per ingredient (same pattern as the
nutrient tags), shown on individual meal cards.

- **Why parked**: Phase 2's shopping-list feature already gives an
  aggregate weekly cost estimate from Asda pack prices, which covers the
  budget-awareness need without a second cost system.
- **Revisit trigger**: if the aggregate shopping-list total isn't granular
  enough to help decide between individual meals.

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

## `/coverage` endpoint for Hermes

Phase 5's Q&A capability answers nutrition questions by having Hermes fetch
`ingredient-nutrient-tags.json` / `nutrition-targets.json` directly, rather
than exposing `MP.Nutrition.dayCoverage()` over HTTP.

- **Why parked**: chat Q&A is qualitative ("is this high in protein?"), and
  the tag files answer that directly — an endpoint would exist only to
  compute a score nobody asks for in a sentence.
- **Revisit trigger**: if Hermes' coverage answers ever disagree with the
  plan page's banner, expose `dayCoverage` as `GET /coverage` rather than
  teaching n8n the scoring rules.
