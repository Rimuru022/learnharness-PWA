/**
 * /access — the self-host sign-in door (src/server/remote-access.ts). A
 * route handler, not a page: it renders outside the app shell (no sidebar
 * polling the API before the device is signed in) and needs no client JS.
 * GET shows the token form; POST checks it, sets the access cookie for a
 * year and returns to `next`. With the gate off, GET just goes home.
 */
import { ACCESS_COOKIE, accessCookieValue, accessGateEnabled, accessTokenMatches, safeNextPath } from "@/src/server";

const YEAR_SECONDS = 365 * 24 * 60 * 60;

function page(next: string, failed: boolean): Response {
	const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
	const html = `<!doctype html>
<html lang="en" class="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#141414"><link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png">
<title>LearnHarness — sign in</title>
<style>
html,body{height:100%;margin:0;background:#141414;color:#e5e5e5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;padding:2rem;box-sizing:border-box}
form{display:flex;flex-direction:column;gap:.75rem;width:100%;max-width:22rem}
input,button{font:inherit;font-size:16px;border-radius:.5rem;padding:.7rem .9rem;border:1px solid #333}
input{background:#1c1c1c;color:#e5e5e5}button{background:#e5e5e5;color:#141414;border:0;cursor:pointer}
p{color:#a3a3a3;font-size:.8rem;margin:0;text-align:center;max-width:22rem;line-height:1.5}.err{color:#f87171}
</style></head><body><main>
<img src="/pwa/icon-192.png" alt="" width="56" height="56">
<form method="post" action="/access">
<input type="hidden" name="next" value="${esc(next)}">
<input type="password" name="token" autocomplete="current-password" placeholder="Access token" autofocus required>
<button type="submit">Sign in this device</button>
</form>
${failed ? '<p class="err">That token did not match. Check LH_ACCESS_TOKEN on the server.</p>' : "<p>Enter the server's LH_ACCESS_TOKEN once; this device stays signed in.</p>"}
</main></body></html>`;
	return new Response(html, {
		status: failed ? 401 : 200,
		headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
	});
}

export async function GET(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const next = safeNextPath(url.searchParams.get("next"));
	if (!accessGateEnabled()) return new Response(null, { status: 303, headers: { Location: next } });
	return page(next, false);
}

export async function POST(req: Request): Promise<Response> {
	const form = await req.formData();
	const next = safeNextPath(String(form.get("next") ?? "/"));
	const token = String(form.get("token") ?? "");
	if (!accessGateEnabled() || !accessTokenMatches(token)) {
		// Slow down guessing a little; the token itself is the real defense.
		await new Promise((r) => setTimeout(r, 750));
		return page(next, true);
	}
	// Behind `tailscale serve` (or any TLS proxy) the hop to us is plain HTTP;
	// the forwarded scheme decides whether the cookie is Secure.
	const secure = (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
	const cookie = [
		`${ACCESS_COOKIE}=${accessCookieValue(process.env.LH_ACCESS_TOKEN as string)}`,
		"Path=/",
		`Max-Age=${YEAR_SECONDS}`,
		"HttpOnly",
		"SameSite=Lax",
		...(secure ? ["Secure"] : []),
	].join("; ");
	return new Response(null, { status: 303, headers: { Location: next, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
