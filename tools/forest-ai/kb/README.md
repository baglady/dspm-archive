# forest-ai knowledge base

Everything the local AI "knows" lives in plain markdown, here and in the
Obsidian vault mirror (D:\forest-vault). The model is disposable — swap it any
time (see procedures/swap-models.md) and the knowledge comes along, because
knowledge is injected by retrieval at ask-time, never trained or baked in.

## Layout

    kb/
      README.md            this file
      procedures/          HOW to do things — testing, adding knowledge, swapping models
      journal/             notes the AI writes for itself (forest-ai.py --save)
      evals.jsonl          rig questions + expected answers; eval-model.py scores any model
      eval-results.md      score history, appended by eval-model.py

## Rules that keep it model-agnostic

1. One topic per file, plain markdown, a `#` title that says what it answers.
   Retrieval is keyword-based: use the words you'd use when asking.
2. Facts the model must never improvise (IPs, ports, passwords, commands) are
   written verbatim in the file. The model quotes; it does not remember.
3. Prompts/system text live in the Python scripts, not in any model config.
   Model choice is only ever: FOREST_MODEL env var > installed-model preference
   list > --model flag.
4. Every skill is a deterministic script + a procedure doc that names it.
   The model's job is to point at the right script, never to be the script.
5. When a new fact is learned in the field, journal it (--save or by hand into
   journal/). Periodically run --organize to fold journal notes into topics.
