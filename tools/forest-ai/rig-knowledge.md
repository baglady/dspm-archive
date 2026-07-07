# DSPM forest rig — facts for the offline assistant

## Topology (LAN-only, no internet in the woods)
- GL-SFT1200 travel router, SSID `GL-SFT1200-9b3`, pw `goodlife`, admin UI http://192.168.8.1
- norns shield: WIRED ethernet to router, always 192.168.8.180 (ssh we@..., pw sleep)
- laptop: Wi-Fi to router, gets 192.168.8.x, runs the bridge (Node, port 8081)
- phones: Wi-Fi to router, open http://192.168.8.<laptop-ip>:8081/ (audience UI)
  or /performer.html?token=dspm (full control)
- signal path: phone → WebSocket :8081 → bridge → OSC → norns :10111;
  feedback returns norns → :10112 → bridge → phones

## Launch
- one-shot: `powershell -ExecutionPolicy Bypass -File .\go-lan.ps1` from repo root
  (joins router, sets NORNS_HOST, firewall rule "DSPM bridge 8081", starts bridge)
- manual bridge: set NORNS_HOST=192.168.8.180, BRIDGE_WS_PORT=8081,
  BRIDGE_ADMIN_TOKEN=dspm, then `node bridge/bridge-server.js`
- bridge window MUST print `OSC -> 192.168.8.180:10111` or nothing will work

## Failure modes, most likely first
1. LAPTOP ON WRONG WI-FI (the #1 real showtime failure). Windows silently
   rejoins a phone hotspot. Symptom: pads do nothing. Fix: rejoin GL-SFT1200-9b3.
2. NORNS_HOST unset → bridge defaults to 10.42.0.1 and sends OSC into the void.
   Bridge runs fine, no sound changes. Fix: set env var, restart bridge.
3. norns unreachable → it's ethernet cable or power, NOT Wi-Fi (it's wired).
   Check router client list at http://192.168.8.1.
4. Phone shows stale UI → service-worker cache (dspm-shell-v4); hard-reload.
5. Firewall blocking 8081 → phones can't load the page while laptop works.
   go-lan.ps1 adds the rule; re-run it or add manually.

## Dead-in-the-woods (expected, not bugs)
- /radio.mp3 → 502 (icecast lives on the home Debian box; no stream in woods)
- dashboard.html, dash.hetti.be, radio.hetti.be, anything Cloudflare → internet-only
- joining the router = no internet on the laptop; remote sessions drop

## Norns quick facts
- physical norns runs the `dspm_archive` script (barcode-based looper)
- forest playalong rig: dspm-playalong-v2 = barcode+oooooo+passersby+molly+awake+cranes+mangl
- norns OSC listens :10111, sends feedback to bridge :10112
- ssh we@192.168.8.180 (pw sleep); tape WAVs live in /home/we/dust/audio/tape

## Building NEW controllers offline (new audio-art networks)
- pipeline lives in sibling repo dir norns-osc-control/:
  1. parse_params.py <script.lua> → raw_manifest.json   (deterministic)
  2. ai_curate.py raw.json -o manifest.json             (uses THIS local model)
  3. build_controller.py manifest.json → web controller (deterministic)
- so a brand-new norns script can become a phone-playable controller with zero internet
- sessions record to sessions/session_<timestamp>/ (manifest.json,
  phone_events.jsonl, bridge_ticks.jsonl)

## Local AI itself
- Ollama at http://127.0.0.1:11434, models on D:\ollama\models
- start server: `D:\ollama\install\ollama.exe serve` (set OLLAMA_MODELS=D:\ollama\models)
- CPU-only machine: 3-4B models ≈ 5-8 tok/s. Keep prompts short.
