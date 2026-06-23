// midi-map.js — the single source of truth for the Analog Rytm control surface.
//
// This is the Elektron Analog Rytm (MKI) CC map, derived from Appendix C of the
// manual + midi.guide. It is the analogue of dspm-archive's norns channel
// manifest and the sibling octatrack-midi-control map: every control the
// phone/web UI shows and everything the bridge knows how to send is derived
// from this one file. Full research + sources: ../RYTM-MIDI.md.
//
// It loads in BOTH Node (bridge) and the browser (PWA) — see the UMD shim at the
// bottom. Edit here and both ends update.
//
// ---------------------------------------------------------------------------
// How the Rytm receives this
// ---------------------------------------------------------------------------
// The Rytm has 12 drum tracks (voices). Each track listens on its own MIDI
// channel (SETTINGS > MIDI CONFIG > CHANNELS). The per-track CCs below are the
// SAME for every track — the track is selected by the MIDI *channel* the message
// is sent on. So "SD Filter Freq" = CC 74 on track 2's channel.
//
//   - AUTO channel: a CC on the auto channel hits whichever track is currently
//     selected on the hardware (exposed as the 'auto' track).
//   - FX channel: the send effects (delay/reverb), master compressor and analog
//     distortion live here. Their CCs overlap the per-track numbers but the
//     channel disambiguates them.
//   - Performance macros (CC 35-47) drive the 12 perf-mode macros.
//
// VERIFY ON YOUR UNIT: confirm PORT CONFIG has CC/NRPN RECEIVE on and that your
// channel assignments match `defaults` below. CC numbers are fixed by the OS;
// channel assignment is user-configurable.

// Voice names for the 12 tracks (display only).
const VOICES = ['BD', 'SD', 'RS', 'CP', 'BT', 'LT', 'MT', 'HT', 'CH', 'OH', 'CY', 'CB'];

// Each drum track responds to these CCs (identical across tracks; the channel
// picks the track). `bipolar:true` => Rytm centre is 64, UI renders -64..+63.
// `toggle:true` => on/off control (0 / 127).
const TRACK_PARAMS = [
  // --- TRIG ---
  { id: 'trigNote', cc: 3,  label: 'Trig Note', group: 'Trig' },
  { id: 'trigVel',  cc: 4,  label: 'Velocity',  group: 'Trig' },
  { id: 'trigLen',  cc: 5,  label: 'Length',    group: 'Trig' },

  // --- SYNTH / SRC (machine-dependent; see RYTM-MIDI.md) ---
  { id: 'synP1',   cc: 16, label: 'Syn P1',   group: 'Synth' },
  { id: 'synTune', cc: 17, label: 'Tune',     group: 'Synth', bipolar: true },
  { id: 'synDecay',cc: 18, label: 'Decay',    group: 'Synth' },
  { id: 'synBal',  cc: 19, label: 'Bal/Tone', group: 'Synth' },
  { id: 'synP5',   cc: 20, label: 'Syn P5',   group: 'Synth' },
  { id: 'synP6',   cc: 21, label: 'Syn P6',   group: 'Synth' },
  { id: 'synP7',   cc: 22, label: 'Syn P7',   group: 'Synth' },
  { id: 'synP8',   cc: 23, label: 'Syn P8',   group: 'Synth' },

  // --- SAMPLE ---
  { id: 'smpTune',  cc: 24, label: 'Smp Tune', group: 'Sample', bipolar: true },
  { id: 'smpFine',  cc: 25, label: 'Smp Fine', group: 'Sample', bipolar: true },
  { id: 'smpBr',    cc: 26, label: 'Bit Red',  group: 'Sample' },
  { id: 'smpSlot',  cc: 27, label: 'Slot',     group: 'Sample' },
  { id: 'smpStart', cc: 28, label: 'Start',    group: 'Sample' },
  { id: 'smpEnd',   cc: 29, label: 'End',      group: 'Sample' },
  { id: 'smpLoop',  cc: 30, label: 'Loop',     group: 'Sample' },
  { id: 'smpLevel', cc: 31, label: 'Smp Lvl',  group: 'Sample' },

  // --- FILTER ---
  { id: 'fltAtk',  cc: 70, label: 'Flt Atk',  group: 'Filter' },
  { id: 'fltDec',  cc: 71, label: 'Flt Dec',  group: 'Filter' },
  { id: 'fltSus',  cc: 72, label: 'Flt Sus',  group: 'Filter' },
  { id: 'fltRel',  cc: 73, label: 'Flt Rel',  group: 'Filter' },
  { id: 'fltFreq', cc: 74, label: 'Cutoff',   group: 'Filter' },
  { id: 'fltReso', cc: 75, label: 'Reso',     group: 'Filter' },
  { id: 'fltType', cc: 76, label: 'Type',     group: 'Filter' },
  { id: 'fltEnv',  cc: 77, label: 'Env Depth',group: 'Filter', bipolar: true },

  // --- AMP ---
  { id: 'pan',     cc: 10, label: 'Pan',       group: 'Amp', bipolar: true },
  { id: 'ampAtk',  cc: 78, label: 'Amp Atk',   group: 'Amp' },
  { id: 'ampHold', cc: 79, label: 'Amp Hold',  group: 'Amp' },
  { id: 'ampDec',  cc: 80, label: 'Amp Dec',   group: 'Amp' },
  { id: 'ampOd',   cc: 81, label: 'Overdrive', group: 'Amp' },
  { id: 'ampDly',  cc: 82, label: 'Delay Snd', group: 'Amp' },
  { id: 'ampRev',  cc: 83, label: 'Reverb Snd',group: 'Amp' },
  { id: 'ampVol',  cc: 7,  label: 'Volume',    group: 'Amp' },

  // --- LFO ---
  { id: 'lfoSpeed', cc: 102, label: 'LFO Speed', group: 'LFO', bipolar: true },
  { id: 'lfoMult',  cc: 103, label: 'LFO Mult',  group: 'LFO' },
  { id: 'lfoFade',  cc: 104, label: 'LFO Fade',  group: 'LFO', bipolar: true },
  { id: 'lfoDest',  cc: 105, label: 'LFO Dest',  group: 'LFO' },
  { id: 'lfoWave',  cc: 106, label: 'LFO Wave',  group: 'LFO' },
  { id: 'lfoPhase', cc: 107, label: 'LFO Phase', group: 'LFO' },
  { id: 'lfoTrig',  cc: 108, label: 'LFO Trig',  group: 'LFO' },
  { id: 'lfoDepth', cc: 109, label: 'LFO Depth', group: 'LFO', bipolar: true },

  // --- TRACK (mix / state) ---
  { id: 'level', cc: 95, label: 'Track Lvl', group: 'Track' },
  { id: 'mute',  cc: 94, label: 'Mute',      group: 'Track', toggle: true },
  { id: 'solo',  cc: 93, label: 'Solo',      group: 'Track', toggle: true },
];

// FX track: send effects + master comp/distortion. Sent on the FX channel.
const FX_PARAMS = [
  // --- DELAY ---
  { id: 'dlyTime', cc: 16, label: 'Delay Time', group: 'Delay' },
  { id: 'dlyPing', cc: 17, label: 'Pingpong',   group: 'Delay', toggle: true },
  { id: 'dlyWidth',cc: 18, label: 'Width',      group: 'Delay', bipolar: true },
  { id: 'dlyFb',   cc: 19, label: 'Feedback',   group: 'Delay' },
  { id: 'dlyHp',   cc: 20, label: 'Highpass',   group: 'Delay' },
  { id: 'dlyLp',   cc: 21, label: 'Lowpass',    group: 'Delay' },
  { id: 'dlyRev',  cc: 22, label: '→Reverb',    group: 'Delay' },
  { id: 'dlyMix',  cc: 23, label: 'Delay Mix',  group: 'Delay' },

  // --- REVERB ---
  { id: 'revPre',  cc: 24, label: 'Predelay',   group: 'Reverb' },
  { id: 'revDec',  cc: 25, label: 'Decay',      group: 'Reverb' },
  { id: 'revFreq', cc: 26, label: 'Shelf Freq', group: 'Reverb' },
  { id: 'revGain', cc: 27, label: 'Shelf Gain', group: 'Reverb', bipolar: true },
  { id: 'revHp',   cc: 28, label: 'Highpass',   group: 'Reverb' },
  { id: 'revLp',   cc: 29, label: 'Lowpass',    group: 'Reverb' },
  { id: 'revMix',  cc: 31, label: 'Reverb Mix', group: 'Reverb' },

  // --- DISTORTION ---
  { id: 'distAmt', cc: 70, label: 'Dist Amt',   group: 'Distortion' },
  { id: 'distSym', cc: 71, label: 'Symmetry',   group: 'Distortion', bipolar: true },
  { id: 'distOd',  cc: 72, label: 'Overdrive',  group: 'Distortion' },

  // --- COMPRESSOR (master bus) ---
  { id: 'compThr', cc: 78, label: 'Threshold',  group: 'Compressor' },
  { id: 'compAtk', cc: 79, label: 'Attack',     group: 'Compressor' },
  { id: 'compRel', cc: 80, label: 'Release',    group: 'Compressor' },
  { id: 'compGain',cc: 81, label: 'Makeup',     group: 'Compressor' },
  { id: 'compRat', cc: 82, label: 'Ratio',      group: 'Compressor' },
  { id: 'compSc',  cc: 83, label: 'Sidechain',  group: 'Compressor' },
  { id: 'compMix', cc: 84, label: 'Dry/Wet',    group: 'Compressor' },
  { id: 'compVol', cc: 85, label: 'Out Vol',    group: 'Compressor' },
];

// Performance macros 1-12 → CC 35-47 (CC 38 skipped). Sent on the perf channel.
const PERF_PARAMS = (() => {
  const ccs = [35, 36, 37, 39, 40, 41, 42, 43, 44, 45, 46, 47];
  return ccs.map((cc, i) => ({ id: `perf${i + 1}`, cc, label: `Perf ${i + 1}`, group: 'Performance' }));
})();

// Default channel assignment. Tracks 1-12 -> channels 1-12, FX -> 13,
// performance -> 13 (shares the FX channel by default), AUTO -> 14.
// All overridable via env / the start scripts — VERIFY against your unit.
const defaults = {
  trackChannels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  fxChannel: 13,
  perfChannel: 13,
  autoChannel: 14,
};

// ---------------------------------------------------------------------------
// Channel expansion — the flat list of every controllable "channel" (the wire
// id, mirroring dspm's OSC paths). A channel id is:
//   t<n>/<param>   per drum track 1..12     (scope 'track')
//   auto/<param>   the active track          (scope 'auto')
//   fx/<param>     the FX track              (scope 'fx')
//   perf/<param>   performance macros        (scope 'perf')
// ---------------------------------------------------------------------------
function expandChannels() {
  const channels = {};
  for (let t = 1; t <= 12; t++) {
    for (const p of TRACK_PARAMS) channels[`t${t}/${p.id}`] = { ...p, track: t, scope: 'track' };
  }
  for (const p of TRACK_PARAMS) channels[`auto/${p.id}`] = { ...p, track: 'auto', scope: 'auto' };
  for (const p of FX_PARAMS)    channels[`fx/${p.id}`]   = { ...p, scope: 'fx' };
  for (const p of PERF_PARAMS)  channels[`perf/${p.id}`] = { ...p, scope: 'perf' };
  return channels;
}

const MAP = { VOICES, TRACK_PARAMS, FX_PARAMS, PERF_PARAMS, defaults, expandChannels };

// UMD: CommonJS for the bridge, global for the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MAP;
} else if (typeof window !== 'undefined') {
  window.RYTM_MIDI_MAP = MAP;
}
