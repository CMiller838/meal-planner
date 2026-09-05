// Shared data layer: localStorage-backed meal library, esc() helper, small utils.
window.MP = window.MP || {};

(function () {
  "use strict";

  const LS_LIBRARY = "mp_library";
  const LS_LIBRARY_STAMP = "mp_library_updated_at";
  const LS_THEME = "mp_theme";
  const SS_DISMISSED = "mp_dismissed_discover";
  const LS_SAVED_LATER = "mp_saved_later";

  /** Escape untrusted text before innerHTML interpolation (TheMealDB strings). */
  function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function labelize(key) {
    return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function loadSeedMeals() {
    const res = await fetch("meals.json");
    return res.json();
  }

  /** Liked library = seed meals + any user-added discover meals, persisted in localStorage. */
  async function getLibrary() {
    const stored = localStorage.getItem(LS_LIBRARY);
    if (stored) return JSON.parse(stored);
    const seed = await loadSeedMeals();
    // Bypass saveLibrary(): stamping the seed would make a fresh browser's
    // 14 defaults look newer than a real Hermes library and push over it.
    localStorage.setItem(LS_LIBRARY, JSON.stringify(seed));
    return seed;
  }

  function saveLibrary(meals) {
    localStorage.setItem(LS_LIBRARY, JSON.stringify(meals));
    localStorage.setItem(LS_LIBRARY_STAMP, new Date().toISOString());
    window.dispatchEvent(new Event("mp:library-saved"));
  }

  /** Overwrite the local library with a pulled remote one, stamping the
   *  REMOTE timestamp and firing no event — applying a pull must not look
   *  like a fresh local edit or it would push straight back. */
  function applyRemoteLibrary(meals, updatedAt) {
    localStorage.setItem(LS_LIBRARY, JSON.stringify(meals));
    localStorage.setItem(LS_LIBRARY_STAMP, updatedAt);
  }

  function libraryStamp() {
    return localStorage.getItem(LS_LIBRARY_STAMP);
  }

  function addToLibrary(meal) {
    const stored = JSON.parse(localStorage.getItem(LS_LIBRARY) || "[]");
    if (stored.some((m) => m.id === meal.id)) return stored;
    stored.push({ prepEffort: "quick", ...meal });
    saveLibrary(stored);
    return stored;
  }

  /** Replace the meal with this id, or append if it's new. @returns {Array} new library */
  function upsertMeal(meal) {
    const stored = JSON.parse(localStorage.getItem(LS_LIBRARY) || "[]");
    const idx = stored.findIndex((m) => m.id === meal.id);
    if (idx === -1) stored.push(meal);
    else stored[idx] = meal;
    saveLibrary(stored);
    return stored;
  }

  /** Remove by id. No-op (still returns the array) if the id isn't present. */
  function removeFromLibrary(mealId) {
    const stored = JSON.parse(localStorage.getItem(LS_LIBRARY) || "[]");
    const filtered = stored.filter((m) => m.id !== mealId);
    saveLibrary(filtered);
    return filtered;
  }

  const UNIT = /^(g|kg|ml|l|tbsp|tsp|slices?|cans?|tins?|packs?|cloves?|handfuls?|bunch(es)?|pinch(es)?|rashers?|fillets?)$/i;

  function slugify(label) {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return slug || "ingredient";
  }

  function snapKey(slug, knownKeys) {
    if (knownKeys.includes(slug)) return slug;
    const noS = slug.replace(/s$/, "");
    if (knownKeys.includes(noS)) return noS;
    if (knownKeys.includes(slug + "s")) return slug + "s";
    let best = null;
    for (const key of knownKeys) {
      if (slug.includes(key) || key.includes(slug)) {
        if (!best || key.length > best.length) best = key;
      }
    }
    return best || slug;
  }

  /** Parse the ingredients textarea into meal-record ingredient objects.
   *  Never returns an entry with an empty `key` — data.js does
   *  `ing.key.replace(...)` and would throw on one.
   *  ponytail: substring matching, not a synonym table — "mince" will not
   *  find beef_mince. Upgrade path is an aliases list in pack-sizes.json,
   *  not a fuzzier matcher. */
  function parseIngredients(text, knownKeys) {
    const keys = knownKeys || [];
    return (text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        let label, qty;
        const dashMatch = line.match(/ — | - /);
        if (dashMatch) {
          const i = dashMatch.index;
          label = line.slice(0, i).trim();
          qty = line.slice(i + dashMatch[0].length).trim();
        } else {
          const tokens = line.split(/\s+/);
          let i = 0;
          if (/^\d/.test(tokens[0])) i = 1;
          if (i === 1 && UNIT.test(tokens[1] || "")) i = 2;
          qty = tokens.slice(0, i).join(" ");
          label = tokens.slice(i).join(" ");
          if (!label) {
            qty = "";
            label = line;
          }
        }
        const key = snapKey(slugify(label), keys);
        return { key, qty, label };
      });
  }

  /** Inverse of parseIngredients: one line per ingredient. */
  function ingredientsToText(ingredients) {
    return (ingredients || [])
      .map((ing) => {
        const label = ing.label || labelize(ing.key);
        return ing.qty ? `${label} — ${ing.qty}` : label;
      })
      .join("\n");
  }

  /** First library meal with a confusably similar name, or null. */
  function findSimilarName(meals, name, ignoreId) {
    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = norm(name);
    if (!target) return null;
    for (const meal of meals) {
      if (meal.id === ignoreId) continue;
      const other = norm(meal.name);
      if (!other) continue;
      if (target === other) return meal;
      const shorter = target.length <= other.length ? target : other;
      const longer = target.length <= other.length ? other : target;
      if (shorter.length >= 4 && longer.includes(shorter)) return meal;
    }
    return null;
  }

  /**
   * Case-insensitive substring match over name, mealTypes, and ingredient
   * keys/labels. Blank/whitespace query returns the array unfiltered.
   */
  function filterMeals(meals, query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return meals;
    return meals.filter((meal) => {
      const parts = [meal.name, ...(meal.mealTypes || [])];
      for (const ing of meal.ingredients || []) {
        parts.push(ing.key.replace(/_/g, " "));
        if (ing.label) parts.push(ing.label);
      }
      return parts.join(" ").toLowerCase().includes(q);
    });
  }

  function getDismissed() {
    return new Set(JSON.parse(sessionStorage.getItem(SS_DISMISSED) || "[]"));
  }

  function dismiss(mealId) {
    const set = getDismissed();
    set.add(mealId);
    sessionStorage.setItem(SS_DISMISSED, JSON.stringify([...set]));
  }

  /** "Save for later" pile from the Discover fan deck — persisted separately
   *  from the liked library so a save isn't the same as adding to the plan. */
  function getSavedLater() {
    return JSON.parse(localStorage.getItem(LS_SAVED_LATER) || "[]");
  }

  function saveForLater(meal) {
    const stored = getSavedLater();
    if (stored.some((m) => m.id === meal.id)) return stored;
    stored.push(meal);
    localStorage.setItem(LS_SAVED_LATER, JSON.stringify(stored));
    return stored;
  }

  function removeSavedLater(mealId) {
    const stored = getSavedLater().filter((m) => m.id !== mealId);
    localStorage.setItem(LS_SAVED_LATER, JSON.stringify(stored));
    return stored;
  }

  function getTheme() {
    return localStorage.getItem(LS_THEME) || "dark";
  }

  function setTheme(theme) {
    localStorage.setItem(LS_THEME, theme);
    applyTheme(theme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function initTheme() {
    applyTheme(getTheme());
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.addEventListener("click", () => {
        setTheme(getTheme() === "dark" ? "light" : "dark");
      });
    }
    const active = document.querySelector(".nav-links a.active");
    if (active) active.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  MP.esc = esc;
  MP.labelize = labelize;
  MP.getLibrary = getLibrary;
  MP.saveLibrary = saveLibrary;
  MP.applyRemoteLibrary = applyRemoteLibrary;
  MP.libraryStamp = libraryStamp;
  MP.addToLibrary = addToLibrary;
  MP.upsertMeal = upsertMeal;
  MP.removeFromLibrary = removeFromLibrary;
  MP.parseIngredients = parseIngredients;
  MP.ingredientsToText = ingredientsToText;
  MP.findSimilarName = findSimilarName;
  MP.filterMeals = filterMeals;
  MP.getDismissed = getDismissed;
  MP.dismiss = dismiss;
  MP.getSavedLater = getSavedLater;
  MP.saveForLater = saveForLater;
  MP.removeSavedLater = removeSavedLater;
  MP.initTheme = initTheme;
})();
