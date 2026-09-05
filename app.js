// Browse & Add page controller.
(function () {
  "use strict";

  const { esc, labelize } = MP;
  let tagsData = null;
  let packData = null;
  let library = [];
  let activeType = "";
  let formImage = null;

  const MAX_DIM = 640; // longest side, CSS px
  const QUALITIES = [0.72, 0.6, 0.5, 0.4];
  // Base64 is 4/3 of the encoded bytes, so 70000 chars ≈ 51KB of JPEG (the
  // roadmap's "roughly 50KB"). localStorage stores strings as UTF-16, so the
  // real quota cost is ~137KB per photo — ~2MB for all 14 seed meals against
  // a ~5MB origin quota.
  const MAX_CHARS = 70000;
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const IMAGE_ERRORS = {
    "not-an-image": "That file isn't an image.",
    "too-big": "That photo is too large — try one under 20MB.",
    "decode-failed": "Couldn't read that image. iPhone HEIC photos often need converting to JPEG first.",
    default: "Couldn't use that image.",
  };

  /** Decode an image file and re-encode it as a small JPEG data-URL.
   *  @param {File} file
   *  @returns {Promise<string>} data-URL, ≤ ~70000 chars
   *  @throws {Error} "not-an-image" | "too-big" | "decode-failed" */
  async function shrinkImage(file) {
    // accept="image/*" is a picker hint, not validation — Android hands back whatever it likes.
    if (!file.type.startsWith("image/")) throw new Error("not-an-image");
    if (file.size > MAX_FILE_BYTES) throw new Error("too-big");
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        // No EXIF handling needed: current browsers default <img> to
        // image-orientation: from-image and drawImage honours it, so a
        // portrait phone photo lands upright without a parser.
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("decode-failed"));
        el.src = url;
      });
      const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const draw = (w, h) => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        return canvas;
      };
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = draw(w, h);
      for (const q of QUALITIES) {
        const out = canvas.toDataURL("image/jpeg", q);
        if (out.length <= MAX_CHARS) return out;
      }
      // ponytail: two-pass ceiling — a pathological photo still over budget
      // here is returned anyway so saveForm's guard can fail loudly with an
      // actionable message. Upgrade path is a binary search on quality, not
      // a third hardcoded pass.
      return draw(Math.round(w / 2), Math.round(h / 2)).toDataURL("image/jpeg", 0.5);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

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
      <div class="sync-field">Photo
        <img id="form-image-preview" class="form-photo hidden" alt="">
        <div class="form-photo-row">
          <input type="file" id="form-image" accept="image/*">
          <button id="form-image-clear" class="ghost hidden">Remove photo</button>
        </div>
      </div>
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

    formImage = meal ? meal.image || null : null;
    const preview = sheet.querySelector("#form-image-preview");
    const fileIn = sheet.querySelector("#form-image");
    const clearBtn = sheet.querySelector("#form-image-clear");
    function showImage() {
      preview.src = formImage || "";
      preview.classList.toggle("hidden", !formImage);
      clearBtn.classList.toggle("hidden", !formImage);
    }
    const msg = sheet.querySelector("#form-msg");
    fileIn.addEventListener("change", async () => {
      const file = fileIn.files[0];
      if (!file) return;
      msg.classList.remove("error");
      msg.textContent = "Shrinking photo…";
      try {
        formImage = await shrinkImage(file);
        msg.textContent = "";
      } catch (e) {
        msg.classList.add("error");
        msg.textContent = IMAGE_ERRORS[e.message] || IMAGE_ERRORS.default;
      }
      fileIn.value = ""; // so re-picking the same file fires change again
      showImage();
    });
    clearBtn.addEventListener("click", () => {
      formImage = null;
      fileIn.value = "";
      showImage();
    });
    showImage();

    nameInput.addEventListener("input", () => {
      const similar = MP.findSimilarName(library, nameInput.value, meal ? meal.id : null);
      msg.classList.remove("error");
      msg.textContent = similar ? `Similar to "${similar.name}" — add anyway if it's different.` : "";
    });
    // Name-lookup fires on change (blur/commit), not input, so the platform
    // debounces it instead of firing a request per keystroke. Never
    // re-look-up when a photo already exists — a name edit must not clobber
    // it; Remove photo is the escape hatch.
    nameInput.addEventListener("change", async () => {
      if (formImage) return;
      const found = await MP.MealDB.imageByName(nameInput.value);
      // Re-check after the await: the user may have picked a photo while
      // the lookup was in flight, and their choice must win.
      if (found && !formImage) {
        formImage = found;
        showImage();
      }
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
      image: formImage,
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
    // MP.saveLibrary calls setItem unguarded (data.js), and a photo is the
    // first thing in this app big enough to hit the localStorage quota. The
    // guard belongs here, not in data.js — a silent saveLibrary would break
    // Hermes sync everywhere else too.
    try {
      library = MP.upsertMeal(candidate);
    } catch (e) {
      msg.classList.add("error");
      msg.textContent = "Couldn't save — browser storage is full. Remove a photo from another meal and try again.";
      return;
    }
    closeDetail();
    renderLibrary();
    toast(`Saved "${candidate.name}"`);
  }

  async function backfillImages(btn) {
    const missing = library.filter((m) => !m.image);
    if (!missing.length) {
      toast("Every meal already has an image.");
      return;
    }
    btn.disabled = true;
    const found = new Map();
    try {
      // Sequential, not Promise.all: nine parallel requests at a free public
      // API for a once-pressed button is rude for no benefit — the user
      // watches a counter either way. imageByName never throws.
      for (let i = 0; i < missing.length; i++) {
        btn.textContent = `Looking up ${i + 1}/${missing.length}…`;
        const image = await MP.MealDB.imageByName(missing[i].name);
        if (image) found.set(missing[i].id, image);
      }
      // Re-read rather than trusting the module-level library array — a
      // Hermes pull can land during this loop. One write, not N: calling
      // MP.upsertMeal per hit would fire mp:library-saved (and push to KV)
      // nine times.
      const current = await MP.getLibrary();
      const updated = current.map((m) => (found.has(m.id) ? { ...m, image: found.get(m.id) } : m));
      try {
        MP.saveLibrary(updated);
      } catch (e) {
        toast("Couldn't save — browser storage is full. Remove a photo from another meal and try again.");
        return;
      }
      library = updated;
      renderLibrary();
      toast(`Found ${found.size} of ${missing.length} images.`);
    } finally {
      btn.disabled = false;
      btn.textContent = "Find images";
    }
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
    document.getElementById("backfill-images").addEventListener("click", (e) => backfillImages(e.target));
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
