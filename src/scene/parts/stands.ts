import * as THREE from 'three';
import type { MaterialLibrary } from '../materials';
import { ball, box, lathe, merge, mesh, tube } from './geo';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Collects geometry per material and turns it into a handful of merged meshes. */
export class PartBin {
  chrome: THREE.BufferGeometry[] = [];
  satin: THREE.BufferGeometry[] = [];
  black: THREE.BufferGeometry[] = [];
  rubber: THREE.BufferGeometry[] = [];
  felt: THREE.BufferGeometry[] = [];
  leather: THREE.BufferGeometry[] = [];

  build(lib: MaterialLibrary): THREE.Group {
    const g = new THREE.Group();
    const add = (geos: THREE.BufferGeometry[], m: THREE.Material) => {
      if (geos.length) g.add(mesh(merge(geos), m));
    };
    add(this.chrome, lib.chrome);
    add(this.satin, lib.chromeSatin);
    add(this.black, lib.blackMetal);
    add(this.rubber, lib.rubber);
    add(this.felt, lib.felt);
    add(this.leather, lib.leather);
    return g;
  }
}

/** Double-braced tripod base. Returns the top of the base tube. */
export function tripod(bin: PartBin, x: number, z: number, opts: { top: number; spread: number; tube: number; yaw?: number }): THREE.Vector3 {
  const { top, spread, tube: tr } = opts;
  const yaw = opts.yaw ?? 0;
  const legTop = Math.min(0.34, top * 0.55);
  const collarLow = 0.1;
  bin.chrome.push(tube(V(x, collarLow - 0.02, z), V(x, top, z), tr, 18));
  bin.black.push(tube(V(x, legTop - 0.018, z), V(x, legTop + 0.018, z), tr * 1.7, 18));
  bin.black.push(tube(V(x, collarLow - 0.015, z), V(x, collarLow + 0.015, z), tr * 1.7, 18));
  for (let i = 0; i < 3; i++) {
    const a = yaw + (i / 3) * Math.PI * 2;
    const fx = x + Math.cos(a) * spread, fz = z + Math.sin(a) * spread;
    const legStart = V(x + Math.cos(a) * tr * 1.7, legTop, z + Math.sin(a) * tr * 1.7);
    const foot = V(fx, 0.016, fz);
    // double legs, side by side
    const side = V(-Math.sin(a) * 0.006, 0, Math.cos(a) * 0.006);
    bin.chrome.push(tube(legStart.clone().add(side), foot.clone().add(side), tr * 0.62, 10));
    bin.chrome.push(tube(legStart.clone().sub(side), foot.clone().sub(side), tr * 0.62, 10));
    const mid = legStart.clone().lerp(foot, 0.55);
    bin.chrome.push(tube(V(x + Math.cos(a) * tr * 1.7, collarLow, z + Math.sin(a) * tr * 1.7), mid, tr * 0.5, 8));
    bin.rubber.push(tube(V(fx + Math.cos(a) * 0.008, 0, fz + Math.sin(a) * 0.008), V(fx - Math.cos(a) * 0.004, 0.028, fz - Math.sin(a) * 0.004), 0.013, 12, 0.011));
  }
  // wing bolt on the leg collar
  const wb = V(x + Math.cos(yaw + Math.PI / 3) * tr * 1.7, legTop, z + Math.sin(yaw + Math.PI / 3) * tr * 1.7);
  bin.chrome.push(tube(wb, wb.clone().add(V(Math.cos(yaw + Math.PI / 3) * 0.02, 0, Math.sin(yaw + Math.PI / 3) * 0.02)), 0.003, 8));
  bin.black.push(box(wb.clone().add(V(Math.cos(yaw + Math.PI / 3) * 0.025, 0, Math.sin(yaw + Math.PI / 3) * 0.025)), 0.012, 0.018, 0.012));
  return V(x, top, z);
}

/** Height clamp with a memory lock and wing screw. */
export function clamp(bin: PartBin, p: THREE.Vector3, r: number): void {
  bin.black.push(tube(V(p.x, p.y - 0.02, p.z), V(p.x, p.y + 0.02, p.z), r * 1.6, 16));
  bin.chrome.push(tube(V(p.x, p.y - 0.035, p.z), V(p.x, p.y - 0.02, p.z), r * 1.75, 16));
  bin.chrome.push(tube(p, V(p.x + 0.025, p.y, p.z), 0.003, 8));
  bin.black.push(box(V(p.x + 0.03, p.y, p.z), 0.008, 0.02, 0.016));
}

/**
 * Cymbal stand from floor position (x, z) to a seat at `seat` whose axis is `axis`.
 * With `boom`, a boom arm reaches from the top of the stand to under the cymbal.
 */
export function cymbalStand(bin: PartBin, x: number, z: number, seat: THREE.Vector3, axis: THREE.Vector3, boom: boolean, yaw = 0): void {
  const tiltJoint = seat.clone().addScaledVector(axis, -0.045);
  const standTop = boom ? Math.max(0.7, tiltJoint.y - 0.12) : tiltJoint.y - 0.05;
  const baseTop = tripod(bin, x, z, { top: Math.min(0.62, standTop - 0.1), spread: 0.27, tube: 0.0125, yaw });
  clamp(bin, baseTop, 0.0125);
  const upperTop = V(x, standTop, z);
  bin.chrome.push(tube(baseTop, upperTop, 0.0095, 16));
  if (boom) {
    clamp(bin, upperTop, 0.0095);
    const dir = new THREE.Vector3().subVectors(tiltJoint, upperTop);
    const back = upperTop.clone().addScaledVector(dir.clone().normalize(), -0.14);
    bin.chrome.push(tube(back, tiltJoint, 0.0085, 14));
    bin.black.push(ball(upperTop, 0.021, 16));
    // counterweight
    bin.chrome.push(tube(back.clone().addScaledVector(dir.clone().normalize(), -0.02), back.clone().addScaledVector(dir.clone().normalize(), 0.03), 0.019, 16));
  } else {
    bin.chrome.push(tube(upperTop, tiltJoint, 0.0085, 14));
  }
  // tilter: ratchet joint + rod up the cymbal axis
  bin.black.push(ball(tiltJoint, 0.017, 14));
  bin.chrome.push(tube(tiltJoint, seat.clone().addScaledVector(axis, -0.012), 0.0065, 12));
  bin.felt.push(tube(seat.clone().addScaledVector(axis, -0.014), seat.clone().addScaledVector(axis, -0.009), 0.018, 20));
}

/** Snare stand: tripod + basket arms gripping the bottom hoop. */
export function snareStand(bin: PartBin, x: number, z: number, basketY: number, radius: number, yaw = 0): void {
  const top = tripod(bin, x, z, { top: basketY - 0.1, spread: 0.24, tube: 0.012, yaw: yaw + Math.PI / 6 });
  clamp(bin, top, 0.012);
  const hub = V(x, basketY - 0.035, z);
  bin.chrome.push(tube(top, hub, 0.0095, 14));
  bin.black.push(ball(hub, 0.022, 16));
  for (let i = 0; i < 3; i++) {
    const a = yaw + (i / 3) * Math.PI * 2 + Math.PI / 2;
    const tip = V(x + Math.cos(a) * (radius + 0.008), basketY + 0.004, z + Math.sin(a) * (radius + 0.008));
    const elbow = V(x + Math.cos(a) * radius * 0.7, basketY - 0.02, z + Math.sin(a) * radius * 0.7);
    bin.chrome.push(tube(hub, elbow, 0.006, 10));
    bin.chrome.push(tube(elbow, tip, 0.006, 10));
    bin.rubber.push(ball(tip, 0.011, 12));
  }
}

export interface HiHatHardware {
  /** Top cymbal clutch; moves up/down with the pedal. */
  clutch: THREE.Group;
  footboard: THREE.Group;
}

/** Hi-hat stand with pedal. Bottom cymbal seat at `seatY`. */
export function hihatStand(bin: PartBin, x: number, z: number, seatY: number, lib: MaterialLibrary, yaw = 0): HiHatHardware {
  tripod(bin, x, z, { top: 0.6, spread: 0.24, tube: 0.0135, yaw: yaw + Math.PI });
  clamp(bin, V(x, 0.6, z), 0.0135);
  bin.chrome.push(tube(V(x, 0.6, z), V(x, seatY - 0.012, z), 0.011, 16));
  bin.black.push(tube(V(x, seatY - 0.016, z), V(x, seatY - 0.004, z), 0.022, 20, 0.018));
  bin.felt.push(tube(V(x, seatY - 0.006, z), V(x, seatY, z), 0.02, 20));
  // pull rod runs through everything
  bin.chrome.push(tube(V(x, 0.1, z), V(x, seatY + 0.12, z), 0.0042, 10));
  // spring housing
  bin.black.push(tube(V(x, 0.1, z), V(x, 0.22, z), 0.02, 16));
  // pedal base plate and heel
  const fwd = V(Math.sin(yaw), 0, Math.cos(yaw)); // toward the drummer
  const base0 = V(x, 0.006, z).addScaledVector(fwd, 0.03);
  const base1 = V(x, 0.006, z).addScaledVector(fwd, 0.34);
  bin.black.push(tube(base0, base1, 0.006, 8));
  bin.black.push(box(base1.clone().add(V(0, 0.012, 0)), 0.07, 0.024, 0.05, new THREE.Euler(0, yaw, 0)));
  const footboard = new THREE.Group();
  footboard.position.copy(base1).add(V(0, 0.026, 0));
  footboard.rotation.y = yaw;
  const plate = new THREE.Group();
  const fbGeo = new THREE.BoxGeometry(0.085, 0.008, 0.27);
  fbGeo.translate(0, 0, -0.135);
  plate.add(mesh(fbGeo, lib.blackMetal));
  const studs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) studs.push(new THREE.CylinderGeometry(0.003, 0.003, 0.003, 6).translate((j - 1) * 0.025, 0.005, -0.03 - i * 0.026));
  plate.add(mesh(merge(studs), lib.rubber, false));
  plate.rotation.x = 0.16;
  footboard.add(plate);
  // chain / strap from toe to the rod
  bin.black.push(tube(V(x, 0.1, z), V(x, 0.07, z).addScaledVector(fwd, 0.03), 0.004, 6));
  const clutch = new THREE.Group();
  const cg: THREE.BufferGeometry[] = [];
  cg.push(new THREE.CylinderGeometry(0.012, 0.012, 0.028, 16).translate(0, 0.028, 0));
  cg.push(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 10).translate(0.012, 0.03, 0).rotateZ(0));
  clutch.add(mesh(merge(cg), lib.chrome, false));
  return { clutch, footboard };
}

export interface KickPedal {
  beater: THREE.Group;
  footboard: THREE.Group;
  restAngle: number;
}

/** Bass drum pedal. `headZ` is the batter head plane, the beater strikes at `strikeY`. */
export function kickPedal(bin: PartBin, x: number, headZ: number, strikeY: number, lib: MaterialLibrary): KickPedal {
  const axleZ = headZ + 0.07;
  const axleY = 0.165;
  // frame posts and axle
  for (const s of [-1, 1]) {
    bin.satin.push(tube(V(x + s * 0.052, 0.012, axleZ - 0.012), V(x + s * 0.052, axleY, axleZ), 0.0075, 10));
    bin.black.push(ball(V(x + s * 0.052, axleY, axleZ), 0.013, 12));
  }
  bin.chrome.push(tube(V(x - 0.06, axleY, axleZ), V(x + 0.06, axleY, axleZ), 0.005, 10));
  // cam / sprocket
  bin.black.push(tube(V(x + 0.03, axleY, axleZ), V(x + 0.042, axleY, axleZ), 0.022, 20));
  // base plate + hoop clamp
  bin.black.push(box(V(x, 0.005, (axleZ + headZ + 0.36) / 2), 0.13, 0.01, headZ + 0.36 - axleZ + 0.02));
  bin.chrome.push(box(V(x, 0.02, headZ + 0.012), 0.05, 0.016, 0.028));
  bin.black.push(box(V(x, 0.03, headZ + 0.35), 0.075, 0.03, 0.05));
  // spring
  bin.chrome.push(tube(V(x - 0.052, 0.03, axleZ), V(x - 0.052, axleY - 0.03, axleZ), 0.007, 8));

  const beater = new THREE.Group();
  beater.position.set(x, axleY, axleZ);
  const shaftLen = strikeY - axleY;
  const bg: THREE.BufferGeometry[] = [];
  bg.push(tube(V(0, 0, 0), V(0, shaftLen, 0), 0.0045, 10));
  beater.add(mesh(merge(bg), lib.chrome));
  const head = new THREE.CylinderGeometry(0.03, 0.03, 0.045, 24);
  head.rotateZ(Math.PI / 2);
  head.translate(0, shaftLen, 0);
  beater.add(mesh(head, lib.feltWhite));
  const restAngle = 0.72; // leaning back toward the drummer
  beater.rotation.x = restAngle;

  const footboard = new THREE.Group();
  footboard.position.set(x, 0.03, headZ + 0.35);
  const fbGeo = new THREE.BoxGeometry(0.09, 0.008, 0.26);
  fbGeo.translate(0, 0, -0.13);
  const plate = new THREE.Group();
  plate.add(mesh(fbGeo, lib.blackMetal));
  const studs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) studs.push(new THREE.CylinderGeometry(0.003, 0.003, 0.003, 6).translate((j - 1) * 0.026, 0.005, -0.03 - i * 0.028));
  plate.add(mesh(merge(studs), lib.rubber, false));
  plate.rotation.x = 0.22;
  footboard.add(plate);
  return { beater, footboard, restAngle };
}

/** Drum throne: padded round seat on a braced tripod. */
export function throne(bin: PartBin, x: number, z: number, seatY: number): void {
  tripod(bin, x, z, { top: seatY - 0.12, spread: 0.26, tube: 0.016 });
  bin.chrome.push(tube(V(x, seatY - 0.14, z), V(x, seatY - 0.05, z), 0.013, 16));
  bin.black.push(tube(V(x, seatY - 0.06, z), V(x, seatY - 0.035, z), 0.12, 32, 0.15));
  const seat = lathe([
    [0.001, seatY + 0.075],
    [0.1, seatY + 0.072],
    [0.155, seatY + 0.06],
    [0.172, seatY + 0.035],
    [0.172, seatY - 0.008],
    [0.16, seatY - 0.03],
    [0.001, seatY - 0.03],
  ].reverse() as [number, number][], 48);
  seat.translate(x, 0, z);
  bin.leather.push(seat);
}
