// Shared dietary-exclusion rules. Loaded as a browser <script> AND imported
// into the Cloudflare Worker bundle — must not touch window/document/
// localStorage/sessionStorage, and must not depend on data.js.
(function (root) {
  "use strict";

  const MUSHROOM = ["mushroom"];
  const EGG = ["egg"];
  const TOASTIE = /toastie|toasted sandwich/i;
  const TOASTIE_VEG = [
    "onion", "tomato", "pepper", "spinach", "rocket", "lettuce",
    "courgette", "aubergine", "sweetcorn", "mushroom", "jalapeno",
  ];

  function matchesAny(text, terms) {
    const t = (text || "").toLowerCase();
    return terms.some((term) => t.includes(term));
  }

  function ingredientMatches(ing, terms) {
    return matchesAny(ing.key, terms) || matchesAny(ing.label, terms);
  }

  function hasMushroom(ingredients) {
    return (ingredients || []).some((ing) => ingredientMatches(ing, MUSHROOM));
  }

  // ponytail: counting ingredients, not understanding dishes — a genuinely
  // bare egg dish listing salt/pepper as ingredients slips past, and a
  // two-ingredient dish that happens to be egg-based gets caught. Upgrade
  // path is an explicit allow/deny list of meal ids, not a cleverer count.
  function isStandaloneEgg(meal) {
    const ingredients = meal.ingredients || [];
    const eggCount = ingredients.filter((ing) => ingredientMatches(ing, EGG)).length;
    if (eggCount === 0) return false;
    return ingredients.length - eggCount <= 1;
  }

  function hasVegInToastie(meal) {
    const isToastie = TOASTIE.test(meal.id || "") || TOASTIE.test(meal.name || "");
    if (!isToastie) return false;
    return (meal.ingredients || []).some((ing) => ingredientMatches(ing, TOASTIE_VEG));
  }

  function check(meal) {
    const reasons = [];
    if (isStandaloneEgg(meal)) reasons.push("standalone egg");
    if (hasVegInToastie(meal)) reasons.push("vegetables in toastie");
    if (hasMushroom(meal.ingredients || [])) reasons.push("contains mushroom");
    return { ok: reasons.length === 0, reasons };
  }

  // Safety property: sanitize can only ever return a meal that would pass
  // check() — that is what makes /discover trustworthy.
  function sanitize(meal, subs) {
    if (isStandaloneEgg(meal) || hasVegInToastie(meal)) return null;

    const substituted = [];
    const ingredients = (meal.ingredients || []).map((ing) => {
      if (!ingredientMatches(ing, MUSHROOM)) return { ...ing };
      const sub = subs && subs.mushroom;
      if (!sub) return { ...ing }; // left as mushroom; caught by the check below
      substituted.push({ from: ing.label || ing.key, to: sub.label });
      return { ...ing, key: sub.key, label: sub.label };
    });

    if (hasMushroom(ingredients)) return null; // no substitution entry — degrade to reject

    return { meal: { ...meal, ingredients }, substituted };
  }

  root.MP = root.MP || {};
  root.MP.Exclusions = { hasMushroom, isStandaloneEgg, hasVegInToastie, check, sanitize };
})(typeof globalThis !== "undefined" ? globalThis : this);
