'use strict'

// ============================================================
// emit/emit-snippets.js  --  ffmpeg auto-cut the mix into per-track clips
// ============================================================

const fs = require('fs')
const path = require('path')
const { sliceAudio } = require('../lib/ffmpeg')
const { slug } = require('../lib/util')

// Cut one file per timeline segment. opts: { format='wav', pad=0 }
// `pad` extends each clip by N seconds on both sides (handy for transitions).
function emitSnippets(timeline, mixFile, outDir, opts = {}) {
  if (!mixFile) throw new Error('snippets need the source mix file (--mix <file>)')
  const format = (opts.format || 'wav').replace(/^\./, '')
  const pad = opts.pad || 0
  fs.mkdirSync(outDir, { recursive: true })

  const dur = timeline.durationSec || Infinity
  const segs = [...timeline.segments].sort((a, b) => a.start_s - b.start_s)
  const out = []
  segs.forEach((s, i) => {
    const start = Math.max(0, s.start_s - pad)
    const end = Math.min(dur, s.end_s + pad)
    const n = String(i + 1).padStart(2, '0')
    const fname = `${n} - ${slug(s.display)}.${format}`
    const fpath = path.join(outDir, fname)
    sliceAudio(mixFile, fpath, start, end)
    out.push(fpath)
    process.stdout.write(`[snippets] ${fname}\n`)
  })
  return out
}

module.exports = { emitSnippets }
