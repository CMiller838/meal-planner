// "Plan with me" setup screen: mp_planPrefs storage (shared with plan.js)
// plus the page controller for plan-with-me.html.
window.MP = window.MP || {};

(function () {
  "use strict";

  const KEY = "mp_planPrefs";

  function get(raw) {
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
    return { busyDays, chips, freezeBatches: parsed.freezeBatches !== false, repeatGap: cleanGap(parsed.repeatGap), rolling: parsed.rolling !== false, budgetTarget: (!raw && profileBudget()) || (isFinite(budgetTarget) && budgetTarget >= 0 ? budgetTarget : 0) };
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

  function save(busyDays, chips, budgetTarget, freezeBatches, repeatGap, rolling) {
    const n = Number(budgetTarget);
    const record = {
      updatedAt: new Date().toISOString(),
      busyDays: [...busyDays].sort((a, b) => a - b),
      chips: [...chips],
      budgetTarget: isFinite(n) && n >= 0 ? n : 0,
      freezeBatches: freezeBatches !== false,
      repeatGap: cleanGap(repeatGap),
      rolling: rolling !== false,
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

  MP.PlanPrefs = { KEY, get, save, loadVocab, profileBudget };

  // ---- Page controller (no-ops when not on plan-with-me.html) ----
  const busyGrid = document.getElementById("busy-grid");
  if (!busyGrid) return;

  const { esc } = MP;
  const busyDays = new Set();
  const chips = new Set();
  let budgetTarget = 0;

  function weekdayShort(offset) {
    const d = new Date();
    const s = document.getElementById("start-date").value;
    if (s) d.setTime(Date.parse(s + "T12:00:00"));
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
    const locked = profileBudget();
    if (locked) {
      range.disabled = true;
      range.max = Math.max(range.max, locked);
      range.value = locked;
      label.textContent = `£${locked}/wk · set in Profile.md`;
      return;
    }
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
    if (MP.Sync) await MP.Sync.fetchSettings();
    const prefs = MP.Sync ? await MP.Sync.fetchPlanPrefs() : MP.PlanPrefs.get();
    prefs.busyDays.forEach((d) => busyDays.add(d));
    budgetTarget = prefs.budgetTarget || 0;
    document.getElementById("freeze-batches").checked = prefs.freezeBatches !== false;
    document.getElementById("repeat-gap").value = String(prefs.repeatGap || 0);
    document.getElementById("rolling-plan").checked = prefs.rolling !== false;
    const startEl = document.getElementById("start-date");
    startEl.value = startEl.min = new Date().toLocaleDateString("sv");
    renderBusyGrid();
    startEl.addEventListener("change", () => { if (!startEl.value) startEl.value = startEl.min; renderBusyGrid(); });

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

    document.getElementById("also-row").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-slot]");
      if (!btn) return;
      btn.setAttribute("aria-pressed", String(btn.classList.toggle("active")));
    });

    document.getElementById("pwm-generate-btn").addEventListener("click", () => {
      MP.PlanPrefs.save([...busyDays], [...chips], profileBudget() ? MP.PlanPrefs.get(true).budgetTarget : budgetTarget, document.getElementById("freeze-batches").checked, document.getElementById("repeat-gap").value, document.getElementById("rolling-plan").checked);
      if (MP.Sync) MP.Sync.pushPlanPrefs();
      const extras = [...document.querySelectorAll("#also-row button.active")].map((b) => b.dataset.slot);
      const start = document.getElementById("start-date").value;
      location.href = "plan.html?guided=1" + (start ? "&start=" + start : "") + (extras.length ? "&slots=" + extras.join(",") : "");
    });
  }

  MP.initTheme();
  init();
})();
