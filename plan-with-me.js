// "Plan with me" setup screen: mp_planPrefs storage (shared with plan.js)
// plus the page controller for plan-with-me.html.
window.MP = window.MP || {};

(function () {
  "use strict";

  const KEY = "mp_planPrefs";

  /** Phase 120: `rolling` stays in the stored shape for old data but defaults false and nothing reads it. */
  function get(raw) {
    let parsed;
    try {
      parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch (e) {
      parsed = {};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
    const busyDays = Array.isArray(parsed.busyDays)
      ? [...new Set(parsed.busyDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 28))]
      : [];
    const chips = Array.isArray(parsed.chips) ? parsed.chips.filter((c) => typeof c === "string") : [];
    const budgetTarget = Number(parsed.budgetTarget);
    return { busyDays, chips, freezeBatches: parsed.freezeBatches !== false, repeatGap: cleanGap(parsed.repeatGap), rolling: parsed.rolling === true, timeCaps: cleanCaps(parsed.timeCaps), budgetTarget: (!raw && profileBudget()) || (isFinite(budgetTarget) && budgetTarget >= 0 ? budgetTarget : 0) };
  }

  /** Profile.md's budget (Phase 52) wins over the local slider while it is > 0. */
  function profileBudget() {
    const s = MP.Sync && MP.Sync.settings();
    return s && s.budgetTarget > 0 ? s.budgetTarget : 0;
  }

  function cleanGap(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 14 ? n : 0;
  }

  /** Phase 88: { "0".."6": minutes 5-240 }; anything else is dropped. */
  function cleanCaps(v) {
    const out = {};
    if (v && typeof v === "object" && !Array.isArray(v)) for (const k of Object.keys(v)) if (/^[0-6]$/.test(k) && Number.isInteger(v[k]) && v[k] >= 5 && v[k] <= 240) out[k] = v[k];
    return out;
  }

  function save(busyDays, chips, budgetTarget, freezeBatches, repeatGap, rolling, timeCaps) {
    const n = Number(budgetTarget);
    const record = {
      updatedAt: new Date().toISOString(),
      busyDays: [...busyDays].sort((a, b) => a - b),
      chips: [...chips],
      budgetTarget: isFinite(n) && n >= 0 ? n : 0,
      freezeBatches: freezeBatches !== false,
      repeatGap: cleanGap(repeatGap),
      rolling: rolling === true,
      timeCaps: cleanCaps(timeCaps),
    };
    localStorage.setItem(KEY, JSON.stringify(record));
    return record;
  }

  let vocabCache = null;
  function loadVocab() {
    if (vocabCache !== null) return vocabCache;
    vocabCache = fetch("plan-preferences.json")
      .then((r) => r.json())
      .catch(() => null);
    return vocabCache;
  }

  function noon(iso) {
    const d = new Date(String(iso) + "T12:00:00");
    return isNaN(d) ? new Date(new Date().toLocaleDateString("sv") + "T12:00:00") : d;
  }

  /** Phase 118a: nights 1..days (clamped 1..28) whose weekday (start + n-1) is in `weekdays` (0=Sun..6). Pure. */
  function busyFromWeekdays(startIso, days, weekdays) {
    const set = new Set(weekdays || []), n = Math.min(28, Math.max(1, Math.floor(Number(days)) || 14)), out = [];
    for (let i = 1; i <= n; i++) {
      const d = noon(startIso);
      d.setDate(d.getDate() + i - 1);
      if (set.has(d.getDay())) out.push(i);
    }
    return out;
  }

  /** Phase 118a: sorted unique weekdays of the given nights. Pure. */
  function weekdaysFromBusy(startIso, busyDays) {
    const out = new Set();
    for (const n of busyDays || []) {
      const d = noon(startIso);
      d.setDate(d.getDate() + n - 1);
      out.add(d.getDay());
    }
    return [...out].sort((a, b) => a - b);
  }

  MP.PlanPrefs = { KEY, get, save, loadVocab, profileBudget, busyFromWeekdays, weekdaysFromBusy };

  // ---- Page controller (no-ops when not on plan-with-me.html) ----
  const startEl = () => document.getElementById("start-date");
  if (!startEl()) return;

  let budgetTarget = 0;
  const PD = () => document.getElementById("plan-days");
  const planDays = () => { const n = Math.floor(Number(PD().value)); return n >= 1 && n <= 28 ? n : 14; }; // Phase 83: 1-28, junk = 14

  function fmt(iso, off) {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + off);
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  function setDays(n) { PD().value = String(Math.min(28, Math.max(1, n))); renderAll(); }

  function renderAll() {
    document.getElementById("nights-out").textContent = planDays();
    document.getElementById("wiz-range").textContent = `${fmt(startEl().value, 0)} to ${fmt(startEl().value, planDays() - 1)}`;
    document.querySelectorAll("[data-nights]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.nights) === planDays())));
  }

  const budgetLabel = (v) => (v > 0 ? `£${v} a week` : "No target");

  function renderBudget(planning) {
    const row = document.getElementById("budget-row");
    if (!planning || !planning.budgetTarget) { row.hidden = true; document.getElementById("budget-none").hidden = false; return; }
    row.hidden = false;
    const cfg = planning.budgetTarget, range = document.getElementById("budget-range"), label = document.getElementById("budget-label");
    range.min = 0; range.max = Math.max(cfg.max, budgetTarget); range.step = cfg.step; range.value = budgetTarget;
    label.textContent = budgetLabel(budgetTarget);
    const locked = profileBudget();
    if (locked) { // Profile.md's budget wins while it is > 0
      range.disabled = true; range.max = Math.max(range.max, locked); range.value = locked;
      label.textContent = `£${locked}/wk · set in Profile.md`;
      return;
    }
    range.addEventListener("input", () => { budgetTarget = Number(range.value); label.textContent = budgetLabel(budgetTarget); });
  }

  async function init() {
    if (MP.Sync) await MP.Sync.fetchSettings();
    const prefs = MP.Sync ? await MP.Sync.fetchPlanPrefs() : MP.PlanPrefs.get();
    budgetTarget = prefs.budgetTarget || 0;
    const se = startEl();
    se.value = se.min = new Date().toLocaleDateString("sv");
    renderAll();
    se.addEventListener("change", () => { if (!se.value || se.value < se.min) se.value = se.min; renderAll(); });
    document.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => {
      const d = new Date(); d.setDate(d.getDate() + Number(b.dataset.start));
      se.value = d.toLocaleDateString("sv"); renderAll();
    }));
    document.getElementById("nights-minus").addEventListener("click", () => setDays(planDays() - 1));
    document.getElementById("nights-plus").addEventListener("click", () => setDays(planDays() + 1));
    document.querySelectorAll("[data-nights]").forEach((b) => b.addEventListener("click", () => setDays(Number(b.dataset.nights))));
    MP.ShoppingList.load().then((packData) => renderBudget(packData && packData.planning)).catch(() => renderBudget(null));

    document.getElementById("pwm-generate-btn").addEventListener("click", () => {
      const p = MP.PlanPrefs.get(true), bt = profileBudget() ? p.budgetTarget : budgetTarget; // the only mp_planPrefs writer: the other fields pass through untouched
      MP.PlanPrefs.save(p.busyDays, p.chips, bt, p.freezeBatches, p.repeatGap, p.rolling, p.timeCaps);
      if (MP.Sync) MP.Sync.pushPlanPrefs();
      location.href = `plan.html?chat=1&build=1&start=${startEl().value}&days=${planDays()}&budget=${profileBudget() || bt}`;
    });
  }

  MP.initTheme();
  init();
})();
