import type { PieceId } from '../scene/kit';
import { pattern, type Lesson, type Note, type Row, type Section } from './lessons';

/** One section of an arrangement: a one-bar row repeated, with optional first/last bar variants. */
interface Part {
  name: string;
  bars: number;
  row: Row;
  first?: Row;
  last?: Row;
}

export interface SongStep {
  name: string;
  blurb: string;
  /** Fraction of the song's real tempo. */
  tempo: number;
  /** Start with "wait for me" on. */
  wait: boolean;
  lesson: Lesson;
}

export interface Song {
  id: string;
  name: string;
  artist: string;
  bpm: number;
  level: 1 | 2 | 3;
  blurb: string;
  steps: SongStep[];
}

/** Builds a playable lesson from an arrangement (plays once, with named sections). */
function arrange(id: string, name: string, bpm: number, parts: Part[], only?: PieceId[]): Lesson {
  const notes: Note[] = [];
  const sections: Section[] = [];
  let bar = 0;
  for (const part of parts) {
    sections.push({ at: bar * 16, name: part.name });
    for (let b = 0; b < part.bars; b++) {
      const row = b === 0 && part.first ? part.first : b === part.bars - 1 && part.last ? part.last : part.row;
      for (const n of pattern(row).notes) {
        if (only && !only.includes(n.piece)) continue;
        notes.push({ ...n, step: n.step + bar * 16 });
      }
      bar++;
    }
  }
  notes.sort((a, b) => a.step - b.step);
  return { id, name, blurb: '', bpm, level: 1, length: bar * 16, notes, passes: 1, sections };
}

/** Three-step ladder: essentials slow → more of the kit → the whole song at full speed. */
function ladder(
  id: string,
  name: string,
  bpm: number,
  parts: Part[],
  steps: { name: string; blurb: string; tempo: number; wait: boolean; only?: PieceId[]; parts?: Part[] }[],
): SongStep[] {
  return steps.map((s, i) => ({
    name: s.name,
    blurb: s.blurb,
    tempo: s.tempo,
    wait: s.wait,
    lesson: arrange(`${id}-${i + 1}`, name, bpm, s.parts ?? parts, s.only),
  }));
}

const HH8 = 'x.x.x.x.x.x.x.x.';
const BACKBEAT = '....x.......x...';
const FOUR = 'x...x...x...x...';
const CRASH1 = 'x...............';

export const SONGS: Song[] = (() => {
  const list: Song[] = [];

  // We Will Rock You — the stomp-stomp-clap
  {
    const groove: Row = { kick: 'x.x.....x.x.....', snare: BACKBEAT };
    const parts: Part[] = [
      { name: 'Pisotón, pisotón, palmada', bars: 8, row: groove },
      { name: 'Final', bars: 1, row: { kick: CRASH1, crash: CRASH1 } },
    ];
    list.push({
      id: 'wwry',
      name: 'We Will Rock You',
      artist: 'Queen',
      bpm: 81,
      level: 1,
      blurb: 'Bum, bum, ¡pa! El ritmo que todo el estadio sabe tocar.',
      steps: ladder('wwry', 'We Will Rock You', 81, parts, [
        { name: 'Los pisotones', blurb: 'Solo el bombo: dos golpes seguidos, una y otra vez.', tempo: 0.85, wait: true, only: ['kick'] },
        { name: 'Pisotón y palmada', blurb: 'Añade el redoblante después de cada par de bombos.', tempo: 0.9, wait: false, only: ['kick', 'snare'] },
        { name: 'Canción completa', blurb: 'A velocidad real y con el crash del final.', tempo: 1, wait: false },
      ]),
    });
  }

  // Billie Jean — the most famous drum machine-tight groove
  {
    const groove: Row = { hihat: HH8, snare: BACKBEAT, kick: 'x.......x.......' };
    const parts: Part[] = [
      { name: 'Intro: batería sola', bars: 2, row: groove },
      { name: 'Verso', bars: 8, row: groove },
      { name: 'Estribillo', bars: 4, row: groove, first: { ...groove, crash: CRASH1 } },
    ];
    list.push({
      id: 'billie',
      name: 'Billie Jean',
      artist: 'Michael Jackson',
      bpm: 117,
      level: 1,
      blurb: 'Bombo, hi-hat y redoblante en su forma más pura. Constante como un reloj.',
      steps: ladder('billie', 'Billie Jean', 117, parts, [
        { name: 'Bombo y redoblante', blurb: 'El esqueleto: bombo en 1 y 3, redoblante en 2 y 4.', tempo: 0.75, wait: true, only: ['kick', 'snare'] },
        { name: 'Con hi-hat', blurb: 'Suma el hi-hat en corcheas, sin prisa.', tempo: 0.88, wait: false, only: ['kick', 'snare', 'hihat'] },
        { name: 'Canción completa', blurb: 'A 117 ppm, con el crash al entrar el estribillo.', tempo: 1, wait: false },
      ]),
    });
  }

  // Back in Black — hi-hat count-in, then the riff groove
  {
    const groove: Row = { hihat: HH8, snare: BACKBEAT, kick: 'x.......x.x.....' };
    const withCrash: Row = { ...groove, crash: CRASH1, hihat: '..x.x.x.x.x.x.x.' };
    const fill: Row = { hihat: 'x.x.x.x.........', snare: '....x...x.x.xxxx', kick: 'x.......x.......' };
    const parts: Part[] = [
      { name: 'Cuenta en el hi-hat', bars: 1, row: { hihat: HH8 } },
      { name: 'Riff', bars: 8, row: groove, first: withCrash },
      { name: 'Estribillo', bars: 4, row: groove, first: withCrash, last: fill },
      { name: 'Final', bars: 1, row: { crash: CRASH1, kick: CRASH1 } },
    ];
    list.push({
      id: 'backinblack',
      name: 'Back in Black',
      artist: 'AC/DC',
      bpm: 94,
      level: 2,
      blurb: 'Empieza contando en el hi-hat y entra con todo. Rock sin adornos.',
      steps: ladder('backinblack', 'Back in Black', 94, parts, [
        { name: 'Bombo y redoblante', blurb: 'Fíjate en el bombo doble del tercer tiempo.', tempo: 0.75, wait: true, only: ['kick', 'snare'] },
        { name: 'Con hi-hat', blurb: 'Añade el hi-hat y la cuenta del principio.', tempo: 0.88, wait: false, only: ['kick', 'snare', 'hihat'] },
        { name: 'Canción completa', blurb: 'Crashes, redoble al final del estribillo y velocidad real.', tempo: 1, wait: false },
      ]),
    });
  }

  // Seven Nation Army — kick + floor tom pulse, build, cymbal-bashing chorus
  {
    const verse: Row = { kick: FOUR, floor: FOUR };
    const build: Row = { kick: FOUR, snare: HH8 };
    const buildEnd: Row = { kick: FOUR, snare: 'x.x.x.x.xxxxxxxx' };
    const chorus: Row = { crash: FOUR, kick: FOUR, snare: BACKBEAT };
    const parts: Part[] = [
      { name: 'Verso', bars: 8, row: verse },
      { name: 'Subida', bars: 2, row: build, last: buildEnd },
      { name: 'Estribillo', bars: 4, row: chorus },
    ];
    list.push({
      id: 'sevennation',
      name: 'Seven Nation Army',
      artist: 'The White Stripes',
      bpm: 124,
      level: 1,
      blurb: 'Un pulso de bombo y tom de piso que crece hasta explotar en los platillos.',
      steps: ladder('sevennation', 'Seven Nation Army', 124, parts, [
        { name: 'El pulso', blurb: 'Bombo y tom de piso juntos en cada tiempo.', tempo: 0.75, wait: true, only: ['kick', 'floor'] },
        { name: 'La subida', blurb: 'Añade el redoblante que acelera antes del estribillo.', tempo: 0.88, wait: false, only: ['kick', 'floor', 'snare'] },
        { name: 'Canción completa', blurb: 'El estribillo golpeando el crash en cada tiempo.', tempo: 1, wait: false },
      ]),
    });
  }

  // Another One Bites the Dust — four on the floor with the open hat pickup
  {
    const groove: Row = { kick: FOUR, snare: BACKBEAT, hihat: 'x.x.x.x.x.x.x.o.' };
    const parts: Part[] = [
      { name: 'Intro', bars: 2, row: { kick: FOUR, hihat: 'x.x.x.x.x.x.x.o.' } },
      { name: 'Groove', bars: 8, row: groove, first: { ...groove, crash: CRASH1 } },
      { name: 'Final', bars: 1, row: { crash: CRASH1, kick: CRASH1 } },
    ];
    list.push({
      id: 'anotherone',
      name: 'Another One Bites the Dust',
      artist: 'Queen',
      bpm: 110,
      level: 1,
      blurb: 'Bombo en cada tiempo y el hi-hat que se abre justo antes del uno.',
      steps: ladder('anotherone', 'Another One Bites the Dust', 110, parts, [
        { name: 'Bombo en cada tiempo', blurb: 'Cuatro golpes de bombo por compás, parejos.', tempo: 0.8, wait: true, only: ['kick'] },
        { name: 'Bombo y redoblante', blurb: 'Redoblante en 2 y 4 encima del bombo.', tempo: 0.9, wait: false, only: ['kick', 'snare'] },
        { name: 'Canción completa', blurb: 'Hi-hat con su apertura al final de cada compás.', tempo: 1, wait: false },
      ]),
    });
  }

  // Stayin' Alive — disco
  {
    const groove: Row = { kick: FOUR, snare: BACKBEAT, hihat: 'x.o.x.o.x.o.x.o.' };
    const fill: Row = { kick: FOUR, snare: '....x...xxxx.x.x' };
    const parts: Part[] = [
      { name: 'Groove', bars: 8, row: groove, first: { ...groove, crash: CRASH1, hihat: '..o.x.o.x.o.x.o.' } },
      { name: 'Relleno', bars: 1, row: fill },
      { name: 'Estribillo', bars: 4, row: groove, first: { ...groove, crash: CRASH1, hihat: '..o.x.o.x.o.x.o.' } },
    ];
    list.push({
      id: 'stayinalive',
      name: "Stayin' Alive",
      artist: 'Bee Gees',
      bpm: 103,
      level: 2,
      blurb: 'Disco puro: bombo en cada tiempo y el hi-hat abriéndose entre medio.',
      steps: ladder('stayinalive', "Stayin' Alive", 103, parts, [
        { name: 'Bombo y redoblante', blurb: 'Cuatro bombos por compás y redoblante en 2 y 4.', tempo: 0.8, wait: true, only: ['kick', 'snare'] },
        { name: 'Hi-hat que se abre', blurb: 'Toca el borde del hi-hat en los contratiempos para abrirlo.', tempo: 0.9, wait: false, only: ['kick', 'snare', 'hihat'] },
        { name: 'Canción completa', blurb: 'Con relleno y crashes, a velocidad real.', tempo: 1, wait: false },
      ]),
    });
  }

  // Smells Like Teen Spirit — intro fill, loud chorus, quiet verse
  {
    const introFill: Row = { snare: '........xxxx....', tom1: '............xx..', floor: '..............xx' };
    const chorus: Row = { crash: HH8, snare: BACKBEAT, kick: 'x.....x.x.......' };
    const verse: Row = { hihat: HH8, snare: BACKBEAT, kick: 'x.......x.x.....' };
    const toChorus: Row = { hihat: 'x.x.x.x.........', snare: '....x...xxxxxxxx', kick: 'x.......x.......' };
    const parts: Part[] = [
      { name: 'Redoble de entrada', bars: 1, row: introFill },
      { name: 'Estribillo', bars: 4, row: chorus },
      { name: 'Verso', bars: 4, row: verse, last: toChorus },
      { name: 'Estribillo', bars: 4, row: chorus },
    ];
    list.push({
      id: 'teenspirit',
      name: 'Smells Like Teen Spirit',
      artist: 'Nirvana',
      bpm: 117,
      level: 3,
      blurb: 'Redoble explosivo, estribillo en los platillos y verso tranquilo en el hi-hat.',
      steps: ladder('teenspirit', 'Smells Like Teen Spirit', 117, parts, [
        { name: 'Bombo y redoblante', blurb: 'El patrón de bombo cambia entre estribillo y verso.', tempo: 0.72, wait: true, only: ['kick', 'snare'] },
        { name: 'Con platillos', blurb: 'Crash en el estribillo, hi-hat en el verso.', tempo: 0.86, wait: false, only: ['kick', 'snare', 'hihat', 'crash'] },
        { name: 'Canción completa', blurb: 'Con los redobles de entrada y de paso.', tempo: 1, wait: false },
      ]),
    });
  }

  // In the Air Tonight — the most famous fill in history
  {
    const fill: Row = { tom1: 'xx..xx..........', tom2: '..xx..xx........', floor: '........x...x...', kick: '........x...x...' };
    const groove: Row = { kick: 'x.......x.......', snare: BACKBEAT, hihat: HH8 };
    const parts: Part[] = [
      { name: 'La espera', bars: 2, row: { hhpedal: FOUR } },
      { name: 'El redoble', bars: 1, row: fill },
      { name: 'Groove', bars: 4, row: groove, first: { ...groove, crash: CRASH1, hihat: '..x.x.x.x.x.x.x.' } },
      { name: 'Final', bars: 1, row: { crash: CRASH1, kick: CRASH1 } },
    ];
    list.push({
      id: 'airtonight',
      name: 'In the Air Tonight',
      artist: 'Phil Collins',
      bpm: 96,
      level: 2,
      blurb: 'La espera, el redoble de toms más famoso de la historia y el golpe que lo cambia todo.',
      steps: ladder('airtonight', 'In the Air Tonight', 96, parts, [
        {
          name: 'El redoble, lento',
          blurb: 'Solo el redoble: parejas en los toms bajando hacia el tom de piso.',
          tempo: 0.7,
          wait: true,
          parts: [{ name: 'El redoble', bars: 4, row: fill }],
        },
        { name: 'Redoble y ritmo', blurb: 'Del redoble directo al groove.', tempo: 0.85, wait: false, parts: parts.slice(1) },
        { name: 'Canción completa', blurb: 'Con la espera del pedal y el crash que lo abre todo.', tempo: 1, wait: false },
      ]),
    });
  }
  return list;
})();

// ─────────────────────────── progress (stars per step)

const KEY = 'baqueta:progress:v1';

export function loadProgress(): Record<string, number[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveStars(songId: string, step: number, stars: number): Record<string, number[]> {
  const p = loadProgress();
  const arr = p[songId] ?? [0, 0, 0];
  arr[step] = Math.max(arr[step] ?? 0, stars);
  p[songId] = arr;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked */
  }
  return p;
}

/** Stars earned on a step; a step never played has earned none (drawn as empty stars). */
export function earnedStars(progress: Record<string, number[]>, songId: string, step: number): number {
  const got = progress[songId]?.[step];
  return typeof got === 'number' && got > 0 ? Math.min(3, got) : 0;
}

export function starsFor(accuracy: number, missRatio: number): number {
  if (accuracy >= 0.93 && missRatio < 0.04) return 3;
  if (accuracy >= 0.8) return 2;
  if (accuracy >= 0.6) return 1;
  return 0;
}
