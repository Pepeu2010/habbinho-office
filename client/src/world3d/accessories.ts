// Acessórios 3D presos à cabeça (óculos, boné, gorro, fone, laço). Modelados no tamanho da cabeça de cada modelo
// (HeadInfo, medida em repouso), no referencial do osso da cabeça alinhado ao corpo: +y para cima, +z para a frente.
import * as THREE from 'three';
import type { HeadInfo } from './assets';
import { PAL, mat } from './kit';
import type { Accessory3D } from './looks';

const DEFAULT_COLOR: Record<Exclude<Accessory3D, 'none'>, string> = {
  glasses: PAL.charcoal,
  sunglasses: PAL.black,
  cap: PAL.blue,
  beanie: PAL.coral,
  headphones: PAL.charcoal,
  bow: PAL.pink,
};

export function defaultAccessoryColor(a: Accessory3D): string {
  return a === 'none' ? PAL.charcoal : DEFAULT_COLOR[a];
}

function mesh(geo: THREE.BufferGeometry, color: string, rough = 0.6, metal = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color, { rough, metal }));
  m.castShadow = true;
  return m;
}

export function buildAccessory(kind: Accessory3D, head: HeadInfo, color?: string): THREE.Group | null {
  if (kind === 'none') return null;
  const c = color ?? DEFAULT_COLOR[kind];
  const g = new THREE.Group();
  const { top, front, back, halfW } = head;
  const eyeY = top * 0.4;
  switch (kind) {
    case 'glasses':
    case 'sunglasses': {
      const r = halfW * 0.27;
      for (const sx of [-1, 1]) {
        if (kind === 'glasses') {
          const ring = mesh(new THREE.TorusGeometry(r, r * 0.16, 8, 22), c, 0.35, 0.3);
          ring.position.set(sx * halfW * 0.42, eyeY, front + r * 0.15);
          g.add(ring);
        } else {
          const lens = mesh(new THREE.CylinderGeometry(r, r, r * 0.25, 22), c, 0.15, 0.4);
          lens.rotation.x = Math.PI / 2;
          lens.position.set(sx * halfW * 0.42, eyeY, front + r * 0.2);
          g.add(lens);
        }
        const arm = mesh(new THREE.BoxGeometry(r * 0.18, r * 0.18, front + back * 0.2), c);
        arm.position.set(sx * halfW * 1.0, eyeY, (front - back * 0.2) / 2);
        g.add(arm);
      }
      const bridge = mesh(new THREE.BoxGeometry(halfW * 0.3, r * 0.18, r * 0.18), c);
      bridge.position.set(0, eyeY + r * 0.2, front + r * 0.15);
      g.add(bridge);
      break;
    }
    case 'cap': {
      const dome = mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), c, 0.85);
      dome.scale.set(halfW * 1.08, top * 0.42, (front + back) * 0.55);
      dome.position.set(0, top * 0.62, (front - back) / 2);
      const brim = mesh(new THREE.CylinderGeometry(1, 1, 0.02, 24, 1, false, -Math.PI / 2, Math.PI), c, 0.85);
      brim.scale.set(halfW * 0.95, 1, front * 0.9);
      brim.position.set(0, top * 0.64, front * 0.6);
      g.add(dome, brim);
      break;
    }
    case 'beanie': {
      const dome = mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), c, 0.95);
      dome.scale.set(halfW * 1.1, top * 0.5, (front + back) * 0.57);
      dome.position.set(0, top * 0.58, (front - back) / 2);
      const fold = mesh(new THREE.CylinderGeometry(1, 1, top * 0.14, 24), c, 0.95);
      fold.scale.set(halfW * 1.12, 1, (front + back) * 0.58);
      fold.position.set(0, top * 0.6, (front - back) / 2);
      const pom = mesh(new THREE.SphereGeometry(halfW * 0.2, 12, 10), PAL.cream, 1);
      pom.position.set(0, top * 1.1, (front - back) / 2);
      g.add(dome, fold, pom);
      break;
    }
    case 'headphones': {
      const band = mesh(new THREE.TorusGeometry(halfW * 1.08, halfW * 0.07, 8, 28, Math.PI), c, 0.5, 0.2);
      band.position.set(0, top * 0.45, (front - back) / 2 - back * 0.1);
      g.add(band);
      for (const sx of [-1, 1]) {
        const cup = mesh(new THREE.CylinderGeometry(halfW * 0.26, halfW * 0.26, halfW * 0.16, 20), c, 0.5);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(sx * halfW * 1.06, top * 0.42, (front - back) / 2 - back * 0.1);
        g.add(cup);
      }
      break;
    }
    case 'bow': {
      for (const sx of [-1, 1]) {
        const wing = mesh(new THREE.ConeGeometry(halfW * 0.22, halfW * 0.45, 12), c, 0.7);
        wing.rotation.z = (sx * Math.PI) / 2;
        wing.position.set(halfW * 0.45 + sx * halfW * 0.22, top * 0.95, -back * 0.1);
        g.add(wing);
      }
      const knot = mesh(new THREE.SphereGeometry(halfW * 0.09, 10, 8), c, 0.7);
      knot.position.set(halfW * 0.45, top * 0.95, -back * 0.1);
      g.add(knot);
      break;
    }
  }
  return g;
}

/** Prende o acessório ao osso da cabeça, compensando a rotação e a escala do esqueleto em repouso. */
export function attachToHead(headBone: THREE.Object3D, acc: THREE.Object3D, head: HeadInfo, modelScale: number): THREE.Group {
  const holder = new THREE.Group();
  holder.quaternion.copy(head.restQuat).invert();
  holder.scale.setScalar(1 / Math.max(1e-6, head.restScale * modelScale));
  holder.add(acc);
  headBone.add(holder);
  return holder;
}
