# Phase 72: Planning chat with Hermes (guided, animated) [L]
Plain: Plan the fortnight by chatting with Hermes one day at a time ("I'm wrecked Monday, money's tight") and watch the affected meals re-pick in front of you.

Requires Phase 69 (`renderDeck`, queued before this). Fallback if `renderDeck` is absent: tapping a slot opens today's swap
picker. Phases 24 (shipped), 29 (done), 49 and 66 (built, live checks pending) are met; their symbols are named below.
Build in the section order of the Tasks list; commit once, at the end.

## Decisions

**User-chosen (2026-10-23, this plan)**
- **The chat thread lives in a Durable Object, not KV.** KV is eventually consistent and caches polled reads up to ~60 s
  (HERMES.md already says so), which a ~1 s chat poll can't live with. One SQLite-backed DO class `ChatRoom`, one instance
  (`idFromName("plan")`), holding the current session only. KV stays the store for everything else. ADR: `docs/ARCHITECTURE.md`
  "v11 - planning chat (Phase 72)".
- **A bridge script in this repo makes Hermes answer.** `tools/hermes_chat_bridge.py` (stdlib only) runs on the PC, polls
  `GET /chat`, calls `hermes -z "<prompt>" chat` once per user message and posts the reply. Nothing on Hermes' side polls the
  Worker today, and its cron is inert.

**Already decided in the roadmap:** Hermes returns constraints and edits, never meals. The app's generator picks meals.
Offline falls back to `plan-with-me.html`. Free wording. Hermes leads, one question at a time. Replies are validated against
a fixed set of edit types. Exclusions, allergies and `never` are enforced in code. There's a typing indicator, and abandoning
the flow is stateless through `guidedActive`.

**Own calls**
- **Edit types (the fixed set):** `busy {day}`, `free {day}`, `noCook {day}`, `chip {id, days?}`, `budget {perWeek, days?}`,
  `lock {day, slot}`, `unlock {day, slot}`, `reroll {day, slot?}`. `day` is 1–14, `slot` is one of `SLOT_TYPES`, and `chip.id` must be a
  chip id in `plan-preferences.json` (`chips[].id` plus `candidates.protein.chip.id`). `days` defaults to the day card in focus.
  `noCook` maps to a busy day (quick effort preferred). `ponytail:` no "leftovers only" mode; add one if busy proves too loose.
- **One validator, two callers.** `MP.PlanChat.validateReply` (`plan-chat.js`, `window` → `root` shim) runs in the Worker
  on `POST /chat/reply` and again in the app before anything is applied. Unknown types and bad fields are dropped. The Worker
  answers `{ id, dropped }`, and the bridge re-asks Hermes once ("use only these types") when `dropped > 0`.
- **Constraints are session-scoped, never stored.** `chatPrefs` (busy/free/noCook days, per-day chip ids, per-day budget)
  piles up in memory for the session and is merged over `basePrefs` as the `override` for each re-pick. Same rule as Phase 65's
  `useUp`: never written to `mp_planPrefs`. Chips and budget are global in the generator, so they're made per-day by
  re-picking only the target days with every other slot held (Phase 66 `lockedMap(exceptDays)`, the `rerollDay` path).
- **The re-pick reuses the existing path.** `generatePlan(override, lockedMap(days))` (`plan.js`), then copy only the slots
  of `days` into the working plan. There's no new ranking code. `rankSlot` stays the one ranker.
- **The diff reuses Phase 49's change shape, not its transport.** Edits arrive in the chat reply and the generator runs in
  the app, so `planDraft` KV isn't involved. Each changed slot `{ day, slot, before, after }` shows highlighted with
  Accept / Reject. Reject restores `before` in the working plan. Accept is the default, so un-rejected changes stand at Save
  ("pick for me").
- **The "understood" line is app-written:** `MP.PlanChat.describe(validEdits)` ("Monday: quick meals, Thursday: under £3").
  It's built from what will actually apply, so it can't misreport. Hermes's reply text sits above it.
- **The staged animation reuses Phase 29's CSS:** the chat's day card is rendered with the existing `.slot-card` markup
  inside a container with the `staging` class. `renderPlan(staged)` and its invariant are untouched.
- **The thread lives in the DO; Hermes is called statelessly.** The bridge puts the last 12 messages and the app-sent
  `context` into each prompt, so "make that one quicker" resolves against what was just said.
- **Request budget (free tier: 100k Worker requests a day):** the app polls `GET /chat` once a second only while waiting for a
  reply (gives up after 90 s and offers "Continue without Hermes"). The bridge polls every 1 s while `openAt` is under 10 min old,
  and every 10 s otherwise (about 8.6k a day). Both intervals are constants at the top of the script.
- **Offline detection:** the bridge's polls send `X-Actor: hermes`, and the DO stamps `bridgeSeenAt`. When the open response's
  `bridgeSeenAt` is missing or over 30 s old, the app toasts "Hermes is offline" and goes to `plan-with-me.html`.
- **Entry:** a new "Plan with Hermes" button (`#plan-chat-btn`) next to `#plan-with-me-btn` on `plan.html`, or `plan.html?chat=1`.
  The working copy starts from the current plan (no regenerate).

## Files touched
- `plan-chat.js` (new, shim'd like `exclusions.js`): `validateReply`, `toOverride`, `describe`, plus the DOM/relay code inside
  functions that only run when `document` exists. Loaded by `plan.html` only, before `plan.js`. Imported by `worker/worker.js`.
- `worker/worker.js`: `export class ChatRoom`, routes `POST /chat`, `GET /chat`, `POST /chat/reply` in `ROUTES` (not in
  `ASSISTANT_ALLOWED`, `log: "unlogged"` with a why: ephemeral chat), dispatch to the DO. `worker/routes.json` regenerated
  by `node tools/routes_build.mjs`.
- `worker/wrangler.toml`: `[[durable_objects]] bindings = [{ name = "CHAT", class_name = "ChatRoom" }]` and
  `[[migrations]] tag = "v1"`, `new_sqlite_classes = ["ChatRoom"]` (SQLite backend is what the free plan allows).
- `plan.html`: `#plan-chat-btn`, the full-screen `<section id="plan-chat" hidden>` (day card host, Prev/Next, log, input
  `maxlength=300`, typing indicator, diff list, Save / Exit), and `<script src="plan-chat.js">` before `plan.js`.
- `plan.js`: `?chat=1` / button entry sets `guidedActive = true`, `applyChatEdits`, `chatContext`, Save/Exit. Existing:
  `generatePlan` (l.140), `lockedMap` (l.234), `rerollDay` (l.257), `setSlotMeal` (l.338), `planMetrics` (l.154),
  `guidedActive` (l.617), `renderDeck` (Phase 69).
- `style.css`: `.plan-chat` full-screen layout, chat bubbles, `.chat-understood`, `.chat-typing` (three dots, static under
  reduced motion), `.slot-diff` highlight. Both themes, 390 px. Tokens from `docs/UI_STYLE.md`.
- `sw.js`: add `plan-chat.js` to the cache list, bump `CACHE`.
- `tools/hermes_chat_bridge.py` (new) and `tools/test_hermes_chat_bridge.py` (new). `check.py`: one `yield` line for the test.
- `tools/worker_test.mjs`: an in-memory fake `CHAT` namespace (`idFromName` → one stub whose `fetch` calls a real `ChatRoom`
  with a Map-backed `ctx.storage`).
- `tools/browser-check/walk.mjs`: chat walk with `page.route` mocking `/chat`.
- `docs/HERMES.md`: a `## Planning chat (/chat)` section (routes, reply shape, edit types, the "never meals" rule).
- `docs/ARCHITECTURE.md`: "v11 - planning chat (Phase 72)" ADR, and the KV schema intro notes the one DO.
- `CLAUDE.md`: an invariant line under Architecture invariants: chat edits are constraints only, validated by
  `MP.PlanChat.validateReply` in both Worker and app; `chatPrefs` is never stored; the `ChatRoom` DO holds only the chat
  session; plan state stays in `localStorage`/KV.
- `docs/roadmap.md`: Phase 72 heading marked on completion (roadmap-gating).

## Signatures / schemas
```
// plan-chat.js (MP.PlanChat)
validateReply(raw, vocab) -> { reply: { text, edits, ask }, dropped: number }   // text trimmed to 500, edits filtered
toOverride(edits, chatPrefs, focusDay) -> { chatPrefs, days: number[], locks: [{day,slot}], unlocks: [{day,slot}] }
describe(edits, startDate) -> string                                            // weekday names from startDate

// plan.js
applyChatEdits(edits) -> changes: [{ day, slot, before, after }]   // mutates the working plan only; no savePlan
chatContext(day) -> { day, startDate, dayMeals: {slot: name}, gaps: string[3], proteinG, weekCost, budgetTarget, expiring: string[] }
                    // from planMetrics + MP.ShoppingList.useUpItems; names only

// ChatRoom storage: "s" -> { session, openAt|null, bridgeSeenAt|null, messages: Msg[] (cap 40, oldest dropped) }
Msg = { id, at, from: "user"|"hermes", text, day?, context?, edits?, ask?, open? }
```
Routes (Hermes token; the assistant token gets 403):
- `POST /chat` `{ session, open: true, context }` resets the thread, sets `openAt` → `{ session, bridgeSeenAt }`.
  `{ session, text, day, context }` appends a user message → `{ id }`. `{ session, close: true }` sets `openAt = null`.
  Wrong session → `409`. Empty/over-300 text → `400`.
- `GET /chat?session=&since=<id>` → `{ session, openAt, messages }` (after `since`). With `X-Actor: hermes` it stamps
  `bridgeSeenAt`, and `session` is optional (returns the current one).
- `POST /chat/reply` (requires `X-Actor: hermes`, else `403`) `{ session, replyTo, text, edits, ask }` → validates →
  `{ id, dropped }`.

Bridge: `python3 tools/hermes_chat_bridge.py [--once] [--responder "cmd {prompt}"]`. It reads `MP_WORKER_URL` and
`MP_AUTH_TOKEN` from the environment or `.env`. The responder runs as an argv list (no shell). It parses the last `{...}` JSON
block of stdout. Unparseable output posts a "Sorry, could you say that another way?" reply with no edits. The `open`
message prompts an opener: one short question, using the context's gaps, expiring items or over-budget week.

## Edge cases
- Hermes text is untrusted: rendered with `textContent` only. User text too.
- A valid edit naming a locked or eaten slot: `lock` is a no-op, and a `reroll` of a held slot is skipped with "That one's
  locked".
- An edit whose re-pick returns the same meal: no diff row, and the understood line still shows.
- `ask: true` with edits: show the question and apply nothing (the clarifying question wins).
- All edits dropped twice: the bridge posts "I didn't follow, could you put it another way?" and the app applies nothing.
- A reply for an old session or `replyTo`: the Worker 409s it, and the app ignores replies to messages it didn't send.
- Exit mid-request: `POST /chat {close}`, discard the working copy, `mp_plan` byte-identical.
- No token set (`mp_hermes_token` empty): the button goes straight to `plan-with-me.html`.
- A re-pick can never offer an excluded meal: it goes through `generatePlan` → `rankSlot` → `MP.Exclusions`. Deck takes go
  through `setSlotMeal`.

## Verification
- `python3 check.py` passes (all lines, including the new bridge test and `worker`).
- `node tools/worker_test.mjs`: open → message → reply with one bogus edit gives `dropped: 1`. `GET since` returns only newer
  messages. The assistant token gets 403 on all three routes. A reply without `X-Actor` gets 403. A stale session gets 409.
  Over-300 text gets 400. The message cap is 40.
- `python3 tools/test_hermes_chat_bridge.py`: `parse_reply` (clean JSON, JSON after chatter, garbage → fallback),
  `build_prompt` (has the edit types, the last 12 messages, the context), `poll_interval` (1 s active, 10 s idle), and `--once`
  against a stub responder and a stub HTTP server (stdlib `http.server` on port 0).
- `test.html` group 72: `validateReply` drops an unknown type, day 15, a bad slot and an unknown chip id, and caps text.
  `toOverride` maps noCook → busy and defaults days to focusDay. `describe` uses weekday names.
- `walk.mjs` chat walk (PC and 390 px, dark and light), `/chat` mocked: open → type "no cooking Sunday" → the mocked reply
  `[{type:"noCook",day:7}]` changes only day 7's slots, with diff rows shown. Reject one → that slot is back to before. Exit →
  `mp_plan` byte-identical. Again with Save → `mp_plan` changed. A mocked old `bridgeSeenAt` lands on `plan-with-me.html`. A
  mocked `ask:true` reply shows the question and changes nothing.
- No real credential is needed: tests use fake tokens, a stub responder and a mocked `/chat`.

## Tasks

### Logic (TDD)
- [x] `plan-chat.js`: `validateReply`, `toOverride`, `describe` with the shim; test.html group 72 first
- [x] `worker/worker.js`: `ChatRoom` DO plus the three routes and the `ROUTES` rows; `wrangler.toml` binding and migration;
      `worker_test.mjs` fake namespace and cases; `node tools/routes_build.mjs`
- [x] `plan.js`: `applyChatEdits` (lock/unlock on the working plan, `generatePlan(override, lockedMap(days))`, copy target
      days, return changes) and `chatContext`; unit-assert in test.html that a noCook edit changes only that day
- [x] `tools/hermes_chat_bridge.py` plus its test; `check.py` yield line

### UI (ui-build skill)
- [x] `plan.html` section and button, script order; `plan.js` entry (`?chat=1`), session open, offline fallback, day stepping,
      send → poll → typing indicator → reply bubble + understood line → staged day card → diff rows with Accept/Reject;
      slot tap → `renderDeck` (3 cards) with "Pick for me"; Save (`guidedActive = false; savePlan()`) and Exit
- [x] `style.css` for the chat screen, both themes, 390 px, reduced motion; `sw.js` cache list and `CACHE` bump
- [x] `walk.mjs` chat walk; screenshots checked at PC and 390 px in both themes

### Docs
- [x] `docs/HERMES.md` chat section; ARCHITECTURE v11 ADR; CLAUDE.md invariant line; roadmap heading (roadmap-gating)
