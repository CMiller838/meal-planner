# Phase 5 Spec — Hermes conversational capabilities

Roadmap: `docs/roadmap.md` → Phase 5. Source of scope: `docs/OUTLINE.md` lines 26–39.
Builds directly on Phase 4 (`.claude/specs/phase4_spec.md`) — read its §0 traps before
touching `hermes-sync.js` or the Worker.

The repo is public. No library data, no Worker URL and no token may ever be committed.

## Decisions taken (user-confirmed)

| Gate | Decision |
|---|---|
| 1. Where discovery + exclusion logic runs | **Path B** — one new read-only Worker route `GET /discover`. The Worker fetches TheMealDB, maps to the app's meal shape, and applies `exclusions.js` deterministically. n8n makes one HTTP call and talks about what comes back; it is never told the rules in prose. |
| 2. Library write protection | **Path B** — shape-validate `PUT /library` in the Worker: `meals` must be an array, each meal needs a non-empty `id`/`name` and an `ingredients` array, no duplicate ids ⇒ else `400`. Guards the app's own pushes too. Not Path C (`PUT /meal` delta) — a server-side read-modify-write depends on read-after-write consistency, which `docs/ARCHITECTURE.md:24` says not to build on. |
| 3. Mushroom substitution | **Path A** — new `substitutions.json`; the Worker swaps the ingredient *before* the recipe reaches Hermes and returns `substituted: [{from, to}]`. A mushroom recipe can never reach the library. |
| KV surface | **Unchanged.** `KEYS` stays exactly two entries. `/discover` touches no storage and is deliberately not in `KEYS` — Phase 4's deferred note ("a third KV key is a deliberate Phase 5 decision") is answered: **no third KV key.** |
| Q&A endpoint | **None.** See §6. |
| Caching | `sw.js` `CACHE` → `"meal-planner-v5"`; `exclusions.js` + `substitutions.json` added to `SHELL`. |

---

## 0. What this phase is actually made of

Hermes is n8n (`docs/ARCHITECTURE.md:8`) — the chat layer lives outside this repo. Of the
four capabilities in the roadmap goal, only one needs real code here:

| Capability | Where it lands |
|---|---|
| "Generate a new plan" trigger phrase | **No repo code.** n8n `PUT /planFlag {requestedAt: now}`; `plan.js:245` already renders the banner and acks. Contract written up in §7. |
| Add/remove/change ingredients in a meal | **No new endpoint.** n8n `GET /library` → edit → `PUT /library`. The repo's job is stopping a bad LLM write (§4). |
| Recipe + nutrition Q&A over tag data | **No repo code.** §6. |
| TheMealDB discovery with exclusions + substitution | **The whole build.** §1–§3, §5. |

So the phase is: one shared rules module, one data file, ~75 lines of Worker, one
`mealdb.js` refactor that nets out as a deletion, and a written n8n contract.

**The rule that shapes everything:** a hard dietary exclusion enforced by prompt text is
not enforced. Every rule below is deterministic code, run once, in a module both runtimes
import — `docs/ARCHITECTURE.md:55-61` prescribes exactly this and Phase 5 is where it
finally exists. Today only mushrooms are code-enforced (`mealdb.js:19`); the standalone-egg
and veg-in-toastie rules hold purely because the seed data happens to comply.

**No new dependency.** Workers have native `fetch`; Wrangler/esbuild imports `.json`
natively. Nothing is installed, nothing is committed, `npx wrangler deploy` stays the
whole toolchain.

---

## 1. `exclusions.js` — the shared rules module (new, repo root)

The one file both runtimes import. Must load in a browser `<script>` **and** in a Worker
ESM bundle, so it takes the same self-contained IIFE shape as the other `MP.*` modules but
must **not** depend on `data.js` (the Worker never loads it) and must **not** touch
`window`, `document`, `localStorage` or `sessionStorage` anywhere — not even inside a
function body. It is pure: data in, verdict out.

```js
(function (root) {
  root.MP = root.MP || {};
  root.MP.Exclusions = { /* ... */ };
})(typeof globalThis !== "undefined" ? globalThis : this);
```

The Worker consumes it as a side-effect import, then reads the global:

```js
import "../exclusions.js";
const Exclusions = globalThis.MP.Exclusions;
```

Rule terms live as constants in this file, not in a JSON file. `CLAUDE.md`'s
"nutrition targets and nutrient tags are data, not inline constants" invariant is about
*tunable* numbers; these are rule definitions and there is exactly one place to read them.

```js
const MUSHROOM = ["mushroom"];                       // substring match
const EGG      = ["egg"];                            // substring match, key or label
const TOASTIE  = /toastie|toasted sandwich/i;        // tested against meal.id and meal.name
const TOASTIE_VEG = ["onion", "tomato", "pepper", "spinach", "rocket", "lettuce",
                     "courgette", "aubergine", "sweetcorn", "mushroom", "jalapeno"];
```

### Signatures

```js
/** @param {Array<{key:string, qty?:string, label?:string}>} ingredients
 *  @returns {boolean} true if any ingredient key or label contains "mushroom". */
MP.Exclusions.hasMushroom(ingredients)

/** Standalone egg: egg is present and there is at most ONE other ingredient.
 *  Egg *within* a dish is fine (SPEC.md:46-47) — french toast, egg fried rice.
 *  @param {object} meal  @returns {boolean} */
MP.Exclusions.isStandaloneEgg(meal)

/** Veg inside a toastie specifically (SPEC.md:48). Non-toasties always pass.
 *  @param {object} meal  @returns {boolean} */
MP.Exclusions.hasVegInToastie(meal)

/** Run all three. Reasons are short human strings Hermes can read aloud.
 *  @param {object} meal
 *  @returns {{ ok: boolean, reasons: string[] }}   e.g. reasons: ["contains mushroom"] */
MP.Exclusions.check(meal)

/** The Worker's single entry point: make a candidate compliant, or reject it.
 *  Never mutates `meal` — always returns a fresh object.
 *  @param {object} meal
 *  @param {object} subs  parsed substitutions.json
 *  @returns {{ meal: object, substituted: Array<{from:string,to:string}> } | null} */
MP.Exclusions.sanitize(meal, subs)
```

### `isStandaloneEgg` — the heuristic, and its ceiling

```
egg present AND (ingredients.length - eggIngredientCount) <= 1   ⇒ standalone
```

Checked against the seed: a plain boiled egg (0 others) ⇒ rejected; egg on toast
(1 other, bread) ⇒ rejected; `french-toast` (bread, milk, cinnamon…) ⇒ passes;
`egg-pb-toast-snack` (egg + peanut butter + bread = 2 others) ⇒ **passes**.

`ponytail:` comment required, naming the ceiling: *counting ingredients, not
understanding dishes — a two-ingredient dish that happens to be egg-based slips through,
and a genuinely bare egg dish listing salt and pepper as ingredients does too. Upgrade
path is an explicit allow/deny list of meal ids, not a cleverer count.*

### `sanitize` — order is load-bearing

1. `isStandaloneEgg(meal)` or `hasVegInToastie(meal)` ⇒ **return `null`**. No swap exists
   for either; these stay blanket rejects. Only mushrooms get the second chance.
2. Copy the meal (`{...meal, ingredients: meal.ingredients.map(...)}`). Replace every
   mushroom ingredient with `subs.mushroom`, keeping the original `qty` verbatim, and push
   `{from: originalLabelOrKey, to: subs.mushroom.label}` onto `substituted`.
3. If a mushroom ingredient remains because `subs` has no entry for it ⇒ **return `null`**.
   A missing substitution degrades to the old blanket reject, never to a pass.
4. Return `{ meal: copy, substituted }`. A clean meal returns `substituted: []`.

Step 3 is the safety property: *`sanitize` can only ever return a meal that would pass
`check()`.* State that as a comment; it is what makes the endpoint trustworthy.

---

## 2. `substitutions.json` (new, repo root)

Same hand-maintained-data pattern as `shelf-life.json` / `pack-sizes.json`.

```json
{
  "note": "Swap-ins for hard-excluded ingredients. Keyed by the excluded substring; the value is a normal ingredient entry. A term with no entry here degrades to a blanket reject, never to a pass.",
  "mushroom": { "key": "courgette", "label": "Courgette" }
}
```

One entry. Not an array of options — the roadmap says "offering **a** mushroom-substituted
version", singular; a chooser is only worth building if Hermes ever needs to present
alternatives, and that goes in `docs/FUTURE.md`, not here.

---

## 3. `worker/worker.js` — `GET /discover`

Grows from 54 to roughly 130 lines. Two imports at the top:

```js
import "../exclusions.js";
import "../mealdb.js";
import SUBS from "../substitutions.json";
```

Route order in `fetch()`, inserted **after** the existing OPTIONS + auth checks and
**before** the `KEYS` lookup:

```js
if (url.pathname === "/discover") {
  if (request.method !== "GET") return json(405, "method not allowed");
  return discover(url.searchParams.get("q"));
}
```

`KEYS` is untouched. `/discover` is not a KV key and must not be added to it.

### `discover(q)`

- `q` non-empty ⇒ `https://www.themealdb.com/api/json/v1/1/search.php?s=<encodeURIComponent(q)>`
- `q` absent/blank ⇒ `https://www.themealdb.com/api/json/v1/1/random.php`

Both endpoints return **full meal detail**, so there is no `lookup.php` N+1 round trip.
`filter.php?i=` is deliberately **not** supported — it returns stubs needing one lookup per
result, and ingredient-led browsing is already the app's Discover deck (`mealdb.js`).

Pipeline: `data.meals ?? []` → `MP.MealDB.toMeal(detail)` (§5 — the *same* mapping the app
uses, not a reimplementation) → `MP.Exclusions.sanitize(meal, SUBS)` → keep the first **8**
non-null results.

### Response — `200`

```json
{
  "query": "chicken",
  "meals": [
    {
      "id": "api-52940", "name": "…", "source": "themealdb",
      "mealTypes": ["dinner"], "batchCook": false, "servings": 1,
      "description": "…", "instructions": "…",
      "ingredients": [{ "key": "chicken_breast", "qty": "500g", "label": "Chicken Breast" }],
      "image": "https://…",
      "substituted": [{ "from": "Mushrooms", "to": "Courgette" }]
    }
  ],
  "rejected": [{ "name": "…", "reasons": ["standalone egg"] }]
}
```

- Meal objects are **already in the app's library shape** — Hermes can drop one straight
  into the `meals` array of a `PUT /library` with no field translation. That is the point.
- `substituted` is always present (`[]` when nothing changed) so the chat layer has one
  code path.
- `rejected` carries name + reasons only, so Hermes can say *"I skipped Mushroom Soup —
  it contains mushroom and there's no good swap"* instead of silently returning less. Cap
  it at 8 as well.

### Failure modes

| Case | Response |
|---|---|
| TheMealDB non-2xx, network error, or unparseable body | `502 "discovery upstream failed"` — never a 500 stack, never a partial list |
| TheMealDB returns `{"meals": null}` (no match) | `200` with `meals: []`, `rejected: []` |
| Every candidate rejected | `200` with `meals: []` and a populated `rejected` |
| `PUT`/`DELETE` on `/discover` | `405` |
| No `X-Auth-Token` | `401` — unchanged, auth runs before routing |

CORS headers ride on all of these via the existing shared helper. `Access-Control-Allow-Methods`
stays `GET, PUT, OPTIONS` — no new method is introduced.

---

## 4. `worker/worker.js` — `PUT /library` shape validation

Trust boundary: an LLM doing read-modify-write on the whole library blob is one bad turn
away from silently dropping meals, and last-write-wins means the app pulls the damage
without noticing. This is the one place in the phase where lazy is the wrong answer.

Applies to `/library` only. `/planFlag` keeps Phase 4's generic plain-object check.

```js
/** @param {any} parsed  the already-JSON.parsed PUT body
 *  @returns {string|null}  an error reason, or null if the body is acceptable */
function libraryError(parsed)
```

Rejects (`400` with the reason in the body) when:

- `parsed.meals` is not an array (`Array.isArray`)
- any element is not a plain object
- any element's `id` or `name` is not a non-empty string
- any element's `ingredients` is not an array
- two elements share an `id`

Accepts everything else, including `meals: []` — Phase 4 established an empty remote
library as legitimate, and the app's `hermes-sync.js` guard already distinguishes it from
a malformed blob. Do not regress that.

**Shape only. No exclusion checks here.** `sanitize()` runs on the way *in* from
TheMealDB; running `check()` on `PUT` would let a rule tweak lock the user out of saving
their own existing library. Note this in a comment so it doesn't look like an oversight.

`ponytail:` comment: *field presence, not deep validation — a meal with a garbage
`mealTypes` still saves. The generator already tolerates that; tighten only if a real
malformed write gets through.*

---

## 5. `mealdb.js` — refactor, net deletion

Two changes, both making the file smaller:

1. **Split pure from browser.** `extractIngredients(detail)` and `toMeal(detail)` become
   the module's exported surface: `MP.MealDB.toMeal(detail)`. Every `sessionStorage` /
   `window` reference must live **inside** `getDiscoverPool`'s body, never at module
   scope — the Worker imports this file and never calls that function. Precedent:
   `hermes-sync.js` loads with zero effect when unconfigured. The file must also attach to
   `globalThis.MP` self-containedly, like `exclusions.js` (§1).
2. **Delete `hasMushroom` (lines 16–22).** `getDiscoverPool`'s
   `.filter(d => !hasMushroom(d))` becomes, after mapping to meal shape:

   ```js
   .map(MP.MealDB.toMeal)
   .map(m => MP.Exclusions.sanitize(m, subs))
   .filter(Boolean)
   ```

   Root-cause fix, not a symptom patch: the app's Discover deck now enforces **all three**
   rules and offers the same substituted version Hermes does, instead of only filtering
   mushrooms. One rule module, every caller.

`index.html` loads `substitutions.json` the same way `shelf-life.js` loads its data —
a cached `load()`. Put it on the existing `MP.MealDB` module rather than inventing a new
loader, and hand the parsed object into `sanitize`.

`index.html` gets `<script src="exclusions.js">` **before** `mealdb.js`. `plan.html` and
`shopping.html` do not need it — neither touches TheMealDB.

---

## 6. Nutrition + recipe Q&A — no code, and why

The repo is public and served from GitHub Pages, so n8n fetches
`ingredient-nutrient-tags.json` (33 entries) and `nutrition-targets.json` (17 entries)
directly and answers from them, alongside the meal's own `ingredients`/`instructions`
already present in `GET /library`.

No `/nutrition` endpoint. `MP.Nutrition.dayCoverage()` exists to *rank and score plan
days* — chat Q&A is qualitative ("is this high in protein?", "what's this day missing?"),
and the tag file answers that directly. An endpoint would exist only to compute a score
nobody asks for in a sentence.

`docs/FUTURE.md` entry, with a revisit trigger: *if Hermes' answers about coverage ever
disagree with the plan page's banner, expose `dayCoverage` as `GET /coverage` rather than
teaching n8n the scoring rules.*

`docs/ARCHITECTURE.md:95` still stands — Hermes must never be given a way to alter
`nutrition-targets.json` values at runtime. Read-only, fetched from a static file.

---

## 7. `docs/HERMES.md` (new) — the n8n-side contract

The chat layer is built in n8n, not here, so this is the phase's deliverable for the three
no-code capabilities. Keep it a contract, not a tutorial.

| Capability | HTTP call | Notes |
|---|---|---|
| Discover a meal | `GET /discover?q=<user's words>` | Returns library-shaped meals; add one by appending it to `meals` and `PUT /library`. Read `substituted` aloud when non-empty. |
| Answer Q&A | `GET /library` + the two public tag JSON files | Approximate-coverage framing, never precise calorie math (`SPEC.md:97-111`). |
| Edit ingredients | `GET /library` → modify → `PUT /library` | **Always send the full array back**, preserving `updatedAt` semantics: set `updatedAt` to now. A `400` means the edit was malformed — re-read and retry, never retry the same body. |
| "Generate a new plan" | `PUT /planFlag {"requestedAt": "<now ISO>", "ackedAt": null}` | The app shows a banner and generates on tap. Hermes replies "ready in the app" — **it never renders a plan as chat text** (`docs/OUTLINE.md:36-38`). |

Also record: every request carries `X-Auth-Token`; the URL and token live in n8n
credentials and **never** in this repo; KV is eventually consistent (~60s) so n8n must not
read back a write to confirm it.

---

## 8. `test.html` additions

Add `<script src="exclusions.js">` to the includes. Literal fixtures, plus the real
`meals.json` already fetched at the top of the file. The Worker is ESM and is not loaded
here — §4's validation is verified by curl (§9) instead, same split Phase 4 used.

- `hasMushroom` — `[{key:"mushrooms"}]` ⇒ true; `[{key:"beef", label:"Mushroom Soup Mix"}]`
  ⇒ true (label is checked too); `[{key:"chicken_breast"}]` ⇒ false
- `isStandaloneEgg` — `{ingredients:[{key:"eggs"}]}` ⇒ true; egg + bread ⇒ true;
  seed `french-toast` ⇒ false
- **Check: seed `egg-pb-toast-snack` ⇒ false.** *The loud one — it fails the moment the
  egg rule is written broadly enough to delete a meal the user actually eats.*
- `hasVegInToastie` — toastie + `onions` ⇒ true; seed `toastie-ham-cheese` ⇒ false;
  a non-toastie containing `onions` ⇒ false
- **Check: every meal in `meals.json` passes `check().ok`.** *The best single check in this
  phase — any rule written too broadly fails here immediately.*
- `sanitize` — a mushroom meal returns a meal with no mushroom, `substituted.length === 1`,
  and **the input object is unmutated** (assert the original still contains mushroom)
- `sanitize` — a standalone-egg meal ⇒ `null`; a clean meal ⇒ same ingredients,
  `substituted: []`
- `sanitize` with `subs = {}` ⇒ mushroom meal returns `null`, not a pass-through

---

## 9. Worker smoke tests (curl, against the deployed URL)

Run after `npx wrangler deploy`, same as Phase 4's §7b table.

| Request | Expected |
|---|---|
| `GET /discover?q=chicken` no token | `401` |
| `OPTIONS /discover` no token | `204` + all four CORS headers |
| `PUT /discover` with token | `405` |
| `GET /discover?q=chicken` | `200`, `meals[]` non-empty, every meal has `id`/`name`/`ingredients`/`substituted` |
| `GET /discover?q=mushroom` | `200`; **no `"mushroom"` anywhere in the `meals` array** (substituted or rejected) |
| `GET /discover` (no `q`) | `200`, one random meal |
| `GET /discover?q=zzzznotathing` | `200`, `meals: []` |
| `PUT /library` `{"meals":"nope"}` | `400` |
| `PUT /library` two meals sharing an `id` | `400` |
| `PUT /library` `{"updatedAt":"…","meals":[]}` | `204` — still legal |
| `PUT /library` a real library | `204`, `GET` round-trips byte-identically |
| `GET /planFlag`, `PUT /planFlag` | unchanged from Phase 4 |

---

## 10. Edge cases

| Case | Behaviour |
|---|---|
| `sanitize` given a meal with no `ingredients` array | Treat as `[]`, don't throw; passes `check()` |
| TheMealDB ingredient names with punctuation | `extractIngredients` already lowercases and `_`-joins; substitution matches on substring, so "Chestnut Mushrooms" is caught |
| A meal whose *name* says mushroom but ingredients don't | Passes. Rules read ingredients, not prose — do not add a name scan |
| `substitutions.json` fails to load in the browser | `getDiscoverPool` falls back to `{}` ⇒ mushroom meals are rejected outright. Degrades to Phase 1 behaviour, never to a pass |
| Two mushroom ingredients in one recipe | Both swapped; `substituted` has two entries; deduping is not worth code |
| Hermes `PUT`s a library containing a mushroom meal | **Accepted** (§4 is shape-only). The exclusion is enforced at discovery, which is the only place meals enter |

---

## 11. Deliberately not built

Retry/backoff, a `/coverage` endpoint, `filter.php?i=` support on `/discover`, multiple
substitution options per ingredient, substitutions for anything but mushroom, a `PUT /meal`
delta endpoint, an ingredient-editing UI in the app, any third KV key, caching TheMealDB
responses in the Worker, and rate limiting. The n8n workflow itself lives outside this repo.
