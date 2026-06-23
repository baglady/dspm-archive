'use strict'

// ============================================================
// lib/fingerprint.js  --  landmark (constellation) fingerprinting, pure Node
//
// This is the classic Shazam-family algorithm (deterministic DSP, NO machine
// learning): short-time FFT -> spectral peak "constellation" -> pairs of peaks
// hashed as (f1, f2, dt). Robust to noise, EQ and re-encoding. It does NOT
// track large tempo/pitch shifts -- that's why Panako exists as the optional
// upgrade engine. Good enough as the zero-setup default.
// ============================================================

const { magnitudeSpectrum } = require('./fft')

const N = 1024 // FFT size  (~15.6 Hz/bin @ 16 kHz)
const HOP = 512 // 50% overlap -> ~31.25 frames/sec @ 16 kHz
const PEAKS_PER_FRAME = 6 // cap constellation density
const FANOUT = 5 // target peaks paired per anchor
const MIN_DT = 1 // frames
const MAX_DT = 12 // frames (~0.38 s) -- pairing horizon
const FREQ_BITS = 9 // 512 bins -> 9 bits

// Precomputed Hann window.
const WIN = new Float64Array(N)
for (let i = 0; i < N; i++) WIN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))

function framesToSec(frame, rate) {
  return (frame * HOP) / rate
}
function secToFrame(sec, rate) {
  return Math.round((sec * rate) / HOP)
}

// Build the constellation: array of { t (frame), f (bin) } sorted by time.
function constellation(samples) {
  const peaks = []
  const frame = new Float64Array(N)
  const nFrames = Math.max(0, Math.floor((samples.length - N) / HOP) + 1)
  for (let fi = 0; fi < nFrames; fi++) {
    const base = fi * HOP
    for (let i = 0; i < N; i++) frame[i] = (samples[base + i] || 0) * WIN[i]
    const mag = magnitudeSpectrum(frame)

    // local maxima above the frame's mean energy
    let mean = 0
    for (let i = 0; i < mag.length; i++) mean += mag[i]
    mean /= mag.length || 1
    const cand = []
    for (let i = 1; i < mag.length - 1; i++) {
      if (mag[i] > mag[i - 1] && mag[i] >= mag[i + 1] && mag[i] > mean) {
        cand.push([mag[i], i])
      }
    }
    cand.sort((a, b) => b[0] - a[0])
    const keep = cand.slice(0, PEAKS_PER_FRAME)
    for (const [, bin] of keep) peaks.push({ t: fi, f: bin })
  }
  return peaks
}

// Pack (f1, f2, dt) into an integer hash key.
function packHash(f1, f2, dt) {
  return ((f1 & 0x1ff) << (FREQ_BITS + 5)) | ((f2 & 0x1ff) << 5) | (dt & 0x1f)
}

// Turn a constellation into [hashKey, anchorTimeFrame] pairs.
function hashesFromPeaks(peaks) {
  const out = []
  // peaks are time-ordered by construction (outer loop is frame index)
  for (let i = 0; i < peaks.length; i++) {
    const a = peaks[i]
    let paired = 0
    for (let j = i + 1; j < peaks.length && paired < FANOUT; j++) {
      const b = peaks[j]
      const dt = b.t - a.t
      if (dt < MIN_DT) continue
      if (dt > MAX_DT) break // peaks sorted by t -> nothing further qualifies
      out.push([packHash(a.f, b.f, dt), a.t])
      paired++
    }
  }
  return out
}

// Full fingerprint of a mono sample buffer: returns [ [hash, tFrame], ... ].
function fingerprint(samples) {
  return hashesFromPeaks(constellation(samples))
}

module.exports = {
  N,
  HOP,
  fingerprint,
  constellation,
  hashesFromPeaks,
  framesToSec,
  secToFrame,
}
