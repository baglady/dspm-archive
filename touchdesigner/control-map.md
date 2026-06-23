# dspm visuals — signal flow & control map

How signals enter TouchDesigner and what they do to the picture. The whole
network is built by [`build_dspm_visuals.py`](build_dspm_visuals.py) under `/dspm`.

## Signal flow

```
 Overbridge audio ──ASIO──▶ AUDIO/adin ─▶ band RMS (low/mid/high) + rms ─▶ AUDIO/audio (CHOP)
 MIDI interface  ┐
 Rytm  (USB)     ├──MIDI──▶ MIDI/midiin ─▶ knob1..8 (perf CC), hits (notes) ─▶ MIDI/midi (CHOP)
 hubs (CME etc.) ┘
 dspm bridge     ──OSC───▶ OSC/oscin (port 7000) ─▶ OSC/osc (CHOP)

 performer macros (CONTROL custom pars  ◀── MIDI-mapped hardware knobs / touch panel)
                       │
                       ▼
                 CONTROL/master (CHOP)  ── all the visual macros, one bundle
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
   GEN/field (generative.frag) ──▶ feedback/trails ──▶ POST (bloom + post.frag) ──▶ OUT/final ──▶ Window
        ▲                              ▲                    ▲
        └── uAudio, uCtrlA/B           └── Decay/Zoom/Rot   └── uAudio, uCtrlC
```

`master`, `audio`, `midi`, `osc` are all `null` CHOPs — stable names you can
reference from anywhere (`op('/dspm/CONTROL/master')['speed']`).

## Performer macros (CONTROL custom parameters → `master`)

These are the live controls. They are custom parameters on `/dspm/CONTROL`, so
they show as draggable sliders and can be MIDI-learned to hardware (Dialogs ▸ MIDI
Device Mapper, or RMB a parameter ▸ bind). For a touchscreen, add a panel of
Slider COMPs and *Bind* each to one of these parameters.

| Macro       | master chan  | What it does                                            |
|-------------|--------------|---------------------------------------------------------|
| Speed       | `speed`      | flow speed of the field                                 |
| Warp        | `warp`       | domain-warp strength (how liquid/turbulent it is)       |
| Scale/Zoom  | `scale`      | zoom of the noise field                                 |
| Hue         | `hue`        | palette hue rotation                                    |
| Saturation  | `sat`        | colour saturation                                       |
| Contrast    | `contrast`   | field contrast / crunch                                 |
| Colour Mix  | `colormix`   | shifts palette phase for alternate colourways           |
| Kaleidoscope| `kaleido`    | 0 = off → polar mirror wedges                           |
| Feedback    | `feedback`   | how much trail feeds back into the image                |
| Trail Decay | `decay`      | trail persistence (high = long smears)                  |
| FB Zoom     | `zoomfb`     | trail zoom drift (0.5 = neutral)                        |
| FB Rotate   | `rotfb`      | trail rotation drift (0.5 = neutral)                    |
| Audio React | `audioreact` | global amount the Overbridge audio modulates the field  |
| Aberration  | `aberration` | chromatic aberration (tracks highs)                     |
| Vignette    | `vignette`   | edge darkening                                          |
| Bloom       | `bloom`      | glow                                                    |
| Brightness  | `brightness` | output brightness                                       |
| Gamma       | `gamma`      | output gamma                                            |

### Suggested hardware mapping (Rytm PERF knobs)

The Rytm performance macros are CC 35–47 on the perf channel (ch 13 by default in
[`analog-rytm-control/midi-map.js`](../analog-rytm-control/midi-map.js)). The
build pulls eight of them as `knob1..8`. Map them to the eight you want under
your hands — a good starting set:

| Perf knob | CC | Suggested macro |
|-----------|----|-----------------|
| Perf 1    | 35 | Speed           |
| Perf 2    | 36 | Warp            |
| Perf 3    | 37 | Audio React     |
| Perf 4    | 39 | Feedback        |
| Perf 5    | 40 | Trail Decay     |
| Perf 6    | 41 | Hue             |
| Perf 7    | 42 | Kaleidoscope    |
| Perf 8    | 43 | Bloom           |

To bind: open Dialogs ▸ MIDI Device Mapper, then RMB the CONTROL parameter ▸
*Bind*/*Add MIDI…* and wiggle the knob to learn it.

## Audio reactivity (Overbridge → `AUDIO/audio`)

| Channel | Source                | Drives in the shader                          |
|---------|-----------------------|-----------------------------------------------|
| `low`   | < ~200 Hz RMS         | warp swell + brightness "breathing" pulse     |
| `mid`   | ~200–2 kHz RMS        | active-band brightening of the colour         |
| `high`  | > ~3 kHz RMS          | fine surface jitter + chromatic aberration    |
| `rms`   | full-band RMS         | overall energy / tone lift                     |

Overbridge presents a multi-channel audio device; in `AUDIO/adin` pick the
Overbridge ASIO device. Use the Rytm **main out** for a full-mix reaction, or a
**single track out** if you want the visuals locked to e.g. just the kick.

## Rytm USB note triggers (`MIDI/hits`)

`ch1..ch4` note-ons become decaying "hit" envelopes (`MIDI/hits_lag`) you can
patch onto anything for stabs/flashes — e.g. add the kick hit onto `feedback` or
a white flash composite. Default note selection is `chNn*`; remap to your kit's
trig notes (often note 36/C1 per track) in `MIDI/sel_hits`.

## OSC from the dspm bridge (`OSC/oscin`, port 7000)

TD listens on **7000**. Feed it from the bridge with the built-in mirror:

1. **Bridge fan-out (built in).** `bridge/bridge-server.js` mirrors every OSC
   message to TD when `TD_HOST` is set — start it with:

   ```sh
   TD_HOST=<td-machine-ip> node bridge-server.js     # TD_PORT defaults to 7000
   ```

   Crowd touches, the `/param/...` channels, and tape start/stop all ride into
   the visuals on the same addresses they send to norns. Unset `TD_HOST` and the
   bridge behaves exactly as before. (Implemented as `sendOsc()` — a wrapper
   around `osc.send` that dual-casts to norns and TD.)
2. **Or point a phone / OSC sender at TD directly** — host `:7000`, any address.

Once OSC is arriving, channels appear in `OSC/osc` named after the address
(e.g. `param_filter_frequency`). Patch them into `master` macros with a Math/Mix
CHOP, or reference them directly in a uniform expression. Example — let the
crowd's filter cutoff push warp:

```
op('OSC/osc')['param_filter_frequency']   →  added onto CONTROL Warp
```

## Tuning notes

- **Too jumpy / too smooth:** `AUDIO/lag` (attack `lag1`, release `lag2`) and
  `AUDIO/gain` set audio responsiveness.
- **Trails blow out to white:** lower `decay` or `feedback`, or drop `Bloom`.
- **Knobs feel wrong-channel:** confirm the perf channel in `MIDI/sel_knobs`
  (`ch13c35…`) matches your Rytm's MIDI config.
