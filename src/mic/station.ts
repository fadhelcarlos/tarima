import * as THREE from 'three';
import type { AudioEngine, Zone } from '../audio/engine';
import type { PieceId } from '../scene/kit';
import type { Venue } from '../scene/venue';
import { SCREEN } from '../scene/venue';
import type { KSong } from '../songs/karaoke';
import { KaraokeScreen } from './screen';
import { KEYS, PRESETS, VocalChain, type VoiceReport } from './vocal';
import { KeyFinder, ProjectorVideo } from './youtube';

interface DrumEvent {
  beat: number;
  piece: PieceId;
  zone: Zone;
  vel: number;
}

/** Drum part for the backing band, one bar at a time. */
function grooveBar(groove: KSong['groove'], bpb: number): DrumEvent[] {
  const e: DrumEvent[] = [];
  if (groove === 'vals') {
    e.push({ beat: 0, piece: 'kick', zone: 'hit', vel: 0.7 });
    for (let b = 1; b < bpb; b++) {
      e.push({ beat: b, piece: 'snare', zone: 'xstick' as Zone, vel: 0.55 });
      e.push({ beat: b, piece: 'hihat', zone: 'closed', vel: 0.4 });
    }
    e.push({ beat: 0, piece: 'hhpedal', zone: 'pedal', vel: 0.5 });
  } else {
    for (let h = 0; h < bpb * 2; h++) e.push({ beat: h / 2, piece: 'hihat', zone: 'closed', vel: h % 2 ? 0.32 : 0.45 });
    e.push({ beat: 0, piece: 'kick', zone: 'hit', vel: 0.75 });
    e.push({ beat: 2, piece: 'kick', zone: 'hit', vel: 0.68 });
    if (groove === 'balada') {
      e.push({ beat: 2.5, piece: 'kick', zone: 'hit', vel: 0.5 });
      e.push({ beat: 1, piece: 'snare', zone: 'xstick' as Zone, vel: 0.6 });
      e.push({ beat: 3, piece: 'snare', zone: 'xstick' as Zone, vel: 0.6 });
    } else {
      e.push({ beat: 1, piece: 'snare', zone: 'center', vel: 0.7 });
      e.push({ beat: 3, piece: 'snare', zone: 'center', vel: 0.72 });
    }
  }
  return e;
}

/** A tonal part player (piano, bass, ukulele…) provided by the band module once its samples load. */
export interface Accompanist {
  schedule(song: KSong, fromBeat: number, toBeat: number, beatToTime: (b: number) => number): void;
  stop(): void;
}

/**
 * The singer's station: live vocal chain, the karaoke screen on the projector, the song clock,
 * pitch scoring and the backing band that plays whatever no human is playing.
 */
export class MicStation {
  readonly vocal: VocalChain;
  private readonly screen: KaraokeScreen;
  private report: VoiceReport = { f0: 0, midi: -1, target: -1, level: 0, gate: 0 };
  song: KSong | null = null;
  private start = 0; // AudioContext time of beat 0
  private scheduledTo = 0;
  private hits: Float32Array | null = null;
  private weights: Float32Array | null = null;
  private syllables: { beat: number; dur: number; midi: number }[] = [];
  score = 0;
  finished = false;
  private sinceDraw = 1;
  presetName = PRESETS[0].name;
  accompanists: Accompanist[] = [];
  onDrum: ((piece: PieceId, zone: Zone, vel: number) => void) | null = null;
  onFinish: ((score: number) => void) | null = null;
  private pendingVisual: { at: number; piece: PieceId; zone: Zone; vel: number }[] = [];
  drumsOn = true;
  readonly video: ProjectorVideo;
  private readonly keys = new KeyFinder();
  private keyCheck = 0;
  /** The singer picked a key by hand: stop auto-detecting. */
  manualKey = false;
  detectedKey: string | null = null;
  videoTitle: string | null = null;

  constructor(
    private readonly audio: AudioEngine,
    private readonly venue: Venue,
    videoContainer: HTMLElement,
  ) {
    this.vocal = new VocalChain(audio.ctx, audio.output);
    this.vocal.onReport = (r) => (this.report = r);
    this.screen = new KaraokeScreen(venue.screenCanvas);
    this.video = new ProjectorVideo(venue.screen, videoContainer);
  }

  /** Plays a karaoke video on the projector; the voice chain keeps running over it. */
  async playVideo(videoId: string, title: string): Promise<void> {
    this.stopSong();
    this.videoTitle = title;
    this.keys.reset();
    this.detectedKey = null;
    if (!this.manualKey) this.vocal.apply({ scale: 'cromatica' });
    await this.video.play(videoId);
  }

  stopVideo(): void {
    this.video.stop();
    this.videoTitle = null;
  }

  get live(): boolean {
    return this.vocal.running;
  }

  /** Input level envelope from the vocal processor (0..~0.3). */
  get level(): number {
    return this.report.level;
  }

  async enableMic(headphones: boolean): Promise<void> {
    this.audio.wake();
    await this.vocal.start(headphones);
  }

  /** Screen fractions covered by the HUD (top bar, side column, bottom dock). */
  hudFrac = { top: 0.08, bottom: 0.02, right: 0 };

  /**
   * Camera pose for the singer: eyes just behind the mic, looking at the projector screen.
   * The field of view is solved so the whole screen and the mic grille (foreground) both fit
   * in the area the HUD leaves free, whatever the screen shape.
   */
  pose(aspect: number): { pos: THREE.Vector3; target: THREE.Vector3; fov: number } {
    const eye = new THREE.Vector3(0, 1.66, -1.56);
    const head = this.venue.micHead.getWorldPosition(new THREE.Vector3());
    const zS = SCREEN.center.z;
    const ang = (y: number, z: number) => Math.atan2(y - eye.y, eye.z - z);
    const aTop = ang(SCREEN.center.y + SCREEN.height / 2 + 0.14, zS);
    // lower bound: the mic body just under the headbasket, so the whole capsule is in frame
    const aMic = ang(head.y - 0.075, head.z);
    const { top, bottom, right } = this.hudFrac;
    const free = Math.max(0.5, 1 - top - bottom);
    const vNeed = ((aTop - aMic) * 1.08) / free;
    const halfW = Math.atan((SCREEN.width / 2) * 1.16 / (eye.z - zS));
    const freeW = Math.max(0.5, 1 - right);
    const vFromW = 2 * Math.atan(Math.tan(halfW / freeW) / aspect);
    const fov = THREE.MathUtils.clamp(Math.max(vNeed, vFromW), THREE.MathUtils.degToRad(30), THREE.MathUtils.degToRad(74));
    // centre the free band: shift the aim by the HUD imbalance, and off to the left of a side column
    const pitch = (aTop + aMic) / 2 + ((top - bottom) / 2) * fov;
    const hfov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
    const yaw = (right / 2) * hfov;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    return { pos: eye, target: eye.clone().addScaledVector(dir, 6), fov: THREE.MathUtils.radToDeg(fov) };
  }

  startSong(song: KSong): void {
    this.stopSong();
    if (this.video.visible) this.stopVideo();
    this.song = song;
    this.vocal.bpm = song.bpm;
    this.vocal.apply({ key: song.key, scale: song.scale });
    this.start = this.audio.ctx.currentTime + 0.35;
    this.scheduledTo = 0;
    this.syllables = song.lines.flatMap((l) => l.syllables).map((s) => ({ beat: s.beat, dur: s.dur, midi: s.midi }));
    this.hits = new Float32Array(this.syllables.length);
    this.weights = new Float32Array(this.syllables.length);
    this.score = 0;
    this.finished = false;
  }

  stopSong(): void {
    this.song = null;
    this.vocal.guide(-1);
    this.pendingVisual = [];
    for (const a of this.accompanists) a.stop();
  }

  private beatNow(): number {
    const spb = 60 / (this.song?.bpm ?? 100);
    return (this.audio.ctx.currentTime - this.audio.latency - this.start) / spb;
  }

  private beatToTime(b: number): number {
    const spb = 60 / (this.song?.bpm ?? 100);
    return this.start + b * spb;
  }

  private scheduleAhead(): void {
    const song = this.song!;
    const ctx = this.audio.ctx;
    const horizon = (ctx.currentTime - this.start + 0.25) / (60 / song.bpm);
    if (horizon <= this.scheduledTo) return;
    const from = this.scheduledTo, to = Math.min(horizon, song.length);
    const bpb = song.beatsPerBar;
    if (this.drumsOn) {
      for (let bar = Math.floor(from / bpb); bar * bpb < to; bar++) {
        const barBeat = bar * bpb;
        let events: DrumEvent[];
        if (bar === 0) {
          // count-in: sticks clicking on each beat
          events = Array.from({ length: bpb }, (_, b) => ({ beat: b, piece: 'hhpedal' as PieceId, zone: 'pedal' as Zone, vel: b === 0 ? 0.8 : 0.6 }));
        } else if (barBeat >= song.length - bpb) {
          events = [{ beat: 0, piece: 'crash', zone: 'hit', vel: 0.8 }, { beat: 0, piece: 'kick', zone: 'hit', vel: 0.85 }];
        } else {
          events = grooveBar(song.groove, bpb);
          if (bar === 1) events.push({ beat: 0, piece: 'crash', zone: 'hit', vel: 0.7 });
        }
        for (const ev of events) {
          const b = barBeat + ev.beat;
          if (b < from || b >= to) continue;
          const when = this.beatToTime(b);
          this.audio.play(ev.piece, ev.zone, ev.vel, when);
          this.pendingVisual.push({ at: when + this.audio.latency, piece: ev.piece, zone: ev.zone, vel: ev.vel });
        }
      }
    }
    for (const a of this.accompanists) a.schedule(song, from, to, (b) => this.beatToTime(b));
    this.scheduledTo = to;
  }

  update(dt: number): void {
    const r = this.report;
    const now = performance.now() / 1000;
    let beat: number | null = null;
    if (this.song) {
      this.scheduleAhead();
      beat = this.beatNow();
      const t = this.audio.ctx.currentTime;
      while (this.pendingVisual.length && this.pendingVisual[0].at <= t) {
        const v = this.pendingVisual.shift()!;
        this.onDrum?.(v.piece, v.zone, v.vel);
      }
      // guide the pitch corrector to the melody note being sung (folded to the singer's octave)
      const cur = this.syllables.findIndex((s) => beat! >= s.beat - 0.1 && beat! < s.beat + s.dur);
      if (cur >= 0 && this.hits && this.weights) {
        const target = this.syllables[cur].midi;
        let m = r.midi;
        if (m >= 0) {
          while (m - target > 6) m -= 12;
          while (target - m > 6) m += 12;
          const octave = Math.round((r.midi - m) / 12) * 12;
          this.vocal.guide(target + octave);
          this.weights[cur] += dt;
          if (Math.abs(m - target) < 0.75) this.hits[cur] += dt;
        } else {
          this.vocal.guide(-1);
        }
      }
      // score: share of the melody sung in tune so far (0–100)
      let sung = 0, total = 0;
      for (let i = 0; i < this.syllables.length; i++) {
        const s = this.syllables[i];
        if (beat < s.beat + s.dur) break;
        total += s.dur;
        if (this.weights && this.hits) sung += s.dur * Math.min(1, this.hits[i] / Math.max(0.05, s.dur * (60 / this.song.bpm) * 0.6));
      }
      this.score = total > 0 ? (sung / total) * 100 : 0;
      if (!this.finished && beat > this.song.length) {
        this.finished = true;
        this.onFinish?.(this.score);
      }
    }
    // any song: learn its key from the notes the singer holds, then tune to that scale
    if (this.video.visible && this.vocal.running && r.midi >= 0) this.keys.add(r.midi, dt);
    this.keyCheck += dt;
    if (this.keyCheck > 3 && this.video.visible) {
      this.keyCheck = 0;
      const k = this.keys.best();
      if (this.keys.total > 6 && k.confidence > 0.2) {
        this.detectedKey = `${KEYS[k.key]} ${k.scale}`;
        if (!this.manualKey) this.vocal.apply({ key: k.key, scale: k.scale });
      }
    }
    // the projector refreshes at ~30 fps
    this.sinceDraw += dt;
    if (this.sinceDraw >= 1 / 30 && !this.video.visible) {
      this.sinceDraw = 0;
      const hitsView = this.hits && this.weights ? this.hits.map((h, i) => Math.min(1, h / Math.max(0.05, this.syllables[i].dur * (60 / (this.song?.bpm ?? 100)) * 0.6))) : null;
      this.screen.draw(
        {
          beat,
          song: this.song,
          midi: this.vocal.running ? r.midi : -1,
          target: r.target,
          level: this.vocal.running ? r.level : 0,
          preset: this.presetName,
          keyName: `${KEYS[this.vocal.settings.key]} ${this.vocal.settings.scale}`,
          live: this.vocal.running,
          score: this.score,
          hits: hitsView,
          finished: this.finished,
        },
        now,
      );
      this.venue.screenTexture.needsUpdate = true;
    }
    // haze in the projector beam drifts slowly
    this.venue.studioMic.setLive(this.vocal.running && this.vocal.volumeOn);
    this.venue.studioMic.setLevel(this.vocal.running ? r.level : 0);
    this.venue.studioMic.update(dt);
    const map = this.venue.beamMat.map;
    if (map) map.offset.x = (map.offset.x + dt * 0.004) % 1;
  }
}
