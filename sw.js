// Minimal service worker: satisfies Chrome's PWA installability requirement
// (registered SW with a fetch handler) and caches the static shell so the
// app opens offline. No build step, so the cache list is just the files.
const CACHE = "meal-planner-v11";
const SHELL = [
  "./",
  "index.html",
  "discover.html",
  "plan.html",
  "shopping.html",
  "style.css",
  "data.js",
  "nutrition.js",
  "shelf-life.js",
  "swipe.js",
  "exclusions.js",
  "mealdb.js",
  "app.js",
  "discover.js",
  "generator.js",
  "plan.js",
  "shopping-list.js",
  "shopping.js",
  "hermes-sync.js",
  "meals.json",
  "ingredient-nutrient-tags.json",
  "shelf-life.json",
  "nutrition-targets.json",
  "pack-sizes.json",
  "substitutions.json",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return; // let TheMealDB requests pass straight through
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
