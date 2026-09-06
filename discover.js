// Discover page controller: fanned 3-card swipe deck (like / pass / save for
// later) over TheMealDB suggestions, plus the saved-for-later pile below it.
(function () {
  "use strict";

  const { esc, labelize } = MP;
  const FAN_ANGLES = [0, -6, 5];

  let pool = [];
  let idx = 0;
  let activeCat = "";
  let loadFailed = false;
  let pantryFirst = false;
  let pantryKeys = null;

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

  function cardInner(meal) {
    return `
      <div class="fan-stamp like">Liked</div>
      <div class="fan-stamp skip">Pass</div>
      <div class="fan-stamp super">Saved</div>
      ${cardImageHtml(meal)}
      <div class="card-body">
        <h3>${esc(meal.name)}</h3>
        <p>${esc(meal.description || "")}</p>
      </div>`;
  }

  function makeDraggable(el) {
    let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false;
    const likeStamp = el.querySelector(".fan-stamp.like");
    const skipStamp = el.querySelector(".fan-stamp.skip");
    const superStamp = el.querySelector(".fan-stamp.super");
    const base = el.dataset.base || "";

    function down(e) {
      dragging = true;
      el.classList.add("dragging");
      el.setPointerCapture(e.pointerId);
      startX = e.clientX; startY = e.clientY;
    }
    function move(e) {
      if (!dragging) return;
      dx = e.clientX - startX; dy = e.clientY - startY;
      const rot = dx / 14;
      el.style.transform = `${base} translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
      likeStamp.style.opacity = Math.max(0, Math.min(1, dx / 90));
      skipStamp.style.opacity = Math.max(0, Math.min(1, -dx / 90));
      superStamp.style.opacity = Math.max(0, Math.min(1, -dy / 80));
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("dragging");
      const threshold = 100;
      if (dy < -threshold && Math.abs(dy) > Math.abs(dx)) decide(el, "super");
      else if (dx > threshold) decide(el, "like");
      else if (dx < -threshold) decide(el, "skip");
      else {
        el.style.transform = base;
        likeStamp.style.opacity = 0; skipStamp.style.opacity = 0; superStamp.style.opacity = 0;
      }
    }
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function decide(el, dir) {
    const meal = pool[idx];
    if (!meal) return;
    if (dir === "like") {
      MP.addToLibrary(meal);
      toast(`Added "${meal.name}" to your library`);
      el.style.transform = "translate(700px, -30px) rotate(24deg)";
    } else if (dir === "super") {
      MP.saveForLater(meal);
      toast(`Saved "${meal.name}" for later`);
      el.style.transform = "translate(0, -650px) rotate(0deg) scale(.9)";
      renderSaved();
    } else {
      MP.dismiss(meal.id, meal.name);
      el.style.transform = "translate(-700px, -30px) rotate(-24deg)";
    }
    el.style.opacity = "0";
    idx++;
    setTimeout(renderDeck, 260);
  }

  function renderDeck() {
    const deck = document.getElementById("fan-deck");
    const progress = document.getElementById("fan-progress");
    deck.innerHTML = "";
    const upcoming = pool.slice(idx, idx + 3);
    if (!upcoming.length) {
      const msg = loadFailed
        ? "Couldn't reach TheMealDB — check your connection and tap the chip again."
        : activeCat
        ? `No more ${esc(activeCat)} suggestions — try another chip.`
        : "📌 No more suggestions right now — check back later.";
      deck.innerHTML = `<div class="swipe-empty">${msg}</div>`;
      progress.textContent = "";
      document.getElementById("fan-filmstrip").innerHTML = "";
      return;
    }
    progress.textContent = `Reviewed ${idx} of ${pool.length}`;
    upcoming.forEach((meal, i) => {
      const el = document.createElement("div");
      el.className = "fan-card";
      el.innerHTML = cardInner(meal);
      const angle = FAN_ANGLES[i] || 0;
      const finalT = `translateY(${i * 6}px) scale(${1 - i * 0.05}) rotate(${angle}deg)`;
      el.dataset.base = finalT;
      el.style.zIndex = String(10 - i);
      el.style.transform = `translateY(${i * 6 + 60}px) scale(${1 - i * 0.05}) rotate(${angle}deg)`;
      el.style.opacity = "0";
      deck.appendChild(el);
      requestAnimationFrame(() => {
        el.style.transform = finalT;
        el.style.opacity = i < 2 ? "1" : "0.55";
      });
      if (i === 0) makeDraggable(el);
    });
    renderFilmstrip();
  }

  function renderFilmstrip() {
    const filmstrip = document.getElementById("fan-filmstrip");
    filmstrip.innerHTML = "";
    pool.slice(idx + 1, idx + 7).forEach((meal, i) => {
      const c = document.createElement("div");
      c.className = "film-card";
      c.style.setProperty("--r", i % 2 ? "3deg" : "-3deg");
      c.innerHTML = `<div class="e">🍽</div><div class="n"></div>`;
      c.querySelector(".n").textContent = meal.name;
      filmstrip.appendChild(c);
    });
  }

  function renderSaved() {
    const grid = document.getElementById("saved-grid");
    const saved = MP.getSavedLater();
    if (!saved.length) {
      grid.innerHTML = `<p class="empty">Nothing saved yet — swipe up on a card to save it for later.</p>`;
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

  document.getElementById("fan-like").addEventListener("click", () => {
    const top = document.querySelector("#fan-deck .fan-card");
    if (top) decide(top, "like");
  });
  document.getElementById("fan-skip").addEventListener("click", () => {
    const top = document.querySelector("#fan-deck .fan-card");
    if (top) decide(top, "skip");
  });
  document.getElementById("fan-super").addEventListener("click", () => {
    const top = document.querySelector("#fan-deck .fan-card");
    if (top) decide(top, "super");
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

  /** Count of a meal's ingredients already on hand, by normalized key. */
  function pantryOverlap(meal, have) {
    return (meal.ingredients || []).filter((ing) => have[MP.ShoppingList.normalizeKey(ing.key)]).length;
  }

  // ponytail: raw unweighted count — one pantry staple ranks like one pantry
  // protein. Weight by pack price only if the ordering proves useless in
  // real use.
  /** Stable-sort permutation of list, descending pantryOverlap. Never a filter —
   *  zero-overlap meals come last, not out. Index-decorated so it doesn't rely
   *  on engine sort stability. */
  function orderPool(list, have) {
    return list
      .map((m, i) => ({ m, i, s: pantryOverlap(m, have) }))
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
    document.getElementById("fan-filmstrip").innerHTML = "";
    let next;
    let gaps = [];
    try {
      const [ids, g] = await Promise.all([excludeIds(), libraryGaps()]);
      gaps = g;
      next = await MP.MealDB.getDiscoverPool(ids, cat);
      // ponytail: reorders the 10 the pool already picked, doesn't widen the pick.
      // Raise mealdb POOL_LIMIT if the top card stops feeling gap-relevant.
      if (gaps.length) {
        const { tags } = await MP.Nutrition.load();
        next = MP.Nutrition.rankByGap(next, gaps, tags);
      }
      if (MP.Prefs) {
        const library = await MP.getLibrary();
        next = MP.Prefs.orderByTaste(next, MP.Prefs.get(), [...library, ...MP.getSavedLater()]);
      }
      if (pantryFirst) next = orderPool(next, await pantryIndexCached());
    } catch (e) {
      loadFailed = true;
      next = [];
    }
    if (cat !== activeCat) return;
    pool = next;
    idx = 0;
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
        idx = 0;
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
    renderSaved();
    await loadPool("");
  }

  init();
})();
