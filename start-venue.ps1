# start-venue.ps1 -- run the dspm-archive bridge on a Windows laptop at the show.
#
# The bridge is the "processor": it serves the audience PWA AND the control
# WebSocket on one port (8081), averages every phone's input on a fixed tick,
# logs the session, and forwards aggregated OSC to norns. norns only does audio.
#
# Usage (PowerShell, from the repo root):
#   ./start-venue.ps1 -NornsHost 192.168.1.50                       # LAN-only show
#   ./start-venue.ps1 -NornsHost 192.168.1.50 -Tunnel              # + public URL + QR
#   ./start-venue.ps1 -NornsHost 192.168.1.50 -Tunnel -AdminToken "long-secret"
# where 192.168.1.50 is norns' IP on your WiFi (norns: SYSTEM > WIFI shows it).
#
# -Tunnel opens a Cloudflare quick tunnel so anyone online can join, prints the
# public URL, and saves + opens tunnel-qr.png for the audience to scan (the URL
# is random and changes each run). It needs cloudflared:
#   winget install Cloudflare.cloudflared
# Without -Tunnel the script behaves exactly as a LAN-only rig.
#
# One-time firewall allow (run PowerShell as Administrator once), so phones can
# reach the laptop:
#   New-NetFirewallRule -DisplayName "DSPM bridge 8081" -Direction Inbound `
#     -LocalPort 8081 -Protocol TCP -Action Allow -Profile Private

param(
  [Parameter(Mandatory = $true)][string]$NornsHost,
  [int]$Port = 8081,
  [int]$NornsPort = 10111,
  [string]$AdminToken = "dspm",
  [switch]$Tunnel,
  [int]$QrSize = 640
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeDir = Join-Path $root "bridge"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js is not installed. Install the LTS from https://nodejs.org, reopen PowerShell, and re-run." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path (Join-Path $bridgeDir "node_modules"))) {
  Write-Host "Installing bridge dependencies (one time)..." -ForegroundColor Cyan
  Push-Location $bridgeDir
  npm install
  Pop-Location
}

# ---- local (same-WiFi) URLs ----------------------------------------------
Write-Host ""
Write-Host "Audience opens ONE of these on the same WiFi:" -ForegroundColor Green
$ips = @(Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" })
$ips | ForEach-Object { Write-Host ("    http://{0}:{1}/" -f $_.IPAddress, $Port) -ForegroundColor Green }
Write-Host ""
if ($ips.Count -gt 0) {
  $ip = $ips[0].IPAddress
  Write-Host "Performer page (full norns control):" -ForegroundColor Yellow
  Write-Host ("    http://{0}:{1}/performer.html?token={2}" -f $ip, $Port, $AdminToken) -ForegroundColor Yellow
  Write-Host ""
}

# ---- optional: named Cloudflare tunnel -> dspm.hetti.be -------------------
# cloudflared runs in the background; the bridge stays in the foreground below
# so Ctrl-C still reaches it and finalizes the session log. The tunnel is
# stopped in the finally block when the bridge exits.
$cfProc = $null
if ($Tunnel) {
  $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
  if (-not $cf) {
    Write-Host "-Tunnel requested but cloudflared isn't installed; continuing LAN-only." -ForegroundColor Yellow
    Write-Host "  Install once with:  winget install Cloudflare.cloudflared" -ForegroundColor DarkGray
  } else {
    if ($AdminToken -eq "dspm") {
      Write-Host "WARNING: going public with the default admin token 'dspm' -- it's guessable." -ForegroundColor Red
      Write-Host "  Re-run with  -AdminToken `"something-long`"  to protect the performer page / kill-switch." -ForegroundColor DarkGray
    }
    $errLog = Join-Path $env:TEMP "dspm-cloudflared.err.log"
    Remove-Item $errLog -Force -ErrorAction SilentlyContinue
    Write-Host "Opening Cloudflare tunnel -> https://dspm.hetti.be ..." -ForegroundColor Cyan
    # Force IPv4 + HTTP/2: some venue/home networks have a broken IPv6 path or
    # block QUIC (UDP/7844), which makes the tunnel's TLS control stream fail
    # ("ssl handshake failed" / "control stream encountered a failure"). HTTP/2
    # rides TCP/443 and IPv4 avoids the bad v6 edge -- this connects reliably.
    # Run from ~/.cloudflared so it always reads that config.yml + credentials.
    $cfProc = Start-Process -FilePath $cf.Source `
      -ArgumentList @("tunnel", "--protocol", "http2", "--edge-ip-version", "4", "run", "dspm") `
      -WorkingDirectory (Join-Path $env:USERPROFILE ".cloudflared") `
      -NoNewWindow -PassThru `
      -RedirectStandardError $errLog

    # wait for tunnel to register connections (up to ~15s)
    $ready = $false
    for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
      Start-Sleep -Milliseconds 500
      $hit = Select-String -Path $errLog -Pattern "Registered tunnel connection" -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($hit) { $ready = $true }
    }

    $pub = "https://dspm.hetti.be"
    if (-not $ready) {
      Write-Host "Tunnel may still be connecting — check $errLog if the URL doesn't work." -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "============== PUBLIC (anyone online) ==============" -ForegroundColor Green
    Write-Host ("  audience:  {0}/" -f $pub) -ForegroundColor Green
    Write-Host ("  performer: {0}/performer.html?token={1}" -f $pub, $AdminToken) -ForegroundColor Yellow
    Write-Host "===================================================" -ForegroundColor Green
    # QR encodes the AUDIENCE url only -- never the performer token.
    $qr = Join-Path $root "tunnel-qr.png"
    try {
      $enc = [uri]::EscapeDataString("$pub/")
      Invoke-WebRequest -Uri "https://api.qrserver.com/v1/create-qr-code/?size=${QrSize}x${QrSize}&data=$enc" -OutFile $qr
      Write-Host "Audience QR saved + opening: $qr" -ForegroundColor Cyan
      Start-Process $qr
    } catch {
      Write-Host "QR generation failed ($($_.Exception.Message)). The URL above still works." -ForegroundColor Yellow
    }
    Write-Host ""
  }
}

Write-Host ("Forwarding OSC to norns at {0}:{1}" -f $NornsHost, $NornsPort) -ForegroundColor Cyan
Write-Host "Ctrl-C stops the bridge (and tunnel) and finalizes the session log." -ForegroundColor DarkGray
Write-Host ""

$env:NORNS_HOST          = $NornsHost
$env:NORNS_PORT          = "$NornsPort"
$env:BRIDGE_WS_PORT      = "$Port"
$env:BRIDGE_ADMIN_TOKEN  = $AdminToken

Push-Location $bridgeDir
try {
  node bridge-server.js
} finally {
  Pop-Location
  if ($cfProc -and -not $cfProc.HasExited) {
    Write-Host "Stopping Cloudflare tunnel ..." -ForegroundColor DarkGray
    Stop-Process -Id $cfProc.Id -Force -ErrorAction SilentlyContinue
  }
}
