// Biblioteca e sala de reuniões: os lugares são de tipos que a vida social usa e todos são alcançáveis pelo corredor.
import { describe, expect, it } from 'vitest';
import { CORRIDOR_Y } from '../constants';
import { PathFinder } from '../path/astar';
import { assembleBuilding } from './building';
import { LIBRARY_ID, MEETING_ID } from './core';

describe('biblioteca e sala de reuniões', () => {
  const b = assembleBuilding(4, []);
  const pf = new PathFinder(b.grid);
  const start = { x: 20, y: CORRIDOR_Y + 2 };

  it('o teste distingue lugar inalcançável (parede norte da biblioteca)', () => {
    expect(pf.find(start.x, start.y, 40, 0, [])).toBe(false);
  });

  for (const id of [LIBRARY_ID, MEETING_ID]) {
    it(`${id}: lugares usados pelos passeios e alcançáveis`, () => {
      const area = [...b.core].find((a) => a.id === id)!;
      expect(area).toBeTruthy();
      const kinds = new Set(area.spots.map((s) => s.kind));
      // estante/janela/poltrona/sofá/quadro e rodas de conversa: tipos que sim.ts e social.ts escolhem
      expect([...kinds].some((k) => ['shelf', 'window', 'whiteboard'].includes(k))).toBe(true);
      expect([...kinds].some((k) => ['armchair', 'sofa'].includes(k))).toBe(true);
      expect(kinds.has('talk')).toBe(true);
      const out: number[] = [];
      for (const s of area.spots) expect(pf.find(start.x, start.y, s.tx, s.ty, out), `${s.id} (${s.tx},${s.ty})`).toBe(true);
    });
  }
});
