// Retratos 3D para a UI (lista de agentes, gaveta, feed): o busto do Habbinho de cada agente, desenhado uma vez numa
// tela pequena fora da cena e guardado como data URL. Registrado em ../portraits.ts pelo mundo 3D.
import * as THREE from 'three';
import { partsKey } from '../../../shared/appearance';
import { appearanceFromSeed } from '../art';
import { notifyPortraits, type PortraitRequest } from '../portraits';
import { defaultModelFor, type CharacterAssets, type LoadedModel } from './assets';
import { ChibiFace, chibiMaterials, dressChibi } from './chibi';

export class Portraits3D {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(20, 1, 0.1, 20);
  private body: THREE.Object3D | null = null;
  private model: LoadedModel | null = null;
  private face = new ChibiFace();
  private mats = chibiMaterials(this.face);
  private cache = new Map<string, string>();
  private disposed = false;

  constructor(assets: CharacterAssets) {
    this.scene.add(new THREE.HemisphereLight('#f6f2ff', '#7d7090', 1.9));
    const key = new THREE.DirectionalLight('#fff1dc', 2.6);
    key.position.set(1.5, 3, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#b9c6ff', 1.4);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);
    void assets.load(defaultModelFor()).then((m) => {
      if (this.disposed) return;
      assets.refreshClips(m);
      this.model = m;
      this.body = assets.instantiate(m);
      this.body.rotation.y = 0.32;
      this.scene.add(this.body);
      // pose de repouso natural (braços baixos), parada num quadro
      const idle = m.clips.get('Idle');
      if (idle) {
        const mixer = new THREE.AnimationMixer(this.body);
        mixer.clipAction(idle).play();
        mixer.update(0.6);
      }
      this.body.updateMatrixWorld(true);
      // enquadra cabeça e ombros
      const head = m.rig.headC.clone().multiplyScalar(m.scale);
      this.camera.position.set(head.x + 0.38, head.y + 0.1, head.z + 2.0);
      this.camera.lookAt(head.x, head.y - 0.06, head.z);
      notifyPortraits();
    });
  }

  get(r: PortraitRequest): string | null {
    if (!this.body || !this.model || this.disposed) return null;
    const key = `${r.seed}|${r.look ?? '-'}|${r.sub ? 1 : 0}|${r.px}|${partsKey(r.parts)}`;
    let url = this.cache.get(key);
    if (url) return url;
    try {
      this.renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NeutralToneMapping;
      this.renderer.setClearColor(0x000000, 0);
      const side = Math.max(16, Math.round(r.px * 2));
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(side, side, false);
      dressChibi(this.body, this.model.rig, appearanceFromSeed(r.seed, { look: r.look, sub: r.sub, parts: r.parts }), this.mats);
      this.renderer.render(this.scene, this.camera);
      url = this.renderer.domElement.toDataURL('image/png');
      this.cache.set(key, url);
      return url;
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.mats.body.dispose();
    this.mats.face.dispose();
    this.face.dispose();
  }
}
