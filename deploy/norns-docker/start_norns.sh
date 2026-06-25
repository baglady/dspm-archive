#!/bin/bash
# Patched for dspm-archive (headless, OSC-driven, softcut-only), run under
# docker --network host so OSC control + feedback addressing behave exactly like
# a real LAN norns. SuperCollider engine never boots here (sclang does not
# auto-boot scsynth in this image) -> startup reports SUPERCOLLIDER FAIL, which
# is harmless: dspm_archive uses only softcut (in crone). run-dspm.sh loads +
# inits the script after boot. Audio monitor stream: crone softcut output ->
# darkice -> icecast on :8002 (host :8000 is taken by YunoHost icecast).
#
# Mounted over the image's baked-in /home/we/start_norns.sh (the Dockerfile CMD).
export DISPLAY=:0
export JACK_NO_START_SERVER=1
export JACK_NO_AUDIO_RESERVATION=1
export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:/usr/local/lib64/

sudo /etc/init.d/dbus start
sudo chown -R we:we /home/we/dust
Xvfb :0 -screen 0 1280x640x16 -fbdir /tmp &
sleep 0.5
cd /home/we/ && LOGGER=info /usr/local/go/bin/go run oled-server.go -window-name "matron" -port 8889 &
sleep 0.5
jackd -V
$(cat /etc/jackdrc) &
sleep 1
/home/we/norns/build/crone/crone &
sleep 1
cd /home/we/norns/sc
/home/we/norns/build/ws-wrapper/ws-wrapper "ws://*:5556" /usr/local/bin/sclang -i maiden > /tmp/sclang.log 2>&1 &
sleep 1
cd /home/we
/home/we/norns/build/ws-wrapper/ws-wrapper "ws://*:5555" /home/we/norns/build/matron/matron > /tmp/matron.log 2>&1 &
sleep 1
cd /home/we/maiden && ./maiden server --app ./app/build --data ~/dust --doc ~/norns/doc &
sleep 1

# audio monitor stream: icecast(:8002) <- darkice <- crone softcut output.
# wait for icecast to accept before starting darkice, and keep darkice respawning.
icecast2 -c /etc/icecast2/icecast.xml &
for i in $(seq 1 30); do (exec 3<>/dev/tcp/127.0.0.1/8002) 2>/dev/null && { exec 3>&- 3<&-; break; }; sleep 0.5; done
sleep 1
( while true; do darkice -c /etc/darkice.cfg > /tmp/darkice.log 2>&1; sleep 2; done ) &
sleep 3
( for i in $(seq 1 30); do
    jack_connect crone:output_1 darkice:left 2>/dev/null && jack_connect crone:output_2 darkice:right 2>/dev/null && { echo "start_norns: darkice connected"; break; }
    sleep 1
  done ) &

echo "start_norns: up (host-net). matron :5555  maiden :5000  screen :8889  radio :8002/radio.mp3  osc udp/10111"
tail -f /dev/null
