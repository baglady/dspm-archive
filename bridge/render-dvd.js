#!/usr/bin/env node
'use strict'

// ============================================================
// render-dvd.js  --  DVD-Video authoring (MPEG-2 -> VIDEO_TS -> ISO)
//
// Takes a release master (or renders one), transcodes it to a DVD-compliant
// MPEG-2 program stream with ffmpeg, then -- if the external authoring tools
// are installed -- builds a VIDEO_TS structure with chapters and a burnable
// ISO. When dvdauthor / an ISO tool is missing it stops after the MPEG-2 step
// and prints install instructions, so the pipeline degrades gracefully.
//
// Usage:
//   node render-dvd.js <session-id> [--master file] [--format ntsc|pal] [--out name.iso]
//
// External tools (optional, for the ISO step):
//   dvdauthor                         http://dvdauthor.sourceforge.net
//   genisoimage | mkisofs | xorriso   (any one)
// ============================================================

const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { getFfmpeg } = require('./audio-sync')

const args = process.argv.slice(2)
const sessionId = args.find((a) => !a.startsWith('--'))
const flag = (n, d) => {
  const i = args.indexOf('--' + n)
  return i >= 0 ? args[i + 1] : d
}
if (!sessionId) {
  console.error('Usage: node render-dvd.js <session-id> [--master file] [--format ntsc|pal] [--out name.iso]')
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
const format = flag('format', 'ntsc') === 'pal' ? 'pal' : 'ntsc'

// ---- tool detection --------------------------------------------------------
function which(cmd) {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  const r = spawnSync(probe, [cmd], { stdio: ['ignore', 'pipe', 'ignore'] })
  if (r.status === 0 && r.stdout) {
    const first = r.stdout.toString().split(/\r?\n/).find(Boolean)
    return first || null
  }
  return null
}
const dvdauthor = which('dvdauthor')
const isoTool = ['genisoimage', 'mkisofs', 'xorriso'].map((t) => [t, which(t)]).find(([, p]) => p)

console.log('\ndspm-archive render-dvd')
console.log('=======================')
console.log('Session :', sessionId)
console.log('Format  :', format.toUpperCase() + '-DVD')
console.log('dvdauthor:', dvdauthor || '(not found)')
console.log('iso tool :', isoTool ? isoTool[0] : '(not found)')
console.log()

// ---- locate / build the master --------------------------------------------
function findMaster() {
  const explicit = flag('master', null)
  if (explicit) {
    if (fs.existsSync(path.join(sDir, explicit))) return explicit
    console.error('Master not found:', explicit)
    process.exit(1)
  }
  const renders = (manifest.renders || []).filter((r) => r.kind === 'master')
  if (renders.length) return renders[renders.length - 1].file
  return null
}

let master = findMaster()

function runFfmpegToMpeg(masterFile, cb) {
  const ffmpeg = getFfmpeg()
  const mpg = 'dvd_' + format + '.mpg'
  const mpgPath = path.join(sDir, mpg)
  // -target sets the full DVD-compliant profile (res, fps, bitrate, AC?-> mp2)
  const a = [
    '-y', '-i', path.join(sDir, masterFile),
    '-target', format + '-dvd', '-aspect', '16:9',
    '-q:a', '0', mpgPath,
  ]
  console.log('Transcoding to DVD MPEG-2 (' + mpg + ')...')
  const child = spawn(ffmpeg, a, { stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  child.stderr.on('data', (d) => {
    err += d.toString()
    if (err.length > 4000) err = err.slice(-4000)
    const m = err.match(/time=(\d+):(\d+):(\d+\.\d+)/)
    if (m) process.stdout.write('\r  ' + m[0])
  })
  child.on('close', (code) => {
    process.stdout.write('\n')
    if (code !== 0) {
      console.error('MPEG-2 transcode failed:\n' + err.slice(-600))
      process.exit(1)
    }
    cb(mpg, mpgPath)
  })
}

function recordRender(file, kind, extra) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  m.renders = Array.isArray(m.renders) ? m.renders : []
  m.renders = m.renders.filter((r) => r.file !== file)
  m.renders.push(Object.assign({ file, kind, created: new Date().toISOString() }, extra || {}))
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2))
}

// chapter offsets (HH:MM:SS.mmm relative to the master start) for dvdauthor
function chapterString() {
  const chapters = (manifest.edit && manifest.edit.chapters) || []
  const masterRender = (manifest.renders || []).filter((r) => r.kind === 'master').slice(-1)[0]
  const base = masterRender && masterRender.start != null ? masterRender.start : (manifest.recording || {}).start_t || 0
  const offs = ['0']
  for (const c of chapters) {
    const o = (c.t || 0) - base
    if (o > 0) {
      const hh = String(Math.floor(o / 3600)).padStart(2, '0')
      const mm = String(Math.floor((o % 3600) / 60)).padStart(2, '0')
      const ss = (o % 60).toFixed(3).padStart(6, '0')
      offs.push(hh + ':' + mm + ':' + ss)
    }
  }
  return offs.join(',')
}

function authorAndIso(mpg, mpgPath) {
  if (!dvdauthor) {
    console.log('\n⚠ dvdauthor not installed — stopped at the DVD MPEG-2 stream.')
    console.log('  Produced: ' + mpg + '  (DVD-compliant; author it with any DVD tool)')
    console.log('  To get a burnable ISO here, install:')
    console.log('    dvdauthor  +  one of: genisoimage / mkisofs / xorriso')
    recordRender(mpg, 'dvd-mpeg', { format })
    console.log('\n✓ Done (MPEG-2 only).')
    return
  }

  const videoTs = path.join(sDir, 'DVD_' + format)
  try {
    fs.rmSync(videoTs, { recursive: true, force: true })
  } catch (e) {}
  const xml =
    '<dvdauthor dest="' + videoTs.replace(/\\/g, '/') + '">\n' +
    '  <vmgm />\n' +
    '  <titleset><titles>\n' +
    '    <pgc>\n' +
    '      <vob file="' + mpgPath.replace(/\\/g, '/') + '" chapters="' + chapterString() + '" />\n' +
    '    </pgc>\n' +
    '  </titles></titleset>\n' +
    '</dvdauthor>\n'
  const xmlPath = path.join(sDir, 'dvd_' + format + '.xml')
  fs.writeFileSync(xmlPath, xml)

  console.log('Authoring VIDEO_TS with dvdauthor...')
  const da = spawnSync(dvdauthor, ['-x', xmlPath], { stdio: 'inherit', env: Object.assign({ VIDEO_FORMAT: format.toUpperCase() }, process.env) })
  if (da.status !== 0) {
    console.error('dvdauthor failed.')
    process.exit(1)
  }

  if (!isoTool) {
    console.log('\n⚠ No ISO tool (genisoimage/mkisofs/xorriso) — VIDEO_TS authored but not packed.')
    console.log('  VIDEO_TS dir: ' + path.basename(videoTs))
    recordRender(path.basename(videoTs), 'dvd-videots', { format })
    console.log('\n✓ Done (VIDEO_TS only).')
    return
  }

  const isoName = flag('out', null) || 'dvd_' + format + '.iso'
  const isoPath = path.join(sDir, isoName)
  const [toolName, toolPath] = isoTool
  const isoArgs =
    toolName === 'xorriso'
      ? ['-as', 'mkisofs', '-dvd-video', '-o', isoPath, videoTs]
      : ['-dvd-video', '-o', isoPath, videoTs]
  console.log('Packing ISO with ' + toolName + '...')
  const mk = spawnSync(toolPath, isoArgs, { stdio: 'inherit' })
  if (mk.status !== 0) {
    console.error('ISO packing failed.')
    process.exit(1)
  }
  recordRender(isoName, 'dvd-iso', { format, size: fs.statSync(isoPath).size })
  console.log('\n✓ DVD ISO ready:', isoName, '(' + (fs.statSync(isoPath).size / 1e6).toFixed(1) + ' MB)')
}

// ---- run -------------------------------------------------------------------
function proceed() {
  runFfmpegToMpeg(master, authorAndIso)
}

if (!master) {
  console.log('No master render found — building one first (render-master, auto source)...\n')
  const child = spawn(process.execPath, [path.join(__dirname, 'render-master.js'), sessionId], { stdio: 'inherit' })
  child.on('close', (code) => {
    if (code !== 0) process.exit(code)
    master = findMaster()
    if (!master) {
      console.error('Master render did not produce a file.')
      process.exit(1)
    }
    proceed()
  })
} else {
  console.log('Master  :', master)
  proceed()
}
