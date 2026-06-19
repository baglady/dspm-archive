# Feedback: norns → phones

By default the controller is one-way (phones → norns). This adds the reverse:
when a parameter changes **on norns** — an encoder, the PARAMS menu, a MIDI map,
a pset load — the new value is pushed out so every phone's slider / button / pad
moves to match. Phone↔phone consensus already happens via the bridge's
aggregation; this closes the loop with the device itself.

```
                       feedback (OSC, normalised 0..1)
   norns  ───────────────────────────────────────────►  bridge :10112
   (poll core controls @15Hz,                              │  fan out
    push only what changed)                                ▼  to every phone (WS)
                                                         phones update UI only
                                                         (no echo → no loop)
```

## How it works

- **norns** (`lib/feedback.lua`): a metro samples the core controls at ~15 Hz
  and sends an OSC message — on the *same path the phones use*, value normalised
  to 0..1 — only when a value changed since last sample (`EPS` deadband). It
  learns the bridge's IP from the `from` address of inbound OSC (`set_bridge`),
  so nothing is hardcoded; it replies on the fixed feedback port (10112). The
  poller self-starts the first time the bridge talks to norns.
- **bridge** (`bridge-server.js`): binds the same UDP socket to `FEEDBACK_PORT`
  (`BRIDGE_FEEDBACK_PORT`, default 10112), and for each known channel rebroadcasts
  `{path, args:[value]}` to all connected phones, logging it as a `feedback`
  entry in `bridge_ticks.jsonl`.
- **PWA** (`app.js`): existing `wsListeners` apply feedback to sliders and
  buttons; XY pads move their crosshair when an axis's current target updates
  (suppressed while that pad is being dragged, so feedback never fights a finger).
  Feedback only updates the UI — it never re-sends — so there is no loop.

## Scope

Mirrored controls (the "80/20" most likely to be touched on-device): master
output, filter cutoff + resonance, and per-voice level/pan bias for all six
voices. Extend `Feedback.poll` in `lib/feedback.lua` to cover more (rate, loop
points, LFO periods) — each is one `push()` line. Keep the set small enough that
the 15 Hz poll stays light on the network.

## Tuning

- Rate: `1/15` in `Feedback.start` (raise for snappier mirroring, lower to cut
  traffic). Never push on every audio/LFO tick.
- Deadband: `EPS` in `lib/feedback.lua` (larger = fewer packets, coarser steps).
- Port: `BRIDGE_FEEDBACK_PORT` on the bridge must match `FEEDBACK_PORT` in
  `lib/feedback.lua`.
