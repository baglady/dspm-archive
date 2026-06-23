#!/usr/bin/env bash
# start.sh — launch the MBase 01 bridge on Linux / Raspberry Pi
#
# Usage:
#   ./start.sh
#   MIDI_IN_PORT="UM-ONE" MIDI_OUT_PORT="UM-ONE" MBASE01_CHANNEL=10 ./start.sh
#
# Run once without env vars — the bridge prints all available MIDI ports so you
# can set the right substring. Set BRIDGE_WS_PORT to change the HTTP port (8083).

set -e

PORT="${BRIDGE_WS_PORT:-8083}"
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
