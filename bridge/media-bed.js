'use strict'

// ============================================================
// media-bed.js  --  build a mixed, time-aligned audio bed for a cut
//
// Shared by render-viz.js (social) and render-master.js (DVD master). Mixes
// every audio-bearing clip in a session's media[] into one stereo wav,
// aligned to the cut window via each clip's offset (clipTime = sessionTime +
// offset) and scaled by its gain. Clips that start after the cut begins are
// front-padded with silence so they stay in sync.
//
// Returns an absolute path to a temp wav, or null if there's nothing to mix.
//
// `anchor` is the session time (seconds since session t0) at which the media
// reference timeline begins -- i.e. the recording's start_t. Media offsets are
// stored relative to that reference (the norns tape), so a cut's session-time
// `start` is converted to reference time with (start - anchor) before each
// clip's own offset is applied. Defaults to 0 for sessions with no recording.
// ============================================================

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { getFfmpeg, hasAudioStream } = require('./audio-sync')

// Outputs this pipeline produced -- never feed them back in as source audio,
// or each re-render layers the previous render's bed on top of the tape.
const isRenderOutput = (name) => /^render_(viz|master|dvd)_/i.test(name)

function buildAudioBed(sDir, media, start, dur, anchor = 0) {
  if (!Array.isArray(media) || media.length === 0) return null
  const ffmpeg = getFfmpeg()
  const inputs = []
  const filters = []
  let idx = 0

  for (const m of media) {
    if (m.gain === 0) continue
    if (isRenderOutput(m.file)) continue
    const file = path.join(sDir, m.file)
    if (!fs.existsSync(file)) continue
    if (!hasAudioStream(file)) continue

    const off = m.offset || 0
    const seek = (start - anchor) + off // reference time corresponding to the cut's start
    const inArgs = []
    let delayMs = 0
    if (seek >= 0) {
      inArgs.push('-ss', seek.toFixed(3))
    } else {
      delayMs = Math.round(-seek * 1000) // clip enters after the cut begins
    }
    inArgs.push('-t', dur.toFixed(3), '-i', file)
    inputs.push(...inArgs)

    const g = m.gain != null ? m.gain : 1
    let f = `[${idx}:a]volume=${g}`
    if (delayMs > 0) f += `,adelay=${delayMs}:all=1`
    f += `[a${idx}]`
    filters.push(f)
    idx++
  }
  if (idx === 0) return null

  const bed = path.join(os.tmpdir(), 'dspm_bed_' + process.pid + '_' + Date.now() + '.wav')
  let fc
  if (idx === 1) {
    fc = filters[0].replace('[a0]', '[a]')
  } else {
    const labels = Array.from({ length: idx }, (_, i) => `[a${i}]`).join('')
    fc = filters.join(';') + ';' + labels + `amix=inputs=${idx}:normalize=0[a]`
  }

  const r = spawnSync(
    ffmpeg,
    ['-y', ...inputs, '-filter_complex', fc, '-map', '[a]', '-ac', '2', '-ar', '48000', bed],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  if (r.status !== 0) {
    // clean up the partial/empty temp wav so failed renders don't leak it
    // (a full disk produced hundreds of MB of orphaned beds this way)
    try { fs.unlinkSync(bed) } catch (e) {}
    return { error: r.stderr ? r.stderr.toString().slice(-300) : 'ffmpeg failed' }
  }
  return bed
}

module.exports = { buildAudioBed }
