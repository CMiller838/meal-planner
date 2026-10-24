# Phase 80a: Log anything — Worker resolver, food log and cross-checked lookup [L]
Plain: you (through the assistant) can log any food, including off-plan meals, staples and supplements. It works out the grams and nutrients, takes it off the pantry once, and anything it can't confirm stays blank rather than counting as zero.

Requires: Phases 30, 31 (structured qty, `remainingQty`), 32 (eat-requests queue), 33a/33b (products, `cofid.json`),
34, 48 (activity log, `logWrite`, undo): all built. App side: Phase 80b. Assistant side: `notion_assistant` Phase 54.

## Decisions

**User-chosen (gates, 2026-10-24)**
- **Lookup = both paths.** For an unknown food the Worker calls Open Food Facts (search, no key) and USDA FoodData Central
  (search, `env.USDA_API_KEY`) itself. The caller (Hermes) may also send per-source values in `candidates`, each with
  an https `url`, e.g. a manufacturer page. All candidates go through one pure `crossCheck`. With no USDA key the
  Worker skips USDA and fetches only OFF; Hermes candidates still count.
- **No app input this phase.** The assistant is the only caller of `POST /food-log`. The app only reads (80b).

**Own calls**
- **Worker route, not client**: the assistant needs the result back in one call (what matched, grams, confirmed and
  unconfirmed nutrients, pantry change).
- **New KV key `foodLog`**, Worker-owned: `{ updatedAt, entries: [...] }`, capped at 500 entries with the oldest
  dropped. Not `eatenLog`: that key is an app-owned mirror the app PUTs whole, so it would erase Worker additions.
  Entries carry no plan slot. `ITEMS.foodLog = ["entries", (e) => e.id]` makes writes logged and undoable. Not in
  `KEYS`, so there is no generic PUT; explicit `GET /food-log` + `POST /food-log`, both in `ASSISTANT_ALLOWED`.
- **Idempotency**: the caller supplies `id` per entry; an id already in `foodLog` returns `status: "duplicate"` and
  writes nothing (no pantry change). "Have" entries are stored too (`kind: "stock"`) so a replay doesn't add twice;
  every nutrient reader skips `kind: "stock"`.
- **Resolver order** (nutrient source): (1) a saved product whose `normalizeKey(name)` equals the food's key, or whose
  `ingredient` equals it; (2) a pantry item of that name, which links to a product/CoFID via its name; (3) CoFID through
  `cofid.json` `map`, keyed by the normalized name, falling back to the first map key whose first `_` word equals the
  name's last word (`chicken` → `chicken_breast`; mark it `// ponytail:` as a head-noun heuristic, with aliases in
  `food-log.json` as the upgrade path). Eating uses the map's `cooked` food when one exists, else `default`; (4) the
  lookup; (5) nothing: logged with `nutrients: {}`, `source: "none"`, and every tracked key listed as unconfirmed.
  **Pantry matching is separate from the nutrient source**: deduction looks up the pantry by `normalizeKey` whatever
  supplied the nutrients.
- **Lookup results are saved as a product** (`id: "food:<normalizeKey>"`, `per: "100g"`, `source: "lookup"`) so the
  next log resolves at step 1 without fetching again. Each nutrient entry is
  `{ value, basis: "estimate", sources: [names] }`. `MP.Products.setNutrients` gains an optional `sources` argument
  (`products.js`, the only shaper): a `label`/`off` value still outranks `estimate`, and when a label overwrites an
  estimate the `sources` field goes with it. `"lookup": true` on an entry forces a fresh lookup for a product that
  already exists, filling only nutrients it doesn't have.
- **Cross-check** (`crossCheck`): per nutrient key, take the values from distinct source names (case-insensitive;
  a repeat source counts once). Find the largest group in which every pair satisfies `|a-b| <= tol * max(a,b)`
  (two zeros agree). A group of 2 or more saves its mean (rounded to 2 dp) with the group's source names. Anything
  else goes in `unconfirmed`. Tolerance comes from `food-log.json`: `macro` 0.15 for `energy_kcal, protein_g,
  carbohydrate_g, fat_g, saturates_g, sugars_g, fibre_g, salt_g, sodium_mg`, `micro` 0.25 for everything else.
  A Hermes candidate needs `source` (1-40 chars) and an `https://` `url`, else 400. Two Hermes candidates with
  different source names count as two sources (the user's choice). Every saved estimate records its source names, so
  this stays traceable.
- **Amounts**: grams are the unit of record. `parse(text)` reads `"chicken 200g"`, `"200g chicken"`, `"2 waffles"`,
  `"1 potato"`, `"200 servings of glycine"`, `"20 Guayusa tea bags"`, `"tea"` into `{ name, grams?, count? }`
  (kg→g; ml read as g, `// ponytail: density 1`; a leading `N servings of` / `N x` is a count). The caller may also
  send structured `{ name, grams?, count? }` instead of `text`. A count converts through `product.itemGrams`, then
  `food-log.json` `itemGrams[normalizeKey(name)]`, and sets `gramsEstimate: true`. With no item weight the entry
  returns `status: "needs-grams"`, writes nothing, and the batch continues. A follow-up with `gramsPerItem` saves
  `itemGrams` on the product (creating `food:<key>` when there is none), so it asks only once. Neither grams nor a
  count given (`"tea"`): count 1.
- **Frozen nutrients**: `entry.nutrients[key] = { value: per100 * grams / 100 (2 dp), basis }`, copied at log time.
  An absent key means unknown, never 0.
- **Pantry**: `action: "eat"` deducts from the matched pantry item through `ShoppingList.parseQty`/`remainingQty`
  (clamped at 0). It uses grams when the item's unit is `g`/`ml`, the count when it is `each`. A unit mismatch, an
  unparseable qty or no qty means no deduction, and the result says why. `action: "have"` adds: an existing item with
  the same unit gets the value added; a new item is `{ name, qty: { value, unit, raw } }`; no amount means one pack
  when the product has `pack`, else an item with no qty. One pantry `logWrite` per request with `who` = actor, plus
  `updatedAt` set so the app's next sync pulls it. This is a second pantry writer, from the assistant's side like
  `PUT /pantry`. `commitCook` stays the app's only one.
- **Undo**: one activity entry per KV key written (`foodLog`, `pantry`, `products`), and the response returns their ids
  as `activity: [...]`. The caller undoes each one with the existing `POST /activity/undo`. No multi-key undo.
- **Coverage**: `Nutrition.foodAsEaten(entry, targets, tagShare)` in `nutrition.js` (already shimmed and imported by the
  Worker) maps an eat entry to an eaten-log-shaped orphan:
  `{ id: "food:"+id, mealId: "food:"+id, name, eatenAt: when, tags, proteinGrams }`. `tags` holds each
  `TRACKED_NUTRIENTS` name whose `<name>_<unit>` value is at least `tagShare` (0.1) of that target. The existing
  orphan path in `eatenDayCoverage` then counts them as "partial" at most, so the checklist model is unchanged.
  `eatenDayCoverage` adds orphans' `proteinGrams` (real grams) to `cov.proteinGramsApprox`. `/day` and `/nutrition`
  read `foodLog`, append these to the eaten log for the day and week maths, and also return
  `offPlan: [{ name, grams, count?, gramsEstimate?, unconfirmed, eatenAt }]` (`/day` as `type: "food"` cards).
- **No new dependency**: `fetch` is the platform's. The lookup takes an injected `fetchImpl` and a 4 s timeout per
  source; a failed or slow source counts as absent.

## Files touched
- `worker/food-log.js` (new, plain ESM, Worker-only; `ls` confirmed no clash): `parse`, `crossCheck`,
  `resolve`, `lookup`, `fromUsda`, `fromOffSearch`.
- `food-log.json` (new, root, data): `{ tolerance: { macro, micro, macroKeys }, tagShare, itemGrams: { potato: 175,
  egg: 58, banana: 118, waffle: 35, white_bread: 36, tortillas: 62, tea_bag: 2, ... }, usdaIds: { energy_kcal: 1008,
  protein_g: 1003, carbohydrate_g: 1005, fat_g: 1004, saturates_g: 1258, fibre_g: 1079, sugars_g: 2000,
  sodium_mg: 1093, potassium_mg: 1092, calcium_mg: 1087, magnesium_mg: 1090, iron_mg: 1089, zinc_mg: 1095,
  vitA_mcg: 1106, vitC_mg: 1162, vitD_mcg: 1114, vitB12_mcg: 1178, folate_mcg: 1177 } }`. Comment the item weights
  as typical-weight estimates in `_note`.
- `worker/worker.js`: imports `./food-log.js`, `../food-log.json`, `../cofid.json`; `postFoodLog(request, env, who)`,
  `getFoodLog(env)`, `foodLogError(parsed)`; `ITEMS.foodLog`; `ROUTES` rows (`GET /food-log` read,
  `POST /food-log` write `{ log: "logged" }`); `ASSISTANT_ALLOWED` both; `dayView`/`day`/`nutrition` read `foodLog`.
  The `products` write goes through `productsError` (it ignores extra keys, so `itemGrams`/`sources` pass; check this).
- `products.js`: `setNutrients(product, values, basis, sources?)`; `itemGrams` passes through `merge` (grep `merge`).
  Already shimmed; no `window.` at top level.
- `nutrition.js`: `foodAsEaten`; `eatenDayCoverage` adds orphan `proteinGrams`. No `window.` at top level.
- `worker/routes.json`: regenerate (`node tools/routes_build.mjs`).
- `tools/worker_test.mjs`: cases below (stub `globalThis.fetch` as the `/discover` test does, l.~767).
- `docs/HERMES.md`: `POST /food-log` / `GET /food-log` contract (request, statuses, response, undo).
- `CLAUDE.md`: one invariant line: "**The food log (Phase 80) is Worker-owned**: KV `foodLog`, written only by
  `POST /food-log`, read-only in the app (`mp_foodLog`). Entries have no plan slot; nutrients are frozen at log time,
  an absent key is unknown, never 0. Estimates come only from `crossCheck` (2+ agreeing sources, recorded). The route
  also deducts/adds the KV pantry (logged); `commitCook` stays the app's only pantry writer." Also amend the qty line
  "`commitCook` (`plan.js`) is still the only writer of `qty`" to say "app-side writer; the Worker's `POST /food-log`
  also writes `qty`".
- `sw.js`: bump `CACHE` only if `products.js`/`nutrition.js` are in the cache list (they are). Add `food-log.json` to
  the cached files only in 80b, when the app reads it.

## Signatures / schemas
```
POST /food-log  body { entries: [Entry] } (1-20)  -> 200 { results: [Result], activity: [activityId] }
  Entry  { id: string<=80, action: "eat"|"have", when?: ISO (default now), text?: string<=120 | name?: string,
           grams?: >0, count?: int>0, gramsPerItem?: >0, lookup?: true,
           candidates?: [{ source, url: "https://...", per: "100g", nutrients: { key: number>=0 } }] (<=5) }
         exactly one of text/name; unknown keys -> 400; whole body 400 on any bad entry, nothing written
  Result { id, status: "logged"|"stocked"|"duplicate"|"needs-grams", name, grams?, count?, gramsEstimate?,
           matched: { kind: "product"|"pantry"|"cofid"|"lookup"|"none", ref? },
           nutrients, unconfirmed: [key], pantry: { name, before, after } | { deducted: false, reason } | null }
GET  /food-log?from=&to=  -> 200 { entries } (window optional, YYYY-MM-DD, <=31 days)
KV foodLog  { updatedAt, entries: [{ id, kind: "eat"|"stock", when, name, grams?, count?, gramsEstimate?,
              nutrients: { key: { value, basis } }, source: "product:<id>"|"cofid:<code>"|"lookup"|"none" }] }
food-log.js: parse(text) -> { name, grams?, count? } | null
             crossCheck(candidates, tol) -> { nutrients: { key: { value, basis: "estimate", sources } }, unconfirmed }
             resolve(food, { products, pantry, cofid, action }) -> { kind, ref, per100, product? } | null
             lookup(name, { fetchImpl, usdaKey, usdaIds }) -> [candidate]   // OFF + USDA, failures -> []
nutrition.js: foodAsEaten(entry, targets, tagShare) -> eaten-log-shaped orphan
products.js: setNutrients(product, values, basis, sources?)
```

## Edge cases
- Replay of the same id: `duplicate`, the pantry is byte-identical, and there's no new activity entry.
- A batch mixing `logged` and `needs-grams`: only the logged ones are written, in one write per key.
- Two sources disagreeing on one nutrient and agreeing on another: one saved, one unconfirmed.
- One source only: everything unconfirmed and nothing saved as an estimate, but the entry is still logged.
- A label value already on the product: the lookup never overwrites it (`setNutrients` precedence).
- A pantry item at 50 g after eating 200 g: clamped to 0, and the result shows before/after.
- A pantry qty in `each` while eating grams with no count: no deduction, `reason: "unit-mismatch"`.
- A supplement with no tracked nutrients (glycine): logged and deducted, no coverage tags.
- `kind: "stock"` entries never reach `foodAsEaten`, `/day` or `/nutrition`.
- An OFF/USDA timeout, a non-200 or bad JSON: that source is absent; no 500.
- No `USDA_API_KEY`: OFF plus candidates only.
- A candidate with an `http://` url, a missing source or a negative value: 400, nothing written.

## Verification
- `node tools/worker_test.mjs`: "chicken 200g" resolves from CoFID with fetch stubbed to throw (no lookup, no
  network). "2 waffles" logs `count: 2`, `grams: 70`, `gramsEstimate`. An off-plan eat deducts the pantry once and
  replaying it deducts nothing. Two agreeing stubbed sources save `estimate` with both names; two disagreeing save
  nothing for that nutrient. A `label` product value survives a lookup, and a label set afterwards replaces the
  estimate. A no-data item logs `nutrients: {}`. Undoing the returned pantry id restores the pantry. Undoing the
  foodLog id removes the entry. `needs-grams`, then `gramsPerItem`, saves `itemGrams`. `/day` and `/nutrition`
  include `offPlan`, and protein grams rise by the entry's real protein. Auth: app and assistant tokens allowed, others 401.
  No real credential needed (USDA key and HTTP responses are test fakes).
- `python3 check.py` (data_check: worker imports, sw.js bump; ui pages unchanged).

## Tasks
### Logic (TDD, `tools/worker_test.mjs` first)
- [ ] `food-log.json` + `worker/food-log.js` `parse` with cases for every Amounts example
- [ ] `crossCheck`: agree/disagree/single/duplicate-source/zeros, macro vs micro tolerance
- [ ] `fromOffSearch`/`fromUsda` mappers + `lookup` with injected fetch, timeout, no key
- [ ] `resolve` order: product → pantry → CoFID (cooked for eat, head-noun fallback) → none
- [ ] `products.js` `setNutrients(..., sources)` + `itemGrams` passthrough
- [ ] `foodLogError` validation, `postFoodLog`: idempotency, needs-grams, eat deduct (clamp, mismatch), have add
      (same unit, new, one pack, no qty), product upsert, one `logWrite` per key, `activity` ids
- [ ] `GET /food-log`, `ITEMS`/`ROUTES`/`ASSISTANT_ALLOWED`, `node tools/routes_build.mjs`
- [ ] `Nutrition.foodAsEaten` + `eatenDayCoverage` protein; `/day` + `/nutrition` `offPlan`
- [ ] Undo of each returned id restores its key
### Docs
- [ ] `docs/HERMES.md` contract, `CLAUDE.md` invariant + qty line amendment, `sw.js` CACHE bump
