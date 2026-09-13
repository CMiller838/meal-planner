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

  /** Chip definitions from prefs.vocab, or [] when absent/malformed. */
  function chipVocab(prefs) {
    const vocab = prefs && prefs.vocab;
    return (vocab && Array.isArray(vocab.chips)) ? vocab.chips : [];
  }

  /** True if `meal` satisfies ANY of the chip's keywords/tags/prepEffort criteria. */
  function chipHits(meal, chip, tags) {
    if (chip.keywords && chip.keywords.length) {
      const name = (meal.name || "").toLowerCase();
      const ingredients = meal.ingredients || [];
      if (chip.keywords.some((kw) => name.includes(kw) || ingredients.some((i) => i.key.includes(kw)))) return true;
    }
    if (chip.tags && chip.tags.length) {
      const ingredients = meal.ingredients || [];
      if (ingredients.some((i) => chip.tags.some((t) => tags[i.key] && tags[i.key][t] === "high"))) return true;
    }
    if (chip.prepEffort && effortOf(meal) === chip.prepEffort) return true;
    return false;
  }

  /** Ids in prefs.chips that exist in the vocab, split by kind. Unknown ids dropped. */
  function activeChips(prefs) {
    const ids = new Set((prefs && prefs.chips) || []);
    const vocab = chipVocab(prefs).filter((c) => ids.has(c.id));
    return {
      prefer: vocab.filter((c) => c.kind === "prefer"),
      avoid: vocab.filter((c) => c.kind === "avoid"),
    };
  }

  /**
   * Ordered candidates for one slot, best first. Layers, in order:
   *   1 nutrition (rankByGap)  2 chips  3 effort/busy  4 budget shortlist  5 recency
   * Layers 2-5 are stable reorders of layer 1 - none of them re-score nutrition.
   * Returns every meal in `pool` (minus exclusions); chips never filter.
   */
  function rankSlot(pool, dayNum, dayMealsSoFar, opts) {
    opts = opts || {};
    const { tags, targets, prefs, budget, halfKeys } = opts;
    const lastUsedDay = opts.lastUsedDay || {};
    const excludeIds = opts.excludeIds || new Set();
    let ranked = pool.filter((m) => !excludeIds.has(m.id));
    if (!ranked.length) ranked = pool.slice(); // too small a pool to honour the exclusion; repeat is unavoidable
    if (!ranked.length) return [];
    const gap = MP.Nutrition.dayCoverage(dayMealsSoFar, tags, targets);
    const gapNutrients = [...gap.missing, ...gap.partial];
    ranked = MP.Nutrition.rankByGap(ranked, gapNutrients, tags);

    const { prefer: preferChips, avoid: avoidChips } = activeChips(prefs);
    if (preferChips.length || avoidChips.length) {
      const prefer = [];
      const neither = [];
      const avoid = [];
      for (const m of ranked) {
        if (preferChips.some((c) => chipHits(m, c, tags))) prefer.push(m);
        else if (avoidChips.some((c) => chipHits(m, c, tags))) avoid.push(m);
        else neither.push(m);
      }
      ranked = prefer.concat(neither, avoid);
    }

    if (opts.prefer) {
      const matches = ranked.filter((m) => effortOf(m) === opts.prefer);
      const rest = ranked.filter((m) => effortOf(m) !== opts.prefer);
      ranked = matches.concat(rest);
    }
    const busyVocab = prefs && prefs.vocab && prefs.vocab.busy;
    if (busyVocab && prefs.busyDays && prefs.busyDays.includes(dayNum) && opts.prefer !== "batch") {
      const matches = ranked.filter((m) => effortOf(m) === busyVocab.preferEffort);
      const rest = ranked.filter((m) => effortOf(m) !== busyVocab.preferEffort);
      ranked = matches.concat(rest);
    }

    if (budget) {
      const half = dayNum <= 7 ? halfKeys.first : halfKeys.second;
      const shortlist = ranked.slice(0, budget.shortlistSize).filter((m) => budget.costIndex[m.id]);
      if (shortlist.length) {
        const scored = shortlist.map((m) => {
          const c = budget.costIndex[m.id];
          const overlap = c.keys.filter((k) => half.has(k)).length;
          return { m, score: c.cost - budget.reuseCredit * overlap };
        });
        const minScore = Math.min(...scored.map((s) => s.score));
        const winners = scored.filter((s) => Math.abs(s.score - minScore) < 1e-9).map((s) => s.m);
        const neverW = winners.filter((m) => !(m.id in lastUsedDay));
        const usedW = winners
          .filter((m) => m.id in lastUsedDay)
          .sort((a, b) => lastUsedDay[a.id] - lastUsedDay[b.id]);
        const head = neverW.concat(usedW);
        const headIds = new Set(head.map((m) => m.id));
        return head.concat(ranked.filter((m) => !headIds.has(m.id)));
      }
    }
    const never = ranked.filter((m) => !(m.id in lastUsedDay));
    const used = ranked
      .filter((m) => m.id in lastUsedDay)
      .sort((a, b) => lastUsedDay[a.id] - lastUsedDay[b.id]);
    return never.concat(used);
  }

  // ponytail: no plan-wide pantry depletion — two meals may both count the
  // last tin as in stock. Upgrade path is depletion tracking if it matters.
  /** Variant id whose ingredients best match `have`, or null for the base recipe. */
  function pickVariant(meal, have) {
    if (!meal.variants || !meal.variants.length) return null;
    if (!have || !Object.keys(have).length) return null;
    let bestId = null;
    let bestMissing = meal.ingredients.length - MP.ShoppingList.pantryOverlap(meal, have);
    meal.variants.forEach((v) => {
      const candidate = MP.effectiveMeal(meal, v.id);
      const missing = candidate.ingredients.length - MP.ShoppingList.pantryOverlap(candidate, have);
      if (missing < bestMissing) {
        bestMissing = missing;
        bestId = v.id;
      }
    });
    return bestId;
  }

  function generatePlan(library, tags, targets, shelfData, startDate, budget, have, prefs) {
    startDate = startDate || isoToday();
    have = have || {};
    prefs = prefs || {};
    const mealsById = Object.fromEntries(library.map((m) => [m.id, m]));
    const dinnerPool = library.filter((m) => (m.mealTypes || []).includes("dinner"));
    const days = Array.from({ length: 14 }, (_, i) => ({ day: i + 1, slots: {} }));
    const lastUsedDay = {};
    const halfKeys = { first: new Set(), second: new Set() };

    function place(day, slotType, meal, countsTowardBudget) {
      const variantId = meal ? pickVariant(meal, have) : null;
      days[day - 1].slots[slotType] = meal
        ? (variantId ? { mealId: meal.id, variantId } : { mealId: meal.id })
        : { mealId: null };
      if (meal) lastUsedDay[meal.id] = day;
      if (meal && budget && countsTowardBudget !== false) {
        const entry = budget.costIndex[meal.id];
        if (entry) {
          const half = day <= 7 ? halfKeys.first : halfKeys.second;
          entry.keys.forEach((k) => half.add(k));
        }
      }
    }

    function prevMealId(day, slotType) {
      if (day <= 1) return null;
      const slot = days[day - 2].slots[slotType];
      return slot ? slot.mealId : null;
    }

    const pickMeal = (pool, dayNum, dayMealsSoFar, opts) =>
      rankSlot(pool, dayNum, dayMealsSoFar, { ...opts, tags, targets, prefs, budget, halfKeys, lastUsedDay })[0] || null;

    const runs = weekendRuns(startDate).map((run) => {
      if (run.some((d) => !(prefs.busyDays || []).includes(d))) {
        const firstNonBusy = run.findIndex((d) => !(prefs.busyDays || []).includes(d));
        if (firstNonBusy > 0) return run.slice(firstNonBusy);
      }
      return run;
    });
    // ponytail: rotation only, no re-splitting of runs. A [busy, free, busy] run
    // cooks on day 2 and covers day 3; splitting to also cover day 1 needs a
    // second parent and isn't worth it until someone complains.
    const filled = new Set();

    for (const run of runs) {
      if (run.length < 2) continue;
      const d0 = run[0];
      const excludeIds = new Set();
      const prevId = prevMealId(d0, "dinner");
      if (prevId) excludeIds.add(prevId);
      const batchCandidates = dinnerPool.filter(MP.isBatch);
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
        place(day, "dinner", meal, i === 0);
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

    return { startDate, days, generatedAt: new Date().toISOString() };
  }

  MP.Generator = { generatePlan, rankSlot, weekendRuns, weekdayOf, isoToday, pickVariant };
})();
