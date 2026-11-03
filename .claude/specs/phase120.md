# Phase 120: Plan with Hermes, build the fortnight in chat [L]
Plain: you start with an empty fortnight and build it with Hermes in a clean chat: it offers a few meals at a time as tappable cards, you pick, and the rest is planned around your picks.

Requires Phase 118 (built). Replaces 118a's wizard and 118b's walk chat as the "Plan with Hermes" path. UI is prototype A (user pick, 2026-11-03): `design-prototypes/ui-concepts/planbuild-a.html` (split view: fortnight left, chat right on PC; Plan | Chat tabs under an always-visible progress + cost bar on phone). Build to it via `ui-build`.

## Decisions
- **User-chosen:** setup is start date + number of days (1-28) + budget (a reminder only). Nothing else in the wizard.
- **User-chosen:** the plan starts empty. The chat opens straight away; the generator does not fill the fortnight.
- **User-chosen:** Hermes and the user build it together. Each Hermes turn offers 2-4 options as cards; the user taps one to place it; later rounds are shaped by what is already placed (shared ingredients, leftovers, nutrient gaps).
- **User-chosen:** options may be (a) a library meal as is, (b) a library meal with another variant or changed ingredients (`variantId` / `subs`), (c) a new meal from outside the library, shown as a draft the user approves before it is saved.
- **User-chosen:** no rolling plan. Plans are fixed blocks (about two weeks) until the user plans the next one.
- **User-chosen:** budget is a reminder: sent to Hermes in the briefing, running cost shown against it, never blocks a placement or filters an option.
- **User-chosen:** Hermes replies as short text + one card per meal (not a paragraph).
- **Own call: reply shape** gains `options` (max 4): `[{ mealId, variantId?, subs?, why? }]` for library picks, or `[{ create: <mealCreate payload>, why? }]` for new meals. Validated by `MP.PlanChat.validateReply` (Worker `POST /chat/reply` and app). Unknown or invalid options are dropped and counted in `dropped`. An option is only a proposal: tapping Place goes through `applyChatEdits` / `MP.placeSlots` (same hard checks, so exclusions, allergies and `never` ratings refuse it with the reason shown); a `create` option goes through the existing mealCreate Add/No card first, then places.
- **Own call: the generator is not used to fill slots.** `rankSlot`/`candidatesFor` still back the manual "other options" and the Hermes `cookNow`; nutrition ranking stays the only ranker. Hermes may use its briefing's ranking (`GET /ranking`) as input.
- **Own call: rolling.** `rollIfDue` becomes a no-op and the "Rolling plan" checkbox is removed; `mp_planPrefs.rolling` stays in the stored shape (old data) but defaults to `false` and nothing reads it. `shopAnchor` is set once from the start date (`MP.shopAnchorFor`).
- **Own call: empty plan.** The chat keeps `chat.build = { start, days, budget }` and the working plan is a frame of N dinner slots with no meal. If a null meal breaks any reader (`planMirror`, `MP.dinnersOnly`, `buildLists`), keep the frame in chat state only and create the plan on the first Place. The builder picks whichever passes `check.py`.
- **Own call: reuse** `guidedActive` (Exit leaves `mp_plan` untouched until Save), `wrapUp` in-thread wrap, `renderTicker` cost line, `placeSlots`, `reasonForm`. Delete the 118a wizard steps and the 118b walk (night cards, pill strip, Keep the rest) once replaced.
- **User-chosen: Hermes uses its relevant skills.** The bridge's chat responder in build mode loads the existing local Hermes skills (`hermes chat --skills a,b,c`; the flag exists): `meal-week-planning`, `meal-idea-brainstorming`, `next-meal`, `nutrient-candidates`, `micronutrient-estimation`, `meal-pantry-intake`, `planner-write-rules`, `meal-planner-bridge`. Names above are from `hermes skills list` (display is truncated): the builder resolves each exact name with `hermes skills list` first. The list lives in one constant `BUILD_SKILLS` in `tools/hermes_chat_bridge.py`. A name Hermes does not have is dropped with one log line, never an error. Hermes skills live in Hermes's own store outside this repo: the bridge only selects them; the `options` reply format is taught by the bridge prompt (in repo), so no skill file is edited. If a skill's own text clashes with the options format, that is a `- [ ] Live:` item for the user, not a repo change.
- No ADR: no architectural fork.

## Files touched
- `plan-with-me.html`, `plan-with-me.js`: shrink to start date, days, budget; Continue goes to `plan.html?chat=1&build=1&start=&days=&budget=`. Drop weekday/chip/time-cap/rolling steps (`MP.PlanPrefs` still reads and writes the stored shape).
- `plan.js`: `openChat({ build: true })`, `chat.build` state, option-card renderer, Place handler (via `applyChatEdits`), empty-frame handling, `rollIfDue` no-op, `chatBriefing` adds `build: true` and `budgetReminder`, delete walk code (`walkNights`, night cards, pill strip, `#chat-keep-rest`). Defining file for `placeSlots` / `applyChatEdits` / `renderTicker` / `wrapUp` (all in `plan.js`; `plan.html` already loads it).
- `plan.html`: chat panel markup for the chosen prototype; remove walk-only ids.
- `plan-chat.js`: `validateReply` accepts and normalises `options`; `MP.PlanChat` is shared by the Worker, so keep the `window` → `root` shim intact.
- `worker/worker.js`: none expected (it already calls `validateReply`); confirm `POST /chat/reply` passes `options` through to the thread. If `ChatRoom` strips unknown reply fields, whitelist `options`.
- `tools/hermes_chat_bridge.py` + `tools/test_hermes_chat_bridge.py`: prompt rules for `brief.build` (reply: one short line, then options, 2-4, one meal each, no paragraphs; explain a pick in `why`; may propose a variant via `variantId`/`subs`; new meals via `create`; mention the budget reminder only when the running cost passes it); parse `options` from the fenced block (`"options": [...]` alongside `edits`).
- `tools/hermes_chat_bridge.py`: also `BUILD_SKILLS` and the `--skills` argument for build-mode turns only (other chats unchanged).
- `hermes-sync.js`: none. `plan-with-me.js` stays the only `mp_planPrefs` writer.
- `style.css`: chat column, option cards, empty-night rows, running cost (house tokens, both themes, 390 px).
- `sw.js`: bump `CACHE` (first Logic task).
- `test.html`: `validateReply` options cases.
- `tools/browser-check/walk.mjs`: new steps; remove the 118b walk steps.
- `CLAUDE.md`: the `mp_planPrefs` line (`rolling` unused) and the `guidedActive` line (walk chat -> build chat). `docs/UI_STYLE.md`: option card (via `restyle-from-prototype`). `docs/HERMES.md`: reply `options` field.

## Signatures
- `MP.PlanChat.validateReply(raw, vocab, today) -> { reply: { text, edits, ask, options }, dropped }` (`plan-chat.js`). `options`: `[{ kind: "library", mealId, variantId?, subs?, why? } | { kind: "create", meal, why? }]`, max 4, `why` <= 140 chars. Consumer: the app's option-card renderer; the Worker only validates.
- `MP.Plan.optionToEdits(option, day) -> edit[]` (`plan.js`, pure): a library option -> `[place{...}]` (+ `sub` edits for `subs`); a create option -> `[mealCreate, place]` (the place waits for the Add card). Consumer: the Place button handler, which feeds `applyChatEdits`.
- `openChat({ build: true, start, days, budget })`.

## Edge cases
- Hermes offline: options cannot arrive; the screen says so in one line, the user can still place meals by hand ("other options" via `candidatesFor`) and Save.
- An option the hard checks refuse: card shows the refusal reason and Place is disabled; nothing is written.
- A `create` option refused by `MP.Exclusions.check` or profile terms: dropped with a thread note, never shown as a card.
- Placing over a filled night: asks to replace (one tap), snapshots to `mp_planUndo`.
- Days 1-28 bounds as Phase 83. Start date in the past is clamped to today.
- Exit before Save leaves `mp_plan` untouched (`guidedActive`).
- Budget 0 = no reminder; cost line hidden.
- An old stored `mp_planPrefs.rolling === true` must not roll any more.
- A skill in `BUILD_SKILLS` missing from this Hermes install: skipped with a log line; the chat still answers. All skills missing: plain chat as today.

## Verification
- `python3 check.py` passes (data_check, test.html incl. new `validateReply` options cases, ui pages, ui walk).
- `python3 -m unittest tools.test_hermes_chat_bridge` passes (`options` parsing, `brief.build` prompt line, `--skills` present for build turns only, a missing skill name dropped).
- `walk.mjs` (PC and 390 px, both themes): setup shows only start/days/budget; Continue opens an empty fortnight with the chat; a stubbed Hermes reply with 3 options renders 3 cards on separate lines; Place fills the slot and updates the running cost; an option containing mushrooms is refused with a reason; a `create` option shows the Add card first; Exit before Save leaves `mp_plan` unchanged; Save writes the plan; no daily roll happens on a later visit (`rolling: true` in stored prefs is ignored).
- Negative: a reply with a 5th option or an unknown option field is trimmed/dropped, not rendered.

## Tasks
### Logic (TDD)
- [ ] Bump `sw.js` `CACHE`.
- [ ] `validateReply` normalises `options` (max 4, caps, kinds); `test.html` cases incl. invalid ones.
- [ ] `MP.Plan.optionToEdits` + `test.html` cases (library, variant, subs, create).
- [ ] `rollIfDue` no-op; checkbox and default removed; test an old `rolling: true` blob.
- [ ] `BUILD_SKILLS` + `--skills` for build turns (resolve exact names with `hermes skills list`; drop unknown ones); test cases.
- [ ] `chatBriefing` adds `build` and `budgetReminder`; bridge prompt + parse `options`; `test_hermes_chat_bridge.py` cases.
- [ ] `ChatRoom` / `POST /chat/reply` pass `options` through (`node tools/worker_test.mjs` case).
- [ ] Empty frame: `chat.build` + first-Place plan creation; `walk.mjs` covers the null-slot readers.
### UI (prototype A, `planbuild-a.html`)
- [ ] Setup screen: start date, days, budget only.
- [ ] Chat column + option cards (one meal per row, Place, refusal state), per prototype A.
- [ ] Fortnight view beside/below the chat with the active night highlighted and the running cost against the budget reminder.
- [ ] In-thread wrap and Save reuse; remove the 118b walk UI.
- [ ] `walk.mjs` steps for every Verification line above; PC + 390 px, dark + light.
- [ ] Add `- [ ] Live:` lines to `tasks.md`: phone PWA chat with the real Hermes bridge; a build chat answering with the skills loaded and sensible options.
