# Hermes contract

Hermes is a hosted agent (hermes-agent.nousresearch.com) that lives outside
this repo. This is the contract it builds against — a reference, not a
tutorial. The Worker URL and the `X-Auth-Token` value live in Hermes's own
credential store and must never be committed here.

Every request carries `X-Auth-Token: <token>`. KV is eventually consistent
(~60s) — Hermes must not read back a write to confirm it landed.

| Capability | HTTP call | Notes |
|---|---|---|
| Discover a meal | `GET /discover?q=<user's words>` | Returns meals already shaped for `mp_library` — append one to `meals` and `PUT /library` with no field translation. Read `substituted` aloud when non-empty (e.g. "swapped mushrooms for courgette"). `rejected` names anything skipped and why. |
| Answer nutrition/recipe Q&A | `GET /library` + the public `ingredient-nutrient-tags.json` / `nutrition-targets.json` | Approximate-coverage framing only ("this looks light on protein"), never precise calorie math. |
| Edit ingredients in a meal | `GET /library` → modify → `PUT /library` | Always send the full `meals` array back, and set `updatedAt` to now. A `400` means the edit was malformed — re-read and retry with a corrected body, never resend the same one. |
| "Generate a new plan" | `PUT /planFlag {"requestedAt": "<now ISO>", "ackedAt": null}` | The app shows a banner and generates on tap. Hermes replies "ready in the app" — it never renders a plan as chat text. |
| Track what food is on hand | `GET /pantry` / `PUT /pantry` | Same relay pattern as `/library`. Body: `{ updatedAt, items: [{ name, qty? }] }`. `items` must be an array, each item needs a non-empty `name`, no duplicate names (case-insensitive). Always fetch-then-write the full array back. |
| Add to / clear the "ran out of / want to buy" list | `GET /adhoc` / `PUT /adhoc` | Same shape and rules as `/pantry`. Use this for "add X to my shopping list" — never write that request to `/pantry`. The **planned** two-week shopping list is not on the bridge at all (it's derived from the local plan), so Hermes cannot be asked to edit it. |
| See what's already on the 2-week plan | `GET /plan` | Read-only, `mealId`+`eatenAt` per filled slot only (no names or recipes — join against `/library`). **Stale by construction**: it's a best-effort mirror the app pushes on save, not read-after-write. Use it to inform a placement, never to guarantee one will be accepted — the app re-checks every placement locally. |
| Place a meal into a specific plan slot | `PUT /placements` | See below — a request queue, not a direct write. |
| Read what a person actually likes | `GET /prefs` | Read-only counters (`liked`/`dismissed`/`eaten` per meal). Use for softer framing ("you've liked a few chicken dishes lately"), not as a hard filter. |
| Answer "have I had enough variety lately?" over time | `GET /eaten-log` | Read-only history of what was actually eaten, unlike `/prefs`' counters or `/plan`'s current-fortnight snapshot. See below — tags are frozen at eat time. |

## `GET /discover`

- `q` present → `search.php?s=<q>` on TheMealDB; `q` blank/absent → one
  random meal via `random.php`.
- `200` body: `{ query, meals: [...], rejected: [...] }`, both arrays capped
  at 8. Each meal already passes the app's dietary exclusions (no mushroom,
  no standalone egg, no veg-in-toastie) — a mushroom recipe is either
  substituted (courgette) or dropped into `rejected`, never returned as-is.
- `502` on any TheMealDB failure (never a partial list, never a 500).

## `PUT /library`

Shape-validated only: `meals` must be an array, each meal needs a non-empty
`id`/`name` and an `ingredients` array, no duplicate ids. `meals: []` is
legal. No dietary rules are enforced on the way in — those apply only at
`/discover`, since a rule tweak here would risk locking the user out of
saving their own existing library.

A meal may optionally carry `variants: [{ id, name, ingredients, instructions?,
servings?, prepEffort? }]` — a linked variation of the same recipe (a
different sauce or side), not a separate meal. `id` is unique only within
that meal's own `variants` array; the meal's own top-level fields are the
default variant. If present, `variants` must be an array of objects each with
a non-empty `id`/`name` and an `ingredients` array, no duplicate variant ids
within the meal — same all-or-nothing rejection as the rest of this endpoint.
A family of variants is still one `meal.id`, so it counts as one meal
everywhere else (Discover dedupe, the variety guard).

## `GET /pantry` / `PUT /pantry`

Generic two-key relay, same as `/library`. Body shape: `{ updatedAt, items:
[{ name, qty? }] }`. `items` must be an array; each item needs a non-empty
`name` string; no duplicate names (case-insensitive, trimmed). `qty` is a
free-text string (e.g. `"2"`, `"half a bag"`) and unvalidated. `items: []`
is legal (empty pantry). Hermes should fetch-then-write — never PUT from
stale/cached data, since this clobbers the whole array.

## `GET /adhoc` / `PUT /adhoc`

Identical body shape and validation to `/pantry` — same relay, different KV
key. This is the "ran out of / want to buy this week" scratch list, separate
from the planned two-week shop that `buildLists` produces locally: the app's
eat flow drops shortfalls here, and a person can add to it by hand. Fetch-
then-write applies the same as `/pantry`. There is no bridge endpoint for
the planned list — it only exists as a local derivation of the current
2-week plan, so Hermes has no way to read or edit it.

## `GET /eaten-log` / `PUT /eaten-log`

Client-owned, write-only-from-the-app history mirror — same whole-array
replace pattern as `/pantry`, but the body is a **bare JSON array**, not an
`{updatedAt, ...}` object, because nothing acks or merges this key. Each
entry: `{ id, mealId, name, eatenAt, tags }`, where `id` is
`` `${mealId}:${eatenAt}` `` (dedup key), `eatenAt` is an ISO 8601 string
(not date-parsed by the Worker), and `tags` is an array of nutrient names
(may be `[]`). Capped at 200 entries, oldest dropped first. Unknown extra
keys on an entry are rejected, same as `/library`'s meal shape.

**Tags are frozen at eat time** — they're the nutrient names `tagsForMeal`
resolved against `ingredient-nutrient-tags.json` on the day the meal was
eaten. Re-tagging an ingredient later does not retroactively rewrite past
entries; don't assume an entry's `tags` reflect current tagging data.

The app never reads this key back — it's write-only from the app's side.
Hermes is the only reader, for questions about variety *over time* (as
opposed to `/plan`'s current-fortnight snapshot or `/prefs`' taste counters).

## `GET /plan`

Read-only mirror of the current 2-week plan, pushed by the app whenever it
saves (generate, swap, move, or eat). Body: `{ updatedAt, startDate, days:
[{ day, slots: { breakfast?/lunch?/dinner?/snack?: { mealId, eatenAt,
variantId? } } }] }` — empty slots are omitted, `variantId` is present only
when the slot has one (never `null`), and there is no name/description/
ingredient data in this key at all; join `mealId` (and `variantId`, if
present) against `/library` for that. This mirror
can lag the real plan by an arbitrary amount (it's a best-effort push, not
read-after-write) — use it only to *inform* a proposed placement, never to
decide one is safe. The app is the sole authority: every `PUT /placements`
entry is re-checked against the live local plan before it's applied.

## `PUT /placements`

A request queue, not a direct write — Hermes proposes, the app applies (or
rejects) on its own next load/resume. Body: `{ placements: [{ id, day
(1-14), slot ("breakfast"|"lunch"|"dinner"|"snack"), mealId, mealName,
variantId?, requestedAt }] }`. **Replace the whole array on every PUT** —
there is no append semantics server-side, and the app tracks its own ack
watermark by `requestedAt` so replays and reorders are harmless. A placement
is rejected, never silently dropped, when:

- the target slot already has `eatenAt` set — never overwrites eaten
  history, or
- `mealId` isn't in the person's local library.

`variantId` is optional; if given but not one of that meal's variant ids, the
placement still applies — just against the base recipe rather than bouncing
the whole placement.

Rejections surface in a dismissible banner in the app; there is no bridge
endpoint to read them back, so avoid re-proposing a placement Hermes has
reason to expect will bounce (e.g. a day it already saw as eaten via
`GET /plan`).

## `GET /prefs`

Read-only. Body: `{ updatedAt, prefs: { <mealId>: { name, liked, dismissed,
eaten, lastAt } } }` — three integer counters and a timestamp per meal, no
history log. There is no `PUT /prefs` for Hermes: counters are app-owned,
bumped only by the person's own like/save/dismiss/eat actions.
