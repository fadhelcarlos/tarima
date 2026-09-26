import * as THREE from 'three';
import type { MaterialLibrary } from './materials';
import { buildCymbal, type CymbalBuild, type CymbalSpec } from './parts/cymbal';
import { buildDrum, type DrumBuild, type DrumSpec } from './parts/drum';
import { ball, box, tube } from './parts/geo';
import { PartBin, cymbalStand, hihatStand, kickPedal, snareStand, throne, type HiHatHardware, type KickPedal } from './parts/stands';

export type PieceId = 'kick' | 'snare' | 'tom1' | 'tom2' | 'floor' | 'hihat' | 'crash' | 'crash2' | 'ride' | 'hhpedal';

export interface Piece {
  id: PieceId;
  name: string;
  kind: 'drum' | 'cymbal' | 'pedal';
  /** Local XZ plane is the playing surface, origin at its centre. */
  surface: THREE.Object3D;
  radius: number;
  rim: number;
  hit: THREE.Mesh[];
  drum?: DrumBuild;
  cymbal?: CymbalBuild;
  /** Where the on-screen name label points (world space). */
  anchor: THREE.Vector3;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** The drummer's head, used to aim toms and cymbals at the player. */
const PLAYER = V(0, 1.15, 0.62);

const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });

function hitDisc(radius: number, y = 0.006): THREE.Mesh {
  const g = new THREE.CircleGeometry(radius, 48);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return new THREE.Mesh(g, HIT_MAT);
}

/** Axis tilted from vertical toward the player by `tilt` radians. */
function aimedAxis(p: THREE.Vector3, tilt: number): THREE.Vector3 {
  const d = V(PLAYER.x - p.x, 0, PLAYER.z - p.z).normalize();
  return V(d.x * Math.sin(tilt), Math.cos(tilt), d.z * Math.sin(tilt)).normalize();
}

function orient(obj: THREE.Object3D, axis: THREE.Vector3, spin = 0): void {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), axis);
  const s = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), spin);
  obj.quaternion.copy(q.multiply(s));
}

export class Kit {
  readonly root = new THREE.Group();
  readonly pieces = new Map<PieceId, Piece>();
  hihatTop!: CymbalBuild;
  hihatBottom!: CymbalBuild;
  hihat!: HiHatHardware;
  pedal!: KickPedal;
  /** Rest height of the top hi-hat seat above the bottom one when fully closed. */
  hihatClosedY = 0;

  constructor(private readonly lib: MaterialLibrary) {}

  build(): this {
    const lib = this.lib;
    const bin = new PartBin();
    this.root.name = 'kit';

    // ── bass drum (20 x 16), batter head faces the drummer
    const kickSpec: DrumSpec = { kind: 'kick', diameter: 20, depth: 16, lugs: 10, label: 'Bombo 20"', seed: 3, badgeAngle: Math.PI * 1.5 + 0.5 };
    const kick = buildDrum(kickSpec, lib);
    const kickHeadZ = -0.06;
    kick.root.position.set(0.03, kick.radius + 0.017, kickHeadZ);
    kick.root.rotation.x = Math.PI / 2;
    this.root.add(kick.root);
    const kickCenterY = kick.root.position.y;
    const kickHit = new THREE.Mesh(new THREE.CylinderGeometry(kick.rimRadius + 0.01, kick.rimRadius + 0.01, kick.depth + 0.03, 32).translate(0, -kick.depth / 2, 0), HIT_MAT);
    kick.body.add(kickHit);

    // spurs near the front of the shell
    for (const s of [-1, 1]) {
      const a = V(0.03 + s * kick.radius * 0.78, kickCenterY - kick.radius * 0.55, kickHeadZ - kick.depth * 0.78);
      const foot = V(0.03 + s * (kick.radius + 0.12), 0.012, kickHeadZ - kick.depth * 0.95);
      bin.chrome.push(tube(a, foot, 0.0075, 10));
      bin.black.push(ball(a, 0.016, 12));
      bin.rubber.push(ball(foot, 0.012, 10));
    }

    // kick pedal
    const strikeY = kickCenterY + 0.03;
    this.pedal = kickPedal(bin, 0.03, kickHeadZ, strikeY, lib);
    this.root.add(this.pedal.beater, this.pedal.footboard);
    const pedalHit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.34).translate(0.03, 0.06, kickHeadZ + 0.2), HIT_MAT);
    this.root.add(pedalHit);
    this.addPiece({ id: 'kick', name: 'Bombo', kind: 'pedal', surface: kick.body, radius: kick.radius, rim: kick.rimRadius, hit: [kickHit, pedalHit], drum: kick, anchor: V(0.03, kickCenterY + kick.radius + 0.02, kickHeadZ - kick.depth * 0.5) });

    // ── snare (14 x 5.5)
    const snare = buildDrum({ kind: 'snare', diameter: 14, depth: 5.5, lugs: 10, label: 'Redoblante 14"', seed: 11 }, lib);
    snare.root.position.set(-0.21, 0.655, 0.1);
    snare.root.rotation.set(0.1, 0.25, -0.03);
    this.root.add(snare.root);
    snare.body.add(hitDisc(snare.rimRadius * 1.06));
    snareStand(bin, -0.21, 0.08, 0.655 - snare.depth - 0.005, snare.radius, 0.3);
    this.addPiece({ id: 'snare', name: 'Redoblante', kind: 'drum', surface: snare.body, radius: snare.radius, rim: snare.rimRadius, hit: snare.body.children.slice(-1) as THREE.Mesh[], drum: snare, anchor: V(-0.21, 0.66, 0.1) });

    // ── rack toms on a bass drum mount
    const post = V(0.03, kickCenterY + kick.radius + 0.01, kickHeadZ - kick.depth * 0.52);
    const postTop = post.clone().add(V(0, 0.1, 0));
    bin.chrome.push(tube(post, postTop, 0.012, 16));
    bin.black.push(box(postTop.clone().add(V(0, 0.015, 0)), 0.07, 0.04, 0.04));
    bin.black.push(tube(post.clone().add(V(0, -0.01, 0)), post.clone().add(V(0, 0.012, 0)), 0.024, 16));
    const toms: [PieceId, string, DrumSpec, THREE.Vector3, number][] = [
      ['tom1', 'Tom 1', { kind: 'tom', diameter: 12, depth: 8, lugs: 6, label: 'Tom 12"', seed: 21, mountAngle: -Math.PI / 3 }, V(-0.155, 0.845, -0.275), 0.34],
      ['tom2', 'Tom 2', { kind: 'tom', diameter: 13, depth: 9, lugs: 6, label: 'Tom 13"', seed: 31, mountAngle: -Math.PI * 2 / 3 }, V(0.215, 0.855, -0.285), 0.34],
    ];
    for (const [id, name, spec, pos, tilt] of toms) {
      const tom = buildDrum(spec, lib);
      tom.root.position.copy(pos);
      orient(tom.root, aimedAxis(pos, tilt), 0);
      this.root.add(tom.root);
      tom.body.add(hitDisc(tom.rimRadius * 1.06));
      this.root.updateMatrixWorld(true);
      const ma = spec.mountAngle!;
      const clampPt = tom.root.localToWorld(V(Math.cos(ma) * (tom.radius + 0.026), -tom.depth * 0.45, Math.sin(ma) * (tom.radius + 0.026)));
      const elbow = V(clampPt.x * 0.55 + postTop.x * 0.45, postTop.y + 0.02, postTop.z);
      bin.chrome.push(tube(postTop.clone().add(V(Math.sign(clampPt.x - postTop.x) * 0.03, 0.02, 0)), elbow, 0.0095, 12));
      bin.chrome.push(tube(elbow, clampPt, 0.0095, 12));
      bin.black.push(ball(elbow, 0.016, 12));
      this.addPiece({ id, name, kind: 'drum', surface: tom.body, radius: tom.radius, rim: tom.rimRadius, hit: [tom.body.children[tom.body.children.length - 1] as THREE.Mesh], drum: tom, anchor: pos.clone() });
    }

    // ── floor tom (16 x 16) on three legs
    const floorPos = V(0.53, 0.62, 0.05);
    const floor = buildDrum({ kind: 'floor', diameter: 16, depth: 16, lugs: 8, label: 'Tom de piso 16"', seed: 41 }, lib);
    floor.root.position.copy(floorPos);
    orient(floor.root, aimedAxis(floorPos, 0.08));
    this.root.add(floor.root);
    floor.body.add(hitDisc(floor.rimRadius * 1.06));
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const bracket = floor.root.localToWorld(V(Math.cos(a) * (floor.radius + 0.02), -0.09, Math.sin(a) * (floor.radius + 0.02)));
      const foot = V(floorPos.x + Math.cos(a) * (floor.radius + 0.1), 0.014, floorPos.z + Math.sin(a) * (floor.radius + 0.1));
      bin.chrome.push(tube(bracket.clone().add(V(0, 0.03, 0)), foot, 0.0065, 10));
      bin.black.push(box(bracket, 0.03, 0.045, 0.03));
      bin.rubber.push(ball(foot, 0.013, 10));
    }
    this.addPiece({ id: 'floor', name: 'Tom de piso', kind: 'drum', surface: floor.body, radius: floor.radius, rim: floor.rimRadius, hit: [floor.body.children[floor.body.children.length - 1] as THREE.Mesh], drum: floor, anchor: floorPos.clone() });

    // ── cymbals
    const cym = (spec: CymbalSpec, seatPos: THREE.Vector3, tilt: number, stand: { x: number; z: number; boom: boolean; yaw?: number }, id: PieceId, name: string) => {
      const c = buildCymbal(spec, lib);
      const axis = aimedAxis(seatPos, tilt);
      c.seat.position.copy(seatPos);
      orient(c.seat, axis);
      this.root.add(c.seat);
      const disc = hitDisc(c.radius * 1.05, -0.004);
      c.wobble.add(disc);
      cymbalStand(bin, stand.x, stand.z, seatPos, axis, stand.boom, stand.yaw ?? 0);
      this.addPiece({ id, name, kind: 'cymbal', surface: c.wobble, radius: c.radius, rim: c.radius, hit: [disc], cymbal: c, anchor: seatPos.clone() });
      return c;
    };
    cym({ diameter: 16, bell: 5.2, bellHeight: 0.02, bowHeight: 0.024, model: 'Crash', size: '16"', seed: 5 }, V(-0.46, 1.1, -0.42), 0.34, { x: -0.72, z: -0.6, boom: true, yaw: 0.3 }, 'crash', 'Crash');
    cym({ diameter: 18, bell: 5.8, bellHeight: 0.021, bowHeight: 0.027, model: 'Crash', size: '18"', seed: 9 }, V(0.4, 1.17, -0.6), 0.32, { x: 0.62, z: -0.92, boom: true, yaw: 1.2 }, 'crash2', 'Crash 2');
    cym({ diameter: 20, bell: 6.2, bellHeight: 0.024, bowHeight: 0.03, model: 'Ride', size: '20"', seed: 13 }, V(0.8, 1.0, -0.2), 0.22, { x: 1.05, z: -0.4, boom: true, yaw: 0.7 }, 'ride', 'Ride');

    // ── hi-hat: bottom cymbal inverted, top cymbal on the clutch
    const hhX = -0.53, hhZ = 0.03, hhSeat = 0.84;
    const hhSpec: CymbalSpec = { diameter: 14, bell: 4.8, bellHeight: 0.017, bowHeight: 0.016, model: 'Hi-Hat', size: '14"', seed: 17 };
    const hhYaw = Math.atan2(PLAYER.x - hhX, PLAYER.z - hhZ);
    this.hihat = hihatStand(bin, hhX, hhZ, hhSeat, lib, hhYaw);
    this.root.add(this.hihat.footboard);
    const bottom = buildCymbal({ ...hhSpec, inverted: true, seed: 19 }, lib);
    // bell-to-edge drop of a cymbal (seat origin is the underside at the hole)
    const drop = hhSpec.bowHeight + hhSpec.bellHeight - 0.0032;
    const edgeThick = 0.0008;
    // inverted bottom hat: its bell rests on the felt, its edge points up
    const bottomY = hhSeat + 0.0032;
    bottom.seat.position.set(hhX, bottomY, hhZ);
    // the bottom hat sits slightly tilted so it doesn't air-lock
    bottom.seat.rotation.z = 0.03;
    this.root.add(bottom.seat);
    const top = buildCymbal(hhSpec, lib);
    // closed: the top hat's edge sits right on the bottom hat's edge
    this.hihatClosedY = bottomY + 2 * (drop + edgeThick) + 0.0006;
    top.seat.position.set(hhX, this.hihatClosedY + 0.012, hhZ);
    this.root.add(top.seat);
    this.hihat.clutch.position.set(0, top.top, 0);
    top.wobble.add(this.hihat.clutch);
    this.hihatTop = top;
    this.hihatBottom = bottom;
    const hhDisc = hitDisc(top.radius * 1.08, -0.004);
    top.wobble.add(hhDisc);
    this.addPiece({ id: 'hihat', name: 'Hi-hat', kind: 'cymbal', surface: top.wobble, radius: top.radius, rim: top.radius, hit: [hhDisc], cymbal: top, anchor: V(hhX, hhSeat + 0.05, hhZ) });
    const hhPedalHit = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.32).translate(0, 0.05, -0.15), HIT_MAT);
    this.hihat.footboard.add(hhPedalHit);
    this.addPiece({ id: 'hhpedal', name: 'Pedal del hi-hat', kind: 'pedal', surface: this.hihat.footboard, radius: 0.1, rim: 0.1, hit: [hhPedalHit], anchor: this.hihat.footboard.position.clone() });

    // ── throne
    throne(bin, 0, 0.66, 0.52);

    this.root.add(bin.build(lib));
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material === HIT_MAT) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    return this;
  }

  private addPiece(p: Piece): void {
    for (const h of p.hit) h.userData.piece = p.id;
    this.pieces.set(p.id, p);
  }

  /** Every mesh that can be hit (for raycasting). */
  hitTargets(): THREE.Object3D[] {
    return [...this.pieces.values()].flatMap((p) => p.hit);
  }
}

