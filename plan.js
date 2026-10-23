// 2-Week Plan page controller.
(function () {
  "use strict";

  const { esc, labelize } = MP;
  const LS_PLAN = "mp_plan";
  const LS_COOKS = "mp_cooks";
  const SLOT_TYPES = ["breakfast", "lunch", "dinner", "snack"];
  const STAGE_STEP_MS = 30;
  const STAGE_MAX_MS = 1800;

  const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let library = [];
  let mealsById = {};
  let tagsData = null;
  let shelfData = null;
  let packData = null;
  let groupsData = null;
  let plan = null;
  let warnings = {}; // "day-slotType" -> { message, moveToDay, category }; owned by renderPlan
  let basePrefs = {}; // user prefs without assistant day hints
  let dayHints = null; // raw blob from GET /dayHints
  let hintByDay = {}; // day number -> { effort, why, date }, from MP.DayHints.resolve
  let prefs = {}; // { vocab, busyDays, chips } from MP.PlanPrefs, set once at init

  function toast(msg) {
    const root = document.getElementById("toast-root");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  // ---- MP.Cooks: leftover-portion bookkeeping (Phase 20) ----
  // Bare array, same convention as mp_eatenLog. Never references
  // MP.ShoppingList — the portion-eat path must be structurally incapable of
  // touching the pantry.

  /** shelfOverride lets tests supply shelfData without a real fetch; falls
   *  back to the module's own shelfData (unavailable => never prune on age).
   *  A record is kept until its eat-by (fridge days, or frozen months) passes. */
  function cooksAll(shelfOverride) {
    let raw;
    try {
      raw = JSON.parse(localStorage.getItem(LS_COOKS) || "[]");
    } catch {
      raw = null;
    }
    if (!Array.isArray(raw)) raw = [];
    const sd = shelfOverride !== undefined ? shelfOverride : shelfData;
    const today = new Date().toISOString().slice(0, 10);
    const kept = raw.filter((r) => {
      if (!r || r.portionsLeft <= 0) return false;
      const eatBy = sd && MP.ShelfLife.leftoverEatBy(r, sd);
      return !eatBy || eatBy >= today;
    });
    if (kept.length !== raw.length) localStorage.setItem(LS_COOKS, JSON.stringify(kept));
    return kept;
  }

  /** The one write path: persist, then mirror to the Worker best-effort. */
  function cooksWrite(all) {
    localStorage.setItem(LS_COOKS, JSON.stringify(all));
    if (MP.Sync && MP.Sync.pushCooks) MP.Sync.pushCooks(all);
  }

  /** Fridge records first (the freezer is the reserve), then newest. */
  function cooksOpenFor(mealId, shelfOverride) {
    const frozen = (r) => (r.storage === "freezer" ? 1 : 0);
    return cooksAll(shelfOverride)
      .filter((r) => r.mealId === mealId)
      .sort((a, b) => frozen(a) - frozen(b) || new Date(b.cookedAt) - new Date(a.cookedAt));
  }

  function cooksOpen(meal, variantId, portions) {
    if (portions < 1) return null;
    const cookedAt = new Date().toISOString();
    const record = {
      id: `${meal.id}:${cookedAt}`,
      mealId: meal.id,
      name: meal.name,
      variantId: variantId || null,
      cookedAt,
      portionsLeft: portions,
    };
    const all = cooksAll();
    all.push(record);
    cooksWrite(all);
    return record;
  }

  function cooksTake(cookId) {
    const all = cooksAll();
    const idx = all.findIndex((r) => r.id === cookId);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], portionsLeft: all[idx].portionsLeft - 1 };
    cooksWrite(all);
    return all[idx];
  }

  /** "Threw away": closes the record, no log entry. */
  function cooksDiscard(cookId) {
    const all = cooksAll();
    const idx = all.findIndex((r) => r.id === cookId);
    if (idx === -1) return false;
    all[idx] = { ...all[idx], portionsLeft: 0 };
    cooksWrite(all);
    return true;
  }

  /** Moves one portion from a fridge record to its freezer twin (created if absent). */
  function cooksFreezeOne(cookId) {
    const all = cooksAll();
    const idx = all.findIndex((r) => r.id === cookId);
    if (idx === -1 || all[idx].storage === "freezer") return null;
    const src = all[idx];
    all[idx] = { ...src, portionsLeft: src.portionsLeft - 1 };
    const twinId = `${src.id}:frozen`;
    let twin = all.find((r) => r.id === twinId);
    if (twin) twin.portionsLeft += 1;
    else {
      twin = { ...src, id: twinId, cookedAt: new Date().toISOString(), portionsLeft: 1, storage: "freezer" };
      all.push(twin);
    }
    cooksWrite(all);
    return twin;
  }

  MP.Cooks = { all: cooksAll, openFor: cooksOpenFor, open: cooksOpen, take: cooksTake, discard: cooksDiscard, freezeOne: cooksFreezeOne };

  function generatePlan() {
    const budget = packData
      ? { costIndex: MP.ShoppingList.costIndex(library, packData), groups: MP.ShoppingList.groupIndex(groupsData), ...packData.planning }
      : null;
    const have = MP.ShoppingList.pantryIndex({ items: MP.Sync.localItems("pantry") });
    return MP.Generator.generatePlan(library, tagsData.tags, tagsData.targets, shelfData, undefined, budget, have, Object.assign({}, prefs, { profile: MP.Nutrition.profileOf(MP.Sync.settings()) }), MP.Ratings.get());
  }

  function loadPlan() {
    const stored = localStorage.getItem(LS_PLAN);
    return stored ? JSON.parse(stored) : generatePlan();
  }

  function savePlan() {
    localStorage.setItem(LS_PLAN, JSON.stringify(plan));
    window.dispatchEvent(new CustomEvent("mp:plan-saved", { detail: plan }));
  }

  function regenerate(staged) {
    applyHints();
    plan = generatePlan();
    savePlan();
    renderPlan(staged);
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
    return MP.effectiveMeal(meal, slot.variantId, slot.subs);
  }

  function dayMeals(day) {
    return SLOT_TYPES.map((s) => effectiveMealAt(day, s)).filter(Boolean);
  }

  /** Shared slot-write paths: a meal change always starts a fresh slot object
   *  (no stale variantId from the meal it replaced); a variant change never
   *  touches the meal. */
  function setSlotMeal(day, slotType, mealId) {
    plan.days[day - 1].slots[slotType] = { mealId };
    if (!guidedActive) savePlan();
  }

  function setSlotVariant(day, slotType, variantId) {
    const slot = { ...plan.days[day - 1].slots[slotType] };
    if (variantId) slot.variantId = variantId;
    else delete slot.variantId;
    plan.days[day - 1].slots[slotType] = slot;
    if (!guidedActive) savePlan();
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

  /** Re-derive prefs (and the chips) from basePrefs + current hints; dismissals take effect at once. */
  function applyHints(startDate) {
    const resolved = MP.DayHints.resolve(dayHints, startDate || MP.Generator.isoToday(), MP.Generator.isoToday(), MP.DayHints.offMap());
    hintByDay = resolved.byDay;
    prefs = MP.DayHints.merge(basePrefs, resolved);
  }

  function hintChipHtml(day) {
    const h = hintByDay[day];
    if (!h) return "";
    const label = (h.effort === "busy" ? "Busy" : "Free") + (h.why ? " · " + h.why : "");
    return ` <button type="button" class="chip hint-chip" data-day="${day}" title="Tap to dismiss this hint">${esc(label)}</button>`;
  }

  function dayHeading(day) {
    return plan.startDate
      ? `Day ${day} · ${WEEKDAY[MP.Generator.weekdayOf(plan.startDate, day)]}`
      : `Day ${day}`;
  }

  // ponytail: cosmetic staging of a finished plan, not a live generator
  // trace. Upgrade path, if genuine per-pick liveness is ever wanted, is
  // turning MP.Generator.generatePlan into a function* that yields after
  // each place() — deliberately deferred so this render path isn't
  // re-verified against the two generator phases that follow.
  // Last 7 days of the eaten log, per nutrient (informational; base targets). Today's protein
  // figure uses the gym-day target while the "Gym day today" box (mp_gymDay, today only) is ticked.
  function renderGapStrip() {
    const el = document.getElementById("gap-strip");
    if (!el || !tagsData) return;
    let log = [];
    try { log = JSON.parse(localStorage.getItem("mp_eatenLog")) || []; } catch (e) { log = []; }
    if (!Array.isArray(log)) log = [];
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
    const dayKey = (e) => fmt.format(new Date(e.eatenAt));
    const today = fmt.format(new Date());
    const gym = MP.Today.get().gym;
    const dates = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(today + "T00:00:00Z") - (6 - i) * 86400000).toISOString().slice(0, 10));
    const byId = Object.fromEntries(library.map((m) => [m.id, m]));
    const g = MP.Nutrition.weekGaps(log, byId, dates, tagsData.tags, tagsData.targets, dayKey);
    const todays = log.filter((e) => { try { return dayKey(e) === today; } catch (err) { return false; } });
    const targets = gym ? MP.Nutrition.withGymDay(tagsData.targets) : tagsData.targets;
    const tc = MP.Nutrition.eatenDayCoverage(todays, byId, tagsData.tags, targets).cov;
    const loggedAny = g.days.some((d) => d.logged);
    const rows = g.nutrients.filter((n) => n.loggedDays && (n.flag || n.coveredDays < n.loggedDays))
      .map((n) => `<li class="${n.flag ? "gap-flag" : ""}">${esc(labelize(n.nutrient))}: ${n.coveredDays}/${n.loggedDays} days covered${n.flag ? " · missed " + n.missedDays + " days" : ""}</li>`).join("");
    el.innerHTML = `<div class="gap-head"><strong>Last 7 days</strong>
        <label class="gap-gym"><input type="checkbox" id="gym-toggle"${gym ? " checked" : ""}> Gym day today</label></div>` +
      (loggedAny
        ? `<div>Protein today ~${tc.proteinGramsApprox}g / ${tc.proteinTarget}g${gym ? " gym-day target" : ""}</div>
           <ul class="gap-list">${rows || "<li>All logged days covered every tracked nutrient</li>"}</ul>` +
          (g.notLogged.length ? `<div class="gap-nolog">Not logged: ${g.notLogged.map(esc).join(", ")}</div>` : "")
        : `<div>No meals logged yet</div>`);
    el.querySelector("#gym-toggle").addEventListener("change", (ev) => {
      MP.Today.setGym(ev.target.checked);
      renderTodayCard();
      renderGapStrip();
    });
  }

  // Phase 41: one-tap routine items + water/caffeine counters. Counters never touch the eaten log, pantry or generator.
  let countersData = { caffeine: { cupMg: {} }, waterGoal: 0 };
  function renderTodayCard() {
    const el = document.getElementById("today-card");
    if (!el) return;
    const t = MP.Today.get();
    const due = MP.Today.dueRoutines(library, t);
    const cup = el.dataset.cup || "";
    const mg = countersData.caffeine.cupMg[cup];
    const goal = countersData.waterGoal;
    const counter = (field, label, extra) => `<div class="today-count"><span>${label}</span>
        <button class="btn" data-bump="${field}" data-d="-1" aria-label="One less ${field}">−</button>
        <strong>${t[field]}</strong>
        <button class="btn" data-bump="${field}" data-d="1" aria-label="One more ${field}">+</button>${extra || ""}</div>`;
    const todayIso = new Date().toLocaleDateString("en-CA");
    const lefts = shelfData ? MP.ShelfLife.leftoverView(MP.Cooks.all(), todayIso, shelfData) : [];
    const todayDay = plan && plan.startDate ? planDayOf(plan.startDate, todayIso, plan.days.length) : null;
    const defrost = todayDay && shelfData ? (MP.ShelfLife.defrostNotes(plan, mealsById)[todayDay] || []) : [];
    const leftoverRow = (l) => `<li class="leftover-row${l.lastDay ? " last-day" : ""}"><span class="leftover-name">${esc(l.name)} · ${l.portionsLeft} left · ${l.storage}</span>
        <span class="leftover-when">${l.lastDay ? "eat or freeze today" : `eat by ${esc(l.eatBy)} (est.)`}</span>
        ${mealsById[l.mealId] ? `<button class="btn" data-left-eat="${esc(l.id)}">Ate one</button>` : ""}
        ${l.storage === "fridge" ? `<button class="btn" data-left-freeze="${esc(l.id)}">Freeze 1</button>` : ""}
        <button class="ghost" data-left-bin="${esc(l.id)}">Threw away</button></li>`;
    el.innerHTML = `<div class="gap-head"><strong>Today</strong>
        <label class="gap-gym"><input type="checkbox" id="today-gym"${t.gym ? " checked" : ""}> Gym day today</label></div>
      ${due.length ? `<div class="today-routines">${due.map((m) => {
        const done = t.routineDone.includes(m.id);
        return `<button class="btn today-chip${done ? " done" : ""}" data-routine="${esc(m.id)}" aria-pressed="${done}">${esc(m.name)} · ${done ? "Done ✓" : "Had it"}</button>`;
      }).join("")}</div>` : ""}
      ${defrost.map((n) => `<p class="defrost-note">❄ Defrost tonight: ${esc(mealsById[n.mealId].name)} for tomorrow</p>`).join("")}
      ${lefts.length ? `<div class="leftovers"><strong>Leftovers</strong><ul>${lefts.map(leftoverRow).join("")}</ul></div>` : ""}
      ${counter("water", "Water (cups)", goal ? ` <small>of ${goal}</small>` : "")}
      ${counter("caffeine", "Caffeine (cups)",
        ` <select id="today-cup" aria-label="Cup type"><option value="">type?</option>${Object.keys(countersData.caffeine.cupMg).map((k) => `<option value="${esc(k)}"${k === cup ? " selected" : ""}>${esc(k)}</option>`).join("")}</select>` +
        (mg ? ` <small>~${mg * t.caffeine} mg (approx.)</small>` : ""))}`;
    el.querySelectorAll("[data-bump]").forEach((b) => b.addEventListener("click", () => {
      MP.Today.bump(b.dataset.bump, Number(b.dataset.d));
      renderTodayCard();
    }));
    el.querySelectorAll("[data-routine]").forEach((b) => b.addEventListener("click", () => {
      const meal = library.find((m) => m.id === b.dataset.routine);
      if (!meal) return;
      const tags = MP.Nutrition.tagsForMeal(meal, tagsData.tags);
      toast(MP.Today.toggleRoutine(meal, tags) === "logged" ? `Logged ${meal.name}` : `Undid ${meal.name}`);
      renderTodayCard();
      renderGapStrip();
    }));
    // "Ate one" is a portion-eat: it never touches the pantry (see eatPortion).
    el.querySelectorAll("[data-left-eat]").forEach((b) => b.addEventListener("click", () => {
      const cook = MP.Cooks.take(b.dataset.leftEat);
      const meal = cook && mealsById[cook.mealId];
      if (!meal) return;
      const eatenAt = new Date().toISOString();
      if (MP.Prefs) MP.Prefs.bump(meal, "eaten");
      logPortion(meal, eatenAt);
      toast(`Portion eaten — ${cook.portionsLeft} left`);
      renderTodayCard();
      renderGapStrip();
    }));
    el.querySelectorAll("[data-left-freeze]").forEach((b) => b.addEventListener("click", () => {
      if (MP.Cooks.freezeOne(b.dataset.leftFreeze)) toast("Moved one portion to the freezer");
      renderTodayCard();
    }));
    el.querySelectorAll("[data-left-bin]").forEach((b) => b.addEventListener("click", () => {
      MP.Cooks.discard(b.dataset.leftBin);
      renderTodayCard();
    }));
    el.querySelector("#today-gym").addEventListener("change", (ev) => {
      MP.Today.setGym(ev.target.checked);
      renderTodayCard();
      renderGapStrip();
    });
    el.querySelector("#today-cup").addEventListener("change", (ev) => {
      el.dataset.cup = ev.target.value;
      renderTodayCard();
    });
  }

  function renderPlan(staged) {
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
          <h3>${heading}${hintChipHtml(d.day)}</h3>
          <div class="slot-grid">
            ${SLOT_TYPES.map((slotType) => {
              const meal = mealAt(d.day, slotType);
              const warn = warnings[`${d.day}-${slotType}`];
              return `<div class="slot-card ${meal ? "" : "empty"}" data-day="${d.day}" data-slot="${slotType}">
                <div class="slot-type">${slotType}</div>
                <div class="slot-meal">${meal ? esc(meal.name) : "tap to add"}</div>
                ${ratingHintHtml(meal)}
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
    renderGapStrip();

    root.querySelectorAll(".hint-chip").forEach((el) => {
      el.addEventListener("click", () => {
        const h = hintByDay[Number(el.dataset.day)];
        if (!h || !dayHints) return;
        MP.DayHints.dismiss(h.date, dayHints.updatedAt);
        applyHints(plan.startDate);
        renderPlan();
      });
    });
    root.querySelectorAll(".slot-card").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".move-btn")) return;
        openDayView(Number(el.dataset.day));
      });
    });
    wireMoveBtns(root);
    if (staged) {
      root.classList.add("staging");
      root.querySelectorAll(".slot-card").forEach((el, i) => {
        el.style.animationDelay = Math.min(i * STAGE_STEP_MS, STAGE_MAX_MS) + "ms";
      });
    } else {
      root.classList.remove("staging");
    }
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

  // ---- Guided walkthrough ----
  let guidedActive = false; // true from ?guided=1 entry until "Looks good" commit
  let guided = null;        // { passes, pass, days: number[], idx, total } — active only during the swipe loop, null during review

  // ---- Swap picker ----
  let swapCtx = null; // { day, slotType, candidates }

  function candidatesFor(day, slotType) {
    const slot = plan.days[day - 1].slots[slotType];
    const currentId = slot ? slot.mealId : null;
    const others = SLOT_TYPES.filter((s) => s !== slotType).flatMap((s) => {
      const m = effectiveMealAt(day, s);
      return m ? [m] : [];
    });
    const pool = library.filter((m) => m.mealTypes.includes(slotType) && m.id !== currentId);
    // Same variety guard generator.js's own auto-fill loop uses: exclude the
    // immediately adjacent day's pick, demote every other already-used meal
    // by recency, so re-picking a slot doesn't just re-rank from scratch.
    const lastUsedDay = {};
    const excludeIds = new Set();
    plan.days.forEach((d) => {
      if (d.day === day) return;
      const s = d.slots[slotType];
      if (s && s.mealId) {
        lastUsedDay[s.mealId] = d.day;
        if (Math.abs(d.day - day) === 1) excludeIds.add(s.mealId);
      }
    });
    return MP.Generator.rankSlot(pool, day, others, {
      tags: tagsData.tags,
      targets: tagsData.targets,
      prefs,
      lastUsedDay,
      excludeIds,
      ratings: MP.Ratings.get(),
      profile: MP.Nutrition.profileOf(MP.Sync.settings()),
    });
  }

  function openSwapPicker(day, slotType) {
    swapCtx = { day, slotType, candidates: candidatesFor(day, slotType) };
    renderSwapDeck();
    document.getElementById("swap-overlay").classList.remove("hidden");
  }

  function closeSwapPicker() {
    if (guided) return finishWalkthroughLoop();
    document.getElementById("swap-overlay").classList.add("hidden");
    swapCtx = null;
    variantCtx = null;
  }

  const GUIDED_EXTRAS = ["breakfast", "lunch", "snack"];
  // "?slots=lunch,junk,lunch" -> ["dinner","lunch"]; dinner always first, extras in fixed order.
  function parseGuidedSlots(search) {
    const asked = new Set(String(new URLSearchParams(search).get("slots") || "").split(","));
    return ["dinner", ...GUIDED_EXTRAS.filter((s) => asked.has(s))];
  }

  function startGuidedWalkthrough(passes) {
    const days = plan.days.map((d) => d.day);
    guided = { passes: passes || ["dinner"], pass: 0, days, idx: 0, total: days.length * (passes || ["dinner"]).length };
    renderGuidedStep();
  }

  function renderGuidedStep() {
    if (!guided) return;
    if (guided.idx >= guided.days.length) {
      guided.pass++;
      guided.idx = 0;
    }
    if (guided.pass >= guided.passes.length) return finishWalkthroughLoop();
    const day = guided.days[guided.idx];
    const slotType = guided.passes[guided.pass];
    const em = effectiveMealAt(day, slotType);
    const candidates = em && em.leftoverOf ? [] : candidatesFor(day, slotType);
    if (!candidates.length) {
      guided.idx++;
      return renderGuidedStep();
    }
    swapCtx = { day, slotType, candidates };
    renderGuidedDeck();
    document.getElementById("swap-overlay").classList.remove("hidden");
  }

  function advanceGuided() {
    guided.idx++;
    renderGuidedStep();
  }

  function finishWalkthroughLoop() {
    document.getElementById("swap-overlay").classList.add("hidden");
    swapCtx = null;
    guided = null;
    renderPlan();
    document.getElementById("guided-review-banner").classList.remove("hidden");
  }

  function renderGuidedDeck() {
    const sheet = document.getElementById("swap-sheet");
    const { day, slotType } = swapCtx;
    const step = guided.pass * guided.days.length + guided.idx + 1;
    sheet.innerHTML = `<button class="close-btn" aria-label="Skip to review">✕</button>
      <h2>Day ${day} of ${plan.days.length} — ${esc(slotType[0].toUpperCase() + slotType.slice(1))}</h2>
      <p class="swipe-hint" style="margin-top:0;">Step ${step} of ${guided.total} ·
      Swipe right to pick · swipe left for another option · tap to view recipe</p>
      <div id="swap-deck" class="swipe-deck" style="height:340px;"></div>`;
    sheet.querySelector(".close-btn").addEventListener("click", closeSwapPicker);
    renderGuidedCards();
  }

  function renderGuidedCards() {
    const deck = document.getElementById("swap-deck");
    deck.innerHTML = "";
    swapCtx.candidates.slice(0, swapCtx.slotType === "dinner" ? 5 : 3).forEach((meal, idx) => {
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
            toast(`Day ${swapCtx.day}: using "${meal.name}"`);
            advanceGuided();
          },
          onSwipeLeft: () => {
            swapCtx.candidates = swapCtx.candidates.filter((m) => m.id !== meal.id);
            if (!swapCtx.candidates.length) advanceGuided();
            else renderGuidedCards();
          },
          onTap: () => openDetail(meal),
        });
      }
      deck.appendChild(card);
    });
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

  /** Phase 51: a liked meal was nudged up by rankSlot; a flagged-never meal already in the plan stays but says so. */
  function ratingHintHtml(meal) {
    const r = meal && MP.Ratings.get()[meal.id];
    if (!r) return "";
    return (r.never ? `<div class="rating-hint never">Flagged never</div>` : "")
      + (r.rating === "up" ? `<div class="rating-hint">ranked up: you liked this</div>` : "");
  }

  function openDetail(meal, variantId, subs) {
    const overlay = document.getElementById("detail-overlay");
    const sheet = document.getElementById("detail-sheet");
    const effMeal = MP.effectiveMeal(meal, variantId, subs);
    const label = MP.variantLabel(meal, variantId);
    const subsLabel = MP.subsLabel(subs);
    sheet.innerHTML = `
      <button class="close-btn" aria-label="Close">✕</button>
      ${meal.image ? `<img src="${esc(meal.image)}" alt="${esc(meal.name)}">` : ""}
      <h2>${esc(meal.name)}${label ? ` — ${esc(label)}` : ""}</h2>
      ${subsLabel ? `<p class="muted subs-label">${esc(subsLabel)}</p>` : ""}
      ${tagRowHtml(effMeal)}
      <p>${esc(meal.description || "")}</p>
      <h3>Ingredients</h3>
      <ul class="ingredient-list">${ingredientListHtml(effMeal)}</ul>
      <h3>Instructions</h3>
      ${variantId && MP.methodOf(meal).steps.length ? `<p class="muted">Steps are for the base recipe.</p>` : ""}
      ${MP.methodOf(meal).steps.length ? MP.methodHtml(meal) : `<p>${esc(effMeal.instructions || "")}</p>`}
      ${MP.methodOf(meal).status === "drafted" ? `<p class="muted">Drafted by your assistant — accept it in Browse.</p>` : ""}
      <div class="day-slot-actions">
        <button class="ghost detail-eat-btn">Eat this</button>
      </div>
    `;
    sheet.querySelector(".close-btn").addEventListener("click", () => {
      overlay.classList.add("hidden");
    });
    sheet.querySelector(".detail-eat-btn").addEventListener("click", () => openEatSheet(effMeal, null, null, variantId));
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
    const effMeal = MP.effectiveMeal(meal, slot.variantId, slot.subs);
    const label = MP.variantLabel(meal, slot.variantId);
    const subsLabel = MP.subsLabel(slot.subs);
    return `<section class="day-slot">
      <div class="slot-type">${slotType}</div>
      <div class="day-slot-head">
        ${meal.image
          ? `<img class="day-thumb" src="${esc(meal.image)}" alt="" loading="lazy">`
          : `<div class="day-thumb placeholder">🍽</div>`}
        <div>
          <h3>${esc(meal.name)}${label ? ` — ${esc(label)}` : ""}</h3>
          ${subsLabel ? `<p class="muted subs-label">${esc(subsLabel)}</p>` : ""}
          <p>${esc(meal.description || "")}</p>
        </div>
      </div>
      ${tagRowHtml(effMeal)}
      ${meal.leftoverOf ? `<p class="day-slot-note">Leftovers — already shopped for.</p>` : ""}
      ${frozenNoteHtml(day, slotType)}
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

  /** Phase 59: marker on a frozen portion, defrost reminder the evening before (derived at render). */
  function frozenNoteHtml(day, slotType) {
    const slot = plan.days[day - 1].slots[slotType];
    const from = slotType === "dinner" ? MP.frozenParentDay(plan, day, slot) : null;
    const next = plan.days[day] && plan.days[day].slots.dinner;
    const defrost = MP.frozenParentDay(plan, day + 1, next) && mealsById[next.mealId];
    return (from ? `<p class="day-slot-note frozen-note">❄ Frozen portion of day ${from}</p>` : "") +
      (defrost ? `<p class="day-slot-note defrost-note">Defrost tonight for ${esc(mealsById[next.mealId].name)} tomorrow</p>` : "");
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
      if (meal) b.addEventListener("click", () => openDetail(meal, slot.variantId, slot.subs));
    });
    sheet.querySelectorAll(".day-eat-btn:not([disabled])").forEach((b) => {
      const meal = mealAt(day, b.dataset.slot);
      const slot = plan.days[day - 1].slots[b.dataset.slot];
      if (meal) b.addEventListener("click", () => openEatSheet(MP.effectiveMeal(meal, slot.variantId, slot.subs), day, b.dataset.slot, slot.variantId));
    });
  }

  // ---- Eat flow ----
  // eatCtx: { meal, day, slotType, variantId, open } — day/slotType null for
  // a library eat; `open` (Phase 20) holds MP.Cooks.openFor(meal.id) results
  // while the branch-A picker is showing, null once past it.
  let eatCtx = null;

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
      : `<span class="eat-after">${esc(MP.qtyText(row.have))} → ${esc(MP.qtyText(row.after))}</span>`;
    return `<div class="eat-row${row.shortfall ? " shortfall" : ""}">
      <span class="eat-label">${esc(row.label)}</span>
      <input type="text" class="eat-qty" data-key="${esc(row.key)}" value="${esc(row.used)}">
      ${summary}
    </div>`;
  }

  /** Branch B/C: today's pantry-row sheet, plus a leftover-portion line when
   *  this cook will open a new cook record (servings >= 2). */
  function renderEatSheet(pantry) {
    if (!eatCtx) return;
    const used = readEatInputs();
    const { meal } = eatCtx;
    const servings = meal.servings || 1;
    const hasInputs = Object.keys(used).length > 0;
    const currentUsed = hasInputs ? used : Object.fromEntries((meal.ingredients || []).map((i) => [i.key, i.qty || ""]));
    const { rows, ops } = MP.ShoppingList.eatPlan(meal, currentUsed, pantry);
    const shortfallCount = ops.filter((op) => op.list === "adhoc").length;
    const sheet = document.getElementById("eat-sheet");
    sheet.innerHTML = `
      <button class="close-btn" aria-label="Close">✕</button>
      <h2>Eat ${esc(meal.name)}</h2>
      ${pantry === undefined ? `<p class="muted">Checking pantry…</p>` : ""}
      ${servings >= 2 ? `<p class="muted">Cooking ${servings} portions — 1 now, ${servings - 1} saved as leftovers</p>` : ""}
      ${rows.map(eatRowHtml).join("")}
      ${shortfallCount ? `<p class="muted">${shortfallCount} item${shortfallCount === 1 ? "" : "s"} will be added to your ad-hoc list</p>` : ""}
      <div class="day-slot-actions">
        <button class="primary eat-confirm-btn">Confirm</button>
        <button class="ghost eat-cancel-btn">Cancel</button>
      </div>`;
    sheet.querySelector(".close-btn").addEventListener("click", closeEatSheet);
    sheet.querySelector(".eat-cancel-btn").addEventListener("click", closeEatSheet);
    sheet.querySelector(".eat-confirm-btn").addEventListener("click", () => commitCook(pantry));
    sheet.querySelectorAll(".eat-qty").forEach((input) => {
      input.addEventListener("input", () => renderEatSheet(pantry));
    });
  }

  /** Branch A: an open cook exists — offer "ate a portion" against it, or a
   *  way out to "cooked fresh" (re-renders as branch B/C). No pantry fetch,
   *  no .eat-qty inputs. */
  function renderEatPicker() {
    if (!eatCtx || !eatCtx.open) return;
    const { meal, open } = eatCtx;
    const sheet = document.getElementById("eat-sheet");
    sheet.innerHTML = `
      <button class="close-btn" aria-label="Close">✕</button>
      <h2>Eat ${esc(meal.name)}</h2>
      <div class="eat-cook-options">
        ${open
          .map((c) => {
            const day = new Date(c.cookedAt).toLocaleDateString(undefined, { weekday: "long" });
            return `<button class="ghost eat-portion-btn" data-id="${esc(c.id)}">Ate a portion — cooked ${esc(day)} (${c.portionsLeft} left)</button>`;
          })
          .join("")}
        <button class="ghost eat-fresh-btn">No, I cooked this fresh</button>
      </div>`;
    sheet.querySelector(".close-btn").addEventListener("click", closeEatSheet);
    sheet.querySelectorAll(".eat-portion-btn").forEach((btn) => {
      btn.addEventListener("click", () => eatPortion(btn.dataset.id));
    });
    sheet.querySelector(".eat-fresh-btn").addEventListener("click", async () => {
      eatCtx.open = null;
      renderEatSheet(undefined);
      const pantry = await MP.Sync.fetchItems("pantry");
      if (eatCtx && !eatCtx.open) renderEatSheet(pantry);
    });
  }

  /** Router: branch A (an open cook exists) skips the pantry fetch entirely;
   *  branch B/C fetches pantry as before. Computed before any pantry I/O. */
  async function openEatSheet(meal, day, slotType, variantId) {
    eatCtx = { meal, day, slotType, variantId: variantId || null, open: null };
    const open = MP.Cooks.openFor(meal.id);
    document.getElementById("eat-overlay").classList.remove("hidden");
    if (open.length > 0) {
      eatCtx.open = open;
      renderEatPicker();
      return;
    }
    renderEatSheet(undefined);
    const pantry = await MP.Sync.fetchItems("pantry");
    if (eatCtx && eatCtx.meal === meal && !eatCtx.open) renderEatSheet(pantry);
  }

  function closeEatSheet() {
    document.getElementById("eat-overlay").classList.add("hidden");
    eatCtx = null;
  }

  /** Log-only tail shared by commitCook and eatPortion (§4c) — the only code
   *  the two paths share, so sharing it can't leak a pantry write into the
   *  portion path. Returns the promise so a caller/test can await it;
   *  production call sites fire-and-forget. */
  function logPortion(meal, eatenAt) {
    return MP.Nutrition.load()
      .then(({ tags }) => MP.Nutrition.tagsForMeal(meal, tags), () => [])
      .then((tags) => MP.Sync.logEaten({ id: `${meal.id}:${eatenAt}`, mealId: meal.id, name: meal.name, eatenAt, tags }));
  }

  /** Pantry/ad-hoc side of a cook: apply locally, queue for the relay. Only
   *  commitCook and applyEatRequests' cook branch call it (both cooks). */
  function applyCookOps(ops) {
    const pantryOps = ops.filter((op) => op.list === "pantry");
    if (pantryOps.length) MP.Sync.writeLocalItems("pantry", MP.Sync.applyOps(MP.Sync.localItems("pantry"), pantryOps));
    pantryOps.forEach(MP.Sync.queueOp);
    // Shortfalls join the shared shopping list as extra lines (Phase 55).
    ops.filter((op) => op.list === "adhoc").forEach((op) => MP.Sync.setLine({
      id: "x:" + MP.ShoppingList.normalizeKey(op.name), state: "needed", source: "plan", label: op.name, ...(op.qty ? { qty: op.qty } : {}),
    }));
  }

  /** The only pantry writer (§4a). Deducts once per cook instance, then
   *  opens an MP.Cooks record for the remaining servings (none for a
   *  servings:1 meal). */
  function commitCook(pantry) {
    if (!eatCtx) return;
    const { meal, day, slotType, variantId } = eatCtx;
    const used = readEatInputs();
    const { ops } = MP.ShoppingList.eatPlan(meal, used, pantry);
    const eatenAt = new Date().toISOString();

    applyCookOps(ops);

    if (day) {
      plan.days[day - 1].slots[slotType].eatenAt = eatenAt;
      savePlan();
      renderPlan();
    }
    if (MP.Prefs) MP.Prefs.bump(meal, "eaten");

    let cook = MP.Cooks.open(meal, variantId, (meal.servings || 1) - 1);
    // Phase 59: move the planned frozen portions to the freezer (cooks only, never the pantry).
    const toFreeze = day && cook ? plan.days.filter((d) => d.day > day && MP.frozenParentDay(plan, d.day, d.slots.dinner) === day).length : 0;
    for (let i = 0; i < toFreeze && cook && cook.portionsLeft > 0; i++) MP.Cooks.freezeOne(cook.id);
    if (cook) cook = MP.Cooks.all().find((r) => r.id === cook.id) || cook;

    const shortfallCount = ops.filter((op) => op.list === "adhoc").length;
    closeEatSheet();
    toast(`Eaten — pantry updated${shortfallCount ? ` · ${shortfallCount} added to ad-hoc list` : ""}${cook ? ` · ${cook.portionsLeft} portions saved` : ""}`);

    MP.Sync.flushOps();
    logPortion(meal, eatenAt);
  }

  /** §4b — never touches the pantry: no eatPlan, no applyOps, no
   *  writeLocalItems, no queueOp. Decrement, log, close. */
  function eatPortion(cookId) {
    const cook = MP.Cooks.take(cookId);
    if (!cook) return; // already eaten in another tab
    const { meal, day, slotType } = eatCtx;
    const eatenAt = new Date().toISOString();

    if (day) {
      plan.days[day - 1].slots[slotType].eatenAt = eatenAt;
      savePlan();
      renderPlan();
    }
    if (MP.Prefs) MP.Prefs.bump(meal, "eaten");
    closeEatSheet();
    toast(`Portion eaten — ${cook.portionsLeft} left`);
    logPortion(meal, eatenAt);
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

  // ---- Assistant week draft (Phase 49): a pending KV planDraft the user applies or dismisses ----

  function renderPlanDraftBanner(draft) {
    const el = document.getElementById("plan-draft-banner");
    if (!el) return;
    const rows = draft.changes.map((c) => {
      const m = mealsById[c.after.mealId];
      return `<li>Day ${c.day} ${esc(c.slot)} — ${esc(m ? m.name : c.after.mealId)}</li>`;
    }).join("");
    el.innerHTML = `<p>The assistant drafted ${draft.changes.length} change${draft.changes.length === 1 ? "" : "s"} to your plan:</p><ul>${rows}</ul>
      <button class="btn" data-act="apply">Apply</button> <button class="btn" data-act="dismiss">Dismiss</button>`;
    el.hidden = false;
    el.onclick = async (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      el.hidden = true;
      if (act === "apply") {
        const placements = draft.changes.map((c) => ({ day: c.day, slot: c.slot, mealId: c.after.mealId, variantId: c.after.variantId }));
        const res = MP.Plan.applyPlacements(plan, placements, library);
        plan = res.plan;
        savePlan();
        renderPlan();
        renderPlacementBanner({ applied: res.applied, rejected: res.rejected });
      }
      await MP.Sync.ackPlanDraft(draft);
    };
  }

  window.addEventListener("mp:plandraft", (e) => { if (plan) renderPlanDraftBanner(e.detail); });

  // ---- Assistant "I ate X" requests (eat-requests queue) ----

  /** Plan day (1-based) whose local date holds `iso`, or null outside the plan. */
  function planDayOf(startDate, iso, nDays) {
    if (!startDate || isNaN(Date.parse(iso))) return null;
    const [y, m, d] = startDate.split("-").map(Number);
    const at = new Date(iso);
    const day = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()) - new Date(y, m - 1, d)) / 86400000) + 1;
    return day >= 1 && day <= nDays ? day : null;
  }

  /** Pure: which plan slot each queued request lands on — the first un-eaten
   *  slot holding that meal on the plan day of its eatenAt. Never forced:
   *  anything else is rejected (and shown), never mutates the input. */
  function matchEatRequests(planIn, requests, library) {
    const byId = new Map((library || []).map((m) => [m.id, m]));
    const taken = new Set();
    const seen = new Set();
    const applied = [];
    const rejected = [];
    for (const r of requests) {
      const meal = byId.get(r.mealId);
      const base = { id: r.id, mealId: r.mealId, name: meal ? meal.name : r.mealId, eatenAt: r.eatenAt };
      if (!meal) {
        rejected.push({ ...base, reason: "unknown-meal" });
        continue;
      }
      const day = planDayOf(planIn.startDate, r.eatenAt, planIn.days.length);
      const slots = day ? planIn.days[day - 1].slots : {};
      const withMeal = SLOT_TYPES.filter((s) => slots[s] && slots[s].mealId === r.mealId);
      // Idempotent: a request id already applied (this batch, or earlier: its slot carries that eatenAt) is never applied twice.
      if (seen.has(r.id) || withMeal.some((s) => slots[s].eatenAt === r.eatenAt)) {
        rejected.push({ ...base, reason: "eaten" });
        continue;
      }
      seen.add(r.id);
      const slotType = withMeal.find((s) => !slots[s].eatenAt && !taken.has(`${day}-${s}`));
      if (!slotType) {
        rejected.push({ ...base, reason: withMeal.length ? "eaten" : "not-planned" });
        continue;
      }
      taken.add(`${day}-${slotType}`);
      applied.push({ ...base, day, slotType });
    }
    return { applied, rejected };
  }

  /** Applies queued requests through the same eat flow as the Eat sheet:
   *  an open cook -> a portion (no pantry, §4b); otherwise a cook at the
   *  planned quantities via eatPlan. Keeps the request's eatenAt so the
   *  eaten-log id matches the assistant's row. null = not now (guided mode). */
  async function applyEatRequests(requests) {
    if (guidedActive || !plan) return null;
    const result = matchEatRequests(plan, requests, library);
    if (!result.applied.length) return result;
    let pantry = await MP.Sync.fetchItems("pantry");
    for (const a of result.applied) {
      const slot = plan.days[a.day - 1].slots[a.slotType];
      const meal = MP.effectiveMeal(mealsById[a.mealId], slot.variantId, slot.subs);
      const open = MP.Cooks.openFor(meal.id);
      if (open.length) {
        MP.Cooks.take(open[0].id);
      } else {
        const used = Object.fromEntries((meal.ingredients || []).map((i) => [i.key, i.qty || ""]));
        applyCookOps(MP.ShoppingList.eatPlan(meal, used, pantry).ops);
        pantry = { items: MP.Sync.localItems("pantry") };
        MP.Cooks.open(meal, slot.variantId, (meal.servings || 1) - 1);
      }
      slot.eatenAt = a.eatenAt;
      if (MP.Prefs) MP.Prefs.bump(meal, "eaten");
      logPortion(meal, a.eatenAt);
    }
    savePlan();
    renderPlan();
    MP.Sync.flushOps();
    return result;
  }

  function eatBannerHtml(applied, rejected) {
    const reasonText = { eaten: "already eaten", "not-planned": "not on that day's plan", "unknown-meal": "not in your library" };
    let html = `<button class="ghost dismiss" aria-label="Dismiss">✕</button>`;
    if (applied.length) {
      html += `<p>Marked eaten from your assistant:</p><ul>`;
      html += applied.map((a) => `<li>Day ${a.day} ${esc(a.slotType)} — ${esc(a.name || "")}</li>`).join("");
      html += `</ul>`;
    }
    if (rejected.length) {
      html += `<p class="rejected">Couldn't mark eaten:</p><ul class="rejected">`;
      html += rejected.map((r) => `<li>${esc(r.name || "")} (${reasonText[r.reason] || esc(r.reason)})</li>`).join("");
      html += `</ul>`;
    }
    return html;
  }

  window.addEventListener("mp:eat-requests-applied", (e) => {
    const el = document.getElementById("hermes-placements-banner");
    const { applied, rejected } = e.detail;
    if (!el || (!applied.length && !rejected.length)) return;
    el.innerHTML = eatBannerHtml(applied, rejected);
    el.hidden = false;
    el.querySelector(".dismiss").addEventListener("click", () => {
      el.hidden = true;
    });
  });

  window.addEventListener("mp:placements-applied", (e) => {
    plan = JSON.parse(localStorage.getItem(LS_PLAN) || "null") || plan;
    renderPlan();
    renderPlacementBanner(e.detail);
  });

  MP.Plan = { parseGuidedSlots, applyPlacements, logPortion, matchEatRequests, applyEatRequests };

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
        regenerate();
        toast("Plan regenerated");
      }
    });
    document.getElementById("hermes-generate").addEventListener("click", async () => {
      regenerate(true);
      await MP.Sync.ackPlanFlag(pendingRequestedAt);
      document.getElementById("hermes-banner").classList.add("hidden");
      toast("Plan regenerated by Hermes request");
    });
    document.getElementById("hermes-plan-with-me").addEventListener("click", async () => {
      try {
        await MP.Sync.ackPlanFlag(pendingRequestedAt);
      } catch (e) {}
      location.href = "plan-with-me.html";
    });
    document.getElementById("hermes-dismiss").addEventListener("click", async () => {
      await MP.Sync.ackPlanFlag(pendingRequestedAt);
      document.getElementById("hermes-banner").classList.add("hidden");
    });

    let vocab;
    await MP.Sync.fetchSettings(); // before Nutrition.load so the targets apply on this load
    [tagsData, shelfData, library, packData, groupsData, vocab] = await Promise.all([
      MP.Nutrition.load(),
      MP.ShelfLife.load(),
      MP.getLibrary(),
      MP.ShoppingList.load().catch(() => null),
      MP.ShoppingList.loadGroups().catch(() => ({})),
      MP.PlanPrefs.loadVocab(),
    ]);
    basePrefs = Object.assign({ vocab }, MP.PlanPrefs.get());
    dayHints = await MP.Sync.fetchDayHints();
    await MP.Sync.fetchRatings();
    applyHints((JSON.parse(localStorage.getItem(LS_PLAN) || "null") || {}).startDate);
    const guidedParam = new URLSearchParams(location.search).get("guided") === "1";
    if (guidedParam) {
      guidedActive = true;
      plan = generatePlan();
      startGuidedWalkthrough(parseGuidedSlots(location.search));
    } else {
      plan = loadPlan();
      savePlan();
      renderPlan();
    }
    initHermesBanner();
    MP.Sync.fetchPlanDraft();
    countersData = await fetch("counters.json").then((r) => r.json()).catch(() => countersData);
    renderTodayCard();
    const pullToday = () => MP.Today.pull().then((changed) => { if (changed) { renderTodayCard(); renderGapStrip(); } });
    pullToday();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullToday(); });

    document.getElementById("guided-commit-btn").addEventListener("click", () => {
      guidedActive = false;
      savePlan();
      history.replaceState(null, "", "plan.html");
      document.getElementById("guided-review-banner").classList.add("hidden");
      toast("Plan saved");
    });
  }

  // Guarded so this file can be included in test.html for pure-function
  // testing (MP.Plan.applyPlacements) without a plan.html DOM to init against.
  if (document.getElementById("plan-root")) init();
})();
