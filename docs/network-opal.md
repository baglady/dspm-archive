# Network: GL.iNet Opal (GL-SFT1200)

The Opal is used as **AP + wired switch + VPN endpoint** — not as a compute host (no USB-A, modest CPU). The bridge runs on a separate laptop/Pi on the LAN.

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

With the bridge host at a fixed LAN IP (e.g. `192.168.8.150`, websocket port 8081), add a firewall exception so the guest zone can reach *only* that IP:port — not norns, not anything else. SSH into the Opal:

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
