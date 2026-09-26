import * as THREE from 'three';
import { N8AOPostPass } from 'n8ao';
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { buildStage, type Stage } from './environment';

export type Quality = 'alta' | 'media' | 'baja';

/**
 * Renderer, scene and camera. "alta"/"media" render through a film-like pipeline
 * (MSAA → ambient occlusion → bloom → AgX tone mapping → vignette → grain);
 * "baja" renders straight to the screen for older phones.
 */
export class Stage3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 40);
  stage!: Stage;
  quality: Quality = 'alta';
  autoQuality = true;
  onResize: (() => void) | null = null;
  private composer: EffectComposer | null = null;
  private ao: N8AOPostPass | null = null;
  private frameTimes: number[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const small = Math.min(screen.width, screen.height) < 500;
    this.quality = small ? 'media' : 'alta';
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }

  async buildRoom(onProgress: (f: number) => void): Promise<void> {
    this.stage = await buildStage(this.scene, this.renderer, onProgress);
    this.applyQuality();
  }

  private maxDpr(): number {
    return this.quality === 'alta' ? 2 : this.quality === 'media' ? 1.5 : 1;
  }

  setQuality(q: Quality): void {
    if (q === this.quality && (q === 'baja' || this.composer)) return;
    this.quality = q;
    this.applyQuality();
  }

  private applyQuality(): void {
    const q = this.quality;
    const key = this.stage?.key;
    if (key) {
      const size = q === 'alta' ? 2048 : 1024;
      if (key.shadow.mapSize.x !== size) {
        key.shadow.mapSize.set(size, size);
        key.shadow.map?.dispose();
        key.shadow.map = null;
      }
      key.shadow.radius = q === 'baja' ? 2 : 4;
    }
    this.composer?.dispose();
    this.composer = null;
    this.ao = null;
    if (q === 'baja') {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
    } else {
      this.renderer.toneMapping = THREE.NoToneMapping;
      const composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: q === 'alta' ? 4 : 2 });
      composer.addPass(new RenderPass(this.scene, this.camera));
      const ao = new N8AOPostPass(this.scene, this.camera, 512, 512);
      ao.configuration.aoRadius = 0.16;
      ao.configuration.distanceFalloff = 0.35;
      ao.configuration.intensity = 2.4;
      ao.configuration.halfRes = true;
      ao.configuration.depthAwareUpsampling = true;
      ao.setQualityMode(q === 'alta' ? 'Medium' : 'Low');
      composer.addPass(ao);
      const bloom = new BloomEffect({ intensity: 0.3, luminanceThreshold: 1.6, luminanceSmoothing: 0.4, mipmapBlur: true, radius: 0.55 });
      const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
      const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.5 });
      const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
      grain.blendMode.opacity.value = 0.055;
      composer.addPass(new EffectPass(this.camera, bloom, tone, vignette, grain));
      this.composer = composer;
      this.ao = ao;
      this.exposure(1.0);
    }
    this.resize();
  }

  /** Scene-referred exposure applied before tone mapping. */
  private exposure(v: number): void {
    this.renderer.toneMappingExposure = v;
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr()));
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.onResize?.();
  }

  /** Called every frame with the frame duration; steps quality down if the device struggles. */
  track(dtMs: number): void {
    if (!this.autoQuality || document.hidden) return;
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length < 90) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.frameTimes.length = 0;
    if (median > 24 && this.quality !== 'baja') this.setQuality(this.quality === 'alta' ? 'media' : 'baja');
  }

  render(dt: number): void {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Exposed for tuning. */
  get composerRef(): EffectComposer | null {
    return this.composer;
  }

  get aoPass(): N8AOPostPass | null {
    return this.ao;
  }
}
