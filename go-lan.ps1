# go-lan.ps1 -- ONE-SHOT LAN-only venue launcher for dspm-archive (barcode only).
# For the full 7-script play-along rig (barcode / oooooo / passersby / molly /
# awake / cranes / mangl), use ../dspm-playalong/go-lan.ps1 instead.
# Double-click won't work; run from the repo root in PowerShell:
#     powershell -ExecutionPolicy Bypass -File .\go-lan.ps1
#
# What it does, in order:
#   1. self-elevates (UAC) so it can add the firewall rule
#   2. opens inbound TCP 8081 (so phones can reach the bridge)
#   3. joins this laptop to the GL router Wi-Fi  GL-SFT1200-9b3  (pw goodlife)
#   4. waits for a 192.168.8.x address and pings norns at 192.168.8.180
#   5. prints the phone URLs
#   6. starts the bridge pointed at norns (Ctrl-C stops it + saves the session log)
# No internet required for any of this.

# --- 1. self-elevate -------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Re-launching as admin (approve the UAC prompt)..." -ForegroundColor Cyan
  Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`""
  exit
}

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- 2. firewall: allow inbound 8081 --------------------------------------
if (-not (Get-NetFirewallRule -DisplayName 'DSPM bridge 8081' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'DSPM bridge 8081' -Direction Inbound -LocalPort 8081 -Protocol TCP -Action Allow -Profile Any | Out-Null
  Write-Host "Firewall: opened inbound TCP 8081." -ForegroundColor Green
} else {
  Write-Host "Firewall: 8081 already allowed." -ForegroundColor DarkGray
}

# --- 3. join the GL router Wi-Fi ------------------------------------------
$xml = Join-Path $env:TEMP 'gl-sft1200.xml'
@'
<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>GL-SFT1200-9b3</name>
  <SSIDConfig><SSID><name>GL-SFT1200-9b3</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>manual</connectionMode>
  <MSM><security>
    <authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
    <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>goodlife</keyMaterial></sharedKey>
  </security></MSM>
</WLANProfile>
'@ | Set-Content -Path $xml -Encoding ASCII
netsh wlan add profile filename="$xml" user=all | Out-Null
# stop other known networks from auto-stealing the radio
netsh wlan set profileparameter name="Pixel_3195" connectionmode=manual 2>$null | Out-Null
netsh wlan set profileparameter name="JewelFlower" connectionmode=manual 2>$null | Out-Null
Write-Host "Joining GL-SFT1200-9b3 ..." -ForegroundColor Cyan
netsh wlan connect name="GL-SFT1200-9b3" | Out-Null

# --- 4. wait for router IP + check norns ----------------------------------
$ip = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.8.*' }).IPAddress | Select-Object -First 1
  if ($ip) { break }
}
if (-not $ip) {
  Write-Host "Could not get a 192.168.8.x address. Click the Wi-Fi icon, join GL-SFT1200-9b3 (pw goodlife) by hand, then re-run this script." -ForegroundColor Red
  Read-Host "Press Enter to close"; exit 1
}
Write-Host ("Laptop is on the router: {0}" -f $ip) -ForegroundColor Green
if (Test-Connection -ComputerName 192.168.8.180 -Count 2 -Quiet) {
  Write-Host "norns 192.168.8.180: REACHABLE" -ForegroundColor Green
} else {
  Write-Host "norns 192.168.8.180: NOT reachable -- check norns' ethernet cable + that it's powered. (Bridge will still start.)" -ForegroundColor Yellow
}

# --- 5. phone URLs --------------------------------------------------------
Write-Host ""
Write-Host "============ PHONES: join Wi-Fi GL-SFT1200-9b3 (pw goodlife), then open ============" -ForegroundColor Green
Write-Host ("   AUDIENCE :  http://{0}:8081/" -f $ip) -ForegroundColor Green
Write-Host ("   PERFORMER:  http://{0}:8081/performer.html?token=dspm" -f $ip) -ForegroundColor Yellow
Write-Host "====================================================================================" -ForegroundColor Green
Write-Host ""

# --- 6. start the bridge (kill any old one first) -------------------------
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*bridge-server.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$env:NORNS_HOST         = '192.168.8.180'
$env:NORNS_PORT         = '10111'
$env:BRIDGE_WS_PORT     = '8081'
$env:BRIDGE_ADMIN_TOKEN = 'dspm'
Set-Location (Join-Path $root 'bridge')
Write-Host "Starting bridge -> OSC to norns 192.168.8.180:10111.  Ctrl-C stops it and saves the session log." -ForegroundColor Cyan
Write-Host ""
node bridge-server.js
