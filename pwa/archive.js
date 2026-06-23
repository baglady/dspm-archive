// ============================================================
// ARCHIVE VIEWER
// Session browser + parameter timeline + video player + bridge playback
// ============================================================

// ---- bridge URL (mirrors app.js resolution) --------------------------------
const _params = new URLSearchParams(location.search)
const _proto = location.protocol === 'https:' ? 'wss://' : 'ws://'
const BRIDGE_PORT = '8081'

function resolveBridgeUrl() {
  const override = _params.get('bridge')
  if (override) return /^wss?:\/\//.test(override) ? override : _proto + override
  if (location.pathname.includes('/proxy/')) {
    return _proto + location.host +
      location.pathname.replace(/\/proxy\/\d+\/.*/, '/proxy/' + BRIDGE_PORT + '/')
  }
  return _proto + location.hostname + ':' + BRIDGE_PORT
}

const BRIDGE_URL = resolveBridgeUrl()
const API_BASE = BRIDGE_URL.replace(/^wss?:\/\//, 'http' + (BRIDGE_URL.startsWith('wss') ? 's' : '') + '://')
  .replace(/\/$/, '')

// Mutating /api calls (edit/render/sync/upload) require the bridge admin token
// when one is configured. Reads are open. The performer opens the editor with
// ?token=<BRIDGE_ADMIN_TOKEN> (or ?admin=); on the bridge machine itself it's
// loopback so no token is needed. authHeaders() folds it onto fetch headers.
const ADMIN_TOKEN = _params.get('token') || _params.get('admin') || ''
function authHeaders(extra) {
  const h = Object.assign({}, extra || {})
  if (ADMIN_TOKEN) h['x-admin-token'] = ADMIN_TOKEN
  return h
}

// ---- channel color palette -------------------------------------------------
const VOICE_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db']
const GLOBAL_COLOR = '#c8c8d0'
const FILTER_COLOR = '#9b59b6'

function channelColor(ch) {
  const m = ch.match(/\/barcode\/v(\d)\//)
  if (m) {
    const idx = parseInt(m[1]) - 1
    const base = VOICE_COLORS[idx] || '#fff'
    // dim LFO params slightly
    if (ch.includes('_lfo')) return base + 'aa'
    return base
  }
  if (ch.includes('filter')) return FILTER_COLOR
  return GLOBAL_COLOR
}

const DEFAULT_VISIBLE = new Set([
  '/barcode/output_level',
  '/param/filter_frequency',
  '/barcode/v1/rate', '/barcode/v2/rate', '/barcode/v3/rate',
  '/barcode/v4/rate', '/barcode/v5/rate', '/barcode/v6/rate',
])

// ---- state -----------------------------------------------------------------
let sessions = []
let currentId = null
let allTicks = []       // raw tick entries from bridge_ticks.jsonl
let duration = 0        // session duration in seconds
let channelSeries = {}  // channel -> {times: number[], values: number[]}
let allChannels = []    // sorted channel list from tick data
let visibleChannels = new Set(DEFAULT_VISIBLE)
let pbT = 0             // current playback position (seconds)
let pbPlaying = false
let pbLoaded = false
let videoOffset = 0     // video time = pbT + videoOffset
let ws = null
let draggingScrub = false
let draggingTimeline = false
let hoverT = null       // timeline hover time

// ---- DOM refs --------------------------------------------------------------
const statusEl = document.getElementById('ws-status')
const sessionItemsEl = document.getElementById('session-items')
const emptyEl = document.getElementById('empty-state')
const videoWrapEl = document.getElementById('video-wrap')
const videoEl = document.getElementById('main-video')
const videoOffsetEl = document.getElementById('video-offset')
const timelineWrapEl = document.getElementById('timeline-wrap')
const tlDurationEl = document.getElementById('tl-duration')
const canvasEl = document.getElementById('timeline-canvas')
const ctx = canvasEl.getContext('2d')
const controlsEl = document.getElementById('controls')
const playBtn = document.getElementById('play-btn')
const timeDisplayEl = document.getElementById('time-display')
const scrubTrackEl = document.getElementById('scrub-track')
const scrubFillEl = document.getElementById('scrub-fill')
const scrubThumbEl = document.getElementById('scrub-thumb')
const remixLinkEl = document.getElementById('remix-link')
const legendEl = document.getElementById('legend')
const tooltipEl = document.getElementById('tooltip')

// ---- WebSocket -------------------------------------------------------------
function connectWS() {
  try { ws = new WebSocket(BRIDGE_URL) } catch (e) { return }
  ws.onopen = () => { statusEl.textContent = 'live'; statusEl.classList.add('live') }
  ws.onclose = () => {
    statusEl.textContent = 'offline'; statusEl.classList.remove('live')
    setTimeout(connectWS, 2000)
  }
  ws.onerror = () => {}
  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data)
      if (msg && msg.type === 'pb') onPbMsg(msg)
      else if (msg && msg.type === 'render_job' && typeof onRenderJob === 'function') onRenderJob(msg.job)
    } catch (e) {}
  }
}

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
}

function onPbMsg(msg) {
  if (msg.loaded === false) { pbLoaded = false; pbPlaying = false }
  if (msg.loaded === true) pbLoaded = true
  if (msg.id && msg.id !== currentId) return
  if (typeof msg.t === 'number') pbT = msg.t
  if (typeof msg.playing === 'boolean') pbPlaying = msg.playing
  updatePlayBtn()
  updateScrub()
  updateTimeDisplay()
  syncVideo()
}

// ---- session list ----------------------------------------------------------
async function loadSessions() {
  try {
    const r = await fetch(API_BASE + '/api/sessions')
    sessions = await r.json()
  } catch (e) { sessions = [] }
  renderSessionList()
}

function renderSessionList() {
  sessionItemsEl.innerHTML = ''
  if (!sessions.length) {
    sessionItemsEl.innerHTML = '<div style="padding:14px;font-size:11px;color:var(--text-dim)">no sessions yet</div>'
    return
  }
  for (const s of sessions) {
    const item = document.createElement('div')
    item.className = 'session-item' + (s.id === currentId ? ' active' : '')
    item.dataset.id = s.id

    const date = s.t0 ? new Date(s.t0 * 1000).toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }) : s.id

    const dur = s.duration ? formatTime(s.duration) : '—'
    const title = s.title ? `<div class="session-title">${s.title}</div>` : ''

    item.innerHTML = `${title}<div class="session-date">${date}</div><div class="session-meta">${dur}</div>`
    item.addEventListener('click', () => openSession(s.id))
    sessionItemsEl.appendChild(item)
  }
}

// ---- open session ----------------------------------------------------------
async function openSession(id) {
  currentId = id
  pbLoaded = false; pbPlaying = false; pbT = 0

  // Highlight in list
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id)
  })

  emptyEl.style.display = 'none'

  // Load ticks
  try {
    const r = await fetch(API_BASE + '/api/sessions/' + encodeURIComponent(id) + '/ticks')
    allTicks = await r.json()
  } catch (e) { allTicks = [] }

  processTicks()
  renderTimeline()
  renderLegend()

  // Load manifest for video_offset
  try {
    const r = await fetch(API_BASE + '/api/sessions/' + encodeURIComponent(id))
    const manifest = await r.json()
    if (typeof manifest.video_offset === 'number') {
      videoOffset = manifest.video_offset
      videoOffsetEl.value = videoOffset.toFixed(3)
    } else {
      videoOffset = 0
      videoOffsetEl.value = '0'
    }
    // hand the manifest to the multi-clip editor (editor.js)
    if (typeof editorOnSession === 'function') editorOnSession(id, manifest)
  } catch (e) {}

  // Check for video
  try {
    const r = await fetch(API_BASE + '/api/sessions/' + encodeURIComponent(id) + '/media')
    const files = await r.json()
    const vid = files.find(f => /\.(mp4|mov|webm)$/i.test(f))
    if (vid) {
      videoEl.src = API_BASE + '/api/sessions/' + encodeURIComponent(id) + '/media/' + encodeURIComponent(vid)
      videoEl.load()
      videoWrapEl.classList.add('has-video')
    } else {
      videoEl.src = ''
      videoWrapEl.classList.remove('has-video')
    }
  } catch (e) { videoWrapEl.classList.remove('has-video') }

  // Load into bridge playback
  wsSend({ type: 'pb_cmd', action: 'load', id })

  // Update remix link
  remixLinkEl.href = location.origin + location.pathname.replace('archive.html', 'index.html') +
    (_params.get('bridge') ? '?bridge=' + encodeURIComponent(_params.get('bridge')) : '')

  timelineWrapEl.classList.add('ready')
  controlsEl.classList.add('ready')
  legendEl.classList.add('ready')
  updateTimeDisplay()
  updateScrub()
}

// ---- tick data processing --------------------------------------------------
function processTicks() {
  const raw = allTicks.filter(e => e.type === 'tick')
  duration = raw.length ? raw[raw.length - 1].t : 0
  tlDurationEl.textContent = formatTime(duration)
  channelSeries = {}
  for (const tick of raw) {
    for (const [ch, v] of Object.entries(tick.values || {})) {
      if (!channelSeries[ch]) channelSeries[ch] = { times: [], values: [] }
      channelSeries[ch].times.push(tick.t)
      channelSeries[ch].values.push(v)
    }
  }
  allChannels = Object.keys(channelSeries).sort()
}

// ---- timeline canvas -------------------------------------------------------
let rafId = null

function renderTimeline() {
  resizeCanvas()
  drawTimeline()
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1
  const w = canvasEl.offsetWidth
  const h = canvasEl.offsetHeight
  canvasEl.width = w * dpr
  canvasEl.height = h * dpr
  ctx.scale(dpr, dpr)
}

function drawTimeline() {
  const w = canvasEl.offsetWidth
  const h = canvasEl.offsetHeight
  ctx.clearRect(0, 0, w, h)

  if (!duration || !allChannels.length) return

  // background grid lines (horizontal at 0.25, 0.5, 0.75)
  ctx.strokeStyle = '#2a2a30'
  ctx.lineWidth = 1
  for (const y of [0.25, 0.5, 0.75]) {
    const py = h - y * h
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke()
  }

  // draw each visible channel
  for (const ch of allChannels) {
    if (!visibleChannels.has(ch)) continue
    const series = channelSeries[ch]
    if (!series || !series.times.length) continue
    const color = channelColor(ch)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.globalAlpha = color.length > 7 ? 0.6 : 0.85
    ctx.beginPath()
    let first = true
    for (let i = 0; i < series.times.length; i++) {
      const x = (series.times[i] / duration) * w
      const y = h - series.values[i] * h
      if (first) { ctx.moveTo(x, y); first = false } else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // hover time marker
  if (hoverT !== null) {
    const hx = (hoverT / duration) * w
    ctx.strokeStyle = '#ffffff44'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.stroke()
  }

  // playback cursor
  if (duration > 0) {
    const cx = (pbT / duration) * w
    ctx.strokeStyle = '#ff3b30'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke()
    // small triangle at top
    ctx.fillStyle = '#ff3b30'
    ctx.beginPath(); ctx.moveTo(cx - 5, 0); ctx.lineTo(cx + 5, 0); ctx.lineTo(cx, 7); ctx.fill()
  }
}

// timeline interaction
function timeFromCanvasX(clientX) {
  const rect = canvasEl.getBoundingClientRect()
  const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  return nx * duration
}

canvasEl.addEventListener('pointerdown', (e) => {
  draggingTimeline = true
  canvasEl.setPointerCapture(e.pointerId)
  const t = timeFromCanvasX(e.clientX)
  seekTo(t)
})

canvasEl.addEventListener('pointermove', (e) => {
  const rect = canvasEl.getBoundingClientRect()
  hoverT = timeFromCanvasX(e.clientX)
  if (draggingTimeline) seekTo(hoverT)
  showTooltip(e, hoverT)
  drawTimeline()
})

canvasEl.addEventListener('pointerup', () => { draggingTimeline = false })
canvasEl.addEventListener('pointercancel', () => { draggingTimeline = false })
canvasEl.addEventListener('pointerleave', () => {
  hoverT = null; tooltipEl.style.display = 'none'; drawTimeline()
})

function showTooltip(e, t) {
  const lines = [`${formatTime(t)}`]
  for (const ch of allChannels) {
    if (!visibleChannels.has(ch)) continue
    const series = channelSeries[ch]
    if (!series) continue
    // find closest value
    let best = 0
    for (let i = 0; i < series.times.length; i++) {
      if (series.times[i] <= t) best = i; else break
    }
    const label = ch.replace('/barcode/', '').replace('/param/', '')
    lines.push(`${label}: ${series.values[best].toFixed(2)}`)
  }
  tooltipEl.innerHTML = lines.join('<br>')
  tooltipEl.style.display = 'block'
  const tx = e.clientX + 14
  const ty = e.clientY - 10
  tooltipEl.style.left = Math.min(tx, window.innerWidth - 210) + 'px'
  tooltipEl.style.top = ty + 'px'
}

// ---- scrub bar -------------------------------------------------------------
function scrubFraction() { return duration > 0 ? Math.min(1, pbT / duration) : 0 }

function updateScrub() {
  const pct = (scrubFraction() * 100).toFixed(2) + '%'
  scrubFillEl.style.width = pct
  scrubThumbEl.style.left = pct
  drawTimeline()
}

scrubTrackEl.addEventListener('pointerdown', (e) => {
  draggingScrub = true
  scrubTrackEl.setPointerCapture(e.pointerId)
  scrubTo(e)
})
scrubTrackEl.addEventListener('pointermove', (e) => { if (draggingScrub) scrubTo(e) })
scrubTrackEl.addEventListener('pointerup', () => { draggingScrub = false })
scrubTrackEl.addEventListener('pointercancel', () => { draggingScrub = false })

function scrubTo(e) {
  const rect = scrubTrackEl.getBoundingClientRect()
  const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  seekTo(nx * duration)
}

// ---- playback controls -----------------------------------------------------
function seekTo(t) {
  pbT = Math.max(0, Math.min(duration, t))
  wsSend({ type: 'pb_cmd', action: 'seek', t: pbT })
  updateScrub()
  updateTimeDisplay()
  syncVideo()
  drawTimeline()
}

playBtn.addEventListener('click', () => {
  if (!pbLoaded) return
  if (pbPlaying) {
    wsSend({ type: 'pb_cmd', action: 'pause' })
  } else {
    wsSend({ type: 'pb_cmd', action: 'play' })
  }
})

function updatePlayBtn() {
  if (pbPlaying) {
    playBtn.textContent = '⏸ PAUSE'
    playBtn.classList.add('active')
  } else {
    playBtn.textContent = '▶ PLAY'
    playBtn.classList.remove('active')
  }
}

function updateTimeDisplay() {
  timeDisplayEl.textContent = formatTime(pbT) + ' / ' + formatTime(duration)
}

// ---- video sync ------------------------------------------------------------
function syncVideo() {
  if (!videoEl.src) return
  const target = pbT + videoOffset
  if (Math.abs(videoEl.currentTime - target) > 0.3) videoEl.currentTime = Math.max(0, target)
  if (pbPlaying && videoEl.paused) videoEl.play().catch(() => {})
  if (!pbPlaying && !videoEl.paused) videoEl.pause()
}

videoOffsetEl.addEventListener('change', () => {
  videoOffset = parseFloat(videoOffsetEl.value) || 0
  syncVideo()
})

// ---- legend ----------------------------------------------------------------
function renderLegend() {
  legendEl.innerHTML = ''
  for (const ch of allChannels) {
    const item = document.createElement('div')
    item.className = 'legend-item' + (visibleChannels.has(ch) ? ' on' : '')
    const dot = document.createElement('div')
    dot.className = 'legend-dot'
    dot.style.background = channelColor(ch)
    const label = document.createElement('span')
    label.textContent = ch.replace('/barcode/', '').replace('/param/', '')
    item.appendChild(dot)
    item.appendChild(label)
    item.addEventListener('click', () => {
      if (visibleChannels.has(ch)) visibleChannels.delete(ch)
      else visibleChannels.add(ch)
      item.classList.toggle('on', visibleChannels.has(ch))
      drawTimeline()
    })
    legendEl.appendChild(item)
  }
}

// ---- resize ----------------------------------------------------------------
const ro = new ResizeObserver(() => {
  if (currentId) { resizeCanvas(); drawTimeline() }
})
ro.observe(canvasEl)

// ---- animation loop for smooth scrub during playback ----------------------
function tick() {
  if (pbPlaying) {
    updateScrub()
    updateTimeDisplay()
  }
  requestAnimationFrame(tick)
}

// ---- helpers ---------------------------------------------------------------
function formatTime(s) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return m + ':' + String(sec).padStart(2, '0')
}

// ---- init ------------------------------------------------------------------
connectWS()
loadSessions()
requestAnimationFrame(tick)
