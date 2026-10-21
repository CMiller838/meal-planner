# Phase 35: Weekly nutrient-gap view and gym-day targets [M]

Informational only: nothing here changes what the generator picks, `rankByGap`'s tag inputs, or any score rule.

## Decisions

**Own calls (no user gate; nothing here is a toss-up):**
- **Name clash:** `MP.Nutrition.weekCoverage` already exists (pools a week's meals into one `dayCoverage`, used by
  `plan.js` week summary). Leave it alone. New function is `weekGaps`.
- **Shared per-day scoring.** The orphan handling (eaten entry whose meal left the library counts by frozen tags as
  *partial*, never covered) currently lives inline in `worker.js` `nutrition()`. Move it to `nutrition.js` as
  `eatenDayCoverage` and have both `nutrition()` and `weekGaps` call it: one implementation, and `/nutrition` output
  without `gym` stays byte-for-byte identical.
- **Gym uplift = data.** `nutrition-targets.json` gets `"gymDay": { "protein_g": 20, "energy_kcal": 300, "carbohydrate_g": 50 }`
  (extra amounts added to the base). **These numbers are placeholders**; `_note` says so and the user edits them.
  `dayCoverage` only reads `protein_g` today, so the visible effect is the protein target; energy/carb are carried
  in the response for the assistant.
- **Uplift applies by building a targets copy** (`withGymDay(targets)` in `nutrition.js`) passed to `dayCoverage`. Tags,
  scores and `rankByGap` are untouched.
- **Manual gym toggle: yes**, a small checkbox on the plan page's weekly strip header ("Gym day today"). Stored in
  `localStorage` `mp_gymDay` as `{ date: "YYYY-MM-DD" }` (counts only while `date` is today; no sync, no Worker key).
  The assistant uses `gym=1` instead. UI text says "gym-day target" whenever the uplift is applied.
- **Week window:** `from`/`to` inclusive Europe/London days, max 14 days, `to` defaults to today, `from` to `to`-6.
  Both given and bad, reversed or > 14 days → 400. `date=` keeps working unchanged; `date` plus `from`/`to` → 400.
- **Per-nutrient output:** `{ nutrient, coveredDays, loggedDays, missedDays, flag }` where "covered" = day status
  `covered`; partial/missing days count as not covered; `flag = true` when `missedDays >= 3` (missed = day's status
  `missing`, not partial). Days with no log entries are `loggedDays` excluded and listed in `notLogged: [dates]`.

## Files touched
`nutrition.js`, `nutrition-targets.json`, `worker/worker.js`, `plan.js` + `plan.html` (strip), `style.css`, `test.html`,
`sw.js` (bump `CACHE`), `docs/ARCHITECTURE.md` only if it lists `/nutrition` params (Grep first).

## Signatures
```
eatenDayCoverage(entries, byId, tags, targets) -> { cov, missing, partial }   // cov = dayCoverage result
weekGaps(entries, byId, dates, tags, targets, dayKey) -> { days: [{date, logged}], nutrients: [...], notLogged: [...] }
   // dayKey(entry) -> "YYYY-MM-DD" (caller supplies tz logic; Worker = London formatter, browser = same)
withGymDay(targets) -> targets copy with gymDay amounts added; returns targets unchanged if no gymDay block
GET /nutrition?date=..[&gym=1]            // adds gym:true and the uplifted proteinTarget; otherwise identical
GET /nutrition?from=..&to=..              // { from, to, nutrients, notLogged }  (base targets only)
```
`gym=1` is accepted only with `date=` (400 with `from`/`to`). The weekly view always uses base targets.

## Edge cases
- Empty log / no days logged → all nutrients `loggedDays: 0`, `flag: false`, `notLogged` = every date.
- Entry with no `eatenAt` or bad date → skipped. Unknown `mealId` → orphan path.
- Library missing in KV → `meals = []`, so everything is orphan: still no crash.
- `gym=1` with no `gymDay` block → no change, `gym` omitted.
- Browser: eaten log read via `localStorage` `mp_eatenLog` (same key `hermes-sync.js` uses); strip hidden state "No meals logged yet" when empty.
- Assistant token: `GET /nutrition` already in `ASSISTANT_ALLOWED`; no widening.
- No `innerHTML` with unescaped content: nutrient names go through `labelize` + `esc`.

## Verification
- `test.html`: fixture week (full day, partial day, empty day, orphan entry): flags, `notLogged`, orphan stays partial;
  `withGymDay` raises only `protein_g`, `rankByGap` result identical with and without; `eatenDayCoverage` equals old inline result.
- Worker: `wrangler dev` (or Node harness per memory, no backgrounded servers): `date=` response byte-identical to before
  for a fixed fixture; `from/to` happy path; 400s (bad date, reversed, >14 days, `gym` with window, `date` + window).
- UI: `python3 check.py`, then `prototype-preview` of plan page at PC and 390 px, dark and light, empty log and fixture log,
  gym toggle on/off.

## Tasks
### Logic (TDD)
- [ ] `eatenDayCoverage`, `withGymDay`, `weekGaps` in `nutrition.js` (+ export); test.html cases first
- [ ] `gymDay` block in `nutrition-targets.json` (placeholder note)
- [ ] Worker: `nutrition()` uses `eatenDayCoverage`; add `gym` and `from`/`to` handling and 400s
### UI
- [ ] Weekly strip per nutrient on plan page (days covered of logged, flag when missed ≥3, "not logged" days) via `ui-build`
- [ ] "Gym day today" toggle (`mp_gymDay`) showing "gym-day target" on the protein figure
- [ ] Bump `sw.js` `CACHE`; `python3 check.py`; roadmap heading `— done` with what was verified
