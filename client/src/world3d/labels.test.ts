import { describe, expect, it } from 'vitest';
import { declutter } from './labels';

const tag = (nameText: string) => ({ el: { hidden: false } as HTMLDivElement, nameText });

describe('declutter', () => {
  it('esconde o nome mais longe que encosta em outro e mantém quem tem balão', () => {
    const near = tag('Isabela');
    const far = tag('Escritório');
    const bubble = tag('Visitante');
    const alone = tag('Rui');
    declutter([
      { t: far, x: 105, y: 100, z: 0.9, rank: 1 },
      { t: near, x: 100, y: 102, z: 0.5, rank: 1 },
      { t: bubble, x: 100, y: 98, z: 0.95, rank: 0 },
      { t: alone, x: 400, y: 100, z: 0.9, rank: 2 },
    ]);
    expect(bubble.el.hidden).toBe(false);
    expect(near.el.hidden).toBe(true);
    expect(far.el.hidden).toBe(true);
    expect(alone.el.hidden).toBe(false);
  });
});
