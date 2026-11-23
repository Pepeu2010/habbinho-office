// Passear (Fase 6): o usuário anda pelo escritório com um Habbinho próprio, em terceira ou primeira pessoa.
//
// O boneco do usuário NÃO é um agente: não existe no store nem no snapshot, não entra em contadores, métricas, feed,
// seleção nem no Habblaud World (como os visitantes de npcs.ts). Anda pela MESMA grade da simulação (paredes, móveis
// e cadeiras bloqueiam; portas são as aberturas), e as interações usam o que a simulação já tem: chamar e tomar o
// elevador, sentar nos lugares das áreas comuns (reservando o lugar, para nenhum agente sentar junto), pegar café ou
// água e cumprimentar um agente (abre a gaveta dele). Nada disso muda o que os agentes estão fazendo.
import * as THREE from 'three';
import { parseAppearanceParts, parseCharacterName, parseSeed, type AppearanceParts } from '../../../shared/appearance';
import type { AgentInfo, AgentStatus } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import { appearanceFromSeed } from '../art';
import type { Dir, HeldItem, Pose } from '../art/api';
import { CORRIDOR_H, CORRIDOR_Y, TILE } from '../world/constants';
import type { SpotDef, SpotKind } from '../world/layout/types';
import { BLOCKED, FREE, SEAT } from '../world/path/grid';
import { Character } from '../world/sim/character';
import type { Sim } from '../world/sim/sim';
import type { WalkView } from '../world/api';

export type { WalkView };

/** Ordem das câmeras no V e no botão da barra. */
export const NEXT_VIEW: Record<WalkView, WalkView> = { third: 'first', first: 'above', above: 'third' };

const ME = 'me:walker';
const STORE = 'habblaud.3d.me';
const RADIUS = 0.27;
const WALK_SPEED = 2.6;
const RUN_SPEED = 4.8;
/** Altura dos olhos (primeira pessoa) e do alvo da câmera (terceira), em tiles. */
const EYE = 0.86;
const REACH = 1.35;

/** Lugares onde o usuário pode sentar (mesas e nichos com a pose de digitar) / o que pegar. */
const SIT_KINDS: readonly SpotKind[] = ['desk', 'stool', 'nook', 'sofa', 'armchair', 'beanbag', 'cafe_seat', 'bench'];
const TYPE_KINDS: readonly SpotKind[] = ['desk', 'nook'];
/** Lugar ocupado: procura um livre até esta distância (tiles). */
const FREE_SEAT_RANGE = 5;
const DRINK: Partial<Record<SpotKind, { held: HeldItem; label: string }>> = {
  coffee: { held: 'coffee', label: tr('Pegar um café') },
  water: { held: 'water', label: tr('Pegar água') },
};

export interface WalkTarget {
  kind: 'elevator' | 'sit' | 'stand' | 'drink' | 'agent';
  label: string;
  spot?: SpotDef;
  agentId?: string;
}

/** Colisão de um círculo com a grade: tiles bloqueados e cadeiras não deixam passar. */
export function blockedAt(cell: (tx: number, ty: number) => number, x: number, z: number, r = RADIUS): boolean {
  for (const [dx, dz] of [
    [-r, -r],
    [r, -r],
    [-r, r],
    [r, r],
  ] as const) {
    const c = cell(Math.floor(x + dx), Math.floor(z + dz));
    if (c === BLOCKED || c === SEAT) return true;
  }
  return false;
}

/** Move com deslizamento nas paredes (eixo a eixo). */
export function slide(cell: (tx: number, ty: number) => number, x: number, z: number, dx: number, dz: number): [number, number] {
  let nx = x + dx;
  if (blockedAt(cell, nx, z)) nx = x;
  let nz = z + dz;
  if (blockedAt(cell, nx, nz)) nz = z;
  return [nx, nz];
}

export interface OwnerProfile {
  seed: number;
  look: 'f' | 'm';
  name: string;
  parts?: AppearanceParts;
}

function loadMe(): OwnerProfile {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<OwnerProfile> | null;
    const seed = parseSeed(raw?.seed);
    if (raw && seed !== null && (raw.look === 'f' || raw.look === 'm')) {
      return { seed, look: raw.look, name: parseCharacterName(raw.name) ?? '', parts: parseAppearanceParts(raw.parts) ?? undefined };
    }
  } catch {
    // armazenamento bloqueado ou corrompido: sorteia
  }
  const me: OwnerProfile = { seed: Math.floor(Math.random() * 1e9), look: Math.random() < 0.5 ? 'f' : 'm', name: '' };
  saveMe(me);
  return me;
}

function saveMe(me: OwnerProfile): boolean {
  try {
    localStorage.setItem(STORE, JSON.stringify(me));
    return true;
  } catch {
    return false;
  }
}

export class WalkMode {
  view: WalkView | null = null;
  readonly list = new Map<string, Character>();
  /** Posição dos pés, em tiles. */
  x = 0;
  z = 0;
  /** Para onde a câmera olha (rad; 0 = norte) e inclinação. */
  yaw = 0;
  pitch = -0.08;
  private ch: Character;
  private owner = loadMe();
  private drinkUntil = 0;
  private drinkFurnitureId?: string;
  private cameraArm = Infinity;
  private ride: { to: SpotDef; t0: number; phase: 'in' | 'out' } | null = null;
  private calledAt = 0;
  private calledElevator = -1;
  /** Caminho do clicar-para-ir: centros de tiles [x0, z0, x1, z1, ...]. */
  private path: number[] = [];

  constructor() {
    this.ch = this.makeChar(this.owner);
  }

  private makeChar(me: OwnerProfile): Character {
    const info = { id: ME, ...me, custom: true, name: me.name || tr('Dono do escritório'), roomId: 'core:recepcao', kind: 'main', status: 'idle' as AgentStatus } as unknown as AgentInfo;
    const ch = new Character(info, appearanceFromSeed(me.seed, { look: me.look, parts: me.parts }));
    ch.alpha = 1;
    return ch;
  }

  get active(): boolean {
    return this.view !== null;
  }

  coffeeSource(now: number): string | undefined {
    return this.active && now < this.drinkUntil && this.ch.held === 'coffee' ? this.drinkFurnitureId : undefined;
  }

  profile(): OwnerProfile {
    return { ...this.owner };
  }

  saveProfile(me: OwnerProfile): boolean {
    if (!saveMe(me)) return false;
    this.owner = me;
    this.ch.appearance = appearanceFromSeed(me.seed, { look: me.look, parts: me.parts });
    Object.assign(this.ch.info, me, { name: me.name || tr('Dono do escritório') });
    return true;
  }

  /** Entra perto de um ponto (o centro da câmera), no tile caminhável mais próximo; de frente para o norte. */
  enter(sim: Sim, view: WalkView, near: THREE.Vector3): void {
    if (view !== this.view) this.cameraArm = Infinity;
    if (!this.active) {
      const g = sim.building.grid;
      const t = g.nearestWalkable(Math.floor(near.x), Math.floor(near.z), 30) ?? sim.building.grid.nearestWalkable(4, 4, 60);
      if (t) {
        this.x = t.x + 0.5;
        this.z = t.y + 0.5;
      }
      this.yaw = 0;
      this.pitch = -0.08;
      this.list.set(ME, this.ch);
      this.place();
    }
    this.view = view;
  }

  exit(sim: Sim): void {
    if (!this.active) return;
    this.standUp(sim);
    sim.spots.releaseAll(ME);
    for (const e of sim.elevators) e.release(ME, Date.now());
    this.list.clear();
    this.view = null;
    this.ride = null;
    this.path.length = 0;
  }

  private cell(sim: Sim): (tx: number, ty: number) => number {
    const g = sim.building.grid;
    return (tx, ty) => tx <= 0 && tx >= -12 && ty === CORRIDOR_Y + Math.floor(CORRIDOR_H / 2) ? FREE : g.get(tx, ty);
  }

  /** Teclas: frente/trás/lados no referencial da câmera; giro com as setas. */
  update(sim: Sim, dt: number, now: number, keys: ReadonlySet<string>, shift: boolean): void {
    if (!this.active) return;
    const ch = this.ch;
    if (this.ride) return this.updateRide(sim, now, dt);
    if (keys.has('arrowleft')) this.yaw += 1.8 * dt;
    if (keys.has('arrowright')) this.yaw -= 1.8 * dt;
    let f = 0;
    let s = 0;
    if (keys.has('w') || keys.has('arrowup')) f += 1;
    if (keys.has('s') || keys.has('arrowdown')) f -= 1;
    if (keys.has('a')) s -= 1;
    if (keys.has('d')) s += 1;
    if (f || s) this.path.length = 0;
    if ((f || s) && ch.atSpot) this.standUp(sim);
    if (this.path.length && !ch.atSpot) {
      // clicar-para-ir: segue os centros dos tiles do A*
      const dx = this.path[0]! + 0.5 - this.x;
      const dz = this.path[1]! + 0.5 - this.z;
      const d = Math.hypot(dx, dz);
      const sp = Math.min(d, (shift ? RUN_SPEED : WALK_SPEED) * dt);
      if (d < 0.05) this.path.splice(0, 2);
      else {
        [this.x, this.z] = slide(this.cell(sim), this.x, this.z, (dx / d) * sp, (dz / d) * sp);
        ch.setPose(shift ? 'run' : 'walk', now < this.drinkUntil ? ch.held : 'none');
        ch.dir = dirOf(dx, dz);
      }
    } else if ((f || s) && !ch.atSpot) {
      const len = Math.hypot(f, s);
      const sp = (shift ? RUN_SPEED : WALK_SPEED) * dt;
      // yaw 0 = olhando para -z (norte)
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      const dx = ((fx * f + rx * s) / len) * sp;
      const dz = ((fz * f + rz * s) / len) * sp;
      [this.x, this.z] = slide(this.cell(sim), this.x, this.z, dx, dz);
      ch.setPose(shift ? 'run' : 'walk', now < this.drinkUntil ? ch.held : 'none');
      ch.dir = dirOf(dx, dz);
    } else if (!ch.atSpot) {
      ch.setPose(now < this.drinkUntil ? 'drink' : 'stand', now < this.drinkUntil ? ch.held : 'none');
      ch.dir = dirOf(-Math.sin(this.yaw), -Math.cos(this.yaw));
    }
    if (now >= this.drinkUntil && ch.held !== 'none' && !ch.atSpot) ch.setPose(ch.pose, 'none');
    // elevador chamado: as portas fecham sozinhas depois de um tempo
    if (this.calledElevator >= 0 && now - this.calledAt > 6000) {
      sim.elevators[this.calledElevator]?.release(ME, now);
      this.calledElevator = -1;
    }
    this.place();
  }

  private place(): void {
    const ch = this.ch;
    if (ch.atSpot) return;
    ch.x = this.x * TILE;
    // os pés do personagem ficam 3 px acima do ponto de apoio (ver characters.ts: FOOT_SHIFT)
    ch.y = (this.z + 3 / TILE) * TILE;
    ch.tx = Math.floor(this.x);
    ch.ty = Math.floor(this.z);
  }

  /** Clicar-para-ir: caminho pela grade até o tile livre mais perto do ponto. Devolve se achou caminho. */
  goTo(sim: Sim, x: number, z: number): boolean {
    if (!this.active || this.ride) return false;
    const t = sim.building.grid.nearestWalkable(Math.floor(x), Math.floor(z), 2);
    if (!t) return false;
    this.standUp(sim);
    if (!sim.finder.find(Math.floor(this.x), Math.floor(this.z), t.x, t.y, this.path)) return false;
    return this.path.length > 0;
  }

  /** O que dá para fazer aqui perto (o mais próximo), para o aviso "E · ...". */
  target(sim: Sim, agents: Iterable<{ id: string; x: number; z: number }>): WalkTarget | null {
    if (!this.active || this.ride) return null;
    if (this.ch.atSpot) return { kind: 'stand', label: tr('Levantar') };
    let best: WalkTarget | null = null;
    let bestD = REACH;
    const consider = (t: WalkTarget, px: number, pz: number) => {
      const d = Math.hypot(px - this.x, pz - this.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    };
    for (const a of agents) consider({ kind: 'agent', label: tr('Cumprimentar'), agentId: a.id }, a.x, a.z);
    const nearAgent = best !== null;
    for (const s of sim.spots.all()) {
      const px = s.tx + 0.5;
      const pz = s.ty + 0.5;
      if (Math.abs(px - this.x) > REACH || Math.abs(pz - this.z) > REACH) continue;
      if (s.kind === 'elevator') consider({ kind: 'elevator', label: sim.elevators.length > 1 ? tr('Tomar o elevador') : tr('Chamar o elevador'), spot: s }, px, pz);
      else if (SIT_KINDS.includes(s.kind)) {
        // ocupado (por um agente: o lugar reflete o status real dele, então não pedimos para levantar) — senta perto
        // com um agente ao alcance, cumprimentar vale mais que o lugar ocupado (geralmente é a cadeira dele)
        const free = sim.spots.isFree(s.id, ME) ? s : nearAgent ? null : this.nearestFreeSeat(sim, px, pz);
        if (free) consider({ kind: 'sit', label: free === s ? tr('Sentar') : tr('Ocupado · sentar ao lado'), spot: free }, px, pz);
      }
      else if (DRINK[s.kind]) consider({ kind: 'drink', label: DRINK[s.kind]!.label, spot: s }, px, pz);
    }
    return best;
  }

  /** Faz a interação; devolve o agente cumprimentado (a UI abre a gaveta dele). */
  interact(sim: Sim, now: number, t: WalkTarget | null): string | null {
    if (!t) return null;
    const ch = this.ch;
    switch (t.kind) {
      case 'stand':
        this.standUp(sim);
        return null;
      case 'sit': {
        const s = t.spot!;
        if (!sim.spots.reserve(s.id, ME)) return null;
        ch.x = s.x;
        ch.y = s.y;
        ch.tx = s.tx;
        ch.ty = s.ty;
        ch.dir = s.dir as Dir;
        ch.seated = !!s.seated;
        ch.sortY = s.sortY ?? null;
        ch.atSpot = s.id;
        const typing = TYPE_KINDS.includes(s.kind);
        ch.setPose((typing ? 'type' : 'sit') as Pose, typing || now >= this.drinkUntil ? 'none' : ch.held);
        return null;
      }
      case 'drink': {
        const d = DRINK[t.spot!.kind]!;
        this.drinkUntil = now + 9000;
        this.drinkFurnitureId = t.spot?.furnitureId;
        ch.setPose('drink', d.held);
        return null;
      }
      case 'agent':
        ch.setPose('raise_hand', 'none');
        return t.agentId ?? null;
      case 'elevator': {
        const i = sim.elevators.findIndex((e) => e.spotId === t.spot!.id);
        const el = sim.elevators[i];
        if (!el) return null;
        el.request(ME);
        this.calledAt = now;
        this.calledElevator = i;
        // mais de um elevador: entra e sai no próximo (o prédio tem um andar só)
        if (sim.elevators.length > 1) {
          const next = sim.elevators[(i + 1) % sim.elevators.length]!;
          const to = sim.spots.get(next.spotId);
          if (to) this.ride = { to, t0: now, phase: 'in' };
        }
        return null;
      }
    }
  }

  private updateRide(sim: Sim, now: number, dt: number): void {
    const r = this.ride!;
    const ch = this.ch;
    if (r.phase === 'in') {
      if (now - r.t0 > 900) ch.alpha = Math.max(0, ch.alpha - dt * 2.5);
      if (ch.alpha <= 0) {
        for (const e of sim.elevators) e.release(ME, now);
        const next = sim.elevators.find((e) => e.spotId === r.to.id);
        next?.request(ME);
        this.x = r.to.tx + 0.5;
        this.z = r.to.ty + 0.5;
        this.place();
        r.phase = 'out';
        r.t0 = now;
      }
    } else {
      const el = sim.elevators.find((e) => e.spotId === r.to.id);
      if (el?.isOpen || now - r.t0 > 2500) ch.alpha = Math.min(1, ch.alpha + dt * 2.5);
      if (ch.alpha >= 1) {
        el?.release(ME, now);
        this.ride = null;
        this.calledElevator = -1;
      }
    }
    ch.setPose('stand', 'none');
  }

  private nearestFreeSeat(sim: Sim, x: number, z: number): SpotDef | null {
    let best: SpotDef | null = null;
    let bestD = FREE_SEAT_RANGE;
    for (const s of sim.spots.all()) {
      if (!SIT_KINDS.includes(s.kind) || !sim.spots.isFree(s.id, ME)) continue;
      const d = Math.hypot(s.tx + 0.5 - x, s.ty + 0.5 - z);
      if (d < bestD) [best, bestD] = [s, d];
    }
    return best;
  }

  private standUp(sim: Sim): void {
    const ch = this.ch;
    if (!ch.atSpot) return;
    sim.spots.release(ch.atSpot, ME);
    const s = sim.spots.get(ch.atSpot);
    ch.atSpot = null;
    ch.seated = false;
    ch.sortY = null;
    // volta para um tile livre perto do lugar
    const t = s ? sim.building.grid.nearestWalkable(s.tx, s.ty, 3) : null;
    if (t) {
      this.x = t.x + 0.5;
      this.z = t.y + 0.5;
    }
    ch.setPose('stand', 'none');
    this.place();
  }

  /** Posiciona a câmera e indica se há espaço para mostrar o corpo do visitante. */
  applyCamera(
    camera: THREE.PerspectiveCamera,
    at: THREE.Vector3,
    dt: number,
    limitArm: (pivot: THREE.Vector3, direction: THREE.Vector3, distance: number) => number,
  ): boolean {
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    if (this.view === 'above') {
      // vista elevada: alta e atrás do boneco, olhando para ele; sem colisão da câmera (as paredes são baixas)
      const target = new THREE.Vector3(at.x, at.y + 0.4, at.z);
      const back = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      camera.position.copy(target).addScaledVector(back, 4.2).add(new THREE.Vector3(0, 7.5, 0));
      camera.lookAt(target);
    } else if (this.view === 'first') {
      const eye = new THREE.Vector3(at.x, at.y + EYE * (this.ch.seated ? 0.78 : 1), at.z);
      const ahead = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      eye.addScaledVector(ahead, limitArm(eye, ahead, 0.06));
      camera.position.copy(eye);
      camera.lookAt(eye.clone().add(fwd));
    } else {
      const target = new THREE.Vector3(at.x, at.y + EYE * 0.85, at.z);
      const arm = fwd.clone().multiplyScalar(-3.7);
      arm.y += 1.28;
      const length = arm.length();
      arm.divideScalar(length);
      const allowed = limitArm(target, arm, length);
      // Aproxima imediatamente ao encontrar a parede e abre devagar ao sair.
      this.cameraArm = allowed <= this.cameraArm ? allowed : THREE.MathUtils.lerp(this.cameraArm, allowed, 1 - Math.exp(-dt * 9));
      camera.position.copy(target).addScaledVector(arm, this.cameraArm);
      camera.lookAt(target.clone().addScaledVector(fwd, Math.min(1.05, this.cameraArm * 0.33)));
    }
    camera.clearViewOffset();
    camera.near = 0.05;
    camera.far = 140;
    camera.updateProjectionMatrix();
    return this.view === 'above' || (this.view === 'third' && this.cameraArm > 0.52);
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -0.9, 0.6);
  }
}

function dirOf(dx: number, dz: number): Dir {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 'right' : 'left';
  return dz > 0 ? 'down' : 'up';
}
