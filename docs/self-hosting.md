# Self-hosting on a VPS + using it from your phone

Run LearnHarness on a server you control (a VPS, a home server, a mini-PC) and use it from any device — phone, tablet, laptop — as an installable web app (PWA). Your sessions, knowledge graph and API keys stay on that server; devices are thin clients.

```
Phone / laptop (installed PWA)
   │  HTTPS, private to your devices (Tailscale)
   ▼
Your VPS ── LearnHarness server (127.0.0.1:3000)
             ├─ sessions, knowledge graph, settings  (LH_DATA_DIR)
             └─ provider API keys                     (LH_AUTH_FILE)
```

Why this works well: teaching turns run **on the server**, not in the page. Close the app mid-lesson, open it on another device, and the session — including a turn still streaming or a quiz waiting for your answer — picks up where it was.

## What you need

- A Linux server with systemd (Ubuntu/Debian are the tested shape), ~2 GB RAM.
- Node.js 22+ and npm, git.
- [Tailscale](https://tailscale.com/download) on the server **and** on your phone (free for personal use). It gives the server a private HTTPS address that only your devices can reach — no open ports, no domain, no certificates to manage.

## Setup (≈10 minutes)

```bash
# 1. On the VPS: Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up            # log in with the same account as your phone

# 2. The app
git clone https://github.com/amosblomqvist/learnharness.git
cd learnharness
bash deploy/self-host/setup.sh
```

`setup.sh` builds the app, writes `~/.config/learnharness/learnharness.env` with a random access token, installs a `learnharness` systemd service bound to `127.0.0.1`, and publishes it with `tailscale serve`. It ends by printing your URL (`https://<server>.<tailnet>.ts.net`) and the access token.

> HTTPS on `*.ts.net` needs **MagicDNS** and **HTTPS certificates** enabled in the Tailscale admin console (DNS page). The first `tailscale serve` prompts you if they're off.

## First run on your phone

1. Open the Tailscale app and connect.
2. Open the URL from setup in the browser and enter the access token once. The device stays signed in for a year.
3. Install it: **iOS Safari** → Share → *Add to Home Screen*. **Android Chrome** → menu → *Install app*.
4. Settings → Providers → add your provider API key(s) and pick models. Then start learning.

Dictation works on the phone too (HTTPS is what browsers require for the microphone); add a Deepgram key under Settings → Providers → Dictation.

## Access control

| Variable | Effect |
|---|---|
| `LH_ACCESS_TOKEN` unset | No gate — the pre-existing browser-only behavior. Fine on `localhost`, **not** on a reachable server. |
| `LH_ACCESS_TOKEN` set (16+ chars) | Every page and API request needs the access cookie. Pages redirect to `/access`; API calls get `401`. Scripts can send `Authorization: Bearer <token>`. |

The cookie holds an HMAC of the token, never the token itself; it is `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS. Rotating the token (edit the env file, `sudo systemctl restart learnharness`) signs every device out. A token shorter than 16 characters fails closed.

The threat model is deliberately small: one owner, a few devices, a private network in front. Tailscale decides **who can reach** the server; the token is a second lock in case the port is ever exposed by mistake. It is not multi-user authentication.

The desktop app is unaffected: it never sets `LH_ACCESS_TOKEN` and keeps its own per-launch capability header.

## Operating it

```bash
sudo systemctl status learnharness       # is it running?
journalctl -u learnharness -f            # logs
git pull && bash deploy/self-host/setup.sh   # update (keeps your env file and data)
```

**Back up** `/var/lib/learnharness/` — `data/` holds sessions and the graph as plain JSON/JSONL; `auth.json` holds your API keys.

`next start` prints a warning that it "does not work with output: standalone". The standalone output exists for the desktop build; `next start` serves the same build correctly and is what the service uses.

### Optional: demos and visual explanations

The researcher's interactive demos and the visual maker render through headless Chrome. Install Chromium (`sudo apt install chromium` or Google Chrome) and, if it is not on a standard path, set `CHROME_PATH` in the env file. Everything else works without it.

## Without the setup script

```bash
npm ci && npm run build
export LH_ACCESS_TOKEN="$(openssl rand -base64 24)" LH_DATA_DIR=/var/lib/learnharness/data LH_AUTH_FILE=/var/lib/learnharness/auth.json
npm run serve                      # next start on 127.0.0.1:${PORT:-3000}
sudo tailscale serve --bg 3000     # private HTTPS on your tailnet
```

Any TLS reverse proxy (Caddy, nginx, Cloudflare Tunnel) works in place of Tailscale as long as it forwards `X-Forwarded-Host` and `X-Forwarded-Proto`. If the server is reachable from the public internet, the access token is the only thing protecting your API keys — use a long one.

## What the PWA adds

- **Web app manifest** (`app/manifest.ts`) and icons (`public/pwa/`, generated by `scripts/make-icons.mjs`) — installable, full-screen, dark splash.
- **Service worker** (`public/sw.js`) — caches only immutable build assets; never caches `/api/*` or learning data. If the server is unreachable, an offline page explains why instead of the browser's error.
- **Phone layout** — the sidebar becomes an overlay drawer below 768px (closed by default, closes on navigation), the graph toolbar collapses to icons, and Settings opens full-screen with tabbed sections.
