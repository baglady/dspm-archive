# dj-id — personal "Shazam for DJs" (non-AI)

Identify which track plays **where** in a recorded mix, using classic **acoustic
fingerprinting** — the same constellation/peak-hashing family as Shazam.
Deterministic DSP, **no machine learning, no cloud, fully offline**. You ingest
your library once (a folder or a DJ USB stick), then point it at a recording of
your set and it produces a timeline you can turn into a tracklist, auto-cut audio
snippets, or video edit markers.

```
USB/folder ──► ingest ──► fingerprint DB + catalog.json
recorded mix ──► identify ──► timeline.json ──► emit: .cue / snippets / video EDL / render-edl
```

## Quick start

```bash
cd dj-id
npm install                                  # just ffmpeg-static (bundled ffmpeg)

node djid.js ingest "E:/Music"               # build the library (point at your USB)
node djid.js identify "recordings/set.wav"   # -> set.timeline.json (+ printed tracklist)
node djid.js emit set.timeline.json --mix "recordings/set.wav" \
     --outdir out --cue --snippets --edl     # tracklist + clips + video markers
node djid.js doctor --scan "E:/Music"        # check engines + detect DJ databases
```

`ingest` is incremental — re-running adds/updates tracks in the same DB
(`--db <dir>`, default `dj-id/data/`).

## Engines

All three share one interface; pick with `--engine`:

| engine | needs | strength |
| --- | --- | --- |
| `builtin` *(default)* | nothing | zero-setup landmark fingerprinting; robust to noise/EQ/re-encoding |
| `panako` | Java JRE + Panako jar | **handles DJ time-stretch/pitch-shift up to ~10%** and reports the shift |
| `audfprint` | Python + audfprint | lighter alternative for near-original-tempo sets |

The built-in engine is great for sets played near the original tempo. If you
**beatmatch/pitch-bend hard**, use Panako — it's built for exactly that and also
tells you how far each track was sped up/pitched.

### Enabling Panako (optional)
1. Install a Java JRE (so `java -version` works).
2. Download the Panako jar from <https://github.com/JorenSix/Panako>.
3. Point dj-id at it, then ingest/identify with `--engine panako`:
   ```bash
   export PANAKO_JAR="/path/to/panako.jar"   # or PANAKO_CMD=panako if on PATH
   node djid.js ingest "E:/Music" --engine panako
   node djid.js identify set.wav --engine panako
   ```
   > Panako's query CSV columns vary by version; if matches look off, adjust
   > `extractMatch()` in `engine-panako.js`.

### Enabling audfprint (optional)
```bash
export AUDFPRINT_CMD="python /path/to/audfprint/audfprint.py"
node djid.js ingest "E:/Music" --engine audfprint
```

## Outputs (`emit`)

If you name none, `--cue` and `--edl` are produced by default.

- `--cue` → standard **.cue** tracklist (one INDEX per track).
- `--snippets` → ffmpeg-cut **per-track audio clips** (`--format wav|mp3`,
  `--pad <sec>` to extend over transitions). Requires `--mix <file>`.
- `--edl` → **video edit markers**: a CMX3600 `.edl` plus a DaVinci Resolve
  `.markers.csv`, timed at `--fps` (default 25), so cuts land on track changes.
- `--render` → `render-edl.json` + a `render-master.cmds.txt` of
  `node render-master.js <session> --start --end` lines, to drive the bridge
  render pipeline (`../bridge/render-master.js`) so visuals cut on track boundaries.
  Pass `--session-id <id>` to fill in the session.

## Timeline format (`timeline.json`)

```jsonc
{
  "mix": ".../set.wav", "durationSec": 71.9, "engine": "builtin",
  "segments": [
    { "trackId": "trk_…", "artist": "…", "title": "…", "display": "Artist - Title",
      "bpm": 124, "key": "8A", "start_s": 0.0, "end_s": 23.9,
      "confidence": 0.97, "pitch_pct": 0, "score": 480, "source_file": "…" }
  ],
  "overlaps":   [ { "from_s": 23.0, "to_s": 25.0, "out_track": "…", "in_track": "…" } ],
  "unknownGaps":[ { "from_s": 50.0, "to_s": 61.0 } ]
}
```

`overlaps` are crossfades (two tracks matched at once = the transition region);
`unknownGaps` are stretches nothing matched (often heavily EQ'd/looped passages —
frequently the transitions themselves).

## What's in the box

```
djid.js            CLI: ingest | identify | emit | doctor
ingest.js          walk library, read tags + DJ metadata, decode, fingerprint, catalog.json
identify.js        decode mix, query engine, build timeline.json
timeline.js        merge segments, crossfade overlaps, unknown gaps, confidence
engine-builtin.js  pure-Node constellation fingerprinting (default)
engine-panako.js   Panako wrapper (time-stretch/pitch-shift robust)
engine-audfprint.js audfprint wrapper (fallback)
lib/               fft, wav, fingerprint, ffmpeg, args, util
adapters/          DJ-software metadata: rekordbox (PDB), enginedj (SQLite)
emit/              cue / snippets / edl / render-jobs generators
```

## DJ-software metadata

`ingest` enriches tracks with **BPM, key, and cue points** from a prepared USB
when present, merged over the files' own tags:

- **Rekordbox** export (`PIONEER/rekordbox/export.pdb` + `USBANLZ/`)
- **Engine DJ** (`Engine Library/*.db`, plain SQLite)

> Status: the adapters currently **detect** these databases (see `doctor --scan`);
> full field extraction is the next step. Until then, loose-file ID3/tag reading
> (artist, title, BPM, key where tagged) covers every track, so nothing blocks
> ingest or identification.

## Limits (by design — this is fingerprinting, not magic)

- Matches need ~10s+ of recognizable audio; very short stabs, or sections that are
  heavily EQ-killed/looped/effected, land in `unknownGaps`.
- The **built-in** engine assumes near-original tempo. Big tempo/pitch moves →
  use `--engine panako`.
- A track must be **in your library** to be identified — this is a personal
  matcher against your own files, not a global database.

## Live mode (planned)

A `live.js` that fingerprints rolling ~12s windows of loopback audio and emits
"now playing" over the bridge WebSocket (for `../pwa/performer.html`) reuses the
same engine + timeline code. Not implemented yet; batch identification of a
recording is the supported path today.
