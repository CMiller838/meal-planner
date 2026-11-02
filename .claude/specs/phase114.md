# Phase 114: App shell, bottom tabs and Hermes bar [M]
Plain: every page shares one frame: icon tabs along the bottom on a phone (Tonight, Browse, Discover, Shopping, Eaten), pill tabs at the top on a PC, and the Hermes Log/Ask bar docked just above the tabs.

Prototype picked 2026-11-01: `design-prototypes/ui-concepts/shell-a.html`. Requires nothing unbuilt. **Retagged [L] → [M]:** Phase 108 already has the phone bottom tab bar
(`.nav-links` fixed at `<640px`, hidden while an input is focused or a sheet/chat is open), and Phases 102/109 already dock the
Log/Ask bar (`ate-box.js` `.ate-bar`, `.ate-modes`) above it with a `visualViewport` keyboard lift. So this phase is the visual delta only.
It changes no `ate-box.js`/`bar-chat.js` logic.

## Decisions
User-chosen: shell A. **The first tab says "Tonight" from this phase on** and links to `plan.html`, which shows the current
2-week plan until Phase 112 builds the hero there (2026-11-01).
Own calls:
- **The nav stays static HTML on each of the 6 pages** (`index`, `discover`, `plan`, `plan-with-me`, `shopping`, `eaten`), not rendered by JS:
  it works with no JS, and it keeps `.nav-links a.active`, `#theme-toggle` and `initTheme` (`data.js`) as they are. Order: Tonight (`plan.html`),
  Browse (`index.html`), Discover, Shopping, Eaten. `plan-with-me.html` marks Tonight active. The brand stays.
- **Icons come from one new sprite file, `nav-icons.svg`** (symbols `i-tonight`, `i-browse`, `i-disc`, `i-shop`, `i-eaten`, copied from shell-a),
  used as `<svg class="tab-ic" aria-hidden="true"><use href="nav-icons.svg#i-tonight"/></svg>` inside each `<a>`, before a
  `<span class="tab-l">` label. Same-origin `<use>` needs no JS, and the file is added to `sw.js` `SHELL`.
- **Phone (<640 px):** each tab is an icon over its label. The active tab gets shell-a's accent pill behind the icon
  (`.tab-ic` wrapper about 3.4×1.9 rem, scale 1.06 with `--ease-lift`) in place of today's full accent block. Label .72 rem.
  The existing hide rules (focus, modal, `chat-open`) stay; the hide becomes a `translateY(100%)` slide where `display:none` is used today,
  and it is instant under reduced motion.
- **PC (≥640 px):** the tabs are centred pills with an inline icon and label, and the active one is the accent pill (today's look plus the icon).
  The `.ate-bar` becomes a centred card, `width: min(720px, 100%)`, with a top-rounded border, as in shell-a. Its CSS already caps it at
  `max-width: 40rem; margin: 0 auto`, so this only adds the radius and border.
- **The recents row shows only while the bar is open** (focused). This is already true (`chips.hidden = … !bar.classList.contains("open")`),
  so only CSS changes: shell-a's `grid-template-rows` 0fr→1fr reveal, in place of the instant show.
- **No change to:** `ate-box.js`/`bar-chat.js` (logic and keyboard lift), Plan chat's `chat-open` hiding, or the toast offsets
  (they already key off `--tabbar-h`). If the taller icon tab needs it, `--tabbar-h` goes to `4rem` and every existing `calc()` follows.
- No new dependency. The only new file is `nav-icons.svg` (no clash: `ls nav-icons*` is empty).

## Files touched
- `index.html`, `discover.html`, `plan.html`, `plan-with-me.html`, `shopping.html`, `eaten.html`: nav block only (order, labels, icon `<svg><use>`, label span).
- `nav-icons.svg` (new). `sw.js`: add `"nav-icons.svg"` to `SHELL` and bump `CACHE` (task 1).
- `style.css`: the `/* ---- Nav ---- */` block and the Phase 108 `@media (max-width: 639px)` tab-bar rules (around line 1099) and the `.ate-bar` /
  `.ate-recents` rules (around line 1040), in place. Both themes, 390 px and PC, 44 px targets, reduced motion.
- `tools/browser-check/walk.mjs`: update the Phase 108 tab-bar step (around line 51; its `/Browse/` active-text check still matches) and add the steps below.
- `data_check.py`: only if its SHELL check needs a new file listed (grep `SHELL` there first).
- `docs/UI_STYLE.md`: one line for the icon tab bar and the PC bar card. `docs/roadmap.md`: heading retag `[M]` (done at planning), `— done` on commit.

## Signatures
None new (markup and CSS only). The `.nav-links > a` structure becomes `<a href class="active?"><svg class="tab-ic">…</svg><span class="tab-l">Label</span></a>`.

## Edge cases
- `initTheme`'s `active.scrollIntoView` on the hscroll row: harmless, keep it.
- `.hscroll` on PC: 5 pills plus the brand plus the toggle must fit at 640 px with no horizontal page scroll (`ui-check` overflow check).
- A missing sprite (offline before the SW caches it) leaves the labels showing: the label is never icon-only.
- Light theme: the tab bar uses `var(--surface)`, as today, so the icon and label contrast must hold on it. Check by eye in both themes.
- A modal or Plan chat open: the tabs and bar stay hidden, as today (existing walk step at line 661).

## Verification
- `python3 check.py` passes: data_check (sw bump, SHELL), ui pages (every page at PC and phone, dark and light), and ui walk.
- `walk.mjs`, phone width:
  - (a) the tab bar is fixed at the bottom with 5 tabs in the order Tonight, Browse, Discover, Shopping, Eaten, and each tab has an `svg use` and a label;
  - (b) on `plan-with-me.html` the active tab is Tonight;
  - (c) focusing `.ate-input` hides the tab bar (its bounding top ≥ `innerHeight` or not visible) and the bar sits at the bottom, and blurring brings both back;
  - (d) `.ate-recents` is not visible before focus (the existing recents seed applies).
- `walk.mjs`, PC width: (e) `.nav-links` is not fixed at the bottom, the active pill has an icon, and `.ate-bar` width ≤ 720 px and is centred (±2 px).
- Screenshots: `node tools/browser-check/ui-check.mjs --theme-key mp_theme --shots out/` (from `tools/browser-check`, with `PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers`).
  Compare them with `shell-a.html` by eye via `prototype-preview` at 390 px and PC, in both themes.
- No real credential needed.

## Tasks
Logic
- [ ] 1. Add `nav-icons.svg` (5 symbols from shell-a) and add it to `sw.js` `SHELL`, bump `CACHE`, and run `python3 data_check.py`.

UI (follow `ui-build`)
- [ ] 2. Rewrite the nav block on all 6 pages: Tonight/Browse/Discover/Shopping/Eaten, icon + label, keeping the `active` classes (Tonight is active on `plan-with-me.html`).
- [ ] 3. `style.css`: phone icon tabs with the active pill, the slide-hide in place of `display:none` (instant under reduced motion), and the `--tabbar-h` follow-through.
- [ ] 4. `style.css`: PC centred icon pills and the `.ate-bar` card (radius, border, ≤720 px).
- [ ] 5. `style.css`: the `.ate-recents` grid-rows reveal on `.ate-bar.open` (it stays `hidden`-driven by `ate-box.js`).
- [ ] 6. `walk.mjs`: update the Phase 108 step and add steps (a)–(e).
- [ ] 7. `docs/UI_STYLE.md` line. Run `python3 check.py` (timeout 600000), then screenshots, then check by eye against shell-a at both widths and in both themes.
