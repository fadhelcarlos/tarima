/**
 * Karaoke songs in the public domain: lyrics split into syllables, each with its melody note
 * and timing in beats, plus chords and the backing groove. Beat 0 is the start of the count-in.
 */

export interface Syllable {
  text: string;
  /** Joins the next syllable into the same word (no space). */
  joined: boolean;
  /** Melisma: the previous syllable keeps singing on this note (no new text). */
  hold: boolean;
  beat: number;
  dur: number;
  midi: number;
}

export interface Line {
  syllables: Syllable[];
  start: number;
  end: number;
}

export type Groove = 'vals' | 'balada' | 'pop';

export interface KSong {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  beatsPerBar: number;
  key: number; // pitch class of the tonic
  scale: 'mayor' | 'menor';
  groove: Groove;
  lines: Line[];
  chords: { beat: number; chord: string }[];
  length: number; // beats
  blurb: string;
}

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function midi(n: string): number {
  const m = /^([A-G])([#b]?)(\d)$/.exec(n);
  if (!m) throw new Error(`nota inválida ${n}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/**
 * Builds lines from a compact score: each line is [lyrics, notes, durations]. Lyrics use "-" at
 * the end of a syllable that continues the word ("Cum- ple- a- ños"). Returns lines and the
 * beat where the song ends.
 */
function score(start: number, rows: [string, string, number[]][]): { lines: Line[]; end: number } {
  let beat = start;
  const lines: Line[] = [];
  for (const [text, notes, durs] of rows) {
    const syl = text.trim().split(/\s+/);
    const ns = notes.trim().split(/\s+/);
    if (syl.length !== ns.length || ns.length !== durs.length) throw new Error(`línea desigual: ${text}`);
    const syllables: Syllable[] = syl.map((s, i) => {
      const hold = s === '~';
      const joined = s.endsWith('-');
      const text = hold ? '' : (joined ? s.slice(0, -1) : s).replace(/_/g, ' ');
      const out = { text, joined, hold, beat, dur: durs[i], midi: midi(ns[i]) };
      beat += durs[i];
      return out;
    });
    lines.push({ syllables, start: syllables[0].beat, end: beat });
  }
  return { lines, end: beat };
}

function chords(beatsPerBar: number, firstBarBeat: number, bars: string): { beat: number; chord: string }[] {
  const out: { beat: number; chord: string }[] = [];
  bars.trim().split('|').forEach((bar, i) => {
    const cs = bar.trim().split(/\s+/);
    cs.forEach((c, k) => out.push({ beat: firstBarBeat + i * beatsPerBar + (k * beatsPerBar) / cs.length, chord: c }));
  });
  return out;
}

export const KSONGS: KSong[] = (() => {
  const list: KSong[] = [];

  // Cumpleaños feliz (melodía de "Good Morning to All", dominio público). 3/4, pickup on beat 3.
  {
    const q = 0.75, s = 0.25;
    const { lines, end } = score(2, [
      ['Cum- ple- a- ños fe- liz,', 'G4 G4 A4 G4 C5 B4', [q, s, 1, 1, 1, 2]],
      ['te de- sea- mos a ti,', 'G4 G4 A4 G4 D5 C5', [q, s, 1, 1, 1, 2]],
      ['cum- ple- a- ños que- ri- do,', 'G4 G4 G5 E5 C5 B4 A4', [q, s, 1, 1, 1, 1, 1]],
      ['cum- ple- a- ños fe- liz.', 'F5 F5 E5 C5 D5 C5', [q, s, 1, 1, 1, 3]],
    ]);
    list.push({
      id: 'cumple',
      title: 'Cumpleaños feliz',
      artist: 'Tradicional',
      bpm: 100,
      beatsPerBar: 3,
      key: 0,
      scale: 'mayor',
      groove: 'vals',
      lines,
      chords: chords(3, 3, 'C | G7 | G7 | C | C | F | C G7 | C'),
      length: end + 3,
      blurb: 'La canción de todas las fiestas. Cambia «querido» por el nombre de quien cumple.',
    });
  }

  return list;
})();

/** Chord symbol → pitch classes (root first). */
export function chordNotes(sym: string): number[] {
  const m = /^([A-G])([#b]?)(m|maj7|m7|7|dim|sus4)?$/.exec(sym);
  if (!m) return [0, 4, 7];
  const root = (NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const q = m[3] ?? '';
  const iv = q === 'm' ? [0, 3, 7] : q === '7' ? [0, 4, 7, 10] : q === 'm7' ? [0, 3, 7, 10] : q === 'maj7' ? [0, 4, 7, 11] : q === 'dim' ? [0, 3, 6] : q === 'sus4' ? [0, 5, 7] : [0, 4, 7];
  return iv.map((i) => (root + i) % 12);
}
