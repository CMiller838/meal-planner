# Phase 111: Dinner-share targets, rolling-week gaps, logged-gap balancing, Hermes "because" [L]
Plain: with one dinner a night, the plan judges nutrition over the week against a dinner's share of your targets, steers dinners toward what your logged eating has been short on, and Hermes tells you when a pick is for a nutrient reason.

Requires Phase 110 (dinners only; specced, unbuilt). Fallback if 110 is not in yet: none needed, every change here is correct for a plan with extra slots too (they just count as more meals in the window).

## Decisions
User-chosen (planning gate, 2026-11-01):
- **Rolling week, not per-day gaps.** Nutrient gaps are judged over the dinners of the current shop week so far; the per-day chip shows protein against the dinner share only.
- **Balance against what was actually logged.** The generator and Hermes use nutrient gaps from the last 7 days of the eaten log and food log, compared with the daily targets (a "healthy normal"), and aim dinners at them.
- **Hermes says so.** When a pick is driven by a nutrient gap, Hermes states it in its reply and attaches it to the `place` card.
- **A health and diet screen belongs in the Notion assistant project** (`~/~ProjectsAI/notion_assistant`, its own roadmap). Not built here; see Handoff.

Own call:
- **One `dinnerShare: 0.375` in `nutrition-targets.json`** (roadmap said about 35-40%). `Nutrition.dinnerTargets(targets)` returns a copy with every numeric target and cap (not `dinnerShare`, `healthUrl`, `gymDay`) scaled, applied **after** `withProfile` and the gym uplift. It is not settable from Profile: `normalizeSettings` (`worker/worker.js` ~87) excludes `dinnerShare` from `keys`.
- **Full-day eaten coverage keeps the full targets** (Today's "Last 7 days", Eaten page, Worker `/day` and `/nutrition`): breakfasts and lunches logged via Browse Eat or the "I ate" bar still count in full. Only plan-side figures use the share.
- **Score thresholds in `dayCoverage` (3 covered, 1 partial) do not change.** Over a rolling week of dinners they behave as a weekly checklist; no per-nutrient fake precision.
- **Logged-gap rule is data:** `pack-sizes.json` `planning.loggedGapDays: 3` (min logged days before it counts) and `planning.loggedGapBelow: 0.5` (a nutrient is a logged gap when `coveredDays / loggedDays` is below this). Window = last 7 days up to today.
- **Logged gaps are a per-call pref, never stored** (same shape as `prefs.useUp`, Phase 65): `prefs.loggedGaps = string[]`. In `rankSlot` they are unioned into the gap nutrients handed to `rankByGap`, so they only change which nutrients `rankByGap` weights. Nothing is re-scored or filtered; hard exclusions, ratings, cost and busy layers run unchanged after it.
- **Hermes `why`:** optional string (<= 140 chars) on a `place` edit; dropped silently if absent or longer. It is display text only and never ranks anything.

## Files touched
- `nutrition-targets.json`: add `dinnerShare` (data, not inline). `sw.js`: `CACHE` bump (task 1).
- `pack-sizes.json`: `planning.loggedGapDays`, `planning.loggedGapBelow`.
- `nutrition.js` (already `root`-shimmed): add `dinnerTargets(targets)` and `loggedGaps(entries, byId, dates, tags, targets, dayKey, knobs)` (wraps `weekGaps`); export both. `dayCoverage` unchanged.
- `generator.js`: add pure `cycleMeals(days, dayNum, shopOffset, byId)` (dinners placed in the same shop cycle on days before `dayNum`, using `MP.ShelfLife.shopDayFor`); `pickMeal` passes it as `dayMealsSoFar`; `rankSlot` (~173) unions `prefs.loggedGaps` into `gapNutrients`. Export `cycleMeals`.
- `plan.js`: `candidatesFor` (~1577) and `tieFor` (~757, its `others` is dinner-less after 110) use `Generator.cycleMeals`; `coverageHtml` (~1147) shows `Protein ~Xg / <dinner target>g` and no "Short on" (the `partialDay` param goes if 110 has not already removed it); plan meter target (~238) `dinnerTargets(...).protein_g * 7`; week summary (~1477) unchanged (weekly "Short across the week"); the prefs-assembly point that already merges `useUp` (`regenerate`/`genOpts`, ~44-57, ~3163) adds `loggedGaps` from `MP.Sync.localEatenLog()` + local food log via `Nutrition.loggedGaps`; `chatBriefing` (~681) adds `nutrition` (below); the `place` card renders `why` as a small "Because: ..." line.
- `plan-chat.js`: `place` validator (~82-85) keeps `why` (string, <= 140). `validateReply` runs in the Worker and the app, so one change.
- `worker/worker.js`: `planInputs` (~307) sets `prefs.loggedGaps` from KV `eatenLog` + `foodLog` (`Nutrition.foodAsEaten` as in `GET /nutrition`, `Europe/London` day key); `ranking()` (~277) `others` = `Generator.cycleMeals` of the mirror plan; `normalizeSettings` excludes `dinnerShare`; `GET /nutrition?dates=` response adds `targets` (profile-merged full targets) and `dinnerShare` (additive, for the Notion screen). No new route, so `worker/routes.json` is unchanged.
- `tools/hermes_chat_bridge.py` (+ `tools/test_hermes_chat_bridge.py`): prompt sentence: "brief.nutrition lists nutrients the user's logged eating has been short on and the dinner-share targets. When you choose a dinner because of one, say so in your reply and put the nutrient in the place edit's `why`; if the pick is not nutrient-driven, omit `why`."
- `test.html`, `tools/worker_test.mjs`, `tools/browser-check/walk.mjs`.
- Docs: `SPEC.md` "Nutrition targets" (dinner share, rolling window, logged-gap balancing); `CLAUDE.md` invariants (new line: dinner share + logged gaps are ranking-input only, per-call, never stored; update the "Later ranking layers" line to mention logged gaps joining `rankByGap`'s gap set); `docs/FUTURE.md` (Notion health screen handoff); `docs/roadmap.md` heading `[L]` and `— done` on commit.
- Every `*.html` page loading `plan.js` already loads `nutrition.js` and `generator.js` (no new cross-file dependency). `grep -L nutrition.js` over pages that load `plan.js` to confirm.

## Signatures
- `MP.Nutrition.dinnerTargets(targets) -> targets'` (pure; share 1 or absent = same object). Consumers: `plan.js` `coverageHtml` and `renderMeter`, `chatBriefing`, Worker `GET /nutrition?dates=` (the `dinnerShare` field only).
- `MP.Nutrition.loggedGaps(entries, byId, dates, tags, targets, dayKey, knobs) -> string[]` (nutrients with `loggedDays >= knobs.loggedGapDays` and `coveredDays / loggedDays < knobs.loggedGapBelow`). Consumers: `plan.js` prefs assembly, Worker `planInputs`, `chatBriefing` (via `prefs.loggedGaps`, not recomputed).
- `MP.Generator.cycleMeals(days, dayNum, shopOffset, byId) -> meal[]`. Consumers: `pickMeal`, `plan.js` `candidatesFor`/`tieFor`, Worker `ranking()`.
- `prefs.loggedGaps: string[]` (absent = today's behaviour). Consumer: `rankSlot`.
- Brief: `nutrition: { dinnerShare, dinnerTargets: { energy_kcal, protein_g }, logged: { days, gaps: [{ nutrient, coveredDays, loggedDays }] }, planGaps }` (`planGaps` = `metrics.weekGaps`, already in the brief as `gaps`; keep `gaps`). Consumer: the bridge prompt only.
- `place` edit: `{ ..., why?: string }`. Consumer: the app's `place` card (shows it) and `MP.placeSlots` ignores it.

## Edge cases
- No eaten log or fewer than `loggedGapDays` logged days: `loggedGaps` is `[]`; generator output equals the rolling-week-only result.
- `dinnerShare` absent or not in (0, 1]: `dinnerTargets` returns the targets unchanged.
- First day of a shop cycle: `cycleMeals` is `[]`, so every tracked nutrient is a gap; `rankByGap` then favours the most nutrient-dense dinner, as the first slot of a day did before.
- Locked, eaten, `fromCook`, `eatingOut` and `leftover` dinners count toward `cycleMeals` when they have a `mealId`; eating-out slots (no meal) contribute nothing.
- `why` longer than 140 chars or not a string: dropped, the edit still applies.
- Allergies, `never`, ratings and exclusions are untouched: a gap never admits a meal the filters removed.
- A user with all nutrients logged-covered gets no `loggedGaps` and no "because" prompt text from Hermes.

## Verification
- `python3 check.py` (timeout 600000) green; `node tools/worker_test.mjs`; `python3 tools/test_hermes_chat_bridge.py`.
- `test.html` cases: `dinnerTargets` (scales energy/protein/caps, leaves `gymDay`/`healthUrl`/`dinnerShare`, share absent = same object, applied after gym uplift gives `(160+20)*0.375`); `loggedGaps` (below `loggedGapDays` = [], a nutrient covered 1 of 4 days = gap, 3 of 4 = not); `cycleMeals` (same cycle only, ignores later days, empty on a cycle's first day); `rankSlot` with `prefs.loggedGaps = ["vitD"]` puts a vitD meal ahead of an otherwise equal one and never admits a `never` meal; `validateReply` keeps `why`, drops an over-long one.
- `worker_test.mjs`: `POST /plan/draft` with a KV eaten log short on a nutrient yields a draft whose dinners differ from the same call with an empty log; `ranking()` differs for a mid-cycle day vs day 1; `GET /nutrition?dates=` returns `dinnerShare` and `targets`; `PUT /settings` with `dinnerShare` is dropped as an unknown key.
- `walk.mjs` asserts: a generated plan's day chip shows `Protein ~Xg / 60g` (with the default share) and no "Short on" text; the week summary still shows the weekly short list; the meter bar width is Xg over 420 (60 x 7); with a seeded `mp_eatenLog` short on iron, regenerate puts an iron-tagged dinner among the first days; a chat `place` with `why` renders "Because: ..." on its card and one without `why` renders none. PC and 390 px, dark and light (`prototype-preview`).
- No real credential needed: Worker tests use fakes.

## Tasks
### Logic (TDD)
- [ ] 1. `test.html` cases above for `dinnerTargets`, `loggedGaps`, `cycleMeals`; implement in `nutrition.js`/`generator.js`; add `dinnerShare` and the two `planning` knobs; bump `sw.js` `CACHE`.
- [ ] 2. `rankSlot` unions `prefs.loggedGaps`; `pickMeal` uses `cycleMeals`; `test.html` rankSlot cases (loggedGaps reorder only, never admits a filtered meal); update existing generator cases that assumed per-day `dayMealsSoFar`.
- [ ] 3. `plan.js` consumers: `candidatesFor`, `tieFor`, prefs assembly with `loggedGaps` (the one caller of `Nutrition.loggedGaps` app-side), `chatBriefing` `nutrition` block.
- [ ] 4. Worker: `planInputs` `loggedGaps` (its caller of `Nutrition.loggedGaps`), `ranking()` via `cycleMeals`, `normalizeSettings` exclusion, `GET /nutrition?dates=` `targets` + `dinnerShare`; `worker_test.mjs` cases above.
- [ ] 5. `plan-chat.js` `place` keeps `why`; bridge prompt sentence + `test_hermes_chat_bridge.py` asserts it appears; `test.html` `validateReply` cases.
### UI (`ui-build`)
- [ ] 6. `coverageHtml` dinner-share protein chip (no "Short on"), meter target, `place` card "Because:" line (house style `docs/UI_STYLE.md`, both themes, PC and 390 px).
- [ ] 7. `walk.mjs` assertions listed in Verification.
### Docs
- [ ] 8. `SPEC.md`, `CLAUDE.md` invariants, `docs/FUTURE.md` handoff entry (below), `docs/roadmap.md` heading `[L]`.

## Handoff (not built here): health and diet screen in `notion_assistant`
Plan that project's phase separately (its own roadmap, `/plan-phase` run there). Data it can read today through the assistant token, no new route: `GET /nutrition?dates=` (per-nutrient `coveredDays`/`loggedDays`/`missedDays`, plus `targets` and `dinnerShare` after this phase), `GET /food-log`, `GET /eaten-log`, `GET /day`. "Compared to a healthy normal" = the logged days against `targets`; that screen should show the same gaps this phase feeds the generator and Hermes.
