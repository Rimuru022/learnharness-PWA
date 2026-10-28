# LearnHarness self-host image (docs/self-hosting.md). One container: the
# Next.js server plus an optional embedded Tailscale node that publishes it
# over HTTPS to your tailnet only (set TS_AUTHKEY). Works with Coolify,
# Dokploy, or plain `docker compose up`.

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Electron is a devDependency for the desktop build only — skip its download.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build \
	&& npm prune --omit=dev --no-audit --no-fund \
	&& rm -rf .next/cache .next/standalone

FROM node:24-bookworm-slim
WORKDIR /app
ARG TAILSCALE_VERSION=1.104.4
# chromium: headless rendering for interactive demos and visual explanations.
# curl/ca-certificates: the healthcheck and the Tailscale download.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends chromium ca-certificates curl fonts-dejavu-core \
	&& curl -fsSL "https://pkgs.tailscale.com/stable/tailscale_${TAILSCALE_VERSION}_amd64.tgz" \
		| tar xz --strip-components=1 -C /usr/local/bin "tailscale_${TAILSCALE_VERSION}_amd64/tailscale" "tailscale_${TAILSCALE_VERSION}_amd64/tailscaled" \
	&& rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
	NEXT_TELEMETRY_DISABLED=1 \
	PORT=3000 \
	CHROME_PATH=/usr/bin/chromium \
	LH_DATA_DIR=/data/data \
	LH_AUTH_FILE=/data/auth.json
COPY --from=build /app /app
COPY deploy/docker/entrypoint.sh /usr/local/bin/lh-entrypoint
RUN chmod +x /usr/local/bin/lh-entrypoint
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
	CMD curl -fsS http://127.0.0.1:3000/manifest.webmanifest >/dev/null || exit 1
ENTRYPOINT ["lh-entrypoint"]
