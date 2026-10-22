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
// Phase 34: useBy on /pantry, GET /expiring
kv.set("plan", JSON.stringify({ startDate: "2026-10-19", days: [] }));
const pan = (...items) => ({ updatedAt: "2026-10-22T00:00:00.000Z", items });
assert.equal((await call("PUT", "/pantry", "a", pan({ name: "Milk", useBy: "2026-10-30" }, { name: "Yogurt", useBy: "2026-10-18" }, { name: "Chicken breast" }, { name: "Tuna tin" }))).status, 204);
assert.equal((await call("GET", "/pantry", "a")).body.items[0].useBy, "2026-10-30");
for (const bad of ["2026-02-30", "tomorrow", 5, "2026-1-1"])
  assert.equal((await call("PUT", "/pantry", "a", pan({ name: "Milk", useBy: bad }))).status, 400, String(bad));
r = await call("GET", "/expiring?today=2026-10-20", "a");
assert.deepEqual([r.status, r.body.days, r.body.today, r.body.items.map((i) => [i.name, i.basis, i.daysLeft])],
  [200, 2, "2026-10-20", [["Yogurt", "entered", -2], ["Chicken breast", "estimate", 1]]]);
assert.equal((await call("GET", "/expiring?days=30&today=2026-10-20", "h")).status, 200);
assert.equal((await call("GET", "/expiring", "")).status, 401);
for (const q of ["?days=99", "?days=-1", "?days=x", "?today=nope"]) assert.equal((await call("GET", "/expiring" + q, "a")).status, 400, q);
// the assistant token still can't reach other writes
assert.equal((await call("PUT", "/plan", "a", { days: [] })).status, 403);
assert.equal((await call("PUT", "/planPrefs", "a", {})).status, 403);
console.log("worker_test: ok");
