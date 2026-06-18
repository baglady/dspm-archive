# dspm-archive

Performance capture, crowd-scale phone interaction, and archiving for DSPM's `barcode`-based norns set. This is the **new version** — it deploys as a *separate* selectable script (`dspm_archive`) so the existing, working `norns_project`/`barcode` setup stays exactly as it is and remains your reliable fallback.

## Layout

```
norns/dspm_archive/      -- patched barcode (dspm_archive.lua) + lib/ (json, perf_logger)
bridge/                  -- many-phones→norns aggregation bridge + session logging (Node)
backend/                 -- performer session-labeling tool (Express + ajv), form UI
pwa/                     -- audience phone controller (installable PWA)
schema/                  -- Session Bundle Spec v1 JSON Schemas (manifest + metadata)
sessions/                -- one directory per performance bundle (+ session_example)
docs/                    -- control-surface mapping, bridge design, network notes
capacitor.config.json    -- Android wrapping for the PWA (Amazon Appstore / Play)
```

## What runs where

- **norns** — `dspm_archive.lua` (audio + the `osc.event` handler + `perf_logger` writing `logs/perflog_*.jsonl`).
- **laptop/server on the LAN** — `bridge/` (websocket for phones, OSC out to norns, tick aggregation, writes `phone_events.jsonl` + `bridge_ticks.jsonl`).
- **VPS alongside Ghost** (or any host with access to the sessions dir) — `backend/` for post-show labeling.
- **audience phones** — `pwa/`, installable, or via the Capacitor-wrapped store listing.

## Deploying the norns side (without touching norns_project)

The new script installs as its own folder, so on norns it shows up as a **separate** entry in SELECT next to `barcode`. Nothing about the existing symlinked `barcode` → `norns_project` setup changes.

Transfer the folder via FileZilla SFTP (the only reliable method — SMB silently fails). Host `sftp://10.42.0.1`, user `we`, password `sleep`, port 22. Drop `norns/dspm_archive/` into `/home/we/dust/code/` so you end up with:

```
/home/we/dust/code/dspm_archive/dspm_archive.lua
/home/we/dust/code/dspm_archive/lib/json.lua
/home/we/dust/code/dspm_archive/lib/perf_logger.lua
```

Then verify the transfer landed (don't trust timestamps):

```sh
wc -c ~/dust/code/dspm_archive/dspm_archive.lua    # expect ~29000+ bytes
grep -c "osc.event = function" ~/dust/code/dspm_archive/dspm_archive.lua   # expect 1
```

On norns: SELECT → **dspm_archive**. Your old `barcode` entry is untouched. Logs land in `~/dust/data/dspm_archive/logs/`.

## Bridge (laptop/server on the LAN)

```sh
cd bridge && npm install
NORNS_HOST=10.42.0.1 node bridge-server.js
```

Each run creates a new `sessions/session_<timestamp>/` with a manifest and the two log streams; `Ctrl-C` finalizes the manifest's duration. Override `NORNS_HOST`, `NORNS_PORT` (default 10111), `BRIDGE_WS_PORT` (8081), `BRIDGE_TICK_MS` (40), `SESSIONS_DIR` via env.

## PWA (audience phones)

Serve `pwa/` over HTTP from the bridge host (or any host phones can reach). Phones open it and tap "Add to Home Screen". It connects to the bridge at `ws://<page-host>:8081` by default; override with `?bridge=host:port`. Reminder for the help page: phones must turn off cellular/mobile data or the local page won't load.

## Backend (session labeling)

```sh
cd backend && npm install
SESSIONS_DIR=../sessions node server.js
```

Open `http://<host>:4000`, pick a session, fill the form (validated against the metadata schema before writing `performance-metadata.json`), and optionally upload supplementary media. A `sessions/session_example/` bundle is included to try this before a real session exists.

## Status / what's next

- The replay/remix web player isn't built yet — it would read a complete bundle (manifest + metadata + logs + media) and is the natural next piece once a real session exists.
- Server-side headless norns (running `dspm_archive.lua` on the VPS to replay/remix archived sessions) is the longer-term goal — worth a dedicated pass once the bundle format is validated against a real performance.
- All four layers' logs share one time base; the manifest's `offsets_sec` aligns external recordings (field recorder, video, line-level) against it.
