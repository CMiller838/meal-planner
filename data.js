// Shared data layer: localStorage-backed meal library, esc() helper, small utils.
window.MP = window.MP || {};

(function () {
  "use strict";

  const LS_LIBRARY = "mp_library";
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
    localStorage.setItem(LS_LIBRARY, JSON.stringify(seed));
    return seed;
  }

  function saveLibrary(meals) {
    localStorage.setItem(LS_LIBRARY, JSON.stringify(meals));
  }

  function addToLibrary(meal) {
    const stored = JSON.parse(localStorage.getItem(LS_LIBRARY) || "[]");
    if (stored.some((m) => m.id === meal.id)) return stored;
    stored.push(meal);
    saveLibrary(stored);
    return stored;
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
  MP.addToLibrary = addToLibrary;
  MP.getDismissed = getDismissed;
  MP.dismiss = dismiss;
  MP.initTheme = initTheme;
})();
