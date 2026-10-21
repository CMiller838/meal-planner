# Phase 41: One-tap logs: routine items and water/caffeine counters [M]

## Decisions
- **Today card on `plan.html`** (user-chosen). No new page, nav or precache entry beyond bumping `CACHE`.
- **New KV key `today`** (user-chosen): `{ date: "YYYY-MM-DD", water: n, caffeine: n, gym: bool, routineDone: [routineMealId] }`.
  Worker `KEYS["/today"] = "today"`; `GET /today` + `PUT /today` added to `ASSISTANT_ALLOWED` (Hermes has it already).
  The assistant sets `gym`; the planner never reads the gym app. A stored `date` != today (Europe/London) reads as all-zero/false.
- **Routine items = library meals with `routine: { when: "daily"|"gymDays", time: "HH:MM" }`** (own call). They carry
  `tags`/`mealTypes: ["snack"]` like any meal so `logEaten` and `/nutrition` (which resolves `mealId` through the library)
  need no new shape. Seeded: magnesium tea (daily, 21:30), protein shake (gymDays, 18:00).
- **Routine items are excluded from the planning pool** (Browse pool for generator/Discover ranking) — they are logged, never scheduled.
  One filter at the pool source, not per caller.
- **Second tap = undo** (own call): removes the log entry id `routine:<mealId>:<date>` and the id from `routineDone`.
  Same id makes a double-log impossible (`logEaten` already dedups by id).
- **Gym toggle**: Phase 35 stores `mp_gymDay` locally. This phase makes the Today card's toggle the writer of `today.gym`
  and mirrors it into `mp_gymDay` so Phase 35's reader is unchanged. **Requires Phase 35** for the weekly view and the gym
  reader; if unbuilt the toggle still works and only writes `today.gym`.
- Caffeine mg per cup type: `counters.json` `{ caffeine: { cupMg: { coffee: 95, tea: 40 } }, waterGoal: 0 }` as data;
  UI shows "cups" plus "~N mg (approx.)" only when a cup type is chosen. `waterGoal` 0 = none (user sets it).
- Counters never touch the eaten log, pantry or generator. Routine logging never touches the pantry (portion-eat rule).
- Requires Phase 32 (done). Assistant side: `notion_assistant` Phase 60.

## Files touched
`meals.json` (2 routine meals), `counters.json` (new, check name is free: yes), `data.js` (pool filter `MP.planPool`/existing source),
`hermes-sync.js` (`fetchToday`/`pushToday`, local `mp_today`), `plan.js` + `plan.html` + `style.css` (Today card), `worker/worker.js`
(KEY, allowlist, VALIDATE.today), `data_check.py` (counters.json, routine meals valid), `sw.js` (CACHE bump + precache counters.json), `test.html`.

## Signatures
- `MP.Today.get() -> {date,water,caffeine,gym,routineDone}` (rolls over by date), `.bump(field, +1|-1)` (floor 0), `.setGym(bool)`, `.toggleRoutine(meal) -> "logged"|"undone"`, `.dueRoutines(meals, today) -> meals[]` (pure: daily always; gymDays only if `gym`).
- Worker `VALIDATE.today(o)`: object, `date` matches YYYY-MM-DD, `water`/`caffeine` integers 0..99, `gym` boolean, `routineDone` array of strings.

## Edge cases
Date rollover at London midnight; counter at 0 and "-1" stays 0; offline (local first, push best-effort as `logEaten`);
assistant and app both PUT `today` (last write wins, date-guarded; app re-fetches on resume before bumping); corrupt `mp_today` -> zeros;
routine meal deleted from library -> id ignored; gym turned on mid-day makes the shake due; turning off does not undo a logged one.

## Verification
Logging a routine item twice leaves one entry (undo removes it); `/nutrition` counts the shake's protein; generator output
for a fixed seed is identical with and without routine meals in the library; a day with no taps reads 0; counters sync via a
Worker `PUT`/`GET /today` round trip with the assistant token; assistant token still 403s on other paths; `python3 check.py`; Today card at PC and 390 px, both themes.

## Tasks
Logic (TDD, `test.html`)
- [ ] `MP.Today` pure functions: rollover, bump floor, dueRoutines, toggleRoutine undo
- [ ] Planning-pool filter drops `routine` meals; generator seed output unchanged
- [ ] Worker: `/today` key, `VALIDATE.today`, allowlist entries; round-trip test
- [ ] `counters.json` + `data_check.py` validation; `sw.js` CACHE bump
UI (`ui-build`)
- [ ] Today card: due routine chips with Had it / Done (tap to undo), water and caffeine +1/-1, gym toggle
- [ ] `- [ ] Live:` check in `tasks.md`: assistant sets gym and the shake appears on the phone PWA
