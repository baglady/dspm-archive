// upload.js — self-contained media upload modal
// Drop <script src="upload.js"></script> onto any page to add UPLOAD MEDIA.
// Requires the bridge to be reachable at the same origin or via ?bridge=.

(function () {
  // ---- resolve API base (mirrors app.js logic) ----------------------------
  const _p = new URLSearchParams(location.search)
  const _proto = location.protocol === 'https:' ? 'https://' : 'http://'
  const BRIDGE_PORT = '8081'

  function resolveApiBase() {
    const override = _p.get('bridge')
    if (override) {
      const url = /^wss?:\/\//.test(override) ? override : 'ws://' + override
      return url.replace(/^wss?:\/\//, _proto).replace(/\/$/, '')
    }
    if (location.pathname.includes('/proxy/')) {
      return location.origin +
        location.pathname.replace(/\/proxy\/\d+\/.*/, '/proxy/' + BRIDGE_PORT + '/')
    }
    return location.origin
  }

  const API = resolveApiBase()

  // Upload is a mutating /api call -> carries the bridge admin token when the
  // page was opened with ?token=<BRIDGE_ADMIN_TOKEN> (loopback needs none).
  const ADMIN_TOKEN = _p.get('token') || _p.get('admin') || ''

  // ---- inject styles -------------------------------------------------------
  const style = document.createElement('style')
  style.textContent = `
    .upload-overlay {
      display: none;
      position: fixed; inset: 0; z-index: 9000;
      background: rgba(0,0,0,0.82);
      align-items: center; justify-content: center;
    }
    .upload-overlay.open { display: flex; }

    .upload-modal {
      background: var(--panel, #141418);
      border: 1px solid var(--line, #2a2a30);
      border-radius: 8px;
      padding: 20px 20px 24px;
      width: min(480px, 94vw);
      max-height: 90vh;
      overflow-y: auto;
      display: flex; flex-direction: column; gap: 14px;
    }

    .upload-modal h2 {
      font-family: var(--font-mono, 'Courier New', monospace);
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--text, #e8e8ec);
      margin: 0;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--line, #2a2a30);
      display: flex; justify-content: space-between; align-items: center;
    }

    .upload-close {
      background: none; border: none; color: var(--text-dim, #8a8a92);
      font-size: 18px; cursor: pointer; padding: 0 0 0 12px; line-height: 1;
    }
    .upload-close:hover { color: var(--text, #e8e8ec); }

    .upload-label {
      font-family: var(--font-mono, 'Courier New', monospace);
      font-size: 10px; letter-spacing: 0.15em;
      text-transform: uppercase; color: var(--text-dim, #8a8a92);
      margin-bottom: 5px; display: block;
    }

    .upload-select {
      width: 100%;
      background: var(--bg, #0a0a0c);
      border: 1px solid var(--line, #2a2a30);
      color: var(--text, #e8e8ec);
      font-family: var(--font-mono, 'Courier New', monospace);
      font-size: 11px;
      padding: 7px 10px;
      border-radius: 4px;
      -webkit-appearance: none;
      appearance: none;
    }

    .upload-drop {
      border: 1px dashed var(--line, #2a2a30);
      border-radius: 6px;
      padding: 28px 16px;
      text-align: center;
      cursor: pointer;
      transition: border-color 100ms, background 100ms;
      font-family: var(--font-mono, 'Courier New', monospace);
      font-size: 10px;
      letter-spacing: 0.12em;
      color: var(--text-dim, #8a8a92);
      text-transform: uppercase;
    }
    .upload-drop.drag-over {
      border-color: var(--accent, #ff3b30);
      background: rgba(255,59,48,0.05);
      color: var(--accent, #ff3b30);
    }
    .upload-drop input { display: none; }

    .upload-file-list {
      display: flex; flex-direction: column; gap: 6px;
    }

    .upload-file-item {
      display: flex; align-items: center; gap: 10px;
      background: var(--bg, #0a0a0c);
      border: 1px solid var(--line, #2a2a30);
      border-radius: 4px; padding: 7px 10px;
      font-family: var(--font-mono, 'Courier New', monospace);
      font-size: 11px; color: var(--text, #e8e8ec);
    }

    .upload-file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .upload-file-size { color: var(--text-dim, #8a8a92); font-size: 10px; flex-shrink: 0; }
    .upload-file-remove {
      background: none; border: none; color: var(--text-dim, #8a8a92);
      cursor: pointer; font-size: 14px; padding: 0; flex-shrink: 0; line-height: 1;
    }
    .upload-file-remove:hover { color: var(--accent, #ff3b30); }

    .upload-progress-wrap {
      display: none; flex-direction: column; gap: 6px;
    }
    .upload-progress-wrap.visible { display: flex; }

    .upload-progress-label {
      font-family: var(--font-mono, 'Courier New', monospace); font-size: 10px;
      letter-spacing: 0.1em; color: var(--text-dim, #8a8a92); text-transform: uppercase;
    }

    .upload-progress-bar {
      height: 4px; background: var(--line, #2a2a30); border-radius: 2px; overflow: hidden;
    }
    .upload-progress-fill {
      height: 100%; background: var(--accent, #ff3b30); border-radius: 2px;
      width: 0%; transition: width 80ms;
    }

    .upload-submit {
      background: var(--accent-dim, #5a1512); border: 1px solid var(--accent, #ff3b30);
      color: var(--text, #e8e8ec);
      font-family: var(--font-mono, 'Courier New', monospace);
      font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
      padding: 10px; border-radius: 5px; cursor: pointer;
      transition: background 80ms;
    }
    .upload-submit:hover:not(:disabled) { background: #7a2018; }
    .upload-submit:disabled { opacity: 0.4; cursor: default; }

    .upload-msg {
      font-family: var(--font-mono, 'Courier New', monospace); font-size: 10px;
      letter-spacing: 0.08em; text-align: center; min-height: 14px;
      color: var(--text-dim, #8a8a92);
    }
    .upload-msg.ok  { color: var(--green, #3ddc84); }
    .upload-msg.err { color: var(--accent, #ff3b30); }
  `
  document.head.appendChild(style)

  // ---- inject modal HTML --------------------------------------------------
  const overlay = document.createElement('div')
  overlay.className = 'upload-overlay'
  overlay.id = 'upload-overlay'
  overlay.innerHTML = `
    <div class="upload-modal">
      <h2>Upload Media <button class="upload-close" id="upload-close">&times;</button></h2>

      <div>
        <label class="upload-label">Session</label>
        <select class="upload-select" id="upload-session"></select>
      </div>

      <div>
        <label class="upload-label">Files (video, audio, field recordings)</label>
        <div class="upload-drop" id="upload-drop">
          <input type="file" id="upload-input" multiple
            accept="video/mp4,video/quicktime,video/webm,audio/wav,audio/mpeg,audio/ogg,.mp4,.mov,.webm,.wav,.mp3,.ogg">
          drag &amp; drop here or <span style="color:#ff3b30;cursor:pointer" id="upload-browse">browse files</span>
        </div>
        <div class="upload-file-list" id="upload-file-list"></div>
      </div>

      <div class="upload-progress-wrap" id="upload-progress-wrap">
        <div class="upload-progress-label" id="upload-progress-label">uploading...</div>
        <div class="upload-progress-bar"><div class="upload-progress-fill" id="upload-progress-fill"></div></div>
      </div>

      <button class="upload-submit" id="upload-submit" disabled>Upload</button>
      <div class="upload-msg" id="upload-msg"></div>
    </div>
  `
  document.body.appendChild(overlay)

  // ---- wire close ---------------------------------------------------------
  const closeBtn = document.getElementById('upload-close')
  closeBtn.addEventListener('click', close)
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })

  function close() { overlay.classList.remove('open') }
  function open(preselectId)  {
    overlay.classList.add('open')
    loadSessions(preselectId)
    clearFiles()
    setMsg('', '')
  }

  // ---- session selector ---------------------------------------------------
  const sessionSelect = document.getElementById('upload-session')

  async function loadSessions(preselectId) {
    sessionSelect.innerHTML = '<option>loading...</option>'
    try {
      const r = await fetch(API + '/api/sessions')
      const sessions = await r.json()
      sessionSelect.innerHTML = sessions.map(s => {
        const d = s.t0 ? new Date(s.t0 * 1000).toLocaleString([], {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : s.id
        const dur = s.duration ? ' — ' + fmtTime(s.duration) : ''
        // lead with the recording name (like the archive list); fall back to
        // the date when a session was never named.
        const label = s.title ? `${s.title} · ${d}${dur}` : `${d}${dur}`
        const sel = preselectId && s.id === preselectId ? ' selected' : ''
        return `<option value="${s.id}"${sel}>${escapeHtml(label)}</option>`
      }).join('')
      if (preselectId) sessionSelect.value = preselectId
    } catch (e) {
      sessionSelect.innerHTML = '<option value="">could not load sessions</option>'
    }
  }

  // ---- file picker --------------------------------------------------------
  const dropZone  = document.getElementById('upload-drop')
  const fileInput = document.getElementById('upload-input')
  const browseBtn = document.getElementById('upload-browse')
  const fileList  = document.getElementById('upload-file-list')
  const submitBtn = document.getElementById('upload-submit')

  let pendingFiles = []

  browseBtn.addEventListener('click', () => fileInput.click())
  dropZone.addEventListener('click', e => { if (e.target !== browseBtn) fileInput.click() })

  fileInput.addEventListener('change', () => addFiles(Array.from(fileInput.files)))

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over') })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone.addEventListener('drop', e => {
    e.preventDefault()
    dropZone.classList.remove('drag-over')
    addFiles(Array.from(e.dataTransfer.files))
  })

  function addFiles(files) {
    for (const f of files) {
      if (!pendingFiles.find(p => p.name === f.name)) pendingFiles.push(f)
    }
    renderFileList()
    submitBtn.disabled = pendingFiles.length === 0
    setMsg('', '')
  }

  function renderFileList() {
    fileList.innerHTML = pendingFiles.map((f, i) => `
      <div class="upload-file-item">
        <span class="upload-file-name">${f.name}</span>
        <span class="upload-file-size">${fmtSize(f.size)}</span>
        <button class="upload-file-remove" data-i="${i}">&times;</button>
      </div>
    `).join('')
    fileList.querySelectorAll('.upload-file-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingFiles.splice(parseInt(btn.dataset.i), 1)
        renderFileList()
        submitBtn.disabled = pendingFiles.length === 0
      })
    })
  }

  function clearFiles() {
    pendingFiles = []
    fileList.innerHTML = ''
    fileInput.value = ''
    submitBtn.disabled = true
    document.getElementById('upload-progress-wrap').classList.remove('visible')
    document.getElementById('upload-progress-fill').style.width = '0%'
  }

  // ---- upload -------------------------------------------------------------
  submitBtn.addEventListener('click', async () => {
    const sessionId = sessionSelect.value
    if (!sessionId || !pendingFiles.length) return

    submitBtn.disabled = true
    setMsg('', '')
    const progressWrap = document.getElementById('upload-progress-wrap')
    const progressFill = document.getElementById('upload-progress-fill')
    const progressLabel = document.getElementById('upload-progress-label')
    progressWrap.classList.add('visible')

    let done = 0
    const total = pendingFiles.length
    let allOk = true

    for (const file of pendingFiles) {
      progressLabel.textContent = `uploading ${file.name} (${done + 1}/${total})`
      try {
        await uploadFile(sessionId, file, pct => {
          const overall = ((done + pct / 100) / total) * 100
          progressFill.style.width = overall.toFixed(1) + '%'
        })
        done++
      } catch (e) {
        setMsg('error uploading ' + file.name, 'err')
        allOk = false
        break
      }
    }

    progressFill.style.width = '100%'

    if (allOk) {
      setMsg(`✓ ${total} file${total > 1 ? 's' : ''} uploaded to session`, 'ok')
      clearFiles()
    }
    submitBtn.disabled = false
  })

  function uploadFile(sessionId, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', API + '/api/sessions/' + encodeURIComponent(sessionId) +
        '/upload/' + encodeURIComponent(file.name))
      if (ADMIN_TOKEN) xhr.setRequestHeader('x-admin-token', ADMIN_TOKEN)
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) onProgress((e.loaded / e.total) * 100)
      })
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error('HTTP ' + xhr.status))
      })
      xhr.addEventListener('error', () => reject(new Error('network error')))
      xhr.send(file)
    })
  }

  // ---- utils --------------------------------------------------------------
  function setMsg(text, type) {
    const el = document.getElementById('upload-msg')
    el.textContent = text
    el.className = 'upload-msg' + (type ? ' ' + type : '')
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + 'B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'KB'
    return (bytes / 1024 / 1024).toFixed(1) + 'MB'
  }

  function fmtTime(s) {
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
  }

  // session titles are user-entered recording names -> escape before injecting
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ))
  }

  // ---- expose open(optionalSessionId) for nav button + rec stop ----------
  window.openUploadModal = open
})()
