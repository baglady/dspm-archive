# Venue setup — GL router repeating "JewelFlower"

Goal: one network for the whole rig **with internet**, by having the GL travel
router **repeat** an existing Wi-Fi (here `JewelFlower`) as its uplink.

```
[ JewelFlower Wi-Fi ]  --repeat-->  [ GL-SFT1200 router ]
                                          |  (192.168.8.x LAN + internet)
                          +---------------+----------------+
                          |               |                |
                    norns (Ethernet)   THIS LAPTOP     audience / performer
                    192.168.8.180      runs the bridge   phones (Wi-Fi)
```

Why this layout: norns and the bridge laptop **must** share one network, and that
network is the router (`192.168.8.x`). Repeating JewelFlower means the router also
hands out internet, so the bridge reaches norns **and** you stay online (Claude,
Cloudflare tunnel, etc.). The bridge serves the audience PWA and the control
WebSocket on `:8081`, averages every phone's input, logs the session, and forwards
OSC to norns. norns only makes audio.

---

## Step 1 — Router: repeat JewelFlower  (do this FIRST, on your phone)

1. On your phone, join the router's own Wi-Fi: **`GL-SFT1200-9b3`**, password **`goodlife`**
   (or whatever's on the sticker, if changed).
2. Browser → **`http://192.168.8.1`** → log in with the **admin** password
   (the one set at first boot; it will prompt you to create one if it's new — this
   is *not* the `goodlife` Wi-Fi password).
3. Go to **Internet → Repeater** (older GL firmware calls it "Repeater"; newer calls
   it "Internet → Wireless").
4. **Scan**, pick **`JewelFlower`**, enter its Wi-Fi password, **Join**.
5. Wait ~30 s until it shows **Connected** with an IP from JewelFlower. That means
   the router now has internet.

> **Subnet clash note:** if JewelFlower also uses `192.168.8.x`, GL.iNet will shift
> its own LAN to e.g. `192.168.9.x` to avoid a conflict. If that happens, **norns
> is no longer at `192.168.8.180`** — check the router's **Clients** list for norns'
> new address and pass it to the script with `-NornsHost`. (Wired norns usually
> shows as the only Ethernet client.)
>
> **WPA3 note:** the GL-SFT1200 can only join **WPA2** uplinks. If JewelFlower is
> WPA3-only the repeater won't pass traffic — fall back to LAN-only (no internet)
> or use a WPA2 uplink.

## Step 2 — Laptop: join the router + start the bridge

From the repo root in PowerShell:

```powershell
./start-venue-repeater.ps1
```

It will (approve the one **UAC** prompt — needed once for the firewall rule):

1. Add an inbound firewall rule for TCP **8081** so phones can reach the bridge.
2. Join the laptop to **`GL-SFT1200-9b3`** (creates the Wi-Fi profile if missing).
3. Wait for a `192.168.8.x` address, **ping norns**, and check internet via the repeater.
4. Print the **audience / performer URLs**.
5. Start the bridge (foreground). **Ctrl-C** stops it and finalizes the session log.

Override defaults if needed:

```powershell
# norns moved (subnet clash), different router SSID/pass, or a stronger admin token
./start-venue-repeater.ps1 -NornsHost 192.168.9.180 `
  -RouterSsid "GL-SFT1200-9b3" -RouterPass "goodlife" -AdminToken "something-long"
```

## Step 3 — Phones

Everyone joins Wi-Fi **`GL-SFT1200-9b3`** (pw `goodlife`) and opens the URL the
script printed:

- **Audience:** `http://192.168.8.<laptop>:8081/` — the locked, idiot-proof pads.
- **Performer:** `http://192.168.8.<laptop>:8081/performer.html?token=dspm` — full
  control + kill-switch. Keep the token off the audience QR.

To hand the audience a QR instead of typing, point any QR generator at the audience
URL, or run the bridge's public path with `start-venue.ps1 -Tunnel` (needs internet,
which the repeater now provides).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Pads load but **don't change the sound** | bridge can't reach norns | Laptop must be on `192.168.8.x` and `Test-Connection 192.168.8.180` must pass. If norns moved (subnet clash) restart with `-NornsHost <new>`. |
| **Phones can't connect** to the URL | firewall, or phone on wrong Wi-Fi | Confirm the firewall rule (`Get-NetFirewallRule -DisplayName "DSPM bridge 8081"`); make sure the phone is on `GL-SFT1200-9b3`, not the venue Wi-Fi. |
| Laptop **won't get a 192.168.8.x IP** | wrong Wi-Fi password / didn't switch | Join `GL-SFT1200-9b3` by hand (Wi-Fi icon), pw `goodlife`, then re-run. Windows may keep auto-reconnecting to a phone hotspot — "Forget" that hotspot. |
| Repeater says connected but **no internet** | WPA3 uplink, or upstream has no data | Use a WPA2 uplink, or run LAN-only (the show works offline). |
| `EADDRINUSE` on start | a bridge is already running | The script kills old `bridge-server.js`; if it persists, close other Node windows. |

**LAN-only fallback** (skip the repeater entirely): the show runs fine with no
internet — do Step 2 + Step 3 only. You just lose the tunnel/QR-over-internet and
remote help.
