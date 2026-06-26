// front-gateway.js
//
// Always-on reverse proxy that sits in front of the bridge so the public
// hostname (hetti.be) ALWAYS loads something:
//   - bridge up  -> transparently proxies HTTP *and* the control WebSocket
//                   through to the bridge, so the live PWA works unchanged.
//   - bridge down -> serves an auto-retrying holding page; phones flip to the
//                   live PWA on their own the moment a show starts.
//
// cloudflared points hetti.be at THIS process (default :8080), not the bridge
// directly. The gateway outlives individual shows -- on the Debian box it runs
// as its own always-on service while the bridge only runs during a set.
//
// Built-ins only (http + net) so it proxies any request/upgrade verbatim and
// needs no npm install -- drops straight onto the Debian box.

const http = require('http')
const net = require('net')

const PORT        = parseInt(process.env.GATEWAY_PORT || '8080', 10)
const BRIDGE_HOST = process.env.BRIDGE_HOST || '127.0.0.1'
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '8081', 10)

// Holding page: matches the barcode PWA dark theme, reloads itself so the
// audience lands on the live control surface as soon as the bridge is up.
const HOLDING = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>barcode // standby</title>
<meta name="theme-color" content="#0a0a0c">
<style>
  :root { --bg:#0a0a0c; --panel:#141418; --line:#2a2a30; --accent:#ff3b30; --ink:#e8e8ee; --dim:#6b6b76; }
  * { box-sizing:border-box; }
  html,body { height:100%; margin:0; }
  body {
    background:var(--bg); color:var(--ink);
    font:15px/1.5 ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
    display:flex; align-items:center; justify-content:center; text-align:center;
    padding:24px;
  }
  .card { max-width:420px; }
  .mark { font-size:13px; letter-spacing:.35em; color:var(--dim); text-transform:uppercase; }
  h1 { font-size:26px; margin:18px 0 10px; font-weight:600; }
  p { color:var(--dim); margin:0 0 22px; }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%;
         background:var(--accent); margin-right:8px; vertical-align:middle;
         animation:pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{opacity:.25;} 50%{opacity:1;} }
  .retry { font-size:12px; color:var(--dim); }
  .retry b { color:var(--ink); font-weight:600; }
</style>
</head>
<body>
  <div class="card">
    <div class="mark"><span class="dot"></span>barcode</div>
    <h1>The show isn't live yet</h1>
    <p>Hang tight &mdash; this page will connect you automatically the moment it starts.</p>
    <div class="retry">retrying in <b id="n">15</b>s</div>
  </div>
<script>
  // Count down, then reload. When the bridge is up the reload returns the live
  // PWA instead of this page, so phones join hands-free.
  var n = 15, el = document.getElementById('n');
  setInterval(function () {
    n -= 1;
    if (n <= 0) { location.reload(); return; }
    el.textContent = n;
  }, 1000);
</script>
</body>
</html>`

function serveHolding (res) {
  if (res.headersSent) { try { res.end() } catch (_) {} ; return }
  res.writeHead(503, {
    'content-type': 'text/html; charset=utf-8',
    'retry-after': '15',
    'cache-control': 'no-store'
  })
  res.end(HOLDING)
}

// Plain HTTP: forward verbatim to the bridge; if the bridge isn't listening
// (ECONNREFUSED) fall back to the holding page.
const server = http.createServer((req, res) => {
  const proxy = http.request({
    host: BRIDGE_HOST,
    port: BRIDGE_PORT,
    method: req.method,
    path: req.url,
    headers: req.headers
  }, (up) => {
    res.writeHead(up.statusCode, up.headers)
    up.pipe(res)
  })
  proxy.on('error', () => serveHolding(res))
  req.pipe(proxy)
})

// WebSocket / any Upgrade: splice the client socket to a fresh TCP connection
// to the bridge and replay the request line + headers, so the control socket
// passes through transparently. If the bridge is down, drop it -- the PWA's
// client retries on its own.
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(BRIDGE_PORT, BRIDGE_HOST, () => {
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
    }
    raw += '\r\n'
    up.write(raw)
    if (head && head.length) up.write(head)
    up.pipe(socket)
    socket.pipe(up)
  })
  up.on('error', () => socket.destroy())
  socket.on('error', () => up.destroy())
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`front-gateway on :${PORT} -> bridge ${BRIDGE_HOST}:${BRIDGE_PORT}`)
  console.log('  bridge up   -> proxies HTTP + WebSocket through to the live PWA')
  console.log('  bridge down -> serves the auto-retrying holding page')
})
