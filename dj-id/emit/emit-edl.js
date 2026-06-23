'use strict'

// ============================================================
// emit/emit-edl.js  --  video edit markers from the timeline
//
// Produces two things:
//   <name>.edl        CMX3600 EDL, one event per track (cuts on track changes)
//   <name>.markers.csv  DaVinci Resolve marker import (Timecode,Name,Notes)
//
// Both are timecode-based at a chosen fps; record timecodes run from 00:00:00:00
// along the mix timeline so they line up with a video of the set.
// ============================================================

const fs = require('fs')
const { fmtTimecode } = require('../lib/util')

function toEdl(timeline, fps = 25) {
  const segs = [...timeline.segments].sort((a, b) => a.start_s - b.start_s)
  const L = []
  L.push('TITLE: DJ-ID TIMELINE')
  L.push('FCM: NON-DROP FRAME')
  segs.forEach((s, i) => {
    const n = String(i + 1).padStart(3, '0')
    const recIn = fmtTimecode(s.start_s, fps)
    const recOut = fmtTimecode(s.end_s, fps)
    // Source in/out mirror the record times (single-source assembly).
    L.push(`${n}  AX       V     C        ${recIn} ${recOut} ${recIn} ${recOut}`)
    L.push(`* FROM CLIP NAME: ${s.display}`)
    if (s.pitch_pct) L.push(`* PITCH ${s.pitch_pct > 0 ? '+' : ''}${s.pitch_pct}%`)
  })
  return L.join('\n') + '\n'
}

function toMarkersCsv(timeline, fps = 25) {
  const segs = [...timeline.segments].sort((a, b) => a.start_s - b.start_s)
  const rows = [['Timecode', 'Name', 'Notes', 'Color']]
  for (const s of segs) {
    rows.push([
      fmtTimecode(s.start_s, fps),
      (s.display || '').replace(/,/g, ' '),
      `conf=${s.confidence}${s.bpm ? ' bpm=' + s.bpm : ''}${s.key ? ' key=' + s.key : ''}`,
      'Cyan',
    ])
  }
  for (const o of timeline.overlaps || []) {
    rows.push([fmtTimecode(o.from_s, fps), `XFADE ${o.out_track} > ${o.in_track}`, 'crossfade', 'Yellow'])
  }
  return rows.map((r) => r.join(',')).join('\n') + '\n'
}

function emitEdl(timeline, edlPath, csvPath, fps = 25) {
  fs.writeFileSync(edlPath, toEdl(timeline, fps))
  fs.writeFileSync(csvPath, toMarkersCsv(timeline, fps))
  return { edlPath, csvPath }
}

module.exports = { emitEdl, toEdl, toMarkersCsv }
