// "Habbinho": o personagem 3D original do Habblaud, modelado em código a partir da MESMA aparência que o agente tem no
// 2D (art/api: Appearance — pele, cabelo e penteado, olhos, roupa, calça/short/saia, calçados, acessório, barba,
// crachá). Assim o editor de personagem da gaveta vale para os dois mundos, e cada agente tem um visual próprio.
//
// Malha: peças arredondadas (esferas, cápsulas, tornos) unidas numa só geometria com cor por vértice (1 draw call),
// presa com pesos rígidos/suaves ao esqueleto de 13 ossos dos clipes Gobkit (CC0), que só fornecem o MOVIMENTO
// (andar, sentar, digitar, comemorar...). O rosto é uma calota com textura de expressões (piscar, alegre, preocupado,
// dormindo, falando, surpreso, concentrado), desenhada em canvas: nada de imagem externa.
//
// Unidades: o esqueleto é medido em repouso (pose T) e tudo é dimensionado por `u` (≈ 1/3,6 da distância quadril →
// osso da cabeça). Frente = +z, cima = +y.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Appearance } from '../art/api';
import { BONE } from './assets';

export interface ChibiRig {
  /** Juntas em repouso, no espaço do modelo-base (sem escala). */
  j: Record<keyof typeof BONE, THREE.Vector3>;
  u: number;
  /** Inversas das matrizes dos ossos em repouso (para prender a malha nova ao esqueleto de cada clone). */
  inverses: THREE.Matrix4[];
  /** Altura total do boneco (pés ao topo da cabeça), no espaço do modelo-base. */
  height: number;
  /** Centro e raio da cabeça. */
  headC: THREE.Vector3;
  headR: number;
  /** Mão visível (o braço é modelado mais baixo que a pose T do esqueleto), no referencial do osso do braço. */
  handL: THREE.Vector3;
  handR: THREE.Vector3;
}

/** Quanto o braço do Habbinho fica abaixo do osso (rad): os clipes foram feitos para um corpo largo. */
const ARM_DROP = 0.5;

/** Gira um ponto do braço para baixo em torno do ombro. */
function dropArm(p: THREE.Vector3, shoulder: THREE.Vector3, dir: number): THREE.Vector3 {
  return p.clone().sub(shoulder).applyAxisAngle(new THREE.Vector3(0, 0, 1), -dir * ARM_DROP).add(shoulder);
}

/** Proporções da cabeça (achatada e um pouco mais larga: chibi). */
const HEAD_S = new THREE.Vector3(1.06, 0.95, 1.0);

export function measureRig(scene: THREE.Object3D, bones: string[]): ChibiRig {
  scene.updateMatrixWorld(true);
  const objs = bones.map((n) => scene.getObjectByName(n) ?? null);
  const pos = (i: number) => objs[i]?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  const j = Object.fromEntries(Object.entries(BONE).map(([k, i]) => [k, pos(i)])) as ChibiRig['j'];
  const u = Math.max(1e-6, (j.head.y - j.hips.y) / 3.634);
  const inverses = objs.map((o) => (o ? o.matrixWorld.clone().invert() : new THREE.Matrix4()));
  const headR = 2.05 * u;
  const headC = new THREE.Vector3(j.hips.x, j.head.y + 0.32 * u, j.head.z + 0.05 * u);
  const ground = (j.footL.y + j.footR.y) / 2 - 1.09 * u;
  const vis = (arm: THREE.Vector3, hand: THREE.Vector3, bone: number) => dropArm(hand, arm, Math.sign(hand.x - arm.x) || 1).applyMatrix4(inverses[bone]!);
  return { j, u, inverses, height: headC.y + headR * HEAD_S.y - ground, headC, headR, handL: vis(j.armL, j.handL, BONE.armL), handR: vis(j.armR, j.handR, BONE.armR) };
}

// ------------------------------------------------------------------ montagem

type Weight = [number, number, number];
type ColorFn = THREE.ColorRepresentation | ((p: THREE.Vector3) => THREE.ColorRepresentation);

class Parts {
  readonly list: THREE.BufferGeometry[] = [];
  private c = new THREE.Color();

  add(geo: THREE.BufferGeometry, color: ColorFn, m: THREE.Matrix4 | null, weight: Weight | ((p: THREE.Vector3) => Weight)): void {
    const g = geo;
    if (m) g.applyMatrix4(m);
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    const pos = g.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    const col = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      this.c.set(typeof color === 'function' ? color(p) : color);
      col.set([this.c.r, this.c.g, this.c.b], i * 3);
      const [a, b, t] = typeof weight === 'function' ? weight(p) : weight;
      si[i * 4] = a;
      si[i * 4 + 1] = b;
      sw[i * 4] = 1 - t;
      sw[i * 4 + 1] = t;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.list.push(g);
  }

  build(): THREE.BufferGeometry {
    const indexed = this.list.map((g) => (g.index ? g : indexOf(g)));
    const out = mergeGeometries(indexed, false)!;
    out.computeBoundingSphere();
    return out;
  }
}

function indexOf(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = (g.attributes.position as THREE.BufferAttribute).count;
  g.setIndex([...Array(n).keys()]);
  return g;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Matriz de posição/rotação/escala. */
function M(p: THREE.Vector3, rot?: THREE.Euler | THREE.Quaternion, s: THREE.Vector3 | number = 1): THREE.Matrix4 {
  const q = rot instanceof THREE.Quaternion ? rot : new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler());
  return new THREE.Matrix4().compose(p, q, typeof s === 'number' ? v3(s, s, s) : s);
}

/** Orienta o eixo +y de uma geometria de a até b (cápsulas e cilindros). */
function along(a: THREE.Vector3, b: THREE.Vector3): { mid: THREE.Vector3; q: THREE.Quaternion; len: number } {
  const d = b.clone().sub(a);
  const len = d.length();
  return { mid: a.clone().add(b).multiplyScalar(0.5), q: new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), d.normalize()), len };
}

function capsule(parts: Parts, a: THREE.Vector3, b: THREE.Vector3, r: number, color: ColorFn, w: Weight | ((p: THREE.Vector3) => Weight), seg = 12): void {
  const { mid, q, len } = along(a, b);
  parts.add(new THREE.CapsuleGeometry(r, Math.max(1e-4, len), 4, seg), color, M(mid, q), w);
}

/** Ponto na esfera unitária: θ a partir do topo, φ ao redor (φ = π/2 é a frente, +z). */
function sph(theta: number, phi: number, k = 1): THREE.Vector3 {
  return v3(-Math.cos(phi) * Math.sin(theta) * k, Math.cos(theta) * k, Math.sin(phi) * Math.sin(theta) * k);
}

const FRONT = Math.PI / 2;

function mix(a: string, b: string, t: number): string {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

function shade(c: string, k: number): string {
  const col = new THREE.Color(c);
  const hsl = { h: 0, s: 0, l: 0 };
  col.getHSL(hsl);
  col.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l * k, 0, 1));
  return '#' + col.getHexString();
}

const LONG_SLEEVES = new Set(['hoodie', 'sweater', 'jacket', 'shirt_tie']);

export interface ChibiGeometry {
  body: THREE.BufferGeometry;
  face: THREE.BufferGeometry;
}

const cache = new Map<string, ChibiGeometry>();

export function chibiKey(a: Appearance): string {
  return JSON.stringify([a.skin, a.hair, a.hairStyle, a.eyes, a.top, a.topAccent, a.topStyle, a.bottom, a.shoes, a.accessory, a.accessoryColor, a.lanyard, a.look, a.facialHair ?? '', a.bottomStyle ?? '']);
}

/** Geometria do boneco para uma aparência (compartilhada por quem tem a mesma). */
export function chibiGeometry(a: Appearance, rig: ChibiRig): ChibiGeometry {
  const key = chibiKey(a);
  let g = cache.get(key);
  if (!g) {
    g = { body: buildBody(a, rig), face: buildFace(rig) };
    cache.set(key, g);
    if (cache.size > 96) {
      const first = cache.keys().next().value!;
      const old = cache.get(first)!;
      cache.delete(first);
      old.body.dispose();
    }
  }
  return g;
}

function buildBody(a: Appearance, rig: ChibiRig): THREE.BufferGeometry {
  const P = new Parts();
  const { j, u } = rig;
  const H = j.hips.y;
  const cx = j.hips.x;
  const cz = j.hips.z;
  const ground = (j.footL.y + j.footR.y) / 2 - 1.09 * u;
  const skin = a.skin;
  const top = a.top;
  const accent = a.topAccent;
  const bottom = a.bottom;
  const bottomStyle = a.bottomStyle ?? 'pants';

  // ---------------------------------------------------------------- tronco (torno), quadril → peito
  const prof: [number, number][] = [
    [0.0, -0.75],
    [1.2, -0.7],
    [1.42, -0.2],
    [1.46, 0.4],
    [1.4, 1.0],
    [1.28, 1.55],
    [0.95, 1.95],
    [0.5, 2.12],
    [0.0, 2.14],
  ];
  const torsoR = (y: number) => {
    const t = (y - H) / u;
    for (let i = 1; i < prof.length; i++) {
      const [r1, y1] = prof[i]!;
      const [r0, y0] = prof[i - 1]!;
      if (t <= y1) return (r0 + ((t - y0) / (y1 - y0)) * (r1 - r0)) * u;
    }
    return 0;
  };
  const torsoW = (p: THREE.Vector3): Weight => [BONE.hips, BONE.chest, THREE.MathUtils.smoothstep(p.y, H + 0.4 * u, H + 1.3 * u)];
  const waist = H + 0.12 * u;
  const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * u, y * u)), 28);
  P.add(lathe, (p) => (p.y < waist ? bottom : top), M(v3(cx, H, cz)), torsoW);
  const frontZ = (y: number) => cz + torsoR(y);

  // cós da calça
  P.add(new THREE.TorusGeometry(1.44 * u, 0.09 * u, 6, 28), shade(bottom, 0.8), M(v3(cx, waist, cz), new THREE.Euler(Math.PI / 2, 0, 0)), [BONE.hips, BONE.hips, 0]);

  // ---------------------------------------------------------------- roupa: detalhes por estilo
  const chestW: Weight = [BONE.chest, BONE.chest, 0];
  const neckY = H + 2.0 * u;
  switch (a.topStyle) {
    case 'hoodie': {
      P.add(new THREE.TorusGeometry(0.85 * u, 0.36 * u, 10, 24), shade(top, 0.92), M(v3(cx, neckY - 0.05 * u, cz - 0.25 * u), new THREE.Euler(Math.PI / 2 - 0.35, 0, 0)), chestW);
      for (const s of [-1, 1]) capsule(P, v3(cx + s * 0.32 * u, neckY - 0.2 * u, frontZ(neckY - 0.2 * u) + 0.02 * u), v3(cx + s * 0.38 * u, H + 1.05 * u, frontZ(H + 1.05 * u) + 0.06 * u), 0.06 * u, accent, chestW, 6);
      P.add(new RoundedBoxGeometry(1.7 * u, 0.6 * u, 0.2 * u, 2, 0.08 * u), shade(top, 0.86), M(v3(cx, H + 0.5 * u, frontZ(H + 0.5 * u) - 0.02 * u)), torsoW);
      break;
    }
    case 'shirt_tie': {
      P.add(new RoundedBoxGeometry(0.34 * u, 1.35 * u, 0.12 * u, 2, 0.05 * u), accent, M(v3(cx, H + 1.15 * u, frontZ(H + 1.15 * u) + 0.02 * u), new THREE.Euler(-0.12, 0, 0)), chestW);
      P.add(new THREE.SphereGeometry(0.2 * u, 10, 8), shade(accent, 0.85), M(v3(cx, neckY - 0.08 * u, frontZ(neckY - 0.08 * u) + 0.02 * u)), chestW);
      for (const s of [-1, 1]) P.add(new RoundedBoxGeometry(0.55 * u, 0.3 * u, 0.1 * u, 1, 0.04 * u), shade(top, 1.12), M(v3(cx + s * 0.32 * u, neckY - 0.02 * u, frontZ(neckY) + 0.12 * u), new THREE.Euler(-0.5, 0, s * 0.5)), chestW);
      break;
    }
    case 'jacket': {
      P.add(new RoundedBoxGeometry(0.8 * u, 1.7 * u, 0.12 * u, 2, 0.05 * u), accent, M(v3(cx, H + 1.05 * u, frontZ(H + 1.05 * u) - 0.02 * u)), chestW);
      for (const s of [-1, 1]) P.add(new RoundedBoxGeometry(0.42 * u, 1.3 * u, 0.12 * u, 2, 0.05 * u), shade(top, 0.82), M(v3(cx + s * 0.5 * u, H + 1.25 * u, frontZ(H + 1.25 * u) + 0.03 * u), new THREE.Euler(0, 0, s * 0.28)), chestW);
      for (let i = 0; i < 2; i++) P.add(new THREE.SphereGeometry(0.09 * u, 8, 6), shade(top, 0.6), M(v3(cx + 0.55 * u, H + (0.35 + i * 0.4) * u, frontZ(H + (0.35 + i * 0.4) * u) + 0.02 * u)), torsoW);
      break;
    }
    case 'sweater': {
      P.add(new THREE.TorusGeometry(0.62 * u, 0.13 * u, 8, 24), shade(top, 0.85), M(v3(cx, neckY + 0.02 * u, cz), new THREE.Euler(Math.PI / 2, 0, 0)), chestW);
      P.add(new THREE.TorusGeometry(1.47 * u, 0.12 * u, 6, 28), shade(top, 0.85), M(v3(cx, waist + 0.18 * u, cz), new THREE.Euler(Math.PI / 2, 0, 0)), torsoW);
      // listra no peito
      P.add(new THREE.TorusGeometry(1.43 * u, 0.1 * u, 6, 28), accent, M(v3(cx, H + 1.0 * u, cz), new THREE.Euler(Math.PI / 2, 0, 0)), torsoW);
      break;
    }
    case 'blouse': {
      for (const s of [-1, 1]) {
        const c = new THREE.SphereGeometry(0.42 * u, 12, 8);
        P.add(c, accent, M(v3(cx + s * 0.36 * u, neckY - 0.12 * u, frontZ(neckY - 0.12 * u) - 0.05 * u), new THREE.Euler(0.3, 0, s * 0.4), v3(1, 0.55, 0.45)), chestW);
      }
      for (let i = 0; i < 3; i++) P.add(new THREE.SphereGeometry(0.07 * u, 8, 6), accent, M(v3(cx, H + (0.6 + i * 0.35) * u, frontZ(H + (0.6 + i * 0.35) * u))), torsoW);
      break;
    }
    case 'polo': {
      for (const s of [-1, 1]) P.add(new RoundedBoxGeometry(0.6 * u, 0.28 * u, 0.1 * u, 1, 0.04 * u), accent, M(v3(cx + s * 0.32 * u, neckY - 0.02 * u, frontZ(neckY) + 0.1 * u), new THREE.Euler(-0.5, 0, s * 0.45)), chestW);
      for (let i = 0; i < 2; i++) P.add(new THREE.SphereGeometry(0.07 * u, 8, 6), shade(top, 0.7), M(v3(cx, H + (1.35 + i * 0.25) * u, frontZ(H + (1.35 + i * 0.25) * u))), chestW);
      break;
    }
    default: {
      // camiseta: gola e uma estampa redonda
      P.add(new THREE.TorusGeometry(0.58 * u, 0.1 * u, 8, 24), accent, M(v3(cx, neckY + 0.02 * u, cz), new THREE.Euler(Math.PI / 2, 0, 0)), chestW);
      P.add(new THREE.CylinderGeometry(0.42 * u, 0.42 * u, 0.06 * u, 20), accent, M(v3(cx, H + 1.0 * u, frontZ(H + 1.0 * u) - 0.01 * u), new THREE.Euler(Math.PI / 2, 0, 0)), torsoW);
    }
  }

  // crachá (subagentes e quem escolheu)
  if (a.lanyard) {
    P.add(new THREE.TorusGeometry(0.72 * u, 0.06 * u, 6, 24, Math.PI), a.lanyard, M(v3(cx, neckY - 0.1 * u, cz + 0.15 * u), new THREE.Euler(-Math.PI / 2 - 0.9, 0, Math.PI)), chestW);
    P.add(new RoundedBoxGeometry(0.62 * u, 0.82 * u, 0.08 * u, 1, 0.06 * u), '#f4f1ea', M(v3(cx, H + 1.05 * u, frontZ(H + 1.05 * u) + 0.06 * u)), chestW);
    P.add(new RoundedBoxGeometry(0.62 * u, 0.22 * u, 0.09 * u, 1, 0.05 * u), a.lanyard, M(v3(cx, H + 1.36 * u, frontZ(H + 1.05 * u) + 0.065 * u)), chestW);
  }

  // ---------------------------------------------------------------- pescoço
  capsule(P, v3(cx, H + 1.85 * u, cz), v3(cx, j.head.y - 0.6 * u, cz), 0.42 * u, skin, [BONE.neck, BONE.neck, 0], 10);

  // ---------------------------------------------------------------- braços (pose T: ao longo de x)
  const longSleeve = LONG_SLEEVES.has(a.topStyle);
  for (let [arm, hand, bA, bH] of [
    [j.armL, j.handL, BONE.armL, BONE.handL],
    [j.armR, j.handR, BONE.armR, BONE.handR],
  ] as const) {
    const dir = Math.sign(hand.x - arm.x) || 1;
    const sh = v3(arm.x - dir * 0.25 * u, arm.y, arm.z);
    const wrist = dropArm(v3(hand.x - dir * 0.45 * u, hand.y, hand.z), arm, dir);
    const w: Weight = [bA, bA, 0];
    void bH;
    hand = dropArm(hand, arm, dir);
    P.add(new THREE.SphereGeometry(0.62 * u, 14, 10), top, M(v3(sh.x, sh.y - 0.05 * u, sh.z)), (p) => [BONE.chest, bA, THREE.MathUtils.clamp(((p.x - sh.x) * dir) / (0.6 * u) + 0.5, 0, 1)]);
    if (longSleeve) {
      capsule(P, sh, wrist, 0.44 * u, top, w);
      P.add(new THREE.TorusGeometry(0.43 * u, 0.09 * u, 6, 16), shade(top, 0.8), M(wrist, new THREE.Euler(0, Math.PI / 2, 0)), w);
    } else {
      const elbow = sh.clone().lerp(wrist, 0.45);
      capsule(P, sh, elbow, 0.48 * u, top, w);
      capsule(P, elbow, wrist, 0.36 * u, skin, w);
    }
    // mão: palma e polegar
    P.add(new THREE.SphereGeometry(0.5 * u, 14, 10), skin, M(hand, undefined, v3(1, 0.9, 1.05)), w);
    P.add(new THREE.SphereGeometry(0.2 * u, 8, 6), skin, M(v3(hand.x - dir * 0.15 * u, hand.y + 0.05 * u, hand.z + 0.42 * u)), w);
  }

  // ---------------------------------------------------------------- pernas e calçados
  for (const [leg, foot, bL, bF] of [
    [j.legL, j.footL, BONE.legL, BONE.footL],
    [j.legR, j.footR, BONE.legR, BONE.footR],
  ] as const) {
    const hip = v3(leg.x * 0.92 + cx * 0.08, H - 0.15 * u, leg.z);
    const ankle = v3(foot.x, ground + 0.75 * u, foot.z);
    const w: Weight = [bL, bL, 0];
    if (bottomStyle === 'shorts') {
      const knee = hip.clone().lerp(ankle, 0.5);
      capsule(P, hip, knee, 0.6 * u, bottom, w);
      capsule(P, knee, ankle, 0.44 * u, skin, w);
    } else if (bottomStyle === 'skirt') {
      capsule(P, hip, ankle, 0.44 * u, skin, w);
    } else capsule(P, hip, ankle, 0.55 * u, bottom, w);
    // tênis: cabedal + sola clara
    const fw: Weight = [bF, bF, 0];
    P.add(new RoundedBoxGeometry(1.1 * u, 0.8 * u, 1.75 * u, 2, 0.34 * u), a.shoes, M(v3(foot.x, ground + 0.55 * u, foot.z + 0.28 * u)), fw);
    P.add(new RoundedBoxGeometry(1.18 * u, 0.26 * u, 1.85 * u, 2, 0.1 * u), mix(a.shoes, '#f5f2ea', 0.75), M(v3(foot.x, ground + 0.13 * u, foot.z + 0.3 * u)), fw);
  }
  if (bottomStyle === 'skirt') {
    const sk = new THREE.LatheGeometry([new THREE.Vector2(1.46 * u, 0.25 * u), new THREE.Vector2(1.62 * u, -0.4 * u), new THREE.Vector2(1.95 * u, -1.25 * u), new THREE.Vector2(1.6 * u, -1.3 * u)], 28);
    P.add(sk, bottom, M(v3(cx, H, cz)), [BONE.hips, BONE.hips, 0]);
  }

  // ---------------------------------------------------------------- cabeça
  const headW: Weight = [BONE.head, BONE.head, 0];
  const HM = M(rig.headC, undefined, v3(rig.headR * HEAD_S.x, rig.headR * HEAD_S.y, rig.headR * HEAD_S.z));
  /** Peça desenhada no espaço unitário da cabeça. */
  const H1 = (geo: THREE.BufferGeometry, color: ColorFn, m: THREE.Matrix4 | null = null) => {
    if (m) geo.applyMatrix4(m);
    P.add(geo, color, HM, headW);
  };
  H1(new THREE.SphereGeometry(1, 32, 24), skin);
  // orelhas
  for (const s of [-1, 1]) {
    H1(new THREE.SphereGeometry(0.2, 12, 8), skin, M(v3(s * 1.0, -0.08, -0.02), undefined, v3(0.55, 1, 0.8)));
    if (a.accessory === 'earrings') H1(new THREE.SphereGeometry(0.07, 8, 6), '#e8c15a', M(v3(s * 1.02, -0.3, 0.02)));
  }
  hair(a, H1);
  facialHair(a, H1);
  accessory(a, H1);
  return P.build();
}

type HeadAdd = (geo: THREE.BufferGeometry, color: ColorFn, m?: THREE.Matrix4 | null) => void;

/** Casca esférica: θ de th0 a th1; `gap` = metade da abertura na frente (0 = volta inteira). */
function shell(k: number, th0: number, th1: number, gap = 0): THREE.BufferGeometry {
  return gap ? new THREE.SphereGeometry(k, 32, 10, FRONT + gap, Math.PI * 2 - 2 * gap, th0, th1 - th0) : new THREE.SphereGeometry(k, 32, 10, 0, Math.PI * 2, th0, th1 - th0);
}

function blob(add: HeadAdd, color: string, p: THREE.Vector3, r: number, s: THREE.Vector3 | number = 1, rot?: THREE.Euler): void {
  add(new THREE.SphereGeometry(r, 12, 9), color, M(p, rot, s));
}

/** Cone apontando para fora da cabeça, na direção de `p` (unitário). */
function spike(add: HeadAdd, color: string, p: THREE.Vector3, r: number, h: number): void {
  const n = p.clone().normalize();
  add(new THREE.ConeGeometry(r, h, 8), color, M(n.clone().multiplyScalar(0.98 + h * 0.35), new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), n)));
}

function bangs(add: HeadAdd, c: string, n = 5, spread = 0.3, th = 1.12): void {
  for (let i = 0; i < n; i++) {
    const phi = FRONT + (i - (n - 1) / 2) * spread;
    blob(add, c, sph(th, phi, 1.0), 0.27, v3(1.25, 0.75, 0.7), new THREE.Euler(0, phi - FRONT, 0));
  }
}

function hair(a: Appearance, add: HeadAdd): void {
  const c = a.hair;
  const base = (back = 1.9, k = 1.08) => {
    add(shell(k, 0, 1.22), c);
    add(shell(k, 1.2, back, 1.0), c);
  };
  switch (a.hairStyle) {
    case 'bald':
      return;
    case 'buzz':
      add(shell(1.035, 0, 1.3), c);
      add(shell(1.035, 1.28, 1.75, 1.1), c);
      return;
    case 'short':
      base();
      bangs(add, c);
      return;
    case 'spiky':
      base();
      for (const [th, phi] of [[0.15, 0], [0.5, FRONT], [0.55, FRONT + 1.2], [0.55, FRONT - 1.2], [0.6, FRONT + 2.4], [0.6, FRONT - 2.4], [0.9, FRONT + 0.5], [0.9, FRONT - 0.5], [1.0, FRONT + Math.PI]] as const) spike(add, c, sph(th, phi), 0.22, 0.55);
      return;
    case 'side_part':
      base();
      blob(add, c, sph(0.78, FRONT - 0.45, 1.04), 0.52, v3(1.35, 0.5, 0.95), new THREE.Euler(0.3, -0.3, 0.25));
      bangs(add, c, 3, 0.3, 1.1);
      return;
    case 'curly': {
      base(1.95, 1.06);
      for (const th of [0.25, 0.6, 0.95, 1.3, 1.65]) {
        const n = Math.round(4 + Math.sin(th) * 9);
        for (let i = 0; i < n; i++) {
          const phi = (i / n) * Math.PI * 2 + th;
          const front = Math.abs(Math.atan2(Math.sin(phi - FRONT), Math.cos(phi - FRONT))) < 1.0;
          if (front && th > 1.0) continue;
          blob(add, c, sph(th, phi, 1.06), 0.26);
        }
      }
      return;
    }
    case 'afro': {
      const off = M(v3(0, 0.16, -0.12));
      const g1 = shell(1.4, 0, 1.4);
      const g2 = shell(1.4, 1.36, 2.1, 1.2);
      add(g1, c, off);
      add(g2, c, off.clone());
      return;
    }
    case 'bob':
      add(shell(1.1, 0, 1.22), c);
      add(shell(1.14, 1.2, 2.3, 0.88), c);
      add(new THREE.SphereGeometry(1.1, 24, 6, FRONT - 0.95, 1.9, 1.0, 0.32), c);
      return;
    case 'long':
      add(shell(1.09, 0, 1.22), c);
      add(shell(1.11, 1.2, 2.25, 0.95), c);
      add(new RoundedBoxGeometry(1.55, 1.7, 0.45, 2, 0.2), c, M(v3(0, -1.05, -0.72), new THREE.Euler(0.22, 0, 0)));
      for (const s of [-1, 1]) blob(add, c, v3(s * 0.92, -0.75, 0.25), 0.28, v3(0.7, 1.9, 0.8));
      bangs(add, c, 4, 0.34);
      return;
    case 'ponytail':
      base();
      bangs(add, c, 4, 0.32);
      blob(add, a.topAccent, v3(0, 0.38, -1.04), 0.16);
      blob(add, c, v3(0, 0.05, -1.2), 0.3, v3(1, 1.3, 1));
      blob(add, c, v3(0, -0.45, -1.25), 0.26, v3(1, 1.5, 1));
      blob(add, c, v3(0, -0.85, -1.18), 0.18, v3(1, 1.4, 1));
      return;
    case 'bun':
      base();
      bangs(add, c, 4, 0.32);
      blob(add, c, v3(0, 1.08, -0.25), 0.42);
      return;
    case 'pigtails':
      base();
      bangs(add, c, 4, 0.32);
      for (const s of [-1, 1]) {
        blob(add, a.topAccent, v3(s * 0.98, 0.15, -0.3), 0.13);
        blob(add, c, v3(s * 1.15, -0.15, -0.3), 0.3, v3(1, 1.2, 1));
        blob(add, c, v3(s * 1.22, -0.62, -0.3), 0.24, v3(1, 1.5, 1));
      }
      return;
    case 'mohawk':
      add(shell(1.012, 0, 1.4), shade(c, 0.7));
      for (let i = 0; i < 7; i++) {
        const t = -0.95 + i * 0.38;
        spike(add, c, v3(0, Math.cos(t), Math.sin(t)), 0.2, 0.6);
      }
      return;
    case 'wavy':
      add(shell(1.08, 0, 1.22), c);
      add(shell(1.1, 1.2, 2.05, 0.95), c);
      for (let i = 0; i < 9; i++) {
        const phi = FRONT + 1.05 + (i / 8) * (Math.PI * 2 - 2.1);
        blob(add, c, sph(2.0 + (i % 2) * 0.12, phi, 1.08), 0.3);
      }
      bangs(add, c, 4, 0.34);
      return;
  }
}

function facialHair(a: Appearance, add: HeadAdd): void {
  const f = a.facialHair ?? 'none';
  const c = a.hair;
  if (f === 'beard') {
    add(new THREE.SphereGeometry(1.045, 32, 10, FRONT - 1.5, 3.0, 1.95, 0.75), c);
    blob(add, c, sph(1.84, FRONT, 1.03), 0.18, v3(1.7, 0.5, 0.6));
  } else if (f === 'stubble') add(new THREE.SphereGeometry(1.014, 32, 10, FRONT - 1.45, 2.9, 1.98, 0.7), mix(a.skin, c, 0.35));
  else if (f === 'mustache') blob(add, c, sph(1.84, FRONT, 1.03), 0.19, v3(1.75, 0.5, 0.6));
  else if (f === 'goatee') {
    blob(add, c, sph(2.28, FRONT, 0.99), 0.2, v3(1.1, 1.3, 0.8));
    blob(add, c, sph(1.84, FRONT, 1.03), 0.16, v3(1.6, 0.45, 0.6));
  }
}

function accessory(a: Appearance, add: HeadAdd): void {
  const c = a.accessoryColor;
  switch (a.accessory) {
    case 'glasses':
    case 'sunglasses': {
      for (const s of [-1, 1]) {
        const at = sph(1.6, FRONT + s * 0.36, 1.07);
        if (a.accessory === 'glasses') add(new THREE.TorusGeometry(0.2, 0.035, 8, 20), c, M(at));
        else add(new THREE.CylinderGeometry(0.21, 0.21, 0.05, 20), '#1d2026', M(at, new THREE.Euler(Math.PI / 2, 0, 0)));
        add(new THREE.BoxGeometry(0.04, 0.04, 0.95), c, M(v3(s * 1.04, at.y + 0.04, 0.35)));
      }
      add(new THREE.BoxGeometry(0.2, 0.035, 0.035), c, M(sph(1.55, FRONT, 1.08)));
      return;
    }
    case 'headphones':
      add(new THREE.TorusGeometry(1.1, 0.07, 8, 28, Math.PI), c, M(v3(0, 0.02, -0.05)));
      for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 20), c, M(v3(s * 1.06, -0.02, -0.05), new THREE.Euler(0, 0, Math.PI / 2)));
      return;
    case 'cap':
      add(shell(1.12, 0, 1.18), c);
      add(new THREE.CylinderGeometry(0.95, 0.95, 0.05, 24, 1, false, -1.1, 2.2), shade(c, 0.85), M(v3(0, 0.4, 0.42), undefined, v3(0.85, 1, 1)));
      blob(add, shade(c, 0.85), v3(0, 1.12, 0), 0.08);
      return;
    case 'beanie':
      add(shell(1.14, 0, 1.25), c);
      add(new THREE.TorusGeometry(1.08, 0.13, 8, 28), shade(c, 0.85), M(v3(0, Math.cos(1.25) * 1.12, 0), new THREE.Euler(Math.PI / 2, 0, 0), v3(1, 1, 1)));
      blob(add, '#f4efe4', v3(0, 1.2, 0), 0.22);
      return;
    case 'bow':
      for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.2, 0.38, 10), c, M(v3(0.48 + s * 0.2, 0.92, 0.25), new THREE.Euler(0, 0, (s * Math.PI) / 2)));
      blob(add, shade(c, 0.85), v3(0.48, 0.92, 0.25), 0.09);
      return;
  }
}

// ------------------------------------------------------------------ rosto

/** Calota do rosto (θ 0,95..2,2; φ = frente ± 0,85), um pouco fora da cabeça. */
const FACE = { phi: 1.7, th0: 0.95, th: 1.25 };

function buildFace(rig: ChibiRig): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1.012, 24, 18, FRONT - FACE.phi / 2, FACE.phi, FACE.th0, FACE.th);
  g.applyMatrix4(M(rig.headC, undefined, v3(rig.headR * HEAD_S.x, rig.headR * HEAD_S.y, rig.headR * HEAD_S.z)));
  const n = (g.attributes.position as THREE.BufferAttribute).count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    si[i * 4] = BONE.head;
    sw[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return g;
}

export const EXPRESSIONS = ['neutral', 'blink', 'happy', 'worried', 'sleep', 'talk', 'surprised', 'focused'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

const CW = 300;
const CH = 200;
let faceAtlas: THREE.CanvasTexture | null = null;

/** Atlas 4x2 das expressões (compartilhado; cada boneco usa uma cópia com o próprio deslocamento). */
function atlas(): THREE.CanvasTexture {
  if (faceAtlas) return faceAtlas;
  const cv = document.createElement('canvas');
  cv.width = CW * 4;
  cv.height = CH * 2;
  const c = cv.getContext('2d')!;
  EXPRESSIONS.forEach((e, i) => {
    c.save();
    c.translate((i % 4) * CW, Math.floor(i / 4) * CH);
    drawFace(c, e);
    c.restore();
  });
  faceAtlas = new THREE.CanvasTexture(cv);
  faceAtlas.colorSpace = THREE.SRGBColorSpace;
  faceAtlas.anisotropy = 4;
  return faceAtlas;
}

function drawFace(c: CanvasRenderingContext2D, e: Expression): void {
  const ink = '#2a2130';
  const eyeY = 104;
  const ex = [150 - 64, 150 + 64];
  const mouthY = 150;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  // bochechas
  c.fillStyle = 'rgba(255,120,130,0.32)';
  for (const x of [150 - 98, 150 + 98]) {
    c.beginPath();
    c.ellipse(x, 134, 20, 11, 0, 0, Math.PI * 2);
    c.fill();
  }
  // sobrancelhas
  c.strokeStyle = 'rgba(60,42,40,0.85)';
  c.lineWidth = 6;
  for (const [k, x] of ex.entries()) {
    const s = k === 0 ? -1 : 1;
    c.beginPath();
    if (e === 'worried') {
      c.moveTo(x - 16 * s, 66);
      c.lineTo(x + 14 * s, 76);
    } else if (e === 'focused') {
      c.moveTo(x - 16 * s, 76);
      c.lineTo(x + 14 * s, 70);
    } else if (e === 'surprised') {
      c.arc(x, 74, 18, Math.PI * 1.15, Math.PI * 1.85);
    } else {
      c.arc(x, 80, 18, Math.PI * 1.2, Math.PI * 1.8);
    }
    c.stroke();
  }
  // olhos
  c.strokeStyle = ink;
  c.fillStyle = ink;
  for (const x of ex) {
    if (e === 'blink' || e === 'sleep') {
      c.lineWidth = 6;
      c.beginPath();
      if (e === 'sleep') c.arc(x, eyeY - 6, 14, Math.PI * 0.15, Math.PI * 0.85);
      else c.arc(x, eyeY - 4, 15, Math.PI * 0.1, Math.PI * 0.9);
      c.stroke();
    } else if (e === 'happy') {
      c.lineWidth = 7;
      c.beginPath();
      c.arc(x, eyeY + 6, 15, Math.PI * 1.1, Math.PI * 1.9);
      c.stroke();
    } else {
      const ry = e === 'surprised' ? 25 : e === 'focused' ? 15 : 22;
      const rx = e === 'surprised' ? 18 : 16;
      c.beginPath();
      c.ellipse(x, eyeY, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
      // íris mais clara embaixo e brilhos
      c.fillStyle = 'rgba(120,90,150,0.55)';
      c.beginPath();
      c.ellipse(x, eyeY + ry * 0.45, rx * 0.7, ry * 0.38, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(x - 6, eyeY - ry * 0.4, 6.5, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(x + 6, eyeY + ry * 0.3, 3, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = ink;
      if (e === 'focused') {
        // pálpebra
        c.fillStyle = 'rgba(42,33,48,0.9)';
        c.fillRect(x - 19, eyeY - ry - 3, 38, 9);
        c.fillStyle = ink;
      }
    }
  }
  // boca
  c.lineWidth = 5;
  c.strokeStyle = '#5b2a33';
  c.fillStyle = '#7d3140';
  c.beginPath();
  switch (e) {
    case 'happy':
      c.moveTo(150 - 20, mouthY - 4);
      c.quadraticCurveTo(150, mouthY + 26, 150 + 20, mouthY - 4);
      c.closePath();
      c.fill();
      c.fillStyle = '#ff8f9e';
      c.beginPath();
      c.ellipse(150, mouthY + 8, 9, 5, 0, 0, Math.PI * 2);
      c.fill();
      return;
    case 'talk':
      c.ellipse(150, mouthY + 2, 11, 9, 0, 0, Math.PI * 2);
      c.fill();
      return;
    case 'surprised':
    case 'sleep':
      c.ellipse(150, mouthY + 2, e === 'sleep' ? 6 : 9, e === 'sleep' ? 5 : 11, 0, 0, Math.PI * 2);
      c.fill();
      return;
    case 'worried':
      c.moveTo(150 - 14, mouthY + 6);
      c.quadraticCurveTo(150 - 7, mouthY - 2, 150, mouthY + 4);
      c.quadraticCurveTo(150 + 7, mouthY + 10, 150 + 14, mouthY + 2);
      c.stroke();
      return;
    case 'focused':
      c.moveTo(150 - 10, mouthY + 3);
      c.lineTo(150 + 10, mouthY + 3);
      c.stroke();
      return;
    default:
      c.arc(150, mouthY - 6, 12, Math.PI * 0.2, Math.PI * 0.8);
      c.stroke();
  }
}

/** Rosto de um boneco: textura própria (cópia do atlas) e troca de expressão. */
export class ChibiFace {
  readonly tex: THREE.Texture;
  private expr: Expression | null = null;
  private blinkAt = 0;
  private blinkUntil = 0;

  constructor() {
    this.tex = atlas().clone();
    this.tex.repeat.set(1 / 4, 1 / 2);
    this.set('neutral');
  }

  set(e: Expression): void {
    if (e === this.expr) return;
    this.expr = e;
    const i = EXPRESSIONS.indexOf(e);
    this.tex.offset.set((i % 4) / 4, 1 - (Math.floor(i / 4) + 1) / 2);
  }

  /** Expressão base + piscadas automáticas. */
  update(base: Expression, now: number, rnd: () => number): void {
    if (now > this.blinkAt) {
      this.blinkUntil = now + 120;
      this.blinkAt = now + 2200 + rnd() * 3800;
    }
    const canBlink = base === 'neutral' || base === 'focused' || base === 'talk';
    this.set(canBlink && now < this.blinkUntil ? 'blink' : base);
  }

  dispose(): void {
    this.tex.dispose();
  }
}

/** Material do corpo (cor por vértice) e do rosto. */
export function chibiMaterials(face: ChibiFace): { body: THREE.MeshStandardMaterial; face: THREE.MeshStandardMaterial } {
  return {
    body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 }),
    face: new THREE.MeshStandardMaterial({ map: face.tex, transparent: true, alphaTest: 0.08, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
}

/**
 * Veste um clone do modelo-base: remove a malha Gobkit e põe o Habbinho, preso ao MESMO esqueleto do clone
 * (as animações continuam valendo). Devolve as malhas novas (para trocar quando a aparência muda).
 */
export function dressChibi(body: THREE.Object3D, rig: ChibiRig, a: Appearance, mats: { body: THREE.Material; face: THREE.Material }): THREE.SkinnedMesh[] {
  let bones: THREE.Bone[] | null = null;
  const old: THREE.Object3D[] = [];
  body.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh) {
      bones ??= sm.skeleton.bones;
      old.push(sm);
    }
  });
  for (const o of old) o.removeFromParent();
  if (!bones) return [];
  const geo = chibiGeometry(a, rig);
  const out: THREE.SkinnedMesh[] = [];
  for (const [g, m] of [
    [geo.body, mats.body],
    [geo.face, mats.face],
  ] as const) {
    const sm = new THREE.SkinnedMesh(g, m);
    sm.userData.chibi = true;
    sm.castShadow = g === geo.body;
    sm.frustumCulled = false;
    sm.bind(new THREE.Skeleton(bones, rig.inverses.map((x) => x.clone())), new THREE.Matrix4());
    body.add(sm);
    out.push(sm);
  }
  return out;
}
