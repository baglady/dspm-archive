# start.ps1 - launch the MBase 01 bridge (+ control PWA) on Windows.
#
# Basic usage:
#   .\start.ps1
#
# With options:
#   .\start.ps1 -MidiIn "UM-ONE" -MidiOut "UM-ONE" -Channel 10 -Port 8083
#
# MIDI port matching is a substring search (case-insensitive).
# Run once with no args - the bridge prints all available ports on startup
# so you can copy the exact name substring to use here.
param(
  [string]$MidiIn   = "",     # substring of MIDI input port name (from Rytm/OT)
  [string]$MidiOut  = "",     # substring of MIDI output port name (to MBase 01)
  [int]$Channel     = 10,     # MIDI channel MBase 01 listens on (1-16)
  [int]$Port        = 8083    # HTTP + WebSocket port
)

# Make sure node is reachable even if it's not on PATH in this shell.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $nodeDir = "C:\Program Files\nodejs"
  if (Test-Path "$nodeDir\node.exe") { $env:PATH = "$nodeDir;$env:PATH" }
  else { Write-Error "node.exe not found. Install Node.js or add it to PATH."; exit 1 }
}

$env:MIDI_IN_PORT    = $MidiIn
$env:MIDI_OUT_PORT   = $MidiOut
$env:MBASE01_CHANNEL = "$Channel"
$env:BRIDGE_WS_PORT  = "$Port"

Push-Location "$PSScriptRoot\bridge"
if (-not (Test-Path node_modules)) {
  # Fall back to the sibling octatrack-midi-control node_modules so the bridge
  # runs without a separate npm install (ws + easymidi are already there).
  $sibling = "$PSScriptRoot\..\octatrack-midi-control\bridge\node_modules"
  if (Test-Path $sibling) {
    $env:NODE_PATH = $sibling
    Write-Host "Using shared node_modules from octatrack-midi-control."
  } else {
    Write-Host "Installing deps..."
    npm install
  }
}
Write-Host ""
Write-Host "  Control page:  http://localhost:$Port/"
Write-Host "  (also on your LAN - run ipconfig to find your IP)"
Write-Host ""
node bridge-server.js
Pop-Location
