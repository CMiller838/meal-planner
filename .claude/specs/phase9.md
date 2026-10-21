# Phase 9 Spec — Expanded plan day view

Roadmap: `docs/roadmap.md` → Phase 9. Scope is settled there and is not re-litigated here: the
expanded day view **becomes the destination of a day tap**, and each meal inside it gets a Swap
action that opens the **existing `openSwapPicker` unchanged**. Swapping moves one tap deeper; it
is not rebuilt inline.

Pure app-side work, one page. **No schema change, no new dependency, no new JS file, no new CSS
file, no `meals.json` edit, no Worker change, no change to `openSwapPicker`'s internals, no
change to the swipe deck.** Four small pieces: one new overlay pair in `plan.html`, four extracted
helpers plus one new render path in `plan.js`, ~9 CSS rules, and a two-selector widening of two
existing rules.

## Decisions taken

No Decision Gate was raised. The roadmap settled the architecture (expanded view is the tap
destination, swap stays as-is) and everything left is an implementation default. They are listed
so any of them can be overridden before the build starts.

| Choice | Decision |
|---|---|
| Where the day view lives | A **third overlay/sheet pair** `#day-overlay` / `#day-sheet` in `plan.html`, `style="z-index:40;"`. `.modal-overlay` is `z-index: 50` (`style.css:283`) and `#detail-overlay` overrides to `60` inline, so 40 puts the day sheet **beneath** both the swap picker and the recipe detail — which is exactly the stacking the "one tap deeper" model needs. Repurposing `#swap-overlay` would make the swap picker unable to open over its own parent |
| How the day view stays fresh | **One line at the end of `renderPlan()`: `if (dayCtx) renderDayView();`** — not a refresh call bolted onto each mutation. `renderPlan()` is already called by `moveSlot`, the swap-confirm path and Generate, so a single hook covers all three and every future mutation. `renderDayView` never calls `renderPlan`, so there is no recursion |
| Does "Move to day" close the day view | **No — it stays open and re-renders** via the hook above. The user is mid-inspection of that day; closing the sheet under them loses their place, and the meal vanishing from the slot plus the existing toast is confirmation enough |
| Does a confirmed swap close the day view | **No.** `renderSwapCards`'s `onSwipeRight` already calls `closeSwapPicker()` then `renderPlan()` (`plan.js:203-204`); the hook repaints the day sheet underneath, so the user lands back on the expanded day with the new meal in place. **No edit to `renderSwapCards` is needed for this** |
| Scrolling | **Nothing new.** `.modal-sheet` is already `max-height: 88vh; overflow-y: auto` with a `position: sticky` close button (`style.css:286-307`). A four-meal day scrolls in the sheet exactly like the recipe detail does. No inner scroll container, no virtualisation, no per-slot accordion |
| Image size in the day view | A **4rem square thumbnail** beside the meal name, not a 16/9 hero per meal — four hero images in one sheet is four screens of scrolling to read a day. Requires the specificity override in §5 |
| Sharing `cardImageHtml` | **No shared helper.** The day view's thumb has a different class, size and `alt` from `app.js:108`/`discover.js:23`, so the only reusable part is the ternary itself. Inlining one line in `daySlotHtml` keeps the duplication count exactly where it is (3) and touches no other file; hoisting `MP.cardImageHtml` into `data.js` would make it 4 copies until someone also rewrites `app.js` and `discover.js`, which is a `/simplify` pass, not this phase |
| Do the compact slot cards keep their warnings | **Yes, unchanged.** `renderPlan`'s day-cell HTML is not edited at all except to route line 104 through the new `warningHtml()`. At-a-glance warnings on the grid are still worth having, and leaving the markup alone makes the only behavioural change in `renderPlan` a one-line handler swap |
| Instructions in the day view | **Not inline** — a **Recipe** button per meal calling the existing `openDetail(meal)` (which already renders image + tags + ingredients + instructions, `plan.js:217`). Two lines, zero new rendering, and it opens above the day sheet at `z-index: 60` |
| Ingredient list markup | Extracted from `openDetail` (`plan.js:220-222`) into `ingredientListHtml(meal)` and used by both. Two call sites, byte-identical markup |
| Empty slot | Renders "Nothing planned." + an **Add a meal** button on the same `day-swap-btn` wiring. Same destination as today's tap-to-add, one tap deeper |
| `candidatesFor` null-slot guard | **Fixed here** (§2f). `candidatesFor` (`plan.js:143`) reads `.mealId` off the slot object without a guard while `mealAt` (`plan.js:41`) guards with `slot && slot.mealId` — a missing slot throws. This phase puts an explicit "Add a meal" button on that exact path, so the latent throw becomes reachable. One-line guard in the shared function |

---

## 0. What this phase is actually made of

| Roadmap item | Where it lands |
|---|---|
| A day tap opens a full expanded view | §1 (markup) + §2c (`openDayView`) + §2e (the handler swap at `plan.js:115-120`) |
| …of that day's meals | §2d — thumb, name, description, existing `tagRowHtml(meal)` |
| …ingredients | §2d via `ingredientListHtml`, extracted from `openDetail` |
| …and warnings | §2b `warningHtml()` + §2a promoting `warnings` to module scope, with the existing **Move to day** button preserved by reusing `wireMoveBtns()` |
| Renders what Phase 8 backfilled | §2d's thumb ternary + §5's `.day-thumb` override |
| Reuses the Phase 7 strip/modal styling | §1 reuses `.modal-overlay`/`.modal-sheet`/`.close-btn` verbatim; §5 widens two existing selectors rather than restating them |
| Swap moves one tap deeper | §2d's `day-swap-btn` → `openSwapPicker(day, slotType)`, unmodified |

**The trap that shapes §2a.** `warnings` is currently a `const` local to `renderPlan`
(`plan.js:78`). `renderDayView` needs the same map and must **not** recompute it — a second
`checkPlanWarnings` call over a 14-day plan on every sheet paint, with the risk of the two views
disagreeing. Promote the variable; `renderPlan` always runs before any day view can be opened
(it renders the cells that are tapped), and the §2c hook guarantees the sheet repaints *after*
`warnings` is reassigned, never before.

**The trap that shapes §5.** `.modal-sheet img` sets `width: 100%; aspect-ratio: 16/9`
(`style.css:308-313`) at specificity (0,1,1). A bare `.day-thumb` rule is (0,1,0) and **loses** —
the thumbnail silently renders as a full-width hero. Same trap for `.day-slot-note` against
`.day-slot p`. Both new rules are written with a two-class selector for that reason; do not
"tidy" them down to one class.

**The third thing to know.** `.slot-type` and `.slot-warning` are scoped as
`.slot-card .slot-type` / `.slot-card .slot-warning` (`style.css:486`, `493`). The day view uses
both class names, so those two selectors get a second comma-separated match — **not** a copy of
their declarations into new `.day-slot` rules.

---

## 1. `plan.html` — one new overlay pair

Insert immediately **before** `#swap-overlay` (line 41), so the file reads outermost-first:

```html
<div id="day-overlay" class="modal-overlay hidden" style="z-index:40;">
  <div id="day-sheet" class="modal-sheet"></div>
</div>
```

Inline `z-index` matching `#detail-overlay`'s existing inline style (line 44) — the convention in
this file is already "base 50 in CSS, per-overlay override inline", and a third `.modal-overlay`
variant class for one number is not worth a CSS rule.

**No script tag changes.** Everything this phase calls (`MP.ShelfLife`, `MP.Nutrition`,
`MP.Generator`, `esc`, `labelize`) is already loaded by `plan.html:49-56`.

---

## 2. `plan.js`

### 2a. Module state — two additions

```js
let warnings = {};        // "day-slotType" -> { message, moveToDay, category }; owned by renderPlan
let dayCtx = null;        // { day } while the expanded day view is open
```

`warnings` goes beside `plan` (line 15); `dayCtx` goes with the new section (§2c), mirroring how
`swapCtx` sits beside the swap picker at line 140.

In `renderPlan` (line 78), `const warnings = MP.ShelfLife.checkPlanWarnings(...)` becomes
`warnings = MP.ShelfLife.checkPlanWarnings(...)`. Nothing else in `renderPlan`'s body changes.

### 2b. Three extracted helpers (no behaviour change)

```js
/** The shelf-life warning line for one slot, with its Move-to-day button. "" when no warning.
 *  @param {number} day  @param {string} slotType
 *  @param {{message:string, moveToDay:number}|undefined} warn
 *  @returns {string} HTML */
function warningHtml(day, slotType, warn)
```
Body is the exact string currently inlined at `plan.js:104`, guarded by `if (!warn) return "";`.
`plan.js:104` becomes `${warningHtml(d.day, slotType, warn)}`.

```js
/** @param {object} meal  @returns {string} the <li> run for a <ul class="ingredient-list"> */
function ingredientListHtml(meal)
```
Body is `plan.js:220-222` verbatim. `openDetail` line 230 becomes
`<ul class="ingredient-list">${ingredientListHtml(meal)}</ul>` and its local `ingredientsHtml`
const is deleted.

```js
/** Wire every .move-btn inside `scope`. Called once per render, for the grid and the day sheet.
 *  @param {ParentNode} scope */
function wireMoveBtns(scope)
```
Body is `plan.js:121-126` with `root` → `scope`. The `e.stopPropagation()` stays — it is load
bearing inside `.slot-card` and harmless in the sheet. `renderPlan` calls `wireMoveBtns(root)`;
`renderDayView` calls `wireMoveBtns(sheet)`.

Also extract the two-line heading expression at `plan.js:92-94`, since the sheet needs the same
string:

```js
/** "Day 4 · Thu", or "Day 4" when the plan has no startDate. @param {number} day */
function dayHeading(day)
```
`renderPlan`'s `const heading = ...` becomes `const heading = dayHeading(d.day);`.

### 2c. The day view — open / close / render

```js
// ---- Expanded day view ----

/** @param {number} day */
function openDayView(day)      // dayCtx = { day }; renderDayView(); un-hide #day-overlay
function closeDayView()        // hide #day-overlay; dayCtx = null

/** Repaint #day-sheet from the current `plan` + `warnings`. No-op when closed. */
function renderDayView()
```

`renderDayView` body:

```js
if (!dayCtx) return;
const sheet = document.getElementById("day-sheet");
const day = dayCtx.day;
sheet.innerHTML = `
  <button class="close-btn" aria-label="Close">✕</button>
  <h2>${esc(dayHeading(day))}</h2>
  ${SLOT_TYPES.map((slotType) => daySlotHtml(day, slotType)).join("")}
  ${coverageHtml(dayMeals(day))}`;
sheet.querySelector(".close-btn").addEventListener("click", closeDayView);
wireMoveBtns(sheet);
sheet.querySelectorAll(".day-swap-btn").forEach((b) =>
  b.addEventListener("click", () => openSwapPicker(day, b.dataset.slot)));
sheet.querySelectorAll(".day-recipe-btn").forEach((b) => {
  const meal = mealAt(day, b.dataset.slot);
  if (meal) b.addEventListener("click", () => openDetail(meal));
});
```

- `coverageHtml(dayMeals(day))` is the **same call `renderPlan` already makes per day**
  (`plan.js:108`) — the day's nutrition summary is not re-derived or re-styled here.
- Do **not** reset `sheet.scrollTop` on repaint. A repaint fired by Move-to-day or a confirmed
  swap must not throw the user back to the top of the sheet; `openDayView` gets a fresh sheet
  either way because `innerHTML` assignment on a closed (`display:none`) sheet starts at 0.
- Listeners are re-attached wholesale on every repaint because `innerHTML` discards the old
  nodes. This is the same pattern as `renderSwapDeck` and `openDetail`; no delegation layer.

Last line of `renderPlan()`, after `wireMoveBtns(root)`:

```js
if (dayCtx) renderDayView();      // keep an open day sheet in sync with the plan it renders
```

### 2d. `daySlotHtml(day, slotType)`

```js
/** One slot's block inside the expanded day view.
 *  @param {number} day  @param {string} slotType  @returns {string} HTML */
function daySlotHtml(day, slotType)
```

Empty slot:

```html
<section class="day-slot">
  <div class="slot-type">${slotType}</div>
  <p class="muted">Nothing planned.</p>
  <div class="day-slot-actions">
    <button class="ghost day-swap-btn" data-slot="${slotType}">Add a meal</button>
  </div>
</section>
```

Filled slot:

```html
<section class="day-slot">
  <div class="slot-type">${slotType}</div>
  <div class="day-slot-head">
    ${meal.image
      ? `<img class="day-thumb" src="${esc(meal.image)}" alt="" loading="lazy">`
      : `<div class="day-thumb placeholder">🍽</div>`}
    <div>
      <h3>${esc(meal.name)}</h3>
      <p>${esc(meal.description || "")}</p>
    </div>
  </div>
  ${tagRowHtml(meal)}
  ${meal.leftoverOf ? `<p class="day-slot-note">Leftovers — already shopped for.</p>` : ""}
  <ul class="ingredient-list">${ingredientListHtml(meal)}</ul>
  ${warningHtml(day, slotType, warnings[`${day}-${slotType}`])}
  <div class="day-slot-actions">
    <button class="ghost day-swap-btn" data-slot="${slotType}">Swap</button>
    <button class="ghost day-recipe-btn" data-slot="${slotType}">Recipe</button>
  </div>
</section>
```

- `alt=""` on the thumb is deliberate and correct: the meal name is the adjacent text, so an
  `alt` would be a duplicate announcement to a screen reader. This differs from `app.js:109`,
  where the image *is* the card's primary content.
- `${slotType}` is interpolated raw — it is an element of the module-level `SLOT_TYPES` constant,
  exactly as at `plan.js:102`. Every value that is not a module constant (`meal.name`,
  `meal.description`, `meal.image`, ingredient labels, `warn.message`) goes through `esc()`.
- The `leftoverOf` line is one line and answers the question the ingredient list otherwise
  raises — "do I need to buy this again?". The shopping list already excludes leftovers
  (`test.html` group 13/14), so the claim is true. Drop it if it reads as clutter.

### 2e. The re-plumbed entry point (`plan.js:115-120`)

```js
root.querySelectorAll(".slot-card").forEach((el) => {
  el.addEventListener("click", (e) => {
    if (e.target.closest(".move-btn")) return;
    openDayView(Number(el.dataset.day));
  });
});
```

The `.move-btn` guard stays — the grid still renders warnings, so the button is still inside the
card. `el.dataset.slot` becomes unread by this handler; **leave the attribute on the markup**
(it costs nothing and removing it is a bigger diff than keeping it).

The **other** `openSwapPicker` call site — `onTap: () => openDetail(meal)` at `plan.js:210` and
the deck it belongs to — is untouched. So is `openSwapPicker` itself (`plan.js:154-158`).

### 2f. `candidatesFor` — the null-slot guard (`plan.js:143`)

```js
const slot = plan.days[day - 1].slots[slotType];
const currentId = slot ? slot.mealId : null;
```

`mealAt` guards this exact access and `candidatesFor` does not; `id !== currentId` with
`currentId === null` filters nothing, which is the right answer for an empty slot. This is the
root-cause fix in the shared function — the alternative (guarding at the new Add-a-meal button)
leaves the pre-existing tap-to-add path still able to throw.

### 2g. `init()` — one listener (beside lines 253-257)

```js
document.getElementById("day-overlay").addEventListener("click", (e) => {
  if (e.target.id === "day-overlay") closeDayView();
});
```

Backdrop-to-dismiss, identical in shape to the two above it. No Escape-key handling — none of the
three overlays has it today, and adding it for one is an inconsistency, not a feature.

---

## 3. What is deliberately not re-rendered

`renderPlan`'s day-cell markup, `.slot-grid`, the week blocks, the week coverage summary, the
Generate button and the Hermes banner are all untouched. The compact grid keeps its warnings and
its Move-to-day buttons. The **only** behavioural edit inside `renderPlan` is the handler body in
§2e; everything else there is a call-through to an extracted helper with identical output.

---

## 4. `openSwapPicker` and `openDetail` — confirmed unchanged

| Function | Change |
|---|---|
| `openSwapPicker` (154) | **None.** Called with a new second argument value from a new place; the function is byte-identical |
| `closeSwapPicker` (160) | **None** |
| `renderSwapDeck` / `renderSwapCards` (165 / 177) | **None.** `onSwipeRight`'s existing `renderPlan()` already triggers the day-sheet repaint via §2c's hook |
| `openDetail` (217) | Two lines: the ingredient map moves out to `ingredientListHtml`, the `<ul>` calls it. Its no-image branch (which renders **nothing**, unlike the day thumb) stays as-is |
| `moveSlot` (129) | **None.** Its existing `renderPlan()` carries the repaint |
| `MP.ShelfLife`, `MP.Nutrition`, `MP.Generator`, `generator.js`, `shopping.js`, `data.js` | **None** |

---

## 5. `style.css`

Two existing selectors widened — declarations are **not** duplicated:

```css
.slot-card .slot-type,  .day-slot .slot-type    { ... }   /* line 486, unchanged body */
.slot-card .slot-warning, .day-slot .slot-warning { ... } /* line 493, unchanged body */
```

New rules, appended after `.ingredient-list` (line 315) so they sit with the sheet styling:

```css
.day-slot { border-top: 1px solid var(--border); margin-top: .9rem; padding-top: .9rem; }
.day-slot:first-of-type { border-top: 0; margin-top: 0; }
.day-slot h3 { margin: 0 0 .15rem; font-size: 1rem; }
.day-slot p { margin: 0; color: var(--text-dim); font-size: .9rem; }
.day-slot .day-slot-note { margin-top: .4rem; }
.day-slot-head { display: flex; gap: .75rem; align-items: flex-start; margin: .3rem 0 .5rem; }
.modal-sheet .day-thumb { width: 4rem; height: 4rem; flex: 0 0 4rem; aspect-ratio: 1;
                          object-fit: cover; border-radius: .6rem; margin: 0; }
.day-thumb.placeholder { display: flex; align-items: center; justify-content: center;
                         background: var(--surface-alt); font-size: 1.5rem; }
.day-slot-actions { display: flex; gap: .5rem; margin-top: .6rem; }
```

- `.modal-sheet .day-thumb`, not `.day-thumb` — see §0's specificity trap. `margin: 0` is part of
  the override (`.modal-sheet img` sets `margin-bottom: 1rem`).
- `.day-slot .day-slot-note`, not `.day-slot-note` — same reason, against `.day-slot p`.
- Existing custom properties only (`--border`, `--text-dim`, `--surface-alt`). No new property,
  no media query (the sheet is already mobile-first and capped at 640px), no new CSS file.
- `.ghost`, `.muted`, `.tag-row`, `.coverage-list`, `.ingredient-list` are reused as-is.

---

## 6. `test.html` additions

New check group **28** (next free number after the existing group 27; the file already reuses
23/24 mid-file — do not renumber anything). No new script tags: `shelf-life.js` and `data.js`
are already loaded, and group 7 already exercises `MP.ShelfLife`.

The day view is DOM rendering inside `plan.js`'s IIFE with nothing exported, and extracting a
function purely to make it assertable would be scaffolding. What *is* worth pinning is the one
contract the new code newly depends on — the warning map's key shape, now read from two
independent render paths, where a mismatch fails **silently** (the warning simply never appears):

- `checkPlanWarnings` over a hand-built plan with a short-shelf-life dinner scheduled late in a
  run returns a key that is exactly `` `${day}-${slotType}` `` — *string-concatenated day and
  slot, no separator drift. Both `renderPlan` and `daySlotHtml` index by this literal*
- The value at that key has a **string** `message` and a **number** `moveToDay` — the two fields
  `warningHtml` interpolates
- `moveToDay` is in `1..14` and `!== day` — a self-move would make the Move button a no-op that
  still toasts, and the button now exists in two places
- A safe slot's key is `undefined`, not `null`/`{}` — `warningHtml`'s `if (!warn)` guard and
  `renderPlan`'s existing `warn ?` ternary both depend on falsiness
- Every meal in `meals.json` has an `ingredients` array (possibly empty) — cheap schema guard for
  `ingredientListHtml`, which the day view calls for **all four** slots rather than only the meal
  the user tapped

Everything else in this phase — overlay stacking, sheet scrolling, listener re-attachment, the
thumbnail specificity override — is only observable in a browser and is verified in §7's manual
pass, which is the honest place for it.

---

## 7. Edge cases

| Case | Behaviour |
|---|---|
| Tap an **empty** slot | Day view opens showing all four slots; that slot reads "Nothing planned." with **Add a meal** → `openSwapPicker`. Two taps where it used to be one — the roadmap's settled trade |
| Empty slot is `undefined` rather than `{ mealId: null }` | `mealAt` already guards; `candidatesFor` now does too (§2f). Previously a `TypeError` inside a click handler — no visible failure, the picker just never opened |
| Confirm a swap from inside the day view | Swap sheet closes (z 50), day sheet (z 40) is still open beneath and repaints via `renderPlan`'s hook with the new meal, its ingredients and its recalculated coverage line |
| Swap deck has no candidates | Existing "No other meals in your library for this slot yet" empty state, shown over the day sheet. Unchanged |
| Tap a meal's **Recipe** | `openDetail` at z 60, over both sheets. Closing it returns to the day view, which was never hidden |
| **Move to day** pressed inside the day view | `moveSlot` swaps the slot with the target day, toasts, `renderPlan` repaints the grid **and** the sheet. The sheet keeps showing the *same day number*, now holding the meal that came back the other way — correct, and the toast names both days |
| Move to day pressed on the **grid** | Identical to today. `wireMoveBtns(root)` is the same code, just extracted |
| Warning on a slot in the day view | Same message, same button, same `.slot-warning` styling via the widened selector. Not a second warning system |
| A day with 4 meals, all with photos | Sheet scrolls (`88vh`, `overflow-y: auto`, sticky close). ~4 × 4rem of image, not four heroes — the decision that keeps this readable on a phone |
| A meal with no image | `.day-thumb.placeholder` 🍽 tile, same 4rem square, so rows stay aligned. Phase 8 made this rare, not impossible |
| A meal with a Phase 8 **data-URL** image | Renders identically to a TheMealDB URL — `esc()` is a no-op on base64 (Phase 8 §6 pins this) and `object-fit: cover` handles the aspect ratio |
| Leftover meal (`leftoverOf` set) | Full ingredient list plus the "already shopped for" note. The shopping list already excludes it; the note stops the list from reading as a second shop |
| Batch-cook parent (`batchCook: true`) | Nothing special. Its leftover days appear as their own meals on their own days — the chain is a generator concern, not a view concern |
| Generate Plan pressed while the day view is open | Not reachable — the overlay covers the button. If it ever becomes reachable, the hook repaints the same day number of the new plan, which is coherent |
| Hermes pull lands while the day view is open | Same path: whatever triggers `renderPlan` repaints the sheet from the current `plan` |
| Backdrop tap / ✕ on the day sheet | `closeDayView`, `dayCtx = null`, so the hook goes quiet. Backdrop tap on the *swap* sheet closes only the swap sheet |
| Day view opened, then the library is emptied on another tab | `mealAt` returns `null` for missing ids, so slots degrade to "Nothing planned." rather than throwing |
| A meal name or ingredient containing `<`, `&`, `"` | `esc()` on every one of them, per the house `innerHTML` rule. Only `slotType` (a module constant) is raw |
| Keyboard / screen reader | Unchanged from today: `.slot-card` is still a `div` (pre-existing), but every new control is a real `<button>` and the close button carries `aria-label="Close"`. Not made worse, not fixed here |

---

## 8. Wiring

- `plan.html` — the one new overlay pair (§1). **No script tag changes.**
- `sw.js` — bump `CACHE` to `"meal-planner-v9"` (currently `"meal-planner-v8"`, line 4). **No
  `SHELL` change**: no new file exists.
- No `manifest.json`, `index.html`, `discover.html`, `shopping.html`, `app.js`, `discover.js`,
  `generator.js`, `shelf-life.js`, `data.js`, `worker/`, `meals.json`, `docs/HERMES.md` or
  `docs/ARCHITECTURE.md` change — confirm this rather than editing anything.
- `docs/roadmap.md` Phase 9 ⇒ `(Status: Complete)` in the same commit as the code
  (`.claude/skills/roadmap-gating/`).

**Manual pass (this phase is mostly not verifiable by `test.html`):**

1. Tap any slot card → the day sheet opens showing **all four** slots for that day, not just the
   tapped one, with the day's coverage line at the bottom.
2. Scroll the sheet on a day where every slot is filled — the ✕ stays pinned, the page behind
   does not scroll.
3. Tap **Swap** on the dinner → the swap picker opens **over** the day sheet (day sheet visible
   behind the dimmed backdrop, not replaced). Swipe right to confirm → picker closes, the day
   sheet is still open and now shows the new meal, its ingredients, and an updated coverage line.
4. Tap **Recipe** → the detail sheet opens above both; close it and the day sheet is still there.
5. Find a day with a shelf-life warning, press **Move to day N** inside the day sheet → toast
   fires, the grid behind updates, and the sheet stays open showing the swapped-in meal.
6. Confirm the compact grid still shows its warnings and its Move buttons, and that pressing a
   grid Move button does **not** open the day view.
7. Tap an empty slot (delete a meal from the library to force one, or use a sparse plan) →
   "Nothing planned." + **Add a meal** opens the picker with no console error.
8. On a phone-width viewport: thumbnails are 4rem squares, not full-width heroes, and a meal with
   no image shows the 🍽 tile at the same size.
9. Backdrop tap and ✕ both close the day sheet; reopen and confirm it starts at the top.

---

## 9. Deliberately not built

Editing a meal from the day view; deleting a slot / clearing a day; drag-and-drop between days
or slots; a per-slot "cook now"/"ate this" action (Phase 12 owns the eat flow); day-to-day
swipe navigation inside the sheet; a full-screen route (`?day=4`) or any URL/history state for
the open day; per-slot collapse/accordion; instructions inline (the Recipe button covers it);
a combined shopping list for a single day; portion/serving maths or scaling; per-slot nutrition
breakdown beyond the existing day coverage line (the tagging system is a checklist, not a
calculator); a second warning system or per-SKU/purchase-date shelf-life tracking; a shared
`MP.cardImageHtml` in `data.js` and the `app.js`/`discover.js` dedupe that would justify it
(a `/simplify` candidate, not this phase); Escape-key handling or a focus trap for any overlay;
making `.slot-card` a real `<button>`; touching `openSwapPicker`'s internals, the swipe deck,
`generator.js`, the meal schema, the Worker, or the dependency set.
