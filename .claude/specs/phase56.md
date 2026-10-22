# Phase 56: Hermes contract rewrite and tool parity [M]

Plain: One accurate, test-enforced list of every Worker route, and a rewritten `docs/HERMES.md`, so Hermes and the assistant can't be told about a route that doesn't exist or miss one that does; Hermes's own edits can now show up in the Assistant activity list with Undo.

Requires Phase 48 (built: `ITEMS`/`logWrite`/`undoActivity`, `worker/worker.js`). Phases 49 and 55 are queued and add routes: if they build first, their builders add `ROUTES` entries (the probe test names the gap); if this builds first, they must add theirs to pass. Assistant side is `notion_assistant` Phase 89 (not started): nothing here waits on it.

## Decisions
- **Hermes writes opt into the log with `X-Actor: hermes`** (user-chosen). Hermes and the app share `AUTH_TOKEN`, so the token alone can't tell them apart. A Hermes-token write sending that header is logged as `who: "hermes"` and can be dry-run/undone like an assistant write; without it (the app) nothing is logged. A fourth caller of the logging condition is not added: the one `logIt` check and `putMealMethod`'s `who` both take a single `actor` value computed once in `fetch`. Undo `who`/`force` rules stay as they are (`force` is the app's call: never when `actor` is set).
- **The Worker owns the list** (own call): `export const ROUTES` in `worker/worker.js` (one row per method+path) is the source; `worker/routes.json` is generated from it by `node tools/routes_build.mjs` and committed. No parsing of source text.
- **Drift test probes the real Worker** (own call): for every row, call it with the Hermes token and assert the status is not 404/405 (the route exists for that method); for every row without `assistant: true`, the assistant token gets 403. For every method NOT in a path's rows, the Worker must answer 405/403/404 (no unlisted method works). Reverse direction: every `"/literal"` path string in `worker.js`'s `KEYS`, `ASSISTANT_ALLOWED` and `url.pathname ===` checks must appear in `ROUTES`, and `routes.json` must equal `ROUTES` serialised. A new route with no row fails the test.
- **"Covered by Phase 48"** (own call, honest scope): each write row carries `log`: `"logged"` (key in `ITEMS`; computed from `ITEMS` for the `KEYS` routes so it can't drift), or `"unlogged"` with a mandatory `why` string (app-owned mirrors `/plan` `/prefs` `/eaten-log` `/planPrefs` `/cooks` are app-side; `/drafts`, rating, `/settings` are inert/informational or profile data). Test: every write row is `logged` or has a non-empty `why`. This phase does not widen logging to the unlogged ones.
- **Old raw PUTs stay** (`/planFlag`, `/library`, `/pantry`, ...): rows get `appSide: true` where the app is the main caller; HERMES.md says Hermes uses them too but with `X-Actor` + `X-Reason` so they're logged.
- **Contract doc is rewritten, not patched** (own call): `docs/HERMES.md` becomes tables generated-by-hand from `routes.json` groupings (read-only / writes / queues) plus the existing prose for shapes that are still right (`/discover`, `/library`, `/pantry` qty, `/products`, `/plan`, `/placements`, `/shopping`, `/eat-requests`). Covers every row; keeps the "no secrets committed" and KV-eventual-consistency warnings; adds the routes it lacks today (`/day`, `/why`, `/scale`, `/ratings`, `PUT /meal/:id/rating`, `/drafts`, `/settings`, `/activity`, `/activity/undo`, `/meal-method`, `GET /meal/:id/method`, `/dayHints`, `/today`, `/expiring`, `/ranking`, `/nutrition`, `/product-ranking`) and a dry-run/undo section. Read each route's handler for the real request/response/errors before writing its entry; do not invent shapes.

## Files touched
`worker/worker.js` (`export const ROUTES`, `actor` + CORS header `X-Actor`; the Worker needs no shim change: only an export is added), `worker/routes.json` (new, generated), `tools/routes_build.mjs` (new), `tools/worker_test.mjs` (drift + actor cases), `docs/HERMES.md` (rewrite), `docs/ARCHITECTURE.md` (one line: where the route list lives). No site file, no `sw.js` bump. New file names checked free: `routes_build.mjs`, `routes.json`.

## Signatures / schemas
```
ROUTES row: { method, path, assistant: bool, kind: "read" | "write" | "queue",
              dryRun?: true, log?: "logged" | "unlogged", why?: string, appSide?: true, note?: string }
path params as ":id" (/meal/:id/method, /meal/:id/rating, /drafts/:id); the test substitutes "x".
fetch(): const actor = isAssistant && !isHermes ? "assistant" : isHermes && X-Actor === "hermes" ? "hermes" : null;
CORS Allow-Headers += X-Actor.      // logWrite who: actor; X-Reason still carries the why
```

## Edge cases
- `X-Actor` with any other value, or on the assistant token, is ignored (assistant stays `"assistant"`). Preflight allows the header.
- A Hermes write that fails validation logs nothing (same as today). `?dryRun=1` works for Hermes too and logs nothing.
- Path-param routes: probe with an id that doesn't exist; 404 "unknown meal/draft" must not count as "route missing": the probe distinguishes by body (`"not found"` from the dispatcher vs a handler's own message).
- Phase 49/55 rows absent while those phases are unbuilt: fine, the test only requires rows for routes that exist.

## Verification
- `node tools/routes_build.mjs && git diff --exit-code worker/routes.json` (routes.json is the committed output of the Worker's `ROUTES`)
- `node tools/worker_test.mjs` (new cases: drift probe passes; a stub route added to a copy of the dispatcher with no row fails the reverse scan, via the test's own fake source string; Hermes + `X-Actor: hermes` PUT `/pantry` writes one activity entry `who: "hermes"` and Undo restores it; the same PUT without the header writes none; assistant token with `X-Actor: hermes` still logs `"assistant"`)
- `python3 check.py`
- No real credential needed: the harness uses fake tokens (`h`, `a`).

## Tasks
Logic (TDD):
- [ ] `worker_test.mjs` first: actor cases above, then the drift probe (fails until `ROUTES` exists)
- [ ] `fetch()` computes `actor`; `logIt`, `putMealMethod`, undo `who` use it; CORS header
- [ ] `export const ROUTES` covering every current route (compute `KEYS` rows and `log` from `KEYS`/`ITEMS`/`ASSISTANT_ALLOWED` where possible); `tools/routes_build.mjs` writes `worker/routes.json`
- [ ] Reverse-scan + method-matrix assertions in `worker_test.mjs`
Docs:
- [ ] Rewrite `docs/HERMES.md` from `routes.json` + handlers; ARCHITECTURE.md line
