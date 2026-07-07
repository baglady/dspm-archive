# Woods pre-flight checklist (offline LAN show)

One codebase, two configs. The woods rig is **laptop + physical norns on the GL
travel router**, launched by `go-lan.ps1`. Everything below is tested **at home,
with a working escape hatch**, BEFORE you lose internet. Check each box.

Key fact: **there is no audience radio stream in the woods.** The mp3 monitor is
produced by the Debian box's docker norns + darkice/icecast; the physical norns
does not make one. Don't rely on `/radio.mp3` at the show.

---

## 0. Repo / branch state + one-time setup (do this WITH internet)
- [ ] On the branch you intend to travel on: `git branch --show-current` (merged to `master` 2026-07-01).
- [ ] Working tree committed or stashed (no half-finished edits riding along): `git status`
- [ ] `bridge/node_modules` present (offline you can't `npm install`): `cd bridge && node -e "require('ws');require('osc-js');console.log('deps ok')"`  ✅ verified 2026-07-01
- [ ] **Tape-pull SSH key pushed to norns** (else the WAV copy hangs on a password prompt mid-show). One-time, with norns reachable:
      `type $env:USERPROFILE\.ssh\id_*.pub | ssh we@192.168.8.180 "mkdir -p .ssh; cat >> .ssh/authorized_keys"`  (norns pw: `sleep`; make a key first with `ssh-keygen -t ed25519` if you have none).
- [ ] **Kill auto-join on every other known Wi-Fi.** Windows will steal the radio back to a phone hotspot. `go-lan.ps1` only demotes `Pixel_3195` + `JewelFlower` — set ANY other saved network to manual too, or forget it.

## 1. Laptop LAN launcher — the real test
- [ ] **Turn Wi-Fi/internet OFF** (or airplane mode + Wi-Fi on) to prove independence.
- [ ] Run it: `powershell -ExecutionPolicy Bypass -File .\go-lan.ps1`
- [ ] UAC approved, firewall rule "DSPM bridge 8081" added.
- [ ] Laptop got a `192.168.8.x` address on `GL-SFT1200-9b3` (pw `goodlife`).
- [ ] norns `192.168.8.180` reports **REACHABLE**.
- [ ] Bridge prints the phone URLs and starts (`OSC -> 192.168.8.180:10111`).

## 2. Phones / control path (a second device on the router)
- [ ] Phone joins `GL-SFT1200-9b3`, opens `http://192.168.8.<laptop>:8081/` → audience UI loads.
- [ ] Phone shows the **current** UI (locked XY pads, no level/clear/record). If it looks old, hard-reload — the service-worker shell caches (`dspm-shell-v4`).
- [ ] Performer UI loads: `http://192.168.8.<laptop>:8081/performer.html?token=dspm`
- [ ] Move an XY pad → **norns actually responds** (sound changes). This proves phone → WS → bridge → OSC → norns end to end.
- [ ] Feedback works (meters/labels update) → proves norns → bridge :10112 return leg.

## 3. Recording / session capture
- [ ] Start a record from performer UI, play ~30s, stop.
- [ ] A `sessions/session_<timestamp>/` folder appears with `manifest.json` + `phone_events.jsonl` + `bridge_ticks.jsonl`.
- [ ] Tape pull: confirm whether you want the WAV auto-scp'd off the physical norns (`TAPE_PULL`, `we`/`sleep` SSH) — or accept no WAV.

## 4. Radio (only if you ALSO want it working at home / online)
- [ ] Local plumbing only: `http://localhost:8081/radio.mp3` → **502 "radio unavailable"**, bridge stays up. (No stream on the laptop — expected.)
- [ ] On Debian: `sudo systemctl status dspm-norns` = active; `sudo docker logs -f norns-docker` shows darkice connected, no crash loop.
- [ ] `https://radio.hetti.be/norns.mp3` plays in VLC (with a softcut buffer loaded so there's sound).
- [ ] Same-origin alias `https://dspm.hetti.be/radio.mp3` plays.

## 5. Known dead-in-the-woods things (just be aware)
- [ ] `pwa/dashboard.html` links point at `hetti.be` — dead offline. Don't use the dashboard at the show; use audience/performer PWAs (same-origin, fine).
- [ ] `/radio.mp3` will 502 in the woods (no icecast). Harmless.
- [ ] Anything Cloudflare-tunnel / `dash.hetti.be` / `radio.hetti.be` = internet-only.

## 6. Physical bag / hardware
- [ ] GL-SFT1200 travel router + its PSU.
- [ ] norns + PSU + **ethernet cable** to the router (LAN, not Wi-Fi to norns).
- [ ] Laptop + charger; `go-lan.ps1` runs from the repo root.
- [ ] The `dspm_archive` script is on the physical norns and loads/inits.
- [ ] Audio out from norns to whatever you're monitoring/PA.

## 7. Gotchas learned the hard way (read before you leave)
- **#1 documented showtime failure (2026-06-21): the laptop on the WRONG Wi-Fi.**
  Windows silently reconnected to a phone hotspot instead of the router, so the
  bridge couldn't reach norns AND phones couldn't reach the bridge. The bridge
  window MUST say `OSC -> 192.168.8.180:10111`. If pads do nothing, check the
  laptop's Wi-Fi first, before anything else.
- **`NORNS_HOST` defaults to `10.42.0.1` if unset** — the bridge will happily run
  and send OSC into the void. `go-lan.ps1` sets it to `192.168.8.180`; if you ever
  start the bridge by hand, you MUST set it (see manual fallback below).
- **norns is WIRED to the router** at `192.168.8.180`. If it's not reachable,
  it's ethernet/power, not Wi-Fi. Check the router client list at `http://192.168.8.1`.
- **Joining the router = no internet.** Any remote SSH/Claude session on the
  laptop drops the moment it joins `GL-SFT1200-9b3`. Do internet-needing prep first.
- **WPA3 trap** (only if you try to give the router internet via a hotspot): newer
  Pixels default the hotspot to WPA3 and the SFT1200 only joins WPA2. For the woods
  we don't care — go LAN-only.

## Manual fallback (if `go-lan.ps1` can't join the router)
1. Click the Wi-Fi icon → join `GL-SFT1200-9b3` (pw `goodlife`) by hand.
2. Either re-run `go-lan.ps1` (it skips the join), or run the bridge directly:
   ```powershell
   $env:NORNS_HOST='192.168.8.180'; $env:BRIDGE_WS_PORT='8081'; $env:BRIDGE_ADMIN_TOKEN='dspm'
   cd .\bridge ; node bridge-server.js
   ```
   (The `NORNS_HOST` line is not optional — without it OSC goes to `10.42.0.1`.)

---

### The single most important test
Run **section 1 with internet physically off**, then do **section 2 step "move an
XY pad → norns responds"** from a phone. If that works offline, the show works.
Everything else is nice-to-have.
