import type { Zone } from '../audio/engine';
import type { PieceId } from '../scene/kit';

/** Hardware keyboard layout (iPad Magic Keyboard, laptops). Hints only appear on hover-capable screens. */
export const KEYMAP: Record<string, { piece: PieceId; zone: Zone; label: string }> = {
  Space: { piece: 'kick', zone: 'hit', label: 'Espacio' },
  KeyB: { piece: 'kick', zone: 'hit', label: 'B' },
  KeyF: { piece: 'snare', zone: 'center', label: 'F' },
  KeyJ: { piece: 'snare', zone: 'center', label: 'J' },
  KeyV: { piece: 'snare', zone: 'rim', label: 'V' },
  KeyD: { piece: 'hihat', zone: 'closed', label: 'D' },
  KeyE: { piece: 'hihat', zone: 'open', label: 'E' },
  KeyS: { piece: 'hhpedal', zone: 'pedal', label: 'S' },
  KeyG: { piece: 'tom1', zone: 'center', label: 'G' },
  KeyH: { piece: 'tom2', zone: 'center', label: 'H' },
  KeyK: { piece: 'floor', zone: 'center', label: 'K' },
  KeyR: { piece: 'crash', zone: 'hit', label: 'R' },
  KeyU: { piece: 'crash2', zone: 'hit', label: 'U' },
  KeyI: { piece: 'ride', zone: 'bow', label: 'I' },
  KeyO: { piece: 'ride', zone: 'bell', label: 'O' },
};

export function bindKeyboard(onKey: (piece: PieceId, zone: Zone, time: number) => void): void {
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    onKey(k.piece, k.zone, e.timeStamp || performance.now());
  });
}
