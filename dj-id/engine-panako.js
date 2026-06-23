'use strict'

// ============================================================
// engine-panako.js  --  Panako fingerprint engine (optional, robust)
//
// Panako (https://github.com/JorenSix/Panako) is purpose-built for DJ sets:
// it matches references that have been time-stretched / pitch-shifted up to
// ~10% and reports the reference start time AND the stretch/pitch factor.
// Requires a JRE + the Panako jar. We shell out to it.
//
// Same interface as engine-builtin.js. We name each decoded reference WAV
// `<trackId>.wav`, so Panako's reported resource identifier maps straight back
// to our catalog.
//
// NOTE: Panako's query/monitor CSV columns vary across versions. The parser
// below is defensive (it locates the trk_ token and reads the numeric fields
// around it) but you may need to adjust extractMatch() for your Panako build.
// Run `node djid.js doctor` to sanity-check availability.
// ============================================================

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { HOP } = require('./lib/fingerprint') // unused but documents framing parity

const name = 'panako'

// How to invoke Panako:
//   PANAKO_CMD  -> a launcher on PATH (e.g. "panako")              [preferred]
//   PANAKO_JAR  -> path to panako jar, run via `java -jar <jar>`
function panakoBase() {
  if (process.env.PANAKO_CMD) return { kind: 'cmd', cmd: process.env.PANAKO_CMD, pre: [] }
  if (process.env.PANAKO_JAR) return { kind: 'jar', cmd: 'java', pre: ['-jar', process.env.PANAKO_JAR] }
  return { kind: 'cmd', cmd: 'panako', pre: [] } // hope it's on PATH
}

function run(args, opts = {}) {
  const base = panakoBase()
  return spawnSync(base.cmd, [...base.pre, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  })
}

function isAvailable() {
  const jav = spawnSync('java', ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] })
  if (jav.status !== 0 && jav.error) {
    return { ok: false, reason: 'Java (JRE) not found on PATH. Install a JRE to use the Panako engine.' }
  }
  const base = panakoBase()
  if (base.kind === 'jar' && !fs.existsSync(process.env.PANAKO_JAR)) {
    return { ok: false, reason: 'PANAKO_JAR points to a missing file: ' + process.env.PANAKO_JAR }
  }
  const probe = run(['--help'])
  if (probe.error) {
    return {
      ok: false,
      reason:
        'Could not launch Panako. Set PANAKO_CMD (a launcher on PATH) or PANAKO_JAR (path to the jar). See dj-id/README.md.',
    }
  }
  return { ok: true }
}

// Index reference tracks. Panako manages its own on-disk DB; `dbDir` is unused
// here (kept for interface parity). Files are already named <trackId>.wav.
function store(refs, dbDir, onProgress) {
  let done = 0
  for (const r of refs) {
    const res = run(['store', r.wav])
    if (res.status !== 0) {
      const err = (res.stderr ? res.stderr.toString() : '').slice(-300)
      throw new Error('panako store failed for ' + r.trackId + '\n' + err)
    }
    done++
    if (onProgress) onProgress(done, refs.length, r.trackId)
  }
  return { tracks: refs.length }
}

// Pull a match out of one Panako output line. Returns a partial record or null.
function extractMatch(line) {
  if (!/trk_[0-9a-f]{12}/.test(line)) return null
  const idMatch = line.match(/trk_[0-9a-f]{12}/)
  const trackId = idMatch[0]
  // Numeric fields, in order of appearance. Panako reports (among others):
  // query start, query stop, ref start, ref stop, time factor, freq factor.
  const nums = (line.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)
  // Heuristic: the trailing pair of small ratios (~0.9..1.1) are the time and
  // frequency factors; the four seconds-scale numbers before the path are the
  // start/stop pairs. We keep this tolerant and fall back to zeros.
  const factors = nums.filter((n) => n > 0.5 && n < 1.6)
  const timeFactor = factors.length ? factors[factors.length - 2] || 1 : 1
  // seconds-scale: positive numbers that aren't the ratio factors
  const secs = nums.filter((n) => n >= 0 && !(n > 0.5 && n < 1.6))
  const [qStart = 0, qStop = 0, rStart = 0] = secs
  return {
    trackId,
    refStartSec: rStart,
    queryStartSec: qStart,
    queryEndSec: qStop,
    durationSec: Math.max(0, qStop - qStart),
    stretchPct: +(((timeFactor || 1) - 1) * 100).toFixed(2),
    score: 0,
  }
}

function query(mixWav, dbDir, opts = {}) {
  const res = run(['query', mixWav])
  if (res.status !== 0 && res.error) {
    throw new Error('panako query failed: ' + (res.error.message || 'unknown'))
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
