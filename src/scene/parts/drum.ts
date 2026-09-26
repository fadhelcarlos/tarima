import * as THREE from 'three';
import type { MaterialLibrary } from '../materials';
import { INCH, box, lathe, merge, mesh, polarDisc, tube } from './geo';

export type DrumKind = 'snare' | 'tom' | 'floor' | 'kick';

export interface DrumSpec {
  kind: DrumKind;
  diameter: number; // inches
  depth: number; // inches
  lugs: number;
  label: string;
  seed: number;
  /** Angle (radians, drum-local, around +Y) where the badge faces. */
  badgeAngle?: number;
  /** Angle where the tom mount clamp sits. */
  mountAngle?: number;
}

export interface DrumBuild {
  /** Local origin = batter head centre; +Y points out of the batter head. */
  root: THREE.Group;
  /** Everything that moves when the drum is struck (bounces on its mount). */
  body: THREE.Group;
  head: THREE.Mesh;
  radius: number;
  rimRadius: number;
  depth: number;
}

/** Triple-flange hoop cross-section, traversed so lathe normals face outward. */
function hoopProfile(ri: number, flip: boolean, yOff = 0): [number, number][] {
  const t = 0.0023;
  const pts: [number, number][] = [
    [ri + 0.0006, 0.0122],
    [ri, 0.0105],
    [ri, -0.013],
    [ri + 0.011, -0.013],
    [ri + 0.011, -0.0107],
    [ri + t, -0.0107],
    [ri + t, 0.0088],
    [ri + 0.0058, 0.0094],
    [ri + 0.0066, 0.011],
    [ri + 0.0052, 0.0127],
    [ri + 0.0028, 0.0131],
    [ri + 0.0006, 0.0122],
  ];
  if (!flip) return pts.map(([r, y]) => [r, y + yOff]);
  return pts.map(([r, y]) => [r, -y + yOff] as [number, number]).reverse();
}

/** Wooden bass-drum hoop (rectangular section). */
function woodHoopProfile(ri: number, flip: boolean, yOff: number): [number, number][] {
  const w = 0.014, h0 = -0.018, h1 = 0.012;
  const pts: [number, number][] = [
    [ri, h1 - 0.002],
    [ri, h0],
    [ri + w, h0],
    [ri + w, h1 - 0.003],
    [ri + w - 0.003, h1],
    [ri + 0.002, h1],
    [ri, h1 - 0.002],
  ];
  if (!flip) return pts.map(([r, y]) => [r, y + yOff]);
  return pts.map(([r, y]) => [r, -y + yOff] as [number, number]).reverse();
}

export function buildDrum(spec: DrumSpec, lib: MaterialLibrary): DrumBuild {
  const R = (spec.diameter * INCH) / 2;
  const D = spec.depth * INCH;
  const isKick = spec.kind === 'kick';
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const chrome: THREE.BufferGeometry[] = [];
  const blackParts: THREE.BufferGeometry[] = [];

  // shell
  const shellGeo = new THREE.CylinderGeometry(R, R, D - 0.004, 128, 1, true);
  shellGeo.translate(0, -D / 2, 0);
  body.add(mesh(shellGeo, lib.shell));
  if (isKick) {
    const inner = new THREE.CylinderGeometry(R - 0.007, R - 0.007, D - 0.004, 64, 1, true);
    inner.translate(0, -D / 2, 0);
    body.add(mesh(inner, lib.innerWood, false));
  }

  // batter head (dense disc for the vibration shader) + collar over the bearing edge
  const headMat = lib.head(spec.label, spec.seed);
  const head = mesh(polarDisc(R - 0.001, 30, 88), headMat);
  head.castShadow = false;
  body.add(head);
  const collar = lathe([[R - 0.0012, 0.0], [R + 0.0004, -0.0025], [R + 0.0012, -0.008], [R + 0.0012, -0.012]], 96);
  body.add(mesh(collar, lib.headPlain, false));

  // resonant head
  if (isKick) {
    const reso = polarDisc(R - 0.001, 8, 96);
    reso.rotateZ(Math.PI);
    reso.translate(0, -D, 0);
    const resoMesh = mesh(reso, lib.kickReso(), false);
    body.add(resoMesh);
    // port ring matches the hole in the alpha map (u .71, v .30 → mirrored by the rotation)
    const port = new THREE.TorusGeometry(0.0254 * 2.35, 0.0042, 10, 48);
    port.rotateX(Math.PI / 2);
    port.translate(-0.42 * R, -D - 0.002, 0.4 * R);
    blackParts.push(port);
  } else {
    const bottom = new THREE.CircleGeometry(R - 0.001, 96);
    bottom.rotateX(Math.PI / 2);
    bottom.translate(0, -D, 0);
    body.add(mesh(bottom, spec.kind === 'snare' ? lib.headPlain : lib.headPlain, false));
  }
  const collarB = lathe([[R + 0.0012, -D + 0.012], [R + 0.0012, -D + 0.008], [R + 0.0004, -D + 0.0025], [R - 0.0012, -D]], 96);
  body.add(mesh(collarB, lib.headPlain, false));

  // hoops
  let rimR: number;
  if (isKick) {
    const top = lathe(woodHoopProfile(R + 0.0012, false, 0), 128);
    const bot = lathe(woodHoopProfile(R + 0.0012, true, -D), 128);
    body.add(mesh(merge([top, bot]), lib.kickHoop));
    // metal inlay stripe around each wooden hoop
    for (const y of [-0.003, -D + 0.003]) {
      const band = new THREE.CylinderGeometry(R + 0.0154, R + 0.0154, 0.006, 128, 1, true);
      band.translate(0, y, 0);
      chrome.push(band);
    }
    rimR = R + 0.0152;
  } else {
    chrome.push(lathe(hoopProfile(R + 0.0015, false, 0), 128));
    chrome.push(lathe(hoopProfile(R + 0.0015, true, -D), 128));
    rimR = R + 0.0125;
  }

  // lugs, tension rods (both sides) and hoop ears / claws
  // receivers line up with the rods so each rod visibly threads into its lug
  const lugR = isKick ? R + 0.022 : R + 0.0155;
  const rodR = lugR;
  const n = spec.lugs;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    const cx = Math.cos(a), cz = Math.sin(a);
    const at = (r: number, y: number) => new THREE.Vector3(cx * r, y, cz * r);
    const rot = new THREE.Euler(0, -a, 0);
    const lugTop = -Math.min(0.034, D * 0.22);
    const lugBottom = -D - lugTop;
    if (isKick) {
      // twin short lugs near each end, claws + T-rods pull the wooden hoops
      for (const [y0, y1] of [[-0.05, -0.1], [-D + 0.05, -D + 0.1]] as const) {
        chrome.push(tube(at(lugR, y0), at(lugR, y1), 0.0062, 12));
        chrome.push(tube(at(R, y0 - 0.008), at(lugR, y0 - 0.008), 0.005, 10));
        chrome.push(tube(at(R, y1 + 0.008), at(lugR, y1 + 0.008), 0.005, 10));
      }
      for (const [yh, yl, sgn] of [[0.004, -0.05, 1], [-D - 0.004, -D + 0.05, -1]] as const) {
        const cr = R + 0.022;
        chrome.push(box(at(cr - 0.004, yh - sgn * 0.004), 0.008, 0.02, 0.014, rot));
        chrome.push(tube(at(cr, yh), at(cr, yl), 0.0026, 8));
        // T handle
        chrome.push(tube(at(cr, yh + sgn * 0.003).add(new THREE.Vector3(-cz * 0.018, 0, cx * 0.018)), at(cr, yh + sgn * 0.003).add(new THREE.Vector3(cz * 0.018, 0, -cx * 0.018)), 0.004, 8));
      }
    } else {
      if (D > 0.12) {
        chrome.push(tube(at(lugR, lugTop), at(lugR, lugBottom), 0.0056, 14));
        for (const y of [lugTop, lugBottom]) {
          chrome.push(tube(at(R - 0.001, y), at(lugR, y), 0.0058, 12));
          chrome.push(tube(at(lugR, y - 0.006), at(lugR, y + 0.006), 0.0072, 14));
        }
      } else {
        chrome.push(tube(at(lugR, lugTop), at(lugR, lugBottom), 0.0062, 14));
        chrome.push(box(at(R + 0.004, (lugTop + lugBottom) / 2), 0.012, Math.abs(lugBottom - lugTop) + 0.01, 0.012, rot));
      }
      for (const [earY, rodEnd, sgn] of [[-0.0118, lugTop, 1], [-D + 0.0118, lugBottom, -1]] as const) {
        chrome.push(box(at(R + 0.0145, earY), 0.012, 0.0024, 0.015, rot));
        chrome.push(tube(at(rodR, earY + sgn * 0.0012), at(rodR, earY + sgn * 0.0072), 0.0044, 8));
        chrome.push(tube(at(rodR, earY + sgn * 0.0012), at(rodR, earY + sgn * 0.002), 0.0058, 12));
        chrome.push(tube(at(rodR, earY), at(rodR, rodEnd + sgn * 0.004), 0.0023, 8));
      }
    }
  }

  // badge
  const ba = spec.badgeAngle ?? Math.PI * 1.5;
  const badge = new THREE.CylinderGeometry(0.011, 0.011, 0.0025, 32);
  badge.scale(1, 1, 1.6);
  badge.rotateZ(Math.PI / 2);
  badge.rotateY(-ba);
  badge.translate(Math.cos(ba) * (R + 0.001), -D * 0.5, Math.sin(ba) * (R + 0.001));
  body.add(mesh(badge, lib.badge, false));

  // snare: strainer, butt plate and wires under the bottom head
  if (spec.kind === 'snare') {
    const sa = Math.PI; // strainer on the drummer's left
    const sx = Math.cos(sa), sz = Math.sin(sa);
    const srot = new THREE.Euler(0, -sa, 0);
    chrome.push(box(new THREE.Vector3(sx * (R + 0.012), -D * 0.5, sz * (R + 0.012)), 0.018, 0.06, 0.022, srot));
    chrome.push(tube(new THREE.Vector3(sx * (R + 0.024), -D * 0.25, sz * (R + 0.024)), new THREE.Vector3(sx * (R + 0.03), -D * 0.8, sz * (R + 0.03)), 0.004, 8));
    chrome.push(box(new THREE.Vector3(-sx * (R + 0.01), -D * 0.5, -sz * (R + 0.01)), 0.014, 0.04, 0.016, srot));
    for (let w = -8; w <= 8; w++) {
      const z = w * 0.0065;
      const half = Math.sqrt(Math.max(0, (R * 0.7) ** 2 - z * z));
      chrome.push(tube(new THREE.Vector3(-half, -D - 0.0015, z), new THREE.Vector3(half, -D - 0.0015, z), 0.0007, 5));
    }
  }

  // rack tom mount clamp
  if (spec.mountAngle !== undefined) {
    const ma = spec.mountAngle;
    const mx = Math.cos(ma), mz = Math.sin(ma);
    const mrot = new THREE.Euler(0, -ma, 0);
    blackParts.push(box(new THREE.Vector3(mx * (R + 0.01), -D * 0.45, mz * (R + 0.01)), 0.02, 0.05, 0.04, mrot));
    chrome.push(new THREE.SphereGeometry(0.014, 16, 10).translate(mx * (R + 0.026), -D * 0.45, mz * (R + 0.026)));
  }

  body.add(mesh(merge(chrome), lib.chrome));
  if (blackParts.length) body.add(mesh(merge(blackParts), lib.plastic));

  return { root, body, head, radius: R - 0.001, rimRadius: rimR, depth: D };
}
