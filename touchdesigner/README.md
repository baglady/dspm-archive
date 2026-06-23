# dspm visuals — TouchDesigner generative engine

A generative, audio-/MIDI-/OSC-reactive visual system for the dspm-archive rig.
It takes in:

- **Overbridge audio** from the Analog Rytm (multi-channel ASIO) → band analysis,
- **MIDI** from your MIDI interface, the **Rytm over USB**, and the hub ports,
- **OSC** from the dspm bridge (crowd / phones / norns),

and renders a domain-warped, feedback-trailed plasma field that the performer
shapes live with knobs — on screen, on a touch panel, or on the Rytm's
performance macros.

It's the visual sibling of the audio control surfaces in this repo
([analog-rytm-control](../analog-rytm-control/),
[octatrack-midi-control](../octatrack-midi-control/),
[mbase01-bridge](../mbase01-bridge/)): same idea — many control signals into one
performable surface — pointed at light instead of sound.

## Why a build script and not a `.toe`

TouchDesigner project files are **binary**, so a network can't be authored as
text outside the app (and wouldn't diff/merge in git). Instead the network is
defined by [`build_dspm_visuals.py`](build_dspm_visuals.py), which you run once
inside TD to construct it. The two GLSL shaders live as plain `.frag` files you
can edit live. Everything here is version-controllable and reviewable.

```
touchdesigner/
├── build_dspm_visuals.py   # run this inside TD — builds the whole /dspm network
├── shaders/
│   ├── generative.frag     # the core reactive field
│   └── post.frag           # chromatic aberration + vignette + grade
├── control-map.md          # signal flow, knob map, OSC addresses
└── README.md
```

## Setup

**Requires:** TouchDesigner (099 / 2022+ free or commercial), the Elektron
Overbridge app/driver, your MIDI interface, and (optionally) the dspm bridge
running for crowd OSC.

1. **Audio.** Launch Overbridge so the Rytm's audio device is available as
   ASIO. (Pick main out for full-mix reaction, or a single track out to lock the
   visuals to one voice.)
2. **Build the network.** In a new TD project:
   - Create a **Text DAT**, set its `File` parameter to
     `touchdesigner/build_dspm_visuals.py`.
   - Right-click the DAT → **Run Script**.
   - Read the **CHECKLIST** it prints in the Textport.
3. **Finish the three device hookups** (the only environment-specific bits):
   - `/dspm/AUDIO/adin` → set Driver + Device to the **Overbridge** audio device.
   - **Dialogs ▸ MIDI Device Mapper** → add your MIDI interface, the **Rytm
     (USB)**, and any hub ports. Confirm the perf channel in `/dspm/MIDI/sel_knobs`
     matches your Rytm (default ch 13).
   - **OSC** arrives on port **7000** — see *OSC* in
     [control-map.md](control-map.md) for the one-time bridge fan-out.
4. **Output.** Open `/dspm/OUT/output_window`, set **Monitor** to your
   projector/screen, pulse **Open** for fullscreen.

Re-running the script is safe — it tears down and rebuilds `/dspm`.

## Playing it

Open the parameters of `/dspm/CONTROL` — those custom parameters **are** the
instrument (Speed, Warp, Feedback, Kaleidoscope, Bloom, …). Three ways to drive
them, all live at once:

- **Hardware knobs** — MIDI-map the Rytm PERF macros (or any controller) onto the
  CONTROL parameters via the MIDI Device Mapper. Suggested map in
  [control-map.md](control-map.md).
- **Touch panel** — add Slider COMPs bound to the CONTROL parameters for a
  touchscreen surface (kept manual so it doesn't fight MIDI mapping).
- **The room** — once the bridge fan-out is on, crowd/phone OSC modulates the
  field through `/dspm/OSC`.

Meanwhile the **Overbridge audio** is always modulating it: bass swells the warp
and brightness, mids brighten the active colour, highs sparkle the surface and
push the chromatic aberration. Dial the overall amount with the **Audio React**
macro.

See [control-map.md](control-map.md) for the full signal flow, the complete macro
table, the audio band map, Rytm USB note-trigger routing, and OSC details.

## Editing the look

The two shaders are normal files — with `syncfile` on (the build sets this), edit
`shaders/generative.frag` or `shaders/post.frag` in any editor, save, and TD
reloads them live. The header of each `.frag` documents its uniforms. Structural
changes (new operators, new modulation routes) go in `build_dspm_visuals.py` so
they survive a rebuild.

## Gotchas

- **No picture / static field:** the GLSL uniform parameter names differ slightly
  between TD versions. The build guards these and prints a warning if one didn't
  bind — re-add it on `/dspm/GEN/field` (uniform names/expressions are listed in
  `build_dspm_visuals.py`’s `add_uniform` calls). The field still animates off
  `uTime` even if audio/control uniforms are unbound.
- **No audio reaction:** confirm `/dspm/AUDIO/adin` shows live values; if flat,
  the Overbridge device isn't selected or Overbridge isn't running.
- **Knobs do nothing:** the device isn't in the MIDI Device Mapper, or the perf
  channel in `MIDI/sel_knobs` doesn't match your unit.
