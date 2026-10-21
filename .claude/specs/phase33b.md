# Phase 33b: CoFID vitamin and mineral fill-in for products [M]

Part 2 of 2. Requires Phase 33a (`MP.Products`, `/products`, `syncProducts`). Decisions shared with 33a are in
`.claude/specs/phase33a.md`.

Label and Open Food Facts data carry about 8 nutrients. This fills the vitamins and minerals (and any label nutrient still
missing) from UK CoFID 2021 by the product's ingredient key, each marked `basis: "cofid"` and shown as "est.".

## Decisions

**User-chosen (2026-10-21):** ship CoFID in Phase 33.

**Own calls:**
- **Licence:** CoFID 2021 is on gov.uk under OGL v3.0 ("except where otherwise stated", © Crown copyright). Before
  converting, the builder lists the xlsx's sheet names and reads any notes/licence sheet. If it states other terms,
  **stop and report** (blocker). Otherwise record this attribution in `cofid.json` `_attribution`, in a `docs/ARCHITECTURE.md`
  line, and as a muted footnote in the product sheet when any `cofid` value shows:
  "Contains public sector information licensed under the Open Government Licence v3.0. Source: McCance and Widdowson's
  The Composition of Foods Integrated Dataset 2021."
- **Matching is data, not fuzzy code.** A hand-reviewed `tools/cofid-map.json` maps planner ingredient keys to CoFID
  food codes: `{ "<ingredientKey>": { "default": "<code>", "raw"?: code, "cooked"?: code, "dry"?: code } }`. The
  builder writes it for every key in `ingredient-nutrient-tags.json` and the library's ingredient keys, picking the
  closest plain food (e.g. rice → "Rice, white, basmati, raw" default plus a boiled code for `cooked`). A key with no sensible
  match is left out. No match means no fill (missing stays missing).
- **Bundle only what's mapped.** `tools/cofid_build.py` (stdlib only: `zipfile` + `xml.etree`, since there's no openpyxl or
  pip here) reads the xlsx (downloaded by the builder into `$TMPDIR`, **never committed**) and writes `cofid.json` at the
  repo root: `{ _attribution, _source, map: <copied from cofid-map.json>, foods: { "<code>": { name, nutrients: { key: number } } } }`.
  It stays small (tens of foods, not 3,000). Re-running the script is how the map changes.
- **Nutrients taken (per 100 g, edible portion):** energy kcal, protein, carbohydrate, fat, saturates, AOAC fibre (matches
  UK labels), total sugars, vitamin A as retinol equivalent (µg), vitamin C, D, B12, folate, calcium, iron, zinc,
  magnesium, potassium, sodium. Use the same key names as 33a (`vitA_mcg`, `vitC_mg`, `vitD_mcg`, `vitB12_mcg`,
  `folate_mcg`, `calcium_mg`, `iron_mg`, `zinc_mg`, `magnesium_mg`, `potassium_mg`, `sodium_mg`). Column-to-key mapping is
  a dict at the top of the script. CoFID cell codes: `N` (not determined) or blank → omitted; `Tr` (trace) → `0`.
- **Fill only absent keys** via `MP.Products.setNutrients(..., "cofid")`. Precedence already stops it overriding label/off.
  Per-100 ml products (`per: "100ml"`) are filled too (CoFID is per 100 g; the drink density error is tolerated and it's
  marked est. anyway: ponytail, convert with density if it ever matters).
- **When it runs:** `MP.Products.fillFromCofid(product, cofid)` drops the product's existing `cofid` entries, then
  fills from `map[ingredient][state] ?? map[ingredient].default`. It is idempotent, so `syncProducts(cofid)` applies it
  to every record and pushes only records it changed (bumping their `updatedAt`). That covers assistant-written records
  too, with no loop. Changing a product's ingredient or state re-fills on save.
- **USDA still not fetched** (needs an API key). Missing CoFID matches stay missing.

## Files touched

- `tools/cofid_build.py` (new), `tools/cofid-map.json` (new), `cofid.json` (new, generated, committed)
- `products.js`: `fillFromCofid`
- `hermes-sync.js`: `syncProducts(cofid)` takes the loaded `cofid.json` (the caller fetches it; `null` = skip fill)
- `shopping.js`: loads `cofid.json` once, passes it on, attribution footnote in the product sheet
- `sw.js`: `cofid.json` in `SHELL`, `CACHE` bump
- `test.html`: `fillFromCofid` cases with an inline mini cofid object
- `docs/ARCHITECTURE.md` attribution line, `CLAUDE.md` one line ("CoFID values are estimates by ingredient match; `cofid.json` is generated
  by `tools/cofid_build.py`, never hand-edited")

## Signatures

- `MP.Products.fillFromCofid(product, cofid): Product`: pure, never mutates
- `tools/cofid_build.py <xlsx> [--out cofid.json]`: exits non-zero if a mapped code isn't in the sheet or a mapped
  column header isn't found (header drift), printing which

## Edge cases

- Product with `ingredient: null` or an unmapped key: its existing `cofid` entries are removed, nothing is added.
- Product with a `label` fibre and a CoFID fibre: the label one is kept.
- `state: "cooked"` with no `cooked` code: uses `default`.
- `cofid.json` fails to load (offline first visit): sync runs without fill, and nothing is removed (`null` = skip, not "clear").
- Header text in the xlsx differs from expected: the script fails loudly, never writes a partial file.

## Verification

- `test.html`: fills absent micro keys with basis `cofid`; never overwrites `label`/`off`; `Tr` → 0 came through as 0;
  re-fill after an ingredient change removes the old `cofid` entries; idempotent (twice = once); `null` ingredient
  clears `cofid` entries; `state` picks the right code.
- Script: run it on the real xlsx; spot-check 3 foods against the sheet by hand (e.g. raw chicken breast protein,
  boiled spinach iron, semi-skimmed milk calcium) and record the numbers in the commit's roadmap note.
- `python3 check.py` green; the product sheet shows "est." on CoFID values and the attribution footnote, PC and 390 px, both themes.

## Tasks

- [ ] Download the xlsx to `$TMPDIR` (allowed_domains `assets.publishing.service.gov.uk`), list its sheets, licence check
- [ ] `tools/cofid_build.py` + `tools/cofid-map.json` → `cofid.json`; 3 spot checks
- [ ] `fillFromCofid` + tests (TDD)
- [ ] `syncProducts(cofid)` wiring, `shopping.js` load + footnote, `sw.js`
- [ ] Docs lines (`ARCHITECTURE.md`, `CLAUDE.md`)
