// Planning chat with Hermes (Phase 72): the one validator for Hermes's reply, the edit -> generator-override mapping and the
// "understood" line. Loaded as a browser <script> AND imported into the Worker bundle: no window/document/localStorage at top
// level. Hermes returns constraints and edits, never meals; the app's generator picks meals.
(function (root) {
  "use strict";

  const SLOTS = ["breakfast", "lunch", "dinner", "snack"];
  const TEXT_MAX = 500, EDITS_MAX = 20;
  const isDay = (d) => Number.isInteger(d) && d >= 1 && d <= 28;
  const isSlot = (s) => SLOTS.includes(s);
  const isIso = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
  const isPos = (p) => p && typeof p === "object" && isDay(p.day) && isSlot(p.slot);
  const pos = (p) => ({ day: p.day, slot: p.slot });
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  /** Chip ids a reply may name: plan-preferences.json's `chips[].id` plus `candidates.protein.chip.id`. */
  function chipIds(vocab) {
    const ids = ((vocab && vocab.chips) || []).map((c) => c.id);
    const p = vocab && vocab.candidates && vocab.candidates.protein && vocab.candidates.protein.chip;
    if (p && p.id) ids.push(p.id);
    return ids;
  }

  // One normaliser per edit type; null = invalid (the whole edit is dropped).
  const DAYS = (e) => (e.days === undefined ? [] : Array.isArray(e.days) && e.days.length && e.days.every(isDay) ? [...new Set(e.days)] : null);
  const withDays = (out, e) => { const d = DAYS(e); if (d === null) return null; if (d.length) out.days = d; return out; };
  const NORM = {
    busy: (e) => isDay(e.day) && { type: "busy", day: e.day },
    free: (e) => isDay(e.day) && { type: "free", day: e.day },
    noCook: (e) => isDay(e.day) && { type: "noCook", day: e.day },
    chip: (e, ids) => typeof e.id === "string" && ids.includes(e.id) && withDays({ type: "chip", id: e.id }, e),
    budget: (e) => typeof e.perWeek === "number" && isFinite(e.perWeek) && e.perWeek > 0 && e.perWeek <= 1000 && withDays({ type: "budget", perWeek: e.perWeek }, e),
    lock: (e) => isDay(e.day) && isSlot(e.slot) && { type: "lock", day: e.day, slot: e.slot },
    unlock: (e) => isDay(e.day) && isSlot(e.slot) && { type: "unlock", day: e.day, slot: e.slot },
    // Phase 84: plan actions. The app/Worker apply them through the data.js helpers (MP.applyPlanEdits); no meals chosen here.
    start: (e, ids, today) => isIso(e.date) && (!today || e.date >= today) && (e.firstSlot === undefined || isSlot(e.firstSlot)) && (e.days === undefined || (Number.isInteger(e.days) && isDay(e.days))) && (e.shopDay === undefined || (Number.isInteger(e.shopDay) && e.shopDay >= 0 && e.shopDay <= 6))
      && { type: "start", date: e.date, ...(e.firstSlot ? { firstSlot: e.firstSlot } : {}), ...(e.days ? { days: e.days } : {}), ...(e.shopDay !== undefined ? { shopDay: e.shopDay } : {}) },
    skip: (e) => isDay(e.day) && isSlot(e.slot) && ["push", "move", "drop"].includes(e.how) && (e.how !== "move" || isPos(e.to))
      && { type: "skip", day: e.day, slot: e.slot, how: e.how, ...(e.how === "move" ? { to: pos(e.to) } : {}) },
    out: (e) => isDay(e.day) && isSlot(e.slot) && { type: "out", day: e.day, slot: e.slot, ...(str(e.name, 60) ? { name: str(e.name, 60) } : {}), ...(str(e.text, 200) ? { text: str(e.text, 200) } : {}) },
    swap: (e) => isPos(e.a) && isPos(e.b) && { type: "swap", a: pos(e.a), b: pos(e.b) },
    swapDay: (e) => isDay(e.a) && isDay(e.b) && e.a !== e.b && { type: "swapDay", a: e.a, b: e.b },
    backfill: (e) => isDay(e.day) && isSlot(e.slot) && (typeof e.mealId === "string" && e.mealId ? { type: "backfill", day: e.day, slot: e.slot, mealId: e.mealId } : str(e.name, 60) && { type: "backfill", day: e.day, slot: e.slot, name: str(e.name, 60), ...(str(e.text, 200) ? { text: str(e.text, 200) } : {}) }),
    reroll: (e) => isDay(e.day) && (e.slot === undefined || isSlot(e.slot)) && (e.slot === undefined ? { type: "reroll", day: e.day } : { type: "reroll", day: e.day, slot: e.slot }),
  };

  /** raw reply -> { reply: { text, edits, ask }, dropped }. Unknown types and bad fields are dropped, never repaired. */
  function validateReply(raw, vocab, today) {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const list = Array.isArray(r.edits) ? r.edits : [];
    const ids = chipIds(vocab);
    const edits = [];
    for (const e of list.slice(0, EDITS_MAX)) {
      const f = e && typeof e === "object" && Object.prototype.hasOwnProperty.call(NORM, e.type) ? NORM[e.type](e, ids, today) : null;
      if (f) edits.push(f);
    }
    return {
      reply: { text: typeof r.text === "string" ? r.text.trim().slice(0, TEXT_MAX) : "", edits, ask: r.ask === true },
      dropped: list.length - edits.length,
    };
  }

  const uniq = (a) => [...new Set(a)].sort((x, y) => x - y);
  const without = (a, d) => (a || []).filter((x) => x !== d);

  /**
   * Fold valid edits into the session's chatPrefs (pure; the input is not mutated).
   * chatPrefs = { busyDays, freeDays, chips: { day: [chipId] }, budget: { day: perWeek } }; session-scoped, never stored.
   * days = every day that needs a re-pick (sorted); slotOnly[day] = slot when a reroll names a slot and nothing else touches the day.
   */
  function toOverride(edits, chatPrefs, focusDay) {
    const p = chatPrefs || {};
    const cp = { busyDays: [...(p.busyDays || [])], freeDays: [...(p.freeDays || [])], chips: {}, budget: { ...(p.budget || {}) } };
    Object.keys(p.chips || {}).forEach((d) => { cp.chips[d] = [...p.chips[d]]; });
    const days = new Set(), rerollSlot = {}, locks = [], unlocks = [];
    const hard = new Set(); // days touched by something other than a slot-specific reroll
    for (const e of edits || []) {
      const target = e.days && e.days.length ? e.days : [focusDay];
      if (e.type === "busy" || e.type === "noCook") {
        cp.busyDays = uniq([...cp.busyDays, e.day]); cp.freeDays = without(cp.freeDays, e.day); days.add(e.day); hard.add(e.day);
      } else if (e.type === "free") {
        cp.freeDays = uniq([...cp.freeDays, e.day]); cp.busyDays = without(cp.busyDays, e.day); days.add(e.day); hard.add(e.day);
      } else if (e.type === "chip") {
        target.filter(isDay).forEach((d) => { cp.chips[d] = [...new Set([...(cp.chips[d] || []), e.id])]; days.add(d); hard.add(d); });
      } else if (e.type === "budget") {
        target.filter(isDay).forEach((d) => { cp.budget[d] = e.perWeek; days.add(d); hard.add(d); });
      } else if (e.type === "lock") locks.push({ day: e.day, slot: e.slot });
      else if (e.type === "unlock") unlocks.push({ day: e.day, slot: e.slot });
      else if (e.type === "reroll") {
        days.add(e.day);
        if (e.slot) rerollSlot[e.day] = e.slot; else hard.add(e.day);
      }
    }
    const slotOnly = {};
    Object.keys(rerollSlot).forEach((d) => { if (!hard.has(Number(d))) slotOnly[d] = rerollSlot[d]; });
    return { chatPrefs: cp, days: uniq([...days]), locks, unlocks, slotOnly };
  }

  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function dayName(startDate, day) {
    const d = new Date(`${startDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + day - 1);
    return WEEKDAYS[d.getUTCDay()] + (day > 7 ? " (wk 2)" : "");
  }

  /** The app-written "understood" line, built from the edits that will actually apply. */
  function describe(edits, startDate, focusDay) {
    const parts = [];
    for (const e of edits || []) {
      const name = (d) => dayName(startDate, d);
      const target = (e.days && e.days.length ? e.days : [focusDay || 1]);
      if (e.type === "busy" || e.type === "noCook") parts.push(`${name(e.day)}: quick meals`);
      else if (e.type === "free") parts.push(`${name(e.day)}: room to batch cook`);
      else if (e.type === "chip") target.forEach((d) => parts.push(`${name(d)}: ${e.id.replace(/-/g, " ")}`));
      else if (e.type === "budget") target.forEach((d) => parts.push(`${name(d)}: under £${e.perWeek}/week`));
      else if (e.type === "lock") parts.push(`${name(e.day)}: ${e.slot} kept`);
      else if (e.type === "unlock") parts.push(`${name(e.day)}: ${e.slot} unlocked`);
      else if (e.type === "reroll") parts.push(`${name(e.day)}: ${e.slot ? e.slot + " " : ""}re-picked`);
      else if (e.type === "start") parts.push(`new plan from ${e.date}${e.firstSlot ? `, first meal ${e.firstSlot}` : ""}${e.days ? `, ${e.days} days` : ""}${e.shopDay !== undefined ? `, shop on ${WEEKDAYS[e.shopDay]}` : ""}`);
      else if (e.type === "skip") parts.push(`${name(e.day)} ${e.slot}: ${{ push: "pushed to the next day", move: `moved to ${e.to ? name(e.to.day) + " " + e.to.slot : ""}`, drop: "dropped and re-picked" }[e.how]}`);
      else if (e.type === "out") parts.push(`${name(e.day)} ${e.slot}: eating out${e.name ? ` (${e.name})` : ""}`);
      else if (e.type === "swap") parts.push(`${name(e.a.day)} ${e.a.slot} swapped with ${name(e.b.day)} ${e.b.slot}`);
      else if (e.type === "swapDay") parts.push(`${name(e.a)} swapped with ${name(e.b)}`);
      else if (e.type === "backfill") parts.push(`${name(e.day)} ${e.slot}: recorded as eaten${e.name ? ` (${e.name})` : ""}`);
    }
    return parts.join(", ");
  }

  /** Relay to the Worker with Hermes's token (browser only; runs when called). */
  async function call(method, path, body) {
    const { url, token } = root.MP.Sync.config();
    const res = await fetch(url + path, {
      method,
      headers: { "X-Auth-Token": token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000), // a hung Worker must fail (and fall back), not leave the button silent
    });
    if (!res.ok) { const err = new Error(`${method} ${path} -> ${res.status}`); err.status = res.status; throw err; }
    return res.json();
  }

  root.MP = root.MP || {};
  root.MP.PlanChat = { validateReply, toOverride, describe, chipIds, call };
})(typeof globalThis !== "undefined" ? globalThis : this);
