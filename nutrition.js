// Approximate nutrient-coverage scoring. Not a calorie calculator - a
// transparent high/med/low coverage checklist, as flagged in SPEC.md.
window.MP = window.MP || {};

(function () {
  "use strict";

  const LEVEL_WEIGHT = { high: 3, med: 2, low: 1 };
  const PROTEIN_GRAMS_APPROX = { high: 30, med: 15, low: 5 };
  const TRACKED_NUTRIENTS = [
    "fibre", "vitA", "vitC", "vitD", "vitB12", "folate",
    "calcium", "iron", "zinc", "magnesium", "potassium",
  ];

  let cache = null;
  async function load() {
    if (cache) return cache;
    const [tags, targets] = await Promise.all([
      fetch("ingredient-nutrient-tags.json").then((r) => r.json()),
      fetch("nutrition-targets.json").then((r) => r.json()),
    ]);
    cache = { tags, targets };
    return cache;
  }

  function scoresForMeals(meals, tags) {
    const scores = {};
    let proteinGrams = 0;
    for (const meal of meals) {
      for (const ing of meal.ingredients || []) {
        const tag = tags[ing.key];
        if (!tag) continue;
        for (const [nutrient, level] of Object.entries(tag)) {
          scores[nutrient] = (scores[nutrient] || 0) + (LEVEL_WEIGHT[level] || 0);
          if (nutrient === "protein") proteinGrams += PROTEIN_GRAMS_APPROX[level] || 0;
        }
      }
    }
    return { scores, proteinGrams };
  }

  /** Coverage checklist for one day's meals (array of meal objects). */
  function dayCoverage(meals, tags, targets) {
    const { scores, proteinGrams } = scoresForMeals(meals, tags);
    const coverage = TRACKED_NUTRIENTS.map((nutrient) => {
      const score = scores[nutrient] || 0;
      const status = score >= 3 ? "covered" : score >= 1 ? "partial" : "missing";
      return { nutrient, score, status };
    });
    return {
      proteinGramsApprox: proteinGrams,
      proteinTarget: targets.protein_g,
      coverage,
      sodiumCaution: (scores.sodium || 0) >= 4,
      missing: coverage.filter((c) => c.status === "missing").map((c) => c.nutrient),
      partial: coverage.filter((c) => c.status === "partial").map((c) => c.nutrient),
    };
  }

  /** Coverage checklist for a whole week (array of day meal-arrays). */
  function weekCoverage(dayMealArrays, tags, targets) {
    return dayCoverage(dayMealArrays.flat(), tags, targets);
  }

  /** Sort candidate meals by how well they fill the given gap nutrients. */
  function rankByGap(candidates, gapNutrients, tags) {
    if (!gapNutrients.length) return candidates.slice();
    return candidates
      .map((meal) => {
        let score = 0;
        for (const ing of meal.ingredients || []) {
          const tag = tags[ing.key];
          if (!tag) continue;
          for (const [nutrient, level] of Object.entries(tag)) {
            if (gapNutrients.includes(nutrient)) score += LEVEL_WEIGHT[level] || 0;
          }
        }
        return { meal, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.meal);
  }

  MP.Nutrition = { load, dayCoverage, weekCoverage, rankByGap, TRACKED_NUTRIENTS };
})();
