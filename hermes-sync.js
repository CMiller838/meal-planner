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

  async function req(method, path, body) {
    const { url, token } = config();
    const res = await fetch(url + path, {
      method,
      headers: { "X-Auth-Token": token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    if (res.status === 204) return null;
    return res.json();
  }

  let inflight = false;

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
        await req("PUT", "/library", { updatedAt, meals: JSON.parse(localStorage.getItem("mp_library") || "[]") });
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
        result[idx] = { ...result[idx], qty: MP.ShoppingList.fmtRemaining(have, used) };
      } else if (op.type === "add") {
        if (idx === -1) {
          const item = { name: op.name };
          if (op.qty) item.qty = op.qty;
          result.push(item);
        } else {
          result[idx] = op.qty ? { ...result[idx], qty: op.qty } : { name: result[idx].name };
        }
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

  /** Pure: slims a plan to the KV mirror shape — mealId + eatenAt per filled
   *  slot, empty slots omitted. No recipe/name data ever leaves the device. */
  function planMirror(plan) {
    if (!plan || !Array.isArray(plan.days)) return { startDate: null, days: [] };
    const days = plan.days.map((d) => {
      const slots = {};
      for (const slotType of SLOT_TYPES) {
        const slot = d && d.slots && d.slots[slotType];
        if (slot && slot.mealId) {
          slots[slotType] = { mealId: slot.mealId, eatenAt: slot.eatenAt || null };
          if (slot.variantId) slots[slotType].variantId = slot.variantId;
        }
      }
      return { day: d.day, slots };
    });
    return { startDate: plan.startDate || null, days };
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

  /** Pure: placements from `remote` requested after `ackedAt`, ascending. */
  function newPlacements(remote, ackedAt) {
    if (!remote || !Array.isArray(remote.placements)) return [];
    const acked = finite(Date.parse(ackedAt)) ?? -Infinity;
    return remote.placements
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

  // ponytail: no debounce/retry — the inflight guard plus human-paced
  // triggers (save, resume) are enough. Queue/backoff is a FUTURE.md item.
  function start() {
    window.addEventListener("mp:library-saved", syncLibrary);
    window.addEventListener("mp:plan-saved", (e) => pushPlan(e.detail));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      syncLibrary();
      syncPlacements();
      pushPrefs();
    });
    syncLibrary();
    syncPlacements();
    pushPrefs();
    flushOps();
  }

  MP.Sync = {
    decide, needsPlan, config, saveConfig, syncLibrary, syncPlanFlag, ackPlanFlag,
    fetchItems, fetchPantry, localItems, writeLocalItems, queueOp, applyOps, flushOps,
    planMirror, pushPlan, pushPrefs, newPlacements, syncPlacements, ackPlacements,
    localEatenLog, logEaten, pushEatenLog, start,
  };
})();
