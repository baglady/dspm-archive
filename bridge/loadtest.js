// loadtest.js -- battle-test the bridge by simulating many phones at once.
//
// Each fake phone opens a websocket and sends randomized {channel, value}
// touches at a fixed per-client rate, across a random subset of channels, for
// a fixed duration. Use it to find the connection ceiling and confirm the key
// invariant of the design: norns' inbound rate stays flat (channels x tick
// rate) no matter how many phones pile on -- watch the bridge's own terminal
// (or analyze-session.js afterward) and the tick rate should not budge.
//
// Usage (from bridge/, with deps installed):
//   node loadtest.js [--url ws://localhost:8081] [--clients 50] [--rate 20]
//                    [--secs 20] [--channels 8] [--ramp 0]
//
//   --clients N   number of simultaneous fake phones        (default 50)
//   --rate N      messages/sec each phone sends             (default 20)
//   --secs N      how long to run                           (default 20)
//   --channels N  distinct channels each phone touches      (default 8)
//   --ramp N      stagger connections over N seconds        (default 0 = all at once)

const WebSocket = require('ws')

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}

const URL = arg('url', 'ws://localhost:8081')
const CLIENTS = parseInt(arg('clients', '50'), 10)
const RATE = parseFloat(arg('rate', '20'))
const SECS = parseFloat(arg('secs', '20'))
const NCH = parseInt(arg('channels', '8'), 10)
const RAMP = parseFloat(arg('ramp', '0'))

// channels the bridge actually accepts (a representative continuous subset)
const CHANNELS = []
for (let i = 1; i <= 6; i++) CHANNELS.push(`/barcode/v${i}/level`, `/barcode/v${i}/pan`)
CHANNELS.push('/param/filter_frequency', '/param/filter_reso', '/barcode/output_level')

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

let connected = 0
let failed = 0
let sent = 0
let errors = 0
let peakConnected = 0
const clients = []
const t0 = Date.now()

function spawn(c) {
  let ws
  try {
    ws = new WebSocket(URL)
  } catch (e) {
    failed++
    errors++
    return
  }
  clients.push(ws)
  const myChannels = Array.from({ length: Math.min(NCH, CHANNELS.length) }, () => pick(CHANNELS))
  let timer = null
  ws.on('open', () => {
    connected++
    peakConnected = Math.max(peakConnected, connected)
    timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify({ channel: pick(myChannels), value: Math.random() }))
        sent++
      } catch (e) {
        errors++
      }
    }, 1000 / RATE)
  })
  ws.on('error', () => { failed++; errors++ })
  ws.on('close', () => {
    connected = Math.max(0, connected - 1)
    if (timer) clearInterval(timer)
  })
}

console.log(`[loadtest] ${CLIENTS} clients -> ${URL}, ${RATE}/s each, ${SECS}s` +
  (RAMP ? `, ramping over ${RAMP}s` : ''))

for (let c = 0; c < CLIENTS; c++) {
  if (RAMP > 0) setTimeout(() => spawn(c), (RAMP * 1000 * c) / CLIENTS)
  else spawn(c)
}

// live progress
const progress = setInterval(() => {
  process.stdout.write(`\r[loadtest] t=${((Date.now() - t0) / 1000).toFixed(0)}s ` +
    `connected=${connected} sent=${sent} errors=${errors}   `)
}, 1000)

setTimeout(() => {
  clearInterval(progress)
  for (const ws of clients) { try { ws.close() } catch (e) {} }
  const secs = (Date.now() - t0) / 1000
  const expectedTickHz = 1000 / 40
  console.log('\n\n--- loadtest summary ---')
  console.log(`target          : ${URL}`)
  console.log(`clients         : ${CLIENTS} requested, peak ${peakConnected} connected, ${failed} connect errors`)
  console.log(`duration        : ${secs.toFixed(1)}s`)
  console.log(`messages sent   : ${sent}`)
  console.log(`send rate       : ${(sent / secs).toFixed(0)}/s aggregate` +
    `, ${(sent / secs / Math.max(1, peakConnected)).toFixed(1)}/s per client`)
  console.log(`send errors     : ${errors}`)
  console.log(`\nNorns should have seen a steady ~${expectedTickHz | 0} ticks/s the whole time,`)
  console.log(`independent of the ${peakConnected} phones above. Verify with:`)
  console.log(`  node analyze-session.js ../sessions/<this-session>`)
  process.exit(0)
}, SECS * 1000 + RAMP * 1000)
