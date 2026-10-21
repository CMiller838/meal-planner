# Phase 23 — "Plan with me" setup screen

One new page (`plan-with-me.html` + `plan-with-me.js`) that collects busy days
and preference chips, writes `mp_planPrefs`, and hands off to `plan.html`.
Per D2 this phase also **wires the prefs into the generator**, so the screen's
effect is visible immediately — the Phase 24 walkthrough is still out of scope.

One-tap Generate (`#generate-btn`, `plan.html:37`) keeps working with zero
extra taps. It gains exactly one behaviour: it honours saved prefs.

## Decisions (answered 1B, 2B, 3A)

Relayed to me by the coordinating agent as the user's own picks, all three
matching my recommendation.

| # | Decision | Chosen | Why |
|---|----------|--------|-----|
| D1 | Busy-grid markup | **B — new compact `.busy-grid`** (7×2 `<button>` cells, own CSS) | `.day-row` (style.css:499-520) is a rotated, shadowed *card* with a pin `::before` and a nested `.slot-grid` — 14 of those is a long scroll for a 14-tap screen and reads as "this is a plan". A 7×2 grid shows the whole fortnight without scrolling. The plan grid's *shape* is reused; its markup is not. `docs/roadmap.md`'s Phase 23 wording is corrected to match (§7). |
| D2 | Does Generate actually change the plan this phase? | **B — wire prefs into `plan.js` now** | Phase 22 built the plumbing (`generatePlan`'s 8th arg, `rankSlot`'s `opts.prefs`) precisely so this would be ~5 lines. A setup screen whose output can't be observed until the next phase can't be signed off. Applies to **both** entry points — one-tap Generate picks up saved prefs too, which is the outline's "re-running with the same settings stays low-friction". |
| D3 | `mp_planPrefs` shape / versioning | **A — `{ updatedAt, busyDays, chips }`, no version field** | Exactly `docs/ARCHITECTURE.md:112`, which Phase 25's last-write-wins sync already assumes. Malformed/missing degrades to `{}` = today's behaviour, so there is nothing a migration could ever recover. No other `mp_*` key is versioned. |

### Calls made without a gate (trivial forks, noted for the record)

- **Reuse the existing `.chip` / `.chip.active` classes** (style.css:467-478).
  They are already a pill with an accent-filled active state — exactly the
  chip row this screen needs. No new chip CSS.
- **The chip UI reads `id`, `label` and `kind` only.** It never touches
  `keywords` / `tags` / `prepEffort`. The matcher's criteria shape is the
  generator's business, so this page survives any future change to it.
- **`plan-preferences.json` fails to load → hide the chip row.** The busy grid
  and Generate still work; prefs simply carry no chips. No hardcoded fallback
  vocabulary (that would be the same "data, not inline constants" violation
  the chip file exists to avoid).
- **Busy cells are `<button aria-pressed="true|false">`, not styled
  checkboxes.** Keyboard activation and screen-reader state come free.
- **Chips are `<button class="chip" aria-pressed>` too**, same reason —
  matching the existing `.chip` usage elsewhere.
- **No `?guided=1` handling in `plan.js` this phase.** The link carries the
  param so Phase 24 has its entry point; `plan.js` ignoring an unknown query
  param is already its behaviour (no `URLSearchParams` usage exists).
- **`sw.js` cache bumps to `meal-planner-v17`**, one step from the current
  `meal-planner-v16` (sw.js:4).

## Findings (verified, do not re-derive)

- `plan-preferences.json` (shipped, Phase 22) is
  `{ _note, busy: { preferEffort, demoteEffort }, chips: [{ id, label, kind,
  keywords?, tags?, prepEffort? }] }`. Five chips: `comfort`, `light`
  (`kind: "prefer"`); `no-spice`, `less-red-meat`, `no-pasta`
  (`kind: "avoid"`).
- **`docs/ARCHITECTURE.md:257-268`'s chip example is stale** — it shows a
  nested `match: { keywords, tags, prepEffort }` and a `busy.leftoverBias`
  key, neither of which Phase 22 shipped. Corrected in §7. This page is
  unaffected either way (it reads `id`/`label`/`kind` only).
- `mp_planPrefs` **does not exist** anywhere in the codebase — confirmed by
  grep over all root `*.js` and `*.html`. Phase 22 shipped headless with no
  key. No reconciliation needed.
- localStorage key convention: flat `mp_*` string constants, one per module,
  read through a defensive `JSON.parse(... || "{}")` in a `try`/`catch`
  (`prefs.js:9-20` is the model). No shared `MP.store`/`MP.load` wrapper
  exists — don't invent one for a single key.
- `plan.html:36-38`: `#generate-btn` sits alone in a `.top-actions` flex row.
  Scripts (lines 56-65): `data.js`, `prefs.js`, `nutrition.js`,
  `shelf-life.js`, `swipe.js`, `mealdb.js`, `generator.js`, `hermes-sync.js`,
  `shopping-list.js`, `plan.js`.
- `plan.js:95` calls `generatePlan(...)` with **no** `prefs` argument;
  `plan.js:269` (`candidatesFor`) calls `rankSlot` with a hardcoded
  `prefs: {}`. These are the two wiring points for D2.
- `plan.js:207` slices the 14 days into two 7-day weeks; `dayHeading(d.day)`
  returns `"Day N · DayName"`. `MP.Generator.weekdayOf` is the underlying
  weekday source and is already exported.
- `rankSlot(pool, dayNum, dayMealsSoFar, opts)` takes
  `opts.prefs = { busyDays?: number[], chips?: string[], vocab?: object }`
  where `vocab` is the parsed `plan-preferences.json`.
- `generatePlan(library, tags, targets, shelfData, startDate, budget, have,
  prefs)` — `prefs` is the trailing 8th arg, same `{ busyDays, chips, vocab }`.
- JSON fetch house style: a module-level `let cache` + `async function load()`
  that memoises (`shelf-life.js:36-40`, `shopping-list.js:13-17`), with
  `.catch(() => ({}))` where failure must be survivable (`mealdb.js:105-107`).
- `esc(str)` (`data.js:14-19`) escapes `& < > " '` and returns `""` for
  null/undefined. Chip labels come from a repo-local file, not TheMealDB, but
  they go through `esc()` anyway — cheaper than arguing about it.
- No shared nav helper exists; each page inlines its `<nav class="nav">`
  markup and calls `initTheme()` (`data.js:262-272`).

## Non-goals

- **No walkthrough.** No step-through state machine, no per-slot card loop, no
  "Looks good" commit button, no `?guided=1` branch in `plan.js` (Phase 24).
- **No Hermes.** No `hermes-sync.js` change, no `/planPrefs` route, no push or
  pull of `mp_planPrefs`, no plan-request banner button (Phase 25). The
  `updatedAt` field is written now purely so Phase 25 has it.
- No change to `generator.js` — Phase 22 finished it. If this phase needs a
  generator edit, something is wrong; stop and re-read §3.
- No change to `nutrition.js`, `app.js`, `discover.js`, `shopping*.js`,
  `prefs.js`, `mealdb.js`.
- No new chip ids, no edits to `plan-preferences.json`'s contents.
- No new dependency, no build step (CLAUDE.md).

### Invariants this phase must not break

- **One-tap Generate stays one tap.** `#generate-btn` must not gain a
  confirmation, a redirect, or a required visit to the new screen. With no
  saved prefs its behaviour is byte-identical to today's.
- **Chips and busy remain layers 2-3.** This phase only *supplies* `prefs`;
  it must not reorder, re-score or filter anything itself. Nutrition ranking
  stays `rankByGap`'s.
- **`mp_planPrefs` is settings, not plan state.** It never contains meal ids
  or dates. Deleting it degrades to "no busy days, no chips" = today.
- **The setup screen writes nothing but `mp_planPrefs`.** It must not touch
  `mp_plan`, `mp_cooks`, the pantry, or fire `mp:plan-saved`. It navigates;
  `plan.js` still owns plan generation and saving.
- **Chip vocabulary is data.** No chip id, label or keyword literal appears in
  `plan-with-me.js` or `plan.js`.
- **No `innerHTML` with unescaped external content** (CLAUDE.md). Chip labels
  via `esc()`.

## §1 `mp_planPrefs` — new localStorage key (D3)

Written by `plan-with-me.js`, read by `plan.js`. Owned by
`plan-with-me.js`'s `MP.PlanPrefs` module (§2.1) so both pages share one
parser.

```jsonc
{
  "updatedAt": "2026-09-13T18:04:11.221Z",  // ISO, new Date().toISOString()
  "busyDays": [3, 4, 11],                   // ints 1..14, ascending, unique
  "chips": ["comfort", "no-spice"]          // chip ids from plan-preferences.json
}
```

| Key | Type | Notes |
|-----|------|-------|
| `updatedAt` | ISO string | Set on every save. Unused in this phase; Phase 25's last-write-wins needs it. |
| `busyDays` | number[] | 1-14. Sorted ascending on write so a diff is stable. Empty array = no busy days. |
| `chips` | string[] | Chip ids only. Order is selection order; the generator doesn't care. Unknown ids are ignored downstream (Phase 22 invariant), so no validation on read. |

No `v`/version field (D3). Read is defensive: anything that isn't a
well-formed object yields `{ busyDays: [], chips: [] }`.

## §2 `plan-with-me.js` — new file

`window.MP` IIFE, `"use strict"`, same shape as `prefs.js`. Two parts: a tiny
shared storage module and the page controller.

### 2.1 `MP.PlanPrefs` — storage (shared with `plan.js`)

```js
const KEY = "mp_planPrefs";

/** Never throws. Bad/missing JSON → { busyDays: [], chips: [] }. */
function get()                        // -> { busyDays: number[], chips: string[] }

/** Stamps updatedAt, sorts busyDays ascending, writes. Returns the saved object. */
function save(busyDays, chips)        // (number[], string[]) -> { updatedAt, busyDays, chips }

MP.PlanPrefs = { KEY, get, save };
```

`get()` coerces defensively: non-array `busyDays`/`chips` → `[]`; `busyDays`
entries filtered to integers within 1-14; `chips` entries filtered to strings.
It does **not** check chip ids against the vocabulary — a chip that's been
removed from `plan-preferences.json` simply renders nothing and is ignored by
`rankSlot`.

`plan.html` loads `plan-with-me.js` too (§4), so `plan.js` can call
`MP.PlanPrefs.get()` without a second copy of the parser.

### 2.2 Vocabulary load

```js
let vocabCache = null;
/** Memoised. Returns null on any failure (chip row then stays hidden). */
async function loadVocab()            // -> { busy, chips } | null
```

`fetch("plan-preferences.json").then(r => r.json()).catch(() => null)`,
memoised in `vocabCache` — the `shelf-life.js:36-40` pattern with
`mealdb.js`'s failure-tolerant `.catch`.

### 2.3 Page controller

Runs on `DOMContentLoaded`, guarded so it no-ops on `plan.html` (where the
file is loaded only for `MP.PlanPrefs`): bail immediately if
`document.getElementById("busy-grid")` is null.

```js
let busyDays = new Set();   // ints 1..14
let chips    = new Set();   // chip ids

function renderBusyGrid()   // 14 cells into #busy-grid, .is-busy + aria-pressed from busyDays
function renderChips(vocab) // #chip-row from vocab.chips; hidden entirely when vocab is null
function onGenerate()       // MP.PlanPrefs.save(...) then location.href = "plan.html?guided=1"
```

- **Prefill:** seed both Sets from `MP.PlanPrefs.get()` before the first
  render. Chip ids not present in the loaded vocabulary are dropped from the
  Set at prefill time, so re-saving doesn't resurrect a retired chip.
- **Toggle:** one delegated `click` listener per container (`#busy-grid`,
  `#chip-row`), reading `data-day` / `data-chip` off the closest `button`.
  Toggle the Set, flip the class and `aria-pressed` on that element only — no
  full re-render per tap.
- **Summary line:** `#pref-summary` gets a plain-text sentence, e.g.
  `"3 busy days · 2 preferences"`, or `"No busy days, no preferences"` when
  both are empty. Set via `textContent`. This is the outline's "shows what
  they are before generating". Updated on each toggle.
- **Generate:** always enabled. Empty selections are a legitimate choice and
  produce exactly today's plan.

## §3 `plan-with-me.html` — new file

Copy `plan.html`'s skeleton (same `<head>`, same inline `<nav class="nav">`,
same theme handling). No nav link is added for it — the screen is entered from
`plan.html`'s button, and adding a fifth top-level nav item for a two-field
setup screen is nav clutter.

```html
<main>
  <h2>Plan with me</h2>
  <p class="muted">Tap the days you'll be busy, then pick anything that
     should nudge the week.</p>

  <h3>Busy days</h3>
  <div id="busy-grid" class="busy-grid"></div>
  <!-- 14 × <button class="busy-cell" data-day="N" aria-pressed="false">
         <span class="busy-day">N</span><span class="busy-dow">Mon</span>
       </button> -->

  <h3>Preferences</h3>
  <div id="chip-row" class="chip-row"></div>
  <!-- N × <button class="chip" data-chip="id" aria-pressed="false">Label</button> -->

  <div class="top-actions">
    <button id="pwm-generate-btn" class="primary">Generate Plan</button>
    <a class="btn-secondary" href="plan.html">Cancel</a>
  </div>
  <p id="pref-summary" class="muted"></p>
</main>
```

Scripts: `data.js` (for `esc`/`initTheme`), then `plan-with-me.js`. Nothing
else — this page doesn't generate, so it needs neither `generator.js` nor
`nutrition.js`.

Weekday labels come from `MP.Generator.weekdayOf`… **which isn't loaded here.**
Rather than pull `generator.js` in for one helper, derive the label in
`plan-with-me.js` from `new Date()` + day offset with
`toLocaleDateString(undefined, { weekday: "short" })`, starting from today —
the same "day 1 = today" assumption `plan.js` makes. Cell 1 is labelled with
today's weekday.

## §4 `plan.html` — entry button + prefs wiring (D2)

**Markup** (`.top-actions`, line 36-38) gains one sibling after
`#generate-btn`:

```html
<a id="plan-with-me-btn" class="btn-secondary" href="plan-with-me.html">Plan with me</a>
```

An `<a>`, not a `<button>` — it's navigation, so let the platform do it (no
JS, works on middle-click, correct on a cached page).

**Scripts:** add `<script src="plan-with-me.js"></script>` before
`plan.js` (it defines `MP.PlanPrefs`, which `plan.js` uses).

## §5 `plan.js` — read prefs, pass them through (D2)

Two call sites, both already accept `prefs`. Nothing else in the file changes.

### 5.1 Generate path (line 95)

Build one `prefs` object before generating and pass it as the trailing 8th
argument:

```js
const prefs = Object.assign({ vocab: await MP.PlanPrefs.loadVocab() },
                            MP.PlanPrefs.get());
// -> { vocab, busyDays, chips }
MP.Generator.generatePlan(library, tags, targets, shelfData, startDate, budget, have, prefs);
```

This is the one-tap path *and* the post-setup-screen path — both entry points
converge here, which is why saved prefs apply to both (D2). `loadVocab()` is
memoised and already cached by the service worker, so it adds no perceptible
latency; `vocab: null` (fetch failed) means chips are silently skipped and
busy days still work, since `rankSlot`'s layer 3 reads `busy` from `vocab`.

> If `vocab` is null, layer 3's effort bias has no `preferEffort`/
> `demoteEffort` to read and is a no-op. That is acceptable and is the same
> degrade-to-today's-behaviour rule as everywhere else here — do **not** add
> hardcoded `"quick"`/`"batch"` fallbacks in JS.

### 5.2 Swap picker (line 269)

Replace the hardcoded `prefs: {}` in `candidatesFor`'s `rankSlot` opts with
the same `prefs` object, so the swap picker ranks by the same preferences the
plan was built with. Hoist `prefs` to module scope alongside `library`/
`tagsData`, populated in the same init that loads those.

### 5.3 Not in this phase

No `URLSearchParams`, no `guided` branch, no change to `commitCook`,
`eatPortion`, or any save path. `mp:plan-saved` still fires exactly once, from
where it does today.

## §6 `style.css` — busy grid, chip row (D1)

Add next to the existing `.day-row` / `.slot-grid` block (≈ line 499-528), so
plan-page layout lives in one place.

```css
.busy-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: .35rem; }
.busy-cell { /* border + radius from --border, min-height ~3.25rem, column flex, centred */ }
.busy-cell .busy-day { font-weight: 700; }
.busy-cell .busy-dow { font-size: .7rem; opacity: .7; }
.busy-cell.is-busy   { background: var(--accent); color: #fff; border-color: var(--accent); }
.chip-row { display: flex; flex-wrap: wrap; gap: .4rem; }
```

Existing tokens only (`--accent`, `--border`, `--text`) so dark mode works
with no extra rules. `.is-busy` deliberately mirrors `.chip.active`'s
accent-fill so the two controls read as the same kind of toggle. 7 columns at
every width — 14 cells fit a phone at ~44px each, which is also the minimum
tap target.

No `.btn-secondary` is invented if one already exists; grep first and reuse.
If it doesn't, add a minimal one beside `.primary`.

## §7 Docs

- **`docs/roadmap.md`** Phase 23 (lines 52-59): replace "(reusing the plan
  grid's markup)" with the compact-grid description per D1 — a 7×2
  `.busy-grid` of toggle buttons that mirrors the plan grid's *shape*, not its
  markup. Add that the phase also wires prefs into `plan.js`'s generate path
  and swap picker (D2), so Phase 24 is purely the step-through. Mark shipped
  when done.
- **`docs/ARCHITECTURE.md`**:
  - Lines 257-268: correct the `plan-preferences.json` example to the shape
    Phase 22 actually shipped — flat `keywords` / `tags` / `prepEffort` per
    chip, not nested under `match`; `busy` is
    `{ preferEffort: "quick", demoteEffort: "batch" }` with **no**
    `leftoverBias` key; nutrient tags use the suffixed names (`fibre_g`,
    `vitC_mg`), not bare `fibre`/`vitC`.
  - Line 234-237 (setup screen): same D1 wording fix as the roadmap.
  - Note that `plan.js` reads `mp_planPrefs` for **both** entry points from
    Phase 23 (D2), and that `MP.PlanPrefs` is the single reader/writer.
- **`CLAUDE.md`**: add `mp_planPrefs` to the localStorage list with the
  "settings, not plan state — losing it degrades to today's behaviour" rule,
  and one line that one-tap Generate is never replaced, only preference-aware.
- **`SPEC.md`**: leave unless it enumerates pages; if it does, add
  `plan-with-me.html`.

## §8 `sw.js`

- Bump `CACHE` (line 4) `"meal-planner-v16"` → `"meal-planner-v17"`.
- Add to the shell array (lines 5-35): `"plan-with-me.html"`,
  `"plan-with-me.js"`, and `"plan-preferences.json"` — the last is now
  fetched by a page for the first time (Phase 22 deliberately deferred it).

## Edge cases

| Case | Required behaviour |
|------|--------------------|
| No `mp_planPrefs` (first run) | `get()` → `{ busyDays: [], chips: [] }`. Grid all off, no chips selected, summary reads "No busy days, no preferences". Plan identical to today's. |
| Corrupt `mp_planPrefs` (hand-edited, truncated) | `try`/`catch` → same empty default. No console error shown to the user, no throw. |
| `busyDays` contains `0`, `15`, `"3"`, or a duplicate | Filtered on read to unique integers 1-14. Never trusted straight into the grid. |
| `chips` contains an id no longer in the vocabulary | Dropped at prefill; ignored by `rankSlot` anyway (Phase 22 invariant). Never an error. |
| `plan-preferences.json` 404s or is invalid JSON | `loadVocab()` → `null`. Chip row hidden on the setup screen; busy grid, save and Generate all still work; layers 2-3 no-op in the generator. |
| All 14 days marked busy | Legal. Layer 3's effort bias applies to every day and the batch-run rotation finds no non-busy day, so runs are left alone (Phase 22 §4.4). The plan still fills. |
| User taps Generate with nothing selected | Saves `{ busyDays: [], chips: [] }` and navigates. Plan equals today's. This is a valid way to clear previous settings. |
| User opens `plan.html` directly, never visits the setup screen | Saved prefs still apply (D2). If none were ever saved, identical to today. |
| `plan.html?guided=1` in this phase | Ignored; a normal plan page. Phase 24 gives it meaning. |
| Offline (PWA) | All three new/changed files are in the v17 shell, so the screen and the vocabulary load offline. |

## §9 Tests — `test.html` group 41

Logic-only, no DOM. Follow group 40's structure. The page controller is not
unit-tested (it's DOM wiring, covered by the manual pass); the parser is,
because it's the trust boundary.

- `MP.PlanPrefs.get()` with the key absent → `{ busyDays: [], chips: [] }`.
- `get()` with `"not json"`, `"null"`, `"[]"`, `"3"` stored → same empty
  default, no throw, for each.
- `get()` filters `busyDays`: `[0, 3, 15, "4", 3, 14]` → `[3, 14]`.
- `get()` filters `chips`: non-strings dropped; unknown ids **kept** (the
  generator ignores them; `get()` is not a validator).
- `save([11, 2], ["comfort"])` writes ascending `busyDays` `[2, 11]`, a
  parseable ISO `updatedAt`, and round-trips through `get()` unchanged.
- `save([], [])` round-trips to the empty default shape.
- Integration: `generatePlan` with `prefs` from a saved `mp_planPrefs`
  produces a plan that differs from the same call with `{}` when a busy day
  and a chip are set — and one that is **identical** when both are empty
  (guards the one-tap path).

## §10 Manual pass

1. `python3 -m http.server 8000`, open `plan.html`. `#generate-btn` still
   generates in one tap, unchanged. "Plan with me" sits beside it.
2. Open `plan-with-me.html`. 14 cells in two rows of seven, whole fortnight
   visible without scrolling on a phone width; cell 1 shows today's weekday.
   Five chips render.
3. Tap 3 days and 2 chips — cells/chips fill with the accent colour, summary
   line updates. Tap Generate; lands on `plan.html?guided=1` and a plan
   generates (no walkthrough — expected this phase).
4. Re-open `plan-with-me.html`: the same 3 days and 2 chips are pre-selected.
5. With `comfort` + several busy days set, generate and eyeball the plan:
   quick meals cluster on the busy days, comfort meals appear more often.
   Clear everything, generate again — the plan should look like it did before
   this phase.
6. `localStorage.removeItem("mp_planPrefs")`, reload both pages — no errors,
   everything empty, one-tap Generate normal.
7. DevTools → set `mp_planPrefs` to `"{{{"` → reload the setup screen: grid
   empty, no console exception.
8. DevTools → Network → block `plan-preferences.json` → reload: chip row is
   absent, busy grid and Generate still work.
9. Dark mode + light mode: busy cells, chips and the secondary button are all
   legible in both.
10. Offline (DevTools → Offline, after one load): both pages and the chip
    vocabulary still load from the v17 cache.
