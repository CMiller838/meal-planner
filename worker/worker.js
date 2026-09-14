// Hermes bridge: a generic key relay over KV (library, planFlag, pantry,
// adhoc), plus a read-only /discover route onto TheMealDB. No router, no
// framework, and no growth into a general "any key" API.
import "../exclusions.js";
import "../mealdb.js";
import "../nutrition.js";
import "../generator.js";
import SUBS from "../substitutions.json";
import TAGS from "../ingredient-nutrient-tags.json";
import TARGETS from "../nutrition-targets.json";
import PLAN_VOCAB from "../plan-preferences.json";

const Exclusions = globalThis.MP.Exclusions;
const MealDB = globalThis.MP.MealDB;
const Nutrition = globalThis.MP.Nutrition;
const Generator = globalThis.MP.Generator;

const KEYS = {
  "/library": "library", "/planFlag": "planFlag", "/pantry": "pantry", "/adhoc": "adhoc",
  "/plan": "plan", "/placements": "placements", "/prefs": "prefs",
  "/eaten-log": "eatenLog", "/planPrefs": "planPrefs",
};
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

  const [libraryRaw, planRaw, prefsRaw] = await Promise.all([
    env.MP_KV.get("library"), env.MP_KV.get("plan"), env.MP_KV.get("planPrefs"),
  ]);

  let library, plan;
  try {
    library = JSON.parse(libraryRaw);
    plan = JSON.parse(planRaw);
  } catch (e) {
    return json(409, "library and plan must be synced first");
  }
  if (!Array.isArray(library) || library.length === 0 || !plan || !Array.isArray(plan.days)) {
    return json(409, "library and plan must be synced first");
  }

  let planPrefs;
  try {
    planPrefs = JSON.parse(prefsRaw) || {};
  } catch (e) {
    planPrefs = {};
  }

  const dayObj = plan.days[day - 1] || { slots: {} };
  const slotVal = dayObj.slots[slot] || null;
  const byId = Object.fromEntries(library.map((m) => [m.id, m]));
  const others = SLOT_TYPES.filter((s) => s !== slot)
    .map((s) => dayObj.slots[s] && byId[dayObj.slots[s].mealId])
    .filter(Boolean);
  const prefs = { vocab: PLAN_VOCAB, busyDays: planPrefs.busyDays || [], chips: planPrefs.chips || [] };
  const pool = library.filter((m) => (m.mealTypes || []).includes(slot));
  const ranked = Generator.rankSlot(pool, day, others, { tags: TAGS, targets: TARGETS, prefs });

  const gap = Nutrition.dayCoverage(others, TAGS, TARGETS);
  const shortOn = [...gap.missing, ...gap.partial];
  const { prefer, avoid } = Generator.activeChips(prefs);
  const chips = prefer.concat(avoid);

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
    busyDay: (planPrefs.busyDays || []).includes(day),
    approximate: true,
  });
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

const VALIDATE = {
  library: mealsError,
  pantry: itemsError,
  adhoc: itemsError,
  planFlag: null,
  plan: planError,
  placements: placementsError,
  prefs: prefsError,
  eatenLog: eatenLogError,
  planPrefs: planPrefsError,
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // ponytail: plain string compare, not constant-time — a remote timing
    // attack against a random token isn't this app's threat model.
    if (request.headers.get("X-Auth-Token") !== env.AUTH_TOKEN) return json(401, "unauthorized");

    const url = new URL(request.url);

    if (url.pathname === "/discover") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return discover(url.searchParams.get("q"));
    }

    if (url.pathname === "/ranking") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return ranking(url.searchParams, env);
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
      await env.MP_KV.put(kvKey, body);
      return new Response(null, { status: 204, headers: CORS });
    }

    return json(405, "method not allowed");
  },
};
