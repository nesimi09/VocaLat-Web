const CACHE = "vocalat-web-shell-v26";
const RUNTIME_CACHE = "vocalat-web-runtime-v26";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./course-engine.js",
  "./course-access.js",
  "./grammar-practice.js",
  "./grammar-order.js",
  "./payment.js",
  "./learning-engine.js",
  "./latin-syntax-translator.js",
  "./latin-analysis.js",
  "./latin-language-data.js",
  "./german-generator.js",
  "./document-analysis.js",
  "./morphology.js",
  "./ocr.js",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./data/vocabulary.json",
  "./data/grammar.json",
  "./data/course.json",
  "./data/fallback-lexicon.json",
  "./vendor/tesseract/tesseract.min.js",
  "./vendor/whitakers/whitakers-words.js"
];

self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: "reload" })))).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(async keys => {
  const hasOlderShell = keys.some(key => key.startsWith("vocalat-web-shell-") && key !== CACHE);
  await Promise.all(keys.filter(key => key.startsWith("vocalat-web-") && ![CACHE, RUNTIME_CACHE].includes(key)).map(key => caches.delete(key)));
  await self.clients.claim();
  if (!hasOlderShell) return;
  const windows = await self.clients.matchAll({ type: "window" });
  await Promise.all(windows.map(client => client.navigate(client.url).catch(() => null)));
})));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.endsWith("/data/course-access.json")) {
    event.respondWith(fetch(new Request(event.request, { cache: "no-store" })).catch(() => new Response("", { status: 503, statusText: "Access manifest unavailable" })));
    return;
  }
  if (requestUrl.pathname.endsWith("/data/payment.json")) {
    event.respondWith(fetch(new Request(event.request, { cache: "no-store" })).catch(() => new Response("", { status: 503, statusText: "Payment config unavailable" })));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(RUNTIME_CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  })));
});
