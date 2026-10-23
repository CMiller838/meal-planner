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
  // bad bodies
  for (const bad of [{ days: [0] }, { days: [15] }, { days: "1" }, { keep: [{ day: 1, slot: "brunch" }] }, { keep: {} }, { avoid: [1] }, { budget: 0 }, { budget: -3 }, { budget: "5" }, []])
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
console.log("worker_test: ok");
