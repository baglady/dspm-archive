# How to try / adopt a different model

The whole stack is model-agnostic: knowledge is markdown + retrieval, skills
are scripts, prompts live in the Python. Swapping models is three commands and
a measurement — never a rebuild.

## 1. Pull a candidate (needs internet, do at home)

    set OLLAMA_MODELS=D:\ollama\models
    ollama pull <candidate>

Size guide for THIS laptop (i7-8550U, 16 GB, CPU-only): 3-4B ≈ 5-8 tok/s is
the sweet spot; 7-8B ≈ 2-3 tok/s only for patient batch jobs; bigger = no.

## 2. Measure it — don't vibe it

    python tools/forest-ai/eval-model.py                 # scores all installed models
    python tools/forest-ai/eval-model.py --model <candidate>

This runs the rig Q&A benchmark in kb/evals.jsonl and appends scores +
timing to kb/eval-results.md. A model that can't say 192.168.8.180 when asked
where the norns lives does not get to come to the forest.

## 3. Adopt it

    setx FOREST_MODEL <candidate>     # persistent, user-level

FOREST_MODEL beats the built-in preference list in every tool (forest-ai.py,
session-infographic.py). To roll back: `setx FOREST_MODEL ""` or set another.
ai_curate.py takes `--model <candidate>` explicitly.

## 4. Grow the benchmark

Every time a model gives a bad answer in the field, journal the question and
the RIGHT answer, then add a line to kb/evals.jsonl:

    {"q": "the question", "expect_all": ["must", "appear"], "expect_any": ["or", "one", "of these"]}

The benchmark is your taste, written down. It's what makes "better" measurable.
