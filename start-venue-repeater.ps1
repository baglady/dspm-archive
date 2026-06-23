# start-venue-repeater.ps1 -- LAN show where the GL router REPEATS an upstream
# Wi-Fi (e.g. "JewelFlower") so the whole rig has internet too.
#
# Topology:
#   [JewelFlower Wi-Fi] --repeat--> [GL-SFT1200 router] --+-- norns (Ethernet, 192.168.8.180)
#                                                         +-- this laptop (Wi-Fi, 192.168.8.x)  <- runs the bridge
#                                                         +-- audience / performer phones (Wi-Fi)
#
# The router gives every device on 192.168.8.x internet via the repeated uplink,
# so the bridge can reach norns AND you stay online (Claude, tunnel, etc.).
#
# !! Do the ROUTER side first (see VENUE-REPEATER-SETUP.md): log into
#    http://192.168.8.1 and set Repeater -> JewelFlower. THEN run this script.
#
# Usage (PowerShell, from the repo root). It self-elevates for the firewall rule:
#   ./start-venue-repeater.ps1
#   ./start-venue-repeater.ps1 -RouterSsid "GL-SFT1200-9b3" -RouterPass "goodlife"
#   ./start-venue-repeater.ps1 -NornsHost 192.168.8.180 -AdminToken "long-secret"

param(
  [string]$NornsHost  = "192.168.8.180",
  [int]   $NornsPort  = 10111,
  [int]   $Port       = 8081,
  [string]$AdminToken = "dspm",
  [string]$RouterSsid = "GL-SFT1200-9b3",
  [string]$RouterPass = "goodlife"
)

# ---- self-elevate (needed once to add the inbound firewall rule) -----------
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Re-launching as Administrator (approve the UAC prompt)..." -ForegroundColor Cyan
  $argline = "-ExecutionPolicy Bypass -NoProfile -File `"$PSCommandPath`"" +
    " -NornsHost $NornsHost -NornsPort $NornsPort -Port $Port" +
    " -AdminToken `"$AdminToken`" -RouterSsid `"$RouterSsid`" -RouterPass `"$RouterPass`""
  Start-Process powershell -Verb RunAs -ArgumentList $argline
  exit
}

$ErrorActionPreference = "Continue"
$root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgeDir = Join-Path $root "bridge"

# ---- 1) firewall: allow phones to reach the bridge on $Port ----------------
if (-not (Get-NetFirewallRule -DisplayName "DSPM bridge $Port" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "DSPM bridge $Port" -Direction Inbound `
    -LocalPort $Port -Protocol TCP -Action Allow -Profile Any | Out-Null
  Write-Host "Firewall: inbound TCP $Port allowed." -ForegroundColor Green
} else {
  Write-Host "Firewall: rule for $Port already present." -ForegroundColor DarkGray
}

# ---- 2) make sure the router Wi-Fi profile exists, then join it ------------
# (Joining the router is what puts the laptop on norns' 192.168.8.x network.)
$xml = Join-Path $env:TEMP "dspm-router.xml"
@"
<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>$RouterSsid</name>
  <SSIDConfig><SSID><name>$RouterSsid</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>auto</connectionMode>
  <MSM><security>
    <authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
    <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>$RouterPass</keyMaterial></sharedKey>
  </security></MSM>
</WLANProfile>
"@ | Set-Content -Path $xml -Encoding ASCII

netsh wlan add profile filename="$xml" user=all | Out-Null
Write-Host "Joining router Wi-Fi '$RouterSsid' ..." -ForegroundColor Cyan
netsh wlan connect name="$RouterSsid" | Out-Null

# ---- 3) wait for a 192.168.8.x lease + confirm norns is reachable ----------
$ip = $null
for ($i = 0; $i -lt 30 -and -not $ip; $i++) {
  Start-Sleep -Seconds 1
  $ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -like "192.168.8.*" } |
    Select-Object -First 1).IPAddress
}
if (-not $ip) {
  Write-Host "Could NOT get a 192.168.8.x address from '$RouterSsid'." -ForegroundColor Red
  Write-Host "Join it by hand (Wi-Fi icon -> $RouterSsid, pw '$RouterPass'), then re-run." -ForegroundColor Yellow
  Read-Host "Press Enter to close"; exit 1
}
Write-Host "Laptop IP on router: $ip" -ForegroundColor Green

if (Test-Connection -ComputerName $NornsHost -Count 2 -Quiet) {
  Write-Host "norns $NornsHost is REACHABLE." -ForegroundColor Green
} else {
  Write-Host "WARNING: norns $NornsHost did NOT answer a ping. Check its Ethernet cable/power" -ForegroundColor Yellow
  Write-Host "  and that it pulled 192.168.8.180 (router admin -> Clients). Starting anyway." -ForegroundColor Yellow
}

# quick internet sanity check (proves the repeater is actually passing traffic)
if (Test-Connection -ComputerName 1.1.1.1 -Count 1 -Quiet) {
  Write-Host "Internet via repeater: OK." -ForegroundColor Green
} else {
  Write-Host "No internet through the router yet -- the show still works LAN-only," -ForegroundColor Yellow
  Write-Host "  but re-check the router's Repeater -> JewelFlower if you wanted online." -ForegroundColor Yellow
}

# ---- 4) stop any bridge already bound to $Port, then print URLs ------------
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*bridge-server.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "============ PHONES: join Wi-Fi '$RouterSsid' (pw $RouterPass), open ============" -ForegroundColor Green
Write-Host ("  audience:  http://{0}:{1}/" -f $ip, $Port) -ForegroundColor Green
Write-Host ("  performer: http://{0}:{1}/performer.html?token={2}" -f $ip, $Port, $AdminToken) -ForegroundColor Yellow
Write-Host "================================================================================" -ForegroundColor Green
Write-Host ("Bridge -> OSC to norns at {0}:{1}.  Ctrl-C stops it and finalizes the log." -f $NornsHost, $NornsPort) -ForegroundColor DarkGray
Write-Host ""

# ---- 5) start the bridge (foreground) -------------------------------------
if (-not (Test-Path (Join-Path $bridgeDir "node_modules"))) {
  Write-Host "Installing bridge deps (one time)..." -ForegroundColor Cyan
  Push-Location $bridgeDir; npm install; Pop-Location
}
$env:NORNS_HOST         = $NornsHost
$env:NORNS_PORT         = "$NornsPort"
$env:BRIDGE_WS_PORT     = "$Port"
$env:BRIDGE_ADMIN_TOKEN = $AdminToken

Push-Location $bridgeDir
try { node bridge-server.js } finally { Pop-Location }
