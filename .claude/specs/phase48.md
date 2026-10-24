# Phase 48: Activity log and undo for every assistant write [L]
Plain: everything the assistant changes in your planner shows up in an Activity list, and you can undo any of it with one tap.

Requires Phase 32 (done). Assistant side (preview before confirm, calling undo): `notion_assistant` Phases 75 and 78, not
needed to build or test this phase. ADR: `docs/ARCHITECTURE.md` "v7 - activity log and undo".

## Decisions (all own calls, no gates: none was a real toss-up)

- **Logged in the Worker**, at the one chokepoint every assistant write passes through (ADR above).
- **Only `ASSISTANT_TOKEN` writes are logged** (plus every undo, from either token). Hermes/app writes are not: app sync
  churn would evict the useful entries. `who` is `"assistant"` (assistant token) or `"app"` (`AUTH_TOKEN`, used by both
  app and Hermes, so they are indistinguishable).
- **One write = one entry = one batch.** An entry holds every item that write changed; Undo undoes the whole batch. A PUT
  that changes nothing logs nothing.
- **Per-item diff**, not whole-key snapshots, so an unrelated app edit to another pantry item never blocks an undo.
- **Stale undo**: refused with 409 and the list of items changed since, unless `force: true` ("Undo anyway" in the app,
  the "asks" in the roadmap). An entry already undone is refused even with `force`.
- **Append-only**: entries are never edited. "Undone" is derived (a later entry has `undoes: <id>`). Undoing an undo entry
  is a redo, same mechanism, allowed.
- **Cap 200 entries, newest first**, oldest dropped. Export to the vault is Phase 52's job; until then dropped is gone.
- **Reason**: optional `X-Reason` request header, trimmed to 120 chars, stored as `why`. Header, not a body field, so no
  key's validator changes.
- **Preview**: `?dryRun=1` on any logged PUT returns the diff that would be logged and writes nothing. The assistant shows
  this before asking the user to confirm. Preview/confirm is enforced assistant-side; the Worker logs every assistant
  write whatever path it took (one-tap logs such as `PUT /today` are logged, need no preview).
- **UI**: a `<details id="activity">` "Assistant activity" section on `index.html` under "Hermes sync", hidden while sync
  is off, fetched each time it is opened. No new page, no nav change.

## Files touched

- `worker/worker.js`: `ITEMS` table, `diffItems`, `logWrite`, `undoActivity`; hook into the generic PUT and
  `putMealMethod`; routes `GET /activity`, `POST /activity/undo`; `ASSISTANT_ALLOWED` gains both; CORS gains `POST`,
  `X-Reason`.
- `tools/worker_test.mjs`: activity/undo asserts.
- `hermes-sync.js`: `fetchActivity()`, `undoActivity(id, force)`, `resyncKey(key)`.
- `app.js`, `index.html`, `style.css` (only if no existing class fits): the Activity section.
- `sw.js`: bump `CACHE`.
- `docs/ARCHITECTURE.md`: KV schema row for `activity`, endpoint rows for the two routes (ADR already added).

## Signatures / schemas

KV key `activity`: `{ entries: Entry[] }`, newest first, length <= 200.

```
Entry = { id: string,            // crypto.randomUUID()
          at: ISO string, who: "assistant" | "app",
          key: string,           // KV key: "pantry", "library", ...
          why: string,           // "" when no X-Reason
          summary: string,       // e.g. "pantry: changed rice, added milk" (built by the Worker)
          changes: [{ id: string, before: any | null, after: any | null }],  // null = item absent
          undoes?: string }      // set on undo entries
```

Item identity per logged key (only keys the assistant can PUT; `null` field = whole value is one item, id = key name):

```
const ITEMS = {
  pantry: ["items", (i) => ShoppingList.normalizeKey(i.name)],
  adhoc: ["items", (i) => ShoppingList.normalizeKey(i.name)],
  library: ["meals", (m) => m.id],       // a legacy bare-array library is the array itself
  products: ["products", (p) => p.id],
  eatRequests: ["requests", (r) => r.id],
  placements: ["placements", (p) => `${p.day}:${p.slot}:${p.mealId}`],
  dayHints: ["days", null],              // object map: item id = date key
  today: [null], planFlag: [null],
};
function diffItems(key, beforeValue, afterValue) -> [{ id, before, after }]   // pure, deep-equal via JSON.stringify
async function logWrite(env, { who, key, why, changes, undoes }) -> Entry | null   // null when changes is empty
async function undoActivity(env, who, { id, force }) -> Response
```

Routes (both tokens):
- `GET /activity` -> 200 `{ entries }` (`{ entries: [] }` when the key is absent).
- `POST /activity/undo` body `{ id: string, force?: boolean }` ->
  200 `{ undone: id, entry: <new entry id> }` · 400 bad body · 404 `"unknown entry"` (never logged, or evicted) ·
  409 `{ error: "already undone" }` · 409 `{ error: "changed since", changed: [{ id, now }] }` ·
  409 `{ error: "<validator reason>" }` when the restored value fails `VALIDATE[key]` (e.g. eatRequests over 50).
- Logged PUT with `?dryRun=1` -> 200 `{ changes, summary }`, no KV write, no entry. Validation (and the assistant's
  library append-only check) still runs first, so a dry run that would be refused is refused the same way.

Undo writes: start from the **current** KV value, put each change's `before` back (null -> remove the item, absent item
-> append / set map key), bump a top-level string `updatedAt` to now (so the app's last-write-wins library/dayHints pulls
take it), validate, put, then `logWrite` with `undoes: id` and changes `{ id, before: current, after: restored }`.

## Edge cases

- PUT changes nothing (same items, only `updatedAt` differs) -> no entry.
- Item deleted by the app since (e.g. app drained an eat-request) -> current is absent, recorded `after` was not -> stale.
- `force` restores over newer changes; still refuses "already undone".
- KV `activity` malformed -> treated as empty, never a 500 on a write (a logging failure must not lose the user's write:
  write the key first, then log).
- Library undo through the assistant bypasses the append-only PUT check by design: it only restores states that log
  recorded, which were themselves assistant writes.
- `putMealMethod` is logged as a `library` change of that one meal.
- Read-modify-write race on `activity` between two concurrent writes: `// ponytail:` comment, single user, a lost entry
  costs one missing log line; Durable Object if it ever bites.
- `why`, `summary` and item names are external text: the app renders them with `textContent`/`esc()`.

## Verification

- No real credential needed: the harness's in-memory env uses fake tokens (`a` = assistant, `h` = app/Hermes).
- `node tools/worker_test.mjs` (asserts below) and `python3 check.py` all green.
- Asserts: assistant `PUT /pantry` changing rice `500g`->`400g` and adding milk logs one entry with 2 changes and the
  `X-Reason` text; `POST /activity/undo` restores rice to exactly `500g` and removes milk, and the log gains an entry with
  `undoes`; a second undo of the same id -> 409 already undone; an app (`h` token) PUT that changes rice after an
  assistant write makes that undo 409 "changed since" listing rice, and `force: true` then succeeds; a no-op PUT logs
  nothing; an `h` token PUT logs nothing; `?dryRun=1` returns the changes and leaves KV and `activity` unchanged;
  after 205 writes `entries.length === 200` and the oldest are gone; old entries are byte-identical after later writes
  (append-only); `putMealMethod` and a library append each log one library change; undo of a library change bumps
  `updatedAt`.
- UI: serve the site, seed KV-shaped mocks via Playwright route interception, open Assistant activity at PC and 390 px in
  both themes: rows render, Undo -> row shows "Undone", a 409 changed-since shows the "Undo anyway" prompt.

## Tasks

Logic (TDD in `tools/worker_test.mjs` first)
- [ ] `ITEMS`, `diffItems`, summary text; asserts for pantry, library (object and bare array), dayHints map, today whole
- [ ] `logWrite` with cap 200 and malformed-key fallback; hook into generic PUT (assistant only, after the KV put) and `putMealMethod`
- [ ] `X-Reason` header, `?dryRun=1`; CORS `POST` + `X-Reason`; `ASSISTANT_ALLOWED` += `GET /activity`, `POST /activity/undo`
- [ ] `GET /activity`, `POST /activity/undo` with stale check, `force`, already-undone, validator re-check, `updatedAt` bump
- [ ] `hermes-sync.js`: `fetchActivity`, `undoActivity`, `resyncKey` (pantry/adhoc -> `fetchItems`, library ->
      `syncLibrary`, placements/eatRequests -> `syncPlacements().then(syncEatRequests)`, dayHints -> `fetchDayHints`,
      products -> `syncProducts`, today/planFlag -> existing Today/plan-flag pull)
- [ ] `docs/ARCHITECTURE.md`: KV schema + endpoint rows

UI (`ui-build` skill)
- [ ] `index.html` Assistant activity `<details>` under Hermes sync, hidden when sync is off; `app.js` renders rows
      (time, who, summary, why, Undo / "Undone"), loading and empty states, 409 changed-since -> "Undo anyway" via the
      existing modal sheet, success toast; `sw.js` CACHE bump
- [ ] Check PC + 390 px, dark + light; `python3 check.py`
