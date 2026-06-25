#!/usr/bin/env bash
# Test-day pre-flight for the dockerized norns: health-check, load the test
# sample so the looper has audible material, print the URLs. Safe to re-run.
# Lives on the box at ~/norns-desktop/preflight.sh.  Run:  ssh babayaga ~/norns-desktop/preflight.sh
ME="$(cd "$(dirname "$0")" && pwd)"
export NODE_PATH=/opt/dspm-archive/bridge/node_modules
ev(){ node "$ME/matron-eval.js" "$1" 2>/dev/null; }

echo "== services (want: active / active) =="
systemctl is-active dspm-norns dspm-bridge
echo "== container =="
sudo docker ps --filter name=norns-docker --format "{{.Status}}" || true
echo "== script (want: params=82) =="
NP=$(ev "print(\"params=\"..#params.params)" | grep -o "params=[0-9]*")
echo "${NP:-params=?}"
if [ "$NP" != "params=82" ]; then
  echo "!! script not loaded -> sudo systemctl restart dspm-norns ; wait 30s ; re-run preflight"
fi
echo "== load test sample into buffer 1 =="
if [ -f "$ME/dust/audio/test.wav" ]; then
  ev "params:set(\"import1\",\"/home/we/dust/audio/test.wav\"); print(\"imported\")" | grep -qi imported && echo "   sample loaded -> the 6 voices now have material" || echo "   (import sent)"
else
  echo "!! no sample at dust/audio/test.wav (see TESTDAY.md to regenerate)"
fi
echo "== monitor stream (want: tens of thousands) =="
echo "radio.mp3 bytes/3s: $(curl -s --max-time 3 http://127.0.0.1:8002/radio.mp3 2>/dev/null | wc -c)"
echo
echo "controller : https://dspm.hetti.be/             (LAN http://10.0.0.129:8081/)"
echo "performer  : /performer.html?token=<BRIDGE_ADMIN_TOKEN>"
echo "monitor    : https://dspm.hetti.be/radio.mp3    (LAN http://10.0.0.129:8002/radio.mp3)"
