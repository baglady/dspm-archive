// config.js — edit to change defaults without touching app code.
window.RYTM_CONFIG = {
  // Which tabs to show. Drum tracks 1..12, 'auto' = active-track tab,
  // 'fx' = the FX/comp/dist track, 'perf' = the 12 performance macros.
  tabs: ['auto', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 'fx', 'perf'],

  // Quick-access controls pinned above every tab. Wire-channel ids.
  pinned: ['fx/dlyMix', 'fx/revMix', 'fx/compMix'],

  // Bridge connection: '' = auto-resolve (?bridge= override, /proxy/<port>/,
  // then ws://<host>:8084). Or hardcode 'ws://192.168.1.50:8084'.
  bridge: '',

  // Use the browser's Web MIDI API directly instead of the bridge (single
  // device, no server). When true the page talks to the interface itself.
  useWebMidi: false,
};
