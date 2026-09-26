"""
Builds the tonal instrument sample set (piano, bass, ukulele) for the drummer web app.

Sources (all CC0):
  - Piano: sgossner/VCSL, "Chordophones/Zithers/Upright Piano, Yamaha" sustains
  - Bass:  sfzinstruments/karoryfer.black-and-blue-basses, "darkblack/reg" fingered
  - Uke:   thgrund/samples-ukulele, "Ortega Lizard Ukulele" plucks

For each chosen sample it: downloads the wav, decodes to float, forces stereo, resamples
to 48 kHz if needed, trims leading silence so playback starts ~1 ms before the attack,
caps the length with a gentle tail fade, trims trailing silence, normalizes per instrument
so its loudest sample peaks at 0.89 (keeping relative levels between notes) and encodes
MP3 with libmp3lame -q:a 3. Writes:
    public/samples/keys/piano-<midi>.mp3
    public/samples/bass/bass-<midi>.mp3
    public/samples/uke/uke-<midi>[-<string_or_index>].mp3
    src/audio/tonal-manifest.json

Usage:  python scripts/build_tonal_samples.py
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "tonal"
OUT = ROOT / "public" / "samples"
MANIFEST = ROOT / "src" / "audio" / "tonal-manifest.json"
SR = 48000
PEAK_TARGET = 0.89
SILENCE_DBFS = -60.0

PIANO_TREE = ROOT / ".cache" / "vcsl_tree.json"
BASS_TREE = ROOT / ".cache" / "bbb_tree.json"
UKE_TREE = ROOT / ".cache" / "uke_tree.json"

VCSL_RAW = "https://raw.githubusercontent.com/sgossner/VCSL/master/"
BBB_RAW = "https://raw.githubusercontent.com/sfzinstruments/karoryfer.black-and-blue-basses/main/"
UKE_RAW = "https://raw.githubusercontent.com/thgrund/samples-ukulele/HEAD/"

CREDITS = {
    "piano": (
        "Upright Piano, Yamaha — Versilian Community Sample Library (sgossner/VCSL, CC0 1.0)"
    ),
    "bass": (
        "Black And Blue Basses — Karoryfer Samples, sfzinstruments/karoryfer.black-and-blue-basses (CC0 1.0)"
    ),
    "uke": (
        "Ortega Lizard ukulele — thgrund/samples-ukulele, tuned to C (CC0 1.0)"
    ),
}

# ---------------------------------------------------------------------------
# helpers

NOTE_SEMI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def note_to_midi(name: str) -> int:
    """Scientific-pitch note name (C4 = MIDI 60). Accepts C4, C#4, Db4, C-1."""
    m = re.match(r"^([A-Ga-g])([#b]?)(-?\d+)$", name)
    if not m:
        raise ValueError(f"bad note name {name!r}")
    letter, accidental, octave = m.group(1).upper(), m.group(2), int(m.group(3))
    semi = NOTE_SEMI[letter] + (1 if accidental == "#" else -1 if accidental == "b" else 0)
    return (octave + 1) * 12 + semi


def midi_to_freq(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12.0)


def fetch(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "drummer-tonal-build"})
    with urllib.request.urlopen(req, timeout=90) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, dest)
    return dest


def encode_path(repo_path: str) -> str:
    """URL-encode each path segment for GitHub raw."""
    return "/".join(urllib.parse.quote(seg, safe="") for seg in repo_path.split("/"))


def read_wav_stereo_48k(path: Path) -> np.ndarray:
    audio, sr = sf.read(str(path), dtype="float32", always_2d=True)
    if audio.shape[1] == 1:
        audio = np.concatenate([audio, audio], axis=1)
    elif audio.shape[1] > 2:
        audio = audio[:, :2]
    if sr != SR:
        # resample per channel
        from math import gcd
        g = gcd(sr, SR)
        up, down = SR // g, sr // g
        left = resample_poly(audio[:, 0], up, down).astype(np.float32)
        right = resample_poly(audio[:, 1], up, down).astype(np.float32)
        audio = np.stack([left, right], axis=1)
    return audio


def db_to_amp(db: float) -> float:
    return float(10 ** (db / 20.0))


def find_attack(audio_mono: np.ndarray, sr: int, thresh_db: float = -50.0) -> int:
    thresh = db_to_amp(thresh_db)
    # short-window envelope
    win = max(1, int(sr * 0.002))
    if audio_mono.size < win:
        return 0
    env = np.maximum(np.abs(audio_mono), 1e-9)
    # first sample above threshold
    idx = np.argmax(env > thresh)
    if env[idx] <= thresh:
        return 0
    return int(idx)


def trim_trailing_silence(audio: np.ndarray, sr: int, peak_amp: float) -> np.ndarray:
    """Trim trailing samples that stay below `SILENCE_DBFS` relative to peak_amp."""
    thresh = peak_amp * db_to_amp(SILENCE_DBFS)
    mono = np.max(np.abs(audio), axis=1)
    if mono.max() <= thresh:
        return audio
    # window RMS smoothing to avoid clipping between wave zero-crossings
    win = max(1, int(sr * 0.02))
    if mono.size >= win:
        kernel = np.ones(win) / win
        smoothed = np.convolve(mono, kernel, mode="same")
    else:
        smoothed = mono
    idx = np.where(smoothed > thresh)[0]
    if idx.size == 0:
        return audio
    end = min(audio.shape[0], int(idx[-1]) + win)
    return audio[:end]


def apply_tail_fade(audio: np.ndarray, sr: int, fade_max_s: float = 0.6) -> np.ndarray:
    n = audio.shape[0]
    if n == 0:
        return audio
    fade = min(int(n * 0.25), int(sr * fade_max_s))
    if fade <= 0:
        return audio
    env = np.ones(n, dtype=np.float32)
    # cosine-ish fade for gentleness
    t = np.linspace(0.0, 1.0, fade, dtype=np.float32)
    env[n - fade:] = 0.5 * (1.0 + np.cos(np.pi * t))
    return audio * env[:, None]


def estimate_pitch_hz(audio_mono: np.ndarray, sr: int, fmin: float = 40.0, fmax: float = 4000.0, nharms: int = 8) -> Optional[float]:
    """Harmonic-sum spectral pitch estimate. Robust to weak fundamentals (piano bass
    strings) and to strong 2nd harmonics.

    Windows a stable segment (100 ms .. 700 ms after the attack), takes a zero-padded
    FFT, then scores every candidate `f` in [fmin, fmax] by summing the local peak
    magnitude around each of its first `nharms` harmonics. The candidate with the
    highest score is the estimated fundamental.
    """
    n = audio_mono.size
    if n < int(sr * 0.15):
        return None
    start = int(sr * 0.05)
    end = min(n, start + int(sr * 0.6))
    seg = audio_mono[start:end].astype(np.float64)
    if seg.size < 512:
        return None
    seg = seg - seg.mean()
    seg *= np.hanning(seg.size)
    nfft = 1 << 19  # ~0.09 Hz per bin at 48 kHz
    S = np.abs(np.fft.rfft(seg, nfft))
    freqs = np.fft.rfftfreq(nfft, 1.0 / sr)
    df = freqs[1] - freqs[0]
    best_score = 0.0
    best_freq = 0.0
    step = df * 0.5
    f = fmin
    fmax_eff = min(fmax, sr / (2 * 1.05))
    peak_win = 3  # +/- bins to search around each expected harmonic
    while f <= fmax_eff:
        score = 0.0
        for k in range(1, nharms + 1):
            idx = int(round(k * f / df))
            if idx >= len(S):
                break
            lo = max(0, idx - peak_win)
            hi = min(len(S), idx + peak_win + 1)
            score += float(S[lo:hi].max())
        if score > best_score:
            best_score = score
            best_freq = f
        f += step
    return best_freq if best_freq > 0 else None


def midi_from_hz(hz: float) -> float:
    return 12.0 * np.log2(hz / 440.0) + 69.0


# ---------------------------------------------------------------------------
# selection

@dataclass
class Pick:
    """A candidate wav file with the MIDI note it will publish as.

    `nominal_midi` is what the filename says when interpreted with the source
    library's own octave convention (which is often C3=middle C, not C4).
    `midi` is the TRUE MIDI number — either the same as nominal, or corrected
    by the per-instrument octave shift that `probe_octave_shift` measures.
    """

    name: str
    nominal_midi: int
    midi: int
    url: str
    tag: Optional[str] = None
    string: Optional[str] = None
    cache_path: Path = field(default=Path())


def probe_octave_shift(pk: Pick) -> int:
    """Fetch one candidate, measure its pitch, and return the octave shift (multiples
    of 12) that brings the filename-implied MIDI onto the measured pitch.

    Autocorrelation / harmonic-sum sometimes latches onto a partial rather than the
    true fundamental, so we snap the raw estimate to the nearest MIDI and then to
    the nearest multiple of 12 versus the nominal MIDI. That makes it robust:
    the estimator only has to be within ~6 semitones of the truth.
    """
    fetch(pk.url, pk.cache_path)
    audio = read_wav_stereo_48k(pk.cache_path)
    mono = audio.mean(axis=1)
    hz = estimate_pitch_hz(mono, SR)
    if not hz:
        return 0
    measured_midi = int(round(midi_from_hz(hz)))
    diff = measured_midi - pk.nominal_midi
    return int(round(diff / 12.0)) * 12


def pick_piano() -> list[Pick]:
    tree = json.loads(PIANO_TREE.read_text())
    prefix = "Chordophones/Zithers/Upright Piano, Yamaha/Sustains/"
    files = [x["path"] for x in tree["tree"]
             if x["path"].startswith(prefix) and x["path"].endswith(".wav")]
    # pick vl2 rr1 (mid velocity, first rr)
    raw: list[Pick] = []
    for p in files:
        fn = p.rsplit("/", 1)[1]
        m = re.match(r"Upright1_Sus_([A-G]#?-?\d)_vl2_rr1\.wav$", fn)
        if not m:
            continue
        note = m.group(1)
        nominal = note_to_midi(note)
        raw.append(Pick(
            name=note,
            nominal_midi=nominal,
            midi=nominal,
            url=VCSL_RAW + encode_path(p),
            cache_path=CACHE / "piano" / fn,
        ))
    if not raw:
        return []
    raw.sort(key=lambda x: x.nominal_midi)

    # Probe a mid-register file (nominal C in the 40s) to learn the octave shift.
    probe = min(raw, key=lambda x: abs(x.nominal_midi - 48))
    shift = probe_octave_shift(probe)
    print(f"[piano] probed {probe.cache_path.name}: octave shift = {shift:+d} semitones")
    for pk in raw:
        pk.midi = pk.nominal_midi + shift

    picks = [pk for pk in raw if 36 <= pk.midi <= 84]
    return sorted(picks, key=lambda x: x.midi)


def pick_bass() -> list[Pick]:
    tree = json.loads(BASS_TREE.read_text())
    prefix = "Samples/darkblack/reg/"
    files = [x["path"] for x in tree["tree"]
             if x["path"].startswith(prefix) and x["path"].endswith(".wav")]

    # sfz name → MIDI (verified from Programs/maps/darkblack_reg_mf_map.sfz: b1 → 35, c2 → 36)
    letter_semi = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}

    def bass_note_midi(tok: str) -> int:
        m = re.match(r"^([a-g])(b?)(\d+)$", tok)
        if not m:
            raise ValueError(tok)
        letter, flat, octave = m.group(1), m.group(2), int(m.group(3))
        semi = letter_semi[letter] + (-1 if flat else 0)
        return (octave + 1) * 12 + semi

    catalog: dict[int, str] = {}
    for p in files:
        fn = p.rsplit("/", 1)[1]
        m = re.match(r"darkblack_([a-g]b?\d+)_mf_rr1\.wav$", fn)
        if not m:
            continue
        midi = bass_note_midi(m.group(1))
        catalog[midi] = p

    if not catalog:
        return []

    # First: probe one sample to confirm the sfz-declared MIDI matches the actual pitch.
    probe_midi = min(catalog, key=lambda k: abs(k - 45))
    probe_pk = Pick(
        name=str(probe_midi),
        nominal_midi=probe_midi,
        midi=probe_midi,
        url=BBB_RAW + encode_path(catalog[probe_midi]),
        cache_path=CACHE / "bass" / catalog[probe_midi].rsplit("/", 1)[1],
    )
    shift = probe_octave_shift(probe_pk)
    print(f"[bass] probed {probe_pk.cache_path.name}: octave shift = {shift:+d} semitones")

    # Roughly every 3 semitones covering MIDI 28..55 -- clamped to what exists.
    lo = max(28, min(k + shift for k in catalog))
    hi = min(55, max(k + shift for k in catalog))
    wanted = list(range(lo, hi + 1, 3))
    picks: list[Pick] = []
    seen_midi: set[int] = set()
    for target in wanted:
        best = min(catalog, key=lambda k: (abs((k + shift) - target), k))
        true_midi = best + shift
        if abs(true_midi - target) > 2 or true_midi in seen_midi:
            continue
        seen_midi.add(true_midi)
        p = catalog[best]
        picks.append(Pick(
            name=str(true_midi),
            nominal_midi=best,
            midi=true_midi,
            url=BBB_RAW + encode_path(p),
            cache_path=CACHE / "bass" / p.rsplit("/", 1)[1],
        ))
    return sorted(picks, key=lambda x: x.midi)


def pick_uke() -> list[Pick]:
    """Every distinct pitch for normal plucks, up to 2 samples per pitch."""
    tree = json.loads(UKE_TREE.read_text())
    files = [x["path"] for x in tree["tree"] if x["path"].endswith(".wav")]

    # exclude non-plucked / effect articulations
    exclude = ("vibrato", "slide", "harmonic", "dead_notes", "palm_muted")

    raw: list[Pick] = []
    for fn in sorted(files):
        base = fn.rsplit(".", 1)[0]
        if any(bad in base for bad in exclude):
            continue
        m = re.match(r"^\d+_([a-g])(#|b)?(\d+)_(.+)$", base)
        if not m:
            continue
        letter, acc, octave, art = m.group(1), m.group(2) or "", int(m.group(3)), m.group(4)
        nominal = note_to_midi(f"{letter.upper()}{acc}{octave}")
        tag = art.replace("_", "")
        raw.append(Pick(
            name=f"{nominal}-{tag}",
            nominal_midi=nominal,
            midi=nominal,
            url=UKE_RAW + encode_path(fn),
            tag=tag,
            cache_path=CACHE / "uke" / fn,
        ))
    if not raw:
        return []

    probe = raw[0]
    shift = probe_octave_shift(probe)
    print(f"[uke] probed {probe.cache_path.name}: octave shift = {shift:+d} semitones")

    picks_by_pitch: dict[int, list[Pick]] = {}
    for pk in raw:
        pk.midi = pk.nominal_midi + shift
        picks_by_pitch.setdefault(pk.midi, []).append(pk)

    result: list[Pick] = []
    for midi in sorted(picks_by_pitch):
        bucket = picks_by_pitch[midi]
        bucket.sort(key=lambda p: (0 if "long" in (p.tag or "") else 1, p.tag))
        result.extend(bucket[:2])
    return result


# ---------------------------------------------------------------------------
# processing

@dataclass
class Processed:
    midi: int
    audio: np.ndarray     # stereo float32, un-normalized, tail-faded, silence-trimmed
    peak: float
    tag: Optional[str] = None
    string: Optional[str] = None


def process(pick: Pick, max_seconds: float) -> Processed:
    audio = read_wav_stereo_48k(pick.cache_path)
    mono = audio.mean(axis=1)

    # ~1 ms of pre-attack pad so the transient never gets clipped
    attack_idx = find_attack(mono, SR)
    pad = int(SR * 0.001)
    start = max(0, attack_idx - pad)
    audio = audio[start:]
    if audio.size == 0:
        raise RuntimeError(f"{pick.cache_path.name}: empty after attack trim")

    # cap length
    max_samples = int(max_seconds * SR)
    if audio.shape[0] > max_samples:
        audio = audio[:max_samples]

    # gentle fade over the last 25% (max 0.6 s)
    audio = apply_tail_fade(audio, SR, fade_max_s=0.6)

    # trailing silence trim (using this sample's own peak — global renormalize is later)
    peak = float(np.max(np.abs(audio)) or 1e-9)
    audio = trim_trailing_silence(audio, SR, peak)

    return Processed(midi=pick.midi, audio=audio, peak=peak, tag=pick.tag, string=pick.string)


def encode_mp3(audio: np.ndarray, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        tmp_path = Path(tmp.name)
    try:
        sf.write(str(tmp_path), audio, SR, subtype="FLOAT")
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(tmp_path),
                "-c:a", "libmp3lame", "-q:a", "3",
                "-ar", str(SR), "-ac", "2",
                str(out_path),
            ],
            check=True,
        )
    finally:
        tmp_path.unlink(missing_ok=True)


def rms_first_ms(audio: np.ndarray, sr: int, ms: float = 80.0) -> float:
    n = min(audio.shape[0], int(sr * ms / 1000.0))
    if n <= 0:
        return 0.0
    seg = audio[:n]
    return float(np.sqrt(np.mean(seg * seg)))


# ---------------------------------------------------------------------------
# main

INSTRUMENT_CONFIG = {
    "piano": {"picker": pick_piano, "max_s": 3.5, "out_dir": "keys", "prefix": "piano"},
    "bass":  {"picker": pick_bass,  "max_s": 2.5, "out_dir": "bass", "prefix": "bass"},
    "uke":   {"picker": pick_uke,   "max_s": 3.0, "out_dir": "uke",  "prefix": "uke"},
}


def download_all(picks: list[Pick]) -> None:
    def one(pk: Pick):
        try:
            fetch(pk.url, pk.cache_path)
        except Exception as e:
            print(f"  ! download failed for {pk.cache_path.name}: {e}")
            raise
    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(one, picks))


def verify_pitch(pk: Pick) -> tuple[float, float, float]:
    """Return (expected_hz, measured_hz, cents_off) for one file. Uses a narrow band
    (+/- 6 semitones) around the corrected MIDI so we don't accidentally lock onto a
    harmonic."""
    audio = read_wav_stereo_48k(pk.cache_path)
    mono = audio.mean(axis=1)
    expected = midi_to_freq(pk.midi)
    fmin = expected * 2 ** (-6 / 12)
    fmax = expected * 2 ** (+6 / 12)
    hz = estimate_pitch_hz(mono, SR, fmin=fmin, fmax=fmax) or 0.0
    if hz > 0:
        cents = 1200.0 * np.log2(hz / expected)
    else:
        cents = float("nan")
    return expected, hz, cents


def build_instrument(name: str) -> tuple[list[dict], list[str]]:
    cfg = INSTRUMENT_CONFIG[name]
    picks = cfg["picker"]()
    if not picks:
        print(f"[{name}] no picks found")
        return [], []
    print(f"[{name}] {len(picks)} picks — downloading …")
    download_all(picks)

    # pitch verification: two low samples and the top one, so we catch any octave
    # drift at the extremes.
    verify_targets = list(picks[: min(2, len(picks))])
    if len(picks) > 2:
        verify_targets.append(picks[-1])
    verify_log = []
    for pk in verify_targets:
        try:
            expected, measured, cents = verify_pitch(pk)
            verify_log.append(
                f"[{name}] {pk.cache_path.name} midi={pk.midi} "
                f"expected={expected:.2f}Hz measured={measured:.2f}Hz cents_off={cents:+.1f}"
            )
        except Exception as e:
            verify_log.append(f"[{name}] {pk.cache_path.name} pitch check failed: {e}")

    print(f"[{name}] processing …")
    processed: list[tuple[Pick, Processed]] = []
    for pk in picks:
        try:
            pr = process(pk, cfg["max_s"])
            processed.append((pk, pr))
        except Exception as e:
            print(f"  ! processing failed for {pk.cache_path.name}: {e}")

    if not processed:
        return [], verify_log

    # per-instrument normalization — loudest sample peaks at PEAK_TARGET
    global_peak = max(pr.peak for _, pr in processed) or 1e-9
    gain = PEAK_TARGET / global_peak
    print(f"[{name}] per-instrument gain = {gain:.4f} (peak was {global_peak:.4f})")

    entries = []
    for pk, pr in processed:
        pr.audio = np.clip(pr.audio * gain, -0.999, 0.999).astype(np.float32)
        # output filename
        if name == "uke":
            fname = f"{cfg['prefix']}-{pr.midi}-{pk.tag or 'x'}.mp3"
        else:
            fname = f"{cfg['prefix']}-{pr.midi}.mp3"
        out_path = OUT / cfg["out_dir"] / fname
        encode_mp3(pr.audio, out_path)
        rms = rms_first_ms(pr.audio, SR, 80.0)
        entry = {
            "midi": pr.midi,
            "file": f"{cfg['out_dir']}/{fname}",
            "rms": round(rms, 5),
        }
        if pr.string:
            entry["string"] = pr.string
        entries.append(entry)

    entries.sort(key=lambda x: (x["midi"], x["file"]))
    return entries, verify_log


def total_mb(dirs: list[Path]) -> float:
    total = 0
    for d in dirs:
        for f in d.rglob("*.mp3"):
            total += f.stat().st_size
    return total / (1024 * 1024)


def main() -> None:
    for d in ["keys", "bass", "uke"]:
        (OUT / d).mkdir(parents=True, exist_ok=True)
    (CACHE / "piano").mkdir(parents=True, exist_ok=True)
    (CACHE / "bass").mkdir(parents=True, exist_ok=True)
    (CACHE / "uke").mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)

    all_verify: list[str] = []
    manifest = {
        "source": {k: CREDITS[k] for k in ("piano", "bass", "uke")},
        "instruments": {},
    }
    for name in ("piano", "bass", "uke"):
        entries, verify = build_instrument(name)
        manifest["instruments"][name] = entries
        all_verify.extend(verify)

    MANIFEST.write_text(json.dumps(manifest, indent=2))

    print()
    print("=" * 68)
    print("SUMMARY")
    print("=" * 68)
    for name in ("piano", "bass", "uke"):
        entries = manifest["instruments"][name]
        if entries:
            midis = [e["midi"] for e in entries]
            print(f"  {name:6s} — {len(entries)} files, midi {min(midis)}..{max(midis)}")
        else:
            print(f"  {name:6s} — 0 files")
    mb = total_mb([OUT / "keys", OUT / "bass", OUT / "uke"])
    print(f"  total size: {mb:.2f} MB")
    print()
    print("PITCH CHECK (autocorrelation, cents_off = measured - expected)")
    for line in all_verify:
        print("  " + line)
    print()
    print("CREDITS")
    for name, credit in CREDITS.items():
        print(f"  {name:6s}: {credit}")


if __name__ == "__main__":
    main()
