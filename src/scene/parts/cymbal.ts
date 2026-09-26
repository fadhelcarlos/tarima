import * as THREE from 'three';
import type { MaterialLibrary } from '../materials';
import { INCH, lathe, merge, mesh, planarUV, tube } from './geo';

export interface CymbalSpec {
  diameter: number; // inches
  bell: number; // bell diameter, inches
  bellHeight: number; // m
  bowHeight: number; // m, rise of the bow from edge to bell
  model: string;
  size: string;
  seed: number;
  brilliant?: boolean;
  /** Build upside down (bottom hi-hat cymbal). */
  inverted?: boolean;
}

export interface CymbalBuild {
  /** Static seat on the stand. Origin = centre hole at the cymbal's underside, +Y = cymbal axis. */
  seat: THREE.Group;
  /** Rotates/wobbles on hits. */
  wobble: THREE.Group;
  disc: THREE.Mesh;
  radius: number;
  bellRadius: number;
  /** Height of the bell top above the seat origin. */
  top: number;
  /** How far the edge hangs below the seat origin. */
  edgeDrop: number;
  material: THREE.MeshPhysicalMaterial;
}

const HOLE = 0.0064;

export function cymbalProfile(spec: CymbalSpec): { top: (r: number) => number; thick: (r: number) => number; R: number; rb: number } {
  const R = (spec.diameter * INCH) / 2;
  const rb = (spec.bell * INCH) / 2;
  const hb = spec.bellHeight, hbow = spec.bowHeight;
  const top = (r: number) => {
    if (r <= rb) {
      const s = r / rb;
      return hbow + hb * Math.pow(Math.max(0, 1 - Math.pow(s, 2.3)), 0.8);
    }
    const s = (r - rb) / (R - rb);
    return hbow * Math.pow(1 - s, 1.2);
  };
  const thick = (r: number) => {
    if (r <= rb) return 0.0032;
    const s = (r - rb) / (R - rb);
    return 0.0019 - s * 0.0011;
  };
  return { top, thick, R, rb };
}

export function buildCymbal(spec: CymbalSpec, lib: MaterialLibrary): CymbalBuild {
  const { top, thick, R, rb } = cymbalProfile(spec);
  const baseY = top(HOLE) - thick(HOLE);
  // radii: dense around the bell shoulder and at the edge
  const rs: number[] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    rs.push(HOLE + (R - HOLE) * (t < 0.3 ? (t / 0.3) * (rb / R) * 1.05 : (rb / R) * 1.05 + ((t - 0.3) / 0.7) * (1 - (rb / R) * 1.05)));
  }
  rs[rs.length - 1] = R;
  const pts: [number, number][] = [];
  // underside outward (normals down), rounded edge, top inward (normals up), hole wall
  for (const r of rs) pts.push([r, top(r) - thick(r) - baseY]);
  pts.push([R + 0.0004, (top(R) - thick(R) * 0.5) - baseY]);
  for (let i = rs.length - 1; i >= 0; i--) pts.push([rs[i], top(rs[i]) - baseY]);
  pts.push([HOLE, top(HOLE) - thick(HOLE) - baseY]);
  const geo = planarUV(lathe(pts, 120), R);
  if (spec.inverted) geo.rotateX(Math.PI);

  const material = lib.cymbal(spec.model, spec.size, spec.seed, spec.brilliant);
  const disc = mesh(geo, material);
  const wobble = new THREE.Group();
  wobble.add(disc);
  const seat = new THREE.Group();
  seat.add(wobble);
  // random rotation so logos don't all line up like a render
  disc.rotation.y = (spec.seed % 7) * 0.35 - 1;

  const topY = top(HOLE) - baseY;
  if (!spec.inverted) {
    const felts: THREE.BufferGeometry[] = [];
    const f1 = new THREE.CylinderGeometry(0.019, 0.019, 0.009, 24);
    f1.translate(0, -0.0045, 0);
    const f2 = new THREE.CylinderGeometry(0.017, 0.017, 0.008, 24);
    f2.translate(0, topY + 0.004, 0);
    felts.push(f1, f2);
    seat.add(mesh(merge(felts), lib.felt, false));
    const hw: THREE.BufferGeometry[] = [];
    hw.push(tube(new THREE.Vector3(0, -0.012, 0), new THREE.Vector3(0, topY + 0.03, 0), 0.0042, 10));
    // wing nut
    hw.push(new THREE.CylinderGeometry(0.0075, 0.0085, 0.01, 12).translate(0, topY + 0.013, 0));
    hw.push(new THREE.BoxGeometry(0.03, 0.013, 0.0025).translate(0, topY + 0.02, 0));
    seat.add(mesh(merge(hw), lib.chrome, false));
  }
  return { seat, wobble, disc, radius: R, bellRadius: rb, top: topY, edgeDrop: baseY, material };
}
