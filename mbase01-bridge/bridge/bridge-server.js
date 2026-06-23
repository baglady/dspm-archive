// bridge-server.js — Analog Rytm / Octatrack -> Node -> Jomox MBase 01
//
// Signal flow:
//
//   MIDI IN (Rytm/OT, merged)  ──► bridge ──► MIDI OUT (MBase 01, one channel)
//   PWA WebSocket               ──►        ──/
//
// The bridge owns the single MIDI OUT port, so the sequencer and the web
// control page can both drive the MBase 01 without port conflicts.
//
// Incoming MIDI is *routed*, not blindly forwarded (the OT + Rytm are merged
// into one input and told apart by MIDI channel — see routing.json):
//   - Note-on/off on a channel listed in `triggerChannels` fires the MBase 01:
//     the note is re-channeled onto the MBase channel, velocity drives accent.
//   - CCs are remapped: each `ccRoutes` entry maps a source {ch, cc} to an
//     MBase parameter (CC 14–25), re-channeled onto the MBase channel, and the
//     PWA fader for that param follows.
//   - `passthrough` (off by default) forwards anything unmatched as-is.
// Every incoming message is also echoed to the PWA as a live MIDI monitor, so
// you can see what each device sends and "Learn" routes straight from it.
//
// Three runtime features beyond routing:
//   - Live MIDI port picker: GET /ports lists everything connected; POST /ports
//     reopens the in/out ports without a restart (so you just plug in your
//     interface and pick it from the UI).
//   - Live routing: GET /routing returns the config; PUT /routing replaces it
//     (validated + persisted to routing.json), no restart needed.
//   - Server-side presets: GET/PUT/DELETE /presets[/name] store named knob
//     snapshots as JSON under presets/, shared across every device.
//
// Env vars (all optional — defaults work for a single-laptop setup):
//   BRIDGE_WS_PORT    8083   HTTP + WebSocket port (serves PWA on same port)
//   MIDI_IN_PORT      ''     substring match for MIDI input name; '' = first port
//   MIDI_OUT_PORT     ''     substring match for MIDI output name; '' = first port
//   MIDI_VIRTUAL      0      1 = open named virtual ports (macOS/Linux only)
//   MBASE01_CHANNEL   10     MIDI channel MBase 01 listens on (1-based, 1–16)
//   PWA_DIR           ../pwa     ('' disables static serving)
//   PRESETS_DIR       ../presets
//   ROUTING_FILE      ../routing.json

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const MAP  = require('../midi-map.js');

// ── Config ──────────────────────────────────────────────────────────────────
const MBASE01_CH = (parseInt(process.env.MBASE01_CHANNEL || '10', 10) - 1); // 0-based
const PORT    = parseInt(process.env.BRIDGE_WS_PORT || '8083', 10);
const PWA_DIR = process.env.PWA_DIR === undefined
  ? path.join(__dirname, '..', 'pwa')
  : process.env.PWA_DIR;
const PRESETS_DIR = process.env.PRESETS_DIR || path.join(__dirname, '..', 'presets');
const ROUTING_FILE = process.env.ROUTING_FILE || path.join(__dirname, '..', 'routing.json');

fs.mkdirSync(PRESETS_DIR, { recursive: true });

// ── Routing: how merged OT/Rytm MIDI maps onto the single MBase 01 channel ────
//   triggerChannels  1-based source channels whose note-ons fire the drum
//   ccRoutes         [{ ch, cc, param, invert }] source CC -> MBase param (CC)
//                    ch null/omitted = match any channel; param is a midi-map id
//   passthrough      forward unmatched messages as-is (off by default)
const DEFAULT_ROUTING = { triggerChannels: [], ccRoutes: [], passthrough: false };

function sanitizeRouting(body = {}, base = DEFAULT_ROUTING) {
  const triggerChannels = Array.isArray(body.triggerChannels)
    ? [...new Set(body.triggerChannels.map(n => parseInt(n, 10))
        .filter(n => Number.isInteger(n) && n >= 1 && n <= 16))]
    : base.triggerChannels;
  const ccRoutes = Array.isArray(body.ccRoutes)
    ? body.ccRoutes.map(r => ({
        ch: (r.ch === null || r.ch === undefined || r.ch === '')
          ? null : Math.min(16, Math.max(1, parseInt(r.ch, 10))),
        cc: Math.min(127, Math.max(0, parseInt(r.cc, 10))),
        param: String(r.param || ''),
        invert: !!r.invert,
      })).filter(r => Number.isInteger(r.cc) && MAP.byId[r.param])
    : base.ccRoutes;
  const passthrough = typeof body.passthrough === 'boolean' ? body.passthrough : base.passthrough;
  return { triggerChannels, ccRoutes, passthrough };
}

function loadRouting() {
  try { return sanitizeRouting(JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8'))); }
  catch { return { ...DEFAULT_ROUTING }; }
}
function saveRouting() {
  try { fs.writeFileSync(ROUTING_FILE, JSON.stringify(routing, null, 2)); }
  catch (e) { console.warn(`[routing] could not persist: ${e.message}`); }
}

let routing = loadRouting();

// ── MIDI manager (openable/reopenable at runtime) ────────────────────────────
// `midi.in`/`midi.out` are easymidi objects (or a dry-run stub). The PWA can
// switch ports live via POST /ports, which closes and reopens them.
let easymidi = null;
try { easymidi = require('easymidi'); }
catch (e) { console.warn(`[midi] easymidi unavailable (${e.message}); dry-run only.`); }

const DRY_OUT = {
  send(type, msg) { console.log(`[dry-run] ${type} ch${(msg.channel ?? 0) + 1} ${JSON.stringify(msg)}`); },
  close() {},
};

const midi = {
  in: null, out: DRY_OUT,
  inName: null, outName: null,
  backend: 'dry-run',
};

function listPorts() {
  if (!easymidi) return { inputs: [], outputs: [] };
  try { return { inputs: easymidi.getInputs(), outputs: easymidi.getOutputs() }; }
  catch { return { inputs: [], outputs: [] }; }
}

// When no port is specified, prefer a real hardware interface over Windows'
// built-in software synth (which is otherwise first in the list).
function pickDefault(names) {
  const real = names.find(n => !/wavetable|gs wavetable|microsoft gs/i.test(n));
  return real || names[0];
}

// Guarded MIDI send: a transient hardware error (port unplugged, the H4MIDI WC's
// router momentarily reconfigured, etc.) must not crash the bridge. We log it,
// rate-limited, and drop the message — the next one will go through once the port
// recovers. Use this for EVERY outbound MIDI message.
let lastSendErr = 0;
function safeSend(type, msg) {
  try {
    midi.out.send(type, msg);
  } catch (e) {
    const now = Date.now();
    if (now - lastSendErr > 1000) {  // at most one line/sec to avoid log floods
      lastSendErr = now;
      console.warn(`[midi] send failed (${e.message}) on "${midi.outName || 'dry-run'}"; dropping. Check the H4MIDI WC router/port.`);
    }
  }
}

// Wire a freshly opened Input's events through the router to the MBase + PWA.
function bindInput(input) {
  input.on('noteon',  m => routeNote('noteon',  m));
  input.on('noteoff', m => routeNote('noteoff', m));
  input.on('cc',      m => routeCC(m));
  ['pitchbend', 'program', 'poly aftertouch', 'channel aftertouch'].forEach(t => {
    try { input.on(t, m => { if (routing.passthrough) safeSend(t, m); }); } catch {}
  });
}

// Note-on/off: fire the MBase if the source channel is a trigger channel
// (re-channeled so the one-channel MBase hears it); else optional passthrough.
function routeNote(type, m) {
  monitor({ mtype: type, channel: m.channel, note: m.note, velocity: m.velocity });
  if (routing.triggerChannels.includes(m.channel + 1)) {
    safeSend(type, { ...m, channel: MBASE01_CH });
  } else if (routing.passthrough) {
    safeSend(type, m);
  }
}

// CC: remap every matching source {ch, cc} onto its MBase param CC.
function routeCC(m) {
  monitor({ mtype: 'cc', channel: m.channel, controller: m.controller, value: m.value });
  let matched = false;
  for (const r of routing.ccRoutes) {
    if (r.cc !== m.controller) continue;
    if (r.ch != null && r.ch !== m.channel + 1) continue;
    const param = MAP.byId[r.param];
    if (!param) continue;
    const value = r.invert ? 127 - m.value : m.value;
    safeSend('cc', { channel: MBASE01_CH, controller: param.cc, value });
    ccState[param.cc] = value;
    broadcast({ type: 'cc', cc: param.cc, value });
    matched = true;
  }
  if (!matched && routing.passthrough) safeSend('cc', m);
}

// Live MIDI monitor → PWA (so you can see what each device sends, and Learn
// routes from it). CC traffic is throttled so a knob sweep can't flood clients.
let lastMonCC = 0;
function monitor(info) {
  if (clients.size === 0) return;
  if (info.mtype === 'cc') {
    const now = Date.now();
    if (now - lastMonCC < 25) return;
    lastMonCC = now;
  }
  broadcast({
    type: 'midi', dir: 'in',
    mtype: info.mtype,
    channel: (info.channel ?? 0) + 1,
    note: info.note, velocity: info.velocity,
    controller: info.controller, value: info.value,
  });
}

// Open (or reopen) the MIDI ports. Pass substrings to match; null/'' = leave as
// current, '__none__' = close. Returns the resulting status.
function openPorts({ inWant, outWant } = {}) {
  if (!easymidi) {
    midi.backend = 'dry-run'; midi.out = DRY_OUT; midi.inName = null; midi.outName = null;
    return status();
  }
  const virtual = process.env.MIDI_VIRTUAL === '1';
  const { inputs, outputs } = listPorts();

  // ---- output ----  (a busy/failing port must not crash the bridge: WinMM MIDI
  //      ports are exclusive, so the device may be held by HxMIDI Tools or another
  //      app. On failure we leave the output as dry-run and let the user retry.)
  if (outWant !== undefined && outWant !== null) {
    try { if (midi.out && midi.out.close) midi.out.close(); } catch {}
    if (outWant === '__none__') { midi.out = DRY_OUT; midi.outName = null; }
    else if (virtual) {
      try { midi.out = new easymidi.Output('MBase01 Bridge Out', true); midi.outName = '(virtual)'; }
      catch (e) { console.warn(`[midi] virtual out failed (${e.message})`); midi.out = DRY_OUT; midi.outName = null; }
    } else {
      const want = String(outWant).trim();
      const name = want
        ? (outputs.find(n => n.toLowerCase().includes(want.toLowerCase())) || pickDefault(outputs))
        : pickDefault(outputs);   // empty -> auto-pick (skip the software synth)
      if (name) {
        try { midi.out = new easymidi.Output(name); midi.outName = name; }
        catch (e) { console.warn(`[midi] could not open output "${name}" (${e.message}); it may be in use. Using dry-run.`); midi.out = DRY_OUT; midi.outName = null; }
      } else { midi.out = DRY_OUT; midi.outName = null; }
    }
  }

  // ---- input ----
  if (inWant !== undefined && inWant !== null) {
    try { if (midi.in && midi.in.close) midi.in.close(); } catch {}
    midi.in = null;
    if (inWant === '__none__') { midi.inName = null; }
    else if (virtual) {
      try { midi.in = new easymidi.Input('MBase01 Bridge In', true); bindInput(midi.in); midi.inName = '(virtual)'; }
      catch (e) { console.warn(`[midi] virtual in failed (${e.message})`); midi.in = null; midi.inName = null; }
    } else {
      const name = inputs.find(n => n.toLowerCase().includes(String(inWant).toLowerCase())) || inputs[0];
      if (name) {
        try { midi.in = new easymidi.Input(name); bindInput(midi.in); midi.inName = name; }
        catch (e) { console.warn(`[midi] could not open input "${name}" (${e.message}); it may be in use (HxMIDI Tools? another app?). Skipping input.`); midi.in = null; midi.inName = null; }
      }
    }
  }

  midi.backend = (midi.outName || midi.inName)
    ? `easymidi(in:${midi.inName || '-'} out:${midi.outName || '-'})`
    : 'dry-run';
  return status();
}

function status() {
  const { inputs, outputs } = listPorts();
  return { inputs, outputs, inName: midi.inName, outName: midi.outName, backend: midi.backend };
}

// ── State: latest CC value per CC number (raw 0–127, for new-client sync) ──
const ccState = {};  // cc# -> 0-127

// ── WebSocket clients ────────────────────────────────────────────────────────
const clients = new Set();
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1) c.send(s);
}

// ── PWA → MIDI CC ────────────────────────────────────────────────────────────
function sendCC(cc, value) {
  const v = Math.max(0, Math.min(127, Math.round(value)));
  safeSend('cc', { channel: MBASE01_CH, controller: cc, value: v });
  ccState[cc] = v;
}

// ── preset storage helpers ───────────────────────────────────────────────────
const safeName = n => /^[\w -]{1,48}$/.test(n);  // letters, digits, _, -, space
const presetFile = n => path.join(PRESETS_DIR, `${n}.json`);

function listPresets() {
  try {
    return fs.readdirSync(PRESETS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.slice(0, -5));
  } catch { return []; }
}

// ── HTTP body reader ──────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

  // ---- MIDI ports: list / select ----
  if (u.pathname === '/ports') {
    if (req.method === 'GET') return json(200, status());
    if (req.method === 'POST') {
      const body = await readBody(req).then(s => { try { return JSON.parse(s); } catch { return {}; } });
      const st = openPorts({ inWant: body.in, outWant: body.out });
      broadcast({ type: 'ports', ...st });
      return json(200, st);
    }
  }

  // ---- routing: get / replace (channel triggers + CC remap) ----
  if (u.pathname === '/routing') {
    if (req.method === 'GET') return json(200, routing);
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req).then(s => { try { return JSON.parse(s); } catch { return {}; } });
      routing = sanitizeRouting(body, routing);
      saveRouting();
      broadcast({ type: 'routing', routing });
      return json(200, routing);
    }
  }

  // ---- presets: list / get / save / delete ----
  if (u.pathname === '/presets' && req.method === 'GET') {
    return json(200, { presets: listPresets() });
  }
  if (u.pathname.startsWith('/presets/')) {
    const name = decodeURIComponent(u.pathname.slice('/presets/'.length));
    if (!safeName(name)) return json(400, { error: 'bad preset name' });
    if (req.method === 'GET') {
      try { return json(200, JSON.parse(fs.readFileSync(presetFile(name), 'utf8'))); }
      catch { return json(404, { error: 'not found' }); }
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req).then(s => { try { return JSON.parse(s); } catch { return null; } });
      if (!body || typeof body.values !== 'object') return json(400, { error: 'expected {values}' });
      const rec = { name, values: body.values, savedAt: new Date().toISOString() };
      fs.writeFileSync(presetFile(name), JSON.stringify(rec, null, 2));
      broadcast({ type: 'presets', presets: listPresets() });
      return json(200, rec);
    }
    if (req.method === 'DELETE') {
      try { fs.unlinkSync(presetFile(name)); } catch {}
      broadcast({ type: 'presets', presets: listPresets() });
      return json(200, { presets: listPresets() });
    }
  }

  // ---- share the CC map with the browser ----
  if (u.pathname === '/midi-map.js') {
    return fs.readFile(path.join(__dirname, '..', 'midi-map.js'), (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(data);
    });
  }

  if (PWA_DIR) return serveStatic(u.pathname, res);
  res.writeHead(426); res.end('Upgrade Required');
});

function serveStatic(pathname, res) {
  const rel  = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PWA_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext   = path.extname(file).slice(1);
    const types = { html: 'text/html', js: 'text/javascript', json: 'application/json',
                    css: 'text/css', png: 'image/png', svg: 'image/svg+xml' };
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  clients.add(ws);
  ws.send(JSON.stringify({
    type: 'hello',
    params: MAP.PARAMS,
    midiBackend: midi.backend,
    mbase01Channel: MBASE01_CH + 1,
    state: ccState,
    ports: status(),
    presets: listPresets(),
    routing,
  }));

  ws.on('message', buf => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg.type === 'set' && msg.id != null && msg.value != null) {
      const param = MAP.byId[msg.id];
      if (param) sendCC(param.cc, msg.value * 127);
    }
    if (msg.type === 'cc' && msg.cc != null && msg.value != null) {
      sendCC(msg.cc, msg.value);
    }
  });

  ws.on('close', () => clients.delete(ws));
});

// ── boot ──────────────────────────────────────────────────────────────────────
openPorts({
  inWant:  process.env.MIDI_IN_PORT  ?? '',
  outWant: process.env.MIDI_OUT_PORT ?? '',
});

server.listen(PORT, () => {
  console.log(`\n[mbase01-bridge] listening on :${PORT}  (MIDI: ${midi.backend})`);
  console.log(`[mbase01-bridge] MBase 01 on MIDI channel ${MBASE01_CH + 1}`);
  console.log(`[mbase01-bridge] trigger channels: ${routing.triggerChannels.join(', ') || '(none yet)'}`);
  console.log(`[mbase01-bridge] CC routes: ${routing.ccRoutes.length}`);
  console.log(`[mbase01-bridge] PWA: http://localhost:${PORT}/`);
  console.log(`[mbase01-bridge] presets dir: ${PRESETS_DIR}\n`);
});

function shutdown() {
  console.log('[mbase01-bridge] shutting down…');
  try { midi.out.close(); } catch {}
  try { midi.in && midi.in.close(); } catch {}
  process.exit(0);
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
