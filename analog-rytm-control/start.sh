#!/usr/bin/env bash
# start.sh — launch the Analog Rytm control bridge (+ PWA) on Linux / Raspberry Pi
#
# Usage:
#   ./start.sh
#   MIDI_PORT_NAME="USB MIDI" BRIDGE_WS_PORT=8084 ./start.sh
#   FX_CHANNEL=13 AUTO_CHANNEL=14 ./start.sh        # match your unit's MIDI config
#
# Run once without env vars — the bridge prints all available MIDI ports on
# startup so you can copy the right substring into MIDI_PORT_NAME.

set -e

PORT="${BRIDGE_WS_PORT:-8084}"
export BRIDGE_WS_PORT="$PORT"

cd "$(dirname "$0")/bridge"
if [ ! -d node_modules ]; then
  sibling="$(dirname "$0")/../octatrack-midi-control/bridge/node_modules"
  if [ -d "$sibling" ]; then
    export NODE_PATH="$sibling"
    echo "Using shared node_modules from octatrack-midi-control."
  else
    echo "Installing deps…"
    npm install
  fi
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
echo ""
echo "  Control page:  http://${IP}:${PORT}/"
echo ""
exec node bridge-server.js
