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
const { ChatRoom } = await import(new URL("../worker/worker.js", import.meta.url));
const chatMem = new Map(); // Phase 72: in-memory ChatRoom storage behind a fake namespace (one instance, like idFromName("plan"))
const room = new ChatRoom({ storage: { get: async (k) => structuredClone(chatMem.get(k)), put: async (k, v) => void chatMem.set(k, structuredClone(v)) } });
const env = { CHAT: { idFromName: (n) => n, get: () => ({ fetch: (req) => room.fetch(req) }) }, AUTH_TOKEN: "h", ASSISTANT_TOKEN: "a", MP_KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) } };
const call = async (method, path, token, body, headers = {}) => {
  const res = await worker.fetch(new Request("https://x" + path, { method, headers: { "X-Auth-Token": token, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
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
// Phase 48: activity log and undo
const acts = () => JSON.parse(kv.get("activity") || '{"entries":[]}').entries;
const P = (...items) => ({ updatedAt: "2026-10-22T00:00:00.000Z", items });
kv.delete("activity");
assert.equal((await call("PUT", "/pantry", "h", P({ name: "Rice", qty: "500g" }))).status, 204);
assert.equal(acts().length, 0); // app token logs nothing
assert.equal((await call("PUT", "/pantry", "a", P({ name: "Rice", qty: "500g" }), { "X-Reason": " restock " })).status, 204);
assert.equal(acts().length, 0); // no-op
assert.equal((await call("PUT", "/pantry", "a", { ...P({ name: "Rice", qty: "500g" }), updatedAt: "2027-01-01T00:00:00.000Z" })).status, 204);
assert.equal(acts().length, 0); // only updatedAt differs
r = await call("PUT", "/pantry?dryRun=1", "a", P({ name: "Rice", qty: "400g" }, { name: "Milk" }));
assert.deepEqual([r.status, r.body.changes.length, acts().length, JSON.parse(kv.get("pantry")).items[0].qty], [200, 2, 0, "500g"]);
assert.equal((await call("PUT", "/pantry?dryRun=1", "a", { items: "x" })).status, 400);
assert.equal((await call("PUT", "/pantry", "a", P({ name: "Rice", qty: "400g" }, { name: "Milk" }), { "X-Reason": "  used rice, bought milk " + "x".repeat(200) })).status, 204);
let e0 = acts()[0];
assert.deepEqual([acts().length, e0.who, e0.key, e0.changes.length, e0.why.length, e0.why.startsWith("used rice")], [1, "assistant", "pantry", 2, 120, true]);
assert.match(e0.summary, /pantry: changed rice, added milk/i);
assert.equal((await call("GET", "/activity", "a")).body.entries.length, 1);
// app edits rice after the assistant write -> stale
assert.equal((await call("PUT", "/pantry", "h", P({ name: "Rice", qty: "300g" }, { name: "Milk" }))).status, 204);
r = await call("POST", "/activity/undo", "a", { id: e0.id });
assert.deepEqual([r.status, r.body.error, r.body.changed.map((c) => c.id)], [409, "changed since", ["rice"]]);
r = await call("POST", "/activity/undo", "a", { id: e0.id, force: true }); // force is the app's call, not the assistant token's
assert.equal(r.status, 409);
r = await call("POST", "/activity/undo", "h", { id: e0.id, force: true });
assert.equal(r.status, 200);
let pi = JSON.parse(kv.get("pantry")).items;
assert.deepEqual([pi.length, pi[0].qty], [1, "500g"]);
assert.equal(acts()[0].undoes, e0.id);
r = await call("POST", "/activity/undo", "a", { id: e0.id, force: true });
assert.deepEqual([r.status, r.body.error], [409, "already undone"]);
for (const bad of [{}, { id: 5 }, "x"]) assert.equal((await call("POST", "/activity/undo", "a", bad)).status, 400);
assert.equal((await call("POST", "/activity/undo", "a", { id: "nope" })).status, 404);
// redo: undoing the undo works
r = await call("POST", "/activity/undo", "h", { id: acts()[0].id });
assert.equal(r.status, 200);
assert.equal(JSON.parse(kv.get("pantry")).items.length, 2);
// clean undo
kv.delete("activity");
await call("PUT", "/pantry", "a", P({ name: "Rice", qty: "500g" }, { name: "Eggs" }));
r = await call("POST", "/activity/undo", "a", { id: acts()[0].id });
assert.equal(r.status, 200);
// library: append, method, undo bumps updatedAt, bare-array & whole-value keys
kv.delete("activity");
lib = JSON.parse(kv.get("library"));
assert.equal((await call("PUT", "/library", "a", { ...lib, meals: [...lib.meals, { id: "n", name: "N", ingredients: [], addedBy: "assistant" }] })).status, 204);
assert.deepEqual([acts().length, acts()[0].changes.map((c) => c.id)], [1, ["n"]]);
assert.equal((await call("PUT", "/meal-method", "a", { mealId: "a", method: steps })).status, 200);
assert.deepEqual([acts().length, acts()[0].key, acts()[0].changes.map((c) => c.id)], [2, "library", ["a"]]);
const before = JSON.parse(kv.get("library")).updatedAt;
await new Promise((ok) => setTimeout(ok, 5));
assert.equal((await call("POST", "/activity/undo", "a", { id: acts()[1].id })).status, 200);
lib = JSON.parse(kv.get("library"));
assert.deepEqual([lib.meals.some((m) => m.id === "n"), lib.updatedAt > before], [false, true]);
r = await call("PUT", "/dayHints", "a", { updatedAt: "2026-10-22T00:00:00.000Z", days: { "2026-10-23": { effort: "busy" } } });
assert.equal(r.status, 204, JSON.stringify(r.body));
assert.deepEqual(acts()[0].changes.map((c) => c.id), ["2026-10-23"]);
await call("PUT", "/today", "a", { ...today, water: 4 });
assert.deepEqual([acts()[0].key, acts()[0].changes.map((c) => c.id)], ["today", ["today"]]);
assert.equal((await call("POST", "/activity/undo", "a", { id: acts()[0].id })).status, 200);
assert.equal(JSON.parse(kv.get("today")).water, 3);
// cap 200, append-only, malformed key
kv.delete("activity");
await call("PUT", "/pantry", "a", P({ name: "Salt", qty: "0" }));
const firstAct = acts()[0];
for (let i = 1; i < 205; i++) await call("PUT", "/pantry", "a", P({ name: "Salt", qty: String(i) }));
const all = acts();
assert.deepEqual([all.length, all.some((x) => x.id === firstAct.id), all[0].changes[0].after.qty], [200, false, "204"]);
const snap = JSON.stringify(all);
await call("PUT", "/pantry", "a", P({ name: "Salt", qty: "x" }));
assert.equal(JSON.stringify(acts().slice(1)), JSON.stringify(JSON.parse(snap).slice(0, 199)));
kv.set("activity", "garbage{");
assert.equal((await call("GET", "/activity", "a")).body.entries.length, 0);
assert.equal((await call("PUT", "/pantry", "a", P({ name: "Salt", qty: "y" }))).status, 204);
assert.equal(acts().length, 1);
kv.delete("activity");
assert.deepEqual((await call("GET", "/activity", "a")).body, { entries: [] });
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
// Phase 74: a rating PUT with X-Actor is logged and undoable; without it (hermes token, no header) nothing is logged
kv.delete("activity"); kv.delete("ratings");
await call("PUT", "/meal/b/rating", "h", { rating: "up" });
assert.equal(acts().length, 0);
r = await call("PUT", "/meal/b/rating", "h", { rating: "down", note: "too fiddly" }, { "X-Actor": "hermes", "X-Reason": "rejected in chat" });
assert.equal(acts().length, 1);
const upAt = JSON.parse(kv.get("ratings")).meals.b.at;
r = await call("POST", "/activity/undo", "h", { id: acts()[0].id }, { "X-Actor": "hermes" });
assert.equal(r.status, 200);
let rb = JSON.parse(kv.get("ratings")).meals.b;
assert.deepEqual([rb.rating, rb.note], ["up", ""]);
assert.ok(rb.at >= upAt);
kv.delete("ratings");
await call("PUT", "/meal/b/rating", "h", { note: "x" }, { "X-Actor": "hermes" });
await call("POST", "/activity/undo", "h", { id: acts()[0].id }, { "X-Actor": "hermes" });
rb = JSON.parse(kv.get("ratings")).meals.b;
assert.deepEqual([rb.rating, rb.note, rb.never], [null, "", false]);
// Phase 77: weekly spend log
kv.delete("activity"); kv.delete("spend");
const sp = (b) => call("POST", "/spend", "a", b);
assert.deepEqual((await call("GET", "/spend", "a")).body, { weeks: {}, budgetTarget: 0 });
assert.equal((await sp({ week: "2026-10-24", total: 80.5, source: "asda" })).status, 200);
assert.equal((await sp({ week: "2026-10-24", total: 92, source: "manual" })).status, 200);
r = (await call("GET", "/spend", "a")).body;
assert.deepEqual(Object.keys(r.weeks), ["2026-10-24"]);
assert.deepEqual([r.weeks["2026-10-24"].total, r.weeks["2026-10-24"].source], [92, "manual"]);
assert.equal(acts().length, 2);
r = await call("POST", "/activity/undo", "a", { id: acts()[0].id });
assert.equal(r.status, 200);
assert.equal((await call("GET", "/spend", "a")).body.weeks["2026-10-24"].total, 80.5);
for (const bad of [{ week: "24/10", total: 1, source: "asda" }, { week: "2026-02-31", total: 1, source: "asda" }, { week: "2026-10-24", total: -1, source: "asda" },
  { week: "2026-10-24", total: "9", source: "asda" }, { week: "2026-10-24", total: 1, source: "tesco" }, { week: "2026-10-24", total: 1, source: "asda", x: 1 }, []]) {
  assert.equal((await sp(bad)).status, 400, JSON.stringify(bad));
}
kv.set("settings", JSON.stringify({ budgetTarget: 75 }));
assert.equal((await call("GET", "/spend", "a")).body.budgetTarget, 75);
kv.delete("settings");
kv.delete("activity");
// Phase 78: pantry audit
{
  const T = "2026-10-24", ago = (n) => new Date(Date.parse(T) - n * 86400000).toISOString().slice(0, 10);
  const pantry = JSON.stringify({ updatedAt: "2026-10-01T00:00:00.000Z", items: [
    { name: "chicken breast", qty: "500g" }, // fridge, no useBy -> no-use-by
    { name: "milk", useBy: "2026-10-30" }, // fridge, never confirmed
    { name: "butter", useBy: "2026-11-30", storage: "fridge" }, // confirmed 3 days ago
    { name: "yoghurt", useBy: "2026-11-30", storage: "fridge", out: true },
    { name: "cheese", useBy: "2026-11-30", storage: "fridge" }, // stale (90 days)
    { name: "carrot", qty: { value: -1, unit: "each", raw: "-1" }, useBy: "2026-11-30", storage: "fridge" },
    { name: "carrots", useBy: "2026-11-30", storage: "fridge" },
    { name: "flour", qty: { value: 50000, unit: "g", raw: "50kg" }, storage: "cupboard" },
    { name: "zzzunknownthing" },
  ] });
  kv.set("pantry", pantry);
  kv.set("pantryAudit", JSON.stringify({ updatedAt: "x", confirmed: { butter: ago(3), cheese: ago(90) }, snoozes: {} }));
  const san = async () => (await call("GET", `/pantry/sanity?today=${T}`, "a")).body.findings;
  const ids = async () => (await san()).map((f) => f.id);
  let f = await ids();
  for (const id of ["negative-qty:carrot", "implausible-qty:flour", "stale:cheese", "no-use-by:chicken_breast", "duplicate:carrot"]) assert.ok(f.includes(id), id + " in " + f);
  assert.ok(!f.some((x) => x.startsWith("stale:milk")), "never-confirmed is not stale");
  const nu = (await san()).find((x) => x.class === "no-use-by" && x.name === "chicken breast");
  assert.ok(nu, "no-use-by fires");
  const snz = (days, today = T) => call("POST", `/pantry/audit?today=${today}`, "a", { snooze: [{ id: nu.id, days }] }, { "X-Actor": "assistant" });
  assert.equal((await snz(7)).status, 200);
  assert.ok(!(await ids()).includes(nu.id), "snoozed");
  assert.ok((await call("GET", `/pantry/sanity?today=${ago(-8)}`, "a")).body.findings.some((x) => x.id === nu.id), "back after snooze");
  await snz(0);
  assert.ok((await ids()).includes(nu.id), "days 0 clears");

  let a = (await call("GET", `/pantry/audit?location=fridge&today=${T}`, "a")).body;
  const names = a.items.map((i) => i.name);
  assert.ok(!names.includes("butter") && !names.includes("yoghurt"), "recent and out skipped: " + names);
  assert.equal(names[names.length - 1], "cheese"); // confirmed items last
  assert.ok(names.indexOf("milk") < names.indexOf("cheese"));
  assert.ok(a.unsorted >= 1);
  assert.equal(a.items.find((i) => i.name === "cheese").lastConfirmed, ago(90));
  const total = names.length;
  a = (await call("GET", `/pantry/audit?location=fridge&limit=2&today=${T}`, "a")).body;
  assert.deepEqual([a.items.length, a.remaining], [2, total - 2]);

  const before = kv.get("pantry"), auditBefore = kv.get("pantryAudit");
  const pa = (b, h = {}) => call("POST", `/pantry/audit?today=${T}`, "a", b, h);
  r = await pa({ confirmed: ["milk", "nope"] });
  assert.equal(r.status, 400);
  assert.equal(kv.get("pantryAudit"), auditBefore);
  assert.equal((await pa({ confirmed: ["Milk"] }, { "X-Actor": "assistant" })).status, 200);
  assert.equal(JSON.parse(kv.get("pantryAudit")).confirmed.milk, T);
  const entry = acts()[0];
  assert.equal(entry.key, "pantryAudit");
  assert.equal((await call("POST", "/activity/undo", "a", { id: entry.id })).status, 200);
  assert.equal(JSON.parse(kv.get("pantryAudit")).confirmed.milk, undefined);
  assert.equal(JSON.parse(kv.get("pantryAudit")).confirmed.butter, ago(3));
  assert.equal(kv.get("pantry"), before, "pantry untouched");

  for (const p of ["location=garage", "location=fridge&limit=0", "location=fridge&limit=21", "location=fridge&today=bad", "limit=3"])
    assert.equal((await call("GET", `/pantry/audit?${p}`, "a")).status, 400, p);
  assert.equal((await call("GET", "/pantry/sanity?today=bad", "a")).status, 400);
  for (const b of [{ snooze: [{ id: "x", days: 91 }] }, { snooze: [{ id: "", days: 1 }] }, { snooze: [{ id: "x", days: 1.5 }] }, {}, [], { confirmed: [""] }, { other: 1 }])
    assert.equal((await pa(b)).status, 400, JSON.stringify(b));
  for (const [m, p] of [["GET", "/pantry/audit?location=fridge"], ["GET", "/pantry/sanity"], ["POST", "/pantry/audit"]]) {
    assert.equal((await call(m, p, "", m === "POST" ? { confirmed: ["milk"] } : undefined)).status, 401, p);
    assert.equal((await call(m, p, "a", m === "POST" ? { confirmed: ["milk"] } : undefined)).status, 200, p);
  }
  assert.equal(kv.get("pantry"), before, "pantry byte-identical after all calls");
  kv.delete("pantry"); kv.delete("pantryAudit");
  assert.deepEqual((await call("GET", "/pantry/sanity", "a")).body.findings, []);
  assert.deepEqual((await call("GET", "/pantry/audit?location=fridge", "a")).body.items, []);
  kv.delete("activity");
}
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


// Phase 43: cookable / substitutions / leftovers / quick / cooks / storage (same fixture as test.html's cookable block)
{
  const ing = (...keys) => keys.map((k) => ({ key: k, qty: "100g" }));
  const lib43 = [
    { id: "r1", name: "R1", prepEffort: "quick", ingredients: ing("rice", "chicken_breast") },
    { id: "r2", name: "R2", prepEffort: "batch", ingredients: ing("rice", "onion") },
    { id: "near", name: "Near", ingredients: ing("rice", "saffron") },
    { id: "far", name: "Far", ingredients: ing("saffron", "truffle", "caviar") },
    { id: "mush", name: "Mush", ingredients: ing("rice", "mushroom") },
    { id: "skip", name: "Skip", ingredients: [{ key: "leftover_chicken", qty: "leftover" }, ...ing("rice")] },
    { id: "empty", name: "Empty", ingredients: [{ key: "leftover_chicken", qty: "leftover" }] },
  ];
  kv.set("library", JSON.stringify({ updatedAt: "2026-10-20T00:00:00.000Z", meals: lib43 }));
  kv.set("plan", JSON.stringify({ startDate: "2026-10-19", days: [] }));
  assert.equal((await call("PUT", "/pantry", "a", { items: [{ name: "Rice", qty: "1kg" }, { name: "Chicken breast" }, { name: "Onion", useBy: "2026-10-20" }, { name: "Frozen veg", storage: "freezer" }] })).status, 204);
  assert.deepEqual((await call("GET", "/pantry", "a")).body.items[3], { name: "Frozen veg", storage: "freezer" }); // round trip keeps storage
  for (const bad of ["attic", 3]) assert.equal((await call("PUT", "/pantry", "a", { items: [{ name: "Rice", storage: bad }] })).status, 400);

  r = await call("GET", "/cookable?today=2026-10-20", "a");
  assert.deepEqual([r.status, r.body.ready.map((p) => p.id), r.body.nearMiss.map((p) => p.id)], [200, ["r2", "r1", "skip"], ["near"]]);
  assert.equal((await call("GET", "/cookable?today=2026-10-20&n=1", "h")).body.ready.length, 1);
  assert.equal((await call("GET", "/substitutions", "a")).body.groups[0].id, "aromatic_veg");
  for (const path of ["/cookable", "/substitutions", "/leftovers", "/quick"]) {
    assert.equal((await call("GET", path, "")).status, 401, path);
    assert.equal((await call("GET", path, "h")).status, 200, path);
  }
  for (const q of ["/cookable?n=99", "/cookable?n=0", "/quick?n=x", "/leftovers?today=nope", "/quick?today=nope"]) assert.equal((await call("GET", q, "a")).status, 400, q);

  assert.deepEqual((await call("GET", "/leftovers?today=2026-10-20", "a")).body.leftovers, []); // no cooks yet
  const cooks = [
    { id: "a", mealId: "r1", name: "R1", cookedAt: "2026-10-19T12:00:00.000Z", portionsLeft: 2 },
    { id: "d", mealId: "r1", name: "R1", cookedAt: "2026-10-01T12:00:00.000Z", portionsLeft: 1, storage: "freezer" },
  ];
  assert.equal((await call("PUT", "/cooks", "a", cooks)).status, 403);
  assert.equal((await call("PUT", "/cooks", "h", cooks)).status, 204);
  for (const bad of [{}, [{ id: "x" }], [{ ...cooks[0], portionsLeft: 1.5 }], [{ ...cooks[0], portionsLeft: -1 }], [{ ...cooks[0], storage: "cupboard" }], Array(201).fill(cooks[0])])
    assert.equal((await call("PUT", "/cooks", "h", bad)).status, 400, JSON.stringify(bad).slice(0, 50));
  r = await call("GET", "/leftovers?today=2026-10-20", "a");
  assert.deepEqual(r.body.leftovers.map((l) => [l.id, l.storage, l.eatBy, l.lastDay]), [["a", "fridge", "2026-10-22", false], ["d", "freezer", "2027-01-01", false]]);
  r = await call("GET", "/quick?today=2026-10-20", "a");
  assert.deepEqual(r.body.items.map((i) => i.kind + ":" + (i.id || i.name)), ["meal:r1", "leftover:a", "leftover:d", "frozen:Frozen veg"]);
  kv.set("cooks", "garbage"); kv.set("pantry", "garbage");
  assert.equal((await call("GET", "/quick?today=2026-10-20", "a")).status, 200); // malformed KV = empty, never 500
}

// Phase 80: a leftover placement validates (shape only)
{
  const pl = { mealId: "chilli", day: 1, slot: "dinner", mealName: "Chilli", requestedAt: "2026-10-26T10:00:00Z" };
  assert.equal((await call("PUT", "/placements", "h", { placements: [{ ...pl, leftover: true, portions: 3 }] })).status, 204);
  assert.equal((await call("PUT", "/placements", "h", { placements: [{ ...pl, leftover: true }] })).status, 204);
  for (const bad of [{ leftover: "yes" }, { leftover: true, portions: 0 }, { leftover: true, portions: 13 }, { leftover: true, portions: 1.5 }, { portions: 2 }])
    assert.equal((await call("PUT", "/placements", "h", { placements: [{ ...pl, ...bad }] })).status, 400, JSON.stringify(bad));
  assert.equal((await call("PUT", "/placements", "a", { placements: [{ ...pl, leftover: true }] })).status, 204); // the assistant token proposes placements, leftover included
  assert.equal((await call("PUT", "/placements", "a", { placements: [{ ...pl, leftover: 1 }] })).status, 400);
}

// the assistant token still can't reach other writes
assert.equal((await call("PUT", "/plan", "a", { days: [] })).status, 403);
assert.equal((await call("PUT", "/planPrefs", "a", {})).status, 403);
// Phase 88: timeCaps validated
for (const [tc, st] of [[{ 1: 30 }, 204], [{}, 204], [{ 7: 30 }, 400], [{ 1: 4 }, 400], [{ 1: 241 }, 400], [[30], 400], ["x", 400]])
  assert.equal((await call("PUT", "/planPrefs", "h", { updatedAt: "2026-10-26T10:00:00Z", busyDays: [], chips: [], timeCaps: tc })).status, st, JSON.stringify(tc));

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
// Phase 52: /settings (Phase 48's logWrite/ITEMS are absent, so no activity-log assert)
assert.equal((await call("GET", "/settings", "")).status, 401);
assert.deepEqual((await call("GET", "/settings", "a")).body, {});
r = await call("PUT", "/settings", "a", { targets: { calories: 2400, protein: 170, weight: 80 }, allergies: [" Peanut "], dislikes: ["olives"], budget: 35 });
assert.equal(r.status, 200);
assert.deepEqual([r.body.settings.targets, r.body.settings.allergies, r.body.settings.dislikes, r.body.settings.budgetTarget, r.body.ignored],
  [{ energy_kcal: 2400, protein_g: 170 }, ["peanut"], ["olives"], 35, ["weight"]]);
assert.equal((await call("GET", "/settings", "a")).body.targets.protein_g, 170);
for (const bad of [{ targets: { protein: -1 } }, { targets: { protein: 99999 } }, { allergies: "nuts" }, { likes: ["x".repeat(41)] }, []])
  assert.equal((await call("PUT", "/settings", "a", bad)).status, 400, JSON.stringify(bad));
assert.equal((await call("PUT", "/settings", "h", { targets: {} })).status, 200);
assert.equal((await call("PUT", "/settings", "a", { targets: { calories: 2400 }, allergies: ["peanut"], dislikes: ["olives"] })).status, 200);
// Phase 91: /notes
assert.equal((await call("GET", "/notes", "")).status, 401);
assert.deepEqual((await call("GET", "/notes", "a")).body.items, []);
r = await call("PUT", "/notes", "a", { items: [" Hates Sunday cooking ", "hates sunday cooking", "", "No fish"] });
assert.deepEqual([r.status, r.body.items], [200, ["Hates Sunday cooking", "No fish"]]);
for (const bad of [{ items: "x" }, {}, { items: [1] }, { items: ["x".repeat(201)] }, { items: Array.from({ length: 31 }, (_, i) => "n" + i) }])
  assert.equal((await call("PUT", "/notes", "a", bad)).status, 400, JSON.stringify(bad).slice(0, 50));
assert.deepEqual((await call("GET", "/notes", "a")).body.items, ["Hates Sunday cooking", "No fish"]); // bad PUTs left KV alone
assert.equal((await call("POST", "/notes/pending", "a", { text: "x" })).status, 403);
assert.equal((await call("POST", "/notes/pending", "h", { text: "  " })).status, 400);
assert.equal((await call("POST", "/notes/pending", "h", { text: "NO FISH" })).status, 409);
r = await call("POST", "/notes/pending", "h", { text: "Likes soup" });
assert.deepEqual([r.status, r.body.pending.length, r.body.pending[0].text], [200, 1, "Likes soup"]);
assert.equal((await call("POST", "/notes/pending", "h", { text: "likes SOUP" })).status, 409);
assert.equal((await call("PUT", "/notes", "a", { items: ["No fish"] })).body.pending.length, 1); // stale PUT keeps pending
assert.equal((await call("PUT", "/notes", "a", { items: ["No fish", "likes soup"] })).body.pending.length, 0); // accepted note clears it
assert.equal((await call("GET", "/notes", "a")).body.pending.length, 0);
kv.delete("notes");
// ranking: peanut meal never returned, olive meal after an otherwise-equal one
kv.set("library", JSON.stringify([
  { id: "p", name: "P", mealTypes: ["dinner"], ingredients: [{ key: "peanut butter", label: "Peanut butter" }] },
  { id: "o", name: "O", mealTypes: ["dinner"], ingredients: [{ key: "olives", label: "Olives" }] },
  { id: "e", name: "E", mealTypes: ["dinner"], ingredients: [{ key: "rice", label: "Rice" }] },
]));
kv.set("plan", JSON.stringify({ startDate: "2026-10-22", days: Array.from({ length: 14 }, (_, i) => ({ day: i + 1, slots: {} })) }));
r = await call("GET", "/ranking?day=1&slot=dinner&n=10", "h");
assert.equal(r.status, 200);
const ids = r.body.candidates.map((m) => m.mealId);
assert.ok(ids.length && !ids.includes("p") && ids.indexOf("e") < ids.indexOf("o"), JSON.stringify(r.body).slice(0, 200));

// Phase 62: taste only reorders; removing ratings restores the no-taste order
{
  const mk = (id, k) => ({ id, name: id, mealTypes: ["dinner"], prepEffort: "quick", ingredients: [{ key: k, label: k }] });
  kv.set("plan", JSON.stringify({ startDate: "2026-10-22", days: Array.from({ length: 14 }, (_, i) => ({ day: i + 1, slots: {} })) }));
  kv.set("library", JSON.stringify([mk("u1", "lime"), mk("u2", "lime"), mk("u3", "lime"), mk("d1", "beef"), mk("d2", "beef"), mk("d3", "beef"), mk("x1", "beef"), mk("x2", "lime")]));
  const order = async () => ((r) => { if (!r.body.candidates) throw new Error(JSON.stringify(r.body)); return r.body.candidates; })(await call("GET", "/ranking?day=1&slot=dinner&n=10", "h")).map((m) => m.mealId);
  kv.delete("ratings");
  const base = await order();
  const rate = (up, down) => JSON.stringify({ meals: Object.fromEntries([...up.map((i) => [i, { rating: "up" }]), ...down.map((i) => [i, { rating: "down" }])]) });
  kv.set("ratings", rate(["u1", "u2", "u3"], ["d1", "d2", "d3"]));
  const withT = await order();
  assert.deepEqual([...withT].sort(), [...base].sort());
  assert.ok(withT.indexOf("x2") < withT.indexOf("x1"), withT.join());
  kv.delete("ratings");
  assert.deepEqual(await order(), base);
}

// Phase 54: GET /day
kv.clear();
const D = "2026-10-22";
kv.set("library", JSON.stringify([
  { id: "d1", name: "Dinner One", mealTypes: ["dinner"], ingredients: [{ key: "rice", label: "Rice" }] },
  { id: "r1", name: "Vitamins", routine: { when: "daily", time: "08:00" }, ingredients: [] },
  { id: "r2", name: "Creatine", routine: { when: "daily", time: "09:00" }, ingredients: [] },
]));
r = await call("GET", `/day?date=${D}`, "a"); // empty KV apart from the library
assert.equal(r.status, 200);
assert.deepEqual(r.body.cards.map((c) => c.type), ["routine", "routine", "counter", "counter", "coverage"]);
assert.ok(r.body.cards.filter((c) => c.type === "counter").every((c) => c.count === 0));
kv.clear();
r = await call("GET", `/day?date=${D}`, "h"); // fully empty KV
assert.deepEqual([r.status, r.body.cards.map((c) => c.type)], [200, ["counter", "counter", "coverage"]]);
kv.set("library", JSON.stringify([
  { id: "d1", name: "Dinner One", mealTypes: ["dinner"], ingredients: [{ key: "rice", label: "Rice" }] },
  { id: "r1", name: "Vitamins", routine: { when: "daily", time: "08:00" }, ingredients: [] },
]));
kv.set("plan", JSON.stringify({ startDate: D, days: Array.from({ length: 14 }, (_, i) => ({ day: i + 1, slots: i === 0 ? { dinner: { mealId: "d1" } } : {} })) }));
kv.set("today", JSON.stringify({ date: D, water: 3, caffeine: 1, gym: false, routineDone: ["r1", "gone"] }));
kv.set("pantry", JSON.stringify({ items: [{ name: "milk", useBy: D }] }));
kv.set("cooks", "not json{");
r = await call("GET", `/day?date=${D}`, "a");
assert.deepEqual(r.body.cards.map((c) => c.type), ["meal", "routine", "counter", "counter", "expiring", "coverage"]);
assert.deepEqual([r.body.cards[0].state, r.body.cards[1].done, r.body.cards[2].count, r.body.cards[4].daysLeft], ["planned", true, 3, 0]);
assert.equal(typeof r.body.assembledAt, "string");
assert.equal((await call("PUT", "/eaten-log", "h", [{ id: "e1", mealId: "d1", name: "Dinner One", eatenAt: `${D}T12:00:00.000Z`, tags: [] }])).status, 204);
r = await call("GET", `/day?date=${D}`, "a");
const meals54 = r.body.cards.filter((c) => c.type === "meal");
assert.deepEqual(meals54.map((c) => c.state), ["planned", "eaten"]);
const nut = (await call("GET", `/nutrition?date=${D}`, "a")).body;
const cov = r.body.cards.at(-1);
assert.deepEqual([cov.proteinGramsApprox, cov.proteinTarget, cov.missing, cov.partial], [nut.proteinGramsApprox, nut.proteinTarget, nut.missing, nut.partial]);
assert.equal((await call("GET", "/day?date=nope", "a")).status, 400);
assert.equal((await call("GET", `/day?date=${D}&gym=2`, "a")).status, 400);
assert.equal((await call("GET", `/day?date=${D}`, "bad")).status, 401);
assert.equal((await call("GET", `/day?date=${D}`, "")).status, 401);
assert.equal((await call("PUT", "/day", "a", {})).status, 403);
assert.equal((await call("GET", `/day?date=2030-01-01`, "a")).status, 200); // outside plan
assert.equal((await call("GET", "/today", "a")).body.water, 3); // /today untouched

// Phase 49: POST /plan/draft, POST /plan/apply, planDraft
{
  kv.clear();
  const dinners = ["m1", "m2", "m3", "m4", "m5"].map((id) => ({ id, name: id.toUpperCase(), mealTypes: ["dinner"], ingredients: [{ key: "rice", label: "Rice" }] }));
  const lib49 = [...dinners, { id: "b1", name: "Toast", mealTypes: ["breakfast"], ingredients: [{ key: "bread", label: "Bread" }] }];
  const empty = () => Array.from({ length: 14 }, (_, i) => ({ day: i + 1, slots: {} }));
  assert.equal((await call("POST", "/plan/draft", "a", {})).status, 409); // library not synced
  kv.set("library", JSON.stringify({ updatedAt: "2026-10-22T00:00:00.000Z", meals: lib49 }));
  let d = await call("POST", "/plan/draft", "a", {});
  assert.equal(d.status, 200);
  assert.ok(d.body.draft.changes.length > 0 && d.body.draft.id && d.body.plan.days.length === 14);
  const d2 = await call("POST", "/plan/draft", "a", {});
  assert.deepEqual([d2.body.draft.id, d2.body.draft.changes], [d.body.draft.id, d.body.draft.changes]); // idempotent
  // app == route: same inputs straight into Generator.generatePlan
  const G = globalThis.MP.Generator;
  const direct = G.generatePlan(lib49, (await import("../ingredient-nutrient-tags.json", { with: { type: "json" } })).default, globalThis.MP.Nutrition.withProfile((await import("../nutrition-targets.json", { with: { type: "json" } })).default, null), (await import("../shelf-life.json", { with: { type: "json" } })).default, d.body.draft.startDate, null, {}, { vocab: (await import("../plan-preferences.json", { with: { type: "json" } })).default, busyDays: [], chips: [], profile: globalThis.MP.Nutrition.profileOf(null) }, {});
  assert.deepEqual(d.body.plan.days.map((x) => x.slots), direct.days.map((x) => x.slots));
  assert.equal((await call("POST", "/plan/draft", "a", { useUp: "yes" })).status, 400);
  kv.set("pantry", JSON.stringify({ items: [{ name: "rice", useBy: "2999-01-01" }] }));
  assert.equal((await call("POST", "/plan/draft", "a", { useUp: true })).status, 200);
  kv.delete("pantry");
  // avoid
  d = await call("POST", "/plan/draft", "a", { avoid: ["m1", "m2"] });
  assert.ok(d.body.draft.changes.every((c) => !["m1", "m2"].includes(c.after.mealId)));
  // days:[3] only touches day 3
  d = await call("POST", "/plan/draft", "a", { days: [3] });
  assert.ok(d.body.draft.changes.length > 0 && d.body.draft.changes.every((c) => c.day === 3));
  // keep and eaten slots absent from changes, copied from the mirror
  const mirror = empty();
  mirror[0].slots.dinner = { mealId: "m5" };
  mirror[1].slots.dinner = { mealId: "m4", eatenAt: "2026-10-23T18:00:00.000Z" };
  mirror[2].slots.breakfast = { mealId: "m1" }; // wrong type but not kept: replaced
  kv.set("plan", JSON.stringify({ startDate: "2026-10-22", days: mirror }));
  d = await call("POST", "/plan/draft", "a", { keep: [{ day: 1, slot: "dinner" }] });
  assert.ok(!d.body.draft.changes.some((c) => (c.day === 1 || c.day === 2) && c.slot === "dinner"));
  assert.deepEqual([d.body.plan.days[0].slots.dinner, d.body.plan.days[1].slots.dinner.mealId], [{ mealId: "m5" }, "m4"]);
  assert.equal(d.body.draft.startDate, "2026-10-22");
  const c3 = d.body.draft.changes.find((c) => c.day === 3 && c.slot === "breakfast");
  assert.deepEqual(c3 && c3.before, { mealId: "m1" });
  // Phase 66: a locked mirror slot survives and the draft fills the rest
  mirror[4].slots.dinner = { mealId: "m3", locked: true };
  kv.set("plan", JSON.stringify({ startDate: "2026-10-22", days: mirror }));
  d = await call("POST", "/plan/draft", "a", {});
  assert.deepEqual(d.body.plan.days[4].slots.dinner, { mealId: "m3", locked: true });
  assert.ok(!d.body.draft.changes.some((c) => c.day === 5 && c.slot === "dinner"));
  assert.ok(d.body.draft.changes.some((c) => c.day === 6 && c.slot === "dinner"));
  // bad bodies
  for (const bad of [{ days: [0] }, { days: [29] }, { days: "1" }, { keep: [{ day: 1, slot: "brunch" }] }, { keep: {} }, { avoid: [1] }, { budget: 0 }, { budget: -3 }, { budget: "5" }, []])
    assert.equal((await call("POST", "/plan/draft", "a", bad)).status, 400, JSON.stringify(bad));
  // apply
  d = await call("POST", "/plan/draft", "a", { days: [4] });
  const n0 = acts().length;
  r = await call("POST", "/plan/apply", "a", { draft: d.body.draft });
  assert.deepEqual([r.status, r.body], [200, { id: d.body.draft.id, status: "pending" }]);
  let stored = JSON.parse(kv.get("planDraft"));
  assert.deepEqual([stored.pending, stored.id, stored.changes.length], [true, d.body.draft.id, d.body.draft.changes.length]);
  assert.equal(acts().length, n0 + 1);
  assert.equal(JSON.stringify(JSON.parse(kv.get("plan")).days), JSON.stringify(mirror)); // Worker never writes the plan mirror
  r = await call("POST", "/plan/apply", "a", { draft: d.body.draft });
  assert.deepEqual([r.status, r.body.status], [200, "already pending"]);
  assert.equal(acts().length, n0 + 1);
  assert.equal((await call("PUT", "/planDraft", "a", { ...stored, pending: false, ackedId: stored.id })).status, 403);
  assert.equal((await call("GET", "/planDraft", "a")).body.id, stored.id);
  assert.equal((await call("PUT", "/planDraft", "h", { ...stored, pending: false, ackedId: stored.id })).status, 204);
  r = await call("POST", "/plan/apply", "a", { draft: d.body.draft });
  assert.deepEqual([r.status, r.body.status], [200, "already applied"]);
  // Phase 63: POST /plan/reflow
  {
    assert.equal((await call("POST", "/plan/reflow", "a", { skipped: [{ day: 0, slot: "dinner" }] })).status, 400);
    assert.equal((await call("POST", "/plan/reflow", "a", { eatingOut: [{ day: 1, slot: "brunch" }] })).status, 400);
    assert.equal((await call("POST", "/plan/reflow", "a", { ranOut: [1] })).status, 400);
    assert.equal((await call("POST", "/plan/reflow", "a", [])).status, 400);
    const planKv = kv.get("plan");
    const rm = JSON.parse(planKv).days.map((x) => ({ ...x, slots: { ...x.slots } }));
    rm[12].slots.dinner = { mealId: "m1" };
    rm[11].slots.dinner = { mealId: "m2", locked: true };
    kv.set("plan", JSON.stringify({ startDate: "2999-01-01", days: rm }));
    const body = { skipped: [{ day: 13, slot: "dinner" }, { day: 12, slot: "dinner" }], eatingOut: [{ day: 14, slot: "dinner" }] };
    const n1 = acts().length;
    const f1 = await call("POST", "/plan/reflow", "a", body);
    assert.equal(f1.status, 200);
    const dn = f1.body.plan.days;
    assert.deepEqual(dn[11].slots.dinner, { mealId: "m2", locked: true }); // locked kept, skip ignored
    assert.deepEqual(dn[13].slots.dinner, { eatingOut: true });
    assert.ok(f1.body.draft.changes.some((c) => c.day === 13) && f1.body.draft.changes.every((c) => c.day >= 13));
    assert.ok(f1.body.draft.summary.includes("ignored 1"));
    assert.equal(acts().length, n1 + 1);
    const st = JSON.parse(kv.get("planDraft"));
    assert.deepEqual([st.pending, st.reflow, st.id], [true, true, f1.body.draft.id]);
    const f2 = await call("POST", "/plan/reflow", "a", body);
    assert.equal(f2.body.draft.id, f1.body.draft.id); // idempotent
    assert.equal(acts().length, n1 + 1);
    assert.equal(JSON.stringify(JSON.parse(kv.get("plan")).days), JSON.stringify(rm)); // mirror untouched
    assert.equal((await call("POST", "/plan/reflow", "a", {})).body.draft.changes.length, 0);
    const ro = await call("POST", "/plan/reflow", "a", { ranOut: ["rice"] }); // every test meal uses rice: all unlocked slots are freed
    assert.ok(ro.status === 200 && ro.body.draft.changes.length > 0);
    assert.equal(JSON.parse(kv.get("pantry") || "{\"items\":[]}").items.length, 0); // re-flow never writes the pantry
    kv.set("plan", planKv);
    kv.delete("plan");
    assert.equal((await call("POST", "/plan/reflow", "a", {})).status, 409);
    kv.set("plan", planKv);
    kv.delete("planDraft");
  }
  // Phase 84: POST /plan/edit + /plan/draft start fields
  {
    assert.equal((await call("POST", "/plan/edit", "a", { edits: [] })).status, 400);
    assert.equal((await call("POST", "/plan/edit", "a", { edits: [{ type: "swapDay", a: 1, b: 1 }] })).status, 400); // all invalid
    assert.equal((await call("POST", "/plan/edit", "a", [])).status, 400);
    assert.equal((await call("POST", "/plan/edit", "a", { edits: [{ type: "busy", day: 1 }] })).status, 400); // constraint types are not plan actions
    const planKv = kv.get("plan");
    const rm = JSON.parse(planKv).days.map((x) => ({ ...x, slots: { ...x.slots } }));
    rm[2].slots.dinner = { mealId: "m1" }; rm[3].slots.dinner = { mealId: "m2" }; rm[4].slots.dinner = { mealId: "m2", locked: true };
    kv.set("plan", JSON.stringify({ startDate: "2999-01-01", days: rm }));
    const n1 = acts().length;
    const e1 = await call("POST", "/plan/edit", "a", { edits: [{ type: "swapDay", a: 3, b: 4 }, { type: "swap", a: { day: 5, slot: "dinner" }, b: { day: 3, slot: "dinner" } }, { type: "bogus" }] });
    assert.equal(e1.status, 200);
    assert.deepEqual([e1.body.status, e1.body.dropped, e1.body.ignored.length], ["parked", 1, 1]); // locked day 5 swap is ignored, not applied
    const st = JSON.parse(kv.get("planDraft"));
    assert.deepEqual([st.pending, st.id, [...new Set(st.changes.map((c) => c.day))].join()], [true, e1.body.id, "3,4"]);
    assert.equal(acts().length, n1 + 1);
    assert.equal(JSON.stringify(JSON.parse(kv.get("plan")).days), JSON.stringify(rm)); // mirror untouched
    const e2 = await call("POST", "/plan/edit", "a", { edits: [{ type: "out", day: 6, slot: "dinner", name: "Spoons" }, { type: "out", day: 6, slot: "dinner", name: "Pret" }] });
    assert.equal(e2.body.ignored[0].reason, "overridden by a later edit"); // last wins
    assert.equal(JSON.parse(kv.get("planDraft")).changes[0].after.name, "Pret");
    // start: a fresh plan, carried alone with its Phase 83 options
    const e3 = await call("POST", "/plan/edit", "a", { edits: [{ type: "start", date: "2999-02-03", firstSlot: "dinner", days: 7, shopDay: 5 }, { type: "swapDay", a: 1, b: 2 }] });
    assert.deepEqual([e3.status, e3.body.status, e3.body.dropped], [200, "parked", 1]);
    const sd = JSON.parse(kv.get("planDraft"));
    assert.deepEqual([sd.startDate, sd.start.days, sd.start.firstSlot, sd.start.shopAnchor], ["2999-02-03", 7, "dinner", "2999-02-01"]);
    assert.equal((await call("POST", "/plan/edit", "a", { edits: [{ type: "start", date: "2000-01-01" }] })).status, 400); // past start dropped
    const dr = await call("POST", "/plan/draft", "a", { startDate: "2999-02-03", days: 7, firstSlot: "dinner", shopDay: 5 });
    assert.deepEqual([dr.status, dr.body.plan.days.length, dr.body.draft.start.days], [200, 7, 7]);
    assert.equal((await call("POST", "/plan/draft", "a", { startDate: "2000-01-01" })).status, 400);
    assert.equal((await call("POST", "/plan/draft", "a", { days: 7 })).status, 400); // numeric days needs startDate
    assert.equal((await call("POST", "/plan/draft", "a", { startDate: "2999-02-03", shopDay: 9 })).status, 400);
    kv.set("plan", planKv);
    kv.delete("plan");
    assert.equal((await call("POST", "/plan/edit", "a", { edits: [{ type: "swapDay", a: 1, b: 2 }] })).status, 409);
    kv.set("plan", planKv);
    kv.delete("planDraft");
  }
  // bad applies
  const ch = d.body.draft.changes[0];
  const bogus = { ...d.body.draft, changes: [{ ...ch, after: { mealId: "nope" } }] };
  assert.equal((await call("POST", "/plan/apply", "a", { draft: bogus })).status, 400);
  assert.equal((await call("POST", "/plan/apply", "a", { draft: { ...d.body.draft, changes: [] } })).status, 400);
  assert.equal((await call("POST", "/plan/apply", "a", {})).status, 400);
  assert.equal((await call("POST", "/plan/apply", "a", { draft: { ...d.body.draft, changes: [{ ...ch, slot: "x" }] } })).status, 400);
  assert.equal((await call("POST", "/plan/draft", "bad", {})).status, 401);
}
// Phase 55: shared shopping lines
{
  kv.delete("activity"); kv.delete("shopping");
  const ago = (ms) => new Date(Date.now() + ms).toISOString();
  const L = (id, state, at, x) => ({ id, state, updatedAt: at, ...x });
  const X = (name, state, at, source = "manual") => L("x:" + name, state, at, { label: name, source });
  // lazy migration from the old KV adhoc, nothing written
  kv.set("adhoc", JSON.stringify({ updatedAt: "2026-10-01T00:00:00.000Z", items: [{ name: "Milk", qty: "2 pints" }] }));
  r = await call("GET", "/shopping/lines", "a");
  assert.deepEqual([r.body.lines.length, r.body.lines[0].id, r.body.lines[0].qty, kv.has("shopping")], [1, "x:milk", "2 pints", false]);
  // two devices, different lines: both survive; repeat is a no-op with no activity
  r = await call("POST", "/shopping/lines", "h", { lines: [L("p:2026-10-26:1:rice", "got", ago(-2000))] });
  assert.deepEqual([r.status, r.body.changed], [200, 1]);
  const jam = X("jam", "needed", ago(-1000), "assistant");
  r = await call("POST", "/shopping/lines", "a", { lines: [jam] });
  assert.equal(r.body.changed, 1);
  assert.deepEqual(r.body.lines.map((l) => l.id).sort(), ["p:2026-10-26:1:rice", "x:jam", "x:milk"]);
  const nAct = acts().length, saved = kv.get("shopping");
  r = await call("POST", "/shopping/lines", "a", { lines: [jam] });
  assert.deepEqual([r.body.changed, kv.get("shopping"), acts().length], [0, saved, nAct]);
  // tick/untick race, both arrival orders
  const t1 = ago(-900), t2 = ago(-800);
  for (const order of [[0, 1], [1, 0]]) {
    const id = "p:2026-10-26:1:race" + order[0];
    const w = [L(id, "got", t1), L(id, "needed", t2)];
    for (const i of order) await call("POST", "/shopping/lines", "h", { lines: [w[i]] });
    assert.equal(JSON.parse(kv.get("shopping")).lines.find((l) => l.id === id).state, "needed");
  }
  // stale tombstone holds; future stamp clamped
  await call("POST", "/shopping/lines", "h", { lines: [X("tea", "deleted", ago(-500))] });
  await call("POST", "/shopping/lines", "h", { lines: [X("tea", "needed", ago(-5000))] });
  assert.equal(JSON.parse(kv.get("shopping")).lines.find((l) => l.id === "x:tea").state, "deleted");
  await call("POST", "/shopping/lines", "h", { lines: [L("p:2026-10-26:1:pin", "got", "2099-01-01T00:00:00.000Z")] });
  assert.ok(Date.parse(JSON.parse(kv.get("shopping")).lines.find((l) => l.id === "p:2026-10-26:1:pin").updatedAt) < Date.now() + 60000);
  // bad shapes 400, whole request rejected
  const before = kv.get("shopping");
  for (const bad of [
    [X("ok", "needed", ago(0)), L("q:z", "got", ago(0))], [L("x:a", "needed", ago(0), { source: "manual" })],
    [X("a".repeat(81), "needed", ago(0))], [L("p:a", "weird", ago(0))], [L("p:a", "got", "nope")],
    [L("p:" + "a".repeat(120), "got", ago(0))], Array(101).fill(L("p:a", "got", ago(0))), [{ ...X("a", "needed", ago(0)), extra: 1 }],
    [L("x:a", "needed", ago(0), { label: "a", source: "bogus" })],
  ]) assert.equal((await call("POST", "/shopping/lines", "h", { lines: bad })).status, 400, JSON.stringify(bad).slice(0, 60));
  assert.equal(kv.get("shopping"), before);
  assert.equal((await call("POST", "/shopping/lines", "h", [])).status, 400);
  assert.equal((await call("POST", "/shopping/lines", "bad", { lines: [] })).status, 401);
  // /adhoc shim round trip with source stamping
  r = await call("PUT", "/adhoc", "a", { items: [{ name: "Milk", qty: "2 pints", source: "manual" }, { name: "Jam" }, { name: "Eggs" }] });
  assert.equal(r.status, 204);
  r = await call("GET", "/adhoc", "a");
  assert.deepEqual(r.body.items.map((i) => i.name + ":" + i.source).sort(), ["Eggs:assistant", "Jam:assistant", "Milk:manual"]); // an echoed source is kept, a bare item takes the caller's
  await new Promise((res) => setTimeout(res, 5)); // a later stamp, not a same-ms tie
  r = await call("PUT", "/adhoc", "h", { items: [{ name: "Milk", qty: "2 pints" }, { name: "Salt", source: "ranout" }] });
  assert.equal(r.status, 204);
  r = await call("GET", "/adhoc", "h");
  assert.deepEqual(r.body.items.map((i) => i.name + ":" + i.source).sort(), ["Milk:manual", "Salt:ranout"]);
  assert.equal(JSON.parse(kv.get("shopping")).lines.find((l) => l.id === "x:jam").state, "deleted");
  assert.equal((await call("PUT", "/adhoc", "h", { items: [{ name: "" }] })).status, 400);
  // GET /shopping carries id/state/extras
  kv.set("library", JSON.stringify({ meals: [{ id: "m", name: "M", servings: 1, mealTypes: ["dinner"], ingredients: [{ key: "rice", qty: "100g" }] }] }));
  kv.set("plan", JSON.stringify({ startDate: "2026-10-26", days: [{ day: 1, slots: { dinner: { mealId: "m" } } }] }));
  await call("POST", "/shopping/lines", "h", { lines: [L("p:2026-10-26:1:rice", "skipped", ago(-100))] });
  r = await call("GET", "/shopping", "a");
  const all = Object.values(r.body.lists).flatMap((l) => [...l.lines, ...l.staples, ...l.estimated]);
  const rice = all.find((l) => l.key === "rice");
  assert.deepEqual([rice.id, rice.state], ["p:2026-10-26:1:rice", "skipped"]);
  assert.deepEqual(r.body.extras.map((l) => l.id).sort(), ["x:milk", "x:salt"]);
  // Phase 68: shopAnchor 3 days before startDate puts day 1 in a cycle shopped on the anchor date
  kv.set("plan", JSON.stringify({ startDate: "2026-10-26", shopAnchor: "2026-10-23", days: [{ day: 1, slots: { dinner: { mealId: "m" } } }] }));
  r = await call("GET", "/shopping", "a");
  assert.deepEqual(Object.keys(r.body.lists).sort(), ["-2", "12", "5"]);
  assert.equal(Object.values(r.body.lists).flatMap((l) => l.lines).find((l) => l.key === "rice").id, "p:2026-10-23:1:rice");
  // Phase 90a: plan.bulk in the mirror moves the later shop onto the first, same as the app
  kv.set("library", JSON.stringify({ meals: [{ id: "m", name: "M", servings: 1, mealTypes: ["dinner"], ingredients: [{ key: "oats", qty: "800g" }] }] }));
  kv.set("plan", JSON.stringify({ startDate: "2026-10-26", bulk: [{ key: "oats", shopDay: 1 }], days: [{ day: 1, slots: { dinner: { mealId: "m" } } }, ...Array(7).fill({ slots: {} }), { day: 9, slots: { dinner: { mealId: "m" } } }] }));
  r = await call("GET", "/shopping", "a");
  const bulkOats = Object.values(r.body.lists).flatMap((l) => l.lines).filter((l) => l.key === "oats");
  assert.ok(bulkOats.length === 1 && bulkOats[0].bulk && bulkOats[0].packSize === 1000 && bulkOats[0].packs === 2, "bulk oats merged");
  // assistant is logged under `shopping`; undo restamps
  kv.delete("activity");
  await call("POST", "/shopping/lines", "a", { lines: [X("oats", "needed", ago(-50), "assistant")] }, { "X-Reason": "test" });
  const e = acts()[0];
  assert.deepEqual([acts().length, e.key, e.who], [1, "shopping", "assistant"]);
  r = await call("POST", "/activity/undo", "a", { id: e.id });
  assert.equal(r.status, 200);
  const oats = JSON.parse(kv.get("shopping")).lines.find((l) => l.id === "x:oats");
  assert.ok(oats.state === "deleted" && Date.parse(oats.updatedAt) > Date.now() - 5000);
  assert.equal((await call("GET", "/shopping/lines", "a")).status, 200);
}
// Phase 56: X-Actor: hermes opts a Hermes-token write into the activity log
{
  const pan = (...items) => ({ updatedAt: "2026-10-22T00:00:00.000Z", items });
  kv.delete("activity");
  assert.equal((await call("PUT", "/pantry", "h", pan({ name: "Rice" }))).status, 204);
  assert.equal(acts().length, 0); // the app (no header) logs nothing
  assert.equal((await call("PUT", "/pantry", "h", pan({ name: "Rice" }, { name: "Oats" }), { "X-Actor": "hermes", "X-Reason": "restock" })).status, 204);
  let e = acts()[0];
  assert.deepEqual([acts().length, e.who, e.key, e.why], [1, "hermes", "pantry", "restock"]);
  assert.equal((await call("PUT", "/pantry", "h", pan({ name: "Rice" }, { name: "Oats" }, { name: "Salt" }), { "X-Actor": "hermes?" })).status, 204);
  assert.equal(acts().length, 1); // any other X-Actor value is ignored
  assert.equal((await call("PUT", "/pantry?dryRun=1", "h", pan({ name: "Rice" }), { "X-Actor": "hermes" })).status, 200);
  assert.equal(acts().length, 1); // dry run logs nothing
  kv.set("pantry", JSON.stringify(pan({ name: "Rice" }, { name: "Oats" })));
  assert.equal((await call("POST", "/activity/undo", "h", { id: e.id }, { "X-Actor": "hermes" })).status, 200);
  assert.deepEqual(JSON.parse(kv.get("pantry")).items.map((i) => i.name), ["Rice"]);
  assert.equal(acts()[0].who, "hermes");
  await call("PUT", "/pantry", "h", pan({ name: "Rice" }, { name: "Tea" }), { "X-Actor": "hermes" });
  await call("PUT", "/pantry", "h", pan({ name: "Rice" }, { name: "Tea", qty: "9" }));
  r = await call("POST", "/activity/undo", "h", { id: acts()[0].id, force: true }, { "X-Actor": "hermes" });
  assert.equal(r.status, 409); // an identified actor can't force
  await call("PUT", "/pantry", "a", pan({ name: "Rice" }), { "X-Actor": "hermes" });
  assert.equal(acts()[0].who, "assistant"); // the header means nothing on the assistant token
  const pre = await worker.fetch(new Request("https://x/pantry", { method: "OPTIONS" }), env);
  assert.match(pre.headers.get("Access-Control-Allow-Headers"), /X-Actor/);
}
// Phase 72: planning chat
{
  const H = { "X-Actor": "hermes" };
  for (const [m, p] of [["POST", "/chat"], ["GET", "/chat"], ["POST", "/chat/reply"]]) assert.equal((await call(m, p, "a", m === "POST" ? {} : undefined)).status, 403, `assistant on ${m} ${p}`);
  assert.equal((await call("POST", "/chat", "bad", {})).status, 401);
  let r = await call("GET", "/chat", "h", undefined, H);
  assert.deepEqual([r.status, r.body.session, r.body.messages], [200, null, []]);
  r = await call("POST", "/chat", "h", { session: "s1", open: true, context: { day: 1 } });
  assert.deepEqual([r.status, r.body.session], [200, "s1"]);
  assert.ok(r.body.bridgeSeenAt, "poll above stamped bridgeSeenAt");
  r = await call("POST", "/chat", "h", { session: "s1", text: "no cooking Sunday", day: 7, context: { day: 7 } });
  assert.equal(r.status, 200);
  const uid = r.body.id;
  assert.equal((await call("POST", "/chat", "h", { session: "old", text: "hi" })).status, 409);
  assert.equal((await call("POST", "/chat", "h", { session: "s1", text: "x".repeat(1001) })).status, 400);
  assert.equal((await call("POST", "/chat", "h", { session: "s1", text: "  " })).status, 400);
  const reply = { session: "s1", replyTo: uid, text: "Got it", edits: [{ type: "noCook", day: 7 }, { type: "makeMeal", name: "pie" }], ask: false };
  assert.equal((await call("POST", "/chat/reply", "h", reply)).status, 403); // no X-Actor
  assert.equal((await call("POST", "/chat/reply", "h", { ...reply, session: "old" }, H)).status, 409);
  assert.equal((await call("POST", "/chat/reply", "h", { ...reply, replyTo: 999 }, H)).status, 409);
  r = await call("POST", "/chat/reply", "h", reply, H);
  assert.deepEqual([r.status, r.body.dropped], [200, 1]);
  r = await call("GET", "/chat?session=s1&since=" + uid, "h");
  assert.deepEqual([r.body.messages.length, r.body.messages[0].from, r.body.messages[0].edits], [1, "hermes", [{ type: "noCook", day: 7 }]]);
  // Phase 88: place/cap/rate normalised, bad ones dropped
  r = await call("POST", "/chat/reply", "h", { session: "s1", replyTo: uid, text: "Done", ask: false, edits: [{ type: "place", day: 2, slot: "dinner", mealId: "m1" }, { type: "cap", minutes: 30, weekdays: [3, 1] }, { type: "rate", mealId: "m1", rating: "down", note: "dull" }, { type: "cap", minutes: 3, weekdays: [1] }, { type: "rate", mealId: "m1", rating: "never" }] }, H);
  assert.deepEqual([r.status, r.body.dropped], [200, 2]);
  r = await call("GET", "/chat?session=s1&since=" + uid, "h");
  assert.deepEqual(r.body.messages.at(-1).edits.map((e) => e.type), ["place", "cap", "rate"]);
  assert.deepEqual(r.body.messages.at(-1).edits[1].weekdays, [1, 3]);
  // Phase 87: meal edits are accepted and normalised, bad ones dropped
  r = await call("POST", "/chat/reply", "h", { session: "s1", replyTo: uid, text: "Added", ask: false, edits: [{ type: "mealCreate", name: " Turkey chilli ", mealTypes: ["dinner"], ingredients: [{ name: "turkey mince", qty: "500 g" }] }, { type: "mealEdit", mealId: "m1", patch: { id: "evil" } }, { type: "mealRemove", mealId: "m1" }] }, H);
  assert.deepEqual([r.status, r.body.dropped], [200, 1]);
  r = await call("GET", "/chat?session=s1&since=" + uid, "h");
  assert.deepEqual(r.body.messages.at(-1).edits.map((e) => e.type), ["mealCreate", "mealRemove"]);
  assert.equal(r.body.messages.at(-1).edits[0].name, "Turkey chilli");
  assert.equal((await call("GET", "/chat?session=old", "h")).status, 409);
  // Phase 88: the open message may carry a big brief; other context stays small
  assert.equal((await call("POST", "/chat", "h", { session: "s4", open: true, context: { brief: "x".repeat(70000) } })).status, 400);
  assert.equal((await call("POST", "/chat", "h", { session: "s3", open: true, context: { brief: "x".repeat(50000) } })).status, 200);
  assert.equal((await call("POST", "/chat", "h", { session: "s3", text: "x".repeat(1000) })).status, 200);
  assert.equal((await call("POST", "/chat", "h", { session: "s3", text: "hi", context: { brief: "x".repeat(5000) } })).status, 400);
  assert.equal((await call("POST", "/chat", "h", { session: "s3", close: true })).status, 200);
  assert.equal((await call("GET", "/chat?session=s3", "h")).body.openAt, null);
  await call("POST", "/chat", "h", { session: "s2", open: true });
  for (let i = 0; i < 45; i++) await call("POST", "/chat", "h", { session: "s2", text: "m" + i });
  r = await call("GET", "/chat?session=s2", "h");
  assert.deepEqual([r.body.messages.length, r.body.messages.at(-1).text], [40, "m44"]);
}
// Phase 56: ROUTES vs the real dispatcher
{
  const { ROUTES } = await import(new URL("../worker/worker.js", import.meta.url));
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../worker/worker.js", import.meta.url), "utf8");
  const sub = (p) => p.replace(/:id/g, "x");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); }; // /discover must not hit TheMealDB
  const dispatcher404 = (res) => (res.status === 404 && res.body === "not found") || res.status === 405;
  for (const row of ROUTES) {
    const tag = `${row.method} ${row.path}`;
    const res = await call(row.method, sub(row.path), "h");
    assert.ok(!dispatcher404(res), `${tag} missing from the dispatcher`);
    if (row.assistant !== true) assert.equal((await call(row.method, sub(row.path), "a")).status, 403, `${tag} reachable by the assistant`);
    if (row.method !== "GET") assert.ok(row.log === "logged" || (row.log === "unlogged" && row.why) || row.kind === "read", `${tag} needs log or why`);
  }
  for (const path of new Set(ROUTES.map((x) => x.path)))
    for (const m of ["GET", "PUT", "POST", "DELETE"])
      if (!ROUTES.some((x) => x.path === path && x.method === m)) {
        const st = (await call(m, sub(path), "h")).status;
        assert.ok([404, 405, 403].includes(st), `${m} ${path} works but is unlisted (${st})`);
      }
  globalThis.fetch = realFetch;
  // reverse: every literal path the source routes on has a row
  const paths = (text) => [...text.matchAll(/"(?:[A-Z]+ )?(\/[^"\s]*)"/g)].map((m) => m[1]);
  const unlisted = (source) => {
    const known = new Set(ROUTES.map((x) => x.path));
    const block = (name) => source.match(new RegExp(`const ${name} = [\\s\\S]*?\\n(?:\\}|\\]\\));`))?.[0] || "";
    const lits = [...paths(block("KEYS")), ...paths(block("ASSISTANT_ALLOWED")), ...[...source.matchAll(/url\.pathname === "(\/[^"]*)"/g)].map((m) => m[1])];
    return lits.filter((p) => !known.has(p));
  };
  assert.deepEqual(unlisted(src), []);
  assert.deepEqual(unlisted(src + '\nif (url.pathname === "/stub") {}'), ["/stub"]);
  const gen = readFileSync(new URL("../worker/routes.json", import.meta.url), "utf8");
  assert.equal(gen, JSON.stringify(ROUTES, null, 2) + "\n", "routes.json is stale: node tools/routes_build.mjs");
}
// Phase 76: GET /swaps
{
  const SG = (await import(new URL("../substitution-groups.json", import.meta.url), { with: { type: "json" } })).default;
  const meal = (id, ings) => ({ id, name: id.toUpperCase(), servings: 1, mealTypes: ["dinner"], ingredients: ings });
  kv.delete("shopping"); kv.delete("settings"); kv.delete("pantry");
  kv.set("library", JSON.stringify({ meals: [meal("p1", [{ key: "peppers", qty: "2" }, { key: "rice", qty: "100g" }]), meal("p2", [{ key: "peppers", qty: "2" }])] }));
  kv.set("plan", JSON.stringify({ startDate: "2026-10-26", days: [{ day: 1, slots: { dinner: { mealId: "p1" } } }, { day: 2, slots: { dinner: { mealId: "p2" } } }] }));
  let r = await call("GET", "/swaps", "a");
  assert.equal(r.status, 200);
  assert.equal(r.body.swaps.length, 1); // rice has no group
  const sw = r.body.swaps[0];
  assert.deepEqual([sw.key, sw.to.key, sw.lineId, sw.estimated, sw.saving > 0, sw.now.cost < sw.was.cost], ["peppers", "onion", "p:2026-10-26:1:pepper", true, true, true]);
  assert.deepEqual(sw.tagChanges.map((t) => t.nutrient).sort(), ["vitC"]);
  assert.deepEqual(sw.tagChanges.find((t) => t.nutrient === "vitC"), { nutrient: "vitC", from: "high", to: null });
  assert.equal((await call("GET", "/swaps", "h")).status, 200);
  assert.equal((await call("GET", "/swaps", "")).status, 401);
  assert.equal((await call("GET", "/swaps?day=2&limit=1", "a")).status, 200);
  for (const q of ["limit=0", "limit=11", "limit=x", "day=99", "day=0", "day=1.5"]) assert.equal((await call("GET", "/swaps?" + q, "a")).status, 400, q);
  // a line already skipped is not offered
  await call("POST", "/shopping/lines", "h", { lines: [{ id: sw.lineId, state: "skipped", updatedAt: new Date().toISOString() }] });
  assert.deepEqual((await call("GET", "/swaps", "a")).body.swaps, []);
  kv.delete("shopping");
  // never/allergy on the mate drops the swap
  kv.set("settings", JSON.stringify({ updatedAt: "2026-10-24T00:00:00.000Z", never: ["onion"] }));
  assert.deepEqual((await call("GET", "/swaps", "a")).body.swaps, []);
  kv.delete("settings");
  // a mushroom mate is never returned
  SG.groups.push({ id: "t", label: "t", members: [{ key: "peppers", label: "Peppers" }, { key: "mushroom", label: "Mushroom" }] });
  kv.set("library", JSON.stringify({ meals: [meal("p1", [{ key: "peppers", qty: "4" }])] }));
  const aromatic = SG.groups.shift(); // aromatic_veg out, so only the mushroom mate is on offer
  const mush = SG.groups.pop();
  SG.groups.push({ id: "t2", label: "t2", members: [{ key: "peppers", label: "Peppers" }, { key: "chard", label: "Chard" }] });
  assert.equal((await call("GET", "/swaps", "a")).body.swaps.length, 1, "control: a non-mushroom cheaper mate is offered");
  SG.groups.pop(); SG.groups.push(mush);
  kv.set("plan", JSON.stringify({ startDate: "2026-10-26", days: [{ day: 1, slots: { dinner: { mealId: "p1" } } }] }));
  assert.deepEqual((await call("GET", "/swaps", "a")).body.swaps, []);
  SG.groups.pop(); SG.groups.unshift(aromatic);
}
// Phase 80: POST/GET /food-log
{
  const FL = await import(new URL("../worker/food-log.js", import.meta.url));
  const { readFileSync } = await import("node:fs");
  const FOOD = JSON.parse(readFileSync(new URL("../food-log.json", import.meta.url), "utf8"));
  assert.deepEqual([FL.parse("chicken 200g"), FL.parse("200g chicken"), FL.parse("2 waffles"), FL.parse("1 potato")],
    [{ name: "chicken", grams: 200 }, { name: "chicken", grams: 200 }, { name: "waffles", count: 2 }, { name: "potato", count: 1 }]);
  assert.deepEqual([FL.parse("200 servings of glycine"), FL.parse("20 Guayusa tea bags"), FL.parse("tea"), FL.parse("1.5kg rice"), FL.parse("250 ml milk"), FL.parse("  ")],
    [{ name: "glycine", count: 200 }, { name: "Guayusa tea bags", count: 20 }, { name: "tea" }, { name: "rice", grams: 1500 }, { name: "milk", grams: 250 }, null]);
  const cc = (...c) => FL.crossCheck(c.map(([source, nutrients]) => ({ source, nutrients })), FOOD.tolerance);
  let x = cc(["A", { protein_g: 20, iron_mg: 1 }], ["B", { protein_g: 22, iron_mg: 2 }]);
  assert.deepEqual([x.nutrients.protein_g, x.unconfirmed], [{ value: 21, basis: "estimate", sources: ["A", "B"] }, ["iron_mg"]]);
  assert.equal(cc(["A", { iron_mg: 1 }], ["B", { iron_mg: 1.3 }]).nutrients.iron_mg.value, 1.15);
  assert.deepEqual(cc(["A", { protein_g: 10 }]).nutrients, {});
  assert.deepEqual(cc(["A", { protein_g: 10 }], ["a", { protein_g: 10 }]).nutrients, {});
  x = cc(["A", { protein_g: 10 }], ["B", { protein_g: 30 }], ["C", { protein_g: 31 }]);
  assert.deepEqual(x.nutrients.protein_g.sources, ["B", "C"]);
  assert.equal(FL.fromOffSearch({ products: [{ code: "1", product_name: "x" }] }), null);
  assert.equal(FL.fromUsda({ foods: [] }, FOOD.usdaIds), null);

  const realFetch = globalThis.fetch;
  const hits = [];
  const A = (b) => call("POST", "/food-log", "a", b);
  const eat = (id, text, o = {}) => ({ id, action: "eat", text, when: "2026-10-24T12:00:00.000Z", ...o });
  for (const k of ["foodLog", "activity", "products", "settings", "plan"]) kv.delete(k);
  kv.set("pantry", JSON.stringify({ updatedAt: "2026-10-20T00:00:00.000Z", items: [
    { name: "Chicken breast", qty: { value: 500, unit: "g", raw: "500g" } }, { name: "Waffles", qty: { value: 6, unit: "each", raw: "6" } },
    { name: "Glycine", qty: { value: 50, unit: "g", raw: "50g" } }, { name: "Eggs", qty: "6" }] }));

  globalThis.fetch = async () => { throw new Error("offline"); };
  r = await A({ entries: [eat("c1", "chicken breast 200g")] });
  assert.equal(r.status, 200);
  let res = r.body.results[0];
  assert.deepEqual([res.status, res.grams, res.matched.kind, res.nutrients.protein_g.basis, res.nutrients.protein_g.value > 40], ["logged", 200, "cofid", "cofid", true]);
  assert.deepEqual([res.pantry.before, res.pantry.after], ["500g", "300g"]);
  assert.equal(r.body.activity.length, 2);
  const pb = kv.get("pantry"), ab = kv.get("activity");
  r = await A({ entries: [eat("c1", "chicken breast 200g")] });
  assert.deepEqual([r.body.results[0].status, r.body.activity], ["duplicate", []]);
  assert.ok(kv.get("pantry") === pb && kv.get("activity") === ab);
  r = await A({ entries: [eat("w1", "2 waffles")] });
  res = r.body.results[0];
  assert.deepEqual([res.status, res.count, res.grams, res.gramsEstimate, res.pantry.after, res.matched.kind], ["logged", 2, 70, true, "4each", "none"]);
  assert.deepEqual([res.nutrients, res.unconfirmed.includes("protein_g")], [{}, true]);
  r = await A({ entries: [eat("g1", "30g glycine"), eat("g2", "60g glycine")] });
  assert.deepEqual([r.body.results[0].pantry.after, r.body.results[1].pantry.after], ["20g", "0g"]);
  const logLen = () => JSON.parse(kv.get("foodLog")).entries.length;
  const n0 = logLen();
  r = await A({ entries: [eat("n1", "3 snorbles"), eat("n2", "50g oats")] });
  assert.deepEqual(r.body.results.map((q) => q.status), ["needs-grams", "logged"]);
  assert.equal(logLen(), n0 + 1);
  r = await A({ entries: [eat("n1", "3 snorbles", { gramsPerItem: 40 })] });
  assert.deepEqual([r.body.results[0].status, r.body.results[0].grams], ["logged", 120]);
  assert.equal(JSON.parse(kv.get("products")).products.find((p) => p.id === "food:snorble").itemGrams, 40);
  r = await A({ entries: [eat("n3", "2 snorbles")] });
  assert.deepEqual([r.body.results[0].status, r.body.results[0].grams], ["logged", 80]);
  r = await A({ entries: [{ id: "h1", action: "have", text: "300g lentils" }, { id: "h2", action: "have", text: "200g lentils" }, { id: "h4", action: "have", text: "tea" }] });
  assert.deepEqual(r.body.results.map((q) => q.status), ["stocked", "stocked", "stocked"]);
  const items = JSON.parse(kv.get("pantry")).items;
  assert.deepEqual([items.find((i) => i.name === "lentils").qty.raw, "qty" in items.find((i) => i.name === "tea")], ["500g", false]);

  // lookup: two agreeing sources save an estimate; the product then resolves with no fetch
  const offBody = { products: [{ code: "5", product_name: "x", nutriments: { proteins_100g: 20, iron_100g: 1, fat_100g: 10 } }] };
  const usdaBody = { foods: [{ fdcId: 1, foodNutrients: [{ nutrientId: 1003, value: 21 }, { nutrientId: 1004, value: 20 }] }] };
  globalThis.fetch = async (u) => { hits.push(String(u)); return new Response(JSON.stringify(String(u).includes("openfoodfacts") ? offBody : usdaBody)); };
  env.USDA_API_KEY = "k";
  r = await A({ entries: [eat("l1", "100g quorn")] });
  res = r.body.results[0];
  assert.deepEqual([res.matched.kind, res.nutrients.protein_g.value, res.nutrients.protein_g.basis, "fat_g" in res.nutrients], ["lookup", 20.5, "estimate", false]);
  assert.deepEqual(JSON.parse(kv.get("products")).products.find((p) => p.id === "food:quorn").nutrients.protein_g.sources, ["Open Food Facts", "USDA FoodData Central"]);
  const nh = hits.length;
  r = await A({ entries: [eat("l2", "100g quorn")] });
  assert.deepEqual([r.body.results[0].matched.kind, hits.length], ["product", nh]);
  const pl = JSON.parse(kv.get("products"));
  pl.products.find((p) => p.id === "food:quorn").nutrients.protein_g = { value: 14, basis: "label" };
  kv.set("products", JSON.stringify(pl));
  r = await A({ entries: [eat("l3", "100g quorn", { lookup: true })] });
  assert.equal(r.body.results[0].nutrients.protein_g.value, 14);
  const set = globalThis.MP.Products.setNutrients;
  const est = set({ nutrients: {} }, { protein_g: 5 }, "estimate", ["A", "B"]);
  assert.deepEqual(est.nutrients.protein_g, { value: 5, basis: "estimate", sources: ["A", "B"] });
  assert.deepEqual(set(est, { protein_g: 9 }, "label").nutrients.protein_g, { value: 9, basis: "label" });

  // Hermes candidate + a failing lookup: never a 500
  delete env.USDA_API_KEY;
  const cand = (source, protein_g) => ({ source, url: "https://example.com/" + source, per: "100g", nutrients: { protein_g } });
  r = await A({ entries: [eat("k1", "100g tofu", { candidates: [cand("Maker", 21)] })] });
  assert.deepEqual([r.status, r.body.results[0].nutrients.protein_g.value], [200, 20.5]);
  globalThis.fetch = async () => { throw new Error("offline"); };
  r = await A({ entries: [eat("k2", "100g seitan", { candidates: [cand("Maker", 21)] })] });
  assert.deepEqual([r.status, "protein_g" in r.body.results[0].nutrients], [200, false]);

  // validation: 400 and nothing written
  const snap = [kv.get("foodLog"), kv.get("pantry"), kv.get("products")].join("|");
  for (const bad of [
    {}, { entries: [] }, { entries: Array(21).fill(eat("z", "rice")) }, { entries: [eat("z", "rice")], extra: 1 },
    { entries: [{ ...eat("z", "rice"), name: "rice" }] }, { entries: [{ id: "z", action: "eat" }] }, { entries: [{ ...eat("z", "rice"), bogus: 1 }] },
    { entries: [{ ...eat("y", "rice"), action: "drink" }] }, { entries: [eat("", "rice")] }, { entries: [eat("z", "rice", { grams: -1 })] },
    { entries: [eat("z", "rice", { candidates: [{ ...cand("M", 1), url: "http://example.com" }] })] },
    { entries: [eat("z", "rice", { candidates: [cand("", 1)] })] }, { entries: [eat("z", "rice", { candidates: [cand("M", -1)] })] }
  ]) assert.equal((await A(bad)).status, 400, JSON.stringify(bad).slice(0, 80));
  assert.equal([kv.get("foodLog"), kv.get("pantry"), kv.get("products")].join("|"), snap);

  // auth, GET window
  assert.equal((await call("POST", "/food-log", "h", { entries: [eat("hh", "100g rice")] })).status, 200);
  assert.equal((await call("POST", "/food-log", "bad", {})).status, 401);
  assert.equal((await call("GET", "/food-log", "")).status, 401);
  r = await call("GET", "/food-log?from=2026-10-24&to=2026-10-24", "a");
  assert.ok(r.status === 200 && r.body.entries.length > 5);
  assert.equal((await call("GET", "/food-log?from=2099-01-01", "a")).body.entries.length, 0);
  assert.equal((await call("GET", "/food-log?from=x", "a")).status, 400);

  // /nutrition and /day expose off-plan food; stock never counts
  r = await call("GET", "/nutrition?date=2026-10-24", "a");
  assert.ok(r.body.offPlan.length >= 8 && !r.body.offPlan.some((o) => o.name === "tea") && r.body.proteinGramsApprox > 0);
  assert.ok(r.body.offPlan.find((o) => o.name === "waffles").gramsEstimate);
  r = await call("GET", "/day?date=2026-10-24", "a");
  assert.ok(r.body.cards.some((c) => c.type === "food" && c.name === "waffles"));

  // undo: each activity id restores its key
  const fresh = await A({ entries: [eat("u1", "100g chicken breast")] });
  const [logAct, panAct] = fresh.body.activity;
  const chicken = () => JSON.stringify(JSON.parse(kv.get("pantry")).items.find((i) => i.name === "Chicken breast"));
  const cb = chicken();
  assert.equal((await call("POST", "/activity/undo", "a", { id: panAct })).status, 200);
  assert.notEqual(chicken(), cb);
  assert.equal((await call("POST", "/activity/undo", "a", { id: logAct })).status, 200);
  assert.ok(!JSON.parse(kv.get("foodLog")).entries.some((e) => e.id === "u1"));

  kv.set("foodLog", JSON.stringify({ updatedAt: "x", entries: Array.from({ length: 499 }, (_, i) => ({ id: "old" + i, kind: "eat", when: "2026-01-01T00:00:00Z", name: "o", nutrients: {}, source: "none" })) }));
  await A({ entries: [eat("cap1", "10g rice"), eat("cap2", "10g rice")] });
  const capped = JSON.parse(kv.get("foodLog")).entries;
  assert.deepEqual([capped.length, capped[0].id, capped.at(-1).id], [500, "old1", "cap2"]);

  // Phase 85: meal + remove
  kv.set("foodLog", JSON.stringify({ updatedAt: "x", entries: [] }));
  const meal = (o = {}) => ({ id: "m1", action: "meal", name: "Spoons burger meal", when: "2026-10-25T12:00:00.000Z", items: [{ text: "chicken breast 150g" }, { text: "rice 100g" }, { name: "mystery gloop" }], ...o });
  r = await A({ entries: [meal()] });
  assert.equal(r.status, 200);
  let mr = r.body.results[0];
  assert.deepEqual([mr.status, mr.items.map((i) => i.status)], ["partial", ["logged", "logged", "needs-grams"]]);
  let ents = JSON.parse(kv.get("foodLog")).entries;
  assert.deepEqual(ents.map((e) => [e.id, e.group, e.meal]), [["m1:0", "m1", "Spoons burger meal"], ["m1:1", "m1", "Spoons burger meal"]]);
  r = await A({ entries: [meal({ items: meal().items.slice(0, 2) })] });
  assert.equal(r.body.results[0].status, "duplicate");
  assert.equal(JSON.parse(kv.get("foodLog")).entries.length, 2);
  for (const bad of [{ entries: [meal({ items: [] })] }, { entries: [meal({ items: Array(13).fill({ text: "rice 10g" }) })] }, { entries: [meal({ extra: 1 })] },
    { entries: [meal({ items: [{ text: "rice 10g", id: "q" }] })] }, { entries: [{ id: "r", action: "remove" }] }, { entries: [{ id: "r", action: "remove", target: "m1", x: 1 }] }])
    assert.equal((await A(bad)).status, 400, JSON.stringify(bad).slice(0, 80));
  const pan = kv.get("pantry"), log0 = kv.get("foodLog");
  assert.equal((await A({ entries: [{ id: "r1", action: "remove", target: "nope" }] })).status, 404);
  assert.equal(kv.get("foodLog"), log0);
  // a failed remove rejects the whole batch, new entries included
  assert.equal((await A({ entries: [eat("single", "10g rice"), { id: "r2", action: "remove", target: "single" }] })).status, 404);
  assert.equal(kv.get("foodLog"), log0);
  r = await A({ entries: [{ id: "r3", action: "remove", target: "m1" }] });
  assert.deepEqual([r.status, r.body.results[0].status, r.body.results[0].removed, r.body.results[0].pantry], [200, "removed", ["m1:0", "m1:1"], "untouched"]);
  assert.ok(!JSON.parse(kv.get("foodLog")).entries.some((e) => e.group === "m1"));
  assert.equal(kv.get("pantry"), pan);
  assert.equal(r.body.activity.length, 1);
  globalThis.fetch = realFetch;
}
console.log("worker_test: ok");
