# Woods pre-flight: stop Windows from stealing the laptop off the show router.
# Sets every saved Wi-Fi profile EXCEPT GL-SFT1200-9b3 to manual-connect.
# (The #1 documented showtime failure, 2026-06-21, was an auto-rejoin.)
# Run:  powershell -ExecutionPolicy Bypass -File tools\demote-wifi.ps1
# Undo for home wifi afterwards:
#   netsh wlan set profileparameter name="JewelFlower" connectionmode=auto

$keep = 'GL-SFT1200-9b3'
$profiles = (netsh wlan show profiles | Select-String "All User Profile\s+: (.+)$").Matches |
    ForEach-Object { $_.Groups[1].Value.Trim() }

foreach ($p in $profiles) {
    if ($p -eq $keep) { continue }
    netsh wlan set profileparameter name="$p" connectionmode=manual | Out-Null
    Write-Host "manual  <- $p"
}

$still = @()
foreach ($p in $profiles) {
    if ($p -eq $keep) { continue }
    $mode = (netsh wlan show profile name="$p" | Select-String "Connection mode\s+: (.+)$").Matches
    if ($mode -and $mode[0].Groups[1].Value.Trim() -match "automatically") { $still += $p }
}
if ($still) { Write-Host "STILL AUTO: $($still -join ', ')" -ForegroundColor Red; exit 1 }
Write-Host "done -- only $keep may auto-connect" -ForegroundColor Green
