import './ui/styles.css';
import './ui/hud.css';
import * as THREE from 'three';
import { AudioEngine, type Zone } from './audio/engine';
import { Haptics } from './input/haptics';
import { bindKeyboard } from './input/keyboard';
import { TouchInput, type Hit } from './input/pointer';
import { Coach } from './learn/coach';
import { GlowGuide } from './learn/glow';
import { KitAnimator } from './scene/animate';
import { CameraRig } from './scene/camera';
import { Kit, type PieceId } from './scene/kit';
import { MaterialLibrary } from './scene/materials';
import { Stage3D, type Quality } from './scene/stage3d';
import { Sticks } from './scene/sticks';
import { BackingBand } from './band/backing';
import { MicStation } from './mic/station';
import { buildVenue, type Venue } from './scene/venue';
import { Hud } from './ui/hud';
import { ICONS } from './ui/icons';
import { MicHud } from './ui/micHud';
import { PieceLabels } from './ui/labels';
import { TabStrip } from './ui/tabstrip';

const DISPLAY_FONT = '"Archivo", "Helvetica Neue", sans-serif';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function loadFonts(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`700 64px "Archivo"`), document.fonts.load(`500 20px "Instrument Sans"`)]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* fall back to system fonts */
  }
}

class Loader {
  private readonly bar = document.querySelector<HTMLSpanElement>('.progress span')!;
  private readonly bg = document.querySelector<HTMLElement>('.progress')!;
  private readonly label = document.getElementById('loader-step')!;
  readonly start = document.getElementById('start') as HTMLButtonElement;
  private readonly root = document.getElementById('loader')!;
  set(fraction: number, text?: string): void {
    this.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
    this.bg.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    if (text) this.label.textContent = text;
  }
  ready(): void {
    this.set(1, 'Listo');
    this.start.hidden = false;
  }
  hide(): void {
    this.root.classList.add('gone');
  }
}

class App {
  readonly stage = new Stage3D(document.getElementById('scene') as HTMLCanvasElement);
  readonly loader = new Loader();
  readonly audio = new AudioEngine();
  readonly haptics = new Haptics();
  kit!: Kit;
  lib!: MaterialLibrary;
  rig!: CameraRig;
  animator!: KitAnimator;
  input!: TouchInput;
  sticks!: Sticks;
  labels!: PieceLabels;
  coach!: Coach;
  hud!: Hud;
  tab!: TabStrip;
  glow!: GlowGuide;
  venue!: Venue;
  mic: MicStation | null = null;
  micHud: MicHud | null = null;
  station: 'drums' | 'mic' | null = null;
  band: BackingBand | null = null;
  private playing = false;
  private readonly tmpV = new THREE.Vector3();
  private readonly cueOffset = new THREE.Vector3(0, 0.065, 0.02);
  private readonly timer = new THREE.Timer();
  private progress = { room: 0, visual: 0, audio: 0 };
  private stepLabel = 'Preparando la sala';
  private metro = { on: false, bpm: 90, next: 0, beat: 0 };
  private qualityPref: 'auto' | Quality = 'auto';

  async boot(): Promise<void> {
    const audioReady = this.audio.load('./samples/', (d, t) => {
      this.progress.audio = d / t;
      this.showProgress();
    });
    await loadFonts();
    const roomReady = this.stage.buildRoom((f) => {
      this.progress.room = f;
      this.showProgress();
    });
    const steps = ['Laca de los cascos', 'Bronce de los platillos', 'Montando la batería'];
    let done = 0;
    const step = async (label: string) => {
      this.progress.visual = done / (steps.length + 1);
      this.stepLabel = label;
      this.showProgress();
      done++;
      await nextFrame();
      await nextFrame();
    };
    this.lib = new MaterialLibrary(DISPLAY_FONT);
    await this.lib.prepare(step);
    await step(steps[2]);
    this.kit = new Kit(this.lib).build();
    this.stage.scene.add(this.kit.root);
    this.kit.root.updateMatrixWorld(true);
    this.stepLabel = 'Iluminando el estudio';
    await roomReady;
    this.venue = buildVenue(this.stage.scene, this.lib, this.stage.stage.roomFloor, DISPLAY_FONT);
    this.progress.visual = 1;

    this.rig = new CameraRig(this.stage.camera, this.kit);
    this.stage.onResize = () => this.rig.refit();
    this.rig.orbiting = true;
    this.animator = new KitAnimator(this.kit);
    this.sticks = new Sticks();
    this.stage.scene.add(this.sticks.group);
    this.labels = new PieceLabels(document.getElementById('labels')!, this.kit);
    this.input = new TouchInput(this.stage.canvas, this.stage.camera, this.kit, (h) => this.hit(h), (id) => this.grab(id), () => this.audio.wake());
    this.input.enabled = false;
    bindKeyboard((piece, zone, time) => this.keyHit(piece, zone, time));
    this.coach = new Coach(this.kit, this.audio, {
      judge: (piece, grade) => {
        this.hud.judge(piece, grade);
        this.glow.judged(piece, grade);
      },
      stats: (s) => this.hud.stats(s),
      countIn: (n) => this.hud.countIn(n),
      finish: (s) => this.hud.finish(s),
      section: (name, upcoming) => this.hud.section(name, upcoming),
      streak: (n) => this.hud.streak(n),
      demoHit: (piece, zone, velocity) => this.visualHit(piece, zone, velocity),
    });
    this.glow = new GlowGuide(this.kit);
    this.buildHud();
    this.buildMic();
    this.bindMicTap();
    this.buildPicker();
    this.stage.resize();
    this.stage.renderer.compile(this.stage.scene, this.stage.camera);
    this.loop();
    this.showProgress();
    await audioReady;
    this.loader.ready();
    if (!this.audio.available) this.loader.set(1, 'Este navegador no permite sonido web: verás y tocarás la batería, pero en silencio. Prueba con Safari o Chrome.');
    this.loader.start.addEventListener('click', () => this.enter(), { once: true });
  }

  private showProgress(): void {
    const p = this.progress;
    const f = p.visual * 0.2 + p.room * 0.25 + p.audio * 0.55;
    let label = this.stepLabel;
    if (p.visual >= 1) label = p.audio < 1 ? `Afinando los tambores · ${Math.round(p.audio * 100)}%` : 'Listo';
    this.loader.set(f, label);
  }

  private buildHud(): void {
    this.hud = new Hud(document.getElementById('hud')!, {
      setView: (v) => this.rig.setView(v),
      setFinish: (id) => this.lib.setFinish(id),
      setSticks: (on) => (this.sticks.visible = on),
      setLabels: (m) => {
        this.labels.mode = m === 'always' ? 'always' : m === 'never' ? 'never' : 'auto';
        this.labels.resetCounts();
      },
      setVolume: (v) => (this.audio.volume = v),
      setRoom: (v) => (this.audio.room = v),
      setHaptics: (on) => (this.haptics.enabled = on && this.haptics.supported),
      setQuality: (q) => this.applyQuality(q),
      metronome: (on, bpm) => this.setMetronome(on, bpm),
      startLesson: (l, bpm, wait) => {
        this.coach.wait = wait;
        this.coach.start(l, bpm);
        this.tab.setup();
      },
      stopLesson: () => {
        this.coach.stop();
        this.glow.clear();
      },
      setGuide: (g) => {
        this.coach.guide = g;
        this.glow.enabled = g === 'easy';
        if (g !== 'easy') this.glow.clear();
      },
      lessonBpm: (bpm) => this.coach.setBpm(bpm),
      lessonWait: (on) => this.coach.setWait(on),
      lessonDemo: (on) => this.coach.setDemo(on),
      insetsChanged: (ins) => {
        Object.assign(this.rig.insets, ins);
        this.rig.setView(this.rig.view);
      },
      project: (piece) => this.project(piece),
      hapticsSupported: this.haptics.supported,
      openInstruments: () => this.openPicker(),
    });
    document.getElementById('hud')!.hidden = true;
    this.tab = new TabStrip(this.hud.tabCanvas, this.coach);
    this.hud.onLessonLayout = () => this.tab.resize();
    window.addEventListener('resize', () => {
      if (this.coach.running) this.tab.resize();
      requestAnimationFrame(() => {
        Object.assign(this.rig.insets, this.hud.measureInsets());
        this.rig.refit();
      });
    });
    Object.assign(this.rig.insets, this.hud.measureInsets());
    // apply saved settings
    const s = this.hud.settings;
    if (s.finish !== this.lib.finish) this.lib.setFinish(s.finish);
    this.sticks.visible = s.sticks;
    this.labels.mode = s.labels === 'always' ? 'always' : s.labels === 'auto' ? 'auto' : 'never';
    this.audio.volume = s.volume;
    this.audio.room = s.room;
    this.haptics.enabled = s.haptics && this.haptics.supported;
    this.metro.bpm = s.bpm;
    this.coach.guide = s.guide;
    this.glow.enabled = s.guide === 'easy';
    this.applyQuality(s.quality);
  }

  private buildMic(): void {
    if (!this.audio.available) return;
    const mic = new MicStation(this.audio, this.venue, document.getElementById('app')!);
    // the backing drummer's hits move the kit too (seen from the other views)
    mic.onDrum = (piece, zone, velocity) => this.animateOnly(piece, zone, velocity);
    // piano + bass that follow each song's chords (samples load in the background)
    const band = new BackingBand(this.audio.ctx, this.audio.output);
    band.load('./samples/').catch((err) => console.warn('banda', err));
    mic.accompanists.push(band);
    this.band = band;
    this.mic = mic;
    let muted = false;
    mic.video.onState = (st) => this.micHud?.videoState(st);
    mic.video.onError = (code) => this.micHud?.videoError(code);
    this.micHud = new MicHud(document.getElementById('mic-hud')!, mic, {
      openInstruments: () => this.openPicker(),
      micStart: async (headphones) => {
        this.audio.unlock();
        await mic.enableMic(headphones);
      },
      playVideo: (id, title) => mic.playVideo(id, title),
      stopVideo: () => mic.stopVideo(),
      setBand: (on) => {
        mic.drumsOn = on;
        if (this.band) this.band.enabled = on;
        if (!on) this.band?.stop();
      },
      micToggleMute: () => {
        muted = !muted;
        mic.vocal.volume = muted ? 0 : 1;
      },
    });
  }

  /** Tapping the 3D microphone switches it on/off (operate where you see). */
  private bindMicTap(): void {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    this.stage.canvas.addEventListener('pointerdown', (e) => {
      if (this.station !== 'mic' || !this.micHud) return;
      const r = this.stage.canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.stage.camera);
      if (ray.intersectObject(this.venue.studioMic.hit, false).length) this.micHud.tapMic();
    });
  }

  private buildPicker(): void {
    const el = document.getElementById('picker')!;
    const micCard = this.audio.available
      ? `<button type="button" class="inst-card" data-station="mic">${ICONS.mic}<b>Micrófono</b><span>Canta con autotune, eco y armonías. La letra sale en la pantalla del proyector.</span></button>`
      : `<button type="button" class="inst-card" data-station="mic" disabled>${ICONS.mic}<b>Micrófono</b><span>Este navegador no permite audio web, así que el micrófono no puede funcionar aquí.</span></button>`;
    el.innerHTML = `
      <div class="picker-card">
        <h2>¿Qué vas a tocar?</h2>
        <div class="picker-grid">
          <button type="button" class="inst-card" data-station="drums">${ICONS.drum}<b>Batería</b><span>Toca con los dedos. Aprende canciones famosas con la guía que ilumina las piezas.</span></button>
          ${micCard}
        </div>
      </div>`;
    el.querySelectorAll<HTMLButtonElement>('[data-station]').forEach((b) =>
      b.addEventListener('click', () => {
        el.hidden = true;
        this.selectStation(b.dataset.station as 'drums' | 'mic');
      }),
    );
  }

  private openPicker(): void {
    document.getElementById('hud')!.hidden = true;
    if (this.micHud) this.micHud.visible = false;
    this.input.enabled = false;
    document.getElementById('picker')!.hidden = false;
  }

  private selectStation(st: 'drums' | 'mic'): void {
    const first = this.station === null;
    this.station = st;
    this.audio.unlock();
    if (st === 'drums') {
      if (this.micHud) this.micHud.visible = false;
      document.getElementById('hud')!.hidden = false;
      Object.assign(this.rig.insets, this.hud.measureInsets());
      this.input.enabled = true;
      this.playing = true;
      this.rig.setView('play');
      if (first || !this.hud.settings.tourSeen) window.setTimeout(() => (this.hud.settings.tourSeen ? this.hud.showTip() : this.hud.startTour()), 700);
      this.hud.checkRotate();
    } else if (this.mic && this.micHud) {
      document.getElementById('hud')!.hidden = true;
      this.micHud.visible = true;
      this.input.enabled = false;
      this.playing = false;
      const mic = this.mic;
      const hud = this.micHud;
      requestAnimationFrame(() => {
        mic.hudFrac = hud.measure();
        this.rig.setCustom((aspect) => {
          mic.hudFrac = hud.measure();
          return mic.pose(aspect);
        });
      });
    }
  }

  /** Kit motion without the learning glow (backing band). */
  private animateOnly(piece: PieceId, zone: Zone, velocity: number): void {
    const p = this.kit.pieces.get(piece);
    if (!p) return;
    const a = Math.random() * Math.PI * 2;
    const r = zone === 'open' ? p.radius * 0.9 : zone === 'bell' ? p.radius * 0.08 : p.radius * 0.28 * Math.random();
    this.animator.strike(piece, zone, new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), velocity);
  }

  private applyQuality(q: 'auto' | Quality): void {
    this.qualityPref = q;
    this.stage.autoQuality = q === 'auto';
    if (q !== 'auto') this.stage.setQuality(q);
  }

  private project(piece: PieceId): { x: number; y: number } | null {
    const p = this.kit.pieces.get(piece);
    if (!p) return null;
    const v = piece === 'kick' ? new THREE.Vector3(0.03, 0.05, 0.18) : p.surface.localToWorld(new THREE.Vector3(0, 0, 0));
    v.project(this.stage.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  /** Motion only (the demo schedules its own sound on the audio clock). */
  private visualHit(piece: PieceId, zone: Zone, velocity: number): void {
    const p = this.kit.pieces.get(piece)!;
    const a = Math.random() * Math.PI * 2;
    const r = zone === 'open' ? p.radius * 0.9 : zone === 'bell' ? p.radius * 0.08 : zone === 'rim' ? p.radius * 1.02 : p.radius * 0.28 * Math.random();
    const local = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    this.animator.strike(piece, zone, local, velocity);
    this.glow.judged(piece, 'hit');
    if (p.kind !== 'pedal') {
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(p.surface.getWorldQuaternion(new THREE.Quaternion()));
      this.sticks.strike(piece, p.surface.localToWorld(local.clone()), normal, velocity);
    }
  }

  hit(h: Hit): void {
    this.audio.play(h.piece, h.zone, h.velocity);
    this.animator.strike(h.piece, h.zone, h.local, h.velocity);
    const p = this.kit.pieces.get(h.piece)!;
    if (p.kind !== 'pedal') {
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(p.surface.getWorldQuaternion(new THREE.Quaternion()));
      this.sticks.strike(h.piece, h.world, normal, h.velocity);
    }
    this.labels.played(h.piece);
    this.haptics.tap(h.velocity);
    this.coach.playerHit(h.piece, h.time);
    this.hud.played();
  }

  private keyHit(piece: PieceId, zone: Zone, time: number): void {
    if (!this.input.enabled) return;
    this.audio.wake();
    const p = this.kit.pieces.get(piece)!;
    const a = Math.random() * Math.PI * 2;
    const r = zone === 'open' ? p.radius * 0.9 : zone === 'bell' ? p.radius * 0.08 : zone === 'rim' ? p.radius * 1.02 : p.radius * 0.25 * Math.random();
    const local = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    this.hit({ piece, zone, velocity: 0.85 + Math.random() * 0.1, local, world: p.surface.localToWorld(local.clone()), time, pointerId: -1 });
  }

  private grab(id: PieceId): void {
    this.audio.choke(id);
    this.animator.grab(id);
  }

  private setMetronome(on: boolean, bpm: number): void {
    const wasOn = this.metro.on;
    this.metro.on = on;
    this.metro.bpm = bpm;
    if (on && !wasOn) {
      this.metro.next = this.audio.ctx.currentTime + 0.08;
      this.metro.beat = 0;
    }
  }

  private tickMetronome(): void {
    const m = this.metro;
    if (!m.on) return;
    const ctx = this.audio.ctx;
    while (m.next < ctx.currentTime + 0.12) {
      const accent = m.beat % 4 === 0;
      this.audio.click(m.next, accent);
      const delay = Math.max(0, (m.next - ctx.currentTime) * 1000);
      window.setTimeout(() => this.hud.pulse(accent), delay);
      m.next += 60 / m.bpm;
      m.beat++;
    }
  }

  private enter(): void {
    this.audio.unlock();
    this.loader.hide();
    document.getElementById('picker')!.hidden = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } };
    nav.wakeLock?.request('screen').catch(() => undefined);
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    if (this.qualityPref === 'auto') this.stage.track(dt * 1000);
    this.tickMetronome();
    this.coach.update(dt);
    if (this.coach.running) {
      if (this.coach.guide === 'score') this.tab.draw();
      else this.hud.progressTo(this.coach.progress);
    }
    this.glow.update(this.coach, dt);
    this.animator.update(dt);
    this.sticks.update(dt);
    this.rig.shake.y = this.animator.thump.x;
    this.rig.update(performance.now(), dt);
    this.labels.update(this.stage.camera, window.innerWidth, window.innerHeight, !this.playing);
    if (this.mic) {
      this.mic.update(dt);
      if (this.station === 'mic' && this.micHud) {
        this.micHud.level(this.mic.live ? this.mic.level : 0);
        // the cue label rides just under the microphone's basket on screen
        const p = this.venue.micHead.getWorldPosition(this.tmpV).add(this.cueOffset).project(this.stage.camera);
        this.micHud.place((p.x * 0.5 + 0.5) * window.innerWidth, (-p.y * 0.5 + 0.5) * window.innerHeight);
      }
      this.mic.video.update(this.stage.camera, window.innerWidth, window.innerHeight);
      // while the video waits for a tap, let taps fall through the canvas onto it
      const waiting = this.station === 'mic' && this.mic.video.visible && this.mic.video.state !== 1 && this.mic.video.state !== 3;
      this.stage.canvas.style.pointerEvents = waiting ? 'none' : '';
    }
    this.stage.render(dt);
  };
}

const app = new App();
app.boot().catch((err) => {
  console.error(err);
  const step = document.getElementById('loader-step');
  if (step) step.textContent = 'No se pudo iniciar la batería en este navegador. Actualiza la página para intentarlo de nuevo.';
});
(window as unknown as { app: App }).app = app;
