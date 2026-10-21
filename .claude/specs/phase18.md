# Phase 18 — Per-meal cost badges on Library & Discover cards

**Goal:** show each meal's cost on its card while browsing, so cost is visible
at pick time rather than only as a shopping-list total after a plan is built.

Phase 17 already derived the per-meal cost figure and exported it. This phase
adds **no pricing logic** — it is a rendering phase plus one threshold lookup.

---

## Decisions (answered explicitly by the user)

| # | Decision | Chosen |
|---|---|---|
| D1 | Where the cheap/med/pricey thresholds live | **B — a `costTiers` block inside `pack-sizes.json`**, not a new data file. Same file as the other pricing data and the `planning` knobs; nothing new to fetch, and `pack-sizes.json` is already loaded on both pages. |
| D2 | What the badge displays | **A — `mealCost().total`**, the whole-pack shop cost, identical to what the generator's budget step and the shopping list already use. One cost number across the app, not a second per-portion figure that would disagree with the shopping list. |
| D3 | Discover cards | **A — badges shown, but marked estimated when `estimated: true`**, mirroring Phase 17's `~£` + `.estimated` convention from `shopping.js:45`. |

D3 matters more on Discover than anywhere else: TheMealDB ingredient keys
mostly miss `pack-sizes.json`'s `items`, so nearly every Discover badge will
be a category estimate. The `~` is what stops it reading as a real price.

---

## Findings (verified, do not re-derive)

- `MP.ShoppingList.mealCost(meal, packData)` → `{total, estimated, keys}`
  (`shopping-list.js:72-115`, exported at `:275`). Already skips
  `isSkippedIngredient` so `leftover_*` lines cost £0. Uses the **base** meal.
- `MP.ShoppingList.load()` resolves `pack-sizes.json`.
- **`app.js` already loads it**: `app.js:570-574` awaits
  `MP.ShoppingList.load().catch(() => null)` into a module-level `packData`
  (`app.js:7`). Nothing to wire on Browse & Add.
- **`discover.js` does not** — it has no `packData`. `discover.html:73` does
  load `shopping-list.js` (used at `discover.js:247` for `normalizeKey`), so
  only the fetch itself is missing.
- Library card HTML: `renderLibrary()` `app.js:141-153`, tags via
  `tagRowHtml(meal)` (`app.js:117-123`) → `<div class="tag-row">` of
  `<span class="tag {level}">`.
- Discover card HTML: `cardInner(meal)` `discover.js:32-41` (swipe deck) and
  the saved-for-later grid `discover.js:163-178`. Both have no tag row today.
- Discover meals carry full `ingredients` at render time (`mealdb.js:52-64`).
- Estimated-price convention: `shopping.js:45` — `~£` prefix plus class
  `.estimated`; styled at `style.css:589` (`font-style: italic`).
- Badge styles: `.tag-row` `style.css:177`, `.tag` `:178-188`, level modifiers
  `.tag.high` `:189`, `.tag.med` `:190`.

## Non-goals

- **No badge on the 2-Week Plan** (`plan.js daySlotHtml`). The roadmap scopes
  this phase to Library and Discover — cost on a plan slot is a decision you
  have already made, and `shopping.html` gives the plan's real total.
- **No new pricing maths, no per-portion cost, no new dependency.**
- **No sorting or filtering by cost.** CLAUDE.md's invariant stands: cost never
  reorders nutrition. These badges are informational only.
- No backfill of `items` prices for TheMealDB keys (Phase 17 D7 rule: don't
  invent prices).

---

## §1 `pack-sizes.json` — new `costTiers` block

Add one top-level key alongside `items` / `categories` / `keywords` /
`planning`:

```
"costTiers": { "cheap": 6.00, "med": 12.00 }
```

Semantics: `total <= cheap` → `cheap`; `total <= med` → `med`; otherwise
`pricey`. Both bounds inclusive.

These are **hand-tuned knobs, not derived constants** — same status as
`planning.reuseCredit`. The seed values assume whole-pack costs (a 5-ingredient
dinner buying full packs lands well above a per-portion figure). Expect to
adjust them once real badges are on screen; that is the manual task at the end.

## §2 `shopping-list.js` — two additions

```
costTier(total, packData) -> "cheap" | "med" | "pricey" | null
```
- Returns `null` when `packData` is falsy or `packData.costTiers` is absent —
  never throws. `null` means "render the price with no tier styling".

```
costBadgeHtml(meal, packData) -> string   // "" or one <span>
```
- Returns `""` when: `packData` is falsy, `meal` has no `ingredients`, or
  `mealCost(...).total === 0`. A `£0.00` badge is noise.
- Otherwise returns exactly one element:
  `<span class="tag cost {tier}{ estimated}">~£12.34</span>`
  — `{tier}` omitted when `costTier` returns `null`; `estimated` class and the
  `~` prefix present only when `mealCost().estimated` is true; `£` alone
  otherwise.
- **Interpolates only numbers and the fixed tier/estimated words** — no meal
  name, no ingredient key, nothing from TheMealDB. This is what keeps it safe
  under the no-unescaped-`innerHTML` invariant; do not extend it to include a
  label sourced from meal data.
- Total formatted with `.toFixed(2)`.

Export both from the `MP.ShoppingList` object (`shopping-list.js:275`).

Both live here rather than being duplicated into `app.js` and `discover.js` —
`toast()` is already triplicated across those files (`app.js:73` notes it) and
that is not a pattern to extend. `shopping-list.js` is loaded on every page
that needs the badge.

## §3 `app.js` — Library cards

- In `tagRowHtml(meal)` (`:117-123`), prepend
  `MP.ShoppingList.costBadgeHtml(meal, packData)` inside the existing
  `<div class="tag-row">`, and change the early `if (!tags.length) return ""`
  guard so a row still renders when there are no nutrient tags but there **is**
  a cost badge. Cost badge first, nutrient tags after.
- No other call-site change: `renderLibrary()` `:149` already calls
  `tagRowHtml(meal)`, and `packData` is already in scope.

## §4 `discover.js` — Discover cards

- Add module-level `let packData = null;` and, in `init()` (`:329-333`), set it
  from `await MP.ShoppingList.load().catch(() => null)` **before**
  `renderSaved()` / `loadPool("")`. Discover must still work if the fetch
  fails — a null `packData` simply yields no badges.
- `cardInner(meal)` (`:32-41`): append
  `<div class="tag-row">${MP.ShoppingList.costBadgeHtml(meal, packData)}</div>`
  after the description, inside `.card-body`; emit nothing when the badge
  string is empty.
- Saved-for-later grid (`:163-178`): same badge, placed after the description
  and before `.card-actions`.

## §5 `style.css` — one modifier set

Beside `.tag.high` / `.tag.med` (`:189-190`):

- `.tag.cost` — base cost badge (neutral, distinguishable from a nutrient tag).
- `.tag.cost.cheap` / `.tag.cost.med` / `.tag.cost.pricey` — colour ramp. Reuse
  existing custom properties (`--accent-2`, `--butter`, `--border`); introduce
  no new palette values.
- `.tag.cost.estimated` — italic, matching `.shop-price.estimated` (`:589`).

Must read correctly in dark mode (the default).

---

## Edge cases

| Case | Behaviour |
|---|---|
| `pack-sizes.json` fails to fetch (offline) | No badges anywhere. No console error, no layout shift beyond the missing span. |
| `costTiers` missing from the JSON | Price still shown, no tier class. |
| Meal with only `leftover_*` ingredients | Total £0 → no badge (correct: it buys nothing). |
| Meal with no `ingredients` array | No badge. |
| TheMealDB meal, all keys unmatched | Badge shows `~£…` with `.estimated`, tier from the estimated total. |
| Meal variants (Phase 14) | Badge uses the **base** meal, matching `mealCost`'s documented behaviour — do not swap in `MP.effectiveMeal`. |

## §6 Tests — `test.html` **group 37**

Follow the group-36 pattern (`test.html:1268+`): a fixture `packData` object
literal and `check(name, bool)` assertions. Write these before the code.

- `costTier`: below `cheap` → `"cheap"`; exactly `cheap` → `"cheap"` (inclusive
  boundary); between → `"med"`; exactly `med` → `"med"`; above → `"pricey"`.
- `costTier`: `packData` without `costTiers` → `null`; `packData` null → `null`.
- `costBadgeHtml`: priced meal → string contains `£`, does **not** contain `~`,
  has no `estimated` class.
- `costBadgeHtml`: meal with an unpriced ingredient → contains `~£` **and**
  `class` includes `estimated`.
- `costBadgeHtml`: `packData` null → `""`; meal with no ingredients → `""`;
  leftover-only meal (total 0) → `""`.
- Regression guard: `mealCost` / `priceFor` / `costIndex` outputs for the
  group-36 fixtures are unchanged — this phase adds consumers, not maths.

## §7 Docs

- `docs/roadmap.md` — Phase 18 → **Status: Complete**; one "as built" note that
  the badge shows the whole-pack `mealCost().total` (D2) rather than a
  cheap/med/pricey word alone, with the tier used only for colour. Leave the
  goal line intact.
- `CLAUDE.md` — extend the existing pricing invariant: `costTiers` is data in
  `pack-sizes.json`, same rule as `planning`; cost badges are informational and
  never sort or filter meals.
- `SPEC.md` — one line: cost visible per meal while browsing, estimates marked.
- `docs/ARCHITECTURE.md` — `costTiers` in the `pack-sizes.json` shape, and the
  note that `costBadgeHtml` lives in `shopping-list.js` to avoid a third copy of
  a render helper.
- `docs/FUTURE.md` — the "Per-meal cost tags" entry (`:16-25`) and "Per-meal
  cost badges on Browse/Discover cards (Phase 18)" (`:165-171`) are now
  shipped; remove or mark them done, and park the plan-slot badge as skipped.

## §8 Manual pass

- Open Browse & Add with a real library: are the tier thresholds sensible, or
  is everything `pricey`? **Tune `costTiers` in `pack-sizes.json`** — that is
  what the knob is for. Do not adjust the maths instead.
- Open Discover: confirm badges are `~£` italic (almost all will be), and that
  a badge never obscures the swipe stamps (`.fan-stamp`) on a dragged card.
- Load with the network throttled so `pack-sizes.json` fails: both pages render
  normally with no badges and no console error.
