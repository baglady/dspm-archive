'use strict'

// ============================================================
// adapters/index.js  --  DJ-software metadata collection
//
// Scans a library root for DJ-software databases and returns richer per-track
// metadata (BPM, key, cue points, beatgrid) keyed by ABSOLUTE audio path, to
// be merged over the basic tags read from the files themselves.
//
// Each adapter exports: detect(root) -> bool, collect(root) -> Map(absPath -> meta).
// meta = { artist, title, bpm, key, cues:[{name,sec}], beatgridFirstBeatSec, source }
//
// Rekordbox (PDB) and Engine DJ (SQLite) adapters are added in a later step;
// until then loose-file tag scanning fully covers ingest.
// ============================================================

const adapters = [
  require('./enginedj'),
  require('./rekordbox'),
]

// Returns Map(absPath -> meta) merged across all detected adapters.
function collectDjMetadata(root) {
  const merged = new Map()
  for (const a of adapters) {
    let present = false
    try {
      present = a.detect(root)
    } catch (e) {
      present = false
    }
    if (!present) continue
    try {
      const m = a.collect(root)
      for (const [k, v] of m) {
        merged.set(k, { ...(merged.get(k) || {}), ...v })
      }
    } catch (e) {
      process.stderr.write(`[adapters] ${a.name} failed: ${e.message}\n`)
    }
  }
  return merged
}

module.exports = { collectDjMetadata, adapters }
