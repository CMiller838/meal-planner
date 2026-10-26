// Assistant-written per-day effort hints (Phase 37), keyed by ISO date. Loaded as a browser <script> AND imported
// into the Cloudflare Worker bundle — must not touch window/document, and localStorage only inside dismiss/offMap.
(function (root) {
  "use strict";

  const OFF_KEY = "mp_dayHintOff";
  const EFFORTS = ["busy", "normal", "free"];

  /** ISO date of plan day n (1-based) for a plan starting at startDate. */
  function dateOfDay(startDate, n) {
    const [y, m, d] = startDate.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n - 1)).toISOString().slice(0, 10);
  }

  /** hints = { updatedAt, days: { iso: { effort, why } } } (or junk). off = { iso: updatedAt }.
   *  Drops past dates, dates outside the plan, `normal`, unknown efforts and dismissed hints. */
  function resolve(hints, startDate, todayIso, off) {
    const out = { busyDays: [], freeDays: [], byDay: {} };
    if (!hints || typeof hints !== "object" || !hints.days || typeof hints.days !== "object" || !startDate) return out;
    for (let n = 1; n <= 28; n++) {
      const iso = dateOfDay(startDate, n);
      const h = hints.days[iso];
      if (!h || iso < todayIso || !EFFORTS.includes(h.effort) || h.effort === "normal") continue;
      if (off && off[iso] === hints.updatedAt) continue;
      (h.effort === "busy" ? out.busyDays : out.freeDays).push(n);
      out.byDay[n] = { effort: h.effort, why: typeof h.why === "string" ? h.why : "", date: iso };
    }
    return out;
  }

  /** busyDays union; freeDays minus user-busy days. vocab/chips untouched. */
  function merge(prefs, resolved) {
    const busy = Array.from(new Set((prefs.busyDays || []).concat(resolved.busyDays))).sort((a, b) => a - b);
    return { ...prefs, busyDays: busy, freeDays: resolved.freeDays.filter((d) => !(prefs.busyDays || []).includes(d)) };
  }

  function offMap() {
    try {
      const m = JSON.parse(localStorage.getItem(OFF_KEY) || "{}");
      return m && typeof m === "object" && !Array.isArray(m) ? m : {};
    } catch (e) {
      return {};
    }
  }

  function dismiss(date, updatedAt) {
    localStorage.setItem(OFF_KEY, JSON.stringify({ ...offMap(), [date]: updatedAt }));
  }

  root.MP = root.MP || {};
  root.MP.DayHints = { resolve, merge, dismiss, offMap, dateOfDay };
})(typeof globalThis !== "undefined" ? globalThis : this);
