import type { Coach } from '../learn/coach';
import type { PieceId } from '../scene/kit';

const ROWS: { id: PieceId; name: string }[] = [
  { id: 'crash', name: 'Crash' },
  { id: 'crash2', name: 'Crash 2' },
  { id: 'ride', name: 'Ride' },
  { id: 'hihat', name: 'Hi-hat' },
  { id: 'tom1', name: 'Tom 1' },
  { id: 'tom2', name: 'Tom 2' },
  { id: 'floor', name: 'Tom piso' },
  { id: 'snare', name: 'Redoblante' },
  { id: 'kick', name: 'Bombo' },
  { id: 'hhpedal', name: 'Pedal' },
];

const C = {
  text: '#f3ede4',
  muted: '#a99e91',
  line: 'rgba(243,237,228,0.10)',
  beat: 'rgba(243,237,228,0.22)',
  bar: 'rgba(243,237,228,0.45)',
  accent: '#e8b45a',
  good: '#f3ede4',
  off: '#8f8579',
  miss: '#5a514b',
  head: 'rgba(232,180,90,0.9)',
};

/**
 * Scrolling drum tab: the next two bars glide toward a fixed reading line, one row per drum,
 * with the "1 y 2 y 3 y 4 y" count on top and section names at their first bar.
 */
export class TabStrip {
  private readonly ctx: CanvasRenderingContext2D;
  private rows: { id: PieceId; name: string }[] = [];
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly coach: Coach) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Call when a lesson starts: picks the rows that lesson uses. */
  setup(): void {
    const used = new Set(this.coach.notes.map((n) => n.piece));
    this.rows = ROWS.filter((r) => used.has(r.id));
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const compact = window.innerHeight < 500;
    const rowH = compact ? 11 : 15;
    const header = compact ? 14 : 18;
    const h = header + Math.max(1, this.rows.length) * rowH + 6;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(10, rect.width);
    this.h = h;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  draw(): void {
    const coach = this.coach;
    const lesson = coach.lesson;
    if (!lesson || !this.rows.length) return;
    const ctx = this.ctx;
    const { w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const compact = window.innerHeight < 500;
    const rowH = compact ? 11 : 15;
    const header = compact ? 14 : 18;
    const labelW = compact ? 58 : 76;
    const sd = coach.stepDur();
    const bar = sd * 16;
    const pos = coach.songPos;
    const x0 = labelW + 8;
    const span = w - x0 - 4;
    const head = x0 + span * 0.18;
    const pxPerSec = (span * 0.82) / (bar * 1.65);
    const xAt = (t: number) => head + (t - pos) * pxPerSec;
    const tMin = pos - (head - x0) / pxPerSec;
    const tMax = pos + (w - head) / pxPerSec;

    // row labels + guides
    ctx.font = `600 ${compact ? 9.5 : 11}px "Instrument Sans", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    this.rows.forEach((r, i) => {
      const y = header + i * rowH + rowH / 2;
      ctx.fillStyle = C.muted;
      ctx.textAlign = 'right';
      ctx.fillText(r.name, labelW, y);
      ctx.fillStyle = C.line;
      ctx.fillRect(x0, y - 0.5, span, 1);
    });

    // grid + count ("1 y 2 y …") on 8th notes
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, span + 4, h);
    ctx.clip();
    const cin = coach.countInTime;
    const firstStep = Math.floor((tMin - cin) / sd) - 1;
    const lastStep = Math.ceil((tMax - cin) / sd) + 1;
    ctx.textAlign = 'center';
    for (let st = firstStep; st <= lastStep; st++) {
      if (st % 2 !== 0) continue;
      const t = cin + st * sd;
      const x = xAt(t);
      const inBar = ((st % 16) + 16) % 16;
      const isBar = inBar === 0;
      const isBeat = inBar % 4 === 0;
      ctx.fillStyle = isBar ? C.bar : isBeat ? C.beat : C.line;
      ctx.fillRect(x - 0.5, header - 2, 1, h - header - 2);
      if (st >= 0) {
        const label = isBeat ? String(inBar / 4 + 1) : 'y';
        const near = Math.abs(t - pos) < sd;
        ctx.fillStyle = near ? C.accent : isBeat ? C.text : C.muted;
        ctx.font = `${isBeat ? 700 : 500} ${compact ? 9.5 : 11}px "Instrument Sans", system-ui, sans-serif`;
        ctx.fillText(label, x, header / 2);
      }
    }
    // section boundaries get an accent line (names live in the lesson bar)
    if (lesson.sections) {
      ctx.fillStyle = C.accent;
      for (const s of lesson.sections) {
        const x = xAt(cin + s.at * sd);
        if (x >= x0 - 2 && x <= w) ctx.fillRect(x - 1, header - 2, 2, h - header - 2);
      }
    }

    // notes
    const rIdx = new Map(this.rows.map((r, i) => [r.id, i]));
    for (const n of coach.notes) {
      if (n.time < tMin - 0.2 || n.time > tMax + 0.2) continue;
      const i = rIdx.get(n.piece);
      if (i === undefined) continue;
      const x = xAt(n.time);
      const y = header + i * rowH + rowH / 2;
      let r = rowH * (n.velocity < 0.5 ? 0.24 : n.velocity >= 1 ? 0.4 : 0.34);
      let fill = C.text;
      let alpha = 1;
      if (n.state === 'done') {
        fill = n.grade === 'perfect' || n.grade === 'hit' ? C.accent : n.grade === 'good' ? C.good : n.grade === 'miss' ? C.miss : C.off;
        alpha = n.grade === 'miss' ? 0.8 : 1;
      } else if (Math.abs(n.time - pos) < sd * 0.6) {
        r *= 1.25;
      } else if (n.time < pos) {
        alpha = 0.55;
      }
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (n.zone === 'open') {
        ctx.strokeStyle = fill;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // reading line
    ctx.fillStyle = C.head;
    ctx.fillRect(head - 1, header - 3, 2, h - header);
  }
}
