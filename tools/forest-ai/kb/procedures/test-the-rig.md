# How to test the rig (any change, any time)

The single most important test, always the same: **with internet OFF**, run
`go-lan.ps1`, then from a phone on `GL-SFT1200-9b3` move an XY pad and confirm
the norns SOUND changes. If that works offline, the show works.

## Test ladder — climb only as far as you changed things

1. **Network layer**: `python tools/forest-ai/forest-ai.py --scan-only`
   Expect: SSID GL-SFT1200-9b3, router OK, norns OK, port 8081 OPEN, NORNS_HOST set.
2. **Bridge layer**: bridge window prints `OSC -> 192.168.8.180:10111`.
   Anything else (especially 10.42.0.1) is a broken config, not a broken norns.
3. **Control path**: phone → audience UI at `http://192.168.8.<laptop>:8081/`
   → move a pad → sound changes. Proves phone→WS→bridge→OSC→norns end to end.
4. **Feedback path**: meters/labels on the phone update. Proves norns→:10112 return.
5. **Recording**: performer UI record ~30s → stop → a new
   `sessions/session_<timestamp>/` appears with manifest.json + both .jsonl files.
6. **After-tools**: `python tools/forest-ai/session-infographic.py <that session>`
   renders 4 SVGs without error — proves the logs are well-formed.

## Testing a NEW controller / script (offline pipeline)

1. `parse_params.py <script.lua>` → raw_manifest.json — check every param you
   care about appears.
2. `ai_curate.py raw.json -o manifest.json --dry-run` — read the plan; the
   model may mislabel but can never invent OSC paths (they're copied by key).
3. `build_controller.py manifest.json` → open the controller on a phone →
   wiggle EVERY control once and hear/see the response before trusting it live.

## Rule of thumb

Test at home with the escape hatch (internet available) before you need it in
the forest. Never change two layers at once; the scan tells you which layer lied.
