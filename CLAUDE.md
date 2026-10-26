# CLAUDE.md

Guidance for Claude Code in this repo.

## Project state

Meal Planner is built and live on GitHub Pages: Browse & Add, Discover, 2-Week Plan, Plan with me and Shopping pages,
backed by seeded `meals.json`, TheMealDB-sourced suggestions, nutrient-coverage scoring, shelf-life/leftover warnings,
a PWA shell, and a Cloudflare Worker (`worker/`) that bridges it to Hermes and the personal assistant. The active
roadmap is `docs/roadmap.md` (v5, Phases 27+). Requirements and rationale live in `SPEC.md` (read it before changing
planning logic, nutrition targets or shelf-life rules: those numbers are deliberate), the stack in
`docs/ARCHITECTURE.md`, parked ideas in `docs/FUTURE.md`, history in `git log`.

- "What's next" = read the `/next` pane's sources fresh (`docs/roadmap.md`, `tasks.md`, `.claude/build-status.json`),
  never a dated memory or handoff note.
- `docs/roadmap.md` is the single active roadmap. Superseded versions live in `.claude/archive/`. Never create a new
  versioned roadmap file: overwrite `docs/roadmap.md` in place, archiving its prior content first. Phase headings are
  `## Phase N: Title [S|M|L] — not started` and the `/next` pane and `/overnight` queue parse exactly that.
- **Before every commit, mark the roadmap.** A commit that finishes a phase appends `— done` to its heading and
  records what was verified. Enforcement: the `roadmap-gating` skill.
- **One phase, one commit.** Commit each phase once the tester passes it, so phases never pile up and interleave in
  shared files. Live checks only the user can do are `- [ ] Live: ...` lines in `tasks.md`, cleared later with `/live`.
  Planning is the exception: several specs in one sitting, left uncommitted, then `/overnight` builds and commits them
  one phase each.
- **Every commit that touches site files or the Worker redeploys itself** (post-commit hook, `tools/deploy.sh`):
  it publishes `main`, redeploys the Worker if it or a module it bundles changed, waits until the live site serves
  the new `sw.js` cache name and reports to Telegram. Skip once with `AUTO_LAUNCH=0` before the commit command.
  Bump `CACHE` in `sw.js` whenever a cached file changes (`data_check.py` fails the commit otherwise).

## Commands

```
python3 -m http.server 8000   # serve the static site, then open http://localhost:8000/index.html (no build step)
python3 check.py              # every self-check, one line each (non-zero exit on failure):
                              #   data_check = JSON data, PWA shell, worker imports, sw.js cache bump
                              #   secrets    = secret scan of tracked files
                              #   ui pages   = test.html (all assertions) + every page at PC and phone, dark and light
                              #   ui walk    = click-through: browse, meal sheet, theme, plan generation, shopping
                              # full run exceeds the 120 s default Bash timeout: pass timeout 600000 or use `runner`
python3 check.py --changed    # only what the uncommitted changes need (the Stop hook); `python3 check.py ui` = browser checks
python3 data_check.py         # the data/PWA-shell check alone
cd tools/browser-check && npm ci && PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers npx playwright install chromium   # once
node tools/browser-check/ui-check.mjs --theme-key mp_theme --shots out/   # pages check with screenshots (run from tools/browser-check;
                              # prefix PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers, as check.py does; use it to see a failing test.html error `check.py ui` hides)
```

Adding or changing a Worker route (`ROUTES` in `worker/worker.js`)? Rerun `node tools/routes_build.mjs` and commit `worker/routes.json`: `worker_test.mjs` fails on a stale one.

No lint/build/formatter: don't invent one unless asked. `tools/browser-check` is test tooling kept apart from the app;
the app itself stays zero-dependency. Secrets live in the gitignored `.env` (Telegram: `NOTIFY_BOT_TOKEN`,
`NOTIFY_CHAT_ID`, `NOTIFY_PROJECT`: the same bot as the assistant, every message starts `[Meal Planner]`).

## Stack

Static site: vanilla JS (ES modules-free, plain `<script>` includes), vanilla
CSS, no framework, no backend, no sign-up. Deployed to GitHub Pages. All state
(liked meal library, theme, dismissed suggestions) persists in browser
`localStorage` — there is no server and no database. Nutrition/meal images and
suggestions come live from TheMealDB's free public API (no key required).
Installable as a PWA on Android Chrome via `manifest.json` + `sw.js`.

- **A new cross-file dependency between plain `<script>` modules (file A now uses `MP.X` from B) means every HTML page
  loading A must also load B, before it.** Grep `*.html` for pages with A but not B before finishing.
- **Never add a new dependency (npm package, CDN script, build tool) without
  confirming with the user first.** The zero-build-step, zero-dependency shape
  is intentional (GitHub Pages, must "just open and work").

## Architecture invariants

- **The `window` → `root` shim (`exclusions.js`'s pattern) now also covers
  `nutrition.js` and `generator.js`** (Phase 26), since `worker/worker.js`
  imports them to compute `GET /ranking`, **and `data.js`, `shelf-life.js`,
  `shopping-list.js`** (Phase 32, `GET /shopping`). Don't reintroduce a bare
  `window.` reference at the top level of any of those files (data.js's
  browser-only functions, e.g. `saveLibrary`'s event, are never called by the
  Worker). `buildLists` now has the Worker as a second caller — it stays the
  one shopping-list implementation; pack data is imported and passed in.
- **Two Worker credentials, never conflated** (Phase 32): `AUTH_TOKEN` is
  Hermes's; `ASSISTANT_TOKEN` is the personal assistant's, scoped by
  `ASSISTANT_ALLOWED` to reading the plan side, the `/eat-requests` queue and everyday edits (pantry, ad-hoc list,
  plan flag, placements; `/library` append only, 2026-10-17).
  Don't widen it to a key the assistant doesn't need. `rankSlot` (`generator.js`) now has
  a fourth caller (the Worker) alongside `plan.js`'s three — it's still the
  one ranking implementation; a fourth caller reimplementing any part of it
  is the bug, not a design choice.
- **No `innerHTML` with unescaped TheMealDB (or any external) content.** Every
  string from TheMealDB must go through `esc()` in `data.js` or use
  `textContent`/`el.value` — it's untrusted third-party content.
- **Nutrition targets and nutrient tags are data, not inline constants.**
  `nutrition-targets.json` and `ingredient-nutrient-tags.json` are the single
  source; don't hardcode macro/vitamin numbers in JS. The approximate
  high/med/low tagging system is deliberate — it's a coverage checklist, not a
  precise calorie calculator; don't "upgrade" it into fake-precise math.
- **Later ranking layers only reorder `rankByGap`'s output, never re-score or filter.** Nutrition (`MP.Nutrition.rankByGap`)
  decides which meal. On top of it, `generator.js` may: cost-compare its top candidates (`budget` step, Phase 17;
  `pressureFor`/`shortlistSizeFor`, Phase 27, only scale how many it compares); apply chips (prefer-to-head /
  avoid-to-tail) and busy-day effort bias in `rankSlot` (Phase 22; chips never filter a meal out of the pool). Per-meal
  cost badges (`costTiers`, Phase 18) are informational: they never sort or filter. `pack-sizes.json` (`categories`/
  `keywords` pricing, `planning` knobs `shortlistSize`/`reuseCredit`, `costTiers`) and `plan-preferences.json` are data,
  not inline constants.
- **Pantry stock never reorders nutrition either.** `generator.js`'s
  `pickVariant` (Phase 21) only chooses which variant of an already-chosen
  meal to schedule — nutrition ranking via `pickMeal`/`rankByGap` decides which
  meal, same rule as cost above. The generator is a second pantry **reader**
  (`MP.ShoppingList.pantryIndex` fed from `MP.Sync.localItems("pantry")`);
  `plan.js`'s `commitCook` remains the only pantry **writer**.
- **Shelf-life logic in `shelf-life.js`/`shelf-life.json` is category-based**
  (no purchase-date tracking exists) — shop day = every 7 days from `plan.shopAnchor` (day 1 and day 8 when absent), cooked day = first day a dinner is scheduled. Don't add
  per-SKU or purchase-date tracking without the user asking.
- **Batch-cook / leftover chains** (`MP.isBatch(meal)` — `servings >= 2 &&
  !leftoverOf`, `data.js`) are a planning primitive — the generator must
  schedule leftovers into the following 1-2 days, not force every ingredient
  into one dinner.
- **Cook vs. portion is two events, never conflated.** `plan.js`'s
  `commitCook` deducts the pantry exactly once per cook instance and may open
  an `MP.Cooks` record for the leftover portions; `eatPortion` writes one
  nutrient-log entry per sitting and must never call anything pantry-related
  (`eatPlan`, `applyOps`, `writeLocalItems`, `queueOp`). Don't add a
  convenience path that lets a portion-eat touch the pantry.
- **`mp_planUndo` (Phase 63) is a one-level snapshot of the plan taken just before a re-flow, not plan state**: `MP.Plan.restore` is its only reader. A re-flow (`MP.reflowPlan`, `data.js`) only regenerates freed slots and never writes the pantry; `ranOut` keys are dropped from the generator's `have` index for that call.
- **`mp_planPrefs` is settings, not plan state** (Phase 23): it holds only
  `{ updatedAt, busyDays, chips, budgetTarget, freezeBatches, repeatGap, rolling, timeCaps }` (Phase 88: `timeCaps` = `{weekday 0-6: minutes 5-240}`, every `PlanPrefs.save` caller passes it through), never a meal id or date.
  `budgetTarget` (Phase 27) is a plain £/week number where `0` means no
  target. Losing it degrades to today's behaviour (no busy days, no chips, no
  budget target). `MP.PlanPrefs`
  (`plan-with-me.js`) is its only reader/writer; `plan.js` reads it for
  **both** entry points, so one-tap Generate is never replaced by the
  "Plan with me" setup screen — it only becomes preference-aware.
  `hermes-sync.js`'s `fetchPlanPrefs`/`pushPlanPrefs` (Phase 25) pull/push
  through `MP.PlanPrefs.get`/`save` and never touch `localStorage` directly.
- **`guidedActive` is what keeps the guided walkthrough/review (Phase 24)
  stateless on exit.** `plan.js`'s `setSlotMeal`/`setSlotVariant` only call
  `savePlan()` when it's `false`; abandoning the walkthrough or review step
  before "Looks good" leaves `mp_plan` untouched. Don't add a second save
  path that bypasses the flag.
- **Substitution groups (Phase 28) are data, not inline constants.**
  `substitution-groups.json` is the only source of swappable ingredient
  pairs — swaps never come from free-form matching. `generator.js`'s layer 4
  (`subsFor`) credits a swap via `pack-sizes.json`'s `subCredit`, but only
  reorders the shortlist `rankByGap` already produced; it never re-scores
  nutrition, never filters a meal out of the pool, and a swap is dropped
  (never the meal) when `MP.Exclusions.check` rejects the swapped recipe —
  the hard exclusions run *after* substitution, never bypassed by it.
  `slot.subs` (`[{ from, to, label }]`, generator-written only, alongside the
  existing `variantId`) is resolved through `MP.effectiveMeal`/`MP.applySubs`,
  the same chokepoint the shopping list, pantry deduction, shelf-life pass
  and detail sheet already read `variantId` through. `substitutions.json`
  remains a separate, unrelated concern (exclusion swap-ins for Discover).
- **`dayHints` (Phase 37) is assistant-written and read-only in the app**: a KV key keyed by ISO date, never a field of
  `plan` or `mp_planPrefs`. `MP.DayHints.merge` adds busy hints to the user's `busyDays` (user busy beats `free`); hints
  only reorder (`rankSlot`'s `freeDays`/busy layer). Dismissals are local (`mp_dayHintOff`), never pushed.
- **Products (Phase 33a) are reference data, never planning input**: the generator, `rankByGap` and `buildLists` never read
  `products`. A nutrient's `basis` precedence is `label > off > cofid > usda > estimate` (a lower basis never overwrites a
  higher one), an absent nutrient key means unknown (never 0, an empty input never becomes 0), and `MP.Products` is the
  only place that shapes a record. The Pantry tab never writes the pantry.
- **CoFID values are estimates by ingredient match** (Phase 33b); `cofid.json` is generated by `tools/cofid_build.py`, never hand-edited.
- **An eating-out slot (Phase 81) is `{ eatingOut: true, name?, text?, foodLogId? }`** (name <=60, text <=200): `reflowPlan` keeps it sticky, `planMirror` whitelists those fields, the app logs the estimate with `POST /food-log` (id = `foodLogId`; offline = "estimate pending", never blocks). `MP.pushSlot`/`MP.moveSlot` (`data.js`) are pure, never write the pantry, and undo through `mp_planUndo`.
- **Swaps and past edits (Phase 82) never re-flow and never touch the pantry**: `MP.swapSlots`/`swapDays` (`data.js`, pure) refuse held slots and any swap that puts a leftover before its cook; `MP.backfillSlot` records what was eaten on a past slot and the app logs it with `logPortion` / `POST /food-log` only, never `commitCook`. All undo through `mp_planUndo`.
- **Chat/assistant plan actions (Phase 84) are edit types, never meals**: `start`, `skip`, `out`, `swap`, `swapDay`, `backfill` in `PlanChat.validateReply`, applied only through `MP.applyPlanEdits` (`data.js`, over the Phase 81-83 helpers; app chat and Worker `POST /plan/edit` share it). The Worker parks the result as a `planDraft` (a `start` draft carries `start` and the app regenerates via `generatePlan`); nothing applies unseen.
- **A `fromCook` slot (Phase 90a) buys nothing and eats via `eatPortion`, never the pantry; `plan.bulk` is written only by the bulk card's Accept and read only by `buildLists`/`bulkOptions`**: the generator reads neither.
- **Drafts (Phase 50) live in KV `drafts`, never the library; only an app accept (`MP.draftToMeal` → `upsertMeal`) moves one in, except the Phase 87 chat meal edits (below).** Inferred tags/cost/unreadable are display-only and dropped on accept.
- **Use-it-up (Phase 65) is a per-call pref, never stored**: `prefs.useUp = { items, window }` (built by `ShoppingList.useUpItems`) only reorders the first `window` of `rankSlot`'s shortlist (layer 3e); a placed meal consumes its items; absent = today's plan. Not in `mp_planPrefs`.
- **Ratings (Phase 51) are a nudge layer; `never` is the one filter**: `rankSlot`'s `opts.ratings` reorders up/neutral/down after the busy/free layers (never re-scores) and drops `never` meals with no small-pool fallback. Stored in KV `ratings`, written only via `PUT /meal/:id/rating`; `MP.Ratings` (`ratings.js`) is the only local reader/writer (`mp_ratings`). Phase 74: `ratings` is in `ITEMS` (object map by meal id), so a PUT carrying `X-Actor` is logged and undoable (undo restamps `at`, else the newest-`at` merge keeps the rejected note); the chat Reject with a reason and (Phase 88) the chat `rate` edit are the only callers that send it. The taste profile (Phase 62, `MP.Ratings.tasteProfile`) is derived from `mp_ratings` on read, reorder-only (top `planning.tasteWindow` of each rating group in `rankSlot`, plus Discover's `orderByTaste`), never stored.
- **Profile settings (Phase 52) are written only by `PUT /settings`; the app reads them** (`MP.Sync.settings()`, `mp_settings`). Allergies + `never` are hard (`Exclusions.termHit`, no pool fallback); likes/dislikes only reorder via `rankSlot`'s chip groups; `settings.budgetTarget > 0` overrides `mp_planPrefs.budgetTarget` at read.
- **`pantryAudit` (Phase 78) is advisory state, never written to the pantry**: KV `{ confirmed, snoozes }`, written only by `POST /pantry/audit`; `/pantry/audit` and `/pantry/sanity` read it. Removing an item stays the existing `PUT /pantry`.
- **The plan meter (Phase 70) is display-only and animates on edit only**: `renderMeter` (`plan.js`) reads `planMetrics`, updates a once-built DOM in place (instant on first paint, staged reveal, reduced motion). "Fix this gap" (`fixGap`) only reorders `candidatesFor` output with `rankByGap`, suggests one dinner swap and never edits without the user tapping Swap; cost never picks the fix.
- **The chat week grid, ticker, cook-time/over-cap flag and wrap-up (Phase 89) are display-only**: `renderChatWeek`/`renderTicker`/`cookMinsFor` read `planMetrics` against `chat.base` and never edit, rank or filter; `MP.Plan.wrapUp` is a pure informational checklist and never blocks Save. Accept/Reject all run the per-row `setChange`.
- **Planning chat (Phase 72) edits are constraints; Phase 87 adds `mealCreate`/`mealEdit`/`mealRemove`, which Phase 88 gates behind an Add/No card; Phase 88 also lets Hermes choose meals via `place` (`MP.placeSlots`, same hard checks, refusals shown) and set `cap`/`rate`**; meal edits are applied only by `MP.Plan.applyMealEdits` (`plan.js`) straight to the library via `upsertMeal`/`removeFromLibrary` after `MP.Exclusions.check` + profile terms (a failing meal is refused, nothing written); remove is refused while the meal or a leftover of it is in the plan; each change is a chat card with Undo and the library PUT is logged `X-Actor: hermes`; Exit does not revert meal changes. `MP.patchMeal` is the pure whitelist patch. `MP.PlanChat.validateReply` (`plan-chat.js`) runs in the Worker (`POST /chat/reply`) and again in the app before anything applies; unknown edit types are dropped. `chatPrefs` is session memory merged over `basePrefs` as a per-call `override`, never written to `mp_planPrefs`. The `ChatRoom` Durable Object holds only the chat thread (no plan state); a re-pick goes through `generatePlan`/`rankSlot`/`MP.Exclusions`, and Exit leaves `mp_plan` untouched via `guidedActive`.
- **Plan length and start (Phase 83) are per-generation options, never stored prefs**: `generatePlan(..., locked, opts)` takes `opts.days` (1-28, default 14) and `opts.firstSlot` (day-1 slots before it stay empty; stored as `plan.firstSlot`, carried by `planMirror`, dropped when the plan rolls). Shop day = `MP.shopAnchorFor(start, weekday)` as `plan.shopAnchor`. Day bounds are 1..28 everywhere; the Worker reads the length and `firstSlot` from the mirror. Set only by Plan with me's Customise (URL `days`/`first`/`shop`).
- **Hard content exclusions are enforced in code, not just docs**: no
  mushrooms (including from TheMealDB results), no standalone egg meals
  (egg-within-a-dish is fine), no vegetables in toasties. These came from
  explicit user dietary preference — don't relax them for "better" suggestions.
- **Dark mode defaults on**, persisted in localStorage, toggle in shared nav.
- **The Hermes-accepted staged plan reveal (Phase 29) is render-side only.**
  `generatePlan` stays synchronous and `generator.js` has a zero-line diff —
  the reveal is cosmetic staging of an already-final plan, not a live
  generator trace. `plan.js`'s `renderPlan(staged)` is a flag on the one
  render function (never a second render path); staging is a CSS
  `animation-delay` stagger over already-wired `.slot-card` elements, so
  mid-reveal interaction needs no blocking or cancellation. Coverage/warnings
  render once against the final plan, not per stage. Only the
  `hermes-generate` handler passes `staged: true`; every other `renderPlan()`
  call site stays a bare, instant call.
- **The food log (Phase 80a) is Worker-owned KV `foodLog`, written only by `POST /food-log`**: entries freeze their nutrients at log time, an absent key means unknown (never 0), and an estimate needs 2+ distinct agreeing sources (`food-log.json` tolerances). Off-plan food reaches coverage only through `Nutrition.foodAsEaten`; stock (`have`) entries never count. Planned-slot eats and `commitCook` are unchanged. Phase 85: the same route also takes `meal` (items logged as `${id}:${i}` with `group`/`meal`) and `remove` (one entry or a group; never touches the pantry; undoes via activity).
- **A pantry/ad-hoc `qty` (Phase 30) is a free-text string or a structured `{ value, unit, raw }` object**, never a
  second sibling field. `MP.ShoppingList.parseQty` is the only reader of its structure and `MP.qtyText` (`data.js`) the
  only reader of its display text. Quantity, plus an optional `useBy` (Phase 34) and `storage` (Phase 43, fridge|freezer|cupboard): no price, pack size or purchase date on a pantry item (pricing is
  `pack-sizes.json`'s job, shelf-life stays category-based). Quantities arrive only through the existing `PUT /pantry` /
  `PUT /adhoc` relay: no new endpoint, route or KV key. Library ingredient `qty` (`meals.json`) stays free text.
  **A computed remainder (Phase 31) is always structured**: `MP.ShoppingList.remainingQty` is its only producer (the
  pantry is a running balance, never a re-rounded display string). `pantryOverlap` means "on hand **in sufficient
  quantity**": absent is not counted, unparseable/unit-mismatched/amount-unknown stock falls back to "present".
  `commitCook` (`plan.js`) is the only app-side writer of `qty` (the Worker's `POST /food-log`, Phase 80a, also writes it: deduct on eat, add on have); the Pantry tab also writes `useBy` and `storage`, and only those. `MP.Cooks` is mirrored to KV `cooks` via `MP.Sync.pushCooks` (Phase 43, `PUT /cooks` is Hermes-only); the portion-eat path still never touches the pantry.

## Working style: plan with the user, build and test alone

Planning stays interactive (`plan-phase` gates, decisions asked). Once a spec is agreed, build and test **without
checking in**:
- run `python3 check.py` (or the `runner` agent);
- serve the site and drive the feature yourself (Playwright via `tools/browser-check`, `prototype-preview`), on PC and
  phone widths, both themes;
- try bad input, and use a fresh browser profile for data.

Ask only for a real blocker: real data, a credential, a live human step (the installed phone PWA), or a decision the
spec leaves open.

`/build` (the `build-handoff` mod) hands the newest spec to a fresh builder (always Sonnet), then to the `tester`
agent, with one fix round. `/overnight` does the same for every queued spec, unattended, one commit per phase, each
deployed on commit. Otherwise never commit or push unasked.

## Project lifecycle

Full detail: `WORKFLOW.md`. Short version: `idea-interview` (outline + FUTURE.md) → `architect` (stack →
ARCHITECTURE.md) → `plan-phase` roadmap mode → per phase: `plan-phase` phase mode (spec + tasks) → build (TDD for
logic; UI via `ui-build`) → `tester` → commit (auto-deploy) → `/live` for human-only checks → repeat until the
roadmap is done → `project-retro` → v2. This project shipped its MVP directly from `SPEC.md`: treat it as the
equivalent of the ARCHITECTURE.md plus Phase 1 spec.

## Token discipline

Cost is the context re-sent on every call, not output. So: Grep before Read and read line ranges, never `tasks.md`,
`docs/roadmap.md`, `docs/ARCHITECTURE.md` or any big source file whole (`tasks.md`: Grep `^## Phase N`); use Sonnet by
default, Opus only for a real architectural fork; `/clear` between unrelated tasks and `/compact` near 100k tokens;
send bulk work (check suites, wide greps) to `runner`/`scanner` (Haiku); a long `[L]` build is built and committed one
section at a time.

## UI work

Every UI change follows the `ui-build` skill and the house style in `docs/UI_STYLE.md` (Cork Kitchen: tokens in
`style.css`, dark default, animated, both themes at PC and 390 px checked with `prototype-preview`). `ui-prototyper` is only for new
visual ideas the user asks for; the user's pick is applied by `restyle-from-prototype`, which updates `docs/UI_STYLE.md`.
No new dependency or CDN script without confirming.

## Keeping Claude's own files current

A user-level SessionStart hook (`~/.claude/hooks/stale_check.py`, weekly per project) checks CLAUDE.md, WORKFLOW.md,
`.claude` agents and skills, and memory. It flags broken path references and long-untouched files. When it reports
findings, tell the user briefly, propose specific fixes and apply only the approved ones; never delete on your own.
