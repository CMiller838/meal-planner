// Shopping list logic: aggregates a 2-week plan into per-shop-day ingredient
// lists, rounded to real pack sizes with a rough total cost. Pure module —
// no DOM, no localStorage. See .claude/specs/phase3_spec.md.
window.MP = window.MP || {};

(function () {
  "use strict";

  const SLOT_TYPES = ["breakfast", "lunch", "dinner", "snack"];
  const UNIT_MULT = { kg: ["g", 1000], l: ["ml", 1000] };

  let cache = null;
  async function load() {
    if (cache) return cache;
    cache = await fetch("pack-sizes.json").then((r) => r.json());
    return cache;
  }

  /**
   * ponytail: naive leading-number parse of a free-text qty string; the fix
   * for imprecise totals is filling in meals.json quantities, not a smarter
   * parser. Ranges take the lower bound (regex stops at the first number).
   */
  function parseQty(qtyText) {
    const text = (qtyText || "").trim();
    if (!text) return null;
    const m = text.match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|l|slices?|tins?|tbsp|tsp)?/i);
    if (!m) return null;
    let value = Number(m[1]);
    let unit = (m[2] || "each").toLowerCase().replace(/^slice$/, "slices").replace(/^tin$/, "tins");
    if (UNIT_MULT[unit]) {
      [unit, value] = [UNIT_MULT[unit][0], value * UNIT_MULT[unit][1]];
    }
    return { value, unit };
  }

  function packsFor(needed, item) {
    if (!item || !needed) return 1;
    if (needed.unit !== item.unit) return 1;
    return Math.max(1, Math.ceil(needed.value / item.packSize));
  }

  function isSkippedIngredient(ing) {
    return ing.key.startsWith("leftover_") || /leftover|from roast/i.test(ing.qty || "");
  }

  /** Dinner-slot batch dedupe: skip if same mealId as previous day's dinner and batchCook. */
  function purchaseOccurrences(plan, mealsById) {
    const occ = []; // { day, meal }
    plan.days.forEach((day, idx) => {
      SLOT_TYPES.forEach((slotType) => {
        const slot = day.slots[slotType];
        if (!slot || !slot.mealId) return;
        const meal = mealsById[slot.mealId];
        if (!meal) return;
        if (slotType === "dinner" && idx > 0) {
          const prevSlot = plan.days[idx - 1].slots.dinner;
          if (prevSlot && prevSlot.mealId === slot.mealId && meal.batchCook) return;
        }
        occ.push({ day: day.day, meal });
      });
    });
    return occ;
  }

  function buildLists(plan, mealsById, packData) {
    const lists = {
      1: { shopDay: 1, lines: [], staples: [], unpriced: [], total: 0 },
      8: { shopDay: 8, lines: [], staples: [], unpriced: [], total: 0 },
    };
    // shopDay -> key -> { parses: [{value,unit}|null], meals: Set, label }
    const groups = { 1: {}, 8: {} };

    purchaseOccurrences(plan, mealsById).forEach(({ day, meal }) => {
      const shopDay = MP.ShelfLife.shopDayFor(day);
      const group = groups[shopDay];
      (meal.ingredients || []).forEach((ing) => {
        if (isSkippedIngredient(ing)) return;
        const g = (group[ing.key] = group[ing.key] || { parses: [], meals: [], label: MP.labelize(ing.key) });
        g.parses.push(parseQty(ing.qty));
        if (!g.meals.includes(meal.name)) g.meals.push(meal.name);
      });
    });

    [1, 8].forEach((shopDay) => {
      const list = lists[shopDay];
      let total = 0;
      Object.entries(groups[shopDay]).forEach(([key, g]) => {
        const item = packData.items[key] || null;
        const sameUnit = g.parses.every((p) => p && p.unit === g.parses[0].unit);
        const needed = sameUnit && g.parses[0]
          ? { value: g.parses.reduce((s, p) => s + p.value, 0), unit: g.parses[0].unit }
          : null;
        const packs = packsFor(needed, item);
        const price = item ? item.price : null;
        const lineCost = price != null ? packs * price : 0;
        const line = {
          key,
          label: item && item.label ? item.label : g.label,
          needed,
          packSize: item ? item.packSize : null,
          unit: item ? item.unit : null,
          packs,
          price,
          lineCost,
          meals: g.meals,
        };
        if (!item) list.unpriced.push(line);
        else if (item.staple) list.staples.push(line);
        else {
          list.lines.push(line);
          total += lineCost;
        }
      });
      const byLabel = (a, b) => a.label.localeCompare(b.label);
      list.lines.sort(byLabel);
      list.staples.sort(byLabel);
      list.unpriced.sort(byLabel);
      list.total = Math.round(total * 100) / 100;
    });

    return lists;
  }

  MP.ShoppingList = { load, buildLists, parseQty, packsFor };
})();
