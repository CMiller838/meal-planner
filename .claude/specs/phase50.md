# Phase 50: Draft meals and recipe import [L]
Plain: the assistant can turn a description, recipe link or cookbook photo into a draft meal you review, fix and accept into your library.

Requires Phase 48 (spec written, not built: `/overnight` builds 48 first). Fallback if Phase 48's `logWrite`/`ITEMS`
are missing when this is built: skip the logging hook and say so in the commit. Assistant side (does the parsing:
description, link, screenshot, photo): `notion_assistant` Phase 45 "Draft meals" (was 71/72). It is not needed to build
or test this phase.

## Decisions

- **User-chosen: inferred tags are display-only.** A draft's `tags` (assistant-inferred low/med/high) are shown on the
  draft card labelled "inferred" and dropped on accept. Meal nutrition stays tags-file-only (`ingredient-nutrient-tags.json`
  is still the single source). An ingredient whose key is not in that file shows **"not tracked yet"** on the meal detail
  sheet, for every meal (TheMealDB imports included), so a gap is never mistaken for zero. Measured levels for new
  ingredients come from CoFID in Phase 57, not here.
- **Own call: drafts live in their own KV key `drafts`, never in the library.** The generator, `rankByGap`, `buildLists`
  and the Worker's `/ranking`, `/shopping`, `/plan/draft` read only the library, so "a draft never appears in a plan" holds
  by construction, with no filter to forget.
- **Own call: ingredient matching happens in the Worker on POST**, so the assistant learns at once what didn't match. It
  reuses `snapKey(slugify(name), keys)` from `data.js`. `app.js`'s `knownKeys()` moves into `data.js` as
  `MP.knownKeys(tags, packItems)` (tag keys + `pack-sizes.json` `items` keys, `_`-prefixed dropped), and both sides call it.
- **Own call: hard exclusions run on POST.** `MP.Exclusions.check(draftToMeal(draft, {}))` failing → 422 with the
  reasons (no mushrooms, no standalone egg meals, no veg in toasties). They run again on accept through the existing
  `saveForm` path.
- **Own call: the Worker never writes the library for a draft.** Accept is app-side: `MP.upsertMeal(meal)` → the normal
  `syncLibrary` push → `DELETE /drafts/:id`. The accepted meal carries `fromDraft: <draftId>`. On render, the app hides
  any draft whose id is a library meal's `fromDraft` and retries its DELETE (offline-safe, idempotent).
- **Own call: unknown ingredients are never silently created.** Each draft ingredient with `key: null` shows a row with
  a `<select>`: the known keys (labelized) plus "Add as new ingredient" (key = `MP.slugify(name)`). Accept stays disabled
  until every such row has a choice.
- **Own call: three actions per draft.** Accept (as resolved) · Edit (opens the existing `openForm` prefilled from
  `draftToMeal`; Save accepts) · Reject (DELETE only, nothing else touched).
- **Own call:** at most 20 pending drafts (409 when full). Images are never stored. `cost` (£, from the assistant) and
  `unreadable` (what couldn't be read or was assumed) are shown on the card and dropped on accept.
- **Own call: assistant reach** is `POST /drafts`, `GET /drafts`, `DELETE /drafts/:id` (the assistant may withdraw its own
  draft to offer "another"). There is no `PUT /drafts` for anyone: the only writes are the POST and the DELETE. All three
  writes are logged through Phase 48 (`ITEMS.drafts = ["drafts", (d) => d.id]`), so an assistant POST or DELETE can be
  undone.
- `source` stays a plain string on library meals (nothing in code reads it). An accepted draft's meal gets
  `source: "description"|"link"|"screenshot"|"photo"` and an optional `sourceRef` (URL or "book, page").

## Files touched

- `worker/worker.js`: `draftError(body)`, `postDraft(request, env)`, `deleteDraft(env, id)`; routes `POST /drafts`,
  `GET /drafts`, `DELETE /drafts/:id`; `ASSISTANT_ALLOWED` adds all three (the DELETE matched by prefix like
  `METHOD_PATH`); CORS gains `DELETE`; Phase 48 `ITEMS.drafts`.
- `data.js`: `knownKeys`, `matchDraftIngredients`, `draftToMeal` on `MP` (pure, no top-level `window`, per the shim rule).
- `app.js`: `knownKeys()` calls `MP.knownKeys`; the drafts section render with mapping rows and Accept/Edit/Reject;
  `openForm` accepts a draft-derived meal and, on save, deletes the draft; a "not tracked yet" marker in the detail sheet's
  ingredient list.
- `index.html`: `<section id="drafts" class="section hidden">` above the library section.
- `hermes-sync.js`: `fetchDrafts()` (mirrors to `mp_drafts`, never throws, `{drafts:[]}` when sync is off),
  `deleteDraft(id)` (404 = already gone = success).
- `style.css` (only if no existing class fits), `sw.js` (bump `CACHE`).
- `tools/worker_test.mjs`, `test.html`.
- `docs/ARCHITECTURE.md`: KV row `drafts`, endpoint rows. `CLAUDE.md`: a one-line invariant ("Drafts (Phase 50) live
  in KV `drafts`, never the library; only an app accept moves one in").

## Signatures / schemas

```
KV drafts = { updatedAt: ISO, drafts: Draft[] }            // newest first, length <= 20; absent = { drafts: [] }

Draft = {
  id: "draft-<8 hex>",  createdAt: ISO,                    // Worker-assigned
  name: string 1-80,  description?: string <= 300,
  mealTypes?: ("breakfast"|"lunch"|"dinner"|"snack")[],  servings?: int 1-12,  prepEffort?: "quick"|"batch",
  ingredients: [{ name: string 1-60, qty?: string <= 40, key: string|null }]   // 1-40; key Worker-set, null = unmatched
  method?: [{ text, minutes? }]                            // same rules as methodError()
  tags?: { [nutrient in TRACKED_NUTRIENTS]: "low"|"med"|"high" }   // inferred, display only
  source: "description"|"link"|"screenshot"|"photo",  sourceRef?: string <= 300,
  unreadable?: string[] (<= 20, each <= 200),  cost?: number >= 0
}

POST /drafts   body = Draft minus id, createdAt, ingredients[].key; any other key -> 400
  201 { id, unmatched: string[] }  | 400 { error } | 409 "too many drafts" | 422 { error, reasons: string[] }
GET /drafts    200 { updatedAt, drafts }  (null KV -> { drafts: [] })
DELETE /drafts/:id   204 | 404 "unknown draft"

MP.knownKeys(tags, packItems) -> string[]
MP.matchDraftIngredients(ingredients, keys) -> same array shape, each with key = snapKey hit or null
MP.draftToMeal(draft, resolutions /* { [ingredientName]: key } */) -> library meal:
  { id: "user-<slug>-<base36 now>", name, description, instructions: "", mealTypes (default ["dinner"]),
    servings (default 1), prepEffort (default "quick"), image: null, source, sourceRef?, fromDraft: draft.id,
    ingredients: [{ key: ing.key || resolutions[ing.name] || slugify(ing.name), qty, label: ing.name }],
    method + methodStatus "accepted" only when steps exist }      // never tags, cost, unreadable
```

## Edge cases

- A name close to an existing meal → the existing `findSimilarName` warning in Edit; Accept shows it as a toast note.
- A draft edited into an excluded meal → the existing `saveForm` error; the draft stays.
- A DELETE of an id already gone → 404 in the Worker; the app treats it as success.
- Sync off → the drafts section stays hidden (drafts only come from the assistant through the Worker).
- A legacy bare-array library is unaffected (drafts never touch the library key).
- A POST with an ingredient that matches only fuzzily (substring `snapKey`) → still matched; the card shows
  "name → Key label" whenever the labelized key differs from the name, so a wrong snap is visible and re-mappable in Edit.

## Verification

- `node tools/worker_test.mjs`: valid POST → 201 with `unmatched`; bad shape / unknown key → 400; mushroom draft → 422;
  21st draft → 409; assistant token can POST, GET and DELETE `/drafts` but `PUT /drafts` → 404/405; an assistant POST
  writes a Phase 48 activity entry and undoing it removes the draft. No real credential needed (test tokens only).
- `python3 check.py` (test.html asserts): `matchDraftIngredients` hit, plural and miss; `draftToMeal` drops
  tags/cost/unreadable and applies resolutions; **`generatePlan` over the library with a drafts store present never
  schedules a draft id**; after accept (`upsertMeal(draftToMeal(...))`) the meal is in the library and can be scheduled;
  reject removes that draft only and leaves the library byte-identical.
- UI (`python3 check.py ui` plus a driven run via `tools/browser-check`, fresh profile, sync pointed at a stubbed fetch):
  a draft card with inferred tags, unreadable notes and an unmatched ingredient; Accept is disabled until it's mapped;
  Accept, Edit→Save and Reject each work; "not tracked yet" shows on a meal with an untagged ingredient. PC and 390 px,
  dark and light.

## Tasks

### Logic (TDD)
- [x] `worker_test.mjs` asserts for POST/GET/DELETE /drafts, then `draftError`, `postDraft`, `deleteDraft`, routes,
      allowlist, CORS, `ITEMS.drafts`
- [x] test.html asserts, then `MP.knownKeys`, `MP.matchDraftIngredients`, `MP.draftToMeal` in data.js; `app.js` uses
      `MP.knownKeys`
- [x] generator never-sees-drafts assert; accept/reject library asserts
- [x] `hermes-sync.js` `fetchDrafts`, `deleteDraft`

### UI (ui-build skill)
- [x] `#drafts` section: card per draft (name, source, inferred tags, cost, unreadable, ingredient rows with mapping
      select), Accept/Edit/Reject, hidden when empty or sync off; hide + retry delete for already-accepted drafts
- [x] `openForm` draft mode: prefilled, Save accepts and deletes the draft
- [x] "not tracked yet" marker on untagged ingredients in the detail sheet
- [x] `sw.js` CACHE bump; ARCHITECTURE.md rows; CLAUDE.md invariant line
