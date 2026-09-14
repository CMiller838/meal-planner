# Phase 26 — Hermes `GET /ranking` (read-only, computed in the Worker)

One new route on `worker/worker.js`, answering both "why was X picked" and
"give me the top N" with the same computation (`ARCHITECTURE.md:343-347`). The
Worker imports the app's **own** `nutrition.js` + `generator.js` and calls
`rankSlot` over the `library` / `plan` / `planPrefs` KV values — no second
ranking implementation (`ARCHITECTURE.md:377-379`).

Three files: `generator.js` (two exports + a global shim), `nutrition.js` (the
same shim), `worker/worker.js` (one branch + one function). Plus `sw.js`'s
cache bump and `test.html` group 43.

**No `PUT /ranking`, ever.** The write path stays `PUT /placements`, unchanged
this phase (`ARCHITECTURE.md:371-373`).

## Decisions (answered 1A)

| # | Decision | Chosen | Why |
|---|----------|--------|-----|
| D1 | How does the Worker get each candidate's `chipHits`? | **A — add `chipHits` and `activeChips` to `MP.Generator`'s export list (`generator.js:266`)**; the Worker calls them and does the per-meal loop itself | Relayed to me by the coordinating agent as the user's own pick, matching my recommendation. Zero new logic anywhere: the Worker explains the ranking using the exact two functions `rankSlot` ranked with. Path B (reimplement the chip match in `worker.js`) is a second copy of the chip rule, straight against `ARCHITECTURE.md:377-379`, and a drift there makes Hermes *explain* a ranking it didn't produce. Path C (a new `annotate` wrapper) invents a function no in-app caller wants — and `covers` already works off an existing export. |

`covers` needs **no** new export: `MP.Nutrition.tagsForMeal(meal, tags)`
(`nutrition.js:45-53`, already in the export list at line 97) returns a meal's
nutrient names, so `covers` is that list intersected with `shortOn`.

### Calls made without a gate (trivial forks, noted for the record)

- **The Worker mirrors `plan.js`'s `candidatesFor` (`plan.js:266-275`) for its
  `rankSlot` arguments**, not `generatePlan`'s `pickMeal` call (`199-200`):
  `dayMealsSoFar` = the day's *other* slots out of the `plan` mirror, and
  **no** `prefer`, `budget`, `halfKeys` or `lastUsedDay`. `candidatesFor` is
  the in-app precedent for exactly this question ("what else could go here"),
  and it is the call the swap picker and the guided walkthrough already use.
- **…but the current meal stays in the pool.** `candidatesFor` filters it out
  (`m.id !== currentId`) because the swap picker is offering *replacements*.
  `/ranking` answers "why was X picked", so X must be able to appear with its
  own `rank`. `current` is also reported separately, so a client can compare.
- **`shortOn` is `dayCoverage(...).missing.concat(.partial)`** — the same
  `gapNutrients` array `rankSlot` builds internally (`generator.js:93-94`),
  recomputed in the Worker rather than returned out of `rankSlot`. Returning it
  would change `rankSlot`'s return type for one consumer; recomputing is two
  lines and `dayCoverage` is already exported.
- **Error bodies reuse the existing `json(status, reason)` string style**
  (`worker.js:27-32`, e.g. `json(400, "invalid JSON")`): `"day must be 1-14"`,
  `"slot must be breakfast, lunch, dinner or snack"`, `"n must be 1-10"`,
  `"library and plan must be synced first"` for the 409. No error object, no
  code field — nothing else in this Worker has one.
- **The `window` → `root` shim** on `nutrition.js` / `generator.js` is
  mechanical, copying `exclusions.js`'s existing shape (§1.1). Not a design
  fork; it's the prerequisite that makes the import work at all.
- **`slot` accepts all four slot types**, not just `dinner`. `SLOT_TYPES`
  already exists in the Worker (`worker.js:16`) and `rankSlot` is slot-agnostic
  — restricting to `dinner` would be extra code to do less.

## Findings (verified, do not re-derive)

- **`worker/worker.js`** (240 lines). Routing is generic via `KEYS` (11-15) and
  `VALIDATE` (176-186), but `/ranking` is **not** a KV relay route — it is a
  computed GET with query params and no KV key of its own. It needs its own
  branch in the `fetch` handler (189-238), modelled on the `/discover`
  special-case (198-201), **not** on `KEYS[url.pathname]`. `OPTIONS` (190) and
  the `X-Auth-Token` check (194) run before that branch, so `/ranking` inherits
  auth and CORS for free. `url.searchParams.get("q")` (200) is the only
  existing query-param read; `json(status, body)` (27-32) is the only Response
  helper, and it already merges `CORS`.
- **Import pattern is established**: `worker.js:4-6` does
  `import "../exclusions.js"; import "../mealdb.js"; import SUBS from
  "../substitutions.json";` then `const Exclusions = globalThis.MP.Exclusions;`
  (line 8). JSON imports are default exports resolved at bundle time — no
  fetch-at-request-time. `worker/wrangler.toml` has `main = "worker.js"` and no
  bundler config; wrangler bundles this automatically. **No build step, no new
  dependency** (CLAUDE.md).
- **`exclusions.js` already has the shim** (its lines 1-4, 72-74):
  `(function (root) { ... root.MP = root.MP || {}; root.MP.Exclusions = {...};
  })(typeof globalThis !== "undefined" ? globalThis : this);` — proven, since
  `worker.js` already imports it.
- **`nutrition.js`** (98 lines): `window.MP = window.MP || {};` at line 3, bare
  `(function () {` at 5, `})();` at 98. Exports at 97:
  `{ load, tagsForMeal, dayCoverage, weekCoverage, rankByGap, TRACKED_NUTRIENTS }`.
  - `load()` (16-24) does `fetch("ingredient-nutrient-tags.json")` /
    `fetch("nutrition-targets.json")` and caches `{ tags, targets }`. **It
    cannot run in the Worker** — relative browser `fetch`. The Worker must
    never call it; it imports the two JSON files directly instead. `tags` and
    `targets` are the *whole parsed files*, so the imported defaults drop in
    unchanged.
  - `dayCoverage(meals, tags, targets)` (56-71) →
    `{ proteinGramsApprox, proteinTarget, coverage, sodiumCaution, missing,
    partial }`.
  - `tagsForMeal(meal, tags)` (45-53) → sorted `string[]` of the meal's
    nutrients. This is what `covers` is built from.
  - `rankByGap(candidates, gapNutrients, tags)` (79-95) → the meal objects,
    reordered. No wrapper objects, no scores returned.
  - No `document`, no `localStorage`; `window` appears only at line 3 and
    `fetch` only at 19-20.
- **`generator.js`** (267 lines): `window.MP = window.MP || {};` at line 5,
  `(function () {` at 7, `})();` at 267, exports at 266.
- **`rankSlot(pool, dayNum, dayMealsSoFar, opts)`** (85-147) is self-contained:
  it calls only `MP.Nutrition.dayCoverage` / `rankByGap` and the private
  `effortOf` / `chipVocab` / `chipHits` / `activeChips` (44-77). It does **not**
  touch `MP.ShelfLife`, `MP.isBatch`, `MP.effectiveMeal` or `MP.ShoppingList` —
  those appear only inside `generatePlan` (220, 225) and `pickVariant`
  (156-159), which `/ranking` never calls. Property lookups inside uncalled
  function bodies don't evaluate at import time, so **`data.js`,
  `shelf-life.js` and `shopping-list.js` do not need importing into the
  Worker**.
- **`opts` shape used by `rankSlot`**: `{ tags, targets, prefs, budget,
  halfKeys, lastUsedDay, excludeIds, prefer }`. All optional except `tags` /
  `targets`. `prefs` is `{ vocab, busyDays, chips }` — `plan.js:19` and
  `plan.js:870` (`Object.assign({ vocab }, MP.PlanPrefs.get())`), where `vocab`
  is the parsed `plan-preferences.json` (`MP.PlanPrefs.loadVocab()`). The
  Worker builds the same object from the imported JSON plus the `planPrefs` KV
  value.
- **`chipHits(meal, chip, tags)`** (55-67) returns a boolean for one chip;
  **`activeChips(prefs)`** (70-77) returns `{ prefer: chip[], avoid: chip[] }`
  with unknown ids dropped. Chip objects carry `id`, `kind`, and any of
  `keywords` / `tags` / `prepEffort`.
- **KV shapes**: `plan` → `{ startDate, days: [{ day, slots: { dinner: {
  mealId, variantId? } } }], generatedAt }` (`generator.js:174-182`,
  `plan.js:136,141-144`); `library` → array of meals with `id`, `name`,
  `ingredients: [{key,…}]`, `mealTypes`, `prepEffort`, `servings`, `variants`,
  `leadsTo`; `planPrefs` → `{ updatedAt, busyDays: number[], chips: string[] }`
  (Phase 25).
- **`sw.js` `CACHE` is `"meal-planner-v18"`** (line 4). `worker.js` is not in
  the PWA shell; no shell-array change this phase.
- **`test.html` runs through group 42** (Phase 25, line 1709) — this is group
  43. There is no test harness for `worker/` (Phase 25's own note); Worker-side
  code is covered by the curl checks in §8.

## Non-goals

- **No `PUT /ranking`, ever** — no matter how the read side resolved. Hermes
  acts on a ranking only through the existing `PUT /placements` queue, which
  the app still re-checks against local `mp_plan` (`ARCHITECTURE.md:371-373`).
- **No change to `/placements`, `/planPrefs`, `/planFlag`, `/plan`, `/library`,
  `/prefs`, `/pantry`, `/adhoc`, `/eaten-log` or `/discover`.** `KEYS` and
  `VALIDATE` are untouched — `/ranking` has no KV key.
- **No cost layer and no pantry layer server-side.** The Worker carries neither
  `pack-sizes.json` pricing nor a pantry index, so `rankSlot` is called with no
  `budget` and `pickVariant` is never called. This is exactly why
  `approximate: true` is unconditional (`ARCHITECTURE.md:365-370`) — together
  with the `plan` mirror being stale by construction. Hermes must phrase
  answers as "it's ranking these highest", never "this is what the app will
  pick".
- **No change to `plan.js`.** Its walkthrough/review/swap paths already call
  `rankSlot` in-browser; this phase only adds a second *reader* of the same
  function. `candidatesFor` is not refactored, not shared, not moved.
- **No change to the ranking layers themselves** — `rankSlot`'s body,
  `rankByGap`, `dayCoverage`, `plan-preferences.json`, `nutrition-targets.json`
  and `ingredient-nutrient-tags.json` are all read-only this phase. D1 adds two
  names to an export list; it changes no behaviour.
- **No `generatePlan` in the Worker**, no `pickVariant`, no batch/leftover runs,
  no shelf-life. `/ranking` needs the `rankSlot` path only.
- **No caching, no rate limiting, no pagination.** `n` caps at 10; the library
  is tens of meals.
- No new dependency, no build step, no bundler config (CLAUDE.md,
  `wrangler.toml` stays as-is).

### Invariants this phase must not break

- **`rankSlot` is the one ranking implementation** (`ARCHITECTURE.md:377-379`).
  The Worker is a fourth *caller*, never a copy. If the Worker ends up with an
  `if (chip.keywords…)` in it, D1 has been implemented wrong.
- **Cost, pantry, chips and busy days never re-score nutrition** (CLAUDE.md).
  The Worker changes nothing here — it passes no `budget`, and chips/busy stay
  the reorder layers `rankSlot` already applies.
- **Nutrition targets and nutrient tags are data, not inline constants**
  (CLAUDE.md). The Worker imports the JSON files; it must not embed a nutrient
  list, a target number or a chip id. `TRACKED_NUTRIENTS` stays in
  `nutrition.js`.
- **The Worker writes nothing.** `/ranking` is GET-only: no `env.MP_KV.put`, no
  mutation of the read values, no `PUT`/`DELETE`/`POST` acceptance (405).
- **`MP.PlanPrefs` remains the client's only reader/writer of `mp_planPrefs`.**
  The Worker reads the `planPrefs` **KV** value, which is a different thing;
  it does not and cannot touch browser storage.
- **No `innerHTML` concern here** — the Worker returns JSON, never HTML, and
  `json()` serialises. Meal names go out as JSON string values.
- **The existing `window.MP` global must keep working in the browser.** The
  shim changes *how* the global object is reached, never that `MP.Nutrition` /
  `MP.Generator` exist on `window` for the plain `<script>` includes (no ES
  modules in the app — CLAUDE.md).
- **KV is eventually consistent.** `/ranking` reads whatever mirror exists; it
  never waits for, re-reads, or repairs a stale value.

## §1 `nutrition.js` + `generator.js` — the `window` → `root` shim

Mechanical, identical in both files, copying `exclusions.js:1-4,72-74`. No
behaviour change in the browser: `globalThis === window` there.

### 1.1 Shape

```js
// nutrition.js — replaces line 3 and line 5
(function (root) {
  "use strict";
  const MP = (root.MP = root.MP || {});
  // …unchanged body…
  MP.Nutrition = { load, tagsForMeal, dayCoverage, weekCoverage, rankByGap, TRACKED_NUTRIENTS };
})(typeof globalThis !== "undefined" ? globalThis : this);
```

`generator.js` takes the same treatment (its line 5 `window.MP = …`, line 7
IIFE open, line 267 close). Because `MP` becomes a `const` alias for the shared
object, every existing `MP.Nutrition.*` / `MP.ShelfLife.*` / `MP.isBatch` /
`MP.effectiveMeal` / `MP.ShoppingList.*` reference inside both files keeps
resolving at **call** time, exactly as it does today via the global.

Checklist while editing (verify, don't assume):

- Every `window.` reference in the two files is gone afterwards — there were
  exactly one each (`nutrition.js:3`, `generator.js:5`).
- The file order in `index.html` / `plan.html` / `test.html` is unchanged;
  `nutrition.js` still defines `MP.Nutrition` before `generator.js` runs (it
  only *uses* it at call time anyway).
- `load()` stays exactly as it is — it is browser-only by design, and the
  Worker simply never calls it (§3.2).

### 1.2 `generator.js` exports (line 266) — D1

```js
MP.Generator = { generatePlan, rankSlot, weekendRuns, weekdayOf, isoToday, pickVariant, chipHits, activeChips };
```

Two names added, **no function bodies touched**. Both are now public contracts:

```js
/** True if `meal` satisfies ANY of the chip's keywords/tags/prepEffort criteria. */
chipHits(meal, chip, tags)      // -> boolean
/** Ids in prefs.chips that exist in prefs.vocab.chips, split by kind. Unknown ids dropped. */
activeChips(prefs)              // -> { prefer: Chip[], avoid: Chip[] }
```

## §2 `worker/worker.js` — imports

Beside the existing three (4-6):

```js
import "../nutrition.js";
import "../generator.js";
import TAGS from "../ingredient-nutrient-tags.json";
import TARGETS from "../nutrition-targets.json";
import PLAN_VOCAB from "../plan-preferences.json";
```

and beside line 8:

```js
const Nutrition = globalThis.MP.Nutrition;
const Generator = globalThis.MP.Generator;
```

`TAGS` / `TARGETS` are the same objects `load()` would have produced
(`nutrition.js:18-22` parses the files wholesale), and `PLAN_VOCAB` is the same
object `plan.js` passes as `prefs.vocab` (`plan.js:870`).

## §3 `worker/worker.js` — the `/ranking` branch

### 3.1 `fetch` handler (189-238)

One branch beside `/discover`'s (198-201), **before** the `KEYS` lookup:

```js
if (url.pathname === "/ranking") {
  if (request.method !== "GET") return json(405, "method not allowed");
  return ranking(url.searchParams, env);
}
```

Auth (194) and `OPTIONS` (190) already ran. `KEYS` / `VALIDATE` / the PUT block
are **not** touched — `/ranking` has no KV key, so it must never reach them.

### 3.2 `ranking(params, env)` — new function

Placed near `discover` (34-62), the other computed route.

```js
/** Read-only ranking for one slot. Advisory only: the plan mirror is stale by
 *  construction and the cost/pantry layers don't exist server-side. */
async function ranking(params, env)   // -> Response
```

**Step 1 — validate (400s).** All three params, in this order:

| Check | Reason string |
|-------|---------------|
| `day` parses as an integer and `1 <= day <= 14` | `"day must be 1-14"` |
| `slot` absent → `"dinner"`; else must be in `SLOT_TYPES` (line 16) | `"slot must be breakfast, lunch, dinner or snack"` |
| `n` absent → `3`; else an integer `1 <= n <= 10` | `"n must be 1-10"` |

`"5.5"`, `"abc"`, `""` and `"0"` all fail `day`. Use `Number.isInteger(Number(v))`
style parsing, not `parseInt` (`parseInt("5abc")` is `5`).

**Step 2 — load state (409).**

```js
const [libraryRaw, planRaw, prefsRaw] = await Promise.all([
  env.MP_KV.get("library"), env.MP_KV.get("plan"), env.MP_KV.get("planPrefs"),
]);
```

`JSON.parse` each in a `try`/`catch`. If `library` is missing/`"null"`/not a
non-empty array, **or** `plan` is missing/`"null"`/has no `days` array →
`json(409, "library and plan must be synced first")`. `planPrefs` missing is
**not** a 409 — it degrades to `{ busyDays: [], chips: [] }`, matching the
client's "losing it degrades to today's behaviour" rule (CLAUDE.md).

**Step 3 — build the `rankSlot` call** (mirroring `plan.js:266-275`):

```js
const dayObj   = plan.days[day - 1] || { slots: {} };
const slotVal  = dayObj.slots[slot] || null;              // { mealId, variantId? } | null
const byId     = Object.fromEntries(library.map((m) => [m.id, m]));
const others   = SLOT_TYPES.filter((s) => s !== slot)
                   .map((s) => dayObj.slots[s] && byId[dayObj.slots[s].mealId])
                   .filter(Boolean);
const prefs    = { vocab: PLAN_VOCAB, busyDays: planPrefs.busyDays || [], chips: planPrefs.chips || [] };
const pool     = library.filter((m) => (m.mealTypes || []).includes(slot));
const ranked   = Generator.rankSlot(pool, day, others, { tags: TAGS, targets: TARGETS, prefs });
```

Note `pool` does **not** drop the current meal (see "Calls made without a
gate"), no `prefer`, no `budget`, no `lastUsedDay`, no `excludeIds`.

`others` uses the raw `byId` meal, not `MP.effectiveMeal` — variant resolution
lives in `data.js`, which the Worker deliberately doesn't import. A variant
swaps ingredients, so this is one more reason the answer is `approximate`.

**Step 4 — annotate the top `n`.**

```js
const gap     = Nutrition.dayCoverage(others, TAGS, TARGETS);
const shortOn = [...gap.missing, ...gap.partial];
const { prefer, avoid } = Generator.activeChips(prefs);     // D1
const chips   = prefer.concat(avoid);
```

Per candidate, in `ranked.slice(0, n)` order:

```js
{ mealId: m.id,
  name: m.name,
  rank: i + 1,                                                  // 1-based, ranked order
  covers: Nutrition.tagsForMeal(m, TAGS).filter((t) => shortOn.includes(t)),
  prepEffort: m.prepEffort || "quick",                          // same default as effortOf
  chipHits: chips.filter((c) => Generator.chipHits(m, c, TAGS)).map((c) => c.id) }
```

`chipHits` lists **both** prefer- and avoid-chips the meal matches — a
candidate ranked *down* because it hit an avoid chip is exactly the thing
"why was X picked" needs to be able to say. The chip's `kind` is in
`plan-preferences.json`, which Hermes can read.

**Step 5 — respond.** `json(200, { … })`, shape exactly as pinned in
`ARCHITECTURE.md:351-357`:

```json
{ "day": 5, "slot": "dinner", "shortOn": ["fibre", "vitD"],
  "current": { "mealId": "chorizo-pasta", "variantId": null },
  "candidates": [ { "mealId": "…", "name": "…", "rank": 1,
                    "covers": ["fibre"], "prepEffort": "quick",
                    "chipHits": ["comfort"] } ],
  "busyDay": true, "approximate": true }
```

- `current`: `slotVal ? { mealId: slotVal.mealId, variantId: slotVal.variantId ?? null } : null`.
  `variantId` is **always present**, `null` when the base recipe is scheduled
  (the stored object omits it — `generator.js:180-182`).
- `busyDay`: `(planPrefs.busyDays || []).includes(day)`.
- `approximate`: the literal `true`. Never computed, never omitted.

## §4 `sw.js`

Bump `CACHE` (line 4) one step from its **current** value (read it; it was
`"meal-planner-v18"` at spec time). No shell-array change — `worker/worker.js`
isn't in the PWA shell, and `nutrition.js` / `generator.js` are already listed.

## §5 Docs

- **`docs/roadmap.md`** Phase 26 (116-140): record D1 (`chipHits` /
  `activeChips` exported from `MP.Generator`; the Worker owns no chip logic),
  that the bundling question resolved to "the existing `exclusions.js` import
  pattern, no build-step change", and that `covers` needed no new export
  (`tagsForMeal`). Mark shipped when built.
- **`docs/ARCHITECTURE.md`**: the `GET /ranking` section (343-373) is already
  accurate against the shape above — **leave the JSON block and the bullets
  alone**. Add only: the two new `MP.Generator` exports (`chipHits`,
  `activeChips`) named in the 360-363 bullet, and one clause that `nutrition.js`
  / `generator.js` now use the `exclusions.js` `root` shim so the Worker can
  import them. Also note the Worker mirrors `candidatesFor`'s arguments but
  keeps the current meal in the pool.
- **`CLAUDE.md`**: one line under the architecture invariants — the
  `window` → `root` shim now covers `nutrition.js` and `generator.js` as well
  as `exclusions.js`, because `worker/worker.js` imports them; **don't
  reintroduce a bare `window.` reference in those three files.** Optionally a
  half-line that `rankSlot` has a fourth caller (the Worker) and still must not
  be copied.
- **`SPEC.md`**: **no change** — confirmed. `/ranking` adds no page, no
  user-facing behaviour, and no planning rule; it is a read-only view of rules
  `SPEC.md` already documents.

## Edge cases

| Case | Required behaviour |
|------|--------------------|
| `?day=0`, `?day=15`, `?day=5.5`, `?day=abc`, `day` absent | **400** `"day must be 1-14"`. `day` has no default. |
| `?slot` absent | Defaults to `"dinner"`, 200. |
| `?slot=brunch` | **400** `"slot must be breakfast, lunch, dinner or snack"`. |
| `?n` absent / `?n=0` / `?n=11` / `?n=abc` | Absent → `3`. The other three → **400** `"n must be 1-10"`. |
| `n` larger than the pool | Returns however many exist; `candidates` may be shorter than `n`. Not an error. |
| `library` KV unwritten (`"null"`) or `[]` | **409** `"library and plan must be synced first"`. |
| `plan` KV unwritten, or present with no `days` | **409**, same body. |
| `library`/`plan` KV holds unparseable JSON | **409**, same body — a corrupt mirror is "not synced", not a 500. |
| `planPrefs` missing / `"null"` / junk | **200**. `busyDays: []`, `chips: []` → `busyDay: false`, every `chipHits` empty. Degrades to today's behaviour, never 409. |
| `planPrefs.chips` contains an id absent from `plan-preferences.json` | Dropped by `activeChips` (`generator.js:70-77`), as in the app. Never an error (Phase 22/25 invariant). |
| The day's slot is empty (`{ mealId: null }` or absent) | `current: null`; ranking still computes and returns candidates. |
| The day's `mealId` isn't in `library` (mirrors out of step) | `current` still reports the stored id verbatim; it just won't appear in `candidates`, and it contributes nothing to `others`. No crash, no 409. |
| No meal in `library` has the requested `mealTypes` | `pool` empty → `rankSlot` returns `[]` → `candidates: []`, `shortOn` still computed, 200. |
| Scheduled meal has a `variantId` | Reported in `current`; the *ranking* ignores variants (no `MP.effectiveMeal` server-side) — covered by `approximate: true`. |
| `POST` / `PUT` / `DELETE /ranking` | **405** `"method not allowed"`. There is no write path, this phase or ever. |
| `OPTIONS /ranking` | **204** + CORS, via the existing handler line 190 — no new code. |
| Missing / wrong `X-Auth-Token` | **401**, via line 194, before any KV read. |
| `/rankings`, `/ranking/5` | **404** — `KEYS` lookup miss, unchanged behaviour. |
| Two candidates tie on every layer | `rankSlot`'s reorders are stable, so the original library order breaks the tie deterministically. Same answer on repeat calls. |
| A meal matches both a prefer- and an avoid-chip | `rankSlot` puts it in `prefer` (its `if/else if` checks prefer first, `generator.js:103-105`); `chipHits` lists **both** ids. Deliberate — the annotation is richer than the bucket. |
| Browser regression check | `index.html` / `plan.html` / `test.html` still work after the shim: `MP.Nutrition` and `MP.Generator` are on `window`, load order unchanged, every existing test group passes. |

## §6 Tests — `test.html` group 43

Logic-only, no DOM, no network, following group 42's structure. The Worker
itself has no harness, so the tests cover the two newly-public functions and
the annotation maths the Worker will do with them:

- `MP.Generator.chipHits` is **exported and is a function** (D1), and
  `MP.Generator.activeChips` likewise — the regression guard against a future
  edit un-exporting them.
- `chipHits(meal, chip, tags)`: keyword hit on the meal name; keyword hit on an
  ingredient key; tag hit (an ingredient tagged `"high"` for the chip's
  nutrient); `prepEffort` hit; a meal matching none → `false`; a chip with no
  criteria at all → `false`; a meal with no `ingredients` → no throw.
- `activeChips(prefs)`: splits by `kind`; drops ids absent from `vocab.chips`;
  `prefs` `{}` / `null` / missing `vocab` → `{ prefer: [], avoid: [] }`.
- The `covers` derivation: `tagsForMeal(meal, tags).filter(t => shortOn.includes(t))`
  returns only nutrients in both lists, and `[]` when the meal covers nothing
  short. (Pure composition of two existing exports — one assert, no helper.)
- The shim didn't break anything: `typeof MP.Nutrition.dayCoverage === "function"`
  and every pre-existing group still passes (groups 1-42 are the real
  regression test for §1).
- `rankSlot` itself is **not** re-tested — group 22's coverage stands, and this
  phase changes none of its logic.

## §7 Manual pass

1. `node --input-type=module -e 'import("./generator.js")'`-style smoke: in a
   scratch harness, import `nutrition.js` + `generator.js` under Node (no
   `window`), assert `globalThis.MP.Generator.rankSlot` and
   `globalThis.MP.Nutrition.dayCoverage` exist. This is the shim's real check.
2. Same harness: call `rankSlot` with the seed library, `TAGS`, `TARGETS` and a
   `prefs` with one prefer chip + one busy day; assert it returns an ordered
   array and that `activeChips`/`chipHits` annotate it without throwing.
3. `curl -H "X-Auth-Token: $T" "$URL/ranking?day=5"` → **200**, `slot:"dinner"`,
   3 candidates, `approximate: true`.
4. `?day=5&slot=lunch&n=10` → 200, up to 10 lunch meals, `rank` 1..n ascending.
5. Each bad param → **400** with its reason: `day=0`, `day=15`, `day=abc`,
   `day` omitted, `slot=brunch`, `n=0`, `n=11`.
6. Wipe (or point at an empty) `library` → **409**; same for `plan`. Restore →
   200 again.
7. Delete `planPrefs` → still **200**, `busyDay: false`, all `chipHits` empty.
8. `PUT /planPrefs` with `busyDays:[5]` and a chip id → re-run step 3:
   `busyDay: true` and at least one candidate carries that `chipHits` id, with
   the prefer-chip matches at the top of `candidates`.
9. `PUT /ranking` → **405**. `OPTIONS /ranking` → **204** + CORS. No
   `X-Auth-Token` → **401**. `GET /rankings` → **404**.
10. Confirm the answer matches the app: open `plan.html`, open the swap picker
    for the same day/slot, and check the Worker's `candidates` order equals the
    deck's order once the current meal is removed from it.
11. `GET /plan`, `/library`, `/planPrefs`, `/placements`, `/discover` all still
    behave exactly as before — `/ranking` shares the handler with them.
12. Browser regression: `test.html` all green (groups 1-43); `index.html` and
    `plan.html` generate, swap and save a plan with no console error after the
    shim.
13. Offline (PWA) after one load: both pages load from the bumped cache; the
    app never calls `/ranking`, so nothing new to fail there.
