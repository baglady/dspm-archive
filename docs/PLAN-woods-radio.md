# Plan: norns audio monitor over the travel router (offline icecast)

Goal: in the woods, any phone on `GL-SFT1200-9b3` can play the live norns mix
at `http://192.168.8.<laptop>:8081/radio.mp3` — no internet, no Debian box.
This deletes the last "dead in the woods" item on WOODS-CHECKLIST.

## Design: darkice + icecast2 run ON the physical norns

The encoder has to live where the audio is: the norns mix exists as the
`crone:output_1/2` jack ports, and `deploy/norns-docker/` already proves the
exact pipeline (darkice jack-input → icecast mount `/norns.mp3`, with the
respawn + `jack_connect` trick in `start_norns.sh:40-44`). The physical norns
shield is the same software stack, so we mirror it:

    crone softcut ──jack──> darkice (mp3 encode) ──> icecast :8000 on norns
                                                        │
    laptop bridge  RADIO_URL=http://192.168.8.180:8000/norns.mp3
                                                        │
    phones         http://192.168.8.<laptop>:8081/radio.mp3   (same-origin proxy)

The bridge needs zero code changes — `bridge-server.js:379` already proxies
whatever `RADIO_URL` points at.

Rejected alternatives:
- **icecast on the laptop, darkice on norns** — saves the norns almost nothing
  (icecast is tiny; the encoder is the load) and adds a Windows service.
- **USB audio interface into the laptop, stream from Windows** — zero norns
  load, but new hardware + cable in the bag. Keep as the FALLBACK if Phase 2
  shows the Pi can't afford mp3 encoding.

## Phase 0 — prereqs (at home, WITH internet; norns powered + reachable)

- [ ] norns reachable: `ssh we@192.168.8.180` (pw `sleep`; key already pushed).
      Either bring up the travel router or note the norns' home-LAN IP.
- [ ] Port 8000 free on norns: `ss -tln | grep :8000` → expect nothing.
      (If taken, use 8002 like the docker box did — carry through every step.)
- [ ] `sudo apt update && sudo apt install -y icecast2 darkice`
      (decline the icecast2 debconf wizard; we write the config ourselves)
- [ ] CPU baseline while dspm_archive plays: `top` — note idle %.

## Phase 1 — icecast on the norns

- [ ] `/etc/icecast2/icecast.xml`: hostname `192.168.8.180`, listen `8000`,
      `<source-password>` set (suggest `dspm-radio`), `<clients>32</clients>`.
- [ ] `sudo systemctl enable --now icecast2`
- [ ] TEST from laptop: `curl -I http://192.168.8.180:8000/` → HTTP 200.

## Phase 2 — darkice on the norns  ← the go/no-go gate

- [ ] `/etc/darkice.cfg` adapted from `deploy/norns-docker/darkice.cfg`:
      jack input, `server = 127.0.0.1`, `port = 8000`, `mountPoint = norns.mp3`,
      `password = dspm-radio`, 44100 Hz stereo, **96 kbps CBR mp3** (raise to
      128 only if CPU allows).
- [ ] systemd unit `dspm-darkice.service` (runs as `we`, `Nice=10` so crone
      always wins CPU): respawn loop + the jack_connect-once-registered trick
      from `start_norns.sh` — `jack_connect crone:output_1 darkice:left` etc.
- [ ] TEST: VLC on laptop opens `http://192.168.8.180:8000/norns.mp3` and you
      hear the loops (~2–8 s behind live — normal, it's ambience not monitoring).
- [ ] **STRESS TEST (the gate):** perform hard on all 6 voices for 5 minutes.
      Listen to the norns' direct audio out for glitches/xruns, watch `top`.
      - Glitches at 96 kbps stereo → try mono → still bad → STOP: adopt the
        USB-interface fallback, norns goes back to stock.
- [ ] Reboot norns; confirm icecast2 + dspm-darkice come back by themselves
      and the stream plays with no ssh intervention (show-morning condition).

## Phase 3 — wire the laptop

- [ ] `go-lan.ps1`: next to the `NORNS_HOST` line add
      `$env:RADIO_URL = 'http://192.168.8.180:8000/norns.mp3'`
- [ ] TEST: run go-lan, open `http://localhost:8081/radio.mp3` → plays.
- [ ] TEST from a phone on the router: `http://192.168.8.<laptop>:8081/radio.mp3`.
      Bandwidth sanity: 96 kbps × 10 phones ≈ 1 Mbps — trivial for the SFT1200.

## Phase 4 — dress rehearsal + paperwork

- [ ] Full WOODS-CHECKLIST run with internet OFF, including the radio.
- [ ] WOODS-CHECKLIST.md: delete the "no audience radio stream in the woods"
      caveat; replace section 4 with the LAN radio test; add darkice/icecast
      to section 5's known services.
- [ ] `tools/forest-ai/rig-knowledge.md` + a kb journal note: new failure
      modes — silent stream = darkice lost its jack_connect (restart
      dspm-darkice); 502 = icecast down on norns; multi-second delay = normal.
- [ ] Home deploy untouched: radio.hetti.be still comes from the Debian box;
      `RADIO_URL` is only set in LAN mode by go-lan.ps1.

## Open questions (answer during Phase 0)

1. Is port 8000 actually free on a stock norns shield image? (Expect yes.)
2. Does the norns have disk headroom for the two packages? (`df -h /`, expect yes.)
3. darkice jack-input package build: Debian's darkice ships with jack support
   compiled in (the docker image used the same) — verify `darkice -h | grep -i jack`
   or just run it; if the distro build lacks jack, `apt install darkice` from
   backports or compile — decide then.
