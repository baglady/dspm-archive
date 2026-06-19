// ============================================================
// CONTROL CONFIGURATION
// Edit this file to change buttons, sliders, and XY pad targets.
// Reload the page (or have a friend reload) to pick up changes.
// ============================================================

// Shared axis option list for the XY pads -- every per-voice bias/LFO
// parameter, plus global levels and filter. Grouped so the dropdowns are
// organized by voice. Each option's `paths` is an array -- list more than
// one path to have a single axis drive multiple parameters at once.
const ALL_AXIS_GROUPS = [
  { group: "GLOBAL", options: [
    { label: "MASTER OUTPUT", paths: ["/barcode/output_level"] },
    { label: "PRE LEVEL", paths: ["/barcode/pre_level"] },
    { label: "REC LEVEL", paths: ["/barcode/rec_level"] },
    { label: "FILTER CUTOFF", paths: ["/param/filter_frequency"] },
    { label: "RESONANCE", paths: ["/param/filter_reso"] },
    { label: "RATE SLEW", paths: ["/barcode/rate_slew"] },
    { label: "PAN SLEW", paths: ["/barcode/pan_slew"] },
    { label: "LEVEL SLEW", paths: ["/barcode/level_slew"] },
  ]},
  { group: "VOICE 1", options: [
    { label: "V1 LEVEL", paths: ["/barcode/v1/level"] },
    { label: "V1 PAN", paths: ["/barcode/v1/pan"] },
    { label: "V1 RATE", paths: ["/barcode/v1/rate"] },
    { label: "V1 DIR", paths: ["/barcode/v1/direction"] },
    { label: "V1 START", paths: ["/barcode/v1/start"] },
    { label: "V1 END", paths: ["/barcode/v1/endpos"] },
    { label: "V1 LVL LFO", paths: ["/barcode/v1/level_lfo"] },
    { label: "V1 PAN LFO", paths: ["/barcode/v1/pan_lfo"] },
    { label: "V1 RATE LFO", paths: ["/barcode/v1/rate_lfo"] },
    { label: "V1 DIR LFO", paths: ["/barcode/v1/direction_lfo"] },
    { label: "V1 S/E LFO", paths: ["/barcode/v1/startend_lfo"] },
  ]},
  { group: "VOICE 2", options: [
    { label: "V2 LEVEL", paths: ["/barcode/v2/level"] },
    { label: "V2 PAN", paths: ["/barcode/v2/pan"] },
    { label: "V2 RATE", paths: ["/barcode/v2/rate"] },
    { label: "V2 DIR", paths: ["/barcode/v2/direction"] },
    { label: "V2 START", paths: ["/barcode/v2/start"] },
    { label: "V2 END", paths: ["/barcode/v2/endpos"] },
    { label: "V2 LVL LFO", paths: ["/barcode/v2/level_lfo"] },
    { label: "V2 PAN LFO", paths: ["/barcode/v2/pan_lfo"] },
    { label: "V2 RATE LFO", paths: ["/barcode/v2/rate_lfo"] },
    { label: "V2 DIR LFO", paths: ["/barcode/v2/direction_lfo"] },
    { label: "V2 S/E LFO", paths: ["/barcode/v2/startend_lfo"] },
  ]},
  { group: "VOICE 3", options: [
    { label: "V3 LEVEL", paths: ["/barcode/v3/level"] },
    { label: "V3 PAN", paths: ["/barcode/v3/pan"] },
    { label: "V3 RATE", paths: ["/barcode/v3/rate"] },
    { label: "V3 DIR", paths: ["/barcode/v3/direction"] },
    { label: "V3 START", paths: ["/barcode/v3/start"] },
    { label: "V3 END", paths: ["/barcode/v3/endpos"] },
    { label: "V3 LVL LFO", paths: ["/barcode/v3/level_lfo"] },
    { label: "V3 PAN LFO", paths: ["/barcode/v3/pan_lfo"] },
    { label: "V3 RATE LFO", paths: ["/barcode/v3/rate_lfo"] },
    { label: "V3 DIR LFO", paths: ["/barcode/v3/direction_lfo"] },
    { label: "V3 S/E LFO", paths: ["/barcode/v3/startend_lfo"] },
  ]},
  { group: "VOICE 4", options: [
    { label: "V4 LEVEL", paths: ["/barcode/v4/level"] },
    { label: "V4 PAN", paths: ["/barcode/v4/pan"] },
    { label: "V4 RATE", paths: ["/barcode/v4/rate"] },
    { label: "V4 DIR", paths: ["/barcode/v4/direction"] },
    { label: "V4 START", paths: ["/barcode/v4/start"] },
    { label: "V4 END", paths: ["/barcode/v4/endpos"] },
    { label: "V4 LVL LFO", paths: ["/barcode/v4/level_lfo"] },
    { label: "V4 PAN LFO", paths: ["/barcode/v4/pan_lfo"] },
    { label: "V4 RATE LFO", paths: ["/barcode/v4/rate_lfo"] },
    { label: "V4 DIR LFO", paths: ["/barcode/v4/direction_lfo"] },
    { label: "V4 S/E LFO", paths: ["/barcode/v4/startend_lfo"] },
  ]},
  { group: "VOICE 5", options: [
    { label: "V5 LEVEL", paths: ["/barcode/v5/level"] },
    { label: "V5 PAN", paths: ["/barcode/v5/pan"] },
    { label: "V5 RATE", paths: ["/barcode/v5/rate"] },
    { label: "V5 DIR", paths: ["/barcode/v5/direction"] },
    { label: "V5 START", paths: ["/barcode/v5/start"] },
    { label: "V5 END", paths: ["/barcode/v5/endpos"] },
    { label: "V5 LVL LFO", paths: ["/barcode/v5/level_lfo"] },
    { label: "V5 PAN LFO", paths: ["/barcode/v5/pan_lfo"] },
    { label: "V5 RATE LFO", paths: ["/barcode/v5/rate_lfo"] },
    { label: "V5 DIR LFO", paths: ["/barcode/v5/direction_lfo"] },
    { label: "V5 S/E LFO", paths: ["/barcode/v5/startend_lfo"] },
  ]},
  { group: "VOICE 6", options: [
    { label: "V6 LEVEL", paths: ["/barcode/v6/level"] },
    { label: "V6 PAN", paths: ["/barcode/v6/pan"] },
    { label: "V6 RATE", paths: ["/barcode/v6/rate"] },
    { label: "V6 DIR", paths: ["/barcode/v6/direction"] },
    { label: "V6 START", paths: ["/barcode/v6/start"] },
    { label: "V6 END", paths: ["/barcode/v6/endpos"] },
    { label: "V6 LVL LFO", paths: ["/barcode/v6/level_lfo"] },
    { label: "V6 PAN LFO", paths: ["/barcode/v6/pan_lfo"] },
    { label: "V6 RATE LFO", paths: ["/barcode/v6/rate_lfo"] },
    { label: "V6 DIR LFO", paths: ["/barcode/v6/direction_lfo"] },
    { label: "V6 S/E LFO", paths: ["/barcode/v6/startend_lfo"] },
  ]},
];

const CONFIG = {

  // --- Toggle / momentary buttons -------------------------------------
  buttons: {
    title: "TRANSPORT",
    items: [
      { label: "RECORDING", path: "/param/recording", type: "toggle" },
      { label: "CLEAR BUF", path: "/param/clear", type: "momentary" },
      { label: "REVERSE", path: "/param/reverse", type: "toggle" },
      { label: "LFO SYNC", path: "/param/quantize", type: "toggle" },
    ],
  },

  // --- Sliders ----------------------------------------------------------
  sliders: {
    title: "LEVELS",
    items: [
      { label: "MASTER",     path: "/barcode/output_level", default: 0.8 },
      { label: "PRE LEVEL",  path: "/barcode/pre_level",  default: 1.0 },
      { label: "REC LEVEL",  path: "/barcode/rec_level",  default: 1.0 },
      { label: "FILTER CUTOFF", path: "/param/filter_frequency", default: 1.0 },
      { label: "RESONANCE", path: "/param/filter_reso", default: 0.2 },
    ],
  },

  // --- XY Pads ------------------------------------------------------------
  // Both pads share the full ALL_AXIS_GROUPS list (every per-voice bias/LFO
  // param, plus global levels/filter) -- so each pad's X and Y dropdowns can
  // be pointed at ANY parameter, independently.
  xyPads: {
    title: "XY CONTROL",
    items: [
      {
        label: "PAD A — TEXTURE MORPH",
        axisGroups: ALL_AXIS_GROUPS,
        defaultXPath: "/barcode/v1/rate",
        defaultYPath: "/barcode/v1/level",
      },
      {
        label: "PAD B — LFO CHAOS",
        axisGroups: ALL_AXIS_GROUPS,
        defaultXPath: "/barcode/v3/rate_lfo",
        defaultYPath: "/barcode/v3/pan_lfo",
      },
    ],
  },

  // --- Gyro tilt ----------------------------------------------------------
  // Opt-in; iOS requires a permission tap so this is never active by default.
  // beta  = pitch (tilt forward/back, -90°..90°) → assigned OSC channel
  // gamma = roll  (tilt left/right,   -90°..90°) → assigned OSC channel
  // deadzoneDeg: ignore tilt within ±N degrees of flat (avoids table-drift).
  // rateHz: how often to send while active (bridge crowd-averages like touch).
  gyro: {
    deadzoneDeg: 8,
    rateHz: 15,
    betaDefaultPath:  "/param/filter_frequency",
    gammaDefaultPath: "/barcode/output_level",
  },

};
