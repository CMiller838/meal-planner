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
      ? [...new Set(parsed.busyDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 28))]
      : [];
    const chips = Array.isArray(parsed.chips) ? parsed.chips.filter((c) => typeof c === "string") : [];
    const budgetTarget = Number(parsed.budgetTarget);
    return { busyDays, chips, freezeBatches: parsed.freezeBatches !== false, repeatGap: cleanGap(parsed.repeatGap), rolling: parsed.rolling !== false, timeCaps: cleanCaps(parsed.timeCaps), budgetTarget: (!raw && profileBudget()) || (isFinite(budgetTarget) && budgetTarget >= 0 ? budgetTarget : 0) };
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
      rolling: rolling !== false,
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
  const busyGrid = document.getElementById("busy-grid");
  if (!busyGrid) return;

  const { esc } = MP;
  const chips = new Set();
  let budgetTarget = 0;

  const PD = () => document.getElementById("plan-days");
  const startEl = () => document.getElementById("start-date");
  const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun as getDay values
  const weekdays = new Set();
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let step = 0;
  const LAST = 5;

  /** Phase 83: the plan length, clamped 1..28 (blank or junk = 14). */
  function planDays() {
    const n = Math.floor(Number(PD().value));
    return n >= 1 && n <= 28 ? n : 14;
  }

  function fmt(iso, off) {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + off);
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }
  const rangeText = () => `${fmt(startEl().value, 0)} to ${fmt(startEl().value, planDays() - 1)}`;

  function renderBusyGrid() {
    busyGrid.innerHTML = WEEK.map((w) => {
      const on = weekdays.has(w);
      return `<button type="button" class="busy-cell${on ? " is-busy" : ""}" data-weekday="${w}" aria-pressed="${on}"><span class="busy-day">${DOW[w]}</span></button>`;
    }).join("");
  }

  function setDays(n) {
    PD().value = String(Math.min(28, Math.max(1, n)));
    renderAll();
  }

  function renderAll() {
    document.getElementById("nights-out").textContent = planDays();
    document.getElementById("wiz-range").textContent = document.getElementById("wiz-range2").textContent = rangeText();
    document.querySelectorAll("[data-nights]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.nights) === planDays())));
    renderSummary();
  }

  function showStep(n) {
    step = Math.max(0, Math.min(LAST, n));
    document.querySelectorAll(".wiz-step").forEach((s) => { s.hidden = Number(s.dataset.step) !== step; });
    document.getElementById("wiz-prog").style.width = ((step + 1) / (LAST + 1)) * 100 + "%";
    document.getElementById("wiz-count").textContent = `Step ${step + 1} of ${LAST + 1}`;
    document.getElementById("wiz-prev").hidden = step === 0;
    document.getElementById("wiz-next").hidden = step === LAST;
    document.getElementById("pwm-generate-btn").hidden = step !== LAST;
    renderSummary();
  }

  function renderChips(vocab) {
    const row = document.getElementById("chip-row");
    if (!vocab || !Array.isArray(vocab.chips) || !vocab.chips.length) {
      row.hidden = true;
      document.getElementById("chip-none").hidden = false;
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
      document.getElementById("budget-none").hidden = false;
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
    const el = document.getElementById("pref-summary"), rv = document.getElementById("wiz-review");
    const p = chips.size, locked = profileBudget(), bt = locked || budgetTarget;
    const names = [...chips].map((id) => { const b = document.querySelector(`[data-chip="${CSS.escape(id)}"]`); return b ? b.textContent : id; });
    const rows = [
      `${planDays()} nights: ${rangeText()}`,
      weekdays.size ? "Busy: " + WEEK.filter((w) => weekdays.has(w)).map((w) => DOW[w]).join(", ") : "No busy days",
      bt > 0 ? `Budget: £${bt}/wk` : "Budget: No target",
      p ? "Preferences: " + names.join(", ") : "No preferences",
    ];
    rv.textContent = "";
    rows.forEach((t) => { const li = document.createElement("li"); li.textContent = t; rv.appendChild(li); });
    el.textContent = "";
  }

  /** Phase 91: read-only standing notes (external text: textContent only). Hidden when there are none. */
  function renderNotes() {
    const n = MP.Sync.notes(), ul = document.getElementById("notes-list");
    ul.textContent = "";
    n.items.forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
    n.pending.forEach((p) => {
      const li = document.createElement("li"), tag = document.createElement("span");
      li.textContent = p.text + " ";
      tag.className = "notes-tag"; tag.textContent = "waiting for Obsidian";
      li.appendChild(tag); ul.appendChild(li);
    });
    document.getElementById("notes-section").hidden = !ul.children.length;
  }

  async function init() {
    if (MP.Sync) { renderNotes(); MP.Sync.fetchNotes().then(renderNotes); }
    if (MP.Sync) await MP.Sync.fetchSettings();
    const prefs = MP.Sync ? await MP.Sync.fetchPlanPrefs() : MP.PlanPrefs.get();
    budgetTarget = prefs.budgetTarget || 0;
    document.getElementById("freeze-batches").checked = prefs.freezeBatches !== false;
    document.getElementById("repeat-gap").value = String(prefs.repeatGap || 0);
    document.getElementById("rolling-plan").checked = prefs.rolling !== false;
    const se = startEl();
    se.value = se.min = new Date().toLocaleDateString("sv");
    MP.PlanPrefs.weekdaysFromBusy(se.value, prefs.busyDays).forEach((w) => weekdays.add(w));
    renderBusyGrid();
    renderAll();
    showStep(0);
    se.addEventListener("change", () => { if (!se.value || se.value < se.min) se.value = se.min; renderAll(); });
    document.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => {
      const d = new Date(); d.setDate(d.getDate() + Number(b.dataset.start));
      se.value = d.toLocaleDateString("sv"); renderAll();
    }));
    document.getElementById("nights-minus").addEventListener("click", () => setDays(planDays() - 1));
    document.getElementById("nights-plus").addEventListener("click", () => setDays(planDays() + 1));
    document.querySelectorAll("[data-nights]").forEach((b) => b.addEventListener("click", () => setDays(Number(b.dataset.nights))));
    document.getElementById("wiz-next").addEventListener("click", () => showStep(step + 1));
    document.getElementById("wiz-prev").addEventListener("click", () => showStep(step - 1));

    MP.ShoppingList.load()
      .then((packData) => renderBudget(packData && packData.planning))
      .catch(() => renderBudget(null));

    busyGrid.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-weekday]");
      if (!btn) return;
      const w = Number(btn.dataset.weekday);
      const active = weekdays.has(w) ? (weekdays.delete(w), false) : (weekdays.add(w), true);
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
      MP.PlanPrefs.save(MP.PlanPrefs.busyFromWeekdays(startEl().value, planDays(), [...weekdays]), [...chips], profileBudget() ? MP.PlanPrefs.get(true).budgetTarget : budgetTarget, document.getElementById("freeze-batches").checked, document.getElementById("repeat-gap").value, document.getElementById("rolling-plan").checked, MP.PlanPrefs.get(true).timeCaps);
      if (MP.Sync) MP.Sync.pushPlanPrefs();
      const start = document.getElementById("start-date").value;
      location.href = "plan.html?guided=1" + (start ? "&start=" + start : "") + "&days=" + planDays() + "&shop=" + document.getElementById("shop-day").value;
    });
  }

  MP.initTheme();
  init();
})();
