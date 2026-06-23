# Analog Rytm — MIDI / CC research notes

Research backing the `analog-rytm-control` rig (a dspm-style PWA → WebSocket
bridge → MIDI control surface, the multi-track sibling of `mbase01-bridge` and
`octatrack-midi-control`).

> ⚠️ **Verify on your unit.** CC numbers are fixed by the OS, but MIDI **channel**
> assignment is user-configurable. Confirm `SETTINGS → MIDI CONFIG → CHANNELS`
> and that `SETTINGS → MIDI CONFIG → PORT CONFIG` has **INPUT FROM = MIDI/USB**
> and **PARAM OUTPUT / RECEIVE CC/NRPN** enabled, or none of this reaches the
> voices.

## The model: 12 voices, one channel each

The Analog Rytm is a **multi-timbral drum machine** — 12 drum tracks (voices)
plus a global **FX track** and **performance** macros. This is the same shape as
the Octatrack rig: **the CC numbers are identical for every track; the MIDI
*channel* selects which track you're addressing.** So "BD Filter Cutoff" and
"SD Filter Cutoff" are both `CC 74` — just sent on different channels.

| Track | Voice            | Default MIDI ch |
|------:|------------------|:---------------:|
| 1     | BD (bass drum)   | 1               |
| 2     | SD (snare)       | 2               |
| 3     | RS (rimshot)     | 3               |
| 4     | CP (clap)        | 4               |
| 5     | BT (bass tom)    | 5               |
| 6     | LT (low tom)     | 6               |
| 7     | MT (mid tom)     | 7               |
| 8     | HT (high tom)    | 8               |
| 9     | CH (closed hat)  | 9               |
| 10    | OH (open hat)    | 10              |
| 11    | CY (cymbal)      | 11              |
| 12    | CB (cowbell)     | 12              |
| FX    | Delay/Reverb/Comp/Dist | 13 *(verify)* |
| —     | **Auto channel** (active track) | 14 *(verify)* |

The **Auto channel** addresses whichever track is currently selected on the
hardware — handy for a "follow the active track" controller. The **FX track**
holds the send effects (delay, reverb), the master compressor and the analog
distortion; its CCs overlap the per-track CC numbers but live on the FX channel
(exactly like the Octatrack's per-effect CC reuse).

## Per-track CC map (sent on each track's own channel)

Synth-page params (`CC 16–23`) are **machine-dependent** — what "Param 1" does
depends on the machine loaded on the track (BD HARD, SD CLASSIC, etc.). The
sample / filter / amp / LFO pages are the same across machines.

### TRIG
| CC | Param        | Notes |
|---:|--------------|-------|
| 3  | Trig Note    | also the note played by a Note-On |
| 4  | Trig Velocity| |
| 5  | Trig Length  | |

### SYNTH / SRC (machine-dependent — labels are the common case)
| CC | Param            |
|---:|------------------|
| 16 | Synth Param 1    |
| 17 | Synth Tune       |
| 18 | Synth Decay      |
| 19 | Synth Bal / Tone |
| 20 | Synth Param 5    |
| 21 | Synth Param 6    |
| 22 | Synth Param 7    |
| 23 | Synth Param 8    |

### SAMPLE
| CC | Param            |
|---:|------------------|
| 24 | Sample Tune      |
| 25 | Sample Fine Tune |
| 26 | Sample Bit Reduction |
| 27 | Sample Slot      |
| 28 | Sample Start     |
| 29 | Sample End       |
| 30 | Sample Loop      |
| 31 | Sample Level     |

### FILTER
| CC | Param             | Notes |
|---:|-------------------|-------|
| 70 | Filter Attack     | |
| 71 | Filter Decay      | |
| 72 | Filter Sustain    | |
| 73 | Filter Release    | |
| 74 | Filter Frequency  | the cutoff |
| 75 | Filter Resonance  | |
| 76 | Filter Type       | |
| 77 | Filter Env Depth  | **bipolar** (centre 64) |

### AMP
| CC | Param            | Notes |
|---:|------------------|-------|
| 10 | Pan              | **bipolar** (centre 64) |
| 78 | Amp Attack       | |
| 79 | Amp Hold         | |
| 80 | Amp Decay        | |
| 81 | Amp Overdrive    | |
| 82 | Amp Delay Send   | |
| 83 | Amp Reverb Send  | |
| 7  | Track Volume (Amp page Volume) | |

### LFO
| CC  | Param         | Notes |
|----:|---------------|-------|
| 102 | LFO Speed     | **bipolar** |
| 103 | LFO Multiplier| |
| 104 | LFO Fade      | **bipolar** |
| 105 | LFO Destination | |
| 106 | LFO Waveform  | |
| 107 | LFO Start Phase | |
| 108 | LFO Trig Mode | |
| 109 | LFO Depth (MSB) | 14-bit with CC 118 (LSB); MSB alone is fine for a knob |

### TRACK (mix / state)
| CC | Param        | Notes |
|---:|--------------|-------|
| 95 | Track Level  | NB: per Elektronauts, on some OS the Rytm only applies Track Level to the **selected** track — test it; use the Auto channel if a per-track knob misbehaves |
| 94 | Track Mute   | toggle (0 / 127) |
| 93 | Track Solo   | toggle (0 / 127) |
| 92 | Active Scene | global-ish (kit) |

## FX track CC map (sent on the FX channel)

### DELAY
| CC | Param        |
|---:|--------------|
| 16 | Delay Time   |
| 17 | Delay Pingpong (toggle) |
| 18 | Delay Stereo Width |
| 19 | Delay Feedback |
| 20 | Delay Highpass |
| 21 | Delay Lowpass |
| 22 | Delay→Reverb Send |
| 23 | Delay Mix Volume |

### REVERB
| CC | Param            |
|---:|------------------|
| 24 | Reverb Predelay  |
| 25 | Reverb Decay     |
| 26 | Reverb Shelving Freq |
| 27 | Reverb Shelving Gain |
| 28 | Reverb Highpass  |
| 29 | Reverb Lowpass   |
| 31 | Reverb Mix Volume|

### DISTORTION (analog drive on the master)
| CC | Param          |
|---:|----------------|
| 70 | Distortion Amount   |
| 71 | Distortion Symmetry (bipolar) |
| 72 | Distortion Overdrive |
| 76 | Dist Delay/Comp Routing |
| 77 | Dist Reverb/Comp Routing |

### COMPRESSOR (master bus)
| CC | Param               |
|---:|---------------------|
| 78 | Comp Threshold      |
| 79 | Comp Attack         |
| 80 | Comp Release        |
| 81 | Comp Makeup Gain    |
| 82 | Comp Ratio          |
| 83 | Comp Sidechain EQ   |
| 84 | Comp Dry/Wet Mix    |
| 85 | Comp Output Volume  |

## Performance macros (sent on the performance/FX channel)

The 12 performance-mode macros map to `CC 35–47` (note **CC 38 is skipped**):
`35, 36, 37, 39, 40, 41, 42, 43, 44, 45, 46, 47` → Perf 1…12. These drive
whatever each macro is assigned to in the current scene/kit.

## NRPN

The Rytm also exposes everything over **NRPN** (finer than 7-bit CC, and the
only way to reach a few params). This rig uses plain CC for simplicity and
crowd-friendliness; NRPN is a future extension (`midi-map.js` is the single
source of truth — add an `nrpn:[msb,lsb]` field and teach the bridge to emit the
4-message NRPN sequence). NRPN tables are in **Appendix C** of the manual.

## Notes / triggers

- Sending a **Note-On** on a track's channel triggers that voice (velocity →
  accent), like the MBase. The bridge can be extended to fire notes; today it
  sends CC only.
- 14-bit params (LFO Depth via 109/118) are sent as MSB-only here — plenty for a
  fader. Add the LSB if you need fine resolution.
- **MKI vs MKII:** the per-track synth/sample/filter/amp/LFO CC layout is shared.
  Euclidean (`CC 86–91, 117`) and a dedicated hardware FX track are MKII / newer
  OS — harmless to send to an MKI (ignored), so they're omitted here to keep the
  surface honest for "Analog Rytm 1".

## Sources

- [Elektron Analog Rytm MKII MIDI CCs & NRPNs — midi.guide](https://midi.guide/d/elektron/analog-rytm-mkii/)
- [Analog Rytm MKII User Manual, Appendix C: MIDI — ManualsLib](https://www.manualslib.com/manual/1332467/Elektron-Analog-Rytm-Mkii.html?page=79)
- [Track Level CC implementation — Elektronauts](https://www.elektronauts.com/t/track-level-cc-implementation/11749)
- [Analog Rytm MKI OS Release Notes — Elektron](https://www.elektron.se/release-notes/analog-rytm-mki-os-release-notes)
- [MIDI sequencing free update (MKI/MKII/A4) — Synthtopia](https://www.synthtopia.com/content/2019/10/21/elektron-announces-os-update-for-analog-rytm-mki-mkii-analog-four/)
