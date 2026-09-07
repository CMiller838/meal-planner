# Phase 19 Spec — Shopping list as two tabs

**Goal:** Move Phase 12's two stacked sections on `shopping.html` (planned list, ad-hoc list) into
two in-page tab views, so the page matches how Browse / Discover / Plan / Shopping are already
separate tabs in the nav.

This is a **pure presentation change**. No new list logic, no data or schema change, no new
dependency, no new JS file. `shopping-list.js` is not touched at all. The roadmap is explicit that
this is a layout preference, not a pain point — the bar for anything beyond markup, ~8 lines of
wiring and one CSS block is "don't".

## Decisions taken

One Decision Gate was raised at planning time. **The user explicitly selected Gate 1 → Path B**,
the recommended path.

| # | Decision | Why |
|---|---|---|
| 1 | Tabs are **two `<button role="tab">` elements + two panels toggled with the existing `.hidden` class**, wired by ~8 lines in `shopping.js` — **Gate 1, Path B, explicitly selected by the user** | Keeps real ARIA semantics and hash deep-linking, which Path A (a zero-JS radio/`:checked` trick) quietly drops, without the abstraction of Path C |
| 2 | **No shared `MP.tabs()` helper.** The reusable artefact is the CSS/markup convention (`.tab-bar` / `.tab-btn` / `.hidden` panels), which a future page copies as four lines of markup | Gate 1 Path C, rejected by the user for now and **parked in `docs/FUTURE.md`**: build the helper if and when a second page actually wants tabs, shaped by that page's needs rather than guessed at here |
| 3 | Hiding uses the existing **`.hidden` class** (`style.css:367`), not the `[hidden]` attribute | `plan.html`'s modal overlays already use `.hidden`; there is no `[hidden]` attribute rule in `style.css` and adding a second hide convention for one page is slop. Planner's call, not a gate |
| 4 | The active tab is stored in **`location.hash`** (`#planned` default, `#adhoc`), not localStorage and not a module variable | Free deep-linking, free back-button behaviour, zero new storage key, and nothing to migrate. Planner's call |
| 5 | **Planned list is the default tab**; an unknown/empty hash falls back to it | It is the two-week shop and the reason the page exists (same ordering rationale as `phase12_spec.md` §6) |
| 6 | The tab bar renders **always**, including the "No plan yet" state | The ad-hoc list works before a plan has ever been generated (Phase 12 decision) — hiding its tab behind a plan would regress that. The empty message lives *inside* the planned panel |
| 7 | `#shopping-meta`, `#shopping-root`, `#adhoc-root` keep their IDs, and `render()` / `renderAdhoc()` / their event wiring are **unchanged** | The tab mechanism operates on the wrapper panels, one level above every element those functions touch. Nothing in either render path needs to know tabs exist |
| 8 | **No `test.html` group.** The only new logic is a DOM class toggle; `test.html` is a pure-function harness with no DOM fixtures | Adding a DOM harness to assert `classList.contains("hidden")` costs more than the code it guards. Manual pass covers it (§6) |

## What changes

| File | Change |
|---|---|
| `shopping.html` | Tab bar + two panel wrappers around the existing content (lines 29-39) |
| `shopping.js` | One `initTabs()` function + one call in `init()` |
| `style.css` | One `/* ---- Tabs (Phase 19) ---- */` block |
| `sw.js` | `CACHE` bump only |
| `docs/FUTURE.md` | Park the `MP.tabs()` helper idea (decision 2) |

---

## 1. `shopping.html` — markup

The current lines 29-39 become a tab bar plus two panels. The three existing IDs and the `<h2>`
text are preserved verbatim; only wrappers are added.

```html
<main>
  <div class="tab-bar" role="tablist">
    <button class="tab-btn active" role="tab" id="tab-planned"
            aria-controls="panel-planned" aria-selected="true">Shopping list</button>
    <button class="tab-btn" role="tab" id="tab-adhoc"
            aria-controls="panel-adhoc" aria-selected="false">Ad-hoc list</button>
  </div>

  <section id="panel-planned" class="tab-panel" role="tabpanel" aria-labelledby="tab-planned">
    <p id="shopping-meta" class="muted"></p>
    <div id="shopping-root"></div>
  </section>

  <section id="panel-adhoc" class="tab-panel hidden" role="tabpanel" aria-labelledby="tab-adhoc">
    <div id="adhoc-root"></div>
  </section>
</main>
```

- The two `<h2>` headings are **deleted** — the tab labels are now the headings. Two labels saying
  the same word twice on one screen is the thing this phase exists to remove.
- The panels drop `class="section"` (`section.section` is only `margin-top: 2rem`, `style.css:197`)
  — the tab bar now supplies the top spacing. `.tab-panel` carries it instead.
- `#shopping-meta` moves **inside** `#panel-planned`, above `#shopping-root`. It describes the
  planned list only ("From your plan starting …") and must not show on the ad-hoc tab.
- Nav, `<head>`, and all six script tags are unchanged. No new file ⇒ no `sw.js` `SHELL` entry.

## 2. `shopping.js` — the wiring

One new function, appended near `init()`. Nothing else in the file moves — `render` (line 66),
`renderAdhoc` (line 110), `lineHtml`, `blockHtml`, `adhocHtml`, the tick handler and the ad-hoc
add/remove handlers are all untouched, and both render paths keep firing independently exactly as
they do today.

```
function showTab(name)   // name: "planned" | "adhoc"; toggles .hidden + .active + aria-selected
function initTabs()      // read location.hash, wire click + hashchange
```

**`showTab(name)`** — for each of the two `{btn, panel}` pairs: `panel.classList.toggle("hidden",
pairName !== name)`, `btn.classList.toggle("active", pairName === name)`,
`btn.setAttribute("aria-selected", String(pairName === name))`. No re-render, no data read, no
storage write. Both panels stay in the DOM the whole time, so the ticked-state of the planned list
and the ad-hoc inputs survive tab switches with nothing to preserve.

**`initTabs()`**
1. `showTab(location.hash === "#adhoc" ? "adhoc" : "planned")` — decision 5, any unknown hash lands
   on planned.
2. On each tab button `click`: set `location.hash` to `#planned` / `#adhoc` and call `showTab`.
   Setting the hash is what makes Back work; calling `showTab` directly means the UI does not wait
   on the `hashchange` event.
3. `window.addEventListener("hashchange", …)` calling `showTab` off the current hash — this is the
   Back/Forward path and the deep-link path (`shopping.html#adhoc`).

**`init()` (line 139)** gains **one line**: `initTabs();` immediately after `MP.initTheme();` —
i.e. *before* the `if (!plan …)` early return at line 146, so the tabs work on a page with no plan
(decision 6). No other line in `init()` changes; `renderAdhoc()` and the plan branch keep their
current order.

Keyboard: the buttons are real `<button>`s, so Tab-to-focus and Enter/Space activation are free.
`ponytail:` comment on `initTabs` — no arrow-key roving tabindex; two tabs on one page do not earn
a roving-focus implementation, add it if a page ever grows a long tab row.

## 3. `style.css` — one block

New block at the end of the file, commented `/* ---- Tabs (Phase 19) ---- */` (matching the
`/* ---- Meal variants (Phase 14) ---- */` convention at line 393).

- `.tab-bar` — `display: flex; gap: .5rem; margin-top: 1.5rem;` plus `overflow-x: auto` behaviour by
  reusing the existing `.hscroll` treatment if the labels ever wrap on a narrow phone.
- `.tab-btn` — mirrors `.nav a` (lines 86-97): `var(--text-dim)`, padding `.5rem .9rem`,
  `border-radius: 999px`, transparent background, `border: none`, `cursor: pointer`, same
  bg/color transition.
- `.tab-btn.active` — mirrors `.nav a.active` (line 97): `#fff` on `var(--accent)` with the same
  `box-shadow`. **Reuse the existing variables; introduce no new colour** and do not touch the
  `.nav` rules themselves.
- `.tab-panel` — `margin-top: 1rem` only. It replaces the `section.section` spacing the panels lost.

No change to `.hidden`, `.shop-block`, `.shop-list`, `.shop-line`, `.adhoc-add`, `.muted`,
`.empty`, or any `.nav` rule.

## 4. `sw.js`

Bump `CACHE` (line 4) `"meal-planner-v14"` → `"meal-planner-v15"`. **No `SHELL` change** — no new
file, and `shopping.html`/`shopping.js`/`style.css` are already cached entries.

## 5. `docs/FUTURE.md`

One parked idea, per decision 2: a shared `MP.tabs(root)` helper (roles, `aria-selected`,
hash sync, arrow-key roving focus) — **only** if a second page ever wants in-page tabs, so it can
be shaped by two real consumers instead of one guessed one.

## 6. Wiring order

1. `shopping.html` markup (§1).
2. `shopping.js` `showTab`/`initTabs` + the one `init()` line (§2).
3. `style.css` block (§3).
4. `sw.js` `CACHE` bump (§4); `docs/FUTURE.md` note (§5).
5. **Manual pass** (`python3 -m http.server 8000`) — see the task list; this phase has no
   automated check by decision 8.
6. Flip `docs/roadmap.md` Phase 19 to **Status: Complete** in the same commit as the code.

## Edge cases

| Case | Behaviour |
|---|---|
| No plan generated yet | Tab bar renders; planned panel holds the existing `.empty` "No plan yet" message; the ad-hoc tab works fully (decision 6) |
| Deep link `shopping.html#adhoc` | Opens on the ad-hoc tab (`initTabs` step 1) |
| Unknown hash (`#foo`, stale bookmark) | Falls back to planned, no throw |
| Back button after switching tabs | `hashchange` fires, `showTab` follows — returns to the previous tab rather than leaving the page |
| Ad-hoc background fetch resolves while the planned tab is showing | `renderAdhoc()` repaints a hidden panel; the content is correct when the tab is opened. No coupling needed |
| Ticking planned lines, then switching tabs and back | Ticks persist — panels are hidden, never removed or re-rendered |
| Typing in the ad-hoc add inputs, then switching tabs and back | Input values survive for the same reason |
| JS disabled / fails to load | Both panels are in the DOM; the ad-hoc one carries `hidden` in the markup, so it is unreachable. Accepted — the whole page is JS-rendered already, nothing renders without it |

## Confirmed unchanged

| Thing | Why it stays put |
|---|---|
| `shopping-list.js` in full (`buildLists`, `packsFor`, `parseQty`, `normalizeKey`, `pantryIndex`) | Presentation-only phase; no list logic is in scope |
| `render()`, `renderAdhoc()`, `lineHtml`, `blockHtml`, `adhocHtml`, `fmtQty` and every existing event listener in `shopping.js` | The tab mechanism sits one level above every element they touch |
| `#shopping-meta`, `#shopping-root`, `#adhoc-root` IDs | Explicit constraint; the panels wrap them, nothing renames them |
| `mp_shopping_ticked`, `mp_adhoc`, `mp_plan`, `MP.Sync` and every op/flush path | No storage change of any kind |
| `.hidden`, `.nav`, `.shop-*`, `.adhoc-add` CSS rules | Only additive CSS |
| Every other page's markup and the nav bar | Only `shopping.html` gains tabs |

## Deliberately not built

- **A shared `MP.tabs()` helper** — decision 2, parked in `docs/FUTURE.md`.
- **Arrow-key roving tabindex** — two buttons; `ponytail:` ceiling named in `initTabs`.
- **Animated tab transitions / sliding indicator** — motion for a layout preference is where this
  phase would stop paying for itself.
- **A badge/count on the ad-hoc tab label** — plausible, unrequested; add it if the hidden list
  actually gets forgotten in real use.
- **Remembering the last tab in localStorage** — the hash covers it without a storage key.
- **Tabbing any other page** (`plan.html`, `index.html`) — no second consumer exists.
- **Any change to list contents, ordering, pricing or shelf-life warnings** — Phase 17/18 settled
  those; this phase only re-presents them.
