import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const INCH = 0.0254;

const UP = new THREE.Vector3(0, 1, 0);

/** Cylinder between two points. */
export function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 16, r2 = r): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

export function ball(p: THREE.Vector3, r: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1));
  g.translate(p.x, p.y, p.z);
  return g;
}

export function box(p: THREE.Vector3, sx: number, sy: number, sz: number, rot?: THREE.Euler): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rot) g.applyQuaternion(new THREE.Quaternion().setFromEuler(rot));
  g.translate(p.x, p.y, p.z);
  return g;
}

/** Lathe from [radius, y] pairs, revolved around +Y. */
export function lathe(points: [number, number][], seg = 64): THREE.BufferGeometry {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

/** Merge helper that tolerates mixed indexed/non-indexed inputs. */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = geos.map((g) => {
    const out = g.index ? g : g;
    for (const key of Object.keys(out.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') out.deleteAttribute(key);
    }
    if (!out.attributes.uv) {
      out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
    }
    return out.index ? out : out.toNonIndexed();
  });
  const indexed = clean.filter((g) => g.index);
  const nonIndexed = clean.filter((g) => !g.index);
  const parts: THREE.BufferGeometry[] = [];
  if (indexed.length) parts.push(mergeGeometries(indexed, false)!);
  if (nonIndexed.length) parts.push(mergeGeometries(nonIndexed, false)!);
  if (parts.length === 1) return parts[0];
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
}

/**
 * Polar-grid disc in the XZ plane (y = 0) with planar UVs (0..1 across the diameter,
 * V pointing away from the drummer). Dense rings let the vertex shader ripple it.
 */
export function polarDisc(radius: number, rings = 36, seg = 96): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  const uv: number[] = [0.5, 0.5];
  const idx: number[] = [];
  for (let r = 1; r <= rings; r++) {
    const rr = (r / rings) * radius;
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      pos.push(x, 0, z);
      uv.push(x / (2 * radius) + 0.5, -z / (2 * radius) + 0.5);
    }
  }
  for (let s = 0; s < seg; s++) idx.push(0, 1 + ((s + 1) % seg), 1 + s);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * seg, a1 = 1 + r * seg;
    for (let s = 0; s < seg; s++) {
      const s1 = (s + 1) % seg;
      idx.push(a0 + s, a0 + s1, a1 + s);
      idx.push(a0 + s1, a1 + s1, a1 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Replace a geometry's UVs with a planar XZ projection normalized to `radius`. */
export function planarUV(g: THREE.BufferGeometry, radius: number): THREE.BufferGeometry {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / (2 * radius) + 0.5;
    uv[i * 2 + 1] = -p.getZ(i) / (2 * radius) + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export function mesh(g: THREE.BufferGeometry, m: THREE.Material, shadows = true): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.castShadow = shadows;
  me.receiveShadow = true;
  return me;
}
