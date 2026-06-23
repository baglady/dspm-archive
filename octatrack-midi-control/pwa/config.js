// config.js — edit to change defaults without touching app code.
window.OT_CONFIG = {
  // Which audio tracks to show tabs for (1..8). 'auto' = the active-track tab.
  tracks: ['auto', 1, 2, 3, 4, 5, 6, 7, 8],

  // Per-track FX type so FX1/FX2 faders get meaningful labels. Keys are track
  // numbers (or 'auto'); values are { fx1, fx2 } keys into the map's FX_LEGENDS.
  // Set what you actually have loaded on the OT; default is generic.
  fxTypes: {
    // 1: { fx1: 'filter', fx2: 'delay' },
  },

  // Quick-access "performance" controls pinned to every screen.
  pinned: ['global/crossfader', 'global/sceneA', 'global/sceneB'],

  // Bridge connection: '' = auto-resolve (?bridge= override, /proxy/<port>/,
  // then ws://<host>:8082). Or hardcode 'ws://192.168.1.50:8082'.
  bridge: '',

  // Use the browser's Web MIDI API directly instead of the bridge (single
  // device, no server). When true the page talks to the interface itself.
  useWebMidi: false,
};
