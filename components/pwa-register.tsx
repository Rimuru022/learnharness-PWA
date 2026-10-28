"use client";

import { useEffect } from "react";

/** Registers the service worker (public/sw.js) for the installable web app.
 *  Production browser builds only: the Electron shell has no use for it, and
 *  in `next dev` a worker would fight hot reload. Browsers also require a
 *  secure context (HTTPS or localhost) — `tailscale serve` provides HTTPS. */
export function PwaRegister() {
	useEffect(() => {
		if (process.env.NODE_ENV !== "production") return;
		if (navigator.userAgent.includes("Electron")) return;
		if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
		navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("service worker registration failed:", err));
	}, []);
	return null;
}
