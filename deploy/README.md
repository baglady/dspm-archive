# Run profiles

The same bridge (`bridge/bridge-server.js`) runs three ways. Pick by where you
are in the workflow. All three serve the audience PWA **and** the control
websocket on one port (`BRIDGE_WS_PORT`, default 8081) and log every session.

| Profile | Where | Launch | Use for |
|---|---|---|---|
| **1. Laptop bridge** | Windows / mac / Linux laptop on the LAN | `start-venue.ps1` / `start-venue.sh` | Shows now; quickest to stand up |
| **2. Opal + Pi** | Pi behind the Opal, always-on | `systemd` unit in this folder | The permanent venue "brain", no laptop |
| **3. VS Code / cloud** | code-server pod (PikaPods) | `start.sh` | Editing in the browser, previewing the UI, demos — **no norns** |

`NORNS_HOST` is the only thing that changes between them: norns' IP on whatever
network the bridge shares with it. (Profile 3 has no norns, so OSC just goes
nowhere — it's for the UI + aggregation/logging, not a live show.)

---

## 1. Laptop bridge

The venue rig when a laptop runs the bridge next to norns. See
[../docs/venue-setup.md](../docs/venue-setup.md) (Windows) and
[../docs/network-opal.md](../docs/network-opal.md) (over the Opal's WiFi).

```powershell
# Windows
./start-venue.ps1 -NornsHost 192.168.8.20
```
```sh
# mac / Linux
NORNS_HOST=192.168.8.20 ./start-venue.sh
```

## 2. Opal + Pi (always-on)

The Pi behind the Opal runs the bridge headless and restarts on boot, so the
rig comes up with the power and there's no laptop to babysit. One-time setup on
the Pi (Raspberry Pi OS):

```sh
# get node + the repo
sudo apt install -y nodejs npm && node -v        # or nvm for a newer node
git clone https://github.com/baglady/dspm-archive.git ~/dspm-archive
cd ~/dspm-archive/bridge && npm install

# configure norns' IP
cp ~/dspm-archive/deploy/dspm-bridge.env.example ~/dspm-archive/deploy/dspm-bridge.env
nano ~/dspm-archive/deploy/dspm-bridge.env       # set NORNS_HOST

# install + enable the service (paths/User in the unit assume user `pi`)
sudo cp ~/dspm-archive/deploy/dspm-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dspm-bridge
systemctl status dspm-bridge                      # confirm it's running
journalctl -u dspm-bridge -f                      # live logs
```

To update later: `cd ~/dspm-archive && git pull && sudo systemctl restart dspm-bridge`.

Audience opens `http://<pi-ip>:8081/` on the Opal WiFi. Give the Pi a static
DHCP lease on the Opal so that URL never changes.

## 3. VS Code / cloud (code-server)

The browser-dev profile, already wired for the PikaPods pod. Serves the backend,
bridge, and PWA so you can edit `pwa/config.js` and preview the controller live
without any hardware:

```sh
cd ~/dspm-archive && git pull && bash start.sh
```

Reach it through the pod's path proxy (`/proxy/8081/` for the bridge+PWA). This
profile is for iterating on the UI and showing people — not for driving norns,
which is unreachable from the cloud.

---

## Battle-testing (any profile)

With a bridge running, simulate a crowd and verify norns' inbound rate stays
flat no matter how many phones connect:

```sh
cd bridge
node loadtest.js --url ws://localhost:8081 --clients 50 --rate 20 --secs 20
# ...then inspect what was actually captured:
node analyze-session.js ../sessions/<the-session-just-created>
```

The tick rate reported by `analyze-session.js` should hold ~25/s and read
`[stable]` whether you ran 5 clients or 200 — that flat line is the whole point
of the aggregation design. Ramp the client count up (`--clients 200 --ramp 10`)
to find where *connections* start failing on a given host (the Pi Zero W will
top out far sooner than a laptop).
