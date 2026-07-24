const CACHE = "radar-v13";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./install-pwa.js",
  "./css/style.css",
  "./js/app.js",
  "./js/moteur.js",
  "./js/csv.js",
  "./js/licence.js",
  "./js/vendeur.js",
  "./js/trial.js",
  "./js/modules.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// RESEAU D'ABORD (avec repli cache hors-ligne) : garantit que le code a jour
// s'affiche des qu'il y a du reseau. L'ancien defaut "cache d'abord" resservait
// une version perimee apres chaque deploiement. Les appels API (Google, Groq,
// Worker) ne sont jamais mis en cache (autre origine, ignores plus bas).
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // API externes : toujours le reseau direct
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
      )
  );
});
