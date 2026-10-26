// Browse & Add page controller.
(function () {
  "use strict";

  const { esc, labelize } = MP;
  let tagsData = null;
  let packData = null;
  let library = [];
  let activeType = "";
  let formImage = null;
  let formVariants = [];
  let editingVariantId = null; // id of the variant being edited, null = new variant

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

  function ratingBadgeHtml(meal) {
    const r = MP.Ratings.get()[meal.id];
    if (!r) return "";
    return (r.never ? `<span class="tag never-badge">Never again</span>` : "")
      + (r.rating === "up" ? `<span class="tag" title="Liked">👍</span>` : r.rating === "down" ? `<span class="tag" title="Disliked">👎</span>` : "");
  }

  function tagRowHtml(meal) {
    const tags = collectMealTags(meal);
    const costBadge = MP.ShoppingList.costBadgeHtml(meal, packData) + ratingBadgeHtml(meal);
    if (!tags.length && !costBadge) return "";
    return `<div class="tag-row">${costBadge}${tags
      .map((t) => `<span class="tag ${t.level}">${esc(labelize(t.nutrient))} ${esc(t.level)}</span>`)
      .join("")}</div>`;
  }

  /** True when an ingredient key has no entry in ingredient-nutrient-tags.json (a gap, not zero). */
  function untracked(key) {
    return !!(tagsData && tagsData.tags) && !(key in tagsData.tags);
  }

  // ---- Drafts (Phase 50): assistant-made drafts from KV `drafts`, never in the library until accepted ----
  let drafts = [];
  const NEW_KEY = "__new__";

  function pendingDrafts() {
    const accepted = new Set(library.map((m) => m.fromDraft).filter(Boolean));
    drafts.filter((d) => accepted.has(d.id)).forEach((d) => MP.Sync.deleteDraft(d.id)); // retry, idempotent
    return drafts.filter((d) => !accepted.has(d.id));
  }

  function resolutionsOf(card) {
    const out = {};
    card.querySelectorAll("select.draft-map").forEach((sel) => {
      if (sel.value) out[sel.dataset.name] = sel.value === NEW_KEY ? MP.slugify(sel.dataset.name) : sel.value;
    });
    return out;
  }

  function renderDrafts() {
    const section = document.getElementById("drafts");
    const grid = document.getElementById("drafts-grid");
    const list = MP.Sync.config().enabled ? pendingDrafts() : [];
    section.classList.toggle("hidden", !list.length);
    const keys = knownKeys();
    grid.innerHTML = list
      .map((d) => {
        const tags = Object.entries(d.tags || {})
          .map(([n, l]) => `<span class="tag ${esc(l)}">${esc(labelize(n))} ${esc(l)}</span>`)
          .join("");
        const rows = d.ingredients
          .map((ing) => {
            const qty = ing.qty ? " — " + esc(ing.qty) : "";
            if (ing.key) {
              const lbl = labelize(ing.key);
              const snap = lbl.toLowerCase() !== ing.name.toLowerCase() ? ` → ${esc(lbl)}` : "";
              return `<li>${esc(ing.name)}${snap}${qty}</li>`;
            }
            return `<li>${esc(ing.name)}${qty}
              <select class="draft-map" data-name="${esc(ing.name)}" aria-label="Map ${esc(ing.name)}">
                <option value="">Choose…</option>
                <option value="${NEW_KEY}">Add as new ingredient</option>
                ${keys.map((k) => `<option value="${esc(k)}">${esc(labelize(k))}</option>`).join("")}
              </select></li>`;
          })
          .join("");
        const unreadable = (d.unreadable || []).length
          ? `<p class="muted">Couldn't read / assumed: ${d.unreadable.map(esc).join("; ")}</p>`
          : "";
        return `<div class="card draft-card" data-id="${esc(d.id)}"><div class="card-body">
          <h3>${esc(d.name)} <span class="tag">${esc(d.source)}</span>${d.cost != null ? ` <span class="tag cost">£${esc(Number(d.cost).toFixed(2))}</span>` : ""}</h3>
          <p>${esc(d.description || "")}</p>
          ${tags ? `<div class="tag-row"><span class="muted">inferred:</span>${tags}</div>` : ""}
          <ul class="ingredient-list">${rows}</ul>
          ${unreadable}
          <div class="modal-actions">
            <button class="btn draft-accept">Accept</button>
            <button class="ghost draft-edit">Edit</button>
            <button class="ghost danger draft-reject">Reject</button>
          </div></div></div>`;
      })
      .join("");
    grid.querySelectorAll(".draft-card").forEach((card) => {
      const d = list.find((x) => x.id === card.dataset.id);
      const accept = card.querySelector(".draft-accept");
      const sync = () => (accept.disabled = [...card.querySelectorAll("select.draft-map")].some((s) => !s.value));
      card.querySelectorAll("select.draft-map").forEach((s) => s.addEventListener("change", sync));
      sync();
      accept.addEventListener("click", () => acceptDraft(d, resolutionsOf(card)));
      card.querySelector(".draft-edit").addEventListener("click", () => openForm(MP.draftToMeal(d, resolutionsOf(card))));
      card.querySelector(".draft-reject").addEventListener("click", async () => {
        if (await MP.Sync.deleteDraft(d.id)) drafts = drafts.filter((x) => x.id !== d.id);
        else toast("Couldn't reject — try again.");
        renderDrafts();
      });
    });
  }

  function acceptDraft(d, resolutions) {
    const meal = MP.draftToMeal(d, resolutions);
    const { ok, reasons } = MP.Exclusions.check(meal, MP.Sync.hardTerms());
    if (!ok) return toast(`Can't accept — ${reasons.join(", ")}.`);
    const similar = MP.findSimilarName(library, meal.name, null);
    try {
      library = MP.upsertMeal(meal);
    } catch (e) {
      return toast("Couldn't save — browser storage is full.");
    }
    MP.Sync.deleteDraft(d.id).then((gone) => { if (gone) drafts = drafts.filter((x) => x.id !== d.id); });
    renderLibrary();
    renderDrafts();
    toast(`Added "${meal.name}"` + (similar ? ` (similar to "${similar.name}")` : ""));
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
    const method = MP.methodOf(meal);
    const overlay = document.getElementById("modal-overlay");
    const sheet = document.getElementById("modal-sheet");
    const ingredientsHtml = (meal.ingredients || [])
      .map((i) => `<li>${esc(i.label || labelize(i.key))}${i.qty ? " — " + esc(i.qty) : ""}${untracked(i.key) ? ` <span class="tag untracked">not tracked yet</span>` : ""}</li>`)
      .join("");
    sheet.innerHTML = `
      <button class="close-btn" aria-label="Close">✕</button>
      ${meal.image ? `<img src="${esc(meal.image)}" alt="${esc(meal.name)}">` : ""}
      <h2>${esc(meal.name)}</h2>
      ${tagRowHtml(meal)}
      <p>${esc(meal.description || "")}</p>
      <h3>Ingredients</h3>
      <ul class="ingredient-list">${ingredientsHtml}</ul>
      <h3>Instructions ${method.status === "drafted" ? `<span class="tag drafted-badge">Drafted</span>` : ""}</h3>
      ${MP.methodHtml(meal)}
      ${meal.variants && meal.variants.length && method.steps.length ? `<p class="muted">Steps are for the base recipe; variants have no steps of their own.</p>` : ""}
      <div class="modal-actions">
        ${method.status === "drafted" ? `<button id="detail-accept" class="btn">Accept steps</button>` : ""}
        <button id="detail-eat" class="btn">Eat</button>
        <button id="detail-edit" class="btn">Edit</button>
        <button id="detail-delete" class="ghost danger">Delete</button>
      </div>
    `;
    sheet.querySelector(".close-btn").addEventListener("click", closeDetail);
    sheet.querySelector(".modal-actions").before(MP.Ratings.rowEl(meal.id, renderLibrary, toast));
    sheet.querySelector("#detail-edit").addEventListener("click", () => openForm(meal));
    const accept = sheet.querySelector("#detail-accept");
    if (accept) accept.addEventListener("click", () => {
      const accepted = { ...meal, methodStatus: "accepted" };
      library = MP.upsertMeal(accepted);
      renderLibrary();
      openDetail(accepted);
    });
    sheet.querySelector("#detail-delete").addEventListener("click", () => deleteMeal(meal));
    sheet.querySelector("#detail-eat").addEventListener("click", () => openEatRow(meal, sheet));
    overlay.classList.remove("hidden");
  }

  /** Phase 92: log-only portion-eat from Browse; ticks today's matching plan slot, never touches the pantry. */
  function openEatRow(meal, sheet) {
    if (sheet.querySelector(".eat-row")) return;
    const pad = (x) => String(x).padStart(2, "0");
    const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const row = document.createElement("div");
    row.className = "rating-row eat-row";
    row.innerHTML = `<div class="rating-btns"><button class="ghost" data-d="-1" aria-label="Fewer portions">−</button><output class="eat-n" aria-live="polite">1</output><button class="ghost" data-d="1" aria-label="More portions">+</button><span class="muted">portion(s)</span></div>
      <label class="muted">When <input type="datetime-local" class="eat-when" max="${nowLocal()}" value="${nowLocal()}"></label>
      <div class="rating-btns"><button class="btn eat-log">Log</button><button class="ghost eat-cancel">Cancel</button></div>`;
    sheet.querySelector(".modal-actions").after(row);
    const out = row.querySelector(".eat-n");
    row.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => { out.textContent = Math.min(6, Math.max(1, +out.textContent + +b.dataset.d)); }));
    row.querySelector(".eat-cancel").addEventListener("click", () => row.remove());
    row.querySelector(".eat-log").addEventListener("click", () => {
      const n = Math.min(6, Math.max(1, Math.floor(+out.textContent) || 1));
      const picked = new Date(row.querySelector(".eat-when").value);
      const when = isNaN(picked) || picked > new Date() ? new Date() : picked;
      const whenIso = when.toISOString();
      MP.Sync.logPortion(meal, whenIso, n);
      if (MP.Prefs) MP.Prefs.bump(meal, "eaten");
      const london = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
      let ticked = null;
      try {
        const plan = JSON.parse(localStorage.getItem("mp_plan"));
        ticked = MP.tickPlanEaten(plan, meal.id, london(new Date()), whenIso);
        if (ticked && london(when) !== london(new Date())) ticked = null;
        if (ticked) {
          localStorage.setItem("mp_plan", JSON.stringify(ticked.plan));
          window.dispatchEvent(new CustomEvent("mp:plan-saved", { detail: ticked.plan }));
        }
      } catch (e) { /* no or malformed plan: log only */ }
      closeDetail();
      toast(`Logged ${n} × ${meal.name}${ticked ? " — plan ticked" : ""}`);
    });
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
    return MP.knownKeys(tagsData && tagsData.tags, packData && packData.items);
  }

  function variantIdFor(name, keepId) {
    const base = MP.slugify(name);
    let id = base;
    let n = 2;
    while (formVariants.some((v) => v.id === id && v.id !== keepId)) {
      id = `${base}-${n++}`;
    }
    return id;
  }

  function variantRowHtml(v) {
    const count = (v.ingredients || []).length;
    return `<div class="variant-row" data-id="${esc(v.id)}">
      <span>${esc(v.name)} <span class="muted">(${count} ingredient${count === 1 ? "" : "s"})</span></span>
      <span class="variant-row-actions">
        <button type="button" class="ghost variant-edit-btn" data-id="${esc(v.id)}">Edit</button>
        <button type="button" class="ghost variant-delete-btn" data-id="${esc(v.id)}">Delete</button>
      </span>
    </div>`;
  }

  let formSteps = [];

  /** Pull the step inputs back into formSteps (call before any re-render or save). */
  function readSteps() {
    if (!document.getElementById("form-steps")) return;
    formSteps = [...document.querySelectorAll("#form-steps .step-row")].map((r) => {
      const m = parseInt(r.querySelector(".step-min").value, 10);
      return { text: r.querySelector(".step-text").value.trim(), minutes: m >= 1 && m <= 600 ? m : null };
    });
  }

  function renderStepList() {
    const container = document.getElementById("form-steps");
    if (!container) return;
    container.innerHTML = formSteps.map((_, i) => `<div class="step-row">
      <span class="step-num">${i + 1}.</span>
      <input type="text" class="step-text" maxlength="300" aria-label="Step ${i + 1}">
      <input type="number" class="step-min" min="1" max="600" step="1" placeholder="min" aria-label="Minutes for step ${i + 1}">
      <span class="variant-row-actions">
        <button type="button" class="ghost step-up" data-i="${i}" aria-label="Move step ${i + 1} up"${i === 0 ? " disabled" : ""}>↑</button>
        <button type="button" class="ghost step-down" data-i="${i}" aria-label="Move step ${i + 1} down"${i === formSteps.length - 1 ? " disabled" : ""}>↓</button>
        <button type="button" class="ghost step-del" data-i="${i}" aria-label="Remove step ${i + 1}">✕</button>
      </span>
    </div>`).join("");
    container.querySelectorAll(".step-row").forEach((row, i) => {
      row.querySelector(".step-text").value = formSteps[i].text;
      row.querySelector(".step-min").value = formSteps[i].minutes || "";
    });
    const act = (sel, fn) => container.querySelectorAll(sel).forEach((b) => b.addEventListener("click", () => {
      readSteps();
      fn(Number(b.dataset.i));
      renderStepList();
    }));
    act(".step-up", (i) => formSteps.splice(i - 1, 0, formSteps.splice(i, 1)[0]));
    act(".step-down", (i) => formSteps.splice(i + 1, 0, formSteps.splice(i, 1)[0]));
    act(".step-del", (i) => formSteps.splice(i, 1));
  }

  function renderVariantList() {
    const container = document.getElementById("form-variants");
    if (!container) return;
    container.innerHTML = formVariants.length
      ? formVariants.map(variantRowHtml).join("")
      : `<p class="muted">No variants yet.</p>`;
    container.querySelectorAll(".variant-edit-btn").forEach((b) =>
      b.addEventListener("click", () => openVariantEditor(b.dataset.id)));
    container.querySelectorAll(".variant-delete-btn").forEach((b) =>
      b.addEventListener("click", () => {
        formVariants = formVariants.filter((v) => v.id !== b.dataset.id);
        renderVariantList();
      }));
  }

  function openVariantEditor(variantId) {
    const sheet = document.getElementById("modal-sheet");
    const v = variantId ? formVariants.find((x) => x.id === variantId) : null;
    editingVariantId = variantId || null;
    sheet.querySelector("#form-variant-name").value = v ? v.name : "";
    sheet.querySelector("#form-variant-ingredients").value = v ? MP.ingredientsToText(v.ingredients) : "";
    sheet.querySelector("#form-variant-instructions").value = v ? v.instructions || "" : "";
    sheet.querySelector("#form-variants-section").classList.add("hidden");
    sheet.querySelector("#form-variant-editor").classList.remove("hidden");
  }

  function closeVariantEditor() {
    const sheet = document.getElementById("modal-sheet");
    sheet.querySelector("#form-variant-editor").classList.add("hidden");
    sheet.querySelector("#form-variants-section").classList.remove("hidden");
    editingVariantId = null;
  }

  function collectVariant() {
    const sheet = document.getElementById("modal-sheet");
    return {
      name: sheet.querySelector("#form-variant-name").value.trim(),
      ingredients: MP.parseIngredients(sheet.querySelector("#form-variant-ingredients").value, knownKeys()),
      instructions: sheet.querySelector("#form-variant-instructions").value.trim(),
    };
  }

  function saveVariant() {
    const { name, ingredients, instructions } = collectVariant();
    const msg = document.getElementById("form-msg");
    if (!name || !ingredients.length) {
      msg.classList.add("error");
      msg.textContent = "A variant needs a name and at least one ingredient.";
      return;
    }
    msg.classList.remove("error");
    msg.textContent = "";
    const id = editingVariantId || variantIdFor(name, null);
    const variant = { id, name, ingredients };
    if (instructions) variant.instructions = instructions;
    const idx = formVariants.findIndex((v) => v.id === editingVariantId);
    if (idx === -1) formVariants.push(variant);
    else formVariants[idx] = variant;
    closeVariantEditor();
    renderVariantList();
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
      <div class="sync-field">Steps (optional; shown instead of the recipe text when filled in)
        <div id="form-steps"></div>
        <button type="button" id="form-step-add" class="ghost">Add step</button>
      </div>
      <label class="sync-field">Ingredients
        <textarea id="form-ingredients" rows="6" placeholder="500g chicken breast&#10;or: chicken breast — 500g"></textarea>
      </label>
      <div id="form-variants-section" class="sync-field">Variants
        <div id="form-variants"></div>
        <button type="button" id="form-variant-add" class="ghost">Add variant</button>
      </div>
      <div id="form-variant-editor" class="sync-field hidden">
        <label class="sync-field">Variant name
          <input type="text" id="form-variant-name">
        </label>
        <label class="sync-field">Ingredients
          <textarea id="form-variant-ingredients" rows="6" placeholder="500g chicken breast&#10;or: chicken breast — 500g"></textarea>
        </label>
        <label class="sync-field">Recipe
          <textarea id="form-variant-instructions" rows="4"></textarea>
        </label>
        <div class="modal-actions">
          <button type="button" id="form-variant-save" class="btn">Save variant</button>
          <button type="button" id="form-variant-cancel" class="ghost">Cancel</button>
        </div>
      </div>
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
    formSteps = MP.methodOf(meal).steps.map((x) => ({ ...x }));
    renderStepList();
    sheet.querySelector("#form-step-add").addEventListener("click", () => {
      readSteps();
      if (formSteps.length < 30) formSteps.push({ text: "", minutes: null });
      renderStepList();
      const rows = sheet.querySelectorAll(".step-text");
      rows[rows.length - 1].focus();
    });
    formVariants = meal && Array.isArray(meal.variants) ? meal.variants.map((v) => ({ ...v })) : [];
    renderVariantList();
    sheet.querySelector("#form-variant-add").addEventListener("click", () => openVariantEditor(null));
    sheet.querySelector("#form-variant-save").addEventListener("click", saveVariant);
    sheet.querySelector("#form-variant-cancel").addEventListener("click", closeVariantEditor);
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
    readSteps();
    const steps = formSteps.filter((x) => x.text).map((x) => (x.minutes ? { text: x.text, minutes: x.minutes } : { text: x.text }));
    if (!steps.length) {
      delete record.method;
      delete record.methodStatus;
    } else if (JSON.stringify(steps) !== JSON.stringify((original && original.method) || null)) {
      // a hand edit (or a new method) is the user's own: accepted. Untouched steps keep their status.
      record.method = steps;
      record.methodStatus = "accepted";
    }
    if (formVariants.length) record.variants = formVariants.slice();
    else delete record.variants;
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
    const { ok, reasons } = MP.Exclusions.check(candidate, MP.Sync.hardTerms());
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
    if (candidate.fromDraft) { // a draft opened in Edit: Save accepts it
      MP.Sync.deleteDraft(candidate.fromDraft).then((gone) => { if (gone) drafts = drafts.filter((x) => x.id !== candidate.fromDraft); renderDrafts(); });
      renderDrafts();
    }
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
    if (cfg.enabled) status.textContent = "Set up on this device"; // saved settings; the text below only changes on Save

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


  // Phase 48: Assistant activity. All text goes through esc()/textContent: summary/why are external.
  function initActivity() {
    const box = document.getElementById("activity");
    const status = document.getElementById("activity-status");
    const list = document.getElementById("activity-list");
    box.classList.toggle("hidden", !MP.Sync.config().enabled);

    async function load() {
      status.textContent = "Loading…";
      list.innerHTML = "";
      let entries;
      try { entries = await MP.Sync.fetchActivity(); } catch (e) { status.textContent = "Couldn't load activity"; return; }
      status.textContent = entries.length ? "" : "Nothing yet";
      const undone = new Set(entries.map((e) => e.undoes).filter(Boolean));
      list.innerHTML = entries.map((e) => `
        <li class="variant-row" data-id="${esc(e.id)}" data-key="${esc(e.key)}">
          <span>
            <strong>${esc(e.summary)}</strong>${e.undoes ? ` <span class="tag">Undo</span>` : ""}<br>
            <span class="muted">${esc(new Date(e.at).toLocaleString())} · ${esc(e.who)}${e.why ? " · " + esc(e.why) : ""}</span>
          </span>
          ${undone.has(e.id) ? `<span class="muted">Undone</span>` : `<button class="ghost activity-undo">Undo</button>`}
        </li>`).join("");
    }

    async function undo(entry, force) {
      const id = entry.dataset.id;
      const r = await MP.Sync.undoActivity(id, force).catch(() => ({ ok: false, error: "network error", changed: [] }));
      if (r.ok) {
        const key = entry.dataset.key;
        toast("Undone");
        await MP.Sync.resyncKey(key);
        if (key === "library") { library = await MP.getLibrary(); renderLibrary(); }
        return load();
      }
      if (r.status === 409 && r.error === "changed since") return confirmForce(entry, r.changed);
      toast(r.error === "already undone" ? "Already undone" : `Couldn't undo: ${r.error}`);
      load();
    }

    function confirmForce(entry, changed) {
      const overlay = document.getElementById("modal-overlay");
      const sheet = document.getElementById("modal-sheet");
      sheet.innerHTML = `
        <button class="close-btn" aria-label="Close">✕</button>
        <h2>Changed since</h2>
        <p>These were edited after the assistant's change: ${esc(changed.map((c) => c.id).join(", "))}. Undo anyway?</p>
        <div class="modal-actions">
          <button id="activity-force" class="btn">Undo anyway</button>
          <button id="activity-cancel" class="ghost">Cancel</button>
        </div>`;
      sheet.querySelector(".close-btn").addEventListener("click", closeDetail);
      sheet.querySelector("#activity-cancel").addEventListener("click", closeDetail);
      sheet.querySelector("#activity-force").addEventListener("click", () => { closeDetail(); undo(entry, true); });
      overlay.classList.remove("hidden");
    }

    box.addEventListener("toggle", () => { if (box.open) load(); });
    list.addEventListener("click", (e) => {
      const btn = e.target.closest(".activity-undo");
      if (btn) { btn.disabled = true; undo(btn.closest("li"), false); }
    });
    document.getElementById("sync-save").addEventListener("click", () => box.classList.toggle("hidden", !MP.Sync.config().enabled));
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
    initActivity();
    MP.Sync.start();
    MP.Sync.fetchRatings().then(renderLibrary);
    MP.Sync.fetchSettings().then(renderProfileLine);
    MP.Sync.fetchDrafts().then((r) => { drafts = r.drafts; renderDrafts(); });
  }

  function renderProfileLine() {
    const s = MP.Sync.settings();
    const el = document.getElementById("profile-line");
    if (!s) { el.textContent = "Profile: not set"; return; }
    const rules = ["allergies", "dislikes", "likes", "never"].reduce((n, k) => n + (s[k] || []).length, 0);
    el.textContent = `Profile: ${Object.keys(s.targets || {}).length + (s.budgetTarget > 0 ? 1 : 0)} targets, ${rules} food rules, updated ${new Date(s.updatedAt).toLocaleDateString()}`;
  }

  init();
})();
