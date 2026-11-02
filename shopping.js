// Shopping list page controller (DOM + localStorage), split from the pure
// MP.ShoppingList module the same way plan.js splits from generator.js.
(function () {
  "use strict";

  const { esc } = MP;
  const LS_PLAN = "mp_plan";
  const LS_TICKED = "mp_shopping_ticked";

  function loadPlan() {
    const stored = localStorage.getItem(LS_PLAN);
    return stored ? MP.dinnersOnly(JSON.parse(stored)) : null;
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

  const SL = () => MP.ShoppingList;
  let plan = null, lists = null, wired = false;
  const openMap = new Map(), doneSeen = new Map(); // aisle card key -> open / was-done (in memory only)
  let justKey = null, justLine = null; // the card / row ticked by the user this render, for the one-off animations

  // ---- Ad-hoc list: the x: lines of the shared shopping list (Phase 55), folded into the aisles (Phase 116) ----
  const extras = () => MP.Sync.shoppingLines().filter((l) => l.id.startsWith("x:") && l.state !== "deleted");
  const adhocLines = () => extras().map((l) => ({ adhoc: true, id: l.id, key: SL().normalizeKey(l.label), label: l.label, qty: l.qty, state: l.state, packs: 1, lineCost: 0, meals: [] }));
  const lineIdOf = (shopDay, l) => (l.adhoc ? l.id : SL().planLineId(plan, shopDay, l.key));
  const stateOf = (shopDay, l, states) => (l.adhoc ? l.state : (states.get(lineIdOf(shopDay, l)) || {}).state);
  const counted = (shopDay, lines, states) => lines.filter((l) => stateOf(shopDay, l, states) !== "skipped");
  const progressOf = (shopDay, lines, states) => SL().progress(counted(shopDay, lines, states), (l) => stateOf(shopDay, l, states) === "got");

  function lineHtml(shopDay, line, states, showPrice) {
    const state = stateOf(shopDay, line, states);
    const classes = ["shop-line"];
    if (state === "got") classes.push("ticked");
    if (state === "skipped") classes.push("skipped");
    if (line.packs === 0) classes.push("covered");
    if (justLine && lineIdOf(shopDay, line) === justLine) classes.push("just-ticked");
    if (line.adhoc) {
      return `<li class="${classes.join(" ")}">
      <label>
        <input type="checkbox" data-id="${esc(line.id)}" ${state === "got" ? "checked" : ""}>
        <span class="shop-qty">${esc(MP.qtyText(line.qty))}</span>
        <span class="shop-name">${esc(line.label)} <span class="added-tag">added</span></span>
      </label>
      <button class="ghost shop-skip" data-del="${esc(line.id)}" aria-label="Remove ${esc(line.label)}">×</button>
    </li>`;
    }
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

  // flat aisle sub-headings: the "Check you have these" / "Estimated" details keep this shape
  function aisleHtml(shopDay, lines, states, canSkip) {
    return SL().groupByAisle(lines, packData).map((g) => `<h4 class="shop-aisle">${esc(g.label)}</h4>
        <ul class="shop-list">${g.lines.map((l) => lineHtml(shopDay, l, states, canSkip)).join("")}</ul>`).join("");
  }

  // Phase 116: one accordion card per aisle. Open state lives in openMap for the page session only.
  function aisleCardHtml(shopDay, group, states, showPrice) {
    const key = shopDay + ":" + group.id;
    const pr = progressOf(shopDay, group.lines, states);
    const done = pr.n > 0 && pr.g === pr.n;
    if (!openMap.has(key)) openMap.set(key, !done);
    const was = doneSeen.get(key);
    let just = false;
    if (done && was === false) {
      if (justKey === key) {
        just = true;
        setTimeout(() => {
          openMap.set(key, false);
          const c = [...document.querySelectorAll(".aisle-card")].find((x) => x.dataset.aisle === key);
          if (c) setOpen(c, false);
        }, 900);
      } else openMap.set(key, false); // completed from another device: collapse without the bump
    } else if (!done && was) openMap.set(key, true);
    doneSeen.set(key, done);
    const open = openMap.get(key);
    return `<section class="aisle-card${done ? " done" : ""}${just ? " just" : ""}${open ? " open" : ""}" data-aisle="${esc(key)}">
      <h4 class="ah"><button type="button" class="ah-btn" aria-expanded="${open}">
        <span class="ah-name">${esc(group.label)}</span><span class="ah-count">${pr.g}/${pr.n}</span>
        <span class="ah-bar" aria-hidden="true"><i style="transform:scaleX(${pr.n ? pr.g / pr.n : 0})"></i></span><span class="ah-chev" aria-hidden="true"></span>
      </button></h4>
      <div class="ab"><div class="ab-in"><ul class="shop-list">${group.lines.map((l) => lineHtml(shopDay, l, states, showPrice)).join("")}</ul></div></div>
    </section>`;
  }

  function setOpen(card, open) {
    card.classList.toggle("open", open);
    card.querySelector(".ah-btn").setAttribute("aria-expanded", String(open));
  }

  const isoPlus = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  // Phase 68: a rolling plan names the cycle by its shop date; a fixed plan keeps "Shop day N"
  function shopHeading(shopDay) {
    return plan.shopAnchor && plan.startDate ? `Shop ${esc(isoPlus(plan.startDate, shopDay - 1))}` : `Shop day ${shopDay}`;
  }
  // a cycle whose shop date + 7 is already past (only before the next roll) is hidden for rolling plans
  function cycleOver(shopDay) {
    return !!plan.shopAnchor && plan.startDate && isoPlus(plan.startDate, shopDay + 6) <= new Date().toLocaleDateString("en-CA");
  }

  // Always-on checklist at the end of every shop: pack-sizes.json "essentials", unpriced, ticks sync like any plan line
  function essentialLines() {
    return ((packData && packData.essentials) || []).map((n) => ({ key: "essential-" + SL().normalizeKey(n), label: n, essential: true, packs: 1, meals: [] }));
  }

  function blockHtml(list, states, first) {
    const lines = first ? list.lines.concat(adhocLines()) : list.lines;
    const ess = essentialLines();
    return `<section class="shop-block">
      <h3>${shopHeading(list.shopDay)} <span class="shop-total">£${list.total.toFixed(2)}</span></h3>
      ${SL().groupByAisle(lines, packData).map((g) => aisleCardHtml(list.shopDay, g, states, true)).join("")}
      ${list.staples.length ? `<details class="shop-extra">
        <summary>Check you have these (${list.staples.length})</summary>
        ${aisleHtml(list.shopDay, list.staples, states, false)}
      </details>` : ""}
      ${list.estimated.length ? `<details class="shop-extra">
        <summary>Estimated — category price, not exact (${list.estimated.length})</summary>
        ${aisleHtml(list.shopDay, list.estimated, states, true)}
      </details>` : ""}
      ${ess.length ? aisleCardHtml(list.shopDay, { id: "essentials", label: "Essentials", lines: ess }, states, false) : ""}
    </section>`;
  }

  // ---- Dock (Phase 116): total vs budget, trolley, Finish shop. Display only: the total is list.total. ----
  let dockWanted = false, currentTab = "planned";
  function applyDock() {
    const dock = document.getElementById("shop-dock");
    const show = dockWanted && currentTab === "planned";
    dock.hidden = !show;
    document.body.classList.toggle("has-dock", show);
    document.documentElement.style.setProperty("--dock-h", show ? dock.offsetHeight + "px" : "0px");
    placeDock();
  }
  // The "I ate" bar grows (hint, thread): sit the dock on its measured top edge, not a fixed guess.
  function placeDock() {
    const bar = document.querySelector(".ate-bar");
    if (!bar) return;
    document.body.style.setProperty("--dock-b", Math.max(0, Math.round(innerHeight - bar.getBoundingClientRect().top)) + "px");
  }
  window.addEventListener("resize", placeDock);
  new MutationObserver(placeDock).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });

  function drawDock(states, first) {
    const dock = document.getElementById("shop-dock");
    const lines = first ? first.lines.concat(adhocLines(), essentialLines()) : adhocLines();
    const shopDay = first ? first.shopDay : 0;
    dockWanted = lines.length > 0;
    if (!dockWanted) { applyDock(); return; }
    const pr = progressOf(shopDay, lines, states);
    const budget = MP.PlanPrefs ? MP.PlanPrefs.get().budgetTarget : 0;
    const total = first ? first.total : null;
    const hasBudget = total != null && budget > 0, diff = budget - total;
    dock.innerHTML = `<div class="dock-row"><div class="dock-main">
        ${total != null ? `<b class="dock-total">£${total.toFixed(2)}</b>` : ""}
        ${hasBudget ? `<span class="dock-budget">of £${budget.toFixed(0)} budget · ${diff >= 0 ? `£${diff.toFixed(2)} left` : `£${(-diff).toFixed(2)} over`}</span>` : ""}
      </div><button type="button" id="finish-shop" class="btn"${pr.g === pr.n ? "" : " disabled"}>Finish shop</button></div>
      ${hasBudget ? `<div class="dock-bar${diff < 0 ? " over" : ""}" aria-hidden="true"><i style="transform:scaleX(${Math.min(1, total / budget)})"></i></div>` : ""}
      <div class="dock-sub">In trolley £<span class="dock-tv">${pr.gotCost.toFixed(2)}</span> · <span class="dock-ticked">${pr.g} of ${pr.n} ticked</span></div>`;
    applyDock();
  }

  function toast(msg, label, onAction) {
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = msg;
    if (label) {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", () => { el.remove(); onAction(); });
      el.appendChild(b);
    }
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 8000);
  }

  // ---- Phase 119: the Finish shop review sheet. Confirm is the second pantry writer (one batch via reviewOps, with Undo) ----
  let rv = null; // { rows, left } while the sheet is open
  const rvStep = (unit) => (unit === "g" || unit === "ml" ? 100 : 1);
  const rvNum = (n, unit) => `${Math.round(n * 10) / 10}${unit === "each" ? "" : unit}`;

  function reviewRows() {
    const first = lists && Object.keys(lists).length ? lists[Object.keys(lists).map(Number).sort((a, b) => a - b).filter((d) => !cycleOver(d))[0]] : null;
    const states = new Map(MP.Sync.shoppingLines().map((l) => [l.id, l]));
    const today = localIso(), rows = [], left = [];
    const mk = (name, amt, need, freeze, adhoc) => {
      const st = MP.ShelfLife.storageFor({ name }, shelfData);
      const store = st ? st.storage : null;
      const est = MP.ShelfLife.estimateUseBy({ name, storage: store }, plan, today, shelfData);
      return { name, unit: amt.unit, amount: amt.value, need, freeze: Math.min(freeze, amt.value), store, useBy: est || "", adhoc, id: adhoc };
    };
    (first ? first.lines : []).forEach((l) => {
      if (!(l.packs > 0)) return;
      const state = stateOf(first.shopDay, l, states);
      if (state !== "got") { left.push(l.label); return; }
      const amt = l.needed ? { value: l.needed.value, unit: l.needed.unit } : { value: l.packs, unit: "each" };
      const fz = l.bulk && l.bulk.freeze > 0 ? l.bulk.freeze : 0;
      const r = mk(l.label, amt, l.needed ? Math.max(0, l.needed.value - (l.bulk ? fz : 0)) : amt.value, fz, null);
      r.freeze = Math.min(fz, amt.value);
      rows.push(r);
    });
    extras().filter((l) => l.state === "got").forEach((l) => {
      const q = SL().parseQty(l.qty) || { value: 1, unit: "each" };
      rows.push(mk(l.label, q, q.value, 0, l.id));
    });
    return { rows, left };
  }

  function rvRowHtml(r, i) {
    const items = MP.Sync.localItems("pantry");
    const old = items.find((x) => SL().normalizeKey(x.name) === SL().normalizeKey(r.name));
    const replaces = old && old.qty && !SL().sumQty(old.qty, { value: r.amount, unit: r.unit });
    const split = !r.adhoc && r.store !== "freezer";
    return `<li class="rv-row" data-i="${i}">
      <div class="rv-top"><b>${esc(r.name)}</b>${r.adhoc ? ` <span class="added-tag">added</span>` : ` <span class="muted">plan needs ${esc(rvNum(r.need, r.unit))}</span>`}</div>
      ${split ? `<div class="rv-split" role="group" aria-label="Split ${esc(r.name)}">
        <div class="rv-col"><span>Use this week</span><b class="rv-use">${esc(rvNum(r.amount - r.freeze, r.unit))}</b></div>
        <div class="rv-step"><button type="button" class="ghost" data-mv="-1" aria-label="Move ${esc(rvNum(rvStep(r.unit), r.unit))} to this week"${r.freeze <= 0 ? " disabled" : ""}>−</button><button type="button" class="ghost" data-mv="1" aria-label="Move ${esc(rvNum(rvStep(r.unit), r.unit))} to the freezer"${r.freeze >= r.amount ? " disabled" : ""}>+</button></div>
        <div class="rv-col"><span>To freezer</span><b class="rv-fz">${esc(rvNum(r.freeze, r.unit))}</b></div>
        <button type="button" class="chip" data-rest>Rest after plan</button></div>` : ""}
      <div class="rv-fields">
        <label>Amount <input type="number" min="0" step="any" value="${r.amount}" data-amt aria-label="Amount of ${esc(r.name)}"> ${esc(r.unit === "each" ? "" : r.unit)}</label>
        <span class="rv-store" role="radiogroup" aria-label="Storage for ${esc(r.name)}">${MP.ShelfLife.STORAGES.map((st) => `<label><input type="radio" name="rv-st-${i}" value="${st}" data-store${st === r.store ? " checked" : ""}> ${st[0].toUpperCase() + st.slice(1)}</label>`).join("")}</span>
        <label>Use-by <input type="date" value="${esc(r.useBy)}" data-ub aria-label="Use-by for ${esc(r.name)}"></label>
      </div>
      ${replaces ? `<p class="rv-note">replaces what you had (${esc(MP.qtyText(old.qty))})</p>` : ""}
    </li>`;
  }

  function openReviewSheet() {
    rv = reviewRows();
    const sheet = openSheet(`<div id="shop-review"><h2>Finish shop</h2>
      <p class="muted">Confirm what you bought. Split any of it between this week and the freezer.</p>
      ${rv.rows.length ? `<ul class="rv-list">${rv.rows.map(rvRowHtml).join("")}</ul>` : `<p class="empty">Nothing ticked</p>`}
      ${rv.left.length ? `<p class="rv-left muted">Left out, not ticked: ${rv.left.map(esc).join(", ")}</p>` : ""}
      <button type="button" class="ghost" id="rv-photo" disabled>Fill from order photo</button>
      <p class="muted rv-photo-note">Hermes will read a photo of your order and fill this in. Not built yet.</p>
      <div class="top-actions"><button type="button" class="btn" id="rv-confirm">Confirm</button></div></div>`);
    const box = sheet.querySelector("#shop-review"); // fresh per open, so listeners never stack on the shared sheet
    const redraw = (li, focus) => {
      const i = +li.dataset.i;
      li.insertAdjacentHTML("afterend", rvRowHtml(rv.rows[i], i));
      const next = li.nextElementSibling;
      li.remove();
      const f = focus && (next.querySelector(focus) || next.querySelector("[data-mv]:not(:disabled)"));
      if (f) f.focus();
    };
    // typing an amount updates the split in place: replacing nodes mid-edit would swallow the next click
    const syncSplit = (li, r) => {
      const use = li.querySelector(".rv-use"), fz = li.querySelector(".rv-fz");
      if (!use) return;
      use.textContent = rvNum(r.amount - r.freeze, r.unit); fz.textContent = rvNum(r.freeze, r.unit);
      li.querySelector('[data-mv="-1"]').disabled = r.freeze <= 0; li.querySelector('[data-mv="1"]').disabled = r.freeze >= r.amount;
    };
    box.addEventListener("click", (e) => {
      const li = e.target.closest(".rv-row");
      if (li) {
        const r = rv.rows[li.dataset.i], mv = e.target.closest("[data-mv]");
        if (mv) { r.freeze = Math.max(0, Math.min(r.amount, r.freeze + (+mv.dataset.mv) * rvStep(r.unit))); redraw(li, `[data-mv="${mv.dataset.mv}"]:not(:disabled)`); }
        else if (e.target.closest("[data-rest]")) { r.freeze = Math.max(0, Math.min(r.amount, r.amount - r.need)); redraw(li, "[data-rest]"); }
      }
      if (e.target.closest("#rv-confirm:not(:disabled)")) confirmReview(e.target.closest("#rv-confirm"));
    });
    box.addEventListener("input", (e) => {
      const li = e.target.closest(".rv-row");
      if (!li || !e.target.matches("[data-amt]")) return;
      const r = rv.rows[li.dataset.i];
      r.amount = Math.max(0, Number(e.target.value) || 0); r.freeze = Math.min(r.freeze, r.amount); syncSplit(li, r);
    });
    box.addEventListener("change", (e) => {
      const li = e.target.closest(".rv-row");
      if (!li) return;
      const r = rv.rows[li.dataset.i];
      if (e.target.matches("[data-store]")) { r.store = e.target.value; redraw(li, `[data-store][value="${r.store}"]`); }
      else if (e.target.matches("[data-ub]")) r.useBy = e.target.value;
    });
  }

  function confirmReview(btn) {
    if (!rv) return;
    btn.disabled = true;
    const today = localIso(), done = extras().filter((l) => l.state === "got");
    const rows = rv.rows.map((r) => ({ name: r.name, amount: { value: r.amount, unit: r.unit }, freeze: r.freeze, store: r.store, useBy: r.useBy, wholeFreezer: r.store === "freezer" }));
    const { ops, undoOps } = SL().reviewOps(rows, MP.Sync.localItems("pantry"), today);
    const write = (list) => { list.forEach((o) => MP.Sync.queueOp(o)); MP.Sync.writeLocalItems("pantry", MP.Sync.applyOps(MP.Sync.localItems("pantry"), list)); MP.Sync.flushOps(); };
    if (ops.length) write(ops);
    done.forEach((l) => MP.Sync.setLine({ id: l.id, state: "deleted" }));
    rv = null;
    closeSheet();
    render();
    const n = ops.filter((o) => o.type === "add").length, m = ops.filter((o) => o.type === "storage" && o.storage === "freezer").length;
    toast(`${n} entries added to the pantry, ${m} in the freezer`, "Undo", () => {
      if (undoOps.length) write(undoOps);
      done.forEach((l) => MP.Sync.setLine({ id: l.id, state: "got" }));
      render(); renderPantry();
    });
    renderPantry();
  }

  function render() {
    const meta = document.getElementById("shopping-meta");
    const root = document.getElementById("shopping-root");
    meta.textContent = plan && plan.startDate
      ? `From your plan starting ${plan.startDate} — prices are a hand-entered estimate`
      : "Prices are a hand-entered estimate";
    const open = [...root.querySelectorAll("details[open]")].map((d) => d.querySelector("summary").textContent);
    const states = new Map(MP.Sync.shoppingLines().map((l) => [l.id, l]));
    const shown = lists ? Object.keys(lists).map(Number).sort((a, b) => a - b).filter((d) => !cycleOver(d)) : [];
    const adhoc = adhocLines();
    if (shown.length) {
      root.innerHTML = shown.map((d, i) => blockHtml(lists[d], states, i === 0)).join("");
    } else {
      root.innerHTML = (lists ? "" : `<p class="empty">No plan yet — <a href="plan.html">generate a 2-week plan</a> first.</p>`)
        + (adhoc.length ? `<section class="shop-block">${SL().groupByAisle(adhoc, packData).map((g) => aisleCardHtml(0, g, states, false)).join("")}</section>` : "");
    }
    root.querySelectorAll("details").forEach((d) => { if (open.includes(d.querySelector("summary").textContent)) d.open = true; });
    drawDock(states, shown.length ? lists[shown[0]] : null);
    justKey = justLine = null;
  }

  function wireList() {
    if (wired) return;
    wired = true;
    const root = document.getElementById("shopping-root");
    root.addEventListener("change", (e) => {
      const input = e.target.closest('input[type="checkbox"]');
      if (!input) return;
      const card = input.closest(".aisle-card");
      justKey = card ? card.dataset.aisle : null;
      if (input.dataset.id) {
        justLine = input.checked ? input.dataset.id : null;
        MP.Sync.setLine({ id: input.dataset.id, state: input.checked ? "got" : "needed" });
        if (input.checked) clearOut(input.closest(".shop-line").querySelector(".shop-name").firstChild.textContent.trim());
      } else {
        const id = SL().planLineId(plan, input.dataset.shop, input.dataset.key);
        justLine = input.checked ? id : null;
        MP.Sync.setLine({ id, state: input.checked ? "got" : "needed", source: "plan" });
        if (input.checked) clearOut(input.dataset.key);
      }
      render();
    });
    root.addEventListener("click", (e) => {
      const h = e.target.closest(".ah-btn");
      if (h) {
        const card = h.closest(".aisle-card");
        const open = !card.classList.contains("open");
        openMap.set(card.dataset.aisle, open);
        setOpen(card, open);
        return;
      }
      const del = e.target.closest("[data-del]");
      if (del) { MP.Sync.setLine({ id: del.dataset.del, state: "deleted" }); render(); return; }
      const b = e.target.closest("[data-skip]");
      if (!b) return;
      const skipped = b.closest(".shop-line").classList.contains("skipped");
      MP.Sync.setLine({ id: SL().planLineId(plan, b.dataset.skip, b.dataset.key), state: skipped ? "needed" : "skipped", source: "plan" });
      render();
    });
    document.getElementById("shop-dock").addEventListener("click", (e) => { if (e.target.closest("#finish-shop:not(:disabled)")) openReviewSheet(); });
    new ResizeObserver(() => { if (!document.getElementById("shop-dock").hidden) applyDock(); }).observe(document.getElementById("shop-dock"));
    document.getElementById("adhoc-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("adhoc-name").value.trim().slice(0, 80);
      if (!name) return;
      const qty = document.getElementById("adhoc-qty").value.trim();
      MP.Sync.setLine({ id: "x:" + SL().normalizeKey(name), state: "needed", source: "manual", label: name, ...(qty ? { qty } : {}) });
      e.target.reset();
      render();
    });
    // another device may have ticked lines while this tab was hidden
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") MP.Sync.fetchShoppingLines().then(render);
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
    const wasReview = !!sheetEl().querySelector("#shop-review") && !document.getElementById("modal-overlay").classList.contains("hidden");
    if (wasReview) rv = null;
    stopCamera();
    stopCamera = () => {};
    document.getElementById("modal-overlay").classList.add("hidden");
    if (wasReview) { const f = document.getElementById("finish-shop"); if (f) f.focus(); }
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

  function frozenChip(item, today) {
    const w = item.storage === "freezer" ? MP.ShelfLife.frozenWeeks(item, today) : null;
    return w == null ? "" : `<span class="frz-chip${w >= 8 ? " soon" : ""}">${w < 1 ? "just frozen" : `${w} wk${w >= 8 ? " · use soon" : ""}`}</span>`;
  }

  function pantryHtml(items, products) {
    const today = localIso(), plan = loadPlan();
    expiring = MP.ShelfLife.expiringItems(items, plan, today, 2, shelfData);
    const rowOf = (item) => {
      const key = MP.ShoppingList.normalizeKey(item.name);
      const p = MP.Products.forIngredient(products, key);
      return `<li class="shop-line prod-row${item.out ? " used-up" : ""}">
        <input type="checkbox" class="pan-tick" data-tick="${esc(item.name)}"${item.out ? " checked" : ""} aria-label="Used up: ${esc(item.name)}">
        <input type="text" class="pan-qty" data-qty="${esc(item.name)}" value="${esc(MP.qtyText(item.qty))}" placeholder="qty" aria-label="Quantity of ${esc(item.name)}">
        <span class="shop-name">${esc(item.name)}</span>
        ${frozenChip(item, today)}
        ${useByHtml(item, today, plan)}
        ${storageHtml(item)}
        <button class="prod-chip muted" data-rm="${esc(item.name)}" aria-label="Remove ${esc(item.name)}">✕</button>
        ${p ? chipHtml(p) : `<button class="prod-chip muted" data-link="${esc(key)}">Link product</button>`}</li>`;
    };
    const frozen = items.filter((i) => i.storage === "freezer" && !i.out).sort((a, b) => (a.frozenOn || "9999").localeCompare(b.frozenOn || "9999"));
    const rest = items.filter((i) => !frozen.includes(i));
    const list = (arr) => `<ul class="shop-list">${arr.map(rowOf).join("")}</ul>`;
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
      <form id="pan-add" class="top-actions"><input id="pan-add-name" placeholder="Add item" required aria-label="Item name"><input id="pan-add-qty" placeholder="qty (optional)" aria-label="Quantity"><button class="btn">Add</button></form>
      ${frozen.length ? `<h3 class="pan-group">In the freezer</h3>${list(frozen)}` : ""}
      ${frozen.length && rest.length ? `<h3 class="pan-group">Fridge &amp; cupboard</h3>` : ""}
      ${rest.length ? list(rest) : frozen.length ? "" : `<p class="empty">Nothing in your pantry.</p>`}
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
    root.querySelectorAll("[data-tick]").forEach((c) => c.addEventListener("change", () => { pantryOp(c.checked ? { type: "out", name: c.dataset.tick } : { type: "add", name: c.dataset.tick }); renderPantry(); }));
    root.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { pantryOp({ type: "remove", name: b.dataset.rm }); renderPantry(); }));
    root.querySelectorAll("[data-qty]").forEach((i) => i.addEventListener("change", () => {
      const name = i.dataset.qty, ub = (MP.Sync.localItems("pantry").find((x) => x.name === name) || {}).useBy;
      pantryOp({ type: "add", name, qty: i.value.trim() });
      if (ub) pantryOp({ type: "useBy", name, useBy: ub }); // an `add` with qty drops useBy
      renderPantry();
    }));
    root.querySelector("#pan-add").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = root.querySelector("#pan-add-name").value.trim(), qty = root.querySelector("#pan-add-qty").value.trim();
      if (name) { pantryOp(qty ? { type: "add", name, qty } : { type: "add", name }); renderPantry(); }
    });
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

  const TABS = ["planned", "pantry"];
  const tabFromHash = () => { const h = location.hash.slice(1); return TABS.includes(h) ? h : "planned"; };

  // ponytail: no arrow-key roving tabindex; three tabs don't earn one, add it if a tab row ever grows
  function showTab(name) {
    currentTab = name;
    applyDock();
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
    wireList();
    await renderLists();
    window.addEventListener("mp:plan-live", renderLists); // Phase 109: the docked bar changed the plan
  }

  async function renderLists() {
    plan = loadPlan();
    if (!plan || !plan.days.some((d) => Object.values(d.slots).some((s) => s && s.mealId))) {
      plan = null; lists = null;
      packData = packData || await MP.ShoppingList.load().catch(() => null);
      render();
      MP.Sync.fetchShoppingLines().then(render);
      return;
    }
    const [library, pack, pantry] = await Promise.all([MP.getLibrary(), MP.ShoppingList.load(), MP.Sync.fetchPantry()]);
    packData = pack;
    const mealsById = Object.fromEntries(library.map((m) => [m.id, m]));
    lists = MP.ShoppingList.buildLists(plan, mealsById, pack, pantry);
    migrateTicked(plan);
    render();
    MP.Sync.fetchShoppingLines().then(render);
  }

  init();
})();
