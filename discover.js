// Discover page controller (Phase 113): swipe card stack (right add, left dismiss,
// tap for details, Undo) over TheMealDB suggestions, plus the saved-for-later pile.
(function () {
  "use strict";

  const { esc, labelize } = MP;

  let pool = [];
  let idx = 0;
  let activeCat = "";
  let loadFailed = false;
  let pantryFirst = false;
  let pantryKeys = null;
  let packData = null;
  let busy = false;
  let hist = [];
  let gaps = [];
  let nutTags = null;

  function toast(msg) {
    const root = document.getElementById("toast-root");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  function cardImageHtml(meal) {
    if (meal.image) {
      return `<img class="card-img" src="${esc(meal.image)}" alt="${esc(meal.name)}" loading="lazy">`;
    }
    return `<div class="card-img placeholder">🍽</div>`;
  }

  function tagRowHtml(meal) {
    const badge = MP.ShoppingList.costBadgeHtml(meal, packData);
    return badge ? `<div class="tag-row">${badge}</div>` : "";
  }

  function gapChipsHtml(meal) {
    if (!nutTags) return "";
    const hits = MP.Nutrition.gapHits(meal, gaps, nutTags);
    return hits.length ? `<div class="fan-gaps">${hits.map((g) => `<span class="fan-gap">Fills ${esc(labelize(g))}</span>`).join("")}</div>` : "";
  }

  function ingLineHtml(meal) {
    const ings = (meal.ingredients || []).map((i) => i.label || labelize(i.key));
    if (!ings.length) return "";
    const more = ings.length > 4 ? ` +${ings.length - 4} more` : "";
    return `<p class="fan-ing"><b>Ingredients</b> ${esc(ings.slice(0, 4).join(", "))}${more}</p>`;
  }

  function cardInner(meal) {
    return `
      <div class="fan-stamp like">Add</div>
      <div class="fan-stamp skip">Dismiss</div>
      ${cardImageHtml(meal)}
      <div class="fan-body">
        <h3>${esc(meal.name)}</h3>
        ${tagRowHtml(meal)}
        ${gapChipsHtml(meal)}
        ${ingLineHtml(meal)}
      </div>`;
  }

  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const topEl = () => document.querySelector("#fan-deck .fan-card.top");
  const sheetOpen = () => { const o = document.getElementById("meal-sheet-overlay"); return !!o && !o.classList.contains("hidden"); };

  function updateUndo() {
    document.getElementById("fan-undo").disabled = !hist.length;
  }

  function makeDraggable(el) {
    let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false;
    const likeStamp = el.querySelector(".fan-stamp.like");
    const skipStamp = el.querySelector(".fan-stamp.skip");
    function reset() {
      el.style.transform = "";
      likeStamp.style.opacity = 0; skipStamp.style.opacity = 0;
    }
    el.addEventListener("pointerdown", (e) => {
      if (busy || sheetOpen()) return;
      dragging = true; dx = 0; dy = 0;
      el.classList.add("dragging");
      el.setPointerCapture(e.pointerId);
      startX = e.clientX; startY = e.clientY;
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      dx = e.clientX - startX; dy = e.clientY - startY;
      el.style.transform = `translate(${dx}px, ${Math.min(dy, 40)}px) rotate(${dx / 18}deg)`;
      likeStamp.style.opacity = Math.max(0, Math.min(1, dx / 90));
      skipStamp.style.opacity = Math.max(0, Math.min(1, -dx / 90));
    });
    function end(e) {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("dragging");
      if (e.type === "pointercancel") return reset();
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) { reset(); return openDetails(pool[idx]); }
      if (dx > 100) decide("add");
      else if (dx < -100) decide("dismiss");
      else reset();
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  /** One decision on the top card: dir = add | dismiss | save. Ignored while the previous fly-out runs. */
  function decide(dir) {
    const meal = pool[idx];
    if (!meal || busy) return;
    busy = true;
    if (dir === "add") { MP.addToLibrary(meal); toast(`Added "${meal.name}" to your library`); }
    else if (dir === "save") { MP.saveForLater(meal); toast(`Saved "${meal.name}" for later`); renderSaved(); }
    else { MP.dismiss(meal.id, meal.name); toast(`Dismissed "${meal.name}"`); }
    hist.push({ dir, meal, idx });
    idx++;
    updateUndo();
    const el = topEl();
    const finish = () => { busy = false; renderDeck(true); };
    if (el && !still()) {
      el.classList.add("fly");
      el.style.transform = dir === "add" ? "translate(130%, -20px) rotate(20deg)" : dir === "dismiss" ? "translate(-130%, -20px) rotate(-20deg)" : "translateY(-30px) scale(.9)";
      el.style.opacity = "0";
      setTimeout(finish, 240);
    } else finish();
  }

  /** Reverse the last decision (not the soft taste counter). */
  function undo() {
    if (busy || !hist.length) return;
    const h = hist.pop();
    if (h.dir === "add") MP.removeFromLibrary(h.meal.id);
    else if (h.dir === "save") { MP.removeSavedLater(h.meal.id); renderSaved(); }
    else MP.undismiss(h.meal.id);
    idx = h.idx;
    toast(`Undone: "${h.meal.name}"`);
    updateUndo();
    renderDeck(true);
  }

  function renderDeck(advance) {
    const deck = document.getElementById("fan-deck");
    const progress = document.getElementById("fan-progress");
    deck.innerHTML = "";
    deck.classList.toggle("adv", !!advance);
    const upcoming = pool.slice(idx, idx + 3);
    document.getElementById("fan-details").disabled = !upcoming.length;
    document.getElementById("fan-like").disabled = !upcoming.length;
    document.getElementById("fan-skip").disabled = !upcoming.length;
    if (!upcoming.length) {
      const msg = loadFailed
        ? "Couldn't reach TheMealDB — check your connection and tap the chip again."
        : activeCat
        ? `No more ${esc(activeCat)} suggestions — try another chip.`
        : "📌 No more suggestions right now — check back later.";
      const n = MP.getDismissed().size;
      deck.innerHTML = `<div class="swipe-empty">${msg}${n ? `<br><button class="fan-btn fan-empty-btn" id="fan-bring-back">Bring back ${n} dismissed</button>` : ""}</div>`;
      progress.textContent = "";
      const bb = document.getElementById("fan-bring-back");
      if (bb) bb.addEventListener("click", () => { MP.getDismissed().forEach((id) => MP.undismiss(id)); loadPool(activeCat); });
      return;
    }
    progress.textContent = `Reviewed ${idx} of ${pool.length}`;
    // render back-to-front so the top card is last in the DOM (and focus order)
    for (let i = upcoming.length - 1; i >= 0; i--) {
      const el = document.createElement("div");
      el.className = "fan-card" + (i === 0 ? " top" : i === 2 ? " third" : "");
      el.style.setProperty("--i", i);
      el.innerHTML = cardInner(upcoming[i]);
      deck.appendChild(el);
      if (i === 0) {
        el.tabIndex = 0;
        el.setAttribute("aria-label", `${upcoming[i].name}. Arrow right adds, left dismisses, up for details.`);
        makeDraggable(el);
      }
    }
  }

  function closeDetails() {
    MP.MealSheet.close();
    const t = topEl();
    if (t) t.focus();
  }

  /** Phase 115: the shared MealSheet; each dock action closes it, then decides on the top card. */
  function openDetails(meal) {
    if (!meal) return;
    const go = (act) => () => { closeDetails(); decide(act); };
    MP.MealSheet.open(meal, {
      tagsHtml: tagRowHtml(meal) + gapChipsHtml(meal),
      actions: [
        { id: "add", label: "♥ Add to library", kind: "pri", onClick: go("add") },
        { id: "dismiss", label: "✕ Dismiss", onClick: go("dismiss") },
        { id: "save", label: "Save for later", onClick: go("save") },
      ],
    });
  }

  function renderSaved() {
    const grid = document.getElementById("saved-grid");
    const saved = MP.getSavedLater();
    if (!saved.length) {
      grid.innerHTML = `<p class="empty">Nothing saved yet — open a card's details and tap "Save for later".</p>`;
      return;
    }
    grid.innerHTML = saved
      .map(
        (meal) => `
      <div class="card" data-id="${esc(meal.id)}" style="cursor:default;">
        ${cardImageHtml(meal)}
        <div class="card-body">
          <h3>${esc(meal.name)}</h3>
          <p>${esc(meal.description || "")}</p>
          ${tagRowHtml(meal)}
          <div class="card-actions">
            <button class="btn add-btn">+ Add to library</button>
            <button class="ghost remove-btn">Remove</button>
          </div>
        </div>
      </div>`
      )
      .join("");
    grid.querySelectorAll(".card").forEach((card) => {
      const id = card.dataset.id;
      const meal = saved.find((m) => m.id === id);
      card.querySelector(".add-btn").addEventListener("click", () => {
        MP.addToLibrary(meal);
        MP.removeSavedLater(id);
        toast(`Added "${meal.name}" to your library`);
        renderSaved();
      });
      card.querySelector(".remove-btn").addEventListener("click", () => {
        MP.removeSavedLater(id);
        renderSaved();
      });
    });
  }

  document.getElementById("fan-like").addEventListener("click", () => decide("add"));
  document.getElementById("fan-skip").addEventListener("click", () => decide("dismiss"));
  document.getElementById("fan-details").addEventListener("click", () => openDetails(pool[idx]));
  document.getElementById("fan-undo").addEventListener("click", undo);

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (sheetOpen()) { if (e.key === "Escape") closeDetails(); return; }
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    const k = e.key;
    if (k === "z" || k === "Z") undo();
    else if (k === "ArrowRight") { e.preventDefault(); decide("add"); }
    else if (k === "ArrowLeft") { e.preventDefault(); decide("dismiss"); }
    else if (k === "ArrowUp") { e.preventDefault(); openDetails(pool[idx]); }
    else if (k === "Enter" && e.target === topEl()) openDetails(pool[idx]);
  });

  /** Ids the deck must never show: already in the library, dismissed, or saved for later.
   *  Recomputed per load so a chip switch respects likes made since page load. */
  async function excludeIds() {
    const library = await MP.getLibrary();
    return [
      ...library.map((m) => m.id),
      ...MP.getDismissed(),
      ...MP.getSavedLater().map((m) => m.id),
    ];
  }

  /** Nutrients the whole liked-meal library under-covers, worst-first-ish, for ranking the deck.
   *  Same call pair as plan.js's swap suggestions, with the library as the meal set instead of
   *  one day's other slots. Returns [] if nutrition data can't load — Discover must still work.
   *  @returns {Promise<string[]>} subset of MP.Nutrition.TRACKED_NUTRIENTS */
  async function libraryGaps() {
    try {
      const [library, nut] = await Promise.all([MP.getLibrary(), MP.Nutrition.load()]);
      const cov = MP.Nutrition.dayCoverage(library, nut.tags, nut.targets);
      return [...cov.missing, ...cov.partial];
    } catch (e) {
      return [];
    }
  }

  /** Cached pantry index, fetched once per page load. Degrades to {} on any
   *  failure — Discover must still work when Hermes is unreachable/unset up. */
  async function pantryIndexCached() {
    if (pantryKeys) return pantryKeys;
    try {
      pantryKeys = MP.ShoppingList.pantryIndex(await MP.Sync.fetchPantry());
    } catch (e) {
      pantryKeys = {};
    }
    return pantryKeys;
  }

  // ponytail: raw unweighted count — one pantry staple ranks like one pantry
  // protein. Weight by pack price only if the ordering proves useless in
  // real use.
  /** Stable-sort permutation of list, descending pantryOverlap. Never a filter —
   *  zero-overlap meals come last, not out. Index-decorated so it doesn't rely
   *  on engine sort stability. */
  function orderPool(list, have) {
    return list
      .map((m, i) => ({ m, i, s: MP.ShoppingList.pantryOverlap(m, have) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.m);
  }

  /** One line above the deck explaining the ordering. Hidden when there is nothing to fill.
   *  @param {string[]} gaps */
  function renderGapNote(gaps) {
    const el = document.getElementById("gap-note");
    const top = gaps.slice(0, 3).map(labelize).join(", ");
    el.textContent = top ? `Ranked to fill: ${top}` : "";
    el.hidden = !top;
  }

  /** Fetch, install and render the deck for one chip. @param {string} cat  "" = All */
  async function loadPool(cat) {
    activeCat = cat;
    loadFailed = false;
    document.getElementById("fan-deck").innerHTML = `<div class="swipe-empty">Loading suggestions…</div>`;
    document.getElementById("fan-progress").textContent = "";
    hist = []; busy = false; updateUndo();
    let next;
    let g2 = [];
    try {
      const [ids, g] = await Promise.all([excludeIds(), libraryGaps()]);
      g2 = g;
      next = await MP.MealDB.getDiscoverPool(ids, cat);
      // ponytail: reorders the 10 the pool already picked, doesn't widen the pick.
      // Raise mealdb POOL_LIMIT if the top card stops feeling gap-relevant.
      if (g2.length) {
        const { tags } = await MP.Nutrition.load();
        nutTags = tags;
        next = MP.Nutrition.rankByGap(next, g2, tags);
      }
      if (MP.Prefs) {
        const library = await MP.getLibrary();
        next = MP.Prefs.orderByTaste(next, MP.Prefs.get(), [...library, ...MP.getSavedLater()],
          MP.Ratings && MP.Ratings.tasteProfile(MP.Ratings.get(), [...library, ...MP.getSavedLater()]));
      }
      if (pantryFirst) next = orderPool(next, await pantryIndexCached());
    } catch (e) {
      loadFailed = true;
      next = [];
    }
    if (cat !== activeCat) return;
    pool = next;
    idx = 0;
    gaps = g2;
    renderGapNote(gaps);
    renderDeck();
  }

  document.getElementById("discover-filters").addEventListener("click", async (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    if (chip.dataset.filter === "pantry") {
      pantryFirst = !pantryFirst;
      chip.setAttribute("aria-pressed", String(pantryFirst));
      chip.classList.toggle("active", pantryFirst);
      if (pantryFirst) {
        pool = orderPool(pool, await pantryIndexCached());
        idx = 0; hist = []; updateUndo();
        renderDeck();
      } else {
        loadPool(activeCat);
      }
      return;
    }
    if (chip.dataset.cat === activeCat && !loadFailed) return;
    document.querySelectorAll("#discover-filters .chip[data-cat]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    loadPool(chip.dataset.cat);
  });

  async function init() {
    MP.initTheme();
    packData = await MP.ShoppingList.load().catch(() => null);
    renderSaved();
    await loadPool("");
  }

  init();
})();
