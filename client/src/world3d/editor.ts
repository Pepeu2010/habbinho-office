// Prévia 3D do personagem dentro do editor de personagem da gaveta (ui/character-editor.ts), quando o mundo é 3D:
// o Habbinho vestido com a aparência EM EDIÇÃO (cada escolha nos campos aparece na hora), girável, com animações e
// expressões de exemplo, e a identificação profissional (só do 3D). O resto da aparência é salvo pelo editor da
// gaveta no servidor e vale para o 2D e o 3D.
import * as THREE from 'three';
import type { AgentInfo } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import type { Appearance } from '../art/api';
import type { LookEditorHandle } from '../world/api';
import { defaultModelFor, type CharacterAssets, type LoadedModel } from './assets';
import { ChibiFace, chibiKey, chibiMaterials, dressChibi, type Expression } from './chibi';
import { BADGE_MAX, type LookDraft, type LookStore } from './looks';
import './editor.css';

const PREVIEW_CLIPS: readonly [string, string, Expression][] = [
  ['Idle', tr('Parado'), 'neutral'],
  ['Walk', tr('Andando'), 'neutral'],
  ['SitType', tr('Digitando'), 'focused'],
  ['Talk', tr('Conversando'), 'talk'],
  ['Think', tr('Pensando'), 'focused'],
  ['Cheer', tr('Comemorando'), 'happy'],
  ['Wave', tr('Acenando'), 'happy'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createLookEditor(info: AgentInfo, assets: CharacterAssets, looks: LookStore, appearance: Appearance): LookEditorHandle {
  const draft: LookDraft = { badge: looks.get(info.id, info).badge };
  let current = appearance;
  let clip = 0;
  let disposed = false;

  const root = el('section', 'w3d-editor');
  root.setAttribute('aria-label', tr('Prévia 3D'));

  const W = 260;
  const HGT = 300;
  const canvas = el('canvas', 'w3d-editor__preview');
  canvas.width = W;
  canvas.height = HGT;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', tr('Prévia 3D do personagem: arraste para girar, role para aproximar'));
  canvas.tabIndex = 0;
  root.append(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, HGT, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, W / HGT, 0.1, 50);
  scene.add(new THREE.HemisphereLight('#f6f2ff', '#8a7a66', 1.7));
  const key = new THREE.DirectionalLight('#fff1dc', 2.4);
  key.position.set(2, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#bcd9ea', 1.3);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.06, 48), new THREE.MeshStandardMaterial({ color: '#e9e3f5', roughness: 0.6 }));
  pedestal.position.y = -0.03;
  scene.add(pedestal);
  const turntable = new THREE.Group();
  scene.add(turntable);
  let yaw = 0.35;
  let dist = 3.6;
  let body: THREE.Object3D | null = null;
  let model: LoadedModel | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  const face = new ChibiFace();
  const mats = chibiMaterials(face);
  let dressed = '';

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

  const dress = () => {
    if (!body || !model || chibiKey(current) === dressed) return;
    dressed = chibiKey(current);
    dressChibi(body, model.rig, current, mats, face);
  };

  const playClip = () => {
    if (!mixer || !model) return;
    mixer.stopAllAction();
    const c = model.clips.get(PREVIEW_CLIPS[clip]![0]) ?? model.clips.get('Idle');
    if (c) mixer.clipAction(c).reset().play();
  };

  void assets.load(defaultModelFor()).then((m) => {
    if (disposed) return;
    assets.refreshClips(m);
    model = m;
    body = assets.instantiate(m);
    turntable.add(body);
    mixer = new THREE.AnimationMixer(body);
    dress();
    playClip();
  });

  let raf = 0;
  let last = performance.now();
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (!drag.on) yaw += dt * 0.25;
    turntable.rotation.y = yaw;
    camera.position.set(0, 0.75 + dist * 0.1, dist);
    camera.lookAt(0, 0.5, 0);
    mixer?.update(dt);
    face.update(PREVIEW_CLIPS[clip]![2], t, Math.random);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  // ---------------------------------------------------------------- animação de prévia
  const anim = el('div', 'w3d-editor__anims');
  anim.setAttribute('role', 'radiogroup');
  anim.setAttribute('aria-label', tr('Animação de prévia'));
  const animBtns = PREVIEW_CLIPS.map(([, label], i) => {
    const b = el('button', 'ui-char__chip', label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      clip = i;
      animBtns.forEach((x, k) => x.setAttribute('aria-checked', String(k === i)));
      playClip();
    });
    return b;
  });
  animBtns.forEach((x, k) => x.setAttribute('aria-checked', String(k === 0)));
  anim.append(...animBtns);

  // ---------------------------------------------------------------- identificação
  const badgeLabel = el('label', 'ui-char__label');
  badgeLabel.append(el('span', '', tr('Identificação profissional')));
  const badge = el('input', 'ui-char__name');
  badge.type = 'text';
  badge.maxLength = BADGE_MAX;
  badge.placeholder = tr('Ex.: Revisora de código');
  badge.autocomplete = 'off';
  badge.value = draft.badge ?? '';
  badge.addEventListener('input', () => {
    draft.badge = badge.value.trim() || undefined;
  });
  badgeLabel.append(badge);

  root.append(anim, el('p', 'ui-muted ui-small', tr('Arraste para girar · role para aproximar')), badgeLabel);

  return {
    el: root,
    preview(a: Appearance) {
      current = a;
      dress();
    },
    save() {
      looks.set(info, draft.badge ? draft : null);
    },
    reset() {
      looks.set(info, null);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      mixer?.stopAllAction();
      mats.body.dispose();
      mats.face.dispose();
      face.dispose();
      pedestal.geometry.dispose();
      (pedestal.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
    },
  };
}
