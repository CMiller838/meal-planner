# Phase 25 — Hermes `planPrefs` sync + conversational flow trigger

Three small edits, no new files: a `GET`/`PUT /planPrefs` relay on
`worker/worker.js`, a `syncPlanFlag`-shaped pull/push pair in
`hermes-sync.js`, and one extra button on the existing plan-request banner
that opens `plan-with-me.html` instead of generating immediately.

"Trigger the interactive flow" needs **no new endpoint**
(`docs/ARCHITECTURE.md:331-334`): Hermes PUTs `/planPrefs`, then the existing
`PUT /planFlag`. The app's banner already polls that flag.

## Decisions (answered 1A)

| # | Decision | Chosen | Why |
|---|----------|--------|-----|
| D1 | When does opening `plan-with-me.html` from the banner ack the plan flag? | **A — ack immediately on the button click, then navigate** | Relayed to me by the coordinating agent as the user's own pick, matching my recommendation. `ackedAt` already means "the user dealt with the request, plan or not" — `#hermes-dismiss` (`plan.js:851-854`) acks with no plan made at all. Path B would carry a pending `requestedAt` across a page navigation and add an ack in Phase 24's commit path to make one of three buttons honest while the other two keep the old meaning. |

### Calls made without a gate (trivial forks, noted for the record)

- **KV key is `"planPrefs"`, not `"prefs"`.** `/prefs` already owns the
  `"prefs"` KV key for the unrelated `MP.Prefs` blob (`worker/worker.js:11-15`,
  `hermes-sync.js`'s `pushPrefs`). Client-side naming (`mp_planPrefs`) matches.
- **One extra `<button>` inside the existing `#hermes-banner`**, not a second
  banner state. Three buttons in one row is the same row; a second banner is a
  second thing to show, hide and style.
- **`hermes-sync.js` gets a single GET/PUT pair** (`syncPlanFlag`/`ackPlanFlag`
  shape, `hermes-sync.js:96-108`), **not** a `mirrorKey`/`fetchItems` list
  helper (`124-152`). `planPrefs` is one object with an `updatedAt`, like
  `library`, not a list — there is no `items` array and no pending-op log.
- **A `<button>`, not an `<a>`**, for the new banner control — unlike Phase
  23's `#plan-with-me-btn` it must run the ack before navigating, so it needs
  a click handler either way.

## Findings (verified, do not re-derive)

- `worker/worker.js` routing is **already fully generic**. `KEYS` (11-15) maps
  path → KV key; GET reads `env.MP_KV.get(kvKey)` and returns the literal
  string `"null"` when absent (193-194); PUT parses JSON (400 on bad body),
  runs `VALIDATE[kvKey]` (400 with the returned reason), `env.MP_KV.put`, then
  `204`. Auth (`X-Auth-Token` vs `env.AUTH_TOKEN`, 401), `OPTIONS` → 204, CORS,
  404/405 all apply automatically. **No `fetch`-handler change is needed** —
  two map entries and one validator is the whole Worker diff.
- `VALIDATE` entries return an **error string or `null`** (`null` = valid);
  `planFlag` maps to literal `null` (no validation at all).
  `prefsError` (133-137) is the size/style model: plain-object check plus one
  field check.
- `hermes-sync.js` has **no central route-path list** — paths are string
  literals at each `req()` call site. Nothing else to register.
- `req(method, path, body)` (52-62): adds `X-Auth-Token` + JSON headers,
  throws on non-ok, returns `null` on 204, else `res.json()`.
- `decide(localStamp, remote)` (22-28) is generic already: it takes a local ISO
  string and any object with `updatedAt`, and returns `"pull"` / `"push"` /
  `"noop"`. It is **not** library-specific despite its comment. Reuse as-is.
- `MP.PlanPrefs = { KEY, get, save }` (`plan-with-me.js:8`, Phase 23).
  `get()` → `{ busyDays: number[], chips: string[] }`, defensive, never
  throws; `save(busyDays, chips)` stamps ISO `updatedAt`, sorts `busyDays`,
  returns the saved object. **`get()` drops `updatedAt`** — the sync needs the
  raw stamp, see §2.1.
- `plan.js:740` holds module-level `pendingRequestedAt`; `initHermesBanner()`
  (742-749) sets it from `flag.requestedAt` and un-hides `#hermes-banner` when
  `MP.Sync.needsPlan(flag, localStorage.getItem("mp_hermes_plan_acked"))`.
- `ackPlanFlag(requestedAt)` PUTs `{requestedAt, ackedAt}` **and** writes
  `LS_PLAN_ACKED` locally, so the banner stays hidden across reloads even if
  the PUT's KV write is slow to read back.
- `docs/ARCHITECTURE.md:112-115` — `planPrefs` is two-way, last-write-wins by
  `updatedAt` via the existing `MP.Sync.decide`.
- `docs/ARCHITECTURE.md:128-129` — `planPrefs` follows the `prefs` local-first
  push pattern with one difference: it is also *pulled*, **on open of the
  Plan-with-me screen only**. There is no poll and no pull anywhere else.

## Non-goals

- **No chip-id validation** against `plan-preferences.json`, on either side —
  a vocabulary edit must never lock out a write (`ARCHITECTURE.md:322-329`,
  same rule as `/library` carrying no dietary rules). Unknown ids are ignored
  downstream (Phase 22 invariant).
- **No `/ranking`** (Phase 26). No `nutrition.js`/`generator.js` `window` →
  `root` shim in this phase — that is Phase 26's prerequisite, not this one's.
- **No new endpoint for "trigger the flow."** No `/planRequest`, no payload on
  `planFlag`, no message/prompt field.
- **No change to the generator, the ranking layers, or `plan-preferences.json`.**
- **No poll loop** for `planPrefs`, no pull on `plan.html` load, no pull in the
  banner handler.
- **No change to `#hermes-generate` or `#hermes-dismiss` behaviour.**
- No change to `app.js`, `discover.js`, `shopping*.js`, `prefs.js`,
  `generator.js`, `nutrition.js`, `data.js`.
- No new dependency, no build step (CLAUDE.md).

### Invariants this phase must not break

- **`mp_planPrefs` is settings, not plan state.** The new sync moves only
  `{ updatedAt, busyDays, chips }`. A Hermes write can never contain a meal id
  or a date, and the Worker must reject a body that isn't that shape.
- **`MP.PlanPrefs` stays the only reader/writer of `mp_planPrefs`**
  (CLAUDE.md, `ARCHITECTURE.md:238-241`). `hermes-sync.js` goes **through** it,
  it does not `localStorage.setItem("mp_planPrefs", ...)` itself.
- **Sync is never on the critical path** (`ARCHITECTURE.md:123-129`). Every new
  network call is failure-silent: bridge unreachable, 401, 404 or garbage JSON
  all degrade to "use the local prefs", never to an error the user sees and
  never to a blocked render.
- **One-tap Generate stays one tap** and stays byte-identical — this phase does
  not touch `#generate-btn` or the `?guided=1` path.
- **The Worker stays a relay** (`ARCHITECTURE.md:153-157`): shape checks only,
  no computation, no defaulting of missing fields.
- **KV is eventually consistent** — no read-after-write. The push is
  fire-and-forget; nothing waits for it or re-reads to confirm.

## §1 `worker/worker.js`

### 1.1 `KEYS` (lines 11-15)

One entry:

```js
"/planPrefs": "planPrefs",
```

### 1.2 `planPrefsError(parsed)` — new validator

Beside `prefsError` (133-137), same shape and size.

```js
/** Shape-only. Chip ids are deliberately NOT checked against
 *  plan-preferences.json — a vocabulary edit must never lock out a write. */
function planPrefsError(parsed)   // -> string | null
```

Returns a reason string, else `null`:

| Check | Reason string (indicative) |
|-------|---------------------------|
| `parsed` is a plain object (not `null`, not an array) | `"body must be an object"` |
| `typeof parsed.updatedAt === "string"` and `Date.parse` of it is finite | `"updatedAt must be an ISO date string"` |
| `Array.isArray(parsed.busyDays)` and every entry is an integer 1-14 | `"busyDays must be integers 1-14"` |
| `Array.isArray(parsed.chips)` and every entry is a string | `"chips must be an array of strings"` |

All four fields are **required** — the Worker defaults nothing (relay rule).
Duplicates in `busyDays` are *not* an error (the client's `get()` already
dedupes on read, `plan-with-me.js:18-20`); rejecting them would be a second
place that has to agree. No length cap on `chips` beyond it being an array —
unknown ids are ignored downstream, so a long list is harmless, not hostile.

### 1.3 `VALIDATE` (163-172)

```js
planPrefs: planPrefsError,
```

### 1.4 `fetch` handler (174-226)

**No change.** Confirm by reading it: `KEYS[path]` + `VALIDATE[kvKey]` drive
everything, so `GET /planPrefs` returns the raw KV string (or `"null"`) and
`PUT /planPrefs` shape-checks then writes, with auth/CORS/405 already handled.
If this phase finds itself editing the handler, something is wrong.

## §2 `hermes-sync.js`

Two functions modelled on `syncPlanFlag`/`ackPlanFlag` (96-108), added beside
them. Both no-op when `!config().enabled`.

### 2.1 `fetchPlanPrefs()`

```js
/** GET /planPrefs, decide() against the local stamp, pull if remote is newer.
 *  Failure-silent. Returns the prefs the caller should render. */
async function fetchPlanPrefs()   // -> { busyDays: number[], chips: string[] }
```

Flow:

1. `if (!config().enabled) return MP.PlanPrefs.get();`
2. `const remote = await req("GET", "/planPrefs")` inside `try`/`catch`; on
   throw, or on a non-object / `null` body, `return MP.PlanPrefs.get()`.
3. `decide(localPlanPrefsStamp(), remote)`:
   - `"pull"` → `MP.PlanPrefs.save(remote.busyDays, remote.chips)` and return
     that. Going through `save()` keeps `MP.PlanPrefs` the only writer and
     re-runs its filters, so a Hermes body that slipped past the Worker
     (`"3"`, `0`, `15`, a non-string chip) still can't land in storage.
   - `"push"` → fire `pushPlanPrefs()` without awaiting it, return
     `MP.PlanPrefs.get()`.
   - `"noop"` → return `MP.PlanPrefs.get()`.

> `save()` re-stamps `updatedAt` to *now* on a pull, so the pulled copy looks
> locally-newer afterwards and the next `decide()` says `"noop"`/`"push"`
> rather than pulling the same body again. That is the intended outcome — the
> value is identical, and it avoids storing a remote clock's timestamp as if
> it were local. `ponytail: re-stamping loses "when Hermes wrote it"; store
> the remote stamp separately only if Hermes ever needs to detect its own
> write coming back.`

```js
/** Raw updatedAt out of mp_planPrefs, or "" — MP.PlanPrefs.get() drops it. */
function localPlanPrefsStamp()   // -> string
```

`MP.PlanPrefs.get()` returns only `{ busyDays, chips }`, so this reads
`localStorage.getItem(MP.PlanPrefs.KEY)` and `JSON.parse`es it in a
`try`/`catch`, returning `""` on anything malformed (`""` → `Date.parse` NaN →
`decide`'s `?? 0`, so a corrupt local copy loses to any valid remote — the
correct outcome).

### 2.2 `pushPlanPrefs()`

```js
/** Best-effort PUT of the local mp_planPrefs. Never throws. */
async function pushPlanPrefs()   // -> void
```

Reads the raw stored object (so the existing `updatedAt` is sent, **not**
re-stamped), PUTs `{ updatedAt, busyDays, chips }`, `.catch(() => {})`. No-ops
when the config is disabled or nothing is stored. Same failure-silent contract
as `pushPrefs`/`pushPlan`.

### 2.3 Exports

Add `fetchPlanPrefs, pushPlanPrefs` to the `MP.Sync` object (line 358-361).
`localPlanPrefsStamp` stays private.

## §3 `plan-with-me.js` — pull on open, push on save

Both edits are inside the page controller's existing paths; `MP.PlanPrefs`
itself is unchanged.

- **Prefill (Phase 23 §2.3):** the controller currently seeds its two Sets
  from `MP.PlanPrefs.get()`. Change that one call to
  `await MP.Sync.fetchPlanPrefs()` — same return shape, so the rest of prefill
  (including dropping chip ids absent from the loaded vocabulary) is untouched.
  Guard with `MP.Sync ? await MP.Sync.fetchPlanPrefs() : MP.PlanPrefs.get()`:
  `plan-with-me.html`'s script list is `data.js` + `plan-with-me.js` only
  (Phase 23 §3), so `hermes-sync.js` must be **added** to that page — see §5 —
  and the guard keeps the module standalone if it isn't loaded.
- **On Generate (`#pwm-generate-btn`):** after `MP.PlanPrefs.save(...)` and
  before/alongside `location.href = ...`, call `MP.Sync.pushPlanPrefs()`
  without awaiting. The navigation may kill the request in flight; that is
  acceptable (local-first, `ARCHITECTURE.md:123-129`) and the next screen open
  pushes again via `decide`'s `"push"` branch. Do **not** await it — that would
  put the bridge on the path of a tap.
- The page still writes nothing but `mp_planPrefs` (Phase 23 invariant).

## §4 `plan.html` + `plan.js` — the second banner button (D1)

### 4.1 `plan.html` (the `#hermes-banner` block, ~line 30-34)

```html
<div id="hermes-banner" class="banner hidden">
  <span>Hermes asked for a new plan</span>
  <button id="hermes-generate" class="btn">Generate</button>
  <button id="hermes-plan-with-me" class="btn">Plan with me</button>
  <button id="hermes-dismiss" class="btn">Dismiss</button>
</div>
```

Existing `.banner` / `.btn` classes only — **no new CSS**. If three buttons
plus the label wrap awkwardly at phone width, the fix is `flex-wrap` on the
existing `.banner` rule, not a new banner layout.

### 4.2 `plan.js` — one handler beside the existing two (845-854)

```js
// #hermes-plan-with-me
await MP.Sync.ackPlanFlag(pendingRequestedAt);   // D1: same moment as Dismiss
location.href = "plan-with-me.html";
```

- `ackPlanFlag` is **awaited**, unlike the pushes above: it writes
  `LS_PLAN_ACKED` locally and we are about to leave the page, so letting it
  finish is what keeps the banner from reappearing. Wrap in `try`/`catch` (or
  `.catch(() => {})`) so a dead bridge still navigates — the local
  `LS_PLAN_ACKED` write inside `ackPlanFlag` is the part that matters.
- No `#hermes-banner` hide needed (we navigate away), but adding `"hidden"`
  first costs nothing if the navigation is slow. Optional.
- `initHermesBanner()` (742-749) is **unchanged** — same `pendingRequestedAt`,
  same un-hide condition. The new button reads the variable that already
  exists.
- The link carries **no query param**. The prefill comes from
  `fetchPlanPrefs()` on the screen's own load (§3), which is the same thing
  whether the user arrived from the banner or from `#plan-with-me-btn`.

## §5 `plan-with-me.html` + `sw.js`

- `plan-with-me.html`: add `<script src="hermes-sync.js"></script>` before
  `plan-with-me.js`. That is the only markup change to this page.
- `sw.js`: bump `CACHE` (line 4) one step from its current value, and add
  nothing to the shell array — every file this phase touches is already in it
  (no new files). Read the current value; do not assume it.

## §6 Docs

- **`docs/roadmap.md`** Phase 25 (lines 92-107): note D1 (the banner button
  acks immediately, same as Dismiss) and that the Worker's `fetch` handler
  needed no change. Mark shipped when done.
- **`docs/ARCHITECTURE.md`**: `/planPrefs` (line 141) and the `planPrefs` key
  description (112-115) are already correct — leave them. Add to the v4
  Hermes section (322-334) that the pull entry point is
  `MP.Sync.fetchPlanPrefs()` called from `plan-with-me.js`'s prefill, the push
  is `pushPlanPrefs()` fired un-awaited on Generate, and that the banner's
  "Plan with me" button acks `planFlag` on click (D1) — so `ackedAt` means
  "the user responded", not "a plan exists", for both it and Dismiss.
- **`CLAUDE.md`**: one line under the `mp_planPrefs` invariant — `MP.PlanPrefs`
  remains the only reader/writer; `hermes-sync.js` pulls/pushes **through** it
  and never writes the key directly.
- **`SPEC.md`**: no change (no new page, no new user-facing rule).

## Edge cases

| Case | Required behaviour |
|------|--------------------|
| Bridge not configured (`enabled === false`) | `fetchPlanPrefs()` returns `MP.PlanPrefs.get()` synchronously-equivalent; `pushPlanPrefs()` no-ops. Screen behaves exactly as Phase 23. |
| Bridge unreachable / 401 / 500 on GET | `catch` → local prefs render. No toast, no console noise beyond the existing `req` throw being swallowed. Screen never blocks on the network. |
| `GET /planPrefs` returns `"null"` (key never written) | Parsed as `null` → treated as "no remote". `decide(local, null)` → `r = -1` → `"push"` if anything local exists, else `"noop"`. |
| Remote body is `{}` / an array / a string | Not a plain object with a parseable `updatedAt` → `decide` gives `r = -1` → never pulled. Garbage can't clear local prefs. |
| Remote `updatedAt` valid but `busyDays`/`chips` missing or junk | Pull goes through `MP.PlanPrefs.save()`, whose filters coerce them to `[]`/drop bad entries. Worst case the user sees an empty selection, never a crash. |
| Remote and local `updatedAt` identical | `"noop"` — no write, no PUT. |
| Local `mp_planPrefs` corrupt (`"{{{"`) | `localPlanPrefsStamp()` → `""` → any valid remote wins and repairs the key. With no remote, Phase 23's defensive `get()` still yields the empty default. |
| Hermes PUTs a chip id not in `plan-preferences.json` | Accepted by the Worker (deliberate), stored, dropped at prefill by Phase 23's vocabulary filter, ignored by `rankSlot`. Never an error. |
| Hermes PUTs `busyDays: [0, 15]` or `["3"]` | Worker returns **400** with the reason; nothing is stored. This is the one place bad data is rejected rather than coerced — it's a trust boundary. |
| Hermes PUTs `/planPrefs` then `/planFlag` | Banner appears on the next `plan.html` open (existing poll). Tapping "Plan with me" acks, navigates, and the screen pulls the just-written prefs. This is the phase's headline flow. |
| User taps "Plan with me" then abandons the screen | Flag is already acked (D1). Banner does not return; no plan was made. Same outcome as Dismiss today. Hermes can tell from the `plan` mirror's timestamp. |
| User taps "Plan with me" with the bridge down | Ack PUT fails, `LS_PLAN_ACKED` is still written locally, navigation happens, local prefs prefill. Banner stays hidden locally; Hermes may re-ask later. Acceptable. |
| Two devices edit prefs | Last-write-wins by `updatedAt`, no merge — same as `library`. `busyDays`/`chips` are never merged element-wise. |
| Offline (PWA) | Both pages and their scripts load from the bumped cache; every bridge call fails silently to local prefs. |

## §7 Tests — `test.html` group 42

Logic-only, no DOM, no network. Follow group 41's structure. The two new sync
functions are network wrappers, so test the **decision** and the **coercion**,
not `fetch`:

- `MP.Sync.decide` with a `planPrefs`-shaped remote: remote newer → `"pull"`,
  local newer → `"push"`, equal → `"noop"`, `remote = null` → `"push"` when
  local exists (confirms the reuse is sound for this key, no new function).
- The local-stamp read: corrupt `mp_planPrefs` (`"{{{"`, `"null"`, `"[]"`)
  yields a stamp that loses to a valid remote (assert `decide(...) === "pull"`).
- Pull coercion: `MP.PlanPrefs.save(remoteBusyDays, remoteChips)` with a
  hostile remote body (`[0, "3", 15, 7, 7]`, `["comfort", 3, null]`)
  round-trips through `get()` to `{ busyDays: [7], chips: ["comfort"] }` —
  i.e. a Worker-bypassing write still can't poison the key.
- `planPrefsError` is Worker-side (no `test.html` harness for `worker/`) —
  cover it with the curl checks in §8 rather than inventing a test runner
  (CLAUDE.md: no test runner exists; don't invent one).

## §8 Manual pass

1. `curl -H "X-Auth-Token: $T" $URL/planPrefs` → `null` (or a prior body), 200.
2. `curl -X PUT -H "X-Auth-Token: $T" -d '{"updatedAt":"2026-09-13T10:00:00.000Z","busyDays":[3,4],"chips":["comfort"]}' $URL/planPrefs` → **204**; the GET now returns it.
3. Bad bodies each → **400** with a reason, and the GET still returns the
   previous good body: `{}`; `{"updatedAt":"nope","busyDays":[],"chips":[]}`;
   `{"updatedAt":"<iso>","busyDays":[0,15],"chips":[]}`;
   `{"updatedAt":"<iso>","busyDays":[3],"chips":[7]}`; `[1,2,3]`.
4. A chip id that isn't in `plan-preferences.json` → **204** (accepted by
   design). Confirm `/prefs` still round-trips its own unrelated body — the two
   KV keys must not have collided.
5. No `X-Auth-Token` → 401 on both GET and PUT. `DELETE /planPrefs` → 405.
6. App: open `plan-with-me.html` with the bridge configured and a *newer*
   remote body → the grid/chips show the remote selection, and
   `localStorage.mp_planPrefs` now matches it.
7. Change the selection, tap Generate → `GET /planPrefs` shows the new body.
8. Local newer than remote: edit `mp_planPrefs`'s `updatedAt` forward in
   DevTools, reload the screen → remote is overwritten with the local body,
   nothing is pulled.
9. Clear the bridge config (or block the Worker in DevTools) → the screen still
   prefills from local prefs, Generate still works, no visible error.
10. Hermes flow: `PUT /planPrefs` then `PUT /planFlag` with a fresh
    `requestedAt` → open `plan.html`, banner shows three buttons. Tap "Plan
    with me": `GET /planFlag` shows `ackedAt === requestedAt` **immediately**
    (D1), the setup screen opens prefilled from the pushed prefs.
11. Return to `plan.html` → banner stays hidden. `#hermes-generate` and
    `#hermes-dismiss` behave exactly as before on a fresh `requestedAt`.
12. Offline after one load: both pages load from the bumped cache, prefill
    falls back to local, no console exception.
13. Dark + light mode: the three-button banner is legible and doesn't overflow
    at phone width.
