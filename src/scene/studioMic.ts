import * as THREE from 'three';
import { lathe, merge, mesh, tube } from './parts/geo';
import type { MaterialLibrary } from './materials';
import { makeCanvas, Noise2, toTexture } from './textures';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Woven wire mesh: alpha (holes) + normal (round wires, over/under). */
function wireMesh(cells: number, wire: number): { alpha: THREE.Texture; normal: THREE.Texture } {
  const S = 512, c = S / cells;
  const [ac, actx] = makeCanvas(S, S);
  actx.fillStyle = '#000';
  actx.fillRect(0, 0, S, S);
  actx.fillStyle = '#fff';
  for (let i = 0; i < cells; i++) {
    actx.fillRect(i * c + c / 2 - wire / 2, 0, wire, S);
    actx.fillRect(0, i * c + c / 2 - wire / 2, S, wire);
  }
  const [nc, nctx] = makeCanvas(S, S);
  const img = nctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const fx = ((x % c) - c / 2) / (wire / 2), fy = ((y % c) - c / 2) / (wire / 2);
      const onV = Math.abs(fx) < 1, onH = Math.abs(fy) < 1;
      const over = ((Math.floor(x / c) + Math.floor(y / c)) & 1) === 0;
      let nx = 0, ny = 0;
      if (onV && (!onH || over)) nx = fx * 0.85;
      else if (onH) ny = fy * 0.85;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const i = (y * S + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  nctx.putImageData(img, 0, 0);
  return { alpha: toTexture(ac, { wrap: true }), normal: toTexture(nc, { wrap: true }) };
}

/** Gold-sputtered diaphragm with the backplate's concentric hole pattern showing through. */
function diaphragmTextures(): { map: THREE.Texture; normal: THREE.Texture } {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S * 0.45, S * 0.42, S * 0.05, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#f4d98a');
  g.addColorStop(0.6, '#d9ae52');
  g.addColorStop(1, '#8a6424');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const h = new Float32Array(S * S);
  const n = new Noise2(4, 32);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x / S - 0.5, dy = y / S - 0.5;
      const r = Math.hypot(dx, dy);
      const ring = Math.cos(r * 2 * Math.PI * 9) * 0.5 + 0.5;
      // backplate holes in rings, gently embossing the membrane
      const ang = Math.atan2(dy, dx);
      const holes = Math.pow(Math.max(0, Math.cos(ang * 18) * Math.cos(r * Math.PI * 2 * 4.5)), 12);
      h[y * S + x] = ring * 0.15 + holes * 0.6 + n.fbm((x / S) * 32, (y / S) * 32, 2) * 0.05;
    }
  }
  const [nc, nctx] = makeCanvas(S, S);
  const img = nctx.createImageData(S, S);
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const dx = (h[y * S + x + 1] - h[y * S + x - 1]) * 2.5;
      const dy = (h[(y - 1) * S + x] - h[(y + 1) * S + x]) * 2.5;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  nctx.putImageData(img, 0, 0);
  return { map: toTexture(c, { srgb: true }), normal: toTexture(nc) };
}

function badgeTexture(font: string): THREE.Texture {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S * 0.4, S * 0.35, 4, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#1d1c1b');
  g.addColorStop(1, '#070707');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d9b36a';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#e6c27a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${S * 0.3}px ${font}`;
  ctx.fillText('T', S / 2, S * 0.47);
  ctx.font = `700 ${S * 0.1}px ${font}`;
  ctx.fillText('Tarima', S / 2, S * 0.74);
  return toTexture(c, { srgb: true });
}

export interface StudioMic {
  group: THREE.Group;
  /** Centre of the capsule (the "mouth" target). */
  head: THREE.Object3D;
  /** Everything tappable (mic + shock mount + pop filter). */
  hit: THREE.Mesh;
  /** Status lamp under the badge: lit while the mic is live. */
  setLive(on: boolean): void;
  /** Pop filter membrane breathing with the voice level (0..1). */
  setLevel(v: number): void;
  update(dt: number): void;
}

/**
 * A large-diaphragm studio condenser: satin nickel body, double-layer mesh headbasket with the
 * gold capsule visible inside, enamel badge and pattern switch; hung in an elastic spider shock
 * mount on a heavy stand, with a nylon pop filter on a gooseneck in front of it.
 * The whole assembly faces +z (the singer).
 */
export function buildStudioMic(lib: MaterialLibrary, font: string): StudioMic {
  const g = new THREE.Group();
  const nickel = new THREE.MeshPhysicalMaterial({ color: 0xb4ad9f, metalness: 1, roughness: 0.36, anisotropy: 0.7, anisotropyRotation: Math.PI / 2, clearcoat: 0.25, clearcoatRoughness: 0.25 });
  const darkNickel = new THREE.MeshStandardMaterial({ color: 0x8d877c, metalness: 1, roughness: 0.4 });
  const blackAnod = new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0.7, roughness: 0.35 });
  const elastic = new THREE.MeshPhysicalMaterial({ color: 0x1b1b1d, roughness: 0.7, sheen: 1, sheenColor: new THREE.Color(0x444444), sheenRoughness: 0.5 });

  // ── stand: heavy round base, chrome tube, height clutch
  const standTop = 1.2;
  g.add(mesh(lathe([[0.001, 0], [0.18, 0], [0.186, 0.01], [0.176, 0.026], [0.035, 0.034], [0.001, 0.034]], 72), blackAnod));
  g.add(mesh(tube(V(0, 0.03, 0), V(0, 0.9, 0), 0.0125, 24), lib.chrome));
  g.add(mesh(tube(V(0, 0.9, 0), V(0, standTop, 0), 0.0092, 24), lib.chrome));
  g.add(mesh(tube(V(0, 0.87, 0), V(0, 0.93, 0), 0.02, 24, 0.017), blackAnod));

  // ── microphone (body axis vertical, capsule facing +z)
  const mic = new THREE.Group();
  mic.position.set(0, standTop + 0.2, 0);
  g.add(mic);
  const R = 0.028; // body radius (56 mm)
  const body = lathe([
    [0.001, -0.14],
    [0.012, -0.14],
    [0.019, -0.13],
    [0.024, -0.1],
    [R, -0.035],
    [R, 0.0],
    [R + 0.0012, 0.004],
    [R + 0.0012, 0.01],
    [R, 0.012],
    [0.001, 0.012],
  ], 96);
  mic.add(mesh(body, nickel));
  mic.add(mesh(tube(V(0, -0.145, 0), V(0, -0.132, 0), 0.0105, 24), darkNickel));
  // enamel badge + pattern switch on the front
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.0115, 40), new THREE.MeshPhysicalMaterial({ map: badgeTexture(font), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }));
  badge.position.set(0, -0.022, R + 0.0006);
  mic.add(badge);
  const badgeRing = new THREE.Mesh(new THREE.TorusGeometry(0.0118, 0.0009, 8, 48), lib.chrome);
  badgeRing.position.copy(badge.position);
  mic.add(badgeRing);
  const switchPlate = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.006, 0.002), blackAnod);
  switchPlate.position.set(0, -0.05, R + 0.0003);
  mic.add(switchPlate);
  const knob = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.005, 0.003), darkNickel);
  knob.position.set(0.003, -0.05, R + 0.0018);
  mic.add(knob);
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.04, 0.02) });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 12, 8), ledMat);
  led.position.set(0, -0.065, R + 0.0004);
  mic.add(led);

  // headbasket: rounded cylinder, double mesh, frame ring and front/back bars
  const H0 = 0.012, H1 = 0.088;
  const basketProfile: [number, number][] = [];
  for (let i = 0; i <= 10; i++) basketProfile.push([R + 0.0006, H0 + (i / 10) * (H1 - H0 - 0.02)]);
  for (let i = 1; i <= 14; i++) {
    const a = (i / 14) * Math.PI / 2;
    basketProfile.push([(R + 0.0006) * Math.cos(a), H1 - 0.02 + Math.sin(a) * 0.022]);
  }
  basketProfile[basketProfile.length - 1][0] = 0.0005;
  const outerMesh = wireMesh(26, 5);
  outerMesh.alpha.repeat.set(22, 7);
  outerMesh.normal.repeat.set(22, 7);
  const outer = new THREE.Mesh(
    new THREE.LatheGeometry(basketProfile.map(([r, y]) => new THREE.Vector2(r, y)), 96),
    new THREE.MeshStandardMaterial({ color: 0xcfc8ba, metalness: 1, roughness: 0.3, alphaMap: outerMesh.alpha, alphaTest: 0.4, alphaToCoverage: true, normalMap: outerMesh.normal, normalScale: new THREE.Vector2(1.2, 1.2), side: THREE.DoubleSide }),
  );
  outer.castShadow = true;
  mic.add(outer);
  const innerMesh = wireMesh(24, 2);
  innerMesh.alpha.repeat.set(30, 10);
  const inner = new THREE.Mesh(
    new THREE.LatheGeometry(basketProfile.map(([r, y]) => new THREE.Vector2(r * 0.9, y * 0.985)), 72),
    new THREE.MeshStandardMaterial({ color: 0x9e988c, metalness: 1, roughness: 0.4, alphaMap: innerMesh.alpha, alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide }),
  );
  mic.add(inner);
  mic.add(mesh(tube(V(0, H0 - 0.001, 0), V(0, H0 + 0.004, 0), R + 0.0016, 96), nickel));
  // frame bar: over the dome from side to side, then down both flanks to the collar
  const barArc = new THREE.TorusGeometry(R + 0.0009, 0.0011, 8, 48, Math.PI);
  barArc.scale(1, 0.022 / (R + 0.0009), 1);
  barArc.translate(0, H1 - 0.02, 0);
  const bars: THREE.BufferGeometry[] = [barArc];
  for (const s of [-1, 1]) bars.push(tube(V(s * (R + 0.0009), H0, 0), V(s * (R + 0.0009), H1 - 0.02, 0), 0.0011, 8));
  mic.add(mesh(merge(bars), nickel));
  // capsule: gold diaphragm in its ring, facing the singer
  const dia = diaphragmTextures();
  const head = new THREE.Group();
  head.position.set(0, (H0 + H1) / 2 + 0.004, 0);
  mic.add(head);
  const capsuleRing = new THREE.Mesh(new THREE.TorusGeometry(0.0172, 0.0022, 12, 48), darkNickel);
  head.add(capsuleRing);
  const diaphragm = new THREE.Mesh(new THREE.CircleGeometry(0.0168, 48), new THREE.MeshPhysicalMaterial({ map: dia.map, normalMap: dia.normal, normalScale: new THREE.Vector2(0.6, 0.6), metalness: 1, roughness: 0.18, side: THREE.DoubleSide }));
  diaphragm.position.z = 0.0012;
  head.add(diaphragm);
  head.add(mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.03, 10).translate(0, -0.028, 0), darkNickel));


  // ── spider shock mount: two rings on the body, elastic cords to an outer frame, yoke
  const mount = new THREE.Group();
  mount.position.copy(mic.position);
  g.add(mount);
  const ringY = [-0.018, -0.1];
  const frameR = 0.062;
  for (const y of ringY) {
    mount.add(mesh(new THREE.TorusGeometry(R + 0.004, 0.0028, 10, 64).rotateX(Math.PI / 2).translate(0, y, 0), blackAnod));
    mount.add(mesh(new THREE.TorusGeometry(frameR, 0.0035, 10, 72).rotateX(Math.PI / 2).translate(0, y, 0), blackAnod));
    // elastic cords criss-cross between the inner ring and the frame
    const cords: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI * 2, a1 = a0 + Math.PI / 4;
      cords.push(tube(V(Math.cos(a0) * (R + 0.006), y + 0.003, Math.sin(a0) * (R + 0.006)), V(Math.cos(a1) * frameR, y - 0.003, Math.sin(a1) * frameR), 0.0011, 5));
      cords.push(tube(V(Math.cos(a1) * (R + 0.006), y - 0.003, Math.sin(a1) * (R + 0.006)), V(Math.cos(a0) * frameR, y + 0.003, Math.sin(a0) * frameR), 0.0011, 5));
    }
    mount.add(mesh(merge(cords), elastic));
  }
  // frame posts joining both rings at the sides, yoke down to the stand
  const posts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) posts.push(tube(V(s * frameR, ringY[0], 0), V(s * frameR, ringY[1] - 0.012, 0), 0.0035, 10));
  posts.push(tube(V(-frameR, ringY[1] - 0.012, 0), V(frameR, ringY[1] - 0.012, 0), 0.0035, 10));
  posts.push(tube(V(0, ringY[1] - 0.012, 0), V(0, -0.2, 0), 0.006, 12));
  mount.add(mesh(merge(posts), blackAnod));
  mount.add(mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 20).rotateZ(Math.PI / 2).translate(frameR + 0.008, (ringY[0] + ringY[1]) / 2, 0), blackAnod));

  // ── pop filter: nylon membrane in a ring on a gooseneck clamped to the stand
  const pop = new THREE.Group();
  const popR = 0.075;
  pop.position.set(0, standTop + 0.24, 0.13);
  g.add(pop);
  pop.add(mesh(new THREE.TorusGeometry(popR, 0.0045, 12, 72), blackAnod));
  const popWeave = wireMesh(64, 3);
  popWeave.alpha.repeat.set(6, 6);
  const membraneMat = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.55, sheen: 1, sheenColor: new THREE.Color(0x6a6a70), transparent: true, opacity: 0.8, alphaMap: popWeave.alpha, side: THREE.DoubleSide, depthWrite: false });
  const membraneGeo = new THREE.CircleGeometry(popR - 0.002, 48, 0, Math.PI * 2);
  const membrane = new THREE.Mesh(membraneGeo, membraneMat);
  membrane.renderOrder = 8;
  pop.add(membrane);
  const basePos = membraneGeo.attributes.position.array.slice() as Float32Array;
  const gooseneck = new THREE.CatmullRomCurve3([
    V(0.012, 0.95, 0),
    V(0.07, 1.05, 0.03),
    V(0.1, 1.2, 0.08),
    V(popR * 0.75 + 0.01, standTop + 0.2, 0.125),
    V(popR * 0.95, standTop + 0.23, 0.13),
  ]);
  const gnTex = (() => {
    const [c, ctx] = makeCanvas(8, 64);
    for (let y = 0; y < 64; y++) {
      const v = 0.5 + 0.5 * Math.sin((y / 64) * Math.PI * 2 * 8);
      ctx.fillStyle = `rgb(${v * 255},${v * 255},255)`;
      ctx.fillRect(0, y, 8, 1);
    }
    const t = toTexture(c, { wrap: true });
    t.repeat.set(1, 40);
    return t;
  })();
  g.add(mesh(new THREE.TubeGeometry(gooseneck, 80, 0.0042, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a1c, metalness: 0.8, roughness: 0.35, bumpMap: gnTex, bumpScale: 1 })));
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.035, 0.03).translate(0.018, 0.95, 0), blackAnod));

  // XLR cable from the mic base down the stand
  const cable = new THREE.CatmullRomCurve3([V(0, standTop + 0.055, 0), V(0.02, standTop - 0.06, -0.03), V(0.022, 0.6, -0.02), V(0.03, 0.03, -0.05), V(0.5, 0.008, -0.4), V(1.5, 0.008, -0.7)]);
  g.add(mesh(new THREE.TubeGeometry(cable, 90, 0.0035, 8), lib.rubber));

  // generous invisible hit volume around mic, mount and pop filter
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 16).translate(0, standTop + 0.17, 0.05), new THREE.MeshBasicMaterial({ visible: false }));
  g.add(hit);

  let level = 0, t = 0;
  return {
    group: g,
    head,
    hit,
    setLive(on: boolean) {
      ledMat.color.setRGB(on ? 3.5 : 0.25, on ? 0.35 : 0.04, on ? 0.12 : 0.02);
    },
    setLevel(v: number) {
      level += (Math.min(1, v * 8) - level) * 0.3;
    },
    update(dt: number) {
      t += dt;
      // the pop filter membrane bulges softly away from the singer's breath
      const p = membraneGeo.attributes.position as THREE.BufferAttribute;
      const arr = p.array as Float32Array;
      for (let i = 0; i < p.count; i++) {
        const x = basePos[i * 3], y = basePos[i * 3 + 1];
        const r = Math.hypot(x, y) / popR;
        arr[i * 3 + 2] = -(1 - r * r) * level * 0.006 * (1 + 0.15 * Math.sin(t * 40 + r * 6));
      }
      p.needsUpdate = true;
    },
  };
}
