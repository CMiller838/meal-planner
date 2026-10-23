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
  let vocabAll = null; // whole plan-preferences.json (chips + candidates)
  let prefs = {}; // { vocab, busyDays, chips } from MP.PlanPrefs, set once at init

  function toast(msg, action) {
    const root = document.getElementById("toast-root");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    if (action) {
      const b = document.createElement("button");
      b.textContent = action.label;
      b.addEventListener("click", () => { el.remove(); action.fn(); });
      el.appendChild(b);
    }
    root.appendChild(el);
    setTimeout(() => el.remove(), action ? 8000 : 1800);
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

  function generatePlan(override, locked, ranOut, avoid) {
    const lib = avoid && avoid.length ? library.filter((m) => !avoid.includes(m.id)) : library;
    const budget = packData
      ? { costIndex: MP.ShoppingList.costIndex(lib, packData), groups: MP.ShoppingList.groupIndex(groupsData), ...packData.planning }
      : null;
    const have = MP.ShoppingList.pantryIndex({ items: MP.Sync.localItems("pantry") });
    (ranOut || []).forEach((k) => delete have[k]); // Phase 63: ran out for this generation only; the pantry is never written
    const gen = MP.Generator.generatePlan(lib, tagsData.tags, tagsData.targets, shelfData, undefined, budget, have, Object.assign({}, prefs, override, { profile: MP.Nutrition.profileOf(MP.Sync.settings()) }), MP.Ratings.get(), locked);
    if (basePrefs.rolling !== false) gen.shopAnchor = gen.startDate; // Phase 68: a fresh plan starts a new shop cadence; rolls/rerolls read only its days
    return gen;
  }

  // Phase 68: roll the window to today. Runs on Plan open and on visible, before placements and drafts apply.
  function rollIfDue() {
    if (!plan || guidedActive || basePrefs.rolling === false) return false;
    const res = MP.rollPlan(plan, new Date().toLocaleDateString("en-CA"), (locked, start) =>
      generatePlan({ shopOffset: MP.ShelfLife.shopOffset({ startDate: start, shopAnchor: plan.shopAnchor || plan.startDate }) }, locked));
    if (!res) return false;
    plan = res.plan;
    localStorage.removeItem(LS_UNDO); // its day numbers are stale
    savePlan();
    return true;
  }

  // Phase 64: three candidate fortnights. Generation only; nothing saves until "Use this plan".
  const CANDIDATE_LABELS = { cheapest: "Cheapest", protein: "Highest protein", quickest: "Quickest" };

  /** { cost, proteinG:[wk1,wk2], gaps, quickDinners } for a plan; ctx defaults to the page's loaded data. */
  function planMetrics(pl, ctx) {
    const c = Object.assign({ library, tags: tagsData && tagsData.tags, targets: tagsData && tagsData.targets, packData }, ctx);
    const byId = Object.fromEntries(c.library.map((m) => [m.id, m]));
    const costs = c.packData ? MP.ShoppingList.costIndex(c.library, c.packData) : null;
    let cost = costs ? 0 : null;
    const weekCost = [costs ? 0 : null, costs ? 0 : null];
    let quickDinners = 0;
    const weeks = [[], []];
    pl.days.forEach((d, i) => {
      SLOT_TYPES.forEach((t) => {
        const slot = d.slots[t];
        const meal = slot && slot.mealId ? byId[slot.mealId] : null;
        if (!meal) return;
        weeks[i < 7 ? 0 : 1].push(meal);
        const prev = i > 0 && pl.days[i - 1].slots[t];
        const repeat = t === "dinner" && prev && prev.mealId === slot.mealId;
        if (meal.leftoverOf || slot.frozenFrom || repeat) return;
        if (costs && costs[meal.id]) { cost += costs[meal.id].cost; weekCost[i < 7 ? 0 : 1] += costs[meal.id].cost; }
        if (t === "dinner" && MP.Generator.effortOf(meal) === "quick") quickDinners++;
      });
    });
    const wk = (m) => Math.round(MP.Nutrition.dayCoverage(m, c.tags, c.targets).proteinGramsApprox || 0);
    const all = MP.Nutrition.weekCoverage(weeks, c.tags, c.targets);
    const wg = (m) => { const w = MP.Nutrition.weekCoverage([m], c.tags, c.targets); return [...w.missing, ...w.partial]; };
    return { cost, weekCost, proteinG: [wk(weeks[0]), wk(weeks[1])], gaps: all.missing.length + all.partial.length, weekGaps: [wg(weeks[0]), wg(weeks[1])], quickDinners };
  }


  // Phase 71: preview of taking `meal` in a slot. Same planMetrics/buildLists on a copy; writes nothing.
  function whatIf(day, slotType, meal, ctx) {
    const c = Object.assign({ library, packData, byId: mealsById, pantry: { items: MP.Sync.localItems("pantry") } }, ctx);
    const base = c.plan || plan, copy = structuredClone(base);
    copy.days[day - 1].slots[slotType] = { mealId: meal.id, locked: true };
    const byId = Object.assign({}, c.byId, { [meal.id]: meal });
    const a = planMetrics(base, c), b = planMetrics(copy, c);
    const seen = new Set();
    Object.values(MP.ShoppingList.buildLists(base, byId, c.packData, c.pantry)).forEach((l) => l.lines.forEach((x) => seen.add(x.key)));
    const newLines = [];
    Object.values(MP.ShoppingList.buildLists(copy, byId, c.packData, c.pantry)).forEach((l) => l.lines.forEach((x) => {
      if (!seen.has(x.key) && !newLines.includes(x.label)) newLines.push(x.label);
    }));
    const mins = MP.methodOf(meal).steps.reduce((s, st) => s + (st.minutes || 0), 0);
    const wk = day <= 7 ? 0 : 1;
    return { dProteinG: b.proteinG[wk] - a.proteinG[wk], dCost: a.cost === null ? null : b.cost - a.cost, minutes: mins || null, effort: MP.Generator.effortOf(meal), newLines };
  }

  function whatIfHtml(w) {
    const sg = (n) => (n > 0 ? "+" : "") + n;
    return `<div>Protein <b>${esc(sg(w.dProteinG))} g</b> (that week)</div>`
      + (w.dCost === null ? "" : `<div>Cost <b>${esc((w.dCost >= 0 ? "+" : "-") + "£" + Math.abs(w.dCost).toFixed(2))}</b></div>`)
      + `<div>Cook <b>${esc(w.minutes ? w.minutes + " min" : w.effort)}</b></div>`
      + `<div>${w.newLines.length ? "Adds: " + esc(w.newLines.slice(0, 4).join(", ")) + (w.newLines.length > 4 ? ` +${w.newLines.length - 4}` : "") : "No new shopping lines"}</div>`;
  }

  // Hover (PC) or ~450 ms long-press (phone, cancelled by movement) shows the preview; never touches mp_plan.
  function attachWhatIf(card, meal) {
    const show = () => {
      if (!swapCtx || card.classList.contains("dragging")) return;
      let pop = card.parentNode.querySelector(".whatif");
      if (!pop) { pop = document.createElement("div"); pop.className = "whatif"; pop.setAttribute("role", "status"); card.parentNode.appendChild(pop); }
      pop.innerHTML = whatIfHtml(whatIf(swapCtx.day, swapCtx.slotType, meal));
    };
    const hide = () => { const p = card.parentNode && card.parentNode.querySelector(".whatif"); if (p) p.remove(); };
    let timer = null, x0 = 0, y0 = 0;
    card.addEventListener("mouseenter", show);
    card.addEventListener("mouseleave", hide);
    card.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      x0 = e.clientX; y0 = e.clientY; timer = setTimeout(show, 450);
    });
    card.addEventListener("pointermove", (e) => { if (timer && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) { clearTimeout(timer); timer = null; } });
    ["pointerup", "pointercancel"].forEach((ev) => card.addEventListener(ev, () => { clearTimeout(timer); timer = null; hide(); }));
  }

  // Phase 70: the one dinner swap that closes the biggest gap of the weaker week. Suggestion only, never an edit;
  // nutrition (rankByGap) picks the meal, cost is never consulted. `ctx` lets tests inject plan/library/candidates.
  function fixGap(pl, ctx) {
    const c = Object.assign({ plan, library, tags: tagsData && tagsData.tags, targets: tagsData && tagsData.targets, cands: candidatesFor }, ctx);
    pl = pl || c.plan;
    if (!pl || !c.tags) return null;
    const byId = Object.fromEntries(c.library.map((m) => [m.id, m]));
    const mealOf = (slot) => (slot && slot.mealId ? byId[slot.mealId] : null);
    const weekMeals = (w) => pl.days.slice(w * 7, w * 7 + 7).flatMap((d) => SLOT_TYPES.map((t) => mealOf(d.slots[t])).filter(Boolean));
    const short = (meals) => { const w = MP.Nutrition.weekCoverage([meals], c.tags, c.targets); return [...w.missing, ...w.partial]; };
    const gaps = [short(weekMeals(0)), short(weekMeals(1))];
    const w = gaps[1].length > gaps[0].length ? 1 : 0;
    const nutrient = gaps[w][0];
    if (!nutrient) return null;
    for (const d of pl.days.slice(w * 7, w * 7 + 7)) {
      const slot = d.slots.dinner;
      const cur = mealOf(slot);
      if (!slot || !cur || slot.locked || slot.eatenAt || slot.eatingOut || slot.frozenFrom || cur.leftoverOf) continue;
      const ranked = MP.Nutrition.rankByGap(c.cands(d.day, "dinner"), [nutrient], c.tags);
      for (const to of ranked) {
        const meals = weekMeals(w).slice();
        meals.splice(meals.indexOf(cur), 1, to);
        if (!short(meals).includes(nutrient)) return { day: d.day, from: cur.id, to: to.id, nutrient };
      }
    }
    return null;
  }

  // Phase 70: sticky Wk1|Wk2 meter. Display-only; built once, updated in place, animates only what an edit changed.
  let lastMeter = null, meterFrame = 0, fixDismissed = { sig: "", days: new Set() };
  const reducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function renderMeter(staged) {
    const el = document.getElementById("meter-strip");
    if (!el || !tagsData || !plan) return;
    if (!el.firstChild) {
      el.innerHTML = [1, 2].map((n, i) => `<div class="meter-week" data-w="${i}"><b>Wk ${n}</b>
        <div class="meter-track"><div class="meter-bar"></div></div>
        <div class="meter-line"><span class="m-prot"></span> · <span class="m-cost"></span></div>
        <div class="meter-gaps"></div></div>`).join("") + `<div class="meter-fix"><button class="btn-secondary" id="fix-gap-btn" type="button"></button><div id="fix-card" class="fix-card" hidden></div></div>`;
      el.querySelector("#fix-gap-btn").addEventListener("click", () => { fixDismissed.days.delete(-1); renderFixCard(true); });
    }
    const m = planMetrics(plan);
    const target = (tagsData.targets.protein_g || 0) * 7;
    const next = [0, 1].map((i) => ({
      pct: target ? Math.max(0, Math.min(100, (m.proteinG[i] / target) * 100)) : 0,
      prot: m.proteinG[i], cost: m.weekCost[i],
      gaps: m.weekGaps[i],
    }));
    const instant = !lastMeter || staged === true || reducedMotion();
    cancelAnimationFrame(meterFrame);
    const t0 = performance.now();
    el.querySelectorAll(".meter-week").forEach((w, i) => {
      const n = next[i], o = lastMeter && lastMeter[i];
      w.querySelector(".meter-bar").style.width = n.pct.toFixed(1) + "%";
      w.querySelector(".meter-gaps").textContent = n.gaps.length ? `${n.gaps.length} gap${n.gaps.length === 1 ? "" : "s"}: ${n.gaps.slice(0, 3).map(labelize).join(", ")}` : "No gaps";
      const paint = (f) => {
        w.querySelector(".m-prot").textContent = `~${Math.round(o.prot + (n.prot - o.prot) * f)}g protein (approx)`;
        w.querySelector(".m-cost").textContent = n.cost === null ? "n/a" : `~£${(o.cost + (n.cost - o.cost) * f).toFixed(0)}`;
      };
      if (instant || (o.prot === n.prot && o.cost === n.cost)) {
        w.querySelector(".m-prot").textContent = `~${n.prot}g protein (approx)`;
        w.querySelector(".m-cost").textContent = n.cost === null ? "n/a" : `~£${n.cost.toFixed(0)}`;
      } else {
        w._paint = paint;
      }
    });
    const animated = [...el.querySelectorAll(".meter-week")].filter((w) => w._paint);
    if (animated.length) {
      const step = (now) => {
        const f = Math.min(1, (now - t0) / 400);
        animated.forEach((w) => w._paint(f));
        if (f < 1) meterFrame = requestAnimationFrame(step);
        else animated.forEach((w) => { w._paint = null; });
      };
      meterFrame = requestAnimationFrame(step);
    }
    lastMeter = next;
    renderFixCard(false);
  }

  /** Fix-this-gap button label + card. `open` = user just pressed the button. */
  function renderFixCard(open) {
    const btn = document.getElementById("fix-gap-btn"), card = document.getElementById("fix-card");
    if (!btn) return;
    const sig = planSig(plan);
    if (fixDismissed.sig !== sig) fixDismissed = { sig, days: new Set() };
    const fix = fixGap();
    btn.disabled = !fix;
    btn.textContent = fix ? "Fix this gap" : (planMetrics(plan).gaps ? "No single swap closes the gap" : "No gaps to fix");
    card.hidden = !(open && fix && !fixDismissed.days.has(fix.day));
    if (card.hidden) return;
    const name = (id) => (mealsById[id] || {}).name || id;
    card.innerHTML = `<div>Day ${fix.day} dinner: ${esc(name(fix.from))} → ${esc(name(fix.to))}, closes ${esc(labelize(fix.nutrient))}</div>
      <button class="btn-secondary" data-act="swap" type="button">Swap</button> <button class="btn-secondary" data-act="skip" type="button">Not this</button>`;
    card.querySelector('[data-act="swap"]').addEventListener("click", () => { setSlotMeal(fix.day, "dinner", fix.to); renderPlan(); });
    card.querySelector('[data-act="skip"]').addEventListener("click", () => { fixDismissed.days.add(fix.day); card.hidden = true; });
  }

  function candidateWeeks() {
    const cand = (vocabAll && vocabAll.candidates) || {};
    const chip = cand.protein && cand.protein.chip;
    const overrides = {
      cheapest: { budgetTarget: (cand.cheapest || {}).budgetTarget || 1 },
      protein: chip ? { chips: (prefs.chips || []).concat(chip.id), vocab: Object.assign({}, prefs.vocab, { chips: ((prefs.vocab || {}).chips || []).concat(chip) }) } : {},
      quickest: { noBatch: true },
    };
    return Object.keys(overrides).map((key) => {
      const p = generatePlan(overrides[key]);
      return Object.assign({ key, label: CANDIDATE_LABELS[key], plan: p }, planMetrics(p));
    });
  }

  const planSig = (pl) => pl.days.map((d) => SLOT_TYPES.map((t) => (d.slots[t] || {}).mealId || "").join(",")).join("|");

  function renderCompareSheet() {
    const cands = candidateWeeks();
    const sheet = document.getElementById("swap-sheet");
    const sigs = cands.map((c) => planSig(c.plan));
    const sameAs = (i) => { const j = sigs.findIndex((s) => s === sigs[i]); return j < i ? cands[j].label : null; };
    sheet.innerHTML = `<button class="close-btn" aria-label="Close">✕</button><h2>Compare 3 weeks</h2>
      <div class="compare-grid">${cands.map((c, i) => `<div class="compare-card" data-key="${c.key}">
        <h3>${esc(c.label)}</h3>
        <p>Cost <b>${c.cost === null ? "n/a" : "~£" + c.cost.toFixed(0)}</b></p>
        <p>Protein <b>~${c.proteinG[0]} / ${c.proteinG[1]} g</b> <small>(approx, wk 1 / wk 2)</small></p>
        <p>Quick dinners <b>${c.quickDinners} of 14</b></p>
        <p><small>${c.gaps} nutrient gaps</small></p>
        ${sameAs(i) ? `<p class="muted"><small>same as ${esc(sameAs(i))}</small></p>` : ""}
        <button class="primary use-candidate" data-i="${i}">Use this plan</button></div>`).join("")}</div>`;
    sheet.querySelector(".close-btn").addEventListener("click", closeSwapPicker);
    sheet.querySelectorAll(".use-candidate").forEach((b) => b.addEventListener("click", () => {
      if (!confirm("Replace the 2-week plan? This replaces your current edits.")) return;
      plan = cands[Number(b.dataset.i)].plan;
      savePlan();
      closeSwapPicker();
      renderPlan();
      toast("Plan replaced");
    }));
    document.getElementById("swap-overlay").classList.remove("hidden");
  }

  function loadPlan() {
    const stored = localStorage.getItem(LS_PLAN);
    return stored ? JSON.parse(stored) : generatePlan();
  }

  function savePlan() {
    localStorage.setItem(LS_PLAN, JSON.stringify(plan));
    window.dispatchEvent(new CustomEvent("mp:plan-saved", { detail: plan }));
  }

  // Phase 66: a slot is held when the user locked it or it was eaten. With `exceptDay` (a day or an array of
  // days), every slot on the other days is held too, so only those days are filled.
  const isHeld = (slot) => !!(slot && slot.mealId && (slot.locked || slot.eatenAt));
  function lockedMap(exceptDay) {
    const free = exceptDay == null ? [] : [].concat(exceptDay);
    const out = {};
    plan.days.forEach((d) => {
      for (const t of SLOT_TYPES) {
        const slot = d.slots[t];
        if (!slot || !slot.mealId) continue;
        if (isHeld(slot) || (free.length && !free.includes(d.day))) (out[d.day] = out[d.day] || {})[t] = slot;
      }
    });
    return out;
  }
  const lockCount = () => plan.days.reduce((n, d) => n + SLOT_TYPES.filter((t) => d.slots[t] && d.slots[t].locked && !d.slots[t].eatenAt).length, 0);

  function regenerate(staged, override) {
    applyHints();
    const held = lockedMap();
    if (SLOT_TYPES.every((t) => plan.days.every((d) => held[d.day] && held[d.day][t]))) { toast("Nothing to fill"); return; }
    plan = generatePlan(override, held); // fresh startDate/shopAnchor, offset 0
    savePlan();
    renderPlan(staged);
  }

  function rerollDay(day) {
    const days = MP.chainDays(plan.days, mealsById, day);
    if (days.every((d) => SLOT_TYPES.every((t) => isHeld(plan.days[d - 1].slots[t])))) { toast("All meals on this day are locked"); return; }
    const fresh = generatePlan({ shopOffset: MP.ShelfLife.shopOffset(plan) }, lockedMap(days));
    days.forEach((d) => { plan.days[d - 1] = fresh.days[d - 1]; });
    if (!guidedActive) savePlan();
    renderPlan();
    toast(days.length > 1 ? `Rerolled ${days.length} days (batch chain)` : `Rerolled day ${day}`);
  }

  // Phase 72: planning-chat edits. Session-scoped constraints (never stored) are re-applied to target days only, by
  // re-picking them with every other slot held (the rerollDay path); no ranking code here, rankSlot stays the one ranker.
  let chatPrefs = null;
  const resetChatPrefs = () => { chatPrefs = null; };

  /** Per-day generator override: base prefs + this session's chatPrefs for `d`. */
  function chatOverrideFor(base, cp, d) {
    const u = (a, b) => [...new Set([...(a || []), ...(b || [])])];
    const o = {
      busyDays: u(base.busyDays, cp.busyDays).filter((x) => !cp.freeDays.includes(x)),
      freeDays: u(base.freeDays, cp.freeDays).filter((x) => !cp.busyDays.includes(x)),
      chips: u(base.chips, cp.chips[d]),
    };
    if (cp.budget[d]) o.budgetTarget = cp.budget[d];
    return o;
  }

  /** Apply validated edits to the working plan (no savePlan). Returns changes [{ day, slot, before, after }]; `.notes` has skip reasons.
   *  ctx (tests): { plan, byId, prefs, focusDay, generate(override, locked), chatPrefs }. */
  function applyChatEdits(edits, ctx) {
    const c = Object.assign({ plan, byId: mealsById, prefs, focusDay: 1, generate: generatePlan }, ctx);
    const pl = c.plan;
    const r = MP.PlanChat.toOverride(edits, (ctx && ctx.chatPrefs) || chatPrefs, c.focusDay);
    chatPrefs = r.chatPrefs;
    const changes = [];
    changes.notes = [];
    const held = (s) => !!(s && s.mealId && (s.locked || s.eatenAt));
    r.unlocks.forEach(({ day, slot }) => {
      const s = pl.days[day - 1].slots[slot];
      if (s && s.locked) { const n = { ...s }; delete n.locked; pl.days[day - 1].slots[slot] = n; }
    });
    r.locks.forEach(({ day, slot }) => {
      const s = pl.days[day - 1].slots[slot];
      if (s && s.mealId && !s.eatenAt) pl.days[day - 1].slots[slot] = { ...s, locked: true };
    });
    const lockedFor = (days) => {
      const free = new Set(days), out = {};
      pl.days.forEach((d) => SLOT_TYPES.forEach((t) => {
        const s = d.slots[t];
        if (s && s.mealId && (held(s) || !free.has(d.day))) (out[d.day] = out[d.day] || {})[t] = s;
      }));
      return out;
    };
    // target days, widened to their batch chain like rerollDay; a day keeps its own override, equal overrides share one generate
    const groups = new Map();
    const targets = new Set();
    r.days.forEach((d) => (r.slotOnly[d] ? [d] : MP.chainDays(pl.days, c.byId, d)).forEach((x) => targets.add(x)));
    [...targets].sort((a, b) => a - b).forEach((d) => {
      const o = chatOverrideFor(c.prefs, chatPrefs, d);
      const key = JSON.stringify([o.chips, o.budgetTarget || 0]);
      if (!groups.has(key)) groups.set(key, { o, days: [] });
      groups.get(key).days.push(d);
    });
    groups.forEach(({ o, days }) => {
      if (days.every((d) => SLOT_TYPES.every((t) => !pl.days[d - 1].slots[t] || held(pl.days[d - 1].slots[t])))) {
        changes.notes.push("That one's locked");
        return;
      }
      const fresh = c.generate(Object.assign({ shopOffset: MP.ShelfLife.shopOffset(pl) }, o), lockedFor(days));
      days.forEach((d) => {
        const only = r.slotOnly[d];
        for (const t of only ? [only] : SLOT_TYPES) {
          const before = pl.days[d - 1].slots[t], after = fresh.days[d - 1].slots[t];
          if (held(before)) continue;
          if ((before || {}).mealId === (after || {}).mealId && (before || {}).variantId === (after || {}).variantId) continue;
          pl.days[d - 1].slots[t] = after;
          changes.push({ day: d, slot: t, before: before || null, after: after || null });
        }
      });
    });
    return changes;
  }

  // Phase 73: tie questions and trade-off cards. Both are session UI over the chat's working copy; nothing is stored.
  const planningKnob = (k, d) => { const v = packData && packData.planning && packData.planning[k]; return typeof v === "number" ? v : d; };
  // A dinner the cards may touch: not held (locked/eaten), eaten out, frozen, a leftover or a batch head.
  const cardSkip = (slot, meal) => !slot || !meal || isHeld(slot) || slot.eatingOut || slot.frozenFrom || meal.leftoverOf || MP.isBatch(meal);

  /** { day, slot, current, alt } when the current dinner and the top candidate fill that day's gaps equally, else null. */
  function tieFor(day, ctx) {
    const c = Object.assign({ plan, library, tags: tagsData && tagsData.tags, targets: tagsData && tagsData.targets, cands: candidatesFor, margin: planningKnob("tieMargin", 0) }, ctx);
    const byId = Object.fromEntries(c.library.map((m) => [m.id, m]));
    const slots = c.plan.days[day - 1].slots, cur = slots.dinner && byId[slots.dinner.mealId];
    if (!c.tags || cardSkip(slots.dinner, cur)) return null;
    const alt = c.cands(day, "dinner")[0];
    if (!alt || alt.id === cur.id) return null;
    const others = SLOT_TYPES.filter((t) => t !== "dinner").map((t) => slots[t] && byId[slots[t].mealId]).filter(Boolean);
    const cov = MP.Nutrition.dayCoverage(others, c.tags, c.targets);
    const gaps = [...cov.missing, ...cov.partial];
    if (!gaps.length) return null; // nothing left to fill, so "equal" means nothing
    const sc = (m) => MP.Nutrition.gapScore(m, gaps, c.tags);
    return Math.abs(sc(cur) - sc(alt)) <= c.margin ? { day, slot: "dinner", current: cur, alt } : null;
  }

  /** £/week the chat is held to: this session's budget edit, else profile settings, else plan prefs; 0 = none. */
  function effectiveBudget() {
    const cb = chatPrefs && Object.values(chatPrefs.budget || {});
    if (cb && cb.length) return Number(cb[cb.length - 1]) || 0;
    return Number((MP.Sync.settings() || {}).budgetTarget) > 0 ? Number(MP.Sync.settings().budgetTarget) : Number(prefs.budgetTarget) || 0;
  }

  /** Up to tradeMaxSwaps dinner swaps in `week` that save money, with before/after numbers from planMetrics; null if none. */
  function budgetSwaps(week, overBy, ctx) {
    const c = Object.assign({ plan, library, tags: tagsData && tagsData.tags, targets: tagsData && tagsData.targets, packData, cands: candidatesFor,
      shortlist: planningKnob("shortlistSize", 4), maxSwaps: planningKnob("tradeMaxSwaps", 2) }, ctx);
    const base = planMetrics(c.plan, c);
    if (base.weekCost[week] === null) return null;
    const byId = Object.fromEntries(c.library.map((m) => [m.id, m]));
    const options = [];
    for (const d of c.plan.days.slice(week * 7, week * 7 + 7)) {
      const from = byId[(d.slots.dinner || {}).mealId];
      if (cardSkip(d.slots.dinner, from)) continue;
      let best = null;
      for (const to of c.cands(d.day, "dinner").slice(0, c.shortlist)) {
        const copy = structuredClone(c.plan);
        copy.days[d.day - 1].slots.dinner = { mealId: to.id, locked: true };
        const m = planMetrics(copy, c);
        const saving = base.weekCost[week] - m.weekCost[week], loss = base.proteinG[week] - m.proteinG[week];
        if (saving > 0 && (!best || saving > best.saving || (saving === best.saving && loss < best.loss))) best = { day: d.day, from, to, saving, loss };
      }
      if (best) options.push(best);
    }
    options.sort((a, b) => b.saving - a.saving);
    const swaps = [];
    let saved = 0;
    for (const o of options) {
      if (swaps.length >= c.maxSwaps || saved >= overBy) break;
      swaps.push(o); saved += o.saving;
    }
    if (!swaps.length) return null;
    const after = structuredClone(c.plan);
    swaps.forEach((o) => { after.days[o.day - 1].slots.dinner = { mealId: o.to.id, locked: true }; });
    const m = planMetrics(after, c);
    return {
      week, swaps: swaps.map((o) => ({ day: o.day, from: o.from, to: o.to })),
      before: { cost: base.weekCost[week], proteinG: base.proteinG[week] }, after: { cost: m.weekCost[week], proteinG: m.proteinG[week] },
    };
  }

  /** Names-only context sent with each chat message; day is the card in focus. */
  function chatContext(day) {
    const m = planMetrics(plan), wk = day > 7 ? 1 : 0;
    const d = plan.days[day - 1] || { slots: {} };
    const dayMeals = {};
    SLOT_TYPES.forEach((t) => { const s = d.slots[t]; if (s && s.mealId) dayMeals[t] = (mealsById[s.mealId] || {}).name || s.mealId; });
    const today = MP.Generator.isoToday();
    return {
      day, startDate: plan.startDate, dayMeals,
      gaps: m.weekGaps[wk].slice(0, 3), proteinG: m.proteinG[wk], weekCost: m.weekCost[wk],
      budgetTarget: Number(prefs.budgetTarget) || 0,
      cards: chatCardLines(),
      expiring: MP.ShoppingList.useUpItems(MP.Sync.localItems("pantry"), plan, today, shelfData).slice(0, 5).map((x) => x.name),
    };
  }

  function toggleLock(day, slotType) {
    const slot = plan.days[day - 1].slots[slotType];
    if (!slot || !slot.mealId || slot.eatenAt) return;
    const on = !slot.locked;
    const days = slotType === "dinner" ? MP.chainDays(plan.days, mealsById, day) : [day];
    days.forEach((d) => {
      const sl = { ...plan.days[d - 1].slots[slotType] };
      if (on) sl.locked = true; else delete sl.locked;
      plan.days[d - 1].slots[slotType] = sl;
    });
    if (!guidedActive) savePlan();
    renderPlan();
    if (days.length > 1) toast(`${on ? "Locked" : "Unlocked"} ${days.length} days (batch chain)`);
  }

  function unlockAll() {
    plan.days.forEach((d) => SLOT_TYPES.forEach((t) => { if (d.slots[t] && d.slots[t].locked) { d.slots[t] = { ...d.slots[t] }; delete d.slots[t].locked; } }));
    if (!guidedActive) savePlan();
    renderPlan();
  }

  // ---- Mid-week re-flow (Phase 63) ----
  const LS_UNDO = "mp_planUndo";
  /** One-level undo snapshot; not plan state. */
  function snapshot(planIn) {
    localStorage.setItem(LS_UNDO, JSON.stringify(planIn));
    return planIn;
  }
  function restore() {
    const raw = localStorage.getItem(LS_UNDO);
    if (!raw) return null;
    localStorage.setItem(LS_PLAN, raw);
    window.dispatchEvent(new CustomEvent("mp:plan-saved", { detail: JSON.parse(raw) }));
    return JSON.parse(raw);
  }
  /** Pure: MP.reflowPlan with the page's generator. ctx = { fromDay, generate(locked, ranOutKeys) }. */
  function reflow(planIn, input, lib, ctx) {
    return MP.reflowPlan(planIn, input, Object.fromEntries(lib.map((m) => [m.id, m])), ctx.fromDay, ctx.generate);
  }

  function doReflow(input) {
    const res = reflow(plan, input, library, { fromDay: MP.reflowFromDay(plan.startDate, new Date().toLocaleDateString("sv")), generate: (locked, ranOut, avoid) => generatePlan({ shopOffset: MP.ShelfLife.shopOffset(plan) }, locked, ranOut, avoid) });
    if (!res.changes.length) { closeDayView(); toast(res.ignored.length ? "Eaten, locked or past meals can't be re-flowed" : "Nothing to change"); return; }
    snapshot(plan);
    plan = res.plan;
    savePlan();
    closeDayView();
    renderPlan();
    toast(`Re-planned ${res.changes.length} slot${res.changes.length === 1 ? "" : "s"}`, { label: "Undo re-flow", fn: () => { const p = restore(); if (p) { plan = p; renderPlan(); toast("Back to before the re-flow"); } } });
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
    plan.days[day - 1].slots[slotType] = { mealId, locked: true }; // Phase 63: a hand swap is the user's act, so it survives a re-flow
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
    renderTomorrowCard();
  }

  // Phase 75: tomorrow's dinner with the top 3 swap-deck candidates. Pick = setSlotMeal (locks), Keep = toggleLock.
  function renderTomorrowCard() {
    const el = document.getElementById("tomorrow-card");
    if (!el) return;
    el.hidden = true;
    if (!plan || !plan.startDate || guidedActive) return;
    const next = new Date(); next.setDate(next.getDate() + 1);
    const day = planDayOf(plan.startDate, next.toLocaleDateString("en-CA"), plan.days.length);
    const slot = day && plan.days[day - 1].slots.dinner;
    const em = slot && slot.mealId ? effectiveMealAt(day, "dinner") : null;
    if (!em) return;
    const reason = slot.eatenAt ? "Already eaten" : em.leftoverOf ? "Leftovers" : MP.isBatch(em) ? "Batch cook: change it in the day view" : "";
    const alts = reason ? [] : candidatesFor(day, "dinner").slice(0, 3);
    el.hidden = false;
    el.innerHTML = `<div class="gap-head"><strong>Tomorrow's dinner</strong></div>
      <div class="tomorrow-meal">${esc(em.name)}${slot.locked ? ` <span class="lock-icon">Kept 🔒</span>` : ""}${reason ? ` <small>· ${esc(reason)}</small>` : ""}</div>
      ${!slot.eatenAt && !slot.locked ? `<button class="btn" id="tomorrow-keep">Keep</button>` : ""}
      ${alts.length ? `<div class="tomorrow-alts">${alts.map((m) => `<button class="btn tomorrow-alt" data-alt="${esc(m.id)}">${esc(m.name)}</button>`).join("")}</div>` : ""}`;
    const keep = el.querySelector("#tomorrow-keep");
    if (keep) keep.addEventListener("click", () => toggleLock(day, "dinner"));
    el.querySelectorAll("[data-alt]").forEach((b) => b.addEventListener("click", () => pickTomorrow(day, b.dataset.alt)));
  }

  function pickTomorrow(day, mealId) {
    const meal = mealsById[mealId];
    if (!meal) return false;
    const { ok, reasons } = MP.Exclusions.check(MP.effectiveMeal(meal), MP.Sync.hardTerms());
    if (!ok) { toast("Excluded: " + reasons.join(", ")); return false; }
    setSlotMeal(day, "dinner", mealId);
    renderPlan();
    return true;
  }
  window.pickTomorrow = pickTomorrow; window.candidatesFor = candidatesFor; // walk.mjs drives the refusal path and checks the order

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
          <h3>${heading}${hintChipHtml(d.day)}<button class="reroll-btn" data-day="${d.day}" aria-label="Reroll day ${d.day}" title="Reroll this day">🎲 Reroll</button></h3>
          <div class="slot-grid">
            ${SLOT_TYPES.map((slotType) => {
              const meal = mealAt(d.day, slotType);
              const warn = warnings[`${d.day}-${slotType}`];
              const locked = meal && plan.days[d.day - 1].slots[slotType].locked;
              return `<div class="slot-card ${meal ? "" : "empty"}${locked ? " locked" : ""}" data-day="${d.day}" data-slot="${slotType}">
                <div class="slot-type">${slotType}${locked ? ` <span class="lock-icon" aria-label="Locked">🔒</span>` : ""}</div>
                <div class="slot-meal">${meal ? esc(meal.name) : plan.days[d.day - 1].slots[slotType] && plan.days[d.day - 1].slots[slotType].eatingOut ? "Eating out" : "tap to add"}</div>
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
    renderMeter(staged);

    root.querySelectorAll(".hint-chip").forEach((el) => {
      el.addEventListener("click", () => {
        const h = hintByDay[Number(el.dataset.day)];
        if (!h || !dayHints) return;
        MP.DayHints.dismiss(h.date, dayHints.updatedAt);
        applyHints(plan.startDate);
        renderPlan();
      });
    });
    root.querySelectorAll(".reroll-btn").forEach((b) => b.addEventListener("click", () => rerollDay(Number(b.dataset.day))));
    document.getElementById("unlock-btn").hidden = !lockCount();
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
    if (chat) renderChatDay();
    renderTomorrowCard();
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
  let swapCtx = null; // { day, slotType, candidates, mode }

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
      taste: MP.Ratings.tasteProfile(MP.Ratings.get(), library),
      profile: MP.Nutrition.profileOf(MP.Sync.settings()),
    });
  }

  function openSwapPicker(day, slotType) {
    swapCtx = { day, slotType, candidates: candidatesFor(day, slotType), mode: "swap" };
    renderDeck();
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
    swapCtx = { day, slotType, candidates, mode: "guided" };
    renderDeck();
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

  // One deck for Swap and the guided walkthrough; swapCtx.mode is "swap" | "guided".
  function renderDeck() {
    const sheet = document.getElementById("swap-sheet");
    const { day, slotType, mode } = swapCtx;
    const head = mode === "guided"
      ? `<button class="close-btn" aria-label="Skip to review">✕</button>
      <h2>Day ${day} of ${plan.days.length} — ${esc(slotType[0].toUpperCase() + slotType.slice(1))}</h2>
      <p class="swipe-hint" style="margin-top:0;">Step ${guided.pass * guided.days.length + guided.idx + 1} of ${guided.total} ·
      Swipe right to pick · swipe left for another option · tap to view recipe</p>`
      : `<button class="close-btn" aria-label="Close">✕</button>
      <h2>Swap ${esc(slotType)} — Day ${day}</h2>
      <p class="swipe-hint" style="margin-top:0;">Recommended swaps are sorted first based on what today is short on.<br>
      Swipe right to confirm · swipe left to skip · tap to view recipe</p>`;
    sheet.innerHTML = `${head}
      <div id="swap-deck" class="swipe-deck" style="height:340px;"></div>
      <div class="deck-actions"><button class="ghost deck-pass">Pass</button>${chat ? `<button class="ghost deck-pick">Pick for me</button>` : ""}
      <span class="deck-left" aria-live="polite"></span><button class="deck-take">Take</button></div>`;
    sheet.querySelector(".close-btn").addEventListener("click", closeSwapPicker);
    sheet.querySelector(".deck-take").addEventListener("click", () => flyOff(1));
    sheet.querySelector(".deck-pass").addEventListener("click", () => flyOff(-1));
    const pick = sheet.querySelector(".deck-pick");
    if (pick) pick.addEventListener("click", () => flyOff(1)); // candidatesFor is already ranked: the top card is the pick
    renderDeckCards();
  }

  function renderDeckCards() {
    const deck = document.getElementById("swap-deck");
    if (!deck) return;
    deck.innerHTML = "";
    const n = swapCtx.candidates.length;
    document.querySelector(".deck-left").textContent = `${n} left`;
    document.querySelectorAll(".deck-actions button").forEach((b) => (b.disabled = !n));
    if (!n) {
      deck.innerHTML = `<div class="swipe-empty">No other meals in your library for this slot yet — add some on the Browse & Add page.</div>`;
      return;
    }
    const shown = swapCtx.mode === "guided" && swapCtx.slotType === "dinner" ? 5 : 3;
    swapCtx.candidates.slice(0, shown).forEach((meal, idx) => {
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
          onSwipeRight: () => takeMeal(meal),
          onSwipeLeft: () => passMeal(meal),
          onTap: () => openDetail(meal),
        });
        attachWhatIf(card, meal);
      }
      deck.appendChild(card);
    });
  }

  // Button path: play the fly-off on the top card, then call the same handler a swipe does.
  function flyOff(dir) {
    const top = swapCtx && swapCtx.candidates[0];
    const card = document.querySelector("#swap-deck .swipe-card");
    if (!top || !card || card.classList.contains("fly-left") || card.classList.contains("fly-right")) return;
    card.classList.add(dir > 0 ? "fly-right" : "fly-left");
    const go = () => (dir > 0 ? takeMeal(top) : passMeal(top));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) go(); else setTimeout(go, 250);
  }

  // Guard on the top card so a double click or a swipe racing a button fires once.
  function takeMeal(meal) {
    if (!swapCtx || swapCtx.candidates[0] !== meal) return;
    const { day, slotType, mode } = swapCtx;
    setSlotMeal(day, slotType, meal.id);
    if (mode === "guided") {
      toast(`Day ${day}: using "${meal.name}"`);
      advanceGuided();
    } else {
      toast(`Swapped in "${meal.name}"`);
      closeSwapPicker();
      renderPlan();
    }
  }

  function passMeal(meal) {
    if (!swapCtx || swapCtx.candidates[0] !== meal) return;
    swapCtx.candidates = swapCtx.candidates.slice(1);
    if (!swapCtx.candidates.length && swapCtx.mode === "guided") advanceGuided();
    else renderDeckCards();
  }

  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (!swapCtx || !document.getElementById("swap-deck") || document.getElementById("swap-overlay").classList.contains("hidden")) return;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!document.getElementById("detail-overlay").classList.contains("hidden")) return;
    if (e.key === "ArrowRight") flyOff(1);
    else if (e.key === "ArrowLeft") flyOff(-1);
    else if (e.key === "Escape") closeSwapPicker();
  });

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
        ${slot.eatenAt ? "" : `<button class="ghost day-lock-btn" data-slot="${slotType}">${slot.locked ? "Unlock" : "Lock"}</button>
        <button class="ghost day-skip-btn" data-slot="${slotType}">${slotType === "dinner" && MP.isBatch(meal) ? "Skip cook" : "Skip"}</button>
        <button class="ghost day-out-btn" data-slot="${slotType}">Eating out</button>`}
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
    sheet.querySelectorAll(".day-lock-btn").forEach((b) =>
      b.addEventListener("click", () => toggleLock(day, b.dataset.slot)));
    sheet.querySelectorAll(".day-skip-btn").forEach((b) =>
      b.addEventListener("click", () => doReflow({ skipped: [{ day, slot: b.dataset.slot }] })));
    sheet.querySelectorAll(".day-out-btn").forEach((b) =>
      b.addEventListener("click", () => doReflow({ eatingOut: [{ day, slot: b.dataset.slot }] })));
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
    const rolled = planIn.rolledAt && planIn.rolledFrom && planIn.startDate
      ? Math.round((Date.parse(planIn.startDate) - Date.parse(planIn.rolledFrom)) / 86400000) : 0;
    for (let p of placements) {
      if (rolled > 0 && p.requestedAt && p.requestedAt < planIn.rolledAt) { // Phase 68: queued before the plan rolled, so its day is in the old numbering
        if (p.day - rolled < 1) {
          rejected.push({ day: p.day, slot: p.slot, mealId: p.mealId, name: p.mealName, reason: "past" });
          continue;
        }
        p = { ...p, day: p.day - rolled };
      }
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
    const reasonText = { eaten: "already eaten", "unknown-meal": "not in your library", "bad-slot": "invalid slot", past: "already past" };
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
    // Phase 68: the draft's day numbers are relative to draft.startDate; rebase onto the rolled plan, drop days already past
    const shift = draft.startDate && plan.startDate ? Math.round((Date.parse(plan.startDate) - Date.parse(draft.startDate)) / 86400000) : 0;
    const changes = shift > 0 ? draft.changes.map((c) => ({ ...c, day: c.day - shift })).filter((c) => c.day >= 1) : draft.changes;
    if (!changes.length) { el.hidden = true; MP.Sync.ackPlanDraft(draft); return; }
    const rows = changes.map((c) => {
      const m = mealsById[c.after.mealId];
      return `<li>Day ${c.day} ${esc(c.slot)} — ${c.after.eatingOut ? "Eating out" : esc(m ? m.name : c.after.mealId)}</li>`;
    }).join("");
    el.innerHTML = `<p>The assistant drafted ${changes.length} change${changes.length === 1 ? "" : "s"} to your plan:</p><ul>${rows}</ul>
      <button class="btn" data-act="apply">Apply</button> <button class="btn" data-act="dismiss">Dismiss</button>`;
    el.hidden = false;
    el.onclick = async (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      el.hidden = true;
      if (act === "apply") {
        if (draft.reflow) MP.Plan.snapshot(plan); // Phase 63: Activity "Undo" on the draft restores this
        const outs = changes.filter((c) => c.after.eatingOut);
        const placements = changes.filter((c) => !c.after.eatingOut).map((c) => ({ day: c.day, slot: c.slot, mealId: c.after.mealId, variantId: c.after.variantId }));
        const res = MP.Plan.applyPlacements(plan, placements, library);
        plan = res.plan;
        outs.forEach((c) => { const sl = plan.days[c.day - 1].slots; if (!(sl[c.slot] && sl[c.slot].eatenAt)) sl[c.slot] = { eatingOut: true }; });
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

  MP.Plan = { applyChatEdits, chatContext, tieFor, effectiveBudget, budgetSwaps, resetChatPrefs, reflow, snapshot, restore, planMetrics, whatIf, fixGap, parseGuidedSlots, applyPlacements, logPortion, matchEatRequests, applyEatRequests };

  // ---- Planning chat with Hermes (Phase 72) ----
  // The working plan is `plan` itself with guidedActive on (no savePlan runs); Exit restores the snapshot, Save commits.
  const CHAT_POLL_MS = 1000, CHAT_GIVE_UP_MS = 90000, CHAT_BRIDGE_FRESH_MS = 30000;
  let chat = null; // { session, snapshot, day, since, mine:Set, pending, deadline, timer, changes }
  const $ = (id) => document.getElementById(id);

  function chatBubble(from, text) {
    const b = document.createElement("div");
    b.className = "chat-bubble " + from;
    b.textContent = text; // untrusted: textContent only
    $("chat-log").appendChild(b);
    b.scrollIntoView({ block: "end" });
    return b;
  }

  function setChatWaiting(on) {
    $("chat-typing").hidden = !on;
    $("chat-send").disabled = on;
    $("chat-input").disabled = on;
    if (!on) $("chat-input").focus();
  }

  function renderChatDay(staged) {
    if (!chat) return;
    const day = chat.day, d = plan.days[day - 1];
    $("chat-day-title").textContent = dayHeading(day);
    const changed = new Set(chat.changes.filter((c) => c.day === day && !c.rejected).map((c) => c.slot));
    const host = $("chat-day");
    host.innerHTML = SLOT_TYPES.map((t) => {
      const meal = mealAt(day, t), s = d.slots[t];
      return `<div class="slot-card ${meal ? "" : "empty"}${s && s.locked ? " locked" : ""}${changed.has(t) ? " slot-diff" : ""}" data-slot="${t}" tabindex="0" role="button">
        <div class="slot-type">${t}${s && s.locked ? ` <span class="lock-icon" aria-label="Locked">🔒</span>` : ""}</div>
        <div class="slot-meal">${meal ? esc(meal.name) : s && s.eatingOut ? "Eating out" : "tap to add"}</div></div>`;
    }).join("");
    host.classList.toggle("staging", !!staged);
    if (staged) host.querySelectorAll(".slot-card").forEach((el, i) => { el.style.animationDelay = Math.min(i * STAGE_STEP_MS, STAGE_MAX_MS) + "ms"; });
    host.querySelectorAll(".slot-card").forEach((el) => {
      const open = () => {
        swapCtx = { day, slotType: el.dataset.slot, candidates: candidatesFor(day, el.dataset.slot), mode: "swap" };
        renderDeck();
        $("swap-overlay").classList.remove("hidden");
      };
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
    renderChatCards();
  }

  // Phase 73 cards. chat.cards = { tie, trade } is what is on screen now (also sent to Hermes as context.cards).
  const dayShort = (day) => (plan.startDate ? WEEKDAY[MP.Generator.weekdayOf(plan.startDate, day)] : "Day " + day);
  const gbp = (n) => "£" + Math.round(n);

  function tradeText(t) {
    const swaps = t.swaps.map((x) => `${dayShort(x.day)} (${x.from.name} → ${x.to.name})`).join(" and ");
    const dp = t.after.proteinG - t.before.proteinG;
    return `Swap ${swaps}: saves ${gbp(t.before.cost - t.after.cost)}, ${dp < 0 ? `costs ${-dp} g protein` : `adds ${dp} g protein`}`;
  }
  const tradeTotals = (t) => `Week ${t.week + 1}: ${gbp(t.before.cost)} → ${gbp(t.after.cost)} · protein ${t.before.proteinG} g → ${t.after.proteinG} g`;

  function chatCardLines() {
    const cards = (chat && chat.cards) || {};
    return [
      cards.tie ? `tie ${dayShort(cards.tie.day)}: ${cards.tie.current.name} or ${cards.tie.alt.name}` : null,
      cards.trade ? `trade-off: ${tradeText(cards.trade)}` : null,
    ].filter(Boolean);
  }

  // A swap made from a card goes through setSlotMeal (working copy only) and shows up as a diff row.
  function cardSwap(day, mealId) {
    const before = plan.days[day - 1].slots.dinner;
    setSlotMeal(day, "dinner", mealId);
    chat.changes.push({ day, slot: "dinner", before, after: plan.days[day - 1].slots.dinner });
  }

  function cardShell(cls) {
    const el = document.createElement("div");
    el.className = "chat-card " + cls;
    return el;
  }

  function renderChatCards() {
    const host = $("chat-cards");
    host.textContent = "";
    const cards = (chat.cards = { tie: null, trade: null });
    const tie = !chat.ask && !chat.tieDone.has(chat.day) ? tieFor(chat.day) : null;
    if (tie) {
      cards.tie = tie;
      const el = cardShell("chat-tie");
      const q = document.createElement("div");
      q.textContent = `${dayShort(tie.day)} dinner: this or that?`;
      el.appendChild(q);
      [tie.current, tie.alt].forEach((m, i) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "btn-secondary"; b.textContent = m.name;
        b.addEventListener("click", () => {
          chat.tieDone.add(tie.day);
          if (i === 1) { cardSwap(tie.day, m.id); renderChatDiff(); renderPlan(); }
          renderChatDay();
        });
        el.appendChild(b);
      });
      host.appendChild(el);
    }
    const target = effectiveBudget();
    if (target > 0) {
      const wc = planMetrics(plan).weekCost;
      for (const w of [0, 1]) {
        if (wc[w] === null || wc[w] <= target || chat.tradeOff[w] === wc[w]) continue;
        const t = budgetSwaps(w, wc[w] - target);
        if (!t) continue;
        cards.trade = t;
        const el = cardShell("chat-trade");
        const txt = document.createElement("div");
        txt.className = "chat-trade-text"; txt.textContent = tradeText(t);
        const tot = document.createElement("div");
        tot.className = "chat-trade-totals"; tot.textContent = tradeTotals(t);
        const ok = document.createElement("button");
        ok.type = "button"; ok.className = "primary"; ok.textContent = "Accept";
        ok.addEventListener("click", () => {
          t.swaps.forEach((x) => cardSwap(x.day, x.to.id));
          chatBubble("understood", tradeTotals(t)).classList.add("chat-understood");
          renderChatDiff(); renderPlan(); renderChatDay();
        });
        const no = document.createElement("button");
        no.type = "button"; no.className = "btn-secondary"; no.textContent = "Not now";
        no.addEventListener("click", () => { chat.tradeOff[w] = wc[w]; renderChatCards(); });
        el.append(txt, tot, ok, no);
        host.appendChild(el);
        break;
      }
    }
  }

  /** Phase 74: a reject is a dislike only when a reason is given; skip writes nothing. */
  function reasonForm(c) {
    const f = document.createElement("div");
    f.className = "chat-reason";
    const done = (note) => {
      c.askReason = false;
      note = (note || "").trim();
      if (note) {
        MP.Ratings.set(c.after.mealId, { rating: "down", note });
        MP.Sync.pushRating(c.after.mealId, { rating: "down", note }, "rejected in chat: " + note.slice(0, 80));
      }
      renderChatDiff();
    };
    ["too fiddly", "too pricey", "not in the mood", "had it lately"].forEach((t) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn-secondary"; b.textContent = t;
      b.addEventListener("click", () => done(t));
      f.appendChild(b);
    });
    const inp = document.createElement("input");
    inp.type = "text"; inp.className = "chat-reason-input"; inp.maxLength = MP.Ratings.NOTE_MAX;
    inp.placeholder = "Why? (optional)"; inp.setAttribute("aria-label", "Why reject this meal");
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") done(inp.value); });
    const ok = document.createElement("button");
    ok.type = "button"; ok.className = "btn-secondary"; ok.textContent = "Save";
    ok.addEventListener("click", () => done(inp.value));
    const skip = document.createElement("button");
    skip.type = "button"; skip.className = "btn-secondary"; skip.textContent = "Skip";
    skip.addEventListener("click", () => done(""));
    f.append(inp, ok, skip);
    return f;
  }

  function renderChatDiff() {
    const ul = $("chat-diff");
    ul.innerHTML = "";
    chat.changes.forEach((c) => {
      const li = document.createElement("li");
      li.className = "diff-row" + (c.rejected ? " rejected" : "");
      const name = (s) => (s && s.mealId ? (mealsById[s.mealId] || {}).name || s.mealId : "nothing");
      const txt = document.createElement("span");
      txt.textContent = `${dayHeading(c.day)} ${c.slot}: ${name(c.before)} → ${name(c.after)}`;
      const acc = document.createElement("button");
      acc.className = "btn-secondary"; acc.textContent = "Accept"; acc.disabled = !c.rejected;
      const rej = document.createElement("button");
      rej.className = "btn-secondary"; rej.textContent = "Reject"; rej.disabled = !!c.rejected;
      const set = (r) => {
        c.rejected = r;
        c.askReason = r && !!(c.after && c.after.mealId); // Phase 74: optional one-line reason after a reject
        plan.days[c.day - 1].slots[c.slot] = (r ? c.before : c.after) || {};
        renderChatDiff(); renderChatDay(); renderPlan();
      };
      acc.addEventListener("click", () => set(false));
      rej.addEventListener("click", () => set(true));
      li.append(txt, acc, rej);
      if (c.askReason) li.appendChild(reasonForm(c));
      ul.appendChild(li);
    });
  }

  function onChatReply(m) {
    const { reply } = MP.PlanChat.validateReply(m, vocabAll); // the app re-validates before applying anything
    if (reply.text) chatBubble("hermes", reply.text);
    chat.ask = !!reply.ask;
    if (chat.ask) chat.tieDone.add(chat.day); // a question from Hermes closes any open tie card for good
    chat.changes = [];
    if (!reply.ask && reply.edits.length) {
      const changes = applyChatEdits(reply.edits, { focusDay: chat.day });
      const line = MP.PlanChat.describe(reply.edits, plan.startDate, chat.day);
      if (line) { const u = chatBubble("understood", "Understood: " + line); u.classList.add("chat-understood"); }
      changes.notes.forEach((n) => toast(n));
      chat.changes = changes;
      if (changes.length && !changes.some((c) => c.day === chat.day)) chat.day = changes[0].day;
      renderPlan();
    }
    renderChatDiff();
    renderChatDay(chat.changes.length > 0);
  }

  async function pollChat() {
    if (!chat) return;
    const me = chat;
    try {
      const r = await MP.PlanChat.call("GET", `/chat?session=${encodeURIComponent(me.session)}&since=${me.since}`);
      if (chat !== me) return;
      for (const m of r.messages) {
        me.since = Math.max(me.since, m.id);
        if (m.open) me.mine.add(m.id);
        if (m.from === "hermes" && me.mine.has(m.replyTo) && me.pending > 0) { me.pending--; onChatReply(m); }
      }
    } catch (e) {
      if (e.status === 409) { toast("Chat session ended"); return exitChat(); }
    }
    if (chat !== me) return;
    if (me.pending <= 0) return setChatWaiting(false);
    if (Date.now() > me.deadline) {
      setChatWaiting(false);
      $("chat-fallback").hidden = false;
      return;
    }
    me.timer = setTimeout(pollChat, CHAT_POLL_MS);
  }

  function waitForReply() {
    chat.pending++;
    chat.deadline = Date.now() + CHAT_GIVE_UP_MS;
    $("chat-fallback").hidden = true;
    setChatWaiting(true);
    clearTimeout(chat.timer);
    chat.timer = setTimeout(pollChat, CHAT_POLL_MS);
  }

  async function sendChat(text) {
    chatBubble("user", text);
    try {
      const r = await MP.PlanChat.call("POST", "/chat", { session: chat.session, text, day: chat.day, context: chatContext(chat.day) });
      chat.mine.add(r.id);
      waitForReply();
    } catch (e) {
      toast("Couldn't reach Hermes");
    }
  }

  async function openChat() {
    if (chat || guidedActive || !plan) return;
    const goFallback = (msg) => { toast(msg); setTimeout(() => { location.href = "plan-with-me.html"; }, 1200); };
    if (!MP.Sync.config().enabled) { location.href = "plan-with-me.html"; return; }
    const session = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let r;
    try { r = await MP.PlanChat.call("POST", "/chat", { session, open: true, context: chatContext(1) }); } catch (e) { return goFallback("Hermes is offline"); }
    if (!r.bridgeSeenAt || Date.now() - Date.parse(r.bridgeSeenAt) > CHAT_BRIDGE_FRESH_MS) {
      MP.PlanChat.call("POST", "/chat", { session, close: true }).catch(() => {});
      return goFallback("Hermes is offline");
    }
    chat = { session, snapshot: JSON.stringify(plan), day: 1, since: 0, mine: new Set(), pending: 0, deadline: 0, timer: null, changes: [], ask: true, tieDone: new Set(), tradeOff: {}, cards: {} };
    guidedActive = true; // working copy: no savePlan until Save
    $("chat-log").innerHTML = "";
    $("chat-diff").innerHTML = "";
    $("plan-chat").hidden = false;
    document.body.classList.add("chat-open");
    renderChatDay();
    chat.pending = 1; // the opener reply to the open message
    chat.deadline = Date.now() + CHAT_GIVE_UP_MS;
    setChatWaiting(true);
    chat.timer = setTimeout(pollChat, CHAT_POLL_MS);
  }

  function closeChat() {
    clearTimeout(chat.timer);
    MP.PlanChat.call("POST", "/chat", { session: chat.session, close: true }).catch(() => {});
    $("plan-chat").hidden = true;
    document.body.classList.remove("chat-open");
    $("swap-overlay").classList.add("hidden");
    swapCtx = null;
    guidedActive = false;
    resetChatPrefs();
    history.replaceState(null, "", "plan.html");
  }

  function exitChat() {
    if (!chat) return;
    plan = JSON.parse(chat.snapshot);
    closeChat();
    chat = null;
    renderPlan();
  }

  function saveChat() {
    closeChat();
    chat = null;
    savePlan();
    renderPlan();
    toast("Plan saved");
  }

  function initChat() {
    $("plan-chat-btn").addEventListener("click", openChat);
    $("chat-exit").addEventListener("click", exitChat);
    $("chat-save").addEventListener("click", saveChat);
    $("chat-fallback").addEventListener("click", () => { exitChat(); location.href = "plan-with-me.html"; });
    const step = (n) => { if (chat.cards && chat.cards.tie) chat.tieDone.add(chat.day); chat.day = Math.min(plan.days.length, Math.max(1, chat.day + n)); renderChatDay(); };
    $("chat-prev").addEventListener("click", () => chat && step(-1));
    $("chat-next").addEventListener("click", () => chat && step(1));
    $("chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const text = $("chat-input").value.trim();
      if (!chat || !text) return;
      $("chat-input").value = "";
      sendChat(text);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && chat && $("swap-overlay").classList.contains("hidden")) exitChat();
    });
    if (new URLSearchParams(location.search).get("chat") === "1") openChat();
  }

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
      const n = lockCount();
      if (confirm(n ? `Regenerate the unlocked meals? ${n} locked meal${n === 1 ? " is" : "s are"} kept.` : "Regenerate the 2-week plan? This replaces your current edits.")) {
        regenerate();
        toast("Plan regenerated");
      }
    });
    document.getElementById("unlock-btn").addEventListener("click", unlockAll);
    document.getElementById("useup-btn").addEventListener("click", () => {
      const today = new Date().toLocaleDateString("en-CA");
      const items = MP.ShoppingList.useUpItems(MP.Sync.localItems("pantry"), plan, today, shelfData);
      if (!items.length) { toast("Nothing is expiring"); return; }
      if (!confirm("Build a plan that cooks your soon-to-expire items first? This replaces your current edits.")) return;
      regenerate(false, { useUp: { items, window: (packData && packData.planning.useUpWindow) || 6 } }); // per call, never stored in mp_planPrefs
      toast("Plan built around what's expiring");
    });
    document.getElementById("compare-btn").addEventListener("click", () => { if (!guidedActive) renderCompareSheet(); });
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
    vocabAll = vocab;
    dayHints = await MP.Sync.fetchDayHints();
    await MP.Sync.fetchRatings();
    applyHints((JSON.parse(localStorage.getItem(LS_PLAN) || "null") || {}).startDate);
    const guidedParam = new URLSearchParams(location.search).get("guided") === "1";
    if (guidedParam) {
      guidedActive = true;
      document.getElementById("compare-btn").disabled = true;
      plan = generatePlan();
      startGuidedWalkthrough(parseGuidedSlots(location.search));
    } else {
      plan = loadPlan();
      if (rollIfDue()) applyHints(plan.startDate);
      savePlan();
      renderPlan();
    }
    initHermesBanner();
    MP.Sync.fetchPlanDraft();
    countersData = await fetch("counters.json").then((r) => r.json()).catch(() => countersData);
    renderTodayCard();
    const pullToday = () => MP.Today.pull().then((changed) => { if (changed) { renderTodayCard(); renderGapStrip(); } });
    pullToday();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (rollIfDue()) { applyHints(plan.startDate); renderPlan(); }
      pullToday();
    });

    document.getElementById("guided-commit-btn").addEventListener("click", () => {
      guidedActive = false;
      savePlan();
      history.replaceState(null, "", "plan.html");
      document.getElementById("guided-review-banner").classList.add("hidden");
      toast("Plan saved");
    });
    initChat();
  }

  // Guarded so this file can be included in test.html for pure-function
  // testing (MP.Plan.applyPlacements) without a plan.html DOM to init against.
  if (document.getElementById("plan-root")) init();
})();
