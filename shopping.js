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

  // Phase 55: old per-plan ticks become pending "got" lines once, then the key goes.
  function migrateTicked(plan) {
    const stored = JSON.parse(localStorage.getItem(LS_TICKED) || "null");
    if (!stored) return;
    if (stored.generatedAt === (plan.generatedAt || undefined)) {
      for (const k of stored.keys || []) {
        const [day, ...rest] = k.split(":");
        MP.Sync.setLine({ id: MP.ShoppingList.planLineId(plan, day, rest.join(":")), state: "got", source: "plan" });
      }
    }
    localStorage.removeItem(LS_TICKED);
  }

  function fmtQty(line) {
    if (line.bulk) return `${line.packs} × ${line.packSize}${line.unit}${line.extra ? ` + ${line.extra.packs} × ${line.extra.packSize}${line.unit}` : ""}`;
    if (!line.needed) return `${line.packs} × pack`;
    return `${line.packs} × ${line.needed.value}${line.needed.unit}`;
  }

  function lineHtml(plan, shopDay, line, states, showPrice) {
    const state = (states.get(MP.ShoppingList.planLineId(plan, shopDay, line.key)) || {}).state;
    const classes = ["shop-line"];
    if (state === "got") classes.push("ticked");
    if (state === "skipped") classes.push("skipped");
    if (line.packs === 0) classes.push("covered");
    const meals = line.meals.map(esc).join(", ");
    return `<li class="${classes.join(" ")}">
      <label>
        <input type="checkbox" data-shop="${shopDay}" data-key="${esc(line.key)}" ${state === "got" ? "checked" : ""}>
        ${line.essential ? "" : `<span class="shop-qty">${esc(fmtQty(line))}</span>`}
        <span class="shop-name">${esc(line.label)}</span>
        ${line.bulk && line.bulk.freeze ? `<span class="have">freeze ${esc(line.bulk.freeze >= 1000 ? +(line.bulk.freeze / 1000).toFixed(2) + "kg" : line.bulk.freeze + line.unit)}</span>` : ""}
        ${line.pantryQty ? `<span class="have">have ${esc(line.pantryQty)}</span>` : ""}
        ${showPrice ? `<span class="shop-price${line.estimated ? " estimated" : ""}">${line.price != null ? (line.estimated ? "~£" : "£") + line.lineCost.toFixed(2) : ""}</span>` : ""}
      </label>
      <button class="ghost shop-skip" data-skip="${shopDay}" data-key="${esc(line.key)}" aria-label="${state === "skipped" ? "Restore" : "Skip"} ${esc(line.label)}">${state === "skipped" ? "↺" : "×"}</button>
      ${meals ? `<span class="shop-why">${meals}</span>` : ""}
    </li>`;
  }

  // lines grouped by aisle (store order), each group under a .shop-aisle sub-heading
  function aisleHtml(plan, shopDay, lines, states, canSkip) {
    return MP.ShoppingList.groupByAisle(lines, packData).map((g) => `<h4 class="shop-aisle">${esc(g.label)}</h4>
        <ul class="shop-list">${g.lines.map((l) => lineHtml(plan, shopDay, l, states, canSkip)).join("")}</ul>`).join("");
  }

  const isoPlus = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  // Phase 68: a rolling plan names the cycle by its shop date; a fixed plan keeps "Shop day N"
  function shopHeading(plan, shopDay) {
    return plan.shopAnchor && plan.startDate ? `Shop ${esc(isoPlus(plan.startDate, shopDay - 1))}` : `Shop day ${shopDay}`;
  }
  // a cycle whose shop date + 7 is already past (only before the next roll) is hidden for rolling plans
  function cycleOver(plan, shopDay) {
    return !!plan.shopAnchor && plan.startDate && isoPlus(plan.startDate, shopDay + 6) <= new Date().toLocaleDateString("en-CA");
  }

  // Always-on checklist at the end of every shop: pack-sizes.json "essentials", unpriced, ticks sync like any plan line
  function essentialsHtml(plan, shopDay, states) {
    const names = (packData && packData.essentials) || [];
    if (!names.length) return "";
    const lines = names.map((n) => ({ key: "essential-" + MP.ShoppingList.normalizeKey(n), label: n, essential: true, packs: 1, meals: [] }));
    return `<h4 class="shop-aisle">Essentials</h4>
      <ul class="shop-list">${lines.map((l) => lineHtml(plan, shopDay, l, states, false)).join("")}</ul>`;
  }

  function blockHtml(plan, list, states) {
    return `<section class="shop-block">
      <h3>${shopHeading(plan, list.shopDay)} <span class="shop-total">£${list.total.toFixed(2)}</span></h3>
      ${aisleHtml(plan, list.shopDay, list.lines, states, true)}
      ${list.staples.length ? `<details class="shop-extra">
        <summary>Check you have these (${list.staples.length})</summary>
        ${aisleHtml(plan, list.shopDay, list.staples, states, false)}
      </details>` : ""}
      ${list.estimated.length ? `<details class="shop-extra">
        <summary>Estimated — category price, not exact (${list.estimated.length})</summary>
        ${aisleHtml(plan, list.shopDay, list.estimated, states, true)}
      </details>` : ""}
      ${essentialsHtml(plan, list.shopDay, states)}
    </section>`;
  }

  let wired = false;
  function render(plan, lists) {
    const meta = document.getElementById("shopping-meta");
    const root = document.getElementById("shopping-root");
    meta.textContent = plan.startDate
      ? `From your plan starting ${plan.startDate} — prices are a hand-entered estimate`
      : "Prices are a hand-entered estimate";
    const open = [...root.querySelectorAll("details[open]")].map((d) => d.querySelector("summary").textContent);
    const states = new Map(MP.Sync.shoppingLines().map((l) => [l.id, l]));
    root.innerHTML = Object.keys(lists).map(Number).sort((a, b) => a - b).filter((d) => !cycleOver(plan, d)).map((d) => blockHtml(plan, lists[d], states)).join("");
    root.querySelectorAll("details").forEach((d) => { if (open.includes(d.querySelector("summary").textContent)) d.open = true; });
    if (wired) return;
    wired = true;

    const idOf = (el) => MP.ShoppingList.planLineId(plan, el.dataset.shop || el.dataset.skip, el.dataset.key);
    root.addEventListener("change", (e) => {
      const input = e.target.closest('input[type="checkbox"]');
      if (!input) return;
      MP.Sync.setLine({ id: idOf(input), state: input.checked ? "got" : "needed", source: "plan" });
      if (input.checked) clearOut(input.dataset.key);
      render(plan, lists);
    });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-skip]");
      if (!b) return;
      const skipped = b.closest(".shop-line").classList.contains("skipped");
      MP.Sync.setLine({ id: idOf(b), state: skipped ? "needed" : "skipped", source: "plan" });
      render(plan, lists);
    });
    // another device may have ticked lines while this tab was hidden
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") MP.Sync.fetchShoppingLines().then(() => { render(plan, lists); renderAdhoc(); });
    });
  }

  // ---- Ad-hoc list: the x: lines of the shared shopping list (Phase 55) ----
  const extras = () => MP.Sync.shoppingLines().filter((l) => l.id.startsWith("x:") && l.state !== "deleted");

  function adhocLineHtml(l) {
    return `<li class="shop-line${l.state === "got" ? " ticked" : ""}">
      <label>
        <input type="checkbox" data-id="${esc(l.id)}" ${l.state === "got" ? "checked" : ""}>
        <span class="shop-qty">${esc(MP.qtyText(l.qty))}</span>
        <span class="shop-name">${esc(l.label)}</span>
      </label>
      <button class="ghost shop-skip" data-del="${esc(l.id)}" aria-label="Remove ${esc(l.label)}">×</button>
    </li>`;
  }

  function adhocHtml(items) {
    const gotCount = items.filter((l) => l.state === "got").length;
    return `<section class="shop-block adhoc">
      ${items.length
        ? `<ul class="shop-list">${items.map(adhocLineHtml).join("")}</ul>`
        : `<p class="muted">Nothing on your ad-hoc list.</p>`}
      ${gotCount ? `<button id="adhoc-clear-btn" class="ghost">Clear got (${gotCount})</button>` : ""}
      <div class="adhoc-add">
        <input type="text" id="adhoc-name" placeholder="Add an item" aria-label="Item name">
        <input type="text" id="adhoc-qty" placeholder="qty (optional)" aria-label="Quantity">
        <button id="adhoc-add-btn" class="ghost">Add</button>
      </div>
    </section>`;
  }

  function renderAdhoc() {
    const root = document.getElementById("adhoc-root");
    if (!root) return;
    const items = extras();
    root.innerHTML = adhocHtml(items);

    root.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", () => {
        MP.Sync.setLine({ id: cb.dataset.id, state: cb.checked ? "got" : "needed" });
        if (cb.checked) clearOut(cb.closest(".shop-line").querySelector(".shop-name").textContent);
        renderAdhoc();
      });
    });
    root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      MP.Sync.setLine({ id: b.dataset.del, state: "deleted" });
      renderAdhoc();
    }));
    const clear = root.querySelector("#adhoc-clear-btn");
    if (clear) clear.addEventListener("click", () => {
      items.filter((l) => l.state === "got").forEach((l) => MP.Sync.setLine({ id: l.id, state: "deleted" }));
      renderAdhoc();
    });

    root.querySelector("#adhoc-add-btn").addEventListener("click", () => {
      const name = root.querySelector("#adhoc-name").value.trim().slice(0, 80);
      if (!name) return;
      const qty = root.querySelector("#adhoc-qty").value.trim();
      MP.Sync.setLine({ id: "x:" + MP.ShoppingList.normalizeKey(name), state: "needed", source: "manual", label: name, ...(qty ? { qty } : {}) });
      renderAdhoc();
    });
  }

  // ---- Pantry tab: read-only pantry, product records, barcode scan (Phase 33a) ----
  const NUTRIENT_ROWS = [
    ["energy_kcal", "Energy", "kcal"], ["protein_g", "Protein", "g"], ["carbohydrate_g", "Carbohydrate", "g"], ["fat_g", "Fat", "g"],
    ["saturates_g", "Saturates", "g"], ["sugars_g", "Sugars", "g"], ["fibre_g", "Fibre", "g"], ["salt_g", "Salt", "g"],
  ];
  const OFF_URL = "https://world.openfoodfacts.org/api/v2/product/";
  const OFF_FIELDS = "?fields=product_name,product_name_en,brands,product_quantity,product_quantity_unit,serving_quantity,nutriments";
  const sheetEl = () => document.getElementById("modal-sheet");
  let stopCamera = () => {};
  let ingredientKeys = null;
  let cofid = null; // cofid.json, loaded once; null while offline = sync skips the fill
  const loadCofid = () => fetch("cofid.json").then((r) => r.json()).then((j) => { cofid = j; }, () => {});

  let packData = null; // pack-sizes.json for the protein-value fallback price; null = only priced products rank
  const proteinText = (v) => `£${v.per25g.toFixed(2)} / 25 g protein${v.estimated ? ' <span class="est" title="Price or protein is an estimate">est.</span>' : ""}`;

  function closeSheet() {
    stopCamera();
    stopCamera = () => {};
    document.getElementById("modal-overlay").classList.add("hidden");
  }

  let sheetDragOn = false;
  function openSheet(html) {
    stopCamera();
    stopCamera = () => {};
    sheetEl().innerHTML = `<button class="close-btn" aria-label="Close">✕</button>${html}`;
    sheetEl().querySelector(".close-btn").addEventListener("click", closeSheet);
    document.getElementById("modal-overlay").classList.remove("hidden");
    if (!sheetDragOn) { sheetDragOn = true; MP.enableSheetDrag(sheetEl(), closeSheet); }
    return sheetEl();
  }

  const fmtNum = (v) => String(Math.round(v * 10) / 10);
  const unitOf = (p) => (p.per === "100ml" ? "ml" : "g");

  function nutrientCell(p, key, unit) {
    const e = p.nutrients[key];
    if (!e) return `<td>—</td><td>—</td>`;
    const est = MP.Products.isEstimate(e) ? ` <span class="est" title="Estimated, not from the label">est.</span>` : "";
    const serv = MP.Products.perServing(p, key);
    return `<td>${fmtNum(e.value)} ${unit}${est}</td><td>${serv === null ? "—" : fmtNum(serv) + " " + unit}</td>`;
  }

  function nutrientTable(p) {
    const rows = NUTRIENT_ROWS.map(([key, label, unit]) => `<tr><th>${label}</th>${nutrientCell(p, key, unit)}</tr>`);
    const extra = Object.keys(p.nutrients).filter((k) => !NUTRIENT_ROWS.some((r) => r[0] === k))
      .map((k) => `<tr><th>${esc(k)}</th>${nutrientCell(p, k, "")}</tr>`);
    return `<table class="prod-table"><thead><tr><th></th><th>Per 100 ${unitOf(p)}</th><th>${p.servingSize ? "Per serving (" + esc(fmtNum(p.servingSize)) + " " + unitOf(p) + ")" : "Per serving"}</th></tr></thead>
      <tbody>${rows.concat(extra).join("")}</tbody></table>`;
  }

  async function loadIngredientKeys() {
    if (ingredientKeys) return ingredientKeys;
    const keys = new Set();
    try {
      const tags = await fetch("ingredient-nutrient-tags.json").then((r) => r.json());
      Object.keys(tags).filter((k) => !k.startsWith("_")).forEach((k) => keys.add(k));
    } catch (e) { /* datalist is a convenience only */ }
    try {
      (await MP.getLibrary()).forEach((m) => (m.ingredients || []).forEach((i) => i.key && keys.add(MP.ShoppingList.normalizeKey(i.key))));
    } catch (e) { /* same */ }
    ingredientKeys = [...keys].sort();
    return ingredientKeys;
  }

  function viewProduct(p, note) {
    const pack = p.pack ? `${esc(fmtNum(p.pack.value))} ${esc(p.pack.unit)}` : "—";
    const sheet = openSheet(`
      <h2>${esc(p.name)}</h2>
      ${note ? `<p class="muted">${esc(note)}</p>` : ""}
      <p class="muted">${[p.brand, p.barcode && "Barcode " + p.barcode, p.ingredient && "Ingredient " + p.ingredient].filter(Boolean).map(esc).join(" · ") || "No brand or barcode"}</p>
      <p class="muted">Pack ${pack} · Price ${p.price == null ? "—" : "£" + esc(p.price.toFixed(2))} · State ${esc(p.state || "—")}</p>
      ${(() => { const v = MP.Products.proteinValue(p, packData); return v ? `<p class="prot-value">${proteinText(v)}</p>` : ""; })()}
      ${nutrientTable(p)}
      ${cofid && Object.values(p.nutrients).some((e) => e.basis === "cofid") ? `<p class="muted fine">${esc(cofid._attribution)}</p>` : ""}
      <div class="modal-actions"><button id="prod-edit" class="btn">Edit</button></div>`);
    sheet.querySelector("#prod-edit").addEventListener("click", () => editProduct(p));
  }

  async function editProduct(p, note) {
    const keys = await loadIngredientKeys();
    const val = (v) => (v == null ? "" : esc(v));
    const nrows = NUTRIENT_ROWS.map(([key, label, unit]) => `<label>${label} (${unit})
      <input type="number" step="any" min="0" inputmode="decimal" data-nutrient="${key}" value="${p.nutrients[key] ? val(p.nutrients[key].value) : ""}"></label>`).join("");
    const sheet = openSheet(`
      <h2>${p.updatedAt && MP.Sync.localProducts().some((x) => x.id === p.id) ? "Edit product" : "New product"}</h2>
      ${note ? `<p class="muted">${esc(note)}</p>` : ""}
      ${p.barcode ? `<p class="muted">Barcode ${esc(p.barcode)}</p>` : ""}
      <div class="prod-form">
        <label>Name <input type="text" id="pf-name" value="${val(p.name)}"></label>
        <label>Brand <input type="text" id="pf-brand" value="${val(p.brand)}"></label>
        <label>Ingredient <input type="text" id="pf-ingredient" list="pf-ingredients" value="${val(p.ingredient)}" placeholder="e.g. chicken_breast">
          <datalist id="pf-ingredients">${keys.map((k) => `<option value="${esc(k)}">`).join("")}</datalist></label>
        <label>Values are per <select id="pf-per"><option value="100g"${p.per === "100g" ? " selected" : ""}>100 g</option><option value="100ml"${p.per === "100ml" ? " selected" : ""}>100 ml</option></select></label>
        <label>Serving size (${unitOf(p)}) <input type="number" step="any" min="0" inputmode="decimal" id="pf-serving" value="${val(p.servingSize)}"></label>
        <label>Pack size <input type="number" step="any" min="0" inputmode="decimal" id="pf-pack" value="${p.pack ? val(p.pack.value) : ""}"></label>
        <label>Pack unit <input type="text" id="pf-packunit" value="${p.pack ? val(p.pack.unit) : ""}" placeholder="g, ml"></label>
        <label>Price (£) <input type="number" step="0.01" min="0" inputmode="decimal" id="pf-price" value="${val(p.price)}"></label>
        <label>State <select id="pf-state">${["", "raw", "cooked", "dry"].map((s) => `<option value="${s}"${(p.state || "") === s ? " selected" : ""}>${s || "—"}</option>`).join("")}</select></label>
        ${nrows}
      </div>
      <p id="pf-msg" class="muted"></p>
      <div class="modal-actions"><button id="pf-save" class="btn">Save</button><button id="pf-cancel" class="ghost">Cancel</button></div>`);
    sheet.querySelector("#pf-cancel").addEventListener("click", closeSheet);
    sheet.querySelector("#pf-save").addEventListener("click", async () => {
      const $ = (id) => sheet.querySelector(id);
      const name = $("#pf-name").value.trim();
      if (!name) { $("#pf-msg").textContent = "Name is required."; return; }
      const n = (id) => (sheet.querySelector(id).value === "" ? null : Number(sheet.querySelector(id).value));
      const packValue = n("#pf-pack"), packUnit = $("#pf-packunit").value.trim();
      let next = {
        ...p, name,
        brand: $("#pf-brand").value.trim() || null,
        ingredient: $("#pf-ingredient").value.trim() ? MP.ShoppingList.normalizeKey($("#pf-ingredient").value) : null,
        per: $("#pf-per").value,
        servingSize: n("#pf-serving") > 0 ? n("#pf-serving") : null,
        pack: packValue > 0 && packUnit ? { value: packValue, unit: packUnit } : null,
        price: n("#pf-price") >= 0 ? n("#pf-price") : null,
        state: $("#pf-state").value || null,
      };
      // Only typed changes become `label`; untouched scanned values keep their basis.
      const typed = {};
      sheet.querySelectorAll("[data-nutrient]").forEach((i) => {
        const cur = next.nutrients[i.dataset.nutrient];
        if (i.value !== "" && (!cur || cur.value !== Number(i.value))) typed[i.dataset.nutrient] = i.value;
      });
      next = MP.Products.setNutrients(next, typed, "label");
      await MP.Sync.saveProduct(next, cofid);
      closeSheet();
      renderPantry();
    });
  }

  function blankProduct(over) {
    return { id: "p-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), barcode: null, name: "", brand: null, ingredient: null,
      per: "100g", servingSize: null, pack: null, price: null, state: null, nutrients: {}, source: "manual", updatedAt: new Date().toISOString(), ...over };
  }

  async function lookup(code, ingredient, msgEl) {
    if (!MP.Products.validBarcode(code)) { msgEl.textContent = "That isn't a valid barcode (check digit fails)."; return; }
    const known = MP.Sync.localProducts().find((p) => p.id === code);
    if (known) { viewProduct(known); return; }
    msgEl.textContent = "Looking up…";
    let found = null, note = "";
    try {
      const res = await fetch(`${OFF_URL}${code}.json${OFF_FIELDS}`);
      found = MP.Products.fromOff(code, await res.json());
      if (!found) note = "Not on Open Food Facts, type the label";
    } catch (e) {
      note = "Couldn't reach Open Food Facts";
    }
    const p = found || blankProduct({ id: code, barcode: code, source: "scan" });
    if (ingredient) p.ingredient = ingredient;
    editProduct(p, note);
  }

  function scanSheet(ingredient) {
    const sheet = openSheet(`
      <h2>Scan a product</h2>
      ${ingredient ? `<p class="muted">Linking to ${esc(ingredient)}</p>` : ""}
      <video id="scan-video" class="scan-video hidden" playsinline muted></video>
      <div class="adhoc-add">
        <input type="text" id="scan-digits" inputmode="numeric" pattern="[0-9]*" placeholder="Barcode digits" aria-label="Barcode digits">
        <button id="scan-go" class="btn">Look up</button>
      </div>
      <p id="scan-msg" class="muted"></p>`);
    const msg = sheet.querySelector("#scan-msg"), digits = sheet.querySelector("#scan-digits");
    const go = () => lookup(digits.value.trim(), ingredient, msg);
    sheet.querySelector("#scan-go").addEventListener("click", go);
    digits.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    startScanner(sheet.querySelector("#scan-video"), (code) => { digits.value = code; go(); });
  }

  // BarcodeDetector over a rear-camera stream; any failure leaves just the digits input.
  async function startScanner(video, onCode) {
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    let stream, timer, stopped = false;
    stopCamera = () => { stopped = true; clearInterval(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); };
    try {
      const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      video.classList.remove("hidden");
      await video.play();
      timer = setInterval(async () => {
        try {
          const [hit] = await detector.detect(video);
          if (hit && !stopped) { stopCamera(); onCode(hit.rawValue); }
        } catch (e) { /* frame not ready */ }
      }, 400);
    } catch (e) {
      stopCamera();
    }
  }

  function chipHtml(p, key) {
    const prot = p.nutrients.protein_g;
    const protText = prot ? ` · ${esc(fmtNum(prot.value))} g protein/100 ${unitOf(p)}${MP.Products.isEstimate(prot) ? ' <span class="est">est.</span>' : ""}` : "";
    return `<button class="prod-chip" data-open="${esc(p.id)}">${[p.brand, p.name].filter(Boolean).map(esc).join(" · ")}${protText}</button>`;
  }

  const localIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const dayName = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const whenText = (n) => (n < 0 ? `${-n}d overdue` : n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n}d`);
  let shelfData = null; // shelf-life.json once loaded; null = no estimates yet
  let expiring = [];

  function useByHtml(item, today, plan) {
    const SL = MP.ShelfLife;
    if (SL.isIsoDate(item.useBy)) {
      const n = Math.round((Date.parse(item.useBy) - Date.parse(today)) / 86400000);
      return `<span class="useby ${n < 0 ? "over" : n <= 2 ? "soon" : ""}">use by ${esc(dayName(item.useBy))}${n < 0 ? " · overdue" : ""}</span>
        <button class="prod-chip muted" data-useby="${esc(item.name)}" aria-label="Change use-by for ${esc(item.name)}">Edit</button>`;
    }
    const est = SL.estimateUseBy(item, plan, today, shelfData);
    if (!est) return "";
    return `<span class="useby est-by">est. use by ${esc(dayName(est))}</span>
      <button class="prod-chip muted" data-useby="${esc(item.name)}">Add use-by</button>`;
  }

  function storageHtml(item) {
    const def = MP.ShelfLife.storageFor({ name: item.name }, shelfData);
    const cur = MP.ShelfLife.STORAGES.includes(item.storage) ? item.storage : "";
    return `<select class="stor-sel" data-stor="${esc(item.name)}" aria-label="Storage for ${esc(item.name)}">
      <option value=""${cur ? "" : " selected"}>${def ? `${def.storage} (est.)` : "storage?"}</option>
      ${MP.ShelfLife.STORAGES.map((s) => `<option value="${s}"${s === cur ? " selected" : ""}>${s}</option>`).join("")}</select>`;
  }

  function pantryHtml(items, products) {
    const today = localIso(), plan = loadPlan();
    expiring = MP.ShelfLife.expiringItems(items, plan, today, 2, shelfData);
    const rows = items.map((item) => {
      const key = MP.ShoppingList.normalizeKey(item.name);
      const p = MP.Products.forIngredient(products, key);
      return `<li class="shop-line prod-row"><span class="shop-qty">${esc(MP.qtyText(item.qty))}</span>
        <span class="shop-name">${esc(item.name)}</span>
        ${useByHtml(item, today, plan)}
        ${storageHtml(item)}
        ${item.out ? `<button class="prod-chip" data-restock="${esc(item.name)}">Out — restocked?</button>` : `<button class="prod-chip muted" data-out="${esc(item.name)}">Ran out</button>`}
        ${p ? chipHtml(p) : `<button class="prod-chip muted" data-link="${esc(key)}">Link product</button>`}</li>`;
    });
    const best = MP.Products.rank(products, packData);
    const all = [...products].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const strip = expiring.length ? `<div class="useup-strip" role="region" aria-label="Use these up">
        <h3>Use these up</h3>
        <ul>${expiring.map((e) => `<li class="${e.daysLeft < 0 ? "over" : ""}"><b>${esc(e.name)}</b> <span>${esc(whenText(e.daysLeft))}${e.basis === "estimate" ? " (est.)" : ""}</span></li>`).join("")}</ul>
        <button id="useup-btn" class="btn">Use it up</button>
      </div>` : "";
    return `<section class="shop-block">
      <div class="top-actions"><button id="scan-btn" class="btn">Scan a product</button><button id="add-product-btn" class="ghost">Add without barcode</button></div>
      ${strip}
      <h3>In your pantry</h3>
      ${rows.length ? `<ul class="shop-list">${rows.join("")}</ul>` : `<p class="empty">Nothing in your pantry.</p>`}
      <h3>All products</h3>
      ${best.length ? `<h3>Best protein value</h3><ol class="shop-list best-protein">${best.map((r) => `<li class="shop-line prod-row">${chipHtml(r.product)} <span class="prot-value">${proteinText(r)}</span></li>`).join("")}</ol>` : ""}
      ${all.length ? `<ul class="shop-list">${all.map((p) => `<li class="shop-line prod-row">${chipHtml(p)}</li>`).join("")}</ul>` : `<p class="empty">No products yet. Scan one to start.</p>`}
    </section>`;
  }

  // The only pantry write here besides commitCook: `useBy` alone, via the same op log.
  function setUseBy(name, useBy) {
    const op = { list: "pantry", type: "useBy", name, useBy };
    MP.Sync.queueOp(op);
    MP.Sync.writeLocalItems("pantry", MP.Sync.applyOps(MP.Sync.localItems("pantry"), [op]));
    MP.Sync.flushOps();
    renderPantry();
  }

  // Phase 39: ran-out flag, same op log. Bought (shopping tick) clears it via an `add`.
  function pantryOp(op) {
    MP.Sync.queueOp({ list: "pantry", ...op });
    MP.Sync.writeLocalItems("pantry", MP.Sync.applyOps(MP.Sync.localItems("pantry"), [{ list: "pantry", ...op }]));
    MP.Sync.flushOps();
  }
  function clearOut(key) {
    const item = MP.Sync.localItems("pantry").find((i) => i.out && MP.ShoppingList.normalizeKey(i.name) === MP.ShoppingList.normalizeKey(key));
    if (item) pantryOp({ type: "add", name: item.name });
  }

  function useByDialog(name) {
    const cur = (MP.Sync.localItems("pantry").find((i) => i.name === name) || {}).useBy;
    const sheet = openSheet(`<h2>Use-by: ${esc(name)}</h2>
      <label class="prod-form"><span>Date</span><input type="date" id="useby-in" value="${esc(MP.ShelfLife.isIsoDate(cur) ? cur : "")}"></label>
      <div class="top-actions"><button id="useby-save" class="btn">Save</button><button id="useby-clear" class="ghost">Clear</button></div>`);
    sheet.querySelector("#useby-save").addEventListener("click", () => {
      const v = sheet.querySelector("#useby-in").value;
      if (!MP.ShelfLife.isIsoDate(v)) return;
      closeSheet(); setUseBy(name, v);
    });
    sheet.querySelector("#useby-clear").addEventListener("click", () => { closeSheet(); setUseBy(name, null); });
  }

  async function useItUpSheet() {
    const library = await MP.getLibrary();
    const found = MP.ShoppingList.mealsUsing(expiring, library);
    const sheet = openSheet(`<h2>Use it up</h2>${found.length
      ? `<ul class="shop-list">${found.map((f, i) => `<li class="shop-line"><button class="prod-chip" data-meal="${i}">${esc(f.meal.name)}</button>
          <span class="muted">uses ${f.hits.map(esc).join(", ")}</span></li>`).join("")}</ul>`
      : `<p class="empty">No meals in your library use these.</p>`}`);
    sheet.querySelectorAll("[data-meal]").forEach((b) => b.addEventListener("click", () => mealSheet(found[b.dataset.meal].meal)));
  }

  function mealSheet(meal) {
    openSheet(`${meal.image ? `<img src="${esc(meal.image)}" alt="${esc(meal.name)}">` : ""}
      <h2>${esc(meal.name)}</h2><p>${esc(meal.description || "")}</p>
      <h3>Ingredients</h3>
      <ul class="ingredient-list">${(meal.ingredients || []).map((i) => `<li>${esc(i.label || i.key)}${i.qty ? " — " + esc(i.qty) : ""}</li>`).join("")}</ul>
      <h3>Instructions</h3><p>${esc(meal.instructions || "")}</p>`);
  }

  function renderPantry() {
    const root = document.getElementById("pantry-root");
    const products = MP.Sync.localProducts();
    root.innerHTML = pantryHtml(MP.Sync.localItems("pantry"), products);
    root.querySelector("#scan-btn").addEventListener("click", () => scanSheet(null));
    root.querySelector("#add-product-btn").addEventListener("click", () => editProduct(blankProduct({})));
    root.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => viewProduct(products.find((p) => p.id === b.dataset.open))));
    root.querySelectorAll("[data-link]").forEach((b) => b.addEventListener("click", () => scanSheet(b.dataset.link)));
    root.querySelectorAll("[data-useby]").forEach((b) => b.addEventListener("click", () => useByDialog(b.dataset.useby)));
    root.querySelectorAll("[data-stor]").forEach((sel) => sel.addEventListener("change", () => { pantryOp({ type: "storage", name: sel.dataset.stor, storage: sel.value || null }); renderPantry(); }));
    root.querySelectorAll("[data-out]").forEach((b) => b.addEventListener("click", () => { pantryOp({ type: "out", name: b.dataset.out }); renderPantry(); }));
    root.querySelectorAll("[data-restock]").forEach((b) => b.addEventListener("click", () => { pantryOp({ type: "add", name: b.dataset.restock }); renderPantry(); }));
    const useup = root.querySelector("#useup-btn");
    if (useup) useup.addEventListener("click", useItUpSheet);
  }

  function initPantry() {
    MP.ShelfLife.load().then((d) => { shelfData = d; renderPantry(); }, () => {});
    renderPantry();
    loadCofid().then(() => MP.ShoppingList.load().then((d) => { packData = d; }, () => {})).then(() => Promise.all([MP.Sync.fetchPantry(), MP.Sync.syncProducts(cofid)])).then(renderPantry);
    const overlay = document.getElementById("modal-overlay");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSheet(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  }

  const TABS = ["planned", "adhoc", "pantry"];
  const tabFromHash = () => { const h = location.hash.slice(1); return TABS.includes(h) ? h : "planned"; };

  // ponytail: no arrow-key roving tabindex; three tabs don't earn one, add it if a tab row ever grows
  function showTab(name) {
    for (const pairName of TABS) {
      const active = pairName === name;
      document.getElementById(`panel-${pairName}`).classList.toggle("hidden", !active);
      const btn = document.getElementById(`tab-${pairName}`);
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    }
  }

  function initTabs() {
    showTab(tabFromHash());
    for (const name of TABS) {
      document.getElementById(`tab-${name}`).addEventListener("click", () => {
        location.hash = `#${name}`;
        showTab(name);
      });
    }
    window.addEventListener("hashchange", () => showTab(tabFromHash()));
  }

  async function init() {
    MP.initTheme();
    initTabs();
    initPantry();
    renderAdhoc();
    MP.Sync.fetchShoppingLines().then(() => renderAdhoc());
    await renderLists();
    window.addEventListener("mp:plan-live", renderLists); // Phase 109: the docked bar changed the plan
  }

  async function renderLists() {
    const plan = loadPlan();
    const root = document.getElementById("shopping-root");
    if (!plan || !plan.days.some((d) => Object.values(d.slots).some((s) => s && s.mealId))) {
      root.innerHTML = `<p class="empty">No plan yet — <a href="plan.html">generate a 2-week plan</a> first.</p>`;
      return;
    }
    const [library, pack, pantry] = await Promise.all([MP.getLibrary(), MP.ShoppingList.load(), MP.Sync.fetchPantry()]);
    packData = pack;
    const mealsById = Object.fromEntries(library.map((m) => [m.id, m]));
    const lists = MP.ShoppingList.buildLists(plan, mealsById, pack, pantry);
    migrateTicked(plan);
    render(plan, lists);
    MP.Sync.fetchShoppingLines().then(() => render(plan, lists));
  }

  init();
})();
