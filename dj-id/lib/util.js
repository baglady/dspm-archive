'use strict'

// ============================================================
// lib/util.js  --  small shared helpers (no deps)
// ============================================================

const crypto = require('crypto')
const path = require('path')

// Stable short id for a track, derived from its absolute source path so the
// same file always lands on the same fingerprint key across re-ingests.
function trackId(absPath) {
  return 'trk_' + crypto.createHash('sha1').update(absPath).digest('hex').slice(0, 12)
}

// Filesystem-safe slug for snippet filenames.
function slug(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'untitled'
}

// Best-effort "Artist - Title" from tags, falling back to the filename.
function displayName(meta, absPath) {
  if (meta && meta.artist && meta.title) return `${meta.artist} - ${meta.title}`
  if (meta && meta.title) return meta.title
  return path.basename(absPath, path.extname(absPath))
}

// seconds -> "MM:SS.cc"
function fmtClock(sec) {
  sec = Math.max(0, sec || 0)
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

// seconds -> "HH:MM:SS:FF" (frames) for CMX3600 EDL / NLE markers
function fmtTimecode(sec, fps = 25) {
  sec = Math.max(0, sec || 0)
  const totalFrames = Math.round(sec * fps)
  const f = totalFrames % fps
  const totalSec = Math.floor(totalFrames / fps)
  const s = totalSec % 60
  const mm = Math.floor(totalSec / 60) % 60
  const hh = Math.floor(totalSec / 3600)
  const p2 = (n) => String(n).padStart(2, '0')
  return `${p2(hh)}:${p2(mm)}:${p2(s)}:${p2(f)}`
}

// seconds -> "MM:SS:FF" for .cue INDEX (CD frames, 75 per second)
function fmtCueIndex(sec) {
  sec = Math.max(0, sec || 0)
  const frames = Math.round(sec * 75)
  const f = frames % 75
  const totalSec = Math.floor(frames / 75)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60)
  const p2 = (n) => String(n).padStart(2, '0')
  return `${p2(m)}:${p2(s)}:${p2(f)}`
}

module.exports = { trackId, slug, displayName, fmtClock, fmtTimecode, fmtCueIndex }
