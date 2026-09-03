// Plan generator: pure logic, no DOM/localStorage/fetch. Builds a 14-day plan
// from the liked library — nutrient-gap ranking, weeknight/weekend
// prep-effort preference, batch-cook leftover runs, and a variety guard
// against back-to-back repeats. See SPEC.md and docs/roadmap.md Phase 2.
window.MP = window.MP || {};

(function () {
  "use strict";

  const OTHER_SLOTS = ["breakfast", "lunch", "snack"];

  function isoToday() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  /** 0=Sun..6=Sat for day N (1-based) of a plan starting on startDate (local, not UTC). */
  function weekdayOf(startDate, dayNum) {
    const [y, m, d] = startDate.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + (dayNum - 1));
    return date.getDay();
  }

  /** Maximal consecutive day-position runs (1..14) whose real weekday is Fri/Sat/Sun. */
  function weekendRuns(startDate) {
    const runs = [];
    let current = [];
    for (let day = 1; day <= 14; day++) {
      const wd = weekdayOf(startDate, day);
      if (wd === 5 || wd === 6 || wd === 0) {
        current.push(day);
      } else if (current.length) {
        runs.push(current);
        current = [];
      }
    }
    if (current.length) runs.push(current);
    return runs;
  }

  function effortOf(meal) {
    return meal.prepEffort || "quick";
  }

  function generatePlan(library, tags, targets, shelfData, startDate) {
    startDate = startDate || isoToday();
    const mealsById = Object.fromEntries(library.map((m) => [m.id, m]));
    const dinnerPool = library.filter((m) => (m.mealTypes || []).includes("dinner"));
    const days = Array.from({ length: 14 }, (_, i) => ({ day: i + 1, slots: {} }));
    const lastUsedDay = {};

    function place(day, slotType, meal) {
      days[day - 1].slots[slotType] = { mealId: meal ? meal.id : null };
      if (meal) lastUsedDay[meal.id] = day;
    }

    function prevMealId(day, slotType) {
      if (day <= 1) return null;
      const slot = days[day - 2].slots[slotType];
      return slot ? slot.mealId : null;
    }

    function pickMeal(pool, dayNum, dayMealsSoFar, opts) {
      opts = opts || {};
      const excludeIds = opts.excludeIds || new Set();
      let ranked = pool.filter((m) => !excludeIds.has(m.id));
      if (!ranked.length) ranked = pool.slice(); // too small a pool to honour the exclusion; repeat is unavoidable
      if (!ranked.length) return null;
      const gap = MP.Nutrition.dayCoverage(dayMealsSoFar, tags, targets);
      const gapNutrients = [...gap.missing, ...gap.partial];
      ranked = MP.Nutrition.rankByGap(ranked, gapNutrients, tags);
      if (opts.prefer) {
        const matches = ranked.filter((m) => effortOf(m) === opts.prefer);
        const rest = ranked.filter((m) => effortOf(m) !== opts.prefer);
        ranked = matches.concat(rest);
      }
      const never = ranked.filter((m) => !(m.id in lastUsedDay));
      const used = ranked
        .filter((m) => m.id in lastUsedDay)
        .sort((a, b) => lastUsedDay[a.id] - lastUsedDay[b.id]);
      return never.concat(used)[0] || null;
    }

    const runs = weekendRuns(startDate);
    const filled = new Set();

    for (const run of runs) {
      if (run.length < 2) continue;
      const d0 = run[0];
      const excludeIds = new Set();
      const prevId = prevMealId(d0, "dinner");
      if (prevId) excludeIds.add(prevId);
      const batchCandidates = dinnerPool.filter((m) => m.batchCook === true);
      // ponytail: shelf-life-safe batch candidates assume a fixed Mon/Sat shop day
      // and no freezer state — with the seed library and a Monday start only
      // chorizo-pasta survives to Friday. Real fix is freezer-aware planning
      // (buy day 1, freeze, defrost Thursday); logged in docs/FUTURE.md.
      const safe = batchCandidates.filter((m) => MP.ShelfLife.rawSafeOn(m, d0, shelfData));
      const candidatePool = safe.length ? safe : batchCandidates;
      const parent = pickMeal(candidatePool, d0, [], { prefer: "batch", excludeIds });
      if (!parent) continue; // no batch meal available at all; days fall through to quick fill below

      const coverage = Math.min(run.length, parent.servings || 2, shelfData.cooked_leftovers.fridgeDays);
      const childId = (parent.leadsTo || []).find((id) => mealsById[id]);
      for (let i = 0; i < coverage; i++) {
        const day = run[i];
        const meal = i === 0 ? parent : childId ? mealsById[childId] : parent;
        place(day, "dinner", meal);
        filled.add(day);
      }
    }

    for (let day = 1; day <= 14; day++) {
      if (filled.has(day)) continue;
      const excludeIds = new Set();
      const prevId = prevMealId(day, "dinner");
      if (prevId) excludeIds.add(prevId);
      const meal = pickMeal(dinnerPool, day, [], { prefer: "quick", excludeIds });
      place(day, "dinner", meal);
    }

    for (let day = 1; day <= 14; day++) {
      for (const slotType of OTHER_SLOTS) {
        const pool = library.filter((m) => (m.mealTypes || []).includes(slotType));
        const excludeIds = new Set();
        const prevId = prevMealId(day, slotType);
        if (prevId) excludeIds.add(prevId);
        const dayMealsSoFar = Object.values(days[day - 1].slots)
          .map((s) => (s && s.mealId ? mealsById[s.mealId] : null))
          .filter(Boolean);
        const meal = pickMeal(pool, day, dayMealsSoFar, { excludeIds });
        place(day, slotType, meal);
      }
    }

    return { startDate, days };
  }

  MP.Generator = { generatePlan, weekendRuns, weekdayOf, isoToday };
})();
