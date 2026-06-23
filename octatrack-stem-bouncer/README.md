# OT Stem Bouncer — Max for Live device

Automates multitrack ("stem") recording of an Elektron Octatrack into Ableton
Live. The OT has only main + cue outs, so stems are captured **one track per
pass**: isolate a track, replay the recorded performance, record main out for
one loop, advance. After 8 passes you have 8 time-aligned stems to mix/master.

## Why passes (the hardware constraint)

The Octatrack physically cannot output 8 tracks at once — only main L/R and cue
L/R. Separation therefore happens *on the OT* by isolating one track at a time.
This device automates that loop so you don't do 8 manual takes.

## Performance source: gesture replay

You perform **once**, recording your live gestures (crossfader CC, scene
recalls, mute/knob moves) into a Live MIDI clip routed to the OT. On every pass
the device replays that clip, so each stem reproduces the same performance.

## Live set layout

| Track            | Type  | Purpose                                              |
|------------------|-------|------------------------------------------------------|
| `OT Gesture`     | MIDI  | Holds the recorded performance clip (slot 1). Output routed to OT MIDI In. |
| `OT Main In`     | Audio | Receives OT main out. 8 empty slots; one stem each.  |
| (device track)   | MIDI  | Hosts this device; routed to OT MIDI In for mute CCs.|

## Build steps

1. New Max Audio Effect / MIDI device in Live → Max edit.
2. Add a `[v8 ot-stem-bouncer.js]` (or `[js ot-stem-bouncer.js]`) object; drop
   `ot-stem-bouncer.js` next to the `.amxd`.
3. Wire: `[live.button start]` → `[t b]` → `[v8]`; a `[live.button stop]` →
   message `stop` → `[v8]`. v8 **outlet 0** → `[midiout]`.
4. Send `start` (bang) to run all 8 passes; `stop` to abort and unmute.

## VERIFY FIRST (step 0)

The per-track level CC is a **placeholder** (`TRACK_LEVEL_CC = 7`). Before
trusting automation, confirm on your unit:

- OT: `PROJECT > MIDI > CONTROL` — which CC each audio track's **Track Level /
  Amp Vol** responds to, and on which MIDI channel per track.
- Set `TRACK_LEVEL_CC` and `TRACK_CHANNELS` at the top of the JS accordingly.
- Test by hand: send that CC = 0 and confirm the track goes silent (soft mute),
  CC = 127 brings it back. Soft-muting via level is more reliable than the OT's
  front-panel mute over MIDI, which only addresses the *selected* track.

## Known gotchas

- The gesture clip must be **loopable** and the OT must actually respond to the
  recorded CCs (crossfader/scene do; some front-panel actions don't).
- Recording uses Live's clip slots; set global launch quantization to the bar so
  passes start clean. Add a short tail if your loop has reverb/delay.
- Timing is driven by the Live API beat position, not OT clock — keep Live as
  tempo master, or sync Live to the OT and the beat math still holds.

## Prior art / references

- Emil Smith, "It's Not Overbridge for the Octatrack, but It's Close Enough"
- trivorak/octatrack-auto-record (Reaper + SWS, MIDI-CC mute automation)
- Manifold (iPad) — proves per-track mute/solo/level over MIDI is feasible
