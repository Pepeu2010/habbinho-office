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
import { BUILDING_H, COL_W, CORE_COLS, CORRIDOR_Y, SOUTH_Y, TILE } from '../world/constants';
import { CAMPUS_GARDEN, layoutExterior, slotShell, type SlotShell } from '../world/layout/exterior';
import { slotAt } from '../world/layout/geometry';
import type { AreaLayout, ExteriorProp, FloorPatch, WallSegment } from '../world/layout/types';
import type { Character } from '../world/sim/character';
import type { BuildingView } from '../world/api';
import type { RoomState } from '../world/sim/room-state';
import type { Sim } from '../world/sim/sim';
import { arcadeScreen, buildFloorFurniture, buildWallItem, screenMat, signMesh, tvScreen, TV_CHANNELS, type FurnitureCtx, type FurnitureHooks } from './furniture';
import { PAL, block, canvasTex, cyl, mat, mergeStatic, put, rbox, sphere, texMat } from './kit';
import type { NatureKit } from './assets';
import { screenModeFor } from './screens';
import { prop } from './props';
import { Architecture3D } from './architecture';
import { Campus } from './campus';
import { inLot, Traffic } from './traffic';

export const WALL_H = 2.05;
export const WALL_LOW = 0.22;
const WALL_T = 0.36;
const DOOR_H = 1.62;

const CORE_NAMES: Readonly<Record<string, string>> = {
  'core:recepcao': tr('Recepção'),
  'core:banheiros': tr('Banheiros'),
  'core:copa': tr('Copa'),
  'core:lounge': tr('Lounge'),
  'core:biblioteca': tr('Biblioteca'),
  'core:reunioes': tr('Sala de reuniões'),
};

const ZONE_COLORS = {
  work: { trim: '#456c62', rug: '#69978a', wall: '#f2e6d4' },
  meeting: { trim: '#9d704c', rug: '#bd9772', wall: '#f4e5d3' },
  cafe: { trim: '#a55e52', rug: '#cb8577', wall: '#f3e1d5' },
} as const;

const WORK_FINISHES = [
  ZONE_COLORS.work,
  { trim: '#77576d', rug: '#a78395', wall: '#f3e1db' },
  { trim: '#416878', rug: '#769aa5', wall: '#e5eee7' },
  { trim: '#886141', rug: '#aa8866', wall: '#f6e8ce' },
] as const;

function roomFinish(zone: keyof typeof ZONE_COLORS, room: RoomState | null) {
  return zone === 'work' && room ? WORK_FINISHES[Math.abs(room.seed) % WORK_FINISHES.length]! : ZONE_COLORS[zone];
}

/** Parede com recorte: abaixa quando fica entre a câmera e a sala. */
interface WallPiece {
  obj: THREE.Object3D;
  /** Volume da parede erguida, no referencial do piso. */
  bounds: THREE.Box3;
  /** Normal para FORA da área (no plano xz). */
  nx: number;
  nz: number;
  h: number;
}

interface AreaView {
  id: string;
  group: THREE.Group;
  key: string;
  walls: WallPiece[];
  hooks: Map<string, FurnitureHooks>;
  zone?: FurnitureCtx['zone'];
  room: RoomState | null;
  elevators: FurnitureHooks[];
  clocks: FurnitureHooks[];
  light: THREE.PointLight | null;
}

const px = (v: number) => v / TILE;

/** Uma ação do E num objeto; `book` diz se o dono fica com o livro na mão depois dela. */
export interface UseAction {
  label: string;
  run(): void;
  book?: boolean;
}

export class Building3D {
  readonly root = new THREE.Group();
  readonly architecture = new Architecture3D();
  private view: BuildingView = 'office';
  private areas = new Map<string, AreaView>();
  private exterior = new THREE.Group();
  private traffic?: Traffic;
  private campus?: Campus;
  private exteriorCols = -1;
  /** Telas das mesas, por id do móvel (a simulação diz quem está sentado em qual mesa). */
  readonly screens = new Map<string, THREE.Mesh>();
  private camDir = new THREE.Vector2(0, 1);
  private cameraRay = new THREE.Ray();
  private cameraWall = new THREE.Box3();
  private cameraHit = new THREE.Vector3();
  private usePoint = new THREE.Vector3();
  /** Estado dos objetos que o dono usa no Passear, por id do móvel (sobrevive à remontagem das salas). */
  private used = new Map<string, number>();
  /** Luz da sala ligada ou desligada no interruptor, por área (só no 3D; o 2D e o snapshot não mudam). */
  private lights = new Map<string, boolean>();
  /** Estante de onde saiu o livro que o dono carrega. */
  private bookFrom: string | null = null;
  private night = 0;
  private exteriorGlow = new THREE.MeshStandardMaterial({
    color: '#f4d8a5', emissive: '#f6b96c', emissiveIntensity: 0.04, roughness: 0.42,
  });
  private exteriorPool: THREE.MeshBasicMaterial | null = null;

  constructor(private nature: NatureKit | null) {
    this.root.add(this.exterior, this.architecture.root);
  }

  setView(view: BuildingView): void {
    this.view = view;
    this.architecture.setView(view);
    for (const area of this.areas.values()) area.group.visible = view === 'office';
  }

  setNature(n: NatureKit): void {
    this.nature = n;
    this.exteriorCols = -1;
  }

  get carryingBook(): boolean {
    return this.bookFrom !== null;
  }

  /** Objeto usável mais perto (gaveta, abajur, TV, geladeira, estante, interruptor) e o que dá para fazer nele. */
  nearbyUsable(x: number, z: number): { label: string; actions: UseAction[]; d: number } | null {
    let best: { label: string; actions: UseAction[]; d: number } | null = null;
    let reach = 1.2;
    for (const area of this.areas.values()) {
      if (!area.group.visible) continue;
      for (const [id, hooks] of area.hooks) {
        const anchor = hooks.drawer?.handle ?? hooks.lamp ?? hooks.use?.part;
        if (!anchor) continue;
        const p = anchor.getWorldPosition(this.usePoint);
        const d = Math.hypot(x - p.x, z - p.z);
        if (d >= reach) continue;
        // gaveta: só de frente (atrás do arquivo não alcança)
        if (hooks.drawer && z < p.z - 0.07) continue;
        const actions = this.actionsFor(id, area, hooks);
        if (!actions.length) continue;
        reach = d;
        best = { label: actions.length > 1 ? tr('Usar a TV') : actions[0]!.label, actions, d };
      }
    }
    return best;
  }

  private actionsFor(id: string, area: AreaView, hooks: FurnitureHooks): UseAction[] {
    const state = this.used.get(id) ?? 0;
    const set = (v: number) => () => void this.used.set(id, v);
    if (hooks.drawer) return [{ label: state ? tr('Fechar gaveta') : tr('Abrir gaveta'), run: set(state ? 0 : 1) }];
    if (hooks.lamp) {
      const on = this.lampOn(id, area, this.night);
      return [{ label: on ? tr('Apagar o abajur') : tr('Acender o abajur'), run: set(on ? 0 : 1) }];
    }
    switch (hooks.use?.kind) {
      case 'fridge':
        return [{ label: state ? tr('Fechar a geladeira') : tr('Abrir a geladeira'), run: set(state ? 0 : 1) }];
      case 'switch': {
        const on = this.lit(area);
        return [{ label: on ? tr('Apagar as luzes') : tr('Acender as luzes'), run: () => void this.lights.set(area.id, !on) }];
      }
      case 'tv': {
        // TV começa ligada no canal 1: guardamos canal + 1 (0 = nunca mexida)
        const ch = this.used.has(id) ? state : 1;
        if (!ch) return [{ label: tr('Ligar a TV'), run: set(1) }];
        return [
          { label: tr('Trocar de canal'), run: set((ch % TV_CHANNELS) + 1) },
          { label: tr('Desligar a TV'), run: set(0) },
        ];
      }
      case 'shelf':
        if (this.bookFrom !== null) return [{ label: tr('Devolver o livro'), book: false, run: () => {
          this.used.delete(this.bookFrom!);
          this.bookFrom = null;
        } }];
        return [{ label: tr('Pegar um livro'), book: true, run: () => {
          this.used.set(id, 1);
          this.bookFrom = id;
        } }];
    }
    return [];
  }

  private lit(area: AreaView): boolean {
    return this.lights.get(area.id) ?? area.room?.lightOn ?? true;
  }

  /** Abajur: o que o dono escolheu; senão acende à noite com a luz da sala. */
  private lampOn(id: string, area: AreaView, night: number): boolean {
    const v = this.used.get(id);
    return v !== undefined ? v === 1 : night > 0.35 && this.lit(area);
  }

  /** Braço de câmera contra as paredes, incluindo os vãos reais das portas. */
  readonly walkCameraLimit = (pivot: THREE.Vector3, direction: THREE.Vector3, distance: number): number => {
    this.cameraRay.set(pivot, direction);
    let limit = distance;
    for (const view of this.areas.values()) {
      if (!view.group.visible) continue;
      for (const wall of view.walls) {
        this.cameraWall.copy(wall.bounds);
        this.cameraWall.min.y *= view.group.scale.y;
        this.cameraWall.max.y *= view.group.scale.y;
        // Um avatar encostado na parede ainda pode girar para longe dela.
        if (this.cameraWall.containsPoint(pivot)) continue;
        this.cameraWall.expandByScalar(0.12);
        if (this.cameraWall.containsPoint(pivot)) this.cameraWall.expandByScalar(-0.12);
        if (!this.cameraRay.intersectBox(this.cameraWall, this.cameraHit)) continue;
        limit = Math.min(limit, Math.max(0.02, this.cameraHit.distanceTo(pivot) - 0.07));
      }
    }
    return limit;
  };

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
      view.group.visible = this.view === 'office';
      this.areas.set(id, view);
      this.root.add(view.group);
    }
  }

  /** Recorte das paredes, animações de construção, portas do elevador, relógios e luz das salas. */
  update(sim: Sim, now: number, camera: THREE.Camera, target: THREE.Vector3, night: number, dt: number, people: {
    walking: boolean;
    extras: Iterable<Character>;
    coffeeSource?: string;
  }): void {
    this.architecture.setNight(night);
    this.night = night;
    this.campus?.update(now);
    this.traffic?.update(dt, night);
    this.exteriorGlow.emissiveIntensity = 0.04 + night * 1.52;
    if (this.exteriorPool) this.exteriorPool.opacity = THREE.MathUtils.smoothstep(night, 0.16, 0.92) * 0.46;
    if (this.view !== 'office') return;
    this.camDir.set(camera.position.x - target.x, camera.position.z - target.z);
    if (this.camDir.lengthSq() > 1e-6) this.camDir.normalize();
    const pitch = Math.atan2(camera.position.y - target.y, Math.hypot(camera.position.x - target.x, camera.position.z - target.z));
    // O passeio mostra o interior completo. O recorte só serve à visão estratégica.
    const cutaway = !people.walking && pitch >= 0.25;
    const k = 1 - Math.exp(-dt * 10);
    const d = new Date(now);
    const hourA = ((d.getHours() % 12) + d.getMinutes() / 60) / 12;
    const minA = d.getMinutes() / 60;
    const users = new Map<string, Character>();
    const register = (ch: Character) => {
      if (!ch.visible || ch.inside || ch.gone) return;
      const spot = sim.spots.get(ch.atSpot);
      if (!spot) return;
      if (spot.furnitureId) users.set(spot.furnitureId, ch);
      if (spot.deskId && ch.seated) users.set(spot.deskId, ch);
    };
    for (const ch of sim.chars.values()) register(ch);
    for (const ch of people.extras) register(ch);
    const arcade = sim.social.arcadeSeed() !== null;
    for (const v of this.areas.values()) {
      for (const w of v.walls) {
        const facing = w.nx * this.camDir.x + w.nz * this.camDir.y;
        const target = cutaway && facing > 0.3;
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
        // interruptor ligado de dia ainda acende um pouco (senão o clique não mostra nada)
        const goal = this.lit(v) ? 20 * (this.lights.get(v.id) ? Math.max(night, 0.4) : night) : 0;
        v.light.intensity += (goal - v.light.intensity) * k;
        v.light.visible = v.light.intensity > 0.02;
      }
      for (const [id, hooks] of v.hooks) {
        const occupant = users.get(id);
        if (hooks.screen) hooks.screen.material = occupant
          ? screenModeFor(occupant, v.room?.theme.accent)
          : screenMat('off');
        if (hooks.chair) {
          const { model, direction, baseZ } = hooks.chair;
          const seated = !!occupant?.seated;
          model.position.z = THREE.MathUtils.lerp(model.position.z, baseZ + (seated ? 0 : 0.072 * direction), k);
          model.rotation.y = THREE.MathUtils.lerp(model.rotation.y, seated ? 0 : .10 * direction, k);
        }
        if (hooks.cup) hooks.cup.visible = occupant?.held !== 'coffee' && id !== people.coffeeSource;
        if (hooks.drawer) {
          const { obj, z } = hooks.drawer;
          obj.position.z = THREE.MathUtils.lerp(obj.position.z, z + (this.used.get(id) ? 0.155 : 0), k);
        }
        if (hooks.lamp) hooks.lamp.visible = this.lampOn(id, v, night);
        if (hooks.use) {
          const { kind, part } = hooks.use;
          if (kind === 'tv') (part as THREE.Mesh).material = tvScreen(this.used.get(id) ?? 1);
          else if (kind === 'fridge') part.visible = !!this.used.get(id);
          else if (kind === 'shelf') part.visible = !this.used.get(id);
        }
        if (hooks.arcade) hooks.arcade.material = arcadeScreen(arcade ? 1 + Math.floor(now / 110) % 7 : 0);
        if (hooks.sway) {
          const ph = hooks.sway.parent!.position.x * 0.7 + hooks.sway.parent!.position.z * 0.4;
          hooks.sway.rotation.z = Math.sin(now / 1300 + ph) * 0.035;
          hooks.sway.rotation.x = Math.sin(now / 1700 + ph * 1.3) * 0.025;
        }
        if (hooks.steam) {
          hooks.steam.visible = (sim.machineUntil.get(id) ?? 0) > now;
          if (hooks.steam.visible) hooks.steam.children.forEach((puff, i) => {
            const t = ((now / 850 + i / 3) % 1);
            puff.position.set(Math.sin(t * 5 + i) * 0.027, t * 0.18, 0.02 + t * 0.04);
            puff.scale.setScalar(0.44 + t * 0.96);
          });
        }
        if (hooks.pingpong) {
          const match = [...sim.social.gatherings].find((g) => g.kind === 'pingpong' && (g.phase === 'run' || g.phase === 'final'));
          hooks.pingpong.update(match, now);
        }
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
    this.clearExterior();
    this.exteriorCols = -1;
    this.architecture.dispose();
    this.exteriorGlow.dispose();
    this.exteriorPool?.dispose();
    this.traffic?.dispose();
  }

  // ================================================================= montagem

  /** Refaz todas as salas no próximo sync (ex.: chegaram os modelos de móveis). */
  invalidate(): void {
    for (const v of this.areas.values()) this.disposeArea(v);
    this.areas.clear();
    this.exteriorCols = -1;
  }

  private disposeArea(v: AreaView): void {
    this.root.remove(v.group);
    for (const id of v.hooks.keys()) this.screens.delete(id);
    v.group.traverse((o) => {
      // geometrias e materiais vêm do cache do kit (compartilhados): só as placas têm material próprio
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).userData.own) ((o as THREE.Mesh).material as THREE.Material).dispose();
      if (o.userData.merged) (o as THREE.Mesh).geometry.dispose();
    });
  }

  private buildArea(a: AreaLayout, room: RoomState | null, key: string, shell?: SlotShell): AreaView {
    const g = new THREE.Group();
    g.name = a.id;
    const zone = room ? 'work' : a.id === 'core:reunioes' ? 'meeting' : a.id === 'core:copa' ? 'cafe' : undefined;
    const view: AreaView = { id: a.id, group: g, key, walls: [], hooks: new Map(), zone, room, elevators: [], clocks: [], light: null };
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
      const floor = zone && f.kind === 'carpet'
        ? { ...f, tint: zone === 'work' ? '#adc1b7' : zone === 'meeting' ? '#dbceb8' : '#d7baaa', tint2: roomFinish(zone, room).rug }
        : f;
      g.add(floorMesh(zone === 'work' && floor.kind === 'marble' ? { ...floor, kind: 'wood' } : floor,
        px(f.x), y0, px(f.x + f.w), y1, theme));
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
      const rugColor = zone && px(r.w) > 3 ? roomFinish(zone, room).rug : r.color;
      const rug = wovenRug(px(r.w) - 0.1, px(r.h) - 0.1, rugColor);
      rug.position.set(px(r.x + r.w / 2), 0.017, px(r.y + r.h / 2));
      g.add(rug);
    }
    // ---- paredes
    for (const w of a.walls) this.buildWall(g, view, w, a);
    // ---- móveis
    const deskChairs = new Set(a.spots.filter((s) => s.kind === 'desk').map((s) => s.furnitureId));
    for (const f of a.furniture) {
      const def = FURNITURE[f.kind];
      if (def.mount !== 'floor') continue;
      const { obj, hooks } = buildFloorFurniture(f.kind, def.footprint.w, def.footprint.h, {
        theme, zone, seed: hashStr(f.id), variant: f.variant, deskSeat: deskChairs.has(f.id),
      });
      obj.position.set(f.tx + px(f.dx ?? 0), 0, f.ty + px(f.dy ?? 0));
      obj.userData.furnitureId = f.id;
      g.add(obj);
      if (hooks.screen || hooks.chair || hooks.cup || hooks.pingpong || hooks.arcade || hooks.lamp || hooks.drawer || hooks.use) view.hooks.set(f.id, hooks);
      if (hooks.screen) this.screens.set(f.id, hooks.screen);
      if (['desk', 'desk_back', 'sofa', 'bookshelf', 'coffee_machine', 'plant_tall'].includes(f.kind)) {
        const shadow = new THREE.Mesh(contactPlane, contactMaterial());
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.set(obj.position.x + def.footprint.w / 2, 0.026, obj.position.z + def.footprint.h / 2);
        shadow.scale.set(def.footprint.w, def.footprint.h * 0.92, 1);
        g.add(shadow);
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
        s.userData.dynamic = true;
        s.position.set(px(it.cx), 1.62, px(it.baseY) + 0.03);
        g.add(s);
        continue;
      }
      const { obj, hooks } = buildWallItem(it.kind, def.footprint.w, { theme, zone, seed: hashStr(it.id), variant: it.variant });
      obj.position.set(px(it.cx), 0, onSouth ? px(it.baseY) - 1 + 0.5 - WALL_T / 2 : px(it.baseY));
      if (onSouth) obj.rotation.y = Math.PI;
      g.add(obj);
      if (hooks.doors) view.elevators.push(hooks);
      if (hooks.clockHands) view.clocks.push(hooks);
      if (hooks.use) view.hooks.set(it.id, hooks);
    }
    // ---- luz de teto (à noite)
    if (a.kind !== 'corridor' && !a.id.startsWith(CAMPUS_GARDEN) && !shell) {
      // alta (3 m acima da parede): rente ao teto ela estourava a cabeça e o chão de quem passeia por baixo
      const l = new THREE.PointLight('#ffd9ae', 0, 24, 1.1);
      l.position.set(a.rect.x + a.rect.w / 2, WALL_H + 3, a.rect.y + 2 + (a.rect.h - 3) / 2);
      l.castShadow = false;
      g.add(l);
      view.light = l;
    }
    if (shell) for (const p of shell.props) this.buildProp(g, p);
    mergeStatic(g, (o) => !!o.userData.dynamic);
    return view;
  }

  private buildWall(g: THREE.Group, view: AreaView, w: WallSegment, a: AreaLayout): void {
    const colors = view.zone ? roomFinish(view.zone, view.room) : undefined;
    const glassFront = view.zone === 'work' && (a.side === 'south' ? w.kind === 'face' : w.kind === 'south');
    const style: WallStyle = colors
      ? { ...w.style, trim: colors.trim, base: colors.wall,
        pattern: glassFront ? 'glass' : view.zone === 'work' ? 'wood_panel' : w.style.pattern }
      : w.style;
    const x0 = px(w.x);
    if (w.kind === 'cap') {
      const z0 = Math.max(px(w.y), a.rect.y + 2 - WALL_T);
      const z1 = px(w.y + w.h);
      if (z1 - z0 < 0.05) return;
      const outward = x0 + px(w.w) / 2 < a.rect.x + a.rect.w / 2 ? -1 : 1;
      const piece = wallBox(style, px(w.w), z1 - z0, WALL_H);
      piece.position.set(x0 + px(w.w) / 2, 0, (z0 + z1) / 2);
      g.add(piece);
      view.walls.push({ obj: piece, bounds: new THREE.Box3().setFromObject(piece), nx: outward, nz: 0, h: WALL_H });
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
      holder.userData.dynamic = true;
      holder.add(lintel);
      g.add(holder);
      view.walls.push({ obj: holder, bounds: new THREE.Box3().setFromObject(holder), nx: 0, nz, h: WALL_H });
      cur = dx1;
    }
    if (end > cur) pieces.push([cur, end]);
    for (const [p0, p1] of pieces) {
      if (p1 - p0 < 0.02) continue;
      const piece = wallBox(style, p1 - p0, WALL_T, WALL_H);
      piece.position.set((p0 + p1) / 2, 0, zc);
      g.add(piece);
      view.walls.push({ obj: piece, bounds: new THREE.Box3().setFromObject(piece), nx: 0, nz, h: WALL_H });
    }
  }

  private clearExterior(): void {
    this.exterior.traverse((o) => {
      if (o.userData.merged || o.userData.ownGeo) (o as THREE.Mesh).geometry.dispose();
    });
    this.exterior.clear();
  }

  private buildExterior(cols: number): void {
    this.clearExterior();
    this.architecture.build(cols * COL_W);
    const ext = layoutExterior(cols);
    const b = ext.bounds;
    const grass = floorMaterial('grass');
    grass.map!.repeat.setScalar(1 / 6);
    const campus = this.campus = new Campus(b, cols * COL_W);
    for (const f of ext.floors) {
      if (f.kind === 'grass') continue;
      const m = floorMesh(f, px(f.x), px(f.y), px(f.x + f.w), px(f.y + f.h), undefined);
      m.position.y = f.kind === 'street' ? -0.015 : -0.008;
      this.exterior.add(m);
    }
    // faixas da rua
    const dash = mat('#f4f1e6', { rough: 0.9 });
    const median = px(ext.streetY + ext.streetH * 0.5);
    for (let x = b.x; x < b.x + b.w; x += 3) {
      const m = put(this.exterior, rbox(1.35, 0.009, 0.095, 0.004), dash, x + 0.7, -0.012, median);
      m.castShadow = false;
    }
    for (const edge of [px(ext.streetY), px(ext.streetY + ext.streetH)]) {
      const curb = block(this.exterior, b.w, 0.047, 0.16, '#b2a69a', b.x + b.w / 2, -0.016, edge, 0.009);
      curb.castShadow = false;
    }
    // A laje termina abaixo do piso das salas (y = 0) e acima do gramado.
    const slab = put(this.exterior, rbox(cols * 16 + 0.4, 0.12, CORRIDOR_Y * 2 + 5 + 0.4, 0.04), mat('#d6d0c4', { rough: 0.9 }), cols * 8, -0.135, (CORRIDOR_Y * 2 + 5) / 2);
    slab.castShadow = false;
    campus.build(this.exterior, grass);
    this.traffic?.dispose();
    this.traffic = new Traffic(this.exterior, ext.lanes.map((l) => ({ z: px(l.y), dir: l.dir })), b.x, b.x + b.w, 7 + cols);
    for (const p of ext.props) if (!campus.paved(px(p.x), px(p.y)) && !inLot(px(p.x), px(p.y), 1.5)) this.buildProp(this.exterior, p);
    this.buildEntrance();
    this.scatterGrass(cols, b, campus);
    mergeStatic(this.exterior, (o) => !!o.userData.dynamic);
  }

  private buildEntrance(): void {
    const g = this.exterior;
    const z = CORRIDOR_Y;
    // Vasos na borda da passagem, fora da faixa caminhável e da porta.
    for (const [x, y, turn] of [[-3.58, z + 0.84, Math.PI / 2], [-3.61, z + 4.54, Math.PI / 2], [-0.44, z + 5.82, Math.PI / 2]] as const) {
      const planter = prop('craftedGardenPlanter', { w: 1.38, h: 0.75, d: 0.64 });
      if (planter) {
        planter.position.set(x, 0, y);
        planter.rotation.y = turn;
        g.add(planter);
      }
    }
    const stone = mat('#a89c8c', { rough: 0.82 });
    for (const [x, depth, middle] of [[-3.03, 5, z + 2.5], [-0.93, 2, z + 6]] as const) {
      const edging = block(g, 0.1, 0.045, depth, stone, x, -0.014, middle, 0.009);
      edging.castShadow = false;
    }
    this.buildProp(g, { kind: 'lamp', x: -3.57 * TILE, y: (z + 1.79) * TILE, seed: 7 });
    this.buildProp(g, { kind: 'lamp', x: -0.45 * TILE, y: (z + 4.43) * TILE, seed: 13 });
  }

  private gardenLamp(g: THREE.Object3D, x: number, z: number, rotation: number): void {
    const lamp = prop('craftedGardenLamp', { h: 1.88 });
    const lightAt = new THREE.Vector3(x, 1.76, z);
    if (lamp) {
      lamp.position.set(x, 0, z);
      lamp.rotation.y = rotation;
      g.add(lamp);
      const socket = lamp.getObjectByName('Socket_Light');
      if (socket) g.worldToLocal(socket.getWorldPosition(lightAt));
    } else {
      put(g, cyl(0.04, 0.06, 1.80, 8), mat(PAL.charcoal, { metal: 0.5, rough: 0.4 }), x, 0, z);
    }
    put(g, sphere(0.075, 12), this.exteriorGlow, lightAt.x, lightAt.y - 0.035, lightAt.z, { shadow: false });
    if (!this.exteriorPool) {
      const texture = canvasTex('garden-lamp-pool', 64, 64, (ctx) => {
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(255,190,103,0.84)');
        gradient.addColorStop(0.46, 'rgba(255,185,100,0.28)');
        gradient.addColorStop(1, 'rgba(255,185,100,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
      });
      this.exteriorPool = new THREE.MeshBasicMaterial({
        map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
      });
    }
    const glow = new THREE.Mesh(contactPlane, this.exteriorPool);
    glow.position.set(lightAt.x, 0.006, lightAt.z + 0.14);
    glow.rotation.x = -Math.PI / 2;
    glow.scale.setScalar(2.45);
    g.add(glow);
  }

  /** Tufos de grama e juncos no gramado (fora do prédio, da calçada e da rua), sempre no mesmo lugar. */
  private scatterGrass(cols: number, b: { x: number; y: number; w: number; h: number }, campus: Campus): void {
    const n = this.nature;
    if (!n) return;
    const rnd = mulberry(0x9a55 + cols);
    const w = cols * COL_W;
    const south = BUILDING_H;
    const count = Math.round((b.w * b.h) / 9);
    for (let i = 0; i < count; i++) {
      const x = b.x + rnd() * b.w;
      const z = b.y + rnd() * b.h;
      if (x > -4 && x < w + 1 && z > -1.5 && z < south + 2.2) continue; // prédio e entrada
      if (z > south + 1.8 && z < south + 11.3) continue; // calçadas e rua
      if (campus.paved(x, z)) continue;
      if (inLot(x, z, 0.5)) continue;
      const src = n.pick(rnd() < 0.85 ? 'Grass' : 'Reed', Math.floor(rnd() * 1e6));
      if (!src) return;
      const t = src.clone();
      t.position.set(x, 0, z);
      t.rotation.y = rnd() * Math.PI * 2;
      t.scale.setScalar(0.28 + rnd() * 0.25);
      t.traverse((o) => (o.castShadow = false));
      this.exterior.add(t);
    }
  }

  private buildProp(g: THREE.Object3D, p: ExteriorProp): void {
    const x = px(p.x);
    const z = px(p.y);
    const rnd = mulberry(p.seed);
    const n = this.nature;
    switch (p.kind) {
      case 'tree':
      case 'pine': {
        const height = 2.3 + rnd() * 1.35;
        const tree = prop('craftedGardenTree', { h: height, w: height * (p.kind === 'pine' ? 0.61 : 0.82) });
        if (tree) {
          tree.position.set(x, 0, z);
          tree.rotation.y = rnd() * Math.PI * 2;
          g.add(tree);
          break;
        }
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
        this.gardenLamp(g, x, z, x < 0 && z < BUILDING_H ? Math.PI / 2 : 0);
        break;
      }
      case 'bench': {
        const bench = prop('craftedGardenBench', { w: 1.63, h: 0.68, d: 0.47 });
        if (bench) {
          bench.position.set(x, 0, z);
          bench.rotation.y = x < 0 ? Math.PI / 2 : 0;
          g.add(bench);
          break;
        }
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

const contactPlane = new THREE.PlaneGeometry(1.15, 1.15);
let furnitureShadow: THREE.MeshBasicMaterial | undefined;
function contactMaterial(): THREE.MeshBasicMaterial {
  if (!furnitureShadow) {
    const texture = canvasTex('furniture-contact', 64, 64, (ctx) => {
      const gradient = ctx.createRadialGradient(32, 32, 5, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(44,34,23,0.28)');
      gradient.addColorStop(1, 'rgba(44,34,23,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
    });
    furnitureShadow = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  }
  return furnitureShadow;
}

function wallBox(style: WallStyle, w: number, d: number, h: number, noBase = false): THREE.Group {
  const g = new THREE.Group();
  g.userData.dynamic = true;
  const glass = style.pattern === 'glass' && !noBase;
  const base = glass ? mat('#b7d1cb', { opacity: 0.21, rough: 0.23 }) : mat(style.exterior ? '#ded5c8' : style.base, { rough: 0.92 });
  if (glass) {
    const frame = mat(style.trim ?? '#aeb9af', { rough: 0.58, metal: 0.23 });
    block(g, w, 0.25, d, style.base, 0, 0, 0, 0.02);
    const pane = block(g, w, h - 0.30, d * 0.18, base, 0, 0.25, 0, 0.003);
    pane.castShadow = false;
    base.depthWrite = false;
    block(g, w, 0.045, d * 0.49, frame, 0, h - 0.045, 0, 0.008);
    const count = Math.max(1, Math.ceil(w / 2.4));
    for (let i = 0; i <= count; i++) {
      block(g, 0.046, h - 0.25, d * 0.48, frame, -w / 2 + w * i / count, 0.25, 0, 0.005);
    }
    mergeStatic(g, () => false);
    return g;
  }
  block(g, w, h, d, base, 0, 0, 0, 0.02);
  if (!noBase) {
    const trim = mat(style.trim ?? '#9b9184', { rough: 0.7 });
    if (style.pattern === 'wood_panel') {
      block(g, w + 0.004, 0.54, d + 0.025, '#d3ac85', 0, 0, 0, 0.012);
      block(g, w + 0.009, 0.05, d + 0.041, '#b68e69', 0, 0.52, 0, 0.014);
    }
    else if (style.pattern === 'tiles') block(g, w + 0.004, 0.8, d + 0.02, mat('#e6eef2', { rough: 0.35 }), 0, 0, 0, 0.005);
    block(g, w + 0.01, 0.09, d + 0.04, trim, 0, 0, 0, 0.01);
  }
  mergeStatic(g, () => false);
  return g;
}

function wovenRug(w: number, d: number, color: string): THREE.Mesh {
  const runner = w > 2 * d;
  const material = texMat(`woven-rug:${color}:${runner}`, 256, runner ? 96 : 192, (ctx, x, y) => {
    const base = new THREE.Color(color);
    const edge = base.clone().lerp(new THREE.Color('#47382f'), 0.26);
    const stitch = base.clone().lerp(new THREE.Color('#fff1c8'), 0.62);
    ctx.fillStyle = base.getStyle();
    ctx.beginPath();
    ctx.roundRect(1, 1, x - 2, y - 2, 13);
    ctx.fill();
    ctx.clip();
    ctx.globalAlpha = 0.22;
    for (let row = 0; row < y; row += 3) {
      ctx.fillStyle = row % 2 ? '#fff3d9' : '#41302c';
      for (let col = row % 2; col < x; col += 5) ctx.fillRect(col, row, 3, 1);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = edge.getStyle();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(8, 8, x - 16, y - 16, 12);
    ctx.stroke();
    ctx.strokeStyle = stitch.getStyle();
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.roundRect(16, 16, x - 32, y - 32, 9);
    ctx.stroke();
    ctx.fillStyle = stitch.getStyle();
    for (const u of [28, x - 28]) for (const v of [28, y - 28]) {
      ctx.beginPath();
      ctx.moveTo(u, v - 5);
      ctx.lineTo(u + 5, v);
      ctx.lineTo(u, v + 5);
      ctx.lineTo(u - 5, v);
      ctx.fill();
    }
  });
  material.alphaTest = 0.55;
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), material);
  rug.receiveShadow = true;
  rug.userData.ownGeo = true;
  return rug;
}

const FLOOR_PERIOD: Partial<Record<FloorKind, number>> = { carpet: 2, wood: 3.8, tile_check: 2, tile_white: 1, concrete: 4, marble: 2, grass: 6, sidewalk: 1, street: 4 };

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
        const tones = ['#dfad7f', '#e9bd94', '#d3a072', '#e1b084', '#efc69f'];
        for (let r = 0; r < 8; r++) {
          let x = r % 2 ? -40 : 0;
          while (x < w) {
            const len = 50 + rnd() * 40;
            c.fillStyle = tones[Math.floor(rnd() * tones.length)]!;
            c.fillRect(x, r * 16, len, 16);
            c.fillStyle = 'rgba(86,48,25,.40)';
            c.fillRect(x, r * 16, 1.5, 16);
            c.strokeStyle = 'rgba(103,62,38,.14)';
            c.lineWidth = 0.7;
            for (let line = 0; line < 2; line++) {
              const y = r * 16 + 5 + line * 5 + rnd() * 2;
              c.beginPath();
              c.moveTo(x + 4, y);
              c.bezierCurveTo(x + len * 0.3, y - 1.8, x + len * 0.62, y + 1.7, x + len - 4, y);
              c.stroke();
            }
            x += len;
          }
          c.fillStyle = 'rgba(86,48,25,.44)';
          c.fillRect(0, r * 16 + 14.5, w, 1.5);
          c.fillStyle = 'rgba(255,236,214,.34)';
          c.fillRect(0, r * 16, w, 1);
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
        // corredor: placas de pedra clara 2×1 m (o cimento manchado parecia sujo)
        c.fillStyle = '#e6e0d5';
        c.fillRect(0, 0, w, h);
        for (let row = 0; row < 4; row++) {
          const off = row % 2 ? w / 4 : 0;
          for (let col = -1; col < 2; col++) {
            const x0 = off + (col * w) / 2;
            c.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '160,150,135'},${0.06 + rnd() * 0.08})`;
            c.fillRect(x0 + 2, (row * h) / 4 + 2, w / 2 - 4, h / 4 - 4);
            c.fillStyle = 'rgba(150,140,125,.45)';
            c.fillRect(x0, (row * h) / 4, 2, h / 4);
          }
          c.fillRect(0, (row * h) / 4, w, 2);
        }
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
        c.fillStyle = '#92a978';
        c.fillRect(0, 0, w, h);
        c.globalAlpha = 0.46;
        for (let i = 0; i < 690; i++) {
          const x = rnd() * w;
          const y = rnd() * h;
          c.fillStyle = rnd() < 0.54 ? '#819a6c' : '#afbe88';
          c.fillRect(x, y, 0.7 + rnd() * 2.3, 1 + rnd() * 1.7);
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
  const m = floorMaterial(f.kind, f.tint ?? theme?.carpet, f.tint2 ?? theme?.carpet2);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x0 + w / 2, 0, z0 + h / 2);
  mesh.receiveShadow = true;
  mesh.userData.ownGeo = true;
  return mesh;
}

function floorMaterial(kind: FloorKind, tint?: string, tint2?: string): THREE.MeshStandardMaterial {
  const tex = floorTex(kind, kind === 'carpet' ? tint : undefined, kind === 'carpet' ? tint2 : undefined);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const key = `floormat:${tex.uuid}`;
  let m = floorMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: kind === 'marble' || kind === 'tile_white' ? 0.35 : kind === 'wood' ? 0.6 : 0.95 });
    floorMats.set(key, m);
  }
  return m;
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

