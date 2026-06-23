'use strict'

// ============================================================
// lib/args.js  --  tiny argv parser matching the repo's plain-Node style
// (cf. bridge/render-master.js). No framework.
// ============================================================

// Parse argv into { _: [positionals], flags: { name: value|true } }.
// `--name value` takes the next token; `--flag` with no value is boolean true.
// `booleanFlags` lists names that never consume a following token.
function parseArgs(argv, booleanFlags = []) {
  const boolean = new Set(booleanFlags)
  const out = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const name = a.slice(2)
      if (boolean.has(name)) {
        out.flags[name] = true
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        out.flags[name] = argv[++i]
      } else {
        out.flags[name] = true
      }
    } else {
      out._.push(a)
    }
  }
  return out
}

module.exports = { parseArgs }
