// Editor da aparência 3D, montado dentro do editor de personagem da gaveta (ui/character-editor.ts) quando o mundo é
// 3D: prévia girável com animação, modelo-base, cores das regiões do atlas, acessório e identificação profissional.
// O rascunho só vale ao salvar (LookStore, no navegador); "Restaurar padrão" volta ao boneco sorteado.
import * as THREE from 'three';
import type { AgentInfo } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import type { LookEditorHandle } from '../world/api';
import { attachToHead, buildAccessory, defaultAccessoryColor } from './accessories';
import { CHARACTER_MODELS, defaultModelFor, modelById, type CharacterAssets, type LoadedModel } from './assets';
import { ACCESSORIES_3D, BADGE_MAX, applyLook, atlasRegions, regionKind, toLook, type Accessory3D, type LookDraft, type LookStore, type RegionKind } from './looks';
import './editor.css';

const PREVIEW_CLIPS: readonly [string, string][] = [
  ['Idle', tr('Parado')],
  ['Walk', tr('Andando')],
  ['SitType', tr('Digitando')],
  ['Talk', tr('Conversando')],
  ['Think', tr('Pensando')],
  ['Cheer', tr('Comemorando')],
  ['Wave', tr('Acenando')],
];

const ACCESSORY_LABELS: Record<Accessory3D, string> = {
  none: tr('Nenhum'),
  glasses: tr('Óculos'),
  sunglasses: tr('Óculos escuros'),
  cap: tr('Boné'),
  beanie: tr('Gorro'),
  headphones: tr('Fone'),
  bow: tr('Laço'),
};

const REGION_LABELS: Record<RegionKind, string> = {
  hair: tr('Cabelo'),
  skin: tr('Pele'),
  top: tr('Roupa'),
  bottom: tr('Calça/saia'),
  shoes: tr('Calçados'),
  detail: tr('Detalhe'),
};

/** Quantas regiões de cor o editor mostra (as maiores; o resto são detalhes minúsculos). */
const MAX_REGIONS = 7;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function group(legend: string): { fs: HTMLFieldSetElement; body: HTMLDivElement } {
  const fs = el('fieldset', 'ui-char__group');
  fs.append(el('legend', '', legend));
  const body = el('div', 'ui-char__opts');
  fs.append(body);
  return { fs, body };
}

function chip(text: string, onPick: () => void): HTMLButtonElement {
  const b = el('button', 'ui-char__chip', text);
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', 'false');
  b.addEventListener('click', onPick);
  return b;
}

function check(buttons: HTMLButtonElement[], on: number): void {
  buttons.forEach((b, i) => b.setAttribute('aria-checked', String(i === on)));
}

export function createLookEditor(info: AgentInfo, assets: CharacterAssets, looks: LookStore): LookEditorHandle {
  const stored = looks.get(info.id, info);
  const fallback = defaultModelFor(info.seed, info.look);
  let draft: LookDraft = { model: stored.model, colors: { ...stored.colors }, accessory: stored.accessory, accessoryColor: stored.accessoryColor, badge: stored.badge };
  let clip = 'Idle';
  let disposed = false;

  const root = el('section', 'w3d-editor');
  root.setAttribute('aria-label', tr('Aparência 3D'));
  root.append(el('h3', 'w3d-editor__title', tr('Aparência 3D')));

  // ---------------------------------------------------------------- prévia
  const canvas = el('canvas', 'w3d-editor__preview');
  canvas.width = 240;
  canvas.height = 260;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', tr('Prévia 3D do personagem: arraste para girar, role para aproximar'));
  canvas.tabIndex = 0;
  const hint = el('p', 'ui-muted ui-small', tr('Arraste para girar · role para aproximar'));
  root.append(canvas, hint);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(240, 260, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 240 / 260, 0.1, 50);
  scene.add(new THREE.HemisphereLight('#f6f2ff', '#8a7a66', 1.6));
  const key = new THREE.DirectionalLight('#fff1dc', 2.4);
  key.position.set(2, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#bcd9ea', 1.2);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.06, 40), new THREE.MeshStandardMaterial({ color: '#3a3f4a', roughness: 0.6 }));
  pedestal.position.y = -0.03;
  scene.add(pedestal);
  const turntable = new THREE.Group();
  scene.add(turntable);
  let yaw = 0.35;
  let dist = 3.1;
  let body: THREE.Object3D | null = null;
  let model: LoadedModel | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  let mats: THREE.MeshStandardMaterial[] = [];
  let headBone: THREE.Object3D | null = null;
  let acc: THREE.Object3D | null = null;
  let loadSeq = 0;

  const drag = { on: false, x: 0 };
  canvas.addEventListener('pointerdown', (e) => {
    drag.on = true;
    drag.x = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag.on) return;
    yaw += (e.clientX - drag.x) * 0.012;
    drag.x = e.clientX;
  });
  canvas.addEventListener('pointerup', () => (drag.on = false));
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      dist = THREE.MathUtils.clamp(dist * Math.exp(Math.sign(e.deltaY) * 0.12), 1.6, 4.5);
    },
    { passive: false },
  );
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') yaw -= 0.2;
    else if (e.key === 'ArrowRight') yaw += 0.2;
    else if (e.key === '+' || e.key === '=') dist = Math.max(1.6, dist * 0.9);
    else if (e.key === '-') dist = Math.min(4.5, dist * 1.1);
    else return;
    e.preventDefault();
  });

  const applyPreview = () => {
    if (!model || !body) return;
    applyLook(mats, model, toLook(draft));
    acc?.parent?.remove(acc);
    acc = null;
    const a = draft.accessory ? buildAccessory(draft.accessory, model.head, draft.accessoryColor) : null;
    if (a && headBone) acc = attachToHead(headBone, a, model.head, model.scale);
  };

  const playClip = () => {
    if (!mixer || !model) return;
    mixer.stopAllAction();
    const c = model.clips.get(clip) ?? model.clips.get('Idle');
    if (c) mixer.clipAction(c).reset().play();
  };

  const loadModel = async () => {
    const def = modelById(draft.model) ?? fallback;
    const seq = ++loadSeq;
    const m = await assets.load(def);
    if (disposed || seq !== loadSeq) return;
    assets.refreshClips(m);
    if (body) {
      turntable.remove(body);
      for (const x of mats) x.dispose();
    }
    model = m;
    body = assets.instantiate(m);
    mats = [];
    body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const own = (mesh.material as THREE.MeshStandardMaterial).clone();
        mesh.material = own;
        mats.push(own);
      }
    });
    headBone = body.getObjectByName(m.bones[12] ?? '') ?? null;
    acc = null;
    turntable.add(body);
    mixer = new THREE.AnimationMixer(body);
    playClip();
    applyPreview();
    renderColors();
  };

  let raf = 0;
  let last = performance.now();
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (!drag.on) yaw += dt * 0.25;
    turntable.rotation.y = yaw;
    camera.position.set(0, 0.55 + dist * 0.18, dist);
    camera.lookAt(0, 0.5, 0);
    mixer?.update(dt);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  // ---------------------------------------------------------------- modelo
  const models = group(tr('Personagem-base'));
  const modelBtns = CHARACTER_MODELS.map((m) =>
    chip(m.label, () => {
      draft.model = m.id === fallback.id ? undefined : m.id;
      // as células do atlas mudam de um pacote para outro: as cores escolhidas não valem no novo modelo
      draft.colors = {};
      renderModel();
      void loadModel();
    }),
  );
  models.body.append(...modelBtns);
  const renderModel = () => check(modelBtns, CHARACTER_MODELS.findIndex((m) => m.id === (draft.model ?? fallback.id)));

  // ---------------------------------------------------------------- animação de prévia
  const anim = group(tr('Animação de prévia'));
  const animBtns = PREVIEW_CLIPS.map(([name, label], i) =>
    chip(label, () => {
      clip = name;
      check(animBtns, i);
      playClip();
    }),
  );
  anim.body.append(...animBtns);
  check(animBtns, 0);

  // ---------------------------------------------------------------- cores
  const colors = el('fieldset', 'ui-char__group');
  colors.append(el('legend', '', tr('Cores')));
  const colorRows = el('div', 'w3d-editor__colors');
  colors.append(colorRows);
  const renderColors = () => {
    colorRows.replaceChildren();
    if (!model) return;
    const regions = atlasRegions(model)
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_REGIONS)
      .sort((a, b) => b.height - a.height);
    const seen = new Map<RegionKind, number>();
    for (const r of regions) {
      const kind = regionKind(r);
      const n = (seen.get(kind) ?? 0) + 1;
      seen.set(kind, n);
      const row = el('label', 'w3d-editor__color');
      const name = el('span', 'ui-char__row-label', n > 1 ? `${REGION_LABELS[kind]} ${n}` : REGION_LABELS[kind]);
      const input = el('input', '');
      input.type = 'color';
      input.value = draft.colors[r.cell] ?? r.color;
      input.addEventListener('input', () => {
        if (input.value.toLowerCase() === r.color.toLowerCase()) delete draft.colors[r.cell];
        else draft.colors[r.cell] = input.value.toLowerCase();
        applyPreview();
      });
      row.append(name, input);
      colorRows.append(row);
    }
  };

  // ---------------------------------------------------------------- acessório
  const accessory = group(tr('Acessório'));
  const accBtns = ACCESSORIES_3D.map((a, i) =>
    chip(ACCESSORY_LABELS[a], () => {
      draft.accessory = a === 'none' ? undefined : a;
      if (a !== 'none' && !draft.accessoryColor) accColor.value = defaultAccessoryColor(a);
      check(accBtns, i);
      accColor.disabled = a === 'none';
      applyPreview();
    }),
  );
  const accColor = el('input', 'w3d-editor__acc-color');
  accColor.type = 'color';
  accColor.setAttribute('aria-label', tr('Cor do acessório'));
  accColor.addEventListener('input', () => {
    draft.accessoryColor = accColor.value.toLowerCase();
    applyPreview();
  });
  accessory.body.append(...accBtns, accColor);
  const renderAccessory = () => {
    const i = ACCESSORIES_3D.indexOf(draft.accessory ?? 'none');
    check(accBtns, i);
    accColor.value = draft.accessoryColor ?? defaultAccessoryColor(draft.accessory ?? 'none');
    accColor.disabled = !draft.accessory;
  };

  // ---------------------------------------------------------------- identificação
  const badgeLabel = el('label', 'ui-char__label');
  badgeLabel.append(el('span', '', tr('Identificação profissional')));
  const badge = el('input', 'ui-char__name');
  badge.type = 'text';
  badge.maxLength = BADGE_MAX;
  badge.placeholder = tr('Ex.: Revisora de código');
  badge.autocomplete = 'off';
  badge.addEventListener('input', () => {
    draft.badge = badge.value.trim() || undefined;
  });
  badgeLabel.append(badge);

  // ---------------------------------------------------------------- restaurar
  const restore = el('button', 'ui-link-btn', tr('Restaurar padrão 3D'));
  restore.type = 'button';
  restore.addEventListener('click', () => {
    draft = { colors: {} };
    badge.value = '';
    renderModel();
    renderAccessory();
    void loadModel();
  });

  const groups = el('div', 'ui-char__groups');
  groups.append(models.fs, anim.fs, colors, accessory.fs, badgeLabel, restore);
  root.append(groups);

  renderModel();
  renderAccessory();
  badge.value = draft.badge ?? '';
  void loadModel();

  return {
    el: root,
    save() {
      const empty = !draft.model && !Object.keys(draft.colors).length && !draft.accessory && !draft.badge;
      looks.set(info, empty ? null : draft);
    },
    reset() {
      looks.set(info, null);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      mixer?.stopAllAction();
      for (const x of mats) x.dispose();
      pedestal.geometry.dispose();
      (pedestal.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
    },
  };
}
