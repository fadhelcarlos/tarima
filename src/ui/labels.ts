import * as THREE from 'three';
import type { Kit, PieceId } from '../scene/kit';

/**
 * Name tags that float next to each piece so a first-time player knows what they're hitting.
 * Each tag fades out after its piece has been played a couple of times, unless pinned on.
 */
export class PieceLabels {
  private readonly el: HTMLElement;
  private readonly tags = new Map<PieceId, { node: HTMLElement; anchor: THREE.Vector3; plays: number }>();
  private readonly v = new THREE.Vector3();
  mode: 'auto' | 'always' | 'never' = 'never';

  constructor(container: HTMLElement, kit: Kit) {
    this.el = container;
    for (const p of kit.pieces.values()) {
      const node = document.createElement('div');
      node.className = 'tag';
      node.textContent = p.id === 'hhpedal' ? 'Pedal hi-hat' : p.name;
      container.appendChild(node);
      // drums: on the rim nearest the player; cymbals: just in front of the edge; pedals: on them
      let anchor: THREE.Vector3;
      if (p.id === 'kick') anchor = new THREE.Vector3(0.03, 0.04, 0.2);
      else if (p.id === 'hhpedal') anchor = p.surface.localToWorld(new THREE.Vector3(0, 0.04, -0.14));
      else anchor = p.surface.localToWorld(new THREE.Vector3(0, 0, p.rim * (p.kind === 'cymbal' ? 0.55 : 0.62)));
      this.tags.set(p.id, { node, anchor, plays: 0 });
    }
  }

  played(id: PieceId): void {
    const t = this.tags.get(id === 'hhpedal' ? 'hhpedal' : id);
    if (!t) return;
    t.plays++;
    t.node.classList.add('lit');
    window.setTimeout(() => t.node.classList.remove('lit'), 140);
  }

  resetCounts(): void {
    for (const t of this.tags.values()) t.plays = 0;
  }

  update(camera: THREE.Camera, width: number, height: number, hideAll: boolean): void {
    for (const t of this.tags.values()) {
      const show = !hideAll && (this.mode === 'always' || (this.mode === 'auto' && t.plays < 3));
      t.node.classList.toggle('hidden', !show);
      if (!show) continue;
      this.v.copy(t.anchor).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * width;
      const y = (-this.v.y * 0.5 + 0.5) * height;
      t.node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
    this.el.hidden = hideAll;
  }
}
