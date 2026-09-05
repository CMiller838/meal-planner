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
  const POOL_LIMIT = 10;
  const CANDIDATE_LIMIT = 12;
  const CATEGORIES = ["Chicken", "Beef", "Seafood", "Pasta", "Pork", "Lamb", "Vegetarian", "Breakfast"];

  /** Unique idMeal values from filter.php results, shuffled, capped at `limit`.
   *  Fisher-Yates, descending loop, so rnd() === ~1 yields the identity permutation.
   *  @param {Array<{idMeal: string}>} list
   *  @param {number} limit
   *  @param {Function} [rnd]  defaults to Math.random; injected only by test.html
   *  @returns {string[]} */
  function sampleIds(list, limit, rnd) {
    const seen = new Set();
    const ids = [];
    for (const m of list) {
      if (m.idMeal && !seen.has(m.idMeal)) {
        seen.add(m.idMeal);
        ids.push(m.idMeal);
      }
    }
    const random = rnd || Math.random;
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids.slice(0, limit);
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

  async function fetchPoolUncached(category) {
    let candidateIds;
    if (category) {
      // No .catch() here - a dead filter.php must reach discover.js's handler as a
      // network error, not as an indistinguishable empty deck.
      const d = await fetchJson(`${BASE}filter.php?c=${encodeURIComponent(category)}`);
      candidateIds = sampleIds(d.meals || [], CANDIDATE_LIMIT);
    } else {
      const lists = await Promise.all(
        LIKED_INGREDIENTS.map((ing) =>
          fetchJson(`${BASE}filter.php?i=${encodeURIComponent(ing)}`)
            .then((d) => d.meals || [])
            .catch(() => [])
        )
      );
      candidateIds = sampleIds([].concat(...lists), CANDIDATE_LIMIT);
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

  /** Cached (sessionStorage) discover pool, filtered against already-liked/dismissed ids.
   *  @param {string[]} excludeIds
   *  @param {string} [category]  "" or omitted = the liked-ingredient pool */
  async function getDiscoverPool(excludeIds, category) {
    const key = `${SS_POOL}:${category || ""}`;
    let pool;
    const cached = sessionStorage.getItem(key);
    if (cached) {
      pool = JSON.parse(cached);
    } else {
      pool = await fetchPoolUncached(category);
      try {
        sessionStorage.setItem(key, JSON.stringify(pool));
      } catch (e) {
        // quota/private-mode - skip caching rather than take down page load
      }
    }
    const exclude = new Set(excludeIds);
    return pool.filter((m) => !exclude.has(m.id));
  }

  root.MP = root.MP || {};
  root.MP.MealDB = { toMeal, load, getDiscoverPool, sampleIds, CATEGORIES };
})(typeof globalThis !== "undefined" ? globalThis : this);
