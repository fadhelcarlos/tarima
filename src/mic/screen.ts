import type { KSong, Syllable } from '../songs/karaoke';

const NAMES = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];

export interface ScreenState {
  /** Current song position in beats (song mode), or null for free singing. */
  beat: number | null;
  song: KSong | null;
  /** Singer's pitch in MIDI (fractional) or -1 when silent. */
  midi: number;
  /** Note the pitch corrector is steering to, or -1. */
  target: number;
  level: number;
  preset: string;
  keyName: string;
  live: boolean;
  score: number;
  /** Per-syllable hit ratio (0..1), by global syllable index. */
  hits: Float32Array | null;
  finished: boolean;
}

const C = {
  bg0: '#070a12',
  bg1: '#0e1424',
  text: '#f4f1ea',
  dim: 'rgba(244,241,234,0.42)',
  faint: 'rgba(244,241,234,0.14)',
  gold: '#ffc861',
  cyan: '#39d7ff',
};

/**
 * Draws the projected karaoke image: SingStar-style pitch lane on top, the current lyric line
 * sweeping syllable by syllable, the next line below, count-in dots, score. In free mode it
 * becomes a big tuner that names the note you're singing.
 */
export class KaraokeScreen {
  private readonly ctx: CanvasRenderingContext2D;
  private trail: { t: number; m: number }[] = [];
  private readonly W: number;
  private readonly H: number;
  private font = '"Archivo", "Helvetica Neue", sans-serif';

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.W = canvas.width;
    this.H = canvas.height;
  }

  private bg(): void {
    const { ctx, W, H } = this;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg1);
    g.addColorStop(1, C.bg0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  private text(s: string, x: number, y: number, size: number, color: string, weight = 700, align: CanvasTextAlign = 'left', width = 110): void {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${this.font}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    // Archivo's width axis via font-stretch keywords keeps titles wide and lyrics compact
    (ctx as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = width >= 115 ? 'expanded' : width <= 95 ? 'semi-condensed' : 'normal';
    ctx.fillText(s, x, y);
  }

  draw(s: ScreenState, now: number): void {
    this.bg();
    if (s.midi >= 0) this.trail.push({ t: now, m: s.midi });
    while (this.trail.length && now - this.trail[0].t > 2.4) this.trail.shift();
    if (s.song && s.beat !== null) this.drawSong(s, now);
    else this.drawFree(s, now);
    this.drawFooter(s);
  }

  private drawFooter(s: ScreenState): void {
    const { W, H } = this;
    this.text(s.live ? `${s.preset} · ${s.keyName}` : 'Micrófono apagado', 40, H - 28, 22, C.dim, 600);
    // live level meter, bottom right
    const bars = 18;
    for (let i = 0; i < bars; i++) {
      const on = s.live && i / bars < Math.min(1, s.level * 14);
      this.ctx.fillStyle = on ? (i > bars * 0.8 ? '#ff7a59' : C.cyan) : C.faint;
      this.ctx.fillRect(W - 40 - (bars - i) * 12, H - 44, 8, 18);
    }
  }

  private drawFree(s: ScreenState, now: number): void {
    const { W, ctx } = this;
    this.text('Canta libre', W / 2, 92, 34, C.dim, 600, 'center');
    if (s.midi >= 0) {
      const n = Math.round(s.midi);
      const name = NAMES[((n % 12) + 12) % 12];
      const oct = Math.floor(n / 12) - 1;
      this.text(name, W / 2 - 10, 330, 190, C.text, 800, 'center', 115);
      this.text(String(oct), W / 2 + ctx.measureText(name).width / 2 + 6, 330, 64, C.dim, 700, 'left');
      // tuner needle
      const cents = (s.midi - n) * 100;
      const cx = W / 2, y = 410, w = 520;
      ctx.fillStyle = C.faint;
      ctx.fillRect(cx - w / 2, y, w, 6);
      for (const c of [-50, -25, 0, 25, 50]) ctx.fillRect(cx + (c / 50) * (w / 2) - 1, y - 10, 2, 26);
      const ok = Math.abs(cents) < 12;
      ctx.fillStyle = ok ? C.gold : C.cyan;
      ctx.beginPath();
      ctx.arc(cx + (Math.max(-50, Math.min(50, cents)) / 50) * (w / 2), y + 3, 14, 0, Math.PI * 2);
      ctx.fill();
      this.text(ok ? 'Afinado' : cents < 0 ? 'Sube un poco' : 'Baja un poco', W / 2, 470, 28, ok ? C.gold : C.dim, 600, 'center');
    } else {
      this.text(s.live ? 'Canta una nota' : 'Enciende el micrófono', W / 2, 330, 72, C.text, 800, 'center', 110);
      this.text('Elige una canción para cantar con banda y letra', W / 2, 400, 28, C.dim, 500, 'center');
    }
    // pitch trail across the bottom band
    this.drawTrail(now, 520, 610, 2.4);
  }

  private drawTrail(now: number, top: number, bottom: number, span: number, center?: number): void {
    const { ctx, W } = this;
    if (this.trail.length < 2) return;
    const mid = center ?? this.trail[this.trail.length - 1].m;
    const range = 7;
    ctx.save();
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.cyan;
    ctx.shadowColor = C.cyan;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      const x = W * 0.25 - ((now - p.t) / span) * W * 0.25;
      const y = bottom - ((p.m - (mid - range)) / (range * 2)) * (bottom - top);
      const gap = i > 0 && p.t - this.trail[i - 1].t > 0.12;
      if (!pen || gap) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      pen = true;
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawSong(s: ScreenState, now: number): void {
    const { W, ctx } = this;
    const song = s.song!;
    const beat = s.beat!;
    const spb = 60 / song.bpm;
    this.text(song.title, 40, 56, 30, C.text, 800, 'left', 110);
    this.text(song.artist, 40, 90, 22, C.dim, 500);
    this.text(`${Math.round(s.score)}`, W - 40, 62, 44, C.gold, 800, 'right');
    this.text('puntos', W - 40, 92, 20, C.dim, 500, 'right');

    // pitch lane: notes scroll left, the "now" line sits at 25% width
    const top = 130, bottom = 330;
    const all = song.lines.flatMap((l) => l.syllables);
    const lo = Math.min(...all.map((x) => x.midi)) - 2, hi = Math.max(...all.map((x) => x.midi)) + 2;
    const pxPerBeat = (W * 0.75) / 6;
    const nowX = W * 0.25;
    const yOf = (m: number) => bottom - ((m - lo) / (hi - lo)) * (bottom - top);
    ctx.fillStyle = C.faint;
    ctx.fillRect(nowX - 1, top - 16, 2, bottom - top + 32);
    let gi = 0;
    for (const l of song.lines) {
      for (const syl of l.syllables) {
        const x0 = nowX + (syl.beat - beat) * pxPerBeat;
        const x1 = x0 + syl.dur * pxPerBeat - 6;
        if (x1 > 0 && x0 < W) {
          const y = yOf(syl.midi);
          const hit = s.hits ? s.hits[gi] : 0;
          ctx.fillStyle = 'rgba(244,241,234,0.2)';
          this.round(x0, y - 9, Math.max(10, x1 - x0), 18, 9);
          if (hit > 0) {
            ctx.fillStyle = C.gold;
            ctx.globalAlpha = 0.35 + 0.65 * hit;
            const done = Math.min(1, Math.max(0, (beat - syl.beat) / syl.dur));
            this.round(x0, y - 9, Math.max(10, (x1 - x0) * done), 18, 9);
            ctx.globalAlpha = 1;
          }
        }
        gi++;
      }
    }
    // singer trail folded into the melody's octave so any voice range scores
    const cur = all.find((x) => beat >= x.beat && beat < x.beat + x.dur) ?? all.find((x) => x.beat > beat) ?? all[all.length - 1];
    if (this.trail.length > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top - 20, nowX + 2, bottom - top + 40);
      ctx.clip();
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = C.cyan;
      ctx.shadowColor = C.cyan;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < this.trail.length; i++) {
        const p = this.trail[i];
        let m = p.m;
        while (m - cur.midi > 6) m -= 12;
        while (cur.midi - m > 6) m += 12;
        const x = nowX - ((now - p.t) / spb) * pxPerBeat;
        const y = yOf(m);
        const gap = i > 0 && p.t - this.trail[i - 1].t > 0.12;
        if (!pen || gap) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        pen = true;
      }
      ctx.stroke();
      ctx.restore();
    }

    // lyrics
    const li = song.lines.findIndex((l) => beat < l.end + 0.2);
    if (s.finished || li < 0) {
      this.text('¡Bravo!', W / 2, 500, 110, C.gold, 800, 'center', 115);
      this.text(`${Math.round(s.score)} puntos`, W / 2, 570, 40, C.text, 700, 'center');
      return;
    }
    const line = song.lines[li];
    const next = song.lines[li + 1];
    // count-in dots when a line starts after a pause
    const prevEnd = li > 0 ? song.lines[li - 1].end : 0;
    if (line.start - prevEnd >= 1.5 && beat < line.start) {
      const left = Math.ceil(line.start - beat);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < left ? C.gold : C.faint;
        ctx.beginPath();
        ctx.arc(W / 2 - 40 + i * 40, 410, 10, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.lyricLine(line.syllables, beat, 490, 62, true);
    if (next) this.lyricLine(next.syllables, -1, 572, 40, false);
  }

  private lyricLine(syl: Syllable[], beat: number, y: number, size: number, active: boolean): void {
    const ctx = this.ctx;
    ctx.font = `800 ${size}px ${this.font}`;
    const parts: { s: Syllable; w: number; gap: number }[] = [];
    let total = 0;
    const space = ctx.measureText(' ').width;
    for (let i = 0; i < syl.length; i++) {
      const s = syl[i];
      if (s.hold) continue;
      const w = ctx.measureText(s.text).width;
      const gap = s.joined || i === syl.length - 1 ? 0 : space;
      parts.push({ s, w, gap });
      total += w + gap;
    }
    const maxW = this.W - 120;
    const scale = total > maxW ? maxW / total : 1;
    ctx.save();
    let x = (this.W - total * scale) / 2;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    x = 0;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < parts.length; i++) {
      const { s, w, gap } = parts[i];
      // a syllable stays lit through its melisma (following held notes)
      let end = s.beat + s.dur;
      const idx = syl.indexOf(s);
      for (let k = idx + 1; k < syl.length && syl[k].hold; k++) end = syl[k].beat + syl[k].dur;
      const f = active ? Math.max(0, Math.min(1, (beat - s.beat) / (end - s.beat))) : 0;
      ctx.fillStyle = active ? C.text : C.dim;
      ctx.fillText(s.text, x, 0);
      if (f > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, -size, w * f, size * 1.4);
        ctx.clip();
        ctx.fillStyle = C.gold;
        ctx.shadowColor = 'rgba(255,200,97,0.6)';
        ctx.shadowBlur = 16;
        ctx.fillText(s.text, x, 0);
        ctx.restore();
      }
      x += w + gap;
    }
    ctx.restore();
  }

  private round(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }
}
