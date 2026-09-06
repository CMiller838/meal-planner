// Hermes bridge client: last-write-wins library sync + planFlag polling.
// Pure functions (decide, needsPlan) are tested in test.html. Loading this
// file has zero effect until start() is called by a page controller.
window.MP = window.MP || {};

(function () {
  "use strict";

  const LS_URL = "mp_hermes_url";
  const LS_TOKEN = "mp_hermes_token";
  const LS_PLAN_ACKED = "mp_hermes_plan_acked";
  const LS_PANTRY = "mp_pantry";

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

  function pantryMirror() {
    try {
      return JSON.parse(localStorage.getItem(LS_PANTRY) || "null");
    } catch (e) {
      return null;
    }
  }

  // ponytail: read-only mirror — Phase 12 adds the write path and whatever
  // conflict rule it needs. Modelled on syncPlanFlag (plain GET), not
  // syncLibrary — there is no local writer yet, so no decide()/inflight/PUT.
  async function fetchPantry() {
    if (!config().enabled) return pantryMirror();
    try {
      const body = await req("GET", "/pantry");
      if (body && Array.isArray(body.items)) {
        localStorage.setItem(LS_PANTRY, JSON.stringify(body));
        return body;
      }
      return pantryMirror();
    } catch (e) {
      return pantryMirror();
    }
  }

  // ponytail: no debounce/retry — the inflight guard plus human-paced
  // triggers (save, resume) are enough. Queue/backoff is a FUTURE.md item.
  function start() {
    window.addEventListener("mp:library-saved", syncLibrary);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") syncLibrary();
    });
    syncLibrary();
  }

  MP.Sync = { decide, needsPlan, config, saveConfig, syncLibrary, syncPlanFlag, ackPlanFlag, fetchPantry, start };
})();
