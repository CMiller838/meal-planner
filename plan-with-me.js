// "Plan with me" setup screen: mp_planPrefs storage (shared with plan.js)
// plus the page controller for plan-with-me.html.
window.MP = window.MP || {};

(function () {
  "use strict";

  const KEY = "mp_planPrefs";

  function get() {
    let parsed;
    try {
      parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch (e) {
      parsed = {};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
    const busyDays = Array.isArray(parsed.busyDays)
      ? [...new Set(parsed.busyDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 14))]
      : [];
    const chips = Array.isArray(parsed.chips) ? parsed.chips.filter((c) => typeof c === "string") : [];
    const budgetTarget = Number(parsed.budgetTarget);
    return { busyDays, chips, budgetTarget: isFinite(budgetTarget) && budgetTarget >= 0 ? budgetTarget : 0 };
  }

  function save(busyDays, chips, budgetTarget) {
    const n = Number(budgetTarget);
    const record = {
      updatedAt: new Date().toISOString(),
      busyDays: [...busyDays].sort((a, b) => a - b),
      chips: [...chips],
      budgetTarget: isFinite(n) && n >= 0 ? n : 0,
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

  MP.PlanPrefs = { KEY, get, save, loadVocab };

  // ---- Page controller (no-ops when not on plan-with-me.html) ----
  const busyGrid = document.getElementById("busy-grid");
  if (!busyGrid) return;

  const { esc } = MP;
  const busyDays = new Set();
  const chips = new Set();
  let budgetTarget = 0;

  function weekdayShort(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }

  function renderBusyGrid() {
    let html = "";
    for (let day = 1; day <= 14; day++) {
      const active = busyDays.has(day);
      html += `<button class="busy-cell${active ? " is-busy" : ""}" data-day="${day}" aria-pressed="${active}">
        <span class="busy-day">${day}</span><span class="busy-dow">${esc(weekdayShort(day - 1))}</span>
      </button>`;
    }
    busyGrid.innerHTML = html;
  }

  function renderChips(vocab) {
    const row = document.getElementById("chip-row");
    if (!vocab || !Array.isArray(vocab.chips) || !vocab.chips.length) {
      row.hidden = true;
      return;
    }
    row.hidden = false;
    row.innerHTML = vocab.chips
      .map((c) => {
        const active = chips.has(c.id);
        return `<button class="chip${active ? " active" : ""}" data-chip="${esc(c.id)}" aria-pressed="${active}">${esc(c.label)}</button>`;
      })
      .join("");
  }

  function budgetLabel(v) {
    return v > 0 ? `£${v} a week` : "No target";
  }

  function renderBudget(planning) {
    const row = document.getElementById("budget-row");
    if (!planning || !planning.budgetTarget) {
      row.hidden = true;
      return;
    }
    row.hidden = false;
    const cfg = planning.budgetTarget;
    const range = document.getElementById("budget-range");
    const label = document.getElementById("budget-label");
    range.min = 0;
    range.max = Math.max(cfg.max, budgetTarget);
    range.step = cfg.step;
    range.value = budgetTarget;
    label.textContent = budgetLabel(budgetTarget);
    range.addEventListener("input", () => {
      budgetTarget = Number(range.value);
      label.textContent = budgetLabel(budgetTarget);
      renderSummary();
    });
  }

  function renderSummary() {
    const el = document.getElementById("pref-summary");
    const n = busyDays.size;
    const p = chips.size;
    const base = n || p
      ? `${n} busy day${n === 1 ? "" : "s"} · ${p} preference${p === 1 ? "" : "s"}`
      : "No busy days, no preferences";
    el.textContent = budgetTarget > 0 ? `${base} · £${budgetTarget}/wk` : base;
  }

  async function init() {
    const prefs = MP.Sync ? await MP.Sync.fetchPlanPrefs() : MP.PlanPrefs.get();
    prefs.busyDays.forEach((d) => busyDays.add(d));
    budgetTarget = prefs.budgetTarget || 0;
    renderBusyGrid();

    MP.ShoppingList.load()
      .then((packData) => renderBudget(packData && packData.planning))
      .catch(() => renderBudget(null));

    busyGrid.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-day]");
      if (!btn) return;
      const day = Number(btn.dataset.day);
      const active = busyDays.has(day) ? (busyDays.delete(day), false) : (busyDays.add(day), true);
      btn.classList.toggle("is-busy", active);
      btn.setAttribute("aria-pressed", String(active));
      renderSummary();
    });

    MP.PlanPrefs.loadVocab().then((vocab) => {
      prefs.chips.forEach((id) => {
        if (vocab && vocab.chips.some((c) => c.id === id)) chips.add(id);
      });
      renderChips(vocab);
      renderSummary();

      const row = document.getElementById("chip-row");
      row.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-chip]");
        if (!btn) return;
        const id = btn.dataset.chip;
        const active = chips.has(id) ? (chips.delete(id), false) : (chips.add(id), true);
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
        renderSummary();
      });
    });

    renderSummary();

    document.getElementById("pwm-generate-btn").addEventListener("click", () => {
      MP.PlanPrefs.save([...busyDays], [...chips], budgetTarget);
      if (MP.Sync) MP.Sync.pushPlanPrefs();
      location.href = "plan.html?guided=1";
    });
  }

  MP.initTheme();
  init();
})();
