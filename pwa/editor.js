// ============================================================
// editor.js  --  multi-clip sync + export editor
//
// Extends the archive viewer into a lightweight non-linear editor. Reads the
// session manifest's media[] (clip offsets, written by sync-media.js) and
// edit{} block (social cut, chapters), lets the user nudge offsets and mark
// cut/chapter points, then drives the bridge render endpoints (social viz,
// 1080p master, DVD). Progress arrives over the same WebSocket as playback.
//
// Relies on globals from archive.js: API_BASE, duration, pbT, formatTime.
// ============================================================

let edManifest = null
let edId = null
const edJobs = {} // jobId -> job

// ---- DOM -------------------------------------------------------------------
const edRoot = document.getElementById('editor')
const edTracks = document.getElementById('ed-tracks')
const edTracksNote = document.getElementById('ed-tracks-note')
const edChapters = document.getElementById('ed-chapters')
const edJobsEl = document.getElementById('ed-jobs')
const edRendersEl = document.getElementById('ed-renders')
const edSocialIn = document.getElementById('ed-social-in')
const edSocialOut = document.getElementById('ed-social-out')

function api(id, p) {
  return API_BASE + '/api/sessions/' + encodeURIComponent(id) + p
}

// ---- entry point (called from archive.js openSession) ----------------------
function editorOnSession(id, manifest) {
  edId = id
  edManifest = manifest
  if (!edManifest.edit) edManifest.edit = { social: null, chapters: [], master: { aspect: '16:9', res: '1080p' } }
  if (!Array.isArray(edManifest.media)) edManifest.media = []
  edRoot.classList.add('ready')
  renderTracks()
  renderSocial()
  renderChapters()
  refreshRenders()
}

// ---- media tracks ----------------------------------------------------------
function renderTracks() {
  edTracks.innerHTML = ''
  const media = edManifest.media
  if (!media.length) {
    edTracksNote.textContent = 'No media in this session. Drop clips into the session folder (or use Upload media), then Auto-sync.'
    return
  }
  edTracksNote.textContent = media.length + ' clip(s). Offsets align each clip to the performance; edit a number to nudge a clip by hand.'
  const dur = duration || 1

  media.forEach((m, i) => {
    const row = document.createElement('div')
    row.className = 'ed-track'

    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = m.file
    name.title = m.file

    const badge = document.createElement('div')
    const state = m.sync || 'auto'
    badge.className = 'badge ' + state
    badge.textContent = state === 'master'
      ? 'master'
      : state + (typeof m.confidence === 'number' && state !== 'master' ? ' ' + Math.round(m.confidence * 100) + '%' : '')

    // lane: visualize where this clip's content sits on the session timeline.
    // offset = where session t0 falls inside the clip, so the clip's content
    // begins at sessionTime = -offset.
    const lane = document.createElement('div')
    lane.className = 'ed-lane'
    const bar = document.createElement('div')
    bar.className = 'clipbar'
    const startS = Math.max(0, -(m.offset || 0))
    const leftPct = Math.max(0, Math.min(98, (startS / dur) * 100))
    bar.style.left = leftPct + '%'
    bar.style.right = '1%'
    if (state === 'master') bar.style.background = '#3a3a66aa'
    lane.appendChild(bar)

    const off = document.createElement('input')
    off.type = 'number'
    off.step = '0.05'
    off.value = (m.offset || 0).toFixed(2)
    off.disabled = state === 'master'
    off.title = 'offset (s): clipTime = sessionTime + offset'
    off.addEventListener('change', () => {
      m.offset = parseFloat(off.value) || 0
      if (m.sync !== 'master') m.sync = 'manual'
      renderTracks()
      saveEdit()
    })

    row.append(name, badge, lane, off)
    edTracks.appendChild(row)
  })
}

// ---- social cut ------------------------------------------------------------
function renderSocial() {
  const s = edManifest.edit.social
  edSocialIn.value = s && s.start != null ? s.start : ''
  edSocialOut.value = s && s.end != null ? s.end : ''
}
function readSocial() {
  const a = parseFloat(edSocialIn.value)
  const b = parseFloat(edSocialOut.value)
  if (isFinite(a) && isFinite(b) && b > a) edManifest.edit.social = { start: a, end: b, aspect: '9:16' }
  else edManifest.edit.social = null
}

// ---- chapters --------------------------------------------------------------
function renderChapters() {
  edChapters.innerHTML = ''
  const chs = edManifest.edit.chapters || []
  if (!chs.length) {
    edChapters.innerHTML = '<span class="ed-note">No chapters. Add one at the playhead to create DVD chapter stops.</span>'
    return
  }
  chs.sort((a, b) => a.t - b.t)
  chs.forEach((c, i) => {
    const chip = document.createElement('span')
    chip.className = 'ed-chip'
    chip.innerHTML = '<b>' + formatTime(c.t) + '</b> ' + (c.name || 'Ch' + (i + 1)) + ' <span class="x">✕</span>'
    chip.querySelector('.x').addEventListener('click', () => {
      edManifest.edit.chapters.splice(i, 1)
      renderChapters()
      saveEdit()
    })
    edChapters.appendChild(chip)
  })
}

// ---- persistence -----------------------------------------------------------
let saveTimer = null
function saveEdit() {
  readSocial()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    fetch(api(edId, '/edit'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edit: edManifest.edit, media: edManifest.media }),
    }).catch(() => {})
  }, 300)
}

// ---- renders ---------------------------------------------------------------
async function refreshRenders() {
  let list = []
  try {
    const r = await fetch(api(edId, '/renders'))
    list = await r.json()
  } catch (e) {}
  edRendersEl.innerHTML = ''
  if (!list.length) {
    edRendersEl.innerHTML = '<span class="ed-note">No renders yet.</span>'
    return
  }
  list.slice().reverse().forEach((r) => {
    const row = document.createElement('div')
    row.className = 'ed-job ed-render'
    const url = api(edId, '/media/' + encodeURIComponent(r.file))
    const size = r.size ? ' · ' + (r.size / 1e6).toFixed(1) + ' MB' : ''
    row.innerHTML =
      '<span class="badge auto" style="background:#1c2a3a;color:#8ab">' + r.kind + '</span>' +
      '<a href="' + url + '" download>' + r.file + '</a>' +
      '<span class="ed-note">' + (r.w ? r.w + '×' + r.h : '') + size + '</span>'
    edRendersEl.appendChild(row)
  })
}

// ---- jobs (progress over WS) -----------------------------------------------
function onRenderJob(job) {
  if (!job || job.sessionId !== edId) {
    if (job) edJobs[job.id] = job // keep, but only render ours
  }
  edJobs[job.id] = job
  renderJobs()
  if (job.status === 'done') {
    refreshRenders()
    if (job.kind === 'sync') reloadManifest()
  }
}
function renderJobs() {
  edJobsEl.innerHTML = ''
  const ours = Object.values(edJobs).filter((j) => j.sessionId === edId && j.status === 'running')
  if (!ours.length) return
  ours.forEach((j) => {
    const row = document.createElement('div')
    row.className = 'ed-job' + (j.status === 'error' ? ' err' : '')
    row.innerHTML =
      '<span>' + j.kind + '</span>' +
      '<span class="ed-prog"><i style="width:' + Math.round((j.progress || 0) * 100) + '%"></i></span>' +
      '<span>' + Math.round((j.progress || 0) * 100) + '%</span>'
    edJobsEl.appendChild(row)
  })
}

async function reloadManifest() {
  try {
    const r = await fetch(api(edId, ''))
    const m = await r.json()
    edManifest = m
    if (!edManifest.edit) edManifest.edit = { social: null, chapters: [], master: {} }
    if (!Array.isArray(edManifest.media)) edManifest.media = []
    renderTracks()
  } catch (e) {}
}

async function startRender(kind, opts) {
  try {
    const r = await fetch(api(edId, '/render/' + kind), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts || {}),
    })
    const job = await r.json()
    if (job && job.id) {
      edJobs[job.id] = job
      renderJobs()
    } else if (job && job.error) {
      alert(kind + ': ' + job.error)
    }
  } catch (e) {
    alert('render failed to start: ' + e.message)
  }
}

// ---- wire buttons ----------------------------------------------------------
document.getElementById('ed-autosync').addEventListener('click', async () => {
  try {
    const r = await fetch(api(edId, '/sync'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const job = await r.json()
    if (job && job.id) {
      edJobs[job.id] = job
      renderJobs()
    }
  } catch (e) {}
})
document.getElementById('ed-social-in-here').addEventListener('click', () => {
  edSocialIn.value = (pbT || 0).toFixed(1)
  saveEdit()
})
document.getElementById('ed-social-out-here').addEventListener('click', () => {
  edSocialOut.value = (pbT || 0).toFixed(1)
  saveEdit()
})
edSocialIn.addEventListener('change', saveEdit)
edSocialOut.addEventListener('change', saveEdit)

document.getElementById('ed-chapter-add').addEventListener('click', () => {
  const t = pbT || 0
  const name = prompt('Chapter name', 'Chapter ' + ((edManifest.edit.chapters || []).length + 1))
  if (name == null) return
  edManifest.edit.chapters = edManifest.edit.chapters || []
  edManifest.edit.chapters.push({ t: parseFloat(t.toFixed(2)), name })
  renderChapters()
  saveEdit()
})

document.getElementById('ed-render-social').addEventListener('click', () => {
  readSocial()
  const s = edManifest.edit.social
  const opts = s ? { start: s.start, end: s.end } : {}
  startRender('social', opts)
})
document.getElementById('ed-render-master').addEventListener('click', () => startRender('master', { res: '1080p', source: 'auto' }))
document.getElementById('ed-render-dvd').addEventListener('click', () => startRender('dvd', { format: 'ntsc' }))
