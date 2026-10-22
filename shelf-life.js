// Shelf-life / freeze / move-meal warning logic. Walks the 14-day plan and
// flags slots where a raw ingredient or cooked leftover would be past its
// safe window. Shop day = start of each week (day 1 and day 8); cooked day
// = whatever day a dinner is first scheduled, per SPEC.md.
(function (root) {
  "use strict";
  const MP = (root.MP = root.MP || {});

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
    if (MP.isBatch(meal)) {
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

  /**
   * True if the meal's most perishable raw ingredient is still within its
   * fridge window on dayNum, counting from that week's shop day. True when
   * the meal has no tracked perishable (pantry/tinned/spices).
   */
  function rawSafeOn(meal, dayNum, shelfData) {
    const cat = worstRawCategory(meal, shelfData);
    if (!cat) return true;
    return buildWarning(dayNum, shopDayFor(dayNum), cat, shelfData) === null;
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
        const effMeal = MP.effectiveMeal(meal, slot.variantId, slot.subs);
        const w = evaluateSlot(day.day, effMeal, occ, shelfData);
        if (w) warnings[`${day.day}-${slotType}`] = w;
      });
    });
    return warnings;
  }

  const DAY = 86400000;
  const isoMs = (iso) => Date.parse(iso + "T00:00:00Z");
  const addDays = (iso, n) => new Date(isoMs(iso) + n * DAY).toISOString().slice(0, 10);

  /** True only for a real calendar date written YYYY-MM-DD (rejects 2026-02-30). */
  function isIsoDate(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(isoMs(s)) && addDays(s, 0) === s;
  }

  // Item name -> category: exact key first, then normalizeKey on both sides
  // (normalizeKey strips plural s, so "carrots" must match on the normalized form too).
  let normCat = null;
  function categoryFor(name) {
    const norm = MP.ShoppingList.normalizeKey;
    if (!normCat) normCat = Object.fromEntries(Object.entries(INGREDIENT_CATEGORY).map(([k, v]) => [norm(k), v]));
    return normCat[norm(name)] || null;
  }

  const STORAGES = ["fridge", "freezer", "cupboard"];

  /** Calendar-month add, day clamped to the target month's end (31 Jan + 1 -> 28/29 Feb). */
  function addMonths(iso, n) {
    const d = new Date(isoMs(iso));
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString().slice(0, 10);
  }

  /** Where an item lives: entered `storage` wins, else the category default
   * (fridgeDays -> fridge, frozenMonths only -> freezer, ambient -> cupboard);
   * uncategorised -> null (never guessed). A bad stored value counts as blank. */
  function storageFor(item, shelfData) {
    if (!item) return null;
    if (STORAGES.includes(item.storage)) return { storage: item.storage, basis: "entered" };
    const info = (shelfData || cache || {})[categoryFor(item.name)];
    if (!info) return null;
    if (info.fridgeDays != null) return { storage: "fridge", basis: "estimate" };
    if (info.frozenMonths != null) return { storage: "freezer", basis: "estimate" };
    if (info.ambient) return { storage: "cupboard", basis: "estimate" };
    return null;
  }

  /** Shelf-life estimate for an item with no entered date: most recent shop day
   * on or before today + the category's fridgeDays (frozenMonths months when it
   * lives in the freezer). Needs a plan; ambient or uncategorised items get
   * null (never guessed). */
  function estimateUseBy(item, plan, todayIso, shelfData) {
    if (!item || !plan || !isIsoDate(plan.startDate) || !isIsoDate(todayIso)) return null;
    const info = (shelfData || cache || {})[categoryFor(item.name)];
    if (!info || info.ambient) return null;
    const since = Math.floor((isoMs(todayIso) - isoMs(plan.startDate)) / DAY);
    if (since < 0) return null;
    const shopDay = addDays(plan.startDate, since >= 7 ? 7 : 0);
    const st = storageFor(item, shelfData);
    if (st && st.storage === "freezer") return info.frozenMonths != null ? addMonths(shopDay, info.frozenMonths) : null;
    if (info.fridgeDays == null) return null;
    return addDays(shopDay, info.fridgeDays);
  }

  /** A cooked-leftover record's eat-by: cooked date + fridgeDays, or + frozenMonths if in the freezer. */
  function leftoverEatBy(record, shelfData) {
    const info = (shelfData || cache || {}).cooked_leftovers;
    const day = record && typeof record.cookedAt === "string" ? record.cookedAt.slice(0, 10) : "";
    if (!info || !isIsoDate(day)) return null;
    if (record.storage === "freezer") return info.frozenMonths != null ? addMonths(day, info.frozenMonths) : null;
    return info.fridgeDays != null ? addDays(day, info.fridgeDays) : null;
  }

  /** Open leftovers still in date, soonest first. lastDay = a fridge portion due today. */
  function leftoverView(records, todayIso, shelfData) {
    const out = [];
    for (const r of Array.isArray(records) ? records : []) {
      if (!r || !(r.portionsLeft > 0)) continue;
      const eatBy = leftoverEatBy(r, shelfData);
      if (!eatBy) continue;
      const daysLeft = Math.round((isoMs(eatBy) - isoMs(todayIso)) / DAY);
      if (daysLeft < 0) continue;
      const storage = r.storage === "freezer" ? "freezer" : "fridge";
      out.push({ id: r.id, mealId: r.mealId, name: r.name, portionsLeft: r.portionsLeft, storage, cookedAt: r.cookedAt, eatBy, basis: "estimate", daysLeft, lastDay: storage === "fridge" && daysLeft === 0 });
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft);
  }

  /** Pantry items whose use-by (entered, else estimated) falls within `days` of
   * today, overdue included, soonest first. A malformed stored useBy counts as blank. */
  function expiringItems(items, plan, todayIso, days, shelfData) {
    const out = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item.name !== "string") continue;
      const entered = isIsoDate(item.useBy);
      const useBy = entered ? item.useBy : estimateUseBy(item, plan, todayIso, shelfData);
      if (!useBy) continue;
      const daysLeft = Math.round((isoMs(useBy) - isoMs(todayIso)) / DAY);
      if (daysLeft > days) continue;
      out.push({ name: item.name, qty: item.qty ?? null, useBy, basis: entered ? "entered" : "estimate", daysLeft });
    }
    return out.sort((a, b) => a.daysLeft - b.daysLeft);
  }

  MP.ShelfLife = { load, checkPlanWarnings, shopDayFor, rawSafeOn, INGREDIENT_CATEGORY, isIsoDate, estimateUseBy, expiringItems, storageFor, addMonths, leftoverEatBy, leftoverView, STORAGES };
})(typeof globalThis !== "undefined" ? globalThis : this);
