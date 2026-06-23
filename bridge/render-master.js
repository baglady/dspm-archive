#!/usr/bin/env node
'use strict'

// ============================================================
// render-master.js  --  high-quality release master (16:9)
//
// Produces the full-length HQ master used for upload / duplication, and as
// the source for DVD authoring. Picks a video source per the edit decision
// list and muxes the mixed audio bed under it:
//
//   --source <file>   use this video clip
//   --source viz      synthesize the master from the automation viz (16:9)
//   --source auto     first video clip if any, else viz  (default)
//
// Other options:
//   --start/--end <s>   window (default: full recording)
//   --res 1080p|720p    (default 1080p)
//   --out <file>        (default render_master_*.mp4)
//
// Output is recorded in manifest.renders[] with kind:"master".
// ============================================================

const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { getFfmpeg, hasAudioStream } = require('./audio-sync')
const { buildAudioBed } = require('./media-bed')

const args = process.argv.slice(2)
const sessionId = args.find((a) => !a.startsWith('--'))
const flag = (n, d) => {
  const i = args.indexOf('--' + n)
  return i >= 0 ? args[i + 1] : d
}
if (!sessionId) {
  console.error('Usage: node render-master.js <session-id> [--source auto|viz|file] [--res 1080p] [--start s --end s] [--out f]')
  process.exit(1)
}

const SESSIONS_DIR = path.join(__dirname, '..', 'sessions')
const SESSIONS_ROOT = path.resolve(SESSIONS_DIR)
const sDir = path.resolve(path.join(SESSIONS_DIR, sessionId))
if ((!sDir.startsWith(SESSIONS_ROOT + path.sep) && sDir !== SESSIONS_ROOT) || !fs.existsSync(sDir)) {
  console.error('Session not found:', sessionId)
  process.exit(1)
}
const manifestPath = path.join(sDir, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

const RES = { '1080p': [1920, 1080], '720p': [1280, 720] }
const [W, H] = RES[flag('res', '1080p')] || RES['1080p']

const rec = manifest.recording || {}
const editMaster = (manifest.edit && manifest.edit.master) || {}
let start = flag('start', null)
let end = flag('end', null)
start = start != null ? parseFloat(start) : editMaster.start != null ? editMaster.start : rec.start_t != null ? rec.start_t : 0
end = end != null ? parseFloat(end) : editMaster.end != null ? editMaster.end : rec.end_t != null ? rec.end_t : null

const media = Array.isArray(manifest.media) ? manifest.media : []
// the reference timeline (tape) begins at the recording's start_t; media
// offsets are relative to it, so session-time windows convert with (t - anchor)
const anchor = rec.start_t != null ? rec.start_t : 0
// never auto-pick one of this pipeline's own outputs as the master source
const isRenderOutput = (name) => /^render_(viz|master|dvd)_/i.test(name)

// resolve source
let source = flag('source', 'auto')
let sourceClip = null
if (source === 'auto') {
  const firstVideo = media.find((m) => m.kind === 'video' && !isRenderOutput(m.file) && fs.existsSync(path.join(sDir, m.file)))
  if (firstVideo) {
    source = 'file'
    sourceClip = firstVideo
  } else {
    source = 'viz'
  }
} else if (source !== 'viz') {
  // explicit filename
  sourceClip = media.find((m) => m.file === source) || { file: source, offset: 0, kind: 'video' }
  if (!fs.existsSync(path.join(sDir, sourceClip.file))) {
    console.error('Source clip not found:', sourceClip.file)
    process.exit(1)
  }
  source = 'file'
}

const outName = flag('out', null) || 'render_master_' + Date.now() + '.mp4'
const outPath = path.join(sDir, outName)

console.log('\ndspm-archive render-master')
console.log('==========================')
console.log('Session :', sessionId)
console.log('Source  :', source === 'viz' ? 'automation viz' : sourceClip.file)
console.log('Res     :', W + 'x' + H)

function recordRender(extra) {
  manifest.renders = Array.isArray(manifest.renders) ? manifest.renders : []
  manifest.renders = manifest.renders.filter((r) => r.file !== outName)
  manifest.renders.push(
    Object.assign({ file: outName, kind: 'master', w: W, h: H, created: new Date().toISOString() }, extra)
  )
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
}

// ---- viz path: delegate to render-viz at 16:9 ------------------------------
if (source === 'viz') {
  const vArgs = [path.join(__dirname, 'render-viz.js'), sessionId, '--w', String(W), '--h', String(H), '--out', outName]
  if (flag('start', null) != null) vArgs.push('--start', flag('start'))
  if (flag('end', null) != null) vArgs.push('--end', flag('end'))
  console.log('Delegating to render-viz (viz master)...\n')
  const child = spawn(process.execPath, vArgs, { stdio: 'inherit' })
  child.on('close', (code) => {
    if (code !== 0) process.exit(code)
    // render-viz already recorded a "social" entry; re-tag as master
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const r = (m.renders || []).find((x) => x.file === outName)
    if (r) r.kind = 'master'
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2))
    console.log('\n✓ Master ready (viz):', outName)
  })
} else {
  // ---- file path: trim + scale/pad the video, mux the audio bed ------------
  if (end == null) {
    // need a duration; probe the clip if recording end is unknown
    end = (start || 0) + 600
  }
  const dur = Math.max(0.1, end - start)
  console.log('Window  :', start.toFixed(1) + 's → ' + end.toFixed(1) + 's  (' + dur.toFixed(1) + 's)')

  const off = sourceClip.offset || 0
  const vseek = (start - anchor) + off

  console.log('Building audio bed...')
  const bedRes = buildAudioBed(sDir, media, start, dur, anchor)
  const bed = bedRes && !bedRes.error ? bedRes : null
  // fall back to the clip's own audio if no bed and the clip has audio
  const clipHasAudio = hasAudioStream(path.join(sDir, sourceClip.file))
  console.log(bed ? '  ✓ mixed bed' : clipHasAudio ? '  using clip audio' : '  (silent)')

  const ffmpeg = getFfmpeg()
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
  const a = ['-y']
  // video input (input-seek for speed)
  if (vseek > 0) a.push('-ss', vseek.toFixed(3))
  a.push('-t', dur.toFixed(3), '-i', path.join(sDir, sourceClip.file))
  if (bed) a.push('-i', bed)
  a.push('-vf', vf, '-map', '0:v:0')
  if (bed) a.push('-map', '1:a:0')
  else if (clipHasAudio) a.push('-map', '0:a:0?')
  a.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p')
  // clamp to the window (video authoritative); -shortest would let a short
  // audio bed truncate the master
  a.push('-c:a', 'aac', '-b:a', '256k', '-t', dur.toFixed(3), outPath)

  console.log('Encoding master...')
  const child = spawn(ffmpeg, a, { stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  child.stderr.on('data', (d) => {
    err += d.toString()
    if (err.length > 4000) err = err.slice(-4000)
    const m = err.match(/time=(\d+):(\d+):(\d+\.\d+)/)
    if (m) {
      const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3])
      process.stdout.write('\r  ' + Math.min(100, Math.round((sec / dur) * 100)) + '%   ')
    }
  })
  child.on('close', (code) => {
    if (bed) {
      try {
        fs.unlinkSync(bed)
      } catch (e) {}
    }
    process.stdout.write('\n')
    if (code !== 0) {
      console.error('ffmpeg failed:\n' + err.slice(-600))
      process.exit(1)
    }
    recordRender({ start: parseFloat((start || 0).toFixed(3)), end: parseFloat(end.toFixed(3)), source: sourceClip.file })
    console.log('✓ Master ready:', outName, '(' + (fs.statSync(outPath).size / 1e6).toFixed(1) + ' MB)')
  })
}
