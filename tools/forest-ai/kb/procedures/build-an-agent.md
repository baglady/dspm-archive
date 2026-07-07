# How to create, start, stop, and "train" a local agent

An agent here = a Python loop around the local model:

    while not done and steps < MAX:
        state  = gather()                # deterministic scan / file read
        choice = ask_model(state)        # model picks ONE action, JSON only
        result = execute(choice)         # from a whitelist, never freeform
        done   = check(result)           # deterministic success test

The model NEVER runs commands it invents. It picks from actions you wrote,
by name, exactly like ai_curate.py picks labels but can't invent OSC paths.
forest-ai.py is the one-shot version; an agent is that plus the loop.

## Create — the recipe (sized for 3-4B CPU models)

1. Start from forest-ai.py's helpers (ensure_server, pick_model, ask).
2. Define the whitelist as plain functions with names and one-line
   descriptions. 5-8 actions max — small models choose badly from long menus.
3. The prompt each turn: rig facts + current scan + action menu + "reply with
   JSON {\"action\": name, \"why\": one sentence}". Use format=json.
4. Validate the choice: unknown action = treat as "do nothing", count it.
5. Hard caps: MAX_STEPS (5-10), per-action timeout, and never two destructive
   actions in a row without a fresh scan between them.
6. Destructive or irreversible actions (delete, overwrite, anything with the
   norns) get a confirm() prompt to the human, always.

## Start

- Foreground (normal): `python tools/forest-ai/<agent>.py` in a terminal —
  you watch it think, Ctrl+C ends it.
- Background: `Invoke-CimMethod -ClassName Win32_Process -MethodName Create
  -Arguments @{CommandLine='cmd /c python <agent>.py --log D:\...\agent.log'}`
  (detached, survives the shell). Log everything; you can't see stderr.
- On a schedule: Task Scheduler pointing at the script (same pattern as
  D:\ollama\serve.cmd).

## Stop

- Foreground: Ctrl+C.
- Background: `taskkill /f /pid <pid>` (log the pid at startup!).
- Design stops in: MAX_STEPS always; also check for a stop file each loop —
  `if os.path.exists("STOP")` — so `echo.> STOP` halts any running agent
  without hunting pids. Delete the file to re-arm.

## "Train" — what actually improves it (no GPU needed)

You do not train weights on this laptop. You train the SYSTEM, in this order
of payoff:

1. Knowledge: add/fix markdown in kb/ and the vault (add-knowledge.md).
   The model quotes; better notes = better agent.
2. Prompts: tighten the system prompt and action descriptions. One good
   example of a correct decision in the prompt ("few-shot") beats paragraphs
   of instructions for small models.
3. Evals: every bad decision becomes a line in kb/evals.jsonl. The benchmark
   is the regression test for prompts, knowledge, AND future models.
4. Modelfile (optional): bake a system prompt + params into a named model:
       FROM gemma3:4b
       SYSTEM you are the dspm rig medic. reply only with JSON...
       PARAMETER temperature 0.2
   then `ollama create rig-medic -f Modelfile` → use model "rig-medic".
   It's a preset, not training — but it survives model swaps as a text file.
5. Real fine-tuning (later, if ever): needs a GPU (rented is fine). The
   journal is already collecting question→correct-answer pairs; that's the
   dataset. Judge any fine-tune with the same evals.jsonl — no vibes.
