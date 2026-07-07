#!/usr/bin/env python3
"""forest-ai -- offline troubleshooting assistant for the DSPM woods rig.

Feeds the local Ollama model three things: the rig knowledge file, a LIVE
network scan (current Wi-Fi, laptop IP, norns/router pings, bridge port,
NORNS_HOST), and your question. The model doesn't need to know anything;
it gets told the facts and the symptoms. Zero internet, zero pip deps.

It also searches a local mirror of the Obsidian vault (D:\\forest-vault,
refresh with sync-vault.ps1) and injects the most relevant notes.

Usage:
    python forest-ai.py                      # scan + "what's wrong with my rig?"
    python forest-ai.py "phones load the UI but pads do nothing"
    python forest-ai.py --no-scan "how do I make a controller for a new script?"
    python forest-ai.py --scan-only          # just print the diagnostics, no AI
    python forest-ai.py --notes-only "eyesy" # show what the vault search returns
    python forest-ai.py --model gemma3:4b "..."
"""

import argparse
import datetime
import json
import math
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request

# vault notes are full of unicode the Windows console can't always print
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
KNOWLEDGE = os.path.join(HERE, "rig-knowledge.md")
VAULT = os.environ.get("FOREST_VAULT", r"D:\forest-vault")
KB = os.path.join(HERE, "kb")
JOURNAL = os.path.join(KB, "journal")
VAULT_BUDGET = 5000  # max chars of vault notes injected into the prompt
OLLAMA = "http://127.0.0.1:11434"
NORNS_IP = "192.168.8.180"
ROUTER_IP = "192.168.8.1"
BRIDGE_PORT = 8081
# FOREST_MODEL always wins -- the knob for adopting a new model everywhere
PREFERRED_MODELS = [m for m in [os.environ.get("FOREST_MODEL"),
                                "gemma3:4b", "qwen2.5-coder:3b"] if m]

SYSTEM = """You are the field assistant for a LAN-only audio-art rig in the
woods (no internet). You are given the rig documentation, a live diagnostic
scan, and sometimes excerpts from the performer's own notes. Answer the
performer's question concretely. For a fault: name the most likely cause
first, then the exact command or physical action to fix it, trusting the scan
over assumptions. For a how-to or planning question: give the concrete steps
or facts, preferring what the performer's own notes say. Cite which note an
answer came from when you use one. Be brief -- they are standing in a
forest."""

STOPWORDS = frozenset("""a an and are as at be but by can do does for from has
have how i in is it its my of on or the to was what when where which why with
you your""".split())


def _chunk_file(path, max_chars=1500):
    """Split a markdown file into heading-bounded chunks of sane size."""
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            text = f.read()
    except OSError:
        return []
    parts = re.split(r"(?m)^(?=#{1,3} )", text)
    chunks = []
    for part in parts:
        part = part.strip()
        while len(part) > max_chars:
            cut = part.rfind("\n\n", 0, max_chars)
            cut = cut if cut > 200 else max_chars
            chunks.append(part[:cut].strip())
            part = part[cut:].strip()
        if part:
            chunks.append(part)
    return chunks


def _terms(text):
    return [w for w in re.findall(r"[a-z0-9]{2,}", text.lower())
            if w not in STOPWORDS]


def vault_search(question, budget=VAULT_BUDGET):
    """Tiny BM25-ish retrieval over the kb and the vault mirror."""
    roots = [("kb", KB), ("vault", VAULT)]
    qterms = set(_terms(question))
    if not qterms:
        return []

    docs = []  # (relpath, chunk_text, term_counts)
    for tag, top in roots:
        if not os.path.isdir(top):
            continue
        for root, dirs, files in os.walk(top):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for name in files:
                if not name.endswith(".md"):
                    continue
                rel = tag + ":" + os.path.relpath(os.path.join(root, name), top)
                fname_terms = set(_terms(name))
                for chunk in _chunk_file(os.path.join(root, name)):
                    counts = {}
                    for t in _terms(chunk):
                        if t in qterms:
                            counts[t] = counts.get(t, 0) + 1
                    # filename hits count even if the body doesn't repeat the word
                    for t in qterms & fname_terms:
                        counts[t] = counts.get(t, 0) + 3
                    if counts:
                        docs.append((rel, chunk, counts))
    if not docs:
        return []

    df = {}
    for _, _, counts in docs:
        for t in counts:
            df[t] = df.get(t, 0) + 1
    n = len(docs)

    def score(item):
        rel, chunk, counts = item
        s = sum(math.log((n + 1) / (1 + df[t])) * min(tf, 3)
                for t, tf in counts.items())
        return s / math.log(len(chunk) + 60)  # mild long-chunk penalty

    picked, used = [], 0
    for rel, chunk, _ in sorted(docs, key=score, reverse=True):
        if used + len(chunk) > budget and picked:
            break
        picked.append((rel, chunk[:budget - used]))
        used += len(chunk)
        if used >= budget or len(picked) >= 6:
            break
    return picked


def run(cmd, timeout=10):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return out.stdout.strip()
    except Exception as e:
        return "(failed: %s)" % e


def ping(host):
    out = run(["ping", "-n", "1", "-w", "1500", host])
    return "OK" if "TTL=" in out else "UNREACHABLE"


def port_open(host, port):
    try:
        with socket.create_connection((host, port), timeout=2):
            return "OPEN"
    except OSError:
        return "CLOSED"


def current_ssid():
    out = run(["netsh", "wlan", "show", "interfaces"])
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("SSID") and "BSSID" not in line:
            return line.split(":", 1)[1].strip() or "(not connected)"
    return "(no wifi interface?)"


def lan_ip():
    # UDP connect trick: no packet sent, just picks the outbound interface
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect((ROUTER_IP, 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "(unknown)"


def scan():
    ssid = current_ssid()
    lines = [
        "current wifi SSID: %s%s"
        % (ssid, "" if ssid == "GL-SFT1200-9b3" else "   <-- NOT the show router!"),
        "laptop IP (toward router): %s" % lan_ip(),
        "router %s: %s" % (ROUTER_IP, ping(ROUTER_IP)),
        "norns %s: %s" % (NORNS_IP, ping(NORNS_IP)),
        "bridge port %d on localhost: %s" % (BRIDGE_PORT, port_open("127.0.0.1", BRIDGE_PORT)),
        "NORNS_HOST env: %s" % (os.environ.get("NORNS_HOST") or "(unset -- bridge would default to 10.42.0.1!)"),
    ]
    return "\n".join(lines)


SERVE_CMD = r"D:\ollama\serve.cmd"


def ensure_server():
    """Ollama crashes occasionally; in the field, self-heal instead of erroring."""
    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=3):
            return True
    except OSError:
        pass
    if not os.path.exists(SERVE_CMD):
        sys.exit("Ollama isn't running and %s is missing." % SERVE_CMD)
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
                return True
        except OSError:
            continue
    sys.exit("couldn't bring ollama up -- check D:\\ollama\\serve.log")


def pick_model(explicit):
    ensure_server()
    if explicit:
        return explicit
    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=3) as r:
            have = [m["name"] for m in json.load(r)["models"]]
    except OSError:
        sys.exit("Ollama isn't responding after restart.")
    for m in PREFERRED_MODELS:
        if m in have:
            return m
    if have:
        return have[0]
    sys.exit("No models pulled. Run: ollama pull gemma3:4b")


def ask(model, prompt, system=SYSTEM):
    body = json.dumps({
        "model": model,
        "system": system,
        "prompt": prompt,
        "stream": True,
        "options": {"num_ctx": 8192, "temperature": 0.3},
    }).encode()
    req = urllib.request.Request(OLLAMA + "/api/generate", data=body,
                                 headers={"Content-Type": "application/json"})
    pieces = []
    with urllib.request.urlopen(req, timeout=600) as r:
        for line in r:
            chunk = json.loads(line)
            piece = chunk.get("response", "")
            pieces.append(piece)
            sys.stdout.write(piece)
            sys.stdout.flush()
    print()
    return "".join(pieces)


def save_journal(question, answer, model):
    os.makedirs(JOURNAL, exist_ok=True)
    slug = "-".join(_terms(question)[:6]) or "note"
    date = datetime.date.today().isoformat()
    path = os.path.join(JOURNAL, "%s-%s.md" % (date, slug[:48]))
    n = 1
    while os.path.exists(path):
        n += 1
        path = os.path.join(JOURNAL, "%s-%s-%d.md" % (date, slug[:48], n))
    with open(path, "w", encoding="utf-8") as f:
        f.write("# %s\n\n(journaled %s, answered by %s -- verify before trusting)\n\n%s\n"
                % (question, date, model, answer))
    print("saved -> %s" % os.path.relpath(path, HERE), file=sys.stderr)


def organize(model):
    """Ask the model to propose how to fold journal notes into topics."""
    notes = []
    if os.path.isdir(JOURNAL):
        for name in sorted(os.listdir(JOURNAL)):
            if name.endswith(".md") and name != "ORGANIZE-PROPOSAL.md":
                with open(os.path.join(JOURNAL, name), encoding="utf-8") as f:
                    body = f.read()
                notes.append("FILE %s:\n%s" % (name, body[:600]))
    if not notes:
        sys.exit("journal is empty -- nothing to organize")
    system = ("You are organizing a personal knowledge base. Given journal "
              "notes, group them into topics. For each topic say: a title, "
              "which files belong to it, whether it should be promoted to a "
              "permanent procedure or stay as a note or be deleted as "
              "superseded, and a 2-3 sentence merged summary. Plain markdown.")
    prompt = ("%d journal notes follow.\n\n%s\n\nPropose the organization now."
              % (len(notes), "\n\n".join(notes)))
    print("[%s] organizing %d notes ..." % (model, len(notes)), file=sys.stderr)
    proposal = ask(model, prompt, system=system)
    out = os.path.join(JOURNAL, "ORGANIZE-PROPOSAL.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write("# Organize proposal (%s, by %s)\n\nApply by hand -- the model "
                "proposes, the human files.\n\n%s\n"
                % (datetime.date.today().isoformat(), model, proposal))
    print("proposal -> %s" % os.path.relpath(out, HERE), file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("question", nargs="*", help="what's happening / what you want to do")
    ap.add_argument("--model", help="ollama model override")
    ap.add_argument("--no-scan", action="store_true", help="skip the network scan")
    ap.add_argument("--no-vault", action="store_true", help="skip the vault search")
    ap.add_argument("--scan-only", action="store_true", help="print diagnostics and exit")
    ap.add_argument("--notes-only", action="store_true",
                    help="print the retrieved vault notes and exit")
    ap.add_argument("--save", action="store_true",
                    help="journal this Q&A into kb/journal/ for future retrieval")
    ap.add_argument("--organize", action="store_true",
                    help="propose folding journal notes into topics")
    args = ap.parse_args()

    if args.organize:
        organize(pick_model(args.model))
        return

    question = " ".join(args.question) or \
        "Given the scan, is the rig healthy? If not, what do I fix first?"

    if args.notes_only:
        for rel, chunk in vault_search(question):
            print("=== %s ===\n%s\n" % (rel, chunk))
        return

    diag = None
    if not args.no_scan:
        print("scanning rig ...", file=sys.stderr)
        diag = scan()
        print(diag + "\n", file=sys.stderr)
    if args.scan_only:
        return

    notes = [] if args.no_vault else vault_search(question)
    if notes:
        print("vault notes: " + ", ".join(rel for rel, _ in notes) + "\n",
              file=sys.stderr)

    with open(KNOWLEDGE, encoding="utf-8") as f:
        knowledge = f.read()

    prompt = "RIG DOCUMENTATION:\n%s\n" % knowledge
    if diag:
        prompt += "\nLIVE DIAGNOSTIC SCAN (just now):\n%s\n" % diag
    for rel, chunk in notes:
        prompt += "\nPERFORMER'S NOTE (%s):\n%s\n" % (rel, chunk)
    prompt += "\nPERFORMER'S QUESTION: %s" % question

    model = pick_model(args.model)
    print("[%s]" % model, file=sys.stderr)
    answer = ask(model, prompt)
    if args.save and answer.strip():
        save_journal(question, answer, model)


if __name__ == "__main__":
    main()
