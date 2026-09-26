import type { Zone } from '../audio/engine';
import type { PieceId } from '../scene/kit';

export interface Note {
  /** Position in the loop, in 16th notes. */
  step: number;
  piece: PieceId;
  zone: Zone;
  velocity: number;
}

export interface Section {
  /** First 16th note of the section. */
  at: number;
  name: string;
}

export interface Lesson {
  id: string;
  name: string;
  blurb: string;
  bpm: number;
  level: 1 | 2 | 3;
  /** Loop length in 16th notes. */
  length: number;
  notes: Note[];
  /** How many times the loop plays (grooves loop, songs play once). */
  passes?: number;
  sections?: Section[];
  /** Count-in length in 16th notes (default one bar). */
  countIn?: number;
  /** No metronome clicks. */
  silent?: boolean;
}

export type Row = Partial<Record<PieceId, string>>;

/**
 * One character per 16th note: x = normal, a = accent, g = ghost (soft), o = open hi-hat,
 * b = ride bell, r = rimshot, . = rest. Bars are separated by | for readability.
 */
export function pattern(rows: Row): { length: number; notes: Note[] } {
  const notes: Note[] = [];
  let length = 0;
  for (const [piece, raw] of Object.entries(rows) as [PieceId, string][]) {
    const s = raw.replace(/[|\s]/g, '');
    length = Math.max(length, s.length);
    [...s].forEach((ch, step) => {
      if (ch === '.') return;
      const base: Record<PieceId, Zone> = { kick: 'hit', snare: 'center', tom1: 'center', tom2: 'center', floor: 'center', hihat: 'closed', hhpedal: 'pedal', crash: 'hit', crash2: 'hit', ride: 'bow' };
      let zone = base[piece];
      let velocity = 0.85;
      if (ch === 'a') velocity = 1;
      if (ch === 'g') velocity = 0.35;
      if (ch === 'o') zone = 'open';
      if (ch === 'b') zone = 'bell';
      if (ch === 'r') zone = 'rim';
      notes.push({ step, piece, zone, velocity });
    });
  }
  notes.sort((a, b) => a.step - b.step);
  return { length, notes };
}

export const LESSONS: Lesson[] = [
  {
    id: 'pulso',
    name: 'Tu primer pulso',
    blurb: 'Solo el bombo, cuatro veces por compás. Es el corazón de todo ritmo.',
    bpm: 70,
    level: 1,
    ...pattern({ kick: 'x...x...x...x...' }),
  },
  {
    id: 'bombo-caja',
    name: 'Bombo y redoblante',
    blurb: 'Bombo en 1 y 3, redoblante en 2 y 4. Así suena casi toda la música.',
    bpm: 72,
    level: 1,
    ...pattern({ kick: 'x.......x.......', snare: '....x.......x...' }),
  },
  {
    id: 'rock',
    name: 'Rock básico',
    blurb: 'Añade el hi-hat en corcheas. Con esto ya puedes tocar cientos de canciones.',
    bpm: 76,
    level: 1,
    ...pattern({ hihat: 'x.x.x.x.x.x.x.x.', snare: '....x.......x...', kick: 'x.......x.......' }),
  },
  {
    id: 'rock-2',
    name: 'Rock con más bombo',
    blurb: 'Un bombo extra antes del último redoblante le da empuje al ritmo.',
    bpm: 82,
    level: 2,
    ...pattern({ hihat: 'x.x.x.x.x.x.x.x.', snare: '....x.......x...', kick: 'x.......x.x.....' }),
  },
  {
    id: 'ride',
    name: 'Ride y campana',
    blurb: 'Lleva el ritmo en el ride y marca la campana al final del compás.',
    bpm: 84,
    level: 2,
    ...pattern({ ride: 'x.x.x.x.x.x.b.x.', snare: '....x.......x...', kick: 'x.......x.......' }),
  },
  {
    id: 'disco',
    name: 'Disco',
    blurb: 'Bombo en cada tiempo y el hi-hat se abre entre medio. Para bailar.',
    bpm: 100,
    level: 2,
    ...pattern({ kick: 'x...x...x...x...', hihat: 'x.o.x.o.x.o.x.o.', snare: '....x.......x...' }),
  },
  {
    id: 'redoble',
    name: 'Tu primer redoble',
    blurb: 'Un compás de rock y un redoble por los toms que termina en el crash.',
    bpm: 74,
    level: 2,
    ...pattern({
      crash: 'x...............|................',
      hihat: '..x.x.x.x.x.x.x.|x.x.x.x.........',
      snare: '....x.......x...|....x...xxxx....',
      tom1: '................|............xx..',
      tom2: '................|..............x.',
      floor: '................|...............x',
      kick: 'x.......x.......|x.......x.......',
    }),
  },
  {
    id: 'funk',
    name: 'Funk',
    blurb: 'Hi-hat en semicorcheas, bombo a contratiempo y notas fantasma suaves.',
    bpm: 88,
    level: 3,
    ...pattern({ hihat: 'xxxxxxxxxxxxxxxx', snare: '....a..g.g..a..g', kick: 'x..x..x...x..x..' }),
  },
];

/** First-run tour: one piece lights up at a time and the kit waits for you. */
export const TOUR: Lesson = {
  id: 'tour',
  name: 'Bienvenida',
  blurb: '',
  bpm: 60,
  level: 1,
  passes: 1,
  countIn: 4,
  silent: true,
  ...(() => {
    const steps: [number, PieceId, Zone, string][] = [
      [6, 'snare', 'center', 'Toca el redoblante, el que se ilumina'],
      [14, 'kick', 'hit', 'Ahora el bombo: toca su pedal'],
      [22, 'hihat', 'closed', 'Este es el hi-hat'],
      [30, 'tom1', 'center', 'Un tom'],
      [38, 'floor', 'center', 'El tom de piso, grave y profundo'],
      [46, 'crash', 'hit', '¡Y el crash!'],
    ];
    return {
      length: 52,
      notes: steps.map(([step, piece, zone]) => ({ step, piece, zone, velocity: 0.9 })),
      sections: steps.map(([step, , , name], i) => ({ at: i === 0 ? 0 : step - 7, name })),
    };
  })(),
};
