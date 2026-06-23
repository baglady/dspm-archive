# Venue runbook — LAN-only (no internet)

Everyone (laptop + norns + phones) is on the **GL router** `GL-SFT1200-9b3`.
norns is wired to the router at **192.168.8.180**. No internet needed.

## Start the show — one command
From the repo root (`C:\Users\Begonia\Desktop\dspmcode\dspm-archive`) in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\go-lan.ps1
```

- Approve the **UAC** prompt (it opens the firewall for port 8081).
- It joins the laptop to `GL-SFT1200-9b3`, checks norns, prints the phone URLs, and starts the bridge.
- It will print, e.g.:
  - AUDIENCE:  `http://192.168.8.<laptop>:8081/`
  - PERFORMER: `http://192.168.8.<laptop>:8081/performer.html?token=dspm`
- **Leave that window open** = the show is running. **Ctrl-C** stops the bridge and saves the session log.

## Phones
1. Join Wi-Fi **`GL-SFT1200-9b3`** (password `goodlife`).
2. Open the **AUDIENCE** URL the script printed.
3. You (performer) open the **PERFORMER** URL on your phone.

## If the pads don't change the sound
- The bridge window must say `OSC -> 192.168.8.180:10111`. If norns showed **NOT reachable**, fix norns' ethernet/power and re-run `go-lan.ps1`.
- Confirm norns is still at `192.168.8.180` (it's wired, so check the router's client list at `http://192.168.8.1` if unsure).
- Make sure the norns `dspm_archive` script is running and listening on OSC port `10111`.

## Recordings — the tape lands in the session folder automatically
When you stop a recording, the bridge copies the norns tape WAV off the device
into that take's `sessions/session_<…>/` folder and records it as
`tape_file` in the manifest (so the render/sync tools find it). Nothing to do
during the show — just watch the bridge window for `[tape-pull] <name>.wav -> …`.

**One-time setup** (so the copy doesn't hang on a password prompt) — from the
laptop, with norns reachable:
```powershell
# Windows OpenSSH has no ssh-copy-id; push the key by hand (default pw: sleep):
type $env:USERPROFILE\.ssh\id_*.pub | ssh we@192.168.8.180 "mkdir -p .ssh; cat >> .ssh/authorized_keys"
```
(If you have no key yet: `ssh-keygen -t ed25519` first. On a box with
`ssh-copy-id`, just `ssh-copy-id we@192.168.8.180`.)

**If a tape didn't make it across** (norns was unreachable, or an older take):
copy it in afterwards once you're back on the norns' LAN:
```powershell
node .\bridge\tape-pull.js session_<timestamp>            # tape name from the manifest
node .\bridge\tape-pull.js session_<timestamp> <name> --host 192.168.8.180
```

## If phones can't connect
- Phone must be on **`GL-SFT1200-9b3`** (not a hotspot/other Wi-Fi).
- Use the exact `192.168.8.x:8081` URL the script printed (that's the laptop's address).
- Firewall: `go-lan.ps1` opens 8081. If a phone still fails, re-run the script (re-adds the rule).

## Manual fallback (if go-lan.ps1 can't join the router)
1. Click the Wi-Fi icon → join `GL-SFT1200-9b3` (pw `goodlife`) by hand.
2. Re-run `go-lan.ps1` (it will skip the join and continue).
   Or run the bridge directly:
   ```powershell
   $env:NORNS_HOST='192.168.8.180'; $env:BRIDGE_WS_PORT='8081'; $env:BRIDGE_ADMIN_TOKEN='dspm'
   cd .\bridge ; node bridge-server.js
   ```
