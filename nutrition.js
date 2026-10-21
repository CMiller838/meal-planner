// Approximate nutrient-coverage scoring. Not a calorie calculator - a
// transparent high/med/low coverage checklist, as flagged in SPEC.md.
(function (root) {
  "use strict";
  const MP = (root.MP = root.MP || {});

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

  /** Nutrient names (not levels) present in one meal, deduped and sorted.
   *  Unknown ingredient keys contribute nothing; a null/ingredient-less meal
   *  gives []. Used to freeze a snapshot into the eaten log (Phase 15). */
  function tagsForMeal(meal, tags) {
    const names = new Set();
    for (const ing of (meal && meal.ingredients) || []) {
      const tag = tags[ing.key];
      if (!tag) continue;
      for (const nutrient of Object.keys(tag)) names.add(nutrient);
    }
    return [...names].sort();
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

  /** Targets copy with the gym-day uplift added; unchanged when there is no gymDay block. */
  function withGymDay(targets) {
    const up = targets && targets.gymDay;
    if (!up) return targets;
    const out = { ...targets };
    for (const [k, v] of Object.entries(up)) if (typeof out[k] === "number") out[k] += v;
    return out;
  }

  /** One day's eaten-log entries scored with dayCoverage. Entries whose meal left the
   *  library carry frozen tags with no levels: their nutrients count as partial, never covered. */
  function eatenDayCoverage(entries, byId, tags, targets) {
    const known = entries.map((e) => byId[e.mealId]).filter(Boolean);
    const cov = dayCoverage(known, tags, targets);
    const orphanTags = new Set(entries.filter((e) => !byId[e.mealId]).flatMap((e) => e.tags || []));
    return {
      cov,
      missing: cov.missing.filter((n) => !orphanTags.has(n)),
      partial: [...cov.partial, ...cov.missing.filter((n) => orphanTags.has(n))],
    };
  }

  /** Per-nutrient tally over `dates` ("YYYY-MM-DD"). dayKey(entry) gives an entry's local date
   *  (null/throw = skip). Days with no entries are excluded from loggedDays and listed in notLogged. */
  function weekGaps(entries, byId, dates, tags, targets, dayKey) {
    const byDay = Object.fromEntries(dates.map((d) => [d, []]));
    for (const e of entries) {
      let k = null;
      try { k = e && e.eatenAt ? dayKey(e) : null; } catch (err) { k = null; }
      if (k && byDay[k]) byDay[k].push(e);
    }
    const days = dates.map((date) => ({ date, logged: byDay[date].length > 0 }));
    const scored = days.filter((d) => d.logged).map((d) => eatenDayCoverage(byDay[d.date], byId, tags, targets));
    const nutrients = TRACKED_NUTRIENTS.map((nutrient) => {
      const coveredDays = scored.filter((s) => !s.missing.includes(nutrient) && !s.partial.includes(nutrient)).length;
      const missedDays = scored.filter((s) => s.missing.includes(nutrient)).length;
      return { nutrient, coveredDays, loggedDays: scored.length, missedDays, flag: missedDays >= 3 };
    });
    return { days, nutrients, notLogged: days.filter((d) => !d.logged).map((d) => d.date) };
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

  MP.Nutrition = { load, tagsForMeal, dayCoverage, weekCoverage, rankByGap, TRACKED_NUTRIENTS, withGymDay, eatenDayCoverage, weekGaps };
})(typeof globalThis !== "undefined" ? globalThis : this);
