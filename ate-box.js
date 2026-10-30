/* Phase 102: "I ate..." bar docked on every page. A portion-eat / food-log writer only: never the pantry directly. */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const MP = (root.MP = root.MP || {});

  /** Pure. Recent off-plan eats: [{ name, grams?, count? }], newest first, distinct by name, max 10. */
  function recents(entries) {
    const seen = new Set(), out = [];
    const list = (entries || []).filter((e) => e && e.kind === "eat" && !e.group && typeof e.name === "string" && e.name.trim());
    list.slice().sort((a, b) => String(b.when || "").localeCompare(String(a.when || ""))).forEach((e) => {
      const k = e.name.trim().toLowerCase();
      if (seen.has(k) || out.length >= 10) return;
      seen.add(k);
      out.push({ name: e.name.trim(), ...(e.count ? { count: e.count } : e.grams ? { grams: e.grams } : {}) });
    });
    return out;
  }

  /** Pure. Up to 8 de-duplicated picks: library meals, recents, foods; prefix matches before substring within each source. */
  function suggest(text, { library = [], recents: rec = [], foods = [] } = {}) {
    const q = String(text || "").trim().toLowerCase();
    if (!q) return [];
    const rank = (label) => { const i = label.toLowerCase().indexOf(q); return i === 0 ? 0 : i > 0 ? 1 : -1; };
    const pick = (items, mk) => items.map((x) => ({ x, r: rank(mk(x).label) })).filter((o) => o.r >= 0).sort((a, b) => a.r - b.r).map((o) => mk(o.x));
    const all = [
      ...pick(library, (m) => ({ kind: "meal", label: m.name, meal: m })),
      ...pick(rec, (r) => ({ kind: "recent", label: r.name, name: r.name })),
      ...pick(foods, (f) => ({ kind: "food", label: f, name: f })),
    ];
    const seen = new Set();
    return all.filter((s) => { const k = s.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
  }

  async function foodNames() {
    try {
      const [tags, pack] = await Promise.all([
        fetch("ingredient-nutrient-tags.json").then((r) => r.json()).catch(() => ({})),
        fetch("pack-sizes.json").then((r) => r.json()).catch(() => ({})),
      ]);
      return MP.knownKeys(tags.tags, pack.items).map((k) => MP.labelize(k));
    } catch (e) { return []; }
  }

  function init() {
    if (document.querySelector(".ate-bar") || !MP.Sync || !MP.eatMeal) return;
    const bar = document.createElement("div");
    bar.className = "ate-bar";
    bar.innerHTML = `<div class="ate-thread" hidden aria-live="polite"></div><div class="ate-recents" hidden></div><ul class="ate-list" hidden></ul>
      <p class="ate-note muted" hidden>Turn on Hermes sync to log free text</p>
      <div class="ate-msg" role="status" hidden></div>
      <div class="ate-row"><div class="ate-modes" role="group" aria-label="Bar mode"><button type="button" class="ate-mode active" data-mode="log" aria-pressed="true">Log</button><button type="button" class="ate-mode" data-mode="ask" aria-pressed="false" hidden>Ask</button></div>
      <input type="text" class="ate-input" enterkeyhint="done" autocomplete="off" maxlength="120" placeholder="I ate… (e.g. 2 slices of toast)" aria-label="Log what you ate"></div>`;
    document.body.appendChild(bar);
    document.body.classList.add("has-ate-bar");
    const input = bar.querySelector(".ate-input"), list = bar.querySelector(".ate-list"), chips = bar.querySelector(".ate-recents"), msg = bar.querySelector(".ate-msg"), note = bar.querySelector(".ate-note");
    let foods = [], msgTimer = 0;
    foodNames().then((f) => { foods = f; });
    const syncOn = () => !!(localStorage.getItem("mp_hermes_url") && localStorage.getItem("mp_hermes_token"));
    let lib = [];
    const loadLib = () => Promise.resolve(MP.getLibrary()).then((l) => { lib = Array.isArray(l) ? l : []; }, () => {});
    loadLib();
    window.addEventListener("mp:library-saved", loadLib);
    const library = () => lib;

    function say(text, actionLabel, onAction) {
      clearTimeout(msgTimer);
      msg.textContent = text;
      if (actionLabel) {
        const b = document.createElement("button");
        b.textContent = actionLabel;
        b.addEventListener("click", () => { msg.hidden = true; onAction(); });
        msg.appendChild(b);
      }
      msg.hidden = false;
      msgTimer = setTimeout(() => { msg.hidden = true; }, 6000);
    }
    const guard = (btn) => { btn.disabled = true; setTimeout(() => { btn.disabled = false; }, 1000); };

    async function post(entry, doneLabel) {
      const r = await MP.Sync.postFoodLog(entry);
      if (r !== "ok") { say("Couldn't log, try again"); return false; }
      const hit = MP.Sync.localFoodLog().find((e) => e.id === entry.id);
      if (!hit) {
        // Worker answered needs-grams: nothing was stored
        say("Add an amount, e.g. 150g chicken");
        return false;
      }
      say(`Logged ${doneLabel}`, "Undo", () => MP.Sync.removeFoodEntry(entry.id).then(render));
      return true;
    }
    const newEntry = (extra) => ({ id: crypto.randomUUID(), action: "eat", when: new Date().toISOString(), ...extra });

    async function logText(text) {
      text = text.trim().slice(0, 120);
      if (!text) return;
      if (!syncOn()) return say("Turn on Hermes sync to log free text");
      if (await post(newEntry({ text }), text)) { input.value = ""; render(); }
    }

    function logMeal(meal) {
      const { ticked } = MP.eatMeal(meal, new Date().toISOString(), 1);
      if (MP.Prefs) MP.Prefs.bump(meal, "eaten");
      input.value = "";
      say(`Logged ${meal.name}${ticked ? " — plan ticked" : ""}`);
      render();
    }

    // ---- Phase 109: Ask mode (Hermes). Log mode above is untouched. ----
    const thread = bar.querySelector(".ate-thread"), askBtn = bar.querySelector('[data-mode="ask"]');
    let mode = "log", logMsgs = [];
    try { logMsgs = JSON.parse(sessionStorage.getItem("mp_barLog") || "[]").slice(-20); } catch (e) { /* cosmetic */ }
    const saveLog = () => { try { sessionStorage.setItem("mp_barLog", JSON.stringify(logMsgs.slice(-20))); } catch (e) { /* cosmetic */ } };
    const bubble = (cls, text) => { const d = document.createElement("div"); d.className = "ate-bubble " + cls; d.textContent = text; thread.appendChild(d); thread.scrollTop = thread.scrollHeight; return d; };
    function renderThread() {
      thread.textContent = "";
      logMsgs.forEach((m) => bubble(m.role, m.text));
      thread.hidden = mode !== "ask" || !logMsgs.length;
    }
    function remember(role, text) { logMsgs.push({ role, text }); logMsgs = logMsgs.slice(-20); saveLog(); }
    function setMode(m) {
      if (m === "ask" && !MP.BarChat) return;
      mode = m;
      bar.classList.toggle("ask", m === "ask");
      bar.querySelectorAll(".ate-mode").forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
      input.maxLength = m === "ask" ? 1000 : 120;
      input.placeholder = m === "ask" ? "Ask Hermes… (e.g. swap Tuesday dinner)" : "I ate… (e.g. 2 slices of toast)";
      input.setAttribute("aria-label", m === "ask" ? "Ask Hermes" : "Log what you ate");
      input.value = "";
      try { sessionStorage.setItem("mp_barMode", m); } catch (e) { /* cosmetic */ }
      renderThread();
      render();
    }
    function mealRows(meals) {
      const wrap = document.createElement("div");
      wrap.className = "ate-bubble hermes ate-meals";
      meals.forEach((m) => {
        const row = document.createElement("div");
        row.className = "ate-meal";
        const open = document.createElement("a");
        open.href = "index.html?q=" + encodeURIComponent(m.name); open.textContent = m.name;
        const eat = document.createElement("button");
        eat.type = "button"; eat.textContent = "Eat";
        eat.addEventListener("click", () => { guard(eat); logMeal(m); });
        row.append(open, eat);
        wrap.appendChild(row);
      });
      thread.appendChild(wrap);
      thread.scrollTop = thread.scrollHeight;
    }
    function showReply(r) {
      if (r.text) { bubble("hermes", r.text); remember("hermes", r.text); }
      if (r.applied.length) {
        const t = "Hermes did: " + r.applied.map((a) => a.summary).join("; ");
        bubble("did", t); remember("did", t);
        say(`Hermes changed ${r.applied.length} thing${r.applied.length === 1 ? "" : "s"}`, "Undo", () => { r.undo(); bubble("muted", "Undone"); remember("muted", "Undone"); });
      }
      if (r.refused.length) { const t = "Couldn't: " + r.refused.join("; "); bubble("muted", t); remember("muted", t); }
      if (r.meals.length) mealRows(r.meals);
      if (r.other) {
        const d = bubble("muted", "That needs the full planner. ");
        const a = document.createElement("a");
        a.href = "plan-with-me.html"; a.textContent = "Open Plan with me";
        d.appendChild(a);
      }
      thread.hidden = false;
    }
    let asking = false;
    async function track(promise) {
      asking = true; input.disabled = true;
      const typing = bubble("hermes typing", "Hermes is thinking");
      thread.hidden = false;
      try { showReply(await promise); } catch (e) { const t = e.message || "Couldn't reach Hermes"; bubble("muted", t); remember("muted", t); }
      typing.remove();
      asking = false; input.disabled = false;
      if (document.activeElement !== input && mode === "ask") input.focus();
    }
    async function ask(text) {
      text = text.trim();
      if (asking) return;
      if (!text) return say("Type a question first");
      if (text.length > 1000) return say("Keep it under 1000 characters");
      bubble("user", text); remember("user", text);
      input.value = "";
      await track(MP.BarChat.send(text));
    }
    askBtn.addEventListener("pointerdown", (e) => e.preventDefault());
    bar.querySelectorAll(".ate-mode").forEach((b) => { b.addEventListener("pointerdown", (e) => e.preventDefault()); b.addEventListener("click", () => setMode(b.dataset.mode)); });
    function syncAsk() { askBtn.hidden = !(MP.BarChat && syncOn()); if (askBtn.hidden && mode === "ask") setMode("log"); }

    function render() {
      syncAsk();
      if (mode === "ask") { note.hidden = true; chips.hidden = true; list.hidden = true; return; }
      const ok = syncOn();
      note.hidden = ok;
      const rec = ok ? recents(MP.Sync.localFoodLog()) : [];
      chips.textContent = "";
      rec.forEach((r) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "chip"; b.textContent = r.name;
        b.addEventListener("pointerdown", (e) => e.preventDefault());
        b.addEventListener("click", async () => {
          if (!r.count && !r.grams) { input.value = r.name; input.focus(); return render(); }
          guard(b);
          if (await post(newEntry({ name: r.name, ...(r.count ? { count: r.count } : { grams: r.grams }) }), r.name)) { b.textContent = r.name + " ✓"; setTimeout(render, 1500); }
        });
        chips.appendChild(b);
      });
      chips.hidden = !rec.length || !bar.classList.contains("open");
      const text = input.value;
      const picks = suggest(text, { library: library(), recents: rec, foods }).filter((s) => ok || s.kind === "meal");
      list.textContent = "";
      picks.forEach((s) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button"; b.className = "ate-pick"; b.textContent = s.label;
        b.addEventListener("pointerdown", (e) => e.preventDefault());
        b.addEventListener("click", () => { guard(b); s.kind === "meal" ? logMeal(s.meal) : logText(s.label); });
        li.appendChild(b);
        list.appendChild(li);
      });
      list.hidden = !picks.length || !bar.classList.contains("open");
    }

    const open = (on) => { bar.classList.toggle("open", on); render(); };
    input.addEventListener("focus", () => open(true));
    input.addEventListener("blur", () => open(false));
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") mode === "ask" ? ask(input.value) : logText(input.value);
      if (e.key === "Escape") input.blur();
    });
    // keep the bar above a phone keyboard
    if (root.visualViewport) {
      // only while a keyboard covers the page: at 0 the CSS offset (above the phone tab bar) must win
      const lift = () => { const px = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop); bar.style.bottom = px > 1 ? px + "px" : ""; };
      visualViewport.addEventListener("resize", lift);
      visualViewport.addEventListener("scroll", lift);
    }
    render();
    let saved = "log";
    try { saved = sessionStorage.getItem("mp_barMode") || "log"; } catch (e) { /* cosmetic */ }
    if (saved === "ask") setMode("ask");
    const pending = MP.BarChat && syncOn() && MP.BarChat.resume();
    if (pending) { if (mode !== "ask") setMode("ask"); track(pending); }
  }

  MP.AteBox = { init, suggest, recents, foodNames };
  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", init);
})();
