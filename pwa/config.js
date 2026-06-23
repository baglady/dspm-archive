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

// ============================================================
// AUDIENCE CONFIG  (dspm3 — idiotproof build)
// ------------------------------------------------------------
// Deliberately limited so ANYONE — a kid, someone's grandparent — can play
// without ever killing the sound. Nothing here can silence the mix, wipe the
// loop, or stop playback:
//   * NO master / pre / rec level     (can't turn the sound down to nothing)
//   * NO recording / clear-buffer     (can't erase the loop)
//   * filter never closes all the way (BRIGHT axis floored well above silence)
//   * pitch/movement ranges kept tight so corners still sound musical
// Axes are LOCKED (no dropdowns to get lost in). The full unrestricted control
// surface still lives on performer.html — this only restricts audience phones.
// ============================================================
const CONFIG = {

  // --- One safe, fun transport toggle ----------------------------------
  // RECORDING + CLEAR BUF are vibe-killers, so they're performer-only now.
  buttons: {
    title: "PLAY",
    items: [
      { label: "REVERSE", path: "/param/reverse", type: "toggle" },
    ],
  },

  // --- XY Pads (the main attraction) -----------------------------------
  // locked:true  -> axes are fixed, no dropdowns. Each axis is range-limited
  // via min/max (the value sent at the two ends) so even the corners stay
  // musical. `default` is the resting value used by the RESET button.
  xyPads: {
    title: "TOUCH PADS",
    items: [
      {
        label: "TONE",
        locked: true,
        // left → right opens the filter; floored at 0.35 so it never mutes.
        xAxis: { label: "DARK · BRIGHT", paths: ["/param/filter_frequency"],
                 min: 0.35, max: 1.0, default: 0.85 },
        // bottom → top adds sparkle; capped before it screams.
        yAxis: { label: "SPARKLE", paths: ["/param/filter_reso"],
                 min: 0.0, max: 0.5, default: 0.18 },
      },
      {
        label: "SWIRL",
        locked: true,
        // left → right sweeps all six voices across the stereo field.
        xAxis: { label: "LEFT · RIGHT",
                 paths: ["/barcode/v1/pan","/barcode/v2/pan","/barcode/v3/pan",
                         "/barcode/v4/pan","/barcode/v5/pan","/barcode/v6/pan"],
                 min: 0.0, max: 1.0, default: 0.5 },
        // bottom → top nudges pitch/speed of all voices together. Range kept
        // narrow (0.3..0.7) so it colours the sound without derailing the groove.
        yAxis: { label: "LOWER · HIGHER",
                 paths: ["/barcode/v1/rate","/barcode/v2/rate","/barcode/v3/rate",
                         "/barcode/v4/rate","/barcode/v5/rate","/barcode/v6/rate"],
                 min: 0.3, max: 0.7, default: 0.5 },
      },
    ],
  },

  // --- Movement sliders (pure motion, can't mute) ----------------------
  // These set how lively the built-in pan / pitch wobble is. min>max on
  // purpose: slider LEFT = calm (slow LFO), slider RIGHT = lively (fast LFO),
  // so "drag right for more" reads intuitively. Capped so it stays a vibe,
  // never a seizure.
  sliders: {
    title: "MOVEMENT",
    items: [
      { label: "WOBBLE",
        paths: ["/barcode/v1/pan_lfo","/barcode/v2/pan_lfo","/barcode/v3/pan_lfo",
                "/barcode/v4/pan_lfo","/barcode/v5/pan_lfo","/barcode/v6/pan_lfo"],
        min: 0.95, max: 0.10, default: 0.85 },
      { label: "SHIMMER",
        paths: ["/barcode/v1/rate_lfo","/barcode/v2/rate_lfo","/barcode/v3/rate_lfo",
                "/barcode/v4/rate_lfo","/barcode/v5/rate_lfo","/barcode/v6/rate_lfo"],
        min: 0.95, max: 0.25, default: 0.88 },
    ],
  },

  // --- Gentle reset -----------------------------------------------------
  // The RESET button ramps every audience-touchable control back to its
  // `default` over resetMs, smoothly (NOT a norns restart — the loop, the
  // master level, and the performer's settings are all untouched). Built
  // automatically from the controls above; see app.js renderReset().
  resetMs: 1400,

  // --- Gyro tilt: OFF for the audience build ---------------------------
  // One less thing to explain, and its old defaults could tilt master output
  // down to silence. Performers don't use it.
  gyro: null,

};
