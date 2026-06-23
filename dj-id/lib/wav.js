'use strict'

// ============================================================
// lib/wav.js  --  minimal PCM-16 mono WAV reader
//
// We only ever read WAVs that dj-id itself produced via ffmpeg
// (mono, 16-bit, FP_RATE), so this parser is deliberately narrow.
// ============================================================

const fs = require('fs')

// Read a mono 16-bit PCM WAV. Returns { samples: Float32Array (-1..1), rate }.
function readPcm16Wav(file) {
  const buf = fs.readFileSync(file)
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file: ' + file)
  }
  let rate = 16000
  let dataOffset = -1
  let dataLen = 0
  let pos = 12
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const body = pos + 8
    if (id === 'fmt ') {
      rate = buf.readUInt32LE(body + 4)
    } else if (id === 'data') {
      dataOffset = body
      dataLen = size
      break
    }
    pos = body + size + (size & 1) // chunks are word-aligned
  }
  if (dataOffset < 0) throw new Error('no data chunk in ' + file)

  const n = Math.floor(Math.min(dataLen, buf.length - dataOffset) / 2)
  const samples = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2) / 32768
  }
  return { samples, rate }
}

module.exports = { readPcm16Wav }
