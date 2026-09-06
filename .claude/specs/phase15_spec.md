# Phase 15 — Eaten log

**Goal:** When a meal is marked eaten (Phase 12's eat flow), append an entry —
meal name, date, nutrient tags — to a new `/eaten-log` Hermes-bridge endpoint, so
Hermes can answer questions about nutrient/vitamin/vegetable variety *over time*,
not just about what is in the current plan.

---

## Provenance of the decisions below

Two Decision Gates were raised at planning time. The answer recorded here
(**Gate 1 = A**, **Gate 2 = A**) was **relayed to the planner by the coordinating
agent as the user's answer** — it was not typed directly into this planner's
transcript. Both answers agree with the planner's own stated recommendation, so
the risk of misattribution is low, but the builder should treat D1/D2 as
"recommended and relayed" rather than "the user personally chose this". If either
surprises you, confirm before shipping — D3's entry schema is the part a future
Hermes phase will depend on.

The remaining decisions (D4-D9) were **not** gated; they are the planner's own
calls, stated in the same message as defaults the coordinator did not contest.

---

## Decisions taken

**D1 (Gate 1 = A). The client owns the log; the relay stays a dumb replace.**
`worker/worker.js` GET (lines 166-169) and PUT (lines 171-192) are whole-value
replace for all seven current keys, and `/eaten-log` does not change that. There
is **no server-side append**, no read-modify-write in the Worker, no new handler
branch. The client holds the full log in `localStorage` and PUTs the whole array.
This is exactly the `/pantry` mirror pattern the roadmap goal names.

**D2 (Gate 2 = A). Nutrient tags are denormalised into each entry at eat time.**
An entry stores the resolved nutrient names, not the ingredient keys. Hermes reads
one KV key and answers the question; it does not join against
`ingredient-nutrient-tags.json`. Consequence, accepted deliberately: an entry
freezes the tagging as it was on the day you ate the meal. Re-tagging an
ingredient later does **not** retroactively rewrite history. That is the intended
behaviour, not a bug to fix.

**D3. The entry shape is `{id, mealId, name, eatenAt, tags}`** and nothing else.
No ingredients, no quantities, no servings, no `variantId`, no scores. See §1.

**D4. The log is capped at 200 entries, oldest trimmed on write.** ~3 months at two
meals a day. The cap exists because D1 means the whole array is the PUT payload;
it is a payload bound, not a retention policy anyone asked for.

**D5. Both eat paths log.** `commitEat` (plan.js 477-502) already serves the
planned-slot path and the library "Eat this" path (`openEatSheet(meal, null, null)`,
plan.js:320) — the `day` check at line 490 is the only thing that differs between
them. The log write goes in the shared part of `commitEat`, *not* inside the
`if (day)` branch, so a library eat is logged too.

**D6. `id` is `` `${mealId}:${eatenAt}` `` and is the only dedup key.** Appending
an entry whose `id` already exists is a no-op. This makes a double-fire of
`commitEat` harmless without any other bookkeeping.

**D7. This phase adds no nutrition logic.** It adds one small *lookup* helper
(`tagsForMeal`, §3) because `nutrition.js` today only exposes `scoresForMeals`
(line 26), which accumulates weighted scores *across* a set of meals and cannot
report the tags of one meal. `tagsForMeal` does no scoring, no weighting, no
high/med/low arithmetic — it returns names. Do not extend it into coverage
computation; that is Phase 10's job and it stays there.

**D8. No new dependency, no new page, no new UI.** The eat sheet is unchanged. The
log is write-only from the app's point of view — nothing in the app reads it back
or renders it. Hermes is the only reader.

**D9. Failure to sync is silent and non-blocking.** Eating a meal must never fail
because the bridge is unreachable. The local array is the source of truth; the PUT
is best-effort, exactly like the existing mirrors.

---

## What this phase is made of

| Roadmap item | Spec section |
|---|---|
| Entry schema + the cap | 1 |
| `worker/worker.js` — route + validator | 2 |
| `nutrition.js` — `tagsForMeal` | 3 |
| `hermes-sync.js` — local log + push | 4 |
| `plan.js` — the write-on-eat call | 5 |
| Confirmed unchanged | 6 |
| Tests (group 34) | 7 |
| Docs | 8 |

---

## 1. The entry schema

```
EatenLogEntry {
  id:      string    // `${mealId}:${eatenAt}` — dedup key, D6
  mealId:  string
  name:    string    // meal name as eaten, denormalised (the library entry may
                     // later be renamed or deleted; the log must still read)
  eatenAt: string    // ISO 8601, from new Date().toISOString()
  tags:    string[]  // deduped nutrient names, sorted; may be empty
}
```

The stored KV value is a bare JSON array of these, newest last:

```
[ EatenLogEntry, ... ]     // length <= 200
```

A bare array (not `{updatedAt, entries}`) because, unlike `/pantry`, nothing
merges or acks this key — there is no consumer of an `updatedAt` field here. Do
not add a wrapper object "for symmetry".

`tags` may legitimately be `[]` — a meal whose ingredients are all untagged is a
real, loggable meal. An empty `tags` array is **not** an error and must not be
dropped or rejected.

**Cap:** on append, if length exceeds 200, drop from the front. `name` is
denormalised precisely so a trimmed-out or deleted meal never orphans an entry.

---

## 2. `worker/worker.js` — one map entry, one validator

**Route map (lines 11-14):** add `"/eaten-log": "eatenLog"`. Route uses a hyphen
to match the roadmap's wording; the KV key is camelCase to match its six
neighbours (`library`, `planFlag`, `pantry`, `adhoc`, `plan`, `placements`,
`prefs`). Both spellings are load-bearing — do not "tidy" one into the other.

**Validator**, alongside the existing five (`mealsError` 65, `itemsError` 93,
`planError` 107, `placementsError` 119, `prefsError` 132):

```
eatenLogError(parsed) -> string | null     // error message, or null if valid
```

Rules, matching the existing all-or-nothing contract (reject the whole PUT on any
bad entry):

- `parsed` must be an array. Not an object, not null.
- Length must be <= 200.
- Each entry must be an object with: non-empty string `id`, non-empty string
  `mealId`, non-empty string `name`, non-empty string `eatenAt`, and `tags` an
  array of strings.
- `tags` may be empty. Every element must be a string.
- `id` must be unique within the array.
- `eatenAt` is validated as a non-empty string only — **not** parsed or
  format-checked. The other validators don't parse dates either; matching them
  beats being clever.
- Unknown extra keys on an entry: reject, consistent with the strict shape checks
  the sibling validators apply.

**Register it in the `VALIDATE` map (lines 138-146)** as `eatenLog: eatenLogError`.
That map is the dispatch the PUT handler looks up at line 185 — an unregistered
key is the one way to ship this endpoint silently unvalidated.

Auth (line 154), CORS (lines 19-24), the GET handler and the PUT handler bodies
are **untouched**. No new branch in either handler (D1).

---

## 3. `nutrition.js` — one lookup helper

```
tagsForMeal(meal, tags) -> string[]
   // tags = the loaded ingredient-nutrient-tags.json map
   // for each meal.ingredients[].key, look up tags[key] -> {nutrient: level}
   // collect the nutrient NAMES (keys of that object), dedupe, sort
   // unknown ingredient key => contributes nothing, no throw
   // meal with no ingredients / meal null => []
```

Deliberately ignores the `"high" | "med" | "low"` level: this phase records *that*
a nutrient was present, not how much (D7, and the CLAUDE.md invariant against
turning the approximate tagging into fake-precise math).

`scoresForMeals` (line 26) is **unchanged** — it is not refactored to call
`tagsForMeal`, and `tagsForMeal` is not built on top of it. They answer different
questions and sharing a helper between them would only couple Phase 10's scoring
to this log's schema.

The tags map is already fetched and cached in `load()` (lines 15-22); the caller
awaits that existing loader rather than re-fetching the JSON.

---

## 4. `hermes-sync.js` — local array + best-effort push

Follows the mirror pattern at `mirrorKey` (109) / `itemsMirror` (113) /
`fetchItems` (123-139), but the log is **write-only from the app** — no
`fetchEatenLog`, no read-back, no merge with a remote value. Nothing in this
project reads the log; adding a fetch now is scaffolding for a consumer that
doesn't exist.

New localStorage key `LS_EATEN_LOG = "mp_eatenLog"`, declared beside the existing
key constants (lines 11-13).

```
localEatenLog()              -> EatenLogEntry[]   // [] on missing/corrupt JSON
logEaten(entry)             -> EatenLogEntry[]   // append + dedup by id (D6)
                                                 // + cap to 200 (D4) + persist
                                                 // + fire-and-forget PUT
pushEatenLog(entries)       -> Promise<void>     // PUT /eaten-log, swallows errors
```

`logEaten` persists locally **first**, then pushes. If the PUT fails the entry is
still in localStorage and will be included in the next successful push, since
every push sends the whole array (D1) — this is why the log needs no place in the
`mp_sync_ops` queue (`queueOp` 164, `applyOps` 170, `flushOps` 202). Do not add
one; the ops queue exists for incremental item mutations and the whole-array PUT
is already self-healing.

`pushEatenLog` reuses the existing config accessors for base URL and
`X-Auth-Token` (lines 40-49) and the same POST/PUT helper the other pushes use
(`pushPlan` 243, `pushPrefs` 255 are the shape to copy). No new transport, no new
headers, no retry loop.

No new event listener: the existing listeners (`"mp:library-saved"` 306,
`"mp:plan-saved"` 307) are untouched, and the log is triggered by a direct call
from `commitEat` (§5) rather than a fourth custom event.

**Edge cases:** corrupt JSON in `mp_eatenLog` yields `[]` rather than throwing — a
broken log must never break the eat flow (D9). A `QuotaExceededError` on write is
caught and ignored for the same reason; the cap makes it very unlikely.

---

## 5. `plan.js` — the call site

In `commitEat` (lines 477-502), **after** the pantry ops are applied and queued
(lines 483-488) and alongside the existing `MP.Prefs` eaten bump (line 495), i.e.
in the path both eat flows share — *not* inside the `if (day)` branch at line 490
(D5).

One call:

```
MP.HermesSync.logEaten({
  id:      `${meal.id}:${eatenAt}`,
  mealId:  meal.id,
  name:    meal.name,
  eatenAt,
  tags:    await MP.Nutrition.tagsForMeal(meal, <loaded tags map>),
})
```

`eatenAt` is the timestamp already computed at line 491 for the plan slot — hoist
that `new Date().toISOString()` above the `if (day)` so both the slot write and
the log entry use the *same* instant. Two separate `new Date()` calls would make
the log's `eatenAt` disagree with the slot's by milliseconds and break `id` as a
dedup key.

`meal` here is already the variant-resolved object (`MP.effectiveMeal(...)`,
plan.js:411) — so `name` and the tag lookup reflect the variant actually cooked,
which is correct and needs no extra work.

Tag resolution must not block the sheet closing: resolve tags and call `logEaten`
in the same async tail as the existing op flush (line 501). If the tags file
fails to load, log the entry with `tags: []` rather than skipping the entry — a
meal that was eaten is a fact worth recording even without its tags.

**Edge case:** a planned slot's Eat button is disabled once `eatenAt` is set
(`eatBtnHtml` 343-346), so the planned path is already idempotent. The library
path can be fired repeatedly and *should* log each time — two identical meals
eaten a minute apart are two real entries with two different `eatenAt` values,
hence two different `id`s. D6's dedup only suppresses an exact-instant repeat.

---

## 6. Confirmed unchanged

| Thing | Why it stays put |
|---|---|
| `worker.js` GET/PUT handler bodies, auth, CORS | Route map + validator only (D1) |
| The other six KV keys and their validators | Untouched |
| `mp_sync_ops` queue / `applyOps` / `flushOps` | Whole-array PUT is self-healing (§4) |
| Ack/watermark scheme (`LS_PLAN_ACKED`, `LS_PLACEMENTS_ACKED`) | Nothing acks the log |
| `scoresForMeals`, nutrition targets, coverage scoring | Not a scoring phase (D7) |
| `ingredient-nutrient-tags.json`, `nutrition-targets.json` | Read as-is, not edited |
| The eat sheet UI, `eatPlan`, pantry/adhoc ops | Phase 12 behaviour is unchanged (D8) |
| `MP.Prefs` eaten counter | Stays; it is a taste signal, not a history log |
| Shelf-life, generator, Discover, Browse | Not touched at all |
| `esc()` as the only route into HTML | Nothing new is rendered, so nothing new to escape |
| Zero dependencies, no build step | Nothing added |

`sw.js`: no new asset to precache — this phase adds no file. Confirm the existing
cache list still matches the file set and leave it alone otherwise.

---

## 7. `test.html` — group 34

Pure-function assertions in the existing `check(name, condition)` / `deepEqual`
style (lines 26-30). Group 33 is Phase 14; this is **group 34**.

- `tagsForMeal` — returns deduped, sorted nutrient names for a meal with two
  ingredients sharing a nutrient; `[]` for a meal whose ingredient keys are all
  unknown; `[]` for a meal with no `ingredients`; does not throw on a null meal;
  ignores the high/med/low level (a `"low"` tag still appears in the list).
- `logEaten` — appends to an empty log; a second entry with the *same* `id` is a
  no-op (length unchanged); a same-meal entry with a different `eatenAt` **is**
  appended; appending past 200 drops the oldest and keeps length at exactly 200,
  with the newest entry last.
- `localEatenLog` — returns `[]` for a missing key and `[]` for a corrupt
  (non-JSON) value rather than throwing.
- `eatenLogError` — accepts an empty array; accepts a valid array; accepts an
  entry with `tags: []`; rejects a non-array; rejects an array of 201; rejects an
  entry missing `mealId`, missing `name`, or missing `eatenAt`; rejects `tags`
  as a string instead of an array; rejects a non-string element inside `tags`;
  rejects duplicate `id`s; rejects an entry carrying an unknown extra key.

The `commitEat` integration (that eating writes exactly one entry with the slot's
own `eatenAt`) is a manual-pass item, not an assertion — it needs the DOM and the
eat sheet.

---

## 8. Docs

- `docs/HERMES.md` — new `GET/PUT /eaten-log` section following the existing
  per-endpoint format (the `/pantry` section at line 51 is the closest model).
  Document the entry schema, the 200 cap, that tags are **frozen at eat time**
  (D2 — Hermes must not assume they reflect current tagging), and that the app
  never reads this key back. Also update the capability table (lines 11-21) with
  the over-time variety question this unlocks.
- `docs/ARCHITECTURE.md` — KV key list 7 → 8; note the eaten log as a
  client-owned, capped, write-only mirror.
- `SPEC.md` — one line under the eat-flow section. Do not touch the nutrition
  target or shelf-life numbers.
- `docs/roadmap.md` — flip Phase 15 to **Status: Complete** in the *same commit*
  as the code.
- Deploy note: this changes `worker/worker.js`, so it needs a `wrangler deploy`
  before the endpoint exists in production. Until then the client-side log still
  works locally and the PUT simply fails silently (D9).

---

## Deliberately skipped

- **Server-side append** (Gate 1 Path B). Add when there is genuinely a second
  writing device — KV's eventual consistency makes read-modify-write racy anyway.
- **Reading the log back into the app** — no streak view, no history page, no
  "you've had no greens in 5 days" banner. Hermes is the reader. Add a UI when
  you actually want one, and it can read the local array with no new plumbing.
- **Storing ingredients per entry** (Gate 2 Path B). Add when a Hermes question
  needs ingredient-level history that the tag names can't answer.
- **Nutrient coverage scoring over the log window.** Explicitly out of scope —
  this phase records data, Phase 10 scores plans. Do not merge the two.
- **Purchase/expiry correlation with shelf-life.** No. CLAUDE.md's category-based
  shelf-life invariant stands.
- **Backfilling the log from existing `eatenAt` values in `mp_plan`.** The
  historical tags would be reconstructed from today's tag data, which contradicts
  D2's frozen-at-eat-time meaning. The log starts empty.
