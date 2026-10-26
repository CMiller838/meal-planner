// Hermes bridge client: last-write-wins library sync + planFlag polling.
// Pure functions (decide, needsPlan) are tested in test.html. Loading this
// file has zero effect until start() is called by a page controller.
window.MP = window.MP || {};

(function () {
  "use strict";

  const LS_URL = "mp_hermes_url";
  const LS_TOKEN = "mp_hermes_token";
  const LS_PLAN_ACKED = "mp_hermes_plan_acked";
  const LS_OPS = "mp_sync_ops";
  const LS_PLACEMENTS_ACKED = "mp_hermes_placements_acked";
  const LS_EATEN_LOG = "mp_eatenLog";
  const LS_EAT_ACKED = "mp_eat_requests_acked";
  const SLOT_TYPES = ["breakfast", "lunch", "dinner", "snack"];

  function finite(n) {
    return Number.isFinite(n) ? n : null;
  }

  /** Last-write-wins decision for the library. */
  function decide(localStamp, remote) {
    const l = finite(Date.parse(localStamp)) ?? 0;
    const r = finite(Date.parse(remote && remote.updatedAt)) ?? -1;
    if (r > l) return "pull";
    if (l > r) return "push";
    return "noop";
  }

  /** Is there an outstanding "generate a new plan" request? */
  function needsPlan(flag, localAckedAt) {
    if (!flag || !flag.requestedAt) return false;
    const requested = Date.parse(flag.requestedAt);
    const acked = Math.max(
      finite(Date.parse(flag.ackedAt)) ?? -Infinity,
      finite(Date.parse(localAckedAt)) ?? -Infinity
    );
    return requested > acked;
  }

  function config() {
    const url = localStorage.getItem(LS_URL) || "";
    const token = localStorage.getItem(LS_TOKEN) || "";
    return { url, token, enabled: !!(url && token) };
  }

  function saveConfig(url, token) {
    localStorage.setItem(LS_URL, (url || "").trim().replace(/\/$/, ""));
    localStorage.setItem(LS_TOKEN, (token || "").trim());
  }

  async function req(method, path, body, extra) {
    const { url, token } = config();
    const res = await fetch(url + path, {
      method,
      headers: { "X-Auth-Token": token, "Content-Type": "application/json", ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    if (res.status === 204) return null;
    return res.json();
  }

  let inflight = false;
  let libraryReason = null; // Phase 87: set by a chat meal change, so the next library PUT is logged as Hermes's (undoable via activity)

  /** The next PUT /library carries X-Actor: hermes and this reason (Phase 87). */
  function noteLibraryChange(reason) { libraryReason = String(reason || "meal change").slice(0, 120); }

  /** GET /library, decide, then apply. The re-read of libraryStamp() after
   *  the await is the whole race fix: a local edit made while the GET was
   *  in flight flips the decision from pull to push and survives. */
  async function syncLibrary() {
    if (!config().enabled) return "off";
    if (inflight) return "off";
    inflight = true;
    try {
      const remote = await req("GET", "/library");
      const localStamp = MP.libraryStamp();
      let decision = decide(localStamp, remote);
      // A remote blob without a meals array is not a legitimate pull target
      // (an empty array is) — never wipe the local library on bad data.
      if (decision === "pull" && !Array.isArray(remote.meals)) decision = "noop";
      if (decision === "pull") {
        MP.applyRemoteLibrary(remote.meals, remote.updatedAt);
        window.dispatchEvent(new Event("mp:library-pulled"));
      } else if (decision === "push") {
        const updatedAt = localStamp || new Date().toISOString();
        const why = libraryReason;
        await req("PUT", "/library", { updatedAt, meals: JSON.parse(localStorage.getItem("mp_library") || "[]") }, why ? { "X-Actor": "hermes", "X-Reason": why } : undefined);
        if (why === libraryReason) libraryReason = null;
        if (!localStamp) localStorage.setItem("mp_library_updated_at", updatedAt);
      }
      return decision;
    } catch (e) {
      return "error";
    } finally {
      inflight = false;
    }
  }

  async function syncPlanFlag() {
    try {
      return await req("GET", "/planFlag");
    } catch (e) {
      return null;
    }
  }

  async function ackPlanFlag(requestedAt) {
    const ackedAt = new Date().toISOString();
    await req("PUT", "/planFlag", { requestedAt, ackedAt });
    localStorage.setItem(LS_PLAN_ACKED, ackedAt);
  }

  function mirrorKey(list) {
    return `mp_${list}`;
  }

  function itemsMirror(list) {
    try {
      return JSON.parse(localStorage.getItem(mirrorKey(list)) || "null");
    } catch (e) {
      return null;
    }
  }

  /** GET /{list} (list: "pantry" | "adhoc"), mirrored locally. Never throws —
   * disabled config or a bad response falls back to the mirror. */
  async function fetchItems(list) {
    if (!config().enabled) return itemsMirror(list);
    try {
      const body = await req("GET", `/${list}`);
      if (body && Array.isArray(body.items)) {
        localStorage.setItem(mirrorKey(list), JSON.stringify(body));
        return body;
      }
      return itemsMirror(list);
    } catch (e) {
      return itemsMirror(list);
    }
  }

  function fetchPantry() {
    return fetchItems("pantry");
  }

  /** Synchronous local read — the mirror's items, [] on missing/malformed. */
  function localItems(list) {
    const mirror = itemsMirror(list);
    return mirror && Array.isArray(mirror.items) ? mirror.items : [];
  }

  function writeLocalItems(list, items) {
    localStorage.setItem(mirrorKey(list), JSON.stringify({ updatedAt: new Date().toISOString(), items }));
  }

  function loadOps() {
    try {
      const ops = JSON.parse(localStorage.getItem(LS_OPS) || "[]");
      return Array.isArray(ops) ? ops : [];
    } catch (e) {
      return [];
    }
  }

  function saveOps(ops) {
    localStorage.setItem(LS_OPS, JSON.stringify(ops));
  }

  function queueOp(op) {
    saveOps([...loadOps(), op]);
  }

  /** PURE: applies a pending-op log to a freshly fetched items array. Never
   * mutates its inputs, never throws on a malformed op (skips it). */
  function applyOps(items, ops) {
    let result = items.map((item) => ({ ...item }));
    for (const op of ops) {
      if (!op || typeof op.name !== "string") continue;
      const key = MP.ShoppingList.normalizeKey(op.name);
      const idx = result.findIndex((item) => MP.ShoppingList.normalizeKey(item.name) === key);

      if (op.type === "sub") {
        if (idx === -1) continue;
        const have = MP.ShoppingList.parseQty(result[idx].qty);
        const used = MP.ShoppingList.parseQty(op.qty);
        if (!have || !used || have.unit !== used.unit) continue;
        result[idx] = { ...result[idx], qty: MP.ShoppingList.remainingQty(have, used) };
      } else if (op.type === "add") {
        if (idx === -1) {
          const item = { name: op.name };
          if (op.qty) item.qty = op.qty;
          result.push(item);
        } else {
          const { useBy, out, storage } = result[idx];
          const zero = op.qty && (MP.ShoppingList.parseQty(op.qty) || {}).value === 0;
          result[idx] = op.qty ? { ...result[idx], qty: op.qty } : { name: result[idx].name };
          if (storage) result[idx].storage = storage;
          if (!op.qty && useBy) result[idx].useBy = useBy;
          if (zero && out) result[idx].out = true; else delete result[idx].out; // bought / qty > 0 clears out
        }
      } else if (op.type === "out") {
        // never-stocked item: ignored. Qty dropped so it can't go negative.
        if (idx === -1) continue;
        const { qty: _q, ...rest } = result[idx];
        result[idx] = { ...rest, out: true };
      } else if (op.type === "useBy") {
        if (idx === -1) continue;
        const { useBy: _drop, ...rest } = result[idx];
        result[idx] = MP.ShelfLife.isIsoDate(op.useBy) ? { ...rest, useBy: op.useBy } : rest;
      } else if (op.type === "storage") {
        if (idx === -1) continue;
        const { storage: _drop, ...rest } = result[idx];
        result[idx] = MP.ShelfLife.STORAGES.includes(op.storage) ? { ...rest, storage: op.storage } : rest;
      } else if (op.type === "remove") {
        if (idx !== -1) result.splice(idx, 1);
      }
    }
    return result;
  }

  // ponytail: at-least-once, not exactly-once — a PUT that succeeds but whose
  // response is lost will replay its `sub` and double-deduct on the next
  // flush. Single user, low frequency; cost is retyping one pantry quantity.
  // Add op ids + server-side dedupe only if that ever actually bites.
  async function flushOps() {
    if (!config().enabled) return "off";
    const ops = loadOps();
    if (!ops.length) return "noop";
    const lists = [...new Set(ops.map((op) => op.list))];
    try {
      let remaining = ops;
      for (const list of lists) {
        const opsForList = ops.filter((op) => op.list === list);
        const remote = await req("GET", `/${list}`);
        const result = applyOps(remote && Array.isArray(remote.items) ? remote.items : [], opsForList);
        await req("PUT", `/${list}`, { items: result });
        writeLocalItems(list, result);
        remaining = remaining.filter((op) => op.list !== list);
      }
      saveOps(remaining);
      return "ok";
    } catch (e) {
      return "error";
    }
  }

  // ---- Shopping lines (Phase 55): server mirror + pending writes, merged per line by MP.ShoppingList.mergeLines ----
  const LS_LINES = "mp_shopping";
  const LS_LINES_PENDING = "mp_shopping_pending";

  function readJson(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "null");
      return v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  const linesMirror = () => { const m = readJson(LS_LINES, null); return m && Array.isArray(m.lines) ? m.lines : []; };
  const linesPending = () => { const p = readJson(LS_LINES_PENDING, {}); return p && typeof p === "object" && !Array.isArray(p) ? p : {}; };

  /** Sync read: the mirror with pending writes applied. */
  function shoppingLines() {
    return MP.ShoppingList.mergeLines(linesMirror(), Object.values(linesPending()), new Date().toISOString()).lines;
  }

  /** Stamps `partial` (id + fields to change) now, queues it and mirrors it; the flush is fire-and-forget. */
  function setLine(partial) {
    const prev = shoppingLines().find((l) => l.id === partial.id);
    let at = Date.now();
    if (prev && at <= Date.parse(prev.updatedAt)) at = Date.parse(prev.updatedAt) + 1; // must beat the line it replaces
    const line = { ...prev, ...partial, updatedAt: new Date(at).toISOString() };
    localStorage.setItem(LS_LINES_PENDING, JSON.stringify({ ...linesPending(), [line.id]: line }));
    flushShoppingLines();
    return line;
  }

  /** GET /shopping/lines into the mirror. Never throws; off or failing falls back to the local view. */
  async function fetchShoppingLines() {
    if (config().enabled) {
      try {
        const body = await req("GET", "/shopping/lines");
        if (body && Array.isArray(body.lines)) localStorage.setItem(LS_LINES, JSON.stringify(body));
      } catch (e) { /* keep the mirror */ }
    }
    return shoppingLines();
  }

  // ponytail: one POST of at most 100 pending lines per flush; the next trigger (start, resume, setLine) sends the rest.
  async function flushShoppingLines() {
    if (!config().enabled) return "off";
    const sent = Object.values(linesPending()).slice(0, 100);
    if (!sent.length) return "noop";
    try {
      const body = await req("POST", "/shopping/lines", { lines: sent });
      if (body && Array.isArray(body.lines)) localStorage.setItem(LS_LINES, JSON.stringify(body));
      const pending = linesPending();
      sent.forEach((l) => { if (pending[l.id] && pending[l.id].updatedAt === l.updatedAt) delete pending[l.id]; });
      localStorage.setItem(LS_LINES_PENDING, JSON.stringify(pending));
      return "ok";
    } catch (e) {
      return "error";
    }
  }

  /** Pure: slims a plan to the KV mirror shape — mealId + eatenAt per filled
   *  slot, empty slots omitted. No recipe/name data ever leaves the device. */
  function planMirror(plan) {
    if (!plan || !Array.isArray(plan.days)) return { startDate: null, days: [] };
    const days = plan.days.map((d) => {
      const slots = {};
      for (const slotType of SLOT_TYPES) {
        const slot = d && d.slots && d.slots[slotType];
        if (slot && slot.eatingOut) {
          slots[slotType] = { eatingOut: true };
          for (const k of ["name", "text", "foodLogId"]) if (slot[k]) slots[slotType][k] = slot[k];
        }
        else if (slot && slot.mealId) {
          slots[slotType] = { mealId: slot.mealId, eatenAt: slot.eatenAt || null };
          if (slot.variantId) slots[slotType].variantId = slot.variantId;
          if (Number.isInteger(slot.frozenFrom)) slots[slotType].frozenFrom = slot.frozenFrom;
          if (typeof slot.fromCook === "string" && slot.fromCook) slots[slotType].fromCook = slot.fromCook;
          if (slot.subs && slot.subs.length) slots[slotType].subs = slot.subs;
          if (slot.locked) slots[slotType].locked = true;
        }
      }
      return { day: d.day, slots };
    });
    return { startDate: plan.startDate || null, ...(plan.shopAnchor ? { shopAnchor: plan.shopAnchor } : {}), ...(plan.firstSlot ? { firstSlot: plan.firstSlot } : {}), ...(Array.isArray(plan.bulk) && plan.bulk.length ? { bulk: plan.bulk.map((b) => ({ key: b.key, shopDay: b.shopDay })) } : {}), days };
  }

  /** Best-effort, failure-silent — the plan mirror is derived data. */
  async function pushPlan(plan) {
    if (!config().enabled) return "off";
    try {
      await req("PUT", "/plan", { updatedAt: new Date().toISOString(), ...planMirror(plan) });
      return "ok";
    } catch (e) {
      return "error";
    }
  }

  /** Best-effort, failure-silent — clears the dirty flag only on success so a
   *  failed push retries at the next visibilitychange. */
  async function pushPrefs() {
    if (!config().enabled) return "off";
    if (!MP.Prefs || !MP.Prefs.isDirty()) return "noop";
    try {
      await req("PUT", "/prefs", { updatedAt: new Date().toISOString(), prefs: MP.Prefs.get() });
      MP.Prefs.clearDirty();
      return "ok";
    } catch (e) {
      return "error";
    }
  }

  /** Raw updatedAt out of mp_planPrefs, or "" — MP.PlanPrefs.get() drops it. */
  function localPlanPrefsStamp() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MP.PlanPrefs.KEY) || "null");
      return parsed && typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
    } catch (e) {
      return "";
    }
  }

  /** GET /planPrefs, decide() against the local stamp, pull if remote is newer.
   *  Failure-silent. Returns the prefs the caller should render. */
  async function fetchPlanPrefs() {
    if (!config().enabled) return MP.PlanPrefs.get();
    let remote;
    try {
      remote = await req("GET", "/planPrefs");
    } catch (e) {
      return MP.PlanPrefs.get();
    }
    if (!remote || typeof remote !== "object" || Array.isArray(remote)) return MP.PlanPrefs.get();
    const decision = decide(localPlanPrefsStamp(), remote);
    if (decision === "pull") return MP.PlanPrefs.save(remote.busyDays, remote.chips, remote.budgetTarget, remote.freezeBatches, remote.repeatGap, remote.rolling, remote.timeCaps);
    if (decision === "push") pushPlanPrefs();
    return MP.PlanPrefs.get();
  }

  /** GET /ratings and merge per meal by newest `at` (Phase 51). Failure-silent: the local map either way. */
  async function fetchRatings() {
    if (!config().enabled) return MP.Ratings.get();
    try {
      const remote = await req("GET", "/ratings");
      if (remote && remote.meals) MP.Ratings.merge(remote.meals);
    } catch (e) {}
    return MP.Ratings.get();
  }

  /** GET /food-log (Phase 80b) mirrored to mp_foodLog, read-only. Failure-silent: keeps the last mirror. */
  async function fetchFoodLog() {
    if (!config().enabled) return "off";
    try {
      const remote = await req("GET", "/food-log");
      if (remote && Array.isArray(remote.entries)) localStorage.setItem("mp_foodLog", JSON.stringify({ entries: remote.entries }));
    } catch (e) {}
    return "ok";
  }

  /** POST /food-log (Phase 81): log one eaten thing, then refresh the mirror. Never throws; "off"/"error"/"ok". */
  async function postFoodLog(entry) {
    if (!config().enabled) return "off";
    try { await req("POST", "/food-log", { entries: [entry] }); await fetchFoodLog(); return "ok"; } catch (e) { return "error"; }
  }

  /** Phase 85: POST /food-log remove of one entry or a whole meal group, then refresh the mirror. Never touches the pantry. "ok"/"off"/"error". */
  async function removeFoodEntry(target) {
    if (!config().enabled) return "off";
    try { await req("POST", "/food-log", { entries: [{ id: "rm-" + Date.now().toString(36), action: "remove", target }] }); await fetchFoodLog(); return "ok"; } catch (e) { return "error"; }
  }

  /** Phase 85: entries -> [{ key, meal|null, entries }] in first-seen order; entries sharing a `group` become one row. */
  function groupFoodLog(entries) {
    const out = [], byGroup = {};
    for (const e of entries) {
      if (!e.group) { out.push({ key: e.id, meal: null, entries: [e] }); continue; }
      if (!byGroup[e.group]) { byGroup[e.group] = { key: e.group, meal: e.meal || e.group, entries: [] }; out.push(byGroup[e.group]); }
      byGroup[e.group].entries.push(e);
    }
    return out;
  }

  /** Mirrored food-log entries; [] on a missing or malformed mirror. */
  function localFoodLog() {
    try {
      const e = JSON.parse(localStorage.getItem("mp_foodLog")).entries;
      return Array.isArray(e) ? e.filter((x) => x && typeof x === "object") : [];
    } catch (err) { return []; }
  }

  /** Profile.md settings (Phase 52), mirrored to mp_settings. null when absent or corrupt. */
  function settings() {
    try {
      const s = JSON.parse(localStorage.getItem("mp_settings"));
      return s && typeof s === "object" && !Array.isArray(s) && s.updatedAt ? s : null;
    } catch (e) { return null; }
  }

  /** Allergies + never terms: hard-filtered from Discover, the add-meal check and the planner. */
  function hardTerms() {
    const s = settings();
    return s ? [...new Set((s.allergies || []).concat(s.never || []))] : [];
  }

  /** GET /settings and cache it. Failure-silent: keeps the last cache. */
  async function fetchSettings() {
    if (!config().enabled) return settings();
    try {
      const remote = await req("GET", "/settings");
      if (remote && remote.updatedAt) localStorage.setItem("mp_settings", JSON.stringify(remote));
      else if (remote && !Object.keys(remote).length) localStorage.removeItem("mp_settings");
    } catch (e) {}
    return settings();
  }

  /** GET /drafts (Phase 50), mirrored to mp_drafts. Never throws; { drafts: [] } when sync is off or fails. */
  async function fetchDrafts() {
    if (!config().enabled) return { drafts: [] };
    try {
      const remote = await req("GET", "/drafts");
      const out = { drafts: remote && Array.isArray(remote.drafts) ? remote.drafts : [] };
      localStorage.setItem("mp_drafts", JSON.stringify(out));
      return out;
    } catch (e) {
      return { drafts: [] };
    }
  }

  /** DELETE /drafts/:id. 404 = already gone = success. Never throws; true when the draft is gone. */
  async function deleteDraft(id) {
    if (!config().enabled) return false;
    try {
      await req("DELETE", "/drafts/" + encodeURIComponent(id));
      return true;
    } catch (e) {
      return /-> 404$/.test(e.message);
    }
  }

  /** Best-effort PUT /meal/:id/rating; the server's stamped record is merged back. Never throws. */
  async function pushRating(id, patch, reason) {
    if (!config().enabled) return "off";
    try {
      const rec = await req("PUT", "/meal/" + encodeURIComponent(id) + "/rating", patch, reason ? { "X-Actor": "hermes", "X-Reason": reason } : undefined);
      MP.Ratings.merge({ [id]: rec });
      return "ok";
    } catch (e) {
      return "error";
    }
  }

  /** GET /dayHints (assistant-written, read-only here). Failure-silent: null. */
  async function fetchDayHints() {
    if (!config().enabled) return null;
    try {
      return await req("GET", "/dayHints");
    } catch (e) {
      return null;
    }
  }

  /** GET /planDraft (Phase 49): a pending assistant-proposed week. Fires mp:plandraft; null when none/malformed/off. */
  async function fetchPlanDraft() {
    if (!config().enabled) return null;
    try {
      const d = await req("GET", "/planDraft");
      if (!d || !d.pending || typeof d.id !== "string" || !Array.isArray(d.changes) || !d.changes.length) return null;
      window.dispatchEvent(new CustomEvent("mp:plandraft", { detail: d }));
      return d;
    } catch (e) {
      return null;
    }
  }

  /** Apply and Dismiss both ack, so the draft stops showing; the Worker keeps the record. */
  async function ackPlanDraft(draft) {
    try {
      await req("PUT", "/planDraft", { ...draft, pending: false, ackedId: draft.id });
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Best-effort PUT of the local mp_planPrefs. Never throws. */
  async function pushPlanPrefs() {
    if (!config().enabled) return "off";
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem(MP.PlanPrefs.KEY) || "null");
    } catch (e) {
      return "noop";
    }
    if (!stored) return "noop";
    try {
      await req("PUT", "/planPrefs", stored);
      return "ok";
    } catch (e) {
      return "error";
    }
  }

  /** Pure: placements from `remote` requested after `ackedAt`, ascending. */
  function newPlacements(remote, ackedAt) {
    return newSince(remote && remote.placements, ackedAt);
  }

  /** Pure: queue entries requested after `ackedAt`, ascending. */
  function newSince(list, ackedAt) {
    if (!Array.isArray(list)) return [];
    const acked = finite(Date.parse(ackedAt)) ?? -Infinity;
    return list
      .filter((p) => p && p.requestedAt && (finite(Date.parse(p.requestedAt)) ?? -Infinity) > acked)
      .sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt));
  }

  async function ackPlacements(requestedAt) {
    localStorage.setItem(LS_PLACEMENTS_ACKED, requestedAt);
  }

  /** GET /placements, apply any new ones to the local plan, ack, and tell the
   *  page controller what happened. Never throws into the caller. */
  async function syncPlacements() {
    if (!config().enabled) return "off";
    try {
      const remote = await req("GET", "/placements");
      const pending = newPlacements(remote, localStorage.getItem(LS_PLACEMENTS_ACKED));
      if (!pending.length) return "noop";
      const plan = JSON.parse(localStorage.getItem("mp_plan") || "null");
      const library = JSON.parse(localStorage.getItem("mp_library") || "[]");
      if (!plan) return "noop";
      const { plan: newPlan, applied, rejected } = MP.Plan.applyPlacements(plan, pending, library);
      localStorage.setItem("mp_plan", JSON.stringify(newPlan));
      // Ack only after the apply above has completed and been written.
      const latest = pending[pending.length - 1].requestedAt;
      await ackPlacements(latest);
      window.dispatchEvent(new CustomEvent("mp:placements-applied", { detail: { applied, rejected } }));
      return "applied";
    } catch (e) {
      return "error";
    }
  }

  /** GET /eat-requests (the assistant's "I ate X" queue), apply new ones
   *  through MP.Plan (plan page only — elsewhere they wait), then ack by
   *  requestedAt like placements. Never throws into the caller. */
  async function syncEatRequests() {
    if (!config().enabled || !MP.Plan || !MP.Plan.applyEatRequests) return "off";
    try {
      const remote = await req("GET", "/eat-requests");
      const pending = newSince(remote && remote.requests, localStorage.getItem(LS_EAT_ACKED));
      if (!pending.length) return "noop";
      const result = await MP.Plan.applyEatRequests(pending);
      if (!result) return "off";
      localStorage.setItem(LS_EAT_ACKED, pending[pending.length - 1].requestedAt);
      window.dispatchEvent(new CustomEvent("mp:eat-requests-applied", { detail: result }));
      return "applied";
    } catch (e) {
      return "error";
    }
  }

  /** [] on a missing or corrupt local log — a broken log must never break eating. */
  function localEatenLog() {
    try {
      const log = JSON.parse(localStorage.getItem(LS_EATEN_LOG) || "[]");
      return Array.isArray(log) ? log : [];
    } catch (e) {
      return [];
    }
  }

  /** Best-effort, failure-silent — the log is write-only from the app (D1/D9). */
  async function pushEatenLog(entries) {
    if (!config().enabled) return "off";
    try {
      await req("PUT", "/eaten-log", entries);
      return "ok";
    } catch (e) {
      return "error";
    }
  }

  /** Append + dedup by id (D6), cap to 200 dropping oldest (D4), persist
   *  locally first, then fire-and-forget the push. */
  function logEaten(entry) {
    const log = localEatenLog();
    if (log.some((e) => e.id === entry.id)) return log;
    const capped = [...log, entry].slice(-200);
    try {
      localStorage.setItem(LS_EATEN_LOG, JSON.stringify(capped));
    } catch (e) {
      // QuotaExceededError: ignored, the cap makes this very unlikely (D9)
    }
    pushEatenLog(capped);
    return capped;
  }

  /** Remove one entry (routine undo) and push the shorter log. */
  function unlogEaten(id) {
    const kept = localEatenLog().filter((e) => e.id !== id);
    try { localStorage.setItem(LS_EATEN_LOG, JSON.stringify(kept)); } catch (e) { /* quota: ignored like logEaten */ }
    pushEatenLog(kept);
  }

  /** Phase 43: mirrors the whole mp_cooks array to KV `cooks` (the assistant reads it via GET /leftovers). Best-effort, never throws. */
  async function pushCooks(records) {
    if (!config().enabled) return "off";
    try {
      await req("PUT", "/cooks", records);
      return "ok";
    } catch (e) {
      return "error";
    }
  }

  // Phase 41: today's one-tap counters. Local first (mp_today), push best-effort; a stored date != today reads as zeros.
  const LS_TODAY = "mp_today";
  const londonDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d || new Date());
  const Today = {
    get() {
      const zero = { date: londonDate(), water: 0, caffeine: 0, gym: false, routineDone: [] };
      try {
        const o = JSON.parse(localStorage.getItem(LS_TODAY));
        if (!o || o.date !== zero.date) return zero;
        const n = (v) => (Number.isInteger(v) && v > 0 ? Math.min(v, 99) : 0);
        return { date: o.date, water: n(o.water), caffeine: n(o.caffeine), gym: o.gym === true,
          routineDone: Array.isArray(o.routineDone) ? o.routineDone.filter((i) => typeof i === "string") : [] };
      } catch (e) { return zero; }
    },
    save(t) {
      try { localStorage.setItem(LS_TODAY, JSON.stringify(t)); } catch (e) { /* quota: ignored */ }
      if (t.gym) localStorage.setItem("mp_gymDay", JSON.stringify({ date: t.date })); // Phase 35's reader stays unchanged
      else localStorage.removeItem("mp_gymDay");
      Today.push(t);
      return t;
    },
    bump(field, delta) {
      const t = Today.get();
      t[field] = Math.max(0, Math.min(99, t[field] + delta));
      return Today.save(t);
    },
    setGym(on) { return Today.save({ ...Today.get(), gym: !!on }); },
    /** Second tap undoes: same entry id means a double-log is impossible. Never touches the pantry. */
    toggleRoutine(meal, tags) {
      const t = Today.get();
      const id = `routine:${meal.id}:${t.date}`;
      if (t.routineDone.includes(meal.id)) {
        unlogEaten(id);
        t.routineDone = t.routineDone.filter((i) => i !== meal.id);
        Today.save(t);
        return "undone";
      }
      logEaten({ id, mealId: meal.id, name: meal.name, eatenAt: new Date().toISOString(), tags: tags || [] });
      t.routineDone.push(meal.id);
      Today.save(t);
      return "logged";
    },
    /** Pure: daily routines always, gymDays only when today.gym. Meals deleted from the library simply aren't passed in. */
    dueRoutines: (meals, today) => MP.dueRoutines(meals, today),
    async push(t) {
      if (!config().enabled) return "off";
      try { await req("PUT", "/today", t); return "ok"; } catch (e) { return "error"; }
    },
    /** Adopt the Worker copy when it is for today (the assistant may have set gym). */
    async pull() {
      if (!config().enabled) return false;
      try {
        const r = await req("GET", "/today");
        if (!r || r.date !== londonDate() || JSON.stringify(r) === JSON.stringify(Today.get())) return false;
        localStorage.setItem(LS_TODAY, JSON.stringify(r));
        if (r.gym) localStorage.setItem("mp_gymDay", JSON.stringify({ date: r.date }));
        else localStorage.removeItem("mp_gymDay");
        return true;
      } catch (e) { return false; }
    },
    londonDate,
  };
  MP.Today = Today;

  // ponytail: no debounce/retry — the inflight guard plus human-paced
  // triggers (save, resume) are enough. Queue/backoff is a FUTURE.md item.
  function start() {
    window.addEventListener("mp:library-saved", syncLibrary);
    window.addEventListener("mp:plan-saved", (e) => pushPlan(e.detail));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      syncLibrary();
      // Sequenced: syncPlacements rewrites mp_plan from localStorage, so an
      // eat applied in parallel could be overwritten.
      syncPlacements().then(syncEatRequests).then(fetchFoodLog).then(fetchPlanDraft);
      pushPrefs();
      flushShoppingLines();
    });
    syncLibrary();
    syncPlacements().then(syncEatRequests).then(fetchFoodLog).then(fetchPlanDraft);
    pushPrefs();
    pushCooks(MP.Cooks ? MP.Cooks.all() : []);
    flushOps();
    flushShoppingLines();
  }

  // ---- Product records (Phase 33a): whole-key GET/PUT, merged per record by MP.Products.merge ----
  function localProducts() {
    try {
      const m = JSON.parse(localStorage.getItem("mp_products") || "null");
      return m && Array.isArray(m.products) ? m.products : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocalProducts(products) {
    localStorage.setItem("mp_products", JSON.stringify({ updatedAt: new Date().toISOString(), products }));
  }

  /** `cofid` = loaded cofid.json; null skips the fill (offline first visit), it never clears. */
  async function syncProducts(cofid) {
    if (!config().enabled) return "off";
    try {
      const remote = await req("GET", "/products");
      const remoteList = remote && Array.isArray(remote.products) ? remote.products : [];
      const now = new Date().toISOString();
      const merged = MP.Products.merge(localProducts(), remoteList).map((p) => {
        const f = MP.Products.fillFromCofid(p, cofid);
        return JSON.stringify(f.nutrients) === JSON.stringify(p.nutrients) ? p : { ...f, updatedAt: now };
      });
      writeLocalProducts(merged);
      if (JSON.stringify(merged) !== JSON.stringify(remoteList)) {
        await req("PUT", "/products", { updatedAt: new Date().toISOString(), products: merged });
      }
      return "ok";
    } catch (e) {
      return "error";
    }
  }

  /** Stamps updatedAt, upserts into the mirror (works offline), then syncs. */
  function saveProduct(p, cofid) {
    const saved = { ...MP.Products.fillFromCofid(p, cofid), updatedAt: new Date().toISOString() };
    writeLocalProducts([...localProducts().filter((x) => x.id !== saved.id), saved]);
    return syncProducts(cofid);
  }

  // ---- Assistant activity (Phase 48): the Worker logs assistant writes; this lists and undoes them ----
  async function fetchActivity() {
    const r = await req("GET", "/activity");
    return r && Array.isArray(r.entries) ? r.entries : [];
  }

  /** Resolves { ok: true } or { ok: false, status, error, changed } — a 409 is an answer, not a failure. */
  async function undoActivity(id, force) {
    const { url, token } = config();
    const res = await fetch(url + "/activity/undo", {
      method: "POST",
      headers: { "X-Auth-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ id, force: !!force }),
    });
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true };
    const o = body && typeof body === "object" ? body : { error: String(body) };
    return { ok: false, status: res.status, error: o.error || "failed", changed: o.changed || [] };
  }

  /** Pull one KV key back into the local copy after an undo changed it on the Worker. */
  function resyncKey(key) {
    if (key === "pantry") return fetchItems(key);
    if (key === "adhoc" || key === "shopping") return fetchShoppingLines();
    if (key === "library") return syncLibrary();
    if (key === "placements" || key === "eatRequests") return syncPlacements().then(syncEatRequests);
    if (key === "dayHints") return fetchDayHints();
    if (key === "products") return syncProducts(null);
    if (key === "today") return MP.Today.pull();
    if (key === "planFlag") return syncPlanFlag();
    if (key === "planDraft") { // Phase 63: undoing a re-flow draft restores the app-side snapshot (plan.js's MP.Plan.restore, same two keys)
      const raw = localStorage.getItem("mp_planUndo");
      if (raw) localStorage.setItem("mp_plan", raw);
    }
    return Promise.resolve();
  }

  MP.Sync = {
    decide, needsPlan, config, saveConfig, syncLibrary, syncPlanFlag, ackPlanFlag,
    shoppingLines, setLine, fetchShoppingLines, flushShoppingLines,
    fetchItems, fetchPantry, localItems, writeLocalItems, queueOp, applyOps, flushOps,
    planMirror, pushPlan, pushPrefs, fetchPlanPrefs, fetchDayHints, fetchPlanDraft, ackPlanDraft, fetchRatings, fetchFoodLog, postFoodLog, removeFoodEntry, groupFoodLog, localFoodLog, fetchSettings, settings, hardTerms, noteLibraryChange, fetchDrafts, deleteDraft, pushRating, pushPlanPrefs, newPlacements, newSince, syncPlacements, ackPlacements, syncEatRequests,
    localEatenLog, logEaten, unlogEaten, pushEatenLog, pushCooks, start,
    syncProducts, localProducts, saveProduct, fetchActivity, undoActivity, resyncKey,
  };
})();
