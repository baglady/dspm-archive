'use strict'

// ============================================================
// adapters/enginedj.js  --  Engine DJ (Denon) library adapter
//
// Engine DJ writes a plain SQLite database under "Engine Library/" (m.db /
// Database2/m.db). Rich metadata + cues live there. Full extraction is wired
// up in a later step; for now we only DETECT the library so `doctor` can report
// it. Loose-file tags still cover these tracks until extraction lands.
// ============================================================

const fs = require('fs')
const path = require('path')

const name = 'enginedj'

function findDbs(root, hits = [], depth = 0) {
  if (depth > 4) return hits
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch (e) {
    return hits
  }
  for (const ent of entries) {
    const full = path.join(root, ent.name)
    if (ent.isDirectory()) {
      if (/^engine library$/i.test(ent.name) || /^database2?$/i.test(ent.name)) {
        for (const f of ['m.db', 'p.db', 'hm.db']) {
          const cand = path.join(full, f)
          if (fs.existsSync(cand)) hits.push(cand)
        }
      }
      findDbs(full, hits, depth + 1)
    }
  }
  return hits
}

function detect(root) {
  return findDbs(root).length > 0
}

// TODO(step 5): read the SQLite DB (via sqlite3 CLI or a pure-JS reader) and
// emit Map(absPath -> { bpm, key, cues, beatgridFirstBeatSec, source }).
function collect(root) {
  return new Map()
}

module.exports = { name, detect, collect, findDbs }
