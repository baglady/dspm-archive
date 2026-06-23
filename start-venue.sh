#!/usr/bin/env bash
# start-venue.sh -- run the dspm-archive bridge on a mac/Linux laptop or a Pi
# at the show. The bridge serves the audience PWA + control websocket on one
# port and forwards aggregated OSC to norns.
#
#   NORNS_HOST=192.168.8.20 ./start-venue.sh
#   ./start-venue.sh 192.168.8.20            # norns IP as first arg also works
#
# Env overrides: BRIDGE_WS_PORT (default 8081), NORNS_PORT (default 10111),
#   BRIDGE_ADMIN_TOKEN (default "dspm"), NICE (default 10 on Pi, 0 elsewhere).
#
# On Patchbox OS / Pi 2 W, NICE=10 keeps audio (JACK/arecord) the CPU
# priority over the bridge. Set NICE=0 if you're not running audio alongside.
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
BRIDGE="$ROOT/bridge"

NORNS_HOST="${1:-${NORNS_HOST:-}}"
if [ -z "$NORNS_HOST" ]; then
  echo "usage: NORNS_HOST=<norns-ip> $0   (or: $0 <norns-ip>)" >&2
  exit 1
fi
export NORNS_HOST
export BRIDGE_WS_PORT="${BRIDGE_WS_PORT:-8081}"
export NORNS_PORT="${NORNS_PORT:-10111}"
export BRIDGE_ADMIN_TOKEN="${BRIDGE_ADMIN_TOKEN:-dspm}"

# On a Pi detect automatically; override with NICE=0 to disable.
if [ -z "${NICE:-}" ]; then
  if grep -qi "raspberry\|patchbox" /proc/device-tree/model 2>/dev/null; then
    NICE=10
  else
    NICE=0
  fi
fi

# locate node: PATH first, then an nvm install
NODE="$(command -v node || true)"
if [ -z "$NODE" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  NODE="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "$NODE" ]; then
  echo "node not found. Install Node.js (https://nodejs.org) or nvm, then re-run." >&2
  exit 1
fi

[ -d "$BRIDGE/node_modules" ] || (cd "$BRIDGE" && npm install)

echo ""
echo "Audience opens one of these on the same WiFi:"
# Linux/Pi: hostname -I ; macOS: ipconfig getifaddr enX
IPS="$(hostname -I 2>/dev/null || true)"
if [ -z "$IPS" ]; then
  IPS="$( (ipconfig getifaddr en0 2>/dev/null; ipconfig getifaddr en1 2>/dev/null) || true)"
fi
for ip in $IPS; do echo "    http://$ip:${BRIDGE_WS_PORT}/"; done
[ -z "$IPS" ] && echo "    http://<this-host-ip>:${BRIDGE_WS_PORT}/"
echo ""
for ip in $IPS; do
  echo "Performer page:  http://$ip:${BRIDGE_WS_PORT}/performer.html?token=${BRIDGE_ADMIN_TOKEN}"
  break
done
echo "Forwarding OSC to norns at ${NORNS_HOST}:${NORNS_PORT}"
[ "$NICE" -gt 0 ] && echo "Running at nice +${NICE} (audio gets CPU priority)"
echo "Ctrl-C stops the bridge and finalizes the session log."
echo ""

cd "$BRIDGE"
exec nice -n "$NICE" "$NODE" bridge-server.js
