import * as THREE from 'three';

/** Seeded PRNG (mulberry32) so procedural textures look the same on every device. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable 2D value noise. */
export class Noise2 {
  private readonly grid: Float32Array;
  constructor(seed: number, private readonly px: number, private readonly py: number = px) {
    const r = rng(seed);
    this.grid = new Float32Array(px * py);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = r();
  }
  sample(x: number, y: number): number {
    const { px, py, grid } = this;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = grid[y0 * px + x0], b = grid[y0 * px + x1];
    const c = grid[y1 * px + x0], d = grid[y1 * px + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  /** Fractal sum, each octave doubles the frequency (period stays tileable). */
  fbm(x: number, y: number, octaves = 4): number {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.sample(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return [c, ctx];
}

export interface TexOpts {
  srgb?: boolean;
  repeat?: [number, number];
  wrap?: boolean;
}

export function toTexture(source: HTMLCanvasElement, opts: TexOpts = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(source);
  t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (opts.wrap || opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Converts a height field into a tangent-space normal map canvas. */
export function heightToNormal(h: Float32Array, w: number, hgt: number, strength: number, wrap = true): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, hgt);
  const img = ctx.createImageData(w, hgt);
  const d = img.data;
  const at = (x: number, y: number) => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + hgt) % hgt;
    } else {
      x = Math.min(w - 1, Math.max(0, x));
      y = Math.min(hgt - 1, Math.max(0, y));
    }
    return h[y * w + x];
  };
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      // canvas rows grow downward while texture V grows upward
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      d[i] = (-dx / len * 0.5 + 0.5) * 255;
      d[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ────────────────────────────────────────────────────────────── shell finishes

export type FinishId = 'cereza' | 'negro' | 'plata' | 'natural';

export interface ShellMaps {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
}

/**
 * Lacquered maple veneer wrapped around a shell: U runs around the circumference,
 * V runs along the shell depth. Grain runs around the drum with flame figure across it.
 */
export function woodVeneer(kind: 'cherry' | 'natural', seed = 7): ShellMaps {
  const W = 2048, H = 512;
  const [c, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const n = new Noise2(seed, 64, 16);
  const n2 = new Noise2(seed + 11, 32, 8);
  const flame = new Noise2(seed + 3, 128, 4);
  const height = new Float32Array(W * H);
  const light = kind === 'cherry' ? [150, 36, 26] : [226, 170, 104];
  const dark = kind === 'cherry' ? [70, 12, 10] : [168, 108, 58];
  for (let y = 0; y < H; y++) {
    const v = y / H;
    // sunburst: the finish darkens toward both bearing edges
    const edge = Math.min(v, 1 - v) * 2;
    const burst = kind === 'cherry' ? 0.35 + 0.65 * Math.pow(Math.min(1, edge * 1.6), 0.7) : 1;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const warp = n.fbm(u * 64, v * 16, 4) * 6;
      const t = v * 38 + warp;
      const ring = Math.pow(Math.abs(Math.sin(t * Math.PI)), 6);
      const fine = n2.fbm(u * 32 * 8, v * 8 * 2, 2);
      const fl = 0.5 + 0.5 * Math.sin(u * 190 + flame.fbm(u * 128, v * 4, 3) * 9);
      let k = 0.62 + 0.25 * fl + 0.13 * fine - 0.38 * ring;
      k *= burst;
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) img.data[i + ch] = clamp255(dark[ch] + (light[ch] - dark[ch]) * k);
      img.data[i + 3] = 255;
      height[y * W + x] = -ring * 0.3 + fine * 0.2;
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    map: toTexture(c, { srgb: true, wrap: true }),
    normalMap: toTexture(heightToNormal(height, W, H, 1.2), { wrap: true }),
  };
}

/** Metal-flake sparkle under clearcoat: a normal map of randomly tilted flakes. */
export function sparkleFlakes(seed = 21): THREE.Texture {
  const S = 512, cell = 5;
  const r = rng(seed);
  const cells = Math.ceil(S / cell);
  const pts: { x: number; y: number; nx: number; ny: number }[] = [];
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const a = r() * Math.PI * 2, tilt = Math.pow(r(), 0.8) * 0.8;
      pts.push({ x: (cx + r()) * cell, y: (cy + r()) * cell, nx: Math.cos(a) * tilt, ny: Math.sin(a) * tilt });
    }
  }
  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      let best = 1e9, bi = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cx = (gx + ox + cells) % cells, cy = (gy + oy + cells) % cells;
          const p = pts[cy * cells + cx];
          let dx = p.x - x, dy = p.y - y;
          if (dx > S / 2) dx -= S; else if (dx < -S / 2) dx += S;
          if (dy > S / 2) dy -= S; else if (dy < -S / 2) dy += S;
          const dd = dx * dx + dy * dy;
          if (dd < best) { best = dd; bi = cy * cells + cx; }
        }
      }
      const p = pts[bi];
      const nz = Math.sqrt(Math.max(0, 1 - p.nx * p.nx - p.ny * p.ny));
      const i = (y * S + x) * 4;
      img.data[i] = (p.nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (p.ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { repeat: [14, 2.5] });
}

/** Very faint orange-peel for solid lacquer, so reflections are not CG-perfect. */
export function orangePeel(seed = 5): THREE.Texture {
  const S = 256;
  const n = new Noise2(seed, 32);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = n.fbm((x / S) * 32, (y / S) * 32, 3);
  return toTexture(heightToNormal(h, S, S, 0.6), { repeat: [10, 2] });
}

// ────────────────────────────────────────────────────────────── drum heads

export interface HeadMaps {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
}

let headNormalCache: THREE.Texture | null = null;

function headNormal(): THREE.Texture {
  if (headNormalCache) return headNormalCache;
  const S = 512;
  const n = new Noise2(91, 128);
  const r = rng(4);
  const h = new Float32Array(S * S);
  for (let i = 0; i < h.length; i++) h[i] = r() * 0.5;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] += n.fbm((x / S) * 128, (y / S) * 128, 2);
  headNormalCache = toTexture(heightToNormal(h, S, S, 0.9), { repeat: [3, 3] });
  return headNormalCache;
}

/**
 * Coated (sanded white) batter head, mapped planar over the disc (UV 0..1 across the diameter).
 * The logo sits on the drummer's side so it reads from the throne.
 */
export function coatedHead(label: string, seed = 1, displayFont = 'sans-serif'): HeadMaps {
  const S = 1024;
  const [c, ctx] = makeCanvas(S, S);
  const n = new Noise2(seed, 16);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const k = n.fbm((x / S) * 16, (y / S) * 16, 4);
      const dx = x / S - 0.5, dy = y / S - 0.5;
      const rr = Math.sqrt(dx * dx + dy * dy) * 2;
      // stick wear: a slightly greyer, smoother patch around the sweet spot
      const wear = Math.exp(-((dx + 0.02) ** 2 + (dy - 0.06) ** 2) / 0.012) * 0.07;
      const base = 204 - k * 16 - wear * 80 - Math.max(0, rr - 0.9) * 140;
      const i = (y * S + x) * 4;
      img.data[i] = clamp255(base);
      img.data[i + 1] = clamp255(base - 2);
      img.data[i + 2] = clamp255(base - 7);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // stick marks: little grey dents clustered around the sweet spot
  const marks = rng(seed * 13 + 5);
  for (let i = 0; i < 70; i++) {
    const a = marks() * Math.PI * 2, d = Math.pow(marks(), 0.7) * S * 0.16;
    const mx = S * 0.49 + Math.cos(a) * d, my = S * 0.44 + Math.sin(a) * d * 0.9;
    ctx.fillStyle = `rgba(90,86,80,${0.06 + marks() * 0.12})`;
    ctx.beginPath();
    ctx.ellipse(mx, my, 3 + marks() * 5, 1.5 + marks() * 2.5, marks() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // printed logo near the drummer-side edge (+V is away from the drummer after mapping)
  ctx.save();
  ctx.translate(S / 2, S * 0.83);
  ctx.fillStyle = 'rgba(38,36,34,0.82)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${S * 0.052}px ${displayFont}`;
  ctx.fillText('Tarima', 0, 0);
  ctx.font = `500 ${S * 0.02}px ${displayFont}`;
  ctx.fillStyle = 'rgba(38,36,34,0.7)';
  ctx.fillText(label, 0, S * 0.045);
  ctx.restore();

  const [rc, rctx] = makeCanvas(256, 256);
  const rimg = rctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const dx = x / 256 - 0.5, dy = y / 256 - 0.5;
      const wear = Math.exp(-((dx + 0.02) ** 2 + (dy - 0.06) ** 2) / 0.012);
      const v = 0.78 - wear * 0.22 + n.sample((x / 256) * 16, (y / 256) * 16) * 0.08;
      const i = (y * 256 + x) * 4;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = v * 255;
      rimg.data[i + 3] = 255;
    }
  }
  rctx.putImageData(rimg, 0, 0);
  return { map: toTexture(c, { srgb: true }), roughnessMap: toTexture(rc), normalMap: headNormal() };
}

/** Front (resonant) bass drum head: black, with the wordmark and a port hole in the alpha. */
export function kickResoHead(displayFont: string): { map: THREE.Texture; alphaMap: THREE.Texture } {
  const S = 1024;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S * 0.45, S * 0.4, S * 0.05, S / 2, S / 2, S * 0.55);
  g.addColorStop(0, '#1d1c1b');
  g.addColorStop(1, '#0c0b0b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d9b36a';
  ctx.font = `700 ${S * 0.13}px ${displayFont}`;
  ctx.fillText('Tarima', S / 2, S * 0.47);
  ctx.strokeStyle = '#d9b36a';
  ctx.lineWidth = S * 0.006;
  ctx.beginPath();
  ctx.moveTo(S * 0.27, S * 0.56);
  ctx.lineTo(S * 0.73, S * 0.56);
  ctx.stroke();
  ctx.font = `500 ${S * 0.03}px ${displayFont}`;
  ctx.fillText('Serie Estudio · Arce', S / 2, S * 0.6);
  const [a, actx] = makeCanvas(256, 256);
  actx.fillStyle = '#fff';
  actx.fillRect(0, 0, 256, 256);
  actx.fillStyle = '#000';
  actx.beginPath();
  actx.arc(256 * 0.71, 256 * 0.7, 256 * 0.1, 0, Math.PI * 2);
  actx.fill();
  return { map: toTexture(c, { srgb: true }), alphaMap: toTexture(a) };
}

// ────────────────────────────────────────────────────────────── cymbals

export interface CymbalShared {
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  anisotropyMap: THREE.Texture;
}

/**
 * Lathe grooves, tonal rings and hammer dimples in planar UV space (disc spans 0..1).
 * The anisotropy map stores the circular brushing direction per texel so highlights
 * streak around the cymbal the way real lathed bronze does.
 */
export function cymbalShared(): CymbalShared {
  const S = 1024;
  const h = new Float32Array(S * S);
  const r = rng(77);
  const ring = new Noise2(12, 256, 4);
  const dimples: { x: number; y: number; s: number; d: number }[] = [];
  for (let i = 0; i < 900; i++) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 0.5;
    dimples.push({ x: 0.5 + Math.cos(a) * rad, y: 0.5 + Math.sin(a) * rad, s: 0.006 + r() * 0.01, d: 0.4 + r() * 0.6 });
  }
  // bucket dimples on a coarse grid for speed
  const G = 32;
  const buckets: number[][] = Array.from({ length: G * G }, () => []);
  dimples.forEach((dm, i) => {
    const gx = Math.floor(dm.x * G), gy = Math.floor(dm.y * G);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const bx = gx + ox, by = gy + oy;
      if (bx >= 0 && by >= 0 && bx < G && by < G) buckets[by * G + bx].push(i);
    }
  });
  const [rc, rctx] = makeCanvas(S, S);
  const rimg = rctx.createImageData(S, S);
  const [ac, actx] = makeCanvas(S, S);
  const aimg = actx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = 1 - y / S;
      const dx = u - 0.5, dy = v - 0.5;
      const rad = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);
      const groove = Math.sin(rad * S * Math.PI * 0.55);
      let dimple = 0;
      const b = buckets[Math.min(G - 1, Math.floor(u * G)) + Math.min(G - 1, Math.floor(v * G)) * G];
      for (const di of b) {
        const dm = dimples[di];
        const ex = u - dm.x, ey = v - dm.y;
        const dd = (ex * ex + ey * ey) / (dm.s * dm.s);
        if (dd < 4) dimple -= Math.exp(-dd * 1.5) * dm.d;
      }
      h[y * S + x] = groove * 0.35 + dimple * 1.4;
      const tonal = ring.fbm(rad * 256 * 2, (ang / (Math.PI * 2) + 0.5) * 4, 3);
      const i = (y * S + x) * 4;
      const rough = 0.2 + tonal * 0.16 + Math.max(0, -dimple) * 0.05;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = clamp255(rough * 255);
      rimg.data[i + 3] = 255;
      const tx = rad > 1e-4 ? -dy / rad : 1, ty = rad > 1e-4 ? dx / rad : 0;
      aimg.data[i] = (tx * 0.5 + 0.5) * 255;
      aimg.data[i + 1] = (ty * 0.5 + 0.5) * 255;
      aimg.data[i + 2] = 0.85 * 255;
      aimg.data[i + 3] = 255;
    }
  }
  rctx.putImageData(rimg, 0, 0);
  actx.putImageData(aimg, 0, 0);
  const aniso = toTexture(ac);
  aniso.generateMipmaps = false;
  aniso.minFilter = THREE.LinearFilter;
  return {
    normalMap: toTexture(heightToNormal(h, S, S, 2.2, false)),
    roughnessMap: toTexture(rc),
    anisotropyMap: aniso,
  };
}

/** Per-cymbal color: bronze with tonal rings, faint patina and the printed logo. */
export function cymbalColor(model: string, size: string, displayFont: string, seed: number, brilliant = false): THREE.Texture {
  const S = 1024;
  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const ring = new Noise2(seed, 256, 4);
  const patina = new Noise2(seed + 5, 8);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = 1 - y / S;
      const dx = u - 0.5, dy = v - 0.5;
      const rad = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5;
      const tonal = ring.fbm(rad * 512, ang * 4, 3);
      const p = patina.fbm(u * 8, v * 8, 4);
      const pat = brilliant ? 0 : Math.max(0, p - 0.55) * 0.9;
      const k = (brilliant ? 1.0 : 0.9) + tonal * 0.18 - pat;
      const i = (y * S + x) * 4;
      img.data[i] = clamp255(214 * k);
      img.data[i + 1] = clamp255(160 * k - pat * 20);
      img.data[i + 2] = clamp255(92 * k - pat * 16);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // logo printed on the bow, reading from the drummer's seat
  ctx.save();
  ctx.translate(S / 2, S * 0.74);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(22,16,10,0.85)';
  ctx.font = `700 ${S * 0.05}px ${displayFont}`;
  ctx.fillText('Tarima', 0, 0);
  ctx.font = `600 ${S * 0.026}px ${displayFont}`;
  ctx.fillText(`${size} ${model}`, 0, S * 0.045);
  ctx.font = `500 ${S * 0.016}px ${displayFont}`;
  ctx.fillText('Bronce B20 · Martillado a mano', 0, S * 0.078);
  ctx.restore();
  return toTexture(c, { srgb: true });
}

// ────────────────────────────────────────────────────────────── room

/** Dark stained stage floor boards, 1 texture repeat = 2 m. */
export function stageFloor(): { map: THREE.Texture; roughnessMap: THREE.Texture; normalMap: THREE.Texture } {
  const W = 1024, H = 1024, planks = 16;
  const [c, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const h = new Float32Array(W * H);
  const [rc, rctx] = makeCanvas(W, H);
  const rimg = rctx.createImageData(W, H);
  const n = new Noise2(33, 8, 128);
  const r = rng(8);
  const tones = Array.from({ length: planks }, () => 0.75 + r() * 0.35);
  const offsets = Array.from({ length: planks }, () => r());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pw = W / planks;
      const pi = Math.floor(x / pw);
      const px = x - pi * pw;
      const seamV = Math.min(px, pw - px) < 1.5 ? 1 : 0;
      const yy = (y / H + offsets[pi]) % 1;
      const seamH = Math.abs(yy - 0.5) * H < 1.2 ? 1 : 0;
      const grain = n.fbm((x / W) * 8 + pi * 0.37, (y / H) * 128, 3);
      const k = tones[pi] * (0.7 + grain * 0.5);
      const i = (y * W + x) * 4;
      const seam = Math.max(seamV, seamH);
      img.data[i] = clamp255(46 * k * (1 - seam * 0.7));
      img.data[i + 1] = clamp255(32 * k * (1 - seam * 0.7));
      img.data[i + 2] = clamp255(24 * k * (1 - seam * 0.7));
      img.data[i + 3] = 255;
      h[y * W + x] = grain * 0.4 - seam;
      const rough = 0.42 + grain * 0.2 + seam * 0.3;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = clamp255(rough * 255);
      rimg.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return {
    map: toTexture(c, { srgb: true, repeat: [3, 3] }),
    roughnessMap: toTexture(rc, { repeat: [3, 3] }),
    normalMap: toTexture(heightToNormal(h, W, H, 1.5), { repeat: [3, 3] }),
  };
}

/** Hand-knotted style drum rug: border bands, a central medallion and wool texture. */
export function drumRug(): { map: THREE.Texture; normalMap: THREE.Texture } {
  const W = 2048, H = 1536;
  const [c, ctx] = makeCanvas(W, H);
  const red = '#5a1917', navy = '#161d33', ivory = '#ad9d7c', gold = '#86642e', rust = '#6f351d', ink = '#121117';
  ctx.fillStyle = red;
  ctx.fillRect(0, 0, W, H);
  // border bands
  const band = (inset: number, width: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(inset, inset, W - inset * 2, width);
    ctx.fillRect(inset, H - inset - width, W - inset * 2, width);
    ctx.fillRect(inset, inset, width, H - inset * 2);
    ctx.fillRect(W - inset - width, inset, width, H - inset * 2);
  };
  band(0, 26, ink);
  band(26, 150, navy);
  band(176, 14, ivory);
  band(190, 10, gold);
  // repeating motifs on the navy border
  const motif = (x: number, y: number, s: number, rot: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = rust;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const rr = k % 2 ? s * 0.45 : s;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ivory;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = gold;
    ctx.fillRect(-s * 0.08, -s * 0.8, s * 0.16, s * 1.6);
    ctx.restore();
  };
  for (let x = 120; x < W - 60; x += 130) {
    motif(x, 101, 46, 0);
    motif(x, H - 101, 46, 0);
  }
  for (let y = 230; y < H - 150; y += 130) {
    motif(101, y, 46, Math.PI / 2);
    motif(W - 101, y, 46, Math.PI / 2);
  }
  // field lattice
  ctx.globalAlpha = 0.55;
  for (let y = 260; y < H - 240; y += 90) {
    for (let x = 260 + ((y / 90) % 2) * 45; x < W - 240; x += 90) {
      ctx.fillStyle = (x + y) % 180 === 0 ? navy : rust;
      ctx.beginPath();
      ctx.moveTo(x, y - 16);
      ctx.lineTo(x + 12, y);
      ctx.lineTo(x, y + 16);
      ctx.lineTo(x - 12, y);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  // medallion
  ctx.save();
  ctx.translate(W / 2, H / 2);
  const rings: [number, string][] = [[360, navy], [330, ivory], [312, rust], [250, navy], [200, gold], [150, red], [90, ivory], [40, navy]];
  for (const [rr, col] of rings) {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const scallop = 1 + 0.08 * Math.cos(a * 16);
      ctx.lineTo(Math.cos(a) * rr * 1.35 * scallop, Math.sin(a) * rr * scallop);
    }
    ctx.closePath();
    ctx.fill();
  }
  for (let k = 0; k < 16; k++) {
    ctx.save();
    ctx.rotate((k / 16) * Math.PI * 2);
    ctx.fillStyle = k % 2 ? ivory : gold;
    ctx.beginPath();
    ctx.ellipse(170, 0, 38, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  // wool: per-pixel variation, abrash (row tone drift) and wear
  const img = ctx.getImageData(0, 0, W, H);
  const n = new Noise2(55, 64, 48);
  const abrash = new Noise2(56, 4, 96);
  const r = rng(9);
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const fiber = r();
      const k = 0.62 + n.fbm((x / W) * 64, (y / H) * 48, 3) * 0.2 + abrash.sample((x / W) * 4, (y / H) * 96) * 0.1 + fiber * 0.08;
      img.data[i] = clamp255(img.data[i] * k);
      img.data[i + 1] = clamp255(img.data[i + 1] * k);
      img.data[i + 2] = clamp255(img.data[i + 2] * k);
      hgt[y * W + x] = fiber * 0.6 + ((x + y) % 3 === 0 ? 0.2 : 0);
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = toTexture(c, { srgb: true });
  // reduce normal-map resolution: wool detail only needs a coarse tile
  const NS = 512;
  const small = new Float32Array(NS * NS);
  for (let y = 0; y < NS; y++) for (let x = 0; x < NS; x++) small[y * NS + x] = hgt[y * 3 * W + x * 3] ?? 0;
  return { map, normalMap: toTexture(heightToNormal(small, NS, NS, 1.1), { repeat: [4, 3] }) };
}
