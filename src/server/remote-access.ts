import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Self-host access gate (self-host PWA, 2026-10-28). Opt-in: set
 * LH_ACCESS_TOKEN on a server reachable from other devices (a VPS behind
 * Tailscale, a home server) and every page and API request then needs the
 * access cookie, obtained once per device by entering the token at
 * /access. Unset = today's behavior, byte for byte.
 *
 * Threat model, stated plainly: one owner, a handful of devices, a private
 * network (Tailscale) in front. This keeps out anyone who merely reaches
 * the port; it is not multi-user auth. The cookie carries an HMAC of the
 * token (never the token itself), so rotating LH_ACCESS_TOKEN signs every
 * device out. The desktop shell never sets the variable and keeps its own
 * per-launch capability (desktop-access.ts).
 */

export const ACCESS_COOKIE = "lh_access";
/** Shorter tokens are refused (treated as misconfiguration → locked). */
export const ACCESS_TOKEN_MIN_LENGTH = 16;
const ACCESS_CONTEXT = "learnharness-access-v1";

type Env = Record<string, string | undefined>;

/** True when the gate is on (LH_ACCESS_TOKEN set, even if invalid). */
export function accessGateEnabled(env: Env = process.env): boolean {
	return env.LH_ACCESS_TOKEN !== undefined && env.LH_ACCESS_TOKEN !== "";
}

/** The cookie value a device holds after entering the right token. */
export function accessCookieValue(token: string): string {
	return createHmac("sha256", token).update(ACCESS_CONTEXT).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

/** Does the submitted token match the configured one? A configured token
 *  shorter than the minimum never matches (fail closed). */
export function accessTokenMatches(submitted: string, env: Env = process.env): boolean {
	const expected = env.LH_ACCESS_TOKEN;
	if (!expected || expected.length < ACCESS_TOKEN_MIN_LENGTH) return false;
	return safeEqual(accessCookieValue(submitted), accessCookieValue(expected));
}

/** Request authorization: the access cookie, or `Authorization: Bearer
 *  <token>` for scripts (curl, health checks). Gate off → always true. */
export function accessAuthorized(cookie: string | undefined, authorization: string | null, env: Env = process.env): boolean {
	if (!accessGateEnabled(env)) return true;
	const expected = env.LH_ACCESS_TOKEN as string;
	if (expected.length < ACCESS_TOKEN_MIN_LENGTH) return false;
	if (cookie && safeEqual(cookie, accessCookieValue(expected))) return true;
	const bearer = authorization?.match(/^Bearer (.+)$/)?.[1];
	return bearer !== undefined && accessTokenMatches(bearer, env);
}

/** Only same-site relative paths survive as post-login destinations. */
export function safeNextPath(next: string | null | undefined): string {
	if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
	return next;
}
