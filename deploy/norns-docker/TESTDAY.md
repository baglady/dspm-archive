# Test day — driving the dockerized norns from a phone

The system is already running and boot-persistent (`dspm-norns.service` +
`dspm-bridge.service`). This is the checklist to actually exercise it. See
[README.md](README.md) for how it's built.

## 0+1. Pre-flight — one command

From your laptop:

```sh
ssh babayaga ~/norns-desktop/preflight.sh
```

It health-checks both services + the container + the script, loads the test
sample so the looper has audible material, and prints the URLs. **Want to see:**

```
active
active
Up ...
params=82
   sample loaded -> the 6 voices now have material
radio.mp3 bytes/3s: ~120000        (a number in the tens/hundreds of thousands)
```

- `params` missing or ≠ 82 → script didn't load: `ssh babayaga 'sudo systemctl restart dspm-norns'`, wait ~30s, re-run preflight.
- `SUPERCOLLIDER FAIL` anywhere in the logs is **expected and harmless** — ignore it (the script is softcut-only; see README).

## 2. Open the controls + the monitor

- **Phone (controller):** `https://dspm.hetti.be/` — the audience pads.
  LAN: `http://10.0.0.129:8081/` · tailnet: `http://100.103.9.125:8081/`
  Performer view (kill-switch/tape/admin): `/performer.html?token=<BRIDGE_ADMIN_TOKEN>`
- **Hear it:** open `https://dspm.hetti.be/radio.mp3` in any browser tab / media
  player (VLC: *Open Network Stream*) — works anywhere, same origin as the
  controller (the bridge proxies it). LAN/tailnet direct: `http://10.0.0.129:8002/radio.mp3`.
  This is the softcut output of the box.

## 3. Drive it & confirm

Touch the XY pads / sliders. You should:
- **Hear** the loaded loop chop / pitch / pan on the monitor stream.
- **See** other phones' pads track yours (bridge fan-out) and the voices' own
  LFO motion (norns→phone feedback).

Hard proof each touch reaches norns:

```sh
ssh babayaga 'tail -f ~/norns-desktop/dust/data/dspm_archive/logs/perflog_*.jsonl'
```

Lines (`param`, `voice_param`, ...) stream in as you touch.

## 4. If something's off

| Symptom | Fix |
|---|---|
| Page loads, nothing moves | `ssh babayaga 'journalctl -u dspm-norns -n40'`; `sudo systemctl restart dspm-norns` |
| No sound on the stream | buffer empty → re-run preflight (reloads the sample); `sudo docker logs norns-docker \| grep -i darkice` |
| Page won't load at all | `ssh babayaga 'sudo systemctl restart dspm-bridge'`; check the Cloudflare tunnel (`systemctl status cloudflared`) |
| Total reset | `ssh babayaga 'sudo systemctl restart dspm-norns dspm-bridge'`, wait ~40s, re-run preflight |

## Regenerating the test sample

`preflight.sh` loads `~/norns-desktop/dust/audio/test.wav`. If it's gone (10 s
A-major chord, mono 48 k) — `dust/` is owned by the container's `we` user, so
render to /tmp and copy in as root:

```sh
ssh babayaga 'ffmpeg -y -f lavfi -i "sine=220:d=10" -f lavfi -i "sine=277:d=10" \
  -f lavfi -i "sine=330:d=10" \
  -filter_complex "[0][1][2]amix=inputs=3,tremolo=f=2:d=0.7,aecho=0.8:0.6:300:0.3,volume=0.8[a]" \
  -map "[a]" -ac 1 -ar 48000 /tmp/test.wav && \
  sudo cp /tmp/test.wav ~/norns-desktop/dust/audio/test.wav && sudo chmod 644 ~/norns-desktop/dust/audio/test.wav'
```

Or drop your own `.wav` (≤60 s) in the same place — anything softcut can loop.
