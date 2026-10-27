// Phase 106: Eaten, by nutrient. Display-only: reads mp_eatenLog, the local food log, cofid.json and food-log.json itemGrams.
// Planned-meal amounts are estimates (ingredient qty x CoFID); an absent nutrient is unknown, never 0. Feeds nothing else.
(function (root) {
  "use strict";
  const MP = (root.MP = root.MP || {});

  // [key, label, unit, isCap]; targets stay in nutrition-targets.json (caps live under `${key}_cap`).
  const ROWS = [
    ["energy_kcal", "Energy", "kcal", false], ["protein_g", "Protein", "g", false], ["carbohydrate_g", "Carbohydrate", "g", false],
    ["fat_g", "Fat", "g", false], ["sugars_g", "Sugars", "g", true], ["saturates_g", "Saturates", "g", true], ["fibre_g", "Fibre", "g", false],
    ["vitA_mcg", "Vitamin A", "mcg", false], ["vitC_mg", "Vitamin C", "mg", false], ["vitD_mcg", "Vitamin D", "mcg", false],
    ["vitB12_mcg", "Vitamin B12", "mcg", false], ["folate_mcg", "Folate", "mcg", false], ["calcium_mg", "Calcium", "mg", false],
    ["iron_mg", "Iron", "mg", false], ["zinc_mg", "Zinc", "mg", false], ["magnesium_mg", "Magnesium", "mg", false],
    ["potassium_mg", "Potassium", "mg", false], ["sodium_mg", "Sodium", "mg", true],
  ];
  const ESTIMATE_BASES = new Set(["cofid", "usda", "estimate"]);
  const num = (v) => typeof v === "number" && isFinite(v);

  /** Per serving: { per: {nutrient: {value, basis: "estimate"}}, share }. share = ingredients with grams and a CoFID food / all. */
  function mealAmounts(meal, cofid, itemGrams, parseQty, normalizeKey) {
    const ings = (meal && meal.ingredients) || [];
    const servings = meal && meal.servings > 0 ? meal.servings : 1;
    const sums = {};
    let used = 0;
    for (const ing of ings) {
      const q = parseQty(ing.qty);
      let grams = null;
      if (q && (q.unit === "g" || q.unit === "ml")) grams = q.value;
      else if (q && (q.unit === "each" || q.unit === "slices")) {
        const g = itemGrams && itemGrams[normalizeKey(ing.key)];
        if (num(g)) grams = q.value * g;
      }
      const m = cofid && cofid.map && cofid.map[ing.key];
      const food = m && cofid.foods && cofid.foods[m.default];
      if (grams === null || !food || !food.nutrients) continue;
      used++;
      for (const [k, v] of Object.entries(food.nutrients)) if (num(v)) sums[k] = (sums[k] || 0) + (grams / 100) * v;
    }
    const per = {};
    for (const [k, v] of Object.entries(sums)) per[k] = { value: v / servings, basis: "estimate" };
    return { per, share: ings.length ? used / ings.length : 0 };
  }

  /** ctx = { byId, cofid, itemGrams, parseQty, normalizeKey }. Planned entry (has mealId) = estimate x portion; else a measured food-log entry. */
  function entryAmounts(entry, ctx) {
    if (entry.mealId) {
      const meal = ctx.byId && ctx.byId[entry.mealId];
      if (!meal) return { per: {}, share: 0 };
      const a = mealAmounts(meal, ctx.cofid, ctx.itemGrams, ctx.parseQty, ctx.normalizeKey);
      if (num(entry.portion) && entry.portion > 0 && entry.portion !== 1) for (const k of Object.keys(a.per)) a.per[k].value *= entry.portion;
      return a;
    }
    const n = (entry && entry.nutrients) || {};
    const per = {};
    for (const [k, e] of Object.entries(n)) if (e && num(e.value)) per[k] = { value: e.value, basis: e.basis };
    if (!per.sodium_mg && per.salt_g) per.sodium_mg = { value: per.salt_g.value * 400, basis: per.salt_g.basis };
    return { per, share: ROWS.filter((r) => per[r[0]]).length / ROWS.length };
  }

  const targetOf = (targets, key) => (targets ? (num(targets[key]) ? targets[key] : targets[key + "_cap"]) : undefined);

  /** One day: rows [{key,label,unit,isCap,target,value|null,basis,unknownItems,over}]. */
  function rollUp(entries, ctx, rows) {
    const amounts = entries.map((e) => entryAmounts(e, ctx));
    const out = (rows || ROWS).map(([key, label, unit, isCap]) => {
      let value = null, est = false, have = 0;
      for (const a of amounts) {
        const p = a.per[key];
        if (!p) continue;
        have++;
        value = (value || 0) + p.value;
        if (ESTIMATE_BASES.has(p.basis)) est = true;
      }
      const target = targetOf(ctx.targets, key);
      return { key, label, unit, isCap, target, value, basis: est ? "estimate" : "measured", unknownItems: entries.length - have, over: !!(isCap && value !== null && target > 0 && value > target) };
    });
    const share = amounts.length ? amounts.reduce((s, a) => s + a.share, 0) / amounts.length : 0;
    return { rows: out, share, items: entries.length };
  }

  /** Daily average over logged days only. ctx.gymTargets applies to ctx.today alone. */
  function weekRollUp(entriesByDate, ctx, rows) {
    const dates = Object.keys(entriesByDate).sort();
    const loggedDays = dates.filter((d) => entriesByDate[d].length);
    const notLogged = dates.filter((d) => !entriesByDate[d].length);
    const days = loggedDays.map((d) => rollUp(entriesByDate[d], { ...ctx, targets: d === ctx.today && ctx.gymTargets ? ctx.gymTargets : ctx.targets }, rows));
    const out = (rows || ROWS).map(([key, label, unit, isCap], i) => {
      const vals = days.map((d) => d.rows[i]);
      const got = vals.filter((r) => r.value !== null);
      const value = got.length ? got.reduce((s, r) => s + r.value, 0) / days.length : null;
      const ts = vals.map((r) => r.target).filter(num);
      const target = ts.length ? ts.reduce((s, t) => s + t, 0) / ts.length : undefined;
      return { key, label, unit, isCap, target, value, basis: got.some((r) => r.basis === "estimate") ? "estimate" : "measured",
        unknownItems: vals.reduce((s, r) => s + r.unknownItems, 0), over: !!(isCap && value !== null && target > 0 && value > target) };
    });
    return { rows: out, loggedDays, notLogged, share: days.length ? days.reduce((s, d) => s + d.share, 0) / days.length : 0 };
  }

  MP.Eaten = { ROWS, mealAmounts, entryAmounts, rollUp, weekRollUp };

  // ---- page (eaten.html only) ----
  if (typeof document === "undefined" || !document.getElementById("eaten-root")) return;
  const esc = MP.esc;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
  let mode = "today", state = null;

  function eatenLog() {
    try { const l = JSON.parse(localStorage.getItem("mp_eatenLog")); return Array.isArray(l) ? l.filter((e) => e && typeof e === "object") : []; } catch (e) { return []; }
  }
  const dayOf = (iso) => { try { return fmt.format(new Date(iso)); } catch (e) { return ""; } };
  const fmtNum = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);

  function rowHtml(r) {
    const pct = r.target > 0 && r.value !== null ? Math.round((r.value / r.target) * 100) : null;
    const known = r.value !== null;
    const val = !known ? "unknown" : (r.unknownItems ? "at least " : "") + fmtNum(r.value) + " " + r.unit;
    const tgt = r.target > 0 ? `${r.isCap ? "max " : "of "}${fmtNum(r.target)} ${r.unit}` : "";
    const chip = !known ? "" : `<span class="eaten-chip ${r.basis}">${r.basis}</span>`;
    const note = known && r.unknownItems ? `<span class="muted eaten-note">${r.unknownItems} item${r.unknownItems === 1 ? "" : "s"} unknown</span>` : "";
    return `<li class="eaten-row${r.over ? " over" : ""}${known ? "" : " unknown"}" data-key="${esc(r.key)}">
      <div class="eaten-top"><strong>${esc(r.label)}</strong><span class="eaten-val">${esc(val)}</span>${chip}</div>
      <div class="eaten-bar"><i style="width:${pct === null ? 0 : Math.min(100, pct)}%"></i></div>
      <div class="eaten-sub muted">${esc(tgt)}${pct !== null ? ` · ${pct}%` : ""} ${note}</div></li>`;
  }

  function render() {
    const el = document.getElementById("eaten-root");
    if (!state) { el.textContent = "Loading…"; return; }
    const { ctx, today, dates, byDate, targets, gym } = state;
    const water = MP.Today.get().water, goal = state.waterGoal;
    const link = typeof state.healthUrl === "string" && /^https:\/\//.test(state.healthUrl) ? `<a class="btn-secondary" href="${esc(state.healthUrl)}" target="_blank" rel="noopener">Open health page</a>` : "";
    let res, head;
    if (mode === "today") {
      res = rollUp(byDate[today] || [], { ...ctx, targets: gym ? state.gymTargets : targets });
      head = res.items ? `~${Math.round(res.share * 100)}% of today's food had data (${res.items} item${res.items === 1 ? "" : "s"})` : "Nothing logged yet";
    } else {
      res = weekRollUp(Object.fromEntries(dates.map((d) => [d, byDate[d] || []])), { ...ctx, targets, gymTargets: gym ? state.gymTargets : null, today });
      head = res.loggedDays.length ? `Daily average over ${res.loggedDays.length} logged day${res.loggedDays.length === 1 ? "" : "s"} · ~${Math.round(res.share * 100)}% of food had data` : "Nothing logged yet";
    }
    const empty = mode === "today" ? !res.items : !res.loggedDays.length;
    el.innerHTML = `<div class="eaten-tabs"><button class="tab-btn${mode === "today" ? " active" : ""}" data-mode="today">Today</button>
        <button class="tab-btn${mode === "week" ? " active" : ""}" data-mode="week">Last 7 days</button>${link}</div>
      <p id="eaten-share" class="muted">${esc(head)}</p>
      ${mode === "week" && res.notLogged.length ? `<p class="muted eaten-nolog">Not logged: ${res.notLogged.map(esc).join(", ")}</p>` : ""}
      <p class="muted">Measured = from a label or food database. Estimate = ingredient amounts × UK CoFID; only ingredients with a weight and a CoFID match count (ml taken as g).</p>
      ${empty ? "" : `<ul class="eaten-list">${res.rows.map(rowHtml).join("")}</ul>`}
      <div class="week-summary eaten-water"><strong>Water</strong> ${mode === "today" ? `${water}${goal > 0 ? " / " + goal : ""} cups (not scored)` : "today only"}</div>`;
    el.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; render(); }));
  }

  async function init() {
    render();
    const get = (u) => fetch(u).then((r) => r.json()).catch(() => ({}));
    const [cofid, fl, targets0, counters] = await Promise.all([get("cofid.json"), get("food-log.json"), MP.Nutrition.load().then((c) => c.targets, () => ({})), get("counters.json")]);
    const library = await MP.getLibrary().catch(() => []);
    const today = fmt.format(new Date());
    const dates = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(today + "T00:00:00Z") - (6 - i) * 86400000).toISOString().slice(0, 10));
    const byDate = {};
    const add = (d, e) => { if (dates.includes(d)) (byDate[d] = byDate[d] || []).push(e); };
    eatenLog().forEach((e) => add(dayOf(e.eatenAt), e));
    MP.Sync.localFoodLog().filter((e) => e.kind !== "stock" && e.when).forEach((e) => add(dayOf(e.when), e));
    state = {
      ctx: { byId: Object.fromEntries(library.map((m) => [m.id, m])), cofid, itemGrams: fl.itemGrams || {}, parseQty: MP.ShoppingList.parseQty, normalizeKey: MP.ShoppingList.normalizeKey },
      today, dates, byDate, targets: targets0, gymTargets: MP.Nutrition.withGymDay(targets0), gym: MP.Today.get().gym,
      waterGoal: counters.waterGoal || 0, healthUrl: (targets0 || {}).healthUrl,
    };
    render();
  }
  init();
})(typeof globalThis !== "undefined" ? globalThis : this);
