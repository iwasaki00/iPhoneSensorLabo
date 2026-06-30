const CACHE_NAME = "map-tracker-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/main.js",
  "./js/map.js",
  "./js/gps.js",
  "./js/ui.js",
  "./js/util.js",
  "./assets/icons/icon.svg"
];

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="ja">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>オフライン</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101312;color:#f4f7f6;font-family:system-ui,sans-serif;padding:24px;text-align:center}
div{max-width:360px}
h1{font-size:1.3rem}
p{color:#aeb9b6;line-height:1.7}
</style>
<div><h1>ネットワークに接続してください</h1><p>map-tracker を開くには通信が必要です。</p></div>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html").then((cached) => cached || new Response(OFFLINE_HTML, {
          headers: { "Content-Type": "text/html; charset=UTF-8" }
        })))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
