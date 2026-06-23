// ot-stem-bouncer.js — Max for Live engine (use in a [v8] or [js] object)
//
// Automates multitrack ("stem") bouncing of an Elektron Octatrack into Ableton
// Live by recording one track per pass. Each pass:
//   1. Soft-mutes 7 of 8 OT tracks (sends their level CC to 0, target to full)
//   2. Replays the recorded performance MIDI clip ("gesture clip")
//   3. Records the OT main-out audio track into a fresh clip slot for one loop
//   4. Stops, advances to the next track, repeats x8
//
// REQUIRED Live set layout (names are configurable below):
//   - A MIDI track named GESTURE_TRACK holding the recorded performance clip
//     in slot GESTURE_SCENE, output routed to the Octatrack's MIDI In.
//   - An audio track named AUDIO_TRACK receiving the OT main out, with >=8
//     empty clip slots starting at AUDIO_START_SCENE (one per pass).
//   - This device on its own MIDI track, routed to the OT's MIDI In, so its
//     [midiout] reaches the Octatrack.
//
// Patch wiring (minimal):
//   [live.button "start"] -> [t b] -> (js: "start")
//   [live.button "stop"]  -> (js: "stop")
//   js outlet 0 -> [midiout]                 // mute/level CCs to the OT
//   A [transport] or the Live API drives timing; we use the Live API only.
//
// VERIFY FIRST on your unit: the per-track "level"/amp CC numbers below are
// placeholders. In the OT: PROJECT > MIDI > CONTROL, find the CC each audio
// track's TRACK LEVEL (or AMP VOL) responds to, and set TRACK_LEVEL_CC + the
// per-track MIDI channels accordingly. Test by hand before trusting automation.

autowatch = 1;
outlets = 1; // outlet 0 -> [midiout]

// ---------- CONFIG: verify these against your Octatrack ----------
var TRACK_LEVEL_CC = 7;          // CC that controls a track's level (placeholder)
var TRACK_CHANNELS = [1,2,3,4,5,6,7,8]; // OT MIDI channel per audio track 1..8
var FULL = 127;                  // "unmuted" level
var MUTED = 0;                   // "muted" level
var NUM_TRACKS = 8;

// ---------- CONFIG: Live set layout ----------
var GESTURE_TRACK = "OT Gesture";   // MIDI track w/ recorded performance clip
var GESTURE_SCENE = 0;              // 0-based clip slot index of the gesture clip
var AUDIO_TRACK   = "OT Main In";  // audio track receiving OT main out
var AUDIO_START_SCENE = 0;          // first slot to write stem 1 into (0-based)

// ---------- internal state ----------
var passIndex = -1;     // 0..NUM_TRACKS-1, -1 = idle
var running = false;
var loopBeats = 0;      // length of the gesture clip in beats
var watcher = null;     // LiveAPI observer on song playing position

function bang() { start(); }

function start() {
  if (running) { post("already running\n"); return; }
  var glen = gestureLengthBeats();
  if (glen <= 0) { post("ERROR: could not read gesture clip length\n"); return; }
  loopBeats = glen;
  running = true;
  passIndex = -1;
  post("OT Stem Bouncer: starting " + NUM_TRACKS + " passes, " + loopBeats + " beats each\n");
  nextPass();
}

function stop() {
  running = false;
  passIndex = -1;
  if (watcher) { watcher.property = ""; watcher = null; }
  var song = new LiveAPI("live_set");
  song.call("stop_playing");
  // unmute everything so the OT is left in a usable state
  for (var t = 0; t < NUM_TRACKS; t++) setTrackLevel(t, FULL);
  post("OT Stem Bouncer: stopped\n");
}

function nextPass() {
  if (!running) return;
  passIndex++;
  if (passIndex >= NUM_TRACKS) {
    post("OT Stem Bouncer: done — " + NUM_TRACKS + " stems captured\n");
    stop();
    return;
  }

  // 1. isolate this track on the OT
  for (var t = 0; t < NUM_TRACKS; t++) {
    setTrackLevel(t, (t === passIndex) ? FULL : MUTED);
  }
  post("pass " + (passIndex + 1) + "/" + NUM_TRACKS + ": isolating OT track " + (passIndex + 1) + "\n");

  // 2. arm + record the audio clip slot for this pass
  var audioTrackId = findTrackByName(AUDIO_TRACK);
  if (audioTrackId === null) { post("ERROR: audio track not found\n"); stop(); return; }
  var slot = AUDIO_START_SCENE + passIndex;

  // 3. launch gesture clip + audio record on the next bar, then wait one loop
  var song = new LiveAPI("live_set");
  song.set("start_time", 0);

  var gestureTrackId = findTrackByName(GESTURE_TRACK);
  if (gestureTrackId === null) { post("ERROR: gesture track not found\n"); stop(); return; }

  // fire the gesture clip and the record-enabled audio slot
  var gestureSlot = new LiveAPI("id " + gestureTrackId);
  gestureSlot = new LiveAPI("live_set tracks " + trackIndexByName(GESTURE_TRACK) + " clip_slots " + GESTURE_SCENE);
  var audioSlot = new LiveAPI("live_set tracks " + trackIndexByName(AUDIO_TRACK) + " clip_slots " + slot);

  // start transport from top, fire both clips
  song.call("stop_playing");
  song.set("current_song_time", 0);
  gestureSlot.call("fire");
  audioSlot.call("fire");   // firing an empty armed slot starts recording
  song.call("start_playing");

  // 4. schedule end-of-pass after loopBeats (+ small tail) of musical time
  scheduleEndOfPass();
}

// Use a Live API observer on the song's beat position to detect loop completion.
function scheduleEndOfPass() {
  if (watcher) { watcher.property = ""; watcher = null; }
  var startBeat = currentBeat();
  watcher = new LiveAPI(function (args) {
    if (!running) return;
    var b = currentBeat();
    if (b - startBeat >= loopBeats) {
      // stop this audio clip recording, then advance
      var audioSlot = new LiveAPI("live_set tracks " + trackIndexByName(AUDIO_TRACK) +
                                  " clip_slots " + (AUDIO_START_SCENE + passIndex));
      audioSlot.call("stop");
      var song = new LiveAPI("live_set");
      song.call("stop_playing");
      if (watcher) { watcher.property = ""; watcher = null; }
      nextPass();
    }
  }, "live_set");
  watcher.property = "current_song_time";
}

// ---------- helpers ----------
function setTrackLevel(trackIdx, value) {
  var ch = TRACK_CHANNELS[trackIdx];           // 1..16
  var status = 0xB0 + (ch - 1);                // CC on channel
  outlet(0, [status, TRACK_LEVEL_CC, value]);
}

function currentBeat() {
  var song = new LiveAPI("live_set");
  return parseFloat(song.get("current_song_time"));
}

function gestureLengthBeats() {
  var idx = trackIndexByName(GESTURE_TRACK);
  if (idx < 0) return -1;
  var clip = new LiveAPI("live_set tracks " + idx + " clip_slots " + GESTURE_SCENE + " clip");
  if (!clip.id || clip.id === "0") return -1;
  return parseFloat(clip.get("length"));
}

function trackIndexByName(name) {
  var live = new LiveAPI("live_set");
  var count = live.getcount("tracks");
  for (var i = 0; i < count; i++) {
    var t = new LiveAPI("live_set tracks " + i);
    if (t.get("name").toString() === name) return i;
  }
  return -1;
}

function findTrackByName(name) {
  var idx = trackIndexByName(name);
  if (idx < 0) return null;
  var t = new LiveAPI("live_set tracks " + idx);
  return t.id;
}
