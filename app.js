// Browse & Add page controller.
(function () {
  "use strict";

  const { esc, labelize } = MP;
  let tagsData = null;
  let library = [];
  let discoverPool = [];

  function toast(msg) {
    const root = document.getElementById("toast-root");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  function collectMealTags(meal) {
    const map = {};
    for (const ing of meal.ingredients || []) {
      const t = tagsData.tags[ing.key];
      if (!t) continue;
      for (const [n, l] of Object.entries(t)) {
        const w = { high: 3, med: 2, low: 1 }[l];
        if (!map[n] || w > map[n].w) map[n] = { level: l, w };
      }
    }
    return Object.entries(map)
      .sort((a, b) => b[1].w - a[1].w)
      .slice(0, 3)
      .map(([n, v]) => ({ nutrient: n, level: v.level }));
  }

  function cardImageHtml(meal) {
    if (meal.image) {
      return `<img class="card-img" src="${esc(meal.image)}" alt="${esc(meal.name)}" loading="lazy">`;
    }
    return `<div class="card-img placeholder">🍽</div>`;
  }

  function tagRowHtml(meal) {
    const tags = collectMealTags(meal);
    if (!tags.length) return "";
    return `<div class="tag-row">${tags
      .map((t) => `<span class="tag ${t.level}">${esc(labelize(t.nutrient))} ${esc(t.level)}</span>`)
      .join("")}</div>`;
  }

  function renderLibrary() {
    const grid = document.getElementById("library-grid");
    const query = document.getElementById("library-search").value;
    const filtered = MP.filterMeals(library, query);
    if (!filtered.length && query.trim()) {
      grid.innerHTML = `<p class="empty">No meals match "${esc(query.trim())}".</p>`;
      return;
    }
    grid.innerHTML = filtered
      .map(
        (meal) => `
      <div class="card" data-id="${esc(meal.id)}">
        ${cardImageHtml(meal)}
        <div class="card-body">
          <h3>${esc(meal.name)}</h3>
          <p>${esc(meal.description || "")}</p>
          ${tagRowHtml(meal)}
        </div>
      </div>`
      )
      .join("");
    grid.querySelectorAll(".card").forEach((card) => {
      card.addEventListener("click", () => {
        const meal = library.find((m) => m.id === card.dataset.id);
        if (meal) openDetail(meal);
      });
    });
  }

  function openDetail(meal) {
    const overlay = document.getElementById("modal-overlay");
    const sheet = document.getElementById("modal-sheet");
    const ingredientsHtml = (meal.ingredients || [])
      .map((i) => `<li>${esc(i.label || labelize(i.key))}${i.qty ? " — " + esc(i.qty) : ""}</li>`)
      .join("");
    sheet.innerHTML = `
      <button class="close-btn" aria-label="Close">✕</button>
      ${meal.image ? `<img src="${esc(meal.image)}" alt="${esc(meal.name)}">` : ""}
      <h2>${esc(meal.name)}</h2>
      ${tagRowHtml(meal)}
      <p>${esc(meal.description || "")}</p>
      <h3>Ingredients</h3>
      <ul class="ingredient-list">${ingredientsHtml}</ul>
      <h3>Instructions</h3>
      <p>${esc(meal.instructions || "")}</p>
    `;
    sheet.querySelector(".close-btn").addEventListener("click", closeDetail);
    overlay.classList.remove("hidden");
  }

  function closeDetail() {
    document.getElementById("modal-overlay").classList.add("hidden");
  }

  function excludeIds() {
    const liked = new Set(library.map((m) => m.id));
    const dismissed = MP.getDismissed();
    return [...liked, ...dismissed];
  }

  function renderDeck() {
    const deck = document.getElementById("swipe-deck");
    deck.innerHTML = "";
    if (!discoverPool.length) {
      deck.innerHTML = `<div class="swipe-empty">No more suggestions right now — check back later.</div>`;
      return;
    }
    // Render up to 3 stacked cards, top one interactive.
    discoverPool.slice(0, 3).forEach((meal, idx) => {
      const card = document.createElement("div");
      card.className = "swipe-card";
      card.style.zIndex = String(10 - idx);
      card.style.transform = `scale(${1 - idx * 0.03}) translateY(${idx * 10}px)`;
      card.innerHTML = `
        ${cardImageHtml(meal)}
        <div class="card-body">
          <h3>${esc(meal.name)}</h3>
          <p>${esc(meal.description || "")}</p>
          ${tagRowHtml(meal)}
        </div>`;
      if (idx === 0) {
        MP.makeSwipeable(card, {
          onSwipeRight: () => {
            library = MP.addToLibrary(meal);
            toast(`Added "${meal.name}" to your library`);
            discoverPool = discoverPool.filter((m) => m.id !== meal.id);
            renderLibrary();
            renderDeck();
          },
          onSwipeLeft: () => {
            MP.dismiss(meal.id);
            discoverPool = discoverPool.filter((m) => m.id !== meal.id);
            renderDeck();
          },
          onTap: () => openDetail(meal),
        });
      }
      deck.appendChild(card);
    });
  }

  async function init() {
    MP.initTheme();
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") closeDetail();
    });

    document.getElementById("library-search").addEventListener("input", renderLibrary);

    [tagsData, library] = await Promise.all([MP.Nutrition.load(), MP.getLibrary()]);
    renderLibrary();

    try {
      discoverPool = await MP.MealDB.getDiscoverPool(excludeIds());
    } catch (e) {
      discoverPool = [];
    }
    renderDeck();
  }

  init();
})();
