/*
 * LearnHarness service worker (self-host PWA, 2026-10-28).
 *
 * Deliberately small: the app is a thin client of YOUR server, so nothing
 * that carries learning data is ever cached here.
 *   - /api/*            → never intercepted (live data, SSE turn streams).
 *   - /_next/static/*   → cache-first (content-hashed, immutable).
 *   - page navigations  → network; if the server is unreachable, show
 *                         /offline.html instead of the browser's error.
 * Bump VERSION to drop old caches on the next activation.
 */
const VERSION = "lh-pwa-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(VERSION).then((cache) => cache.addAll([OFFLINE_URL, "/pwa/icon-192.png"])).then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

	if (url.pathname.startsWith("/_next/static/")) {
		event.respondWith(
			caches.open(VERSION).then(async (cache) => {
				const hit = await cache.match(request);
				if (hit) return hit;
				const res = await fetch(request);
				if (res.ok) cache.put(request, res.clone());
				return res;
			}),
		);
		return;
	}

	if (request.mode === "navigate") {
		event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
	}
});
