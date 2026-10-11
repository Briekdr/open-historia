// Open Historia: the /save-move/ page is the one path served over plain http.
// A browser keeps http://openhistoria.com and https://openhistoria.com as two sites; saves stored
// under the http one can only be read by a page loaded from it (public/save-move/ in the game repo).
// Routes: http://openhistoria.com/* (every plain-http request) and openhistoria.com/save-move*.
// http, /save-move  -> the page, fetched from the site's own Pages deployment.
// http, anything else -> the same address over https (what the zone's "Always Use HTTPS" did).
// https, /save-move -> with SEND_HTTPS_BACK on: the same address over http (which also keeps a
//          browser that upgrades http by itself on http). Off while the zone still redirects
//          every http request itself, or the two redirects chase each other.
const PAGES = "https://open-historia.pages.dev";
const SEND_HTTPS_BACK = true;
const isSaveMove = (path) => path === "/save-move" || path.startsWith("/save-move/");
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.protocol === "https:") {
      if (!SEND_HTTPS_BACK || !isSaveMove(url.pathname)) return fetch(request);
      url.protocol = "http:";
      return new Response(null, { status: 302, headers: { Location: url.href, "Cache-Control": "no-store" } });
    }
    if (!isSaveMove(url.pathname)) {
      url.protocol = "https:";
      return new Response(null, { status: 301, headers: { Location: url.href } });
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const upstream = await fetch(PAGES + url.pathname + url.search, { method: request.method, redirect: "follow" });
    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
