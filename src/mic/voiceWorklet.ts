/**
 * AudioWorklet source for the vocal processor, kept as a string so the single-file build can
 * load it from a Blob URL.
 *
 * Per 128-sample block it: gates room noise, tracks pitch with YIN on a 2x-decimated copy,
 * picks a target note (melody note in guided songs, else the nearest note of the key), and
 * re-synthesizes the voice with TD-PSOLA — pitch-synchronous grains moved closer together or
 * further apart — which shifts pitch while keeping the singer's formants (no chipmunk effect).
 * Two extra PSOLA streams render diatonic harmonies from the same grains.
 *
 * Outputs 3 channels: corrected lead, harmony 1, harmony 2.
 */
export const VOICE_WORKLET = /* js */ `
const RING = 16384, MASK = RING - 1;

class TarimaVoice extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    this.sr = sr;
    this.inBuf = new Float32Array(RING);
    this.lpBuf = new Float32Array(RING);
    this.t = 0;
    this.lp = 0;
    this.dec = new Float32Array(4096);
    this.dw = 0;
    this.decPrev = 0;
    this.sinceDetect = 0;
    this.minF = 85;
    this.maxF = 1000;
    this.L = Math.ceil(2 * sr / this.minF) + 16;
    this.voices = [0, 1, 2].map(() => ({ acc: new Float32Array(RING), ws: new Float32Array(RING), next: 0, ratio: 1, lastAna: 0 }));
    this.period = 0;
    this.voiced = false;
    this.f0 = 0;
    this.conf = 0;
    this.midi = 0;
    this.targetMidi = -1;
    this.ratio = 1;
    this.env = 0;
    this.gate = 0;
    this.p = { enabled: true, amount: 0, speed: 0.04, key: 0, scale: 0xAB5, harmonies: [], harmonyMix: 0, gateDb: -52, guide: -1 };
    this.reportEvery = Math.round(sr * 0.03);
    this.sinceReport = 0;
    this.port.onmessage = (e) => Object.assign(this.p, e.data);
    for (const v of this.voices) v.next = this.L;
  }

  /** YIN on the decimated ring. Returns period in full-rate samples, or 0 when unvoiced. */
  detect() {
    const fs2 = this.sr / 2;
    const W = 768;
    const tmin = Math.max(2, Math.floor(fs2 / this.maxF));
    const tmax = Math.min(600, Math.ceil(fs2 / this.minF));
    const n = W + tmax + 2;
    const d = this.dec, dm = 4095;
    const start = (this.dw - n) & dm;
    const x = this.scratch || (this.scratch = new Float32Array(1400));
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const v = d[(start + i) & dm];
      x[i] = v;
      if (i < W) energy += v * v;
    }
    if (energy / W < 1e-6) return 0;
    const cm = this.cm || (this.cm = new Float32Array(700));
    let run = 0, best = -1, bestVal = 1;
    cm[0] = 1;
    for (let tau = 1; tau <= tmax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const df = x[j] - x[j + tau];
        s += df * df;
      }
      run += s;
      cm[tau] = run > 0 ? (s * tau) / run : 1;
    }
    for (let tau = tmin; tau < tmax; tau++) {
      if (cm[tau] < 0.13) {
        while (tau + 1 < tmax && cm[tau + 1] < cm[tau]) tau++;
        best = tau;
        bestVal = cm[tau];
        break;
      }
    }
    if (best < 0) {
      for (let tau = tmin; tau < tmax; tau++) if (cm[tau] < bestVal) { bestVal = cm[tau]; best = tau; }
      if (bestVal > 0.3) { this.conf = 0; return 0; }
    }
    const a = cm[best - 1], b = cm[best], c = cm[best + 1];
    const den = a - 2 * b + c;
    const shift = den !== 0 ? 0.5 * (a - c) / den : 0;
    this.conf = 1 - bestVal;
    return (best + Math.max(-0.5, Math.min(0.5, shift))) * 2;
  }

  /** Nearest allowed note, with a little stickiness so it doesn't flutter between two notes. */
  pickTarget(midi) {
    const p = this.p;
    if (p.guide >= 0 && Math.abs(midi - p.guide) < 2.5) return p.guide;
    let best = -1, bestD = 99;
    const base = Math.round(midi);
    for (let k = -2; k <= 2; k++) {
      const m = base + k;
      const pc = ((m - p.key) % 12 + 12) % 12;
      if (!((p.scale >> pc) & 1)) continue;
      const dd = Math.abs(m - midi);
      if (dd < bestD) { bestD = dd; best = m; }
    }
    if (this.targetMidi >= 0 && best !== this.targetMidi && Math.abs(midi - this.targetMidi) < bestD + 0.35) return this.targetMidi;
    return best < 0 ? Math.round(midi) : best;
  }

  /** Semitone offset of the note 'steps' scale degrees above 'midi' in the current key. */
  diatonic(midi, steps) {
    const p = this.p;
    let m = Math.round(midi), taken = 0;
    const dir = steps >= 0 ? 1 : -1;
    for (let guard = 0; guard < 40 && taken < Math.abs(steps); guard++) {
      m += dir;
      const pc = ((m - p.key) % 12 + 12) % 12;
      if ((p.scale >> pc) & 1) taken++;
    }
    return m - Math.round(midi);
  }

  addGrain(v, mark, T) {
    const inB = this.inBuf, lpB = this.lpBuf;
    // analysis marks march at the detected period; snap each to the local waveform peak
    const limit = this.t - T - 2;
    let a;
    if (!this.voiced) {
      // unvoiced: grains stay time-aligned, so the overlap-add is a clean pass-through
      a = Math.min(mark, limit);
      v.lastAna = a;
    } else {
      while (v.lastAna + T <= mark) v.lastAna += T;
      a = (mark - v.lastAna < T * 0.5) ? v.lastAna : v.lastAna + T;
      if (a > limit) a = limit;
    }
    if (this.voiced) {
      const r = Math.floor(T * 0.2);
      let bi = a, bv = -1;
      for (let k = -r; k <= r; k++) {
        const val = Math.abs(lpB[(Math.round(a) + k) & MASK]);
        if (val > bv) { bv = val; bi = Math.round(a) + k; }
      }
      if (bi <= limit) a = bi;
    }
    v.lastAna = a;
    const Ti = Math.round(T), ai = Math.round(a), mi = Math.round(mark);
    const acc = v.acc, ws = v.ws;
    const inv = Math.PI / Ti;
    for (let k = -Ti; k < Ti; k++) {
      const w = 0.5 + 0.5 * Math.cos(k * inv);
      const idx = (mi + k) & MASK;
      acc[idx] += inB[(ai + k) & MASK] * w;
      ws[idx] += w;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const out = outputs[0];
    const n = out[0].length;
    const p = this.p;
    const sr = this.sr;
    // 1) ingest + noise gate envelope + decimation for pitch tracking
    for (let i = 0; i < n; i++) {
      let x = input ? input[i] : 0;
      const ax = Math.abs(x);
      this.env += (ax - this.env) * (ax > this.env ? 0.02 : 0.0015);
      const open = 20 * Math.log10(this.env + 1e-9) > p.gateDb;
      this.gate += ((open ? 1 : 0) - this.gate) * (open ? 0.01 : 0.0008);
      x *= this.gate;
      const ti = this.t & MASK;
      this.inBuf[ti] = x;
      this.lp += (x - this.lp) * 0.12;
      this.lpBuf[ti] = this.lp;
      if (this.t & 1) {
        this.dec[this.dw & 4095] = 0.5 * (this.decPrev + x);
        this.dw++;
      } else this.decPrev = x;
      this.t++;
    }
    this.sinceDetect += n;
    if (this.sinceDetect >= 512) {
      this.sinceDetect = 0;
      const per = this.gate > 0.2 ? this.detect() : 0;
      if (per > 0) {
        const f = sr / per;
        this.period = this.voiced ? this.period * 0.5 + per * 0.5 : per;
        this.voiced = true;
        this.f0 = f;
        this.midi = 69 + 12 * Math.log2(f / 440);
        this.targetMidi = this.pickTarget(this.midi);
        const want = Math.pow(2, ((this.targetMidi - this.midi) * p.amount) / 12);
        const k = p.speed <= 0.001 ? 1 : 1 - Math.exp(-512 / (p.speed * sr));
        this.ratio += (want - this.ratio) * k;
      } else {
        this.voiced = false;
        this.f0 = 0;
        this.ratio += (1 - this.ratio) * 0.3;
      }
    }
    // 2) PSOLA synthesis for lead + harmonies
    const sEnd = this.t - this.L;
    const T = this.voiced ? this.period : 256;
    const harm = p.harmonies || [];
    for (let vi = 0; vi < 3; vi++) {
      const v = this.voices[vi];
      let ratio = this.ratio;
      if (vi > 0) {
        const steps = harm[vi - 1];
        if (steps === undefined || !this.voiced || p.harmonyMix <= 0) { v.next = Math.max(v.next, sEnd + T); continue; }
        ratio *= Math.pow(2, this.diatonic(this.targetMidi, steps) / 12);
      }
      if (!p.enabled) ratio = 1;
      const step = this.voiced ? T / ratio : T;
      let guard = 0;
      while (v.next - T <= sEnd && guard++ < 64) {
        this.addGrain(v, v.next, T);
        v.next += step;
      }
    }
    // 3) read out (normalized overlap-add), clear consumed samples
    const s0 = this.t - this.L - n;
    for (let vi = 0; vi < 3; vi++) {
      const o = out[vi];
      const v = this.voices[vi];
      if (!o) continue;
      for (let i = 0; i < n; i++) {
        const idx = (s0 + i) & MASK;
        const w = v.ws[idx];
        o[i] = w > 1e-3 ? v.acc[idx] / Math.max(w, 0.35) : 0;
        v.acc[idx] = 0;
        v.ws[idx] = 0;
      }
    }
    this.sinceReport += n;
    if (this.sinceReport >= this.reportEvery) {
      this.sinceReport = 0;
      this.port.postMessage({ f0: this.voiced ? this.f0 : 0, midi: this.voiced ? this.midi : -1, target: this.voiced ? this.targetMidi : -1, level: this.env, gate: this.gate, conf: this.conf });
    }
    return true;
  }
}
registerProcessor('tarima-voice', TarimaVoice);
`;
