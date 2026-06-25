# Deploy on the Debian home server, public via Cloudflare named tunnel

This is **Profile 4** (see [deploy/README.md](deploy/README.md)): the bridge runs
always-on on the Debian box and is reachable from the internet at a stable
hostname (`norns.yourdomain.com`) through a Cloudflare **named** tunnel, while
the norns is driven over the local LAN.

## What crosses the tunnel — and what can't

| Leg | Transport | Through the tunnel? |
|---|---|---|
| phones → bridge (PWA + WebSocket, `:8081`) | TCP / HTTP / WS | **yes** — cloudflared proxies HTTP+WS natively |
| bridge → norns (OSC `:10111`) + feedback in | **UDP** | **no** — cloudflared carries no general inbound UDP |

So the tunnel makes the *page* global; it does **not** make the *norns*
reachable. The bridge can only drive a norns it can send UDP to:

- **Home now:** the norns is on the same LAN as this box → works directly.
- **Remote later:** a norns at a venue / behind NAT needs a small agent that
  dials *out* to this server — see [Phase 2](#phase-2--remote-norns-later).

cloudflared is **outbound-only**: it dials Cloudflare and never binds 80/443, so
it coexists with YunoHost's nginx. Do **not** package the bridge as a YunoHost
app — run it as the plain systemd service below, next to YunoHost.

---

## Phase 0 — home norns, public page

### 1. Server prerequisites

```sh
# Node (nodesource gives a current LTS; nvm works too)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs ffmpeg          # ffmpeg is needed by the render pipeline
node -v

# the repo (path used throughout this doc: /opt/dspm-archive)
sudo git clone https://github.com/baglady/dspm-archive.git /opt/dspm-archive
sudo chown -R "$USER" /opt/dspm-archive
cd /opt/dspm-archive/bridge && npm ci
```

Pick the user the service runs as (a dedicated `dspm` user, or your own login).
It needs to reach the norns on the LAN and write to `sessions/`.

### 2. Configure the bridge

```sh
cp /opt/dspm-archive/deploy/dspm-bridge.env.example /opt/dspm-archive/deploy/dspm-bridge.env
$EDITOR /opt/dspm-archive/deploy/dspm-bridge.env
```

Set, at minimum:

```ini
# norns' LAN IP (give it a static DHCP lease so this never moves)
NORNS_HOST=192.168.1.50
# loopback only -- only cloudflared reaches the bridge
BRIDGE_BIND=127.0.0.1
# gates the performer kill-switch + /api publicly; generate with: openssl rand -hex 24
BRIDGE_ADMIN_TOKEN=paste-the-hex-string-here
SESSIONS_DIR=/opt/dspm-archive/sessions
```

> ⚠️ **No inline comments after a value.** systemd's `EnvironmentFile` does *not*
> strip a trailing `# comment` — it keeps it as part of the value. So
> `BRIDGE_BIND=127.0.0.1   # loopback` makes the bind host literally
> `127.0.0.1   # loopback`, and the bridge crashes with
> `getaddrinfo ENOTFOUND`. Put comments on their own `#` lines, as above. And
> `BRIDGE_ADMIN_TOKEN=` takes the *output* of `openssl rand -hex 24`, not the
> command itself.

### 3. Install the systemd service

The unit in [deploy/dspm-bridge.service](deploy/dspm-bridge.service) is shared
with the Pi profile. Edit the three marked lines for this box —
`User=`, `WorkingDirectory=/opt/dspm-archive/bridge`, and
`EnvironmentFile=/opt/dspm-archive/deploy/dspm-bridge.env` — then:

```sh
sudo cp /opt/dspm-archive/deploy/dspm-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dspm-bridge
journalctl -u dspm-bridge -f      # expect: "http + websocket on 127.0.0.1:8081, OSC -> 192.168.1.50:10111"
```

Quick local check before going public:

```sh
curl -s localhost:8081/ | head -c 80      # should return the PWA HTML
```

### 4. Cloudflare named tunnel

Needs a domain already on Cloudflare (the nameservers pointed at Cloudflare).

```sh
# install cloudflared (Debian package)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb
sudo dpkg -i /tmp/cf.deb

cloudflared tunnel login                     # opens a browser; authorize your zone
cloudflared tunnel create dspm               # prints a TUNNEL-UUID, writes <UUID>.json
cloudflared tunnel route dns dspm norns.yourdomain.com
```

Put the config where the system service reads it:

```sh
sudo mkdir -p /etc/cloudflared
sudo cp /opt/dspm-archive/deploy/cloudflared-config.yml /etc/cloudflared/config.yml
# move the credentials Cloudflare just wrote (in ~/.cloudflared/) into place:
sudo cp ~/.cloudflared/<TUNNEL-UUID>.json /etc/cloudflared/
sudo $EDITOR /etc/cloudflared/config.yml     # fill in <TUNNEL-UUID> + hostname
```

Run it as a service:

```sh
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared            # active (running)
```

Open `https://norns.yourdomain.com/` on a phone — the audience PWA loads and the
WebSocket connects over `wss://` automatically (`resolveBridgeUrl()` follows the
page's https host). Touch a pad; the norns should move.

### 5. Gate the performer page with Cloudflare Access

The audience page is meant to be open, but the performer page (kill-switch,
tape, admin) should not be. In the Cloudflare **Zero Trust** dashboard →
**Access → Applications → Add a self-hosted app**:

- Application domain: `norns.yourdomain.com`, path `performer.html`
  (add a second app for path `admin` and one for `api/sessions` if you want the
  render/edit endpoints gated too).
- Policy: **Allow** → your email (one-time PIN) — or a service token for
  scripted webhooks.

Access sits in front of the tunnel, so this requires zero bridge changes. Keep
`BRIDGE_ADMIN_TOKEN` set as a second layer for the `/admin/crowd` and `/hook/*`
routes (those can also be hit by webhooks that don't go through Access).

### Updating later

```sh
cd /opt/dspm-archive && git pull && cd bridge && npm ci
sudo systemctl restart dspm-bridge
```

---

## Co-located norns in Docker (closes the UDP gap over loopback)

You don't actually need a separate norns box at all: a full norns software stack
runs **in Docker on this same machine** ([schollz/norns-desktop]), so the bridge
drives it over **loopback** (`127.0.0.1:10111`) — the UDP leg never leaves the
box, so the tunnel limitation below simply doesn't apply. Set
`NORNS_HOST=127.0.0.1`. Headless/softcut-only (control, feedback, session
logging, and an mp3 monitor stream all work; no live audio I/O by default). Full
runbook + the systemd unit: [deploy/norns-docker/](deploy/norns-docker/).

This is the simplest "permanent home" norns and is what runs on `babayaga` now.
Phase 2 below is only for a norns that must live somewhere *else*.

[schollz/norns-desktop]: https://github.com/schollz/norns-desktop

## Phase 2 — remote norns (later)

When a norns will be somewhere this box can't reach over UDP (a venue, a friend's
LAN), the server side is already prepared: every OSC message goes through
`sendToNorns(target, msg)` in `bridge/bridge-server.js`, which already has an
`agent` target kind. What's left to build when you need it:

1. **norns-side agent** — a tiny Node script (or a Pi) next to the remote norns
   that opens an outbound `wss://norns.yourdomain.com/agent?id=venueA&token=…`,
   receives that room's `{type:'osc', path, args}` frames (the format
   `oscFrame()` already emits), and re-emits them as OSC to its local
   `127.0.0.1:10111`. Feedback rides back up the same socket.
2. **server: agent registry + rooms** — register each agent connection as a
   target and key the `touches` maps per room so phones pick which norns they
   drive. Aggregation and session logging stay centralized here.

Because the tunnel can't carry UDP and the remote norns is behind NAT, the agent
dialing *out* is the only shape that works — and it reuses the existing
aggregation brain unchanged.
