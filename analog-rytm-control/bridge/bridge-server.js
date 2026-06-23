// bridge-server.js — many phones/web clients -> one Analog Rytm over MIDI.
//
// The multi-track MIDI sibling of mbase01-bridge, modelled on
// octatrack-midi-control. It:
//   1. Serves the controller PWA and a control WebSocket on one port.
//   2. Owns the single hardware MIDI OUT port (the USB-MIDI interface wired to
//      the Rytm's MIDI IN), so N clients never fight over the port.
//   3. Translates each {channel, value} message into a MIDI CC on the right
//      track/FX/perf channel, scaling normalised 0..1 to 0..127.
//   4. Aggregates continuous controls across clients (mean) and edge-fires
//      toggles at a fixed tick rate, so the Rytm only sees a sane CC stream.
//   5. Logs every session to sessions/session_<ts>/ like dspm.
//
// The Rytm is 12 drum tracks, each on its own channel; the FX track and the
// performance macros each have their own channel. The CC numbers repeat across
// tracks — the *channel* selects the target. See ../RYTM-MIDI.md.
//
// Env knobs (all optional; defaults give a sensible single-laptop setup):
//   BRIDGE_WS_PORT     8084   HTTP + WebSocket port (PWA + control socket)
//   MIDI_PORT_NAME     ''     substring match for the MIDI out port; '' = first
//   MIDI_VIRTUAL       0      1 = open a virtual port named "Rytm Bridge"
//   BRIDGE_TICK_MS     25     CC flush interval (40 Hz)
//   AGG                mean   mean | last  (continuous aggregation across clients)
//   TRACK_CHANNELS     1..12  per drum-track MIDI channel (comma-separated)
//   FX_CHANNEL         13     FX track (delay/reverb/comp/dist) channel
//   PERF_CHANNEL       13     performance-macro channel
//   AUTO_CHANNEL       14     active-track ("auto") channel
//   BRIDGE_ADMIN_TOKEN ''     unset -> /admin is loopback-only
//   BRIDGE_MAX_MSGS_PER_SEC 300  per-client rate cap
//   SESSIONS_DIR       ../sessions
//   PWA_DIR            ../pwa   ('' disables static serving)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const MAP = require('../midi-map.js');

// --- MIDI backend: prefer easymidi (RtMidi); fall back to a logging stub so the
//     bridge still runs (and the UI can be rehearsed) with no interface present.
//     The output port is reopenable at runtime (POST /ports). Rytm is out-only.
let easymidi = null;
try { easymidi = require('easymidi'); }
catch (e) { console.warn(`[midi] easymidi unavailable (${e.message}); dry-run only.`); }

const DRY_OUT = {
  send(_type, msg) { console.log(`[dry-run] CC ch${msg.channel + 1} #${msg.controller} = ${msg.value}`); },
  close() {},
};

let midiOut = DRY_OUT;
let midiOutName = null;
let midiBackend = 'dry-run';

function listOutputs() {
  if (!easymidi) return [];
  try { return easymidi.getOutputs(); } catch { return []; }
}
// When no port is specified, prefer a real interface over Windows' software synth.
function pickDefault(names) {
  return names.find((n) => !/wavetable|microsoft gs/i.test(n)) || names[0];
}

// Open (or reopen) the output. want: substring match; ''/null = auto-pick;
// '__none__' = dry-run. Returns the current status object.
function openOutput(want) {
  if (!easymidi) { midiOut = DRY_OUT; midiOutName = null; midiBackend = 'dry-run'; return outStatus(); }
  const virtual = process.env.MIDI_VIRTUAL === '1';
  try { if (midiOut && midiOut.close) midiOut.close(); } catch {}
  if (want === '__none__') { midiOut = DRY_OUT; midiOutName = null; midiBackend = 'dry-run'; return outStatus(); }
  if (virtual) {
    try { midiOut = new easymidi.Output('Rytm Bridge', true); midiOutName = '(virtual)'; midiBackend = 'easymidi(virtual)'; }
    catch (e) { console.warn(`[midi] virtual out failed (${e.message})`); midiOut = DRY_OUT; midiOutName = null; midiBackend = 'dry-run'; }
    return outStatus();
  }
  const names = listOutputs();
  const w = String(want ?? '').trim();
  const name = w ? (names.find((n) => n.toLowerCase().includes(w.toLowerCase())) || pickDefault(names)) : pickDefault(names);
  // A busy/failing port must not crash the bridge (WinMM ports are exclusive).
  if (name) {
    try { midiOut = new easymidi.Output(name); midiOutName = name; midiBackend = `easymidi("${name}")`; }
    catch (e) { console.warn(`[midi] could not open output "${name}" (${e.message}); it may be in use. Using dry-run.`); midiOut = DRY_OUT; midiOutName = null; midiBackend = 'dry-run'; }
  } else { midiOut = DRY_OUT; midiOutName = null; midiBackend = 'dry-run'; }
  return outStatus();
}

function outStatus() {
  return { outputs: listOutputs(), outName: midiOutName, backend: midiBackend };
}

openOutput(process.env.MIDI_PORT_NAME || '');

const PORT = parseInt(process.env.BRIDGE_WS_PORT || '8084', 10);
const TICK_MS = parseInt(process.env.BRIDGE_TICK_MS || '25', 10);
const AGG = (process.env.AGG || 'mean').toLowerCase();
const MAX_MSGS = parseInt(process.env.BRIDGE_MAX_MSGS_PER_SEC || '300', 10);
const ADMIN_TOKEN = process.env.BRIDGE_ADMIN_TOKEN || '';
const PWA_DIR = process.env.PWA_DIR === undefined ? path.join(__dirname, '..', 'pwa') : process.env.PWA_DIR;
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, '..', 'sessions');

const TRACK_CHANNELS = (process.env.TRACK_CHANNELS || MAP.defaults.trackChannels.join(','))
  .split(',').map((s) => parseInt(s, 10));
const FX_CHANNEL = parseInt(process.env.FX_CHANNEL || String(MAP.defaults.fxChannel), 10);
const PERF_CHANNEL = parseInt(process.env.PERF_CHANNEL || String(MAP.defaults.perfChannel), 10);
const AUTO_CHANNEL = parseInt(process.env.AUTO_CHANNEL || String(MAP.defaults.autoChannel), 10);

const CHANNELS = MAP.expandChannels();

// --- session logging ---
fs.mkdirSync(SESSIONS_DIR, { recursive: true });
const sessionId = `session_${new Date().toISOString().replace(/[:.]/g, '-')}`;
const sessionDir = path.join(SESSIONS_DIR, sessionId);
fs.mkdirSync(sessionDir, { recursive: true });
const eventsLog = fs.createWriteStream(path.join(sessionDir, 'client_events.jsonl'), { flags: 'a' });
const ccLog = fs.createWriteStream(path.join(sessionDir, 'midi_cc.jsonl'), { flags: 'a' });
const startedAt = Date.now();
fs.writeFileSync(path.join(sessionDir, 'manifest.json'), JSON.stringify({
  spec: 'analog-rytm-control/session/v1',
  sessionId, startedAt: new Date(startedAt).toISOString(),
  midiBackend, trackChannels: TRACK_CHANNELS, fxChannel: FX_CHANNEL,
  perfChannel: PERF_CHANNEL, autoChannel: AUTO_CHANNEL,
}, null, 2));

// --- crowd gate (performer kill-switch / dimmer), same idea as dspm ---
const crowd = { enabled: true, gain: 1.0 };

// --- aggregation state: per-channel accumulator of contributions this tick ---
const acc = new Map();         // channel -> { sum, count, last }
const toggleQueue = [];        // edge-fired toggles to flush this tick
const lastSent = new Map();    // channel -> last CC value sent (dedupe)

// Resolve a wire channel id to a concrete { midiChannel, cc, def }.
function channelToMidi(channel) {
  const def = CHANNELS[channel];
  if (!def) return null;
  let ch;
  switch (def.scope) {
    case 'track': ch = TRACK_CHANNELS[def.track - 1]; break;
    case 'auto':  ch = AUTO_CHANNEL; break;
    case 'fx':    ch = FX_CHANNEL; break;
    case 'perf':  ch = PERF_CHANNEL; break;
    default:      ch = AUTO_CHANNEL;
  }
  if (!ch) return null;
  return { midiChannel: ch - 1, cc: def.cc, def };
}

// normalised 0..1 -> 0..127 (bipolar params already centre at 64 via 0.5)
function scale(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 127);
}

// Guarded send: a transient hardware error (port unplugged, USB-MIDI host
// reconfigured) must not crash the bridge. Log rate-limited + drop.
let lastSendErr = 0;
function sendCC(midiChannel, cc, value, channel) {
  if (lastSent.get(channel) === value) return;   // dedupe identical repeats
  lastSent.set(channel, value);
  try {
    midiOut.send('cc', { channel: midiChannel, controller: cc, value });
  } catch (e) {
    const now = Date.now();
    if (now - lastSendErr > 1000) { lastSendErr = now; console.warn(`[midi] send failed (${e.message}) on "${midiOutName || 'dry-run'}"; dropping.`); }
    return;
  }
  ccLog.write(JSON.stringify({ t: Date.now() - startedAt, ch: midiChannel + 1, cc, value }) + '\n');
}

// Flush accumulated contributions to MIDI at a fixed rate.
setInterval(() => {
  for (const [channel, a] of acc) {
    const m = channelToMidi(channel);
    if (!m) continue;
    const norm = AGG === 'last' ? a.last : (a.count ? a.sum / a.count : a.last);
    if (crowd.enabled) sendCC(m.midiChannel, m.cc, scale(norm), channel);
  }
  acc.clear();
  while (toggleQueue.length) {
    const { channel, value } = toggleQueue.shift();
    const m = channelToMidi(channel);
    if (!m) continue;
    if (crowd.enabled) {
      lastSent.delete(channel);                 // always fire edges
      sendCC(m.midiChannel, m.cc, value ? 127 : 0, channel);
    }
  }
}, TICK_MS);

function ingest(channel, value) {
  const def = CHANNELS[channel];
  if (!def) return false;
  eventsLog.write(JSON.stringify({ t: Date.now() - startedAt, channel, value }) + '\n');
  if (def.toggle) {
    toggleQueue.push({ channel, value: value >= 0.5 });
  } else {
    const g = crowd.gain;
    const cur = acc.get(channel) || { sum: 0, count: 0, last: 0 };
    cur.sum += value * g + (1 - g) * 0.5;       // gain dims toward centre
    cur.count += 1;
    cur.last = value;
    acc.set(channel, cur);
  }
  return true;
}

// --- preset storage (server-side, shared across devices) ---
const PRESETS_DIR = process.env.PRESETS_DIR || path.join(__dirname, '..', 'presets');
fs.mkdirSync(PRESETS_DIR, { recursive: true });
const safeName = (n) => /^[\w -]{1,48}$/.test(n);    // letters, digits, _, -, space
const presetFile = (n) => path.join(PRESETS_DIR, `${n}.json`);
function listPresets() {
  try { return fs.readdirSync(PRESETS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); }
  catch { return []; }
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}
// fan a message out to every connected PWA (used by /ports and /presets)
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}

// --- HTTP (PWA + admin) ---
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

  // MIDI output port: list / select live
  if (u.pathname === '/ports') {
    if (req.method === 'GET') return json(200, outStatus());
    if (req.method === 'POST') {
      const body = await readBody(req).then((s) => { try { return JSON.parse(s); } catch { return {}; } });
      const st = openOutput(body.out);
      broadcast({ type: 'ports', ...st });
      return json(200, st);
    }
  }

  // presets: list / get / save / delete
  if (u.pathname === '/presets' && req.method === 'GET') return json(200, { presets: listPresets() });
  if (u.pathname.startsWith('/presets/')) {
    const name = decodeURIComponent(u.pathname.slice('/presets/'.length));
    if (!safeName(name)) return json(400, { error: 'bad preset name' });
    if (req.method === 'GET') {
      try { return json(200, JSON.parse(fs.readFileSync(presetFile(name), 'utf8'))); }
      catch { return json(404, { error: 'not found' }); }
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req).then((s) => { try { return JSON.parse(s); } catch { return null; } });
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

  if (u.pathname === '/channels') {            // UI introspection
    return json(200, {
      trackChannels: TRACK_CHANNELS, fxChannel: FX_CHANNEL,
      perfChannel: PERF_CHANNEL, autoChannel: AUTO_CHANNEL,
      voices: MAP.VOICES, trackParams: MAP.TRACK_PARAMS,
      fxParams: MAP.FX_PARAMS, perfParams: MAP.PERF_PARAMS,
    });
  }

  if (u.pathname === '/admin/crowd') {         // kill-switch / dimmer
    const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const ok = ADMIN_TOKEN ? u.searchParams.get('token') === ADMIN_TOKEN : loopback;
    if (!ok) { res.writeHead(403); return res.end('forbidden'); }
    if (u.searchParams.has('enabled')) crowd.enabled = u.searchParams.get('enabled') !== '0';
    if (u.searchParams.has('gain')) crowd.gain = Math.max(0, Math.min(1, parseFloat(u.searchParams.get('gain'))));
    return json(200, crowd);
  }

  // webhook: POST/GET /hook/<channel>  (third-party services -> a control)
  if (u.pathname.startsWith('/hook/')) {
    const channel = decodeURIComponent(u.pathname.slice('/hook/'.length));
    let value = 1;
    if (u.searchParams.has('value')) value = parseFloat(u.searchParams.get('value'));
    if (!CHANNELS[channel]) { res.writeHead(404); return res.end('unknown channel'); }
    ingest(channel, Math.max(0, Math.min(1, value)));
    res.writeHead(200); return res.end('ok');
  }

  // the shared map lives one level above pwa/; serve it explicitly
  if (u.pathname === '/midi-map.js') {
    return fs.readFile(path.join(__dirname, '..', 'midi-map.js'), (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(data);
    });
  }

  // static PWA
  if (PWA_DIR) return serveStatic(u.pathname, res);
  res.writeHead(426); res.end('Upgrade Required');
});

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PWA_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file).slice(1);
    const types = { html: 'text/html', js: 'text/javascript', json: 'application/json',
      css: 'text/css', png: 'image/png', svg: 'image/svg+xml' };
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// --- WebSocket control socket ---
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  let windowStart = Date.now(), count = 0;
  ws.send(JSON.stringify({
    type: 'hello', channels: Object.keys(CHANNELS), backend: midiBackend,
    ports: outStatus(), presets: listPresets(),
  }));
  ws.on('message', (buf) => {
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    if (++count > MAX_MSGS) return;            // drop floods
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg.type === 'set' || (msg.channel !== undefined && msg.value !== undefined)) {
      ingest(msg.channel, msg.value);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[bridge] analog-rytm-control on :${PORT}  (MIDI: ${midiBackend})`);
  console.log(`[bridge] track channels ${TRACK_CHANNELS.join(',')}  FX ${FX_CHANNEL}  PERF ${PERF_CHANNEL}  AUTO ${AUTO_CHANNEL}`);
  console.log(`[bridge] PWA: http://localhost:${PORT}/    session: ${sessionId}`);
});

function shutdown() {
  console.log('\n[bridge] finalizing session…');
  try {
    const m = JSON.parse(fs.readFileSync(path.join(sessionDir, 'manifest.json')));
    m.endedAt = new Date().toISOString();
    m.durationSec = (Date.now() - startedAt) / 1000;
    fs.writeFileSync(path.join(sessionDir, 'manifest.json'), JSON.stringify(m, null, 2));
  } catch {}
  try { midiOut.close(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
