#!/usr/bin/env node
'use strict'

// ============================================================
// render-viz.js  --  automation-viz video renderer
//
// Turns a session's parameter stream (bridge_ticks.jsonl) into a motion-
// graphics video: no camera, just the live OSC data animated in the dspm
// voice palette, with the performance audio bed muxed underneath. This is
// the "social" output (default 9:16 vertical), but it renders any aspect.
//
// Pipeline:
//   ticks -> per-channel state sampler -> canvas frames -> ffmpeg -> mp4
//   media[] audio clips -> aligned/mixed audio bed -> muxed into the mp4
//
// Usage:
//   node render-viz.js <session-id> [options]
//     --start <sec>   --end <sec>     cut window (default: edit.social or full recording)
//     --out <file>    output filename inside the session dir (default render_viz_*.mp4)
//     --w <px> --h <px>               frame size (default 1080x1920, 9:16)
//     --fps <n>       (default 30)
//     --no-audio      skip the audio bed (silent viz)
// ============================================================

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { createCanvas } = require('@napi-rs/canvas')
const { getFfmpeg } = require('./audio-sync')
const { buildAudioBed } = require('./media-bed')

// ---- palette (mirrors pwa/archive.js) --------------------------------------
const VOICE_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db']
const FILTER_COLOR = '#9b59b6'
const BG = '#0e0e12'

// ---- args ------------------------------------------------------------------
const args = process.argv.slice(2)
const sessionId = args.find((a) => !a.startsWith('--'))
function flag(name, def) {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args[i + 1] : def
}
const hasFlag = (name) => args.includes('--' + name)
if (!sessionId) {
  console.error('Usage: node render-viz.js <session-id> [--start s --end s --out f --w 1080 --h 1920 --fps 30 --no-audio]')
  process.exit(1)
}

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions')
const SESSIONS_ROOT = path.resolve(SESSIONS_DIR)
const sDir = path.resolve(path.join(SESSIONS_DIR, sessionId))
if ((!sDir.startsWith(SESSIONS_ROOT + path.sep) && sDir !== SESSIONS_ROOT) || !fs.existsSync(sDir)) {
  console.error('Session not found:', sessionId)
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(path.join(sDir, 'manifest.json'), 'utf8'))

const W = parseInt(flag('w', '1080'), 10)
const H = parseInt(flag('h', '1920'), 10)
const FPS = parseInt(flag('fps', '30'), 10)

// ---- resolve cut window ----------------------------------------------------
const social = manifest.edit && manifest.edit.social
const rec = manifest.recording || {}
let start = flag('start', null)
let end = flag('end', null)
start = start != null ? parseFloat(start) : social ? social.start : rec.start_t != null ? rec.start_t : 0
end = end != null ? parseFloat(end) : social ? social.end : rec.end_t != null ? rec.end_t : null

// ---- load + fold tick stream into time-ordered channel updates -------------
// We reconstruct each channel's value over time by folding every event /
// feedback / tick line into a flat, time-sorted list of (t, channel, value).
function loadUpdates() {
  const raw = fs.readFileSync(path.join(sDir, 'bridge_ticks.jsonl'), 'utf8')
  const updates = []
  let tMin = Infinity
  let tMax = -Infinity
  for (const line of raw.split('\n')) {
    if (!line) continue
    let e
    try {
      e = JSON.parse(line)
    } catch (err) {
      continue
    }
    const t = e.t
    if (typeof t !== 'number') continue
    if (e.values && typeof e.values === 'object') {
      for (const ch in e.values) updates.push([t, ch, e.values[ch]])
    } else if (e.channel != null && typeof e.value === 'number') {
      updates.push([t, e.channel, e.value])
    }
    if (t < tMin) tMin = t
    if (t > tMax) tMax = t
  }
  updates.sort((a, b) => a[0] - b[0])
  return { updates, tMin, tMax }
}

const { updates, tMin, tMax } = loadUpdates()
if (start == null) start = tMin
if (end == null) end = tMax
const dur = Math.max(0.1, end - start)
const frameCount = Math.round(dur * FPS)

// ---- audio bed -------------------------------------------------------------
function bedForCut() {
  if (hasFlag('no-audio')) return null
  // anchor: the tape/reference timeline starts at the recording's start_t, so
  // media offsets are reference-relative. buildAudioBed converts our session-
  // time cut start with (start - anchor). Without this the bed seeks past the
  // tape's end and -- combined with a short bed -- truncates the whole video.
  const anchor = rec.start_t != null ? rec.start_t : 0
  const r = buildAudioBed(sDir, manifest.media, start, dur, anchor)
  if (r && r.error) {
    console.warn('⚠ audio bed failed, rendering silent:', r.error)
    return null
  }
  return r
}

// ---- drawing ---------------------------------------------------------------
function val(state, ch, def) {
  const v = state[ch]
  return v == null ? (def == null ? 0 : def) : v
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawFrame(ctx, state, progress) {
  // background
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  const pad = Math.round(W * 0.06)
  const title = (rec.name || sessionId).toString()

  // title
  ctx.fillStyle = '#f4f4f8'
  ctx.font = `700 ${Math.round(W * 0.07)}px sans-serif`
  ctx.textBaseline = 'top'
  ctx.fillText(title, pad, pad)
  ctx.fillStyle = '#8a8a99'
  ctx.font = `400 ${Math.round(W * 0.032)}px sans-serif`
  const tc = (start + progress * dur).toFixed(1)
  ctx.fillText('dspm-archive  ·  t=' + tc + 's', pad, pad + Math.round(W * 0.085))

  // six voice meters
  const top = Math.round(H * 0.16)
  const bottom = Math.round(H * 0.82)
  const colW = (W - pad * 2) / 6
  const meterH = bottom - top
  for (let v = 0; v < 6; v++) {
    const cx = pad + colW * v + colW / 2
    const x0 = pad + colW * v + colW * 0.18
    const w = colW * 0.64
    const color = VOICE_COLORS[v]
    const level = val(state, `/barcode/v${v + 1}/level`)
    const pan = val(state, `/barcode/v${v + 1}/pan`, 0.5)
    const rate = val(state, `/barcode/v${v + 1}/rate`, 0.5)

    // track
    ctx.fillStyle = '#1c1c24'
    roundRect(ctx, x0, top, w, meterH, w * 0.25)
    ctx.fill()

    // level fill (bottom-anchored)
    const fillH = Math.max(2, meterH * level)
    ctx.fillStyle = color
    ctx.globalAlpha = 0.35 + 0.65 * level
    roundRect(ctx, x0, top + meterH - fillH, w, fillH, w * 0.25)
    ctx.fill()
    ctx.globalAlpha = 1

    // rate ticks: faster rate => more segments glowing
    const segs = 3 + Math.round(rate * 9)
    ctx.fillStyle = '#ffffff'
    ctx.globalAlpha = 0.25
    for (let s = 0; s < segs; s++) {
      const yy = top + meterH - (meterH * (s + 1)) / (segs + 1)
      ctx.fillRect(x0, yy, w, 1.5)
    }
    ctx.globalAlpha = 1

    // pan dot below the meter
    const dotY = bottom + Math.round(H * 0.02)
    const dotX = cx + (pan - 0.5) * w
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(dotX, dotY, Math.max(3, w * 0.08), 0, Math.PI * 2)
    ctx.fill()

    // label
    ctx.fillStyle = '#9a9aa8'
    ctx.font = `600 ${Math.round(W * 0.028)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('v' + (v + 1), cx, bottom + Math.round(H * 0.035))
    ctx.textAlign = 'left'
  }

  // filter sweep bar
  const fy = Math.round(H * 0.9)
  const fFreq = val(state, '/param/filter_frequency', 1)
  const fReso = val(state, '/param/filter_reso', 0)
  ctx.fillStyle = '#1c1c24'
  roundRect(ctx, pad, fy, W - pad * 2, Math.round(H * 0.012), Math.round(H * 0.006))
  ctx.fill()
  ctx.fillStyle = FILTER_COLOR
  roundRect(ctx, pad, fy, (W - pad * 2) * fFreq, Math.round(H * 0.012), Math.round(H * 0.006))
  ctx.fill()
  // reso marker
  ctx.fillStyle = '#fff'
  ctx.globalAlpha = 0.4 + 0.6 * fReso
  const mx = pad + (W - pad * 2) * fFreq
  ctx.fillRect(mx - 2, fy - Math.round(H * 0.008), 4, Math.round(H * 0.028))
  ctx.globalAlpha = 1

  // progress bar
  const py = H - Math.round(H * 0.03)
  ctx.fillStyle = '#26262f'
  ctx.fillRect(pad, py, W - pad * 2, Math.round(H * 0.006))
  ctx.fillStyle = '#f4f4f8'
  ctx.fillRect(pad, py, (W - pad * 2) * progress, Math.round(H * 0.006))
}

// ---- render ----------------------------------------------------------------
const outName = flag('out', null) || 'render_viz_' + Date.now() + '.mp4'
const outPath = path.join(sDir, outName)

console.log('\ndspm-archive render-viz')
console.log('=======================')
console.log('Session :', sessionId)
console.log('Cut     :', start.toFixed(1) + 's → ' + end.toFixed(1) + 's  (' + dur.toFixed(1) + 's)')
console.log('Frame   :', W + 'x' + H + ' @ ' + FPS + 'fps  (' + frameCount + ' frames)')
console.log('Output  :', outName)
console.log()

console.log('Building audio bed...')
const bed = bedForCut()
console.log(bed ? '  ✓ audio bed ready' : '  (silent — no aligned audio)')

const canvas = createCanvas(W, H)
const ctx = canvas.getContext('2d')

// State sampler
const state = {}
let ptr = 0
while (ptr < updates.length && updates[ptr][0] < start) {
  state[updates[ptr][1]] = updates[ptr][2]
  ptr++
}

// Write frames to a temp directory (avoids stdin pipe buffer accumulation for
// long high-res renders which can crash Node's native heap at ~90% progress).
const tmpDir = path.join(os.tmpdir(), 'dspm_viz_' + process.pid + '_' + Date.now())
fs.mkdirSync(tmpDir, { recursive: true })

console.log('Rendering frames...')
const tick = Math.max(1, Math.round(frameCount / 10))
for (let frame = 0; frame < frameCount; frame++) {
  const ft = start + (frame / FPS)
  while (ptr < updates.length && updates[ptr][0] <= ft) {
    state[updates[ptr][1]] = updates[ptr][2]
    ptr++
  }
  drawFrame(ctx, state, frame / frameCount)
  const framePath = path.join(tmpDir, 'f' + String(frame).padStart(7, '0') + '.png')
  fs.writeFileSync(framePath, canvas.toBuffer('image/png'))
  if ((frame + 1) % tick === 0 || frame + 1 === frameCount) {
    process.stdout.write('\r  ' + Math.round(((frame + 1) / frameCount) * 100) + '%   ')
  }
}
process.stdout.write('\n')
console.log('Encoding...')

const ffmpeg = getFfmpeg()
const ffArgs = ['-y', '-f', 'image2', '-framerate', String(FPS), '-i', path.join(tmpDir, 'f%07d.png')]
if (bed) ffArgs.push('-i', bed)
ffArgs.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '18', '-r', String(FPS))
if (bed) ffArgs.push('-c:a', 'aac', '-b:a', '192k')
ffArgs.push('-t', dur.toFixed(3), outPath)

const proc = spawn(ffmpeg, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
let ffErr = ''
proc.stderr.on('data', (d) => {
  ffErr += d.toString()
  if (ffErr.length > 4000) ffErr = ffErr.slice(-4000)
  const m = ffErr.match(/time=(\d+):(\d+):(\d+\.\d+)/)
  if (m) {
    const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3])
    process.stdout.write('\r  encode ' + Math.min(100, Math.round((sec / dur) * 100)) + '%   ')
  }
})

proc.on('close', (code) => {
  // clean up temp frames
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) {}
  if (bed) { try { fs.unlinkSync(bed) } catch (e) {} }
  process.stdout.write('\n')
  if (code !== 0) {
    console.error('ffmpeg encode failed (exit ' + code + '):')
    console.error(ffErr.slice(-600))
    process.exit(1)
  }
  manifest.renders = Array.isArray(manifest.renders) ? manifest.renders : []
  manifest.renders = manifest.renders.filter((r) => r.file !== outName)
  manifest.renders.push({
    file: outName, kind: 'social', w: W, h: H, fps: FPS,
    start: parseFloat(start.toFixed(3)), end: parseFloat(end.toFixed(3)),
    created: new Date().toISOString(),
  })
  fs.writeFileSync(path.join(sDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('✓ Rendered ' + outName + '  (' + (fs.statSync(outPath).size / 1e6).toFixed(1) + ' MB)')
})
