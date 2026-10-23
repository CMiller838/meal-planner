# Phase 76: Cheaper swaps route [M]
Plain: the assistant can ask "what could I swap on this week's shopping list to spend less?" and get cheaper like-for-like ingredient swaps, with what each swap changes nutritionally.

Requires: Phase 28 (`substitution-groups.json`, `ShoppingList.groupIndex`) done, Phase 55 (`GET /shopping`, `POST /shopping/lines`) built. Nothing unbuilt.

## Decisions

All own calls; no open gate.

- **Route `GET /swaps?day=N&limit=K` (new path, no clash: `worker/worker.js` has `/substitutions`, `/shopping`, no `/swaps`).** `day` = 1-based plan day; it selects the shop list that day belongs to (`ShelfLife.shopDayFor(day, ShelfLife.shopOffset(plan))`). Absent = the plan's first shop list. `limit` 1-10, default 5. 400 on a bad value, 409 when library/plan not synced (same text as `shopping()`).
- **Reuse `buildLists`, never re-price.** The route builds the list exactly as `shopping()` does (extract that function's KV read + `buildLists` into a small helper both call; no behaviour change to `/shopping`), takes `list.lines` (staples and unpriced `estimated`-only lines excluded), sorts by `lineCost` desc and walks the top `limit` lines that have a group (`ShoppingList.groupIndex(SUB_GROUPS)[normalizeKey(key)]`). No group, no swap: that line is simply absent.
- **Cost of a swap** = `ShoppingList.packsFor(line.needed, priceFor(mate.key, PACK_DATA)) * mate price`, the same function the shopping page uses. Only a mate with `now.cost < was.cost` (strictly, by at least 1p) is returned. When `line.needed.unit` differs from the mate's pack unit, `packsFor` already falls back to 1 pack: return it with `estimated: true` rather than inventing a conversion. (Today's only group, onion/peppers, is g vs each, so its swaps are `estimated`.)
- **Exclusions re-checked on every meal that uses the line in that shop list**: for each such meal, `Exclusions.check(MP.applySubs(meal, [{from:key,to:mate.key,label}]), hardTerms)`; any failure drops the whole swap. `hardTerms` = `readSettings(env)` allergies + never (the Worker twin of `MP.Sync.hardTerms`, `hermes-sync.js` ~l.397). Mushroom/egg/toastie rules apply through `check`. The swap never reorders or re-scores nutrition; it is a suggestion list only.
- **`tagChanges`** = for each nutrient key in `TAGS[from] ∪ TAGS[to]` (`ingredient-nutrient-tags.json`, keyed by ingredient key) whose level differs: `{ nutrient, from: "high"|"med"|"low"|null, to: ... }`. Tags are the approximate coverage checklist (CLAUDE.md), not grams: docs say so; no key in the file for either side = empty list, not an error.
- **Read-only; applying is the assistant's job** through the existing `POST /shopping/lines`: the response carries `lineId` (the `p:` id) and the mate's `qty` so the assistant can `skipped` the original and add an `x:` line. No new write route, no KV key, no change to the plan or recipes (a swap here is a shopping choice only; the plan's `slot.subs` stays generator-written).
- **Assistant access:** add `GET /swaps` to `ASSISTANT_ALLOWED` (it is the consumer, read-only, nothing wider).
- **Thin data, said plainly:** `substitution-groups.json` has one group (onion/peppers), so most weeks the route returns `[]`. Adding groups is a data-only follow-up the user can request; not in this phase.

## Files touched

- `worker/worker.js`: `swaps(params, env)`, route branch next to `/shopping` (~l.1504), `ROUTES` read list (~l.1181), `ASSISTANT_ALLOWED` (~l.46); extract the shared list-building helper from `shopping()` (~l.585). `shopping-list.js` (defining `buildLists`, `packsFor`, `priceFor`, `groupIndex`, `normalizeKey`), `shelf-life.js` (`shopDayFor`, `shopOffset`), `exclusions.js` (`check`), `data.js` (`applySubs`) are already imported by the Worker and already carry the `window` → `root` shim: no change, no new import.
- `worker/routes.json`: regenerate with `node tools/routes_build.mjs` (`worker_test.mjs` fails on a stale one).
- `tools/worker_test.mjs`: new cases. `docs/roadmap.md`: mark done with what was verified. `docs/ARCHITECTURE.md` / `CLAUDE.md` route lists only if they enumerate read routes (Grep `/expiring`).
- No app/UI file, `sw.js` bump unneeded (no cached site file changes). No new dependency, KV key or `generator.js` diff.

## Signatures

```
GET /swaps?day=&limit= -> 200 {
  updatedAt, shopDay, swaps: [{
    lineId, key, label, meals: [name],
    to: { key, label, qty: {value,unit,raw}|null },
    was: { packs, cost }, now: { packs, cost }, saving, estimated,
    tagChanges: [{ nutrient, from, to }]
  }]
}   // sorted by saving desc; [] when nothing qualifies
worker.js: swaps(params, env)
```

## Edge cases

- No groups for any priced line, or every cheaper mate rejected: `200 { swaps: [] }`, not an error.
- `day` outside the plan: 400 "day must be a plan day"; non-integer / `limit` out of 1-10: 400.
- Line already `got`/`skipped` in KV `shopping`: not offered (state read as `shopping()` does).
- Pantry already covers the line (`needed` zero): `lineCost` 0, never offered.
- Mate is mushroom or hits an allergy/never term: dropped silently (never listed as rejected: nothing excluded leaks).
- Meal names come from the library/TheMealDB; JSON only, no HTML, so no `esc` concern in the Worker.

## Verification

- `node tools/worker_test.mjs` with new fixtures: (1) library with two meals using `onion`, plan, `substitution-groups` onion/peppers: a swap is returned with `saving > 0`, `estimated: true` for the unit mismatch and a `tagChanges` entry; (2) the same with settings `never: ["peppers"]`: swap absent; (3) a fixture group whose mate is mushroom (test-only SUB_GROUPS override or stubbed `groupIndex`): never returned; (4) a line with no group: absent; (5) 400 on `limit=0`, `day=99`; (6) the assistant token gets 200 and the app token too; no token 401.
- `node tools/routes_build.mjs` then `python3 check.py` (stale `routes.json` fails `worker_test`; `data_check` worker imports).
- `python3 tools/spec_lint.py phase76`
- No real credential needed (test fakes only).

## Tasks

Logic (TDD):
- [ ] Extract the `shopping()` list-building helper; confirm `/shopping` tests unchanged
- [ ] `swaps()`: shop-list select, top-N priciest grouped lines, cost compare via `packsFor`/`priceFor`, exclusion re-check per using meal with allergies+never, `tagChanges`, sort/limit
- [ ] Route branch, `ROUTES` row, `ASSISTANT_ALLOWED`, `node tools/routes_build.mjs`
- [ ] `worker_test.mjs` cases above
- [ ] Mark Phase 76 done in `docs/roadmap.md`
- [ ] Live: ask the assistant "any cheaper swaps this week?" against the deployed Worker and confirm the answer matches `GET /swaps`
