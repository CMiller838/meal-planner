# Meal Planner — Build Spec

Static site, vanilla JS/CSS, no build step, no backend, no framework, no
sign-up. Deployed to GitHub Pages. Data persists in browser `localStorage`.
Must be installable on Android Chrome (Pixel 10a) via PWA manifest.

## Pages (separate HTML files, shared css/js)
1. `index.html` — **Browse & Add Meals** page (meal library)
2. `plan.html` — **2-Week Plan** page
3. Shared: `style.css`, `app.js` (or split into `data.js`, `nutrition.js`,
   `shelf-life.js`, `swipe.js`, `mealdb.js` — whatever's cleanest), a shared
   nav bar/header linking between the two pages, dark mode toggle (default
   dark, per user request "Dark mode").

## Seed data — liked meals (build these into `meals.json` as the starting
library, `source: "liked"`, images filled via TheMealDB search where a
plausible match exists, else a clean CSS placeholder card, never AI-gen
images, never left blank/broken):
- Toasties — white bread, ham & cheese OR chicken & cheese. Hard rule: NO
  vegetables in a toastie, ever, even as a suggested swap-in.
- Sunday roast chicken — roast potatoes, carrots, Bisto gravy. Batch-cook;
  leftover chicken is reused in chicken fajitas the following 1-2 days
  (model this as a "leftover chain" — see Freeze/Move logic below).
- Chicken fajitas — tortillas, cheese, rice, peppers, onion, cannellini
  beans, leftover roast chicken.
- Chilli — beef mince 500g = 3 servings, carrots, peppers, chilli beans,
  rice, cheese on top.
- Chorizo & pasta — any pasta shape, white sauce preferred.
- Salmon, rice, broccoli, teriyaki sauce.
- French toast (egg-coated bread — allowed per exception below).
- Porridge.
- Also seed the existing rotation from `meal-plan-exeter.md`: oats + Greek
  yogurt + milk + banana breakfast; chicken breast/thigh + rice + frozen veg
  lunch; beef mince + baked beans dinner; tuna + rice + veg dinner; boiled
  egg + peanut butter toast snack.

Batch-cook / leftover-chain meals (roast chicken → fajitas, chilli mince =
3 servings, chorizo & pasta) should be flagged `batchCook: true` in the data
model — the plan generator should default to scheduling leftovers into the
following 1-2 days rather than forcing every ingredient into one dinner
(per the planning rule below).

## Hard exclusions (never suggest, never auto-swap-in, even from the API)
- Mushrooms — exclude entirely from any TheMealDB-sourced suggestion too
  (filter meals whose ingredient list contains "mushroom").
- Standalone egg (egg on toast alone, plain boiled egg as a meal by itself)
  — EXCEPTION: egg *within* a dish is fine (French toast, egg fried rice).
- Vegetables inside toasties specifically (not a general veg dislike).

## Planning rules (encode as generator logic, not just docs)
- Recipe suggestions can be inspired by TheMealDB but should be described
  as adapted to Cody's preferences/macros, not presented as a rigid copy.
- Prioritize meals that batch-cook and get eaten over 2 days by default for
  dinners.
- Leftover ingredients from one dinner should get reused in a lunch/snack
  the same or next day rather than wasted or force-fit into one meal.

## TheMealDB integration (free, no signup, key="1")
Base: `https://www.themealdb.com/api/json/v1/1/`
- `search.php?s=<name>` — search by name
- `search.php?f=<letter>` — list by first letter
- `lookup.php?i=<id>` — full meal detail (ingredients, instructions, image,
  `strMealThumb` for the photo)
- `filter.php?i=<ingredient>` — filter by main ingredient (e.g.
  `chicken_breast`, `salmon`, `beef`)
- `filter.php?c=<category>` / `filter.php?a=<area>` — by category/cuisine
- `random.php` — random meal
Use `filter.php?i=` against ingredients Cody already likes (chicken, beef
mince, salmon, tuna, chorizo, pasta) to source "Browse & Add" suggestion
cards, then `lookup.php?i=` for full detail/instructions/image. Client-side
fetch is fine (TheMealDB allows CORS). ALWAYS escape any TheMealDB string
(name, instructions, ingredient names) before `innerHTML` interpolation —
treat it as untrusted third-party content, use a shared `esc()` helper, or
use `textContent` where possible.

## Nutrition targets (baseline: NHS/SACN dietary reference values for an
adult male, raised ~15-20% to safely cover an ACTIVE 20-year-old student
per explicit request — build these into `nutrition-targets.json` and use
them to score days/meals, don't hardcode magic numbers inline in JS):
- Energy: 2900 kcal/day
- Protein: 160 g/day (existing hard target — keep as-is, already high)
- Carbohydrate: ~350 g/day
- Fat: ~95 g/day (saturates capped ~30 g/day)
- Fibre: 35 g/day
- Vitamin A: 900 mcg
- Vitamin C: 90 mg
- Vitamin D: 15 mcg
- Vitamin B12: 3 mcg
- Folate: 300 mcg
- Calcium: 1000 mg
- Iron: 12 mg
- Zinc: 11 mg
- Magnesium: 350 mg
- Potassium: 3800 mg
- Sodium: cap at 2300 mg (upper limit, not a target to reach)

Since TheMealDB has no nutrition data and a live nutrition API needs
signup/keys, use a **local approximate nutrient-tagging system**: each
ingredient gets tagged with which nutrients it meaningfully contributes
(e.g. `chicken_breast: {protein: high}`, `broccoli: {fibre: med, vitC:
high, folate: med}`, `greek_yogurt: {protein: med, calcium: high}`,
`beef_mince: {protein: high, iron: high, zinc: med}`, `tuna: {protein:
high, omega3: high, vitD: med}`, `citrus/fruit: {vitC: high}`, `oats:
{fibre: high}`). Build a small `ingredient-nutrient-tags.json` covering the
seed ingredients (15-25 entries is enough) and use it to (a) score each
day's plan for coverage gaps (e.g. "no vitC source today", "low fibre this
week") shown as a banner/warning on the plan page, and (b) rank recommended
swaps in the picker by how well they fill whatever the current day is
missing — this is the "match the nutrients and vitamins" requirement. Keep
this simple and transparent (a coverage checklist, not a fake precise
calorie/macro calculator) — approximate and clearly labeled as estimates.

## Shelf-life / freeze / move-meal warnings (generic Asda/FSA-based
estimates — build `shelf-life.json` keyed by ingredient category, not
exact SKUs, since there's no purchase-date tracking):
- Raw chicken (fresh, from fridge): 2 days fridge, up to 9 months frozen
- Raw beef mince: 1-2 days fridge, up to 3 months frozen
- Raw fish (salmon/tuna steaks, fresh): 1-2 days fridge, up to 3 months
  frozen (tinned tuna: ambient, use by date on tin, not perishable logic)
- Cooked leftovers (roast chicken, chilli, cooked mince dishes): 2-3 days
  fridge, up to 3 months frozen — cool within 2 hours, don't reheat more
  than once
- Chorizo (cured, opened pack): ~1-2 weeks fridge
- Fresh vegetables (peppers, onions, carrots): 5-7 days fridge
- Frozen vegetables: use within a few days of opening the bag, else
  re-seal and back to freezer, several months frozen
- Dairy (milk, Greek yogurt): use-by on pack, generally 5-7 days once
  opened
- Bread: 3-5 days ambient, or freeze slices
- Eggs: ~3 weeks fridge from purchase
When generating/editing the 2-week plan, walk the sequence day by day: if
a raw-meat/fish meal is scheduled more than its fridge shelf-life days
after the (assumed) shop day, OR a cooked leftover is scheduled more than
its fridge window after being cooked, show an inline warning on that
slot: "⚠ freeze this after cooking" or "⚠ move this meal earlier — bought
ingredients may spoil by day X" with a one-tap "move to day Y" action
where day Y is the last safe day. Keep the logic simple: shop day = start
of each week (day 1 and day 8), cooked day = whatever day a dinner is
first scheduled.

## UI / UX (confirmed structure — build exactly this)
1. **Two separate pages**: `index.html` (Browse & Add Meals — your liked
   library plus new suggestion cards from TheMealDB) and `plan.html` (the
   2-week plan grid, editable). Persistent top nav between them.
2. **Browse & Add page**: shows your current liked-meal library as cards
   (image, name, short description, protein/nutrient tags) PLUS a
   "Discover" section of new TheMealDB-sourced suggestion cards filtered
   to your liked ingredients and excluding dislikes/mushrooms.
   - **Tap a card** → opens a detail modal/sheet: full picture, recipe/
     instructions, ingredient list, nutrient tags.
   - **Swipe right** on a Discover card → adds it to your liked library
     (persist to localStorage) with a brief confirmation toast.
   - **Swipe left** on a Discover card → dismisses/skips it (don't show
     again this session).
   - Use a real touch/pointer-based swipe (touchstart/touchmove/touchend
     or pointer events with a drag-follow + rotate transform, Tinder-style,
     with a threshold to commit vs. snap back) — not just two buttons
     pretending to be swipe.
3. **2-Week Plan page**: 14-day grid (2 weeks x day slots: breakfast,
   lunch, dinner, snack — reuse the existing Day A/Day B rotation shape
   from `meal-plan-exeter.md` as the generator's starting point, then
   let the user freely edit).
   - **Generate plan** button seeds all 14 days from the liked library
     using the batch-cook/leftover rules above.
   - **Tap a slot's whole card** → opens the swap-picker modal: list of
     alternative meals from the library (+ Discover pool), with
     **recommended swaps sorted to the top** based on which nutrients/
     vitamins the current day is short on (using the coverage-tag system
     above).
   - **Inside the swap-picker, swipe right on a candidate** → confirms
     the swap into that slot. **Swipe left** → skip to the next candidate.
     Tap (not swipe) → view that candidate's full recipe without swapping.
   - Inline shelf-life/freeze/move warnings per slot, per the logic above.
   - A small nutrient-coverage summary per day (protein total vs 160g
     target, plus which of the tracked nutrients are covered/short) and
     for the week.
4. **Dark mode**: default on, toggle in the nav, persisted in localStorage.
5. Mobile-first layout (this is used primarily on a Pixel 10a in Chrome) —
   large tap targets, cards stack in a single column on narrow viewports.

## PWA / installability (Android Chrome — no iOS work needed)
Follow the `personal-web-dashboard` skill's PWA checklist exactly:
manifest.json with populated icons array (192x192 + 512x512, "any" and
"maskable"), `<link rel="manifest">`, `<meta name="theme-color">`,
apple-touch-icon + apple-mobile-web-app meta tags (cheap to include even
though Android is the target). Generate icons as a simple flat dark-themed
fork/plate icon.

## Security (mandatory before shipping)
- Every TheMealDB string (name, ingredients, instructions) escaped before
  any `innerHTML` interpolation — use a shared `esc()` helper or prefer
  `textContent`/`el.value` assignment. No `eval`, no `document.write`.
- No API keys/tokens needed for TheMealDB free tier, so no localStorage
  token handling required here — but if any future API key gets added,
  it must go in localStorage only, never hardcoded/committed.
- No backend, no file/shell ops — standard static-site surface only.

## Deliverables
- `index.html`, `plan.html`, `style.css`, `app.js` (or split modules),
  `meals.json` (seeded liked meals), `ingredient-nutrient-tags.json`,
  `shelf-life.json`, `nutrition-targets.json`, `manifest.json`, icon PNGs.
- Working entirely client-side, no build step — must open and work by
  just serving the static files (GitHub Pages).
