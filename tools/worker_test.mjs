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
// the assistant token still can't reach other writes
assert.equal((await call("PUT", "/plan", "a", { days: [] })).status, 403);
assert.equal((await call("PUT", "/planPrefs", "a", {})).status, 403);
console.log("worker_test: ok");
