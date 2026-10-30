/* Phase 109: Ask mode of the docked bar. Speaks the plan chat's transport (MP.PlanChat.call, POST/GET /chat) but holds no plan state:
   it applies only the live edit set (PlanChat.BAR_LIVE minus display-only `meals`) through MP.applyPlanEdits / MP.placeSlots / pushRating,
   snapshotted to mp_planUndo first. Never writes the pantry or Cooks. Yields to an open Plan chat. */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const MP = (root.MP = root.MP || {});

  const POLL_MS = 1000, GIVE_UP_MS = 90000, FRESH_MS = 30000, BRIEF_MAX = 60000;
  const SS = "mp_barSession";
  const PLAN_EDITS = ["skip", "out", "swap", "swapDay", "backfill", "sub"];
  const OUT_TIME = { breakfast: "08:00", lunch: "13:00", dinner: "19:00", snack: "16:00" };
  const SLOTS = ["breakfast", "lunch", "dinner", "snack"];
  const today = () => new Date().toLocaleDateString("sv");
  const readPlan = () => { try { return JSON.parse(localStorage.getItem("mp_plan") || "null"); } catch (e) { return null; } };
  const slotIso = (plan, day) => { const d = new Date(`${plan.startDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + day - 1); return d.toISOString().slice(0, 10); };

  let lib = [];
  const loadLib = () => Promise.resolve(MP.getLibrary()).then((l) => { lib = Array.isArray(l) ? l : []; return lib; }, () => lib);
  const byIdOf = (l) => Object.fromEntries(l.map((m) => [m.id, m]));

  /** True while the Plan chat or a guided walkthrough owns the plan: the bar is Log-only then. */
  function busy() {
    return typeof document !== "undefined" && (document.body.classList.contains("chat-open") || /[?&]guided=1/.test(location.search));
  }

  /** Read-only briefing: library (ids, names, slots, ingredient keys), the plan's slots, ratings, hard terms. No cooks/bulk/cheaper/fridge. */
  function brief(c) {
    c = c || {};
    const library = c.library || lib, plan = c.plan !== undefined ? c.plan : readPlan();
    const out = {
      library: library.map((m) => ({ id: m.id, name: m.name, types: m.mealTypes || [], ingredients: (m.ingredients || []).map((i) => i.key) })),
      today: null, startDate: plan && plan.startDate, plan: [],
      ratings: Object.fromEntries(Object.entries(c.ratings || (MP.Ratings ? MP.Ratings.get() : {})).map(([id, r]) => [id, { rating: r.never ? "never" : r.rating, note: r.note || "" }])),
      terms: c.terms || (MP.Sync && MP.Sync.hardTerms ? MP.Sync.hardTerms() : []),
    };
    if (plan && Array.isArray(plan.days)) {
      const name = (s) => (!s ? null : s.eatingOut ? "out" : s.mealId || null);
      out.plan = plan.days.map((d) => ({ day: d.day, slots: Object.fromEntries(SLOTS.map((t) => [t, name(d.slots[t])])) }));
      const day = plan.startDate ? Math.round((Date.parse(c.now || today()) - Date.parse(plan.startDate)) / 86400000) + 1 : 0;
      if (day >= 1 && day <= plan.days.length) out.today = { day, slots: out.plan[day - 1].slots };
    }
    if (JSON.stringify(out).length > BRIEF_MAX) out.library.forEach((m) => { m.ingredients = m.ingredients.slice(0, 6); });
    return out;
  }

  const defaultStore = {
    get: readPlan,
    snapshot: (p) => { try { localStorage.setItem("mp_planUndo", JSON.stringify(p)); } catch (e) { /* quota: no undo */ } },
    set: (p) => {
      localStorage.setItem("mp_plan", JSON.stringify(p));
      window.dispatchEvent(new CustomEvent("mp:plan-saved", { detail: p })); // pushes the mirror (hermes-sync.js)
      window.dispatchEvent(new CustomEvent("mp:plan-live", { detail: p }));  // pages redraw from this one
    },
  };

  /** Apply a validated reply's live edits. ctx (tests): { store, byId, now, terms, ratingsApi, log }.
   *  Returns { applied: [{type, summary}], refused: [string], undo(), other: bool, meals: [meal] }. Pure of the pantry and Cooks. */
  function applyLive(reply, ctx) {
    const c = ctx || {}, store = c.store || defaultStore, now = c.now || today();
    const byId = c.byId || byIdOf(lib), terms = c.terms || (MP.Sync && MP.Sync.hardTerms ? MP.Sync.hardTerms() : []);
    const raw = (reply && Array.isArray(reply.edits) ? reply.edits : []).filter((e) => e && typeof e.type === "string");
    const { reply: v } = MP.PlanChat.validateReply({ text: reply && reply.text, edits: raw }, {}, now);
    const live = MP.PlanChat.BAR_LIVE;
    const isOther = (e) => !live.includes(e.type) || (e.type === "place" && (e.cookId || e.leftover || e.freezeFrom !== undefined));
    const edits = v.edits.filter((e) => !isOther(e));
    const res = { applied: [], refused: [], undo: () => null, other: raw.some((e) => !live.includes(e.type)) || v.edits.some(isOther), meals: [] };
    res.meals = [...new Set(edits.filter((e) => e.type === "meals").flatMap((e) => e.ids))].filter((id) => byId[id]).slice(0, 6).map((id) => byId[id]);
    const acts = edits.filter((e) => PLAN_EDITS.includes(e.type)), places = edits.filter((e) => e.type === "place"), rates = edits.filter((e) => e.type === "rate");
    const before = c.plan || store.get();
    const logUndo = [];
    let plan = before;
    if ((acts.length || places.length) && !plan) res.refused.push("There is no plan to change yet");
    else if (acts.length || places.length) {
      const fromDay = MP.reflowFromDay(plan.startDate, now), summary = (e) => MP.PlanChat.describe([e], plan.startDate, 1);
      // ponytail: no generator on non-plan pages, so a freed slot (skip/drop, out) is left open for a `place`, not auto re-picked
      const gen = () => ({ days: plan.days.map(() => ({ slots: {} })) });
      if (acts.length) {
        const r = MP.applyPlanEdits(plan, acts, byId, fromDay, gen, now, { terms, pending: [] });
        plan = r.plan;
        r.ignored.forEach((i) => res.refused.push(`Day ${i.day} ${i.slot}: ${i.reason}`));
        const changed = new Set(r.changes.map((x) => x.day + ":" + x.slot));
        acts.forEach((e) => { if (e.type === "swapDay" || e.type === "swap" || changed.has(e.day + ":" + e.slot)) res.applied.push({ type: e.type, summary: summary(e) }); });
        for (const b of r.backfilled) { // log only, never commitCook / the pantry
          const slot = plan.days[b.day - 1].slots[b.slot], whenIso = new Date(`${slotIso(plan, b.day)}T${OUT_TIME[b.slot]}:00`).toISOString();
          if (b.replaced && b.replaced.eatenAt && b.replaced.mealId && !c.noLog) MP.Sync.unlogEaten(`${b.replaced.mealId}:${b.replaced.eatenAt}`);
          if (b.entry.eatingOut) {
            const id = (c.uuid || (() => crypto.randomUUID()))();
            plan = { ...plan, days: plan.days.map((d) => (d.day === b.day ? { ...d, slots: { ...d.slots, [b.slot]: { ...slot, foodLogId: id } } } : d)) };
            if (!c.noLog) MP.Sync.postFoodLog({ id, action: "eat", text: (b.entry.text || b.entry.name || "").slice(0, 120), when: whenIso });
            logUndo.push({ foodLog: id });
          } else if (byId[b.entry.mealId]) {
            if (!c.noLog) MP.Sync.logPortion(byId[b.entry.mealId], slot.eatenAt || whenIso);
            logUndo.push({ eaten: `${b.entry.mealId}:${slot.eatenAt || whenIso}` });
          }
        }
      }
      if (places.length) {
        const early = places.filter((p) => p.day < fromDay);
        early.forEach((p) => res.refused.push(`Day ${p.day} ${p.slot}: that day has passed`));
        const ok = places.filter((p) => p.day >= fromDay).map((p) => ({ day: p.day, slot: p.slot, mealId: p.mealId, ...(p.variantId ? { variantId: p.variantId } : {}) }));
        const r = MP.placeSlots(plan, ok, byId, { terms, ratings: c.ratings || (MP.Ratings ? MP.Ratings.get() : {}), caps: {}, pending: [], cooks: [] });
        plan = r.plan;
        r.refused.forEach((x) => res.refused.push(`Day ${x.day} ${x.slot}: ${x.why}`));
        const done = new Set(r.changes.map((x) => x.day + ":" + x.slot));
        places.forEach((p) => { if (done.has(p.day + ":" + p.slot)) res.applied.push({ type: "place", summary: `${p.day ? "Day " + p.day : ""} ${p.slot}: ${byId[p.mealId] ? byId[p.mealId].name : p.mealId} placed` }); });
        r.notes.forEach((n) => res.applied.push({ type: "note", summary: n }));
      }
      if (plan !== before && JSON.stringify(plan) !== JSON.stringify(before)) { // snapshot first, then write
        store.snapshot(before);
        store.set(plan);
      } else plan = before;
    }
    const undoRates = [];
    const rapi = c.ratingsApi || { get: () => (MP.Ratings ? MP.Ratings.get() : {}), set: (id, p) => MP.Ratings.set(id, p), push: (id, p, r) => MP.Sync.pushRating(id, p, r) };
    for (const e of rates) {
      const m = byId[e.mealId];
      if (!m) { res.refused.push(`Unknown meal ${e.mealId}`); continue; }
      const prev = rapi.get()[m.id] || {}, patch = { rating: e.rating, ...(e.note ? { note: e.note } : {}) };
      rapi.set(m.id, patch);
      rapi.push(m.id, patch, "rated in the bar");
      undoRates.push(() => { const back = { rating: prev.rating || null, note: prev.note || "" }; rapi.set(m.id, back); rapi.push(m.id, back, "undo in the bar"); });
      res.applied.push({ type: "rate", summary: `Rated ${m.name} ${e.rating === "up" ? "up" : "down"}${e.note ? ` (${e.note})` : ""}` });
    }
    res.undo = () => {
      if (plan !== before) {
        store.set(before);
        logUndo.forEach((u) => { if (c.noLog) return; if (u.eaten) MP.Sync.unlogEaten(u.eaten); else MP.Sync.removeFoodEntry(u.foodLog); });
      }
      undoRates.forEach((f) => f());
      return before;
    };
    return res;
  }

  // ---- transport ----
  const call = (m, p, b) => MP.PlanChat.call(m, p, b);
  const getSS = () => { try { return JSON.parse(sessionStorage.getItem(SS) || "null"); } catch (e) { return null; } };
  const setSS = (v) => { try { v ? sessionStorage.setItem(SS, JSON.stringify(v)) : sessionStorage.removeItem(SS); } catch (e) { /* cosmetic */ } };

  async function openSession() {
    const l = await loadLib();
    const session = "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let r;
    try { r = await call("POST", "/chat", { session, open: true, context: { mode: "bar", brief: brief({ library: l }) } }); } catch (e) { throw new Error("Couldn't reach Hermes"); }
    if (!r.bridgeSeenAt || Date.now() - Date.parse(r.bridgeSeenAt) > FRESH_MS) {
      call("POST", "/chat", { session, close: true }).catch(() => {});
      throw new Error("Hermes isn't answering (start tools/hermes_chat_bridge.py)");
    }
    const s = { session, since: 0, waiting: null };
    setSS(s);
    return s;
  }

  /** Poll until the reply to message `s.waiting` arrives; applies it and resolves { text, ...applyLive }. */
  async function poll(s) {
    const deadline = Date.now() + GIVE_UP_MS;
    while (Date.now() < deadline) {
      let r;
      try { r = await call("GET", `/chat?session=${encodeURIComponent(s.session)}&since=${s.since}`); } catch (e) {
        if (e.status === 409) { setSS(null); throw new Error("That chat was replaced; ask again"); }
        await new Promise((ok) => setTimeout(ok, POLL_MS));
        continue;
      }
      for (const m of r.messages) {
        s.since = Math.max(s.since, m.id);
        if (m.from === "hermes" && m.replyTo === s.waiting) {
          s.waiting = null; setSS(s);
          await loadLib();
          return { text: m.text || "", ...applyLive({ text: m.text, edits: m.edits }) };
        }
      }
      setSS(s);
      await new Promise((ok) => setTimeout(ok, POLL_MS));
    }
    s.waiting = null; setSS(s);
    throw new Error("Hermes took too long; try again");
  }

  /** Send one message; resolves with the applied reply or throws an Error with a user-facing message. */
  async function send(text) {
    text = String(text || "").trim();
    if (!text) throw new Error("Type a question first");
    if (text.length > 1000) throw new Error("Keep it under 1000 characters");
    if (busy()) throw new Error("Finish planning first");
    if (!MP.Sync.config().enabled) throw new Error("Turn on Hermes sync to ask");
    let s = getSS() || (await openSession());
    const post = (sess) => call("POST", "/chat", { session: sess.session, text, context: { mode: "bar" } });
    let r;
    try { r = await post(s); } catch (e) {
      if (e.status !== 409) throw new Error("Couldn't reach Hermes");
      s = await openSession(); // another chat replaced ours: open a fresh one
      try { r = await post(s); } catch (e2) { throw new Error("Couldn't reach Hermes"); }
    }
    s.waiting = r.id; setSS(s);
    return poll(s);
  }

  /** After a page change: keep waiting for a reply that was already asked for. Null when nothing is pending. */
  function resume() {
    const s = getSS();
    return s && s.waiting ? poll(s) : null;
  }

  MP.BarChat = { brief, send, resume, applyLive, busy, loadLib };
  if (typeof document !== "undefined") loadLib();
})();
