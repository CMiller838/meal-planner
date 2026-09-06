# Phase 13 — Hermes plan placement & preference learning

**Goal:** Let Hermes place a specific meal into a specific plan slot, and let the
app and Hermes adapt suggestions from actual like/dismiss/eaten behaviour rather
than the static tags and exclusion rules alone.

---

## Provenance of the decisions below

Two Decision Gates were raised at planning time. The answers recorded here
(**Gate 1 = B**, **Gate 2 = B**) were **relayed to the planner by the
coordinating agent as the user's answers**; they were not typed directly into
this planner's own transcript, and both went *against* the planner's stated
recommendations (which were 1A / 2B). Builder: if anything in section
"Decisions taken" surprises you — particularly D1 and D2, which retire a
documented architecture invariant — confirm with the user before writing code.
Everything below is specced faithfully to 1B + 2B.

---

## Decisions taken

**D1 (Gate 1 = B). KV gains a read-only plan mirror as well as a placement
queue.** Two new KV keys: `plan` (written by the app, read by Hermes) and
`placements` (written by Hermes, drained by the app). The mirror exists so
Hermes can see what is already scheduled before proposing.

**D2. `docs/ARCHITECTURE.md:74` ("The plan itself is never stored in KV") is
retired and replaced,** not quietly contradicted. New wording must say: the plan
of record is `mp_plan` in localStorage; KV carries a *derived, best-effort
mirror* of it for Hermes to read, and the app never reads the mirror back. If
the mirror and `mp_plan` disagree, `mp_plan` wins, always. This one-way rule is
the whole reason the mirror is safe — do not add a mirror→app read path.

**D3. Placements are a request queue with a timestamp ack, exactly like
`planFlag`.** No new sync concept. `hermes-sync.js` already has
`needsPlan(flag, localAckedAt)` / `ackPlanFlag(requestedAt)`; placements copy
that shape with `mp_hermes_placements_acked`.

**D4. Placements auto-apply, with a banner and no undo.** Draining applies each
accepted placement straight into `mp_plan` and shows a dismissible banner on
plan.html listing what changed and what was rejected. No undo stack — the plan
is already freely swappable and regenerable, so undo is dead weight.

**D5. Two hard rejection rules, enforced in code.** A placement is rejected if
(a) the target slot has `eatenAt` set — never overwrite eaten history — or
(b) `mealId` is not in the local library. Rejections are reported in the banner,
never applied silently, and never crash the drain.

**D6 (Gate 2 = B). Preference signal is three integer counters per meal plus a
timestamp, in `mp_prefs`, mirrored to a `prefs` KV key.** `{liked, dismissed,
eaten, lastAt}`. No history log, no decay curve, no model.

**D7. Discover ranking uses a *tag-level* bias, not a per-meal one.** Discover
shows meals that are new to the user, so their per-meal counters are all zero and
a per-meal score would rank nothing. The counters are therefore aggregated over
the meals' *ingredient* tokens (the vocabulary already used by
`ingredient-nutrient-tags.json` / `rankByGap`), and a candidate scores by its own
ingredients. Per-meal counters are still used directly for one thing:
suppressing repeatedly-dismissed meals.

**D8. Taste ordering is a permutation, never a filter.** Matches the Phase 10
`rankByGap` and Phase 11 `orderPool` convention. Nothing disappears from the
Discover pool because of taste.

**D9. Pantry-first stays the strongest Discover signal.** Chain order in
`loadPool()` becomes `rankByGap` → `orderByTaste` → `orderPool`, so the
last-applied (pantry, Phase 11's decision) still dominates and taste breaks ties
beneath it.

**D10. Both new app→KV pushes are best-effort and failure-silent.** `plan` and
`prefs` are derived data; a failed push is a no-op, never a user-visible error,
never a retry queue. `mp_sync_ops` is for the pantry/adhoc lists only and is not
extended here.

**D11. No new dependency, no new file.** All work lands in existing files plus
one new `prefs.js`. (`prefs.js` is new because `data.js` is the library store and
counters are a distinct concern read by both `discover.js` and `plan.js`.)

---

## What this phase is made of

| Roadmap item | Spec section |
|---|---|
| KV surface for plan placement | 1, 2 |
| Hermes writes a placement, app applies it | 2, 3, 4 |
| Banner for applied/rejected placements | 4, 8 |
| Like/dismiss/eaten counters | 5, 6 |
| Counters feed Discover ranking | 6, 7 |
| Counters readable by Hermes | 1, 2 |
| Tests | 9 |
| Docs | 10 |

---

## 1. KV schema — three new keys

All three follow the existing `{updatedAt, <payload>}` convention and the
existing `X-Auth-Token` + `GET`/`PUT` access pattern. No key is ever deleted; a
missing key returns body `"null"` as today.

### `plan` — app-owned mirror, Hermes reads

```
{
  updatedAt:  string   // ISO 8601, stamped by the app at push time
  startDate:  string   // "YYYY-MM-DD", copied from mp_plan
  days: [
    {
      day:   number    // 1..14
      slots: {
        breakfast?: { mealId: string, eatenAt: string|null },
        lunch?:     { ... },
        dinner?:    { ... },
        snack?:     { ... }
      }
    }
  ]
}
```

`mealId` and `eatenAt` only — no names, no ingredients, no recipe data. Hermes
joins against the `library` key it already reads. Empty slots are omitted rather
than written as `null`. `startDate` is included because a bare `day: 1..14` is
meaningless to Hermes without it.

**This mirror is stale by construction.** It is written on a best-effort push
after the fact (D10), so it can lag `mp_plan` by an arbitrary amount. Hermes uses
it to *inform* a proposal, never to decide one is safe — the app re-checks every
placement against local `mp_plan` on drain (D5, §4), and that local check is the
only authority. Rejection reasons stay purely local-plan-driven; nothing in the
app ever reads the mirror back.

### `placements` — Hermes-owned queue, app drains

```
{
  updatedAt:  string
  placements: [
    {
      id:          string   // Hermes-generated, opaque to the app
      day:         number   // 1..14
      slot:        string   // "breakfast" | "lunch" | "dinner" | "snack"
      mealId:      string
      mealName:    string   // display only; mealId is authoritative
      requestedAt: string   // ISO 8601 — the ack watermark
    }
  ]
}
```

Hermes replaces the whole array on each `PUT` (no append semantics server-side).
The app's ack watermark makes replays harmless.

### `prefs` — app-owned counters, Hermes reads

```
{
  updatedAt: string
  prefs: {
    "<mealId>": {
      name:      string
      liked:     number   // >= 0
      dismissed: number
      eaten:     number
      lastAt:    string   // ISO 8601 of the most recent bump
    }
  }
}
```

---

## 2. `worker/worker.js` — three keys, one validator map

The `KEYS` allowlist (line 11) gains `plan`, `placements`, `prefs`. The existing
per-key `if`-chain for body validation (the `library` meals check at 61-73 and
`itemsError` at 77-88) is replaced by a lookup so adding a key is one line, not a
new branch:

```
const VALIDATE = {
  library:    mealsError,      // existing check, extracted as-is
  pantry:     itemsError,
  adhoc:      itemsError,
  planFlag:   null,            // no body validation today — unchanged
  plan:       planError,
  placements: placementsError,
  prefs:      prefsError
}
```

New validators, each returning `string|null` (an error message, or null when
valid) to match `itemsError`'s existing contract:

- `planError(body)` → rejects unless `body.days` is an array and every entry has
  a numeric `day` and an object `slots`.
- `placementsError(body)` → rejects unless `body.placements` is an array and
  every entry has a string `mealId`, a numeric `day` in 1..14, and a `slot` in
  the four known slot names. Reject the whole `PUT` on any bad entry — a
  partially-valid queue is worse than a rejected one.
- `prefsError(body)` → rejects unless `body.prefs` is a plain object (not an
  array, not null).

Everything else stays: auth check before dispatch, `PUT` stores the original
JSON text verbatim (line 135), CORS on every response including errors, 405 on
non-`GET`/`PUT`/`OPTIONS`, `env.MP_KV` binding.

**Edge case:** validators must not throw on a non-object body (`"null"`, a bare
number, a string). Guard with a typeof check first and return the error string.

---

## 3. `hermes-sync.js` — mirror pushes and the placement drain

Reuses `req(method, path, body)` (line 49) unchanged. New functions:

```
planMirror(plan)              -> { startDate, days }
   // pure: slims mp_plan to the §1 shape — mealId + eatenAt per filled slot,
   // empty slots omitted. No network. Split out so it is testable.

pushPlan()                    -> "off" | "ok" | "error"
   // PUTs { updatedAt, ...planMirror(mp_plan) }, ignores failures

pushPrefs()                   -> "off" | "ok" | "error"
   // PUTs { updatedAt, prefs } from mp_prefs

newPlacements(remote, ackedAt) -> placement[]
   // pure: filters remote.placements to requestedAt > ackedAt, sorted ascending
   // by requestedAt. Returns [] for a null/malformed remote.

syncPlacements()              -> "applied" | "noop" | "off" | "error"
   // GET /placements, newPlacements(), MP.Plan.applyPlacements(), ack, then
   // dispatch "mp:placements-applied" with { applied, rejected } in detail

ackPlacements(requestedAt)
   // writes mp_hermes_placements_acked, same shape as ackPlanFlag (line 101)
```

`newPlacements` is split out as a pure function purely so it is testable without
network — same reason `decide()` and `needsPlan()` are pure today.

`start()` (line 224) additions:
- call `syncPlacements()` in the one-shot load path and on `visibilitychange`,
  alongside the existing `syncLibrary()`;
- listen for a new `"mp:plan-saved"` event → `pushPlan()`;
- push prefs on the immediate load sync and on `visibilitychange`, **guarded by
  `MP.Prefs.isDirty()`** — one PUT per session rather than one per swipe.
  `pushPrefs()` calls `MP.Prefs.clearDirty()` only on a successful PUT, so a
  failed push retries at the next visibility change.

**Edge cases:** all three new calls are wrapped so a rejection resolves to
`"error"` and never escapes into the event handler (D10). If `config()` is unset,
they return `"off"` before touching the network. The ack is written **only after**
`applyPlacements` returns — a crash mid-apply must leave the queue re-drainable.

---

## 4. `plan.js` — applying placements, and the banner

```
applyPlacements(plan, placements, library)
  -> { plan, applied: [{day, slot, mealId, name}],
             rejected: [{day, slot, mealId, name, reason}] }
```

Pure, returns a new plan object rather than mutating (so the test harness can
assert on inputs). `reason` is one of `"eaten"`, `"unknown-meal"`,
`"bad-slot"`. Rules per D5: skip when the target slot has `eatenAt`; skip when
`mealId` is absent from `library`; skip when `day` is outside the plan's range or
`slot` is not one of the four. Otherwise set
`plan.days[day-1].slots[slotType] = { mealId }` — the same write shape
`openSwapPicker()`'s confirm path already produces (line ~150), so nothing
downstream needs to learn a new slot shape.

Wiring:
- `savePlan()` (line 36) dispatches `"mp:plan-saved"` after writing `mp_plan`,
  mirroring how `saveLibrary()` dispatches `"mp:library-saved"` (data.js 41-45).
  This is the only trigger for the mirror push — one dispatch point covers
  generate, swap, move and eat.
- A `"mp:placements-applied"` listener re-reads `mp_plan`, calls `renderPlan()`
  (line 103), and renders the banner from `event.detail`.
- `commitEat()` (line 408) additionally calls `MP.Prefs.bump(meal, "eaten")`
  **after** its existing pantry deduction succeeds, so a failed eat does not
  inflate counters.

Banner:

```
placementBannerHtml(applied, rejected) -> string   // escaped via esc()
renderPlacementBanner(detail)                       // into #hermes-banner
```

Text: "Hermes placed *N* meal(s)" listing `Day D <slot> — <name>`, plus a
"Couldn't place" list with a plain-English reason ("already eaten", "not in your
library"). Dismiss button clears the node. Nothing persists — the banner is
per-page-load only.

**Security:** `mealName` and every rejection reason come from KV (i.e.
ultimately from Hermes/TheMealDB), so every interpolation goes through `esc()`
per the repo invariant. Prefer the local library's `name` over the queue's
`mealName` when the meal is known.

---

## 5. `prefs.js` — new file, the counter store

```
MP.Prefs = {
  KEY: "mp_prefs",
  get()                    -> { [mealId]: {name, liked, dismissed, eaten, lastAt} }
  bump(meal, field)        -> void   // field: "liked"|"dismissed"|"eaten"
  isDirty()                -> boolean // unpushed changes since last clearDirty
  clearDirty()             -> void
  score(mealId)            -> number // liked*2 + eaten*3 - dismissed*3
  tasteScores(prefs, meals)-> { [ingredientToken]: number }
  orderByTaste(list, prefs, meals) -> array   // permutation of list
}
```

`bump` creates the record if absent (`{name, liked:0, dismissed:0, eaten:0}`),
increments one field, sets `lastAt` to `new Date().toISOString()`, writes
`mp_prefs`, and sets the dirty flag (persisted alongside the counters, so a tab
closed before its push still pushes on the next load). `meal` may be a full meal object
or `{id, name}` — it only ever needs those two fields.

**Edge cases:** a corrupt/absent `mp_prefs` parses to `{}`, never throws. Counters
are clamped at `>= 0`. Unknown `field` is a silent no-op rather than writing a
junk key.

---

## 6. Counter call sites in `data.js`

Three one-line additions, all guarded so `data.js` still works if `prefs.js`
hasn't loaded (`MP.Prefs && MP.Prefs.bump(...)`):

- `addToLibrary(meal)` (line ~59) → `bump(meal, "liked")` — adding to the library
  *is* the like gesture in this app.
- `saveForLater(meal)` (line ~202) → `bump(meal, "liked")` — a weaker like, but
  the same direction; not worth a fourth counter.
- `dismiss(mealId)` (line 190) → `bump({id: mealId, name}, "dismissed")`. Signature
  widens to `dismiss(mealId, name)` with `name` optional; every existing caller
  keeps working, and the name is only used for display in Hermes.

`upsertMeal` deliberately does **not** bump — it fires on edits and image
backfill, which are not preference signals.

---

## 7. `discover.js` — taste in the ranking chain

`tasteScores(prefs, meals)` walks the pref records, looks each `mealId` up in the
supplied meals (library + saved-later), and adds that record's `score()` to every
ingredient token the meal contains, normalised by token frequency so a token that
appears in everything (salt, oil, onion) cannot dominate. Tokens are lowercased
and trimmed — the same normalisation `rankByGap` already applies.

`orderByTaste(list, prefs, meals)` sums the taste score of each candidate's
ingredient tokens, subtracts a penalty for any candidate whose own record shows
`dismissed >= 2`, and returns the list sorted descending by that sum. Stable for
equal scores (preserve input order) so it composes predictably with the steps
either side of it.

In `loadPool()` (~lines 241-256) the chain becomes:

```
rankByGap(pool, gapNutrients, tagsData)
  -> orderByTaste(pool, prefs, meals)
  -> orderPool(pool, pantryIndex)
```

applied before the existing stale-response guard, which is untouched.

**Edge case:** empty `mp_prefs` (first run, and every run until the user has
liked or eaten something) must make `orderByTaste` an identity permutation —
Discover must behave exactly as it does today until real signal exists.

---

## 8. `plan.html` and `style.css`

- `plan.html`: one `<div id="hermes-banner"></div>` above the week blocks, and a
  `<script src="prefs.js"></script>` tag before `plan.js`.
- `discover.html` (and any other page loading `data.js`): same `prefs.js` script
  tag, before `data.js`'s consumers.
- `style.css`: `.hermes-banner` (accent border, dismissible row, dark-mode-safe
  colours from the existing custom properties), `.hermes-banner .rejected`
  (muted), `.hermes-banner button.dismiss`. No new colour literals — reuse the
  existing variables.

---

## 9. `test.html` — group 32

Pure-function assertions only, matching the existing harness style:

- `newPlacements` — filters by watermark, sorts ascending, returns `[]` for
  `null`/malformed remote, returns `[]` when everything is already acked.
- `applyPlacements` — applies a valid placement; rejects with `"eaten"` when the
  slot has `eatenAt`; rejects with `"unknown-meal"` for a mealId absent from the
  library; rejects with `"bad-slot"` for `day: 0`, `day: 15` and a bogus slot
  name; leaves the input plan object unmutated; a mixed queue yields both
  `applied` and `rejected` entries.
- `planMirror` — omits empty slots; carries `eatenAt` through; carries **no**
  `name`/ingredient/recipe fields (assert the slot object's keys are exactly
  `mealId` and `eatenAt`); handles a plan with no days and a slot with a missing
  `mealId` without throwing.
- `MP.Prefs.bump` — creates a record, increments, sets `lastAt`, no-ops on an
  unknown field, survives a corrupt `mp_prefs`.
- `orderByTaste` — output is a permutation of the input (same length, same
  members) for both a populated and an empty prefs store; identity ordering when
  prefs is empty; a meal sharing tokens with a well-liked meal outranks one that
  doesn't.
- Worker validators — `planError`/`placementsError`/`prefsError` reject a bare
  string, `null`, and an array-shaped `prefs`, and accept a minimal valid body.

---

## Confirmed unchanged

| Thing | Why it stays put |
|---|---|
| `mp_plan` as the plan of record | D2 — the mirror is one-way, derived |
| `mp_sync_ops` pending-op log | Pantry/adhoc only; new pushes are best-effort |
| `library` / `planFlag` / `pantry` / `adhoc` KV shapes | Untouched |
| `X-Auth-Token` scheme, CORS block, `env.MP_KV` | Untouched |
| Discover exclusions (mushrooms, egg meals, toastie veg) | Taste is a permutation, never a filter — exclusions still win |
| `rankByGap`, `orderPool` internals | Only the call order around them changes |
| `esc()` | Still the only route for external strings into HTML |
| Zero dependencies, no build step | Nothing added |

---

## 10. Docs

- `docs/ARCHITECTURE.md`: replace line 74 per D2; update the KV key list (4 → 7)
  and the endpoint list to include `GET`/`PUT` for `plan`, `placements`, `prefs`;
  add one line stating the mirror is never read back by the app.
- `docs/HERMES.md`: document the three new endpoints with their schemas, the ack
  semantics for `placements` (replace-the-array, app acks by `requestedAt`), and
  the two rejection rules so Hermes can avoid proposing placements that will
  bounce.
- `docs/roadmap.md`: flip Phase 13 to **Status: Complete** in the same commit as
  the code.
