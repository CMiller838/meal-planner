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
