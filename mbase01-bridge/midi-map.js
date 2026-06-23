// midi-map.js — Jomox MBase 01 MIDI CC map
//
// !! VERIFY THESE CC NUMBERS AGAINST YOUR MANUAL !!
// The MBase 01 MIDI Implementation Chart is in the rear of the manual.
// CC numbers are 0-indexed as they appear on the wire (CC 14 = MIDI CC #14).
//
// The MBase 01 receives everything on one configurable MIDI channel.
// Any MIDI Note On on that channel fires the drum hit; velocity drives accent.
// The CCs below control synthesis parameters directly.
//
// UMD shim at bottom: loads as CommonJS (bridge) or window.MBASE01_MAP (PWA).

const PARAMS = [
  // ── Oscillator ──────────────────────────────────────────────────────────
  { id: 'tune',        cc: 14, label: 'Tune',      group: 'Osc',    bipolar: true  },
  { id: 'decay',       cc: 15, label: 'Decay',      group: 'Osc'                   },
  { id: 'accent',      cc: 16, label: 'Accent',     group: 'Osc',    note: 'Also driven by MIDI velocity' },

  // ── Pitch envelope ──────────────────────────────────────────────────────
  { id: 'pitchEnv',    cc: 17, label: 'Pitch Env',  group: 'P.Env'                 },
  { id: 'pitchEnvDec', cc: 18, label: 'P.Env Dec',  group: 'P.Env'                 },
  { id: 'punch',       cc: 19, label: 'Punch',       group: 'P.Env'                 },

  // ── Noise ───────────────────────────────────────────────────────────────
  { id: 'noise',       cc: 20, label: 'Noise',       group: 'Noise'                 },
  { id: 'noiseFilter', cc: 21, label: 'N.Filter',    group: 'Noise'                 },
  { id: 'distortion',  cc: 22, label: 'Distort',     group: 'Noise'                 },

  // ── Output processing ───────────────────────────────────────────────────
  { id: 'eqBass',      cc: 23, label: 'EQ Bass',     group: 'Output', bipolar: true  },
  { id: 'eqTreble',    cc: 24, label: 'EQ Treble',   group: 'Output', bipolar: true  },
  { id: 'compressor',  cc: 25, label: 'Comp',         group: 'Output'                },
];

// reverse lookup: cc number -> param object, and id -> param object
const ccToParam = {};
const byId      = {};
for (const p of PARAMS) { ccToParam[p.cc] = p; byId[p.id] = p; }

const MAP = { PARAMS, ccToParam, byId };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MAP;
} else if (typeof window !== 'undefined') {
  window.MBASE01_MAP = MAP;
}
