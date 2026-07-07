#!/usr/bin/env python3
"""session-infographic -- offline Instagram carousel from a recorded session.

Rebuilds the 4-slide dspm archive infographic set (hero / sound / crowd /
anatomy, 1080x1080 Frutiger Aero glass) from a sessions/session_*/ directory.
All numbers and geometry are computed deterministically from the logs; the
LOCAL Ollama model is only asked for the short caption lines, with hard length
caps and deterministic fallbacks -- a hallucination can mis-phrase a caption
but never bend a statistic. Zero pip deps, zero internet.

Usage:
    python session-infographic.py sessions/session_2026-06-20T23-34-45-773Z
    python session-infographic.py <dir> -o out/ --title "dspm-3" --no-ai
    python session-infographic.py <dir> --png     # also rasterize (headless Edge)
"""

import argparse
import json
import math
import os
import re
import subprocess
import sys
import urllib.request
from collections import Counter, defaultdict

OLLAMA = "http://127.0.0.1:11434"
PREFERRED_MODELS = [m for m in [os.environ.get("FOREST_MODEL"),
                                "gemma3:4b", "qwen2.5-coder:3b"] if m]

# ---------------------------------------------------------------- analysis --

def load_jsonl(path):
    out = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return out


def voice_of(channel):
    for p in channel.split("/"):
        if len(p) == 2 and p[0] == "v" and p[1].isdigit():
            return p
    return None


def fmt_t(seconds):
    m, s = divmod(int(seconds), 60)
    return "%d:%02d" % (m, s)


def analyze(session_dir):
    manifest = {}
    mpath = os.path.join(session_dir, "manifest.json")
    if os.path.exists(mpath):
        with open(mpath, encoding="utf-8") as f:
            manifest = json.load(f)

    phone = load_jsonl(os.path.join(session_dir, "phone_events.jsonl"))
    rec = manifest.get("recording", {})
    start_t, end_t = rec.get("start_t"), rec.get("end_t")

    def in_window(t):
        return True if start_t is None else (start_t <= t <= end_t)

    discrete_set = {ch for ch, meta in manifest.get("channels", {}).items()
                    if meta.get("type") == "discrete"}

    touches = [e for e in phone if e.get("type") == "touch" and in_window(e.get("t", 0))]
    clients, voices, density = Counter(), Counter(), defaultdict(int)
    discrete = []
    t0 = start_t if start_t is not None else (touches[0]["t"] if touches else 0)
    for e in touches:
        clients[e.get("client")] += 1
        v = voice_of(e.get("channel", ""))
        if v:
            voices[v] += 1
        if e.get("channel") in discrete_set:
            discrete.append((e["t"] - t0, e["channel"], e.get("value"), e.get("client")))
        density[int((e["t"] - t0) // 30)] += 1

    dur = (end_t - start_t) if start_t is not None else \
          ((touches[-1]["t"] - t0) if touches else 0)
    all_phones = len({e.get("client") for e in phone if e.get("type") == "touch"})

    return {
        "session_id": manifest.get("session_id",
                                   os.path.basename(session_dir.rstrip("/\\"))),
        "name": rec.get("name"),
        "date": (lambda m: m.group(0).replace("-", " · ") if m else "")(
            re.search(r"\d{4}-\d{2}-\d{2}",
                      manifest.get("session_id", "") or
                      os.path.basename(session_dir.rstrip("/\\")))),
        "duration": dur,
        "clients": clients, "voices": voices, "density": dict(density),
        "discrete": sorted(discrete), "n_touches": len(touches),
        "all_phones": all_phones,
    }

# ------------------------------------------------------------------- model --

def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def cap(s, n):
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"


def ai_captions(a, model):
    """Ask the local model for caption lines only. Any failure -> {}."""
    lead, lead_n = (a["clients"].most_common(1) or [("", 0)])[0]
    facts = {
        "performance_name": a["name"] or a["session_id"],
        "duration": fmt_t(a["duration"]),
        "performers": len(a["clients"]),
        "total_gestures": a["n_touches"],
        "voice_gestures": dict(a["voices"]),
        "lead_performer_share_pct": round(100 * lead_n / max(1, a["n_touches"])),
        "n_discrete_edits": len(a["discrete"]),
    }
    system = ("You write tiny captions for an art-performance infographic. "
              "Given facts, return ONLY JSON: {\"hero_footer\":..., \"sound_sub\":..., "
              "\"sound_footer\":..., \"crowd_sub\":..., \"crowd_footer\":..., "
              "\"anatomy_sub\":...}. Each value one plain sentence under 70 "
              "characters, lowercase-friendly, no exclamation marks, no emoji. "
              "Be concrete and specific to the facts -- no marketing words "
              "(mesmerizing, captivating, immersive). Never state numbers "
              "other than the ones given.")
    body = json.dumps({"model": model, "system": system,
                       "prompt": json.dumps(facts), "stream": False,
                       "format": "json", "options": {"temperature": 0.6}}).encode()
    req = urllib.request.Request(OLLAMA + "/api/generate", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            out = json.loads(json.load(r)["response"])
        return {k: cap(v, 70) for k, v in out.items() if isinstance(v, str)}
    except Exception as e:
        print("(ai captions skipped: %s)" % e, file=sys.stderr)
        return {}


def pick_model():
    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=3) as r:
            have = [m["name"] for m in json.load(r)["models"]]
        for m in PREFERRED_MODELS:
            if m in have:
                return m
        return have[0] if have else None
    except OSError:
        return None

# ------------------------------------------------------------------ slides --

DEFS = """  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stop-color="#c7ecff"/><stop offset="0.42" stop-color="#d8f3ef"/>
      <stop offset="0.72" stop-color="#e6f7cf"/><stop offset="1" stop-color="#cdeeb0"/>
    </linearGradient>
    <radialGradient id="topglow" cx="0.5" cy="-0.1" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.78"/>
      <stop offset="0.48" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.46"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="limebead" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f3ffd6"/><stop offset="0.5" stop-color="#d6f29a"/>
      <stop offset="0.51" stop-color="#b6e36a"/><stop offset="1" stop-color="#9fd64f"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f3ffd6"/><stop offset="0.5" stop-color="#cdeb8e"/>
      <stop offset="0.51" stop-color="#9fd64f"/><stop offset="1" stop-color="#6fc02f"/>
    </linearGradient>
    <linearGradient id="bardim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eafbff"/><stop offset="0.51" stop-color="#bfe6ff"/>
      <stop offset="1" stop-color="#8fd0ea"/>
    </linearGradient>
    <radialGradient id="hero" cx="0.5" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#f3ffd6"/><stop offset="0.5" stop-color="#b6e36a"/>
      <stop offset="1" stop-color="#6fc02f"/>
    </radialGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fd64f" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#2bb3c0" stop-opacity="0.35"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="22" flood-color="#145070" flood-opacity="0.20"/>
    </filter>
    <filter id="softsm" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#145070" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="1080" height="1080" fill="url(#sky)"/>
  <rect width="1080" height="1080" fill="url(#topglow)"/>"""

FONT = 'font-family="Segoe UI, -apple-system, Helvetica Neue, Arial, sans-serif"'


def svg(label, body):
    return ('<svg width="1080" height="1080" viewBox="0 0 1080 1080" '
            'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="%s">\n%s\n'
            '  <g %s>\n%s\n  </g>\n</svg>\n' % (esc(label), DEFS, FONT, body))


def header(title, heading, sub):
    return """    <text x="90" y="150" font-size="40" font-weight="600" fill="#1f8a4c" letter-spacing="4">%s</text>
    <text x="90" y="232" font-size="76" font-weight="700" fill="#133b46">%s</text>
    <text x="90" y="288" font-size="30" fill="#5a7884">%s</text>""" % (
        esc(title), esc(heading), esc(sub))


def slide_hero(a, title, captions):
    tsize = min(200, int(1500 / max(1, len(title))))
    footer = captions.get("hero_footer") or \
        "%d phones connected · 6-voice barcode looper on norns · driven from the crowd" % a["all_phones"]
    body = """    <rect x="90" y="120" width="900" height="840" rx="44" fill="url(#glass)" stroke="#ffffff" stroke-opacity="0.85" stroke-width="2" filter="url(#soft)"/>
    <rect x="104" y="134" width="872" height="150" rx="34" fill="url(#gloss)" opacity="0.55"/>
    <rect x="150" y="186" width="190" height="48" rx="24" fill="url(#limebead)" stroke="#ffffff" stroke-opacity="0.9"/>
    <text x="245" y="218" text-anchor="middle" font-size="24" font-weight="600" fill="#133b46" letter-spacing="3">ARCHIVE</text>
    <text x="930" y="220" text-anchor="end" font-size="26" fill="#5a7884" letter-spacing="1">%s</text>
    <text x="540" y="430" text-anchor="middle" font-size="%d" font-weight="700" fill="#133b46" letter-spacing="-4">%s</text>
    <text x="540" y="500" text-anchor="middle" font-size="34" fill="#1f8a4c" letter-spacing="6" font-weight="600">LIVE LOOPER PERFORMANCE</text>
    <line x1="180" y1="560" x2="900" y2="560" stroke="#3a9d4e" stroke-opacity="0.35" stroke-width="2"/>
    <g text-anchor="middle">
      <text x="270" y="720" font-size="110" font-weight="700" fill="#133b46">%s</text>
      <text x="270" y="772" font-size="28" fill="#5a7884" letter-spacing="2">duration</text>
      <text x="540" y="720" font-size="110" font-weight="700" fill="#133b46">%d</text>
      <text x="540" y="772" font-size="28" fill="#5a7884" letter-spacing="2">performers</text>
      <text x="810" y="720" font-size="110" font-weight="700" fill="#133b46">%s</text>
      <text x="810" y="772" font-size="28" fill="#5a7884" letter-spacing="2">gestures</text>
    </g>
    <line x1="180" y1="828" x2="900" y2="828" stroke="#3a9d4e" stroke-opacity="0.35" stroke-width="2"/>
    <text x="540" y="900" text-anchor="middle" font-size="28" fill="#5a7884">%s</text>""" % (
        esc(a["date"]), tsize, esc(title), fmt_t(a["duration"]),
        len(a["clients"]), "{:,}".format(a["n_touches"]), esc(footer))
    return svg("%s performance hero card" % title, body)


def slide_voices(a, title, captions):
    counts = [(("v%d" % i), a["voices"].get("v%d" % i, 0)) for i in range(1, 7)]
    active = sorted([c for c in counts if c[1] > 0], key=lambda x: -x[1])
    silent = [c for c in counts if c[1] == 0]
    mx = max((n for _, n in active), default=1)

    rows, y = [], 398
    for v, n in active[:5]:
        w = max(46, int(660 * n / mx))
        grad = "bar" if n >= 0.15 * mx else "bardim"
        rows.append("""      <text x="150" y="%d" font-size="40" font-weight="700" fill="#133b46">%s</text>
      <rect x="230" y="%d" width="660" height="46" rx="23" fill="#ffffff" fill-opacity="0.4" stroke="#ffffff" stroke-opacity="0.7"/>
      <rect x="230" y="%d" width="%d" height="46" rx="23" fill="url(#%s)" stroke="#ffffff" stroke-opacity="0.85"/>
      <text x="900" y="%d" text-anchor="end" font-size="34" font-weight="700" fill="#133b46">%d</text>""" % (
            y + 32, v, y, y, w, grad, y + 32, n))
        y += 90
    if silent:
        lbl = silent[0][0] if len(silent) == 1 else "%s–%s" % (silent[0][0], silent[-1][0])
        rows.append("""      <text x="150" y="%d" font-size="40" font-weight="700" fill="#9bb4bf">%s</text>
      <rect x="230" y="%d" width="660" height="46" rx="23" fill="#ffffff" fill-opacity="0.3" stroke="#ffffff" stroke-opacity="0.6"/>
      <text x="560" y="%d" text-anchor="middle" font-size="28" fill="#7a98a4" letter-spacing="3">silent</text>
      <text x="900" y="%d" text-anchor="end" font-size="34" font-weight="700" fill="#9bb4bf">0</text>""" % (
            y + 32, lbl, y, y + 32, y + 32))
        y += 90

    n_active = len(active)
    sub = captions.get("sound_sub") or ("Six looper voices. %s carried the set." %
          ("One" if n_active == 1 else str(n_active) if n_active > 2 else "Two"))
    top_ch = ", ".join("%s (%d)" % (v, n) for v, n in active[:2]) or "no voice gestures"
    footer = captions.get("sound_footer") or ("busiest: %s" % top_ch)
    body = header(title, "The sound", sub) + """
    <rect x="90" y="330" width="900" height="630" rx="44" fill="url(#glass)" stroke="#ffffff" stroke-opacity="0.85" stroke-width="2" filter="url(#soft)"/>
    <rect x="104" y="344" width="872" height="120" rx="34" fill="url(#gloss)" opacity="0.5"/>
    <g>
%s
    </g>
    <line x1="150" y1="876" x2="930" y2="876" stroke="#3a9d4e" stroke-opacity="0.3" stroke-width="2"/>
    <text x="150" y="928" font-size="28" fill="#5a7884">%s</text>""" % (
        "\n".join(rows), esc(footer))
    return svg("Voice activity for %s" % title, body)


def slide_crowd(a, title, captions):
    ranked = a["clients"].most_common()
    lead, lead_n = ranked[0] if ranked else ("?", 0)
    pct = round(100 * lead_n / max(1, a["n_touches"]))
    others = ranked[1:5]

    rows, y = [], 430
    for c, n in others:
        rows.append("""      <rect x="610" y="%d" width="380" height="78" rx="22" fill="url(#glass)" stroke="#ffffff" stroke-opacity="0.85" stroke-width="2" filter="url(#softsm)"/>
      <text x="640" y="%d" font-size="30" fill="#133b46" font-family="monospace">%s</text>
      <text x="960" y="%d" text-anchor="end" font-size="34" font-weight="700" fill="#1f8a4c">%d</text>""" % (
            y, y + 50, esc(cap(c, 11)), y + 50, n))
        y += 98

    npf = len(a["clients"])
    sub = captions.get("crowd_sub") or (
        "One phone, one instrument." if npf == 1 else
        "%d phones in the take — but one set led the dance." % npf)
    editors = {c for _, _, _, c in a["discrete"]}
    footer = cap(captions.get("crowd_footer") or (
        "%d record/clear/reverse edits · %d hands" % (len(a["discrete"]), len(editors))
        if a["discrete"] else "no destructive edits — pure modulation"), 42)
    body = header(title, "The crowd", sub) + """
    <circle cx="320" cy="600" r="200" fill="url(#hero)" stroke="#ffffff" stroke-width="6" filter="url(#soft)"/>
    <ellipse cx="320" cy="520" rx="150" ry="70" fill="url(#gloss)" opacity="0.5"/>
    <text x="320" y="585" text-anchor="middle" font-size="150" font-weight="700" fill="#1c5a2a">%d%%</text>
    <text x="320" y="660" text-anchor="middle" font-size="30" fill="#1f5a2c" letter-spacing="1">%s gestures</text>
    <text x="320" y="855" text-anchor="middle" font-size="30" fill="#5a7884">lead performer</text>
    <text x="320" y="895" text-anchor="middle" font-size="26" fill="#9bb4bf" font-family="monospace">%s</text>
    <g>
%s
    </g>
    <text x="610" y="858" font-size="26" fill="#5a7884">%s</text>""" % (
        pct, "{:,}".format(lead_n), esc(cap(lead, 14)), "\n".join(rows), esc(footer))
    return svg("The crowd for %s: lead performer drove %d%%" % (title, pct), body)


def slide_anatomy(a, title, captions):
    dur = max(1.0, a["duration"])
    buckets = a["density"]
    last_b = int(dur // 30)
    series = [(b * 30, buckets.get(b, 0)) for b in range(0, last_b + 1)]
    mx = max((n for _, n in series), default=1) or 1

    x0, x1, ybase, ytop = 130, 950, 780, 420
    def X(t):
        return x0 + (x1 - x0) * min(1.0, t / dur)
    def Y(n):
        return ybase - (ybase - ytop) * n / mx

    pts = "".join(" L%.0f,%.0f" % (X(t), Y(n)) for t, n in series)
    path = "M%d,%d%s L%d,%d Z" % (x0, ybase, pts, x1, ybase)

    peak_t, peak_n = max(series, key=lambda p: p[1])
    open_n = series[0][1]
    # finale = last bucket that actually had gestures, not a silent tail
    fin_t, fin_n = next(((t, n) for t, n in reversed(series) if n > 0), series[-1])

    callouts = []
    if a["discrete"]:
        t, ch, val, c = a["discrete"][0]
        callouts.append("▸ %s — first %s (%s)" % (fmt_t(t), ch.split("/")[-1], cap(c, 8)))
    callouts.append("▸ %s — climax, %d touches / 30s" % (fmt_t(peak_t), peak_n))
    if len(a["discrete"]) > 1:
        t, ch, val, c = a["discrete"][-1]
        callouts.append("▸ %s — last %s, bookend (%s)" % (fmt_t(t), ch.split("/")[-1], cap(c, 8)))
    callouts.append("▸ %s — end of take" % fmt_t(dur))
    cells = []
    for i, c in enumerate(callouts[:4]):
        cells.append('      <text x="%d" y="%d">%s</text>' %
                     (130 if i % 2 == 0 else 600, 888 if i < 2 else 924, esc(cap(c, 44))))

    sub = captions.get("anatomy_sub") or \
        ("Gesture density across %s minutes — where the room leaned in." %
         fmt_t(dur).split(":")[0])
    body = header(title, "Anatomy of the set", sub) + """
    <rect x="90" y="330" width="900" height="630" rx="44" fill="url(#glass)" stroke="#ffffff" stroke-opacity="0.85" stroke-width="2" filter="url(#soft)"/>
    <line x1="130" y1="780" x2="950" y2="780" stroke="#3a9d4e" stroke-opacity="0.4" stroke-width="2"/>
    <path d="%s" fill="url(#area)" stroke="#3a9d4e" stroke-opacity="0.6" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="%.0f" cy="%.0f" r="14" fill="#ffffff" stroke="#6fc02f" stroke-width="5"/>
    <rect x="%.0f" y="356" width="180" height="48" rx="24" fill="#ffffff" fill-opacity="0.92" stroke="#9fd64f" stroke-width="2"/>
    <text x="%.0f" y="388" text-anchor="middle" font-size="26" font-weight="700" fill="#1f5a2c">peak · %d</text>
    <circle cx="%d" cy="%.0f" r="10" fill="#ffffff" stroke="#2bb3c0" stroke-width="4"/>
    <text x="150" y="%.0f" font-size="24" fill="#147a86">open · %d</text>
    <circle cx="%.0f" cy="%.0f" r="10" fill="#ffffff" stroke="#2bb3c0" stroke-width="4"/>
    <text x="%.0f" y="%.0f" text-anchor="end" font-size="24" fill="#147a86">finale · %d</text>
    <g font-size="24" fill="#5a7884" text-anchor="middle">
      <text x="130" y="822">0:00</text>
      <text x="540" y="822">%s</text>
      <text x="950" y="822">%s</text>
    </g>
    <g font-size="25" fill="#133b46">
%s
    </g>""" % (
        path,
        X(peak_t), Y(peak_n),
        min(max(130, X(peak_t) - 90), 810), min(max(220, X(peak_t)), 900), peak_n,
        x0, Y(open_n), max(430, Y(open_n) - 28), open_n,
        X(fin_t), Y(fin_n), 940, max(430, Y(fin_n) - 24), fin_n,
        fmt_t(dur / 2), fmt_t(dur),
        "\n".join(cells))
    return svg("Anatomy of the set for %s" % title, body)

# -------------------------------------------------------------------- main --

def find_browser():
    for p in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Google\Chrome\Application\chrome.exe"):
        if os.path.exists(p):
            return p
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("session_dir")
    ap.add_argument("-o", "--out", help="output dir (default infographics/<session>/)")
    ap.add_argument("--title", help="display title (default recording name)")
    ap.add_argument("--no-ai", action="store_true", help="deterministic captions only")
    ap.add_argument("--png", action="store_true", help="also rasterize via headless Edge/Chrome")
    args = ap.parse_args()

    a = analyze(args.session_dir)
    if not a["n_touches"]:
        sys.exit("no touch events in the recording window of %s" % args.session_dir)
    title = args.title or a["name"] or a["session_id"]

    captions = {}
    if not args.no_ai:
        model = pick_model()
        if model:
            print("captions from [%s] ..." % model, file=sys.stderr)
            captions = ai_captions(a, model)
        else:
            print("(ollama not running -- deterministic captions)", file=sys.stderr)

    out = args.out or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "infographics",
        re.sub(r"[^\w.-]+", "_", a["session_id"]))
    out = os.path.abspath(out)
    os.makedirs(out, exist_ok=True)

    slides = {
        "slide1-hero.svg": slide_hero(a, title, captions),
        "slide2-voices.svg": slide_voices(a, title, captions),
        "slide3-crowd.svg": slide_crowd(a, title, captions),
        "slide4-anatomy.svg": slide_anatomy(a, title, captions),
    }
    for name, content in slides.items():
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            f.write(content)
        print("  " + os.path.join(out, name))

    if args.png:
        browser = find_browser()
        if not browser:
            sys.exit("no Edge/Chrome found for rasterizing")
        for name in slides:
            png = os.path.join(out, name.replace(".svg", ".png"))
            subprocess.run([browser, "--headless", "--disable-gpu",
                            "--force-device-scale-factor=1", "--window-size=1080,1080",
                            "--default-background-color=00000000",
                            "--screenshot=" + png, os.path.join(out, name)],
                           capture_output=True, timeout=60)
            print("  " + png)


if __name__ == "__main__":
    main()
