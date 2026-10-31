// Offline support: network first, falling back to the last good copy (SEC-2). Only the game's own files are cached,
// and only successful, complete responses, so an error page or another site's response is never served offline.
const CACHE = 'shardfall-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((r) => {
        if (r.ok && r.status === 200 && r.type === 'basic') {
          const copy = r.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
        }
        return r;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error())),
  );
});
