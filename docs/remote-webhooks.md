# Remote control: anyone online, anywhere

How to let people who are **not on the venue WiFi** affect a performance —
either by opening the audience PWA from across the internet, or by wiring a
third-party service (Twitch, Discord, Stripe, IFTTT/Zapier, Twilio, GitHub, …)
to fire events at the show via **webhooks**.

## The one principle

This changes nothing about norns and nothing about the OSC contract. norns still
sees exactly one peer (the bridge) sending at a fixed 40ms tick — see
[bridge-design.md](bridge-design.md). The *only* thing that goes public is the
bridge's existing port. Everything here is **additive and opt-in**:

- It all lives on the bridge's **one port (8081)** — the same port the laptop
  rig and the Opal rig already serve the PWA + WebSocket on. No second port, so
  the Opal guest→bridge firewall rule in [network-opal.md](network-opal.md) is
  unchanged.
- It adds **no npm dependencies** — the bridge still just needs `osc-js` + `ws`,
  so `start-venue.ps1`'s one-time `npm install` is unchanged.
- Every new feature **defaults to today's behavior** (crowd enabled, gain 1,
  generous rate limits). If you never run the tunnel and never POST a webhook,
  the bridge behaves exactly as it does now.

So a normal **laptop** show ([venue-setup.md](venue-setup.md)) or **Opal** show
([network-opal.md](network-opal.md)) is completely unaffected. Going remote is
something you switch *on* for a given performance, never something you have to
work around.

## The actual problem, and why the bridge already solved most of it

norns is behind NAT with no public IP; it can't receive an inbound connection
from the internet, and at most venues neither can the bridge laptop. That NAT
wall is the whole obstacle. The bridge's design already handles the *hard* part —
crowd scale and protecting norns' audio thread — because the fixed-rate tick caps
norns' inbound rate no matter how many senders there are. Going public doesn't
weaken that guarantee. What's left is just: **get internet traffic to the bridge**,
and **protect the bridge itself** now that it's reachable.

```
                       ┌──────────── PUBLIC INTERNET ────────────┐
 anyone's phone (PWA, wss)  ─┐                                    │
 Twitch/Discord/Stripe (POST) ┤  →  cloudflared (outbound-only)  →┘
 Zapier/IFTTT/Twilio (POST)  ─┘            tunnel
                                              │  (no port-forwarding, NAT-safe)
                                    ┌─────────▼──────────┐
                                    │  bridge-server.js   │   venue LAN
                                    │  tick + aggregate   │   (laptop or Pi)
                                    └─────────┬──────────┘
                                              │ OSC UDP :10111, fixed 40ms tick
                                        ┌─────▼─────┐
                                        │   norns   │  (untouched)
                                        └───────────┘
```

## Two shapes of remote input

| | **Continuous control** | **Webhooks (events)** |
|---|---|---|
| Source | a person dragging the PWA's XY pad / sliders, from anywhere | a service POSTing a URL |
| Transport | WebSocket, **held** values | HTTP `POST`/`GET`, one-shot **pulses** |
| Example | "remote viewers drift V1 rate together with the room" | "a $5 donation flips REVERSE; chat `!chaos` spikes the filter" |

Both arrive on the same `:8081` and end up as the same `{channel, value}` the
bridge already forwards to norns. The difference is only the door they come in.

## Getting traffic to the bridge

### Option 1 — Cloudflare Tunnel straight to the bridge (recommended)

Run `cloudflared` on the **same machine as the bridge** (the venue laptop, or the
Opal-rig Pi). It opens an *outbound-only* connection to Cloudflare — no
port-forwarding, no router config, works behind venue NAT — and gives you a
public HTTPS URL that proxies to `http://localhost:8081`, **WebSockets
included**. A quick tunnel needs no account:

```sh
cloudflared tunnel --url http://localhost:8081
# → https://<random-words>.trycloudflare.com
```

That URL now serves the audience PWA *and* the control socket *and* the webhook
route, to the whole internet. The continuous case needs **no code change** — a
remote phone opens the URL and its drags flow PWA → wss → bridge → OSC → norns,
mixing into the same average as the phones in the room.

For a stable name across shows, use a *named* tunnel on a domain you control
instead of the quick tunnel (Cloudflare's free Zero Trust tier). Same daemon.

### Option 2 — cloud relay, bridge dials out (only if you can't tunnel at the venue)

A small public server (Fly.io / Render / Railway / a cheap VPS) accepts the PWA
WS and webhook POSTs; the venue bridge opens an **outbound** WebSocket *to that
relay* and the relay forwards events down. More moving parts and one extra
internet hop of latency, but the public URL stays up even when the venue is
offline. Note the Opal already has an optional WireGuard path to a VPS
([network-opal.md](network-opal.md)) that achieves the same reachability at the
network layer. Reach for this only if Option 1 isn't available.

> ⚠️ The **PikaPods code-server pod can't be the public ingress.** Its proxy
> sits behind the code-server login password, so a third-party service (Stripe,
> Twitch, …) has no way to authenticate through it. PikaPods stays a
> UI/aggregation/logging preview host. The public door must be auth-free at the
> HTTP layer — a Cloudflare Tunnel, or a dedicated host.

### Option 3 — talk to norns directly (don't)

norns *can* be driven directly: OSC `/remote/enc`·`/remote/key`·`/remote/brd`
simulate the encoders/keys, and matron exposes a WebSocket REPL for raw Lua. Both
put unthrottled internet I/O and parsing on norns' audio machine — exactly what
the bridge exists to keep off it. Keep norns seeing one peer.

## The webhook endpoint

`bridge-server.js` exposes, on the same `:8081`:

```
GET|POST /hook/<osc-path>        e.g. POST /hook/param/reverse
                                      POST /hook/barcode/v1/level
```

- The path after `/hook/` **is** the OSC channel (a leading `/` is added). It
  must be one of the bridge's whitelisted `CHANNELS`; anything else is `404`.
- Value resolution, clamped to `0..1`:
  1. JSON body `{"value": 0.7}`
  2. form / query `?value=0.7`
  3. if omitted: discrete channels default to `1` (a "fire"); continuous
     channels require a value (`400` without one).

```sh
# fire a transport edge (discrete channel)
curl -X POST https://<tunnel>/hook/param/reverse

# nudge a continuous channel
curl -X POST https://<tunnel>/hook/barcode/v1/level -d '{"value":0.9}' \
  -H 'content-type: application/json'

# GET form, for no-code tools that only do GET
curl 'https://<tunnel>/hook/param/clear?value=1'
```

### Pulse → music: how a one-shot event becomes sound

Webhooks are stateless pulses; the bridge's continuous channels are *held*,
averaged values. The bridge bridges the gap by channel type:

- **Discrete channels** (`/param/recording`, `/param/clear`, `/param/reverse`,
  `/param/quantize`): the hook fires an edge immediately — the same path a phone
  tap already uses. One donation → REVERSE toggles. Done.
- **Continuous channels** (levels, filter, the per-voice `vN/...`): the hook
  becomes a **short-lived synthetic touch** that joins the crowd average for
  `HOOK_HOLD_MS` (default 1000ms) and then expires. So a webhook *nudges* the
  value alongside whoever's touching in the room, instead of blipping for a
  single tick. Repeated hooks refresh the hold. This reuses the existing tick
  aggregation untouched — webhook holds live in a separate map and never alter
  the phone path.

## Performer kill-switch (and dimmer)

Open-to-the-world means griefing is a *when*, not an if — so the performer keeps
a control the crowd can't reach:

```
GET  /admin/crowd                 → {"enabled":true,"gain":1}
POST /admin/crowd?enabled=0       → mute the crowd entirely
POST /admin/crowd?gain=0.3        → keep them in, at 30% influence
POST /admin/crowd?enabled=1&gain=1
```

- `enabled:false` stops **all** forwarding to norns — continuous ticks, discrete
  edges, and webhooks — while still accepting connections and still logging raw
  `phone_events` (so the archive honestly records what the crowd *tried* to do
  during the mute). `bridge_ticks` only ever records what norns actually got.
- `gain` (0..1) scales continuous influence — a dimmer, not just a switch. It
  doesn't apply to discrete edges (an edge is 0/1).
- **Auth:** if `BRIDGE_ADMIN_TOKEN` is set, the admin route requires it
  (`?token=` or `x-admin-token` header) and is reachable from anywhere. If it's
  **unset**, the route is reachable **only from loopback** — i.e. from the
  bridge machine itself. On the **laptop** rig that's the performer's own
  machine (`curl localhost:8081/admin/crowd?enabled=0`). On the **Opal** rig,
  where the bridge runs on a headless Pi and you want to hit the switch from your
  phone on the LAN, set `BRIDGE_ADMIN_TOKEN` and use the token.

### From the PWA (no curl)

The audience PWA renders a small **LIVE/MUTED** toggle + a **CROWD** gain slider
in the corner — but *only* when the page URL carries `?admin=`. Audience phones
(plain URL) never see it. Open:

- `http://<bridge>:8081/?admin` — on the bridge machine's own browser (loopback,
  no token needed).
- `https://<tunnel>/?admin=<BRIDGE_ADMIN_TOKEN>` — from anywhere, when a token is
  set. Treat that URL as the performer's, not the audience's.

It calls the same `/admin/crowd` endpoint, so the curl forms above stay valid as
a backup.

## Protecting the bridge (now that it's public)

norns is already protected by the tick; these protect the bridge process itself:

- **Per-client WebSocket rate limit** — `BRIDGE_MAX_MSGS_PER_SEC` (default 300).
  An XY pad sends 2 messages per pointer move, so a 120Hz phone dragging hard can
  reach ~240/s; 300 keeps real use clear while still cutting a flood by 97%+.
  Excess messages are dropped, the connection isn't killed. Local phones never
  hit it, and the 40ms tick makes any dropped intermediate value musically
  invisible anyway.
- **Per-IP webhook rate limit** — `BRIDGE_HOOK_MAX_PER_SEC` (default 20). Over
  the cap returns `429`.
- **Value validation / whitelist** — unchanged from today: non-finite values are
  ignored, channels must be in `CHANNELS`, webhook values are clamped to `0..1`.
- **Cloudflare** adds DDoS protection in front; add Turnstile / Cloudflare
  Access on the tunnel hostname if a session gets brigaded.

## Latency — fine for *this* piece

Internet RTT + the Cloudflare hop is ~50–250ms. barcode is a drifting LFO
looper, not tight rhythmic play, and the 40ms tick + mean aggregation already
smooth inputs, so remote sloppiness is musically invisible here. (It would *not*
be fine for a percussive instrument — worth remembering if the instrument
changes.)

## Quick start

Local show first (laptop or Opal, per their docs) — confirm phones in the room
drive norns. Then, on the bridge machine, add the tunnel:

```sh
cloudflared tunnel --url http://localhost:8081
```

Share the printed `https://…trycloudflare.com/` as the remote audience URL, and
point any webhook sources at `https://…trycloudflare.com/hook/<osc-path>`. Keep
the kill-switch handy:

```sh
curl "localhost:8081/admin/crowd?enabled=0"   # panic
curl "localhost:8081/admin/crowd?enabled=1"   # back on
```

Tear down by stopping `cloudflared`; the bridge returns to LAN-only with no
change. Every remote session is logged under `sessions/` exactly like a local
one.

## Env vars (all optional; defaults preserve current behavior)

| var | default | meaning |
|---|---|---|
| `BRIDGE_ADMIN_TOKEN` | *(unset)* | if set, `/admin/crowd` needs it & works from anywhere; if unset, loopback-only |
| `BRIDGE_MAX_MSGS_PER_SEC` | `300` | per-WebSocket-client message cap |
| `BRIDGE_HOOK_MAX_PER_SEC` | `20` | per-IP webhook cap |
| `BRIDGE_HOOK_HOLD_MS` | `1000` | how long a continuous webhook nudge stays in the average |
