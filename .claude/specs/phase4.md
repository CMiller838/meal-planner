# Phase 4 Spec — Hermes bridge (Cloudflare Worker + KV)

Roadmap: `docs/roadmap.md` → Phase 4. Source of scope: `docs/OUTLINE.md` lines 22–39,
technical design already fixed in `docs/ARCHITECTURE.md` (Stack, Why Worker + KV, KV
schema, Worker endpoints). This is the **only backend in the project**; it exists to sync
one JSON blob and one flag, and must not grow into a general API.

The repo is public. No library data, no Worker URL and no token may ever be committed.

## Decisions taken (user-confirmed)

| Gate | Decision |
|---|---|
| 1. Worker structure | **Path A** — one `worker/worker.js`, generic two-key relay driven by a hardcoded path→KV-key allowlist. One shared guard on `PUT`: body must parse as JSON *and* be a plain object. No per-field schema validation. |
| 1b. Toolchain | **No `worker/package.json`** — just `wrangler.toml` + `worker.js`, deployed with `npx wrangler deploy`. Nothing installed, nothing committed; the repo's zero-dependency shape stays literally true. |
| 2. Settings UI | **Path A** — collapsed `<details>` "Hermes sync" section at the bottom of `index.html` (Worker URL, token, status line). No `settings.html`, no fourth nav link. |
| 3. planFlag behaviour | **Path B** — banner on `plan.html`, generates and acks only on tap. Never auto-regenerates; a remote trigger does not get more destructive power than the local Generate button, which already `confirm()`s. |
| Conflict model | Last-write-wins by `updatedAt`, compared **at apply time** (re-read after the network round-trip), not at request time. Full-array overwrite, never a per-meal merge. |
| Local schema | `mp_library` **stays a bare array**. The timestamp lives in a separate key, so nothing that already reads the library needs migrating. |
| Caching | `sw.js` `CACHE` → `"meal-planner-v4"`, `hermes-sync.js` added to `SHELL`. |

---

## 0. The two traps this phase is built around

Both are silent-data-loss bugs, not edge cases. Everything below is shaped by them.

**Trap 1 — the seed library.** `MP.getLibrary()` seeds `mp_library` from `meals.json` on
first run. On a fresh browser, an unguarded "local exists ⇒ push" rule would upload 14
seed meals over Hermes' real library. The fix is structural: **the seed write must not
stamp `mp_library_updated_at`.** An unstamped local library sorts as older than any
remote, so remote always wins on a fresh device. If the seed path currently goes through
`saveLibrary()`, it must be changed to write `localStorage` directly (§2).

**Trap 2 — pull/push ping-pong.** If applying a pulled library went through
`saveLibrary()`, it would stamp a *new* local timestamp, which is then newer than the
remote it came from, so the next poll pushes it straight back. The fix is a separate
write path (`MP.applyRemoteLibrary`, §2) that stamps the *remote's* timestamp. Do not
solve this with an "am I currently syncing" flag — the property should hold structurally.

**Known ceiling, record it, do not fix it:** KV is eventually consistent (~60s worst
case, `docs/ARCHITECTURE.md`). A `GET` immediately after a `PUT` may return the old
value. Consequences, all deliberate:

- Never verify a push by reading it back.
- A re-push within the propagation window is possible and harmless (idempotent).
- The plan banner *would* reappear after acking, which is not harmless — §6 mirrors
  `ackedAt` into localStorage specifically to suppress that.

---

## 1. `worker/` — the whole backend

Two files. No `package.json`, no build, no router, no framework.

### 1a. `worker/wrangler.toml`

```toml
name = "meal-planner-bridge"
main = "worker.js"
compatibility_date = "2026-09-01"

[[kv_namespaces]]
binding = "MP_KV"
id = "<paste the id printed by: npx wrangler kv namespace create MP_KV>"
```

Nothing else. No `[vars]`, no routes, no custom domain — the free `*.workers.dev`
subdomain is the endpoint. The KV namespace `id` is **not a credential** (using it still
requires account auth), so committing it is fine. `AUTH_TOKEN` is a Wrangler secret and
never appears in this file or anywhere in the repo.

Add `.wrangler/` to `.gitignore` — Wrangler's local state/miniflare cache.

### 1b. `worker/worker.js`

Module-syntax Worker, single default export.

```js
export default {
  /**
   * @param {Request} request
   * @param {{ MP_KV: KVNamespace, AUTH_TOKEN: string }} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) { /* ... */ }
};
```

Order of checks — this order is load-bearing:

1. **Preflight first, before auth.** `OPTIONS` ⇒ `204` with the CORS headers below and
   **no token check**. A browser preflight cannot carry `X-Auth-Token`; checking auth
   before handling `OPTIONS` is the single most likely way to ship a Worker that curls
   perfectly and fails from the app.
2. **Auth.** `request.headers.get("X-Auth-Token") !== env.AUTH_TOKEN` ⇒ `401`. Plain
   string compare. `ponytail:` comment: *not constant-time; a remote timing attack across
   the internet against a random token is not the threat model here.*
3. **Path allowlist.** `const KEYS = { "/library": "library", "/planFlag": "planFlag" };`
   Unknown path ⇒ `404`. **This two-entry object is what stops the bridge becoming a
   general API** — adding a key here should feel like a decision.
4. **Method.** `GET` / `PUT` only; anything else ⇒ `405`.
5. **`GET`** ⇒ `env.MP_KV.get(kvKey)`. Missing key ⇒ body `"null"`. Never a 404 for a
   key that simply hasn't been written yet, so the client has one code path:
   `await r.json()` gives either the object or `null`.
6. **`PUT`** ⇒ `const body = await request.text()`, then:
   - `JSON.parse(body)` inside `try/catch` — throw ⇒ `400 "invalid JSON"`.
   - parsed value not a plain object (`typeof !== "object"`, `null`, or `Array.isArray`)
     ⇒ `400 "expected a JSON object"`.
   - `await env.MP_KV.put(kvKey, body)` — **store the original text verbatim**, do not
     re-serialise the parsed value.
   - ⇒ `204`.

The Worker never inspects field names, never computes nutrition, shelf-life or plans, and
never reads `meals.json`. It is a relay. (`docs/ARCHITECTURE.md`'s note about the Worker
importing the shared nutrient/exclusion modules applies to **Phase 5**'s conversational
layer — there is no Q&A here and nothing to import.)

### 1c. CORS — not optional, and not in ARCHITECTURE.md

The app is served from GitHub Pages, the Worker from `*.workers.dev`: every call is
cross-origin, and `X-Auth-Token` is a non-simple header, so **every** request is
preflighted. Attach these headers to *all* responses, including the 401/404/405/400s:

```
Access-Control-Allow-Origin:  *
Access-Control-Allow-Methods: GET, PUT, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Auth-Token
Access-Control-Max-Age:       86400
```

`*` is safe here because access is gated by a header token, not by cookies or any
ambient credential — there is nothing for a hostile origin to ride on. Use one
`json(status, body)` / `cors(response)` helper so no path can forget them.

---

## 2. `data.js` — three small additions

`mp_library` keeps its current shape (bare array). One new key:

```
localStorage["mp_library_updated_at"] = "2026-09-03T18:04:11.325Z"   // ISO, or absent
```

```js
/** Existing. Now also stamps mp_library_updated_at = now and fires "mp:library-saved". */
MP.saveLibrary(meals)

/** Overwrite the local library with a pulled remote one. Stamps the REMOTE timestamp
 *  and fires NO event — this is what makes pull/push ping-pong structurally impossible.
 *  @param {Array} meals  @param {string} updatedAt  ISO from the remote blob */
MP.applyRemoteLibrary(meals, updatedAt)

/** @returns {string|null} the stored ISO stamp, or null if never stamped (seed state). */
MP.libraryStamp()
```

- `MP.addToLibrary()` already routes through `saveLibrary()`, so adding a meal pushes for
  free. No change to `app.js`'s mutation calls.
- **`getLibrary()`'s first-run seed must bypass `saveLibrary()`** and write
  `localStorage` directly — see Trap 1. This is a one-line change with a
  disproportionate consequence; leave a comment saying so.
- `window.dispatchEvent(new Event("mp:library-saved"))` is one line at the end of
  `saveLibrary()`. `data.js` gains no knowledge of sync, no fetch and no config.

---

## 3. `hermes-sync.js` — the app-side client

New file, same `MP.*` IIFE shape as `shelf-life.js` / `shopping-list.js`. Precedent for
mixing pure logic with a network function in one module is `MP.ShelfLife.load()` — the
pure functions are what `test.html` exercises; the fetching ones are never called there.

```js
window.MP.Sync = {
  decide, needsPlan,                       // pure — tested
  config, saveConfig,                      // localStorage
  syncLibrary, syncPlanFlag, ackPlanFlag,  // network
  start                                    // wiring
};
```

### 3a. Pure core

```js
/**
 * Last-write-wins decision for the library.
 * @param {string|null} localStamp  MP.libraryStamp()
 * @param {{updatedAt: string, meals: Array}|null} remote   parsed GET /library body
 * @returns {"pull"|"push"|"noop"}
 */
decide(localStamp, remote)
```

```
l = finite(Date.parse(localStamp))       else 0    // unstamped seed sorts oldest
r = finite(Date.parse(remote?.updatedAt)) else -1  // no remote sorts below even the seed
r > l -> "pull"    l > r -> "push"    equal -> "noop"
```

Two numbers and one comparison — no special-casing. It falls out that:

| localStamp | remote | result | why it's right |
|---|---|---|---|
| absent (fresh seed) | exists | `pull` | Trap 1: the seed never beats a real library |
| absent | `null` | `push` | first ever setup bootstraps KV from the seed; nothing to lose |
| stamped | `null` | `push` | KV empty or wiped |
| stamped newer | older | `push` | local edit wins |
| older | newer | `pull` | Hermes edit wins |
| identical | identical | `noop` | in sync; **must not push** — polling would thrash KV |

A non-parseable remote `updatedAt` yields `-1`, i.e. `push` — garbage remote data gets
overwritten rather than freezing sync forever.

```js
/**
 * Is there an outstanding "generate a new plan" request?
 * @param {{requestedAt: string, ackedAt: string|null}|null} flag  GET /planFlag body
 * @param {string|null} localAckedAt  localStorage["mp_hermes_plan_acked"]
 * @returns {boolean}
 */
needsPlan(flag, localAckedAt)
```

`false` when `flag` or `flag.requestedAt` is missing. Otherwise
`Date.parse(requestedAt) > max(parse(flag.ackedAt), parse(localAckedAt), -Infinity)`.
The local mirror is there purely to stop the banner reappearing during KV's ~60s
propagation window after an ack (§0).

### 3b. Config

```js
config()   -> { url: string, token: string, enabled: boolean }
saveConfig(url, token)
```

```
localStorage["mp_hermes_url"]   = "https://meal-planner-bridge.<sub>.workers.dev"
localStorage["mp_hermes_token"] = "<secret>"
```

`enabled` = both non-empty. `saveConfig` trims and strips a trailing `/` from the URL —
otherwise every request hits `//library` and 404s.

**Security note, stated so it isn't rediscovered later:** the token sits in
`localStorage` on a public origin, so any XSS on this app leaks it. That is exactly what
the `esc()`-everything invariant in `CLAUDE.md` protects, and it's why `line.meals`-style
untrusted TheMealDB strings must keep going through `MP.esc()`. There is no safer place
to put it in a static no-backend app; the mitigation is rotation
(`npx wrangler secret put AUTH_TOKEN` + re-enter in the app), not architecture.

### 3c. Network

One private helper, everything else on top of it:

```js
/** @throws on non-2xx or network failure. @returns parsed JSON, or null for 204. */
async function req(method, path, body)   // sets X-Auth-Token + Content-Type
```

```js
/** GET /library, decide, then apply. Resolves to "pull"|"push"|"noop"|"off"|"error". */
async syncLibrary()

/** GET /planFlag. Resolves to the flag object, or null. */
async syncPlanFlag()

/** PUT /planFlag with the requestedAt we actually saw. */
async ackPlanFlag(requestedAt)
```

`syncLibrary()` sequence — the re-read is the whole race fix:

1. `config().enabled` false ⇒ `"off"`, no fetch.
2. `inflight` already true ⇒ return immediately. Module-level boolean, `finally`-cleared.
3. `const remote = await req("GET", "/library")`.
4. **Re-read `MP.libraryStamp()` now** and call `decide()` with that value — not one
   captured before the await. If the user added a meal while the GET was in flight, the
   decision flips from `pull` to `push` and their edit survives.
5. `"pull"` ⇒ `MP.applyRemoteLibrary(remote.meals, remote.updatedAt)`, then
   `window.dispatchEvent(new Event("mp:library-pulled"))`.
   `"push"` ⇒ `req("PUT", "/library", { updatedAt: <local stamp, or now if unstamped>,
   meals: <current library> })`, stamping the same value locally when it was unstamped.
   `"noop"` ⇒ nothing.
6. Any throw ⇒ caught, resolves `"error"`. **Sync never throws into page init.**

`ackPlanFlag(requestedAt)` PUTs `{ requestedAt, ackedAt: new Date().toISOString() }` —
echoing back the `requestedAt` it *saw*, so a newer request that landed in between is not
silently acked — and writes the same `ackedAt` to
`localStorage["mp_hermes_plan_acked"]`.

### 3d. `start()` — poll triggers

```js
/** Wire triggers and run an initial sync. Safe to call when sync is not configured. */
start()
```

- `window.addEventListener("mp:library-saved", syncLibrary)` — push on every local edit.
- `document.addEventListener("visibilitychange", ...)` firing `syncLibrary()` when
  `document.visibilityState === "visible"`. `visibilitychange` rather than `focus`: this
  is an installed Android PWA, and it's the event that actually fires on app resume.
- One immediate `syncLibrary()` call.

No debounce and no retry/backoff. The `inflight` guard plus the fact that both triggers
are human-paced is enough. `ponytail:` comment naming that ceiling; the queue/backoff
upgrade path goes in `docs/FUTURE.md`, not in this file.

**Loading `hermes-sync.js` must have zero effect when unconfigured** — it only reads
`localStorage` at load; `start()` is called by the page controller, never at module
scope. That is what lets `test.html` include it safely.

---

## 4. Pages that include it

| Page | Includes `hermes-sync.js`? | Why |
|---|---|---|
| `index.html` | yes | library UI + the settings section lives here |
| `plan.html` | yes | the planFlag banner lives here |
| `shopping.html` | **no** | derives from an already-generated plan; adding sync there buys nothing and costs a script + a poll |

Deliberate, not an oversight — say so in a comment if it looks like one.

**`sw.js` needs no change for the Worker calls themselves**: its fetch handler already
returns early for `url.origin !== location.origin` and for non-`GET` methods, so Worker
traffic passes straight through and is never cached. Do not "fix" this.

---

## 5. `index.html` + `app.js` — the sync settings section

Appended as the last `<section class="section">` in `<main>`, after Discover.

```html
<section class="section">
  <details id="sync-settings">
    <summary>Hermes sync</summary>
    <p id="sync-status" class="muted">Not set up</p>
    <label class="sync-field">Worker URL
      <input type="url" id="sync-url" placeholder="https://....workers.dev">
    </label>
    <label class="sync-field">Secret token
      <input type="password" id="sync-token" autocomplete="off">
    </label>
    <button id="sync-save" class="btn">Save &amp; sync now</button>
  </details>
</section>
```

- Native `<details>` for the collapse — same as Phase 3's staples group, no accordion JS.
- `type="password"` on the token so it isn't shoulder-surfed or caught in a screenshot.
- Inputs are populated from `config()` on load via `.value` (never `innerHTML`).

`app.js` wiring, in `init()` after the existing library render:

- Fill both inputs from `MP.Sync.config()`.
- `#sync-save` click ⇒ `MP.Sync.saveConfig(url, token)` then `MP.Sync.syncLibrary()`, and
  render the result into `#sync-status`.
- `window.addEventListener("mp:library-pulled", ...)` ⇒ re-`MP.getLibrary()` and
  `renderLibrary()`, so a Hermes-side change appears without a manual refresh.
- `MP.Sync.start()` — **not awaited**. Page render must never wait on the network.

Status strings, written with `textContent`:

| State | Text |
|---|---|
| not configured | `Not set up` |
| in flight | `Syncing…` |
| `pull` | `Pulled library from Hermes` |
| `push` | `Pushed library to Hermes` |
| `noop` | `In sync` |
| `error` | `Sync failed — check the URL and token` |

No error detail is surfaced beyond that: the two realistic causes are a wrong token
(401) and a typo'd URL, and both are fixed in the same two boxes.

---

## 6. `plan.html` + `plan.js` — the planFlag banner

```html
<div id="hermes-banner" class="banner hidden">
  <span>Hermes asked for a new plan</span>
  <button id="hermes-generate" class="btn">Generate</button>
</div>
```

Directly inside `<main>`, above the plan grid. Static text — nothing interpolated, so
nothing to escape.

In `plan.js` `init()`, after the existing `renderPlan()` (fire-and-forget, not awaited):

```
MP.Sync.start()
MP.Sync.syncPlanFlag() -> flag
  MP.Sync.needsPlan(flag, localStorage["mp_hermes_plan_acked"]) ?
    unhide #hermes-banner, remember flag.requestedAt
  : leave hidden
```

`#hermes-generate` click:

1. `plan = generatePlan(); savePlan(); renderPlan();` — the existing three lines,
   **without** the `confirm()`. Tapping the button *is* the confirmation; a second
   dialog on top of a banner you deliberately tapped is noise.
2. `MP.Sync.ackPlanFlag(requestedAt)`.
3. Hide the banner, `toast("Plan regenerated by Hermes request")`.

The existing Generate button keeps its `confirm()` — unchanged.

If `syncPlanFlag()` errors or sync is unconfigured, the banner simply never appears. No
error UI on this page; `index.html` owns sync status.

### Edge cases

| Case | Behaviour |
|---|---|
| Sync not configured | `start()` and `syncPlanFlag()` no-op; both pages behave exactly as they do today |
| Worker unreachable / offline | Status shows the error on `index.html`; no banner; no retry. Everything else works from the SW shell |
| `planFlag` never written | `GET` returns `null` ⇒ `needsPlan(null, …)` is `false` |
| Flag acked, page reloaded inside KV's ~60s window | Local `mp_hermes_plan_acked` suppresses the banner (§0) |
| Remote `meals` is `[]` (Hermes cleared the library) | Pulled as-is — an empty library is a legitimate state, not an error. `renderLibrary()`'s existing empty handling covers the UI |
| Remote blob missing `meals` | `decide` still returns `pull` on timestamp, so guard the apply: no `meals` array ⇒ treat as `noop` and don't wipe the local library |

---

## 7. Verification

### 7a. `test.html` (TDD — write the check first, watch it fail)

Add `<script src="hermes-sync.js"></script>` to the existing includes. Literal fixtures
only; never call `syncLibrary`, `config` or anything that touches the network.

1. `decide(null, {updatedAt:"2026-09-01T00:00:00Z", meals:[]})` ⇒ `"pull"` — *the Trap 1
   check; it fails if anyone makes an unstamped local library push.*
2. `decide(null, null)` ⇒ `"push"` (first-ever bootstrap).
3. `decide("2026-09-02T00:00:00Z", null)` ⇒ `"push"`.
4. `decide("2026-09-02T00:00:00Z", {updatedAt:"2026-09-01T00:00:00Z", meals:[]})` ⇒ `"push"`.
5. `decide("2026-09-01T00:00:00Z", {updatedAt:"2026-09-02T00:00:00Z", meals:[]})` ⇒ `"pull"`.
6. Identical timestamps ⇒ `"noop"` — *fails if polling ever starts pushing on every tick.*
7. `decide("2026-09-01T00:00:00Z", {updatedAt:"not a date", meals:[]})` ⇒ `"push"`.
8. `needsPlan(null, null)` and `needsPlan({}, null)` ⇒ `false`.
9. `needsPlan({requestedAt:"2026-09-03T10:00:00Z", ackedAt:null}, null)` ⇒ `true`.
10. Same flag with `ackedAt` **after** `requestedAt` ⇒ `false`.
11. Same flag, `ackedAt: null`, but `localAckedAt` after `requestedAt` ⇒ `false` — *the
    KV-propagation suppression; this is the check that stops the banner flickering back.*
12. Flag with a `requestedAt` newer than both acks ⇒ `true` (a second request after an ack).

### 7b. Worker — `wrangler dev` + curl

No test framework (`CLAUDE.md`: don't invent one). Run `npx wrangler dev` in `worker/`
and hit the local URL. Expected results are the assertion:

| # | Request | Expect |
|---|---|---|
| 1 | `GET /library` no header | `401` |
| 2 | `GET /library` wrong token | `401` |
| 3 | `OPTIONS /library` no token, `Origin:` + `Access-Control-Request-Headers: x-auth-token` | `204` + all four CORS headers |
| 4 | `GET /nope` valid token | `404` |
| 5 | `DELETE /library` valid token | `405` |
| 6 | `GET /planFlag` before any write | `200`, body `null` |
| 7 | `PUT /library` `{"updatedAt":"2026-09-03T00:00:00Z","meals":[]}` | `204` |
| 8 | `GET /library` | `200`, byte-identical to what was PUT |
| 9 | `PUT /library` body `not json` | `400` |
| 10 | `PUT /library` body `[1,2]` | `400` — *array is not an object; this is the guard Gate 1 kept* |
| 11 | Every response above | carries `Access-Control-Allow-Origin` |

Then deploy and repeat 1, 3, 7, 8 against the live `*.workers.dev` URL once.

Not writing a `worker/smoke.sh`: this is a deploy-once backend. Add the script if you
find yourself redeploying often enough to retype these.

### 7c. Manual pass (UI + real network, cannot be asserted here)

Serve the app, paste the Worker URL and token into the sync section, Save & sync now —
status reports a push or pull; swipe-add a meal and confirm the status/second device
reflects it; `curl` a `planFlag` with a fresh `requestedAt`, reload `plan.html`, confirm
the banner appears, tapping it regenerates and the banner does not return on reload;
confirm all three pages still render offline after one visit.

---

## 8. Wiring

**`worker/`** — new directory: `wrangler.toml`, `worker.js`. `.gitignore` gains
`.wrangler/`.

**`index.html` script includes** — add before `app.js`:

```html
<script src="hermes-sync.js"></script>
```

**`plan.html`** — same, before `plan.js`. **`shopping.html` — not added** (§4).

**`sw.js`** — add `"hermes-sync.js"` to `SHELL` **and bump `CACHE` to
`"meal-planner-v4"`**. Without the bump, installed PWAs keep serving the v3 shell and
never fetch the new file. `test.html` stays out of the shell, as do the `worker/` files —
they are not app assets and are never served from this origin.

**`style.css`** — `#sync-settings`, `.sync-field`, `.banner`. Reuse the existing card /
`.btn` / `.muted` tokens and the Phase 3 `<details>` styling; dark mode is the default and
gets styled first. `.hidden` already exists.

**Stale doc references, fixable now that this phase exists** —
`docs/ARCHITECTURE.md` calls the bridge "(new, Phase 2)" and `docs/FUTURE.md`'s
library-export entry says "Phase 2's Hermes bridge". Both predate the roadmap split; both
are Phase 4. One-line fixes, and they clear the note carried in Phase 2's deferred list.

**No changes to** `generator.js`, `nutrition.js`, `shelf-life.js`, `shopping-list.js`,
`shopping.js`, `meals.json`, or the plan/meal schemas. The library array shape on the
wire is exactly the shape in `localStorage`, which is exactly `meals.json`'s.

---

## 9. Out of scope / notes for later

- **No new dependency.** `fetch`, `localStorage`, `<details>`, `visibilitychange` and
  Workers' built-in KV binding are all native. Wrangler is invoked with `npx`, not
  installed or committed.
- **Not built, deliberately:** offline write queue, retry/backoff, conflict UI, per-meal
  merge, sync of the plan itself or of `mp_shopping_ticked`, a settings page, multi-device
  presence, any endpoint beyond the two keys.
- **`docs/FUTURE.md` entries to add once this ships:** (a) offline edits are lost to
  last-write-wins — an edit made offline is silently overwritten by any newer remote
  write, and the fix is a queued push with retry, not a smarter `decide()`; (b) there is
  no conflict UI — the app never tells you it discarded a local version.
- **Phase 5 depends on this and must not widen it.** The conversational layer talks to
  these same two endpoints. If it needs a third key, that is a Phase 5 decision made
  against the `KEYS` allowlist deliberately — not a drive-by addition.
