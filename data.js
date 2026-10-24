// Shared data layer: localStorage-backed meal library, esc() helper, small utils.
(function (root) {
  "use strict";
  const MP = (root.MP = root.MP || {});

  const LS_LIBRARY = "mp_library";
  const LS_LIBRARY_STAMP = "mp_library_updated_at";
  const LS_THEME = "mp_theme";
  const SS_DISMISSED = "mp_dismissed_discover";
  const LS_SAVED_LATER = "mp_saved_later";

  /** Escape untrusted text before innerHTML interpolation (TheMealDB strings). */
  function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /** Display text for a pantry/ad-hoc qty in either form.
   *  string -> itself; {value, unit, raw} -> raw (falls back to "value unit"
   *  if raw is missing); anything else -> "". */
  function qtyText(qty) {
    if (typeof qty === "string") return qty;
    if (qty && typeof qty === "object") {
      if (qty.raw) return qty.raw;
      if (typeof qty.value === "number" && qty.unit) return `${qty.value} ${qty.unit}`;
    }
    return "";
  }

  function labelize(key) {
    return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function loadSeedMeals() {
    const res = await fetch("meals.json");
    return res.json();
  }

  /** Normalised cooking method: status "accepted" | "drafted" | "none", steps [{text, minutes|null}].
   *  Anything malformed (non-array, empty, non-string text) reads as none. */
  function methodOf(meal) {
    const steps = ((meal && Array.isArray(meal.method)) ? meal.method : [])
      .filter((s) => s && typeof s.text === "string" && s.text.trim())
      .map((s) => ({ text: s.text.trim(), minutes: Number.isInteger(s.minutes) && s.minutes > 0 ? s.minutes : null }));
    if (!steps.length) return { status: "none", steps };
    return { status: meal.methodStatus === "drafted" ? "drafted" : "accepted", steps };
  }

  /** Pure: copies a seed meal's method onto the library meal with the same id, only where that meal has none
   *  (never over an edited, accepted or assistant-drafted method). @returns {boolean} whether anything changed */
  function fillMethods(library, seed) {
    const byId = new Map(seed.map((m) => [m.id, m]));
    let changed = false;
    for (const m of library) {
      const s = byId.get(m.id);
      if (s && methodOf(m).status === "none" && methodOf(s).status !== "none") {
        m.method = s.method;
        m.methodStatus = s.methodStatus;
        changed = true;
      }
    }
    return changed;
  }

  /** Method steps as an <ol> (esc'd), or the plain instructions text when the meal has none. */
  function methodHtml(meal) {
    const { steps } = methodOf(meal);
    if (!steps.length) return `<p>${esc(meal.instructions || "")}</p>`;
    return `<ol class="method-list">${steps.map((s) =>
      `<li>${esc(s.text)}${s.minutes ? ` <span class="method-min">${s.minutes} min</span>` : ""}</li>`).join("")}</ol>`;
  }

  let methodsFilled = false;

  /** Liked library = seed meals + any user-added discover meals, persisted in localStorage. */
  async function getLibrary() {
    const stored = localStorage.getItem(LS_LIBRARY);
    if (stored) {
      const lib = JSON.parse(stored);
      if (!methodsFilled) {
        methodsFilled = true;
        try {
          // Not saveLibrary(): a stamp here would make this fill look like a newer edit than a real Hermes library.
          if (fillMethods(lib, await loadSeedMeals())) localStorage.setItem(LS_LIBRARY, JSON.stringify(lib));
        } catch (e) { /* offline: try again next page load */ methodsFilled = false; }
      }
      return lib;
    }
    const seed = await loadSeedMeals();
    // Bypass saveLibrary(): stamping the seed would make a fresh browser's
    // 14 defaults look newer than a real Hermes library and push over it.
    localStorage.setItem(LS_LIBRARY, JSON.stringify(seed));
    return seed;
  }

  function saveLibrary(meals) {
    localStorage.setItem(LS_LIBRARY, JSON.stringify(meals));
    localStorage.setItem(LS_LIBRARY_STAMP, new Date().toISOString());
    window.dispatchEvent(new Event("mp:library-saved"));
  }

  /** Overwrite the local library with a pulled remote one, stamping the
   *  REMOTE timestamp and firing no event — applying a pull must not look
   *  like a fresh local edit or it would push straight back. */
  function applyRemoteLibrary(meals, updatedAt) {
    localStorage.setItem(LS_LIBRARY, JSON.stringify(meals));
    localStorage.setItem(LS_LIBRARY_STAMP, updatedAt);
  }

  function libraryStamp() {
    return localStorage.getItem(LS_LIBRARY_STAMP);
  }

  function addToLibrary(meal) {
    const stored = JSON.parse(localStorage.getItem(LS_LIBRARY) || "[]");
    if (stored.some((m) => m.id === meal.id)) return stored;
    stored.push({ prepEffort: "quick", ...meal });
    saveLibrary(stored);
    if (MP.Prefs) MP.Prefs.bump(meal, "liked");
    return stored;
  }

  /** Replace the meal with this id, or append if it's new. @returns {Array} new library */
  function upsertMeal(meal) {
    const stored = JSON.parse(localStorage.getItem(LS_LIBRARY) || "[]");
    const idx = stored.findIndex((m) => m.id === meal.id);
    if (idx === -1) stored.push(meal);
    else stored[idx] = meal;
    saveLibrary(stored);
    return stored;
  }

  /** Remove by id. No-op (still returns the array) if the id isn't present. */
  function removeFromLibrary(mealId) {
    const stored = JSON.parse(localStorage.getItem(LS_LIBRARY) || "[]");
    const filtered = stored.filter((m) => m.id !== mealId);
    saveLibrary(filtered);
    return filtered;
  }

  const UNIT = /^(g|kg|ml|l|tbsp|tsp|slices?|cans?|tins?|packs?|cloves?|handfuls?|bunch(es)?|pinch(es)?|rashers?|fillets?)$/i;

  function slugify(label) {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return slug || "ingredient";
  }

  function snapKey(slug, knownKeys) {
    if (knownKeys.includes(slug)) return slug;
    const noS = slug.replace(/s$/, "");
    if (knownKeys.includes(noS)) return noS;
    if (knownKeys.includes(slug + "s")) return slug + "s";
    let best = null;
    for (const key of knownKeys) {
      if (slug.includes(key) || key.includes(slug)) {
        if (!best || key.length > best.length) best = key;
      }
    }
    return best || slug;
  }

  /** Tag keys + pack-sizes `items` keys, `_`-prefixed dropped. tags/packItems are the files' `tags` / `items` objects. */
  function knownKeys(tags, packItems) {
    return [...new Set([...Object.keys(tags || {}), ...Object.keys(packItems || {})])].filter((k) => !k.startsWith("_"));
  }

  /** Draft ingredients with `key` set to the snapKey hit, or null when nothing matched. */
  function matchDraftIngredients(ingredients, keys) {
    return ingredients.map((ing) => {
      const slug = slugify(ing.name);
      const hit = snapKey(slug, keys);
      return { ...ing, key: keys.includes(hit) ? hit : null };
    });
  }

  /** A pending draft -> library meal. Never carries tags, cost or unreadable. resolutions: { [ingredientName]: key }. */
  function draftToMeal(draft, resolutions) {
    const res = resolutions || {};
    const meal = {
      id: `user-${slugify(draft.name)}-${Date.now().toString(36)}`,
      name: draft.name,
      description: draft.description || "",
      instructions: "",
      mealTypes: draft.mealTypes && draft.mealTypes.length ? draft.mealTypes : ["dinner"],
      servings: draft.servings || 1,
      prepEffort: draft.prepEffort || "quick",
      image: null,
      source: draft.source,
      fromDraft: draft.id,
      ingredients: draft.ingredients.map((ing) => ({ key: ing.key || res[ing.name] || slugify(ing.name), qty: ing.qty, label: ing.name })),
    };
    if (draft.sourceRef) meal.sourceRef = draft.sourceRef;
    if (draft.method && draft.method.length) { meal.method = draft.method; meal.methodStatus = "accepted"; }
    return meal;
  }

  /** Parse the ingredients textarea into meal-record ingredient objects.
   *  Never returns an entry with an empty `key` — data.js does
   *  `ing.key.replace(...)` and would throw on one.
   *  ponytail: substring matching, not a synonym table — "mince" will not
   *  find beef_mince. Upgrade path is an aliases list in pack-sizes.json,
   *  not a fuzzier matcher. */
  function parseIngredients(text, knownKeys) {
    const keys = knownKeys || [];
    return (text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        let label, qty;
        const dashMatch = line.match(/ — | - /);
        if (dashMatch) {
          const i = dashMatch.index;
          label = line.slice(0, i).trim();
          qty = line.slice(i + dashMatch[0].length).trim();
        } else {
          const tokens = line.split(/\s+/);
          let i = 0;
          if (/^\d/.test(tokens[0])) i = 1;
          if (i === 1 && UNIT.test(tokens[1] || "")) i = 2;
          qty = tokens.slice(0, i).join(" ");
          label = tokens.slice(i).join(" ");
          if (!label) {
            qty = "";
            label = line;
          }
        }
        const key = snapKey(slugify(label), keys);
        return { key, qty, label };
      });
  }

  /** Inverse of parseIngredients: one line per ingredient. */
  function ingredientsToText(ingredients) {
    return (ingredients || [])
      .map((ing) => {
        const label = ing.label || labelize(ing.key);
        return ing.qty ? `${label} — ${ing.qty}` : label;
      })
      .join("\n");
  }

  /** variant|null within meal.variants, by id. Never throws on a meal with no `variants`. */
  function findVariant(meal, variantId) {
    if (!meal || !variantId || !Array.isArray(meal.variants)) return null;
    return meal.variants.find((v) => v.id === variantId) || null;
  }

  /** "" for the base variant (null/undefined/unknown id), else the variant's name. */
  function variantLabel(meal, variantId) {
    const v = findVariant(meal, variantId);
    return v ? v.name : "";
  }

  /** Merge a variant over its base meal, then apply any slot substitutions.
   *  Same object back (no allocation) for a null/undefined/unknown variantId
   *  and no subs, or a variant missing `ingredients` — a stale/bad variantId
   *  degrades silently to the base rather than throwing.
   *  Never mutates `meal`; always keeps `meal.id`. */
  function effectiveMeal(meal, variantId, subs) {
    if (!meal) return meal;
    let result = meal;
    if (variantId !== null && variantId !== undefined) {
      const variant = findVariant(meal, variantId);
      if (variant && Array.isArray(variant.ingredients)) {
        const { id, ...fields } = variant;
        result = { ...meal, ...fields };
      }
    }
    return applySubs(result, subs);
  }

  /** Apply slot substitutions to a recipe. Same object back (no allocation) for
   *  a missing/empty subs list. A sub whose `from` matches no ingredient `key`
   *  is a silent no-op — a stale sub degrades like a stale variantId rather
   *  than throwing. Never mutates `meal`; always keeps `meal.id`. */
  function applySubs(meal, subs) {
    if (!meal || !Array.isArray(subs) || !subs.length || !Array.isArray(meal.ingredients)) return meal;
    const ingredients = meal.ingredients.map((ing) => {
      const sub = subs.find((s) => s.from === ing.key);
      return sub ? { ...ing, key: sub.to, label: sub.label } : ing;
    });
    return { ...meal, ingredients };
  }

  /** "" when there are no subs, else "with <label>[, <label>...]". */
  function subsLabel(subs) {
    if (!Array.isArray(subs) || !subs.length) return "";
    return `with ${subs.map((s) => s.label).join(", ")}`;
  }

  /** True if this meal yields leftovers worth chaining: multi-serving and not
   *  itself a leftover child. Replaces the removed `batchCook` field. */
  function isBatch(meal) {
    return (meal.servings || 1) >= 2 && !meal.leftoverOf;
  }

  /** Days of the leftover chain the dinner on `day` belongs to (Phase 66), sorted; [day] when not in one.
   *  Linked = consecutive dinners sharing a batch root (the parent, or a child's `leftoverOf`). */
  function chainDays(days, mealsById, day) {
    const dinner = (d) => {
      const s = days[d - 1] && days[d - 1].slots && days[d - 1].slots.dinner;
      return s && s.mealId && !s.frozenFrom ? mealsById[s.mealId] : null;
    };
    const root = (m) => (m.leftoverOf || m.id);
    const linked = (a, b) => a && b && root(a) === root(b) && (a.leftoverOf ? mealsById[a.leftoverOf] : a) && isBatch(mealsById[root(a)] || a);
    const out = [day];
    for (let d = day - 1; d >= 1 && linked(dinner(d), dinner(d + 1)); d--) out.unshift(d);
    for (let d = day + 1; d <= days.length && linked(dinner(d - 1), dinner(d)); d++) out.push(d);
    return out;
  }

  /** Phase 63: why a re-flow body is bad, or null. */
  function reflowInputError(b) {
    if (typeof b !== "object" || b === null || Array.isArray(b)) return "expected an object";
    for (const k of ["skipped", "eatingOut"]) {
      const v = b[k];
      if (v !== undefined && !(Array.isArray(v) && v.every((s) => s && Number.isInteger(s.day) && s.day >= 1 && s.day <= 14 && ["breakfast", "lunch", "dinner", "snack"].includes(s.slot)))) return `${k} must be [{ day 1-14, slot }]`;
    }
    for (const s of b.eatingOut || []) {
      if (s.name !== undefined && !(typeof s.name === "string" && s.name.length <= 60)) return "eatingOut name must be a string of at most 60 chars";
      if (s.text !== undefined && !(typeof s.text === "string" && s.text.length <= 200)) return "eatingOut text must be a string of at most 200 chars";
      if (s.foodLogId !== undefined && !(typeof s.foodLogId === "string" && s.foodLogId.length <= 80)) return "eatingOut foodLogId must be a string";
    }
    if (b.ranOut !== undefined && !(Array.isArray(b.ranOut) && b.ranOut.every((s) => typeof s === "string" && s.trim()))) return "ranOut must be ingredient name strings";
    return null;
  }

  /** Phase 63: first plan day (1-based) a re-flow may touch: today's day, clamped to 1..15. Today stays re-plannable. */
  function reflowFromDay(startDate, todayIso) {
    if (!startDate) return 1;
    const d = Math.round((Date.parse(todayIso) - Date.parse(startDate)) / 86400000) + 1;
    return Math.min(Math.max(d, 1), 15);
  }

  /** Slot as the change log sees it: eating-out keeps its name/text, a meal its variant. */
  const slotRef = (s) => (s && s.eatingOut ? { eatingOut: true, ...(s.name ? { name: s.name } : {}), ...(s.text ? { text: s.text } : {}) } : s && s.mealId ? { mealId: s.mealId, ...(s.variantId ? { variantId: s.variantId } : {}) } : null);
  const SLOT_ORDER = ["breakfast", "lunch", "dinner", "snack"];
  /** Phase 81: eating-out slot from an input entry; a bare re-mark keeps the name/text already there. */
  function outSlot(e, prev) {
    const name = typeof e.name === "string" ? e.name.trim().slice(0, 60) : "", text = typeof e.text === "string" ? e.text.trim().slice(0, 200) : "";
    const keep = prev && !name && !text ? prev : null;
    const logId = typeof e.foodLogId === "string" && e.foodLogId ? e.foodLogId : prev && prev.foodLogId;
    return keep || { eatingOut: true, ...(name ? { name } : {}), ...(text ? { text } : {}), ...(logId ? { foodLogId: logId } : {}) };
  }
  function diffPlans(before, after) {
    const changes = [];
    after.days.forEach((d, i) => SLOT_ORDER.forEach((t) => {
      const b = before.days[i].slots[t], a = d.slots[t];
      if (JSON.stringify(slotRef(b)) !== JSON.stringify(slotRef(a))) changes.push({ day: d.day, slot: t, before: slotRef(b), after: slotRef(a) });
    }));
    return changes;
  }
  const heldAt = (plan, fromDay) => (d, t) => { const s = plan.days[d - 1] && plan.days[d - 1].slots[t]; return d < fromDay || !!(s && ((s.mealId && (s.locked || s.eatenAt)) || s.frozenFrom)); };

  /** Phase 81, pure: skip the meal at (day, slot) by pushing it to the same slot next day. Same-slot meals after it shift
   *  one day too (held slots stay put and are hopped over), the last falls off the plan; a leftover chain moves as a unit
   *  and is refused if it would fall off. Never touches the pantry. Returns { plan, changes, ignored }. */
  function pushSlot(plan, day, slot, mealsById, fromDay) {
    const held = heldAt(plan, fromDay), ignore = (reason) => ({ plan, changes: [], ignored: [{ day, slot, reason }] });
    const slotAt = (d) => plan.days[d - 1] && plan.days[d - 1].slots[slot];
    if (!slotAt(day) || held(day, slot)) return ignore("eaten, locked or past");
    const unit = slot === "dinner" ? chainDays(plan.days, mealsById, day) : [day];
    if (unit.some((d) => held(d, slot))) return ignore("part of the leftover chain is eaten or locked");
    const pos = [];
    for (let d = unit[0]; d <= plan.days.length; d++) if (!held(d, slot)) pos.push(d);
    const last = pos[pos.length - 1];
    if (unit.length > 1 && unit.includes(last)) return ignore("the leftover chain would fall off the plan");
    const days = plan.days.map((dd) => ({ ...dd, slots: { ...dd.slots } }));
    pos.forEach((d, i) => {
      const from = i ? slotAt(pos[i - 1]) : null;
      if (from) days[d - 1].slots[slot] = from; else delete days[d - 1].slots[slot];
    });
    const out = { ...plan, days };
    return { plan: out, changes: diffPlans(plan, out), ignored: [] };
  }

  /** Phase 81, pure: move the meal at `from` to the later, non-held slot `to`; the meal that was there is freed and
   *  `from` is re-flowed (reflowPlan), the placed meal stays. Batch cooks are refused (push or drop them). */
  function moveSlot(plan, from, to, mealsById, fromDay, generate) {
    const held = heldAt(plan, fromDay), ignore = (reason) => ({ plan, changes: [], ignored: [{ day: from.day, slot: from.slot, reason }] });
    const at = (p) => plan.days[p.day - 1] && plan.days[p.day - 1].slots[p.slot];
    const src = at(from);
    if (!src || !src.mealId || held(from.day, from.slot)) return ignore("eaten, locked or past");
    if (!at(to) && !(plan.days[to.day - 1] && SLOT_ORDER.includes(to.slot))) return ignore("no such slot");
    if (!(to.day > from.day || (to.day === from.day && SLOT_ORDER.indexOf(to.slot) > SLOT_ORDER.indexOf(from.slot)))) return ignore("target is not later");
    if (held(to.day, to.slot)) return ignore("target is eaten, locked or past");
    const meal = mealsById[src.mealId];
    if (meal && (isBatch(meal) || meal.leftoverOf)) return ignore("a batch cook can be pushed or dropped, not moved");
    const staged = { ...plan, days: plan.days.map((d) => ({ ...d, slots: { ...d.slots } })) };
    staged.days[to.day - 1].slots[to.slot] = { ...src, locked: true }; // locked so the re-flow keeps it
    const res = reflowPlan(staged, { skipped: [from] }, mealsById, fromDay, generate);
    const moved = { ...src }; // the moved meal is not locked by the move itself
    res.plan.days[to.day - 1].slots[to.slot] = moved;
    return { plan: res.plan, changes: diffPlans(plan, res.plan), ignored: res.ignored };
  }

  /** Phase 63, pure: re-plan only the freed slots of `plan`. Everything else (past days, eaten, locked, untouched
   *  slots) is passed to `generate(locked, ranOutKeys, avoidIds)` as locked, so it comes back identical. A skipped batch cook frees
   *  its whole leftover chain; a slot whose meal uses a ran-out ingredient is freed too. Eating-out slots end up
   *  `{ eatingOut: true }` and stay that way on later re-flows.
   *  Returns { plan, changes: [{ day, slot, before, after }], ignored: [{ day, slot, reason }] }. */
  function reflowPlan(plan, input, mealsById, fromDay, generate) {
    const SLOTS = ["breakfast", "lunch", "dinner", "snack"];
    const id = (d, t) => d + ":" + t;
    const slotAt = (d, t) => plan.days[d - 1] && plan.days[d - 1].slots[t];
    const held = (d, t) => { const s = slotAt(d, t); return d < fromDay || !!(s && s.mealId && (s.locked || s.eatenAt)); };
    const free = new Set(), eatingOut = new Map(), ignored = [], avoid = new Set(); // avoid: meals the generator must not re-pick for this call
    plan.days.forEach((d) => SLOTS.forEach((t) => { if (d.slots[t] && d.slots[t].eatingOut) eatingOut.set(id(d.day, t), d.slots[t]); }));
    for (const e of input.eatingOut || []) {
      if (held(e.day, e.slot)) ignored.push({ day: e.day, slot: e.slot, reason: "eaten, locked or past" });
      else { eatingOut.set(id(e.day, e.slot), outSlot(e, eatingOut.get(id(e.day, e.slot)))); free.add(id(e.day, e.slot)); }
    }
    for (const e of input.skipped || []) {
      if (held(e.day, e.slot)) { ignored.push({ day: e.day, slot: e.slot, reason: "eaten, locked or past" }); continue; }
      free.add(id(e.day, e.slot));
      const meal = mealsById[(slotAt(e.day, e.slot) || {}).mealId];
      if (meal) avoid.add(meal.id);
      if (e.slot === "dinner" && meal && isBatch(meal)) chainDays(plan.days, mealsById, e.day).forEach((d) => { if (!held(d, "dinner")) { free.add(id(d, "dinner")); avoid.add(plan.days[d - 1].slots.dinner.mealId); } });
    }
    const ranOut = (input.ranOut || []).map((s) => MP.ShoppingList.normalizeKey(s));
    if (ranOut.length) plan.days.forEach((d) => SLOTS.forEach((t) => {
      const meal = mealsById[(d.slots[t] || {}).mealId];
      if (!held(d.day, t) && meal && (meal.ingredients || []).some((i) => ranOut.includes(MP.ShoppingList.normalizeKey(i.key)))) { free.add(id(d.day, t)); avoid.add(meal.id); }
    }));
    const locked = {};
    plan.days.forEach((d) => SLOTS.forEach((t) => { if (d.slots[t] && d.slots[t].mealId && !free.has(id(d.day, t))) (locked[d.day] = locked[d.day] || {})[t] = d.slots[t]; }));
    const gen = generate(locked, ranOut, [...avoid]);
    const days = plan.days.map((d) => {
      const slots = { ...d.slots };
      for (const t of SLOTS) {
        const next = eatingOut.has(id(d.day, t)) ? eatingOut.get(id(d.day, t)) : free.has(id(d.day, t)) ? gen.days[d.day - 1].slots[t] : d.slots[t];
        if (next) slots[t] = next; else delete slots[t];
      }
      return { ...d, slots };
    });
    const out = { ...plan, days };
    return { plan: out, changes: diffPlans(plan, out), ignored };
  }

  /** Phase 68, pure: roll the 14-day window forward to todayIso. Kept days shift down and keep their slots; the
   *  appended days come from `generate(locked, startDate)` with every kept slot locked. Shift >= 14 is a fresh plan.
   *  Returns { plan, shift } or null when startDate is not in the past. */
  function rollPlan(plan, todayIso, generate) {
    if (!plan || !plan.startDate || !Array.isArray(plan.days)) return null;
    const shift = Math.round((Date.parse(todayIso) - Date.parse(plan.startDate)) / 86400000);
    if (!(shift > 0)) return null;
    const stamp = { shopAnchor: plan.shopAnchor || plan.startDate, rolledFrom: plan.startDate, rolledAt: new Date().toISOString() };
    if (shift >= 14) return { plan: { ...generate({}, todayIso), ...stamp }, shift };
    const SLOTS = ["breakfast", "lunch", "dinner", "snack"];
    const kept = plan.days.slice(shift).map((d, i) => ({
      ...d, day: i + 1,
      slots: Object.fromEntries(Object.entries(d.slots).map(([t, sl]) => [t, sl && Number.isInteger(sl.frozenFrom) ? { ...sl, frozenFrom: Math.min(sl.frozenFrom - shift, sl.frozenFrom - shift < 1 ? -1 : Infinity) } : sl])),
    }));
    const locked = {};
    kept.forEach((d) => SLOTS.forEach((t) => { if (d.slots[t] && d.slots[t].mealId) (locked[d.day] = locked[d.day] || {})[t] = d.slots[t]; }));
    const gen = generate(locked, todayIso);
    const days = kept.concat(gen.days.slice(kept.length).map((d, i) => ({ ...d, day: kept.length + i + 1 })));
    return { plan: { ...plan, startDate: todayIso, days, ...stamp }, shift };
  }

  /** Cook day of a frozen portion's parent, or null. Trusts `frozenFrom` only while that
   *  earlier day's dinner is still the same meal (Phase 59); otherwise it is a plain slot. */
  function frozenParentDay(plan, dayNum, slot) {
    const from = slot && slot.frozenFrom;
    if (!Number.isInteger(from) || from >= dayNum) return null;
    if (from < 1) return from; // Phase 68: parent cooked before the rolled window; rollPlan keeps it <= -1 so it stays truthy
    const parent = plan && plan.days && plan.days[from - 1] && plan.days[from - 1].slots.dinner;
    return parent && parent.mealId === slot.mealId ? from : null;
  }

  /** First library meal with a confusably similar name, or null. */
  function findSimilarName(meals, name, ignoreId) {
    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = norm(name);
    if (!target) return null;
    for (const meal of meals) {
      if (meal.id === ignoreId) continue;
      const other = norm(meal.name);
      if (!other) continue;
      if (target === other) return meal;
      const shorter = target.length <= other.length ? target : other;
      const longer = target.length <= other.length ? other : target;
      if (shorter.length >= 4 && longer.includes(shorter)) return meal;
    }
    return null;
  }

  /**
   * Case-insensitive substring match over name, mealTypes, and ingredient
   * keys/labels. Blank/whitespace query returns the array unfiltered.
   */
  function filterMeals(meals, query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return meals;
    return meals.filter((meal) => {
      const parts = [meal.name, ...(meal.mealTypes || [])];
      for (const ing of meal.ingredients || []) {
        parts.push(ing.key.replace(/_/g, " "));
        if (ing.label) parts.push(ing.label);
      }
      return parts.join(" ").toLowerCase().includes(q);
    });
  }

  function getDismissed() {
    return new Set(JSON.parse(sessionStorage.getItem(SS_DISMISSED) || "[]"));
  }

  function dismiss(mealId, name) {
    const set = getDismissed();
    set.add(mealId);
    sessionStorage.setItem(SS_DISMISSED, JSON.stringify([...set]));
    if (MP.Prefs) MP.Prefs.bump({ id: mealId, name }, "dismissed");
  }

  /** "Save for later" pile from the Discover fan deck — persisted separately
   *  from the liked library so a save isn't the same as adding to the plan. */
  function getSavedLater() {
    return JSON.parse(localStorage.getItem(LS_SAVED_LATER) || "[]");
  }

  function saveForLater(meal) {
    const stored = getSavedLater();
    if (stored.some((m) => m.id === meal.id)) return stored;
    stored.push(meal);
    localStorage.setItem(LS_SAVED_LATER, JSON.stringify(stored));
    if (MP.Prefs) MP.Prefs.bump(meal, "liked");
    return stored;
  }

  function removeSavedLater(mealId) {
    const stored = getSavedLater().filter((m) => m.id !== mealId);
    localStorage.setItem(LS_SAVED_LATER, JSON.stringify(stored));
    return stored;
  }

  function getTheme() {
    return localStorage.getItem(LS_THEME) || "dark";
  }

  function setTheme(theme) {
    localStorage.setItem(LS_THEME, theme);
    applyTheme(theme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  function initTheme() {
    applyTheme(getTheme());
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.addEventListener("click", () => {
        setTheme(getTheme() === "dark" ? "light" : "dark");
      });
    }
    const active = document.querySelector(".nav-links a.active");
    if (active) active.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  MP.esc = esc;
  MP.qtyText = qtyText;
  MP.labelize = labelize;
  MP.slugify = slugify;
  MP.knownKeys = knownKeys;
  MP.matchDraftIngredients = matchDraftIngredients;
  MP.draftToMeal = draftToMeal;
  MP.getLibrary = getLibrary;
  MP.saveLibrary = saveLibrary;
  MP.applyRemoteLibrary = applyRemoteLibrary;
  MP.libraryStamp = libraryStamp;
  MP.addToLibrary = addToLibrary;
  MP.upsertMeal = upsertMeal;
  MP.removeFromLibrary = removeFromLibrary;
  MP.findVariant = findVariant;
  MP.variantLabel = variantLabel;
  MP.effectiveMeal = effectiveMeal;
  MP.applySubs = applySubs;
  MP.subsLabel = subsLabel;
  /** Pure: daily routines always, gymDays only when today.gym. Shared by MP.Today (browser) and the Worker's /day. */
  MP.dueRoutines = function (meals, today) {
    return meals.filter((m) => m.routine && (m.routine.when === "daily" || (m.routine.when === "gymDays" && today.gym)))
      .sort((a, b) => a.routine.time.localeCompare(b.routine.time));
  };
  MP.isBatch = isBatch;
  MP.chainDays = chainDays;
  MP.reflowPlan = reflowPlan;
  MP.pushSlot = pushSlot;
  MP.moveSlot = moveSlot;
  MP.rollPlan = rollPlan;
  MP.reflowInputError = reflowInputError;
  MP.reflowFromDay = reflowFromDay;
  MP.frozenParentDay = frozenParentDay;
  MP.methodOf = methodOf;
  MP.methodHtml = methodHtml;
  MP.fillMethods = fillMethods;
  MP.parseIngredients = parseIngredients;
  MP.ingredientsToText = ingredientsToText;
  MP.findSimilarName = findSimilarName;
  MP.filterMeals = filterMeals;
  MP.getDismissed = getDismissed;
  MP.dismiss = dismiss;
  MP.getSavedLater = getSavedLater;
  MP.saveForLater = saveForLater;
  MP.removeSavedLater = removeSavedLater;
  MP.initTheme = initTheme;
})(typeof globalThis !== "undefined" ? globalThis : this);
