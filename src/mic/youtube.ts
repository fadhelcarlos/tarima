import * as THREE from 'three';

/* Minimal typings for the YouTube IFrame Player API. */
interface YTPlayer {
  loadVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  setVolume(v: number): void;
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: unknown) => YTPlayer;
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads the IFrame API once. Rejects if the page can't reach YouTube (e.g. a sandboxed viewer). */
export function loadYouTube(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const w = window as unknown as { YT?: YTNamespace & { Player?: unknown }; onYouTubeIframeAPIReady?: () => void };
    if (w.YT?.Player) return resolve(w.YT as YTNamespace);
    const timer = window.setTimeout(() => reject(new Error('timeout')), 9000);
    w.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      resolve(w.YT as YTNamespace);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error('blocked'));
    };
    document.head.appendChild(s);
  });
  apiPromise.catch(() => (apiPromise = null));
  return apiPromise;
}

/** Pulls the 11-character video id out of any YouTube URL (or accepts a bare id). */
export function videoIdFrom(text: string): string | null {
  const t = text.trim();
  if (/^[\w-]{11}$/.test(t)) return t;
  const m = /(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/.exec(t);
  return m ? m[1] : null;
}

const W = 1280, H = 720;

/** Solves the 3x3 homography that maps the unit rectangle (W×H) onto 4 screen points. */
function homography(dst: [number, number][]): number[] {
  const src: [number, number][] = [[0, 0], [W, 0], [W, H], [0, H]];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Gaussian elimination (8x8)
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [...h, 1];
}

/**
 * A YouTube karaoke video shown on the 3D projector screen. The iframe sits behind the WebGL
 * canvas; the screen mesh punches a transparent hole so the video appears on the screen with
 * perspective, while the microphone in front still covers it and the beam glows over it.
 */
export class ProjectorVideo {
  private readonly layer: HTMLDivElement;
  private readonly host: HTMLDivElement;
  private player: YTPlayer | null = null;
  /** The API returns the player object before its methods exist; only use it once ready. */
  private ready = false;
  private readonly corners: THREE.Vector3[];
  private readonly v = new THREE.Vector3();
  visible = false;
  onState: ((state: number) => void) | null = null;
  onError: ((code: number) => void) | null = null;
  private readonly holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: false, opacity: 0, blending: THREE.NoBlending, fog: false });
  private screenMat: THREE.Material | THREE.Material[];

  constructor(private readonly screen: THREE.Mesh, container: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'yt-layer';
    this.layer.hidden = true;
    this.host = document.createElement('div');
    this.layer.appendChild(this.host);
    const glow = document.createElement('div');
    glow.className = 'yt-projection';
    this.layer.appendChild(glow);
    container.prepend(this.layer);
    this.screenMat = screen.material;
    const g = screen.geometry as THREE.PlaneGeometry;
    const w = g.parameters.width / 2, h = g.parameters.height / 2;
    this.corners = [new THREE.Vector3(-w, h, 0), new THREE.Vector3(w, h, 0), new THREE.Vector3(w, -h, 0), new THREE.Vector3(-w, -h, 0)];
  }

  async play(videoId: string): Promise<void> {
    const YT = await loadYouTube();
    this.show(true);
    if (!this.player) {
      await new Promise<void>((resolve) => {
        this.player = new YT.Player(this.host, {
          width: W,
          height: H,
          videoId,
          playerVars: { playsinline: 1, autoplay: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, iv_load_policy: 3, fs: 0 },
          events: {
            onReady: () => {
              this.ready = true;
              this.player!.playVideo();
              resolve();
            },
            onStateChange: (e: { data: number }) => this.onState?.(e.data),
            onError: (e: { data: number }) => this.onError?.(e.data),
          },
        });
      });
    } else if (this.ready) {
      this.player.loadVideoById(videoId);
      this.player.playVideo();
    }
  }

  /** Needed when the browser blocked autoplay: let the next tap reach the video itself. */
  set acceptTaps(on: boolean) {
    this.layer.classList.toggle('taps', on);
  }

  private get api(): YTPlayer | null {
    return this.ready ? this.player : null;
  }

  pause(): void {
    this.api?.pauseVideo();
  }

  resume(): void {
    this.api?.playVideo();
  }

  get playing(): boolean {
    return this.api?.getPlayerState() === 1;
  }

  get state(): number {
    const a = this.api;
    return a ? a.getPlayerState() : -1;
  }

  set volume(v: number) {
    this.api?.setVolume(Math.round(v * 100));
  }

  stop(): void {
    this.api?.stopVideo();
    this.show(false);
  }

  private show(on: boolean): void {
    this.visible = on;
    this.layer.hidden = !on;
    this.screen.material = on ? this.holeMat : this.screenMat;
  }

  /** Re-projects the iframe onto the screen quad (call every frame while visible). */
  update(camera: THREE.Camera, width: number, height: number): void {
    if (!this.visible) return;
    const pts = this.corners.map((c) => {
      this.v.copy(c);
      this.screen.localToWorld(this.v).project(camera);
      return [(this.v.x * 0.5 + 0.5) * width, (-this.v.y * 0.5 + 0.5) * height] as [number, number];
    });
    const h = homography(pts);
    // CSS matrix3d is column-major
    const m = [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, h[8]];
    this.layer.style.transform = `matrix3d(${m.map((x) => x.toFixed(8)).join(',')})`;
  }
}

/**
 * Finds the song's key from the notes the singer holds (Krumhansl–Kessler profiles), so the
 * pitch corrector can snap to the right scale for any song.
 */
export class KeyFinder {
  private readonly hist = new Float64Array(12);
  private static readonly MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  private static readonly MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  reset(): void {
    this.hist.fill(0);
  }

  add(midi: number, dt: number): void {
    if (midi < 0) return;
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    this.hist[pc] += dt;
  }

  get total(): number {
    return this.hist.reduce((a, b) => a + b, 0);
  }

  /** Best key and how clearly it wins (0..1). */
  best(): { key: number; scale: 'mayor' | 'menor'; confidence: number } {
    const corr = (profile: number[], k: number) => {
      const x = Array.from({ length: 12 }, (_, i) => this.hist[(i + k) % 12]);
      const mx = x.reduce((a, b) => a + b, 0) / 12, my = profile.reduce((a, b) => a + b, 0) / 12;
      let num = 0, dx = 0, dy = 0;
      for (let i = 0; i < 12; i++) {
        num += (x[i] - mx) * (profile[i] - my);
        dx += (x[i] - mx) ** 2;
        dy += (profile[i] - my) ** 2;
      }
      return num / Math.sqrt(dx * dy || 1);
    };
    const scores: { key: number; scale: 'mayor' | 'menor'; r: number }[] = [];
    for (let k = 0; k < 12; k++) {
      scores.push({ key: k, scale: 'mayor', r: corr(KeyFinder.MAJOR, k) });
      scores.push({ key: k, scale: 'menor', r: corr(KeyFinder.MINOR, k) });
    }
    scores.sort((a, b) => b.r - a.r);
    return { key: scores[0].key, scale: scores[0].scale, confidence: Math.max(0, scores[0].r - scores[1].r) * 4 };
  }
}
