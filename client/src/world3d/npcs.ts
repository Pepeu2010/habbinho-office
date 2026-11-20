// NPCs ambientais: visitantes decorativos que chegam pelo elevador, tomam café, leem na biblioteca, descansam no
// lounge e vão embora. NÃO representam sessões de IA: não existem no store nem no snapshot, não entram em contadores,
// métricas, feed nem no Habblaud World, e não são selecionáveis. Usam a grade e o A* da simulação (os mesmos caminhos
// dos agentes) e reservam o lugar onde estão, para nenhum agente sentar no mesmo assento.
import type { AgentInfo, AgentStatus } from '../../../shared/types';
import { appearanceFromSeed } from '../art';
import type { Dir, HeldItem, Pose } from '../art/api';
import { FOOT_DX, FOOT_DY, TILE } from '../world/constants';
import type { SpotDef, SpotKind } from '../world/layout/types';
import type { PathFinder } from '../world/path/astar';
import { Character } from '../world/sim/character';
import type { Elevator } from '../world/sim/elevator';
import type { SpotRegistry } from '../world/sim/spots';

import type { NpcLevel } from '../world/api';

export type { NpcLevel };
export const NPC_COUNT: Readonly<Record<NpcLevel, number>> = { none: 0, few: 3, many: 6 };

/** O que os NPCs usam da simulação (interface mínima: testável sem o Sim inteiro). */
export interface NpcWorld {
  spots: SpotRegistry;
  finder: PathFinder;
  elevators: readonly Elevator[];
}

interface Activity {
  kinds: SpotKind[];
  pose: Pose;
  held: HeldItem;
  /** Duração em segundos [mín, máx]. */
  secs: [number, number];
  weight: number;
}

/** O que um visitante faz. Só lugares das áreas comuns (core:*): mesas de trabalho dos projetos nunca. */
export const NPC_ACTIVITIES: readonly Activity[] = [
  { kinds: ['coffee'], pose: 'drink', held: 'coffee', secs: [6, 10], weight: 3 },
  { kinds: ['water'], pose: 'drink', held: 'water', secs: [5, 8], weight: 1 },
  { kinds: ['shelf'], pose: 'read', held: 'book', secs: [8, 16], weight: 3 },
  { kinds: ['window'], pose: 'stand', held: 'none', secs: [6, 12], weight: 2 },
  { kinds: ['sofa', 'armchair', 'beanbag'], pose: 'read', held: 'phone', secs: [12, 24], weight: 3 },
  { kinds: ['cafe_seat'], pose: 'sit', held: 'coffee', secs: [10, 20], weight: 2 },
  { kinds: ['arcade'], pose: 'game', held: 'controller', secs: [10, 18], weight: 1 },
];

const WALK = 2.6 * TILE;
const STUCK_MS = 25_000;

type State = 'arriving' | 'walking' | 'doing' | 'exiting' | 'gone';

export class Npc {
  readonly ch: Character;
  state: State = 'arriving';
  path: number[] = [];
  spot: SpotDef | null = null;
  activity: Activity | null = null;
  until = 0;
  done = 0;
  plan: number;
  elevator: Elevator | null = null;
  movedAt: number;

  constructor(id: string, seed: number, look: 'f' | 'm', now: number, rng: () => number) {
    const info = { id, seed, look, name: '', roomId: 'core:recepcao', kind: 'main', status: 'idle' as AgentStatus } as unknown as AgentInfo;
    // aparência sorteada como a de um agente (o Habbinho é vestido a partir dela)
    this.ch = new Character(info, appearanceFromSeed(seed, { look }));
    this.ch.alpha = 0;
    this.plan = 2 + Math.floor(rng() * 3);
    this.movedAt = now;
  }
}

export class NpcCrowd {
  readonly list = new Map<string, Character>();
  private npcs: Npc[] = [];
  private seq = 0;
  private nextSpawnAt = 0;

  constructor(
    private readonly world: () => NpcWorld,
    private readonly rng: () => number = Math.random,
  ) {}

  /** Tira todos (troca de nível, timelapse, saída do mundo) e devolve os lugares e elevadores. */
  clear(): void {
    for (const n of this.npcs) this.drop(n, 0);
    this.npcs = [];
    this.list.clear();
  }

  update(dt: number, now: number, level: NpcLevel): void {
    const target = NPC_COUNT[level];
    const w = this.world();
    // menos NPCs que o nível pede: um chega de cada vez, com intervalo
    if (this.npcs.filter((n) => n.state !== 'exiting').length < target && now >= this.nextSpawnAt && w.elevators.length) {
      this.spawn(w, now);
      this.nextSpawnAt = now + 4_000 + this.rng() * 8_000;
    }
    // mais NPCs que o nível: os excedentes vão embora
    let over = this.npcs.filter((n) => n.state !== 'exiting').length - target;
    for (const n of this.npcs) if (over > 0 && n.state !== 'exiting') {
      this.leave(n, w, now);
      over--;
    }
    for (const n of this.npcs) this.step(n, w, dt, now);
    for (const n of this.npcs.filter((x) => x.state === 'gone')) this.drop(n, now);
    this.npcs = this.npcs.filter((x) => x.state !== 'gone');
  }

  private spawn(w: NpcWorld, now: number): void {
    const id = `npc:${++this.seq}`;
    const n = new Npc(id, Math.floor(this.rng() * 1e9), this.rng() < 0.5 ? 'f' : 'm', now, this.rng);
    n.elevator = w.elevators[Math.floor(this.rng() * w.elevators.length)]!;
    n.elevator.request(id);
    const s = w.spots.get(n.elevator.spotId);
    if (!s) return;
    n.ch.placeAtTile(s.tx, s.ty);
    n.ch.x = s.x;
    n.ch.y = s.y;
    n.ch.dir = 'down';
    n.ch.setPose('stand');
    this.npcs.push(n);
    this.list.set(id, n.ch);
  }

  private step(n: Npc, w: NpcWorld, dt: number, now: number): void {
    const ch = n.ch;
    switch (n.state) {
      case 'arriving':
        // aparece quando a porta abre
        if (n.elevator?.isOpen) {
          ch.alpha = Math.min(1, ch.alpha + dt * 2.5);
          if (ch.alpha >= 1) {
            n.elevator.release(ch.id, now);
            n.elevator = null;
            this.next(n, w, now);
          }
        }
        return;
      case 'walking': {
        if (this.walk(n, dt)) {
          n.movedAt = now;
          return;
        }
        if (n.spot) this.arrive(n, w, now);
        else this.next(n, w, now);
        return;
      }
      case 'doing':
        n.movedAt = now;
        if (!n.spot || !w.spots.get(n.spot.id)) return this.next(n, w, now);
        if (now >= n.until) {
          this.standUp(n, w);
          n.done++;
          this.next(n, w, now);
        }
        return;
      case 'exiting': {
        if (this.walk(n, dt)) return;
        if (!n.elevator) {
          n.state = 'gone';
          return;
        }
        n.elevator.request(ch.id);
        ch.dir = 'up';
        ch.setPose('stand');
        if (n.elevator.isOpen) {
          ch.alpha = Math.max(0, ch.alpha - dt * 2.5);
          if (ch.alpha <= 0) n.state = 'gone';
        }
        return;
      }
    }
  }

  /** Próxima atividade, ou ir embora depois de algumas. */
  private next(n: Npc, w: NpcWorld, now: number): void {
    if (n.done >= n.plan || now - n.movedAt > STUCK_MS) return this.leave(n, w, now);
    const total = NPC_ACTIVITIES.reduce((a, b) => a + b.weight, 0);
    for (let tries = 0; tries < 6; tries++) {
      let r = this.rng() * total;
      const act = NPC_ACTIVITIES.find((a) => (r -= a.weight) < 0) ?? NPC_ACTIVITIES[0]!;
      const options = act.kinds.flatMap((k) => w.spots.ofKind(k)).filter((s) => s.areaId.startsWith('core:') && w.spots.isFree(s.id));
      if (!options.length) continue;
      const spot = options[Math.floor(this.rng() * options.length)]!;
      if (!this.route(n, w, spot.tx, spot.ty)) continue;
      n.spot = spot;
      n.activity = act;
      n.state = 'walking';
      return;
    }
    this.leave(n, w, now);
  }

  private leave(n: Npc, w: NpcWorld, now: number): void {
    if (n.state === 'doing') this.standUp(n, w);
    n.spot = null;
    n.activity = null;
    n.elevator ??= w.elevators[Math.floor(this.rng() * w.elevators.length)] ?? null;
    const s = n.elevator ? w.spots.get(n.elevator.spotId) : undefined;
    n.state = 'exiting';
    n.movedAt = now;
    if (!s || !this.route(n, w, s.tx, s.ty)) n.path = [];
  }

  private route(n: Npc, w: NpcWorld, tx: number, ty: number): boolean {
    const out: number[] = [];
    if (!w.finder.find(n.ch.tx, n.ch.ty, tx, ty, out)) return false;
    n.path = out;
    return true;
  }

  /** Anda pelo caminho; false quando chegou. */
  private walk(n: Npc, dt: number): boolean {
    const ch = n.ch;
    if (!n.path.length) {
      if (ch.pose === 'walk') ch.setPose('stand');
      return false;
    }
    const gx = n.path[0]! * TILE + FOOT_DX;
    const gy = n.path[1]! * TILE + FOOT_DY;
    const dx = gx - ch.x;
    const dy = gy - ch.y;
    const d = Math.hypot(dx, dy);
    const stepLen = WALK * dt;
    ch.setPose('walk', n.state === 'exiting' ? 'none' : ch.held);
    if (Math.abs(dx) > Math.abs(dy)) ch.dir = dx > 0 ? 'right' : 'left';
    else if (d > 0.01) ch.dir = dy > 0 ? 'down' : 'up';
    if (d <= stepLen) {
      ch.x = gx;
      ch.y = gy;
      ch.tx = n.path[0]!;
      ch.ty = n.path[1]!;
      n.path.splice(0, 2);
    } else {
      ch.x += (dx / d) * stepLen;
      ch.y += (dy / d) * stepLen;
    }
    return true;
  }

  private arrive(n: Npc, w: NpcWorld, now: number): void {
    const s = n.spot!;
    const act = n.activity!;
    if (!w.spots.reserve(s.id, n.ch.id)) return this.next(n, w, now);
    const ch = n.ch;
    ch.x = s.x;
    ch.y = s.y;
    ch.dir = s.dir as Dir;
    ch.seated = !!s.seated;
    ch.atSpot = s.id;
    ch.setPose(act.pose, act.held);
    n.state = 'doing';
    n.until = now + (act.secs[0] + this.rng() * (act.secs[1] - act.secs[0])) * 1000;
  }

  private standUp(n: Npc, w: NpcWorld): void {
    const ch = n.ch;
    if (ch.atSpot) w.spots.release(ch.atSpot, ch.id);
    if (n.spot) ch.placeAtTile(n.spot.tx, n.spot.ty);
    ch.atSpot = null;
    ch.seated = false;
    ch.setPose('stand', 'none');
  }

  private drop(n: Npc, now: number): void {
    const w = this.world();
    w.spots.releaseAll(n.ch.id);
    n.elevator?.release(n.ch.id, now);
    for (const e of w.elevators) e.release(n.ch.id, now);
    this.list.delete(n.ch.id);
  }
}
