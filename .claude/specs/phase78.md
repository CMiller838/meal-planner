# Phase 78: Pantry audit route [M]
Plain: the assistant can ask "which fridge items should I check this week?" and "what looks wrong in the pantry?", and your answers (still there / snooze that) are remembered so it stops nagging.

Requires: Phase 34 (`useBy`, `storage`, `ShelfLife.storageFor`) built, Phase 48 (activity log, `logWrite`, undo) built. Nothing unbuilt. Assistant side: `notion_assistant` Phase 43a.

## Decisions

- **User-chosen (gate): a side store, not a field on the pantry item.** New KV key `pantryAudit` = `{ updatedAt, confirmed: { "<normalizeKey(name)>": "YYYY-MM-DD" }, snoozes: { "<findingId>": "YYYY-MM-DD until" } }`. The pantry item shape (`CLAUDE.md`: qty, `useBy`, `storage`) is untouched; this phase never writes `pantry`. Reason it exists at all: pantry items carry no last-touched date and the activity log only sees assistant/Hermes writes (capped 200), so "when was this last checked?" has no other source.
- **Roadmap said read-only; the answers need one write route** (`POST /pantry/audit`), because confirmations and snoozes must land somewhere. It writes only `pantryAudit`, never `pantry` ("never a delete on its own" holds: removing an item is still the existing `PUT /pantry`).
- **New paths, no clash**: `worker/worker.js` dispatches on exact `url.pathname`; `/pantry/audit` and `/pantry/sanity` are not routes today (`/pantry` is a `KEYS` entry, exact match only). Not added to `KEYS` (no generic PUT for this key).
- **Location** = `ShelfLife.storageFor(item, SHELF_DATA).storage` (entered wins, else category default). Items it returns `null` for are never guessed into a location; `/pantry/audit` reports their count as `unsorted` so the assistant can ask the user where they live.
- **`GET /pantry/audit?location=fridge|freezer|cupboard&limit=1-20&today=`** (limit default 8, 400 on bad values): items in that location, `out:true` skipped, items confirmed within the last 14 days skipped; ordered never-confirmed first (pantry order), then oldest confirmation first. Returns `{ location, today, items: [{ name, qty, useBy, lastConfirmed|null }], remaining, unsorted }` (`remaining` = eligible items beyond the batch).
- **`GET /pantry/sanity?today=`** findings, each `{ id, class, name, detail }`, id = `${class}:${normalizeKey(name)}`:
  - `negative-qty`: structured qty `value < 0`.
  - `implausible-qty`: structured `value` over a ceiling per unit family (mass/volume 20000 g/ml, count 200). Free-text qty is never judged.
  - `stale`: `confirmed` date older than 60 days. An item never confirmed is not stale (it shows in `/pantry/audit` batches instead; there is no baseline date to measure from, and a fresh pantry must not light up).
  - `no-use-by`: `out` not true, no `useBy`, and `storageFor` says fridge.
  - `duplicate`: two or more distinct pantry names with the same `ShoppingList.normalizeKey` (e.g. carrot / carrots).
  - Thresholds are named constants at the top of the new code block, commented, not inline literals.
- **Snooze**: a finding whose id has `snoozes[id] >= today` is withheld from `/pantry/sanity`. Snoozing a `stale` finding is independent of confirming the item (confirming clears staleness by itself).
- **`POST /pantry/audit { confirmed?: [name], snooze?: [{ id, days }] }`** (`?today=` for tests): `confirmed` names must each match a current pantry item by `normalizeKey`, else 400 naming the unknown ones, nothing written; each sets `confirmed[key] = today`. `days` an integer 0-90 (0 clears the snooze); `id` must be a non-empty string. Body must carry at least one of the two (400 otherwise). Returns the stored value.
- **Logged and undoable via Phase 48**: `ITEMS.pantryAudit = [null]` (whole value is one item, like `today`/`planFlag`); `logWrite` with `who` = actor. The route is assistant-only in practice, but the app token may call it (not logged without an actor header, same as other keys).
- **Assistant access**: add `GET /pantry/audit`, `GET /pantry/sanity`, `POST /pantry/audit` to `ASSISTANT_ALLOWED`. Nothing wider.

## Files touched

- `worker/worker.js`: `pantryAudit(params, env)`, `pantrySanity(params, env)`, `postPantryAudit(request, env, who)`, route branches next to `/expiring` (~l.1477), `ITEMS` (~l.1157), `ROUTES` (read list ~l.1181 plus one `row("POST","/pantry/audit","write",{ log: "logged" })`), `ASSISTANT_ALLOWED` (~l.46). Defining files already imported by the Worker with the `window` -> `root` shim, so no new import and no shim change: `shelf-life.js` (`storageFor`, `isIsoDate`), `shopping-list.js` (`normalizeKey`, `parseQty`). Check `restore()`/`diffItems` (~l.1230) handle a `[null]` key not in `KEYS` for undo; extend minimally if not.
- `worker/routes.json`: regenerate with `node tools/routes_build.mjs` (`worker_test.mjs` fails on a stale one).
- `tools/worker_test.mjs`: new cases. `docs/roadmap.md`: mark done with what was verified. `docs/HERMES.md` and `CLAUDE.md`: grep `/expiring` and add the routes only where read routes are enumerated; add one `CLAUDE.md` invariant line: `pantryAudit` (Phase 78) is advisory state, never written to the pantry, written only by `POST /pantry/audit`.
- No app/UI file, no `sw.js` bump (no cached site file changes), no `pantry` shape change, no new dependency, no `generator.js` diff.

## Signatures

```
GET  /pantry/audit?location=&limit=&today= -> 200 { location, today, items: [{ name, qty, useBy, lastConfirmed }], remaining, unsorted }
GET  /pantry/sanity?today=                 -> 200 { today, findings: [{ id, class, name, detail }] }
POST /pantry/audit {confirmed?, snooze?}   -> 200 { updatedAt, confirmed, snoozes }
worker.js: pantryAudit(params, env), pantrySanity(params, env), postPantryAudit(request, env, who)
KV pantryAudit: { updatedAt, confirmed: {key: iso}, snoozes: {id: iso} }
```

## Edge cases

- Empty/missing pantry or missing `pantryAudit`: `200` with empty `items` / `findings`, never an error; malformed KV reads as empty (same `read` helper pattern as `expiring`).
- `location` absent or not one of the three: 400. `today` not ISO: 400.
- Item name casing/plural differences resolve through `normalizeKey` for confirm and for the duplicate check.
- Unparseable or unit-mismatched `qty` string: not a sanity finding (never judge free text).
- Item removed from the pantry later: its `confirmed` entry is ignored on read (no cleanup write).
- Stale undo: the Phase 48 refusal applies unchanged.

## Verification

- `node tools/worker_test.mjs` with fixture pantry + `pantryAudit`: (1) one fixture pantry fires each class: `negative-qty` (qty value -1), `implausible-qty` (50000 g), `stale` (confirmed 90 days before `today`), `no-use-by` (fridge item, no `useBy`), `duplicate` (carrot + carrots); (2) a never-confirmed item is NOT `stale`; (3) snoozing `no-use-by:<key>` for 7 days withholds it, `today` + 8 shows it again, `days: 0` clears; (4) `/pantry/audit?location=fridge`: never-confirmed first, an item confirmed 3 days ago and an `out` item absent, `unsorted` counts a null-location item, `limit` caps and `remaining` is right; (5) `POST` confirm with an unknown name: 400 and nothing stored; (6) `POST /activity/undo` of a confirm restores the prior `pantryAudit`; (7) the pantry KV value is byte-identical before and after every call; (8) 400 on `location=garage`, `limit=0`, `days=91`, empty body; (9) assistant token 200 on all three, no token 401.
- `node tools/routes_build.mjs` then `python3 check.py` (stale `routes.json` fails `worker_test`; `data_check` worker imports).
- `python3 tools/spec_lint.py phase78`
- No real credential needed (test fakes only).

## Tasks

Logic (TDD):
- [ ] `pantrySanity()` finding classes + named thresholds + snooze filter, tests first
- [ ] `pantryAudit()` batch selection and ordering, tests first
- [ ] `postPantryAudit()`: validation, store write, `logWrite`, `ITEMS.pantryAudit = [null]`, undo works
- [ ] Route branches, `ROUTES` rows, `ASSISTANT_ALLOWED`, `node tools/routes_build.mjs`
- [ ] `worker_test.mjs` cases above (incl. pantry byte-identical)
- [ ] `CLAUDE.md` invariant line, HERMES.md route list if enumerated; mark Phase 78 done in `docs/roadmap.md`
- [ ] Live: with the assistant, run a fridge audit against the deployed Worker, confirm two items and snooze one finding, confirm `GET /pantry/sanity` withholds it
