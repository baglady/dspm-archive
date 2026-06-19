# Venue setup: laptop as bridge + processor (shared WiFi)

The show rig when norns, the laptop, and the audience phones are all on the
**same WiFi** (home/venue router). The laptop runs the bridge, which is both the
**processor** (aggregates every phone, logs the session) and the **web host**
(serves the audience PWA). norns only does audio.

```
  audience phones ─┐
                   │  http + ws :8081        OSC :10111 (UDP)
  laptop (bridge) ─┼──────────────────────────────────────▶ norns
                   │   serves PWA + WebSocket,
                   │   averages touches, logs session
        all on the same WiFi router
```

Everything audience-facing is on **one port (8081)**: the page and the control
socket share it, so there's a single URL and nothing else to open.

## 1. norns

1. Connect norns to the WiFi: SYSTEM > WIFI > (your network). Note the **IP**
   it shows (e.g. `192.168.1.50`) — that's your `-NornsHost`.
2. SELECT > **dspm_archive** so the OSC handler is live (it listens on 10111).

## 2. Laptop (Windows)

1. **Install Node.js** (one time): the LTS from <https://nodejs.org>, then
   reopen PowerShell so `node` is on PATH.
2. **Get the repo** (one time): `git clone https://github.com/baglady/dspm-archive.git`
   then `cd dspm-archive`. (Or `git pull` if you already have it.)
3. **Allow the port through the firewall** (one time, PowerShell *as Administrator*):
   ```powershell
   New-NetFirewallRule -DisplayName "DSPM bridge 8081" -Direction Inbound `
     -LocalPort 8081 -Protocol TCP -Action Allow -Profile Private
   ```
   (If you skip this, the first run pops a Windows Defender prompt — click
   **Allow access** on *Private* networks instead.)
4. **Run it**, passing norns' IP from step 1:
   ```powershell
   ./start-venue.ps1 -NornsHost 192.168.1.50
   ```
   It prints the **audience URL(s)** (the laptop's WiFi IP, e.g.
   `http://192.168.1.42:8081/`) and starts forwarding OSC to norns.

## 3. Audience phones

Join the same WiFi, open the printed `http://<laptop-ip>:8081/`, optionally
"Add to Home Screen". Drag the XY pads / sliders — touches average across all
phones and drive norns. Every session is logged under `sessions/` on the laptop.

## Notes

- **`NORNS_HOST` is norns' IP, not the laptop's.** The audience URL uses the
  *laptop's* IP. They're two different machines on the same WiFi.
- **Client isolation**: some routers (and most *guest* networks) block client-
  to-client traffic — phones then can't reach the laptop. Use the main network,
  not a guest SSID, or see [network-opal.md](network-opal.md) for a dedicated
  router setup with a deliberately-allowed audience SSID.
- **VS Code Server is optional.** Running code-server on the laptop is handy for
  editing `pwa/config.js` (pad defaults, labels) or restarting the bridge from a
  browser — but it is *not* what the audience connects to, and it's not needed
  for the show. The single `start-venue.ps1` is the whole performance rig.
- **No norns?** The bridge still runs, serves the page, and logs — OSC just goes
  nowhere. Good for rehearsing the UI.
- **Feedback (norns → phones)** — phones don't yet reflect knob moves made *on*
  norns. That's the optional two-way path (`two_way_feedback_optional.lua` in
  your earlier work); say the word and I'll wire the bridge's reverse channel.
