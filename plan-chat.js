// Planning chat with Hermes (Phase 72): the one validator for Hermes's reply, the edit -> generator-override mapping and the
// "understood" line. Loaded as a browser <script> AND imported into the Worker bundle: no window/document/localStorage at top
// level. Hermes returns constraints and edits; the app's generator picks meals. Phase 87: it may also create, edit and remove library meals
// (mealCreate/mealEdit/mealRemove), applied by the app only after its own hard checks.
(function (root) {
  "use strict";

  const SLOTS = ["breakfast", "lunch", "dinner", "snack"];
  const TEXT_MAX = 1500, EDITS_MAX = 60;
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

  // Phase 87 meal fields. Limits: name <= 60, ingredients <= 20, method steps <= 12, 5 meal edits per reply.
  const NOTE_MAX = 2; // Phase 91: standing-note proposals per reply; applied only by the app's Accept card
  const MEAL_EDITS = ["mealCreate", "mealEdit", "mealRemove"], MEAL_EDITS_MAX = 5, EFFORT = ["quick", "batch"];
  const ingredients = (v) => {
    if (!Array.isArray(v) || !v.length || v.length > 20) return null;
    const out = v.map((i) => i && typeof i === "object" && (str(i.key, 60) || str(i.name, 60)) && { ...(str(i.key, 60) ? { key: str(i.key, 60) } : {}), ...(str(i.name, 60) ? { name: str(i.name, 60) } : {}), qty: str(typeof i.qty === "number" ? String(i.qty) : i.qty, 40) });
    return out.every(Boolean) ? out : null;
  };
  const types = (v) => { const t = Array.isArray(v) ? [...new Set(v.filter((x) => SLOTS.includes(x)))] : []; return t.length ? t : null; };
  const method = (v) => (Array.isArray(v) && v.length <= 12 && v.every((x) => typeof x === "string" && x.trim()) ? v.map((x) => x.trim().slice(0, 300)) : null);
  const mins = (v) => Number.isInteger(v) && v >= 1 && v <= 600;
  const servings = (v) => Number.isInteger(v) && v >= 1 && v <= 12;
  /** Whitelisted patch fields only; any other key is ignored. null = a whitelisted field is invalid. */
  const PATCH = {
    name: (v) => str(v, 60) || null, description: (v) => (typeof v === "string" ? v.trim().slice(0, 300) : null),
    mealTypes: types, servings: (v) => (servings(v) ? v : null), prepEffort: (v) => (EFFORT.includes(v) ? v : null), ingredients, method,
    totalMins: (v) => (mins(v) ? v : null),
  };
  function patchOf(p) {
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    const out = {};
    for (const k of Object.keys(PATCH)) {
      if (!(k in p)) continue;
      const v = PATCH[k](p[k]);
      if (v === null) return null;
      out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  }
  const mealId = (e) => typeof e.mealId === "string" && e.mealId.length > 0 && e.mealId.length <= 80;

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
    mealCreate: (e) => { const ing = ingredients(e.ingredients), t = e.mealTypes === undefined ? ["dinner"] : types(e.mealTypes), m = e.method === undefined ? undefined : method(e.method);
      return str(e.name, 60) && ing && t && m !== null && (e.servings === undefined || servings(e.servings)) && (e.prepEffort === undefined || EFFORT.includes(e.prepEffort)) && (e.totalMins === undefined || mins(e.totalMins))
        && { type: "mealCreate", name: str(e.name, 60), mealTypes: t, ingredients: ing, ...(e.servings ? { servings: e.servings } : {}), ...(e.prepEffort ? { prepEffort: e.prepEffort } : {}), ...(m ? { method: m } : {}), ...(e.totalMins ? { totalMins: e.totalMins } : {}) }; },
    mealEdit: (e) => { const patch = mealId(e) && patchOf(e.patch); return patch && { type: "mealEdit", mealId: e.mealId, patch }; },
    mealRemove: (e) => mealId(e) && { type: "mealRemove", mealId: e.mealId },
    // Phase 88: Hermes places a chosen meal; the app checks it (MP.placeSlots). cap/rate are prefs and rating edits.
    place: (e) => isDay(e.day) && isSlot(e.slot) && mealId(e) && (e.variantId === undefined || str(e.variantId, 80)) && (e.cookId === undefined || str(e.cookId, 120))
      && (e.leftover === undefined || e.leftover === true) && (e.portions === undefined || (e.leftover === true && Number.isInteger(e.portions) && e.portions >= 1 && e.portions <= 12)) && !(e.leftover && e.cookId)
      && { type: "place", day: e.day, slot: e.slot, mealId: e.mealId, ...(e.variantId ? { variantId: str(e.variantId, 80) } : {}), ...(e.cookId ? { cookId: str(e.cookId, 120) } : {}), ...(e.leftover ? { leftover: true, ...(e.portions ? { portions: e.portions } : {}) } : {}) },
    // Phase 90a: a bulk-buy proposal; the app recomputes the numbers and shows a card (Accept writes plan.bulk).
    bulk: (e) => str(e.key, 60) && Number.isInteger(e.shopDay) && e.shopDay >= -6 && e.shopDay <= 28 && { type: "bulk", key: str(e.key, 60), shopDay: e.shopDay },
    // Phase 90b: what the user says is left in the fridge; session-only in the app (chat.stock), never the pantry.
    stock: (e) => { const it = Array.isArray(e.items) && e.items.length >= 1 && e.items.length <= 40 && e.items.map((i) => i && typeof i === "object" && str(i.name, 60) && (i.qty === undefined || typeof i.qty === "string") && { name: str(i.name, 60), ...(str(i.qty, 30) ? { qty: str(i.qty, 30) } : {}) });
      return it && it.every(Boolean) && { type: "stock", items: it }; },
    cap: (e) => Number.isInteger(e.minutes) && (e.minutes === 0 || (e.minutes >= 5 && e.minutes <= 240)) && Array.isArray(e.weekdays) && e.weekdays.length >= 1 && e.weekdays.length <= 7
      && e.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) && new Set(e.weekdays).size === e.weekdays.length
      && { type: "cap", minutes: e.minutes, weekdays: [...e.weekdays].sort((a, b) => a - b) },
    rate: (e) => mealId(e) && (e.rating === "up" || e.rating === "down") && (e.note === undefined || typeof e.note === "string")
      && { type: "rate", mealId: e.mealId, rating: e.rating, ...(str(e.note, 200) ? { note: str(e.note, 200) } : {}) },
    note: (e) => typeof e.text === "string" && e.text.trim() && e.text.trim().length <= 200 && { type: "note", text: e.text.trim() },
    reroll: (e) => isDay(e.day) && (e.slot === undefined || isSlot(e.slot)) && (e.slot === undefined ? { type: "reroll", day: e.day } : { type: "reroll", day: e.day, slot: e.slot }),
  };

  /** raw reply -> { reply: { text, edits, ask }, dropped }. Unknown types and bad fields are dropped, never repaired. */
  function validateReply(raw, vocab, today) {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const list = Array.isArray(r.edits) ? r.edits : [];
    const ids = chipIds(vocab);
    const edits = [];
    let meals = 0, bulks = 0;
    const known = new Set(((vocab && vocab.notes && vocab.notes.items) || []).concat(((vocab && vocab.notes && vocab.notes.pending) || []).map((p) => p.text || p)).map((t) => String(t).toLowerCase()));
    for (const e of list.slice(0, EDITS_MAX)) {
      if (e && MEAL_EDITS.includes(e.type) && ++meals > MEAL_EDITS_MAX) continue;
      if (e && e.type === "bulk" && ++bulks > 5) continue;
      const f0 = e && typeof e === "object" && Object.prototype.hasOwnProperty.call(NORM, e.type) ? NORM[e.type](e, ids, today) : null;
      const f = f0 && f0.type === "note" && (known.has(f0.text.toLowerCase()) || edits.filter((x) => x.type === "note").length >= NOTE_MAX) ? null : f0;
      if (f) { edits.push(f); if (f.type === "note") known.add(f.text.toLowerCase()); }
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
      else if (e.type === "mealCreate") parts.push(`new meal: ${e.name}`);
      else if (e.type === "mealEdit") parts.push(`changed meal ${e.mealId}`);
      else if (e.type === "mealRemove") parts.push(`removed meal ${e.mealId}`);
      else if (e.type === "place") parts.push(`${name(e.day)} ${e.slot}: ${e.mealId} placed${e.cookId ? " from the freezer/fridge" : ""}${e.leftover ? ` (already cooked, ${e.portions || 1} portion${(e.portions || 1) === 1 ? "" : "s"})` : ""}`);
      else if (e.type === "bulk") parts.push(`bulk buy: ${e.key.replace(/-/g, " ")} on shop ${e.shopDay}`);
      else if (e.type === "cap") parts.push(e.minutes ? `${e.weekdays.map((w) => WEEKDAYS[w]).join("/")}: cooking capped at ${e.minutes} min` : `${e.weekdays.map((w) => WEEKDAYS[w]).join("/")}: time cap cleared`);
      else if (e.type === "stock") parts.push(`you have ${e.items.map((i) => i.name).join(", ")}`);
      else if (e.type === "note") parts.push(`suggested note: ${e.text}`);
      else if (e.type === "rate") parts.push(`${e.mealId}: rated ${e.rating}`);
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
