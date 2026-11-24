// Assets 3D: esqueleto e animações dos personagens (Gobkit, CC0; o visual é o Habbinho, chibi.ts) e kit de natureza
// (Gobkit, CC0). Origem e licença em
// client/public/assets/3d/ASSETS.md.
//
// Todos os personagens Gobkit usam o MESMO esqueleto de 13 ossos (só os nomes dos ossos mudam de pack para pack).
// O pack "Character Pack Vol.2" (escritório) traz 28 clipes nomeados (Sit, SitType, Type, Talk, Think, Cheer...);
// eles viram uma biblioteca única aplicada a qualquer personagem, renomeando as trilhas pelo índice do osso.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { tr } from '../../../shared/i18n';
import { measureRig, type ChibiRig } from './chibi';

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

/**
 * Personagem: o Habbinho (chibi.ts), modelado em código a partir da aparência do agente. O arquivo Gobkit só fornece o
 * esqueleto e as animações (a malha dele é descartada).
 */
export const CHARACTER_MODELS: readonly CharacterModelDef[] = [{ id: 'habbinho', file: 'CompanyCeo.glb', label: tr('Habbinho'), family: 'office', look: 'm' }];
/** Modelo padrão de um agente: estável pela semente e respeitando o visual (f/m) do Habblaud. */
export function defaultModelFor(_seed?: number, _look?: 'f' | 'm'): CharacterModelDef {
  return CHARACTER_MODELS[0]!;
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
  /** Medidas do esqueleto em repouso, para vestir o Habbinho. */
  rig: ChibiRig;
}

const COLLECTION = ['ceo', 'developer', 'designer', 'data-analyst', 'marketing', 'hr', 'support', 'finance', 'sales', 'intern'] as const;
export type CollectionId = typeof COLLECTION[number];

export interface CollectionModel {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  scale: number;
}

/** Escala extra por osso do elenco: cabeção e mãos/pés redondinhos, como bonecos de vinil. */
export const COZY_BONES: ReadonlyArray<readonly [string, number]> = [
  ['Head', 1.32],
  ['Hand.L', 1.35],
  ['Hand.R', 1.35],
  ['Foot.L', 1.2],
  ['Foot.R', 1.2],
];
/** Tronco: largura e altura relativas. */
export const COZY_TORSO = [1.1, 0.94] as const;

/** A semente escolhe o boneco sem alterar a identidade salva do agente. */
export function collectionFor(seed: number): CollectionId {
  return COLLECTION[(seed >>> 0) % COLLECTION.length]!;
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
// o Diretor primeiro: ele não segura objeto, então os clipes dele têm os braços livres (os outros completam o que faltar)
const LIBRARY_FILES = ['CompanyCeo.glb', 'ItEngineer.glb', 'OfficeManager.glb', 'Receptionist.glb', 'SalesRep.glb', 'Accountant.glb'];

export class CharacterAssets {
  private library = new ClipLibrary();
  private libraryReady: Promise<void>;
  private models = new Map<string, Promise<LoadedModel>>();
  private gltfs = new Map<string, Promise<GLTF>>();
  private collection = new Map<CollectionId, Promise<CollectionModel>>();

  loadCollection(seed: number, look?: CollectionId): Promise<CollectionModel> {
    const id = look ?? collectionFor(seed);
    let pending = this.collection.get(id);
    if (!pending) {
      pending = loadGltf(`${BASE}office-collection/characters/${id}.glb`).then(({ scene, animations }) => {
        // proporções "cozy": cabeça, mãos e pés maiores; nenhum clipe anima a escala desses ossos, então vale para sempre
        const bone = (name: string) => scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
        for (const [name, k] of COZY_BONES) bone(name)?.scale.setScalar(k);
        // tronco mais gordinho; os filhos desfazem a escala para braços e cabeça não esticarem
        const [sw, sy] = COZY_TORSO;
        bone('Spine')?.scale.set(sw, sy, sw);
        for (const name of ['Clavicle.L', 'Clavicle.R', 'Neck']) bone(name)?.scale.set(1 / sw, 1 / sy, 1 / sw);
        scene.updateMatrixWorld(true);
        scene.traverse((o) => {
          const mesh = o as THREE.SkinnedMesh;
          if (mesh.isSkinnedMesh) {
            mesh.castShadow = true;
            mesh.computeBoundingSphere();
            if (mesh.boundingSphere) mesh.boundingSphere.radius += 0.35;
          }
        });
        // A escala do elenco é comum, inclusive nas mãos e nos encaixes dos móveis.
        return { scene, scale: 1, clips: new Map(animations.map((clip) => [clip.name, clip])) };
      });
      this.collection.set(id, pending);
    }
    return pending;
  }

  constructor() {
    // o primeiro arquivo da biblioteca define o esqueleto de referência
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
        const rig = measureRig(scene, bones);
        const model: LoadedModel = {
          def,
          scene,
          scale: CHAR_H / rig.height,
          clips: this.library.forModel(bones, hips),
          bones,
          rig,
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
  instantiate(model: LoadedModel | CollectionModel): THREE.Object3D {
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
