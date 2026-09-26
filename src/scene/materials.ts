import * as THREE from 'three';
import {
  coatedHead,
  cymbalColor,
  cymbalShared,
  kickResoHead,
  orangePeel,
  sparkleFlakes,
  woodVeneer,
  type CymbalShared,
  type FinishId,
  type ShellMaps,
} from './textures';

export const FINISHES: { id: FinishId; name: string; swatch: string }[] = [
  { id: 'cereza', name: 'Cereza', swatch: '#7a1a14' },
  { id: 'negro', name: 'Negro piano', swatch: '#0d0d0f' },
  { id: 'plata', name: 'Plata brillante', swatch: '#b9bdc4' },
  { id: 'natural', name: 'Arce natural', swatch: '#d6a466' },
];

/** Every shared material in the kit. Shell materials mutate in place when the finish changes. */
export class MaterialLibrary {
  readonly chrome = new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 1, roughness: 0.17 });
  readonly chromeSatin = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.32 });
  readonly blackMetal = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, metalness: 0.6, roughness: 0.38 });
  readonly rubber = new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0, roughness: 0.85 });
  readonly felt = new THREE.MeshStandardMaterial({ color: 0x8e2a26, metalness: 0, roughness: 1 });
  readonly feltWhite = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, metalness: 0, roughness: 1 });
  readonly plastic = new THREE.MeshStandardMaterial({ color: 0x101012, metalness: 0, roughness: 0.45 });
  readonly leather = new THREE.MeshPhysicalMaterial({ color: 0x121213, metalness: 0, roughness: 0.55, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x333333) });
  readonly badge = new THREE.MeshStandardMaterial({ color: 0xd8b270, metalness: 1, roughness: 0.25 });
  readonly innerWood = new THREE.MeshStandardMaterial({ color: 0xb58a5a, metalness: 0, roughness: 0.7, side: THREE.BackSide });

  /** Outer shell wrap/lacquer (all drums share it so a finish switch is one update). */
  readonly shell = new THREE.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: 0.04 });
  /** Wooden bass drum hoops follow the finish too. */
  readonly kickHoop = new THREE.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: 0.05 });

  cymbalMaps!: CymbalShared;
  private readonly finishCache = new Map<FinishId, ShellMaps | THREE.Texture>();
  private headCache = new Map<string, THREE.MeshPhysicalMaterial>();
  finish: FinishId = 'cereza';

  constructor(private readonly displayFont: string) {}

  /** Heavy texture generation happens here so the loader can report progress between steps. */
  async prepare(step: (label: string) => Promise<void>): Promise<void> {
    await step('Laca de los cascos');
    this.setFinish(this.finish);
    await step('Bronce de los platillos');
    this.cymbalMaps = cymbalShared();
  }

  setFinish(id: FinishId): void {
    this.finish = id;
    const m = this.shell;
    const hoop = this.kickHoop;
    m.map = m.normalMap = m.roughnessMap = null;
    m.metalness = 0;
    m.roughness = 0.3;
    m.color.set(0xffffff);
    m.normalScale.set(1, 1);
    m.clearcoat = 1;
    m.clearcoatRoughness = 0.035;
    if (id === 'cereza' || id === 'natural') {
      let maps = this.finishCache.get(id) as ShellMaps | undefined;
      if (!maps) {
        maps = woodVeneer(id === 'cereza' ? 'cherry' : 'natural', id === 'cereza' ? 7 : 19);
        this.finishCache.set(id, maps);
      }
      m.map = maps.map;
      m.normalMap = maps.normalMap ?? null;
      m.normalScale.set(0.25, 0.25);
      m.roughness = 0.42;
    } else if (id === 'negro') {
      let peel = this.finishCache.get('negro') as THREE.Texture | undefined;
      if (!peel) {
        peel = orangePeel();
        this.finishCache.set('negro', peel);
      }
      m.color.set(0x060607);
      m.roughness = 0.18;
      m.normalMap = peel;
      m.normalScale.set(0.04, 0.04);
      m.clearcoatRoughness = 0.02;
    } else if (id === 'plata') {
      let flakes = this.finishCache.get('plata') as THREE.Texture | undefined;
      if (!flakes) {
        flakes = sparkleFlakes();
        this.finishCache.set('plata', flakes);
      }
      m.color.set(0xb4b8be);
      m.metalness = 0.9;
      m.roughness = 0.32;
      m.normalMap = flakes;
      m.normalScale.set(0.9, 0.9);
      m.clearcoatRoughness = 0.02;
    }
    hoop.copy(m);
    hoop.map = m.map;
    hoop.normalMap = m.normalMap;
    m.needsUpdate = true;
    hoop.needsUpdate = true;
  }

  /** Coated batter head material, one per drum model (the label differs). */
  head(label: string, seed: number): THREE.MeshPhysicalMaterial {
    const key = `${label}:${seed}`;
    const cached = this.headCache.get(key);
    if (cached) return cached;
    const maps = coatedHead(label, seed, this.displayFont);
    const mat = new THREE.MeshPhysicalMaterial({
      map: maps.map,
      roughnessMap: maps.roughnessMap,
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 1,
      metalness: 0,
      sheen: 0.15,
      sheenColor: new THREE.Color(0xffffff),
      sheenRoughness: 0.8,
    });
    this.headCache.set(key, mat);
    return mat;
  }

  /** Plain coated collar / resonant head (no logo). */
  readonly headPlain = new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.82, metalness: 0 });

  kickReso(): THREE.MeshPhysicalMaterial {
    const t = kickResoHead(this.displayFont);
    return new THREE.MeshPhysicalMaterial({
      map: t.map,
      alphaMap: t.alphaMap,
      alphaTest: 0.5,
      roughness: 0.38,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.3,
      side: THREE.DoubleSide,
    });
  }

  cymbal(model: string, size: string, seed: number, brilliant = false): THREE.MeshPhysicalMaterial {
    const maps = this.cymbalMaps;
    return new THREE.MeshPhysicalMaterial({
      map: cymbalColor(model, size, this.displayFont, seed, brilliant),
      normalMap: maps.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: maps.roughnessMap,
      roughness: brilliant ? 0.55 : 1,
      metalness: 1,
      anisotropy: 0.75,
      anisotropyMap: maps.anisotropyMap,
      side: THREE.DoubleSide,
    });
  }
}
