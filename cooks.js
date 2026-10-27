// MP.Cooks: leftover-portion bookkeeping (Phase 20), extracted from plan.js in Phase 104 so Browse can open a record.
(function () {
  "use strict";

  const LS_COOKS = "mp_cooks";
  let shelfData = null; // set by the page via MP.Cooks.setShelf; null = never prune on age

  // Bare array, same convention as mp_eatenLog. Never references
  // MP.ShoppingList — the portion-eat path must be structurally incapable of
  // touching the pantry.

  /** shelfOverride lets tests supply shelfData without a real fetch; falls
   *  back to the module's own shelfData (unavailable => never prune on age).
   *  A record is kept until its eat-by (fridge days, or frozen months) passes. */
  function cooksAll(shelfOverride) {
    let raw;
    try {
      raw = JSON.parse(localStorage.getItem(LS_COOKS) || "[]");
    } catch {
      raw = null;
    }
    if (!Array.isArray(raw)) raw = [];
    const sd = shelfOverride !== undefined ? shelfOverride : shelfData;
    const today = new Date().toISOString().slice(0, 10);
    const kept = raw.filter((r) => {
      if (!r || r.portionsLeft <= 0) return false;
      const eatBy = sd && MP.ShelfLife.leftoverEatBy(r, sd);
      return !eatBy || eatBy >= today;
    });
    if (kept.length !== raw.length) localStorage.setItem(LS_COOKS, JSON.stringify(kept));
    return kept;
  }

  /** The one write path: persist, then mirror to the Worker best-effort. */
  function cooksWrite(all) {
    localStorage.setItem(LS_COOKS, JSON.stringify(all));
    if (MP.Sync && MP.Sync.pushCooks) MP.Sync.pushCooks(all);
  }

  /** Fridge records first (the freezer is the reserve), then newest. */
  function cooksOpenFor(mealId, shelfOverride) {
    const frozen = (r) => (r.storage === "freezer" ? 1 : 0);
    return cooksAll(shelfOverride)
      .filter((r) => r.mealId === mealId)
      .sort((a, b) => frozen(a) - frozen(b) || new Date(b.cookedAt) - new Date(a.cookedAt));
  }

  function cooksOpen(meal, variantId, portions) {
    if (portions < 1) return null;
    const cookedAt = new Date().toISOString();
    const record = {
      id: `${meal.id}:${cookedAt}`,
      mealId: meal.id,
      name: meal.name,
      variantId: variantId || null,
      cookedAt,
      portionsLeft: portions,
    };
    const all = cooksAll();
    all.push(record);
    cooksWrite(all);
    return record;
  }

  function cooksTake(cookId) {
    const all = cooksAll();
    const idx = all.findIndex((r) => r.id === cookId);
    if (idx === -1) return null;
    all[idx] = { ...all[idx], portionsLeft: all[idx].portionsLeft - 1 };
    cooksWrite(all);
    return all[idx];
  }

  /** "Threw away": closes the record, no log entry. */
  function cooksDiscard(cookId) {
    const all = cooksAll();
    const idx = all.findIndex((r) => r.id === cookId);
    if (idx === -1) return false;
    all[idx] = { ...all[idx], portionsLeft: 0 };
    cooksWrite(all);
    return true;
  }

  /** Moves one portion from a fridge record to its freezer twin (created if absent). */
  function cooksFreezeOne(cookId) {
    const all = cooksAll();
    const idx = all.findIndex((r) => r.id === cookId);
    if (idx === -1 || all[idx].storage === "freezer") return null;
    const src = all[idx];
    all[idx] = { ...src, portionsLeft: src.portionsLeft - 1 };
    const twinId = `${src.id}:frozen`;
    let twin = all.find((r) => r.id === twinId);
    if (twin) twin.portionsLeft += 1;
    else {
      twin = { ...src, id: twinId, cookedAt: new Date().toISOString(), portionsLeft: 1, storage: "freezer" };
      all.push(twin);
    }
    cooksWrite(all);
    return twin;
  }

  MP.Cooks = { all: cooksAll, openFor: cooksOpenFor, open: cooksOpen, take: cooksTake, discard: cooksDiscard, freezeOne: cooksFreezeOne, setShelf: (sd) => { shelfData = sd; } };
})();
