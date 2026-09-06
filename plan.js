// 2-Week Plan page controller.
(function () {
  "use strict";

  const { esc, labelize } = MP;
  const LS_PLAN = "mp_plan";
  const SLOT_TYPES = ["breakfast", "lunch", "dinner", "snack"];

  const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let library = [];
  let mealsById = {};
  let tagsData = null;
  let shelfData = null;
  let plan = null;
  let warnings = {}; // "day-slotType" -> { message, moveToDay, category }; owned by renderPlan

  function toast(msg) {
    const root = document.getElementById("toast-root");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  function generatePlan() {
    return MP.Generator.generatePlan(library, tagsData.tags, tagsData.targets, shelfData);
  }

  function loadPlan() {
    const stored = localStorage.getItem(LS_PLAN);
    return stored ? JSON.parse(stored) : generatePlan();
  }

  function savePlan() {
    localStorage.setItem(LS_PLAN, JSON.stringify(plan));
    window.dispatchEvent(new CustomEvent("mp:plan-saved", { detail: plan }));
  }

  function mealAt(day, slotType) {
    const slot = plan.days[day - 1].slots[slotType];
    return slot && slot.mealId ? mealsById[slot.mealId] : null;
  }

  /** The planned meal with its slot's variant (if any) resolved. */
  function effectiveMealAt(day, slotType) {
    const meal = mealAt(day, slotType);
    if (!meal) return null;
    const slot = plan.days[day - 1].slots[slotType];
    return MP.effectiveMeal(meal, slot.variantId);
  }

  function dayMeals(day) {
    return SLOT_TYPES.map((s) => effectiveMealAt(day, s)).filter(Boolean);
  }

  /** Shared slot-write paths: a meal change always starts a fresh slot object
   *  (no stale variantId from the meal it replaced); a variant change never
   *  touches the meal. */
  function setSlotMeal(day, slotType, mealId) {
    plan.days[day - 1].slots[slotType] = { mealId };
    savePlan();
  }

  function setSlotVariant(day, slotType, variantId) {
    const slot = { ...plan.days[day - 1].slots[slotType] };
    if (variantId) slot.variantId = variantId;
    else delete slot.variantId;
    plan.days[day - 1].slots[slotType] = slot;
    savePlan();
  }

  function tagRowHtml(meal) {
    const map = {};
    for (const ing of meal.ingredients || []) {
      const t = tagsData.tags[ing.key];
      if (!t) continue;
      for (const [n, l] of Object.entries(t)) {
        const w = { high: 3, med: 2, low: 1 }[l];
        if (!map[n] || w > map[n].w) map[n] = { level: l, w };
      }
    }
    const tags = Object.entries(map).sort((a, b) => b[1].w - a[1].w).slice(0, 3);
    if (!tags.length) return "";
    return `<div class="tag-row">${tags
      .map(([n, v]) => `<span class="tag ${v.level}">${esc(labelize(n))} ${esc(v.level)}</span>`)
      .join("")}</div>`;
  }

  function coverageHtml(meals) {
    const cov = MP.Nutrition.dayCoverage(meals, tagsData.tags, tagsData.targets);
    const shortList = [...cov.missing, ...cov.partial];
    const bits = [
      `Protein ~${cov.proteinGramsApprox}g / ${cov.proteinTarget}g (approx)`,
      shortList.length ? `Short on: ${shortList.map(labelize).join(", ")}` : "All tracked nutrients covered",
    ];
    if (cov.sodiumCaution) bits.push("⚠ high sodium day");
    return `<div class="coverage-list"><span class="tag">${bits.join(" · ")}</span></div>`;
  }

  function warningHtml(day, slotType, warn) {
    if (!warn) return "";
    return `<span class="slot-warning">${esc(warn.message)} <button class="ghost move-btn" data-day="${day}" data-slot="${slotType}" data-moveto="${warn.moveToDay}">Move to day ${warn.moveToDay}</button></span>`;
  }

  function ingredientListHtml(meal) {
    return (meal.ingredients || [])
      .map((i) => `<li>${esc(i.label || labelize(i.key))}${i.qty ? " — " + esc(i.qty) : ""}</li>`)
      .join("");
  }

  function wireMoveBtns(scope) {
    scope.querySelectorAll(".move-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        moveSlot(Number(btn.dataset.day), btn.dataset.slot, Number(btn.dataset.moveto));
      });
    });
  }

  function dayHeading(day) {
    return plan.startDate
      ? `Day ${day} · ${WEEKDAY[MP.Generator.weekdayOf(plan.startDate, day)]}`
      : `Day ${day}`;
  }

  function renderPlan() {
    mealsById = Object.fromEntries(library.map((m) => [m.id, m]));
    warnings = MP.ShelfLife.checkPlanWarnings(plan, mealsById, shelfData);
    const root = document.getElementById("plan-root");
    let html = "";
    for (const weekStart of [1, 8]) {
      const weekDays = plan.days.slice(weekStart - 1, weekStart + 6);
      const weekMeals = weekDays.flatMap((d) => dayMeals(d.day));
      const weekCov = MP.Nutrition.weekCoverage([weekMeals], tagsData.tags, tagsData.targets);
      const weekShort = [...weekCov.missing, ...weekCov.partial];
      html += `<div class="week-block">
        <h2>Week ${weekStart === 1 ? 1 : 2}</h2>
        <div class="week-summary">Protein ~${weekCov.proteinGramsApprox}g total ·
          ${weekShort.length ? "Short across the week: " + weekShort.map(labelize).join(", ") : "All tracked nutrients covered this week"}
        </div>`;
      for (const d of weekDays) {
        const heading = dayHeading(d.day);
        html += `<div class="day-row" data-day="${d.day}">
          <h3>${heading}</h3>
          <div class="slot-grid">
            ${SLOT_TYPES.map((slotType) => {
              const meal = mealAt(d.day, slotType);
              const warn = warnings[`${d.day}-${slotType}`];
              return `<div class="slot-card ${meal ? "" : "empty"}" data-day="${d.day}" data-slot="${slotType}">
                <div class="slot-type">${slotType}</div>
                <div class="slot-meal">${meal ? esc(meal.name) : "tap to add"}</div>
                ${warningHtml(d.day, slotType, warn)}
              </div>`;
            }).join("")}
          </div>
          ${coverageHtml(dayMeals(d.day))}
        </div>`;
      }
      html += `</div>`;
    }
    root.innerHTML = html;

    root.querySelectorAll(".slot-card").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".move-btn")) return;
        openDayView(Number(el.dataset.day));
      });
    });
    wireMoveBtns(root);
    if (dayCtx) renderDayView();
  }

  function moveSlot(day, slotType, moveToDay) {
    const a = plan.days[day - 1].slots[slotType];
    const b = plan.days[moveToDay - 1].slots[slotType];
    plan.days[day - 1].slots[slotType] = b;
    plan.days[moveToDay - 1].slots[slotType] = a;
    savePlan();
    renderPlan();
    toast(`Swapped day ${day} and day ${moveToDay} ${slotType}`);
  }

  // ---- Swap picker ----
  let swapCtx = null; // { day, slotType, candidates }

  function candidatesFor(day, slotType) {
    const slot = plan.days[day - 1].slots[slotType];
    const currentId = slot ? slot.mealId : null;
    const others = SLOT_TYPES.filter((s) => s !== slotType).flatMap((s) => {
      const m = effectiveMealAt(day, s);
      return m ? [m] : [];
    });
    const gapCov = MP.Nutrition.dayCoverage(others, tagsData.tags, tagsData.targets);
    const gapNutrients = [...gapCov.missing, ...gapCov.partial];
    const pool = library.filter((m) => m.mealTypes.includes(slotType) && m.id !== currentId);
    return MP.Nutrition.rankByGap(pool, gapNutrients, tagsData.tags);
  }

  function openSwapPicker(day, slotType) {
    swapCtx = { day, slotType, candidates: candidatesFor(day, slotType) };
    renderSwapDeck();
    document.getElementById("swap-overlay").classList.remove("hidden");
  }

  function closeSwapPicker() {
    document.getElementById("swap-overlay").classList.add("hidden");
    swapCtx = null;
    variantCtx = null;
  }

  // ---- Variant picker (reuses the swap overlay/sheet) ----
  let variantCtx = null; // { day, slotType, meal }

  function openVariantPicker(day, slotType) {
    const meal = mealAt(day, slotType);
    if (!meal || !meal.variants || !meal.variants.length) return;
    variantCtx = { day, slotType, meal };
    renderVariantPicker();
    document.getElementById("swap-overlay").classList.remove("hidden");
  }

  function renderVariantPicker() {
    const sheet = document.getElementById("swap-sheet");
    const { day, slotType, meal } = variantCtx;
    const slot = plan.days[day - 1].slots[slotType];
    const current = slot.variantId || null;
    const options = [{ id: null, name: "Original" }, ...meal.variants];
    sheet.innerHTML = `<button class="close-btn" aria-label="Close">✕</button>
      <h2>Choose a variant — ${esc(meal.name)}</h2>
      <div class="variant-options">${options
        .map((o) => `<button class="ghost variant-option${o.id === current ? " active" : ""}" data-id="${o.id ? esc(o.id) : ""}">${esc(o.name)}</button>`)
        .join("")}</div>`;
    sheet.querySelector(".close-btn").addEventListener("click", closeSwapPicker);
    sheet.querySelectorAll(".variant-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        const label = btn.textContent;
        setSlotVariant(day, slotType, btn.dataset.id || null);
        closeSwapPicker();
        renderPlan();
        toast(`Using ${label}`);
      });
    });
  }

  function renderSwapDeck() {
    const sheet = document.getElementById("swap-sheet");
    const heading = `<button class="close-btn" aria-label="Close">✕</button>
      <h2>Swap ${esc(swapCtx.slotType)} — Day ${swapCtx.day}</h2>
      <p class="swipe-hint" style="margin-top:0;">Recommended swaps are sorted first based on what today is short on.<br>
      Swipe right to confirm · swipe left to skip · tap to view recipe</p>
      <div id="swap-deck" class="swipe-deck" style="height:340px;"></div>`;
    sheet.innerHTML = heading;
    sheet.querySelector(".close-btn").addEventListener("click", closeSwapPicker);
    renderSwapCards();
  }

  function renderSwapCards() {
    const deck = document.getElementById("swap-deck");
    if (!deck) return;
    deck.innerHTML = "";
    if (!swapCtx.candidates.length) {
      deck.innerHTML = `<div class="swipe-empty">No other meals in your library for this slot yet — add some on the Browse & Add page.</div>`;
      return;
    }
    swapCtx.candidates.slice(0, 3).forEach((meal, idx) => {
      const card = document.createElement("div");
      card.className = "swipe-card";
      card.style.zIndex = String(10 - idx);
      card.style.transform = `scale(${1 - idx * 0.03}) translateY(${idx * 10}px)`;
      card.innerHTML = `
        ${meal.image ? `<img class="card-img" src="${esc(meal.image)}" alt="${esc(meal.name)}">` : `<div class="card-img placeholder">🍽</div>`}
        <div class="card-body">
          <h3>${esc(meal.name)}</h3>
          <p>${esc(meal.description || "")}</p>
          ${tagRowHtml(meal)}
        </div>`;
      if (idx === 0) {
        MP.makeSwipeable(card, {
          onSwipeRight: () => {
            setSlotMeal(swapCtx.day, swapCtx.slotType, meal.id);
            toast(`Swapped in "${meal.name}"`);
            closeSwapPicker();
            renderPlan();
          },
          onSwipeLeft: () => {
            swapCtx.candidates = swapCtx.candidates.filter((m) => m.id !== meal.id);
            renderSwapCards();
          },
          onTap: () => openDetail(meal),
        });
      }
      deck.appendChild(card);
    });
  }

  function openDetail(meal, variantId) {
    const overlay = document.getElementById("detail-overlay");
    const sheet = document.getElementById("detail-sheet");
    const effMeal = MP.effectiveMeal(meal, variantId);
    const label = MP.variantLabel(meal, variantId);
    sheet.innerHTML = `
      <button class="close-btn" aria-label="Close">✕</button>
      ${meal.image ? `<img src="${esc(meal.image)}" alt="${esc(meal.name)}">` : ""}
      <h2>${esc(meal.name)}${label ? ` — ${esc(label)}` : ""}</h2>
      ${tagRowHtml(effMeal)}
      <p>${esc(meal.description || "")}</p>
      <h3>Ingredients</h3>
      <ul class="ingredient-list">${ingredientListHtml(effMeal)}</ul>
      <h3>Instructions</h3>
      <p>${esc(effMeal.instructions || "")}</p>
      <div class="day-slot-actions">
        <button class="ghost detail-eat-btn">Eat this</button>
      </div>
    `;
    sheet.querySelector(".close-btn").addEventListener("click", () => {
      overlay.classList.add("hidden");
    });
    sheet.querySelector(".detail-eat-btn").addEventListener("click", () => openEatSheet(effMeal, null, null));
    overlay.classList.remove("hidden");
  }

  // ---- Expanded day view ----
  let dayCtx = null; // { day } while the expanded day view is open

  function openDayView(day) {
    dayCtx = { day };
    renderDayView();
    document.getElementById("day-overlay").classList.remove("hidden");
  }

  function closeDayView() {
    document.getElementById("day-overlay").classList.add("hidden");
    dayCtx = null;
  }

  function slotEaten(day, slotType) {
    const slot = plan.days[day - 1].slots[slotType];
    return slot && slot.eatenAt ? slot.eatenAt : null;
  }

  function eatBtnHtml(day, slotType) {
    return slotEaten(day, slotType)
      ? `<button class="ghost day-eat-btn" disabled>Eaten ✓</button>`
      : `<button class="ghost day-eat-btn" data-slot="${slotType}">Eat</button>`;
  }

  function daySlotHtml(day, slotType) {
    const meal = mealAt(day, slotType);
    if (!meal) {
      return `<section class="day-slot">
        <div class="slot-type">${slotType}</div>
        <p class="muted">Nothing planned.</p>
        <div class="day-slot-actions">
          <button class="ghost day-swap-btn" data-slot="${slotType}">Add a meal</button>
        </div>
      </section>`;
    }
    const slot = plan.days[day - 1].slots[slotType];
    const effMeal = MP.effectiveMeal(meal, slot.variantId);
    const label = MP.variantLabel(meal, slot.variantId);
    return `<section class="day-slot">
      <div class="slot-type">${slotType}</div>
      <div class="day-slot-head">
        ${meal.image
          ? `<img class="day-thumb" src="${esc(meal.image)}" alt="" loading="lazy">`
          : `<div class="day-thumb placeholder">🍽</div>`}
        <div>
          <h3>${esc(meal.name)}${label ? ` — ${esc(label)}` : ""}</h3>
          <p>${esc(meal.description || "")}</p>
        </div>
      </div>
      ${tagRowHtml(effMeal)}
      ${meal.leftoverOf ? `<p class="day-slot-note">Leftovers — already shopped for.</p>` : ""}
      <ul class="ingredient-list">${ingredientListHtml(effMeal)}</ul>
      ${warningHtml(day, slotType, warnings[`${day}-${slotType}`])}
      <div class="day-slot-actions">
        <button class="ghost day-swap-btn" data-slot="${slotType}">Swap</button>
        ${meal.variants && meal.variants.length ? `<button class="ghost day-variant-btn" data-slot="${slotType}">Variant</button>` : ""}
        <button class="ghost day-recipe-btn" data-slot="${slotType}">Recipe</button>
        ${eatBtnHtml(day, slotType)}
      </div>
      ${slotEaten(day, slotType) ? `<p class="day-slot-note">Eaten ${esc(new Date(slotEaten(day, slotType)).toLocaleDateString())}</p>` : ""}
    </section>`;
  }

  function renderDayView() {
    if (!dayCtx) return;
    const sheet = document.getElementById("day-sheet");
    const day = dayCtx.day;
    sheet.innerHTML = `
      <button class="close-btn" aria-label="Close">✕</button>
      <h2>${esc(dayHeading(day))}</h2>
      ${SLOT_TYPES.map((slotType) => daySlotHtml(day, slotType)).join("")}
      ${coverageHtml(dayMeals(day))}`;
    sheet.querySelector(".close-btn").addEventListener("click", closeDayView);
    wireMoveBtns(sheet);
    sheet.querySelectorAll(".day-swap-btn").forEach((b) =>
      b.addEventListener("click", () => openSwapPicker(day, b.dataset.slot)));
    sheet.querySelectorAll(".day-variant-btn").forEach((b) =>
      b.addEventListener("click", () => openVariantPicker(day, b.dataset.slot)));
    sheet.querySelectorAll(".day-recipe-btn").forEach((b) => {
      const meal = mealAt(day, b.dataset.slot);
      const slot = plan.days[day - 1].slots[b.dataset.slot];
      if (meal) b.addEventListener("click", () => openDetail(meal, slot.variantId));
    });
    sheet.querySelectorAll(".day-eat-btn:not([disabled])").forEach((b) => {
      const meal = mealAt(day, b.dataset.slot);
      const slot = plan.days[day - 1].slots[b.dataset.slot];
      if (meal) b.addEventListener("click", () => openEatSheet(MP.effectiveMeal(meal, slot.variantId), day, b.dataset.slot));
    });
  }

  // ---- Eat flow ----
  let eatCtx = null; // { meal, day, slotType } — day/slotType null for a library eat

  function readEatInputs() {
    const used = {};
    document.querySelectorAll("#eat-sheet .eat-qty").forEach((input) => {
      used[input.dataset.key] = input.value.trim();
    });
    return used;
  }

  function eatRowHtml(row) {
    const summary = row.note
      ? `<span class="eat-after">${esc(row.note)}</span>`
      : `<span class="eat-after">${esc(row.have)} → ${esc(row.after)}</span>`;
    return `<div class="eat-row${row.shortfall ? " shortfall" : ""}">
      <span class="eat-label">${esc(row.label)}</span>
      <input type="text" class="eat-qty" data-key="${esc(row.key)}" value="${esc(row.used)}">
      ${summary}
    </div>`;
  }

  function renderEatSheet(pantry) {
    if (!eatCtx) return;
    const used = readEatInputs();
    const { meal } = eatCtx;
    const hasInputs = Object.keys(used).length > 0;
    const currentUsed = hasInputs ? used : Object.fromEntries((meal.ingredients || []).map((i) => [i.key, i.qty || ""]));
    const { rows, ops } = MP.ShoppingList.eatPlan(meal, currentUsed, pantry);
    const shortfallCount = ops.filter((op) => op.list === "adhoc").length;
    const sheet = document.getElementById("eat-sheet");
    sheet.innerHTML = `
      <button class="close-btn" aria-label="Close">✕</button>
      <h2>Eat ${esc(meal.name)}</h2>
      ${pantry === undefined ? `<p class="muted">Checking pantry…</p>` : ""}
      ${rows.map(eatRowHtml).join("")}
      ${shortfallCount ? `<p class="muted">${shortfallCount} item${shortfallCount === 1 ? "" : "s"} will be added to your ad-hoc list</p>` : ""}
      <div class="day-slot-actions">
        <button class="primary eat-confirm-btn">Confirm</button>
        <button class="ghost eat-cancel-btn">Cancel</button>
      </div>`;
    sheet.querySelector(".close-btn").addEventListener("click", closeEatSheet);
    sheet.querySelector(".eat-cancel-btn").addEventListener("click", closeEatSheet);
    sheet.querySelector(".eat-confirm-btn").addEventListener("click", () => commitEat(pantry));
    sheet.querySelectorAll(".eat-qty").forEach((input) => {
      input.addEventListener("input", () => renderEatSheet(pantry));
    });
  }

  async function openEatSheet(meal, day, slotType) {
    eatCtx = { meal, day, slotType };
    renderEatSheet(undefined);
    document.getElementById("eat-overlay").classList.remove("hidden");
    const pantry = await MP.Sync.fetchItems("pantry");
    if (eatCtx && eatCtx.meal === meal) renderEatSheet(pantry);
  }

  function closeEatSheet() {
    document.getElementById("eat-overlay").classList.add("hidden");
    eatCtx = null;
  }

  function commitEat(pantry) {
    if (!eatCtx) return;
    const { meal, day, slotType } = eatCtx;
    const used = readEatInputs();
    const { ops, rows } = MP.ShoppingList.eatPlan(meal, used, pantry);
    const eatenAt = new Date().toISOString();

    ["pantry", "adhoc"].forEach((list) => {
      const listOps = ops.filter((op) => op.list === list);
      if (!listOps.length) return;
      MP.Sync.writeLocalItems(list, MP.Sync.applyOps(MP.Sync.localItems(list), listOps));
    });
    ops.forEach(MP.Sync.queueOp);

    if (day) {
      plan.days[day - 1].slots[slotType].eatenAt = eatenAt;
      savePlan();
      renderPlan();
    }
    if (MP.Prefs) MP.Prefs.bump(meal, "eaten");

    const shortfallCount = ops.filter((op) => op.list === "adhoc").length;
    closeEatSheet();
    toast(`Eaten — pantry updated${shortfallCount ? ` · ${shortfallCount} added to ad-hoc list` : ""}`);

    MP.Sync.flushOps();
    MP.Nutrition.load().then(
      ({ tags }) => MP.Nutrition.tagsForMeal(meal, tags),
      () => []
    ).then((tags) => MP.Sync.logEaten({ id: `${meal.id}:${eatenAt}`, mealId: meal.id, name: meal.name, eatenAt, tags }));
  }

  let pendingRequestedAt = null;

  async function initHermesBanner() {
    MP.Sync.start();
    const flag = await MP.Sync.syncPlanFlag();
    if (MP.Sync.needsPlan(flag, localStorage.getItem("mp_hermes_plan_acked"))) {
      pendingRequestedAt = flag.requestedAt;
      document.getElementById("hermes-banner").classList.remove("hidden");
    }
  }

  // ---- Hermes placements ----

  /** Pure: applies a queue of Hermes-proposed placements onto `plan`, never
   *  mutating the input. Rejects rather than overwriting eaten history or an
   *  unknown meal — the KV mirror is stale-by-construction (§1 of the spec),
   *  so this local plan is the only authority for what's safe to apply. */
  function applyPlacements(planIn, placements, library) {
    const days = planIn.days.map((d) => ({ day: d.day, slots: { ...d.slots } }));
    const byId = new Set((library || []).map((m) => m.id));
    const applied = [];
    const rejected = [];
    for (const p of placements) {
      const name = (byId.has(p.mealId) && library.find((m) => m.id === p.mealId).name) || p.mealName;
      const dayRec = days[p.day - 1];
      if (!dayRec || !SLOT_TYPES.includes(p.slot)) {
        rejected.push({ day: p.day, slot: p.slot, mealId: p.mealId, name, reason: "bad-slot" });
        continue;
      }
      const existing = dayRec.slots[p.slot];
      if (existing && existing.eatenAt) {
        rejected.push({ day: p.day, slot: p.slot, mealId: p.mealId, name, reason: "eaten" });
        continue;
      }
      if (!byId.has(p.mealId)) {
        rejected.push({ day: p.day, slot: p.slot, mealId: p.mealId, name, reason: "unknown-meal" });
        continue;
      }
      const meal = library.find((m) => m.id === p.mealId);
      const slotValue = { mealId: p.mealId };
      if (p.variantId && MP.findVariant(meal, p.variantId)) slotValue.variantId = p.variantId;
      dayRec.slots = { ...dayRec.slots, [p.slot]: slotValue };
      applied.push({ day: p.day, slot: p.slot, mealId: p.mealId, name });
    }
    return { plan: { ...planIn, days }, applied, rejected };
  }

  function placementBannerHtml(applied, rejected) {
    const reasonText = { eaten: "already eaten", "unknown-meal": "not in your library", "bad-slot": "invalid slot" };
    let html = `<button class="ghost dismiss" aria-label="Dismiss">✕</button>`;
    if (applied.length) {
      html += `<p>Hermes placed ${applied.length} meal${applied.length === 1 ? "" : "s"}:</p><ul>`;
      html += applied.map((a) => `<li>Day ${a.day} ${esc(a.slot)} — ${esc(a.name || "")}</li>`).join("");
      html += `</ul>`;
    }
    if (rejected.length) {
      html += `<p class="rejected">Couldn't place:</p><ul class="rejected">`;
      html += rejected.map((r) => `<li>Day ${r.day} ${esc(r.slot)} — ${esc(r.name || "")} (${reasonText[r.reason] || r.reason})</li>`).join("");
      html += `</ul>`;
    }
    return html;
  }

  function renderPlacementBanner(detail) {
    const el = document.getElementById("hermes-placements-banner");
    if (!el) return;
    if (!detail.applied.length && !detail.rejected.length) {
      el.hidden = true;
      return;
    }
    el.innerHTML = placementBannerHtml(detail.applied, detail.rejected);
    el.hidden = false;
    el.querySelector(".dismiss").addEventListener("click", () => {
      el.hidden = true;
    });
  }

  window.addEventListener("mp:placements-applied", (e) => {
    plan = JSON.parse(localStorage.getItem(LS_PLAN) || "null") || plan;
    renderPlan();
    renderPlacementBanner(e.detail);
  });

  MP.Plan = { applyPlacements };

  async function init() {
    MP.initTheme();
    document.getElementById("day-overlay").addEventListener("click", (e) => {
      if (e.target.id === "day-overlay") closeDayView();
    });
    document.getElementById("swap-overlay").addEventListener("click", (e) => {
      if (e.target.id === "swap-overlay") closeSwapPicker();
    });
    document.getElementById("detail-overlay").addEventListener("click", (e) => {
      if (e.target.id === "detail-overlay") e.currentTarget.classList.add("hidden");
    });
    document.getElementById("eat-overlay").addEventListener("click", (e) => {
      if (e.target.id === "eat-overlay") closeEatSheet();
    });
    document.getElementById("generate-btn").addEventListener("click", () => {
      if (confirm("Regenerate the 2-week plan? This replaces your current edits.")) {
        plan = generatePlan();
        savePlan();
        renderPlan();
        toast("Plan regenerated");
      }
    });
    document.getElementById("hermes-generate").addEventListener("click", async () => {
      plan = generatePlan();
      savePlan();
      renderPlan();
      await MP.Sync.ackPlanFlag(pendingRequestedAt);
      document.getElementById("hermes-banner").classList.add("hidden");
      toast("Plan regenerated by Hermes request");
    });
    document.getElementById("hermes-dismiss").addEventListener("click", async () => {
      await MP.Sync.ackPlanFlag(pendingRequestedAt);
      document.getElementById("hermes-banner").classList.add("hidden");
    });

    [tagsData, shelfData, library] = await Promise.all([
      MP.Nutrition.load(),
      MP.ShelfLife.load(),
      MP.getLibrary(),
    ]);
    plan = loadPlan();
    savePlan();
    renderPlan();
    initHermesBanner();
  }

  // Guarded so this file can be included in test.html for pure-function
  // testing (MP.Plan.applyPlacements) without a plan.html DOM to init against.
  if (document.getElementById("plan-root")) init();
})();
