# How to add knowledge to the forest AI

The model only knows what retrieval hands it. To teach it something:

## Quick capture (in the field)

- After a useful answer: re-run the same question with `--save` —
  `python forest-ai.py --save "how do i ..."` writes the Q&A into `kb/journal/`.
- Or write `kb/journal/YYYY-MM-DD-topic.md` by hand. One fact per file beats
  one giant file: retrieval picks whole chunks.

## Writing notes that retrieval can actually find

- Title = the question it answers ("# Fixing stale phone UI"), not a poetic name.
- Use the words you'd say when asking ("pads dead", "no sound", "wrong wifi") —
  keyword search matches words, not meanings.
- Exact commands, IPs, and paths verbatim in code blocks. The model quotes them.
- Under ~1500 characters per section; longer sections get split mid-thought.

## Periodic organize pass (at home)

    python forest-ai.py --organize

The model reads the journal and writes a merge proposal to
`kb/journal/ORGANIZE-PROPOSAL.md`. YOU apply it by hand — promote stable facts
into `kb/procedures/` or the Obsidian vault, delete superseded notes. The
model proposes; the human files. Then re-run `sync-vault.ps1` if vault changed.

## What goes where

- `kb/procedures/` — how-to that should survive forever (testing, launching).
- `kb/journal/`    — raw field notes, timestamps, one-off discoveries.
- Obsidian vault   — everything else about your life/art; mirrored read-only.
- `rig-knowledge.md` — the always-injected core (topology, failure modes).
  Keep it small; it costs context on every single question.
