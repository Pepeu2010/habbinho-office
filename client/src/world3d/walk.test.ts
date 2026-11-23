import { describe, expect, it } from 'vitest';
import { BLOCKED, FREE, SEAT } from '../world/path/grid';
import { blockedAt, slide } from './walk';

// mapa 6x6: parede na coluna x=3, assento em (1,4); o resto livre
const cell = (tx: number, ty: number): number => {
  if (tx < 0 || ty < 0 || tx > 5 || ty > 5) return BLOCKED;
  if (tx === 3) return BLOCKED;
  if (tx === 1 && ty === 4) return SEAT;
  return FREE;
};

describe('colisão do modo Passear', () => {
  it('parede e assento bloqueiam; chão livre não', () => {
    expect(blockedAt(cell, 1.5, 1.5)).toBe(false);
    expect(blockedAt(cell, 2.9, 1.5)).toBe(true);
    expect(blockedAt(cell, 1.5, 4.5)).toBe(true);
  });

  it('desliza ao longo da parede em vez de parar', () => {
    const [x, z] = slide(cell, 2.5, 1.5, 0.4, 0.4);
    expect(x).toBe(2.5);
    expect(z).toBeCloseTo(1.9);
  });

  it('anda livre quando nada bloqueia', () => {
    expect(slide(cell, 1.5, 1.5, 0.2, -0.1)).toEqual([1.7, 1.4]);
  });
});
