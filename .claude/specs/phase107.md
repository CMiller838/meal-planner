# Phase 107: More measured foods and added sugars [M]
Plain: the Eaten page can show added sugars and trans fat as measured numbers, and many more everyday foods (bread, cheese, apples and so on) now have measured nutrient data instead of "no data".

Requires Phase 106 (`eaten.js` `ROWS`; unbuilt, so `/overnight` must build it first). If 106 is somehow absent, build only the data tasks and skip the ROWS task.

## Decisions
**User-chosen (2026-10-27)**
- Map scope: the 3 unmapped library keys **plus about 30 common staples**. Vitamins E, K, B6 are **out** (go to `docs/FUTURE.md`).

**Findings**
- The roadmap said "38 mapped foods": `cofid-map.json` holds 29 ingredient keys (38 CoFID codes with cooked variants). The library's 32 ingredient keys are 29 mapped already (49 of 52 uses); the 3 unmapped are `teriyaki_sauce`, `magnesium_tea`, `protein_powder`. A key with no sound CoFID match stays unmapped (no fill, never a guess).

**Own calls**
- **Map is data, hand-reviewed, regenerated.** Add codes to `tools/cofid-map.json`, rerun `tools/cofid_build.py`; `cofid.json` is never hand-edited. Staples are chosen from `food-log.json` `itemGrams` keys (apple, orange, sausage, rasher, crumpet, waffle, slice_bread...) plus common UK basics; builder uses `python3 tools/cofid_derive.py find <text>` to pick the closest plain food. The xlsx is downloaded by the builder to `$TMPDIR`, never committed (as Phase 33b; domain `assets.publishing.service.gov.uk`, may need the sandbox allowlist).
- **Do NOT run `cofid_derive.py apply`.** It would add ranking tags for the new keys, and tags feed `rankByGap`. Tagging stays a separate, deliberate step.
- **`addedSugars_g`** = CoFID's free-sugars column, **`transFat_g`** = CoFID's trans fatty acids column. The builder first lists the row-2 codes of `1.3 Proximates` and the fatty-acid sheet and picks the free-sugars and trans columns by code (expected FREESUG; trans code unverified). A column that does not exist in the xlsx is dropped from the builder's `SHEETS` and said so in the commit note; the key then stays unknown everywhere. `N`/blank omitted, `Tr` = 0 (existing rule).
- **USDA side (food-log estimates):** add `addedSugars_g: 1235`, `transFat_g: 1257` to `food-log.json` `usdaIds` and both keys to `tolerance.macroKeys`. Where no source has a value the key is absent (unknown, never 0).
- **Targets:** `addedSugars_g_cap: 30` (NHS/SACN free-sugars guidance; add the line to `SPEC.md` "Nutrition targets") and `transFat_g_cap: 3` (my number: WHO under 1% of energy at 2900 kcal; no UK cap). `_cap` keys are ignored by tag scoring and `foodAsEaten` (as the existing `saturates_g_cap`).
- **Display-only:** nothing here feeds `rankByGap`, the generator or tags. `products.js` `LABEL_KEYS` unchanged (Open Food Facts has no such fields); `fillFromCofid` will copy the new keys into products via `setNutrients`, harmless if the pantry detail ignores unknown keys (builder greps `shopping.js` ~line 195 list).

## Files touched
- `tools/cofid-map.json` (3 gaps + ~30 staples), `tools/cofid_build.py` (`SHEETS` gets the two columns; sheet may be a new one), `cofid.json` (regenerated)
- `food-log.json` (`usdaIds`, `macroKeys`); check `worker/food-log.js` for any hardcoded nutrient list or `window` use
- `nutrition-targets.json` (two caps), `SPEC.md` (two lines)
- `eaten.js` (`ROWS` gets two cap rows after saturates, if Phase 106 is built), `style.css` only if a row needs it
- `tools/test_cofid_derive.py`, `test.html` (cases below), `sw.js` (bump `CACHE`; `cofid.json` and `food-log.json` are cached), `CLAUDE.md` invariant list (extend the CoFID line: free sugars and trans fat are measured caps, absent = unknown)

## Signatures
No new functions. `SHEETS[sheet][code] = key` gains `"FREESUG": "addedSugars_g"` and the trans code → `"transFat_g"` (codes confirmed against the xlsx). Consumers: `eaten.js` `ROWS` renders both keys through the existing `rollUp`; `worker/food-log.js` reads `usdaIds` generically.

## Edge cases
- Mapped food with no free-sugars value: key absent, so the Eaten row says "unknown" or "at least X" (Phase 106 rules), never 0.
- A staple whose only close match is a different form (dried, cooked): use `cooked`/`default` variants as the map already does; if unsure leave it out.
- Re-run must be deterministic: `cofid.json` diff after a second run is empty.
- Unknown food code or header drift: builder exits 1, writes nothing (existing behaviour).

## Verification
- `python3 tools/cofid_build.py "$TMPDIR/cofid.xlsx"` exits 0 and a second run leaves `git diff --stat cofid.json` unchanged.
- `python3 tools/test_cofid_derive.py` and `python3 check.py` (data_check sees the `sw.js` bump; ui pages show the Eaten rows).
- No real credential needed (USDA is only tested with fakes).

## Tasks
Logic
- [ ] Download the xlsx to `$TMPDIR`, list the row-2 codes, confirm the free-sugars and trans columns (or drop the missing one and note it).
- [ ] Map the 3 library gaps and ~30 staples (hand-review each code against the sheet; spot-check 3 values).
- [ ] Add the two columns to `cofid_build.py`, regenerate `cofid.json`.
- [ ] `food-log.json` `usdaIds`/`macroKeys`; `test.html` case: a food-log estimate with the two keys agreeing across 2 sources is accepted, a key one source has stays unknown.
- [ ] Targets + `SPEC.md` lines; confirm no target iteration breaks on the new caps (grep `Object.entries/keys/values` of targets).
- [ ] Check: every library ingredient key mapped or listed as deliberately unmapped (a one-off script in Verification, not committed).
UI
- [ ] `eaten.js` `ROWS`: add Added sugars and Trans fat cap rows; check them at PC and 390 px, both themes, and that a food with no value shows "unknown".
- [ ] `sw.js` `CACHE` bump; `CLAUDE.md` CoFID line.
- [ ] Live: confirm the 30 g added-sugars and 3 g trans-fat caps are the numbers you want.
