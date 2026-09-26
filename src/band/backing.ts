import type { Accompanist } from '../mic/station';
import { chordNotes, type KSong } from '../songs/karaoke';
import { Sampler } from './sampler';

/** Closest voicing of the chord's pitch classes inside [lo, hi] (close position). */
function voicing(pcs: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (const pc of pcs) {
    let m = lo + ((pc - lo) % 12 + 12) % 12;
    while (m > hi) m -= 12;
    out.push(m);
  }
  return out.sort((a, b) => a - b);
}

function rootIn(pc: number, lo: number): number {
  return lo + ((pc - lo) % 12 + 12) % 12;
}

/**
 * Piano + bass that follow a song's chords in its groove: waltz comping (bass on one, chords on
 * two and three), ballad (held chords with a pulse) or pop (pushed eighths).
 */
export class BackingBand implements Accompanist {
  readonly piano: Sampler;
  readonly bass: Sampler;
  enabled = true;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.piano = new Sampler(ctx, 'piano', destination, 0.5);
    this.bass = new Sampler(ctx, 'bass', destination, 0.62);
  }

  async load(base: string): Promise<void> {
    await Promise.all([this.piano.load(base), this.bass.load(base)]);
  }

  schedule(song: KSong, fromBeat: number, toBeat: number, beatToTime: (b: number) => number): void {
    if (!this.enabled || !this.piano.ready) return;
    const spb = 60 / song.bpm;
    const bpb = song.beatsPerBar;
    const firstBar = bpb; // bar 0 is the count-in
    for (let i = 0; i < song.chords.length; i++) {
      const c = song.chords[i];
      const next = song.chords[i + 1]?.beat ?? Math.min(song.length, c.beat + bpb);
      const len = next - c.beat;
      if (c.beat < firstBar) continue;
      const pcs = chordNotes(c.chord);
      const chord = voicing(pcs, 55, 67);
      const low = rootIn(pcs[0], 28);
      const fifth = rootIn((pcs[0] + 7) % 12, 35);
      const hits: { beat: number; notes: number[]; dur: number; vel: number; inst: 'p' | 'b' }[] = [];
      if (song.groove === 'vals') {
        for (let b = 0; b < len; b += bpb) {
          hits.push({ beat: c.beat + b, notes: [low], dur: bpb * 0.9, vel: 0.75, inst: 'b' });
          hits.push({ beat: c.beat + b, notes: [rootIn(pcs[0], 43)], dur: 0.9, vel: 0.55, inst: 'p' });
          for (let k = 1; k < Math.min(bpb, len - b); k++) hits.push({ beat: c.beat + b + k, notes: chord, dur: 0.8, vel: 0.45, inst: 'p' });
        }
      } else if (song.groove === 'balada') {
        hits.push({ beat: c.beat, notes: chord, dur: len * 0.95, vel: 0.55, inst: 'p' });
        hits.push({ beat: c.beat, notes: [low], dur: Math.min(len, 2) * 0.9, vel: 0.75, inst: 'b' });
        if (len >= 4) hits.push({ beat: c.beat + 2, notes: [fifth], dur: 1.8, vel: 0.62, inst: 'b' });
        for (let b = 1; b < len; b += 2) hits.push({ beat: c.beat + b + 0.5, notes: chord.slice(1), dur: 0.4, vel: 0.3, inst: 'p' });
      } else {
        for (let b = 0; b < len; b++) hits.push({ beat: c.beat + b, notes: [b % 2 ? fifth : low], dur: 0.8, vel: 0.72, inst: 'b' });
        for (const off of [0, 1.5, 3]) if (off < len) hits.push({ beat: c.beat + off, notes: chord, dur: 0.6, vel: 0.5, inst: 'p' });
      }
      for (const h of hits) {
        if (h.beat < fromBeat || h.beat >= toBeat) continue;
        const when = beatToTime(h.beat);
        const inst = h.inst === 'p' ? this.piano : this.bass;
        // a touch of human spread on chords
        h.notes.forEach((n, k) => inst.play(n, h.vel * (1 - k * 0.06), when + k * 0.006, h.dur * spb));
      }
    }
  }

  stop(): void {
    this.piano.stopAll();
    this.bass.stopAll();
  }
}
