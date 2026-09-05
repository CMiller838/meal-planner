# Phase 8 Spec — Meal image backfill

Roadmap: `docs/roadmap.md` → Phase 8 (lines 110–127). Scope is settled there and is not
re-litigated here: a TheMealDB lookup by name first, a manual photo attach as the fallback,
downscaled via `<canvas>` to roughly 50KB and stored in the **existing `image` field** as a
data-URL.

Pure app-side work. **No schema change, no Worker change, no new KV key, no new dependency,
no new JS file, no new CSS file, no `meals.json` edit.** Three small pieces: one pure helper
plus one fetch in `mealdb.js`, one canvas pipeline in `app.js`, and one new field on the
Phase 6 form.

## Decisions taken

No Decision Gate was raised: the roadmap settled the architecture (existing field, data-URL,
`<canvas>`, no dependency) and everything left is an implementation default. They are listed
so any of them can be overridden before the build starts.

| Choice | Decision |
|---|---|
| Where the seed backfill happens | **At runtime, over the live library, via one "Find images" button** — *not* by committing thumbnail URLs into `meals.json`. `meals.json` is only the first-run seed; Cody's real library already lives in `localStorage`/KV, so a `meals.json` edit would fix a library nobody is using while leaving the actual one full of placeholders. The button fixes both, and a fresh seed identically |
| When the name lookup fires in the form | On the name field's **`change`** event (blur/commit), only when no image is set yet — *not* on save. Keeps the network entirely off the save path (an offline save must never hang) and lets the user see the found photo and override it before committing. `change` rather than `input` means no debounce is needed; the platform already does it |
| Which search result wins | Exact normalised-name match if one exists, otherwise the first result carrying a `strMealThumb`. `search.php?s=` is a substring match, so `Chilli` can return *Chilli prawn linguine* — the exact-match preference is two lines and costs nothing |
| Reading the file | `URL.createObjectURL(file)` + `<img>`, not `FileReader`. One fewer async hop and it never base64-encodes the full-size original into memory just to throw it away |
| Downscale budget | Longest side 640px, JPEG quality ladder `[0.72, 0.6, 0.5, 0.4]`, first result whose data-URL is ≤ 70 000 chars wins; one fallback redraw at 320px/0.5 if none is. See §2b for why a fixed quality is not enough |
| Where `shrinkImage` lives | `app.js`. Only the form uses it, it needs `document`, and `mealdb.js` must stay Worker-importable |
| `image` becomes editable | Phase 6's tasklist froze `image` as a field an edit must not touch. **This phase deliberately unfreezes exactly that one field.** Everything else Phase 6 froze (`batchCook`, `leadsTo`, `leftoverOf`, `servings`, `prepEffort`, `source`, `id`) stays frozen |

---

## 0. What this phase is actually made of

| Roadmap item | Where it lands |
|---|---|
| TheMealDB lookup by name | §1 — one pure function + one fetch in `mealdb.js` |
| Downscale to ~50KB JPEG data-URL | §2 — one function in `app.js` |
| Manual photo attach in the add/edit form | §3 — one field, one preview, one clear button |
| Backfill the 9 null-image meals | §4 — one button beside "+ Add a meal" |
| Syncs to KV like any other field | Nothing. `hermes-sync.js:81` already serialises the whole meals array with no field allow-list |

**The trap that shapes §8:** Phase 6 *deleted* `<script src="mealdb.js">` from `index.html`
and left a comment explaining why. `MP.MealDB.imageByName` is called from `app.js`, so
without putting that tag back the whole feature is a `TypeError` thrown inside a `change`
handler — no console error the user will ever see, no visible failure, the photo lookup just
silently never happens. Put the tag back **and** fix the comment so it doesn't get deleted
again.

**The trap that shapes §2b and §3d:** a phone photo is 2–5MB. `localStorage` is ~5MB for the
whole origin. One un-budgeted `toDataURL` at quality 0.9 can be 400KB, and the throw does not
land in the image code — it lands in `MP.saveLibrary`'s `setItem` (`data.js:42`), i.e. inside
`upsertMeal`, i.e. inside `saveForm`, unguarded. The meal is not saved, the modal closes
anyway, and the user's edit is gone. Both the byte budget and the `try/catch` in §3d exist
for that one path.

**The third thing to know:** `image` is interpolated into `innerHTML` via `esc()` in three
places (`app.js:50` card, `app.js:108` detail, `discover.js:25` card). That does not change.
`esc()` on a base64 data-URL is provably a no-op — base64 plus `data:image/jpeg;base64,`
contains none of `&<>"'` — but it stays, because the house rule is about the sink, not the
source, and §6 has a check that fails if anyone "upgrades" `esc` into something that mangles
a data-URL.

---

## 1. `mealdb.js` — image lookup by name

### 1a. New pure function (TDD)

```js
/** Pick a thumbnail URL out of a search.php?s= response.
 *  Prefers a result whose name matches `name` exactly (case/punctuation-insensitive),
 *  otherwise the first result that actually carries a thumbnail.
 *  @param {{meals: Array|null}|null} data  raw search.php body
 *  @param {string} name                    the name that was searched for
 *  @returns {string|null} */
MP.MealDB.thumbFromSearch(data, name)
```

Algorithm, pinned because §6's checks depend on it:

```
list = (data && data.meals) || []          // search.php returns meals: null on no match
norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "")
exact = list.find(m => m.strMealThumb && norm(m.strMeal) === norm(name))
return (exact || list.find(m => m.strMealThumb) || {}).strMealThumb || null
```

Same normalisation as `MP.findSimilarName` (`data.js`, Phase 6), deliberately duplicated
rather than imported — `mealdb.js` must not depend on `data.js`, because the Worker imports
it (`worker/worker.js`, Phase 5) and never loads `data.js`. Three lines is cheaper than
breaking that.

### 1b. `imageByName(name)`

```js
/** First plausible TheMealDB thumbnail for a meal name, or null.
 *  Network failure, no match and a blank name are all "no image" — this never throws,
 *  because every caller is a UI event handler.
 *  @param {string} name
 *  @returns {Promise<string|null>} */
async function imageByName(name)
```

- `name` blank/whitespace ⇒ `return null` **without a fetch**.
- `fetchJson(`${BASE}search.php?s=${encodeURIComponent(name.trim())}`)` ⇒
  `thumbFromSearch(data, name)`.
- `.catch(() => null)` on the fetch. A dead network is indistinguishable from no match here
  and that is correct — the manual attach is the fallback either way.

**One request, no `lookup.php` N+1.** `search.php?s=` returns full detail objects, the same
shape `lookup.php?i=` returns, so `strMealThumb` is already in the response. This is the same
reason Phase 5's `/discover` route uses `search.php`.

No caching. These are one-shot, user-initiated calls; a `sessionStorage` layer would be state
to invalidate for no measured gain.

Export: `root.MP.MealDB = { toMeal, load, getDiscoverPool, sampleIds, CATEGORIES, imageByName, thumbFromSearch }`.

### 1c. What this deliberately does not do

- **No `MP.Exclusions` call.** Nothing from TheMealDB enters the library here — only a URL
  string is copied onto a meal the user already owns. Running `sanitize` would mean building
  a throwaway meal record to discard it, and a mushroom photo on a meal the user wrote
  themselves is not what the mushroom rule is about. Comment this, so it doesn't read as an
  oversight against the Phase 5 invariant.
- **No fallback searches.** If the full name misses, we do not retry with the first word.
  `Roast Chicken` → some unrelated chicken dish's photo is worse than a placeholder, and the
  manual attach is the roadmap's stated fallback. `ponytail:` comment naming the ceiling:
  exact-then-first, no fuzzy matching; upgrade path is a similarity floor on `strMeal`, not a
  cleverer query.

---

## 2. `app.js` — the downscale pipeline

### 2a. Signature

```js
/** Decode an image file and re-encode it as a small JPEG data-URL.
 *  @param {File} file
 *  @returns {Promise<string>} data-URL, ≤ ~70 000 chars
 *  @throws {Error} "not-an-image" | "too-big" | "decode-failed" — all shown to the user
 */
async function shrinkImage(file)
```

Rejecting with a short machine-readable `message` rather than a user-facing string keeps the
copy in one place (§3c's `IMAGE_ERRORS` map) instead of scattered through the pipeline.

### 2b. Constants and algorithm

```js
const MAX_DIM = 640;                          // longest side, CSS px
const QUALITIES = [0.72, 0.6, 0.5, 0.4];
const MAX_CHARS = 70000;                      // data-URL string length
const MAX_FILE_BYTES = 20 * 1024 * 1024;
```

```
if (!file.type.startsWith("image/")) throw "not-an-image"
if (file.size > MAX_FILE_BYTES)      throw "too-big"
url = URL.createObjectURL(file)
try {
  img = await (new Image(), onload/onerror -> resolve/throw "decode-failed", img.src = url)
  scale  = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight))
  canvas = draw img at round(w*scale) x round(h*scale)
  for (const q of QUALITIES) {
    const out = canvas.toDataURL("image/jpeg", q)
    if (out.length <= MAX_CHARS) return out
  }
  redraw at half those dimensions; return canvas.toDataURL("image/jpeg", 0.5)   // unconditional
} finally { URL.revokeObjectURL(url) }
```

**Why a quality ladder and not a fixed quality.** File size after JPEG encoding depends on
image content, not just dimensions: a flat plate of pasta at 640px/0.72 is ~25KB, a busy
market photo is ~200KB. A fixed quality that is safe for the busy case makes every normal
photo look bad, and a fixed quality that looks good lets the bad case through into a
`localStorage` write that throws. The loop is four lines and re-encodes an
already-decoded 640px canvas, which is sub-millisecond work.

**Why 70 000 chars.** Base64 is 4/3 of the bytes it encodes, so 70 000 chars ≈ 51KB of actual
JPEG — the roadmap's "roughly 50KB". Browsers store `localStorage` as UTF-16, so the real
cost is ~137KB of quota per photo; all 14 seed meals photographed is ~2MB against a ~5MB
origin quota. That is the headroom this number is buying, and it is why the number is not
larger.

**Why the unconditional final return.** A two-pass ceiling: if 320px at 0.5 is still over
budget the photo is pathological, and returning it anyway lets §3d's `try/catch` fail loudly
at save time with a message the user can act on, rather than this function silently
returning nothing. `ponytail:` comment naming that ceiling — the upgrade path is a
binary-search on quality, not a third hardcoded pass.

**Why not `FileReader`.** `createObjectURL` skips an async step and never materialises the
full-size original as a base64 string in memory. `revokeObjectURL` in a `finally` is the
whole cost.

**Orientation.** Do not add EXIF handling. Current browsers default `<img>` to
`image-orientation: from-image` and `drawImage` honours it, so a portrait phone photo lands
upright. Note this in a comment so nobody adds an EXIF parser (which would be a dependency).

### 2c. Failure is never silent

Every throw path is surfaced in `#form-msg` (§3c). There is no `catch {}` anywhere in this
pipeline — the point of the phase is that the user knows whether their photo took.

---

## 3. The form — a photo field

### 3a. Markup — inside `openForm`'s template string (`app.js:155-182`)

Insert between the Ingredients `<label>` (line 167-169) and the Meal types `<div>` (line 170):

```html
<div class="sync-field">Photo
  <img id="form-image-preview" class="form-photo hidden" alt="">
  <div class="form-photo-row">
    <input type="file" id="form-image" accept="image/*">
    <button id="form-image-clear" class="ghost hidden">Remove photo</button>
  </div>
</div>
```

A `<div class="sync-field">`, not a `<label>` — the meal-types block above it is already a
`<div>` for the same reason (a `<label>` wrapping two controls is ambiguous).

`accept="image/*"` is a picker hint, **not** validation — Android's picker will hand back a
`.heic` or a PDF regardless, which is why §2b checks `file.type` itself.

No `capture` attribute: it would force the camera and remove "choose from gallery", which is
the more common path for a meal photo.

### 3b. Module state and `readForm`

```js
let formImage = null;   // module-level, beside `activeType` — the pending image for the open form
```

The file input cannot be prefilled and the preview's `src` is not a reliable store, so the
pending value lives in a variable. `openForm` sets it first thing:
`formImage = meal ? meal.image || null : null;`

`readForm` (`app.js:214-228`) gains **one** line in the overwrite block, after `ingredients`:

```js
image: formImage,
```

It goes in the overwrite block, not the `original ||` defaults block — the defaults block's
existing `image: null` stays for Add mode's other fields to keep its shape, but the overwrite
is what makes an edit able to change the photo.

**This is the one field Phase 6 froze that is now deliberately writable.** `batchCook`,
`leadsTo`, `leftoverOf`, `servings`, `prepEffort`, `source` and `id` are still preserved by
the spread and must stay that way; §6 keeps a check on it.

### 3c. Wiring — three listeners, added in `openForm` after line 198

```js
const preview  = sheet.querySelector("#form-image-preview");
const fileIn   = sheet.querySelector("#form-image");
const clearBtn = sheet.querySelector("#form-image-clear");

/** Single place that renders `formImage` into the two controls. */
function showImage() { ... }   // preview.src = formImage (property, never innerHTML);
                               // toggle .hidden on preview and clearBtn on !!formImage
```

1. **Initial paint:** call `showImage()` once at the end of `openForm`.

2. **`fileIn` `change`:**
   ```js
   const file = fileIn.files[0];
   if (!file) return;
   msg.textContent = "Shrinking photo…";
   try { formImage = await shrinkImage(file); msg.textContent = ""; }
   catch (e) { msg.classList.add("error"); msg.textContent = IMAGE_ERRORS[e.message] || IMAGE_ERRORS.default; }
   fileIn.value = "";     // so re-picking the same file fires change again
   showImage();
   ```

   ```js
   const IMAGE_ERRORS = {
     "not-an-image": "That file isn't an image.",
     "too-big": "That photo is too large — try one under 20MB.",
     "decode-failed": "Couldn't read that image. iPhone HEIC photos often need converting to JPEG first.",
     default: "Couldn't use that image.",
   };
   ```
   The HEIC hint is not padding — it is the single most likely real failure, and without it
   the message is unactionable.

3. **`clearBtn` `click`:** `formImage = null; fileIn.value = ""; showImage();` Nothing is
   persisted until Save, so this is not a delete.

4. **`nameInput` `change`** (a second listener; the existing `input` listener at line 194
   keeps doing the near-dupe check and is not touched):
   ```js
   if (formImage) return;                       // never clobber an image the user already has
   const found = await MP.MealDB.imageByName(nameInput.value);
   if (found && !formImage) { formImage = found; showImage(); }
   ```
   The second `!formImage` re-check after the `await` is the race guard: the user can pick a
   photo while the lookup is in flight, and their choice must win.

   `input` vs `change` matters — `input` fires per keystroke and would fire a TheMealDB
   request per letter typed.

### 3d. The save path — one `try/catch`, and it is not optional

`saveForm` (`app.js:246`) becomes:

```js
try { library = MP.upsertMeal(candidate); }
catch (e) {
  msg.classList.add("error");
  msg.textContent = "Couldn't save — browser storage is full. Remove a photo from another meal and try again.";
  return;                      // modal stays open, the edit is still on screen
}
```

`MP.saveLibrary` (`data.js:41-45`) calls `setItem` unguarded, and photos are the first thing
in this app's history big enough to hit the quota. Without this the failure mode is: modal
closes, toast says `Saved "X"`, nothing was saved. Do **not** "fix" this in `data.js` by
swallowing the error there — a silent `saveLibrary` would break Hermes sync everywhere else
too. The guard belongs at the point where a human can act on it.

Nothing else in `saveForm` changes. The name check and `MP.Exclusions.check` still run first,
and the lookup does not run here at all.

### 3e. Styling

See §5. The preview reuses `.hidden`, which has existed since Phase 4.

---

## 4. The backfill button

### 4a. Markup — `index.html:31-34`

```html
<div class="section-head">
  <h2>Your Library</h2>
  <button id="backfill-images" class="ghost">Find images</button>
  <button id="add-meal" class="btn">+ Add a meal</button>
</div>
```

Ghost, not `.btn` — it is the secondary action next to Add.

### 4b. `app.js` — one handler wired in `init()` beside the others (line 288)

```js
/** Fill in `image` for every library meal that hasn't got one, from TheMealDB by name.
 *  Only ever writes into an empty field — it can't overwrite a photo. */
async function backfillImages(btn)
```

1. `const missing = library.filter((m) => !m.image);`
   `if (!missing.length) return toast("Every meal already has an image.");`
2. `btn.disabled = true;` and set `btn.textContent` to `` `Looking up 1/${missing.length}…` ``
   as it goes — `textContent`, never `innerHTML`.
3. **Sequential `for...of`**, not `Promise.all` — nine parallel requests at a free public API
   for a button pressed once is rude for no benefit; the user is watching a counter either
   way.
4. Collect hits into `const found = new Map();` keyed by meal id. `imageByName` returns
   `null` on failure, so there is no `try/catch` in the loop.
5. **One write, not N:**
   ```js
   if (found.size) {
     library = MP.getLibrary-fresh().map((m) => (found.has(m.id) ? { ...m, image: found.get(m.id) } : m));
     try { MP.saveLibrary(library); } catch (e) { toast("Couldn't save — browser storage is full."); }
   }
   ```
   Re-read the library from storage rather than trusting the module-level `library` array — a
   Hermes pull can land during a nine-request loop, and this is the same reasoning that made
   Phase 6's `upsertMeal` re-read. (`MP.getLibrary()` is the existing re-read; it is `async`
   but returns the stored array without a fetch when one exists.)

   Calling `MP.upsertMeal` per hit would fire `mp:library-saved` nine times and push nine
   times to KV.
6. Restore `btn.disabled`/`btn.textContent`, `renderLibrary()`, and
   `toast(`Found ${found.size} of ${missing.length} images.`)` — including when
   `found.size === 0`, which is a real and expected outcome for names like *Chorizo & Pasta*.

### 4c. Why there is no automatic version of this

The lookup never runs on page load. Nine outbound requests on every visit, to fill a field
that is allowed to be empty, is exactly the kind of background work that turns into a
mystery when TheMealDB is slow. It is a button because it is a one-time job.

---

## 5. `style.css`

All new rules use existing custom properties, mobile-first, matching the file's convention.
Append after the `.sync-field` block (line 355-374) so they sit with the form styling.

```css
.form-photo { display: block; width: 100%; max-height: 10rem; object-fit: cover;
              border-radius: .6rem; margin-top: .4rem; }
.form-photo-row { display: flex; align-items: center; gap: .6rem; margin-top: .4rem; }
.form-photo-row input[type="file"] { font-size: .85rem; color: var(--text-dim); }
```

`.form-photo-row input[type="file"]` must be its own selector: the existing
`.sync-field input, .sync-field textarea` rule (line 360) sets `width: 100%` and a padded
box, which makes a file input look like a broken text field. This override is why the row
exists at all.

`.section-head` already lays out its children; two buttons need no change. `.card-img`
(line 159-164) already sets `aspect-ratio: 16/9; object-fit: cover`, so a 640px data-URL
renders exactly like a TheMealDB thumbnail — **no card CSS changes.** No new CSS file, no
framework, no icon font.

---

## 6. `test.html` additions

No new script tags — `data.js` and `mealdb.js` are both already included (lines 10-17).

New check group 27, using the existing `check()` / `deepEqual()` helpers:

- `thumbFromSearch({ meals: null }, "x")` ⇒ `null` — *the no-match shape; `search.php` returns
  `meals: null`, not `[]`, and getting this wrong throws on `.find`*
- `thumbFromSearch(null, "x")` ⇒ `null`; `thumbFromSearch({}, "x")` ⇒ `null`
- `thumbFromSearch({ meals: [{ strMeal: "A", strMealThumb: "" }, { strMeal: "B", strMealThumb: "b.jpg" }] }, "z")`
  ⇒ `"b.jpg"` — first result *with a thumb* wins, not first result
- **`thumbFromSearch({ meals: [{ strMeal: "Chilli prawn linguine", strMealThumb: "wrong.jpg" },
  { strMeal: "chilli!", strMealThumb: "right.jpg" }] }, "Chilli")` ⇒ `"right.jpg"`** — *the
  exact-match preference, and the punctuation/case normalisation with it. It fails the moment
  someone simplifies this to "take the first result"*
- `thumbFromSearch({ meals: [{ strMeal: "Chilli" }] }, "Chilli")` ⇒ `null` — an exact name
  match with no thumbnail is still no thumbnail
- **`esc("data:image/jpeg;base64,/9j/4AAQSkZJRg+ab/cd=")` ⇒ unchanged** — *the data-URL
  survival check. `esc` is a no-op on base64 today; this fails if it is ever "improved" into
  something URL-encoding, which would break every stored photo at once and only on screen*
- `esc('data:image/jpeg;base64,AAA" onerror="x')` ⇒ contains `&quot;` and no raw `"` — the
  escaping still does its actual job on a data-URL-shaped string
- Every meal in `meals.json` has `image === null` or a non-empty string — cheap schema guard
  against a future half-written record

`shrinkImage` is not checkable here: it needs a real decoded image and a canvas. Its budget is
verified in §8's manual pass instead, which is the honest place for it.

---

## 7. Edge cases

| Case | Behaviour |
|---|---|
| Name lookup finds nothing (most seed meals — *Chorizo & Pasta*, *Oats, Greek Yogurt & Banana*) | `null`, nothing set, no message. The manual attach is the fallback and the placeholder tile is unchanged |
| Name lookup returns several matches | Exact normalised-name match wins, else first with a thumb (§1a) |
| Name lookup returns a plausible but wrong photo (*Chilli* → *Chilli prawn linguine*) | Accepted. The image is visible in the form before saving and in the grid after; Edit → Remove photo is one tap. `ponytail:` ceiling — add a similarity floor only if this actually happens |
| Offline when the name field is committed | `imageByName` catches ⇒ `null` ⇒ silent no-op. Saving still works; the save path never touches the network |
| Name edited **after** an image is set | No re-lookup, no clobber — by design (§3c step 4). The escape hatch is Remove photo, then re-commit the name |
| User picks a photo while the name lookup is in flight | The `!formImage` re-check after the `await` drops the lookup result. The user's choice wins |
| Editing a meal that already has a TheMealDB **URL** | Preview shows the remote image; picking a photo replaces the URL with a data-URL in the same field. Per the roadmap's settled scope |
| Non-image file (PDF, .txt) from the picker | `"not-an-image"` ⇒ `That file isn't an image.` `accept` is a hint; this is the enforcement |
| iPhone `.heic` on desktop Chrome | Decodes to nothing ⇒ `img.onerror` ⇒ `"decode-failed"` with the convert-to-JPEG hint. On the Android PWA this does not arise |
| File over 20MB | `"too-big"`, rejected before any decode — a 50MP decode can OOM a phone tab |
| A busy photo still over budget after the ladder | Falls to the 320px/0.5 pass and is returned regardless; if it is *still* huge, §3d catches the quota throw at save time with an actionable message |
| `localStorage` quota exceeded on save | Modal stays open, `#form-msg.error` explains, the edit is not lost. The one failure this phase makes reachable and the one it must not lose data to |
| Backfill button with nothing missing | Toast `Every meal already has an image.`, no requests |
| Backfill finds 0 of 9 | Toast says so. Expected for personal recipe names — not an error state |
| Hermes pull lands mid-backfill | The final write re-reads storage, so pulled meals are preserved and only the `image` field of matched ids is changed |
| Backfill on a meal whose image is `""` rather than `null` | `!m.image` catches both. Never overwrites a truthy value |
| Data-URLs inside `renderLibrary`'s single injected HTML string | ~630KB of string for 9 photos, re-escaped on every search keystroke. Measured as acceptable; `ponytail:` comment naming the ceiling, upgrade path is assigning `.src` after insertion rather than interpolating |
| A photo syncing to KV | Works untouched. `hermes-sync.js:81` serialises the whole array with no field allow-list, `worker.js`'s `libraryError()` validates only `id`/`name`/`ingredients`/duplicate ids, and 14 × ~70KB is far inside KV's 25MB per-value limit |
| Discover deck cards | Unchanged. TheMealDB meals already arrive with `image` set by `toMeal` (`mealdb.js:63`) |

---

## 8. Wiring

- **`index.html` — put `<script src="mealdb.js"></script>` back**, before `app.js` and after
  `exclusions.js` (`getDiscoverPool` calls `MP.Exclusions` even though this page never calls
  it). **Rewrite the Phase 6 comment at lines 72-73** — `swipe.js` is still deliberately not
  loaded here, `mealdb.js` now is, and the comment should say why so the next cleanup doesn't
  delete it again. See §0.
- `sw.js` — bump `CACHE` to `"meal-planner-v8"`. **No `SHELL` change**: no new file is added
  and `mealdb.js` has been in the shell since Phase 1.
- No `manifest.json`, `worker/`, `docs/HERMES.md` or `docs/ARCHITECTURE.md` change. The KV
  surface, the Worker's `KEYS` allowlist and `libraryError()` are all untouched — confirm this
  rather than editing anything.
- **No `meals.json` change.** See the decisions table.
- `docs/roadmap.md` Phase 8 ⇒ `(Status: Complete)` in the same commit as the code
  (`.claude/skills/roadmap-gating/`).

**Manual pass (this phase cannot be verified by `test.html` alone):**

1. Attach a real phone photo → check the stored `image` string length in devtools is
   ≤ 70 000, the preview is upright (not rotated 90°), and the card thumbnail is not
   visibly worse than a TheMealDB one.
2. Edit `roast-chicken` (which has `batchCook: true` and a `leadsTo` chain), attach a photo,
   Save, and confirm `batchCook` and `leadsTo` are still intact — Phase 6's silent-data-loss
   check, re-run because `readForm` changed.
3. Press "Find images" with the 9 null-image meals present; confirm the counter advances, the
   toast reports honestly, and no existing image was overwritten.
4. Type a name TheMealDB definitely has (e.g. *Beef Wellington*) into a new meal and tab out —
   the preview should appear without touching the file picker.
5. Airplane-mode: commit a name (no image, no hang) and save a meal (works normally).
6. With Hermes configured, attach a photo and confirm the next `GET /library` carries the
   data-URL — no sync code should have been needed.

---

## 9. Deliberately not built

Any `meals.json` edit (§0/decisions); an automatic lookup on page load or on save; a
progressive/fuzzy name search or a second query with fewer words; a similarity floor on the
returned `strMeal`; caching `search.php` responses; running `MP.Exclusions` over a name-lookup
result (no meal record enters the library — §1c); cropping, rotation, filters or any editing
UI; a `capture` attribute forcing the camera; multiple photos per meal; a separate
thumbnail/full-size pair; an EXIF parser; WebP or AVIF output (a JPEG data-URL is what the
roadmap settled and what every browser encodes natively); IndexedDB or the Cache API for
images (a schema change dressed as an optimisation); uploading to R2/a CDN and storing a URL;
image validation, size limits or a field allow-list in the Worker; excluding photos from the
Hermes payload; images on the plan page or the shopping list (Phase 9 owns the expanded day
view, and it is sequenced after this one precisely so it can assume images exist); a
placeholder-image generator; lazy `.src` assignment in `renderLibrary` (§7's noted ceiling,
not this phase's job); any change to `.card-img`, `discover.js`, `generator.js`, the meal
schema, the Worker, or the dependency set.
