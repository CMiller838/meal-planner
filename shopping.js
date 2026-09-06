// Shopping list page controller (DOM + localStorage), split from the pure
// MP.ShoppingList module the same way plan.js splits from generator.js.
(function () {
  "use strict";

  const { esc } = MP;
  const LS_PLAN = "mp_plan";
  const LS_TICKED = "mp_shopping_ticked";

  function loadPlan() {
    const stored = localStorage.getItem(LS_PLAN);
    return stored ? JSON.parse(stored) : null;
  }

  function loadTicked(plan) {
    const stored = JSON.parse(localStorage.getItem(LS_TICKED) || "null");
    if (!stored || stored.startDate !== (plan.startDate || null)) {
      return { startDate: plan.startDate || null, keys: [] };
    }
    return stored;
  }

  function saveTicked(ticked) {
    localStorage.setItem(LS_TICKED, JSON.stringify(ticked));
  }

  function fmtQty(line) {
    if (!line.needed) return `${line.packs} × pack`;
    return `${line.packs} × ${line.needed.value}${line.needed.unit}`;
  }

  function lineHtml(shopDay, line, ticked, showPrice) {
    const key = `${shopDay}:${line.key}`;
    const checked = ticked.keys.includes(key) ? "checked" : "";
    const classes = ["shop-line"];
    if (ticked.keys.includes(key)) classes.push("ticked");
    if (line.packs === 0) classes.push("covered");
    const meals = line.meals.map(esc).join(", ");
    return `<li class="${classes.join(" ")}">
      <label>
        <input type="checkbox" data-shop="${shopDay}" data-key="${esc(line.key)}" ${checked}>
        <span class="shop-qty">${esc(fmtQty(line))}</span>
        <span class="shop-name">${esc(line.label)}</span>
        ${line.pantryQty ? `<span class="have">have ${esc(line.pantryQty)}</span>` : ""}
        ${showPrice ? `<span class="shop-price">${line.price != null ? "£" + line.lineCost.toFixed(2) : ""}</span>` : ""}
      </label>
      ${meals ? `<span class="shop-why">${meals}</span>` : ""}
    </li>`;
  }

  function blockHtml(list, ticked) {
    return `<section class="shop-block">
      <h3>Shop day ${list.shopDay} <span class="shop-total">£${list.total.toFixed(2)}</span></h3>
      <ul class="shop-list">${list.lines.map((l) => lineHtml(list.shopDay, l, ticked, true)).join("")}</ul>
      ${list.staples.length ? `<details class="shop-extra">
        <summary>Check you have these (${list.staples.length})</summary>
        <ul class="shop-list">${list.staples.map((l) => lineHtml(list.shopDay, l, ticked, false)).join("")}</ul>
      </details>` : ""}
      ${list.unpriced.length ? `<details class="shop-extra">
        <summary>Unpriced — check in store (${list.unpriced.length})</summary>
        <ul class="shop-list">${list.unpriced.map((l) => lineHtml(list.shopDay, l, ticked, false)).join("")}</ul>
      </details>` : ""}
    </section>`;
  }

  function render(plan, lists, ticked) {
    const meta = document.getElementById("shopping-meta");
    const root = document.getElementById("shopping-root");
    meta.textContent = plan.startDate
      ? `From your plan starting ${plan.startDate} — prices are a hand-entered estimate`
      : "Prices are a hand-entered estimate";
    root.innerHTML = [1, 8].map((d) => blockHtml(lists[d], ticked)).join("");

    root.addEventListener("change", (e) => {
      const input = e.target.closest('input[type="checkbox"]');
      if (!input) return;
      const key = `${input.dataset.shop}:${input.dataset.key}`;
      const idx = ticked.keys.indexOf(key);
      if (input.checked && idx === -1) ticked.keys.push(key);
      if (!input.checked && idx !== -1) ticked.keys.splice(idx, 1);
      saveTicked(ticked);
      input.closest(".shop-line").classList.toggle("ticked", input.checked);
    });
  }

  // ---- Ad-hoc list ----
  function adhocLineHtml(item) {
    return `<li class="shop-line">
      <label>
        <input type="checkbox" data-name="${esc(item.name)}">
        <span class="shop-qty">${esc(item.qty || "")}</span>
        <span class="shop-name">${esc(item.name)}</span>
      </label>
    </li>`;
  }

  function adhocHtml(items) {
    return `<section class="shop-block adhoc">
      ${items.length
        ? `<ul class="shop-list">${items.map(adhocLineHtml).join("")}</ul>`
        : `<p class="muted">Nothing on your ad-hoc list.</p>`}
      <div class="adhoc-add">
        <input type="text" id="adhoc-name" placeholder="Add an item">
        <input type="text" id="adhoc-qty" placeholder="qty (optional)">
        <button id="adhoc-add-btn" class="ghost">Add</button>
      </div>
    </section>`;
  }

  function renderAdhoc() {
    const root = document.getElementById("adhoc-root");
    if (!root) return;
    const items = MP.Sync.localItems("adhoc");
    root.innerHTML = adhocHtml(items);

    root.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", () => {
        MP.Sync.queueOp({ list: "adhoc", type: "remove", name: cb.dataset.name });
        MP.Sync.writeLocalItems("adhoc", MP.Sync.applyOps(MP.Sync.localItems("adhoc"), [{ type: "remove", name: cb.dataset.name }]));
        renderAdhoc();
        MP.Sync.flushOps();
      });
    });

    root.querySelector("#adhoc-add-btn").addEventListener("click", () => {
      const nameInput = root.querySelector("#adhoc-name");
      const qtyInput = root.querySelector("#adhoc-qty");
      const name = nameInput.value.trim();
      if (!name) return;
      const qty = qtyInput.value.trim();
      const op = { list: "adhoc", type: "add", name, ...(qty ? { qty } : {}) };
      MP.Sync.queueOp(op);
      MP.Sync.writeLocalItems("adhoc", MP.Sync.applyOps(MP.Sync.localItems("adhoc"), [op]));
      renderAdhoc();
      MP.Sync.flushOps();
    });
  }

  async function init() {
    MP.initTheme();
    renderAdhoc();
    MP.Sync.fetchItems("adhoc").then(() => renderAdhoc());

    const plan = loadPlan();
    const root = document.getElementById("shopping-root");
    if (!plan || !plan.days.some((d) => Object.values(d.slots).some((s) => s && s.mealId))) {
      root.innerHTML = `<p class="empty">No plan yet — <a href="plan.html">generate a 2-week plan</a> first.</p>`;
      return;
    }
    const [library, packData, pantry] = await Promise.all([MP.getLibrary(), MP.ShoppingList.load(), MP.Sync.fetchPantry()]);
    const mealsById = Object.fromEntries(library.map((m) => [m.id, m]));
    const lists = MP.ShoppingList.buildLists(plan, mealsById, packData, pantry);
    const ticked = loadTicked(plan);
    render(plan, lists, ticked);
  }

  init();
})();
