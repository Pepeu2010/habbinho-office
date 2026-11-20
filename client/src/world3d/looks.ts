// Aparência 3D escolhida no editor: modelo-base e cores das regiões do atlas, por personagem. Fica no navegador
// (localStorage), indexada pela semente do personagem — a mesma que o servidor guarda para o agente de cada projeto
// (server/model: setCharacter), então a escolha sobrevive a novas sessões do mesmo projeto.
//
// Os modelos Gobkit pintam a malha com um atlas de paleta (512x2048, células de 32x128 com um degradê vertical).
// Recolorir uma região = repintar a célula do atlas usada por ela, numa cópia do atlas só deste personagem.
import * as THREE from 'three';
import type { AgentInfo } from '../../../shared/types';
import type { LoadedModel } from './assets';

const KEY = 'habblaud.3d.looks.v1';
const CELL_W = 32;
const CELL_H = 128;
const COLS = 16;

export interface Look {
  /** Assinatura (muda quando qualquer escolha muda). */
  key: string;
  model?: string;
  /** Cor nova por célula do atlas (índice = linha * 16 + coluna). */
  colors: Record<number, string>;
}

interface Stored {
  model?: string;
  colors?: Record<string, string>;
}

const DEFAULT: Look = { key: 'default', colors: {} };

export class LookStore {
  private data: Record<string, Stored> = {};
  private cache = new Map<string, Look>();
  private listeners = new Set<() => void>();

  constructor(private storage: Storage | null = safeStorage()) {
    try {
      const raw = this.storage?.getItem(KEY);
      if (raw) this.data = sanitize(JSON.parse(raw));
    } catch {
      this.data = {};
    }
  }

  static idOf(info: Pick<AgentInfo, 'seed'>): string {
    return `seed:${info.seed}`;
  }

  get(_id: string, info: Pick<AgentInfo, 'seed'>): Look {
    const k = LookStore.idOf(info);
    let l = this.cache.get(k);
    if (!l) {
      const s = this.data[k];
      if (!s) l = DEFAULT;
      else {
        const colors: Record<number, string> = {};
        for (const [i, c] of Object.entries(s.colors ?? {})) colors[Number(i)] = c;
        l = { key: JSON.stringify(s), model: s.model, colors };
      }
      this.cache.set(k, l);
    }
    return l;
  }

  set(info: Pick<AgentInfo, 'seed'>, look: { model?: string; colors: Record<number, string> } | null): void {
    const k = LookStore.idOf(info);
    if (!look) delete this.data[k];
    else this.data[k] = { model: look.model, colors: Object.fromEntries(Object.entries(look.colors).map(([i, c]) => [String(i), c])) };
    this.cache.delete(k);
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // armazenamento cheio ou bloqueado: a escolha vale só nesta página
    }
    this.listeners.forEach((cb) => cb());
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const HEX = /^#[0-9a-f]{6}$/i;
const MODEL_ID = /^[a-z_]{1,32}$/;

/** Validação do que veio do armazenamento (pode ter sido editado à mão). */
export function sanitize(raw: unknown): Record<string, Stored> {
  const out: Record<string, Stored> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^seed:-?\d{1,12}$/.test(k) || !v || typeof v !== 'object') continue;
    const s = v as Stored;
    const st: Stored = {};
    if (typeof s.model === 'string' && MODEL_ID.test(s.model)) st.model = s.model;
    if (s.colors && typeof s.colors === 'object') {
      const colors: Record<string, string> = {};
      for (const [i, c] of Object.entries(s.colors)) if (/^\d{1,3}$/.test(i) && Number(i) < 256 && typeof c === 'string' && HEX.test(c)) colors[i] = c.toLowerCase();
      st.colors = colors;
    }
    out[k] = st;
  }
  return out;
}

// ------------------------------------------------------------------ atlas

export interface AtlasRegion {
  cell: number;
  /** Cor média original da célula. */
  color: string;
  /** Altura média (0 = pés, 1 = topo da cabeça) dos vértices que usam a célula. */
  height: number;
  /** Fração dos vértices da malha. */
  weight: number;
}

/** Células do atlas usadas pela malha, da cabeça para os pés (para o editor listar as regiões). */
export function atlasRegions(model: LoadedModel): AtlasRegion[] {
  const img = model.atlas?.image as CanvasImageSource | undefined;
  const sums = new Map<number, { n: number; y: number }>();
  let minY = Infinity;
  let maxY = -Infinity;
  let total = 0;
  model.scene.updateMatrixWorld(true);
  model.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const uv = m.geometry.attributes.uv as THREE.BufferAttribute | undefined;
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    if (!uv) return;
    const v = new THREE.Vector3();
    for (let i = 0; i < uv.count; i++) {
      const cell = cellOf(uv.getX(i), uv.getY(i));
      if (m.isSkinnedMesh) m.getVertexPosition(i, v);
      else v.fromBufferAttribute(pos, i);
      v.applyMatrix4(m.matrixWorld);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
      const s = sums.get(cell) ?? { n: 0, y: 0 };
      s.n++;
      s.y += v.y;
      sums.set(cell, s);
      total++;
    }
  });
  const ctx = img ? sampleCtx(img) : null;
  const out: AtlasRegion[] = [];
  for (const [cell, s] of sums) {
    const color = ctx ? cellColor(ctx, cell) : '#888888';
    out.push({ cell, color, height: (s.y / s.n - minY) / Math.max(1e-6, maxY - minY), weight: s.n / Math.max(1, total) });
  }
  return out.filter((r) => r.weight > 0.01).sort((a, b) => b.height - a.height);
}

function cellOf(u: number, v: number): number {
  const col = Math.min(COLS - 1, Math.max(0, Math.floor((u - Math.floor(u)) * COLS)));
  const row = Math.min(15, Math.max(0, Math.floor((v - Math.floor(v)) * 16)));
  return row * COLS + col;
}

const sampleCache = new WeakMap<object, CanvasRenderingContext2D>();
function sampleCtx(img: CanvasImageSource): CanvasRenderingContext2D {
  let ctx = sampleCache.get(img as object);
  if (!ctx) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 2048;
    ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 512, 2048);
    sampleCache.set(img as object, ctx);
  }
  return ctx;
}

function cellColor(ctx: CanvasRenderingContext2D, cell: number): string {
  const x = (cell % COLS) * CELL_W + CELL_W / 2;
  const y = Math.floor(cell / COLS) * CELL_H + CELL_H / 2;
  const d = ctx.getImageData(x, y, 1, 1).data;
  return '#' + [d[0]!, d[1]!, d[2]!].map((n) => n.toString(16).padStart(2, '0')).join('');
}

const recolorCache = new Map<string, THREE.Texture>();

/** Aplica a aparência aos materiais do avatar (atlas recolorido; sem cores = atlas original). */
export function applyLook(materials: THREE.MeshStandardMaterial[], model: LoadedModel, look: Look): void {
  const base = model.atlas;
  if (!base) return;
  const cells = Object.keys(look.colors);
  let tex: THREE.Texture = base;
  if (cells.length) {
    const key = `${model.def.id}|${look.key}`;
    let t = recolorCache.get(key);
    if (!t) {
      const src = sampleCtx(base.image as CanvasImageSource);
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 2048;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(src.canvas, 0, 0);
      for (const [i, color] of Object.entries(look.colors)) paintCell(ctx, Number(i), color);
      t = new THREE.CanvasTexture(c);
      t.flipY = base.flipY;
      t.colorSpace = base.colorSpace;
      t.magFilter = base.magFilter;
      t.minFilter = base.minFilter;
      t.wrapS = base.wrapS;
      t.wrapT = base.wrapT;
      recolorCache.set(key, t);
    }
    tex = t;
  }
  for (const m of materials) {
    m.map = tex;
    m.needsUpdate = true;
  }
}

/** Repinta uma célula mantendo o degradê vertical do estilo (claro em cima, escuro embaixo). */
function paintCell(ctx: CanvasRenderingContext2D, cell: number, hex: string): void {
  const x = (cell % COLS) * CELL_W;
  const y = Math.floor(cell / COLS) * CELL_H;
  const c = new THREE.Color(hex);
  const hi = c.clone().lerp(new THREE.Color('#ffffff'), 0.18);
  const lo = c.clone().multiplyScalar(0.62);
  const g = ctx.createLinearGradient(0, y, 0, y + CELL_H);
  g.addColorStop(0, '#' + hi.getHexString());
  g.addColorStop(0.5, '#' + c.getHexString());
  g.addColorStop(1, '#' + lo.getHexString());
  ctx.fillStyle = g;
  ctx.fillRect(x, y, CELL_W, CELL_H);
}
