import manifestJson from './manifest.json';

interface SampleEntry {
  file: string;
  peak: number;
  rms: number;
  dur: number;
}

interface Manifest {
  source: string;
  pieces: Record<string, Record<string, SampleEntry[]>>;
}

const manifest = manifestJson as Manifest;

interface LoadedSample extends SampleEntry {
  buffer: AudioBuffer;
  /** Seconds to skip at the start (codec padding / pre-roll silence). */
  offset: number;
}

export type Zone = 'hit' | 'center' | 'edge' | 'rim' | 'closed' | 'half' | 'open' | 'pedal' | 'bow' | 'bell';

interface SoundRef {
  set: string;
  art: string;
  rate?: number;
  gain?: number;
}

/** Which recorded articulation each piece/zone plays. Tom 2 is Tom 1 tuned down a minor third. */
const SOUNDS: Record<string, Partial<Record<Zone, SoundRef>>> = {
  kick: { hit: { set: 'kick', art: 'hit' } },
  snare: { center: { set: 'snare', art: 'center' }, edge: { set: 'snare', art: 'edge' }, rim: { set: 'snare', art: 'rim' } },
  tom1: { center: { set: 'tom', art: 'center', rate: 1.04 }, rim: { set: 'tom', art: 'center', rate: 1.04, gain: 1.15 } },
  tom2: { center: { set: 'tom', art: 'center', rate: 0.86 }, rim: { set: 'tom', art: 'center', rate: 0.86, gain: 1.15 } },
  floor: { center: { set: 'floor', art: 'center' }, rim: { set: 'floor', art: 'rim' } },
  hihat: { closed: { set: 'hihat', art: 'closed' }, half: { set: 'hihat', art: 'half' }, open: { set: 'hihat', art: 'open' } },
  hhpedal: { pedal: { set: 'hihat', art: 'pedal', gain: 1.1 } },
  crash: { hit: { set: 'crash', art: 'hit', rate: 1.03 } },
  crash2: { hit: { set: 'crash', art: 'hit', rate: 0.9, gain: 1.05 } },
  ride: { bow: { set: 'ride', art: 'bow' }, bell: { set: 'ride', art: 'bell', gain: 0.95 } },
};

/** Mix balance per piece (drummer's perspective pan for pieces that reuse another's samples). */
const MIX: Record<string, { gain: number; pan: number }> = {
  kick: { gain: 1.0, pan: 0 },
  snare: { gain: 0.9, pan: 0 },
  tom1: { gain: 0.95, pan: -0.1 },
  tom2: { gain: 0.95, pan: 0.15 },
  floor: { gain: 1.0, pan: 0 },
  hihat: { gain: 0.72, pan: 0 },
  hhpedal: { gain: 0.72, pan: 0 },
  crash: { gain: 0.72, pan: -0.15 },
  crash2: { gain: 0.72, pan: 0.45 },
  ride: { gain: 0.66, pan: 0 },
};

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  zone: Zone;
  start: number;
}

/** Stand-in clock for browsers without Web Audio: the kit still plays visually. */
class SilentContext {
  state = 'running';
  sampleRate = 48000;
  baseLatency = 0;
  get currentTime(): number {
    return performance.now() / 1000;
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

export class AudioEngine {
  readonly ctx: AudioContext;
  /** False when the browser has no Web Audio: every call becomes a silent no-op. */
  readonly available: boolean;
  private readonly samples = new Map<string, LoadedSample[]>();
  private readonly buses = new Map<string, AudioNode>();
  private readonly voices = new Map<string, Voice[]>();
  private readonly lastPick = new Map<string, number>();
  private readonly master!: GainNode;
  private readonly roomSend!: GainNode;
  loaded = false;

  constructor() {
    // iOS: play through the silent switch like a music app
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try {
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* not supported */
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let ctx: AudioContext | null = null;
    try {
      ctx = Ctx ? new Ctx({ latencyHint: 'interactive' }) : null;
    } catch {
      ctx = null;
    }
    this.available = !!ctx;
    this.ctx = ctx ?? (new SilentContext() as unknown as AudioContext);
    if (!ctx) return;

    const drumBus = ctx.createGain();
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.006;
    glue.release.value = 0.14;
    glue.knee.value = 8;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.06;
    drumBus.connect(glue).connect(this.master).connect(limiter).connect(ctx.destination);

    // a little extra room on top of the recorded room mics
    const convolver = ctx.createConvolver();
    convolver.buffer = this.impulse(1.5, 2.6);
    this.roomSend = ctx.createGain();
    this.roomSend.gain.value = 0.14;
    drumBus.connect(this.roomSend).connect(convolver).connect(this.master);

    for (const [piece, mix] of Object.entries(MIX)) {
      const g = ctx.createGain();
      g.gain.value = mix.gain;
      let out: AudioNode = g;
      if (mix.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = mix.pan;
        g.connect(p);
        out = p;
      }
      out.connect(drumBus);
      this.buses.set(piece, g);
    }
  }

  /** Synthetic stereo room impulse: early reflections + exponential tail, darker over time. */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const n = Math.floor(seconds * rate);
    const buf = this.ctx.createBuffer(2, n, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const noise = Math.random() * 2 - 1;
        const cutoff = 0.5 * Math.exp(-t * 3) + 0.04;
        lp += (noise - lp) * cutoff;
        d[i] = lp * Math.pow(1 - t / seconds, decay) * (t < 0.008 ? t / 0.008 : 1);
      }
      for (const [ms, g] of [[11, 0.5], [17, 0.35], [23, 0.3], [31, 0.22], [43, 0.16]] as const) {
        const i = Math.floor(((ms + ch * 1.7) / 1000) * rate);
        if (i < n) d[i] += g * (ch ? -1 : 1);
      }
    }
    return buf;
  }

  get volume(): number {
    return this.available ? this.master.gain.value : 0;
  }

  set volume(v: number) {
    if (this.available) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  set room(v: number) {
    if (this.available) this.roomSend.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Must run inside a user gesture (iOS/Safari). */
  unlock(): void {
    if (!this.available) return;
    if (this.ctx.state !== 'running') void this.ctx.resume();
    const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.connect(this.ctx.destination);
    s.start(0);
  }

  /** Resume after iOS interrupts the context (calls, app switch). Call on every touch. */
  wake(): void {
    if (!this.available) return;
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  async load(baseUrl: string, onProgress: (done: number, total: number) => void): Promise<void> {
    if (!this.available) {
      onProgress(1, 1);
      this.loaded = true;
      return;
    }
    const jobs: { key: string; entry: SampleEntry; idx: number }[] = [];
    for (const [set, arts] of Object.entries(manifest.pieces)) {
      for (const [art, entries] of Object.entries(arts)) {
        const key = `${set}/${art}`;
        this.samples.set(key, new Array(entries.length));
        entries.forEach((entry, idx) => jobs.push({ key, entry, idx }));
      }
    }
    let done = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        const buffer = await this.fetchDecode(baseUrl + job.entry.file);
        this.samples.get(job.key)![job.idx] = { ...job.entry, buffer, offset: this.onset(buffer) };
        done++;
        onProgress(done, jobs.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    this.loaded = true;
  }

  private async fetchDecode(url: string): Promise<AudioBuffer> {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.arrayBuffer();
        return await new Promise<AudioBuffer>((resolve, reject) => {
          // callback form works on older Safari too
          const p = this.ctx.decodeAudioData(data, resolve, reject);
          if (p && typeof p.then === 'function') p.then(resolve, reject);
        });
      } catch (err) {
        if (attempt >= 2) throw err;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }

  /** First sample that rises out of the codec padding, minus 1 ms so the transient stays whole. */
  private onset(b: AudioBuffer): number {
    const a = b.getChannelData(0);
    const c = b.numberOfChannels > 1 ? b.getChannelData(1) : a;
    let peak = 0;
    const scan = Math.min(a.length, Math.floor(b.sampleRate * 0.2));
    for (let i = 0; i < scan; i++) peak = Math.max(peak, Math.abs(a[i]), Math.abs(c[i]));
    const th = Math.max(0.0015, peak * 0.04);
    for (let i = 0; i < scan; i++) {
      if (Math.abs(a[i]) > th || Math.abs(c[i]) > th) return Math.max(0, i / b.sampleRate - 0.001);
    }
    return 0;
  }

  /**
   * Plays a hit. `velocity` 0..1 picks both the recorded dynamic layer (timbre) and the level.
   * Returns false if the piece/zone has no sound.
   */
  play(piece: string, zone: Zone, velocity: number, when = 0): boolean {
    if (!this.available) return false;
    const ref = SOUNDS[piece]?.[zone] ?? Object.values(SOUNDS[piece] ?? {})[0];
    if (!ref) return false;
    const list = this.samples.get(`${ref.set}/${ref.art}`);
    if (!list || !list.length || !list[0]) return false;
    const v = Math.min(1, Math.max(0.02, velocity));
    const n = list.length;
    const target = Math.pow(v, 0.85) * (n - 1);
    // candidates within reach of the target layer, avoid repeating the last one (machine gun)
    const key = `${piece}/${zone}`;
    const last = this.lastPick.get(key) ?? -1;
    const cands: number[] = [];
    for (let i = 0; i < n; i++) if (Math.abs(i - target) <= 1.6 && i !== last) cands.push(i);
    const idx = cands.length ? cands[Math.floor(Math.random() * cands.length)] : Math.round(target);
    this.lastPick.set(key, idx);
    const s = list[idx];
    const lo = Math.floor(target), hi = Math.min(n - 1, lo + 1);
    const targetRms = list[lo].rms + (list[hi].rms - list[lo].rms) * (target - lo);
    const corr = Math.min(1.35, Math.max(0.7, targetRms / s.rms));
    const level = corr * (0.5 + 0.5 * v) * (ref.gain ?? 1);

    const ctx = this.ctx;
    const t = when || ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.playbackRate.value = (ref.rate ?? 1) * (1 + (Math.random() - 0.5) * 0.012);
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(g).connect(this.buses.get(piece)!);

    // hi-hat physics: a closed hit or the pedal chokes a ringing open hat
    if (piece === 'hihat' || piece === 'hhpedal') {
      if (zone === 'closed' || zone === 'pedal') {
        this.fade('hihat', 0.06, t, (vo) => vo.zone === 'open' || vo.zone === 'half');
      }
      if (zone === 'open' || zone === 'half') this.fade('hihat', 0.05, t, (vo) => vo.zone === 'open' || vo.zone === 'half');
    }
    src.start(t, s.offset);
    const bucket = piece === 'hhpedal' ? 'hihat' : piece;
    const voices = this.voices.get(bucket) ?? [];
    voices.push({ src, gain: g, zone, start: t });
    // polyphony cap per piece keeps rolls light on phones
    const cap = piece.startsWith('crash') || piece === 'ride' ? 6 : 10;
    while (voices.length > cap) {
      const old = voices.shift()!;
      this.stopVoice(old, 0.04, t);
    }
    this.voices.set(bucket, voices);
    src.onended = () => {
      const arr = this.voices.get(bucket);
      if (!arr) return;
      const i = arr.findIndex((vo) => vo.src === src);
      if (i >= 0) arr.splice(i, 1);
    };
    return true;
  }

  private stopVoice(vo: Voice, time: number, at: number): void {
    try {
      vo.gain.gain.cancelScheduledValues(at);
      vo.gain.gain.setValueAtTime(vo.gain.gain.value, at);
      vo.gain.gain.setTargetAtTime(0, at, time / 3);
      vo.src.stop(at + time * 2 + 0.02);
    } catch {
      /* already stopped */
    }
  }

  private fade(bucket: string, time: number, at: number, filter: (v: Voice) => boolean = () => true): void {
    const voices = this.voices.get(bucket);
    if (!voices) return;
    for (const vo of voices) if (filter(vo)) this.stopVoice(vo, time, at);
  }

  /** Hand grabbing a cymbal: kill its ring quickly. */
  choke(piece: string): void {
    if (!this.available) return;
    this.fade(piece, 0.09, this.ctx.currentTime);
  }

  /** How long a sound takes from start() to the speaker (for rhythm judging). */
  get latency(): number {
    const c = this.ctx as AudioContext & { outputLatency?: number };
    return (c.baseLatency || 0) + (c.outputLatency || 0);
  }

  /** Short woodblock-ish click for the metronome. */
  click(when: number, accent: boolean): void {
    if (!this.available) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(accent ? 1760 : 1320, when);
    o.frequency.exponentialRampToValueAtTime(accent ? 1400 : 1000, when + 0.03);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0008, when + 0.05);
    o.connect(g).connect(this.master);
    o.start(when);
    o.stop(when + 0.06);
  }
}
