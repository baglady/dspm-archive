#!/usr/bin/env node
// sync-video.js
//
// Finds the time offset between a session's video and norns tape WAV using
// RMS-envelope cross-correlation, then writes the result to manifest.json.
//
// Usage:
//   node sync-video.js <session-id>
//   node sync-video.js <session-id> --video myfile.mp4 --wav tape.wav
//
// Output: manifest.video_offset (seconds)
//   videoTime = bridgeSessionTime + video_offset
//
// After running, reload the archive page -- the offset is applied automatically.

'use strict'

const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { spawnSync } = require('child_process')

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions')
const SAMPLE_RATE  = 8000   // Hz -- enough for envelope matching
const WINDOW_MS    = 100    // RMS window size (ms)
const WINDOW_SAMP  = Math.round(SAMPLE_RATE * WINDOW_MS / 1000)

// ---- arg parsing -----------------------------------------------------------
const args = process.argv.slice(2)
const sessionId = args.find(a => !a.startsWith('--'))
if (!sessionId) {
  console.error('Usage: node sync-video.js <session-id> [--video file] [--wav file]')
  process.exit(1)
}

function flag(name) {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args[i + 1] : null
}

const sDir = path.resolve(path.join(SESSIONS_DIR, sessionId))
if (!sDir.startsWith(path.resolve(SESSIONS_DIR)) || !fs.existsSync(sDir)) {
  console.error('Session not found:', sessionId)
  process.exit(1)
}

const files = fs.readdirSync(sDir)
const videoFile = flag('video') || files.find(f => /\.(mp4|mov|webm)$/i.test(f))
const wavFile   = flag('wav')   || files.find(f => /\.wav$/i.test(f))

if (!videoFile) { console.error('No video file in session (pass --video <name> to specify)'); process.exit(1) }
if (!wavFile)   { console.error('No WAV file in session (pass --wav <name> to specify)');   process.exit(1) }

// ---- ffmpeg ----------------------------------------------------------------
let ffmpeg
try { ffmpeg = require('ffmpeg-static') } catch (e) {
  console.error('Run: npm install ffmpeg-static')
  process.exit(1)
}

// ---- helpers ---------------------------------------------------------------
function toRawPCM(inputFile, outputFile) {
  const r = spawnSync(ffmpeg, [
    '-y', '-i', inputFile,
    '-ac', '1', '-ar', String(SAMPLE_RATE),
    '-f', 'f32le', outputFile,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) {
    console.error('ffmpeg failed on', path.basename(inputFile))
    console.error(r.stderr && r.stderr.toString().slice(-400))
    process.exit(1)
  }
}

function readRawFloat32(file) {
  const buf = fs.readFileSync(file)
  // buf is a Buffer; we need to interpret it as little-endian float32
  const out = new Float32Array(buf.byteLength / 4)
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

// Cross-correlate: find where `needle` best matches inside `haystack`.
// Returns { offsetSamples, confidence } where offsetSamples is the window
// index in haystack where needle starts.
function crossCorrelate(needle, haystack) {
  const nLen = needle.length
  const hLen = haystack.length
  const maxShift = hLen - 1  // search needle starting anywhere in haystack (and before)

  let bestScore = -Infinity
  let bestShift = 0

  // needle can start from -nLen+1 (mostly before haystack) to hLen-1 (mostly after)
  const rangeStart = -(nLen - 1)
  const rangeEnd   = hLen - 1

  for (let shift = rangeStart; shift <= rangeEnd; shift++) {
    let dot = 0, count = 0
    for (let i = 0; i < nLen; i++) {
      const hi = shift + i
      if (hi < 0 || hi >= hLen) continue
      dot += needle[i] * haystack[hi]
      count++
    }
    if (count < Math.min(nLen, hLen) * 0.1) continue // need at least 10% overlap
    const score = dot / count
    if (score > bestScore) { bestScore = score; bestShift = shift }
  }

  // confidence: normalized peak vs mean
  let mean = 0, cnt = 0
  for (let shift = rangeStart; shift <= rangeEnd; shift += 10) {
    let dot = 0, count = 0
    for (let i = 0; i < nLen; i++) {
      const hi = shift + i
      if (hi < 0 || hi >= hLen) continue
      dot += needle[i] * haystack[hi]; count++
    }
    if (count > 0) { mean += dot / count; cnt++ }
  }
  mean /= cnt || 1
  const confidence = bestScore > 0 ? Math.min(1, (bestScore - mean) / bestScore) : 0

  return { offsetWindows: bestShift, confidence }
}

// ---- main ------------------------------------------------------------------
const tmpDir = os.tmpdir()
const tmpTape  = path.join(tmpDir, 'dspm_tape_'  + Date.now() + '.f32')
const tmpVideo = path.join(tmpDir, 'dspm_video_' + Date.now() + '.f32')

console.log('\ndspm-archive sync-video')
console.log('=======================')
console.log('Session :', sessionId)
console.log('Video   :', videoFile)
console.log('Tape WAV:', wavFile)
console.log()

console.log('Extracting audio (this takes a moment)...')
toRawPCM(path.join(sDir, wavFile),   tmpTape)
toRawPCM(path.join(sDir, videoFile), tmpVideo)

console.log('Computing RMS envelopes...')
const tapeSamples  = readRawFloat32(tmpTape)
const videoSamples = readRawFloat32(tmpVideo)
fs.unlinkSync(tmpTape)
fs.unlinkSync(tmpVideo)

const tapeEnv  = normalize(rmsEnvelope(tapeSamples))
const videoEnv = normalize(rmsEnvelope(videoSamples))

const tapeDuration  = tapeSamples.length  / SAMPLE_RATE
const videoDuration = videoSamples.length / SAMPLE_RATE
console.log(`Tape : ${tapeDuration.toFixed(1)}s  (${tapeEnv.length} windows)`)
console.log(`Video: ${videoDuration.toFixed(1)}s  (${videoEnv.length} windows)`)

console.log('Cross-correlating...')
// Search for tape inside video
const { offsetWindows, confidence } = crossCorrelate(tapeEnv, videoEnv)

// offsetWindows: tape window index 0 corresponds to video window index offsetWindows
// If positive: tape starts offsetWindows*WINDOW_MS ms into the video
// If negative: tape started before the video
const offsetSec = offsetWindows * WINDOW_MS / 1000

// video_offset in the archive viewer: videoTime = sessionTime + video_offset
// sessionTime ≈ tape time (bridge session and tape start close together)
// videoTime = tapeStartInVideo + sessionTime  →  video_offset = tapeStartInVideo
const videoOffset = offsetSec

console.log()
console.log(`Result`)
console.log('------')
console.log(`Tape starts at ${videoOffset.toFixed(2)}s into the video`)
console.log(`video_offset   = ${videoOffset.toFixed(3)}`)
console.log(`Confidence     = ${(confidence * 100).toFixed(1)}%`)
console.log()

if (confidence < 0.3) {
  console.warn('⚠  Low confidence — recordings may not share audio, or one is very short.')
  console.warn('   Try adjusting the offset manually in the archive viewer.')
}

// Write to manifest
const manifestPath = path.join(sDir, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.video_offset = parseFloat(videoOffset.toFixed(3))
manifest.video_file   = videoFile
manifest.tape_file    = wavFile
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log('✓ Written to manifest.json')
console.log('  Reload the archive page to apply.')
