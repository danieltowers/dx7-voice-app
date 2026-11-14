// The service worker: keeps the shell, every file of app/, in a cache named
// for the shell's version, so the installed app opens, browses and sends with
// the network off. It answers only requests to the shell's own origin for
// the shell's files; a request to any other origin is left alone.
//
// SHELL_VERSION is stamped by scripts/publish_shell.py with a digest of the
// other shell files, so every publish of a changed shell is a new worker and
// a new cache. The browser checks sw.js on each open with the network on; the
// new worker fetches the whole shell afresh, takes over, and deletes the old
// shell caches, and the page reloads into it (shell.js). Nothing else the
// origin keeps (the library in IndexedDB, the settings in localStorage) is
// touched.
//
// Published, the shell is served from the cache first. Unpublished (served
// straight from app/ while developing), it is fetched from the network first,
// so an edit shows on reload, with the cache as the fallback offline.

const SHELL_VERSION = "7564fd5d7dc7";
const PREFIX = "dx7-shell-";
const CACHE = `${PREFIX}${SHELL_VERSION}`;
const NETWORK_FIRST = SHELL_VERSION === "unpublished";

// Every file of app/ but this one (tests/test_publish_shell.py checks it).
const SHELL = [
  "./",
  "controls.js",
  "current-list.js",
  "drawer.js",
  "edit.js",
  "fixed-messages.js",
  "hardware.html",
  "hardware.js",
  "icon-192.png",
  "icon-512.png",
  "icon.svg",
  "index.html",
  "library.js",
  "main.js",
  "manifest.json",
  "parameter-change.js",
  "send.js",
  "settings.js",
  "setup-notes.js",
  "shell.js",
  "style.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // "reload": past the HTTP cache, so a new version never keeps an old file.
    await cache.addAll(SHELL.map((path) => new Request(path, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.headers.has("X-Access-Code")) return;
  event.respondWith(NETWORK_FIRST ? networkFirst(request) : cacheFirst(request));
});

async function cached(request) {
  const cache = await caches.open(CACHE);
  return (await cache.match(request, { ignoreSearch: true }))
    ?? (request.mode === "navigate" ? await cache.match("index.html") : undefined);
}

async function cacheFirst(request) {
  return (await cached(request)) ?? fetch(request);
}

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const hit = await cached(request);
    if (hit) return hit;
    throw e;
  }
}
