// Shelf-life / freeze / move-meal warning logic. Walks the 14-day plan and
// flags slots where a raw ingredient or cooked leftover would be past its
// safe window. Shop day = start of each week (day 1 and day 8); cooked day
// = whatever day a dinner is first scheduled, per SPEC.md.
window.MP = window.MP || {};

(function () {
  "use strict";

  // Which shelf-life.json category each ingredient key falls under.
  // Ingredients not listed here have no perishability concern tracked
  // (pantry/tinned/spices) and never trigger a warning.
  const INGREDIENT_CATEGORY = {
    chicken_breast: "raw_chicken",
    chicken_roast: "raw_chicken",
    leftover_chicken: "cooked_leftovers",
    beef_mince: "raw_beef_mince",
    salmon: "raw_fish",
    tuna_tin: "tinned",
    chorizo: "chorizo_opened",
    carrots: "fresh_vegetables",
    peppers: "fresh_vegetables",
    onion: "fresh_vegetables",
    potatoes: "fresh_vegetables",
    broccoli: "fresh_vegetables",
    frozen_veg: "frozen_vegetables",
    milk: "dairy",
    greek_yogurt: "dairy",
    cheese: "dairy",
    white_bread: "bread",
    tortillas: "bread",
    egg: "eggs",
  };

  let cache = null;
  async function load() {
    if (cache) return cache;
    cache = await fetch("shelf-life.json").then((r) => r.json());
    return cache;
  }

  function shopDayFor(dayNum) {
    return dayNum <= 7 ? 1 : 8;
  }

  function buildOccurrences(plan) {
    const occ = {};
    plan.days.forEach((day) => {
      Object.values(day.slots).forEach((slot) => {
        if (!slot || !slot.mealId) return;
        (occ[slot.mealId] = occ[slot.mealId] || []).push(day.day);
      });
    });
    Object.values(occ).forEach((arr) => arr.sort((a, b) => a - b));
    return occ;
  }

  /** Latest run-start day <= uptoDay, where a run-start has no occurrence the day before. */
  function findCookedDay(days, uptoDay) {
    const starts = days.filter((d) => !days.includes(d - 1) && d <= uptoDay);
    return starts.length ? Math.max(...starts) : null;
  }

  function worstRawCategory(meal, shelfData) {
    let worst = null;
    for (const ing of meal.ingredients || []) {
      const cat = INGREDIENT_CATEGORY[ing.key];
      if (!cat) continue;
      const info = shelfData[cat];
      if (!info || info.ambient || info.fridgeDays == null) continue;
      if (!worst || info.fridgeDays < shelfData[worst].fridgeDays) worst = cat;
    }
    return worst;
  }

  function buildWarning(dayNum, anchorDay, category, shelfData) {
    const info = shelfData[category];
    if (!info || info.ambient || info.fridgeDays == null) return null;
    const lastSafe = anchorDay + info.fridgeDays - 1;
    if (dayNum <= lastSafe) return null;
    const isCooked = category === "cooked_leftovers";
    const message = isCooked
      ? `⚠ freeze this after cooking (cooked day ${anchorDay}, best within ${info.fridgeDays} days)`
      : `⚠ move this meal earlier — ${info.label.toLowerCase()} bought day ${anchorDay} may spoil by day ${lastSafe}`;
    return { message, moveToDay: Math.max(1, lastSafe), category };
  }

  function evaluateSlot(dayNum, meal, occ, shelfData) {
    if (meal.leftoverOf) {
      const parentDays = occ[meal.leftoverOf] || [];
      const cookedDay = findCookedDay(parentDays, dayNum);
      if (cookedDay == null) return null;
      return buildWarning(dayNum, cookedDay, "cooked_leftovers", shelfData);
    }
    if (meal.batchCook) {
      const ownDays = occ[meal.id] || [];
      const cookedDay = findCookedDay(ownDays, dayNum);
      if (cookedDay != null && dayNum > cookedDay) {
        return buildWarning(dayNum, cookedDay, "cooked_leftovers", shelfData);
      }
    }
    const rawCat = worstRawCategory(meal, shelfData);
    if (!rawCat) return null;
    return buildWarning(dayNum, shopDayFor(dayNum), rawCat, shelfData);
  }

  /** Returns { "day-slotType": {message, moveToDay, category} } for the whole plan. */
  function checkPlanWarnings(plan, mealsById, shelfData) {
    const occ = buildOccurrences(plan);
    const warnings = {};
    plan.days.forEach((day) => {
      Object.entries(day.slots).forEach(([slotType, slot]) => {
        if (!slot || !slot.mealId) return;
        const meal = mealsById[slot.mealId];
        if (!meal) return;
        const w = evaluateSlot(day.day, meal, occ, shelfData);
        if (w) warnings[`${day.day}-${slotType}`] = w;
      });
    });
    return warnings;
  }

  MP.ShelfLife = { load, checkPlanWarnings, shopDayFor };
})();
