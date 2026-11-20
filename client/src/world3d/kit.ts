// Kit de modelagem do escritório 3D: paleta, materiais compartilhados e peças arredondadas em cache.
// Tudo em unidades de tile (1 tile do mundo 2D = 1 unidade 3D; y para cima). Materiais e geometrias são
// compartilhados entre todos os móveis (poucas variações, muitas instâncias) para manter as draw calls baixas.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Paleta da direção de arte: madeiras quentes, tons claros, pastéis, verde suave, azul discreto. */
export const PAL = {
  woodLight: '#d9b48a',
  wood: '#b98656',
  woodDark: '#7a5236',
  oak: '#c99a68',
  cream: '#f3ece0',
  paper: '#fbf8f2',
  white: '#eef0f2',
  plaster: '#ece6dc',
  grey: '#a9adb3',
  greyDark: '#4a4f57',
  charcoal: '#2d3138',
  black: '#1e2126',
  sage: '#9cb89a',
  leaf: '#5f9a5c',
  leafDark: '#3f7a4a',
  terracotta: '#c9764f',
  blue: '#6f94c4',
  blueSoft: '#a9c3e0',
  navy: '#34496b',
  mustard: '#e3b23c',
  orange: '#e8894a',
  coral: '#e47a6c',
  pink: '#e7a3b1',
  lilac: '#b8a5d6',
  teal: '#5fa9a3',
  red: '#c9524b',
  glass: '#bfe0ee',
  metal: '#c4c8cc',
} as const;

const matCache = new Map<string, THREE.Material>();

export interface MatOpts {
  rough?: number;
  metal?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  side?: THREE.Side;
}

/** Material PBR estilizado (fosco por padrão), compartilhado por cor+parâmetros. */
export function mat(color: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${o.rough ?? 0.78}|${o.metal ?? 0}|${o.emissive ?? ''}|${o.emissiveIntensity ?? 0}|${o.opacity ?? 1}|${o.side ?? 0}`;
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: o.rough ?? 0.78,
      metalness: o.metal ?? 0,
      emissive: o.emissive ? new THREE.Color(o.emissive) : new THREE.Color(0),
      emissiveIntensity: o.emissiveIntensity ?? 0,
      transparent: (o.opacity ?? 1) < 1,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
      depthWrite: (o.opacity ?? 1) >= 1,
    });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

/** Caixa com cantos arredondados (raio proporcional ao menor lado), em cache por dimensões. */
export function rbox(w: number, h: number, d: number, r = 0.04): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const key = `rb|${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${rr.toFixed(3)}`;
  let g = geoCache.get(key);
  if (!g) {
    g = rr > 0.004 ? new RoundedBoxGeometry(w, h, d, 2, rr) : new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}

export function cyl(rt: number, rb: number, h: number, seg = 16): THREE.BufferGeometry {
  const key = `cy|${rt}|${rb}|${h}|${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    geoCache.set(key, g);
  }
  return g;
}

export function sphere(r: number, seg = 14): THREE.BufferGeometry {
  const key = `sp|${r}|${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)));
    geoCache.set(key, g);
  }
  return g;
}

export function plane(w: number, h: number): THREE.BufferGeometry {
  const key = `pl|${w}|${h}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.PlaneGeometry(w, h);
    geoCache.set(key, g);
  }
  return g;
}

/** Adiciona uma malha ao grupo, com a BASE da peça em `y` (não o centro). */
export function put(group: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, opts: { rx?: number; ry?: number; rz?: number; shadow?: boolean } = {}): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  mesh.position.set(x, y - bb.min.y, z);
  if (opts.rx) mesh.rotation.x = opts.rx;
  if (opts.ry) mesh.rotation.y = opts.ry;
  if (opts.rz) mesh.rotation.z = opts.rz;
  const sh = opts.shadow ?? true;
  mesh.castShadow = sh;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** Caixa arredondada com a base em y e centro em (x, z). */
export function block(group: THREE.Object3D, w: number, h: number, d: number, color: string | THREE.Material, x: number, y: number, z: number, r = 0.035): THREE.Mesh {
  return put(group, rbox(w, h, d, r), typeof color === 'string' ? mat(color) : color, x, y, z);
}

/** Cor hexadecimal estável a partir de um número. */
export function pick<T>(list: readonly T[], seed: number): T {
  return list[Math.abs(Math.floor(seed)) % list.length]!;
}

/** Textura de canvas (telas, quadros, pôsteres), em cache por chave. */
const texCache = new Map<string, THREE.CanvasTexture>();
export function canvasTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!, w, h);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(key, t);
  }
  return t;
}

const texMatCache = new Map<string, THREE.MeshStandardMaterial>();
/** Material com textura de canvas; `glow` > 0 faz a imagem emitir luz (telas). */
export function texMat(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, glow = 0): THREE.MeshStandardMaterial {
  const k = `${key}|${glow}`;
  let m = texMatCache.get(k);
  if (!m) {
    const t = canvasTex(key, w, h, draw);
    m = new THREE.MeshStandardMaterial({ map: t, roughness: glow ? 0.35 : 0.85, emissive: glow ? new THREE.Color('#ffffff') : new THREE.Color(0), emissiveMap: glow ? t : null, emissiveIntensity: glow });
    texMatCache.set(k, m);
  }
  return m;
}
