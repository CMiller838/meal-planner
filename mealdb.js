// TheMealDB integration (free tier, key="1"). Every string from here is
// untrusted third-party content - callers MUST run it through MP.esc()
// before innerHTML use. toMeal/extractIngredients are pure (no window/
// sessionStorage) so the Worker can import this file for the same mapping;
// only getDiscoverPool touches the browser, and only inside its own body.
(function (root) {
  "use strict";

  const BASE = "https://www.themealdb.com/api/json/v1/1/";
  // Ingredients Cody already likes, used to source Discover suggestions.
  const LIKED_INGREDIENTS = ["chicken_breast", "minced_beef", "salmon", "tuna", "chorizo"];
  const SS_POOL = "mp_discover_pool";
  const PER_INGREDIENT_LIMIT = 3;
  const POOL_LIMIT = 10;

  function extractIngredients(detail) {
    const out = [];
    for (let i = 1; i <= 20; i++) {
      const ing = detail[`strIngredient${i}`];
      const measure = detail[`strMeasure${i}`];
      if (ing && ing.trim()) {
        out.push({ key: ing.trim().toLowerCase().replace(/\s+/g, "_"), qty: (measure || "").trim(), label: ing.trim() });
      }
    }
    return out;
  }

  function toMeal(detail) {
    return {
      id: `api-${detail.idMeal}`,
      name: detail.strMeal,
      source: "themealdb",
      mealTypes: detail.strCategory === "Breakfast" ? ["breakfast"] : ["dinner"],
      batchCook: false,
      servings: 1,
      description: (detail.strInstructions || "").slice(0, 140).trim() + "…",
      instructions: detail.strInstructions || "",
      ingredients: extractIngredients(detail),
      image: detail.strMealThumb || null,
    };
  }

  let subsCache = null;
  /** Cached substitutions.json, mirroring MP.ShelfLife.load(). A fetch
   *  failure degrades to {} (mushroom meals rejected outright), never a pass. */
  async function load() {
    if (subsCache) return subsCache;
    subsCache = await fetch("substitutions.json")
      .then((r) => r.json())
      .catch(() => ({}));
    return subsCache;
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    return res.json();
  }

  async function fetchPoolUncached() {
    const perIngredient = await Promise.all(
      LIKED_INGREDIENTS.map((ing) =>
        fetchJson(`${BASE}filter.php?i=${encodeURIComponent(ing)}`)
          .then((d) => (d.meals || []).slice(0, PER_INGREDIENT_LIMIT))
          .catch(() => [])
      )
    );
    const seen = new Set();
    const candidateIds = [];
    for (const list of perIngredient) {
      for (const m of list) {
        if (!seen.has(m.idMeal)) {
          seen.add(m.idMeal);
          candidateIds.push(m.idMeal);
        }
      }
    }
    const details = await Promise.all(
      candidateIds.map((id) =>
        fetchJson(`${BASE}lookup.php?i=${id}`)
          .then((d) => (d.meals ? d.meals[0] : null))
          .catch(() => null)
      )
    );
    const subs = await load();
    return details
      .filter(Boolean)
      .map(toMeal)
      .map((m) => root.MP.Exclusions.sanitize(m, subs))
      .filter(Boolean)
      .slice(0, POOL_LIMIT)
      .map((r) => r.meal);
  }

  /** Cached (sessionStorage) discover pool, filtered against already-liked/dismissed ids. */
  async function getDiscoverPool(excludeIds) {
    let pool;
    const cached = sessionStorage.getItem(SS_POOL);
    if (cached) {
      pool = JSON.parse(cached);
    } else {
      pool = await fetchPoolUncached();
      sessionStorage.setItem(SS_POOL, JSON.stringify(pool));
    }
    const exclude = new Set(excludeIds);
    return pool.filter((m) => !exclude.has(m.id));
  }

  root.MP = root.MP || {};
  root.MP.MealDB = { toMeal, load, getDiscoverPool };
})(typeof globalThis !== "undefined" ? globalThis : this);
