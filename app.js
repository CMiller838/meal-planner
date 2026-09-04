// Browse & Add page controller.
(function () {
  "use strict";

  const { esc, labelize } = MP;
  let tagsData = null;
  let packData = null;
  let library = [];
  let activeType = "";

  // toast() is triplicated across app.js/discover.js/plan.js; extending only
  // this copy for the undo action button — a shared module is a refactor
  // this phase didn't ask for.
  function toast(msg, actionLabel, onAction) {
    const root = document.getElementById("toast-root");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    if (actionLabel) {
      const btn = document.createElement("button");
      btn.textContent = actionLabel;
      btn.addEventListener("click", () => {
        el.remove();
        onAction();
      });
      el.appendChild(btn);
    }
    root.appendChild(el);
    setTimeout(() => el.remove(), actionLabel ? 6000 : 1800);
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
    const filtered = MP.filterMeals(library, query).filter(
      (m) => !activeType || (m.mealTypes || []).includes(activeType)
    );
    if (!filtered.length) {
      const q = query.trim();
      let msg;
      if (q && activeType) msg = `No ${activeType} meals match "${esc(q)}".`;
      else if (q) msg = `No meals match "${esc(q)}".`;
      else if (activeType) msg = `No ${esc(activeType)} meals in your library yet.`;
      else msg = "Your library is empty.";
      grid.innerHTML = `<p class="empty">${msg}</p>`;
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
      <div class="modal-actions">
        <button id="detail-edit" class="btn">Edit</button>
        <button id="detail-delete" class="ghost danger">Delete</button>
      </div>
    `;
    sheet.querySelector(".close-btn").addEventListener("click", closeDetail);
    sheet.querySelector("#detail-edit").addEventListener("click", () => openForm(meal));
    sheet.querySelector("#detail-delete").addEventListener("click", () => deleteMeal(meal));
    overlay.classList.remove("hidden");
  }

  function deleteMeal(meal) {
    if (!confirm(`Remove "${meal.name}" from your library?`)) return;
    library = MP.removeFromLibrary(meal.id);
    closeDetail();
    renderLibrary();
    // ponytail: undo lives exactly as long as the toast — no trash, no
    // history. Once it expires the delete has already synced to Hermes.
    toast(`Removed "${meal.name}"`, "Undo", () => {
      library = MP.addToLibrary(meal);
      renderLibrary();
    });
  }

  function closeDetail() {
    document.getElementById("modal-overlay").classList.add("hidden");
  }

  function knownKeys() {
    const tagKeys = tagsData ? Object.keys(tagsData.tags) : [];
    const packKeys = packData ? Object.keys(packData.items) : [];
    return [...tagKeys, ...packKeys].filter((k) => !k.startsWith("_"));
  }

  /** @param {object|null} meal  null = Add mode, a library meal = Edit mode */
  function openForm(meal) {
    const overlay = document.getElementById("modal-overlay");
    const sheet = document.getElementById("modal-sheet");
    const types = ["breakfast", "lunch", "dinner", "snack"];
    sheet.innerHTML = `
      <button class="close-btn" aria-label="Close">✕</button>
      <h2>${meal ? "Edit meal" : "Add a meal"}</h2>
      <label class="sync-field">Name
        <input type="text" id="form-name">
      </label>
      <label class="sync-field">Description
        <textarea id="form-description" rows="2"></textarea>
      </label>
      <label class="sync-field">Recipe
        <textarea id="form-instructions" rows="6"></textarea>
      </label>
      <label class="sync-field">Ingredients
        <textarea id="form-ingredients" rows="6" placeholder="500g chicken breast&#10;or: chicken breast — 500g"></textarea>
      </label>
      <div class="sync-field">Meal types
        ${types
          .map(
            (t) => `<label><input type="checkbox" class="form-type" value="${t}"> ${esc(labelize(t))}</label>`
          )
          .join(" ")}
      </div>
      <p id="form-msg" class="muted"></p>
      <div class="modal-actions">
        <button id="form-save" class="btn">Save</button>
        <button id="form-cancel" class="ghost">Cancel</button>
      </div>
    `;
    const nameInput = sheet.querySelector("#form-name");
    nameInput.value = meal ? meal.name : "";
    sheet.querySelector("#form-description").value = meal ? meal.description || "" : "";
    sheet.querySelector("#form-instructions").value = meal ? meal.instructions || "" : "";
    sheet.querySelector("#form-ingredients").value = meal ? MP.ingredientsToText(meal.ingredients) : "";
    const mealTypes = meal ? meal.mealTypes || [] : [];
    sheet.querySelectorAll(".form-type").forEach((cb) => {
      cb.checked = mealTypes.includes(cb.value);
    });

    const msg = sheet.querySelector("#form-msg");
    nameInput.addEventListener("input", () => {
      const similar = MP.findSimilarName(library, nameInput.value, meal ? meal.id : null);
      msg.classList.remove("error");
      msg.textContent = similar ? `Similar to "${similar.name}" — add anyway if it's different.` : "";
    });

    sheet.querySelector("#form-cancel").addEventListener("click", closeDetail);
    sheet.querySelector("#form-save").addEventListener("click", () => saveForm(meal, msg));
    sheet.querySelector(".close-btn").addEventListener("click", closeDetail);
    overlay.classList.remove("hidden");
  }

  /** Read the form fields into a meal record, merged over the original. */
  function readForm(original) {
    const sheet = document.getElementById("modal-sheet");
    const name = sheet.querySelector("#form-name").value.trim();
    const mealTypes = [...sheet.querySelectorAll(".form-type")]
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);
    const ingredients = MP.parseIngredients(sheet.querySelector("#form-ingredients").value, knownKeys());
    const record = {
      ...(original || {
        id: "user-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + "-" + Date.now().toString(36),
        source: "manual",
        prepEffort: "quick",
        batchCook: false,
        servings: 1,
        image: null,
      }),
      name,
      description: sheet.querySelector("#form-description").value.trim(),
      instructions: sheet.querySelector("#form-instructions").value.trim(),
      mealTypes,
      ingredients,
    };
    return record;
  }

  function saveForm(original, msg) {
    const name = document.getElementById("form-name").value.trim();
    if (!name) {
      msg.classList.add("error");
      msg.textContent = "A meal needs a name.";
      return;
    }
    const candidate = readForm(original);
    const { ok, reasons } = MP.Exclusions.check(candidate);
    if (!ok) {
      msg.classList.add("error");
      msg.textContent = `Can't save — ${reasons.join(", ")}.`;
      return;
    }
    library = MP.upsertMeal(candidate);
    closeDetail();
    renderLibrary();
    toast(`Saved "${candidate.name}"`);
  }

  function initSyncSettings() {
    const status = document.getElementById("sync-status");
    const urlInput = document.getElementById("sync-url");
    const tokenInput = document.getElementById("sync-token");
    const cfg = MP.Sync.config();
    urlInput.value = cfg.url;
    tokenInput.value = cfg.token;

    const STATUS_TEXT = {
      pull: "Pulled library from Hermes",
      push: "Pushed library to Hermes",
      noop: "In sync",
      error: "Sync failed — check the URL and token",
      off: "Not set up",
    };

    document.getElementById("sync-save").addEventListener("click", async () => {
      MP.Sync.saveConfig(urlInput.value, tokenInput.value);
      status.textContent = "Syncing…";
      const result = await MP.Sync.syncLibrary();
      status.textContent = STATUS_TEXT[result] || "Not set up";
    });

    window.addEventListener("mp:library-pulled", async () => {
      library = await MP.getLibrary();
      renderLibrary();
    });
  }

  async function init() {
    MP.initTheme();
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") closeDetail();
    });

    document.getElementById("library-search").addEventListener("input", renderLibrary);
    document.getElementById("add-meal").addEventListener("click", () => openForm(null));
    document.getElementById("library-filters").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      activeType = chip.dataset.type;
      chip.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
      renderLibrary();
    });

    [tagsData, library, packData] = await Promise.all([
      MP.Nutrition.load(),
      MP.getLibrary(),
      MP.ShoppingList.load().catch(() => null),
    ]);
    renderLibrary();
    initSyncSettings();
    MP.Sync.start();
  }

  init();
})();
