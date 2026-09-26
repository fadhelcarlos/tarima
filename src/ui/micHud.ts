import { KEYS, PRESETS, type ReverbKind, type VoiceSettings } from '../mic/vocal';
import type { MicStation } from '../mic/station';
import { KSONGS } from '../songs/karaoke';
import catalogJson from '../songs/youtube.json';
import { videoIdFrom } from '../mic/youtube';
import { ICONS } from './icons';

const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>';
const NOTES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>';

type HarmonyChoice = 'no' | 'terceras' | 'coro';

interface CatalogSong {
  artist: string;
  title: string;
  genre: string;
  videoId: string;
  channel: string;
  duration: string;
}

const CATALOG = catalogJson as CatalogSong[];
const GENRES = ['Rock en español', 'Pop', 'Baladas', 'Clásicos', 'In English'];
const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface MicHudActions {
  openInstruments(): void;
  micStart(headphones: boolean): Promise<void>;
  micToggleMute(): void;
  setBand(on: boolean): void;
  playVideo(videoId: string, title: string): Promise<void>;
  stopVideo(): void;
}

/** Controls for the singer: one big mic button, presets, effects, songs. */
export class MicHud {
  private readonly root: HTMLElement;
  private headphones: boolean | null = null;
  private muted = false;

  constructor(container: HTMLElement, private readonly station: MicStation, private readonly act: MicHudActions) {
    this.root = container;
    this.render();
  }

  private $(sel: string): HTMLElement {
    return this.root.querySelector(sel) as HTMLElement;
  }

  set visible(v: boolean) {
    this.root.hidden = !v;
  }

  private render(): void {
    const v = this.station.vocal.settings;
    const slider = (id: string, label: string, min: number, max: number, step: number, value: number) =>
      `<label class="row"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" /></label>`;
    this.root.innerHTML = `
      <div class="hud-bar">
        <div class="hud-group">
          <button type="button" class="inst-btn" data-inst aria-label="Cambiar de instrumento">${MIC}<span>Micrófono</span></button>
        </div>
        <div class="hud-group">
          <button type="button" class="chip" id="mic-songs">${NOTES}<span>Canciones</span></button>
          <button type="button" class="icon-btn" id="mic-fx" aria-label="Efectos de voz">${ICONS.settings}</button>
        </div>
      </div>

      <div class="mic-dock">
        <div class="presets" role="radiogroup" aria-label="Sonido de la voz">
          ${PRESETS.map((p, i) => `<button type="button" role="radio" data-preset="${p.id}" aria-checked="${i === 0}">${p.name}</button>`).join('')}
        </div>

      </div>
      <button type="button" class="mic-cue" id="mic-btn" aria-label="Encender el micrófono"><span class="mic-dot"></span><span id="mic-state">Toca el micrófono para cantar</span></button>
      <div class="mic-left">
        <button type="button" class="chip ghost" id="mic-stop-song" hidden>Detener canción</button>
        <button type="button" class="chip" id="mic-pause" hidden>Pausa</button>
      </div>
      <div class="toast tap-hint" id="tap-hint" hidden role="status"><p>Toca la pantalla del proyector para que empiece el video.</p></div>

      <aside class="sheet" id="mic-song-sheet" hidden aria-label="Canciones">
        <header><h2>Canciones</h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">${ICONS.close}</button></header>
        <p class="sheet-intro">Karaoke con la pista y la letra original en la pantalla del proyector. Tu voz pasa en vivo por los efectos.</p>
        <label class="search"><span class="visually-hidden">Buscar</span><input type="search" id="song-search" placeholder="Busca canción o artista" autocomplete="off" /></label>
        <div id="song-results"></div>
        <div class="yt-paste">
          <p>¿No está la que quieres? Búscala en YouTube, copia el enlace del karaoke y pégalo aquí.</p>
          <a class="chip" id="yt-search-link" href="https://www.youtube.com/results?search_query=karaoke" target="_blank" rel="noopener">Buscar en YouTube</a>
          <div class="yt-row"><input type="url" id="yt-url" placeholder="Pega el enlace de YouTube" autocomplete="off" /><button type="button" class="primary small" id="yt-go">Cantar</button></div>
        </div>
        <h3>Con la banda de Tarima</h3>
        <div class="song-list">
          ${KSONGS.map((k) => `
            <button type="button" class="song" data-ksong="${k.id}">
              <span class="song-head"><span class="song-title"><span class="song-name">${k.title}</span><span class="song-artist">Banda en vivo · guía de afinación</span></span><span class="song-meta">${k.bpm} ppm</span></span>
            </button>`).join('')}
        </div>
      </aside>

      <aside class="sheet" id="mic-fx-sheet" hidden aria-label="Efectos de voz">
        <header><h2>Efectos de voz</h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">${ICONS.close}</button></header>
        <section class="rows">
          <h3>Afinación</h3>
          ${slider('fx-tune', 'Intensidad', 0, 1, 0.01, v.tune)}
          ${slider('fx-speed', 'Naturalidad', 0, 0.2, 0.005, v.tuneSpeed)}
          <div class="row stack"><span>Tonalidad</span>
            <div class="key-grid" role="radiogroup" aria-label="Tonalidad">
              ${KEYS.map((k, i) => `<button type="button" role="radio" data-key="${i}" aria-checked="${i === v.key}">${k}</button>`).join('')}
            </div>
            <div class="seg small" role="radiogroup" aria-label="Escala">
              ${(['mayor', 'menor', 'cromatica'] as const).map((sc) => `<button type="button" role="radio" data-scale="${sc}" aria-checked="${sc === v.scale}">${sc === 'cromatica' ? 'Cromática' : sc[0].toUpperCase() + sc.slice(1)}</button>`).join('')}
            </div>
          </div>
          <div class="row stack"><span>Armonías</span>
            <div class="seg small" role="radiogroup" aria-label="Armonías">
              ${(['no', 'terceras', 'coro'] as HarmonyChoice[]).map((h) => `<button type="button" role="radio" data-harm="${h}" aria-checked="${h === 'no'}">${h === 'no' ? 'Sin armonías' : h === 'terceras' ? 'Terceras' : 'Coro completo'}</button>`).join('')}
            </div>
          </div>
          ${slider('fx-harmmix', 'Volumen de armonías', 0, 1, 0.01, 0.5)}
          <h3>Espacio</h3>
          ${slider('fx-double', 'Voz doblada', 0, 1, 0.01, v.double)}
          ${slider('fx-delay', 'Eco', 0, 0.6, 0.01, v.delayMix)}
          ${slider('fx-fb', 'Repeticiones', 0, 0.8, 0.01, v.delayFeedback)}
          <div class="row stack"><span>Reverb</span>
            <div class="seg small" role="radiogroup" aria-label="Tipo de reverb">
              ${(['sala', 'plate', 'estadio'] as ReverbKind[]).map((r) => `<button type="button" role="radio" data-reverb="${r}" aria-checked="${r === v.reverb}">${r === 'sala' ? 'Sala' : r === 'plate' ? 'Plate' : 'Estadio'}</button>`).join('')}
            </div>
          </div>
          ${slider('fx-rev', 'Cantidad de reverb', 0, 0.6, 0.01, v.reverbMix)}
          <h3>Tono</h3>
          ${slider('fx-warm', 'Calidez', 0, 1, 0.01, v.warmth)}
          ${slider('fx-pres', 'Presencia', -6, 8, 0.5, v.presence)}
          ${slider('fx-bass', 'Graves', -8, 6, 0.5, v.bass)}
          <h3>Mezcla</h3>
          ${slider('fx-vol', 'Volumen de la voz', 0, 1.5, 0.01, 1)}
          ${slider('fx-track', 'Volumen de la pista', 0, 1, 0.01, 0.8)}
          <div class="row"><span>Banda de acompañamiento</span><button type="button" class="switch" id="fx-drums" role="switch" aria-checked="true" aria-label="Banda de acompañamiento"><span></span></button></div>
        </section>
      </aside>

      <div class="modal" id="mic-hp" hidden role="dialog" aria-label="Audífonos">
        <div class="modal-card">
          <p class="modal-kicker">Antes de cantar</p>
          <p class="big small-big">¿Tienes audífonos puestos?</p>
          <p class="modal-sub">Con audífonos tu voz suena mejor. Sin ellos activamos la cancelación de eco para que el altavoz no se acople.</p>
          <div class="modal-actions">
            <button type="button" class="primary small" data-hp="1">Sí, con audífonos</button>
            <button type="button" class="chip" data-hp="0">No, uso el altavoz</button>
          </div>
        </div>
      </div>

      <div class="toast mic-msg" id="mic-msg" hidden role="alert"><p id="mic-msg-text"></p><button type="button" class="chip" id="mic-msg-ok">Entendido</button></div>`;
    this.wire();
  }

  private renderResults(q: string): void {
    const f = fold(q.trim());
    const match = (c: CatalogSong) => !f || fold(`${c.title} ${c.artist}`).includes(f);
    const html = GENRES.map((g) => {
      const items = CATALOG.filter((c) => c.genre === g && match(c));
      if (!items.length) return '';
      return `<h3>${g}</h3><div class="song-list">${items
        .map((c) => `<button type="button" class="song" data-video="${c.videoId}" data-title="${esc(`${c.title} · ${c.artist}`)}"><span class="song-head"><span class="song-title"><span class="song-name">${esc(c.title)}</span><span class="song-artist">${esc(c.artist)}</span></span><span class="song-meta">${c.duration}</span></span></button>`)
        .join('')}</div>`;
    }).join('');
    this.$('#song-results').innerHTML = html || `<p class="sheet-intro">No la tenemos en la lista. Usa «Buscar en YouTube» y pega el enlace.</p>`;
    (this.$('#yt-search-link') as HTMLAnchorElement).href = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${q.trim()} karaoke`)}`;
  }

  private currentVideo = '';

  private async startVideo(id: string, title: string): Promise<void> {
    this.currentVideo = id;
    this.toggleSheet(null);
    this.$('#mic-stop-song').hidden = false;
    this.$('#mic-pause').hidden = false;
    this.$('#mic-pause').textContent = 'Pausa';
    try {
      await this.act.playVideo(id, title);
    } catch {
      this.$('#mic-stop-song').hidden = true;
      this.$('#mic-pause').hidden = true;
      this.message('Los videos de karaoke necesitan conexión a YouTube. Ábrelo en fadhelcarlos.github.io/tarima con internet.');
      return;
    }
    if (!this.station.live) this.message('La canción está sonando. Toca el micrófono para cantar con tus efectos.');
    // if the browser blocked autoplay, the next tap must reach the video itself
    window.setTimeout(() => {
      const s = this.station.video.state;
      if (this.station.video.visible && s !== 1 && s !== 3) {
        this.station.video.acceptTaps = true;
        this.$('#tap-hint').hidden = false;
      }
    }, 2500);
  }

  /** Player state changes (1 = playing, 3 = buffering, 0 = ended). */
  videoState(s: number): void {
    if (s === 1 || s === 3) {
      this.station.video.acceptTaps = false;
      this.$('#tap-hint').hidden = true;
    }
    if (s === 0) {
      this.$('#mic-stop-song').hidden = true;
      this.$('#mic-pause').hidden = true;
    }
  }

  videoError(code: number): void {
    const id = this.currentVideo;
    this.$('#mic-stop-song').hidden = true;
    this.$('#mic-pause').hidden = true;
    this.$('#tap-hint').hidden = true;
    const text = code === 101 || code === 150 ? 'El dueño de este video no deja reproducirlo fuera de YouTube.' : 'Ese video no se pudo reproducir.';
    this.$('#mic-msg-text').innerHTML = `${text} <a href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">Ábrelo en YouTube</a> o elige otra versión.`;
    this.$('#mic-msg').hidden = false;
  }

  private toggleSheet(id: string | null): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('.sheet')) el.hidden = el.id !== id ? true : !el.hidden;
  }

  private message(text: string): void {
    this.$('#mic-msg-text').textContent = text;
    this.$('#mic-msg').hidden = false;
  }

  private setPressed(sel: string, el: Element): void {
    this.root.querySelectorAll(sel).forEach((x) => x.setAttribute('aria-checked', String(x === el)));
  }

  private syncControls(): void {
    const v = this.station.vocal.settings;
    const setVal = (id: string, val: number) => ((this.$(`#${id}`) as HTMLInputElement).value = String(val));
    setVal('fx-tune', v.tune);
    setVal('fx-speed', v.tuneSpeed);
    setVal('fx-double', v.double);
    setVal('fx-delay', v.delayMix);
    setVal('fx-fb', v.delayFeedback);
    setVal('fx-rev', v.reverbMix);
    setVal('fx-warm', v.warmth);
    setVal('fx-pres', v.presence);
    setVal('fx-bass', v.bass);
    this.root.querySelectorAll('[data-reverb]').forEach((x) => x.setAttribute('aria-checked', String((x as HTMLElement).dataset.reverb === v.reverb)));
    this.root.querySelectorAll('[data-key]').forEach((x) => x.setAttribute('aria-checked', String(Number((x as HTMLElement).dataset.key) === v.key)));
    this.root.querySelectorAll('[data-scale]').forEach((x) => x.setAttribute('aria-checked', String((x as HTMLElement).dataset.scale === v.scale)));
    const harm: HarmonyChoice = v.harmonies.length === 0 || v.harmonyMix === 0 ? 'no' : v.harmonies.length === 1 ? 'terceras' : 'coro';
    this.root.querySelectorAll('[data-harm]').forEach((x) => x.setAttribute('aria-checked', String((x as HTMLElement).dataset.harm === harm)));
  }

  private wire(): void {
    const st = this.station;
    const apply = (s: Partial<VoiceSettings>) => st.vocal.apply(s);
    this.root.querySelectorAll('[data-inst]').forEach((b) => b.addEventListener('click', () => this.act.openInstruments()));
    this.$('#mic-songs').addEventListener('click', () => this.toggleSheet('mic-song-sheet'));
    this.$('#mic-fx').addEventListener('click', () => this.toggleSheet('mic-fx-sheet'));
    this.root.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) => b.addEventListener('click', () => this.toggleSheet(null)));
    this.$('#mic-msg-ok').addEventListener('click', () => (this.$('#mic-msg').hidden = true));

    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = PRESETS.find((x) => x.id === b.dataset.preset)!;
        const keep = { key: st.vocal.settings.key, scale: st.vocal.settings.scale };
        apply({ ...p.settings, ...keep });
        st.presetName = p.name;
        this.setPressed('[data-preset]', b);
        this.syncControls();
      }),
    );

    const micBtn = this.$('#mic-btn');
    micBtn.addEventListener('click', () => {
      if (!st.live) {
        if (!navigator.mediaDevices?.getUserMedia) {
          this.message('El micrófono no está disponible en esta vista. Abre la tarima en fadhelcarlos.github.io/tarima para cantar.');
          return;
        }
        if (this.headphones === null) {
          this.$('#mic-hp').hidden = false;
          return;
        }
        void this.startMic(this.headphones);
        return;
      }
      this.muted = !this.muted;
      this.act.micToggleMute();
      this.refreshMic();
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-hp]').forEach((b) =>
      b.addEventListener('click', () => {
        this.headphones = b.dataset.hp === '1';
        this.$('#mic-hp').hidden = true;
        void this.startMic(this.headphones);
      }),
    );

    this.root.querySelectorAll<HTMLButtonElement>('[data-ksong]').forEach((b) =>
      b.addEventListener('click', () => {
        const song = KSONGS.find((s) => s.id === b.dataset.ksong)!;
        st.startSong(song);
        this.syncControls();
        this.toggleSheet(null);
        this.$('#mic-stop-song').hidden = false;
        if (!st.live) this.message('La canción está sonando. Enciende el micrófono para cantarla y sumar puntos.');
      }),
    );
    this.$('#mic-stop-song').addEventListener('click', () => {
      st.stopSong();
      this.act.stopVideo();
      this.$('#mic-stop-song').hidden = true;
      this.$('#mic-pause').hidden = true;
      this.$('#tap-hint').hidden = true;
    });
    this.$('#mic-pause').addEventListener('click', () => {
      const v = st.video;
      if (v.playing) {
        v.pause();
        this.$('#mic-pause').textContent = 'Seguir';
      } else {
        v.resume();
        this.$('#mic-pause').textContent = 'Pausa';
      }
    });
    const search = this.$('#song-search') as HTMLInputElement;
    this.renderResults('');
    search.addEventListener('input', () => this.renderResults(search.value));
    this.$('#song-results').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-video]');
      if (b) void this.startVideo(b.dataset.video!, b.dataset.title ?? '');
    });
    this.$('#yt-go').addEventListener('click', () => {
      const id = videoIdFrom((this.$('#yt-url') as HTMLInputElement).value);
      if (!id) {
        this.message('Ese enlace no parece de YouTube. Copia el enlace del video (por ejemplo, youtube.com/watch?v=…) y pégalo.');
        return;
      }
      void this.startVideo(id, 'Tu canción');
    });
    st.onFinish = () => window.setTimeout(() => (this.$('#mic-stop-song').hidden = true), 2500);

    const range = (id: string, fn: (v: number) => void) => {
      const el = this.$(`#${id}`) as HTMLInputElement;
      el.addEventListener('input', () => fn(Number(el.value)));
    };
    range('fx-tune', (x) => apply({ tune: x }));
    range('fx-speed', (x) => apply({ tuneSpeed: x }));
    range('fx-double', (x) => apply({ double: x }));
    range('fx-delay', (x) => apply({ delayMix: x }));
    range('fx-fb', (x) => apply({ delayFeedback: x }));
    range('fx-rev', (x) => apply({ reverbMix: x }));
    range('fx-warm', (x) => apply({ warmth: x }));
    range('fx-pres', (x) => apply({ presence: x }));
    range('fx-bass', (x) => apply({ bass: x }));
    range('fx-harmmix', (x) => apply({ harmonyMix: x }));
    range('fx-vol', (x) => (st.vocal.volume = x));
    range('fx-track', (x) => (st.video.volume = x));
    this.root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((b) =>
      b.addEventListener('click', () => {
        st.manualKey = true;
        apply({ key: Number(b.dataset.key) });
        this.setPressed('[data-key]', b);
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-scale]').forEach((b) =>
      b.addEventListener('click', () => {
        apply({ scale: b.dataset.scale as VoiceSettings['scale'] });
        this.setPressed('[data-scale]', b);
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-harm]').forEach((b) =>
      b.addEventListener('click', () => {
        const h = b.dataset.harm as HarmonyChoice;
        const chosen = (this.$('#fx-harmmix') as HTMLInputElement).valueAsNumber;
        const mix = Number.isFinite(chosen) && chosen > 0 ? chosen : 0.5;
        apply({ harmonies: h === 'no' ? [] : h === 'terceras' ? [2] : [2, 4], harmonyMix: h === 'no' ? 0 : mix, tune: Math.max(st.vocal.settings.tune, h === 'no' ? 0 : 0.6) });
        this.setPressed('[data-harm]', b);
        this.syncControls();
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('[data-reverb]').forEach((b) =>
      b.addEventListener('click', () => {
        apply({ reverb: b.dataset.reverb as ReverbKind });
        this.setPressed('[data-reverb]', b);
      }),
    );
    const drums = this.$('#fx-drums');
    drums.addEventListener('click', () => {
      const on = !st.drumsOn;
      this.act.setBand(on);
      drums.setAttribute('aria-checked', String(on));
    });
  }

  private async startMic(headphones: boolean): Promise<void> {
    this.$('#mic-state').textContent = 'Conectando…';
    try {
      await this.act.micStart(headphones);
      this.muted = false;
    } catch (err) {
      const name = (err as { name?: string }).name ?? '';
      this.message(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'No tenemos permiso para usar el micrófono. Actívalo en los ajustes del navegador para este sitio y vuelve a tocar el botón.'
          : name === 'NotFoundError'
            ? 'No encontramos ningún micrófono en este dispositivo.'
            : 'No se pudo abrir el micrófono. Cierra otras apps que lo estén usando y vuelve a intentarlo.',
      );
    }
    this.refreshMic();
  }

  private refreshMic(): void {
    const st = this.station;
    const btn = this.$('#mic-btn');
    const on = st.live && !this.muted;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-label', !st.live ? 'Encender el micrófono' : on ? 'Silenciar el micrófono' : 'Activar el micrófono');
    this.$('#mic-state').textContent = !st.live ? 'Toca el micrófono para cantar' : on ? (st.detectedKey ? `Al aire · ${st.detectedKey}` : 'Al aire') : 'Silenciado · toca el micrófono';
  }

  /** The 3D microphone was tapped: same as the cue button. */
  tapMic(): void {
    (this.$('#mic-btn') as HTMLButtonElement).click();
  }

  /** Keeps the cue label floating just under the microphone on screen. */
  place(x: number, y: number): void {
    const cue = this.$('#mic-btn');
    cue.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }

  /** Fractions of the screen the controls cover, so the camera frames around them. */
  measure(): { top: number; bottom: number; right: number } {
    const W = window.innerWidth, H = window.innerHeight;
    const bar = this.$('.hud-bar').getBoundingClientRect();
    const dock = this.$('.mic-dock').getBoundingClientRect();
    const side = dock.height > dock.width * 0.9 || window.innerWidth > window.innerHeight;
    return side
      ? { top: bar.bottom / H, bottom: 0.02, right: Math.min(0.45, (W - dock.left + 8) / W) }
      : { top: bar.bottom / H, bottom: Math.min(0.45, (H - dock.top + 8) / H), right: 0 };
  }

  private lastKey: string | null = null;

  level(v: number): void {
    if (this.station.detectedKey !== this.lastKey) {
      this.lastKey = this.station.detectedKey;
      this.refreshMic();
      this.syncControls();
    }
    const dot = this.root.querySelector<HTMLElement>('.mic-cue.on .mic-dot');
    if (dot) dot.style.transform = `scale(${1 + Math.min(0.8, v * 10)})`;
  }

}
