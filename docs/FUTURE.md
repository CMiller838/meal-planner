# Parked Ideas

Ideas raised during planning but not currently scheduled. Each entry: what it
is, why it was parked, and a concrete trigger for revisiting.

## Library export/import (JSON download/paste)

Download the liked-meal library (`mp_library`) as a JSON file, and a paste
box to restore it. Would double as a manual backup.

- **Why parked**: Phase 2's Hermes bridge (Cloudflare Worker + KV) already
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

## "Eating out" placeholder slot

A non-meal option for a plan slot (e.g. takeaway night) so it doesn't break
the plan grid or confuse shelf-life warnings.

- **Why parked**: not a current pain point — no indication takeaway nights
  are happening often enough to need explicit modeling yet.
- **Revisit trigger**: if eating-out nights become regular enough that
  working around them in the plan UI gets annoying.
