# Ollama server crashes mid-answer / how to roll back the version

(journaled 2026-07-06 by the human — verified facts)

Ollama 0.31.1 (current, newest available) crashed twice on 2026-07-06 on this
laptop: the API returns a 500 mid-generate, then the whole server process dies
with nothing useful in D:\ollama\serve.log. CPU-only box, so the GPU crash
reports on GitHub don't apply. No newer version exists to upgrade to.

## What already protects you

forest-ai.py and eval-model.py self-heal: if the API is down they relaunch
`D:\ollama\serve.cmd` and wait up to 30 s. A crash costs one retry, not a show.

## If crashes become frequent: roll back to 0.30.11

Both installers live on D:\ollama (offline kit, no internet needed):

    OllamaSetup-0.31.1.exe    the version that crashes (current)
    OllamaSetup-0.30.11.exe   previous stable line, the rollback

Rollback procedure:
1. Stop the server: `taskkill /f /im ollama.exe`
2. Run `D:\ollama\OllamaSetup-0.30.11.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR=D:\ollama\install`
3. Restart: `D:\ollama\serve.cmd` (models on D: are untouched by reinstall)
4. Verify: `ollama --version` and `python tools/forest-ai/eval-model.py`
   — scores in kb/eval-results.md must not drop from the 2026-07-06 baseline
   (gemma3:4b 7/8, qwen2.5-coder:3b 7/8 counting the crash retry).
