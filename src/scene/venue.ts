import * as THREE from 'three';
import type { MaterialLibrary } from './materials';
import { makeCanvas, Noise2, rng, toTexture } from './textures';
import { buildStudioMic, type StudioMic } from './studioMic';

/** Stage height: the audience floor sits this far below the stage deck (y = 0). */
export const STAGE_DROP = 0.5;
export const STAGE_FRONT = -2.9;
export const SCREEN = { center: new THREE.Vector3(0, 1.55, -8.2), width: 4.2, height: 4.2 * 9 / 16 };
export const MIC_POS = new THREE.Vector3(0, 0, -2.02);

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Velvet curtain folds as a displaced plane. */
function curtain(width: number, height: number, folds: number, color: number): THREE.Mesh {
  const g = new THREE.PlaneGeometry(width, height, folds * 8, 8);
  const p = g.attributes.position;
  const r = rng(3);
  const phase = Array.from({ length: 6 }, () => r() * 6.28);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const u = (x / width + 0.5) * folds * Math.PI * 2;
    p.setZ(i, Math.sin(u + phase[0]) * 0.06 + Math.sin(u * 0.37 + phase[1]) * 0.04);
  }
  g.computeVertexNormals();
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.95, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0x6a3a3a) });
  const me = new THREE.Mesh(g, m);
  me.receiveShadow = true;
  return me;
}

export interface Venue {
  screen: THREE.Mesh;
  screenCanvas: HTMLCanvasElement;
  screenTexture: THREE.CanvasTexture;
  studioMic: StudioMic;
  micHead: THREE.Object3D;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
}

/**
 * The venue around the kit: a raised wooden stage (tarima) with a velvet back curtain and a
 * floor wedge, a dark room below it, the singer's microphone on its stand, and a projector
 * screen facing the stage for lyrics — lit by a ceiling projector whose beam shows in the haze.
 */
export function buildVenue(scene: THREE.Scene, lib: MaterialLibrary, floorMat: THREE.Material, font: string): Venue {
  // stage deck edges and the room floor below
  const deckW = 7.4, deckBack = 2.4;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(deckW, STAGE_DROP), new THREE.MeshStandardMaterial({ color: 0x0c0b0b, roughness: 0.9 }));
  face.position.set(0, -STAGE_DROP / 2, STAGE_FRONT);
  face.rotation.y = Math.PI;
  scene.add(face);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.03, 0.05), new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.6 }));
  lip.position.set(0, -0.015, STAGE_FRONT + 0.02);
  lip.receiveShadow = true;
  scene.add(lip);
  const room = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), floorMat);
  room.rotation.x = -Math.PI / 2;
  room.position.set(0, -STAGE_DROP, STAGE_FRONT - 15);
  room.receiveShadow = true;
  scene.add(room);
  // back curtain + side legs
  const back = curtain(9, 5.2, 14, 0x1b0c0d);
  back.position.set(0, 2.6, deckBack);
  back.rotation.y = Math.PI;
  scene.add(back);
  for (const s of [-1, 1]) {
    const leg = curtain(1.6, 5.2, 3, 0x140a0b);
    leg.position.set(s * (deckW / 2 + 0.3), 2.6, -0.6);
    leg.rotation.y = -s * Math.PI / 2;
    scene.add(leg);
  }

  // the room: dark walls
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x17130f, roughness: 0.92 });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(18, 7), wallMat);
  backWall.position.set(0, 3 - STAGE_DROP, SCREEN.center.z - 0.45);
  backWall.receiveShadow = true;
  scene.add(backWall);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(12, 7), wallMat);
    side.position.set(sx * 7.5, 3 - STAGE_DROP, -5.5);
    side.rotation.y = -sx * Math.PI / 2;
    scene.add(side);
  }
  const studioMic = buildStudioMic(lib, font);
  studioMic.group.position.copy(MIC_POS);
  scene.add(studioMic.group);
  // the mic is the hero: a soft key from above the singer's left shoulder and a cool rim behind
  const singerSpot = new THREE.SpotLight(0xffe8d0, 30, 0, 0.3, 0.8, 2);
  singerSpot.position.set(-0.9, 3.1, -0.7);
  singerSpot.target.position.set(0, 1.45, MIC_POS.z);
  scene.add(singerSpot, singerSpot.target);
  const micRim = new THREE.SpotLight(0xbcd2ff, 14, 0, 0.25, 0.9, 2);
  micRim.position.set(0.8, 2.6, MIC_POS.z - 2.2);
  micRim.target.position.set(0, 1.45, MIC_POS.z);
  scene.add(micRim, micRim.target);

  // projector screen facing the stage
  const { center, width, height } = SCREEN;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.22, height + 0.22, 0.04), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }));
  frame.position.copy(center).add(V(0, 0, -0.03));
  scene.add(frame);
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 1280;
  screenCanvas.height = 720;
  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  screenTexture.anisotropy = 8;
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTexture, color: new THREE.Color(1.5, 1.5, 1.5), fog: false });
  const weave = fabricTexture();
  screenMat.onBeforeCompile = (sh) => {
    sh.uniforms.uWeave = { value: weave };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uWeave;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // projector hotspot, soft corners and the matte fabric weave
        vec2 q = vMapUv - 0.5;
        float hot = 1.08 - dot(q, q) * 0.9;
        float weave = 0.93 + 0.07 * texture2D(uWeave, vMapUv * vec2(96.0, 54.0)).r;
        diffuseColor.rgb *= hot * weave;`,
      );
  };
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), screenMat);
  screen.position.copy(center);
  scene.add(screen);
  for (const s of [-1, 1]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 3), lib.chromeSatin);
    cable.position.set(s * width * 0.4, center.y + height / 2 + 1.6, center.z - 0.03);
    scene.add(cable);
  }
  // glow the screen throws back toward the stage
  const spill = new THREE.PointLight(0xcfe0ff, 2.2, 14, 2);
  spill.position.copy(center).add(V(0, 0, 1.2));
  scene.add(spill);

  // beam from the ceiling projector (above the frame) through the haze
  const projPos = V(0, 3.35, -4.6);
  const beamMat = new THREE.MeshBasicMaterial({ map: hazeTexture(), color: new THREE.Color(0.55, 0.6, 0.7), transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const beam = new THREE.Mesh(beamGeometry(projPos.clone().add(V(0.1, -0.01, -0.19)), center, width * 0.98, height * 0.98), beamMat);
  beam.renderOrder = 5;
  scene.add(beam);

  return { screen, screenCanvas, screenTexture, studioMic, micHead: studioMic.head, beam, beamMat };
}

/** Pyramid of light from the lens to the screen corners; UV.y runs lens → screen. */
function beamGeometry(apex: THREE.Vector3, center: THREE.Vector3, w: number, h: number): THREE.BufferGeometry {
  const c = [V(-w / 2, -h / 2, 0), V(w / 2, -h / 2, 0), V(w / 2, h / 2, 0), V(-w / 2, h / 2, 0)].map((v) => v.add(center).add(V(0, 0, 0.02)));
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    pos.push(apex.x, apex.y, apex.z, a.x, a.y, a.z, b.x, b.y, b.z);
    uv.push(0.5, 0, i / 4, 1, (i + 1) / 4, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function hazeTexture(): THREE.Texture {
  const W = 256, H = 256;
  const [c, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const n = new Noise2(8, 16, 16);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = y / H;
      const k = (0.35 + 0.65 * n.fbm((x / W) * 16, (y / H) * 16, 4)) * Math.pow(1 - v, 1.6) * (0.4 + 0.6 * Math.min(1, v * 8));
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = k * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c, { srgb: true, wrap: true });
  t.flipY = false;
  return t;
}

function fabricTexture(): THREE.Texture {
  const S = 64;
  const [c, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = 0.5 + 0.25 * Math.sin((x / S) * Math.PI * 16) * Math.sin((y / S) * Math.PI * 16) + 0.25 * Math.random();
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { wrap: true });
}

