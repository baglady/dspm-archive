#!/usr/bin/env node
'use strict'

// ============================================================
// djid.js  --  CLI entry for dj-id ("Shazam for DJs", non-AI)
//
//   node djid.js ingest <path>      build the library from a folder / USB
//   node djid.js identify <mix>     tag which track plays where in a recording
//   node djid.js emit <timeline>    cue / snippets / video markers / render-edl
//   node djid.js doctor             check engines + DJ-software databases
//
// See dj-id/README.md for the full pipeline and setup.
// ============================================================

const fs = require('fs')
const path = require('path')
const { parseArgs } = require('./lib/args')

const BOOLEAN = ['cue', 'snippets', 'edl', 'render', 'keep-wav', 'help']

function usage() {
  console.log(
    `dj-id -- personal DJ music identifier (non-AI acoustic fingerprinting)

Usage:
  node djid.js ingest <path> [--db <dir>] [--engine builtin|panako|audfprint]
                             [--keep-wav] [--limit N]
  node djid.js identify <mix> [--db <dir>] [--engine ...] [--out <file>] [--min-dur 8]
  node djid.js emit <timeline.json> [--mix <file>] [--outdir <dir>]
                             [--cue] [--snippets] [--edl] [--render]
                             [--format wav|mp3] [--fps 25] [--pad 0]
                             [--session-id <id>] [--source auto|viz|<file>]
  node djid.js doctor [--db <dir>] [--scan <path>]

Engines:
  builtin    zero-setup landmark fingerprinting (default)
  panako     robust to DJ time-stretch/pitch-shift (needs Java + Panako jar)
  audfprint  lighter fallback (needs Python + audfprint)

If no emit outputs are named, --cue and --edl are produced by default.`
  )
}

function cmdIngest(a) {
  const root = a._[0]
  if (!root) return usage()
  const { ingest } = require('./ingest')
  ingest(root, {
    db: a.flags.db,
    engine: a.flags.engine,
    keepWav: !!a.flags['keep-wav'],
    limit: a.flags.limit,
  })
}

function cmdIdentify(a) {
  const mix = a._[0]
  if (!mix) return usage()
  const { identify } = require('./identify')
  identify(mix, {
    db: a.flags.db,
    engine: a.flags.engine,
    out: a.flags.out,
    minDur: a.flags['min-dur'],
  })
}

function cmdEmit(a) {
  const tl = a._[0]
  if (!tl) return usage()
  if (!fs.existsSync(tl)) throw new Error('timeline not found: ' + tl)
  const timeline = JSON.parse(fs.readFileSync(tl, 'utf8'))
  const { emitAll } = require('./emit')
  emitAll(timeline, {
    mix: a.flags.mix,
    outDir: a.flags.outdir,
    cue: !!a.flags.cue,
    snippets: !!a.flags.snippets,
    edl: !!a.flags.edl,
    render: !!a.flags.render,
    format: a.flags.format,
    fps: a.flags.fps,
    pad: a.flags.pad,
    sessionId: a.flags['session-id'],
    source: a.flags.source,
  })
}

function cmdDoctor(a) {
  const { getEngine, ENGINES } = require('./lib/engine')
  console.log('dj-id doctor\n')
  console.log('Engines:')
  for (const name of Object.keys(ENGINES)) {
    let status
    try {
      const r = getEngine(name).isAvailable()
      status = r.ok ? 'OK' : 'unavailable -- ' + r.reason
    } catch (e) {
      status = 'error -- ' + e.message
    }
    console.log(`  ${name.padEnd(10)} ${status}`)
  }

  const dbDir = path.resolve(a.flags.db || path.join(__dirname, 'data'))
  console.log('\nLibrary:')
  const catPath = path.join(dbDir, 'catalog.json')
  if (fs.existsSync(catPath)) {
    const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'))
    console.log(`  catalog: ${catPath} (${Object.keys(cat.tracks || {}).length} tracks)`)
  } else {
    console.log(`  no catalog yet at ${catPath} (run ingest)`)
  }

  if (a.flags.scan) {
    const { adapters } = require('./adapters')
    console.log(`\nDJ databases under ${a.flags.scan}:`)
    for (const ad of adapters) {
      let present = false
      try {
        present = ad.detect(a.flags.scan)
      } catch (e) {}
      console.log(`  ${ad.name.padEnd(10)} ${present ? 'detected' : 'not found'}`)
    }
  }
}

function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  const a = parseArgs(argv.slice(1), BOOLEAN)
  if (!cmd || a.flags.help || cmd === 'help') return usage()
  try {
    if (cmd === 'ingest') return cmdIngest(a)
    if (cmd === 'identify') return cmdIdentify(a)
    if (cmd === 'emit') return cmdEmit(a)
    if (cmd === 'doctor') return cmdDoctor(a)
    console.error('unknown command: ' + cmd + '\n')
    usage()
    process.exit(1)
  } catch (e) {
    console.error('[djid] error: ' + e.message)
    process.exit(1)
  }
}

main()
