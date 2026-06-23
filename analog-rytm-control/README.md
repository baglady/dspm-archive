# analog-rytm-control

A phone/web control surface for the **Elektron Analog Rytm (MKI)** — the
multi-track sibling of [`mbase01-bridge`](../mbase01-bridge) and
[`octatrack-midi-control`](../octatrack-midi-control), built on the same
dspm-style **PWA → WebSocket bridge → MIDI** pipeline.

```
 phone(s) / browser ──WS──► bridge (Node) ──MIDI CC──► Analog Rytm
   per-track faders          one MIDI OUT port          12 tracks + FX + perf
```

The Rytm is 12 drum voices, each on its own MIDI channel, plus an FX track and
performance macros. The **CC numbers repeat across tracks** — the MIDI *channel*
selects the target. One file, [`midi-map.js`](midi-map.js), is the source of
truth for both the bridge and the controller; the full CC research and sources
are in [`RYTM-MIDI.md`](RYTM-MIDI.md).

## Run it

```powershell
# Windows
./start.ps1                       # auto-pick MIDI out, serve on :8084
./start.ps1 -MidiPort "USB MIDI"  # match your interface by name
```
```bash
# Linux / Raspberry Pi
./start.sh
MIDI_PORT_NAME="USB MIDI" ./start.sh
```

Then open `http://<this-pc-ip>:8084/` on any phone on the same network. Pick the
MIDI output port in the top bar. With no interface present the bridge runs in
**dry-run** (logs the CCs) so you can rehearse the UI.

## Wire it to the Rytm

On the Rytm: `SETTINGS → MIDI CONFIG`:
- **PORT CONFIG**: `INPUT FROM = MIDI` (or USB), `RECEIVE CC/NRPN = ON`,
  `PARAM OUTPUT = CC` if you also want the Rytm's own knobs to echo out.
- **CHANNELS**: note each track's channel + the FX and auto channels, then pass
  matching values to the start script if they differ from the defaults
  (tracks `1–12`, FX `13`, perf `13`, auto `14`).

> ⚠️ Channel assignment is user-configurable — **verify it** or the faders hit
> the wrong voice. CC numbers themselves are fixed by the OS.

## What you get

- **Tabs**: `AUTO` (active track) · `1 BD … 12 CB` (the 12 voices) · `FX`
  (delay/reverb/comp/distortion) · `PERF` (12 performance macros).
- **Per-track**: trig, synth, sample, filter, amp, LFO and mix/state controls —
  bipolar params (tune, pan, env depth, LFO speed/fade) render `-64…+63`.
- **Pinned** quick controls (delay/reverb/comp mix) above every tab — edit in
  [`pwa/config.js`](pwa/config.js).
- **Server-side presets** shared across every connected device.
- **Live MIDI port picker** — plug in an interface and select it, no restart.
- **Crowd aggregation** (many phones → one Rytm; mean/last) and a performer
  **kill-switch / dimmer** at `?admin` (loopback) or `?admin=<token>`.
- **Webhooks**: `GET/POST /hook/<channel>?value=<0..1>` drives any control from
  an external service (e.g. `/hook/t1/fltFreq?value=0.8`).
- **Session logging** to `sessions/session_<ts>/` (client events + MIDI CCs).

## Direct Web MIDI (no server)

Set `useWebMidi: true` in [`pwa/config.js`](pwa/config.js) to have the browser
talk to a USB-MIDI interface directly — single device, no bridge. The bridge is
what you want for multiple phones or remote/venue setups.

## Config knobs (env / start-script params)

| Env | Default | Meaning |
|-----|---------|---------|
| `BRIDGE_WS_PORT` | `8084` | HTTP + WebSocket port |
| `MIDI_PORT_NAME` | `''` | substring match for the MIDI out port |
| `TRACK_CHANNELS` | `1..12` | per drum-track MIDI channels |
| `FX_CHANNEL` | `13` | FX track channel |
| `PERF_CHANNEL` | `13` | performance-macro channel |
| `AUTO_CHANNEL` | `14` | active-track channel |
| `AGG` | `mean` | crowd aggregation: `mean` \| `last` |
| `BRIDGE_ADMIN_TOKEN` | `''` | unset → `/admin` is loopback-only |
