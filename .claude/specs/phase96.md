# Phase 96: Remember my reactions [M]
Plain: Tell Hermes you dislike something and it is remembered at once (with an Undo); other lasting rules are one tap to keep.

Requires Phase 91 (done: `note` edit, `POST /notes/pending`, `MP.Sync.proposeNote`, `Accept` card).

## Decisions
Already built (grep): the `note` chat edit, its Accept/Dismiss card (`plan.js` `answerNote`, `renderChatMeals`), de-dupe against items + pending (`plan-chat.js` ~105), max 2 per reply, bridge prompt line. Rules already save in one tap, so only the delta is spec'd:
1. **User-chosen:** a note gets `kind: "dislike" | "rule"` (absent = `rule`). A `dislike` is saved at once through the same `proposeNote` path, no card to accept, and its row shows "Saved: ... " with **Undo**. A `rule` keeps today's Accept/Dismiss card.
2. **User-chosen:** Undo = new `DELETE /notes/pending/:id`, valid only while the note is still in `pending`. Once the assistant has moved it into `items` (`PUT /notes` drops it from pending) the id is gone: the route returns 404 and the app says "already in Notes.md, edit it there". No other Undo.
3. Own call: notes stay prose and never generator input (Phase 91 invariant unchanged). A dislike note reaches planning only through `brief.notes`, which Hermes turns into edits it already has. `settings.dislikes` stays written only by `PUT /settings`.
4. Own call: the auto-save is app-side. The Worker route does not know `kind`; `validateReply` only carries it through. A failed auto-save (sync off, 409 "already a note", pending full) leaves a plain row with the error, never blocks the chat.
5. Own call: `kind` is not stored on the pending item (`{id,text,at}` unchanged).

## Files touched
- `plan-chat.js` (`NORM.note` keeps `kind` when it is `dislike`/`rule`, else drops it; `describe` unchanged).
- `plan.js` (`onChatReply` note branch: dislike -> call `answerNote`-style save at once; `answerNote`/`renderChatMeals`: saved dislike row with Undo calling `MP.Sync.unproposeNote`; rules unchanged).
- `hermes-sync.js` (`proposeNote` also returns the new pending `id`, found by lower-cased text in the response `pending`; add `unproposeNote(id)` = `DELETE /notes/pending/:id`, updates `mp_notes`; export it). Not on the `window`->`root` shim list.
- `worker/worker.js` (`NOTE_PENDING_PATH = /^\/notes\/pending\/([^/]+)$/`, `deleteNotePending(env, id)`: 404 when absent; add to the non-Hermes 403 gate only if the app's token is not `isHermes` (check how `DRAFT_PATH` is allowed at ~1943 and copy it); route row `row("DELETE", "/notes/pending/:id", "write", ...)`). No existing route has this path (grepped `/notes/pending` POST only).
- `worker/routes.json` (rerun `node tools/routes_build.mjs`, commit it).
- `tools/hermes_chat_bridge.py` (the `note` line in `EDIT_TYPES` and the "Propose a note" sentence: add `"kind":"dislike|rule"`; dislike = a food/ingredient/meal the user says they dislike, saved at once, so propose it only when stated plainly; rule = anything else lasting) + `tools/test_hermes_chat_bridge.py` if it asserts the prompt text.
- `tools/worker_test.mjs`, `test.html`, `sw.js` (bump `CACHE`), `docs/ARCHITECTURE.md` "v9 - standing notes" paragraph (add the auto-save + Undo line), `CLAUDE.md` "Standing notes (Phase 91)" invariant (add: a `dislike` note auto-saves, Undo only while pending via `DELETE /notes/pending/:id`; still prose).

## Signatures
- `NORM.note(e) -> { type: "note", text, kind?: "dislike" | "rule" }` (`plan-chat.js`).
- `MP.Sync.proposeNote(text) -> Promise<{ ok, id?, error? }>`; consumer: `plan.js` `answerNote` stores `x.noteId`.
- `MP.Sync.unproposeNote(id) -> Promise<{ ok, error? }>`; consumer: `plan.js` Undo handler for a saved dislike (removes the row; on 404 shows "already in Notes.md, edit it there").
- `DELETE /notes/pending/:id -> 200 { ok, items, pending }` | `404 "no such pending note"`.

## Edge cases
- Dislike text already a note or waiting: `validateReply` already drops it (no duplicate card).
- Two dislikes in one reply: max 2 notes per reply holds; both auto-save in order.
- Sync off: dislike row shows "Hermes sync is off", nothing saved, no retry loop.
- Undo after the assistant folded it into `Notes.md`: 404, message above, row stays "Saved".
- Chat Exit/abandon: a saved dislike note is not reverted (Phase 91: notes are not plan state).
- Note text is untrusted: rendered with `textContent` (already so).

## Verification
- `python3 tools/test_hermes_chat_bridge.py`
- `node tools/worker_test.mjs` (DELETE removes a pending note, 404 on an unknown or already-folded id, `routes.json` current)
- `python3 check.py` (test.html cases: `kind` kept for dislike/rule, junk kind dropped; ui walk). No real credential needed: Worker and sync are tested against fakes.

## Tasks
Logic (TDD)
- [ ] `plan-chat.js`: carry `kind` through `NORM.note`; test.html cases (dislike kept, rule kept, "x" dropped, absent stays absent).
- [ ] Worker: `deleteNotePending` + route + auth gate + `routes.json`; `worker_test.mjs` cases (delete ok, unknown id 404, id already gone after `PUT /notes` folds it 404, text-only body untouched).
- [ ] `hermes-sync.js`: `proposeNote` returns `id`; `unproposeNote`; test via the existing sync fakes in `test.html`.
- [ ] Bridge prompt: `kind` on the note edit; extend `test_hermes_chat_bridge.py` if the prompt text is asserted.
UI (`ui-build`, `docs/UI_STYLE.md`)
- [ ] `plan.js`: dislike auto-saves in `onChatReply` (consumer of `proposeNote`'s `id`), saved row with Undo (consumer of `unproposeNote`), error row on failure; rules keep Accept/Dismiss. Check PC + 390 px, both themes, with the real app and a fake Worker.
- [ ] Bump `sw.js` `CACHE`; update `ARCHITECTURE.md` and the `CLAUDE.md` invariant.
- [ ] Live (tasks.md): see below.
