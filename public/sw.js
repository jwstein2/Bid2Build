/*
 * Built2Bid service worker (V10.1 desktop app). Deliberately tiny.
 *
 * It does exactly one thing: when a page navigation fails because there is no internet, it shows the branded
 * "You're offline" page instead of the browser's error screen. It caches NOTHING else. Every page, API call,
 * sign-in, file and report always comes from the live site, so the installed app is always the current production
 * release and no customer, financial or billing data is ever stored by this worker.
 *
 * Rollback: replace this file with one that calls self.registration.unregister(); browsers re-check it on every
 * launch (it is served with no-cache and registered with updateViaCache: "none").
 */
const OFFLINE_CACHE = "b2b-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Drop any cache this worker does not own (older offline versions).
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== OFFLINE_CACHE).map((n) => caches.delete(n)));
    // Navigation preload: the network request starts while the worker wakes, so pages are not slowed down.
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only top-level page loads (GET). Everything else (API calls, posts, sign-out, uploads, scripts, images)
  // goes straight to the network without this worker touching it.
  if (req.mode !== "navigate" || req.method !== "GET") return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
      return await fetch(req);
    } catch {
      const cache = await caches.open(OFFLINE_CACHE);
      const offline = await cache.match(OFFLINE_URL);
      return offline || new Response("You're offline. Connect to the internet to continue using Built2Bid.", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  })());
});
