# Bridge design: many phones → one norns

## Core principle

Norns sees exactly one network peer, sending at a fixed, low rate, regardless of whether 3 phones or 300 are connected. All connection handling, aggregation, and any feedback fan-out lives in `bridge-server.js`, never on norns.

```
many phones (websocket) --> bridge (tick + aggregate) --> norns (OSC :10111, fixed rate)
```

Each tick (default 40ms / ~25Hz), the bridge folds whatever happened across all connected phones since the last tick into one value per exposed channel, then sends one OSC message per channel. Norns' inbound message rate is therefore `(channels) × (tick rate)` — a constant, independent of phone count. This is what keeps crowd-scale interaction from ever touching norns' audio thread.

## Aggregation strategies

How the bridge folds many inputs into one value per channel shapes how the piece *feels*:

- **Mean** (current default): average of all phones currently touching a channel. Adding more phones smooths and centers — the crowd converges on a consensus value.
- **Last-write-wins**: most recent touch wins. Feels like passing control around; one person at a time effectively drives each channel.
- **Sharding**: assign each phone to one channel, aggregate only within its shard. Adding phones changes *who drives what* rather than making everything noisier — scales best musically for an audience piece.

These compose (e.g. shard across channels, then mean within each shard). Swap the reducer in the tick loop in `bridge-server.js` per performance.

## Session logging

The bridge writes two of the session bundle's log layers, both timestamped against the same `t0` the manifest records:

- `phone_events.jsonl` — every raw touch: `{type:"touch", t, client, channel, value}`
- `bridge_ticks.jsonl` — every aggregated tick actually sent to norns: `{type:"tick", t, values:{...}}`

norns' own `perf_logger` writes the third layer (`logs/perflog_*.jsonl`) on the device. After the show, those are collected into one bundle and aligned via the manifest's `offsets_sec`. Shared time base across all layers is what makes later replay, remix, and interpolation viable.

## Reverse direction (feedback)

The same shape applies for any norns→phones feedback (visualizations, state shown on phones): the bridge produces one snapshot per tick, fanned out to all open websockets. Norns never holds N outbound connections either.
