'use strict'

// ============================================================
// identify.js  --  match a recorded mix against the library
//
//   node djid.js identify <mix> [--db <dir>] [--engine ...]
//                               [--out timeline.json] [--min-dur 8]
//
// Decodes the mix to a mono 16 kHz WAV, runs the engine query, builds the
// canonical timeline, and writes timeline.json next to the mix (or --out).
// ============================================================

const fs = require('fs')
const os = require('os')
const path = require('path')

const { decodeToWav, probeTags } = require('./lib/ffmpeg')
const { getEngine } = require('./lib/engine')
const { loadCatalog } = require('./ingest')
const { buildTimeline } = require('./timeline')

function identify(mixPath, opts = {}) {
  const dbDir = path.resolve(opts.db || path.join(__dirname, 'data'))
  const engine = getEngine(opts.engine)

  const avail = engine.isAvailable()
  if (!avail.ok) throw new Error(`engine "${engine.name}" unavailable: ${avail.reason}`)
  if (!fs.existsSync(mixPath)) throw new Error('mix not found: ' + mixPath)

  const catalog = loadCatalog(dbDir)
  const nTracks = Object.keys(catalog.tracks || {}).length
  if (!nTracks) throw new Error(`catalog is empty (${dbDir}). Run "djid ingest" first.`)

  console.log(`[identify] engine=${engine.name} db=${dbDir} (${nTracks} tracks)`)
  const mixAbs = path.resolve(mixPath)
  const tags = probeTags(mixAbs)

  // Engines consume a WAV; decode once.
  const tmp = path.join(os.tmpdir(), 'djid-mix-' + process.pid + '.wav')
  console.log(`[identify] decoding mix ...`)
  decodeToWav(mixAbs, tmp)

  let records
  try {
    console.log(`[identify] querying ...`)
    records = engine.query(tmp, dbDir, { minVotes: opts.minVotes })
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch (e) {}
  }
  console.log(`[identify] ${records.length} raw match(es)`)

  const timeline = buildTimeline(records, catalog, { path: mixAbs, durationSec: tags.durationSec }, {
    engine: engine.name,
    minDurSec: opts.minDur != null ? Number(opts.minDur) : undefined,
  })

  const outPath = path.resolve(
    opts.out || path.join(path.dirname(mixAbs), path.basename(mixAbs, path.extname(mixAbs)) + '.timeline.json')
  )
  fs.writeFileSync(outPath, JSON.stringify(timeline, null, 2))

  console.log(`[identify] ${timeline.trackCount} track(s) on the timeline -> ${outPath}`)
  for (const s of timeline.segments) {
    const mm = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(Math.floor(x % 60)).padStart(2, '0')}`
    console.log(
      `   ${mm(s.start_s)}-${mm(s.end_s)}  ${s.display}` +
        (s.pitch_pct ? `  [${s.pitch_pct > 0 ? '+' : ''}${s.pitch_pct}%]` : '') +
        `  conf=${s.confidence}`
    )
  }
  if (timeline.overlaps.length) console.log(`[identify] ${timeline.overlaps.length} crossfade overlap(s)`)
  if (timeline.unknownGaps.length) console.log(`[identify] ${timeline.unknownGaps.length} unknown gap(s)`)

  return { timeline, outPath }
}

module.exports = { identify }
