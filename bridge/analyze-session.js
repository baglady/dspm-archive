// analyze-session.js -- read a captured session and report on it, so a load
// test (or a real show) can be verified after the fact.
//
//   node analyze-session.js ../sessions/session_2026-06-18T...
//
// Reports: duration, raw touch count + rate, aggregated tick count + rate (this
// is what norns actually received -- it should hold ~25Hz regardless of phone
// count), per-channel touch counts, and value ranges. A flat tick rate under a
// heavy loadtest is the proof that crowd scale never reaches norns' audio thread.

const fs = require('fs')
const path = require('path')

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node analyze-session.js <session-dir>')
  process.exit(1)
}

function readJsonl(file) {
  const p = path.join(dir, file)
  if (!fs.existsSync(p)) return []
  return fs.readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l) } catch (e) { return null } })
    .filter(Boolean)
}

const manifest = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) }
  catch (e) { return {} }
})()
const phone = readJsonl('phone_events.jsonl')
const ticks = readJsonl('bridge_ticks.jsonl').filter((t) => t.type === 'tick')
const events = readJsonl('bridge_ticks.jsonl').filter((t) => t.type === 'event')

const span = (rows) => {
  if (rows.length < 2) return rows.length ? 0 : 0
  return rows[rows.length - 1].t - rows[0].t
}

const touchSpan = span(phone)
const tickSpan = span(ticks)

// per-channel touch stats
const byChannel = {}
for (const e of phone) {
  const c = e.channel
  if (!byChannel[c]) byChannel[c] = { n: 0, min: Infinity, max: -Infinity }
  byChannel[c].n++
  byChannel[c].min = Math.min(byChannel[c].min, e.value)
  byChannel[c].max = Math.max(byChannel[c].max, e.value)
}

console.log(`session         : ${manifest.session_id || path.basename(dir)}`)
console.log(`duration        : ${(manifest.duration_sec ?? touchSpan).toFixed?.(1) ?? touchSpan}s`)
console.log('')
console.log(`raw touches     : ${phone.length}` +
  (touchSpan > 0 ? `  (${(phone.length / touchSpan).toFixed(0)}/s)` : ''))
console.log(`aggregated ticks: ${ticks.length}` +
  (tickSpan > 0 ? `  (${(ticks.length / tickSpan).toFixed(1)}/s  <- norns inbound rate)` : ''))
console.log(`transport events: ${events.length}`)
console.log('')

// tick-rate stability: bucket ticks into 1s windows, report min/max/jitter
if (ticks.length > 1) {
  const buckets = {}
  for (const t of ticks) buckets[Math.floor(t.t)] = (buckets[Math.floor(t.t)] || 0) + 1
  const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b)
  // drop the first and last buckets: they're partial seconds (touches starting
  // or stopping mid-second), which would otherwise read as false jitter. Only
  // full interior seconds reflect the real steady-state tick rate.
  const interiorKeys = keys.length >= 3 ? keys.slice(1, -1) : keys
  const counts = interiorKeys.map((k) => buckets[k])
  const min = Math.min(...counts)
  const max = Math.max(...counts)
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length
  console.log(`tick rate/s     : mean ${mean.toFixed(1)}, min ${min}, max ${max}` +
    ` (steady-state, edge seconds trimmed)  ${max - min <= 3 ? '[stable]' : '[JITTERY - investigate]'}`)
  console.log('')
}

console.log('per-channel touches (channel: count  value-range):')
const rows = Object.entries(byChannel).sort((a, b) => b[1].n - a[1].n)
for (const [c, s] of rows) {
  console.log(`  ${c.padEnd(28)} ${String(s.n).padStart(6)}   ${s.min.toFixed(2)}..${s.max.toFixed(2)}`)
}
if (rows.length === 0) console.log('  (none)')
