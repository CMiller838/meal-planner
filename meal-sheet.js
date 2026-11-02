/* Phase 115: the one meal Details sheet (Browse, Plan, Discover, Shopping). Browser-only.
 * Ticks are session-only and display-only; Add to plan goes only through MP.BarChat.applyLive `place`.
 * Never writes the pantry or Cooks. */
(function (root) {
  const MP = root.MP = root.MP || {};
  const esc = (s) => MP.esc(s);
  const SL = () => MP.ShoppingList;
  const isoToday = () => new Date().toLocaleDateString("sv");

  /** Pure: ingredients neither on hand (normalizeKey in `have`) nor ticked. `ticks` = Set/array of ingredient keys. */
  function toBuy(effMeal, have, ticks) {
    const t = new Set(ticks || []), h = have || {};
    return (effMeal.ingredients || []).filter((i) => !(SL().normalizeKey(i.key) in h) && !t.has(i.key)).length;
  }

  /** Pure: the plan's nights from `today` (ISO) on: [{ day, date, label, state: free|meal|out|held, name? }]. */
  function nights(plan, today, mealsById) {
    if (!plan || !plan.startDate || !Array.isArray(plan.days)) return [];
    const out = [];
    plan.days.forEach((d, i) => {
      const dt = new Date(`${plan.startDate}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + i);
      const date = dt.toISOString().slice(0, 10);
      if (date < today) return;
      const s = (d.slots || {}).dinner;
      const held = !!(s && ((s.mealId && (s.locked || s.eatenAt)) || s.frozenFrom));
      const label = dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");
      const m = s && s.mealId && mealsById && mealsById[s.mealId];
      out.push({ day: d.day || i + 1, date, label, state: held ? "held" : !s ? "free" : s.eatingOut ? "out" : s.mealId ? "meal" : "free", ...(m ? { name: m.name } : {}) });
    });
    return out;
  }

  let st = null; // { meal, opts, variantId, ticks, have, opener, overlay, sheet }

  function say(msg, label, fn) {
    let r = document.getElementById("toast-root");
    if (!r) { r = document.createElement("div"); r.id = "toast-root"; document.body.appendChild(r); }
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    if (label) {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", () => { el.remove(); fn(); });
      el.appendChild(b);
    }
    r.appendChild(el);
    setTimeout(() => el.remove(), label ? 6000 : 2500);
  }

  function build() {
    let ov = document.getElementById("meal-sheet-overlay");
    if (ov) return ov;
    ov = document.createElement("div");
    ov.id = "meal-sheet-overlay";
    ov.className = "ms-overlay hidden";
    ov.innerHTML = `<div id="meal-sheet" class="ms" role="dialog" aria-modal="true" aria-label="Recipe" tabindex="-1"></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    const sheet = ov.firstElementChild;
    MP.enableSheetDrag(sheet, close);
    document.addEventListener("keydown", (e) => {
      if (!st) return;
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      else if (e.key === "Tab") { // keep focus inside the sheet
        const f = [...sheet.querySelectorAll("button, input, select, a[href], textarea")].filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }, true);
    return ov;
  }

  function ingHtml(eff) {
    return (eff.ingredients || []).map((i) => {
      const have = SL().normalizeKey(i.key) in st.have;
      const q = MP.qtyText(i.qty);
      const untracked = st.opts.untracked && st.opts.untracked(i.key);
      return `<li class="ms-ing${have ? " have" : ""}"><label><input type="checkbox" data-k="${esc(i.key)}"${st.ticks.has(i.key) ? " checked" : ""}>
        <span>${esc(i.label || String(i.key).replace(/_/g, " "))}${q ? ` <span class="muted">— ${esc(q)}</span>` : ""}${untracked ? ` <span class="tag untracked">not tracked yet</span>` : ""}</span></label>
        ${have ? `<span class="hv">In pantry</span>` : ""}</li>`;
    }).join("");
  }

  function btnHtml(a, cls) {
    return `<button type="button" class="ms-btn ${a.kind || ""} ${cls || ""}" data-act="${esc(a.id)}">${esc(a.label)}</button>`;
  }

  function hasPlan() {
    try { const p = JSON.parse(localStorage.getItem("mp_plan") || "null"); return !!(p && p.startDate && p.days && p.days.length); } catch (e) { return false; }
  }

  function render() {
    const { meal, opts } = st;
    const eff = MP.effectiveMeal(meal, st.variantId, opts.subs);
    const method = MP.methodOf(meal);
    const label = MP.variantLabel(meal, st.variantId), subsLabel = MP.subsLabel(opts.subs);
    const mins = meal.totalMins || MP.estMins(meal);
    const vs = meal.variants || [];
    const noPlan = (opts.actions || []).some((a) => a.id === "plan") && !hasPlan();
    st.sheet.innerHTML = `
      <div class="ms-grab" aria-hidden="true"></div>
      <div class="ms-scroll">
        <button class="close-btn ms-close" type="button" aria-label="Close">✕</button>
        <h2 class="ms-title">${esc(meal.name)}${label ? ` — ${esc(label)}` : ""}</h2>
        ${subsLabel ? `<p class="muted subs-label">${esc(subsLabel)}</p>` : ""}
        <p class="ms-desc">${meal.description ? esc(meal.description) : `<span class="muted">No description yet</span>`}</p>
        ${meal.image ? `<img class="ms-photo" src="${esc(meal.image)}" alt="${esc(meal.name)}">` : `<div class="ms-photo placeholder" aria-hidden="true">🍽</div>`}
        <div class="ms-stats">
          ${mins ? `<span><b>${mins}</b> min</span>` : ""}${meal.servings ? `<span><b>${esc(meal.servings)}</b> serving${meal.servings === 1 ? "" : "s"}</span>` : ""}${meal.prepEffort ? `<span>${esc(meal.prepEffort)}</span>` : ""}
        </div>
        ${opts.tagsHtml || ""}
        ${vs.length ? `<div class="ms-variants" role="radiogroup" aria-label="Variant">${[{ id: "", name: "Standard" }, ...vs].map((v) =>
          `<label class="ms-chip"><input type="radio" name="msv" value="${esc(v.id)}"${(v.id || "") === (st.variantId || "") ? " checked" : ""}><span>${esc(v.name)}</span></label>`).join("")}</div>` : ""}
        <h3 class="ms-h">Ingredients <span class="muted ms-buy" aria-live="polite"></span></h3>
        <ul class="ms-ings">${ingHtml(eff)}</ul>
        <h3 class="ms-h">Method ${method.status === "drafted" ? `<span class="tag drafted-badge">Drafted</span>` : ""}</h3>
        ${st.variantId && method.steps.length ? `<p class="muted">Steps are for the base recipe.</p>` : ""}
        ${method.steps.length ? `<ol class="ms-steps">${method.steps.map((s) => `<li>${esc(s.text)}${s.minutes ? ` <span class="method-min">${s.minutes} min</span>` : ""}</li>`).join("")}</ol>`
          : meal.instructions ? `<p class="ms-instr">${esc(meal.instructions)}</p>` : `<p class="muted">No method yet. Ask Hermes to draft one.</p>`}
        <div class="ms-more">${(opts.more || []).map((a) => btnHtml(a, "plain")).join("")}</div>
        <div class="ms-extra"></div>
      </div>
      <div class="ms-dock">${(opts.actions || []).map((a) => a.id === "plan" && noPlan ? `<a class="ms-btn pri" href="plan.html">No plan yet</a>` : btnHtml(a)).join("")}</div>`;
    const sheet = st.sheet;
    const count = () => { sheet.querySelector(".ms-buy").textContent = `${toBuy(eff, st.have, st.ticks)} to buy`; };
    count();
    sheet.querySelector(".ms-close").addEventListener("click", close);
    sheet.querySelectorAll(".ms-ings input").forEach((c) => c.addEventListener("change", () => {
      c.checked ? st.ticks.add(c.dataset.k) : st.ticks.delete(c.dataset.k);
      count();
    }));
    sheet.querySelectorAll(".ms-variants input").forEach((r) => r.addEventListener("change", () => {
      st.variantId = r.value || undefined;
      if (opts.onVariant) opts.onVariant(st.variantId);
      render();
      const again = st.sheet.querySelector(`.ms-variants input[value="${CSS.escape(r.value)}"]`);
      if (again) again.focus();
    }));
    const ctx = { meal, variantId: st.variantId, sheetEl: sheet, close };
    [...(opts.actions || []), ...(opts.more || [])].forEach((a) => {
      const b = sheet.querySelector(`[data-act="${CSS.escape(a.id)}"]`);
      if (b) b.addEventListener("click", () => (a.id === "plan" ? pickNight(meal, st.variantId) : a.onClick && a.onClick({ ...ctx, variantId: st.variantId })));
    });
    if (opts.afterRender) opts.afterRender(sheet, ctx);
  }

  function open(meal, opts) {
    if (!meal) return;
    const ov = build();
    const sheet = ov.firstElementChild;
    const o = opts || {};
    st = {
      meal, opts: o, variantId: o.variantId || undefined, ticks: new Set(), sheet,
      have: SL().pantryIndex({ items: (MP.Sync && MP.Sync.localItems("pantry")) || [] }),
      opener: document.activeElement,
    };
    render();
    ov.classList.remove("hidden");
    sheet.scrollTop = 0;
    const s = sheet.querySelector(".ms-scroll"); if (s) s.scrollTop = 0;
    sheet.focus({ preventScroll: true });
  }

  function close() {
    const ov = document.getElementById("meal-sheet-overlay");
    if (ov) ov.classList.add("hidden");
    const back = st && st.opener;
    st = null;
    if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
  }

  async function pickNight(meal, variantId) {
    if (!st) return;
    const dock = st.sheet.querySelector(".ms-dock");
    const lib = await MP.getLibrary();
    const byId = Object.fromEntries([...lib, meal].map((m) => [m.id, m]));
    let plan = null;
    try { plan = MP.dinnersOnly(JSON.parse(localStorage.getItem("mp_plan") || "null")); } catch (e) { /* no plan */ }
    const list = nights(plan, isoToday(), byId);
    if (!st) return;
    dock.className = "ms-dock ms-nights";
    dock.innerHTML = list.length
      ? `<p class="ms-nights-h">Add to which night? <button type="button" class="ghost ms-back">Back</button></p><div class="ms-night-row">${list.map((n) =>
        `<button type="button" class="ms-night ${n.state}" data-day="${n.day}" data-label="${esc(n.label)}"${n.state === "held" ? " disabled" : ""}><b>${esc(n.label)}</b><span>${n.state === "free" ? "Free" : n.state === "out" ? "Eating out" : esc(n.name || (n.state === "held" ? "Eaten / locked" : ""))}</span></button>`).join("")}</div>`
      : `<p class="ms-nights-h">No nights left in this plan. <a href="plan.html">Open Plan</a> <button type="button" class="ghost ms-back">Back</button></p>`;
    dock.querySelector(".ms-back").addEventListener("click", () => { dock.className = "ms-dock"; render(); });
    dock.querySelectorAll(".ms-night").forEach((b) => b.addEventListener("click", () => {
      const res = MP.BarChat.applyLive({ edits: [{ type: "place", day: +b.dataset.day, slot: "dinner", mealId: meal.id, ...(variantId ? { variantId } : {}) }] }, { byId });
      if (res.applied.some((a) => a.type === "place")) {
        close();
        say(`Added ${meal.name} to ${b.dataset.label}`, "Undo", () => res.undo());
      } else say(res.refused[0] || "Couldn't add that", null);
    }));
    const first = dock.querySelector(".ms-night:not(:disabled)") || dock.querySelector(".ms-back");
    if (first) first.focus();
  }

  MP.MealSheet = { open, close, pickNight, nights, toBuy };
})(typeof globalThis !== "undefined" ? globalThis : this);
