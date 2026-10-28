#!/bin/sh
# Container entrypoint: optional embedded Tailscale, then the Next server.
#
# With TS_AUTHKEY set, a userspace Tailscale node (no TUN device, no extra
# capabilities) joins your tailnet as $TS_HOSTNAME and publishes the app at
# https://$TS_HOSTNAME.<tailnet>.ts.net via `tailscale serve`. Its state
# lives in /data/tailscale, so the node keeps its identity across redeploys
# and the auth key is only consumed once.
set -e

if [ -n "${LH_ACCESS_TOKEN:-}" ] && [ "${#LH_ACCESS_TOKEN}" -lt 16 ]; then
	echo "LH_ACCESS_TOKEN must be at least 16 characters (the server would lock every request)." >&2
	exit 1
fi
mkdir -p "${LH_DATA_DIR:-/data/data}"

if [ -n "${TS_AUTHKEY:-}" ] || [ -f /data/tailscale/tailscaled.state ]; then
	mkdir -p /data/tailscale /run/tailscale
	tailscaled --tun=userspace-networking --statedir=/data/tailscale \
		--socket=/run/tailscale/tailscaled.sock >/data/tailscale/tailscaled.log 2>&1 &
	TS="tailscale --socket=/run/tailscale/tailscaled.sock"
	for _ in $(seq 1 20); do $TS status >/dev/null 2>&1 && break; [ -S /run/tailscale/tailscaled.sock ] && break; sleep 0.5; done
	$TS up --hostname="${TS_HOSTNAME:-learnharness}" ${TS_AUTHKEY:+--auth-key="$TS_AUTHKEY"} --timeout=60s \
		|| echo "tailscale up failed — see /data/tailscale/tailscaled.log; the app still starts." >&2
	$TS serve --bg "${PORT:-3000}" >/dev/null 2>&1 \
		|| echo "tailscale serve failed — enable HTTPS certificates for your tailnet in the admin console." >&2
	echo "Tailscale: $($TS status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log("https://"+JSON.parse(s).Self.DNSName.replace(/\.$/,""))}catch{console.log("not connected")}})')"
fi

# 0.0.0.0 inside the container only: nothing is published on the host
# unless your compose/Coolify config maps a port or assigns a domain.
exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "${PORT:-3000}"
