'use strict'

// ============================================================
// emit/index.js  --  run the requested output generators over a timeline
// ============================================================

const fs = require('fs')
const path = require('path')

const { emitCue } = require('./emit-cue')
const { emitSnippets } = require('./emit-snippets')
const { emitEdl } = require('./emit-edl')
const { emitRenderJobs } = require('./emit-render-jobs')

// opts: { mix, outDir, cue, snippets, edl, render, fps, format, pad, sessionId, source }
function emitAll(timeline, opts = {}) {
  const outDir = path.resolve(opts.outDir || 'djid-out')
  fs.mkdirSync(outDir, { recursive: true })
  const base = timeline.mix ? path.basename(timeline.mix, path.extname(timeline.mix)) : 'mix'
  const fps = opts.fps ? Number(opts.fps) : 25
  const made = {}

  // If no specific outputs requested, do the lightweight ones.
  const any = opts.cue || opts.snippets || opts.edl || opts.render
  const cue = any ? opts.cue : true
  const edl = any ? opts.edl : true

  if (cue) {
    made.cue = emitCue(timeline, path.join(outDir, base + '.cue'), opts.mix || timeline.mix)
    console.log('[emit] cue      -> ' + made.cue)
  }
  if (edl) {
    const r = emitEdl(timeline, path.join(outDir, base + '.edl'), path.join(outDir, base + '.markers.csv'), fps)
    made.edl = r.edlPath
    made.markers = r.csvPath
    console.log('[emit] edl      -> ' + r.edlPath)
    console.log('[emit] markers  -> ' + r.csvPath)
  }
  if (opts.render) {
    const r = emitRenderJobs(
      timeline,
      path.join(outDir, base + '.render-edl.json'),
      path.join(outDir, base + '.render-master.cmds.txt'),
      { sessionId: opts.sessionId, source: opts.source }
    )
    made.renderEdl = r.edlPath
    made.renderCmds = r.cmdsPath
    console.log('[emit] render   -> ' + r.edlPath)
  }
  if (opts.snippets) {
    const dir = path.join(outDir, base + '-snippets')
    made.snippets = emitSnippets(timeline, opts.mix || timeline.mix, dir, {
      format: opts.format,
      pad: opts.pad ? Number(opts.pad) : 0,
    })
    console.log('[emit] snippets -> ' + dir + ` (${made.snippets.length} files)`)
  }
  return made
}

module.exports = { emitAll }
