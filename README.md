# dspm-archive

Performance capture, crowd-scale phone interaction, and archiving for DSPM's `barcode`-based norns set. This is the **new version** — it deploys as a *separate* selectable script (`dspm_archive`) so the existing, working `norns_project`/`barcode` setup stays exactly as it is and remains your reliable fallback.

The crowd can be **in the room** over local WiFi, or **anyone online anywhere** over the internet (a Cloudflare tunnel plus a webhook route lets remote phones and third-party services like Twitch/Stripe affect the set), with a performer **kill-switch/dimmer** over the whole crowd. No matter how many people take part, norns only ever sees one peer at a fixed rate — see [docs/bridge-design.md](docs/bridge-design.md). The remote path is purely additive: without it, the laptop and Opal shows behave exactly as before.

## Layout

```
norns/dspm_archive/      -- patched barcode (dspm_archive.lua) + lib/ (json, perf_logger)
bridge/                  -- many-phones→norns aggregation bridge + session logging (Node)
backend/                 -- performer session-labeling tool (Express + ajv), form UI
pwa/                     -- audience phone controller (installable PWA)
schema/                  -- Session Bundle Spec v1 JSON Schemas (manifest + metadata)
sessions/                -- one directory per performance bundle (+ session_example)
docs/                    -- control-surface mapping, bridge design, network notes
capacitor.config.json    -- Android wrapping for the PWA (Amazon Appstore / Play)
```

## What runs where

- **norns** — `dspm_archive.lua` (audio + the `osc.event` handler + `perf_logger` writing `logs/perflog_*.jsonl`).
- **laptop/server on the LAN** — `bridge/` (websocket for phones, OSC out to norns, tick aggregation, writes `phone_events.jsonl` + `bridge_ticks.jsonl`).
- **VPS alongside Ghost** (or any host with access to the sessions dir) — `backend/` for post-show labeling.
- **audience phones** — `pwa/`, installable, or via the Capacitor-wrapped store listing.

The bridge runs three ways — **laptop** at a show, **Pi behind the Opal** always-on, or **code-server/cloud** for browser dev — all from the same code. See [deploy/README.md](deploy/README.md) for the run profiles and the load-test tools.

## Deploying the norns side (without touching norns_project)

The new script installs as its own folder, so on norns it shows up as a **separate** entry in SELECT next to `barcode`. Nothing about the existing symlinked `barcode` → `norns_project` setup changes.

Transfer the folder via FileZilla SFTP (the only reliable method — SMB silently fails). Host `sftp://10.42.0.1`, user `we`, password `sleep`, port 22. Drop `norns/dspm_archive/` into `/home/we/dust/code/` so you end up with:

```
/home/we/dust/code/dspm_archive/dspm_archive.lua
/home/we/dust/code/dspm_archive/lib/json.lua
/home/we/dust/code/dspm_archive/lib/perf_logger.lua
```

Then verify the transfer landed (don't trust timestamps):

```sh
wc -c ~/dust/code/dspm_archive/dspm_archive.lua    # expect ~29000+ bytes
grep -c "osc.event = function" ~/dust/code/dspm_archive/dspm_archive.lua   # expect 1
```

On norns: SELECT → **dspm_archive**. Your old `barcode` entry is untouched. Logs land in `~/dust/data/dspm_archive/logs/`.

## Bridge (laptop/server on the LAN)

```sh
cd bridge && npm install
NORNS_HOST=10.42.0.1 node bridge-server.js
```

The bridge serves the audience PWA **and** the control WebSocket on one port (`BRIDGE_WS_PORT`, default 8081), so on the venue LAN audience phones need a single URL — `http://<bridge-host>:8081/` — and the guest zone only needs that one port open. Each run creates a new `sessions/session_<timestamp>/` with a manifest and the two log streams; `Ctrl-C` finalizes the manifest's duration. Override `NORNS_HOST`, `NORNS_PORT` (default 10111), `BRIDGE_WS_PORT` (8081), `BRIDGE_TICK_MS` (40), `SESSIONS_DIR`, `PWA_DIR` (set empty to disable static serving) via env.

Remote/safety knobs (all optional; defaults reproduce normal local behavior): `BRIDGE_FEEDBACK_PORT` (10112, UDP in from norns), `BRIDGE_ADMIN_TOKEN` (unset → `/admin/crowd` is loopback-only), `BRIDGE_MAX_MSGS_PER_SEC` (300, per WS client), `BRIDGE_HOOK_MAX_PER_SEC` (20, per webhook IP), `BRIDGE_HOOK_HOLD_MS` (1000). See [docs/remote-webhooks.md](docs/remote-webhooks.md).

For the full show rig on a Windows laptop over shared WiFi, see [docs/venue-setup.md](docs/venue-setup.md) and `start-venue.ps1`.

## PWA (audience phones)

Serve `pwa/` over HTTP from the bridge host (or any host phones can reach). Phones open it and tap "Add to Home Screen".

The controller is two configurable **XY pads** (each axis' dropdown can target *any* parameter the bridge exposes — every per-voice bias/LFO control, the global levels/filter, and the slews), plus transport buttons (record/clear/reverse/quantize) and level sliders. Edit `pwa/config.js` to change the default targets, pads, buttons, and sliders — no code changes needed.

Connection resolves in this order: `?bridge=` override (a full `ws(s)://` URL or bare `host:port`) → a `/proxy/<port>/` path proxy (code-server / PikaPods — the page swaps the port segment and uses `wss://` automatically over https) → fallback `ws://<page-host>:8081`. Every control travels as `{channel, value}` where `channel` is the OSC path and `value` is normalised 0..1; the bridge averages continuous channels across phones and edge-fires the transport buttons. Reminder for the help page: on the venue LAN, phones must turn off cellular/mobile data or the local page won't load.

## Performer controls (kill-switch + dimmer)

The crowd can be the whole internet, so the performer keeps a control they can't reach. Append `?admin` to the page URL to reveal a corner bar with a **LIVE / MUTED** toggle and a **CROWD** gain slider — audience phones on the plain URL never see it.

- On the bridge machine itself: `http://localhost:8081/?admin` (loopback-open, no token).
- From anywhere / through a tunnel: set `BRIDGE_ADMIN_TOKEN`, open `https://<tunnel>/?admin=<token>`.

Same endpoint via curl:

```sh
curl "localhost:8081/admin/crowd?enabled=0"        # mute the crowd entirely
curl "localhost:8081/admin/crowd?gain=0.3"         # keep them in at 30% influence
curl "localhost:8081/admin/crowd?enabled=1&gain=1"
```

`enabled:false` stops all crowd→norns forwarding (continuous + transport + webhooks) while still logging what the crowd *tried* to do; `gain` scales continuous influence — a dimmer, not just a switch.

## Remote / online + webhooks (anyone, anywhere)

To let people who aren't on the venue WiFi take part, run a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) on the bridge machine — outbound-only, no port-forwarding, NAT-safe, and it proxies WebSockets:

```sh
cloudflared tunnel --url http://localhost:8081
# → https://<name>.trycloudflare.com   (serves the PWA, the control socket, and webhooks)
```

Remote phones open that URL and mix into the same crowd average as the room. Third-party services (Twitch, Discord, Stripe, IFTTT/Zapier, Twilio, …) POST to `/hook/<osc-path>`, where the path after `/hook/` is the OSC channel:

```sh
curl -X POST https://<tunnel>/hook/param/reverse                      # discrete edge
curl -X POST https://<tunnel>/hook/barcode/v1/level \
  -H 'content-type: application/json' -d '{"value":0.9}'             # continuous nudge (~1s hold)
curl 'https://<tunnel>/hook/param/clear?value=1'                     # GET form for no-code tools
```

Values clamp to 0..1, unknown channels return 404, and the route is rate-limited per IP. Full design, the pulse→music mapping, and safety notes: [docs/remote-webhooks.md](docs/remote-webhooks.md).

## Feedback (norns → phones)

Changes made *on* norns (an encoder move, a pset load) are pushed back so phones' sliders/pads track the device. See [docs/feedback.md](docs/feedback.md).

## Backend (session labeling)

```sh
cd backend && npm install
SESSIONS_DIR=../sessions node server.js
```

Open `http://<host>:4000`, pick a session, fill the form (validated against the metadata schema before writing `performance-metadata.json`), and optionally upload supplementary media. A `sessions/session_example/` bundle is included to try this before a real session exists.

## Troubleshooting

- **Every HTTP request returns "Upgrade Required" (426).** A stale/old bridge process is still holding `:8081`, so the new one couldn't bind. Clear the orphans and relaunch: `pkill -f server.js` (Linux), then start again. `start.sh` launches by absolute path so its own cleanup `pkill` matches reliably.
- **Phones can't reach the bridge.** Client isolation — common on *guest* networks. Use the main SSID, or the deliberately-allowed audience SSID in [docs/network-opal.md](docs/network-opal.md). On the venue LAN, phones must also turn off cellular/mobile data or the local page won't load.
- **Bridge runs but norns is silent.** Confirm `NORNS_HOST` is norns' IP (not the laptop's), the script is selected on norns, and both are on the same network. The bridge runs fine with no norns — good for rehearsing the UI.
- **Webhook returns 404.** The path after `/hook/` must be a channel the bridge exposes (`CHANNELS` in [bridge/bridge-server.js](bridge/bridge-server.js)).

## Status / what's next

- The replay/remix web player isn't built yet — it would read a complete bundle (manifest + metadata + logs + media) and is the natural next piece once a real session exists.
- Server-side headless norns (running `dspm_archive.lua` on the VPS to replay/remix archived sessions) is the longer-term goal — worth a dedicated pass once the bundle format is validated against a real performance.
- All four layers' logs share one time base; the manifest's `offsets_sec` aligns external recordings (field recorder, video, line-level) against it.
