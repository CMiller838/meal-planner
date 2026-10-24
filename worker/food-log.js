// Phase 80: the food-log helpers behind POST /food-log. Plain ESM, Worker-only, pure except `lookup` (injected fetch).
const MP = () => globalThis.MP;
const nk = (t) => MP().ShoppingList.normalizeKey(t);

/** "chicken 200g" | "200g chicken" | "2 waffles" | "200 servings of glycine" | "tea" -> { name, grams?, count? } | null. */
export function parse(text) {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  const toG = (n, u) => Number(n) * (u.toLowerCase() === "kg" || u.toLowerCase() === "l" ? 1000 : 1); // ponytail: ml read as g, density 1
  const pos = (n) => (n > 0 ? n : null);
  let m = t.match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b\s*(?:of\s+)?(.+)$/i);
  if (m) { const g = pos(toG(m[1], m[2])); return g ? { name: m[3].trim(), grams: g } : null; }
  m = t.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(kg|g|ml|l)$/i);
  if (m) { const g = pos(toG(m[2], m[3])); return g ? { name: m[1].trim(), grams: g } : null; }
  m = t.match(/^(\d+)\s*(?:servings?\s+of|servings?|x)\s+(.+)$/i) || t.match(/^(\d+)\s+(.+)$/);
  if (m) { const c = pos(Number(m[1])); return c ? { name: m[2].trim(), count: c } : null; }
  return { name: t };
}

const round2 = (v) => Math.round(v * 100) / 100;

/** candidates [{ source, nutrients }] -> { nutrients: { key: { value, basis: "estimate", sources } }, unconfirmed: [key] }.
 *  Per key, the largest set of distinct sources whose values all agree within tolerance; 2+ sources confirm it. */
export function crossCheck(candidates, tol) {
  const tolFor = (key) => (tol.macroKeys.includes(key) ? tol.macro : tol.micro);
  const keys = new Set();
  for (const c of candidates) for (const k of Object.keys(c.nutrients || {})) keys.add(k);
  const nutrients = {}, unconfirmed = [];
  for (const key of keys) {
    const seen = new Set(), vals = [];
    for (const c of candidates) {
      const v = c.nutrients && c.nutrients[key], s = String(c.source).toLowerCase();
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || seen.has(s)) continue;
      seen.add(s); vals.push({ v, source: c.source });
    }
    const ok = (g) => g.every((a, i) => g.every((b, j) => j <= i || Math.abs(a.v - b.v) <= tolFor(key) * Math.max(a.v, b.v)));
    let best = [];
    // ponytail: brute-force subsets; at most 7 sources (2 lookups + 5 candidates), so <=128 groups
    for (let mask = 1; mask < 1 << vals.length; mask++) {
      const g = vals.filter((_, i) => mask & (1 << i));
      if (g.length > best.length && ok(g)) best = g;
    }
    if (best.length >= 2) nutrients[key] = { value: round2(best.reduce((s, x) => s + x.v, 0) / best.length), basis: "estimate", sources: best.map((x) => x.source) };
    else unconfirmed.push(key);
  }
  return { nutrients, unconfirmed };
}

const wordsOf = (key) => key.split("_");

/** Newest product matching the food key by normalized name or ingredient (any nutrients, or none). */
export function findProduct(products, key) {
  let best = null;
  for (const p of products || []) {
    if ((nk(p.name) === key || p.ingredient === key) && (!best || Date.parse(p.updatedAt) > Date.parse(best.updatedAt))) best = p;
  }
  return best;
}

/** itemGrams for a food: its product's, else the data file's; a trailing-word match ("guayusa tea bag" -> tea_bag) counts. */
export function itemGramsFor(key, product, table) {
  if (product && product.itemGrams > 0) return product.itemGrams;
  const w = wordsOf(key);
  for (let i = 0; i < w.length; i++) { const g = table[w.slice(i).join("_")]; if (g > 0) return g; }
  return null;
}

function cofidFor(key, cofid, action) {
  const map = cofid.map || {}, byNorm = new Map(Object.keys(map).map((k) => [nk(k), k]));
  let mk = byNorm.get(key);
  // ponytail: head-noun heuristic ("chicken" -> chicken_breast); aliases in food-log.json are the upgrade path
  if (!mk) { const last = wordsOf(key).at(-1); mk = Object.keys(map).find((k) => nk(k).split("_")[0] === last); }
  if (!mk) return null;
  const code = (action === "eat" && map[mk].cooked) || map[mk].default;
  const food = cofid.foods && cofid.foods[code];
  return food ? { code, nutrients: food.nutrients } : null;
}

const asBasis = (obj, basis) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { value: v, basis }]));

/** Where a food's per-100 g nutrients come from, in order: product, pantry-linked, CoFID. null = ask the lookup. */
export function resolve(food, { products, pantry, cofid, action }) {
  const key = nk(food.name);
  const fromProduct = (k, kind) => {
    const p = findProduct(products, k);
    return p && Object.keys(p.nutrients || {}).length ? { kind, ref: p.id, per100: p.nutrients, product: p } : null;
  };
  const direct = fromProduct(key, "product");
  if (direct) return direct;
  const kw = wordsOf(key);
  const linked = (pantry && pantry.items || []).find((i) => !i.out && nk(i.name) !== key && kw.every((w) => wordsOf(nk(i.name)).includes(w)));
  if (linked) {
    const lk = nk(linked.name), viaProduct = fromProduct(lk, "pantry"), c = cofidFor(lk, cofid, action);
    if (viaProduct) return viaProduct;
    if (c) return { kind: "pantry", ref: lk, per100: asBasis(c.nutrients, "cofid"), cofid: c.code };
  }
  const c = cofidFor(key, cofid, action);
  return c ? { kind: "cofid", ref: c.code, per100: asBasis(c.nutrients, "cofid"), cofid: c.code } : null;
}

const timed = (p, ms) => new Promise((ok) => { const t = setTimeout(() => ok(null), ms); p.then((v) => { clearTimeout(t); ok(v); }, () => { clearTimeout(t); ok(null); }); });
const getJson = (fetchImpl, url) => timed(Promise.resolve().then(() => fetchImpl(url)).then((r) => (r && r.ok ? r.json() : null)), 4000);

/** Open Food Facts search JSON -> candidate | null (the first hit with any label nutrient). */
export function fromOffSearch(data) {
  for (const p of (data && data.products) || []) {
    const rec = MP().Products.fromOff(String(p.code || "x"), { status: 1, product: p });
    const nutrients = rec ? Object.fromEntries(Object.entries(rec.nutrients).map(([k, e]) => [k, e.value])) : {};
    if (rec && Object.keys(nutrients).length) return { source: "Open Food Facts", url: `https://world.openfoodfacts.org/product/${encodeURIComponent(p.code || "")}`, per: "100g", nutrients };
  }
  return null;
}

/** USDA FoodData Central search JSON -> candidate | null (the first food). */
export function fromUsda(data, usdaIds) {
  const f = data && data.foods && data.foods[0];
  if (!f) return null;
  const byId = Object.fromEntries(Object.entries(usdaIds).map(([k, id]) => [id, k]));
  const nutrients = {};
  for (const n of f.foodNutrients || []) if (byId[n.nutrientId] && typeof n.value === "number" && n.value >= 0) nutrients[byId[n.nutrientId]] = n.value;
  return Object.keys(nutrients).length ? { source: "USDA FoodData Central", url: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${f.fdcId}/nutrients`, per: "100g", nutrients } : null;
}

/** OFF + USDA candidates for a food name; a failed, slow or empty source is absent. USDA is skipped without a key. */
export async function lookup(name, { fetchImpl, usdaKey, usdaIds }) {
  const q = encodeURIComponent(name);
  const [off, usda] = await Promise.all([
    getJson(fetchImpl, `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=5`).then((d) => { try { return fromOffSearch(d); } catch (e) { return null; } }),
    usdaKey ? getJson(fetchImpl, `https://api.nal.usda.gov/fdc/v1/foods/search?query=${q}&pageSize=1&dataType=Foundation,SR%20Legacy&api_key=${encodeURIComponent(usdaKey)}`).then((d) => { try { return fromUsda(d, usdaIds); } catch (e) { return null; } }) : null,
  ]);
  return [off, usda].filter(Boolean);
}
