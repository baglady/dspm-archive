// server.js
//
// Performer-facing backend for labeling session bundles after a show.
//
//   - lists session directories under SESSIONS_DIR (each has a bridge-written
//     manifest.json)
//   - serves a form UI (public/index.html) to fill in performance-metadata.json
//   - validates submitted metadata against schema/performance-metadata.schema.json
//     (ajv + ajv-formats) before writing it into the bundle
//   - accepts supplementary media uploads (audio stems, video, line-level,
//     field recording, stills) into the bundle's media/ directory and records
//     them in manifest.json
//
// Runs alongside Ghost on the same host (or anywhere with access to the
// sessions directory). Nothing here talks to norns or the bridge directly --
// it operates on completed bundles on disk.

const fs = require('fs')
const path = require('path')
const express = require('express')
const multer = require('multer')
const Ajv = require('ajv/dist/2020')
const addFormats = require('ajv-formats')

const PORT = parseInt(process.env.PORT || '4000', 10)
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, '..', 'sessions')
const SCHEMA_DIR = process.env.SCHEMA_DIR || path.join(__dirname, '..', 'schema')

const metadataSchema = JSON.parse(
  fs.readFileSync(path.join(SCHEMA_DIR, 'performance-metadata.schema.json'), 'utf8')
)
const ajv = new Ajv({ allErrors: true })
addFormats(ajv)
const validateMetadata = ajv.compile(metadataSchema)

const app = express()
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

function listSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return []
  return fs
    .readdirSync(SESSIONS_DIR)
    .filter((d) => {
      const full = path.join(SESSIONS_DIR, d)
      return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'manifest.json'))
    })
    .sort()
    .reverse()
}

// GET /api/sessions -> [{ id, title, date, hasMetadata }]
app.get('/api/sessions', (req, res) => {
  const sessions = listSessions().map((id) => {
    const metaPath = path.join(SESSIONS_DIR, id, 'performance-metadata.json')
    let title = null
    let date = null
    const hasMetadata = fs.existsSync(metaPath)
    if (hasMetadata) {
      try {
        const m = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
        title = m.title
        date = m.date
      } catch (e) {
        /* ignore */
      }
    }
    return { id, title, date, hasMetadata }
  })
  res.json(sessions)
})

// GET /api/sessions/:id -> { manifest, metadata }
app.get('/api/sessions/:id', (req, res) => {
  const dir = path.join(SESSIONS_DIR, req.params.id)
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'no such session' })
  const out = {}
  try {
    out.manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  } catch (e) {
    out.manifest = null
  }
  const metaPath = path.join(dir, 'performance-metadata.json')
  if (fs.existsSync(metaPath)) {
    try {
      out.metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    } catch (e) {
      out.metadata = null
    }
  } else {
    out.metadata = null
  }
  res.json(out)
})

// POST /api/sessions/:id/metadata -> validate + write performance-metadata.json
app.post('/api/sessions/:id/metadata', (req, res) => {
  const dir = path.join(SESSIONS_DIR, req.params.id)
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'no such session' })

  const metadata = req.body || {}
  if (!metadata.schema_version) metadata.schema_version = '1.0'

  if (!validateMetadata(metadata)) {
    return res.status(400).json({ error: 'validation failed', details: validateMetadata.errors })
  }

  fs.writeFileSync(path.join(dir, 'performance-metadata.json'), JSON.stringify(metadata, null, 2))
  res.json({ ok: true })
})

// POST /api/sessions/:id/media -> upload supplementary media into media/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const mediaDir = path.join(SESSIONS_DIR, req.params.id, 'media')
    fs.mkdirSync(mediaDir, { recursive: true })
    cb(null, mediaDir)
  },
  filename: (req, file, cb) => cb(null, file.originalname),
})
const upload = multer({ storage })

app.post('/api/sessions/:id/media', upload.array('files'), (req, res) => {
  const dir = path.join(SESSIONS_DIR, req.params.id)
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'no such session' })

  // record uploaded files in the manifest's media array
  const manifestPath = path.join(dir, 'manifest.json')
  let manifest = {}
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (e) {
    /* leave as {} */
  }
  const existing = new Set(manifest.media || [])
  for (const f of req.files || []) {
    existing.add(path.join('media', f.originalname))
  }
  manifest.media = [...existing].sort()
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  res.json({ ok: true, media: manifest.media })
})

app.listen(PORT, () => console.log(`DSPM archive backend listening on :${PORT} (sessions: ${SESSIONS_DIR})`))
