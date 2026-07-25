/* Bug Tracker service worker.
 *
 * SECURITY: this deliberately caches ONLY the static app shell — never HTML
 * pages and never API responses. Those carry issue titles, comments and member
 * details, and a shared or stolen device must not be able to read them out of
 * the cache after sign-out.
 *
 * The offline story is therefore: static assets are instant, and a request that
 * needs the network while offline gets a clear offline page instead of stale
 * private data.
 */

const VERSION = "v1";
const SHELL_CACHE = `bt-shell-${VERSION}`;
const OFFLINE_URL = "/offline";

const SHELL = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Immutable build output is safe to cache; it is content-hashed and public. */
function isStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"))
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never touch anything that could carry another user's data.
  if (url.pathname.startsWith("/api/")) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Navigations go to the network; if that fails, show the offline page rather
  // than a cached copy of somebody's issue list.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});

/** Sign-out asks us to drop everything we hold. */
self.addEventListener("message", (event) => {
  if (event.data === "clear-caches") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});
