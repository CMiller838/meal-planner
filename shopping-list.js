// Shopping list logic: aggregates a 2-week plan into per-shop-day ingredient
// lists, rounded to real pack sizes with a rough total cost. Pure module —
// no DOM, no localStorage. See .claude/specs/phase3_spec.md.
(function (root) {
  "use strict";
  const MP = (root.MP = root.MP || {});

  const SLOT_TYPES = ["breakfast", "lunch", "dinner", "snack"];
  const UNIT_MULT = { kg: ["g", 1000], l: ["ml", 1000] };

  let cache = null;
  async function load() {
    if (cache) return cache;
    cache = await fetch("pack-sizes.json").then((r) => r.json());
    return cache;
  }

  let groupsCache = null;
  /** Memoised fetch of substitution-groups.json. Never throws; -> {} on failure. */
  async function loadGroups() {
    if (groupsCache) return groupsCache;
    groupsCache = await fetch("substitution-groups.json").then((r) => r.json()).catch(() => ({}));
    return groupsCache;
  }

  /** Flatten groups to a lookup: { [normalizedKey]: { groupId, members } }.
   *  First group wins on a duplicate key. {} for missing/invalid data. */
  function groupIndex(groupsData) {
    const idx = {};
    const groups = groupsData && Array.isArray(groupsData.groups) ? groupsData.groups : [];
    groups.forEach((g) => {
      const members = Array.isArray(g.members) ? g.members : [];
      if (members.length < 2) return;
      members.forEach((m) => {
        const key = normalizeKey(m.key);
        if (!(key in idx)) idx[key] = { groupId: g.id, members };
      });
    });
    return idx;
  }

  /**
   * ponytail: naive leading-number parse of a free-text qty string; the fix
   * for imprecise totals is filling in meals.json quantities, not a smarter
   * parser. Ranges take the lower bound (regex stops at the first number).
   * A structured {value, unit, raw} qty (Phase 30) skips the parse entirely.
   */
  function parseQty(qtyText) {
    if (qtyText && typeof qtyText === "object") {
      if (typeof qtyText.value !== "number" || !isFinite(qtyText.value) || typeof qtyText.unit !== "string") return null;
      let { value, unit } = qtyText;
      unit = unit.toLowerCase();
      if (UNIT_MULT[unit]) [unit, value] = [UNIT_MULT[unit][0], value * UNIT_MULT[unit][1]];
      return { value, unit };
    }
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
    if (needed.value <= 0) return 0; // pantry covers it all, whatever the pack unit
    if (needed.unit !== item.unit) return 1;
    return Math.max(1, Math.ceil(needed.value / item.packSize));
  }

  /** ponytail: exact match after normalization only — no synonyms, no plural
   * irregulars, no unit words ("tin of chopped tomatoes" won't match
   * chopped_tomatoes). Upgrade path is a small alias map in pack-sizes.json,
   * not a fuzzy-match dependency. */
  function normalizeKey(text) {
    return String(text || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .split("_")
      .map((w) => w.replace(/s$/, ""))
      .join("_");
  }

  function pantryIndex(pantry) {
    const items = pantry && Array.isArray(pantry.items) ? pantry.items : [];
    const idx = {};
    items.forEach((item) => {
      if (item.out) return; // Phase 39: ran out = absent for every reader
      idx[normalizeKey(item.name)] = item.qty || "";
    });
    return idx;
  }

  /** One ingredient on hand in sufficient quantity? Absent -> no.
   * Unparseable/unit-mismatched/amount-unknown -> yes (fallback: "present,
   * amount unknown"). Both parseable + unit-matched -> only enough if
   * stock.value >= need.value. */
  function hasEnough(ing, have) {
    const stock = have[normalizeKey(ing.key)];
    if (stock === undefined) return false;
    const need = parseQty(ing.qty);
    const stockQty = parseQty(stock);
    if (!need || !stockQty || stockQty.unit !== need.unit) return true;
    return stockQty.value >= need.value;
  }

  /** Count of a meal's ingredients on hand in sufficient quantity. */
  function pantryOverlap(meal, have) {
    return (meal.ingredients || []).filter((ing) => hasEnough(ing, have)).length;
  }

  function isSkippedIngredient(ing) {
    return ing.key.startsWith("leftover_") || /leftover|from roast/i.test(ing.qty || "");
  }

  const byUrgency = (a, b) => {
    const da = a.daysLeft ?? a.urgency?.daysLeft ?? null, db = b.daysLeft ?? b.urgency?.daysLeft ?? null;
    if (da !== db) return da === null ? 1 : db === null ? -1 : da - db;
    return (b.proteinGramsApprox ?? -1) - (a.proteinGramsApprox ?? -1);
  };
  const clampN = (n, def) => Math.min(20, Math.max(1, Number.isInteger(n) ? n : def));

  /** Library meals split by what the pantry covers: ready = nothing missing,
   * nearMiss = 1-2 missing. Skipped (leftover_) ingredients don't count, hard
   * exclusions apply. Soonest use-by among the pantry items used first, then protein. */
  function cookable(library, pantryItems, plan, todayIso, opts) {
    const o = opts || {};
    const items = (Array.isArray(pantryItems) ? pantryItems : []).filter((i) => i && typeof i.name === "string" && !i.out);
    const have = pantryIndex({ items });
    const itemByKey = Object.fromEntries(items.map((i) => [normalizeKey(i.name), i]));
    const n = clampN(o.n, 10);
    const ready = [], nearMiss = [];
    for (const meal of Array.isArray(library) ? library : []) {
      if (!meal || !MP.Exclusions.check(meal).ok) continue;
      const ings = (meal.ingredients || []).filter((ing) => !isSkippedIngredient(ing));
      if (!ings.length) continue;
      const missing = ings.filter((ing) => !hasEnough(ing, have)).map((ing) => ing.key);
      if (missing.length > 2) continue;
      let urgency = null;
      for (const ing of ings) {
        const item = itemByKey[normalizeKey(ing.key)];
        if (!item) continue;
        const entered = MP.ShelfLife.isIsoDate(item.useBy);
        const useBy = entered ? item.useBy : MP.ShelfLife.estimateUseBy(item, plan, todayIso, o.shelfData);
        if (!useBy) continue;
        const daysLeft = Math.round((Date.parse(useBy) - Date.parse(todayIso)) / 86400000);
        if (!urgency || daysLeft < urgency.daysLeft) urgency = { name: item.name, useBy, basis: entered ? "entered" : "estimate", daysLeft };
      }
      const protein = o.tags && o.targets ? MP.Nutrition.dayCoverage([meal], o.tags, o.targets).proteinGramsApprox : 0;
      (missing.length ? nearMiss : ready).push({ id: meal.id, name: meal.name, prepEffort: meal.prepEffort || null, proteinGramsApprox: protein, missing, urgency });
    }
    return { ready: ready.sort(byUrgency).slice(0, n), nearMiss: nearMiss.sort(byUrgency).slice(0, n) };
  }

  /** What to eat on a night you're not cooking: open leftovers (fridge and freezer),
   * freezer pantry items, and ready quick library meals; urgency then protein, capped at n. */
  function quickPicks(library, pantryItems, cooks, plan, todayIso, opts) {
    const o = opts || {};
    const SL = MP.ShelfLife;
    const byId = Object.fromEntries((Array.isArray(library) ? library : []).map((m) => [m.id, m]));
    const out = SL.leftoverView(cooks, todayIso, o.shelfData).map((l) => {
      const meal = byId[l.mealId];
      const protein = meal && o.tags && o.targets ? MP.Nutrition.dayCoverage([meal], o.tags, o.targets).proteinGramsApprox : null;
      return { kind: "leftover", id: l.id, mealId: l.mealId, name: l.name, portionsLeft: l.portionsLeft, storage: l.storage, eatBy: l.eatBy, basis: "estimate", daysLeft: l.daysLeft, proteinGramsApprox: protein };
    });
    for (const item of Array.isArray(pantryItems) ? pantryItems : []) {
      if (!item || typeof item.name !== "string" || item.out) continue;
      const st = SL.storageFor(item, o.shelfData);
      if (!st || st.storage !== "freezer") continue;
      const entered = SL.isIsoDate(item.useBy);
      const useBy = entered ? item.useBy : SL.estimateUseBy(item, plan, todayIso, o.shelfData);
      out.push({ kind: "frozen", name: item.name, qty: item.qty ?? null, useBy: useBy || null, basis: useBy ? (entered ? "entered" : "estimate") : null, daysLeft: useBy ? Math.round((Date.parse(useBy) - Date.parse(todayIso)) / 86400000) : null, storageBasis: st.basis });
    }
    const { ready } = cookable(library, pantryItems, plan, todayIso, { ...o, n: 20 });
    ready.filter((p) => p.prepEffort === "quick").forEach((p) => out.push({ kind: "meal", ...p }));
    return out.sort(byUrgency).slice(0, clampN(o.n, 5));
  }

  /** priceFor: exact items hit -> longest keyword substring -> categories.default.
   * Never null, never throws when categories is absent (pre-Phase-17 data). */
  function priceFor(key, packData) {
    const norm = normalizeKey(key);
    // items keys match meals.json's raw (unstripped-plural) keys — try that
    // before the normalized form, since normalizeKey's plural-stripping
    // (baked_beans -> baked_bean) would otherwise miss every existing entry.
    const item = packData.items[key] || packData.items[norm];
    if (item) return { packSize: item.packSize, unit: item.unit, price: item.price, estimated: false };
    if (!packData.categories) return null;
    let bestCat = null, bestLen = -1;
    Object.entries(packData.keywords || {}).forEach(([kw, cat]) => {
      if (norm.includes(kw) && kw.length > bestLen) {
        bestCat = cat;
        bestLen = kw.length;
      }
    });
    const cat = packData.categories[bestCat] || packData.categories.default;
    return { packSize: cat.packSize, unit: cat.unit, price: cat.price, estimated: true };
  }

  /** aisleFor: items[].aisle override -> longest aisle keyword in the normalized key -> "other".
   * Display grouping only; never throws, never null. */
  function aisleFor(key, packData) {
    const norm = normalizeKey(key);
    const item = packData && packData.items && (packData.items[key] || packData.items[norm]);
    if (item && item.aisle) return item.aisle;
    let best = "other", bestLen = 0;
    ((packData && packData.aisles) || []).forEach((a) => (a.keywords || []).forEach((kw) => {
      if (norm.includes(kw) && kw.length > bestLen) { best = a.id; bestLen = kw.length; }
    }));
    return best;
  }

  /** groupByAisle: lines -> [{ id, label, lines }] in store order, "Other" last, empty aisles skipped. */
  function groupByAisle(lines, packData) {
    const order = ((packData && packData.aisles) || []).map((a) => ({ id: a.id, label: a.label, lines: [] }));
    order.push({ id: "other", label: "Other", lines: [] });
    const byId = Object.fromEntries(order.map((g) => [g.id, g]));
    (lines || []).forEach((l) => (byId[aisleFor(l.key, packData)] || byId.other).lines.push(l));
    return order.filter((g) => g.lines.length);
  }

  function mealCost(meal, packData) {
    let total = 0, estimated = false;
    const keys = [], parts = {};
    (meal.ingredients || []).forEach((ing) => {
      if (isSkippedIngredient(ing)) return;
      keys.push(normalizeKey(ing.key));
      const resolved = priceFor(ing.key, packData);
      if (!resolved) return;
      if (resolved.estimated) estimated = true;
      const needed = parseQty(ing.qty);
      const part = packsFor(needed, resolved) * resolved.price;
      total += part;
      parts[normalizeKey(ing.key)] = (parts[normalizeKey(ing.key)] || 0) + part;
    });
    return { total: Math.round(total * 100) / 100, estimated, keys, parts };
  }

  function costTier(total, packData) {
    const tiers = packData && packData.costTiers;
    if (!tiers) return null;
    if (total <= tiers.cheap) return "cheap";
    if (total <= tiers.med) return "med";
    return "pricey";
  }

  function costBadgeHtml(meal, packData) {
    if (!packData || !(meal.ingredients || []).length) return "";
    const { total, estimated } = mealCost(meal, packData);
    if (total === 0) return "";
    const tier = costTier(total, packData);
    const cls = ["tag", "cost", tier, estimated ? "estimated" : ""].filter(Boolean).join(" ");
    const prefix = estimated ? "~£" : "£";
    return `<span class="${cls}">${prefix}${total.toFixed(2)}</span>`;
  }

  function costIndex(library, packData) {
    const idx = {};
    library.forEach((meal) => {
      const { total, keys, parts } = mealCost(meal, packData);
      idx[meal.id] = { cost: total, keys, parts };
    });
    return idx;
  }

  /** Dinner-slot batch dedupe: skip if same mealId as previous day's dinner and MP.isBatch. */
  function purchaseOccurrences(plan, mealsById) {
    const occ = []; // { day, meal }
    plan.days.forEach((day, idx) => {
      SLOT_TYPES.forEach((slotType) => {
        const slot = day.slots[slotType];
        if (!slot || !slot.mealId || slot.fromCook) return; // Phase 90a: eaten from an existing cook, buys nothing
        const meal = mealsById[slot.mealId];
        if (!meal) return;
        if (slot.leftover) return; // Phase 80: already cooked (Hermes-marked leftover), nothing to buy
        if (slotType === "dinner" && MP.frozenParentDay(plan, day.day, slot)) return; // frozen portion: cooked once, no new ingredients (Phase 59)
        if (slotType === "dinner" && idx > 0) {
          const prevSlot = plan.days[idx - 1].slots.dinner;
          if (prevSlot && prevSlot.mealId === slot.mealId && MP.isBatch(meal) && !MP.frozenParentDay(plan, day.day - 1, prevSlot)) return;
        }
        if (slotType === "lunch" && idx > 0) { // a batch lunch ("makes 2 lunches") on back-to-back days is one cook
          const prevLunch = plan.days[idx - 1].slots.lunch;
          if (prevLunch && prevLunch.mealId === slot.mealId && !prevLunch.fromCook && MP.isBatch(meal)) return;
        }
        occ.push({ day: day.day, meal: MP.effectiveMeal(meal, slot.variantId, slot.subs) });
      });
    });
    return occ;
  }

  /** Phase 90a: cost of `need` (a {value,unit} in bulk.unit) bought as bulk packs, plus normal packs for the remainder when that is
   *  cheaper (ponytail: greedy, bulk packs first, then the cheapest normal mix; enough for two pack sizes). */
  function bulkBuy(need, bulk, normal) {
    const whole = Math.floor(need / bulk.packSize);
    let best = { bulkPacks: Math.ceil(need / bulk.packSize), extra: 0 };
    best.cost = best.bulkPacks * bulk.price;
    if (whole >= 1 && normal) {
      const extra = Math.ceil((need - whole * bulk.packSize) / normal.packSize);
      const cost = whole * bulk.price + extra * normal.price;
      if (cost < best.cost) best = { bulkPacks: whole, extra, cost };
    }
    best.bought = best.bulkPacks * bulk.packSize + best.extra * (normal ? normal.packSize : 0);
    return best;
  }

  function buildLists(plan, mealsById, packData, pantry) {
    const have = pantryIndex(pantry);
    const offset = MP.ShelfLife.shopOffset(plan); // Phase 68: shop cycles are every 7 days from shopAnchor
    const shopDays = [...new Set(Array.from({ length: Math.max(14, (plan.days && plan.days.length) || 0) }, (_, i) => MP.ShelfLife.shopDayFor(i + 1, offset)))];
    const lists = {};
    // shopDay -> key -> { parses: [{value,unit}|null], meals: Set, label }
    const groups = {};
    shopDays.forEach((d) => {
      lists[d] = { shopDay: d, lines: [], staples: [], estimated: [], total: 0 };
      groups[d] = {};
    });

    const bulkInfo = {}; // shopDay -> key -> { coversDays, ownNeed }
    purchaseOccurrences(plan, mealsById).forEach(({ day, meal }) => {
      const shopDay = MP.ShelfLife.shopDayFor(day, offset);
      const group = groups[shopDay];
      (meal.ingredients || []).forEach((ing) => {
        if (isSkippedIngredient(ing)) return;
        const g = (group[ing.key] = group[ing.key] || { parses: [], meals: [], label: MP.labelize(ing.key) });
        g.parses.push(parseQty(ing.qty));
        if (!g.meals.includes(meal.name)) g.meals.push(meal.name);
      });
    });

    // Phase 90a: plan.bulk moves a key's later shops onto the bulk shop (only when every need is known in the bulk pack's unit)
    ((plan && plan.bulk) || []).forEach(({ key, shopDay }) => {
      const b = packData.items[key] && packData.items[key].bulk;
      if (!b || !groups[shopDay] || !groups[shopDay][key]) return;
      const later = shopDays.filter((d) => d > shopDay && groups[d][key]);
      const all = [shopDay, ...later].flatMap((d) => groups[d][key].parses);
      if (!all.length || !all.every((p) => p && p.unit === packData.items[key].unit)) return;
      const own = groups[shopDay][key].parses.reduce((a, p) => a + p.value, 0);
      later.forEach((d) => {
        const g = groups[d][key];
        groups[shopDay][key].parses.push(...g.parses);
        g.meals.forEach((m) => { if (!groups[shopDay][key].meals.includes(m)) groups[shopDay][key].meals.push(m); });
        delete groups[d][key];
      });
      (bulkInfo[shopDay] = bulkInfo[shopDay] || {})[key] = { coversDays: later, ownNeed: own };
    });

    shopDays.forEach((shopDay) => {
      const list = lists[shopDay];
      let total = 0;
      Object.entries(groups[shopDay]).forEach(([key, g]) => {
        const item = packData.items[key] || null;
        const resolved = priceFor(key, packData);
        const sameUnit = g.parses.every((p) => p && p.unit === g.parses[0].unit);
        let needed = sameUnit && g.parses[0]
          ? { value: g.parses.reduce((s, p) => s + p.value, 0), unit: g.parses[0].unit }
          : null;

        const raw = have[normalizeKey(key)];
        let pantryQty, onHand;
        if (raw !== undefined) {
          pantryQty = MP.qtyText(raw) || "(some)";
          onHand = parseQty(raw);
          if (needed && onHand && onHand.unit === needed.unit) {
            needed = { value: Math.max(0, needed.value - onHand.value), unit: needed.unit };
          } else {
            onHand = null;
          }
        }

        let packs = packsFor(needed, resolved);
        let price = resolved ? resolved.price : null;
        let lineCost = price != null ? packs * price : 0;
        let packSize = resolved ? resolved.packSize : null;
        const bi = bulkInfo[shopDay] && bulkInfo[shopDay][key];
        let bulkNote, extra;
        if (bi && needed && needed.value > 0) {
          const bb = bulkBuy(needed.value, item.bulk, resolved);
          packs = bb.bulkPacks; price = item.bulk.price; packSize = item.bulk.packSize; lineCost = bb.cost;
          if (bb.extra) extra = { packs: bb.extra, packSize: resolved.packSize, price: resolved.price };
          bulkNote = { freeze: Math.max(0, Math.round(bb.bought - bi.ownNeed)), coversDays: bi.coversDays };
        }
        const line = {
          key,
          label: item && item.label ? item.label : g.label,
          needed,
          packSize,
          unit: resolved ? resolved.unit : null,
          packs,
          price,
          lineCost,
          estimated: resolved ? resolved.estimated : false,
          meals: g.meals,
        };
        if (bulkNote) line.bulk = bulkNote;
        if (extra) line.extra = extra;
        if (pantryQty !== undefined) line.pantryQty = pantryQty;
        if (raw !== undefined) line.onHand = onHand;
        if (!resolved) list.estimated.push(line);
        else if (item && item.staple) list.staples.push(line);
        else {
          list.lines.push(line);
          total += lineCost;
          if (line.estimated) list.estimated.push(line);
        }
      });
      const byLabel = (a, b) => a.label.localeCompare(b.label);
      list.lines.sort(byLabel);
      list.staples.sort(byLabel);
      list.estimated.sort(byLabel);
      list.total = Math.round(total * 100) / 100;
    });

    return lists;
  }

  /** Phase 90a: bulk-able keys used on 2+ shops where one bulk buy beats the normal packs over the whole plan.
   *  saving = normal - (bulk - kept); kept = pro-rata £ value of what is left over after the plan. Keys already in plan.bulk are skipped. */
  function bulkOptions(plan, byId, packData, shelfData) {
    if (!plan || !Array.isArray(plan.days) || !packData || !packData.items) return [];
    const done = new Set(((plan.bulk) || []).map((b) => b.key));
    const bare = { ...plan, bulk: undefined };
    const lists = buildLists(bare, byId, packData, null);
    const shops = Object.keys(lists).map(Number).sort((a, b) => a - b);
    const cats = (MP.ShelfLife && MP.ShelfLife.INGREDIENT_CATEGORY) || {};
    const out = [];
    Object.entries(packData.items).forEach(([key, item]) => {
      const b = item.bulk;
      if (!b || done.has(key)) return;
      const info = (shelfData || {})[cats[key]];
      if (info && info.frozenMonths == null && info.fridgeDays != null) return; // fridge-only: does not keep
      const lines = shops.map((d) => [d, lists[d].lines.concat(lists[d].staples).find((l) => l.key === key)]).filter((x) => x[1]);
      if (lines.length < 2 || !lines.every(([, l]) => l.needed && l.needed.unit === item.unit && l.unit === item.unit)) return;
      const need = lines.reduce((a, [, l]) => a + l.needed.value, 0);
      const normal = lines.reduce((a, [, l]) => a + l.lineCost, 0);
      const bb = bulkBuy(need, b, item);
      const kept = Math.max(0, (bb.bought - need) / b.packSize * b.price);
      const r2 = (n) => Math.round(n * 100) / 100;
      const saving = r2(normal - (bb.cost - kept));
      if (saving > 0) out.push({ key, label: b.label || item.label || MP.labelize(key), shopDay: lines[0][0], normal: r2(normal), bulk: r2(bb.cost), saving, kept: r2(kept) });
    });
    return out.sort((a, b) => b.saving - a.saving);
  }

  // ponytail: both shop days subtract the same pantry amount, so buildLists
  // double-counts what's on hand across a fortnight. Upgrade path is
  // per-shop-day depletion in buildLists, if it ever matters.

  /** have/used are {value,unit} from parseQty, already unit-matched by the
   * caller. Returns a structured qty for have - used, clamped at 0. value
   * keeps 3dp (kills float residue across repeated partial eats); raw is
   * display text at <=1dp and always carries the unit, even at zero. */
  function remainingQty(have, used) {
    const value = Math.round(Math.max(0, have.value - used.value) * 1000) / 1000;
    const raw = `${value % 1 === 0 ? value : value.toFixed(1).replace(/\.0$/, "")}${have.unit}`;
    return { value, unit: have.unit, raw };
  }

  /**
   * The eat-flow decision table for one meal, pure and DOM/I-O free.
   * used: {[ingredientKey]: qtyString} — absent/empty means not consumed.
   * pantry: the {updatedAt, items} object from fetchItems("pantry"), or null.
   * Returns { rows, ops } — the caller applies ops and renders rows.
   */
  function eatPlan(meal, used, pantry) {
    const have = pantryIndex(pantry);
    const rows = [];
    const ops = [];
    (meal.ingredients || []).forEach((ing) => {
      const usedText = used[ing.key];
      if (!usedText) return; // not consumed — skip entirely

      const label = ing.label || MP.labelize(ing.key);
      const key = normalizeKey(ing.key);
      const haveText = have[key];

      if (haveText === undefined) {
        rows.push({ key: ing.key, label, used: usedText, have: null, after: null, shortfall: false, note: "not tracked" });
        return;
      }
      const usedQty = parseQty(usedText);
      const haveQty = parseQty(haveText);
      if (!usedQty) {
        rows.push({ key: ing.key, label, used: usedText, have: haveText, after: null, shortfall: false, note: `can't subtract from "${MP.qtyText(usedText)}"` });
        return;
      }
      if (!haveQty) {
        rows.push({ key: ing.key, label, used: usedText, have: haveText, after: null, shortfall: false, note: `can't subtract from "${MP.qtyText(haveText)}"` });
        return;
      }
      if (haveQty.unit !== usedQty.unit) {
        rows.push({ key: ing.key, label, used: usedText, have: haveText, after: null, shortfall: false, note: `units differ ("${MP.qtyText(haveText)}" vs "${MP.qtyText(usedText)}")` });
        return;
      }

      const after = remainingQty(haveQty, usedQty);
      ops.push({ list: "pantry", type: "sub", name: ing.key, qty: usedText });
      const shortfall = haveQty.value < usedQty.value;
      if (shortfall) {
        const remainder = remainingQty(usedQty, haveQty); // used - have
        ops.push({ list: "adhoc", type: "add", name: ing.key, qty: remainder });
      }
      rows.push({ key: ing.key, label, used: usedText, have: haveText, after, shortfall, note: null });
    });
    return { rows, ops };
  }

  /** Existing meals that use expiring pantry items. `keys` is [{ name, daysLeft }]
   * (expiringItems output); ranked by items used, then soonest useBy. Hard-excluded meals dropped. */
  function mealsUsing(keys, library) {
    const want = (keys || []).map((k) => ({ norm: normalizeKey(k.name), name: k.name, daysLeft: k.daysLeft }));
    const out = [];
    for (const meal of library || []) {
      if (!meal || !Array.isArray(meal.ingredients) || !MP.Exclusions.check(meal).ok) continue;
      const have = new Set(meal.ingredients.map((i) => normalizeKey(i.key)));
      const hit = want.filter((w) => have.has(w.norm));
      if (hit.length) out.push({ meal, hits: hit.map((h) => h.name), soonest: Math.min(...hit.map((h) => h.daysLeft)) });
    }
    return out
      .sort((a, b) => b.hits.length - a.hits.length || a.soonest - b.soonest)
      .map(({ meal, hits }) => ({ meal, hits }));
  }

  /** Phase 65: pantry items to cook first - expiring within the fortnight, soonest first; ran-out and freezer items dropped. */
  function useUpItems(pantryItems, plan, todayIso, shelfData) {
    const live = (Array.isArray(pantryItems) ? pantryItems : []).filter((i) => i && !i.out && i.storage !== "freezer");
    return MP.ShelfLife.expiringItems(live, plan, todayIso, 14, shelfData).map((x) => ({ name: x.name, useBy: x.useBy }));
  }

  /** Phase 53: scale a meal's lines to `portions`. Only a leading number is scaled (replaced in the original text);
   * anything parseQty can't read is returned unchanged with check:true. Structured qty scales `value`. */
  function scaleMeal(meal, portions) {
    const eff = MP.effectiveMeal ? MP.effectiveMeal(meal) : meal;
    const ratio = portions / (eff.servings || 1);
    const fmt = (n) => String(Math.round(n * 100) / 100);
    return (eff.ingredients || []).filter((ing) => !isSkippedIngredient(ing)).map((ing) => {
      const q = ing.qty;
      if (q && typeof q === "object" && parseQty(q)) {
        const scaled = { ...q, value: Math.round(q.value * ratio * 100) / 100 };
        return { key: ing.key, qty: q, scaled, check: false };
      }
      if (typeof q === "string" && parseQty(q)) {
        return { key: ing.key, qty: q, scaled: q.replace(/\d+(?:\.\d+)?/, (n) => fmt(Number(n) * ratio)), check: false };
      }
      return { key: ing.key, qty: q, scaled: q, check: true };
    });
  }

  /** Phase 53: split scaled lines into buy/covered with pantryOverlap's rule (absent -> buy; unparseable or
   * unit-mismatched stock -> covered). An unparseable need with stock present is covered. */
  function scaleShortfall(lines, pantry) {
    const have = pantryIndex(pantry);
    const buy = [], covered = [];
    lines.forEach((l) => {
      const stock = have[normalizeKey(l.key)];
      let ok = stock !== undefined;
      if (ok) {
        const need = parseQty(l.scaled), st = parseQty(stock);
        if (need && st && st.unit === need.unit) ok = st.value >= need.value;
      }
      (ok ? covered : buy).push(l);
    });
    return { buy, covered };
  }

  // Phase 55: the shared shopping list. Pure line logic; the Worker and hermes-sync.js both call it.
  const LINE_STATES = ["needed", "got", "skipped", "deleted"];
  const LINE_SOURCES = ["plan", "manual", "assistant", "ranout"];
  const SKEW_MS = 5 * 60 * 1000;
  const PRUNE_MS = 30 * 24 * 3600 * 1000;

  function lineId(startDate, shopDay, key) {
    return `p:${startDate}:${shopDay}:${normalizeKey(key)}`;
  }

  /** Tick id for a plan's shop day. Fixed plans keep lineId(startDate, ...); a rolling plan keys on the shop date so it survives a roll (Phase 68). */
  function planLineId(plan, shopDay, key) {
    if (!plan.shopAnchor) return lineId(plan.startDate, shopDay, key);
    const d = new Date(Date.parse(plan.startDate + "T00:00:00Z") + (shopDay - 1) * 864e5).toISOString().slice(0, 10);
    return lineId(d, 1, key);
  }

  /** Per-line last-write-wins: later updatedAt wins, a tie keeps current, a stamp >5 min ahead is clamped to now,
   *  non-needed lines older than 30 days are dropped. Never throws; malformed incoming lines are skipped.
   *  @returns {{lines: object[], changed: object[]}} changed = incoming lines that took effect. */
  function mergeLines(current, incoming, nowIso) {
    const now = Date.parse(nowIso);
    const byId = new Map((Array.isArray(current) ? current : []).map((l) => [l.id, l]));
    const changed = [];
    for (const raw of Array.isArray(incoming) ? incoming : []) {
      if (!raw || typeof raw.id !== "string" || !Number.isFinite(Date.parse(raw.updatedAt))) continue;
      const line = Date.parse(raw.updatedAt) > now + SKEW_MS ? { ...raw, updatedAt: nowIso } : raw;
      const cur = byId.get(line.id);
      if (cur && Date.parse(line.updatedAt) <= Date.parse(cur.updatedAt)) continue;
      byId.set(line.id, line);
      changed.push(line);
    }
    const lines = [...byId.values()].filter((l) => l.state === "needed" || now - Date.parse(l.updatedAt) <= PRUNE_MS);
    return { lines, changed };
  }

  /** The ad-hoc list as the old PUT /adhoc shape: needed extra (x:) lines only. */
  function adhocView(lines) {
    return (Array.isArray(lines) ? lines : []).filter((l) => l.id.startsWith("x:") && l.state === "needed")
      .map((l) => ({ name: l.label, ...(l.qty ? { qty: l.qty } : {}), source: l.source }));
  }

  /** Incoming lines for a whole-list ad-hoc PUT: new/changed names -> needed, needed lines missing from items -> deleted. */
  function adhocToLines(lines, items, source, nowIso) {
    const cur = new Map((Array.isArray(lines) ? lines : []).filter((l) => l.id.startsWith("x:")).map((l) => [l.id, l]));
    const out = [], seen = new Set();
    for (const it of Array.isArray(items) ? items : []) {
      const id = "x:" + normalizeKey(it.name);
      const src = LINE_SOURCES.includes(it.source) ? it.source : source;
      seen.add(id);
      const c = cur.get(id);
      const qty = it.qty ? { qty: it.qty } : {};
      if (c && c.state === "needed" && c.label === it.name && c.source === src && JSON.stringify(c.qty || null) === JSON.stringify(it.qty || null)) continue;
      out.push({ id, state: "needed", updatedAt: nowIso, source: src, label: it.name, ...qty });
    }
    for (const [id, c] of cur) if (c.state === "needed" && !seen.has(id)) out.push({ ...c, state: "deleted", updatedAt: nowIso });
    return out;
  }

  MP.ShoppingList = { bulkOptions, useUpItems, scaleMeal, scaleShortfall, mealsUsing, load, loadGroups, groupIndex, buildLists, parseQty, packsFor, normalizeKey, aisleFor, groupByAisle, lineId, planLineId, mergeLines, adhocView, adhocToLines, LINE_STATES, LINE_SOURCES, pantryIndex, pantryOverlap, hasEnough, isSkippedIngredient, cookable, quickPicks, remainingQty, eatPlan, priceFor, mealCost, costIndex, costTier, costBadgeHtml };
})(typeof globalThis !== "undefined" ? globalThis : this);
