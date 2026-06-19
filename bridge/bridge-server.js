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
// norns pushes parameter feedback (changes made ON the device) back to this UDP
// port; the bridge fans it out to phones. dspm_archive.lua sends to the bridge
// IP it learns from inbound OSC, on this port. See docs/feedback.md.
const FEEDBACK_PORT = parseInt(process.env.BRIDGE_FEEDBACK_PORT || '10112', 10)
const TICK_MS = parseInt(process.env.BRIDGE_TICK_MS || '40', 10) // ~25Hz
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, '..', 'sessions')
// the audience PWA is served from this same process+port, so on the venue LAN
// the guest zone only needs one port open to the bridge (see docs/network-opal.md).
// set PWA_DIR='' to disable static serving (WebSocket-only bridge).
const PWA_DIR = process.env.PWA_DIR === undefined
  ? path.join(__dirname, '..', 'pwa')
  : process.env.PWA_DIR

// Remote / webhook controls (see docs/remote-webhooks.md). All optional; the
// defaults below reproduce the bridge's pre-webhook behavior exactly, so a
// LAN-only laptop or Opal show is unaffected unless these are deliberately
// used. Everything rides the same WS_PORT -- no second port to open.
const ADMIN_TOKEN = process.env.BRIDGE_ADMIN_TOKEN || '' // unset -> /admin is loopback-only
const MAX_MSGS_PER_SEC = parseInt(process.env.BRIDGE_MAX_MSGS_PER_SEC || '300', 10) // per WS client (XY pad = 2 msgs/move; 120Hz drag ~240/s, so headroom above legit use)
const HOOK_MAX_PER_SEC = parseInt(process.env.BRIDGE_HOOK_MAX_PER_SEC || '20', 10) // per webhook IP
const HOOK_HOLD_MS = parseInt(process.env.BRIDGE_HOOK_HOLD_MS || '1000', 10) // continuous-hook hold

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

// ---- OSC out to norns (and feedback in from norns) ------------------------
// One UDP socket: bound to FEEDBACK_PORT for inbound feedback, sending to
// norns. Binding the send socket to FEEDBACK_PORT also means norns sees our
// messages arriving *from* that port, so it always knows where to reply.

const osc = new OSC({
  plugin: new OSC.DatagramPlugin({
    open: { host: '0.0.0.0', port: FEEDBACK_PORT },
    send: { host: NORNS_HOST, port: NORNS_PORT },
  }),
})
osc.open()

// ---- crowd gate + rate limiting (remote/webhook safety) -------------------
// The performer's dimmer/kill-switch. enabled=false stops ALL crowd->norns
// forwarding (continuous ticks, discrete edges, webhooks) while still accepting
// connections and logging raw intent; gain (0..1) scales continuous influence.
// Defaults (enabled, gain 1) == current behavior. Set via /admin/crowd.
const crowd = { enabled: true, gain: 1 }

const clamp01 = (n) => Math.min(1, Math.max(0, n))

// Guarded discrete send: respects the kill-switch. Returns whether it forwarded.
function sendDiscrete(oscPath, intVal) {
  if (!crowd.enabled) return false
  osc.send(new OSC.Message(oscPath, intVal))
  return true
}

// Simple token bucket (capacity == one second's worth, refills continuously).
function makeBucket(ratePerSec) {
  return { tokens: ratePerSec, last: Date.now(), rate: ratePerSec }
}
function takeToken(b) {
  const now = Date.now()
  b.tokens = Math.min(b.rate, b.tokens + ((now - b.last) / 1000) * b.rate)
  b.last = now
  if (b.tokens >= 1) { b.tokens -= 1; return true }
  return false
}

// Per-IP buckets for the webhook route, pruned of idle entries periodically so a
// spray of source IPs can't grow the map without bound.
const hookBuckets = new Map()
setInterval(() => {
  for (const [ip, b] of hookBuckets) if (b.tokens >= b.rate) hookBuckets.delete(ip)
}, 30000).unref()

// Continuous webhook "holds": a one-shot hook becomes a short-lived synthetic
// touch that joins the crowd average until it expires (see docs/remote-webhooks.md).
// Kept separate from `touches` so the phone path is byte-for-byte unchanged.
const hookHolds = {}
CONTINUOUS_CHANNELS.forEach((c) => (hookHolds[c] = new Map()))

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

// ---- request helpers (admin + webhook routes) -----------------------------

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

// Real client IP for rate limiting. Behind cloudflared the TCP peer is always
// localhost, so trust its forwarding headers for the *rate-limit* identity.
function clientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    ''
  )
}

// True only for a request that physically arrived on the loopback interface and
// did NOT pass through a proxy. The header check matters: through cloudflared the
// socket peer is 127.0.0.1, so without it a tunnelled request would masquerade as
// local and open the admin route to the world. (Forwarding headers can be spoofed
// over a direct connection, but that path is already non-loopback by socket addr.)
function isLoopback(req) {
  if (req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['x-real-ip']) {
    return false
  }
  const ip = req.socket.remoteAddress || ''
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

function readBody(req, cb) {
  let data = ''
  let aborted = false
  req.on('data', (chunk) => {
    if (aborted) return
    data += chunk
    if (data.length > 65536) { aborted = true; req.destroy() } // 64KB cap
  })
  req.on('end', () => { if (!aborted) cb(data) })
  req.on('error', () => {})
}

// POST /admin/crowd?enabled=0&gain=0.3  -> the performer's kill-switch/dimmer.
// GET /admin/crowd                      -> read state. Query params set on either
// verb (so a plain browser/curl GET works). Auth: token if BRIDGE_ADMIN_TOKEN is
// set (works from anywhere), else loopback-only (the bridge machine itself).
function handleAdmin(req, res, urlObj) {
  const ok = ADMIN_TOKEN
    ? (urlObj.searchParams.get('token') || req.headers['x-admin-token']) === ADMIN_TOKEN
    : isLoopback(req)
  if (!ok) return sendJson(res, 403, { error: 'forbidden' })

  const q = urlObj.searchParams
  if (q.has('enabled')) crowd.enabled = !['0', 'false', 'off', 'no'].includes(q.get('enabled').toLowerCase())
  if (q.has('gain')) {
    const g = Number(q.get('gain'))
    if (Number.isFinite(g)) crowd.gain = clamp01(g)
  }
  sendJson(res, 200, { enabled: crowd.enabled, gain: crowd.gain })
}

// GET|POST /hook/<osc-path>  -> turn an inbound webhook into a channel event.
// The path after /hook/ IS the OSC channel (leading slash re-added). Value comes
// from JSON body {value}, form/query ?value=, or defaults to 1 for discrete.
function handleHook(req, res, urlObj) {
  const ip = clientIp(req)
  let bucket = hookBuckets.get(ip)
  if (!bucket) { bucket = makeBucket(HOOK_MAX_PER_SEC); hookBuckets.set(ip, bucket) }
  if (!takeToken(bucket)) return sendJson(res, 429, { error: 'rate limited' })

  const channel = '/' + urlObj.pathname.slice('/hook/'.length)
  const ch = CHANNELS[channel]
  if (!ch) return sendJson(res, 404, { error: 'unknown channel', channel })

  readBody(req, (body) => {
    // value: JSON body -> form/query -> (discrete) default 1
    let value
    const ct = req.headers['content-type'] || ''
    if (body) {
      if (ct.includes('application/json')) {
        try { const j = JSON.parse(body); if (j && j.value !== undefined) value = Number(j.value) } catch (e) {}
      } else {
        const f = new URLSearchParams(body)
        if (f.has('value')) value = Number(f.get('value'))
      }
    }
    if (value === undefined && urlObj.searchParams.has('value')) value = Number(urlObj.searchParams.get('value'))

    const ts = tNow()
    if (ch.discrete) {
      const out = Math.round(clamp01(value === undefined || !Number.isFinite(value) ? 1 : value))
      const forwarded = sendDiscrete(ch.osc, out)
      if (phoneLog) phoneLog.write(JSON.stringify({ type: 'touch', t: ts, client: 'hook:' + ip, channel, value: out }) + '\n')
      if (forwarded && tickLog) tickLog.write(JSON.stringify({ type: 'event', t: ts, channel, value: out, src: 'hook' }) + '\n')
      return sendJson(res, 200, { ok: true, channel, value: out, forwarded })
    }
    if (value === undefined || !Number.isFinite(value)) {
      return sendJson(res, 400, { error: 'continuous channel needs a value (0..1)', channel })
    }
    const v = clamp01(value)
    hookHolds[channel].set(ip, { value: v, expires: Date.now() + HOOK_HOLD_MS })
    if (phoneLog) phoneLog.write(JSON.stringify({ type: 'touch', t: ts, client: 'hook:' + ip, channel, value: v }) + '\n')
    sendJson(res, 200, { ok: true, channel, value: v, hold_ms: HOOK_HOLD_MS })
  })
}

function handleRequest(req, res) {
  const urlObj = new URL(req.url, 'http://localhost')
  if (urlObj.pathname === '/admin/crowd') return handleAdmin(req, res, urlObj)
  if (urlObj.pathname.startsWith('/hook/')) return handleHook(req, res, urlObj)
  return serveStatic(req, res)
}

const httpServer = http.createServer(handleRequest)
httpServer.listen(WS_PORT, '0.0.0.0')

// ---- websocket in from phones ----------------------------------------------

const wss = new WebSocket.Server({ server: httpServer })

// per-channel state: clientId -> {value, ts}
const touches = {}
CHANNEL_NAMES.forEach((c) => (touches[c] = new Map()))

wss.on('connection', (ws) => {
  const clientId = Math.random().toString(36).slice(2)
  // per-connection rate limit: protects the bridge now that it can be public.
  // The cap sits well above a 60Hz pointer drag, so local phones never hit it;
  // excess messages are dropped silently rather than killing the connection.
  const bucket = makeBucket(MAX_MSGS_PER_SEC)
  ws.send(JSON.stringify({ type: 'hello', channels: CHANNEL_NAMES }))

  ws.on('message', (raw) => {
    if (!takeToken(bucket)) return
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
      // edge event: forward immediately (last-write-wins across phones), unless
      // the performer has muted the crowd. Log it on the tick stream only when
      // it actually reached norns, so bridge_ticks reflects what norns received.
      const out = Math.round(value)
      const forwarded = sendDiscrete(ch.osc, out)
      if (forwarded && tickLog) {
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

// ---- feedback: norns -> phones --------------------------------------------
// When a parameter changes ON norns (an encoder, a pset load, a MIDI map),
// dspm_archive.lua pushes the new *normalised 0..1* value back on the same OSC
// path the phones use. Fan it out to every connected phone so their sliders/
// buttons/pads track the device, and log it as a session layer. Phones apply
// feedback to the UI only -- they never echo it -- so there's no loop.

function broadcast(obj) {
  const data = JSON.stringify(obj)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data)
  }
}

CHANNEL_NAMES.forEach((channel) => {
  osc.on(channel, (message) => {
    const value = Number(message.args && message.args[0])
    if (!Number.isFinite(value)) return
    broadcast({ path: channel, args: [value] })
    if (tickLog) {
      tickLog.write(JSON.stringify({ type: 'feedback', t: tNow(), channel, value }) + '\n')
    }
  })
})

// ---- fixed-rate tick: aggregate touches, send to norns, log the tick ------

setInterval(() => {
  if (!sessionDir) return
  if (!crowd.enabled) return // muted: forward nothing (raw intent still logged on receipt)
  const now = Date.now()
  const tick = { type: 'tick', t: tNow(), values: {} }
  for (const channel of CONTINUOUS_CHANNELS) {
    const active = [...touches[channel].values()]
    // fold in any live webhook holds, expiring stale ones as we go
    const holds = hookHolds[channel]
    for (const [ip, h] of holds) {
      if (now > h.expires) holds.delete(ip)
      else active.push({ value: h.value, ts: 0 })
    }
    if (active.length === 0) continue
    // mean aggregation across all phones (and live webhook holds) on this
    // channel, scaled by the performer's crowd gain; swap for last-write-wins or
    // sharded logic per docs/bridge-design.md if a different feel is wanted.
    const value = (active.reduce((sum, t) => sum + t.value, 0) / active.length) * crowd.gain
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

console.log(`[bridge] http + websocket on :${WS_PORT}, OSC -> ${NORNS_HOST}:${NORNS_PORT}, feedback in :${FEEDBACK_PORT}, tick ${TICK_MS}ms`)
console.log(`[bridge] serving PWA from ${PWA_DIR || '(disabled)'}`)
console.log(`[bridge] ${CHANNEL_NAMES.length} channels (${CONTINUOUS_CHANNELS.length} continuous, ${CHANNEL_NAMES.length - CONTINUOUS_CHANNELS.length} discrete)`)
console.log(`[bridge] remote: POST /hook/<osc-path>, /admin/crowd (${ADMIN_TOKEN ? 'token' : 'loopback-only'}); limits ws ${MAX_MSGS_PER_SEC}/s, hook ${HOOK_MAX_PER_SEC}/s/ip`)
