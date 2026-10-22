# Phase 55: Shopping list as the single shared state [L]

Plain: One shopping list shared by the app, Google Tasks and the assistant: tick a line anywhere and every device sees it, ticks survive a re-plan, and a removed line stays removed.

Requires Phase 32 (done: `/adhoc`, `GET /shopping`), Phase 39 (built: pantry `out` flag, `clearOut` in `shopping.js`), Phase 48 (built: `ITEMS`/`logWrite`/`diffItems`, `worker/worker.js`). Assistant side is `notion_assistant` **Phase 44** (was 86, not started): nothing here waits on it.

## Decisions
- **Ad-hoc folds into the one list** (user-chosen). One KV key `shopping` holds every line's state. The ad-hoc list becomes
  "extra" lines in it. `GET|PUT /adhoc` stay as a compatibility shim over `shopping` (the assistant's ran-out tick and current
  `PUT /adhoc` keep working) until Phase 56 rewrites the contract. KV `adhoc` is read once for migration, then never written.
- **Ticks survive a regenerate, keyed by ingredient** (user-chosen). Plan line id = `p:${startDate}:${shopDay}:${key}`; same
  start date + shop day + ingredient keeps its state, a new start date starts fresh. Drops today's `generatedAt` reset.
- **Removal is a tombstone** (own call, the roadmap's lean): state `deleted` + `updatedAt`, so a stale device's older write
  loses. Non-`needed` lines older than 30 days are pruned on every merge (a 30-day-stale device is not a real case).
- **Per-line last-write-wins on the server** (own call): a new merge route, not whole-key PUT, so two devices writing different
  lines both survive. Later `updatedAt` wins; a tie keeps the current line (makes repeat POSTs a no-op). An `updatedAt` more than
  5 minutes in the future is clamped to server now (a fast-clock device can't pin a line forever).
  `ponytail:` KV read-merge-write is not atomic; two POSTs in the same ~second can lose one. Single user; upgrade to a Durable
  Object only if it bites.
- **Extra line id = `x:${normalizeKey(name)}`** (own call): re-adding a name that is got/deleted reuses the id with a newer stamp
  (back to `needed`), so a sync loop cannot duplicate a line.
- **"Got" never writes the pantry** (roadmap): the assistant's intake preview (`notion_assistant/pantry.py`) is the only path in.
  The app's existing got-tick → `clearOut` (clears the Phase 39 `out` flag only) stays.
- `source` values: `plan` (plan line, or a `commitCook` shortfall), `manual` (app add), `assistant`, `ranout` (Phase 39 tick).
  The shim stamps `assistant` for the assistant token and `manual` otherwise, unless the item carries a valid `source`.
- Assistant scope (own call): `GET /shopping/lines`, `POST /shopping/lines` added to `ASSISTANT_ALLOWED`; its writes are logged
  (Phase 48) under key `shopping`. Undo of a `shopping` entry restamps the restored lines to now (else they'd lose LWW at once).
  `ITEMS.adhoc` is removed: undoing a pre-55 adhoc entry answers 404 "unknown entry" (accepted).
- Pure logic goes in `shopping-list.js` (already `window`→`root` shimmed, Worker-imported; no new shim needed). App sync goes
  in `hermes-sync.js` (`MP.Sync`, browser only, the Worker does not import it).

## Files touched
- `shopping-list.js`: `lineId`, `mergeLines`, `adhocView`, `adhocToLines`; `cookOps` shortfall (line ~401) unchanged in shape.
- `worker/worker.js`: `shoppingLines` helpers, `GET|POST /shopping/lines`, `/adhoc` shim (out of `KEYS`), `GET /shopping`
  additive fields, `VALIDATE`/`ITEMS.shopping`, `ASSISTANT_ALLOWED`, undo restamp.
- `hermes-sync.js`: shopping-line mirror + pending map + fetch/flush/set; `resyncKey("adhoc")` → shopping lines.
- `shopping.js`: planned + ad-hoc tabs read/write line state; one-time `mp_shopping_ticked` migration.
- `plan.js` `applyCookOps`: `list: "adhoc"` ops become `MP.Sync.setLine` extra lines (`source: "plan"`).
- `style.css` (skipped/got line states, only if existing `.ticked` styling isn't enough), `sw.js` `CACHE` bump.
- `test.html`, `tools/worker_test.mjs`, `docs/ARCHITECTURE.md` (KV schema + endpoints lines; v9 section already written).

## Signatures / schemas
```
KV shopping: { updatedAt: ISO, lines: Line[] }
Line: { id: string, state: "needed"|"got"|"skipped"|"deleted", updatedAt: ISO,
        source?: "plan"|"manual"|"assistant"|"ranout", label?: string, qty?: Qty }
  id "p:<startDate>:<1|8>:<key>"  plan line: state (+ updatedAt, source "plan") only; label/qty come from buildLists
  id "x:<normalizeKey(name)>"     extra line: label required (<=80), qty optional (same rules as qtyError), source required

shopping-list.js (MP.ShoppingList):
  lineId(startDate, shopDay, key) -> "p:..."
  mergeLines(current: Line[], incoming: Line[], nowIso) -> { lines: Line[], changed: Line[] }   // pure, never throws
  adhocView(lines) -> [{ name, qty?, source }]          // x: lines with state "needed"
  adhocToLines(lines, items, source, nowIso) -> Line[] // incoming lines: new/changed names -> needed, missing -> deleted

Worker:
  GET  /shopping/lines            -> { updatedAt, lines }   (lazy migration from KV adhoc if shopping absent)
  POST /shopping/lines  { lines: Line[] (<=100) } -> 200 { updatedAt, lines, changed: n }   400 on bad shape
  GET  /adhoc                      -> { updatedAt, items: adhocView(lines) }    (shim)
  PUT  /adhoc   { items }          -> 204, merged via adhocToLines              (shim, itemsError still validates)
  GET  /shopping                   -> as now + per plan line { id, state, stateAt } + extras: Line[] (x: lines, not deleted)

hermes-sync.js (MP.Sync):
  shoppingLines() -> Line[]                 // sync read: mirror mp_shopping merged with pending mp_shopping_pending
  setLine(partial) -> Line                  // stamps updatedAt now, writes pending + mirror, fire-and-forget flush
  fetchShoppingLines() -> Promise<Line[]>   // never throws; falls back to the mirror
  flushShoppingLines() -> Promise<"off"|"noop"|"ok"|"error">  // POSTs pending; clears only ids whose stamp is unchanged
```

## Edge cases
- Tick then un-tick on two devices: later stamp wins regardless of arrival order (test both orders).
- Stale device POSTs `needed` for a line deleted later elsewhere: older stamp loses, stays deleted.
- Same POST twice (sync loop): second returns `changed: 0`, KV untouched, no activity entry.
- POST mixing valid and invalid lines: whole request 400 (no partial write).
- Plan line state whose id isn't in the current plan: kept (pruned at 30 days), never shown.
- Extra line with the same normalized name as a plan line: both shown; they are different ids (no merging across kinds).
- `PUT /adhoc` with an item missing that was added since the caller's GET: becomes `deleted` (same lost-update risk as today's
  whole-list PUT; Phase 56 removes the shim). Note it in ARCHITECTURE.md.
- Pending `mp_sync_ops` entries with `list: "adhoc"` from before deploy still flush through the shim: no data lost.
- Sync off (no Worker config): mirror alone is the store; everything works on one device.
- Old `mp_shopping_ticked` whose `generatedAt` matches the current plan: each key becomes a pending got line, then the key is removed.
- Future `updatedAt` > now+5 min → clamped. Non-ISO `updatedAt`, unknown state/source, `x:` without label, label > 80, > 100
  lines, id not `p:`/`x:` or > 120 chars → 400.
- Labels are untrusted (assistant/Google Tasks): rendered via `esc()` only.

## Verification
- `node tools/worker_test.mjs`: two devices writing different lines both survive; tick/untick race resolves to the later stamp
  in both arrival orders; repeat POST is a no-op with no activity entry; stale tombstone holds; future stamp clamped; migration
  from KV `adhoc`; `/adhoc` shim GET/PUT round-trip with `source` stamping; `GET /shopping` carries `id`/`state`/`extras`;
  assistant token can reach the new routes and is logged, undo restamps; bad shapes 400.
- `test.html` (via `python3 check.py ui`): `lineId`, `mergeLines` (tie, clamp, prune), `adhocView`, `adhocToLines`.
- `python3 check.py`: all lines pass, `sw.js` bumped.
- Drive the Shopping page (Playwright, fresh profile, PC + 390 px, dark + light): tick, un-tick, skip a plan line, add/tick/remove
  an ad-hoc item, regenerate the plan with the same start date and see ticks kept, a `<b>` label renders as text.
- No real credential needed: Worker tests use the harness's fake tokens.

## Tasks
### Logic (TDD)
- [ ] `shopping-list.js`: `lineId`, `mergeLines`, `adhocView`, `adhocToLines` with `test.html` cases first
- [ ] Worker: `GET|POST /shopping/lines`, validation, lazy `adhoc` migration, `ITEMS.shopping` + logging, undo restamp, scope
- [ ] Worker: `/adhoc` shim (remove from `KEYS`/`ITEMS`), `GET /shopping` additive fields; `worker_test.mjs` cases above
- [ ] `hermes-sync.js`: mirror/pending/`setLine`/`fetchShoppingLines`/`flushShoppingLines`; `resyncKey("adhoc")` → lines
- [ ] `plan.js` `applyCookOps`: shortfall ops → extra lines (`source: "plan"`), pantry ops unchanged
### UI (`ui-build` skill)
- [x] Planned tab: checkbox got/needed (still calls `clearOut` on got), × skips; skipped/got styling; refetch on visibilitychange
- [x] Ad-hoc tab: extras from `MP.Sync.shoppingLines()`, add, tick → got, × → deleted, "Clear got"; `mp_shopping_ticked` migration
- [x] `sw.js` CACHE bump, ARCHITECTURE.md KV/endpoint lines, `python3 check.py`, PC + 390 px both themes
