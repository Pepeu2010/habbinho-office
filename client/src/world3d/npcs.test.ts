import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../shared/hash';
import { assembleBuilding } from '../world/layout/building';
import { layoutProjectRoom } from '../world/layout/room';
import { PathFinder } from '../world/path/astar';
import { Elevator } from '../world/sim/elevator';
import { SpotRegistry } from '../world/sim/spots';
import { NpcCrowd, type NpcWorld } from './npcs';

function world(): NpcWorld & { tick(dt: number, now: number): void } {
  const theme = { carpet: '#777', carpet2: '#666', wall: { base: '#eee' }, accent: '#39f', deskVariant: 'wood', chairVariant: 'black' };
  const room = layoutProjectRoom({ id: '/p', slot: 0, seed: 7 }, theme);
  const b = assembleBuilding(4, [room]);
  const spots = new SpotRegistry();
  spots.setSpots(b.spots);
  const elevators = spots.ofKind('elevator').map((s, i) => new Elevator(i, s.id));
  return { spots, finder: new PathFinder(b.grid), elevators, tick: (dt, now) => elevators.forEach((e) => e.update(dt, now)) };
}

function run(crowd: NpcCrowd, w: ReturnType<typeof world>, level: 'none' | 'few' | 'many', seconds: number, t0 = 0, onTick?: (now: number) => void): number {
  let now = t0;
  for (let i = 0; i < seconds * 10; i++) {
    now += 100;
    w.tick(0.1, now);
    crowd.update(0.1, now, level);
    onTick?.(now);
  }
  return now;
}

describe('NPCs ambientais', () => {
  it('chegam pelo elevador, usam só lugares das áreas comuns e reservam o lugar', () => {
    const w = world();
    const crowd = new NpcCrowd(() => w, mulberry32(42));
    const used = new Set<string>();
    run(crowd, w, 'few', 120, 0, () => {
      for (const ch of crowd.list.values()) if (ch.atSpot) {
        used.add(ch.atSpot);
        expect(w.spots.ownerOf(ch.atSpot)).toBe(ch.id);
      }
    });
    expect(crowd.list.size).toBeGreaterThan(0);
    expect(used.size).toBeGreaterThan(0);
    for (const id of used) expect(w.spots.get(id)!.areaId.startsWith('core:')).toBe(true);
    // nunca uma mesa de trabalho de projeto
    for (const id of used) expect(w.spots.get(id)!.kind).not.toBe('desk');
  });

  it('nível "nenhum": todos vão embora e devolvem lugares e elevadores', () => {
    const w = world();
    const crowd = new NpcCrowd(() => w, mulberry32(7));
    const t = run(crowd, w, 'many', 60);
    expect(crowd.list.size).toBeGreaterThan(0);
    run(crowd, w, 'none', 90, t);
    expect(crowd.list.size).toBe(0);
    for (const s of w.spots.all()) expect(w.spots.ownerOf(s.id)?.startsWith('npc:') ?? false).toBe(false);
    for (const e of w.elevators) expect(e.load).toBe(0);
  });
});
