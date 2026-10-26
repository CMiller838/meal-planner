# Phase 88: Hermes briefing, human chat and direct placement [L]
Plain: Hermes gets told everything about your plan and meals up front, chats normally, and puts meals into the plan itself;
new or changed meals wait for your OK.

## Decisions
User-chosen:
- **Time caps are stored**: `mp_planPrefs.timeCaps = { "0".."6": minutes }` (weekday, Sunday = 0; 5-240). Set by a chat
  `cap` edit, cleared by `cap` with `minutes: 0`. Read by the briefing (and Phase 89's over-cap flag). Generator untouched.
- **Estimated times are confirmed in chat**: the briefing sends `totalMins` when set, else `estMins` (sum of method-step
  `minutes`, flagged as an estimate). Hermes proposes `mealEdit { patch: { totalMins } }`; the user confirms on a card.
  No new meal-sheet UI.

Own calls:
- **The app builds the briefing once, at open** (`MP.Plan.chatBriefing()`, plan.js), sent as the open message's
  `context.brief`. The app is the authority (localStorage); the bridge reads the brief from the thread's open message
  every turn. The only thing the app doesn't have is `spend` (KV only): the bridge fetches `GET /spend` itself at open.
  Phase 91 notes: absent until built, so no field (fallback stated, not assumed).
- **Size limits**: `CHAT_CTX_MAX` stays 4000 for per-message context; the open message's context may be up to 60000.
  `ponytail:` the brief goes to `hermes -z` as one argv (Linux MAX_ARG_STRLEN 128 KiB). Over 60000, the app drops
  meal `description`s first, then non-dinner meals' tags. Switch to stdin if a library outgrows that.
- **Limits raised**: reply `TEXT_MAX` 500→1500, `EDITS_MAX` 20→60 (a 14-day plan is 56 slots), meal edits 3→5 per
  reply, user message 300→1000 chars, bridge `HISTORY` 12→30. The prompt drops "ONE question" and "never name meals".
  `ask` no longer blocks edits: edits apply whatever `ask` says, and `ask` only closes the tie card (as today).
- **`place` edit** `{ type:"place", day, slot, mealId, variantId? }`, applied in `applyChatEdits` (plan.js) into the
  working plan as normal `changes` (the existing per-slot Accept/Reject cards; Exit still leaves `mp_plan` untouched via
  `guidedActive`). App-side checks, each a refusal note (never a silent drop): unknown meal, meal's `mealTypes` lacks
  the slot, `MP.Exclusions.check` or `MP.Sync.hardTerms()` hit, rating `never`, slot held (locked/eaten), leftover
  (`leftoverOf`) with no parent dinner on an earlier day within `shelfData.cooked_leftovers.fridgeDays`. `variantId`
  not on the meal → base recipe (same as `applyPlacements`). Over-cap → placed, plus note "over your N min cap" (soft).
  A new pure helper `MP.placeSlots(plan, places, byId, ctx)` in `data.js` (beside `swapSlots`/`pushSlot`) does the
  checks, so it can be tested in Node and reused by Phase 89. `rankByGap`/`rankSlot` are not called: Hermes chose, and
  coverage shows through the existing meter (`renderMeter` animates on edit), never overridden.
- **Meal create/edit now waits for a confirm card** (reworks Phase 87): each `mealCreate`/`mealEdit` renders as a card
  "Hermes wants to add X" [Add] [No]. Add runs `applyMealEdits([edit])` (same checks, same Undo). `mealRemove` also
  needs the confirm (destructive). Pending cards are dropped on Exit. A `place` of a meal that is still pending is
  refused with "add the meal first". Edits keep `X-Actor: hermes` on the library PUT.
- **`totalMins`**: new optional meal field (integer 1-600, prep plus cook). Added to `PATCH` and `mealCreate` in
  `plan-chat.js` and `MP.patchMeal`'s whitelist (`data.js:208`). Est: `MP.estMins(meal)` in `data.js` (sum of step
  `minutes`; null when no step has minutes). `meals.json` is not hand-edited.
- **`cap` edit** `{ type:"cap", minutes, weekdays:[0-6] }` (minutes 0 clears). Applied by the app through
  `MP.PlanPrefs.save` (positional param 7 `timeCaps`). **Every existing `save` caller must pass the current
  `timeCaps` through** (plan-with-me.js:212, hermes-sync.js:382), or it gets wiped. The Worker's `planPrefsError`
  (worker.js ~1270) validates `timeCaps`, and the GET/PUT prefs pass it through.
- **`rate` edit** `{ type:"rate", mealId, rating:"up"|"down", note? (<=200) }`: "that was boring" → down with note.
  Applied at once with Undo via `MP.Ratings.set` + `MP.Sync.pushRating(id, patch, reason)` (Phase 74's logged, undoable
  path; the `X-Reason` is the note). `never` is not settable from chat: it's a hard filter, and stays an app tap.
- Validator stays one: `MP.PlanChat.validateReply` (Worker `/chat/reply` and app). Unknown types are still dropped.

## Files touched
- `plan-chat.js`: limits; NORM `place`, `cap`, `rate`; `totalMins` in PATCH/mealCreate; `describe` lines for the 3 new types.
- `data.js`: `MP.placeSlots` (pure), `MP.estMins`, `patchMeal` whitelist + `totalMins`. Shimmed (Worker imports): no
  top-level `window`.
- `plan.js`: `chatBriefing()`; open sends `context.brief`; `applyChatEdits` routes `place`; confirm cards for meal
  edits (`renderChatMeals`, ~2289/2329); `cap` → PlanPrefs; `rate` → Ratings; export `chatBriefing` on `MP.Plan`.
- `plan-with-me.js`: `get`/`save` carry `timeCaps` (clean: weekday keys 0-6, ints 5-240); line 212 passes it through.
- `hermes-sync.js`: 382 pull passes `remote.timeCaps`; `pushPlanPrefs` sends it.
- `worker/worker.js`: `ChatRoom` open-context limit 60000 (`CHAT_BRIEF_MAX`), user text 1000; `planPrefsError` timeCaps.
- `tools/hermes_chat_bridge.py`: prompt rewrite (free talk, brief from the open message each turn, new edit types,
  `GET /spend` once per session), `HISTORY = 30`; `tools/test_hermes_chat_bridge.py` cases.
- `test.html`, `tools/worker_test.mjs`: new asserts.
- `docs/HERMES.md` "Planning chat" section; `CLAUDE.md` invariants: Phase 72/87 lines (meal edits confirm-gated, Hermes
  may place via `place`), `mp_planPrefs` shape line (+ `timeCaps`), Phase 74 ratings line (chat `rate` is a second
  caller); `sw.js` CACHE bump; `docs/ARCHITECTURE.md` v12 note.

## Signatures / schemas
- `context.brief` (open message only): `{ start, days, firstSlot?, shopAnchor, busyDays, freeDays, chips, budgetTarget,
  freezeBatches, repeatGap, timeCaps, profile: { allergies, never, likes, dislikes }, ratings: { id: {rating, note} },
  taste: <MP.Ratings.tasteProfile summary>, pantry: [{ name, qty, useBy?, storage? }], gaps: [[wk1],[wk2]],
  meals: [{ id, name, mealTypes, servings, prepEffort?, leftoverOf?, leadsTo?, freezable?, totalMins? | estMins?,
  variants?: [{id,name}], tags? }], plan: [{ day, slots: { slot: mealId|"out"|null } }] }`. Bridge adds `spend`.
- `MP.Plan.chatBriefing(): object`. Consumer: the open `POST /chat` call in plan.js (~2402).
- `MP.placeSlots(plan, places, byId, { terms, ratings, fridgeDays, caps, pending }) → { plan, changes: [{day,slot}],
  refused: [{ day, slot, mealId, why }], notes: [string] }`. Consumers: `applyChatEdits` pushes `changes` into the chat
  diff, and `refused`/`notes` into `changes.notes` (toast + chat line).
- `MP.estMins(meal) → number|null`. Consumer: `chatBriefing`.
- `MP.PlanPrefs.save(busyDays, chips, budgetTarget, freezeBatches, repeatGap, rolling, timeCaps)`. Consumer of the new
  cap path: `applyChatEdits`'s `cap` branch.
- NORM: `place {day, slot, mealId(<=80), variantId?}`, `cap {minutes 0|5-240, weekdays: int 0-6, 1-7 unique}`,
  `rate {mealId, rating up|down, note? <=200}`.

## Edge cases
- `place` on a held slot / unknown meal / mushroom meal / allergy / `never` / wrong slot type / orphan leftover: refused with reason.
- `place` and `reroll` of the same slot in one reply: `place` wins (applied after the generator re-picks).
- Duplicate `place` for one slot in a reply: the last one wins.
- A brief over 60000: trimmed as above; still over → open returns 400 and the app falls back (existing `goFallback`).
- Plan-with-me Save after a chat cap: `timeCaps` survives (regression test).
- Old prefs with no `timeCaps`: treated as `{}`.
- `mealEdit` totalMins confirmed while a pending `place` waits on it: the place is unaffected (only `mealCreate` blocks a place).
- `rate` with an unknown mealId: dropped by the app with a note.
- The bridge runs before the app ships: an old app never sends `brief`, so the bridge falls back to today's prompt context.

## Verification
- `python3 check.py` (test.html: validateReply new types + limits, `MP.placeSlots` each refusal + leftover order,
  `estMins`, patchMeal totalMins, PlanPrefs timeCaps round-trip + plan-with-me save keeps it; chat bridge self-test:
  brief in every prompt, no "ONE question" text, spend fetched once).
- `node tools/worker_test.mjs` (`/chat/reply` normalises place/cap/rate, open with a 50 KB brief accepted and 70 KB
  rejected, `PUT /prefs` timeCaps validated).
- Browser run with a mocked Worker chat (Playwright, `tools/browser-check`): a reply with 5 places + 1 mealCreate shows
  5 Accept/Reject slot cards and 1 Add/No card; Add then Undo; a mushroom `place` refused; at PC and 390 px, both
  themes. No real credential needed.

## Tasks
Logic (TDD):
- [x] `plan-chat.js`: limits, `place`/`cap`/`rate` normalisers, `totalMins` in PATCH + mealCreate, `describe` lines
- [x] `data.js`: `MP.estMins`, `patchMeal` + totalMins, `MP.placeSlots` with every refusal
- [x] `plan-with-me.js` + `hermes-sync.js`: `timeCaps` get/save/pull/push; every save caller passes it through
- [x] `plan.js`: `chatBriefing()` + trim rule; open sends `context.brief`
- [x] `plan.js` `applyChatEdits`: `place` via `placeSlots` (after re-picks), `cap` → PlanPrefs, `rate` → Ratings + pushRating with Undo
- [x] Worker: `CHAT_BRIEF_MAX` on open, user text 1000, `planPrefsError` timeCaps; worker_test cases
- [x] Bridge: prompt rewrite, brief from the open message, `GET /spend`, HISTORY 30; bridge self-test
UI (`ui-build`):
- [x] Confirm cards for mealCreate/mealEdit/mealRemove (Add/No, then Undo), pending dropped on Exit; refusal lines for `place`
- [x] Docs: HERMES.md, CLAUDE.md invariant lines, ARCHITECTURE v12 note; bump `sw.js` CACHE
