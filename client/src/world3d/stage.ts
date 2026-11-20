// Palco: renderizador WebGL, céu, luz do sol (dia/noite), sombras, pós-processamento e presets de qualidade.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high', 'ultra'];

interface QualitySpec {
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  ao: boolean;
  msaa: number;
}

const SPEC: Record<Quality, QualitySpec> = {
  low: { pixelRatio: 0.85, shadows: false, shadowSize: 1024, ao: false, msaa: 0 },
  medium: { pixelRatio: 1, shadows: true, shadowSize: 1024, ao: false, msaa: 4 },
  high: { pixelRatio: 1.5, shadows: true, shadowSize: 2048, ao: true, msaa: 4 },
  ultra: { pixelRatio: 2, shadows: true, shadowSize: 4096, ao: true, msaa: 8 },
};

const QKEY = 'habblaud.3d.quality';

export function loadQuality(): Quality {
  try {
    const q = localStorage.getItem(QKEY);
    if (q && (QUALITIES as readonly string[]).includes(q)) return q as Quality;
  } catch {
    // sem armazenamento
  }
  return 'high';
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(QKEY, q);
  } catch {
    // sem armazenamento
  }
}

const SKY_DAY = new THREE.Color('#bcd9ea');
const SKY_DUSK = new THREE.Color('#f2c29b');
const SKY_NIGHT = new THREE.Color('#1c2438');

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private composer: EffectComposer | null = null;
  private ao: GTAOPass | null = null;
  quality: Quality;
  /** 0 = dia pleno, 1 = noite fechada (para as luzes das salas). */
  night = 0;
  private w = 1;
  private h = 1;
  private bounds = new THREE.Box3(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(70, 3, 40));

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400);
    this.scene.background = SKY_DAY.clone();
    this.scene.fog = new THREE.Fog(SKY_DAY.clone(), 90, 220);

    this.hemi = new THREE.HemisphereLight('#f4f0ff', '#8a7a66', 1.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff1dc', 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.applyQuality();
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
  }

  private applyQuality(): void {
    const s = SPEC[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.pixelRatio));
    this.renderer.shadowMap.enabled = s.shadows;
    this.sun.castShadow = s.shadows;
    this.sun.shadow.mapSize.set(s.shadowSize, s.shadowSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.composer?.dispose();
    this.composer = null;
    this.ao = null;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: s.msaa });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (s.ao) {
      const ao = new GTAOPass(this.scene, this.camera, 1, 1);
      ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.4, thickness: 1, scale: 1.1 });
      ao.blendIntensity = 0.85;
      composer.addPass(ao);
      this.ao = ao;
    }
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.resize(this.w, this.h);
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(this.w, this.h);
    this.ao?.setSize(this.w * this.renderer.getPixelRatio(), this.h * this.renderer.getPixelRatio());
  }

  /** Ajusta a câmera de sombra ao prédio inteiro. */
  setBounds(b: THREE.Box3): void {
    this.bounds.copy(b);
  }

  /** Céu e sol pela hora (0..24). */
  setTime(hour: number): void {
    // sol nasce às 6h e se põe às 18h
    const dayT = (hour - 6) / 12;
    const elev = Math.sin(Math.PI * THREE.MathUtils.clamp(dayT, 0, 1));
    const isDay = dayT > 0 && dayT < 1;
    const dusk = isDay ? Math.max(0, 1 - elev * 3) : 0;
    this.night = isDay ? Math.max(0, 0.6 - elev * 2.5) : 1;
    const sky = isDay ? SKY_DAY.clone().lerp(SKY_DUSK, dusk * 0.8) : SKY_NIGHT.clone();
    if (!isDay) sky.lerp(SKY_DUSK, Math.max(0, 1 - Math.min(Math.abs(hour - 18.5), Math.abs(hour - 5.5)) * 1.6) * 0.35);
    (this.scene.background as THREE.Color).copy(sky);
    this.scene.fog!.color.copy(sky);
    // direção: de leste a oeste, sempre um pouco do sul (sombras caem para o norte, "para trás" da câmera)
    const az = Math.PI * (0.15 + 0.7 * THREE.MathUtils.clamp(dayT, 0, 1));
    const c = this.bounds.getCenter(new THREE.Vector3());
    const size = this.bounds.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z) * 0.75 + 20;
    const up = isDay ? 0.35 + elev * 0.9 : 0.9;
    this.sun.position.set(c.x + Math.cos(az) * r, r * up, c.z + Math.sin(az) * r * 0.5 + r * 0.55);
    this.sun.target.position.copy(c);
    this.sun.intensity = isDay ? 0.9 + elev * 2.1 : 0.45;
    this.sun.color.set(isDay ? (dusk > 0.3 ? '#ffd2a6' : '#fff1dc') : '#9fb4e6');
    this.hemi.intensity = isDay ? 0.75 + elev * 0.75 : 0.42;
    this.hemi.color.set(isDay ? '#f4f0ff' : '#8090c0');
    const cam = this.sun.shadow.camera;
    const half = Math.max(size.x, size.z) * 0.62 + 6;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = r * 3;
    cam.updateProjectionMatrix();
    this.renderer.toneMappingExposure = isDay ? 0.95 : 1.1;
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  info(): { calls: number; triangles: number; textures: number; geometries: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries };
  }

  dispose(): void {
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
