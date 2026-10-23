// Meal ratings, notes and "never again" flags (Phase 51), one record per meal id:
// { rating: "up"|"down"|null, note, never, at }. Loaded as a browser <script> AND imported into the Worker bundle:
// no window/document at load, localStorage only inside get/set/merge.
(function (root) {
  "use strict";

  const KEY = "mp_ratings";
  const NOTE_MAX = 120;

  /** Shape-checks a patch body. Returns an error string or null. */
  function patchError(p) {
    if (typeof p !== "object" || p === null || Array.isArray(p)) return "expected a JSON object";
    if (Object.keys(p).some((k) => k !== "rating" && k !== "note" && k !== "never")) return "unknown key";
    if ("rating" in p && p.rating !== null && p.rating !== "up" && p.rating !== "down") return "rating must be up, down or null";
    if ("note" in p && typeof p.note !== "string") return "note must be a string";
    if ("never" in p && typeof p.never !== "boolean") return "never must be a boolean";
    return null;
  }

  /** Pure: `rec` (or blank) with the patch's fields merged in and `at` stamped. */
  function applyPatch(rec, p, at) {
    const out = { rating: null, note: "", never: false, ...(rec || {}) };
    if ("rating" in p) out.rating = p.rating;
    if ("note" in p) out.note = p.note.trim().slice(0, NOTE_MAX);
    if ("never" in p) out.never = p.never;
    out.at = at;
    return out;
  }

  /** Pure: per-meal newest-`at` wins. Returns a new map. */
  function mergeMaps(local, remote) {
    const out = { ...(local || {}) };
    for (const [id, r] of Object.entries(remote || {})) {
      if (r && typeof r === "object" && (!out[id] || String(r.at || "") > String(out[id].at || ""))) out[id] = r;
    }
    return out;
  }

  function get() {
    try {
      const m = JSON.parse(localStorage.getItem(KEY) || "{}");
      return m && typeof m === "object" && !Array.isArray(m) ? m : {};
    } catch (e) {
      return {};
    }
  }

  function save(map) {
    localStorage.setItem(KEY, JSON.stringify(map));
  }

  function set(id, patch) {
    const map = get();
    map[id] = applyPatch(map[id], patch, new Date().toISOString());
    save(map);
    return map[id];
  }

  function merge(remoteMeals) {
    save(mergeMaps(get(), remoteMeals));
  }

  function neverIds(map) {
    return new Set(Object.keys(map || get()).filter((id) => (map || get())[id].never));
  }

  /** Rating row for a meal detail sheet (browser only). Builds with textContent/value, never innerHTML on the note.
   *  onChange(record) fires after every save so the caller can refresh badges; Never gets an Undo via `toast`. */
  function rowEl(mealId, onChange, toast) {
    const row = document.createElement("div");
    row.className = "rating-row";
    row.innerHTML = `<div class="rating-btns">
        <button type="button" class="ghost rating-btn" data-r="up" aria-label="Like this meal">👍</button>
        <button type="button" class="ghost rating-btn" data-r="down" aria-label="Dislike this meal">👎</button>
        <button type="button" class="ghost rating-never">Never again</button>
      </div>
      <input type="text" class="rating-note" maxlength="${NOTE_MAX}" placeholder="Note (optional)" aria-label="Note about this meal">`;
    const note = row.querySelector(".rating-note");
    const paint = () => {
      const rec = get()[mealId] || {};
      row.querySelectorAll(".rating-btn").forEach((b) => b.setAttribute("aria-pressed", String(rec.rating === b.dataset.r)));
      const nv = row.querySelector(".rating-never");
      nv.setAttribute("aria-pressed", String(!!rec.never));
      nv.textContent = rec.never ? "Flagged never ✓" : "Never again";
      if (document.activeElement !== note) note.value = rec.note || "";
    };
    const save = (patch) => {
      const rec = set(mealId, patch);
      if (root.MP.Sync) root.MP.Sync.pushRating(mealId, patch);
      paint();
      if (onChange) onChange(rec);
    };
    row.querySelectorAll(".rating-btn").forEach((b) => b.addEventListener("click", () => {
      save({ rating: (get()[mealId] || {}).rating === b.dataset.r ? null : b.dataset.r });
    }));
    row.querySelector(".rating-never").addEventListener("click", () => {
      const was = !!(get()[mealId] || {}).never;
      save({ never: !was });
      if (!was && toast) toast("Flagged never again", "Undo", () => save({ never: false }));
    });
    note.addEventListener("change", () => save({ note: note.value }));
    paint();
    return row;
  }

  const TASTE_W = { up: 2, down: -3 }; // never: -4 (mirrors Prefs.scoreOf weights)
  const tokensOf = (m) => (m.ingredients || []).map((i) => (i.key || "").toLowerCase().trim()).filter(Boolean)
    .concat(m.prepEffort ? ["effort:" + m.prepEffort] : []);

  /** Phase 62: derived on read, never stored. `planning` = pack-sizes.json planning (tasteWindow/tasteMinRated), optional.
   *  @returns {{n:number, window:number, tokens:{[t:string]:number}}} tokens {} (inert) below tasteMinRated rated meals. */
  function tasteProfile(ratings, meals, planning) {
    const minRated = (planning && planning.tasteMinRated) || 3;
    const out = { n: 0, window: (planning && planning.tasteWindow) || 4, tokens: {} };
    const freq = {};
    for (const m of meals || []) for (const t of new Set(tokensOf(m))) freq[t] = (freq[t] || 0) + 1;
    const totals = {};
    for (const m of meals || []) {
      const r = (ratings || {})[m.id];
      if (!r) continue;
      const s = r.never ? -4 : TASTE_W[r.rating] || 0;
      if (!s && !r.rating && !r.never) continue;
      out.n++;
      if (!s) continue;
      for (const t of new Set(tokensOf(m))) totals[t] = (totals[t] || 0) + s / freq[t];
    }
    if (out.n >= minRated) out.tokens = totals;
    return out;
  }

  function tasteScore(profile, meal) {
    const tk = (profile && profile.tokens) || {};
    return tokensOf(meal).reduce((sum, t) => sum + (tk[t] || 0), 0);
  }

  root.MP = root.MP || {};
  root.MP.Ratings = { KEY, NOTE_MAX, patchError, applyPatch, mergeMaps, get, set, merge, neverIds, byId: get, rowEl, tasteProfile, tasteScore };
})(typeof globalThis !== "undefined" ? globalThis : this);
