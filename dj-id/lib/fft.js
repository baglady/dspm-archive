'use strict'

// ============================================================
// lib/fft.js  --  iterative radix-2 Cooley-Tukey FFT (no deps)
//
// Used by the built-in fingerprint engine to turn windowed audio frames into
// magnitude spectra. Size must be a power of two.
// ============================================================

// In-place complex FFT. `re`/`im` are Float64Array of length n (power of two).
function fftInPlace(re, im) {
  const n = re.length
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

// Magnitude spectrum (first n/2 bins) of a real frame. `frame` length = n.
function magnitudeSpectrum(frame) {
  const n = frame.length
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = frame[i]
  fftInPlace(re, im)
  const half = n >> 1
  const mag = new Float32Array(half)
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i])
  return mag
}

module.exports = { fftInPlace, magnitudeSpectrum }
