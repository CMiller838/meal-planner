// Runs the real worker/worker.js against an in-memory KV: node tools/worker_test.mjs
// JSON imports (bundler-only in wrangler) get the json attribute here.
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
registerHooks({
  load(url, ctx, next) {
    return next(url, url.endsWith(".json") ? { ...ctx, importAttributes: { type: "json" } } : ctx);
  },
});
const { default: worker } = await import(new URL("../worker/worker.js", import.meta.url));

const kv = new Map();
const env = { AUTH_TOKEN: "h", ASSISTANT_TOKEN: "a", MP_KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) } };
const call = async (method, path, token, body) => {
  const res = await worker.fetch(new Request("https://x" + path, { method, headers: { "X-Auth-Token": token }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, body: await res.json().catch(() => null) };
};
const steps = [{ text: "Boil water", minutes: 10 }, { text: "Serve" }];
kv.set("library", JSON.stringify({ updatedAt: "2026-01-01T00:00:00.000Z", meals: [
  { id: "a", name: "A", ingredients: [{ key: "rice", qty: "100g" }], instructions: "old" },
  { id: "b", name: "B", ingredients: [], method: [{ text: "x" }], methodStatus: "accepted" },
] }));

let r = await call("GET", "/meal/a/method", "a");
assert.deepEqual([r.status, r.body.status, r.body.steps, r.body.ingredients], [200, "none", [], [{ key: "rice", qty: "100g" }]]);
assert.equal((await call("GET", "/meal/zzz/method", "a")).status, 404);
assert.equal((await call("GET", "/meal/a/method", "bad")).status, 401);
assert.equal((await call("PUT", "/meal/a/method", "a", {})).status, 403);

r = await call("PUT", "/meal-method", "a", { mealId: "a", method: steps });
assert.deepEqual([r.status, r.body], [200, { mealId: "a", status: "drafted" }]);
let lib = JSON.parse(kv.get("library"));
assert.equal(lib.meals[0].methodStatus, "drafted");
assert.equal(lib.meals[0].instructions, "old"); // no other field touched
assert.notEqual(lib.updatedAt, "2026-01-01T00:00:00.000Z");
r = await call("GET", "/meal/a/method", "a");
assert.deepEqual([r.body.status, r.body.steps], ["drafted", steps]);
assert.equal((await call("PUT", "/meal-method", "a", { mealId: "a", method: [{ text: "again" }] })).status, 200); // drafted can be redrafted
assert.equal((await call("PUT", "/meal-method", "a", { mealId: "b", method: steps })).status, 409);
assert.equal((await call("PUT", "/meal-method", "a", { mealId: "zzz", method: steps })).status, 404);
for (const bad of [
  { mealId: "a" }, { mealId: "a", method: [] }, { mealId: "a", method: [{ text: "" }] },
  { mealId: "a", method: [{ text: "x".repeat(301) }] }, { mealId: "a", method: [{ text: "x", minutes: 0 }] },
  { mealId: "a", method: [{ text: "x", minutes: 601 }] }, { mealId: "a", method: [{ text: "x", minutes: 1.5 }] },
  { mealId: "a", method: [{ text: "x", extra: 1 }] }, { mealId: "a", method: steps, extra: 1 },
  { mealId: "a", method: Array(31).fill({ text: "x" }) }, [], "str",
]) assert.equal((await call("PUT", "/meal-method", "a", bad)).status, 400, JSON.stringify(bad).slice(0, 60));
assert.equal((await call("PUT", "/meal-method", "bad", { mealId: "a", method: steps })).status, 401);
// Phase 41: /today round trip with the assistant token
const today = { date: "2026-10-22", water: 3, caffeine: 2, gym: true, routineDone: ["protein-shake"] };
assert.equal((await call("PUT", "/today", "a", today)).status, 204);
assert.deepEqual((await call("GET", "/today", "a")).body, today);
for (const bad of [{ ...today, water: 100 }, { ...today, water: -1 }, { ...today, caffeine: 1.5 }, { ...today, date: "22/10" }, { ...today, gym: "yes" }, { ...today, routineDone: [1] }, []])
  assert.equal((await call("PUT", "/today", "a", bad)).status, 400, JSON.stringify(bad));
// Phase 33a: /products
assert.equal((await call("GET", "/products", "")).status, 401);
const prod = { id: "4006381333931", barcode: "4006381333931", name: "Pen", per: "100g", nutrients: { protein_g: { value: 0, basis: "off" }, iron_mg: { value: 2, basis: "estimate" } }, updatedAt: "2026-10-22T00:00:00.000Z" };
const prods = (...p) => ({ updatedAt: "2026-10-22T00:00:00.000Z", products: p });
assert.equal((await call("PUT", "/products", "a", prods(prod, { ...prod, id: "p-1", barcode: null, ingredient: null }))).status, 204);
assert.equal((await call("GET", "/products", "a")).body.products.length, 2);
for (const bad of [
  prods({ ...prod, id: "1234567890123", barcode: "1234567890123" }), prods(prod, prod), prods({ ...prod, id: "other" }),
  prods({ ...prod, nutrients: { protein_g: { value: "5", basis: "off" } } }), prods({ ...prod, nutrients: { protein_g: { value: 5, basis: "guess" } } }),
  prods({ ...prod, nutrients: { protein_g: { value: -1, basis: "off" } } }), prods({ ...prod, per: "100oz" }), prods({ ...prod, name: " " }),
  prods({ ...prod, updatedAt: "yesterday" }), { products: "x" }, [],
]) assert.equal((await call("PUT", "/products", "a", bad)).status, 400, JSON.stringify(bad).slice(0, 80));
// Phase 36: /product-ranking
const rp = (id, price, prot) => ({ ...prod, id: "p-" + id, barcode: null, name: id, price, pack: { value: 500, unit: "g" }, nutrients: { protein_g: { value: prot, basis: "label" } } });
assert.equal((await call("PUT", "/products", "a", prods(rp("dear", 10, 20), rp("cheap", 2, 20), rp("nopack", 1, 20), { ...prod, id: "p-x", barcode: null }))).status, 204);
r = await call("GET", "/product-ranking", "a");
assert.deepEqual([r.status, r.body.ranked.map((x) => [x.id, x.per25g, x.estimated])], [200, [["p-cheap", 0.5, false], ["p-dear", 2.5, false], ["p-nopack", 0.25, false]].sort((x, y) => x[1] - y[1])]);
assert.equal((await call("GET", "/product-ranking", "")).status, 401);
assert.equal((await call("POST", "/product-ranking", "h", {})).status, 405);
// Phase 34: useBy on /pantry, GET /expiring
kv.set("plan", JSON.stringify({ startDate: "2026-10-19", days: [] }));
const pan = (...items) => ({ updatedAt: "2026-10-22T00:00:00.000Z", items });
assert.equal((await call("PUT", "/pantry", "a", pan({ name: "Milk", useBy: "2026-10-30" }, { name: "Yogurt", useBy: "2026-10-18" }, { name: "Chicken breast" }, { name: "Tuna tin" }))).status, 204);
assert.equal((await call("GET", "/pantry", "a")).body.items[0].useBy, "2026-10-30");
for (const bad of ["2026-02-30", "tomorrow", 5, "2026-1-1"])
  assert.equal((await call("PUT", "/pantry", "a", pan({ name: "Milk", useBy: bad }))).status, 400, String(bad));
assert.equal((await call("PUT", "/pantry", "a", pan({ name: "Rice", out: true }))).status, 204);
assert.equal((await call("GET", "/pantry", "a")).body.items[0].out, true);
assert.equal((await call("PUT", "/pantry", "a", pan({ name: "Rice", out: "yes" }))).status, 400);
assert.equal((await call("PUT", "/pantry", "a", pan({ name: "Milk", useBy: "2026-10-30" }, { name: "Yogurt", useBy: "2026-10-18" }, { name: "Chicken breast" }, { name: "Tuna tin" }))).status, 204);
r = await call("GET", "/expiring?today=2026-10-20", "a");
assert.deepEqual([r.status, r.body.days, r.body.today, r.body.items.map((i) => [i.name, i.basis, i.daysLeft])],
  [200, 2, "2026-10-20", [["Yogurt", "entered", -2], ["Chicken breast", "estimate", 1]]]);
assert.equal((await call("GET", "/expiring?days=30&today=2026-10-20", "h")).status, 200);
assert.equal((await call("GET", "/expiring", "")).status, 401);
for (const q of ["?days=99", "?days=-1", "?days=x", "?today=nope"]) assert.equal((await call("GET", "/expiring" + q, "a")).status, 400, q);
// Phase 51: ratings, per-meal route, /why
r = await call("PUT", "/meal/a/rating", "a", { rating: "up", note: "  tasty  " });
assert.deepEqual([r.status, r.body.rating, r.body.note, r.body.never, typeof r.body.at], [200, "up", "tasty", false, "string"]);
r = await call("PUT", "/meal/a/rating", "h", { never: true }); // other token merges into the same record
assert.deepEqual([r.status, r.body.rating, r.body.note, r.body.never], [200, "up", "tasty", true]);
r = await call("PUT", "/meal/a/rating", "a", { rating: null, note: "x".repeat(300) });
assert.deepEqual([r.body.rating, r.body.note.length, r.body.never], [null, 120, true]);
assert.deepEqual(Object.keys((await call("GET", "/ratings", "a")).body.meals), ["a"]);
assert.equal((await call("PUT", "/meal/zzz/rating", "a", { rating: "up" })).status, 404);
for (const bad of [{ rating: "meh" }, { note: 1 }, { never: "yes" }, { other: 1 }, []]) assert.equal((await call("PUT", "/meal/a/rating", "a", bad)).status, 400, JSON.stringify(bad));
assert.equal((await call("PUT", "/ratings", "a", { meals: {} })).status, 403);
assert.equal((await call("GET", "/meal/a/rating", "h")).status, 405);
assert.equal((await call("GET", "/ratings", "")).status, 401);
// /why: each code flips off when its input goes
const { readFileSync } = await import("node:fs");
const tags = JSON.parse(readFileSync(new URL("../ingredient-nutrient-tags.json", import.meta.url), "utf8"));
const TRACKED = ["fibre", "vitA", "vitC", "vitD", "vitB12", "folate", "calcium", "iron", "zinc", "magnesium", "potassium"];
const hi = Object.keys(tags).find((k) => typeof tags[k] === "object" && TRACKED.some((n) => tags[k][n]));
const wlib = [
  { id: "m1", name: "Dish", mealTypes: ["dinner"], prepEffort: "quick", ingredients: [{ key: hi, label: hi, qty: "1" }] },
  { id: "m2", name: "Other", mealTypes: ["dinner"], prepEffort: "batch", ingredients: [] },
];
kv.set("library", JSON.stringify(wlib));
kv.set("plan", JSON.stringify({ startDate: "2026-10-19", days: Array.from({ length: 14 }, () => ({ slots: {} })) }));
const codes = async (day = 1) => (await call("GET", `/why?meal=m1&day=${day}&slot=dinner`, "a")).body.reasons.map((x) => x.code);
kv.set("planPrefs", JSON.stringify({ busyDays: [], chips: [] }));
kv.set("ratings", JSON.stringify({ meals: {} }));
assert.ok((await codes()).includes("fills_gap"), "fills_gap with empty day");
assert.ok(!(await codes()).some((c) => ["chip", "quick", "liked", "disliked"].includes(c)), "no other codes by default");
kv.set("planPrefs", JSON.stringify({ busyDays: [1], chips: [] }));
assert.ok((await codes()).includes("quick"));
assert.ok(!(await codes(2)).includes("quick"));
const whyM2 = async () => (await call("GET", "/why?meal=m2&day=1&slot=dinner", "a")).body.reasons.map((x) => x.code);
kv.set("planPrefs", JSON.stringify({ busyDays: [], chips: ["comfort"] })); // prepEffort batch
assert.ok((await whyM2()).includes("chip"));
kv.set("planPrefs", JSON.stringify({ busyDays: [], chips: [] }));
assert.ok(!(await whyM2()).includes("chip"));
await call("PUT", "/meal/m1/rating", "a", { rating: "up" });
assert.ok((await codes()).includes("liked"));
await call("PUT", "/meal/m1/rating", "a", { rating: "down" });
assert.ok((await codes()).includes("disliked") && !(await codes()).includes("liked"));
await call("PUT", "/meal/m1/rating", "a", { rating: null });
assert.ok(!(await codes()).some((c) => c === "liked" || c === "disliked"));
r = await call("GET", "/why?meal=m1&day=1&slot=dinner", "a");
assert.deepEqual([r.status, r.body.rank, r.body.approximate], [200, 1, true]);
await call("PUT", "/meal/m1/rating", "a", { never: true });
assert.equal((await call("GET", "/why?meal=m1&day=1&slot=dinner", "a")).body.rank, null);
assert.equal((await call("GET", "/why?meal=zz&day=1&slot=dinner", "a")).status, 404);
assert.equal((await call("GET", "/why?meal=m1&day=0", "a")).status, 400);

// the assistant token still can't reach other writes
assert.equal((await call("PUT", "/plan", "a", { days: [] })).status, 403);
assert.equal((await call("PUT", "/planPrefs", "a", {})).status, 403);

// Phase 53: /scale
kv.set("library", JSON.stringify({ meals: [{ id: "chilli", name: "Chilli", servings: 4, prepEffort: "batch",
  method: [{ text: "a", minutes: 10 }, { text: "b", minutes: 20 }, { text: "c" }],
  ingredients: [{ key: "garlic", qty: "2 cloves" }, { key: "rice", qty: "200g" }, { key: "cheese", qty: "handful, grated" }] }] }));
kv.set("pantry", JSON.stringify({ items: [{ name: "rice", qty: "1kg" }] }));
r = await call("GET", "/scale?meal=chilli&portions=6", "a");
assert.equal(r.status, 200);
assert.deepEqual(r.body.lines.map((l) => [l.scaled, l.check]), [["3 cloves", false], ["300g", false], ["handful, grated", true]]);
assert.deepEqual([r.body.buy.map((l) => l.key), r.body.covered.map((l) => l.key)], [["garlic", "cheese"], ["rice"]]);
assert.deepEqual(r.body.cookTime, { minutes: 30, prepEffort: "batch" });
assert.deepEqual(r.body.storage, { fridgeDays: 3, freezerMonths: 3, estimate: true });
r = await call("GET", "/scale?meal=chilli&portions=4", "a");
assert.deepEqual(r.body.lines.map((l) => l.scaled), ["2 cloves", "200g", "handful, grated"]);
for (const p of ["0", "13", "x", "1.5"]) assert.equal((await call("GET", `/scale?meal=chilli&portions=${p}`, "a")).status, 400);
assert.equal((await call("GET", "/scale?meal=nope&portions=2", "a")).status, 404);
kv.delete("pantry");
assert.equal((await call("GET", "/scale?meal=chilli&portions=2", "a")).body.buy.length, 3);
// Phase 50: /drafts
const dr = { name: "Lentil curry", servings: 4, source: "link", sourceRef: "https://x/y", cost: 3.5, unreadable: ["amount of salt"],
  tags: { iron: "high" }, ingredients: [{ name: "Rice", qty: "200g" }, { name: "Dragonfruit paste" }], method: [{ text: "Cook" }] };
r = await call("POST", "/drafts", "a", dr);
assert.equal(r.status, 201);
assert.match(r.body.id, /^draft-[0-9a-f]{8}$/);
assert.deepEqual(r.body.unmatched, ["Dragonfruit paste"]);
const g = (await call("GET", "/drafts", "a")).body;
assert.deepEqual([g.drafts.length, g.drafts[0].ingredients.map((i) => i.key)], [1, ["rice", null]]);
assert.equal(g.drafts[0].createdAt.length > 10, true);
for (const bad of [{ ...dr, extra: 1 }, { ...dr, id: "x" }, { ...dr, name: "" }, { ...dr, source: "web" }, { ...dr, ingredients: [] },
  { ...dr, ingredients: [{ name: "Rice", key: "rice" }] }, { ...dr, tags: { iron: "huge" } }, { ...dr, tags: { bogus: "low" } }, { ...dr, cost: -1 },
  { ...dr, servings: 13 }, { ...dr, method: [] }, [], "s"])
  assert.equal((await call("POST", "/drafts", "a", bad)).status, 400, JSON.stringify(bad).slice(0, 60));
r = await call("POST", "/drafts", "a", { name: "Mushroom stew", source: "description", ingredients: [{ name: "Mushrooms" }] });
assert.deepEqual([r.status, r.body.reasons], [422, ["contains mushroom"]]);
assert.equal(JSON.parse(kv.get("drafts")).drafts.length, 1); // 422 stored nothing
assert.equal((await call("PUT", "/drafts", "a", {})).status, 403);
assert.equal((await call("PUT", "/drafts", "h", {})).status, 405);
assert.equal((await call("POST", "/drafts", "bad", dr)).status, 401);
assert.equal((await call("DELETE", "/drafts/nope", "a")).status, 404);
for (let i = 1; i < 20; i++) assert.equal((await call("POST", "/drafts", "a", dr)).status, 201);
assert.equal((await call("POST", "/drafts", "a", dr)).status, 409);
const first = JSON.parse(kv.get("drafts")).drafts[0].id;
assert.equal((await call("DELETE", "/drafts/" + first, "a")).status, 204);
assert.equal(JSON.parse(kv.get("drafts")).drafts.length, 19);
assert.equal((await call("DELETE", "/drafts/" + first, "a")).status, 404);
assert.equal(JSON.stringify(JSON.parse(kv.get("library")).meals.map((m) => m.id)), '["chilli"]'); // library untouched
kv.delete("drafts");
assert.deepEqual((await call("GET", "/drafts", "a")).body.drafts, []);
console.log("worker_test: ok");
