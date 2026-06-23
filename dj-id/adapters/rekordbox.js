'use strict'

// ============================================================
// adapters/rekordbox.js  --  Pioneer Rekordbox USB-export adapter
//
// A Rekordbox export USB has:
//   PIONEER/rekordbox/export.pdb       (DeviceSQL DB: tracks, BPM, key, ...)
//   PIONEER/USBANLZ/**/ANLZ*.DAT/.EXT  (waveforms, beatgrid, memory cues)
//
// The format is reverse-engineered (deepsymmetry.org, rekordcrate). Full
// extraction is wired up in a later step; for now we DETECT the export so
// `doctor` can report it. Loose-file tags still cover these tracks until then.
// ============================================================

const fs = require('fs')
const path = require('path')

const name = 'rekordbox'

function pdbPath(root) {
  return path.join(root, 'PIONEER', 'rekordbox', 'export.pdb')
}

function detect(root) {
  try {
    return fs.existsSync(pdbPath(root))
  } catch (e) {
    return false
  }
}

// TODO(step 5): parse export.pdb (or shell out to `rekordcrate dump`) + the
// USBANLZ analysis files; emit Map(absPath -> { artist, title, bpm, key,
// cues:[{name,sec}], beatgridFirstBeatSec, source:'rekordbox' }).
function collect(root) {
  return new Map()
}

module.exports = { name, detect, collect, pdbPath }
