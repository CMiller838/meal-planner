# Phase 12 Spec — Eat flow & split shopping lists

**Goal:** Mark a meal eaten from the plan or the library, review the remaining ingredient
quantities, confirm, deduct from the pantry, and drop any shortfall onto a separate ad-hoc
shopping list alongside the existing planned one.

Phase 11 made the app a pantry *reader*. This phase makes it a *writer*, and adds the second
list the shortfall lands in. `worker/worker.js` gains one key (`adhoc`) reusing the validator
`/pantry` already has; `docs/ARCHITECTURE.md` and `docs/HERMES.md` are updated in the same
commit. **No new dependency. No new JS file.**

## Decisions taken

Two Decision Gates were raised at planning time. The user answered both explicitly:
**Gate 1 → Path B** and **Gate 2 → Path A**.

Gate 1's Path B (a synced KV `/adhoc` endpoint) was chosen **against** the planner's
recommendation of Path A (localStorage-only), deliberately: the user wants Hermes to have maximum
connectivity to the ad-hoc list — read *and* write. Gate 2's Path A (local-first pantry write) was
the recommended path and was confirmed: the app must stay fully usable with Hermes/sync off, with
best-effort sync once it is back.

| # | Decision | Why |
|---|---|---|
| 1 | The ad-hoc list is a **synced KV key** (`adhoc`, `GET/PUT /adhoc`), not localStorage-only — **Gate 1, Path B, explicitly selected by the user** | The user wants maximum Hermes connectivity, including write access to this list. "Add milk to my shopping list" over chat is the obvious sibling of `/pantry`, and the Worker handler is a copy of one that already exists |
| 2 | Every write is **local-first**: the localStorage mirror is updated synchronously and the UI renders from it; the network push is best-effort — **Gate 2, Path A, explicitly selected by the user** | The user requires the app to work with Hermes off. Sync unconfigured, offline, or Worker down must all leave the eat flow fully functional |
| 3 | Pushes replay a **pending-op log** (`sub`/`add`/`remove`) against a **freshly fetched** remote array, never a stale snapshot | `docs/HERMES.md` explicitly warns against PUTting from stale data because a PUT clobbers the whole array. Item-granular ops mean a Hermes edit to a *different* item survives our push |
| 4 | The ad-hoc list uses the **identical item shape to the pantry** (`{name, qty?}`) | The Worker's `pantryError` validator is reused verbatim as `itemsError` — one shape, one validator, one relay pattern, zero new schema thinking |
| 5 | Deduction logic lives in **`shopping-list.js`**, not a new `eat.js` | It needs `normalizeKey`, `pantryIndex` and `parseQty`, all of which already live there. A new file would be a new `sw.js` SHELL entry and a new script tag to buy nothing |
| 6 | An ingredient with **no pantry entry produces no shortfall** | Absence from the pantry means "not tracked", not "I have none". Otherwise a user who tracks three things gets a 12-line ad-hoc list on the first eat. Only a *tracked* item that runs to 0 is a real shortfall |
| 7 | "Eaten" is a flag **on the plan slot in `mp_plan`**, local-only | `docs/ARCHITECTURE.md:74` — the plan is never stored in KV, and Phase 13 is where that constraint gets revisited. This phase must not pre-empt it |
| 8 | Plan-eat and library-eat share **one confirm sheet and one commit function**; the only difference is whether a plan slot gets flagged | The review/deduct/shortfall half is identical. Two code paths for one flow is the bug factory |
| 9 | The ad-hoc list is rendered as its **own block on `shopping.html`**; `buildLists` is **not touched** | The planned list is pack-size/price/shop-day maths. The ad-hoc list is free text with no pack data. Forcing them through one function would corrupt both |
| 10 | Ticking an ad-hoc line **removes it** | It is a "ran out of / want to buy" scratch list, not a two-week list with persistent tick state. No `mp_shopping_ticked` involvement at all |

## What this phase is made of

| Roadmap item | Sections |
|---|---|
| Sync layer that works with Hermes off | §1 `hermes-sync.js` |
| Deduction + shortfall maths (pure) | §2 `shopping-list.js` |
| Mark eaten from the plan / from the library | §3 `plan.js`, §4 `plan.html` |
| Separate ad-hoc shopping list | §5 `shopping.js`, §6 `shopping.html` |
| `/adhoc` endpoint | §7 `worker/worker.js` |
| Styling | §8 `style.css` |
| Checks | §9 `test.html` group 31 |
| Docs + wiring | §10, §11 |

---

## 1. `hermes-sync.js` — generic two-list sync, local-first

Phase 11 left `fetchPantry()` (lines 107-130) as a read-only mirror with a `ponytail:` comment
saying Phase 12 adds the write path. This is that write path. Generalise rather than duplicate:
`pantry` and `adhoc` are the same shape, the same endpoint pattern and the same mirror rule.

New localStorage keys beside the existing ones (lines 9-12):

| Key | Contents |
|---|---|
| `mp_adhoc` | `{ updatedAt, items: [{name, qty?}] }` — mirror, same shape as `mp_pantry` |
| `mp_sync_ops` | `[ {list, type, name, qty?} ]` — pending ops, oldest first |

### 1a. Generalise the read

```
MP.Sync.fetchItems(list) -> Promise<{updatedAt, items} | null>   // list: "pantry" | "adhoc"
MP.Sync.fetchPantry()    -> Promise<{updatedAt, items} | null>   // = fetchItems("pantry")
```

`fetchItems` is `fetchPantry`'s existing body with `"/pantry"` → `` `/${list}` `` and
`"mp_pantry"` → `` `mp_${list}` ``. Every Phase 11 rule is preserved verbatim: disabled config
returns the mirror without touching the network, a body whose `items` is not an array is treated
as a failure so a malformed blob never wipes the mirror, and **it never throws to the caller**.

`fetchPantry()` stays as a one-line alias so Phase 11's two callers (`shopping.js:95`,
`discover.js`'s `pantryIndexCached`) need **no edit**.

### 1b. Local reads and writes (never touch the network)

```
MP.Sync.localItems(list)        -> [{name, qty?}]     // mirror's items, [] on missing/malformed
MP.Sync.writeLocalItems(list, items) -> void          // mirror = {updatedAt: now, items}
```

`localItems` is the synchronous read every renderer uses — the ad-hoc list must paint instantly
with no network in the critical path. `writeLocalItems` is the only writer of the two mirrors.

### 1c. The pending-op log

```
MP.Sync.queueOp(op) -> void     // op: {list, type, name, qty?}
MP.Sync.applyOps(items, ops) -> [{name, qty?}]    // PURE. exported for test.html
MP.Sync.flushOps() -> Promise<"off"|"noop"|"ok"|"error">
```

Three op types, matched by `MP.ShoppingList.normalizeKey(name)` on both sides:

| `type` | Meaning | Effect in `applyOps` |
|---|---|---|
| `sub` | Pantry deduction from an eat | Item found ⇒ `qty` becomes `fmtRemaining(parseQty(item.qty), parseQty(op.qty))`; not found, or either side unparseable, or units differ ⇒ **item left exactly as-is** |
| `add` | Ad-hoc line added | Existing item with the same normalized name ⇒ `qty` replaced by `op.qty`; otherwise append `{name, qty}` (drop `qty` entirely when empty) |
| `remove` | Ad-hoc line ticked off | Drop the matching item; a miss is a no-op, never an error |

`applyOps(items, ops)` is **pure**: takes an array, returns a new array, mutates nothing, never
throws on a malformed op (skip it). This is the function `test.html` group 31 leans on hardest.

`flushOps()`:
1. `if (!config().enabled) return "off";` — ops stay queued for whenever sync is configured.
2. `if (no ops) return "noop";`
3. For each distinct `list` present in the queue: `GET /${list}` via `req()` (a **fresh** fetch,
   never the mirror — this is the whole point of decision 3), `applyOps(remote.items || [], opsForList)`,
   `PUT /${list}` with `{items: result}`.
4. On success: drop that list's ops from `mp_sync_ops`, and `writeLocalItems(list, result)` so the
   mirror converges on what the server now holds.
5. On any throw: **leave the ops queued**, return `"error"`. Never throw to the caller.

`ponytail:` comment on `flushOps`: at-least-once, not exactly-once — a PUT that succeeds but whose
response is lost will replay its `sub` and double-deduct on the next flush. Single user, low
frequency, and the cost is retyping one pantry quantity. Add op ids + a server-side dedupe only if
that ever actually bites.

`start()` (lines 134-140) gains **one line**: call `flushOps()` alongside the existing sync work,
so a queue built up while offline drains on the next page load that has a connection.

## 2. `shopping-list.js` — deduction and shortfall (pure, DOM-free)

Three new exports. All pure, all reusing the Phase 11 helpers already in this file.

```
MP.ShoppingList.fmtRemaining(have, used)    -> string
MP.ShoppingList.eatPlan(meal, used, pantry) -> { ops, rows }
```

**`fmtRemaining(have, used)`** — both `{value, unit}` from `parseQty`. Returns the display/storage
string for `have - used`, clamped at 0, e.g. `{value:800,unit:"g"}` minus `{value:300,unit:"g"}`
⇒ `"500g"`. Units are assumed already matched by the caller. Trim trailing `.0`, so `"500g"` not
`"500.0g"`.

**`eatPlan(meal, used, pantry)`** — the whole decision table for one meal, in one pure function.

- `used` is `{ [ingredientKey]: qtyString }` — what the user actually consumed, defaulted from the
  recipe but editable in the sheet (§3b). A key that is absent or an empty string means **this
  ingredient was not consumed** and is skipped entirely.
- `pantry` is the object from `fetchItems("pantry")` (or `null`).
- Returns `rows` (one per meal ingredient, for rendering the review sheet) and `ops` (what to
  queue). It performs **no I/O and no storage writes** — the caller does both.

`rows[i]`:

| Field | Type | Meaning |
|---|---|---|
| `key`, `label` | `string` | From the meal ingredient |
| `used` | `string` | The qty being consumed (echo of the input) |
| `have` | `string \| null` | Raw pantry text, `null` when the ingredient is not in the pantry |
| `after` | `string \| null` | Remaining pantry qty after deduction; `null` when no deduction is possible |
| `shortfall` | `boolean` | `true` only when a tracked item was driven to 0 with a remainder |
| `note` | `string \| null` | `"not tracked"` / `"can't subtract from “half a bag”"` — the reason `after` is `null` |

The decision table, applied per ingredient:

| Pantry state | `after` | `ops` emitted | `shortfall` |
|---|---|---|---|
| No matching pantry entry | `null`, `note: "not tracked"` | none | `false` (decision 6) |
| Matched; `have` and `used` parse, same unit, `have >= used` | `fmtRemaining` | one `sub` | `false` |
| Matched; parse, same unit, `have < used` | `"0"` | one `sub` (clamps to `"0"`) **and** one `adhoc` `add` for the remainder `used - have` | `true` |
| Matched; qty unparseable (`"half a bag"`) or empty | `null`, `note` naming the text | none | `false` |
| Matched; units differ (`have "2 tins"`, `used "300g"`) | `null`, `note` naming both | none | `false` |
| Meal ingredient has no `qty` at all (`needed` is `null`) | `null`, `note: "no quantity"` | none | `false` |

An item driven to exactly 0 keeps its pantry entry with `qty: "0"` — it is **not removed**. You
still own the slot on the shelf; deleting it would lose the fact that it's a thing you buy, and
Hermes is the pantry's other editor.

`ponytail:` comment: matching is Phase 11's `normalizeKey` exact match, inherited wholesale — no
synonyms, no unit conversion beyond `parseQty`'s existing kg→g / l→ml. Same ceiling, same upgrade
path (an alias map), do not add a second matching strategy here.

**`buildLists`, `packsFor`, `parseQty`, `normalizeKey`, `pantryIndex` and the line shape are
unchanged.** The planned list must behave byte-identically to Phase 11 — group 30 is the guard.

## 3. `plan.js` — the eat entry points and the confirm sheet

### 3a. Marking a slot eaten

`mp_plan`'s slot shape gains one optional field, written only by this flow:

```js
slots: { dinner: { mealId: "…", eatenAt: "<ISO8601>" } }
```

Everything that reads a slot today reads `mealId` and ignores unknown fields, so nothing else
needs a change. `MP.Generator` is **not touched** — a regenerated plan simply has no `eatenAt`
anywhere, which is correct.

### 3b. The confirm sheet

Reuse the existing overlay pattern (`plan.html` already has three `.modal-overlay`/`.modal-sheet`
pairs; `openDayView`/`closeDayView` at lines 262-271 are the model). One more pair, one more
module-level context:

```js
let eatCtx = null;   // { meal, day, slotType } — day/slotType null for a library eat
```

```
function openEatSheet(meal, day, slotType)   // day/slotType optional; fetch pantry, render
function closeEatSheet()
function renderEatSheet(pantry)              // repaint #eat-sheet from eatCtx + current inputs
function commitEat()                         // the only writer; see 3c
```

`openEatSheet` awaits `MP.Sync.fetchItems("pantry")` before the first render — but because
`fetchItems` falls back to the mirror and **never throws**, an unconfigured or offline sync just
yields the mirror or `null`, and the sheet still opens with every row marked `"not tracked"`. The
flow is never blocked by the bridge. Render immediately with a "checking pantry…" line rather than
holding the sheet closed on the network.

Sheet contents:

- `<h2>` the meal name, `esc()`d.
- One row per meal ingredient: the label, a `<input type="text" class="eat-qty" data-key="…">`
  pre-filled with the recipe qty, and the `have → after` summary or the `note`.
  Clearing the input excludes that ingredient (decision: empty = not consumed).
- Re-run `eatPlan` on every `input` event and repaint only the summary spans — this is the
  "review the remaining ingredient quantities" the roadmap asks for, and it has to update live or
  editing a quantity is guesswork.
- A shortfall count line: `"2 items will be added to your ad-hoc list"`, or nothing when zero.
- `Confirm` and `Cancel` buttons. `Cancel` is `closeEatSheet` and writes nothing at all.

**Every pantry string and every ingredient label goes through `esc()`** before it reaches
`innerHTML` — pantry text is Hermes/user free text over the network, the same trust boundary as
TheMealDB (`CLAUDE.md` invariant).

### 3c. `commitEat()` — the one writer, ordered local-first

1. `const {ops, rows} = MP.ShoppingList.eatPlan(meal, readInputs(), pantry)`.
2. Apply the ops to **both mirrors immediately** via `MP.Sync.applyOps` +
   `MP.Sync.writeLocalItems` — pantry ops to `pantry`, `add` ops to `adhoc`. The UI is now correct
   whether or not a network exists.
3. `ops.forEach(MP.Sync.queueOp)`.
4. If `eatCtx.day` is set: write `eatenAt` into that `mp_plan` slot and `renderPlan()` (which
   repaints an open day sheet via Phase 9's `if (dayCtx) renderDayView();`).
5. `closeEatSheet()`, then a toast into the existing `#toast-root`: `"Eaten — pantry updated"`,
   plus `" · 2 added to ad-hoc list"` when there were shortfalls.
6. `MP.Sync.flushOps()` **fire-and-forget, unawaited, after the UI has already updated**. Its
   failure is invisible by design; the ops stay queued for the next load.

Steps 2-5 are synchronous and must complete before step 6 is even called. That ordering *is*
decision 2 — if it inverts, the flow breaks the moment Hermes is off.

### 3d. Entry points

- **Plan:** one button in `daySlotHtml`'s filled-slot `.day-slot-actions` row (`plan.js:273`,
  alongside the existing Swap and Recipe buttons):
  `<button class="ghost day-eat-btn" data-slot="${slotType}">Eat</button>`. Wire it in
  `renderDayView` beside the existing `.day-swap-btn` / `.day-recipe-btn` loops (lines 317-322),
  calling `openEatSheet(mealAt(day, slot), day, slot)`.
- An already-eaten slot renders the button as `Eaten ✓`, `disabled`, plus a
  `<p class="day-slot-note">` with the date. Re-eating the same slot is a mis-tap, not a feature.
- **Library:** one button in `openDetail(meal)`'s sheet (`plan.js:239`) —
  `<button class="ghost detail-eat-btn">Eat this</button>` — calling
  `openEatSheet(meal, null, null)`. Same sheet, same commit, no `eatenAt` written.
- `#eat-overlay` sits above `#day-overlay` (inline `z-index:70`) so the day sheet stays visible
  behind it; `closeEatSheet` returns you to the day view you came from.

## 4. `plan.html`

- One overlay pair before `#swap-overlay` (line 41), matching Phase 9's convention exactly:
  ```html
  <div id="eat-overlay" class="modal-overlay hidden" style="z-index:70;">
    <div id="eat-sheet" class="modal-sheet"></div>
  </div>
  ```
- Add `<script src="shopping-list.js"></script>` before `plan.js` (line 59) — `plan.js` now needs
  `eatPlan`/`normalizeKey`. `hermes-sync.js` is already loaded (line 58). Already in `sw.js`'s
  `SHELL`, so no cache-list change for this one.

## 5. `shopping.js` — the ad-hoc block

The planned-list rendering (`lineHtml`, `blockHtml`, `fmtQty`, `mp_shopping_ticked`) is
**untouched**. The ad-hoc list is a sibling section rendered from its own data.

```
function adhocHtml(items) -> string      // <section class="shop-block adhoc">
function renderAdhoc()                   // paint #adhoc-root from MP.Sync.localItems("adhoc")
```

- Renders from `MP.Sync.localItems("adhoc")` **synchronously** on load — instant, no network.
  Then `MP.Sync.fetchItems("adhoc")` in the background and `renderAdhoc()` again if it returns
  something. Same never-throws guarantee as the pantry fetch.
- Each line: a checkbox, `esc(item.name)`, `esc(item.qty || "")`, and nothing else — no packs, no
  price, no shop-day. Ticking queues a `remove` op, writes the mirror, re-renders, and calls
  `flushOps()` unawaited (same order as §3c).
- An "Add an item" row: one `<input>` for the name, one small `<input>` for an optional qty, one
  button ⇒ an `add` op through the identical path. This is the "want to buy this week" half of the
  outline item, and it is the only way to use the list without eating something.
- Empty list ⇒ the section renders with a one-line `.muted` placeholder, not hidden. A missing
  section reads as a bug.
- `init()` (lines 86-102) gains `renderAdhoc()` **outside** the existing "no plan yet" early
  return at lines 88-93 — the ad-hoc list must work before a plan has ever been generated.

## 6. `shopping.html`

- One `<div id="adhoc-root">` in its own `<section class="section">` with an `<h2>Ad-hoc list</h2>`,
  **after** the planned-list section (lines 30-34). Planned list first: it is the two-week shop and
  the reason the page exists.
- No script tag changes — `shopping-list.js` (line 39) and `hermes-sync.js` (line 40) are both
  already loaded.

## 7. `worker/worker.js` — one more relayed key

- Rename `pantryError(parsed)` (lines 76-87) to **`itemsError(parsed)`**. The body is unchanged —
  it already validates exactly the shape `adhoc` needs (`items` is an array, each item an object
  with a non-empty string `name`, no case-insensitive duplicate names).
- `GET /adhoc` and `PUT /adhoc` alongside the `/pantry` handlers (lines 107-136), byte-for-byte the
  same code with the KV key `"adhoc"`. 204 on success, 400 + reason on validation failure, 401
  without `X-Auth-Token`.
- If the two handlers are literally identical modulo the key name, collapse `/pantry` and `/adhoc`
  into one branch over `["pantry", "adhoc"]` rather than copy-pasting. Do **not** generalise to
  "any key" — that is exactly the "don't grow it into a general API" invariant in
  `ARCHITECTURE.md:86-89`.
- Nothing else in the Worker moves. No new secret, no `wrangler.toml` change.

## 8. `style.css`

- `.eat-row` — label / qty input / summary on one line, wrapping on narrow phones.
- `.eat-row .eat-after` — muted; `.eat-row.shortfall .eat-after` — the warning colour already used
  by shelf-life warnings. Reuse the existing variable, do not introduce a colour.
- `.shop-block.adhoc` — same block styling as the planned blocks so the page reads as one thing.
- `.adhoc-add` — the add row.

No change to `.shop-line`, `.shop-block`, `.have`/`.covered` (Phase 11), or any modal styling —
`#eat-sheet` uses the existing `.modal-overlay`/`.modal-sheet` rules.

## 9. `test.html` — check group 31

Next free number after **30**. All targets are pure functions, so every one of these is a real
assertion — no DOM, no network.

**`fmtRemaining`**
- `fmtRemaining({value:800,unit:"g"}, {value:300,unit:"g"}) === "500g"`.
- Over-consumption clamps: `have 300g`, `used 500g` ⇒ `"0"`, never negative.
- No trailing `.0`: `have 1.5kg` (⇒ 1500g), `used 500g` ⇒ `"1000g"`.

**`eatPlan`**
- **Not tracked:** ingredient absent from the pantry ⇒ `after === null`, `note === "not tracked"`,
  `shortfall === false`, and **zero ops**. This is decision 6, the check that stops the ad-hoc list
  filling with everything you cook.
- **Clean deduction:** pantry `"800g"`, used `"300g"` ⇒ one `sub` op, `after === "500g"`,
  `shortfall === false`, no `add` op.
- **Shortfall:** pantry `"200g"`, used `"500g"` ⇒ `after === "0"`, `shortfall === true`, exactly
  two ops — a `pantry`/`sub` and an `adhoc`/`add` whose `qty` is the `300g` remainder.
- **Unparseable pantry qty** (`"half a bag"`) ⇒ **zero ops**, `after === null`, `note` mentions the
  text. The "never silently destroy pantry data" check.
- **Unit mismatch:** pantry `"2 tins"`, used `"300g"` ⇒ zero ops, `after === null`.
- **Unmeasured ingredient** (`qty: ""` in the meal) ⇒ zero ops, does not throw.
- **Empty/omitted `used` entry** ⇒ the ingredient is skipped: no row consumed, no ops.
- `eatPlan(meal, used, null)` (no pantry at all) ⇒ zero ops, every row `"not tracked"`, no throw.
  This is the **Hermes-is-off** guarantee in assertion form.

**`applyOps`** (the sync-correctness core)
- `sub` against a fresh remote array reduces **only** the matched item; a sibling item edited
  remotely is returned untouched. This is the anti-clobber check that justifies Gate 1 Path B.
- `sub` for a name **not present** remotely (Hermes deleted it) ⇒ array returned unchanged, no
  throw, no phantom item created.
- `add` for a new name appends; `add` for an existing normalized name replaces its `qty` rather
  than creating a duplicate (the Worker rejects duplicate names, so this must not be able to
  produce a body the Worker would 400 on).
- `remove` drops the match; `remove` for a missing name is a no-op.
- `applyOps(items, [])` is deep-equal to `items`; `applyOps([], ops)` does not throw.
- A malformed op (`{}`, `{type:"nonsense"}`) is skipped, not thrown on.
- **Purity:** the input array and its item objects are not mutated — deep-equal a pre-call clone
  afterwards.

**Back-compat**
- `buildLists(plan, mealsById, packData, pantry)` still produces the group-30 result. Phase 12 must
  not move the planned list at all.

## Confirmed unchanged

| Thing | Why it stays put |
|---|---|
| `buildLists`, `packsFor`, `parseQty`, `normalizeKey`, `pantryIndex`, the line shape | Phase 11's planned-list maths is finished; this phase adds a second list beside it, it does not revise the first |
| `mp_shopping_ticked` and its `"${shopDay}:${key}"` scheme | The ad-hoc list has no persistent tick state — ticking deletes |
| `MP.Generator`, the variety guard, batch-cook/leftover chains | `eatenAt` is an ignored extra field; regeneration is unaffected |
| `MP.Sync.syncLibrary` / `decide` / `ackPlanFlag` | The library keeps its whole-document last-write-wins rule; only the two item-list keys use ops |
| `MP.Sync.fetchPantry()`'s signature | Kept as an alias so Phase 11's callers in `shopping.js` and `discover.js` need no edit |
| `meals.json`, `pack-sizes.json`, `shelf-life.json`, `nutrition-targets.json` | No schema change |
| `worker/wrangler.toml`, the auth token, the KV binding | One new key in the existing namespace, not new infrastructure |
| Phase 9's `openDayView`/`renderDayView`/`daySlotHtml` structure | The Eat button is a third entry in an actions row that already has two |
| `docs/ARCHITECTURE.md:74` "the plan itself is never stored in KV" | Decision 7 — `eatenAt` is local-only. Phase 13 owns that question |

## 10. Docs — same commit as the code

- **`docs/ARCHITECTURE.md`**: the KV schema section (lines 64-74) lists two keys; it is already
  stale (Phase 4 shipped `pantry`). Add **both** `pantry` and `adhoc`, and fix the invariant at
  line 90 ("The Worker never stores anything beyond `library` and `planFlag`") to name all four
  keys. Add one line to the data-flow notes: writes to the two item lists are local-first with a
  replayed op log, so the app is fully usable with the bridge unreachable.
- **`docs/HERMES.md`**: a `GET /adhoc` / `PUT /adhoc` row in the capability table and a section
  mirroring the `/pantry` one — same body shape, same fetch-then-write rule, described as the
  "ran out of / want to buy this week" list so Hermes uses it for "add X to my shopping list"
  rather than writing to `/pantry`. Note explicitly that the *planned* two-week list is **not**
  available over the bridge (it is derived from the local plan) so Hermes cannot be asked to edit it.

## 11. Wiring

1. `worker/worker.js` — `itemsError` rename + `/adhoc`. Deploy and confirm `GET /adhoc` returns
   `null` and a `PUT` round-trips **before** any app code depends on it.
2. `test.html` group 31 (write before 3 and 4 land, per TDD).
3. `shopping-list.js` — `fmtRemaining`, `eatPlan`, exports.
4. `hermes-sync.js` — `fetchItems`/`fetchPantry` alias, `localItems`, `writeLocalItems`, `queueOp`,
   `applyOps`, `flushOps`, `start()` line.
5. `plan.html` overlay + `shopping-list.js` script tag; `plan.js` eat sheet + both entry points.
6. `shopping.html` section; `shopping.js` `adhocHtml`/`renderAdhoc` + `init()`.
7. `style.css`.
8. `sw.js` — bump `CACHE` to `"meal-planner-v12"`. **No `SHELL` additions** — no new file.
9. `docs/ARCHITECTURE.md` + `docs/HERMES.md` (§10).
10. **Manual pass** (`python3 -m http.server 8000`):
    - **Sync switched off entirely**: open a day, Eat a meal, confirm ⇒ sheet shows every row
      "not tracked", the slot flips to `Eaten ✓`, nothing throws, no network request is attempted.
      Add an item to the ad-hoc list by hand ⇒ it persists across a reload.
    - **Sync configured, pantry with a partial and a full match**: confirm ⇒ pantry quantities drop
      by the right amounts in Hermes, the over-consumed item lands on the ad-hoc list with the
      correct remainder, and the planned shopping list reflects the reduced pantry on next load.
    - **Offline then online**: airplane mode, eat two meals and tick an ad-hoc line, reconnect,
      reload ⇒ `flushOps` drains and the server matches local state.
    - **Concurrent edit**: with an op queued offline, change a *different* pantry item via Hermes,
      then reconnect ⇒ both changes survive. This is the check that Gate 1 Path B was worth taking.
    - Re-tap Eat on an already-eaten slot ⇒ disabled, no second deduction.
11. Flip `docs/roadmap.md` Phase 12 to **Status: Complete** in the *same commit* as the code.

## Edge cases

| Case | Behaviour |
|---|---|
| Sync never configured | `fetchItems` returns the mirror or `null`; every write is local; ops queue harmlessly and drain if sync is ever turned on |
| Offline mid-eat | Identical to the above — the network is not on the confirm path at all |
| `flushOps` PUT succeeds, response lost | `sub` replays and double-deducts. Named ceiling, `ponytail:` comment, accepted (single user, retype one qty) |
| Hermes deleted a pantry item we queued a `sub` for | `applyOps` no-ops that item; no phantom entry, no throw |
| Hermes added the same ad-hoc item | `add` replaces the qty by normalized name; never produces the duplicate name the Worker 400s on |
| Pantry qty is `"0"` and the meal uses it | Parses to 0 ⇒ `have < used` ⇒ full shortfall to the ad-hoc list, pantry stays `"0"` |
| Eating a leftover slot (`meal.leftoverOf`) | Deducts nothing extra — the leftover meal's own ingredient list is what `eatPlan` reads, and it is empty/minimal by construction. No special case |
| Meal with zero ingredients | Sheet opens, no rows, `Confirm` writes only `eatenAt` |
| Plan regenerated after eating | New plan has no `eatenAt` anywhere; the pantry deductions already happened and are not rolled back (correct — you did eat it) |
| Same meal eaten twice from the library | Deducts twice. Correct: you ate it twice. Only *plan slots* are guarded against re-tap |
| Malicious/odd pantry or ad-hoc text | `esc()` everywhere, in the eat sheet and the ad-hoc list. No `innerHTML` with raw item text |
| Ad-hoc list before any plan exists | Renders and works — `renderAdhoc()` sits outside the "no plan yet" early return |

## Deliberately not built

- **An `/eaten-log` endpoint or any eaten history** — Phase 15 owns that; this phase only creates
  the `eatenAt` trigger point it will hang off.
- **Storing the plan in KV** — `ARCHITECTURE.md:74` stands; Phase 13 revisits it.
- **Ticking an ad-hoc item adding it back to the pantry** — tempting, but "bought" ≠ "put away",
  and it doubles the op surface. Add it when the ad-hoc list is actually in daily use.
- **Undo on a confirmed eat** — Cancel exists before confirming; after that, editing the pantry
  through Hermes is the escape hatch.
- **Exactly-once sync, op ids, server-side dedupe, a real conflict UI** — at-least-once with
  item-granular ops, ceiling named.
- **Portion/serving maths** (eating half a batch) — the qty inputs are editable, which covers it
  by hand. No servings model.
- **Pack-size, price or shop-day maths on the ad-hoc list** — it is free text on purpose.
- **Fuzzy/synonym matching** — inherits Phase 11's `normalizeKey` exact match unchanged.
- **Per-SKU or purchase-date pantry tracking, expiry on pantry items** — out per `CLAUDE.md`.
