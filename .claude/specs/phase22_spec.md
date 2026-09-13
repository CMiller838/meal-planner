# Phase 22 — `rankSlot` extraction + chip/busy ranking layers

Ships **headless**. No UI, no new localStorage key. With `prefs` absent or
empty, every output of this phase must be byte-identical to today's — the
one-tap Generate button and the existing swap picker must not change at all.

## Decisions (answered 1A, 2A, 3 = five-chip set)

Relayed to me by the coordinating agent as the user's own answers, captured
through its `AskUserQuestion` tool. I did not pick these myself; where the
coordinator's first relay mislabelled Gate 3 as "3A", the corrected relay
confirmed the five-chip set (Path B minus `quick-week`).

| # | Decision | Chosen | Why |
|---|----------|--------|-----|
| D1 | `plan.js`'s `candidatesFor`/`openSwapPicker` | **A — fold into `rankSlot` now** | `candidatesFor` is ~12 lines whose pool/gap-exclusion maps 1:1 onto `rankSlot`'s `pool`/`dayMealsSoFar`. Folding now is a smaller total diff than folding in Phase 24, satisfies the v4 "one ranking implementation" invariant immediately, and is a provable no-op while prefs are empty. |
| D2 | How a chip matches a meal | **A — declarative matcher in JSON** | Optional `keywords` / `tags` / `prepEffort` per chip, matched against data the library already has. No meal-data migration, and TheMealDB Discover imports are covered automatically. A chip is a soft reorder, so a fuzzy keyword hit costs one position, never a wrong plan. |
| D3 | Initial chip vocabulary | **Five chips** — `comfort`, `light` (prefer); `no-spice`, `less-red-meat`, `no-pasta` (avoid) | Balanced chip row for Phase 23. `quick-week` deliberately dropped: it is the busy-day grid with all 14 days ticked, and shipping both gives two controls for one outcome that can contradict each other. |

### Calls made without a gate (trivial forks, noted for the record)

- **`rankSlot`'s 4th arg is `opts`, not `prefs`.** ARCHITECTURE.md writes
  `rankSlot(pool, dayNum, dayMealsSoFar, prefs)`, but the function also needs
  `tags` and `targets`, which are closure variables inside `generatePlan`
  today and must become explicit once the function is module-level and
  exported. `prefs` lives inside `opts`. ARCHITECTURE.md is updated in §6 to
  match rather than the other way round.
- **Busy-day effort bias is skipped when `opts.prefer === "batch"`.** The
  batch pass explicitly wants batch meals; letting layer 3 demote them would
  sabotage the parent pick. Busy days are already honoured for that pass at
  the *run* level (§4.4), which is what ARCHITECTURE's "run selection" clause
  describes.
- **Busy/effort (layer 3) runs after chips (layer 2), so busy wins ties at
  the head.** That is the architecture's stated layer order; no reason to
  deviate.
- **`plan-preferences.json` also carries the busy-day effort mapping**
  (`busy.preferEffort` / `busy.demoteEffort`), rather than hardcoding
  `"quick"`/`"batch"` in JS — same CLAUDE.md rule as `pack-sizes.json`'s
  `planning` block.

## Findings (verified, do not re-derive)

- `generator.js:97` `pickMeal(pool, dayNum, dayMealsSoFar, opts)` is a
  **closure inside `generatePlan`**, reading `tags`, `targets`, `budget`,
  `halfKeys` and `lastUsedDay` from scope. Extraction to module level means
  those five become explicit `opts` members.
- `generator.js:44` `effortOf(meal)` returns `meal.prepEffort || "quick"`.
  `prepEffort` is **binary** in this codebase — only `"quick"` and `"batch"`
  are ever written (`data.js:62`, `app.js:440`). ARCHITECTURE forbids adding
  new values, so busy-day bias maps to prefer-`quick` / demote-`batch`.
- `nutrition.js:79` `rankByGap(candidates, gapNutrients, tags)` returns a
  **meal array**, sorted descending by gap score, and is **stable and
  deterministic**. Every layer below it must also use a stable reorder
  (`filter`+`concat` partitions, as `pickMeal` already does at 106-110) so
  layer-1 order survives inside each partition.
- `tags` is an ingredient-key → `{ nutrientKey: "high"|"med"|"low" }` map.
  Nutrient keys are those in `nutrition-targets.json` (`fibre_g`, `vitC_mg`,
  `protein_g`, …) — use the exact suffixed names, not bare `fibre`.
- `pickMeal`'s **budget branch returns early at 126**; its final recency
  tiebreak (129-133) applies to the whole ranked list. Both must become
  *reorders* that keep the full array, with `[0]` unchanged.
- `generator.js:191` export is
  `{ generatePlan, weekendRuns, weekdayOf, isoToday, pickVariant }`.
- `plan.js:261` `candidatesFor(day, slotType)` builds gap coverage from the
  **other** slots on that day (excluding the slot being swapped) and calls
  `rankByGap` directly. `plan.js:274` `openSwapPicker` is its only caller.
- `MP.Nutrition.dayCoverage(dayMealsSoFar, tags, targets)` returns
  `{ missing, partial }`; `pickMeal` concatenates them into `gapNutrients`.

## Non-goals

- No `plan-with-me.html`, no chip UI, no busy-day grid (Phase 23).
- No `mp_planPrefs` read/write, no localStorage key, no Hermes sync
  (Phases 23/25).
- No walkthrough state machine (Phase 24); no Worker shim (Phase 26).
- No new `prepEffort` values, no new meal fields, no library migration.
- No change to `MP.Nutrition` — not one line of `nutrition.js`.

### Invariants this phase must not break

- **Chips and busy are layers 2-3 only.** They reorder what `rankByGap`
  produced. Nothing in this phase may recompute, reweight or re-score a
  nutrient. Same rule as cost (Phase 17) and pantry variants (Phase 21).
- **Chips reorder, never filter.** Every meal in `pool` must still be present
  in `rankSlot`'s return value. A plan can never fail to fill because of a
  chip. Assert this in tests.
- **Empty prefs = today's behaviour, exactly.** `rankSlot(...)[0]` with no
  `prefs` must equal today's `pickMeal(...)` for the same inputs.
- Chip vocabulary lives in `plan-preferences.json`. No chip id, keyword or
  effort string is hardcoded in `generator.js`.
- Unknown chip ids in `prefs.chips` are **silently ignored**, never an error
  (Phase 25 deliberately does not validate ids at the Worker).

## §1 `plan-preferences.json` — new data file (D2, D3)

New file at repo root, house style matching `shelf-life.json` (leading
`_note`, no version field).

```jsonc
{
  "_note": "Chip vocabulary + busy-day effort bias for guided planning. Chips are a REORDER, never a filter — see .claude/specs/phase22_spec.md. A chip hits a meal if ANY listed criterion matches.",
  "busy": { "preferEffort": "quick", "demoteEffort": "batch" },
  "chips": [
    { "id": "comfort",        "label": "Comfort food",   "kind": "prefer", "keywords": [...], "prepEffort": "batch" },
    { "id": "light",          "label": "Lighter week",   "kind": "prefer", "tags": ["fibre_g", "vitC_mg"] },
    { "id": "no-spice",       "label": "Less spice",     "kind": "avoid",  "keywords": [...] },
    { "id": "less-red-meat",  "label": "Less red meat",  "kind": "avoid",  "keywords": [...] },
    { "id": "no-pasta",       "label": "Less pasta",     "kind": "avoid",  "keywords": [...] }
  ]
}
```

Per-chip schema — `id` and `kind` required, all three criteria optional:

| Key | Type | Meaning |
|-----|------|---------|
| `id` | string | Stable id. Phase 23 renders it, Phase 25 relays it. Never renumber. |
| `label` | string | Human text for Phase 23's chip. Unused by the generator. |
| `kind` | `"prefer"` \| `"avoid"` | Head or tail. |
| `keywords` | string[] | Lowercase substrings matched against meal `name` **and** every `ingredients[].key`. |
| `tags` | string[] | Nutrient keys; hits if any ingredient is `"high"` for one. |
| `prepEffort` | string | Hits if `effortOf(meal)` equals it. |

Keyword content (builder picks the exact lists; these are the required
coverage, all lowercase): `comfort` → pasta/pie/stew/roast/bake/mash;
`no-spice` → chilli/curry/harissa/jalapeno/cayenne/sriracha;
`less-red-meat` → beef/lamb/mince/steak/pork; `no-pasta` →
pasta/spaghetti/penne/macaroni/lasagne/tagliatelle.

Sanity-check each keyword list against the seeded `meals.json` names and
ingredient keys before committing — a list that hits zero meals is a dead
chip, and one that hits every meal is a no-op.

## §2 `generator.js` — chip matching helpers (new, module-level, not exported)

```js
/** Chip definitions from prefs.vocab, or [] when absent/malformed. */
function chipVocab(prefs)            // -> Array<ChipDef>

/** True if `meal` satisfies ANY of the chip's keywords/tags/prepEffort criteria. */
function chipHits(meal, chip, tags)  // -> boolean

/** Ids in prefs.chips that exist in the vocab, split by kind. Unknown ids dropped. */
function activeChips(prefs)          // -> { prefer: ChipDef[], avoid: ChipDef[] }
```

`chipHits` lowercases `meal.name` once per call and tests
`name.includes(kw) || ingredients.some(i => i.key.includes(kw))`. Tag criteria
test `tags[i.key] && tags[i.key][t] === "high"`. Absent criteria never match
(a chip with no criteria hits nothing rather than everything).

`prefs.vocab` is the parsed `plan-preferences.json`; when it is missing,
`chipVocab` returns `[]` and every chip layer is a no-op. No `fetch` is added
to `generator.js` — callers pass the parsed JSON in, exactly as `tags`,
`targets`, `shelfData` and `budget` are passed today.

## §3 `generator.js` — `pickMeal` → module-level `rankSlot` (D1)

Move the function out of `generatePlan`'s closure to module level, beside
`pickVariant`.

```js
/**
 * Ordered candidates for one slot, best first. Layers, in order:
 *   1 nutrition (rankByGap)  2 chips  3 effort/busy  4 budget shortlist  5 recency
 * Layers 2-5 are stable reorders of layer 1 — none of them re-score nutrition.
 * Returns every meal in `pool` (minus nothing); chips never filter.
 */
function rankSlot(pool, dayNum, dayMealsSoFar, opts)  // -> Meal[]
```

`opts` members — first two required, rest optional:

| Key | Used by | Note |
|-----|---------|------|
| `tags` | layers 1, 2 | ingredient-nutrient map |
| `targets` | layer 1 | parsed `nutrition-targets.json` |
| `prefs` | layers 2, 3 | `{ busyDays?: number[], chips?: string[], vocab?: object }`; absent ⇒ layers 2-3 skipped entirely |
| `excludeIds` | pre-filter | `Set`, existing semantics incl. the 101 "pool too small" fallback |
| `prefer` | layer 3 | `"batch"` \| `"quick"`, existing semantics |
| `budget` | layer 4 | existing Phase 17 object |
| `halfKeys` | layer 4 | was closure state |
| `lastUsedDay` | layers 4, 5 | was closure state |

Layer-by-layer, preserving today's code where marked:

1. **Nutrition — unchanged.** Lines 99-105 move verbatim: exclude, the
   empty-pool fallback, `dayCoverage`, `rankByGap`.
2. **Chips — new.** With `activeChips(prefs)`, stable-partition `ranked` into
   `[hits-a-prefer-chip] ++ [hits-neither] ++ [hits-an-avoid-chip]`. A meal
   hitting both a prefer and an avoid chip counts as **prefer** (the user
   asked for it explicitly; the avoid is the weaker signal). Skip entirely
   when both lists are empty.
3. **Effort/busy.** First the existing `opts.prefer` partition (106-110,
   verbatim). Then, only when `prefs.busyDays` includes `dayNum` **and**
   `opts.prefer !== "batch"`, a second stable partition by `effortOf`:
   `busy.preferEffort` to head, `busy.demoteEffort` to tail, read from
   `prefs.vocab.busy`.
4. **Budget — same scoring, no early return.** Keep 111-125 exactly
   (shortlist, cost minus `reuseCredit` × overlap, min-score winners). Then,
   instead of `return neverW.concat(usedW)[0]` at 126, hoist
   `neverW.concat(usedW)` to the head and append the rest of `ranked` in its
   existing order, dedup by id. `[0]` is therefore identical to today's.
5. **Recency — same partition, no early return.** Keep 129-132; return
   `never.concat(used)` as the array rather than `[0]` at 133. Reached
   whenever layer 4 is skipped or its shortlist was empty, exactly as today.

Then, inside `generatePlan`, a one-line closure preserving all three existing
call sites unchanged in shape:

```js
const pickMeal = (pool, dayNum, dayMealsSoFar, opts) =>
  rankSlot(pool, dayNum, dayMealsSoFar, { ...opts, tags, targets, prefs, budget, halfKeys, lastUsedDay })[0] || null;
```

## §4 `generator.js` — `generatePlan` gains `prefs`

### 4.1 Signature

```js
function generatePlan(library, tags, targets, shelfData, startDate, budget, have, prefs)
```

Trailing optional, same convention as `budget` (17) and `have` (21).
`prefs = prefs || {}` on entry. No existing caller changes.

### 4.2-4.3 Call sites

Lines 152, 170 and 183 keep their current argument lists — the new closure in
§3 injects everything. Verify by diff that those three lines are untouched.

### 4.4 Busy-day run selection (the one non-ranking behaviour change)

In the weekend-run loop (139-163), before computing `d0`: if `run[0]` is in
`prefs.busyDays` and the run contains at least one non-busy day, rotate the
run to start at the **first non-busy day** and cover forward from there.
Skipped days fall through to the quick-fill pass at 165-172, where layer 3
gives that busy day a quick meal. If every day in the run is busy, leave the
run as-is.

This is the architecture's "non-busy day preferred as cook day, leftover days
land on busy days" clause. Nothing about *which* meal is chosen changes here —
only which day cooks.

```js
// ponytail: rotation only, no re-splitting of runs. A [busy, free, busy] run
// cooks on day 2 and covers day 3; splitting to also cover day 1 needs a
// second parent and isn't worth it until someone complains.
```

## §5 `generator.js` export + `plan.js` fold (D1)

Export becomes:

```js
MP.Generator = { generatePlan, rankSlot, weekendRuns, weekdayOf, isoToday, pickVariant };
```

In `plan.js`, `candidatesFor(day, slotType)` (261) keeps its signature and its
existing pool/other-slot-gap construction, but its `MP.Nutrition.rankByGap`
call becomes:

```js
MP.Generator.rankSlot(pool, day, otherSlotMeals, { tags, targets, prefs })
```

where `prefs` is `{}` for now — Phase 23 supplies the real object and Phase 24
threads it through the walkthrough. `openSwapPicker` (274) is **unchanged**;
it still receives an ordered meal array. Do not pass `budget`/`lastUsedDay`
here: the swap picker has no plan-wide cost or recency state, matching
today's behaviour.

## Downstream (expected, not a bug)

- Phase 23 writes `mp_planPrefs` and renders chips from this file.
- Phase 24 passes real `prefs` into `candidatesFor`; swap-picker order will
  then legitimately differ from today's.
- Phase 26 calls `rankSlot` with `{ tags, targets, prefs }` only, omitting
  `budget`/`lastUsedDay` — which is precisely why it sets `approximate: true`.

## Edge cases

| Case | Required behaviour |
|------|--------------------|
| `prefs` absent / `{}` | Layers 2-3 skipped. Output identical to today. |
| `prefs.chips` contains an unknown id | Silently dropped by `activeChips`. Never throws. |
| `prefs.vocab` missing but `chips` non-empty | No vocab ⇒ no definitions ⇒ layer 2 no-op. |
| Every meal hits an avoid chip | All go to tail; relative layer-1 order preserved; plan still fills. |
| Meal hits both a prefer and an avoid chip | Treated as prefer. |
| `busyDays` = all 14 | Every quick-fill slot biases quick; batch runs keep their original `d0`. Plan still fills. |
| `busyDays` contains 0, 15, or a non-number | Never matches `dayNum`; ignored without error. |
| Chip with no criteria keys | Hits nothing. |
| `pool` is empty | `rankSlot` returns `[]`; `pickMeal` closure yields `null`, as today. |
| `excludeIds` covers the whole pool | Existing line-101 fallback still applies before any new layer. |

## §6 Tests — `test.html` group 40

Logic-only, no DOM. Follow group 39's structure.

- `rankSlot` with no `prefs` returns an array whose `[0]` equals the old
  `pickMeal` result for the same fixture (pin the expected meal id).
- Return length always equals `pool` length minus exclusions — assert for
  empty prefs, prefer-only, avoid-only, and both.
- A prefer chip moves a matching meal ahead of a higher-nutrition
  non-matching one; a second call with that chip absent restores the original
  order (proves reorder, not re-score).
- An avoid chip sends matches to the tail but drops none.
- Meal hitting prefer+avoid lands in the prefer group.
- Unknown chip id is a no-op.
- `chipHits`: keyword matches on meal name; on ingredient key; tag matches
  only on `"high"`; `prepEffort` exact match; empty-criteria chip hits nothing.
- Busy day biases quick to the head; the same call with `prefer: "batch"` is
  unaffected by busy.
- Busy `run[0]` rotates the cook day to the first non-busy day; all-busy run
  is unchanged.
- `generatePlan` with and without `prefs` produces an identical plan when
  `prefs` is `{}` (compare serialised `days`, ignoring `generatedAt`).

## §7 Docs

- `docs/ARCHITECTURE.md` — correct the `rankSlot` signature to the `opts`
  form (§ "Calls made without a gate"); note the `prefer: "batch"` exemption
  from busy bias; confirm layers 4-5 unchanged.
- `docs/roadmap.md` — mark Phase 22 shipped; delete its "Open scoping" note,
  both questions are now answered (D1, D3).
- `CLAUDE.md` — extend the cost/pantry invariant paragraph with chips/busy as
  layers 2-3, and add `plan-preferences.json` to the "data, not inline
  constants" list.
- `SPEC.md` — only if it enumerates generator layers; otherwise leave it.
- No `sw.js` change: `plan-preferences.json` is not fetched by any page yet.
  Phase 23 adds it to the shell list when it first loads it.

## §8 Manual pass

1. `python3 -m http.server 8000`, open `plan.html`, hit Generate. Plan fills
   all 14 days, dinners included; no console errors.
2. Compare against a plan generated from `git stash`-free `git show HEAD:` —
   same seed date, same library ⇒ same plan. Any difference is a bug.
3. Open the swap picker on two different days; candidate order matches
   pre-change behaviour.
4. In the console: `MP.Generator.rankSlot` is a function; calling it with
   `{ tags, targets, prefs: { chips: ["comfort"], vocab } }` moves comfort
   meals up and still returns the full pool.
