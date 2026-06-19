// bridge-server.js
//
// Many-phones-to-norns aggregation bridge.
//
//   many phones (websocket) --> bridge (tick + aggregate) --> norns (OSC, fixed rate)
//
// Norns sees exactly one peer sending at a fixed low rate, regardless of
// whether 3 phones or 300 are connected -- all connection handling and
// aggregation happens here. See docs/bridge-design.md for the rationale.
//
// This also writes the session-capture log for this layer: every raw phone
// touch (phone_events.jsonl) and every aggregated tick sent to norns
// (bridge_ticks.jsonl), both timestamped against the same t0 the manifest
// records, so they line up with norns' own perf_logger output afterward.

const fs = require('fs')
const http = require('http')
const path = require('path')
const OSC = require('osc-js')
const WebSocket = require('ws')

// ---- config -------------------------------------------------------------

const NORNS_HOST = process.env.NORNS_HOST || '10.42.0.1' // norns hotspot IP
const NORNS_PORT = parseInt(process.env.NORNS_PORT || '10111', 10)
const WS_PORT = parseInt(process.env.BRIDGE_WS_PORT || '8081', 10)
const TICK_MS = parseInt(process.env.BRIDGE_TICK_MS || '40', 10) // ~25Hz
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, '..', 'sessions')
// the audience PWA is served from this same process+port, so on the venue LAN
// the guest zone only needs one port open to the bridge (see docs/network-opal.md).
// set PWA_DIR='' to disable static serving (WebSocket-only bridge).
const PWA_DIR = process.env.PWA_DIR === undefined
  ? path.join(__dirname, '..', 'pwa')
  : process.env.PWA_DIR

// Full parameter surface. The channel name a phone sends IS the OSC path the
// bridge forwards to norns, so adding a control here is the only step needed to
// expose it to the XY-pad UI. dspm_archive.lua's osc.event handler normalises
// every /barcode/... path from 0..1 internally (util.linlin), so phones always
// send 0..1 on the wire regardless of the param's real range.
//
// Two kinds of channel:
//   - continuous: averaged across all touching phones on each tick (sliders,
//     XY pads). Held values re-send at the tick rate, which is what you want
//     for a control surface.
//   - discrete: transport actions (record/clear/reverse/quantize). These are
//     edge-triggered -- forwarded the instant a phone sends one (last-write-
//     wins across phones) rather than averaged, so a tap isn't smeared into a
//     fractional value or re-fired every tick. See the "vote" note in
//     docs/control-surface-mapping.md for a future per-phone-threshold scheme.
const CHANNELS = {}
function addChannel(osc, opts = {}) {
  CHANNELS[osc] = { osc, discrete: !!opts.discrete }
}

// global continuous
addChannel('/barcode/output_level') // master (state.level)
addChannel('/barcode/pre_level')
addChannel('/barcode/rec_level')
addChannel('/param/filter_frequency')
addChannel('/param/filter_reso')
addChannel('/barcode/rate_slew')
addChannel('/barcode/pan_slew')
addChannel('/barcode/level_slew')

// per-voice continuous: bias adjustments + LFO periods (six voices)
const VOICE_PARAMS = [
  'level', 'pan', 'rate', 'direction', 'start', 'endpos',
  'level_lfo', 'pan_lfo', 'rate_lfo', 'direction_lfo', 'startend_lfo',
]
for (let i = 1; i <= 6; i++) {
  for (const p of VOICE_PARAMS) addChannel(`/barcode/v${i}/${p}`)
}

// transport discrete (norns shifts reverse/quantize by +1 itself)
addChannel('/param/recording', { discrete: true })
addChannel('/param/clear', { discrete: true })
addChannel('/param/reverse', { discrete: true })
addChannel('/param/quantize', { discrete: true })

const CHANNEL_NAMES = Object.keys(CHANNELS)
const CONTINUOUS_CHANNELS = CHANNEL_NAMES.filter((c) => !CHANNELS[c].discrete)

// ---- session bookkeeping -------------------------------------------------

let sessionId = null
let sessionDir = null
let t0 = null
let phoneLog = null
let tickLog = null

function startSession() {
  const now = new Date()
  sessionId = 'session_' + now.toISOString().replace(/[:.]/g, '-')
  sessionDir = path.join(SESSIONS_DIR, sessionId)
  fs.mkdirSync(sessionDir, { recursive: true })
  t0 = Date.now()
  phoneLog = fs.createWriteStream(path.join(sessionDir, 'phone_events.jsonl'), { flags: 'a' })
  tickLog = fs.createWriteStream(path.join(sessionDir, 'bridge_ticks.jsonl'), { flags: 'a' })
  writeManifestStub()
  console.log(`[bridge] session started: ${sessionId}`)
}

function tNow() {
  return (Date.now() - t0) / 1000
}

function writeManifestStub() {
  const manifest = {
    schema_version: '1.0',
    session_id: sessionId,
    t0: Math.floor(t0 / 1000),
    // every channel travels the wire normalised 0..1 (norns maps to the real
    // range); discrete channels carry 0/1 edge values.
    channels: Object.fromEntries(
      CHANNEL_NAMES.map((name) => [
        name,
        CHANNELS[name].discrete
          ? { type: 'discrete', min: 0, max: 1 }
          : { type: 'continuous', min: 0, max: 1, taper: 'linear', interp: 'linear' },
      ])
    ),
    logs: {
      phone_events: 'phone_events.jsonl',
      bridge_ticks: 'bridge_ticks.jsonl',
    },
  }
  fs.writeFileSync(path.join(sessionDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

function endSession() {
  if (!sessionDir) return
  let manifest = {}
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(sessionDir, 'manifest.json'), 'utf8'))
  } catch (e) {
    // leave as {}
  }
  manifest.duration_sec = tNow()
  fs.writeFileSync(path.join(sessionDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  if (phoneLog) phoneLog.end()
  if (tickLog) tickLog.end()
  console.log(`[bridge] session ended: ${sessionId} (${manifest.duration_sec.toFixed(1)}s)`)
}

// ---- OSC out to norns -----------------------------------------------------

const osc = new OSC({
  plugin: new OSC.DatagramPlugin({
    send: { host: NORNS_HOST, port: NORNS_PORT },
  }),
})
osc.open()

// ---- http server: serves the audience PWA, hosts the websocket -------------
// One port does both, so audience phones load the page and open the control
// socket against the same origin -- no second port, no mixed-content, and the
// PWA's resolveBridgeUrl() falls through to the page's own host automatically.

const STATIC_TYPES = {
  '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

function serveStatic(req, res) {
  if (!PWA_DIR) { res.writeHead(404); return res.end('not found') }
  const root = path.resolve(PWA_DIR)
  let p = decodeURIComponent((req.url || '/').split('?')[0])
  if (p === '/') p = '/index.html'
  const fp = path.join(root, p)
  if (!fp.startsWith(root)) { res.writeHead(403); return res.end('forbidden') }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found') }
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(fp)] || 'application/octet-stream' })
    res.end(data)
  })
}

const httpServer = http.createServer(serveStatic)
httpServer.listen(WS_PORT, '0.0.0.0')

// ---- websocket in from phones ----------------------------------------------

const wss = new WebSocket.Server({ server: httpServer })

// per-channel state: clientId -> {value, ts}
const touches = {}
CHANNEL_NAMES.forEach((c) => (touches[c] = new Map()))

wss.on('connection', (ws) => {
  const clientId = Math.random().toString(36).slice(2)
  ws.send(JSON.stringify({ type: 'hello', channels: CHANNEL_NAMES }))

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch (e) {
      return
    }
    if (!msg) return
    const ch = CHANNELS[msg.channel]
    if (!ch) return
    const value = Number(msg.value)
    if (!Number.isFinite(value)) return
    const ts = tNow()
    if (phoneLog) {
      phoneLog.write(JSON.stringify({ type: 'touch', t: ts, client: clientId, channel: msg.channel, value }) + '\n')
    }
    if (ch.discrete) {
      // edge event: forward immediately (last-write-wins across phones) and log
      // it on the tick stream too, so the archive keeps the transport actions.
      const out = Math.round(value)
      osc.send(new OSC.Message(ch.osc, out))
      if (tickLog) {
        tickLog.write(JSON.stringify({ type: 'event', t: ts, channel: msg.channel, value: out }) + '\n')
      }
    } else {
      touches[msg.channel].set(clientId, { value, ts })
    }
  })

  ws.on('close', () => {
    CHANNEL_NAMES.forEach((c) => touches[c].delete(clientId))
  })
})

// ---- fixed-rate tick: aggregate touches, send to norns, log the tick ------

setInterval(() => {
  if (!sessionDir) return
  const tick = { type: 'tick', t: tNow(), values: {} }
  for (const channel of CONTINUOUS_CHANNELS) {
    const active = [...touches[channel].values()]
    if (active.length === 0) continue
    // mean aggregation across all phones currently touching this channel;
    // swap for last-write-wins or sharded logic per docs/bridge-design.md
    // if a different feel is wanted for a given performance.
    const value = active.reduce((sum, t) => sum + t.value, 0) / active.length
    tick.values[channel] = value
    osc.send(new OSC.Message(CHANNELS[channel].osc, value))
  }
  if (Object.keys(tick.values).length > 0 && tickLog) {
    tickLog.write(JSON.stringify(tick) + '\n')
  }
}, TICK_MS)

// ---- lifecycle --------------------------------------------------------------

startSession()

process.on('SIGINT', () => {
  endSession()
  process.exit(0)
})
process.on('SIGTERM', () => {
  endSession()
  process.exit(0)
})

console.log(`[bridge] http + websocket on :${WS_PORT}, OSC -> ${NORNS_HOST}:${NORNS_PORT}, tick ${TICK_MS}ms`)
console.log(`[bridge] serving PWA from ${PWA_DIR || '(disabled)'}`)
console.log(`[bridge] ${CHANNEL_NAMES.length} channels (${CONTINUOUS_CHANNELS.length} continuous, ${CHANNEL_NAMES.length - CONTINUOUS_CHANNELS.length} discrete)`)
