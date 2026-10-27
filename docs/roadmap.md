# Roadmap

Active roadmap. Superseded versions live in `.claude/archive/` — this file is
updated in place, never forked into a versioned copy.

Superseded roadmaps (v1-v6, Phases 1-87) are archived in `.claude/archive/` (latest: `roadmap_20261026.md`).

**Done phases** (full sections in `.claude/archive/roadmap-done.md`): 27 Budget soft-preference, 28 Generic ingredient-substitution groups, 29 Live-build-watching (staged local generation render), 30 Hermes quantity ingestion (screenshot → structured quantities), 31 Partial-ingredient leftover tracking, 32 Personal-assistant connector (shopping list + "I ate X" queue), 58 Aisle-ordered shopping list, 67 Batch-cycle design, 73 Tie questions and trade-off cards.

---

---

# v7 — Plan with Hermes becomes the main way to plan (Phases 88-91)

Added 2026-10-26 from a planning chat. Hermes plans the way a person would: it is briefed with everything Plan with me
collects, talks freely, **places meals directly**, sees the whole liked library and the week as a grid. Plan with me and
one-tap Generate stay as the offline fallback. Kept fixed: exclusions, allergies and `never` are enforced in code on every
placement; nutrition coverage is shown, never overridden silently; Hermes creates or edits meals only after the user
confirms; a typing indicator is the only latency treatment (the KV relay stays). Order: 88 → 89 → 90; 91 is independent
(88's briefing reads its notes when they exist). Shop model: **one Asda shop a week**, and total cost efficiency across weeks
beats a single week's cost.

## Phase 88: Hermes briefing, human chat and direct placement [L] — built 2026-10-26, live checks pending

Verified 2026-10-26: check.py 10/10 (test.html 858 assertions incl. placeSlots refusals, validateReply limits, timeCaps round-trip; walk step: place cards + Add/No + Undo + pending-place refusal, PC and phone), worker_test, bridge self-test; tester PASS.

Goal: Hermes gets the whole Plan-with-me briefing (start, length, shop day, busy days, chips, budget, freezer, repeat gap, profile,
ratings and taste, pantry and use-by, last spend, nutrient gaps, every liked meal) in its first message, talks freely (limits
raised, several edits per reply, no one-question rule) and places meals itself through a validated `place` edit; meal create/edit
waits for the user's confirm. Also: a total cook time (`totalMins`, prep plus cook) on every dinner, set by Hermes when it
creates or edits a meal and estimated for existing ones from step `minutes`, confirmed by you; a per-day cap ("20 minutes max on
weeknights") Hermes plans within; and the taste ledger: "that was boring" or "loved that" in chat logs a rating with its reason
(Phase 74's path). Reworks Phases 72, 84 and 87's limits; the "Hermes never returns meals" invariant changes.

## Phase 89: Weekly plan view with live diff, ticker and wrap-up [L] — built 2026-10-26, live checks pending

Goal: a 7-column week grid with the chat docked beside it; Hermes's changes show as a per-slot or whole-week accept/reject diff
with a live £ and nutrient-gap delta (the ticker), each dinner card shows its total cook time and a day over its cap is flagged, and a wrap-up checklist (gaps left, uncooked leftovers, items to buy) before
the plan is accepted and handed to the shopping list.

## Phase 90: Weekly Asda shop, freezer-first, bulk buys and batch cooks [L] — built 2026-10-26, live checks pending

Goal: Hermes plans around one shop a week: uses the freezer first, proposes bulk buys that serve later weeks (e.g. 1 kg chicken
thighs, part frozen) and cheaper meal variations, and schedules batch-cook days with the leftover and freezer chain, choosing
by total cost over several weeks; the shopping list builds up as you chat. Also a "plan from the fridge" mode: you list or photo what is left (fridge, freezer, cupboard) and it plans
the days before the next shop from that alone. Requires 88; builds on Phases 59, 67, 76.

90a (freezer-first placement, bulk buys, 28-day shop lists) built 2026-10-26, live checks pending; verified by check.py 10/10 and worker_test. 90b (shop panel in the chat, plan from what's left, `stock` edit) built 2026-10-26, live checks pending; verified by check.py 10/10 (test.html fridge asserts, walk fridge step at PC and phone, bridge self-test) and tester PASS.

## Phase 91: Hermes notes in Obsidian [M] — built 2026-10-26, live checks pending

Goal: standing notes ("hates Sunday cooking", "tight budget last week of the month") live in a vault note the user can edit in
Obsidian; the assistant syncs it to KV, the planner and Hermes read it, and Hermes can propose a note that the user confirms.

## Phase 92: Eat from Browse [M] — built 2026-10-26, live checks pending

Goal: press Eat on any meal or snack in Browse, pick portions (and optionally when), and it is logged for nutrition; a match with today's plan ticks the plan slot. Log-only, never the pantry.

---

# v8 — Hermes adapts to you (Phases 94-107)

Added 2026-10-26 from `docs/MEAL_PLANNING_EXAMPLE.md`, merged from 22 ideas into 14 phases the same day. Hermes should plan
the way that conversation went: it sounds like Hermes, remembers what you said, learns your rules, swaps ingredients and meals
for cheaper or to suit you, starts from your kitchen, and lets you log, eat and move meals in one tap. Already built and not
repeated: highlighted changes with the ticker flash and per-row Undo (Phase 89), the `GET /swaps` cheaper-swap route (Phase 76,
assistant side only), fridge mode (Phase 90b), eating out, swaps and backfill (Phases 81-82), Log anything (Phase 80), Eat from
Browse (Phase 92). Kept fixed: exclusions, allergies and `never` stay enforced in code; Hermes never writes the pantry; nothing
applies unseen except the existing direct `place`. Order is by usefulness; 100 builds with or after 99.

## Phase 94: Hermes talks like Hermes [S] — built 2026-10-27, live checks pending

Verified 2026-10-27: real CLI resume probe (named session remembers), bridge self-test (prose, edits block, old JSON, session reuse, briefing hash, fallback), tester PASS. Empty/noise-only reply = FALLBACK; any other prose is valid.

Goal: (a) the bridge resumes one Hermes session per chat (the Hermes CLI has `--continue`/`--resume`) instead of a fresh
`hermes -z` per message, so it keeps its own memory and voice, falling back to today's pasted history if resume fails; and
(b) replies are ordinary prose with the edits in a separate fenced block the bridge strips and validates (same
`validateReply`), removing the one-JSON-object constraint that makes it sound like a chatbot.

## Phase 95: Kitchen-first opener [M] — built 2026-10-27, live checks pending

Goal: the first turn asks what is cooked, left and in the cupboard, turns the answer into `stock` and leftover placements
(Phase 93), and plans around it in every chat, not only fridge mode. Stock stays session-only; the pantry is untouched.

## Phase 96: Remember my reactions [M] — built 2026-10-27, live checks pending

Goal: a lasting rule you state in chat (dislike, "lunch should be toasties", "no X on weeknights") is saved as a standing
note from one tap, or automatically for dislikes, so you never repeat it. Today a `note` needs an Accept card. Notes stay prose
and never generator input except through the existing exclusion and chip layers.

Verified 2026-10-27: worker_test (DELETE ok/404/403), test.html kind + sync cases, bridge test, check.py 10/10. Live: chat dislike -> Saved + Undo.

## Phase 97: Change meals and ingredients to suit you [L] — built 2026-10-27, live checks pending

Goal: (a) a chat `sub` edit ("thighs instead of breast this week") writes `slot.subs` for the slot or slots named through
`MP.applySubs`, without touching the library meal (today `slot.subs` is generator-written only; hard exclusions run after the
swap); (b) "less sauce, add peppers" becomes a meal edit offered as "just this week" (a variant on the slot) or "change the
meal" (Phase 87's library edit); (c) a batch of edits is approved with one tap instead of one card each.

## Phase 98: Make it cheaper, with the live total [M] — built 2026-10-27, live checks pending

Goal: every chat turn carries the working plan's shop total and per-shop split, so Hermes can say "that saves about £3"
(it still does not raise cost unprompted); and "make it cheaper" gives ingredient or meal swaps with the £ difference from
`pack-sizes.json` on an Add/No card each, using the Phase 76 swaps logic in-app. Never reorders nutrition ranking.

Verified 2026-10-27: check.py 10/10, worker_test and bridge test green, tester PASS; ingredient swaps only on cards (meal swaps stay on `place`); chat card not driven live.

## Phase 99: Low-effort lunch suggestions [M] — done (2026-10-27; check.py 10/10, tester PASS: lunchEffort cases in test.html, bridge prompt assert)

Goal: Hermes suggests lunches that need almost no cooking (toasties, assembled bowls, reheated batch leftovers, 15 minutes or
under), drawn from the library first and offered as new meals via `mealCreate` (Add/No card) only when nothing fits. Honours
the lunch rules in `docs/MEAL_PLANNING_EXAMPLE.md` (never an empty lunch slot, no mushrooms, no wraps, no standalone egg) and
the `cap` minutes; the brief marks each lunch's effort so Hermes can keep the cooking down.

## Phase 100: Cook-now suggestions [M] — built 2026-10-27, live checks pending (check.py 10/10, worker_test ok, bridge test ok, tester PASS: deck + chat entry points placed a meal at PC and 390 px; open gap: Cook now button hides only on eaten slots, locked slots rely on placeSlots refusal)

Goal: "what can I make with what's in?" and "something else?" on a slot return one to three library meals cookable now from
the pantry, cooks and session `stock` with nothing to buy, as a chat card or sheet that can place one into the slot. Reads
`pantryIndex`; never writes the pantry and never reorders the plan's nutrition ranking.

## Phase 101: "Ate something else", with push-back [M] — built 2026-10-27, live checks pending

Goal: one tap on any planned slot opens *Ate it*, *Ate something else* (search your library, recents or type text) and
*Skipped*. The slot records what was eaten (Phase 82 `backfill` / Phase 80 `POST /food-log` path, never `commitCook`, never the
pantry) and the planned meal is offered a move: tomorrow, the freezer if it is a batch cook, or drop, chosen by shelf life
(`shelf-life.js`) and the next shop day (`MP.moveSlot`/`pushSlot`, undo through `mp_planUndo`). Hermes does the same on request
in chat ("I had pasta instead of the curry, move the curry to tomorrow") through the existing `skip`, `out` and `backfill`
edit types, applied without a draft only when you have said it in this chat. Hermes picks replacements from your whole liked
library (the Browse list): the briefing already carries every liked meal (Phase 88), so check that Browse likes and
`GET /library` agree before building.

## Phase 102: Type it anywhere, with recents [M] — built 2026-10-27, live checks pending

Verified 2026-10-27: check.py 10/10; tester PASS (bar on all five pages, free text, needs-grams, chip, Undo, sync-off, sheet hide).
Goal: a persistent "I ate…" box on every page. As you type it offers matches from your library, recents and foods
(auto-select list); picking one logs it as eaten and, if it matches a planned slot today, ticks that slot (`MP.tickPlanEaten`).
Free text still logs through `POST /food-log`. Under the box, a strip of your last 10 off-plan things and usual extras, each
one tap at your usual portion. Phone speech-to-text works through the keyboard mic; no new dependency.

## Phase 103: Drag a meal to another slot or day [M] — built 2026-10-27, live checks pending

Verified 2026-10-27: check.py 10/10; tester PASS (card drag swap + Undo at PC and 390 px, self-drop cancels, tap opens day view; touch hold path read only, left to the live check).
Goal: on the plan grid, drag a slot onto another slot or day to swap or move it (touch and mouse, keyboard fallback). Calls
`MP.swapSlots`/`swapDays`, so held slots and a leftover before its cook are still refused; shopping list and leftover chains
update. Undo through `mp_planUndo`.

## Phase 104: Portion and leftover adjust [M] — built 2026-10-27, live checks pending

Verified 2026-10-27: check.py 10/10; tester PASS (bar on all five pages, free text, needs-grams, chip, Undo, sync-off, sheet hide).
Goal: on a logged meal, slide the portion (half to double). "Keep the rest" opens a Cooks leftover record for tomorrow. A
portion change re-freezes nutrients at log time (food log rule); it never touches the pantry (`eatPortion` rule).

## Phase 105: Freeze-ahead prompts [M] — done

Goal: when a batch dinner makes more portions than the next 1-2 days use, Hermes offers to freeze the extras and places them
into a later week as `fromCook` slots (Phase 90a). Uses `freezable`, the Cooks fridge-to-freezer move and the freezer-first
rule; buys nothing for a placed portion. Check first what Phases 43 and 90 already prompt in the app so the chat only adds
the offer, not a second freezer path.

Verified: check.py 10/10 (test.html 105 cases, worker_test, bridge test, ui pages PC/phone both themes, ui walk freeze step); tester PASS.

## Phase 106: Eaten, by nutrient [M] — built 2026-10-27, live checks pending

Goal: one easy view (an "Eaten" tab, today and the week, PC and phone) showing what has actually been eaten against target, for
what the data already measures: calories, protein, carbs, fat, fibre, total sugars, saturated fat, sodium, calcium, iron,
potassium, magnesium and vitamins A, C, D, B12 and folate, with **water** (the Phase 41 counter) shown beside them, not scored.

Already there, so not rebuilt: targets in `nutrition-targets.json` for everything above except total sugars; total sugars in
the food log and CoFID; the Phase 35 weekly gap view; the water counter. The view reads the same eaten data as coverage
(`Nutrition.foodAsEaten`, portion-eat logs, food-log entries): no second source.

New: a `sugars_g` target (a cap), the view, and a line saying how much of the day's food had data. An absent value shows
"unknown", never 0, and each row says measured or estimate (basis, as for Products). Salt-only labels convert to sodium
(salt ÷ 2.5).

Link: the Eaten view leads to the nutrition assistant's health page (target and URL to confirm in the spec; not found in this repo).

## Phase 107: More measured foods and added sugars [M] — built 2026-10-27, live checks pending (trans fat measured from CoFID; the 2021 xlsx has no free-sugars column, so addedSugars_g is USDA-estimate only; 39 staples mapped; verified: check.py 10/10, worker_test, cofid build deterministic)

Goal: raise what Phase 106 can show. (a) Grow `tools/cofid-map.json` beyond the 38 mapped foods to the library's common
ingredients (`tools/cofid_build.py`, never hand-edit `cofid.json`). (b) Add CoFID's free-sugars column as `addedSugars_g`
(a cap) after checking the 2021 xlsx has it, and trans fat as `transFat_g` (a cap near zero) if CoFID or USDA (ids 1235 and
1257 in `food-log.json` `usdaIds`) has it. Both stay "unknown" where no source has them, never 0. (c) Only if wanted: vitamins
E, K and B6 (new CoFID columns and targets). Depends on Phase 106.

# Built, live checks pending

## Phase 108: Phone-first polish, simple and animated [L] — not started

Goal: keep the Cork Kitchen look (Phase 86 styled and animated every component) but make every page feel simple and native
on a phone: less on screen at once, bigger tap targets, a bottom tab bar, drag-to-close sheets, page transitions, and
consistent motion in every component. No new look, no new dependency. Runs last so it polishes the final markup of Phases 94-107.

## Phase 93: Leftover placements [S] — built 2026-10-26, live checks pending

**Added 2026-10-26.** `PUT /placements` entries take `leftover: true` (and `portions` 1-12) for a meal the user has already
cooked. Before this, Hermes could place a meal but not say it was already made, so the shopping list bought its ingredients
again and the Cooks record (app-owned, never written by Hermes) was missing. The app flags the slot, `buildLists` skips it,
and the app itself opens the Cooks record once (idempotent, none if one is already open), so the pantry is never deducted.
**Verify:** a leftover slot adds no ingredient to the shopping list while a normal one does; one Cooks record opens with the
portions and a second pass opens none; the Worker rejects a non-boolean `leftover` and `portions` without it.
Assistant side: none (it already places through `PUT /placements`).

**Built 2026-10-26.** Worker validation, `applyPlacements` flag, `openLeftoverCooks` (on placements-applied and page load),
`buildLists` skip. Verified: `node tools/worker_test.mjs`, `test.html` (6 new assertions) and the walk. Live check pending.

Full specs: `.claude/archive/roadmap_20261026.md` (v5 and v6 prose and every phase section). `/live` ticks `tasks.md` and marks these `— done`.

## Phase 33: Product nutrition reference (scan a barcode, read a photo) [L] — built 2026-10-22, live checks pending
## Phase 34: Use-by dates, expiring-soon route and "use it up" [L] — built 2026-10-22, live checks pending
## Phase 35: Weekly nutrient-gap view and gym-day targets [M] — built 2026-10-21, live checks pending
## Phase 36: Cost per 25 g protein and product ranking [S] — built 2026-10-22, live checks pending
## Phase 37: Per-day effort hints from the assistant [M] — built 2026-10-21, live checks pending
## Phase 39: "Ran out" items steer the plan [S] — built 2026-10-22, live checks pending
## Phase 40: Cooking mode data: steps, timers and a confirm-cook route [M] — built 2026-10-22, live checks pending
## Phase 41: One-tap logs: routine items and water/caffeine counters [M] — built 2026-10-22, live checks pending
## Phase 43: Pantry and leftover read routes: cookable, substitutions, leftovers, quick fallback [L] — built 2026-10-22, live checks pending
## Phase 48: Activity log and undo for every assistant write [L] — built 2026-10-22, live checks pending
## Phase 49: Week-plan draft and apply routes [M] — built 2026-10-22, live checks pending
## Phase 50: Draft meals and recipe import [L] — built 2026-10-22, live checks pending
## Phase 51: Meal ratings, flags and reasons ("never again") [M] — built 2026-10-22, live checks pending
## Phase 52: Vault data layer and personal profile [M] — built 2026-10-22, live checks pending
## Phase 53: Portion scaling route [S] — built 2026-10-22, live checks pending
## Phase 54: Today route (one source for the Today screen) [M] — built 2026-10-22, live checks pending
## Phase 55: Shopping list as the single shared state [L] — built 2026-10-22, live checks pending
## Phase 56: Hermes contract rewrite and tool parity [M] — built 2026-10-22, live checks pending
## Phase 57: Measured nutrient levels for new ingredients (CoFID) [M] — built 2026-10-22, live checks pending
## Phase 59: Freezer-aware batch planning [L] — built 2026-10-23, live checks pending
## Phase 60: Choice screens for breakfast, lunch and snacks [M] — built 2026-10-23, live checks pending
## Phase 61: Repeat-rate control [S] — built 2026-10-23, live checks pending
## Phase 62: Taste profile from ratings [M] — built 2026-10-23, live checks pending
## Phase 63: Mid-week re-flow [L] — built 2026-10-23, live checks pending
## Phase 64: Three candidate weeks [M] — built 2026-10-23, live checks pending
## Phase 65: Use-it-up week [M] — built 2026-10-23, live checks pending
## Phase 66: Lock and fill [M] — built 2026-10-23, live checks pending
## Phase 68: Rolling plan [L] — built 2026-10-23, live checks pending
## Phase 69: Swipe deck per slot [M] — built 2026-10-23, live checks pending
## Phase 70: Live nutrient and cost meter while editing [M] — built 2026-10-23, live checks pending
## Phase 71: What-if preview on a candidate [S] — built 2026-10-23, live checks pending
## Phase 72: Planning chat with Hermes (guided, animated) [L] — built 2026-10-23, live checks pending
## Phase 74: Learn from rejections [S] — built 2026-10-23, live checks pending
## Phase 75: Tomorrow lock-in on Today [M] — built 2026-10-23, live checks pending
## Phase 76: Cheaper swaps route [M] — built 2026-10-24, live checks pending
## Phase 77: Weekly spend log [S] — built 2026-10-24, live checks pending
## Phase 78: Pantry audit route [M] — built 2026-10-24, live checks pending
## Phase 79: Cooking mode [M] — built 2026-10-24, live checks pending
## Phase 80: Log anything [L] — built 2026-10-24, live checks pending
## Phase 81: Eating out, named, and skip that asks [M] — built 2026-10-24, live checks pending
## Phase 83: Flexible plan start and length [L] — built 2026-10-26, live checks pending
## Phase 84: Tell it anything: chat and assistant control [M] — built 2026-10-26, live checks pending
## Phase 85: Log and show every meal Hermes sends [M] — built 2026-10-26, live checks pending
## Phase 86: Style and animate every component [L] — built 2026-10-26, live checks pending
## Phase 87: Plan with Hermes can create and change meals [L] — built 2026-10-26, live checks pending (check.py 10/10, worker_test ok, tester PASS: browser run of create/refuse/Undo/Exit warning at PC and 390 px)
