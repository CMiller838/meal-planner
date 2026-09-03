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
  }

  function mealAt(day, slotType) {
    const slot = plan.days[day - 1].slots[slotType];
    return slot && slot.mealId ? mealsById[slot.mealId] : null;
  }

  function dayMeals(day) {
    return SLOT_TYPES.map((s) => mealAt(day, s)).filter(Boolean);
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

  function renderPlan() {
    mealsById = Object.fromEntries(library.map((m) => [m.id, m]));
    const warnings = MP.ShelfLife.checkPlanWarnings(plan, mealsById, shelfData);
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
        const heading = plan.startDate
          ? `Day ${d.day} · ${WEEKDAY[MP.Generator.weekdayOf(plan.startDate, d.day)]}`
          : `Day ${d.day}`;
        html += `<div class="day-row" data-day="${d.day}">
          <h3>${heading}</h3>
          <div class="slot-grid">
            ${SLOT_TYPES.map((slotType) => {
              const meal = mealAt(d.day, slotType);
              const warn = warnings[`${d.day}-${slotType}`];
              return `<div class="slot-card ${meal ? "" : "empty"}" data-day="${d.day}" data-slot="${slotType}">
                <div class="slot-type">${slotType}</div>
                <div class="slot-meal">${meal ? esc(meal.name) : "tap to add"}</div>
                ${warn ? `<span class="slot-warning">${esc(warn.message)} <button class="ghost move-btn" data-day="${d.day}" data-slot="${slotType}" data-moveto="${warn.moveToDay}">Move to day ${warn.moveToDay}</button></span>` : ""}
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
        openSwapPicker(Number(el.dataset.day), el.dataset.slot);
      });
    });
    root.querySelectorAll(".move-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        moveSlot(Number(btn.dataset.day), btn.dataset.slot, Number(btn.dataset.moveto));
      });
    });
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
    const currentId = plan.days[day - 1].slots[slotType].mealId;
    const others = SLOT_TYPES.filter((s) => s !== slotType).flatMap((s) => {
      const m = mealAt(day, s);
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
            plan.days[swapCtx.day - 1].slots[swapCtx.slotType] = { mealId: meal.id };
            savePlan();
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

  function openDetail(meal) {
    const overlay = document.getElementById("detail-overlay");
    const sheet = document.getElementById("detail-sheet");
    const ingredientsHtml = (meal.ingredients || [])
      .map((i) => `<li>${esc(i.label || labelize(i.key))}${i.qty ? " — " + esc(i.qty) : ""}</li>`)
      .join("");
    sheet.innerHTML = `
      <button class="close-btn" aria-label="Close">✕</button>
      ${meal.image ? `<img src="${esc(meal.image)}" alt="${esc(meal.name)}">` : ""}
      <h2>${esc(meal.name)}</h2>
      ${tagRowHtml(meal)}
      <p>${esc(meal.description || "")}</p>
      <h3>Ingredients</h3>
      <ul class="ingredient-list">${ingredientsHtml}</ul>
      <h3>Instructions</h3>
      <p>${esc(meal.instructions || "")}</p>
    `;
    sheet.querySelector(".close-btn").addEventListener("click", () => {
      overlay.classList.add("hidden");
    });
    overlay.classList.remove("hidden");
  }

  async function init() {
    MP.initTheme();
    document.getElementById("swap-overlay").addEventListener("click", (e) => {
      if (e.target.id === "swap-overlay") closeSwapPicker();
    });
    document.getElementById("detail-overlay").addEventListener("click", (e) => {
      if (e.target.id === "detail-overlay") e.currentTarget.classList.add("hidden");
    });
    document.getElementById("generate-btn").addEventListener("click", () => {
      if (confirm("Regenerate the 2-week plan? This replaces your current edits.")) {
        plan = generatePlan();
        savePlan();
        renderPlan();
        toast("Plan regenerated");
      }
    });

    [tagsData, shelfData, library] = await Promise.all([
      MP.Nutrition.load(),
      MP.ShelfLife.load(),
      MP.getLibrary(),
    ]);
    plan = loadPlan();
    savePlan();
    renderPlan();
  }

  init();
})();
