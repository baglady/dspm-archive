// ============================================================
// DSPM project status — single source of truth for the board.
// Edit this file, refresh index.html. That's the whole workflow.
//
// stage:  "idea" | "building" | "needs-testing" | "tested" | "live" | "parked"
//   idea          — plan exists, no working code yet
//   building      — code being written, not yet exercised
//   needs-testing — built, but not verified (or changed since last verify)
//   tested        — verified at home / on the bench
//   live          — battle-tested at a real show or deployed & in use
//   parked        — superseded or on ice
//
// area:   "show-rig" | "norns" | "midi-gear" | "visuals" | "ai-tools"
//         | "infra" | "skills" | "audio-tools"
//
// tested / untested: short human strings, shown as ✅ / ⬜ checklists.
// updated: last time YOU touched or verified it (yyyy-mm-dd).
// ============================================================

window.PROJECTS = [

  // ---------- the core show rig ----------
  {
    name: "Bridge + audience/performer PWA",
    area: "show-rig",
    stage: "live",
    updated: "2026-07-07",
    tested: [
      "dspm2 + dspm3 real shows",
      "phone → WS → OSC → norns end to end",
      "feedback return leg (:10112)",
      "admin-token gating on mutating /api",
      "params.html flat controller (slider → bridge tick verified local, 2026-07-07)",
      "hub.html LAN hub (projects + doc reader verified local, 2026-07-07)",
    ],
    untested: [
      "params.html against the physical norns",
      "hub.html on the GL router from a phone",
    ],
    note: "The heart of everything. dspm3 audience build is locked-down idiotproof; performer.html keeps full control. NEW: params.html (every param, flat) + hub.html (offline LAN dashboard, /doc/ readme reader).",
    links: ["bridge/", "pwa/"],
  },
  {
    name: "Session archive + playback",
    area: "show-rig",
    stage: "needs-testing",
    updated: "2026-07-05",
    tested: ["session capture (manifest + jsonl) at shows"],
    untested: [
      "playback scoped to recording window (commit 06a2cd0, fresh)",
      "tape audio sync against a real multi-take session",
    ],
    note: "Playback-window + tape-sync change just landed — replay a real session before trusting it.",
    links: ["pwa/archive.html", "sessions/"],
  },
  {
    name: "Woods LAN rig (go-lan.ps1 + travel router)",
    area: "show-rig",
    stage: "needs-testing",
    updated: "2026-07-01",
    tested: [
      "bridge deps present offline (verified 2026-07-01)",
      "7-script forest rig launch (2026-07-01)",
    ],
    untested: [
      "full WOODS-CHECKLIST §1–3 with internet OFF",
      "tape-pull SSH key pushed to physical norns",
      "auto-join killed on all other saved Wi-Fi",
    ],
    note: "THE pre-show gate: XY pad → norns responds, with Wi-Fi off. Wrong-Wi-Fi is the #1 documented showtime failure.",
    links: ["WOODS-CHECKLIST.md", "go-lan.ps1"],
  },
  {
    name: "Woods radio (icecast+darkice on physical norns)",
    area: "show-rig",
    stage: "idea",
    updated: "2026-07-04",
    tested: [],
    untested: [
      "Phase 0 prereqs (apt install, port 8000 free)",
      "Phase 1 icecast on norns",
      "Phase 2 darkice + 5-min stress test (go/no-go gate)",
    ],
    note: "Plan written, zero boxes checked. Would delete the last 'dead in the woods' item.",
    links: ["docs/PLAN-woods-radio.md"],
  },
  {
    name: "Venue repeater setup",
    area: "show-rig",
    stage: "tested",
    updated: "2026-06-21",
    tested: ["documented + used for venue shows"],
    untested: [],
    note: "",
    links: ["VENUE-REPEATER-SETUP.md", "RUNBOOK-LAN.md"],
  },

  // ---------- infra / deploy ----------
  {
    name: "Debian box deploy (babayaga + Cloudflare tunnel)",
    area: "infra",
    stage: "live",
    updated: "2026-06-28",
    tested: ["dspm.hetti.be serving PWA", "systemd services survive reboot"],
    untested: [],
    note: "",
    links: ["DEPLOY-DEBIAN.md", "deploy/"],
  },
  {
    name: "Norns in Docker on babayaga",
    area: "infra",
    stage: "live",
    updated: "2026-06-29",
    tested: [
      "systemd dspm-norns, bridge drives it over loopback",
      "darkice → radio.hetti.be/norns.mp3",
      "TESTDAY checklist run",
    ],
    untested: [],
    note: "Co-located Phase 2 achieved. Known gotchas documented (SUPERCOLLIDER-FAIL, host-net, npm pin).",
    links: ["deploy/norns-docker/", "deploy/norns-docker/TESTDAY.md"],
  },
  {
    name: "dash.hetti.be dashboard",
    area: "infra",
    stage: "live",
    updated: "2026-07-02",
    tested: ["serving at dash.hetti.be", "service URLs corrected"],
    untested: [],
    note: "Internet-only; dead in the woods by design.",
    links: ["pwa/dashboard.html"],
  },
  {
    name: "nohost migration (admin.hetti.be, drop DynDNS)",
    area: "infra",
    stage: "idea",
    updated: "2026-06-30",
    tested: [],
    untested: ["all 7 steps of the plan"],
    note: "Eliminates the home-IP leak from babayaga.nohost.me.",
    links: [],
  },
  {
    name: "Telegram bot (dspm-claude-bot)",
    area: "infra",
    stage: "building",
    updated: "2026-07-05",
    tested: [],
    untested: ["bot responds at all", "systemd service on babayaga"],
    note: "Untracked in git — commit it or lose it.",
    links: ["telegram-bot/"],
  },

  // ---------- norns / audio ----------
  {
    name: "dspm-playalong-v2 (7-script forest rig)",
    area: "norns",
    stage: "tested",
    updated: "2026-07-01",
    tested: ["full 7-script launch (barcode/oooooo/passersby/molly/awake/cranes/mangl), 2026-07-01"],
    untested: ["a full-length rehearsal in one sitting"],
    note: "Supersedes dspm-playalong v1.",
    links: ["../dspm-playalong-v2/"],
  },
  {
    name: "dspm-playalong v1",
    area: "norns",
    stage: "parked",
    updated: "2026-06-15",
    tested: [],
    untested: [],
    note: "Superseded by v2.",
    links: ["../dspm-playalong/"],
  },
  {
    name: "Per-script controllers (awake, cranes, mangl, molly, oooooo, passersby)",
    area: "norns",
    stage: "tested",
    updated: "2026-07-01",
    tested: ["generated via norns-osc-control, exercised in forest-rig test"],
    untested: [],
    note: "Six sibling folders, one pipeline.",
    links: ["../oooooo-control/", "../passersby-control/"],
  },
  {
    name: "Render pipeline (render-viz / master / dvd)",
    area: "norns",
    stage: "tested",
    updated: "2026-06-21",
    tested: ["session-vs-reference time-base fixed; empty-video + misalignment bugs killed 2026-06-21"],
    untested: [],
    note: "",
    links: [],
  },
  {
    name: "Octatrack stem bouncer",
    area: "audio-tools",
    stage: "needs-testing",
    updated: "2026-06-25",
    tested: [],
    untested: ["a real stem bounce off the OT"],
    note: "Single script, no test notes found — verify and update me.",
    links: ["octatrack-stem-bouncer/"],
  },
  {
    name: "dj-id (Shazam for DJs)",
    area: "audio-tools",
    stage: "needs-testing",
    updated: "2026-06-26",
    tested: ["builtin engine on sample mixes"],
    untested: [
      "Panako engine",
      "audfprint engine",
      "cue/snippets/EDL/render outputs on a full-length mix",
    ],
    note: "⚠ tested-status is my guess — correct me.",
    links: ["dj-id/README.md"],
  },
  {
    name: "transient-chop.py",
    area: "audio-tools",
    stage: "building",
    updated: "2026-07-05",
    tested: [],
    untested: ["everything"],
    note: "Untracked in git.",
    links: ["tools/transient-chop.py"],
  },

  // ---------- midi gear ----------
  {
    name: "Octatrack MIDI control surface",
    area: "midi-gear",
    stage: "needs-testing",
    updated: "2026-06-27",
    tested: ["full CC map written (midi-map.js)"],
    untested: ["against the physical OT", "phone → bridge → MIDI latency feel"],
    note: "",
    links: ["octatrack-midi-control/"],
  },
  {
    name: "Analog Rytm control surface",
    area: "midi-gear",
    stage: "needs-testing",
    updated: "2026-06-27",
    tested: ["full CC map written"],
    untested: ["against the physical Rytm MKI"],
    note: "",
    links: ["analog-rytm-control/"],
  },
  {
    name: "MBase 01 bridge (12-knob PWA)",
    area: "midi-gear",
    stage: "needs-testing",
    updated: "2026-06-27",
    tested: [],
    untested: ["sequencer MIDI passthrough (Rytm/OT)", "parameter control on hardware"],
    note: "Runs on laptop or Pi.",
    links: ["mbase01-bridge/"],
  },
  {
    name: "Gear integration (OT + Organelle M + CME USB-host)",
    area: "midi-gear",
    stage: "idea",
    updated: "2026-06-24",
    tested: [],
    untested: [],
    note: "Plan lives in the Obsidian vault (dspm-gear-integration.md).",
    links: [],
  },

  // ---------- visuals ----------
  {
    name: "TouchDesigner reactive visuals",
    area: "visuals",
    stage: "needs-testing",
    updated: "2026-06-28",
    tested: ["network builds from the Python script"],
    untested: ["Overbridge audio reactivity live", "bridge OSC input during a real set"],
    note: "",
    links: ["touchdesigner/"],
  },
  {
    name: "Infographics (dspm2 slides + offline-test set)",
    area: "visuals",
    stage: "building",
    updated: "2026-07-05",
    tested: [],
    untested: [],
    note: "dspm2-offline-test folder untracked in git.",
    links: ["infographics/"],
  },

  // ---------- ai tools ----------
  {
    name: "Forest AI assistant (offline rig troubleshooter)",
    area: "ai-tools",
    stage: "tested",
    updated: "2026-07-01",
    tested: ["evals run (kb/eval-results.md)", "live network scan + gemma3:4b on D:\\ollama"],
    untested: ["a real mid-show panic scenario, offline"],
    note: "",
    links: ["tools/forest-ai/"],
  },
  {
    name: "dspm-gear-feed (research → Obsidian → reader magazine)",
    area: "ai-tools",
    stage: "tested",
    updated: "2026-06-30",
    tested: ["'run an issue' end to end into reader.html"],
    untested: [],
    note: "",
    links: ["../dspm-gear-feed/"],
  },

  // ---------- reusable skills ----------
  {
    name: "norns-osc-control skill",
    area: "skills",
    stage: "tested",
    updated: "2026-07-01",
    tested: ["generated 6+ working controllers"],
    untested: [],
    note: "",
    links: ["../norns-osc-control/"],
  },
  {
    name: "midi-control-surface skill",
    area: "skills",
    stage: "tested",
    updated: "2026-06-27",
    tested: ["generated OT / Rytm / MBase surfaces"],
    untested: ["(the surfaces themselves still need hardware testing)"],
    note: "",
    links: ["../midi-control-surface/"],
  },
  {
    name: "reactive-visuals skill",
    area: "skills",
    stage: "needs-testing",
    untested: ["generalized pipeline on a second project"],
    tested: ["extracted from the TouchDesigner build"],
    updated: "2026-06-29",
    note: "",
    links: ["../reactive-visuals/"],
  },
  {
    name: "dspm-archive-analysis skill",
    area: "ai-tools",
    stage: "tested",
    updated: "2026-06-23",
    tested: ["contextualized recorded takes (Dspm2)"],
    untested: [],
    note: "",
    links: [],
  },
];
