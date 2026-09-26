import * as THREE from 'three';
import type { AudioEngine, Zone } from '../audio/engine';
import type { Kit, PieceId } from '../scene/kit';
import type { Lesson } from './lessons';

export type Grade = 'perfect' | 'good' | 'early' | 'late' | 'miss' | 'hit';

export interface Stats {
  total: number;
  judged: number;
  perfect: number;
  good: number;
  off: number;
  miss: number;
  streak: number;
  best: number;
  accuracy: number;
  pass: number;
  passes: number;
}

export interface NoteInst {
  time: number; // song seconds
  piece: PieceId;
  zone: Zone;
  velocity: number;
  state: 'pending' | 'done';
  grade?: Grade;
  judgedAt?: number; // song seconds
  demoFired?: boolean;
  ring?: THREE.Mesh;
}

interface Cue {
  parent: THREE.Object3D;
  position: THREE.Vector3;
  radius: number;
}

const WINDOW = 0.17;
const DEFAULT_COUNT_IN = 16; // one bar of clicks

const RING_GEO = (() => {
  const g = new THREE.RingGeometry(0.925, 1, 72);
  g.rotateX(-Math.PI / 2);
  return g;
})();

const COLOR_APPROACH = new THREE.Color('#f3e6c8');
const COLOR_PERFECT = new THREE.Color('#e8b45a');
const COLOR_GOOD = new THREE.Color('#f3ede4');
const COLOR_OFF = new THREE.Color('#8f8579');
const COLOR_MISS = new THREE.Color('#4a4440');

export interface CoachEvents {
  judge: (piece: PieceId, grade: Grade) => void;
  section: (name: string, upcoming: boolean) => void;
  streak: (n: number) => void;
  stats: (s: Stats) => void;
  countIn: (beatsLeft: number) => void;
  finish: (s: Stats) => void;
  demoHit: (piece: PieceId, zone: Zone, velocity: number) => void;
}

/**
 * Rhythm coach: approach rings close onto each drum exactly when it should be hit, the kit can
 * play the lesson by itself, and "wait for me" pauses the song until the right drum is hit.
 */
export class Coach {
  lesson: Lesson | null = null;
  bpm = 80;
  wait = false;
  demo = false;
  running = false;
  /** 'easy' = the pieces light up; 'score' = approach rings (+ the scrolling tab in the HUD). */
  guide: 'easy' | 'score' = 'easy';
  notes: NoteInst[] = [];
  private clicks: { time: number; accent: boolean; done: boolean }[] = [];
  songPos = 0;
  private passes = 4;
  private countInSteps = DEFAULT_COUNT_IN;
  private silent = false;
  private sectionIdx = -1;
  private upcomingIdx = -1;
  private perfStart = 0;
  private endTime = 0;
  private stats!: Stats;
  private readonly cues = new Map<PieceId, Cue>();
  private readonly pool: THREE.Mesh[] = [];
  private lastCount = -1;

  constructor(
    kit: Kit,
    private readonly audio: AudioEngine,
    private readonly events: CoachEvents,
  ) {
    for (const p of kit.pieces.values()) {
      if (p.id === 'kick') {
        this.cues.set(p.id, { parent: kit.root, position: new THREE.Vector3(0.03, 0.016, 0.17), radius: 0.15 });
      } else if (p.id === 'hhpedal') {
        this.cues.set(p.id, { parent: p.surface, position: new THREE.Vector3(0, 0.012, -0.13), radius: 0.12 });
      } else if (p.kind === 'cymbal') {
        this.cues.set(p.id, { parent: p.surface, position: new THREE.Vector3(0, -p.cymbal!.edgeDrop + 0.004, 0), radius: p.radius });
      } else {
        this.cues.set(p.id, { parent: p.surface, position: new THREE.Vector3(0, 0.012, 0), radius: p.rim + 0.004 });
      }
    }
  }

  /** Seconds per 16th note at the current tempo. */
  stepDur(): number {
    return 60 / this.bpm / 4;
  }

  private approach(): number {
    return Math.max(0.8, 60 / this.bpm);
  }

  start(lesson: Lesson, bpm = lesson.bpm): void {
    this.stop();
    this.lesson = lesson;
    this.bpm = bpm;
    this.build();
    this.running = true;
    this.songPos = -0.35;
    this.perfStart = performance.now() + 350;
    this.lastCount = -1;
  }

  /** 0..1 through the lesson (after the count-in). */
  get progress(): number {
    const start = this.countInSteps * this.stepDur();
    return this.endTime > start ? (this.songPos - start) / (this.endTime - start) : 0;
  }

  /** Song time where the first bar (after the count-in) starts. */
  get countInTime(): number {
    return this.countInSteps * this.stepDur();
  }

  private build(): void {
    const lesson = this.lesson!;
    const sd = this.stepDur();
    this.passes = lesson.passes ?? 4;
    this.countInSteps = lesson.countIn ?? DEFAULT_COUNT_IN;
    this.silent = !!lesson.silent;
    const PASSES = this.passes;
    this.sectionIdx = -1;
    this.upcomingIdx = -1;
    this.notes = [];
    for (let p = 0; p < PASSES; p++) {
      for (const n of lesson.notes) {
        this.notes.push({ time: (this.countInSteps + p * lesson.length + n.step) * sd, piece: n.piece, zone: n.zone, velocity: n.velocity, state: 'pending' });
      }
    }
    this.clicks = [];
    const totalSteps = this.countInSteps + PASSES * lesson.length;
    for (let s = 0; s < totalSteps; s += 4) this.clicks.push({ time: s * sd, accent: s % 16 === 0, done: false });
    this.endTime = totalSteps * sd;
    this.stats = { total: this.notes.length, judged: 0, perfect: 0, good: 0, off: 0, miss: 0, streak: 0, best: 0, accuracy: 1, pass: 0, passes: PASSES };
    if (lesson.sections?.length) this.events.section(lesson.sections[0].name, true);
    this.events.stats(this.stats);
  }

  stop(): void {
    this.running = false;
    for (const n of this.notes) this.release(n);
    this.notes = [];
    this.lesson = null;
  }

  /** Change tempo mid-lesson: restart from the count-in at the new speed. */
  setBpm(bpm: number): void {
    this.bpm = Math.round(Math.min(180, Math.max(40, bpm)));
    if (this.lesson) this.start(this.lesson, this.bpm);
  }

  setWait(on: boolean): void {
    this.wait = on;
    if (this.lesson) this.start(this.lesson, this.bpm);
  }

  setDemo(on: boolean): void {
    this.demo = on;
  }

  /** Map a song time to the performance clock (when it is heard). */
  private songToPerf(t: number): number {
    return this.perfStart + t * 1000;
  }

  /** AudioContext time at which a sound is heard at `perf` ms. */
  private perfToCtx(perf: number): number {
    const ctx = this.audio.ctx as AudioContext & { getOutputTimestamp?: () => AudioTimestamp };
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime && ts.performanceTime) return ts.contextTime + (perf - ts.performanceTime) / 1000;
    return ctx.currentTime + (perf - performance.now()) / 1000 - this.audio.latency;
  }

  /** Player hit: judge it against the closest pending note on the same piece. */
  playerHit(piece: PieceId, perfTime: number): void {
    if (!this.running || this.demo) return;
    const target = piece;
    const now = this.wait ? this.songPos : (perfTime - this.perfStart) / 1000;
    let best: NoteInst | null = null;
    let bestDt = Infinity;
    for (const n of this.notes) {
      if (n.state !== 'pending' || n.piece !== target) continue;
      const dt = now - n.time;
      const early = this.wait ? 0.45 : WINDOW;
      if (dt < -early || dt > WINDOW) continue;
      if (Math.abs(dt) < Math.abs(bestDt)) {
        best = n;
        bestDt = dt;
      }
    }
    if (!best) return;
    let grade: Grade;
    if (this.wait) grade = 'hit';
    else if (Math.abs(bestDt) <= 0.045) grade = 'perfect';
    else if (Math.abs(bestDt) <= 0.095) grade = 'good';
    else grade = bestDt < 0 ? 'early' : 'late';
    this.judge(best, grade);
  }

  private judge(n: NoteInst, grade: Grade): void {
    n.state = 'done';
    n.grade = grade;
    n.judgedAt = this.songPos;
    const s = this.stats;
    s.judged++;
    if (grade === 'perfect' || grade === 'hit') s.perfect++;
    else if (grade === 'good') s.good++;
    else if (grade === 'miss') s.miss++;
    else s.off++;
    if (grade === 'miss' || grade === 'early' || grade === 'late') s.streak = 0;
    else {
      s.best = Math.max(s.best, ++s.streak);
      if (s.streak % 16 === 0) this.events.streak(s.streak);
    }
    s.accuracy = s.judged ? (s.perfect + s.good * 0.75 + s.off * 0.4) / s.judged : 1;
    this.events.judge(n.piece, grade);
    this.events.stats(s);
  }

  private ring(n: NoteInst): THREE.Mesh {
    if (n.ring) return n.ring;
    const m = this.pool.pop() ?? new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    m.renderOrder = 10;
    const cue = this.cues.get(n.piece)!;
    cue.parent.add(m);
    m.position.copy(cue.position);
    n.ring = m;
    return m;
  }

  private release(n: NoteInst): void {
    if (!n.ring) return;
    n.ring.removeFromParent();
    this.pool.push(n.ring);
    n.ring = undefined;
  }

  update(dt: number): void {
    if (!this.running || !this.lesson) return;
    const now = performance.now();
    if (this.wait && !this.demo) {
      // advance until the next unplayed note, then hold
      const blocking = this.notes.find((n) => n.state === 'pending');
      const next = this.songPos + dt;
      this.songPos = blocking ? Math.min(next, blocking.time) : next;
      // re-anchor the performance clock so resuming stays smooth
      this.perfStart = now - this.songPos * 1000;
    } else {
      this.songPos = (now - this.perfStart) / 1000;
    }
    const pos = this.songPos;
    const sd = this.stepDur();

    // count-in display
    if (pos < this.countInSteps * sd) {
      const left = Math.max(1, Math.ceil(this.countInSteps / 4) - Math.floor(Math.max(0, pos) / (sd * 4)));
      if (left !== this.lastCount) {
        this.lastCount = left;
        this.events.countIn(left);
      }
    } else if (this.lastCount !== 0) {
      this.lastCount = 0;
      this.events.countIn(0);
    }

    // metronome clicks: scheduled on the audio clock (or fired live while waiting)
    for (const c of this.clicks) {
      if (c.done) continue;
      if (this.silent) {
        c.done = true;
        continue;
      }
      if (this.wait && !this.demo) {
        if (c.time <= pos) {
          c.done = true;
          this.audio.click(this.audio.ctx.currentTime, c.accent);
        }
      } else {
        const heard = this.songToPerf(c.time);
        if (heard - now < 160) {
          c.done = true;
          if (heard > now - 30) this.audio.click(Math.max(this.audio.ctx.currentTime, this.perfToCtx(heard)), c.accent);
        }
      }
    }

    // demo: the kit plays the notes itself (sound on the audio clock, motion on the frame)
    if (this.demo) {
      for (const n of this.notes) {
        if (n.state !== 'pending') continue;
        const heard = this.songToPerf(n.time);
        if (!n.demoFired && heard - now < 160) {
          n.demoFired = true;
          if (heard > now - 30) this.audio.play(n.piece, n.zone, n.velocity, Math.max(this.audio.ctx.currentTime, this.perfToCtx(heard)));
        }
        if (n.demoFired && now >= heard) {
          n.state = 'done';
          n.grade = 'hit';
          n.judgedAt = pos;
          this.events.demoHit(n.piece, n.zone, n.velocity);
        }
      }
    } else if (!this.wait) {
      for (const n of this.notes) {
        if (n.state === 'pending' && pos - n.time > WINDOW) this.judge(n, 'miss');
      }
    }

    // rings (score guide only)
    const ap = this.approach();
    for (const n of this.notes) {
      if (this.guide !== 'score') {
        if (n.ring) this.release(n);
        continue;
      }
      const u = (n.time - pos) / ap;
      if (n.state === 'pending') {
        if (u > 1) continue;
        const m = this.ring(n);
        const cue = this.cues.get(n.piece)!;
        const mat = m.material as THREE.MeshBasicMaterial;
        let s = 1 + 0.9 * Math.max(0, u);
        if (u <= 0 && this.wait) s = 1 + 0.04 * Math.sin(now / 90);
        m.scale.setScalar(cue.radius * s);
        mat.color.copy(COLOR_APPROACH);
        mat.opacity = 0.12 + 0.8 * Math.pow(1 - Math.max(0, Math.min(1, u)), 1.5);
      } else if (n.ring) {
        const age = pos - (n.judgedAt ?? pos);
        const m = n.ring;
        const mat = m.material as THREE.MeshBasicMaterial;
        const cue = this.cues.get(n.piece)!;
        const life = n.grade === 'miss' ? 0.4 : 0.28;
        if (age > life || age < -0.01) {
          this.release(n);
          continue;
        }
        const k = age / life;
        const col = n.grade === 'perfect' || n.grade === 'hit' ? COLOR_PERFECT : n.grade === 'good' ? COLOR_GOOD : n.grade === 'miss' ? COLOR_MISS : COLOR_OFF;
        mat.color.copy(col);
        mat.opacity = (1 - k) * (n.grade === 'miss' ? 0.5 : 1);
        m.scale.setScalar(cue.radius * (n.grade === 'miss' ? 1 - 0.1 * k : 1 + 0.22 * k));
      }
    }

    // sections: announce the next one a bar early, then name it as it starts
    const secs = this.lesson.sections;
    if (secs && secs.length) {
      const inStep = (pos - this.countInSteps * sd) / sd;
      let idx = -1;
      for (let i = 0; i < secs.length; i++) if (inStep >= secs[i].at) idx = i;
      if (idx !== this.sectionIdx && idx >= 0) {
        this.sectionIdx = idx;
        this.events.section(secs[idx].name, false);
      }
      const next = secs[idx + 1];
      if (next && next.at - inStep <= 16 && next.at - inStep > 0 && this.upcomingIdx !== idx + 1) {
        this.upcomingIdx = idx + 1;
        this.events.section(next.name, true);
      }
    }

    // pass counter + end of lesson
    const passLen = this.lesson.length * sd;
    const pass = Math.min(this.passes, Math.max(0, Math.floor((pos - this.countInSteps * sd) / passLen) + 1));
    if (pass !== this.stats.pass) {
      this.stats.pass = pass;
      this.events.stats(this.stats);
    }
    if (pos > this.endTime + 0.4) {
      const s = { ...this.stats };
      const wasDemo = this.demo;
      this.stop();
      if (!wasDemo) this.events.finish(s);
      else this.events.finish({ ...s, judged: 0 });
    }
  }
}
