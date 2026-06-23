// midi-map.js — the single source of truth for the Octatrack control surface.
//
// This is the Octatrack (OS v1) MIDI "CC Direct Connect" map, taken from the
// MIDI Control Reference appendix of the Octatrack manual. It is the analogue of
// dspm-archive's norns channel manifest: every control the phone/web UI can show
// and everything the bridge knows how to send is derived from this one file.
//
// It loads in BOTH Node (bridge) and the browser (PWA) — see the UMD shim at the
// bottom. Edit here and both ends update.
//
// ---------------------------------------------------------------------------
// How the Octatrack receives this
// ---------------------------------------------------------------------------
// The OT has 8 AUDIO tracks and 8 MIDI tracks. Each AUDIO track listens on its
// own MIDI channel (PROJECT > MIDI > CHANNELS > AUDIO CH). The CCs below are the
// SAME for every audio track — the track is selected by the MIDI *channel* the
// message is sent on. So "Track 3 Pitch" = CC 16 on track 3's channel.
//
// There is also an AUTO channel: a CC sent on the AUTO channel hits whichever
// track is currently selected on the hardware. We expose it as track index 0
// ("AUTO") so a fader can drive "the active track".
//
// Some controls (crossfader, MIDI-track mutes/solos) are global and live on the
// AUTO channel regardless of audio-track channel assignment.
//
// VERIFY ON YOUR UNIT before trusting automation: confirm PROJECT > MIDI >
// CONTROL has "CC IN" enabled and that your AUDIO CH assignments match
// `defaultChannels` below. CC numbers are fixed by the OS; channel *assignment*
// is user-configurable.

// Each audio track responds to these CCs (identical across tracks; the channel
// picks the track). `bipolar:true` means the OT centre value is 64 and the UI
// should render -64..+63; otherwise it's a plain 0..127 absolute value.
const AUDIO_TRACK_PARAMS = [
  // --- Playback (PLAYBACK / SRC page) ---
  { id: 'pitch',     cc: 16, label: 'Pitch',       group: 'Playback', bipolar: true },
  { id: 'start',     cc: 17, label: 'Start',       group: 'Playback' },
  { id: 'length',    cc: 18, label: 'Length',      group: 'Playback' },
  { id: 'rate',      cc: 19, label: 'Rate',        group: 'Playback' },
  { id: 'retrig',    cc: 20, label: 'Retrig',      group: 'Playback' },
  { id: 'retrigTime',cc: 21, label: 'Retrig Time', group: 'Playback' },

  // --- Amp / AMP page ---
  { id: 'attack',    cc: 22, label: 'Amp Attack',  group: 'Amp' },
  { id: 'hold',      cc: 23, label: 'Amp Hold',    group: 'Amp' },
  { id: 'release',   cc: 24, label: 'Amp Release', group: 'Amp' },
  { id: 'volume',    cc: 25, label: 'Amp Volume',  group: 'Amp' },
  { id: 'balance',   cc: 26, label: 'Amp Balance', group: 'Amp', bipolar: true },

  // --- LFO designer (3 LFOs per track) ---
  { id: 'lfo1speed', cc: 28, label: 'LFO1 Speed',  group: 'LFO', bipolar: true },
  { id: 'lfo2speed', cc: 29, label: 'LFO2 Speed',  group: 'LFO', bipolar: true },
  { id: 'lfo3speed', cc: 30, label: 'LFO3 Speed',  group: 'LFO', bipolar: true },
  { id: 'lfo1depth', cc: 31, label: 'LFO1 Depth',  group: 'LFO', bipolar: true },
  { id: 'lfo2depth', cc: 32, label: 'LFO2 Depth',  group: 'LFO', bipolar: true },
  { id: 'lfo3depth', cc: 33, label: 'LFO3 Depth',  group: 'LFO', bipolar: true },

  // --- FX1 params 1-6 (meaning depends on the loaded effect; see FX_LEGENDS) ---
  { id: 'fx1p1', cc: 34, label: 'FX1 Param 1', group: 'FX1' },
  { id: 'fx1p2', cc: 35, label: 'FX1 Param 2', group: 'FX1' },
  { id: 'fx1p3', cc: 36, label: 'FX1 Param 3', group: 'FX1' },
  { id: 'fx1p4', cc: 37, label: 'FX1 Param 4', group: 'FX1' },
  { id: 'fx1p5', cc: 38, label: 'FX1 Param 5', group: 'FX1' },
  { id: 'fx1p6', cc: 39, label: 'FX1 Param 6', group: 'FX1' },

  // --- FX2 params 1-6 ---
  { id: 'fx2p1', cc: 40, label: 'FX2 Param 1', group: 'FX2' },
  { id: 'fx2p2', cc: 41, label: 'FX2 Param 2', group: 'FX2' },
  { id: 'fx2p3', cc: 42, label: 'FX2 Param 3', group: 'FX2' },
  { id: 'fx2p4', cc: 43, label: 'FX2 Param 4', group: 'FX2' },
  { id: 'fx2p5', cc: 44, label: 'FX2 Param 5', group: 'FX2' },
  { id: 'fx2p6', cc: 45, label: 'FX2 Param 6', group: 'FX2' },

  // --- Mixer / per-track ---
  { id: 'trackLevel', cc: 46, label: 'Track Level', group: 'Mixer' },
  { id: 'cueLevel',   cc: 47, label: 'Cue Level',   group: 'Mixer' },

  // --- Per-track momentary/state controls (0 = off, 127 = on) ---
  { id: 'mute',     cc: 49, label: 'Mute',     group: 'Track', toggle: true },
  { id: 'solo',     cc: 50, label: 'Solo',     group: 'Track', toggle: true },
  { id: 'cue',      cc: 51, label: 'Cue',      group: 'Track', toggle: true },
  { id: 'arm',      cc: 52, label: 'Arm',      group: 'Track', toggle: true },
  { id: 'recArm',   cc: 53, label: 'Recorder Arm', group: 'Track', toggle: true },
  { id: 'allArm',   cc: 54, label: 'All Arm',  group: 'Track', toggle: true },

  // Legacy/alternate level + balance CCs the OT also answers to.
  { id: 'trackLevelAlt', cc: 7, label: 'Track Level (alt CC7)', group: 'Mixer', hidden: true },
  { id: 'balanceAlt',    cc: 8, label: 'Balance (alt CC8)',     group: 'Mixer', hidden: true, bipolar: true },
];

// Controls that are global to the whole machine — sent on the AUTO channel, not
// per audio-track channel.
const GLOBAL_PARAMS = [
  { id: 'crossfader', cc: 48, label: 'Crossfader', group: 'Performance' },
  { id: 'sceneA',     cc: 55, label: 'Scene A Select', group: 'Performance' },
  { id: 'sceneB',     cc: 56, label: 'Scene B Select', group: 'Performance' },
];

// The OT's 8 MIDI sequencer tracks have global mute/solo CCs (received on the
// AUTO channel). One entry per MIDI track 1-8.
const MIDI_TRACK_CONTROLS = (() => {
  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push({ id: `midiMute${i + 1}`, cc: 112 + i, label: `MIDI T${i + 1} Mute`, group: 'MIDI Tracks', toggle: true });
  }
  for (let i = 0; i < 8; i++) {
    out.push({ id: `midiSolo${i + 1}`, cc: 120 + i, label: `MIDI T${i + 1} Solo`, group: 'MIDI Tracks', toggle: true });
  }
  return out;
})();

// Reference only: what FX1/FX2 params 1-6 mean per effect type. The OT sends the
// same CCs (34-45); the meaning depends on the effect loaded on the track. Used
// to relabel the FX faders in the UI when you tell it which effect is loaded.
const FX_LEGENDS = {
  'none':        ['—', '—', '—', '—', '—', '—'],
  'filter':      ['Base', 'Width', 'Q', 'Depth', 'Attack', 'Decay'],          // Filter (lo/hi/band)
  'eq':          ['Freq 1', 'Gain 1', 'Q 1', 'Freq 2', 'Gain 2', 'Q 2'],
  'dj-eq':       ['Low', 'Mid', 'High', '—', '—', '—'],
  'phaser':      ['Center', 'Depth', 'Speed', 'Feedback', 'Width', 'Mix'],
  'flanger':     ['Delay', 'Depth', 'Speed', 'Feedback', 'Width', 'Mix'],
  'chorus':      ['Delay', 'Depth', 'Speed', 'Feedback', 'Width', 'Mix'],
  'spatializer': ['Width', 'Sphere', 'Mix', '—', '—', '—'],
  'comb-filter': ['Pitch', 'Feedback', 'Lowpass', 'Mix', '—', '—'],
  'compressor':  ['Attack', 'Release', 'Threshold', 'Ratio', 'Gain', 'Mix'],
  'lo-fi':       ['Distortion', 'Amount', 'Sample Rate', 'Bit Rate', 'Drive', 'Mix'],
  'delay':       ['Time', 'Feedback', 'Volume', 'Width', 'Filter', 'Mix'],     // FX2-only
  'reverb':      ['Time', 'Damp', 'Gate', 'HP', 'LP', 'Mix'],                  // FX2-only
};

// Default per-track MIDI channel assignment. Audio tracks 1-8 -> channels 1-8.
// AUTO channel (currently-selected track + globals) -> channel 9.
const defaults = {
  audioChannels: [1, 2, 3, 4, 5, 6, 7, 8],
  autoChannel: 9,
};

// ---------------------------------------------------------------------------
// Channel expansion — the flat list of every controllable "channel" (the wire
// identifier, mirroring dspm's OSC paths). A channel id is `t<track>/<param>`
// for per-track params, `auto/<param>` for AUTO-channel params, and
// `global/<param>` for global/MIDI-track controls.
// ---------------------------------------------------------------------------
function expandChannels() {
  const channels = {};

  // per audio track 1..8
  for (let t = 1; t <= 8; t++) {
    for (const p of AUDIO_TRACK_PARAMS) {
      channels[`t${t}/${p.id}`] = { ...p, track: t, scope: 'audio' };
    }
  }
  // AUTO track (active track) — the same param set, channel = autoChannel
  for (const p of AUDIO_TRACK_PARAMS) {
    channels[`auto/${p.id}`] = { ...p, track: 'auto', scope: 'auto' };
  }
  // globals + MIDI-track controls (AUTO channel)
  for (const p of [...GLOBAL_PARAMS, ...MIDI_TRACK_CONTROLS]) {
    channels[`global/${p.id}`] = { ...p, track: 'auto', scope: 'global' };
  }
  return channels;
}

const MAP = {
  AUDIO_TRACK_PARAMS,
  GLOBAL_PARAMS,
  MIDI_TRACK_CONTROLS,
  FX_LEGENDS,
  defaults,
  expandChannels,
};

// UMD: CommonJS for the bridge, global for the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MAP;
} else if (typeof window !== 'undefined') {
  window.OT_MIDI_MAP = MAP;
}
