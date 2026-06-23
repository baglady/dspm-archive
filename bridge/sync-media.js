#!/usr/bin/env node
'use strict'

// ============================================================
// sync-media.js  --  multi-clip alignment for a session
//
// Generalizes sync-video.js from one-video/one-tape to N media clips
// (any mix of audio + video). It picks a master reference, aligns every
// audio-bearing clip to it by RMS-envelope cross-correlation, and writes a
// `media[]` array into manifest.json describing each clip's offset.
//
// Offset convention (matches the archive viewer):
//   clipTime = sessionTime + offset
//   i.e. the reference's t0 sits `offset` seconds into that clip.
//
// Reference selection (first match wins):
//   --ref <file>            explicit
//   manifest.tape_file      the norns tape WAV, if recorded
//   first *.wav in session
//   longest audio-bearing clip
//
// Clips with no usable audio (silent B-roll) -- or correlations below the
// confidence floor -- are marked sync:"manual" with offset 0 so the web
// editor can nudge them by hand.
//
// Usage:
//   node sync-media.js <session-id>
//   node sync-media.js <session-id> --ref tape.wav
//   node sync-media.js <session-id> --min-confidence 0.4
//   node sync-media.js <session-id> --reset      (clear & recompute media[])
// ============================================================

const fs = require('fs')
const path = require('path')
const { envelopeOf, alignClip } = require('./audio-sync')

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions')
const MEDIA_RE = /\.(mp4|mov|webm|wav|mp3|ogg|m4a|aac|flac)$/i
const VIDEO_RE = /\.(mp4|mov|webm)$/i
// Pipeline outputs — never treat these as source clips to sync/mix
const isRenderOutput = (f) => /^(render_(viz|master|dvd)_|dvd_(ntsc|pal)|_debug)/i.test(f)

// A sensible SHORT default social clip so a one-click "render social" makes a
// shareable ~30s vertical, not the whole 20-min set. Sits just inside the
// recording (small lead-in), clamped to its length. Users override via the
// editor's in/out buttons; the master export stays full-length.
const SOCIAL_DEFAULT_SEC = 30
function defaultSocial(manifest) {
  const rec = manifest.recording
  if (!rec || rec.start_t == null || rec.end_t == null) return null
  const recDur = rec.end_t - rec.start_t
  if (!(recDur > 0)) return null
  const lead = Math.min(5, recDur * 0.1)
  const start = rec.start_t + lead
  const end = Math.min(rec.end_t, start + SOCIAL_DEFAULT_SEC)
  return { start: parseFloat(start.toFixed(2)), end: parseFloat(end.toFixed(2)), aspect: '9:16' }
}

// ---- args ------------------------------------------------------------------
const args = process.argv.slice(2)
const sessionId = args.find((a) => !a.startsWith('--'))
function flag(name) {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args[i + 1] : null
}
const hasFlag = (name) => args.includes('--' + name)

if (!sessionId) {
  console.error('Usage: node sync-media.js <session-id> [--ref file] [--min-confidence 0.3] [--reset]')
  process.exit(1)
}

const MIN_CONFIDENCE = parseFloat(flag('min-confidence') || '0.3')

// ---- locate session --------------------------------------------------------
const SESSIONS_ROOT = path.resolve(SESSIONS_DIR)
const sDir = path.resolve(path.join(SESSIONS_DIR, sessionId))
if ((!sDir.startsWith(SESSIONS_ROOT + path.sep) && sDir !== SESSIONS_ROOT) || !fs.existsSync(sDir)) {
  console.error('Session not found:', sessionId)
  process.exit(1)
}

const manifestPath = path.join(sDir, 'manifest.json')
let manifest
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
} catch (e) {
  console.error('Could not read manifest.json:', e.message)
  process.exit(1)
}

// ---- enumerate media -------------------------------------------------------
// Skip this pipeline's own render outputs (isRenderOutput, defined above) --
// they live in the session folder next to the source clips, but treating them
// as source media pollutes media[] (re-rendering then re-masters a render and
// re-mixes its bed). They're tracked separately in manifest.renders[].
const mediaFiles = fs.readdirSync(sDir).filter((f) => MEDIA_RE.test(f) && !isRenderOutput(f))
if (mediaFiles.length === 0) {
  console.log('\ndspm-archive sync-media')
  console.log('=======================')
  console.log('Session:', sessionId)
  console.log('No media files found (drop .mp4/.mov/.wav/etc into the session folder and re-run).')
  // Still normalize the manifest so the editor has an (empty) media[] + edit block.
  manifest.media = []
  if (!manifest.edit) manifest.edit = { social: defaultSocial(manifest), chapters: [], master: { aspect: '16:9', res: '1080p' } }
  else if (manifest.edit.social == null) manifest.edit.social = defaultSocial(manifest)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  process.exit(0)
}

// Preserve any manual offsets the user already set, unless --reset.
const prior = {}
if (Array.isArray(manifest.media) && !hasFlag('reset')) {
  for (const m of manifest.media) prior[m.file] = m
}

// ---- choose reference ------------------------------------------------------
console.log('\ndspm-archive sync-media')
console.log('=======================')
console.log('Session:', sessionId)
console.log('Media  :', mediaFiles.length, 'file(s)')
console.log()
console.log('Decoding envelopes...')

// Decode all envelopes once (cached for both ref-selection and alignment).
const env = {}
for (const f of mediaFiles) {
  process.stdout.write('  ' + f + ' ... ')
  const e = envelopeOf(path.join(sDir, f))
  env[f] = e
  console.log(e.silent ? 'no audio' : e.duration.toFixed(1) + 's')
}

let refFile = flag('ref') || (manifest.tape_file && mediaFiles.includes(manifest.tape_file) ? manifest.tape_file : null)
if (!refFile) refFile = mediaFiles.find((f) => /\.wav$/i.test(f)) || null
if (!refFile) {
  // longest audio-bearing clip
  let best = null
  let bestDur = 0
  for (const f of mediaFiles) {
    if (!env[f].silent && env[f].duration > bestDur) {
      best = f
      bestDur = env[f].duration
    }
  }
  refFile = best
}

if (!refFile) {
  console.error('\nNo audio-bearing clip to use as a reference. All clips marked manual.')
}

console.log('\nReference:', refFile || '(none — all manual)')
console.log()

// ---- align -----------------------------------------------------------------
const refEnv = refFile ? env[refFile].env : null
const media = []
let lowConfidence = 0

for (const f of mediaFiles) {
  const isVideo = VIDEO_RE.test(f)
  const kind = isVideo ? 'video' : 'audio'

  if (f === refFile) {
    media.push({ file: f, kind, offset: 0, gain: 1, sync: 'master', confidence: 1 })
    console.log(`  ${f.padEnd(28)} offset   0.000s  [master]`)
    continue
  }

  // Honor an existing manual offset.
  const p = prior[f]
  if (p && p.sync === 'manual') {
    media.push({ file: f, kind, offset: p.offset || 0, gain: p.gain != null ? p.gain : 1, sync: 'manual' })
    console.log(`  ${f.padEnd(28)} offset ${(p.offset || 0).toFixed(3)}s  [manual, kept]`)
    continue
  }

  if (env[f].silent || !refEnv) {
    media.push({ file: f, kind, offset: p ? p.offset || 0 : 0, gain: 1, sync: 'manual' })
    console.log(`  ${f.padEnd(28)} offset   0.000s  [manual — no audio to match]`)
    continue
  }

  const { offset, confidence } = alignClip(refEnv, env[f].env)
  const ok = confidence >= MIN_CONFIDENCE
  if (!ok) lowConfidence++
  media.push({
    file: f,
    kind,
    offset: parseFloat(offset.toFixed(3)),
    gain: 1,
    sync: ok ? 'auto' : 'manual',
    confidence: parseFloat(confidence.toFixed(3)),
  })
  console.log(
    `  ${f.padEnd(28)} offset ${offset >= 0 ? ' ' : ''}${offset.toFixed(3)}s  ` +
      `conf ${(confidence * 100).toFixed(0)}%  [${ok ? 'auto' : 'manual — low confidence'}]`
  )
}

// ---- write manifest --------------------------------------------------------
manifest.media = media
if (refFile) manifest.tape_file = refFile

// Backwards-compat with the current single-video archive viewer: surface the
// first video clip as video_file / video_offset.
const firstVideo = media.find((m) => m.kind === 'video')
if (firstVideo) {
  manifest.video_file = firstVideo.file
  manifest.video_offset = firstVideo.offset
}

// Seed an edit block (EDL) for the web editor if absent, with a SHORT default
// social cut so "render social" is shareable out of the box.
if (!manifest.edit) {
  manifest.edit = {
    social: defaultSocial(manifest), // short ~30s vertical; null if no recording
    chapters: [], // [{ t, name }]
    master: { aspect: '16:9', res: '1080p' },
  }
} else if (manifest.edit.social == null) {
  manifest.edit.social = defaultSocial(manifest)
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

console.log()
console.log('✓ Wrote media[] (' + media.length + ' clips) to manifest.json')
if (lowConfidence > 0) {
  console.log(
    '⚠ ' + lowConfidence + ' clip(s) below ' + (MIN_CONFIDENCE * 100).toFixed(0) +
      '% confidence — flagged manual. Nudge them in the editor.'
  )
}
console.log('  Reload the archive page to apply.')
