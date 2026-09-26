import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

const ASSETS = './assets/';

export interface Stage {
  key: THREE.SpotLight;
  rim: THREE.SpotLight;
  /** Same boards, darker, for the room floor in front of the stage. */
  roomFloor: THREE.Material;
}

/**
 * The studio HDR ships base64-encoded as text (the artifact host doesn't serve .hdr files);
 * it is decoded here and parsed exactly like the original Radiance file.
 */
async function loadHDR(url: string): Promise<THREE.DataTexture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HDR ${res.status}`);
  const bin = atob((await res.text()).trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const loader = new HDRLoader();
  loader.setDataType(THREE.HalfFloatType);
  const d = loader.parse(bytes.buffer) as { data: Uint16Array; width: number; height: number };
  const tex = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}

function loadTexture(loader: THREE.TextureLoader, file: string, srgb: boolean, repeat: [number, number]): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      ASSETS + file,
      (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(...repeat);
        t.anisotropy = 8;
        resolve(t);
      },
      undefined,
      reject,
    );
  });
}

/**
 * The room: a photographed studio (Poly Haven "Wooden Studio 05", CC0) lights and reflects the kit,
 * scanned hardwood boards and a drum rug sit under it, and a warm key spot casts the shadows.
 */
export async function buildStage(scene: THREE.Scene, renderer: THREE.WebGLRenderer, onProgress: (f: number) => void): Promise<Stage> {
  const texLoader = new THREE.TextureLoader();
  let done = 0;
  const total = 7;
  const tick = <T,>(p: Promise<T>) => p.then((v) => { onProgress(++done / total); return v; });

  const [hdr, floorMap, floorNor, floorRough, rugMap, rugNor, rugRough] = await Promise.all([
    tick(loadHDR(ASSETS + 'studio.hdr.txt')),
    tick(loadTexture(texLoader, 'floor_diff.webp', true, [20, 20])),
    tick(loadTexture(texLoader, 'floor_nor_gl.webp', false, [20, 20])),
    tick(loadTexture(texLoader, 'floor_rough.webp', false, [20, 20])),
    tick(loadTexture(texLoader, 'rug_diff.webp', true, [2.2, 1.65])),
    tick(loadTexture(texLoader, 'rug_nor_gl.webp', false, [2.2, 1.65])),
    tick(loadTexture(texLoader, 'rug_rough.webp', false, [2.2, 1.65])),
  ]);

  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(hdr).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.78;
  scene.environmentRotation.set(0, 0, 0);
  // the room around the kit falls off into darkness, like a stage under a single key light
  scene.background = new THREE.Color(0x0a0807);
  scene.fog = new THREE.Fog(0x0a0807, 9, 26);
  hdr.dispose();

  // hardwood stage deck (the tarima): from the front edge to the back curtain
  const deckW = 7.4, deckD = 5.3;
  const tile = (t: THREE.Texture, w: number, d: number) => {
    const c = t.clone();
    c.repeat.set(w / 2, d / 2);
    c.needsUpdate = true;
    return c;
  };
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(deckW, deckD),
    new THREE.MeshStandardMaterial({ map: tile(floorMap, deckW, deckD), normalMap: tile(floorNor, deckW, deckD), roughnessMap: tile(floorRough, deckW, deckD), roughness: 1, color: 0x9a8a80, normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 0.45 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 2.4 - deckD / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  const roomFloor = new THREE.MeshStandardMaterial({ map: floorMap, normalMap: floorNor, roughnessMap: floorRough, roughness: 1, color: 0x4a4440, normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 0.3 });

  // drum rug: 2.3 x 1.72 m carpet with a bound edge
  const rugW = 2.3, rugD = 1.72, rugH = 0.009;
  const rugMat = new THREE.MeshStandardMaterial({ map: rugMap, normalMap: rugNor, roughnessMap: rugRough, roughness: 1, color: 0x8a7f7a, normalScale: new THREE.Vector2(1.2, 1.2) });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(rugW, rugD), rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.1, rugH, -0.06);
  rug.receiveShadow = true;
  scene.add(rug);
  const binding = new THREE.MeshStandardMaterial({ color: 0x141213, roughness: 0.9, metalness: 0 });
  const bw = 0.035;
  for (const [w, d, x, z] of [
    [rugW + bw * 2, bw, 0, rugD / 2 + bw / 2],
    [rugW + bw * 2, bw, 0, -rugD / 2 - bw / 2],
    [bw, rugD, rugW / 2 + bw / 2, 0],
    [bw, rugD, -rugW / 2 - bw / 2, 0],
  ] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, rugH + 0.002, d), binding);
    b.position.set(0.1 + x, (rugH + 0.002) / 2, -0.06 + z);
    b.receiveShadow = true;
    b.castShadow = false;
    scene.add(b);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(rugW, rugH, rugD), binding);
  base.position.set(0.1, rugH / 2 - 0.0005, -0.06);
  base.receiveShadow = true;
  scene.add(base);

  // warm key spot for readable shadows (image lighting alone casts none)
  const key = new THREE.SpotLight(0xffe2c4, 42, 0, 0.6, 0.8, 2);
  key.position.set(-1.0, 3.5, 1.7);
  key.target.position.set(0.08, 0.55, -0.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00015;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 4;
  key.shadow.camera.near = 1.8;
  key.shadow.camera.far = 6.5;
  scene.add(key, key.target);

  // amber back light, typical of a stage: outlines cymbal edges and chrome
  const rim = new THREE.SpotLight(0xffae63, 34, 0, 0.55, 0.85, 2);
  rim.position.set(0.5, 3.1, -2.9);
  rim.target.position.set(0, 0.75, -0.1);
  scene.add(rim, rim.target);

  return { key, rim, roomFloor };
}
