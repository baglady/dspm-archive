#!/usr/bin/env bash
# start.sh — launch the Octatrack MIDI control bridge (+ PWA).
#   ./start.sh                         # auto-pick first MIDI out, port 8082
#   MIDI_PORT_NAME="USB MIDI" ./start.sh
#   BRIDGE_WS_PORT=9000 BRIDGE_ADMIN_TOKEN=secret ./start.sh
set -e
cd "$(dirname "$0")/bridge"
[ -d node_modules ] || { echo "Installing deps…"; npm install; }
echo "Open the controller on a phone:  http://<this-host-ip>:${BRIDGE_WS_PORT:-8082}/"
exec node bridge-server.js
