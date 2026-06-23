# octatrack-midi-control

Phone / web control surface for an **Elektron Octatrack** (OS v1) over MIDI —
the MIDI sibling of `dspm-archive`. Same shape: an installable controller PWA
talks to a small Node **bridge** over a WebSocket; the bridge owns the single
hardware **MIDI interface** wired to the Octatrack's MIDI IN and forwards every
control as a MIDI CC. One or many phones, the OT only ever sees a clean CC
stream.

```
phone/web PWA  ──ws──▶  bridge (Node)  ──MIDI CC──▶  USB-MIDI interface ──▶  Octatrack MIDI IN
```

The whole control surface — every Octatrack parameter the OS exposes to MIDI — is
generated from one file, [`midi-map.js`](midi-map.js). Edit it and both the
bridge and the UI update.

## Layout

```
midi-map.js     -- single source of truth: the Octatrack OS v1 CC map (UMD: Node + browser)
bridge/         -- WebSocket -> MIDI-out bridge, client aggregation, session logging (Node)
pwa/            -- auto-rendering controller PWA (install to phone home screen)
start.ps1       -- one-command launch on Windows
start.sh        -- same on macOS/Linux
sessions/       -- one dir per run: client_events.jsonl + midi_cc.jsonl + manifest.json
```

## What's controllable (all of it)

Every parameter on the OT's TRACK PARAMETER MAIN pages is MIDI-controllable, plus
the performance and mixer controls. The map covers, **per audio track (1–8) and
the AUTO/active track**:

| Group     | Controls (CC)                                                            |
|-----------|-------------------------------------------------------------------------|
| Playback  | Pitch (16), Start (17), Length (18), Rate (19), Retrig (20), Retrig Time (21) |
| Amp       | Attack (22), Hold (23), Release (24), Volume (25), Balance (26)          |
| LFO       | LFO1–3 Speed (28–30), LFO1–3 Depth (31–33)                               |
| FX1       | Param 1–6 (34–39) — relabelled per loaded effect                        |
| FX2       | Param 1–6 (40–45) — relabelled per loaded effect                        |
| Mixer     | Track Level (46), Cue Level (47) — plus legacy Level (7) / Balance (8)   |
| Track     | Mute (49), Solo (50), Cue (51), Arm (52), Recorder Arm (53), All Arm (54)|

Global / AUTO-channel controls: **Crossfader (48)**, **Scene A select (55)**,
**Scene B select (56)**, and **MIDI-track Mute (112–119) / Solo (120–127)** for
the OT's 8 MIDI tracks. That's 370 addressable channels in total.

FX param names depend on which effect is loaded (Filter, EQ, Phaser, Flanger,
Chorus, Spatializer, Comb, Compressor, Lo-Fi, Delay, Reverb…). Tell the UI what
you have loaded per track in [`pwa/config.js`](pwa/config.js) (`fxTypes`) and the
FX faders relabel themselves from the legends in the map.

## Octatrack setup (do this once)

1. **PROJECT > MIDI > CONTROL**: enable **CC IN** (and AUDIO NOTE IN if you want
   note triggers later).
2. **PROJECT > MIDI > CHANNELS**: set each audio track's **AUDIO CH**. Defaults
   here are tracks 1–8 → MIDI channels 1–8, and the **AUTO channel → 9** (used for
   the AUTO/active-track tab, crossfader, scenes, and MIDI-track mutes/solos).
   If yours differ, pass `-AudioChannels`/`-AutoChannel` (see below).
3. Wire your USB-MIDI interface's **MIDI OUT → Octatrack MIDI IN**.

> The CC numbers are fixed by the OS; only the *channel* assignment is
> user-configurable. Verify by hand first: send Track 1 Mute and confirm the
> right track mutes before trusting a full session.

## Run

**Windows:**
```powershell
./start.ps1                              # first MIDI out, port 8082
./start.ps1 -MidiPort "USB MIDI"         # match interface by name substring
./start.ps1 -Port 8082 -AudioChannels "1,2,3,4,5,6,7,8" -AutoChannel 9
```

**macOS / Linux:**
```sh
MIDI_PORT_NAME="USB MIDI" ./start.sh
```

Then open `http://<this-machine-ip>:8082/` on a phone on the same network and
"Add to Home Screen". Pick a track tab, move faders, hit the mute/solo/arm
buttons — they go straight to the OT.

If no MIDI interface is present the bridge runs in **dry-run** (CCs logged, not
sent) so you can rehearse the UI. It uses [`easymidi`](https://www.npmjs.com/package/easymidi)
(RtMidi) when available — an optional dependency, so install never hard-fails.

## No-server mode (Web MIDI)

For a single phone/laptop with the interface attached directly, skip the bridge:
set `useWebMidi: true` in [`pwa/config.js`](pwa/config.js) and open the page in a
Web-MIDI browser (Chrome/Edge over `https`/`localhost`). The page sends CCs to
the first MIDI output itself.

## Bridge details

`{channel, value}` per message, where `channel` is a map id (`t3/pitch`,
`global/crossfader`, `auto/volume`) and `value` is normalised **0..1**. The
bridge scales to 0..127, sends on the track's MIDI channel, aggregates continuous
controls across clients (mean by default) at a fixed tick, and edge-fires
toggles. Env knobs: `BRIDGE_WS_PORT` (8082), `MIDI_PORT_NAME`, `MIDI_VIRTUAL`,
`BRIDGE_TICK_MS` (25), `AGG` (mean|last), `AUDIO_CHANNELS`, `AUTO_CHANNEL`,
`BRIDGE_MAX_MSGS_PER_SEC` (300), `BRIDGE_ADMIN_TOKEN`, `SESSIONS_DIR`, `PWA_DIR`.

## Performer kill-switch / dimmer

Open the controller with `?admin` (loopback) or `?admin=<token>` (with
`BRIDGE_ADMIN_TOKEN` set) to reveal a **LIVE/MUTED** toggle and a **CROWD** gain
slider — same idea as dspm. Or via curl:

```sh
curl "localhost:8082/admin/crowd?enabled=0"     # stop all client -> OT forwarding
curl "localhost:8082/admin/crowd?gain=0.3"      # dim client influence to 30%
```

## Webhooks

Third-party services can drive a control: `POST`/`GET` `/hook/<channel>`, e.g.
`curl localhost:8082/hook/global/crossfader?value=0.8`. Unknown channels 404;
values clamp to 0..1; per-client rate-limited.

## Sessions

Each run writes `sessions/session_<ts>/` with `client_events.jsonl` (what clients
sent), `midi_cc.jsonl` (what went to the OT: channel, CC, value), and a
`manifest.json` finalized with duration on `Ctrl-C`.

## Relation to the other Octatrack tool here

[`../octatrack-stem-bouncer`](../octatrack-stem-bouncer) is a Max-for-Live device
that *replays* a recorded gesture clip to bounce stems pass-by-pass. This project
is the **live, interactive** front end — drive the OT in real time from phones —
and uses the same CC facts (e.g. Track Level CC, mute CCs) the bouncer relies on.
