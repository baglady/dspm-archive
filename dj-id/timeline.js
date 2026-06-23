'use strict'

// ============================================================
// timeline.js  --  turn raw engine match records into a clean timeline
//
// Input: match records from an engine (see engine-builtin.js for the shape) +
// the catalog. Output: a canonical timeline.json describing which track plays
// from when to when, with confidence, plus crossfade overlaps and unknown gaps.
// ============================================================

// score -> 0..1 confidence (diminishing returns; score 20 ~ 0.5)
function confidenceOf(score, K = 20) {
  if (!score || score <= 0) return 0
  return +(score / (score + K)).toFixed(3)
}

// Build the timeline. opts: { minDurSec=8, minScore=0, minGapSec=10 }
function buildTimeline(records, catalog, mix, opts = {}) {
  const minDur = opts.minDurSec != null ? opts.minDurSec : 8
  const minScore = opts.minScore || 0
  const minGap = opts.minGapSec != null ? opts.minGapSec : 10
  const tracks = (catalog && catalog.tracks) || {}

  const segments = records
    .filter((r) => r.durationSec >= minDur && r.score >= minScore)
    .map((r) => {
      const m = tracks[r.trackId] || {}
      return {
        trackId: r.trackId,
        artist: m.artist || null,
        title: m.title || null,
        display: m.display || r.trackId,
        bpm: m.bpm || null,
        key: m.key || null,
        start_s: +r.queryStartSec.toFixed(2),
        end_s: +r.queryEndSec.toFixed(2),
        ref_start_s: +(r.refStartSec || 0).toFixed(2),
        confidence: confidenceOf(r.score),
        score: r.score,
        pitch_pct: r.stretchPct || 0,
        source_file: m.path || null,
      }
    })
    .sort((a, b) => a.start_s - b.start_s || b.score - a.score)

  // Crossfade overlaps: consecutive segments whose ranges intersect.
  const overlaps = []
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i]
    const b = segments[i + 1]
    const from = Math.max(a.start_s, b.start_s)
    const to = Math.min(a.end_s, b.end_s)
    if (to - from > 0.5) {
      overlaps.push({
        from_s: +from.toFixed(2),
        to_s: +to.toFixed(2),
        out_track: a.display,
        in_track: b.display,
      })
    }
  }

  // Unknown gaps: stretches of the mix no segment covers.
  const dur = (mix && mix.durationSec) || (segments.length ? segments[segments.length - 1].end_s : 0)
  const unknownGaps = []
  let cursor = 0
  const byStart = [...segments].sort((a, b) => a.start_s - b.start_s)
  for (const s of byStart) {
    if (s.start_s - cursor > minGap) {
      unknownGaps.push({ from_s: +cursor.toFixed(2), to_s: +s.start_s.toFixed(2) })
    }
    cursor = Math.max(cursor, s.end_s)
  }
  if (dur && dur - cursor > minGap) {
    unknownGaps.push({ from_s: +cursor.toFixed(2), to_s: +dur.toFixed(2) })
  }

  return {
    mix: (mix && mix.path) || null,
    durationSec: dur ? +dur.toFixed(2) : null,
    engine: opts.engine || null,
    generatedAt: new Date().toISOString(),
    trackCount: segments.length,
    segments,
    overlaps,
    unknownGaps,
  }
}

module.exports = { buildTimeline, confidenceOf }
