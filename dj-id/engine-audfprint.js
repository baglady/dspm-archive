'use strict'

// ============================================================
// engine-audfprint.js  --  audfprint engine (optional fallback)
//
// Dan Ellis' landmark fingerprinter (https://github.com/dpwe/audfprint).
// Lighter to run than Panako and proven for DJ-mix monitoring at near-original
// tempo, but not robust to large tempo/pitch shifts. Same interface as the
// other engines. Requires Python + audfprint installed.
//
// Configure the launcher with AUDFPRINT_CMD, e.g.:
//   AUDFPRINT_CMD="python C:/tools/audfprint/audfprint.py"
// ============================================================

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const name = 'audfprint'

function launcher() {
  const raw = process.env.AUDFPRINT_CMD || 'audfprint'
  const parts = raw.split(' ').filter(Boolean)
  return { cmd: parts[0], pre: parts.slice(1) }
}

function run(args) {
  const l = launcher()
  return spawnSync(l.cmd, [...l.pre, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
}

function dbase(dbDir) {
  return path.join(dbDir, 'audfprint.pklz')
}

function isAvailable() {
  const probe = run(['--help'])
  if (probe.error) {
    return {
      ok: false,
      reason: 'Could not launch audfprint. Set AUDFPRINT_CMD (e.g. "python /path/audfprint.py"). See dj-id/README.md.',
    }
  }
  return { ok: true }
}

function store(refs, dbDir, onProgress) {
  fs.mkdirSync(dbDir, { recursive: true })
  const db = dbase(dbDir)
  const exists = fs.existsSync(db)
  const files = refs.map((r) => r.wav)
  // `new` to create, `add` to extend.
  const verb = exists ? 'add' : 'new'
  const res = run([verb, '--dbase', db, ...files])
  if (res.status !== 0) {
    const err = (res.stderr ? res.stderr.toString() : '').slice(-300)
    throw new Error('audfprint ' + verb + ' failed\n' + err)
  }
  if (onProgress) onProgress(refs.length, refs.length, '(batch)')
  return { tracks: refs.length }
}

// Parse lines like:
// "Matched 12.3 s starting at 5.0 s in mix.wav to time 30.2 s in trk_abc.wav
//  with 45 of 60 common hashes at rank 0"
function extractMatch(line) {
  const idm = line.match(/trk_[0-9a-f]{12}/)
  if (!idm) return null
  const m = line.match(
    /Matched\s+([\d.]+)\s*s\s+starting at\s+([\d.]+)\s*s.*?to time\s+([\d.]+)\s*s.*?with\s+(\d+)\s+of\s+(\d+)/i
  )
  if (!m) return null
  const dur = parseFloat(m[1])
  const qStart = parseFloat(m[2])
  const rStart = parseFloat(m[3])
  const common = parseInt(m[4], 10)
  return {
    trackId: idm[0],
    refStartSec: rStart,
    queryStartSec: qStart,
    queryEndSec: qStart + dur,
    durationSec: dur,
    stretchPct: 0,
    score: common,
  }
}

function query(mixWav, dbDir, opts = {}) {
  const res = run(['match', '--dbase', dbase(dbDir), '--find-time-range', '--max-matches', '20', mixWav])
  if (res.status !== 0 && res.error) {
    throw new Error('audfprint match failed: ' + (res.error.message || 'unknown'))
  }
  const out = (res.stdout ? res.stdout.toString() : '') + (res.stderr ? res.stderr.toString() : '')
  const records = []
  for (const line of out.split(/\r?\n/)) {
    const rec = extractMatch(line)
    if (rec) records.push(rec)
  }
  records.sort((a, b) => a.queryStartSec - b.queryStartSec)
  return records
}

module.exports = { name, isAvailable, store, query }
