# Phase 109: Hermes on every page, live edits, search-and-log in Browse [L]

Plain: A bar at the bottom of every page lets you talk to Hermes any time, and small changes it makes (swap, skip, rate) appear on the screen you're on with an Undo; Browse can also log any meal or food you search for.

## Decisions

User-chosen (planning gates, 2026-10-29):
- **One bar, Log/Ask toggle.** `ate-box.js`'s "I ate" bar stays as **Log** mode, unchanged. A toggle adds **Ask** mode = Hermes. No second bar.
- **Live for small edits, cards for big ones.** Live (applied at once, snapshotted, Undo toast): `skip`, `out`, `swap`, `swapDay`, `backfill`, `sub`, `rate`, and a `place` of a library meal into a slot. Everything else (`start`/regenerate, `mealCreate`/`mealEdit`/`mealRemove`, `budget`, `bulk`, `cheaper`, `freeze`, `note`) is **not** offered to the bar: Hermes is told to say "open Plan with me for that" and the bar shows a link.
- **Browse finds library meals + loose foods**, each with an Eat button; multi-ingredient filter for meals.
- The user doesn't mind waiting: no streaming, no timeout UX beyond a "Hermes is thinking" state and the existing 90 s give-up.

Own call:
- **Reuse the existing chat transport, not the plan chat UI.** `plan.js`'s chat is a working-copy/Save/Exit session tied to `guidedActive`; the bar is not. The bar is a new small module `bar-chat.js` (`MP.BarChat`) that speaks the same `POST /chat` / `GET /chat` / `/chat/reply` protocol (`MP.PlanChat.call`, `plan-chat.js`) with `open` context `{ mode: "bar", brief }`. `plan.js` chat is untouched.
- **One ChatRoom DO, one session at a time** (`idFromName("plan")`). Opening a Plan chat replaces the bar's session; the bar answers a 409 by re-opening a session on the next send. No Worker change to session handling.
- **Edits go through the existing appliers, never new ones:** `MP.applyPlanEdits` (`data.js`, plan edits), `MP.placeSlots` (`data.js`, same hard checks, refusals shown), `MP.Sync.pushRating` (rate). Hard exclusions/profile terms (`MP.Exclusions.check`, `MP.Sync.hardTerms()`) apply exactly as in plan chat. `validateReply` runs in the Worker and again in the bar before anything applies; the bar then drops any type outside its live set.
- **Realtime = the existing event.** The bar snapshots (`mp_planUndo`, same one-level snapshot as `MP.Plan.snapshot`), writes `mp_plan`, dispatches `mp:plan-saved` (this already pushes the plan mirror via `hermes-sync.js`). Pages redraw from `mp:plan-live` (dispatched by the bar right after `mp:plan-saved`): `plan.js` gains a listener that reloads `plan` from `localStorage` and calls `renderPlan()` when the event came from the bar (`mp:plan-live`) and no chat/guided session is active; Shopping re-renders its lists from it; Browse/Discover/Eaten have nothing plan-dependent to redraw except Eaten (re-reads on `mp:plan-live`). While `guidedActive` or the Plan chat is open the bar is Log-only and Ask shows "Finish planning first".
- **Briefing:** bar open sends the same `MP.Plan.chatBriefing`-style brief, but plan.js isn't loaded on other pages. Extract the *read-only* pieces the bar needs (library names/ids + tags + ingredients, today's plan slots, ratings, hard terms) into `MP.BarChat.brief()` built from `MP.getLibrary()`, `localStorage` `mp_plan`, `MP.Ratings.get()`, `MP.Sync.hardTerms()`. Not a copy of `chatBriefing`: no cooks/bulk/cheaper/fridge.
- **Ingredient questions:** structured ("chicken + rice") is Browse's local AND filter (instant, offline). Conversational ("what's quick with leftover chicken?") goes to Hermes, whose briefing carries each meal's ingredient keys; it answers in prose and may send a new display-only `meals` edit `{ "type":"meals", "ids":[...≤6 library ids] }` (validated against the library; unknown ids dropped) that the bar renders as tappable rows: Open (Browse sheet), Eat, Place (opens the live `place` flow only if a slot is named in the reply; otherwise no Place).
- **Browse foods:** `foodNames()` (`ate-box.js`) already lists measured foods; export it and `suggest` stay. A food Eat posts `MP.Sync.postFoodLog({ id, action:"eat", when, name, grams })` exactly as `ate-box.js` does; no grams ⇒ the Worker's needs-grams path ("Add an amount") shown inline. A meal Eat uses `MP.eatMeal(meal, whenIso, n, size)` (portion ½/1/2, Phase 104 limits). Neither touches the pantry or Cooks (Browse Eat invariant, Phase 92).
- **No new dependency, no new Worker route, no new KV key.** Worker change: add `meals` to `PlanChat.validateReply` vocab (shared file; `window` → `root` shim already in place) and `mode:"bar"` tolerated in `context` (size cap unchanged). Bridge change: a bar-mode prompt branch in `tools/hermes_chat_bridge.py` (shorter, live-set EDIT_TYPES only, "you may answer questions; edits apply at once with Undo").
- **Chat history:** the bar keeps the last ~20 messages in `sessionStorage` (per tab, cosmetic, not state) so navigating pages doesn't blank the conversation; the DO session id is also in `sessionStorage`. Losing it just opens a fresh session.

## Files touched

- `bar-chat.js` (new): `MP.BarChat` — `init`, `brief`, `send`, `poll`, `applyLive`, `renderMeals`. Plain `<script>`, uses the `window`/`root` pattern.
- `ate-box.js`: Log/Ask toggle, Ask-mode input routing, bubble/typing/thread panel; Log mode untouched. Export `foodNames` on `MP.AteBox`.
- `app.js` (Browse): multi-term AND in `MP.filterMeals` caller (see `data.js` `filterMeals`; change there, it's the one matcher, grep other callers), foods section, Eat buttons.
- `data.js`: `filterMeals` multi-term AND (split on whitespace, commas, `+`, `and`); 
- `plan-chat.js`: `meals` edit type in `validateReply` + `BAR_LIVE` set export; `worker/worker.js` unchanged unless `PLAN_VOCAB` needs the meal-id vocab for `meals` (check; it already holds library ids for `place`).
- `plan.js`: `mp:plan-live` listener → reload + `renderPlan()`. Do NOT touch the chat code.
- `shopping.js`: redraw on `mp:plan-live`. `eaten.js`: re-read on `mp:plan-live`.
- `tools/hermes_chat_bridge.py`, `tools/test_hermes_chat_bridge.py` (or the existing bridge test): bar-mode prompt + parse of `meals`.
- `style.css`: bar panel, bubbles, mode toggle (Cork Kitchen tokens, dark default, both themes, phone 390 px above the Phase 108 bottom tab bar, `visualViewport` lift like the current bar). `docs/UI_STYLE.md` unchanged unless tokens added.
- Every HTML page (`index.html`, `discover.html`, `shopping.html`, `eaten.html`, `plan.html`, `plan-with-me.html`, `test.html`): load `plan-chat.js` (where missing) and `bar-chat.js` **before** `ate-box.js`. `bar-chat.js` uses `MP.PlanChat` from `plan-chat.js`, `MP.applyPlanEdits`/`MP.placeSlots` from `data.js`: grep `*.html` for pages with `ate-box.js` but not these before finishing. `plan-with-me.html` also loads `plan-chat.js` already? Confirm with grep.
- `sw.js`: bump `CACHE` and add `bar-chat.js` to the shell list (first Logic task that edits a cached file).
- `CLAUDE.md`: add one invariant line (below). `docs/roadmap.md`, `tasks.md`.
- `tools/browser-check/walk.mjs`: click-through cases; `ui-check.mjs` already requires the ate bar per page.

CLAUDE.md invariant to add: **The docked bar's Ask mode (Phase 109, `bar-chat.js`) applies only the live edit set (skip/out/swap/swapDay/backfill/sub/rate, library `place`) through `MP.applyPlanEdits`/`MP.placeSlots`/`pushRating`, snapshotted to `mp_planUndo` first with an Undo toast; every other edit type is dropped, never a card. It never writes the pantry or Cooks, never holds plan state of its own, and yields to an open Plan chat.**

## Signatures / schemas

```
MP.BarChat.init()                                  // called by AteBox.init once Ask is first used
MP.BarChat.brief() -> { library:[{id,name,types,ingredients:[key]}], today:{day,slots}, plan:[...names per slot], ratings, terms }
MP.BarChat.send(text) -> Promise<void>             // opens/reopens session (409 -> reopen), POST /chat, polls 1 s, 90 s give-up
MP.BarChat.applyLive(reply, ctx?) -> { applied:[{type,summary}], refused:[string], undo:fn }   // ctx for tests: { plan, byId, now }
validateReply edit: { "type":"meals", "ids":[string] }   // <=6, display-only
BAR_LIVE = ["skip","out","swap","swapDay","backfill","sub","rate","place","meals"]
mp:plan-live (new CustomEvent, detail = plan): the bar dispatches it right after mp:plan-saved (which still pushes the mirror, detail unchanged).
          plan.js / shopping.js / eaten.js listen to mp:plan-live only; no existing mp:plan-saved consumer changes.
```
Consumers of `applyLive`'s return: the bar renders `applied` as a "Hermes did: …" bubble, `refused` as a muted bubble, and `undo` is wired to the Undo toast (restores `MP.Plan.restore` snapshot, unlogs any `backfilled` entries via `MP.Sync.unlogEaten`/`removeFoodEntry`, same as `adoptDirect`). `backfilled` from `applyPlanEdits` is logged with `logPortion` / `postFoodLog` by `applyLive` (log only, never `commitCook`).

## Edge cases

- Hermes offline / bridge stale (`bridgeSeenAt` older than 30 s): Ask shows "Hermes isn't answering (start tools/hermes_chat_bridge.py)", Log still works.
- No Hermes sync configured: Ask hidden, Log as today.
- Two edits on one slot, refused edits, held/locked slots, leftover-before-cook swap: handled by the shared helpers; refusals surface as text.
- Edit arrives after the user navigated: reply is applied on whichever page is open when the poll resumes; if the page changed and the bar re-inits, it resumes polling the stored session. A reply for a session that has since been replaced is dropped.
- User edits the plan by hand between send and reply: `applyPlanEdits` runs against the *current* `mp_plan`, not a stale copy; a slot that no longer matches is refused.
- Plan chat open or `guidedActive`: bar is Log-only.
- Untrusted text: every Hermes string and every food/meal name rendered via `textContent` or `esc()`.
- Empty/whitespace, >1000 chars (Worker cap), double Enter while waiting (input disabled), offline (queue nothing; show "Couldn't reach Hermes").
- Browse: query with only separators; a term matching nothing in the library but matching a food; mushrooms/egg-standalone exclusions still hide meals (Browse unchanged) — foods are not filtered by exclusions (matches Phase 102 "never filters by exclusions").
- Dark/light, 390 px with keyboard open (bar above keyboard and above the tab bar), reduced motion.

## Verification

Run: `python3 check.py` (data_check incl. sw.js bump and bar-chat.js in the shell, secrets, ui pages at PC/phone × dark/light, ui walk), `node worker/worker_test.mjs` (the `meals` edit validates, unknown ids dropped), `python3 tools/test_hermes_chat_bridge.py` (bar-mode prompt, `meals` parse). No real credential needed: tests use the in-process fake Worker/bridge responder and a fake Hermes reply.

Browser (`walk.mjs`, each its own assertion): with a fake Hermes reply fed through the Worker stub:
1. On Shopping, Ask "swap Tuesday dinner" → reply with `swap` → plan changes in `mp_plan`, shopping list redraws without reload, Undo toast restores it.
2. On Plan page, a bar `skip` redraws the grid in place; with Plan chat open the Ask mode is refused.
3. A reply carrying a `mealCreate`/`start`/`budget` edit applies nothing and shows the "open Plan with me" link.
4. A `meals` reply renders ≤6 tappable rows; an unknown id is not shown.
5. Browse: "chicken rice" returns only meals containing both; a food search result "Eat" with no grams shows "Add an amount"; with grams logs and the pantry is unchanged; meal Eat logs one portion and leaves pantry/Cooks untouched.
6. Bad input: empty Ask, 1001 chars, Hermes offline (bridge stale) → clear message, Log unaffected.
7. Phone 390 px both themes: bar above tab bar, thread scrolls, keyboard lift.

## Tasks

Logic (TDD):
- [x] `sw.js` CACHE bump + add `bar-chat.js` to the shell list (first cached-file edit).
- [x] `data.js` `filterMeals` multi-term AND + cases in `test.html`; grep every other `filterMeals` caller.
- [x] `plan-chat.js` `meals` edit in `validateReply` + `BAR_LIVE`; `worker_test.mjs` cases (valid, >6 ids, unknown ids).
- [x] `bar-chat.js`: `brief`, `send`/`poll` (reuse `MP.PlanChat.call`), `applyLive` with snapshot + Undo + backfill logging; `test.html` cases for `applyLive` using `ctx`.
- [x] `plan.js` and `shopping.js`/`eaten.js` listeners for `mp:plan-live`.
- [x] `tools/hermes_chat_bridge.py` bar-mode prompt (live-set edit types only) + bridge test.
- [x] `CLAUDE.md` invariant line; `docs/roadmap.md` heading done-marking at commit (roadmap-gating).

UI (`ui-build` skill):
- [x] `ate-box.js` Log/Ask toggle, thread panel, typing state, Undo toast; `style.css` tokens, animated, both themes, 390 px.
- [x] `app.js` Browse: foods section + Eat (portion ½/1/2 for meals, grams for foods) + multi-ingredient search hint.
- [x] Add `plan-chat.js`/`bar-chat.js` script tags to every page (grep check).
- [x] `walk.mjs` cases 1-7 above.

## Build notes
- `send` resolves with the applied reply (`{text, applied, refused, undo, other, meals}`) instead of void, so the thread UI needs no second channel; `resume()` re-polls a reply asked for before a page change.
- No Worker change needed: `context.mode:"bar"` already passes the context size check, and `meals` ids are checked against the library in the bar (the Worker has no library).
- `worker_test.mjs` does not exist; `validateReply` cases live in `test.html` (section 8b) with the `applyLive` cases.
- ponytail: no generator on non-plan pages, so a freed slot (skip drop, out) is left open for a `place` rather than auto re-picked.
- Browse meal Eat stays the existing detail-sheet Eat (portion 1/2..2 already there); only loose foods got a new Eat row.
- Pages also load `exclusions.js` and `ratings.js` (missing on eaten/plan-with-me/shopping) so `placeSlots`' hard exclusions are never skipped.
- `ate-box.js` keyboard lift now only sets inline `bottom` while a keyboard covers the page (it used to pin `bottom:0` and hid the phone tab bar behind the bar).
