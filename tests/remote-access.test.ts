import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
	ACCESS_COOKIE,
	accessAuthorized,
	accessCookieValue,
	accessGateEnabled,
	accessTokenMatches,
	safeNextPath,
} from "../src/server/remote-access.ts";
import { proxy } from "../proxy.ts";
import { GET as accessGET, POST as accessPOST } from "../app/access/route.ts";

const token = "correct-horse-battery-staple";
const env = { LH_ACCESS_TOKEN: token };
const origin = "http://127.0.0.1:3000";

async function withEnv(vars: Record<string, string | undefined>, fn: () => unknown): Promise<void> {
	const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
	for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
	try {
		await fn();
	} finally {
		for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
	}
}

test("gate off: everything authorized, nothing changes", () => {
	assert.equal(accessGateEnabled({}), false);
	assert.equal(accessGateEnabled({ LH_ACCESS_TOKEN: "" }), false);
	assert.equal(accessAuthorized(undefined, null, {}), true);
});

test("gate on: cookie or bearer token authorizes; anything else does not", () => {
	assert.equal(accessGateEnabled(env), true);
	assert.equal(accessAuthorized(accessCookieValue(token), null, env), true);
	assert.equal(accessAuthorized(undefined, `Bearer ${token}`, env), true);
	for (const [cookie, auth] of [
		[undefined, null],
		[token, null], // the raw token is not a valid cookie
		[accessCookieValue("other-token-123456"), null],
		[undefined, "Bearer nope"],
		[undefined, `Basic ${token}`],
	] as const) {
		assert.equal(accessAuthorized(cookie, auth, env), false, `${cookie} ${auth}`);
	}
	assert.equal(accessTokenMatches(token, env), true);
	assert.equal(accessTokenMatches(token + "x", env), false);
});

test("a too-short configured token fails closed", () => {
	const weak = { LH_ACCESS_TOKEN: "short" };
	assert.equal(accessGateEnabled(weak), true);
	assert.equal(accessTokenMatches("short", weak), false);
	assert.equal(accessAuthorized(accessCookieValue("short"), "Bearer short", weak), false);
});

test("post-login destinations stay on this site", () => {
	assert.equal(safeNextPath("/chat/abc?x=1"), "/chat/abc?x=1");
	for (const bad of [null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "chat"]) {
		assert.equal(safeNextPath(bad), "/", String(bad));
	}
});

test("proxy: pages redirect to /access on the device's own address, API answers 401, cookie passes", async () => {
	await withEnv({ LH_ACCESS_TOKEN: token, LH_DESKTOP_SERVER: undefined, LH_DESKTOP_API_SECRET: undefined }, () => {
		const page = proxy(new NextRequest(origin + "/chat/new?draft=1"));
		assert.equal(page.status, 307);
		const target = new URL(page.headers.get("location") ?? "");
		assert.equal(target.pathname + target.search, "/access?next=%2Fchat%2Fnew%3Fdraft%3D1");
		// Behind tailscale serve: the redirect targets the device's address, not loopback.
		const proxied = proxy(new NextRequest(origin + "/", { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "vps.tailnet.ts.net" } }));
		assert.equal(proxied.headers.get("location"), "https://vps.tailnet.ts.net/access?next=%2F");
		assert.equal(proxy(new NextRequest(origin + "/api/chats")).status, 401);
		assert.equal(proxy(new NextRequest(origin + "/access")).headers.get("x-middleware-next"), "1");
		const signedIn = { headers: { cookie: `${ACCESS_COOKIE}=${accessCookieValue(token)}` } };
		assert.equal(proxy(new NextRequest(origin + "/chat/new", signedIn)).headers.get("x-middleware-next"), "1");
		assert.equal(proxy(new NextRequest(origin + "/api/chats", signedIn)).headers.get("x-middleware-next"), "1");
	});
});

test("proxy: gate off leaves browser-only mode open, as before", async () => {
	await withEnv({ LH_ACCESS_TOKEN: undefined, LH_DESKTOP_SERVER: undefined, LH_DESKTOP_API_SECRET: undefined }, () => {
		assert.equal(proxy(new NextRequest(origin + "/api/chats")).headers.get("x-middleware-next"), "1");
		assert.equal(proxy(new NextRequest(origin + "/")).headers.get("x-middleware-next"), "1");
	});
});

test("/access: right token sets an HttpOnly cookie and returns to next; wrong token does not", async () => {
	await withEnv({ LH_ACCESS_TOKEN: token }, async () => {
		const form = (t: string) => {
			const body = new FormData();
			body.set("token", t);
			body.set("next", "/chat/abc");
			return body;
		};
		const ok = await accessPOST(new Request(origin + "/access", { method: "POST", body: form(token), headers: { "x-forwarded-proto": "https" } }));
		assert.equal(ok.status, 303);
		assert.equal(ok.headers.get("location"), "/chat/abc");
		const cookie = ok.headers.get("set-cookie") ?? "";
		assert.match(cookie, new RegExp(`^${ACCESS_COOKIE}=${accessCookieValue(token)};`));
		assert.match(cookie, /HttpOnly/);
		assert.match(cookie, /Secure/);
		assert(!cookie.includes(token), "the raw token never leaves in the cookie");

		const bad = await accessPOST(new Request(origin + "/access", { method: "POST", body: form("wrong-token-wrong-token") }));
		assert.equal(bad.status, 401);
		assert.equal(bad.headers.get("set-cookie"), null);

		const shown = await accessGET(new Request(origin + "/access?next=%2Fchat%2Fabc"));
		assert.equal(shown.status, 200);
		assert.match(await shown.text(), /value="\/chat\/abc"/);
	});
});
