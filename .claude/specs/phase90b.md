# Phase 90b: Shop list that builds as you chat, and plan from the fridge [M]
Plain: while you plan with Hermes you see the shopping list fill up, and you can say what's left in the fridge and have
it plan the days until your next shop from that.

Requires Phase 90a (Decisions there, `.claude/specs/phase90a.md`), Phase 89 (`#chat-ticker`, `renderChatWeek`; spec
`.claude/specs/phase89.md`) and Phase 88.

## Decisions
User-chosen: see 90a (typed, session-only fridge list; photos via Telegram → pantry; missing items are a note).

Own calls:
- **Shop panel**: a collapsible "Shopping so far" under `#chat-ticker` (`#chat-shop`). Built from
  `MP.ShoppingList.buildLists(working plan, byId, packData, pantry)` on every `renderChatWeek`, grouped by shop day, with
  lines added since the chat opened (vs `buildLists` of `chat.snapshot`) marked new (a short highlight; reduced motion:
  none) and bulk lines tagged "bulk · freeze N". Display-only: it never writes the list (Save & shop, Phase 89, still
  hands the plan over). Phone: collapsed by default, a count badge.
- **Fridge mode** is a chat mode, entered from a "Plan from what's left" button beside the Plan with Hermes entry, URL
  `?chat=1&from=fridge`. The open message's brief gains `mode: "fridge"` and `window: [firstDay, lastDay]` = today's plan
  day up to the day before the next shop day (`MP.ShelfLife.shopDayFor`). With no current plan, it starts a new one from
  today (Phase 83's `start`) and the window ends the day before the next shop day from `shopAnchor`.
- **`stock` edit** `{ type: "stock", items: [{ name <=60, qty? <=30 }] }` (max 40 items): Hermes turns the typed list into
  items; the app keeps them in `chat.stock` (session only, dropped on Exit, never `PUT /pantry`), shows them as a chip
  row "You said you have: ...", and adds them to the `have` index for the missing check.
- **Missing note**: in fridge mode `MP.placeSlots`' ctx gains `fridge: { window, have }`; a place inside the window whose
  meal (effective, with variant/subs) needs keys not in `have` (pantry + `chat.stock` + `fromCook` slots need nothing),
  skipping staples (`isSkippedIngredient`), is placed with a note "needs X, Y". No refusal.
- Bridge prompt: in fridge mode, plan only the window, from the pantry, cooks and the user's list; send `stock` first.

## Files touched
- `plan.html`: `#chat-shop` panel; "Plan from what's left" button.
- `plan.js`: `renderChatShop` (called from `renderChatWeek`); fridge open (brief `mode`/`window`); `stock` edit →
  `chat.stock`; `placeSlots` ctx `fridge`.
- `data.js`: `placeSlots` `fridge` notes (uses `MP.ShoppingList.pantryIndex`/`hasEnough`; Worker-imported, shimmed).
- `plan-chat.js`: NORM `stock`; `describe` line.
- `tools/hermes_chat_bridge.py` + test: fridge-mode prompt lines.
- `style.css`: `.chat-shop`, new-line highlight (motion tokens, Phase 86). `test.html`: asserts. `sw.js`: CACHE bump.
- `docs/HERMES.md`: `stock`, fridge mode. `CLAUDE.md`: one invariant line (`chat.stock` is session-only, never the pantry;
  the shop panel is display-only).

## Signatures / schemas
- `renderChatShop()`. Consumer: `renderChatWeek`.
- `placeSlots` ctx `fridge?: { window: [from, to], have: index }` → notes `"needs X, Y"`. Consumer: `applyChatEdits`.
- NORM `stock { items: [{ name, qty? }] 1-40 }`. Consumer: `applyChatEdits` (`chat.stock`).
- Brief: `mode?: "fridge"`, `window?: [from, to]`.

## Edge cases
- Next shop day is today: window is empty → the chat says "your shop is today" and runs as a normal chat.
- `stock` item matching a pantry item: no duplicate chip; both count as have.
- Unknown ingredient name in `stock`: kept as typed; it just won't match anything.
- Panel with no `packData`: lines without £.
- Exit from fridge mode: `chat.stock` gone, `mp_plan` untouched, pantry untouched (assert).

## Verification
- `python3 check.py` (test.html: fridge notes inside/outside the window, staples skipped, `stock` counts as have,
  `fromCook` needs nothing; validateReply `stock`; bridge self-test fridge lines).
- Browser run with a mocked chat (Playwright, `tools/browser-check`): open `plan.html?chat=1&from=fridge`, a reply with
  `stock` + 2 places shows chips, one "needs" note and the panel's new lines; Exit leaves `mp_pantry` and `mp_plan`
  byte-identical. PC and 390 px, both themes. No real credential needed.

## Tasks
Logic (TDD):
- [x] `plan-chat.js` NORM `stock`; `placeSlots` `fridge` notes
- [x] `plan.js`: fridge open (brief `mode`/`window`, no-plan start), `stock` → `chat.stock`, ctx `fridge`
- [x] Bridge fridge prompt + self-test
UI (`ui-build`):
- [x] `#chat-shop` panel with new-line highlight and bulk tags; phone collapsed with count
- [x] "Plan from what's left" button; stock chip row; "needs" notes
- [x] Docs + CLAUDE.md line; bump `sw.js` CACHE
