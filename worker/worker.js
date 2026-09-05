// Hermes bridge: a generic two-key relay over KV, plus a read-only
// /discover route onto TheMealDB. No router, no framework.
import "../exclusions.js";
import "../mealdb.js";
import SUBS from "../substitutions.json";

const Exclusions = globalThis.MP.Exclusions;
const MealDB = globalThis.MP.MealDB;

const KEYS = { "/library": "library", "/planFlag": "planFlag", "/pantry": "pantry" };
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

/** @param {any} parsed  the already-JSON.parsed PUT body
 *  @returns {string|null}  an error reason, or null if the body is acceptable */
function libraryError(parsed) {
  if (!Array.isArray(parsed.meals)) return "meals must be an array";
  const seenIds = new Set();
  for (const meal of parsed.meals) {
    if (typeof meal !== "object" || meal === null || Array.isArray(meal)) return "each meal must be an object";
    if (typeof meal.id !== "string" || !meal.id) return "each meal needs a non-empty id";
    if (typeof meal.name !== "string" || !meal.name) return "each meal needs a non-empty name";
    if (!Array.isArray(meal.ingredients)) return "each meal needs an ingredients array";
    if (seenIds.has(meal.id)) return "duplicate meal id: " + meal.id;
    seenIds.add(meal.id);
  }
  return null;
}

/** @param {any} parsed  the already-JSON.parsed PUT body
 *  @returns {string|null}  an error reason, or null if the body is acceptable */
function pantryError(parsed) {
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
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return json(400, "expected a JSON object");
      }
      // Shape only, no exclusion checks — sanitize() runs on the way in from
      // TheMealDB; running check() here would let a rule tweak lock the user
      // out of saving their own existing library.
      if (kvKey === "library") {
        const reason = libraryError(parsed);
        if (reason) return json(400, reason);
      }
      if (kvKey === "pantry") {
        const reason = pantryError(parsed);
        if (reason) return json(400, reason);
      }
      await env.MP_KV.put(kvKey, body);
      return new Response(null, { status: 204, headers: CORS });
    }

    return json(405, "method not allowed");
  },
};
