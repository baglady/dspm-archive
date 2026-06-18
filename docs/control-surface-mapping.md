# barcode control-surface mapping

How each control in `dspm_archive.lua` (the patched `schollz/barcode`) is reached over OSC, and which writes the perf logger has to record explicitly.

## Two kinds of control

barcode's controls split into two groups with completely different OSC handling:

**1. norns params** — anything added via `params:add*` in `init()`. These are reachable through norns' standard param system, so the `osc.event` handler just forwards `/param/<id>` straight to `params:set(id, value)`. Their changes are logged automatically, because `perf_logger.hook_params()` wraps every param's `action`. This group: `filter_frequency`, `filter_reso`, `recording`, `clear`, `reverse`, `quantize`, the three slew times, `rec level`, `pre level`, plus save/load/share params.

**2. internal `voice[i]` table state** — the per-voice bias and LFO-period values (`level/pan/rate/sign/ls/le` × `.adj` and `.lfo_period`, six voices). These are NOT params; on-device they're only reachable via E2/E3. To reach them from phones, the `osc.event` handler writes directly into the `voice[i]` tables. The `update_lfo` tick (every 0.25s) then picks the new values up automatically. Because these bypass `params:set`, the param-action logging hook never sees them — so each of these writes has an explicit `logger.write("voice_param", ...)` call in the handler.

There's also one odd one out: **`output_level`** (master volume) is neither a param nor a `voice[i]` value — it's `state.level`, set directly by E1. The handler writes it directly and logs it as `state_param`, same as the voice writes.

## OSC path scheme

The handler checks three tiers in order:

1. `/param/<id>` → `params:set(id, value)`. `reverse` and `quantize` are 2-option params (1=off, 2=on) but controllers send 0/1, so those two are shifted +1.
2. `/barcode/<global>` underscore paths, for the few global param ids that contain **spaces** (which can't be used literally in an OSC address): `/barcode/rec_level`, `/barcode/pre_level`, `/barcode/rate_slew`, `/barcode/pan_slew`, `/barcode/level_slew`, plus `/barcode/output_level` for `state.level`.
3. `/barcode/vN/<param>` → `voice[N].<...>`, for the per-voice bias/lfo controls: `level`, `pan`, `rate`, `direction`, `start`, `endpos`, and the LFO-period controls `level_lfo`, `pan_lfo`, `rate_lfo`, `direction_lfo`, `startend_lfo`.

## Core tier (what the bridge/PWA expose first)

To validate the bridge, aggregation, and logging end to end, the first tier exposed to phones is ~15 channels: `output_level`, `filter_frequency`, `filter_reso`, and `level`/`pan` adj for all six voices. Once that's solid, extend into `rate`/`direction` and the loop-point (`start`/`endpos`) and LFO controls.

## Caveat on start/end (`ls`/`le`)

Their adjustment range depends on `state.buffer_size[state.buffer]` (up to 60s), which changes after recording. The handler currently scales these against the *current* buffer size at the moment the message arrives. If exposing them to phones, treat the manifest's range as relative (e.g. -1..0 / 0..1, scaled in the handler) so phone sliders don't need to know the live buffer length. Held back from the Core tier for now.

## Discrete vs continuous

`recording` (toggle) and buffer-switch/undo/clear (key-driven) are discrete actions, not continuous channels. If wanted from phones at all, they'd need a separate "vote" mechanism (e.g. a threshold of phones pressing "record" within a tick) rather than the averaging aggregation used for continuous channels. The transport events themselves are logged from inside `start_recording`/`stop_recording`/`undo`/`clear_recording` and the buffer-switch key path regardless of how they're triggered.

## OS-version note

The `osc.event = function(path, args, from)` registration form is the one verified working against the installed norns OS in the `norns_project` build. If barcode ever moves to a norns OS where `osc.event` is replaced (some discussion of `osc.add_handler`-style APIs exists), this is the single point to update — the path scheme above stays the same.
