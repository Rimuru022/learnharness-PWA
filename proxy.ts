import { NextResponse, type NextRequest } from "next/server";
import { desktopAPIAuthorized } from "./src/server/desktop-access.ts";
import { ACCESS_COOKIE, accessAuthorized, accessGateEnabled } from "./src/server/remote-access.ts";

/** The address the DEVICE used. Behind `tailscale serve` (or any reverse
 *  proxy) this server sees 127.0.0.1; the proxy's X-Forwarded-* headers
 *  carry the real host and scheme. Trusting them is fine: the self-host
 *  setup binds to loopback, so only the local proxy can reach us. */
function publicURL(request: NextRequest, path: string): URL {
	const forwarded = (name: string) => request.headers.get(name)?.split(",")[0]?.trim() || undefined;
	const proto = forwarded("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
	const host = forwarded("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
	return new URL(path, `${proto}://${host}`);
}

const isAPI = (pathname: string) => pathname === "/api" || pathname.startsWith("/api/");

/** Two independent gates, never both active on one server:
 *
 *  1. Desktop shell (LH_DESKTOP_SERVER): every API method, including SSE and
 *     spending/settings routes, needs the per-launch capability header. No
 *     public callback or worker bypass: internal jobs call server functions,
 *     and any legitimate self-HTTP request must carry the private capability.
 *     Pages are not gated (the window only loads them over 127.0.0.1).
 *
 *  2. Self-host access gate (LH_ACCESS_TOKEN, src/server/remote-access.ts):
 *     pages AND API need the access cookie; pages redirect to /access, API
 *     answers 401. The PWA's public shell assets are excluded by the matcher. */
export function proxy(request: NextRequest) {
	const { pathname, search } = request.nextUrl;
	if (isAPI(pathname) && !desktopAPIAuthorized(request.headers)) {
		return NextResponse.json(
			{ error: "Desktop API access requires the trusted LearnHarness window." },
			{ status: 403, headers: { "Cache-Control": "no-store" } },
		);
	}
	if (accessGateEnabled() && pathname !== "/access") {
		if (!accessAuthorized(request.cookies.get(ACCESS_COOKIE)?.value, request.headers.get("authorization"))) {
			if (isAPI(pathname)) {
				return NextResponse.json(
					{ error: "This LearnHarness server requires its access token. Open /access to sign this device in." },
					{ status: 401, headers: { "Cache-Control": "no-store" } },
				);
			}
			return NextResponse.redirect(publicURL(request, `/access?next=${encodeURIComponent(pathname + search)}`), 307);
		}
	}
	return NextResponse.next();
}

// Everything except immutable build assets and the PWA's public shell
// (manifest, worker, icons, offline page), which carry no user data and
// must load before a device has signed in.
export const config = {
	matcher: "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|pwa/).*)",
};
