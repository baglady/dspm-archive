# start-tunnel.ps1 -- expose the local bridge to the whole internet via a
# Cloudflare *quick tunnel*, print the public URL, and make a QR code the
# audience can scan. No Cloudflare account or DNS needed; the URL is random and
# changes every run (that's why this script regenerates the QR each time).
#
# Run this AFTER the bridge is up:
#   ./start-venue.ps1 -NornsHost 192.168.1.50      # in one terminal
#   ./start-tunnel.ps1                              # in another
# Ctrl-C stops the tunnel (the bridge keeps running).
#
# Requires cloudflared:  winget install Cloudflare.cloudflared

param(
  [int]$Port = 8081,     # the bridge's port (must match start-venue.ps1)
  [int]$QrSize = 640     # QR image size in px
)

$ErrorActionPreference = "Stop"

$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  Write-Host "cloudflared not found. Install it once with:" -ForegroundColor Red
  Write-Host "    winget install Cloudflare.cloudflared" -ForegroundColor Yellow
  exit 1
}

# cloudflared prints its banner (with the URL) to stderr; capture both streams.
$outLog = Join-Path $env:TEMP "dspm-cloudflared.out.log"
$errLog = Join-Path $env:TEMP "dspm-cloudflared.err.log"
Remove-Item $outLog, $errLog -Force -ErrorAction SilentlyContinue

Write-Host "Starting Cloudflare quick tunnel -> http://localhost:$Port ..." -ForegroundColor Cyan
$proc = Start-Process -FilePath $cf.Source `
  -ArgumentList @("tunnel", "--url", "http://localhost:$Port") `
  -NoNewWindow -PassThru `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog

# Poll the logs until the trycloudflare URL appears (up to ~30s).
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Milliseconds 500
  $hit = Select-String -Path $errLog, $outLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($hit) { $url = $hit.Matches[0].Value }
}

if (-not $url) {
  Write-Host "Timed out waiting for the tunnel URL. Check $errLog" -ForegroundColor Red
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  exit 1
}

Write-Host ""
Write-Host "================= AUDIENCE URL =================" -ForegroundColor Green
Write-Host "    $url" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
Write-Host "performer (set BRIDGE_ADMIN_TOKEN first): $url/?admin=<token>" -ForegroundColor DarkGray
Write-Host "webhooks: $url/hook/<osc-path>" -ForegroundColor DarkGray
Write-Host ""

# QR for the AUDIENCE base URL only -- never the ?admin token.
$qr = Join-Path (Get-Location) "tunnel-qr.png"
try {
  $enc = [uri]::EscapeDataString($url)
  Invoke-WebRequest -Uri "https://api.qrserver.com/v1/create-qr-code/?size=${QrSize}x${QrSize}&data=$enc" -OutFile $qr
  Write-Host "QR code saved: $qr -- opening it now (project/show this to scan)." -ForegroundColor Cyan
  Start-Process $qr
} catch {
  Write-Host "QR generation failed ($($_.Exception.Message)). The URL above still works." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Tunnel is live. Ctrl-C to stop it (bridge stays up)." -ForegroundColor DarkGray
try {
  Wait-Process -Id $proc.Id
} finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}
