'use strict'

// ============================================================
// engine-builtin.js  --  zero-dependency fingerprint engine (default)
//
// Implements the common engine interface used by ingest.js / identify.js:
//   isAvailable()                 -> { ok, reason }
//   store(refs, dbDir)            -> index reference tracks
//   query(mixWav, dbDir, opts)    -> [ matchRecord ]
//
// matchRecord = {
//   trackId, refStartSec, queryStartSec, queryEndSec, durationSec,
//   stretchPct, score
// }
//
// Uses lib/fingerprint.js (constellation hashing). Persists the index as a
// single JSON file. Postings are stored flat ([trackIdx, tFrame, ...]) to keep
// the file compact for a personal-size library.
// ============================================================

const fs = require('fs')
const path = require('path')
const { readPcm16Wav } = require('./lib/wav')
const fp = require('./lib/fingerprint')

const DB_FILE = 'builtin-index.json'
const MIN_VOTES = 5 // matching landmarks needed to count (cf. audfprint default)
const DT_TOL = 2 // frames of slack when clustering an offset
const GATE = 0.4 // a 2nd+ occurrence must reach this fraction of the best offset
const OVERLAP_SUPPRESS = 0.5 // suppress a same-track occurrence overlapping an accepted one by >this

const name = 'builtin'

function isAvailable() {
  return { ok: true }
}

function dbPath(dbDir) {
  return path.join(dbDir, DB_FILE)
}

function loadDb(dbDir) {
  const p = dbPath(dbDir)
  if (!fs.existsSync(p)) return { tracks: [], postings: {} }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
  return { tracks: raw.tracks || [], postings: raw.postings || {} }
}

function saveDb(dbDir, db) {
  fs.mkdirSync(dbDir, { recursive: true })
  fs.writeFileSync(dbPath(dbDir), JSON.stringify(db))
}

// Index reference tracks. `refs` = [{ trackId, wav }]. Re-ingesting a trackId
// replaces its old postings.
function store(refs, dbDir, onProgress) {
  const db = loadDb(dbDir)
  const idxOf = new Map(db.tracks.map((t, i) => [t, i]))

  // Drop postings for any trackId being re-ingested.
  const reingest = new Set()
  for (const r of refs) if (idxOf.has(r.trackId)) reingest.add(idxOf.get(r.trackId))
  if (reingest.size) {
    for (const key of Object.keys(db.postings)) {
      const flat = db.postings[key]
      const kept = []
      for (let i = 0; i < flat.length; i += 2) {
        if (!reingest.has(flat[i])) kept.push(flat[i], flat[i + 1])
      }
      if (kept.length) db.postings[key] = kept
      else delete db.postings[key]
    }
  }

  let done = 0
  for (const r of refs) {
    let ti = idxOf.get(r.trackId)
    if (ti === undefined) {
      ti = db.tracks.length
      db.tracks.push(r.trackId)
      idxOf.set(r.trackId, ti)
    }
    const { samples } = readPcm16Wav(r.wav)
    const hashes = fp.fingerprint(samples)
    for (const [h, t] of hashes) {
      const key = String(h)
      const arr = db.postings[key] || (db.postings[key] = [])
      arr.push(ti, t)
    }
    done++
    if (onProgress) onProgress(done, refs.length, r.trackId)
  }

  saveDb(dbDir, db)
  return { tracks: db.tracks.length }
}

// Query a mix WAV against the DB -> match records (one per occurrence).
function query(mixWav, dbDir, opts = {}) {
  const minVotes = opts.minVotes || MIN_VOTES
  const db = loadDb(dbDir)
  if (!db.tracks.length) return []
  const map = db.postings

  const { samples, rate } = readPcm16Wav(mixWav)
  const qHashes = fp.fingerprint(samples)

  // Per track: offset(deltaT frames) -> { count, minTQ, maxTQ }
  const perTrack = new Map() // trackIdx -> Map(deltaT -> stats)
  for (const [h, tQ] of qHashes) {
    const flat = map[String(h)]
    if (!flat) continue
    for (let i = 0; i < flat.length; i += 2) {
      const ti = flat[i]
      const tRef = flat[i + 1]
      const dt = tRef - tQ
      let offMap = perTrack.get(ti)
      if (!offMap) perTrack.set(ti, (offMap = new Map()))
      let st = offMap.get(dt)
      if (!st) offMap.set(dt, (st = { count: 0, minTQ: tQ, maxTQ: tQ }))
      st.count++
      if (tQ < st.minTQ) st.minTQ = tQ
      if (tQ > st.maxTQ) st.maxTQ = tQ
    }
  }

  const records = []
  for (const [ti, offMap] of perTrack) {
    // 1) Collapse offsets into clusters (merge within DT_TOL frames so small
    //    drift doesn't fragment a single alignment).
    const offsets = [...offMap.entries()].sort((a, b) => b[1].count - a[1].count)
    const used = new Set()
    const clusters = []
    for (const [dt, st] of offsets) {
      if (used.has(dt)) continue
      let count = st.count
      let minTQ = st.minTQ
      let maxTQ = st.maxTQ
      for (let d = dt - DT_TOL; d <= dt + DT_TOL; d++) {
        if (d === dt || used.has(d)) continue
        const s2 = offMap.get(d)
        if (!s2) continue
        used.add(d)
        count += s2.count
        if (s2.minTQ < minTQ) minTQ = s2.minTQ
        if (s2.maxTQ > maxTQ) maxTQ = s2.maxTQ
      }
      used.add(dt)
      if (count >= minVotes) clusters.push({ dt, count, minTQ, maxTQ })
    }
    if (!clusters.length) continue

    // 2) A real occurrence is ONE dominant offset over a time span. Self-similar
    //    or repetitive audio produces many offsets that cover the same span; we
    //    accept clusters strongest-first and suppress any whose query-time span
    //    substantially overlaps one already accepted for this track. Genuinely
    //    distinct plays (a reload later in the set) are temporally separated and
    //    survive. We also gate weak clusters against the track's best.
    clusters.sort((a, b) => b.count - a.count)
    const best = clusters[0].count
    const accepted = []
    for (const c of clusters) {
      if (c.count < Math.max(minVotes, GATE * best)) continue
      const span = c.maxTQ - c.minTQ || 1
      const overlaps = accepted.some((a) => {
        const from = Math.max(a.minTQ, c.minTQ)
        const to = Math.min(a.maxTQ, c.maxTQ)
        const ov = Math.max(0, to - from)
        return ov / Math.min(span, a.maxTQ - a.minTQ || 1) > OVERLAP_SUPPRESS
      })
      if (overlaps) continue
      accepted.push(c)
    }

    for (const c of accepted) {
      const queryStartSec = fp.framesToSec(c.minTQ, rate)
      const queryEndSec = fp.framesToSec(c.maxTQ, rate)
      records.push({
        trackId: db.tracks[ti],
        refStartSec: fp.framesToSec(c.minTQ + c.dt, rate),
        queryStartSec,
        queryEndSec,
        durationSec: Math.max(0, queryEndSec - queryStartSec),
        stretchPct: 0, // built-in engine does not estimate tempo/pitch shift
        score: c.count,
      })
    }
  }

  records.sort((a, b) => a.queryStartSec - b.queryStartSec)
  return records
}

module.exports = { name, isAvailable, store, query }
