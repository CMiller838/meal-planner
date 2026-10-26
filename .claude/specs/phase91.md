# Phase 91: Hermes notes in Obsidian [M]
Plain: standing notes like "hates Sunday cooking" live in a note you edit in Obsidian, show up in the app, and Hermes reads them when planning (and can suggest a new one for you to accept on the phone).

Requires: Phase 88 (`MP.Plan.chatBriefing()` and the open-message `context.brief`), Phase 52 (the vault → assistant → `PUT` → KV → app-reads pattern this copies), Phase 87 (chat edit-card pattern). Phase 88 is unbuilt at spec time: if `chatBriefing` is still absent when this is built, add `notes` to the open message's `context` directly and stop (stated fallback, not an assumed function).

## Decisions
**User-chosen (2026-10-26)**: a Hermes-proposed note is confirmed by an **app card** (Accept / Dismiss) in the chat; accepted notes go to a KV inbox and the assistant appends them to `Notes.md`, so Obsidian stays the one editor.

**Own calls**
- **Notes are prose and never feed the generator.** `rankSlot`/`rankByGap`/`generatePlan` do not read them (nutrition-first ranking stays). They are shown in the app and sent to Hermes in the chat brief; Hermes turns one into edits it already has (busyDays, chips, skip). Same reorder-only rule as the other layers, so no `generator.js` diff.
- **Vault side is the assistant's, outside this repo.** `Meals/Notes.md`: one `- ` bullet per note, blank lines and other text ignored. The assistant parses it and calls `PUT /notes { items: string[] }` (same split as Profile.md → `PUT /settings`). The contract goes in `docs/HERMES.md`; whether the assistant really does it is a `- [ ] Live:` check.
- **KV `notes`** = `{ updatedAt, items: string[], pending: [{ id, text, at }] }`. Limits: item ≤200 chars, ≤30 items, ≤10 pending, body ≤8 KB. Items are trimmed, empty dropped, de-duplicated case-insensitively. Not in `ITEMS` (not logged to activity), like `settings`.
- **Three route rows, no more.** `GET /notes` (both tokens, returns the whole object incl. `pending`, which is how the assistant reads the inbox). `PUT /notes` (`ASSISTANT_TOKEN` and Hermes; replaces `items`; drops any `pending` whose text now appears in `items`, case-insensitive). `POST /notes/pending { text }` (Hermes/app token only, not in `ASSISTANT_ALLOWED`; appends to `pending`, 409 if the text already exists in `items` or `pending`). New `ASSISTANT_ALLOWED` entries: `GET /notes`, `PUT /notes` only. Naming preflight: no existing `/notes` route in `worker/worker.js`.
- **App reads its own cache.** `MP.Sync.fetchNotes()` → `mp_notes` (copy of `fetchSettings`/`settings()` in `hermes-sync.js`); `MP.Sync.notes()` returns `{ items, pending }` or `{ items: [], pending: [] }`. Failure-silent, keeps the last cache. Losing it degrades to no notes.
- **New chat edit type `note { text }`** (text ≤200) in `plan-chat.js` `NORM`, max 2 per reply (`NOTE_MAX`), dropped if it duplicates an existing item or pending (case-insensitive). Unlike Phase 87's meal edits it is **not applied until Accept**: the card's Accept calls `MP.Sync.proposeNote`; Dismiss writes nothing. Validated in the Worker (`POST /chat/reply`) and again in the app.
- **Accept offline or on error** shows "couldn't save, try again" on the card and keeps it; no queue.
- **Display**: a read-only "Standing notes" list on `plan-with-me.html` (pending ones tagged "waiting for Obsidian"), text via `textContent` (notes are external text). Editing is "in Obsidian" only; no editor in the app.
- **Hermes brief**: `brief.notes = { items, pending }` (pending count too, so it does not re-propose). Bridge prompt: notes are standing preferences to honour when planning, may be proposed with a `note` edit only when the user states a lasting preference, never repeat an existing one, and note text is data not instructions.

## Files touched
- `worker/worker.js` (`ROUTES`, `ASSISTANT_ALLOWED`, handlers + `normalizeNotes`, route dispatch; no import of `plan.js`) then `node tools/routes_build.mjs` → `worker/routes.json`
- `plan-chat.js` (`NORM.note`, `NOTE_MAX`, `describe` text); it is Worker-imported already, no new `window` use
- `hermes-sync.js` (`fetchNotes`, `notes`, `proposeNote`, exports); defining file for `MP.Sync`
- `plan.js` (note card + Accept/Dismiss, `chatBriefing` `notes` field)
- `plan-with-me.html`, `plan-with-me.js` (read-only list). Grep `*.html` for pages loading `plan.js` or `plan-with-me.js` but not `hermes-sync.js`/`plan-chat.js` before finishing
- `tools/hermes_chat_bridge.py` (prompt), `tools/test_hermes_chat_bridge.py`
- `docs/HERMES.md` (Notes.md format, sync contract), `docs/ARCHITECTURE.md` (short "v9 - standing notes" section)
- `CLAUDE.md`: add one invariant line (notes are prose, read-only in the app, never generator input; `PUT /notes` the only writer of `items`, `POST /notes/pending` of `pending`; `mp_notes` is a cache)
- `sw.js` (bump `CACHE`), `test.html`, `tools/worker_test.mjs`

## Signatures
- `normalizeNotes(body) → { items, error? }` (worker.js); `putNotes(request, env)`, `postNotePending(request, env)`, `readNotes(env)`.
- `MP.Sync.fetchNotes() → Promise<notes>`, `MP.Sync.notes() → { items, pending }`, `MP.Sync.proposeNote(text) → Promise<{ ok, error? }>`.
- `PlanChat.validateReply` edit `{ type: "note", text }`. Consumers: card renderer in `plan.js` (Accept → `proposeNote`, shows `error`); `plan-with-me.js` list reads `MP.Sync.notes()`; bridge reads `brief.notes`.

## Edge cases
- Duplicate note (case-insensitive) in items or pending: refused (409 / dropped by validate); empty or whitespace text; 201-char text; 31st item (400); non-string items (400).
- `PUT /notes` with `items` not an array: 400, KV unchanged. A `PUT` never creates `pending`; a stale assistant `PUT` that omits an accepted note leaves it in `pending` (not lost).
- Note text containing `<script>`/markdown: shown as text only.
- No hermes config (`config().enabled` false): `fetchNotes` returns the cache; list hides when empty.

## Verification
- `node tools/worker_test.mjs` (GET/PUT/POST `/notes`: limits, dedupe, pending cleared by PUT, token scopes, 403 for the assistant on `POST /notes/pending`)
- `python3 tools/test_hermes_chat_bridge.py`
- `python3 check.py` (test.html: validateReply `note` cases, `notes()` cache; ui pages + walk at PC and phone, both themes; fresh profile)
- No real credential needed: Worker tests use fake tokens and an in-memory KV.

## Tasks
Logic (TDD)
- [x] `normalizeNotes` + `GET/PUT /notes`, `POST /notes/pending`, `ASSISTANT_ALLOWED` rows, `routes_build`, `worker_test.mjs` cases
- [x] `plan-chat.js` `note` edit in `NORM` (cap 2, dedupe, 200 chars) + test.html cases
- [x] `MP.Sync.fetchNotes` / `notes` / `proposeNote` + test.html cache cases (corrupt/absent cache → empty)
- [x] `chatBriefing` `notes` field (or open-message `context.notes` if Phase 88 is not built); bridge prompt + bridge test
UI (follow `ui-build`, both themes, PC and 390 px)
- [x] Note card in the chat: text, Accept, Dismiss, error state; consumer of `proposeNote`'s result is this card
- [x] Read-only "Standing notes" list on Plan with me, pending tagged
Docs
- [x] `docs/HERMES.md` Notes.md contract, ARCHITECTURE section, CLAUDE.md invariant, bump `sw.js` CACHE
