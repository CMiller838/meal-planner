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
import "../plan-chat.js";
import SHELF_DATA from "../shelf-life.json";
import SUBS from "../substitutions.json";
import SUB_GROUPS from "../substitution-groups.json";
import TAGS from "../ingredient-nutrient-tags.json";
import TARGETS from "../nutrition-targets.json";
import PLAN_VOCAB from "../plan-preferences.json";
import PACK_DATA from "../pack-sizes.json";
import FOOD from "../food-log.json";
import COFID from "../cofid.json";
import * as FoodLog from "./food-log.js";

const Exclusions = globalThis.MP.Exclusions;
const MealDB = globalThis.MP.MealDB;
const Nutrition = globalThis.MP.Nutrition;
const Generator = globalThis.MP.Generator;
const DayHints = globalThis.MP.DayHints;
const ShoppingList = globalThis.MP.ShoppingList;
const ShelfLife = globalThis.MP.ShelfLife;
const Products = globalThis.MP.Products;
const Ratings = globalThis.MP.Ratings;
const PlanChat = globalThis.MP.PlanChat;
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
  "GET /library", "GET /plan", "GET /eaten-log", "GET /shopping", "GET /swaps", "GET /eat-requests", "PUT /eat-requests",
  "GET /discover", "GET /pantry", "PUT /pantry", "GET /adhoc", "PUT /adhoc", "GET /shopping/lines", "POST /shopping/lines", "PUT /planFlag",
  "GET /placements", "PUT /placements", "GET /prefs", "PUT /library", "GET /nutrition",
  "GET /dayHints", "PUT /dayHints", "PUT /meal-method", "GET /today", "PUT /today", "GET /products", "PUT /products",
  "GET /expiring", "GET /day", "GET /product-ranking", "GET /ratings", "GET /why", "GET /scale", "GET /cookable", "GET /substitutions", "GET /leftovers", "GET /quick",
  "GET /drafts", "POST /drafts", "GET /settings", "PUT /settings", "GET /activity", "POST /activity/undo",
  "GET /spend", "POST /spend", "GET /pantry/audit", "GET /pantry/sanity", "POST /pantry/audit",
  "POST /plan/draft", "POST /plan/apply", "GET /planDraft", "POST /plan/reflow", "POST /plan/edit", "GET /food-log", "POST /food-log",
  "GET /notes", "PUT /notes",
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

const NOTE_MAX_ITEMS = 30, NOTE_MAX_PENDING = 10, NOTE_MAX_LEN = 200;

/** Phase 91: Notes.md bullets -> stored items. Trimmed, empties dropped, case-insensitive de-dupe; bad shape is an error. */
function normalizeNotes(body) {
  if (!body || !Array.isArray(body.items)) return { items: [], error: "items: expected an array of strings" };
  const items = [], seen = new Set();
  for (const raw of body.items) {
    if (typeof raw !== "string") return { items: [], error: "items: every note must be a string" };
    const t = raw.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    if (t.length > NOTE_MAX_LEN) return { items: [], error: `items: a note is over ${NOTE_MAX_LEN} characters` };
    seen.add(t.toLowerCase());
    items.push(t);
  }
  if (items.length > NOTE_MAX_ITEMS) return { items: [], error: `items: over ${NOTE_MAX_ITEMS} notes` };
  return { items };
}

async function readNotes(env) {
  const s = parseKV(await env.MP_KV.get("notes"));
  return s && typeof s === "object" && !Array.isArray(s)
    ? { updatedAt: s.updatedAt || null, items: Array.isArray(s.items) ? s.items : [], pending: Array.isArray(s.pending) ? s.pending : [] }
    : { updatedAt: null, items: [], pending: [] };
}

async function putNotes(request, env) {
  const text = await request.text();
  if (text.length > 8192) return json(400, "body: over 8 KB");
  let body;
  try { body = JSON.parse(text); } catch (e) { return json(400, "invalid JSON"); }
  const r = normalizeNotes(body);
  if (r.error) return json(400, r.error);
  const cur = await readNotes(env);
  const have = new Set(r.items.map((t) => t.toLowerCase()));
  const doc = { updatedAt: new Date().toISOString(), items: r.items, pending: cur.pending.filter((p) => !have.has(String(p.text).toLowerCase())) };
  await env.MP_KV.put("notes", JSON.stringify(doc));
  return json(200, { ok: true, ...doc });
}

async function postNotePending(request, env) {
  const text = await request.text();
  if (text.length > 8192) return json(400, "body: over 8 KB");
  let body;
  try { body = JSON.parse(text); } catch (e) { return json(400, "invalid JSON"); }
  const t = body && typeof body.text === "string" ? body.text.trim() : "";
  if (!t) return json(400, "text: required");
  if (t.length > NOTE_MAX_LEN) return json(400, `text: over ${NOTE_MAX_LEN} characters`);
  const cur = await readNotes(env);
  const low = t.toLowerCase();
  if (cur.items.some((i) => String(i).toLowerCase() === low) || cur.pending.some((p) => String(p.text).toLowerCase() === low)) return json(409, "note already exists");
  if (cur.pending.length >= NOTE_MAX_PENDING) return json(400, `pending: over ${NOTE_MAX_PENDING} waiting`);
  const at = new Date().toISOString();
  const doc = { updatedAt: cur.updatedAt || at, items: cur.items, pending: [...cur.pending, { id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: t, at }] };
  await env.MP_KV.put("notes", JSON.stringify(doc));
  return json(200, { ok: true, ...doc });
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

/** Phase 63: the KV reads and prefs both /plan/draft and /plan/reflow generate from. */
async function planInputs(env, { useUp = false, budget = null } = {}) {
  const [libRaw, mirror, planPrefs, hints, ratingsRaw, pantry, settings] = await Promise.all(
    ["library", "plan", "planPrefs", "dayHints", "ratings", "pantry"].map((k) => readJSON(env, k)).concat(readSettings(env)));
  const library = libraryOf(libRaw);
  const hasMirror = !!(mirror && Array.isArray(mirror.days));
  const startDate = (hasMirror && mirror.startDate) || Generator.isoToday();

  const pp = planPrefs || {};
  const resolved = DayHints.resolve(hints, startDate, Generator.isoToday(), {});
  const prefs = DayHints.merge({ vocab: PLAN_VOCAB, busyDays: pp.busyDays || [], chips: pp.chips || [] }, resolved);
  const target = budget ?? (settings && settings.budgetTarget > 0 ? settings.budgetTarget : pp.budgetTarget);
  if (target > 0) prefs.budgetTarget = target;
  prefs.repeatGap = pp.repeatGap || 0;
  prefs.shopOffset = ShelfLife.shopOffset(mirror); // Phase 68: shop cycles every 7 days from shopAnchor
  prefs.profile = Nutrition.profileOf(settings);
  if (useUp) {
    const items = ShoppingList.useUpItems((pantry && pantry.items) || [], mirror, Generator.isoToday(), SHELF_DATA);
    if (items.length) prefs.useUp = { items, window: PACK_DATA.planning.useUpWindow || 6 };
  }
  const nDays = (hasMirror && mirror.days.length) || 14, firstSlot = hasMirror ? mirror.firstSlot : undefined; // Phase 83
  return { library, mirror, hasMirror, startDate, prefs, pantry, ratingsRaw, settings, nDays, firstSlot };
}

/** Generator.generatePlan over `pool`, with `ranOut` pantry keys treated as absent (generation only; the pantry is never written). */
function runGenerator({ startDate, prefs, pantry, ratingsRaw, settings, nDays, firstSlot }, pool, locked, ranOut = []) {
  const budgetObj = { costIndex: ShoppingList.costIndex(pool, PACK_DATA), groups: ShoppingList.groupIndex(SUB_GROUPS), ...PACK_DATA.planning };
  const have = ShoppingList.pantryIndex(pantry || { items: [] });
  ranOut.forEach((k) => delete have[k]);
  return Generator.generatePlan(pool, TAGS, Nutrition.withProfile(TARGETS, settings), SHELF_DATA, startDate, budgetObj, have, prefs, (ratingsRaw && ratingsRaw.meals) || {}, locked, { days: nDays, firstSlot });
}

/** POST /plan/draft: Generator.generatePlan around the synced inputs, merged over the plan mirror. Stores nothing. */
async function draftPlan(body, env) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return json(400, "expected an object");
  const { days = null, keep = [], avoid = [], budget = null, useUp = false, startDate: newStart = null, firstSlot = null, shopDay = null } = body;
  const length = Number.isInteger(days) ? days : null; // Phase 84: an integer `days` is the new plan's length (with startDate); an array is the days to redo
  if (days !== null && length === null && (!Array.isArray(days) || !days.every((d) => Number.isInteger(d) && d >= 1 && d <= 28))) return json(400, "days must be integers 1-28");
  if (!Array.isArray(keep) || !keep.every((k) => k && Number.isInteger(k.day) && k.day >= 1 && k.day <= 28 && SLOT_TYPES.includes(k.slot))) return json(400, "keep must be [{ day 1-28, slot }]");
  if (!Array.isArray(avoid) || !avoid.every((a) => typeof a === "string")) return json(400, "avoid must be meal id strings");
  if (budget !== null && !(typeof budget === "number" && isFinite(budget) && budget > 0)) return json(400, "budget must be a number > 0");
  if (typeof useUp !== "boolean") return json(400, "useUp must be a boolean");
  if (length !== null && !(length >= 1 && length <= 28)) return json(400, "days must be 1-28");
  if (newStart !== null && !(typeof newStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(newStart) && !isNaN(Date.parse(newStart)) && newStart >= Generator.isoToday())) return json(400, "startDate must be an ISO date, today or later");
  if (firstSlot !== null && !SLOT_TYPES.includes(firstSlot)) return json(400, "firstSlot must be breakfast, lunch, dinner or snack");
  if (shopDay !== null && !(Number.isInteger(shopDay) && shopDay >= 0 && shopDay <= 6)) return json(400, "shopDay must be 0-6 (0 = Sunday)");
  if ((firstSlot !== null || shopDay !== null || length !== null) && newStart === null) return json(400, "firstSlot, shopDay and a numeric days need startDate");

  const inp = await planInputs(env, { useUp, budget });
  if (newStart !== null) return freshStart(inp, { date: newStart, firstSlot, days: length, shopDay }, avoid);
  const { library, mirror, hasMirror, startDate, prefs, nDays } = inp;
  if (!library.length) return json(409, "library must be synced first");
  const want = new Set((Array.isArray(days) ? days : null) || Array.from({ length: nDays }, (_, i) => i + 1));
  const kept = new Set(keep.map((k) => `${k.day}:${k.slot}`));
  const avoidSet = new Set(avoid);

  // Phase 66: slots the merge below keeps are passed as locked, so the draft fills around them.
  const locked = {};
  if (hasMirror) for (let day = 1; day <= nDays; day++) {
    const old = (mirror.days[day - 1] && mirror.days[day - 1].slots) || {};
    for (const slot of SLOT_TYPES) {
      const cur = old[slot];
      if (cur && cur.mealId && (cur.locked || cur.eatenAt || kept.has(`${day}:${slot}`) || !want.has(day))) (locked[day] = locked[day] || {})[slot] = cur;
    }
  }
  const gen = runGenerator(inp, library.filter((m) => !avoidSet.has(m.id)), locked);
  // ponytail: a merge can split a batch/leftover chain at a kept/eaten boundary; the user sees the draft before applying.

  const merged = [];
  const changes = [];
  for (let day = 1; day <= nDays; day++) {
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

/** Phase 84: a whole new plan from `s.date` (Phase 83 options), generated like Plan with me. The draft carries `start` so the app replaces the plan instead of merging. */
function freshStart(inp, s, avoid = []) {
  if (!inp.library.length) return json(409, "library must be synced first");
  const startDate = s.date, nDays = s.days || 14, firstSlot = s.firstSlot || undefined;
  const shopAnchor = s.shopDay != null ? globalThis.MP.shopAnchorFor(startDate, s.shopDay) : startDate;
  const prefs = { ...inp.prefs, shopOffset: ShelfLife.shopOffset({ startDate, shopAnchor }) };
  const pool = inp.library.filter((m) => !avoid.includes(m.id));
  const gen = runGenerator({ ...inp, startDate, prefs, nDays, firstSlot }, pool, {});
  const changes = [];
  gen.days.forEach((d) => SLOT_TYPES.forEach((slot) => { const after = d.slots[slot]; if (after && (after.mealId || after.eatingOut)) changes.push({ day: d.day, slot, before: null, after: slotRef(after) }); }));
  const draft = { id: draftId([startDate, nDays, firstSlot, shopAnchor, changes]), startDate, changes, summary: `new ${nDays}-day plan from ${startDate}`, start: { days: nDays, ...(firstSlot ? { firstSlot } : {}), shopAnchor } };
  return json(200, { draft, plan: { startDate, firstSlot, shopAnchor, days: gen.days } });
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
    if (!c || !Number.isInteger(c.day) || c.day < 1 || c.day > 28 || !SLOT_TYPES.includes(c.slot)) return json(400, "each change needs day 1-28 and a valid slot");
    if (!refOk(c.after)) return json(400, "change references a meal not in the library");
  }
  return json(200, await parkDraft(env, who, d));
}

/** Phase 84: a draft's `start` options, or null unless days is 1-28, firstSlot a slot (if set) and shopAnchor an ISO date. */
function cleanStart(st) {
  if (!st || typeof st !== "object" || !Number.isInteger(st.days) || st.days < 1 || st.days > 28) return null;
  if (typeof st.shopAnchor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(st.shopAnchor) || isNaN(Date.parse(st.shopAnchor))) return null;
  if (st.firstSlot !== undefined && !SLOT_TYPES.includes(st.firstSlot)) return null;
  return { days: st.days, ...(st.firstSlot ? { firstSlot: st.firstSlot } : {}), shopAnchor: st.shopAnchor };
}

/** Park a draft in KV planDraft (once per id) and log it. `reflow` marks a Phase 63 re-flow draft. */
async function parkDraft(env, who, d, reflow = false) {
  const cur = await readJSON(env, "planDraft");
  if (cur && cur.id === d.id) {
    if (cur.pending) return { id: d.id, status: "already pending" };
    if (cur.ackedId === d.id) return { id: d.id, status: "already applied" };
  }
  const next = { id: d.id, at: new Date().toISOString(), pending: true, ...(reflow ? { reflow: true } : {}), startDate: d.startDate, ...(cleanStart(d.start) ? { start: cleanStart(d.start) } : {}), changes: d.changes.map(({ day, slot, before, after }) => ({ day, slot, before: before && before.eatingOut ? before : slotRef(before), after: after && after.eatingOut ? after : slotRef(after) })) };
  await env.MP_KV.put("planDraft", JSON.stringify(next));
  await logWrite(env, { who, key: "planDraft", why: reflow ? "re-flow" : "", changes: diffItems("planDraft", cur, next) });
  return { id: d.id, status: "pending" };
}

/** POST /plan/reflow (Phase 63): re-plan only skipped / eating-out / ran-out slots of the mirrored plan and park the result as a pending planDraft. */
async function reflowRoute(body, env, who) {
  const bad = globalThis.MP.reflowInputError(body);
  if (bad) return json(400, bad);
  const inp = await planInputs(env);
  if (!inp.library.length) return json(409, "library must be synced first");
  if (!inp.hasMirror) return json(409, "no plan to re-flow");
  const { library, mirror, startDate } = inp;
  const planIn = { ...mirror, days: Array.from({ length: inp.nDays }, (_, i) => mirror.days[i] || { day: i + 1, slots: {} }) };
  const res = globalThis.MP.reflowPlan(planIn, body, Object.fromEntries(library.map((m) => [m.id, m])), globalThis.MP.reflowFromDay(startDate, Generator.isoToday()),
    (locked, ranOut, avoid) => runGenerator(inp, library.filter((m) => !avoid.includes(m.id)), locked, ranOut));
  const names = Object.fromEntries(library.map((m) => [m.id, m.name]));
  const label = (a) => (a.eatingOut ? "eating out" : names[a.mealId] || a.mealId);
  const shown = res.changes.filter((c) => c.after);
  const summary = (res.changes.length ? `${res.changes.length} change${res.changes.length === 1 ? "" : "s"}: ${shown.slice(0, 3).map((c) => `day ${c.day} ${c.slot} ${label(c.after)}`).join(", ")}${shown.length > 3 ? ` +${shown.length - 3} more` : ""}` : "no changes")
    + (res.ignored.length ? `; ignored ${res.ignored.length} eaten, locked or past slot${res.ignored.length === 1 ? "" : "s"}` : "");
  const draft = { id: draftId(res.changes), startDate, changes: res.changes, summary };
  if (res.changes.length) await parkDraft(env, who, draft, true);
  return json(200, { draft, plan: { startDate, days: res.plan.days } });
}

/** POST /plan/edit (Phase 84): validate chat-style edits with PlanChat.validateReply, apply them to the mirrored plan through MP.applyPlanEdits
 *  and park the result as a pending planDraft. Nothing reaches the app's plan until the user accepts it. A `start` edit replaces the plan, so it travels alone. */
async function editRoute(body, env, who) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return json(400, "expected an object");
  if (!Array.isArray(body.edits) || !body.edits.length) return json(400, "edits must be a non-empty array");
  if (body.source !== undefined && typeof body.source !== "string") return json(400, "source must be a string");
  const today = Generator.isoToday();
  const { reply, dropped } = PlanChat.validateReply({ edits: body.edits }, PLAN_VOCAB, today);
  const edits = reply.edits.filter((e) => ["start", "skip", "out", "swap", "swapDay", "backfill"].includes(e.type));
  const dropAll = dropped + (reply.edits.length - edits.length);
  if (!edits.length) return json(400, "no valid edits");
  const inp = await planInputs(env);
  if (!inp.library.length) return json(409, "library must be synced first");
  const start = edits.filter((e) => e.type === "start").pop();
  if (start) {
    const res = await freshStart(inp, { date: start.date, firstSlot: start.firstSlot, days: start.days, shopDay: start.shopDay });
    const out = await res.json();
    if (!res.ok) return json(res.status, out.error || out);
    await parkDraft(env, who, out.draft, true);
    return json(200, { id: out.draft.id, status: "parked", dropped: dropAll + edits.length - 1 });
  }
  if (!inp.hasMirror) return json(409, "no plan to edit");
  const { library, mirror, startDate } = inp;
  const planIn = { ...mirror, days: Array.from({ length: inp.nDays }, (_, i) => mirror.days[i] || { day: i + 1, slots: {} }) };
  const res = globalThis.MP.applyPlanEdits(planIn, edits, Object.fromEntries(library.map((m) => [m.id, m])), globalThis.MP.reflowFromDay(startDate, today),
    (locked, ranOut, avoid) => runGenerator(inp, library.filter((m) => !avoid.includes(m.id)), locked, ranOut), today);
  if (!res.changes.length) return json(200, { id: null, status: "no changes", dropped: dropAll, ignored: res.ignored });
  const draft = { id: draftId(res.changes), startDate, changes: res.changes };
  await parkDraft(env, who, draft, true);
  return json(200, { id: draft.id, status: "parked", dropped: dropAll, ignored: res.ignored });
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
  if (dayRaw === null || dayRaw === "" || !Number.isInteger(day) || day < 1 || day > 28) {
    return json(400, "day must be 1-28");
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

/** Phase 80: the food log's eat entries (stock entries never count as eaten). */
const eatEntries = (raw) => (raw && Array.isArray(raw.entries) ? raw.entries.filter((e) => e.kind === "eat") : []);
const FOOD_TRACKED = [...Object.keys(FOOD.usdaIds), "salt_g"];
const unconfirmedOf = (nutrients) => FOOD_TRACKED.filter((k) => !(nutrients && nutrients[k]));
const offPlanOf = (e) => ({ name: e.name, grams: e.grams, ...(e.count ? { count: e.count } : {}), ...(e.gramsEstimate ? { gramsEstimate: true } : {}), unconfirmed: unconfirmedOf(e.nutrients), eatenAt: e.when });

/** One day's eaten log, planned slots and coverage: shared by GET /nutrition?date= and GET /day. */
async function dayView(date, gym, { byId, log, planRaw, dayFmt, food = [] }, env) {
  const baseTargets = Nutrition.withProfile(TARGETS, await readSettings(env));
  const targets = gym ? Nutrition.withGymDay(baseTargets) : baseTargets;
  const eatenToday = log.filter((e) => dayFmt.format(new Date(e.eatenAt)) === date);
  const foodToday = food.filter((e) => dayFmt.format(new Date(e.when)) === date);
  const { cov, missing, partial } = Nutrition.eatenDayCoverage([...eatenToday, ...foodToday.map((e) => Nutrition.foodAsEaten(e, targets, FOOD.tagShare))], byId, TAGS, targets);
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
  return { eatenToday, foodToday, planned, cov, missing, partial };
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
  const [libRaw, planRaw, logRaw, pantryRaw, todayRaw, cooksRaw, foodRaw] = await Promise.all(["library", "plan", "eatenLog", "pantry", "today", "cooks", "foodLog"].map(read));
  const meals = Array.isArray(libRaw) ? libRaw : libRaw && Array.isArray(libRaw.meals) ? libRaw.meals : [];
  const byId = Object.fromEntries(meals.map((m) => [m.id, m]));
  const log = Array.isArray(logRaw) ? logRaw : [];
  const v = await dayView(date, gym, { byId, log, planRaw, dayFmt, food: eatEntries(foodRaw) }, env);
  const t = todayRaw && typeof todayRaw === "object" && todayRaw.date === date ? todayRaw : null;
  const count = (f) => (t && Number.isInteger(t[f]) && t[f] > 0 ? Math.min(t[f], 99) : 0);
  const done = t && Array.isArray(t.routineDone) ? t.routineDone : [];
  const cards = [];
  for (const p of v.planned) cards.push({ type: "meal", slot: p.slot, mealId: p.mealId, name: p.name, state: "planned" });
  for (const e of v.eatenToday) cards.push({ type: "meal", slot: null, mealId: e.mealId, name: e.name, state: "eaten", eatenAt: e.eatenAt });
  for (const e of v.foodToday) cards.push({ type: "food", ...offPlanOf(e) });
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
  const [libRaw, planRaw, logRaw, foodRaw] = await Promise.all([read("library"), read("plan"), read("eatenLog"), read("foodLog")]);
  const meals = Array.isArray(libRaw) ? libRaw : libRaw && Array.isArray(libRaw.meals) ? libRaw.meals : [];
  const byId = Object.fromEntries(meals.map((m) => [m.id, m]));
  const log = Array.isArray(logRaw) ? logRaw : [];
  const food = eatEntries(foodRaw);
  if (dates) {
    const wt = Nutrition.withProfile(TARGETS, await readSettings(env));
    const g = Nutrition.weekGaps([...log, ...food.map((e) => Nutrition.foodAsEaten(e, wt, FOOD.tagShare))], byId, dates, TAGS, wt, (e) => dayFmt.format(new Date(e.eatenAt)));
    return json(200, { from: dates[0], to: dates[dates.length - 1], nutrients: g.nutrients, notLogged: g.notLogged });
  }
  const gym = params.get("gym") === "1" && !!TARGETS.gymDay;
  const { eatenToday, foodToday, planned, cov, missing, partial } = await dayView(date, gym, { meals, byId, log, planRaw, dayFmt, food }, env);
  const short = cov.proteinGramsApprox < 0.8 * cov.proteinTarget;
  const swaps = short ? Nutrition.rankByGap(meals, ["protein"], TAGS).slice(0, 3).map((m) => ({ id: m.id, name: m.name })) : [];
  return json(200, {
    date, eaten: eatenToday.map((e) => e.name), planned: planned.map(({ slot, name }) => ({ slot, name })),
    ...(gym ? { gym: true } : {}),
    proteinGramsApprox: cov.proteinGramsApprox, proteinTarget: cov.proteinTarget, missing, partial, swaps,
    offPlan: foodToday.map(offPlanOf),
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

/** Shared by /shopping and /swaps: the synced library + plan turned into per-shop-day lists with each line's id/state. */
async function loadShopLists(env) {
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
  if (!meals || !plan || !Array.isArray(plan.days)) return { error: json(409, "library and plan must be synced first") };
  const pantry = parse(pantryRaw);
  const mealsById = Object.fromEntries(meals.map((m) => [m.id, m]));
  const lists = ShoppingList.buildLists(plan, mealsById, PACK_DATA, pantry && Array.isArray(pantry.items) ? pantry : null);
  const { lines } = await readShopping(env);
  const byId = new Map(lines.map((l) => [l.id, l]));
  for (const list of Object.values(lists)) {
    for (const l of [...list.lines, ...list.staples, ...list.estimated]) {
      l.id = ShoppingList.planLineId(plan, list.shopDay, l.key);
      const st = byId.get(l.id);
      l.state = st ? st.state : "needed";
      l.stateAt = st ? st.updatedAt : null;
    }
  }
  return { plan, meals, lists, lines };
}

async function shopping(env) {
  const { error, plan, lists, lines } = await loadShopLists(env);
  if (error) return error;
  const extras = lines.filter((l) => l.id.startsWith("x:") && l.state !== "deleted");
  return json(200, {
    updatedAt: plan.updatedAt || null,
    startDate: plan.startDate || null,
    lists,
    adhoc: ShoppingList.adhocView(lines),
    extras,
  });
}

/** GET /swaps?day=N&limit=K (Phase 76): cheaper like-for-like swaps for the priciest grouped lines of one shop list. Read-only. */
async function swaps(params, env) {
  const limitRaw = params.get("limit"), dayRaw = params.get("day");
  const limit = limitRaw === null ? 5 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) return json(400, "limit must be an integer 1-10");
  const day = dayRaw === null ? null : Number(dayRaw);
  if (day !== null && !Number.isInteger(day)) return json(400, "day must be a plan day");
  const { error, plan, meals, lists } = await loadShopLists(env);
  if (error) return error;
  if (day !== null && (day < 1 || day > plan.days.length)) return json(400, "day must be a plan day");
  const shopDay = ShelfLife.shopDayFor(day === null ? 1 : day, ShelfLife.shopOffset(plan));
  const list = lists[shopDay];
  const settings = await readSettings(env);
  const hardTerms = [...new Set([...((settings && settings.allergies) || []), ...((settings && settings.never) || [])])];
  const idx = ShoppingList.groupIndex(SUB_GROUPS);
  const pence = (n) => Math.round(n * 100);
  const out = [];
  const top = list.lines.filter((l) => l.state === "needed" && l.lineCost > 0).sort((a, b) => b.lineCost - a.lineCost);
  for (const line of top) {
    if (out.length >= limit) break;
    const g = idx[ShoppingList.normalizeKey(line.key)];
    if (!g) continue;
    const using = meals.filter((m) => line.meals.includes(m.name));
    let best = null;
    for (const mate of g.members) {
      if (ShoppingList.normalizeKey(mate.key) === ShoppingList.normalizeKey(line.key)) continue;
      const item = ShoppingList.priceFor(mate.key, PACK_DATA);
      if (!item) continue;
      const packs = ShoppingList.packsFor(line.needed, item);
      const cost = packs * item.price;
      if (pence(cost) > pence(line.lineCost) - 1) continue;
      const sub = [{ from: line.key, to: mate.key, label: mate.label }];
      if (using.some((m) => !Exclusions.check(globalThis.MP.applySubs(m, sub), hardTerms).ok)) continue;
      if (best && cost >= best.now.cost) continue;
      const tagFrom = TAGS[line.key] || {}, tagTo = TAGS[mate.key] || {};
      const tagChanges = [...new Set([...Object.keys(tagFrom), ...Object.keys(tagTo)])]
        .filter((n) => (tagFrom[n] || null) !== (tagTo[n] || null))
        .map((nutrient) => ({ nutrient, from: tagFrom[nutrient] || null, to: tagTo[nutrient] || null }));
      const sameUnit = line.needed && line.needed.unit === item.unit;
      const qtyVal = packs * item.packSize;
      best = {
        lineId: line.id, key: line.key, label: line.label, meals: line.meals,
        to: { key: mate.key, label: mate.label, qty: { value: qtyVal, unit: item.unit, raw: `${qtyVal}${item.unit === "each" ? "" : item.unit}` } },
        was: { packs: line.packs, cost: line.lineCost },
        now: { packs, cost: Math.round(cost * 100) / 100 },
        saving: Math.round((line.lineCost - cost) * 100) / 100,
        estimated: !sameUnit || item.estimated,
        tagChanges,
      };
    }
    if (best) out.push(best);
  }
  out.sort((a, b) => b.saving - a.saving);
  return json(200, { updatedAt: plan.updatedAt || null, shopDay, swaps: out });
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
  if (!Number.isInteger(day) || day < 1 || day > 28) return json(400, "day must be 1-28");
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
async function putMealRating(request, env, mealId, who) {
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
  const before = JSON.parse(JSON.stringify(r));
  all[mealId] = Ratings.applyPatch(all[mealId], body, new Date().toISOString());
  const after = { meals: all };
  await env.MP_KV.put("ratings", JSON.stringify(after));
  if (who) await logWrite(env, { who, key: "ratings", why: reasonOf(request), changes: diffItems("ratings", before, after) });
  return json(200, all[mealId]);
}

const SPEND_SOURCES = ["asda", "manual", "estimate"];
const isoDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + "T00:00:00Z").toISOString().startsWith(s);

/** GET /spend — { weeks, budgetTarget } */
async function getSpend(env) {
  const v = parseKV(await env.MP_KV.get("spend"));
  const s = await readSettings(env);
  return json(200, { weeks: (v && v.weeks) || {}, budgetTarget: (s && s.budgetTarget > 0 && s.budgetTarget) || 0 });
}

/** POST /spend { week, total, source } — one row per week (shop-day ISO); a repeat overwrites. */
async function postSpend(request, env, who) {
  let body;
  try { body = JSON.parse(await request.text()); } catch (e) { return json(400, "invalid JSON"); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return json(400, "expected a JSON object");
  if (Object.keys(body).some((k) => !["week", "total", "source"].includes(k))) return json(400, "unknown key");
  if (!isoDate(body.week)) return json(400, "week must be an ISO date");
  if (typeof body.total !== "number" || !Number.isFinite(body.total) || body.total < 0) return json(400, "total must be a number >= 0");
  if (!SPEND_SOURCES.includes(body.source)) return json(400, "source must be asda, manual or estimate");
  const before = parseKV(await env.MP_KV.get("spend"));
  const now = new Date().toISOString();
  const after = { updatedAt: now, weeks: { ...((before && before.weeks) || {}), [body.week]: { total: body.total, source: body.source, at: now } } };
  await env.MP_KV.put("spend", JSON.stringify(after));
  if (who) await logWrite(env, { who, key: "spend", why: reasonOf(request), changes: diffItems("spend", before, after) });
  return json(200, after.weeks[body.week]);
}

// Phase 78: pantry audit. Advisory state in KV `pantryAudit`; never writes `pantry`.
const AUDIT_RECENT_DAYS = 14; // an item confirmed this recently is not asked about again
const AUDIT_STALE_DAYS = 60; // a confirmation older than this is a `stale` finding
const AUDIT_MAX_QTY = { g: 20000, ml: 20000, each: 200 }; // implausible-qty ceiling per parsed unit (mass/volume, count)
const AUDIT_LOCATIONS = ["fridge", "freezer", "cupboard"];
const dayMs = (iso) => Date.parse(iso + "T00:00:00Z");
const addIsoDays = (iso, n) => new Date(dayMs(iso) + n * 86400000).toISOString().slice(0, 10);

/** Shared read for the audit routes: validated today, pantry items, stored audit (malformed -> empty). */
async function readAudit(params, env) {
  const today = params.get("today") || new Date().toISOString().slice(0, 10);
  if (!ShelfLife.isIsoDate(today)) return { error: json(400, "today must be YYYY-MM-DD") };
  const pantry = parseKV(await env.MP_KV.get("pantry"));
  const a = parseKV(await env.MP_KV.get("pantryAudit"));
  const obj = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {});
  return { today, items: pantry && Array.isArray(pantry.items) ? pantry.items.filter((i) => i && typeof i.name === "string") : [], confirmed: obj(a && a.confirmed), snoozes: obj(a && a.snoozes) };
}

/** GET /pantry/audit?location=&limit=&today= — the next batch of items worth a "still there?" check. */
async function pantryAudit(params, env) {
  const location = params.get("location");
  if (!AUDIT_LOCATIONS.includes(location)) return json(400, "location must be fridge, freezer or cupboard");
  const lRaw = params.get("limit");
  const limit = lRaw == null ? 8 : /^\d+$/.test(lRaw) ? Number(lRaw) : 0;
  if (limit < 1 || limit > 20) return json(400, "limit must be 1-20");
  const a = await readAudit(params, env);
  if (a.error) return a.error;
  let unsorted = 0;
  const eligible = [];
  for (const it of a.items) {
    if (it.out === true) continue;
    const s = ShelfLife.storageFor(it, SHELF_DATA);
    if (!s) { unsorted++; continue; }
    if (s.storage !== location) continue;
    const last = a.confirmed[ShoppingList.normalizeKey(it.name)] || null;
    if (last && dayMs(a.today) - dayMs(last) < AUDIT_RECENT_DAYS * 86400000) continue;
    eligible.push({ name: it.name, qty: it.qty ?? null, useBy: it.useBy ?? null, lastConfirmed: last });
  }
  // never-confirmed first (pantry order; sort is stable), then oldest confirmation first
  eligible.sort((x, y) => (x.lastConfirmed ? 1 : 0) - (y.lastConfirmed ? 1 : 0) || ((x.lastConfirmed || "") < (y.lastConfirmed || "") ? -1 : (x.lastConfirmed || "") > (y.lastConfirmed || "") ? 1 : 0));
  return json(200, { location, today: a.today, items: eligible.slice(0, limit), remaining: Math.max(0, eligible.length - limit), unsorted });
}

/** GET /pantry/sanity?today= — things that look wrong in the pantry, minus snoozed findings. */
async function pantrySanity(params, env) {
  const a = await readAudit(params, env);
  if (a.error) return a.error;
  const findings = [];
  const add = (cls, name, detail) => findings.push({ id: `${cls}:${ShoppingList.normalizeKey(name)}`, class: cls, name, detail });
  const seen = new Map();
  for (const it of a.items) {
    const key = ShoppingList.normalizeKey(it.name);
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(it.name);
    if (it.qty && typeof it.qty === "object") { // free-text qty is never judged
      const q = ShoppingList.parseQty(it.qty);
      if (q && q.value < 0) add("negative-qty", it.name, `quantity is ${q.value}`);
      else if (q && q.value > (AUDIT_MAX_QTY[q.unit] ?? AUDIT_MAX_QTY.each)) add("implausible-qty", it.name, `${q.value} ${q.unit} looks too large`);
    }
    const last = a.confirmed[key];
    if (ShelfLife.isIsoDate(last) && dayMs(a.today) - dayMs(last) > AUDIT_STALE_DAYS * 86400000) add("stale", it.name, `last confirmed ${last}`);
    if (it.out !== true && !it.useBy) {
      const s = ShelfLife.storageFor(it, SHELF_DATA);
      if (s && s.storage === "fridge") add("no-use-by", it.name, "fridge item with no use-by date");
    }
  }
  for (const names of seen.values()) if (names.size > 1) add("duplicate", [...names][0], `listed as ${[...names].join(" and ")}`);
  return json(200, { today: a.today, findings: findings.filter((f) => !(a.snoozes[f.id] >= a.today)) });
}

/** POST /pantry/audit { confirmed?: [name], snooze?: [{ id, days }] } — records answers in `pantryAudit` only. */
async function postPantryAudit(request, env, who, params) {
  let body;
  try { body = JSON.parse(await request.text()); } catch (e) { return json(400, "invalid JSON"); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return json(400, "expected a JSON object");
  if (Object.keys(body).some((k) => !["confirmed", "snooze"].includes(k))) return json(400, "unknown key");
  const { confirmed, snooze } = body;
  if (confirmed === undefined && snooze === undefined) return json(400, "need confirmed or snooze");
  if (confirmed !== undefined && (!Array.isArray(confirmed) || confirmed.some((n) => typeof n !== "string" || !n.trim()))) return json(400, "confirmed must be a list of names");
  if (snooze !== undefined && (!Array.isArray(snooze) || snooze.some((s) => !s || typeof s.id !== "string" || !s.id || !Number.isInteger(s.days) || s.days < 0 || s.days > 90))) return json(400, "snooze must be [{ id, days 0-90 }]");
  const a = await readAudit(params, env);
  if (a.error) return a.error;
  const have = new Set(a.items.map((i) => ShoppingList.normalizeKey(i.name)));
  const unknown = (confirmed || []).filter((n) => !have.has(ShoppingList.normalizeKey(n)));
  if (unknown.length) return json(400, `not in the pantry: ${unknown.join(", ")}`);
  const before = parseKV(await env.MP_KV.get("pantryAudit"));
  const after = { updatedAt: new Date().toISOString(), confirmed: { ...a.confirmed }, snoozes: { ...a.snoozes } };
  for (const n of confirmed || []) after.confirmed[ShoppingList.normalizeKey(n)] = a.today;
  for (const s of snooze || []) { if (s.days === 0) delete after.snoozes[s.id]; else after.snoozes[s.id] = addIsoDays(a.today, s.days); }
  await env.MP_KV.put("pantryAudit", JSON.stringify(after));
  if (who) await logWrite(env, { who, key: "pantryAudit", why: reasonOf(request), changes: diffItems("pantryAudit", before, after) });
  return json(200, after);
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
    if (typeof p.day !== "number" || p.day < 1 || p.day > 28) return "each placement needs day 1-28";
    if (!SLOT_TYPES.includes(p.slot)) return "each placement needs a valid slot";
    if (p.leftover !== undefined && typeof p.leftover !== "boolean") return "leftover must be a boolean";
    if (p.portions !== undefined && (p.leftover !== true || !Number.isInteger(p.portions) || p.portions < 1 || p.portions > 12)) return "portions must be an integer 1-12 and needs leftover: true";
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
  if (!Array.isArray(parsed.busyDays) || !parsed.busyDays.every((d) => Number.isInteger(d) && d >= 1 && d <= 28)) {
    return "busyDays must be integers 1-28";
  }
  if (!Array.isArray(parsed.chips) || !parsed.chips.every((c) => typeof c === "string")) return "chips must be an array of strings";
  if (parsed.freezeBatches !== undefined && typeof parsed.freezeBatches !== "boolean") return "freezeBatches must be a boolean";
  if (parsed.rolling !== undefined && typeof parsed.rolling !== "boolean") return "rolling must be a boolean";
  if (parsed.repeatGap !== undefined && !(Number.isInteger(parsed.repeatGap) && parsed.repeatGap >= 0 && parsed.repeatGap <= 14)) return "repeatGap must be an integer 0-14";
  const tc = parsed.timeCaps; // Phase 88: { "0".."6": minutes 5-240 }
  if (tc !== undefined && (typeof tc !== "object" || tc === null || Array.isArray(tc) || !Object.keys(tc).every((k) => /^[0-6]$/.test(k) && Number.isInteger(tc[k]) && tc[k] >= 5 && tc[k] <= 240))) return "timeCaps must map weekdays 0-6 to minutes 5-240";
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
  ratings: ["meals", null], // object map: item id = meal id
  spend: ["weeks", null], // object map: item id = shop-day ISO date
  foodLog: ["entries", (e) => e.id], // Phase 80: Worker-owned, written only by POST /food-log
  pantryAudit: [null], today: [null], planFlag: [null], planDraft: [null], // whole value is one item, id = key name
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
  ...["/discover", "/ranking", "/nutrition", "/day", "/expiring", "/cookable", "/leftovers", "/quick", "/substitutions", "/product-ranking", "/ratings", "/why", "/scale", "/shopping", "/swaps", "/shopping/lines", "/adhoc", "/drafts", "/activity"]
    .map((path) => row("GET", path, "read")),
  row("GET", "/meal/:id/method", "read", { assistant: true }),
  ...Object.entries(KEYS).flatMap(([path, key]) => {
    const kind = key === "eatRequests" ? "queue" : "read";
    return [row("GET", path, kind), row("PUT", path, kind === "queue" ? kind : "write", ITEMS[key] ? { dryRun: true, log: "logged" } : quiet(UNLOGGED[path] || "inert"))];
  }),
  row("PUT", "/adhoc", "write", { dryRun: true, log: "logged" }),
  row("POST", "/shopping/lines", "write", { log: "logged" }),
  row("GET", "/spend", "read"),
  row("GET", "/notes", "read"),
  row("PUT", "/notes", "write", quiet("standing notes from Notes.md, not an everyday edit")),
  row("POST", "/notes/pending", "write", quiet("inbox for notes the app accepted; the assistant appends them to Notes.md")),
  row("GET", "/food-log", "read"),
  row("POST", "/food-log", "write", { log: "logged", note: "logs what was eaten or stocked; also writes pantry and products (one activity id per key written); an id already logged is a no-op" }),
  row("POST", "/spend", "write", { log: "logged", note: "logged only with an X-Actor header; one row per week, a repeat overwrites" }),
  row("GET", "/pantry/audit", "read"),
  row("GET", "/pantry/sanity", "read"),
  row("POST", "/pantry/audit", "write", { log: "logged", note: "writes only pantryAudit (confirmations, snoozes), never pantry; logged only with an X-Actor header" }),
  row("PUT", "/meal-method", "write", { dryRun: true, log: "logged" }),
  row("PUT", "/meal/:id/rating", "write", { assistant: true, log: "logged", note: "logged only with an X-Actor header; the app token's own PUT is not" }),
  row("POST", "/drafts", "write", quiet("inert until the app accepts")),
  row("DELETE", "/drafts/:id", "write", { assistant: true, ...quiet("inert until the app accepts") }),
  row("POST", "/plan/draft", "read", { note: "computes a draft, stores nothing; useUp:true cooks expiring pantry items first" }),
  row("POST", "/plan/apply", "write", { log: "logged", note: "parks the draft in planDraft" }),
  row("POST", "/plan/edit", "write", { log: "logged", note: "Phase 84: validates chat-style edits (start, skip, out, swap, swapDay, backfill), applies them to the mirrored plan and parks the result in planDraft" }),
  row("POST", "/plan/reflow", "write", { log: "logged", note: "re-plans only skipped / eatingOut / ranOut slots and parks the result in planDraft" }),
  row("POST", "/activity/undo", "write", { log: "logged" }),
  row("POST", "/chat", "write", quiet("ephemeral planning-chat thread (ChatRoom DO), not planning data")),
  row("GET", "/chat", "read", { note: "polls the thread; X-Actor: hermes stamps bridgeSeenAt" }),
  row("POST", "/chat/reply", "write", quiet("ephemeral planning-chat thread (ChatRoom DO), not planning data")),
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
  if (key === "ratings") {
    // Restamp `at` to now, else the app's newest-`at` merge keeps the rejected note; no prior record = the neutral one.
    const nowIso = new Date().toISOString();
    const meals = { ...((current && current.meals) || {}) };
    for (const c of changes) meals[c.id] = { ...(c.before || { rating: null, note: "", never: false }), at: nowIso };
    return { meals };
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

// ---- Planning chat (Phase 72) ----
// One SQLite-backed Durable Object ("plan") holds the current chat session only; KV's ~60 s read cache can't serve a 1 s
// poll. State "s": { session, seq, openAt, bridgeSeenAt, messages } (messages capped at CHAT_CAP, oldest dropped).
const CHAT_CAP = 40, CHAT_TEXT_MAX = 1000, CHAT_CTX_MAX = 4000, CHAT_BRIEF_MAX = 60000, BRIDGE_STAMP_MS = 5000; // Phase 88: the open message's context carries the briefing

export class ChatRoom {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    const url = new URL(request.url);
    const hermes = request.headers.get("X-Actor") === "hermes";
    const st = (await this.ctx.storage.get("s")) || { session: null, seq: 0, openAt: null, bridgeSeenAt: null, messages: [] };
    const save = () => this.ctx.storage.put("s", st);
    const push = (m) => {
      m.id = ++st.seq; m.at = new Date().toISOString();
      st.messages.push(m);
      // the open message holds the briefing, so it is never the one dropped
      while (st.messages.length > CHAT_CAP) { const i = st.messages.findIndex((x) => !x.open); st.messages.splice(i < 0 ? 0 : i, 1); }
      return m.id;
    };
    if (request.method === "GET" && url.pathname === "/chat") {
      const want = url.searchParams.get("session");
      if (!hermes && want !== st.session) return json(409, { error: "stale session" });
      if (hermes && (!st.bridgeSeenAt || Date.now() - Date.parse(st.bridgeSeenAt) > BRIDGE_STAMP_MS)) { st.bridgeSeenAt = new Date().toISOString(); await save(); }
      const since = Number(url.searchParams.get("since")) || 0;
      return json(200, { session: st.session, openAt: st.openAt, bridgeSeenAt: st.bridgeSeenAt, messages: st.messages.filter((m) => m.id > since) });
    }
    if (request.method !== "POST") return json(405, "method not allowed");
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, "bad request");
    const ctxOk = body.context === undefined || (body.context && typeof body.context === "object" && !Array.isArray(body.context) && JSON.stringify(body.context).length <= (body.open === true ? CHAT_BRIEF_MAX : CHAT_CTX_MAX));
    if (typeof body.session !== "string" || !body.session || body.session.length > 64 || !ctxOk) return json(400, "bad request");
    if (url.pathname === "/chat/reply") {
      if (!hermes) return json(403, "forbidden");
      if (body.session !== st.session || !st.messages.some((m) => m.id === body.replyTo && m.from === "user")) return json(409, { error: "stale session or replyTo" });
      const { reply, dropped } = PlanChat.validateReply({ text: body.text, edits: body.edits, ask: body.ask }, PLAN_VOCAB);
      const id = push({ from: "hermes", replyTo: body.replyTo, text: reply.text, edits: reply.edits, ask: reply.ask });
      await save();
      return json(200, { id, dropped });
    }
    if (body.open === true) {
      Object.assign(st, { session: body.session, openAt: new Date().toISOString(), messages: [] });
      push({ from: "user", text: "", open: true, context: body.context });
      await save();
      return json(200, { session: st.session, bridgeSeenAt: st.bridgeSeenAt });
    }
    if (body.session !== st.session) return json(409, { error: "stale session" });
    if (body.close === true) { st.openAt = null; await save(); return json(200, { session: st.session }); }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > CHAT_TEXT_MAX) return json(400, "text must be 1-1000 characters");
    const msg = { from: "user", text, context: body.context };
    if (Number.isInteger(body.day) && body.day >= 1 && body.day <= 28) msg.day = body.day;
    const id = push(msg);
    await save();
    return json(200, { id });
  }
}

async function chatRoute(request, env, url, actor) {
  if (!env.CHAT) return json(503, "chat not configured");
  if (url.pathname === "/chat/reply" && actor !== "hermes") return json(403, "forbidden");
  const stub = env.CHAT.get(env.CHAT.idFromName("plan"));
  const res = await stub.fetch(new Request(url, { method: request.method, headers: { "X-Actor": actor || "" }, body: request.method === "POST" ? await request.text() : undefined }));
  return json(res.status, await res.json().catch(() => null));
}

// ---- Food log (Phase 80) ----
const FOOD_ENTRY_KEYS = ["id", "action", "when", "text", "name", "grams", "count", "gramsPerItem", "lookup", "candidates"];
const FOOD_CAP = 500;
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const posNum = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const isDayStr = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;

/** Shape only; the whole body is rejected on any bad entry. @returns {string|null} */
function foodLogError(parsed) {
  if (!isObj(parsed)) return "expected an object";
  if (Object.keys(parsed).some((k) => k !== "entries")) return "unknown key in body";
  if (!Array.isArray(parsed.entries) || parsed.entries.length < 1 || parsed.entries.length > 20) return "entries must be 1-20 items";
  for (const e of parsed.entries) {
    if (isObj(e) && e.action === "meal") { const m = foodMealError(e); if (m) return m; continue; }
    if (isObj(e) && e.action === "remove") {
      if (Object.keys(e).some((k) => !["id", "action", "target"].includes(k))) return "unknown key in remove";
      if (typeof e.id !== "string" || !e.id || e.id.length > 80) return "id must be 1-80 chars";
      if (typeof e.target !== "string" || !e.target || e.target.length > 80) return "target must be 1-80 chars";
      continue;
    }
    const m = foodEntryError(e);
    if (m) return m;
  }
  return null;
}

/** A meal: { id, action:"meal", name, when?, items:[1-12 eat items without id/action] }. */
function foodMealError(m) {
  if (Object.keys(m).some((k) => !["id", "action", "name", "when", "items"].includes(k))) return "unknown key in meal";
  if (typeof m.id !== "string" || !m.id || m.id.length > 70) return "meal id must be 1-70 chars";
  if (typeof m.name !== "string" || !m.name.trim() || m.name.length > 60) return "meal name must be 1-60 chars";
  if (m.when !== undefined && (typeof m.when !== "string" || !Number.isFinite(Date.parse(m.when)))) return "when must be an ISO time";
  if (!Array.isArray(m.items) || m.items.length < 1 || m.items.length > 12) return "meal items must be 1-12";
  for (const it of m.items) {
    if (!isObj(it) || "id" in it || "action" in it || "when" in it) return "meal items take no id, action or when";
    const bad = foodEntryError({ id: "x", action: "eat", ...it });
    if (bad) return bad;
  }
  return null;
}

function foodEntryError(e) {
  {
    if (!isObj(e)) return "each entry must be an object";
    const bad = Object.keys(e).find((k) => !FOOD_ENTRY_KEYS.includes(k));
    if (bad) return "unknown key: " + bad;
    if (typeof e.id !== "string" || !e.id || e.id.length > 80) return "id must be 1-80 chars";
    if (e.action !== "eat" && e.action !== "have") return "action must be eat or have";
    if (e.when !== undefined && (typeof e.when !== "string" || !Number.isFinite(Date.parse(e.when)))) return "when must be an ISO time";
    if ((e.text === undefined) === (e.name === undefined)) return "exactly one of text or name";
    const label = e.text !== undefined ? e.text : e.name;
    if (typeof label !== "string" || !label.trim() || label.length > 120) return "text/name must be 1-120 chars";
    if (e.text !== undefined && !FoodLog.parse(e.text)) return "unreadable text";
    if (e.grams !== undefined && !posNum(e.grams)) return "grams must be > 0";
    if (e.gramsPerItem !== undefined && !posNum(e.gramsPerItem)) return "gramsPerItem must be > 0";
    if (e.count !== undefined && !(Number.isInteger(e.count) && e.count > 0)) return "count must be a positive integer";
    if (e.lookup !== undefined && e.lookup !== true) return "lookup must be true";
    if (e.candidates !== undefined) {
      if (!Array.isArray(e.candidates) || e.candidates.length > 5) return "candidates must be an array of at most 5";
      for (const c of e.candidates) {
        if (!isObj(c) || Object.keys(c).some((k) => !["source", "url", "per", "nutrients"].includes(k))) return "bad candidate";
        if (typeof c.source !== "string" || !c.source.trim() || c.source.length > 40) return "candidate source must be 1-40 chars";
        if (typeof c.url !== "string" || !c.url.startsWith("https://")) return "candidate url must be https";
        if (c.per !== "100g") return "candidate per must be 100g";
        if (!isObj(c.nutrients)) return "candidate nutrients must be an object";
        for (const [k, v] of Object.entries(c.nutrients)) if (!/^[a-zA-Z0-9_]+$/.test(k) || typeof v !== "number" || !Number.isFinite(v) || v < 0) return "bad candidate nutrient: " + k;
      }
    }
  }
  return null;
}

const readKV = async (env, k) => parseKV(await env.MP_KV.get(k));
const round2 = (v) => Math.round(v * 100) / 100;
const fmtQty = (value, unit) => ({ value, unit, raw: unit === "each" ? String(value) : `${value}${unit}` });
const newFoodProduct = (key, name, at) => ({ id: "food:" + key, name, brand: null, ingredient: null, per: "100g", servingSize: null, pack: null, price: null, state: null, nutrients: {}, source: "lookup", updatedAt: at });

/** Eat: take grams (g/ml items) or the count (each items) off the matching pantry item. @returns the result's `pantry` field */
function pantryEat(items, key, grams, count) {
  const i = items.findIndex((x) => !x.out && ShoppingList.normalizeKey(x.name) === key);
  if (i < 0) return null;
  const q = ShoppingList.parseQty(items[i].qty);
  if (!q) return { deducted: false, reason: items[i].qty ? "unparseable-quantity" : "no-quantity" };
  const used = q.unit === "g" || q.unit === "ml" ? grams : q.unit === "each" ? count : null;
  if (!(used > 0)) return { deducted: false, reason: "unit-mismatch" };
  const after = ShoppingList.remainingQty(q, { value: used, unit: q.unit });
  const before = MPData.qtyText(items[i].qty);
  items[i] = { ...items[i], qty: after };
  return { name: items[i].name, before, after: after.raw };
}

/** Have: add to the matching pantry item, or create one. @returns the result's `pantry` field */
function pantryHave(items, food, key, grams, count, product) {
  const add = grams ? fmtQty(grams, "g") : count ? fmtQty(count, "each") : product && product.pack && product.pack.value > 0 ? fmtQty(product.pack.value, product.pack.unit) : null;
  const i = items.findIndex((x) => ShoppingList.normalizeKey(x.name) === key);
  if (i < 0) { items.push(add ? { name: food.name, qty: add } : { name: food.name }); return { name: food.name, before: null, after: add ? add.raw : "" }; }
  const { out, ...rest } = items[i];
  if (!add) { if (out) items[i] = rest; return { name: rest.name, before: MPData.qtyText(rest.qty), after: MPData.qtyText(rest.qty) }; }
  const q = rest.qty ? ShoppingList.parseQty(rest.qty) : null;
  if (rest.qty && (!q || q.unit !== add.unit)) return { deducted: false, reason: q ? "unit-mismatch" : "unparseable-quantity" };
  const next = q ? fmtQty(Math.round((q.value + add.value) * 1000) / 1000, q.unit) : add;
  items[i] = { ...rest, qty: next };
  return { name: rest.name, before: q ? MPData.qtyText(rest.qty) : null, after: next.raw };
}

async function postFoodLog(request, env, who) {
  let parsed;
  try { parsed = JSON.parse(await request.text()); } catch (e) { return json(400, "invalid JSON"); }
  const bad = foodLogError(parsed);
  if (bad) return json(400, bad);
  const [logDoc, pantryDoc, prodDoc] = await Promise.all(["foodLog", "pantry", "products"].map((k) => readKV(env, k)));
  const nowIso = new Date().toISOString();
  const logged = new Set(((logDoc && logDoc.entries) || []).map((e) => e.id));
  const newEntries = [];
  const pantry = { ...(pantryDoc || {}), items: [...((pantryDoc && pantryDoc.items) || [])] };
  const products = [...((prodDoc && prodDoc.products) || [])];
  let pantryTouched = false, productsTouched = false;
  const saveProduct = (p) => { const i = products.findIndex((x) => x.id === p.id); if (i >= 0) products[i] = p; else products.push(p); productsTouched = true; };
  const fetchImpl = (u) => globalThis.fetch(u);
  const results = [];

  // a meal expands to one eat per item (id `${id}:${i}`); a remove is applied to the stored entries first
  const units = [], removes = [], mealOf = new Map();
  for (const e of parsed.entries) {
    if (e.action === "remove") removes.push(e);
    else if (e.action === "meal") { mealOf.set(e.id, e); e.items.forEach((it, i) => units.push({ ...it, id: `${e.id}:${i}`, action: "eat", ...(e.when ? { when: e.when } : {}), group: e.id, meal: e.name.trim() })); }
    else units.push(e);
  }
  let stored = (logDoc && logDoc.entries) || [];
  const removed = [];
  for (const r of removes) {
    const hit = stored.filter((x) => x.id === r.target || x.group === r.target);
    if (!hit.length) return json(404, "nothing logged as " + r.target);
    stored = stored.filter((x) => !hit.includes(x));
    removed.push({ id: r.id, status: "removed", target: r.target, removed: hit.map((x) => x.id), pantry: "untouched" });
  }

  for (const e of units) {
    const food = e.text !== undefined ? { ...FoodLog.parse(e.text) } : { name: e.name.trim() };
    if (e.grams) food.grams = e.grams;
    if (e.count) food.count = e.count;
    const key = ShoppingList.normalizeKey(food.name);
    if (logged.has(e.id)) { results.push({ id: e.id, status: "duplicate", name: food.name }); continue; }
    const eat = e.action === "eat";
    let product = FoodLog.findProduct(products, key);

    // grams are the unit of record: a count converts through the item weight
    let grams = food.grams, count = food.count, gramsEstimate = false;
    if (!grams && (eat || count)) {
      count = count || 1;
      const per = e.gramsPerItem || FoodLog.itemGramsFor(key, product, FOOD.itemGrams);
      if (!per) { results.push({ id: e.id, status: "needs-grams", name: food.name, count }); continue; }
      grams = round2(per * count); gramsEstimate = true;
      if (e.gramsPerItem && !(product && product.itemGrams === e.gramsPerItem)) {
        product = { ...(product || newFoodProduct(key, food.name, nowIso)), itemGrams: e.gramsPerItem, updatedAt: nowIso };
        saveProduct(product);
      }
    }

    // nutrients: resolver, then (unknown food, forced lookup, or caller candidates) the cross-checked lookup
    let found = eat ? FoodLog.resolve(food, { products, pantry, cofid: COFID, action: e.action }) : null;
    if (eat && (!found || e.lookup || e.candidates)) {
      const looked = !found || e.lookup ? await FoodLog.lookup(food.name, { fetchImpl, usdaKey: env.USDA_API_KEY, usdaIds: FOOD.usdaIds }) : [];
      const { nutrients: agreed } = FoodLog.crossCheck([...looked, ...(e.candidates || [])], FOOD.tolerance);
      let p = product || newFoodProduct(key, food.name, nowIso);
      const before = JSON.stringify(p.nutrients);
      for (const [k, n] of Object.entries(agreed)) if (!(p.nutrients && p.nutrients[k])) p = Products.setNutrients(p, { [k]: n.value }, "estimate", n.sources);
      if (JSON.stringify(p.nutrients) !== before) {
        product = { ...p, updatedAt: nowIso };
        saveProduct(product);
        found = { kind: found ? found.kind : "lookup", ref: product.id, per100: product.nutrients };
      }
    }
    const nutrients = {};
    if (eat && found) for (const [k, n] of Object.entries(found.per100)) nutrients[k] = { value: round2((n.value * grams) / 100), basis: n.basis };
    const matched = found ? { kind: found.kind, ref: found.ref } : { kind: "none" };
    const source = !found ? "none" : found.kind === "lookup" || String(found.ref).startsWith("food:") ? "lookup" : found.cofid ? "cofid:" + found.cofid : "product:" + found.ref;

    const pantryRes = eat ? pantryEat(pantry.items, key, grams, count) : pantryHave(pantry.items, food, key, grams, count, product);
    if (pantryRes && pantryRes.after !== undefined) pantryTouched = true;
    logged.add(e.id);
    const amount = { ...(grams ? { grams } : {}), ...(count ? { count } : {}), ...(gramsEstimate ? { gramsEstimate: true } : {}) };
    newEntries.push({ id: e.id, kind: eat ? "eat" : "stock", when: e.when || nowIso, name: food.name, ...amount, nutrients, source, ...(e.group ? { group: e.group, meal: e.meal } : {}) });
    results.push({ id: e.id, status: eat ? "logged" : "stocked", name: food.name, ...amount, matched, nutrients, unconfirmed: eat ? unconfirmedOf(nutrients) : [], pantry: pantryRes });
  }

  // one write (and one activity entry) per KV key
  const activity = [];
  const write = async (key, before, after) => {
    const changes = diffItems(key, before, after);
    if (!changes.length) return;
    await env.MP_KV.put(key, JSON.stringify(after));
    const entry = await logWrite(env, { who, key, why: reasonOf(request), changes });
    if (entry) activity.push(entry.id);
  };
  if (newEntries.length || removed.length) await write("foodLog", logDoc, { updatedAt: nowIso, entries: [...stored, ...newEntries].slice(-FOOD_CAP) });
  if (pantryTouched) await write("pantry", pantryDoc, { ...pantry, updatedAt: nowIso });
  if (productsTouched) await write("products", prodDoc, { ...(prodDoc || {}), updatedAt: nowIso, products });
  const out = [];
  for (const e of parsed.entries) {
    if (e.action === "remove") out.push(removed.find((x) => x.id === e.id));
    else if (e.action === "meal") {
      const items = results.filter((r) => r.id.startsWith(e.id + ":") && mealOf.get(e.id) === e);
      const status = items.every((r) => r.status === "duplicate") ? "duplicate" : items.some((r) => r.status === "needs-grams") ? "partial" : "logged";
      out.push({ id: e.id, status, items });
    } else out.push(results.find((r) => r.id === e.id));
  }
  return json(200, { results: out, activity });
}

/** GET /food-log?from=&to=: the stored entries, optionally by London day (at most 31 days). */
async function getFoodLog(params, env) {
  const from = params.get("from"), to = params.get("to");
  for (const d of [from, to]) if (d !== null && !isDayStr(d)) return json(400, "from/to must be YYYY-MM-DD");
  if (from && to && (Date.parse(to) < Date.parse(from) || (Date.parse(to) - Date.parse(from)) / 86400000 > 30)) return json(400, "window must be 31 days or fewer, from before to");
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
  const doc = await readKV(env, "foodLog");
  const entries = ((doc && doc.entries) || []).filter((e) => { const d = dayFmt.format(new Date(e.when)); return (!from || d >= from) && (!to || d <= to); });
  return json(200, { entries });
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
      return putMealRating(request, env, decodeURIComponent(ratingMatch[1]), actor);
    }
    if (url.pathname === "/pantry/audit") {
      if (request.method === "POST") return postPantryAudit(request, env, actor, url.searchParams);
      if (request.method !== "GET") return json(405, "method not allowed");
      return pantryAudit(url.searchParams, env);
    }
    if (url.pathname === "/pantry/sanity") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return pantrySanity(url.searchParams, env);
    }
    if (url.pathname === "/food-log") {
      if (request.method === "POST") return postFoodLog(request, env, actor || "app");
      if (request.method !== "GET") return json(405, "method not allowed");
      return getFoodLog(url.searchParams, env);
    }
    if (url.pathname === "/spend") {
      if (request.method === "POST") return postSpend(request, env, actor);
      if (request.method !== "GET") return json(405, "method not allowed");
      return getSpend(env);
    }
    if (url.pathname === "/notes") {
      if (request.method === "PUT") return putNotes(request, env);
      if (request.method !== "GET") return json(405, "method not allowed");
      return json(200, await readNotes(env));
    }
    if (url.pathname === "/notes/pending") {
      if (request.method !== "POST") return json(405, "method not allowed");
      return postNotePending(request, env);
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
    if (url.pathname === "/chat" || url.pathname === "/chat/reply") return chatRoute(request, env, url, actor);
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

    if (url.pathname === "/plan/edit") {
      if (request.method !== "POST") return json(405, "method not allowed");
      let b;
      try { b = JSON.parse(await request.text()); } catch (e) { return json(400, "invalid JSON"); }
      return editRoute(b, env, who);
    }

    if (url.pathname === "/plan/reflow") {
      if (request.method !== "POST") return json(405, "method not allowed");
      let b;
      try { b = JSON.parse(await request.text()); } catch (e) { return json(400, "invalid JSON"); }
      return reflowRoute(b, env, who);
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
    if (url.pathname === "/swaps") {
      if (request.method !== "GET") return json(405, "method not allowed");
      return swaps(url.searchParams, env);
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
