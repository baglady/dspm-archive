'use strict'

// ============================================================
// emit/emit-render-jobs.js  --  feed the bridge render pipeline
//
// The bridge renderers (bridge/render-master.js, bridge/render-jobs.js) cut a
// window of a session with --start/--end. This emitter writes a render-EDL that
// maps each identified track to such a window, plus a ready-to-run command list
// so visuals/video can be cut on track boundaries.
//
// Output:
//   render-edl.json        { sessionId, segments:[{ index, start_s, end_s, label }] }
//   render-master.cmds.txt  one `node render-master.js ...` line per segment
// ============================================================

const fs = require('fs')
const path = require('path')
const { slug } = require('../lib/util')

function buildRenderEdl(timeline, opts = {}) {
  const sessionId = opts.sessionId || '<SESSION_ID>'
  const segs = [...timeline.segments].sort((a, b) => a.start_s - b.start_s)
  return {
    sessionId,
    source: opts.source || 'auto',
    generatedAt: new Date().toISOString(),
    segments: segs.map((s, i) => ({
      index: i + 1,
      start_s: s.start_s,
      end_s: s.end_s,
      label: s.display,
      bpm: s.bpm || null,
      key: s.key || null,
    })),
  }
}

function emitRenderJobs(timeline, edlPath, cmdsPath, opts = {}) {
  const edl = buildRenderEdl(timeline, opts)
  fs.writeFileSync(edlPath, JSON.stringify(edl, null, 2))

  // Relative path from bridge/ to invoke render-master per segment window.
  const lines = ['# Run from the repo bridge/ directory after the session exists:']
  for (const s of edl.segments) {
    const out = `seg_${String(s.index).padStart(2, '0')}_${slug(s.label)}.mp4`
    lines.push(
      `node render-master.js ${edl.sessionId} --source ${edl.source} ` +
        `--start ${s.start_s} --end ${s.end_s} --out ${out}   # ${s.label}`
    )
  }
  fs.writeFileSync(cmdsPath, lines.join('\n') + '\n')
  return { edlPath, cmdsPath }
}

module.exports = { emitRenderJobs, buildRenderEdl }
