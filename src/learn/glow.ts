import * as THREE from 'three';
import type { Kit, PieceId } from '../scene/kit';
import { makeCanvas } from '../scene/textures';
import type { Coach, Grade } from './coach';

const GLOW = new THREE.Color('#12c6ff');
const HIT = new THREE.Color('#fff4d6');
const MISS = new THREE.Color('#34424c');

/** Filled pool of light with a brighter rim, feathered at the very edge. */
function fillTexture(): THREE.Texture {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.78)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.88)');
  g.addColorStop(0.93, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Halo ring texture mapped across a RingGeometry's UVs (bright inner edge, soft outer fade). */
function haloTexture(): THREE.Texture {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.08, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Lamp {
  fills: THREE.Mesh[];
  halos: THREE.Mesh[];
  fill: THREE.MeshBasicMaterial;
  halo: THREE.MeshBasicMaterial;
  level: number;
  flash: number;
  flashColor: THREE.Color;
}

/**
 * "Easy" guide: the drum or cymbal you have to hit lights up in color, like an LED-lit kit.
 * It brightens as the moment gets close, is fully lit when it's time (and keeps pulsing while
 * the song waits for you), and bursts when you hit it. Nothing to read.
 */
export class GlowGuide {
  enabled = true;
  private readonly lamps = new Map<PieceId, Lamp>();
  private readonly col = new THREE.Color();

  constructor(kit: Kit) {
    const fillTex = fillTexture();
    const haloTex = haloTexture();
    for (const p of kit.pieces.values()) {
      const fill = new THREE.MeshBasicMaterial({
        color: GLOW.clone(),
        map: fillTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: THREE.DoubleSide,
      });
      const halo = new THREE.MeshBasicMaterial({
        color: GLOW.clone(),
        map: haloTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const fills: THREE.Mesh[] = [];
      const halos: THREE.Mesh[] = [];
      const add = (list: THREE.Mesh[], geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, pos?: THREE.Vector3) => {
        const m = new THREE.Mesh(geo, mat);
        m.renderOrder = 12;
        m.visible = false;
        if (pos) m.position.copy(pos);
        parent.add(m);
        list.push(m);
      };
      const ring = (inner: number, outer: number) => {
        const g = new THREE.RingGeometry(inner, outer, 96, 1);
        g.rotateX(-Math.PI / 2);
        // remap UVs radially so the halo texture's gradient runs across the ring width
        const pos = g.attributes.position;
        const uv = g.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), z = pos.getZ(i);
          const r = Math.hypot(x, z);
          const k = 0.3 + 0.7 * ((r - inner) / (outer - inner));
          uv.setXY(i, 0.5 + (x / r) * k * 0.5, 0.5 + (z / r) * k * 0.5);
        }
        return g;
      };
      const disc = (r: number) => {
        const g = new THREE.CircleGeometry(r, 64);
        g.rotateX(-Math.PI / 2);
        return g;
      };
      if (p.kind === 'drum') {
        add(fills, disc(p.radius), fill, p.surface, new THREE.Vector3(0, 0.005, 0));
        add(halos, ring(p.rim - 0.002, p.rim + 0.07), halo, p.surface, new THREE.Vector3(0, 0.014, 0));
      } else if (p.kind === 'cymbal') {
        // same shape as the cymbal so the light sits right on the bronze
        add(fills, p.cymbal!.disc.geometry, fill, p.cymbal!.disc);
        if (p.id === 'hihat') add(fills, kit.hihatBottom.disc.geometry, fill, kit.hihatBottom.disc);
        add(halos, ring(p.radius - 0.004, p.radius + 0.075), halo, p.surface, new THREE.Vector3(0, -p.cymbal!.edgeDrop, 0));
      } else if (p.id === 'kick') {
        add(fills, disc(p.radius), fill, p.surface, new THREE.Vector3(0, 0.012, 0));
        add(fills, disc(0.15), fill, kit.root, new THREE.Vector3(0.03, 0.016, 0.17));
        add(halos, ring(0.15, 0.24), halo, kit.root, new THREE.Vector3(0.03, 0.017, 0.17));
      } else if (p.id === 'hhpedal') {
        add(fills, disc(0.12), fill, p.surface, new THREE.Vector3(0, 0.012, -0.13));
        add(halos, ring(0.12, 0.2), halo, p.surface, new THREE.Vector3(0, 0.013, -0.13));
      }
      this.lamps.set(p.id, { fills, halos, fill, halo, level: 0, flash: 0, flashColor: HIT.clone() });
    }
  }

  /** Burst on the hit piece (called with the coach's judgement). */
  judged(piece: PieceId, grade: Grade): void {
    const l = this.lamps.get(piece);
    if (!l || !this.enabled) return;
    l.flash = 1;
    l.flashColor.copy(grade === 'miss' ? MISS : HIT);
  }

  clear(): void {
    for (const l of this.lamps.values()) {
      l.level = 0;
      l.flash = 0;
      l.fill.opacity = l.halo.opacity = 0;
      for (const m of [...l.fills, ...l.halos]) m.visible = false;
    }
  }

  update(coach: Coach, dt: number): void {
    const active = this.enabled && coach.running && !!coach.lesson;
    const pos = coach.songPos;
    const beat = coach.stepDur() * 4;
    const target = new Map<PieceId, number>();
    if (active) {
      const lastOnPiece = new Map<PieceId, number>();
      for (const n of coach.notes) {
        const prev = lastOnPiece.get(n.piece);
        lastOnPiece.set(n.piece, n.time);
        if (n.state !== 'pending') continue;
        const dtNote = n.time - pos;
        if (dtNote > beat * 1.1) continue;
        // the lead-in never overlaps the previous note on the same drum, so fast notes pulse
        const gap = prev === undefined ? beat : n.time - prev;
        const lead = Math.max(0.08, Math.min(beat * 0.95, gap * 0.8));
        const k = dtNote <= 0 ? 1 : Math.max(0, 1 - dtNote / lead);
        target.set(n.piece, Math.max(target.get(n.piece) ?? 0, k * k));
      }
    }
    const t = performance.now() / 1000;
    for (const [id, l] of this.lamps) {
      const goal = target.get(id) ?? 0;
      // rise fast, fall a bit slower, like a real lamp
      l.level += (goal - l.level) * Math.min(1, dt * (goal > l.level ? 32 : 11));
      l.flash = Math.max(0, l.flash - dt * 4);
      const pulse = goal >= 0.999 ? 0.5 + 0.5 * Math.sin(t * 12) : 1;
      const glow = l.level;
      const on = glow > 0.01 || l.flash > 0.01;
      for (const m of [...l.fills, ...l.halos]) m.visible = on;
      if (!on) continue;
      this.col.copy(GLOW).lerp(l.flashColor, l.flash);
      l.fill.color.copy(this.col);
      l.fill.opacity = Math.min(0.92, glow * (0.78 + 0.14 * pulse) + l.flash * 0.9);
      // HDR halo so the bloom pass turns it into real light
      l.halo.color.copy(this.col).multiplyScalar(1.5 + glow * 4 * (0.75 + 0.25 * pulse) + l.flash * 5);
      l.halo.opacity = Math.min(1, glow + l.flash);
      const grow = 1 + l.flash * 0.18;
      for (const h of l.halos) h.scale.setScalar(grow);
    }
  }
}
