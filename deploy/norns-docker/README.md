# Dockerized norns on the Debian box (closes "Phase 2" over loopback)

Runs a full **norns** software stack ([schollz/norns-desktop], amd64) in Docker on
the same Debian box as the bridge, so the bridge drives it over **loopback UDP**
(`127.0.0.1:10111`). Because norns lives where the server lives, no remote
norns-agent is needed — this is the co-located answer to "Phase 2" in
[../../DEPLOY-DEBIAN.md](../../DEPLOY-DEBIAN.md).

```
phones ──ws──> bridge ──OSC 10111──> [docker norns] ──softcut
  ^                                        │
  └──────── feedback 10112 <──────────── matron
                                   crone softcut ──> darkice ──> icecast :8002/radio.mp3
```

It is **headless and softcut-only**: control, feedback, session logging, and an
mp3 monitor stream all work; there is **no live audio I/O** (dummy jack). The
`dspm_archive` script uses only softcut, which lives in *crone* and needs no
SuperCollider engine.

## Layout on the box

Everything lives in `~/norns-desktop` (the cloned upstream repo + the files in
this directory copied alongside it):

```
~/norns-desktop/
  Dockerfile            # upstream, with ONE patch (see below)
  dust/code/dspm_archive/   # copied from /opt/dspm-archive/norns/dspm_archive
  jackdrc               # this dir: dummy backend
  start_norns.sh        # this dir: patched entrypoint (mounted over image CMD)
  run-dspm.sh           # this dir: boot + load + init the script
  icecast.xml           # upstream, port 8000 -> 8002
  darkice.cfg           # upstream, port 8000 -> 8002
  matron-eval.js        # this dir: REPL helper
  osc-send.js           # this dir: OSC test helper
```

## First-time setup

```sh
# 1. clone upstream alongside these files
cd ~ && git clone https://github.com/schollz/norns-desktop && cd norns-desktop

# 2. ONE Dockerfile patch (bitrot): upstream pins node 20.10.0 then `npm install
#    -g npm`, which now pulls npm@11 and fails EBADENGINE (needs node >=20.17).
sed -i 's|RUN npm install -g npm yarn|RUN npm install -g npm@10.9.2 yarn|' Dockerfile

# 3. build the image (~10-15 min: SuperCollider + matron + crone). needs docker;
#    baglady is not in the docker group, so use sudo.
sudo docker build -t norns-docker .

# 4. drop in the files from deploy/norns-docker/ (run-dspm.sh, start_norns.sh,
#    jackdrc, matron-eval.js, osc-send.js) and the port-patched configs:
cp /opt/dspm-archive/deploy/norns-docker/{run-dspm.sh,start_norns.sh,jackdrc,matron-eval.js,osc-send.js} .
cp icecast.xml icecast.xml.orig; cp darkice.cfg darkice.cfg.orig
sed -i 's|<port>8000</port>|<port>8002</port>|' icecast.xml
sed -i 's|port            = 8000|port            = 8002|' darkice.cfg
chmod +x run-dspm.sh start_norns.sh

# 5. stage the script + data dirs
mkdir -p dust/data dust/audio/tape dust/code
cp -r /opt/dspm-archive/norns/dspm_archive dust/code/

# 6. install + enable the systemd service (boot-persistent)
sudo cp /opt/dspm-archive/deploy/norns-docker/dspm-norns.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dspm-norns

# 7. point the bridge at the local container and restart it
sed -i 's/^NORNS_HOST=.*/NORNS_HOST=127.0.0.1/' /opt/dspm-archive/deploy/dspm-bridge.env
sudo systemctl restart dspm-bridge
```

## Day to day

```sh
sudo systemctl restart dspm-norns     # rebuild patch not needed; just re-run
journalctl -u dspm-norns -f           # service log (the run-dspm.sh output)
sudo docker logs -f norns-docker      # norns/matron/sclang/darkice log
~/norns-desktop/run-dspm.sh           # run by hand (what the service calls)
```

URLs (loopback; the bridge/tunnel is the only thing meant to be public):
- screen  http://127.0.0.1:8889
- maiden  http://127.0.0.1:5000
- **radio  http://127.0.0.1:8002/radio.mp3**  (softcut output)
- OSC     udp/10111 (control), udp/10112 (feedback, on the bridge)

## Why it's built the way it is (the non-obvious bits)

- **`--network host`.** Published `-p` ports go through docker-proxy, which
  rewrites the UDP source address — so norns→bridge *feedback* (which replies to
  the address it learned from the inbound packet) doesn't get back. Host
  networking makes addressing behave exactly like a real LAN norns; both legs
  work. Cost: the container's ports bind on all host interfaces (see Hardening).

- **`SUPERCOLLIDER FAIL` is expected and harmless.** norns gates a script's
  automatic `init()` on the SC engine acking an `engine.load(...)`; in this image
  sclang never boots scsynth on its own, so matron's ~12 s startup wait
  (`hello.c: timeout_ticks = 2400`) times out and norns runs
  `norns.script.clear()`. `dspm_archive` needs no engine (softcut is in crone),
  so `run-dspm.sh` waits for that timeout/clear to happen FIRST, then loads the
  script and calls `init()` explicitly. (Loading before the clear would get the
  script wiped out from under us — the `session_start`/`session_end` symptom.)

- **icecast/darkice on :8002.** The box already runs YunoHost's icecast on
  :8000; under host networking the container's icecast must use a free port.
  darkice is started only after icecast accepts, and respawned in a loop
  (darkice exits on the first connect-refused, which races icecast startup).

- **Dummy jack still streams.** softcut output flows through jack's dummy backend
  to darkice → icecast, so `radio.mp3` carries whatever softcut plays even with
  no soundcard. With no audio *input*, recording captures silence; load/import
  buffers to have something to hear/manipulate.

## Hardening (TODO)

Host networking exposes matron's REPL on `0.0.0.0:5555` — that REPL executes
arbitrary Lua, i.e. remote code execution on the LAN. maiden (`:5000`) and the
screen (`:8889`) are also LAN-exposed. The tunnel only needs `:8081`; restrict
the norns ports to loopback with an iptables/ufw rule.

## Wanting real audio later

Give the box a soundcard, then in `jackdrc` swap the dummy line for e.g.
`/usr/bin/jackd -R -d alsa -d hw:1` and add `--device /dev/snd --group-add audio`
to `run-dspm.sh`'s `docker run`. Card 1 on this box has capture+playback, so real
input (live looping into softcut) becomes possible too.

[schollz/norns-desktop]: https://github.com/schollz/norns-desktop
