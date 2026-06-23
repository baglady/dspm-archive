# start.ps1 - launch the Octatrack MIDI control bridge (+ PWA) on Windows.
#
#   ./start.ps1                       # auto-pick first MIDI out, port 8082
#   ./start.ps1 -MidiPort "USB MIDI"  # match an interface by name substring
#   ./start.ps1 -Port 9000 -AdminToken "something-long"
param(
  [string]$MidiPort = "",
  [int]$Port = 8082,
  [string]$AdminToken = "",
  [string]$AudioChannels = "1,2,3,4,5,6,7,8",
  [int]$AutoChannel = 9
)

# Make sure node is reachable even if it's not on PATH in this shell.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $nodeDir = "C:\Program Files\nodejs"
  if (Test-Path "$nodeDir\node.exe") { $env:PATH = "$nodeDir;$env:PATH" }
  else { Write-Error "node.exe not found. Install Node.js or add it to PATH."; exit 1 }
}

$env:MIDI_PORT_NAME = $MidiPort
$env:BRIDGE_WS_PORT = "$Port"
$env:AUDIO_CHANNELS = $AudioChannels
$env:AUTO_CHANNEL   = "$AutoChannel"
if ($AdminToken) { $env:BRIDGE_ADMIN_TOKEN = $AdminToken }

Push-Location "$PSScriptRoot/bridge"
if (-not (Test-Path node_modules)) { Write-Host "Installing deps..."; npm install }
Write-Host "Open the controller on a phone:  http://<this-pc-ip>:$Port/"
node bridge-server.js
Pop-Location
