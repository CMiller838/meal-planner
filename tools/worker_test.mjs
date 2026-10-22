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
console.log("worker_test: ok");
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
