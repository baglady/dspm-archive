# Network: GL.iNet Opal (GL-SFT1200)

The Opal is used as **AP + wired switch + VPN endpoint** — not as a compute host (no USB-A, modest CPU). The bridge runs on a separate laptop/Pi on the LAN.

## Quick start: everything over the Opal's WiFi

The minimal working rig — norns, the bridge laptop, and all phones on the Opal's **main** SSID (no guest isolation yet; add that from the sections below once it works).

1. **Opal first boot**: update firmware, then set a 5GHz SSID (e.g. `DSPM`), a memorable LAN subnet (admin → Network → LAN, e.g. `192.168.8.1/24`), and leave the *main* network's client isolation **off** (default) so phones can reach the laptop. Internet isn't needed during a show — the WAN port can stay unplugged; the LAN + WiFi run as an isolated island.
2. **Reserve fixed IPs** (admin → DHCP → static leases, by MAC) for norns and the laptop so addresses don't move between shows — e.g. norns `192.168.8.20`, laptop `192.168.8.30`.
3. **norns**: SYSTEM > WIFI > join `DSPM`; it shows its IP. SELECT > **dspm_archive**. (If you have a USB-ethernet adapter, wiring norns into a LAN port instead is even steadier — same steps, it just gets its IP from the cable.)
4. **Laptop**: join `DSPM`, then run the bridge pointed at norns' Opal IP:
   ```powershell
   ./start-venue.ps1 -NornsHost 192.168.8.20
   ```
   It serves the audience page **and** control socket on `:8081` and prints the audience URL.
5. **Phones**: join `DSPM`, open `http://192.168.8.30:8081/` (the laptop's IP).

That's the whole rig over WiFi. The rest of this doc is for *scaling up* — isolating the audience onto their own SSID, and the optional remote tunnel.

## Topology

```
                 ┌───────────────────────────────┐
                 │   GL.iNet Opal (GL-SFT1200)    │
  norns ─(eth)───┤ LAN1                           │
                 │                           WiFi │── "DSPM-performer" (main SSID)
  laptop/Pi ─────┤ LAN2  (runs bridge-server.js)  │       → performer devices
                 │                           WiFi │── "DSPM-audience" (guest SSID, isolated)
                 │                                │       → audience phones (PWA)
                 │  WireGuard client ─────────────┼── tunnel → VPS (hetti.be)  [optional]
                 └───────────────────────────────┘
```

## Two SSIDs: performer vs audience

- **Main SSID** ("DSPM-performer"): TouchOSC / performer devices — full LAN access, can reach norns directly.
- **Guest SSID** ("DSPM-audience"): the PWA controller. GL.iNet's Guest WiFi isolates guest clients from the LAN by default — good for safety, but it means audience phones can't reach the bridge either, until explicitly allowed.

## Allowing audience phones to reach only the bridge

With the bridge host at a fixed LAN IP (e.g. `192.168.8.150`, port 8081), add a firewall exception so the guest zone can reach *only* that IP:port — not norns, not anything else. Because the bridge serves the audience page *and* the control socket on that single port, this one rule lets guests both **load** the controller and **drive** it, while still being unable to touch norns or anything else on the LAN. SSH into the Opal:

```sh
uci add firewall rule
uci set firewall.@rule[-1].name='Allow-Guest-to-Bridge'
uci set firewall.@rule[-1].src='guest'
uci set firewall.@rule[-1].dest='lan'
uci set firewall.@rule[-1].dest_ip='192.168.8.150'
uci set firewall.@rule[-1].dest_port='8081'
uci set firewall.@rule[-1].proto='tcp'
uci set firewall.@rule[-1].target='ACCEPT'
uci commit firewall
/etc/init.d/firewall restart
```

Zone names `guest`/`lan` are GL.iNet defaults — confirm against `/etc/config/firewall` on the actual unit. This is the network-level enforcement of the same principle the bridge enforces in software: norns is never directly reachable by audience devices, only the bridge's one port is.

## WireGuard tunnel (optional)

Only needed if you want a *public* Ghost-hosted page to reach a *specific physical* norns. Generate a WireGuard server config on the VPS, import the `.conf` into the Opal's VPN Client → WireGuard, toggle on. The Opal then routes between VPS and local LAN over the tunnel, no venue-side port-forwarding. Everything else (local audience PWA over the guest SSID) works without it.

## Open items

- Confirm the Opal's exact guest firewall zone names once configured (firmware versions vary).
- Test guest-SSID client limits under load. The PWA's traffic (bursty touch events, not continuous fader streams) is lighter per client than TouchOSC, but the earlier ~8–10 simultaneous-client caveat is worth re-testing at crowd scale.
