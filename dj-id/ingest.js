'use strict'

// ============================================================
// ingest.js  --  build the reference library from a folder / USB stick
//
//   node djid.js ingest <path> [--db <dir>] [--engine builtin|panako|audfprint]
//                               [--keep-wav] [--limit N]
//
// Walks <path> for audio, reads tags (+ DJ-software metadata where present),
// decodes each track to a mono 16 kHz WAV named <trackId>.wav, feeds those to
// the chosen fingerprint engine, and writes catalog.json (trackId -> metadata).
// ============================================================

const fs = require('fs')
const os = require('os')
const path = require('path')

const { walkAudio, probeTags, decodeToWav } = require('./lib/ffmpeg')
const { trackId, displayName } = require('./lib/util')
const { getEngine } = require('./lib/engine')
const { collectDjMetadata } = require('./adapters')

function catalogPath(dbDir) {
  return path.join(dbDir, 'catalog.json')
}

function loadCatalog(dbDir) {
  const p = catalogPath(dbDir)
  if (!fs.existsSync(p)) return { createdAt: new Date().toISOString(), tracks: {} }
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function saveCatalog(dbDir, cat) {
  fs.mkdirSync(dbDir, { recursive: true })
  cat.updatedAt = new Date().toISOString()
  fs.writeFileSync(catalogPath(dbDir), JSON.stringify(cat, null, 2))
}

function ingest(rootPath, opts = {}) {
  const dbDir = path.resolve(opts.db || path.join(__dirname, 'data'))
  const engine = getEngine(opts.engine)
  const keepWav = !!opts.keepWav

  const avail = engine.isAvailable()
  if (!avail.ok) throw new Error(`engine "${engine.name}" unavailable: ${avail.reason}`)

  if (!fs.existsSync(rootPath)) throw new Error('ingest path not found: ' + rootPath)

  console.log(`[ingest] engine=${engine.name} db=${dbDir}`)
  console.log(`[ingest] scanning ${rootPath} ...`)

  let files = walkAudio(rootPath)
  if (opts.limit) files = files.slice(0, Number(opts.limit))
  if (!files.length) {
    console.log('[ingest] no audio files found.')
    return { tracks: 0, dbDir }
  }
  console.log(`[ingest] ${files.length} audio file(s) found`)

  // DJ-software metadata (rekordbox / engine dj) keyed by absolute path.
  const djMeta = collectDjMetadata(rootPath)
  if (djMeta.size) console.log(`[ingest] ${djMeta.size} track(s) enriched from DJ database(s)`)

  const cat = loadCatalog(dbDir)
  const wavDir = keepWav
    ? (fs.mkdirSync(path.join(dbDir, 'refwav'), { recursive: true }), path.join(dbDir, 'refwav'))
    : fs.mkdtempSync(path.join(os.tmpdir(), 'djid-ref-'))

  const refs = []
  let n = 0
  for (const file of files) {
    n++
    const abs = path.resolve(file)
    const id = trackId(abs)
    const tags = probeTags(abs)
    const extra = djMeta.get(abs) || {}
    const meta = {
      trackId: id,
      path: abs,
      file: path.basename(abs),
      artist: extra.artist || tags.artist || null,
      title: extra.title || tags.title || null,
      album: tags.album || null,
      bpm: extra.bpm || tags.bpm || null,
      key: extra.key || tags.key || null,
      durationSec: tags.durationSec || null,
      cues: extra.cues || null,
      source: extra.source || 'tags',
      addedAt: new Date().toISOString(),
    }
    meta.display = displayName(meta, abs)
    cat.tracks[id] = meta

    const wav = path.join(wavDir, id + '.wav')
    try {
      if (!(keepWav && fs.existsSync(wav))) decodeToWav(abs, wav)
      refs.push({ trackId: id, wav })
    } catch (e) {
      console.warn(`[ingest] skip (decode failed): ${meta.file} -- ${e.message.split('\n')[0]}`)
      continue
    }
    const pct = Math.round((n / files.length) * 100)
    process.stdout.write(`[ingest] decoded ${n}/${files.length} (${pct}%) ${meta.display}\n`)
  }

  if (!refs.length) throw new Error('nothing decoded successfully')

  console.log(`[ingest] fingerprinting ${refs.length} track(s) with ${engine.name} ...`)
  engine.store(refs, dbDir, (done, total, tid) => {
    if (done % 10 === 0 || done === total) {
      process.stdout.write(`[ingest] indexed ${done}/${total} (${Math.round((done / total) * 100)}%)\n`)
    }
  })

  saveCatalog(dbDir, cat)

  if (!keepWav) {
    try {
      fs.rmSync(wavDir, { recursive: true, force: true })
    } catch (e) {}
  }

  console.log(`[ingest] done. catalog: ${catalogPath(dbDir)} (${Object.keys(cat.tracks).length} tracks total)`)
  return { tracks: refs.length, dbDir }
}

module.exports = { ingest, catalogPath, loadCatalog }
