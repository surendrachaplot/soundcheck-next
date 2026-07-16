// Soundcheck service worker. Scope: /soundcheck/ (served from there).
// Strategy:
//  - app shell (index.html) → network-first, fall back to cache (offline).
//  - same-origin static assets (fonts, icons, manifest, design system) →
//    cache-first (they're effectively immutable).
//  - everything cross-origin (api.6minutes.club, the image proxy, CARTO tiles,
//    YouTube/SoundCloud SDKs, unpkg) → passthrough; we never cache live data.
// Bump VERSION to invalidate the shell cache on a meaningful release.
const VERSION = "sc-1784230300690";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icons/icon-192.png",
  "./fonts/bricolage.woff2",
];

self.addEventListener("install", (e) => {
  // Cache shell files individually (not addAll) so one missing/renamed asset
  // can't fail the whole install.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API / CDN / tiles pass straight through

  // Navigations: network-first (so updates land), cached shell when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(VERSION).then((c) => c.put("./index.html", cp)); return r; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Static assets: cache-first, fill the cache on first hit.
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((r) => {
        if (r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); }
        return r;
      }).catch(() => hit)
    )
  );
});

// ── Web Push: "an artist you follow announced a night in your city" ──
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title || "soundcheck", {
    body: d.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
    return clients.openWindow(url);
  }));
});
