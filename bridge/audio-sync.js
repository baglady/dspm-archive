'use strict'

// ============================================================
// audio-sync.js
//
// Shared audio-alignment primitives used by sync-video.js (single clip)
// and sync-media.js (multi-clip). Everything here is pure-ish: it shells
// out to ffmpeg for decoding but holds no session state.
//
// The core idea: decode each input to a mono low-rate PCM stream, reduce it
// to an RMS envelope, then cross-correlate two envelopes to find the time
// shift where they best line up.
// ============================================================

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const SAMPLE_RATE = 8000 // Hz -- enough for envelope matching
const WINDOW_MS = 100 // RMS window size (ms)
const WINDOW_SAMP = Math.round((SAMPLE_RATE * WINDOW_MS) / 1000)

// ---- ffmpeg location -------------------------------------------------------
function getFfmpeg() {
  try {
    return require('ffmpeg-static')
  } catch (e) {
    throw new Error('ffmpeg-static not installed. Run: npm install ffmpeg-static')
  }
}

// Does this file contain at least one decodable audio stream?
// We avoid a hard ffprobe dependency by parsing `ffmpeg -i` banner output.
function hasAudioStream(file) {
  const ffmpeg = getFfmpeg()
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const txt = (r.stderr ? r.stderr.toString() : '') + (r.stdout ? r.stdout.toString() : '')
  return /Stream #\d+:\d+.*: Audio:/i.test(txt)
}

// ---- decode + envelope -----------------------------------------------------
function toRawPCM(inputFile, outputFile) {
  const ffmpeg = getFfmpeg()
  const r = spawnSync(
    ffmpeg,
    ['-y', '-i', inputFile, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', outputFile],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  if (r.status !== 0) {
    const err = r.stderr ? r.stderr.toString().slice(-400) : 'unknown error'
    throw new Error('ffmpeg failed on ' + path.basename(inputFile) + '\n' + err)
  }
}

function readRawFloat32(file) {
  const buf = fs.readFileSync(file)
  const out = new Float32Array(Math.floor(buf.byteLength / 4))
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4)
  return out
}

function rmsEnvelope(samples) {
  const n = Math.floor(samples.length / WINDOW_SAMP)
  const env = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    const base = i * WINDOW_SAMP
    for (let j = 0; j < WINDOW_SAMP; j++) {
      const v = samples[base + j] || 0
      sum += v * v
    }
    env[i] = Math.sqrt(sum / WINDOW_SAMP)
  }
  return env
}

function normalize(env) {
  let max = 0
  for (let i = 0; i < env.length; i++) if (env[i] > max) max = env[i]
  if (max === 0) return env
  const out = new Float32Array(env.length)
  for (let i = 0; i < env.length; i++) out[i] = env[i] / max
  return out
}

// Decode a file to a normalized RMS envelope. Returns { env, duration, silent }.
// `silent` is true when the file has no audio or decodes to near-silence.
function envelopeOf(file) {
  if (!hasAudioStream(file)) return { env: new Float32Array(0), duration: 0, silent: true }
  const tmp = path.join(os.tmpdir(), 'dspm_env_' + process.pid + '_' + Math.random().toString(36).slice(2) + '.f32')
  try {
    toRawPCM(file, tmp)
    const samples = readRawFloat32(tmp)
    const duration = samples.length / SAMPLE_RATE
    const env = normalize(rmsEnvelope(samples))
    let peak = 0
    for (let i = 0; i < env.length; i++) if (env[i] > peak) peak = env[i]
    return { env, duration, silent: peak === 0 || env.length === 0 }
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch (e) {}
  }
}

// Cross-correlate: find the shift where `needle` best matches inside `haystack`.
// Returns { offsetWindows, confidence }.
//   offsetWindows = haystack window index that aligns with needle window 0.
//   Positive  => needle starts that many windows into the haystack.
//   Negative  => needle started before the haystack.
function crossCorrelate(needle, haystack) {
  const nLen = needle.length
  const hLen = haystack.length
  if (nLen === 0 || hLen === 0) return { offsetWindows: 0, confidence: 0 }

  // Require the overlap to cover at least half of the shorter envelope, so a
  // few windows hanging off the edge can't produce a spurious high score.
  const minOverlap = Math.max(4, Math.floor(Math.min(nLen, hLen) * 0.5))

  // Normalized (cosine) correlation over the overlap region: dot / (||n|| ||h||).
  // Amplitude-invariant and bounded to [0,1] for non-negative envelopes, so the
  // peak isn't biased toward small, accidentally-aligned overlaps.
  function scoreAt(shift) {
    let dot = 0
    let nn = 0
    let hh = 0
    let count = 0
    for (let i = 0; i < nLen; i++) {
      const hi = shift + i
      if (hi < 0 || hi >= hLen) continue
      const a = needle[i]
      const b = haystack[hi]
      dot += a * b
      nn += a * a
      hh += b * b
      count++
    }
    if (count < minOverlap || nn === 0 || hh === 0) return -Infinity
    return dot / Math.sqrt(nn * hh)
  }

  const rangeStart = -(nLen - 1)
  const rangeEnd = hLen - 1

  let bestScore = -Infinity
  let bestShift = 0
  let sum = 0
  let cnt = 0
  for (let shift = rangeStart; shift <= rangeEnd; shift++) {
    const score = scoreAt(shift)
    if (score === -Infinity) continue
    if (score > bestScore) {
      bestScore = score
      bestShift = shift
    }
    sum += score
    cnt++
  }

  // confidence: how far the peak stands above the mean of the surface
  const mean = sum / (cnt || 1)
  const confidence = bestScore > 0 ? Math.max(0, Math.min(1, (bestScore - mean) / (1 - mean || 1))) : 0

  return { offsetWindows: bestShift, confidence }
}

// Convenience: given a reference envelope and a clip envelope, return the
// offset (seconds) such that  clipTime = sessionTime + offset, where the
// reference defines sessionTime (i.e. "the reference's t0 sits `offset`
// seconds into this clip").
function alignClip(refEnv, clipEnv) {
  const { offsetWindows, confidence } = crossCorrelate(refEnv, clipEnv)
  return { offset: (offsetWindows * WINDOW_MS) / 1000, confidence }
}

module.exports = {
  SAMPLE_RATE,
  WINDOW_MS,
  WINDOW_SAMP,
  getFfmpeg,
  hasAudioStream,
  envelopeOf,
  crossCorrelate,
  alignClip,
  normalize,
  rmsEnvelope,
}
