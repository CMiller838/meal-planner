// Like/dismiss/eaten counters per meal, local signal for Discover taste
// ranking and a read-only export to Hermes. Pure functions (score,
// tasteScores, orderByTaste) are tested in test.html.
window.MP = window.MP || {};

(function () {
  "use strict";

  const KEY = "mp_prefs";
  const LS_DIRTY = "mp_prefs_dirty";
  const FIELDS = ["liked", "dismissed", "eaten"];

  function get() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function isDirty() {
    return localStorage.getItem(LS_DIRTY) === "1";
  }

  function clearDirty() {
    localStorage.removeItem(LS_DIRTY);
  }

  /** meal: a full meal object, or {id, name}. Silent no-op on an unknown field. */
  function bump(meal, field) {
    if (!meal || !meal.id || !FIELDS.includes(field)) return;
    const prefs = get();
    const rec = prefs[meal.id] || { name: meal.name || "", liked: 0, dismissed: 0, eaten: 0 };
    rec.name = meal.name || rec.name;
    rec[field] = Math.max(0, (rec[field] || 0) + 1);
    rec.lastAt = new Date().toISOString();
    prefs[meal.id] = rec;
    localStorage.setItem(KEY, JSON.stringify(prefs));
    localStorage.setItem(LS_DIRTY, "1");
  }

  function scoreOf(rec) {
    if (!rec) return 0;
    return (rec.liked || 0) * 2 + (rec.eaten || 0) * 3 - (rec.dismissed || 0) * 3;
  }

  function score(mealId) {
    return scoreOf(get()[mealId]);
  }

  function tokensOf(meal) {
    return (meal.ingredients || []).map((i) => (i.key || "").toLowerCase().trim()).filter(Boolean);
  }

  /** Aggregates each meal's score onto its ingredient tokens, normalised by
   *  token frequency so a token in everything (salt, oil, onion) can't
   *  dominate. @returns {{[token: string]: number}} */
  function tasteScores(prefs, meals) {
    const byId = Object.fromEntries(meals.map((m) => [m.id, m]));
    const freq = {};
    for (const meal of meals) for (const t of tokensOf(meal)) freq[t] = (freq[t] || 0) + 1;
    const totals = {};
    for (const mealId of Object.keys(prefs)) {
      const meal = byId[mealId];
      if (!meal) continue;
      const s = scoreOf(prefs[mealId]);
      if (!s) continue;
      for (const t of tokensOf(meal)) totals[t] = (totals[t] || 0) + s / freq[t];
    }
    return totals;
  }

  /** Stable permutation of `list`, descending by summed ingredient-token
   *  taste score, minus a penalty for a repeatedly-dismissed meal. Never
   *  filters — identity ordering when prefs is empty. */
  function orderByTaste(list, prefs, meals) {
    const scores = tasteScores(prefs, meals);
    return list
      .map((meal, i) => {
        const tokenScore = tokensOf(meal).reduce((sum, t) => sum + (scores[t] || 0), 0);
        const rec = prefs[meal.id];
        const penalty = rec && rec.dismissed >= 2 ? 1000 : 0;
        return { meal, i, s: tokenScore - penalty };
      })
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.meal);
  }

  MP.Prefs = { KEY, get, bump, isDirty, clearDirty, score, scoreOf, tasteScores, orderByTaste };
})();
