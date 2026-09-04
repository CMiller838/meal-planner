// Shared data layer: localStorage-backed meal library, esc() helper, small utils.
window.MP = window.MP || {};

(function () {
  "use strict";

  const LS_LIBRARY = "mp_library";
  const LS_LIBRARY_STAMP = "mp_library_updated_at";
  const LS_THEME = "mp_theme";
  const SS_DISMISSED = "mp_dismissed_discover";

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
  }

  MP.esc = esc;
  MP.labelize = labelize;
  MP.getLibrary = getLibrary;
  MP.saveLibrary = saveLibrary;
  MP.applyRemoteLibrary = applyRemoteLibrary;
  MP.libraryStamp = libraryStamp;
  MP.addToLibrary = addToLibrary;
  MP.filterMeals = filterMeals;
  MP.getDismissed = getDismissed;
  MP.dismiss = dismiss;
  MP.initTheme = initTheme;
})();
