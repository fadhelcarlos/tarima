import * as THREE from 'three';
import type { Zone } from '../audio/engine';
import type { Kit, Piece, PieceId } from '../scene/kit';

export interface Hit {
  piece: PieceId;
  zone: Zone;
  velocity: number;
  /** Hit point in the piece's surface frame. */
  local: THREE.Vector3;
  world: THREE.Vector3;
  /** Event timestamp (performance.now() clock). */
  time: number;
  pointerId: number;
}

/** Where on a piece the stick landed decides the articulation, like on a real kit. */
export function zoneFor(piece: Piece, local: THREE.Vector3): Zone {
  const rn = Math.hypot(local.x, local.z) / piece.radius;
  switch (piece.id) {
    case 'kick':
      return 'hit';
    case 'hhpedal':
      return 'pedal';
    case 'snare':
      return rn > 1.0 ? 'rim' : rn > 0.7 ? 'edge' : 'center';
    case 'tom1':
    case 'tom2':
    case 'floor':
      return rn > 1.0 ? 'rim' : 'center';
    case 'hihat':
      return rn > 0.8 ? 'open' : 'closed';
    case 'ride':
      return rn < (piece.cymbal!.bellRadius / piece.radius) * 1.15 ? 'bell' : 'bow';
    default:
      return 'hit';
  }
}

/**
 * Multi-touch drum input. Every finger is independent and fires on touch-down (no tap delay).
 * A tap that misses slightly still plays the closest piece, so fingers never "fall through".
 */
export class TouchInput {
  enabled = true;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly held = new Map<number, { piece: PieceId; timer: number }>();
  private readonly lastHit = new Map<PieceId, number>();
  private targets: THREE.Object3D[];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly kit: Kit,
    private readonly onHit: (h: Hit) => void,
    private readonly onGrab: (piece: PieceId) => void,
    private readonly onAnyTouch: () => void,
  ) {
    this.targets = kit.hitTargets();
    canvas.addEventListener('pointerdown', this.down, { passive: false });
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.up);
    // stop iOS double-tap zoom, magnifier and text selection while drumming
    const block = (e: Event) => e.preventDefault();
    canvas.addEventListener('touchstart', block, { passive: false });
    canvas.addEventListener('touchmove', block, { passive: false });
    canvas.addEventListener('touchend', block, { passive: false });
    document.addEventListener('gesturestart', block as EventListener, { passive: false } as AddEventListenerOptions);
    canvas.addEventListener('contextmenu', block);
  }

  /** Raycast (plus nearest-piece forgiveness) at a client position. */
  pick(clientX: number, clientY: number): { piece: Piece; world: THREE.Vector3; local: THREE.Vector3 } | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hits = this.ray.intersectObjects(this.targets, false);
    let piece: Piece | undefined;
    let world: THREE.Vector3 | undefined;
    if (hits.length) {
      piece = this.kit.pieces.get(hits[0].object.userData.piece as PieceId);
      world = hits[0].point.clone();
    } else {
      // forgiveness: nearest projected rim within 30% of its on-screen radius
      let best = 1.3;
      const c = new THREE.Vector3(), e = new THREE.Vector3();
      const px = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      for (const p of this.kit.pieces.values()) {
        if (p.kind === 'pedal') continue;
        p.surface.localToWorld(c.set(0, 0, 0)).project(this.camera);
        p.surface.localToWorld(e.set(p.rim, 0, 0)).project(this.camera);
        const rs = Math.hypot((e.x - c.x) * rect.width, (e.y - c.y) * rect.height);
        const d = Math.hypot((px.x - c.x) * rect.width, (px.y - c.y) * rect.height) / Math.max(1, rs);
        if (d < best) {
          best = d;
          piece = p;
        }
      }
      if (piece) {
        // land on the rim edge closest to the finger
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          new THREE.Vector3(0, 1, 0).applyQuaternion(piece.surface.getWorldQuaternion(new THREE.Quaternion())),
          piece.surface.getWorldPosition(new THREE.Vector3()),
        );
        world = this.ray.ray.intersectPlane(plane, new THREE.Vector3()) ?? piece.surface.getWorldPosition(new THREE.Vector3());
        const loc = piece.surface.worldToLocal(world.clone());
        const len = Math.hypot(loc.x, loc.z);
        if (len > piece.radius * 0.98) {
          loc.x *= (piece.radius * 0.98) / len;
          loc.z *= (piece.radius * 0.98) / len;
        }
        loc.y = 0;
        world = piece.surface.localToWorld(loc.clone());
      }
    }
    if (!piece || !world) return null;
    const local = piece.surface.worldToLocal(world.clone());
    return { piece, world, local };
  }

  private down = (e: PointerEvent): void => {
    e.preventDefault();
    this.onAnyTouch();
    if (!this.enabled) return;
    const res = this.pick(e.clientX, e.clientY);
    if (!res) return;
    const { piece, world, local } = res;
    const zone = zoneFor(piece, local);
    const now = e.timeStamp || performance.now();
    // velocity: pencil pressure when available, otherwise the spot on the head plus a human wobble
    let v: number;
    if (e.pointerType === 'pen' && e.pressure > 0) {
      v = 0.3 + 0.7 * Math.min(1, e.pressure * 1.25);
    } else {
      const rn = Math.hypot(local.x, local.z) / piece.radius;
      v = 0.9 - (piece.kind === 'drum' ? Math.max(0, rn - 0.6) * 0.25 : 0) + (Math.random() - 0.5) * 0.1;
    }
    // quick repeats on the same piece (rolls, flams) come out a bit softer, like real wrists
    const prev = this.lastHit.get(piece.id);
    if (prev !== undefined && now - prev < 110) v *= 0.84;
    this.lastHit.set(piece.id, now);
    this.onHit({ piece: piece.id, zone, velocity: Math.min(1, Math.max(0.1, v)), local, world, time: now, pointerId: e.pointerId });
    if (piece.kind === 'cymbal') {
      // keep a finger on a cymbal and you grab it: the ring stops
      const timer = window.setTimeout(() => {
        if (this.held.has(e.pointerId)) this.onGrab(piece.id);
      }, 420);
      this.held.set(e.pointerId, { piece: piece.id, timer });
    }
  };

  private up = (e: PointerEvent): void => {
    const h = this.held.get(e.pointerId);
    if (h) {
      clearTimeout(h.timer);
      this.held.delete(e.pointerId);
    }
  };
}
