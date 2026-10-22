// Product reference records (Phase 33a): per-pack label nutrition, informational only.
// The generator never reads these; rankByGap's low/med/high tags stay its only nutrition input.
window.MP = window.MP || {};

MP.Products = (function () {
  "use strict";

  const LABEL_KEYS = ["energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "saturates_g", "sugars_g", "fibre_g", "salt_g"];
  const BASES = ["label", "off", "cofid", "usda", "estimate"]; // precedence order, highest first
  const ESTIMATE_BASES = new Set(["cofid", "usda", "estimate"]);
  const OFF_KEYS = {
    energy_kcal: "energy-kcal_100g", protein_g: "proteins_100g", carbohydrate_g: "carbohydrates_100g", fat_g: "fat_100g",
    saturates_g: "saturated-fat_100g", sugars_g: "sugars_100g", fibre_g: "fiber_100g", salt_g: "salt_100g",
  };

  /** GS1 mod-10 check digit, lengths 8/12/13/14. */
  function validBarcode(digits) {
    if (typeof digits !== "string" || !/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
    let sum = 0;
    for (let i = 0; i < digits.length - 1; i++) {
      sum += Number(digits[digits.length - 2 - i]) * (i % 2 === 0 ? 3 : 1);
    }
    return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
  }

  const num = (v) => (v === null || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v)) ? null : Number(v));

  function fromOff(barcode, off) {
    if (!off || off.status !== 1 || !off.product) return null;
    const p = off.product;
    const name = String(p.product_name || p.product_name_en || "").trim();
    if (!name) return null;
    const unit = String(p.product_quantity_unit || "").toLowerCase();
    const qty = num(p.product_quantity);
    const nutrients = {};
    for (const key of LABEL_KEYS) {
      const v = p.nutriments ? num(p.nutriments[OFF_KEYS[key]]) : null;
      if (v !== null && v >= 0) nutrients[key] = { value: v, basis: "off" };
    }
    const serving = num(p.serving_quantity);
    return {
      id: barcode, barcode, name,
      brand: String(p.brands || "").split(",")[0].trim() || null,
      ingredient: null,
      per: ["ml", "l", "cl"].includes(unit) ? "100ml" : "100g",
      servingSize: serving > 0 ? serving : null,
      pack: qty > 0 && unit ? { value: qty, unit } : null,
      price: null, state: null, nutrients, source: "scan",
      updatedAt: new Date().toISOString(),
    };
  }

  /** Sets each finite value unless the existing basis outranks `basis`. Typed `label` replaces anything. */
  function setNutrients(product, values, basis) {
    const nutrients = { ...product.nutrients };
    for (const [key, raw] of Object.entries(values)) {
      const v = num(raw);
      if (v === null) continue;
      const cur = nutrients[key];
      if (!cur || BASES.indexOf(cur.basis) >= BASES.indexOf(basis)) nutrients[key] = { value: v, basis };
    }
    return { ...product, nutrients };
  }

  /** Replaces the product's `cofid` entries with the mapped CoFID food's values (per 100 g). Pure; `null` cofid = no-op. */
  function fillFromCofid(product, cofid) {
    if (!cofid) return product;
    const nutrients = {};
    for (const [k, e] of Object.entries(product.nutrients || {})) if (e.basis !== "cofid") nutrients[k] = e;
    const base = { ...product, nutrients };
    const m = product.ingredient && cofid.map && cofid.map[product.ingredient];
    const food = m && cofid.foods && cofid.foods[(product.state && m[product.state]) || m.default];
    return food ? setNutrients(base, food.nutrients, "cofid") : base;
  }

  const isEstimate = (entry) => !!entry && ESTIMATE_BASES.has(entry.basis);

  function perServing(product, key) {
    const e = product.nutrients && product.nutrients[key];
    return e && product.servingSize > 0 ? (e.value * product.servingSize) / 100 : null;
  }

  function forIngredient(products, key) {
    let best = null;
    for (const p of products || []) {
      if (p.ingredient === key && (!best || Date.parse(p.updatedAt) > Date.parse(best.updatedAt))) best = p;
    }
    return best;
  }

  /** Union by id; newer updatedAt wins, ties go to remote. */
  function merge(local, remote) {
    const byId = new Map();
    for (const p of remote || []) byId.set(p.id, p);
    for (const p of local || []) {
      const r = byId.get(p.id);
      if (!r || Date.parse(p.updatedAt) > Date.parse(r.updatedAt)) byId.set(p.id, p);
    }
    return [...byId.values()];
  }

  return { LABEL_KEYS, BASES, ESTIMATE_BASES, validBarcode, fromOff, setNutrients, fillFromCofid, isEstimate, perServing, forIngredient, merge };
})();
