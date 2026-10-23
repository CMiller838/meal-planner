// Hermes bridge: a generic key relay over KV (library, planFlag, pantry,
// adhoc), plus read-only /discover, /ranking and /shopping routes. No router,
// no framework, and no growth into a general "any key" API.
import "../exclusions.js";
import "../data.js";
import "../shelf-life.js";
import "../shopping-list.js";
import "../mealdb.js";
import "../nutrition.js";
import "../generator.js";
import "../day-hints.js";
import "../products.js";
import "../ratings.js";
import SHELF_DATA from "../shelf-life.json";
import SUBS from "../substitutions.json";
import SUB_GROUPS from "../substitution-groups.json";
import TAGS from "../ingredient-nutrient-tags.json";
import TARGETS from "../nutrition-targets.json";
import PLAN_VOCAB from "../plan-preferences.json";
import PACK_DATA from "../pack-sizes.json";

const Exclusions = globalThis.MP.Exclusions;
const MealDB = globalThis.MP.MealDB;
const Nutrition = globalThis.MP.Nutrition;
const Generator = globalThis.MP.Generator;
const DayHints = globalThis.MP.DayHints;
const ShoppingList = globalThis.MP.ShoppingList;
const ShelfLife = globalThis.MP.ShelfLife;
const Products = globalThis.MP.Products;
const Ratings = globalThis.MP.Ratings;
const MPData = globalThis.MP;

const KEYS = {
  "/library": "library", "/planFlag": "planFlag", "/pantry": "pantry",
  "/plan": "plan", "/placements": "placements", "/prefs": "prefs",
  "/eaten-log": "eatenLog", "/planPrefs": "planPrefs", "/eat-requests": "eatRequests",
  "/dayHints": "dayHints", "/today": "today", "/products": "products", "/settings": "settings", "/cooks": "cooks",
  "/planDraft": "planDraft",
};
// The personal assistant's own token (ASSISTANT_TOKEN, never Hermes's
// AUTH_TOKEN) reaches only these method+path pairs: read the plan side, queue
// "I ate X" requests, everyday edits (lists, plan flag, placements), and append-
// only library adds (see the PUT /library check). Everything else answers 403.
const ASSISTANT_ALLOWED = new Set([
  "GET /library", "GET /plan", "GET /eaten-log", "GET /shopping", "GET /eat-requests", "PUT /eat-requests",
  "GET /discover", "GET /pantry", "PUT /pantry", "GET /adhoc", "PUT /adhoc", "GET /shopping/lines", "POST /shopping/lines", "PUT /planFlag",
  "GET /placements", "PUT /placements", "GET /prefs", "PUT /library", "GET /nutrition",
  "GET /dayHints", "PUT /dayHints", "PUT /meal-method", "GET /today", "PUT /today", "GET /products", "PUT /products",
  "GET /expiring", "GET /day", "GET /product-ranking", "GET /ratings", "GET /why", "GET /scale", "GET /cookable", "GET /substitutions", "GET /leftovers", "GET /quick",
  "GET /drafts", "POST /drafts", "GET /settings", "PUT /settings", "GET /activity", "POST /activity/undo",
  "POST /plan/draft", "POST /plan/apply", "GET /planDraft",
]);
const METHOD_PATH = /^\/meal\/([^/]+)\/method$/;
const DRAFT_PATH = /^\/drafts\/([^/]+)$/;
const RATING_PATH = /^\/meal\/([^/]+)\/rating$/;
const SLOT_TYPES = ["breakfast", "lunch", "dinner", "snack"];
const MEALDB_BASE = "https://www.themealdb.com/api/json/v1/1/";
const DISCOVER_LIMIT = 8;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token, X-Reason, X-Actor",
  "Access-Control-Max-Age": "86400",
};

function json(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

const LIST_KEYS = ["allergies", "dislikes", "likes", "never"];

/** Phase 52: Profile.md body -> stored settings. Unknown keys are dropped and listed; a known key with a bad value is an error. */
function normalizeSettings(body, fileTargets) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "body: expected a JSON object" };
  const keys = Object.keys(fileTargets).filter((k) => k !== "_note" && k !== "gymDay" && typeof fileTargets[k] === "number");
  const resolve = (k) => {
    if (keys.includes(k)) return k;
    if (k === "calories" || k === "kcal") return "energy_kcal";
    const m = keys.filter((x) => x.split("_")[0] === k);
    return m.length === 1 ? m[0] : null;
  };
  const num = (k, v, max) => (typeof v === "number" && isFinite(v) && v > 0 && v <= max ? null : `${k}: must be a positive number${max < Infinity ? " within 10x the default" : ""}`);
  const settings = { updatedAt: new Date().toISOString(), targets: {}, budgetTarget: 0, allergies: [], dislikes: [], likes: [], never: [] };
  const ignored = [];
  const budget = (k, v) => {
    if (v === 0) return null; // 0 = no override
    const bad = num(k, v, Infinity);
    if (!bad) settings.budgetTarget = v;
    return bad;
  };
  for (const [k, v] of Object.entries(body)) {
    if (k === "targets") {
      if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "targets: expected an object" };
      for (const [tk, tv] of Object.entries(v)) {
        if (tk === "budget") { const bad = budget("budget", tv); if (bad) return { error: bad }; continue; }
        const real = resolve(tk);
        if (!real) { ignored.push(tk); continue; }
        const bad = num(tk, tv, fileTargets[real] * 10);
        if (bad) return { error: bad };
        settings.targets[real] = tv;
      }
    } else if (k === "budget") {
      const bad = budget(k, v);
      if (bad) return { error: bad };
    } else if (LIST_KEYS.includes(k)) {
      if (!Array.isArray(v)) return { error: `${k}: expected an array` };
      const out = [...new Set(v.map((x) => (typeof x === "string" ? x.trim().toLowerCase() : "")).filter(Boolean))];
      if (out.length > 50 || out.some((x) => x.length > 40)) return { error: `${k}: at most 50 items of 40 characters` };
      settings[k] = out;
    } else ignored.push(k);
  }
  return { settings, ignored };
}

async function readSettings(env) {
  try {
    const s = JSON.parse(await env.MP_KV.get("settings"));
    return s && typeof s === "object" && !Array.isArray(s) ? s : null;
  } catch (e) { return null; }
}

async function putSettings(request, env) {
  const text = await request.text();
  if (text.length > 16384) return json(400, "body: over 16 KB");
  let body;
  try { body = JSON.parse(text); } catch (e) { return json(400, "invalid JSON"); }
  const r = normalizeSettings(body, TARGETS);
  if (r.error) return json(400, r.error);
  await env.MP_KV.put("settings", JSON.stringify(r.settings));
  return json(200, { ok: true, settings: r.settings, ignored: r.ignored });
}

async function discover(q, hard) {
  const url = q && q.trim()
    ? `${MEALDB_BASE}search.php?s=${encodeURIComponent(q.trim())}`
    : `${MEALDB_BASE}random.php`;

  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("upstream " + res.status);
    data = await res.json();
  } catch (e) {
    return json(502, "discovery upstream failed");
  }

  const meals = [];
  const rejected = [];
  for (const detail of data.meals ?? []) {
    if (meals.length >= DISCOVER_LIMIT || rejected.length >= DISCOVER_LIMIT) break;
    const candidate = MealDB.toMeal(detail);
    const result = Exclusions.sanitize(candidate, SUBS);
    const hit = result && hard.length && Exclusions.termHit(result.meal, hard);
    if (hit) {
      rejected.push({ name: candidate.name, reasons: ["contains " + hit] });
    } else if (result) {
      meals.push({ ...result.meal, substituted: result.substituted });
    } else {
      rejected.push({ name: candidate.name, reasons: Exclusions.check(candidate).reasons });
    }
  }

  return json(200, { query: q || "", meals, rejected });
}

/** Read-only ranking for one slot. Advisory only: the plan mirror is stale by
 *  construction and the cost/pantry layers don't exist server-side. */
/** Shared by /ranking and /why: validated day+slot -> the synced inputs and rankSlot's order. `{ err }` is a ready Response. */
async function slotContext(day, slot, env) {
  const [libraryRaw, planRaw, prefsRaw, hintsRaw, ratingsRaw] = await Promise.all([
    env.MP_KV.get("library"), env.MP_KV.get("plan"), env.MP_KV.get("planPrefs"),
    env.MP_KV.get("dayHints"), env.MP_KV.get("ratings"),
  ]);

  let library, plan;
  try {
    library = JSON.parse(libraryRaw);
    plan = JSON.parse(planRaw);
  } catch (e) {
    return { err: json(409, "library and plan must be synced first") };
  }
  if (!Array.isArray(library) || library.length === 0 || !plan || !Array.isArray(plan.days)) {
    return { err: json(409, "library and plan must be synced first") };
  }

  let planPrefs;
  try {
    planPrefs = JSON.parse(prefsRaw) || {};
  } catch (e) {
    planPrefs = {};
  }
  let ratings = {};
  try { ratings = JSON.parse(ratingsRaw).meals || {}; } catch (e) {}

  const dayObj = plan.days[day - 1] || { slots: {} };
  const slotVal = dayObj.slots[slot] || null;
  const byId = Object.fromEntries(library.map((m) => [m.id, m]));
  const others = SLOT_TYPES.filter((s) => s !== slot)
    .map((s) => dayObj.slots[s] && byId[dayObj.slots[s].mealId])
    .filter(Boolean);
  let hints = null;
  try {
    hints = JSON.parse(hintsRaw);
  } catch (e) {}
  const resolved = DayHints.resolve(hints, plan.startDate, Generator.isoToday(), {});
  const prefs = DayHints.merge({ vocab: PLAN_VOCAB, busyDays: planPrefs.busyDays || [], chips: planPrefs.chips || [], repeatGap: planPrefs.repeatGap || 0 }, resolved);
  const hint = resolved.byDay[day] ? { effort: resolved.byDay[day].effort, why: resolved.byDay[day].why } : null;
  const pool = library.filter((m) => (m.mealTypes || []).includes(slot));
  const settings = await readSettings(env);
  const ranked = Generator.rankSlot(pool, day, others, { tags: TAGS, targets: Nutrition.withProfile(TARGETS, settings), prefs, ratings, taste: Ratings.tasteProfile(ratings, library, PACK_DATA.planning), profile: Nutrition.profileOf(settings) });

  const gap = Nutrition.dayCoverage(others, TAGS, Nutrition.withProfile(TARGETS, settings));
  const shortOn = [...gap.missing, ...gap.partial];
  const { prefer, avoid } = Generator.activeChips(prefs);
  return { library, slotVal, byId, prefs, ratings, ranked, shortOn, chips: prefer.concat(avoid), preferChips: prefer, hint };
}

/** Stable id for a draft: FNV-1a over the canonical JSON of its changes (built in a fixed order). */
function draftId(changes) {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(changes)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const readJSON = async (env, k) => parseKV(await env.MP_KV.get(k));
const libraryOf = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.meals) ? v.meals : []);
const slotRef = (v) => (v && v.mealId ? { mealId: v.mealId, ...(v.variantId ? { variantId: v.variantId } : {}) } : null);

/** POST /plan/draft: Generator.generatePlan around the synced inputs, merged over the plan mirror. Stores nothing. */
async function draftPlan(body, env) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return json(400, "expected an object");
  const { days = null, keep = [], avoid = [], budget = null } = body;
  if (days !== null && (!Array.isArray(days) || !days.every((d) => Number.isInteger(d) && d >= 1 && d <= 14))) return json(400, "days must be integers 1-14");
  if (!Array.isArray(keep) || !keep.every((k) => k && Number.isInteger(k.day) && k.day >= 1 && k.day <= 14 && SLOT_TYPES.includes(k.slot))) return json(400, "keep must be [{ day 1-14, slot }]");
  if (!Array.isArray(avoid) || !avoid.every((a) => typeof a === "string")) return json(400, "avoid must be meal id strings");
  if (budget !== null && !(typeof budget === "number" && isFinite(budget) && budget > 0)) return json(400, "budget must be a number > 0");

  const [libRaw, mirror, planPrefs, hints, ratingsRaw, pantry, settings] = await Promise.all(
    ["library", "plan", "planPrefs", "dayHints", "ratings", "pantry"].map((k) => readJSON(env, k)).concat(readSettings(env)));
  const library = libraryOf(libRaw);
  if (!library.length) return json(409, "library must be synced first");
  const hasMirror = !!(mirror && Array.isArray(mirror.days));
  const startDate = (hasMirror && mirror.startDate) || Generator.isoToday();
  const want = new Set(days || Array.from({ length: 14 }, (_, i) => i + 1));
  const kept = new Set(keep.map((k) => `${k.day}:${k.slot}`));
  const avoidSet = new Set(avoid);

  const pp = planPrefs || {};
  const resolved = DayHints.resolve(hints, startDate, Generator.isoToday(), {});
  const prefs = DayHints.merge({ vocab: PLAN_VOCAB, busyDays: pp.busyDays || [], chips: pp.chips || [] }, resolved);
  const target = budget ?? (settings && settings.budgetTarget > 0 ? settings.budgetTarget : pp.budgetTarget);
  if (target > 0) prefs.budgetTarget = target;
  prefs.repeatGap = pp.repeatGap || 0;
  prefs.profile = Nutrition.profileOf(settings);
  const pool = library.filter((m) => !avoidSet.has(m.id));
  const budgetObj = { costIndex: ShoppingList.costIndex(pool, PACK_DATA), groups: ShoppingList.groupIndex(SUB_GROUPS), ...PACK_DATA.planning };
  const gen = Generator.generatePlan(pool, TAGS, Nutrition.withProfile(TARGETS, settings), SHELF_DATA, startDate, budgetObj,
    ShoppingList.pantryIndex(pantry || { items: [] }), prefs, (ratingsRaw && ratingsRaw.meals) || {});
  // ponytail: a merge can split a batch/leftover chain at a kept/eaten boundary; the user sees the draft before applying.

  const merged = [];
  const changes = [];
  for (let day = 1; day <= 14; day++) {
    const old = (hasMirror && mirror.days[day - 1] && mirror.days[day - 1].slots) || {};
    const slots = {};
    for (const slot of SLOT_TYPES) {
      const cur = old[slot];
      if (!want.has(day) || kept.has(`${day}:${slot}`) || (cur && cur.eatenAt)) {
        if (cur) slots[slot] = cur;
        continue;
      }
      const g = gen.days[day - 1].slots[slot];
      if (!g) continue;
      slots[slot] = g;
      const before = slotRef(cur), after = slotRef(g);
      if (after && JSON.stringify(before) !== JSON.stringify(after)) changes.push({ day, slot, before, after });
    }
    merged.push({ day, slots });
  }
  const names = Object.fromEntries(library.map((m) => [m.id, m.name]));
  const summary = changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"}: ${changes.slice(0, 3).map((c) => `day ${c.day} ${c.slot} ${names[c.after.mealId] || c.after.mealId}`).join(", ")}${changes.length > 3 ? ` +${changes.length - 3} more` : ""}` : "no changes";
  return json(200, { draft: { id: draftId(changes), startDate, changes, summary }, plan: { startDate, days: merged } });
}

/** POST /plan/apply: park a draft in KV planDraft for the app to adopt; never touches the plan mirror. */
async function applyDraft(body, env, who) {
  const d = body && body.draft;
  if (typeof d !== "object" || d === null || typeof d.id !== "string" || !d.id || typeof d.startDate !== "string" || !Array.isArray(d.changes)) return json(400, "draft required");
  if (!d.changes.length) return json(400, "nothing to apply");
  const libRaw = await readJSON(env, "library");
  const ids = new Set(libraryOf(libRaw).map((m) => m.id));
  if (!ids.size) return json(409, "library must be synced first");
  const refOk = (r) => r && typeof r.mealId === "string" && ids.has(r.mealId);
  for (const c of d.changes) {
    if (!c || !Number.isInteger(c.day) || c.day < 1 || c.day > 14 || !SLOT_TYPES.includes(c.slot)) return json(400, "each change needs day 1-14 and a valid slot");
    if (!refOk(c.after)) return json(400, "change references a meal not in the library");
  }
  const cur = await readJSON(env, "planDraft");
  if (cur && cur.id === d.id) {
    if (cur.pending) return json(200, { id: d.id, status: "already pending" });
    if (cur.ackedId === d.id) return json(200, { id: d.id, status: "already applied" });
  }
  const next = { id: d.id, at: new Date().toISOString(), pending: true, startDate: d.startDate, changes: d.changes.map(({ day, slot, before, after }) => ({ day, slot, before: slotRef(before), after: slotRef(after) })) };
  await env.MP_KV.put("planDraft", JSON.stringify(next));
  await logWrite(env, { who, key: "planDraft", why: "", changes: diffItems("planDraft", cur, next) });
  return json(200, { id: d.id, status: "pending" });
}

/** The real ranking terms behind a meal's place, as codes. Only inputs rankSlot reads: gap, prefer chip, busy-day effort, rating. */
function rankingReasons(m, day, c) {
  const out = [];
  if (Nutrition.tagsForMeal(m, TAGS).some((t) => c.shortOn.includes(t))) out.push({ code: "fills_gap", text: "covers a nutrient today is short on" });
  if (c.preferChips.some((ch) => Generator.chipHits(m, ch, TAGS))) out.push({ code: "chip", text: "matches a preference you set" });
  const busy = c.prefs.vocab && c.prefs.vocab.busy;
  if (busy && c.prefs.busyDays.includes(day) && Generator.effortOf(m) === busy.preferEffort) out.push({ code: "quick", text: "quick to make on a busy day" });
  const r = c.ratings[m.id] && c.ratings[m.id].rating;
  if (r === "up") out.push({ code: "liked", text: "ranked up: you liked this" });
  if (r === "down") out.push({ code: "disliked", text: "ranked down: you disliked this" });
  return out;
}

async function ranking(params, env) {
  const dayRaw = params.get("day");
  const day = Number(dayRaw);
  if (dayRaw === null || dayRaw === "" || !Number.isInteger(day) || day < 1 || day > 14) {
    return json(400, "day must be 1-14");
  }

  const slot = params.get("slot") || "dinner";
  if (!SLOT_TYPES.includes(slot)) return json(400, "slot must be breakfast, lunch, dinner or snack");

  const nRaw = params.get("n");
  const n = nRaw === null ? 3 : Number(nRaw);
  if (!Number.isInteger(n) || n < 1 || n > 10) return json(400, "n must be 1-10");

  const c = await slotContext(day, slot, env);
  if (c.err) return c.err;
  const { ranked, shortOn, chips, prefs, hint, slotVal } = c;

  const candidates = ranked.slice(0, n).map((m, i) => ({
    mealId: m.id,
    name: m.name,
    rank: i + 1,
    covers: Nutrition.tagsForMeal(m, TAGS).filter((t) => shortOn.includes(t)),
    prepEffort: m.prepEffort || "quick",
    chipHits: chips.filter((c) => Generator.chipHits(m, c, TAGS)).map((c) => c.id),
  }));

  return json(200, {
    day, slot, shortOn,
    current: slotVal ? { mealId: slotVal.mealId, variantId: slotVal.variantId ?? null } : null,
    candidates,
    busyDay: prefs.busyDays.includes(day),
    hint,
    approximate: true,
  });
}

/** One day's eaten log, planned slots and coverage: shared by GET /nutrition?date= and GET /day. */
async function dayView(date, gym, { byId, log, planRaw, dayFmt }, env) {
  const baseTargets = Nutrition.withProfile(TARGETS, await readSettings(env));
  const targets = gym ? Nutrition.withGymDay(baseTargets) : baseTargets;
  const eatenToday = log.filter((e) => dayFmt.format(new Date(e.eatenAt)) === date);
  const { cov, missing, partial } = Nutrition.eatenDayCoverage(eatenToday, byId, TAGS, targets);
  const planned = [];
  if (planRaw && Array.isArray(planRaw.days) && planRaw.startDate) {
    const start = Date.parse(planRaw.startDate + "T00:00:00Z");
    const idx = Math.round((Date.parse(date + "T00:00:00Z") - start) / 86400000);
    const day = planRaw.days.find((d) => d.day === idx + 1);
    for (const slot of SLOT_TYPES) {
      const v = day && day.slots && day.slots[slot];
      if (v && v.mealId && !v.eatenAt) planned.push({ slot, mealId: v.mealId, name: (byId[v.mealId] || {}).name || v.mealId });
    }
  }
  return { eatenToday, planned, cov, missing, partial };
}

/** GET /day?date=&gym=1: the Today screen as one flat, ordered card list (read-only; /today stays the raw counters). */
async function day(params, env) {
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
  const date = params.has("date") ? params.get("date") : dayFmt.format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return json(400, "date must be YYYY-MM-DD");
  const gRaw = params.get("gym");
  if (gRaw !== null && gRaw !== "0" && gRaw !== "1") return json(400, "gym must be 0 or 1");
  const gym = gRaw === "1" && !!TARGETS.gymDay;
  const read = async (k) => {
    try { return JSON.parse(await env.MP_KV.get(k)); } catch (e) { return null; }
  };
  const [libRaw, planRaw, logRaw, pantryRaw, todayRaw, cooksRaw] = await Promise.all(["library", "plan", "eatenLog", "pantry", "today", "cooks"].map(read));
  const meals = Array.isArray(libRaw) ? libRaw : libRaw && Array.isArray(libRaw.meals) ? libRaw.meals : [];
  const byId = Object.fromEntries(meals.map((m) => [m.id, m]));
  const log = Array.isArray(logRaw) ? logRaw : [];
  const v = await dayView(date, gym, { byId, log, planRaw, dayFmt }, env);
  const t = todayRaw && typeof todayRaw === "object" && todayRaw.date === date ? todayRaw : null;
  const count = (f) => (t && Number.isInteger(t[f]) && t[f] > 0 ? Math.min(t[f], 99) : 0);
  const done = t && Array.isArray(t.routineDone) ? t.routineDone : [];
  const cards = [];
  for (const p of v.planned) cards.push({ type: "meal", slot: p.slot, mealId: p.mealId, name: p.name, state: "planned" });
  for (const e of v.eatenToday) cards.push({ type: "meal", slot: null, mealId: e.mealId, name: e.name, state: "eaten", eatenAt: e.eatenAt });
  for (const m of MPData.dueRoutines(meals, { gym: gym || !!(t && t.gym) })) cards.push({ type: "routine", mealId: m.id, name: m.name, done: done.includes(m.id) });
  for (const c of ["water", "caffeine"]) cards.push({ type: "counter", counter: c, count: count(c) });
  const items = pantryRaw && Array.isArray(pantryRaw.items) ? pantryRaw.items : [];
  for (const x of ShelfLife.expiringItems(items, planRaw, date, 2, SHELF_DATA)) cards.push({ type: "expiring", name: x.name, useBy: x.useBy, basis: x.basis, daysLeft: x.daysLeft });
  // Phase 43 not built yet: leftoverView absent or cooks malformed -> no leftover cards.
  if (typeof ShelfLife.leftoverView === "function" && cooksRaw) {
    try { for (const l of ShelfLife.leftoverView(cooksRaw, date)) cards.push({ type: "leftover", ...l }); } catch (e) { /* malformed cooks */ }
  }
  cards.push({ type: "coverage", proteinGramsApprox: v.cov.proteinGramsApprox, proteinTarget: v.cov.proteinTarget, missing: v.missing, partial: v.partial });
  return json(200, { date, assembledAt: new Date().toISOString(), gym, cards });
}

/** One local day's approximate nutrition: what the eaten log says was eaten that
 *  day, scored with the app's own dayCoverage, plus the day's uneaten planned
 *  slots and (when protein is short) a few library meals ranked for protein.
 *  Entries whose meal left the library still count by their frozen tags. */
async function nutrition(params, env) {
  const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
  const date = params.get("date") || "";
  const hasWindow = params.has("from") || params.has("to");
  if (hasWindow && params.has("date")) return json(400, "use date or from/to, not both");
  if (hasWindow && params.has("gym")) return json(400, "gym is only valid with date");
  // ponytail: the user's zone is fixed (UK); add a tz param if that ever changes.
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
  let dates = null;
  if (hasWindow) {
    const to = params.get("to") || dayFmt.format(new Date());
    const from = params.get("from") || new Date(Date.parse(to + "T00:00:00Z") - 6 * 86400000).toISOString().slice(0, 10);
    if (!isDay(to) || !isDay(from)) return json(400, "from/to must be YYYY-MM-DD");
    const n = Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
    if (n < 1 || n > 14) return json(400, "from must not be after to, and the window is at most 14 days");
    dates = Array.from({ length: n }, (_, i) => new Date(Date.parse(from + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10));
  } else if (!isDay(date)) return json(400, "date must be YYYY-MM-DD");
  const read = async (k) => {
    try { return JSON.parse(await env.MP_KV.get(k)); } catch (e) { return null; }
  };
  const [libRaw, planRaw, logRaw] = await Promise.all([read("library"), read("plan"), read("eatenLog")]);
  const meals = Array.isArray(libRaw) ? libRaw : libRaw && Array.isArray(libRaw.meals) ? libRaw.meals : [];
  const byId = Object.fromEntries(meals.map((m) => [m.id, m]));
  const log = Array.isArray(logRaw) ? logRaw : [];
  if (dates) {
    const g = Nutrition.weekGaps(log, byId, dates, TAGS, Nutrition.withProfile(TARGETS, await readSettings(env)), (e) => dayFmt.format(new Date(e.eatenAt)));
    return json(200, { from: dates[0], to: dates[dates.length - 1], nutrients: g.nutrients, notLogged: g.notLogged });
  }
  const gym = params.get("gym") === "1" && !!TARGETS.gymDay;
  const { eatenToday, planned, cov, missing, partial } = await dayView(date, gym, { meals, byId, log, planRaw, dayFmt }, env);
  const short = cov.proteinGramsApprox < 0.8 * cov.proteinTarget;
  const swaps = short ? Nutrition.rankByGap(meals, ["protein"], TAGS).slice(0, 3).map((m) => ({ id: m.id, name: m.name })) : [];
  return json(200, {
    date, eaten: eatenToday.map((e) => e.name), planned: planned.map(({ slot, name }) => ({ slot, name })),
    ...(gym ? { gym: true } : {}),
    proteinGramsApprox: cov.proteinGramsApprox, proteinTarget: cov.proteinTarget, missing, partial, swaps,
  });
}

/** The planned two-week shopping list, computed by the same
 *  MP.ShoppingList.buildLists the shopping page runs, over the KV plan
 *  mirror, library and pantry. As stale as the plan mirror is. */
/** GET /expiring?days=N&today=YYYY-MM-DD: pantry items due within N days (default 2), overdue included. */
async function expiring(params, env) {
  const dRaw = params.get("days");
  const days = dRaw == null ? 2 : /^\d+$/.test(dRaw) ? Number(dRaw) : -1;
  if (days < 0 || days > 30) return json(400, "days must be 0-30");
  const today = params.get("today") || new Date().toISOString().slice(0, 10);
  if (!ShelfLife.isIsoDate(today)) return json(400, "today must be YYYY-MM-DD");
  const read = async (k) => {
    try { return JSON.parse(await env.MP_KV.get(k)); } catch (e) { return null; }
  };
  const [pantry, plan] = await Promise.all([read("pantry"), read("plan")]);
  const items = pantry && Array.isArray(pantry.items) ? pantry.items : [];
  return json(200, { days, today, items: ShelfLife.expiringItems(items, plan, today, days, SHELF_DATA) });
}

/** Shared by /cookable, /leftovers, /quick: validated today + n, and the KV mirrors (null/malformed -> empty). */
async function readMirrors(params, env, defN) {
  const nRaw = params.get("n");
  const n = nRaw == null ? defN : /^\d+$/.test(nRaw) ? Number(nRaw) : 0;
  if (n < 1 || n > 20) return { error: json(400, "n must be 1-20") };
  const today = params.get("today") || new Date().toISOString().slice(0, 10);
  if (!ShelfLife.isIsoDate(today)) return { error: json(400, "today must be YYYY-MM-DD") };
  const read = async (k) => {
    try { return JSON.parse(await env.MP_KV.get(k)); } catch (e) { return null; }
  };
  const [lib, pantry, plan, cooks] = await Promise.all([read("library"), read("pantry"), read("plan"), read("cooks")]);
  const meals = Array.isArray(lib) ? lib : lib && Array.isArray(lib.meals) ? lib.meals : [];
  return {
    n, today, plan, meals: meals.filter((m) => m && typeof m === "object"),
    items: pantry && Array.isArray(pantry.items) ? pantry.items : [],
    cooks: Array.isArray(cooks) ? cooks : [],
    opts: { n, tags: TAGS, targets: TARGETS, shelfData: SHELF_DATA },
  };
}

/** GET /cookable?n=: library meals the pantry covers (ready) or nearly covers (1-2 missing). */
async function cookable(params, env) {
  const m = await readMirrors(params, env, 10);
  if (m.error) return m.error;
  return json(200, { today: m.today, ...ShoppingList.cookable(m.meals, m.items, m.plan, m.today, m.opts) });
}

/** GET /leftovers: open cooked portions, fridge and freezer, soonest eat-by first. */
async function leftovers(params, env) {
  const m = await readMirrors(params, env, 10);
  if (m.error) return m.error;
  return json(200, { today: m.today, leftovers: ShelfLife.leftoverView(m.cooks, m.today, SHELF_DATA) });
}

/** GET /quick?n=: what to eat on a night you're not cooking. Suggestions only. */
async function quick(params, env) {
  const m = await readMirrors(params, env, 5);
  if (m.error) return m.error;
  return json(200, { today: m.today, items: ShoppingList.quickPicks(m.meals, m.items, m.cooks, m.plan, m.today, m.opts) });
}

/** GET /product-ranking: products by cost per 25 g protein, cheapest first (read-only; uses KV products + pack-sizes.json). */
async function productRanking(env) {
  let parsed = null;
  try { parsed = JSON.parse(await env.MP_KV.get("products")); } catch (e) { /* none yet */ }
  const products = parsed && Array.isArray(parsed.products) ? parsed.products : [];
  const ranked = Products.rank(products, PACK_DATA).map((r) => ({
    id: r.product.id, name: r.product.name, brand: r.product.brand || null, per25g: Math.round(r.per25g * 100) / 100, estimated: r.estimated,
  }));
  return json(200, { ranked });
}

async function shopping(env) {
  const [libraryRaw, planRaw, pantryRaw] = await Promise.all([
    env.MP_KV.get("library"), env.MP_KV.get("plan"), env.MP_KV.get("pantry"),
  ]);
  const parse = (raw) => {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  };
  const lib = parse(libraryRaw);
  const meals = Array.isArray(lib) ? lib : lib && Array.isArray(lib.meals) ? lib.meals : null;
  const plan = parse(planRaw);
  if (!meals || !plan || !Array.isArray(plan.days)) return json(409, "library and plan must be synced first");
  const pantry = parse(pantryRaw);
  const mealsById = Object.fromEntries(meals.map((m) => [m.id, m]));
  const lists = ShoppingList.buildLists(plan, mealsById, PACK_DATA, pantry && Array.isArray(pantry.items) ? pantry : null);
  const { lines } = await readShopping(env);
  const byId = new Map(lines.map((l) => [l.id, l]));
  for (const list of Object.values(lists)) {
    for (const l of [...list.lines, ...list.staples, ...list.estimated]) {
      l.id = ShoppingList.lineId(plan.startDate, list.shopDay, l.key);
      const st = byId.get(l.id);
      l.state = st ? st.state : "needed";
      l.stateAt = st ? st.updatedAt : null;
    }
  }
  const extras = lines.filter((l) => l.id.startsWith("x:") && l.state !== "deleted");
  return json(200, {
    updatedAt: plan.updatedAt || null,
    startDate: plan.startDate || null,
    lists,
    adhoc: ShoppingList.adhocView(lines),
    extras,
  });
}

// Phase 55: KV `shopping` is every shopping line's state (plan ticks and extras). KV `adhoc` is read once, to migrate.
const LINE_KEYS = ["id", "state", "updatedAt", "source", "label", "qty"];

/** @param {any} lines  @returns {string|null} */
function linesError(lines) {
  if (!Array.isArray(lines)) return "lines must be an array";
  if (lines.length > 100) return "at most 100 lines";
  for (const l of lines) {
    if (typeof l !== "object" || l === null || Array.isArray(l)) return "each line must be an object";
    for (const k of Object.keys(l)) if (!LINE_KEYS.includes(k)) return "unknown line key: " + k;
    if (typeof l.id !== "string" || l.id.length > 120 || !/^[px]:./.test(l.id)) return "id must be p:... or x:... (<= 120 characters)";
    if (!ShoppingList.LINE_STATES.includes(l.state)) return "state must be needed, got, skipped or deleted";
    if (typeof l.updatedAt !== "string" || !Number.isFinite(Date.parse(l.updatedAt))) return "updatedAt must be an ISO string";
    if (l.source !== undefined && !ShoppingList.LINE_SOURCES.includes(l.source)) return "unknown source";
    if (l.id.startsWith("x:")) {
      if (typeof l.label !== "string" || !l.label.trim() || l.label.length > 80) return "an x: line needs a label of 1-80 characters";
      if (!ShoppingList.LINE_SOURCES.includes(l.source)) return "an x: line needs a source";
      const q = qtyError(l.qty);
      if (q) return q;
    }
  }
  return null;
}

/** @param {any} v  the stored/undone `shopping` value */
function shoppingError(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? linesError(v.lines) : "expected an object";
}

/** The stored lines; before the first write they come from KV `adhoc` (lazy migration). */
async function readShopping(env) {
  const v = parseKV(await env.MP_KV.get("shopping"));
  if (v && Array.isArray(v.lines)) return { updatedAt: v.updatedAt || null, lines: v.lines };
  const old = parseKV(await env.MP_KV.get("adhoc"));
  if (!old || !Array.isArray(old.items)) return { updatedAt: null, lines: [] };
  const lines = ShoppingList.adhocToLines([], old.items, "manual", old.updatedAt || new Date().toISOString());
  return { updatedAt: old.updatedAt || null, lines };
}

/** Merge incoming lines into KV `shopping` (per-line last-write-wins). Writes and logs only when something changed.
 *  ponytail: KV read-merge-write is not atomic; two POSTs in the same ~second can lose one. Durable Object if it bites. */
async function mergeShopping(env, incoming, { who, why, dryRun }) {
  const cur = await readShopping(env);
  const nowIso = new Date().toISOString();
  const { lines, changed } = ShoppingList.mergeLines(cur.lines, incoming, nowIso);
  if (!changed.length) return { updatedAt: cur.updatedAt, lines: cur.lines, changed: 0 };
  const changes = diffItems("shopping", { lines: cur.lines }, { lines });
  if (dryRun) return { dry: { changes, summary: summarize("shopping", changes) } };
  await env.MP_KV.put("shopping", JSON.stringify({ updatedAt: nowIso, lines }));
  if (who !== "app") await logWrite(env, { who, key: "shopping", why, changes });
  return { updatedAt: nowIso, lines, changed: changed.length };
}

/** POST /shopping/lines { lines } */
async function postLines(request, env, who) {
  let b;
  try { b = JSON.parse(await request.text()); } catch (e) { return json(400, "invalid JSON"); }
  if (typeof b !== "object" || b === null || Array.isArray(b)) return json(400, "expected a JSON object");
  const bad = linesError(b.lines);
  if (bad) return json(400, bad);
  const r = await mergeShopping(env, b.lines, { who, why: reasonOf(request) });
  return json(200, r);
}

/** GET|PUT /adhoc: compatibility shim over `shopping` until Phase 56. */
async function adhocShim(request, env, who, dryRun) {
  const { updatedAt, lines } = await readShopping(env);
  if (request.method === "GET") return json(200, { updatedAt, items: ShoppingList.adhocView(lines) });
  if (request.method !== "PUT") return json(405, "method not allowed");
  let b;
  try { b = JSON.parse(await request.text()); } catch (e) { return json(400, "invalid JSON"); }
  if (typeof b !== "object" || b === null || Array.isArray(b)) return json(400, "expected a JSON object");
  const bad = itemsError(b);
  if (bad) return json(400, bad);
  const incoming = ShoppingList.adhocToLines(lines, b.items, who === "assistant" ? "assistant" : "manual", new Date().toISOString());
  const bad2 = linesError(incoming);
  if (bad2) return json(400, bad2);
  const r = await mergeShopping(env, incoming, { who, why: reasonOf(request), dryRun });
  return r.dry ? json(200, r.dry) : new Response(null, { status: 204, headers: CORS });
}

/** @param {any} parsed  @returns {string|null} */
function eatRequestsError(parsed) {
  if (!Array.isArray(parsed.requests)) return "requests must be an array";
  if (parsed.requests.length > 50) return "at most 50 requests";
  const seen = new Set();
  const ALLOWED_KEYS = new Set(["id", "mealId", "eatenAt", "requestedAt"]);
  for (const r of parsed.requests) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) return "each request must be an object";
    for (const key of Object.keys(r)) {
      if (!ALLOWED_KEYS.has(key)) return "unknown request key: " + key;
    }
    for (const field of ["id", "mealId", "eatenAt", "requestedAt"]) {
      if (typeof r[field] !== "string" || !r[field]) return "each request needs a non-empty " + field;
    }
    if (isNaN(Date.parse(r.eatenAt)) || isNaN(Date.parse(r.requestedAt))) return "eatenAt and requestedAt must be ISO dates";
    if (r.id !== `${r.mealId}:${r.eatenAt}`) return "id must be mealId:eatenAt";
    if (seen.has(r.id)) return "duplicate request id: " + r.id;
    seen.add(r.id);
  }
  return null;
}

/** @param {any} method  the PUT /meal-method `method` value
 *  @returns {string|null} */
function methodError(method) {
  if (!Array.isArray(method) || method.length < 1 || method.length > 30) return "method must be 1-30 steps";
  for (const s of method) {
    if (typeof s !== "object" || s === null || Array.isArray(s)) return "each step must be an object";
    for (const key of Object.keys(s)) if (key !== "text" && key !== "minutes") return "unknown step key: " + key;
    if (typeof s.text !== "string" || !s.text.trim() || s.text.length > 300) return "step text must be 1-300 characters";
    if (s.minutes !== undefined && (!Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > 600)) return "step minutes must be an integer 1-600";
  }
  return null;
}

const DRAFT_KEYS = ["name", "description", "mealTypes", "servings", "prepEffort", "ingredients", "method", "tags", "source", "sourceRef", "unreadable", "cost"];
const DRAFT_SOURCES = ["description", "link", "screenshot", "photo"];
const MAX_DRAFTS = 20;

/** @param {any} b  the POST /drafts body @returns {string|null} */
function draftError(b) {
  if (typeof b !== "object" || b === null || Array.isArray(b)) return "expected a JSON object";
  for (const k of Object.keys(b)) if (!DRAFT_KEYS.includes(k)) return "unknown key: " + k;
  const str = (v, max) => typeof v === "string" && v.trim().length >= 1 && v.length <= max;
  if (!str(b.name, 80)) return "name must be 1-80 characters";
  if (b.description !== undefined && (typeof b.description !== "string" || b.description.length > 300)) return "description must be <= 300 characters";
  if (b.mealTypes !== undefined && (!Array.isArray(b.mealTypes) || b.mealTypes.some((t) => !SLOT_TYPES.includes(t)))) return "bad mealTypes";
  if (b.servings !== undefined && (!Number.isInteger(b.servings) || b.servings < 1 || b.servings > 12)) return "servings must be an integer 1-12";
  if (b.prepEffort !== undefined && b.prepEffort !== "quick" && b.prepEffort !== "batch") return "prepEffort must be quick or batch";
  if (!Array.isArray(b.ingredients) || b.ingredients.length < 1 || b.ingredients.length > 40) return "ingredients must be 1-40 entries";
  for (const i of b.ingredients) {
    if (typeof i !== "object" || i === null || Array.isArray(i)) return "each ingredient must be an object";
    for (const k of Object.keys(i)) if (k !== "name" && k !== "qty") return "unknown ingredient key: " + k;
    if (!str(i.name, 60)) return "ingredient name must be 1-60 characters";
    if (i.qty !== undefined && (typeof i.qty !== "string" || i.qty.length > 40)) return "ingredient qty must be <= 40 characters";
  }
  if (b.method !== undefined) { const m = methodError(b.method); if (m) return m; }
  if (b.tags !== undefined) {
    if (typeof b.tags !== "object" || b.tags === null || Array.isArray(b.tags)) return "tags must be an object";
    for (const [k, v] of Object.entries(b.tags)) {
      if (!Nutrition.TRACKED_NUTRIENTS.includes(k)) return "unknown tag nutrient: " + k;
      if (v !== "low" && v !== "med" && v !== "high") return "tag levels are low, med or high";
    }
  }
  if (!DRAFT_SOURCES.includes(b.source)) return "source must be description, link, screenshot or photo";
  if (b.sourceRef !== undefined && (typeof b.sourceRef !== "string" || b.sourceRef.length > 300)) return "sourceRef must be <= 300 characters";
  if (b.unreadable !== undefined && (!Array.isArray(b.unreadable) || b.unreadable.length > 20 || b.unreadable.some((u) => typeof u !== "string" || u.length > 200))) return "unreadable must be up to 20 strings of <= 200 characters";
  if (b.cost !== undefined && (typeof b.cost !== "number" || !Number.isFinite(b.cost) || b.cost < 0)) return "cost must be a number >= 0";
  return null;
}

async function readDrafts(env) {
  let d = null;
  try { d = JSON.parse(await env.MP_KV.get("drafts")); } catch (e) {}
  return { updatedAt: (d && d.updatedAt) || null, drafts: d && Array.isArray(d.drafts) ? d.drafts : [] };
}

/** POST /drafts — matches ingredients to known keys, runs the hard exclusions, stores it. Never touches the library. */
async function postDraft(request, env) {
  let body;
  try { body = JSON.parse(await request.text()); } catch (e) { return json(400, "invalid JSON"); }
  const bad = draftError(body);
  if (bad) return json(400, bad);
  const store = await readDrafts(env);
  if (store.drafts.length >= MAX_DRAFTS) return json(409, "too many drafts");
  const keys = globalThis.MP.knownKeys(TAGS.tags, PACK_DATA.items);
  const now = new Date().toISOString();
  const draft = { id: "draft-" + Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => x.toString(16).padStart(2, "0")).join(""), createdAt: now, ...body };
  draft.ingredients = globalThis.MP.matchDraftIngredients(body.ingredients, keys);
  const ex = Exclusions.check(globalThis.MP.draftToMeal(draft, {}));
  if (!ex.ok) return json(422, { error: "excluded meal", reasons: ex.reasons });
  await env.MP_KV.put("drafts", JSON.stringify({ updatedAt: now, drafts: [draft, ...store.drafts] }));
  return json(201, { id: draft.id, unmatched: draft.ingredients.filter((i) => i.key === null).map((i) => i.name) });
}

async function deleteDraft(env, id) {
  const store = await readDrafts(env);
  if (!store.drafts.some((d) => d.id === id)) return json(404, "unknown draft");
  await env.MP_KV.put("drafts", JSON.stringify({ updatedAt: new Date().toISOString(), drafts: store.drafts.filter((d) => d.id !== id) }));
  return json(204);
}

/** The library KV value (object or bare array), or null. */
async function readLibrary(env) {
  try { return JSON.parse(await env.MP_KV.get("library")); } catch (e) { return null; }
}

/** GET /why?meal=&day=&slot= — why a meal sits where it does for a slot, from the same inputs as /ranking. */
async function why(params, env) {
  const day = Number(params.get("day"));
  if (!Number.isInteger(day) || day < 1 || day > 14) return json(400, "day must be 1-14");
  const slot = params.get("slot") || "dinner";
  if (!SLOT_TYPES.includes(slot)) return json(400, "slot must be breakfast, lunch, dinner or snack");
  const c = await slotContext(day, slot, env);
  if (c.err) return c.err;
  const mealId = params.get("meal") || "";
  const m = c.byId[mealId];
  if (!m) return json(404, "unknown meal");
  const i = c.ranked.findIndex((x) => x.id === mealId);
  return json(200, { mealId, rank: i < 0 ? null : i + 1, reasons: rankingReasons(m, day, c), approximate: true });
}

/** GET /scale?meal=&portions= — a meal scaled to N portions, the shortfall against the pantry, cook time and leftover storage. */
async function scale(params, env) {
  const raw = params.get("portions");
  const portions = /^\d+$/.test(raw || "") ? Number(raw) : NaN;
  if (!(portions >= 1 && portions <= 12)) return json(400, "portions must be an integer 1-12");
  const parse = (r) => { try { return JSON.parse(r); } catch (e) { return null; } };
  const lib = await readLibrary(env);
  const meals = Array.isArray(lib) ? lib : lib && Array.isArray(lib.meals) ? lib.meals : null;
  const meal = meals && meals.find((m) => m.id === params.get("meal"));
  if (!meal) return json(404, "unknown meal");
  const pantry = parse(await env.MP_KV.get("pantry"));
  const lines = ShoppingList.scaleMeal(meal, portions);
  const steps = Array.isArray(meal.method) ? meal.method.filter((s) => typeof s.minutes === "number") : [];
  const cat = SHELF_DATA.cooked_leftovers;
  return json(200, {
    mealId: meal.id, portions, servings: meal.servings || 1, lines,
    ...ShoppingList.scaleShortfall(lines, pantry && Array.isArray(pantry.items) ? pantry : null),
    cookTime: steps.length ? { minutes: steps.reduce((n, s) => n + s.minutes, 0), prepEffort: meal.prepEffort || null } : null,
    storage: portions > 1 && cat ? { fridgeDays: cat.fridgeDays, freezerMonths: cat.frozenMonths, estimate: true } : null,
  });
}

/** GET /ratings */
async function getRatings(env) {
  let r = null;
  try { r = JSON.parse(await env.MP_KV.get("ratings")); } catch (e) {}
  return json(200, { meals: (r && r.meals) || {} });
}

/** PUT /meal/:id/rating — merges any of {rating, note, never} into that meal's record, server stamps `at`. */
async function putMealRating(request, env, mealId) {
  let body;
  try { body = JSON.parse(await request.text()); } catch (e) { return json(400, "invalid JSON"); }
  const bad = Ratings.patchError(body);
  if (bad) return json(400, bad);
  const lib = await readLibrary(env);
  const meals = Array.isArray(lib) ? lib : lib && Array.isArray(lib.meals) ? lib.meals : null;
  if (!meals || !meals.some((m) => m.id === mealId)) return json(404, "unknown meal");
  let r = null;
  try { r = JSON.parse(await env.MP_KV.get("ratings")); } catch (e) {}
  const all = (r && r.meals) || {};
  all[mealId] = Ratings.applyPatch(all[mealId], body, new Date().toISOString());
  await env.MP_KV.put("ratings", JSON.stringify({ meals: all }));
  return json(200, all[mealId]);
}

/** GET /meal/:id/method — steps for cooking mode; ingredients always, so a meal with no method falls back to them. */
async function mealMethod(env, mealId) {
  const lib = await readLibrary(env);
  const meals = Array.isArray(lib) ? lib : lib && Array.isArray(lib.meals) ? lib.meals : null;
  const meal = meals && meals.find((m) => m.id === mealId);
  if (!meal) return json(404, "unknown meal");
  const steps = Array.isArray(meal.method) ? meal.method : [];
  return json(200, {
    mealId: meal.id, name: meal.name,
    status: steps.length ? (meal.methodStatus === "drafted" ? "drafted" : "accepted") : "none",
    steps, ingredients: (meal.ingredients || []).map((i) => ({ key: i.key, qty: i.qty })),
  });
}

/** PUT /meal-method — the assistant's one meal write: sets method + "drafted", never touches another field, never over an accepted one. */
async function putMealMethod(request, env, who, dryRun) {
  let body;
  try { body = JSON.parse(await request.text()); } catch (e) { return json(400, "invalid JSON"); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return json(400, "expected a JSON object");
  if (Object.keys(body).some((k) => k !== "mealId" && k !== "method")) return json(400, "unknown key");
  if (typeof body.mealId !== "string" || !body.mealId) return json(400, "mealId required");
  const reason = methodError(body.method);
  if (reason) return json(400, reason);
  const lib = await readLibrary(env);
  const meals = Array.isArray(lib) ? lib : lib && Array.isArray(lib.meals) ? lib.meals : null;
  const meal = meals && meals.find((m) => m.id === body.mealId);
  if (!meal) return json(404, "unknown meal");
  if (Array.isArray(meal.method) && meal.method.length && meal.methodStatus !== "drafted") return json(409, "method already accepted");
  const was = JSON.parse(JSON.stringify(lib));
  meal.method = body.method;
  meal.methodStatus = "drafted";
  if (!Array.isArray(lib)) lib.updatedAt = new Date().toISOString(); // so the app's last-write-wins pull picks it up
  const changes = diffItems("library", was, lib);
  if (dryRun) return json(200, { changes, summary: summarize("library", changes) });
  await env.MP_KV.put("library", JSON.stringify(lib));
  if (who) await logWrite(env, { who, key: "library", why: reasonOf(request), changes });
  return json(200, { mealId: meal.id, status: "drafted" });
}

/** @param {any} parsed  the already-JSON.parsed PUT body
 *  @returns {string|null}  an error reason, or null if the body is acceptable */
function mealsError(parsed) {
  if (!Array.isArray(parsed.meals)) return "meals must be an array";
  const seenIds = new Set();
  for (const meal of parsed.meals) {
    if (typeof meal !== "object" || meal === null || Array.isArray(meal)) return "each meal must be an object";
    if (typeof meal.id !== "string" || !meal.id) return "each meal needs a non-empty id";
    if (typeof meal.name !== "string" || !meal.name) return "each meal needs a non-empty name";
    if (!Array.isArray(meal.ingredients)) return "each meal needs an ingredients array";
    if (meal.variants !== undefined) {
      if (!Array.isArray(meal.variants)) return "meal variants must be an array";
      const seenVariantIds = new Set();
      for (const v of meal.variants) {
        if (typeof v !== "object" || v === null || Array.isArray(v)) return "each variant must be an object";
        if (typeof v.id !== "string" || !v.id) return "each variant needs a non-empty id";
        if (typeof v.name !== "string" || !v.name) return "each variant needs a non-empty name";
        if (!Array.isArray(v.ingredients)) return "each variant needs an ingredients array";
        if (seenVariantIds.has(v.id)) return "duplicate variant id: " + v.id;
        seenVariantIds.add(v.id);
      }
    }
    if (seenIds.has(meal.id)) return "duplicate meal id: " + meal.id;
    seenIds.add(meal.id);
  }
  return null;
}

/** null when the qty is acceptable, else a reason string.
 *  Accepts: absent, free-text string, or { value, unit, raw }.
 *  @param {any} qty  @returns {string|null} */
function qtyError(qty) {
  if (qty === undefined || qty === null || typeof qty === "string") return null;
  if (typeof qty !== "object" || Array.isArray(qty)) return "qty must be a string or {value, unit, raw}";
  if (typeof qty.value !== "number" || !isFinite(qty.value) || qty.value < 0) return "qty.value must be a finite non-negative number";
  if (typeof qty.unit !== "string" || !qty.unit) return "qty.unit must be a non-empty string";
  if (typeof qty.raw !== "string" || !qty.raw) return "qty.raw must be a non-empty string";
  return null;
}

/** @param {any} parsed  the already-JSON.parsed PUT body
 *  @returns {string|null}  an error reason, or null if the body is acceptable */
function itemsError(parsed) {
  if (!Array.isArray(parsed.items)) return "items must be an array";
  const seenNames = new Set();
  for (const item of parsed.items) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return "each item must be an object";
    if (typeof item.name !== "string" || !item.name.trim()) return "each item needs a non-empty name";
    const key = item.name.trim().toLowerCase();
    if (seenNames.has(key)) return "duplicate pantry item: " + item.name;
    seenNames.add(key);
    const qErr = qtyError(item.qty);
    if (qErr) return qErr;
    if (item.out != null && typeof item.out !== "boolean") return "out must be a boolean";
    if (item.useBy != null && !ShelfLife.isIsoDate(item.useBy)) return "useBy must be YYYY-MM-DD";
    if (item.storage != null && !ShelfLife.STORAGES.includes(item.storage)) return "storage must be fridge, freezer or cupboard";
  }
  return null;
}

/** @param {any} parsed  @returns {string|null} */
function planError(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "expected an object";
  if (!Array.isArray(parsed.days)) return "days must be an array";
  for (const d of parsed.days) {
    if (typeof d !== "object" || d === null || Array.isArray(d)) return "each day must be an object";
    if (typeof d.day !== "number") return "each day needs a numeric day";
    if (typeof d.slots !== "object" || d.slots === null || Array.isArray(d.slots)) return "each day needs a slots object";
  }
  return null;
}

/** @param {any} parsed  @returns {string|null} */
function placementsError(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "expected an object";
  if (!Array.isArray(parsed.placements)) return "placements must be an array";
  for (const p of parsed.placements) {
    if (typeof p !== "object" || p === null || Array.isArray(p)) return "each placement must be an object";
    if (typeof p.mealId !== "string" || !p.mealId) return "each placement needs a non-empty mealId";
    if (typeof p.day !== "number" || p.day < 1 || p.day > 14) return "each placement needs day 1-14";
    if (!SLOT_TYPES.includes(p.slot)) return "each placement needs a valid slot";
  }
  return null;
}

/** @param {any} parsed  @returns {string|null} */
function prefsError(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "expected an object";
  if (typeof parsed.prefs !== "object" || parsed.prefs === null || Array.isArray(parsed.prefs)) return "prefs must be a plain object";
  return null;
}

/** Shape-only. Chip ids are deliberately NOT checked against
 *  plan-preferences.json — a vocabulary edit must never lock out a write.
 *  @param {any} parsed  @returns {string|null} */
function planPrefsError(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "expected an object";
  if (typeof parsed.updatedAt !== "string" || isNaN(Date.parse(parsed.updatedAt))) return "updatedAt must be an ISO date string";
  if (!Array.isArray(parsed.busyDays) || !parsed.busyDays.every((d) => Number.isInteger(d) && d >= 1 && d <= 14)) {
    return "busyDays must be integers 1-14";
  }
  if (!Array.isArray(parsed.chips) || !parsed.chips.every((c) => typeof c === "string")) return "chips must be an array of strings";
  if (parsed.freezeBatches !== undefined && typeof parsed.freezeBatches !== "boolean") return "freezeBatches must be a boolean";
  if (parsed.repeatGap !== undefined && !(Number.isInteger(parsed.repeatGap) && parsed.repeatGap >= 0 && parsed.repeatGap <= 14)) return "repeatGap must be an integer 0-14";
  return null;
}

/** Assistant-written; keyed by ISO date. Bounded so the blob cannot grow.
 *  @param {any} parsed  @returns {string|null} */
function dayHintsError(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "expected an object";
  if (typeof parsed.updatedAt !== "string" || isNaN(Date.parse(parsed.updatedAt))) return "updatedAt must be an ISO date string";
  const days = parsed.days;
  if (typeof days !== "object" || days === null || Array.isArray(days)) return "days must be an object";
  const dates = Object.keys(days);
  if (dates.length > 28) return "at most 28 dates";
  for (const d of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d))) return "bad date key: " + d;
    const h = days[d];
    if (typeof h !== "object" || h === null || Array.isArray(h)) return "hint must be an object";
    if (!["busy", "normal", "free"].includes(h.effort)) return "effort must be busy, normal or free";
    if (h.why !== undefined && (typeof h.why !== "string" || h.why.length > 80)) return "why must be a string of at most 80 chars";
  }
  return null;
}

/** Today's one-tap counters (Phase 41). @param {any} parsed  @returns {string|null} */
function todayError(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "expected an object";
  if (typeof parsed.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) || isNaN(Date.parse(parsed.date))) return "date must be YYYY-MM-DD";
  for (const f of ["water", "caffeine"]) {
    if (!Number.isInteger(parsed[f]) || parsed[f] < 0 || parsed[f] > 99) return f + " must be an integer 0..99";
  }
  if (typeof parsed.gym !== "boolean") return "gym must be a boolean";
  if (!Array.isArray(parsed.routineDone) || parsed.routineDone.some((i) => typeof i !== "string")) return "routineDone must be an array of strings";
  return null;
}

/** @param {any} parsed  the already-JSON.parsed PUT body (a bare array, D1)
 *  @returns {string|null} */
function eatenLogError(parsed) {
  if (!Array.isArray(parsed)) return "expected an array";
  if (parsed.length > 200) return "at most 200 entries";
  const seenIds = new Set();
  const ALLOWED_KEYS = new Set(["id", "mealId", "name", "eatenAt", "tags"]);
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return "each entry must be an object";
    for (const key of Object.keys(entry)) {
      if (!ALLOWED_KEYS.has(key)) return "unknown entry key: " + key;
    }
    for (const field of ["id", "mealId", "name", "eatenAt"]) {
      if (typeof entry[field] !== "string" || !entry[field]) return "each entry needs a non-empty " + field;
    }
    if (!Array.isArray(entry.tags) || entry.tags.some((t) => typeof t !== "string")) {
      return "each entry needs a tags array of strings";
    }
    if (seenIds.has(entry.id)) return "duplicate entry id: " + entry.id;
    seenIds.add(entry.id);
  }
  return null;
}

/** @param {any} parsed  the PUT /cooks body (a bare array of cook records)  @returns {string|null} */
function cooksError(parsed) {
  if (!Array.isArray(parsed)) return "expected an array";
  if (parsed.length > 200) return "at most 200 records";
  for (const r of parsed) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) return "each record must be an object";
    for (const f of ["id", "mealId", "name", "cookedAt"]) if (typeof r[f] !== "string" || !r[f]) return "each record needs a non-empty " + f;
    if (!Number.isInteger(r.portionsLeft) || r.portionsLeft < 0) return "portionsLeft must be an integer >= 0";
    if (r.storage != null && r.storage !== "fridge" && r.storage !== "freezer") return "storage must be fridge or freezer";
  }
  return null;
}

const PRODUCT_PER = ["100g", "100ml"];
const PRODUCT_BASES = ["label", "off", "cofid", "usda", "estimate"];

/** GS1 mod-10. Duplicated from products.js (the Worker can't import it without the shim). */
function validBarcode(d) {
  if (!/^\d+$/.test(d) || ![8, 12, 13, 14].includes(d.length)) return false;
  let sum = 0;
  for (let i = 0; i < d.length - 1; i++) sum += Number(d[d.length - 2 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(d[d.length - 1]);
}

/** Shape only. @param {any} parsed @returns {string|null} */
function productsError(parsed) {
  if (!Array.isArray(parsed.products)) return "products must be an array";
  if (parsed.products.length > 2000) return "too many products";
  const ids = new Set();
  for (const p of parsed.products) {
    if (typeof p !== "object" || p === null || Array.isArray(p)) return "each product must be an object";
    if (typeof p.id !== "string" || !p.id) return "each product needs a non-empty id";
    if (ids.has(p.id)) return "duplicate product id: " + p.id;
    ids.add(p.id);
    if (typeof p.name !== "string" || !p.name.trim()) return "each product needs a non-empty name";
    if (!PRODUCT_PER.includes(p.per)) return "per must be 100g or 100ml";
    if (p.barcode != null && (typeof p.barcode !== "string" || !validBarcode(p.barcode))) return "invalid barcode: " + p.barcode;
    if (p.barcode != null && p.id !== p.barcode) return "id must equal barcode";
    if (typeof p.updatedAt !== "string" || !Number.isFinite(Date.parse(p.updatedAt))) return "updatedAt must be an ISO string";
    const n = p.nutrients == null ? {} : p.nutrients;
    if (typeof n !== "object" || Array.isArray(n)) return "nutrients must be an object";
    for (const [key, e] of Object.entries(n)) {
      if (!/^[a-z0-9_]+$/.test(key)) return "bad nutrient key: " + key;
      if (typeof e !== "object" || e === null) return "nutrient entry must be an object: " + key;
      if (typeof e.value !== "number" || !Number.isFinite(e.value) || e.value < 0) return "nutrient value must be a finite number >= 0: " + key;
      if (!PRODUCT_BASES.includes(e.basis)) return "unknown basis for " + key;
    }
  }
  return null;
}

/** @param {any} parsed  @returns {string|null} */
function planDraftError(parsed) {
  if (typeof parsed.id !== "string" || !parsed.id) return "id must be a non-empty string";
  if (typeof parsed.pending !== "boolean") return "pending must be a boolean";
  if (parsed.changes !== undefined && !Array.isArray(parsed.changes)) return "changes must be an array";
  return null;
}

const VALIDATE = {
  products: productsError,
  library: mealsError,
  pantry: itemsError,
  shopping: shoppingError,
  planFlag: null,
  plan: planError,
  placements: placementsError,
  prefs: prefsError,
  eatenLog: eatenLogError,
  cooks: cooksError,
  planPrefs: planPrefsError,
  eatRequests: eatRequestsError,
  dayHints: dayHintsError,
  today: todayError,
  planDraft: planDraftError,
};


// Phase 48: activity log. Every assistant write (and every undo) appends one
// entry of per-item before/after pairs to the `activity` KV key.
const ITEMS = {
  pantry: ["items", (i) => ShoppingList.normalizeKey(i.name)],
  shopping: ["lines", (l) => l.id],
  library: ["meals", (m) => m.id],
  products: ["products", (p) => p.id],
  eatRequests: ["requests", (r) => r.id],
  placements: ["placements", (p) => `${p.day}:${p.slot}:${p.mealId}`],
  dayHints: ["days", null], // object map: item id = date key
  today: [null], planFlag: [null], planDraft: [null], // whole value is one item, id = key name
};
const ACTIVITY_CAP = 200;

// Phase 56: the one list of Worker routes. worker/routes.json is generated from it (tools/routes_build.mjs) and
// tools/worker_test.mjs probes the real dispatcher against it, so docs/HERMES.md can't drift from the code.
// { method, path, assistant, kind: read|write|queue, dryRun?, log?: logged|unlogged, why?, appSide?, note? }
const APP_SIDE = new Set(["/library", "/pantry", "/plan", "/planFlag", "/placements", "/prefs", "/eaten-log", "/planPrefs", "/cooks"]);
const UNLOGGED = {
  "/plan": "app-owned mirror", "/prefs": "app-owned mirror", "/eaten-log": "app-owned mirror", "/planPrefs": "app-owned mirror",
  "/cooks": "app-owned mirror", "/settings": "profile data, not an everyday edit",
};
const row = (method, path, kind, o = {}) => ({ method, path, assistant: ASSISTANT_ALLOWED.has(`${method} ${path}`), kind, ...o, ...(APP_SIDE.has(path) ? { appSide: true } : {}) });
const quiet = (why) => ({ log: "unlogged", why });
export const ROUTES = [
  ...["/discover", "/ranking", "/nutrition", "/day", "/expiring", "/cookable", "/leftovers", "/quick", "/substitutions", "/product-ranking", "/ratings", "/why", "/scale", "/shopping", "/shopping/lines", "/adhoc", "/drafts", "/activity"]
    .map((path) => row("GET", path, "read")),
  row("GET", "/meal/:id/method", "read", { assistant: true }),
  ...Object.entries(KEYS).flatMap(([path, key]) => {
    const kind = key === "eatRequests" ? "queue" : "read";
    return [row("GET", path, kind), row("PUT", path, kind === "queue" ? kind : "write", ITEMS[key] ? { dryRun: true, log: "logged" } : quiet(UNLOGGED[path] || "inert"))];
  }),
  row("PUT", "/adhoc", "write", { dryRun: true, log: "logged" }),
  row("POST", "/shopping/lines", "write", { log: "logged" }),
  row("PUT", "/meal-method", "write", { dryRun: true, log: "logged" }),
  row("PUT", "/meal/:id/rating", "write", { assistant: true, ...quiet("informational nudge, not planning data") }),
  row("POST", "/drafts", "write", quiet("inert until the app accepts")),
  row("DELETE", "/drafts/:id", "write", { assistant: true, ...quiet("inert until the app accepts") }),
  row("POST", "/plan/draft", "read", { note: "computes a draft, stores nothing" }),
  row("POST", "/plan/apply", "write", { log: "logged", note: "parks the draft in planDraft" }),
  row("POST", "/activity/undo", "write", { log: "logged" }),
];

function parseKV(raw) { try { return JSON.parse(raw); } catch (e) { return null; } }

/** Map of item id -> item for a stored value (a legacy bare-array library is the list itself). */
function itemMap(key, v) {
  const [field, idOf] = ITEMS[key];
  const m = new Map();
  if (v === null || v === undefined) return m;
  if (field === null) return m.set(key, v);
  const c = Array.isArray(v) ? v : v[field];
  if (idOf) for (const i of c || []) m.set(idOf(i), i);
  else for (const k of Object.keys(c || {})) m.set(k, c[k]);
  return m;
}

/** @returns {{id: string, before: any, after: any}[]} the items that differ (null = absent). */
function diffItems(key, beforeValue, afterValue) {
  const b = itemMap(key, beforeValue), a = itemMap(key, afterValue);
  const changes = [];
  for (const id of new Set([...b.keys(), ...a.keys()])) {
    if (JSON.stringify(b.get(id)) !== JSON.stringify(a.get(id))) changes.push({ id, before: b.get(id) ?? null, after: a.get(id) ?? null });
  }
  return changes;
}

function summarize(key, changes) {
  const part = (verb, list) => list.length ? `${verb} ${list.slice(0, 4).join(", ")}${list.length > 4 ? ` +${list.length - 4} more` : ""}` : "";
  const ids = (f) => changes.filter(f).map((c) => c.id);
  const bits = [part("changed", ids((c) => c.before && c.after)), part("added", ids((c) => !c.before)), part("removed", ids((c) => !c.after))];
  return `${key}: ${bits.filter(Boolean).join(", ")}`;
}

async function readActivity(env) {
  const v = parseKV(await env.MP_KV.get("activity"));
  return v && Array.isArray(v.entries) ? v.entries : [];
}

/** Append one entry (newest first, capped); null when nothing changed (undo entries always log). */
async function logWrite(env, { who, key, why, changes, undoes }) {
  if (!changes.length && !undoes) return null;
  const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), who, key, why: why || "", summary: summarize(key, changes), changes };
  if (undoes) entry.undoes = undoes;
  // ponytail: read-modify-write, two concurrent writes can lose one log line; Durable Object if it ever bites.
  const entries = [entry, ...(await readActivity(env))].slice(0, ACTIVITY_CAP);
  await env.MP_KV.put("activity", JSON.stringify({ entries }));
  return entry;
}

const reasonOf = (request) => (request.headers.get("X-Reason") || "").trim().slice(0, 120);

/** The stored value with each change's `before` put back (null = remove the item). */
function restore(key, current, changes) {
  const [field, idOf] = ITEMS[key];
  if (field === null) return changes[0].before;
  if (key === "shopping") {
    // Restamp to now, else the restored lines would lose last-write-wins at once; an undone add becomes a tombstone.
    const nowIso = new Date().toISOString();
    const byId = new Map(((current && current.lines) || []).map((l) => [l.id, l]));
    for (const c of changes) byId.set(c.id, c.before ? { ...c.before, updatedAt: nowIso } : { ...c.after, state: "deleted", updatedAt: nowIso });
    return { updatedAt: nowIso, lines: [...byId.values()] };
  }
  const out = Array.isArray(current) ? [...current] : { ...(current || {}) };
  if (idOf) {
    const list = [...(Array.isArray(current) ? current : (current && current[field]) || [])];
    for (const c of changes) {
      const i = list.findIndex((x) => idOf(x) === c.id);
      if (c.before === null) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = c.before; else list.push(c.before);
    }
    if (Array.isArray(current)) return list;
    out[field] = list;
  } else {
    const map = { ...((current && current[field]) || {}) };
    for (const c of changes) { if (c.before === null) delete map[c.id]; else map[c.id] = c.before; }
    out[field] = map;
  }
  if (typeof out.updatedAt === "string") out.updatedAt = new Date().toISOString(); // so the app's last-write-wins pulls take it
  return out;
}

async function undoActivity(env, who, { id, force }) {
  const entries = await readActivity(env);
  const entry = entries.find((e) => e.id === id);
  if (!entry || !ITEMS[entry.key]) return json(404, "unknown entry");
  if (entries.some((e) => e.undoes === id)) return json(409, { error: "already undone" });
  const current = parseKV(await env.MP_KV.get(entry.key));
  const now = itemMap(entry.key, current);
  const changed = entry.changes.filter((c) => JSON.stringify(now.get(c.id) ?? null) !== JSON.stringify(c.after)).map((c) => ({ id: c.id, now: now.get(c.id) ?? null }));
  if (changed.length && !force) return json(409, { error: "changed since", changed });
  const restored = restore(entry.key, current, entry.changes);
  const validate = VALIDATE[entry.key];
  const reason = validate && restored !== null && !Array.isArray(restored) ? validate(restored) : null;
  if (reason) return json(409, { error: reason });
  await env.MP_KV.put(entry.key, JSON.stringify(restored));
  const logged = await logWrite(env, { who, key: entry.key, why: "", changes: diffItems(entry.key, current, restored), undoes: id });
  return json(200, { undone: id, entry: logged.id });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // ponytail: plain string compare, not constant-time — a remote timing
    // attack against a random token isn't this app's threat model.
    const token = request.headers.get("X-Auth-Token");
    const url = new URL(request.url);
    const isHermes = !!env.AUTH_TOKEN && token === env.AUTH_TOKEN;
    const isAssistant = !!env.ASSISTANT_TOKEN && token === env.ASSISTANT_TOKEN;
    if (!isHermes && !isAssistant) return json(401, "unauthorized");
    // Who is writing, for the activity log: the assistant token always; Hermes's shared token only when it sends X-Actor: hermes.
    const actor = isAssistant && !isHermes ? "assistant" : isHermes && request.headers.get("X-Actor") === "hermes" ? "hermes" : null;
    const methodMatch = METHOD_PATH.exec(url.pathname);
    if (!isHermes && !(request.method === "GET" && methodMatch) && !(request.method === "PUT" && RATING_PATH.test(url.pathname)) && !(request.method === "DELETE" && DRAFT_PATH.test(url.pathname)) && !ASSISTANT_ALLOWED.has(`${request.method} ${url.pathname}`)) return json(403, "forbidden");

    const draftMatch = DRAFT_PATH.exec(url.pathname);
    if (draftMatch) {
      if (request.method !== "DELETE") return json(405, "method not allowed");
      return deleteDraft(env, decodeURIComponent(draftMatch[1]));
    }
    if (url.pathname === "/drafts") {
      if (request.method === "POST") return postDraft(request, env);
      if (request.method !== "GET") return json(405, "method not allowed");
      return json(200, await readDrafts(env));
    }
    const ratingMatch = RATING_PATH.exec(url.pathname);
    if (ratingMatch) {
      if (request.method !== "PUT") return json(405, "method not allowed");
      return putMealRating(request, env, decodeURIComponent(ratingMatch[1]));
    }
    if (url.pathname === "/settings") {
      if (request.method === "PUT") return putSettings(request, env);
      if (request.method !== "GET") return json(405, "method not allowed");
      return json(200, (await readSettings(env)) || {});
    }
    if (url.pathname === "/ratings") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return getRatings(env);
    }
    if (url.pathname === "/scale") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return scale(url.searchParams, env);
    }
    if (url.pathname === "/why") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return why(url.searchParams, env);
    }

    if (methodMatch) {
      if (request.method !== "GET") return json(405, "method not allowed");
      return mealMethod(env, decodeURIComponent(methodMatch[1]));
    }
    if (url.pathname === "/meal-method") {
      if (request.method !== "PUT") return json(405, "method not allowed");
      return putMealMethod(request, env, actor, url.searchParams.get("dryRun") === "1");
    }

    const who = actor || "app";
    if (url.pathname === "/activity") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return json(200, { entries: await readActivity(env) });
    }
    if (url.pathname === "/activity/undo") {
      if (request.method !== "POST") return json(405, "method not allowed");
      let b;
      try { b = JSON.parse(await request.text()); } catch (e) { return json(400, "invalid JSON"); }
      if (typeof b !== "object" || b === null || typeof b.id !== "string" || !b.id) return json(400, "id required");
      return undoActivity(env, who, { id: b.id, force: b.force === true && !actor }); // force ("Undo anyway") is the app's call, never an identified actor's
    }

    if (url.pathname === "/plan/draft" || url.pathname === "/plan/apply") {
      if (request.method !== "POST") return json(405, "method not allowed");
      let b;
      try { b = JSON.parse(await request.text()); } catch (e) { return json(400, "invalid JSON"); }
      return url.pathname === "/plan/draft" ? draftPlan(b, env) : applyDraft(b, env, who);
    }

    if (url.pathname === "/discover") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return discover(url.searchParams.get("q"), Nutrition.profileOf(await readSettings(env))?.hard || []);
    }

    if (url.pathname === "/ranking") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return ranking(url.searchParams, env);
    }

    if (url.pathname === "/nutrition") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return nutrition(url.searchParams, env);
    }

    if (url.pathname === "/day") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return day(url.searchParams, env);
    }

    if (url.pathname === "/expiring") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return expiring(url.searchParams, env);
    }

    const READ_ROUTES = { "/cookable": cookable, "/leftovers": leftovers, "/quick": quick };
    if (READ_ROUTES[url.pathname]) {
      if (request.method !== "GET") return json(405, "method not allowed");
      return READ_ROUTES[url.pathname](url.searchParams, env);
    }
    if (url.pathname === "/substitutions") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return json(200, SUB_GROUPS);
    }

    if (url.pathname === "/product-ranking") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return productRanking(env);
    }

    if (url.pathname === "/shopping/lines") {
      if (request.method === "POST") return postLines(request, env, who);
      if (request.method !== "GET") return json(405, "method not allowed");
      return json(200, await readShopping(env));
    }
    if (url.pathname === "/adhoc") return adhocShim(request, env, who, url.searchParams.get("dryRun") === "1");

    if (url.pathname === "/shopping") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return shopping(env);
    }

    const kvKey = KEYS[url.pathname];
    if (!kvKey) return json(404, "not found");

    if (request.method === "GET") {
      const value = await env.MP_KV.get(kvKey);
      return new Response(value ?? "null", { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
    }

    if (request.method === "PUT") {
      const body = await request.text();
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        return json(400, "invalid JSON");
      }
      // eaten-log is the one key whose wire shape is a bare array (D1); every
      // other key stays an object.
      if (kvKey === "eatenLog" || kvKey === "cooks") {
        if (!Array.isArray(parsed)) return json(400, "expected a JSON array");
      } else if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return json(400, "expected a JSON object");
      }
      // Shape only, no exclusion checks — sanitize() runs on the way in from
      // TheMealDB; running check() here would let a rule tweak lock the user
      // out of saving their own existing library.
      const validate = VALIDATE[kvKey];
      if (validate) {
        const reason = validate(parsed);
        if (reason) return json(400, reason);
      }
      // The assistant's library writes are append only: every existing meal must
      // come back unchanged. The one exception: it may drop a meal it added itself
      // (addedBy "assistant"), so Undo of an add works.
      if (kvKey === "library" && !isHermes) {
        let cur = [];
        try { cur = JSON.parse((await env.MP_KV.get("library")) || "{}").meals || []; } catch (e) { cur = []; }
        const next = new Map(parsed.meals.map((m) => [m.id, JSON.stringify(m)]));
        if (cur.some((m) => next.get(m.id) !== JSON.stringify(m) && !(next.get(m.id) === undefined && m.addedBy === "assistant"))) return json(403, "assistant library writes are append only");
      }
      const dryRun = url.searchParams.get("dryRun") === "1";
      if (dryRun && !ITEMS[kvKey]) return json(400, "dryRun not supported for this key");
      const logIt = ITEMS[kvKey] && actor;
      let changes = [];
      if (dryRun || logIt) {
        changes = diffItems(kvKey, parseKV(await env.MP_KV.get(kvKey)), parsed);
        if (dryRun) return json(200, { changes, summary: summarize(kvKey, changes) });
      }
      await env.MP_KV.put(kvKey, body);
      if (logIt) await logWrite(env, { who: actor, key: kvKey, why: reasonOf(request), changes });
      return new Response(null, { status: 204, headers: CORS });
    }

    return json(405, "method not allowed");
  },
};
