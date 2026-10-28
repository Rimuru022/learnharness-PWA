import type { MetadataRoute } from "next";

/** Installable web app (self-host PWA, 2026-10-28): lets a phone add the
 *  self-hosted server to its home screen and open it full-screen. Colors
 *  match the app's only theme background (globals.css --background). */
export default function manifest(): MetadataRoute.Manifest {
	return {
		id: "/",
		name: "LearnHarness",
		short_name: "LearnHarness",
		description: "An agent harness for learning: adaptive teaching, practice, and a persistent knowledge graph.",
		start_url: "/",
		scope: "/",
		display: "standalone",
		orientation: "any",
		background_color: "#141414",
		theme_color: "#141414",
		icons: [
			{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
			{ src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
			{ src: "/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
		],
	};
}
