const CACHE = "vocalat-web-shell-v7";
const RUNTIME_CACHE = "vocalat-web-runtime-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./learning-engine.js",
  "./document-analysis.js",
  "./morphology.js",
  "./ocr.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./data/vocabulary.json",
  "./data/grammar.json",
  "./data/fallback-lexicon.json",
  "./data/translation-memory.json",
  "./vendor/tesseract/tesseract.min.js",
  "./vendor/whitakers/whitakers-words.js"
];

self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("vocalat-web-") && ![CACHE, RUNTIME_CACHE].includes(key)).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(RUNTIME_CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  })));
});
