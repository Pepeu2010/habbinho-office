// O prédio em 3D, montado a partir do MESMO layout que a simulação usa (client/src/world/layout): pisos, paredes,
// móveis, itens de parede e a área externa. Nada aqui decide caminhos ou regras: só transforma o layout em malhas.
//
// Convenções do layout 2D (tiles; ver world/layout/types.ts): a face da parede norte ocupa as 2 primeiras linhas da
// área e tem a base na linha 2; a parede sul ocupa 1 linha; os "caps" são as paredes laterais (0,5 tile). Em 3D a
// parede norte vira uma placa fina encostada na linha 2, a sul fica no meio da sua linha, e as 2 linhas da face das
// salas do lado sul viram um alargamento do corredor.
import * as THREE from 'three';
import { FURNITURE, type FloorKind, type RoomTheme, type WallStyle } from '../art/api';
import { tr } from '../../../shared/i18n';
import { COL_W, CORE_COLS, CORRIDOR_Y, SOUTH_Y, TILE } from '../world/constants';
import { layoutExterior, slotShell, type SlotShell } from '../world/layout/exterior';
import { slotAt } from '../world/layout/geometry';
import type { AreaLayout, ExteriorProp, FloorPatch, WallSegment } from '../world/layout/types';
import type { RoomState } from '../world/sim/room-state';
import type { Sim } from '../world/sim/sim';
import { buildFloorFurniture, buildWallItem, signMesh, type FurnitureHooks } from './furniture';
import { PAL, block, canvasTex, cyl, mat, put, rbox, sphere } from './kit';
import type { NatureKit } from './assets';

export const WALL_H = 2.05;
export const WALL_LOW = 0.22;
const WALL_T = 0.36;
const DOOR_H = 1.62;

const CORE_NAMES: Readonly<Record<string, string>> = {
  'core:recepcao': tr('Recepção'),
  'core:banheiros': tr('Banheiros'),
  'core:copa': tr('Copa'),
  'core:lounge': tr('Lounge'),
};

/** Parede com recorte: abaixa quando fica entre a câmera e a sala. */
interface WallPiece {
  obj: THREE.Object3D;
  /** Normal para FORA da área (no plano xz). */
  nx: number;
  nz: number;
  low: boolean;
  h: number;
}

interface AreaView {
  id: string;
  group: THREE.Group;
  key: string;
  walls: WallPiece[];
  hooks: Map<string, FurnitureHooks>;
  room: RoomState | null;
  elevators: FurnitureHooks[];
  clocks: FurnitureHooks[];
  light: THREE.PointLight | null;
}

const px = (v: number) => v / TILE;

export class Building3D {
  readonly root = new THREE.Group();
  private areas = new Map<string, AreaView>();
  private exterior = new THREE.Group();
  private exteriorCols = -1;
  /** Telas das mesas, por id do móvel (a simulação diz quem está sentado em qual mesa). */
  readonly screens = new Map<string, THREE.Mesh>();
  private camDir = new THREE.Vector2(0, 1);

  constructor(private nature: NatureKit | null) {
    this.root.add(this.exterior);
  }

  setNature(n: NatureKit): void {
    this.nature = n;
    this.exteriorCols = -1;
  }

  /** Recria o que mudou no layout (salas novas, mudadas, desmontadas; prédio mais largo). */
  sync(sim: Sim): void {
    const cols = sim.building.cols;
    if (cols !== this.exteriorCols) {
      this.exteriorCols = cols;
      this.buildExterior(cols);
    }
    const wanted = new Map<string, { layout: AreaLayout; room: RoomState | null; key: string; shell?: SlotShell }>();
    for (const a of sim.building.core) wanted.set(a.id, { layout: a, room: null, key: 'core' });
    const corr = sim.building.corridor;
    wanted.set(corr.id, { layout: corr, room: null, key: `corr:${cols}` });
    const usedSlots = new Set<number>();
    for (const r of sim.rooms.values()) {
      if (!r.present) continue;
      if (!r.ghost) usedSlots.add(r.slot);
      wanted.set(r.id, { layout: r.layout, room: r, key: `room:${r.layout.rect.x},${r.layout.rect.y}:${r.version}:${r.info.name}:${r.seed}` });
    }
    // vagas sem sala: fechamento do corredor e pátio (como no 2D)
    for (let col = CORE_COLS; col < cols; col++) {
      for (const side of ['north', 'south'] as const) {
        const slot = slotAt(col, side);
        const occupied = [...sim.rooms.values()].some((r) => r.present && r.layout.rect.x === col * COL_W && r.layout.rect.y === (side === 'north' ? 0 : SOUTH_Y));
        if (occupied) continue;
        const sh = slotShell(slot, col === cols - 1);
        wanted.set(`shell:${slot}`, { layout: { id: `shell:${slot}`, kind: 'room', rect: sh.rect, floors: sh.floors, rugs: [], walls: sh.walls, wallItems: sh.windows, furniture: [], spots: [], walkable: [] }, room: null, key: `shell:${slot}:${col === cols - 1}`, shell: sh });
      }
    }
    for (const [id, v] of this.areas) {
      const w = wanted.get(id);
      if (!w || w.key !== v.key) {
        this.disposeArea(v);
        this.areas.delete(id);
      }
    }
    for (const [id, w] of wanted) {
      const cur = this.areas.get(id);
      if (cur) {
        cur.room = w.room;
        continue;
      }
      const view = this.buildArea(w.layout, w.room, w.key, w.shell);
      this.areas.set(id, view);
      this.root.add(view.group);
    }
  }

  /** Recorte das paredes, animações de construção, portas do elevador, relógios e luz das salas. */
  update(sim: Sim, now: number, camera: THREE.Camera, target: THREE.Vector3, night: number, dt: number): void {
    this.camDir.set(camera.position.x - target.x, camera.position.z - target.z);
    if (this.camDir.lengthSq() > 1e-6) this.camDir.normalize();
    const pitch = Math.atan2(camera.position.y - target.y, Math.hypot(camera.position.x - target.x, camera.position.z - target.z));
    // olhando quase de cima, nenhuma parede atrapalha; de lado, só as que ficam na frente
    const cutAll = pitch < 0.25;
    const k = 1 - Math.exp(-dt * 10);
    const d = new Date(now);
    const hourA = ((d.getHours() % 12) + d.getMinutes() / 60) / 12;
    const minA = d.getMinutes() / 60;
    for (const v of this.areas.values()) {
      for (const w of v.walls) {
        const facing = w.nx * this.camDir.x + w.nz * this.camDir.y;
        const target = cutAll ? false : facing > 0.3;
        const goal = target ? WALL_LOW / w.h : 1;
        w.obj.scale.y += (goal - w.obj.scale.y) * k;
      }
      const r = v.room;
      if (r) {
        const p = r.progress(now);
        const s = r.phase === 'building' ? easeOutBack(p) : r.phase === 'dismantling' ? 1 - easeInCubic(p) : 1;
        v.group.scale.set(1, Math.max(0.001, s), 1);
        v.group.visible = s > 0.002;
      }
      if (v.light) {
        const lit = r ? r.lightOn : true;
        const goal = lit ? 16 * night : 0;
        v.light.intensity += (goal - v.light.intensity) * k;
        v.light.visible = v.light.intensity > 0.02;
      }
      for (const c of v.clocks) {
        if (!c.clockHands) continue;
        c.clockHands[0].rotation.z = -hourA * Math.PI * 2;
        c.clockHands[1].rotation.z = -minA * Math.PI * 2;
      }
      v.elevators.forEach((e, i) => {
        const el = sim.elevators[i];
        if (!e.doors) return;
        const open = el ? Math.min(1, el.door / 4) : 0;
        e.doors[0].position.x = -0.34 - open * 0.62;
        e.doors[1].position.x = 0.34 + open * 0.62;
      });
    }
  }

  /** Malhas das áreas (para clique em sala). */
  areaAt(x: number, z: number, sim: Sim): string | null {
    const tx = Math.floor(x);
    const ty = Math.floor(z);
    for (const r of sim.rooms.values()) {
      if (!r.present || r.ghost) continue;
      const rc = r.layout.rect;
      if (tx >= rc.x && ty >= rc.y && tx < rc.x + rc.w && ty < rc.y + rc.h) return r.id;
    }
    return null;
  }

  dispose(): void {
    for (const v of this.areas.values()) this.disposeArea(v);
    this.areas.clear();
  }

  // ================================================================= montagem

  private disposeArea(v: AreaView): void {
    this.root.remove(v.group);
    for (const id of v.hooks.keys()) this.screens.delete(id);
    v.group.traverse((o) => {
      // geometrias e materiais vêm do cache do kit (compartilhados): só as placas têm material próprio
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).userData.own) ((o as THREE.Mesh).material as THREE.Material).dispose();
    });
  }

  private buildArea(a: AreaLayout, room: RoomState | null, key: string, shell?: SlotShell): AreaView {
    const g = new THREE.Group();
    g.name = a.id;
    const view: AreaView = { id: a.id, group: g, key, walls: [], hooks: new Map(), room, elevators: [], clocks: [], light: null };
    const theme: RoomTheme | undefined = room?.theme;
    const isCorridor = a.kind === 'corridor';
    const top = a.rect.y;
    // ---- pisos
    for (const f of a.floors) {
      let y0 = px(f.y);
      let y1 = px(f.y + f.h);
      if (!isCorridor && !shell) y0 = Math.max(y0, top + 2 - WALL_T);
      if (isCorridor) y1 = Math.max(y1, SOUTH_Y + 2 - WALL_T);
      if (shell && top === SOUTH_Y) y0 = Math.max(y0, top);
      if (y1 <= y0) continue;
      g.add(floorMesh(f, px(f.x), y0, px(f.x + f.w), y1, theme));
    }
    if (shell) {
      // fechamento da vaga vazia: continuação do corredor até a face da parede
      if (top === SOUTH_Y) g.add(floorMesh({ kind: 'concrete', x: 0, y: 0, w: 0, h: 0, seed: 3 }, a.rect.x, top, a.rect.x + a.rect.w, top + 2 - WALL_T, undefined));
    }
    if (!isCorridor && !shell && top === SOUTH_Y) {
      // faixa da face norte das salas do lado sul: vira corredor (o 2D desenha a parede ali)
      g.add(floorMesh({ kind: 'concrete', x: 0, y: 0, w: 0, h: 0, seed: 5 }, a.rect.x, top, a.rect.x + a.rect.w, top + 2 - WALL_T, undefined));
    }
    for (const r of a.rugs) {
      const rug = put(g, rbox(px(r.w) - 0.1, 0.02, px(r.h) - 0.1, 0.01), mat(r.color, { rough: 1 }), px(r.x + r.w / 2), 0.004, px(r.y + r.h / 2));
      rug.castShadow = false;
    }
    // ---- paredes
    for (const w of a.walls) this.buildWall(g, view, w, a);
    // ---- móveis
    for (const f of a.furniture) {
      const def = FURNITURE[f.kind];
      if (def.mount !== 'floor') continue;
      const { obj, hooks } = buildFloorFurniture(f.kind, def.footprint.w, def.footprint.h, { theme, seed: hashStr(f.id), variant: f.variant });
      obj.position.set(f.tx + px(f.dx ?? 0), 0, f.ty + px(f.dy ?? 0));
      obj.userData.furnitureId = f.id;
      g.add(obj);
      if (hooks.screen) {
        view.hooks.set(f.id, hooks);
        this.screens.set(f.id, hooks.screen);
      }
    }
    for (const it of a.wallItems) {
      const def = FURNITURE[it.kind];
      const onSouth = it.on === 'south';
      if (it.kind === 'sign') {
        const name = room ? room.info.name : CORE_NAMES[a.id];
        if (!name) continue;
        const s = signMesh(name, room?.theme.accent ?? PAL.teal);
        s.userData.own = true;
        s.position.set(px(it.cx), 1.62, px(it.baseY) + 0.03);
        g.add(s);
        continue;
      }
      const { obj, hooks } = buildWallItem(it.kind, def.footprint.w, { theme, seed: hashStr(it.id), variant: it.variant });
      obj.position.set(px(it.cx), 0, onSouth ? px(it.baseY) - 1 + 0.5 - WALL_T / 2 : px(it.baseY));
      if (onSouth) obj.rotation.y = Math.PI;
      g.add(obj);
      if (hooks.doors) view.elevators.push(hooks);
      if (hooks.clockHands) view.clocks.push(hooks);
    }
    // ---- luz de teto (à noite)
    if (a.kind !== 'corridor' && !shell) {
      const l = new THREE.PointLight('#ffd9ae', 0, 18, 1.1);
      l.position.set(a.rect.x + a.rect.w / 2, WALL_H + 0.3, a.rect.y + 2 + (a.rect.h - 3) / 2);
      l.castShadow = false;
      g.add(l);
      view.light = l;
    }
    if (shell) for (const p of shell.props) this.buildProp(g, p);
    return view;
  }

  private buildWall(g: THREE.Group, view: AreaView, w: WallSegment, a: AreaLayout): void {
    const style: WallStyle = w.style;
    const x0 = px(w.x);
    if (w.kind === 'cap') {
      const z0 = Math.max(px(w.y), a.rect.y + 2 - WALL_T);
      const z1 = px(w.y + w.h);
      if (z1 - z0 < 0.05) return;
      const outward = x0 + px(w.w) / 2 < a.rect.x + a.rect.w / 2 ? -1 : 1;
      const piece = wallBox(style, px(w.w), z1 - z0, WALL_H);
      piece.position.set(x0 + px(w.w) / 2, 0, (z0 + z1) / 2);
      g.add(piece);
      view.walls.push({ obj: piece, nx: outward, nz: 0, low: false, h: WALL_H });
      return;
    }
    const isFace = w.kind === 'face';
    const zc = isFace ? px(w.y) + 2 - WALL_T / 2 : px(w.y) + 0.5;
    const nz = isFace ? -1 : 1;
    // trechos entre as portas
    const doors = [...(w.doorways ?? [])].sort((p, q) => p.x - q.x);
    let cur = x0;
    const end = x0 + px(w.w);
    const pieces: [number, number][] = [];
    for (const d of doors) {
      const dx0 = px(d.x);
      const dx1 = px(d.x + d.w);
      if (dx0 > cur) pieces.push([cur, dx0]);
      // verga sobre a porta
      const lintel = wallBox(style, dx1 - dx0, WALL_T, WALL_H - DOOR_H, true);
      lintel.position.set((dx0 + dx1) / 2, DOOR_H, zc);
      const holder = new THREE.Group();
      holder.add(lintel);
      g.add(holder);
      view.walls.push({ obj: holder, nx: 0, nz, low: false, h: WALL_H });
      cur = dx1;
    }
    if (end > cur) pieces.push([cur, end]);
    for (const [p0, p1] of pieces) {
      if (p1 - p0 < 0.02) continue;
      const piece = wallBox(style, p1 - p0, WALL_T, WALL_H);
      piece.position.set((p0 + p1) / 2, 0, zc);
      g.add(piece);
      view.walls.push({ obj: piece, nx: 0, nz, low: false, h: WALL_H });
    }
  }

  private buildExterior(cols: number): void {
    this.exterior.clear();
    const ext = layoutExterior(cols);
    const b = ext.bounds;
    // gramado de base (um pouco maior que a área desenhada, para a borda não aparecer)
    const grass = floorMesh({ kind: 'grass', x: 0, y: 0, w: 0, h: 0, seed: 1 }, b.x - 30, b.y - 30, b.x + b.w + 30, b.y + b.h + 30, undefined);
    grass.position.y = -0.03;
    this.exterior.add(grass);
    for (const f of ext.floors) {
      if (f.kind === 'grass') continue;
      const m = floorMesh(f, px(f.x), px(f.y), px(f.x + f.w), px(f.y + f.h), undefined);
      m.position.y = f.kind === 'street' ? -0.015 : -0.008;
      this.exterior.add(m);
    }
    // faixas da rua
    const dash = mat('#f4f1e6', { rough: 0.9 });
    for (let x = b.x; x < b.x + b.w; x += 3) {
      const m = put(this.exterior, rbox(1.4, 0.01, 0.12, 0.005), dash, x + 0.7, -0.012, px(ext.streetY));
      m.castShadow = false;
    }
    // base do prédio (laje sob as salas)
    const slab = put(this.exterior, rbox(cols * 16 + 0.4, 0.12, CORRIDOR_Y * 2 + 5 + 0.4, 0.04), mat('#d6d0c4', { rough: 0.9 }), cols * 8, -0.11, (CORRIDOR_Y * 2 + 5) / 2);
    slab.castShadow = false;
    for (const p of ext.props) this.buildProp(this.exterior, p);
  }

  private buildProp(g: THREE.Object3D, p: ExteriorProp): void {
    const x = px(p.x);
    const z = px(p.y);
    const rnd = mulberry(p.seed);
    const n = this.nature;
    switch (p.kind) {
      case 'tree':
      case 'pine': {
        const src = n ? (p.kind === 'pine' ? n.pick('TreeHigh', p.seed) ?? n.pick('TreeMed', p.seed) : n.pick(rnd() < 0.5 ? 'TreeMed' : 'TreeLow', p.seed)) : null;
        if (src) {
          const t = src.clone();
          t.position.set(x, 0, z);
          t.rotation.y = rnd() * Math.PI * 2;
          t.scale.multiplyScalar(2.6 + rnd() * 1.4);
          g.add(t);
        } else {
          put(g, cyl(0.12, 0.16, 1.2, 8), mat(PAL.woodDark), x, 0, z);
          put(g, sphere(1, 12), mat(PAL.leaf), x, 1.0, z);
        }
        break;
      }
      case 'bush':
      case 'hedge': {
        const src = n?.pick('Bush', p.seed);
        if (src) {
          const t = src.clone();
          t.position.set(x, 0, z);
          t.rotation.y = rnd() * Math.PI * 2;
          t.scale.multiplyScalar(p.kind === 'hedge' ? 1.4 : 0.9 + rnd() * 0.5);
          g.add(t);
        } else put(g, sphere(0.5, 10), mat(PAL.leafDark), x, 0, z);
        break;
      }
      case 'rock': {
        const src = n?.pick('Rock', p.seed);
        if (src) {
          const t = src.clone();
          t.position.set(x, 0, z);
          t.rotation.y = rnd() * 6;
          t.scale.multiplyScalar(0.5 + rnd() * 0.3);
          g.add(t);
        }
        break;
      }
      case 'flowers': {
        for (let i = 0; i < 6; i++) {
          const fx = x + (rnd() - 0.5) * 0.9;
          const fz = z + (rnd() - 0.5) * 0.5;
          put(g, cyl(0.008, 0.008, 0.18, 4), mat(PAL.leaf), fx, 0, fz, { shadow: false });
          put(g, sphere(0.05, 8), mat([PAL.pink, PAL.mustard, PAL.coral, PAL.lilac][i % 4]!), fx, 0.17, fz);
        }
        break;
      }
      case 'lamp': {
        put(g, cyl(0.04, 0.06, 2.2, 8), mat(PAL.charcoal, { metal: 0.5, rough: 0.4 }), x, 0, z);
        put(g, sphere(0.14, 12), mat('#fff2cf', { emissive: '#ffd27a', emissiveIntensity: 1.2 }), x, 2.15, z);
        break;
      }
      case 'bench': {
        block(g, 1.6, 0.06, 0.45, PAL.oak, x, 0.34, z);
        block(g, 1.6, 0.3, 0.05, PAL.oak, x, 0.42, z - 0.2);
        for (const dx of [-0.65, 0.65]) block(g, 0.06, 0.34, 0.4, PAL.charcoal, x + dx, 0, z);
        break;
      }
      case 'parasol': {
        put(g, cyl(0.025, 0.025, 1.7, 8), mat(PAL.white), x, 0, z);
        put(g, new THREE.ConeGeometry(0.9, 0.35, 12), mat(PAL.coral), x, 1.55, z);
        put(g, cyl(0.4, 0.4, 0.04, 16), mat(PAL.white), x, 0.55, z);
        put(g, cyl(0.03, 0.03, 0.55, 8), mat(PAL.white), x, 0, z);
        break;
      }
      case 'totem': {
        block(g, 0.5, 1.6, 0.2, PAL.charcoal, x, 0, z);
        block(g, 0.4, 0.4, 0.02, PAL.teal, x, 1.05, z + 0.11).material = mat(PAL.teal, { emissive: PAL.teal, emissiveIntensity: 0.6 });
        break;
      }
      case 'paving': {
        const m = put(g, rbox(0.9, 0.03, 0.9, 0.05), mat('#cbc3b5'), x, -0.005, z);
        m.castShadow = false;
        break;
      }
    }
  }
}

// ------------------------------------------------------------------ peças

function wallBox(style: WallStyle, w: number, d: number, h: number, noBase = false): THREE.Group {
  const g = new THREE.Group();
  const glass = style.pattern === 'glass';
  const base = glass ? mat(PAL.glass, { opacity: 0.32, rough: 0.08, metal: 0.1 }) : mat(style.exterior ? '#d8d0c3' : style.base, { rough: 0.92 });
  if (glass) {
    block(g, w, 0.3, d, PAL.white, 0, 0, 0, 0.02);
    block(g, w, h - 0.36, d * 0.3, base, 0, 0.3, 0, 0.005);
    block(g, w, 0.06, d, PAL.white, 0, h - 0.06, 0, 0.01);
    return g;
  }
  block(g, w, h, d, base, 0, 0, 0, 0.02);
  if (!noBase) {
    const trim = mat(style.trim ?? '#9b9184', { rough: 0.7 });
    if (style.pattern === 'wood_panel') block(g, w + 0.004, 0.75, d + 0.03, mat(PAL.oak, { rough: 0.7 }), 0, 0, 0, 0.01);
    else if (style.pattern === 'tiles') block(g, w + 0.004, 0.8, d + 0.02, mat('#e6eef2', { rough: 0.35 }), 0, 0, 0, 0.005);
    block(g, w + 0.01, 0.09, d + 0.04, trim, 0, 0, 0, 0.01);
  }
  return g;
}

const FLOOR_PERIOD: Partial<Record<FloorKind, number>> = { carpet: 2, wood: 2, tile_check: 2, tile_white: 1, concrete: 4, marble: 2, grass: 6, sidewalk: 1, street: 4 };

function floorTex(kind: FloorKind, tint?: string, tint2?: string): THREE.Texture {
  return canvasTex(`floor:${kind}:${tint ?? ''}:${tint2 ?? ''}`, 128, 128, (c, w, h) => {
    const rnd = mulberry(kind.length * 131);
    switch (kind) {
      case 'carpet': {
        c.fillStyle = tint ?? '#7d8fa8';
        c.fillRect(0, 0, w, h);
        c.globalAlpha = 0.08;
        for (let i = 0; i < 900; i++) {
          c.fillStyle = rnd() < 0.5 ? '#000' : '#fff';
          c.fillRect(rnd() * w, rnd() * h, 2, 2);
        }
        c.globalAlpha = 0.12;
        c.fillStyle = tint2 ?? '#000';
        c.fillRect(0, h / 2 - 1, w, 2);
        c.fillRect(w / 2 - 1, 0, 2, h);
        break;
      }
      case 'wood': {
        const tones = ['#c99a68', '#bf8f5e', '#d2a675', '#c4925f'];
        for (let r = 0; r < 8; r++) {
          let x = r % 2 ? -40 : 0;
          while (x < w) {
            const len = 50 + rnd() * 40;
            c.fillStyle = tones[Math.floor(rnd() * tones.length)]!;
            c.fillRect(x, r * 16, len, 16);
            c.fillStyle = 'rgba(80,50,30,.35)';
            c.fillRect(x, r * 16, 1, 16);
            x += len;
          }
          c.fillStyle = 'rgba(80,50,30,.3)';
          c.fillRect(0, r * 16 + 15, w, 1);
        }
        break;
      }
      case 'tile_check': {
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
          c.fillStyle = (x + y) % 2 ? '#e9e2d4' : '#cdbfa6';
          c.fillRect(x * 32, y * 32, 32, 32);
        }
        break;
      }
      case 'tile_white': {
        c.fillStyle = '#eef2f4';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#d3dbe0';
        c.fillRect(0, 0, w, 3);
        c.fillRect(0, 0, 3, h);
        break;
      }
      case 'concrete': {
        c.fillStyle = '#cfcac2';
        c.fillRect(0, 0, w, h);
        c.globalAlpha = 0.06;
        for (let i = 0; i < 700; i++) {
          c.fillStyle = rnd() < 0.5 ? '#000' : '#fff';
          c.beginPath();
          c.arc(rnd() * w, rnd() * h, 1 + rnd() * 3, 0, 6.3);
          c.fill();
        }
        c.globalAlpha = 0.25;
        c.fillStyle = '#9e978c';
        c.fillRect(0, 0, w, 1);
        c.fillRect(0, 0, 1, h);
        break;
      }
      case 'marble': {
        c.fillStyle = '#efeae2';
        c.fillRect(0, 0, w, h);
        c.strokeStyle = 'rgba(150,140,130,.25)';
        for (let i = 0; i < 6; i++) {
          c.beginPath();
          c.moveTo(rnd() * w, 0);
          c.bezierCurveTo(rnd() * w, h / 3, rnd() * w, (2 * h) / 3, rnd() * w, h);
          c.stroke();
        }
        c.fillStyle = 'rgba(160,150,135,.35)';
        c.fillRect(0, 0, w, 2);
        c.fillRect(0, 0, 2, h);
        break;
      }
      case 'grass': {
        c.fillStyle = '#8fbf6a';
        c.fillRect(0, 0, w, h);
        for (let i = 0; i < 500; i++) {
          c.fillStyle = rnd() < 0.5 ? '#86b862' : '#9bc874';
          c.fillRect(rnd() * w, rnd() * h, 3, 3);
        }
        break;
      }
      case 'sidewalk': {
        c.fillStyle = '#d9d4cb';
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#bdb6aa';
        c.fillRect(0, 0, w, 3);
        c.fillRect(0, 0, 3, h);
        break;
      }
      case 'street': {
        c.fillStyle = '#5b5f66';
        c.fillRect(0, 0, w, h);
        c.globalAlpha = 0.1;
        for (let i = 0; i < 600; i++) {
          c.fillStyle = rnd() < 0.5 ? '#000' : '#fff';
          c.fillRect(rnd() * w, rnd() * h, 2, 2);
        }
        break;
      }
    }
  });
}

function floorMesh(f: FloorPatch, x0: number, z0: number, x1: number, z1: number, theme: RoomTheme | undefined): THREE.Mesh {
  const w = x1 - x0;
  const h = z1 - z0;
  const geo = new THREE.PlaneGeometry(w, h);
  geo.rotateX(-Math.PI / 2);
  const period = FLOOR_PERIOD[f.kind] ?? 2;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + x0 + w / 2) / period, -(pos.getZ(i) + z0 + h / 2) / period);
  const tex = floorTex(f.kind, f.kind === 'carpet' ? (f.tint ?? theme?.carpet) : undefined, f.kind === 'carpet' ? (f.tint2 ?? theme?.carpet2) : undefined);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const key = `floormat:${tex.uuid}`;
  let m = floorMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: f.kind === 'marble' || f.kind === 'tile_white' ? 0.35 : f.kind === 'wood' ? 0.6 : 0.95 });
    floorMats.set(key, m);
  }
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x0 + w / 2, 0, z0 + h / 2);
  mesh.receiveShadow = true;
  return mesh;
}
const floorMats = new Map<string, THREE.MeshStandardMaterial>();

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function easeInCubic(t: number): number {
  return t * t * t;
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
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

