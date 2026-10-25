# Phase 85: Log and show every meal Hermes sends [M]
Plain: Hermes can log a whole meal (several foods at once) or remove a wrong entry, and you can browse everything logged, day by day, in the app.

Requires: Phases 80a, 80b (`POST/GET /food-log`, `MP.Sync.localFoodLog`, `Nutrition.foodAsEaten`).

## Decisions
**User-chosen (2026-10-25)**: food and meals only, using the existing food log. No generic journal.
**Own calls**
- No new KV key, no new route. `POST /food-log` gains two actions: `meal` and `remove`. Written only there (80a invariant holds).
- `meal` = `{ id, action:"meal", name, when?, items:[{ text|name, grams?, count?, gramsPerItem?, lookup?, candidates? }] }` (1-12 items).
  The Worker runs each item through the existing resolver as an `eat`, with id `${id}:${i}`, storing `group: id, meal: name` on each
  entry. Replay is per item, so a replayed meal is all `duplicate`. Items needing grams return `needs-grams`; the rest still log.
- `remove` = `{ id, action:"remove", target }`: drops one entry or every entry with `group === target`. It never touches the pantry (the
  result says so); the pantry is fixed through the activity undo. Logged to activity so it undoes.
- Display: a Food log sheet opened from the Today card's "Also eaten" header: last 7 days, entries newest first, a meal group is one
  collapsible row (summed known nutrients, "N unknown" listed), each entry shows grams and nutrient chips with basis (`label`,
  `estimate`, unknown). Remove sends `remove`. Reads only `MP.Sync.localFoodLog()`.
- Today's "Also eaten" and gap strip show a grouped meal as one row. Coverage maths is unchanged (`foodAsEaten` per entry).
- Escape every name with `esc()`. No new dependency.

## Files touched
- `worker/worker.js` (POST /food-log: `meal`, `remove`; `ROUTES` unchanged so no routes rebuild), `worker/food-log.js` (validation)
- `tools/worker_test.mjs`
- `hermes-sync.js` (`removeFoodEntry`; mirror already carries `group`/`meal`), `plan.js` (Also eaten grouping, sheet open),
  `plan.html` (sheet markup), `style.css`, `sw.js` (bump CACHE), `test.html`, `CLAUDE.md` (food-log invariant: `meal`/`remove`)
- Window shim: no new shared file.

## Signatures / schemas
```
Entry += { action: "meal", name: string<=60, items: [Item] (1-12) } | { action: "remove", target: string<=80 }
Stored entry += { group?: string, meal?: string }
Result for meal: { id, status: "logged"|"duplicate"|"partial", items: [Result] }
MP.Sync.removeFoodEntry(target) -> "ok"|"error"
```

## Edge cases
- Meal with one `needs-grams` item: status `partial`, others logged, nothing for that item.
- `remove` of an unknown target: 404, nothing written. Unknown keys -> 400 whole body.
- Meal of 13 items or empty `items`: 400.
- A group where every nutrient is unknown shows "unknown", never 0.

## Verification
- `node tools/worker_test.mjs` (meal logs grouped, replay is all duplicate, partial, remove one and group, pantry byte-identical after remove)
- `python3 check.py` (test.html grouping assertions, ui pages, ui walk)
- Browser run with a seeded `mp_foodLog` mirror: Food log sheet at PC and 390 px, both themes. No real credential needed.

## Tasks
Logic (TDD)
- [ ] `meal` and `remove` parsing/validation in `worker/food-log.js`
- [ ] Worker expansion to per-item entries with `group`/`meal`, remove with activity entry
- [ ] worker_test cases above
UI
- [ ] Group meals in Also eaten; Food log sheet with collapsible groups and Remove
- [ ] `removeFoodEntry` in hermes-sync, bump `sw.js` CACHE, CLAUDE.md invariant line
- [ ] Live: ask Hermes to log "Spoons burger meal: burger, chips, cola" and see one group in the Food log view on the phone PWA
