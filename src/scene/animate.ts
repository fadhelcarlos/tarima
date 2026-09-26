import * as THREE from 'three';
import type { Zone } from '../audio/engine';
import type { Kit, Piece, PieceId } from './kit';

/** Damped spring integrated with sub-steps (stable at 20 fps on a busy phone). */
class Spring {
  x = 0;
  v = 0;
  constructor(public omega: number, public zeta: number, public target = 0) {
    this.x = target;
  }
  step(dt: number): void {
    const k = this.omega * this.omega, c = 2 * this.zeta * this.omega;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-k * (this.x - this.target) - c * this.v) * h;
      this.x += this.v * h;
    }
  }
  get active(): boolean {
    return Math.abs(this.v) > 1e-5 || Math.abs(this.x - this.target) > 1e-5;
  }
}

const MAX_IMPACTS = 4;

interface Membrane {
  time: { value: number };
  imp: { value: THREE.Vector4[] };
  next: number;
}

/** Adds a travelling-ripple displacement to a drum head (per-material uniforms, shared program). */
function membrane(mat: THREE.MeshPhysicalMaterial, radius: number): Membrane {
  const m: Membrane = {
    time: { value: 0 },
    imp: { value: Array.from({ length: MAX_IMPACTS }, () => new THREE.Vector4(0, 0, -10, 0)) },
    next: 0,
  };
  const r = { value: radius };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = m.time;
    shader.uniforms.uImp = m.imp;
    shader.uniforms.uR = r;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uR;
uniform vec4 uImp[${MAX_IMPACTS}];
float headDisp(vec2 p) {
  float rho = clamp(length(p) / uR, 0.0, 1.0);
  float edge = 1.0 - pow(rho, 6.0);
  float d = 0.0;
  for (int i = 0; i < ${MAX_IMPACTS}; i++) {
    vec4 im = uImp[i];
    float t = uTime - im.z;
    if (im.w <= 0.0 || t < 0.0 || t > 1.4) continue;
    vec2 dv = p - im.xy;
    float r2 = dot(dv, dv);
    float r = sqrt(r2);
    float dent = -exp(-t * 34.0) * exp(-r2 / 0.0012);
    float breathe = (1.0 - rho * rho) * cos(t * 78.0) * exp(-t * 8.0) * 0.5;
    float front = r - t * 0.85;
    float ripple = sin(front * 110.0) * exp(-front * front * 200.0) * exp(-t * 4.5) * 0.8;
    d += im.w * (dent + breathe + ripple);
  }
  return d * edge;
}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `float hd0 = headDisp(position.xz);
float hdx = headDisp(position.xz + vec2(0.003, 0.0));
float hdz = headDisp(position.xz + vec2(0.0, 0.003));
vec3 objectNormal = normalize(vec3(-(hdx - hd0) / 0.003, 1.0, -(hdz - hd0) / 0.003));
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3( position );
transformed.y += hd0;
#ifdef USE_ALPHAHASH
vPosition = vec3( position );
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'membrane-v1';
  mat.needsUpdate = true;
  return m;
}

interface Flex {
  time: { value: number };
  flex: { value: THREE.Vector4 };
}

/** Bending waves across a cymbal right after a strike. */
function cymbalFlex(mat: THREE.MeshPhysicalMaterial, radius: number): Flex {
  const f: Flex = { time: { value: 0 }, flex: { value: new THREE.Vector4(0, -10, 0, 0) } };
  const r = { value: radius };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = f.time;
    shader.uniforms.uFlex = f.flex;
    shader.uniforms.uR = r;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uR;
uniform vec4 uFlex;
float flexDisp(vec2 p) {
  float t = uTime - uFlex.y;
  if (uFlex.x <= 0.0 || t < 0.0 || t > 2.5) return 0.0;
  float rr = length(p) / uR;
  float th = atan(p.y, p.x);
  float env = exp(-t * 3.2);
  return uFlex.x * env * rr * rr * (sin(2.0 * th + uFlex.z) * sin(t * 44.0) + 0.45 * sin(3.0 * th - uFlex.z * 1.7) * sin(t * 71.0));
}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `float fd0 = flexDisp(position.xz);
float fdx = flexDisp(position.xz + vec2(0.004, 0.0));
float fdz = flexDisp(position.xz + vec2(0.0, 0.004));
vec3 objectNormal = normalize(vec3(normal) + vec3(-(fdx - fd0) / 0.004, 0.0, -(fdz - fd0) / 0.004) * sign(normal.y));
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3( position );
transformed.y += fd0;
#ifdef USE_ALPHAHASH
vPosition = vec3( position );
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'cymbal-flex-v1';
  mat.needsUpdate = true;
  return f;
}

interface DrumAnim {
  piece: Piece;
  membrane: Membrane;
  y: Spring;
  rx: Spring;
  rz: Spring;
  bounce: number;
}

interface CymbalAnim {
  piece: Piece;
  flex: Flex;
  ax: Spring;
  az: Spring;
  spin: number;
  spinV: number;
  kick: number;
  grabUntil: number;
  omega: number;
  zeta: number;
}

/** Everything that moves when you play: heads ripple, toms bounce, cymbals swing, pedals travel. */
export class KitAnimator {
  private readonly drums = new Map<PieceId, DrumAnim>();
  private readonly cymbals = new Map<PieceId, CymbalAnim>();
  private readonly beater: Spring;
  private readonly kickBoard = new Spring(2 * Math.PI * 5, 0.7, 0.22);
  private readonly hhBoard = new Spring(2 * Math.PI * 5, 0.7, 0.16);
  private readonly hhGap = new Spring(2 * Math.PI * 9, 0.85, 0);
  private readonly kickMembrane: Membrane;
  readonly thump = new Spring(2 * Math.PI * 7, 0.5, 0);
  hhOpen = false;
  private time = 0;
  private strikeAngle: number;

  constructor(private readonly kit: Kit) {
    const bounce: Partial<Record<PieceId, number>> = { tom1: 1, tom2: 1, snare: 0.35, floor: 0.45 };
    for (const id of ['snare', 'tom1', 'tom2', 'floor'] as PieceId[]) {
      const p = kit.pieces.get(id)!;
      this.drums.set(id, {
        piece: p,
        membrane: membrane(p.drum!.head.material as THREE.MeshPhysicalMaterial, p.radius),
        y: new Spring(2 * Math.PI * 7, 0.22),
        rx: new Spring(2 * Math.PI * 5, 0.2),
        rz: new Spring(2 * Math.PI * 5, 0.2),
        bounce: bounce[id] ?? 0.5,
      });
    }
    const kick = kit.pieces.get('kick')!;
    this.kickMembrane = membrane(kick.drum!.head.material as THREE.MeshPhysicalMaterial, kick.radius);
    const cfg: Partial<Record<PieceId, [number, number, number]>> = {
      crash: [1.7, 0.06, 1.25],
      crash2: [1.5, 0.06, 1.15],
      ride: [1.25, 0.05, 0.7],
      hihat: [6, 0.35, 0.18],
    };
    for (const id of ['crash', 'crash2', 'ride', 'hihat'] as PieceId[]) {
      const p = kit.pieces.get(id)!;
      const [hz, zeta, kickAmt] = cfg[id]!;
      const omega = 2 * Math.PI * hz;
      this.cymbals.set(id, {
        piece: p,
        flex: cymbalFlex(p.cymbal!.material, p.radius),
        ax: new Spring(omega, zeta),
        az: new Spring(omega, zeta),
        spin: 0,
        spinV: 0,
        kick: kickAmt,
        grabUntil: 0,
        omega,
        zeta,
      });
    }
    // bottom hi-hat cymbal shares the flex look
    cymbalFlex(kit.hihatBottom.material, kit.hihatBottom.radius);
    const pedal = kit.pedal;
    this.beater = new Spring(2 * Math.PI * 4.2, 0.55, pedal.restAngle);
    const shaft = (kit.pieces.get('kick')!.drum!.root.position.y + 0.03) - pedal.beater.position.y;
    this.strikeAngle = Math.asin(THREE.MathUtils.clamp(-0.037 / shaft, -1, 1));
    this.setHiHat(false, true);
  }

  private setHiHat(open: boolean, instant = false): void {
    this.hhOpen = open;
    this.hhGap.target = open ? 0.017 : 0;
    // closed hats = foot down on the pedal
    this.hhBoard.target = open ? 0.16 : 0.05;
    if (instant) {
      this.hhGap.x = this.hhGap.target;
      this.hhGap.v = 0;
    }
    const hh = this.cymbals.get('hihat')!;
    const hz = open ? 2.6 : 6;
    hh.omega = 2 * Math.PI * hz;
    hh.zeta = open ? 0.1 : 0.35;
    hh.ax.omega = hh.az.omega = hh.omega;
    hh.ax.zeta = hh.az.zeta = hh.zeta;
    hh.kick = open ? 0.55 : 0.18;
  }

  /** `local` is the hit point in the piece's surface frame; `velocity` 0..1. */
  strike(id: PieceId, zone: Zone, local: THREE.Vector3, velocity: number): void {
    const v = velocity;
    if (id === 'kick') {
      this.beater.x = this.strikeAngle;
      this.beater.v = 9 * v;
      this.kickBoard.x = 0.05;
      this.kickBoard.v = 0;
      this.pushImpact(this.kickMembrane, 0, -0.03, 0.009 * v);
      this.thump.v -= 0.05 * v;
      return;
    }
    if (id === 'hhpedal') {
      this.hhBoard.x = 0.15;
      this.hhBoard.v = -2;
      this.setHiHat(false);
      const hh = this.cymbals.get('hihat')!;
      hh.ax.v += 0.08;
      return;
    }
    const d = this.drums.get(id);
    if (d) {
      const R = d.piece.radius;
      const amp = zone === 'rim' ? 0.004 : 0.0075;
      this.pushImpact(d.membrane, local.x, local.z, amp * v);
      d.y.v -= 0.2 * v * d.bounce;
      d.rx.v += (local.z / R) * 0.7 * v * d.bounce;
      d.rz.v -= (local.x / R) * 0.7 * v * d.bounce;
      return;
    }
    const c = this.cymbals.get(id);
    if (c) {
      if (id === 'hihat') this.setHiHat(zone === 'open' || zone === 'half');
      const R = c.piece.radius;
      const k = c.kick * v * (0.4 + 0.6 * Math.min(1, Math.hypot(local.x, local.z) / R));
      // push the struck side down, with a little sideways component so the swing precesses
      c.ax.v += (local.z / R) * k + (local.x / R) * k * 0.25;
      c.az.v += -(local.x / R) * k + (local.z / R) * k * 0.25;
      c.spinV += (Math.random() - 0.5) * 0.9 * v;
      const bell = zone === 'bell';
      c.flex.flex.value.set((bell ? 0.0012 : 0.0035) * v * (id === 'hihat' && !this.hhOpen ? 0.2 : 1), this.time, Math.random() * 6.28, 0);
    }
  }

  /** Hand on the cymbal: stop the swing. */
  grab(id: PieceId): void {
    const c = this.cymbals.get(id);
    if (!c) return;
    c.grabUntil = this.time + 0.35;
    c.flex.flex.value.x *= 0.2;
  }

  private pushImpact(m: Membrane, x: number, z: number, amp: number): void {
    m.imp.value[m.next].set(x, z, this.time, amp);
    m.next = (m.next + 1) % MAX_IMPACTS;
  }

  update(dt: number): void {
    this.time += dt;
    for (const d of this.drums.values()) {
      d.membrane.time.value = this.time;
      d.y.step(dt);
      d.rx.step(dt);
      d.rz.step(dt);
      const body = d.piece.drum!.body;
      body.position.y = d.y.x;
      body.rotation.x = d.rx.x;
      body.rotation.z = d.rz.x;
    }
    this.kickMembrane.time.value = this.time;
    for (const [id, c] of this.cymbals) {
      c.flex.time.value = this.time;
      const grabbing = this.time < c.grabUntil;
      c.ax.zeta = c.az.zeta = grabbing ? 1.2 : c.zeta;
      c.ax.step(dt);
      c.az.step(dt);
      c.spinV *= Math.exp(-dt * (grabbing ? 8 : 0.4));
      c.spin += c.spinV * dt;
      const lim = id === 'hihat' ? 0.12 : 0.3;
      const w = c.piece.cymbal!.wobble;
      w.rotation.set(THREE.MathUtils.clamp(c.ax.x, -lim, lim), c.spin, THREE.MathUtils.clamp(c.az.x, -lim, lim));
    }
    // hi-hat top travels with the clutch; bottom hat stays on the stand
    this.hhGap.step(dt);
    const top = this.kit.hihatTop.seat;
    top.position.y = this.kit.hihatClosedY + Math.max(0, this.hhGap.x);
    this.beater.step(dt);
    this.kit.pedal.beater.rotation.x = Math.max(this.strikeAngle, this.beater.x);
    this.kickBoard.step(dt);
    (this.kit.pedal.footboard.children[0] as THREE.Object3D).rotation.x = this.kickBoard.x;
    this.hhBoard.step(dt);
    (this.kit.hihat.footboard.children[0] as THREE.Object3D).rotation.x = this.hhBoard.x;
    this.thump.step(dt);
  }
}
