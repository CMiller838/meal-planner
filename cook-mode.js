// Cooking mode (Phase 79): one big step at a time, per-step timers, then hand off to the existing eat sheet.
// Browser-only, not imported by the Worker. Writes nothing itself: onConfirm opens plan.js's eat sheet (commitCook).
(function () {
  "use strict";
  const MP = window.MP = window.MP || {};

  /** Remaining ms for a timer { endAt }, clamped at 0. */
  function timerLeft(t, now) { return Math.max(0, t.endAt - now); }

  function fmt(ms) {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // ponytail: timers in memory only; persist endAt in sessionStorage if reloads mid-cook bite.
  let st = null; // { meal, effMeal, onConfirm, steps, status, i, timers: {stepIdx: {endAt, done}}, tick, lock }

  function toast(msg) {
    const root = document.getElementById("toast-root");
    if (!root) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function startTimer(i) {
    st.timers[i] = { endAt: Date.now() + st.steps[i].minutes * 60000, done: false };
    render();
  }
  function cancelTimer(i) { delete st.timers[i]; render(); }

  function tick() {
    if (!st) return;
    const now = Date.now();
    let fired = false;
    for (const [i, t] of Object.entries(st.timers)) {
      if (!t.done && timerLeft(t, now) === 0) {
        t.done = true; fired = true;
        toast(`Step ${+i + 1} timer done`);
        try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (e) { /* best effort */ }
      }
    }
    if (fired) render(); else updateStrip();
  }

  function updateStrip() {
    const now = Date.now();
    document.querySelectorAll("#cook-overlay .cook-chip").forEach((c) => {
      const t = st.timers[c.dataset.step];
      if (t && !t.done) c.querySelector(".left").textContent = fmt(timerLeft(t, now));
    });
  }

  function render() {
    const sheet = document.getElementById("cook-sheet");
    const { steps, i, status, effMeal } = st;
    const esc = MP.esc;
    const now = Date.now();
    const strip = Object.entries(st.timers).map(([k, t]) =>
      `<button class="cook-chip${t.done ? " done" : ""}" data-step="${k}">Step ${+k + 1}: <span class="left">${t.done ? "done" : fmt(timerLeft(t, now))}</span></button>`).join("");
    const ings = (effMeal.ingredients || []).map((g) => `<li>${esc([g.qty && MP.qtyText ? MP.qtyText(g.qty) : (g.qty || ""), g.name || g.item || ""].filter(Boolean).join(" "))}</li>`).join("");
    const label = status === "drafted" ? `<p class="muted">Drafted by your assistant</p>` : "";
    let body;
    if (!steps.length) {
      body = `<h3>Ingredients</h3><ul class="ingredient-list">${ings}</ul><p class="muted">No method saved for this meal.</p>`;
    } else {
      const s = steps[i], t = st.timers[i];
      body = `<p class="cook-count">Step ${i + 1} of ${steps.length}</p>
        <p class="cook-step"></p>${label}
        ${s.minutes ? `<button class="ghost cook-timer-btn">${t && !t.done ? "Cancel timer" : `Start ${s.minutes} min timer`}</button>` : ""}
        ${i === 0 ? `<details class="cook-ings"><summary>Ingredients</summary><ul class="ingredient-list">${ings}</ul></details>` : ""}
        ${st.variant ? `<p class="muted">Steps are for the base recipe.</p>` : ""}`;
    }
    const last = !steps.length || i === steps.length - 1;
    sheet.innerHTML = `<button class="close-btn" aria-label="Close">✕</button>
      <h2>${esc(st.meal.name)}</h2>
      ${strip ? `<div class="cook-strip">${strip}</div>` : ""}
      ${body}
      <div class="cook-nav">
        ${steps.length ? `<button class="ghost cook-back"${i === 0 ? " disabled" : ""}>Back</button>` : ""}
        <button class="primary cook-next">${last ? "Confirm cook" : "Next"}</button>
      </div>`;
    if (steps.length) sheet.querySelector(".cook-step").textContent = steps[i].text;
    sheet.querySelector(".close-btn").addEventListener("click", close);
    sheet.querySelectorAll(".cook-chip").forEach((c) => c.addEventListener("click", () => { st.i = +c.dataset.step; render(); }));
    const tb = sheet.querySelector(".cook-timer-btn");
    if (tb) tb.addEventListener("click", () => (st.timers[i] && !st.timers[i].done ? cancelTimer(i) : startTimer(i)));
    const back = sheet.querySelector(".cook-back");
    if (back) back.addEventListener("click", () => { if (st.i > 0) { st.i--; render(); } });
    sheet.querySelector(".cook-next").addEventListener("click", () => {
      if (!last) { st.i++; render(); return; }
      const cb = st && st.onConfirm; // second tap finds st null: no-op
      close();
      if (cb) cb();
    });
  }

  async function open(meal, effMeal, onConfirm, variantId) {
    if (st) return;
    const m = MP.methodOf(meal);
    st = { meal, effMeal: effMeal || meal, onConfirm, steps: m.steps, status: m.status, i: 0, timers: {}, variant: !!variantId, tick: setInterval(tick, 1000), lock: null };
    document.getElementById("cook-overlay").classList.remove("hidden");
    render();
    try { st.lock = await navigator.wakeLock.request("screen"); } catch (e) { /* unsupported or denied */ }
    if (!st) { try { const l = await navigator.wakeLock.request("screen"); l.release(); } catch (e) { /* ignore */ } }
  }

  function close() {
    if (!st) return;
    clearInterval(st.tick);
    try { if (st.lock) st.lock.release(); } catch (e) { /* best effort */ }
    st = null;
    document.getElementById("cook-overlay").classList.add("hidden");
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  MP.CookMode = { open, close, timerLeft, _state: () => st };
})();
