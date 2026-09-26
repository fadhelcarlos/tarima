import { KEYMAP } from '../input/keyboard';
import type { Grade, Stats } from '../learn/coach';
import { LESSONS, TOUR, type Lesson } from '../learn/lessons';
import { earnedStars, loadProgress, saveStars, SONGS, starsFor, type Song } from '../learn/songs';
import type { ViewId } from '../scene/camera';
import { VIEWS } from '../scene/camera';
import type { PieceId } from '../scene/kit';
import { FINISHES } from '../scene/materials';
import type { FinishId } from '../scene/textures';
import { ICONS } from './icons';

export type QualityPref = 'auto' | 'alta' | 'media' | 'baja';
export type LabelMode = 'auto' | 'always' | 'never';

export interface Settings {
  finish: FinishId;
  sticks: boolean;
  labels: LabelMode;
  volume: number;
  room: number;
  haptics: boolean;
  quality: QualityPref;
  bpm: number;
  tipSeen: boolean;
  tourSeen: boolean;
  rotateSeen: boolean;
  guide: 'easy' | 'score';
}

export const DEFAULTS: Settings = {
  finish: 'cereza',
  sticks: true,
  labels: 'never',
  volume: 0.9,
  room: 0.14,
  haptics: true,
  quality: 'auto',
  bpm: 90,
  tipSeen: false,
  tourSeen: false,
  rotateSeen: false,
  guide: 'easy',
};

const KEY = 'baqueta:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage blocked */
  }
  return { ...DEFAULTS };
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked */
  }
}

export interface HudActions {
  setView(v: ViewId): void;
  setFinish(id: FinishId): void;
  setSticks(on: boolean): void;
  setLabels(mode: LabelMode): void;
  setVolume(v: number): void;
  setRoom(v: number): void;
  setHaptics(on: boolean): void;
  setQuality(q: QualityPref): void;
  metronome(on: boolean, bpm: number): void;
  startLesson(lesson: Lesson, bpm: number, wait: boolean): void;
  stopLesson(): void;
  lessonBpm(bpm: number): void;
  lessonWait(on: boolean): void;
  lessonDemo(on: boolean): void;
  setGuide(g: 'easy' | 'score'): void;
  insetsChanged(insets: { top: number; right: number; bottom: number; left: number }): void;
  project(piece: PieceId): { x: number; y: number } | null;
  hapticsSupported: boolean;
}

type Practice = { kind: 'groove'; lesson: Lesson } | { kind: 'song'; song: Song; step: number };

const GRADE_TEXT: Record<Grade, string> = {
  perfect: '¡Perfecto!',
  good: 'Bien',
  early: 'Temprano',
  late: 'Tarde',
  miss: '',
  hit: '¡Eso!',
};

const ROW_ORDER: { id: PieceId; name: string }[] = [
  { id: 'crash', name: 'Crash' },
  { id: 'crash2', name: 'Crash 2' },
  { id: 'ride', name: 'Ride' },
  { id: 'hihat', name: 'Hi-hat' },
  { id: 'tom1', name: 'Tom 1' },
  { id: 'tom2', name: 'Tom 2' },
  { id: 'floor', name: 'Tom piso' },
  { id: 'snare', name: 'Redobl.' },
  { id: 'kick', name: 'Bombo' },
  { id: 'hhpedal', name: 'Pedal' },
];

/** Mini drum-grid preview: one row per piece, one column per 16th note (first `maxSteps`). */
function grid(lesson: Lesson, maxSteps = 32): string {
  const len = Math.min(lesson.length, maxSteps);
  const rows = ROW_ORDER.filter((r) => lesson.notes.some((n) => n.piece === r.id && n.step < len));
  return `<div class="grid" style="--cols:${len}">${rows
    .map((r) => {
      const cells = Array.from({ length: len }, (_, i) => {
        const n = lesson.notes.find((x) => x.piece === r.id && x.step === i);
        const cls = n ? (n.zone === 'open' ? 'on open' : n.velocity < 0.5 ? 'on ghost' : 'on') : i % 4 === 0 ? 'beat' : '';
        return `<i class="${cls}"></i>`;
      }).join('');
      return `<span class="grid-name">${r.name}</span><span class="grid-row">${cells}</span>`;
    })
    .join('')}</div>`;
}

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>';

function stars(n: number, cls = ''): string {
  return `<span class="stars ${cls}" aria-label="${n} de 3 estrellas">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}">${STAR}</i>`).join('')}</span>`;
}

export class Hud {
  readonly settings: Settings;
  mode: 'free' | 'learn' = 'free';
  private root: HTMLElement;
  private metroOn = false;
  private practice: Practice | null = null;
  private lessonBpm = 80;
  private wait = false;
  private demo = false;
  private progress = loadProgress();
  private sectionTimer = 0;
  private lastJudge = new Map<PieceId, number>();
  onLessonLayout: (() => void) | null = null;

  constructor(root: HTMLElement, private readonly act: HudActions) {
    this.root = root;
    this.settings = loadSettings();
    this.render();
  }

  private $(sel: string): HTMLElement {
    return this.root.querySelector(sel) as HTMLElement;
  }

  get tabCanvas(): HTMLCanvasElement {
    return this.$('#tab') as HTMLCanvasElement;
  }

  private songCards(): string {
    return SONGS.map((s) => {
      const p = this.progress[s.id] ?? [0, 0, 0];
      const done = p.filter((x) => x > 0).length;
      return `
        <button type="button" class="song" data-song="${s.id}">
          <span class="song-head">
            <span class="song-title"><span class="song-name">${s.name}</span><span class="song-artist">${s.artist}</span></span>
            <span class="song-meta"><span class="level" aria-label="Nivel ${s.level} de 3">${'<i class="on"></i>'.repeat(s.level)}${'<i></i>'.repeat(3 - s.level)}</span>${s.bpm} ppm</span>
          </span>
          <span class="song-steps" aria-label="${done} de 3 pasos completados">${[0, 1, 2].map((i) => `<i class="${p[i] > 0 ? 'on' : ''}"></i>`).join('')}<span>${done === 3 ? 'Completada' : done ? `Paso ${done + 1} de 3` : 'Nueva'}</span></span>
        </button>`;
    }).join('');
  }

  private render(): void {
    const s = this.settings;
    const hover = matchMedia('(hover: hover) and (pointer: fine)').matches;
    this.root.innerHTML = `
      <div class="hud-bar">
        <div class="hud-group">
          <div class="seg" role="group" aria-label="Modo">
            <button type="button" data-mode="free" aria-pressed="true">Libre</button>
            <button type="button" data-mode="learn" aria-pressed="false">Aprender</button>
          </div>
        </div>
        <div class="hud-group">
          <div class="seg views" role="group" aria-label="Cámara">
            ${VIEWS.map((v) => `<button type="button" data-view="${v.id}" aria-pressed="${v.id === 'play'}">${v.name}</button>`).join('')}
          </div>
          <button class="icon-btn only-narrow" type="button" id="cycle-view" aria-label="Cambiar cámara">${ICONS.camera}</button>
          <button class="icon-btn metro" type="button" id="metro-btn" aria-label="Metrónomo" aria-pressed="false">${ICONS.metronome}<span class="beat-dot"></span></button>
          <button class="icon-btn" type="button" id="help-btn" aria-label="Cómo tocar">${ICONS.help}</button>
          <button class="icon-btn" type="button" id="settings-btn" aria-label="Ajustes">${ICONS.settings}</button>
        </div>
      </div>

      <div class="pop" id="metro-pop" hidden>
        <div class="pop-row">
          <span class="pop-title">Metrónomo</span>
          <button type="button" class="switch" id="metro-switch" role="switch" aria-checked="false" aria-label="Metrónomo encendido"><span></span></button>
        </div>
        <div class="stepper" aria-label="Tempo">
          <button type="button" class="icon-btn" data-bpm="-5" aria-label="Más lento">${ICONS.minus}</button>
          <output id="metro-bpm"><b>${s.bpm}</b> ppm</output>
          <button type="button" class="icon-btn" data-bpm="5" aria-label="Más rápido">${ICONS.plus}</button>
        </div>
        <input type="range" id="metro-range" min="40" max="200" step="1" value="${s.bpm}" aria-label="Pulsos por minuto" />
      </div>

      <aside class="sheet" id="settings-sheet" hidden aria-label="Ajustes">
        <header><h2>Ajustes</h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">${ICONS.close}</button></header>
        <section>
          <h3>Acabado de la batería</h3>
          <div class="swatches" role="radiogroup" aria-label="Acabado">
            ${FINISHES.map((f) => `<button type="button" role="radio" data-finish="${f.id}" aria-checked="${f.id === s.finish}"><span class="sw" style="background:${f.swatch}"></span><span>${f.name}</span></button>`).join('')}
          </div>
        </section>
        <section class="rows">
          <label class="row"><span>Volumen</span><input type="range" id="set-volume" min="0" max="1" step="0.01" value="${s.volume}" /></label>
          <label class="row"><span>Sala</span><input type="range" id="set-room" min="0" max="0.5" step="0.01" value="${s.room}" /></label>
          <div class="row"><span>Baquetas al golpear</span><button type="button" class="switch" id="set-sticks" role="switch" aria-checked="${s.sticks}" aria-label="Baquetas al golpear"><span></span></button></div>
          ${this.act.hapticsSupported ? `<div class="row"><span>Vibración</span><button type="button" class="switch" id="set-haptics" role="switch" aria-checked="${s.haptics}" aria-label="Vibración"><span></span></button></div>` : ''}
          <div class="row stack"><span>Nombres de las piezas</span>
            <div class="seg small" role="radiogroup" aria-label="Nombres de las piezas">
              ${(['never', 'auto', 'always'] as LabelMode[]).map((m) => `<button type="button" role="radio" data-labels="${m}" aria-checked="${m === s.labels}">${m === 'auto' ? 'Hasta tocarlas' : m === 'always' ? 'Siempre' : 'Ocultos'}</button>`).join('')}
            </div>
          </div>
          <div class="row stack"><span>Calidad gráfica</span>
            <div class="seg small" role="radiogroup" aria-label="Calidad gráfica">
              ${(['auto', 'alta', 'media', 'baja'] as QualityPref[]).map((q) => `<button type="button" role="radio" data-quality="${q}" aria-checked="${q === s.quality}">${q === 'auto' ? 'Auto' : q[0].toUpperCase() + q.slice(1)}</button>`).join('')}
            </div>
          </div>
        </section>
        <p class="credit">Sonidos grabados de una batería real: Virtuosity Drums, de Versilian Studios y Karoryfer Samples (dominio público, CC0). Estudio y texturas: Poly Haven (CC0). Las canciones son versiones simplificadas de sus partes de batería, sin el audio original.</p>
      </aside>

      <aside class="sheet" id="help-sheet" hidden aria-label="Cómo tocar">
        <header><h2>Cómo tocar</h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">${ICONS.close}</button></header>
        <dl class="howto">
          <dt>Toca</dt><dd>Golpea cualquier tambor o platillo con un dedo. Usa varios dedos a la vez, como dos baquetas y los pies.</dd>
          <dt>Redoblante</dt><dd>En el centro suena lleno, cerca del borde más brillante y en el aro metálico hace un rimshot seco.</dd>
          <dt>Hi-hat</dt><dd>En el centro suena cerrado. En el borde se abre y queda sonando. El pedal del hi-hat lo vuelve a cerrar.</dd>
          <dt>Ride</dt><dd>La campana del centro suena como una campanita. El resto del platillo lleva el ritmo.</dd>
          <dt>Silenciar</dt><dd>Deja el dedo sobre un platillo para agarrarlo y cortar el sonido, como hace un baterista.</dd>
          <dt>Bombo</dt><dd>Toca el pedal del bombo o el propio bombo.</dd>
          <dt>Aprender</dt><dd>Elige una canción y sigue sus tres pasos. Los círculos se cierran sobre el tambor justo cuando hay que tocarlo, y abajo la partitura te muestra lo que viene.</dd>
        </dl>
        ${hover ? `<h3 class="keys-title">Teclado</h3><div class="keys">${Object.values(KEYMAP).map((k) => `<span><kbd>${k.label}</kbd>${this.pieceName(k.piece)}${k.zone === 'open' ? ' abierto' : k.zone === 'bell' ? ' campana' : k.zone === 'rim' ? ' aro' : ''}</span>`).join('')}</div>` : ''}
      </aside>

      <aside class="sheet lessons" id="lessons-sheet" hidden aria-label="Aprender">
        <header><h2>Aprender</h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">${ICONS.close}</button></header>
        <p class="sheet-intro">Cada canción se aprende en tres pasos. Sigue los círculos: cuando se cierran sobre una pieza, tócala.</p>
        <h3>Canciones</h3>
        <div class="song-list" id="song-list">${this.songCards()}</div>
        <h3>Ritmos para empezar</h3>
        <div class="lesson-list">
          ${LESSONS.map((l) => `
            <button type="button" class="lesson" data-lesson="${l.id}">
              <span class="lesson-head"><span class="lesson-name">${l.name}</span><span class="lesson-meta"><span class="level" aria-label="Nivel ${l.level} de 3">${'<i class="on"></i>'.repeat(l.level)}${'<i></i>'.repeat(3 - l.level)}</span>${l.bpm} ppm</span></span>
              <span class="lesson-blurb">${l.blurb}</span>
              ${grid(l)}
            </button>`).join('')}
        </div>
      </aside>

      <aside class="sheet song-sheet" id="song-sheet" hidden aria-label="Canción">
        <header><button type="button" class="icon-btn" id="song-back" aria-label="Volver a la lista">${ICONS.back}</button><h2 id="song-title"></h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">${ICONS.close}</button></header>
        <p class="song-artist-line" id="song-artist"></p>
        <p class="sheet-intro" id="song-blurb"></p>
        <div class="step-list" id="step-list"></div>
      </aside>

      <div class="lesson-bar" id="lesson-bar" hidden>
        <div class="lb-info">
          <span class="lb-name"><span id="lb-name"></span><span class="lb-section" id="lb-section"></span></span>
          <span class="lb-stat"><span class="lb-k">Precisión</span><b id="lb-acc">100%</b></span>
          <span class="lb-stat"><span class="lb-k">Racha</span><b id="lb-streak">0</b></span>
          <span class="lb-stat" id="lb-pass-wrap"><span class="lb-k">Vuelta</span><b id="lb-pass">0/4</b></span>
        </div>
        <canvas id="tab" class="tab" aria-hidden="true"></canvas>
        <div class="song-progress" id="song-progress" aria-hidden="true"><span></span></div>
        <div class="lb-controls">
          <div class="stepper compact" aria-label="Tempo">
            <button type="button" class="icon-btn" data-lbpm="-5" aria-label="Más lento">${ICONS.minus}</button>
            <output id="lb-bpm"><b>80</b> ppm</output>
            <button type="button" class="icon-btn" data-lbpm="5" aria-label="Más rápido">${ICONS.plus}</button>
          </div>
          <div class="seg guide" role="radiogroup" aria-label="Guía">
            <button type="button" role="radio" data-guide="easy" aria-checked="${s.guide === 'easy'}">Fácil</button>
            <button type="button" role="radio" data-guide="score" aria-checked="${s.guide === 'score'}">Partitura</button>
          </div>
          <button type="button" class="chip" id="lb-wait" aria-pressed="false">Espera por mí</button>
          <button type="button" class="chip" id="lb-demo" aria-pressed="false">${ICONS.listen}<span>Escuchar</span></button>
          <button type="button" class="chip ghost" id="lb-stop">Terminar</button>
        </div>
      </div>

      <div class="countin" id="countin" hidden aria-live="polite"></div>
      <div class="banner" id="banner" hidden aria-live="polite"></div>
      <div id="judges" aria-hidden="true"></div>

      <div class="modal" id="summary" hidden role="dialog" aria-label="Resultado">
        <div class="modal-card">
          <p class="modal-kicker" id="sum-kicker">Lección completa</p>
          <div id="sum-stars"></div>
          <p class="big" id="sum-acc">0%</p>
          <p class="modal-sub" id="sum-sub">de precisión</p>
          <dl class="sum-stats" id="sum-stats"></dl>
          <div class="modal-actions">
            <button type="button" class="primary small" id="sum-next" hidden>Siguiente paso</button>
            <button type="button" class="chip" id="sum-again">Otra vez</button>
            <button type="button" class="chip" id="sum-faster">Más rápido</button>
            <button type="button" class="chip ghost" id="sum-other">Elegir otra</button>
          </div>
        </div>
      </div>

      <div class="tourcard" id="tourcard" hidden role="status" aria-live="polite">
        <p id="tour-text"></p>
        <button type="button" class="chip ghost" id="tour-skip">Saltar</button>
      </div>

      <div class="rotate-hint" id="rotate-hint" hidden role="status">
        ${ICONS.rotate}<p>Gira el teléfono: la batería se ve más grande.</p>
        <button type="button" class="icon-btn" id="rotate-ok" aria-label="Cerrar aviso">${ICONS.close}</button>
      </div>

      <div class="toast" id="tip" hidden role="status">
        <p>Toca con varios dedos a la vez. Deja el dedo sobre un platillo para silenciarlo.</p>
        <button type="button" class="chip" id="tip-ok">Entendido</button>
      </div>`;
    this.wire();
  }

  private pieceName(id: PieceId): string {
    const map: Record<PieceId, string> = { kick: 'Bombo', snare: 'Redoblante', tom1: 'Tom 1', tom2: 'Tom 2', floor: 'Tom de piso', hihat: 'Hi-hat', hhpedal: 'Pedal hi-hat', crash: 'Crash', crash2: 'Crash 2', ride: 'Ride' };
    return map[id];
  }

  private toggleSheet(id: string | null, forceOpen = false): void {
    const next = id ? this.$(id) : null;
    for (const el of this.root.querySelectorAll<HTMLElement>('.sheet, .pop')) {
      if (el !== next) el.hidden = true;
    }
    if (next) next.hidden = forceOpen ? false : !next.hidden;
    const open = next && !next.hidden ? next : null;
    this.$('#settings-btn').setAttribute('aria-pressed', String(open?.id === 'settings-sheet'));
    this.$('#help-btn').setAttribute('aria-pressed', String(open?.id === 'help-sheet'));
  }

  private setSwitch(el: HTMLElement, on: boolean): void {
    el.setAttribute('aria-checked', String(on));
  }

  private wire(): void {
    const s = this.settings;
    const save = () => saveSettings(s);

    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => this.setMode(b.dataset.mode as 'free' | 'learn')),
    );

    const viewButtons = this.root.querySelectorAll<HTMLButtonElement>('[data-view]');
    let viewIdx = 0;
    const pickView = (id: ViewId) => {
      viewIdx = VIEWS.findIndex((v) => v.id === id);
      viewButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === id)));
      this.act.setView(id);
    };
    viewButtons.forEach((b) => b.addEventListener('click', () => pickView(b.dataset.view as ViewId)));
    this.$('#cycle-view').addEventListener('click', () => pickView(VIEWS[(viewIdx + 1) % VIEWS.length].id));

    // metronome
    this.$('#metro-btn').addEventListener('click', () => this.toggleSheet('#metro-pop'));
    const metroSwitch = this.$('#metro-switch');
    const range = this.$('#metro-range') as HTMLInputElement;
    const showBpm = () => {
      this.$('#metro-bpm').innerHTML = `<b>${s.bpm}</b> ppm`;
      range.value = String(s.bpm);
    };
    const setMetro = (on: boolean) => {
      this.metroOn = on;
      this.setSwitch(metroSwitch, on);
      this.$('#metro-btn').setAttribute('aria-pressed', String(on));
      this.act.metronome(on, s.bpm);
    };
    metroSwitch.addEventListener('click', () => setMetro(!this.metroOn));
    this.root.querySelectorAll<HTMLButtonElement>('[data-bpm]').forEach((b) =>
      b.addEventListener('click', () => {
        s.bpm = Math.min(200, Math.max(40, s.bpm + Number(b.dataset.bpm)));
        showBpm();
        save();
        if (this.metroOn) this.act.metronome(true, s.bpm);
      }),
    );
    range.addEventListener('input', () => {
      s.bpm = Number(range.value);
      showBpm();
      save();
      if (this.metroOn) this.act.metronome(true, s.bpm);
    });

    // sheets
    this.$('#settings-btn').addEventListener('click', () => this.toggleSheet('#settings-sheet'));
    this.$('#help-btn').addEventListener('click', () => this.toggleSheet('#help-sheet'));
    this.root.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) =>
      b.addEventListener('click', () => {
        this.toggleSheet(null);
        if ((b.closest('#lessons-sheet') || b.closest('#song-sheet')) && !this.practice) this.setMode('free');
      }),
    );

    // settings
    this.root.querySelectorAll<HTMLButtonElement>('[data-finish]').forEach((b) =>
      b.addEventListener('click', () => {
        s.finish = b.dataset.finish as FinishId;
        this.root.querySelectorAll('[data-finish]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        this.act.setFinish(s.finish);
        save();
      }),
    );
    const vol = this.$('#set-volume') as HTMLInputElement;
    vol.addEventListener('input', () => {
      s.volume = Number(vol.value);
      this.act.setVolume(s.volume);
      save();
    });
    const room = this.$('#set-room') as HTMLInputElement;
    room.addEventListener('input', () => {
      s.room = Number(room.value);
      this.act.setRoom(s.room);
      save();
    });
    const sticks = this.$('#set-sticks');
    sticks.addEventListener('click', () => {
      s.sticks = !s.sticks;
      this.setSwitch(sticks, s.sticks);
      this.act.setSticks(s.sticks);
      save();
    });
    const haptics = this.root.querySelector<HTMLElement>('#set-haptics');
    haptics?.addEventListener('click', () => {
      s.haptics = !s.haptics;
      this.setSwitch(haptics, s.haptics);
      this.act.setHaptics(s.haptics);
      save();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-labels]').forEach((b) =>
      b.addEventListener('click', () => {
        s.labels = b.dataset.labels as LabelMode;
        this.root.querySelectorAll('[data-labels]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        this.act.setLabels(s.labels);
        save();
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-quality]').forEach((b) =>
      b.addEventListener('click', () => {
        s.quality = b.dataset.quality as QualityPref;
        this.root.querySelectorAll('[data-quality]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        this.act.setQuality(s.quality);
        save();
      }),
    );

    // learn: songs, grooves, steps
    this.$('#song-list').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-song]');
      if (b) this.openSong(SONGS.find((x) => x.id === b.dataset.song)!);
    });
    this.$('#song-back').addEventListener('click', () => {
      this.$('#song-list').innerHTML = this.songCards();
      this.toggleSheet('#lessons-sheet', true);
    });
    this.$('#step-list').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-step]');
      if (!b) return;
      const song = SONGS.find((x) => x.id === b.dataset.songId)!;
      this.begin({ kind: 'song', song, step: Number(b.dataset.step) });
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-lesson]').forEach((b) =>
      b.addEventListener('click', () => {
        const l = LESSONS.find((x) => x.id === b.dataset.lesson)!;
        this.begin({ kind: 'groove', lesson: l });
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-lbpm]').forEach((b) =>
      b.addEventListener('click', () => {
        this.lessonBpm = Math.min(180, Math.max(40, this.lessonBpm + Number(b.dataset.lbpm)));
        this.$('#lb-bpm').innerHTML = `<b>${this.lessonBpm}</b> ppm`;
        this.act.lessonBpm(this.lessonBpm);
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-guide]').forEach((b) =>
      b.addEventListener('click', () => {
        s.guide = b.dataset.guide as 'easy' | 'score';
        this.root.querySelectorAll('[data-guide]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        this.applyGuide();
        save();
      }),
    );
    this.$('#lb-wait').addEventListener('click', () => {
      this.wait = !this.wait;
      this.$('#lb-wait').setAttribute('aria-pressed', String(this.wait));
      this.act.lessonWait(this.wait);
    });
    this.$('#lb-demo').addEventListener('click', () => {
      this.demo = !this.demo;
      this.$('#lb-demo').setAttribute('aria-pressed', String(this.demo));
      this.act.lessonDemo(this.demo);
      const l = this.currentLesson();
      if (l) this.act.startLesson(l, this.lessonBpm, this.wait && !this.demo);
    });
    this.$('#lb-stop').addEventListener('click', () => {
      const p = this.practice;
      this.endLesson();
      if (p?.kind === 'song') this.openSong(p.song);
      else this.toggleSheet('#lessons-sheet', true);
    });
    this.$('#sum-next').addEventListener('click', () => {
      const p = this.practice;
      if (p?.kind === 'song' && p.step < 2) this.begin({ kind: 'song', song: p.song, step: p.step + 1 });
    });
    this.$('#sum-again').addEventListener('click', () => this.practice && this.begin(this.practice, this.lessonBpm));
    this.$('#sum-faster').addEventListener('click', () => this.practice && this.begin(this.practice, this.lessonBpm + 5));
    this.$('#sum-other').addEventListener('click', () => {
      const p = this.practice;
      this.$('#summary').hidden = true;
      this.endLesson();
      if (p?.kind === 'song') this.openSong(p.song);
      else this.toggleSheet('#lessons-sheet', true);
    });
    this.$('#tour-skip').addEventListener('click', () => {
      if (this.touring) this.act.stopLesson();
      this.endTour(true);
    });
    this.$('#rotate-ok').addEventListener('click', () => {
      this.$('#rotate-hint').hidden = true;
      s.rotateSeen = true;
      save();
    });
    const onOrient = () => this.checkRotate();
    window.addEventListener('resize', onOrient);
    this.$('#tip-ok').addEventListener('click', () => {
      this.$('#tip').hidden = true;
      s.tipSeen = true;
      save();
    });
  }

  /** Easy guide hides the tab; score guide shows it. Re-fits the camera to the bar's new height. */
  private applyGuide(): void {
    const easy = this.settings.guide === 'easy';
    this.$('#tab').hidden = easy;
    this.$('#song-progress').hidden = !easy;
    this.act.setGuide(this.settings.guide);
    if (!this.$('#lesson-bar').hidden) {
      requestAnimationFrame(() => {
        this.onLessonLayout?.();
        this.act.insetsChanged(this.measureInsets());
      });
    }
  }

  /** Free screen area for the kit, measured from the HUD as it is laid out right now. */
  measureInsets(): { top: number; right: number; bottom: number; left: number } {
    const bar = this.$('.hud-bar').getBoundingClientRect();
    const ins = { top: bar.bottom + 8, right: 12, bottom: 12, left: 12 };
    const lb = this.$('#lesson-bar');
    if (!lb.hidden) {
      const r = lb.getBoundingClientRect();
      if (r.height > r.width) {
        ins.right = window.innerWidth - r.left + 8;
        const tab = this.$('#tab');
        if (!tab.hidden) ins.bottom = window.innerHeight - tab.getBoundingClientRect().top + 8;
      } else {
        ins.bottom = window.innerHeight - r.top + 8;
      }
    }
    return ins;
  }

  /** 0..1 position in the current lesson (easy guide's progress line). */
  progressTo(f: number): void {
    (this.$('#song-progress').firstElementChild as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`;
  }

  private currentLesson(): Lesson | null {
    const p = this.practice;
    if (!p) return null;
    return p.kind === 'groove' ? p.lesson : p.song.steps[p.step].lesson;
  }

  private openSong(song: Song): void {
    this.progress = loadProgress();
    const p = this.progress[song.id] ?? [0, 0, 0];
    const firstOpen = p.findIndex((x) => !x);
    this.$('#song-title').textContent = song.name;
    this.$('#song-artist').textContent = song.artist;
    this.$('#song-blurb').textContent = song.blurb;
    this.$('#step-list').innerHTML = song.steps
      .map((st, i) => {
        const later = i > 0 && !p[i - 1];
        const rec = i === firstOpen;
        return `
          <button type="button" class="step-card ${later ? 'later' : ''} ${rec ? 'rec' : ''}" data-step="${i}" data-song-id="${song.id}">
            <span class="step-top"><span class="step-num">Paso ${i + 1}</span>${rec ? '<span class="step-rec">Empieza aquí</span>' : ''}${stars(earnedStars(this.progress, song.id, i), 'small')}</span>
            <span class="step-name">${st.name}</span>
            <span class="step-blurb">${st.blurb}</span>
            <span class="step-meta">${Math.round(song.bpm * st.tempo)} ppm${st.wait ? ' · la canción te espera' : ''}</span>
            ${grid(st.lesson, 32)}
          </button>`;
      })
      .join('');
    this.toggleSheet('#song-sheet', true);
    (this.$('#song-sheet') as HTMLElement).scrollTop = 0;
  }

  private hitsSinceTip = 0;
  private touring = false;

  /** First-run tour: pieces light up one at a time; the kit waits for each hit. */
  startTour(): void {
    this.touring = true;
    this.act.setGuide('easy');
    const card = this.$('#tourcard');
    card.hidden = false;
    this.$('#tour-skip').textContent = 'Saltar';
    this.tourText(TOUR.sections![0].name);
    this.act.startLesson(TOUR, TOUR.bpm, true);
  }

  private tourText(text: string): void {
    const p = this.$('#tour-text');
    p.textContent = text;
    p.classList.remove('tour-in');
    void p.offsetWidth;
    p.classList.add('tour-in');
  }

  private endTour(showTip: boolean): void {
    this.touring = false;
    this.$('#tourcard').hidden = true;
    this.settings.tourSeen = true;
    saveSettings(this.settings);
    this.act.setGuide(this.settings.guide);
    if (showTip) window.setTimeout(() => this.showTip(), 400);
  }

  /** Phones held upright get a gentle hint: sideways, the kit is much bigger. */
  checkRotate(): void {
    const phone = Math.min(screen.width, screen.height) < 500 && matchMedia('(pointer: coarse)').matches;
    const upright = window.innerHeight > window.innerWidth;
    this.$('#rotate-hint').hidden = !(phone && upright && !this.settings.rotateSeen);
  }

  showTip(): void {
    if (!this.settings.tipSeen) this.$('#tip').hidden = false;
  }

  /** The tip goes away by itself once the player is clearly drumming. */
  played(): void {
    const tip = this.$('#tip');
    if (tip.hidden) return;
    if (++this.hitsSinceTip >= 8) {
      tip.hidden = true;
      this.settings.tipSeen = true;
      saveSettings(this.settings);
    }
  }

  setMode(mode: 'free' | 'learn'): void {
    if (this.touring) {
      this.act.stopLesson();
      this.endTour(false);
    }
    this.mode = mode;
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    if (mode === 'learn') {
      if (this.metroOn) {
        this.metroOn = false;
        this.setSwitch(this.$('#metro-switch'), false);
        this.$('#metro-btn').setAttribute('aria-pressed', 'false');
        this.act.metronome(false, this.settings.bpm);
      }
      this.$('#tip').hidden = true;
      if (!this.practice) {
        this.$('#song-list').innerHTML = this.songCards();
        this.toggleSheet('#lessons-sheet', true);
      }
    } else {
      this.endLesson();
      this.toggleSheet(null);
    }
    this.$('#metro-btn').hidden = mode === 'learn';
  }

  private begin(p: Practice, bpm?: number): void {
    this.practice = p;
    const lesson = p.kind === 'groove' ? p.lesson : p.song.steps[p.step].lesson;
    const baseBpm = p.kind === 'groove' ? p.lesson.bpm : Math.round(p.song.bpm * p.song.steps[p.step].tempo);
    this.lessonBpm = Math.min(180, Math.max(40, bpm ?? baseBpm));
    if (bpm === undefined) this.wait = p.kind === 'song' ? p.song.steps[p.step].wait : false;
    this.demo = false;
    this.$('#lb-demo').setAttribute('aria-pressed', 'false');
    this.$('#lb-wait').setAttribute('aria-pressed', String(this.wait));
    this.act.lessonDemo(false);
    this.$('#summary').hidden = true;
    this.toggleSheet(null);
    this.$('#lb-name').textContent = p.kind === 'song' ? `${p.song.name} · Paso ${p.step + 1}` : p.lesson.name;
    this.$('#lb-section').textContent = '';
    this.$('#lb-pass-wrap').hidden = p.kind === 'song';
    this.$('#lb-bpm').innerHTML = `<b>${this.lessonBpm}</b> ppm`;
    this.$('#lesson-bar').hidden = false;
    this.applyGuide();
    this.act.startLesson(lesson, this.lessonBpm, this.wait);
    requestAnimationFrame(() => {
      this.onLessonLayout?.();
      this.act.insetsChanged(this.measureInsets());
    });
  }

  private endLesson(): void {
    if (!this.practice && this.$('#lesson-bar').hidden) return;
    this.act.stopLesson();
    this.practice = null;
    this.$('#lesson-bar').hidden = true;
    this.$('#countin').hidden = true;
    this.$('#summary').hidden = true;
    this.$('#banner').hidden = true;
    this.act.insetsChanged(this.measureInsets());
  }

  stats(s: Stats): void {
    this.$('#lb-pass').textContent = `${Math.max(1, s.pass)}/${s.passes}`;
    this.$('#lb-acc').textContent = `${Math.round(s.accuracy * 100)}%`;
    this.$('#lb-streak').textContent = String(s.streak);
  }

  section(name: string, upcoming: boolean): void {
    if (this.touring) {
      if (!upcoming) this.tourText(name);
      return;
    }
    const el = this.$('#lb-section');
    el.textContent = upcoming ? `Viene: ${name}` : name;
    el.classList.toggle('upcoming', upcoming);
    if (!upcoming) this.flashBanner(name, 1300);
  }

  get inTour(): boolean {
    return this.touring;
  }

  streak(n: number): void {
    this.flashBanner(`¡Racha de ${n}!`, 1200, true);
  }

  private flashBanner(text: string, ms: number, hot = false): void {
    const b = this.$('#banner');
    b.textContent = text;
    b.classList.toggle('hot', hot);
    b.hidden = false;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    window.clearTimeout(this.sectionTimer);
    this.sectionTimer = window.setTimeout(() => (b.hidden = true), ms);
  }

  countIn(left: number): void {
    if (this.touring) return;
    const el = this.$('#countin');
    if (left <= 0) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const hint = this.settings.guide === 'easy' ? 'Toca lo que se ilumine' : 'Prepárate';
    el.innerHTML = `<span class="ci-k">${hint}</span><span class="ci-n">${left}</span>`;
    el.classList.remove('beat');
    void el.offsetWidth;
    el.classList.add('beat');
  }

  judge(piece: PieceId, grade: Grade): void {
    const text = GRADE_TEXT[grade];
    if (!text) return;
    // one word per drum at a time: fast hi-hat eighths shouldn't pile up text
    const now = performance.now();
    if (now - (this.lastJudge.get(piece) ?? -1e9) < 320) return;
    this.lastJudge.set(piece, now);
    const at = this.act.project(piece);
    if (!at) return;
    const el = document.createElement('div');
    el.className = `judge ${grade}`;
    el.textContent = text;
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    this.$('#judges').appendChild(el);
    window.setTimeout(() => el.remove(), 700);
  }

  finish(s: Stats): void {
    if (this.touring) {
      this.touring = false;
      this.tourText('¡Ya estás tocando! Sigue libre, o entra en «Aprender» para tocar canciones.');
      this.$('#tour-skip').textContent = '¡Vamos!';
      this.touring = false;
      this.act.setGuide(this.settings.guide);
      this.settings.tourSeen = true;
      saveSettings(this.settings);
      return;
    }
    const p = this.practice;
    if (!p) return;
    const title = p.kind === 'song' ? `${p.song.name} · Paso ${p.step + 1}` : p.lesson.name;
    const next = this.$('#sum-next') as HTMLButtonElement;
    const again = this.$('#sum-again') as HTMLButtonElement;
    (this.$('#sum-faster') as HTMLButtonElement).hidden = p.kind === 'song';
    if (s.judged === 0) {
      // the demo finished: invite the player to try
      this.demo = false;
      this.$('#lb-demo').setAttribute('aria-pressed', 'false');
      this.act.lessonDemo(false);
      this.$('#sum-kicker').textContent = title;
      this.$('#sum-stars').innerHTML = '';
      this.$('#sum-acc').textContent = 'Ahora tú';
      this.$('#sum-sub').textContent = 'Ya lo escuchaste. Toca lo mismo siguiendo los círculos.';
      this.$('#sum-stats').innerHTML = '';
      next.hidden = true;
      again.textContent = 'Empezar';
    } else {
      const earned = starsFor(s.accuracy, s.miss / Math.max(1, s.total));
      if (p.kind === 'song') this.progress = saveStars(p.song.id, p.step, earned);
      this.$('#sum-kicker').textContent = `${title} · ${this.lessonBpm} ppm`;
      this.$('#sum-stars').innerHTML = stars(earned, 'big-stars');
      this.$('#sum-acc').textContent = `${Math.round(s.accuracy * 100)}%`;
      this.$('#sum-sub').textContent = earned === 0 ? 'Casi. Prueba con «Espera por mí» o más lento.' : this.wait ? 'de notas en su sitio' : 'de precisión';
      this.$('#sum-stats').innerHTML = this.wait
        ? `<div><dt>Notas</dt><dd>${s.perfect}</dd></div><div><dt>Mejor racha</dt><dd>${s.best}</dd></div>`
        : `<div><dt>Perfectos</dt><dd>${s.perfect}</dd></div><div><dt>Bien</dt><dd>${s.good}</dd></div><div><dt>Fuera de tiempo</dt><dd>${s.off}</dd></div><div><dt>Fallados</dt><dd>${s.miss}</dd></div><div><dt>Mejor racha</dt><dd>${s.best}</dd></div>`;
      next.hidden = !(p.kind === 'song' && p.step < 2 && earned > 0);
      next.textContent = p.kind === 'song' && p.step < 2 ? `Paso ${p.step + 2}: ${p.song.steps[p.step + 1].name}` : 'Siguiente paso';
      again.textContent = 'Otra vez';
    }
    this.$('#summary').hidden = false;
  }

  /** Beat pulse on the metronome button. */
  pulse(accent: boolean): void {
    const b = this.$('#metro-btn');
    b.classList.remove('tick', 'accent');
    void b.offsetWidth;
    b.classList.add('tick');
    if (accent) b.classList.add('accent');
  }
}
