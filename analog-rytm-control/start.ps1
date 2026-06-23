# start.ps1 - launch the Analog Rytm MIDI control bridge (+ PWA) on Windows.
#
#   ./start.ps1                        # auto-pick first MIDI out, port 8084
#   ./start.ps1 -MidiPort "USB MIDI"   # match an interface by name substring
#   ./start.ps1 -Port 9000 -AdminToken "something-long"
#   ./start.ps1 -FxChannel 13 -AutoChannel 14   # match your unit's MIDI config
param(
  [string]$MidiPort = "",
  [int]$Port = 8084,
  [string]$AdminToken = "",
  [string]$TrackChannels = "1,2,3,4,5,6,7,8,9,10,11,12",
  [int]$FxChannel = 13,
  [int]$PerfChannel = 13,
  [int]$AutoChannel = 14
)

# Make sure node is reachable even if it's not on PATH in this shell.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $nodeDir = "C:\Program Files\nodejs"
  if (Test-Path "$nodeDir\node.exe") { $env:PATH = "$nodeDir;$env:PATH" }
  else { Write-Error "node.exe not found. Install Node.js or add it to PATH."; exit 1 }
}

$env:MIDI_PORT_NAME = $MidiPort
$env:BRIDGE_WS_PORT = "$Port"
$env:TRACK_CHANNELS = $TrackChannels
$env:FX_CHANNEL     = "$FxChannel"
$env:PERF_CHANNEL   = "$PerfChannel"
$env:AUTO_CHANNEL   = "$AutoChannel"
if ($AdminToken) { $env:BRIDGE_ADMIN_TOKEN = $AdminToken }

Push-Location "$PSScriptRoot/bridge"
if (-not (Test-Path node_modules)) {
  # Fall back to a sibling rig's node_modules so the bridge runs without a
  # separate npm install (ws + easymidi are already there).
  $sibling = "$PSScriptRoot/../octatrack-midi-control/bridge/node_modules"
  if (Test-Path $sibling) {
    $env:NODE_PATH = $sibling
    Write-Host "Using shared node_modules from octatrack-midi-control."
  } else {
    Write-Host "Installing deps..."
    npm install
  }
}
Write-Host "Open the controller on a phone:  http://<this-pc-ip>:$Port/"
node bridge-server.js
Pop-Location
