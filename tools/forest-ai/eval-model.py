#!/usr/bin/env python3
"""eval-model -- score local models on the rig Q&A benchmark (kb/evals.jsonl).

Each question is asked exactly the way forest-ai.py asks (same system prompt,
same rig-knowledge injection, temperature 0), then scored on whether the
expected facts appear in the answer. Appends results to kb/eval-results.md.

Usage:
    python eval-model.py                     # every installed model
    python eval-model.py --model gemma3:4b   # just one
"""

import argparse
import datetime
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OLLAMA = "http://127.0.0.1:11434"
SERVE_CMD = r"D:\ollama\serve.cmd"


def ensure_server():
    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=3):
            return
    except OSError:
        pass
    print("ollama is down -- restarting it ...", file=sys.stderr)
    flags = (getattr(subprocess, "DETACHED_PROCESS", 0)
             | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
             | getattr(subprocess, "CREATE_NO_WINDOW", 0))
    subprocess.Popen(["cmd", "/c", SERVE_CMD], creationflags=flags,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL)
    for _ in range(30):
        time.sleep(1)
        try:
            with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=3):
                return
        except OSError:
            continue
    sys.exit("couldn't bring ollama up -- check D:\\ollama\\serve.log")

SYSTEM = """You are the field assistant for a LAN-only audio-art rig in the
woods (no internet). You are given the rig documentation. Answer the
performer's question concretely with exact commands, addresses, and actions
from the documentation. Be brief."""


def api(path, body=None, timeout=600):
    req = urllib.request.Request(
        OLLAMA + path,
        data=json.dumps(body).encode() if body else None,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def score(answer, case):
    a = answer.lower()
    ok_all = all(k.lower() in a for k in case.get("expect_all", []))
    any_list = case.get("expect_any", [])
    ok_any = (not any_list) or any(k.lower() in a for k in any_list)
    return ok_all and ok_any


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", action="append", help="model(s) to test; default all installed")
    args = ap.parse_args()

    with open(os.path.join(HERE, "rig-knowledge.md"), encoding="utf-8") as f:
        knowledge = f.read()
    cases = []
    with open(os.path.join(HERE, "kb", "evals.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                cases.append(json.loads(line))

    ensure_server()
    installed = [m["name"] for m in api("/api/tags")["models"]]
    models = args.model or installed
    print("benchmark: %d questions x %s\n" % (len(cases), ", ".join(models)))

    rows = []
    for model in models:
        passed, times = 0, []
        for i, case in enumerate(cases, 1):
            prompt = ("RIG DOCUMENTATION:\n%s\n\nPERFORMER'S QUESTION: %s"
                      % (knowledge, case["q"]))
            t0 = time.time()
            answer = None
            for attempt in (1, 2):  # server crashes sometimes; heal + retry once
                try:
                    r = api("/api/generate", {
                        "model": model, "system": SYSTEM, "prompt": prompt,
                        "stream": False,
                        "options": {"num_ctx": 8192, "temperature": 0}})
                    answer = r.get("response", "")
                    break
                except Exception as e:
                    answer = "(error: %s)" % e
                    if attempt == 1:
                        ensure_server()
            dt = time.time() - t0
            times.append(dt)
            ok = score(answer, case)
            passed += ok
            print("  [%s] q%d %-4s %5.1fs  %s" % (
                model, i, "PASS" if ok else "FAIL", dt, case["q"][:60]))
            if not ok:
                print("        answer was: %s" % " ".join(answer.split())[:160])
        rows.append((model, passed, len(cases), sum(times) / len(times)))
        print()

    print("%-28s %7s %10s" % ("model", "score", "avg sec/q"))
    for model, p, n, avg in rows:
        print("%-28s %4d/%-2d %10.1f" % (model, p, n, avg))

    stamp = datetime.date.today().isoformat()
    with open(os.path.join(HERE, "kb", "eval-results.md"), "a", encoding="utf-8") as f:
        for model, p, n, avg in rows:
            f.write("| %s | %s | %d/%d | %.1f s/q |\n" % (stamp, model, p, n, avg))


if __name__ == "__main__":
    main()
