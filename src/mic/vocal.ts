import { VOICE_WORKLET } from './voiceWorklet';

export interface VoiceReport {
  f0: number;
  midi: number;
  target: number;
  level: number;
  gate: number;
}

export type ReverbKind = 'sala' | 'plate' | 'estadio';

/** Every knob of the vocal chain, in musician units. */
export interface VoiceSettings {
  tune: number; // 0..1 correction amount
  tuneSpeed: number; // seconds to reach the note (0 = robotic)
  key: number; // 0 = C … 11 = B
  scale: 'mayor' | 'menor' | 'cromatica';
  harmonies: number[]; // diatonic steps, e.g. [2, 4] = third + fifth above
  harmonyMix: number;
  double: number; // stereo doubler 0..1
  delayMix: number;
  delayBeats: number; // 0.75 = dotted eighth
  delayFeedback: number;
  reverbMix: number;
  reverb: ReverbKind;
  warmth: number; // saturation 0..1
  radio: boolean;
  presence: number; // dB
  bass: number; // dB
}

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  settings: VoiceSettings;
}

const BASE: VoiceSettings = {
  tune: 0,
  tuneSpeed: 0.08,
  key: 0,
  scale: 'mayor',
  harmonies: [],
  harmonyMix: 0,
  double: 0,
  delayMix: 0,
  delayBeats: 0.75,
  delayFeedback: 0.3,
  reverbMix: 0.12,
  reverb: 'sala',
  warmth: 0.15,
  radio: false,
  presence: 3,
  bass: 0,
};

export const PRESETS: Preset[] = [
  { id: 'natural', name: 'Natural', blurb: 'Tu voz limpia, con un toque de sala.', settings: { ...BASE } },
  { id: 'estudio', name: 'Estudio', blurb: 'Afinación suave, voz doblada y plate brillante.', settings: { ...BASE, tune: 0.7, tuneSpeed: 0.05, double: 0.35, reverb: 'plate', reverbMix: 0.2, delayMix: 0.1, warmth: 0.25, presence: 4 } },
  { id: 'autotune', name: 'Auto-Tune', blurb: 'Salto de nota instantáneo: el efecto robótico del pop.', settings: { ...BASE, tune: 1, tuneSpeed: 0, double: 0.2, reverb: 'plate', reverbMix: 0.16, delayMix: 0.16, presence: 4 } },
  { id: 'estadio', name: 'Estadio', blurb: 'Reverb enorme y eco que rebota en las gradas.', settings: { ...BASE, tune: 0.45, tuneSpeed: 0.07, reverb: 'estadio', reverbMix: 0.32, delayMix: 0.22, delayBeats: 1, delayFeedback: 0.38, double: 0.25, warmth: 0.2 } },
  { id: 'coro', name: 'Coro', blurb: 'Dos voces más que armonizan contigo.', settings: { ...BASE, tune: 0.8, tuneSpeed: 0.04, harmonies: [2, 4], harmonyMix: 0.55, double: 0.3, reverb: 'sala', reverbMix: 0.25, delayMix: 0.08 } },
  { id: 'radio', name: 'Radio', blurb: 'Voz de radio vieja o de megáfono.', settings: { ...BASE, radio: true, warmth: 0.8, reverbMix: 0.05, presence: 0 } },
  { id: 'eco', name: 'Eco', blurb: 'Repeticiones largas que se van perdiendo.', settings: { ...BASE, tune: 0.3, delayMix: 0.38, delayBeats: 0.75, delayFeedback: 0.55, reverb: 'sala', reverbMix: 0.18 } },
];

export const KEYS = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];

const SCALE_MASK: Record<VoiceSettings['scale'], number> = {
  mayor: 0b101010110101, // C D E F G A B (bit n = pitch class n)
  menor: 0b010110101101, // C D Eb F G Ab Bb
  cromatica: 0xfff,
};

function reverbImpulse(ctx: BaseAudioContext, kind: ReverbKind): AudioBuffer {
  const cfg = { sala: [1.6, 3.2, 0.012, 0.45], plate: [2.1, 2.6, 0.004, 0.8], estadio: [4.2, 2.2, 0.045, 0.35] }[kind];
  const [seconds, decay, pre, bright] = cfg;
  const rate = ctx.sampleRate;
  const n = Math.floor(seconds * rate);
  const buf = ctx.createBuffer(2, n, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    const preN = Math.floor(pre * rate);
    for (let i = preN; i < n; i++) {
      const t = (i - preN) / rate;
      const noise = Math.random() * 2 - 1;
      // high frequencies die first, like air and soft surfaces absorbing them
      const cutoff = bright * Math.exp(-t * 2.2) + 0.05;
      lp += (noise - lp) * cutoff;
      const env = Math.pow(1 - (i - preN) / (n - preN), decay) * Math.min(1, t / 0.006);
      d[i] = lp * env;
    }
    if (kind !== 'plate') {
      for (const [ms, g] of [[9, 0.6], [15, 0.45], [23, 0.35], [34, 0.3], [47, 0.22], [61, 0.17]] as const) {
        const i = preN + Math.floor(((ms * (kind === 'estadio' ? 2.4 : 1)) + ch * 2.3) * rate / 1000);
        if (i < n) d[i] += g * (ch ? -1 : 1) * 0.5;
      }
    }
  }
  return buf;
}

function saturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  const k = 1 + amount * 6;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

/**
 * Live vocal chain: mic → high-pass → pitch correction/harmonies (AudioWorklet) → EQ →
 * compressor → warmth → doubler, with echo and reverb sends, into the band's master bus.
 */
export class VocalChain {
  readonly settings: VoiceSettings = { ...BASE };
  onReport: ((r: VoiceReport) => void) | null = null;
  running = false;
  bpm = 100;
  private stream: MediaStream | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private workletReady: Promise<void> | null = null;
  private readonly n: {
    input: GainNode;
    hpf: BiquadFilterNode;
    split: ChannelSplitterNode;
    lowMid: BiquadFilterNode;
    presence: BiquadFilterNode;
    air: BiquadFilterNode;
    bass: BiquadFilterNode;
    radioHi: BiquadFilterNode;
    radioLo: BiquadFilterNode;
    comp: DynamicsCompressorNode;
    makeup: GainNode;
    warm: WaveShaperNode;
    harm1: StereoPannerNode;
    harm2: StereoPannerNode;
    harmGain: GainNode;
    bus: GainNode;
    dblL: DelayNode;
    dblR: DelayNode;
    dblGain: GainNode;
    out: GainNode;
    delaySend: GainNode;
    delayL: DelayNode;
    delayR: DelayNode;
    fbL: GainNode;
    fbR: GainNode;
    delayTone: BiquadFilterNode;
    reverbSend: GainNode;
    convolver: ConvolverNode;
    monitor: GainNode;
    dryPath: GainNode;
    tunedPath: GainNode;
  };
  private readonly irs = new Map<ReverbKind, AudioBuffer>();

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    const c = ctx;
    const biquad = (type: BiquadFilterType, f: number, q = 0.7, g = 0) => {
      const b = c.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      b.gain.value = g;
      return b;
    };
    const n = {
      input: c.createGain(),
      hpf: biquad('highpass', 90, 0.7),
      split: c.createChannelSplitter(3),
      lowMid: biquad('peaking', 350, 1, -2.5),
      presence: biquad('peaking', 3200, 0.9, 3),
      air: biquad('highshelf', 10000, 0.7, 3),
      bass: biquad('lowshelf', 180, 0.7, 0),
      radioHi: biquad('highpass', 20, 0.9),
      radioLo: biquad('lowpass', 20000, 0.9),
      comp: c.createDynamicsCompressor(),
      makeup: c.createGain(),
      warm: c.createWaveShaper(),
      harm1: c.createStereoPanner(),
      harm2: c.createStereoPanner(),
      harmGain: c.createGain(),
      bus: c.createGain(),
      dblL: c.createDelay(0.05),
      dblR: c.createDelay(0.05),
      dblGain: c.createGain(),
      out: c.createGain(),
      delaySend: c.createGain(),
      delayL: c.createDelay(4),
      delayR: c.createDelay(4),
      fbL: c.createGain(),
      fbR: c.createGain(),
      delayTone: biquad('lowpass', 4200, 0.5),
      reverbSend: c.createGain(),
      convolver: c.createConvolver(),
      monitor: c.createGain(),
      dryPath: c.createGain(),
      tunedPath: c.createGain(),
    };
    this.n = n;
    n.comp.threshold.value = -24;
    n.comp.ratio.value = 4;
    n.comp.attack.value = 0.004;
    n.comp.release.value = 0.12;
    n.comp.knee.value = 6;
    n.makeup.gain.value = 1.9;
    n.warm.oversample = '2x';
    n.harm1.pan.value = -0.55;
    n.harm2.pan.value = 0.55;

    // lead: EQ → comp → warmth → bus. With pitch correction off the voice skips the
    // processor (lower latency, untouched signal); the processor still tracks pitch.
    n.split.connect(n.tunedPath, 0);
    n.tunedPath.connect(n.lowMid);
    n.hpf.connect(n.dryPath).connect(n.lowMid);
    n.lowMid.connect(n.bass).connect(n.presence).connect(n.air).connect(n.radioHi).connect(n.radioLo).connect(n.comp).connect(n.makeup).connect(n.warm).connect(n.bus);
    // harmonies: panned left/right under the lead
    n.split.connect(n.harm1, 1);
    n.split.connect(n.harm2, 2);
    n.harm1.connect(n.harmGain);
    n.harm2.connect(n.harmGain);
    n.harmGain.connect(n.lowMid);
    // doubler: two short modulated delays, hard-panned
    const merger = c.createChannelMerger(2);
    n.bus.connect(n.dblL);
    n.bus.connect(n.dblR);
    n.dblL.delayTime.value = 0.013;
    n.dblR.delayTime.value = 0.019;
    n.dblL.connect(merger, 0, 0);
    n.dblR.connect(merger, 0, 1);
    merger.connect(n.dblGain).connect(n.out);
    for (const [d, rate, depth] of [[n.dblL, 0.37, 0.0016], [n.dblR, 0.29, 0.0019]] as const) {
      const lfo = c.createOscillator();
      const g = c.createGain();
      lfo.frequency.value = rate;
      g.gain.value = depth;
      lfo.connect(g).connect(d.delayTime);
      lfo.start();
    }
    n.bus.connect(n.out);
    n.out.connect(n.monitor).connect(destination);
    // echo: ping-pong with darkening repeats
    const dMerge = c.createChannelMerger(2);
    n.out.connect(n.delaySend).connect(n.delayTone);
    n.delayTone.connect(n.delayL);
    n.delayL.connect(n.fbL).connect(n.delayR);
    n.delayR.connect(n.fbR).connect(n.delayL);
    n.delayL.connect(dMerge, 0, 0);
    n.delayR.connect(dMerge, 0, 1);
    dMerge.connect(destination);
    // reverb
    n.out.connect(n.reverbSend).connect(n.convolver).connect(destination);
    this.apply(this.settings);
  }

  private ir(kind: ReverbKind): AudioBuffer {
    let b = this.irs.get(kind);
    if (!b) {
      b = reverbImpulse(this.ctx, kind);
      this.irs.set(kind, b);
    }
    return b;
  }

  private async loadWorklet(): Promise<void> {
    if (!this.workletReady) {
      const url = URL.createObjectURL(new Blob([VOICE_WORKLET], { type: 'application/javascript' }));
      this.workletReady = this.ctx.audioWorklet.addModule(url);
    }
    return this.workletReady;
  }

  /** Opens the microphone. `headphones` false turns on echo cancellation to avoid feedback. */
  async start(headphones: boolean): Promise<void> {
    await this.loadWorklet();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: !headphones,
        noiseSuppression: !headphones,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'tarima-voice', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [3] });
    this.node.port.onmessage = (e) => this.onReport?.(e.data as VoiceReport);
    this.src.connect(this.n.input).connect(this.n.hpf).connect(this.node).connect(this.n.split);
    this.n.monitor.gain.value = headphones ? 1 : 0.55;
    this.running = true;
    this.apply(this.settings);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.src?.disconnect();
    this.node?.disconnect();
    this.stream = null;
    this.src = null;
    this.node = null;
    this.running = false;
  }

  /** Melody note the singer should be on (guided songs), or -1 for free singing. */
  guide(midi: number): void {
    this.node?.port.postMessage({ guide: midi });
  }

  apply(s: Partial<VoiceSettings>): void {
    Object.assign(this.settings, s);
    const v = this.settings;
    const n = this.n;
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, val: number) => p.setTargetAtTime(val, t, 0.03);
    this.node?.port.postMessage({
      enabled: true,
      amount: v.tune,
      speed: v.tuneSpeed,
      key: v.key,
      scale: SCALE_MASK[v.scale],
      harmonies: v.harmonies,
      harmonyMix: v.harmonyMix,
    });
    set(n.harmGain.gain, v.harmonies.length ? v.harmonyMix : 0);
    const tuned = v.tune > 0 || v.harmonies.length > 0;
    set(n.tunedPath.gain, tuned ? 1 : 0);
    set(n.dryPath.gain, tuned ? 0 : 1);
    set(n.presence.gain, v.presence);
    set(n.bass.gain, v.bass);
    set(n.radioHi.frequency, v.radio ? 420 : 20);
    set(n.radioLo.frequency, v.radio ? 3200 : 20000);
    n.warm.curve = saturationCurve(v.radio ? 0.9 : v.warmth);
    set(n.dblGain.gain, v.double * 0.55);
    set(n.delaySend.gain, v.delayMix);
    const beat = 60 / this.bpm;
    const dt = Math.min(3.5, beat * v.delayBeats);
    set(n.delayL.delayTime, dt);
    set(n.delayR.delayTime, dt);
    set(n.fbL.gain, v.delayFeedback);
    set(n.fbR.gain, v.delayFeedback);
    set(n.reverbSend.gain, v.reverbMix);
    const ir = this.ir(v.reverb);
    if (n.convolver.buffer !== ir) n.convolver.buffer = ir;
  }

  /** False while muted. */
  volumeOn = true;

  set volume(v: number) {
    this.volumeOn = v > 0;
    this.n.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }
}
