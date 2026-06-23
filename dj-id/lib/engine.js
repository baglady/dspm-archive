'use strict'

// ============================================================
// lib/engine.js  --  fingerprint engine selector
//
// All engines share the interface:
//   name
//   isAvailable()              -> { ok, reason }
//   store(refs, dbDir, onProg) -> { tracks }
//   query(mixWav, dbDir, opts) -> [ matchRecord ]
//
// Default engine is the zero-setup built-in. Panako is the robust upgrade for
// beatmatched/pitch-shifted sets; audfprint is a lighter fallback.
// ============================================================

const ENGINES = {
  builtin: () => require('../engine-builtin'),
  panako: () => require('../engine-panako'),
  audfprint: () => require('../engine-audfprint'),
}

const DEFAULT_ENGINE = 'builtin'

function getEngine(name) {
  const key = (name || DEFAULT_ENGINE).toLowerCase()
  const factory = ENGINES[key]
  if (!factory) {
    throw new Error(`unknown engine "${name}". Choose: ${Object.keys(ENGINES).join(', ')}`)
  }
  return factory()
}

module.exports = { getEngine, DEFAULT_ENGINE, ENGINES }
