// Assets 3D: personagens chibi (Gobkit, CC0) e kit de natureza (Gobkit, CC0). Origem e licença em
// client/public/assets/3d/ASSETS.md.
//
// Todos os personagens Gobkit usam o MESMO esqueleto de 13 ossos (só os nomes dos ossos mudam de pack para pack).
// O pack "Character Pack Vol.2" (escritório) traz 28 clipes nomeados (Sit, SitType, Type, Talk, Think, Cheer...);
// eles viram uma biblioteca única aplicada a qualquer personagem, renomeando as trilhas pelo índice do osso.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { tr } from '../../../shared/i18n';

const BASE = '/assets/3d/';

/** Altura de um personagem em pé, em tiles (o escritório é desenhado para essa escala). */
export const CHAR_H = 1.0;

export interface CharacterModelDef {
  id: string;
  file: string;
  /** Rótulo no editor. */
  label: string;
  /** Família de clipes: 'office' já traz a biblioteca completa no próprio arquivo. */
  family: 'office' | 'basic';
  look: 'f' | 'm';
}

export const CHARACTER_MODELS: readonly CharacterModelDef[] = [
  { id: 'it_engineer', file: 'ItEngineer.glb', label: tr('Engenheiro de TI'), family: 'office', look: 'm' },
  { id: 'accountant', file: 'Accountant.glb', label: tr('Contadora'), family: 'office', look: 'f' },
  { id: 'ceo', file: 'CompanyCeo.glb', label: tr('Diretor'), family: 'office', look: 'm' },
  { id: 'intern', file: 'OfficeIntern.glb', label: tr('Estagiária'), family: 'office', look: 'f' },
  { id: 'manager', file: 'OfficeManager.glb', label: tr('Gerente'), family: 'office', look: 'm' },
  { id: 'receptionist', file: 'Receptionist.glb', label: tr('Recepcionista'), family: 'office', look: 'f' },
  { id: 'sales', file: 'SalesRep.glb', label: tr('Vendedor'), family: 'office', look: 'm' },
  { id: 'security', file: 'SecurityGuard.glb', label: tr('Segurança'), family: 'office', look: 'm' },
  { id: 'office_lady', file: 'OfficeLady.glb', label: tr('Analista'), family: 'basic', look: 'f' },
  { id: 'office_worker', file: 'OfficeWorker.glb', label: tr('Desenvolvedor'), family: 'basic', look: 'm' },
  { id: 'store_manager', file: 'StoreManager.glb', label: tr('Coordenadora'), family: 'basic', look: 'f' },
  { id: 'student', file: 'Student.glb', label: tr('Pesquisador'), family: 'basic', look: 'm' },
];

/** Modelo padrão de um agente: estável pela semente e respeitando o visual (f/m) do Habblaud. */
export function defaultModelFor(seed: number, look: 'f' | 'm' | undefined): CharacterModelDef {
  const pool = CHARACTER_MODELS.filter((m) => !look || m.look === look);
  return pool[Math.abs(seed) % pool.length] ?? CHARACTER_MODELS[0]!;
}

export function modelById(id: string | undefined): CharacterModelDef | undefined {
  return CHARACTER_MODELS.find((m) => m.id === id);
}

/** Um modelo carregado, pronto para clonar. */
export interface LoadedModel {
  def: CharacterModelDef;
  scene: THREE.Object3D;
  /** Escala que leva a altura do modelo a CHAR_H. */
  scale: number;
  /** Clipes da biblioteca com as trilhas renomeadas para os ossos deste modelo. */
  clips: Map<string, THREE.AnimationClip>;
  /** Nomes dos ossos (ordem do skin) — 0 = raiz, 1 = quadril, 6 = peito, 8 = mão esq., 10 = mão dir., 12 = cabeça. */
  bones: string[];
  /** Cores do atlas usadas pela malha (para o editor recolorir), por região. */
  atlas: THREE.Texture | null;
  /** Medidas da cabeça em repouso (acessórios), em tiles, no referencial do osso da cabeça alinhado ao corpo. */
  head: HeadInfo;
}

export interface HeadInfo {
  /** Do osso da cabeça até o topo, a frente, a nuca e a lateral. */
  top: number;
  front: number;
  back: number;
  halfW: number;
  /** Rotação e escala do osso da cabeça em relação à raiz do modelo, em repouso. */
  restQuat: THREE.Quaternion;
  restScale: number;
}

/** Caixa da cabeça: vértices acima do osso da cabeça, medidos na pose de repouso. */
function measureHead(scene: THREE.Object3D, bones: string[], scale: number): HeadInfo {
  scene.updateMatrixWorld(true);
  const head = scene.getObjectByName(bones[BONE.head] ?? '');
  const fallback: HeadInfo = { top: 0.42, front: 0.2, back: 0.2, halfW: 0.22, restQuat: new THREE.Quaternion(), restScale: 1 };
  if (!head) return fallback;
  const hp = head.getWorldPosition(new THREE.Vector3());
  const hq = head.getWorldQuaternion(new THREE.Quaternion());
  const hs = head.getWorldScale(new THREE.Vector3()).x;
  // o repouso é a pose T: os braços ficam na altura do osso da cabeça. Só conta o que está bem acima dos ombros.
  const pts: THREE.Vector3[] = [];
  let maxY = -Infinity;
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3();
      if (m.isSkinnedMesh) m.getVertexPosition(i, v);
      else v.fromBufferAttribute(pos, i);
      v.applyMatrix4(m.matrixWorld);
      if (v.y > hp.y) pts.push(v);
      maxY = Math.max(maxY, v.y);
    }
  });
  const cut = hp.y + (maxY - hp.y) * 0.25;
  const box = new THREE.Box3();
  for (const v of pts) if (v.y > cut) box.expandByPoint(v);
  if (box.isEmpty()) return fallback;
  return {
    top: (box.max.y - hp.y) * scale,
    front: (box.max.z - hp.z) * scale,
    back: (hp.z - box.min.z) * scale,
    halfW: (Math.max(box.max.x - hp.x, hp.x - box.min.x)) * scale,
    restQuat: hq,
    restScale: hs,
  };
}

export const BONE = { root: 0, hips: 1, legL: 2, footL: 3, legR: 4, footR: 5, chest: 6, armL: 7, handL: 8, armR: 9, handR: 10, neck: 11, head: 12 } as const;

const loader = new GLTFLoader();

function loadGltf(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

function skinBones(root: THREE.Object3D): string[] {
  let names: string[] = [];
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh && !names.length) names = sm.skeleton.bones.map((b) => b.name);
  });
  return names;
}

function restHipsHeight(root: THREE.Object3D, bones: string[]): number {
  const hips = root.getObjectByName(bones[BONE.hips] ?? '');
  return hips ? Math.abs(hips.position.y) || 1 : 1;
}

/**
 * Biblioteca de animações: clipes do pack de escritório, no esqueleto de referência. Só trilhas de rotação (e a
 * translação do quadril, escalada para as proporções do alvo): é o retarget padrão entre esqueletos iguais.
 */
class ClipLibrary {
  refBones: string[] = [];
  refHips = 1;
  readonly clips = new Map<string, THREE.AnimationClip>();

  add(gltf: GLTF, bones: string[], hips: number): void {
    if (!this.refBones.length) {
      this.refBones = bones;
      this.refHips = hips;
    }
    for (const clip of gltf.animations) {
      if (this.clips.has(clip.name)) continue;
      const tracks: THREE.KeyframeTrack[] = [];
      for (const t of clip.tracks) {
        const dot = t.name.lastIndexOf('.');
        const node = t.name.slice(0, dot);
        const prop = t.name.slice(dot + 1);
        const idx = bones.indexOf(node);
        if (idx < 0 || prop === 'scale') continue;
        if (prop === 'position' && idx !== BONE.hips) continue;
        const c = t.clone();
        // normaliza para o esqueleto de referência
        c.name = `${this.refBones[idx]}.${prop}`;
        if (prop === 'position' && hips !== this.refHips) {
          const k = this.refHips / hips;
          for (let i = 0; i < c.values.length; i++) c.values[i]! *= k;
        }
        tracks.push(c);
      }
      this.clips.set(clip.name, new THREE.AnimationClip(clip.name, clip.duration, tracks));
    }
  }

  /** Clipes renomeados para os ossos de um modelo (mesma hierarquia, outros nomes). */
  forModel(bones: string[], hips: number): Map<string, THREE.AnimationClip> {
    const out = new Map<string, THREE.AnimationClip>();
    const k = hips / this.refHips;
    for (const [name, clip] of this.clips) {
      const tracks = clip.tracks.map((t) => {
        const dot = t.name.lastIndexOf('.');
        const idx = this.refBones.indexOf(t.name.slice(0, dot));
        const prop = t.name.slice(dot + 1);
        const c = t.clone();
        c.name = `${bones[idx]}.${prop}`;
        if (prop === 'position' && k !== 1) for (let i = 0; i < c.values.length; i++) c.values[i]! *= k;
        return c;
      });
      out.set(name, new THREE.AnimationClip(name, clip.duration, tracks));
    }
    return out;
  }
}

/** Arquivos do pack de escritório que completam a biblioteca (cada um traz alguns clipes exclusivos). */
const LIBRARY_FILES = ['ItEngineer.glb', 'CompanyCeo.glb', 'OfficeManager.glb', 'Receptionist.glb', 'SalesRep.glb', 'Accountant.glb'];

export class CharacterAssets {
  private library = new ClipLibrary();
  private libraryReady: Promise<void>;
  private models = new Map<string, Promise<LoadedModel>>();
  private gltfs = new Map<string, Promise<GLTF>>();

  constructor() {
    // a biblioteca básica (ItEngineer) primeiro: ela define o esqueleto de referência
    this.libraryReady = this.gltf(LIBRARY_FILES[0]!).then((g) => {
      const bones = skinBones(g.scene);
      this.library.add(g, bones, restHipsHeight(g.scene, bones));
    });
    // os demais clipes chegam em segundo plano e entram na biblioteca quando prontos
    void this.libraryReady.then(() =>
      Promise.all(
        LIBRARY_FILES.slice(1).map((f) =>
          this.gltf(f)
            .then((g) => {
              const bones = skinBones(g.scene);
              this.library.add(g, bones, restHipsHeight(g.scene, bones));
            })
            .catch(() => undefined),
        ),
      ),
    );
  }

  private gltf(file: string): Promise<GLTF> {
    let p = this.gltfs.get(file);
    if (!p) {
      p = loadGltf(BASE + 'characters/' + file);
      this.gltfs.set(file, p);
    }
    return p;
  }

  /** Clipes conhecidos agora (a biblioteca cresce enquanto os arquivos chegam). */
  clipNames(): string[] {
    return [...this.library.clips.keys()];
  }

  load(def: CharacterModelDef): Promise<LoadedModel> {
    let p = this.models.get(def.id);
    if (!p) {
      p = Promise.all([this.gltf(def.file), this.libraryReady]).then(([g]) => {
        const scene = g.scene;
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = false;
            m.frustumCulled = false;
            const mm = m.material as THREE.MeshStandardMaterial;
            if (mm && 'roughness' in mm) {
              mm.roughness = 0.82;
              mm.metalness = 0;
            }
          }
        });
        const bones = skinBones(scene);
        const hips = restHipsHeight(scene, bones);
        const box = new THREE.Box3().setFromObject(scene, true);
        const height = Math.max(1e-4, box.max.y - box.min.y);
        let atlas: THREE.Texture | null = null;
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && !atlas) atlas = (m.material as THREE.MeshStandardMaterial).map ?? null;
        });
        const model: LoadedModel = {
          def,
          scene,
          scale: CHAR_H / height,
          clips: this.library.forModel(bones, hips),
          bones,
          atlas,
          head: measureHead(scene, bones, CHAR_H / height),
        };
        return model;
      });
      this.models.set(def.id, p);
    }
    return p;
  }

  /** Clipes renomeados atualizados (quando a biblioteca ganhou clipes depois do primeiro carregamento). */
  refreshClips(model: LoadedModel): void {
    if (model.clips.size >= this.library.clips.size) return;
    const hips = restHipsHeight(model.scene, model.bones);
    model.clips = this.library.forModel(model.bones, hips);
  }

  /** Cópia independente (esqueleto próprio) de um modelo carregado. */
  instantiate(model: LoadedModel): THREE.Object3D {
    const o = SkeletonUtils.clone(model.scene);
    o.scale.setScalar(model.scale);
    return o;
  }
}

// ------------------------------------------------------------------ natureza

const NATURE_FILES = ['Bush001', 'Bush002', 'TreeLow001', 'TreeLow002', 'TreeLow003', 'TreeLow004', 'TreeMed001', 'TreeMed002', 'TreeMed003', 'Rock001', 'Rock002', 'Grass001', 'Grass002', 'Grass003', 'Reed001'];

export class NatureKit {
  private items = new Map<string, THREE.Object3D[]>();

  /** Um modelo do grupo (prefixo do nome do arquivo), escolhido pela semente; escala 1 = 1 tile de altura. */
  pick(prefix: string, seed: number): THREE.Object3D | null {
    const list = this.items.get(prefix);
    if (!list?.length) return null;
    return list[Math.abs(seed) % list.length]!;
  }

  static async load(): Promise<NatureKit> {
    const kit = new NatureKit();
    await Promise.all(
      NATURE_FILES.map(async (name) => {
        try {
          const g = await loadGltf(`${BASE}nature/${name}.glb`);
          const box = new THREE.Box3().setFromObject(g.scene);
          const h = Math.max(1e-4, box.max.y - box.min.y);
          const holder = new THREE.Group();
          g.scene.scale.setScalar(1 / h);
          g.scene.position.y = -box.min.y / h;
          g.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.castShadow = true;
              m.receiveShadow = true;
            }
          });
          holder.add(g.scene);
          const prefix = name.replace(/\d+$/, '');
          const list = kit.items.get(prefix) ?? [];
          list.push(holder);
          kit.items.set(prefix, list);
        } catch {
          // sem o modelo, o mundo usa a versão procedural
        }
      }),
    );
    return kit;
  }
}
