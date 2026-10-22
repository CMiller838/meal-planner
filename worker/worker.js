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

const KEYS = {
  "/library": "library", "/planFlag": "planFlag", "/pantry": "pantry", "/adhoc": "adhoc",
  "/plan": "plan", "/placements": "placements", "/prefs": "prefs",
  "/eaten-log": "eatenLog", "/planPrefs": "planPrefs", "/eat-requests": "eatRequests",
  "/dayHints": "dayHints", "/today": "today", "/products": "products",
};
// The personal assistant's own token (ASSISTANT_TOKEN, never Hermes's
// AUTH_TOKEN) reaches only these method+path pairs: read the plan side, queue
// "I ate X" requests, everyday edits (lists, plan flag, placements), and append-
// only library adds (see the PUT /library check). Everything else answers 403.
const ASSISTANT_ALLOWED = new Set([
  "GET /library", "GET /plan", "GET /eaten-log", "GET /shopping", "GET /eat-requests", "PUT /eat-requests",
  "GET /discover", "GET /pantry", "PUT /pantry", "GET /adhoc", "PUT /adhoc", "PUT /planFlag",
  "GET /placements", "PUT /placements", "GET /prefs", "PUT /library", "GET /nutrition",
  "GET /dayHints", "PUT /dayHints", "PUT /meal-method", "GET /today", "PUT /today", "GET /products", "PUT /products",
  "GET /expiring", "GET /product-ranking", "GET /ratings", "GET /why", "GET /scale",
]);
const METHOD_PATH = /^\/meal\/([^/]+)\/method$/;
const RATING_PATH = /^\/meal\/([^/]+)\/rating$/;
const SLOT_TYPES = ["breakfast", "lunch", "dinner", "snack"];
const MEALDB_BASE = "https://www.themealdb.com/api/json/v1/1/";
const DISCOVER_LIMIT = 8;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
  "Access-Control-Max-Age": "86400",
};

function json(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function discover(q) {
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
    if (result) {
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
  const prefs = DayHints.merge({ vocab: PLAN_VOCAB, busyDays: planPrefs.busyDays || [], chips: planPrefs.chips || [] }, resolved);
  const hint = resolved.byDay[day] ? { effort: resolved.byDay[day].effort, why: resolved.byDay[day].why } : null;
  const pool = library.filter((m) => (m.mealTypes || []).includes(slot));
  const ranked = Generator.rankSlot(pool, day, others, { tags: TAGS, targets: TARGETS, prefs, ratings });

  const gap = Nutrition.dayCoverage(others, TAGS, TARGETS);
  const shortOn = [...gap.missing, ...gap.partial];
  const { prefer, avoid } = Generator.activeChips(prefs);
  return { library, slotVal, byId, prefs, ratings, ranked, shortOn, chips: prefer.concat(avoid), preferChips: prefer, hint };
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
    const g = Nutrition.weekGaps(log, byId, dates, TAGS, TARGETS, (e) => dayFmt.format(new Date(e.eatenAt)));
    return json(200, { from: dates[0], to: dates[dates.length - 1], nutrients: g.nutrients, notLogged: g.notLogged });
  }
  const gym = params.get("gym") === "1" && !!TARGETS.gymDay;
  const targets = gym ? Nutrition.withGymDay(TARGETS) : TARGETS;
  const eatenToday = log.filter((e) => dayFmt.format(new Date(e.eatenAt)) === date);
  const { cov, missing, partial } = Nutrition.eatenDayCoverage(eatenToday, byId, TAGS, targets);

  const planned = [];
  if (planRaw && Array.isArray(planRaw.days) && planRaw.startDate) {
    const start = Date.parse(planRaw.startDate + "T00:00:00Z");
    const idx = Math.round((Date.parse(date + "T00:00:00Z") - start) / 86400000);
    const day = planRaw.days.find((d) => d.day === idx + 1);
    for (const slot of SLOT_TYPES) {
      const v = day && day.slots && day.slots[slot];
      if (v && v.mealId && !v.eatenAt) planned.push({ slot, name: (byId[v.mealId] || {}).name || v.mealId });
    }
  }
  const short = cov.proteinGramsApprox < 0.8 * cov.proteinTarget;
  const swaps = short ? Nutrition.rankByGap(meals, ["protein"], TAGS).slice(0, 3).map((m) => ({ id: m.id, name: m.name })) : [];
  return json(200, {
    date, eaten: eatenToday.map((e) => e.name), planned,
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
  const [libraryRaw, planRaw, pantryRaw, adhocRaw] = await Promise.all([
    env.MP_KV.get("library"), env.MP_KV.get("plan"), env.MP_KV.get("pantry"), env.MP_KV.get("adhoc"),
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
  const adhoc = parse(adhocRaw);
  const mealsById = Object.fromEntries(meals.map((m) => [m.id, m]));
  return json(200, {
    updatedAt: plan.updatedAt || null,
    startDate: plan.startDate || null,
    lists: ShoppingList.buildLists(plan, mealsById, PACK_DATA, pantry && Array.isArray(pantry.items) ? pantry : null),
    adhoc: adhoc && Array.isArray(adhoc.items) ? adhoc.items : [],
  });
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
async function putMealMethod(request, env) {
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
  meal.method = body.method;
  meal.methodStatus = "drafted";
  if (!Array.isArray(lib)) lib.updatedAt = new Date().toISOString(); // so the app's last-write-wins pull picks it up
  await env.MP_KV.put("library", JSON.stringify(lib));
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

const VALIDATE = {
  products: productsError,
  library: mealsError,
  pantry: itemsError,
  adhoc: itemsError,
  planFlag: null,
  plan: planError,
  placements: placementsError,
  prefs: prefsError,
  eatenLog: eatenLogError,
  planPrefs: planPrefsError,
  eatRequests: eatRequestsError,
  dayHints: dayHintsError,
  today: todayError,
};

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
    const methodMatch = METHOD_PATH.exec(url.pathname);
    if (!isHermes && !(request.method === "GET" && methodMatch) && !(request.method === "PUT" && RATING_PATH.test(url.pathname)) && !ASSISTANT_ALLOWED.has(`${request.method} ${url.pathname}`)) return json(403, "forbidden");

    const ratingMatch = RATING_PATH.exec(url.pathname);
    if (ratingMatch) {
      if (request.method !== "PUT") return json(405, "method not allowed");
      return putMealRating(request, env, decodeURIComponent(ratingMatch[1]));
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
      return putMealMethod(request, env);
    }

    if (url.pathname === "/discover") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return discover(url.searchParams.get("q"));
    }

    if (url.pathname === "/ranking") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return ranking(url.searchParams, env);
    }

    if (url.pathname === "/nutrition") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return nutrition(url.searchParams, env);
    }

    if (url.pathname === "/expiring") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return expiring(url.searchParams, env);
    }

    if (url.pathname === "/product-ranking") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return productRanking(env);
    }

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
      if (kvKey === "eatenLog") {
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
      await env.MP_KV.put(kvKey, body);
      return new Response(null, { status: 204, headers: CORS });
    }

    return json(405, "method not allowed");
  },
};
