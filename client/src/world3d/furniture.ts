// Móveis 3D do escritório: modelos CC0 baixados (props.ts: Kenney e KayKit) onde existem, e peças arredondadas do kit
// para o resto (e enquanto os modelos carregam). Cada função recebe o footprint em tiles e devolve um grupo com a ORIGEM no canto noroeste
// do footprint (x para leste, z para o sul/câmera, y para cima). Itens de parede: origem no centro da base, na face
// da parede, virados para +z (para dentro da sala).
import * as THREE from 'three';
import { PingPongDisplay } from './pingpong';
import type { FurnitureKind, RoomTheme } from '../art/api';
import { PAL, block, canvasTex, cyl, mat, pick, plane, put, rbox, sphere, texMat } from './kit';
import { partBox, prop, type Fit, type PropName } from './props';

/** Modelo baixado (props.ts) num ponto do grupo, girado; null se ainda não carregou (o chamador desenha o procedural). */
function place(g: THREE.Object3D, name: PropName, fit: Fit, x: number, y: number, z: number, ry = 0, colors?: Record<string, string>): THREE.Object3D | null {
  const o = prop(name, fit, colors);
  if (!o) return null;
  o.position.set(x, y, z);
  o.rotation.y = ry;
  g.add(o);
  return o;
}

/** Alturas coordenadas com o tamanho dos personagens (ver characters.ts: CHAR_H). */
export const SEAT_H = 0.3;
export const DESK_H = 0.5;
export const STOOL_H = 0.36;
export const DESK_SEAT_H = 0.239;
export const DESK_APPROACH = 0.32;
const WORKTOP = 0.457;

export interface FurnitureCtx {
  theme?: RoomTheme;
  seed: number;
  variant?: string;
  /** Estado (porta do elevador 0..4, cafeteira...). */
  state?: number;
  deskSeat?: boolean;
  zone?: 'work' | 'meeting' | 'cafe';
}

/** Peças que o mundo atualiza depois de montadas (telas que seguem a atividade, portas de elevador). */
export interface FurnitureHooks {
  screen?: THREE.Mesh;
  chair?: { model: THREE.Group; baseZ: number; direction: number };
  cup?: THREE.Object3D;
  doors?: [THREE.Object3D, THREE.Object3D];
  clockHands?: [THREE.Object3D, THREE.Object3D];
  pingpong?: PingPongDisplay;
  arcade?: THREE.Mesh;
  steam?: THREE.Group;
  /** Planta inteira num pivô no centro do vaso: balança com a brisa. */
  sway?: THREE.Object3D;
  lamp?: THREE.Mesh;
  drawer?: { obj: THREE.Object3D; handle: THREE.Object3D; z: number };
  /** Objeto que o dono usa no Passear (E): a peça que muda e serve de ponto de alcance. */
  use?: { kind: 'tv' | 'fridge' | 'shelf' | 'switch'; part: THREE.Object3D };
}

/** Canais da TV do lounge (0 = desligada). */
export const TV_CHANNELS = 3;

const drawField = (c: CanvasRenderingContext2D, cw: number, ch: number) => {
  const gr = c.createLinearGradient(0, 0, 0, ch);
  gr.addColorStop(0, '#3a8f4f');
  gr.addColorStop(1, '#2a6b3b');
  c.fillStyle = gr;
  c.fillRect(0, 0, cw, ch);
  c.strokeStyle = 'rgba(255,255,255,.7)';
  c.lineWidth = 1.5;
  c.strokeRect(6, 6, cw - 12, ch - 12);
  c.beginPath();
  c.moveTo(cw / 2, 6);
  c.lineTo(cw / 2, ch - 6);
  c.stroke();
  c.beginPath();
  c.arc(cw / 2, ch / 2, 10, 0, Math.PI * 2);
  c.stroke();
};

/** Tela da TV por canal: futebol, jornal, desenho; 0 = desligada. */
export function tvScreen(channel: number): THREE.Material {
  if (channel === 1) return texMat('tv', 128, 72, drawField, 0.9);
  if (channel === 2) return texMat('tv:news', 128, 72, (c, cw, ch) => {
    c.fillStyle = '#1d3f73';
    c.fillRect(0, 0, cw, ch);
    c.fillStyle = '#e9eef6';
    c.fillRect(50, 12, 46, 40);
    c.fillStyle = '#c0392b';
    c.fillRect(0, ch - 18, cw, 12);
    c.fillStyle = '#fff';
    for (let i = 0; i < 5; i++) c.fillRect(8 + i * 24, ch - 14, 16, 3);
  }, 0.9);
  if (channel === 3) return texMat('tv:cartoon', 128, 72, (c, cw, ch) => {
    c.fillStyle = '#8fd3f4';
    c.fillRect(0, 0, cw, ch);
    c.fillStyle = '#7cc46a';
    c.fillRect(0, ch * 0.7, cw, ch * 0.3);
    c.fillStyle = '#ffd43b';
    c.beginPath();
    c.arc(cw * 0.78, ch * 0.25, 9, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ff7aa2';
    c.beginPath();
    c.arc(cw * 0.35, ch * 0.6, 12, 0, Math.PI * 2);
    c.fill();
  }, 0.9);
  return mat('#111418', { rough: 0.2 });
}

const DESK_TOPS: Record<string, string> = { wood: PAL.oak, white: PAL.white, dark: PAL.woodDark };
const CHAIR_COLORS: Record<string, string> = { black: PAL.charcoal, blue: PAL.navy, red: PAL.red, green: PAL.leafDark, gray: PAL.greyDark };

// ------------------------------------------------------------------ telas (texturas de canvas)

export type ScreenMode = 'off' | 'standby' | 'code' | 'term' | 'docs' | 'web' | 'chart' | 'chat';

/** Material da tela de um monitor. As variantes são poucas e compartilhadas por todas as mesas. */
export function screenMat(mode: ScreenMode, accent: string = PAL.blue): THREE.Material {
  if (mode === 'off') return mat('#1b1f27', { rough: 0.25, metal: 0.2 });
  return texMat(`screen:${mode}:${accent}`, 128, 80, (c, w, h) => {
    const bg = mode === 'term' ? '#11161d' : mode === 'docs' || mode === 'web' ? '#eef2f6' : '#1d2330';
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    const rnd = mulberry(mode.length * 977 + accent.length);
    if (mode === 'standby') {
      c.fillStyle = '#263547';
      c.fillRect(11, 12, 106, 57);
      c.fillStyle = accent;
      c.fillRect(53, 34, 22, 12);
      c.fillStyle = '#607482';
      c.fillRect(36, 54, 56, 3);
    } else if (mode === 'code' || mode === 'term') {
      const cols = mode === 'term' ? ['#7fd68b', '#c9d1d9', '#7fd68b'] : [accent, '#e6c07b', '#98c379', '#c678dd', '#abb2bf'];
      c.fillStyle = '#2a3140';
      if (mode === 'code') c.fillRect(0, 0, 22, h);
      for (let y = 6; y < h - 4; y += 6) {
        let x = (mode === 'code' ? 26 : 6) + Math.floor(rnd() * 3) * 6;
        const n = 2 + Math.floor(rnd() * 4);
        for (let i = 0; i < n && x < w - 8; i++) {
          const len = 6 + Math.floor(rnd() * 26);
          c.fillStyle = cols[Math.floor(rnd() * cols.length)]!;
          c.fillRect(x, y, Math.min(len, w - 6 - x), 3);
          x += len + 4;
        }
      }
    } else if (mode === 'docs' || mode === 'web') {
      c.fillStyle = accent;
      c.fillRect(0, 0, w, 10);
      c.fillStyle = '#c8d0da';
      for (let y = 18; y < h - 6; y += 7) c.fillRect(10, y, 40 + Math.floor(rnd() * 70), 3);
      if (mode === 'web') {
        c.fillStyle = '#d5dde6';
        c.fillRect(w - 44, 18, 34, 26);
      }
    } else if (mode === 'chart') {
      c.strokeStyle = accent;
      c.lineWidth = 3;
      c.beginPath();
      for (let x = 6; x < w - 6; x += 10) c.lineTo(x, h - 12 - rnd() * (h - 30) * (x / w));
      c.stroke();
      for (let i = 0; i < 6; i++) {
        c.fillStyle = i % 2 ? '#e6c07b' : '#98c379';
        c.fillRect(10 + i * 18, h - 8, 12, -8 - rnd() * 18);
      }
    } else {
      for (let y = 8; y < h - 10; y += 16) {
        const me = rnd() > 0.5;
        c.fillStyle = me ? accent : '#3a4356';
        c.fillRect(me ? w - 70 : 8, y, 62, 11);
      }
    }
  }, mode === 'standby' ? 0.22 : mode === 'docs' || mode === 'web' ? 0.55 : 0.9);
}

function mulberry(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ peças reutilizáveis

function monitor(g: THREE.Group, x: number, y: number, z: number, faceSouth: boolean, hooks: FurnitureHooks): void {
  const ry = faceSouth ? 0 : Math.PI;
  const m = new THREE.Group();
  m.position.set(x, y, z);
  m.rotation.y = ry;
  const crafted = place(m, 'craftedMonitor', { w: 0.67 }, 0, 0, 0);
  const socket = crafted?.getObjectByName('Socket_Screen');
  if (socket) {
    g.add(m);
    const c = m.worldToLocal(socket.getWorldPosition(new THREE.Vector3()));
    const screen = put(m, plane(0.587, 0.319), screenMat('off'), c.x, c.y - 0.319 / 2, c.z + 0.009, { shadow: false });
    screen.userData.dynamic = true;
    hooks.screen = screen;
    return;
  }
  if (crafted) m.remove(crafted);
  const model = place(m, 'computerScreen', { w: 0.66 }, 0, 0, 0);
  if (model) {
    // a tela dinâmica cobre o painel claro do modelo
    g.add(m);
    const b = partBox(model, 'metal');
    const c = b.getCenter(new THREE.Vector3());
    const height = (b.max.y - b.min.y) * 0.9;
    const screen = put(m, plane((b.max.x - b.min.x) * 0.94, height), screenMat('off'), c.x, c.y - height / 2, b.max.z + 0.004, { shadow: false });
    screen.userData.dynamic = true;
    hooks.screen = screen;
    return;
  }
  block(m, 0.16, 0.012, 0.1, PAL.charcoal, 0, 0, 0, 0.006);
  block(m, 0.03, 0.14, 0.03, PAL.charcoal, 0, 0.01, -0.02, 0.01);
  block(m, 0.62, 0.36, 0.035, PAL.black, 0, 0.12, 0, 0.02);
  const screen = put(m, plane(0.57, 0.31), screenMat('off'), 0, 0.145, 0.0185, { shadow: false });
  screen.userData.dynamic = true;
  hooks.screen = screen;
  g.add(m);
}

function keyboard(g: THREE.Group, x: number, y: number, z: number, ry = 0): void {
  if (place(g, 'craftedKeyboard', { w: 0.343 }, x, y, z, ry)) {
    place(g, 'craftedMouse', { w: 0.062 }, x + (ry ? -0.26 : 0.26), y, z + 0.014, ry);
    return;
  }
  if (place(g, 'computerKeyboard', { w: 0.36 }, x, y, z, ry)) {
    place(g, 'computerMouse', { w: 0.05 }, x + (ry ? -0.27 : 0.27), y, z, ry);
    return;
  }
  const k = block(g, 0.34, 0.016, 0.11, PAL.white, x, y, z, 0.008);
  k.rotation.y = ry;
  const mouse = block(g, 0.045, 0.02, 0.07, PAL.white, x + (ry ? -0.26 : 0.26), y, z, 0.02);
  mouse.rotation.y = ry;
}

function mug(g: THREE.Group, x: number, y: number, z: number, color: string): THREE.Object3D {
  return place(g, 'craftedMug', { h: 0.093 }, x, y, z, 0.35)
    ?? put(g, cyl(0.035, 0.03, 0.075, 12), mat(color, { rough: 0.5 }), x, y, z);
}

function pot(g: THREE.Group, x: number, z: number, r: number, h: number, color: string): void {
  put(g, cyl(r, r * 0.78, h, 18), mat(color, { rough: 0.85 }), x, 0, z);
  put(g, cyl(r * 0.9, r * 0.9, 0.02, 18), mat('#5a3d2b', { rough: 1 }), x, h - 0.02, z, { shadow: false });
}

/** Folhagem estilizada: aglomerado de esferas achatadas. */
function foliage(g: THREE.Group, x: number, y: number, z: number, r: number, color: string, seed: number, n = 5): void {
  const rnd = mulberry(seed);
  const m = mat(color, { rough: 0.9 });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd();
    const rr = r * (0.5 + rnd() * 0.35);
    const s = put(g, sphere(rr, 12), m, x + Math.cos(a) * r * 0.45, y + rnd() * r * 0.6, z + Math.sin(a) * r * 0.45);
    s.scale.y = 0.85;
  }
  put(g, sphere(r * 0.6, 12), m, x, y + r * 0.55, z);
}

function chair(g: THREE.Group, cx: number, cz: number, backSouth: boolean, color: string, ctx: FurnitureCtx, hooks: FurnitureHooks): void {
  const direction = backSouth ? 1 : -1;
  const c = new THREE.Group();
  const baseZ = cz - direction * (ctx.deskSeat ? DESK_APPROACH - 0.07 : 0);
  c.position.set(cx, 0, baseZ);
  c.userData.dynamic = !!ctx.deskSeat;
  c.name = 'office-chair';
  g.add(c);
  if (ctx.deskSeat) hooks.chair = { model: c, baseZ, direction };
  const h = ctx.deskSeat ? 0.523 : 0.655;
  if (place(c, 'craftedChair', { w: 0.48, h, d: 0.44 }, 0, 0, 0, backSouth ? Math.PI : 0)) return;
  if (place(c, 'chairDesk', { h }, 0, 0, 0, backSouth ? Math.PI : 0, { carpet: color })) return;
  c.rotation.y = backSouth ? 0 : Math.PI;
  const base = mat(PAL.greyDark, { rough: 0.4, metal: 0.5 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    put(c, rbox(0.2, 0.025, 0.035, 0.01), base, Math.cos(a) * 0.09, 0.02, Math.sin(a) * 0.09, { ry: -a });
    put(c, sphere(0.022, 8), base, Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18);
  }
  put(c, cyl(0.022, 0.022, SEAT_H - 0.06, 10), base, 0, 0.03, 0);
  block(c, 0.46, 0.07, 0.42, color, 0, SEAT_H - 0.05, 0, 0.035);
  block(c, 0.44, 0.42, 0.07, color, 0, SEAT_H + 0.02, 0.21, 0.035);
  block(c, 0.04, 0.12, 0.24, PAL.greyDark, -0.24, SEAT_H, 0.02, 0.015);
  block(c, 0.04, 0.12, 0.24, PAL.greyDark, 0.24, SEAT_H, 0.02, 0.015);
}

function dirYaw(dir: string | undefined): number {
  // direção para onde quem senta olha: down = +z (para a câmera)
  switch (dir) {
    case 'up':
      return Math.PI;
    case 'left':
      return -Math.PI / 2;
    case 'right':
      return Math.PI / 2;
    default:
      return 0;
  }
}

function books(g: THREE.Group, x0: number, y: number, z: number, width: number, seed: number, depth = 0.22): void {
  const rnd = mulberry(seed);
  const colors = [PAL.coral, PAL.blue, PAL.mustard, PAL.sage, PAL.navy, PAL.terracotta, PAL.lilac, PAL.teal, PAL.cream];
  let x = x0;
  while (x < x0 + width - 0.05) {
    const w = 0.035 + rnd() * 0.03;
    const h = 0.17 + rnd() * 0.1;
    if (rnd() < 0.12) {
      x += 0.05;
      continue;
    }
    const b = block(g, w, h, depth * (0.8 + rnd() * 0.2), colors[Math.floor(rnd() * colors.length)]!, x + w / 2, y, z, 0.006);
    if (rnd() < 0.1) b.rotation.z = 0.25;
    x += w + 0.006;
  }
}

// ------------------------------------------------------------------ móveis de chão

type Builder = (g: THREE.Group, w: number, h: number, ctx: FurnitureCtx, hooks: FurnitureHooks) => void;

/** Geladeira aberta (escondida até o dono abrir): interior aceso com prateleiras e a porta girada para fora. */
function fridgeOpen(g: THREE.Group): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(g);
  if (box.isEmpty()) box.set(new THREE.Vector3(0.11, 0, 0.1), new THREE.Vector3(0.89, 1.65, 0.8));
  const w = box.max.x - box.min.x;
  const h = box.max.y - box.min.y;
  const cx = (box.min.x + box.max.x) / 2;
  const front = box.max.z;
  const open = new THREE.Group();
  block(open, w * 0.86, h * 0.86, 0.01, mat('#eef6fb', { emissive: '#dff1ff', emissiveIntensity: 0.6 }), cx, h * 0.07, front + 0.006, 0.004);
  const food = [PAL.orange, PAL.sage, PAL.mustard, PAL.red];
  for (let i = 0; i < 3; i++) {
    const y = h * (0.3 + i * 0.2);
    block(open, w * 0.8, 0.012, 0.02, '#bcd3e0', cx, y, front + 0.016, 0.003);
    for (let k = 0; k < 2; k++) block(open, 0.09, 0.12, 0.03, food[(i + k) % 4]!, cx - w * 0.2 + k * w * 0.32, y + 0.012, front + 0.03, 0.01);
  }
  const hinge = new THREE.Group();
  hinge.position.set(box.min.x, 0, front);
  hinge.rotation.y = -1.9;
  block(hinge, w, h * 0.98, 0.05, PAL.white, w / 2, 0.01, 0.025, 0.02);
  open.add(hinge);
  open.visible = false;
  open.userData.dynamic = true;
  g.add(open);
  return open;
}

const FLOOR: Partial<Record<FurnitureKind, Builder>> = {
  desk: (g, _w, _h, ctx, hooks) => deskModel(g, ctx, hooks, true),
  desk_back: (g, _w, _h, ctx, hooks) => deskModel(g, ctx, hooks, false),
  office_chair: (g, _w, _h, ctx, hooks) => chair(g, 0.5, 0.5, true, CHAIR_COLORS[ctx.variant ?? ctx.theme?.chairVariant ?? 'black'] ?? PAL.charcoal, ctx, hooks),
  office_chair_front: (g, _w, _h, ctx, hooks) => chair(g, 0.5, 0.5, false, CHAIR_COLORS[ctx.variant ?? ctx.theme?.chairVariant ?? 'black'] ?? PAL.charcoal, ctx, hooks),
  bookshelf: (g, w, _h, ctx, hooks) => {
    // o livro que o dono tira da estante (fica inclinado, um pouco para fora)
    const book = block(g, 0.05, 0.24, 0.18, PAL.red, w * 0.72, 0.6, 0.38, 0.008);
    book.rotation.z = 0.12;
    book.userData.dynamic = true;
    hooks.use = { kind: 'shelf', part: book };
    if (place(g, 'craftedBookcase', { w: w - 0.10, h: 1.52, d: 0.42 }, w / 2, 0, 0.24)) return;
    const wood = mat(PAL.wood);
    block(g, w - 0.08, 1.7, 0.36, wood, w / 2, 0, 0.22, 0.02);
    const inner = mat(PAL.woodDark);
    for (let i = 0; i < 4; i++) {
      const y = 0.08 + i * 0.4;
      block(g, w - 0.16, 0.34, 0.3, inner, w / 2, y + 0.02, 0.25, 0.005);
      books(g, 0.12, y + 0.03, 0.27, w - 0.24, ctx.seed + i * 31);
    }
  },
  binder_shelf: (g, _w, _h, ctx) => {
    const frame = '#c6a487';
    const inside = '#dde0ce';
    block(g, 0.78, 1.49, 0.055, inside, 0.5, 0.025, 0.058, 0.019);
    for (const x of [0.11, 0.89]) block(g, 0.069, 1.50, 0.42, frame, x, 0.018, 0.24, 0.022);
    const colors = [PAL.blue, PAL.orange, PAL.sage];
    for (let i = 0; i <= 3; i++) {
      const y = 0.055 + i * 0.47;
      block(g, 0.84, 0.067, 0.44, frame, 0.5, y, 0.24, 0.022);
      if (i === 3) break;
      for (let k = 0; k < 6; k++) {
        const x = 0.21 + k * 0.115;
        const height = 0.29 + ((i + k * 2) % 4) * 0.022;
        block(g, 0.092, height, 0.26, colors[(k + i + ctx.seed) % 3]!, x, y + 0.067, 0.247, 0.012);
        block(g, 0.057, 0.09, 0.008, '#f7ecd8', x, y + height - 0.06, 0.381, 0.004);
      }
    }
    place(g, 'craftedPlant', { h: 0.31 }, 0.72, 1.532, 0.25);
  },
  filing_cabinet: (g, _w, _h, _ctx, hooks) => {
    const cabinet = place(g, 'craftedCabinet', { w: 0.71, h: 0.82, d: 0.57 }, 0.5, 0, 0.45);
    if (cabinet) {
      const handle = cabinet.getObjectByName('Socket_Handle');
      if (handle) cabinet.traverse((obj) => {
        if (obj.userData.drawer !== true) return;
        obj.userData.dynamic = true;
        hooks.drawer = { obj, handle, z: obj.position.z };
      });
      return;
    }
    block(g, 0.6, 0.8, 0.55, PAL.grey, 0.5, 0, 0.45, 0.025);
    for (let i = 0; i < 3; i++) {
      block(g, 0.54, 0.22, 0.02, PAL.metal, 0.5, 0.06 + i * 0.25, 0.73, 0.01);
      block(g, 0.16, 0.025, 0.03, PAL.greyDark, 0.5, 0.2 + i * 0.25, 0.745, 0.01);
    }
  },
  printer: (g) => {
    block(g, 0.7, 0.42, 0.55, PAL.woodLight, 0.5, 0, 0.45, 0.02);
    block(g, 0.56, 0.22, 0.46, PAL.white, 0.5, 0.42, 0.45, 0.04);
    block(g, 0.4, 0.02, 0.2, PAL.paper, 0.5, 0.56, 0.62, 0.005);
    put(g, sphere(0.018, 8), mat('#5fd47a', { emissive: '#5fd47a', emissiveIntensity: 1.2 }), 0.7, 0.6, 0.62);
  },
  trash_bin: (g) => {
    if (place(g, 'trashcan', { h: 0.4 }, 0.5, 0, 0.55)) return;
    put(g, cyl(0.15, 0.12, 0.3, 16), mat(PAL.greyDark, { rough: 0.6 }), 0.5, 0, 0.55);
    put(g, sphere(0.05, 8), mat(PAL.paper), 0.5, 0.26, 0.55);
  },
  plant_small: (g, _w, _h, ctx) => {
    if (ctx.variant !== 'flower' && place(g, 'craftedPlant', { h: 0.43 }, 0.5, 0, 0.48, ctx.seed % 6)) return;
    const v = ctx.variant ?? pick(['fern', 'succulent', 'flower'], ctx.seed);
    const model = pick<[PropName, number]>([['cactusS1', 0.45], ['cactusS2', 0.45], ['plantSmall2', 0.5], ['plantSmall1', 0.5]], ctx.seed);
    if (place(g, model[0], { h: model[1] }, 0.5, 0, 0.55, ctx.seed % 4)) return;
    pot(g, 0.5, 0.55, 0.14, 0.22, v === 'succulent' ? PAL.cream : PAL.terracotta);
    if (v === 'flower') {
      foliage(g, 0.5, 0.22, 0.55, 0.16, PAL.leaf, ctx.seed, 4);
      for (let i = 0; i < 5; i++) put(g, sphere(0.04, 8), mat(pick([PAL.pink, PAL.mustard, PAL.coral], ctx.seed + i)), 0.5 + Math.cos(i * 1.3) * 0.1, 0.36 + (i % 2) * 0.05, 0.55 + Math.sin(i * 1.3) * 0.1);
    } else if (v === 'succulent') {
      for (let i = 0; i < 6; i++) {
        const leaf = put(g, sphere(0.05, 8), mat(PAL.sage), 0.5 + Math.cos(i) * 0.06, 0.22, 0.55 + Math.sin(i) * 0.06);
        leaf.scale.set(0.6, 1.4, 0.6);
      }
    } else foliage(g, 0.5, 0.22, 0.55, 0.2, PAL.leafDark, ctx.seed, 6);
  },
  plant_tall: (g, _w, _h, ctx) => {
    const v = ctx.variant ?? pick(['palm', 'ficus', 'monstera', 'bonsai'], ctx.seed);
    if ((v === 'ficus' || v === 'monstera')
      && place(g, 'craftedPlant', { h: 1.12, w: 0.74, d: 0.66 }, 0.5, 0, 0.5, ctx.seed % 6)) return;
    const model = pick<[PropName, number]>([['pottedPlant', 1.25], ['cactusM1', 0.95], ['pottedPlant', 1.1], ['cactusM2', 0.95]], ctx.seed);
    if (place(g, model[0], { h: model[1] }, 0.5, 0, 0.5, ctx.seed % 6)) return;
    pot(g, 0.5, 0.5, 0.2, 0.34, v === 'bonsai' ? PAL.navy : pick([PAL.terracotta, PAL.cream, PAL.charcoal], ctx.seed));
    if (v === 'bonsai') {
      put(g, cyl(0.03, 0.05, 0.3, 8), mat(PAL.woodDark), 0.5, 0.34, 0.5);
      foliage(g, 0.5, 0.6, 0.5, 0.2, PAL.leaf, ctx.seed, 4);
      return;
    }
    put(g, cyl(0.025, 0.04, v === 'palm' ? 0.9 : 0.7, 8), mat(PAL.woodDark), 0.5, 0.34, 0.5);
    if (v === 'palm') {
      for (let i = 0; i < 7; i++) {
        const leaf = put(g, rbox(0.5, 0.02, 0.13, 0.01), mat(PAL.leaf), 0.5, 1.18, 0.5, { ry: (i / 7) * Math.PI * 2 });
        leaf.rotation.z = -0.5;
        leaf.position.x += Math.cos((i / 7) * Math.PI * 2) * 0.2;
        leaf.position.z -= Math.sin((i / 7) * Math.PI * 2) * 0.2;
      }
    } else foliage(g, 0.5, 0.75, 0.5, v === 'monstera' ? 0.36 : 0.3, v === 'monstera' ? PAL.leafDark : PAL.leaf, ctx.seed, 7);
  },
  glass_partition: (g, _w, _h, ctx) => {
    const v = ctx.variant ?? 'h';
    const glass = mat(PAL.glass, { opacity: 0.35, rough: 0.1, metal: 0.1 });
    if (v === 'end') {
      block(g, 0.12, 1.15, 0.12, PAL.white, 0.5, 0, 0.5, 0.03);
      return;
    }
    const along = v === 'h';
    block(g, along ? 1 : 0.1, 0.35, along ? 0.1 : 1, PAL.white, 0.5, 0, 0.5, 0.02);
    block(g, along ? 1 : 0.04, 0.75, along ? 0.04 : 1, glass, 0.5, 0.35, 0.5, 0.005);
    block(g, along ? 1 : 0.06, 0.04, along ? 0.06 : 1, PAL.metal, 0.5, 1.1, 0.5, 0.01);
  },
  meeting_table: (g, w, h, ctx) => {
    const accent = ctx.zone === 'meeting' ? '#ac8449' : ctx.zone === 'cafe' ? '#b76950' : '#416a6b';
    block(g, w - 0.3, 0.06, h - 0.35, '#cfa575', w / 2, DESK_H - 0.06, h / 2, 0.04);
    block(g, 0.3, DESK_H - 0.06, 0.3, PAL.charcoal, w / 2 - 0.7, 0, h / 2, 0.03);
    block(g, 0.3, DESK_H - 0.06, 0.3, PAL.charcoal, w / 2 + 0.7, 0, h / 2, 0.03);
    block(g, w - 0.65, 0.005, 0.27, accent, w / 2, DESK_H + 0.002, h / 2, 0.002);
    place(g, 'craftedNotebook', { w: 0.35 }, w / 2 - 0.47, DESK_H, h / 2 + 0.16, 0.22);
    mug(g, w / 2 + 0.5, DESK_H, h / 2 - 0.15, PAL.coral);
    if (ctx.zone === 'meeting') place(g, 'craftedRemote', { d: 0.16 }, w / 2 + 0.16, DESK_H + 0.007, h / 2, -0.25);
    else if (ctx.zone === 'cafe') place(g, 'craftedService', { w: 0.35 }, w / 2 + 0.16, DESK_H + 0.007, h / 2, -0.12);
  },
  stool: (g) => {
    if (place(g, 'stool', { h: STOOL_H }, 0.5, 0, 0.5)) return;
    put(g, cyl(0.17, 0.17, 0.07, 16), mat(PAL.mustard), 0.5, STOOL_H - 0.07, 0.5);
    put(g, cyl(0.025, 0.025, STOOL_H - 0.07, 8), mat(PAL.greyDark, { metal: 0.5, rough: 0.4 }), 0.5, 0, 0.5);
    put(g, cyl(0.13, 0.15, 0.02, 16), mat(PAL.greyDark, { metal: 0.5, rough: 0.4 }), 0.5, 0, 0.5);
  },
  floor_lamp: (g, _w, _h, _ctx, hooks) => {
    if (place(g, 'craftedLamp', { h: 1.32 }, 0.5, 0, 0.52, -0.34)) {
      hooks.lamp = put(g, sphere(0.072, 10), mat('#ffe8ba', { emissive: '#ffca75', emissiveIntensity: 1.4 }), 0.5, 1.088, 0.52, { shadow: false });
      hooks.lamp.userData.dynamic = true;
      return;
    }
    const lamp = place(g, 'lamp', { h: 1.45 }, 0.5, 0, 0.5);
    if (lamp) {
      // brilho da cúpula à noite (o tecido do modelo não emite)
      put(g, sphere(0.1, 10), mat('#ffe2a8', { emissive: '#ffd9a0', emissiveIntensity: 0.9 }), 0.5, 1.22, 0.5, { shadow: false });
      return;
    }
    put(g, cyl(0.13, 0.15, 0.03, 16), mat(PAL.charcoal), 0.5, 0, 0.5);
    put(g, cyl(0.015, 0.015, 1.3, 8), mat(PAL.charcoal, { metal: 0.6, rough: 0.3 }), 0.5, 0.03, 0.5);
    put(g, cyl(0.12, 0.2, 0.22, 18), mat(PAL.cream, { emissive: '#ffd9a0', emissiveIntensity: 0.6 }), 0.5, 1.28, 0.5);
  },
  water_cooler: (g) => {
    block(g, 0.4, 0.75, 0.38, PAL.white, 0.5, 0, 0.5, 0.04);
    put(g, cyl(0.15, 0.15, 0.36, 16), mat('#7fb7e6', { opacity: 0.7, rough: 0.15 }), 0.5, 0.75, 0.5);
    block(g, 0.08, 0.05, 0.04, PAL.blue, 0.42, 0.5, 0.7, 0.01);
    block(g, 0.08, 0.05, 0.04, PAL.red, 0.58, 0.5, 0.7, 0.01);
  },
  counter: (g, _w, _h, ctx) => counterBase(g, ctx.variant === 'drawers'),
  counter_sink: (g) => {
    counterBase(g, false);
    block(g, 0.5, 0.03, 0.36, PAL.metal, 0.5, 0.6, 0.45, 0.02).material = mat(PAL.metal, { metal: 0.7, rough: 0.25 });
    put(g, cyl(0.015, 0.015, 0.22, 8), mat(PAL.metal, { metal: 0.8, rough: 0.2 }), 0.5, 0.62, 0.2);
  },
  coffee_machine: (g, _w, _h, _ctx, hooks) => {
    counterBase(g, false);
    const coffee = place(g, 'craftedCoffee', { h: 0.42 }, 0.56, 0.64, 0.34);
    if (coffee) {
      place(g, 'craftedService', { w: 0.35 }, 0.23, 0.64, 0.48);
      const anchor = coffee.getObjectByName('Socket_Cup');
      const target = anchor ? g.worldToLocal(anchor.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3(0.56, 0.71, 0.49);
      hooks.cup = mug(g, target.x, target.y, target.z, PAL.cream);
      hooks.cup.userData.dynamic = true;
      hooks.steam = new THREE.Group();
      hooks.steam.position.copy(target);
      hooks.steam.position.y += 0.10;
      hooks.steam.userData.dynamic = true;
      hooks.steam.visible = false;
      for (let i = 0; i < 3; i++) put(hooks.steam, sphere(0.038, 8), mat('#fff9e9', { opacity: 0.23 }), 0, 0, 0, { shadow: false });
      g.add(hooks.steam);
      return;
    }
    if (place(g, 'coffeeMachine', { h: 0.36 }, 0.5, 0.64, 0.4)) {
      mug(g, 0.22, 0.64, 0.55, PAL.cream);
      return;
    }
    block(g, 0.36, 0.42, 0.3, PAL.charcoal, 0.5, 0.63, 0.38, 0.04);
    block(g, 0.3, 0.08, 0.04, PAL.metal, 0.5, 0.92, 0.54, 0.01);
    put(g, sphere(0.02, 8), mat('#ff8a3c', { emissive: '#ff8a3c', emissiveIntensity: 1.5 }), 0.62, 0.95, 0.54);
    mug(g, 0.5, 0.66, 0.5, PAL.cream);
  },
  microwave: (g) => {
    counterBase(g, false);
    if (place(g, 'microwave', { w: 0.58 }, 0.5, 0.64, 0.4)) return;
    block(g, 0.6, 0.3, 0.4, PAL.white, 0.5, 0.63, 0.4, 0.03);
    block(g, 0.36, 0.22, 0.02, PAL.black, 0.42, 0.67, 0.61, 0.01);
  },
  fridge: (g, _w, _h, _ctx, hooks) => {
    if (place(g, 'fridge', { h: 1.7 }, 0.5, 0, 0.45)) return void (hooks.use = { kind: 'fridge', part: fridgeOpen(g) });
    hooks.use = { kind: 'fridge', part: fridgeOpen(g) };
    block(g, 0.78, 1.65, 0.7, PAL.white, 0.5, 0, 0.45, 0.06);
    block(g, 0.74, 0.015, 0.02, PAL.grey, 0.5, 1.05, 0.81, 0.005);
    block(g, 0.04, 0.3, 0.04, PAL.metal, 0.82, 1.15, 0.82, 0.015);
    block(g, 0.04, 0.3, 0.04, PAL.metal, 0.82, 0.6, 0.82, 0.015);
    block(g, 0.12, 0.12, 0.01, PAL.mustard, 0.35, 1.3, 0.81, 0.01);
  },
  vending_machine: (g) => {
    block(g, 0.84, 1.75, 0.7, PAL.red, 0.5, 0, 0.45, 0.05);
    block(g, 0.56, 1.2, 0.02, '#20303f', 0.4, 0.4, 0.81, 0.01).material = mat('#4b6a86', { emissive: '#9fd4ff', emissiveIntensity: 0.25, rough: 0.15 });
    const snack = [PAL.mustard, PAL.orange, PAL.blue, PAL.sage, PAL.pink];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) block(g, 0.09, 0.14, 0.05, snack[(r + c) % 5]!, 0.2 + c * 0.13, 0.5 + r * 0.27, 0.77, 0.01);
    block(g, 0.12, 0.3, 0.02, PAL.charcoal, 0.8, 0.9, 0.81, 0.01);
  },
  cafe_table: (g) => {
    if (place(g, 'tableRound', { h: DESK_H }, 0.5, 0, 0.5)) {
      put(g, cyl(0.06, 0.06, 0.012, 12), mat(PAL.white), 0.42, DESK_H, 0.45);
      return;
    }
    put(g, cyl(0.32, 0.32, 0.04, 22), mat(PAL.oak), 0.5, DESK_H - 0.04, 0.5);
    put(g, cyl(0.03, 0.03, DESK_H - 0.04, 8), mat(PAL.charcoal, { metal: 0.5, rough: 0.4 }), 0.5, 0, 0.5);
    put(g, cyl(0.16, 0.18, 0.02, 16), mat(PAL.charcoal), 0.5, 0, 0.5);
    put(g, cyl(0.06, 0.06, 0.012, 12), mat(PAL.white), 0.42, DESK_H, 0.45);
  },
  cafe_chair: (g, _w, _h, ctx) => {
    if (place(g, 'woodChair', { h: 0.84 }, 0.5, 0, 0.5, dirYaw(ctx.variant))) return;
    const c = new THREE.Group();
    c.position.set(0.5, 0, 0.5);
    c.rotation.y = dirYaw(ctx.variant);
    const wood = mat(PAL.oak);
    block(c, 0.36, 0.05, 0.36, wood, 0, SEAT_H - 0.05, 0, 0.02);
    for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]] as const) put(c, cyl(0.02, 0.018, SEAT_H - 0.05, 8), wood, x, 0, z);
    block(c, 0.36, 0.3, 0.04, wood, 0, SEAT_H, -0.17, 0.02);
    g.add(c);
  },
  sofa: (g, w, _h, ctx) => {
    if (place(g, 'craftedSofa', { w: w - 0.11, h: 0.65, d: 0.80 }, w / 2, 0, 0.49, ctx.variant === 'up' ? Math.PI : 0)) return;
    if (place(g, 'couch', { w: w - 0.1 }, w / 2, 0, 0.5, ctx.variant === 'up' ? Math.PI : 0)) return;
    const c = new THREE.Group();
    c.position.set(w / 2, 0, 0.5);
    c.rotation.y = ctx.variant === 'up' ? Math.PI : 0;
    const fabric = mat(pick([PAL.navy, PAL.teal, PAL.terracotta, PAL.sage], ctx.seed), { rough: 0.95 });
    block(c, w - 0.1, SEAT_H - 0.08, 0.72, fabric, 0, 0.06, 0, 0.08);
    for (let i = 0; i < 3; i++) block(c, (w - 0.5) / 3 - 0.02, 0.1, 0.56, fabric, -((w - 0.5) / 3) + i * ((w - 0.5) / 3), SEAT_H - 0.04, 0.06, 0.05);
    block(c, w - 0.1, 0.42, 0.18, fabric, 0, SEAT_H - 0.05, -0.28, 0.08);
    block(c, 0.2, 0.36, 0.72, fabric, -w / 2 + 0.15, 0.06, 0, 0.08);
    block(c, 0.2, 0.36, 0.72, fabric, w / 2 - 0.15, 0.06, 0, 0.08);
    block(c, 0.24, 0.22, 0.1, PAL.mustard, -w / 2 + 0.45, SEAT_H + 0.04, -0.17, 0.05).rotation.z = 0.15;
    for (const x of [-w / 2 + 0.15, w / 2 - 0.15]) for (const z of [-0.28, 0.28]) put(c, cyl(0.025, 0.02, 0.06, 8), mat(PAL.woodDark), x, 0, z);
    g.add(c);
  },
  armchair: (g, _w, _h, ctx) => {
    if (place(g, 'craftedLoungeChair', { w: 0.79, h: 0.66, d: 0.68 }, 0.5, 0, 0.5, dirYaw(ctx.variant))) return;
    if (place(g, 'armchair', { h: 0.78 }, 0.5, 0, 0.5, dirYaw(ctx.variant))) return;
    const c = new THREE.Group();
    c.position.set(0.5, 0, 0.5);
    c.rotation.y = dirYaw(ctx.variant);
    const fabric = mat(pick([PAL.mustard, PAL.teal, PAL.coral, PAL.sage], ctx.seed), { rough: 0.95 });
    block(c, 0.7, SEAT_H - 0.04, 0.68, fabric, 0, 0.05, 0, 0.08);
    block(c, 0.7, 0.42, 0.18, fabric, 0, SEAT_H - 0.04, -0.25, 0.08);
    block(c, 0.15, 0.3, 0.6, fabric, -0.3, SEAT_H - 0.05, 0.02, 0.06);
    block(c, 0.15, 0.3, 0.6, fabric, 0.3, SEAT_H - 0.05, 0.02, 0.06);
    g.add(c);
  },
  coffee_table: (g, w) => {
    if (place(g, 'lowTable', { w: w - 0.35 }, w / 2, 0, 0.5)) {
      place(g, 'craftedBooks', { h: 0.14 }, w / 2 - 0.24, 0.2, 0.5, 0.4)
        ?? place(g, 'bookSet', { h: 0.12 }, w / 2 - 0.2, 0.2, 0.5, 0.4);
      mug(g, w / 2 + 0.25, 0.2, 0.45, PAL.mustard);
      return;
    }
    block(g, w - 0.3, 0.05, 0.6, PAL.oak, w / 2, 0.24, 0.5, 0.03);
    block(g, w - 0.4, 0.03, 0.5, PAL.woodDark, w / 2, 0.08, 0.5, 0.02);
    for (const x of [0.25, w - 0.25]) for (const z of [0.27, 0.73]) put(g, cyl(0.025, 0.025, 0.24, 8), mat(PAL.woodDark), x, 0, z);
    block(g, 0.3, 0.04, 0.22, PAL.blue, w / 2 - 0.2, 0.29, 0.5, 0.01);
    mug(g, w / 2 + 0.25, 0.29, 0.45, PAL.mustard);
  },
  pingpong_table: (g, w, h, _ctx, hooks) => {
    const table = place(g, 'craftedPingPong', { w: w - 0.2, h: 0.666, d: h - 0.35 }, w / 2, 0, h / 2);
    const playSurface = table?.getObjectByName('Socket_Play_Surface');
    hooks.pingpong = new PingPongDisplay(w, h, playSurface?.getWorldPosition(new THREE.Vector3()).y ?? DESK_H);
    g.add(hooks.pingpong.root);
    if (table) return;
    block(g, w - 0.2, 0.05, h - 0.4, '#2f7a5b', w / 2, DESK_H - 0.05, h / 2, 0.02);
    block(g, w - 0.24, 0.006, 0.02, PAL.white, w / 2, DESK_H, h / 2, 0.002);
    block(g, 0.02, 0.14, h - 0.4, PAL.white, w / 2, DESK_H, h / 2, 0.005).material = mat(PAL.white, { opacity: 0.75 });
    for (const x of [0.4, w - 0.4]) for (const z of [0.4, h - 0.4]) put(g, cyl(0.03, 0.03, DESK_H - 0.05, 8), mat(PAL.charcoal), x, 0, z);
  },
  beanbag: (g, _w, _h, ctx) => {
    const colors: Record<string, string> = { red: PAL.coral, blue: PAL.blue, yellow: PAL.mustard, green: PAL.sage };
    const b = put(g, sphere(0.34, 18), mat(colors[ctx.variant ?? 'red'] ?? PAL.coral, { rough: 0.95 }), 0.5, 0, 0.5);
    b.scale.set(1, 0.62, 1);
    const top = put(g, sphere(0.22, 14), mat(colors[ctx.variant ?? 'red'] ?? PAL.coral, { rough: 0.95 }), 0.5, 0.18, 0.38);
    top.scale.set(1.2, 0.8, 0.7);
  },
  arcade: (g, _w, _h, _ctx, hooks) => {
    block(g, 0.7, 1.6, 0.66, PAL.navy, 0.5, 0, 0.42, 0.04);
    const scr = put(g, plane(0.5, 0.42), arcadeScreen(0), 0.5, 1.0, 0.765, { shadow: false });
    scr.rotation.x = -0.12;
    scr.userData.dynamic = true;
    hooks.arcade = scr;
    block(g, 0.7, 0.08, 0.3, PAL.charcoal, 0.5, 0.8, 0.8, 0.02);
    put(g, sphere(0.03, 8), mat(PAL.red), 0.38, 0.88, 0.8);
    put(g, sphere(0.025, 8), mat(PAL.mustard), 0.58, 0.88, 0.8);
    block(g, 0.72, 0.16, 0.66, PAL.pink, 0.5, 1.6, 0.42, 0.04).material = mat(PAL.pink, { emissive: PAL.pink, emissiveIntensity: 0.5 });
  },
  toilet_stall: (g, w, h) => {
    const panel = mat(PAL.blueSoft, { rough: 0.6 });
    block(g, 0.06, 1.3, h - 0.1, panel, 0.05, 0.08, h / 2, 0.02);
    block(g, 0.06, 1.3, h - 0.1, panel, w - 0.05, 0.08, h / 2, 0.02);
    block(g, w - 0.6, 1.2, 0.05, panel, w / 2 + 0.25, 0.1, h - 0.05, 0.02);
    if (!place(g, 'toilet', { h: 0.5 }, w / 2, 0, 0.4)) {
      put(g, cyl(0.16, 0.13, 0.3, 16), mat(PAL.white, { rough: 0.3 }), w / 2, 0, 0.5);
      block(g, 0.36, 0.34, 0.14, PAL.white, w / 2, 0.2, 0.18, 0.04);
    }
  },
  sink: (g) => {
    if (place(g, 'bathroomSink', { h: 0.75 }, 0.5, 0, 0.32)) return;
    block(g, 0.7, 0.55, 0.5, PAL.woodLight, 0.5, 0, 0.35, 0.03);
    put(g, cyl(0.2, 0.15, 0.08, 18), mat(PAL.white, { rough: 0.25 }), 0.5, 0.55, 0.38);
    put(g, cyl(0.015, 0.015, 0.16, 8), mat(PAL.metal, { metal: 0.8, rough: 0.2 }), 0.5, 0.55, 0.16);
  },
  reception_desk: (g, w) => {
    block(g, w - 0.1, 0.78, 0.7, PAL.oak, w / 2, 0, 0.45, 0.06);
    block(g, w - 0.05, 0.05, 0.4, PAL.cream, w / 2, 0.78, 0.68, 0.02);
    block(g, w - 0.3, 0.12, 0.02, PAL.sage, w / 2, 0.45, 0.81, 0.01);
    const hooks: FurnitureHooks = {};
    monitor(g, w / 2 - 0.5, 0.78, 0.3, false, hooks);
    hooks.screen!.material = screenMat('web', PAL.teal);
    put(g, cyl(0.06, 0.05, 0.04, 12), mat(PAL.mustard, { metal: 0.6, rough: 0.3 }), w / 2 + 0.6, 0.83, 0.65);
    foliage(g, w / 2 + 0.9, 0.83, 0.3, 0.1, PAL.leaf, 7, 4);
  },
  bench: (g, w) => {
    block(g, w - 0.2, 0.06, 0.45, PAL.oak, w / 2, SEAT_H - 0.06, 0.5, 0.03);
    block(g, w - 0.2, 0.3, 0.05, PAL.oak, w / 2, SEAT_H + 0.02, 0.27, 0.03);
    for (const x of [0.2, w - 0.2]) block(g, 0.05, SEAT_H - 0.06, 0.4, PAL.charcoal, x, 0, 0.5, 0.015);
  },
};

export function arcadeScreen(frame: number): THREE.Material {
  return texMat(`arcade:${frame}`, 64, 54, (c, w, h) => {
    c.fillStyle = '#120d2a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffe294';
    for (let i = 0; i < 10; i++) c.fillRect(6 + i * 5, 9 + ((i + frame) % 3) * 4, 3, 3);
    c.fillStyle = '#55eee3';
    if (frame) c.fillRect(16 + frame * 4, 36 - ((frame * 4) % 22), 2, 4);
    c.fillStyle = '#ec86ba';
    c.fillRect(8 + (frame ? (frame * 7) % 38 : 20), 40, 10, 5);
  }, frame ? 1.1 : 0.42);
}

function counterBase(g: THREE.Group, drawers: boolean): void {
  block(g, 1.0, 0.6, 0.62, '#b76950', 0.5, 0, 0.4, 0.025);
  block(g, 1.02, 0.04, 0.68, '#e7d2b6', 0.5, 0.6, 0.4, 0.012);
  if (drawers) for (let i = 0; i < 3; i++) block(g, 0.12, 0.02, 0.02, PAL.greyDark, 0.5, 0.15 + i * 0.16, 0.72, 0.008);
  else block(g, 0.02, 0.4, 0.02, PAL.grey, 0.5, 0.1, 0.72, 0.005);
}

function deskModel(g: THREE.Group, ctx: FurnitureCtx, hooks: FurnitureHooks, faceSouth: boolean): void {
  const top = DESK_TOPS[ctx.variant ?? ctx.theme?.deskVariant ?? 'wood'] ?? PAL.oak;
  const legs = mat(ctx.variant === 'white' ? PAL.greyDark : PAL.charcoal, { metal: 0.4, rough: 0.45 });
  if (!place(g, 'craftedDesk', { w: 1.91, h: WORKTOP, d: 0.98 }, 1, 0, 0.5, faceSouth ? 0 : Math.PI)) {
    block(g, 1.9, 0.05, 0.98, top, 1, WORKTOP - 0.05, 0.5, 0.022);
    for (const x of [0.12, 1.88]) {
      block(g, 0.05, WORKTOP - 0.05, 0.05, legs, x, 0, 0.14, 0.01);
      block(g, 0.05, WORKTOP - 0.05, 0.05, legs, x, 0, 0.86, 0.01);
    }
    block(g, 1.7, 0.15, 0.02, top, 1, WORKTOP - 0.22, faceSouth ? 0.12 : 0.88, 0.005);
  }
  const zBack = faceSouth ? 0.34 : 0.66;
  const zFront = faceSouth ? 0.925 : 0.075;
  const pad = pick(['#9eb3a3', '#9dabbe', '#c3a188', '#b7a5ba'], ctx.seed);
  block(g, 0.57, 0.007, 0.17, pad, 1 + (faceSouth ? -0.065 : 0.065), WORKTOP - 0.001,
    faceSouth ? 0.905 : 0.095, 0.003).castShadow = false;
  monitor(g, 1, WORKTOP, zBack, faceSouth, hooks);
  keyboard(g, 1, WORKTOP, zFront, faceSouth ? 0 : Math.PI);
  const rnd = mulberry(ctx.seed);
  const left = faceSouth ? 0.42 : 1.58;
  const right = 2 - left;
  hooks.cup = mug(g, right, WORKTOP, faceSouth ? 0.72 : 0.28, PAL.cream);
  hooks.cup.userData.dynamic = true;
  if (rnd() < 0.27) place(g, 'craftedLaptop', { w: 0.39 }, left, WORKTOP, 0.56, faceSouth ? -0.21 : Math.PI - 0.21);
  else if (!place(g, 'craftedNotebook', { w: 0.31 }, left, WORKTOP, 0.52, (rnd() - 0.5) * 0.5)) {
    block(g, 0.26, 0.015, 0.23, PAL.paper, left, WORKTOP, 0.52, 0.004);
  }
  if (rnd() < 0.42) place(g, 'craftedPlant', { h: 0.235 }, right, WORKTOP, zBack, ctx.seed % 7);
  else place(g, 'craftedClock', { h: 0.14 }, right, WORKTOP, zBack, faceSouth ? 0.1 : Math.PI + 0.1);
  if (rnd() < 0.30) place(g, 'craftedTower', { h: 0.36 }, faceSouth ? 1.62 : 0.38, 0, 0.5, faceSouth ? 0 : Math.PI);
}

// ------------------------------------------------------------------ itens de parede

const WALL: Partial<Record<FurnitureKind, Builder>> = {
  whiteboard: (g, w, _h, ctx) => {
    block(g, w - 0.3, 0.95, 0.04, PAL.metal, 0, 0.75, 0.02, 0.015);
    block(g, w - 0.38, 0.87, 0.02, PAL.paper, 0, 0.79, 0.045, 0.005);
    const rnd = mulberry(ctx.seed);
    const cols = [PAL.mustard, PAL.pink, PAL.sage, PAL.blueSoft];
    for (let c = 0; c < 3; c++) {
      block(g, 0.008, 0.78, 0.01, PAL.grey, -0.8 + (c + 1) * 0.55 - 0.27, 0.83, 0.055, 0.002);
      for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) block(g, 0.14, 0.12, 0.012, cols[Math.floor(rnd() * 4)]!, -1 + c * 0.55 + 0.2 + (i % 2) * 0.17, 1.4 - Math.floor(i / 2) * 0.17, 0.06, 0.004);
    }
    block(g, w - 0.5, 0.03, 0.08, PAL.grey, 0, 0.72, 0.06, 0.01);
  },
  window: (g, w, _h, ctx) => {
    const frame = mat('#e6c59e', { rough: 0.67 });
    const view = texMat('window:cozy-garden', 192, 88, (c, cw, ch) => {
      const sky = c.createLinearGradient(0, 0, 0, ch);
      sky.addColorStop(0, '#acd4df');
      sky.addColorStop(1, '#f9ecd5');
      c.fillStyle = sky;
      c.fillRect(0, 0, cw, ch);
      c.fillStyle = '#fff1d9';
      c.beginPath();
      c.arc(149, 28, 12, 0, Math.PI * 2);
      c.fill();
      for (const [color, x, y, rx] of [
        ['#a9c8ab', 28, 88, 73], ['#a7c1ab', 156, 99, 77], ['#86a99a', 83, 107, 67],
      ] as const) {
        c.fillStyle = color;
        c.beginPath();
        c.ellipse(x, y, rx, 39, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = 'rgba(255,250,235,0.20)';
      c.beginPath();
      c.moveTo(21, 0); c.lineTo(48, 0); c.lineTo(3, ch); c.lineTo(0, ch); c.lineTo(0, 46);
      c.fill();
    }, 0.07);
    block(g, w - 0.2, 1.05, 0.08, frame, 0, 0.6, 0.0, 0.034);
    put(g, plane(w - 0.34, 0.9), view, 0, 0.675, 0.045, { shadow: false });
    block(g, 0.04, 0.9, 0.03, frame, 0, 0.675, 0.05, 0.005);
    block(g, w - 0.1, 0.06, 0.22, frame, 0, 0.57, 0.09, 0.022);
    if (ctx.seed % 3 === 0) {
      place(g, 'craftedPlant', { h: 0.24, d: 0.15 }, (w - 0.56) / 2, 0.63, 0.115, ctx.seed % 7);
    }
  },
  clock: (g, _w, _h, _ctx, hooks) => {
    const c = put(g, cyl(0.17, 0.17, 0.04, 24), mat(PAL.white), 0, 1.35, 0.02, { rx: Math.PI / 2 });
    c.position.y = 1.55;
    const ring = put(g, cyl(0.185, 0.185, 0.035, 24), mat(PAL.charcoal), 0, 1.35, 0.005, { rx: Math.PI / 2 });
    ring.position.y = 1.55;
    const hand = (len: number, wdt: number) => {
      const p = new THREE.Group();
      p.userData.dynamic = true;
      p.position.set(0, 1.55, 0.045);
      block(p, wdt, len, 0.008, PAL.charcoal, 0, 0, 0, 0.002);
      g.add(p);
      return p;
    };
    hooks.clockHands = [hand(0.09, 0.02), hand(0.14, 0.012)];
  },
  poster: (g, _w, _h, ctx) => {
    const v = ctx.variant ?? pick(['code', 'coffee', 'rocket', 'cat', 'bug', 'ship_it'], ctx.seed);
    const m = texMat(`poster:${v}`, 64, 88, (c, w, h) => drawPoster(c, w, h, v));
    block(g, 0.5, 0.68, 0.02, PAL.charcoal, 0, 0.95, 0.01, 0.005);
    put(g, plane(0.46, 0.64), m, 0, 0.97, 0.022, { shadow: false });
  },
  painting: (g, w, _h, ctx) => {
    block(g, w - 0.6, 0.78, 0.04, PAL.woodDark, 0, 0.85, 0.02, 0.01);
    const m = texMat(`painting:${ctx.seed % 6}`, 96, 72, (c, cw, ch) => {
      const rnd = mulberry(ctx.seed % 6 + 11);
      const sky = pick(['#f3d9b1', '#cfe3ef', '#e9d3e6', '#d9ead3'], ctx.seed);
      c.fillStyle = sky;
      c.fillRect(0, 0, cw, ch);
      for (let i = 0; i < 4; i++) {
        c.fillStyle = pick([PAL.sage, PAL.teal, PAL.terracotta, PAL.mustard, PAL.navy], ctx.seed + i);
        c.beginPath();
        c.moveTo(0, ch * (0.55 + i * 0.1));
        for (let x = 0; x <= cw; x += 12) c.lineTo(x, ch * (0.5 + i * 0.12) - rnd() * 14);
        c.lineTo(cw, ch);
        c.lineTo(0, ch);
        c.fill();
      }
      c.fillStyle = '#fff6d8';
      c.beginPath();
      c.arc(cw * 0.75, ch * 0.28, 9, 0, Math.PI * 2);
      c.fill();
    });
    put(g, plane(w - 0.7, 0.68), m, 0, 0.9, 0.042, { shadow: false });
  },
  tv: (g, w, _h, _ctx, hooks) => {
    block(g, w - 0.2, 0.95, 0.06, PAL.black, 0, 0.7, 0.03, 0.02);
    const screen = put(g, plane(w - 0.3, 0.86), tvScreen(1), 0, 0.745, 0.062, { shadow: false });
    screen.userData.dynamic = true;
    hooks.use = { kind: 'tv', part: screen };
  },
  light_switch: (g, _w, _h, _ctx, hooks) => {
    const plate = block(g, 0.1, 0.14, 0.02, PAL.white, 0, 0.75, 0.01, 0.01);
    plate.userData.dynamic = true;
    hooks.use = { kind: 'switch', part: plate };
  },
  elevator: (g, w, _h, _ctx, hooks) => {
    const steel = mat('#9aa3ad', { metal: 0.7, rough: 0.32 });
    const dark = mat('#4a5059', { metal: 0.6, rough: 0.4 });
    // moldura (batentes e verga) saliente da parede
    block(g, 0.16, 1.86, 0.14, steel, -0.76, 0, 0.0, 0.03);
    block(g, 0.16, 1.86, 0.14, steel, 0.76, 0, 0.0, 0.03);
    block(g, 1.68, 0.2, 0.14, steel, 0, 1.72, 0.0, 0.03);
    // soleira
    block(g, 1.4, 0.02, 0.16, dark, 0, 0, 0.06, 0.005);
    // cabine iluminada (pintada: profundidade sem atravessar a parede), vista quando as portas abrem
    put(g, plane(1.36, 1.66), texMat('elevator:cab', 128, 160, (c, cw, ch) => {
      const gr = c.createLinearGradient(0, 0, 0, ch);
      gr.addColorStop(0, '#fff3dc');
      gr.addColorStop(1, '#c9a77c');
      c.fillStyle = gr;
      c.fillRect(0, 0, cw, ch);
      // painéis de madeira, corrimão, espelho e piso em perspectiva
      c.fillStyle = 'rgba(120,80,45,0.35)';
      for (let x = 18; x < cw; x += 30) c.fillRect(x, 26, 2, ch - 60);
      c.fillStyle = 'rgba(210,235,245,0.75)';
      c.fillRect(34, 30, cw - 68, 56);
      c.fillStyle = '#b8bfc6';
      c.fillRect(10, 98, cw - 20, 5);
      c.fillStyle = '#6d5a48';
      c.beginPath();
      c.moveTo(0, ch);
      c.lineTo(22, ch - 34);
      c.lineTo(cw - 22, ch - 34);
      c.lineTo(cw, ch);
      c.fill();
      c.fillStyle = 'rgba(255,240,200,0.9)';
      c.fillRect(20, 6, cw - 40, 8);
    }, 1.0), 0, 0.84, 0.015, { shadow: false });
    // portas de aço escovado com friso
    const doorTex = texMat('elevator:door', 64, 160, (c, cw, ch) => {
      const gr = c.createLinearGradient(0, 0, cw, 0);
      gr.addColorStop(0, '#aab2bb');
      gr.addColorStop(0.45, '#d9dee3');
      gr.addColorStop(1, '#9ea6af');
      c.fillStyle = gr;
      c.fillRect(0, 0, cw, ch);
      c.fillStyle = 'rgba(255,255,255,0.08)';
      for (let y = 0; y < ch; y += 3) c.fillRect(0, y, cw, 1);
      c.fillStyle = 'rgba(60,66,74,0.5)';
      c.fillRect(0, ch * 0.55, cw, 2);
    }, 0.55);
    const l = new THREE.Group();
    const r = new THREE.Group();
    put(l, plane(0.68, 1.66), doorTex, 0, 0.83, 0, { shadow: false });
    put(r, plane(0.68, 1.66), doorTex, 0, 0.83, 0, { shadow: false });
    block(l, 0.68, 1.66, 0.02, steel, 0, 0, -0.012, 0.004);
    block(r, 0.68, 1.66, 0.02, steel, 0, 0, -0.012, 0.004);
    l.userData.dynamic = r.userData.dynamic = true;
    l.position.set(-0.34, 0.01, 0.05);
    r.position.set(0.34, 0.01, 0.05);
    g.add(l, r);
    // mostrador do andar sobre a porta e botoeira ao lado
    put(g, plane(0.42, 0.13), texMat('elevator:display', 84, 26, (c, cw, ch) => {
      c.fillStyle = '#12151c';
      c.fillRect(0, 0, cw, ch);
      c.fillStyle = '#ffb340';
      c.beginPath();
      c.moveTo(18, 6);
      c.lineTo(26, 19);
      c.lineTo(10, 19);
      c.fill();
      c.font = 'bold 18px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('T', 54, 14);
    }, 1.6), 0, 1.82, 0.075, { shadow: false });
    block(g, 0.13, 0.3, 0.03, dark, 0.98, 0.82, 0.02, 0.012);
    put(g, sphere(0.03, 12), mat('#ffc66b', { emissive: '#ffb340', emissiveIntensity: 1.6 }), 0.98, 1.02, 0.055, { shadow: false });
    put(g, sphere(0.03, 12), mat('#dfe5ea', { metal: 0.6, rough: 0.3 }), 0.98, 0.9, 0.055, { shadow: false });
    hooks.doors = [l, r];
  },
  door_frame: (g, w) => {
    const f = mat(PAL.woodDark);
    block(g, 0.08, 1.7, 0.12, f, -w / 2 + 0.04, 0, 0, 0.01);
    block(g, 0.08, 1.7, 0.12, f, w / 2 - 0.04, 0, 0, 0.01);
    block(g, w, 0.08, 0.12, f, 0, 1.7, 0, 0.01);
  },
  sign: () => {
    // a placa com o nome da sala é desenhada pelo mundo (texto vivo), ver building.ts
  },
  mirror: (g) => {
    block(g, 0.6, 0.62, 0.03, PAL.metal, 0, 0.95, 0.01, 0.02);
    put(g, plane(0.54, 0.56), mat('#dbe9f2', { metal: 0.9, rough: 0.05 }), 0, 0.98, 0.028, { shadow: false });
  },
  shelf_wall: (g, w, _h, ctx) => {
    block(g, w - 0.2, 0.04, 0.22, PAL.oak, 0, 1.25, 0.11, 0.01);
    books(g, -0.7, 1.29, 0.12, 0.6, ctx.seed, 0.16);
    put(g, cyl(0.05, 0.04, 0.12, 10), mat(PAL.terracotta), 0.35, 1.29, 0.11);
    foliage(g, 0.35, 1.4, 0.11, 0.07, PAL.leaf, ctx.seed, 3);
    put(g, cyl(0.04, 0.035, 0.09, 10), mat(PAL.cream), 0.65, 1.29, 0.11);
  },
};

function drawPoster(c: CanvasRenderingContext2D, w: number, h: number, v: string): void {
  const bg: Record<string, string> = { code: '#2b3a55', coffee: '#e9d3b4', rocket: '#1f2a44', cat: '#f2c6c2', bug: '#cfe3c2', ship_it: '#f6c445' };
  c.fillStyle = bg[v] ?? '#ddd';
  c.fillRect(0, 0, w, h);
  c.fillStyle = v === 'coffee' || v === 'cat' || v === 'bug' || v === 'ship_it' ? '#2b2b2b' : '#ffffff';
  c.font = 'bold 11px sans-serif';
  c.textAlign = 'center';
  const label: Record<string, string> = { code: '</>', coffee: 'COFFEE', rocket: 'LAUNCH', cat: 'MEOW', bug: 'NO BUGS', ship_it: 'SHIP IT' };
  c.fillText(label[v] ?? '', w / 2, h - 12);
  c.beginPath();
  if (v === 'rocket') {
    c.fillStyle = '#e8894a';
    c.moveTo(w / 2, 14);
    c.lineTo(w / 2 + 12, 50);
    c.lineTo(w / 2 - 12, 50);
    c.fill();
  } else if (v === 'coffee') {
    c.fillStyle = '#7a5236';
    c.fillRect(w / 2 - 14, 22, 28, 30);
  } else {
    c.arc(w / 2, 36, 16, 0, Math.PI * 2);
    c.fillStyle = v === 'code' ? '#6f94c4' : v === 'cat' ? '#7a5236' : v === 'bug' ? '#5f9a5c' : '#c9524b';
    c.fill();
  }
}

/** Monta o móvel de chão; origem no canto noroeste do footprint. */
export function buildFloorFurniture(kind: FurnitureKind, w: number, h: number, ctx: FurnitureCtx): { obj: THREE.Group; hooks: FurnitureHooks } {
  const g = new THREE.Group();
  const hooks: FurnitureHooks = {};
  const b = FLOOR[kind];
  if (b) b(g, w, h, ctx, hooks);
  else block(g, w - 0.2, 0.5, h - 0.2, PAL.grey, w / 2, 0, h / 2);
  if (kind === 'plant_small' || kind === 'plant_tall') {
    const pivot = new THREE.Group();
    pivot.position.set(0.5, 0, 0.5);
    pivot.userData.dynamic = true;
    for (const c of [...g.children]) { c.position.x -= 0.5; c.position.z -= 0.5; pivot.add(c); }
    g.add(pivot);
    hooks.sway = pivot;
  }
  return { obj: g, hooks };
}

/** Monta o item de parede; origem no centro da base, na face da parede, virado para +z. */
export function buildWallItem(kind: FurnitureKind, w: number, ctx: FurnitureCtx): { obj: THREE.Group; hooks: FurnitureHooks } {
  const g = new THREE.Group();
  const hooks: FurnitureHooks = {};
  const b = WALL[kind];
  if (b) b(g, w, 0, ctx, hooks);
  return { obj: g, hooks };
}

/** Placa com o nome da sala (texto vivo, refeito quando o nome muda). */
export function signMesh(text: string, accent: string): THREE.Mesh {
  const tex = canvasTex(`sign:${text}:${accent}`, 256, 64, (c, w, h) => {
    c.fillStyle = '#fbf8f2';
    c.beginPath();
    c.roundRect(0, 0, w, h, 14);
    c.fill();
    c.fillStyle = accent;
    c.fillRect(0, 0, 12, h);
    c.fillStyle = '#2d3138';
    c.font = '600 28px Inter, system-ui, sans-serif';
    c.textBaseline = 'middle';
    let t = text;
    while (c.measureText(t).width > w - 40 && t.length > 3) t = t.slice(0, -2);
    if (t !== text) t += '…';
    c.fillText(t, 26, h / 2 + 1);
  });
  const m = new THREE.Mesh(plane(1.6, 0.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  m.receiveShadow = true;
  return m;
}
