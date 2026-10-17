/*! Open Historia — minimal service worker (PWA installability only, no caching) */
// This project's data (scenarios, games, world state) is fetched live from
// the server on every read — a caching service worker would risk serving
// stale game state. This one exists only to satisfy install criteria; it
// passes every request straight through to the network.
self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

// Deliberately does NOT call respondWith. This worker caches nothing, so taking
// over a request could only ever re-issue it — and re-issuing a cross-origin one
// through fetch() loses the mode/credentials the browser chose for it. Map tiles
// are exactly that case: terrain from s3.amazonaws.com and basemaps from
// arcgisonline came back as "A ServiceWorker intercepted the request and
// encountered an unexpected error", and the tiles simply failed to load.
// Leaving the handler in place (but passive) keeps the install criteria that
// wanted a fetch listener, while the browser handles every request itself.
self.addEventListener("fetch", (event) => {
    // The one thing this worker answers: a browser's saves arriving from the
    // site's http address (public/save-move/, src/runtime/web/saveMove.js). The
    // posted file is kept in a cache of its own for the game to unpack, and the
    // browser is sent on to the game. Everything else stays untouched, as above.
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    if (event.request.method === "GET" && url.pathname.endsWith("/save-move/ping")) {
        event.respondWith(new Response("oh-save-move-1", { headers: { "Cache-Control": "no-store" } }));
        return;
    }
    if (event.request.method !== "POST" || !url.pathname.endsWith("/save-move/receive")) return;
    event.respondWith((async () => {
        const game = new URL("../", url);
        try {
            const file = (await event.request.formData()).get("saves");
            if (!file || typeof file === "string") throw new Error("no file");
            const cache = await caches.open("oh-save-move");
            await cache.put(new URL("payload", url).pathname, new Response(file, { headers: { "Content-Type": "application/octet-stream" } }));
            game.searchParams.set("saves-moved", "arrived");
        } catch (error) {
            game.searchParams.set("saves-moved", "failed");
        }
        return Response.redirect(game.href, 303);
    })());
});
