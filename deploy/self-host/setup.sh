#!/usr/bin/env bash
# One-shot self-host setup for LearnHarness on a Linux VPS (Debian/Ubuntu
# tested shape; any systemd distro works). Run from the repository root:
#
#   bash deploy/self-host/setup.sh
#
# What it does (idempotent — safe to re-run after `git pull` to update):
#   1. installs dependencies and builds the app
#   2. creates ~/.config/learnharness/learnharness.env with a random
#      LH_ACCESS_TOKEN (only if the file does not exist yet)
#   3. installs and (re)starts the learnharness systemd service (sudo)
#   4. publishes it on your tailnet over HTTPS with `tailscale serve` (sudo)
#
# Prerequisites: Node.js 22+ and npm, git, sudo, and Tailscale installed and
# logged in (`sudo tailscale up`). See docs/self-hosting.md.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_DIR="${HOME}/.config/learnharness"
ENV_FILE="${ENV_DIR}/learnharness.env"
DATA_ROOT="/var/lib/learnharness"
SERVICE=/etc/systemd/system/learnharness.service

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'. $2" >&2; exit 1; }; }

need node "Install Node.js 22 or newer (https://nodejs.org or your distro's nodesource repo)."
need npm "npm ships with Node.js."
need sudo "Run as a user with sudo rights."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 22 ]; then echo "Node.js 22+ required (found $(node -v))." >&2; exit 1; fi

say "Installing dependencies and building (a few minutes)"
cd "${APP_DIR}"
npm ci --no-audit --no-fund
npm run build

say "Configuration: ${ENV_FILE}"
mkdir -p "${ENV_DIR}"
if [ ! -f "${ENV_FILE}" ]; then
	TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(24).toString("base64url"))')"
	sed "s|^LH_ACCESS_TOKEN=.*|LH_ACCESS_TOKEN=${TOKEN}|" deploy/self-host/learnharness.env.example > "${ENV_FILE}"
	chmod 600 "${ENV_FILE}"
	echo "Created with a new access token."
else
	echo "Exists — left unchanged."
fi
sudo mkdir -p "${DATA_ROOT}/data"
sudo chown -R "$(id -un):$(id -gn)" "${DATA_ROOT}"

say "Installing the systemd service"
sed -e "s|__USER__|$(id -un)|" -e "s|__APP_DIR__|${APP_DIR}|" -e "s|__ENV_FILE__|${ENV_FILE}|" \
	deploy/self-host/learnharness.service | sudo tee "${SERVICE}" >/dev/null
# systemd's PATH may not include a user-local Node (nvm, ~/.local): pin it.
sudo sed -i "s|^Environment=NODE_ENV=production|Environment=NODE_ENV=production\nEnvironment=PATH=$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin|" "${SERVICE}"
sudo systemctl daemon-reload
sudo systemctl enable learnharness >/dev/null
sudo systemctl restart learnharness

PORT="$(grep -E '^PORT=' "${ENV_FILE}" | cut -d= -f2)"; PORT="${PORT:-3000}"
for _ in $(seq 1 30); do
	curl -s -o /dev/null "http://127.0.0.1:${PORT}/manifest.webmanifest" && break
	sleep 1
done
curl -s -o /dev/null "http://127.0.0.1:${PORT}/manifest.webmanifest" \
	|| { echo "The service did not come up. Check: journalctl -u learnharness -e" >&2; exit 1; }
echo "Running on 127.0.0.1:${PORT}."

if command -v tailscale >/dev/null 2>&1; then
	say "Publishing on your tailnet (HTTPS)"
	sudo tailscale serve --bg "${PORT}"
	HOST="$(tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')"
	URL="https://${HOST}"
else
	URL="(install Tailscale, then run: sudo tailscale serve --bg ${PORT})"
fi

say "Done"
cat <<MSG
Open on your phone (Tailscale app connected):  ${URL}
Access token (enter once per device):           $(grep -E '^LH_ACCESS_TOKEN=' "${ENV_FILE}" | cut -d= -f2)

Then: Settings → Providers → add your API key(s), pick models, and start
learning. On the phone, use "Add to Home Screen" to install the app.
Update later with:  git pull && bash deploy/self-host/setup.sh
MSG
