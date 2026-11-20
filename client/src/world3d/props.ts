// Móveis prontos (CC0) baixados para o escritório: Kenney "Furniture Kit" e KayKit "Furniture Bits" (Kay Lousberg).
// Origem e licenças em client/public/assets/3d/ASSETS.md. Cada modelo é normalizado uma vez (centro no chão, frente
// para +z) e clonado com os MESMOS materiais, para o mergeStatic juntar tudo em poucos draw calls. Enquanto não
// carregam (ou se falharem), furniture.ts usa as versões procedurais.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = '/assets/3d/office/';

export const PROP_FILES = {
  chairDesk: 'kenney/chairDesk.glb',
  computerScreen: 'kenney/computerScreen.glb',
  computerKeyboard: 'kenney/computerKeyboard.glb',
  computerMouse: 'kenney/computerMouse.glb',
  laptop: 'kenney/laptop.glb',
  coffeeMachine: 'kenney/kitchenCoffeeMachine.glb',
  fridge: 'kenney/kitchenFridgeLarge.glb',
  microwave: 'kenney/kitchenMicrowave.glb',
  trashcan: 'kenney/trashcan.glb',
  toilet: 'kenney/toilet.glb',
  bathroomSink: 'kenney/bathroomSink.glb',
  pottedPlant: 'kenney/pottedPlant.glb',
  plantSmall1: 'kenney/plantSmall1.glb',
  plantSmall2: 'kenney/plantSmall2.glb',
  plantSmall3: 'kenney/plantSmall3.glb',
  tableRound: 'kenney/tableRound.glb',
  tv: 'kenney/televisionModern.glb',
  speaker: 'kenney/speaker.glb',
  radio: 'kenney/radio.glb',
  coatRack: 'kenney/coatRackStanding.glb',
  books: 'kenney/books.glb',
  armchair: 'kaykit/armchair_pillows.gltf',
  couch: 'kaykit/couch_pillows.gltf',
  cactusM1: 'kaykit/cactus_medium_A.gltf',
  cactusM2: 'kaykit/cactus_medium_B.gltf',
  cactusS1: 'kaykit/cactus_small_A.gltf',
  cactusS2: 'kaykit/cactus_small_B.gltf',
  lamp: 'kaykit/lamp_standing.gltf',
  woodChair: 'kaykit/chair_A_wood.gltf',
  stool: 'kaykit/chair_stool.gltf',
  lowTable: 'kaykit/table_low.gltf',
  bookSet: 'kaykit/book_set.gltf',
  frameM: 'kaykit/pictureframe_medium.gltf',
  frameL: 'kaykit/pictureframe_large_A.gltf',
  shelfDecor: 'kaykit/shelf_B_large_decorated.gltf',
} as const;

export type PropName = keyof typeof PROP_FILES;

/** Tamanho desejado: a escala é uniforme e vem do primeiro eixo informado (h, depois w, depois d). */
export interface Fit {
  h?: number;
  w?: number;
  d?: number;
}

const templates = new Map<PropName, { obj: THREE.Object3D; size: THREE.Vector3 }>();
const recolored = new Map<string, THREE.Material>();
let loading: Promise<void> | null = null;

/** Carrega todos os modelos (uma vez). Resolve mesmo com falhas: quem faltar fica procedural. */
export function loadProps(): Promise<void> {
  loading ??= (async () => {
    const loader = new GLTFLoader();
    await Promise.all(
      (Object.entries(PROP_FILES) as [PropName, string][]).map(async ([name, file]) => {
        try {
          const g = await loader.loadAsync(BASE + file);
          const obj = g.scene;
          obj.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(obj);
          const c = box.getCenter(new THREE.Vector3());
          // centro no chão, origem no meio da base
          const inner = new THREE.Group();
          for (const ch of [...obj.children]) inner.add(ch);
          inner.position.set(-c.x, -box.min.y, -c.z);
          const root = new THREE.Group();
          root.add(inner);
          root.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            m.castShadow = true;
            m.receiveShadow = true;
            for (const mm of Array.isArray(m.material) ? m.material : [m.material]) {
              const s = mm as THREE.MeshStandardMaterial;
              if ('roughness' in s) {
                s.roughness = Math.max(s.roughness, 0.6);
                s.metalness = Math.min(s.metalness, 0.15);
              }
            }
          });
          templates.set(name, { obj: root, size: box.getSize(new THREE.Vector3()) });
        } catch {
          // sem rede/arquivo: fica a versão procedural
        }
      }),
    );
  })();
  return loading;
}

export function hasProp(name: PropName): boolean {
  return templates.has(name);
}

/**
 * Cópia de um modelo, com a base no chão centrada na origem e frente para +z, escalada para `fit`. `colors` troca a
 * cor de materiais pelo nome (ex.: o estofado da cadeira), com materiais compartilhados por cor.
 */
export function prop(name: PropName, fit: Fit, colors?: Record<string, string>): THREE.Object3D | null {
  const t = templates.get(name);
  if (!t) return null;
  const o = t.obj.clone(true);
  const k = fit.h !== undefined ? fit.h / t.size.y : fit.w !== undefined ? fit.w / t.size.x : fit.d !== undefined ? fit.d / t.size.z : 1;
  o.scale.setScalar(k);
  if (colors) {
    o.traverse((x) => {
      const m = x as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const c = colors[m.material.name];
      if (!c) return;
      const key = `${m.material.uuid}:${c}`;
      let mm = recolored.get(key);
      if (!mm) {
        mm = (m.material as THREE.MeshStandardMaterial).clone();
        (mm as THREE.MeshStandardMaterial).color.set(c);
        recolored.set(key, mm);
      }
      m.material = mm;
    });
  }
  return o;
}

/**
 * Caixa (no referencial do pai) das peças de um material, só com os vértices acima de `minFrac` da altura do modelo —
 * ex.: o painel da tela do monitor sem o pé.
 */
export function partBox(o: THREE.Object3D, material: string, minFrac = 0.3): THREE.Box3 {
  const parent = o.parent;
  parent?.updateMatrixWorld(true);
  const inv = parent ? parent.matrixWorld.clone().invert() : new THREE.Matrix4();
  const pts: THREE.Vector3[] = [];
  const all = new THREE.Box3();
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh) return;
    const toParent = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    const mine = !Array.isArray(m.material) && m.material.name === material;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toParent);
      all.expandByPoint(v);
      if (mine) pts.push(v);
    }
  });
  const cut = all.min.y + (all.max.y - all.min.y) * minFrac;
  const box = new THREE.Box3();
  for (const v of pts) if (v.y >= cut) box.expandByPoint(v);
  return box;
}
