#!/usr/bin/env node
'use strict'

// ============================================================
// tape-pull.js  --  copy a norns tape WAV into its session folder
//
// The norns "rec meta" / bridge tape controls write the take to the norns SD
// card at NORNS_TAPE_DIR/<name>.wav -- it never touches the bridge machine.
// The session folder (manifest + jsonl logs) lives on the bridge. This module
// is the missing link: it scp's that one WAV into the right session folder and
// records it as manifest.tape_file -- the reference sync-media.js /
// sync-video.js align everything else against.
//
// Routing is automatic: at /api/recording/stop the bridge already knows the
// tape name AND the current sessionDir, so the file lands in the correct take
// without any flat-folder mirror to sort through.
//
// Requires passwordless SSH from the bridge to the norns:
//   ssh-copy-id we@<norns-ip>      (one time; default creds we / sleep)
// or drop the bridge's pubkey into we@norns:~/.ssh/authorized_keys.
//
// Used two ways:
//   - imported by bridge-server.js (auto-pull when recording stops)
//   - run directly to backfill an older session:
//       node tape-pull.js <session-id>            (name from manifest.recording)
//       node tape-pull.js <session-id> <name>     (explicit tape name)
//       node tape-pull.js <session-id> --host 10.42.0.1
// ============================================================

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, '..', 'sessions')
const NORNS_HOST = process.env.NORNS_HOST || '10.42.0.1'
const NORNS_SSH_USER = process.env.NORNS_SSH_USER || 'we'
const NORNS_TAPE_DIR = process.env.NORNS_TAPE_DIR || '/home/we/dust/audio/tape'
// When the norns runs in Docker with dust bind-mounted on the host (see
// deploy/norns-docker/), set NORNS_TAPE_LOCAL_DIR to the host path of the tape
// folder (e.g. /home/baglady/norns-desktop/dust/audio/tape). pullTape() will
// do a local fs.copyFile instead of scp -- no SSH needed.
const NORNS_TAPE_LOCAL_DIR = process.env.NORNS_TAPE_LOCAL_DIR || ''

function patchManifest(targetDir, wav) {
  try {
    const mp = path.join(targetDir, 'manifest.json')
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'))
    m.tape_file = wav
    fs.writeFileSync(mp, JSON.stringify(m, null, 2))
  } catch (e) { /* no manifest -- file still landed */ }
}

// Pull <name>.wav from the norns into targetDir, then set manifest.tape_file.
//
// Two modes:
//   local  - NORNS_TAPE_LOCAL_DIR set: dust is bind-mounted on the host, just
//            copy the file directly (Docker norns on the same machine).
//   remote - default: scp from the norns over SSH (physical norns on the LAN).
//
// norns flushes the tape file a moment after tape_record_stop(), so the first
// copy can race the close. We retry a few times before giving up; on final
// failure we log and call back with the error -- the take is still on the
// norns and recoverable by hand (or by re-running this script).
function pullTape(targetDir, name, opts, done) {
  if (typeof opts === 'function') { done = opts; opts = {} }
  opts = opts || {}
  done = done || (() => {})
  const wav = name.endsWith('.wav') ? name : `${name}.wav`
  const dest = path.join(targetDir, wav)
  const tries = opts.tries != null ? opts.tries : 4
  const delayMs = opts.delayMs != null ? opts.delayMs : 1500

  const localDir = opts.localTapeDir || NORNS_TAPE_LOCAL_DIR
  if (localDir) {
    // Local copy path: dust bind-mounted on the host (Docker norns)
    const src = path.join(localDir, wav)
    const attempt = (n) => {
      fs.copyFile(src, dest, (err) => {
        if (!err) {
          patchManifest(targetDir, wav)
          console.log(`[tape-pull] local ${wav} -> ${path.basename(targetDir)}`)
          return done(null, dest)
        }
        if (n < tries) return setTimeout(() => attempt(n + 1), delayMs)
        console.error(`[tape-pull] failed (${tries} tries): ${src} -- ${err.message}`)
        done(err)
      })
    }
    setTimeout(() => attempt(1), delayMs)
    return
  }

  // Remote SCP path: physical norns on the LAN
  const host = opts.host || NORNS_HOST
  const user = opts.user || NORNS_SSH_USER
  const tapeDir = opts.tapeDir || NORNS_TAPE_DIR
  const remote = `${user}@${host}:${tapeDir}/${wav}`
  const attempt = (n) => {
    // BatchMode=yes makes a missing key fail fast instead of hanging on a
    // password prompt; StrictHostKeyChecking=no avoids the first-connect TOFU
    // prompt for a device whose host key we don't pin.
    execFile('scp', ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes',
      remote, dest], (err) => {
      if (!err) {
        patchManifest(targetDir, wav)
        console.log(`[tape-pull] ${wav} -> ${path.basename(targetDir)}`)
        return done(null, dest)
      }
      if (n < tries) return setTimeout(() => attempt(n + 1), delayMs)
      console.error(`[tape-pull] failed (${tries} tries): ${remote} -- ${err.message}`)
      done(err)
    })
  }
  setTimeout(() => attempt(1), delayMs)
}

module.exports = { pullTape }

// ---- CLI: backfill a session recorded before auto-pull existed ------------
if (require.main === module) {
  const argv = process.argv.slice(2)
  const opts = {}
  const pos = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--host') opts.host = argv[++i]
    else if (argv[i] === '--user') opts.user = argv[++i]
    else if (argv[i] === '--tape-dir') opts.tapeDir = argv[++i]
    else if (argv[i] === '--local-tape-dir') opts.localTapeDir = argv[++i]
    else pos.push(argv[i])
  }
  const sessionId = pos[0]
  let name = pos[1]
  if (!sessionId) {
    console.error('usage: node tape-pull.js <session-id> [tape-name] [--host H] [--user U] [--local-tape-dir PATH]')
    process.exit(1)
  }
  const sDir = path.join(SESSIONS_DIR, sessionId)
  if (!fs.existsSync(sDir)) {
    console.error(`[tape-pull] no such session: ${sDir}`)
    process.exit(1)
  }
  if (!name) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(sDir, 'manifest.json'), 'utf8'))
      name = m.recording && m.recording.name
    } catch (e) {}
  }
  if (!name) {
    console.error('[tape-pull] no tape name in manifest.recording; pass it explicitly:')
    console.error(`  node tape-pull.js ${sessionId} <tape-name>`)
    process.exit(1)
  }
  // backfill: no flush race, so pull immediately and don't retry forever
  pullTape(sDir, name, Object.assign({ delayMs: 0, tries: 2 }, opts), (err) => {
    process.exit(err ? 1 : 0)
  })
}
