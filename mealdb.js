// TheMealDB integration (free tier, key="1"). Client-side fetch, CORS is
// allowed by TheMealDB. Every string from here is untrusted third-party
// content - callers MUST run it through MP.esc() before innerHTML use.
window.MP = window.MP || {};

(function () {
  "use strict";

  const BASE = "https://www.themealdb.com/api/json/v1/1/";
  // Ingredients Cody already likes, used to source Discover suggestions.
  const LIKED_INGREDIENTS = ["chicken_breast", "minced_beef", "salmon", "tuna", "chorizo"];
  const SS_POOL = "mp_discover_pool";
  const PER_INGREDIENT_LIMIT = 3;
  const POOL_LIMIT = 10;

  function hasMushroom(detail) {
    for (let i = 1; i <= 20; i++) {
      const ing = detail[`strIngredient${i}`];
      if (ing && ing.toLowerCase().includes("mushroom")) return true;
    }
    return false;
  }

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
    return details
      .filter(Boolean)
      .filter((d) => !hasMushroom(d))
      .slice(0, POOL_LIMIT)
      .map(toMeal);
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

  MP.MealDB = { getDiscoverPool };
})();
