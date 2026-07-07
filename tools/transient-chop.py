"""Chop a long WAV into small samples cut at transients + random points.

Usage: python transient-chop.py <input.wav> <output_dir> [count]

Picks ~count slices (default random 20-30), each 1-5 s long. Most start on a
detected onset, a handful start at purely random positions for happy accidents.
"""
import os
import random
import sys

import librosa
import numpy as np
import soundfile as sf

MIN_LEN = 1.0
MAX_LEN = 5.0
RANDOM_FRACTION = 0.25  # portion of slices that ignore onsets entirely


def main():
    in_path = sys.argv[1]
    out_dir = sys.argv[2]
    count = int(sys.argv[3]) if len(sys.argv) > 3 else random.randint(20, 30)

    os.makedirs(out_dir, exist_ok=True)
    base = os.path.splitext(os.path.basename(in_path))[0]

    print(f"loading {in_path} ...")
    y, sr = librosa.load(in_path, sr=None, mono=False)
    if y.ndim == 1:
        y = y[np.newaxis, :]
    mono = librosa.to_mono(y)
    total_sec = mono.shape[0] / sr
    print(f"{total_sec:.1f} s @ {sr} Hz, {y.shape[0]} ch")

    print("detecting onsets ...")
    onset_times = librosa.onset.onset_detect(
        y=mono, sr=sr, units="time", backtrack=True
    )
    # keep onsets that leave room for at least MIN_LEN of audio
    onset_times = [t for t in onset_times if t < total_sec - MIN_LEN]
    print(f"{len(onset_times)} usable onsets")

    n_random = max(1, round(count * RANDOM_FRACTION))
    n_onset = count - n_random
    if len(onset_times) < n_onset:
        n_random += n_onset - len(onset_times)
        n_onset = len(onset_times)

    starts = random.sample(onset_times, n_onset) if n_onset else []
    starts += [random.uniform(0, total_sec - MAX_LEN) for _ in range(n_random)]
    random.shuffle(starts)

    for i, start in enumerate(sorted(starts), 1):
        dur = random.uniform(MIN_LEN, MAX_LEN)
        dur = min(dur, total_sec - start)
        s0 = int(start * sr)
        s1 = s0 + int(dur * sr)
        clip = y[:, s0:s1].T  # soundfile wants (frames, channels)

        # short fades to avoid clicks on non-onset cuts
        fade = min(int(0.005 * sr), clip.shape[0] // 4)
        if fade > 0:
            ramp = np.linspace(0, 1, fade)[:, np.newaxis]
            clip[:fade] *= ramp
            clip[-fade:] *= ramp[::-1]

        name = f"{base}_{i:02d}_{start:07.1f}s_{dur:.1f}s.wav"
        sf.write(os.path.join(out_dir, name), clip, sr)
        print(f"  {name}")

    print(f"done: {len(starts)} samples -> {out_dir}")


if __name__ == "__main__":
    main()
