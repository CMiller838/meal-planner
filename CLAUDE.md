# CLAUDE.md

Guidance for Claude Code in this repo.

## Project state

Meal Planner is built: two pages (Browse & Add, 2-Week Plan) backed by seeded
`meals.json`, TheMealDB-sourced Discover suggestions, nutrient-coverage scoring,
shelf-life/leftover warnings, and PWA install support. Full requirements and
rationale live in `SPEC.md` — read it before changing planning logic, nutrition
targets, or shelf-life rules; those numbers are deliberate, not placeholders.
History lives in `git log`.

## Commands

```
# No build step. Serve the static files and open in a browser, e.g.:
python3 -m http.server 8000
# then visit http://localhost:8000/index.html
```

No lint/build/formatter/test runner — don't invent one unless asked.

## Stack

Static site: vanilla JS (ES modules-free, plain `<script>` includes), vanilla
CSS, no framework, no backend, no sign-up. Deployed to GitHub Pages. All state
(liked meal library, theme, dismissed suggestions) persists in browser
`localStorage` — there is no server and no database. Nutrition/meal images and
suggestions come live from TheMealDB's free public API (no key required).
Installable as a PWA on Android Chrome via `manifest.json` + `sw.js`.

- **Never add a new dependency (npm package, CDN script, build tool) without
  confirming with the user first.** The zero-build-step, zero-dependency shape
  is intentional (GitHub Pages, must "just open and work").

## Architecture invariants

- **No `innerHTML` with unescaped TheMealDB (or any external) content.** Every
  string from TheMealDB must go through `esc()` in `data.js` or use
  `textContent`/`el.value` — it's untrusted third-party content.
- **Nutrition targets and nutrient tags are data, not inline constants.**
  `nutrition-targets.json` and `ingredient-nutrient-tags.json` are the single
  source; don't hardcode macro/vitamin numbers in JS. The approximate
  high/med/low tagging system is deliberate — it's a coverage checklist, not a
  precise calorie calculator; don't "upgrade" it into fake-precise math.
- **Shelf-life logic in `shelf-life.js`/`shelf-life.json` is category-based**
  (no purchase-date tracking exists) — shop day = day 1 and day 8 of each
  2-week plan, cooked day = first day a dinner is scheduled. Don't add
  per-SKU or purchase-date tracking without the user asking.
- **Batch-cook / leftover chains** (`batchCook: true` in `meals.json`) are a
  planning primitive — the generator must schedule leftovers into the
  following 1-2 days, not force every ingredient into one dinner.
- **Hard content exclusions are enforced in code, not just docs**: no
  mushrooms (including from TheMealDB results), no standalone egg meals
  (egg-within-a-dish is fine), no vegetables in toasties. These came from
  explicit user dietary preference — don't relax them for "better" suggestions.
- **Dark mode defaults on**, persisted in localStorage, toggle in shared nav.

## Project lifecycle (start to v2)

Full detail, including exactly what each step reads/writes and why:
`WORKFLOW.md`. Short version: `idea-interview` (MVP outline + FUTURE.md) →
`@architect` (stack → ARCHITECTURE.md) → `@planner` roadmap mode (phases) →
per phase: `@planner Phase N` (spec + tasks.md) → build (TDD + ponytail; UI
via `ui-prototyper` → `restyle-from-prototype`) → `/code-review` or
`/simplify` → commit → repeat until the roadmap is done → `project-retro` →
v2 repeats the chain, seeded from the retro.

This project shipped its MVP directly from `SPEC.md` rather than through the
full idea-interview chain — treat `SPEC.md` as the equivalent of the
ARCHITECTURE.md + Phase 1 spec for any retrofit. Use the lifecycle above for
future feature phases (v2+).
