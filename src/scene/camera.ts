import * as THREE from 'three';
import type { Kit } from './kit';

export type ViewId = 'play' | 'front' | 'side' | 'top';

export const VIEWS: { id: ViewId; name: string }[] = [
  { id: 'play', name: 'Tocar' },
  { id: 'top', name: 'Desde arriba' },
  { id: 'front', name: 'Público' },
  { id: 'side', name: 'Lateral' },
];

export interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

/** Screen margins (CSS px) the play view keeps free for the HUD. */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const PIVOT = new THREE.Vector3(0.12, 0.72, -0.15);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Camera presets with an auto-fitted playing view: whatever the screen shape, every drum and
 * cymbal lands inside the free area of the screen as large as possible.
 */
export class CameraRig {
  view: ViewId = 'play';
  private from: Pose | null = null;
  private to: Pose;
  private t0 = 0;
  private readonly duration = 950;
  private fitPoints: THREE.Vector3[] = [];
  insets: Insets = { top: 64, bottom: 12, left: 12, right: 12 };
  /** Small offsets added on top of the pose (kick thump, idle drift). */
  readonly shake = new THREE.Vector3();
  orbiting = false;
  private orbitAngle = 0;
  /** A pose outside the kit presets (e.g. the singer's view), recomputed on resize. */
  private custom: ((aspect: number) => Pose) | null = null;
  private linear = false;

  constructor(readonly camera: THREE.PerspectiveCamera, kit: Kit) {
    for (const p of kit.pieces.values()) {
      if (p.id === 'hhpedal') continue;
      const n = p.kind === 'pedal' ? 0 : 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.fitPoints.push(p.surface.localToWorld(new THREE.Vector3(Math.cos(a) * p.rim, 0, Math.sin(a) * p.rim)));
      }
    }
    // pedals must stay on screen: they are playable
    this.fitPoints.push(new THREE.Vector3(0.03, 0.05, 0.26), new THREE.Vector3(-0.42, 0.05, 0.3));
    this.to = this.pose('play');
    this.apply(this.to);
  }

  private aspect(): number {
    return this.camera.aspect;
  }

  /** Builds the pose for a view on the current screen shape. */
  pose(view: ViewId): Pose {
    const a = this.aspect();
    switch (view) {
      case 'front':
        return this.framed(new THREE.Vector3(-0.42, 0.34, -1).normalize(), 36, 0.2);
      case 'side':
        return this.framed(new THREE.Vector3(1, 0.32, 0.5).normalize(), 36, 0.18);
      case 'top': {
        return this.framed(new THREE.Vector3(0, 1, 0.12).normalize(), a < 1 ? 46 : 38, 0.02);
      }
      case 'play':
      default: {
        // landscape: behind the throne looking down; portrait: steeper so depth fills height
        const portrait = THREE.MathUtils.clamp((1.25 - a) / 0.75, 0, 1);
        const elev = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(50, 70, portrait));
        const dir = new THREE.Vector3(0.0, Math.sin(elev), Math.cos(elev));
        return this.framed(dir, THREE.MathUtils.lerp(38, 50, portrait), 0.015);
      }
    }
  }

  /** Solve distance + target so all fit points fill the free screen area along `dir`. */
  private framed(dir: THREE.Vector3, fov: number, margin: number): Pose {
    const cam = this.camera.clone();
    cam.fov = fov;
    cam.updateProjectionMatrix();
    const target = PIVOT.clone();
    let dist = 2.2;
    const w = window.innerWidth, h = window.innerHeight;
    const { top, bottom, left, right } = this.insets;
    // NDC box of the free area
    const nx0 = (left / w) * 2 - 1 + margin, nx1 = 1 - (right / w) * 2 - margin;
    const ny0 = -1 + (bottom / h) * 2 + margin, ny1 = 1 - (top / h) * 2 - margin;
    const tmp = new THREE.Vector3();
    for (let iter = 0; iter < 14; iter++) {
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const p of this.fitPoints) {
        tmp.copy(p).project(cam);
        minX = Math.min(minX, tmp.x); maxX = Math.max(maxX, tmp.x);
        minY = Math.min(minY, tmp.y); maxY = Math.max(maxY, tmp.y);
      }
      const scale = Math.max((maxX - minX) / (nx1 - nx0), (maxY - minY) / (ny1 - ny0));
      // shift target so the projected box centres in the free area
      const cx = (minX + maxX) / 2 - (nx0 + nx1) / 2;
      const cy = (minY + maxY) / 2 - (ny0 + ny1) / 2;
      const halfH = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * dist;
      const right3 = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const up3 = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      target.addScaledVector(right3, cx * halfH * cam.aspect * 0.9);
      target.addScaledVector(up3, cy * halfH * 0.9);
      dist *= THREE.MathUtils.lerp(1, scale, 0.85);
    }
    return { pos: target.clone().addScaledVector(dir, dist), target, fov };
  }

  /** Fly to an arbitrary pose (straight line, not around the kit). */
  setCustom(fn: (aspect: number) => Pose): void {
    this.custom = fn;
    this.orbiting = false;
    this.from = this.current();
    this.to = fn(this.aspect());
    this.linear = true;
    this.t0 = performance.now();
  }

  setView(view: ViewId, instant = false): void {
    this.orbiting = false;
    this.linear = this.custom !== null;
    this.custom = null;
    this.view = view;
    const next = this.pose(view);
    if (instant) {
      this.from = null;
      this.to = next;
      this.apply(next);
      return;
    }
    this.from = this.current();
    this.to = next;
    this.t0 = performance.now();
  }

  /** Recompute after a resize or HUD change. */
  refit(): void {
    this.to = this.custom ? this.custom(this.aspect()) : this.pose(this.view);
    if (!this.from) this.apply(this.to);
  }

  private current(): Pose {
    const target = new THREE.Vector3();
    this.camera.getWorldDirection(target);
    const dist = this.camera.position.distanceTo(this.to.target);
    target.multiplyScalar(dist).add(this.camera.position);
    return { pos: this.camera.position.clone(), target, fov: this.camera.fov };
  }

  private apply(p: Pose): void {
    this.camera.fov = p.fov;
    this.camera.position.copy(p.pos).add(this.shake);
    this.camera.lookAt(p.target);
    this.camera.updateProjectionMatrix();
  }

  update(now: number, dt: number): void {
    if (this.orbiting) {
      this.orbitAngle += dt * 0.12;
      const base = this.pose('front');
      const off = base.pos.clone().sub(PIVOT);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbitAngle);
      this.apply({ pos: PIVOT.clone().add(off), target: base.target, fov: base.fov });
      return;
    }
    if (!this.from) {
      this.apply(this.to);
      return;
    }
    const k = Math.min(1, (now - this.t0) / this.duration);
    const e = ease(k);
    if (this.linear) {
      const pos = this.from.pos.clone().lerp(this.to.pos, e);
      const target = this.from.target.clone().lerp(this.to.target, e);
      this.apply({ pos, target, fov: THREE.MathUtils.lerp(this.from.fov, this.to.fov, e) });
      if (k >= 1) {
        this.from = null;
        this.linear = false;
      }
      return;
    }
    // move around the kit (spherical) instead of straight through it
    const a = this.from.pos.clone().sub(PIVOT), b = this.to.pos.clone().sub(PIVOT);
    const sa = new THREE.Spherical().setFromVector3(a), sb = new THREE.Spherical().setFromVector3(b);
    let dTheta = sb.theta - sa.theta;
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const s = new THREE.Spherical(
      THREE.MathUtils.lerp(sa.radius, sb.radius, e),
      THREE.MathUtils.lerp(sa.phi, sb.phi, e),
      sa.theta + dTheta * e,
    );
    const pos = new THREE.Vector3().setFromSpherical(s).add(PIVOT);
    const target = this.from.target.clone().lerp(this.to.target, e);
    this.apply({ pos, target, fov: THREE.MathUtils.lerp(this.from.fov, this.to.fov, e) });
    if (k >= 1) this.from = null;
  }
}
