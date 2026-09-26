import * as THREE from 'three';
import type { PieceId } from './kit';
import { makeCanvas, Noise2, toTexture } from './textures';

const LENGTH = 0.407; // 16" hickory stick
const GRIP = 0.12; // hand position from the butt
const REACH = LENGTH - GRIP;
const UP = new THREE.Vector3(0, 1, 0);

function stickGeometry(): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [0.0001, 0],
    [0.0066, 0.0008],
    [0.0073, 0.004],
    [0.0073, 0.3],
    [0.0062, 0.338],
    [0.0045, 0.366],
    [0.0031, 0.386],
    [0.0026, 0.3915],
    [0.0039, 0.3955],
    [0.0044, 0.3995],
    [0.0039, 0.4038],
    [0.0022, 0.4062],
    [0.0001, LENGTH],
  ];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 20);
  g.translate(0, -GRIP, 0);
  return g;
}

function hickory(): THREE.MeshPhysicalMaterial {
  const [c, ctx] = makeCanvas(64, 512);
  const img = ctx.createImageData(64, 512);
  const n = new Noise2(71, 8, 64);
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 64; x++) {
      const g = n.fbm((x / 64) * 8, (y / 512) * 64, 3);
      const streak = Math.pow(Math.abs(Math.sin((x / 64) * Math.PI * 6 + g * 4)), 8);
      const k = 0.88 + g * 0.18 - streak * 0.12;
      const i = (y * 64 + x) * 4;
      img.data[i] = 214 * k;
      img.data[i + 1] = 174 * k;
      img.data[i + 2] = 124 * k;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.MeshPhysicalMaterial({ map: toTexture(c, { srgb: true }), roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.3, transparent: true });
}

interface Stick {
  mesh: THREE.Mesh;
  grip: THREE.Vector3;
  dir: THREE.Vector3;
  restGrip: THREE.Vector3;
  restDir: THREE.Vector3;
  lift: number;
  liftV: number;
  lastHit: number;
  lastPiece: PieceId | null;
}

/** Hand side per piece for a right-handed player (right hand crosses over to the hi-hat). */
const HAND: Partial<Record<PieceId, 0 | 1>> = { snare: 0, crash: 0, hihat: 1, tom1: 1, tom2: 1, floor: 1, ride: 1, crash2: 1 };

/**
 * Two drumsticks. On every hit a stick is already touching the spot the finger tapped (sound and
 * contact land on the same frame), then it rebounds off the head like a real wrist stroke.
 */
export class Sticks {
  readonly group = new THREE.Group();
  private readonly sticks: Stick[] = [];
  private time = 0;
  private readonly hinge = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly tmp = new THREE.Vector3();

  constructor() {
    const geo = stickGeometry();
    const mat = hickory();
    const rests: [THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(-0.4, 0.86, 0.36), new THREE.Vector3(-0.2, 0.7, 0.2)],
      [new THREE.Vector3(0.34, 0.88, 0.36), new THREE.Vector3(-0.06, 0.74, 0.22)],
    ];
    for (const [grip, tipAt] of rests) {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.visible = false;
      mesh.castShadow = true;
      const dir = tipAt.clone().sub(grip).normalize();
      this.group.add(mesh);
      this.sticks.push({ mesh, grip: grip.clone(), dir: dir.clone(), restGrip: grip, restDir: dir, lift: 0.35, liftV: 0, lastHit: -10, lastPiece: null });
    }
    this.update(0);
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  private choose(piece: PieceId): Stick {
    const [L, R] = this.sticks;
    const pref = HAND[piece];
    let s = pref === undefined ? (L.lastHit < R.lastHit ? L : R) : this.sticks[pref];
    const other = s === L ? R : L;
    const busy = this.time - s.lastHit < 0.07 && s.lastPiece !== piece;
    // fast repeats on one drum alternate hands (rolls); a busy hand hands off to the free one
    const roll = this.time - s.lastHit < 0.13 && s.lastPiece === piece && this.time - other.lastHit > 0.06;
    if (busy || roll) s = other;
    return s;
  }

  /** `point` = contact on the surface (world), `normal` = surface up (world). */
  strike(piece: PieceId, point: THREE.Vector3, normal: THREE.Vector3, velocity: number): void {
    if (!this.group.visible) return;
    const s = this.choose(piece);
    // come in from the hand's side at a shallow angle
    const toHand = this.tmp.copy(s.restGrip).sub(point);
    toHand.y = 0;
    toHand.normalize();
    const angle = 0.3;
    const dir = new THREE.Vector3().copy(toHand).multiplyScalar(-Math.cos(angle)).addScaledVector(UP, -Math.sin(angle)).normalize();
    const tip = point.clone().addScaledVector(normal, 0.0045);
    s.grip.copy(tip).addScaledVector(dir, -REACH);
    s.dir.copy(dir);
    s.lift = 0;
    s.liftV = 7 + 7 * velocity;
    s.lastHit = this.time;
    s.lastPiece = piece;
  }

  update(dt: number): void {
    this.time += dt;
    for (const s of this.sticks) {
      // wrist: rebound up to a hover, then settle
      const k = (2 * Math.PI * 3.2) ** 2, c = 2 * 0.75 * 2 * Math.PI * 3.2;
      const n = Math.max(1, Math.ceil(dt * 240));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        s.liftV += (-k * (s.lift - 0.42) - c * s.liftV) * h;
        s.lift += s.liftV * h;
      }
      // the stick is only there for the stroke: strike, rebound, then fade out
      const since = this.time - s.lastHit;
      const alpha = since < 0.28 ? 1 : Math.max(0, 1 - (since - 0.28) / 0.22);
      (s.mesh.material as THREE.MeshPhysicalMaterial).opacity = alpha;
      s.mesh.visible = alpha > 0.01;
      s.mesh.castShadow = alpha > 0.5;
      this.hinge.crossVectors(s.dir, UP).normalize();
      this.q.setFromAxisAngle(this.hinge, s.lift);
      const d = this.tmp.copy(s.dir).applyQuaternion(this.q);
      s.mesh.position.copy(s.grip);
      s.mesh.quaternion.setFromUnitVectors(UP, d);
    }
  }
}
