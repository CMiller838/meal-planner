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
    const [tags, targets, foodLog] = await Promise.all([
      fetch("ingredient-nutrient-tags.json").then((r) => r.json()),
      fetch("nutrition-targets.json").then((r) => r.json()),
      fetch("food-log.json").then((r) => r.json()),
    ]);
    const sync = MP.Sync && MP.Sync.settings && MP.Sync.settings();
    cache = { tags, targets: withProfile(targets, sync), foodLog };
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

  /** Targets copy with a Profile.md `settings.targets` merged per key (Phase 52); null settings = same object. */
  function withProfile(targets, settings) {
    const t = settings && settings.targets;
    if (!t || !Object.keys(t).length) return targets;
    return { ...targets, ...t };
  }

  /** rankSlot's `opts.profile` from settings; undefined when there is nothing to apply. */
  function profileOf(settings) {
    if (!settings) return undefined;
    const l = (k) => (Array.isArray(settings[k]) ? settings[k] : []);
    const p = { hard: [...new Set(l("allergies").concat(l("never")))], likes: l("likes"), dislikes: l("dislikes") };
    return p.hard.length || p.likes.length || p.dislikes.length ? p : undefined;
  }

  /** One day's eaten-log entries scored with dayCoverage. Entries whose meal left the
   *  library carry frozen tags with no levels: their nutrients count as partial, never covered. */
  function eatenDayCoverage(entries, byId, tags, targets) {
    // Phase 104: portion < 1 counts partial (frozen tags join orphanTags); protein grams scale both ways.
    const sized = (e) => byId[e.mealId] && Number.isFinite(e.portion) && e.portion !== 1;
    const known = entries.filter((e) => byId[e.mealId] && !(sized(e) && e.portion < 1)).map((e) => byId[e.mealId]);
    const cov = dayCoverage(known, tags, targets);
    const orphans = entries.filter((e) => !byId[e.mealId] || (sized(e) && e.portion < 1));
    const orphanTags = new Set(orphans.flatMap((e) => e.tags || []));
    const extraProtein = entries.reduce((s, e) => {
      if (!byId[e.mealId]) return s + (e.proteinGrams || 0); // Phase 80: real grams from the food log
      return sized(e) ? s + (e.portion - (e.portion < 1 ? 0 : 1)) * dayCoverage([byId[e.mealId]], tags, targets).proteinGramsApprox : s;
    }, 0);
    return {
      cov: extraProtein ? { ...cov, proteinGramsApprox: Math.round((cov.proteinGramsApprox + extraProtein) * 100) / 100 } : cov,
      missing: cov.missing.filter((n) => !orphanTags.has(n)),
      partial: [...cov.partial, ...cov.missing.filter((n) => orphanTags.has(n))],
    };
  }

  /** Phase 80: a food-log eat entry as an eaten-log-shaped orphan. A nutrient is tagged when its logged amount is at
   *  least `tagShare` of that target, so the existing orphan path counts it "partial" at most. */
  function foodAsEaten(entry, targets, tagShare) {
    const n = entry.nutrients || {};
    const tags = TRACKED_NUTRIENTS.filter((name) => Object.keys(targets).some((k) => k.startsWith(name + "_") && !k.endsWith("_cap") && n[k] && n[k].value >= tagShare * targets[k]));
    return { id: "food:" + entry.id, mealId: "food:" + entry.id, name: entry.name, eatenAt: entry.when, tags, proteinGrams: n.protein_g ? n.protein_g.value : 0 };
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

  /** How well one meal fills the given gap nutrients (sum of tag weights). */
  function gapScore(meal, gapNutrients, tags) {
    let score = 0;
    for (const ing of meal.ingredients || []) {
      const tag = tags[ing.key];
      if (!tag) continue;
      for (const [nutrient, level] of Object.entries(tag)) {
        if (gapNutrients.includes(nutrient)) score += LEVEL_WEIGHT[level] || 0;
      }
    }
    return score;
  }

  /** Sort candidate meals by how well they fill the given gap nutrients. */
  function rankByGap(candidates, gapNutrients, tags) {
    if (!gapNutrients.length) return candidates.slice();
    return candidates
      .map((meal) => ({ meal, score: gapScore(meal, gapNutrients, tags) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.meal);
  }

  MP.Nutrition = { load, tagsForMeal, dayCoverage, weekCoverage, rankByGap, gapScore, TRACKED_NUTRIENTS, withGymDay, withProfile, profileOf, eatenDayCoverage, weekGaps, foodAsEaten };
})(typeof globalThis !== "undefined" ? globalThis : this);
