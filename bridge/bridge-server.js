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
const renderJobs = require('./render-jobs')

// ---- config -------------------------------------------------------------

const NORNS_HOST = process.env.NORNS_HOST || '10.42.0.1' // norns hotspot IP
const NORNS_PORT = parseInt(process.env.NORNS_PORT || '10111', 10)
// SSH pull of the norns tape WAV into the session folder when recording stops
// (see tape-pull.js). Needs passwordless SSH: bridge pubkey in
// we@norns:~/.ssh/authorized_keys. Set TAPE_PULL=0 to disable.
const TAPE_PULL = process.env.TAPE_PULL !== '0'
const { pullTape } = require('./tape-pull')
const WS_PORT = parseInt(process.env.BRIDGE_WS_PORT || '8081', 10)
// Interface the http/ws server binds to. Default '0.0.0.0' = reachable on the
// LAN (the venue/laptop rig). Behind a Cloudflare named tunnel on the Debian
// box, set BRIDGE_BIND='127.0.0.1': cloudflared connects locally, so nothing
// but the tunnel can reach the bridge. See DEPLOY-DEBIAN.md.
const BIND_ADDR = process.env.BRIDGE_BIND || '0.0.0.0'
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
// Cap media upload size so an authed-but-buggy (or token-leaked) POST can't fill
// the disk. Generous default for real video clips; tune via env.
const UPLOAD_MAX_BYTES = parseInt(process.env.BRIDGE_UPLOAD_MAX_BYTES || String(1024 * 1024 * 1024), 10) // 1 GiB
const HOOK_HOLD_MS = parseInt(process.env.BRIDGE_HOOK_HOLD_MS || '1000', 10) // continuous-hook hold

// Optional: mirror every OSC message to a TouchDesigner visual engine (see
// touchdesigner/). Unset TD_HOST -> no-op, behaviour identical to before.
const TD_HOST = process.env.TD_HOST || '' // e.g. '192.168.1.50'; '' disables
const TD_PORT = parseInt(process.env.TD_PORT || '7000', 10)

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

// ---- panic / full-patch reset baseline ------------------------------------
// The "nice patch" every control glides back to when a phone hits RESET (see
// panicReset + the {type:'reset'} WS message). Values are normalised 0..1
// exactly as phones send them; any continuous channel not listed falls back to
// 0.5 (neutral). start=1.0 / endpos=0.0 are the no-adjustment points for the
// per-voice loop bounds (norns maps them to a zero bias).
const BASELINE = {
  '/barcode/output_level': 0.8,
  '/barcode/pre_level': 1.0,
  '/barcode/rec_level': 1.0,
  '/param/filter_frequency': 0.85,
  '/param/filter_reso': 0.18,
  '/barcode/rate_slew': 0.05,
  '/barcode/pan_slew': 0.05,
  '/barcode/level_slew': 0.05,
}
const VOICE_BASELINE = {
  level: 0.5, pan: 0.5, rate: 0.5, direction: 0.5, start: 1.0, endpos: 0.0,
  level_lfo: 0.85, pan_lfo: 0.85, rate_lfo: 0.88, direction_lfo: 0.5, startend_lfo: 0.5,
}
for (let i = 1; i <= 6; i++) {
  for (const p of VOICE_PARAMS) BASELINE[`/barcode/v${i}/${p}`] = VOICE_BASELINE[p]
}
const baselineOf = (c) => (c in BASELINE ? BASELINE[c] : 0.5)

// Last continuous value actually forwarded to norns, per channel. The panic
// ramp starts from here so the reset glides instead of jumping.
const lastSent = {}
let panicking = false

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

// ---- session data helpers ------------------------------------------------

function readJsonlFile(fp) {
  try {
    return fs.readFileSync(fp, 'utf8')
      .split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line) } catch (e) { return null } })
      .filter(Boolean)
  } catch (e) { return [] }
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

// ---- norns targets --------------------------------------------------------
// Every OSC message bound for "norns" travels through sendToNorns(target, msg).
// A target is one of:
//   - kind 'udp':   a norns the bridge can reach directly over the LAN (home /
//                   venue rig). This is the default and the only target today,
//                   so behaviour is byte-for-byte identical to the old single-
//                   NORNS_HOST bridge.
//   - kind 'agent': a norns behind NAT (a venue, a friend's house) whose local
//                   agent dialed IN over WebSocket. We can't push UDP to it
//                   across the Cloudflare tunnel, so we hand the message to its
//                   socket and the agent re-emits it as OSC on its own LAN.
// This seam is the only change needed now to let a remote norns-agent slot in
// later (Phase 2 in DEPLOY-DEBIAN.md) without touching the tick loop, the
// discrete path, panic, or tape control -- they all just call sendOsc().
const defaultTarget = { id: 'default', kind: 'udp', host: NORNS_HOST, port: NORNS_PORT }

// The wire frame a remote agent receives and re-emits locally as OSC.
function oscFrame(message) {
  return JSON.stringify({ type: 'osc', path: message.address, args: message.args })
}

function sendToNorns(target, message) {
  if (target.kind === 'agent') {
    if (target.ws && target.ws.readyState === WebSocket.OPEN) target.ws.send(oscFrame(message))
    return
  }
  // local UDP norns. The TouchDesigner visual engine (if TD_HOST is set) is a
  // LAN box tied to this local rig, so mirror only on the udp path.
  osc.send(message, { host: target.host, port: target.port })
  if (TD_HOST) osc.send(message, { host: TD_HOST, port: TD_PORT })
}

// Send an OSC message to the default (home/venue) norns. Use this instead of
// osc.send(...) for anything the visuals should also react to.
function sendOsc(message) {
  sendToNorns(defaultTarget, message)
}

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
  sendOsc(new OSC.Message(oscPath, intVal))
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
    const ext = path.extname(fp)
    const headers = { 'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream' }
    // The app shell (HTML/JS/JSON) must always revalidate so a deploy takes effect
    // immediately -- otherwise Cloudflare's edge keeps serving stale code (e.g. an
    // old resolveBridgeUrl). Static assets (images/css) stay cacheable.
    if (ext === '.html' || ext === '.js' || ext === '.json' || ext === '.webmanifest') {
      headers['Cache-Control'] = 'no-cache'
    }
    res.writeHead(200, headers)
    res.end(data)
  })
}

// Proxy the icecast monitor stream so it's also reachable on the SAME origin as
// the PWA (https://<host>/radio.mp3). The norns' softcut output is published by
// darkice to the host icecast mount /norns.mp3; the dedicated public URL is
// https://radio.hetti.be/norns.mp3 -- this proxy is a same-origin convenience.
// Pure streaming pipe; no buffering. See deploy/norns-docker.
const RADIO_URL = process.env.RADIO_URL || 'http://127.0.0.1:8000/norns.mp3'
function handleRadio(req, res) {
  const u = new URL(RADIO_URL)
  const upstream = http.request(
    { host: u.hostname, port: u.port || 80, path: u.pathname, method: 'GET', headers: { 'User-Agent': 'dspm-bridge' } },
    (up) => {
      res.writeHead(up.statusCode || 502, {
        'Content-Type': up.headers['content-type'] || 'audio/mpeg',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'close',
      })
      up.pipe(res)
    }
  )
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('radio unavailable') })
  req.on('close', () => upstream.destroy())
  upstream.end()
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

// Auth for privileged routes (/admin and the mutating /api endpoints). If a
// BRIDGE_ADMIN_TOKEN is set it must match (?token= or x-admin-token header), and
// the route works from anywhere; if it's unset, the route is loopback-only (the
// bridge machine itself). Behind the tunnel every request carries a forwarding
// header, so loopback can never be spoofed from the public side.
function isAuthed(req, urlObj) {
  return ADMIN_TOKEN
    ? (urlObj.searchParams.get('token') || req.headers['x-admin-token']) === ADMIN_TOKEN
    : isLoopback(req)
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
  if (!isAuthed(req, urlObj)) return sendJson(res, 403, { error: 'forbidden' })

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

// ---- tape recording state ------------------------------------------------

const rec = { active: false, name: null, startT: null }

function updateManifestRecording(endT) {
  if (!sessionDir) return
  try {
    const m = JSON.parse(fs.readFileSync(path.join(sessionDir, 'manifest.json'), 'utf8'))
    m.recording = { name: rec.name, start_t: rec.startT, end_t: endT || null }
    fs.writeFileSync(path.join(sessionDir, 'manifest.json'), JSON.stringify(m, null, 2))
  } catch (e) {}
}


// ---- archive session API -------------------------------------------------

function listSessions() {
  try {
    return fs.readdirSync(SESSIONS_DIR)
      .filter(name => {
        try { return fs.statSync(path.join(SESSIONS_DIR, name)).isDirectory() } catch (e) { return false }
      })
      .map(name => {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, name, 'manifest.json'), 'utf8'))
          return { id: name, t0: m.t0, duration: m.duration_sec, title: m.recording && m.recording.name || null }
        } catch (e) { return null }
      })
      .filter(s => s && s.t0)
      .sort((a, b) => b.t0 - a.t0)
  } catch (e) { return [] }
}

function serveMedia(req, res, fp) {
  fs.stat(fp, (err, stat) => {
    if (err) { res.writeHead(404); return res.end() }
    const ext = path.extname(fp).toLowerCase()
    const mime = {
      '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
      '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
    }[ext] || 'application/octet-stream'
    const range = req.headers.range
    if (range) {
      const [s, e] = range.replace(/bytes=/, '').split('-')
      const start = parseInt(s, 10)
      const end = e ? parseInt(e, 10) : stat.size - 1
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': mime,
      })
      fs.createReadStream(fp, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' })
      fs.createReadStream(fp).pipe(res)
    }
  })
}

function handleApi(req, res, urlObj) {
  // Every mutating /api endpoint (recording start/stop, upload, edit, sync,
  // render) can drive norns, write to disk, or spawn renderers -- gate them like
  // /admin. Reads (GET: session list/manifest/ticks/media, job + recording
  // state) stay open; restrict those further at the edge with Cloudflare Access
  // if the archive shouldn't be public on this hostname.
  if (req.method !== 'GET' && !isAuthed(req, urlObj)) {
    return sendJson(res, 403, { error: 'forbidden' })
  }

  const parts = urlObj.pathname.replace(/^\/api/, '').split('/').filter(Boolean)
  const SESSIONS_ROOT = path.resolve(SESSIONS_DIR)

  // recording control
  if (parts[0] === 'recording') {
    if (parts[1] === 'state') {
      return sendJson(res, 200, {
        active: rec.active, name: rec.name, start_t: rec.startT,
        elapsed: rec.active ? tNow() - rec.startT : null,
        session_id: sessionId,
      })
    }
    if (parts[1] === 'start' && req.method === 'POST') {
      return readBody(req, body => {
        let name = 'untitled'
        try { name = (JSON.parse(body).name || '').trim() || name } catch (e) {}
        rec.active = true; rec.name = name; rec.startT = tNow()
        sendOsc(new OSC.Message('/dspm/tape/start', name))
        updateManifestRecording()
        broadcast({ type: 'rec_state', active: true, name, start_t: rec.startT, session_id: sessionId })
        sendJson(res, 200, { ok: true, name, start_t: rec.startT, session_id: sessionId })
      })
    }
    if (parts[1] === 'stop' && req.method === 'POST') {
      if (!rec.active) return sendJson(res, 400, { error: 'not recording' })
      const endT = tNow()
      const dur = endT - rec.startT
      sendOsc(new OSC.Message('/dspm/tape/stop'))
      updateManifestRecording(endT)
      broadcast({ type: 'rec_state', active: false, name: rec.name, start_t: rec.startT, end_t: endT, duration: dur, session_id: sessionId })
      const result = { ok: true, name: rec.name, start_t: rec.startT, end_t: endT, duration: dur, session_id: sessionId }
      // Pull the just-recorded tape WAV off the norns into this session folder.
      // Fire-and-forget: the response returns immediately, the scp runs in the
      // background and sets manifest.tape_file when it lands.
      if (TAPE_PULL && rec.name && sessionDir) {
        const sid = sessionId, sdir = sessionDir
        pullTape(sdir, rec.name, { host: NORNS_HOST }, (err, dest) => {
          if (!err) broadcast({ type: 'tape_ready', session_id: sid, file: path.basename(dest) })
        })
      }
      rec.active = false; rec.name = null; rec.startT = null
      return sendJson(res, 200, result)
    }
  }

  // render/sync job status
  if (parts[0] === 'jobs') {
    if (parts[1]) {
      const j = renderJobs.get(parts[1])
      return j ? sendJson(res, 200, j) : sendJson(res, 404, { error: 'no such job' })
    }
    return sendJson(res, 200, renderJobs.list())
  }

  if (parts[0] === 'sessions' && parts.length === 1) {
    return sendJson(res, 200, listSessions())
  }

  if (parts[0] === 'sessions' && parts.length >= 2) {
    const id = parts[1]
    const sDir = path.resolve(path.join(SESSIONS_DIR, id))
    if (!sDir.startsWith(SESSIONS_ROOT + path.sep) && sDir !== SESSIONS_ROOT) {
      return sendJson(res, 403, { error: 'forbidden' })
    }
    if (!fs.existsSync(sDir)) return sendJson(res, 404, { error: 'session not found' })

    const sub = parts[2]

    if (!sub) {
      try {
        const data = fs.readFileSync(path.join(sDir, 'manifest.json'))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(data)
      } catch (e) { return sendJson(res, 404, { error: 'no manifest' }) }
    }

    if (sub === 'ticks') {
      const data = readJsonlFile(path.join(sDir, 'bridge_ticks.jsonl'))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(data))
    }

    if (sub === 'media') {
      const file = parts[3]
      if (!file) {
        try {
          const files = fs.readdirSync(sDir).filter(f => /\.(mp4|mov|webm|wav|mp3|ogg)$/i.test(f))
          return sendJson(res, 200, files)
        } catch (e) { return sendJson(res, 200, []) }
      }
      if (/[/\\]/.test(file)) return sendJson(res, 403, { error: 'forbidden' })
      const fp = path.resolve(path.join(sDir, file))
      if (!fp.startsWith(sDir)) return sendJson(res, 403, { error: 'forbidden' })
      return serveMedia(req, res, fp)
    }

    if (sub === 'upload' && req.method === 'POST') {
      const file = parts[3]
      if (!file || /[/\\]/.test(file)) return sendJson(res, 400, { error: 'bad filename' })
      const fp = path.join(sDir, file)
      const out = fs.createWriteStream(fp)
      let written = 0
      let tooBig = false
      req.on('data', (chunk) => {
        if (tooBig) return
        written += chunk.length
        if (written > UPLOAD_MAX_BYTES) {
          tooBig = true
          req.destroy()
          out.destroy()
          fs.unlink(fp, () => {}) // don't leave a truncated partial on disk
          return sendJson(res, 413, { error: 'file too large', max_bytes: UPLOAD_MAX_BYTES })
        }
      })
      req.pipe(out)
      out.on('finish', () => { if (!tooBig) sendJson(res, 200, { ok: true, file }) })
      out.on('error', () => { if (!tooBig) sendJson(res, 500, { error: 'write failed' }) })
      return
    }

    // persist the edit decision list (offsets are written by sync; this saves
    // the social cut, chapters, master settings the web editor produces)
    if (sub === 'edit' && req.method === 'POST') {
      return readBody(req, (body) => {
        let edit
        try {
          edit = JSON.parse(body)
        } catch (e) {
          return sendJson(res, 400, { error: 'bad json' })
        }
        try {
          const mp = path.join(sDir, 'manifest.json')
          const m = JSON.parse(fs.readFileSync(mp, 'utf8'))
          if (edit.edit) m.edit = edit.edit
          if (Array.isArray(edit.media)) m.media = edit.media // hand-nudged offsets
          fs.writeFileSync(mp, JSON.stringify(m, null, 2))
          return sendJson(res, 200, { ok: true })
        } catch (e) {
          return sendJson(res, 500, { error: 'write failed: ' + e.message })
        }
      })
    }

    // list rendered outputs recorded in the manifest
    if (sub === 'renders') {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(sDir, 'manifest.json'), 'utf8'))
        return sendJson(res, 200, Array.isArray(m.renders) ? m.renders : [])
      } catch (e) {
        return sendJson(res, 200, [])
      }
    }

    // re-run multi-clip auto-sync
    if (sub === 'sync' && req.method === 'POST') {
      return readBody(req, (body) => {
        let opts = {}
        try {
          opts = body ? JSON.parse(body) : {}
        } catch (e) {}
        const job = renderJobs.syncMedia(id, opts)
        return sendJson(res, 202, job)
      })
    }

    // kick off a render: /render/social  (master + dvd land in phase 6)
    if (sub === 'render' && req.method === 'POST') {
      const kind = parts[3]
      return readBody(req, (body) => {
        let opts = {}
        try {
          opts = body ? JSON.parse(body) : {}
        } catch (e) {}
        if (kind === 'social') return sendJson(res, 202, renderJobs.renderSocial(id, opts))
        if (kind === 'master') return sendJson(res, 202, renderJobs.renderMaster(id, opts))
        if (kind === 'dvd') return sendJson(res, 202, renderJobs.renderDvd(id, opts))
        return sendJson(res, 400, { error: 'unknown render kind: ' + kind })
      })
    }
  }

  sendJson(res, 404, { error: 'not found' })
}

const PERFORMER_LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>performer · token required</title>
<style>
  body { margin: 0; background: #0a0a0c; color: #e8e8ec; font-family: 'Courier New', monospace;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  form { display: flex; flex-direction: column; gap: 12px; width: min(340px, 90vw); }
  h1 { font-size: 13px; letter-spacing: 0.2em; text-transform: uppercase; color: #8a8a92; margin: 0 0 8px; }
  input { background: #141418; border: 1px solid #2a2a30; border-radius: 5px; color: #e8e8ec;
          font-family: inherit; font-size: 15px; padding: 12px 14px; outline: none; }
  input:focus { border-color: #ff3b30; }
  button { background: #ff3b30; border: none; border-radius: 6px; color: #fff;
           font-family: inherit; font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase;
           padding: 13px; cursor: pointer; }
  .err { color: #ff3b30; font-size: 11px; display: none; }
</style></head><body>
<form id="f">
  <h1>||| barcode /// performer</h1>
  <input type="password" id="t" placeholder="admin token" autocomplete="current-password">
  <div class="err" id="e">wrong token</div>
  <button type="submit">enter</button>
</form>
<script>
  document.getElementById('f').addEventListener('submit', function(ev) {
    ev.preventDefault();
    const tok = document.getElementById('t').value.trim();
    if (!tok) return;
    fetch('/performer.html?token=' + encodeURIComponent(tok))
      .then(function(r) {
        if (r.ok) { location.href = '/performer.html?token=' + encodeURIComponent(tok); }
        else { document.getElementById('e').style.display = 'block'; }
      }).catch(function() { document.getElementById('e').style.display = 'block'; });
  });
</script>
</body></html>`

function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  const urlObj = new URL(req.url, 'http://localhost')
  const host = (req.headers.host || '').split(':')[0]
  if (host === 'dash.hetti.be' && urlObj.pathname === '/') {
    req.url = '/dashboard.html'
    return serveStatic(req, res)
  }
  if (urlObj.pathname === '/admin/crowd') return handleAdmin(req, res, urlObj)
  if (urlObj.pathname.startsWith('/hook/')) return handleHook(req, res, urlObj)
  if (urlObj.pathname.startsWith('/api/')) return handleApi(req, res, urlObj)
  if (urlObj.pathname === '/radio.mp3') return handleRadio(req, res)
  // Gate performer.html behind the admin token when one is configured.
  // Without a valid token the bridge returns a password-entry page instead.
  if (urlObj.pathname === '/performer.html' && ADMIN_TOKEN && !isAuthed(req, urlObj)) {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
    return res.end(PERFORMER_LOGIN_HTML)
  }
  return serveStatic(req, res)
}

const httpServer = http.createServer(handleRequest)
httpServer.listen(WS_PORT, BIND_ADDR)

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

    // full-patch panic / reset, triggered from either the audience or performer
    // page. Open to any phone on purpose (it only restores a known-good patch --
    // it can't silence or erase anything) so the host can hit it from whatever
    // device is in hand.
    if (msg.type === 'reset') { panicReset(); return }

    // archive playback commands from the viewer page
    if (msg.type === 'pb_cmd') {
      const { action, id, t } = msg
      const SESSIONS_ROOT = path.resolve(SESSIONS_DIR)
      if (action === 'load' && id) {
        const sDir = path.resolve(path.join(SESSIONS_DIR, id))
        if (sDir.startsWith(SESSIONS_ROOT) && fs.existsSync(sDir)) {
          pbLoad(id)
          broadcast({ type: 'pb', t: 0, playing: false, id, loaded: true })
        }
      } else if (action === 'play') {
        pbPlay()
      } else if (action === 'pause') {
        pbStop()
        broadcast({ type: 'pb', t: pb.t, playing: false, id: pb.sessionId })
      } else if (action === 'seek' && Number.isFinite(Number(t))) {
        pb.t = Number(t)
        if (pb.playing) { pb.wallStart = Date.now(); pb.tStart = pb.t }
        pbApply(pb.t)
      } else if (action === 'unload') {
        pbUnload()
        broadcast({ type: 'pb', playing: false, loaded: false })
      }
      return
    }

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
      // fan out to other phones immediately so all UIs stay in sync
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ path: msg.channel, args: [value] }))
        }
      }
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

// render/sync jobs push progress over the same broadcast channel
renderJobs.init(broadcast)

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

// ---- archive playback engine ---------------------------------------------
// Replays a recorded session to norns by injecting a ghost client into the
// touches map. Real phones blend with the ghost via the normal averaging --
// more phones = more crowd influence, fewer = more recording influence.

const PB_ID = '__playback__'
const pb = {
  active: false, sessionId: null, ticks: [], t: 0,
  playing: false, wallStart: 0, tStart: 0, timer: null,
}

function pbLoad(id) {
  pbStop()
  pb.ticks = readJsonlFile(path.join(SESSIONS_DIR, id, 'bridge_ticks.jsonl'))
    .filter(e => e.type === 'tick')
  pb.sessionId = id
  pb.active = true
  pb.t = 0
}

function pbApply(t) {
  if (!pb.active || !pb.ticks.length) return
  let best = pb.ticks[0]
  for (const tk of pb.ticks) { if (tk.t <= t) best = tk; else break }
  if (best && best.values) {
    for (const [ch, v] of Object.entries(best.values)) {
      if (touches[ch]) touches[ch].set(PB_ID, { value: v, ts: 0 })
    }
  }
  broadcast({ type: 'pb', t, playing: pb.playing, id: pb.sessionId })
}

function pbPlay() {
  if (!pb.active) return
  pb.playing = true
  pb.wallStart = Date.now()
  pb.tStart = pb.t
  if (pb.timer) clearInterval(pb.timer)
  pb.timer = setInterval(() => {
    if (!pb.playing) return
    pb.t = pb.tStart + (Date.now() - pb.wallStart) / 1000
    const last = pb.ticks[pb.ticks.length - 1]
    if (last && pb.t >= last.t) {
      pb.t = last.t
      pbStop()
      broadcast({ type: 'pb', t: pb.t, playing: false, id: pb.sessionId, ended: true })
      return
    }
    pbApply(pb.t)
  }, TICK_MS)
}

function pbStop() {
  pb.playing = false
  if (pb.timer) { clearInterval(pb.timer); pb.timer = null }
  CHANNEL_NAMES.forEach(c => touches[c] && touches[c].delete(PB_ID))
}

function pbUnload() {
  pbStop()
  pb.active = false; pb.sessionId = null; pb.ticks = []; pb.t = 0
}

// ---- fixed-rate tick: aggregate touches, send to norns, log the tick ------

setInterval(() => {
  if (!sessionDir) return
  if (panicking) return // a reset ramp owns norns for its duration (see panicReset)
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
    lastSent[channel] = value
    sendOsc(new OSC.Message(CHANNELS[channel].osc, value))
  }
  if (Object.keys(tick.values).length > 0 && tickLog) {
    tickLog.write(JSON.stringify(tick) + '\n')
  }
}, TICK_MS)

// ---- full-patch panic / reset ---------------------------------------------
// Smoothly ramps every continuous param to BASELINE over ~1.5s and flips
// reverse/quantize off, then wipes accumulated crowd touches so nothing
// lingers afterward. NOT a norns restart -- the loop buffer and tape recording
// are untouched. Sends straight to norns and broadcasts each step so every
// phone's UI tracks the glide, and runs even while the crowd is muted (a reset
// has to work in an emergency). The tick loop pauses while panicking is true.
function panicReset() {
  if (panicking) return
  panicking = true
  CHANNEL_NAMES.forEach((c) => touches[c] && touches[c].clear())
  CONTINUOUS_CHANNELS.forEach((c) => hookHolds[c] && hookHolds[c].clear())

  // discrete: reverse + quantize off (recording/clear are deliberately left alone)
  for (const d of ['/param/reverse', '/param/quantize']) {
    sendOsc(new OSC.Message(d, 0))
    broadcast({ path: d, args: [0] })
  }

  const from = {}
  for (const c of CONTINUOUS_CHANNELS) from[c] = (c in lastSent) ? lastSent[c] : baselineOf(c)
  const start = Date.now()
  const DUR = 1500
  const timer = setInterval(() => {
    const p = Math.min(1, (Date.now() - start) / DUR)
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
    for (const c of CONTINUOUS_CHANNELS) {
      const v = from[c] + (baselineOf(c) - from[c]) * e
      lastSent[c] = v
      sendOsc(new OSC.Message(c, v))
      broadcast({ path: c, args: [v] })
    }
    if (p >= 1) {
      clearInterval(timer)
      CHANNEL_NAMES.forEach((c) => touches[c] && touches[c].clear()) // drop fingers added mid-ramp
      panicking = false
      if (tickLog) tickLog.write(JSON.stringify({ type: 'reset', t: tNow() }) + '\n')
    }
  }, TICK_MS)
}

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

console.log(`[bridge] http + websocket on ${BIND_ADDR}:${WS_PORT}, OSC -> ${NORNS_HOST}:${NORNS_PORT}, feedback in :${FEEDBACK_PORT}, tick ${TICK_MS}ms`)
console.log(`[bridge] serving PWA from ${PWA_DIR || '(disabled)'}`)
console.log(`[bridge] ${CHANNEL_NAMES.length} channels (${CONTINUOUS_CHANNELS.length} continuous, ${CHANNEL_NAMES.length - CONTINUOUS_CHANNELS.length} discrete)`)
console.log(`[bridge] remote: POST /hook/<osc-path>, /admin/crowd (${ADMIN_TOKEN ? 'token' : 'loopback-only'}); limits ws ${MAX_MSGS_PER_SEC}/s, hook ${HOOK_MAX_PER_SEC}/s/ip`)
