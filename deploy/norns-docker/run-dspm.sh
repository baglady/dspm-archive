#!/usr/bin/env bash
# Run the dockerized norns (schollz/norns-desktop) for dspm-archive.
# Headless, softcut-only, OSC-driven. --network host so OSC control AND feedback
# addressing behave exactly like a real LAN norns (no docker NAT on the UDP
# return path). Loads + inits dspm_archive after boot, AFTER norns has
# SUPERCOLLIDER-FAILed + cleared, so the script is not cleared out from under us.
# Audio monitor stream at http://<host>:8002/radio.mp3 (crone softcut output).
#
# Lives on the box at ~/norns-desktop/ alongside the cloned schollz/norns-desktop
# (see README.md). NODE_PATH points at the bridge's node_modules for `ws`.
set -e
cd "$(dirname "$0")"
ME="$(pwd)"
export NODE_PATH=/opt/dspm-archive/bridge/node_modules

sudo docker rm -f norns-docker 2>/dev/null || true
for i in $(seq 1 15); do sudo docker ps -a --format "{{.Names}}" | grep -qx norns-docker || break; sleep 1; done

sudo docker run -d --rm -it \
  --network host \
  --cap-add=SYS_NICE --cap-add=SYS_PTRACE --security-opt seccomp=unconfined \
  --ulimit rtprio=95 --ulimit memlock=-1 --shm-size=256m \
  -v "$ME/dust:/home/we/dust" \
  -v "$ME/jackdrc:/etc/jackdrc" \
  -v "$ME/start_norns.sh:/home/we/start_norns.sh" \
  -v "$ME/icecast.xml:/etc/icecast2/icecast.xml" \
  -v "$ME/darkice.cfg:/etc/darkice.cfg" \
  --name norns-docker \
  norns-docker

echo "run-dspm: waiting for matron REPL (5555)..."
for i in $(seq 1 60); do
  if node "$ME/matron-eval.js" "print(\"PING\")" 2>/dev/null | grep -q PING; then echo "run-dspm: matron up (~${i}s)"; break; fi
  sleep 1
done

echo "run-dspm: waiting for SC startup to settle (so it cannot clear our script)..."
for i in $(seq 1 40); do
  if sudo docker exec norns-docker grep -qE "SUPERCOLLIDER FAIL|startup_status.timeout|startup_status.ok" /tmp/matron.log 2>/dev/null; then echo "run-dspm: settled (~${i}s)"; break; fi
  sleep 1
done
sleep 1

echo "run-dspm: loading dspm_archive"
node "$ME/matron-eval.js" "norns.script.load(\"/home/we/dust/code/dspm_archive/dspm_archive.lua\")" 2>&1 | tail -2
sleep 3
echo "run-dspm: ensuring init() ran"
node "$ME/matron-eval.js" "local ok=pcall(function() return params:get(\"filter_frequency\") end); if not ok then init() end; local _,v=pcall(function() return params:get(\"filter_frequency\") end); print(\"READY nparams=\"..#params.params..\" filter_frequency=\"..tostring(v))" 2>&1 | grep -E "READY|ERR" | tail -2

echo "run-dspm: matron :8889  maiden :5000  radio http://127.0.0.1:8002/radio.mp3  OSC udp/10111 (host net)"
