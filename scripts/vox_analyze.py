"""Objective check of the vocal chain: pitch accuracy (cents), periodicity and timbre vs the input."""
import sys, numpy as np, soundfile as sf

SR = 48000

def yin(x, sr=SR, fmin=85, fmax=1000, win=1536, hop=480):
    tmin, tmax = int(sr / fmax), int(sr / fmin)
    out = []
    for s in range(0, len(x) - win - tmax, hop):
        seg = x[s:s + win + tmax]
        if np.sqrt(np.mean(seg[:win] ** 2)) < 0.01:
            out.append((0, 0)); continue
        d = np.array([np.sum((seg[:win] - seg[t:t + win]) ** 2) for t in range(tmax + 1)])
        cm = np.ones_like(d); cm[1:] = d[1:] * np.arange(1, tmax + 1) / np.maximum(np.cumsum(d[1:]), 1e-12)
        cand = np.where(cm[tmin:tmax] < 0.12)[0]
        if len(cand):
            t = cand[0] + tmin
            while t + 1 < tmax and cm[t + 1] < cm[t]: t += 1
        else:
            t = np.argmin(cm[tmin:tmax]) + tmin
            if cm[t] > 0.25: out.append((0, 0)); continue
        a, b, c = cm[t - 1], cm[t], cm[t + 1]
        den = a - 2 * b + c
        sh = 0.5 * (a - c) / den if den else 0
        out.append((sr / (t + sh), 1 - cm[t]))
    return np.array(out)

def cents_off(f):
    m = 69 + 12 * np.log2(f / 440)
    return (m - np.round(m)) * 100

def envelope(x):
    spec = np.abs(np.fft.rfft(x[:len(x) // 4096 * 4096].reshape(-1, 4096) * np.hanning(4096), axis=1)).mean(0)
    k = 40
    sm = np.convolve(20 * np.log10(spec + 1e-9), np.ones(k) / k, mode='same')
    freqs = np.fft.rfftfreq(4096, 1 / SR)
    band = (freqs > 200) & (freqs < 5000)
    return sm[band] - sm[band].mean()

inp, _ = sf.read('.cache/vox/test_voice.wav')
p_in = yin(inp)
v_in = p_in[:, 0] > 0
env_in = envelope(inp)
print(f"input  : voiced {v_in.mean():.2f}  |cents| {np.abs(cents_off(p_in[v_in, 0])).mean():5.1f}  periodicity {p_in[v_in, 1].mean():.3f}")
for name in sys.argv[1:]:
    raw = np.fromfile(f'.cache/vox/out_{name}.f32', dtype=np.float32).reshape(-1, 2)
    y = raw.mean(1)
    # the fake mic loops the file; analyse one clean pass
    y = y[:int(7.4 * SR)] if len(y) > 7.4 * SR else y
    p = yin(y)
    v = p[:, 0] > 0
    c = np.abs(cents_off(p[v, 0])) if v.any() else np.array([99])
    corr = np.corrcoef(env_in, envelope(y))[0, 1]
    print(f"{name:7s}: voiced {v.mean():.2f}  |cents| {c.mean():5.1f} (p90 {np.percentile(c, 90):4.1f})  periodicity {p[v, 1].mean():.3f}  timbre r={corr:.2f}  rms {np.sqrt(np.mean(y**2)):.3f}")
