"""
build_dspm_visuals.py — builds the dspm-archive generative visual engine inside
TouchDesigner.

WHY A SCRIPT:  TouchDesigner .toe/.tox files are binary, so a network can't be
hand-authored as text outside the app. Instead this script, run once inside TD,
constructs the whole operator network programmatically. It is idempotent: run it
again and it rebuilds /dspm from scratch.

HOW TO RUN (inside TouchDesigner):
  1. New project. Put this repo's `touchdesigner/` folder somewhere TD can read.
  2. Create a Text DAT, set its `File` parameter to this file (or paste the code),
     turn ON "Load on Start" off — then right-click the DAT > "Run Script".
     (Or, in the Textport:  run("/path/to/build_dspm_visuals.py", asParameters=True)
      — simplest is to paste into a Text DAT and Run Script.)
  3. Read the printed CHECKLIST at the end and finish the 3 device hookups
     (audio driver, MIDI device, OSC port) — those are environment-specific.

WHAT IT BUILDS  (/dspm):
  AUDIO    Overbridge audio in  -> band analysis (low/mid/high/rms)
  MIDI     MIDI interface + Rytm USB + hub MIDI -> normalised knobs/notes
  OSC      crowd / hub OSC (the dspm bridge) -> control channels
  CONTROL  performer macro parameters (+ a touch-slider panel) -> `master` CHOP
  GEN      generative.frag GLSL field + feedback/trails
  POST     post.frag (chromatic aberration, vignette, grade) + bloom
  OUT      final null + a fullscreen Window COMP for the projector/screen

Signal flow, knob map and OSC addresses are documented in control-map.md.
"""

import os

# --------------------------------------------------------------------------
# config — tweak these, then run.
# --------------------------------------------------------------------------
ROOT_NAME   = 'dspm'
RES_W, RES_H = 1280, 720          # render resolution of the generative engine
OSC_PORT    = 7000                # TD listens here; point a sender / bridge fan-out at it
SHADER_DIR  = ''                  # '' = auto-detect next to this script; else absolute path

# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
parent_comp = op('/')


def _shader_dir():
    if SHADER_DIR:
        return SHADER_DIR
    # this DAT's own file path, if run from a Text DAT pointing at the file
    try:
        here = me.par.file.eval()            # noqa: F821  (TD global `me`)
        if here:
            return os.path.join(os.path.dirname(here), 'shaders')
    except Exception:
        pass
    return os.path.join(project.folder, 'shaders')   # noqa: F821 (TD global `project`)


def make(parentOp, optype, name, x=0, y=0):
    """Create (or replace) a child op and position it for a readable network."""
    existing = parentOp.op(name)
    if existing:
        existing.destroy()
    n = parentOp.create(optype, name)
    n.nodeX, n.nodeY = x, y
    return n


def wire(src, dst, dstIndex=0):
    dst.inputConnectors[dstIndex].connect(src)


def setpar(o, **kw):
    """Set parameters defensively — a wrong name on one TD version won't abort."""
    for k, v in kw.items():
        try:
            o.par[k] = v
        except Exception as e:
            print('  ! could not set %s.%s = %r (%s)' % (o.path, k, v, e))


def setexpr(o, par, expr):
    try:
        o.par[par].expr = expr
    except Exception as e:
        print('  ! could not set expr %s.%s = %r (%s)' % (o.path, par, expr, e))


# --------------------------------------------------------------------------
# (re)build root
# --------------------------------------------------------------------------
if parent_comp.op(ROOT_NAME):
    parent_comp.op(ROOT_NAME).destroy()
root = make(parent_comp, baseCOMP, ROOT_NAME, 0, 0)        # noqa: F821
print('Building /%s ...' % ROOT_NAME)

AUDIO   = make(root, baseCOMP, 'AUDIO',   0,    600)        # noqa: F821
MIDI    = make(root, baseCOMP, 'MIDI',    0,    400)        # noqa: F821
OSC     = make(root, baseCOMP, 'OSC',     0,    200)        # noqa: F821
CONTROL = make(root, baseCOMP, 'CONTROL', 0,    0)          # noqa: F821
GEN     = make(root, baseCOMP, 'GEN',     400,  300)        # noqa: F821
POST    = make(root, baseCOMP, 'POST',    700,  300)        # noqa: F821
OUT     = make(root, baseCOMP, 'OUT',     1000, 300)        # noqa: F821


# ==========================================================================
# AUDIO  — Overbridge audio in -> low/mid/high/rms
# ==========================================================================
adin = make(AUDIO, audiodeviceinCHOP, 'adin', 0, 200)       # noqa: F821
setpar(adin, driver='ASIO')   # Overbridge presents an ASIO/audio device; set device in UI

# overall RMS
rms_an = make(AUDIO, analyzeCHOP, 'rms_analyze', 200, 400)   # noqa: F821
setpar(rms_an, function='rmspower')
wire(adin, rms_an)

# three bands via audiofilter -> RMS
bands = [('low', 'lowpass', 200.0), ('mid', 'bandpass', 1000.0), ('high', 'highpass', 3000.0)]
band_nulls = []
for i, (nm, ftype, freq) in enumerate(bands):
    flt = make(AUDIO, audiofilterCHOP, 'flt_%s' % nm, 200, 200 - i * 150)   # noqa: F821
    setpar(flt, filter=ftype, cutofflog=freq)
    wire(adin, flt)
    an = make(AUDIO, analyzeCHOP, 'an_%s' % nm, 400, 200 - i * 150)         # noqa: F821
    setpar(an, function='rmspower')
    wire(flt, an)
    band_nulls.append((nm, an))

merge = make(AUDIO, mergeCHOP, 'merge', 600, 250)            # noqa: F821
for nm, an in band_nulls:
    wire(an, merge)
wire(rms_an, merge)

# rename channels to low/mid/high/rms, smooth, scale, and clamp to ~0..1
ren = make(AUDIO, renameCHOP, 'rename', 750, 250)           # noqa: F821
setpar(ren, renamefrom='*', renameto='low mid high rms')
wire(merge, ren)
lag = make(AUDIO, lagCHOP, 'lag', 880, 250)                 # noqa: F821
setpar(lag, lag1=0.04, lag2=0.18)        # fast attack, slower release = punchy but smooth
wire(ren, lag)
gain = make(AUDIO, mathCHOP, 'gain', 1010, 250)             # noqa: F821
setpar(gain, gain=6.0, postclamp='clamp', postclampmin=0.0, postclampmax=1.0)
wire(lag, gain)
audio_null = make(AUDIO, nullCHOP, 'audio', 1140, 250)      # noqa: F821
wire(gain, audio_null)
print('  AUDIO: set the device on AUDIO/adin (Overbridge). Channels: low mid high rms')


# ==========================================================================
# MIDI  — interface + Rytm USB + hubs -> normalised knobs + notes
# ==========================================================================
midiin = make(MIDI, midiinCHOP, 'midiin', 0, 200)           # noqa: F821
# Leave device blank so TD's default MIDI map is used; set device(s) in the UI or
# via the global MIDI Device Mapper dialog. CCs arrive as chNcM, notes as chNnP.
setpar(midiin, channel='1-16')

# Performer macro knobs: Rytm PERF macros are CC35-47 on the perf channel (ch13
# by default in analog-rytm-control/midi-map.js). We pull 8 of them as knob1..8.
# Edit the `select` pattern below if your perf channel differs.
sel_knobs = make(MIDI, selectCHOP, 'sel_knobs', 200, 300)   # noqa: F821
setpar(sel_knobs, channames='ch13c35 ch13c36 ch13c37 ch13c39 ch13c40 ch13c41 ch13c42 ch13c43')
wire(midiin, sel_knobs)
ren_knobs = make(MIDI, renameCHOP, 'rename_knobs', 350, 300)  # noqa: F821
setpar(ren_knobs, renamefrom='*', renameto='knob1 knob2 knob3 knob4 knob5 knob6 knob7 knob8')
wire(sel_knobs, ren_knobs)
norm_knobs = make(MIDI, mathCHOP, 'norm_knobs', 500, 300)   # noqa: F821
setpar(norm_knobs, fromrange1=0, fromrange2=127, torange1=0, torange2=1)
wire(ren_knobs, norm_knobs)

# Rytm voice triggers over USB: BD/SD/etc note-ons -> flash/impulse channels.
# Rytm tracks 1..12 are MIDI ch 1..12; default trig notes are often 36 (C1) etc.
# We expose ch1..ch4 note level as kick/snare/etc. Remap to your kit's notes.
sel_hits = make(MIDI, selectCHOP, 'sel_hits', 200, 120)     # noqa: F821
setpar(sel_hits, channames='ch1n* ch2n* ch3n* ch4n*')
wire(midiin, sel_hits)
hits_lag = make(MIDI, lagCHOP, 'hits_lag', 350, 120)        # noqa: F821
setpar(hits_lag, lag1=0.0, lag2=0.25)     # instant on, decay out -> visual "hit" envelope
wire(sel_hits, hits_lag)

midi_merge = make(MIDI, mergeCHOP, 'merge', 680, 220)       # noqa: F821
wire(norm_knobs, midi_merge)
wire(hits_lag, midi_merge)
midi_null = make(MIDI, nullCHOP, 'midi', 820, 220)          # noqa: F821
wire(midi_merge, midi_null)
print('  MIDI: assign your MIDI device(s) in the Dialogs > MIDI Device Mapper.')


# ==========================================================================
# OSC  — crowd / hub control (the dspm bridge)
# ==========================================================================
oscin = make(OSC, oscinCHOP, 'oscin', 0, 200)               # noqa: F821
setpar(oscin, port=OSC_PORT)
# the bridge forwards /barcode/... and /param/... ; channel names become the
# address with slashes as separators. Smooth + a null for downstream use.
osc_lag = make(OSC, lagCHOP, 'lag', 200, 200)               # noqa: F821
setpar(osc_lag, lag1=0.05, lag2=0.15)
wire(oscin, osc_lag)
osc_null = make(OSC, nullCHOP, 'osc', 360, 200)             # noqa: F821
wire(osc_lag, osc_null)
print('  OSC : listening on %d. Fan the dspm bridge here (see control-map.md).' % OSC_PORT)


# ==========================================================================
# CONTROL  — performer macros -> `master` CHOP
# ==========================================================================
# Custom parameters on CONTROL ARE the control surface: draggable in the
# parameter window, and the thing you drag-MIDI-learn physical knobs onto
# (Dialogs > MIDI Device Mapper, or RMB a par > "Bind"/"Add MIDI..."), so the
# Rytm perf knobs or any controller drive them live.
try:
    pg = CONTROL.appendCustomPage('Visuals')
    def fpar(name, label, default, lo, hi):
        p = pg.appendFloat(name, label=label)
        p[0].normMin, p[0].normMax = lo, hi
        p[0].clampMin, p[0].clampMax = False, False
        p[0].default, p[0].val = default, default
        return p
    # name order here defines the `master` channel order.
    fpar('Speed',     'Speed',        0.30, 0, 2)
    fpar('Warp',      'Warp',         0.45, 0, 1)
    fpar('Scale',     'Scale/Zoom',   0.40, 0, 1)
    fpar('Hue',       'Hue',          0.00, 0, 1)
    fpar('Sat',       'Saturation',   0.70, 0, 1)
    fpar('Contrast',  'Contrast',     0.50, 0, 1)
    fpar('Colormix',  'Colour Mix',   0.00, 0, 1)
    fpar('Kaleido',   'Kaleidoscope', 0.00, 0, 1)
    fpar('Feedback',  'Feedback',     0.50, 0, 1)
    fpar('Decay',     'Trail Decay',  0.92, 0, 1)
    fpar('Zoomfb',    'FB Zoom',      0.50, 0, 1)     # 0.5 = neutral
    fpar('Rotfb',     'FB Rotate',    0.50, 0, 1)     # 0.5 = neutral
    fpar('Audioreact','Audio React',  0.70, 0, 1)
    fpar('Aberration','Aberration',   0.40, 0, 1)
    fpar('Vignette',  'Vignette',     0.35, 0, 1)
    fpar('Bloom',     'Bloom',        0.45, 0, 1)
    fpar('Brightness','Brightness',   0.55, 0, 1)
    fpar('Gamma',     'Gamma',        0.50, 0, 1)
except Exception as e:
    print('  ! CONTROL custom pars failed: %s' % e)

# parameterCHOP reads those custom pars -> a clean channel bundle `master`.
pchop = make(CONTROL, parameterCHOP, 'params', 200, 200)    # noqa: F821
setpar(pchop, ops=CONTROL.path, parameters='*', renameto='*')
# only custom pars, as values:
setpar(pchop, custom=True, builtin=False, value=True)
master = make(CONTROL, nullCHOP, 'master', 360, 200)        # noqa: F821
wire(pchop, master)

# The CONTROL custom parameters above ARE the performer surface: draggable in
# the parameter window, MIDI-learnable onto hardware knobs (Dialogs > MIDI Device
# Mapper, or RMB a par > Bind), and referenceable as `master` channels. They are
# left unbound on purpose so a physical knob can claim any of them at showtime
# without the script having pre-committed them. For a dedicated touchscreen,
# build a panel of Slider COMPs and *Bind* each to a CONTROL par (bidirectional)
# — kept manual so it doesn't fight MIDI mapping.


# ==========================================================================
# GEN  — generative.frag + feedback/trails
# ==========================================================================
shdir = _shader_dir()
gen_frag = make(GEN, textDAT, 'gen_frag', 0, 400)           # noqa: F821
gen_frag_path = os.path.join(shdir, 'generative.frag')
setpar(gen_frag, file=gen_frag_path, syncfile=True, loadonstart=True)
try:
    gen_frag.par.loadonstartpulse.pulse()
except Exception:
    pass

glsl = make(GEN, glslmultiTOP, 'field', 200, 400)          # noqa: F821
setpar(glsl, pixeldat=gen_frag.path)
setpar(glsl, outputresolution='custom', resolutionw=RES_W, resolutionh=RES_H)

# uniforms: pack control + audio into 4 vec4s (see generative.frag header).
# glslmultiTOP exposes a `value` uniform sequence; we set name + x/y/z/w exprs.
def add_uniform(g, idx, name, exprs):
    """exprs: list of up to 4 TD expression strings."""
    try:
        if g.seq.value.numBlocks <= idx:
            g.seq.value.numBlocks = idx + 1
    except Exception:
        pass
    setpar(g, **{'value%dname' % idx: name})
    for comp, ex in zip('xyzw', exprs):
        setexpr(g, 'value%d%s' % (idx, comp), ex)

M = "op('../CONTROL/master')"
A = "op('../AUDIO/audio')"
add_uniform(glsl, 0, 'uTime',  ['absTime.seconds'])
add_uniform(glsl, 1, 'uAudio', ["%s['low']*%s['audioreact']" % (A, M),
                                "%s['mid']*%s['audioreact']" % (A, M),
                                "%s['high']*%s['audioreact']" % (A, M),
                                "%s['rms']*%s['audioreact']" % (A, M)])
add_uniform(glsl, 2, 'uCtrlA', ["%s['speed']" % M, "%s['warp']" % M,
                                "%s['scale']" % M, "%s['hue']" % M])
add_uniform(glsl, 3, 'uCtrlB', ["%s['sat']" % M, "%s['contrast']" % M,
                                "%s['colormix']" % M, "%s['kaleido']" % M])

# --- feedback / trails loop ---------------------------------------------
# field -> composite(over feedback-transform) -> feedback TOP -> transform/level
comp_fb = make(GEN, compositeTOP, 'comp', 400, 400)        # noqa: F821
setpar(comp_fb, operand='over')
fb = make(GEN, feedbackTOP, 'feedback', 400, 250)          # noqa: F821
xform = make(GEN, transformTOP, 'fb_xform', 600, 250)      # noqa: F821
fade = make(GEN, levelTOP, 'fb_fade', 750, 250)            # noqa: F821

wire(glsl, comp_fb, 0)
wire(xform, comp_fb, 1)
setpar(fb, top=comp_fb.path)          # feedback samples the composited result
wire(fb, xform)
# zoom/rotate the trail; master Zoomfb/Rotfb centre at 0.5 = neutral
setexpr(xform, 'scale', "1.0 + (op('../CONTROL/master')['zoomfb']-0.5)*0.08")
setexpr(xform, 'rotate', "(op('../CONTROL/master')['rotfb']-0.5)*4.0")
wire(xform, fade)
# fade = trail decay; multiply RGB by Decay each frame
setexpr(fade, 'opacity', "op('../CONTROL/master')['decay']")
# re-route fade into the composite's 2nd input as the persistent trail
wire(fade, comp_fb, 1)

# blend strength of the feedback vs fresh field
gen_mix = make(GEN, compositeTOP, 'gen_mix', 600, 400)     # noqa: F821
setpar(gen_mix, operand='add')
wire(glsl, gen_mix, 0)
fb_amt = make(GEN, levelTOP, 'fb_amount', 750, 480)        # noqa: F821
setexpr(fb_amt, 'opacity', "op('../CONTROL/master')['feedback']")
wire(comp_fb, fb_amt)
wire(fb_amt, gen_mix, 1)

gen_out = make(GEN, nullTOP, 'gen_out', 800, 400)          # noqa: F821
wire(gen_mix, gen_out)


# ==========================================================================
# POST  — bloom + post.frag grade
# ==========================================================================
bloom = make(POST, bloomTOP, 'bloom', 0, 300)              # noqa: F821
setexpr(bloom, 'bloomstrength' if hasattr(bloom.par, 'bloomstrength') else 'strength',
        "op('../CONTROL/master')['bloom']*2.0")
wire(gen_out, bloom)

post_frag = make(POST, textDAT, 'post_frag', 0, 120)       # noqa: F821
setpar(post_frag, file=os.path.join(shdir, 'post.frag'), syncfile=True, loadonstart=True)
try:
    post_frag.par.loadonstartpulse.pulse()
except Exception:
    pass

post_glsl = make(POST, glslmultiTOP, 'grade', 200, 300)    # noqa: F821
setpar(post_glsl, pixeldat=post_frag.path)
wire(bloom, post_glsl, 0)
add_uniform(post_glsl, 0, 'uAudio', ["%s['low']" % A, "%s['mid']" % A,
                                     "%s['high']" % A, "%s['rms']" % A])
add_uniform(post_glsl, 1, 'uCtrlC', ["%s['aberration']" % M, "%s['vignette']" % M,
                                     "%s['brightness']" % M, "%s['gamma']" % M])
post_out = make(POST, nullTOP, 'post_out', 360, 300)       # noqa: F821
wire(post_glsl, post_out)


# ==========================================================================
# OUT  — final null + fullscreen window
# ==========================================================================
final = make(OUT, nullTOP, 'final', 0, 300)                # noqa: F821
wire(post_out, final)
outtop = make(OUT, outTOP, 'out', 150, 300)                # noqa: F821
wire(final, outtop)

win = make(OUT, windowCOMP, 'output_window', 0, 100)       # noqa: F821
setpar(win, top=final.path, justify='fill', borders=False)
# set to your projector/2nd monitor in the Window COMP pars, then pulse `Open`.
print('  OUT : open OUT/output_window on your projector (set Monitor, then Open).')


# --------------------------------------------------------------------------
print('\nBuilt /%s.' % ROOT_NAME)
print('-' * 64)
print('CHECKLIST (environment-specific — finish these):')
print('  1. AUDIO/adin  : set Driver + Device to your Overbridge audio device.')
print('  2. MIDI        : Dialogs > MIDI Device Mapper, add the MIDI interface,')
print('                   the Rytm (USB), and any hub ports. Confirm the perf')
print('                   channel in MIDI/sel_knobs matches your Rytm (default 13).')
print('  3. OSC         : point the dspm bridge / a sender at this host:%d.' % OSC_PORT)
print('  4. OUT/output_window : choose Monitor, then pulse Open for fullscreen.')
print('  5. Drag the Rytm PERF knobs onto CONTROL macros via the MIDI Mapper to')
print('     play the visuals by hand. See control-map.md for the full map.')
print('-' * 64)
