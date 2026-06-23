'use strict'

// ============================================================
// lib/ffmpeg.js  --  ffmpeg helpers for dj-id
//
// Mirrors the bridge's convention (bridge/audio-sync.js): shell out to the
// bundled `ffmpeg-static` binary and parse the `ffmpeg -i` banner rather than
// taking a hard dependency on a separate ffprobe. This keeps dj-id buildable
// on Windows with zero native modules.
// ============================================================

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

// Sample rate / format we decode references and the query mix to before
// fingerprinting. Mono 16 kHz keeps the fingerprint DB small and is plenty for
// landmark / Panako-style spectral peak matching.
const FP_RATE = 16000

const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.wave', '.flac', '.aif', '.aiff', '.aifc',
  '.m4a', '.mp4', '.aac', '.ogg', '.oga', '.opus', '.wma', '.alac',
])

function getFfmpeg() {
  try {
    return require('ffmpeg-static')
  } catch (e) {
    throw new Error('ffmpeg-static not installed. Run: npm install (inside dj-id/)')
  }
}

// Recursively collect audio files under `dir`. Skips DJ-software metadata dirs
// that hold no playable audio (their contents are parsed by adapters instead).
function walkAudio(dir, out = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    return out
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      walkAudio(full, out)
    } else if (ent.isFile() && AUDIO_EXTS.has(path.extname(ent.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

// Parse the `ffmpeg -i` banner for tags + duration. Returns
// { title, artist, album, bpm, key, durationSec } with nulls where unknown.
function probeTags(file) {
  const ffmpeg = getFfmpeg()
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const txt = (r.stderr ? r.stderr.toString() : '') + (r.stdout ? r.stdout.toString() : '')

  const meta = {}
  // Metadata block lines look like:  "    title           : Some Track"
  const re = /^\s{4,}([A-Za-z0-9_\- ]+?)\s*:\s*(.+?)\s*$/gm
  let m
  while ((m = re.exec(txt)) !== null) {
    const k = m[1].trim().toLowerCase()
    const v = m[2].trim()
    if (!(k in meta) && v) meta[k] = v
  }

  // Duration: "Duration: 00:03:21.50, ..."
  let durationSec = null
  const dm = txt.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (dm) durationSec = (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3])

  const pick = (...keys) => {
    for (const k of keys) if (meta[k]) return meta[k]
    return null
  }
  const bpmRaw = pick('tbpm', 'bpm', 'beats_per_minute')
  return {
    title: pick('title'),
    artist: pick('artist', 'album_artist', 'performer'),
    album: pick('album'),
    bpm: bpmRaw ? parseFloat(bpmRaw) || null : null,
    key: pick('initial_key', 'tkey', 'key'),
    durationSec,
  }
}

// Does this file contain at least one decodable audio stream?
function hasAudioStream(file) {
  const ffmpeg = getFfmpeg()
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const txt = (r.stderr ? r.stderr.toString() : '') + (r.stdout ? r.stdout.toString() : '')
  return /Stream #\d+:\d+.*: Audio:/i.test(txt)
}

// Decode any input to a mono PCM-16 WAV at FP_RATE for fingerprinting.
function decodeToWav(input, output, rate = FP_RATE) {
  const ffmpeg = getFfmpeg()
  const r = spawnSync(
    ffmpeg,
    ['-y', '-i', input, '-vn', '-ac', '1', '-ar', String(rate), '-c:a', 'pcm_s16le', output],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  if (r.status !== 0) {
    const err = r.stderr ? r.stderr.toString().slice(-400) : 'unknown error'
    throw new Error('ffmpeg decode failed on ' + path.basename(input) + '\n' + err)
  }
  return output
}

// Cut [start, end) seconds of `input` into `output`. Re-encodes so the cut is
// sample-accurate (stream-copy would snap to keyframes). PCM wav by default.
function sliceAudio(input, output, start, end, opts = {}) {
  const ffmpeg = getFfmpeg()
  const dur = Math.max(0, end - start)
  const args = ['-y', '-ss', String(start), '-i', input, '-t', String(dur), '-vn']
  if (path.extname(output).toLowerCase() === '.wav') {
    args.push('-c:a', 'pcm_s16le')
  } else {
    args.push('-q:a', '2') // sensible mp3/m4a quality
  }
  args.push(output)
  const r = spawnSync(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  if (r.status !== 0) {
    const err = r.stderr ? r.stderr.toString().slice(-400) : 'unknown error'
    throw new Error('ffmpeg slice failed -> ' + path.basename(output) + '\n' + err)
  }
  return output
}

module.exports = {
  FP_RATE,
  AUDIO_EXTS,
  getFfmpeg,
  walkAudio,
  probeTags,
  hasAudioStream,
  decodeToWav,
  sliceAudio,
}
