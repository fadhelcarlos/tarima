"""
Builds the drum kit sample set from Virtuosity Drums (CC0, Versilian Studios + Karoryfer Samples).

For every chosen hit it downloads the multi-mic stems (kick close, snare close, overheads,
room, mid), mixes them into one stereo file from the drummer's perspective (hi-hat left,
ride right), normalizes per instrument (keeping the real dynamics between velocity
layers), trims the tail and encodes MP3. It writes public/samples/*.mp3 and
src/audio/manifest.json.

Usage: python scripts/build_samples.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "vd" / "stems"
OUT = ROOT / "public" / "samples"
MANIFEST = ROOT / "src" / "audio" / "manifest.json"
BASE = "https://raw.githubusercontent.com/sfzinstruments/virtuosity_drums/master/Samples"
SR = 48000


def vl_rr(v: list[int], r: list[int]) -> list[str]:
    return [f"vl{a}_rr{b}" for a in v for b in r]


def vl(idx: list[int]) -> list[str]:
    return [f"vl{a}" for a in idx]


# (mic, gain, pan) — pan only applies to mono stems (-1 left … +1 right, drummer's view).
MIX_KICK = [("kickmic", 1.0, 0.0), ("oh", 0.85, 0), ("room", 0.75, 0), ("snaremic", 0.25, -0.15)]
MIX_SNARE = [("snaremic", 1.0, -0.12), ("oh", 0.95, 0), ("room", 0.65, 0), ("kickmic", 0.3, 0)]
MIX_TOM = [("oh", 1.0, 0), ("room", 0.8, 0), ("mid", 0.55, 0), ("kickmic", 0.6, 0), ("snaremic", 0.35, -0.1)]
MIX_HH = [("oh", 1.0, 0), ("snaremic", 0.5, -0.35), ("room", 0.45, 0)]
MIX_CYM = [("oh", 1.0, 0), ("room", 0.5, 0), ("snaremic", 0.2, 0)]

# piece -> articulation -> (sample folder, source articulation, takes, mix, max seconds)
SELECTION: dict[str, dict[str, tuple]] = {
    "kick": {
        "hit": ("kick", "kick_snon", vl_rr([1], [1, 2]) + vl_rr([2, 3, 4], [1, 2, 3, 4]), MIX_KICK, 1.6),
    },
    "snare": {
        "center": ("snare", "snare_center", vl([4, 9, 14, 18, 22, 25, 28, 29, 30, 31, 32, 33, 34, 35, 36]), MIX_SNARE, 1.6),
        "edge": ("snare", "snare_offcenter", vl([20, 26, 30, 33, 35, 36]), MIX_SNARE, 1.6),
        "rim": ("snare", "snare_rimshot", vl([4, 7, 9, 10, 11, 12]), MIX_SNARE, 1.8),
        "xstick": ("snare", "snare_crossstick", vl([8, 11, 14, 16]), MIX_SNARE, 1.0),
    },
    "tom": {
        "center": ("htom", "htom_center", vl([3, 6, 9, 11, 12, 13, 14, 15, 16]), MIX_TOM, 2.4),
    },
    "floor": {
        "center": ("ltom", "ltom_center", vl([3, 6, 9, 11, 12, 13, 14, 15, 16]), MIX_TOM, 2.8),
        "rim": ("ltom", "ltom_rimshot", vl([6, 8, 10]), MIX_TOM, 2.8),
    },
    "hihat": {
        "closed": ("hh", "hh_closed", vl_rr([1, 2, 3, 4], [1, 2, 3, 4]), MIX_HH, 0.9),
        "half": ("hh", "hh_half", vl_rr([2, 3, 4], [1, 2]), MIX_HH, 1.6),
        "open": ("hh", "hh_open", vl_rr([2, 3, 4], [1, 2]), MIX_HH, 3.2),
        "pedal": ("hh", "hh_pedal", vl_rr([1, 2, 3], [1, 2]), MIX_HH, 0.9),
    },
    "crash": {
        "hit": ("crash", "crash_crash", vl_rr([1], [1, 2]) + vl_rr([2], [1, 2, 3]) + vl_rr([3], [1, 2, 3, 4]), MIX_CYM, 5.5),
    },
    "ride": {
        "bow": ("ride", "ride_ride", vl_rr([1], [1, 2]) + vl_rr([2], [1, 2, 3]) + vl_rr([3], [1, 2, 3, 4]), MIX_CYM, 4.5),
        "bell": ("ride", "ride_bell", vl_rr([2], [1, 2]) + vl_rr([3], [1, 2, 3]), MIX_CYM, 4.0),
    },
}


def stem_name(mic: str, art: str, take: str) -> str:
    return f"{mic}_{art}_{take}.flac"


def fetch(job: tuple[str, str, str]) -> Path:
    folder, mic, name = job
    dest = CACHE / mic / name
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = f"{BASE}/{mic}/{folder}/{name}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            tmp = dest.with_suffix(".part")
            tmp.write_bytes(data)
            tmp.replace(dest)
            return dest
        except Exception as exc:  # noqa: BLE001 - retry any network error
            if attempt == 3:
                raise RuntimeError(f"download failed {url}: {exc}") from exc
    return dest


def load_stereo(path: Path, pan: float) -> np.ndarray:
    data, sr = sf.read(path, always_2d=True, dtype="float32")
    assert sr == SR, (path, sr)
    if data.shape[1] == 1:
        # constant-power pan of a mono close mic
        angle = (pan + 1) * np.pi / 4
        return np.stack([data[:, 0] * np.cos(angle), data[:, 0] * np.sin(angle)], axis=1)
    # The library's stereo mics are from the audience's side: swap so the hi-hat sits left.
    return data[:, ::-1].copy()


def mix_take(folder: str, art: str, take: str, mix: list) -> np.ndarray:
    parts = []
    for mic, gain, pan in mix:
        parts.append(load_stereo(CACHE / mic / stem_name(mic, art, take), pan) * gain)
    n = max(p.shape[0] for p in parts)
    out = np.zeros((n, 2), dtype=np.float32)
    for p in parts:
        out[: p.shape[0]] += p
    return out


def shape_tail(x: np.ndarray, max_s: float, piece_peak: float) -> np.ndarray:
    n_max = int(max_s * SR)
    env = np.abs(x).max(axis=1)
    # last sample above -62 dB of the instrument's loudest hit
    above = np.nonzero(env > piece_peak * 10 ** (-62 / 20))[0]
    end = min(n_max, (above[-1] + 1) if len(above) else len(x), len(x))
    y = x[:end].copy()
    fade = min(len(y) // 3, int(0.6 * SR))
    if fade > 16:
        curve = np.linspace(1, 0, fade, dtype=np.float32) ** 2
        y[-fade:] *= curve[:, None]
    return y


def encode(wav: np.ndarray, dest: Path) -> None:
    tmp = dest.with_suffix(".wav")
    sf.write(tmp, wav, SR, subtype="PCM_16")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp), "-c:a", "libmp3lame", "-q:a", "2", str(dest)],
        check=True,
    )
    tmp.unlink()


def main() -> None:
    jobs = set()
    for arts in SELECTION.values():
        for folder, art, takes, mix, _ in arts.values():
            for take in takes:
                for mic, _, _ in mix:
                    jobs.add((folder, mic, stem_name(mic, art, take)))
    print(f"stems needed: {len(jobs)}")
    with ThreadPoolExecutor(12) as pool:
        for i, _ in enumerate(pool.map(fetch, sorted(jobs))):
            if i % 50 == 0:
                print(f"  fetched {i}/{len(jobs)}", flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.mp3"):
        old.unlink()
    manifest: dict = {"source": "Virtuosity Drums by Versilian Studios & Karoryfer Samples (CC0 1.0)", "pieces": {}}
    total = 0
    for piece, arts in SELECTION.items():
        mixed = {a: [mix_take(f, src, t, m) for t in takes] for a, (f, src, takes, m, _) in arts.items()}
        peak = max(float(np.abs(x).max()) for xs in mixed.values() for x in xs)
        gain = 0.89 / peak
        manifest["pieces"][piece] = {}
        for art, xs in mixed.items():
            entries = []
            max_s = arts[art][4]
            for i, x in enumerate(xs):
                y = shape_tail(x * gain, max_s, 0.89)
                name = f"{piece}-{art}-{i + 1:02d}.mp3"
                encode(y, OUT / name)
                total += (OUT / name).stat().st_size
                # loudness of the attack (first 60 ms RMS) drives velocity mapping
                attack = y[: int(0.06 * SR)]
                entries.append({
                    "file": name,
                    "peak": round(float(np.abs(y).max()), 4),
                    "rms": round(float(np.sqrt((attack ** 2).mean())), 5),
                    "dur": round(len(y) / SR, 3),
                })
            entries.sort(key=lambda e: e["rms"])
            manifest["pieces"][piece][art] = entries
            print(f"{piece}/{art}: {len(entries)} files")
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=1))
    print(f"total {total / 1e6:.2f} MB")


if __name__ == "__main__":
    sys.exit(main())
