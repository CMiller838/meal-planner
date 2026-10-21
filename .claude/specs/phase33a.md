# Phase 33a: Product records, `/products`, barcode scan and the Pantry tab [L]

Risk: high (camera, third-party lookup, [L]): `/overnight` builds it after the lower-risk specs, with the specs that require it.

Part 1 of 2 (Phase 33b: CoFID fill-in, `.claude/specs/phase33b.md`, builds on this). The shared Decisions live here.

A per-product **reference** record (brand, pack, price, nutrition per 100 g/ml with provenance per nutrient, link to a
planner ingredient key). Filled by scanning a barcode on the phone (Open Food Facts lookup), by typing the label, or by
the assistant/Hermes writing it after reading a photo. Shown on a new **Pantry** tab on Shopping and in a product sheet.
**The generator never reads it**: `rankByGap`'s low/med/high tags stay its only nutrition input.

## Decisions

**User-chosen (2026-10-21):**
- **Home = a third "Pantry" tab on `shopping.html`** (next to Planned / Ad-hoc). It lists the pantry (read-only), each
  item with its linked product, a "Scan a product" button, and an "All products" list. Phase 34's use-by strip goes here.
- **CoFID fill-in ships in Phase 33** (as 33b). Licence checked at spec time: gov.uk publishes CoFID 2021 under the
  Open Government Licence v3.0 ("All content is available under the Open Government Licence v3.0, except where
  otherwise stated", © Crown copyright). 33b records the attribution.

**Own calls:**
- **Storage = one KV key `products` on the existing relay** (`KEYS["/products"] = "products"`), whole-key GET/PUT like
  `/pantry`, plus a `productsError` validator. No new route type. Both tokens get `GET`/`PUT /products` (phone scans and
  assistant photo reads land in one place). Writers fetch-then-write and merge per record (below).
- **No pantry shape change.** A product links to the pantry via `product.ingredient` (a planner ingredient key, e.g.
  `chicken_breast`); a pantry item shows the newest-`updatedAt` product whose `ingredient === MP.ShoppingList.normalizeKey(item.name)`.
  The pantry stays quantity only (`CLAUDE.md`), and the Pantry tab never writes the pantry (`commitCook` stays the only writer).
- **Values, in precedence order:** `label` (typed in the sheet, or written by the assistant from a photo) > `off` (Open
  Food Facts by barcode) > `cofid` (33b) > `usda` > `estimate`. A lower basis never overwrites a higher one. USDA is
  **not** fetched in this phase (it needs an API key); the enum accepts it so a later writer can use it.
- **Open Food Facts is fetched from the browser**, straight from `shopping.js`, like TheMealDB (checked 2026-10-21: it
  answers `access-control-allow-origin: *`). URL: `https://world.openfoodfacts.org/api/v2/product/{barcode}.json?fields=product_name,product_name_en,brands,product_quantity,product_quantity_unit,serving_quantity,nutriments`.
  Only the 8 label nutrients are mapped from OFF (its micronutrient fields are sparse and in grams). OFF strings are
  untrusted: `esc()` / `textContent` everywhere.
- **Scanner without a dependency:** `BarcodeDetector` (formats `ean_13`, `ean_8`, `upc_a`) over a `getUserMedia`
  rear-camera `<video>`. When it is missing (desktop, iOS) or the camera is denied, the sheet shows only the digits
  input, which is always present anyway (`inputmode="numeric"`). No WASM ponyfill.
- **Missing ≠ zero.** An absent nutrient key means unknown and shows "—". A typed `0` is a real 0. An empty input never
  becomes 0.
- **"est." marker** next to any value whose basis is `cofid`, `usda` or `estimate`; none for `label`/`off`.
- **Per serving is computed** (`value × servingSize / 100`), never stored.
- **No delete in this phase.** A wrong record can be edited. Delete needs tombstones for the merge; add it when it bites.
- **"Data confidence" totals** (how many products lack a nutrient) are deferred: nothing sums products until Phase 35/36.

## Files touched

- `products.js` (new; name checked free): `MP.Products`, pure logic + OFF mapping. `window` → `root` shim not needed
  (the Worker doesn't import it).
- `hermes-sync.js`: `syncProducts`, `localProducts`, `saveProduct`, exported on `MP.Sync`.
- `shopping.html` / `shopping.js`: Pantry tab, scan sheet, product sheet. Reuse `.modal-overlay` / `.modal-sheet` /
  `.modal-actions` from `style.css`; new CSS only for the nutrient table and the "est." marker (tokens only, per
  `docs/UI_STYLE.md`).
- `worker/worker.js`: `KEYS`, `ASSISTANT_ALLOWED`, `productsError`, `VALIDATE.products`.
- `sw.js`: add `products.js` to `SHELL`, bump `CACHE` to `meal-planner-v27`.
- `test.html`: `MP.Products` cases.
- `tools/browser-check/walk.mjs`: one Pantry-tab step.
- Docs: `docs/HERMES.md` (`GET`/`PUT /products` section + Credentials list), `docs/ARCHITECTURE.md` (KV schema line,
  endpoint line, and a short "v6 — product records" section stating the decision: separate record, informational
  only, two nutrition sources on purpose), `CLAUDE.md` (one invariant bullet: products are reference data; the generator
  never reads them; precedence and missing-≠-zero rules; `MP.Products` is their only shape logic).

## Schema

KV `products` → `{ updatedAt: ISO, products: Product[] }`

```
Product {
  id: string,                 // = barcode when barcode is set, else "p-" + anything unique
  barcode: string | null,     // 8/12/13/14 digits with a valid GS1 check digit
  name: string,               // non-empty
  brand: string | null,
  ingredient: string | null,  // planner ingredient key (snake_case, normalizeKey form)
  per: "100g" | "100ml",
  servingSize: number | null, // g or ml, > 0
  pack: { value: number, unit: string } | null,
  price: number | null,       // GBP per pack, >= 0
  state: "raw" | "cooked" | "dry" | null,   // set where it matters (rice, pasta, chicken)
  nutrients: { [key]: { value: number, basis: "label"|"off"|"cofid"|"usda"|"estimate" } },
  source: "scan" | "photo" | "manual",
  updatedAt: ISO
}
```

Nutrient keys reuse `nutrition-targets.json`'s names where one exists: `energy_kcal`, `protein_g`, `carbohydrate_g`,
`fat_g`, `saturates_g`, `sugars_g`, `fibre_g`, `salt_g` (the 8 label ones, `MP.Products.LABEL_KEYS`), plus the micro
keys 33b fills (`vitA_mcg` … `sodium_mg`). The Worker accepts any `/^[a-z0-9_]+$/` key so a new nutrient never locks a write out.

`productsError` (shape only, same style as `itemsError`): object with `products` array of at most 2000; each record has
a non-empty string `id` (unique), non-empty `name`, `per` in the enum, every `nutrients` entry has a finite `value >= 0`
and a basis in the enum, `barcode` null or digits with a valid check digit and `id === barcode`, and `updatedAt` an ISO string.
Optional fields may be absent or null. The check-digit test is duplicated in the Worker as 5 lines (it can't import
`products.js` without the shim). That duplication is the accepted cost.

## Signatures (`MP.Products`, all pure unless noted)

- `LABEL_KEYS: string[]`, `BASES: string[]` (precedence order), `ESTIMATE_BASES: Set`
- `validBarcode(digits: string): boolean`: GS1 mod-10 for lengths 8/12/13/14
- `fromOff(barcode, offJson): Product | null`: `null` when `status !== 1`; maps names, brand (first of the comma
  list), pack (`product_quantity` + unit), `servingSize`, `per` (`"100ml"` when the unit is ml/l/cl), the 8 `*_100g`
  nutriments with basis `off` (`energy-kcal_100g`, `proteins_100g`, `carbohydrates_100g`, `fat_100g`,
  `saturated-fat_100g`, `sugars_100g`, `fiber_100g`, `salt_100g`). Non-finite or absent values are omitted, never 0.
- `setNutrients(product, values: {[key]: number|null}, basis): Product`: sets each finite value where the existing
  basis is absent or of equal/lower precedence. `null`/`""`/`NaN` leaves the key untouched. A typed `label` value
  replaces anything.
- `isEstimate(entry): boolean`
- `perServing(product, key): number | null`
- `forIngredient(products, key): Product | null`: newest `updatedAt` with that `ingredient`
- `merge(local: Product[], remote: Product[]): Product[]`: union by `id`, newer `updatedAt` wins, ties go to remote
- `hermes-sync.js`: `syncProducts(): Promise<"ok"|"off"|"error">`: GET, `merge` with the mirror `mp_products`, write
  the mirror, PUT only when the merged list differs from remote. `localProducts(): Product[]`.
  `saveProduct(p): Promise`: stamps `updatedAt`, upserts into the mirror, then `syncProducts()`. Works offline
  (the mirror keeps it, and the next sync pushes it).

## UI

- **Pantry tab** (`#pantry`, `tab-pantry` / `panel-pantry`; extend `showTab`/`initTabs` to three names and
  update the ponytail note). It holds the "Scan a product" button, then the pantry list (`MP.Sync.fetchPantry()` →
  `qtyText` + name). Each item shows its linked product as a chip (brand · name · protein per 100 g, "est." if
  applicable) that opens the product sheet, or a muted "Link product" that opens the scan sheet with the ingredient
  prefilled. Below that is "All products" (every record, newest first), and an empty state when there are none.
- **Scan sheet:** live video when supported, plus the digits input and a Look up button. An invalid check digit gives an
  inline error and no lookup. A known id opens the existing record. Otherwise it fetches OFF: a hit pre-fills the
  product sheet, and a miss or network failure opens a blank sheet with the barcode filled and a one-line note ("Not on
  Open Food Facts, type the label" / "Couldn't reach Open Food Facts"). Stop the camera tracks whenever the sheet closes.
- **Product sheet:** view mode first shows name/brand/barcode/pack/price/state and the nutrient table (per 100 g/ml, per
  serving when `servingSize`, "—" for missing, "est." marker). An Edit button switches to inputs for the metadata, the
  ingredient (`<input list>` + `<datalist>` of ingredient keys from `ingredient-nutrient-tags.json` and the library's
  ingredient keys), `per`, serving and the 8 label nutrients. Save applies typed nutrients with basis `label` and calls
  `saveProduct`. A product with no barcode can be created from the Pantry tab ("Add without barcode", `source: "manual"`).

## Edge cases

- OFF `nutriments` present but `energy-kcal_100g` absent, with only `energy_100g` (kJ): leave kcal missing, never convert silently.
- OFF product with only per-serving values: the `_100g` fields are absent, so those nutrients are missing.
- A barcode with leading zeros: keep it as a string. A UPC-A scanned as EAN-13 (leading 0) is the same physical item but a
  different id. Accept that (ponytail: dedupe by GTIN-14 normalisation if it ever happens).
- Two products with the same ingredient: the pantry shows the newest. The rest are still listed under All products.
- Assistant writes a record with `basis: "label"`, then the app re-scans the same barcode: the OFF values don't overwrite the label ones.
- An old mirror or remote with `null`/missing `products` key: treat it as `[]`.
- An OFF name containing `<script>` renders as text.
- Camera permission denied, or the sheet closed mid-scan: no lingering camera light, and the digits still work.

## Verification

- `test.html`: `validBarcode` (valid EAN-13, EAN-8, UPC-A; a bad check digit; wrong length; non-digits); `fromOff`
  on an inline fixture (hit, `status: 0`, missing kcal, ml product → `per: "100ml"`); `setNutrients` precedence and
  null/empty/NaN leaving keys untouched, `0` kept as 0; `merge` (newer wins, union, ties to remote); `perServing`;
  `forIngredient`. Capture one real OFF response during build (`allowed_domains: world.openfoodfacts.org`) to confirm
  field names, and inline a trimmed copy as the fixture.
- Worker against `wrangler dev`: `/products` 401 with no token, 200 GET and 204 PUT with the assistant token, 400 for a bad
  check digit, a duplicate id, a `value: "5"` string, an unknown basis or `id !== barcode`.
- `python3 check.py` all green. Headless walk: Pantry tab renders, scan sheet opens, the digits `1234567890123` show
  the check-digit error, a manual product saves, reloads and shows in All products, with an "est." marker present
  for a seeded `estimate` value. PC and 390 px, dark and light.
- `tasks.md` Live lines: `- [ ] Live: scan a real pack on the Pixel PWA, record saved and visible after reload` and
  `- [ ] Live: assistant writes one product from a label photo via PUT /products and it shows on the Pantry tab`.

## Tasks

Logic (TDD, `test.html` first):
- [ ] `products.js`: `validBarcode`, `fromOff`, `setNutrients`, `isEstimate`, `perServing`, `forIngredient`, `merge` + tests
- [ ] `hermes-sync.js`: `syncProducts`, `localProducts`, `saveProduct`
- [ ] Worker: `KEYS`, `ASSISTANT_ALLOWED` (`GET /products`, `PUT /products`), `productsError`; wrangler dev checks above
- [ ] `sw.js` SHELL + CACHE v27; include `products.js` in `shopping.html` and `test.html`

UI (`ui-build` skill):
- [ ] Pantry tab + three-tab `showTab`
- [ ] Scan sheet (BarcodeDetector + digits fallback, camera stopped on close)
- [ ] Product sheet view/edit, datalist, "est." marker, "Add without barcode"
- [ ] `walk.mjs` Pantry step; screenshots PC/390, both themes

Docs:
- [ ] `docs/HERMES.md`, `docs/ARCHITECTURE.md` (v6 product-records section), `CLAUDE.md` invariant, Live lines in `tasks.md`
