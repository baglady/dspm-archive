# start-venue.ps1 -- run the dspm-archive bridge on a Windows laptop at the show.
#
# The bridge is the "processor": it serves the audience PWA AND the control
# WebSocket on one port (8081), averages every phone's input on a fixed tick,
# logs the session, and forwards aggregated OSC to norns. norns only does audio.
#
# Usage (PowerShell, from the repo root):
#   ./start-venue.ps1 -NornsHost 192.168.1.50
# where 192.168.1.50 is norns' IP on your WiFi (norns: SYSTEM > WIFI shows it).
#
# One-time firewall allow (run PowerShell as Administrator once), so phones can
# reach the laptop:
#   New-NetFirewallRule -DisplayName "DSPM bridge 8081" -Direction Inbound `
#     -LocalPort 8081 -Protocol TCP -Action Allow -Profile Private

param(
  [Parameter(Mandatory = $true)][string]$NornsHost,
  [int]$Port = 8081,
  [int]$NornsPort = 10111
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

Write-Host ""
Write-Host "Audience opens ONE of these on the same WiFi:" -ForegroundColor Green
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  ForEach-Object { Write-Host ("    http://{0}:{1}/" -f $_.IPAddress, $Port) -ForegroundColor Green }
Write-Host ""
Write-Host ("Forwarding OSC to norns at {0}:{1}" -f $NornsHost, $NornsPort) -ForegroundColor Cyan
Write-Host "Ctrl-C stops the bridge and finalizes the session log." -ForegroundColor DarkGray
Write-Host ""

$env:NORNS_HOST = $NornsHost
$env:NORNS_PORT = "$NornsPort"
$env:BRIDGE_WS_PORT = "$Port"

Push-Location $bridgeDir
try {
  node bridge-server.js
} finally {
  Pop-Location
}
