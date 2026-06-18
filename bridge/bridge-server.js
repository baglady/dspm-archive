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
const path = require('path')
const OSC = require('osc-js')
const WebSocket = require('ws')

// ---- config -------------------------------------------------------------

const NORNS_HOST = process.env.NORNS_HOST || '10.42.0.1' // norns hotspot IP
const NORNS_PORT = parseInt(process.env.NORNS_PORT || '10111', 10)
const WS_PORT = parseInt(process.env.BRIDGE_WS_PORT || '8081', 10)
const TICK_MS = parseInt(process.env.BRIDGE_TICK_MS || '40', 10) // ~25Hz
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, '..', 'sessions')

// Core tier channels -- master level, the two global filter params, plus
// level/pan offsets for all 6 voices. Mirrors docs/control-surface-mapping.md.
// Each entry maps a channel name (sent by phones) to the OSC path it
// resolves to on norns -- /param/<id> for true params, /barcode/... for the
// per-voice bias controls that only exist via the osc.event handler.
const CHANNELS = {
  output_level:     { osc: '/barcode/output_level' }, // state.level -- no params entry exists for this, see dspm_archive.lua osc.event
  filter_frequency: { osc: '/param/filter_frequency' },
  filter_reso:      { osc: '/param/filter_reso' },
}
for (let i = 1; i <= 6; i++) {
  CHANNELS[`voice${i}_level_adj`] = { osc: `/barcode/v${i}/level` }
  CHANNELS[`voice${i}_pan_adj`] = { osc: `/barcode/v${i}/pan` }
}
const CHANNEL_NAMES = Object.keys(CHANNELS)

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
    channels: Object.fromEntries(
      CHANNEL_NAMES.map((name) => [name, { min: name.includes('_adj') ? -2 : 0, max: name.includes('_adj') ? 2 : 1, taper: 'linear', interp: 'linear' }])
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

// ---- websocket in from phones ----------------------------------------------

const wss = new WebSocket.Server({ port: WS_PORT })

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
    if (!msg || !CHANNEL_NAMES.includes(msg.channel)) return
    const value = Number(msg.value)
    if (!Number.isFinite(value)) return
    const ts = tNow()
    touches[msg.channel].set(clientId, { value, ts })
    if (phoneLog) {
      phoneLog.write(JSON.stringify({ type: 'touch', t: ts, client: clientId, channel: msg.channel, value }) + '\n')
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
  for (const channel of CHANNEL_NAMES) {
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

console.log(`[bridge] websocket on :${WS_PORT}, OSC -> ${NORNS_HOST}:${NORNS_PORT}, tick ${TICK_MS}ms`)
console.log(`[bridge] channels: ${CHANNEL_NAMES.join(', ')}`)
