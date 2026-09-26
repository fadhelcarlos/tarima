import manifestJson from '../audio/tonal-manifest.json';

interface Entry {
  midi: number;
  file: string;
  rms: number;
}

interface TonalManifest {
  source: Record<string, string>;
  instruments: Record<string, Entry[]>;
}

const manifest = manifestJson as TonalManifest;

interface Loaded extends Entry {
  buffer: AudioBuffer;
  offset: number;
}

/**
 * Multi-sampled tonal instrument: each note plays the nearest recorded pitch, re-pitched by
 * playback rate, with a short release when it's let go.
 */
export class Sampler {
  private notes: Loaded[] = [];
  private readonly voices = new Set<{ src: AudioBufferSourceNode; gain: GainNode }>();
  readonly out: GainNode;

  constructor(private readonly ctx: AudioContext, readonly name: string, destination: AudioNode, level = 1) {
    this.out = ctx.createGain();
    this.out.gain.value = level;
    this.out.connect(destination);
  }

  get ready(): boolean {
    return this.notes.length > 0;
  }

  async load(base: string): Promise<void> {
    const list = manifest.instruments[this.name] ?? [];
    const loaded = await Promise.all(
      list.map(async (e) => {
        const res = await fetch(base + e.file);
        const data = await res.arrayBuffer();
        const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
          const p = this.ctx.decodeAudioData(data, resolve, reject);
          if (p && typeof p.then === 'function') p.then(resolve, reject);
        });
        return { ...e, buffer, offset: onset(buffer) };
      }),
    );
    this.notes = loaded.sort((a, b) => a.midi - b.midi);
  }

  /** Plays `midi` at `when` for `dur` seconds (release after). */
  play(midi: number, velocity: number, when: number, dur: number): void {
    if (!this.notes.length) return;
    let best = this.notes[0];
    for (const n of this.notes) if (Math.abs(n.midi - midi) < Math.abs(best.midi - midi)) best = n;
    const src = this.ctx.createBufferSource();
    src.buffer = best.buffer;
    src.playbackRate.value = Math.pow(2, (midi - best.midi) / 12);
    const g = this.ctx.createGain();
    const level = 0.25 + 0.75 * velocity;
    g.gain.setValueAtTime(level, when);
    const end = when + Math.max(0.05, dur);
    g.gain.setValueAtTime(level, end);
    g.gain.setTargetAtTime(0, end, 0.09);
    src.connect(g).connect(this.out);
    src.start(when, best.offset);
    src.stop(end + 0.6);
    const voice = { src, gain: g };
    this.voices.add(voice);
    src.onended = () => this.voices.delete(voice);
  }

  stopAll(): void {
    const t = this.ctx.currentTime;
    for (const v of this.voices) {
      try {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setTargetAtTime(0, t, 0.04);
        v.src.stop(t + 0.2);
      } catch {
        /* already stopped */
      }
    }
    this.voices.clear();
  }
}

function onset(b: AudioBuffer): number {
  const a = b.getChannelData(0);
  let peak = 0;
  const scan = Math.min(a.length, Math.floor(b.sampleRate * 0.2));
  for (let i = 0; i < scan; i++) peak = Math.max(peak, Math.abs(a[i]));
  const th = Math.max(0.001, peak * 0.03);
  for (let i = 0; i < scan; i++) if (Math.abs(a[i]) > th) return Math.max(0, i / b.sampleRate - 0.001);
  return 0;
}

export const TONAL_CREDITS = manifest.source;
