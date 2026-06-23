'use strict'

// ============================================================
// render-jobs.js  --  background render/sync job runner for the bridge
//
// Spawns the CLI renderers (render-viz.js, sync-media.js, and later the
// master/DVD authors) as child processes, tracks their progress, and exposes
// a small in-memory job registry the HTTP API surfaces. Progress is also
// pushed to phones/editors over the existing WebSocket broadcast.
// ============================================================

const path = require('path')
const { spawn } = require('child_process')

const jobs = new Map() // jobId -> job
let _broadcast = () => {}
let _seq = 0

function init(broadcast) {
  if (typeof broadcast === 'function') _broadcast = broadcast
}

function newId() {
  _seq++
  return 'job_' + Date.now().toString(36) + '_' + _seq
}

function publicJob(j) {
  return {
    id: j.id,
    sessionId: j.sessionId,
    kind: j.kind,
    status: j.status,
    progress: j.progress,
    file: j.file || null,
    error: j.error || null,
    startedAt: j.startedAt,
  }
}

function list() {
  return Array.from(jobs.values()).map(publicJob)
}
function get(id) {
  const j = jobs.get(id)
  return j ? publicJob(j) : null
}

// Generic spawn of a node script in this directory. `progressOf` maps a stdout
// chunk to a 0..1 progress value (or null). `fileOf` extracts the produced
// filename from the combined output on success.
function spawnJob({ sessionId, kind, script, args, progressOf, fileOf }) {
  const id = newId()
  const job = { id, sessionId, kind, status: 'running', progress: 0, startedAt: Date.now(), out: '' }
  jobs.set(id, job)
  _broadcast({ type: 'render_job', job: publicJob(job) })

  const child = spawn(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  function onChunk(d) {
    const s = d.toString()
    job.out += s
    if (job.out.length > 8000) job.out = job.out.slice(-8000)
    if (progressOf) {
      const p = progressOf(s)
      if (p != null && p !== job.progress) {
        job.progress = p
        _broadcast({ type: 'render_job', job: publicJob(job) })
      }
    }
  }
  child.stdout.on('data', onChunk)
  child.stderr.on('data', onChunk)

  child.on('close', (code) => {
    if (code === 0) {
      job.status = 'done'
      job.progress = 1
      if (fileOf) job.file = fileOf(job.out)
    } else {
      job.status = 'error'
      job.error = (job.out || '').slice(-600) || ('exit ' + code)
    }
    _broadcast({ type: 'render_job', job: publicJob(job) })
  })
  child.on('error', (err) => {
    job.status = 'error'
    job.error = err.message
    _broadcast({ type: 'render_job', job: publicJob(job) })
  })

  return publicJob(job)
}

// --- specific job kinds -----------------------------------------------------
const pctOf = (s) => {
  const m = s.match(/(\d+)%/)
  return m ? Math.min(1, parseInt(m[1], 10) / 100) : null
}
const renderedFileOf = (out) => {
  const m = out.match(/Rendered\s+(\S+)/)
  return m ? m[1] : null
}

function renderSocial(sessionId, opts = {}) {
  const args = [sessionId]
  if (opts.start != null) args.push('--start', String(opts.start))
  if (opts.end != null) args.push('--end', String(opts.end))
  if (opts.w) args.push('--w', String(opts.w))
  if (opts.h) args.push('--h', String(opts.h))
  if (opts.fps) args.push('--fps', String(opts.fps))
  if (opts.out) args.push('--out', String(opts.out))
  return spawnJob({
    sessionId, kind: 'social', script: 'render-viz.js', args,
    progressOf: pctOf, fileOf: renderedFileOf,
  })
}

function renderMaster(sessionId, opts = {}) {
  const args = [sessionId]
  if (opts.source) args.push('--source', String(opts.source))
  if (opts.res) args.push('--res', String(opts.res))
  if (opts.start != null) args.push('--start', String(opts.start))
  if (opts.end != null) args.push('--end', String(opts.end))
  if (opts.out) args.push('--out', String(opts.out))
  return spawnJob({
    sessionId, kind: 'master', script: 'render-master.js', args,
    progressOf: pctOf,
    fileOf: (out) => {
      const m = out.match(/Master ready[^:]*:\s*(\S+)/)
      return m ? m[1] : null
    },
  })
}

function renderDvd(sessionId, opts = {}) {
  const args = [sessionId]
  if (opts.master) args.push('--master', String(opts.master))
  if (opts.format) args.push('--format', String(opts.format))
  if (opts.out) args.push('--out', String(opts.out))
  return spawnJob({
    sessionId, kind: 'dvd', script: 'render-dvd.js', args,
    fileOf: (out) => {
      const m = out.match(/(?:ISO ready|Done)[^:]*:\s*(\S+)/)
      return m ? m[1] : null
    },
  })
}

function syncMedia(sessionId, opts = {}) {
  const args = [sessionId]
  if (opts.ref) args.push('--ref', String(opts.ref))
  if (opts.reset) args.push('--reset')
  return spawnJob({ sessionId, kind: 'sync', script: 'sync-media.js', args })
}

module.exports = { init, list, get, renderSocial, renderMaster, renderDvd, syncMedia }
