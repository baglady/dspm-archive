#!/usr/bin/env bash
# Start all three dspm-archive services, detached so they survive the shell.
# Usage: bash ~/dspm-archive/start.sh
set -u

# Locate node (installed via nvm). Falls back to PATH if already exported.
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  NODE="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "node not found. Run: export NVM_DIR=\"\$HOME/.nvm\" && . \"\$NVM_DIR/nvm.sh\""
  exit 1
fi
NODEBIN="$(dirname "$NODE")"
ROOT="$HOME/dspm-archive"
echo "using node: $NODE"

# Kill any previous instances so we don't hit EADDRINUSE. Match on the script
# basename, because below we launch node with the *full* path -- a basename
# pattern matches that AND any older instance launched with a relative name, so a
# stale bridge can't keep holding :8081 while the new one silently fails to bind.
pkill -f "backend/server.js"   2>/dev/null
pkill -f "bridge-server.js"    2>/dev/null
pkill -f "pwa/static-server.js" 2>/dev/null
sleep 1

# Launch with absolute script paths so the command line contains a stable,
# matchable string (the relative `node bridge-server.js` form did not match the
# pkill patterns above, so restarts left orphaned processes on the ports).
setsid "$NODE" "$ROOT/backend/server.js" < /dev/null > "$HOME/backend.log" 2>&1 &
setsid "$NODE" "$ROOT/bridge/bridge-server.js" < /dev/null > "$HOME/bridge.log" 2>&1 &
setsid "$NODE" "$ROOT/pwa/static-server.js" "$ROOT/pwa" 3000 < /dev/null > "$HOME/pwa.log" 2>&1 &

sleep 3
echo "--- listening ports (state 0A = LISTEN) ---"
cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep -iE '0FA0|1F91|0BB8' | grep -i ' 0A '
echo "backend -> :4000   bridge -> :8081   pwa -> :3000"
echo "logs: ~/backend.log ~/bridge.log ~/pwa.log"
