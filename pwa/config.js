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
  { group: "ALL VOICES", options: [
    { label: "SWIRL L·R",   paths: ["/barcode/v1/pan","/barcode/v2/pan","/barcode/v3/pan",
                                    "/barcode/v4/pan","/barcode/v5/pan","/barcode/v6/pan"] },
    { label: "PITCH ALL",   paths: ["/barcode/v1/rate","/barcode/v2/rate","/barcode/v3/rate",
                                    "/barcode/v4/rate","/barcode/v5/rate","/barcode/v6/rate"] },
    { label: "LEVEL ALL",   paths: ["/barcode/v1/level","/barcode/v2/level","/barcode/v3/level",
                                    "/barcode/v4/level","/barcode/v5/level","/barcode/v6/level"] },
    { label: "WOBBLE ALL",  paths: ["/barcode/v1/pan_lfo","/barcode/v2/pan_lfo","/barcode/v3/pan_lfo",
                                    "/barcode/v4/pan_lfo","/barcode/v5/pan_lfo","/barcode/v6/pan_lfo"] },
    { label: "SHIMMER ALL", paths: ["/barcode/v1/rate_lfo","/barcode/v2/rate_lfo","/barcode/v3/rate_lfo",
                                    "/barcode/v4/rate_lfo","/barcode/v5/rate_lfo","/barcode/v6/rate_lfo"] },
    { label: "DRIFT ALL",   paths: ["/barcode/v1/direction_lfo","/barcode/v2/direction_lfo","/barcode/v3/direction_lfo",
                                    "/barcode/v4/direction_lfo","/barcode/v5/direction_lfo","/barcode/v6/direction_lfo"] },
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
// AUDIENCE-SAFE AXIS MENU (for the pad dropdowns)
// ------------------------------------------------------------
// Same shape as ALL_AXIS_GROUPS but curated + RANGE-CLAMPED so no choice can
// stop the audio. Every option carries min/max (the values sent at the two
// ends of the axis) and a default used by RESET:
//   * NO master / pre / rec level, NO per-voice level or level LFO
//   * NO raw loop start/end (a zero-length window can choke a voice)
//   * NO direction bias (can freeze a playhead); direction LFO is fine
//   * filter floored at 0.35, resonance capped, pitch kept to 0.3..0.7
// LFO options are PERIODS (norns maps 0..1 -> 1..50s); min>max on purpose so
// pad-right/up = livelier, same trick as the MOVEMENT sliders.
// ============================================================
function _audienceVoiceGroup(i) {
  const v = "/barcode/v" + i + "/";
  return { group: "VOICE " + i, options: [
    { label: "V" + i + " PAN",     paths: [v + "pan"],           min: 0.0,  max: 1.0,  default: 0.5  },
    { label: "V" + i + " PITCH",   paths: [v + "rate"],          min: 0.3,  max: 0.7,  default: 0.5  },
    { label: "V" + i + " WOBBLE",  paths: [v + "pan_lfo"],       min: 0.95, max: 0.10, default: 0.85 },
    { label: "V" + i + " SHIMMER", paths: [v + "rate_lfo"],      min: 0.95, max: 0.25, default: 0.88 },
    { label: "V" + i + " DRIFT",   paths: [v + "direction_lfo"], min: 0.95, max: 0.25, default: 0.90 },
    { label: "V" + i + " WANDER",  paths: [v + "startend_lfo"],  min: 0.95, max: 0.25, default: 0.90 },
  ]};
}

const _ALLV = (p) => ["/barcode/v1/","/barcode/v2/","/barcode/v3/",
                      "/barcode/v4/","/barcode/v5/","/barcode/v6/"].map((v) => v + p);

const AUDIENCE_AXIS_GROUPS = [
  { group: "TONE", options: [
    // left/bottom end floored at 0.35 so the filter never closes to silence
    { label: "DARK · BRIGHT", paths: ["/param/filter_frequency"], min: 0.35, max: 1.0, default: 0.85 },
    { label: "SPARKLE",       paths: ["/param/filter_reso"],      min: 0.0,  max: 0.5, default: 0.18 },
    // slews = how smeary changes are (0..1 -> 0..30s); capped at 15s
    { label: "GLIDE",         paths: ["/barcode/rate_slew"],      min: 0.0,  max: 0.5, default: 0.033 },
    { label: "PAN GLIDE",     paths: ["/barcode/pan_slew"],       min: 0.0,  max: 0.5, default: 0.033 },
  ]},
  { group: "ALL VOICES", options: [
    { label: "SWIRL L·R",     paths: _ALLV("pan"),           min: 0.0,  max: 1.0,  default: 0.5  },
    { label: "PITCH ALL",     paths: _ALLV("rate"),          min: 0.3,  max: 0.7,  default: 0.5  },
    { label: "WOBBLE ALL",    paths: _ALLV("pan_lfo"),       min: 0.95, max: 0.10, default: 0.85 },
    { label: "SHIMMER ALL",   paths: _ALLV("rate_lfo"),      min: 0.95, max: 0.25, default: 0.88 },
    { label: "DRIFT ALL",     paths: _ALLV("direction_lfo"), min: 0.95, max: 0.25, default: 0.90 },
    { label: "WANDER ALL",    paths: _ALLV("startend_lfo"),  min: 0.95, max: 0.25, default: 0.90 },
  ]},
  _audienceVoiceGroup(1), _audienceVoiceGroup(2), _audienceVoiceGroup(3),
  _audienceVoiceGroup(4), _audienceVoiceGroup(5), _audienceVoiceGroup(6),
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

  // --- Safe, fun transport toggles --------------------------------------
  // RECORDING + CLEAR BUF are vibe-killers, so they're performer-only now.
  // LFO SYNC (/param/quantize) just locks the wobbles together — can't hurt.
  buttons: {
    title: "PLAY",
    items: [
      { label: "REVERSE",  path: "/param/reverse",  type: "toggle" },
      { label: "LFO SYNC", path: "/param/quantize", type: "toggle" },
    ],
  },

  // --- XY Pads (the main attraction) -----------------------------------
  // Dropdowns are back — but they only offer AUDIENCE_AXIS_GROUPS (curated,
  // range-clamped, nothing that can stop the audio; see above). Each pad
  // starts on the classic TONE / SWIRL axes.
  xyPads: {
    title: "TOUCH PADS",
    items: [
      {
        label: "TONE",
        axisGroups: AUDIENCE_AXIS_GROUPS,
        defaultXPath: "/param/filter_frequency",   // DARK · BRIGHT
        defaultYPath: "/param/filter_reso",        // SPARKLE
      },
      {
        label: "SWIRL",
        axisGroups: AUDIENCE_AXIS_GROUPS,
        defaultXPath: "/barcode/v1/pan",           // SWIRL L·R (all voices)
        defaultYPath: "/barcode/v1/rate",          // PITCH ALL (all voices)
      },
    ],
  },

  // --- Movement sliders (pure motion, can't mute) ----------------------
  // These set how lively the built-in pan / pitch / direction wobble is.
  // min>max on purpose: slider LEFT = calm (slow LFO), slider RIGHT = lively
  // (fast LFO), so "drag right for more" reads intuitively. Capped so it
  // stays a vibe, never a seizure. GLIDE is the odd one out: it's rate slew
  // (how smeary pitch changes are), left = tight, right = molasses.
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
      { label: "DRIFT",
        paths: ["/barcode/v1/direction_lfo","/barcode/v2/direction_lfo","/barcode/v3/direction_lfo",
                "/barcode/v4/direction_lfo","/barcode/v5/direction_lfo","/barcode/v6/direction_lfo"],
        min: 0.95, max: 0.25, default: 0.90 },
      { label: "GLIDE",
        paths: ["/barcode/rate_slew"],
        min: 0.0, max: 0.5, default: 0.033 },
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
