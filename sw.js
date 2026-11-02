// Offline cache so the clock keeps working without a network.
const CACHE = "dymaxion-clock-v3";
const FILES = [
  "./", "index.html", "styles.css", "app.js", "sun.js", "fastfaces.js", "fold.js", "globe.js", "sky.js", "skyview.js",
  "icon.svg", "manifest.webmanifest",
  "data/land-50m.json", "data/shipping.json", "data/flights.json", "data/rail.json", "data/sky.json",
  "vendor/d3.min.js", "vendor/d3-geo-projection.min.js", "vendor/d3-geo-polygon.min.js",
  "vendor/topojson-client.min.js", "vendor/three.module.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, so updates show up; fall back to the cache when offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
